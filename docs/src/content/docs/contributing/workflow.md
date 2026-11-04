---
title: Local Workflow
description: Set up the repository, run one test, and open a focused pull request.
---

This page covers the day-to-day loop. The [contributor handbook](/contributing/) explains where the
rules live; [Testing](/contributing/testing/) and [Adding a Module](/contributing/modules/) cover
the code expectations.

## Set up

Development uses Node 26.13.0 and pnpm 12.16.1. The published package supports Node 18+; the
`engines.node` field describes consumers, not the development toolchain.

```sh
git clone https://github.com/pplnd/core.git
cd core
mise install
pnpm install
```

If you do not use [mise](https://mise.jdx.dev/), install Node 26.13.0 and pnpm 12.16.1 yourself. The
root workspace includes the documentation site; `pnpm install` installs both.

## The loop

```sh
pnpm test:coverage        # 100% per-file coverage
pnpm check                # typecheck, type tests, lint, format

pnpm test src/Core/__tests__/Result.test.ts
pnpm test:types src/Core/__tests__/Result.test-d.ts

pnpm format
pnpm check:pr             # full code gate
```

For a docs-only change:

```sh
pnpm docs:dev             # http://localhost:4321
pnpm format
pnpm check:docs           # formatting, size metadata, links, snippets, build
```

`pnpm check` is the fast inner loop. `pnpm check:pr` is the command the code CI job mirrors.
`pnpm check:docs` is the command the docs CI job mirrors.

## Your first change

1. Find the module and its guide. Read both before editing.
2. Add the smallest failing test that describes the behavior.
3. Make the change.
4. Run the single test, then `pnpm test:coverage`.
5. Run `pnpm check:pr` or `pnpm check:docs`.
6. Format before committing: `pnpm format`. The formatter covers TypeScript, JSON, and Markdown.

If the change touches a hot path, run `pnpm bench` and compare the before and after numbers. Do not
claim a performance win without a benchmark.

## Pull requests

- Keep one concern per pull request. A focused change is easier to review and revert.
- Use a short imperative subject. The repository history uses prefixes such as `feat:`, `fix:`,
  `docs:`, and `test:`.
- Link the issue for a public API change or a new module.
- Do not edit the package version. Maintainers handle releases.

The pull request template lists the checks. CI runs the code verification suite for source changes
and the documentation suite for docs changes.

## CI

| Job                        | What it runs                                                                                            |
| :------------------------- | :------------------------------------------------------------------------------------------------------ |
| Code Verification          | typecheck, TypeScript 5.5 compatibility, type tests, lint, format, build, coverage, and the docs build. |
| Documentation Verification | `pnpm check:docs`: formatting, bundle metadata, links, snippets, and the Astro build.                   |

If a check fails, reproduce it with the matching local command before pushing again.

## Troubleshooting

- **Wrong Node or pnpm version.** Run `mise install` and check `node -v` and `pnpm -v`. The pinned
  versions are in `mise.toml`.
- **Formatting fails on Markdown.** Run `pnpm format`. Plain `dprint fmt` only covers the default
  configuration and leaves the Markdown config untouched.
- **The docs server will not start.** Stop the existing Astro server or use the port it reports.
- **Coverage fails.** Open `coverage/index.html` and add a test for the uncovered branch. Do not add
  `/* v8 ignore */`.
- **Type tests fail.** Run the single `.test-d.ts` file; the compiler message names the expression
  that lost its type.

## Versioning and releases

The project is pre-1.0. Maintainers bump versions and publish from a tag; contributors do not edit
`package.json` version fields. Breaking API changes are allowed when they remove a concrete defect
or materially improve the developer experience, but they need an issue and a migration note.
