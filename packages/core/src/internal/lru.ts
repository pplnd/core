/**
 * Moves an existing key to the most recently used position of a `Map` used as an LRU store.
 * A missing key is left untouched.
 */
export const touchLru = <K, V>(cache: Map<K, V>, key: K): void => {
	if (!cache.has(key)) {
		return;
	}
	const value = cache.get(key)!;
	cache.delete(key);
	cache.set(key, value);
};

/**
 * Inserts a key as the most recently used entry and evicts the oldest entries until the store
 * fits `maxSize`.
 *
 * The store's iteration order is its recency order: the first key is the least recently used.
 */
export const storeLru = <K, V>(cache: Map<K, V>, key: K, value: V, maxSize: number): void => {
	cache.delete(key);
	cache.set(key, value);
	for (const oldest of cache.keys()) {
		if (cache.size <= maxSize) {
			break;
		}
		cache.delete(oldest);
	}
};
