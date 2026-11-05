import { expect, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { Duration } from "../../Types/Duration.ts";
import { RetryPolicy } from "../../Types/RetryPolicy.ts";
import { Deferred } from "../Deferred.ts";
import { Maybe } from "../Maybe.ts";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";

// ---------------------------------------------------------------------------
// make
// ---------------------------------------------------------------------------

test("make.ok: creates a Task that resolves to Ok", async () => {
	const okTask = Task.Result.make.ok<number>(42);
	const result = await okTask();
	expect(result).toStrictEqual({ kind: "Ok", value: 42 });
});

test("make.err: creates a Task that resolves to Err", async () => {
	const errTask = Task.Result.make.err<string>("error");
	const result = await errTask();
	expect(result).toStrictEqual({ kind: "Err", error: "error" });
});

// ---------------------------------------------------------------------------
// tryCatch
// ---------------------------------------------------------------------------

test("tryCatch: returns Ok when Promise resolves", async () => {
	const result = await Task.Result.tryCatch(() => Promise.resolve(42), { onError: (e) => `Error: ${e}` })();
	expect(result).toStrictEqual({ kind: "Ok", value: 42 });
});

test("tryCatch: returns Err when Promise rejects", async () => {
	const result = await Task.Result.tryCatch(() => Promise.reject(new Error("boom")), {
		onError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
	})();
	expect(result).toStrictEqual({ kind: "Err", error: "boom" });
});

test("tryCatch: catches synchronous throws in async functions", async () => {
	const result = await Task.Result.tryCatch(
		// oxlint-disable-next-line require-await
		async () => {
			throw new Error("sync throw");
		},
		{ onError: (e) => (e instanceof Error ? e.message : String(e)) },
	)();
	expect(result).toStrictEqual({ kind: "Err", error: "sync throw" });
});

// ---------------------------------------------------------------------------
// map
// ---------------------------------------------------------------------------

test("map: transforms Ok value", async () => {
	const result = await pipe(Task.Result.make.ok(5), Task.Result.map((n: number) => n * 2))();
	expect(result).toStrictEqual({ kind: "Ok", value: 10 });
});

test("map: passes through Err unchanged without calling transform", async () => {
	let called = false;
	const result = await pipe(
		Task.Result.make.err("error"),
		Task.Result.map((n: number) => {
			called = true;
			return n * 2;
		}),
	)();
	expect(called).toBe(false);
	expect(result).toStrictEqual({ kind: "Err", error: "error" });
});

test("map: can change value type", async () => {
	const result = await pipe(Task.Result.make.ok(42), Task.Result.map((n: number) => `num: ${n}`))();
	expect(result).toStrictEqual({ kind: "Ok", value: "num: 42" });
});

// ---------------------------------------------------------------------------
// mapError
// ---------------------------------------------------------------------------

test("mapError: transforms Err value", async () => {
	const result = await pipe(Task.Result.make.err("oops"), Task.Result.mapError((e: string) => e.toUpperCase()))();
	expect(result).toStrictEqual({ kind: "Err", error: "OOPS" });
});

test("mapError: passes through Ok unchanged without calling transform", async () => {
	let called = false;
	const result = await pipe(
		Task.Result.make.ok(5),
		Task.Result.mapError((e: string) => {
			called = true;
			return e.toUpperCase();
		}),
	)();
	expect(called).toBe(false);
	expect(result).toStrictEqual({ kind: "Ok", value: 5 });
});

// ---------------------------------------------------------------------------
// chain
// ---------------------------------------------------------------------------

test("chain: applies function when Ok", async () => {
	const validatePositive = (n: number): Task.Result<string, number> =>
		n > 0 ? Task.Result.make.ok(n) : Task.Result.make.err("Must be positive");

	const result = await pipe(Task.Result.make.ok(5), Task.Result.chain(validatePositive))();
	expect(result).toStrictEqual({ kind: "Ok", value: 5 });
});

test("chain: returns Err when function returns Err", async () => {
	const validatePositive = (n: number): Task.Result<string, number> =>
		n > 0 ? Task.Result.make.ok(n) : Task.Result.make.err("Must be positive");

	const result = await pipe(Task.Result.make.ok(-1), Task.Result.chain(validatePositive))();
	expect(result).toStrictEqual({ kind: "Err", error: "Must be positive" });
});

test("chain: propagates Err without calling function", async () => {
	let called = false;
	const result = await pipe(
		Task.Result.make.err("error"),
		Task.Result.chain((_n: number) => {
			called = true;
			return Task.Result.make.ok(_n);
		}),
	)();
	expect(called).toBe(false);
	expect(result).toStrictEqual({ kind: "Err", error: "error" });
});

test("chain: composes multiple async steps", async () => {
	const result = await pipe(
		Task.Result.make.ok(1),
		Task.Result.chain((n: number) => Task.Result.make.ok(n + 1)),
		Task.Result.chain((n: number) => Task.Result.make.ok(n * 10)),
	)();
	expect(result).toStrictEqual({ kind: "Ok", value: 20 });
});

// ---------------------------------------------------------------------------
// match (data-last)
// ---------------------------------------------------------------------------

test("match: calls ok handler for Ok", async () => {
	const result = await pipe(
		Task.Result.make.ok(5),
		Task.Result.match({ ok: (n: number) => `got ${n}`, err: (e: string) => `failed: ${e}` }),
	)();
	expect(result).toBe("got 5");
});

test("match: calls err handler for Err", async () => {
	const result = await pipe(
		Task.Result.make.err("bad"),
		Task.Result.match({ ok: (n: number) => `got ${n}`, err: (e: string) => `failed: ${e}` }),
	)();
	expect(result).toBe("failed: bad");
});

test("match: is data-last (returns a function first)", async () => {
	const handler = Task.Result.match<string, number, string>({ ok: (n) => `val: ${n}`, err: (e) => `err: ${e}` });
	const okResult = await handler(Task.Result.make.ok(3))();
	expect(okResult).toBe("val: 3");
	const errResult = await handler(Task.Result.make.err("x"))();
	expect(errResult).toBe("err: x");
});

// ---------------------------------------------------------------------------
// recover
// ---------------------------------------------------------------------------

test("recover: returns original Ok without calling fallback", async () => {
	let called = false;
	const result = await pipe(
		Task.Result.make.ok(5),
		Task.Result.recover((_e: string) => {
			called = true;
			return Task.Result.make.ok(99);
		}),
	)();
	expect(called).toBe(false);
	expect(result).toStrictEqual({ kind: "Ok", value: 5 });
});

test("recover: provides fallback for Err", async () => {
	const result = await pipe(
		Task.Result.make.err("error"),
		Task.Result.recover((_e: string) => Task.Result.make.ok(99)),
	)();
	expect(result).toStrictEqual({ kind: "Ok", value: 99 });
});

test("recover: widens return type when fallback returns different type", async () => {
	const result = await pipe(
		Task.Result.make.err("error"),
		Task.Result.recover((_e) => Task.Result.make.ok("recovered")),
	)();
	expect(result).toStrictEqual({ kind: "Ok", value: "recovered" });
});

test("recover: preserves Ok typed as union", async () => {
	const result = await pipe(Task.Result.make.ok(5), Task.Result.recover((_e) => Task.Result.make.ok("recovered")))();
	expect(result).toStrictEqual({ kind: "Ok", value: 5 });
});

test("recover: passes error to fallback function", async () => {
	let receivedError = "";
	await pipe(
		Task.Result.make.err("original error"),
		Task.Result.recover((e: string) => {
			receivedError = e;
			return Task.Result.make.ok(0);
		}),
	)();
	expect(receivedError).toBe("original error");
});

// ---------------------------------------------------------------------------
// getOrElse
// ---------------------------------------------------------------------------

test("getOrElse: returns value for Ok", async () => {
	const result = await pipe(Task.Result.make.ok(5), Task.Result.getOrElse(() => 0))();
	expect(result).toBe(5);
});

test("getOrElse: returns default for Err", async () => {
	const result = await pipe(Task.Result.make.err("error"), Task.Result.getOrElse(() => 0))();
	expect(result).toBe(0);
});

test("getOrElse: widens return type to union when default is different type", async () => {
	const result = await pipe(Task.Result.make.err("error"), Task.Result.getOrElse(() => null))();
	expect(result).toBeNull();
});

test("getOrElse: returns Ok value typed as union when Ok", async () => {
	const result = await pipe(Task.Result.make.ok(5), Task.Result.getOrElse(() => null))();
	expect(result).toBe(5);
});

// ---------------------------------------------------------------------------
// tap
// ---------------------------------------------------------------------------

test("tap: executes side effect on Ok and returns original", async () => {
	let sideEffect = 0;
	const result = await pipe(
		Task.Result.make.ok(5),
		Task.Result.tap((n: number) => {
			sideEffect = n;
		}),
	)();
	expect(sideEffect).toBe(5);
	expect(result).toStrictEqual({ kind: "Ok", value: 5 });
});

test("tap: does not execute side effect on Err", async () => {
	let called = false;
	const result = await pipe(
		Task.Result.make.err("error"),
		Task.Result.tap((_n: number) => {
			called = true;
		}),
	)();
	expect(called).toBe(false);
	expect(result).toStrictEqual({ kind: "Err", error: "error" });
});

// ---------------------------------------------------------------------------
// pipe composition
// ---------------------------------------------------------------------------

test("pipe: composes well in a pipeline", async () => {
	const result = await pipe(
		Task.Result.make.ok(5),
		Task.Result.map((n: number) => n * 2),
		Task.Result.chain((n: number) => n > 5 ? Task.Result.make.ok(n) : Task.Result.make.err("Too small")),
		Task.Result.getOrElse(() => 0),
	)();
	expect(result).toBe(10);
});

test("pipe: short-circuits on Err", async () => {
	const result = await pipe(
		Task.Result.make.ok(2),
		Task.Result.map((n: number) => n * 2),
		Task.Result.chain((n: number) => n > 5 ? Task.Result.make.ok(n) : Task.Result.make.err("Too small")),
		Task.Result.getOrElse(() => 0),
	)();
	expect(result).toBe(0);
});

test("tryCatch: integrates with pipe chain", async () => {
	const result = await pipe(
		Task.Result.tryCatch(() => Promise.resolve(42), { onError: (e) => `Error: ${e}` }),
		Task.Result.map((n: number) => n + 8),
		Task.Result.getOrElse(() => 0),
	)();
	expect(result).toBe(50);
});

// ---------------------------------------------------------------------------
// tryCatch — signal threading
// ---------------------------------------------------------------------------

test("tryCatch: receives AbortSignal from call site", async () => {
	const controller = new AbortController();
	let receivedSignal: AbortSignal | undefined;
	const task = Task.Result.tryCatch((signal) => {
		receivedSignal = signal;
		return Promise.resolve(42);
	}, { onError: String });
	await task(controller.signal);
	expect(receivedSignal).toBe(controller.signal);
});

// ---------------------------------------------------------------------------
// composition scenarios
// ---------------------------------------------------------------------------

test("recover: value flows into subsequent map steps", async () => {
	const result = await pipe(
		Task.Result.make.err("not found"),
		Task.Result.recover((_e: string) => Task.Result.make.ok(0)),
		Task.Result.map((n: number) => n + 1),
	)();
	expect(result).toStrictEqual({ kind: "Ok", value: 1 });
});

test("mapError: normalizes error type before recover acts on it", async () => {
	type ApiError = { code: number; msg: string; };
	const result = await pipe(
		Task.Result.tryCatch(() => Promise.reject(new Error("service unavailable")), {
			onError: (e) => (e instanceof Error ? e.message : String(e)),
		}),
		Task.Result.mapError((msg: string): ApiError => ({ code: 503, msg })),
		Task.Result.recover((e: ApiError) => e.code >= 500 ? Task.Result.make.ok("cached") : Task.Result.make.err(e)),
		Task.Result.getOrElse(() => "none"),
	)();
	expect(result).toBe("cached");
});

test("tap: runs side effect at correct point in chain", async () => {
	const log: number[] = [];
	const result = await pipe(
		Task.Result.make.ok(5),
		Task.Result.tap((n: number) => log.push(n)),
		Task.Result.chain((n: number) => Task.Result.make.ok(n * 2)),
		Task.Result.map((n: number) => n + 1),
	)();
	expect(result).toStrictEqual({ kind: "Ok", value: 11 });
	expect(log).toStrictEqual([5]); // tap sees the pre-chain value
});

test("match: handles ok path at end of composed chain", async () => {
	const result = await pipe(
		Task.Result.tryCatch(() => Promise.resolve(10), { onError: String }),
		Task.Result.map((n: number) => n * 2),
		Task.Result.chain((n: number) => n > 15 ? Task.Result.make.ok(n) : Task.Result.make.err("too small")),
		Task.Result.match({ ok: (n: number) => `val:${n}`, err: (e: string) => `err:${e}` }),
	)();
	expect(result).toBe("val:20");
});

test("match: handles err path at end of composed chain", async () => {
	const result = await pipe(
		Task.Result.tryCatch(() => Promise.resolve(5), { onError: String }),
		Task.Result.map((n: number) => n * 2),
		Task.Result.chain((n: number) => n > 15 ? Task.Result.make.ok(n) : Task.Result.make.err("too small")),
		Task.Result.match({ ok: (n: number) => `val:${n}`, err: (e: string) => `err:${e}` }),
	)();
	expect(result).toBe("err:too small");
});

test("mapError: transformed error received by match", async () => {
	const result = await pipe(
		Task.Result.tryCatch(() => Promise.reject(new Error("boom")), {
			onError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
		}),
		Task.Result.mapError((msg: string) => msg.toUpperCase()),
		Task.Result.match({ err: (e: string) => `error: ${e}`, ok: (_: number) => "ok" }),
	)();
	expect(result).toBe("error: BOOM");
});

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

test("apply: applies Ok function to Ok value", async () => {
	const result = await pipe(Task.Result.make.ok((n: number) => n * 3), Task.Result.apply(Task.Result.make.ok(4)))();
	expect(result).toStrictEqual({ kind: "Ok", value: 12 });
});

test("apply: propagates error if function is Error", async () => {
	const result = await pipe(Task.Result.make.err("error fn"), Task.Result.apply(Task.Result.make.ok(4)))();
	expect(result).toStrictEqual({ kind: "Err", error: "error fn" });
});

test("apply: propagates error if value is Error", async () => {
	const result = await pipe(
		Task.Result.make.ok((n: number) => n * 3),
		Task.Result.apply(Task.Result.make.err("error val")),
	)();
	expect(result).toStrictEqual({ kind: "Err", error: "error val" });
});

test("apply: propagates first error if both are Error", async () => {
	const result = await pipe(Task.Result.make.err("error fn"), Task.Result.apply(Task.Result.make.err("error val")))();
	expect(result).toStrictEqual({ kind: "Err", error: "error fn" });
});

test("apply: widens error types from function and argument", async () => {
	const fnTask: Task.Result<"ERR_FN", (n: number) => string> = Task.Result.make.ok((n: number) => String(n));
	const argTask: Task.Result<"ERR_ARG", number> = Task.Result.make.err("ERR_ARG");
	const result = await pipe(fnTask, Task.Result.apply(argTask))();
	expect(result).toStrictEqual({ kind: "Err", error: "ERR_ARG" });
});

test("apply: propagates AbortSignal down to both sides in parallel", async () => {
	let signalLeft: AbortSignal | undefined;
	let signalRight: AbortSignal | undefined;

	const left: Task.Result<string, (n: number) => number> = (signal) => {
		signalLeft = signal;
		return Deferred.from.Promise(Promise.resolve(Result.make.ok((n: number) => n * 3)));
	};
	const right: Task.Result<string, number> = (signal) => {
		signalRight = signal;
		return Deferred.from.Promise(Promise.resolve(Result.make.ok(4)));
	};

	const controller = new AbortController();
	const result = await pipe(left, Task.Result.apply(right))(controller.signal);

	expect(result).toStrictEqual({ kind: "Ok", value: 12 });
	expect(signalLeft).toBe(controller.signal);
	expect(signalRight).toBe(controller.signal);
});

// ---------------------------------------------------------------------------
// tapError
// ---------------------------------------------------------------------------

test("tapError: calls side effect with error on Err", async () => {
	let captured: string | undefined;
	await pipe(
		Task.Result.make.err("oops"),
		Task.Result.tapError((e) => {
			captured = e;
		}),
	)();
	expect(captured).toBe("oops");
});

test("tapError: does not call side effect on Ok", async () => {
	let called = false;
	await pipe(
		Task.Result.make.ok(1),
		Task.Result.tapError(() => {
			called = true;
		}),
	)();
	expect(called).toBe(false);
});

test("tapError: returns original Err result unchanged", async () => {
	const result = await pipe(Task.Result.make.err("oops"), Task.Result.tapError(() => {}))();
	expect(result).toStrictEqual({ kind: "Err", error: "oops" });
});

test("tapError: returns original Ok result unchanged", async () => {
	const result = await pipe(Task.Result.make.ok(42), Task.Result.tapError(() => {}))();
	expect(result).toStrictEqual({ kind: "Ok", value: 42 });
});

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

test("run: executes task and returns Result", async () => {
	const result = await pipe(Task.Result.make.ok(42), Task.Result.run());
	expect(result).toStrictEqual({ kind: "Ok", value: 42 });
});

test("run: passes signal to task", async () => {
	const controller = new AbortController();
	let receivedSignal: AbortSignal | undefined;
	const task: Task.Result<never, void> = (signal) => {
		receivedSignal = signal;
		return Deferred.from.Promise(Promise.resolve(Result.make.ok(undefined)));
	};
	await pipe(task, Task.Result.run(controller.signal));
	expect(receivedSignal).toBe(controller.signal);
});

// --- from.nullable ---

test("from.nullable: returns Ok for non-null value", async () => {
	const result = await Task.Result.from.nullable(() => "is null")(42)();
	expect(result).toStrictEqual(Result.make.ok(42));
});

test("from.nullable: returns Err for null", async () => {
	const result = await Task.Result.from.nullable(() => "is null")(null)();
	expect(result).toStrictEqual(Result.make.err("is null"));
});

test("from.nullable: returns Err for undefined", async () => {
	const result = await Task.Result.from.nullable(() => "is null")(undefined)();
	expect(result).toStrictEqual(Result.make.err("is null"));
});

// --- fromMaybe ---

test("from.Maybe: returns Ok for Some", async () => {
	const result = await Task.Result.from.Maybe(() => "is none")(Maybe.make.some(42))();
	expect(result).toStrictEqual(Result.make.ok(42));
});

test("from.Maybe: returns Err for None", async () => {
	const result = await Task.Result.from.Maybe(() => "is none")(Maybe.make.none())();
	expect(result).toStrictEqual(Result.make.err("is none"));
});

// --- fromResult ---

test("from.Result: returns Ok for Ok", async () => {
	const result = await Task.Result.from.Result(Result.make.ok(42))();
	expect(result).toStrictEqual(Result.make.ok(42));
});

test("from.Result: returns Err for Err", async () => {
	const result = await Task.Result.from.Result(Result.make.err("bad"))();
	expect(result).toStrictEqual(Result.make.err("bad"));
});

// --- assignTo ---

test("assignTo: wraps value in accumulator object", async () => {
	const task = pipe(Task.Result.make.ok(2), Task.Result.assignTo("a"));
	const result = await task();
	expect(result).toStrictEqual(Result.make.ok({ a: 2 }));
});

// --- assign ---

test("assign: accumulates values key-by-key in pipeline", async () => {
	const task = pipe(
		Task.Result.make.ok(2),
		Task.Result.assignTo("a"),
		Task.Result.assign("b", ({ a }) => Task.Result.make.ok(a * 3)),
		Task.Result.assign("c", ({ a, b }) => Task.Result.make.ok(a + b)),
	);
	const result = await task();
	expect(result).toStrictEqual(Result.make.ok({ a: 2, b: 6, c: 8 }));
});

test("assign: short-circuits on Err", async () => {
	let called = false;
	const task = pipe(
		Task.Result.make.ok(2),
		Task.Result.assignTo("a"),
		Task.Result.assign("b", () => Task.Result.make.err("fail")),
		Task.Result.assign("c", ({ b }) => {
			called = true;
			return Task.Result.make.ok(b);
		}),
	);
	const result = await task();
	expect(called).toBe(false);
	expect(result).toStrictEqual(Result.make.err("fail"));
});

// --- struct ---

test("struct: combines record of Ok values into single Ok record", async () => {
	const res = await Task.Result.struct({ a: Task.Result.make.ok(1), b: Task.Result.make.ok("hello") })();
	expect(res).toStrictEqual(Result.make.ok({ a: 1, b: "hello" }));
});

test("struct: short-circuits on first Err encountered", async () => {
	const res = await Task.Result.struct({
		a: Task.Result.make.ok(1),
		b: Task.Result.make.err("first fail"),
		c: Task.Result.make.err("second fail"),
	})();
	expect(res).toStrictEqual(Result.make.err("first fail"));
});

test("struct: infers heterogeneous error union and assigns to interface types", async () => {
	interface SomeError {
		code: number;
	}
	interface SomeRecord {
		a: number;
		b: string;
	}

	const assigned: Task.Result<SomeError, SomeRecord> = Task.Result.struct({
		a: Task.Result.make.ok(1),
		b: Task.Result.make.ok("hello"),
	});
	const res = await assigned();
	expect(res).toStrictEqual(Result.make.ok({ a: 1, b: "hello" }));
});

test("struct: propagates AbortSignal and executes in parallel", async () => {
	let signalA: AbortSignal | undefined;
	let signalB: AbortSignal | undefined;

	const taskA: Task.Result<string, number> = (signal) => {
		signalA = signal;
		return Deferred.from.Promise(Promise.resolve(Result.make.ok(1)));
	};
	const taskB: Task.Result<string, string> = (signal) => {
		signalB = signal;
		return Deferred.from.Promise(Promise.resolve(Result.make.ok("hello")));
	};

	const controller = new AbortController();
	const res = await Task.Result.struct({ a: taskA, b: taskB })(controller.signal);

	expect(res).toStrictEqual(Result.make.ok({ a: 1, b: "hello" }));
	expect(signalA).toBe(controller.signal);
	expect(signalB).toBe(controller.signal);
});

test("struct: composes in pipeline", async () => {
	const res = await pipe(
		Task.Result.make.ok({ name: "Alice" }),
		Task.Result.map((u) => u.name),
		Task.Result.chain((name) =>
			Task.Result.struct({
				name: Task.Result.make.ok(name),
				valid: Task.Result.from.Result(Result.from.Predicate((n: string) => n.length > 0, () => "invalid")(name)),
			})
		),
	)();
	expect(res).toStrictEqual(Result.make.ok({ name: "Alice", valid: "Alice" }));
});

test("struct: returns ok({}) when given empty object", async () => {
	const res = await Task.Result.struct({})();
	expect(res).toStrictEqual(Result.make.ok({}));
});

test("struct: copies symbol-keyed fields and short-circuits on a symbol-keyed Err", async () => {
	const token = Symbol("token");
	const res = await Task.Result.struct({ value: Task.Result.make.ok(42), [token]: Task.Result.make.ok("extra") })();
	expect(res).toStrictEqual(Result.make.ok({ value: 42, [token]: "extra" }));

	const failing = await Task.Result.struct({
		value: Task.Result.make.ok(42),
		[token]: Task.Result.make.err("boom" as const),
	})();
	expect(failing).toStrictEqual(Result.make.err("boom"));
});

// --- retry ---

test("retry: returns Ok on first attempt without retrying", async () => {
	let calls = 0;
	const task: Task.Result<string, number> = () => {
		calls++;
		return Deferred.from.Promise(Promise.resolve(Result.make.ok(42)));
	};
	const policy = RetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(10) });
	const result = await pipe(task, Task.Result.retry(policy))();

	expect(result).toStrictEqual(Result.make.ok(42));
	expect(calls).toBe(1);
});

