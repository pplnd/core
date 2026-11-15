import { EventBus } from "@pplnd/core";
import { useEffect, useRef } from "react";

/**
 * Subscribes a stable handler to a single `EventBus` event key for the component's lifetime.
 *
 * The subscription is created once per `(bus, key)` pair on mount; the latest handler is read
 * from a ref that is synced on every commit, so deliveries after any commit observe current
 * props and state without re-subscribing (the stale-closure failure mode never occurs). The
 * subscription is dropped on unmount or key change.
 *
 * Delivery-to-render translation is left to the caller — the handler may update local state;
 * the hook does not buffer or replay events. Handlers that throw follow the bus's own
 * contract: a configured `onError` reports and delivery continues, otherwise the exception
 * propagates to the emitter. The hook adds no second error channel.
 *
 * Multi-key subscription has no dedicated hook: call `useEventBus` per key. That keeps
 * handler payload types exact per key, which a combined-keys hook would blur into a union.
 *
 * @example
 * ```tsx
 * type CartEvents = {
 *   readonly itemAdded: { readonly id: string };
 *   readonly cartCleared: void;
 * };
 *
 * function CartBadge({ bus }: { bus: EventBus<CartEvents> }) {
 *   const [count, setCount] = useState(0);
 *   useEventBus(bus, "itemAdded", (payload) => {
 *     setCount((current) => current + 1);
 *     void payload.id;
 *   });
 *   useEventBus(bus, "cartCleared", () => setCount(0));
 *
 *   return <span>{count}</span>;
 * }
 * ```
 */
export function useEventBus<Events extends Record<string, unknown>, K extends keyof Events & string>(
	bus: EventBus<Events>,
	key: K,
	handler: (payload: Events[K]) => void,
): void {
	const handlerRef = useRef(handler);
	useEffect(() => {
		handlerRef.current = handler;
	});
	useEffect(() =>
		EventBus.subscribe(bus, key).tap(({ value }) => {
			handlerRef.current(value);
		}), [bus, key]);
}
