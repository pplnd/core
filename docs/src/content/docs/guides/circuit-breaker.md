---
title: CircuitBreaker — Protecting a Dependency
description: Pause calls to a failing dependency and allow controlled recovery probes.
---

<!-- BUNDLE_SIZE:START -->

> 2.77 kB minified + gzipped

<!-- BUNDLE_SIZE:END -->

## Core Behavior

When a package registry is unavailable, repeated requests can add load while it recovers.
`CircuitBreaker` runs fallible tasks and temporarily blocks calls after enough qualifying failures.
A blocked call returns an error without running its task.

- In `Closed`, protected tasks run and qualifying failures count toward the threshold.
- In `Open`, calls return `CircuitBreaker.OpenError` until the cooldown has elapsed.
- In `HalfOpen`, one probe runs at a time. Enough successful probes close the circuit; a qualifying
  failure opens it again.

## Example: Package Registry Requests

A build service retrieves package metadata from a registry. If the registry repeatedly fails, the
service can pause requests briefly and then try one request to check recovery.

The breaker opens after the configured number of failures. Once the cooldown has elapsed, the next
protected call is admitted as a probe:

```mermaid
stateDiagram-v2
  direction TB
  [*] --> Closed
  Closed --> Open : qualifying failure threshold
  Open --> HalfOpen : cooldown elapsed and next call
  HalfOpen --> Open : qualifying probe failure
  HalfOpen --> Closed : recovery threshold reached
```

### Protecting a Registry Request

`Task.Result.tryCatch` turns request failures into strings. The protected task can also return a
`CircuitBreaker.OpenError` while the circuit is blocking calls:

```ts
import { CircuitBreaker, Duration, Result, Task, pipe } from "@pplnd/core";

const registry = CircuitBreaker.make<string>({
  failureThreshold: 2,
  resetTimeout: Duration.seconds(30),
});

const readPackage = (name: string): Task.Result<string, string> =>
  Task.Result.tryCatch(
    async (signal) => {
      const response = await fetch(`/registry/${encodeURIComponent(name)}`, { signal });
      if (!response.ok) throw new Error(`Registry HTTP ${response.status}`);
      return response.text();
    },
    { onError: (error) => String(error) },
  );

const packageDescription = async (name: string): Promise<string> => {
  const outcome = await registry.run(readPackage(name));
  return pipe(
    outcome,
    Result.match({
      ok: (description) => description,
      err: (error) =>
        CircuitBreaker.is.openError(error)
          ? `Registry cooling down; retry after ${error.retryAfterMs}ms`
          : `Registry request failed: ${error}`,
    }),
  );
};

console.log(await packageDescription("parser"));
```

## Core Operations

### Creating and Protecting

| Signature                                                 | What it does                                             | Result                                                         |
| :-------------------------------------------------------- | :------------------------------------------------------- | :------------------------------------------------------------- |
| `CircuitBreaker.make(config)`                             | Creates a breaker with a failure threshold and cooldown. | A breaker instance.                                            |
| `breaker.run(task, { signal })`                           | Starts a protected `Task.Result`.                        | A deferred result that can include `CircuitBreaker.OpenError`. |
| `breaker.state()`                                         | Reads the current state.                                 | `Closed`, `Open`, or `HalfOpen`.                               |
| `breaker.subscribe(listener)`                             | Observes state notifications.                            | An unsubscribe function.                                       |
| `breaker.reset()`                                         | Clears the recorded failures and closes the circuit.     | `void`.                                                        |
| `CircuitBreaker.is.openError/closed/open/halfOpen(value)` | Checks an error or state.                                | Type guard.                                                    |

`failureThreshold` sets the number of failures needed to open. `resetTimeout` controls the cooldown.
`successThreshold` sets the number of recovery probes needed to close and defaults to one.
`shouldTrip` selects which errors count. With `failureWindow`, qualifying failures are counted over
that duration; without it, successful calls reset the consecutive-failure count.

## Failure Behavior and Edge Cases

A non-tripping error still reaches the caller. During a recovery probe it also counts toward the
recovery threshold, because `shouldTrip` classifies it as not indicating an unavailable dependency:

```ts
import { CircuitBreaker, Duration, Task } from "@pplnd/core";

const registry = CircuitBreaker.make<string>({
  failureThreshold: 1,
  resetTimeout: Duration.milliseconds(0),
  shouldTrip: (error) => error !== "package not found",
});

await registry.run(Task.Result.make.err("registry unavailable"));
// The cooldown has elapsed, so registry.state().kind is "HalfOpen".
await registry.run(Task.Result.make.err("package not found"));
// The caller receives Err("package not found"); registry.state().kind is "Closed".
```

A concurrent call during an active probe receives `CircuitBreaker.OpenError` with `retryAfterMs` of
zero. `state()` can report `HalfOpen` after the cooldown even before a call starts a probe.

`reset()` closes the circuit and clears its failure history. It does not cancel an in-flight probe:
the original caller receives that task's result, but the old probe cannot change the breaker's state
after reset. To request cancellation, pass a signal to `run` and abort its controller separately.

Protected tasks must not throw or reject. Use `Task.Result.tryCatch` to map expected failures before
passing a task to the breaker. An aborted task does not count toward the failure threshold. The
breaker forwards the signal to the task and waits for its result; the task must cooperate with
cancellation to stop its work.
