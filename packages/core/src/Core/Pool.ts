import type { WithKind } from "../internal/InternalTypes";
import { toPositiveInteger } from "../internal/Numbers";
import { clampTimerDelay } from "../internal/timers.ts";
import { Duration } from "../Types/Duration.ts";
import { Aborted } from "./Aborted.ts";
import { Deferred } from "./Deferred.ts";
import { Result } from "./Result.ts";
import type { Task } from "./Task.ts";

declare const _poolBrand: unique symbol;

type PoolError<E> = E | Pool.Timeout | Pool.Closed | Aborted;

/**
 * A pool that creates expensive items once and hands them out for exclusive use, instead of
 * opening one per call.
 *
 * `acquire` grants a lease: an idle item if one exists, a new item while the pool is under
 * `maxSize`, otherwise a FIFO-waiting promise. `lease.release()` returns the item for reuse;
 * `lease.release({ broken: true })` destroys it instead, so a connection that errored mid-use
 * is never handed to the next caller. Idle items are evicted after `idleTimeout`, items are
 * destroyed after `maxLifetime` even when healthy, and `close()` waits for in-flight leases
 * before destroying everything.
 *
 * @example
 * ```ts
 * const pool = Pool.make<DbError, DbClient>({
 *   acquire: Task.Result.tryCatch((signal) => openDb(config, signal), { onError: (e) => new DbError(e) }),
 *   destroy: (client) => Task.tryCatch(() => client.close(), { onError: () => {} }),
 *   maxSize: 10,
 *   idleTimeout: Duration.seconds(30),
 * });
 *
 * const outcome = await pool.acquire();
 * if (Result.is.ok(outcome)) {
 *   const query = await Deferred.to.Promise(runQuery(outcome.value.item, sql));
 *   await Deferred.to.Promise(outcome.value.release({ broken: Result.is.err(query) }));
 * }
 * ```
 */
export type Pool<E, A> = WithKind<"Pool"> & {
	readonly [_poolBrand]: { readonly _error: () => E; readonly _value: () => A; };

	/**
	 * Checks an item out for exclusive use.
	 *
	 * Settles with a lease, or with `Pool.Timeout` when `acquireTimeout` elapses while waiting,
	 * `Pool.Closed` after `close()`, or `Aborted` when the caller's signal is already aborted or
	 * aborts while waiting. Bounding a single item creation's runtime is the job of
	 * `Task.Result.timeout` around the `acquire` task.
	 *
	 * @see {@link Pool.Lease.release} to return or discard the item.
	 */
	readonly acquire: (options?: { readonly signal?: AbortSignal; }) => Deferred<Result<PoolError<E>, Pool.Lease<A>>>;

	/**
	 * Stops granting leases, waits for in-flight leases to return, destroys every remaining
	 * item, and settles. Queued waiters settle with `Pool.Closed`.
	 *
	 * @see {@link Pool.acquire} to check an item out.
	 */
	readonly close: () => Deferred<void>;

	/**
	 * Returns the current lifecycle state.
	 *
	 * @see {@link Pool.subscribe} to react to changes instead of reading them.
	 */
	readonly state: () => Pool.State;

	/**
	 * Observes state transitions. Listeners must not throw.
	 *
	 * @see {@link Pool.state} to read the current state without subscribing.
	 *
	 * @param listener - The callback invoked with each new state.
	 */
	readonly subscribe: (listener: (state: Pool.State) => void) => () => void;
};

export namespace Pool {
	/**
	 * Engine configuration. `destroy` is infallible by contract: expected close failures are
	 * handled inside the destroy task, and the pool never exposes a destroy error.
	 */
	export type Options<E, A> = {
		/** The item factory, run when the pool is under `maxSize` and no idle item exists. */
		readonly acquire: Task.Result<E, A>;
		/** Infallible; expected close failures are handled inside. */
		readonly destroy: (item: A) => Task<unknown>;
		/** How many items may exist at once. A positive integer; other values clamp to one. */
		readonly maxSize: number;
		/** Destroys items idle beyond this duration. */
		readonly idleTimeout?: Duration;
		/** Destroys items returned after this lifetime, even when healthy. */
		readonly maxLifetime?: Duration;
		/** How long a queued caller waits before settling with `Pool.Timeout`. */
		readonly acquireTimeout?: Duration;
	};

