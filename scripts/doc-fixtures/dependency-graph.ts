// Fixture for docs/src/content/docs/recipes/dependency-graph.md.
// Fence-matched and compiled by `scripts/check-doc-fixtures.ts` — keep in sync with the recipe.
import { Graph, pipe, Resource, Task, Transaction } from "@pplnd/core";

// --- stubs for the external services the recipe implies (not part of the recipe) ---
interface AccountRecord {
	readonly id: string;
	readonly externalId: string;
}
interface DbClient {
	readonly close: () => Promise<void>;
}
interface LockHandle {
	readonly release: () => Promise<void>;
}
declare const accounts: { readonly find: (accountId: string) => Promise<AccountRecord>; };
declare const ledgerApi: {
	readonly read: (accountId: string, period: string) => Promise<{ readonly totalCents: number; }>;
};
declare const bankApi: {
	readonly read: (externalId: string, period: string) => Promise<{ readonly totalCents: number; }>;
};
declare const adjustments: {
	readonly reserve: (
		connection: DbClient,
		lock: LockHandle,
		accountId: string,
		cents: number,
	) => Promise<{ readonly id: string; }>;
	readonly release: (connection: DbClient, reservationId: string) => Promise<void>;
};
declare const journal: {
	readonly post: (connection: DbClient, reservationId: string, cents: number) => Promise<number>;
};
declare const db: { readonly connect: () => Promise<DbClient>; };
declare const locks: { readonly acquire: (name: string) => Promise<LockHandle>; };

// --- block: schedule the reads ---
interface ReconciliationInput {
	readonly accountId: string;
	readonly period: string;
}

type ReadError = { readonly kind: "SourceDown"; readonly source: string; };

const node = Graph.nodeFactory<ReconciliationInput>();

const account = node(
	"account",
	({ ctx }) =>
		Task.Result.tryCatch(() => accounts.find(ctx.input.accountId), {
			onError: (): ReadError => ({ kind: "SourceDown", source: "accounts" }),
		}),
);

const ledger = node(
	"ledger",
	{ account },
	({ ctx, deps }) =>
		Task.Result.tryCatch(() => ledgerApi.read(deps.account.id, ctx.input.period), {
			onError: (): ReadError => ({ kind: "SourceDown", source: "ledger" }),
		}),
);

const bank = node(
	"bank",
	{ account },
	({ ctx, deps }) =>
		Task.Result.tryCatch(() => bankApi.read(deps.account.externalId, ctx.input.period), {
			onError: (): ReadError => ({ kind: "SourceDown", source: "bank" }),
		}),
);

const difference = node(
	"difference",
	{ ledger, bank },
	({ deps }) => Task.Result.make.ok(deps.ledger.totalCents - deps.bank.totalCents),
);

const reconciliation = Graph.make(difference);

// --- block: write it under compensation ---
interface WriteInput {
	readonly accountId: string;
	readonly cents: number;
}

type WriteError = { readonly kind: "ReserveFailed" | "PostFailed"; readonly message: string; };
type ReleaseError = { readonly kind: "ReleaseFailed"; readonly message: string; };

const reconcileWith = (connection: DbClient, lock: LockHandle) => {
	const step = Transaction.stepFactory<WriteInput>();

	const reserve = step(
		"reserve",
		({ ctx }) =>
			Task.Result.tryCatch(() => adjustments.reserve(connection, lock, ctx.input.accountId, ctx.input.cents), {
				onError: (error): WriteError => ({ kind: "ReserveFailed", message: String(error) }),
			}),
		({ ctx }) =>
			Task.Result.tryCatch(() => adjustments.release(connection, ctx.output.id), {
				onError: (error): ReleaseError => ({ kind: "ReleaseFailed", message: String(error) }),
			}),
	);

	const post = step(
		"post",
		{ reserve },
		({ ctx, deps }) =>
			Task.Result.tryCatch(() => journal.post(connection, deps.reserve.id, ctx.input.cents), {
				onError: (error): WriteError => ({ kind: "PostFailed", message: String(error) }),
			}),
	);

	return Transaction.make(reserve, post);
};

// --- block: hold the handles ---
const dbConnection = Resource.make(
	Task.Result.tryCatch(() => db.connect(), { onError: (): ReadError => ({ kind: "SourceDown", source: "db" }) }),
	(client) => Task.tryCatch(() => client.close(), { onError: () => {} }),
);

const dbLock = Resource.make(
	Task.Result.tryCatch(() => locks.acquire("reconciliation"), {
		onError: (): ReadError => ({ kind: "SourceDown", source: "lock" }),
	}),
	(handle) => Task.tryCatch(() => handle.release(), { onError: () => {} }),
);

const infra = Resource.all({ connection: dbConnection, lock: dbLock });

const runGraph = (input: ReconciliationInput) => (signal?: AbortSignal) => Graph.run(input, { signal })(reconciliation);

const runReconciliation = (input: ReconciliationInput) =>
	Resource.use(infra, {
		run: ({ connection, lock }) =>
			pipe(
				runGraph(input),
				Task.Result.chain((cents: number) => (signal?: AbortSignal) =>
					Transaction.run({ accountId: input.accountId, cents }, { signal })(reconcileWith(connection, lock))
				),
			),
	});

export const outcome = await runReconciliation({ accountId: "acct_88", period: "2026-10" });
// Ok(acc), or Err(ReadError | WriteError | Aborted | Transaction.Failure)
