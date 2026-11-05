import { pipe } from "#composition";
import { Maybe } from "#core";
import { Dict } from "#data";
import * as fc from "fast-check";
import { test } from "vitest";
import { assertEquivalent } from "./equivalence.ts";

const pipeFn = pipe;
const dictFromEntries = Dict.from.entries;
const dictLookup = Dict.lookup;
const dictMap = Dict.map;
const dictFilter = Dict.filter;
const dictUnion = Dict.union;
const dictIntersection = Dict.intersection;
const dictCompact = Dict.compact;
const dictReduce = Dict.reduce;
const dictReduceWithKey = Dict.reduceWithKey;
const dictInsert = Dict.insert;
const dictGroupBy = Dict.groupBy;

const makeDict = (n: number): ReadonlyMap<string, number> =>
	dictFromEntries(Array.from({ length: n }, (_, i) => [`key${i}`, i]));

// varied fixtures — generated once at module load, non-sequential keys and values
const [variedEntries100] = fc.sample(
	fc.array(fc.tuple(fc.string({ minLength: 1, maxLength: 10 }), fc.integer()), { minLength: 100, maxLength: 100 }),
	1,
	{ seed: 42 },
) as [[string, number][]];
const [variedEntries10k] = fc.sample(
	fc.array(fc.tuple(fc.string({ minLength: 1, maxLength: 10 }), fc.integer()), { minLength: 10_000, maxLength: 10_000 }),
	1,
	{ seed: 42 },
) as [[string, number][]];
const variedDict100 = dictFromEntries(variedEntries100);
const variedDict10k = dictFromEntries(variedEntries10k);

const dict100 = makeDict(100);
const dict10k = makeDict(10_000);
const dictA100 = makeDict(50);
const dictB100 = dictFromEntries(Array.from({ length: 50 }, (_, i) => [`key${i + 25}`, i + 1000]));
const dictA10k = makeDict(5000);
const dictB10k = dictFromEntries(Array.from({ length: 5000 }, (_, i) => [`key${i + 2500}`, i + 10_000]));
const optDict100 = dictFromEntries<string, Maybe<number>>(
	Array.from({ length: 100 }, (_, i) => [`key${i}`, i % 3 === 0 ? Maybe.make.none() : Maybe.make.some(i)]),
);
const optDict10k = dictFromEntries<string, Maybe<number>>(
	Array.from({ length: 10_000 }, (_, i) => [`key${i}`, i % 3 === 0 ? Maybe.make.none() : Maybe.make.some(i)]),
);
const data100 = Array.from({ length: 100 }, (_, i) => i);
const data10k = Array.from({ length: 10_000 }, (_, i) => i);

const isEven = (value: number) => value % 2 === 0;
const currentLookup = (dict: ReadonlyMap<string, number>, key: string) => pipeFn(dict, dictLookup(key));
const nativeLookup = (dict: ReadonlyMap<string, number>, key: string) => {
	const value = dict.get(key);
	return value !== undefined || dict.has(key) ? { kind: "Some" as const, value } : { kind: "None" as const };
};
const currentMap = (dict: ReadonlyMap<string, number>) => pipeFn(dict, dictMap((n) => n * 2));
const spreadMap = (dict: ReadonlyMap<string, number>) =>
	new globalThis.Map([...dict].map(([k, v]) => [k, v * 2] as const));
const forOfMap = (dict: ReadonlyMap<string, number>) => {
	const result = new globalThis.Map<string, number>();
	for (const [k, v] of dict) {
		result.set(k, v * 2);
	}
	return result;
};
const forEachMap = (dict: ReadonlyMap<string, number>) => {
	const result = new globalThis.Map<string, number>();
	dict.forEach((v, k) => result.set(k, v * 2));
	return result;
};
const currentFilter = (dict: ReadonlyMap<string, number>) => pipeFn(dict, dictFilter(isEven));
const nativeFilter = (dict: ReadonlyMap<string, number>) => {
	const result = new globalThis.Map<string, number>();
	for (const [k, v] of dict) {
		if (v % 2 === 0) { result.set(k, v); }
	}
	return result;
};
const currentUnion = (first: ReadonlyMap<string, number>, second: ReadonlyMap<string, number>) =>
	pipeFn(first, dictUnion(second));
const nativeUnion = (first: ReadonlyMap<string, number>, second: ReadonlyMap<string, number>) => {
	const result = new globalThis.Map(first);
	for (const [k, v] of second) {
		result.set(k, v);
	}
	return result;
};
const currentIntersection = (first: ReadonlyMap<string, number>, second: ReadonlyMap<string, number>) =>
	pipeFn(first, dictIntersection(second));
