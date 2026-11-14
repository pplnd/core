import { expect, test, vi } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { Deferred } from "../Deferred.ts";
import { RateLimiter } from "../RateLimiter.ts";
import { Result } from "../Result.ts";
import { Task } from "../Task.ts";

const withFakeTimers = async (run: () => Promise<void>): Promise<void> => {
	vi.useFakeTimers();
	try {
		await run();
	} finally {
		vi.useRealTimers();
	}
};

test("run: admits a task while a permit is free", async () => {
	const limiter = RateLimiter.make({ limit: 2, window: Duration.seconds(1) });
	limiter.reset();
	await expect(limiter.run(Task.Result.make.ok(42))).resolves.toStrictEqual(Result.make.ok(42));
	expect(limiter.available()).toBe(1);
});

test("run: passes the task error through unchanged", async () => {
	const limiter = RateLimiter.make({ limit: 1, window: Duration.seconds(1) });
	await expect(limiter.run(Task.Result.make.err("failed"))).resolves.toStrictEqual(Result.make.err("failed"));
});

test("available: a permit returns after the window", async () => {
	await withFakeTimers(async () => {
		const limiter = RateLimiter.make({ limit: 1, window: Duration.milliseconds(100) });
		await limiter.run(Task.Result.make.ok(1));
		expect(limiter.available()).toBe(0);
		await vi.advanceTimersByTimeAsync(100);
		expect(limiter.available()).toBe(1);
	});
});

test("run: waits for the window before starting a queued task", async () => {
	await withFakeTimers(async () => {
		let runs = 0;
		const limiter = RateLimiter.make({ limit: 1, window: Duration.milliseconds(100), maxWait: Duration.seconds(1) });
		const task = Task.from.sync(() => {
			runs++;
			return Result.make.ok(runs);
		});
		const first = limiter.run(task);
		const second = limiter.run(task);
		expect(runs).toBe(1);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(99);
		expect(runs).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(runs).toBe(2);
		await expect(first).resolves.toStrictEqual(Result.make.ok(1));
		await expect(second).resolves.toStrictEqual(Result.make.ok(2));
		expect(vi.getTimerCount()).toBe(0);
	});
});

test("run: admits queued callers in submission order", async () => {
	await withFakeTimers(async () => {
		const limiter = RateLimiter.make({ limit: 1, window: Duration.milliseconds(50) });
		const order: string[] = [];
		const task = (label: string) =>
			Task.from.sync(() => {
				order.push(label);
				return Result.make.ok(label);
			});
		void limiter.run(task("a"));
		void limiter.run(task("b"));
		void limiter.run(task("c"));
		await vi.advanceTimersByTimeAsync(200);
		expect(order).toStrictEqual(["a", "b", "c"]);
	});
});

