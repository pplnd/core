import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { Duration } from "../../Types/Duration.ts";
import { RetryPolicy } from "../../Types/RetryPolicy.ts";
import { Aborted } from "../Aborted.ts";
import { type Result } from "../Result.ts";
import { Task } from "../Task.ts";

test("timeout: preserves domain and timeout error types", () => {
	const source: Task.Result<"source", number> = Task.Result.make.err("source");
	const timed = pipe(
		source,
		Task.Result.timeout({ duration: Duration.seconds(1), onTimeout: () => "deadline" as const }),
	);
	expectTypeOf(timed).toEqualTypeOf<Task.Result<"source" | "deadline", number>>();
});

test("from.Task: lifts infallible Task into Task.Result with never error", () => {
	const plain = Task.make(42);
	const lifted = Task.Result.from.Task(plain);
	expectTypeOf(lifted).toEqualTypeOf<Task.Result<never, number>>();
});

test("all & sequential: infers heterogeneous error unions and tuple value types", () => {
	const t1 = Task.Result.make.ok(42);
	const t2: Task.Result<"err", string> = Task.Result.make.err("err");

	const allTask = Task.Result.all([t1, t2]);
	expectTypeOf(allTask).toEqualTypeOf<Task.Result<"err" | Aborted, [number, string]>>();

	const seqTask = Task.Result.sequential([t1, t2]);
	expectTypeOf(seqTask).toEqualTypeOf<Task.Result<"err" | Aborted, [number, string]>>();
});

test("make: infers precise variant types for Ok and Err tasks", () => {
	const okTask = Task.Result.make.ok(42);
	expectTypeOf(okTask).toEqualTypeOf<Task.Result<never, number>>();

	const errTask = Task.Result.make.err("failed");
	expectTypeOf(errTask).toEqualTypeOf<Task.Result<"failed", never>>();
});

test("map / mapError: preserves natural union and propagates channel types", () => {
	const naturalUnion: Task.Result<string, number> = constTruthyBool()
		? Task.Result.make.ok(42)
		: Task.Result.make.err("err");

	const mapped = pipe(naturalUnion, Task.Result.map((n) => n.toString()));
	expectTypeOf(mapped).toEqualTypeOf<Task.Result<string, string>>();

	const mappedErr = pipe(naturalUnion, Task.Result.mapError((err) => err.length));
	expectTypeOf(mappedErr).toEqualTypeOf<Task.Result<number, number>>();
});

test("chain: unifies error channels across asynchronous pipelines", () => {
	const naturalUnion: Task.Result<"ERR_A", number> = constTruthyBool()
		? Task.Result.make.ok(42)
		: Task.Result.make.err("ERR_A");

	const chained = pipe(
		naturalUnion,
		Task.Result.chain((n) => (n > 0 ? Task.Result.make.ok(n.toString()) : Task.Result.make.err("ERR_B" as const))),
	);
	expectTypeOf(chained).toEqualTypeOf<Task.Result<"ERR_A" | "ERR_B", string>>();
});

test("tap & tapError: preserve channel types through side effects", () => {
	const naturalUnion: Task.Result<"ERR", number> = constTruthyBool()
		? Task.Result.make.ok(42)
		: Task.Result.make.err("ERR");

	const tapped = pipe(naturalUnion, Task.Result.tap((_n) => {}));
	expectTypeOf(tapped).toEqualTypeOf<Task.Result<"ERR", number>>();

	const tappedErr = pipe(naturalUnion, Task.Result.tapError((_e) => {}));
	expectTypeOf(tappedErr).toEqualTypeOf<Task.Result<"ERR", number>>();
});

test("apply: widens error types across independent parallel evaluations", async () => {
	const fnResult: Task.Result<"ERR_FN", (n: number) => string> = constTruthyBool()
		? Task.Result.make.ok((n: number) => String(n))
		: Task.Result.make.err("ERR_FN");
	const argResult: Task.Result<"ERR_ARG", number> = constTruthyBool()
		? Task.Result.make.ok(123)
		: Task.Result.make.err("ERR_ARG");

	const applied = pipe(fnResult, Task.Result.apply(argResult));
	expectTypeOf(applied).toEqualTypeOf<Task.Result<"ERR_FN" | "ERR_ARG", string>>();

	const res = await applied();
	expectTypeOf(res).toEqualTypeOf<Result<"ERR_FN" | "ERR_ARG", string>>();
});

