import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the real FastAPI backend and a production build of the app.
// Locally they reuse servers already running on :8000 and :3000; otherwise they start both,
// with the API on a throwaway e2e.db seeded fresh.
const backendEnv = "DATABASE_URL=sqlite:///./e2e.db";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `cd ../backend && ${backendEnv} uv run python -m app.seed --reset && ${backendEnv} uv run uvicorn app.main:create_app --factory --port 8000`,
      url: "http://localhost:8000/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "npm run build && npm run start -- -p 3000",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