test("retry: retries on Err until success", async () => {
	let calls = 0;
	const task: Task.Result<string, number> = () => {
		calls++;
		return Deferred.from.Promise(
			Promise.resolve(calls < 3 ? Result.make.err(`attempt ${calls} failed`) : Result.make.ok(42)),
		);
	};
	const policy = RetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(1) });
	const result = await pipe(task, Task.Result.retry(policy))();

	expect(result).toStrictEqual(Result.make.ok(42));
	expect(calls).toBe(3);
});

test("retry: returns final Err after exhausting attempts", async () => {
	let calls = 0;
	const task: Task.Result<string, number> = () => {
		calls++;
		return Deferred.from.Promise(Promise.resolve(Result.make.err(`attempt ${calls} failed`)));
	};
	const policy = RetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(1) });
	const result = await pipe(task, Task.Result.retry(policy))();

	expect(result).toStrictEqual(Result.make.err("attempt 3 failed"));
	expect(calls).toBe(3);
});

test("retry: stops early when call site AbortSignal is aborted", async () => {
	let calls = 0;
	const controller = new AbortController();
	const task: Task.Result<string, number> = () => {
		calls++;
		if (calls === 1) {
			controller.abort();
		}
		return Deferred.from.Promise(Promise.resolve(Result.make.err("failed")));
	};
	const policy = RetryPolicy.constant({ attempts: 5, delay: Duration.milliseconds(50) });
	const result = await pipe(task, Task.Result.retry(policy))(controller.signal);

	expect(result).toStrictEqual(Result.make.err("failed"));
	expect(calls).toBe(1);
});

