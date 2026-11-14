/**
 * Internal helpers for `Op` — execution utilities and concurrency strategy factories.
 * Not part of the public API.
 */

import { Deferred } from "../Core/Deferred.ts";
import type { Op } from "../Core/Op.ts";
import { Result } from "../Core/Result.ts";
import { Duration } from "../Types/Duration.ts";
import type { RetryPolicy } from "../Types/RetryPolicy.ts";
import type { TimeoutPolicy } from "../Types/TimeoutPolicy.ts";
import { toPositiveInteger } from "./Numbers.ts";
import { isBudgetExhausted, normalizeBudgetMs } from "./RetryBudget.ts";
import { clampTimerDelay, MAX_TIMER_MS } from "./timers.ts";
import { waitForDelay } from "./waitForDelay.ts";

// ---------------------------------------------------------------------------
// Internal singletons & helpers
// ---------------------------------------------------------------------------

const _abortedNil: Op.Nil = { kind: "OpNil", reason: "aborted" };
const _droppedNil: Op.Nil = { kind: "OpNil", reason: "dropped" };
const _replacedNil: Op.Nil = { kind: "OpNil", reason: "replaced" };
const _evictedNil: Op.Nil = { kind: "OpNil", reason: "evicted" };
const _idle: Op.Idle = { kind: "Idle" };
const _pending: Op.Pending = { kind: "Pending" };
const ok = <A>(value: A): Op.Ok<A> => ({ kind: "OpOk", value });
const err = <E>(error: E): Op.Err<E> => ({ kind: "OpErr", error });

/**
 * Every dropped call settles with the same immutable outcome. `@__PURE__` marks the call as
 * side-effect-free so a bundler can drop it, and the `Deferred` namespace with it, when the
 * package is imported only for other exports.
 */
const droppedDeferred: Deferred<Op.Nil> = /* @__PURE__ */ Deferred.from.Promise(
	/* @__PURE__ */ Promise.resolve(_droppedNil),
);

const toOutcome = <E, A>(result: Result<E, A> | null): Op.Outcome<E, A> =>
	result === null ? _abortedNil : result.kind === "Ok" ? ok(result.value) : err(result.error);

/**
 * Converts the raw task result inside the consumer's continuation. Building the
 * Deferred by composition instead of `then(toOutcome)` keeps the conversion and
 * the caller's settlement in one microtask and skips an intermediate promise.
 */
const mapOutcome = <E, A>(source: Deferred<Result<E, A> | null>): Deferred<Op.Outcome<E, A>> =>
	({
		then: (onSettled: (outcome: Op.Outcome<E, A>) => unknown) => source.then((result) => onSettled(toOutcome(result))),
	}) as unknown as Deferred<Op.Outcome<E, A>>;

const getMs = (duration: Duration): number => Duration.to.milliseconds(duration);

const noop = (): void => {};

/**
 * Schedules `fire` to repeat every `interval` until the returned cancel function runs.
 *
 * Repeat boundaries are absolute positions on the monotonic clock (`start + k * interval`):
 * timer jitter never accumulates across cycles, and a finite interval longer than the
 * platform's single-timer maximum is honored at full length by chaining timers instead of
 * clamping the request. A non-finite, sub-millisecond, zero, or negative interval schedules
 * no repeat — the initial run is the caller's.
 */
