import { pipe } from "#composition";
import { Maybe } from "#core";
import { Arr, Num } from "#data";
import { test } from "vitest";
import { assertEquivalent } from "./equivalence.ts";

const pipeFn = pipe;
const arrMap = Arr.map;
const numRange = Num.range;
const numMultiply = Num.multiply;
const numClamp = Num.clamp;
const numFromString = Num.from.string;
const numFormat = Num.format;

const data100 = Array.from({ length: 100 }, (_, i) => i);
const data10k = Array.from({ length: 10_000 }, (_, i) => i);
const numStrings100 = Array.from({ length: 100 }, (_, i) => String(i));
const mixedStrings100 = Array.from({ length: 100 }, (_, i) => (i % 10 === 0 ? "abc" : String(i)));
const numStrings10k = Array.from({ length: 10_000 }, (_, i) => String(i));
const mixedStrings10k = Array.from({ length: 10_000 }, (_, i) => (i % 10 === 0 ? "abc" : String(i)));
const formatOptions: Intl.NumberFormatOptions = { style: "currency", currency: "USD" };
const formatUsd = numFormat(formatOptions, "en-US");
const cachedUsdFormatter = new Intl.NumberFormat("en-US", formatOptions);
const currencyValues100 = Array.from({ length: 100 }, (_, i) => i * 1234.5);

const nativeRange = (count: number) => {
	const result = new Array<number>(count);
	for (let i = 0; i < count; i++) {
		result[i] = i;
	}
	return result;
};
const nativeRangeStep2Push = () => {
	const result: number[] = [];
	for (let i = 0; i < 10_000; i += 2) {
		result.push(i);
	}
	return result;
};
const nativeRangeStep2Prealloc = () => {
	const count = Math.ceil(10_000 / 2);
	const result = new Array<number>(count);
	for (let i = 0; i < count; i++) {
		result[i] = i * 2;
	}
	return result;
};
const multiplyCurrent = (items: readonly number[]) => pipeFn(items, arrMap(numMultiply(2)));
const multiplyInline = (items: readonly number[]) => pipeFn(items, arrMap((n) => n * 2));
const clampCurrent = (items: readonly number[], max: number) => pipeFn(items, arrMap(numClamp(0, max)));
const clampInline = (items: readonly number[], max: number) =>
	pipeFn(items, arrMap((n) => Math.min(Math.max(n, 0), max)));
const parseCurrent = (strings: readonly string[]) => strings.map(numFromString);
const parseNative = (strings: readonly string[]) =>
	strings.map((s) => {
		if (s.trim() === "") { return { kind: "None" as const }; }
		const n = Number(s);
		return Number.isNaN(n) ? { kind: "None" as const } : { kind: "Some" as const, value: n };
	});
const maybeSome = Maybe.make.some;
const formatCurrent = () => currencyValues100.map(formatUsd);
const formatCached = () => currencyValues100.map((n) => maybeSome(cachedUsdFormatter.format(n)));

// =============================================================================
// range
// =============================================================================

test("range-100", async ({ bench }) => {
	assertEquivalent("range-100", numRange(0, 99), nativeRange(100));
	await bench.compare(
		bench("1. (current) Num.range 100", () => numRange(0, 99)),
		bench("2. native range loop 100", () => nativeRange(100)),
	);
});

test("range-10k", async ({ bench }) => {
	assertEquivalent("range-10k", numRange(0, 9999), nativeRange(10_000));
	await bench.compare(
		bench("1. (current) Num.range 10k", () => numRange(0, 9999)),
		bench("2. native range loop 10k", () => nativeRange(10_000)),
	);
});

test("range-10k-step2", async ({ bench }) => {
	assertEquivalent("range-10k-step2", numRange(0, 9998, 2), nativeRangeStep2Push());
	await bench.compare(
		bench("1. (current) Num.range 10k step 2", () => numRange(0, 9998, 2)),
		bench("2. native range loop 10k step 2", () => nativeRangeStep2Push()),
	);
});