test("struct: preserves heterogeneous error unions and object shapes", () => {
	const taskA: Task.Result<"ERR_A", number> = constTruthyBool() ? Task.Result.make.ok(1) : Task.Result.make.err("ERR_A");
	const taskB: Task.Result<"ERR_B", string> = constTruthyBool()
		? Task.Result.make.ok("foo")
		: Task.Result.make.err("ERR_B");

	const structured = Task.Result.struct({ a: taskA, b: taskB });
	expectTypeOf(structured).toEqualTypeOf<Task.Result<"ERR_A" | "ERR_B", { a: number; b: string; }>>();
});

test("assign & assignTo: accumulates pipeline object record correctly", () => {
	const taskA: Task.Result<"ERR_A", number> = constTruthyBool() ? Task.Result.make.ok(1) : Task.Result.make.err("ERR_A");

	const bound = pipe(
		taskA,
		Task.Result.assignTo("a"),
		Task.Result.assign(
			"b",
			({ a }) => a > 0 ? Task.Result.make.ok(a.toString()) : Task.Result.make.err("ERR_B" as const),
		),
	);
	expectTypeOf(bound).toEqualTypeOf<Task.Result<"ERR_A" | "ERR_B", { a: number; } & { b: string; }>>();
	expectTypeOf(bound).toMatchTypeOf<Task.Result<"ERR_A" | "ERR_B", { a: number; b: string; }>>();
});

test("ensure: narrows type when passed a type guard refinement", () => {
	const isString = (val: unknown): val is string => typeof val === "string";
	const input: Task.Result<"ERR_INIT", unknown> = constTruthyBool()
		? Task.Result.make.ok("hello")
		: Task.Result.make.err("ERR_INIT");

	const ensured = pipe(input, Task.Result.ensure(isString, () => "NOT_STRING" as const));
	expectTypeOf(ensured).toEqualTypeOf<Task.Result<"ERR_INIT" | "NOT_STRING", string>>();
});

test("retry: preserves error and value channels with optional onRetry and when", () => {
	const policy = RetryPolicy.constant<"MY_ERR">({
		attempts: 3,
		delay: Duration.seconds(1),
		when: (_err) => true,
		onRetry: (event) => {
			expectTypeOf(event.attempt).toEqualTypeOf<number>();
			expectTypeOf(event.delay).toEqualTypeOf<Duration>();
			expectTypeOf(event.error).toEqualTypeOf<"MY_ERR">();
		},
	});
	const task: Task.Result<"MY_ERR", number> = constTruthyBool()
		? Task.Result.make.ok(42)
		: Task.Result.make.err("MY_ERR");

	const retried = pipe(task, Task.Result.retry(policy));
	expectTypeOf(retried).toEqualTypeOf<Task.Result<"MY_ERR", number>>();
});

test("empty collections: preserve the aborted-only error channel", () => {
	expectTypeOf(Task.Result.all([])).toEqualTypeOf<Task.Result<Aborted, []>>();
	expectTypeOf(Task.Result.sequential([])).toEqualTypeOf<Task.Result<Aborted, []>>();
	expectTypeOf(Task.Result.struct({})).toEqualTypeOf<Task.Result<never, {}>>();
});

test("negative: flags invalid transforms and non-Task.Result struct fields", () => {
	const task = Task.Result.make.ok(42);

	// @ts-expect-error Map transform must be a function
	expectTypeOf(Task.Result.map(123)(task)).toBeFunction();

	// @ts-expect-error Chain transform must return a Task.Result
	expectTypeOf(Task.Result.chain((n: number) => n * 2)(task)).toBeFunction();

	// @ts-expect-error Struct field values must be Task.Result instances
	expectTypeOf(Task.Result.struct({ a: 123 })).toBeFunction();

	// @ts-expect-error retry expects exactly 1 argument (policy) without legacy 2nd options argument
	Task.Result.retry(RetryPolicy.constant({ attempts: 3, delay: Duration.seconds(1) }), { when: () => true });
});

test("from.nullable: strips null and undefined from the success channel", () => {
	expectTypeOf(Task.Result.from.nullable(() => "missing")(null)).toEqualTypeOf<Task.Result<"missing", never>>();
});

test("timeout: preserves literal timeout errors", () => {
	const task = pipe(
		Task.Result.make.ok(1),
		Task.Result.timeout({ duration: Duration.seconds(1), onTimeout: () => "timeout" }),
	);
	expectTypeOf(task).toEqualTypeOf<Task.Result<"timeout", number>>();
});

test("recover: infallible fallback clears the error channel", () => {
	const task: Task.Result<"err", number> = constTruthyBool() ? Task.Result.make.ok(1) : Task.Result.make.err("err");
	const recovered = pipe(task, Task.Result.recover(() => Task.Result.make.ok("fallback")));
	expectTypeOf(recovered).toEqualTypeOf<Task.Result<never, number | string>>();
});
