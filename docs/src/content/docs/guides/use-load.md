---
title: useLoad — Mount-Triggered Loading Without Boolean Flags
description: Run a fallible task when a component mounts, render its lifecycle as RemoteData, and drop stale results before they can repaint.
---

An image viewer loads the original file for whichever photo is selected. The user scrolls the
filmstrip fast: photo 12 is requested, then photo 13, then photo 15. The request for photo 12
finishes last, and a hand-rolled effect writes its stale bytes into state — the viewer now shows
photo 12 under photo 15's caption. The cleanup code that should have prevented this is an
`AbortController`, a `cancelled` flag, and a guard before every `setState`; miss one and the bug
ships.

## Core Behavior

`useLoad` runs a `Task.Result` when the component mounts and exposes its lifecycle as a `RemoteData`
— one value that is `NotAsked`, `Loading`, `Failure`, or `Success`, never two booleans contradicting
each other.

- The hook owns the `AbortSignal`: on unmount or dependency change the signal aborts, and the result
  of any run that settles afterwards is dropped before it can trigger a re-render.
- By default the previous `Success` or `Failure` stays visible while the next run is pending;
  `keepPrevious: false` resets to `Loading` per run instead.
- `reload` restarts the task with a fresh signal without touching the deps array.
- Server render is safe by construction: `Task` is a lazy thunk, so no request starts outside an
  effect and SSR produces `NotAsked`.

Reach for `useLoad` when the component's only job is "run this once mounted, re-run when this value
changes". The moment a run needs a concurrency strategy — debouncing keystrokes, queueing saves,
dropping overlapping clicks — build an [`Op`](/guides/op/) manager outside React and bind it with
[`useOp`](/guides/use-op/) instead. The [choosing guide](/basics/choosing/) compares the load
containers side by side.

## Example: Racing Photo Loads

```tsx
import { useLoad } from "@pplnd/react";
import { RemoteData, Task } from "@pplnd/core";

const loadOriginal = (photoId: string) =>
	Task.Result.tryCatch(
		(signal) => fetchOriginal(photoId, signal),
		{ onError: (e) => new GalleryError(e) },
	);

function OriginalViewer({ photoId }: { photoId: string }) {
	const { state, reload } = useLoad(loadOriginal(photoId), { deps: [photoId] });

	return RemoteData.matchValue(state, {
		notAsked: () => null,
		loading: () => <Spinner />,
		failure: (error) => <ErrorNotice error={error} onRetry={reload} />,
		success: (original) => <Photo bytes={original} />,
	});
}
```

### Handoff: When Loading Needs a Strategy

Scroll-fast races are gone, but a search box needs debouncing and a save button needs queueing.
Those are decisions the manager makes, not React: configure an `Op` with a strategy and bind it with
[`useOp`](/guides/use-op/).

## Core Operations

| Operation                                  | What it does                               | Result                                           |
| :----------------------------------------- | :----------------------------------------- | :----------------------------------------------- |
| `useLoad(task, { deps? , keepPrevious? })` | Runs the task on mount and on deps change. | `{ state: RemoteData<E, A>, reload }`.           |
| `state`                                    | The four-variant lifecycle.                | `RemoteData.matchValue` in render.               |
| `reload()`                                 | Restarts with a fresh signal.              | Does not touch deps; keeps `Success` by default. |

## Failure Behavior and Edge Cases

The task's error becomes `Failure` — acquisition errors are values, not throws, so the component
renders them like any other variant. A result that settles after its epoch was superseded is
discarded before it can repaint; StrictMode's double mount produces one discarded aborted run and
one surviving run. Dependencies are compared with `Object.is`; pass primitives or stable references.
The hook owns cancellation end to end — see [`Aborted`](/guides/aborted/) for how `Task` treats
signal aborts. For full lifecycle mechanics, see [`Task.Result`](/guides/task/).
