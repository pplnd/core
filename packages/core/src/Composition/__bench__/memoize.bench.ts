import { memoize, memoizeWeak } from "#composition";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

// Vitest's module runner resolves imported bindings through getters on every access.
const memoizeFn = memoize;
const memoizeWeakFn = memoizeWeak;

const keys256 = Array.from({ length: 256 }, (_, i) => i);
const keys2048 = Array.from({ length: 2048 }, (_, i) => i);
const double = (n: number) => n * 2;

// Shipped: has + get on a plain value cache.
const currentHit = memoizeFn(double);
// Rejected alternative: one lookup per hit, paid for with a boxed entry allocated on every miss.
const boxedHit = (() => {
	const cache = new Map<number, { value: number; }>();
	return (n: number): number => {
		const entry = cache.get(n);
		if (entry !== undefined) {
			return entry.value;
		}
		const result = double(n);
		cache.set(n, { value: result });
		return result;
	};
})();

const currentLru = memoizeFn(double, { maxSize: 1024 });
const boxedLru = (() => {
	const cache = new Map<number, { value: number; }>();
	const maxSize = 1024;
	return (n: number): number => {
		const entry = cache.get(n);
		if (entry !== undefined) {
			cache.delete(n);
			cache.set(n, entry);
			return entry.value;
		}
		const result = double(n);
		cache.set(n, { value: result });
		for (const oldest of cache.keys()) {
			if (cache.size <= maxSize) {
				break;
			}
			cache.delete(oldest);
		}
		return result;
	};
})();

const weakKey = { id: 1 };
const currentWeak = memoizeWeakFn((key: { id: number; }) => key.id * 2);
// Same logic written inline: shows the closure dispatch is the entire cost.
const inlineWeak = (() => {
	const cache = new WeakMap<object, number>();
	return (key: { id: number; }): number => {
		if (cache.has(key)) {
			return cache.get(key)!;
		}
		const result = key.id * 2;
		cache.set(key, result);
		return result;
	};
})();

test("memoize-cache-hit", async ({ bench }) => {
	for (const key of keys256) {
		currentHit(key);
		boxedHit(key);
	}
	let cursor = 0;
	const nextKey = () => {
		cursor = (cursor + 1) & 255;
		return keys256[cursor];
	};
	assertEquivalent("memoize-cache-hit", currentHit(7), boxedHit(7));
	await bench.compare(
		bench("1. (current) has + get", () => currentHit(nextKey())),
		bench("2. boxed entry, single lookup (rejected)", () => boxedHit(nextKey())),
	);
});

test("memoize-lru-churn", async ({ bench }) => {
	let cursor = 0;
	const nextKey = () => {
		cursor = (cursor + 1) & 2047;
		return keys2048[cursor];
	};
	assertEquivalent("memoize-lru-churn", currentLru(3), boxedLru(3));
	await bench.compare(
		bench("1. (current) has + get LRU churn 2048 keys", () => currentLru(nextKey())),
		bench("2. boxed entry LRU churn 2048 keys (rejected)", () => boxedLru(nextKey())),
	);
});

test("memoizeWeak-cache-hit", async ({ bench }) => {
	assertEquivalent("memoizeWeak-cache-hit", currentWeak(weakKey), inlineWeak(weakKey));
	await bench.compare(
		bench("1. (current) memoizeWeak hit", () => currentWeak(weakKey)),
		bench("2. inline WeakMap hit", () => inlineWeak(weakKey)),
	);
});
