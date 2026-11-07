import { pipe } from "#composition";
import { Maybe, Result } from "#core";
import { Arr } from "#data";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

const pipeFn = pipe;
const arrMap = Arr.map;
const arrFilter = Arr.filter;
const arrFlatMap = Arr.flatMap;
const arrReduce = Arr.reduce;
const arrScan = Arr.scan;
const arrTraverseMaybe = Arr.traverse.Maybe;
const arrTraverseResult = Arr.traverse.Result;
const arrGroupBy = Arr.groupBy;
const arrUniqBy = Arr.uniqBy;
const arrSortBy = Arr.sortBy;
const arrReverse = Arr.reverse;
const arrInsertAt = Arr.insertAt;
const arrRemoveAt = Arr.removeAt;
const arrZip = Arr.zip;

const data100 = Array.from({ length: 100 }, (_, i) => i);
const data10k = Array.from({ length: 10_000 }, (_, i) => i);
const otherArr = Array.from({ length: 10_000 }, (_, i) => i + 1);
const shuffled = [...data10k].toReversed();
const words = Array.from({ length: 10_000 }, (_, i) => `word${i % 100}`);
const maybeSome = Maybe.make.some;
const resultOk = Result.make.ok;
const toSome = (n: number): Maybe<number> => maybeSome(n * 2);
const toSome2 = (n: number): Maybe<number> => maybeSome(n * 2);
const toOk = (n: number): Result<never, number> => resultOk(n * 2);
const toOk2 = (n: number): Result<never, number> => resultOk(n * 2);

const double = (n: number) => n * 2;
const isEven = (n: number) => n % 2 === 0;
const sum = (accumulator: number, n: number) => accumulator + n;
const pair = (n: number) => [n, n + 1];
const firstChar = (s: string) => s[0];

