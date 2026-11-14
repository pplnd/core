import type { WithKind } from "../internal/InternalTypes";
import { Duration } from "../Types/Duration.ts";
import { Deferred } from "./Deferred.ts";
import type { Predicate } from "./Predicate.ts";
import { Result } from "./Result.ts";
import type { Task } from "./Task.ts";

/**
 * Runs fallible tasks and temporarily blocks calls after enough qualifying failures.
 *
 * Blocked calls return `CircuitBreaker.OpenError` without starting their task, giving the
 * dependency time to recover.
 *
 * ### Operating States
 * - **Closed**: Normal execution. Every success resets failure counts (or prunes the sliding window).
 *   If failures reach `failureThreshold`, transitions to **Open**.
 * - **Open**: Downstream service is failing. Calls immediately fast-fail in 0ms with
 *   `CircuitBreaker.OpenError`. Once `resetTimeout` elapses, transitions on-demand to **HalfOpen**.
 * - **HalfOpen**: Trial recovery mode. Allows limited single-probe calls through while fast-failing
 *   concurrent callers. If `successThreshold` consecutive probes succeed, resets to **Closed**. If any
 *   probe fails with a tripping error, immediately transitions back to **Open**.
 *
 * @example
 * ```ts
 * const paymentBreaker = CircuitBreaker.make<PaymentGatewayError>({
 *   failureThreshold: 5,
 *   resetTimeout: Duration.seconds(30),
 *   successThreshold: 2,
 *   shouldTrip: (err) => err.status >= 500 || err.kind === "NetworkTimeout",
 * });
 *
 * const chargeCard = (payload: ChargeInput, signal?: AbortSignal) =>
 *   paymentBreaker.run(callPaymentGateway(payload), { signal });
 * ```
 */
export type CircuitBreaker<E = unknown> = {
	/**
	 * Returns the current observable lifecycle state of the circuit breaker.
	 *
	 * When the circuit is `Open` and `resetTimeout` has elapsed, this evaluates to `HalfOpen`
	 * with `probeInFlight: false`, signaling that the circuit is ready to test downstream recovery.
	 */
	readonly state: () => CircuitBreaker.State<E>;

	/**
	 * Starts a fallible task under the circuit breaker's fault-isolation policies.
	 *
	 * - While `Closed`: executes the task normally, tracking failures.
	 * - While `Open`: fast-fails immediately in 0ms with `CircuitBreaker.OpenError<E>`.
	 * - While `HalfOpen`: allows a single probe call while fast-failing concurrent requests.
	 *
	 * @see {@link CircuitBreaker.reset} to manually force circuit recovery back to Closed state.
	 *
	 * @param task - The fallible async computation to run.
	 * @param options - Optional cancellation signal for this call.
	 */
	readonly run: <EIn extends E = E, A = unknown>(
		task: Task.Result<EIn, A>,
		options?: { readonly signal?: AbortSignal; },
	) => Deferred<Result<EIn | CircuitBreaker.OpenError<E>, A>>;

	/**
	 * Resets the breaker to `Closed` and clears recorded failures.
	 * In-flight probes continue and return their results, but cannot change the reset breaker's state.
	 *
	 * @see {@link CircuitBreaker.run} for running fallible tasks under circuit breaker policies.
	 */
	readonly reset: () => void;

	/**
	 * Subscribes a listener callback to state transitions.
	 *
	 * Returns an unsubscribe function. Listeners must not throw.
	 *
	 * @param listener - The callback invoked upon each state transition.
	 */
	readonly subscribe: (listener: (state: CircuitBreaker.State<E>) => void) => () => void;
};

export namespace CircuitBreaker {
	/**
	 * An error returned when a protected task is fast-failed because the circuit breaker is open or probing.
	 */
	export type OpenError<E = unknown> = WithKind<"CircuitOpenError"> & {
		/**
		 * The error from the failed task that caused the circuit to trip open.
		 */
		readonly lastError: E;

		/**
		 * How long until the next trial probe is permitted, as a `Duration`. Evaluates to a zero
		 * duration during `HalfOpen` probe execution.
		 */
		readonly retryAfter: Duration;
	};

	/**
	 * Normal operating state: calls are passed through to the downstream service.
	 */
	export type ClosedState = WithKind<"Closed"> & {
		/**
		 * The number of recorded failures currently counted towards `failureThreshold`.
		 */
		readonly failures: number;
	};

	/**
	 * Tripped operating state: downstream calls are blocked and fast-failed in 0ms.
	 */
	export type OpenState<E = unknown> = WithKind<"Open"> & {
		/**
		 * Epoch timestamp (milliseconds) when the circuit tripped to Open.
		 */
		readonly openedAt: number;

		/**
		 * How long until the circuit permits trial probes, as a `Duration`.
		 */
		readonly retryAfter: Duration;

		/**
		 * The error that caused the circuit to trip open.
		 */
		readonly lastError: E;
	};

