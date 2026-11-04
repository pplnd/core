import type { WithError, WithKind, WithValue } from "../internal/InternalTypes";
import { clampTimerDelay } from "../internal/timers.ts";
import { Duration } from "../Types/Duration.ts";
import { Aborted } from "./Aborted.ts";
import { Deferred } from "./Deferred.ts";
import { Maybe } from "./Maybe.ts";
import { Result } from "./Result.ts";
import type { Task } from "./Task.ts";

/**
 * Groups nearby key lookups into bulk requests and returns an outcome for each caller.
 *
 * Duplicate keys share a lookup while they are queued. Results are not cached, so a lookup after
 * dispatch can fetch the same key again, even if the previous request is still running.
 *
 * @example
 * ```ts
 * const userBatcher = Batcher.make(
 *   (ids: readonly string[]) => userStore.findByIds(ids),
 *   { maxBatchSize: 100 },
 * );
 *
 * // The outcome reports a found user, a missing key, or a fetch error.
 * const outcome = await userBatcher.load("u_1");
 * ```
 */
export type Batcher<K, E, V> = {
	/**
	 * Queues a key and immediately returns a `Deferred` of its lookup outcome.
	 * An individual caller can cancel without affecting other callers in its batch.
	 *
	 * @param key - The key to look up.
	 * @param signal - Optional AbortSignal to cancel this individual caller's lookup.
	 * @see {@link Batcher.loadMany} to coalesce multiple keys in a single call.
	 */
	readonly load: (key: K, signal?: AbortSignal) => Deferred<Batcher.Outcome<E | Aborted, V, K>>;

	/**
	 * Queues multiple keys and returns their outcomes in input order.
	 *
	 * Does not short-circuit: preserves discrete per-key outcomes (`Ok`, `Missing`, or `Err`)
	 * for each requested key.
	 *
	 * @param keys - The collection of keys to look up.
	 * @param signal - Optional AbortSignal to cancel this caller's lookup batch.
	 * @see {@link Batcher.load} to look up an individual key.
	 */
	readonly loadMany: (
		keys: readonly K[],
		signal?: AbortSignal,
	) => Deferred<readonly Batcher.Outcome<E | Aborted, V, K>[]>;

	/**
	 * Dispatches queued keys without waiting for the scheduled microtask or timer, then waits for
	 * queued and in-flight batches to finish. Work queued while waiting also delays completion.
	 *
	 * Primarily used in unit tests or before transaction boundaries to guarantee
	 * deterministic batch execution.
	 *
	 * @see {@link Batcher.load} to enqueue individual lookups.
	 */
	readonly flush: () => Deferred<void>;
};

export namespace Batcher {
	/**
	 * Represents a successful batch resolution containing the found value.
	 */
	export type Ok<V> = WithKind<"BatcherOk"> & WithValue<V>;

	/**
	 * Represents a query execution failure (e.g. database down, network timeout).
	 */
	export type Err<E> = WithKind<"BatcherErr"> & WithError<E>;

	/**
	 * Represents an absent key where the batch query succeeded but the key was not found.
	 */
	export type Missing<K> = WithKind<"BatcherMissing"> & {
		/**
		 * The key that was requested but absent from the resolved map.
		 */
		readonly key: K;
	};

	/**
	 * A tri-state domain outcome representing the result of looking up a key in a batch:
	 * - `BatcherOk`: Found value `V`.
	 * - `BatcherMissing`: Absent key `K`.
	 * - `BatcherErr`: Execution error `E`.
	 */
	export type Outcome<E, V, K> = Ok<V> | Err<E> | Missing<K>;

	/**
	 * Configuration options for constructing a `Batcher`.
	 */
	export type Options<K> = {
		/**
		 * Serializer used to index and deduplicate composite or structural object keys.
		 * Unnecessary for primitive keys (`string`, `number`).
		 */
		readonly serializeKey?: (key: K) => string | number;

		/**
		 * Maximum number of keys dispatched per batch query. Defaults to unbounded. A provided
		 * nonpositive or non-integer value clamps to 1; omit the option for unbounded batches.
		 */
		readonly maxBatchSize?: number;

		/**
		 * Time window across which incoming calls are buffered before dispatch.
		 * When omitted, dispatch is scheduled as a microtask. An explicit zero uses a timer.
		 */
		readonly window?: Duration;

		/**
		 * Maximum number of chunked batch queries allowed to run concurrently in flight.
		 * Defaults to unbounded concurrency. Nonpositive and non-integer values clamp to 1.
		 */
		readonly concurrency?: number;
	};
}

