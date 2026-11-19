import { expect, test, vi } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { Duration } from "../../Types/Duration.ts";
import { Batcher } from "../Batcher.ts";
import { Cache } from "../Cache.ts";
import { Deferred } from "../Deferred.ts";
import { Maybe } from "../Maybe.ts";
import { Result } from "../Result.ts";
import type { Task } from "../Task.ts";

/**
 * Runs a test against a frozen clock that only the test moves. The clock is restored even when an
 * assertion fails, so later tests see the real clock.
 */
const withFakeClock = async (run: () => Promise<void>): Promise<void> => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(0);
	try {
		await run();
	} finally {
		vi.useRealTimers();
	}
};

const makeImmediateLoad = <V>(read: (key: string) => V) => {
	const calls: string[] = [];
	const load = (key: string): Deferred<Result<never, V>> => {
		calls.push(key);
		return Deferred.from.Promise(globalThis.Promise.resolve(Result.make.ok(read(key))));
	};
	return { load, calls };
};

const makeFailingLoad = <V>(read: (key: string) => Result<string, V>) => {
	const calls: string[] = [];
	const load = (key: string): Deferred<Result<string, V>> => {
		calls.push(key);
		return Deferred.from.Promise(globalThis.Promise.resolve(read(key)));
	};
	return { load, calls };
};

const makeControlledLoad = <E, V>() => {
	const calls: string[] = [];
	const resolvers: ((result: Result<E, V>) => void)[] = [];
	const load = (key: string): Deferred<Result<E, V>> => {
		calls.push(key);
		return Deferred.from.Promise(
			new globalThis.Promise<Result<E, V>>((resolve) => {
				resolvers.push(resolve);
			}),
		);
	};
	const settle = (index: number, result: Result<E, V>): void => {
		const resolve = resolvers[index];
		if (resolve === undefined) {
			throw new Error(`no pending load at index ${index}`);
		}
		resolve(result);
	};
	return { load, calls, settle };
};

// -----------------------------------------------------------------------------
// Lookup and storage
// -----------------------------------------------------------------------------

test("load: starts the lookup when called", () => {
	const { load, calls } = makeImmediateLoad(() => 1);
	const cache = Cache.make<string, never, number>({ load, ttl: Duration.seconds(10) });

	expect(calls).toStrictEqual([]);
	void cache.load("a");
	expect(calls).toStrictEqual(["a"]);
});

test("load: serves a fresh value without loading again", () =>
	withFakeClock(async () => {
		const { load, calls } = makeImmediateLoad(() => 1);
		const cache = Cache.make<string, never, number>({ load, ttl: Duration.seconds(10) });

		await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok(1));
		vi.setSystemTime(9_999);
		await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok(1));
		expect(calls).toStrictEqual(["a"]);
		expect(cache.size()).toBe(1);
	}));

test("load: concurrent misses share one load", async () => {
	const { load, calls, settle } = makeControlledLoad<string, number>();
	const cache = Cache.make<string, string, number>({ load, ttl: Duration.seconds(10) });

	const first = cache.load("a");
	const second = cache.load("a");
	expect(calls).toStrictEqual(["a"]);

	settle(0, Result.make.ok(7));
	await expect(first).resolves.toStrictEqual(Result.make.ok(7));
	await expect(second).resolves.toStrictEqual(Result.make.ok(7));
	expect(cache.size()).toBe(1);
});

test("load: does not store a failed load and retries on the next call", async () => {
	let failing = true;
	const { load, calls } = makeFailingLoad(() => failing ? Result.make.err("unavailable") : Result.make.ok(3));
	const cache = Cache.make<string, string, number>({ load, ttl: Duration.seconds(10) });

	await expect(cache.load("a")).resolves.toStrictEqual(Result.make.err("unavailable"));
	expect(cache.size()).toBe(0);
	expect(cache.peek("a")).toStrictEqual(Maybe.make.none());

	failing = false;
	await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok(3));
	expect(calls).toStrictEqual(["a", "a"]);
	expect(cache.size()).toBe(1);
});

