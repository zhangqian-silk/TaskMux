# Runtime And Storage Requirements

## Task Lifecycle

Task status is changed through explicit commands:

| Command | Stored Status |
| --- | --- |
| `task start <task-id>` | `active` |
| `task done <task-id>` | `done` |
| `task archive <task-id>` | `archived` |
| `task reopen <task-id>` | `open` |

Each transition updates `task.json` and refreshes `updatedAt`.

## Task Event Log

TaskMux records task-level mutations in `events.jsonl` under the task directory. The log is append-only and local to the configured TaskMux home.

The current event stream records:

| Event Type | Trigger | Payload |
| --- | --- | --- |
| `task.created` | `task create` succeeds | `title` |
| `task.status_changed` | `task start`, `task done`, `task archive`, or `task reopen` succeeds | `from`, `to` |
| `role.assigned` | `task assign` succeeds | `role`, `agent` |
| `comment.added` | `task comment` succeeds | `comment` |

`task events <task-id>` lists events in storage order as `event-id`, timestamp, event type, and key-value payload pairs. A task with no event file returns `No events found.` instead of failing.

## Role Status Detection

`task status <task-id> <role>` is the stable command for checking a role's current execution state.

TaskMux resolves the role from storage, inspects the backing tmux session with `list-windows`, and compares window names against the role name.

- If the role window exists, status is `running`.
- If the task session can be inspected and the role window is absent, status is `exited`.
- If tmux inspection fails, TaskMux keeps the stored role status.

Detected status changes are written back to `role.json` with a refreshed `updatedAt` timestamp.

`task refresh <task-id>` applies the same detection to every assigned role in a task and prints the refreshed role status table.

`task cleanup <task-id>` is non-destructive. It refreshes stored role statuses from the current tmux window state and marks stale role records as `exited`; it does not delete tasks, roles, comments, transcripts, sessions, or windows.

## Role Lifecycle Actions

- `task enter <task-id> <role>` records the role as `running` after a successful tmux attach command returns.
- `task detach <task-id> <role>` records the role as `detached` after tmux detaches clients from the task session.
- `task stop <task-id> <role>` records the role as `exited` after sending `C-c`.
- `task kill <task-id> <role>` records the role as `exited` after killing the role window.
- `task restart <task-id> <role>` attempts to kill the old role window, recreates the role window from stored role metadata, attaches to it, and records the role as `running`.

## Runner Configuration

Built-in runners are always available:

- `codex`
- `claude`

Custom runners are managed with:

- `runner add <runner-id> --command <command> [--arg <arg> ...] [--env KEY=value ...]`
- `runner list`
- `runner show <runner-id>`
- `runner remove <runner-id>`

Runner ids may contain letters, numbers, hyphens, and underscores. Custom runner ids cannot replace built-in runner ids.

`task assign --agent <runner-id>` resolves the runner before writing `role.json`. Role records store the resolved `agent`, `command`, `args`, and `env`. Later changes to the runner definition do not mutate already assigned roles.

`doctor` checks custom runner commands with `--version` and reports them as `runner:<runner-id>`.

## Error Codes

CLI errors are structured for automation and shell scripts.

| Exit Code | Error Code | Trigger |
| --- | --- | --- |
| 2 | `USAGE_ERROR` | Missing task id, missing role name, missing option values, unsupported agent, empty title, or empty comment |
| 3 | `TASK_NOT_FOUND` | The requested task record does not exist |
| 3 | `ROLE_NOT_FOUND` | The requested role record does not exist under an existing task |
| 3 | `RUNNER_NOT_FOUND` | The requested custom or built-in runner id cannot be resolved |
| 4 | `DATA_ERROR` | Stored task, role, comment, event, or runner JSON cannot be parsed or does not match the active schema |
| 5 | `RUNTIME_ERROR` | Unexpected runtime failure |

Non-interactive commands write errors to stderr as `<ERROR_CODE>: <message>` and exit with the mapped code. The interactive task shell prints structured command errors and keeps the shell running.

## Data Schema

TaskMux storage records are local JSON or JSONL files. Every first-version record includes `schemaVersion: 1`.

Task record:

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

Role record:

```json
{
  "schemaVersion": 1,
  "name": "rd",
  "agent": "agent-js",
  "command": "/path/to/agent-js",
  "args": ["--model", "review"],
  "env": {
    "TASKMUX_MODE": "dev"
  },
  "workspace": "/path/to/project",
  "status": "idle",
  "createdAt": "2026-06-23T00:00:00.000Z",
  "updatedAt": "2026-06-23T00:00:00.000Z"
}
```

Comment record:

```json
{
  "schemaVersion": 1,
  "id": "comment-1",
  "body": "Keep old session compatibility.",
  "createdAt": "2026-06-23T00:00:00.000Z"
}
```

Event record:

```json
{
  "schemaVersion": 1,
  "id": "event-1",
  "type": "task.status_changed",
  "payload": {
    "from": "open",
    "to": "active"
  },
  "createdAt": "2026-06-23T00:00:00.000Z"
}
```

Custom runner record:

```json
{
  "schemaVersion": 1,
  "id": "agent-js",
  "command": "/path/to/agent-js",
  "args": ["--model", "review"],
  "env": {
    "TASKMUX_MODE": "dev"
  },
  "createdAt": "2026-06-23T00:00:00.000Z",
  "updatedAt": "2026-06-23T00:00:00.000Z"
}
```

Allowed task statuses are `open`, `active`, `done`, and `archived`. Allowed role statuses are `idle`, `running`, `detached`, `exited`, and `failed`.
