/**
 * Converts a 2-, 3-, or 4-argument function into a curried function.
 * The inverse of `uncurry`.
 *
 * Arity is read from `Function.prototype.length`. Functions with rest or default parameters report
 * an unreliable length, so pass the intended arity explicitly. Only arities 2, 3, and 4 are
 * supported; any other inferred arity throws instead of invoking the function early.
 *
 * @example
 * ```ts
 * const add = (a: number, b: number) => a + b;
 * const curriedAdd = curry(add);
 * curriedAdd(1)(2); // 3
 *
 * // Partial application
 * const addTen = curriedAdd(10);
 * addTen(5); // 15
 *
 * // Rest or default parameters need an explicit arity
 * const tupleSum = (...values: [number, number, number]) => values[0] + values[1] + values[2];
 * curry(tupleSum, 3)(1)(2)(3); // 6
 * ```
 *
 * @see {@link uncurry} for the inverse operation
 */
export function curry<A, B, C>(f: (a: A, b: B) => C, arity?: 2): (a: A) => (b: B) => C;
export function curry<A, B, C, D>(f: (a: A, b: B, c: C) => D, arity?: 3): (a: A) => (b: B) => (c: C) => D;
export function curry<A, B, C, D, E>(
	f: (a: A, b: B, c: C, d: D) => E,
	arity?: 4,
): (a: A) => (b: B) => (c: C) => (d: D) => E;
export function curry(f: (...args: any[]) => any, arity?: number) {
	const expected = arity ?? f.length;
	if (expected === 2) {
		return (a: any) => (b: any) => f(a, b);
	}
	if (expected === 3) {
		return (a: any) => (b: any) => (c: any) => f(a, b, c);
	}
	if (expected === 4) {
		return (a: any) => (b: any) => (c: any) => (d: any) => f(a, b, c, d);
	}
	throw new TypeError("[curry] Function arity is ambiguous; pass an explicit arity of 2, 3, or 4.");
}
