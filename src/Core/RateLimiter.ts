import type { WithKind } from "../internal/InternalTypes";
import { toPositiveInteger } from "../internal/Numbers";
import { clampTimerDelay } from "../internal/timers.ts";
import { Duration } from "../Types/Duration.ts";
import { Aborted } from "./Aborted.ts";
import { Deferred } from "./Deferred.ts";
import { Result } from "./Result.ts";
import type { Task } from "./Task.ts";

/**
 * Paces fallible work against a sliding-window quota.
 *
 * A call is admitted while fewer than `limit` calls have started in the last `window`. Beyond that,
 * the default `"wait"` strategy queues the call and starts it when the oldest admitted call expires;
 * `"reject"` settles immediately with `RateLimiter.LimitError` carrying `retryAfter`.
 *
 * @example
 * ```ts
 * const github = RateLimiter.make({ limit: 60, window: Duration.minutes(1) });
 *
 * const repo = await github.run(loadRepo("vercel/next.js"));
 * ```
 */
export type RateLimiter = {
	/**
	 * Starts a fallible task when the quota allows it.
	 *
	 * The task is lazy, so it does not start before a permit exists. With the `"wait"` strategy the
	 * returned deferred settles once the task does; with `"reject"` it settles immediately with
	 * `RateLimiter.LimitError`.
	 *
	 * @param task - The fallible work to run under the quota.
	 * @param options - Optional cancellation. Aborting a queued call removes it without using a permit.
	 * @see {@link RateLimiter.available} to read the remaining permits.
	 */
	readonly run: {
		<E, A>(task: Task.Result<E, A>): Deferred<Result<E | RateLimiter.LimitError, A>>;
		<E, A>(
			task: Task.Result<E, A>,
			options: { readonly signal: AbortSignal; },
		): Deferred<Result<E | RateLimiter.LimitError | Aborted, A>>;
	};

	/**
	 * Returns how many calls may start right now, between `0` and `limit`.
	 */
	readonly available: () => number;

	/**
	 * Forgets the recorded window and admits every queued caller in submission order.
	 *
	 * Intended for tests and operational overrides: it deliberately allows more than `limit` calls
	 * to have started inside one window.
	 *
	 * @see {@link RateLimiter.available} to inspect the window instead of clearing it.
	 */
	readonly reset: () => void;
};

export namespace RateLimiter {
	/**
	 * A call settled without running because the quota had no permit for it.
	 */
	export type LimitError = WithKind<"RateLimitExceeded"> & {
		/**
		 * How long until the oldest admitted call expires, rounded up to whole milliseconds.
		 */
		readonly retryAfter: Duration;

		/**
		 * `"exhausted"` when the `"reject"` strategy refused the call, `"max-wait"` when the wait
		 * would exceed `maxWait`.
		 */
		readonly reason: "exhausted" | "max-wait";
	};

	/**
	 * Configuration options for `RateLimiter.make`.
	 */
	export type Options = {
		/**
		 * Maximum number of calls that may start inside one window. A positive integer; `1` allows
		 * one call per window.
		 */
		readonly limit: number;

		/**
		 * Length of the sliding window. Every admitted call occupies a permit for this long. A
		 * non-finite or non-positive window disables pacing: every permit expires immediately.
		 */
		readonly window: Duration;

		/**
		 * What to do when no permit is free. Defaults to `"wait"`; `"reject"` settles immediately.
		 *
		 * Governs admission before a call starts, not work already inside the engine.
		 */
		readonly strategy?: "wait" | "reject";

		/**
		 * Longest wait the `"wait"` strategy accepts. A call whose estimated wait exceeds it settles
		 * with reason `"max-wait"` instead of joining the queue. Omit it to wait without a bound.
		 */
		readonly maxWait?: Duration;
	};
}

const normalizeMs = (duration: Duration): number => {
	const milliseconds = Duration.to.milliseconds(duration);
	return Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds)) : 0;
};