// =============================================================================
// Outcome Helpers & Implementation
// =============================================================================

const makeOk = <V, E = never, K = never>(value: V): Batcher.Outcome<E, V, K> => ({ kind: "BatcherOk", value });

const makeErr = <const E, V = never, K = never>(error: E): Batcher.Outcome<E, V, K> => ({ kind: "BatcherErr", error });

const makeMissing = <K, E = never, V = never>(key: K): Batcher.Outcome<E, V, K> => ({ kind: "BatcherMissing", key });

const isOk = <E, V, K>(outcome: Batcher.Outcome<E, V, K>): outcome is Batcher.Ok<V> => outcome.kind === "BatcherOk";

const isErr = <E, V, K>(outcome: Batcher.Outcome<E, V, K>): outcome is Batcher.Err<E> => outcome.kind === "BatcherErr";

const isMissing = <E, V, K>(outcome: Batcher.Outcome<E, V, K>): outcome is Batcher.Missing<K> =>
	outcome.kind === "BatcherMissing";

const matchOutcome =
	<E, V, K, B>(
		cases: { readonly ok: (value: V) => B; readonly missing: (key: K) => B; readonly err: (error: E) => B; },
	) =>
	(outcome: Batcher.Outcome<E, V, K>): B => {
		switch (outcome.kind) {
			case "BatcherOk":
				return cases.ok(outcome.value);
			case "BatcherMissing":
				return cases.missing(outcome.key);
			case "BatcherErr":
				return cases.err(outcome.error);
		}
	};

const mapOutcome =
	<V, B>(transform: (value: V) => B) =>
	<E = never, K = never>(outcome: Batcher.Outcome<E, V, K>): Batcher.Outcome<E, B, K> =>
		outcome.kind === "BatcherOk" ? makeOk(transform(outcome.value)) : outcome;

const mapErrorOutcome =
	<E, F>(transform: (error: E) => F) =>
	<V = never, K = never>(outcome: Batcher.Outcome<E, V, K>): Batcher.Outcome<F, V, K> =>
		outcome.kind === "BatcherErr" ? makeErr(transform(outcome.error)) : outcome;

const getOrElseOutcome =
	<B>(fallback: () => B) => <E = never, V = never, K = never>(outcome: Batcher.Outcome<E, V, K>): V | B =>
		outcome.kind === "BatcherOk" ? outcome.value : fallback();

const toResultOutcome =
	<K, E2>(onMissing: (key: K) => E2) => <E = never, V = never>(outcome: Batcher.Outcome<E, V, K>): Result<E | E2, V> => {
		switch (outcome.kind) {
			case "BatcherOk":
				return Result.make.ok(outcome.value);
			case "BatcherMissing":
				return Result.make.err(onMissing(outcome.key));
			case "BatcherErr":
				return Result.make.err(outcome.error);
		}
	};

const toMaybeOutcome = <E = never, V = never, K = never>(outcome: Batcher.Outcome<E, V, K>): Maybe<V> =>
	outcome.kind === "BatcherOk" ? Maybe.make.some(outcome.value) : Maybe.make.none();

const toNullableOutcome = <E = never, V = never, K = never>(outcome: Batcher.Outcome<E, V, K>): V | null =>
	outcome.kind === "BatcherOk" ? outcome.value : null;

// =============================================================================
// Batcher Engine Implementation
// =============================================================================

const defaultSerialize = <K>(key: K): unknown => key;

const getAbortReason = (signal: AbortSignal): Aborted => Aborted.make(signal.reason);

