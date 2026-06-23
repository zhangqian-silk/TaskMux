# TaskMux

TaskMux is a local task board for native agent CLI sessions backed by tmux.

It lets a user create local tasks, assign roles, bind each role to a native agent CLI such as Codex CLI or Claude Code, and switch between role sessions without interrupting the underlying process.

## Package

```sh
npm install -g @silk/taskmux
```

Command entrypoints:

```sh
taskmux
tb
```

## Core Model

- TaskMux stores task data in a user-level data directory.
- One task maps to one tmux session.
- One role maps to one tmux window.
- Each role window runs one native agent CLI process.
- Leaving a role means detaching from tmux, not exiting the agent CLI.
- `task status` checks tmux window state and writes detected role status back to storage.
- Codex CLI and Claude Code keep their native terminal behavior.

## Example

```sh
tb task create "Refactor login page"
tb task list
tb task show task-1
tb task open task-1
tb task shell task-1
tb task assign task-1 rd --agent codex --workspace ~/projects/app
tb task assign task-1 reviewer --agent claude --workspace ~/projects/app
tb task roles task-1
tb task comment task-1 "Keep old session compatibility."
tb task comments task-1
tb task enter task-1 rd
tb task tail task-1 rd
tb task detail task-1 rd
tb task status task-1 rd
tb task transcript task-1 rd
tb task detach task-1 rd
tb task stop task-1 rd
tb task kill task-1 rd
tb doctor
```

Inside the task shell:

```text
tb task-42> roles
tb task-42> comment "Keep old session compatibility."
tb task-42> enter rd
```

`enter rd` attaches to the tmux window for the `rd` role. Detaching returns to the task shell while the role process continues running.

## Task Storage

TaskMux stores task data in the user-level data directory:

```text
~/.taskmux
```

Tests, automation, and isolated runs can override this location:

```sh
TASKMUX_HOME=/tmp/taskmux-demo tb task create "Try TaskMux"
```

The current task command surface is:

```sh
tb task create "Refactor login page"
tb task list
tb task show task-1
tb task open task-1
tb task shell task-1
tb task assign task-1 rd --agent codex --workspace ~/projects/app
tb task roles task-1
tb task comment task-1 "Keep old session compatibility."
tb task comments task-1
tb task enter task-1 rd
tb task tail task-1 rd
tb task detail task-1 rd
tb task status task-1 rd
tb task transcript task-1 rd
tb task detach task-1 rd
tb task stop task-1 rd
tb task kill task-1 rd
tb doctor
```

Assigned roles are stored under the task directory. Each role records `schemaVersion`, name, agent, workspace, status, and timestamps.

Task comments are appended to `comments.jsonl` under the task directory and can be listed without entering a role session. Each comment record includes `schemaVersion`.

`task enter` uses tmux to create or reuse a task session and role window, then attaches the user to that role's native agent CLI. `task tail` reads recent role output with `tmux capture-pane`.

`task shell` opens an interactive TaskMux control prompt for the task. Shell commands reuse the same task command handlers as the non-interactive CLI.

`task detail` shows stored role metadata and tmux target information. `task status` probes `tmux list-windows`; when the role window exists it reports and persists `running`, when the session exists but the role window is absent it reports and persists `exited`, and when tmux cannot be inspected it keeps the stored status. `task transcript` reads tmux capture output and persists it to `roles/<role>/transcript.log`.

`task open` prints a task context summary for outer-shell workflows. `task detach` asks tmux to detach clients from the task session while leaving role processes running. `task stop` sends `C-c` to the role window; `task kill` kills the role window.

`doctor` checks Node.js, tmux, Codex CLI, Claude Code, and the configured TaskMux data directory. Test and managed environments can override executable paths with `TASKMUX_TMUX_BIN`, `TASKMUX_CODEX_BIN`, and `TASKMUX_CLAUDE_BIN`.

## Data Schema

TaskMux stores versioned local JSON records. Current records use `schemaVersion: 1`.

```json
{
  "schemaVersion": 1,
  "id": "task-1",
  "title": "Refactor login page",
  "status": "open",
  "createdAt": "2026-06-23T00:00:00.000Z",
  "updatedAt": "2026-06-23T00:00:00.000Z"
}
```

Role records use `status` values `idle`, `running`, `detached`, `exited`, or `failed`. Comment records use `id`, `body`, and `createdAt`. Invalid JSON or unsupported schema records fail with `DATA_ERROR`.

## Exit Codes

| Code | Name | Meaning |
| --- | --- | --- |
| 0 | OK | Command completed |
| 2 | USAGE_ERROR | Missing or invalid CLI input |
| 3 | TASK_NOT_FOUND / ROLE_NOT_FOUND | Requested task or role does not exist |
| 4 | DATA_ERROR | Stored TaskMux data is unreadable or fails schema validation |
| 5 | RUNTIME_ERROR | Unexpected runtime failure |

## License

MIT

## Release

```sh
npm run pack:dry-run
npm publish --access public
```