const currentMap = (items: readonly number[]) => pipeFn(items, arrMap(double));
const nativeMap = (items: readonly number[]) => items.map(double);
const preallocMap = (items: readonly number[]) => {
	const n = items.length;
	const result = new Array<number>(n);
	for (let i = 0; i < n; i++) {
		result[i] = items[i] * 2;
	}
	return result;
};
const currentFilter = (items: readonly number[]) => pipeFn(items, arrFilter(isEven));
const nativeFilter = (items: readonly number[]) => items.filter(isEven);
const pushFilter = (items: readonly number[]) => {
	const result: number[] = [];
	for (let i = 0; i < items.length; i++) {
		if (items[i] % 2 === 0) { result.push(items[i]); }
	}
	return result;
};
const currentFlatMap = (items: readonly number[]) => pipeFn(items, arrFlatMap(pair));
const nativeFlatMap = (items: readonly number[]) => items.flatMap(pair);
const pushFlatMap = (items: readonly number[]) => {
	const result: number[] = [];
	for (let i = 0; i < items.length; i++) {
		result.push(items[i], items[i] + 1);
	}
	return result;
};
const concatFlatMap = (items: readonly number[]) => ([] as number[]).concat(...items.map(pair));
const currentReduce = (items: readonly number[]) => pipeFn(items, arrReduce(0, sum));
const nativeReduce = (items: readonly number[]) => items.reduce(sum, 0);
const currentScan = (items: readonly number[]) => pipeFn(items, arrScan(0, sum));
const pushScan = (items: readonly number[]) => {
	const result: number[] = [];
	let accumulator = 0;
	for (const n of items) {
		accumulator += n;
		result.push(accumulator);
	}
	return result;
};
const preallocScan = (items: readonly number[]) => {
	const n = items.length;
	const result = new Array<number>(n);
	let accumulator = 0;
	for (let i = 0; i < n; i++) {
		accumulator += items[i];
		result[i] = accumulator;
	}
	return result;
};
const currentTraverseMaybe = (items: readonly number[]) => pipeFn(items, arrTraverseMaybe(toSome));
const pushTraverseMaybe = (items: readonly number[]) => {
	const result: number[] = [];
	for (let i = 0; i < items.length; i++) {
		const mapped = toSome2(items[i]);
		if (mapped.kind === "None") { return null; }
		result.push(mapped.value);
	}
	return result;
};
const preallocTraverseMaybe = (items: readonly number[]) => {
	const n = items.length;
	const result = new Array<number>(n);
	for (let i = 0; i < n; i++) {
		const mapped = toSome2(items[i]);
		if (mapped.kind === "None") { return null; }
		result[i] = mapped.value;
	}
	return result;
};
const currentTraverseResult = (items: readonly number[]) => pipeFn(items, arrTraverseResult(toOk));
const pushTraverseResult = (items: readonly number[]) => {
	const result: number[] = [];
	for (let i = 0; i < items.length; i++) {
		const mapped = toOk2(items[i]);
		if (mapped.kind === "Err") { return null; }
		result.push(mapped.value);
	}
	return result;
};
const preallocTraverseResult = (items: readonly number[]) => {
	const n = items.length;
	const result = new Array<number>(n);
	for (let i = 0; i < n; i++) {
		const mapped = toOk2(items[i]);
		if (mapped.kind === "Err") { return null; }
		result[i] = mapped.value;
	}
	return result;
};
const maybeValues = (maybe: Maybe<readonly number[]>) => maybe.kind === "Some" ? maybe.value : null;
const resultValues = (result: Result<never, readonly number[]>) => result.kind === "Ok" ? result.value : null;
const currentGroupBy = (items: readonly string[]) => pipeFn(items, arrGroupBy(firstChar));
const manualGroupBy = (items: readonly string[]) => {
	const result: Record<string, string[]> = {};
	for (const item of items) {
		const key = firstChar(item);
		if (!result[key]) { result[key] = []; }
		result[key].push(item);
	}
	return result;
};
const currentUniqBy = (items: readonly number[]) => pipeFn(items, arrUniqBy((n) => n % 100));
const forOfUniqBy = (items: readonly number[]) => {
	const seen = new Set<number>();
	const result: number[] = [];
	for (const item of items) {
		const key = item % 100;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(item);
		}
	}
	return result;
};
const indexUniqBy = (items: readonly number[]) => {
	const seen = new Set<number>();
	const result: number[] = [];
	for (let i = 0; i < items.length; i++) {
		const key = items[i] % 100;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(items[i]);
		}
	}
	return result;
};
const currentSortBy = (items: readonly number[]) => pipeFn(items, arrSortBy((a, b) => a - b));
const spreadSort = (items: readonly number[]) => [...items].toSorted((a, b) => a - b);
const nativeSort = (items: readonly number[]) => items.toSorted((a, b) => a - b);
const currentReverse = (items: readonly number[]) => pipeFn(items, arrReverse);
const spreadReverse = (items: readonly number[]) => [...items].toReversed();
const nativeReverse = (items: readonly number[]) => items.toReversed();
const currentInsertAt = (items: readonly number[]) => pipeFn(items, arrInsertAt(5000, -1));
const nativeInsertAt = (items: readonly number[]) => items.toSpliced(5000, 0, -1);
const spliceInsertAt = (items: readonly number[]) => {
	const result = [...items];
	result.splice(5000, 0, -1);
	return result;
};
const currentRemoveAt = (items: readonly number[]) => pipeFn(items, arrRemoveAt(5000));
const nativeRemoveAt = (items: readonly number[]) => items.toSpliced(5000, 1);
const spliceRemoveAt = (items: readonly number[]) => {
	const result = [...items];
	result.splice(5000, 1);
	return result;
};
const currentZip = (items: readonly number[]) => pipeFn(items, arrZip(otherArr));
const pushZip = (items: readonly number[]) => {
	const len = Math.min(items.length, otherArr.length);
	const result: [number, number][] = [];
	for (let i = 0; i < len; i++) {
		result.push([items[i], otherArr[i]]);
	}
	return result;
};
const preallocZip = (items: readonly number[]) => {
	const len = Math.min(items.length, otherArr.length);
	const result = new Array<[number, number]>(len);
	for (let i = 0; i < len; i++) {
		result[i] = [items[i], otherArr[i]];
	}
	return result;
};
const currentPartition = (items: readonly number[]) => pipeFn(items, Arr.partition(isEven));
const forOfPartition = (items: readonly number[]) => {
	const pass: number[] = [];
	const fail: number[] = [];
	for (const item of items) {
		(isEven(item) ? pass : fail).push(item);
	}
	return [pass, fail];
};
const indexPartition = (items: readonly number[]) => {
	const pass: number[] = [];
	const fail: number[] = [];
	for (let i = 0; i < items.length; i++) {
		(isEven(items[i]) ? pass : fail).push(items[i]);
	}
	return [pass, fail];
};
const nativeEveryAll = () => data10k.every((n) => n >= 0);
const loopEveryAll = () => {
	for (let i = 0; i < data10k.length; i++) {
		if (!(data10k[i] >= 0)) { return false; }
	}
	return true;
};
const nativeEveryEarly = () => data10k.every((n) => n < 5000);
const loopEveryEarly = () => {
	for (let i = 0; i < data10k.length; i++) {
		if (!(data10k[i] < 5000)) { return false; }
	}
	return true;
};
const nativeSomeFalsy = () => data10k.some((n) => n < 0);
const loopSomeFalsy = () => {
	for (let i = 0; i < data10k.length; i++) {
		if (data10k[i] < 0) { return true; }
	}
	return false;
};
const nativeSomeEarly = () => data10k.some((n) => n > 5000);
const loopSomeEarly = () => {
	for (let i = 0; i < data10k.length; i++) {
		if (data10k[i] > 5000) { return true; }
	}
	return false;
};
const sliceTake = (items: readonly number[]) => items.slice(0, 5000);
const preallocTake = (items: readonly number[]) => {
	const count = Math.min(5000, items.length);
	const result = new Array<number>(count);
	for (let i = 0; i < count; i++) {
		result[i] = items[i];
	}
	return result;
};
const sliceDrop = (items: readonly number[]) => items.slice(5000);
const preallocDrop = (items: readonly number[]) => {
	const start = Math.min(5000, items.length);
	const count = items.length - start;
	const result = new Array<number>(count);
	for (let i = 0; i < count; i++) {
		result[i] = items[start + i];
	}
	return result;
};
const twoSliceSplit = (items: readonly number[]) => [items.slice(0, 5000), items.slice(5000)];
const twoLoopSplit = (items: readonly number[]) => {
	const index = Math.min(5000, items.length);
	const left = new Array<number>(index);
	for (let i = 0; i < index; i++) {
		left[i] = items[i];
	}
	const right = new Array<number>(items.length - index);
	for (let i = 0; i < right.length; i++) {
		right[i] = items[index + i];
	}
	return [left, right];
};

