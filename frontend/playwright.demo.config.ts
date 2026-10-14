import { defineConfig } from "@playwright/test";

// Records the demo walkthrough and README screenshots in an isolated environment:
//   API  http://localhost:8200  (backend/demo.db, freshly seeded)
//   Web  http://localhost:3200  (production build in .next-demo)
// DEMO_TZ sets the browser's and the seed's timezone so the recording can show a business day
// whatever the local time is (default: the machine's own zone).
const API_PORT = 8200;
const WEB_PORT = 3200;
const API_URL = `http://localhost:${API_PORT}/api`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const tz = process.env.DEMO_TZ;
const tzEnv = tz ? `TZ=${tz} ` : "";

const backendEnv = `DATABASE_URL=sqlite:///./demo.db CORS_ORIGINS=${WEB_URL}`;
const frontendEnv = `NEXT_DIST_DIR=.next-demo NEXT_PUBLIC_API_URL=${API_URL}`;

export default defineConfig({
  testDir: "demo",
  workers: 1,
  timeout: 240_000,
  reporter: "list",
  use: {
    baseURL: WEB_URL,
    viewport: { width: 1280, height: 800 },
    timezoneId: tz,
    locale: "en-US",
  },
  webServer: [
    {
      command: `cd ../backend && rm -f demo.db demo.db-wal demo.db-shm && ${tzEnv}${backendEnv} uv run python -m app.seed && ${backendEnv} uv run uvicorn app.main:create_app --factory --port ${API_PORT}`,
      url: `${API_URL}/health`,
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
