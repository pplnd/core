# pipelined

Monorepo for the `pipelined` project.

| Package       | Location        | What it is                                                                      |
| ------------- | --------------- | ------------------------------------------------------------------------------- |
| `@pplnd/core` | `packages/core` | Typed errors, explicit optional values, and composable pipelines for TypeScript |
| `@pplnd/docs` | `docs`          | Documentation site ([pplnd.dev](https://pplnd.dev/))                            |

## Development

```sh
pnpm install
pnpm build        # build all packages
pnpm test         # run all package test suites
pnpm check        # lint + format + type tests + typecheck (repo-wide gate)
pnpm check:pr     # check + build + coverage + docs checks
```

Toolchain is pinned in `mise.toml` (Node >=26, pnpm). Package-specific scripts run through
`pnpm --filter`, e.g. `pnpm --filter @pplnd/core test`.
