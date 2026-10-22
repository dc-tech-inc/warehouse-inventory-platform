import { createDb } from "@app/db";
import { expect, it } from "vitest";
import { seedDemoData, DEMO_ACCOUNTS } from "../../src/seed.js";
import { describeDb, PASSWORD, useTestDb } from "./helpers.js";
import request from "supertest";

describeDb("demo seed (Postgres)", () => {
  const db = useTestDb();

  it("fills an empty database consistently, only once, and the demo accounts can log in", async () => {
    const handle = createDb(process.env.DATABASE_URL as string);
    try {
      expect(await seedDemoData(handle.db, PASSWORD)).toBe(true);
      expect(await seedDemoData(handle.db, PASSWORD)).toBe(false);
    } finally {
      await handle.pool.end();
    }

    const { rows } = await db.pool().query(`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM warehouses) AS warehouses,
        (SELECT count(*)::int FROM products) AS products,
        (SELECT count(*)::int FROM purchase_orders) AS pos,
        (SELECT count(*)::int FROM employees) AS employees,
        (SELECT coalesce(sum(delta), 0)::int FROM stock_movements) AS movement_sum,
        (SELECT coalesce(sum(quantity), 0)::int FROM stock_levels) AS stock_sum`);
    expect(rows[0]).toMatchObject({ users: 3, warehouses: 3, products: 20, pos: 4, employees: 12 });
    // Stock on hand is exactly the sum of all movements, including the transfer still in transit (its stock already left the source).
    expect(rows[0].movement_sum).toBe(rows[0].stock_sum);

    const app = db.app();
    for (const account of DEMO_ACCOUNTS) {
      await request(app).post("/api/auth/login").send({ email: account.email, password: PASSWORD }).expect(200);
    }
    const dashboard = await request.agent(app);
    await dashboard.post("/api/auth/login").send({ email: "clerk@example.test", password: PASSWORD }).expect(200);
    const res = await dashboard.get("/api/dashboard").expect(200);
    expect(res.body.lowStock).toBeGreaterThan(0);
    expect(res.body.transfersInTransit).toBe(1);
  });
});
