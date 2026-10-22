import type { Database } from "@app/db";
import cors from "cors";
import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "./logger.js";
import { AppError, errorHandler } from "./middleware/error-handler.js";
import { buildOpenApiDocument } from "./openapi.js";
import { authRouter, usersRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { inventoryRouter } from "./routes/inventory.js";
import { peopleRouter } from "./routes/people.js";
import { purchasingRouter } from "./routes/purchasing.js";
import { createAuthService } from "./services/auth-service.js";
import { createInventoryService } from "./services/inventory-service.js";
import { createPeopleService } from "./services/people-service.js";
import { createPurchasingService } from "./services/purchasing-service.js";

export interface AppDeps {
  db: Database;
  logger: Logger;
  webOrigin: string;
  /** Adds the Secure flag to the session cookie. True in production (HTTPS only). */
  secureCookies: boolean;
  /** Requests per 15-minute window per IP. */
  rateLimits?: { global?: number; credentials?: number };
  /** Directory holding the built web app (apps/web/dist). When set, the API serves it too, on one origin. */
  webDist?: string;
}

const WINDOW_MS = 15 * 60 * 1000;

function limiter(limit: number) {
  // ponytail: in-memory store, counts are per process; use a shared store (e.g. Redis) when running more than one instance.
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many requests, try again later")),
  });
}

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp({ db, logger, webOrigin, secureCookies, rateLimits = {}, webDist }: AppDeps): Express {
  const app = express();
  const auth = createAuthService(db);
  const openapi = buildOpenApiDocument();

  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use(express.json({ limit: "100kb" }));

  // Probes and docs sit before the global limiter so monitoring is never throttled.
  app.use(healthRouter(db));
  app.get("/openapi.json", (_req, res) => {
    res.json(openapi);
  });

  app.use(limiter(rateLimits.global ?? 300));
  app.use(
    "/api/auth",
    authRouter({ auth, secureCookies, credentialLimiter: limiter(rateLimits.credentials ?? 10) }),
  );
  app.use("/api/users", usersRouter({ auth }));
  app.use("/api", inventoryRouter({ auth, inventory: createInventoryService(db) }));
  app.use("/api", purchasingRouter({ auth, purchasing: createPurchasingService(db) }));
  app.use("/api", peopleRouter({ auth, people: createPeopleService(db) }));

  if (webDist && existsSync(join(webDist, "index.html"))) {
    app.use(express.static(webDist));
    // Single-page app: any other GET outside /api falls back to index.html.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(join(webDist, "index.html"));
    });
  }

  app.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND", "Route not found")));
  app.use(errorHandler(logger));
  return app;
}