	/** The caller waited longer than `acquireTimeout` for a lease. */
	export type Timeout = WithKind<"PoolTimeout">;

	/**
	 * The pool was closed: settled to queued waiters as an error, and reported by `state()` as
	 * the terminal state.
	 */
	export type Closed = WithKind<"PoolClosed">;

	/**
	 * An exclusive checkout of one pool item. The lease is opaque outside `item` and `release`.
	 */
	export type Lease<A> = {
		readonly item: A;
		/**
		 * Returns the item to the idle set for reuse, or destroys it when `broken` is set — a
		 * connection that errored mid-use is never handed to the next caller. An item returned
		 * after `maxLifetime` is destroyed too, even when healthy. Settles once the item is back
		 * in the pool or its destroy task has settled.
		 */
		readonly release: (options?: { readonly broken?: boolean; }) => Deferred<void>;
	};

	/**
	 * The pool has no items and no waiters.
	 */
	export type Idle = WithKind<"PoolIdle">;

	/**
	 * The pool is operating: items exist or callers are waiting.
	 */
	export type Active = WithKind<"PoolActive"> & {
		readonly available: number;
		readonly inUse: number;
		readonly waiting: number;
	};

	export type State = Idle | Active | Closed;
}

type ItemHandle<A> = {
	readonly item: A;
	readonly createdAt: number;
	idleTimer: ReturnType<typeof setTimeout> | undefined;
};

type Waiter<E, A> = {
	readonly resolve: (result: Result<PoolError<E>, Pool.Lease<A>>) => void;
	readonly signal: AbortSignal | undefined;
	abortListener: (() => void) | undefined;
	timeoutTimer: ReturnType<typeof setTimeout> | undefined;
};

const poolClosed: Pool.Closed = { kind: "PoolClosed" };
const poolTimeout: Pool.Timeout = { kind: "PoolTimeout" };