	/**
	 * Trial recovery state: allows single-probe trial requests to evaluate downstream recovery.
	 */
	export type HalfOpenState = WithKind<"HalfOpen"> & {
		/**
		 * Whether a trial probe is currently executing against the downstream service.
		 */
		readonly probeInFlight: boolean;

		/**
		 * Number of consecutive successful probes completed during the current recovery phase.
		 */
		readonly consecutiveSuccesses: number;
	};

	/**
	 * Discriminated union of all possible circuit breaker lifecycle states.
	 */
	export type State<E = unknown> = ClosedState | OpenState<E> | HalfOpenState;

	/**
	 * Configuration options for initializing a CircuitBreaker.
	 */
	export type Options<E = unknown> = {
		/**
		 * The number of failures that must occur before the circuit trips to `Open`.
		 * Must be an integer greater than or equal to 1.
		 */
		readonly failureThreshold: number;

		/**
		 * How long the circuit remains `Open` before allowing trial probes in `HalfOpen`.
		 *
		 * Deliberately not named `cooldown` (the `Op` exclusive strategy's word): this gates
		 * recovery time after a trip, not minimum spacing between runs.
		 */
		readonly resetTimeout: Duration;

		/**
		 * The number of consecutive successful probes required in `HalfOpen` to reset the circuit to `Closed`.
		 * Defaults to `1`.
		 */
		readonly successThreshold?: number;

		/**
		 * Optional sliding time window for tracking failures.
		 * If specified, only failures within the last `failureWindow` are counted towards `failureThreshold`.
		 * If omitted, consecutive failures are counted, and any success resets the count to `0`.
		 */
		readonly failureWindow?: Duration;

		/**
		 * Optional predicate to determine if a given error should count towards tripping the circuit.
		 * Defaults to all errors (`() => true`). Non-tripping errors (e.g. 404 Not Found) pass through
		 * without incrementing failure counts or tripping the circuit.
		 *
		 * @see {@link Predicate} to build reusable error tests from combinators.
		 */
		readonly shouldTrip?: Predicate<E>;
	};
}

const isCircuitOpenError = <E = unknown>(value: unknown): value is CircuitBreaker.OpenError<E> =>
	typeof value === "object" && value !== null && (value as { kind?: unknown; }).kind === "CircuitOpenError";

const isClosedState = (state: CircuitBreaker.State<unknown>): state is CircuitBreaker.ClosedState =>
	state.kind === "Closed";

const isOpenState = <E = unknown>(state: CircuitBreaker.State<E>): state is CircuitBreaker.OpenState<E> =>
	state.kind === "Open";

const isHalfOpenState = (state: CircuitBreaker.State<unknown>): state is CircuitBreaker.HalfOpenState =>
	state.kind === "HalfOpen";

