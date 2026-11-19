import { Duration } from "./Duration.ts";

/**
 * A deadline for one attempt: how long the engine may run it, and what error to settle with
 * when the deadline elapses.
 *
 * The policy bounds one attempt's runtime — retrying across attempts is the job of
 * `RetryPolicy` (attempt count and backoff, with `budget` bounding the whole sequence). The
 * engine stays the clock owner: the policy is data, the engine arms the timer.
 *
 * @see {@link RepeatPolicy} to repeat a lifetime past success instead of bounding one attempt.
 *
 * @example
 * ```ts
 * const fetchWithTimeout = pipe(
 *   fetchUser,
 *   Task.Result.timeout(TimeoutPolicy.after({ duration: Duration.seconds(5), onTimeout: () => "Request timed out" })),
 * );
 * ```
 */
export type TimeoutPolicy<E = unknown> = {
	/** Total runtime before the engine settles the attempt with `onTimeout()`. */
	readonly duration: Duration;
	/** Produces the error the engine settles with when the duration elapses. */
	readonly onTimeout: () => E;
};

export const TimeoutPolicy = {
	/**
	 * Times one attempt out after `duration`, settling with the error `onTimeout` produces.
	 *
	 * `after` is the only real mode today. An absolute-deadline `at` is the plausible second
	 * mode, justified when a workflow demands it.
	 *
	 * @see {@link RetryPolicy.budget} to bound a whole retry sequence in wall-clock time instead
	 *     of one attempt.
	 *
	 * @example
	 * ```ts
	 * TimeoutPolicy.after({ duration: Duration.seconds(5), onTimeout: () => "Request timed out" });
	 * ```
	 */
	after: <const E>(options: { readonly duration: Duration; readonly onTimeout: () => E; }): TimeoutPolicy<E> => ({
		duration: options.duration,
		onTimeout: options.onTimeout,
	}),
};
