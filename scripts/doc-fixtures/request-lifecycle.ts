// Fixture for docs/src/content/docs/recipes/request-lifecycle.md.
// Fence-matched and compiled by `scripts/check-doc-fixtures.ts` — keep in sync with the recipe.
import { Duration, Op, pipe, RemoteData, RetryPolicy, Task, Validation } from "@pplnd/core";

// --- controlled server stub with idempotency-key dedup (not part of the recipe) ---
interface FetchResponse {
	readonly ok: boolean;
	readonly text: () => Promise<string>;
	readonly json: () => Promise<Ticket>;
}
export const server = { tickets: new Map<string, Ticket>(), keys: [] as string[], attempts: 0, failNext: false };
const fetch = (
	_url: string,
	init?: {
		readonly method?: string;
		readonly headers?: Record<string, string>;
		readonly body?: string;
		readonly signal?: AbortSignal;
	},
): Promise<FetchResponse> => {
	server.attempts += 1;
	const key = init?.headers?.["Idempotency-Key"] ?? "";
	server.keys.push(key);
	const existing = server.tickets.get(key);
	if (existing !== undefined) {
		return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(existing) });
	}
	if (server.failNext) {
		server.failNext = false;
		return Promise.resolve({
			ok: false,
			text: () => Promise.resolve("upstream down"),
			json: () => Promise.reject(new Error("unused")),
		});
	}
	const ticket: Ticket = { id: `ticket_${server.tickets.size + 1}`, subject: "created" };
	server.tickets.set(key, ticket);
	return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(ticket) });
};

// --- block: validate at the boundary ---
interface TicketForm {
	readonly subject: string;
	readonly priority: string;
	readonly assignee: string;
}

type TicketError = string;

const validateSubject = (subject: string): Validation<TicketError, string> =>
	subject.trim().length >= 8
		? Validation.make.passed(subject.trim())
		: Validation.make.failed("Subject must be at least 8 characters");

const validatePriority = (priority: string): Validation<TicketError, "low" | "high"> =>
	priority === "low" || priority === "high"
		? Validation.make.passed(priority)
		: Validation.make.failed("Priority must be low or high");

const validateAssignee = (assignee: string): Validation<TicketError, string> =>
	assignee.length > 0 ? Validation.make.passed(assignee) : Validation.make.failed("An assignee is required");

const validateTicket = (form: TicketForm) =>
	Validation.struct({
		subject: validateSubject(form.subject),
		priority: validatePriority(form.priority),
		assignee: validateAssignee(form.assignee),
	});

const check = validateTicket({ subject: "Printer", priority: "urgent", assignee: "" });
// Failed(["Subject must be at least 8 characters", "Priority must be low or high", "An assignee is required"])

// --- block: run it under a policy ---
type Ticket = { readonly id: string; readonly subject: string; };
type SubmitError = { readonly kind: "Rejected"; readonly message: string; } | { readonly kind: "Timeout"; };

type TicketSubmission = {
	readonly ticket: TicketForm & { readonly priority: "low" | "high"; };
	readonly idempotencyKey: string;
};

const submitTicket = Op.make((submission: TicketSubmission) =>
	Task.Result.tryCatch(async (signal) => {
		const response = await fetch("/api/tickets", {
			method: "POST",
			headers: { "Idempotency-Key": submission.idempotencyKey },
			body: JSON.stringify(submission.ticket),
			signal,
		});
		if (!response.ok) { throw new Error(await response.text()); }
		return response.json() as Promise<Ticket>;
	}, { onError: (error): SubmitError => ({ kind: "Rejected", message: String(error) }) })
);

const ticketManager = Op.interpret(submitTicket, {
	strategy: "exclusive",
	retry: RetryPolicy.exponential({ attempts: 2, initial: Duration.milliseconds(200) }),
	timeout: { duration: Duration.seconds(10), onTimeout: (): SubmitError => ({ kind: "Timeout" }) },
});

// --- block: render the state it produces ---
type TicketView = RemoteData<SubmitError, Ticket>;

const render = (view: TicketView): string =>
	pipe(
		view,
		RemoteData.match({
			notAsked: () => "Fill in the form",
			loading: () => "Submitting...",
			failure: (error) => error.kind === "Timeout" ? "The server did not answer" : error.message,
			success: (ticket) => `Ticket ${ticket.id} created`,
		}),
	);

ticketManager.subscribe(() => {
	const view = RemoteData.from.OpState(ticketManager.state);
	render(view);
	// hand view to your view layer
});

const handleSubmit = (form: TicketForm): readonly string[] => {
	const validation = validateTicket(form);
	if (Validation.is.failed(validation)) {
		return validation.errors;
	}
	const submission: TicketSubmission = { ticket: validation.value, idempotencyKey: crypto.randomUUID() };
	void ticketManager.run(submission);
	return [];
};

export { check, handleSubmit, ticketManager, validateTicket };
