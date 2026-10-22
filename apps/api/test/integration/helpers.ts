import { createDb } from "@app/db";
import type { Role } from "@app/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { createApp, type AppDeps } from "../../src/app.js";
import { createLogger } from "../../src/logger.js";
import { createAuthService } from "../../src/services/auth-service.js";

const DATABASE_URL = process.env.DATABASE_URL;

/** describe() that is skipped (with the reason printed by global-setup) when no database is configured. */
export const describeDb = describe.skipIf(!DATABASE_URL);

export const PASSWORD = "correct horse battery staple";

const TABLES = [
  "reward_ledger",
  "reward_catalog",
  "employees",
  "stock_movements",
  "purchase_order_lines",
  "purchase_orders",
  "suppliers",
  "transfers",
  "stock_levels",
  "products",
  "warehouses",
  "sessions",
  "users",
];

/** Call inside describeDb: opens a pool, truncates all tables before each test, closes the pool after. */
export function useTestDb() {
  let handle: ReturnType<typeof createDb> | undefined;
  const get = () => {
    if (!handle) throw new Error("useTestDb() handle used outside a test");
    return handle;
  };

  beforeAll(() => {
    handle = createDb(DATABASE_URL as string);
  });
  beforeEach(async () => {
    await get().pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  });
  afterAll(async () => {
    await handle?.pool.end();
  });

  return {
    pool: () => get().pool,
    auth: () => createAuthService(get().db),
    app: (overrides: Partial<AppDeps> = {}) =>
      createApp({
        db: get().db,
        logger: createLogger("silent"),
        webOrigin: "http://localhost:5173",
        secureCookies: false,
        ...overrides,
      }),
  };
}

type App = Parameters<typeof request.agent>[0];

/** Creates an account with the given role (as the seed script or an admin would) and returns a logged-in agent. */
export async function signIn(
  testDb: ReturnType<typeof useTestDb>,
  app: App,
  role: Role,
  email = `${role}@example.test`,
) {
  const user = await testDb.auth().createUser({ email, name: `Test ${role}`, password: PASSWORD, role });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  return { agent, user };
}

/** Two warehouses and two products with a reorder point, inserted directly. */
export async function seedCatalog(testDb: ReturnType<typeof useTestDb>) {
  const pool = testDb.pool();
  const wh = async (code: string, city: string) =>
    (await pool.query("INSERT INTO warehouses (code, name, city) VALUES ($1, $2, $3) RETURNING id", [code, `${code} depot`, city]))
      .rows[0].id as string;
  const product = async (sku: string, reorder: number) =>
    (
      await pool.query(
        "INSERT INTO products (sku, name, reorder_point, unit_cost_cents) VALUES ($1, $2, $3, 250) RETURNING id",
        [sku, `Item ${sku}`, reorder],
      )
    ).rows[0].id as string;
  const [east, west, bolt, nut] = [await wh("EAST", "Raleigh"), await wh("WEST", "Reno"), await product("BOLT-M8", 20), await product("NUT-M8", 0)];
  return { east, west, bolt, nut };
}

export async function stockOf(testDb: ReturnType<typeof useTestDb>, productId: string, warehouseId: string): Promise<number> {
  const { rows } = await testDb
    .pool()
    .query("SELECT quantity FROM stock_levels WHERE product_id = $1 AND warehouse_id = $2", [productId, warehouseId]);
  return rows[0]?.quantity ?? 0;
}
