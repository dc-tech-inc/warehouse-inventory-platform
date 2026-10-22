import { createDb, runMigrations } from "@app/db";
import { seedDemoData } from "../apps/api/src/seed.js";
import { DEMO_PASSWORD } from "./constants.js";

// Gives every e2e run the same starting point: empty schema, committed migrations, synthetic demo seed.
// Refuses any database whose name does not contain "e2e" or "test", like the API test setup does.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const name = new URL(url).pathname.slice(1);
if (!/e2e|test/.test(name)) throw new Error(`Refusing to reset database "${name}": its name must contain "e2e" or "test".`);

const { db, pool } = createDb(url);
try {
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await runMigrations(db);
  await seedDemoData(db, DEMO_PASSWORD, console.log);
} finally {
  await pool.end();
}