// --- timeout ---

test("timeout: resolves to task Ok when task finishes before duration", async () => {
	const task: Task.Result<string, number> = () => Deferred.from.Promise(Promise.resolve(Result.make.ok(42)));
	const res = await pipe(
		task,
		Task.Result.timeout({ duration: Duration.milliseconds(100), onTimeout: () => "timed_out" }),
	)();

	expect(res).toStrictEqual(Result.make.ok(42));
});

test("timeout: resolves to Err(onTimeout()) when task exceeds duration", async () => {
	const task: Task.Result<string, number> = () =>
		Deferred.from.Promise(new Promise((resolve) => setTimeout(() => resolve(Result.make.ok(42)), 100)));
	const res = await pipe(
		task,
		Task.Result.timeout({ duration: Duration.milliseconds(10), onTimeout: () => "timed_out" }),
	)();

	expect(res).toStrictEqual(Result.make.err("timed_out"));
});

test("timeout: handles pre-aborted signal", async () => {
	const controller = new AbortController();
	controller.abort();
	const task: Task.Result<string, number> = (sig) =>
		Deferred.from.Promise(Promise.resolve(sig?.aborted ? Result.make.err("aborted") : Result.make.ok(42)));

	const res = await pipe(
		task,
		Task.Result.timeout({ duration: Duration.milliseconds(100), onTimeout: () => "timed_out" }),
	)(controller.signal);

	expect(res).toStrictEqual(Result.make.err("aborted"));
});

