// =============================================================================
// Imports
// =============================================================================
import type { KeysOfUnion, NonEmptyArr, WithError, WithKind, WithValue } from "../internal/InternalTypes";
import { type Maybe, Maybe as CoreMaybe } from "./Maybe.ts";
import type { Predicate } from "./Predicate.ts";
import type { Refinement } from "./Refinement.ts";
import { type Validation, Validation as CoreValidation } from "./Validation.ts";

// =============================================================================
// Types
// =============================================================================
/**
 * Result represents a value that can be one of two types: a success (Ok) or a failure (Err).
 * Use Result when an operation can fail with a meaningful error value.
 *
 * @example
 * ```ts
 * const divide = (a: number, b: number): Result<string, number> =>
 *   b === 0 ? Result.make.err("Division by zero") : Result.make.ok(a / b);
 *
 * pipe(
 *   divide(10, 2),
 *   Result.map(n => n * 2),
 *   Result.getOrElse(() => 0)
 * ); // 10
 * ```
 */
export type Result<E, A> = Result.Ok<A> | Result.Err<E>;

export namespace Result {
	/** Represents a successful outcome holding a value. */
	export type Ok<A> = WithKind<"Ok"> & WithValue<A>;
	/** Represents a failed outcome holding an error. */
	export type Err<E> = WithKind<"Err"> & WithError<E>;
}

// =============================================================================
// Private Helpers & Variant Constructors
// =============================================================================

const makeOk = <A>(value: A): Result.Ok<A> => ({ kind: "Ok", value });
const makeErr = <const E>(error: E): Result.Err<E> => ({ kind: "Err", error });

const isOk = <E, A>(result: Result<E, A>): result is Result.Ok<A> => result.kind === "Ok";
const isErr = <E, A>(result: Result<E, A>): result is Result.Err<E> => result.kind === "Err";

type StructErrorOf<T> = T extends Result.Err<infer E> ? E : never;
type StructValueOf<T> = T extends Result.Ok<infer A> ? A : never;

