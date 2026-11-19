---
title: useOpPoll — Polling on the Component Lifecycle
description: Start a manager's recurring schedule on mount, stop it on unmount, and re-poll when the interval or arguments change.
---

A delivery tracker refreshes each vehicle's position every fifteen seconds. The interval lives in
the manager's poll schedule; the bracket that starts it when the panel mounts and stops it when the
user closes the panel is easy to forget — a leaked polling loop keeps firing network requests
against a panel that no longer exists, and a changed interval leaves two schedules running.

## Core Behavior

`useOpPoll` is a thin lifecycle bracket over `manager.poll`: it starts the schedule on mount and
calls the returned stop function on unmount. No scheduling logic is added — the manager's
absolute-boundary monotonic clock, jitter behavior, and underlying strategy are unchanged.

- Changing the interval or the run arguments stops and restarts the schedule, so the new settings
  take effect on the next run.
- The initial run executes immediately when the schedule starts; repeats fire at or after each
  boundary.
- State observation composes through [`useOp`](/guides/use-op/) on the same manager — `useOp`
  renders the runs, `useOpPoll` drives them.

Reach for `useOpPoll` when a component's lifetime should bound a recurring run. For a
mount-triggered single run, use [`useLoad`](/guides/use-load/); for runs that need a concurrency
strategy without a schedule, bind the manager with [`useOp`](/guides/use-op/) alone.

## Example: Fleet Position Refresh

```tsx
const positionOp = Op.make((fleetId: string) => fetchPositions(fleetId));
const positionManager = Op.interpret(positionOp, { strategy: "restartable" });

function FleetPanel({ fleetId }: { fleetId: string }) {
	useOpPoll(positionManager, { every: Duration.seconds(15) }, fleetId);
	const { state } = useOp(positionManager);

	return Op.is.ok(state) ? <MapMarkers positions={state.value} /> : <Spinner />;
}
```

### Handoff: When the Polled Endpoint Starts Failing

A flaky upstream turns a fifteen-second poll into a fifteen-second error generator. Configure the
manager's retry policy or gate it with a [`CircuitBreaker`](/guides/circuit-breaker/) so the panel
backs off instead of hammering a failing endpoint.

## Core Operations

| Operation                                | What it does                      | Result                                |
| :--------------------------------------- | :-------------------------------- | :------------------------------------ |
| `useOpPoll(manager, { every }, ...args)` | Starts the schedule on mount.     | `void` — observe runs via `useOp`.    |
| `{ every: Duration }`                    | The repeat interval.              | Non-finite values schedule no repeat. |
| changed `every` or args                  | Stops and restarts the schedule.  | New run starts immediately.           |
| unmount                                  | Calls the returned stop function. | No further runs.                      |

## Failure Behavior and Edge Cases

The stop function from `manager.poll` is called on unmount and before every restart, so no schedule
outlives the component and no stale timer survives an interval change. A non-finite, zero, or
negative `every` schedules no repeat, but the initial run still executes — see the
[`Op`](/guides/op/) guide for the repeat boundary mechanics and [`Aborted`](/guides/aborted/) for
how an aborted in-flight run settles.
