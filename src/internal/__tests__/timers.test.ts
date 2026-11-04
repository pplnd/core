import { expect, test } from "vitest";
import { clampTimerDelay, MAX_TIMER_MS } from "../timers.ts";

test("clampTimerDelay: normalizes invalid and out-of-range delays", () => {
	expect(clampTimerDelay(Number.NaN)).toBe(0);
	expect(clampTimerDelay(-5)).toBe(0);
	expect(clampTimerDelay(Number.POSITIVE_INFINITY)).toBe(MAX_TIMER_MS);
	expect(clampTimerDelay(1.9)).toBe(1);
	expect(clampTimerDelay(MAX_TIMER_MS + 10)).toBe(MAX_TIMER_MS);
});
