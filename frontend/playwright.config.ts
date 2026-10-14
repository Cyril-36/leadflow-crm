import { defineConfig, devices } from "@playwright/test";

// Browser tests run in their own environment and never touch the normal app or its database:
//   API  http://localhost:8100  (backend/e2e.db, recreated and seeded on every run)
//   Web  http://localhost:3100  (production build in .next-e2e, pointed at the test API)
// Both servers are always started fresh, even if something else is running locally.
const API_PORT = 8100;
const WEB_PORT = 3100;
export const E2E_API_URL = `http://localhost:${API_PORT}/api`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

const backendEnv = `DATABASE_URL=sqlite:///./e2e.db CORS_ORIGINS=${WEB_URL}`;
const frontendEnv = `NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_API_URL=${E2E_API_URL}`;

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Only ever resets e2e.db; the normal backend/leadflow.db is never opened.
      command: `cd ../backend && rm -f e2e.db e2e.db-wal e2e.db-shm && ${backendEnv} uv run python -m app.seed && ${backendEnv} uv run uvicorn app.main:create_app --factory --port ${API_PORT}`,
      url: `${E2E_API_URL}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `${frontendEnv} npm run build && ${frontendEnv} npx next start -p ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
