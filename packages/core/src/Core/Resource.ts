import type { WithKind } from "../internal/InternalTypes";
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
 *   run: (conn: DbClient) => queryUser(conn, userId),
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

const makeResource = <E, A>(acquire: Task.Result<E, A>, release: (value: A) => Task<unknown>): Resource<E, A> =>
	makeInternalResource(async (scope, signal) => {
		const acquired = await Deferred.to.Promise(acquire(signal));
		if (Result.is.ok(acquired)) {
			const { value } = acquired;
			scope.addFinalizer((sig) => release(value)(sig));
		}
		return acquired;
	});

const _scopeBrand = Symbol("Resource.scope");
const _scopeState = Symbol("Resource.scopeState");

type ScopeState = Scope & {
	queue: Promise<unknown>;
	readonly isClosed: () => boolean;
	readonly markClosed: () => void;
};

type InternalScope = Resource.Scope & {
	readonly [_scopeState]: ScopeState;
	dispose: (options?: { readonly signal?: AbortSignal; }) => Deferred<void>;
	[Symbol.asyncDispose]: () => Promise<void>;
};

const toInternalScope = (scope: Resource.Scope): InternalScope => scope as unknown as InternalScope;

const makeScope = (): Resource.Scope => {
	let finalizers: Finalizer[] = [];
	let closed = false;
	const state: ScopeState = {
		addFinalizer: (finalizer) => {
			if (closed) {
				// Late registration: disposal raced an in-flight acquisition (e.g. StrictMode's
				// mount → unmount → remount). The caller must never observe a held resource
				// past disposal, so the finalizer runs immediately.
				void Deferred.to.Promise(finalizer());
				return;
			}
			finalizers.push(finalizer);
		},
		close: async (signal) => {
			for (let i = finalizers.length - 1; i >= 0; i--) {
				await Deferred.to.Promise(finalizers[i](signal));
			}
			finalizers = [];
		},
		queue: Promise.resolve(),
		isClosed: () => closed,
		markClosed: () => {
			closed = true;
		},
	};
	// Methods are attached as member assignments rather than object-literal members: v8's
	// block coverage fails to attribute arrows created inside cast-built computed-key
	// literals, which would leave them permanently "uncovered" despite being exercised by
	// the protocol tests.
	const scope = {
		kind: "ResourceScope",
		[_scopeBrand]: { _scope: true },
		[_scopeState]: state,
	} as unknown as InternalScope;
	scope.dispose = (options?: { readonly signal?: AbortSignal; }) => disposeScope(state, options);
	scope[Symbol.asyncDispose] = () => Deferred.to.Promise(disposeScope(state));
	return scope;
};

const disposeScope = (state: ScopeState, options?: { readonly signal?: AbortSignal; }): Deferred<void> => {
	if (state.isClosed()) {
		// Idempotent: a scope releases each finalizer exactly once, like Deferred settles once.
		return Deferred.from.Promise(Promise.resolve());
	}
	state.markClosed();
	return Deferred.from.Promise(state.close(options?.signal));
};

const acquireResource = <E, A>(
	resource: Resource<E, A>,
	scope: Resource.Scope,
	options?: { readonly signal?: AbortSignal; },
): Deferred<Result<E, A>> => {
	const state = toInternalScope(scope)[_scopeState];
	// Acquisitions into one scope serialize FIFO: concurrent allocations would make "reverse
	// acquisition order" ill-defined, so LIFO is a guarantee rather than a convention.
	const run: Promise<Result<E, A>> = state.queue.then(async () => {
		const acquired = await toInternal(resource)[_allocate](state, options?.signal);
		return acquired;
	});
	state.queue = run;
	return Deferred.from.Promise(run);
};

