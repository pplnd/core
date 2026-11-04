---
title: Testing
description: Runtime tests, type tests, coverage, boundaries, and benchmarks for pipelined.
---

Tests defend the library's developer experience. A runtime test states what a caller observes, a
type test states what the compiler infers, and a property test checks the laws a container claims to
follow. If a test needs a cast to compile, the signature or the domain model is wrong.

## Commands

| Command                                               | What it does                                |
| :---------------------------------------------------- | :------------------------------------------ |
| `pnpm test`                                           | Run the runtime test suite.                 |
| `pnpm test src/Core/__tests__/Result.test.ts`         | Run one runtime test file.                  |
| `pnpm test:types`                                     | Run the type-level test suite.              |
| `pnpm test:types src/Core/__tests__/Result.test-d.ts` | Run one type test file.                     |
| `pnpm test:coverage`                                  | Run everything with 100% per-file coverage. |
| `pnpm bench`                                          | Run the benchmark suite.                    |

Runtime tests live in `src/<Domain>/__tests__/<Module>.test.ts`. Type tests live beside them as
`<Module>.test-d.ts`. Property tests use `<Module>.prop.test.ts`.

## Runtime tests

Use the `<target>: <behavior>` title format. The target names the function or module; the behavior
states the observable result.

```ts
import { expect, test } from "vitest";
import { pipe, Result } from "@pplnd/core";

test("Result.map: transforms the ok value", () => {
  const outcome = pipe(Result.make.ok(2), Result.map((value) => value * 3));
  expect(outcome).toStrictEqual(Result.make.ok(6));
});
```

Cover the happy path, the failure path, short-circuiting, and side-effect isolation. Use
`toStrictEqual` for objects and arrays, and `toBe` for primitives.

## Type tests

Type tests use `expectTypeOf` for positive inference and a justified `@ts-expect-error` for a
negative case. A `@ts-expect-error` is not a way to accept a limitation; if a realistic composition
fails, change the signature and remove the error.

```ts
import { expectTypeOf, test } from "vitest";
import { Result } from "@pplnd/core";

test("Result.make.ok: infers the value and preserves the error channel", () => {
  const value = Result.make.ok(42);
  expectTypeOf(value).toEqualTypeOf<Result<never, number>>();
});
```

Use `#test-utils` and `constTruthyBool` when a test needs an un-narrowed union. Do not force a union
with `make.ok` alone if control-flow narrowing would hide the type you are testing.

## Property tests

Add a `.prop.test.ts` companion when the module encodes algebraic laws or stateful sequencing:
functor and monad identity, composition, ordering, idempotence, or resource/release order. Not every
module needs one; a symbol, a brand, or a constant has no useful algebraic surface.

Property tests use `fast-check`. Indexed operations must include non-integer inputs such as
`fc.double({ noInteger: true })` so a float cannot accidentally pass as an index.

## Coverage

Coverage is 100% per file, not 100% overall. A new branch needs a test. The HTML report at
`coverage/index.html` names the uncovered lines. Do not add `/* v8 ignore */` or similar pragmas to
skip a branch; if a branch is unreachable, the implementation is carrying dead code.

The coverage gate also runs the bundle-size test, which checks the README, installation page, and
guide badges against `size-limit`.

## Boundaries and casts

- Index and collection operations must test `1.5`, `NaN`, and `Infinity` where the type permits
  them.
- Nullish filters must keep falsy values: `0`, `false`, and `""` are values, not absence.
- Do not use `as`, `any`, or `unknown` casts in tests. A cast hides the defect the test exists to
  find.
- Never write a conformity test. If a reasonable composition fails to compile, fix the signature.

The [module authoring guide](/contributing/modules/) covers type placement and public API rules. The
[local workflow](/contributing/workflow/) lists the full gate.
