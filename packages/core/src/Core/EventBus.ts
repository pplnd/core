import {
	EVENT_BUS_STATE,
	type EventBusForwardLink,
	type EventBusInternalState,
	type EventBusSubscription,
	toInternalEventBus,
} from "../internal/EventBus.util.ts";

// ---------------------------------------------------------------------------
// EventBus<S>
// ---------------------------------------------------------------------------

declare const _eventBusBrand: unique symbol;

/**
 * An event bus pipeline for a typed message schema `S`.
 *
 * `EventBus` provides typed event emission, sequence matching, state reduction,
 * and structural event bus forwarding with zero-overhead reentrant queuing.
 *
 * @example
 * ```ts
 * type AppMessages = {
 *   userLoggedIn: { userId: string };
 *   checkoutStarted: { amount: number };
 * };
 *
 * const appBus = EventBus.make<AppMessages>();
 *
 * const subscription = EventBus.subscribe(
 *   appBus,
 *   ["userLoggedIn", "checkoutStarted"],
 *   { ordered: true }
 * ).collect((payloads) => {
 *   console.log("Checkout started for:", payloads.userLoggedIn.userId);
 * });
 *
 * EventBus.emit(appBus, {
 *   kind: "userLoggedIn",
 *   value: { userId: "user-1" },
 * });
 * ```
 */
export type EventBus<S extends Record<string, unknown>> = {
	readonly id?: string;
	readonly [Symbol.toStringTag]?: string;
	readonly [_eventBusBrand]: (schema: S) => S;
};

export namespace EventBus {
	/**
	 * A discriminated union of all message types defined in an event schema `S`,
	 * optionally restricted to specific message keys `K`.
	 *
	 * Each variant conforms to `{ kind: Key, value: S[Key] }`.
	 */
	export type Message<S extends Record<string, unknown>, K extends keyof S & string = keyof S & string> = {
		[Key in K]: { kind: Key; value: S[Key]; };
	}[K];

	/**
	 * Configuration options for creating an `EventBus`.
	 */
	export type Options = {
		/**
		 * An optional diagnostic identifier for debugging, logging, and inspection.
		 */
		readonly id?: string;
	};

	/**
	 * Configuration options controlling event sequence matching, strictness, and lifecycle for `EventBus.subscribe`.
	 *
	 * @example
	 * ```ts
	 * const sub = EventBus.subscribe(
	 *   authBus,
	 *   ["credentialsSubmitted", "mfaPrompted", "sessionCreated"],
	 *   {
	 *     ordered: true,
	 *     strict: true,
	 *     reset: "authCancelled",
	 *     optional: ["mfaPrompted"],
	 *   },
	 * ).collect((payloads) => {
	 *   console.log("Onboarding complete", payloads);
	 * });
	 * ```
	 */
	export type SequenceOptions<S extends Record<string, unknown>, Opt extends keyof S & string = never> = {
		/**
		 * When `true`, events must be emitted in the exact order specified in the array.
		 * Intermediate out-of-order events are ignored (in relaxed mode) or reset the sequence (in strict mode).
		 *
		 * Defaults to `false` (events match independently or in any order).
		 */
		readonly ordered?: boolean;

		/**
		 * When `true` (and `ordered` is `true`), requires events in the sequence to be emitted consecutively
		 * without any intervening events. An unexpected event immediately resets sequence tracking to index 0.
		 *
		 * Defaults to `false` (events from outside the sequence are ignored while the sequence is in progress).
		 */
		readonly strict?: boolean;

		/**
		 * When `true`, automatically unsubscribes the subscriber immediately after the first successful
		 * match or sequence completion.
		 *
		 * Defaults to `false` (subscriber remains active for future emissions).
		 */
		readonly once?: boolean;

		/**
		 * One or more event kinds that, when emitted, immediately reset sequence progress back to index 0
		 * and clear any partially collected payloads.
		 */
		readonly reset?: (keyof S & string) | ReadonlyArray<keyof S & string>;

		/**
		 * One or more event kinds in the sequence that may be skipped. If the subsequent expected event
		 * arrives before an optional event, the optional step is bypassed without breaking the sequence.
		 *
		 * In `.collect()`, skipped optional events evaluate to `undefined` in the returned payloads.
		 */
		readonly optional?: Opt | ReadonlyArray<Opt>;
	};