// =============================================================================
// Public Export
// =============================================================================
export const Result = {
	make: {
		/**
		 * Creates a successful Result with the given value.
		 *
		 * @example
		 * ```ts
		 * Result.make.ok(42); // Ok(42)
		 * ```
		 */
		ok: makeOk,

		/**
		 * Creates a failed Result with the given error.
		 *
		 * @example
		 * ```ts
		 * Result.make.err("Error message"); // Err("Error message")
		 * ```
		 */
		err: makeErr,
	},

	is: {
		/**
		 * Type guard that checks if a Result is Ok.
		 *
		 * @see {@link Result.is.err} to check if a Result is an Err failure.
		 *
		 * @example
		 * ```ts
		 * const res = Result.make.ok(42);
		 * if (Result.is.ok(res)) {
		 *   console.log(res.value); // 42
		 * }
		 * ```
		 */
		ok: isOk,

		/**
		 * Type guard that checks if a Result is Err.
		 *
		 * @see {@link Result.is.ok} to check if a Result is an Ok success.
		 *
		 * @example
		 * ```ts
		 * const res = Result.make.err("failed");
		 * if (Result.is.err(res)) {
		 *   console.log(res.error); // "failed"
		 * }
		 * ```
		 */
		err: isErr,
	},

	/**
	 * Creates a Result from a synchronous thunk that may throw.
	 * Catches any errors and transforms them using the `onError` function.
	 *
	 * @example
	 * ```ts
	 * const result = Result.tryCatch(
	 *   () => JSON.parse(rawString),
	 *   { onError: (error) => `Parse error: ${error}` }
	 * );
	 * ```
	 */
	tryCatch: <const E, A>(operation: () => A, options: { onError: (error: unknown) => E; }): Result<E, A> => {
		try {
			return makeOk(operation());
		} catch (error) {
			return makeErr(options.onError(error));
		}
	},

	/**
	 * Transforms the success value inside a Result.
	 *
	 * @see {@link Result.chain} to sequence operations that themselves return a Result.
	 * @see {@link Result.mapError} to transform the error value instead of the success value.
	 *
	 * @example
	 * ```ts
	 * pipe(Result.make.ok(5), Result.map(n => n * 2)); // Ok(10)
	 * pipe(Result.make.err("error"), Result.map(n => n * 2)); // Err("error")
	 * ```
	 */
	map: <A, B>(transform: (value: A) => B) => <E = never>(result: Result<E, A>): Result<E, B> =>
		isOk(result) ? makeOk(transform(result.value)) : result,

	/**
	 * Transforms the error value inside a Result.
	 *
	 * @see {@link Result.map} to transform the success value instead of the error value.
	 *
	 * @example
	 * ```ts
	 * pipe(Result.make.err("oops"), Result.mapError(e => e.toUpperCase())); // Err("OOPS")
	 * ```
	 */
	mapError: <E, F>(transform: (error: E) => F) => <A = never>(result: Result<E, A>): Result<F, A> =>
		isErr(result) ? makeErr(transform(result.error)) : result,

	/**
	 * Chains Result computations. If the first is Ok, passes the value to transform.
	 * If the first is Err, propagates the error.
	 *
	 * @see {@link Result.map} to transform the inner value without returning a new Result.
	 *
	 * @example
	 * ```ts
	 * const validatePositive = (n: number): Result<string, number> =>
	 *   n > 0 ? Result.make.ok(n) : Result.make.err("Must be positive");
	 *
	 * pipe(Result.make.ok(5), Result.chain(validatePositive)); // Ok(5)
	 * pipe(Result.make.ok(-1), Result.chain(validatePositive)); // Err("Must be positive")
	 * ```
	 */
	chain:
		<E2 = never, A = unknown, B = unknown>(transform: (value: A) => Result<E2, B>) =>
		<E1 = never>(result: Result<E1, A>): Result<E1 | E2, B> => isOk(result) ? transform(result.value) : result,

	/**
	 * Pattern matches on a Result, returning the result of the matching case.
	 *
	 * @see {@link Result.getOrElse} to extract the success value with a default fallback.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   result,
	 *   Result.match({
	 *     ok: value => `Got ${value}`,
	 *     err: error => `Failed: ${error}`
	 *   })
	 * );
	 * ```
	 */
	match: <E, A, B>(cases: { ok: (value: A) => B; err: (error: E) => B; }) => (result: Result<E, A>): B =>
		isOk(result) ? cases.ok(result.value) : cases.err(result.error),

	/**
	 * Returns the success value or a default value if the Result is an error.
	 * The default is a thunk `() => B` — evaluated only when the Result is Err.
	 * The default can be a different type, widening the result to `A | B`.
	 *
	 * @see {@link Result.match} to handle both the Ok and Err cases.
	 *
	 * @example
	 * ```ts
	 * pipe(Result.make.ok(5), Result.getOrElse(() => 0)); // 5
	 * pipe(Result.make.err("error"), Result.getOrElse(() => 0)); // 0
	 * pipe(Result.make.err("error"), Result.getOrElse(() => null)); // null — typed as number | null
	 * ```
	 */
	getOrElse: <B>(fallback: () => B) => <A = never, E = never>(result: Result<E, A>): A | B =>
		isOk(result) ? result.value : fallback(),

	/**
	 * Executes a side effect on the success value without changing the Result.
	 * Useful for logging or debugging.
	 *
	 * @see {@link Result.tapError} to perform a side effect on the error value.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Result.make.ok(5),
	 *   Result.tap(n => console.log("Value:", n)),
	 *   Result.map(n => n * 2)
	 * );
	 * ```
	 */
	tap: <A>(sideEffect: (value: A) => void) => <E = never>(result: Result<E, A>): Result<E, A> => {
		if (isOk(result)) { sideEffect(result.value); }
		return result;
	},

	/**
	 * Executes a side effect on the error value without changing the Result.
	 * Useful for logging or reporting errors.
	 *
	 * @see {@link Result.tap} to perform a side effect on the success value.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Result.make.err("not found"),
	 *   Result.tapError(e => console.error("validation failed:", e)),
	 *   Result.chain(save),
	 * )
	 * ```
	 */
	tapError: <E>(sideEffect: (error: E) => void) => <A = never>(result: Result<E, A>): Result<E, A> => {
		if (isErr(result)) { sideEffect(result.error); }
		return result;
	},

	// --- from ---
	from: {
		/**
		 * Creates a Result from a predicate or type guard applied to a value.
		 * Returns Ok if the predicate passes, Err from onFalse otherwise.
		 *
		 * @see {@link Result.ensure} to validate and filter an existing Result.
		 *
		 * @example
		 * ```ts
		 * pipe(5, Result.from.Predicate(n => n > 0, n => `${n} is not positive`));  // Ok(5)
		 * pipe(-1, Result.from.Predicate(n => n > 0, n => `${n} is not positive`)); // Err("-1 is not positive")
		 * pipe("", Result.from.Predicate(s => s.length > 0, () => "empty string")); // Err("empty string")
		 * ```
		 */
		Predicate:
			(<A, B extends A, const E>(predicate: Predicate<A>, onFalse: (value: A) => E) => (value: A): Result<E, B> =>
				predicate(value) ? makeOk(value as unknown as B) : makeErr(onFalse(value))) as {
					<A, B extends A, const E>(refinement: Refinement<A, B>, onFalse: (value: A) => E): (value: A) => Result<E, B>;
					<A, const E>(predicate: Predicate<A>, onFalse: (value: A) => E): (value: A) => Result<E, A>;
				},

		/**
		 * Creates a Result from a nullable value.
		 * Returns Ok if the value is not null or undefined, error from onNull otherwise.
		 *
		 * @see {@link Result.from.Maybe} to convert an optional Maybe into a Result.
		 * @see {@link Result.from.Predicate} to validate and lift values into a Result based on a predicate.
		 *
		 * @example
		 * ```ts
		 * pipe(null, Result.from.nullable(() => "is null")); // Err("is null")
		 * pipe(42, Result.from.nullable(() => "is null"));   // Ok(42)
		 * ```
		 */
		nullable: <const E>(onNull: () => E) => <A>(value: A): Result<E, NonNullable<A>> =>
			value === null || value === undefined ? makeErr(onNull()) : makeOk(value as NonNullable<A>),

		/**
		 * Creates a Result from a Maybe.
		 * Some becomes Ok, None becomes error from onNone.
		 *
		 * @see {@link Result.to.Maybe} to convert a Result back into a Maybe.
		 *
		 * @example
		 * ```ts
		 * pipe(Maybe.make.none(), Result.from.Maybe(() => "is none")); // Err("is none")
		 * pipe(Maybe.make.some(42), Result.from.Maybe(() => "is none")); // Ok(42)
		 * ```
		 */
		Maybe: <const E>(onNone: () => E) => <A>(maybe: Maybe<A>): Result<E, A> =>
			CoreMaybe.is.none(maybe) ? makeErr(onNone()) : makeOk(maybe.value),

		/**
		 * Converts a `Validation` to a `Result`, combining accumulated errors using `combineErrors`.
		 * `Passed(a)` becomes `Ok(a)`; `Failed(errors)` becomes `Err(combineErrors(errors))`.
		 *
		 * @see {@link Result.to.Validation} to convert a Result into a Validation.
		 *
		 * @example
		 * ```ts
		 * Result.from.Validation((errors) => errors.join(", "))(Validation.make.failed("error1")); // Err("error1")
		 * ```
		 */
		Validation:
			<E1, E2>(combineErrors: (errors: NonEmptyArr<E1>) => E2) =>
			<A = never>(validation: Validation<E1, A>): Result<E2, A> =>
				CoreValidation.is.passed(validation) ? makeOk(validation.value) : makeErr(combineErrors(validation.errors)),
	},

	/**
	 * Recovers from an error by providing a fallback Result.
	 * The fallback can produce a different success type or resolve with a different error type.
	 *
	 * @see {@link Result.recoverUnless} to conditionally recover based on the error value.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Result.make.err("not found"),
	 *   Result.recover((e) => Result.make.ok(`default for ${e}`))
	 * ); // Ok("default for not found")
	 * ```
	 */
	recover:
		<E1, B, E2 = never>(fallback: (error: E1) => Result<E2, B>) =>
		<A = never>(result: Result<E1, A>): Result<E2, A | B> => isOk(result) ? result : fallback(result.error),

	/**
	 * Recovers from an error unless the predicate `isBlocked` returns true for that error.
	 *
	 * @see {@link Predicate} to build reusable error tests from combinators.
	 * The fallback can produce a different success type, widening the result to `Result<E1 | E2, A | B>`.
	 *
	 * @see {@link Result.recover} for unconditional error recovery.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Result.make.err(new Error("not found")),
	 *   Result.recoverUnless(e => e.message === "fatal", () => Result.make.ok(0))
	 * ); // Ok(0)
	 * ```
	 */
	recoverUnless:
		<E1, B, E2 = never>(isBlocked: Predicate<E1>, fallback: (error: E1) => Result<E2, B>) =>
		<A = never>(result: Result<E1, A>): Result<E1 | E2, A | B> =>
			isErr(result) && !isBlocked(result.error) ? fallback(result.error) : result,

	// --- to ---
	to: {
		/**
		 * Converts a Result to a Maybe.
		 * Ok becomes Some, Err becomes None (the error is discarded).
		 *
		 * @see {@link Result.from.Maybe} to convert a Maybe into a Result.
		 *
		 * @example
		 * ```ts
		 * Result.to.Maybe(Result.make.ok(42)); // Some(42)
		 * Result.to.Maybe(Result.make.err("oops")); // None
		 * ```
		 */
		Maybe: <A = never, E = never>(result: Result<E, A>): Maybe<A> =>
			isOk(result) ? CoreMaybe.make.some(result.value) : CoreMaybe.make.none(),
		/**
		 * Converts a `Result` to a `Validation`. `Ok(a)` becomes `Passed(a)`; `Err(e)` becomes `Failed([e])`.
		 *
		 * @see {@link Result.from.Validation} to convert a Validation into a Result.
		 *
		 * @example
		 * ```ts
		 * Result.to.Validation(Result.make.ok(42));     // Passed(42)
		 * Result.to.Validation(Result.make.err("bad")); // Failed(["bad"])
		 * ```
		 */
		Validation: <A = never, E = never>(result: Result<E, A>): Validation<E, A> => CoreValidation.from.Result(result),
	},

	// --- sequence ---
	sequence: {
		/**
		 * Swaps the outer `Result` and inner `Maybe` context.
		 * `Ok(Some(a))` becomes `Some(Ok(a))`, `Ok(None)` becomes `None`, and `Err(e)` becomes `Some(Err(e))`.
		 *
		 * @example
		 * ```ts
		 * Result.sequence.Maybe(Result.make.ok(Maybe.make.some(42))); // Some(Ok(42))
		 * Result.sequence.Maybe(Result.make.ok(Maybe.make.none()));   // None
		 * Result.sequence.Maybe(Result.make.err("error"));           // Some(Err("error"))
		 * ```
		 */
		Maybe: <E, A>(result: Result<E, Maybe<A>>): Maybe<Result<E, A>> =>
			isErr(result)
				? CoreMaybe.make.some(result)
				: (CoreMaybe.is.some(result.value) ? CoreMaybe.make.some(makeOk(result.value.value)) : CoreMaybe.make.none()),
	},

	/**
	 * Applies a function wrapped in a Result to a value wrapped in a Result.
	 *
	 * @see {@link Result.map} to apply a plain unary function to an Ok value.
	 *
	 * @example
	 * ```ts
	 * const add = (a: number) => (b: number) => a + b;
	 * pipe(
	 *   Result.make.ok(add),
	 *   Result.apply(Result.make.ok(5)),
	 *   Result.apply(Result.make.ok(3))
	 * ); // Ok(8)
	 * ```
	 */
	apply:
		<E2 = never, A = never>(arg: Result<E2, A>) =>
		<B, E1 = never>(result: Result<E1, (value: A) => B>): Result<E1 | E2, B> =>
			isOk(result) && isOk(arg) ? makeOk(result.value(arg.value)) : (isErr(result) ? result : (arg as Result.Err<E2>)),

	/**
	 * Converts a Result value into an object containing a single property.
	 * Initiates the pipeline accumulator record.
	 *
	 * @see {@link Result.assign} to append additional fields to an accumulator record.
	 *
	 * @example
	 * ```ts
	 * pipe(Result.make.ok(42), Result.assignTo("value")); // Ok({ value: 42 })
	 * ```
	 */
	assignTo: <K extends string>(key: K) => <E = never, A = unknown>(result: Result<E, A>): Result<E, { [P in K]: A; }> =>
		isOk(result) ? makeOk({ [key]: result.value } as { [P in K]: A; }) : result,

	/**
	 * Evaluates a new Result using the current accumulator and attaches the output to a new key.
	 * The key must not already exist on the accumulator — use `map` to update an existing field.
	 * The accumulator is expected to be a plain object (own enumerable properties).
	 *
	 * @see {@link Result.assignTo} to initialize a pipeline accumulator record.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Result.make.ok({ a: 1 }),
	 *   Result.assign("b", ({ a }) => Result.make.ok(a + 1))
	 * ); // Ok({ a: 1, b: 2 })
	 * ```
	 */
	assign:
		<K extends string, E2, A extends object, B>(
			key: K extends KeysOfUnion<A> ? never : K,
			transform: (value: A) => Result<E2, B>,
		) =>
		<E1 = never>(result: Result<E1, A>): Result<E1 | E2, A & { [P in K]: B; }> => {
			if (!isOk(result)) { return result; }
			const res = transform(result.value);
			if (!isOk(res)) { return res; }
			const accumulator = { ...(result.value as unknown as Record<string, unknown>), [key]: res.value } as
				& A
				& { [P in K]: B; };
			return makeOk(accumulator);
		},

	/**
	 * Combines a record of Results into a single Result of a record. Own string and symbol keys are processed in key order; inherited fields are not supported.
	 * Evaluates fields in key order and short-circuits on the first failure.
	 *
	 * @see {@link Result.assign} to combine values sequentially with inter-field dependencies.
	 *
	 * @example
	 * ```ts
	 * Result.struct({
	 *   name: Result.make.ok("Alice"),
	 *   age: Result.make.ok(30)
	 * }); // Ok({ name: "Alice", age: 30 })
	 * ```
	 */
	struct: <T extends { readonly [K in keyof T]: Result<unknown, unknown>; }>(
		fields: T,
	): Result<StructErrorOf<T[keyof T]>, { [K in keyof T]: StructValueOf<T[K]>; }> => {
		type Out = { [K in keyof T]: StructValueOf<T[K]>; };
		const result = {} as Out;
		const keys = Reflect.ownKeys(fields);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const res = fields[key as keyof T];
			if (isErr(res)) {
				return res as unknown as Result<StructErrorOf<T[keyof T]>, Out>;
			}
			result[key as keyof Out] = res.value as Out[keyof Out];
		}
		return makeOk(result);
	},

	/**
	 * Narrows an `Ok` value with a predicate, converting to `Err(onFail(value))` if the predicate returns false.
	 *
	 * @see {@link Result.from.Predicate} to lift a value into a Result based on a predicate.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Result.make.ok(15),
	 *   Result.ensure((n) => n >= 18, (n) => `Age ${n} is below 18`)
	 * ); // Err("Age 15 is below 18")
	 * ```
	 */
	ensure:
		(<A, B extends A, const E2>(predicate: Predicate<A>, onFail: (value: A) => E2) =>
		<E1 = never>(result: Result<E1, A>): Result<E1 | E2, B> =>
			isErr(result)
				? result
				: (predicate(result.value) ? (result as unknown as Result<E1 | E2, B>) : makeErr(onFail(result.value)))) as {
				<A, B extends A, const E2>(
					refinement: Refinement<A, B>,
					onFail: (value: A) => E2,
				): <E1 = never>(result: Result<E1, A>) => Result<E1 | E2, B>;
				<A, const E2>(
					predicate: (value: A) => boolean,
					onFail: (value: A) => E2,
				): <E1 = never>(result: Result<E1, A>) => Result<E1 | E2, A>;
			},

	/**
	 * Transforms both branches of a Result simultaneously.
	 * Applies `onErr` to `Err` values and `onOk` to `Ok` values.
	 *
	 * @see {@link Result.map} to transform only the success value.
	 * @see {@link Result.mapError} to transform only the error value.
	 *
	 * @example
	 * ```ts
	 * pipe(
	 *   Result.make.ok(5),
	 *   Result.mapBoth(
	 *     (e) => `Error: ${e}`,
	 *     (n) => n * 2
	 *   )
	 * ); // Ok(10)
	 * ```
	 */
	mapBoth: <E1, E2, A, B>(onErr: (error: E1) => E2, onOk: (value: A) => B) => (result: Result<E1, A>): Result<E2, B> =>
		isOk(result) ? makeOk(onOk(result.value)) : makeErr(onErr(result.error)),
};
