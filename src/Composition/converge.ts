type Transformers<A> =
	| readonly [(a: A) => unknown, (a: A) => unknown]
	| readonly [(a: A) => unknown, (a: A) => unknown, (a: A) => unknown]
	| readonly [(a: A) => unknown, (a: A) => unknown, (a: A) => unknown, (a: A) => unknown];

/**
 * Applies an input to several transformer functions independently, then passes all results to a
 * combining function. Callback parameters must be annotated; TypeScript cannot infer the shared input type from the curried transformers.
 *
 * @example
 * ```ts
 * const toNameRecord = converge(
 *   (trimmed: string, initials: string) => ({ trimmed, initials }),
 *   [
 *     (name: string) => name.trim(),
 *     (name: string) => name.split(" ").map((w) => w[0]).join(""),
 *   ],
 * );
 *
 * toNameRecord("  Alice Bob  "); // { trimmed: "Alice Bob", initials: "AB" }
 * ```
 */
export function converge<A, B, C, R>(
	f: (b: B, c: C) => R,
	transformers: readonly [(a: A) => B, (a: A) => C],
): (a: A) => R;
export function converge<A, B, C, D, R>(
	f: (b: B, c: C, d: D) => R,
	transformers: readonly [(a: A) => B, (a: A) => C, (a: A) => D],
): (a: A) => R;
export function converge<A, B, C, D, E, R>(
	f: (b: B, c: C, d: D, e: E) => R,
	transformers: readonly [(a: A) => B, (a: A) => C, (a: A) => D, (a: A) => E],
): (a: A) => R;
export function converge<A>(f: (...args: unknown[]) => unknown, transformers: Transformers<A>): (a: A) => unknown {
	switch (transformers.length) {
		case 2: {
			const [first, second] = transformers;
			return (a: A) => f(first(a), second(a));
		}
		case 3: {
			const [first, second, third] = transformers;
			return (a: A) => f(first(a), second(a), third(a));
		}
		case 4: {
			const [first, second, third, fourth] = transformers;
			return (a: A) => f(first(a), second(a), third(a), fourth(a));
		}
	}
}
