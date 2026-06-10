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

Register the project first: `localant projects add ~/Projects/my-app`
(or `project_register`). Set validate/test commands with
`project_set_validate_command` / `project_set_test_command`.

## Workflow

```
1. coding_agent_plan(agent, projectId, task)      # PLAN ONLY, no file changes
2. ChatGPT reviews the plan; you approve
3. coding_agent_start_task(agent, projectId, task) # risk 3 → approval required
     - warns if the working tree is dirty
     - creates a work branch (cla/<agent>-<ts>)
     - runs the agent to implement
4. coding_agent_get_logs / coding_agent_get_task
5. coding_agent_run_validation(projectId)          # runs validate/test command
6. coding_agent_get_diff(taskId)                   # review the changes
7. coding_agent_continue_task / coding_agent_stop_task as needed
```

## Tools

`coding_agent_list`, `coding_agent_status`, `coding_agent_plan`,
`coding_agent_start_task`, `coding_agent_get_task`, `coding_agent_get_logs`,
`coding_agent_stop_task`, `coding_agent_continue_task`,
`coding_agent_get_result`, `coding_agent_get_diff`, `coding_agent_run_validation`.

## Safety

- No arbitrary command is passed — only the configured agent command + task prompt.
- `projectId` must be a registered project; work stays inside its directory.
- Execution is risk 3 (approval required) and fully audited.
- Plans never modify files.
