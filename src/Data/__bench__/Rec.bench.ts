import { pipe } from "#composition";
import { Maybe } from "#core";
import { Rec } from "#data";
import { test } from "vitest";
import { assertEquivalent, sameRecordContent } from "./equivalence.ts";

const pipeFn = pipe;
const recMap = Rec.map;
const recFilter = Rec.filter;
const recCompact = Rec.compact;
const recMapKeys = Rec.mapKeys;
const recLookup = Rec.lookup;
const recGroupBy = Rec.groupBy;

const makeRec = (n: number): Record<string, number> =>
	Object.fromEntries(Array.from({ length: n }, (_, i) => [`key${i}`, i]));

const rec100 = makeRec(100);
const rec10k = makeRec(10_000);
const makeOptRec = (n: number): Record<string, Maybe<number>> =>
	Object.fromEntries(
		Array.from({ length: n }, (_, i) => [`key${i}`, i % 3 === 0 ? Maybe.make.none() : Maybe.make.some(i)]),
	);
const optRec100 = makeOptRec(100);
const optRec10k = makeOptRec(10_000);
const data10k = Array.from({ length: 10_000 }, (_, i) => i);

const double = (n: number) => n * 2;
const isEven = (n: number) => n % 2 === 0;

const currentMap = (record: Readonly<Record<string, number>>) => pipeFn(record, recMap(double));
const nativeMap = (record: Readonly<Record<string, number>>) =>
	Object.fromEntries(Object.entries(record).map(([k, v]) => [k, v * 2]));

const currentFilter = (record: Readonly<Record<string, number>>) => pipeFn(record, recFilter(isEven));
const nativeFilterEntries = (record: Readonly<Record<string, number>>) => {
	const result: Record<string, number> = {};
	for (const [k, v] of Object.entries(record)) {
		if (v % 2 === 0) { result[k] = v; }
	}
	return result;
};
const nativeFilterBitwise = (record: Readonly<Record<string, number>>) => {
	const result: Record<string, number> = {};
	for (const [k, v] of Object.entries(record)) {
		if ((v & 1) === 0) { result[k] = v; }
	}
	return result;
};
const nativeFilterKeysValues = (record: Readonly<Record<string, number>>) => {
	const result: Record<string, number> = {};
	const keys = Object.keys(record);
	const values = Object.values(record);
	for (let i = 0; i < keys.length; i++) {
		if (values[i] % 2 === 0) { result[keys[i]] = values[i]; }
	}
	return result;
};
const nativeFilterMapConversion = (record: Readonly<Record<string, number>>) => {
	const result: Record<string, number> = {};
	const map = new Map(Object.entries(record));
	map.forEach((v, k) => {
		if (v % 2 === 0) { result[k] = v; }
	});
	return result;
};

const nativeCompact = (record: Readonly<Record<string, Maybe<number>>>) => {
	const result: Record<string, number> = {};
	for (const [k, v] of Object.entries(record)) {
		if (v.kind === "Some") { result[k] = v.value; }
	}
	return result;
};

const currentMapKeys = (record: Readonly<Record<string, number>>) =>
	pipeFn(record, recMapKeys((key) => `prefix_${key}`));
const nativeMapKeys = (record: Readonly<Record<string, number>>) => {
	const result: Record<string, number> = {};
	for (const [k, v] of Object.entries(record)) {
		result[`prefix_${k}`] = v;
	}
	return result;
};

const currentLookup = (record: Readonly<Record<string, number>>, key: string) => pipeFn(record, recLookup(key));
const nativeLookup = (record: Readonly<Record<string, number>>, key: string) => {
	const hasKey = Object.hasOwn(record, key);
	const value = record[key];
	return hasKey ? { kind: "Some" as const, value } : { kind: "None" as const };
};

const currentGroupBy = (items: readonly number[]) => pipeFn(items, recGroupBy((n) => String(n % 10)));
const nativeGroupBy = (items: readonly number[]) => Object.groupBy(items, (n) => String(n % 10));
const manualGroupBy = (items: readonly number[]) => {
	const result: Record<string, number[]> = {};
	for (const n of items) {
		const key = String(n % 10);
		if (key in result) { result[key].push(n); }
		else { result[key] = [n]; }
	}
	return result;
};

// =============================================================================
// map
// =============================================================================

