import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolated builds (browser tests, demo recording) bake in a different API URL, so they use
  // their own output folder and never overwrite the normal build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
