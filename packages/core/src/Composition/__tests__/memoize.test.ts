import { expect, test } from "vitest";
import { memoize, memoizeWeak } from "../memoize.ts";

// --- memoize ---

test("memoize: returns cached result without re-invoking function on cache hit", () => {
	let callCount = 0;
	const expensive = memoize((n: number) => {
		callCount++;
		return n * 2;
	});

	expect(expensive(5)).toBe(10);
	expect(callCount).toBe(1);

	expect(expensive(5)).toBe(10);
	expect(callCount).toBe(1); // not called again
});

test("memoize: computes distinct arguments independently", () => {
	let callCount = 0;
	const expensive = memoize((n: number) => {
		callCount++;
		return n * 2;
	});

	expect(expensive(5)).toBe(10);
	expect(expensive(3)).toBe(6);
	expect(expensive(7)).toBe(14);
	expect(callCount).toBe(3);

	// Cached calls
	expect(expensive(5)).toBe(10);
	expect(expensive(3)).toBe(6);
	expect(callCount).toBe(3); // no additional calls
});

test("memoize: caches string argument results", () => {
	let callCount = 0;
	const toUpper = memoize((s: string) => {
		callCount++;
		return s.toUpperCase();
	});

	expect(toUpper("hello")).toBe("HELLO");
	expect(toUpper("hello")).toBe("HELLO");
	expect(callCount).toBe(1);

	expect(toUpper("world")).toBe("WORLD");
	expect(callCount).toBe(2);
});

test("memoize: computes cache key using custom key function", () => {
	let callCount = 0;
	const getLabel = memoize((opts: { id: number; label: string; }) => {
		callCount++;
		return opts.label.toUpperCase();
	}, { keyBy: (opts) => opts.id });

	expect(getLabel({ id: 1, label: "hello" })).toBe("HELLO");
	expect(getLabel({ id: 1, label: "changed" })).toBe("HELLO"); // Cached by id
	expect(callCount).toBe(1);

	// Same id, different label object -- should use cache
	expect(getLabel({ id: 1, label: "different" })).toBe("HELLO");
	expect(callCount).toBe(1);

	// Different id -- should compute
	expect(getLabel({ id: 2, label: "world" })).toBe("WORLD");
	expect(callCount).toBe(2);
});

test("memoize: evicts oldest entry when reaching maxSize limit", () => {
	let callCount = 0;
	const cached = memoize((n: number) => {
		callCount++;
		return n * 10;
	}, { maxSize: 2 });

	expect(cached(1)).toBe(10);
	expect(cached(2)).toBe(20);
	expect(callCount).toBe(2);

	// Key 1 is accessed, refreshing its LRU priority (now keys order: 2, 1)
	expect(cached(1)).toBe(10);
	expect(callCount).toBe(2);

	// Key 3 is added -> exceeds maxSize 2 -> evicts key 2 (oldest)
	expect(cached(3)).toBe(30);
	expect(callCount).toBe(3);

	// Key 1 is still cached
	expect(cached(1)).toBe(10);
	expect(callCount).toBe(3);

	// Key 2 was evicted, so calling 2 recomputes
	expect(cached(2)).toBe(20);
	expect(callCount).toBe(4);
});

test("memoize: treats NaN and non-positive maxSize as uncached", () => {
	let nanCalls = 0;
	const nanCached = memoize((n: number) => {
		nanCalls++;
		return n;
	}, { maxSize: NaN });
	nanCached(1);
	nanCached(1);
	expect(nanCalls).toBe(2);

	let zeroCalls = 0;
	const zeroCached = memoize((n: number) => {
		zeroCalls++;
		return n;
	}, { maxSize: 0 });
	zeroCached(1);
	zeroCached(1);
	expect(zeroCalls).toBe(2);

	let negativeCalls = 0;
	const negativeCached = memoize((n: number) => {
		negativeCalls++;
		return n;
	}, { maxSize: -1 });
	negativeCached(1);
	negativeCached(1);
	expect(negativeCalls).toBe(2);
});

test("memoize: floors fractional maxSize and treats Infinity as unbounded", () => {
	let fractionalCalls = 0;
	const fractional = memoize((n: number) => {
		fractionalCalls++;
		return n;
	}, { maxSize: 1.5 });

	fractional(1);
	fractional(2);
	expect(fractionalCalls).toBe(2);
	fractional(2);
	expect(fractionalCalls).toBe(2);

	let infiniteCalls = 0;
	const unbounded = memoize((n: number) => {
		infiniteCalls++;
		return n;
	}, { maxSize: Infinity });

	unbounded(1);
	unbounded(2);
	unbounded(1);
	expect(infiniteCalls).toBe(2);
});

