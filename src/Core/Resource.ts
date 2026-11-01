import { WithKind } from "../internal/InternalTypes";
import { Deferred } from "./Deferred.ts";
import { Result } from "./Result.ts";
import { type Task } from "./Task.ts";

/**
 * A Resource encapsulates an async acquisition step paired with a guaranteed cleanup step.
 *
 * Use it whenever external assets must be safely opened and closed — database
 * connections, file descriptors, advisory locks, network sockets, or child processes.
 *
 * The core guarantee: release finalizers always run in reverse (LIFO) acquisition order upon
 * completion or failure of `Resource.use`. If an acquisition step fails midway during multi-resource
 * setup, already-acquired resources are immediately rolled back.
 *
 * Build a Resource with `Resource.make`, `Resource.from.Task`, or `Resource.all`, compose
 * dependencies with `Resource.chain` and `Resource.map`, and run the lifecycle with `Resource.use`.
 *
 * @example
 * ```ts
 * const dbResource = Resource.make(
 *   Task.Result.tryCatch(() => openConnection(config), { onError: (e) => new DbError(e) }),
 *   (conn) => Task.tryCatch(() => conn.close(), { onError: () => {} }),
 * );
 *
 * const result = await pipe(
 *   dbResource,
 *   Resource.use((conn) => queryUser(conn, userId)),
 * )();
 * // conn.close() is guaranteed to run whether queryUser succeeds, fails, or throws
 * ```
 */
declare const _resourceBrand: unique symbol;

export type Resource<E, A> = WithKind<"Resource"> & {
	readonly [_resourceBrand]: { readonly _error: () => E; readonly _value: () => A; };
};

const _allocate = Symbol("Resource.allocate");

type ResourceExecutionError = {
	readonly kind: "ResourceUnexpected";
	readonly phase: "acquire" | "use";
	readonly cause: unknown;
};

export namespace Resource {
	/** An unexpected exception from acquisition, work, or cleanup.
	 * Cleanup failures retain the preceding result and any additional cleanup exceptions.
	 */
	export type Unexpected<E = unknown, A = unknown> = ResourceExecutionError | {
		readonly kind: "ResourceUnexpected";
		readonly phase: "release";
		readonly cause: unknown;
		readonly additionalErrors: readonly unknown[];
		readonly previous: Result<E | ResourceExecutionError, A>;
	};
}

type Finalizer = (signal?: AbortSignal) => Deferred<unknown>;

type Scope = {
	readonly addFinalizer: (finalizer: Finalizer) => void;
	readonly close: (signal?: AbortSignal) => Promise<readonly unknown[]>;
};

type InternalResource<E, A> = Resource<E, A> & {
	readonly [_allocate]: (scope: Scope, signal?: AbortSignal) => Promise<Result<E, A>>;
};

const toInternal = <E, A>(resource: Resource<E, A>): InternalResource<E, A> =>
	resource as unknown as InternalResource<E, A>;

const makeInternalResource = <E, A>(
	allocate: (scope: Scope, signal?: AbortSignal) => Promise<Result<E, A>>,
): Resource<E, A> => ({ kind: "Resource", [_allocate]: allocate }) as unknown as Resource<E, A>;

type InferError<T> = [T] extends [readonly []] ? never
	: [T] extends [readonly Resource<any, any>[]]
		? [T[number]] extends [never] ? never : T[number] extends Resource<infer E, any> ? E : never
	: T extends Readonly<Record<string, Resource<any, any>>>
		? { [K in keyof T]: T[K] extends Resource<infer E, any> ? E : never; }[keyof T]
	: never;

type InferValue<T> = T extends readonly Resource<any, any>[]
	? { readonly [K in keyof T]: T[K] extends Resource<any, infer A> ? A : never; }
	: T extends Readonly<Record<string, Resource<any, any>>>
		? { readonly [K in keyof T]: T[K] extends Resource<any, infer A> ? A : never; }
	: never;

const createScope = (): Scope => {
	const finalizers: Finalizer[] = [];
	return {
		addFinalizer: (finalizer) => {
			finalizers.push(finalizer);
		},
		close: async (signal) => {
			const errors: unknown[] = [];
			for (let i = finalizers.length - 1; i >= 0; i--) {
				try {
					await Deferred.to.Promise(finalizers[i](signal));
				} catch (error) {
					errors.push(error);
				}
			}
			return errors;
		},
	};
};

const makeResource = <E, A>(acquire: Task.Result<E, A>, release: (value: A) => Task<unknown>): Resource<E, A> =>
	makeInternalResource(async (scope, signal) => {
		const acquired = await Deferred.to.Promise(acquire(signal));
		if (Result.is.ok(acquired)) {
			const { value } = acquired;
			scope.addFinalizer((sig) => release(value)(sig));
		}
		return acquired;
	});

