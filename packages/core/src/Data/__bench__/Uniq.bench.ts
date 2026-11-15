import { pipe } from "#composition";
import { Uniq } from "#data";
import * as fc from "fast-check";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

const pipeFn = pipe;
const uniqFromArray = Uniq.from.array;
const uniqHas = Uniq.has;
const uniqMap = Uniq.map;
const uniqFilter = Uniq.filter;
const uniqUnion = Uniq.union;
const uniqIntersection = Uniq.intersection;
const uniqDifference = Uniq.difference;
const uniqReduce = Uniq.reduce;
const uniqInsert = Uniq.insert;

const data100 = Array.from({ length: 100 }, (_, i) => i);
const data10k = Array.from({ length: 10_000 }, (_, i) => i);

// varied fixtures — seeded once at module load, used across bench groups.
// fast-check reads the seed from the second argument; a third argument is ignored, so
// `fc.sample(arb, 1, { seed })` silently produced random fixtures on every run.
const [variedData100] = fc.sample(fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 100, maxLength: 100 }), {
	numRuns: 1,
	seed: 42,
});
const [variedData10k] = fc.sample(
	fc.array(fc.integer({ min: 0, max: 20_000 }), { minLength: 10_000, maxLength: 10_000 }),
	{ numRuns: 1, seed: 42 },
);
const variedSet100 = uniqFromArray(variedData100);
const variedSet10k = uniqFromArray(variedData10k);

const set100 = uniqFromArray(data100);
const set10k = uniqFromArray(data10k);
const setA100 = uniqFromArray(Array.from({ length: 50 }, (_, i) => i));
const setB100 = uniqFromArray(Array.from({ length: 50 }, (_, i) => i + 25));
const setA10k = uniqFromArray(Array.from({ length: 5000 }, (_, i) => i));
const setB10k = uniqFromArray(Array.from({ length: 5000 }, (_, i) => i + 2500));

const currentHas = (set: ReadonlySet<number>, item: number) => pipeFn(set, uniqHas(item));
const nativeHas = (set: ReadonlySet<number>, item: number) => set.has(item);
const currentMap = (set: ReadonlySet<number>) => pipeFn(set, uniqMap((n) => n * 2));
const nativeMap = (set: ReadonlySet<number>) => {
	const result = new globalThis.Set<number>();
	for (const item of set) {
		result.add(item * 2);
	}
	return result;
};
const currentFilter = (set: ReadonlySet<number>) => pipeFn(set, uniqFilter((n) => n % 2 === 0));
const nativeFilter = (set: ReadonlySet<number>) => {
	const result = new globalThis.Set<number>();
	for (const item of set) {
		if (item % 2 === 0) { result.add(item); }
	}
	return result;
};
const currentUnion = (first: ReadonlySet<number>, second: ReadonlySet<number>) => pipeFn(first, uniqUnion(second));
const nativeUnion = (first: ReadonlySet<number>, second: ReadonlySet<number>) => {
	const result = new globalThis.Set(first);
	for (const item of second) {
		result.add(item);
	}
	return result;
};
const spreadUnion = (first: ReadonlySet<number>, second: ReadonlySet<number>) =>
	new globalThis.Set([...first, ...second]);
const nativeSetUnion = (first: ReadonlySet<number>, second: ReadonlySet<number>) =>
	(first as globalThis.Set<number>).union(second as globalThis.Set<number>);
const currentIntersection = (first: ReadonlySet<number>, second: ReadonlySet<number>) =>
	pipeFn(first, uniqIntersection(second));
const nativeIntersection = (first: ReadonlySet<number>, second: ReadonlySet<number>) => {
	const result = new globalThis.Set<number>();
	for (const item of first) {
		if (second.has(item)) { result.add(item); }
	}
	return result;
};
const nativeSetIntersection = (first: ReadonlySet<number>, second: ReadonlySet<number>) =>
	(first as globalThis.Set<number>).intersection(second as globalThis.Set<number>);
const currentDifference = (first: ReadonlySet<number>, second: ReadonlySet<number>) =>
	pipeFn(first, uniqDifference(second));
const nativeDifference = (first: ReadonlySet<number>, second: ReadonlySet<number>) => {
	const result = new globalThis.Set<number>();
	for (const item of first) {
		if (!second.has(item)) { result.add(item); }
	}
	return result;
};
const nativeSetDifference = (first: ReadonlySet<number>, second: ReadonlySet<number>) =>
	(first as globalThis.Set<number>).difference(second as globalThis.Set<number>);