test("range-step2-approaches", async ({ bench }) => {
	assertEquivalent("range-step2-approaches", nativeRangeStep2Prealloc(), nativeRangeStep2Push());
	await bench.compare(
		bench("1. range push step 2 10k", () => nativeRangeStep2Push()),
		bench("2. (current) range pre-alloc step 2 10k", () => nativeRangeStep2Prealloc()),
	);
});

test("multiply-100", async ({ bench }) => {
	assertEquivalent("multiply-100", multiplyCurrent(data100), multiplyInline(data100));
	await bench.compare(
		bench("1. (current) Arr.map + Num.multiply 100", () => multiplyCurrent(data100)),
		bench("2. Arr.map + inline lambda 100", () => multiplyInline(data100)),
	);
});

test("multiply-10k", async ({ bench }) => {
	assertEquivalent("multiply-10k", multiplyCurrent(data10k), multiplyInline(data10k));
	await bench.compare(
		bench("1. (current) Arr.map + Num.multiply 10k", () => multiplyCurrent(data10k)),
		bench("2. Arr.map + inline lambda 10k", () => multiplyInline(data10k)),
	);
});

test("clamp-100", async ({ bench }) => {
	assertEquivalent("clamp-100", clampCurrent(data100, 50), clampInline(data100, 50));
	await bench.compare(
		bench("1. (current) Arr.map + Num.clamp 100", () => clampCurrent(data100, 50)),
		bench("2. Arr.map + inline clamp 100", () => clampInline(data100, 50)),
	);
});

test("clamp-10k", async ({ bench }) => {
	assertEquivalent("clamp-10k", clampCurrent(data10k, 5000), clampInline(data10k, 5000));
	await bench.compare(
		bench("1. (current) Arr.map + Num.clamp 10k", () => clampCurrent(data10k, 5000)),
		bench("2. Arr.map + inline clamp 10k", () => clampInline(data10k, 5000)),
	);
});

test("parse-100-valid", async ({ bench }) => {
	assertEquivalent("parse-100-valid", parseCurrent(numStrings100), parseNative(numStrings100));
	await bench.compare(
		bench("1. (current) Num.from.string 100 (all valid)", () => parseCurrent(numStrings100)),
		bench("2. native parse 100 (all valid)", () => parseNative(numStrings100)),
	);
});

test("parse-100-mixed", async ({ bench }) => {
	assertEquivalent("parse-100-mixed", parseCurrent(mixedStrings100), parseNative(mixedStrings100));
	await bench.compare(
		bench("1. (current) Num.from.string 100 (mixed)", () => parseCurrent(mixedStrings100)),
		bench("2. native parse 100 (mixed)", () => parseNative(mixedStrings100)),
	);
});

test("parse-10k-valid", async ({ bench }) => {
	assertEquivalent("parse-10k-valid", parseCurrent(numStrings10k), parseNative(numStrings10k));
	await bench.compare(
		bench("1. (current) Num.from.string 10k (all valid)", () => parseCurrent(numStrings10k)),
		bench("2. native parse 10k (all valid)", () => parseNative(numStrings10k)),
	);
});

test("parse-10k-mixed", async ({ bench }) => {
	assertEquivalent("parse-10k-mixed", parseCurrent(mixedStrings10k), parseNative(mixedStrings10k));
	await bench.compare(
		bench("1. (current) Num.from.string 10k (mixed)", () => parseCurrent(mixedStrings10k)),
		bench("2. native parse 10k (mixed)", () => parseNative(mixedStrings10k)),
	);
});

// =============================================================================
// format (formatter must be created once per curried application, not per call)
// =============================================================================

test("format-100-currency", async ({ bench }) => {
	assertEquivalent("format-100-currency", formatCurrent(), formatCached());
	await bench.compare(
		bench("1. (current) Num.format 100 values (formatter reused)", formatCurrent),
		bench("2. cached Intl.NumberFormat 100 values", formatCached),
	);
});
