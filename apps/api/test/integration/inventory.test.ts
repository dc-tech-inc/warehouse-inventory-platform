import request from "supertest";
import { expect, it } from "vitest";
import { describeDb, seedCatalog, signIn, stockOf, useTestDb } from "./helpers.js";

describeDb("inventory (Postgres)", () => {
  const db = useTestDb();

  it("creates, reads and updates products; SKU is unique and normalised", async () => {
    const { agent } = await signIn(db, db.app(), "manager");
    const created = await agent.post("/api/products").send({ sku: "gear-01", name: "Gear", reorderPoint: 5 }).expect(201);
    expect(created.body.product).toMatchObject({ sku: "GEAR-01", unit: "each", totalQuantity: 0, lowStock: true, stock: [] });

    await agent.post("/api/products").send({ sku: "GEAR-01", name: "Dup" }).expect(409);
    const updated = await agent.patch(`/api/products/${created.body.product.id}`).send({ reorderPoint: 0, active: false }).expect(200);
    expect(updated.body.product).toMatchObject({ reorderPoint: 0, active: false, lowStock: false });
    await agent.patch("/api/products/6f1c2a52-6f9f-4b7a-9d0a-3a3a8f1d9e01").send({ name: "x" }).expect(404);
    await agent.get("/api/products/not-a-uuid").expect(400);
  });

  it("books receipts and issues and keeps per-warehouse stock", async () => {
    const { east, west, bolt } = await seedCatalog(db);
    const { agent } = await signIn(db, db.app(), "clerk");

    const receipt = await agent.post("/api/movements").send({ kind: "receipt", productId: bolt, warehouseId: east, quantity: 30 }).expect(201);
    expect(receipt.body.movement).toMatchObject({ kind: "receipt", delta: 30, sku: "BOLT-M8", warehouseCode: "EAST", createdBy: "Test clerk" });
    await agent.post("/api/movements").send({ kind: "receipt", productId: bolt, warehouseId: west, quantity: 5 }).expect(201);
    await agent.post("/api/movements").send({ kind: "issue", productId: bolt, warehouseId: east, quantity: 12, note: "Order 1042" }).expect(201);

    const product = await agent.get(`/api/products/${bolt}`).expect(200);
    expect(product.body.product.totalQuantity).toBe(23);
    expect(product.body.product.stock).toEqual([
      { warehouseId: east, warehouseCode: "EAST", quantity: 18 },
      { warehouseId: west, warehouseCode: "WEST", quantity: 5 },
    ]);
    expect(product.body.product.lowStock).toBe(false);
  });

  it("refuses to issue more than is on hand and changes nothing", async () => {
    const { east, bolt } = await seedCatalog(db);
    const { agent } = await signIn(db, db.app(), "clerk");
    await agent.post("/api/movements").send({ kind: "receipt", productId: bolt, warehouseId: east, quantity: 4 }).expect(201);

    const res = await agent.post("/api/movements").send({ kind: "issue", productId: bolt, warehouseId: east, quantity: 5 }).expect(409);
    expect(res.body.error).toMatchObject({ code: "CONFLICT", message: "Insufficient stock", details: { available: 4, requested: 5 } });
    expect(await stockOf(db, bolt, east)).toBe(4);
    const { rows } = await db.pool().query("SELECT count(*)::int AS n FROM stock_movements");
    expect(rows[0].n).toBe(1);

    // Issuing from a warehouse that never held the product is also insufficient stock, not a 500.
    await agent.post("/api/movements").send({ kind: "issue", productId: bolt, warehouseId: (await seedExtraWarehouse()), quantity: 1 }).expect(409);
  });

  async function seedExtraWarehouse() {
    const { rows } = await db.pool().query("INSERT INTO warehouses (code, name, city) VALUES ('NORTH', 'North', 'Duluth') RETURNING id");
    return rows[0].id as string;
  }

  it("never lets concurrent issues oversell: exactly the available units are booked", async () => {
    const { east, bolt } = await seedCatalog(db);
    const { agent } = await signIn(db, db.app(), "clerk");
    await agent.post("/api/movements").send({ kind: "receipt", productId: bolt, warehouseId: east, quantity: 5 }).expect(201);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => agent.post("/api/movements").send({ kind: "issue", productId: bolt, warehouseId: east, quantity: 1 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await stockOf(db, bolt, east)).toBe(0);
  });

  it("rejects inactive products for receipts but allows adjustments by managers", async () => {
    const { east, nut } = await seedCatalog(db);
    await db.pool().query("UPDATE products SET active = false WHERE id = $1", [nut]);
    const clerk = await signIn(db, db.app(), "clerk");
    await clerk.agent.post("/api/movements").send({ kind: "receipt", productId: nut, warehouseId: east, quantity: 1 }).expect(409);

    const manager = await signIn(db, db.app(), "manager");
    await manager.agent
      .post("/api/movements")
      .send({ kind: "adjustment", productId: nut, warehouseId: east, quantity: 3, note: "found in aisle 4" })
      .expect(201);
    expect(await stockOf(db, nut, east)).toBe(3);
  });

  it("lets only managers adjust stock; negative adjustments cannot go below zero", async () => {
    const { east, bolt } = await seedCatalog(db);
    const clerk = await signIn(db, db.app(), "clerk");
    const body = { kind: "adjustment", productId: bolt, warehouseId: east, quantity: -2, note: "damaged" };
    const denied = await clerk.agent.post("/api/movements").send(body).expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");

    const manager = await signIn(db, db.app(), "manager");
    await manager.agent.post("/api/movements").send(body).expect(409);
    await manager.agent.post("/api/movements").send({ ...body, quantity: 6 }).expect(201);
    await manager.agent.post("/api/movements").send(body).expect(201);
    expect(await stockOf(db, bolt, east)).toBe(4);
  });

  it("returns 404 for unknown products and warehouses and 400 for bad bodies", async () => {
    const { east, bolt } = await seedCatalog(db);
    const { agent } = await signIn(db, db.app(), "clerk");
    const ghost = "6f1c2a52-6f9f-4b7a-9d0a-3a3a8f1d9e01";
    await agent.post("/api/movements").send({ kind: "receipt", productId: ghost, warehouseId: east, quantity: 1 }).expect(404);
    await agent.post("/api/movements").send({ kind: "receipt", productId: bolt, warehouseId: ghost, quantity: 1 }).expect(404);
    const bad = await agent.post("/api/movements").send({ kind: "receipt", productId: bolt, warehouseId: east, quantity: -1 }).expect(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("lists products with search, low-stock filter and pagination", async () => {
    const { east, bolt, nut } = await seedCatalog(db);
    const { agent } = await signIn(db, db.app(), "clerk");
    await agent.post("/api/movements").send({ kind: "receipt", productId: nut, warehouseId: east, quantity: 100 }).expect(201);
    await agent.post("/api/movements").send({ kind: "receipt", productId: bolt, warehouseId: east, quantity: 3 }).expect(201);

    const all = await agent.get("/api/products").expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items.map((p: { sku: string }) => p.sku)).toEqual(["BOLT-M8", "NUT-M8"]);

    const low = await agent.get("/api/products?lowStock=true").expect(200);
    expect(low.body.items.map((p: { sku: string }) => p.sku)).toEqual(["BOLT-M8"]);
    const ok = await agent.get("/api/products?lowStock=false").expect(200);
    expect(ok.body.items.map((p: { sku: string }) => p.sku)).toEqual(["NUT-M8"]);

    const search = await agent.get("/api/products?q=nut").expect(200);
    expect(search.body).toMatchObject({ total: 1, items: [{ sku: "NUT-M8", totalQuantity: 100 }] });
    expect((await agent.get("/api/products?q=%25").expect(200)).body.total).toBe(0); // "%" is literal, not a wildcard

    const page = await agent.get("/api/products?limit=1&offset=1").expect(200);
    expect(page.body).toMatchObject({ total: 2, items: [{ sku: "NUT-M8" }] });
    await agent.get("/api/products?limit=1000").expect(400);
  });

  it("lists the movement history newest first, filtered and paginated", async () => {
    const { east, west, bolt } = await seedCatalog(db);
    const { agent } = await signIn(db, db.app(), "clerk");
    for (const [warehouse, quantity] of [[east, 1], [west, 2], [east, 3]] as const) {
      await agent.post("/api/movements").send({ kind: "receipt", productId: bolt, warehouseId: warehouse, quantity }).expect(201);
    }
    const all = await agent.get("/api/movements").expect(200);
    expect(all.body.total).toBe(3);
    expect(all.body.items.map((m: { delta: number }) => m.delta)).toEqual([3, 2, 1]);

    const filtered = await agent.get(`/api/movements?warehouseId=${west}`).expect(200);
    expect(filtered.body).toMatchObject({ total: 1, items: [{ delta: 2, warehouseCode: "WEST" }] });
    const page = await agent.get("/api/movements?limit=2&offset=2").expect(200);
    expect(page.body.items).toHaveLength(1);
  });

  it("runs a transfer end to end: out now, in on receive, cancel returns the stock", async () => {
    const { east, west, bolt } = await seedCatalog(db);
    const { agent } = await signIn(db, db.app(), "clerk");
    await agent.post("/api/movements").send({ kind: "receipt", productId: bolt, warehouseId: east, quantity: 10 }).expect(201);

    const t1 = await agent.post("/api/transfers").send({ productId: bolt, fromWarehouseId: east, toWarehouseId: west, quantity: 4 }).expect(201);
    expect(t1.body.transfer).toMatchObject({ status: "in_transit", fromCode: "EAST", toCode: "WEST", quantity: 4, receivedAt: null });
    expect(await stockOf(db, bolt, east)).toBe(6);
    expect(await stockOf(db, bolt, west)).toBe(0); // in transit, not counted anywhere yet

    const received = await agent.post(`/api/transfers/${t1.body.transfer.id}/receive`).expect(200);
    expect(received.body.transfer.status).toBe("received");
    expect(received.body.transfer.receivedAt).not.toBeNull();
    expect(await stockOf(db, bolt, west)).toBe(4);
    await agent.post(`/api/transfers/${t1.body.transfer.id}/receive`).expect(409);
    await agent.post(`/api/transfers/${t1.body.transfer.id}/cancel`).expect(409);

    const t2 = await agent.post("/api/transfers").send({ productId: bolt, fromWarehouseId: east, toWarehouseId: west, quantity: 6 }).expect(201);
    expect(await stockOf(db, bolt, east)).toBe(0);
    await agent.post(`/api/transfers/${t2.body.transfer.id}/cancel`).expect(200);
    expect(await stockOf(db, bolt, east)).toBe(6);

    const list = await agent.get("/api/transfers?status=in_transit").expect(200);
    expect(list.body.total).toBe(0);
    expect((await agent.get("/api/transfers").expect(200)).body.total).toBe(2);
    // Stock plus movements always reconcile: sum of deltas equals sum of stock.
    const { rows } = await db.pool().query(
      "SELECT (SELECT sum(delta) FROM stock_movements)::int AS d, (SELECT sum(quantity) FROM stock_levels)::int AS q",
    );
    expect(rows[0]).toEqual({ d: 10, q: 10 });
  });

  it("rejects a transfer with insufficient stock or the same warehouse", async () => {
    const { east, west, bolt } = await seedCatalog(db);
    const { agent } = await signIn(db, db.app(), "clerk");
    await agent.post("/api/transfers").send({ productId: bolt, fromWarehouseId: east, toWarehouseId: west, quantity: 1 }).expect(409);
    await agent.post("/api/transfers").send({ productId: bolt, fromWarehouseId: east, toWarehouseId: east, quantity: 1 }).expect(400);
    await agent.post("/api/transfers/6f1c2a52-6f9f-4b7a-9d0a-3a3a8f1d9e01/receive").expect(404);
    const { rows } = await db.pool().query("SELECT count(*)::int AS n FROM transfers");
    expect(rows[0].n).toBe(0);
  });

  it("creates warehouses (managers) and rejects duplicate codes", async () => {
    const manager = await signIn(db, db.app(), "manager");
    const res = await manager.agent.post("/api/warehouses").send({ code: "south", name: "South", city: "Macon" }).expect(201);
    expect(res.body.warehouse.code).toBe("SOUTH");
    await manager.agent.post("/api/warehouses").send({ code: "SOUTH", name: "Again", city: "Macon" }).expect(409);
    const list = await manager.agent.get("/api/warehouses").expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it("summarises the dashboard", async () => {
    const { east, bolt } = await seedCatalog(db);
    const { agent } = await signIn(db, db.app(), "clerk");
    await agent.post("/api/movements").send({ kind: "receipt", productId: bolt, warehouseId: east, quantity: 3 }).expect(201);
    const res = await agent.get("/api/dashboard").expect(200);
    expect(res.body).toEqual({ products: 2, lowStock: 1, openPurchaseOrders: 0, transfersInTransit: 0, movementsLast7Days: 1 });
  });

  it("requires a session for every inventory route", async () => {
    const app = db.app();
    await request(app).get("/api/products").expect(401);
    await request(app).get("/api/dashboard").expect(401);
    await request(app).post("/api/transfers").send({}).expect(401);
  });
});
