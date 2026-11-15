import { expect, test } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { schedulePollRepeat } from "../Op.util.ts";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("schedulePollRepeat: honors an interval longer than the platform timer maximum via chaining", async () => {
	let fires = 0;
	// 60 ms requested with a 20 ms step cap: three chained timers must deliver the full
	// interval — the fire may only happen at or after 60 ms, never substituted for less.
	const stop = schedulePollRepeat(Duration.milliseconds(60), () => fires++, 20);
	await sleep(50);
	expect(fires).toBe(0); // a clamping implementation would already have fired here
	await sleep(50);
	expect(fires).toBe(1);
	stop();
	await sleep(80);
	expect(fires).toBe(1);
});

test("schedulePollRepeat: cancelling during fire prevents the next repeat", async () => {
	let fires = 0;
	let stop: () => void = () => undefined;
	stop = schedulePollRepeat(Duration.milliseconds(15), () => {
		fires++;
		stop();
	}, 20);
	await sleep(60);
	expect(fires).toBe(1);
});

test("schedulePollRepeat: non-finite, sub-millisecond, zero, and negative intervals never repeat", async () => {
	for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, 0.5, 0, -5]) {
		let fires = 0;
		const stop = schedulePollRepeat(Duration.milliseconds(ms), () => fires++, 20);
		await sleep(30);
		expect(fires).toBe(0);
		stop();
	}
});
