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
    // Server __tests__ files are standalone tsx scripts (run via npm scripts),
    // not vitest suites — only client tests are vitest-based today.
    include: ["client/src/**/__tests__/**/*.test.{ts,tsx}"],
  },
});
