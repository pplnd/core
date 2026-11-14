---
title: Design Notes
description: Why the library exists, what it borrows, what it leaves out, and what it costs.
---

I started `pipelined` because I kept writing the same null checks, the same `try/catch` around calls
that might throw, and the same retry loop with an `AbortController` wired through it, and every copy
was a little different. I wanted code where the steps of the work were easy to see, where hovering
over a function told you how it could fail, and where that plumbing lived in one place instead of in
every feature.

## Something useful

Each module here started as a problem I ran into more than once. Functions that can fail got
`Result`. Values that might be missing got `Maybe`. Forms where several fields can be wrong at the
same time got `Validation`, so the user sees every error at once instead of fixing them one submit
at a time. Requests got `RemoteData`, which replaces the `isLoading`/`error`/`data` trio and the
combinations of it that should never happen.

The same idea moved into async and stateful work as the library grew. [`Task`](/guides/task/)
describes lazy async work; [`Op`](/guides/op/) wraps that work in a manager that decides what
happens when calls overlap, fail, or time out; [`Machine`](/guides/machine/) makes the states and
transitions explicit; [`Resource`](/guides/resource/) brackets acquisition and release;
[`Transaction`](/guides/transaction/) runs compensating actions when a later step fails;
[`Graph`](/guides/graph/) schedules work whose steps depend on each other. The containers changed,
but the rule did not: the type shows the states and failure channels, and the plumbing stays in the
module instead of every feature. The [choosing guide](/basics/choosing/) maps the rest.

## Something readable

Here is a function that loads a user's config, reads the connection string from it, and opens a
database client:

```ts
function getClient(userId: string): Client | null {
  try {
    const config = fetchConfig(userId);
    if (!config) return null;

    const connStr = config.database.connectionString;
    if (!connStr) return null;

    return connect(connStr);
  } catch {
    return null;
  }
}
```

There are three steps in it, but you have to read past the null checks and the `try` to find them.
Here is the same function as a pipeline:

```ts
import { Maybe, pipe } from "@pplnd/core";

const getClient = (userId: string) =>
  pipe(
    Maybe.tryCatch(() => fetchConfig(userId)),
    Maybe.chain(Maybe.from.nullable),
    Maybe.chain((config) => Maybe.from.nullable(config.database.connectionString)),
    Maybe.chain((connStr) => Maybe.tryCatch(() => connect(connStr))),
  );
```

Each line is one operation, in the order it runs. If a step returns nothing, the rest are skipped
and you get `None`. The null checks still happen inside `Maybe.chain`, but nobody has to write them
again. The two `tryCatch` calls are the boundaries where a throwing call becomes `None`; `Maybe`
itself only carries absence. When the reason for a failure matters, start with `Result.tryCatch`
instead and the error survives.

## Something understandable

I wanted the types to do some of the explaining. If a function is typed
`(input: unknown) => Validation<FieldError, Order>`, a colleague knows it can return several field
errors before they open the file. In a pipeline, hovering over any step shows what it hands to the
next one.

The function names follow the same idea: they say what the step does. `map` changes the value inside
a container, `chain` runs a step that can itself fail or come back empty, and `match` takes one
handler per case, such as `{ ok, err }` or `{ some, none }`.

The test I use is whether a TypeScript developer who has written the language for a few years, but
has never used an FP library, can read a call site and predict what it does. That is why the
function names are verbs, why `match` takes named handlers instead of positional callbacks, and why
the API uses `chain` instead of `flatMap` and has no `of` or `pure` constructor.

## Something honest

A signature should cover everything that can happen. `(id: string) => User` doesn't tell you it
throws when the user isn't found, and `(id: string) => Result<NotFound, User>` does. `Task` goes a
step further. It returns a `Deferred`, which has no rejection path. A throwing body is a contract
violation, not an error the type can carry; `Task.Result.tryCatch` is the boundary where a throw
becomes a typed error, and a rejection hidden underneath a `Deferred` has nowhere to surface.

I used the same rule to decide how much an abstraction is allowed to hide. It can hide how something
happens, but not what can happen. `Op` can retry, back off, time out, and cancel a run according to
its options:

