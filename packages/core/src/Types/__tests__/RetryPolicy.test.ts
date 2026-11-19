import { expect, test } from "vitest";
import { Duration } from "../Duration.ts";
import { RetryPolicy } from "../RetryPolicy.ts";

// --- RetryPolicy.constant ---

test("constant: returns constant delay across attempts", () => {
	const policy = RetryPolicy.constant({ attempts: 3, delay: Duration.seconds(1) });
	expect(policy.attempts).toBe(3);
	expect(Duration.to.seconds(policy.getDelay(1))).toBe(1);
	expect(Duration.to.seconds(policy.getDelay(2))).toBe(1);
	expect(Duration.to.seconds(policy.getDelay(3))).toBe(1);
});

test("constant: clamps negative attempts to minimum of 1", () => {
	const policy = RetryPolicy.constant({ attempts: -1, delay: Duration.seconds(1) });
	expect(policy.attempts).toBe(1);
});

// --- RetryPolicy.exponential ---

test("exponential: clamps invalid attempt counts", () => {
	for (const attempts of [0, -1, 1.5, NaN, Infinity]) {
		const policy = RetryPolicy.exponential({ attempts, initial: Duration.milliseconds(10) });
		expect(policy.attempts).toBe(1);
	}
});

test("exponential: scales delays by factor without jitter", () => {
	const policy = RetryPolicy.exponential({ attempts: 4, initial: Duration.milliseconds(100), factor: 2, jitter: false });

	expect(policy.attempts).toBe(4);
	expect(Duration.to.milliseconds(policy.getDelay(1))).toBe(100);
	expect(Duration.to.milliseconds(policy.getDelay(2))).toBe(200);
	expect(Duration.to.milliseconds(policy.getDelay(3))).toBe(400);
	expect(Duration.to.milliseconds(policy.getDelay(4))).toBe(800);
});

test("exponential: defaults factor to 2", () => {
	const policy = RetryPolicy.exponential({ attempts: 3, initial: Duration.milliseconds(50) });

	expect(Duration.to.milliseconds(policy.getDelay(1))).toBe(50);
	expect(Duration.to.milliseconds(policy.getDelay(2))).toBe(100);
	expect(Duration.to.milliseconds(policy.getDelay(3))).toBe(200);
});

test("exponential: bounds jittered delay within [0, base]", () => {
	const policy = RetryPolicy.exponential({ attempts: 3, initial: Duration.milliseconds(100), factor: 2, jitter: true });

	const delay1 = Duration.to.milliseconds(policy.getDelay(1));
	expect(delay1).toBeGreaterThanOrEqual(0);
	expect(delay1).toBeLessThanOrEqual(100);

	const delay2 = Duration.to.milliseconds(policy.getDelay(2));
	expect(delay2).toBeGreaterThanOrEqual(0);
	expect(delay2).toBeLessThanOrEqual(200);
});

test("exponential: clamps delays at maxDelay limit", () => {
	const policy = RetryPolicy.exponential({
		attempts: 5,
		initial: Duration.milliseconds(100),
		factor: 2,
		maxDelay: Duration.milliseconds(300),
		jitter: false,
	});

	expect(Duration.to.milliseconds(policy.getDelay(1))).toBe(100);
	expect(Duration.to.milliseconds(policy.getDelay(2))).toBe(200);
	expect(Duration.to.milliseconds(policy.getDelay(3))).toBe(300);
	expect(Duration.to.milliseconds(policy.getDelay(4))).toBe(300);
});

test("exponential: preserves when and onRetry callbacks", () => {
	let retryCalled = false;
	const policy = RetryPolicy.exponential({
		attempts: 3,
		initial: Duration.milliseconds(50),
		when: (e) => e === "retryable",
		onRetry: () => {
			retryCalled = true;
		},
	});

	expect(policy.when?.("retryable")).toBe(true);
	expect(policy.when?.("other")).toBe(false);
	policy.onRetry?.({ attempt: 1, error: "retryable", delay: Duration.milliseconds(50) });
	expect(retryCalled).toBe(true);
});

test("constant: preserves when and onRetry callbacks", () => {
	let retryCalled = false;
	const policy = RetryPolicy.constant({
		attempts: 2,
		delay: Duration.seconds(1),
		when: (e) => e === "ok",
		onRetry: () => {
			retryCalled = true;
		},
	});

	expect(policy.when?.("ok")).toBe(true);
	expect(policy.when?.("no")).toBe(false);
	policy.onRetry?.({ attempt: 1, error: "ok", delay: Duration.seconds(1) });
	expect(retryCalled).toBe(true);
});

test("exponential: respects zero maxDelay and clamps invalid delays", () => {
	const zero = RetryPolicy.exponential({
		attempts: 2,
		initial: Duration.milliseconds(100),
		maxDelay: Duration.milliseconds(0),
	});
	expect(Duration.to.milliseconds(zero.getDelay(1))).toBe(0);

	const huge = RetryPolicy.exponential({ attempts: 2, initial: Duration.milliseconds(100), factor: 2 });
	expect(Duration.to.milliseconds(huge.getDelay(40))).toBe(2_147_483_647);

	const invalid = RetryPolicy.exponential({
		attempts: 2,
		initial: Duration.milliseconds(-5),
		factor: -2,
		maxDelay: Duration.milliseconds(-1),
	});
	expect(Duration.to.milliseconds(invalid.getDelay(1))).toBe(0);
});

test("exponential: normalizes non-finite factors and attempts", () => {
	const factorNaN = RetryPolicy.exponential({ attempts: 2, initial: Duration.milliseconds(100), factor: Number.NaN });
	expect(Duration.to.milliseconds(factorNaN.getDelay(2))).toBe(200);

	const attemptNaN = RetryPolicy.exponential({ attempts: 2, initial: Duration.milliseconds(100) });
	expect(Duration.to.milliseconds(attemptNaN.getDelay(Number.NaN))).toBe(100);

	const factorInfinity = RetryPolicy.exponential({
		attempts: 2,
		initial: Duration.milliseconds(100),
		factor: Number.POSITIVE_INFINITY,
	});
	expect(Duration.to.milliseconds(factorInfinity.getDelay(2))).toBe(200);

	const overflow = RetryPolicy.exponential({ attempts: 2, initial: Duration.milliseconds(100), factor: 2 });
	expect(Duration.to.milliseconds(overflow.getDelay(2_000))).toBe(2_147_483_647);
});

test("exponential: forwards an optional budget onto the policy", () => {
	const policy = RetryPolicy.exponential({
		attempts: 3,
		initial: Duration.milliseconds(10),
		budget: Duration.seconds(2),
	});
	expect(policy.budget).toStrictEqual(Duration.seconds(2));
});

test("constant: forwards an optional budget onto the policy", () => {
	const policy = RetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(10), budget: Duration.seconds(2) });
	expect(policy.budget).toStrictEqual(Duration.seconds(2));
});
