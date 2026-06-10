# Contributing to LocalAnt

Thanks for your interest in improving LocalAnt! This project lets ChatGPT act on
your local machine through a permissioned MCP gateway, so **security and
correctness matter more than speed**. Please read this guide before opening a PR.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold it.

## Development setup

Requirements: **pnpm 11** (`corepack enable` will provide it), which itself needs
**Node ≥ 22.13** to run. The published package runs on **Node ≥ 20.10** at
runtime (end users install the prebuilt `dist` with `npm`), but building from
source requires Node 22 because of the pnpm toolchain.

```bash
git clone https://github.com/yuga-hashimoto/localant
cd localant
pnpm install
pnpm build        # tsc -b across the workspace
pnpm test         # security + unit + integration tests
pnpm lint
```

Run the gateway from source:

```bash
node packages/cli/dist/bin.js setup
```

### Useful scripts

| Command | What it does |
|---------|--------------|
| `pnpm build` | Type-check + compile all packages |
| `pnpm dev` | Watch-mode build |
| `pnpm test` | Run the full vitest suite |
| `pnpm test:watch` | Watch-mode tests |
| `pnpm test:coverage` | Tests with a v8 coverage report |
| `pnpm lint` | ESLint |
| `pnpm validate` | `build` + `test` (run this before pushing) |

## Repository layout

A pnpm + TypeScript monorepo with project references:

| Package | Responsibility |
|---------|----------------|
| `shared` | config schema, paths, risk model, redaction, version, types, logger |
| `gateway` | stores, security guards, managers, tool registry, execution pipeline |
| `mcp` | Streamable HTTP `/mcp`, auth, dashboard API |
| `dashboard` | self-contained local dashboard |
| `cli` | `setup`/`start`/`doctor`/… commands |
| `skill-sdk` | `defineSkill` for external skill authors |

See [docs/architecture.md](docs/architecture.md).

## Coding standards

- **Small, focused files** (≤ ~400 lines), high cohesion.
- **Immutability**: return new objects rather than mutating inputs.
- Explicit types on exported/public APIs; avoid `any` (use `unknown` + narrowing).
- Validate all external input with Zod at boundaries.
- No `console.log` in library code — use the shared `createLogger`.
- Handle errors explicitly; never silently swallow.

## Security-sensitive changes

Anything touching `security/`, `stores/secret-vault.ts`, the approval pipeline,
`mcp/http-server.ts`, or `redaction.ts` **must** include tests and a note in the
PR describing the threat it addresses. When in doubt, open an issue first.

## Tests

- Write tests first where practical (TDD). Cover the happy path **and** the
  rejection/denied path for any guard.
- Tests live in `tests/` (cross-cutting) or each package's `tests/`.
- Keep tests OS-agnostic; guard platform-specific behavior with
  `it.skipIf(process.platform === "win32")` etc. CI runs Linux, macOS and Windows
  on Node 20 and 22.

## Commit & PR conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`,
  `perf:`, `ci:`.
- One logical change per PR; keep diffs reviewable.
- Fill in the PR template, including a test plan.
- Ensure `pnpm validate` and `pnpm lint` pass locally.

## Releasing (maintainers)

Releases are **tag-driven** — pushing to `main` does **not** publish.

1. Bump the version in the root `package.json` **and**
   `packages/shared/src/version.ts` (keep them in sync).
2. Update `CHANGELOG.md`.
3. Commit, then tag: `git tag v1.2.3 && git push --tags`.
4. The `release` workflow publishes to npm with **provenance** and creates a
   GitHub Release.

## Reporting vulnerabilities

Do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).
