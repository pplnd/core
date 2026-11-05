import { storeLru, touchLru } from "../internal/lru.ts";
import { Duration } from "../Types/Duration.ts";
import { Deferred } from "./Deferred.ts";
import { Maybe } from "./Maybe.ts";
import { Result } from "./Result.ts";

/**
 * A keyed store that reuses successful results and shares in-flight work.
 *
 * Three policies govern every lookup:
 * - **Freshness** — a stored value younger than `ttl` is returned without calling the loader.
 * - **Single flight** — concurrent lookups for one key share a single load instead of starting
 *   their own.
 * - **Reuse after expiry** — with `staleWhileRevalidate`, an expired-but-recent value is returned
 *   immediately while one background refresh runs.
 *
 * Only successful results are stored. A failed load removes its flight and leaves any older
 * stored value in place, so a transient error does not poison later lookups. Because a stored
 * value and a shared flight outlive the caller that started them, `load` takes no cancellation
 * input.
 *
 * @example
 * ```ts
 * const users = Cache.make({
 *   load: (id: string) => Task.Result.tryCatch(() => directory.find(id), { onError: toLookupError })(),
 *   ttl: Duration.minutes(5),
 *   staleWhileRevalidate: Duration.minutes(1),
 *   maxSize: 500,
 * });
 *
 * const user = await users.load("u_1");
 * ```
 */
export type Cache<K, E, V> = {
	/**
	 * Starts a lookup, reusing a stored value when one is fresh enough and joining an in-flight
	 * load when one is already running.
	 *
	 * The lookup starts when `load` is called and takes no cancellation input: the load is shared
	 * and its value is retained, so cancelling one caller would either cancel work other callers
	 * need or report an error that is not an application error. A load must not throw and its
	 * deferred must not reject; encode expected failures in the returned `Result`.
	 *
	 * @see {@link Cache.peek} to read a stored value without starting a load.
	 *
	 * @example
	 * ```ts
	 * const settings = await cache.load("workspace:42");
	 * ```
	 */
	readonly load: (key: K) => Deferred<Result<E, V>>;

	/**
	 * Reads the last stored value for a key without starting a load.
	 *
	 * A stale value is returned when one is still stored. This never refreshes the entry and
	 * never changes least-recently-used eviction order.
	 *
	 * @see {@link Cache.load} to load a missing or expired key.
	 *
	 * @example
	 * ```ts
	 * const cached = cache.peek("workspace:42");
	 * if (Maybe.is.none(cached)) {
	 *   console.log("Nothing loaded yet");
	 * }
	 * ```
	 */
	readonly peek: (key: K) => Maybe<V>;

	/**
	 * Drops the stored value and any in-flight lookup for a key.
	 *
	 * Callers already awaiting that lookup still receive its result, but the result is not
	 * stored afterwards.
	 *
	 * @see {@link Cache.clear} to drop every key at once.
	 */
	readonly invalidate: (key: K) => void;

	/**
	 * Drops every stored value and in-flight lookup.
	 *
	 * Lookups already awaiting a load still receive its result, but nothing is stored
	 * afterwards.
	 *
	 * @see {@link Cache.invalidate} to drop a single key.
	 */
	readonly clear: () => void;

	/**
	 * Waits until no load is running.
	 *
	 * A background refresh started by a stale lookup is included, and so is a load started while
	 * the flush is waiting, including one started by a loader that runs during the flush. The
	 * deferred stays pending while requests keep arriving, so use it before shutdown and in
	 * tests, not on a live stream of requests.
	 *
	 * @see {@link Cache.clear} to drop entries without waiting for their loads.
	 */
	readonly flush: () => Deferred<void>;

	/**
	 * Returns the number of stored entries. An in-flight lookup is not counted.
	 */
	readonly size: () => number;
};

export namespace Cache {
	/**
	 * Configuration for `Cache.make`.
	 */
	export type Config<K, E, V, SerializedKey = K> = {
		/**
		 * Starts loading a key. Called once per flight, and never for a fresh or stale hit.
		 *
		 * Return the deferred of a task (`loadUser(id)()`) or of a batcher lookup. The cache starts
		 * the returned work immediately, so the contract takes a `Deferred` rather than a lazy
		 * `Task`. Expected failures belong in the `Result`; a synchronous throw is a contract
		 * violation and propagates to the caller.
		 *
		 * @example
		 * ```ts
		 * load: (id: string) => Task.Result.tryCatch(() => directory.find(id), { onError: toLookupError })(),
		 * ```
		 */
		readonly load: (key: K) => Deferred<Result<E, V>>;

		/**
		 * How long a stored value stays fresh.
		 *
		 * A non-positive duration or `NaN` disables storage; single flight still applies while a
		 * load runs. `Infinity` never expires.
		 */
		readonly ttl: Duration;

		/**
		 * How long after `ttl` a stored value may still be returned while one background refresh
		 * runs. Omitted or non-positive disables the window.
		 */
		readonly staleWhileRevalidate?: Duration;

		/**
		 * Maximum number of stored entries. Least recently used entries are evicted first.
		 *
		 * Omitted or non-finite means unbounded; zero or a negative value disables storage; a
		 * fractional value is floored.
		 */
		readonly maxSize?: number;

		/**
		 * Maps a key to the value used for storage and flight identity. Defaults to the key
		 * itself. Keys that map to the same value share one entry.
		 *
		 * @example
		 * ```ts
		 * keyBy: (request: { readonly id: string; readonly signal: AbortSignal }) => request.id,
		 * ```
		 */
		readonly keyBy?: (key: K) => SerializedKey;
	};
}

