# Contributing to pipelined

`pipelined` is written for TypeScript developers who have never used a functional-programming
library. Contributions of every size are welcome: a corrected sentence, a failing test, a clearer
error message, a new guide, or a module.

If you are unsure whether a change fits, open an issue first. It is cheaper than writing code we
cannot merge. Public API changes should always start as an issue.

Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues through
[SECURITY.md](SECURITY.md), not public issues.

## Start here

- **Improve documentation.** Edit a page in `docs/src/content/docs/`, run `pnpm docs:build`, and
  open a pull request.
- **Fix a bug.** Add a failing test, fix it, and run `pnpm check:pr`.
- **Add a module or public API.** Open an issue first, then follow the
  [module checklist](docs/src/content/docs/contributing/modules.md).

## Set up

Development uses Node 26.13.0 and pnpm 12.16.1. The published package supports Node 18+;
`engines.node` describes consumers, not the development toolchain.

```sh
git clone https://github.com/pplnd/core.git
cd core
mise install
pnpm install
pnpm test:coverage
pnpm check
```

If you do not use [mise](https://mise.jdx.dev/), install Node 26.13.0 and pnpm 12.16.1 yourself. The
lockfile is checked in.

## Everyday commands

| Command                                               | What it does                                                             |
| :---------------------------------------------------- | :----------------------------------------------------------------------- |
| `pnpm test`                                           | Run the runtime test suite.                                              |
| `pnpm test src/Core/__tests__/Result.test.ts`         | Run one runtime test file.                                               |
| `pnpm test:types`                                     | Run the type-level test suite.                                           |
| `pnpm test:types src/Core/__tests__/Result.test-d.ts` | Run one type test file.                                                  |
| `pnpm test:coverage`                                  | Run everything with 100% per-file coverage.                              |
| `pnpm check`                                          | Typecheck, type tests, lint, and formatting.                             |
| `pnpm check:pr`                                       | The full code gate: static checks, coverage, build, and docs.            |
| `pnpm check:docs`                                     | The docs gate: formatting, bundle metadata, links, snippets, and build.  |
| `pnpm format`                                         | Format TypeScript, JSON, and Markdown. Use this, not plain `dprint fmt`. |
| `pnpm docs:dev`                                       | Preview the documentation site at `http://localhost:4321`.               |
| `pnpm docs:build`                                     | Build the Astro site and the generated API reference.                    |
| `pnpm size:update`                                    | Refresh the bundle-size tables and guide badges.                         |
| `pnpm bench`                                          | Run the benchmark suite.                                                 |

## Rules in brief

1. Use plain discriminated unions. No classes, no `instanceof`, no `of` constructor.
2. Put the data last in curried functions: `pipe(data, Module.fn(arg))`.
3. In `fn(arg)(data)`, declare a generic that appears only in `data` on the inner function:
   `<E = never>(data: Result<E, A>)`.
4. Use `match({ ok, err })` as the only eliminator. Positional `fold` is not part of the API.
5. Import sibling modules relatively inside `src/Core/` and `src/Data/`. Never use `#core` there.
6. Give every public export JSDoc with a realistic example. Add a guide for every module.
7. The published package has zero runtime dependencies. Open an issue before adding one.

The [module authoring guide](docs/src/content/docs/contributing/modules.md) explains the structure,
naming rules, and the exact new-module checklist.

## Before you open a pull request

- For code changes, run `pnpm check:pr`.
- For docs-only changes, run `pnpm check:docs`.
- If a bundle size changed, run `pnpm size:update` and review the diff.
- If you changed a hot path, run `pnpm bench` and include the before/after numbers.
- Keep the pull request focused. Maintainers review every change.
- Do not edit the version in `package.json`; maintainers handle releases.

## Read next

- [Contributor handbook](docs/src/content/docs/contributing/index.md)
- [Local workflow](docs/src/content/docs/contributing/workflow.md)
- [Testing](docs/src/content/docs/contributing/testing.md)
- [Adding a module](docs/src/content/docs/contributing/modules.md)
- [Writing guides](docs/src/content/docs/contributing/writing.md)

## Community

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports go through
[SECURITY.md](SECURITY.md), not public issues. Contributions are accepted under the repository's
BSD-3-Clause license.
