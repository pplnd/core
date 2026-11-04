---
title: Design Notes
description: Why the library exists, where the ideas came from, and what was left out on purpose.
---

I started `pipelined` because I kept writing the same null checks, the same `try/catch` around calls
that might throw, and the same retry loop with an `AbortController` wired through it, and every copy
was a little different. I wanted code where the steps of the work were easy to see, where hovering
over a function told you how it could fail, and where that plumbing lived in one place instead of in
every feature.

The sections below describe what I was looking for.

---

## Something useful

Each module here started as a problem I ran into more than once. Functions that can fail got
`Result`. Values that might be missing got `Maybe`. Forms where several fields can be wrong at the
same time got `Validation`, so the user sees every error at once instead of fixing them one submit
at a time. Requests got `RemoteData`, which replaces the `isLoading`/`error`/`data` trio and the
combinations of it that should never happen.

---

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
    userId,
    fetchConfig,
    Maybe.chain((config) => Maybe.from.nullable(config.database.connectionString)),
    Maybe.chain(connect),
  );
```

Each line is one step, in the order it runs. If a step returns nothing, the rest are skipped and you
get `None`. The null checks still happen inside `Maybe.chain`, but nobody has to write them again.

---

## Something understandable

I wanted the types to do some of the explaining. If a function is typed
`(input: unknown) => Validation<FieldError, Order>`, a colleague knows it can return several field
errors before they open the file. In a pipeline, hovering over any step shows what it hands to the
next one.

The function names follow the same idea: they say what the step does. `map` changes the value inside
a container, `chain` runs a step that can itself fail or come back empty, and `match` takes one
handler per case, such as `{ ok, err }` or `{ some, none }`.

---

## Something honest

A signature should cover everything that can happen. `(id: string) => User` doesn't tell you it
throws when the user isn't found, and `(id: string) => Result<NotFound, User>` does. `Task` goes a
step further. It returns a `Deferred`, which has no rejection path, so you know it never throws
because the type says so.

I used the same rule to decide how much an abstraction is allowed to hide. It can hide how something
happens, but not what can happen. `Op` handles retries, backoff, timeouts and cancellation for you:

```ts
const paymentManager = Op.interpret(submitPaymentOp, {
  strategy: "exclusive",
  retry: { attempts: 3, backoff: (attempt) => Duration.milliseconds(attempt * 500) },
  timeout: { duration: Duration.seconds(10), onTimeout: () => paymentTimedOut },
});
```

None of that machinery shows up in your code, but every possible result does. A run ends as `Ok`,
`Err`, or `Nil` (cancelled or dropped), and `Op.Outcome.match` won't compile until you've handled
all three.

The library has costs, and they belong in this section too. Curried functions allocate small
closures, which you'll only notice in tight loops over large arrays. Data-last currying takes some
getting used to. And where your code meets code that doesn't use these types, like a framework
callback or a third-party SDK, you have to convert values at the boundary.

---

## Something unobtrusive

I didn't want to move a codebase into a framework to get any of this. Values in `pipelined` are
plain objects with a `kind` field. They print normally in `console.log`, survive `JSON.stringify`,
and narrow in a regular `switch`. There are no classes, so `instanceof` can't break when a value
crosses a package or worker boundary, and there's no runtime to start.

So you can try it in one function. That function returns a `Result` and the code around it stays the
same. If it doesn't help, you take it out of that one function and you're done.

---

## Something thorough

A lot of the work went into keeping things consistent, so that once you know one module you mostly
know the others. The success value is always called `value`. A single failure is `error`, and a list
of failures is `errors`. All containers share the same core operations under the same names.

Some guarantees live in the types. A failed `Validation` always has at least one error, because the
list is typed as non-empty, so you never check for an empty one. Others are enforced at runtime:
index helpers treat `1.5`, `NaN` and `Infinity` as invalid instead of returning `undefined`.

---

## Something small

A team should be able to learn the whole library, so it tries to stay small. There's one way to do
each thing, with no aliases or duplicate modules, so code review never turns into a debate about
which spelling to use. It's small in the bundle as well. It has no dependencies and tree-shakes per
function, so if you only use `Maybe.map`, that's all you ship.

The sections below cover where the ideas came from and what was left out on purpose.

---

## When plain TypeScript is enough

Plain TypeScript with early returns is often the better choice for a one-off script, a small
internal tool, or a hot loop where allocations matter. `pipelined` is for the code a team keeps
working on for years: business logic, parsing and validation, and async workflows.

## Where the ideas come from

### Haskell

Most core types in this library come from Haskell. `Result` is based on `Either`, and `Task` on
`IO`, Haskell's lazy and composable way of describing side effects. `map` and `chain` are Haskell's
`fmap` and `>>=` under names that say what they do. `match` handles every case by name, the way
Haskell's `maybe` and `either` functions do.

`These` comes from the Haskell library of the same name. It holds a first value, a second value, or
both at once.

### Elm

Elm showed that `Maybe` and `Result` can be taught with plain, consistent names and no algebra.

The `RemoteData` pattern also started in Elm, in a package by Kris Jenkins. A data fetch is in
exactly one of four states, and modelling it that way removes the loading and error flags that can
disagree with each other.

### Rust

Rust put `Option<T>` and `Result<T, E>` in a mainstream standard library, and plenty of
performance-sensitive code uses them every day. That settled the question of whether explicit
absence and typed failure are practical outside academic languages.

### fp-ts

The direct TypeScript predecessor is fp-ts by Giulio Canti. It introduced the `pipe` composition
model, data-last currying, and the pattern of pairing a type with a module of the same name.

### Optics

`Lens` and `Optional` come from a functional programming tradition that treats a path through data
as a value. You define the path once, give it a name, pass it around, and combine it with other
paths to reach deeper. Most of that tradition comes from Haskell, and Edward Kmett's `lens` package
is the best-known implementation.

The `lens` package defines a whole family of optics (`Iso`, `Prism`, `Lens`, `Traversal`, `Fold`,
`Getter`, `Setter`) and unifies them with the van Laarhoven encoding. In that encoding, an optic is
a polymorphic higher-order function over `Functor`, `Applicative` and similar abstractions, and
optics compose with ordinary function composition. It is elegant, but it depends on higher-kinded
types. TypeScript can approximate those with encoding tricks, as fp-ts does, and this library avoids
that for the reasons given in the typeclass section below.

This library uses a simpler, concrete representation instead. Each optic is a plain record with
`get` and `set` fields:

```ts
type Lens<S, A> = {
  get: (s: S) => A;
  set: (a: A) => (s: S) => S;
};

