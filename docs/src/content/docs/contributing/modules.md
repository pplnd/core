---
title: Adding a Module
description: The module anatomy, naming rules, JSDoc contract, and exact checklist for a new public module.
---

A module is a type alias and a static const object with the same name. The shape keeps the runtime
plain, makes tree-shaking predictable, and gives editors one namespace to autocomplete.

## Anatomy

```ts
import { WithError, WithKind, WithValue } from "#internal";

export type Foo<E, A> = Foo.Bar<A> | Foo.Baz<E>;
export namespace Foo {
  export type Bar<A> = WithKind<"Bar"> & WithValue<A>;
  export type Baz<E> = WithKind<"Baz"> & WithError<E>;
}

export const Foo = {
  make: {
    bar: <A>(value: A): Foo<never, A> => ({ kind: "Bar", value }),
    baz: <E>(error: E): Foo<E, never> => ({ kind: "Baz", error }),
  },
  map: ...,
  chain: ...,
  match: ...,
};
```

Import `WithKind`, `WithValue`, and `WithError` from `#internal`. Do not inline the helpers. Do not
add a class, `instanceof`, or an `of` constructor.

## Naming

| Category            | Pattern                     | Example                                |
| :------------------ | :-------------------------- | :------------------------------------- |
| Constructor         | plain name under `make.*`   | `Result.make.ok`                       |
| Native converter    | `to.<type>` / `from.<type>` | `Maybe.to.nullable`, `Num.from.string` |
| Container converter | `to.<Type>` / `from.<Type>` | `Result.to.Maybe`                      |
| Try-wrap            | `tryCatch`                  | `Result.tryCatch`                      |

The standard surface is `is`, `map`, `mapError`, `chain`, `apply`, `match`, `getOrElse`, `tap`,
`recover`, `tryCatch`, `from.*`, and `to.*`. Add only the operations the module can explain.

Data goes last. `match({ ok, err })` is the only elimination form; positional `fold` is not part of
the API. Name callbacks `transform`, `predicate`, `sideEffect`, `reducer`, `compare`, or
`combineErrors`, not `b`, `a`, or `f`.

## Hard rules

- No classes, prototype methods, or `instanceof`.
- No `of` constructor and no `to` prefix on constructors.
- No alias functions, duplicate modules, or dual-exposed namespaces.
- Every public type is the module type or lives in its companion namespace. No detached options or
  callback types at the file root.
- `src/Core/index.ts` and the other domain barrels export public modules only. Import siblings
  relatively inside a domain; never import the domain barrel through `#core`.
- Every public export has JSDoc with a realistic `@example` and reciprocal `@see` references.
- The published package has zero runtime dependencies. A dependency is an architecture decision and
  needs an issue.

## JSDoc

Write a one-line description in plain English. Add an example that resembles application code, not
`foo(bar)`. For complementary pairs, link both sides: `map` and `chain`, `traverse` and `sequence`,
`tap` and `tapError`, `from.*` and `to.*`.

Do not use `fetch` in base `Task` examples. Fallible async belongs in `Task.Result`, `Task.Maybe`,
or `Op`.

## New module checklist

1. Add `src/<Domain>/Foo.ts` with the type alias and companion const object.
2. Export it from the domain barrel, such as `src/Core/index.ts` or `src/Data/index.ts`.
3. Add `src/<Domain>/__tests__/Foo.test.ts` and `Foo.test-d.ts`.
4. Add `Foo.prop.test.ts` when the module encodes algebraic laws or stateful sequencing.
5. Add JSDoc with a realistic example and reciprocal `@see`.
6. Add `docs/src/content/docs/guides/foo.md` using [the guide anatomy](/contributing/writing/).
7. Add the guide to the sidebar in `docs/astro.config.mjs`.
8. Add a `size-limit` entry in `package.json`.
9. Add the guide to `scripts/docs-manifest.ts`. Use `{ module: "Foo" }` for a module guide and
   `{ module: null }` only for an aggregate guide with no module-specific budget.
10. Run `pnpm size:update`, review the diff, then run `pnpm check:pr` and `pnpm docs:build`.

The bundle-size test fails when a guide is missing from the manifest, when a badge is missing or
duplicated, or when the guide is absent from the sidebar. The size budget test fails when a manifest
entry has no matching `size-limit` target.

## Performance

If the change touches a hot path, run `pnpm bench` and compare the before and after numbers. Include
the benchmark result in the pull request. Do not replace a loop or a data layout on intuition; the
[benchmark appendix](/appendix/benchmarks/) documents the existing measurements.

## Getting help

Open an issue for a new public API, a naming decision, or a dependency. The
[contributor handbook](/contributing/) lists the other rules; [Testing](/contributing/testing/)
covers the test contract.
