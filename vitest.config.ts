import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "client/src/**/__tests__/**/*.test.{ts,tsx}",
      "server/**/__tests__/**/*.test.ts",
    ],
    // operational-queue/parity.test.ts is a live-DB script (needs DATABASE_URL
    // + PARITY_TEST_USER_ID); it stays a standalone tsx script, not a vitest suite.
    exclude: [
      "**/node_modules/**",
      "server/modules/operational-queue/__tests__/parity.test.ts",
    ],
  },
});
