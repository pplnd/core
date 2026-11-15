import type { Duration, Op } from "@pplnd/core";
import { useEffect } from "react";

/**
 * Options for {@link useOpPoll}.
 */
export type UseOpPollOptions = {
	/**
	 * The repeat interval. Boundaries are absolute positions on a monotonic clock inside the
	 * manager, so timer jitter never accumulates. Non-finite, zero, or negative values
	 * schedule no repeat — the initial run still executes.
	 */
	readonly every: Duration;
};

/**
 * Binds `manager.poll` to the component lifecycle: starts polling on mount, stops on
 * unmount, and re-polls (stop + restart) when the interval or the run arguments change.
 *
 * This is a thin lifecycle bracket — no new scheduling logic. The manager's poll owns the
 * absolute-boundary monotonic clock, timer hygiene, and the underlying strategy. State
 * observation composes through {@link useOp} on the same manager: `useOp` renders,
 * `useOpPoll` drives.
 *
 * @see {@link useOp} to observe the polled runs' state union.
 *
 * @example
 * ```tsx
 * const metricsManager = Op.interpret(metricsOp, { strategy: "restartable" });
 *
 * function MetricsPanel({ clusterId }: { clusterId: string }) {
 *   useOpPoll(metricsManager, { every: Duration.seconds(30) }, clusterId);
 *   const { state } = useOp(metricsManager);
 *
 *   return Op.is.ok(state) ? <Table rows={state.value} /> : <Spinner />;
 * }
 * ```
 */
export function useOpPoll<Args extends readonly unknown[], E, A, S extends Op.State<E, A>>(
	manager: Op.Manager<Args, E, A, S>,
	options: UseOpPollOptions,
	...args: Args
): void {
	const { every } = options;
	useEffect(
		() => manager.poll({ every })(...args),
		// The args tuple length is fixed by the manager's Args type per call site, so the
		// deps array length is stable across renders.
		[manager, every, ...args],
	);
}