const makeBatcher = <K, E, V>(
	loadBatch: (keys: readonly K[]) => Task.Result<E, ReadonlyMap<K, V>>,
	options: Batcher.Options<K> = {},
): Batcher<K, E, V> => {
	type KeyHash = unknown;
	type Failure = E | Aborted;
	type CallerEntry = { readonly resolve: (outcome: Batcher.Outcome<Failure, V, K>) => void; };
	type ActiveBatch = { readonly controller: AbortController; activeCallers: number; };
	type PendingKeySlot = { readonly key: K; readonly callers: CallerEntry[]; batch?: ActiveBatch; };

	const serialize = options.serializeKey ?? defaultSerialize;
	const maxBatchSize = options.maxBatchSize === undefined
		? Infinity
		: Number.isInteger(options.maxBatchSize) && options.maxBatchSize > 0
		? options.maxBatchSize
		: 1;
	const concurrency = options.concurrency === undefined
		? Infinity
		: Number.isInteger(options.concurrency) && options.concurrency > 0
		? options.concurrency
		: 1;

	let queue = new Map<KeyHash, PendingKeySlot>();
	let scheduled = false;
	let timerHandle: ReturnType<typeof setTimeout> | undefined;

	let inFlightBatches = 0;
	const pendingChunks: PendingKeySlot[][] = [];
	const flushWaiters: (() => void)[] = [];

	const dispatchChunk = (chunk: PendingKeySlot[]): Promise<void> => {
		const chunkLen = chunk.length;
		const keys = new Array<K>(chunkLen);
		for (let i = 0; i < chunkLen; i++) {
			keys[i] = chunk[i].key;
		}

		// Count active un-aborted callers
		let activeCallersCount = 0;
		for (let i = 0; i < chunkLen; i++) {
			activeCallersCount += chunk[i].callers.length;
		}

		if (activeCallersCount === 0) {
			return Promise.resolve();
		}
		const batch: ActiveBatch = { controller: new AbortController(), activeCallers: activeCallersCount };
		for (let i = 0; i < chunkLen; i++) {
			chunk[i].batch = batch;
		}

		return new Promise<void>((resolveDispatch) => {
			const taskDeferred = loadBatch(keys)(batch.controller.signal);
			taskDeferred.then((batchResult) => {
				if (Result.is.err(batchResult)) {
					const errOutcome = makeErr<E, V, K>(batchResult.error);
					for (let i = 0; i < chunkLen; i++) {
						const { callers } = chunk[i];
						for (let j = 0; j < callers.length; j++) {
							callers[j].resolve(errOutcome);
						}
					}
				} else {
					const resultMap = batchResult.value;
					for (let i = 0; i < chunkLen; i++) {
						const { key, callers } = chunk[i];
						const outcome: Batcher.Outcome<Failure, V, K> = resultMap.has(key)
							? makeOk(resultMap.get(key)!)
							: makeMissing(key);

						for (let j = 0; j < callers.length; j++) {
							callers[j].resolve(outcome);
						}
					}
				}
				resolveDispatch();
			});
		});
	};

	const notifyFlushWaitersIfDone = (): void => {
		if (queue.size === 0 && pendingChunks.length === 0 && inFlightBatches === 0) {
			while (flushWaiters.length > 0) {
				const waiter = flushWaiters.shift()!;
				waiter();
			}
		}
	};

	const pumpChunks = (): void => {
		const onChunkSettled = (): void => {
			inFlightBatches--;
			pumpChunks();
			notifyFlushWaitersIfDone();
		};

		while (inFlightBatches < concurrency && pendingChunks.length > 0) {
			const nextChunk = pendingChunks.shift()!;
			inFlightBatches++;
			void dispatchChunk(nextChunk).then(onChunkSettled);
		}
		notifyFlushWaitersIfDone();
	};

	const flushQueue = (): Promise<void> => {
		if (timerHandle !== undefined) {
			clearTimeout(timerHandle);
			timerHandle = undefined;
		}
		scheduled = false;

		if (queue.size > 0) {
			const activeQueue = queue;
			queue = new Map();

			const slots = Array.from(activeQueue.values());
			const slotsLen = slots.length;

			for (let i = 0; i < slotsLen; i += maxBatchSize) {
				pendingChunks.push(slots.slice(i, i + maxBatchSize));
			}
		}

		pumpChunks();

		if (pendingChunks.length === 0 && inFlightBatches === 0) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			flushWaiters.push(resolve);
		});
	};

	const scheduleFlush = (): void => {
		if (scheduled) {
			return;
		}
		scheduled = true;

		if (options.window !== undefined) {
			const ms = Duration.to.milliseconds(options.window);
			timerHandle = setTimeout(() => {
				void flushQueue();
			}, clampTimerDelay(ms));
		} else {
			queueMicrotask(() => {
				void flushQueue();
			});
		}
	};

	const load = (key: K, signal?: AbortSignal): Deferred<Batcher.Outcome<Failure, V, K>> =>
		Deferred.from.Promise(
			new Promise<Batcher.Outcome<Failure, V, K>>((resolve) => {
				if (signal?.aborted) {
					resolve(makeErr(getAbortReason(signal)));
					return;
				}

				const hash = serialize(key);
				let slot = queue.get(hash);
				if (slot === undefined) {
					slot = { key, callers: [] };
					queue.set(hash, slot);
				}

				const currentSlot = slot;
				// The settlement and abort callbacks remove one another.
				// oxlint-disable-next-line prefer-const
				let onAbort: () => void;
				const entry: CallerEntry = {
					resolve: (outcome) => {
						signal?.removeEventListener("abort", onAbort);
						resolve(outcome);
					},
				};
				onAbort = () => {
					const { callers } = currentSlot;
					const index = callers.indexOf(entry);
					callers.splice(index, 1);
					if (callers.length === 0 && queue.get(hash) === currentSlot) {
						queue.delete(hash);
						if (queue.size === 0 && timerHandle !== undefined) {
							clearTimeout(timerHandle);
							timerHandle = undefined;
							scheduled = false;
						}
					}
					const { batch } = currentSlot;
					if (batch !== undefined) {
						batch.activeCallers--;
					}
					entry.resolve(makeErr(getAbortReason(signal!)));
					notifyFlushWaitersIfDone();
					if (batch?.activeCallers === 0) {
						batch.controller.abort();
					}
				};
				slot.callers.push(entry);
				if (signal !== undefined) {
					signal.addEventListener("abort", onAbort, { once: true });
				}

				if (queue.size >= maxBatchSize) {
					void flushQueue();
				} else {
					scheduleFlush();
				}
			}),
		);

	const loadMany = (keys: readonly K[], signal?: AbortSignal): Deferred<readonly Batcher.Outcome<Failure, V, K>[]> => {
		const len = keys.length;
		if (len === 0) {
			return Deferred.from.Promise(Promise.resolve([]));
		}

		return Deferred.from.Promise(Promise.all(keys.map((k) => Deferred.to.Promise(load(k, signal)))));
	};

	const flush = (): Deferred<void> => Deferred.from.Promise(flushQueue());

	return { load, loadMany, flush };
};