// =============================================================================
// map
// =============================================================================

test("map-100", async ({ bench }) => {
	assertEquivalent("map-100", currentMap(data100), nativeMap(data100));
	await bench.compare(
		bench("1. (current) Arr.map 100", () => currentMap(data100)),
		bench("2. native .map 100", () => nativeMap(data100)),
	);
});

test("map-10k", async ({ bench }) => {
	assertEquivalent("map-10k", currentMap(data10k), nativeMap(data10k));
	await bench.compare(
		bench("1. (current) Arr.map 10k", () => currentMap(data10k)),
		bench("2. native .map 10k", () => nativeMap(data10k)),
	);
});

test("filter-10k", async ({ bench }) => {
	assertEquivalent("filter-10k", currentFilter(data10k), nativeFilter(data10k));
	await bench.compare(
		bench("1. (current) Arr.filter 10k", () => currentFilter(data10k)),
		bench("2. native .filter 10k", () => nativeFilter(data10k)),
	);
});

test("flatMap-10k", async ({ bench }) => {
	assertEquivalent("flatMap-10k", currentFlatMap(data10k), nativeFlatMap(data10k));
	await bench.compare(
		bench("1. (current) Arr.flatMap 10k", () => currentFlatMap(data10k)),
		bench("2. native .flatMap 10k", () => nativeFlatMap(data10k)),
	);
});

