import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolated builds (browser tests, demo recording) bake in a different API URL, so they use
  // their own output folder and never overwrite the normal build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Docker image runs Next's self-contained server (see frontend/Dockerfile).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Don't write an AGENTS.md for AI coding tools into the project when `next dev` runs.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