test("timeout: handles signal aborted during execution", async () => {
	const controller = new AbortController();
	const task: Task.Result<string, number> = () => {
		setTimeout(() => controller.abort(), 10);
		return Deferred.from.Promise(new Promise((resolve) => setTimeout(() => resolve(Result.make.ok(42)), 50)));
	};

	const res = await pipe(
		task,
		Task.Result.timeout({ duration: Duration.milliseconds(100), onTimeout: () => "timed_out" }),
	)(controller.signal);

	expect(res).toStrictEqual(Result.make.ok(42));
});

test("timeout: keeps the deadline after external cancellation when the task ignores the signal", async () => {
	const controller = new AbortController();
	const task: Task.Result<string, number> = () =>
		Deferred.from.Promise(new Promise((resolve) => setTimeout(() => resolve(Result.make.ok(42)), 50)));
	const outcome = pipe(task, Task.Result.timeout({ duration: Duration.milliseconds(10), onTimeout: () => "timed out" }))(
		controller.signal,
	);
	controller.abort();
	await expect(Deferred.to.Promise(outcome)).resolves.toStrictEqual(Result.make.err("timed out"));
});

test("retry: aborts during wait delay", async () => {
	const controller = new AbortController();
	let attempts = 0;
	const failingTask: Task.Result<string, number> = () => {
		attempts++;
		if (attempts === 1) {
			setTimeout(() => controller.abort(), 10);
		}
		return Deferred.from.Promise(Promise.resolve(Result.make.err("fail")));
	};

	const policy = RetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(100) });
	const res = await pipe(failingTask, Task.Result.retry(policy))(controller.signal);
	expect(res).toStrictEqual(Result.make.err("fail"));
});

