import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const baseURL = process.env.APP_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.spec.ts",
  workers: 1,
  timeout: 120000,
  // CI exercises the production build and must never reuse a stray server.
  webServer: process.env.CI
    ? {
        command: "pnpm start",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120000,
      }
    : undefined,
  use: {
    baseURL,
    headless: true,
  },
  reporter: "list",
});
