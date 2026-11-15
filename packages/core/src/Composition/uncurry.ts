/**
 * Converts a curried function into a multi-argument function.
 * By default flattens two argument stages. Pass `3` or `4` as the second argument for deeper
 * currying.
 *
 * The returned value is never inspected or invoked. A curried factory that returns a thunk or a
 * `Task` keeps returning that function; `uncurry` only flattens the chosen number of outer stages.
 *
 * @example
 * ```ts
 * const curriedAdd = (a: number) => (b: number) => a + b;
 * uncurry(curriedAdd)(1, 2); // 3
 *
 * // A returned thunk stays a thunk:
 * const factory = (id: string) => (attempt: number) => () => `${id}:${attempt}`;
 * const load = uncurry(factory)("user-1", 2);
 * load(); // "user-1:2"
 *
 * // Three stages require an explicit arity:
 * const format = (a: string) => (b: string) => (c: string) => `${a}-${b}-${c}`;
 * uncurry(format, 3)("A", "B", "C"); // "A-B-C"
 * ```
 *
 * @see {@link flip} for reversing curried argument order
 */
export function uncurry<A, B, C>(f: (a: A) => (b: B) => C): (a: A, b: B) => C;
export function uncurry<A, B, C, D>(f: (a: A) => (b: B) => (c: C) => D, arity: 3): (a: A, b: B, c: C) => D;
export function uncurry<A, B, C, D, E>(
	f: (a: A) => (b: B) => (c: C) => (d: D) => E,
	arity: 4,
): (a: A, b: B, c: C, d: D) => E;
export function uncurry(f: (...args: any[]) => any, arity = 2) {
	if (arity === 2) {
		return (a: any, b: any) => f(a)(b);
	}
	if (arity === 3) {
		return (a: any, b: any, c: any) => f(a)(b)(c);
	}
	if (arity === 4) {
		return (a: any, b: any, c: any, d: any) => f(a)(b)(c)(d);
	}
	throw new TypeError("[uncurry] Unsupported arity; pass 2, 3, or 4.");
}
