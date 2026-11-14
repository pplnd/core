import type { WithKind } from "../internal/InternalTypes";
import { toPositiveInteger } from "../internal/Numbers";
import { isBudgetExhausted, normalizeBudgetMs } from "../internal/RetryBudget.ts";
import { clampTimerDelay } from "../internal/timers.ts";
import { Duration } from "../Types/Duration.ts";
import type { RepeatPolicy } from "../Types/RepeatPolicy.ts";
import type { RetryPolicy } from "../Types/RetryPolicy.ts";
import { Deferred } from "./Deferred.ts";
import { Result } from "./Result.ts";
import type { Task } from "./Task.ts";

/**
 * Keeps a fallible task running for the life of a process, restarting it under a retry policy.
 *
 * One `run` of the task is one attempt. A successful attempt ends the lifetime as
 * `Stopped("completed")` — unless a `repeat` policy is configured, in which case the lifetime
 * stays open and the next attempt is scheduled after the policy's delay, with the restart
 * counter reset. A failed attempt is restarted after `restart.getDelay` while the policy's
 * `when` accepts the error and attempts remain; otherwise the lifetime settles with that error
 * and state `Failed`.
 *
 * @example
 * ```ts
 * const outbox = Supervisor.make(processOutbox, {
 *   restart: RetryPolicy.exponential({ attempts: 5, initial: Duration.seconds(1), jitter: true }),
 *   repeat: RepeatPolicy.spacing({ every: Duration.seconds(30), jitter: true }),
 * });
 *
 * const lifetime = outbox.run();
 * process.on("SIGTERM", () => outbox.abort());
 * ```
 */
export type Supervisor<E = never> = {
	/**
	 * Starts the lifetime and settles when it ends.
	 *
	 * A second call while the lifetime is active returns the same deferred. After the lifetime ends,
	 * a call starts a new one. Aborting the caller's signal has the same effect as `abort`.
	 *
	 * @param options - Optional cancellation for the lifetime.
	 * @see {@link Supervisor.abort} to stop the lifetime explicitly.
	 */
	readonly run: (options?: { readonly signal?: AbortSignal; }) => Deferred<Result<E, Supervisor.Stopped>>;

	/**
	 * Stops the lifetime and waits for the running attempt to settle.
	 *
	 * A pending backoff is cancelled immediately; a running attempt receives an aborted signal and
	 * ends the lifetime as `Stopped("aborted")` when it settles. `await lifetime` is the shutdown
	 * wait.
	 *
	 * @see {@link Supervisor.run} to start the lifetime.
	 */
	readonly abort: () => void;

	/**
	 * Returns the current lifecycle state.
	 *
	 * @see {@link Supervisor.subscribe} to react to changes instead of reading them.
	 */
	readonly state: () => Supervisor.State<E>;

	/**
	 * Observes state transitions. Listeners run as the state changes, the final one after the lifetime
	 * settles, and they must not throw.
	 *
	 * @see {@link Supervisor.state} to read the current state without subscribing.
	 *
	 * @param listener - The callback invoked with each new state.
	 */
	readonly subscribe: (listener: (state: Supervisor.State<E>) => void) => () => void;
};

export namespace Supervisor {
	/**
	 * The lifetime has not started.
	 */
	export type Idle = WithKind<"SupervisorIdle">;

	/**
	 * An attempt is running. `restarts` counts the attempts that already failed since the last
	 * success; `completed` counts the successful attempts since the lifetime started.
	 */
	export type Running = WithKind<"SupervisorRunning"> & { readonly restarts: number; readonly completed: number; };

	/**
	 * An attempt failed and the next one is scheduled. `delay` is the time until it starts.
	 */
	export type BackingOff<E> = WithKind<"SupervisorBackingOff"> & {
		readonly attempt: number;
		readonly delay: Duration;
		readonly error: E;
	};

	/**
	 * The lifetime ended without an error, either because the caller aborted or — without a
	 * repeat policy — because the task completed.
	 */
	export type Stopped = WithKind<"SupervisorStopped"> & { readonly reason: "aborted" | "completed"; };

	/**
	 * The lifetime ended with an error that was not restarted. `attempts` counts every run.
	 */
	export type Failed<E> = WithKind<"SupervisorFailed"> & { readonly attempts: number; readonly error: E; };

	export type State<E> = Idle | Running | BackingOff<E> | Stopped | Failed<E>;
}

type Session<E> = {
	readonly deferred: Deferred<Result<E, Supervisor.Stopped>>;
	readonly resolve: (result: Result<E, Supervisor.Stopped>) => void;
	readonly cleanup: () => void;
	controller: AbortController | undefined;
	backoff: ReturnType<typeof setTimeout> | undefined;
	repeat: ReturnType<typeof setTimeout> | undefined;
	aborting: boolean;
	startedAt: number;
};