	/**
	 * An active subscription handle returned by `EventBus.subscribe(...).reduce(...)`.
	 *
	 * Provides a getter for current accumulated state and an `unsubscribe` disposal function.
	 */
	export type Subscription<State> = { readonly unsubscribe: () => void; readonly getState: () => State; };

	/**
	 * Configuration options for forwarding events from one bus to another.
	 *
	 * When `only` is specified, allows forwarding between different event schemas as long as
	 * the selected event keys exist in both buses and their payload types are compatible.
	 * When `only` is omitted, the target bus schema must accept all events defined in the source bus.
	 * `Targets` can specify a readonly tuple of buses with different schemas; each target is checked.
	 */
	export type ForwardOptions<
		FromSchema extends Record<string, unknown>,
		ToSchema extends Record<string, unknown> = FromSchema,
		K extends keyof FromSchema & string = keyof FromSchema & string,
		Targets extends EventBus<any> | readonly EventBus<any>[] = EventBus<ToSchema> | ReadonlyArray<EventBus<ToSchema>>,
	> = {
		readonly from: EventBus<FromSchema>;
		readonly to: Targets & CompatibleForwardTargets<FromSchema, Targets, K>;
		readonly only: ReadonlyArray<K>;
	} | {
		readonly from: EventBus<FromSchema>;
		readonly to: Targets & CompatibleForwardTargets<FromSchema, Targets, keyof FromSchema & string>;
		readonly only?: ReadonlyArray<K>;
	};

	/**
	 * Typed record of aggregated sequence payloads. Required sequence steps are strictly typed
	 * as non-nullable values, while steps configured in `optional` evaluate to optional properties (`T | undefined`).
	 */
	export type CollectedPayloads<
		S extends Record<string, unknown>,
		K extends keyof S & string,
		Opt extends keyof S & string = never,
	> = { readonly [Key in Exclude<K, Opt>]: S[Key]; } & { readonly [Key in Extract<K, Opt>]?: S[Key]; };
}

type CompatibleForwardTargets<
	FromSchema extends Record<string, unknown>,
	Targets extends EventBus<any> | readonly EventBus<any>[],
	K extends keyof FromSchema & string,
> = Targets extends readonly EventBus<any>[]
	? {
		[I in keyof Targets]: Targets[I] extends EventBus<infer S>
			? S extends { [P in K]: FromSchema[P]; } ? Targets[I] : never
			: never;
	}
	: Targets extends EventBus<infer S> ? S extends { [P in K]: FromSchema[P]; } ? Targets : never
	: never;

/**
 * Initializes a new `EventBus` instance backed by private state.
 *
 * Allocates a per-kind subscriber index (kind buckets plus wildcard entries), a registration
 * registry for identity-based unsubscription, and a FIFO trampoline queue for reentrant dispatch.
 *
 * @internal
 */
const makeEventBus = <S extends Record<string, unknown>>(options?: EventBus.Options): EventBus<S> => {
	const busId = options?.id;
	return ({
		...(busId !== undefined ? { id: busId } : {}),
		[Symbol.toStringTag]: busId !== undefined ? `EventBus(${busId})` : "EventBus",
		[EVENT_BUS_STATE]: {
			options,
			registry: new Map(),
			buckets: new Map(),
			wildcards: [],
			queue: [],
			isEmitting: false,
			nextOrder: 0,
			lastKind: null,
			lastBucket: null,
		} as EventBusInternalState,
	}) as unknown as EventBus<S>;
};

/**
 * Forward links traversed by the delivery currently being dispatched.
 *
 * Every new `emit` starts with an empty ancestry; a forwarder appends its own link before
 * re-emitting. Each subscriber dispatch saves and restores this slot, so queued deliveries and
 * nested buses keep independent histories. This detects true cycles without rejecting acyclic
 * fan-in or sequential re-emissions.
 *
 * @internal
 */
const EMPTY_ANCESTRY: ReadonlySet<EventBusForwardLink> = new Set();
const ancestryState: { current: ReadonlySet<EventBusForwardLink>; } = { current: EMPTY_ANCESTRY };