const nativeIntersection = (first: ReadonlyMap<string, number>, second: ReadonlyMap<string, number>) => {
	const result = new globalThis.Map<string, number>();
	for (const [k, v] of first) {
		if (second.has(k)) { result.set(k, v); }
	}
	return result;
};
const nativeCompact = (dict: ReadonlyMap<string, Maybe<number>>) => {
	const result = new globalThis.Map<string, number>();
	for (const [k, v] of dict) {
		if (v.kind === "Some") { result.set(k, v.value); }
	}
	return result;
};
const nativeReduceValues = (dict: ReadonlyMap<string, number>) => {
	let acc = 0;
	for (const v of dict.values()) { acc += v; }
	return acc;
};
const nativeReduceEntries = (dict: ReadonlyMap<string, number>) => {
	let acc = 0;
	for (const [, v] of dict) { acc += v; }
	return acc;
};
const nativeInsert = (dict: ReadonlyMap<string, number>) => {
	const result = new globalThis.Map(dict);
	result.set("newKey", 999);
	return result;
};
const currentGroupBy = (items: readonly number[]) => pipeFn(items, dictGroupBy((n) => n % 10));
const nativeGroupBy = (items: readonly number[]) => globalThis.Map.groupBy(items, (n) => n % 10);
const manualGroupBy = (items: readonly number[]) => {
	const result = new globalThis.Map<number, number[]>();
	for (const n of items) {
		const key = n % 10;
		const group = result.get(key);
		if (group !== undefined) { group.push(n); }
		else { result.set(key, [n]); }
	}
	return result;
};

// =============================================================================
// lookup (hit)
// =============================================================================

test("dict-lookup-100-hit", async ({ bench }) => {
	assertEquivalent("dict-lookup-100-hit", currentLookup(dict100, "key50"), nativeLookup(dict100, "key50"));
	await bench.compare(
		bench("1. (current) Dict.lookup 100 (hit)", () => currentLookup(dict100, "key50")),
		bench("2. native map.get 100 (hit)", () => nativeLookup(dict100, "key50")),
	);
});

test("dict-lookup-10k-hit", async ({ bench }) => {
	assertEquivalent("dict-lookup-10k-hit", currentLookup(dict10k, "key5000"), nativeLookup(dict10k, "key5000"));
	await bench.compare(
		bench("1. (current) Dict.lookup 10k (hit)", () => currentLookup(dict10k, "key5000")),
		bench("2. native map.get 10k (hit)", () => nativeLookup(dict10k, "key5000")),
	);
});

test("dict-lookup-100-miss", async ({ bench }) => {
	assertEquivalent("dict-lookup-100-miss", currentLookup(dict100, "missing"), nativeLookup(dict100, "missing"));
	await bench.compare(
		bench("1. (current) Dict.lookup 100 (miss)", () => currentLookup(dict100, "missing")),
		bench("2. native map.get 100 (miss)", () => nativeLookup(dict100, "missing")),
	);
});

test("dict-lookup-10k-miss", async ({ bench }) => {
	assertEquivalent("dict-lookup-10k-miss", currentLookup(dict10k, "missing"), nativeLookup(dict10k, "missing"));
	await bench.compare(
		bench("1. (current) Dict.lookup 10k (miss)", () => currentLookup(dict10k, "missing")),
		bench("2. native map.get 10k (miss)", () => nativeLookup(dict10k, "missing")),
	);
});

test("dict-map-100", async ({ bench }) => {
	assertEquivalent("dict-map-100", currentMap(dict100), spreadMap(dict100));
	await bench.compare(
		bench("1. (current) Dict.map 100", () => currentMap(dict100)),
		bench("2. native map spread 100", () => spreadMap(dict100)),
	);
});

test("dict-map-10k", async ({ bench }) => {
	assertEquivalent("dict-map-10k", currentMap(dict10k), spreadMap(dict10k));
	await bench.compare(
		bench("1. (current) Dict.map 10k", () => currentMap(dict10k)),
		bench("2. native map spread 10k", () => spreadMap(dict10k)),
	);
});

test("dict-map-approaches-10k", async ({ bench }) => {
	const expected = currentMap(dict10k);
	assertEquivalent("dict-map-approaches/for-of", forOfMap(dict10k), expected);
	assertEquivalent("dict-map-approaches/spread", spreadMap(dict10k), expected);
	assertEquivalent("dict-map-approaches/for-each", forEachMap(dict10k), expected);
	await bench.compare(
		bench("1. (current) Dict.map for-of loop 10k", () => forOfMap(dict10k)),
		bench("2. spread + array map 10k", () => spreadMap(dict10k)),
		bench("3. forEach 10k", () => forEachMap(dict10k)),
	);
});

