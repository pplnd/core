import type { Deferred } from "../Core/Deferred";
import type { Duration } from "../Types/Duration.ts";

/**
 * Represents a promise-like object or a deferred value that can be resolved with `.then()`.
 */
export type Thenable<A> = PromiseLike<A> | Deferred<A>;

/**
 * Represents a value that can be either a synchronous value or a Thenable.
 */
export type Awaitable<A> = A | Thenable<A>;

export type NonEmptyArr<A> = readonly [A, ...A[]];

export const isNonEmptyArr = <A>(list: readonly A[]): list is NonEmptyArr<A> => list.length > 0;

/**
 * Returns the keys present on any branch of a union.
 *
 * `keyof (A | B)` only yields the keys shared by every branch, so append-only guards built on it
 * can silently accept a key that already exists on one branch.
 */
export type KeysOfUnion<T> = T extends unknown ? keyof T : never;

export type WithKind<K extends string> = { readonly kind: K; };

export type WithValue<T> = { readonly value: T; };

export type WithError<T> = { readonly error: T; };

export type WithErrors<T> = { readonly errors: NonEmptyArr<T>; };

export type WithFirst<T> = { readonly first: T; };

export type WithSecond<T> = { readonly second: T; };

export type WithLog<T> = { readonly log: ReadonlyArray<T>; };

export type WithId = { readonly id?: string; };

// ---------------------------------------------------------------------------
// Op option fragments shared across strategies
// ---------------------------------------------------------------------------

// Throttled / debounced options

export type WithDuration = { readonly duration: Duration; };

// Queue options

export type WithConcurrency = { readonly concurrency?: number; };

// Exclusive options

export type WithCooldown = { readonly cooldown?: Duration; };

// Restartable options

export type WithMinInterval = { readonly minInterval?: Duration; };

export type NonEmpty<T extends string> = `NonEmpty${T}`;