type Optional<S, A> = {
  get: (s: S) => Maybe<A>;
  set: (a: A) => (s: S) => S;
};
```

The concrete form can't compose uniformly across the whole family, but you can read the type and see
exactly what it does, and there is no encoding to pay for.

## What was deliberately left out

### Typeclass names

The library implements the usual functional structures (`Functor`, `Monad`, `Applicative`,
`Semigroup`, `Monoid`, `Ord`, `Eq`) but names every module and function after what it does in code:
`map`, `chain`, `apply`, `Combinable`, `Ordering`, `Equality`. Someone reading a call site should be
able to tell what happens without knowing the algebraic name for it. See
[Why this exists](#something-understandable).

### A typeclass system

fp-ts simulates higher-kinded types in TypeScript with an `HKT` encoding, which lets you write
generic code over any type that implements a given typeclass. This library doesn't try. The `map` on
`Maybe` and the `map` on `Result` share a name, not an interface, so you can't write one function
that works over "any type with a `map`". That is a real limitation. In exchange, the types stay
simple and there is no encoding layer to learn.

### Classes and inheritance

Every type is plain data. There's no inheritance hierarchy and no `instanceof` checks in user-facing
code.

### Runtime brand overhead

`Brand<K, T>` exists only at compile time. At runtime, a branded value is exactly the underlying
value, with no wrapper object, tag field, or extra allocation. `Brand.wrap` and `Brand.unwrap` are
identity functions whose only job is to satisfy the type checker.

### The full optics hierarchy

`Lens` and `Optional` are two members of a much larger family. The two most useful ones left out are
`Prism`, which focuses on one variant of a union (such as the value inside `Some`, or the `Ok` case
of a `Result`), and `Traversal`, which focuses on several values at once, for example every element
of a nested array. With the concrete `{ get, set }` encoding, each new optic type needs its own
composition function for every other type, so the API grows with the square of the number of optic
types. `Lens` and `Optional` cover the cases that come up most in everyday TypeScript, so the rest
stayed out.

## Acknowledgements

The ideas behind this library come from years of reading code by people who thought hard about these
problems: the Haskell community, the Elm community and its insistence that good ideas should be
approachable, and the fp-ts contributors who did the work of encoding those ideas in TypeScript.

Particular thanks to Giulio Canti, whose fp-ts showed that typed functional programming is practical
in TypeScript, and whose source code taught me more about the language than any tutorial. To Kris
Jenkins, for naming `RemoteData` and making the case for it so clearly that the pattern spread
beyond Elm. To Edward Kmett, for the `lens` library and the optics tradition that `Lens` and
`Optional` come from. To the Haskell community more broadly, for `These` and for a huge body of work
that keeps the ecosystem moving. And to the TypeScript team, for a type system expressive enough to
encode most of these ideas at all.

If you've read this far, thank you. Whether you found the library useful, built something with it,
spotted something wrong, or just wanted to see how the pieces fit together, I'm glad you did.

Write good code. Make the impossible states unrepresentable.
