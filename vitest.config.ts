import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Resolve the workspace packages to their TypeScript source rather than the
  // compiled `dist/` output. This lets v8 coverage instrument the real `src`
  // files (importing the built JS reported 0% because the source map filter
  // never matched the executed dist files).
  resolve: {
    alias: {
      "@localant/shared": pkg("shared"),
      "@localant/gateway": pkg("gateway"),
      "@localant/mcp": pkg("mcp"),
      "@localant/dashboard": pkg("dashboard"),
      "@localant/cli": pkg("cli"),
      "@localant/skill-sdk": pkg("skill-sdk"),
    },
  },
  test: {
    include: ["packages/**/tests/**/*.test.ts", "examples/skills/**/tests/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
 testTimeout: 300_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/dashboard/**", "**/skill-runner.ts", "**/*.d.ts"],
    },
  },
});
