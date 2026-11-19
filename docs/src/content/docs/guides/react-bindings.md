---
title: React Bindings
description: What the hooks guarantee, where the control knobs are, and how render granularity works.
---

The `@pplnd/react` hooks attach stateful `@pplnd/core` objects — machines, `Op` managers, actors,
resources — to React components. One binding rule: hooks bind, they never create. The stateful
objects are built in plain TypeScript with zero React imports, unit-tested without a renderer, and
portable to any future adapter — React is one consumer of them, not their home. State changes only
through declared transitions, one writer per invariant, so a stale async result can never overwrite
a newer one and every re-render traces back to a transition you declared.

## The Control Knobs

Each layer of the binding exposes its own granularity, and every knob is plain TypeScript:

| Knob                         | What you control                                                                                              | Where                                                                |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------- |
| Machine transition tables    | Which events change which state, with which payload, and which entry/exit effects run.                        | `Machine.make`                                                       |
| Actor selectors              | Which slice of the state a component observes, compared by reference or custom equality.                      | `useActor(actor, selector)`                                          |
| `EventBus.subscribe` options | Which keys, in which order, with what strictness, what resets the match, and how delivery errors are handled. | `EventBus.subscribe(bus, keys, { ordered, strict, reset, onError })` |
| `EventBus.forward` subsets   | Which events cross a domain boundary — `only` is schema-checked in both directions.                           | `EventBus.forward({ from, to, only })`                               |
| `Op` strategies              | Debounce, queue, replace, throttle, restart, retry — before React ever sees a run.                            | `Op.interpret(op, { strategy })`                                     |

The EventBus options deserve a second look, because they replace implicit tracking with declared
matching. A subscription that requires `cardInserted` followed by `cardApproved` — in order,
strictly, resetting when the card is ejected — is four options on a subscribe call, and `collect`
delivers the completed sequence typed. Unordered, single-key delivery is the same API without the
options; [useEventBus](/guides/use-event-bus/) covers that case and [useActor](/guides/use-actor/)
shows a full multi-bus scene.

## Render Granularity and the Compiler

Granularity comes from three cooperating layers, each independent:

- **Machine-level**: a transition handler that returns the previous state object notifies no one — a
  no-op selection costs zero renders everywhere, including trees with no memoization.
- **Hook-level**: `useActor(actor, selector)` re-renders only when the projected slice's reference
  changes; untouched slices skip, provided transitions share structure.
- **Compiler-level**: the React Compiler auto-memoizes components, which covers the one gap
  selectors cannot — a subscribing parent re-rendering its children.

Measured on the reference benchmark (4 sliced sections, 120 cascading transitions per burst):
selector projections render 240 times, exactly matching hand-placed memoization; whole-state
subscriptions render 600; a subscribing parent above memoless sections also renders 600 — and with
the compiler enabled, back to 240 with zero code changes. A machine-level veto on same-value
transitions drops 120 spurious transitions to 2-5 renders in every posture.

The compiler is optional. Three consumer postures, correctness unaffected in all of them: manual
`memo` at subscribing-parent boundaries; no memo at all (parent cascades leak, bounded by the
machine veto); or the compiler enabled — one consumer-side config line for Vite, webpack, or
Next.js. The hooks are compiler-transparent, and the package's test suite compiles every hook under
both shipping compiler implementations (the Babel plugin and the native Rust port exposed through
SWC) so a bail-out fails CI instead of silently degrading memoization.

## Where the State Lives

The layout the package targets: state logic in a `Component.state.ts` file, rendering in the
component that imports from it. Machines, actors, `Op` managers, buses, and resources are built
there in plain TypeScript with zero React imports and unit-tested without a renderer. Per-instance
state is the deliberate exception — [`useMachine`](/guides/use-machine/) and
[`useResource`](/guides/use-resource/) create per mount and tear down with the component. Start with
[useLoad](/guides/use-load/) for the simplest case.
