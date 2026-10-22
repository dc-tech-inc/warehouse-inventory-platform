# 1. Start from `ts-fullstack-starter`

Status: accepted

**Context.** Session auth, the Drizzle setup, the error envelope, OpenAPI generation and the CI skeleton were already built and tested in [`ts-fullstack-starter`](https://github.com/dc-tech-inc/ts-fullstack-starter). Rebuilding them adds nothing.

**Decision.** This repository was generated from that template (GitHub shows "generated from"). The first commit is the template as it was; everything after it is the warehouse domain: the `tasks` module is removed, public sign-up is replaced by admin-created accounts, and roles, the domain schema, the UI and the e2e suite are added.

**Consequences.** The starter stays the generic base; this repo is the domain product on top. Auth hardening (argon2id, hashed session tokens, same response for unknown email and wrong password) is inherited and keeps its tests.
