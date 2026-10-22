import { createDb, runMigrations } from "@app/db";
import { seedDemoData } from "./seed.js";

// Container entrypoint step: apply migrations, then seed demo data if (and only if) the database is empty.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, pool } = createDb(url);
try {
  await runMigrations(db);
  console.log("Migrations applied.");
  if (process.env.SEED_DEMO_DATA !== "false") {
    await seedDemoData(db, process.env.SEED_PASSWORD ?? "demo-password-12345", console.log);
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
