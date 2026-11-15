/** The largest delay a JavaScript timer accepts before Node/WHATWG clamps it to 1 ms. */
export const MAX_TIMER_MS = 2_147_483_647;

/** Normalizes a millisecond delay into the safe `setTimeout` range. */
export const clampTimerDelay = (milliseconds: number): number => {
	if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
		return milliseconds === Number.POSITIVE_INFINITY ? MAX_TIMER_MS : 0;
	}
	return Math.min(Math.floor(milliseconds), MAX_TIMER_MS);
};
