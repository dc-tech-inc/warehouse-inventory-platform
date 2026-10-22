# 4. Purchase orders are a small state machine with separation of duties

Status: accepted

**Context.** A purchase order moves through steps done by different people, and receiving it changes stock.

**Decision.** The allowed transitions are one table (`nextStatus` in `packages/shared/src/purchasing.ts`): `draft → submitted → approved → received`, with `cancel` allowed until received. The API loads the order with `SELECT … FOR UPDATE`, asks the table for the next status and answers `409` when the action is not allowed, so two people cannot receive the same order twice. Each action has its own permission (clerks submit and receive; managers approve and cancel). The creator cannot approve their own order, even as admin. Receiving books one `receipt` movement per line in the same transaction as the status change.

**Consequences.** The table is unit-tested without a database (including "terminal states accept nothing"); the integration tests cover the real flow and the 403/409 cases. No partial receipts: an order is received whole. The web app uses the same `nextStatus` to decide which buttons to show.
