# Distribution & discovery

How LocalAnt is published and how to get it in front of users. This is a
maintainer reference; ordinary users only need the [README](../README.md).

## npm

The package is published as [`localant`](https://www.npmjs.com/package/localant).
Releases are **tag-driven** with npm provenance — see
[CONTRIBUTING.md → Releasing](../CONTRIBUTING.md#releasing-maintainers).

## awesome-mcp-servers

A ready-to-submit entry for
[punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)
(open a PR adding this line under an appropriate category, e.g. *Local /
System*):

```markdown
- [LocalAnt](https://github.com/yuga-hashimoto/localant) 🟫 🏠 — Use ChatGPT as the brain and your local PC as the hands: a permissioned local MCP gateway with default-deny security, local approvals, and full audit logging.
```

Legend used by that list: 🟫 = TypeScript, 🏠 = local service.

## Official MCP registry (draft — validate before publishing)

LocalAnt is unusual for the registry: it is a **gateway** that speaks Streamable
HTTP `/mcp` behind a tunnel rather than a plain stdio server, and its npm `bin`
is a CLI (`localant setup`) rather than a server entrypoint. Before submitting,
validate the manifest below with the official
[`mcp-publisher`](https://github.com/modelcontextprotocol/registry) tool and
adjust the `transport`/`packages` shape to match the current schema.

```jsonc
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.json",
  "name": "io.github.yuga-hashimoto/localant",
  "description": "Permissioned local MCP gateway for ChatGPT: run approved commands, manage files, drive coding agents, all behind default-deny security with local approval and audit logging.",
  "repository": {
    "url": "https://github.com/yuga-hashimoto/localant",
    "source": "github"
  },
  "version": "1.0.2",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "localant",
      "version": "1.0.2",
      "runtimeHint": "npx",
      "transport": { "type": "stdio" }
    }
  ]
}
```

> NOTE: the `transport` above is a placeholder. LocalAnt's real endpoint is
> `https://<tunnel>/mcp` (Streamable HTTP) created by `localant setup`. If the
> registry version in use supports a `remote`/`streamable-http` transport,
> prefer documenting that flow instead of a stdio package.

## Articles / posts

- A Zenn/Qiita walkthrough ("ChatGPT から自分の PC を安全に操作する") is a strong
  fit given the built-in `zenn_*` / `qiita_*` publishing tools — LocalAnt can
  publish its own announcement. Track this in [ROADMAP.md](../ROADMAP.md).
