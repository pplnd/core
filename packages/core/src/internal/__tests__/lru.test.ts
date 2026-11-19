import { expect, test } from "vitest";
import { storeLru, touchLru } from "../lru.ts";

test("touchLru: moves an existing key to the most recently used position", () => {
	const cache = new Map<string, number>([["a", 1], ["b", 2]]);

	touchLru(cache, "a");

	expect([...cache.keys()]).toStrictEqual(["b", "a"]);
	expect(cache.get("a")).toBe(1);
});

test("touchLru: leaves a missing key and the order untouched", () => {
	const cache = new Map<string, number>([["a", 1]]);

	touchLru(cache, "missing");

	expect([...cache.keys()]).toStrictEqual(["a"]);
	expect(cache.size).toBe(1);
});

test("touchLru: preserves a stored undefined value", () => {
	const cache = new Map<string, number | undefined>([["a", undefined], ["b", 2]]);

	touchLru(cache, "a");

	expect([...cache.keys()]).toStrictEqual(["b", "a"]);
	expect(cache.has("a")).toBe(true);
});

test("storeLru: inserts at the most recently used position and evicts from the front", () => {
	const cache = new Map<string, number>([["a", 1], ["b", 2]]);

	storeLru(cache, "c", 3, 2);

	expect([...cache.entries()]).toStrictEqual([["b", 2], ["c", 3]]);
});

test("storeLru: reinserting an existing key refreshes it", () => {
	const cache = new Map<string, number>([["a", 1], ["b", 2]]);

	storeLru(cache, "a", 10, 2);

	expect([...cache.entries()]).toStrictEqual([["b", 2], ["a", 10]]);
});

test("storeLru: keeps every entry when the store fits the limit", () => {
	const cache = new Map<string, number>([["a", 1]]);

	storeLru(cache, "b", 2, Number.POSITIVE_INFINITY);

	expect([...cache.entries()]).toStrictEqual([["a", 1], ["b", 2]]);
});
