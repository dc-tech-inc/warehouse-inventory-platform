import { createDb } from "@app/db";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const { db, pool } = createDb(env.DATABASE_URL);

const app = createApp({
  db,
  logger,
  webOrigin: env.WEB_ORIGIN,
  secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : env.NODE_ENV === "production",
  webDist: env.WEB_DIST,
  rateLimits: { global: env.RATE_LIMIT_GLOBAL, credentials: env.RATE_LIMIT_LOGIN },
});

const server = app.listen(env.PORT, (err) => {
  if (err) {
    logger.fatal({ err }, "failed to start");
    process.exit(1);
  }
  logger.info({ port: env.PORT }, "API listening");
});

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, "shutting down");
  // Stop accepting connections, let in-flight requests finish, then close the pool.
  server.close((err) => {
    pool.end().finally(() => process.exit(err ? 1 : 0));
  });
  setTimeout(() => {
    logger.error("shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
