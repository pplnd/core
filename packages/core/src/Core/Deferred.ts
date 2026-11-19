import type { Thenable } from "../internal/InternalTypes";

declare const _deferred: unique symbol;

/**
 * A nominally typed, one-shot async value that supports `await` but enforces infallibility.
 *
 * Two design choices work together to make the guarantee structural rather than documentary:
 *
 * - The phantom `[_deferred]` symbol makes the type **nominal**: only values produced by
 *   `Deferred.from.Promise` satisfy it. A plain object `{ then: ... }` does not.
 * - The single-parameter `.then()` **excludes rejection handlers** by construction. There is
 *   no second argument to pass, so chaining and `.catch()` are impossible.
 *
 * This makes `Deferred<A>` the natural return type for `Task<A>`, which is guaranteed to
 * never reject.
 *
 * @example
 * ```ts
 * const value = await Deferred.from.Promise(Promise.resolve(42));
 * // value === 42
 * ```
 */
export type Deferred<A> = { readonly [_deferred]: A; readonly then: (onfulfilled: (value: A) => unknown) => void; };

const fromPromise = <A>(p: Thenable<A>): Deferred<A> =>
	({ then: ((f) => p.then(f)) as Deferred<A>["then"] }) as Deferred<A>;

const toPromise = <A>(d: Deferred<A>): globalThis.Promise<A> => new globalThis.Promise<A>((resolve) => d.then(resolve));

export const Deferred = {
	// --- from ---
	from: {
		/**
		 * Wraps a `Promise` or `Deferred` into a `Deferred`, structurally excluding rejection handlers,
		 * `.catch()`, `.finally()`, and chainable `.then()`.
		 *
		 * **Precondition**: `p` must never reject. If `p` rejects, the returned `Deferred` will
		 * never resolve — `await`-ing it will hang indefinitely. Use `Task.Result.tryCatch` to
		 * handle operations that may fail before converting to a `Deferred`.
		 *
		 * @example
		 * ```ts
		 * const d = Deferred.from.Promise(Promise.resolve("hello"));
		 * const value = await d; // "hello"
		 * ```
		 */
		Promise: fromPromise,
	},

	// --- to ---
	to: {
		/**
		 * Converts a `Deferred` back into a `Promise`.
		 *
		 * @example
		 * ```ts
		 * const p = Deferred.to.Promise(Deferred.from.Promise(Promise.resolve(42)));
		 * // p is Promise<42>
		 * ```
		 */
		Promise: toPromise,
	},

	/**
	 * Transforms the resolved value of a `Deferred`.
	 *
	 * `Deferred` is the type every asynchronous run settles into: `Task.run`, `Op.Manager.run`,
	 * `Resource.use`, and `Graph.run` all return one. Use `map` to reshape that settled value
	 * without converting back to a `Promise`.
	 *
	 * @see {@link Deferred.chain} when the transform itself returns another `Deferred`.
	 *
	 * @example
	 * ```ts
	 * const total = pipe(
	 *   Task.run()(loadCart()),
	 *   Deferred.map((cart) => cart.items.length),
	 * );
	 * console.log(await total); // 3
	 * ```
	 */
	map: <A, B>(transform: (value: A) => B) => (deferred: Deferred<A>): Deferred<B> =>
		fromPromise(toPromise(deferred).then(transform)),

	/**
	 * Chains a `Deferred`-returning step after the current one resolves.
	 *
	 * The next step starts only after the previous value arrives, and only that value is
	 * passed forward. Use `Deferred.all` to run independent steps concurrently.
	 *
	 * @see {@link Deferred.map} when the transform returns a plain value.
	 * @see {@link Deferred.all} to combine independent `Deferred` values.
	 *
	 * @example
	 * ```ts
	 * const orders = pipe(
	 *   Task.run()(loadUser("u_1")),
	 *   Deferred.chain((user) => Task.run()(loadOrders(user.id))),
	 * );
	 * ```
	 */
	chain: <A, B>(transform: (value: A) => Deferred<B>) => (deferred: Deferred<A>): Deferred<B> =>
		fromPromise(toPromise(deferred).then((value) => toPromise(transform(value)))),

	/**
	 * Runs a side effect with the resolved value and passes that value through unchanged.
	 *
	 * The callback must not throw. Use it to log, record metrics, or update a store after an
	 * operation settles without breaking the chain.
	 *
	 * @see {@link Deferred.map} to transform the value instead of observing it.
	 *
	 * @example
	 * ```ts
	 * const outcome = pipe(
	 *   Task.run()(chargeCard(payment)),
	 *   Deferred.tap((receipt) => audit.record(receipt.id)),
	 * );
	 * ```
	 */
	tap: <A>(sideEffect: (value: A) => void) => (deferred: Deferred<A>): Deferred<A> =>
		fromPromise(
			toPromise(deferred).then((value) => {
				sideEffect(value);
				return value;
			}),
		),

	/**
	 * Combines an array or tuple of `Deferred` values into a single `Deferred` of a tuple.
	 * Resolves when all input `Deferred`s resolve.
	 *
	 * @example
	 * ```ts
	 * const [a, b] = await Deferred.all([d1, d2]);
	 * ```
	 */
	all: <T extends readonly Deferred<unknown>[]>(
		deferreds: T,
	): Deferred<{ [K in keyof T]: T[K] extends Deferred<infer A> ? A : never; }> =>
		fromPromise(globalThis.Promise.all(deferreds.map((d) => toPromise(d)))) as Deferred<
			{ [K in keyof T]: T[K] extends Deferred<infer A> ? A : never; }
		>,

	/**
	 * Races multiple `Deferred` values and resolves with the first one to settle.
	 *
	 * @example
	 * ```ts
	 * const winner = await Deferred.race([d1, d2]);
	 * ```
	 */
	race: <A>(deferreds: ReadonlyArray<Deferred<A>>): Deferred<A> =>
		fromPromise(globalThis.Promise.race(deferreds.map((d) => toPromise(d)))),
};
