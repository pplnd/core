import { expect, test, vi } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { type RetryPolicy, RetryPolicy as CoreRetryPolicy } from "../../Types/RetryPolicy.ts";
import { Deferred } from "../Deferred.ts";
import { Result } from "../Result.ts";
import { Supervisor } from "../Supervisor.ts";
import { Task } from "../Task.ts";

const withFakeTimers = async (run: () => Promise<void>): Promise<void> => {
	vi.useFakeTimers();
	try {
		await run();
	} finally {
		vi.useRealTimers();
	}
};

const makeControlledTask = <E>() => {
	let settle = (_result: Result<E, void>): void => undefined;
	let received: AbortSignal | undefined;
	const task = (signal?: AbortSignal) => {
		received = signal;
		return Deferred.from.Promise(
			new Promise<Result<E, void>>((resolve) => {
				settle = resolve;
			}),
		);
	};
	return { task, settle: (result: Result<E, void>) => settle(result), signal: () => received };
};

test("run: settles with a completed lifetime when the task succeeds", async () => {
	const supervisor = Supervisor.make(Task.from.sync(() => Result.make.ok(undefined)), {
		restart: CoreRetryPolicy.constant({ attempts: 1, delay: Duration.milliseconds(10) }),
	});
	expect(supervisor.state()).toStrictEqual({ kind: "SupervisorIdle" });
	const lifetime = supervisor.run();
	expect(supervisor.state()).toStrictEqual({ kind: "SupervisorRunning", restarts: 0 });
	await expect(lifetime).resolves.toStrictEqual(Result.make.ok({ kind: "SupervisorStopped", reason: "completed" }));
	expect(supervisor.state()).toStrictEqual({ kind: "SupervisorStopped", reason: "completed" });
});

test("run: restarts a failed attempt after the policy delay", async () => {
	await withFakeTimers(async () => {
		const retries: number[] = [];
		let calls = 0;
		const task = Task.from.sync(() => {
			calls++;
			return calls === 1 ? Result.make.err("boom") : Result.make.ok(undefined);
		});
		const supervisor = Supervisor.make(task, {
			restart: CoreRetryPolicy.constant({
				attempts: 2,
				delay: Duration.milliseconds(50),
				onRetry: (metadata) => retries.push(metadata.attempt),
			}),
		});

		const lifetime = supervisor.run();
		await vi.advanceTimersByTimeAsync(0);
		expect(supervisor.state()).toStrictEqual({
			kind: "SupervisorBackingOff",
			attempt: 1,
			delay: Duration.milliseconds(50),
			error: "boom",
		});
		await vi.advanceTimersByTimeAsync(50);
		await expect(lifetime).resolves.toStrictEqual(Result.make.ok({ kind: "SupervisorStopped", reason: "completed" }));
		expect(calls).toBe(2);
		expect(retries).toStrictEqual([1]);
		expect(vi.getTimerCount()).toBe(0);
	});
});

test("run: settles with the error when attempts are exhausted", async () => {
	await withFakeTimers(async () => {
		const supervisor = Supervisor.make(Task.from.sync(() => Result.make.err("boom")), {
			restart: CoreRetryPolicy.constant({ attempts: 2, delay: Duration.milliseconds(10) }),
		});
		const lifetime = supervisor.run();
		await vi.advanceTimersByTimeAsync(1_000);
		await expect(lifetime).resolves.toStrictEqual(Result.make.err("boom"));
		expect(supervisor.state()).toStrictEqual({ kind: "SupervisorFailed", attempts: 2, error: "boom" });
		expect(vi.getTimerCount()).toBe(0);
	});
});

test("run: settles with the error when the policy rejects it", async () => {
	const supervisor = Supervisor.make(Task.from.sync(() => Result.make.err("fatal")), {
		restart: CoreRetryPolicy.constant({ attempts: 5, delay: Duration.milliseconds(10), when: () => false }),
	});
	await expect(supervisor.run()).resolves.toStrictEqual(Result.make.err("fatal"));
	expect(supervisor.state()).toStrictEqual({ kind: "SupervisorFailed", attempts: 1, error: "fatal" });
});

test("run: treats a non-integer attempt limit as one attempt", async () => {
	const policy: RetryPolicy<"boom"> = { attempts: Number.NaN, getDelay: () => Duration.milliseconds(0) };
	const supervisor = Supervisor.make(Task.from.sync(() => Result.make.err("boom")), { restart: policy });
	await expect(supervisor.run()).resolves.toStrictEqual(Result.make.err("boom"));
	expect(supervisor.state()).toStrictEqual({ kind: "SupervisorFailed", attempts: 1, error: "boom" });
});

test("run: returns the same deferred while the lifetime is active", () => {
	const controlled = makeControlledTask<"offline">();
	const supervisor = Supervisor.make(controlled.task, {
		restart: CoreRetryPolicy.constant({ attempts: 2, delay: Duration.milliseconds(10) }),
	});
	const first = supervisor.run();
	const second = supervisor.run();
	expect(second).toBe(first);
	supervisor.abort();
	controlled.settle(Result.make.err("offline"));
});

