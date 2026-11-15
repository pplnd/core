import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { Task } from "../Task.ts";
import { type Validation } from "../Validation.ts";

test("make: infers precise variant types for Passed and Failed task validations", async () => {
	const passedTask = Task.Validation.make.passed(42);
	expectTypeOf(passedTask).toEqualTypeOf<Task.Validation<never, number>>();

	const failedTask = Task.Validation.make.failed("fail");
	expectTypeOf(failedTask).toEqualTypeOf<Task.Validation<"fail", never>>();

	const res = await passedTask();
	expectTypeOf(res).toEqualTypeOf<Validation<never, number>>();
});

test("map / mapError: preserves natural union and propagates channel types", () => {
	const naturalUnion: Task.Validation<"ERR", number> = constTruthyBool()
		? Task.Validation.make.passed(42)
		: Task.Validation.make.failed("ERR");

	const mapped = pipe(naturalUnion, Task.Validation.map((n) => n.toString()));
	expectTypeOf(mapped).toEqualTypeOf<Task.Validation<"ERR", string>>();

	const errorMapped = pipe(naturalUnion, Task.Validation.mapError((e) => e.length));
	expectTypeOf(errorMapped).toEqualTypeOf<Task.Validation<number, number>>();
});

test("tap & tapError: preserve channel types through side effects", () => {
	const naturalUnion: Task.Validation<"ERR", number> = constTruthyBool()
		? Task.Validation.make.passed(42)
		: Task.Validation.make.failed("ERR");

	const tapped = pipe(naturalUnion, Task.Validation.tap((_n) => {}));
	expectTypeOf(tapped).toEqualTypeOf<Task.Validation<"ERR", number>>();

	const tappedErr = pipe(naturalUnion, Task.Validation.tapError((_errs) => {}));
	expectTypeOf(tappedErr).toEqualTypeOf<Task.Validation<"ERR", number>>();
});

test("recover & recoverUnless: preserves or widens recovery error and value types", () => {
	const initial: Task.Validation<"INIT_ERR", number> = constTruthyBool()
		? Task.Validation.make.passed(42)
		: Task.Validation.make.failed("INIT_ERR");

	const recovered = pipe(
		initial,
		Task.Validation.recover((_errors) =>
			constTruthyBool() ? Task.Validation.make.passed("fallback") : Task.Validation.make.failed("RECOVER_ERR" as const)
		),
	);
	expectTypeOf(recovered).toEqualTypeOf<Task.Validation<"RECOVER_ERR", number | string>>();

	const recoveredInfallible = pipe(
		initial,
		Task.Validation.recover((_errors) => Task.Validation.make.passed("fallback")),
	);
	expectTypeOf(recoveredInfallible).toEqualTypeOf<Task.Validation<never, number | string>>();

	const recoveredUnless = pipe(
		initial,
		Task.Validation.recoverUnless((_errors) => true, () => Task.Validation.make.passed("fallback")),
	);
	expectTypeOf(recoveredUnless).toEqualTypeOf<Task.Validation<"INIT_ERR", number | string>>();
});

test("from converters: converts nullable, Predicate, Maybe, Result, and Validation to Task.Validation", () => {
	// from.nullable
	const nullableVal: string | null = "abc";
	const resNullable = Task.Validation.from.nullable(() => "is_null" as const)(nullableVal);
	expectTypeOf(resNullable).toEqualTypeOf<Task.Validation<"is_null", string>>();

	const nullLiteral = null;
	const resNull = Task.Validation.from.nullable(() => "is_null" as const)(nullLiteral);
	expectTypeOf(resNull).toEqualTypeOf<Task.Validation<"is_null", never>>();
});

test("struct: preserves heterogeneous error unions and object shapes", () => {
	const taskA: Task.Validation<"ERR_A", number> = constTruthyBool()
		? Task.Validation.make.passed(1)
		: Task.Validation.make.failed("ERR_A");
	const taskB: Task.Validation<"ERR_B", string> = constTruthyBool()
		? Task.Validation.make.passed("foo")
		: Task.Validation.make.failed("ERR_B");

	const structured = Task.Validation.struct({ a: taskA, b: taskB });
	expectTypeOf(structured).toEqualTypeOf<Task.Validation<"ERR_A" | "ERR_B", { a: number; b: string; }>>();
});

