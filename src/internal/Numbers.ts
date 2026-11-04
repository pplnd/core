/**
 * Normalizes a count or target length to an integer within `[0, upperBound]`.
 * `Infinity` means "use the whole available range"; `NaN` and negatives mean zero.
 */
export const toBoundedCount = (value: number, upperBound: number): number => {
	if (Number.isNaN(value) || value <= 0) {
		return 0;
	}
	if (value === Number.POSITIVE_INFINITY) {
		return upperBound;
	}
	return Math.min(Math.floor(value), upperBound);
};

/** Returns `value` only when it is a positive integer. */
export const toPositiveInteger = (value: number): number | undefined =>
	Number.isInteger(value) && value > 0 ? value : undefined;

/** Normalizes a finite non-negative integer, falling back for `NaN`/`Infinity`. */
export const toFiniteCount = (value: number, fallback: number): number =>
	Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
