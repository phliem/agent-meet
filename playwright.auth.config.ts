import { defineConfig } from '@playwright/test';

if (process.env.AUTH_E2E !== 'true') throw new Error('Run pnpm test:e2e:auth to start the isolated HTTPS test provider.');
const baseURL = process.env.APP_URL!;
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.auth.spec.ts',
  workers: 1,
  timeout: 120000,
  use: { baseURL, headless: true },
  webServer: { command: 'pnpm start', url: baseURL, reuseExistingServer: false, timeout: 120000 },
  reporter: 'list',
});
