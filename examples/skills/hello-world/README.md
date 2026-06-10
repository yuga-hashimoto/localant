# hello-world

A minimal example local skill for `LocalAnt`.

## Permissions
None. This skill only echoes a greeting — no filesystem, shell, network, or secret access.

- risk level: 0 (read-only)

## Usage
Once enabled, ask ChatGPT:

> Use the hello-world skill to greet "Yuga".

ChatGPT calls `skill_run` with `{ name: "hello-world", tool: "hello", input: { name: "Yuga" } }`.

## Develop
```bash
pnpm test   # runs tests/index.test.ts
```