// --- allSettled ---

test("allSettled: collects all Ok and Err results in parallel", async () => {
	const t1: Task.Result<string, number> = () => Deferred.from.Promise(Promise.resolve(Result.make.ok(1)));
	const t2: Task.Result<string, number> = () => Deferred.from.Promise(Promise.resolve(Result.make.err("e2")));
	const t3: Task.Result<string, number> = () => Deferred.from.Promise(Promise.resolve(Result.make.ok(3)));

	const res = await Task.Result.allSettled([t1, t2, t3])();

	expect(res).toStrictEqual([Result.make.ok(1), Result.make.err("e2"), Result.make.ok(3)]);
});

test("allSettled: preserves heterogeneous tuple types per element", async () => {
	const t1: Task.Result<"ERR_1", number> = Task.Result.make.ok(1);
	const t2: Task.Result<"ERR_2", string> = Task.Result.make.err("ERR_2");

	const settled = Task.Result.allSettled([t1, t2]);
	const res = await settled();
	expect(res).toStrictEqual([Result.make.ok(1), Result.make.err("ERR_2")]);
});

test("make: creates ok and err tasks", async () => {
	const okTask = Task.Result.make.ok(42);
	const errTask = Task.Result.make.err("failed");

	await expect(okTask()).resolves.toStrictEqual(Result.make.ok(42));
	await expect(errTask()).resolves.toStrictEqual(Result.make.err("failed"));
});

test("chain: supports error union widening", async () => {
	const step1: Task.Result<"ERR_A", number> = Task.Result.make.ok(42);
	const step2 = (_n: number): Task.Result<"ERR_B", string> => Task.Result.make.err("ERR_B");

	const res: Result<"ERR_A" | "ERR_B", string> = await pipe(step1, Task.Result.chain(step2))();
	expect(res).toStrictEqual({ kind: "Err", error: "ERR_B" });
});

test("chain: infers exact error union without collapsing to unknown", async () => {
	const step1 = Task.Result.make.err("ERR_A" as const);
	const step2 = (_: unknown) => Task.Result.make.err("ERR_B" as const);

	const taskRes = pipe(step1, Task.Result.chain(step2));
	const res = await taskRes();
	expect(res).toStrictEqual({ kind: "Err", error: "ERR_A" });
});

test("timeout: infers exact error union without collapsing to unknown", async () => {
	const step1: Task.Result<"ERR_A", number> = Task.Result.make.ok(42);
	const taskRes = pipe(
		step1,
		Task.Result.timeout({ duration: Duration.milliseconds(100), onTimeout: () => "TIMEOUT" as const }),
	);

	const res = await taskRes();
	expect(res.kind).toBe("Ok");
});

test("to.Maybe: converts Ok to Some and Err to None", async () => {
	const okTask = Task.Result.make.ok(42);
	const errTask = Task.Result.make.err("oops");

	await expect(Task.Result.to.Maybe(okTask)()).resolves.toStrictEqual({ kind: "Some", value: 42 });
	await expect(Task.Result.to.Maybe(errTask)()).resolves.toStrictEqual({ kind: "None" });
});

type TestErr = { code: "NOT_FOUND" | "TIMEOUT"; };
type TestVal = { id: number; };

test("make.ok: defaults error generic to never, allowing ternary error union inference", async () => {
	const step = (): Task.Result<TestErr, TestVal[]> => Task.Result.make.ok([{ id: 42 }]);

	const task = pipe(
		step(),
		Task.Result.chain((vals) =>
			vals.length === 0 ? Task.Result.make.err({ code: "NOT_FOUND" as const }) : Task.Result.make.ok(vals)
		),
		Task.Result.map((v) => String(v[0]?.id)),
	);

	const res = await task();
	expect(res).toStrictEqual(Result.make.ok("42"));
});

test("tryCatch: lifts async operations into Task.Result", async () => {
	const asyncOp = (): Promise<TestVal> => Promise.resolve({ id: 100 });
	const task: Task.Result<TestErr, TestVal> = Task.Result.tryCatch(() => asyncOp(), {
		onError: () => ({ code: "NOT_FOUND" }),
	});

	const res = await task();
	expect(res).toStrictEqual(Result.make.ok({ id: 100 }));
});

// --- recoverUnless ---

test("recoverUnless: recovers from Err when not blocked", async () => {
	const task = pipe(
		Task.Result.make.err<string>("transient"),
		Task.Result.recoverUnless((e) => e === "fatal", () => Task.Result.make.ok(99)),
	);
	const res = await task();
	expect(res).toStrictEqual(Result.make.ok(99));
});

test("recoverUnless: preserves Err when blocked", async () => {
	const task = pipe(
		Task.Result.make.err("fatal"),
		Task.Result.recoverUnless((e) => e === "fatal", () => Task.Result.make.ok(99)),
	);
	const res = await task();
	expect(res).toStrictEqual(Result.make.err("fatal"));
});

test("retry: returns early when signal is already aborted before backoff wait", async () => {
	const controller = new AbortController();
	controller.abort();
	const policy = RetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(100) });

	const task: Task.Result<string, number> = Task.Result.make.err("err");
	const res = await pipe(task, Task.Result.retry(policy))(controller.signal);
	expect(res).toStrictEqual(Result.make.err("err"));
});

test("retry: returns early when signal aborts during backoff wait delay", async () => {
	const controller = new AbortController();
	const policy = RetryPolicy.constant({ attempts: 5, delay: Duration.milliseconds(200) });

	let attempts = 0;
	const task: Task.Result<string, number> = (signal) => {
		attempts++;
		if (attempts === 1) {
			setTimeout(() => controller.abort(), 50);
		}
		return Task.Result.make.err("err")(signal);
	};

	const res = await pipe(task, Task.Result.retry(policy))(controller.signal);
	expect(res).toStrictEqual(Result.make.err("err"));
	expect(attempts).toBeLessThanOrEqual(2);
});

