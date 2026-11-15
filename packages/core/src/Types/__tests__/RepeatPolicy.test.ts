import { expect, test } from "vitest";
import { Duration } from "../Duration.ts";
import { RepeatPolicy } from "../RepeatPolicy.ts";

test("spacing: repeats exactly `every` after each settled attempt", () => {
	const policy = RepeatPolicy.spacing({ every: Duration.milliseconds(100) });
	expect(Duration.to.milliseconds(policy.getDelay({ tick: 1, elapsed: Duration.milliseconds(3) }))).toBe(100);
	expect(Duration.to.milliseconds(policy.getDelay({ tick: 2, elapsed: Duration.milliseconds(7) }))).toBe(100);
});

test("spacing: jitter spreads delays across the upper half of `every`", () => {
	const policy = RepeatPolicy.spacing({ every: Duration.milliseconds(100), jitter: true });
	for (let i = 0; i < 20; i++) {
		const ms = Duration.to.milliseconds(policy.getDelay({ tick: 1, elapsed: Duration.milliseconds(0) }));
		expect(ms).toBeGreaterThanOrEqual(50);
		expect(ms).toBeLessThan(100);
	}
});

test("cadence: aligns the next attempt to the next grid multiple", () => {
	const policy = RepeatPolicy.cadence({ every: Duration.milliseconds(10) });
	expect(Duration.to.milliseconds(policy.getDelay({ tick: 1, elapsed: Duration.milliseconds(3) }))).toBe(7);
	expect(Duration.to.milliseconds(policy.getDelay({ tick: 2, elapsed: Duration.milliseconds(12) }))).toBe(8);
	expect(Duration.to.milliseconds(policy.getDelay({ tick: 3, elapsed: Duration.milliseconds(25) }))).toBe(5);
});

test("cadence: a settle landing on the grid fires once immediately", () => {
	const policy = RepeatPolicy.cadence({ every: Duration.milliseconds(10) });
	expect(Duration.to.milliseconds(policy.getDelay({ tick: 2, elapsed: Duration.milliseconds(20) }))).toBe(0);
});

test("cadence: jitter offsets the grid within one period", () => {
	const policy = RepeatPolicy.cadence({ every: Duration.milliseconds(100), jitter: true });
	for (let i = 0; i < 20; i++) {
		const ms = Duration.to.milliseconds(policy.getDelay({ tick: 1, elapsed: Duration.milliseconds(40) }));
		expect(ms).toBeGreaterThanOrEqual(0);
		expect(ms).toBeLessThan(100);
	}
});