test("dict-filter-100", async ({ bench }) => {
	assertEquivalent("dict-filter-100", currentFilter(dict100), nativeFilter(dict100));
	await bench.compare(
		bench("1. (current) Dict.filter 100", () => currentFilter(dict100)),
		bench("2. native filter loop 100", () => nativeFilter(dict100)),
	);
});

test("dict-filter-10k", async ({ bench }) => {
	assertEquivalent("dict-filter-10k", currentFilter(dict10k), nativeFilter(dict10k));
	await bench.compare(
		bench("1. (current) Dict.filter 10k", () => currentFilter(dict10k)),
		bench("2. native filter loop 10k", () => nativeFilter(dict10k)),
	);
});

test("dict-union-100", async ({ bench }) => {
	assertEquivalent("dict-union-100", currentUnion(dictA100, dictB100), nativeUnion(dictA100, dictB100));
	await bench.compare(
		bench("1. (current) Dict.union 100", () => currentUnion(dictA100, dictB100)),
		bench("2. native union loop 100", () => nativeUnion(dictA100, dictB100)),
	);
});

test("dict-union-10k", async ({ bench }) => {
	assertEquivalent("dict-union-10k", currentUnion(dictA10k, dictB10k), nativeUnion(dictA10k, dictB10k));
	await bench.compare(
		bench("1. (current) Dict.union 10k", () => currentUnion(dictA10k, dictB10k)),
		bench("2. native union loop 10k", () => nativeUnion(dictA10k, dictB10k)),
	);
});

test("dict-intersection-100", async ({ bench }) => {
	assertEquivalent(
		"dict-intersection-100",
		currentIntersection(dict100, dictA100),
		nativeIntersection(dict100, dictA100),
	);
	await bench.compare(
		bench("1. (current) Dict.intersection 100", () => currentIntersection(dict100, dictA100)),
		bench("2. native intersection loop 100", () => nativeIntersection(dict100, dictA100)),
	);
});

test("dict-intersection-10k", async ({ bench }) => {
	assertEquivalent(
		"dict-intersection-10k",
		currentIntersection(dict10k, dictA10k),
		nativeIntersection(dict10k, dictA10k),
	);
	await bench.compare(
		bench("1. (current) Dict.intersection 10k", () => currentIntersection(dict10k, dictA10k)),
		bench("2. native intersection loop 10k", () => nativeIntersection(dict10k, dictA10k)),
	);
});

test("dict-compact-100", async ({ bench }) => {
	assertEquivalent("dict-compact-100", dictCompact(optDict100), nativeCompact(optDict100));
	await bench.compare(
		bench("1. (current) Dict.compact 100", () => dictCompact(optDict100)),
		bench("2. native compact loop 100", () => nativeCompact(optDict100)),
	);
});

test("dict-compact-10k", async ({ bench }) => {
	assertEquivalent("dict-compact-10k", dictCompact(optDict10k), nativeCompact(optDict10k));
	await bench.compare(
		bench("1. (current) Dict.compact 10k", () => dictCompact(optDict10k)),
		bench("2. native compact loop 10k", () => nativeCompact(optDict10k)),
	);
});

test("dict-reduce-100", async ({ bench }) => {
	const expected = nativeReduceValues(dict100);
	assertEquivalent("dict-reduce-100/reduce", dictReduce(0, (acc: number, v: number) => acc + v)(dict100), expected);
	assertEquivalent(
		"dict-reduce-100/reduceWithKey",
		dictReduceWithKey(0, (acc: number, v: number) => acc + v)(dict100),
		expected,
	);
	assertEquivalent("dict-reduce-100/entries", nativeReduceEntries(dict100), expected);
	await bench.compare(
		bench("1. (current) Dict.reduce 100 (sum)", () => dictReduce(0, (acc: number, v: number) => acc + v)(dict100)),
		bench(
			"2. (current) Dict.reduceWithKey 100 (sum)",
			() => dictReduceWithKey(0, (acc: number, v: number) => acc + v)(dict100),
		),
		bench("3. native values() loop 100", () => nativeReduceValues(dict100)),
		bench("4. native entries() loop 100", () => nativeReduceEntries(dict100)),
	);
});

