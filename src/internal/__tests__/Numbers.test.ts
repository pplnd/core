import { expect, test } from "vitest";
import { toBoundedCount, toFiniteCount, toPositiveInteger } from "../Numbers.ts";

test("toBoundedCount: clamps invalid, fractional, and oversized values", () => {
	expect(toBoundedCount(Number.NaN, 10)).toBe(0);
	expect(toBoundedCount(-1, 10)).toBe(0);
	expect(toBoundedCount(1.9, 10)).toBe(1);
	expect(toBoundedCount(Number.POSITIVE_INFINITY, 10)).toBe(10);
	expect(toBoundedCount(50, 10)).toBe(10);
});

test("toPositiveInteger: rejects invalid sizes", () => {
	expect(toPositiveInteger(1)).toBe(1);
	expect(toPositiveInteger(1.5)).toBeUndefined();
	expect(toPositiveInteger(0)).toBeUndefined();
	expect(toPositiveInteger(Number.NaN)).toBeUndefined();
});

test("toFiniteCount: falls back for non-finite targets", () => {
	expect(toFiniteCount(5.9, 2)).toBe(5);
	expect(toFiniteCount(-1, 2)).toBe(0);
	expect(toFiniteCount(Number.NaN, 2)).toBe(2);
	expect(toFiniteCount(Number.POSITIVE_INFINITY, 2)).toBe(2);
});