type Entry<V> = { readonly value: V; readonly storedAt: number; };

type Flight<E, V> = { readonly deferred: Deferred<Result<E, V>>; active: boolean; };

const okDeferred = <E, V>(value: V): Deferred<Result<E, V>> =>
	Deferred.from.Promise(globalThis.Promise.resolve<Result<E, V>>(Result.make.ok(value)));

const normalizeTtl = (duration: Duration): number => {
	const milliseconds = Duration.to.milliseconds(duration);
	return Number.isNaN(milliseconds) ? 0 : Math.max(0, milliseconds);
};

const normalizeStale = (duration: Duration | undefined): number => {
	if (duration === undefined) {
		return 0;
	}
	const milliseconds = Duration.to.milliseconds(duration);
	return Number.isNaN(milliseconds) ? 0 : Math.max(0, milliseconds);
};

const normalizeMaxSize = (maxSize: number | undefined): number => {
	if (maxSize === undefined) {
		return Number.POSITIVE_INFINITY;
	}
	return Number.isFinite(maxSize) ? Math.max(0, Math.floor(maxSize)) : Number.POSITIVE_INFINITY;
};

const makeCache = <K, E, V, SerializedKey = K>(config: Cache.Config<K, E, V, SerializedKey>): Cache<K, E, V> => {
	const keyBy = config.keyBy ?? ((key: K): SerializedKey => key as unknown as SerializedKey);
	const ttlMs = normalizeTtl(config.ttl);
	const staleMs = normalizeStale(config.staleWhileRevalidate);
	const maxSize = normalizeMaxSize(config.maxSize);
	const storageEnabled = ttlMs > 0 && maxSize > 0;

	const store = new Map<SerializedKey, Entry<V>>();
	const flights = new Map<SerializedKey, Flight<E, V>>();

	const storeValue = (serializedKey: SerializedKey, value: V): void => {
		if (!storageEnabled) {
			return;
		}
		storeLru(store, serializedKey, { value, storedAt: Date.now() }, maxSize);
	};

	const startFlight = (serializedKey: SerializedKey, key: K): Deferred<Result<E, V>> => {
		const deferred = config.load(key);
		const flight: Flight<E, V> = { deferred, active: true };
		flights.set(serializedKey, flight);
		deferred.then((result) => {
			if (flights.get(serializedKey) === flight) {
				flights.delete(serializedKey);
			}
			if (!flight.active) {
				return;
			}
			flight.active = false;
			if (Result.is.ok(result)) {
				storeValue(serializedKey, result.value);
			}
		});
		return deferred;
	};

	const load = (key: K): Deferred<Result<E, V>> => {
		const serializedKey = keyBy(key);
		const entry = store.get(serializedKey);
		if (entry !== undefined) {
			const age = Date.now() - entry.storedAt;
			if (age < ttlMs) {
				touchLru(store, serializedKey);
				return okDeferred(entry.value);
			}
			if (age < ttlMs + staleMs) {
				touchLru(store, serializedKey);
				if (!flights.has(serializedKey)) {
					startFlight(serializedKey, key);
				}
				return okDeferred(entry.value);
			}
			store.delete(serializedKey);
		}

		const flight = flights.get(serializedKey);
		if (flight !== undefined) {
			return flight.deferred;
		}
		return startFlight(serializedKey, key);
	};

	const peek = (key: K): Maybe<V> => {
		const entry = store.get(keyBy(key));
		return entry === undefined ? Maybe.make.none() : Maybe.make.some(entry.value);
	};

	const invalidate = (key: K): void => {
		const serializedKey = keyBy(key);
		store.delete(serializedKey);
		const flight = flights.get(serializedKey);
		if (flight !== undefined) {
			flight.active = false;
			flights.delete(serializedKey);
		}
	};

	const clear = (): void => {
		store.clear();
		for (const flight of flights.values()) {
			flight.active = false;
		}
		flights.clear();
	};

	const flush = (): Deferred<void> =>
		Deferred.from.Promise((async (): Promise<void> => {
			while (flights.size > 0) {
				const pending = Array.from(flights.values(), (flight) => Deferred.to.Promise(flight.deferred));
				await globalThis.Promise.all(pending);
			}
		})());

	return { load, peek, invalidate, clear, flush, size: () => store.size };
};

export const Cache = {
	/**
	 * Creates a cache around a keyed load.
	 *
	 * @see {@link Cache} for the freshness, single-flight, and eviction policies.
	 *
	 * @example
	 * ```ts
	 * const priceList = Cache.make({
	 *   load: (sku: string) => Task.Result.tryCatch(() => catalog.price(sku), { onError: toPriceError })(),
	 *   ttl: Duration.minutes(10),
	 *   staleWhileRevalidate: Duration.minutes(2),
	 *   maxSize: 1_000,
	 * });
	 *
	 * const price = await priceList.load("SKU-1042");
	 * const known = priceList.peek("SKU-1042");
	 * ```
	 */
	make: makeCache,
};
