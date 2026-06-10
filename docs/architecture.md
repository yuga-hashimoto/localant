# Architecture

`LocalAnt` is a pnpm + TypeScript monorepo built with project
references. The runtime is ESM on Node.js.

## Packages

```
packages/
  shared/      config schema, OS paths, risk model, redaction, types, logger
  skill-sdk/   defineSkill() + Zod re-export for skill authors
  gateway/     the engine (no network):
                 stores/    config, secret-vault, audit-log, approval-store
                 security/  path-guard, command-guard
                 managers/  fs, git, shell, project-registry, skill-runtime,
                            coding-agent, tunnel
                 tools/     built-in tool families registered onto a registry
                 gateway.ts execution pipeline (validate→approve→run→redact→audit)
  mcp/         Streamable HTTP /mcp (auth), dashboard API, MCP server builder
  dashboard/   self-contained HTML dashboard (served by the gateway)
  cli/         setup/start/doctor/... commands + runtime bootstrap
examples/skills/hello-world
```

## Request flow

```
ChatGPT → POST /mcp (auth: ?key= or Bearer)
        → MCP server (one per request, stateless)
        → gateway.executeTool(name, input, ctx)
            1. Zod-validate input
            2. risk → approval requirement
               - session grant? proceed
               - approved once? consume, proceed
               - else create pending approval, return approvalRequired
            3. run handler (manager)
            4. deep-redact output (secret values)
            5. append audit entry
        → JSON result wrapped as MCP text content
```

## Security engines

- **PathGuard** — normalizes, blocklist-checks, allowlist-checks, then realpaths
  the deepest existing ancestor and re-checks (defeats symlink escapes).
- **CommandGuard** — tokenizes across shell operators, rejects
  chaining/redirection/substitution, enforces allowlist prefixes and a hard
  blocklist (also applied to approved commands).
- **SecretVault** — AES-256-GCM at rest; names-only listing; values feed
  redaction.
- **ApprovalStore** — file-backed queue with single/double approvals and
  session grants; once-approvals are consumed.

## Skill execution

Skills run in an isolated Node subprocess (`skill-runner`). The gateway resolves
only the secrets a skill declares and passes them on stdin; the subprocess
imports the skill entry (Node strips TS types on 22+), validates input with the
tool's Zod schema, and returns a single JSON result line.

## Extensibility

- New built-in tools: add a `tools/*.ts` register function and include it in
  `tools/index.ts`.
- New skills: scaffold with `skill_create` / `skill_generate_from_prompt` or by
  hand following the `skill.json` schema.
- Downstream MCP servers / adapters: register via `mcp_server_register` and the
  adapter tools.