test("memoize: defaults to using argument directly as cache key", () => {
	let callCount = 0;
	const fn = memoize((n: number) => {
		callCount++;
		return n;
	});

	fn(1);
	fn(1);
	expect(callCount).toBe(1);

	fn(2);
	expect(callCount).toBe(2);
});

test("memoize: preserves cached falsy results", () => {
	let callCount = 0;
	const fn = memoize((n: number) => {
		callCount++;
		return n === 0 ? 0 : n > 0;
	});

	expect(fn(0)).toBe(0);
	expect(callCount).toBe(1);

	// Ensure 0 (falsy) is returned from cache
	expect(fn(0)).toBe(0);
	expect(callCount).toBe(1);
});

test("memoize: caches undefined and null return values", () => {
	let callCountA = 0;
	const fnA = memoize((_n: number) => {
		callCountA++;
	});

	expect(fnA(1)).toBeUndefined();
	expect(fnA(1)).toBeUndefined();
	expect(callCountA).toBe(1);

	let callCountB = 0;
	const fnB = memoize((_n: number) => {
		callCountB++;
		return null;
	});

	expect(fnB(1)).toBeNull();
	expect(fnB(1)).toBeNull();
	expect(callCountB).toBe(1);
});

// --- memoizeWeak ---

test("memoizeWeak: caches results by object reference identity", () => {
	let callCount = 0;
	const process = memoizeWeak((obj: { value: number; }) => {
		callCount++;
		return obj.value * 2;
	});

	const obj1 = { value: 5 };
	expect(process(obj1)).toBe(10);
	expect(callCount).toBe(1);

	expect(process(obj1)).toBe(10);
	expect(callCount).toBe(1); // cached
});

test("memoizeWeak: evaluates distinct object instances separately", () => {
	let callCount = 0;
	const process = memoizeWeak((obj: { value: number; }) => {
		callCount++;
		return obj.value * 2;
	});

	const obj1 = { value: 5 };
	const obj2 = { value: 5 }; // same shape, different reference

	expect(process(obj1)).toBe(10);
	expect(process(obj2)).toBe(10);
	expect(callCount).toBe(2); // computed for each reference
});

test("memoizeWeak: caches results keyed by array reference", () => {
	let callCount = 0;
	const sumArray = memoizeWeak((arr: number[]) => {
		callCount++;
		return arr.reduce((a, b) => a + b, 0);
	});

	const arr = [1, 2, 3];
	expect(sumArray(arr)).toBe(6);
	expect(sumArray(arr)).toBe(6);
	expect(callCount).toBe(1);
});

test("memoizeWeak: caches results keyed by function reference", () => {
	let callCount = 0;
	const describe = memoizeWeak((fn: () => void) => {
		callCount++;
		return fn.toString().length;
	});

	const fn1 = () => {};
	const fn2 = () => {};

	describe(fn1);
	describe(fn1);
	expect(callCount).toBe(1);

	describe(fn2);
	expect(callCount).toBe(2);
});

test("memoize: evicts a rejected promise so the next call retries", async () => {
	let calls = 0;
	const load = memoize((_key: string) => {
		calls++;
		return calls === 1 ? Promise.reject(new Error("blip")) : Promise.resolve("ok");
	});

	await expect(load("u_1")).rejects.toThrow("blip");
	await expect(load("u_1")).resolves.toBe("ok");
	expect(calls).toBe(2);
});

test("memoize: a late rejection does not evict a newer entry for the same key", async () => {
	let calls = 0;
	const load = memoize((key: string) => {
		calls++;
		if (key === "a" && calls === 1) {
			return new Promise<string>((_resolve, reject) => setTimeout(() => reject(new Error("late")), 10));
		}
		return Promise.resolve(`ok:${key}`);
	}, { maxSize: 1 });

	void load("a").catch(() => undefined);
	await expect(load("b")).resolves.toBe("ok:b");
	await expect(load("a")).resolves.toBe("ok:a");
	await new Promise((resolve) => setTimeout(resolve, 30));
	await expect(load("a")).resolves.toBe("ok:a");
	expect(calls).toBe(3);
});
