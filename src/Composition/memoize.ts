import { storeLru, touchLru } from "../internal/lru.ts";

/**
 * Creates a memoized version of a function that caches results.
 * Subsequent calls with the same argument return the cached result.
 *
 * By default, uses the argument directly as the cache key.
 * For complex arguments, provide a custom `keyBy` to generate cache keys.
 *
 * @example
 * ```ts
 * // Basic usage
 * const expensive = memoize((n: number) => {
 *   console.log("Computing...");
 *   return n * 2;
 * });
 *
 * expensive(5); // logs "Computing...", returns 10
 * expensive(5); // returns 10 (cached, no log)
 * expensive(3); // logs "Computing...", returns 6
 *
 * // With custom key function for objects
 * const format = memoize(
 *   (item: { price: number; currency: string }) => `${item.currency}${item.price.toFixed(2)}`,
 *   { keyBy: (item) => `${item.currency}:${item.price}` }
 * );
 * // With bounded cache size (LRU eviction)
 * const bounded = memoize(
 *   (n: number) => n * 2,
 *   { maxSize: 100 }
 * );
 * ```
 */
export const memoize = <A, B>(f: (a: A) => B, options?: {
	/**
	 * Maps an argument to the value used as its cache key. Defaults to the argument itself.
	 */
	readonly keyBy?: (a: A) => unknown;
	/**
	 * Maximum number of entries to store before evicting the least recently used entry.
	 * Fractional values are floored; `0` disables caching; `Infinity` means unbounded.
	 * Negative or `NaN` values disable caching.
	 */
	readonly maxSize?: number;
}): (a: A) => B => {
	const cache = new Map<unknown, B>();
	const keyBy = options?.keyBy ?? ((a: A) => a);
	const rawMaxSize = options?.maxSize;
	const maxSize = rawMaxSize === undefined || rawMaxSize === Infinity
		? undefined
		: Number.isFinite(rawMaxSize)
		? Math.max(0, Math.floor(rawMaxSize))
		: 0;

	return (a: A): B => {
		if (maxSize === 0) { return f(a); }

		const key = keyBy(a);

		if (cache.has(key)) {
			const cached = cache.get(key)!;
			if (maxSize !== undefined) {
				touchLru(cache, key);
			}
			return cached;
		}

		const result = f(a);
		if (maxSize === undefined) {
			cache.set(key, result);
		} else {
			storeLru(cache, key, result, maxSize);
		}
		return result;
	};
};

/**
 * Creates a memoized version of a function using WeakMap.
 * Only works with object arguments, but allows garbage collection
 * of cached values when keys are no longer referenced.
 *
 * @example
 * ```ts
 * type User = { id: number; name: string };
 * const expensiveOperation = (u: User) => u.name.toUpperCase();
 *
 * const processUser = memoizeWeak((user: User) => {
 *   return expensiveOperation(user);
 * });
 *
 * const user = { id: 1, name: "Alice" };
 * processUser(user); // computed
 * processUser(user); // cached
 * // When `user` is garbage collected, cached result is too
 * ```
 */
export const memoizeWeak = <A extends object, B>(f: (a: A) => B): (a: A) => B => {
	const cache = new WeakMap<A, B>();

	return (a: A): B => {
		if (cache.has(a)) {
			return cache.get(a)!;
		}

		const result = f(a);
		cache.set(a, result);
		return result;
	};
};
