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

## Official MCP registry

The submission manifest lives at [`server.json`](../server.json) in the repo
root (kept in sync with the published version). Publish with the official
[`mcp-publisher`](https://github.com/modelcontextprotocol/registry) tool:

```bash
# authenticate as the io.github.yuga-hashimoto namespace owner, then:
mcp-publisher validate   # check server.json against the current schema
mcp-publisher publish    # submit to the registry
```

Keep `server.json`'s `version` (and the package `version`) in lockstep with the
npm release — the release checklist in
[CONTRIBUTING.md → Releasing](../CONTRIBUTING.md#releasing-maintainers) should
bump both.

> LocalAnt is unusual for the registry: at runtime it is a **gateway** that
> speaks Streamable HTTP `/mcp` behind a tunnel, but it is *installed* as the npm
> package `localant` (CLI entrypoint `localant setup`). The `server.json` above
> describes the npm install path; the actual MCP endpoint is
> `https://<tunnel>/mcp`, created by `localant setup`. If a future registry
> schema gains first-class `remote`/`streamable-http` support, prefer
> documenting that endpoint shape instead of the stdio package hint.

## Articles / posts

- A Zenn/Qiita walkthrough ("ChatGPT から自分の PC を安全に操作する") is a strong
  fit given the built-in `zenn_*` / `qiita_*` publishing tools — LocalAnt can
  publish its own announcement. Track this in [ROADMAP.md](../ROADMAP.md).
