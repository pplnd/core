---
title: useMachine — Component-Owned State Machines
description: Interpret a machine per mount, render its variant state with guaranteed payloads, and tear it down with the component.
---

A self-service kiosk walks shoppers through select, pay, and dispense. A payment terminal can fault
mid-transaction, and a shopper can abandon the flow at any step — the display must show exactly one
of those realities, and the pay screen must never render without the payment session it displays. A
`boolean` per step cannot express "paying, with a session" versus "paying, session already voided",
so the invalid combinations compile and ship.

## Core Behavior

`useMachine` interprets a `Machine` for the component's lifetime: the current variant state with its
guaranteed payload, and a stable typed `send`.

- The hook owns the actor: it is created in the mount effect and aborted on unmount — entry and exit
  hooks run per mount, and nothing survives the component.
- `send` forwards the actor's canonical `{ kind, value }` event message shape; events sent before
  the actor starts (a child effect racing the mount effect) are queued and processed in order.
- The definition is frozen at mount: re-acquiring on definition identity churn would replay entry
  hooks, and a changed initial state is a remount concern — React's `key` prop.

One machine per invariant, not per section: a kiosk's payment session is one machine's variant
state, and screens are projections of it. Machines shared across components or outliving the
component are interpreted at module scope and bound with [`useActor`](/guides/use-actor/) instead.
The [Machine guide](/guides/machine/) covers transition tables and
[Reading the Types](/basics/types/) explains the variant-state definitions.

## Example: Kiosk Checkout

```tsx
const kioskMachine = Machine.make<KioskState, KioskEvents>({
	selecting: { on: { CARD_INSERTED: () => Machine.state("paying") } },
	paying: {
		entry: ({ send }) => authorizeTerminal().then((r) =>
			Result.matchValue(r, {
				ok: (session) => send({ kind: "PAYMENT_APPROVED", value: { session } }),
				err: (fault) => send({ kind: "TERMINAL_FAULT", value: { fault } }),
			}),
		),
		on: {
			PAYMENT_APPROVED: (_state, { session }) => Machine.state("dispensing", { session }),
			TERMINAL_FAULT: (_state, { fault }) => Machine.state("fault", { fault }),
		},
	},
	dispensing: { on: { TRAY_EMPTY: () => Machine.state("idle") } },
	fault: { on: { RESET: () => Machine.state("selecting") } },
	idle: { on: {} },
});

function KioskScreen() {
	const { state, send } = useMachine(kioskMachine, { initial: Machine.state("selecting") });

	return Machine.match(state, {
		selecting: () => <ItemGrid />,
		paying: () => <Terminal busy />,
		dispensing: ({ session }) => <Receipt session={session} />, // payload guaranteed here
		fault: ({ fault }) => <AttendantNotice fault={fault} />,
		idle: () => <SplashScreen />,
	});
}
```

### Handoff: Sharing the Machine Across Components

A kiosk with several screens — item grid, payment terminal, receipt printer — all projecting the
same flow does not re-interpret the machine per screen. Interpret it at module scope and bind it
with [`useActor`](/guides/use-actor/).

## Core Operations

| Operation                               | What it does                  | Result                                         |
| :-------------------------------------- | :---------------------------- | :--------------------------------------------- |
| `useMachine(machine, { initial, id? })` | Interprets and owns an actor. | `{ state, send }`.                             |
| `state`                                 | The current variant state.    | `Machine.match` in render; payload guaranteed. |
| `send({ kind, value })`                 | Forwards to `actor.send`.     | Returns the next state.                        |
| unmount                                 | Aborts the actor.             | Exit hooks run exactly once per mount.         |

### Inputs: the Actor Owns the Field State

A component's inputs bind to the actor with one `send` per field — there is no React state in the
default posture.

```tsx
const { state, send } = useActor(formActor, selectEmail);
return <input value={state.value.email}
	onChange={(e) => send({ kind: "EMAIL_COMMITTED", value: e.target.value })} />;
```

The transition table owns everything that follows from the input. A self-transition computes the
derived local state (validation, prerequisites); a transition handler that needs to inform other
domains emits onto the domain bus, which the global actor's inbound bus forwards by a declared
subset. One `send` per input — the cascade is whatever the table says, and nothing else. For
expensive per-keystroke work, keep the transition cheap and put the expensive reaction behind an
`Op` debounce strategy — see [`useOp`](/guides/use-op/).

## Failure Behavior and Edge Cases

Unhandled events return the current state unchanged — a `HALT` sent while `dispensing` is a no-op,
not a crash. Events sent before the actor starts are queued and processed in order, which covers a
child component firing an event in its own mount effect before the parent's effect runs.
StrictMode's double mount pairs entry and exit hooks per lifecycle: the discarded first actor is
aborted and its exit cleanup runs, so the surviving actor starts clean. Cross-machine event wiring
is a module-scope concern — interpret with a `bus` in `Component.state.ts` per the
[Machine guide](/guides/machine/), not in the hook.
