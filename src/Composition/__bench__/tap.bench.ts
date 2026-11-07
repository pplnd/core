import { tap, tapAsync, tapLog, tapTime } from "#composition";
import { Duration } from "#types";
import { test } from "vitest";
import { assertEquivalent } from "../../__bench__/equivalence.ts";

const messages: string[] = [];
const logger = (message: string) => {
	messages.push(message);
};

const currentLog = tapLog({ logger });
// Rejected alternative: hoist the option resolution to construction time.
const hoistedLog = (() => {
	const formatter = (value: number) => String(value);
	return (value: number): number => {
		logger(formatter(value));
		return value;
	};
})();

const currentTime = tapTime((n: number) => n + 1, { onFinish: () => {} });
// Previous implementation: builds the finish callback on every call.
const perCallTime = (fn: (n: number) => unknown, onFinish: (duration: Duration) => void) => (n: number): number => {
	const start = performance.now();
	const triggerFinish = (duration: Duration) => {
		onFinish(duration);
	};
	fn(n);
	const duration = Duration.milliseconds(performance.now() - start);
	triggerFinish(duration);
	return n;
};
const previousTime = perCallTime((n: number) => n + 1, () => {});

const currentTap = tap((n: number) => n);
const currentTapAsync = tapAsync(() => Promise.resolve(1));

test("tapLog-and-tapTime", async ({ bench }) => {
	assertEquivalent("tapLog", currentLog(42), hoistedLog(42));
	assertEquivalent("tapLog/message", messages.at(-1), "42");
	assertEquivalent("tapTime", currentTime(42), previousTime(42));
	await bench.compare(
		bench("1. (current) tapLog options resolved per call", () => currentLog(42)),
		bench("2. tapLog options hoisted (rejected)", () => hoistedLog(42)),
		bench("3. (current) tapTime finish callback hoisted", () => currentTime(42)),
		bench("4. tapTime finish callback per call (previous)", () => previousTime(42)),
	);
});

test("tap-and-tapAsync-parity", async ({ bench }) => {
	assertEquivalent("tap", currentTap(42), 42);
	assertEquivalent("tapAsync", currentTapAsync(42), 42);
	await bench.compare(
		bench("1. (current) tap", () => currentTap(42)),
		bench("2. inline side effect", () => {
			const value = 42;
			return value;
		}),
		bench("3. (current) tapAsync", () => currentTapAsync(42)),
	);
});
