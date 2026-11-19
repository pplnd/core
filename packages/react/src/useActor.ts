import type { Machine as MachineType } from "@pplnd/core";
import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * The bound shared actor: the whole variant state, or the projected slice when a selector is
 * supplied, plus a stable typed `send`.
 */
export type UseActorResult<States extends { readonly kind: string; }, Events extends Record<string, unknown>, S> = {
	/** The whole variant state without a selector, or the projected slice with one. */
	readonly state: S;
	/**
	 * Stable pass-through to `actor.send` — dispatching to a shared actor is a message, not
	 * ownership. The actor outlives the component and is never aborted here.
	 */
	readonly send: (event: MachineType.EventMessage<Events>) => States;
};

/**
 * Subscribes a component to an externally-owned `Machine.Actor` — module-scope global
 * machines and cross-component coordinators interpreted in `Component.state.ts`.
 *
 * Subscription only: the hook never aborts the actor, and cleanup is the unsubscribe alone.
 * `send` is a stable pass-through to `actor.send` — the same `{ kind, value }` message shape
 * as {@link useMachine}.
 *
 * Without a selector, the component re-renders on every transition. With a selector, the
 * component re-renders only when the projected value changes (reference by default, custom
 * `equality` as an opt-in) — the selector is the value read the render would perform anyway,
 * hoisted to a typed boundary; named projections live in `Component.state.ts` and are
 * unit-testable without a renderer. Projection only pays off with structural sharing in the
 * machine's payloads: a transition touching one slice must keep the others' references
 * stable, or nothing is ever skipped.
 *
 * @see {@link useMachine} for per-instance ownership that creates and tears down the actor.
 *
 * @example
 * ```tsx
 * // Heavy-UI guidance: sections project the slice they render, not the whole state.
 * function CpuSection({ actor, category }: SectionProps) {
 *   const { state: cpu, send } = useActor(actor, (s) =>
 *     "build" in s.value ? s.value.build.cpu : null,
 *   );
 *
 *   return <OptionList options={category.cpuOptions()} selected={cpu}
 *     onSelect={(cpu) => send({ kind: "OPTION_SELECTED", value: { section: "cpu", option: cpu } })} />;
 * }
 * ```
 */
export function useActor<States extends { readonly kind: string; }, Events extends Record<string, unknown>>(
	actor: MachineType.Actor<States, Events>,
): UseActorResult<States, Events, States>;
export function useActor<States extends { readonly kind: string; }, Events extends Record<string, unknown>, S>(
	actor: MachineType.Actor<States, Events>,
	selector: (state: States) => S,
	equality?: (a: S, b: S) => boolean,
): UseActorResult<States, Events, S>;
export function useActor<States extends { readonly kind: string; }, Events extends Record<string, unknown>, S>(
	actor: MachineType.Actor<States, Events>,
	selector?: (state: States) => S,
	equality: (a: S, b: S) => boolean = Object.is,
): UseActorResult<States, Events, S> {
	// Whole-state binding reads the snapshot directly; sliced binding consults a projection
	// cache keyed on the store snapshot reference — an equality-matched slice returns the
	// previously selected reference, so useSyncExternalStore's Object.is check bails out of
	// the re-render. Both shapes share one unconditional hook sequence: the React Compiler's
	// static analysis rejects conditionally-called hook functions, so the dispatch lives
	// inside getSnapshot. The single `as S` below is the overload-dispatch seam — the public
	// overloads keep every call site's typing exact.
	const cacheRef = useRef<{ readonly source: States; readonly selected: S; } | null>(null);
	const getSnapshot = useCallback((): S => {
		const source = actor.getState();
		if (selector === undefined) {
			// Overload-dispatch seam: overload 1 instantiates S = States, so the identity
			// path returns the state object itself.
			return source as unknown as S;
		}
		const cache = cacheRef.current;
		if (cache !== null && cache.source === source) {
			return cache.selected;
		}
		const selected = selector(source);
		if (cache !== null && equality(cache.selected, selected)) {
			// Keep the previously selected reference stable so React's Object.is check bails
			// out of the re-render.
			cacheRef.current = { source, selected: cache.selected };
			return cache.selected;
		}
		cacheRef.current = { source, selected };
		return selected;
	}, [actor, selector, equality]);
	const state = useSyncExternalStore(actor.subscribe, getSnapshot, getSnapshot);
	return { state, send: actor.send };
}
