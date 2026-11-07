import type { EventBus } from "../Core/EventBus.ts";

/**
 * Unique symbol key used to access the private internal execution state of an `EventBus`.
 *
 * @internal
 */
export const EVENT_BUS_STATE: unique symbol = Symbol.for("@pplnd/core/EventBus.state") as typeof EVENT_BUS_STATE;

/**
 * Configuration options stored in the internal state of an `EventBus`.
 *
 * @internal
 */
export type EventBusOptions = { readonly id?: string; };

/**
 * One forward link in an ancestry chain. Used to detect only true forwarding cycles.
 *
 * @internal
 */
export type EventBusForwardLink = (msg: unknown) => void;

/**
 * A queued delivery together with the forward links traversed on the path that produced it.
 *
 * @internal
 */
export type EventBusDelivery = { readonly message: unknown; readonly ancestry: ReadonlySet<EventBusForwardLink>; };

/**
 * A registered subscriber together with its registration order and observed event kinds.
 *
 * `interest` is `null` for wildcard subscribers (schema-wide and strict sequence matchers) that
 * receive every event. Dispatch uses `order` to merge wildcard entries with per-kind bucket
 * entries while preserving the documented registration-order delivery.
 *
 * Unsubscription replaces `subscriber` with a no-op, so an in-flight dispatch holding a snapshot
 * of the entries skips a subscriber removed by an earlier callback without a per-delivery lookup.
 *
 * @internal
 */
export type EventBusSubscription = {
	readonly order: number;
	subscriber: (msg: unknown) => void;
	readonly interest: ReadonlySet<string> | null;
};

/**
 * Low-level operational state backing an `EventBus` instance.
 *
 * Subscribers are indexed by the event kinds they observe, so an emission only visits subscribers
 * that can react to it. Wildcard subscribers are kept in a separate ordered list and merged with
 * the matching kind bucket at dispatch time. A synchronous FIFO trampoline queue provides
 * deterministic reentrant dispatch.
 *
 * @internal
 */
export type EventBusInternalState = {
	/**
	 * Diagnostic options provided at bus construction.
	 */
	readonly options?: EventBusOptions;

	/**
	 * Registry of every active subscriber keyed by its wrapper function. Provides O(1) identity
	 * lookup for unsubscription and filters subscribers removed during an in-flight dispatch.
	 */
	readonly registry: Map<(msg: unknown) => void, EventBusSubscription>;

	/**
	 * Per-kind subscriber buckets. Every array is append-only while subscribers register, so it is
	 * already sorted by registration order and only needs to be merged with the wildcard list.
	 * Arrays are replaced (never spliced) on unsubscription so in-flight dispatch snapshots stay
	 * stable.
	 */
	readonly buckets: Map<string, EventBusSubscription[]>;

	/**
	 * Wildcard subscribers that observe every event kind. The array is empty when none are
	 * registered and is only replaced on unsubscription so in-flight dispatch snapshots stay
	 * stable.
	 */
	wildcards: EventBusSubscription[];

	/**
	 * Breadth-first reentrancy queue buffering events emitted synchronously by subscriber callbacks.
	 *
	 * Processed sequentially in FIFO order by the active emission trampoline loop. Each delivery
	 * carries its own forward ancestry so fan-in branches and sequential re-emissions do not share
	 * cycle-detection state.
	 */
	readonly queue: Array<EventBusDelivery>;

	/**
	 * Guard flag tracking whether an emission trampoline loop is actively draining the queue.
	 *
	 * When `true`, subsequent reentrant emissions push to `queue` and return immediately,
	 * preventing recursive stack growth and ensuring deterministic ordering.
	 */
	isEmitting: boolean;

	/**
	 * Monotonic registration counter assigning each subscriber its delivery order.
	 */
	nextOrder: number;

	/**
	 * Last dispatched event kind and its resolved bucket, caching the kind index lookup for
	 * workloads that emit the same kind repeatedly.
	 */
	lastKind: string | null;
	lastBucket: EventBusSubscription[] | null;
};

/**
 * Representation of an `EventBus` exposing its hidden internal state symbol.
 *
 * @internal
 */
export type InternalEventBus<S extends Record<string, unknown>> = EventBus<S> & {
	readonly [EVENT_BUS_STATE]: EventBusInternalState;
};

/**
 * Unwraps an `EventBus` instance to expose its internal state structure.
 *
 * @internal
 */
export const toInternalEventBus = <S extends Record<string, unknown>>(bus: EventBus<S>): InternalEventBus<S> =>
	bus as unknown as InternalEventBus<S>;
