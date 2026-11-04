/**
 * Executes a function on the piped value if a predicate is met, otherwise returns the value unchanged.
 *
 * @example
 * ```ts
 * pipe(
 *   4,
 *   when(n => n % 2 === 0, n => n * 2)
 * ); // 8
 *
 * pipe(
 *   3,
 *   when(n => n % 2 === 0, n => n * 2)
 * ); // 3
 * ```
 *
 * @see {@link unless} for executing when a predicate is not met
 */
export function when<A, B extends A, C>(
	predicate: (value: A) => value is B,
	onTrue: (value: B) => C,
): (value: A) => Exclude<A, B> | C;
export function when<A, B = A>(
	predicate: (value: A) => boolean,
	onTrue: (value: A) => B,
): <V extends A>(value: V) => V | B;
export function when<A, B = A>(predicate: (value: A) => boolean, onTrue: (value: A) => B) {
	return <V extends A>(value: V): V | B => (predicate(value) ? onTrue(value) : value);
}