test("reduce-10k", async ({ bench }) => {
	assertEquivalent("reduce-10k", currentReduce(data10k), nativeReduce(data10k));
	await bench.compare(
		bench("1. (current) Arr.reduce 10k", () => currentReduce(data10k)),
		bench("2. native .reduce 10k", () => nativeReduce(data10k)),
	);
});

test("scan-10k", async ({ bench }) => {
	assertEquivalent("scan-10k", currentScan(data10k), pushScan(data10k));
	await bench.compare(
		bench("1. (current) Arr.scan 10k", () => currentScan(data10k)),
		bench("2. scan native loop 10k", () => pushScan(data10k)),
	);
});

test("traverse-maybe-10k", async ({ bench }) => {
	assertEquivalent("traverse-maybe-10k", maybeValues(currentTraverseMaybe(data10k)), pushTraverseMaybe(data10k));
	await bench.compare(
		bench("1. (current) Arr.traverse Maybe 10k (all-Some)", () => currentTraverseMaybe(data10k)),
		bench("2. native traverse Maybe 10k (all-Some)", () => pushTraverseMaybe(data10k)),
	);
});

test("traverse-result-10k", async ({ bench }) => {
	assertEquivalent("traverse-result-10k", resultValues(currentTraverseResult(data10k)), pushTraverseResult(data10k));
	await bench.compare(
		bench("1. (current) Arr.traverseResult 10k (all-Ok)", () => currentTraverseResult(data10k)),
		bench("2. native traverseResult 10k (all-Ok)", () => pushTraverseResult(data10k)),
	);
});

test("groupBy-10k", async ({ bench }) => {
	assertEquivalent("groupBy-10k", currentGroupBy(words), manualGroupBy(words));
	await bench.compare(
		bench("1. (current) Arr.groupBy 10k", () => currentGroupBy(words)),
		bench("2. native groupBy 10k", () => manualGroupBy(words)),
	);
});

test("uniqBy-10k", async ({ bench }) => {
	assertEquivalent("uniqBy-10k", currentUniqBy(data10k), forOfUniqBy(data10k));
	await bench.compare(
		bench("1. (current) Arr.uniqBy 10k", () => currentUniqBy(data10k)),
		bench("2. native uniqBy 10k", () => forOfUniqBy(data10k)),
	);
});

test("sortBy-10k", async ({ bench }) => {
	const expected = nativeSort(shuffled);
	assertEquivalent("sortBy-10k/spread", currentSortBy(shuffled), expected);
	assertEquivalent("sortBy-10k/native", spreadSort(shuffled), expected);
	await bench.compare(
		bench("1. (current) Arr.sortBy 10k", () => currentSortBy(shuffled)),
		bench("2. native .sort 10k", () => spreadSort(shuffled)),
		bench("3. native .toSorted 10k", () => nativeSort(shuffled)),
	);
});

test("reverse-10k", async ({ bench }) => {
	const expected = nativeReverse(data10k);
	assertEquivalent("reverse-10k/current", currentReverse(data10k), expected);
	assertEquivalent("reverse-10k/spread", spreadReverse(data10k), expected);
	await bench.compare(
		bench("1. (current) Arr.reverse 10k", () => currentReverse(data10k)),
		bench("2. native .reverse 10k", () => spreadReverse(data10k)),
		bench("3. native .toReversed 10k", () => nativeReverse(data10k)),
	);
});

