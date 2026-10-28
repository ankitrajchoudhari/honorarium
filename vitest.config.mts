import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
    environment: "node",
    coverage: { include: ["src/engine/**", "src/ledger/**", "src/paypal/**", "src/ai/**", "src/lib/**"] },
  },
});
