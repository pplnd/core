import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { pipe } from "../../Composition/pipe.ts";
import { Maybe } from "../Maybe.ts";
import { RemoteData } from "../RemoteData.ts";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";
import { Validation } from "../Validation.ts";

test("error constructors retain literals and allow explicitly widened values", () => {
	const error = { code: "INVALID", details: ["missing"] };
	const widenedCode = String("INVALID");
	const literal = Result.make.err({ code: "INVALID", details: ["missing"] });
	expectTypeOf(literal).toEqualTypeOf<
		Result.Err<{ readonly code: "INVALID"; readonly details: readonly ["missing"]; }>
	>();
	expectTypeOf(Result.make.err(error)).toEqualTypeOf<Result.Err<{ code: string; details: string[]; }>>();
	expectTypeOf(Result.make.err(widenedCode)).toEqualTypeOf<Result.Err<string>>();
	expectTypeOf(Result.make.err<{ code: string; }>({ code: "INVALID" })).toEqualTypeOf<Result.Err<{ code: string; }>>();
	expectTypeOf(Validation.make.failed("INVALID")).toEqualTypeOf<Validation.Failed<"INVALID">>();
	expectTypeOf(RemoteData.make.failure("INVALID")).toEqualTypeOf<RemoteData.Failure<"INVALID">>();
	expectTypeOf(Task.Result.make.err("INVALID")).toEqualTypeOf<Task.Result<"INVALID", never>>();
	expectTypeOf(Task.Validation.make.failed("INVALID")).toEqualTypeOf<Task.Validation<"INVALID", never>>();
});

test("Maybe converters preserve errors and allow wider callback return types", () => {
	const maybe = constTruthyBool() ? Maybe.make.some(Number("42")) : Maybe.make.none();
	expectTypeOf(pipe(maybe, Maybe.to.Result(() => "MISSING"))).toEqualTypeOf<Result<"MISSING", number>>();
	expectTypeOf(pipe(maybe, Maybe.to.Validation(() => "MISSING"))).toEqualTypeOf<Validation<"MISSING", number>>();
	expectTypeOf(pipe(maybe, Maybe.to.Result((): { code: string; } => ({ code: "MISSING" })))).toEqualTypeOf<
		Result<{ code: string; }, number>
	>();
	expectTypeOf(pipe(maybe, Maybe.to.Validation(() => ({ code: "MISSING" })))).toEqualTypeOf<
		Validation<{ readonly code: "MISSING"; }, number>
	>();
});

test("Result boundaries preserve errors and predicate refinements", () => {
	const isString = (value: unknown): value is string => typeof value === "string";
	const maybe = constTruthyBool() ? Maybe.make.some(Number("42")) : Maybe.make.none();
	expectTypeOf(Result.from.nullable(() => "MISSING")(null)).toEqualTypeOf<Result<"MISSING", never>>();
	expectTypeOf(Result.from.Maybe(() => "MISSING")(maybe)).toEqualTypeOf<Result<"MISSING", number>>();
	expectTypeOf(Result.from.Predicate(isString, () => "INVALID")(Number("42"))).toEqualTypeOf<
		Result<"INVALID", string>
	>();
	expectTypeOf(Result.from.Predicate((n: number) => n > 0, () => "INVALID")(42)).toEqualTypeOf<
		Result<"INVALID", number>
	>();
	expectTypeOf(Result.tryCatch(() => Number("42"), { onError: () => ({ code: "BAD" }) })).toEqualTypeOf<
		Result<{ readonly code: "BAD"; }, number>
	>();
	const input = constTruthyBool() ? Result.make.ok(Number("42")) : Result.make.err("ORIGINAL");
	expectTypeOf(pipe(input, Result.ensure((n) => n > 0, () => "INVALID"))).toEqualTypeOf<
		Result<"ORIGINAL" | "INVALID", number>
	>();
	const uncertain = constTruthyBool() ? Result.make.ok<unknown>("value") : Result.make.err("ORIGINAL");
	expectTypeOf(pipe(uncertain, Result.ensure(isString, () => "INVALID"))).toEqualTypeOf<
		Result<"ORIGINAL" | "INVALID", string>
	>();
});

