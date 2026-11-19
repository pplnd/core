import type { Predicate } from "../Core/Predicate.ts";
import { toPositiveInteger } from "../internal/Numbers.ts";
import { clampTimerDelay, MAX_TIMER_MS } from "../internal/timers.ts";
import { Duration } from "./Duration.ts";

/**
 * An immutable policy describing retry limits, backoff delay strategies,
 * transient failure filters, and observational telemetry.
 *
 * @see {@link TimeoutPolicy} to bound one attempt's runtime instead of the sequence.
 * @see {@link RepeatPolicy} to repeat a lifetime past success instead of retrying failures.
 *
 * @example
 * ```ts
 * const policy: RetryPolicy<Error> = RetryPolicy.exponential({
 *   attempts: 3,
 *   initial: Duration.milliseconds(100),
 *   when: (err) => err.name === "NetworkError",
 *   onRetry: (metadata) => console.warn(`Retrying attempt ${metadata.attempt}: ${metadata.error.message}`),
 * });
 * ```
 */
export type RetryPolicy<E = unknown> = {
	/**
	 * Total number of attempts, including the first. A positive integer; `1` means no retry.
	 * Any other value is treated as one attempt.
	 */
	readonly attempts: number;
	readonly getDelay: (attempt: number) => Duration;
	/**
	 * Total wall-clock budget for the whole retry sequence, including backoff delays. Engines
	 * stop retrying — settling with the last error — when the time already spent plus the next
	 * delay would exceed it. The first attempt always runs, and `attempts` remains the hard
	 * ceiling; bounding one attempt's runtime is the job of `timeout`, not the budget. A
	 * negative value clamps to zero.
	 */
	readonly budget?: Duration;
	/**
	 * Whether an error qualifies for retry. Build reusable tests with the `Predicate` combinators.
	 */
	readonly when?: Predicate<E>;
	readonly onRetry?: (metadata: RetryPolicy.Metadata<E>) => void;
};

export namespace RetryPolicy {
	/**
	 * Observational telemetry metadata provided to `onRetry` callbacks immediately before each retry delay.
	 *
	 * Provides context on the current attempt count, the error that triggered the retry,
	 * and the calculated backoff delay before the next attempt executes.
	 *
	 * @see {@link RetryPolicy} for configuring retry attempts and backoff strategies.
	 *
	 * @example
	 * ```ts
	 * const onRetry = (metadata: RetryPolicy.Metadata<Error>) => {
	 *   console.warn(
	 *     `Attempt ${metadata.attempt} failed: ${metadata.error.message}. Retrying in ${Duration.to.milliseconds(metadata.delay)}ms.`
	 *   );
	 * };
	 * ```
	 */
	export type Metadata<E = unknown> = { readonly attempt: number; readonly error: E; readonly delay: Duration; };
}

export const RetryPolicy = {
	/**
	 * Creates a RetryPolicy with a constant delay between retry attempts.
	 *
	 * @example
	 * ```ts
	 * const policy = RetryPolicy.constant({
	 *   attempts: 3,
	 *   delay: Duration.seconds(1),
	 * });
	 * ```
	 */
	constant: <E = unknown>(options: {
		/**
		 * Total number of attempts, including the first. A positive integer.
		 */
		readonly attempts: number;
		readonly delay: Duration;
		readonly budget?: Duration;
		readonly when?: Predicate<E>;
		readonly onRetry?: (metadata: RetryPolicy.Metadata<E>) => void;
	}): RetryPolicy<E> => ({
		attempts: toPositiveInteger(options.attempts) ?? 1,
		getDelay: () => options.delay,
		...(options.budget !== undefined ? { budget: options.budget } : {}),
		...(options.when !== undefined ? { when: options.when } : {}),
		...(options.onRetry !== undefined ? { onRetry: options.onRetry } : {}),
	}),

	/**
	 * Creates a RetryPolicy with exponential backoff delays between attempts.
	 * An optional `factor` (default 2) controls the growth rate.
	 * An optional `jitter` (default false) adds randomized variance to prevent thundering herd problems.
	 * An optional `maxDelay` caps the maximum duration between retry attempts.
	 * An optional `budget` caps the total wall-clock time for the whole retry sequence, including
	 * backoff delays; retrying stops — settling with the last error — once it would be exceeded.
	 * An optional `when` predicate filters which errors qualify for retry.
	 * An optional `onRetry` callback executes telemetry side-effects before each retry delay.
	 *
	 * @example
	 * ```ts
	 * const policy = RetryPolicy.exponential({
	 *   attempts: 5,
	 *   initial: Duration.milliseconds(100),
	 *   factor: 2,
	 *   jitter: true,
	 *   maxDelay: Duration.seconds(5),
	 *   when: (err: Error) => err.name === "NetworkError",
	 *   onRetry: (metadata) => console.warn(`Retry attempt ${metadata.attempt}`),
	 * });
	 * ```
	 */
	exponential: <E = unknown>(options: {
		/**
		 * Total number of attempts, including the first. A positive integer.
		 */
		readonly attempts: number;
		readonly initial: Duration;
		readonly factor?: number;
		readonly jitter?: boolean;
		readonly maxDelay?: Duration;
		readonly budget?: Duration;
		readonly when?: Predicate<E>;
		readonly onRetry?: (metadata: RetryPolicy.Metadata<E>) => void;
	}): RetryPolicy<E> => {
		const attempts = toPositiveInteger(options.attempts) ?? 1;
		const initialMs = Math.max(0, Duration.to.milliseconds(options.initial));
		const rawFactor = options.factor ?? 2;
		const factor = Number.isFinite(rawFactor) ? Math.max(0, rawFactor) : 2;
		const jitter = options.jitter ?? false;
		const maxMs = options.maxDelay !== undefined ? Math.max(0, Duration.to.milliseconds(options.maxDelay)) : undefined;

		return {
			attempts,
			getDelay: (attempt: number) => {
				const safeAttempt = Number.isFinite(attempt) ? Math.max(0, attempt) : 1;
				const rawMs = initialMs * (factor ** Math.max(0, safeAttempt - 1));
				const finiteRaw = Number.isFinite(rawMs) ? rawMs : maxMs ?? MAX_TIMER_MS;
				const cappedMs = maxMs !== undefined ? Math.min(finiteRaw, maxMs) : finiteRaw;
				const finalMs = jitter ? Math.random() * cappedMs : cappedMs;
				return Duration.milliseconds(clampTimerDelay(finalMs));
			},
			...(options.budget !== undefined ? { budget: options.budget } : {}),
			...(options.when !== undefined ? { when: options.when } : {}),
			...(options.onRetry !== undefined ? { onRetry: options.onRetry } : {}),
		};
	},
};
