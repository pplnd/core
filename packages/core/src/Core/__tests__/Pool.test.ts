import { expect, test, vi } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { Aborted } from "../Aborted.ts";
import { Deferred } from "../Deferred.ts";
import { Pool } from "../Pool.ts";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";

const makePool = (
	overrides?: {
		readonly maxSize?: number;
		readonly idleTimeout?: Duration;
		readonly maxLifetime?: Duration;
		readonly acquireTimeout?: Duration;
		readonly failCreation?: boolean;
	},
) => {
	const created: string[] = [];
	const destroyed: string[] = [];
	const pool = Pool.make<"offline", string>({
		acquire: Task.Result.tryCatch((signal) =>
			new Promise<string>((resolve, reject) => {
				const id = `db-${created.length + 1}`;
				created.push(id);
				setTimeout(() => {
					if (signal?.aborted) {
						reject(new Error("aborted"));
						return;
					}
					if (overrides?.failCreation === true) {
						reject(new Error("down"));
						return;
					}
					resolve(id);
				}, 5);
			}), { onError: () => "offline" as const }),
		destroy: (item) => Task.tryCatch(() => Promise.resolve(destroyed.push(item)), { onError: () => {} }),
		maxSize: overrides?.maxSize ?? 2,
		idleTimeout: overrides?.idleTimeout,
		maxLifetime: overrides?.maxLifetime,
		acquireTimeout: overrides?.acquireTimeout,
	});
	return { pool, created, destroyed };
};

const itemOf = (result: Result<unknown, Pool.Lease<string>>): string =>
	Result.match({ ok: (lease: Pool.Lease<string>) => lease.item, err: () => "" })(result);

test("acquire: creates lazily and reuses an idle item on the next checkout", async () => {
	const { pool, created, destroyed } = makePool();
	const first = await pool.acquire();
	expect(itemOf(first)).toBe("db-1");
	if (Result.is.ok(first)) {
		await first.value.release();
	}
	const second = await pool.acquire();
	expect(itemOf(second)).toBe("db-1");
	if (Result.is.ok(second)) {
		await second.value.release();
	}
	expect(created).toStrictEqual(["db-1"]);
	expect(destroyed).toStrictEqual([]);
});

test("acquire: creates distinct items up to maxSize under concurrent callers", async () => {
	const { pool, created } = makePool({ maxSize: 2 });
	const first = pool.acquire();
	const second = pool.acquire();
	const leases = await Deferred.all([first, second]);
	expect(created).toStrictEqual(["db-1", "db-2"]);
	expect(Result.is.ok(leases[0]) && Result.is.ok(leases[1])).toBe(true);
});

test("acquire: queues callers beyond maxSize and hands off on release in FIFO order", async () => {
	const { pool, created } = makePool({ maxSize: 1 });
	const first = await pool.acquire();
	expect(itemOf(first)).toBe("db-1");
	const second = pool.acquire();
	const third = pool.acquire();
	await Promise.resolve();
	await Promise.resolve();
	expect(created).toStrictEqual(["db-1"]);
	if (Result.is.ok(first)) {
		await first.value.release();
	}
	const secondLease = await second;
	expect(Result.is.ok(secondLease) && secondLease.value.item).toBe("db-1");
	if (Result.is.ok(secondLease)) {
		await secondLease.value.release();
	}
	const thirdLease = await third;
	expect(Result.is.ok(thirdLease) && thirdLease.value.item).toBe("db-1");
	if (Result.is.ok(thirdLease)) {
		await thirdLease.value.release();
	}
});

test("acquire: a pre-aborted signal settles Aborted without creating an item", async () => {
	const { pool, created } = makePool();
	const controller = new AbortController();
	controller.abort("stopped");
	const result = await pool.acquire({ signal: controller.signal });
	expect(result).toStrictEqual(Result.make.err({ kind: "Aborted", reason: "stopped" }));
	expect(created).toStrictEqual([]);
});

test("acquire: a caller abort during the wait settles Aborted and frees the slot", async () => {
	const { pool } = makePool({ maxSize: 1 });
	const first = await pool.acquire();
	const controller = new AbortController();
	const waiting = pool.acquire({ signal: controller.signal });
	controller.abort("cancelled");
	const result = await waiting;
	expect(result).toStrictEqual(Result.make.err({ kind: "Aborted", reason: "cancelled" }));
	if (Result.is.ok(first)) {
		await first.value.release();
	}
});

