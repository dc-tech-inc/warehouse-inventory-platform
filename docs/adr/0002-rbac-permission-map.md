# 2. RBAC as a permission map in the shared package

Status: accepted

**Context.** Three roles (admin, manager, clerk) must be enforced on the API and reflected in the UI (hide what you cannot do).

**Decision.** `packages/shared/src/rbac.ts` holds one map from role to permissions (`inventory:write`, `purchasing:approve`, …). Routes use `guard(auth, permission)`, which answers `401` without a session and `403` without the permission. The web app imports the same `can(role, permission)` to decide which navigation and buttons to show. Each role is a strict superset of the one below it, which a unit test asserts. The role is read from the database on every request, not stored in the session, so a role change applies at once.

**Consequences.** One place to read "who can do what". The UI check is cosmetic; the server is the authority, and integration tests hit the routes with each role. Adding a role means adding one map entry. Not covered: per-record ownership or per-warehouse scoping.