test("load: a synchronous throw from load propagates and leaves no flight", async () => {
	let failing = true;
	const calls: string[] = [];
	const load = (key: string): Deferred<Result<string, number>> => {
		calls.push(key);
		if (failing) {
			throw new Error("load contract violation");
		}
		return Deferred.from.Promise(globalThis.Promise.resolve(Result.make.ok(4)));
	};
	const cache = Cache.make<string, string, number>({ load, ttl: Duration.seconds(10) });

	expect(() => cache.load("a")).toThrow("load contract violation");

	failing = false;
	await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok(4));
	expect(cache.size()).toBe(1);
});

// -----------------------------------------------------------------------------
// Freshness phases
// -----------------------------------------------------------------------------

test("load: a stale value is returned immediately while one refresh runs", () =>
	withFakeClock(async () => {
		let value = 1;
		const { load, calls } = makeImmediateLoad(() => value);
		const cache = Cache.make<string, never, number>({
			load,
			ttl: Duration.seconds(10),
			staleWhileRevalidate: Duration.seconds(5),
		});

		await cache.load("a");
		value = 2;
		vi.setSystemTime(10_500);

		await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok(1));
		expect(calls).toStrictEqual(["a", "a"]);

		await cache.flush();
		expect(cache.peek("a")).toStrictEqual(Maybe.make.some(2));
	}));

test("load: a second stale read reuses the running refresh", () =>
	withFakeClock(async () => {
		const { load, calls, settle } = makeControlledLoad<never, number>();
		const cache = Cache.make<string, never, number>({
			load,
			ttl: Duration.seconds(10),
			staleWhileRevalidate: Duration.seconds(5),
		});

		const initial = cache.load("a");
		settle(0, Result.make.ok(1));
		await initial;
		vi.setSystemTime(10_500);

		await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok(1));
		await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok(1));
		expect(calls).toStrictEqual(["a", "a"]);

		settle(1, Result.make.ok(2));
		await cache.flush();
		expect(cache.peek("a")).toStrictEqual(Maybe.make.some(2));
	}));

test("load: a failed refresh keeps the stale value", () =>
	withFakeClock(async () => {
		let failing = false;
		const { load, calls } = makeFailingLoad(() => failing ? Result.make.err("down") : Result.make.ok(1));
		const cache = Cache.make<string, string, number>({
			load,
			ttl: Duration.seconds(10),
			staleWhileRevalidate: Duration.seconds(5),
		});

		await cache.load("a");
		failing = true;
		vi.setSystemTime(10_500);

		await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok(1));
		await cache.flush();
		expect(cache.peek("a")).toStrictEqual(Maybe.make.some(1));

		await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok(1));
		expect(calls).toStrictEqual(["a", "a", "a"]);
	}));

test("load: an expired value without a stale window loads again", () =>
	withFakeClock(async () => {
		let value = 1;
		const { load, calls } = makeImmediateLoad(() => value);
		const cache = Cache.make<string, never, number>({ load, ttl: Duration.seconds(10) });

		await cache.load("a");
		value = 2;
		vi.setSystemTime(10_000);

		await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok(2));
		expect(calls).toStrictEqual(["a", "a"]);
	}));

// -----------------------------------------------------------------------------
// peek, invalidate, clear, size
// -----------------------------------------------------------------------------

test("peek: reads stored and stale values without loading or refreshing", () =>
	withFakeClock(async () => {
		const { load, calls } = makeImmediateLoad(() => 1);
		const cache = Cache.make<string, never, number>({
			load,
			ttl: Duration.seconds(10),
			staleWhileRevalidate: Duration.seconds(5),
		});

		expect(cache.peek("a")).toStrictEqual(Maybe.make.none());

		await cache.load("a");
		expect(cache.peek("a")).toStrictEqual(Maybe.make.some(1));

		vi.setSystemTime(12_000);
		expect(cache.peek("a")).toStrictEqual(Maybe.make.some(1));
		expect(calls).toStrictEqual(["a"]);
	}));

