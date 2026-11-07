import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.spec.ts",
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: process.env.APP_URL || "http://localhost:3000",
    headless: true,
  },
  reporter: "list",
});