test("to.Result: converts to Task.Result while accumulating errors", () => {
	const input: Task.Validation<string, number> = constTruthyBool()
		? Task.Validation.make.passed(100)
		: Task.Validation.make.failed("err");

	const converted = pipe(input, Task.Validation.to.Result((errs) => errs.join("; ")));
	expectTypeOf(converted).toEqualTypeOf<Task.Result<string, number>>();
});

test("negative: flags invalid transforms and non-Task.Validation struct fields", () => {
	const task = Task.Validation.make.passed(42);

	// @ts-expect-error Map transform must be a function
	expectTypeOf(Task.Validation.map(123)(task)).toBeFunction();

	// @ts-expect-error Struct field values must be Task.Validation instances
	expectTypeOf(Task.Validation.struct({ a: 123 })).toBeFunction();
});

test("struct: empty fields collapse the error channel to never", () => {
	expectTypeOf(Task.Validation.struct({})).toEqualTypeOf<Task.Validation<never, {}>>();
});

test("matchValue: infers payload channels from the task", () => {
	const task = constTruthyBool() ? Task.Validation.make.passed(42) : Task.Validation.make.failed("ERR_A");

	const unified = Task.Validation.matchValue(task, {
		passed: (value) => {
			expectTypeOf(value).toEqualTypeOf<number>();
			return `passed:${value}`;
		},
		failed: (errors) => {
			expectTypeOf(errors[0]).toEqualTypeOf<"ERR_A">();
			return `failed:${errors.length}`;
		},
	});
	expectTypeOf(unified).toEqualTypeOf<Task<string>>();
});

test("matchValue: unifies distinct handler returns into one type", () => {
	const task = constTruthyBool() ? Task.Validation.make.passed(42) : Task.Validation.make.failed("ERR_A");

	const code = Task.Validation.matchValue(task, { passed: (value) => value, failed: (errors) => errors.length });
	expectTypeOf(code).toEqualTypeOf<Task<number>>();
});

test("match: pipe form unifies disjoint handler returns when one handler annotates the union", () => {
	const task: Task.Validation<"ERR_A", number> = constTruthyBool()
		? Task.Validation.make.passed(42)
		: Task.Validation.make.failed("ERR_A");

	const payload = pipe(
		task,
		Task.Validation.match({ passed: (value) => value, failed: (errors): number | "ERR_A" => errors[0] }),
	);
	expectTypeOf(payload).toEqualTypeOf<Task<number | "ERR_A">>();
});

test("match: curried pipe form unifies handler returns into one type", () => {
	const task: Task.Validation<"ERR_A", number> = constTruthyBool()
		? Task.Validation.make.passed(42)
		: Task.Validation.make.failed("ERR_A");

	const piped = pipe(
		task,
		Task.Validation.match({ passed: (v) => `passed:${v}`, failed: (errs) => `failed:${errs.length}` }),
	);
	expectTypeOf(piped).toEqualTypeOf<Task<string>>();
});

test("matchValue: negative — requires every handler", () => {
	const task = constTruthyBool() ? Task.Validation.make.passed(42) : Task.Validation.make.failed("ERR_A");

	// @ts-expect-error Missing 'failed' handler in matchValue cases
	expectTypeOf(Task.Validation.matchValue(task, { passed: () => 0 })).toBeFunction();
});

test("matchValue: auto-unifies disjoint handler returns into their union", () => {
	const task = constTruthyBool() ? Task.Validation.make.passed(42) : Task.Validation.make.failed("ERR_A");

	const out = Task.Validation.matchValue(task, { passed: (v) => v, failed: (errs) => errs[0] });
	expectTypeOf(out).toEqualTypeOf<Task<number | "ERR_A">>();
});