const makeCircuitBreaker = <E = unknown>(options: CircuitBreaker.Options<E>): CircuitBreaker<E> => {
	const failureThreshold = Number.isFinite(options.failureThreshold)
		? Math.max(1, Math.floor(options.failureThreshold))
		: 1;
	const rawResetMs = Duration.to.milliseconds(options.resetTimeout);
	const resetTimeoutMs = Number.isNaN(rawResetMs)
		? 0
		: Number.isFinite(rawResetMs)
		? Math.max(0, Math.floor(rawResetMs))
		: Number.POSITIVE_INFINITY;
	const successThreshold = options.successThreshold !== undefined && Number.isFinite(options.successThreshold)
		? Math.max(1, Math.floor(options.successThreshold))
		: 1;
	const rawWindowMs = options.failureWindow !== undefined ? Duration.to.milliseconds(options.failureWindow) : undefined;
	const windowMs = rawWindowMs !== undefined && Number.isFinite(rawWindowMs)
		? Math.max(0, Math.floor(rawWindowMs))
		: undefined;
	const shouldTrip = options.shouldTrip ?? (() => true);

	type InternalKind = "Closed" | "Open" | "HalfOpen";

	let currentKind: InternalKind = "Closed";
	let epoch = 0;
	let consecutiveFailures = 0;
	let failureTimestamps: number[] = [];
	let openedAt = 0;
	let lastError: E | undefined = undefined;
	let activeProbe: object | undefined;
	let consecutiveSuccesses = 0;

	const subscribers = new Set<(state: CircuitBreaker.State<E>) => void>();

	const pruneWindowFailures = (now: number, winMs: number): void => {
		const cutoff = now - winMs;
		let validIdx = 0;
		const len = failureTimestamps.length;
		while (validIdx < len) {
			const ts = failureTimestamps[validIdx];
			if (ts !== undefined && ts < cutoff) {
				validIdx++;
			} else {
				break;
			}
		}
		if (validIdx > 0) {
			failureTimestamps.splice(0, validIdx);
		}
	};

	const getState = (): CircuitBreaker.State<E> => {
		const now = Date.now();

		if (currentKind === "Closed") {
			if (windowMs !== undefined) {
				pruneWindowFailures(now, windowMs);
				return { kind: "Closed", failures: failureTimestamps.length };
			}
			return { kind: "Closed", failures: consecutiveFailures };
		}

		if (currentKind === "Open") {
			const elapsed = now - openedAt;
			if (elapsed >= resetTimeoutMs) {
				return { kind: "HalfOpen", probeInFlight: false, consecutiveSuccesses: 0 };
			}
			return {
				kind: "Open",
				openedAt,
				retryAfter: Duration.milliseconds(Math.max(0, resetTimeoutMs - elapsed)),
				lastError: lastError as E,
			};
		}

		return { kind: "HalfOpen", probeInFlight: activeProbe !== undefined, consecutiveSuccesses };
	};

	const notifySubscribers = (): void => {
		if (subscribers.size === 0) { return; }
		const snapshot = getState();
		for (const listener of Array.from(subscribers)) {
			listener(snapshot);
		}
	};

	const recordClosedFailure = (err: E): boolean => {
		const now = Date.now();
		if (windowMs !== undefined) {
			failureTimestamps.push(now);
			pruneWindowFailures(now, windowMs);
			if (failureTimestamps.length >= failureThreshold) {
				currentKind = "Open";
				epoch++;
				openedAt = now;
				lastError = err;
				consecutiveFailures = 0;
				failureTimestamps = [];
				return true;
			}
			return false;
		}
		consecutiveFailures++;
		if (consecutiveFailures >= failureThreshold) {
			currentKind = "Open";
			epoch++;
			openedAt = now;
			lastError = err;
			consecutiveFailures = 0;
			return true;
		}
		return false;
	};

	const executeClosed = <EIn extends E, A>(
		task: Task.Result<EIn, A>,
		signal?: AbortSignal,
	): Deferred<Result<EIn | CircuitBreaker.OpenError<E>, A>> =>
		Deferred.from.Promise(
			new Promise<Result<EIn | CircuitBreaker.OpenError<E>, A>>((resolve) => {
				const startEpoch = epoch;
				const deferred = task(signal);

				deferred.then((result) => {
					if (signal?.aborted) {
						resolve(result);
						return;
					}

					if (epoch !== startEpoch || currentKind !== "Closed") {
						resolve(result);
						return;
					}

					if (Result.is.ok(result)) {
						consecutiveFailures = 0;
						resolve(result);
						return;
					}

					const err = result.error;
					const trips = shouldTrip(err as E);
					const tripped = trips && recordClosedFailure(err as E);

					resolve(result);
					if (tripped) { notifySubscribers(); }
				});
			}),
		);

	const executeProbe = <EIn extends E, A>(
		task: Task.Result<EIn, A>,
		probe: object,
		signal?: AbortSignal,
	): Deferred<Result<EIn | CircuitBreaker.OpenError<E>, A>> =>
		Deferred.from.Promise(
			new Promise<Result<EIn | CircuitBreaker.OpenError<E>, A>>((resolve) => {
				const deferred = task(signal);

				const onAbort = () => {
					if (activeProbe === probe) {
						activeProbe = undefined;
						notifySubscribers();
					}
				};

				if (signal) {
					if (signal.aborted) {
						onAbort();
					} else {
						signal.addEventListener("abort", onAbort, { once: true });
					}
				}

				deferred.then((result) => {
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					if (activeProbe !== probe) {
						resolve(result);
						return;
					}

					activeProbe = undefined;

					if (Result.is.ok(result)) {
						consecutiveSuccesses++;
						if (consecutiveSuccesses >= successThreshold) {
							currentKind = "Closed";
							epoch++;
							consecutiveFailures = 0;
							failureTimestamps = [];
							lastError = undefined;
							consecutiveSuccesses = 0;
						}
						resolve(result);
						notifySubscribers();
						return;
					}

					const err = result.error;
					const trips = shouldTrip(err as E);

					if (trips) {
						currentKind = "Open";
						epoch++;
						openedAt = Date.now();
						lastError = err as E;
						consecutiveSuccesses = 0;
					} else {
						consecutiveSuccesses++;
						if (consecutiveSuccesses >= successThreshold) {
							currentKind = "Closed";
							epoch++;
							consecutiveFailures = 0;
							failureTimestamps = [];
							lastError = undefined;
							consecutiveSuccesses = 0;
						}
					}

					resolve(result);
					notifySubscribers();
				});
			}),
		);

	const run = <EIn extends E = E, A = unknown>(
		task: Task.Result<EIn, A>,
		callerOptions?: { readonly signal?: AbortSignal; },
	): Deferred<Result<EIn | CircuitBreaker.OpenError<E>, A>> => {
		const signal = callerOptions?.signal;
		const now = Date.now();

		if (currentKind === "Closed") {
			return executeClosed(task, signal);
		}

		if (currentKind === "Open") {
			const elapsed = now - openedAt;
			if (elapsed < resetTimeoutMs) {
				const retryAfter = Duration.milliseconds(Math.max(0, resetTimeoutMs - elapsed));
				const openErr: CircuitBreaker.OpenError<E> = { kind: "CircuitOpenError", lastError: lastError as E, retryAfter };
				return Deferred.from.Promise(Promise.resolve(Result.make.err(openErr)));
			}

			if (signal?.aborted) {
				return executeClosed(task, signal);
			}

			currentKind = "HalfOpen";
			epoch++;
			consecutiveSuccesses = 0;
		}

		// currentKind === "HalfOpen"
		if (activeProbe !== undefined) {
			const openErr: CircuitBreaker.OpenError<E> = {
				kind: "CircuitOpenError",
				lastError: lastError as E,
				retryAfter: Duration.milliseconds(0),
			};
			return Deferred.from.Promise(Promise.resolve(Result.make.err(openErr)));
		}

		if (signal?.aborted) {
			return executeClosed(task, signal);
		}

		const probe = {};
		activeProbe = probe;
		notifySubscribers();
		return executeProbe(task, probe, signal);
	};

	const reset = (): void => {
		const wasClosed = currentKind === "Closed" && consecutiveFailures === 0 && failureTimestamps.length === 0;
		currentKind = "Closed";
		epoch++;
		consecutiveFailures = 0;
		failureTimestamps = [];
		openedAt = 0;
		lastError = undefined;
		activeProbe = undefined;
		consecutiveSuccesses = 0;
		if (!wasClosed) {
			notifySubscribers();
		}
	};

	const subscribe = (listener: (state: CircuitBreaker.State<E>) => void): () => void => {
		subscribers.add(listener);
		return () => {
			subscribers.delete(listener);
		};
	};

	return { state: getState, run, reset, subscribe };
};

