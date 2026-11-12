---
title: Supervisor — Keeping a Worker Running
description: Restart a long-running task under a retry policy and report its running state.
---

<!-- BUNDLE_SIZE:START -->

> 2.58 kB minified + gzipped

<!-- BUNDLE_SIZE:END -->

A worker that drains an outbox runs in a loop for as long as the process lives. One failed iteration
ends it: a reset connection makes the attempt return an error, the loop stops, and the process keeps
serving traffic with an outbox that nothing is draining. The failure leaves one log line, so the
backlog is the first thing anyone notices.

## Core Behavior

`Supervisor` runs one long-running task for the life of a process and restarts it when it fails.

- One execution of the task is one attempt. `Ok` ends the lifetime as `Stopped("completed")`.
- `Err` matching `restart.when` is restarted after `restart.getDelay(attempt)`, while attempts
  remain. Any other error ends the lifetime with that error and state `Failed`.
- `abort()` stops the lifetime; it cancels a pending backoff immediately and waits for a running
  attempt to settle before reporting `Stopped("aborted")`.
- State is observable while the process runs, so a health endpoint can report it.

The restart policy is a [`RetryPolicy`](/guides/op/), reused unchanged: `attempts`, backoff, jitter,
`when`, and `onRetry` mean what they mean for a single call. Its nearest sibling is
[`CircuitBreaker`](/guides/circuit-breaker/): both are live engines with `run`, `state`, and
`subscribe`, but a breaker stops calling a dependency while a supervisor keeps the work alive. The
[choosing guide](/basics/choosing/) places it next to the other execution modules, and
[Reading the Types](/basics/types/) covers why both are instances from creation.

## Example: Outbox Worker

The worker drains an outbox in a loop and returns when its signal aborts. The supervisor restarts it
when it crashes, waits between attempts, and reports `Running`, `BackingOff`, `Stopped`, or `Failed`
to the health endpoint.

```mermaid
stateDiagram-v2
  direction TB
  [*] --> Idle
  Idle --> Running : run starts the lifetime
  Running --> BackingOff : attempt failed and restart applies
  BackingOff --> Running : delay elapsed
  Running --> Stopped : attempt succeeded
  Running --> Stopped : abort and the attempt returns
  BackingOff --> Stopped : abort
  Running --> Failed : error not restarted
  Stopped --> Running : run starts another lifetime
  Failed --> Running : run starts another lifetime
```

### Starting the Lifetime

```ts
import { Duration, RetryPolicy, Supervisor, Task } from "@pplnd/core";

type OutboxError = { readonly kind: "OutboxFailed"; readonly message: string; };

const toOutboxError = (error: unknown): OutboxError => ({ kind: "OutboxFailed", message: String(error) });

const drainOutbox = (signal?: AbortSignal): Task.Result<OutboxError, void> =>
  Task.Result.tryCatch(
    async (innerSignal) => {
      while (!innerSignal?.aborted) {
        const batch = await claimBatch(innerSignal);
        if (batch.length > 0) {
          await deliver(batch);
        }
      }
    },
    { onError: toOutboxError },
  );

const outbox = Supervisor.make(drainOutbox, {
  restart: RetryPolicy.exponential({
    attempts: 5,
    initial: Duration.seconds(1),
    jitter: true,
    maxDelay: Duration.seconds(30),
  }),
});

outbox.subscribe((state) => health.report(state.kind));

const lifetime = outbox.run();
process.on("SIGTERM", () => outbox.abort());

const outcome = await lifetime;
// Ok({ kind: "SupervisorStopped", reason: "aborted" }) after shutdown
// Err(OutboxError) after five failed attempts
```

`run` returns one deferred for the whole lifetime, and a second call while it is active returns that
same deferred. `abort` does not settle it immediately: the running attempt receives an aborted
signal, and the lifetime ends when that attempt returns, so `await lifetime` is the shutdown wait.

### Reading the State

```ts
import { Supervisor } from "@pplnd/core";

const state = outbox.state();
if (state.kind === "SupervisorBackingOff") {
  // the next attempt starts in state.delay, after state.error
}

const unsubscribe = outbox.subscribe((next) => {
  if (next.kind === "SupervisorFailed") {
    console.error("outbox stopped after", next.attempts, "attempts:", next.error);
  }
});
```

