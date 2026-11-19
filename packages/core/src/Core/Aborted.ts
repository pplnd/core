import { type WithKind } from "../internal/InternalTypes.ts";

/**
 * Describes an operation that stopped because its caller cancelled it.
 *
 * Every cancellable engine settles with the same `Aborted` shape, so a single
 * `kind === "Aborted"` check handles cancellation from `Graph`, `Transaction`, and `Batcher`.
 * The `reason` is whatever was passed to `AbortSignal.abort(reason)`.
 *
 * @example
 * ```ts
 * import { Aborted, pipe, Result } from "@pplnd/core";
 *
 * const outcome = pipe(
 *   await runReport(signal),
 *   Result.mapError((error) => error),
 * );
 *
 * if (Result.is.err(outcome) && Aborted.is(outcome.error)) {
 *   console.log("Report cancelled:", outcome.error.reason);
 * }
 * ```
 */
export type Aborted = WithKind<"Aborted"> & {
	/** The value passed to `AbortSignal.abort(reason)`, or `undefined` when no reason was supplied. */
	readonly reason: unknown;
};

const make = (reason?: unknown): Aborted => ({ kind: "Aborted", reason });

const is = (value: { readonly kind: string; }): value is Aborted => value.kind === "Aborted";

export const Aborted = {
	/**
	 * Creates an `Aborted` outcome from a cancellation reason.
	 *
	 * Engines call this from their own `AbortSignal` listeners. Use it directly when a
	 * transform or a test needs to represent a cancelled run without a live signal.
	 *
	 * @see {@link Aborted.is} to check whether a settled value is a cancellation.
	 *
	 * @example
	 * ```ts
	 * Aborted.make("user navigated away"); // { kind: "Aborted", reason: "user navigated away" }
	 * ```
	 */
	make,

	/**
	 * Narrows any `{ kind }` discriminated value to `Aborted`.
	 *
	 * @see {@link Aborted.make} to construct an `Aborted` outcome.
	 *
	 * @example
	 * ```ts
	 * if (Aborted.is(error)) {
	 *   logCancellation(error.reason);
	 * }
	 * ```
	 */
	is,
};
