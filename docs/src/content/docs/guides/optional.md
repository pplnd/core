---
title: Optional — Values That May Be Missing
description: Read and update a nested value that may be absent without guarding every call site.
---

<!-- BUNDLE_SIZE:START -->

> 1.82 kB minified + gzipped

<!-- BUNDLE_SIZE:END -->

A delivery request has a schedule, and the schedule may carry a time zone. Reading the time zone at
each call site means a null check before every dispatch decision, and one path that skips it crashes
the run. Writing the normalized zone back duplicates the same guard in the setter.

## Core Behavior

`Optional<S, A>` pairs a getter returning `Maybe<A>` with a setter for a path that may break at any
segment.

- `get` returns `Some(value)` when the path resolves and `None` when it does not.
- `modify` skips its callback and returns the original structure when the value is absent.
- `andThen` joins optional paths; `andThenLens` continues through a required path.
- `from.index` accepts only an integer inside the array bounds; an out-of-bounds read returns `None`
  and the setter returns the input array.

Reach for `Optional` when at least one segment of the path can be missing. When every segment is
guaranteed, [`Lens`](/guides/lens/) returns the value directly and drops the `Maybe` wrapper. The
[choosing guide](/basics/choosing/) separates the two under comparison and structure.

## Example: Delivery Schedule

A delivery request may have a schedule and the schedule may have a time zone. When the time zone is
present, the application can normalize it; otherwise it can display a default without changing the
request.

`modify` checks the focused value before calling the transformation:

```mermaid
flowchart TD
  Input["Delivery request"] --> Found{"Time zone present?"}
  Found -->|No| Original["Return original request; skip callback"]
  Found -->|Yes| Change["Apply transformation"]
  Change --> Same{"Same value by Object.is?"}
  Same -->|Yes| Original
  Same -->|No| Updated["Set transformed value"]
```

### Reading and Normalizing the Time Zone

```ts
import { Optional, pipe } from "@pplnd/core";

type Schedule = { timeZone?: string };
type Delivery = { id: string; schedule?: Schedule };
const timeZone = pipe(
  Optional.from.property<Delivery>()("schedule"),
  Optional.andThen(Optional.from.property<Schedule>()("timeZone")),
);

const delivery: Delivery = { id: "delivery-7", schedule: { timeZone: " UTC " } };
const normalized = pipe(delivery, Optional.modify(timeZone)((zone) => zone.trim()));
const missing: Delivery = { id: "delivery-8" };

pipe(normalized, Optional.getOrElse(timeZone)(() => "Not scheduled")); // "UTC"
pipe(missing, Optional.getOrElse(timeZone)(() => "Not scheduled"));    // "Not scheduled"
```

`Optional.modify` calls the transformation only for the request that has a time zone. The request
without a schedule keeps its original shape, and `getOrElse` returns the fallback without a write.

### When the schedule becomes guaranteed

Once dispatch requires every delivery to carry a schedule, the first segment stops being optional. A
[`Lens`](/guides/lens/) focuses that guaranteed segment, and the optional time zone composes onto
it:

```ts
import { Lens, Optional, pipe } from "@pplnd/core";

type ScheduledDelivery = { id: string; schedule: Schedule };

const scheduledTimeZone = pipe(
  Lens.from.property<ScheduledDelivery>()("schedule"),
  Lens.andThenOptional(Optional.from.property<Schedule>()("timeZone")),
);

const scheduledDelivery: ScheduledDelivery = {
  id: "delivery-9",
  schedule: { timeZone: "Asia/Yerevan" },
};
pipe(scheduledDelivery, Optional.get(scheduledTimeZone)); // Some("Asia/Yerevan")
```

## Core Operations

### Creating and Composing

| Signature                           | What it does                                | Result                            |
| :---------------------------------- | :------------------------------------------ | :-------------------------------- |
| `Optional.from.property<S>()(key)`  | Focuses on a nullable or optional property. | `Optional<S, NonNullable<S[K]>>`. |
| `Optional.from.index<A>(index)`     | Focuses on an array position.               | `Optional<readonly A[], A>`.      |
| `Optional.from.accessors(get, set)` | Creates a path from custom accessors.       | `Optional<S, A>`.                 |
| `Optional.andThen(inner)`           | Continues through another optional path.    | An optional path.                 |
| `Optional.andThenLens(inner)`       | Continues through a required lens.          | An optional path.                 |

### Reading and Updating

| Signature                            | What it does                         | Result                                                      |
| :----------------------------------- | :----------------------------------- | :---------------------------------------------------------- |
| `Optional.get(path)`                 | Reads the focus.                     | `Maybe<A>`.                                                 |
| `Optional.getOrElse(path)(fallback)` | Reads the focus or calls a fallback. | Focus or fallback value.                                    |
| `Optional.match(path)(cases)`        | Handles present and absent values.   | Selected handler's result.                                  |
| `Optional.set(path)(value)`          | Calls the path's setter.             | Updated or unchanged structure, depending on the path.      |
| `Optional.modify(path)(fn)`          | Transforms a present focus.          | Original structure when absent or unchanged by `Object.is`. |

## Failure Behavior and Edge Cases

`set` and `modify` differ for a missing property. A property setter can create that property, while
`modify` needs a present value before it calls its callback:

```ts
import { Optional, pipe } from "@pplnd/core";

type Schedule = { timeZone?: string };
const timeZone = Optional.from.property<Schedule>()("timeZone");
const schedule: Schedule = {};

pipe(schedule, Optional.set(timeZone)("UTC"));                    // { timeZone: "UTC" }
pipe(schedule, Optional.modify(timeZone)((zone) => zone.trim())); // {}
```

A composed setter cannot proceed through an absent intermediate value; it returns the input
structure. The final property setter still creates its own key when the intermediate segments are
present.

`Optional.from.index` requires `Number.isInteger(index)` and `0 <= index < items.length`. A
fractional, negative, `NaN`, or `Infinity` index reads as `None`, and the setter returns the same
array reference without copying.

Absence is not an error. `Optional.get` returns a `Maybe`; when dispatch must reject the request,
the [`Result.from.Maybe`](/guides/result/) converter turns `None` into `Err`, while a present time
zone becomes `Ok`.