export const Batcher = {
	/**
	 * Creates a batcher for a bulk load operation and optional batching settings.
	 * The load operation receives unique keys and returns a task producing a map of found values.
	 * The task's signal is aborted when every caller in its dispatched batch cancels.
	 *
	 * @example
	 * ```ts
	 * const userBatcher = Batcher.make(
	 *   (ids: readonly string[]) => userStore.findByIds(ids),
	 *   { maxBatchSize: 100 },
	 * );
	 * ```
	 */
	make: makeBatcher,

	/**
	 * Functions for handling, checking, and converting `Batcher.Outcome` values.
	 */
	Outcome: {
		/**
		 * Constructors for creating `Batcher.Outcome` variants.
		 */
		make: {
			/**
			 * Creates a `BatcherOk` outcome.
			 *
			 * @see {@link Batcher.Outcome.make.err} to construct an error outcome.
			 * @see {@link Batcher.Outcome.make.missing} to construct an absent key outcome.
			 *
			 * @example
			 * ```ts
			 * const ok = Batcher.Outcome.make.ok({ id: "u1", name: "Alice" });
			 * ```
			 */
			ok: makeOk,

			/**
			 * Creates a `BatcherErr` outcome.
			 *
			 * @see {@link Batcher.Outcome.make.ok} to construct a successful outcome.
			 * @see {@link Batcher.Outcome.make.missing} to construct an absent key outcome.
			 *
			 * @example
			 * ```ts
			 * const err = Batcher.Outcome.make.err(new Error("DB connection lost"));
			 * ```
			 */
			err: makeErr,

			/**
			 * Creates a `BatcherMissing` outcome.
			 *
			 * @see {@link Batcher.Outcome.make.ok} to construct a successful outcome.
			 * @see {@link Batcher.Outcome.make.err} to construct an error outcome.
			 *
			 * @example
			 * ```ts
			 * const missing = Batcher.Outcome.make.missing("u_99");
			 * ```
			 */
			missing: makeMissing,
		},

		/**
		 * Type guards for checking `Batcher.Outcome` variants.
		 */
		is: {
			/**
			 * Checks whether an outcome is a `BatcherOk`.
			 *
			 * @see {@link Batcher.Outcome.is.err} to check for a query failure.
			 * @see {@link Batcher.Outcome.is.missing} to check for an absent key.
			 *
			 * @example
			 * ```ts
			 * if (Batcher.Outcome.is.ok(outcome)) {
			 *   console.log(outcome.value);
			 * }
			 * ```
			 */
			ok: isOk,

			/**
			 * Checks whether an outcome is a `BatcherErr`.
			 *
			 * @see {@link Batcher.Outcome.is.ok} to check for a resolved value.
			 * @see {@link Batcher.Outcome.is.missing} to check for an absent key.
			 *
			 * @example
			 * ```ts
			 * if (Batcher.Outcome.is.err(outcome)) {
			 *   console.error(outcome.error);
			 * }
			 * ```
			 */
			err: isErr,

			/**
			 * Checks whether an outcome is a `BatcherMissing`.
			 *
			 * @see {@link Batcher.Outcome.is.ok} to check for a resolved value.
			 * @see {@link Batcher.Outcome.is.err} to check for a query failure.
			 *
			 * @example
			 * ```ts
			 * if (Batcher.Outcome.is.missing(outcome)) {
			 *   console.warn(`Key missing: ${outcome.key}`);
			 * }
			 * ```
			 */
			missing: isMissing,
		},

		/**
		 * Handles all three outcomes (`ok`, `missing`, `err`) and returns the selected result.
		 *
		 * @see {@link Batcher.Outcome.getOrElse} to extract the value with a fallback.
		 *
		 * @example
		 * ```ts
		 * const status = pipe(
		 *   outcome,
		 *   Batcher.Outcome.match({
		 *     ok: (user) => 200,
		 *     missing: (key) => 404,
		 *     err: (error) => 500,
		 *   }),
		 * );
		 * ```
		 */
		match: matchOutcome,

		/**
		 * Transforms the value inside a `BatcherOk` outcome. Leaves `Missing` and `Err` unchanged.
		 *
		 * @see {@link Batcher.Outcome.mapError} to transform the error channel instead.
		 *
		 * @example
		 * ```ts
		 * const nameOutcome = pipe(outcome, Batcher.Outcome.map((user) => user.name));
		 * ```
		 */
		map: mapOutcome,

		/**
		 * Transforms the error inside a `BatcherErr` outcome. Leaves `Ok` and `Missing` unchanged.
		 *
		 * @see {@link Batcher.Outcome.map} to transform the value channel instead.
		 *
		 * @example
		 * ```ts
		 * const mapped = pipe(outcome, Batcher.Outcome.mapError((err) => new CustomError(err)));
		 * ```
		 */
		mapError: mapErrorOutcome,

		/**
		 * Returns the value if `BatcherOk`, otherwise returns the fallback value.
		 *
		 * @see {@link Batcher.Outcome.match} to handle all three cases explicitly.
		 *
		 * @example
		 * ```ts
		 * const user = pipe(outcome, Batcher.Outcome.getOrElse(() => defaultGuestUser));
		 * ```
		 */
		getOrElse: getOrElseOutcome,

		/**
		 * Converters from `Batcher.Outcome` to standard library and native representations.
		 */
		to: {
			/**
			 * Converts a `Batcher.Outcome` to a `Result`, using a callback to turn a missing key into an error.
			 *
			 * @see {@link Batcher.Outcome.to.Maybe} to convert to an optional value.
			 *
			 * @example
			 * ```ts
			 * const res = pipe(
			 *   outcome,
			 *   Batcher.Outcome.to.Result((id) => ({ kind: "UserNotFound" as const, id })),
			 * );
			 * ```
			 */
			Result: toResultOutcome,

			/**
			 * Converts a `Batcher.Outcome` to a `Maybe`, mapping `BatcherOk` to `Some` and both
			 * `BatcherMissing` and `BatcherErr` to `None`.
			 *
			 * @see {@link Batcher.Outcome.to.Result} to convert to a fallible Result.
			 *
			 * @example
			 * ```ts
			 * const maybe = pipe(outcome, Batcher.Outcome.to.Maybe);
			 * ```
			 */
			Maybe: toMaybeOutcome,

			/**
			 * Converts a `Batcher.Outcome` to a nullable value (`V | null`), mapping `BatcherOk`
			 * to `V` and both `BatcherMissing` and `BatcherErr` to `null`.
			 *
			 * @see {@link Batcher.Outcome.to.Maybe} to convert to a type-safe Maybe.
			 *
			 * @example
			 * ```ts
			 * const userOrNull = pipe(outcome, Batcher.Outcome.to.nullable);
			 * ```
			 */
			nullable: toNullableOutcome,
		},
	},
};