const currentReduce = (set: ReadonlySet<number>) => uniqReduce(0, (acc: number, n: number) => acc + n)(set);
const nativeReduce = (set: ReadonlySet<number>) => {
	let acc = 0;
	for (const item of set) {
		acc += item;
	}
	return acc;
};
const currentInsert = (set: ReadonlySet<number>, item: number) => pipeFn(set, uniqInsert(item));
const nativeInsert = (set: ReadonlySet<number>, item: number) => {
	if (set.has(item)) { return set; }
	const result = new globalThis.Set(set);
	result.add(item);
	return result;
};

// =============================================================================
// from.array
// =============================================================================

test("uniq-from.array-100", async ({ bench }) => {
	assertEquivalent("uniq-from.array-100", uniqFromArray(data100), new globalThis.Set(data100));
	await bench.compare(
		bench("1. (current) Uniq.from.array 100", () => uniqFromArray(data100)),
		bench("2. native new Set 100", () => new globalThis.Set(data100)),
	);
});

test("uniq-from.array-10k", async ({ bench }) => {
	assertEquivalent("uniq-from.array-10k", uniqFromArray(data10k), new globalThis.Set(data10k));
	await bench.compare(
		bench("1. (current) Uniq.from.array 10k", () => uniqFromArray(data10k)),
		bench("2. native new Set 10k", () => new globalThis.Set(data10k)),
	);
});

test("uniq-has-100-hit", async ({ bench }) => {
	assertEquivalent("uniq-has-100-hit", currentHas(set100, 50), nativeHas(set100, 50));
	await bench.compare(
		bench("1. (current) Uniq.has 100 (present)", () => currentHas(set100, 50)),
		bench("2. native set.has 100 (present)", () => nativeHas(set100, 50)),
	);
});

test("uniq-has-100-miss", async ({ bench }) => {
	assertEquivalent("uniq-has-100-miss", currentHas(set100, 9999), nativeHas(set100, 9999));
	await bench.compare(
		bench("1. (current) Uniq.has 100 (absent)", () => currentHas(set100, 9999)),
		bench("2. native set.has 100 (absent)", () => nativeHas(set100, 9999)),
	);
});

test("uniq-has-10k-hit", async ({ bench }) => {
	assertEquivalent("uniq-has-10k-hit", currentHas(set10k, 5000), nativeHas(set10k, 5000));
	await bench.compare(
		bench("1. (current) Uniq.has 10k (present)", () => currentHas(set10k, 5000)),
		bench("2. native set.has 10k (present)", () => nativeHas(set10k, 5000)),
	);
});

test("uniq-has-10k-miss", async ({ bench }) => {
	assertEquivalent("uniq-has-10k-miss", currentHas(set10k, 99_999), nativeHas(set10k, 99_999));
	await bench.compare(
		bench("1. (current) Uniq.has 10k (absent)", () => currentHas(set10k, 99_999)),
		bench("2. native set.has 10k (absent)", () => nativeHas(set10k, 99_999)),
	);
});

test("uniq-map-100", async ({ bench }) => {
	assertEquivalent("uniq-map-100", currentMap(set100), nativeMap(set100));
	await bench.compare(
		bench("1. (current) Uniq.map 100", () => currentMap(set100)),
		bench("2. native map loop 100", () => nativeMap(set100)),
	);
});

test("uniq-map-10k", async ({ bench }) => {
	assertEquivalent("uniq-map-10k", currentMap(set10k), nativeMap(set10k));
	await bench.compare(
		bench("1. (current) Uniq.map 10k", () => currentMap(set10k)),
		bench("2. native map loop 10k", () => nativeMap(set10k)),
	);
});

test("uniq-filter-100", async ({ bench }) => {
	assertEquivalent("uniq-filter-100", currentFilter(set100), nativeFilter(set100));
	await bench.compare(
		bench("1. (current) Uniq.filter 100", () => currentFilter(set100)),
		bench("2. native filter loop 100", () => nativeFilter(set100)),
	);
});

test("uniq-filter-10k", async ({ bench }) => {
	assertEquivalent("uniq-filter-10k", currentFilter(set10k), nativeFilter(set10k));
	await bench.compare(
		bench("1. (current) Uniq.filter 10k", () => currentFilter(set10k)),
		bench("2. native filter loop 10k", () => nativeFilter(set10k)),
	);
});

