---
title: useActor — Binding to a Shared Machine Actor
description: Subscribe a component to a module-scope machine actor, project slices with selectors, and never abort what you do not own.
---

A food-delivery app's cart is global: the header badge, the item list, and the checkout button all
render it, and adding an item in the list must move the badge. Re-interpreting a cart machine per
component gives every widget its own cart state, and a component subscribing by hand to the actor
re-renders on every transition — including the transitions whose slice it never reads.

## Core Behavior

`useActor` subscribes a component to an externally-owned `Machine.Actor` — one interpreted at module
scope in `Component.state.ts`. Subscription only: the actor outlives the component, and cleanup is
the unsubscribe alone.

- Without a selector, the component re-renders on every transition.
- With a selector, it re-renders only when the projected slice changes (reference comparison by
  default; custom `equality` as an opt-in). Projection requires structural sharing in the machine's
  payloads — a transition touching one slice must keep the others' references stable.
- `send` is a stable pass-through to `actor.send`: dispatching to a shared actor is a message, not
  ownership. The hook never aborts the actor.

Selectors are the value reads the render would perform anyway, hoisted to a typed boundary. Named
projections live in `Component.state.ts` and are unit-testable without a renderer. Repeating the
same selector shape across components is a signal the machine needs a narrower payload — reshape the
machine, not a helper.

## Example: Cart Badge and Item List

```tsx
// Cart.state.ts — module-scope actor + named projections
const cartActor = Machine.interpret(cartMachine, { initial: Machine.state("empty") });

const selectCount = (s: CartState) => ("items" in s.value ? s.value.items.length : 0);
const selectItems = (s: CartState) => ("items" in s.value ? s.value.items : null);

// HeaderBadge.view.tsx — re-renders only when the count changes
function HeaderBadge() {
	const { state: count } = useActor(cartActor, selectCount);
	return <Badge value={count} />;
}

// ItemList.view.tsx — re-renders only when the items slice changes
function ItemList() {
	const { state: items, send } = useActor(cartActor, selectItems);
	if (items === null) { return <EmptyCart />; }
	return items.map((item) => <ItemRow key={item.id} item={item} onRemove={() =>
		send({ kind: "ITEM_REMOVED", value: { id: item.id } })} />);
}
```

### Handoff: Cross-Domain Cart Updates

The cart must also react to other domains — a payment failure clears it, a promotion service applies
a discount. That coordination is a declared event protocol on a shared
[`EventBus`](/guides/event-bus/), interpreted with a `bus` in `Cart.state.ts`.

## Core Operations

| Operation                             | What it does                   | Result                                         |
| :------------------------------------ | :----------------------------- | :--------------------------------------------- |
| `useActor(actor)`                     | Subscribes to the whole state. | Re-renders on every transition.                |
| `useActor(actor, selector)`           | Projects a slice.              | Re-renders when the slice's reference changes. |
| `useActor(actor, selector, equality)` | Value-semantic slices.         | Custom comparison for the skip.                |
| `send({ kind, value })`               | Forwards to `actor.send`.      | Returns the next state.                        |

### Wiring the Cart Into Other Domains

The cart does not live alone. A promotions domain recalculates discounts when the cart changes, and
a checkout domain needs the cart plus the promotions result. Each domain owns an outbound bus with
its own schema, and a consumer forwards exactly the events it understands into its own inbound bus —
`only` is checked against both schemas, so forwarding a nonexistent key is a compile error.

```ts
// Cart.state.ts — the cart publishes its protocol; handlers in its transition table emit onto it
export const cartBus = EventBus.make<{
	readonly itemAdded: { readonly id: string; readonly price: number };
	readonly cartCleared: void;
}>();

// Promotions.state.ts — promotions reacts to the cart, and only to the cart
export const promoBus = EventBus.make<{ readonly discountApplied: { readonly percent: number } }>();
const promoInbound = EventBus.make<{
	readonly itemAdded: { readonly id: string; readonly price: number };
	readonly cartCleared: void;
}>();
EventBus.forward({ from: cartBus, to: promoInbound, only: ["itemAdded", "cartCleared"] });

export const promoActor = Machine.interpret(promoMachine, {
	initial: Machine.state("none"),
	bus: promoInbound, // forwarded cart events reach the promotions transition table
});
```

Each domain keeps its own bus, so promotions cannot emit onto the cart's protocol and checkout
cannot observe promotions events it never asked for. The dependency graph is the set of `forward`
calls — visible, schema-checked, and grep-able.

### Controlling a Checkout Sequence

Payment terminals deliver events in a meaningful order: card inserted, then approved. A component
that reacts to that sequence declares the order, the strictness, and what resets it — the same bus
API, with options.

```tsx
function CheckoutPanel({ sessionBus }: { sessionBus: EventBus<SessionEvents> }) {
	const [phase, setPhase] = useState<"waiting" | "authorizing">("waiting");

	useEffect(() => EventBus.subscribe(
		sessionBus,
		["cardInserted", "cardApproved"],
		{ ordered: true, strict: true, reset: "cardEjected" },
	).collect((payloads) => {
		setPhase("authorizing");
		approve(payloads.cardInserted, payloads.cardApproved);
	}), [sessionBus]);

	return phase === "authorizing" ? <Spinner /> : <InsertCard />;
}
```

`ordered: true` ignores out-of-order noise, `strict: true` resets the sequence on any unexpected
event, `reset: "cardEjected"` restarts the match when the terminal gives up, and `collect` hands the
component every payload of the completed sequence, typed. If a delivery callback throws, the
subscription's `onError` decides whether delivery continues or propagates. This is the same
`EventBus` the [EventBus guide](/guides/event-bus/) introduces — the options are always there;
[`useEventBus`](/guides/use-event-bus/) covers the single-key case, and a component drops to the
full API when a sequence needs it.

### Handoff: When an Event Should Change Machine State

A bus event that must *transition* a machine — session expired, cart cleared — belongs in the
machine's transition table via a bus subscription, not in a component handler. See the
[Machine guide](/guides/machine/) for the inbound wiring and [`useMachine`](/guides/use-machine/)
for per-component ownership.

## Failure Behavior and Edge Cases

The hook never aborts the actor — unmounting every subscriber leaves the machine running for the
next subscriber. Selector skips are reference comparisons: if a transition rebuilds a payload
without structural sharing, every selector matches and nothing is skipped — fix the payload, not the
selector. A subscribing parent re-renders its children regardless of their selectors; keep
subscription hooks in leaves, or target the React Compiler, which memoizes automatically and covers
the same gap. For machines owned per component, use [`useMachine`](/guides/use-machine/) instead.