```ts
import { Duration, Op, RetryPolicy } from "@pplnd/core";

const paymentManager = Op.interpret(submitPaymentOp, {
  strategy: "exclusive",
  retry: RetryPolicy.exponential({
    attempts: 3,
    initial: Duration.milliseconds(500),
  }),
  timeout: TimeoutPolicy.after({ duration: Duration.seconds(10), onTimeout: () => paymentTimedOut }),
});
```

The retry, backoff, and timeout live in the options; cancellation comes from the `AbortSignal` and
the strategy. Every possible outcome still shows up in the type: a run ends as `Ok`, `Err`, or `Nil`
(aborted, dropped, replaced, or evicted), and `Op.Outcome.match` won't compile until you've handled
all three.

## Something unobtrusive

I didn't want to move a codebase into a framework to get any of this. The values are plain objects,
records, tuples, or functions; none of them is a class instance. The variant types carry a `kind`
field, so they print normally in `console.log`, survive `JSON.stringify`, and narrow in a regular
`switch`. There are no classes, so `instanceof` can't break when a value crosses a package or worker
boundary, and there's no runtime to start. `Task` is a function, and `Deferred` is a small thenable;
both run on the JavaScript runtime you already have.

`Brand<K, T>` exists only at compile time. At runtime, a branded value is exactly the underlying
value, with no wrapper object, tag field, or extra allocation. `Brand.wrap` and `Brand.unwrap` do
not change the value; their only job is to satisfy the type checker.

So you can try it in one function. That function returns a `Result` and the code around it stays the
same. If it doesn't help, you take it out of that one function and you're done.

## Something thorough

A lot of the work went into keeping things consistent, so that once you know the core containers you
mostly know the others. The success value is always called `value`. A single failure is `error`, and
a list of failures is `errors`. Where an operation makes sense, it keeps the same name: `Result`,
`Maybe`, `Validation`, and `RemoteData` all have `is`, `map`, `match`, `getOrElse`, `from`, and
`to`. `Validation` adds `apply` for independent checks, and `These` names its two sides `first` and
`second` because neither is a success channel. The async variants repeat the names that apply:
`Task.Result`, `Task.Maybe`, and `Task.Validation` have `map`, `match`, `getOrElse`, `from`, and
`to`.

Some guarantees live in the types. A failed `Validation` always has at least one error, because the
list is typed as non-empty, so you never check for an empty one. Others are enforced at runtime:
index helpers treat `1.5`, `NaN` and `Infinity` as invalid instead of returning `undefined`.

## Something small

A team should not have to learn the whole library. Each module has a focused public surface and a
guide of its own, and the names stay consistent across modules. There's one way to do each thing,
with no aliases or duplicate modules, so code review never turns into a debate about which spelling
to use. It has no dependencies, and unused modules drop out of the bundle.

## What it costs

Curried functions allocate small closures, which you'll only notice in tight loops over large
arrays. Data-last currying takes some getting used to. And where your code meets code that doesn't
use these types, like a framework callback or a third-party SDK, you have to convert values at the
boundary.

There is also a bundle cost to the design. Importing one module can pull in the converters it
references, and importing one function from a module does not strip the other methods from that
module. The package stays small because the modules are small, not because every function is
independently tree-shaken. The module, not the individual function, is the tree-shaking unit.

## When plain TypeScript is enough

Plain TypeScript with early returns is often the better choice for a one-off script, a small
internal tool, or a hot loop where allocations matter. `pipelined` is for the code a team keeps
working on for years: business logic, parsing and validation, and async workflows. It is not a
framework or an effect system, and it does not try to replace the runtime or the framework you
already have.

## Where the ideas come from

The library has two main lineages. The container and pipeline layer comes from functional
programming. The operational layer comes from state machines, sagas, and the patterns used around
network calls. Neither lineage explains the whole library.

### Haskell