test("uniq-union-100", async ({ bench }) => {
	const expected = nativeUnion(setA100, setB100);
	assertEquivalent("uniq-union-100/loop", currentUnion(setA100, setB100), expected);
	assertEquivalent("uniq-union-100/native", nativeSetUnion(setA100, setB100), expected);
	await bench.compare(
		bench("1. (current) Uniq.union 100", () => currentUnion(setA100, setB100)),
		bench("2. native union loop 100", () => nativeUnion(setA100, setB100)),
		bench("3. native set.union() 100", () => nativeSetUnion(setA100, setB100)),
	);
});

test("uniq-union-10k", async ({ bench }) => {
	const expected = nativeUnion(setA10k, setB10k);
	assertEquivalent("uniq-union-10k/loop", currentUnion(setA10k, setB10k), expected);
	assertEquivalent("uniq-union-10k/native", nativeSetUnion(setA10k, setB10k), expected);
	await bench.compare(
		bench("1. (current) Uniq.union 10k", () => currentUnion(setA10k, setB10k)),
		bench("2. native union loop 10k", () => nativeUnion(setA10k, setB10k)),
		bench("3. native set.union() 10k", () => nativeSetUnion(setA10k, setB10k)),
	);
});

test("uniq-union-approaches-10k", async ({ bench }) => {
	const expected = nativeSetUnion(setA10k, setB10k);
	assertEquivalent("uniq-union-approaches/loop", nativeUnion(setA10k, setB10k), expected);
	assertEquivalent("uniq-union-approaches/spread", spreadUnion(setA10k, setB10k), expected);
	await bench.compare(
		bench("1. native set.union() 10k", () => nativeSetUnion(setA10k, setB10k)),
		bench("2. for-of add loop 10k", () => nativeUnion(setA10k, setB10k)),
		bench("3. spread union 10k", () => spreadUnion(setA10k, setB10k)),
	);
});

test("uniq-intersection-100", async ({ bench }) => {
	const expected = nativeIntersection(set100, setA100);
	assertEquivalent("uniq-intersection-100/loop", currentIntersection(set100, setA100), expected);
	assertEquivalent("uniq-intersection-100/native", nativeSetIntersection(set100, setA100), expected);
	await bench.compare(
		bench("1. (current) Uniq.intersection 100", () => currentIntersection(set100, setA100)),
		bench("2. native intersection loop 100", () => nativeIntersection(set100, setA100)),
		bench("3. native set.intersection() 100", () => nativeSetIntersection(set100, setA100)),
	);
});

test("uniq-intersection-10k", async ({ bench }) => {
	const expected = nativeIntersection(set10k, setA10k);
	assertEquivalent("uniq-intersection-10k/loop", currentIntersection(set10k, setA10k), expected);
	assertEquivalent("uniq-intersection-10k/native", nativeSetIntersection(set10k, setA10k), expected);
	await bench.compare(
		bench("1. (current) Uniq.intersection 10k", () => currentIntersection(set10k, setA10k)),
		bench("2. native intersection loop 10k", () => nativeIntersection(set10k, setA10k)),
		bench("3. native set.intersection() 10k", () => nativeSetIntersection(set10k, setA10k)),
	);
});

test("uniq-difference-100", async ({ bench }) => {
	const expected = nativeDifference(set100, setA100);
	assertEquivalent("uniq-difference-100/loop", currentDifference(set100, setA100), expected);
	assertEquivalent("uniq-difference-100/native", nativeSetDifference(set100, setA100), expected);
	await bench.compare(
		bench("1. (current) Uniq.difference 100", () => currentDifference(set100, setA100)),
		bench("2. native difference loop 100", () => nativeDifference(set100, setA100)),
		bench("3. native set.difference() 100", () => nativeSetDifference(set100, setA100)),
	);
});

test("uniq-difference-10k", async ({ bench }) => {
	const expected = nativeDifference(set10k, setA10k);
	assertEquivalent("uniq-difference-10k/loop", currentDifference(set10k, setA10k), expected);
	assertEquivalent("uniq-difference-10k/native", nativeSetDifference(set10k, setA10k), expected);
	await bench.compare(
		bench("1. (current) Uniq.difference 10k", () => currentDifference(set10k, setA10k)),
		bench("2. native difference loop 10k", () => nativeDifference(set10k, setA10k)),
		bench("3. native set.difference() 10k", () => nativeSetDifference(set10k, setA10k)),
	);
});