const use = <E1, A, E2, B>(
	resource: Resource<E1, A>,
	options: { readonly run: (value: A) => Task.Result<E2, B>; readonly signal?: AbortSignal; },
): Deferred<Result<E1 | E2, B>> =>
	Deferred.from.Promise((async () => {
		const { signal } = options;
		const scope = makeScope();
		const state = toInternalScope(scope)[_scopeState];
		const acquired = await toInternal(resource)[_allocate](state, signal);
		const outcome = Result.is.err(acquired) ? acquired : await Deferred.to.Promise(options.run(acquired.value)(signal));
		await state.close(signal);
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

export namespace Resource {
	/**
	 * A batch finalizer stack for long-lived consumers — components, servers, test harnesses,
	 * workers — that must acquire resources once, hold them across an arbitrary lifetime, and
	 * release them together. Disposal runs every acquired resource's release finalizer in
	 * reverse (LIFO) acquisition order.
	 *
	 * The scope is opaque: state lives on an internal symbol and never appears in the public
	 * surface. Build one with `Resource.Scope.make`; acquire into it with `Resource.acquire`.
	 *
	 * @example
	 * ```ts
	 * using await scope = Resource.Scope.make();
	 * const conn = await Deferred.to.Promise(Resource.acquire(dbResource, scope));
	 * // everything acquired into the scope is released LIFO at block exit
	 * ```
	 */
	export type Scope = WithKind<"ResourceScope"> & {
		/**
		 * Releases all acquired resources in reverse (LIFO) acquisition order. Idempotent —
		 * each finalizer runs exactly once, like `Deferred` settles once. Disposal racing an
		 * in-flight acquisition is deterministic: the acquisition settles normally and its
		 * resource is released immediately after.
		 */
		readonly dispose: (options?: { readonly signal?: AbortSignal; }) => Deferred<void>;
		/**
		 * TC39 async-disposal protocol: `using await scope = Resource.Scope.make()` releases
		 * everything at block exit.
		 */
		readonly [Symbol.asyncDispose]: () => PromiseLike<void>;
		readonly [_scopeBrand]: { readonly _scope: true; };
	};
}

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
	 * The `run` callback's parameter is inferred from the resource's acquired value type.
	 *
	 * @example
	 * ```ts
	 * const rows = await Resource.use(dbResource, {
	 *   run: (conn: DbClient) => runQuery(conn, "SELECT * FROM users"),
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
	 *   run: ([conn, cache]: readonly [DbClient, CacheClient]) => lookupWithFallback(conn, cache, userId),
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
	 *   run: ({ db, redis, s3 }: AppInfra) => runMigration(db, redis, s3),
	 * });
	 * ```
	 */
	all,

	/**
	 * Long-lived acquisition primitives. A scope is a batch finalizer stack: acquire into it
	 * with `Resource.acquire`, release everything in reverse (LIFO) acquisition order on
	 * disposal. Build with `Resource.Scope.make` when a consumer must hold resources across
	 * an arbitrary lifetime — a component, a server, a test harness — where the
	 * `Resource.use` bracket's single-callback lifetime does not fit.
	 *
	 * @see {@link Resource.use} for the single-resource bracket with a fixed lifetime.
	 * @example
	 * ```ts
	 * const scope = Resource.Scope.make();
	 * const conn = await Deferred.to.Promise(Resource.acquire(dbResource, scope));
	 * const bucket = await Deferred.to.Promise(Resource.acquire(s3Resource, scope));
	 * // ... hold both for as long as needed ...
	 * await Deferred.to.Promise(scope.dispose());
	 * // released LIFO: bucket first, then conn
	 * ```
	 */
	Scope: { make: makeScope },

	/**
	 * Acquires the resource into the scope. Settles with the resource's own acquisition
	 * result — the same error channel, no new variants. The release finalizer is registered
	 * on success and runs at scope disposal in reverse (LIFO) acquisition order.
	 *
	 * Acquisitions into one scope serialize FIFO, so LIFO order is a guarantee. If the scope
	 * is disposed while an acquisition is still in flight, the acquisition settles normally
	 * and the resource is released immediately — no held resource is ever observed past
	 * disposal.
	 *
	 * @see {@link Resource.use} for the single-resource bracket with a fixed lifetime.
	 * @example
	 * ```ts
	 * const scope = Resource.Scope.make();
	 * const acquired = Resource.acquire(docLock, scope, { signal: controller.signal });
	 * const result = await Deferred.to.Promise(acquired);
	 * Result.matchValue(result, {
	 *   ok: (lock) => holdLock(lock),
	 *   err: (error) => reportLockFailure(error),
	 * });
	 * ```
	 */
	acquire: acquireResource,
};
