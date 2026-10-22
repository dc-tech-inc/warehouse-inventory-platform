import { expect, it } from "vitest";
import { describeDb, seedCatalog, signIn, stockOf, useTestDb } from "./helpers.js";

describeDb("purchasing (Postgres)", () => {
  const db = useTestDb();

  async function setup() {
    const catalog = await seedCatalog(db);
    const app = db.app();
    const clerk = await signIn(db, app, "clerk");
    const manager = await signIn(db, app, "manager");
    const supplier = await clerk.agent.post("/api/suppliers").send({ name: "Acme Fasteners (synthetic)", country: "US" }).expect(201);
    const draft = await clerk.agent
      .post("/api/purchase-orders")
      .send({
        supplierId: supplier.body.supplier.id,
        warehouseId: catalog.east,
        lines: [
          { productId: catalog.bolt, quantity: 100, unitCostCents: 25 },
          { productId: catalog.nut, quantity: 50, unitCostCents: 10 },
        ],
      })
      .expect(201);
    return { ...catalog, clerk, manager, supplier: supplier.body.supplier, po: draft.body.purchaseOrder };
  }

  it("creates a draft with numbered header, lines and total", async () => {
    const { po, east } = await setup();
    expect(po).toMatchObject({
      number: "PO-000001",
      status: "draft",
      warehouseId: east,
      warehouseCode: "EAST",
      supplierName: "Acme Fasteners (synthetic)",
      createdBy: "Test clerk",
      approvedBy: null,
      totalCents: 100 * 25 + 50 * 10,
    });
    expect(po.lines.map((l: { sku: string }) => l.sku)).toEqual(["BOLT-M8", "NUT-M8"]);
  });

  it("walks submit -> approve -> receive and books the stock", async () => {
    const { po, east, bolt, nut, clerk, manager } = await setup();
    const id = po.id as string;

    expect((await clerk.agent.post(`/api/purchase-orders/${id}/submit`).expect(200)).body.purchaseOrder.status).toBe("submitted");
    const approved = await manager.agent.post(`/api/purchase-orders/${id}/approve`).expect(200);
    expect(approved.body.purchaseOrder).toMatchObject({ status: "approved", approvedBy: "Test manager" });
    expect(await stockOf(db, bolt, east)).toBe(0);

    const received = await clerk.agent.post(`/api/purchase-orders/${id}/receive`).expect(200);
    expect(received.body.purchaseOrder.status).toBe("received");
    expect(await stockOf(db, bolt, east)).toBe(100);
    expect(await stockOf(db, nut, east)).toBe(50);

    const movements = await clerk.agent.get(`/api/movements?productId=${bolt}`).expect(200);
    expect(movements.body.items[0]).toMatchObject({ kind: "receipt", delta: 100, note: "Received PO-000001" });
    await clerk.agent.post(`/api/purchase-orders/${id}/receive`).expect(409); // never receive twice
    expect((await clerk.agent.get("/api/dashboard").expect(200)).body.openPurchaseOrders).toBe(0);
  });

  it("enforces the state machine", async () => {
    const { po, clerk, manager } = await setup();
    const id = po.id as string;
    await manager.agent.post(`/api/purchase-orders/${id}/approve`).expect(409); // draft cannot be approved
    await clerk.agent.post(`/api/purchase-orders/${id}/receive`).expect(409);
    await clerk.agent.post(`/api/purchase-orders/${id}/submit`).expect(200);
    await clerk.agent.post(`/api/purchase-orders/${id}/submit`).expect(409);
    await manager.agent.post(`/api/purchase-orders/${id}/cancel`).expect(200);
    await manager.agent.post(`/api/purchase-orders/${id}/approve`).expect(409);
    await manager.agent.post(`/api/purchase-orders/${id}/cancel`).expect(409);
  });

  it("keeps approving and cancelling for managers", async () => {
    const { po, clerk } = await setup();
    const id = po.id as string;
    await clerk.agent.post(`/api/purchase-orders/${id}/submit`).expect(200);
    expect((await clerk.agent.post(`/api/purchase-orders/${id}/approve`).expect(403)).body.error.code).toBe("FORBIDDEN");
    await clerk.agent.post(`/api/purchase-orders/${id}/cancel`).expect(403);
  });

  it("refuses to let you approve your own purchase order, even as admin", async () => {
    const { east, bolt, supplier } = await setup();
    const admin = await signIn(db, db.app(), "admin");
    const own = await admin.agent
      .post("/api/purchase-orders")
      .send({ supplierId: supplier.id, warehouseId: east, lines: [{ productId: bolt, quantity: 1, unitCostCents: 1 }] })
      .expect(201);
    const id = own.body.purchaseOrder.id as string;
    await admin.agent.post(`/api/purchase-orders/${id}/submit`).expect(200);
    const res = await admin.agent.post(`/api/purchase-orders/${id}/approve`).expect(403);
    expect(res.body.error.message).toMatch(/created/);
  });

  it("filters and paginates the list; unknown ids are 404", async () => {
    const { po, clerk, east, bolt, supplier } = await setup();
    await clerk.agent
      .post("/api/purchase-orders")
      .send({ supplierId: supplier.id, warehouseId: east, lines: [{ productId: bolt, quantity: 1, unitCostCents: 1 }] })
      .expect(201);
    await clerk.agent.post(`/api/purchase-orders/${po.id}/submit`).expect(200);

    const all = await clerk.agent.get("/api/purchase-orders").expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items.map((p: { number: string }) => p.number)).toEqual(["PO-000002", "PO-000001"]);
    const submitted = await clerk.agent.get("/api/purchase-orders?status=submitted").expect(200);
    expect(submitted.body).toMatchObject({ total: 1, items: [{ number: "PO-000001" }] });
    expect((await clerk.agent.get("/api/purchase-orders?limit=1&offset=1").expect(200)).body.items).toHaveLength(1);
    await clerk.agent.get("/api/purchase-orders/6f1c2a52-6f9f-4b7a-9d0a-3a3a8f1d9e01").expect(404);
    await clerk.agent.post("/api/purchase-orders/6f1c2a52-6f9f-4b7a-9d0a-3a3a8f1d9e01/submit").expect(404);
  });

  it("validates new orders: missing refs 404, inactive product 409, duplicate lines 400", async () => {
    const { clerk, east, bolt, nut, supplier } = await setup();
    const ghost = "6f1c2a52-6f9f-4b7a-9d0a-3a3a8f1d9e01";
    const line = { productId: bolt, quantity: 1, unitCostCents: 1 };
    await clerk.agent.post("/api/purchase-orders").send({ supplierId: ghost, warehouseId: east, lines: [line] }).expect(404);
    await clerk.agent.post("/api/purchase-orders").send({ supplierId: supplier.id, warehouseId: ghost, lines: [line] }).expect(404);
    await clerk.agent.post("/api/purchase-orders").send({ supplierId: supplier.id, warehouseId: east, lines: [{ ...line, productId: ghost }] }).expect(404);
    await clerk.agent.post("/api/purchase-orders").send({ supplierId: supplier.id, warehouseId: east, lines: [line, line] }).expect(400);
    await db.pool().query("UPDATE products SET active = false WHERE id = $1", [nut]);
    await clerk.agent
      .post("/api/purchase-orders")
      .send({ supplierId: supplier.id, warehouseId: east, lines: [{ ...line, productId: nut }] })
      .expect(409);
  });

  it("rejects duplicate supplier names", async () => {
    const { clerk } = await setup();
    await clerk.agent.post("/api/suppliers").send({ name: "Acme Fasteners (synthetic)", country: "US" }).expect(409);
    expect((await clerk.agent.get("/api/suppliers").expect(200)).body.items).toHaveLength(1);
  });
});
