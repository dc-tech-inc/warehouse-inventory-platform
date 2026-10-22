import { defineConfig, devices } from "@playwright/test";
import { PORT } from "./constants";

export default defineConfig({
  testDir: "./tests",
  // Tests share one seeded database and sign in as different roles, so they run one after another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
  },
  projects: [
    {
      name: "chromium",
      // On a developer machine without a downloaded Chromium, set PW_CHANNEL=msedge (or chrome).
      use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL },
    },
  ],
  webServer: {
    // The built API serves the built web app on one origin, exactly as the Docker image does.
    command: "node --env-file-if-exists=../.env ../apps/api/dist/server.js",
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: "production",
      COOKIE_SECURE: "false",
      WEB_DIST: "../apps/web/dist",
      WEB_ORIGIN: `http://localhost:${PORT}`,
      LOG_LEVEL: "warn",
      // Every test signs in again, which would trip the default login limit of 10 per 15 minutes.
      RATE_LIMIT_LOGIN: "1000",
      RATE_LIMIT_GLOBAL: "10000",
      DATABASE_URL: process.env.DATABASE_URL ?? "",
    },
  },
});
