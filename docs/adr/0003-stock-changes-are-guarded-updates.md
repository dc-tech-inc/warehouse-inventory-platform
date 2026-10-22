# 3. Stock changes are one transaction and a guarded UPDATE

Status: accepted

**Context.** Two clerks issuing the last units at the same moment must not oversell, and the history of movements must always explain the stock on hand.

**Decision.** Every change goes through `applyStockDelta` inside a transaction together with the movement row (and the transfer or purchase-order row that caused it). A decrease is a single statement, `UPDATE stock_levels SET quantity = quantity + :delta WHERE … AND quantity + :delta >= 0`; if it touches no row the request fails with `409 Insufficient stock` and nothing is written. An increase is an upsert. A `CHECK (quantity >= 0)` constraint is the backstop. Transfers take stock out of the source immediately and add it at the destination on receive, so in-transit stock is in no warehouse.

**Alternatives.** Read, check, then write (racy without row locks); `SELECT … FOR UPDATE` on the stock row (correct, one more round trip); an append-only ledger with computed stock (clean, slower reads). The guarded UPDATE is one round trip and needs no explicit lock.

**Consequences.** An integration test fires ten concurrent issues at five units and asserts exactly five succeed; another asserts `sum(movements) = sum(stock)` after a mix of transfers. Reads of stock are cheap. There is no reservation system.
