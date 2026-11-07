import { converge, juxt } from "#composition";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

const first = (text: string) => text.slice(0, 2);
const second = (text: string) => text.slice(2);
const third = (text: string) => text.toUpperCase();
const fourth = (text: string) => text.slice(0, 1);

const pool = Array.from({ length: 256 }, (_, i) => `value-${i}`);
let cursor = 0;
const nextText = () => {
	cursor = (cursor + 1) & 255;
	return pool[cursor];
};

const combine2 = (...values: string[]) => values[0] + values[1];
const combine3 = (...values: string[]) => values[0] + values[1] + values[2];
const combine4 = (...values: string[]) => values[0] + values[1] + values[2] + values[3];

const current2 = converge(combine2, [first, second]);
const current3 = converge(combine3, [first, second, third]);
const current4 = converge(combine4, [first, second, third, fourth]);

// Previous implementation: map the transformers into a fresh array, then spread-call the combiner.
const previous =
	(combine: (...values: string[]) => string, transformers: readonly ((text: string) => string)[]) => (text: string) =>
		combine(...transformers.map((transform) => transform(text)));
const previous2 = previous(combine2, [first, second]);
const previous3 = previous(combine3, [first, second, third]);
const previous4 = previous(combine4, [first, second, third, fourth]);

const currentJuxt2 = juxt([first, second]);
const currentJuxt3 = juxt([first, second, third]);
const previousJuxt = (transformers: readonly ((text: string) => string)[]) => (text: string) =>
	transformers.map((transform) => transform(text));
const previousJuxt2 = previousJuxt([first, second]);
const previousJuxt3 = previousJuxt([first, second, third]);

test("converge-arity", async ({ bench }) => {
	const text = nextText();
	assertEquivalent("converge/2", current2(text), previous2(text));
	assertEquivalent("converge/3", current3(text), previous3(text));
	assertEquivalent("converge/4", current4(text), previous4(text));
	await bench.compare(
		bench("1. (current) converge 2 transformers", () => current2(nextText())),
		bench("2. map + spread 2 transformers (previous)", () => previous2(nextText())),
		bench("3. (current) converge 3 transformers", () => current3(nextText())),
		bench("4. map + spread 3 transformers (previous)", () => previous3(nextText())),
		bench("5. (current) converge 4 transformers", () => current4(nextText())),
		bench("6. map + spread 4 transformers (previous)", () => previous4(nextText())),
	);
});

test("juxt-arity", async ({ bench }) => {
	const text = nextText();
	assertEquivalent("juxt/2", currentJuxt2(text), previousJuxt2(text));
	assertEquivalent("juxt/3", currentJuxt3(text), previousJuxt3(text));
	await bench.compare(
		bench("1. (current) juxt 2 functions", () => currentJuxt2(nextText())),
		bench("2. array map 2 functions (previous)", () => previousJuxt2(nextText())),
		bench("3. (current) juxt 3 functions", () => currentJuxt3(nextText())),
		bench("4. array map 3 functions (previous)", () => previousJuxt3(nextText())),
	);
});