/**
 * Drops the cached kind index after any subscriber mutation.
 *
 * @internal
 */
const invalidateDispatchCache = (internal: EventBusInternalState): void => {
	internal.lastKind = null;
	internal.lastBucket = null;
};

/**
 * Tombstone assigned to a removed subscriber so in-flight dispatch snapshots skip it.
 *
 * @internal
 */
const REMOVED_SUBSCRIBER = (): void => {};

/**
 * Registers a subscriber for the event kinds it observes.
 *
 * A `null` interest marks a wildcard subscriber that receives every event. Bucket arrays are
 * append-only while subscribers register, so they remain sorted by registration order.
 *
 * @internal
 */
const addSubscriber = (
	internal: EventBusInternalState,
	subscriber: (msg: unknown) => void,
	interest: ReadonlySet<string> | null,
): void => {
	const entry: EventBusSubscription = { order: internal.nextOrder++, subscriber, interest };
	internal.registry.set(subscriber, entry);
	if (interest === null) {
		internal.wildcards.push(entry);
	} else {
		for (const kind of interest) {
			const bucket = internal.buckets.get(kind);
			if (bucket === undefined) {
				internal.buckets.set(kind, [entry]);
			} else {
				bucket.push(entry);
			}
		}
	}
	invalidateDispatchCache(internal);
};

/**
 * Copies a bucket without the removed subscription.
 *
 * @internal
 */
const withoutEntry = (
	entries: readonly EventBusSubscription[],
	target: EventBusSubscription,
): EventBusSubscription[] => {
	const remaining: EventBusSubscription[] = [];
	for (let i = 0; i < entries.length; i++) {
		if (entries[i] !== target) { remaining.push(entries[i]); }
	}
	return remaining;
};

/**
 * Removes a subscriber from the registry and every bucket it was registered for.
 *
 * Bucket arrays are replaced instead of spliced so an in-flight dispatch keeps a stable snapshot,
 * and the entry itself is tombstoned so that snapshot skips it.
 *
 * @internal
 */
const removeSubscriber = (internal: EventBusInternalState, subscriber: (msg: unknown) => void): void => {
	const entry = internal.registry.get(subscriber);
	if (entry === undefined) { return; }
	internal.registry.delete(subscriber);
	entry.subscriber = REMOVED_SUBSCRIBER;
	if (entry.interest === null) {
		internal.wildcards = withoutEntry(internal.wildcards, entry);
	} else {
		for (const kind of entry.interest) {
			// Every interest kind still has a bucket: unsubscription only deletes a bucket after
			// the last entry for that kind is removed, and this entry is still in that bucket.
			const remaining = withoutEntry(internal.buckets.get(kind)!, entry);
			if (remaining.length === 0) {
				internal.buckets.delete(kind);
			} else {
				internal.buckets.set(kind, remaining);
			}
		}
	}
	invalidateDispatchCache(internal);
};

/**
 * Dispatches a message to every subscriber that observes its event kind.
 *
 * Kind buckets and the wildcard list are both sorted by registration order, so the two are merged
 * on the fly to preserve the documented delivery order. Entries removed during the dispatch were
 * tombstoned by {@link removeSubscriber}, and the captured entry counts keep late registrations out
 * of an in-flight message.
 *
 * @internal
 */