test("dict-reduce-10k", async ({ bench }) => {
	const expected = nativeReduceValues(dict10k);
	assertEquivalent("dict-reduce-10k/reduce", dictReduce(0, (acc: number, v: number) => acc + v)(dict10k), expected);
	assertEquivalent(
		"dict-reduce-10k/reduceWithKey",
		dictReduceWithKey(0, (acc: number, v: number) => acc + v)(dict10k),
		expected,
	);
	assertEquivalent("dict-reduce-10k/entries", nativeReduceEntries(dict10k), expected);
	await bench.compare(
		bench("1. (current) Dict.reduce 10k (sum)", () => dictReduce(0, (acc: number, v: number) => acc + v)(dict10k)),
		bench(
			"2. (current) Dict.reduceWithKey 10k (sum)",
			() => dictReduceWithKey(0, (acc: number, v: number) => acc + v)(dict10k),
		),
		bench("3. native values() loop 10k", () => nativeReduceValues(dict10k)),
		bench("4. native entries() loop 10k", () => nativeReduceEntries(dict10k)),
	);
});

test("dict-insert-100", async ({ bench }) => {
	assertEquivalent("dict-insert-100", pipeFn(dict100, dictInsert("newKey", 999)), nativeInsert(dict100));
	await bench.compare(
		bench("1. (current) Dict.insert 100", () => pipeFn(dict100, dictInsert("newKey", 999))),
		bench("2. native insert clone 100", () => nativeInsert(dict100)),
	);
});

test("dict-insert-10k", async ({ bench }) => {
	assertEquivalent("dict-insert-10k", pipeFn(dict10k, dictInsert("newKey", 999)), nativeInsert(dict10k));
	await bench.compare(
		bench("1. (current) Dict.insert 10k", () => pipeFn(dict10k, dictInsert("newKey", 999))),
		bench("2. native insert clone 10k", () => nativeInsert(dict10k)),
	);
});

test("dict-groupBy-100", async ({ bench }) => {
	assertEquivalent("dict-groupBy-100", currentGroupBy(data100), nativeGroupBy(data100));
	await bench.compare(
		bench("1. (current) Dict.groupBy 100", () => currentGroupBy(data100)),
		bench("2. native Map.groupBy 100", () => nativeGroupBy(data100)),
	);
});

test("dict-groupBy-10k", async ({ bench }) => {
	assertEquivalent("dict-groupBy-10k", currentGroupBy(data10k), nativeGroupBy(data10k));
	await bench.compare(
		bench("1. (current) Dict.groupBy 10k", () => currentGroupBy(data10k)),
		bench("2. native Map.groupBy 10k", () => nativeGroupBy(data10k)),
	);
});

test("dict-groupBy-approaches-10k", async ({ bench }) => {
	const expected = currentGroupBy(data10k);
	assertEquivalent("dict-groupBy-approaches/manual", manualGroupBy(data10k), expected);
	assertEquivalent("dict-groupBy-approaches/native", nativeGroupBy(data10k), expected);
	await bench.compare(
		bench("1. manual loop groupBy 10k", () => manualGroupBy(data10k)),
		bench("2. native Map.groupBy 10k", () => nativeGroupBy(data10k)),
	);
});

// =============================================================================
// varied fixtures (seeded fast-check, non-sequential string keys)
// =============================================================================

test("dict-lookup-varied-100-hit", async ({ bench }) => {
	const key = variedEntries100[50][0];
	assertEquivalent("dict-lookup-varied-100-hit", currentLookup(variedDict100, key), nativeLookup(variedDict100, key));
	await bench.compare(
		bench("1. (current) Dict.lookup varied 100 (hit)", () => currentLookup(variedDict100, key)),
		bench("2. native map.get varied 100 (hit)", () => nativeLookup(variedDict100, key)),
	);
});

test("dict-lookup-varied-100-miss", async ({ bench }) => {
	assertEquivalent(
		"dict-lookup-varied-100-miss",
		currentLookup(variedDict100, "__missing__"),
		nativeLookup(variedDict100, "__missing__"),
	);
	await bench.compare(
		bench("1. (current) Dict.lookup varied 100 (miss)", () => currentLookup(variedDict100, "__missing__")),
		bench("2. native map.get varied 100 (miss)", () => nativeLookup(variedDict100, "__missing__")),
	);
});

test("dict-filter-varied-10k", async ({ bench }) => {
	assertEquivalent("dict-filter-varied-10k", currentFilter(variedDict10k), nativeFilter(variedDict10k));
	await bench.compare(
		bench("1. (current) Dict.filter varied 10k", () => currentFilter(variedDict10k)),
		bench("2. native filter loop varied 10k", () => nativeFilter(variedDict10k)),
	);
});
