/**
 * Applies an input to an array of functions and collects the results into a tuple.
 *
 * Typed tuples cover up to four functions; a longer homogeneous list falls back to a plain
 * array of the first function's return type.
 *
 * @example
 * ```ts
 * const nameParts = juxt([
 *   (name: string) => name.split(" ")[0],
 *   (name: string) => name.split(" ").slice(1).join(" "),
 * ]);
 *
 * nameParts("Alice Smith"); // ["Alice", "Smith"]
 * ```
 */
export function juxt<A, B, C>(fns: readonly [(a: A) => B, (a: A) => C]): (a: A) => [B, C];
export function juxt<A, B, C, D>(fns: readonly [(a: A) => B, (a: A) => C, (a: A) => D]): (a: A) => [B, C, D];
export function juxt<A, B, C, D, E>(
	fns: readonly [(a: A) => B, (a: A) => C, (a: A) => D, (a: A) => E],
): (a: A) => [B, C, D, E];
export function juxt<A, B>(fns: ReadonlyArray<(a: A) => B>): (a: A) => B[];
export function juxt<A>(fns: ReadonlyArray<(a: A) => unknown>): (a: A) => unknown[] {
	switch (fns.length) {
		case 2: {
			const [first, second] = fns;
			return (a: A) => [first(a), second(a)];
		}
		case 3: {
			const [first, second, third] = fns;
			return (a: A) => [first(a), second(a), third(a)];
		}
		case 4: {
			const [first, second, third, fourth] = fns;
			return (a: A) => [first(a), second(a), third(a), fourth(a)];
		}
	}
	return (a: A) => {
		const results = new Array<unknown>(fns.length);
		for (let i = 0; i < fns.length; i++) {
			results[i] = fns[i](a);
		}
		return results;
	};
}
