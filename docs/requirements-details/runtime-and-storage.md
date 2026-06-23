# Runtime And Storage Requirements

## Role Status Detection

`task status <task-id> <role>` is the stable command for checking a role's current execution state.

TaskMux resolves the role from storage, inspects the backing tmux session with `list-windows`, and compares window names against the role name.

- If the role window exists, status is `running`.
- If the task session can be inspected and the role window is absent, status is `exited`.
- If tmux inspection fails, TaskMux keeps the stored role status.

Detected status changes are written back to `role.json` with a refreshed `updatedAt` timestamp.

## Error Codes

CLI errors are structured for automation and shell scripts.

| Exit Code | Error Code | Trigger |
| --- | --- | --- |
| 2 | `USAGE_ERROR` | Missing task id, missing role name, missing option values, unsupported agent, empty title, or empty comment |
| 3 | `TASK_NOT_FOUND` | The requested task record does not exist |
| 3 | `ROLE_NOT_FOUND` | The requested role record does not exist under an existing task |
| 4 | `DATA_ERROR` | Stored JSON cannot be parsed or does not match the active schema |
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
  "agent": "codex",
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

Allowed task statuses are `open`, `active`, `done`, and `archived`. Allowed role statuses are `idle`, `running`, `detached`, `exited`, and `failed`.