test("retry: selectively retries only matching errors with when filter", async () => {
	type HttpError = { status: number; };
	const isHttpError = (err: unknown): err is HttpError => typeof err === "object" && err !== null && "status" in err;

	let calls = 0;
	const nonRetryableTask: Task.Result<HttpError, string> = () => {
		calls++;
		return Deferred.from.Promise(Promise.resolve(Result.make.err({ status: 400 })));
	};

	const policy = RetryPolicy.constant({
		attempts: 3,
		delay: Duration.milliseconds(1),
		when: (err) => isHttpError(err) && err.status >= 500,
	});
	const res = await pipe(nonRetryableTask, Task.Result.retry(policy))();

	expect(res).toStrictEqual(Result.make.err({ status: 400 }));
	expect(calls).toBe(1); // not retried because status is 400
});

// --- ensure ---

test("ensure: leaves Ok untouched when predicate passes", async () => {
	let called = false;
	const task = pipe(
		Task.Result.make.ok(42),
		Task.Result.ensure((n) => n > 10, () => {
			called = true;
			return "too small";
		}),
	);
	const res = await task();
	expect(res).toStrictEqual(Result.make.ok(42));
	expect(called).toBe(false);
});

test("ensure: narrows value type when given a type guard refinement", async () => {
	const input: Task.Result<"INITIAL_ERR", string | number> = Task.Result.make.ok("hello");
	const narrowed = pipe(
		input,
		Task.Result.ensure((v): v is string => typeof v === "string", () => "NOT_STRING" as const),
	);
	const res = await narrowed();
	expect(res).toStrictEqual(Result.make.ok("hello"));
});

test("ensure: converts Ok to Err when predicate fails", async () => {
	const task = pipe(Task.Result.make.ok(5), Task.Result.ensure((n) => n > 10, (n) => `${n} is too small`));
	const res = await task();
	expect(res).toStrictEqual(Result.make.err("5 is too small"));
});

test("ensure: propagates existing Err without invoking predicate", async () => {
	let predicateCalled = false;
	const task = pipe(
		Task.Result.make.err("original error"),
		Task.Result.ensure((n: number) => {
			predicateCalled = true;
			return n > 10;
		}, () => "should not be called"),
	);
	const res = await task();
	expect(res).toStrictEqual(Result.make.err("original error"));
	expect(predicateCalled).toBe(false);
});

// --- mapBoth ---

test("mapBoth: transforms Ok value and leaves Err branch untouched", async () => {
	let errCalled = false;
	const task = pipe(
		Task.Result.make.ok(10),
		Task.Result.mapBoth((err) => {
			errCalled = true;
			return `wrapped ${err}`;
		}, (n) => n * 2),
	);
	const res = await task();
	expect(res).toStrictEqual(Result.make.ok(20));
	expect(errCalled).toBe(false);
});

test("mapBoth: transforms Err value and leaves Ok branch untouched", async () => {
	let okCalled = false;
	const task = pipe(
		Task.Result.make.err("network failure"),
		Task.Result.mapBoth((err) => new Error(err), (n: number) => {
			okCalled = true;
			return n * 2;
		}),
	);
	const res = await task();
	expect(res).toStrictEqual(Result.make.err(new Error("network failure")));
	expect(okCalled).toBe(false);
});

// ---------------------------------------------------------------------------
// Hardening & Concurrency Safety
// ---------------------------------------------------------------------------

test("timeout: aborts inner task signal when timeout fires", async () => {
	let innerSignal: AbortSignal | undefined;
	const task: Task.Result<string, number> = (signal) => {
		innerSignal = signal;
		return Deferred.from.Promise(
			new Promise((resolve) => {
				setTimeout(() => resolve(Result.make.ok(42)), 100);
			}),
		);
	};
	const res = await pipe(
		task,
		Task.Result.timeout({ duration: Duration.milliseconds(20), onTimeout: () => "timed_out" }),
	)();
	expect(res).toStrictEqual(Result.make.err("timed_out"));
	expect(innerSignal?.aborted).toBe(true);
});

test("timeout: returns the deadline error when abort completes the inner task", async () => {
	const task: Task.Result<never, number> = (signal) =>
		Deferred.from.Promise(
			new Promise((resolve) => {
				signal?.addEventListener("abort", () => resolve(Result.make.ok(42)), { once: true });
			}),
		);
	const result = await pipe(
		task,
		Task.Result.timeout({ duration: Duration.milliseconds(1), onTimeout: () => "deadline" }),
	)();
	expect(result).toStrictEqual(Result.make.err("deadline"));
});

test("retry: exits wait immediately if signal is already aborted", async () => {
	const controller = new AbortController();
	controller.abort();
	const policy = RetryPolicy.constant({ attempts: 3, delay: Duration.seconds(10) });
	const result = await pipe(Task.Result.make.err("fail"), Task.Result.retry(policy))(controller.signal);
	expect(result).toStrictEqual(Result.make.err("fail"));
});

test("retry: executes onRetry callback on each attempt before delay", async () => {
	const events: Array<{ attempt: number; error: unknown; delay: Duration; }> = [];
	let attempts = 0;
	const failingTask: Task.Result<string, number> = () => {
		attempts++;
		if (attempts < 3) {
			return Deferred.from.Promise(Promise.resolve(Result.make.err(`err_${attempts}`)));
		}
		return Deferred.from.Promise(Promise.resolve(Result.make.ok(42)));
	};

	const policy = RetryPolicy.constant({
		attempts: 4,
		delay: Duration.milliseconds(2),
		onRetry: (event) => {
			events.push(event);
		},
	});
	const result = await pipe(failingTask, Task.Result.retry(policy))();

	expect(result).toStrictEqual(Result.make.ok(42));
	expect(attempts).toBe(3);
	expect(events).toHaveLength(2);
	expect(events[0]).toStrictEqual({ attempt: 1, error: "err_1", delay: Duration.milliseconds(2) });
	expect(events[1]).toStrictEqual({ attempt: 2, error: "err_2", delay: Duration.milliseconds(2) });
});

test("retry: does not invoke onRetry when first attempt succeeds", async () => {
	let onRetryCalled = false;
	const successTask = Task.Result.make.ok("success");
	const policy = RetryPolicy.constant({
		attempts: 3,
		delay: Duration.milliseconds(2),
		onRetry: () => {
			onRetryCalled = true;
		},
	});

	const result = await pipe(successTask, Task.Result.retry(policy))();

	expect(result).toStrictEqual(Result.make.ok("success"));
	expect(onRetryCalled).toBe(false);
});

test("assign: safely handles __proto__ property without prototype pollution", async () => {
	const res = await pipe(
		Task.Result.make.ok({ a: 1 }),
		Task.Result.assign("__proto__", () => Task.Result.make.ok({ polluted: true })),
	)();
	expect(Result.is.ok(res)).toBe(true);
	const value = Result.getOrElse((): Record<string, unknown> => ({}))(res);
	expect(Object.hasOwn(value, "__proto__")).toBe(true);
	expect("polluted" in {}).toBe(false);
});

