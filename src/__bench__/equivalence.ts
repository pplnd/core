import { isDeepStrictEqual } from "node:util";

/**
 * Runs both sides of a benchmark comparison once, outside the timed section,
 * and fails the benchmark when they disagree. Without this check a semantic
 * regression on either side still reports a "passing" benchmark.
 */
export const assertEquivalent = (
	label: string,
	actual: unknown,
	expected: unknown,
	compare: (first: unknown, second: unknown) => boolean = isDeepStrictEqual,
): void => {
	if (!compare(actual, expected)) {
		throw new Error(`Benchmark baseline mismatch: ${label} (current and baseline return different results)`);
	}
};

/**
 * Compares records by own enumerable key/value content and ignores the
 * prototype chain. `Object.groupBy` returns a null-prototype record while
 * `Rec.groupBy` returns a plain object; the timing comparison is still valid,
 * but `isDeepStrictEqual` would reject the pair on the prototype difference.
 */
export const sameRecordContent = (first: unknown, second: unknown): boolean => {
	if (typeof first !== "object" || first === null || typeof second !== "object" || second === null) {
		return false;
	}
	const firstRecord = first as Record<string, unknown>;
	const secondRecord = second as Record<string, unknown>;
	const firstKeys = Object.keys(firstRecord).sort();
	const secondKeys = Object.keys(secondRecord).sort();
	if (!isDeepStrictEqual(firstKeys, secondKeys)) {
		return false;
	}
	for (const key of firstKeys) {
		if (!isDeepStrictEqual(firstRecord[key], secondRecord[key])) {
			return false;
		}
	}
	return true;
};
