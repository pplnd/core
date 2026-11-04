---
title: Batcher — Batched Key Lookups
description: Combine nearby key lookups into bulk requests and handle found, missing, and failed results.
---

<!-- BUNDLE_SIZE:START -->

> 2.98 kB minified + gzipped

<!-- BUNDLE_SIZE:END -->

## Core Behavior

Loading each catalog item separately can produce many database requests, especially when several
parts of a page ask for the same item. `Batcher` collects key lookups and calls a supplied bulk load
function. Each caller receives an outcome for its own key.

- Calls queued before dispatch share a batch; duplicate keys are fetched once within that batch.
- A returned map entry produces `BatcherOk`, an absent key produces `BatcherMissing`, and a failed
  bulk fetch produces `BatcherErr` for the affected callers.
- Results are not cached. A lookup made after a batch is dispatched can fetch the same key again,
  even while the earlier fetch is still running.

## Example: Looking Up Catalog Items

A page needs catalog information for several item IDs. Some IDs may repeat and some may no longer
exist. The batcher can fetch the unique IDs together and report an outcome for each requested ID.

The bulk fetch returns a map. The batcher uses its entries to settle every caller that requested a
key, including callers that requested the same key:

```mermaid
flowchart TD
  Loads["Pending key lookups"] --> Unique["Group callers by key"]
  Unique --> Fetch["Fetch unique keys"]
  Fetch --> Result{"Fetch result"}
  Result -->|Error| Error["BatcherErr for each caller"]
  Result -->|Map| Found{"Key present?"}
  Found -->|Yes| Value["BatcherOk(value)"]
  Found -->|No| Missing["BatcherMissing(key)"]
```

### Loading Items Together

This example uses an in-memory catalog so it can run without a database. The bulk load callback can
instead return a `Task.Result` that performs a bulk query.

```ts
import { Batcher, Task, pipe } from "@pplnd/core";

type Item = { id: string; name: string };
const catalog = new Map<string, Item>([
  ["pencil", { id: "pencil", name: "Pencil" }],
  ["notebook", { id: "notebook", name: "Notebook" }],
]);

const items = Batcher.make(
  (ids: readonly string[]) =>
    Task.Result.tryCatch(
      async () => {
        const found = new Map<string, Item>();
        for (const id of ids) {
          const item = catalog.get(id);
          if (item !== undefined) found.set(id, item);
        }
        return found;
      },
      { onError: (error) => String(error) },
    ),
);

const outcomes = await items.loadMany(["pencil", "pencil", "missing"]);
const descriptions = outcomes.map((outcome) =>
  pipe(
    outcome,
    Batcher.Outcome.match({
      ok: (item) => item.name,
      missing: (id) => `No item for ${id}`,
      err: (error) => `Catalog lookup failed: ${error}`,
    }),
  )
);
// ["Pencil", "Pencil", "No item for missing"]
```

## Core Operations

### Creating and Running

| Signature                           | What it does                                         | Result                                          |
| :---------------------------------- | :--------------------------------------------------- | :---------------------------------------------- |
| `Batcher.make(loadBatch, options?)` | Creates a batcher around a bulk load task.           | A batcher with `load`, `loadMany`, and `flush`. |
| `batcher.load(key, signal?)`        | Queues a single key.                                 | `Deferred` of that key's outcome.               |
| `batcher.loadMany(keys, signal?)`   | Queues multiple keys.                                | Outcomes in the input order.                    |
| `batcher.flush()`                   | Dispatches queued keys and waits for pending chunks. | `Deferred<void>`.                               |

The options `maxBatchSize` and `concurrency` limit chunk size and simultaneous fetches. Both default
to unbounded. A nonpositive or non-integer `maxBatchSize` or `concurrency` clamps to 1; omit the
option for unbounded behavior. `window` sets a collection delay; without it, dispatch is scheduled
as a microtask. An explicit zero window uses a timer. Reaching `maxBatchSize` flushes the current
queue immediately, so a subsequent lookup can start another batch for the same key. `serializeKey`
can group structurally equivalent object keys; the bulk fetch receives the first key in each group.

### Reading Outcomes

| Signature                                     | What it does                             | Result                                         |
| :-------------------------------------------- | :--------------------------------------- | :--------------------------------------------- |
| `Batcher.Outcome.match({ ok, missing, err })` | Handles all three outcomes.              | The selected handler's result.                 |
| `Batcher.Outcome.is.ok/err/missing(value)`    | Checks the outcome kind.                 | Type guard.                                    |
| `Batcher.Outcome.make.ok/err/missing(value)`  | Creates an outcome.                      | The selected variant.                          |
| `Batcher.Outcome.map(fn)` / `mapError(fn)`    | Transforms a found value / fetch error.  | Other variants pass through.                   |
| `Batcher.Outcome.getOrElse(fn)`               | Reads a found value or calls a fallback. | Value or fallback.                             |
| `Batcher.Outcome.to.Result(onMissing)`        | Converts a missing key to an error.      | `Result` preserving fetch errors.              |
| `Batcher.Outcome.to.Maybe` / `to.nullable`    | Keeps only a found value.                | Both missing and error outcomes are discarded. |

## Failure Behavior and Edge Cases

A missing key and a failed fetch are separate outcomes. When a batch completes, `loadMany` preserves
input order, including positions that requested the same key.

The bulk load factory and its task must not throw or reject; represent expected failures with
`Task.Result`. Aborting a caller returns a `BatcherAborted` error containing the signal's reason.
Other callers continue to share the batch. If every caller in a dispatched batch cancels, the
batcher's signal aborts its bulk task. For cancellable work, use the signal provided to
`Task.Result.tryCatch` when invoking the underlying query. Cancellation is cooperative, and
`flush()` waits for in-flight tasks to settle even if they ignore the signal.

`serializeKey` controls grouping, but the returned map is looked up using the first original key for
each group. For object keys, the fetch must return map entries keyed by those original objects. A
missing outcome also contains the first key in its group, which may be a different object from the
one a later caller supplied.