test("acquire: a failed creation settles the caller with that error", async () => {
	const { pool } = makePool({ failCreation: true });
	const result = await pool.acquire();
	expect(result).toStrictEqual(Result.make.err("offline"));
});

test("acquire: a queued caller times out with Pool.Timeout", async () => {
	const { pool, created } = makePool({ maxSize: 1, acquireTimeout: Duration.milliseconds(20) });
	const first = await pool.acquire();
	const waiting = pool.acquire();
	const result = await waiting;
	expect(result).toStrictEqual(Result.make.err({ kind: "PoolTimeout" }));
	expect(created).toStrictEqual(["db-1"]);
	if (Result.is.ok(first)) {
		await first.value.release();
	}
});

test("release: returns a healthy item to the idle set and destroys a broken one", async () => {
	const { pool, created, destroyed } = makePool();
	const lease = await pool.acquire();
	if (Result.is.ok(lease)) {
		await lease.value.release({ broken: true });
	}
	expect(destroyed).toStrictEqual(["db-1"]);

	const next = await pool.acquire();
	expect(itemOf(next)).toBe("db-2");
	if (Result.is.ok(next)) {
		await next.value.release();
	}
	expect(created).toStrictEqual(["db-1", "db-2"]);
	expect(destroyed).toStrictEqual(["db-1"]);
});

test("release: destroys an item returned after maxLifetime even when healthy", async () => {
	const { pool, created, destroyed } = makePool({ maxLifetime: Duration.milliseconds(10) });
	const lease = await pool.acquire();
	await new Promise((resolve) => setTimeout(resolve, 15));
	if (Result.is.ok(lease)) {
		await lease.value.release();
	}
	expect(destroyed).toStrictEqual(["db-1"]);

	const next = await pool.acquire();
	expect(itemOf(next)).toBe("db-2");
	if (Result.is.ok(next)) {
		await next.value.release();
	}
	expect(created).toStrictEqual(["db-1", "db-2"]);
});

test("idleTimeout: evicts an idle item and destroys it", async () => {
	vi.useFakeTimers();
	try {
		const { pool, created, destroyed } = makePool({ idleTimeout: Duration.milliseconds(30) });
		const leasePromise = pool.acquire();
		await vi.advanceTimersByTimeAsync(5);
		const lease = await leasePromise;
		if (Result.is.ok(lease)) {
			await lease.value.release();
		}
		expect(created).toStrictEqual(["db-1"]);
		const reusePromise = pool.acquire();
		const reuse = await reusePromise;
		expect(itemOf(reuse)).toBe("db-1");
		// the reuse cleared the eviction timer, so nothing is destroyed by the idle deadline
		// while the item is checked out:
		await vi.advanceTimersByTimeAsync(30);
		expect(destroyed).toStrictEqual([]);
		if (Result.is.ok(reuse)) {
			await reuse.value.release();
		}
		// released again, the fresh idle timer evicts it at the deadline:
		await vi.advanceTimersByTimeAsync(30);
		expect(destroyed).toStrictEqual(["db-1"]);
		const nextPromise = pool.acquire();
		await vi.advanceTimersByTimeAsync(5);
		const next = await nextPromise;
		expect(itemOf(next)).toBe("db-2");
		if (Result.is.ok(next)) {
			await next.value.release();
		}
		expect(created).toStrictEqual(["db-1", "db-2"]);
	} finally {
		vi.useRealTimers();
	}
});

test("close: settles queued waiters and destroys the held item on release", async () => {
	const { pool, created, destroyed } = makePool({ maxSize: 1 });
	const first = await pool.acquire();
	const queued = pool.acquire();
	const closing = pool.close();
	const queuedResult = await queued;
	expect(queuedResult).toStrictEqual(Result.make.err({ kind: "PoolClosed" }));
	if (Result.is.ok(first)) {
		await first.value.release();
	}
	await closing;
	expect(destroyed).toStrictEqual(["db-1"]);
	expect(created).toStrictEqual(["db-1"]);
});

test("close: drains in-flight leases, destroys everything, and rejects later acquires", async () => {
	const { pool, created, destroyed } = makePool({ maxSize: 2 });
	const first = await pool.acquire();
	const second = await pool.acquire();
	expect(created).toStrictEqual(["db-1", "db-2"]);
	const closing = pool.close();
	if (Result.is.ok(first)) {
		await first.value.release();
	}
	if (Result.is.ok(second)) {
		await second.value.release();
	}
	await closing;
	expect(destroyed).toStrictEqual(["db-1", "db-2"]);
	expect(pool.state()).toStrictEqual({ kind: "PoolClosed" });
	const after = await pool.acquire();
	expect(after).toStrictEqual(Result.make.err({ kind: "PoolClosed" }));
});

