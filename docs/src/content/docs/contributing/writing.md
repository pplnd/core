---
title: Writing Guides
description: The anatomy, voice, JSDoc, and cross-link rules for documentation guides.
---

A guide teaches one module and shows where it sits in a larger program. A reference page answers
"what does this function do"; a guide answers "when do I reach for this module, and what do I hand
off to next".

This page is the public writing standard. The [module authoring guide](/contributing/modules/)
covers code structure; [Testing](/contributing/testing/) covers tests.

## Anatomy

```markdown
---
title: Module Name — What It Prevents
description: One sentence that states the capability.
---

<Opening: two to four sentences, situation and failure, no library type names>

## Core Behavior

Definition, behavior bullets, then one placement paragraph.

## Example: <Situation>

Scenario, implementation, and a handoff subsection.

## Core Operations

Intent-grouped tables.

## Failure Behavior and Edge Cases

Concrete failure semantics and sibling links.
```

## Opening

Describe one scene and the concrete failure before naming a library type. The reader should
recognize the problem first.

Good:

> A thumbnail worker reads its queue URL from an environment variable. When the variable is absent,
> the worker starts with the string `undefined` and fails on the first job.

Avoid announcing the page or listing several unrelated scenarios. One subject, one action, one
consequence.

## Core Behavior

Define the type in one sentence, then give two to four behavior bullets: short-circuiting, ordering,
boundary safety, and cancellation. Close the section with one nearest alternative and a link to
`/basics/choosing/`. Do not turn the paragraph into a menu of every related module.

## Example and handoff

Keep one domain from the opening through the handoff. Register the guide's hero SVG explainer figure
under `docs/src/figures/` (wired through `docs/src/components/GuideFigure.astro`) to show the
primary transition or branching behavior at the top of the article. Then show a complete
implementation with real interfaces, real error types, and `pipe(...)`.

End the example with one `###` handoff subsection that takes the same feature one step into an
adjacent module: `Result` to `Task.Result`, `Validation` to a `Result` boundary, `Graph` to
`Transaction`, or `Lens` to `Optional`. The handoff shows the seam; it does not re-teach the next
module.

## Core Operations

Group operations by intent: Creating, Combining, Transforming, Running, Reading, or Converting. Use
a table with the signature, what it does, and the return type. Split a table by intent rather than
letting it grow into a wall.

## Failure Behavior and Edge Cases

Document exception boundaries, cancellation, ordering, clamping, and callback contracts. Link a
sibling guide when a failure belongs to it, such as `Aborted` for cancellation. Do not restate
ordinary TypeScript semantics.

## JSDoc

Every public export needs:

1. A one-line plain-English description.
2. A realistic `@example`, not `foo(bar)` or a type puzzle.
3. Reciprocal `@see` links for complementary operations: `map` and `chain`, `traverse` and
   `sequence`, `tap` and `tapError`, `from.*` and `to.*`.

Keep `fetch` out of base `Task` examples. Use it in `Task.Result`, `Task.Maybe`, or `Op` instead.

## Cross-links and voice

Every guide carries at least two inline links: one in the placement paragraph and one in the
handoff. Async guides link to `/basics/types/`. Any guide that mentions cancellation links to
`/guides/aborted/`.

Write for a TypeScript developer with three years of experience and no functional-programming
background. Replace "declarative lifecycle bracket" with "pairs setup with cleanup"; replace
"catamorphism" with "named-case matching". No promotional adjectives, no "in essence", no "not only
... but also".

## Typography and hero figures

- Use spaced em dashes.
- Do not use LaTeX delimiters.
- Author hero explainer figures in `viewBox="0 0 600 256"` with a pastel plate token
  (`--figure-plate`), `currentColor` geometric paths (`stroke-width="2"`), `.flow-input` /
  `.flow-case` / `.flow-value` text classes, and an accessible `<title>` and `<desc>`.

## Complete example

```ts check
import { Maybe, pipe } from "@pplnd/core";

const label = (value: string | null): string =>
  pipe(Maybe.from.nullable(value), Maybe.getOrElse(() => "Anonymous"));
```

## Checklist

- [ ] The opening states the situation and failure before naming a type.
- [ ] `Core Behavior` ends with one nearest sibling and `/basics/choosing/`.
- [ ] A hero SVG figure is registered under `docs/src/figures/`, and the example keeps one domain
      with an implementation and a handoff.
- [ ] `Core Operations` is grouped by intent.
- [ ] `Failure Behavior and Edge Cases` is specific.
- [ ] At least two inline documentation links are present.
- [ ] No numbered headings, LaTeX, banned phrases, or "Problems it solves" appendix.
- [ ] `pnpm format` and `pnpm docs:build` pass.

Run `pnpm check:docs` before opening a docs pull request; it checks formatting, links, marked
snippets, bundle metadata, and the Astro build.