const makeTask = <A, E = never>(acquire: Task<A>, release: (value: A) => Task<unknown>): Resource<E, A> =>
	makeInternalResource(async (scope, signal) => {
		const value = await Deferred.to.Promise(acquire(signal));
		scope.addFinalizer((sig) => release(value)(sig));
		return Result.make.ok(value);
	});

const use =
	<A, E2, B>(consume: (value: A) => Task.Result<E2, B>) =>
	<E1 = never>(resource: Resource<E1, A>): Task.Result<E1 | E2 | Resource.Unexpected<E1 | E2, B>, B> =>
	(signal) =>
		Deferred.from.Promise((async () => {
			const scope = createScope();
			let phase: "acquire" | "use" = "acquire";
			let outcome: Result<E1 | E2 | ResourceExecutionError, B>;
			try {
				const acquired = await toInternal(resource)[_allocate](scope, signal);
				if (Result.is.err(acquired)) {
					outcome = acquired;
				} else {
					phase = "use";
					outcome = await Deferred.to.Promise(consume(acquired.value)(signal));
				}
			} catch (cause) {
				outcome = Result.make.err({ kind: "ResourceUnexpected", phase, cause });
			}
			const cleanupErrors = await scope.close(signal);
			if (cleanupErrors.length > 0) {
				return Result.make.err({
					kind: "ResourceUnexpected" as const,
					phase: "release" as const,
					cause: cleanupErrors[0],
					additionalErrors: cleanupErrors.slice(1),
					previous: outcome,
				});
			}
			return outcome;
		})());

const map = <A, B>(transform: (value: A) => B) => <E = never>(resource: Resource<E, A>): Resource<E, B> =>
	makeInternalResource(async (scope, signal) => {
		const acquired = await toInternal(resource)[_allocate](scope, signal);
		return Result.is.err(acquired) ? acquired : Result.make.ok(transform(acquired.value));
	});

const chain =
	<A, E2, B>(transform: (value: A) => Resource<E2, B>) =>
	<E1 = never>(resource: Resource<E1, A>): Resource<E1 | E2, B> =>
		makeInternalResource<E1 | E2, B>(async (scope, signal) => {
			const acquired = await toInternal(resource)[_allocate](scope, signal);
			return Result.is.err(acquired) ? acquired : toInternal(transform(acquired.value))[_allocate](scope, signal);
		});

const combine = <E1, A, E2, B>(
	resourceA: Resource<E1, A>,
	resourceB: Resource<E2, B>,
): Resource<E1 | E2, readonly [A, B]> =>
	makeInternalResource<E1 | E2, readonly [A, B]>(async (scope, signal) => {
		const acquiredA = await toInternal(resourceA)[_allocate](scope, signal);
		if (Result.is.err(acquiredA)) { return acquiredA; }
		const acquiredB = await toInternal(resourceB)[_allocate](scope, signal);
		if (Result.is.err(acquiredB)) { return acquiredB; }
		return Result.make.ok([acquiredA.value, acquiredB.value] as const);
	});

const all = <const R extends Readonly<Record<string, Resource<any, any>>> | readonly Resource<any, any>[]>(
	resources: R,
): Resource<InferError<R>, InferValue<R>> =>
	makeInternalResource<InferError<R>, InferValue<R>>(async (scope, signal) => {
		if (Array.isArray(resources)) {
			const results = new Array<unknown>(resources.length);
			for (let i = 0; i < resources.length; i++) {
				const acquired = await toInternal(resources[i])[_allocate](scope, signal);
				if (Result.is.err(acquired)) { return acquired as Result<InferError<R>, InferValue<R>>; }
				results[i] = acquired.value;
			}
			return Result.make.ok(results) as unknown as Result<InferError<R>, InferValue<R>>;
		}

		const record = resources as Readonly<Record<string, Resource<any, any>>>;
		const keys = Object.keys(record);
		const results: Record<string, unknown> = {};
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const acquired = await toInternal(record[key])[_allocate](scope, signal);
			if (Result.is.err(acquired)) { return acquired as Result<InferError<R>, InferValue<R>>; }
			if (key === "__proto__") {
				Object.defineProperty(results, key, {
					value: acquired.value,
					writable: true,
					enumerable: true,
					configurable: true,
				});
			} else {
				results[key] = acquired.value;
			}
		}
		return Result.make.ok(results) as Result<InferError<R>, InferValue<R>>;
	});

