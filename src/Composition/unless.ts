/**
 * Executes a function on the piped value if a predicate is NOT met, otherwise returns the value unchanged.
 *
 * @example
 * ```ts
 * pipe(
 *   5,
 *   unless(n => n % 2 === 0, n => n * 2)
 * ); // 10
 *
 * pipe(
 *   4,
 *   unless(n => n % 2 === 0, n => n * 2)
 * ); // 4
 * ```
 *
 * @see {@link when} for executing when a predicate is met
 */
export function unless<A, B extends A, C>(
	predicate: (value: A) => value is B,
	onFalse: (value: Exclude<A, B>) => C,
): (value: A) => B | C;
export function unless<A, B = A>(
	predicate: (value: A) => boolean,
	onFalse: (value: A) => B,
): <V extends A>(value: V) => V | B;
// The overloads narrow the true branch to B; the implementation only sees a boolean predicate.
// oxlint-disable-next-line no-explicit-any
export function unless(...args: readonly any[]): any {
	const [predicate, onFalse] = args as [(value: unknown) => boolean, (value: unknown) => unknown];
	return (value: unknown): unknown => (predicate(value) ? value : onFalse(value));
}
