# Coding Agents

Drive local AI coding agents (Claude Code, Codex, or a custom command) from
ChatGPT. ChatGPT acts as PM/reviewer; the agent implements locally.

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
7. coding_agent_continue_task / coding_agent_stop_task as needed
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