const makeRateLimiter = (options: RateLimiter.Options): RateLimiter => {
	const limit = toPositiveInteger(options.limit) ?? 1;
	const windowMs = normalizeMs(options.window);
	const strategy = options.strategy === "reject" ? "reject" : "wait";
	const maxWaitMs = options.maxWait === undefined ? undefined : normalizeMs(options.maxWait);

	const admitted: number[] = [];
	const queue = new Map<object, () => void>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	const clearTimer = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	};

	const prune = (now: number): void => {
		const cutoff = now - windowMs;
		let expired = 0;
		while (expired < admitted.length && admitted[expired] <= cutoff) {
			expired++;
		}
		if (expired > 0) {
			admitted.splice(0, expired);
		}
	};

	const admitWaiting = (): void => {
		const now = Date.now();
		prune(now);
		for (const [token, admit] of queue) {
			if (admitted.length >= limit) {
				break;
			}
			queue.delete(token);
			admitted.push(now);
			admit();
		}
	};

	const armTimer = (): void => {
		clearTimer();
		if (queue.size === 0) {
			return;
		}
		const waitMs = Math.max(0, admitted[0] + windowMs - Date.now());
		timer = setTimeout(() => {
			timer = undefined;
			admitWaiting();
			armTimer();
		}, clampTimerDelay(waitMs));
	};

	const available = (): number => {
		prune(Date.now());
		return Math.max(0, limit - admitted.length);
	};

	const reset = (): void => {
		clearTimer();
		const now = Date.now();
		admitted.length = 0;
		const waiting = Array.from(queue.values());
		queue.clear();
		for (const admit of waiting) {
			admitted.push(now);
			admit();
		}
	};

	const run = <E, A>(
		task: Task.Result<E, A>,
		callerOptions?: { readonly signal?: AbortSignal; },
	): Deferred<Result<E | RateLimiter.LimitError | Aborted, A>> => {
		const signal = callerOptions?.signal;

		if (signal?.aborted) {
			return Deferred.from.Promise(
				Promise.resolve(Result.make.err(Aborted.make(signal.reason))) as Promise<
					Result<E | RateLimiter.LimitError | Aborted, A>
				>,
			);
		}

		const now = Date.now();
		prune(now);

		if (admitted.length < limit) {
			admitted.push(now);
			return task(signal);
		}

		const waitMs = Math.max(0, admitted[0] + windowMs - now);

		if (strategy === "reject" || (maxWaitMs !== undefined && waitMs > maxWaitMs)) {
			const error: RateLimiter.LimitError = {
				kind: "RateLimitExceeded",
				retryAfter: Duration.milliseconds(waitMs),
				reason: strategy === "reject" ? "exhausted" : "max-wait",
			};
			return Deferred.from.Promise(
				Promise.resolve(Result.make.err(error)) as Promise<Result<E | RateLimiter.LimitError | Aborted, A>>,
			);
		}

		return Deferred.from.Promise(
			new Promise<Result<E | RateLimiter.LimitError | Aborted, A>>((settle) => {
				const token = {};

				const onAbort = (): void => {
					queue.delete(token);
					if (queue.size === 0) {
						clearTimer();
					}
					settle(Result.make.err(Aborted.make(signal?.reason)));
				};

				const admit = (): void => {
					signal?.removeEventListener("abort", onAbort);
					Deferred.to.Promise(task(signal)).then(settle);
				};

				signal?.addEventListener("abort", onAbort, { once: true });
				queue.set(token, admit);
				armTimer();
			}),
		);
	};

	return { run: run as RateLimiter["run"], available, reset };
};

export const RateLimiter = {
	/**
	 * Creates a rate limiter with the provided quota and queueing policy.
	 *
	 * @see {@link RateLimiter} for the sliding window and the two overflow strategies.
	 *
	 * @example
	 * ```ts
	 * const github = RateLimiter.make({
	 *   limit: 60,
	 *   window: Duration.minutes(1),
	 *   strategy: "wait",
	 *   maxWait: Duration.seconds(15),
	 * });
	 * ```
	 */
	make: makeRateLimiter,
};
