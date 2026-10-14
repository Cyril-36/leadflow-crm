import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolated builds (browser tests, demo recording) bake in a different API URL, so they use
  // their own output folder and never overwrite the normal build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Docker image runs Next's self-contained server (see frontend/Dockerfile).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Keep `next dev` from adding an AGENTS.md file to the project.
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