test("close: settles queued waiters and in-flight creations with Pool.Closed", async () => {
	const { pool, created, destroyed } = makePool({ maxSize: 2 });
	const first = pool.acquire();
	const second = pool.acquire();
	const closing = pool.close();
	const outcomes = await Deferred.all([first, second]);
	expect(outcomes[0]).toStrictEqual(Result.make.err({ kind: "PoolClosed" }));
	expect(outcomes[1]).toStrictEqual(Result.make.err({ kind: "PoolClosed" }));
	await closing;
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(created).toStrictEqual(["db-1", "db-2"]);
	expect(destroyed).toStrictEqual(["db-1", "db-2"]);
	expect(pool.state()).toStrictEqual({ kind: "PoolClosed" });
});

test("close: destroys idle items immediately when nothing is checked out", async () => {
	const { pool, destroyed } = makePool();
	const lease = await pool.acquire();
	if (Result.is.ok(lease)) {
		await lease.value.release();
	}
	await pool.close();
	expect(destroyed).toStrictEqual(["db-1"]);
	expect(pool.state()).toStrictEqual({ kind: "PoolClosed" });
});

test("close: an in-flight creation that fails settles quietly without destroying", async () => {
	const { pool, created, destroyed } = makePool({ failCreation: true });
	const pending = pool.acquire();
	const closing = pool.close();
	const outcome = await pending;
	expect(outcome).toStrictEqual(Result.make.err({ kind: "PoolClosed" }));
	await closing;
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(created).toStrictEqual(["db-1"]);
	expect(destroyed).toStrictEqual([]);
});

test("state: reports Idle, Active saturation, and notifies subscribers until unsubscribe", async () => {
	const { pool } = makePool({ maxSize: 2 });
	expect(pool.state()).toStrictEqual({ kind: "PoolIdle" });
	const states: Pool.State[] = [];
	const unsubscribe = pool.subscribe((state) => states.push(state));

	const lease = await pool.acquire();
	expect(pool.state()).toStrictEqual({ kind: "PoolActive", available: 0, inUse: 1, waiting: 0 });
	if (Result.is.ok(lease)) {
		await lease.value.release();
	}
	expect(pool.state()).toStrictEqual({ kind: "PoolActive", available: 1, inUse: 0, waiting: 0 });
	expect(states).toStrictEqual([{ kind: "PoolActive", available: 0, inUse: 0, waiting: 0 }, {
		kind: "PoolActive",
		available: 0,
		inUse: 1,
		waiting: 0,
	}, { kind: "PoolActive", available: 1, inUse: 0, waiting: 0 }]);
	unsubscribe();
	const next = await pool.acquire();
	if (Result.is.ok(next)) {
		await next.value.release();
	}
	expect(states).toHaveLength(3);
});

test("make: clamps a nonpositive maxSize to one checkout at a time", async () => {
	const created: string[] = [];
	const pool = Pool.make<"offline", string>({
		acquire: Task.Result.tryCatch(() => Promise.resolve(`db-${created.push("x")}`), {
			onError: () => "offline" as const,
		}),
		destroy: () => Task.tryCatch(() => Promise.resolve(), { onError: () => {} }),
		maxSize: 0,
	});
	const first = await pool.acquire();
	const second = pool.acquire();
	await Promise.resolve();
	await Promise.resolve();
	expect(created).toStrictEqual(["x"]);
	if (Result.is.ok(first)) {
		await first.value.release();
	}
	const secondResult = await second;
	expect(Result.is.ok(secondResult)).toBe(true);
	if (Result.is.ok(secondResult)) {
		await secondResult.value.release();
	}
});

test("acquire: reports the caller's abort reason from Aborted", async () => {
	const { pool } = makePool({ maxSize: 1 });
	const first = await pool.acquire();
	const controller = new AbortController();
	const waiting = pool.acquire({ signal: controller.signal });
	controller.abort(new Error("shutting down"));
	const result = await waiting;
	type PoolOutcomeError = "offline" | Pool.Timeout | Pool.Closed | Aborted;
	const aborted = Result.match({
		ok: () => false,
		err: (error: PoolOutcomeError) => typeof error === "object" && Aborted.is(error),
	})(result);
	expect(aborted).toBe(true);
	if (Result.is.ok(first)) {
		await first.value.release();
	}
});