const dispatchToSubscribers = (
	internal: EventBusInternalState,
	msg: EventBus.Message<Record<string, unknown>>,
	ancestry: ReadonlySet<EventBusForwardLink>,
): void => {
	const { wildcards } = internal;
	let kinded: EventBusSubscription[] | undefined;
	if (internal.buckets.size !== 0) {
		if (msg.kind === internal.lastKind) {
			const cached = internal.lastBucket;
			kinded = cached === null ? undefined : cached;
		} else {
			const bucket = internal.buckets.get(msg.kind) ?? null;
			internal.lastKind = msg.kind;
			internal.lastBucket = bucket;
			kinded = bucket === null ? undefined : bucket;
		}
	}
	const wildcardCount = wildcards.length;
	const kindedCount = kinded === undefined ? 0 : kinded.length;
	if (wildcardCount === 0 && kindedCount === 0) { return; }

	const previousAncestry = ancestryState.current;
	ancestryState.current = ancestry;
	try {
		if (kindedCount === 0) {
			for (let i = 0; i < wildcardCount; i++) {
				wildcards[i].subscriber(msg);
			}
			return;
		}
		if (wildcardCount === 0) {
			for (let i = 0; i < kindedCount; i++) {
				kinded![i].subscriber(msg);
			}
			return;
		}
		let wildcardIndex = 0;
		let kindedIndex = 0;
		while (wildcardIndex < wildcardCount && kindedIndex < kindedCount) {
			const wildcardEntry = wildcards[wildcardIndex];
			const kindedEntry = kinded![kindedIndex];
			if (wildcardEntry.order < kindedEntry.order) {
				wildcardEntry.subscriber(msg);
				wildcardIndex++;
			} else {
				kindedEntry.subscriber(msg);
				kindedIndex++;
			}
		}
		while (wildcardIndex < wildcardCount) {
			wildcards[wildcardIndex++].subscriber(msg);
		}
		while (kindedIndex < kindedCount) {
			kinded![kindedIndex++].subscriber(msg);
		}
	} finally {
		ancestryState.current = previousAncestry;
	}
};

/**
 * Emits a message, dispatching directly when no emission loop is active and queueing only for
 * reentrant emissions.
 *
 * Employs a synchronous breadth-first queue trampoline:
 * 1. Marks `isEmitting = true` and dispatches the message immediately.
 * 2. Reentrant emissions push to `queue` and return; the active loop drains them in FIFO order.
 * 3. Always resets the queue and the emission flag, even when a subscriber throws.
 *
 * @internal
 */
const emitSingleBus = (
	bus: EventBus<Record<string, unknown>>,
	msg: EventBus.Message<Record<string, unknown>>,
	ancestry: ReadonlySet<EventBusForwardLink> = EMPTY_ANCESTRY,
): void => {
	const internal = toInternalEventBus(bus)[EVENT_BUS_STATE];
	if (internal.isEmitting) {
		internal.queue.push({ message: msg, ancestry });
		return;
	}
	internal.isEmitting = true;
	try {
		dispatchToSubscribers(internal, msg, ancestry);
		const { queue } = internal;
		let queueHead = 0;
		while (queueHead < queue.length) {
			const delivery = queue[queueHead++];
			dispatchToSubscribers(internal, delivery.message as EventBus.Message<Record<string, unknown>>, delivery.ancestry);
		}
	} finally {
		internal.queue.length = 0;
		internal.isEmitting = false;
	}
};

/**
 * Dispatches a message across one or more target event buses.
 *
 * @internal
 */
function emitEventBus<const M extends { kind: string; value: unknown; }, const B extends readonly EventBus<any>[]>(
	target:
		& B
		& { [I in keyof B]: B[I] extends EventBus<infer S> ? [M] extends [EventBus.Message<S>] ? B[I] : never : never; },
	message: M,
	ancestry?: ReadonlySet<EventBusForwardLink>,
): void;
function emitEventBus<S extends Record<string, unknown>, K extends keyof S & string>(
	target: EventBus<S> | ReadonlyArray<EventBus<S>>,
	message: EventBus.Message<S, K>,
	ancestry?: ReadonlySet<EventBusForwardLink>,
): void;
function emitEventBus(
	target: EventBus<any> | ReadonlyArray<EventBus<any>>,
	message: { kind: string; value: unknown; },
	ancestry?: ReadonlySet<EventBusForwardLink>,
): void {
	const msg = message as unknown as EventBus.Message<Record<string, unknown>>;
	if (Array.isArray(target)) {
		for (let i = 0; i < target.length; i++) {
			emitSingleBus(target[i] as unknown as EventBus<Record<string, unknown>>, msg, ancestry);
		}
	} else {
		emitSingleBus(target as unknown as EventBus<Record<string, unknown>>, msg, ancestry);
	}
}

/**
 * Connects a source `EventBus` to one or more target buses with optional event-kind filtering.
 *
 * @internal
 */