const makeSupervisor = <E>(
	task: Task.Result<E, void>,
	config: { readonly restart: RetryPolicy<E>; readonly repeat?: RepeatPolicy; },
): Supervisor<E> => {
	const policy = config.restart;
	const repeatPolicy = config.repeat;
	const attempts = toPositiveInteger(policy.attempts) ?? 1;
	const shouldRestart = policy.when;
	const budgetMs = normalizeBudgetMs(policy);

	let state: Supervisor.State<E> = { kind: "SupervisorIdle" };
	let session: Session<E> | undefined;
	let completed = 0;
	const subscribers = new Set<(state: Supervisor.State<E>) => void>();

	const notify = (): void => {
		if (subscribers.size === 0) {
			return;
		}
		const snapshot = state;
		for (const listener of Array.from(subscribers)) {
			// A listener may re-enter and transition the state; the newer state was already
			// delivered to every listener by that re-entrant notify() — skip stale deliveries.
			if (state !== snapshot) {
				return;
			}
			listener(snapshot);
		}
	};

	const clearTimers = (current: Session<E>): void => {
		if (current.backoff !== undefined) {
			clearTimeout(current.backoff);
			current.backoff = undefined;
		}
		if (current.repeat !== undefined) {
			clearTimeout(current.repeat);
			current.repeat = undefined;
		}
	};

	const finish = (current: Session<E>, result: Result<E, Supervisor.Stopped>, next: Supervisor.State<E>): void => {
		session = undefined;
		clearTimers(current);
		current.controller = undefined;
		current.cleanup();
		state = next;
		current.resolve(result);
		notify();
	};

	const stop = (current: Session<E>, reason: "aborted" | "completed"): void => {
		const stopped: Supervisor.Stopped = { kind: "SupervisorStopped", reason };
		finish(current, Result.make.ok(stopped), stopped);
	};

	const fail = (current: Session<E>, error: E, attempt: number): void => {
		const failed: Supervisor.Failed<E> = { kind: "SupervisorFailed", attempts: attempt, error };
		finish(current, Result.make.err(error), failed);
	};

	const startAttempt = (current: Session<E>, attempt: number): void => {
		const controller = new AbortController();
		current.controller = controller;
		state = { kind: "SupervisorRunning", restarts: attempt - 1, completed };
		notify();

		Deferred.to.Promise(task(controller.signal)).then((result) => {
			current.controller = undefined;

			if (current.aborting) {
				stop(current, "aborted");
				return;
			}

			if (Result.is.ok(result)) {
				if (repeatPolicy === undefined) {
					stop(current, "completed");
					return;
				}
				completed++;
				state = { kind: "SupervisorRunning", restarts: 0, completed };
				notify();
				const delay = repeatPolicy.getDelay({
					tick: completed,
					elapsed: Duration.milliseconds(Date.now() - current.startedAt),
				});
				// The repeat timer is armed only after the attempt settled, so attempts can never
				// overlap; clearTimers removes it on abort and on terminal failure.
				current.repeat = setTimeout(() => {
					current.repeat = undefined;
					startAttempt(current, 1);
				}, clampTimerDelay(Duration.to.milliseconds(delay)));
				return;
			}

			const { error } = result;

			if ((shouldRestart !== undefined && !shouldRestart(error)) || attempt >= attempts) {
				fail(current, error, attempt);
				return;
			}

			const delay = policy.getDelay(attempt);
			// The budget bounds the whole restart sequence: once the time spent plus the next
			// backoff would exceed it, the lifetime settles with the last error instead.
			if (isBudgetExhausted(current.startedAt, Duration.to.milliseconds(delay), budgetMs)) {
				fail(current, error, attempt);
				return;
			}
			policy.onRetry?.({ attempt, error, delay });
			// An abort inside onRetry or inside the notification completes the lifetime; a
			// finished session must not publish further states or arm its backoff timer.
			if (current.aborting || session !== current) {
				return;
			}

			state = { kind: "SupervisorBackingOff", attempt, delay, error };
			notify();

			if (current.aborting || session !== current) {
				return;
			}

			// No fire-time guard is needed: finish() and requestAbort() both clear the armed
			// backoff timer, so it can never outlive the session it belongs to.
			current.backoff = setTimeout(() => {
				current.backoff = undefined;
				startAttempt(current, attempt + 1);
			}, clampTimerDelay(Duration.to.milliseconds(delay)));
		});
	};

	const requestAbort = (): void => {
		const current = session;
		if (current === undefined || current.aborting) {
			return;
		}
		current.aborting = true;
		clearTimers(current);
		if (current.controller !== undefined) {
			current.controller.abort();
			return;
		}
		stop(current, "aborted");
	};

	const run = (options?: { readonly signal?: AbortSignal; }): Deferred<Result<E, Supervisor.Stopped>> => {
		const existing = session;
		if (existing !== undefined) {
			return existing.deferred;
		}

		const resolution: { resolve?: (result: Result<E, Supervisor.Stopped>) => void; } = {};
		const deferred = Deferred.from.Promise(
			new Promise<Result<E, Supervisor.Stopped>>((resolve) => {
				resolution.resolve = resolve;
			}),
		);

		const source = options?.signal;
		const onSourceAbort = (): void => {
			requestAbort();
		};

		const created: Session<E> = {
			deferred,
			resolve: (result) => {
				resolution.resolve!(result);
			},
			cleanup: () => {
				source?.removeEventListener("abort", onSourceAbort);
			},
			controller: undefined,
			backoff: undefined,
			repeat: undefined,
			aborting: false,
			startedAt: Date.now(),
		};

		session = created;

		if (source !== undefined) {
			if (source.aborted) {
				requestAbort();
				return deferred;
			}
			source.addEventListener("abort", onSourceAbort, { once: true });
		}

		startAttempt(created, 1);
		return deferred;
	};

	const subscribe = (listener: (state: Supervisor.State<E>) => void): () => void => {
		subscribers.add(listener);
		return () => {
			subscribers.delete(listener);
		};
	};

	return { run, abort: requestAbort, state: () => state, subscribe };
};

export const Supervisor = {
	/**
	 * Creates a supervisor around a long-running task and its restart policy.
	 *
	 * @see {@link Supervisor} for the attempt, restart, and shutdown rules.
	 *
	 * @example
	 * ```ts
	 * const worker = Supervisor.make(processOutbox, {
	 *   restart: RetryPolicy.exponential({
	 *     attempts: 5,
	 *     initial: Duration.seconds(1),
	 *     maxDelay: Duration.seconds(30),
	 *   }),
	 * });
	 * ```
	 */
	make: makeSupervisor,
};
