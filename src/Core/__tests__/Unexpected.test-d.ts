import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { Result } from "../Result.ts";
import { Unexpected } from "../Unexpected.ts";

test("make.execution: returns Unexpected.Execution", () => {
	const err = Unexpected.make.execution({ source: "Batcher", cause: "boom" });
	expectTypeOf(err).toEqualTypeOf<Unexpected.Execution>();
});

test("make.release: returns Unexpected.Release<Prev>", () => {
	const err = Unexpected.make.release({ cause: "boom", previous: 42 });
	expectTypeOf(err).toEqualTypeOf<Unexpected.Release<number>>();

	const defaultErr = Unexpected.make.release({ cause: "boom", previous: "prev" as unknown });
	expectTypeOf(defaultErr).toEqualTypeOf<Unexpected.Release<unknown>>();
});

test("is.unexpected: narrows unknown to Unexpected<unknown>", () => {
	const val: unknown = {};
	if (Unexpected.is.unexpected(val)) {
		expectTypeOf(val).toEqualTypeOf<Unexpected<unknown>>();
	}
});

test("is.execution: narrows to Unexpected.Execution", () => {
	const val: unknown = {};
	if (Unexpected.is.execution(val)) {
		expectTypeOf(val).toEqualTypeOf<Unexpected.Execution>();
	}
});

test("is.release: narrows to Unexpected.Release<unknown>", () => {
	const val: unknown = {};
	if (Unexpected.is.release(val)) {
		expectTypeOf(val).toEqualTypeOf<Unexpected.Release<unknown>>();
	}
});

test("is.release: preserves a known previous outcome without inventing one", () => {
	const previous = constTruthyBool() ? Result.make.ok(42) : Result.make.err("failed");
	const failure = constTruthyBool()
		? Unexpected.make.execution({ source: "Resource", cause: "work" })
		: Unexpected.make.release({ cause: "release", previous });
	if (Unexpected.is.release(failure)) {
		expectTypeOf(failure.previous).toEqualTypeOf<Result<"failed", number>>();
	}
	const value: unknown = {};
	// @ts-expect-error an unknown value cannot be asserted to have a caller-selected previous type
	Unexpected.is.release<Unexpected<Result<string, number>>>(value);
});

test("match: infers return type across variants", () => {
	const err = Unexpected.make.execution({ source: "Op", cause: "fail" }) as Unexpected<number>;
	const result = Unexpected.match({
		execution: (e) => {
			expectTypeOf(e).toEqualTypeOf<Unexpected.Execution>();
			return e.source;
		},
		release: (r: Unexpected.Release<number>) => {
			expectTypeOf(r).toEqualTypeOf<Unexpected.Release<number>>();
			return String(r.previous);
		},
	})(err);

	expectTypeOf(result).toEqualTypeOf<string>();
});

test("negative compilation checks", () => {
	// @ts-expect-error missing required source and cause
	expectTypeOf(Unexpected.make.execution).toBeCallableWith({});

	// @ts-expect-error missing required previous
	expectTypeOf(Unexpected.make.release).toBeCallableWith({ cause: "fail" });

	// @ts-expect-error invalid phase on execution
	expectTypeOf(Unexpected.make.execution).toBeCallableWith({ source: "Test", cause: "fail", phase: "invalid" });
});