function forwardEventBus<
	FromSchema extends Record<string, unknown>,
	const K extends keyof FromSchema & string,
	const B extends readonly EventBus<any>[],
>(options: EventBus.ForwardOptions<FromSchema, FromSchema, K, B>): () => void;
function forwardEventBus<
	FromSchema extends Record<string, unknown>,
	ToSchema extends { [P in K]: FromSchema[P]; },
	const K extends keyof FromSchema & string,
>(options: EventBus.ForwardOptions<FromSchema, ToSchema, K>): () => void;
function forwardEventBus<
	FromSchema extends Record<string, unknown>,
	ToSchema extends { [P in keyof FromSchema]: FromSchema[P]; },
>(options: EventBus.ForwardOptions<FromSchema, ToSchema>): () => void;
function forwardEventBus(
	options: {
		readonly from: EventBus<Record<string, unknown>>;
		readonly to: EventBus<Record<string, unknown>> | ReadonlyArray<EventBus<Record<string, unknown>>>;
		readonly only?: ReadonlyArray<string>;
	},
): () => void {
	const filterSet = options.only ? new Set<string>(options.only) : null;
	const internalFrom = toInternalEventBus(options.from)[EVENT_BUS_STATE];

	const handler = (msg: unknown) => {
		const typedMsg = msg as EventBus.Message<Record<string, unknown>>;
		// A message that reaches this link again on the same ancestry has looped back. Acyclic
		// fan-in and sequential re-emissions start from separate ancestries and are not cycles.
		const ancestryChain = ancestryState.current;
		if (ancestryChain.has(handler)) {
			throw new Error(
				`EventBus: forwarding cycle detected for message kind "${typedMsg.kind}" on bus "${
					internalFrom.options?.id ?? "(anonymous)"
				}"`,
			);
		}
		const ancestry = new Set(ancestryChain);
		ancestry.add(handler);
		emitEventBus(options.to, typedMsg as any, ancestry);
	};

	addSubscriber(internalFrom, handler, filterSet);

	return () => {
		removeSubscriber(internalFrom, handler);
	};
}

type SchemaWideSubscriptionBuilder<S extends Record<string, unknown>> = {
	/**
	 * Accumulates state over all incoming events on the bus using a pure reducer function.
	 *
	 * @see {@link tap} for stateless side-effects without accumulating values.
	 *
	 * @example
	 * ```ts
	 * const eventCount = EventBus.subscribe(appBus).reduce((_msg, count) => count + 1, 0);
	 * ```
	 */
	readonly reduce: <State>(
		reducer: (msg: EventBus.Message<S, keyof S & string>, state: State) => State,
		initialState: State,
	) => EventBus.Subscription<State>;

	/**
	 * Registers a side-effect callback invoked on every event emitted on the bus.
	 *
	 * @see {@link reduce} for accumulating state over time.
	 *
	 * @example
	 * ```ts
	 * const unsubscribe = EventBus.subscribe(appBus).tap((msg) => {
	 *   console.log("Telemetry event:", msg.kind, msg.value);
	 * });
	 * ```
	 */
	readonly tap: (effect: (msg: EventBus.Message<S, keyof S & string>) => void) => () => void;
};

type TargetedSubscriptionBuilder<
	S extends Record<string, unknown>,
	K extends keyof S & string,
	Opt extends keyof S & string = never,
