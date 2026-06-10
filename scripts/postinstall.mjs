#!/usr/bin/env node
/**
 * postinstall — creates Node module resolution shims for @localant/* packages.
 *
 * The published npm tarball flattens the monorepo: packages/*/dist/ are at
 * their original paths, but `@localant/shared` etc. are not in node_modules/.
 * Node would fail to resolve them since there's no node_modules/@localant/*.
 *
 * This script creates minimal package.json files at
 *   node_modules/@localant/<pkg>/package.json
 * whose "main" points back to the real dist entry, making Node.js resolution
 * work without any symlinks, install-time tooling, or bundling.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const LOCALANT_PACKAGES = ["shared", "skill-sdk", "gateway", "mcp", "dashboard", "cli"];

for (const pkg of LOCALANT_PACKAGES) {
  const shimDir = path.join(root, "node_modules", "@localant", pkg);
  const realPkgJson = path.join(root, "packages", pkg, "package.json");

  if (!fs.existsSync(realPkgJson)) continue;

  const real = JSON.parse(fs.readFileSync(realPkgJson, "utf8"));
  const shimPkgJson = {
    name: `@localant/${pkg}`,
    version: real.version ?? "1.0.0",
    type: "module",
    main: `../../packages/${pkg}/dist/index.js`,
    types: `../../packages/${pkg}/dist/index.d.ts`,
  };

  fs.mkdirSync(shimDir, { recursive: true });
  fs.writeFileSync(path.join(shimDir, "package.json"), JSON.stringify(shimPkgJson, null, 2));
}
