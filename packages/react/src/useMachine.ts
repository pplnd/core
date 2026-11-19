import { Machine, type Machine as MachineType } from "@pplnd/core";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The bound per-instance machine: the current variant state with its guaranteed payload, and
 * a stable typed `send`.
 */
export type UseMachineResult<States extends { readonly kind: string; }, Events extends Record<string, unknown>> = {
	/**
	 * The machine's current variant state — payloads are guaranteed per variant, so render
	 * reads them directly via `Machine.matchValue` with no null-guards.
	 */
	readonly state: States;
	/**
	 * Stable pass-through to `actor.send` — the actor's canonical `{ kind, value }` event
	 * message shape. Events sent before the actor has started (a child effect firing before
	 * the mount effect) are queued and processed in order when the actor starts.
	 */
	readonly send: (event: MachineType.EventMessage<Events>) => States;
};

/**
 * Owns a `Machine` actor for the component's lifetime.
 *
 * The machine definition is a plain record built in `Component.state.ts`; only
 * interpretation happens here. The actor is created in the mount effect — entry hooks and
 * bus subscriptions run inside a properly paired lifecycle, so StrictMode's
 * mount → unmount → remount produces entry → exit → entry with every actor aborted exactly
 * once (creating the actor during render would leak the double-invoked initializer's actor).
 * On unmount the actor is aborted and its subscription dropped.
 *
 * This is the deliberate exception to the binding rule: per-instance state (a modal, a
 * dropdown, one form) MUST be created per mount and torn down with the component. The hook
 * takes only `initial` (and an optional diagnostic `id`) — cross-machine event wiring is a
 * module-scope concern: interpret with `bus` in `Component.state.ts` and bind with
 * {@link useActor} instead.
 *
 * @see {@link useActor} for subscription-only binding to an externally-owned actor.
 *
 * @example
 * ```tsx
 * const checkoutMachine = Machine.make<CheckoutState, CheckoutEvents>({
 *   idle: { on: { SUBMIT: () => Machine.state("authorizing") } },
 *   // ...
 * });
 *
 * function PaymentPanel() {
 *   const { state, send } = useMachine(checkoutMachine, { initial: Machine.state("idle") });
 *
 *   return Machine.matchValue(state, {
 *     idle: () => <Button onClick={() => send({ kind: "SUBMIT", value: undefined })} />,
 *     authorizing: () => <Spinner />,
 *     authorized: ({ token }) => <Receipt token={token} />,
 *     rejected: ({ reason }) => <RetryNotice reason={reason} />,
 *   });
 * }
 * ```
 */
export function useMachine<States extends { readonly kind: string; }, Events extends Record<string, unknown>>(
	machine: MachineType<States, Events>,
	options: { readonly initial: States; readonly id?: string; },
): UseMachineResult<States, Events> {
	const [state, setState] = useState<States>(options.initial);
	// The definition is frozen at mount: re-creating the actor on definition identity churn
	// would replay entry hooks; a changed initial state is a remount concern (`key`).
	const definitionRef = useRef({ machine, options });
	const actorRef = useRef<MachineType.Actor<States, Events> | null>(null);
	const pendingRef = useRef<MachineType.EventMessage<Events>[]>([]);

	useEffect(() => {
		const { initial, id } = definitionRef.current.options;
		const actor = Machine.interpret(definitionRef.current.machine, { initial, id });
		actorRef.current = actor;
		const unsubscribe = actor.subscribe((next) => {
			setState(next);
		});
		// Entry hooks may have transitioned the machine away from the initial state during
		// interpretation; adopt the actor's settled state as the rendered one.
		setState(actor.getState());
		// Deliver events sent before the actor started, in order. Each delivery notifies the
		// subscriber above, so the component re-renders through the transitions.
		for (const event of pendingRef.current) {
			actor.send(event);
		}
		pendingRef.current = [];
		return () => {
			actorRef.current = null;
			unsubscribe();
			actor.abort();
		};
	}, []);

	const send = useCallback((event: MachineType.EventMessage<Events>): States => {
		const actor = actorRef.current;
		if (actor === null) {
			pendingRef.current.push(event);
			return definitionRef.current.options.initial;
		}
		return actor.send(event);
	}, []);

	return { state, send };
}
