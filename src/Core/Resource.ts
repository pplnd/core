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
 * Build a Resource with `Resource.make` or `Resource.all`, compose
 * dependencies with `Resource.chain` and `Resource.map`, and run the lifecycle with `Resource.use`.
 *
 * @example
 * ```ts
 * const dbResource = Resource.make(
 *   Task.Result.tryCatch(() => openConnection(config), { onError: (e) => new DbError(e) }),
 *   (conn) => Task.tryCatch(() => conn.close(), { onError: () => {} }),
 * );
 *
 * const result = await Resource.use(dbResource, {
 *   run: (conn) => queryUser(conn, userId),
 * });
 * // conn.close() runs after queryUser succeeds or returns an error
 * ```
 */
declare const _resourceBrand: unique symbol;

export type Resource<E, A> = WithKind<"Resource"> & {
	readonly [_resourceBrand]: { readonly _error: () => E; readonly _value: () => A; };
};

const _allocate = Symbol("Resource.allocate");

type Finalizer = (signal?: AbortSignal) => Deferred<unknown>;

type Scope = {
	readonly addFinalizer: (finalizer: Finalizer) => void;
	readonly close: (signal?: AbortSignal) => Promise<void>;
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
			for (let i = finalizers.length - 1; i >= 0; i--) {
				await Deferred.to.Promise(finalizers[i](signal));
			}
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

const use = <E1, A, E2, B>(
	resource: Resource<E1, A>,
	options: { readonly run: (value: A) => Task.Result<E2, B>; readonly signal?: AbortSignal; },
): Deferred<Result<E1 | E2, B>> =>
	Deferred.from.Promise((async () => {
		const { signal } = options;
		const scope = createScope();
		const acquired = await toInternal(resource)[_allocate](scope, signal);
		const outcome = Result.is.err(acquired) ? acquired : await Deferred.to.Promise(options.run(acquired.value)(signal));
		await scope.close(signal);
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
			results[key] = acquired.value;
		}
		return Result.make.ok(results) as Result<InferError<R>, InferValue<R>>;
	});

export const Resource = {
	/**
	 * Creates a Resource from an acquire operation that may fail and a release finalizer.
	 *
	 * Convert an infallible acquisition with `Task.Result.from.Task` before passing it here.
	 * @example
	 * ```ts
	 * const fileResource = Resource.make(
	 *   Task.Result.tryCatch(() => fs.promises.open("data.csv", "r"), { onError: toFileError }),
	 *   (handle) => Task.tryCatch(() => handle.close(), { onError: () => {} }),
	 * );
	 * ```
	 */
	make: makeResource,

	/**
	 * Acquires the resource, runs the supplied work, then releases it.
	 *
	 * Successfully acquired resources are released in reverse order when acquisition or work
	 * returns an error. If acquisition returns an error, work and its release are skipped.
	 * Release tasks and callbacks must not throw or reject.
	 *
	 * @example
	 * ```ts
	 * const rows = await Resource.use(dbResource, {
	 *   run: (conn) => runQuery(conn, "SELECT * FROM users"),
	 * });
	 * // conn is closed whether the query succeeds or returns an error
	 * ```
	 */
	use,

	/**
	 * Transforms the value of an acquired resource while retaining guaranteed cleanup of the original asset.
	 *
	 * The transform must not throw.
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
	 * If acquiring the second resource returns an error, `Resource.use` releases the first resource before returning
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
	 * If the second resource fails to acquire, the first is released before
	 * `Resource.use` returns the error.
	 *
	 * @see {@link Resource.all} for acquiring arbitrary tuples or named records of resources.
	 * @example
	 * ```ts
	 * const combined = Resource.combine(dbResource, cacheResource);
	 *
	 * const result = await Resource.use(combined, {
	 *   run: ([conn, cache]) => lookupWithFallback(conn, cache, userId),
	 * });
	 * ```
	 */
	combine,

	/**
	 * Sequentially acquires an array/tuple or named record of resources.
	 *
	 * All resources are released in strict reverse (LIFO) order upon completion.
	 * If the K-th resource fails to acquire, all already-acquired resources (K-1 ... 0)
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
	 * const result = await Resource.use(appInfra, {
	 *   run: ({ db, redis, s3 }) => runMigration(db, redis, s3),
	 * });
	 * ```
	 */
	all,
};