const makePool = <E, A>(options: Pool.Options<E, A>): Pool<E, A> => {
	const maxSize = toPositiveInteger(options.maxSize) ?? 1;
	const destroyTask = options.destroy;
	const idleTimeoutMs = options.idleTimeout === undefined
		? undefined
		: Math.max(0, Duration.to.milliseconds(options.idleTimeout));
	const maxLifetimeMs = options.maxLifetime === undefined
		? undefined
		: Math.max(0, Duration.to.milliseconds(options.maxLifetime));
	const acquireTimeoutMs = options.acquireTimeout === undefined
		? undefined
		: Math.max(0, Duration.to.milliseconds(options.acquireTimeout));

	let isClosed = false;
	let inUse = 0;
	let creating = 0;
	const idle: Array<ItemHandle<A>> = [];
	const waiters: Array<Waiter<E, A>> = [];
	const creatingWaiters: Array<Waiter<E, A>> = [];
	const subscribers = new Set<(state: Pool.State) => void>();

	// `destroy` maps an item to a task definition; run it and settle when the destroy settles.
	const runDestroy = (item: A): Promise<unknown> => Deferred.to.Promise(destroyTask(item)());

	const snapshot = (): Pool.State => {
		if (isClosed) {
			return poolClosed;
		}
		if (idle.length === 0 && inUse === 0 && creating === 0 && waiters.length === 0) {
			return { kind: "PoolIdle" };
		}
		return { kind: "PoolActive", available: idle.length, inUse, waiting: waiters.length };
	};

	const notify = (): void => {
		if (subscribers.size === 0) {
			return;
		}
		const current = snapshot();
		for (const listener of Array.from(subscribers)) {
			listener(current);
		}
	};

	const clearIdleTimer = (handle: ItemHandle<A>): void => {
		if (handle.idleTimer !== undefined) {
			clearTimeout(handle.idleTimer);
			handle.idleTimer = undefined;
		}
	};

	const removeWaiter = (waiter: Waiter<E, A>): void => {
		const idx = waiters.indexOf(waiter);
		if (idx !== -1) {
			waiters.splice(idx, 1);
		}
		if (waiter.timeoutTimer !== undefined) {
			clearTimeout(waiter.timeoutTimer);
			waiter.timeoutTimer = undefined;
		}
		if (waiter.signal !== undefined && waiter.abortListener !== undefined) {
			waiter.signal.removeEventListener("abort", waiter.abortListener);
			waiter.abortListener = undefined;
		}
	};

	const settleWaiter = (waiter: Waiter<E, A>, result: Result<PoolError<E>, Pool.Lease<A>>): void => {
		removeWaiter(waiter);
		const creatingIdx = creatingWaiters.indexOf(waiter);
		if (creatingIdx !== -1) {
			creatingWaiters.splice(creatingIdx, 1);
		}
		waiter.resolve(result);
		notify();
	};

	// Grant and handoff recurse into each other; function declarations hoist, so the pair can
	// reference each other without a use-before-define violation.
	function grantLease(handle: ItemHandle<A>, waiter: Waiter<E, A>): void {
		clearIdleTimer(handle);
		inUse++;
		settleWaiter(
			waiter,
			Result.make.ok({
				item: handle.item,
				release: (releaseOptions) =>
					Deferred.from.Promise((() => {
						inUse--;
						const broken = releaseOptions?.broken === true;
						const expired = maxLifetimeMs !== undefined && Date.now() - handle.createdAt >= maxLifetimeMs;
						if (broken || isClosed || expired) {
							// The item leaves the pool for good; the notification lets a pending close()
							// see the drain and a queued waiter receive an idle handoff.
							return runDestroy(handle.item).then(() => {
								notify();
								// oxlint-disable-next-line no-use-before-define -- mutual recursion with grantLease
								handOffIfPossible();
								return undefined;
							});
						}
						idle.push(handle);
						// oxlint-disable-next-line no-use-before-define -- defined below; timers are armed only after the lease is out
						armIdleEviction(handle);
						notify();
						// oxlint-disable-next-line no-use-before-define -- mutual recursion with grantLease
						handOffIfPossible();
						return Promise.resolve();
					})()),
			}),
		);
	}

	function handOffIfPossible(): void {
		if (isClosed) {
			return;
		}
		while (idle.length > 0 && waiters.length > 0) {
			const waiter = waiters[0] as Waiter<E, A>;
			const handle = idle.shift() as ItemHandle<A>;
			grantLease(handle, waiter);
		}
	}

	const armIdleEviction = (handle: ItemHandle<A>): void => {
		if (idleTimeoutMs === undefined) {
			return;
		}
		handle.idleTimer = setTimeout(() => {
			handle.idleTimer = undefined;
			// The timer only survives while the item is idle — grantLease clears it on checkout —
			// so the handle is always still in the idle set here.
			const idx = idle.indexOf(handle);
			idle.splice(idx, 1);
			void runDestroy(handle.item);
			notify();
			handOffIfPossible();
		}, clampTimerDelay(idleTimeoutMs));
	};

	const enqueueWaiter = (waiter: Waiter<E, A>): void => {
		waiters.push(waiter);
		if (acquireTimeoutMs !== undefined) {
			waiter.timeoutTimer = setTimeout(() => {
				settleWaiter(waiter, Result.make.err(poolTimeout));
			}, clampTimerDelay(acquireTimeoutMs));
		}
		if (waiter.signal !== undefined) {
			// A signal that is already aborted never reaches the queue: acquire() rejects it before
			// enqueueing, so the listener here only observes an abort during the wait.
			waiter.abortListener = () => {
				settleWaiter(waiter, Result.make.err(Aborted.make(waiter.signal!.reason)));
			};
			waiter.signal.addEventListener("abort", waiter.abortListener, { once: true });
		}
		notify();
	};

	const acquire = (callerOptions?: { readonly signal?: AbortSignal; }): Deferred<Result<PoolError<E>, Pool.Lease<A>>> =>
		Deferred.from.Promise(
			new Promise<Result<PoolError<E>, Pool.Lease<A>>>((resolve) => {
				const signal = callerOptions?.signal;
				if (isClosed) {
					resolve(Result.make.err(poolClosed));
					return;
				}
				if (signal?.aborted) {
					resolve(Result.make.err(Aborted.make(signal.reason)));
					return;
				}

				const waiter: Waiter<E, A> = { resolve, signal, abortListener: undefined, timeoutTimer: undefined };

				const idleHandle = idle.shift();
				if (idleHandle !== undefined) {
					grantLease(idleHandle, waiter);
					return;
				}

				if (idle.length + inUse + creating < maxSize) {
					// Reserve the slot before the asynchronous creation so concurrent callers cannot
					// oversubscribe `maxSize`. The waiter is tracked separately from the queue: it
					// waits for its own creation, not for an idle handoff, and `acquireTimeout`
					// bounds queued callers only.
					creating++;
					creatingWaiters.push(waiter);
					notify();
					void Deferred.to.Promise(options.acquire(signal)).then((created) => {
						creating--;
						if (isClosed) {
							if (Result.is.ok(created)) {
								void runDestroy(created.value);
							}
							notify();
							return;
						}
						if (Result.is.err(created)) {
							notify();
							settleWaiter(waiter, Result.make.err(created.error));
							return;
						}
						grantLease({ item: created.value, createdAt: Date.now(), idleTimer: undefined }, waiter);
					});
					return;
				}

				enqueueWaiter(waiter);
			}),
		);

	const subscribe = (listener: (state: Pool.State) => void): () => void => {
		subscribers.add(listener);
		return () => {
			subscribers.delete(listener);
		};
	};

	const close = (): Deferred<void> =>
		Deferred.from.Promise((() => {
			isClosed = true;
			for (let i = waiters.length - 1; i >= 0; i--) {
				const waiter = waiters[i] as Waiter<E, A>;
				removeWaiter(waiter);
				waiter.resolve(Result.make.err(poolClosed));
			}
			for (let i = creatingWaiters.length - 1; i >= 0; i--) {
				const waiter = creatingWaiters[i] as Waiter<E, A>;
				creatingWaiters.splice(i, 1);
				waiter.resolve(Result.make.err(poolClosed));
			}
			notify();

			const destroyAll = (): void => {
				while (idle.length > 0) {
					const handle = idle.shift() as ItemHandle<A>;
					void runDestroy(handle.item);
				}
				notify();
			};

			if (inUse === 0) {
				destroyAll();
				return Promise.resolve();
			}

			// In-flight leases are destroyed on release instead of returning to the idle set; the
			// close wait settles when the last release brings `inUse` back to zero.
			return new Promise<void>((resolve) => {
				const onDrained = (): void => {
					if (isClosed && inUse === 0) {
						// oxlint-disable-next-line no-use-before-define -- subscribe() assigns this before any drain notification can fire
						unsubscribe();
						destroyAll();
						resolve();
					}
				};
				const unsubscribe = subscribe(onDrained);
			});
		})());

	return { kind: "Pool", acquire, close, state: () => snapshot(), subscribe } as unknown as Pool<E, A>;
};

export const Pool = {
	/**
	 * Creates a pool around an item factory and an infallible destroy task.
	 *
	 * @see {@link Pool.acquire} to check an item out.
	 * @see {@link Resource} for a single acquisition bracket with guaranteed LIFO release, when
	 *     the item's lifetime is one operation instead of many checkouts.
	 *
	 * @example
	 * ```ts
	 * const pool = Pool.make<DbError, DbClient>({
	 *   acquire: Task.Result.tryCatch((signal) => openDb(config, signal), { onError: (e) => new DbError(e) }),
	 *   destroy: (client) => Task.tryCatch(() => client.close(), { onError: () => {} }),
	 *   maxSize: 10,
	 * });
	 * ```
	 */
	make: makePool,
};