test("rec-map-100", async ({ bench }) => {
	assertEquivalent("rec-map-100", currentMap(rec100), nativeMap(rec100));
	await bench.compare(
		bench("1. (current) Rec.map 100", () => currentMap(rec100)),
		bench("2. native Object.fromEntries map 100", () => nativeMap(rec100)),
	);
});

test("rec-map-10k", async ({ bench }) => {
	assertEquivalent("rec-map-10k", currentMap(rec10k), nativeMap(rec10k));
	await bench.compare(
		bench("1. (current) Rec.map 10k", () => currentMap(rec10k)),
		bench("2. native Object.fromEntries map 10k", () => nativeMap(rec10k)),
	);
});

test("rec-filter-10k", async ({ bench }) => {
	assertEquivalent("rec-filter-10k", currentFilter(rec10k), nativeFilterEntries(rec10k));
	await bench.compare(
		bench("1. (current) Rec.filter 10k", () => currentFilter(rec10k)),
		bench("2. native filter loop 10k", () => nativeFilterEntries(rec10k)),
	);
});

test("rec-filter-approaches-10k", async ({ bench }) => {
	const expected = currentFilter(rec10k);
	assertEquivalent("rec-filter-approaches/bitwise", nativeFilterBitwise(rec10k), expected);
	assertEquivalent("rec-filter-approaches/keys-values", nativeFilterKeysValues(rec10k), expected);
	assertEquivalent("rec-filter-approaches/map-conversion", nativeFilterMapConversion(rec10k), expected);
	await bench.compare(
		bench("1. Map filter 10k (with conversion)", () => nativeFilterMapConversion(rec10k)),
		bench("2. Object.entries filter 10k (bitwise)", () => nativeFilterBitwise(rec10k)),
		bench("3. Object.entries for-of filter 10k", () => nativeFilterEntries(rec10k)),
		bench("4. keys+values index filter 10k", () => nativeFilterKeysValues(rec10k)),
	);
});

test("rec-compact-100", async ({ bench }) => {
	assertEquivalent("rec-compact-100", recCompact(optRec100), nativeCompact(optRec100));
	await bench.compare(
		bench("1. (current) Rec.compact 100", () => recCompact(optRec100)),
		bench("2. native compact loop 100", () => nativeCompact(optRec100)),
	);
});

test("rec-compact-10k", async ({ bench }) => {
	assertEquivalent("rec-compact-10k", recCompact(optRec10k), nativeCompact(optRec10k));
	await bench.compare(
		bench("1. (current) Rec.compact 10k", () => recCompact(optRec10k)),
		bench("2. native compact loop 10k", () => nativeCompact(optRec10k)),
	);
});

test("rec-mapKeys-10k", async ({ bench }) => {
	assertEquivalent("rec-mapKeys-10k", currentMapKeys(rec10k), nativeMapKeys(rec10k));
	await bench.compare(
		bench("1. (current) Rec.mapKeys 10k", () => currentMapKeys(rec10k)),
		bench("2. native mapKeys loop 10k", () => nativeMapKeys(rec10k)),
	);
});

test("rec-lookup-100-hit", async ({ bench }) => {
	assertEquivalent("rec-lookup-100-hit", currentLookup(rec100, "key50"), nativeLookup(rec100, "key50"));
	await bench.compare(
		bench("1. (current) Rec.lookup 100 (hit)", () => currentLookup(rec100, "key50")),
		bench("2. native lookup 100 (hit)", () => nativeLookup(rec100, "key50")),
	);
});

test("rec-groupBy-10k", async ({ bench }) => {
	assertEquivalent("rec-groupBy-10k", currentGroupBy(data10k), nativeGroupBy(data10k), sameRecordContent);
	await bench.compare(
		bench("1. (current) Rec.groupBy 10k", () => currentGroupBy(data10k)),
		bench("2. native Object.groupBy 10k", () => nativeGroupBy(data10k)),
	);
});

test("rec-groupBy-approaches-10k", async ({ bench }) => {
	const expected = currentGroupBy(data10k);
	assertEquivalent("rec-groupBy-approaches/manual", manualGroupBy(data10k), expected, sameRecordContent);
	assertEquivalent("rec-groupBy-approaches/native", nativeGroupBy(data10k), expected, sameRecordContent);
	await bench.compare(
		bench("1. manual loop groupBy 10k", () => manualGroupBy(data10k)),
		bench("2. native Object.groupBy 10k", () => nativeGroupBy(data10k)),
	);
});
