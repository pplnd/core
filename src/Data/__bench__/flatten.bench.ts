import { pipe } from "#composition";
import { Arr } from "#data";
import { test } from "vitest";
import { assertEquivalent } from "./equivalence.ts";

const pipeFn = pipe;
const arrFlatten = Arr.flatten;

const wideShallow = Array.from({ length: 1000 }, (_, i) => Array.from({ length: 10 }, (_inner, j) => i * 10 + j));
const narrowDeep = Array.from({ length: 10 }, (_, i) => Array.from({ length: 1000 }, (_inner, j) => i * 1000 + j));
const large = Array.from({ length: 100 }, (_, i) => Array.from({ length: 1000 }, (_inner, j) => i * 1000 + j));

const currentFlatten = <A>(chunks: readonly (readonly A[])[]) => pipeFn(chunks, arrFlatten);
const pushLoop = <A>(chunks: readonly (readonly A[])[]): readonly A[] => {
	const result: A[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		for (let j = 0; j < chunk.length; j++) {
			result.push(chunk[j]);
		}
	}
	return result;
};
const nativeFlat = <A>(chunks: readonly (readonly A[])[]) => chunks.flat(1);

test("flatten-wide-shallow-10k", async ({ bench }) => {
	const expected = pushLoop(wideShallow);
	assertEquivalent("flatten-wide-shallow-10k/current", currentFlatten(wideShallow), expected);
	assertEquivalent("flatten-wide-shallow-10k/native", nativeFlat(wideShallow), expected);
	await bench.compare(
		bench("1. (current) Arr.flatten 10k (1000x10)", () => currentFlatten(wideShallow)),
		bench("2. push-loop 10k (1000x10)", () => pushLoop(wideShallow)),
		bench("3. native flat(1) 10k (1000x10)", () => nativeFlat(wideShallow)),
	);
});

test("flatten-narrow-deep-10k", async ({ bench }) => {
	const expected = pushLoop(narrowDeep);
	assertEquivalent("flatten-narrow-deep-10k/current", currentFlatten(narrowDeep), expected);
	assertEquivalent("flatten-narrow-deep-10k/native", nativeFlat(narrowDeep), expected);
	await bench.compare(
		bench("1. (current) Arr.flatten 10k (10x1000)", () => currentFlatten(narrowDeep)),
		bench("2. push-loop 10k (10x1000)", () => pushLoop(narrowDeep)),
		bench("3. native flat(1) 10k (10x1000)", () => nativeFlat(narrowDeep)),
	);
});

test("flatten-large-100k", async ({ bench }) => {
	const expected = pushLoop(large);
	assertEquivalent("flatten-large-100k/current", currentFlatten(large), expected);
	assertEquivalent("flatten-large-100k/native", nativeFlat(large), expected);
	await bench.compare(
		bench("1. (current) Arr.flatten 100k (100x1000)", () => currentFlatten(large)),
		bench("2. push-loop 100k (100x1000)", () => pushLoop(large)),
		bench("3. native flat(1) 100k (100x1000)", () => nativeFlat(large)),
	);
});
