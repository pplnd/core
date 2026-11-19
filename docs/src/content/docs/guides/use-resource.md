---
title: useResource — Acquire on Mount, Release on Unmount
description: Acquire a fallible resource into a hook-owned scope, render its lifecycle as RemoteData, and release it LIFO when the component dies.
---

A clinic's tablet app pairs with a label printer at the reception desk. Pairing is fallible — the
printer can be offline or already claimed by another tablet — the session must stay open for the
tablet's whole shift, and closing the browser tab must free the printer for the next tablet, even
mid-pairing. A hand-rolled effect acquires, stores the handle in state, and releases in a cleanup
that may never run if the component unmounts before acquisition finishes.

## Core Behavior

`useResource` acquires a `Resource` on mount into a hook-owned scope and renders the acquisition
lifecycle as a `RemoteData` — `NotAsked`, `Loading`, `Failure`, or `Success`, with no separate
"acquiring" flag.

- The hook owns one scope per component instance: `dispose` on unmount releases every acquired asset
  in reverse (LIFO) acquisition order.
- Disposal racing an in-flight acquisition is deterministic: the acquisition settles normally and
  the asset is released immediately — StrictMode's mount → unmount → remount never holds two
  printers or loses a release.
- The hook-owned `AbortSignal` is forwarded to the acquisition, and a settling result from a
  discarded mount is dropped before it can re-render.
- The resource is frozen at mount. There is no `reacquire` — React's `key` prop is the native
  bracket-reset for a changed asset.

`useResource` is the long-lived counterpart of [`Resource.use`](/guides/resource/), which ties
acquisition to a single callback. When the component's job is only to *load* a value with no release
obligation, use [`useLoad`](/guides/use-load/) instead — a resource exists precisely because closing
it matters.

## Example: Pairing a Label Printer

```tsx
const printerSession = Resource.make(
	Task.Result.tryCatch((signal) => pairPrinter(deskId, signal), { onError: toPairingError }),
	(session) => session.close(),
);

function ReceptionTerminal() {
	const { state } = useResource(printerSession);

	return RemoteData.matchValue(state, {
		notAsked: () => null,
		loading: () => <PairingSpinner />,
		failure: (error) => <PairingError error={error} />,
		success: () => <LabelWorkflow />,
	});
}
```

### Handoff: Loading Data Through the Held Session

The pairing succeeded; the labels themselves load through the session and change with the day's
schedule. That is a load, not a resource: run it with [`useLoad`](/guides/use-load/) through the
held session, or drive it with an [`Op`](/guides/op/) manager when refresh needs a strategy.

## Core Operations

| Operation               | What it does                               | Result                                    |
| :---------------------- | :----------------------------------------- | :---------------------------------------- |
| `useResource(resource)` | Acquires on mount into a hook-owned scope. | `{ state: RemoteData<E, A> }`.            |
| `state`                 | The acquisition lifecycle.                 | `RemoteData.matchValue` in render.        |
| unmount                 | Aborts acquisition, disposes the scope.    | LIFO release; nothing held past disposal. |

## Failure Behavior and Edge Cases

Only a successful acquisition holds an asset: a `Failure` registers nothing to release, so an
unmount after a failed pairing releases nothing. Disposal is idempotent — StrictMode's double mount
runs every finalizer exactly once per acquisition and never holds two printers. A disposal that
races an in-flight acquisition settles it normally and releases immediately; the discarded mount's
result is dropped before it can repaint. Acquisitions that honor their signal stop early; ones that
ignore it still release at disposal — see [`Aborted`](/guides/aborted/) for cancellation semantics
and the [`Resource` guide](/guides/resource/) for the scope's LIFO rules.
