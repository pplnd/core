import { clampTimerDelay } from "../internal/timers.ts";
import { Duration } from "./Duration.ts";

/**
 * An immutable policy describing how a lifetime repeats after successful attempts.
 *
 * Two cadences exist. `spacing` waits `every` after each attempt settles, so the effective
 * interval is at least `every` and attempts can never overlap. `cadence` aligns attempt starts
 * to multiples of `every` measured from the lifetime's start; a tick missed during a long
 * attempt fires once immediately after it settles instead of catching up in a burst.
 *
 * Engines stay the clock owners: the policy is data, and the engine measures the lifetime's
 * elapsed time and arms the next attempt.
 *
 * @see {@link RetryPolicy} to repeat failed attempts under backoff instead of after successes.
 * @see {@link TimeoutPolicy} to bound one attempt's runtime.
 *
 * @example
 * ```ts
 * const flusher = Supervisor.make(flushMetrics, {
 *   restart: RetryPolicy.exponential({ attempts: 3, initial: Duration.seconds(1) }),
 *   repeat: RepeatPolicy.spacing({ every: Duration.seconds(30), jitter: true }),
 * });
 * ```
 */
export type RepeatPolicy = {
	/**
	 * Delay before the next attempt. `tick` counts the successful attempts already completed
	 * (the first repeat decision is tick 1); `elapsed` is the time since the lifetime started,
	 * so grid-aligning policies can compute the time to the next tick.
	 */
	readonly getDelay: (tick: RepeatPolicy.Tick) => Duration;
};

export namespace RepeatPolicy {
	/**
	 * The scheduling context for the next repeat delay: how many successful attempts already
	 * completed, and how long the lifetime has been running.
	 */
	export type Tick = { readonly tick: number; readonly elapsed: Duration; };
}

export const RepeatPolicy = {
	/**
	 * Repeats `every` after each attempt settles.
	 *
	 * The effective interval is at least `every`, and attempts can never overlap because the
	 * delay starts only once the current attempt has finished. `jitter: true` spreads each delay
	 * uniformly across `[every × 0.5, every)` so a fleet of identical jobs does not tick in
	 * lockstep.
	 *
	 * @example
	 * ```ts
	 * RepeatPolicy.spacing({ every: Duration.minutes(5), jitter: true });
	 * ```
	 */
	spacing: (options: { readonly every: Duration; readonly jitter?: boolean; }): RepeatPolicy => {
		const everyMs = Math.max(0, Duration.to.milliseconds(options.every));
		const jitter = options.jitter ?? false;
		return {
			getDelay: () => {
				const ms = jitter ? everyMs / 2 + Math.random() * (everyMs / 2) : everyMs;
				return Duration.milliseconds(clampTimerDelay(ms));
			},
		};
	},

	/**
	 * Aligns attempt starts to multiples of `every` measured from the lifetime's start.
	 *
	 * A tick missed during a long attempt fires once immediately after the attempt settles —
	 * aligned, without catch-up bursts. `jitter: true` offsets the grid by a fixed random phase
	 * within one period for this policy instance, desyncing fleets while preserving alignment.
	 *
	 * @example
	 * ```ts
	 * RepeatPolicy.cadence({ every: Duration.minutes(5) });
	 * ```
	 */
	cadence: (options: { readonly every: Duration; readonly jitter?: boolean; }): RepeatPolicy => {
		const everyMs = Math.max(0, Duration.to.milliseconds(options.every));
		const anchorOffsetMs = (options.jitter ?? false) ? Math.random() * everyMs : 0;
		return {
			getDelay: ({ elapsed }) => {
				const elapsedMs = Duration.to.milliseconds(elapsed);
				const phase = ((elapsedMs - anchorOffsetMs) % everyMs + everyMs) % everyMs;
				return Duration.milliseconds(clampTimerDelay(phase === 0 ? 0 : everyMs - phase));
			},
		};
	},
};
