# pipelined (@pplnd/core)

[![npm](https://img.shields.io/npm/v/@pplnd/core?style=for-the-badge&color=000&logo=npm&label&logoColor=fff)](https://www.npmjs.com/package/@pplnd/core)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/pplnd/core/ci.yml?style=for-the-badge&color=000&logo=githubactions&label&logoColor=fff)](https://github.com/pplnd/core/actions/workflows/ci.yml)
[![Codecov](https://img.shields.io/codecov/c/github/pplnd/core?style=for-the-badge&color=000&logo=codecov&label&logoColor=fff)](https://app.codecov.io/github/pplnd/core)

Typed errors, explicit optional values, and composable pipelines for TypeScript.

> **Note:** pipelined is pre-1.0. The API may change between minor versions until the 1.0 release.

```sh
npm add @pplnd/core
```

## Overview

An API call fails, and the error arrives as a caught `unknown` three functions away from the call
that caused it. Every return type along the way says the call succeeded.

`pipelined` puts that failure back into the signature. `Result` carries a typed error or a value,
`Maybe` carries presence or absence, and `Task.Result` carries both across an async boundary. The
containers are plain objects with a `kind` field, functions take their data last, and multi-step
work reads top to bottom in a `pipe`.

<!-- BUNDLE_OVERVIEW:START -->

It has zero dependencies, ships ESM and CommonJS builds, and tree-shakes down to ~27 B–6.51 kB
gzipped for individual modules and 26.22 kB for the entire package.

<!-- BUNDLE_OVERVIEW:END -->

## Documentation

Full guides and API reference at **[pplnd.dev](https://pplnd.dev/)**.

If you are deciding between modules, start with
[Choosing a Container](https://pplnd.dev/basics/choosing/). To see several modules joined in one
feature, read the [recipes](https://pplnd.dev/recipes/request-lifecycle/). Every module name in the
[quick reference](#quick-reference) links to its guide.

---

## Examples

Four modules below show the shape: a typed failure, an async lifecycle, a request policy, and a data
pipeline. Every other module follows the same conventions; the [quick reference](#quick-reference)
links each guide, and every guide carries a complete example of its own.

### Handling errors without throw (Result)

Functions that throw exceptions leave error handling to caller memory. TypeScript does not track
thrown errors in return types, and `catch (err)` types errors as `unknown`. `Result<E, A>` makes
failure a normal return value:

```ts check
import { pipe, Result } from "@pplnd/core";

type Config = { apiKey: string; port: number };
type ConfigError =
  | { kind: "InvalidJson"; message: string }
  | { kind: "MissingField"; field: string };

const parseConfig = (raw: string): Result<ConfigError, Config> =>
  pipe(
    Result.tryCatch(
      (): unknown => JSON.parse(raw),
      { onError: (err): ConfigError => ({ kind: "InvalidJson", message: String(err) }) },
    ),
    Result.ensure(
      (data): data is { apiKey: string; port?: unknown } =>
        typeof data === "object" && data !== null && "apiKey" in data
        && typeof data.apiKey === "string",
      (): ConfigError => ({ kind: "MissingField", field: "apiKey" }),
    ),
    Result.map((data) => ({
      apiKey: data.apiKey,
      port: typeof data.port === "number" ? data.port : 8080,
    })),
  );

const outcome = parseConfig('{"apiKey": "secret-123"}');

if (Result.is.ok(outcome)) {
  console.log(`Starting server on port ${outcome.value.port}`);
} else {
  console.error(`Config error: ${outcome.error.kind}`);
}
```

The compiler enforces that `outcome.value` is only accessible after checking
`Result.is.ok(outcome)`. If parsing or validation fails, the pipeline returns a typed error.

### Lazy async workflows and cancellation (Task.Result)

Standard promises start executing immediately upon creation and reject with `unknown`.
`Task.Result<E, A>` is a lazy function `(signal?: AbortSignal) => Deferred<Result<E, A>>`. Its
`Deferred` can be awaited. Nothing runs until you invoke the task, errors remain typed, and chained
tasks receive the signal. Each task must pass that signal to work that supports cancellation:

```ts
import { pipe, Result, Task } from "@pplnd/core";

type User = { id: string; name: string };
type Post = { id: string; title: string };
type ApiError = { status: number; message: string };

const fetchUser = (id: string): Task.Result<ApiError, User> =>
  Task.Result.tryCatch(
    async (signal) => {
      const res = await fetch(`/users/${id}`, { signal });
      if (!res.ok) throw new Error(res.statusText);
      return (await res.json()) as User;
    },
    { onError: (err): ApiError => ({ status: 500, message: String(err) }) },
  );

const fetchPosts = (userId: string): Task.Result<ApiError, Post[]> =>
  Task.Result.tryCatch(
    async (signal) => {
      const res = await fetch(`/users/${userId}/posts`, { signal });
      if (!res.ok) throw new Error(res.statusText);
      return (await res.json()) as Post[];
    },
    { onError: (err): ApiError => ({ status: 500, message: String(err) }) },
  );

// Chain two requests — the AbortSignal propagates to both steps automatically
const userWithPosts = (id: string) =>
  pipe(
    fetchUser(id),
    Task.Result.chain((user) =>
      pipe(
        fetchPosts(user.id),
        Task.Result.map((posts) => ({ ...user, posts })),
      )
    ),
  );
```

To run the pipeline with cancellation support:

```ts
const controller = new AbortController();
const run = userWithPosts("42");

// Execution starts here; aborting controller cancels the active fetch request
const outcome = await run(controller.signal);

if (Result.is.ok(outcome)) {
  console.log(outcome.value); // { id: "42", name: "...", posts: [...] }
} else {
  console.error(outcome.error.message); // ApiError, not unknown
}
```

### Managing request lifecycles, retries, and concurrency (Op)

UI events often arrive faster than the network can settle: a search box fires on every keystroke, a
user double-clicks a submit button, or a flaky connection needs exponential backoff. Writing this by
hand requires managing `AbortController` instances, timers, and attempt counters.

`Op` separates what a request does from how overlapping calls and failures are handled:

```ts
import { Duration, Op, RetryPolicy, Task } from "@pplnd/core";

type SearchResult = { id: string; title: string };
type SearchError = { kind: "NetworkError"; cause: unknown } | { kind: "Timeout" };

const searchOp = Op.make((query: string) =>
  Task.Result.tryCatch(
    (signal) =>
      fetch(`/search?q=${encodeURIComponent(query)}`, { signal }).then((r) =>
        r.json() as Promise<SearchResult[]>
      ),
    { onError: (cause): SearchError => ({ kind: "NetworkError", cause }) },
  )
);

const search = Op.interpret(searchOp, {
  strategy: "restartable", // newer runs replace older ones and signal them to abort
  retry: RetryPolicy.exponential({
    attempts: 3,
    initial: Duration.milliseconds(200),
  }),
  timeout: {
    duration: Duration.seconds(5),
    onTimeout: (): SearchError => ({ kind: "Timeout" }),
  },
});

search.subscribe((state) => {
  if (Op.is.pending(state)) console.log("Searching...");
  if (Op.Outcome.is.ok(state)) console.log(state.value);
  if (Op.Outcome.is.err(state)) console.error(state.error.kind);
});

const input = document.querySelector<HTMLInputElement>("#search");
input?.addEventListener("input", () => search.run(input.value));
```

For form submissions, swapping `strategy: "restartable"` to `strategy: "exclusive"` automatically
drops duplicate clicks while a request is in flight. Built-in strategies include `restartable`,
`exclusive`, `debounced`, `throttled`, `queue`, `buffered`, `concurrent`, `keyed`, and `once`.

### Transforming data collections (Arr & Rec)

Chaining native array methods like `.map()`, `.filter()`, and `.sort()` allocates intermediate
arrays at each step, and index lookups return `undefined` without type guidance. `Arr` and `Rec`
provide curried helpers designed for `pipe`:

```ts
import { Arr, Maybe, Num, pipe, Rec, Str } from "@pplnd/core";

type RawItem = { name: string; price: string; category: string };
type Item = { name: string; price: number; category: string };

const normalise = (raw: RawItem): Maybe<Item> =>
  pipe(
    Num.from.string(raw.price), // "9.99" → Some(9.99), "n/a" → None
    Maybe.map((price) => ({
      name: Str.trim(raw.name),
      price,
      category: raw.category,
    })),
  );

const cheapestByCategory = (items: RawItem[]) =>
  pipe(
    items,
    Arr.filterMap(normalise), // parse + drop unparseable rows in a single pass
    Arr.sortBy((a, b) => a.price - b.price), // sort ascending by price
    Arr.groupBy((item) => item.category), // Record<string, Arr.NonEmpty<Item>>
    Rec.map((group) => Arr.NonEmpty.head(group)), // lowest price per category without Maybe wrapper
  );
```

`Arr.filterMap` combines mapping and filtering into a single loop. `Arr.groupBy` returns guaranteed
non-empty groups, allowing `Arr.NonEmpty.head` to extract the first element directly without an
unnecessary `Maybe` wrapper.

---

## Quick Reference

Each section links a problem to the module that solves it. To choose between neighbouring modules
first, read [Choosing a Container](https://pplnd.dev/basics/choosing/); for complete features built
from several modules, read the [recipes](https://pplnd.dev/recipes/request-lifecycle/).

### Error Handling and Optionality

| Problem to Solve                                          | Module                                                |
| --------------------------------------------------------- | ----------------------------------------------------- |
| Synchronous typed errors without `try`/`catch` or `throw` | [`Result`](https://pplnd.dev/guides/result/)          |
| Optional values without `null` / `undefined` guards       | [`Maybe`](https://pplnd.dev/guides/maybe/)            |
| Multi-field form and batch validation error accumulation  | [`Validation`](https://pplnd.dev/guides/validation/)  |
| Eliminating impossible UI loading/error/data states       | [`RemoteData`](https://pplnd.dev/guides/remote-data/) |
| Values that can hold one side, the other, or both at once | [`These`](https://pplnd.dev/guides/these/)            |
| Pure calculation audit trails and decision logging        | [`Logged`](https://pplnd.dev/guides/logged/)          |

### Async, Concurrency, and State

| Problem to Solve                                                   | Module                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Lazy async workflows with automatic `AbortSignal` propagation      | [`Task.Result`](https://pplnd.dev/guides/task/), [`Task`](https://pplnd.dev/guides/task/) |
| Managing request race conditions, retries, timeouts, and locks     | [`Op`](https://pplnd.dev/guides/op/)                                                      |
| In-memory typed event dispatching, sequence funnels & queue safety | [`EventBus`](https://pplnd.dev/guides/event-bus/)                                         |
| Setup and reverse-order cleanup of connections and locks           | [`Resource`](https://pplnd.dev/guides/resource/)                                          |
| Type-safe finite state machines & validated transitions            | [`Machine`](https://pplnd.dev/guides/machine/)                                            |
| Declarative DAG task scheduling & cycle detection                  | [`Graph`](https://pplnd.dev/guides/graph/)                                                |
| Infallible async synchronization latch for tasks                   | [`Deferred`](https://pplnd.dev/guides/deferred/)                                          |
| Circuit breaker pattern for protecting failing upstream services   | [`CircuitBreaker`](https://pplnd.dev/guides/circuit-breaker/)                             |
| Multi-step workflows with optional reverse-order compensation      | [`Transaction`](https://pplnd.dev/guides/transaction/)                                    |
| Request batching and deduplication within a batch                  | [`Batcher`](https://pplnd.dev/guides/batcher/)                                            |
| Keyed reuse of recent successful lookups with expiry and eviction  | [`Cache`](https://pplnd.dev/guides/cache/)                                                |
| Recognising a cancelled run across async engines                   | [`Aborted`](https://pplnd.dev/guides/aborted/)                                            |
| Pure state transitions, tokenizers, and parsers                    | [`State`](https://pplnd.dev/guides/state/)                                                |
| Dependency injection and contextual configuration without drilling | [`Reader`](https://pplnd.dev/guides/reader/)                                              |

### Collections and Optics

| Problem to Solve                                           | Module                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Bounds-safe array transformations & single-pass filters    | [`Arr`](https://pplnd.dev/guides/arr/), [`Arr.NonEmpty`](https://pplnd.dev/guides/nonempty/)    |
| Type-safe object manipulation & key migration              | [`Rec`](https://pplnd.dev/guides/rec/), [`Rec.NonEmpty`](https://pplnd.dev/guides/nonempty/)    |
| Immutable `Map` operations with any key type               | [`Dict`](https://pplnd.dev/guides/dict/), [`Dict.NonEmpty`](https://pplnd.dev/guides/nonempty/) |
| Immutable `Set` operations (union, intersection, diff)     | [`Uniq`](https://pplnd.dev/guides/uniq/), [`Uniq.NonEmpty`](https://pplnd.dev/guides/nonempty/) |
| Deep nested immutable updates without spread boilerplate   | [`Lens`](https://pplnd.dev/guides/lens/), [`Optional`](https://pplnd.dev/guides/optional/)      |
| String sanitization, numeric conversion & slug parsing     | [`Str`](https://pplnd.dev/guides/str/), [`Str.NonEmpty`](https://pplnd.dev/guides/str/)         |
| Boundary clamping & division-by-zero protection            | [`Num`](https://pplnd.dev/guides/num/)                                                          |
| Exact `bigint` math without floating-point rounding errors | [`BigNum`](https://pplnd.dev/guides/bignum/)                                                    |
| Boolean checks and conditional branching in pipelines      | [`Bool`](https://pplnd.dev/guides/bool/)                                                        |
| Safe JSON parsing & circular reference protection          | [`Json`](https://pplnd.dev/guides/json/)                                                        |

### Composition and Utilities

| Problem to Solve                                                | Module                                                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Left-to-right value pipeline execution                          | [`pipe`](https://pplnd.dev/basics/pipelines/)                                                                                                         |
| Asynchronous value & function pipeline execution                | [`pipeAsync`](https://pplnd.dev/basics/composition/), [`flowAsync`](https://pplnd.dev/basics/composition/)                                            |
| Left-to-right function composition                              | [`flow`](https://pplnd.dev/basics/pipelines/)                                                                                                         |
| Distinct compile-time types for primitive IDs                   | [`Brand`](https://pplnd.dev/guides/brand/)                                                                                                            |
| Explicit, unit-safe time spans & timeout policies               | [`Duration`](https://pplnd.dev/guides/duration/), [`RetryPolicy`](https://pplnd.dev/guides/op/)                                                       |
| Deep value equality & custom comparison rules                   | [`Equality`](https://pplnd.dev/guides/equality/)                                                                                                      |
| Multi-column sorting with fallback tiebreakers                  | [`Ordering`](https://pplnd.dev/guides/ordering/)                                                                                                      |
| Combining boolean checks and filter rules                       | [`Predicate`](https://pplnd.dev/guides/predicate/)                                                                                                    |
| Runtime type narrowing & custom type guard composition          | [`Refinement`](https://pplnd.dev/guides/refinement/)                                                                                                  |
| Merging configs, counters, and summary objects                  | [`Combinable`](https://pplnd.dev/guides/combinable/)                                                                                                  |
| Two-element `[first, second]` tuples                            | [`Pair`](https://pplnd.dev/guides/pair/)                                                                                                              |
| Conditional branching and object shaping in pipelines           | [`when`](https://pplnd.dev/basics/composition/), [`unless`](https://pplnd.dev/basics/composition/), [`struct`](https://pplnd.dev/basics/composition/) |
| Currying, uncurrying, tuple wrapping, and argument flipping     | [`curry`](https://pplnd.dev/basics/composition/), [`uncurry`](https://pplnd.dev/basics/composition/), [`flip`](https://pplnd.dev/basics/composition/) |
| Feeding one input into multiple functions and combining results | [`converge`](https://pplnd.dev/basics/composition/), [`juxt`](https://pplnd.dev/basics/composition/), [`on`](https://pplnd.dev/basics/composition/)   |
| Function result caching & pipeline side-effects                 | [`memoize`](https://pplnd.dev/basics/composition/), [`tap`](https://pplnd.dev/basics/composition/), [`tapLog`](https://pplnd.dev/basics/composition/) |
| Small helper functions                                          | `identity`, `constant`, `noop`, `tuple`                                                                                                               |

---

## Package Architecture and Performance

The package declares `"sideEffects": false`, allowing supported bundlers to remove unused exports.
Actual bundle sizes depend on the bundler, its settings, and the imports your application uses.

<!-- BUNDLE_TABLE:START -->

### Standalone Module Footprint (Tree-Shaken)

These measurements include each listed import and its dependencies, minified and gzipped:

| Import Pattern | Minified + Gzipped |
| :------------- | :----------------- |
| `pipe`         | **142 B**          |
| `flow`         | **173 B**          |
| `Brand`        | **27 B**           |
| `Duration`     | **150 B**          |
| `Maybe`        | **1.51 kB**        |
| `Result`       | **1.51 kB**        |
| `Validation`   | **1.51 kB**        |
| `RemoteData`   | **1.94 kB**        |
| `Machine`      | **2.04 kB**        |
| `EventBus`     | **1.23 kB**        |
| `Batcher`      | **3.07 kB**        |
| `Cache`        | **2.40 kB**        |
| `Resource`     | **2.05 kB**        |
| `Graph`        | **2.88 kB**        |
| `Task`         | **4.55 kB**        |
| `Transaction`  | **2.55 kB**        |
| `Op`           | **6.28 kB**        |
| `Lens`         | **233 B**          |
| `Arr`          | **6.51 kB**        |
| `Rec`          | **3.22 kB**        |
| `Dict`         | **2.41 kB**        |
| `Str`          | **2.30 kB**        |

<!-- BUNDLE_TABLE:END -->

See [Performance and benchmarks](https://pplnd.dev/appendix/benchmarks) for the benchmark suite and
results.

## Contributing

Contributions of every size are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) or the
[contributor handbook](docs/src/content/docs/contributing/index.md). It covers setup, the local
commands, testing, module authoring, and guide writing.

Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues through
[SECURITY.md](SECURITY.md), not public issues.

## License

BSD-3-Clause
