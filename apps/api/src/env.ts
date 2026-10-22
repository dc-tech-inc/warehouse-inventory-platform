import * as z from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.url().default("http://localhost:5173"),
  /** Directory with the built web app; when set, the API serves it. */
  WEB_DIST: z.string().min(1).optional(),
  /** Defaults to true in production. Set to false only for plain-HTTP local runs (docker compose). */
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  /** Requests per 15 minutes per IP (global / login). Defaults 300 / 10; raise for automated browser tests. */
  RATE_LIMIT_GLOBAL: z.coerce.number().int().min(1).optional(),
  RATE_LIMIT_LOGIN: z.coerce.number().int().min(1).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses the environment once at startup and fails fast. Error messages name the variable, never its value. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment: ${problems.join("; ")}`);
  }
  return result.data;
}