test("uniq-reduce-100", async ({ bench }) => {
	assertEquivalent("uniq-reduce-100", currentReduce(set100), nativeReduce(set100));
	await bench.compare(
		bench("1. (current) Uniq.reduce 100 (sum)", () => currentReduce(set100)),
		bench("2. native reduce loop 100", () => nativeReduce(set100)),
	);
});

test("uniq-reduce-10k", async ({ bench }) => {
	assertEquivalent("uniq-reduce-10k", currentReduce(set10k), nativeReduce(set10k));
	await bench.compare(
		bench("1. (current) Uniq.reduce 10k (sum)", () => currentReduce(set10k)),
		bench("2. native reduce loop 10k", () => nativeReduce(set10k)),
	);
});

test("uniq-insert-100-new", async ({ bench }) => {
	assertEquivalent("uniq-insert-100-new", currentInsert(set100, 9999), nativeInsert(set100, 9999));
	await bench.compare(
		bench("1. (current) Uniq.insert 100 (new item)", () => currentInsert(set100, 9999)),
		bench("2. native insert clone 100", () => nativeInsert(set100, 9999)),
	);
});

test("uniq-insert-10k-new", async ({ bench }) => {
	assertEquivalent("uniq-insert-10k-new", currentInsert(set10k, 99_999), nativeInsert(set10k, 99_999));
	await bench.compare(
		bench("1. (current) Uniq.insert 10k (new item)", () => currentInsert(set10k, 99_999)),
		bench("2. native insert clone 10k", () => nativeInsert(set10k, 99_999)),
	);
});

test("uniq-insert-10k-existing", async ({ bench }) => {
	assertEquivalent("uniq-insert-10k-existing", currentInsert(set10k, 500), nativeInsert(set10k, 500));
	await bench.compare(
		bench("1. (current) Uniq.insert 10k (existing — no copy)", () => currentInsert(set10k, 500)),
		bench("2. native insert existing 10k", () => nativeInsert(set10k, 500)),
	);
});

// =============================================================================
// varied fixtures (seeded fast-check, non-sequential with duplicates)
// =============================================================================

test("uniq-from.array-varied-100", async ({ bench }) => {
	assertEquivalent("uniq-from.array-varied-100", uniqFromArray(variedData100), new globalThis.Set(variedData100));
	await bench.compare(
		bench("1. (current) Uniq.from.array varied 100", () => uniqFromArray(variedData100)),
		bench("2. native new Set varied 100", () => new globalThis.Set(variedData100)),
	);
});

test("uniq-has-varied-100", async ({ bench }) => {
	const { 50: item } = variedData100;
	assertEquivalent("uniq-has-varied-100", currentHas(variedSet100, item), nativeHas(variedSet100, item));
	await bench.compare(
		bench("1. (current) Uniq.has varied 100 (present)", () => currentHas(variedSet100, item)),
		bench("2. native set.has varied 100 (present)", () => nativeHas(variedSet100, item)),
	);
});

test("uniq-has-varied-100-miss", async ({ bench }) => {
	assertEquivalent("uniq-has-varied-100-miss", currentHas(variedSet100, 9999), nativeHas(variedSet100, 9999));
	await bench.compare(
		bench("1. (current) Uniq.has varied 100 (absent)", () => currentHas(variedSet100, 9999)),
		bench("2. native set.has varied 100 (absent)", () => nativeHas(variedSet100, 9999)),
	);
});

test("uniq-from.array-varied-10k", async ({ bench }) => {
	assertEquivalent("uniq-from.array-varied-10k", uniqFromArray(variedData10k), new globalThis.Set(variedData10k));
	await bench.compare(
		bench("1. (current) Uniq.from.array varied 10k", () => uniqFromArray(variedData10k)),
		bench("2. native new Set varied 10k", () => new globalThis.Set(variedData10k)),
	);
});

test("uniq-filter-varied-10k", async ({ bench }) => {
	assertEquivalent("uniq-filter-varied-10k", currentFilter(variedSet10k), nativeFilter(variedSet10k));
	await bench.compare(
		bench("1. (current) Uniq.filter varied 10k", () => currentFilter(variedSet10k)),
		bench("2. native filter loop varied 10k", () => nativeFilter(variedSet10k)),
	);
});

test("uniq-map-varied-10k", async ({ bench }) => {
	assertEquivalent("uniq-map-varied-10k", currentMap(variedSet10k), nativeMap(variedSet10k));
	await bench.compare(
		bench("1. (current) Uniq.map varied 10k", () => currentMap(variedSet10k)),
		bench("2. native map loop varied 10k", () => nativeMap(variedSet10k)),
	);
});
