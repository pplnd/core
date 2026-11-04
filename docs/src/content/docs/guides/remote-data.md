---
title: RemoteData — Loading States
description: Represent an idle, loading, failed, or successful request with one state value.
---

<!-- BUNDLE_SIZE:START -->

> 1.81 kB minified + gzipped

<!-- BUNDLE_SIZE:END -->

## Core Behavior

`RemoteData<E, A>` represents one of four states for a request: `NotAsked`, `Loading`, `Failure`, or
`Success`.

- `Failure` carries an error of type `E`; `Success` carries a value of type `A`.
- `map` and `chain` operate on `Success`; the other states pass through.
- `match` requires a handler for every state. The application chooses when to create each state.

## Example: Invoice Loading

With separate loading, error, and invoice fields, a failed refresh can leave a loading flag or old
invoice on screen by accident. `RemoteData.make.loading()` represents the loading state on its own;
there is no invoice or error in that variant.

`filter` inspects a successful invoice and can turn it into a failure. For the other three states,
it leaves the state unchanged:

```mermaid
flowchart TD
  Input["RemoteData invoice state"] --> State{"Success?"}
  State -->|Yes| Check{"Amount valid?"}
  Check -->|Yes| Success["Success(invoice)"]
  Check -->|No| Failure["Failure(invalid amount)"]
  State -->|No| Unchanged["NotAsked, Loading, or Failure unchanged"]
```

`map` and `chain` also act only on `Success`. The application sets request states; `RemoteData` does
not start requests or enforce their ordering.

### Loading and Displaying an Invoice

One request can set `Loading` before it starts and `Success` or `Failure` when it finishes. With
repeated requests, an older response can arrive after a newer one and overwrite it. This loader uses
a sequence number to ignore an older response and renders every state explicitly:

```ts
import { pipe, RemoteData } from "@pplnd/core";

interface Invoice {
  id: string;
  amountCents: number;
}

type InvoiceState = RemoteData<string, Invoice>;
let invoiceState: InvoiceState = RemoteData.make.notAsked();
let latestRequest = 0;

const renderInvoice = (state: InvoiceState): string =>
  pipe(
    state,
    RemoteData.filter(
      (invoice) => Number.isSafeInteger(invoice.amountCents) && invoice.amountCents >= 0,
      () => "Invoice amount is invalid",
    ),
    RemoteData.map((invoice) =>
      `Invoice ${invoice.id}: ${(invoice.amountCents / 100).toFixed(2)} USD`
    ),
    RemoteData.match({
      notAsked: () => "Select an invoice",
      loading: () => "Loading invoice...",
      failure: (error) => `Unable to display invoice: ${error}`,
      success: (summary) => summary,
    }),
  );

const publish = (state: InvoiceState): void => {
  invoiceState = state;
  console.log(renderInvoice(invoiceState));
};

const loadInvoice = async (id: string): Promise<void> => {
  const request = ++latestRequest;
  publish(RemoteData.make.loading());
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (
      typeof data !== "object" || data === null ||
      !("id" in data) || typeof data.id !== "string" ||
      !("amountCents" in data) || typeof data.amountCents !== "number"
    ) {
      throw new Error("Invalid invoice response");
    }
    if (request === latestRequest) {
      publish(RemoteData.make.success({ id: data.id, amountCents: data.amountCents }));
    }
  } catch (error) {
    if (request === latestRequest) {
      publish(RemoteData.make.failure(String(error)));
    }
  }
};

console.log(renderInvoice(invoiceState)); // Select an invoice
void loadInvoice("inv-42");
```

The sequence number prevents stale responses from updating this state, but the older request still
runs. To stop it, the application must pass an `AbortSignal` to `fetch` and manage its controller.
The amount check is part of rendering here; move it into the loading boundary if every consumer must
receive only validated invoices.

## Core Operations

### Creating Values

| Signature                                                | What it does                                             | Return type                 |
| :------------------------------------------------------- | :------------------------------------------------------- | :-------------------------- |
| `RemoteData.make.notAsked()` / `make.loading()`          | Creates an idle or loading state.                        | `NotAsked` / `Loading`      |
| `RemoteData.make.failure(error)` / `make.success(value)` | Stores an error or a value.                              | `Failure<E>` / `Success<A>` |
| `RemoteData.from.Result(result)`                         | Converts `Ok` to `Success` and `Err` to `Failure`.       | `RemoteData<E, A>`          |
| `RemoteData.from.Maybe(onNone)`                          | Converts `Some` to `Success`; calls `onNone` for `None`. | `RemoteData<E, A>`          |

### Combining and Transforming Values

| Signature                               | What it does                                      | Guarantee                                                                             |
| :-------------------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------ |
| `RemoteData.apply(argument)`            | Applies a wrapped function to a wrapped argument. | Failure takes precedence, then Loading, then NotAsked; both must be Success to apply. |
| `RemoteData.map(fn)` / `mapError(fn)`   | Transforms a success value or failure error.      | Other states pass through.                                                            |
| `RemoteData.chain(fn)`                  | Calls a state-producing function for `Success`.   | Other states pass through.                                                            |
| `RemoteData.filter(predicate, onFalse)` | Checks a success value.                           | A failed check becomes `Failure(onFalse(value))`.                                     |
| `RemoteData.recover(fn)`                | Replaces `Failure` with the callback's state.     | Other states pass through.                                                            |
| `RemoteData.tap(fn)` / `tapError(fn)`   | Runs a callback for `Success` / `Failure`.        | Returns the original state.                                                           |

### Reading and Converting

| Signature                                                                                         | What it does                                                          | Return type                   |
| :------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------- | :---------------------------- |
| `RemoteData.match(cases)`                                                                         | Handles all four states.                                              | The selected callback result. |
| `RemoteData.is.notAsked(value)` / `is.loading(value)` / `is.failure(value)` / `is.success(value)` | Checks a state.                                                       | Type guard.                   |
| `RemoteData.getOrElse(fn)`                                                                        | Reads a success value or calls a fallback for every other state.      | Value or fallback result.     |
| `RemoteData.to.Maybe(value)`                                                                      | Keeps only a success value.                                           | `Some(value)` or `None`.      |
| `RemoteData.to.Result(onNotReady)`                                                                | Converts success and failure; calls the fallback for idle or loading. | `Ok(value)` or `Err(error)`.  |

## Failure Behavior and Edge Cases

`recover` handles an existing `Failure`; it does not catch a rejected request. Convert request
errors to `Failure` at the loading boundary if they should be rendered.

If both inputs to `apply` are failures, it returns the failure from the function's state:

```ts
import { pipe, RemoteData } from "@pplnd/core";

const formatterState = RemoteData.make.failure("Invoice formatter unavailable");
const invoiceState = RemoteData.make.failure("Invoice unavailable");

pipe(formatterState, RemoteData.apply(invoiceState));
// Failure("Invoice formatter unavailable")
```

In a sequence of applications, an earlier failure is retained. Loading and NotAsked carry no
previous value, so preserving stale data during refresh requires a separate application model.
