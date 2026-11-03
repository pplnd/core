---
title: These — One Value or Both
description: Represent a value, a diagnostic, or both and handle all three cases explicitly.
---

<!-- BUNDLE_SIZE:START -->

> 1.97 kB minified + gzipped

<!-- BUNDLE_SIZE:END -->

## Core Behavior

`These<A, B>` holds a first value, a second value, or both.

- `First` contains only `A`, `Second` contains only `B`, and `Both` contains both.
- The type has no empty case and assigns no inherent meaning to either side.
- Mapping changes the selected values when present; `match` handles all three cases.

## Example: Sensor Readings

A temperature reading may be valid but outside the sensor's expected range, or it may be invalid and
unusable. `These.make.both(reading, warning)` carries a usable reading and its warning together.

When a reading and a warning are both present, `mapFirst` keeps the warning. `chainFirst` returns
the callback's entire `These`, replacing the original reading and its warning:

```mermaid
flowchart TD
  Input["Both(reading, warning)"]
  Input -->|mapFirst formats reading| Mapped["Both(formatted reading, warning)"]
  Input -->|chainFirst returns First| Chained["First(formatted reading)"]
```

If the input is `Second`, neither operation calls its callback; the diagnostic passes through.
`chainSecond` behaves symmetrically, replacing a coexisting first value with its callback's result.

### Parsing and Displaying Readings

This parser returns a diagnostic for invalid input and adds a warning to high but valid readings:

```ts
import { pipe, These } from "@pplnd/core";

type Diagnostic = { message: string };
type Reading = { celsius: number };

const parseReading = (raw: string): These<Reading, Diagnostic> => {
  const input = raw.trim();
  const celsius = Number(input);
  if (input === "" || !Number.isFinite(celsius)) {
    return These.make.second({ message: "Temperature must be a finite number" });
  }
  if (celsius > 45) {
    return These.make.both({ celsius }, { message: "Temperature exceeds 45 °C" });
  }
  return These.make.first({ celsius });
};

const describeReading = (raw: string): string =>
  pipe(
    parseReading(raw),
    These.mapFirst((reading) => `${reading.celsius.toFixed(1)} °C`),
    These.mapSecond((diagnostic) => ({ message: `Sensor: ${diagnostic.message}` })),
    These.match({
      first: (temperature) => `Reading: ${temperature}`,
      second: (diagnostic) => `Invalid reading: ${diagnostic.message}`,
      both: (temperature, diagnostic) => `Reading: ${temperature}; ${diagnostic.message}`,
    }),
  );

console.log(describeReading("48"));
// Reading: 48.0 °C; Sensor: Temperature exceeds 45 °C
```

## Core Operations

### Creating and Combining Values

| Signature                                        | What it does                  | Return type              |
| :----------------------------------------------- | :---------------------------- | :----------------------- |
| `These.make.first(value)` / `make.second(value)` | Creates a single-sided value. | `First<A>` / `Second<B>` |
| `These.make.both(first, second)`                 | Keeps both values.            | `Both<A, B>`             |
| `These.from.Pair(pair)`                          | Converts a pair into `Both`.  | `Both<A, B>`             |

### Transforming Values

| Signature                                              | What it does                                                                      | Guarantee                                                                                      |
| :----------------------------------------------------- | :-------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `These.mapFirst(fn)` / `mapSecond(fn)`                 | Transforms the selected side when present.                                        | Preserves the other side.                                                                      |
| `These.mapBoth(onFirst, onSecond)`                     | Transforms each present side.                                                     | Keeps the same variant.                                                                        |
| `These.chainFirst(fn)` / `chainSecond(fn)`             | Replaces the value with the callback's `These` when the selected side is present. | A coexisting opposite side is discarded; an input with only that opposite side passes through. |
| `These.swap(value)`                                    | Exchanges first and second.                                                       | `Both` stays `Both`.                                                                           |
| `These.tapFirst(fn)` / `tapSecond(fn)` / `tapBoth(fn)` | Runs a callback when the requested side or sides are present.                     | Returns the original value.                                                                    |

### Reading and Converting

| Signature                                                       | What it does                                  | Return type                                |
| :-------------------------------------------------------------- | :-------------------------------------------- | :----------------------------------------- |
| `These.match(cases)`                                            | Handles `first`, `second`, and `both`.        | The selected callback result.              |
| `These.is.first(value)` / `is.second(value)` / `is.both(value)` | Checks the exact variant.                     | Type guard.                                |
| `These.hasFirst(value)` / `hasSecond(value)`                    | Checks for a side, including `Both`.          | Type guard.                                |
| `These.getFirstOrElse(fn)` / `getSecondOrElse(fn)`              | Reads a side or calls a fallback when absent. | Value or fallback result.                  |
| `These.to.Pair(value)`                                          | Extracts both values when present.            | `Some(pair)` for `Both`, otherwise `None`. |

## Failure Behavior and Edge Cases

If both a reading and a diagnostic can be absent, represent that outside `These`, for example with
`Maybe<These<Reading, Diagnostic>>`.

`chainFirst` on `Both` returns the callback's result and drops the existing second value. For
example, the warning is lost when the callback returns only a formatted reading:

```ts
import { pipe, These } from "@pplnd/core";

const reading = These.make.both(48, "Temperature exceeds 45 °C");

pipe(reading, These.chainFirst((celsius) => These.make.first(`${celsius.toFixed(1)} °C`)));
// First("48.0 °C")

pipe(reading, These.mapFirst((celsius) => `${celsius.toFixed(1)} °C`));
// Both("48.0 °C", "Temperature exceeds 45 °C")
```

`chainSecond` similarly replaces a coexisting first value. Use mapping when both sides must survive.
