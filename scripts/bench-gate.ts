import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type * as Api from "../src/index.ts";

type RuntimeApi = typeof import("../src/index.ts");

type GateCase = {
	readonly id: string;
	readonly iterations: number;
	readonly current: () => unknown;
	readonly reference: () => unknown;
	readonly digest: (value: unknown) => number;
};

type BaselineCase = { ratio: number; maxRatio: number; };

type Baseline = { note: string; cases: Record<string, BaselineCase>; };

type Row = {
	readonly id: string;
	readonly current: number;
	readonly reference: number;
	readonly ratio: number;
	readonly budget: number;
	readonly equivalent: boolean;
};

const ROUNDS = 9;
const baselineUrl = new URL("../benchmarks/baseline.json", import.meta.url);
const distUrl = new URL("../dist/index.mjs", import.meta.url).href;
const update = process.argv.includes("--update");

const api = (await import(distUrl)) as RuntimeApi;
const { Arr, Dict, Maybe, Num, Rec } = api;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const arr10k = Array.from({ length: 10_000 }, (_, i) => i);
const nonEmpty10k = arr10k as unknown as Api.Arr.NonEmpty<number>;
const rec10k: Record<string, number> = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`key${i}`, i]));
const recSecond10k: Record<string, number> = Object.fromEntries(
	Array.from({ length: 10_000 }, (_, i) => [`key${i}`, i + 1]),
);
const dict10k: ReadonlyMap<string, number> = new Map(Array.from({ length: 10_000 }, (_, i) => [`key${i}`, i]));
const words10k = Array.from({ length: 10_000 }, (_, i) => `word${i % 100}`);
const formatOptions: Intl.NumberFormatOptions = { style: "currency", currency: "USD" };
const formatUsd = Num.format(formatOptions, "en-US");
const numberFormatter = new Intl.NumberFormat("en-US", formatOptions);

// ---------------------------------------------------------------------------
// Reference implementations: the documented fast path for each case
// ---------------------------------------------------------------------------
const add = (accumulator: number, value: number): number => accumulator + value;
const double = (value: number): number => value * 2;
const isEven = (value: number): boolean => value % 2 === 0;
const keyOfWord = (word: string): string => word.slice(-2);
const toSome = (value: number) => value % 3 === 0 ? Maybe.make.none() : Maybe.make.some(value);

const setKey = <A>(record: Record<string, A>, key: string, value: A): void => {
	if (key === "__proto__") {
		Object.defineProperty(record, key, { value, writable: true, enumerable: true, configurable: true });
	} else {
		record[key] = value;
	}
};

const refReduce = <A, B>(initial: B, reducer: (accumulator: B, item: A) => B) => (items: readonly A[]): B => {
	let accumulator = initial;
	for (let i = 0; i < items.length; i++) {
		accumulator = reducer(accumulator, items[i]);
	}
	return accumulator;
};

const refNonEmptyReduce = <A>(reducer: (accumulator: A, item: A) => A) => (items: readonly A[]): A => {
	let accumulator = items[0];
	for (let i = 1; i < items.length; i++) {
		accumulator = reducer(accumulator, items[i]);
	}
	return accumulator;
};

const refRecMap = <A, B>(transform: (value: A) => B) => (record: Readonly<Record<string, A>>): Record<string, B> => {
	const keys = Object.keys(record);
	const result: Record<string, B> = {};
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		setKey(result, key, transform(record[key]));
	}
	return result;
};

const refRecFilter =
	<A>(predicate: (value: A) => boolean) => (record: Readonly<Record<string, A>>): Record<string, A> => {
		const keys = Object.keys(record);
		const result: Record<string, A> = {};
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const value = record[key];
			if (predicate(value)) { setKey(result, key, value); }
		}
		return result;
	};

const refRecMapWithKey =
	<A, B>(transform: (key: string, value: A) => B) => (record: Readonly<Record<string, A>>): Record<string, B> => {
		const keys = Object.keys(record);
		const result: Record<string, B> = {};
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			setKey(result, key, transform(key, record[key]));
		}
		return result;
	};

const refRecFilterMap =
	<A, B>(transform: (value: A) => Api.Maybe<B>) => (record: Readonly<Record<string, A>>): Record<string, B> => {
		const keys = Object.keys(record);
		const result: Record<string, B> = {};
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const mapped = transform(record[key]);
			if (mapped.kind === "Some") { setKey(result, key, mapped.value); }
		}
		return result;
	};

