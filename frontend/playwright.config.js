import { randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'
import { buildE2eEnvironment } from './e2e/safety.js'

// Runs the safety guard before any server starts, so `npx playwright test`
// alone is guarded too. Throws unless the target is local budget_planner_test_e2e.
const { env: guardedEnv } = buildE2eEnvironment(process.env)

const apiUrl = 'http://localhost:5298'
const webUrl = 'http://localhost:5173'
const isCi = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  outputDir: 'test-results',
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCi ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: webUrl,
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Dedicated E2E environment: a developer's gitignored appsettings.Development.json cannot leak in.
      command: 'dotnet run --project ../backend --no-launch-profile --urls http://localhost:5298',
      url: `${apiUrl}/health/ready`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        ...guardedEnv,
        ASPNETCORE_ENVIRONMENT: 'E2E',
        Jwt__Key: randomBytes(48).toString('hex'),
        Frontend__BaseUrl: webUrl,
        EmailSettings__FromName: 'unused-e2e',
        EmailSettings__FromEmail: 'e2e@example.invalid',
        GoogleEmail__ClientId: 'unused-e2e',
        GoogleEmail__ClientSecret: 'unused-e2e',
        GoogleEmail__RefreshToken: 'unused-e2e',
      },
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: webUrl,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { ...guardedEnv, VITE_API_BASE_URL: apiUrl },
    },
  ],
})