test("insertAt-10k", async ({ bench }) => {
	const expected = nativeInsertAt(data10k);
	assertEquivalent("insertAt-10k/current", currentInsertAt(data10k), expected);
	assertEquivalent("insertAt-10k/splice", spliceInsertAt(data10k), expected);
	await bench.compare(
		bench("1. (current) Arr.insertAt 10k", () => currentInsertAt(data10k)),
		bench("2. native .toSpliced insert 10k", () => nativeInsertAt(data10k)),
		bench("3. spread + splice insert 10k", () => spliceInsertAt(data10k)),
	);
});

test("removeAt-10k", async ({ bench }) => {
	const expected = nativeRemoveAt(data10k);
	assertEquivalent("removeAt-10k/current", currentRemoveAt(data10k), expected);
	assertEquivalent("removeAt-10k/splice", spliceRemoveAt(data10k), expected);
	await bench.compare(
		bench("1. (current) Arr.removeAt 10k", () => currentRemoveAt(data10k)),
		bench("2. native .toSpliced remove 10k", () => nativeRemoveAt(data10k)),
		bench("3. spread + splice remove 10k", () => spliceRemoveAt(data10k)),
	);
});

test("zip-10k", async ({ bench }) => {
	assertEquivalent("zip-10k", currentZip(data10k), pushZip(data10k));
	await bench.compare(
		bench("1. (current) Arr.zip 10k", () => currentZip(data10k)),
		bench("2. native zip loop 10k", () => pushZip(data10k)),
	);
});

test("scan-approaches-10k", async ({ bench }) => {
	assertEquivalent("scan-approaches-10k", preallocScan(data10k), pushScan(data10k));
	await bench.compare(
		bench("1. scan push 10k", () => pushScan(data10k)),
		bench("2. (current) scan pre-alloc 10k", () => preallocScan(data10k)),
	);
});

test("zip-approaches-10k", async ({ bench }) => {
	assertEquivalent("zip-approaches-10k", preallocZip(data10k), pushZip(data10k));
	await bench.compare(
		bench("1. zip push 10k", () => pushZip(data10k)),
		bench("2. (current) zip pre-alloc 10k", () => preallocZip(data10k)),
	);
});

test("traverse-approaches-10k", async ({ bench }) => {
	assertEquivalent("traverse-approaches-10k", preallocTraverseMaybe(data10k), pushTraverseMaybe(data10k));
	await bench.compare(
		bench("1. traverse push 10k", () => pushTraverseMaybe(data10k)),
		bench("2. (current) traverse pre-alloc 10k", () => preallocTraverseMaybe(data10k)),
	);
});

test("traverseResult-approaches-10k", async ({ bench }) => {
	assertEquivalent("traverseResult-approaches-10k", preallocTraverseResult(data10k), pushTraverseResult(data10k));
	await bench.compare(
		bench("1. traverseResult push 10k", () => pushTraverseResult(data10k)),
		bench("2. (current) traverseResult pre-alloc 10k", () => preallocTraverseResult(data10k)),
	);
});

test("partition-approaches-10k", async ({ bench }) => {
	assertEquivalent("partition-approaches-10k", indexPartition(data10k), forOfPartition(data10k));
	assertEquivalent("partition-approaches-10k/library", currentPartition(data10k), forOfPartition(data10k));
	await bench.compare(
		bench("1. (current) partition for-of 10k", () => forOfPartition(data10k)),
		bench("2. partition index 10k", () => indexPartition(data10k)),
	);
});

test("uniqby-approaches-10k", async ({ bench }) => {
	assertEquivalent("uniqby-approaches-10k", indexUniqBy(data10k), forOfUniqBy(data10k));
	await bench.compare(
		bench("1. (current) uniqBy for-of 10k", () => forOfUniqBy(data10k)),
		bench("2. uniqBy index 10k", () => indexUniqBy(data10k)),
	);
});