export const Resource = {
	/**
	 * Creates a Resource from an acquire operation that may fail and a release finalizer.
	 *
	 * @see {@link Resource.from.Task} for creating resources with infallible acquisition.
	 * @example
	 * ```ts
	 * const fileResource = Resource.make(
	 *   Task.Result.tryCatch(() => fs.promises.open("data.csv", "r"), { onError: toFileError }),
	 *   (handle) => Task.tryCatch(() => handle.close(), { onError: () => {} }),
	 * );
	 * ```
	 */
	make: makeResource,

	// --- from ---
	from: {
		/**
		 * Creates a Resource from an acquire operation that cannot fail.
		 * Use this when opening the resource is guaranteed to succeed, such as
		 * in-memory locks, counters, or timers.
		 *
		 * @see {@link Resource.make} for creating resources with fallible acquisition.
		 * @example
		 * ```ts
		 * const timerResource = Resource.from.Task(
		 *   Task.tryCatch(() => Promise.resolve(startTimer()), { onError: () => defaultTimer }),
		 *   (timer) => Task.tryCatch(() => Promise.resolve(timer.stop()), { onError: () => {} }),
		 * );
		 * ```
		 */
		Task: makeTask,
	},

	/**
	 * Acquires the resource, runs `consume` with it, then releases it.
	 *
	 * Release runs even when acquisition or work throws. Unexpected exceptions are returned
	 * as `Resource.Unexpected`, identifying the phase and retaining the original cause.
	 * Cleanup runs in reverse order even if a release throws. If cleanup fails, the error
	 * includes the preceding outcome and any additional cleanup exceptions.
	 * If acquisition returns an error, work and the failed resource's release are skipped.
	 *
	 * @example
	 * ```ts
	 * const rows = await pipe(
	 *   dbResource,
	 *   Resource.use((conn) => runQuery(conn, "SELECT * FROM users")),
	 * )();
	 * // conn is closed whether the query succeeds, fails, or throws
	 * ```
	 */
	use,

	/**
	 * Transforms the value of an acquired resource while retaining guaranteed cleanup of the original asset.
	 *
	 * If `transform` throws, `Resource.use` releases the acquired resource and returns a
	 * `Resource.Unexpected` error.
	 *
	 * @see {@link Resource.chain} for sequencing dependent resource acquisitions.
	 * @example
	 * ```ts
	 * const clientResource = pipe(
	 *   connectCluster(clusterConfig),
	 *   Resource.map((cluster) => cluster.getClient("analytics")),
	 * );
	 * ```
	 */
	map,

	/**
	 * Sequentially acquires a second resource that depends on the value of the first.
	 *
	 * If acquiring the second resource fails or throws, `Resource.use` releases the first resource before returning
	 * the error. When `Resource.use` completes, both resources are released in reverse (LIFO) order: the second is
	 * released before the first.
	 *
	 * @see {@link Resource.map} for transforming acquired values without opening a new resource.
	 * @example
	 * ```ts
	 * const dbWithLock = pipe(
	 *   connectPostgres(dbConfig),
	 *   Resource.chain((db) =>
	 *     pipe(
	 *       acquireAdvisoryLock(db, "migrations"),
	 *       Resource.map((lock) => ({ db, lock })),
	 *     ),
	 *   ),
	 * );
	 * ```
	 */
	chain,

	/**
	 * Acquires two resources in sequence and presents them as a tuple.
	 *
	 * Resources are released in reverse order: the second is released before the first.
	 * If the second resource fails to acquire or throws, the first is released before
	 * `Resource.use` returns the error.
	 *
	 * @see {@link Resource.all} for acquiring arbitrary tuples or named records of resources.
	 * @example
	 * ```ts
	 * const combined = Resource.combine(dbResource, cacheResource);
	 *
	 * const result = await pipe(
	 *   combined,
	 *   Resource.use(([conn, cache]) => lookupWithFallback(conn, cache, userId)),
	 * )();
	 * ```
	 */
	combine,

	/**
	 * Sequentially acquires an array/tuple or named record of resources.
	 *
	 * All resources are released in strict reverse (LIFO) order upon completion.
	 * If the K-th resource fails to acquire or throws, all already-acquired resources (K-1 ... 0)
	 * are released in reverse order before `Resource.use` returns the error.
	 *
	 * @see {@link Resource.combine} for binary resource pairing.
	 * @example
	 * ```ts
	 * // Tuple acquisition:
	 * const infraTuple = Resource.all([dbResource, redisResource, lockResource]);
	 *
	 * // Named record acquisition:
	 * const appInfra = Resource.all({
	 *   db: connectDb(dbConfig),
	 *   redis: connectRedis(redisConfig),
	 *   s3: createTempBucket(s3Config),
	 * });
	 *
	 * const result = await pipe(
	 *   appInfra,
	 *   Resource.use(({ db, redis, s3 }) => runMigration(db, redis, s3)),
	 * )();
	 * ```
	 */
	all,
};
