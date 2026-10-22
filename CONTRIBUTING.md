# Contributing

Small, focused changes are easiest to review.

1. Branch from `main`: `feat/<scope>` or `fix/<scope>`.
2. Use [conventional commits](https://www.conventionalcommits.org/) (`feat(api): …`, `fix(web): …`, `docs: …`, `test: …`).
3. Before pushing: `pnpm lint && pnpm typecheck && pnpm test` (needs a PostgreSQL database whose name contains `test`; see the README). Run `gitleaks git .` too if you have it.
4. Open a pull request. CI must be green: lint, typecheck, tests with coverage, build, gitleaks, and on pull requests the Playwright e2e and the `docker compose up` smoke test.
5. Merge with a merge commit (no squash) so the history stays as it happened.

Changing the schema: edit `packages/db/src/schema.ts`, run `pnpm db:generate`, and commit the generated SQL. If a change touches a rule (RBAC, stock, purchase order workflow), add a test that fails without it and, for a design change, a short ADR in `docs/adr`.

Keep example data synthetic. No real names, customers, credentials or personal data.