test("invalidate: drops the entry and prevents a late flight from writing", async () => {
	const { load, calls, settle } = makeControlledLoad<never, number>();
	const cache = Cache.make<string, never, number>({ load, ttl: Duration.seconds(10) });

	const pending = cache.load("a");
	cache.invalidate("a");
	settle(0, Result.make.ok(1));

	await expect(pending).resolves.toStrictEqual(Result.make.ok(1));
	expect(cache.size()).toBe(0);
	expect(cache.peek("a")).toStrictEqual(Maybe.make.none());

	const retry = cache.load("a");
	expect(calls).toStrictEqual(["a", "a"]);
	settle(1, Result.make.ok(2));
	await expect(retry).resolves.toStrictEqual(Result.make.ok(2));
	expect(cache.peek("a")).toStrictEqual(Maybe.make.some(2));

	cache.invalidate("absent");
	expect(cache.size()).toBe(1);
});

test("clear: drops every entry and prevents late flights from writing", async () => {
	const { load, calls, settle } = makeControlledLoad<never, number>();
	const cache = Cache.make<string, never, number>({ load, ttl: Duration.seconds(10) });

	const first = cache.load("a");
	const second = cache.load("b");
	cache.clear();
	settle(0, Result.make.ok(1));
	settle(1, Result.make.ok(2));

	await expect(first).resolves.toStrictEqual(Result.make.ok(1));
	await expect(second).resolves.toStrictEqual(Result.make.ok(2));
	expect(cache.size()).toBe(0);
	expect(calls).toStrictEqual(["a", "b"]);

	cache.clear();
	expect(cache.size()).toBe(0);
});

test("size: counts stored entries but not in-flight lookups", async () => {
	const { load, settle } = makeControlledLoad<never, number>();
	const cache = Cache.make<string, never, number>({ load, ttl: Duration.seconds(10) });

	const pending = cache.load("a");
	expect(cache.size()).toBe(0);

	settle(0, Result.make.ok(1));
	await pending;
	expect(cache.size()).toBe(1);
});

test("flush: resolves immediately when no load is running", async () => {
	const { load } = makeImmediateLoad(() => 1);
	const cache = Cache.make<string, never, number>({ load, ttl: Duration.seconds(10) });

	await expect(cache.flush()).resolves.toBeUndefined();
});

test("flush: waits for a load that is running at the call", async () => {
	const { load, settle } = makeControlledLoad<never, number>();
	const cache = Cache.make<string, never, number>({ load, ttl: Duration.seconds(10) });

	const pending = cache.load("a");
	let settled = false;
	const flushing = cache.flush();
	void flushing.then(() => {
		settled = true;
	});
	await Promise.resolve();
	expect(settled).toBe(false);

	settle(0, Result.make.ok(1));
	await flushing;
	await pending;
	expect(settled).toBe(true);
});

// -----------------------------------------------------------------------------
// TTL, staleness, and size normalization
// -----------------------------------------------------------------------------

test("ttl: zero disables storage while single flight still applies", async () => {
	const { load, calls, settle } = makeControlledLoad<never, number>();
	const cache = Cache.make<string, never, number>({ load, ttl: Duration.milliseconds(0) });

	const first = cache.load("a");
	const second = cache.load("a");
	expect(calls).toStrictEqual(["a"]);

	settle(0, Result.make.ok(1));
	await expect(first).resolves.toStrictEqual(Result.make.ok(1));
	await expect(second).resolves.toStrictEqual(Result.make.ok(1));
	expect(cache.size()).toBe(0);
	expect(cache.peek("a")).toStrictEqual(Maybe.make.none());

	void cache.load("a");
	expect(calls).toStrictEqual(["a", "a"]);
});

test("ttl: NaN disables storage", async () => {
	const { load, calls } = makeImmediateLoad(() => 1);
	const cache = Cache.make<string, never, number>({ load, ttl: Duration.milliseconds(Number.NaN) });

	await cache.load("a");
	await cache.load("a");
	expect(calls).toStrictEqual(["a", "a"]);
	expect(cache.size()).toBe(0);
});

test("staleWhileRevalidate: a NaN duration disables the stale window", () =>
	withFakeClock(async () => {
		const { load, calls } = makeImmediateLoad(() => 1);
		const cache = Cache.make<string, never, number>({
			load,
			ttl: Duration.seconds(10),
			staleWhileRevalidate: Duration.milliseconds(Number.NaN),
		});

		await cache.load("a");
		vi.setSystemTime(10_500);
		await cache.load("a");
		expect(calls).toStrictEqual(["a", "a"]);
	}));