> = {
	/**
	 * Accumulates state over incoming matching events using a pure reducer function.
	 *
	 * @see {@link tap} for stateless side-effects without accumulating values.
	 * @see {@link collect} for aggregating sequence payloads into a typed object.
	 *
	 * @example
	 * ```ts
	 * const sub = EventBus.subscribe(cartBus, ["itemAdded", "itemRemoved"]).reduce(
	 *   (msg, count) => msg.kind === "itemAdded" ? count + 1 : count - 1,
	 *   0,
	 * );
	 * ```
	 */
	readonly reduce: <State>(
		reducer: (msg: EventBus.Message<S, K>, state: State) => State,
		initialState: State,
	) => EventBus.Subscription<State>;

	/**
	 * Registers a side-effect callback invoked when a matching event arrives.
	 *
	 * @see {@link reduce} for accumulating state over time.
	 * @see {@link collect} for aggregating sequence payloads into a typed object.
	 *
	 * @example
	 * ```ts
	 * const unsubscribe = EventBus.subscribe(authBus, "userLoggedIn").tap((msg) => {
	 *   analytics.track("login", msg.value);
	 * });
	 * ```
	 */
	readonly tap: (effect: (msg: EventBus.Message<S, K>) => void) => () => void;

	/**
	 * Aggregates all payloads from the specified events or sequence into a single typed dictionary,
	 * returning an unsubscribe disposer function.
	 *
	 * In ordered mode (`{ ordered: true }`), the callback fires each time the sequence completes in order
	 * (recurring on every completed sequence unless `{ once: true }` is set).
	 * In unordered mode, the callback fires each time all required events have been emitted at least once.
	 *
	 * Optional events that were skipped during sequence matching evaluate to `undefined`.
	 *
	 * @see {@link reduce} for continuous state reduction.
	 * @see {@link tap} for firing on individual matching events.
	 *
	 * @example
	 * ```ts
	 * EventBus.subscribe(
	 *   checkoutBus,
	 *   ["addressEntered", "paymentSubmitted"],
	 *   { ordered: true },
	 * ).collect((payloads) => {
	 *   completeCheckout(payloads.addressEntered, payloads.paymentSubmitted);
	 * });
	 * ```
	 */
	readonly collect: (effect: (payloads: EventBus.CollectedPayloads<S, K, Opt>) => void) => () => void;
};

/**
 * Subscribes to an `EventBus` with optional event filtering, sequence tracking, and payload reduction.
 *
 * @internal
 */
function subscribeEventBus<S extends Record<string, unknown>>(bus: EventBus<S>): SchemaWideSubscriptionBuilder<S>;
function subscribeEventBus<
	S extends Record<string, unknown>,
	K extends keyof S & string,
	const Opt extends NoInfer<K> = never,