Most of the container vocabulary comes from Haskell. `Result` is `Either`, `Maybe` is `Maybe`, and
`These` is the [`these`](https://hackage.haskell.org/package/these) package's inclusive-or type; the
Haskell package calls the cases `This`, `That`, and `These`, and this library uses `First`,
`Second`, and `Both`. `Validation` is the accumulating-error shape Haskell libraries call by the
same name: independent checks combine with `apply`, and failures accumulate instead of
short-circuiting. `Reader`, `State`, and `Logged` are the reader, state, and writer patterns;
`Resource` follows the [bracket](https://wiki.haskell.org/Bracket_pattern) pattern from
`Control.Exception`.

`map` and `chain` are Haskell's `fmap` and `>>=` under names that say what they do. `match` is the
named-case version of the eliminators Haskell calls `maybe` and `either`.

`Task` borrows the shape of Haskell's `IO`: a description of work that is run later, not a value
produced now. The implementation is JavaScript-specific — a thunk returning `Deferred`, with an
`AbortSignal` threaded through — and it does not need a Haskell-style runtime.

### Elm

Elm's standard library keeps the Haskell names for `Maybe` and `Result` and treats them as ordinary
values with plain functions. That is the model this library follows: no typeclass hierarchy, no
operators to learn, and a plain function for each operation.

The `RemoteData` pattern also started in Elm, in
[Kris Jenkins's package](https://package.elm-lang.org/packages/krisajenkins/remotedata/latest/). A
data fetch is in exactly one of four states, and modelling it that way removes the loading and error
flags that can disagree with each other.

### Rust

Rust put `Option<T>` and `Result<T, E>` in a mainstream standard library, and its `?` operator made
early return on failure ordinary. The typed failure channel in this library is the same idea without
a language feature: `chain` passes an `Ok` value to the next step and leaves an existing `Err`
alone.

### fp-ts and the container layer

The container and pipeline layer has a direct TypeScript predecessor in
[fp-ts](https://github.com/gcanti/fp-ts) by Giulio Canti. `pipe`, data-last currying, and the
pattern of pairing a type with a companion value of the same name come from there, and they are why
`Result`, `Maybe`, and `Task` read the way they do. The connection stops at that layer. fp-ts is a
typeclass library built on an HKT encoding; this library rejects both. The operational modules —
`Op`, `EventBus`, `Machine`, `Graph`, `Transaction`, `Batcher`, `CircuitBreaker`, `RateLimiter`,
`Supervisor` — have no fp-ts counterpart. Sharing `pipe` and `Result` does not make the whole
library an fp-ts descendant.

### Optics

`Lens` and `Optional` come from a functional programming tradition that treats a path through data
as a value. You define the path once, give it a name, pass it around, and combine it with other
paths to reach deeper. The vocabulary and the van Laarhoven encoding come from Haskell; Twan van
Laarhoven [described the encoding](https://www.twanvl.nl/blog/haskell/cps-functional-references) in
2009, and [Edward Kmett's `lens` package](https://github.com/ekmett/lens) is its best-known
implementation.

The `lens` package defines a whole family of optics (`Iso`, `Prism`, `Lens`, `Traversal`, `Fold`,
`Getter`, `Setter`) and unifies them with that encoding. In the encoding, an optic is a polymorphic
higher-order function over `Functor`, `Applicative` and similar abstractions, and optics compose
with ordinary function composition. It is elegant, but it depends on higher-kinded types: types
parameterized by another type constructor, which TypeScript cannot express directly. TypeScript can
approximate them with encoding tricks, as fp-ts does, and this library avoids that for the reasons
given in the typeclass section below.

This library uses a simpler, concrete representation instead. Each optic is a plain record with
`get` and `set` fields:

```ts
type Lens<S, A> = {
  readonly get: (structure: S) => A;
  readonly set: (value: A) => (structure: S) => S;
};

type Optional<S, A> = {
  readonly get: (structure: S) => Maybe<A>;
  readonly set: (value: A) => (structure: S) => S;
};
```

The concrete form can't compose uniformly across the whole family, but you can read the type and see
exactly what it does, and there is no encoding to pay for.

### State machines and operational patterns

The later modules borrow from outside functional programming. `Machine` follows
[statecharts](https://doi.org/10.1016/0167-6423(87)90035-9): each state carries the data that is
valid in it, and the transition table decides which events are legal. `Transaction` is a
[saga](https://doi.org/10.1145/38714.38742): completed steps register compensating actions, and a
failure runs them in reverse. `Batcher` follows the batching idea popularized by
[DataLoader](https://github.com/graphql/dataloader). `CircuitBreaker` and `RateLimiter` come from
operational practice: the breaker from Michael Nygard's `Release It!`, summarized by
[Martin Fowler](https://martinfowler.com/bliki/CircuitBreaker.html); the limiter from the
sliding-window algorithms used by API clients.

`Op` sits on top of the async modules: a `Task` describes one attempt, and `Op.interpret` attaches
the policy that decides what happens when calls overlap, fail, or time out. The split between the
description and the run is the same one [ZIO](https://zio.dev/reference/core/zio/task/) draws
between an effect and its runtime; the cancellation channel is JavaScript's `AbortSignal`.

## What was deliberately left out

### Typeclass names

The library provides the operations behind the usual functional structures: mapping, chaining,
applying independent values, combining values, ordering, and equality. It names every module and
function after what the operation does in code: `map`, `chain`, `apply`, `Combinable`, `Ordering`,
`Equality`. Someone reading a call site should be able to tell what happens without knowing the
algebraic name for it. See [the section on names](#something-understandable).

### A typeclass system

fp-ts simulates higher-kinded types in TypeScript with an `HKT` encoding. A higher-kinded type is a
type that abstracts over another type constructor: a container `F` that can be applied to any `A`,
not just one concrete `A`. TypeScript has no direct syntax for it. The encoding lets you write
generic code over any type that implements a given typeclass, which is a shared interface like `Eq`
or `Ord` that a type opts into. This library doesn't try. The `map` on `Maybe` and the `map` on
`Result` share a name, not an interface, so you can't write one function that works over "any type
with a `map`". That is a real limitation. In exchange, the types stay simple and there is no
encoding layer to learn.

### Retry on Task

`Task` has no `fail` or `retry`. A `Task` describes one attempt; retry, backoff, timeout, and
overlap are decisions about a run, and they belong to [`Op`](/guides/op/). Putting them on `Task`
would make every call site choose a policy and would put an error channel on a type that has none.

### A schema language

`Refinement` composes type guards, and `Validation` collects the errors from independent checks, but
neither defines a schema you can derive a type from. The library provides the checks and the error
accumulation, not the schema language itself. Defining the shape once and deriving both the
TypeScript type and the runtime validator is a different job; a decoder at the boundary can do that,
and the containers work on the value once it has a shape.

### The full optics hierarchy

`Lens` and `Optional` are two members of a much larger family. The two most useful ones left out are
`Prism`, which focuses on one variant of a union (such as the value inside `Some`, or the `Ok` case
of a `Result`), and `Traversal`, which focuses on several values at once, for example every element
of a nested array. With the concrete `{ get, set }` encoding, each new optic type needs its own
composition function for every other type, so the number of composition functions grows with the
square of the number of optic types. `Lens` and `Optional` cover the cases that come up most in
everyday TypeScript, so the rest stayed out.

## Acknowledgements

The ideas behind this library come from years of reading code by people who thought hard about these
problems: the Haskell community, the Elm community and its insistence that good ideas should be
approachable, and the fp-ts contributors who did the work of encoding those ideas in TypeScript.

Particular thanks to Giulio Canti, whose fp-ts shaped the container and pipeline layer and showed
that typed functional programming is practical in TypeScript, and whose source code taught me more
about the language than any tutorial. To Kris Jenkins, for naming `RemoteData` and making the case
for it so clearly that the pattern spread beyond Elm. To Twan van Laarhoven, for the optic encoding,
and to Edward Kmett, for the `lens` library that made it widely known. To David Harel, for
statecharts; to Michael Nygard, for popularizing the circuit breaker; to Hector Garcia-Molina and
Kenneth Salem, for sagas; and to the DataLoader authors, for the batching pattern. To the Haskell
community more broadly, for `These` and for a huge body of work that keeps the ecosystem moving. And
to the TypeScript team, for a type system expressive enough to encode most of these ideas at all.

If you've read this far, thank you. Whether you found the library useful, built something with it,
spotted something wrong, or just wanted to see how the pieces fit together, I'm glad you did.

Write good code. Make the impossible states unrepresentable.