test("run: rejects immediately with the remaining wait under the reject strategy", async () => {
	await withFakeTimers(async () => {
		let runs = 0;
		const limiter = RateLimiter.make({ limit: 1, window: Duration.milliseconds(100), strategy: "reject" });
		const task = Task.from.sync(() => {
			runs++;
			return Result.make.ok(runs);
		});
		await limiter.run(task);
		const rejected = await limiter.run(task);
		expect(rejected).toStrictEqual(Result.make.err({ kind: "RateLimitExceeded", retryAfter: 100, reason: "exhausted" }));
		expect(runs).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});

test("run: rejects with max-wait when the estimate exceeds maxWait", async () => {
	await withFakeTimers(async () => {
		const limiter = RateLimiter.make({ limit: 1, window: Duration.seconds(10), maxWait: Duration.seconds(1) });
		await limiter.run(Task.Result.make.ok(1));
		const rejected = await limiter.run(Task.Result.make.ok(2));
		expect(rejected).toStrictEqual(
			Result.make.err({ kind: "RateLimitExceeded", retryAfter: 10_000, reason: "max-wait" }),
		);
	});
});

test("run: aborting a queued call settles it without spending a permit", async () => {
	await withFakeTimers(async () => {
		const limiter = RateLimiter.make({ limit: 1, window: Duration.milliseconds(100) });
		await limiter.run(Task.Result.make.ok(0));
		const controller = new AbortController();
		let ran = false;
		const queued = limiter.run(
			Task.from.sync(() => {
				ran = true;
				return Result.make.ok(1);
			}),
			{ signal: controller.signal },
		);
		expect(vi.getTimerCount()).toBe(1);
		controller.abort("left");
		await expect(queued).resolves.toStrictEqual(Result.make.err({ kind: "Aborted", reason: "left" }));
		expect(ran).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(200);
		expect(ran).toBe(false);
	});
});

test("run: aborting one queued call leaves the others queued", async () => {
	await withFakeTimers(async () => {
		const limiter = RateLimiter.make({ limit: 1, window: Duration.milliseconds(100) });
		await limiter.run(Task.Result.make.ok(0));
		const controller = new AbortController();
		const aborted = limiter.run(Task.Result.make.ok(1), { signal: controller.signal });
		const kept = limiter.run(Task.Result.make.ok(2));
		controller.abort("left");
		await expect(aborted).resolves.toStrictEqual(Result.make.err({ kind: "Aborted", reason: "left" }));
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(100);
		await expect(kept).resolves.toStrictEqual(Result.make.ok(2));
	});
});

test("run: a pre-aborted signal settles without a permit", async () => {
	await withFakeTimers(async () => {
		const controller = new AbortController();
		controller.abort("pre");
		const limiter = RateLimiter.make({ limit: 1, window: Duration.seconds(1) });
		await expect(limiter.run(Task.Result.make.ok(1), { signal: controller.signal })).resolves.toStrictEqual(
			Result.make.err({ kind: "Aborted", reason: "pre" }),
		);
		expect(limiter.available()).toBe(1);
	});
});

test("run: passes the caller signal to the task", async () => {
	const controller = new AbortController();
	let received: AbortSignal | undefined;
	const task = (signal?: AbortSignal) => {
		received = signal;
		return Deferred.from.Promise(Promise.resolve(Result.make.ok(1)));
	};
	const limiter = RateLimiter.make({ limit: 1, window: Duration.seconds(1) });
	await limiter.run(task, { signal: controller.signal });
	expect(received).toBe(controller.signal);
});

test("reset: admits every queued caller and clamps available at zero", async () => {
	await withFakeTimers(async () => {
		const limiter = RateLimiter.make({ limit: 1, window: Duration.seconds(10) });
		await limiter.run(Task.Result.make.ok(0));
		const first = limiter.run(Task.Result.make.ok(1));
		const second = limiter.run(Task.Result.make.ok(2));
		expect(vi.getTimerCount()).toBe(1);
		limiter.reset();
		await expect(first).resolves.toStrictEqual(Result.make.ok(1));
		await expect(second).resolves.toStrictEqual(Result.make.ok(2));
		expect(vi.getTimerCount()).toBe(0);
		expect(limiter.available()).toBe(0);
	});
});

test("make: clamps the limit and treats a non-finite window as zero", async () => {
	await withFakeTimers(async () => {
		const limiter = RateLimiter.make({ limit: 0, window: Duration.milliseconds(Number.NaN) });
		expect(limiter.available()).toBe(1);
		await limiter.run(Task.Result.make.ok(1));
		expect(limiter.available()).toBe(1);
	});
});

test("make: treats a non-finite maxWait as zero", async () => {
	await withFakeTimers(async () => {
		const limiter = RateLimiter.make({
			limit: 1,
			window: Duration.milliseconds(100),
			maxWait: Duration.milliseconds(Number.NaN),
		});
		await limiter.run(Task.Result.make.ok(1));
		const rejected = await limiter.run(Task.Result.make.ok(2));
		expect(rejected).toStrictEqual(Result.make.err({ kind: "RateLimitExceeded", retryAfter: 100, reason: "max-wait" }));
	});
});