test("Validation boundaries retain errors and predicate refinements", () => {
	const isString = (value: unknown): value is string => typeof value === "string";
	const maybe = constTruthyBool() ? Maybe.make.some(Number("42")) : Maybe.make.none();
	expectTypeOf(Validation.from.nullable(() => "MISSING")(null)).toEqualTypeOf<Validation<"MISSING", never>>();
	expectTypeOf(Validation.from.Maybe(() => "MISSING")(maybe)).toEqualTypeOf<Validation<"MISSING", number>>();
	expectTypeOf(Validation.from.Predicate(isString, () => "INVALID")(42)).toEqualTypeOf<Validation<"INVALID", string>>();
	expectTypeOf(Validation.from.Predicate((n: number) => n > 0, () => "INVALID")(42)).toEqualTypeOf<
		Validation<"INVALID", number>
	>();
	expectTypeOf(Validation.tryCatch(() => Number("42"), { onError: () => ({ code: "BAD" }) })).toEqualTypeOf<
		Validation<{ readonly code: "BAD"; }, number>
	>();
});

test("RemoteData preserves errors through conversion and both filter overloads", () => {
	const isString = (value: unknown): value is string => typeof value === "string";
	const maybe = constTruthyBool() ? Maybe.make.some(Number("42")) : Maybe.make.none();
	expectTypeOf(RemoteData.from.Maybe(() => "MISSING")(maybe)).toEqualTypeOf<RemoteData<"MISSING", number>>();
	const input = constTruthyBool() ? RemoteData.make.success<unknown>("value") : RemoteData.make.failure("OFFLINE");
	expectTypeOf(pipe(input, RemoteData.filter(isString, () => "INVALID"))).toEqualTypeOf<
		RemoteData<"OFFLINE" | "INVALID", string>
	>();
	expectTypeOf(pipe(input, RemoteData.filter((value) => Boolean(value), () => "EMPTY"))).toEqualTypeOf<
		RemoteData<"OFFLINE" | "EMPTY", unknown>
	>();
});

test("Task error boundaries preserve literals through public specializations", () => {
	const maybe = constTruthyBool() ? Maybe.make.some(Number("42")) : Maybe.make.none();
	expectTypeOf(Task.Result.from.nullable(() => "MISSING")(Number("42"))).toEqualTypeOf<Task.Result<"MISSING", number>>();
	expectTypeOf(Task.Result.from.Maybe(() => "MISSING")(maybe)).toEqualTypeOf<Task.Result<"MISSING", number>>();
	expectTypeOf(Task.Result.tryCatch(() => Promise.resolve(42), { onError: () => ({ code: "BAD" }) })).toEqualTypeOf<
		Task.Result<{ readonly code: "BAD"; }, number>
	>();
	const input = constTruthyBool() ? Task.Result.make.ok(Number("42")) : Task.Result.make.err("OFFLINE");
	expectTypeOf(pipe(input, Task.Result.ensure((n: number) => n > 0, () => "INVALID"))).toEqualTypeOf<
		Task.Result<"OFFLINE" | "INVALID", number>
	>();
	const isString = (value: unknown): value is string => typeof value === "string";
	const uncertain = constTruthyBool() ? Task.Result.make.ok<unknown>("value") : Task.Result.make.err("OFFLINE");
	expectTypeOf(pipe(uncertain, Task.Result.ensure(isString, () => "INVALID"))).toEqualTypeOf<
		Task.Result<"OFFLINE" | "INVALID", string>
	>();
	expectTypeOf(Task.Validation.from.nullable(() => "MISSING")(null)).toEqualTypeOf<Task.Validation<"MISSING", never>>();
	expectTypeOf(Task.Validation.from.Maybe(() => "MISSING")(maybe)).toEqualTypeOf<Task.Validation<"MISSING", number>>();
	expectTypeOf(Task.Validation.tryCatch(() => Promise.resolve(42), { onError: () => ({ code: "BAD" }) })).toEqualTypeOf<
		Task.Validation<{ readonly code: "BAD"; }, number>
	>();
});
