import { constTruthyBool } from "#test-utils";
import { expect, expectTypeOf, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { Resource } from "../Resource.ts";
import type { Result } from "../Result.ts";
import { Task } from "../Task.ts";

test("use: starts immediately and each use has its own scope", async () => {
	let acquisitions = 0;
	let releases = 0;
	const resource = Resource.make(
		Task.Result.from.Task(() => {
			acquisitions++;
			return Task.make(acquisitions)();
		}),
		() => {
			releases++;
			return Task.make(undefined);
		},
	);

	const first = Resource.use(resource, { run: (value: number) => Task.Result.make.ok(value) });
	const second = Resource.use(resource, { run: (value: number) => Task.Result.make.ok(value) });
	expect(acquisitions).toBe(2);
	const firstResult = await first;
	const secondResult = await second;
	expect(firstResult).toStrictEqual({ kind: "Ok", value: 1 });
	expect(secondResult).toStrictEqual({ kind: "Ok", value: 2 });
	expect(releases).toBe(2);
});

// ---------------------------------------------------------------------------
// make
// ---------------------------------------------------------------------------

test("make: creates a resource with the given acquire and release", async () => {
	const resource = Resource.make(Task.Result.make.ok(42), (_n) => Task.make(undefined));
	const result = await Resource.use(resource, { run: (n: number) => Task.Result.make.ok(n) });
	expect(result).toStrictEqual({ kind: "Ok", value: 42 });
});

// ---------------------------------------------------------------------------
// fromTask
// ---------------------------------------------------------------------------

test("from.Task: wraps an infallible Task as a successful acquire", async () => {
	const resource = Resource.make(Task.Result.from.Task(Task.make(7)), (_n) => Task.make(undefined));
	const result = await Resource.use(resource, { run: (n: number) => Task.Result.make.ok(n) });
	expect(result).toStrictEqual({ kind: "Ok", value: 7 });
	expectTypeOf(resource).toEqualTypeOf<Resource<never, number>>();
});

// ---------------------------------------------------------------------------
// use — happy path
// ---------------------------------------------------------------------------

test("use: passes the acquired value to the function", async () => {
	const resource = Resource.make(Task.Result.make.ok(10), (_n) => Task.make(undefined));
	const result = await Resource.use(resource, { run: (n: number) => Task.Result.make.ok(`value: ${n}`) });
	expect(result).toStrictEqual({ kind: "Ok", value: "value: 10" });
});

test("use: calls release after the function succeeds", async () => {
	let released = false;
	const resource = Resource.make(Task.Result.make.ok(1), (_n) =>
		Task.tryCatch(() => {
			released = true;
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	await Resource.use(resource, { run: (_n: number) => Task.Result.make.ok(undefined) });
	expect(released).toBe(true);
});

test("use: calls release with the acquired value", async () => {
	let releasedWith: number | null = null;
	const resource = Resource.make(Task.Result.make.ok(99), (n) =>
		Task.tryCatch(() => {
			releasedWith = n;
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	await Resource.use(resource, { run: (_n: number) => Task.Result.make.ok(undefined) });
	expect(releasedWith).toBe(99);
});

// ---------------------------------------------------------------------------
// use — error paths
// ---------------------------------------------------------------------------

test("use: calls release even when the function returns Err", async () => {
	let released = false;
	const resource = Resource.make(Task.Result.make.ok(5), (_n) =>
		Task.tryCatch(() => {
			released = true;
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const result = await Resource.use(resource, { run: (_n: number) => Task.Result.make.err("something went wrong") });
	expect(released).toBe(true);
	expect(result).toStrictEqual({ kind: "Err", error: "something went wrong" });
});

test("use: does not call release when acquire fails", async () => {
	let released = false;
	const resource = Resource.make(Task.Result.make.err("cannot connect"), (_n) =>
		Task.tryCatch(() => {
			released = true;
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const result = await Resource.use(resource, { run: (_n: never) => Task.Result.make.ok(undefined) });
	expect(released).toBe(false);
	expect(result).toStrictEqual({ kind: "Err", error: "cannot connect" });
});

test("use: does not call the function when acquire fails", async () => {
	let called = false;
	const resource = Resource.make(Task.Result.make.err("cannot connect"), (_n) => Task.make(undefined));
	await Resource.use(resource, {
		run: (_n: never) => {
			called = true;
			return Task.Result.make.ok(undefined);
		},
	});
	expect(called).toBe(false);
});

test("use: propagates acquire error unchanged", async () => {
	const resource = Resource.make(Task.Result.make.err("auth failed"), (_n) => Task.make(undefined));
	const result = await Resource.use(resource, { run: (_n: never) => Task.Result.make.ok(undefined) });
	expect(result).toStrictEqual({ kind: "Err", error: "auth failed" });
});

test("use: infers union error type E1 | E2 without type annotations", async () => {
	const acquireTask: Task.Result<"acquire-err", number> = Task.Result.make.ok(42);
	const resource = Resource.make(acquireTask, (_n) => Task.make(undefined));
	const resultTask = Resource.use(resource, {
		run: (n: number): Task.Result<"use-err", string> => Task.Result.make.ok(`val: ${n}`),
	});
	const result = await resultTask;
	expect(result).toStrictEqual({ kind: "Ok", value: "val: 42" });
	expectTypeOf(result).toEqualTypeOf<Result<"acquire-err" | "use-err", string>>();
});

// ---------------------------------------------------------------------------
// combine
// ---------------------------------------------------------------------------

test("combine: presents both acquired values as a tuple", async () => {
	const rA = Resource.make(Task.Result.make.ok(1), (_n) => Task.make(undefined));
	const rB = Resource.make(Task.Result.make.ok("x"), (_s) => Task.make(undefined));
	const result = await Resource.use(Resource.combine(rA, rB), {
		run: ([n, s]: readonly [number, string]) => Task.Result.make.ok(`${n}+${s}`),
	});
	expect(result).toStrictEqual({ kind: "Ok", value: "1+x" });
});

test("combine: releases second resource before first", async () => {
	const order: string[] = [];
	const rA = Resource.make(Task.Result.make.ok("A"), (_s) =>
		Task.tryCatch(() => {
			order.push("release-A");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const rB = Resource.make(Task.Result.make.ok("B"), (_s) =>
		Task.tryCatch(() => {
			order.push("release-B");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	await Resource.use(Resource.combine(rA, rB), {
		run: (_pair: readonly [string, string]) => Task.Result.make.ok(undefined),
	});
	expect(order).toStrictEqual(["release-B", "release-A"]);
});

test("combine: releases first resource when second acquire fails", async () => {
	let releasedA = false;
	const rA = Resource.make(Task.Result.make.ok("A"), (_s) =>
		Task.tryCatch(() => {
			releasedA = true;
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const rB = Resource.make(Task.Result.make.err("B failed"), (_s) => Task.make(undefined));
	const result = await Resource.use(Resource.combine(rA, rB), {
		run: (_pair: readonly [string, never]) => Task.Result.make.ok(undefined),
	});
	expect(releasedA).toBe(true);
	expect(result).toStrictEqual({ kind: "Err", error: "B failed" });
});

test("combine: does not call resourceB acquire when resourceA acquire fails", async () => {
	let calledB = false;
	const rA = Resource.make(Task.Result.make.err("A failed"), (_s) => Task.make(undefined));
	const rB = Resource.make(
		Task.Result.tryCatch(() => {
			calledB = true;
			return Promise.resolve("B");
		}, { onError: () => "B error" }),
		(_s) => Task.make(undefined),
	);

	const result = await Resource.use(Resource.combine(rA, rB), {
		run: (_pair: readonly [never, string]) => Task.Result.make.ok(undefined),
	});

	expect(calledB).toBe(false);
	expect(result).toStrictEqual({ kind: "Err", error: "A failed" });
});

test("combine: infers union error type E1 | E2 for disparate error types", async () => {
	const acquireA: Task.Result<"errA", number> = Task.Result.make.ok(1);
	const acquireB: Task.Result<"errB", string> = Task.Result.make.ok("x");
	const rA = Resource.make(acquireA, (_n) => Task.make(undefined));
	const rB = Resource.make(acquireB, (_s) => Task.make(undefined));
	const combined = Resource.combine(rA, rB);

	expectTypeOf(combined).toEqualTypeOf<Resource<"errA" | "errB", readonly [number, string]>>();
	const result = await Resource.use(combined, { run: (pair: readonly [number, string]) => Task.Result.make.ok(pair) });
	expect(result).toStrictEqual({ kind: "Ok", value: [1, "x"] });
});

test("combine: does not call the function when first acquire fails", async () => {
	let called = false;
	const rA = Resource.make(Task.Result.make.err("A failed"), (_s) => Task.make(undefined));
	const rB = Resource.make(Task.Result.make.ok("B"), (_s) => Task.make(undefined));
	await Resource.use(Resource.combine(rA, rB), {
		run: (_pair: readonly [never, string]) => {
			called = true;
			return Task.Result.make.ok(undefined);
		},
	});
	expect(called).toBe(false);
});

// ---------------------------------------------------------------------------
// pipe composition
// ---------------------------------------------------------------------------

test("pipe: composes with Task.Result operations inside use", async () => {
	const resource = Resource.make(Task.Result.make.ok(5), (_n) => Task.make(undefined));
	const result = await Resource.use(resource, {
		run: (n: number) =>
			pipe(
				Task.Result.make.ok(n),
				Task.Result.map((x) => x * 2),
				Task.Result.chain((x) => x > 5 ? Task.Result.make.ok(x) : Task.Result.make.err("too small")),
			),
	});
	expect(result).toStrictEqual({ kind: "Ok", value: 10 });
});

test("use: works with fromTask resource", async () => {
	let released = false;
	const resource = Resource.make(Task.Result.from.Task(Task.make("handle")), (_s) =>
		Task.tryCatch(() => {
			released = true;
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const result = await Resource.use(resource, { run: (handle: string) => Task.Result.make.ok(`used: ${handle}`) });
	expect(result).toStrictEqual({ kind: "Ok", value: "used: handle" });
	expect(released).toBe(true);
});

// ---------------------------------------------------------------------------
// abort propagation
// ---------------------------------------------------------------------------

test("use: propagates AbortSignal down to acquire f and release", async () => {
	let acquireSignal: AbortSignal | undefined;
	let fSignal: AbortSignal | undefined;
	let releaseSignal: AbortSignal | undefined;

	const resource = Resource.make((signal) => {
		acquireSignal = signal;
		return Task.Result.make.ok(42)(signal);
	}, (_n) => (signal) => {
		releaseSignal = signal;
		return Task.make(undefined)(signal);
	});

	const controller = new AbortController();
	const result = await Resource.use(resource, {
		run: (n: number) => (signal) => {
			fSignal = signal;
			return Task.Result.make.ok(`val: ${n}`)(signal);
		},
		signal: controller.signal,
	});

	expect(result).toStrictEqual({ kind: "Ok", value: "val: 42" });
	expect(acquireSignal).toBe(controller.signal);
	expect(fSignal).toBe(controller.signal);
	expect(releaseSignal).toBe(controller.signal);
});

test("combine: propagates AbortSignal down to both acquisitions and releases", async () => {
	let acquireASignal: AbortSignal | undefined;
	let acquireBSignal: AbortSignal | undefined;
	let releaseASignal: AbortSignal | undefined;
	let releaseBSignal: AbortSignal | undefined;

	const resourceA = Resource.make((signal) => {
		acquireASignal = signal;
		return Task.Result.make.ok("A")(signal);
	}, (_s) => (signal) => {
		releaseASignal = signal;
		return Task.make(undefined)(signal);
	});

	const resourceB = Resource.make((signal) => {
		acquireBSignal = signal;
		return Task.Result.make.ok("B")(signal);
	}, (_s) => (signal) => {
		releaseBSignal = signal;
		return Task.make(undefined)(signal);
	});

	const controller = new AbortController();
	const combined = Resource.combine(resourceA, resourceB);

	const result = await Resource.use(combined, {
		run: ([a, b]: readonly [string, string]) => Task.Result.make.ok(`${a}+${b}`),
		signal: controller.signal,
	});

	expect(result).toStrictEqual({ kind: "Ok", value: "A+B" });
	expect(acquireASignal).toBe(controller.signal);
	expect(acquireBSignal).toBe(controller.signal);
	expect(releaseASignal).toBe(controller.signal);
	expect(releaseBSignal).toBe(controller.signal);
});

// ---------------------------------------------------------------------------
// map
// ---------------------------------------------------------------------------

test("map: transforms the acquired value and runs release when use completes", async () => {
	let released = false;
	const resource = Resource.make(Task.Result.make.ok({ host: "db.local", port: 5432 }), (_cfg) =>
		Task.tryCatch(() => {
			released = true;
			return Promise.resolve(undefined);
		}, { onError: () => {} }));

	const mapped = pipe(resource, Resource.map((cfg) => cfg.port));

	const result = await Resource.use(mapped, { run: (port: number) => Task.Result.make.ok(`connected to ${port}`) });

	expect(result).toStrictEqual({ kind: "Ok", value: "connected to 5432" });
	expect(released).toBe(true);
});

test("map: runs release even when consume returns Err", async () => {
	let released = false;
	const resource = Resource.make(Task.Result.make.ok(42), (_n) =>
		Task.tryCatch(() => {
			released = true;
			return Promise.resolve(undefined);
		}, { onError: () => {} }));

	const mapped = pipe(resource, Resource.map((n) => `num:${n}`));

	const result = await Resource.use(mapped, { run: (_s: string) => Task.Result.make.err("work failed") });

	expect(result).toStrictEqual({ kind: "Err", error: "work failed" });
	expect(released).toBe(true);
});

test("map: chains multiple transforms in pipeline", async () => {
	let released = false;
	const resource = Resource.make(Task.Result.make.ok(10), (_n) =>
		Task.tryCatch(() => {
			released = true;
			return Promise.resolve(undefined);
		}, { onError: () => {} }));

	const mapped = pipe(resource, Resource.map((n) => n * 2), Resource.map((n) => `final:${n}`));

	const result = await Resource.use(mapped, { run: (s: string) => Task.Result.make.ok(s) });

	expect(result).toStrictEqual({ kind: "Ok", value: "final:20" });
	expect(released).toBe(true);
});

test("map: does not call transform or release when acquire fails", async () => {
	let called = false;
	let released = false;
	const resource = Resource.make(
		constTruthyBool() ? Task.Result.make.err("acquire failed") : Task.Result.make.ok("sample"),
		(_s) =>
			Task.tryCatch(() => {
				released = true;
				return Promise.resolve(undefined);
			}, { onError: () => {} }),
	);

	const mapped = pipe(
		resource,
		Resource.map((s) => {
			called = true;
			return s.toUpperCase();
		}),
	);

	const result = await Resource.use(mapped, { run: (s: string) => Task.Result.make.ok(s) });

	expect(result).toStrictEqual({ kind: "Err", error: "acquire failed" });
	expect(called).toBe(false);
	expect(released).toBe(false);
});

// ---------------------------------------------------------------------------
// chain
// ---------------------------------------------------------------------------

test("chain: sequences dependent acquisition and releases in strict reverse LIFO order", async () => {
	const order: string[] = [];
	const openTunnel = Resource.make(Task.Result.make.ok({ port: 9000 }), (_t) =>
		Task.tryCatch(() => {
			order.push("close-tunnel");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));

	const connectDb = (port: number) =>
		Resource.make(Task.Result.make.ok(`db-conn-on-${port}`), (_db) =>
			Task.tryCatch(() => {
				order.push("close-db");
				return Promise.resolve(undefined);
			}, { onError: () => {} }));

	const chained = pipe(openTunnel, Resource.chain((tunnel) => connectDb(tunnel.port)));

	const result = await Resource.use(chained, {
		run: (db: string) => {
			order.push(`use:${db}`);
			return Task.Result.make.ok("success");
		},
	});

	expect(result).toStrictEqual({ kind: "Ok", value: "success" });
	expect(order).toStrictEqual(["use:db-conn-on-9000", "close-db", "close-tunnel"]);
});

test("chain: partial acquisition rollback releases outer resource when inner acquire fails", async () => {
	let tunnelReleased = false;
	const openTunnel = Resource.make(Task.Result.make.ok({ port: 9000 }), (_t) =>
		Task.tryCatch(() => {
			tunnelReleased = true;
			return Promise.resolve(undefined);
		}, { onError: () => {} }));

	const connectDb = (_port: number) =>
		Resource.make(Task.Result.make.err("db auth failed"), (_db) => Task.make(undefined));

	const chained = pipe(openTunnel, Resource.chain((tunnel) => connectDb(tunnel.port)));

	let workCalled = false;
	const result = await Resource.use(chained, {
		run: (_db: never) => {
			workCalled = true;
			return Task.Result.make.ok("not reached");
		},
	});

	expect(result).toStrictEqual({ kind: "Err", error: "db auth failed" });
	expect(workCalled).toBe(false);
	expect(tunnelReleased).toBe(true);
});

test("chain: runs both releases in reverse LIFO order when consume returns Err", async () => {
	const order: string[] = [];
	const openOuter = Resource.make(Task.Result.make.ok("outer"), (_o) =>
		Task.tryCatch(() => {
			order.push("rel-outer");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));

	const openInner = (o: string) =>
		Resource.make(Task.Result.make.ok(`${o}-inner`), (_i) =>
			Task.tryCatch(() => {
				order.push("rel-inner");
				return Promise.resolve(undefined);
			}, { onError: () => {} }));

	const chained = pipe(openOuter, Resource.chain((o) => openInner(o)));

	const result = await Resource.use(chained, { run: (_val: string) => Task.Result.make.err("work failed") });

	expect(result).toStrictEqual({ kind: "Err", error: "work failed" });
	expect(order).toStrictEqual(["rel-inner", "rel-outer"]);
});

test("chain: sequences three dependent resources in LIFO order", async () => {
	const order: string[] = [];
	const r1 = Resource.make(Task.Result.make.ok(1), (_n) =>
		Task.tryCatch(() => {
			order.push("rel-1");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const r2 = (n: number) =>
		Resource.make(Task.Result.make.ok(n + 1), (_n) =>
			Task.tryCatch(() => {
				order.push("rel-2");
				return Promise.resolve(undefined);
			}, { onError: () => {} }));
	const r3 = (n: number) =>
		Resource.make(Task.Result.make.ok(n * 10), (_n) =>
			Task.tryCatch(() => {
				order.push("rel-3");
				return Promise.resolve(undefined);
			}, { onError: () => {} }));

	const chained = pipe(r1, Resource.chain(r2), Resource.chain(r3));

	const result = await Resource.use(chained, { run: (n: number) => Task.Result.make.ok(`val:${n}`) });

	expect(result).toStrictEqual({ kind: "Ok", value: "val:20" });
	expect(order).toStrictEqual(["rel-3", "rel-2", "rel-1"]);
});

test("chain: does not invoke transform or inner acquire when outer acquire fails", async () => {
	let transformCalled = false;
	const openOuter = Resource.make(Task.Result.make.err("outer failed"), (_o) => Task.make(undefined));

	const chained = pipe(
		openOuter,
		Resource.chain((_o) => {
			transformCalled = true;
			return Resource.make(Task.Result.make.ok(42), () => Task.make(undefined));
		}),
	);

	const result = await Resource.use(chained, { run: (n: number) => Task.Result.make.ok(n) });

	expect(result).toStrictEqual({ kind: "Err", error: "outer failed" });
	expect(transformCalled).toBe(false);
});

// ---------------------------------------------------------------------------
// all — tuple
// ---------------------------------------------------------------------------

test("all: acquires a tuple of resources sequentially and releases in reverse order", async () => {
	const order: string[] = [];
	const r1 = Resource.make(Task.Result.make.ok(1), (_n) =>
		Task.tryCatch(() => {
			order.push("rel-1");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const r2 = Resource.make(Task.Result.make.ok("two"), (_s) =>
		Task.tryCatch(() => {
			order.push("rel-2");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const r3 = Resource.make(Task.Result.make.ok(true), (_b) =>
		Task.tryCatch(() => {
			order.push("rel-3");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));

	const allTuple = Resource.all([r1, r2, r3]);

	const result = await Resource.use(allTuple, {
		run: ([one, two, three]: readonly [number, string, boolean]) => {
			order.push(`use:${one},${two},${three}`);
			return Task.Result.make.ok("done");
		},
	});

	expect(result).toStrictEqual({ kind: "Ok", value: "done" });
	expect(order).toStrictEqual(["use:1,two,true", "rel-3", "rel-2", "rel-1"]);
});

test("all: rolls back already-acquired tuple resources in reverse order if a middle resource fails", async () => {
	const order: string[] = [];
	const r1 = Resource.make(Task.Result.make.ok(1), (_n) =>
		Task.tryCatch(() => {
			order.push("rel-1");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const r2 = Resource.make(Task.Result.make.ok(2), (_n) =>
		Task.tryCatch(() => {
			order.push("rel-2");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const r3 = Resource.make(Task.Result.make.err("r3 failed"), (_s) =>
		Task.tryCatch(() => {
			order.push("rel-3");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	let r4Called = false;
	const r4 = Resource.make(
		Task.Result.tryCatch(() => {
			r4Called = true;
			return Promise.resolve(4);
		}, { onError: () => "r4 error" }),
		() => Task.make(undefined),
	);

	const allTuple = Resource.all([r1, r2, r3, r4]);

	const result = await Resource.use(allTuple, {
		run: (_items: readonly [number, number, never, number]) => Task.Result.make.ok("unreachable"),
	});

	expect(result).toStrictEqual({ kind: "Err", error: "r3 failed" });
	expect(r4Called).toBe(false);
	expect(order).toStrictEqual(["rel-2", "rel-1"]);
});

test("all: releases all tuple resources in reverse order when consume returns Err", async () => {
	const order: string[] = [];
	const r1 = Resource.make(Task.Result.make.ok(1), (_n) =>
		Task.tryCatch(() => {
			order.push("rel-1");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const r2 = Resource.make(Task.Result.make.ok(2), (_n) =>
		Task.tryCatch(() => {
			order.push("rel-2");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));

	const allTuple = Resource.all([r1, r2]);

	const result = await Resource.use(allTuple, {
		run: (_items: readonly [number, number]) => Task.Result.make.err("work error"),
	});

	expect(result).toStrictEqual({ kind: "Err", error: "work error" });
	expect(order).toStrictEqual(["rel-2", "rel-1"]);
});

test("all: empty tuple acquires empty array without error", async () => {
	const empty = Resource.all([]);
	const result = await Resource.use(empty, { run: (items: readonly []) => Task.Result.make.ok(items.length) });
	expect(result).toStrictEqual({ kind: "Ok", value: 0 });
});

// ---------------------------------------------------------------------------
// all — named record
// ---------------------------------------------------------------------------

test("all: acquires record resources in key order and releases in reverse LIFO order", async () => {
	const order: string[] = [];
	const db = Resource.make(Task.Result.make.ok("db-handle"), (_d) =>
		Task.tryCatch(() => {
			order.push("rel-db");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const redis = Resource.make(Task.Result.make.ok("redis-handle"), (_r) =>
		Task.tryCatch(() => {
			order.push("rel-redis");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const s3 = Resource.make(Task.Result.make.ok("s3-handle"), (_s) =>
		Task.tryCatch(() => {
			order.push("rel-s3");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));

	const appInfra = Resource.all({ db, redis, s3 });

	const result = await Resource.use(appInfra, {
		run: ({ db: d, redis: r, s3: s }: { readonly db: string; readonly redis: string; readonly s3: string; }) => {
			order.push(`use:${d},${r},${s}`);
			return Task.Result.make.ok("ok");
		},
	});

	expect(result).toStrictEqual({ kind: "Ok", value: "ok" });
	expect(order).toStrictEqual(["use:db-handle,redis-handle,s3-handle", "rel-s3", "rel-redis", "rel-db"]);
});

test("all: rolls back already-acquired record resources in reverse order when a record field fails", async () => {
	const order: string[] = [];
	const db = Resource.make(Task.Result.make.ok("db-handle"), (_d) =>
		Task.tryCatch(() => {
			order.push("rel-db");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const redis = Resource.make(Task.Result.make.err("redis connection refused"), (_r) =>
		Task.tryCatch(() => {
			order.push("rel-redis");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	let s3Acquired = false;
	const s3 = Resource.make(
		Task.Result.tryCatch(() => {
			s3Acquired = true;
			return Promise.resolve("s3-handle");
		}, { onError: () => "s3 err" }),
		() => Task.make(undefined),
	);

	const appInfra = Resource.all({ db, redis, s3 });

	const result = await Resource.use(appInfra, {
		run: (_infra: { readonly db: string; readonly redis: never; readonly s3: string; }) =>
			Task.Result.make.ok("never reached"),
	});

	expect(result).toStrictEqual({ kind: "Err", error: "redis connection refused" });
	expect(s3Acquired).toBe(false);
	expect(order).toStrictEqual(["rel-db"]);
});

test("all: releases all record resources in reverse order when consume returns Err", async () => {
	const order: string[] = [];
	const resA = Resource.make(Task.Result.make.ok("A"), () =>
		Task.tryCatch(() => {
			order.push("rel-A");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));
	const resB = Resource.make(Task.Result.make.ok("B"), () =>
		Task.tryCatch(() => {
			order.push("rel-B");
			return Promise.resolve(undefined);
		}, { onError: () => {} }));

	const appInfra = Resource.all({ a: resA, b: resB });

	const result = await Resource.use(appInfra, {
		run: (_infra: { readonly a: string; readonly b: string; }) => Task.Result.make.err("work error"),
	});

	expect(result).toStrictEqual({ kind: "Err", error: "work error" });
	expect(order).toStrictEqual(["rel-B", "rel-A"]);
});

// ---------------------------------------------------------------------------
// end-to-end multi-resource pipeline
// ---------------------------------------------------------------------------

test("pipe: end-to-end multi-layer infrastructure pipeline from API_ROADMAP.md", async () => {
	const lifecycle: string[] = [];

	const openSshTunnel = (host: string) =>
		Resource.make(Task.Result.make.ok({ host, localPort: 5433 }), (t) =>
			Task.tryCatch(() => {
				lifecycle.push(`close-tunnel:${t.localPort}`);
				return Promise.resolve(undefined);
			}, { onError: () => {} }));

	const connectPostgres = (opts: { host: string; port: number; }) =>
		Resource.make(Task.Result.make.ok({ client: `pg-${opts.host}:${opts.port}` }), (db) =>
			Task.tryCatch(() => {
				lifecycle.push(`close-pg:${db.client}`);
				return Promise.resolve(undefined);
			}, { onError: () => {} }));

	const acquireAdvisoryLock = (db: { client: string; }, lockName: string) =>
		Resource.make(Task.Result.make.ok({ lockName, heldOn: db.client }), (lock) =>
			Task.tryCatch(() => {
				lifecycle.push(`release-lock:${lock.lockName}`);
				return Promise.resolve(undefined);
			}, { onError: () => {} }));

	const migrationResource = pipe(
		openSshTunnel("bastion.prod.internal"),
		Resource.chain((tunnel) =>
			pipe(
				connectPostgres({ host: "127.0.0.1", port: tunnel.localPort }),
				Resource.chain((db) => pipe(acquireAdvisoryLock(db, "migrations"), Resource.map((lock) => ({ tunnel, db, lock })))),
			)
		),
	);

	const connectRedis = (url: string) =>
		Resource.make(Task.Result.make.ok({ redis: url }), (r) =>
			Task.tryCatch(() => {
				lifecycle.push(`close-redis:${r.redis}`);
				return Promise.resolve(undefined);
			}, { onError: () => {} }));

	const appInfra = Resource.all({ migration: migrationResource, redis: connectRedis("redis://127.0.0.1:6379") });

	const result = await Resource.use(appInfra, {
		run: (
			{ migration, redis }: {
				readonly migration: {
					readonly tunnel: { readonly host: string; readonly localPort: number; };
					readonly db: { readonly client: string; };
					readonly lock: { readonly lockName: string; readonly heldOn: string; };
				};
				readonly redis: { readonly redis: string; };
			},
		) => {
			lifecycle.push(`run-migration:${migration.db.client}-${redis.redis}`);
			return Task.Result.make.ok("migrated_successfully");
		},
	});

	expect(result).toStrictEqual({ kind: "Ok", value: "migrated_successfully" });
	expect(lifecycle).toStrictEqual([
		"run-migration:pg-127.0.0.1:5433-redis://127.0.0.1:6379",
		"close-redis:redis://127.0.0.1:6379",
		"release-lock:migrations",
		"close-pg:pg-127.0.0.1:5433",
		"close-tunnel:5433",
	]);
});