test("maxSize: evicts the least recently used entry", async () => {
	const { load } = makeImmediateLoad((key) => key);
	const cache = Cache.make<string, never, string>({ load, ttl: Duration.seconds(10), maxSize: 2 });

	await cache.load("a");
	await cache.load("b");
	await cache.load("a");
	await cache.load("c");

	expect(cache.peek("a")).toStrictEqual(Maybe.make.some("a"));
	expect(cache.peek("b")).toStrictEqual(Maybe.make.none());
	expect(cache.peek("c")).toStrictEqual(Maybe.make.some("c"));
	expect(cache.size()).toBe(2);
});

test("maxSize: zero and negative values disable storage", async () => {
	for (const maxSize of [0, -3]) {
		const { load, calls } = makeImmediateLoad(() => 1);
		const cache = Cache.make<string, never, number>({ load, ttl: Duration.seconds(10), maxSize });

		await cache.load("a");
		await cache.load("a");
		expect(calls).toStrictEqual(["a", "a"]);
		expect(cache.size()).toBe(0);
	}
});

test("maxSize: non-finite values mean unbounded and fractions are floored", async () => {
	for (const maxSize of [Number.NaN, Number.POSITIVE_INFINITY]) {
		const { load } = makeImmediateLoad((key) => key);
		const cache = Cache.make<string, never, string>({ load, ttl: Duration.seconds(10), maxSize });

		await cache.load("a");
		await cache.load("b");
		await cache.load("c");
		expect(cache.size()).toBe(3);
	}

	const { load } = makeImmediateLoad((key) => key);
	const floored = Cache.make<string, never, string>({ load, ttl: Duration.seconds(10), maxSize: 2.9 });

	await floored.load("a");
	await floored.load("b");
	await floored.load("c");
	expect(floored.size()).toBe(2);
});

// -----------------------------------------------------------------------------
// Key mapping
// -----------------------------------------------------------------------------

test("keyBy: keys mapping to the same value share one entry", async () => {
	type Request = { readonly id: string; readonly attempt: number; };
	const calls: Request[] = [];
	const load = (request: Request): Deferred<Result<string, string>> => {
		calls.push(request);
		return Deferred.from.Promise(globalThis.Promise.resolve(Result.make.ok(`user:${request.id}`)));
	};
	const cache = Cache.make({ load, ttl: Duration.seconds(10), keyBy: (request) => request.id });

	await expect(cache.load({ id: "u_1", attempt: 1 })).resolves.toStrictEqual(Result.make.ok("user:u_1"));
	await expect(cache.load({ id: "u_1", attempt: 2 })).resolves.toStrictEqual(Result.make.ok("user:u_1"));
	expect(calls).toHaveLength(1);
	expect(cache.size()).toBe(1);
});

test("make: composes directly with a Batcher", async () => {
	const dispatches: (readonly string[])[] = [];
	const batcher = Batcher.make((keys: readonly string[]): Task.Result<string, ReadonlyMap<string, string>> => {
		dispatches.push(keys);
		return () =>
			Deferred.from.Promise(
				globalThis.Promise.resolve(Result.make.ok(new Map(keys.map((key): [string, string] => [key, key.toUpperCase()])))),
			);
	});
	const cache = Cache.make({
		load: (key: string) =>
			pipe(batcher.load(key), Deferred.map(Batcher.Outcome.to.Result((missing) => `missing:${missing}`))),
		ttl: Duration.seconds(10),
	});

	await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok("A"));
	await expect(cache.load("a")).resolves.toStrictEqual(Result.make.ok("A"));
	expect(dispatches).toStrictEqual([["a"]]);
});

test("flush: waits for a load started while the flush is waiting", async () => {
	const { load, settle } = makeControlledLoad<never, number>();
	const cache = Cache.make<string, never, number>({ load, ttl: Duration.seconds(10) });

	void cache.load("a");
	let settled = false;
	const flushing = cache.flush();
	void flushing.then(() => {
		settled = true;
	});

	void cache.load("b");
	settle(0, Result.make.ok(1));
	await Promise.resolve();
	expect(settled).toBe(false);

	settle(1, Result.make.ok(2));
	await flushing;
	expect(settled).toBe(true);
});
