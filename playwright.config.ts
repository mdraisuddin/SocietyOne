import { defineConfig, devices } from '@playwright/test';

const PORT = 4100;
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://societyone:societyone@localhost:5432/societyone_e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Fresh database + demo data, built web app, API serving both on one origin.
    command: `npm run build --workspace web && cd server && DATABASE_URL=${DB} npx tsx src/db/migrate.ts --reset && DATABASE_URL=${DB} npx tsx src/db/seed.ts && DATABASE_URL=${DB} PORT=${PORT} DEMO_MODE=true npx tsx src/index.ts`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
