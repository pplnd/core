---
title: Contributor Handbook
description: How to set up, test, and contribute to pipelined.
---

`pipelined` is a TypeScript library for typed errors, explicit absence, and composable async. It is
written for developers who have never used a functional-programming library. Contributions of every
size are welcome.

## Pick a path

- **Documentation.** Fix a confusing paragraph, add a missing example, or write a guide. Start with
  [Writing Guides](/contributing/writing/).
- **Bug fix.** Add a failing test, fix the behavior, and run the full gate. Start with
  [Testing](/contributing/testing/).
- **New module or public API.** Open an issue before writing code. The design and the guide are
  easier to align first. Start with [Adding a Module](/contributing/modules/).

## Before you start

Open an issue for a new public API, a new module, a breaking change, or a dependency. Small fixes
and documentation corrections can go straight to a pull request.

If a rule in this handbook blocks a reasonable use case, say so in the issue. The rules exist to
protect the developer experience; they are not an end in themselves.

## How review works

1. Run the local gate for your change: `pnpm check:pr` for code, `pnpm check:docs` for docs.
2. Open a pull request using the template. Link the issue for public API changes.
3. A maintainer reviews the change. CI must pass before merge.

Do not edit the package version. Maintainers handle version bumps and releases.

## Where the rules live

| Topic                                               | Page                                      |
| :-------------------------------------------------- | :---------------------------------------- |
| Clone, install, branch, and open a PR               | [Local Workflow](/contributing/workflow/) |
| Runtime tests, type tests, coverage, benchmarks     | [Testing](/contributing/testing/)         |
| Module anatomy, naming, JSDoc, new-module checklist | [Adding a Module](/contributing/modules/) |
| Guide anatomy, voice, cross-links, Mermaid, JSDoc   | [Writing Guides](/contributing/writing/)  |
| Choosing between modules                            | [Choosing a Container](/basics/choosing/) |

## If you get stuck

Open an issue with the command you ran, the output, and what you expected. A short reproduction is
more useful than a complete application. The
[Code of Conduct](https://github.com/pplnd/core/blob/main/CODE_OF_CONDUCT.md) explains the community
expectations.
