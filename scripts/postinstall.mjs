#!/usr/bin/env node
// postinstall — makes @localant/* internal packages resolvable at runtime.
//
// The published npm tarball flattens the monorepo: each package's dist dir and
// package.json ship at their original `packages/<pkg>/` path, but there is no
// `node_modules/@localant/` entry, so Node can't resolve `@localant/shared`
// (and friends) when the CLI bundle imports them.
//
// This script links `node_modules/@localant/<pkg>` to the real `packages/<pkg>`
// directory, reusing each package's own package.json (whose `main`/`types`
// already point at `dist/`). It is a no-op in the dev workspace, where pnpm has
// already created those links — writing through them would corrupt the real
// source package.json files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const LOCALANT_PACKAGES = ["shared", "skill-sdk", "gateway", "mcp", "dashboard", "cli"];

for (const pkg of LOCALANT_PACKAGES) {
  const linkPath = path.join(root, "node_modules", "@localant", pkg);
  const target = path.join(root, "packages", pkg);

  // Already linked (pnpm/npm workspace) — never write through it.
  if (fs.existsSync(linkPath)) continue;
  // Source package not present (unexpected layout) — skip rather than guess.
  if (!fs.existsSync(target)) continue;

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  const relTarget = path.relative(path.dirname(linkPath), target);
  try {
    fs.symlinkSync(relTarget, linkPath, "junction");
  } catch {
    // Symlinks unavailable (e.g. restricted Windows): fall back to a shim
    // package.json that re-points main/types at the real dist via absolute path.
    const real = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
    fs.mkdirSync(linkPath, { recursive: true });
    fs.writeFileSync(
      path.join(linkPath, "package.json"),
      JSON.stringify(
        {
          name: `@localant/${pkg}`,
          version: real.version ?? "1.0.0",
          type: "module",
          main: path.join(target, "dist/index.js"),
          types: path.join(target, "dist/index.d.ts"),
        },
        null,
        2,
      ),
    );
  }
}