test("map-approaches-10k", async ({ bench }) => {
	assertEquivalent("map-approaches-10k", preallocMap(data10k), nativeMap(data10k));
	await bench.compare(
		bench("1. map native .map 10k", () => nativeMap(data10k)),
		bench("2. (current) map pre-alloc loop 10k", () => preallocMap(data10k)),
	);
});

test("filter-approaches-10k", async ({ bench }) => {
	assertEquivalent("filter-approaches-10k", pushFilter(data10k), nativeFilter(data10k));
	await bench.compare(
		bench("1. filter native .filter 10k", () => nativeFilter(data10k)),
		bench("2. (current) filter push loop 10k", () => pushFilter(data10k)),
	);
});

test("flatMap-approaches-10k", async ({ bench }) => {
	const expected = nativeFlatMap(data10k);
	assertEquivalent("flatMap-approaches-10k/concat", concatFlatMap(data10k), expected);
	assertEquivalent("flatMap-approaches-10k/push", pushFlatMap(data10k), expected);
	await bench.compare(
		bench("1. flatMap concat+spread 10k", () => concatFlatMap(data10k)),
		bench("2. (current) flatMap push loop 10k", () => pushFlatMap(data10k)),
		bench("3. flatMap native .flatMap 10k", () => nativeFlatMap(data10k)),
	);
});

test("every-approaches-10k", async ({ bench }) => {
	assertEquivalent("every-approaches-10k", nativeEveryAll(), loopEveryAll());
	await bench.compare(
		bench("1. every native .every all-pass 10k", nativeEveryAll),
		bench("2. (current) every loop all-pass 10k", loopEveryAll),
	);
});

test("every-earlyexit-10k", async ({ bench }) => {
	assertEquivalent("every-earlyexit-10k", nativeEveryEarly(), loopEveryEarly());
	await bench.compare(
		bench("1. every native .every early-exit 10k", nativeEveryEarly),
		bench("2. (current) every loop early-exit 10k", loopEveryEarly),
	);
});

test("some-approaches-10k", async ({ bench }) => {
	assertEquivalent("some-approaches-10k", nativeSomeFalsy(), loopSomeFalsy());
	await bench.compare(
		bench("1. some native .some all-false 10k", nativeSomeFalsy),
		bench("2. (current) some loop all-false 10k", loopSomeFalsy),
	);
});

test("some-earlyexit-10k", async ({ bench }) => {
	assertEquivalent("some-earlyexit-10k", nativeSomeEarly(), loopSomeEarly());
	await bench.compare(
		bench("1. some native .some early-exit 10k", nativeSomeEarly),
		bench("2. (current) some loop early-exit 10k", loopSomeEarly),
	);
});

test("take-approaches-10k", async ({ bench }) => {
	assertEquivalent("take-approaches-10k", preallocTake(data10k), sliceTake(data10k));
	await bench.compare(
		bench("1. (current) take native .slice 10k", () => sliceTake(data10k)),
		bench("2. take pre-alloc loop 10k", () => preallocTake(data10k)),
	);
});

test("drop-approaches-10k", async ({ bench }) => {
	assertEquivalent("drop-approaches-10k", preallocDrop(data10k), sliceDrop(data10k));
	await bench.compare(
		bench("1. (current) drop native .slice 10k", () => sliceDrop(data10k)),
		bench("2. drop pre-alloc loop 10k", () => preallocDrop(data10k)),
	);
});

test("splitAt-approaches-10k", async ({ bench }) => {
	assertEquivalent("splitAt-approaches-10k", twoLoopSplit(data10k), twoSliceSplit(data10k));
	await bench.compare(
		bench("1. (current) splitAt two .slice 10k", () => twoSliceSplit(data10k)),
		bench("2. splitAt two pre-alloc loops 10k", () => twoLoopSplit(data10k)),
	);
});