const refRecGroupBy = <A>(keySelector: (item: A) => string) => (items: readonly A[]): Record<string, A[]> => {
	const result: Record<string, A[]> = {};
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const key = keySelector(item);
		const group = result[key];
		if (Array.isArray(group)) {
			group.push(item);
		} else if (key === "__proto__") {
			Object.defineProperty(result, key, { value: [item], writable: true, enumerable: true, configurable: true });
		} else {
			result[key] = [item];
		}
	}
	return result;
};

const refRecMergeWith =
	<A>(combine: (first: A, second: A) => A) =>
	(second: Readonly<Record<string, A>>) =>
	(first: Readonly<Record<string, A>>): Record<string, A> => {
		const result: Record<string, A> = { ...first };
		const keys = Object.keys(second);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const value = second[key];
			if (Object.hasOwn(result, key)) {
				setKey(result, key, combine(result[key], value));
			} else {
				setKey(result, key, value);
			}
		}
		return result;
	};

const refDictReduce =
	<B, V>(initial: B, reducer: (accumulator: B, value: V) => B) => (dict: ReadonlyMap<unknown, V>): B => {
		let accumulator = initial;
		for (const value of dict.values()) {
			accumulator = reducer(accumulator, value);
		}
		return accumulator;
	};

const refNumFormat = (formatter: Intl.NumberFormat) => (value: number) =>
	Number.isFinite(value) ? Maybe.make.some(formatter.format(value)) : Maybe.make.none();

// ---------------------------------------------------------------------------
// Cases: each pairs a public function with the loop the docs claim it uses
// ---------------------------------------------------------------------------
const cases: readonly GateCase[] = [{
	id: "arr.reduce/10k",
	iterations: 150,
	current: () => Arr.reduce(0, add)(arr10k),
	reference: () => refReduce(0, add)(arr10k),
	digest: (value) => typeof value === "number" ? value : 0,
}, {
	id: "arr.nonEmptyReduce/10k",
	iterations: 150,
	current: () => Arr.NonEmpty.reduce(add)(nonEmpty10k),
	reference: () => refNonEmptyReduce(add)(nonEmpty10k),
	digest: (value) => typeof value === "number" ? value : 0,
}, {
	id: "arr.reverse/10k",
	iterations: 200,
	current: () => Arr.reverse(arr10k),
	reference: () => arr10k.slice().reverse(),
	digest: (value) => Array.isArray(value) ? value.length : 0,
}, {
	id: "rec.map/10k",
	iterations: 8,
	current: () => Rec.map(double)(rec10k),
	reference: () => refRecMap(double)(rec10k),
	digest: (value) => typeof value === "object" && value !== null ? Object.keys(value).length : 0,
}, {
	id: "rec.filter/10k",
	iterations: 8,
	current: () => Rec.filter(isEven)(rec10k),
	reference: () => refRecFilter(isEven)(rec10k),
	digest: (value) => typeof value === "object" && value !== null ? Object.keys(value).length : 0,
}, {
	id: "rec.mapWithKey/10k",
	iterations: 8,
	current: () => Rec.mapWithKey((key: string, value: number) => key.length + value)(rec10k),
	reference: () => refRecMapWithKey((key: string, value: number) => key.length + value)(rec10k),
	digest: (value) => typeof value === "object" && value !== null ? Object.keys(value).length : 0,
}, {
	id: "rec.filterMap/10k",
	iterations: 8,
	current: () => Rec.filterMap(toSome)(rec10k),
	reference: () => refRecFilterMap(toSome)(rec10k),
	digest: (value) => typeof value === "object" && value !== null ? Object.keys(value).length : 0,
}, {
	id: "rec.groupBy/10k",
	iterations: 30,
	current: () => Rec.groupBy(keyOfWord)(words10k),
	reference: () => refRecGroupBy(keyOfWord)(words10k),
	digest: (value) => typeof value === "object" && value !== null ? Object.keys(value).length : 0,
}, {
	id: "rec.mergeWith/10k",
	iterations: 4,
	current: () => Rec.mergeWith(add)(recSecond10k)(rec10k),
	reference: () => refRecMergeWith(add)(recSecond10k)(rec10k),
	digest: (value) => typeof value === "object" && value !== null ? Object.keys(value).length : 0,
}, {
	id: "dict.reduce/10k",
	iterations: 200,
	current: () => Dict.reduce(0, add)(dict10k),
	reference: () => refDictReduce(0, add)(dict10k),
	digest: (value) => typeof value === "number" ? value : 0,
}, {
	id: "num.format",
	iterations: 20_000,
	current: () => formatUsd(1234.5),
	reference: () => refNumFormat(numberFormatter)(1234.5),
	digest: (value) => typeof value === "object" && value !== null && "kind" in value && value.kind === "Some" ? 1 : 0,
}];

