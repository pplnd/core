---
title: Transaction — Steps and Compensation
description: Run dependent asynchronous steps and compensate completed steps after a failure.
---

<!-- BUNDLE_SIZE:START -->

> 5.21 kB minified + gzipped

<!-- BUNDLE_SIZE:END -->

## Core Behavior

`Transaction` runs a sequence of `Task.Result` steps. A step declares which earlier outputs it
needs, and each run can supply its own input.

- A step can provide an `undo` action. If a later step fails, completed steps with undo actions are
  compensated in reverse order.
- The failure includes the failing step ID, its error, and any errors from undo actions. A failed
  undo does not prevent earlier undo actions from running.
- `Transaction.run` starts the steps and returns a deferred result.

## Example: Publishing a Document

A publisher uploads a document, adds it to a catalog, and sends a notification. If notification
fails, the publisher needs to remove the catalog entry and uploaded document.

Only successful steps register undo actions. When a step returns an error, the transaction runs the
registered actions in reverse order and retains the original error:

```mermaid
flowchart TD
  Step["Run next step"] --> Outcome{"Result"}
  Outcome -->|Ok| Register["Store output and optional undo"]
  Register --> More{"More steps?"}
  More -->|Yes| Step
  More -->|No| Success["Ok(all step outputs)"]
  Outcome -->|Err| Undo["Run completed undo actions in reverse order"]
  Undo --> Failure["Err(step error and undo errors)"]
```

### Publishing and Rolling Back

This runnable example uses in-memory sets to represent the storage and catalog services. The
notification fails, so the first two steps are undone:

```ts
import { Task, Transaction } from "@pplnd/core";

const storage = new Set<string>();
const catalog = new Set<string>();
const events: string[] = [];

const upload = (name: string): Task.Result<string, string> => Task.Result.tryCatch(
  async () => { storage.add(name); events.push("uploaded"); return name; },
  { onError: String },
);
const removeUpload = (name: string): Task.Result<string, void> => Task.Result.tryCatch(
  async () => { storage.delete(name); events.push("deleted upload"); },
  { onError: String },
);
const index = (name: string): Task.Result<string, string> => Task.Result.tryCatch(
  async () => { catalog.add(name); events.push("indexed"); return name; },
  { onError: String },
);
const removeIndex = (name: string): Task.Result<string, void> => Task.Result.tryCatch(
  async () => { catalog.delete(name); events.push("removed index"); },
  { onError: String },
);

const uploadStep = Transaction.step({
  id: "upload",
  run: () => (name: string) => upload(name),
  undo: (name) => removeUpload(name),
});
const indexStep = Transaction.step({
  id: "index",
  deps: { upload: uploadStep },
  run: ({ upload }) => () => index(upload),
  undo: (name) => removeIndex(name),
});
const notifyStep = Transaction.step({
  id: "notify",
  run: () => () => Task.Result.make.err("Notification unavailable"),
});
const publish = Transaction.make(uploadStep, indexStep, notifyStep);

const result = await Transaction.run(publish, { input: "report.pdf" });
// Err: stepId "notify", error "Notification unavailable", undoErrors []
// events: ["uploaded", "indexed", "removed index", "deleted upload"]
```

The failed `notify` step has no completed output to undo. Undo actions run without the transaction's
abort signal so they can attempt cleanup after cancellation.

## Core Operations

| Signature                               | What it does                                    | Result or behavior                              |
| :-------------------------------------- | :---------------------------------------------- | :---------------------------------------------- |
| `Transaction.step(config)`              | Defines a step and its named dependencies.      | A reusable step definition.                     |
| `Transaction.make(...steps)`            | Assembles steps in execution order.             | Rejects duplicate or out-of-order dependencies. |
| `Transaction.run(transaction, options)` | Starts the steps with optional input and hooks. | Deferred result of outputs or failure details.  |

A step's `run` receives dependency outputs, then per-run input; when the input is unused, write
`run: () => () => task`. A step can also specify a retry policy and timeout. Run options accept an
`AbortSignal` and `onStepSuccess`, `onStepFailure`, and `onUndo` callbacks.

`make` checks that each dependency is the same step object supplied earlier in the sequence. Literal
step IDs catch many ordering errors in TypeScript; dynamic or broadly typed references are checked
when the transaction is constructed. Undefined dependency entries are treated as absent; their
corresponding values are `undefined` in the step callback.

## Failure Behavior and Edge Cases

A failed step is not added to the undo stack. If that step has already made an external change
before returning an error, its own implementation must handle that partial work. Failed undo actions
are listed in `undoErrors`; the original forward error remains in `error`.

Cancellation is checked before each step and the signal is passed to active work. In-flight work
must respond to the signal; cancellation does not forcibly interrupt an operation that ignores it.
When cancellation prevents a step from starting, `error` is `Transaction.Aborted` with the signal's
reason. Step and undo tasks report expected failures through `Task.Result`. Step factories, timeout
handlers, and telemetry callbacks must not throw. Step IDs must be unique and cannot be `initial`.