export const CircuitBreaker = {
	/**
	 * Creates a stateful CircuitBreaker with the provided configuration options.
	 *
	 * @example
	 * ```ts
	 * const breaker = CircuitBreaker.make<NetworkError>({
	 *   failureThreshold: 5,
	 *   resetTimeout: Duration.seconds(30),
	 *   successThreshold: 2,
	 *   shouldTrip: (err) => err.isTimeout || err.status >= 500,
	 * });
	 * ```
	 */
	make: makeCircuitBreaker,

	/**
	 * Type guards for checking circuit breaker states and errors.
	 */
	is: {
		/**
		 * Checks whether a value is a CircuitOpenError.
		 *
		 * @example
		 * ```ts
		 * if (CircuitBreaker.is.openError(error)) {
		 *   console.warn(`Circuit is open. Retry after ${Duration.to.milliseconds(error.retryAfter)}ms`);
		 * }
		 * ```
		 */
		openError: isCircuitOpenError,

		/**
		 * Checks whether a circuit breaker state is Closed.
		 *
		 * @see {@link CircuitBreaker.is.open} for checking if the circuit is tripped Open.
		 * @see {@link CircuitBreaker.is.halfOpen} for checking if the circuit is in trial recovery HalfOpen.
		 *
		 * @example
		 * ```ts
		 * const state = breaker.state();
		 * if (CircuitBreaker.is.closed(state)) {
		 *   console.log("Downstream dependency is healthy");
		 * }
		 * ```
		 */
		closed: isClosedState,

		/**
		 * Checks whether a circuit breaker state is Open.
		 *
		 * @see {@link CircuitBreaker.is.closed} for checking if the circuit is healthy Closed.
		 * @see {@link CircuitBreaker.is.halfOpen} for checking if the circuit is in trial recovery HalfOpen.
		 *
		 * @example
		 * ```ts
		 * const state = breaker.state();
		 * if (CircuitBreaker.is.open(state)) {
		 *   console.log(`Downstream cooling down. Last error:`, state.lastError);
		 * }
		 * ```
		 */
		open: isOpenState,

		/**
		 * Checks whether a circuit breaker state is HalfOpen.
		 *
		 * @see {@link CircuitBreaker.is.closed} for checking if the circuit is healthy Closed.
		 * @see {@link CircuitBreaker.is.open} for checking if the circuit is tripped Open.
		 *
		 * @example
		 * ```ts
		 * const state = breaker.state();
		 * if (CircuitBreaker.is.halfOpen(state)) {
		 *   console.log("Testing downstream recovery with trial probes");
		 * }
		 * ```
		 */
		halfOpen: isHalfOpenState,
	},
};