>(
	bus: EventBus<S>,
	events: K | ReadonlyArray<K>,
	options?: EventBus.SequenceOptions<S, Opt>,
): TargetedSubscriptionBuilder<S, K, Opt>;
function subscribeEventBus(
	bus: EventBus<Record<string, unknown>>,
	events?: string | ReadonlyArray<string>,
	options?: EventBus.SequenceOptions<Record<string, unknown>, string>,
):
	| SchemaWideSubscriptionBuilder<Record<string, unknown>>
	| TargetedSubscriptionBuilder<Record<string, unknown>, string, string>
{
	const internal = toInternalEventBus(bus)[EVENT_BUS_STATE];

	if (events === undefined) {
		return {
			reduce: <State>(
				reducer: (msg: EventBus.Message<Record<string, unknown>, string>, state: State) => State,
				initialState: State,
			): EventBus.Subscription<State> => {
				let currentState = initialState;

				const subscriberFn = (rawMsg: unknown) => {
					currentState = reducer(rawMsg as EventBus.Message<Record<string, unknown>, string>, currentState);
				};

				addSubscriber(internal, subscriberFn, null);

				return { unsubscribe: () => removeSubscriber(internal, subscriberFn), getState: () => currentState };
			},

			tap: (effect: (msg: EventBus.Message<Record<string, unknown>, string>) => void): () => void => {
				const subscriberFn = (rawMsg: unknown) => {
					effect(rawMsg as EventBus.Message<Record<string, unknown>, string>);
				};

				addSubscriber(internal, subscriberFn, null);

				return () => removeSubscriber(internal, subscriberFn);
			},
		};
	}

	const eventList: ReadonlyArray<string> = Array.isArray(events) ? [...events] : [events];
	const isOrdered = options?.ordered ?? false;
	const isStrict = options?.strict ?? false;
	const isOnce = options?.once ?? false;
	const resetKinds = options?.reset
		? new Set<string>(Array.isArray(options.reset) ? options.reset : [options.reset])
		: null;
	const optionalKinds = options?.optional
		? new Set<string>(Array.isArray(options.optional) ? options.optional : [options.optional])
		: null;

	// Strict sequences react to every kind because an unrelated event resets progress. Every other
	// subscription reacts only to its selected kinds plus its reset kinds, which lets dispatch skip
	// it entirely for unrelated events.
	const interestKinds: Set<string> | null = isOrdered && isStrict ? null : new Set<string>(eventList);
	if (interestKinds !== null && resetKinds !== null) {
		for (const kind of resetKinds) {
			interestKinds.add(kind);
		}
	}

	const restartIndex = (kind: string): number => {
		let index = 0;
		while (index < eventList.length && eventList[index] !== kind && optionalKinds?.has(eventList[index])) {
			index++;
		}
		return eventList[index] === kind ? index + 1 : 0;
	};

	const createMatcher = (
		onMatch: (msg: EventBus.Message<Record<string, unknown>, string>) => void,
	): (msg: unknown) => void => {
		// Unordered subscriptions without reset rules are dispatched only for their selected kinds,
		// so the callback itself can be registered without a matching wrapper.
		if (!isOrdered && resetKinds === null) {
			return onMatch as (msg: unknown) => void;
		}

		let sequenceIndex = 0;

		return (rawMsg: unknown) => {
			const msg = rawMsg as EventBus.Message<Record<string, unknown>, string>;
			if (resetKinds !== null && resetKinds.has(msg.kind)) {
				sequenceIndex = 0;
				return;
			}

			if (!isOrdered) {
				onMatch(msg);
				return;
			}

			let expectedKind = eventList[sequenceIndex];

			if (expectedKind !== msg.kind && optionalKinds !== null) {
				let lookaheadIndex = sequenceIndex;
				while (
					lookaheadIndex < eventList.length
					&& optionalKinds.has(eventList[lookaheadIndex])
					&& eventList[lookaheadIndex] !== msg.kind
				) {
					lookaheadIndex++;
				}
				if (lookaheadIndex < eventList.length && eventList[lookaheadIndex] === msg.kind) {
					sequenceIndex = lookaheadIndex;
					expectedKind = eventList[sequenceIndex];
				}
			}

			if (msg.kind === expectedKind) {
				sequenceIndex++;
				if (sequenceIndex === eventList.length) {
					sequenceIndex = 0;
					onMatch(msg);
				}
			} else {
				sequenceIndex = restartIndex(msg.kind);
			}
		};
	};

	const collect = (effect: (payloads: Record<string, unknown>) => void): () => void => {
		let sequenceIndex = 0;
		let collected: Record<string, unknown> = {};

		const subscriberFn = (rawMsg: unknown) => {
			const msg = rawMsg as EventBus.Message<Record<string, unknown>, string>;

			if (resetKinds !== null && resetKinds.has(msg.kind)) {
				sequenceIndex = 0;
				collected = {};
				return;
			}

			if (!isOrdered) {
				collected[msg.kind] = msg.value;
				let hasAll = true;
				for (let i = 0; i < eventList.length; i++) {
					const k = eventList[i];
					if (!(k in collected) && (optionalKinds === null || !optionalKinds.has(k))) {
						hasAll = false;
						break;
					}
				}
				if (hasAll) {
					const result = { ...collected };
					collected = {};
					if (isOnce) {
						removeSubscriber(internal, subscriberFn);
					}
					effect(result);
				}
				return;
			}

			let expectedKind = eventList[sequenceIndex];

			if (expectedKind !== msg.kind && optionalKinds !== null) {
				let lookaheadIndex = sequenceIndex;
				while (
					lookaheadIndex < eventList.length
					&& optionalKinds.has(eventList[lookaheadIndex])
					&& eventList[lookaheadIndex] !== msg.kind
				) {
					lookaheadIndex++;
				}
				if (lookaheadIndex < eventList.length && eventList[lookaheadIndex] === msg.kind) {
					sequenceIndex = lookaheadIndex;
					expectedKind = eventList[sequenceIndex];
				}
			}

			if (msg.kind === expectedKind) {
				collected[msg.kind] = msg.value;
				sequenceIndex++;
				if (sequenceIndex === eventList.length) {
					sequenceIndex = 0;
					const result = { ...collected };
					collected = {};
					if (isOnce) {
						removeSubscriber(internal, subscriberFn);
					}
					effect(result);
				}
			} else {
				sequenceIndex = restartIndex(msg.kind);
				if (sequenceIndex > 0) {
					collected = { [msg.kind]: msg.value };
				} else {
					collected = {};
				}
			}
		};

		addSubscriber(internal, subscriberFn, interestKinds);

		return () => removeSubscriber(internal, subscriberFn);
	};

	return {
		reduce: <State>(
			reducer: (msg: EventBus.Message<Record<string, unknown>, string>, state: State) => State,
			initialState: State,
		): EventBus.Subscription<State> => {
			let currentState = initialState;

			const subscriberFn = createMatcher((msg) => {
				if (isOnce) {
					removeSubscriber(internal, subscriberFn);
				}
				currentState = reducer(msg, currentState);
			});

			addSubscriber(internal, subscriberFn, interestKinds);

			return { unsubscribe: () => removeSubscriber(internal, subscriberFn), getState: () => currentState };
		},

		tap: (effect: (msg: EventBus.Message<Record<string, unknown>, string>) => void): () => void => {
			const subscriberFn = createMatcher((msg) => {
				if (isOnce) {
					removeSubscriber(internal, subscriberFn);
				}
				effect(msg);
			});

			addSubscriber(internal, subscriberFn, interestKinds);

			return () => removeSubscriber(internal, subscriberFn);
		},

		collect,
	};
}

