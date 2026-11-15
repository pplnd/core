import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { type Maybe } from "../Maybe.ts";
import { Task } from "../Task.ts";

test("make: infers Task.Maybe variant types", async () => {
	const someTask = Task.Maybe.make.some(42);
	expectTypeOf(someTask).toEqualTypeOf<Task.Maybe<number>>();

	const noneTask = Task.Maybe.make.none<number>();
	expectTypeOf(noneTask).toEqualTypeOf<Task.Maybe<number>>();

	const res = await someTask();
	expectTypeOf(res).toEqualTypeOf<Maybe<number>>();
});

test("map & chain: propagates and transforms inner value", () => {
	const taskNum = Task.Maybe.make.some(42);

	const mapped = pipe(taskNum, Task.Maybe.map((n) => n.toString()));
	expectTypeOf(mapped).toEqualTypeOf<Task.Maybe<string>>();

	const chained = pipe(taskNum, Task.Maybe.chain((n) => Task.Maybe.make.some(n > 0)));
	expectTypeOf(chained).toEqualTypeOf<Task.Maybe<boolean>>();
});

test("filter: narrows type when passed a type guard refinement", () => {
	const isString = (val: unknown): val is string => typeof val === "string";
	const input: Task.Maybe<unknown> = Task.Maybe.make.some("hello");
	const narrowed = pipe(input, Task.Maybe.filter(isString));
	expectTypeOf(narrowed).toEqualTypeOf<Task.Maybe<string>>();
});

test("struct: combines record of Task.Maybes into single record", () => {
	const structured = Task.Maybe.struct({ a: Task.Maybe.make.some(1), b: Task.Maybe.make.some("foo") });
	expectTypeOf(structured).toEqualTypeOf<Task.Maybe<{ a: number; b: string; }>>();
});

test("assign & assignTo: accumulates pipeline object record correctly", () => {
	const bound = pipe(
		Task.Maybe.make.some(42),
		Task.Maybe.assignTo("a"),
		Task.Maybe.assign("b", ({ a }) => Task.Maybe.make.some(a.toString())),
	);
	expectTypeOf(bound).toEqualTypeOf<Task.Maybe<{ a: number; } & { b: string; }>>();
	expectTypeOf(bound).toMatchTypeOf<Task.Maybe<{ a: number; b: string; }>>();
});

test("negative: flags invalid transforms and non-Task.Maybe struct fields", () => {
	const task = Task.Maybe.make.some(42);

	// @ts-expect-error Map transform must be a function
	expectTypeOf(Task.Maybe.map(123)(task)).toBeFunction();

	// @ts-expect-error Chain transform must return a Task.Maybe
	expectTypeOf(Task.Maybe.chain((n: number) => n * 2)(task)).toBeFunction();

	// @ts-expect-error Struct field values must be Task.Maybe instances
	expectTypeOf(Task.Maybe.struct({ a: 123 })).toBeFunction();
});

test("from.nullable: strips null and undefined from the success channel", () => {
	expectTypeOf(Task.Maybe.from.nullable(null)).toEqualTypeOf<Task.Maybe<never>>();
});

test("to.Result: absent success channel stays never", () => {
	const result = Task.Maybe.to.Result(() => "missing")(Task.Maybe.make.none());
	expectTypeOf(result).toEqualTypeOf<Task.Result<"missing", never>>();
});

test("matchValue: infers the value channel from the task", () => {
	const task = constTruthyBool() ? Task.Maybe.make.some(42) : Task.Maybe.make.none<number>();

	const unified = Task.Maybe.matchValue(task, {
		some: (value) => {
			expectTypeOf(value).toEqualTypeOf<number>();
			return `got:${value}`;
		},
		none: () => "empty",
	});
	expectTypeOf(unified).toEqualTypeOf<Task<string>>();
});

test("matchValue: unifies distinct handler returns into one type", () => {
	const task = constTruthyBool() ? Task.Maybe.make.some(42) : Task.Maybe.make.none<number>();

	const code = Task.Maybe.matchValue(task, { some: (value) => value, none: () => 0 });
	expectTypeOf(code).toEqualTypeOf<Task<number>>();
});

test("match: pipe form unifies disjoint handler returns when one handler annotates the union", () => {
	const task: Task.Maybe<number> = constTruthyBool() ? Task.Maybe.make.some(42) : Task.Maybe.make.none<number>();

	const payload = pipe(task, Task.Maybe.match({ some: (value) => value, none: (): number | string => "empty" }));
	expectTypeOf(payload).toEqualTypeOf<Task<number | string>>();
});

test("match: curried pipe form unifies handler returns into one type", () => {
	const task: Task.Maybe<number> = constTruthyBool() ? Task.Maybe.make.some(42) : Task.Maybe.make.none<number>();

	const piped = pipe(task, Task.Maybe.match({ some: (v) => `got:${v}`, none: () => "empty" }));
	expectTypeOf(piped).toEqualTypeOf<Task<string>>();
});

test("matchValue: negative — requires every handler", () => {
	const task = constTruthyBool() ? Task.Maybe.make.some(42) : Task.Maybe.make.none<number>();

	// @ts-expect-error Missing 'some' handler in matchValue cases
	expectTypeOf(Task.Maybe.matchValue(task, { none: () => 0 })).toBeFunction();
});

test("matchValue: auto-unifies disjoint handler returns into their union", () => {
	const task = constTruthyBool() ? Task.Maybe.make.some(42) : Task.Maybe.make.none<number>();

	const out = Task.Maybe.matchValue(task, { some: (v) => v, none: () => "empty" });
	expectTypeOf(out).toEqualTypeOf<Task<number | string>>();
});
