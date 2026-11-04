## Description

<!-- Describe the problem this PR solves and summarize the technical changes. Link the issue for public API changes. -->

## Quality Checklist

- [ ] `pnpm check:pr` passes for code changes, or `pnpm check:docs` passes for docs-only changes.
- [ ] Runtime and type-level tests cover the new behavior; coverage remains 100% per file.
- [ ] Zero forced type assertions (`as ...`, `any`) and zero conformity tests.
- [ ] Public exports have JSDoc with a realistic `@example` and reciprocal `@see`.
- [ ] New modules include a guide, a sidebar entry, and a `size-limit` budget.
- [ ] `pnpm size:update` was run when bundle sizes changed, and the diff was reviewed.
- [ ] Performance-sensitive changes include benchmark results.