// ---------------------------------------------------------------------------
// Harness: interleaved rounds, median per variant, live sink against DCE
// ---------------------------------------------------------------------------
let sink = 0;

const measure = (fn: () => unknown, digest: (value: unknown) => number, iterations: number): number => {
	const start = performance.now();
	for (let i = 0; i < iterations; i++) {
		sink ^= digest(fn());
	}
	return ((performance.now() - start) * 1_000_000) / iterations;
};

const median = (samples: readonly number[]): number => {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[ROUNDS >> 1];
};

const formatTime = (nanoseconds: number): string => {
	if (nanoseconds >= 1_000_000) { return `${(nanoseconds / 1_000_000).toFixed(2)} ms`; }
	if (nanoseconds >= 1_000) { return `${(nanoseconds / 1_000).toFixed(1)} us`; }
	return `${nanoseconds.toFixed(0)} ns`;
};

const baseline = JSON.parse(readFileSync(baselineUrl, "utf8")) as Baseline;
const failures: string[] = [];
const rows: Row[] = [];

for (const gateCase of cases) {
	const baselineCase = baseline.cases[gateCase.id];
	if (baselineCase === undefined) {
		failures.push(`${gateCase.id}: no budget in benchmarks/baseline.json`);
		continue;
	}
	const equivalent = isDeepStrictEqual(gateCase.current(), gateCase.reference());
	const warmup = Math.max(10, gateCase.iterations >> 2);
	for (let i = 0; i < warmup; i++) {
		sink ^= gateCase.digest(gateCase.current());
		sink ^= gateCase.digest(gateCase.reference());
	}
	const currentSamples: number[] = [];
	const referenceSamples: number[] = [];
	for (let round = 0; round < ROUNDS; round++) {
		currentSamples.push(measure(gateCase.current, gateCase.digest, gateCase.iterations));
		referenceSamples.push(measure(gateCase.reference, gateCase.digest, gateCase.iterations));
	}
	const current = median(currentSamples);
	const reference = median(referenceSamples);
	const ratio = current / reference;
	rows.push({ id: gateCase.id, current, reference, ratio, budget: baselineCase.maxRatio, equivalent });
	if (!equivalent) {
		failures.push(`${gateCase.id}: current and reference return different results`);
	} else if (ratio > baselineCase.maxRatio) {
		failures.push(`${gateCase.id}: ${ratio.toFixed(2)}x exceeds the ${baselineCase.maxRatio.toFixed(2)}x budget`);
	}
}

console.log(`\nBenchmark gate: ${cases.length} cases on ${process.version}`);
console.log(
	`${"case".padEnd(24)}${"current".padStart(11)}${"reference".padStart(12)}${"ratio".padStart(9)}${
		"budget".padStart(9)
	}  status`,
);
for (const row of rows) {
	const status = !row.equivalent ? "MISMATCH" : row.ratio <= row.budget ? "ok" : "SLOW";
	console.log(
		`${row.id.padEnd(24)}${formatTime(row.current).padStart(11)}${formatTime(row.reference).padStart(12)}${
			`${row.ratio.toFixed(2)}x`.padStart(9)
		}${`${row.budget.toFixed(2)}x`.padStart(9)}  ${status}`,
	);
}

if (update) {
	for (const row of rows) {
		baseline.cases[row.id].ratio = Number(row.ratio.toFixed(3));
	}
	writeFileSync(baselineUrl, `${JSON.stringify(baseline, null, "\t")}\n`);
	console.log(`\nRecorded ${rows.length} ratios in benchmarks/baseline.json`);
}

if (!Number.isFinite(sink)) {
	failures.push("measurement sink is not finite; the timed loops did not execute");
}

if (failures.length > 0) {
	console.error(`\n${failures.length} benchmark gate failure(s):`);
	for (const failure of failures) { console.error(`  - ${failure}`); }
	process.exitCode = 1;
} else {
	console.log(`\nAll ${cases.length} cases within budget.`);
}