// ---------------------------------------------------------------------------
// from.Task
// ---------------------------------------------------------------------------

test("from.Task: lifts infallible Task into Task.Result", async () => {
	const plain = Task.make(42);
	const lifted = Task.Result.from.Task(plain);
	const result = await lifted();
	expect(result).toStrictEqual(Result.make.ok(42));
});

// ---------------------------------------------------------------------------
// all
// ---------------------------------------------------------------------------

test("all: runs tasks in parallel and returns Ok tuple", async () => {
	const t1 = Task.Result.make.ok(1);
	const t2 = Task.Result.make.ok("two");
	const result = await Task.Result.all([t1, t2])();
	expect(result).toStrictEqual(Result.make.ok([1, "two"]));
});

test("all: returns Ok([]) for empty input", async () => {
	const result = await Task.Result.all([])();
	expect(result).toStrictEqual(Result.make.ok([]));
});

test("all: pre-aborted signal returns Aborted without starting work", async () => {
	const controller = new AbortController();
	controller.abort("stopped");
	let starts = 0;
	const t = Task.Result.from.Task(Task.from.sync(() => ++starts));
	const result = await Task.Result.all([t, t])(controller.signal);
	expect(result).toStrictEqual(Result.make.err({ kind: "Aborted", reason: "stopped" }));
	expect(starts).toBe(0);
});

test("all: ignores a late task result after the caller aborts", async () => {
	const controller = new AbortController();
	let finish: (value: Result<never, number>) => void = () => {};
	const pending = new Promise<Result<never, number>>((resolve) => {
		finish = resolve;
	});
	const task: Task.Result<never, number> = () => Deferred.from.Promise(pending);
	const outcome = Task.Result.all([task])(controller.signal);
	controller.abort("cancelled");
	await expect(outcome).resolves.toStrictEqual(Result.make.err({ kind: "Aborted", reason: "cancelled" }));
	finish(Result.make.ok(1));
	await pending;
	await Promise.resolve();
});

test("all: short-circuits on first error and cancels remaining tasks", async () => {
	const controller = new AbortController();
	let cancelled = false;
	const fastErr = Task.Result.make.err("boom");
	const slow = (signal?: AbortSignal) => {
		signal?.addEventListener("abort", () => {
			cancelled = true;
		});
		return Deferred.from.Promise(new Promise<Result<never, number>>(() => {}));
	};

	const result = await Task.Result.all([fastErr, slow])(controller.signal);
	expect(result).toStrictEqual(Result.make.err("boom"));
	expect(cancelled).toBe(true);
});

test("all: limits concurrency and preserves order", async () => {
	let active = 0;
	let maxActive = 0;
	const makeTask = (value: number) =>
		Task.tryCatch(() =>
			new Promise<Result<never, number>>((resolve) => {
				active++;
				if (active > maxActive) {
					maxActive = active;
				}
				setTimeout(() => {
					active--;
					resolve(Result.make.ok(value));
				}, 20);
			}), { onError: () => Result.make.ok(0) });

	const tasks = [makeTask(1), makeTask(2), makeTask(3), makeTask(4)];
	const result = await Task.Result.all(tasks, { concurrency: 2 })();
	expect(result).toStrictEqual(Result.make.ok([1, 2, 3, 4]));
	expect(maxActive).toBe(2);
});

test("all: clamps invalid concurrency values to sequential execution", async () => {
	for (const concurrency of [1.5, NaN, Infinity, 0, -1]) {
		let active = 0;
		let maxActive = 0;
		const counting = (): Task.Result<never, number> => () => {
			active++;
			maxActive = Math.max(maxActive, active);
			return Deferred.from.Promise(
				Promise.resolve(Result.make.ok(1)).then((result) => {
					active--;
					return result;
				}),
			);
		};

		const result = await Task.Result.all([counting(), counting(), counting()], { concurrency })();

		expect(result).toStrictEqual(Result.make.ok([1, 1, 1]));
		expect(maxActive).toBe(1);
	}
});

test("all: settles with Aborted when caller signal aborts during execution", async () => {
	const controller = new AbortController();
	let cancelled = false;
	const slow = (signal?: AbortSignal) => {
		signal?.addEventListener("abort", () => {
			cancelled = true;
		});
		return Deferred.from.Promise(new Promise<Result<never, number>>(() => {}));
	};

	const promise = Task.Result.all([slow])(controller.signal);
	controller.abort("caller-cancelled");
	const result = await promise;
	expect(result).toStrictEqual(Result.make.err({ kind: "Aborted", reason: "caller-cancelled" }));
	expect(cancelled).toBe(true);
});

test("all: does not trigger abort listeners when all tasks succeed", async () => {
	let abortFired = false;
	const taskA = (signal?: AbortSignal) => {
		signal?.addEventListener("abort", () => {
			abortFired = true;
		});
		return Deferred.from.Promise(Promise.resolve(Result.make.ok(1)));
	};
	const taskB = Task.Result.make.ok(2);

	const result = await Task.Result.all([taskA, taskB])();
	expect(result).toStrictEqual(Result.make.ok([1, 2]));
	expect(abortFired).toBe(false);
});

// ---------------------------------------------------------------------------
// Regression Suite
// ---------------------------------------------------------------------------

test("retry: exits wait immediately when signal is aborted synchronously inside onRetry", async () => {
	const controller = new AbortController();
	const policy = RetryPolicy.constant({
		attempts: 3,
		delay: Duration.milliseconds(500),
		onRetry: () => {
			controller.abort();
		},
	});

	const start = Date.now();
	const result = await pipe(Task.Result.make.err("fail"), Task.Result.retry(policy))(controller.signal);
	const elapsed = Date.now() - start;

	expect(result).toStrictEqual(Result.make.err("fail"));
	expect(elapsed).toBeLessThan(100);
});

test("retry: clamps non-finite attempts to a single run", async () => {
	let calls = 0;
	const task: Task.Result<"failed", never> = Task.from.sync(() => {
		calls++;
		return Result.make.err("failed");
	});
	const policy: RetryPolicy<"failed"> = { attempts: Number.NaN, getDelay: () => Duration.milliseconds(0) };
	const result = await Task.Result.retry(policy)(task)();
	expect(result).toStrictEqual(Result.make.err("failed"));
	expect(calls).toBe(1);
});

// --- poll ---

test("poll: returns the first value when the condition holds immediately", async () => {
	let calls = 0;
	const task = Task.from.sync(() => {
		calls++;
		return Result.make.ok(42);
	});
	const result = await pipe(task, Task.Result.poll({ until: (n) => n === 42 }))();
	expect(result).toStrictEqual(Result.make.ok(42));
	expect(calls).toBe(1);
});

test("poll: keeps polling until the condition holds", async () => {
	let calls = 0;
	const task = Task.from.sync(() => Result.make.ok(++calls));
	const result = await pipe(task, Task.Result.poll({ until: (n) => n === 3 }))();
	expect(result).toStrictEqual(Result.make.ok(3));
	expect(calls).toBe(3);
});

