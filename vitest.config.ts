import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/tests/**/*.test.ts", "examples/skills/**/tests/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/dashboard/**", "**/skill-runner.ts"],
    },
  },
});