export const schedulePollRepeat = (
	interval: Duration,
	fire: () => void,
	stepCap: number = MAX_TIMER_MS,
): () => void => {
	const total = Math.floor(getMs(interval));
	if (!Number.isFinite(total) || total < 1) {
		return noop;
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	let cancelled = false;
	let boundary = performance.now() + total;
	const tick = (): void => {
		if (cancelled) {
			return;
		}
		timer = undefined;
		const remaining = boundary - performance.now();
		if (remaining > 0) {
			timer = setTimeout(tick, Math.min(remaining, stepCap));
			return;
		}
		fire();
		const now = performance.now();
		do {
			boundary += total;
		} while (boundary <= now);
		timer = setTimeout(tick, Math.min(boundary - now, stepCap));
	};
	timer = setTimeout(tick, Math.min(boundary - performance.now(), stepCap));
	return () => {
		cancelled = true;
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	};
};

const withManagerMeta = <T extends object>(manager: T, id?: string, opId?: string): T => {
	if (id !== undefined) {
		(manager as { id?: string; }).id = id;
	}
	(manager as { [Symbol.toStringTag]?: string; })[Symbol.toStringTag] = `Op.Manager${id ? `(${id})` : ""}${
		opId ? `[${opId}]` : ""
	}`;
	return manager;
};

// ---------------------------------------------------------------------------
// OP_FACTORY private symbol & internal type
// ---------------------------------------------------------------------------

export const OP_FACTORY: unique symbol = Symbol.for("@pplnd/core/Op.factory") as typeof OP_FACTORY;

export type InternalOp<Args extends readonly unknown[] = readonly unknown[], E = unknown, A = unknown> =
	& Op<Args, E, A>
	& { readonly [OP_FACTORY]: (args: Args, signal: AbortSignal) => Deferred<Result<E, A> | null>; };

export const toInternalOp = <Args extends readonly unknown[], E, A>(op: Op<Args, E, A>): InternalOp<Args, E, A> =>
	op as unknown as InternalOp<Args, E, A>;

// ---------------------------------------------------------------------------
// cancellableWait
// ---------------------------------------------------------------------------

/** Waits by the specified duration. Resolves early if the signal fires (non-blocking abort). */
export const cancellableWait = (duration: Duration, signal: AbortSignal): Promise<void> => {
	const rawMs = getMs(duration);
	if (rawMs <= 0) {
		return Promise.resolve();
	}
	return waitForDelay(rawMs, signal);
};

// ---------------------------------------------------------------------------
// runWithRetry
// ---------------------------------------------------------------------------

/**
 * Runs the factory with retry logic. Calls `onRetrying` before each retry delay.
 * Stops on Ok, Nil (null), abort, or exhausted attempts.
 */
export const runWithRetry = <Args extends readonly unknown[], E, A>(
	op: Op<Args, E, A>,
	args: Args,
	signal: AbortSignal,
	policy: RetryPolicy<E>,
	onRetrying: (state: Op.Retrying<E>) => void,
): Promise<Result<E, A> | null> => {
	const rawAttempts = policy.attempts;
	const attempts = toPositiveInteger(rawAttempts) ?? 1;
	const { when: shouldRetry, onRetry } = policy;
	const startedAt = Date.now();
	const budgetMs = normalizeBudgetMs(policy);

	const attempt = async (left: number): Promise<Result<E, A> | null> => {
		const result = await Deferred.to.Promise(toInternalOp(op)[OP_FACTORY](args, signal));
		if (result === null || signal.aborted) { return null; }
		if (result.kind === "Ok") { return result; }
		if (!Number.isFinite(left) || left <= 1) { return result; }
		if (shouldRetry !== undefined) {
			if (!shouldRetry(result.error)) { return result; }
		}
		const attemptNumber = attempts - left + 1;
		const delayDuration = policy.getDelay(attemptNumber);
		const ms = getMs(delayDuration);
		if (isBudgetExhausted(startedAt, ms, budgetMs)) { return result; }
		onRetrying({
			kind: "Retrying",
			attempt: attemptNumber,
			lastError: result.error,
			...(ms > 0 ? { nextRetryIn: ms } : {}),
		});
		onRetry?.({ attempt: attemptNumber, error: result.error, delay: delayDuration });
		if (ms > 0) {
			await cancellableWait(delayDuration, signal);
		}
		if (signal.aborted) { return null; }
		return attempt(left - 1);
	};

	return attempt(attempts);
};

// ---------------------------------------------------------------------------
// execute
// ---------------------------------------------------------------------------

/**
 * Executes the op (with optional retry), racing against an optional timeout deadline.
 * The timeout wraps the entire retry sequence — one deadline for all attempts.
 * If the deadline fires, it aborts the `controller` and returns `Err(onTimeout())`.
 * A null result from the factory (signal aborted) becomes `_abortedNil`.
 */
export const execute = <Args extends readonly unknown[], E, A>(
	op: Op<Args, E, A>,
	args: Args,
	controller: AbortController,
	retryOptions?: Op.RetryOptions<E>,
	timeoutOptions?: TimeoutPolicy<any>,
	onRetrying?: (state: Op.Retrying<E>) => void,
): Deferred<Op.Outcome<E, A>> => {
	const { signal } = controller;

	const source: Deferred<Result<E, A> | null> = retryOptions !== undefined && onRetrying !== undefined
		? Deferred.from.Promise(runWithRetry(op, args, signal, retryOptions, onRetrying))
		: toInternalOp(op)[OP_FACTORY](args, signal);
	const outcomeDeferred = mapOutcome(source);

	if (timeoutOptions === undefined) { return outcomeDeferred; }

	// Only the deadline path needs a promise to race the timer against.
	const runPromise: Promise<Op.Outcome<E, A>> = Deferred.to.Promise(outcomeDeferred);

	let timerId: ReturnType<typeof setTimeout> | undefined;
	const onAbort = () => {
		clearTimeout(timerId);
		timerId = undefined;
	};
	signal.addEventListener("abort", onAbort, { once: true });

	return Deferred.from.Promise(Promise.race([
		runPromise.then((outcome) => {
			signal.removeEventListener("abort", onAbort);
			if (timerId !== undefined) {
				clearTimeout(timerId);
				timerId = undefined;
			}
			return outcome;
		}),
		new Promise<Op.Outcome<E, A>>((resolve) => {
			timerId = setTimeout(() => {
				signal.removeEventListener("abort", onAbort);
				timerId = undefined;
				controller.abort();
				resolve(err(timeoutOptions.onTimeout()));
			}, clampTimerDelay(getMs(timeoutOptions.duration)));
		}),
	]));
};

// ---------------------------------------------------------------------------
// Strategy factories
// ---------------------------------------------------------------------------

export const makeRestartable = <Args extends readonly unknown[], E, A>(
	op: Op<Args, E, A>,
	minInterval?: Duration,
	retryOptions?: Op.RetryOptions<E>,
	timeoutOptions?: TimeoutPolicy<any>,
	id?: string,
): Op.Manager<Args, E, A, Op.State<E, A>> => {
	let currentState: Op.State<E, A> = _idle;
	let currentController: AbortController | undefined;
	let currentResolve: ((o: Op.Outcome<E, A>) => void) | undefined;
	let waitController: AbortController | undefined;
	let lastStartTime = 0;
	const subscribers = new Set<(state: Op.State<E, A>) => void>();

	const emit = (state: Op.State<E, A>): void => {
		currentState = state;
		for (const cb of subscribers) {
			cb(state);
		}
	};

	const run = (...args: Args): Deferred<Op.Outcome<E, A>> =>
		Deferred.from.Promise(
			new Promise<Op.Outcome<E, A>>((resolve) => {
				// Cancel any in-progress wait and the previous invocation.
				waitController?.abort();
				waitController = undefined;
				currentController?.abort();
				const prev = currentResolve;
				currentResolve = resolve;
				currentController = new AbortController();
				const controller = currentController;
				prev?.(_replacedNil); // resolve previous after updating state

				const startExecution = (): void => {
					if (currentController !== controller || controller.signal.aborted) { return; }
					// Only the minInterval gate reads the start timestamp.
					if (minInterval !== undefined) { lastStartTime = Date.now(); }
					emit(_pending);
					if (currentController !== controller || controller.signal.aborted) { return; }

					// Passing emit directly is safe: superseding or aborting calls controller.abort(),
					// causing runWithRetry to exit early before onRetrying is ever invoked.
					const onRetrying = retryOptions ? emit : undefined;

					execute(op, args, controller, retryOptions, timeoutOptions, onRetrying).then((outcome) => {
						if (currentController !== controller) { return; // superseded — already resolved by next run()
						 }
						const r = currentResolve;
						currentResolve = undefined;
						currentController = undefined;
						r?.(outcome);
						emit(outcome);
					});
				};

				const gap = minInterval !== undefined ? Math.max(0, getMs(minInterval) - (Date.now() - lastStartTime)) : 0;

				if (gap > 0) {
					waitController = new AbortController();
					const wc = waitController;
					cancellableWait(Duration.milliseconds(gap), wc.signal).then(() => {
						if (waitController === wc) { waitController = undefined; }
						startExecution();
					});
				} else {
					startExecution();
				}
			}),
		);

	const abort = (): void => {
		const hadWork = currentController !== undefined || waitController !== undefined;
		waitController?.abort();
		waitController = undefined;
		currentController?.abort();
		currentController = undefined;
		const r = currentResolve;
		currentResolve = undefined;
		r?.(_abortedNil);
		if (hadWork) { emit(_abortedNil); }
	};

	return withManagerMeta(
		{
			get state() {
				return currentState;
			},
			run,
			abort,
			subscribe: (cb) => {
				subscribers.add(cb);
				if (currentState.kind !== "Idle") {
					cb(currentState);
				}
				return () => subscribers.delete(cb);
			},
			reset: () => {
				waitController?.abort();
				waitController = undefined;
				currentController?.abort();
				currentController = undefined;
				const r = currentResolve;
				currentResolve = undefined;
				r?.(_abortedNil);
				emit(_idle);
			},
			poll: ({ interval }: { interval: Duration; }) => (...args: Args) => {
				void run(...args);
				return schedulePollRepeat(interval, () => void run(...args));
			},
		},
		id,
		op.id,
	);
};

export const makeExclusive = <Args extends readonly unknown[], E, A>(
	op: Op<Args, E, A>,
	cooldown?: Duration,
	retryOptions?: Op.RetryOptions<E>,
	timeoutOptions?: TimeoutPolicy<any>,
	id?: string,
): Op.Manager<Args, E, A, Op.State<E, A>> => {
	let currentState: Op.State<E, A> = _idle;
	let currentController: AbortController | undefined;
	let currentResolve: ((o: Op.Outcome<E, A>) => void) | undefined;
	let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
	const subscribers = new Set<(state: Op.State<E, A>) => void>();

	const emit = (state: Op.State<E, A>): void => {
		currentState = state;
		for (const cb of subscribers) {
			cb(state);
		}
	};

	const run = (...args: Args): Deferred<Op.Outcome<E, A>> => {
		if (currentController !== undefined || cooldownTimer !== undefined) {
			// In-flight or in cooldown — drop this call immediately.
			return droppedDeferred;
		}
		return Deferred.from.Promise(
			new Promise<Op.Outcome<E, A>>((resolve) => {
				currentResolve = resolve;
				currentController = new AbortController();
				const controller = currentController;
				emit(_pending);
				if (currentController !== controller || controller.signal.aborted) { return; }

				// Passing emit directly is safe: exclusive drops overlapping runs, and abort()
				// calls controller.abort(), causing runWithRetry to exit before onRetrying fires.
				const onRetrying = retryOptions ? emit : undefined;

				execute(op, args, controller, retryOptions, timeoutOptions, onRetrying).then((outcome) => {
					if (currentController !== controller) { return; }
					const r = currentResolve;
					currentResolve = undefined;
					currentController = undefined;
					r?.(outcome);

					if (cooldown !== undefined) {
						const rawCooldown = getMs(cooldown);
						if (rawCooldown > 0) {
							cooldownTimer = setTimeout(() => {
								cooldownTimer = undefined;
							}, clampTimerDelay(rawCooldown));
						}
					}

					emit(outcome);
				});
			}),
		);
	};

	const abort = (): void => {
		const hadWork = currentController !== undefined;
		if (cooldownTimer !== undefined) {
			clearTimeout(cooldownTimer);
			cooldownTimer = undefined;
		}
		currentController?.abort();
		currentController = undefined;
		const r = currentResolve;
		currentResolve = undefined;
		r?.(_abortedNil);
		if (hadWork) { emit(_abortedNil); }
	};

	return withManagerMeta(
		{
			get state() {
				return currentState;
			},
			run,
			abort,
			subscribe: (cb) => {
				subscribers.add(cb);
				if (currentState.kind !== "Idle") {
					cb(currentState);
				}
				return () => subscribers.delete(cb);
			},
			reset: () => {
				if (cooldownTimer !== undefined) {
					clearTimeout(cooldownTimer);
					cooldownTimer = undefined;
				}
				currentController?.abort();
				currentController = undefined;
				const r = currentResolve;
				currentResolve = undefined;
				r?.(_abortedNil);
				emit(_idle);
			},
			poll: ({ interval }: { interval: Duration; }) => (...args: Args) => {
				void run(...args);
				return schedulePollRepeat(interval, () => void run(...args));
			},
		},
		id,
		op.id,
	);
};

export const makeQueue = <Args extends readonly unknown[], E, A>(
	op: Op<Args, E, A>,
	maxSize?: number,
	overflow?: "drop" | "replace-last",
	concurrency?: number,
	dedupe?: (a: Args, b: Args) => boolean,
	retryOptions?: Op.RetryOptions<E>,
	timeoutOptions?: TimeoutPolicy<any>,
	id?: string,
): Op.Manager<Args, E, A, Op.State<E, A>> => {
	const maxConcurrency = concurrency !== undefined && Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 1;
	const maxQueueSize = maxSize === undefined ? undefined : Number.isInteger(maxSize) && maxSize > 0 ? maxSize : 1;
	let currentState: Op.State<E, A> = _idle;
	let generation = 0;
	let inFlight = 0;
	const queue: Array<{ input: Args; resolve: (o: Op.Outcome<E, A>) => void; }> = [];
	const inflightControllers = new Set<AbortController>();
	const inflightResolvers: Array<(o: Op.Outcome<E, A>) => void> = [];
	const subscribers = new Set<(state: Op.State<E, A>) => void>();

	const emit = (state: Op.State<E, A>): void => {
		currentState = state;
		for (const cb of subscribers) {
			cb(state);
		}
	};

	const startOne = (
		args: Args,
		resolve: (o: Op.Outcome<E, A>) => void,
		myGeneration: number,
		preReserved = false,
	): void => {
		if (!preReserved) { inFlight++; }
		const controller = new AbortController();
		inflightControllers.add(controller);
		inflightResolvers.push(resolve);
		emit(_pending);
		if (controller.signal.aborted || generation !== myGeneration) {
			return;
		}

		// Passing emit directly is safe: abort() aborts all inflightControllers,
		// causing runWithRetry to exit early before onRetrying fires.
		const onRetrying = retryOptions ? emit : undefined;

		execute(op, args, controller, retryOptions, timeoutOptions, onRetrying).then((outcome) => {
			inflightControllers.delete(controller);
			const idx = inflightResolvers.indexOf(resolve);
			if (idx !== -1) { inflightResolvers.splice(idx, 1); }

			if (generation !== myGeneration) {
				resolve(_abortedNil);
				return;
			}

			inFlight--;
			resolve(outcome);

			const reservedItems: Array<{ input: Args; resolve: (o: Op.Outcome<E, A>) => void; }> = [];
			while (inFlight < maxConcurrency && queue.length > 0) {
				const next = queue.shift()!;
				inFlight++;
				reservedItems.push(next);
			}

			emit(outcome);

			if (generation !== myGeneration) {
				for (const item of reservedItems) {
					item.resolve(_abortedNil);
				}
				return;
			}

			for (const item of reservedItems) {
				startOne(item.input, item.resolve, myGeneration, true);
			}
		});
	};

	const run = (...args: Args): Deferred<Op.Outcome<E, A>> => {
		const myGeneration = generation;

		// Dedupe: scan queue for a matching item — drop the duplicate, new item takes its place.
		if (dedupe !== undefined) {
			const idx = queue.findIndex((item) => dedupe(args, item.input));
			if (idx !== -1) {
				// oxlint-disable-next-line prefer-destructuring
				const dup = queue.splice(idx, 1)[0];
				dup.resolve(_droppedNil);
			}
		}

		// Slot available — start immediately.
		if (inFlight < maxConcurrency && queue.length === 0) {
			return Deferred.from.Promise(
				new Promise<Op.Outcome<E, A>>((resolve) => {
					startOne(args, resolve, myGeneration);
				}),
			);
		}

		// Queue has capacity (unbounded when maxSize is undefined).
		if (maxQueueSize === undefined || queue.length < maxQueueSize) {
			return Deferred.from.Promise(
				new Promise<Op.Outcome<E, A>>((resolve) => {
					queue.push({ input: args, resolve });
					emit({ kind: "Queued", position: queue.length - 1 });
				}),
			);
		}

		// Queue is full — apply overflow policy.
		if (overflow === "replace-last") {
			return Deferred.from.Promise(
				new Promise<Op.Outcome<E, A>>((resolve) => {
					const tail = queue.pop()!;
					tail.resolve(_evictedNil);
					queue.push({ input: args, resolve });
					emit({ kind: "Queued", position: queue.length - 1 });
				}),
			);
		}

		// Drop (default when maxSize is set).
		return droppedDeferred;
	};

	const abort = (): void => {
		const hadWork = inFlight > 0 || queue.length > 0;
		generation++;
		for (const c of inflightControllers) {
			c.abort();
		}
		inflightControllers.clear();
		for (const r of inflightResolvers) {
			r(_abortedNil);
		}
		inflightResolvers.length = 0;
		for (const item of queue) {
			item.resolve(_abortedNil);
		}
		queue.length = 0;
		inFlight = 0;
		if (hadWork) { emit(_abortedNil); }
	};

	return withManagerMeta(
		{
			get state() {
				return currentState;
			},
			run,
			abort,
			subscribe: (cb) => {
				subscribers.add(cb);
				if (currentState.kind !== "Idle") {
					cb(currentState);
				}
				return () => subscribers.delete(cb);
			},
			reset: () => {
				generation++;
				for (const c of inflightControllers) {
					c.abort();
				}
				inflightControllers.clear();
				for (const r of inflightResolvers) {
					r(_abortedNil);
				}
				inflightResolvers.length = 0;
				for (const item of queue) {
					item.resolve(_abortedNil);
				}
				queue.length = 0;
				inFlight = 0;
				emit(_idle);
			},
			poll: ({ interval }: { interval: Duration; }) => (...args: Args) => {
				void run(...args);
				return schedulePollRepeat(interval, () => void run(...args));
			},
		},
		id,
		op.id,
	);
};

export const makeBuffered = <Args extends readonly unknown[], E, A>(
	op: Op<Args, E, A>,
	size?: number,
	retryOptions?: Op.RetryOptions<E>,
	timeoutOptions?: TimeoutPolicy<any>,
	id?: string,
): Op.Manager<Args, E, A, Op.State<E, A>> => {
	const bufferSize = size !== undefined && Number.isInteger(size) && size > 0 ? size : 1;
	let currentState: Op.State<E, A> = _idle;
	let currentController: AbortController | undefined;
	let currentResolve: ((o: Op.Outcome<E, A>) => void) | undefined;
	const buffer: Array<{ input: Args; resolve: (o: Op.Outcome<E, A>) => void; }> = [];
	let reserved: { input: Args; resolve: (o: Op.Outcome<E, A>) => void; } | undefined;
	const subscribers = new Set<(state: Op.State<E, A>) => void>();

	const emit = (state: Op.State<E, A>): void => {
		currentState = state;
		for (const cb of subscribers) {
			cb(state);
		}
	};

	const startRun = (args: Args, resolve: (o: Op.Outcome<E, A>) => void): void => {
		currentResolve = resolve;
		currentController = new AbortController();
		const controller = currentController;
		emit(_pending);
		if (currentController !== controller || controller.signal.aborted) { return; }

		// Passing emit directly is safe: buffered calls run strictly sequentially, and abort()
		// calls controller.abort(), causing runWithRetry to exit early before onRetrying fires.
		const onRetrying = retryOptions ? emit : undefined;

		execute(op, args, controller, retryOptions, timeoutOptions, onRetrying).then((outcome) => {
			if (currentController !== controller) { return; }
			const r = currentResolve;
			currentResolve = undefined;
			currentController = undefined;
			reserved = buffer.shift();
			r?.(outcome);
			emit(outcome);
			if (reserved !== undefined) {
				const next = reserved;
				reserved = undefined;
				startRun(next.input, next.resolve);
			}
		});
	};

	const run = (...args: Args): Deferred<Op.Outcome<E, A>> =>
		Deferred.from.Promise(
			new Promise<Op.Outcome<E, A>>((resolve) => {
				if (currentController === undefined && reserved === undefined && buffer.length === 0) {
					startRun(args, resolve);
				} else if (buffer.length < bufferSize) {
					// Buffer has capacity — enqueue.
					buffer.push({ input: args, resolve });
					emit({ kind: "Queued", position: buffer.length - 1 });
				} else {
					// Buffer full — evict oldest (head) and enqueue new item.
					const evicted = buffer.shift()!;
					evicted.resolve(_evictedNil);
					buffer.push({ input: args, resolve });
					emit({ kind: "Queued", position: buffer.length - 1 });
				}
			}),
		);

	const abort = (): void => {
		const hadWork = currentController !== undefined || reserved !== undefined || buffer.length > 0;
		currentController?.abort();
		currentController = undefined;
		const cr = currentResolve;
		currentResolve = undefined;
		cr?.(_abortedNil);
		reserved?.resolve(_abortedNil);
		reserved = undefined;
		for (const item of buffer) {
			item.resolve(_abortedNil);
		}
		buffer.length = 0;
		if (hadWork) { emit(_abortedNil); }
	};

	return withManagerMeta(
		{
			get state() {
				return currentState;
			},
			run,
			abort,
			subscribe: (cb) => {
				subscribers.add(cb);
				if (currentState.kind !== "Idle") {
					cb(currentState);
				}
				return () => subscribers.delete(cb);
			},
			reset: () => {
				currentController?.abort();
				currentController = undefined;
				const cr = currentResolve;
				currentResolve = undefined;
				reserved?.resolve(_abortedNil);
				reserved = undefined;
				for (const item of buffer) {
					item.resolve(_abortedNil);
				}
				buffer.length = 0;
				cr?.(_abortedNil);
				emit(_idle);
			},
			poll: ({ interval }: { interval: Duration; }) => (...args: Args) => {
				void run(...args);
				return schedulePollRepeat(interval, () => void run(...args));
			},
		},
		id,
		op.id,
	);
};

export const makeDebounced = <Args extends readonly unknown[], E, A>(
	op: Op<Args, E, A>,
	duration: Duration,
	leading: boolean,
	maxWait?: Duration,
	retryOptions?: Op.RetryOptions<E>,
	timeoutOptions?: TimeoutPolicy<any>,
	id?: string,
): Op.Manager<Args, E, A, Op.State<E, A>> => {
	let currentState: Op.State<E, A> = _idle;
	let executionEpoch = 0;
	// Trailing execution state
	let latestTrailingController: AbortController | undefined;
	const trailingResolvers = new Map<AbortController, (o: Op.Outcome<E, A>) => void>();
	// Leading execution state
	let leadingController: AbortController | undefined;
	let leadingResolve: ((o: Op.Outcome<E, A>) => void) | undefined;
	// Pending (waiting for timer) state
	let pendingResolve: ((o: Op.Outcome<E, A>) => void) | undefined;
	let timerId: ReturnType<typeof setTimeout> | undefined;
	let pendingInput: Args | undefined;
	let firstCallAt = 0; // timestamp of first call in current burst; 0 = no burst
	const subscribers = new Set<(state: Op.State<E, A>) => void>();

	const emit = (state: Op.State<E, A>): void => {
		currentState = state;
		for (const cb of subscribers) {
			cb(state);
		}
	};

	const fireLeading = (args: Args, resolve: (o: Op.Outcome<E, A>) => void): void => {
		const myEpoch = ++executionEpoch;
		leadingController = new AbortController();
		const controller = leadingController;
		leadingResolve = resolve;
		emit(_pending);
		if (leadingController !== controller || controller.signal.aborted) { return; }

		const onRetrying = retryOptions
			? (r: Op.Retrying<E>) => {
				if (executionEpoch === myEpoch && leadingController === controller) {
					emit(r);
				}
			}
			: undefined;

		execute(op, args, controller, retryOptions, timeoutOptions, onRetrying).then((outcome) => {
			if (leadingController !== controller) { return; }
			const r = leadingResolve;
			leadingResolve = undefined;
			leadingController = undefined;
			r?.(outcome);
			if (executionEpoch === myEpoch) {
				emit(outcome);
			}
		});
	};

	const fireTrailing = (): void => {
		timerId = undefined;
		firstCallAt = 0;
		const capturedResolve = pendingResolve;
		pendingResolve = undefined;
		if (capturedResolve === undefined) { return; // leading-only burst — no trailing call pending
		 }
		const toRun = pendingInput as Args;
		pendingInput = undefined;
		const myEpoch = ++executionEpoch;
		const controller = new AbortController();
		latestTrailingController = controller;
		trailingResolvers.set(controller, capturedResolve);
		emit(_pending);
		if (latestTrailingController !== controller || controller.signal.aborted) { return; }

		// Guard required: fireTrailing runs when the debounce timer expires without aborting
		// an in-flight execution, so retries from the predecessor must not overwrite current state.
		const onRetrying = retryOptions
			? (r: Op.Retrying<E>) => {
				if (latestTrailingController === controller && executionEpoch === myEpoch) { emit(r); }
			}
			: undefined;

		execute(op, toRun, controller, retryOptions, timeoutOptions, onRetrying).then((outcome) => {
			const r = trailingResolvers.get(controller);
			trailingResolvers.delete(controller);
			r?.(outcome);
			if (latestTrailingController === controller && executionEpoch === myEpoch) {
				latestTrailingController = undefined;
				emit(outcome);
			}
		});
	};

	const scheduleTrailing = (): void => {
		if (timerId !== undefined) { clearTimeout(timerId); }
		let delay = getMs(duration);
		if (maxWait !== undefined && firstCallAt > 0) {
			const maxDelay = firstCallAt + getMs(maxWait) - Date.now();
			delay = Math.min(getMs(duration), Math.max(0, maxDelay));
		}
		timerId = setTimeout(fireTrailing, clampTimerDelay(delay));
	};

	const inDebounceWindow = (): boolean =>
		timerId !== undefined || leadingController !== undefined || trailingResolvers.size > 0;

	const run = (...args: Args): Deferred<Op.Outcome<E, A>> =>
		Deferred.from.Promise(
			new Promise<Op.Outcome<E, A>>((resolve) => {
				if (!inDebounceWindow()) {
					// Fresh start.
					firstCallAt = Date.now();
					if (leading) {
						const epoch = executionEpoch;
						fireLeading(args, resolve);
						if (executionEpoch === epoch + 1 && leadingController !== undefined) { scheduleTrailing(); }
					} else {
						pendingInput = args;
						pendingResolve = resolve;
						scheduleTrailing();
					}
				} else {
					// In debounce window — replace pending trailing call.
					if (firstCallAt === 0) { firstCallAt = Date.now(); }
					const prev = pendingResolve;
					pendingInput = args;
					pendingResolve = resolve;
					prev?.(_evictedNil);
					scheduleTrailing();
				}
			}),
		);

	const abort = (): void => {
		const hadWork = leadingController !== undefined || trailingResolvers.size > 0;
		if (timerId !== undefined) {
			clearTimeout(timerId);
			timerId = undefined;
			pendingInput = undefined;
			firstCallAt = 0;
		}
		const pr = pendingResolve;
		pendingResolve = undefined;
		const lr = leadingResolve;
		leadingResolve = undefined;
		leadingController?.abort();
		leadingController = undefined;
		for (const [c, r] of trailingResolvers) {
			c.abort();
			r(_abortedNil);
		}
		trailingResolvers.clear();
		latestTrailingController = undefined;
		pr?.(_abortedNil);
		lr?.(_abortedNil);
		if (hadWork) { emit(_abortedNil); }
	};

	return withManagerMeta(
		{
			get state() {
				return currentState;
			},
			run,
			abort,
			subscribe: (cb) => {
				subscribers.add(cb);
				if (currentState.kind !== "Idle") {
					cb(currentState);
				}
				return () => subscribers.delete(cb);
			},
			reset: () => {
				if (timerId !== undefined) {
					clearTimeout(timerId);
					timerId = undefined;
				}
				pendingInput = undefined;
				const pr = pendingResolve;
				pendingResolve = undefined;
				firstCallAt = 0;
				leadingController?.abort();
				leadingController = undefined;
				const lr = leadingResolve;
				leadingResolve = undefined;
				for (const [c, r] of trailingResolvers) {
					c.abort();
					r(_abortedNil);
				}
				trailingResolvers.clear();
				latestTrailingController = undefined;
				pr?.(_abortedNil);
				lr?.(_abortedNil);
				emit(_idle);
			},
			poll: ({ interval }: { interval: Duration; }) => (...args: Args) => {
				void run(...args);
				return schedulePollRepeat(interval, () => void run(...args));
			},
		},
		id,
		op.id,
	);
};

export const makeThrottled = <Args extends readonly unknown[], E, A>(
	op: Op<Args, E, A>,
	duration: Duration,
	trailing: boolean,
	retryOptions?: Op.RetryOptions<E>,
	timeoutOptions?: TimeoutPolicy<any>,
	id?: string,
): Op.Manager<Args, E, A, Op.State<E, A>> => {
	let currentState: Op.State<E, A> = _idle;
	let executionEpoch = 0;
	let latestController: AbortController | undefined;
	const inFlightResolvers = new Map<AbortController, (o: Op.Outcome<E, A>) => void>();
	let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingInput: Args | undefined;
	let pendingResolve: ((o: Op.Outcome<E, A>) => void) | undefined;
	const subscribers = new Set<(state: Op.State<E, A>) => void>();

	const emit = (state: Op.State<E, A>): void => {
		currentState = state;
		for (const cb of subscribers) {
			cb(state);
		}
	};

	const fireOp = (args: Args, resolve: (o: Op.Outcome<E, A>) => void): void => {
		const myEpoch = ++executionEpoch;
		const controller = new AbortController();
		latestController = controller;
		inFlightResolvers.set(controller, resolve);
		emit(_pending);
		if (latestController !== controller || controller.signal.aborted) { return; }

		// Guard required: fireOp for trailing execution starts when cooldown expires without aborting
		// an in-flight execution, so retries from the predecessor must not overwrite current state.
		const onRetrying = retryOptions
			? (r: Op.Retrying<E>) => {
				if (latestController === controller && executionEpoch === myEpoch) { emit(r); }
			}
			: undefined;

		execute(op, args, controller, retryOptions, timeoutOptions, onRetrying).then((outcome) => {
			const r = inFlightResolvers.get(controller);
			inFlightResolvers.delete(controller);
			r?.(outcome);
			if (latestController === controller && executionEpoch === myEpoch) {
				latestController = undefined;
				emit(outcome);
			}
		});
	};

	const startCooldown = (): void => {
		cooldownTimer = setTimeout(() => {
			cooldownTimer = undefined;
			if (trailing && pendingInput !== undefined) {
				const toRun = pendingInput as Args;
				const resolve = pendingResolve!;
				pendingInput = undefined;
				pendingResolve = undefined;
				startCooldown(); // trailing fire holds its own cooldown window
				fireOp(toRun, resolve);
			}
		}, clampTimerDelay(getMs(duration)));
	};

	const run = (...args: Args): Deferred<Op.Outcome<E, A>> => {
		if (cooldownTimer !== undefined) {
			if (!trailing) {
				return droppedDeferred;
			}
			return Deferred.from.Promise(
				new Promise<Op.Outcome<E, A>>((resolve) => {
					const prev = pendingResolve;
					pendingInput = args;
					pendingResolve = resolve;
					prev?.(_evictedNil);
				}),
			);
		}
		return Deferred.from.Promise(
			new Promise<Op.Outcome<E, A>>((resolve) => {
				startCooldown();
				fireOp(args, resolve);
			}),
		);
	};

	const abort = (): void => {
		const hadWork = inFlightResolvers.size > 0 || pendingResolve !== undefined;
		if (cooldownTimer !== undefined) {
			clearTimeout(cooldownTimer);
			cooldownTimer = undefined;
		}
		for (const [c, r] of inFlightResolvers) {
			c.abort();
			r(_abortedNil);
		}
		inFlightResolvers.clear();
		latestController = undefined;
		const pr = pendingResolve;
		pendingResolve = undefined;
		pendingInput = undefined;
		pr?.(_abortedNil);
		if (hadWork) { emit(_abortedNil); }
	};

	return withManagerMeta(
		{
			get state() {
				return currentState;
			},
			run,
			abort,
			subscribe: (cb) => {
				subscribers.add(cb);
				if (currentState.kind !== "Idle") {
					cb(currentState);
				}
				return () => subscribers.delete(cb);
			},
			reset: () => {
				if (cooldownTimer !== undefined) {
					clearTimeout(cooldownTimer);
					cooldownTimer = undefined;
				}
				for (const [c, r] of inFlightResolvers) {
					c.abort();
					r(_abortedNil);
				}
				inFlightResolvers.clear();
				latestController = undefined;
				pendingInput = undefined;
				const pr = pendingResolve;
				pendingResolve = undefined;
				pr?.(_abortedNil);
				emit(_idle);
			},
			poll: ({ interval }: { interval: Duration; }) => (...args: Args) => {
				void run(...args);
				return schedulePollRepeat(interval, () => void run(...args));
			},
		},
		id,
		op.id,
	);
};

export const makeConcurrent = <Args extends readonly unknown[], E, A>(
	op: Op<Args, E, A>,
	n: number,
	overflow: "queue" | "drop",
	retryOptions?: Op.RetryOptions<E>,
	timeoutOptions?: TimeoutPolicy<any>,
	id?: string,
): Op.Manager<Args, E, A, Op.State<E, A>> => {
	const maxConcurrency = Number.isInteger(n) && n > 0 ? n : 1;
	let currentState: Op.State<E, A> = _idle;
	let inflight = 0;
	let generation = 0;
	const controllers = new Set<AbortController>();
	const inflightResolvers: Array<(o: Op.Outcome<E, A>) => void> = [];
	const overflowQueue: Array<{ input: Args; resolve: (o: Op.Outcome<E, A>) => void; }> = [];
	const subscribers = new Set<(state: Op.State<E, A>) => void>();

	const emit = (state: Op.State<E, A>): void => {
		currentState = state;
		for (const cb of subscribers) {
			cb(state);
		}
	};

	const startOne = (
		args: Args,
		resolve: (o: Op.Outcome<E, A>) => void,
		myGeneration: number,
		preReserved = false,
	): void => {
		if (!preReserved) { inflight++; }
		const controller = new AbortController();
		controllers.add(controller);
		inflightResolvers.push(resolve);
		emit(_pending);
		if (controller.signal.aborted || generation !== myGeneration) {
			return;
		}

		// Passing emit directly is safe: abort() aborts all controllers,
		// causing runWithRetry to exit early before onRetrying fires.
		const onRetrying = retryOptions ? emit : undefined;

		execute(op, args, controller, retryOptions, timeoutOptions, onRetrying).then((outcome) => {
			controllers.delete(controller);
			const idx = inflightResolvers.indexOf(resolve);
			if (idx !== -1) { inflightResolvers.splice(idx, 1); }

			if (generation !== myGeneration) {
				resolve(_abortedNil);
				return;
			}

			inflight--;
			resolve(outcome);

			const reservedItems: Array<{ input: Args; resolve: (o: Op.Outcome<E, A>) => void; }> = [];
			while (inflight < maxConcurrency && overflowQueue.length > 0) {
				const next = overflowQueue.shift()!;
				inflight++;
				reservedItems.push(next);
			}

			emit(outcome);

			if (generation !== myGeneration) {
				for (const item of reservedItems) {
					item.resolve(_abortedNil);
				}
				return;
			}

			for (const item of reservedItems) {
				startOne(item.input, item.resolve, myGeneration, true);
			}
		});
	};

	const run = (...args: Args): Deferred<Op.Outcome<E, A>> => {
		const myGeneration = generation;

		if (inflight < maxConcurrency && overflowQueue.length === 0) {
			return Deferred.from.Promise(
				new Promise<Op.Outcome<E, A>>((resolve) => {
					startOne(args, resolve, myGeneration);
				}),
			);
		}

		if (overflow === "drop") {
			return droppedDeferred;
		}

		return Deferred.from.Promise(
			new Promise<Op.Outcome<E, A>>((resolve) => {
				overflowQueue.push({ input: args, resolve });
				emit({ kind: "Queued", position: overflowQueue.length - 1 });
			}),
		);
	};

	const abort = (): void => {
		const hadWork = inflight > 0 || overflowQueue.length > 0;
		generation++;
		for (const c of controllers) {
			c.abort();
		}
		controllers.clear();
		for (const r of inflightResolvers) {
			r(_abortedNil);
		}
		inflightResolvers.length = 0;
		for (const item of overflowQueue) {
			item.resolve(_abortedNil);
		}
		overflowQueue.length = 0;
		inflight = 0;
		if (hadWork) { emit(_abortedNil); }
	};

	return withManagerMeta(
		{
			get state() {
				return currentState;
			},
			run,
			abort,
			subscribe: (cb) => {
				subscribers.add(cb);
				if (currentState.kind !== "Idle") {
					cb(currentState);
				}
				return () => subscribers.delete(cb);
			},
			reset: () => {
				generation++;
				for (const c of controllers) {
					c.abort();
				}
				controllers.clear();
				for (const r of inflightResolvers) {
					r(_abortedNil);
				}
				inflightResolvers.length = 0;
				for (const item of overflowQueue) {
					item.resolve(_abortedNil);
				}
				overflowQueue.length = 0;
				inflight = 0;
				emit(_idle);
			},
			poll: ({ interval }: { interval: Duration; }) => (...args: Args) => {
				void run(...args);
				return schedulePollRepeat(interval, () => void run(...args));
			},
		},
		id,
		op.id,
	);
};

export const makeKeyed = <Args extends readonly unknown[], K, E, A>(
	op: Op<Args, E, A>,
	keyFn: (...args: Args) => K,
	perKey: "exclusive" | "restartable",
	timeoutOptions?: TimeoutPolicy<any>,
	id?: string,
): Op.KeyedManager<Args, K, E, Op.KeyedExclusivePerKey<E, A> | Op.KeyedRestartablePerKey<E, A>> => {
	type PerKeyS = Op.KeyedExclusivePerKey<E, A> | Op.KeyedRestartablePerKey<E, A>;
	const stateMap = new Map<K, PerKeyS>();
	const slots = new Map<K, { controller: AbortController; resolve: (o: Op.Outcome<E, A>) => void; }>();
	const subscribers = new Set<(state: ReadonlyMap<K, PerKeyS>) => void>();

	const emitSnapshot = (): void => {
		// Copying the whole per-key map for nobody is the dominant cost of a keyed
		// transition in subscriber-free use; the `state` getter snapshots on demand.
		if (subscribers.size === 0) { return; }
		const snapshot = new Map(stateMap) as ReadonlyMap<K, PerKeyS>;
		for (const cb of subscribers) {
			cb(snapshot);
		}
	};

	const run = (...args: Args): Deferred<Op.Outcome<E, A>> => {
		const k = keyFn(...args);

		if (slots.has(k)) {
			if (perKey === "exclusive") {
				return droppedDeferred;
			}
			// restartable: cancel existing slot
			const existing = slots.get(k)!;
			existing.controller.abort();
			const prev = existing.resolve;
			slots.delete(k);
			prev(_replacedNil);
		}

		return Deferred.from.Promise(
			new Promise<Op.Outcome<E, A>>((resolve) => {
				const controller = new AbortController();
				slots.set(k, { controller, resolve });
				stateMap.set(k, _pending as PerKeyS);
				emitSnapshot();

				if (controller.signal.aborted || slots.get(k)?.controller !== controller) {
					return;
				}

				execute(op, args, controller, undefined, timeoutOptions).then((outcome) => {
					const slot = slots.get(k);
					if (!slot || slot.controller !== controller) {
						resolve(_abortedNil);
						return;
					}
					slots.delete(k);
					stateMap.set(k, outcome as PerKeyS);
					resolve(outcome);
					emitSnapshot();
				});
			}),
		);
	};

	const abort = (...abortArgs: [key?: K]): void => {
		if (abortArgs.length > 0) {
			const key = abortArgs[0] as K;
			const slot = slots.get(key);
			if (slot) {
				slot.controller.abort();
				const r = slot.resolve;
				slots.delete(key);
				stateMap.set(key, _abortedNil as PerKeyS);
				r(_abortedNil);
				emitSnapshot();
			}
		} else {
			const hadWork = slots.size > 0;
			const resolvers = [];
			for (const [k, slot] of slots) {
				slot.controller.abort();
				stateMap.set(k, _abortedNil as PerKeyS);
				resolvers.push(slot.resolve);
			}
			slots.clear();
			for (const r of resolvers) {
				r(_abortedNil);
			}
			if (hadWork) { emitSnapshot(); }
		}
	};

	return withManagerMeta(
		{
			get state() {
				return new Map(stateMap) as ReadonlyMap<K, PerKeyS>;
			},
			run: run as (...args: Args) => Deferred<Exclude<PerKeyS, Op.Pending | Op.Retrying<E>>>,
			abort,
			subscribe: (cb) => {
				subscribers.add(cb);
				if (stateMap.size > 0) {
					cb(new Map(stateMap) as ReadonlyMap<K, PerKeyS>);
				}
				return () => subscribers.delete(cb);
			},
			reset: () => {
				for (const [, slot] of slots) {
					slot.controller.abort();
					slot.resolve(_abortedNil);
				}
				slots.clear();
				stateMap.clear();
				emitSnapshot();
			},
			poll: ({ interval }: { interval: Duration; }) => (...args: Args) => {
				void run(...args);
				return schedulePollRepeat(interval, () => void run(...args));
			},
		},
		id,
		op.id,
	);
};

export const makeOnce = <Args extends readonly unknown[], E, A>(
	op: Op<Args, E, A>,
	retryOptions?: Op.RetryOptions<E>,
	timeoutOptions?: TimeoutPolicy<any>,
	id?: string,
): Op.Manager<Args, E, A, Op.State<E, A>> => {
	let currentState: Op.State<E, A> = _idle;
	let currentController: AbortController | undefined;
	let currentResolve: ((o: Op.Outcome<E, A>) => void) | undefined;
	const subscribers = new Set<(state: Op.State<E, A>) => void>();

	const emit = (state: Op.State<E, A>): void => {
		currentState = state;
		for (const cb of subscribers) {
			cb(state);
		}
	};

	const run = (...args: Args): Deferred<Op.Outcome<E, A>> => {
		// Terminal: once the manager leaves Idle, all subsequent calls are dropped.
		if (currentState.kind !== "Idle") {
			return droppedDeferred;
		}
		return Deferred.from.Promise(
			new Promise<Op.Outcome<E, A>>((resolve) => {
				currentResolve = resolve;
				currentController = new AbortController();
				const controller = currentController;
				emit(_pending);
				if (currentController !== controller || controller.signal.aborted) { return; }

				// Passing emit directly is safe: once drops subsequent runs, and abort()
				// calls controller.abort(), causing runWithRetry to exit early before onRetrying fires.
				const onRetrying = retryOptions ? emit : undefined;

				execute(op, args, controller, retryOptions, timeoutOptions, onRetrying).then((outcome) => {
					if (currentController !== controller) { return; }
					const r = currentResolve;
					currentResolve = undefined;
					currentController = undefined;
					r?.(outcome);
					emit(outcome);
				});
			}),
		);
	};

	const abort = (): void => {
		const hadWork = currentController !== undefined;
		currentController?.abort();
		currentController = undefined;
		const r = currentResolve;
		currentResolve = undefined;
		r?.(_abortedNil);
		if (hadWork) { emit(_abortedNil); }
	};

	return withManagerMeta(
		{
			get state() {
				return currentState;
			},
			run,
			abort,
			subscribe: (cb) => {
				subscribers.add(cb);
				if (currentState.kind !== "Idle") {
					cb(currentState);
				}
				return () => subscribers.delete(cb);
			},
			reset: () => {
				currentController?.abort();
				currentController = undefined;
				const r = currentResolve;
				currentResolve = undefined;
				r?.(_abortedNil);
				emit(_idle);
			},
			poll: ({ interval }: { interval: Duration; }) => (...args: Args) => {
				void run(...args);
				return schedulePollRepeat(interval, () => void run(...args));
			},
		},
		id,
		op.id,
	);
};