test("run: starts a new lifetime after the previous one ended", async () => {
	let calls = 0;
	const supervisor = Supervisor.make(
		Task.from.sync(() => {
			calls++;
			return Result.make.ok(undefined);
		}),
		{ restart: CoreRetryPolicy.constant({ attempts: 1, delay: Duration.milliseconds(10) }) },
	);
	const first = supervisor.run();
	await first;
	const second = supervisor.run();
	await second;
	expect(calls).toBe(2);
	expect(second).not.toBe(first);
});

test("abort: waits for the running attempt before settling", async () => {
	const controlled = makeControlledTask<"offline">();
	const supervisor = Supervisor.make(controlled.task, {
		restart: CoreRetryPolicy.constant({ attempts: 3, delay: Duration.milliseconds(10) }),
	});
	const lifetime = supervisor.run();
	let settled = false;
	void lifetime.then(() => {
		settled = true;
	});

	supervisor.abort();
	expect(controlled.signal()?.aborted).toBe(true);
	await Promise.resolve();
	expect(settled).toBe(false);

	controlled.settle(Result.make.err("offline"));
	await expect(lifetime).resolves.toStrictEqual(Result.make.ok({ kind: "SupervisorStopped", reason: "aborted" }));
	expect(settled).toBe(true);
});

test("abort: cancels a pending backoff immediately", async () => {
	await withFakeTimers(async () => {
		const supervisor = Supervisor.make(Task.from.sync(() => Result.make.err("boom")), {
			restart: CoreRetryPolicy.constant({ attempts: 5, delay: Duration.milliseconds(100) }),
		});
		const lifetime = supervisor.run();
		await vi.advanceTimersByTimeAsync(0);
		expect(supervisor.state().kind).toBe("SupervisorBackingOff");
		expect(vi.getTimerCount()).toBe(1);

		supervisor.abort();
		expect(vi.getTimerCount()).toBe(0);
		await expect(lifetime).resolves.toStrictEqual(Result.make.ok({ kind: "SupervisorStopped", reason: "aborted" }));
		await vi.advanceTimersByTimeAsync(1_000);
		expect(supervisor.state()).toStrictEqual({ kind: "SupervisorStopped", reason: "aborted" });
	});
});

test("abort: is a no-op before the lifetime starts and while already aborting", async () => {
	const controlled = makeControlledTask<"offline">();
	const supervisor = Supervisor.make(controlled.task, {
		restart: CoreRetryPolicy.constant({ attempts: 2, delay: Duration.milliseconds(10) }),
	});
	supervisor.abort();
	expect(supervisor.state()).toStrictEqual({ kind: "SupervisorIdle" });

	const lifetime = supervisor.run();
	supervisor.abort();
	supervisor.abort();
	controlled.settle(Result.make.ok(undefined));
	await expect(lifetime).resolves.toStrictEqual(Result.make.ok({ kind: "SupervisorStopped", reason: "aborted" }));
});

test("run: a caller signal stops the lifetime", async () => {
	const controlled = makeControlledTask<"offline">();
	const supervisor = Supervisor.make(controlled.task, {
		restart: CoreRetryPolicy.constant({ attempts: 2, delay: Duration.milliseconds(10) }),
	});
	const controller = new AbortController();
	const lifetime = supervisor.run({ signal: controller.signal });
	controller.abort();
	expect(controlled.signal()?.aborted).toBe(true);
	controlled.settle(Result.make.err("offline"));
	await expect(lifetime).resolves.toStrictEqual(Result.make.ok({ kind: "SupervisorStopped", reason: "aborted" }));
});

test("run: an already-aborted signal settles without starting the task", async () => {
	const controller = new AbortController();
	controller.abort();
	let calls = 0;
	const supervisor = Supervisor.make(
		Task.from.sync(() => {
			calls++;
			return Result.make.ok(undefined);
		}),
		{ restart: CoreRetryPolicy.constant({ attempts: 1, delay: Duration.milliseconds(10) }) },
	);
	await expect(supervisor.run({ signal: controller.signal })).resolves.toStrictEqual(
		Result.make.ok({ kind: "SupervisorStopped", reason: "aborted" }),
	);
	expect(calls).toBe(0);
});

test("subscribe: reports transitions and stops after unsubscribe", async () => {
	const supervisor = Supervisor.make(Task.from.sync(() => Result.make.ok(undefined)), {
		restart: CoreRetryPolicy.constant({ attempts: 1, delay: Duration.milliseconds(10) }),
	});
	const states: string[] = [];
	const unsubscribe = supervisor.subscribe((state) => states.push(state.kind));
	const lifetime = supervisor.run();
	await lifetime;
	unsubscribe();
	await supervisor.run();

	expect(states).toStrictEqual(["SupervisorRunning", "SupervisorStopped"]);
});
