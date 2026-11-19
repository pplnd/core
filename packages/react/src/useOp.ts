import type { Deferred, Op } from "@pplnd/core";
import { useCallback, useSyncExternalStore } from "react";

/**
 * The bound manager surface: the manager's discriminated state union for render, plus stable
 * forwarding callbacks. The manager stays the single source of truth — the hook never copies
 * manager logic into React state.
 */
export type UseOpResult<Args extends readonly unknown[], E, A, S extends Op.State<E, A>> = {
	/**
	 * The manager's current discriminated state — `Idle`, `Pending`, `Queued`, `Retrying`, or
	 * a settled outcome — updating on every transition. Render it with `Op.matchValue`; the
	 * concurrency strategy behind it lives in the manager, not in the component.
	 */
	readonly state: S;
	/**
	 * Stable forwarding callback to `manager.run`. Settles with the manager's outcome
	 * (`Deferred`), so callers can coordinate concurrent runs.
	 */
	readonly run: (...args: Args) => Deferred<Exclude<S, Op.Idle | Op.Pending | Op.Queued | Op.Retrying<E>>>;
	/** Stable forwarding callback to `manager.abort`. */
	readonly abort: () => void;
	/** Stable forwarding callback to `manager.reset`. */
	readonly reset: () => void;
};

/**
 * Subscribes a component to an existing `Op.Manager`.
 *
 * The manager is created with `Op.interpret` outside React — in `Component.state.ts` — where
 * the concurrency strategy (debounced, queued, restartable, throttled, retry policies) is
 * configured. The hook subscribes once with a stable internal listener, re-renders the
 * manager's state union on every transition, and forwards `run`/`abort`/`reset` as stable
 * callbacks preserving the outcome `Deferred`.
 *
 * The hook is intentionally dumb about concurrency: the manager's strategy already decided
 * whether a second run queues, drops, replaces, or debounces — including `Queued { position }`
 * and `Retrying { attempt, nextRetryIn }`, which no hand-rolled hook renders correctly.
 *
 * The moment a run needs a concurrency strategy, the answer is "build the `Op`, then
 * `useOp`" — never "add options to {@link useLoad}".
 *
 * @see {@link useLoad} for the simple mount-triggered lifecycle.
 * @see {@link useOpPoll} to drive a recurring schedule on the same manager.
 *
 * @example
 * ```tsx
 * const saveOp = Op.make((draft: Draft) => persist(draft));
 * const saveManager = Op.interpret(saveOp, { strategy: "debounced", duration: Duration.milliseconds(300) });
 *
 * function Autosaver({ draft }: { draft: Draft }) {
 *   const { state, run } = useOp(saveManager);
 *
 *   useEffect(() => run(draft), [draft]);
 *
 *   return Op.is.pending(state) ? "Saving…"
 *     : Op.is.retrying(state) ? `Retrying (${state.attempt})…`
 *     : Op.is.idle(state) ? "Idle"
 *     : Op.is.ok(state) ? "Saved"
 *     : Op.is.err(state) ? `Failed: ${state.error}`
 *     : "Interrupted";
 * }
 * ```
 */
export function useOp<Args extends readonly unknown[], E, A, S extends Op.State<E, A>>(
	manager: Op.Manager<Args, E, A, S>,
): UseOpResult<Args, E, A, S> {
	const subscribe = useCallback((onStoreChange: () => void) => manager.subscribe(() => onStoreChange()), [manager]);
	const getSnapshot = useCallback(() => manager.state, [manager]);
	const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	return { state, run: manager.run, abort: manager.abort, reset: manager.reset };
}
