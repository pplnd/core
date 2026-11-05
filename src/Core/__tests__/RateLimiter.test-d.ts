import { constTruthyBool } from "#test-utils";
import { expectTypeOf, test } from "vitest";
import { Duration } from "../../Types/Duration.ts";
import { Aborted } from "../Aborted.ts";
import type { Deferred } from "../Deferred.ts";
import { RateLimiter } from "../RateLimiter.ts";
import { type Result } from "../Result.ts";
import { Task } from "../Task.ts";

test("run: widens the error channel only when a signal is passed", () => {
	const limiter = RateLimiter.make({ limit: 1, window: Duration.seconds(1) });
	const task: Task.Result<"offline", number> = constTruthyBool()
		? Task.Result.make.ok(1)
		: Task.Result.make.err("offline");

	expectTypeOf(limiter.run(task)).toEqualTypeOf<Deferred<Result<"offline" | RateLimiter.LimitError, number>>>();

	const controller = new AbortController();
	expectTypeOf(limiter.run(task, { signal: controller.signal })).toEqualTypeOf<
		Deferred<Result<"offline" | RateLimiter.LimitError | Aborted, number>>
	>();
});

test("LimitError: carries the retry hint and the two refusal reasons", () => {
	expectTypeOf<RateLimiter.LimitError["retryAfterMs"]>().toEqualTypeOf<number>();
	expectTypeOf<RateLimiter.LimitError["reason"]>().toEqualTypeOf<"exhausted" | "max-wait">();
});

test("available and reset expose their documented shapes", () => {
	const limiter = RateLimiter.make({ limit: 1, window: Duration.seconds(1) });
	expectTypeOf(limiter.available).toEqualTypeOf<() => number>();
	expectTypeOf(limiter.reset).toEqualTypeOf<() => void>();
});

test("make: negative — a limiter requires a limit and a window", () => {
	expectTypeOf(
		// @ts-expect-error a limiter needs a window
		RateLimiter.make({ limit: 1 }),
	).toBeObject();
});
