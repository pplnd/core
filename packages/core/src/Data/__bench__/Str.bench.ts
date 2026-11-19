import { pipe } from "#composition";
import { Str } from "#data";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

// Local bindings to eliminate Vite module runner export getter overhead
const strSplit = Str.split;
const strTrim = Str.trim;
const strLines = Str.lines;
const strWords = Str.words;
const strSize = Str.size;
const strGraphemeSize = Str.graphemeSize;
const pipeFn = pipe;

const csv100 = Array.from({ length: 100 }, (_, i) => `value${i}`).join(",");
const csv10k = Array.from({ length: 10_000 }, (_, i) => `value${i}`).join(",");
const multiline100 = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
const multiline10k = Array.from({ length: 10_000 }, (_, i) => `line ${i}`).join("\n");
const paragraph100 = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
const paragraph10k = Array.from({ length: 10_000 }, (_, i) => `word${i}`).join(" ");
const paddedStr = `   ${paragraph100}   `;

const asciiShort = "hello";
const asciiMedium =
	"The quick brown fox jumps over the lazy dog. Packing my box with five dozen liquor jugs every day.";
const compoundEmoji = "👨‍👩‍👧‍👦";
const emojiSentence = "Hello 🌍! Here is 👨‍👩‍👧‍👦 and 👋🏽 and 🇺🇸. The quick brown fox jumps over the lazy dog! 🚀🎉";
const nonLatinSentence = "नमस्ते - Hello world!";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const currentSplit = (text: string) => pipeFn(text, strSplit(","));
const nativeSplit = (text: string) => text.split(",");
const currentTrim = (text: string) => pipeFn(text, strTrim);
const nativeTrim = (text: string) => text.trim();
const currentLines = (text: string) => strLines(text);
const nativeLines = (text: string) => text.split(/\r?\n|\r/u);
const currentWords = (text: string) => strWords(text);
const nativeWords = (text: string) => text.trim().split(/\s+/u).filter(Boolean);
const nativeGraphemeCount = (text: string) => {
	let count = 0;
	for (const _ of segmenter.segment(text)) {
		count++;
	}
	return count;
};

// =============================================================================
// split
// =============================================================================

test("split-100", async ({ bench }) => {
	assertEquivalent("split-100", currentSplit(csv100), nativeSplit(csv100));
	await bench.compare(
		bench("1. (current) Str.split csv 100", () => currentSplit(csv100)),
		bench("2. native .split csv 100", () => nativeSplit(csv100)),
	);
});

test("split-10k", async ({ bench }) => {
	assertEquivalent("split-10k", currentSplit(csv10k), nativeSplit(csv10k));
	await bench.compare(
		bench("1. (current) Str.split csv 10k", () => currentSplit(csv10k)),
		bench("2. native .split csv 10k", () => nativeSplit(csv10k)),
	);
});

// =============================================================================
// trim
// =============================================================================

test("trim", async ({ bench }) => {
	assertEquivalent("trim", currentTrim(paddedStr), nativeTrim(paddedStr));
	await bench.compare(
		bench("1. (current) Str.trim long string", () => currentTrim(paddedStr)),
		bench("2. native .trim long string", () => nativeTrim(paddedStr)),
	);
});

// =============================================================================
// lines
// =============================================================================

test("lines-100", async ({ bench }) => {
	assertEquivalent("lines-100", currentLines(multiline100), nativeLines(multiline100));
	await bench.compare(
		bench("1. (current) Str.lines 100", () => currentLines(multiline100)),
		bench("2. native split lines 100", () => nativeLines(multiline100)),
	);
});

test("lines-10k", async ({ bench }) => {
	assertEquivalent("lines-10k", currentLines(multiline10k), nativeLines(multiline10k));
	await bench.compare(
		bench("1. (current) Str.lines 10k", () => currentLines(multiline10k)),
		bench("2. native split lines 10k", () => nativeLines(multiline10k)),
	);
});

// =============================================================================
// words
// =============================================================================

test("words-100", async ({ bench }) => {
	assertEquivalent("words-100", currentWords(paragraph100), nativeWords(paragraph100));
	await bench.compare(
		bench("1. (current) Str.words 100", () => currentWords(paragraph100)),
		bench("2. native words 100", () => nativeWords(paragraph100)),
	);
});

test("words-10k", async ({ bench }) => {
	assertEquivalent("words-10k", currentWords(paragraph10k), nativeWords(paragraph10k));
	await bench.compare(
		bench("1. (current) Str.words 10k", () => currentWords(paragraph10k)),
		bench("2. native words 10k", () => nativeWords(paragraph10k)),
	);
});

// Parsing no longer lives in `Str`; `Num.from.string` is benchmarked in Num.bench.ts.

// =============================================================================
// size & graphemeSize
// =============================================================================

test("size-ascii-short", async ({ bench }) => {
	assertEquivalent("size-ascii-short", strSize(asciiShort), asciiShort.length);
	await bench.compare(
		bench("1. (current) Str.size", () => strSize(asciiShort)),
		bench("2. native .length", () => asciiShort.length),
	);
});

test("graphemeSize-ascii-short", async ({ bench }) => {
	assertEquivalent("graphemeSize-ascii-short", strGraphemeSize(asciiShort), nativeGraphemeCount(asciiShort));
	await bench.compare(
		bench("1. (current) Str.graphemeSize (ASCII fast-path)", () => strGraphemeSize(asciiShort)),
		bench("2. raw Intl.Segmenter", () => nativeGraphemeCount(asciiShort)),
	);
});

test("graphemeSize-ascii-medium", async ({ bench }) => {
	assertEquivalent("graphemeSize-ascii-medium", strGraphemeSize(asciiMedium), nativeGraphemeCount(asciiMedium));
	await bench.compare(
		bench("1. (current) Str.graphemeSize (ASCII fast-path)", () => strGraphemeSize(asciiMedium)),
		bench("2. raw Intl.Segmenter", () => nativeGraphemeCount(asciiMedium)),
	);
});

test("graphemeSize-compound-emoji", async ({ bench }) => {
	assertEquivalent("graphemeSize-compound-emoji", strGraphemeSize(compoundEmoji), nativeGraphemeCount(compoundEmoji));
	await bench.compare(
		bench("1. (current) Str.graphemeSize", () => strGraphemeSize(compoundEmoji)),
		bench("2. raw Intl.Segmenter", () => nativeGraphemeCount(compoundEmoji)),
	);
});

test("graphemeSize-mixed-emoji", async ({ bench }) => {
	assertEquivalent("graphemeSize-mixed-emoji", strGraphemeSize(emojiSentence), nativeGraphemeCount(emojiSentence));
	await bench.compare(
		bench("1. (current) Str.graphemeSize", () => strGraphemeSize(emojiSentence)),
		bench("2. raw Intl.Segmenter", () => nativeGraphemeCount(emojiSentence)),
	);
});

test("graphemeSize-non-latin", async ({ bench }) => {
	assertEquivalent("graphemeSize-non-latin", strGraphemeSize(nonLatinSentence), nativeGraphemeCount(nonLatinSentence));
	await bench.compare(
		bench("1. (current) Str.graphemeSize", () => strGraphemeSize(nonLatinSentence)),
		bench("2. raw Intl.Segmenter", () => nativeGraphemeCount(nonLatinSentence)),
	);
});
