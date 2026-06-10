# Skills

Skills extend the gateway with new tools. They are disabled by default and
declare their permissions and risk level up front.

## Layout

```
skills/<name>/
  skill.json          # manifest
  README.md  LICENSE  CHANGELOG.md
  src/index.ts        # export default defineSkill({...})
  tests/index.test.ts
  examples/example.json
```

## Manifest (`skill.json`)

```json
{
  "name": "example-skill",
  "version": "0.1.0",
  "description": "Example local skill",
  "entry": "src/index.ts",
  "riskLevel": 1,
  "permissions": {
    "filesystem": { "mode": "read", "allowedDirectories": [] },
    "shell": { "mode": "none", "allowedCommands": [] },
    "network": { "mode": "none", "allowedHosts": [] },
    "secrets": [],
    "browser": "none", "adb": "none", "git": "read", "agent": "none"
  },
  "tools": [
    { "name": "example_hello", "description": "Say hello", "riskLevel": 0,
      "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] } }
  ]
}
```

Permission modes:

```
filesystem: none | read | write
shell:      none | allowed | custom
network:    none | allowlist | all
secrets:    [names]
browser:    none | read | control
adb:        none | read | control
git:        none | read | write
agent:      none | plan | execute
```

## Authoring with the SDK

```ts
import { defineSkill, z } from "@chatgpt-local-app/skill-sdk";

export default defineSkill({
  name: "hello-world",
  tools: {
    hello: {
      description: "Say hello",
      riskLevel: 0,
      inputSchema: z.object({ name: z.string() }),
      handler: async ({ name }, ctx) => {
        // ctx.getSecret(name) for declared secrets; ctx.workspaceDir for scratch
        return { content: `Hello ${name}` };
      },
    },
  },
});
```

## Lifecycle

```
create → validate → enable → run → disable → update → publish → uninstall
```

Tools: `skill_list`, `skill_info`, `skill_validate`, `skill_enable`,
`skill_disable`, `skill_run`, `skill_create`, `skill_generate_from_prompt`,
`skill_install_from_git`, `skill_publish_to_git`, `skill_uninstall`,
`skill_permissions`, `skill_update_permissions`, `skill_search_registry`.

CLI: `chatgpt-local-app skills <list|info|enable|disable|validate|install|publish>`.

## Generating a skill from ChatGPT

`skill_generate_from_prompt` scaffolds a complete skill from a name +
description + requirements, infers permissions and risk, saves it **disabled**,
and validates it. Review it in the dashboard, then `skill_enable` (approval
required).

## Execution model

Skills run in an isolated Node subprocess. Only declared secrets are injected;
the vault is never exposed. Input is validated with the tool's Zod schema.

## Registry

`skill_search_registry` queries configured `registry.json` sources
(`config.skillRegistry.sources`). Install with `skill_install_from_git <url>`
(saved disabled). Publish with `skill_publish_to_git`. See
[skill-registry.md](skill-registry.md).
