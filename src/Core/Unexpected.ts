import type { WithKind } from "../internal/InternalTypes";

/**
 * Represents an unexpected exception caught at an execution boundary.
 *
 * `Unexpected` captures failures that violate runtime contracts—such as thrown exceptions in callbacks,
 * tasks, mappers, predicates, or finalizers—while preserving caller settlement and diagnostic context.
 *
 * @example
 * ```ts
 * if (Unexpected.is.unexpected(error)) {
 *   if (error.phase === "release") {
 *     console.error("Release failed with previous outcome:", error.previous);
 *   } else {
 *     console.error("Boundary exception from", error.source, error.cause);
 *   }
 * }
 * ```
 */
export type Unexpected<Prev = unknown> = Unexpected.Execution | Unexpected.Release<Prev>;

export namespace Unexpected {
	/**
	 * An unexpected exception caught at an execution boundary (task throw, broken predicate, mapper error).
	 */
	export type Execution = WithKind<"Unexpected"> & {
		readonly source: string;
		readonly phase: "execution" | "acquire" | "use";
		readonly cause: unknown;
		readonly stepId?: string;
	};

	/**
	 * An unexpected failure during resource finalization.
	 * Preserves the preceding execution outcome and any secondary cleanup errors.
	 */
	export type Release<Prev = unknown> = WithKind<"Unexpected"> & {
		readonly source: "Resource";
		readonly phase: "release";
		readonly cause: unknown;
		readonly previous: Prev;
		readonly additionalErrors: readonly unknown[];
	};
}

const makeExecution = (
	options: {
		readonly source: string;
		readonly cause: unknown;
		readonly phase?: "execution" | "acquire" | "use";
		readonly stepId?: string;
	},
): Unexpected.Execution => ({
	kind: "Unexpected",
	source: options.source,
	phase: options.phase ?? "execution",
	cause: options.cause,
	...(options.stepId !== undefined ? { stepId: options.stepId } : {}),
});

const makeRelease = <Prev = unknown>(
	options: { readonly cause: unknown; readonly previous: Prev; readonly additionalErrors?: readonly unknown[]; },
): Unexpected.Release<Prev> => ({
	kind: "Unexpected",
	source: "Resource",
	phase: "release",
	cause: options.cause,
	previous: options.previous,
	additionalErrors: options.additionalErrors ?? [],
});

const isUnexpected = (value: unknown): value is Unexpected<unknown> => {
	if (typeof value !== "object" || value === null) { return false; }
	const candidate = value as Record<string, unknown>;
	if (candidate.kind !== "Unexpected" || typeof candidate.source !== "string" || !("cause" in candidate)) {
		return false;
	}
	if (candidate.phase === "release") {
		return candidate.source === "Resource" && "previous" in candidate && Array.isArray(candidate.additionalErrors);
	}
	return (candidate.phase === "execution" || candidate.phase === "acquire" || candidate.phase === "use")
		&& (candidate.stepId === undefined || typeof candidate.stepId === "string");
};

const isExecution = (value: unknown): value is Unexpected.Execution =>
	isUnexpected(value) && (value.phase === "execution" || value.phase === "acquire" || value.phase === "use");

const isRelease = <T>(value: T): value is T & Unexpected.Release<unknown> =>
	isUnexpected(value) && value.phase === "release";

const matchUnexpected =
	<R, Prev = unknown>(
		cases: {
			readonly execution: (error: Unexpected.Execution) => R;
			readonly release: (error: Unexpected.Release<Prev>) => R;
		},
	) =>
	<P extends Prev = Prev>(error: Unexpected<P>): R =>
		error.phase === "release" ? cases.release(error) : cases.execution(error);

export const Unexpected = {
	/**
	 * Constructors for `Unexpected` failure values.
	 */
	make: {
		/**
		 * Creates an `Unexpected.Execution` failure representing a caught boundary exception.
		 *
		 * @example
		 * ```ts
		 * const err = Unexpected.make.execution({ source: "Graph", cause: new Error("boom") });
		 * ```
		 */
		execution: makeExecution,

		/**
		 * Creates an `Unexpected.Release` failure representing a resource cleanup failure.
		 *
		 * @example
		 * ```ts
		 * const err = Unexpected.make.release({
		 *   cause: new Error("cleanup failed"),
		 *   previous: Result.make.ok(42),
		 * });
		 * ```
		 */
		release: makeRelease,
	},

	/**
	 * Type guards for checking `Unexpected` error values.
	 */
	is: {
		/**
		 * Checks whether a value is an `Unexpected` error.
		 */
		unexpected: isUnexpected,

		/**
		 * Checks whether an `Unexpected` error represents an execution boundary failure.
		 */
		execution: isExecution,

		/**
		 * Checks whether an `Unexpected` error represents a resource release failure.
		 */
		release: isRelease,
	},

	/**
	 * Eliminates an `Unexpected` value by pattern matching on its variant (`execution` vs `release`).
	 *
	 * @example
	 * ```ts
	 * const message = Unexpected.match({
	 *   execution: (err) => `Failed during ${err.phase}: ${String(err.cause)}`,
	 *   release: (err) => `Failed during cleanup: ${String(err.cause)}`,
	 * })(error);
	 * ```
	 */
	match: matchUnexpected,
};
