import { createDb } from "@app/db";
import { seedDemoData } from "./seed.js";

// Safe to run on every start: it does nothing when the database already has data.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
// Documented demo password for the synthetic accounts; set SEED_PASSWORD for anything reachable from a network.
const password = process.env.SEED_PASSWORD ?? "demo-password-12345";
const { db, pool } = createDb(url);
try {
  await seedDemoData(db, password, console.log);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