test("poll: returns the last value when attempts run out", async () => {
	let calls = 0;
	const task = Task.from.sync(() => Result.make.ok(++calls));
	const result = await pipe(task, Task.Result.poll({ until: (n) => n > 100, attempts: 3 }))();
	expect(result).toStrictEqual(Result.make.ok(3));
	expect(calls).toBe(3);
});

test("poll: stops at the first error without running again", async () => {
	let calls = 0;
	const task = Task.from.sync(() => {
		calls++;
		return calls < 2 ? Result.make.ok(calls) : Result.make.err("boom");
	});
	const result = await pipe(task, Task.Result.poll({ until: () => false }))();
	expect(result).toStrictEqual(Result.make.err("boom"));
	expect(calls).toBe(2);
});

test("poll: waits the delay between attempts", async () => {
	let calls = 0;
	const task = Task.from.sync(() => Result.make.ok(++calls));
	const started = Date.now();
	await pipe(task, Task.Result.poll({ until: (n) => n >= 2, delay: Duration.milliseconds(25) }))();
	expect(Date.now() - started).toBeGreaterThanOrEqual(20);
	expect(calls).toBe(2);
});

test("poll: stops when the signal aborts during a run", async () => {
	const controller = new AbortController();
	let calls = 0;
	const task = Task.from.sync(() => {
		calls++;
		if (calls === 2) {
			controller.abort();
		}
		return Result.make.ok(calls);
	});
	const result = await pipe(task, Task.Result.poll({ until: (n) => n > 100 }))(controller.signal);
	expect(result).toStrictEqual(Result.make.ok(2));
	expect(calls).toBe(2);
});

test("poll: resolves with the last value when aborted during the delay", async () => {
	const controller = new AbortController();
	let calls = 0;
	const task = Task.from.sync(() => Result.make.ok(++calls));
	const polled = pipe(task, Task.Result.poll({ until: (n) => n === 5, delay: Duration.milliseconds(50) }));

	setTimeout(() => controller.abort(), 75);

	const result = await polled(controller.signal);
	expect(result).toStrictEqual(Result.make.ok(2));
	expect(calls).toBe(2);
});

test("poll: clamps attempts to at least one", async () => {
	let calls = 0;
	const task = Task.from.sync(() => Result.make.ok(++calls));
	await pipe(task, Task.Result.poll({ until: (n) => n > 100, attempts: 0 }))();
	expect(calls).toBe(1);
});

test("poll: treats a fractional attempt limit as one attempt", async () => {
	let calls = 0;
	const task = Task.from.sync(() => Result.make.ok(++calls));
	await pipe(task, Task.Result.poll({ until: (n) => n > 100, attempts: 2.5 }))();
	expect(calls).toBe(1);
});

test("poll: treats a non-finite attempt limit as one attempt", async () => {
	let calls = 0;
	const task = Task.from.sync(() => Result.make.ok(++calls));
	await pipe(task, Task.Result.poll({ until: (n) => n > 100, attempts: Number.NaN }))();
	expect(calls).toBe(1);
});

// --- paginate ---

type TestPage<A> = { readonly items: readonly A[]; readonly next?: number; };

const makePagedLoad = <A>(pages: readonly (readonly A[])[]) => {
	const cursors: (number | undefined)[] = [];
	const load = (cursor: number | undefined): Task.Result<"failed", TestPage<A>> => {
		cursors.push(cursor);
		const index = cursors.length - 1;
		const items = pages[index] ?? [];
		const next = index + 1 < pages.length ? index + 1 : undefined;
		return Task.from.sync(() => Result.make.ok({ items, next }));
	};
	return { load, cursors };
};

test("paginate: collects items across pages in order", async () => {
	const { load, cursors } = makePagedLoad([[1, 2], [3], [4, 5]]);
	const result = await Task.Result.paginate(load)();
	expect(result).toStrictEqual(Result.make.ok([1, 2, 3, 4, 5]));
	expect(cursors).toStrictEqual([undefined, 1, 2]);
});

test("paginate: stops when a page has no next cursor", async () => {
	const { load, cursors } = makePagedLoad([[1]]);
	await expect(Task.Result.paginate(load)()).resolves.toStrictEqual(Result.make.ok([1]));
	expect(cursors).toStrictEqual([undefined]);
});

test("paginate: continues after an empty page", async () => {
	const { load, cursors } = makePagedLoad([[], [1]]);
	await expect(Task.Result.paginate(load)()).resolves.toStrictEqual(Result.make.ok([1]));
	expect(cursors).toStrictEqual([undefined, 1]);
});

test("paginate: returns the first error and stops", async () => {
	let calls = 0;
	const load = (_cursor: number | undefined): Task.Result<"failed", TestPage<number>> => {
		calls++;
		return calls === 1
			? Task.from.sync(() => Result.make.ok({ items: [1], next: 1 }))
			: Task.from.sync(() => Result.make.err("failed"));
	};
	const result = await Task.Result.paginate(load)();
	expect(result).toStrictEqual(Result.make.err("failed"));
	expect(calls).toBe(2);
});

test("paginate: does not start when the signal is already aborted", async () => {
	const controller = new AbortController();
	controller.abort("stop");
	let calls = 0;
	const load = (_cursor: number | undefined): Task.Result<never, TestPage<number>> => {
		calls++;
		return Task.from.sync(() => Result.make.ok({ items: [], next: 1 }));
	};
	const result = await Task.Result.paginate(load)(controller.signal);
	expect(result).toStrictEqual(Result.make.err({ kind: "Aborted", reason: "stop" }));
	expect(calls).toBe(0);
});

test("paginate: settles with Aborted when the caller aborts between pages", async () => {
	const controller = new AbortController();
	let calls = 0;
	const load = (_cursor: number | undefined): Task.Result<never, TestPage<number>> => {
		calls++;
		controller.abort("cancelled");
		return Task.from.sync(() => Result.make.ok({ items: [1], next: 1 }));
	};
	const result = await Task.Result.paginate(load)(controller.signal);
	expect(result).toStrictEqual(Result.make.err({ kind: "Aborted", reason: "cancelled" }));
	expect(calls).toBe(1);
});

test("paginate: passes the caller signal to the loader", async () => {
	const controller = new AbortController();
	let received: AbortSignal | undefined;
	const load = (_cursor: number | undefined): Task.Result<never, TestPage<string>> => (signal) => {
		received = signal;
		return Deferred.from.Promise(Promise.resolve(Result.make.ok({ items: [] })));
	};
	await Task.Result.paginate(load)(controller.signal);
	expect(received).toBe(controller.signal);
});

test("paginate: preserves falsy items", async () => {
	const { load } = makePagedLoad<number | string | boolean>([[0, ""], [false]]);
	await expect(Task.Result.paginate(load)()).resolves.toStrictEqual(Result.make.ok([0, "", false]));
});