export const EventBus = {
	/**
	 * Constructs a new `EventBus` instance.
	 *
	 * @see {@link EventBus.emit} for dispatching messages to an event bus.
	 * @see {@link EventBus.subscribe} for registering subscribers or sequence matchers.
	 *
	 * @example
	 * ```ts
	 * const bus = EventBus.make<AppMessages>({ id: "app" });
	 * ```
	 */
	make: makeEventBus,

	/**
	 * Emits a message payload to one or more target event buses.
	 *
	 * Uses a synchronous breadth-first trampoline queue to handle re-entrant emissions deterministically.
	 *
	 * @see {@link EventBus.subscribe} for subscribing to emitted messages.
	 * @see {@link EventBus.forward} for routing messages between event buses.
	 *
	 * @example
	 * ```ts
	 * EventBus.emit(busA, {
	 *   kind: "userLoggedIn",
	 *   value: { userId: "user-1" },
	 * });
	 *
	 * EventBus.emit([busA, busB], {
	 *   kind: "userLoggedIn",
	 *   value: { userId: "user-1" },
	 * });
	 * ```
	 */
	emit: emitEventBus,

	/**
	 * Forwards messages from one event bus to another (or multiple).
	 *
	 * Forwarding a message back to a bus it already visited within the same emission throws an
	 * error naming the bus and message kind, breaking cycles such as `A → B → A` on the first
	 * repeat instead of delivering indefinitely.
	 *
	 * @see {@link EventBus.emit} for publishing messages directly.
	 * @see {@link EventBus.subscribe} for consuming events on a bus.
	 *
	 * @example
	 * ```ts
	 * const stop = EventBus.forward({
	 *   from: authBus,
	 *   to: analyticsBus,
	 *   only: ["userLoggedIn"],
	 * });
	 * ```
	 */
	forward: forwardEventBus,

	/**
	 * Initiates subscriber registration on an event bus for all events, specific event kind(s), or sequence.
	 *
	 * When called with only an event bus (`EventBus.subscribe(bus)`), observes every event defined on the bus schema.
	 * When called with event kinds, observes only matching events or sequences.
	 *
	 * @see {@link EventBus.emit} for dispatching messages to subscribers.
	 * @see {@link EventBus.forward} for bridging events across buses.
	 *
	 * @example
	 * ```ts
	 * // Schema-wide subscription:
	 * const unsubscribe = EventBus.subscribe(appBus).tap((msg) => {
	 *   console.log("Telemetry event:", msg.kind, msg.value);
	 * });
	 *
	 * // Targeted sequence subscription:
	 * const sub = EventBus.subscribe(
	 *   appBus,
	 *   ["userLoggedIn", "checkoutStarted"],
	 *   { ordered: true }
	 * ).collect((payloads) => {
	 *   console.log("Checkout initiated by", payloads.userLoggedIn.userId);
	 * });
	 * ```
	 */
	subscribe: subscribeEventBus,
};
