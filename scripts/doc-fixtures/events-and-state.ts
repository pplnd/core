// Fixture for docs/src/content/docs/recipes/events-and-state.md.
// Fence-matched and compiled by `scripts/check-doc-fixtures.ts` — keep in sync with the recipe.
import { Duration, EventBus, Machine, Op, RetryPolicy, Task } from "@pplnd/core";

// --- controlled fetch stub for the validation endpoint (not part of the recipe) ---
interface FetchResponse {
	readonly ok: boolean;
	readonly text: () => Promise<string>;
	readonly json: () => Promise<{ readonly pages: number; }>;
}
export const fetchStub: {
	pending: { readonly signal: AbortSignal | undefined; readonly release: (ok: boolean) => void; } | undefined;
} = { pending: undefined };
const fetch = (_url: string, init?: { readonly signal?: AbortSignal; }): Promise<FetchResponse> =>
	new Promise((resolve) => {
		fetchStub.pending = {
			signal: init?.signal,
			release: (ok) =>
				resolve({ ok, text: () => Promise.resolve("validation failed"), json: () => Promise.resolve({ pages: 12 }) }),
		};
	});

// --- block: describe the messages ---
export type IngestEvents = {
	readonly uploadFinished: { readonly documentId: string; readonly bytes: number; };
	readonly validate: { readonly documentId: string; };
	readonly validated: { readonly documentId: string; readonly pages: number; };
	readonly rejected: { readonly documentId: string; readonly reason: string; };
	readonly cancelled: { readonly documentId: string; };
};

export const ingestBus = EventBus.make<IngestEvents>();

// --- block: model the lifecycle ---
type DocumentState =
	| Machine.State<"received", { readonly documentId: string; }, "validating" | "cancelled">
	| Machine.State<"validating", { readonly documentId: string; }, "indexed" | "failed" | "cancelled">
	| Machine.State<"indexed", { readonly documentId: string; readonly pages: number; }, never>
	| Machine.State<"failed", { readonly documentId: string; readonly reason: string; }, "validating">
	| Machine.State<"cancelled", { readonly documentId: string; }, never>;

type DocumentEvents = {
	readonly validate: { readonly documentId: string; };
	readonly validated: { readonly documentId: string; readonly pages: number; };
	readonly rejected: { readonly documentId: string; readonly reason: string; };
	readonly cancelled: { readonly documentId: string; };
};

const documentMachine = Machine.make<DocumentState, DocumentEvents>({
	received: {
		on: {
			validate: (_state, { documentId }) => Machine.state("validating", { documentId }),
			cancelled: (_state, { documentId }) => Machine.state("cancelled", { documentId }),
		},
	},
	validating: {
		on: {
			validated: (_state, { documentId, pages }) => Machine.state("indexed", { documentId, pages }),
			rejected: (_state, { documentId, reason }) => Machine.state("failed", { documentId, reason }),
			cancelled: (_state, { documentId }) => Machine.state("cancelled", { documentId }),
		},
	},
	indexed: { on: {} },
	failed: { on: { validate: (_state, { documentId }) => Machine.state("validating", { documentId }) } },
	cancelled: { on: {} },
});

// --- block: run the work under a policy ---
type ValidationError = { readonly kind: "Rejected"; readonly reason: string; };
type ValidatedDocument = { readonly documentId: string; readonly pages: number; };

const validateDocument = Op.make((documentId: string) =>
	Task.Result.tryCatch(async (signal) => {
		const response = await fetch(`/api/documents/${documentId}/validate`, { signal });
		if (!response.ok) { throw new Error(await response.text()); }
		const body = await response.json() as { readonly pages: number; };
		return { documentId, pages: body.pages } satisfies ValidatedDocument;
	}, { onError: (error): ValidationError => ({ kind: "Rejected", reason: String(error) }) })
);

const validation = Op.interpret(validateDocument, {
	strategy: "keyed",
	perKey: "exclusive",
	retry: RetryPolicy.exponential({ attempts: 2, initial: Duration.milliseconds(300) }),
	timeout: {
		duration: Duration.seconds(20),
		onTimeout: (): ValidationError => ({ kind: "Rejected", reason: "timeout" }),
	},
});

const runValidation = (documentId: string) => {
	void validation.run(documentId);
};

// --- block: connect the three ---
const actor = Machine.interpret(documentMachine, {
	initial: Machine.state("received", { documentId: "doc_1" }),
	bus: ingestBus,
});

actor.subscribe((state) => {
	if (state.kind === "validating") {
		runValidation(state.value.documentId);
	}
	if (state.kind === "cancelled") {
		validation.abort(state.value.documentId);
	}
});

validation.subscribe((states) => {
	const outcome = states.get("doc_1");
	if (outcome === undefined) {
		return;
	}
	if (Op.Outcome.is.ok(outcome)) {
		EventBus.emit(ingestBus, {
			kind: "validated",
			value: { documentId: outcome.value.documentId, pages: outcome.value.pages },
		});
	}
	if (Op.Outcome.is.err(outcome)) {
		EventBus.emit(ingestBus, { kind: "rejected", value: { documentId: "doc_1", reason: outcome.error.reason } });
	}
});

EventBus.emit(ingestBus, { kind: "uploadFinished", value: { documentId: "doc_1", bytes: 2048 } });
EventBus.emit(ingestBus, { kind: "validate", value: { documentId: "doc_1" } });

export { actor, runValidation, validateDocument, validation };