Subscribers run as the state changes, and the final one runs after the lifetime settles. A listener
may call `run()` or `abort()` synchronously; when that call changes the state during the
notification, the listeners after it receive the newer state, and the superseded one is not
delivered again. Listeners must not throw, and `subscribe` returns an unsubscribe function.
[`EventBus`](/guides/event-bus/) is the right tool for broadcasting events to many consumers; this
listener exists for lifecycle telemetry only.

### Pacing the Deliveries

The provider allows 60 deliveries a minute, and the loop above does not know that. The limiter is
created once, outside the task, so a restart does not reset the recorded window:

```ts
import { Duration, RateLimiter, Result, Task } from "@pplnd/core";

const deliveries = RateLimiter.make({
  limit: 60,
  window: Duration.minutes(1),
  maxWait: Duration.seconds(10),
});

const deliverBatch = (batch: readonly Message[]) =>
  deliveries.run(Task.Result.tryCatch(() => deliver(batch), { onError: toOutboxError }));

// in drainOutbox, replacing the direct deliver call
const receipt = await deliverBatch(batch);
if (Result.is.err(receipt)) {
  throw receipt.error;
}
```

A refusal is an `Err`, so the attempt fails and the supervisor restarts it after its own backoff.
The [RateLimiter guide](/guides/rate-limiter/) covers the queueing and rejection strategies; the
seam here is that pacing lives beside the task, not inside one attempt, so a restart continues the
same window.

## Core Operations

### Creating and Running

| Signature                            | What it does                                     | Result                                  |
| :----------------------------------- | :----------------------------------------------- | :-------------------------------------- |
| `Supervisor.make(task, { restart })` | Creates a supervisor around a long-running task. | A supervisor instance                   |
| `supervisor.run()`                   | Starts the lifetime.                             | `Deferred` that settles when it ends    |
| `supervisor.run({ signal })`         | Starts it with caller cancellation.              | Same deferred, aborted by the signal    |
| `supervisor.abort()`                 | Stops the lifetime.                              | `void`; await the lifetime for shutdown |

`restart` is a `RetryPolicy`: `attempts` counts every run, `getDelay` spaces them, `when` filters
restarted errors, and `onRetry` observes each scheduled restart. A non-positive-integer `attempts`
means one attempt, matching the rest of the library.

### Reading State

| Signature                        | What it does               | Result                                                  |
| :------------------------------- | :------------------------- | :------------------------------------------------------ |
| `supervisor.state()`             | Reads the lifecycle state. | `Idle`, `Running`, `BackingOff`, `Stopped`, or `Failed` |
| `supervisor.subscribe(listener)` | Observes transitions.      | An unsubscribe function                                 |

`Running` carries `restarts`, the number of attempts that already failed. `BackingOff` carries the
failed `attempt`, the `delay` before the next one, and its `error`. `Stopped` carries the `reason`,
either `"completed"` or `"aborted"`. `Failed` carries `attempts` and the final error.

## Failure Behavior and Edge Cases

An attempt that returns `Ok` ends the lifetime, so a task that swallows its failures will look
healthy and stop the supervisor from restarting it. Report expected failures as `Err`.

Aborting during a backoff settles the lifetime immediately and clears the timer, and this includes
aborting from a subscriber reacting to the `BackingOff` notification: the lifetime ends on the spot,
and no further attempt runs after it. Aborting from inside `onRetry` behaves the same way — the
lifetime settles as `Stopped("aborted")`, and `BackingOff` is never published after `Stopped`.
Aborting during an attempt signals that attempt and waits: a task that ignores its signal delays
shutdown, because [cancellation](/guides/aborted/) is cooperative and the supervisor will not report
a clean stop while work continues. Aborting with no lifetime active is a no-op, and a second abort
while stopping is ignored.

After a lifetime ends, `run()` starts a new one, which lets a health probe or an operator re-arm a
stopped worker. The previous state remains readable until that call.

[`Task.Result.timeout`](/guides/task/) does not belong inside the task, because a per-attempt
deadline would turn a healthy long-running loop into repeated restarts; bound individual operations
instead.
