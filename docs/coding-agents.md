# Coding Agents

Drive local AI coding agents (Claude Code, Codex, Antigravity, Hermes, OpenCode,
OpenClaw, or a custom command) from ChatGPT. ChatGPT acts as PM/reviewer; the
agent implements locally.

## Supported agents and their invocations

Each CLI has a different non-interactive entry point. LocalAnt ships defaults
that call each one correctly (the prompt is the trailing positional unless an
arg contains the `{{prompt}}` placeholder, in which case it is substituted):

| Agent (`agent` id) | Command | Execute | Resume (continue) |
|---|---|---|---|
| `claude-code` | `claude` | `claude -p <prompt>` | `claude -p -c <prompt>` |
| `antigravity-cli` | `agy` | `agy --print <prompt>` | `agy --print -c <prompt>` |
| `codex` | `codex` | `codex exec --skip-git-repo-check <prompt>` | `codex exec resume --last <prompt>` |
| `opencode` | `opencode` | `opencode run <prompt>` | `opencode run --continue <prompt>` |
| `hermes-agent` | `hermes` | `hermes chat -q <prompt>` | `hermes chat --continue -q <prompt>` |
| `openclaw` | `openclaw` | `openclaw agent --local -m <prompt>` | (same; one agent turn) |

> `--local`/`--skip-git-repo-check` and provider auth (`claude /login`,
> `codex login`, …) are per-agent prerequisites — LocalAnt invokes the CLI but
> does not log you in. If an agent returns "not logged in", authenticate that
> CLI in the same shell environment LocalAnt runs under.

### Turn-based dialogue with the agent

`coding_agent_continue_task` resumes the agent's **previous session** (via each
CLI's resume flag, configured as `resumeArgs`) on the same work branch. This
lets ChatGPT hold a back-and-forth: read the agent's output, send a follow-up,
and the agent continues with its prior context. (True interactive prompting —
the agent pausing mid-run to ask a question — is not supported; these CLIs run
one prompt per invocation and have no TTY.)

## Configure

```json
{
  "codingAgents": {
    "claude-code": {
      "enabled": true,
      "command": "claude",
      "args": [],
      "planArgs": ["-p"],
      "executeArgs": ["-p"],
      "defaultPermissionMode": "plan",
      "maxTurns": 10,
      "timeoutMs": 600000
    },
    "codex": { "enabled": true, "command": "codex", "args": [], "timeoutMs": 600000 }
  }
}
```

No project registration is required — point the agent at a working directory
(`cwd`, an absolute path). In `strict` mode the path must be inside an allowed
directory; in `open`/`yolo` mode any path outside the sensitive blocklist works.

## Workflow

```
1. coding_agent_plan(agent, cwd, task)            # PLAN ONLY, no file changes
2. ChatGPT reviews the plan; you approve
3. coding_agent_start_task(agent, cwd, task)      # risk 3 → approval required
     - warns if the working tree is dirty
     - creates a work branch (cla/<agent>-<ts>)
     - runs the agent to implement
4. coding_agent_get_logs / coding_agent_get_task
5. coding_agent_run_validation(cwd, command)      # runs the given validate/test command
6. coding_agent_get_diff(taskId)                  # review the changes
7. coding_agent_continue_task (resumes the session for a follow-up turn) /
     coding_agent_stop_task as needed
```

## Tools

`coding_agent_list`, `coding_agent_status`, `coding_agent_plan`,
`coding_agent_start_task`, `coding_agent_get_task`, `coding_agent_get_logs`,
`coding_agent_stop_task`, `coding_agent_continue_task`,
`coding_agent_get_result`, `coding_agent_get_diff`, `coding_agent_run_validation`.

## Safety

- No arbitrary command is passed — only the configured agent command + task prompt.
- `cwd` is the agent's working directory; in `strict` mode it must be inside an
  allowed directory (PathGuard), and the sensitive blocklist always applies.
- Execution is risk 3 (approval required) and fully audited.
- Plans never modify files.
