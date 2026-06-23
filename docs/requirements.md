# TaskMux Requirements

## Product Boundary

TaskMux is a personal local CLI task board. It is installed as an npm package and uses tmux as the execution substrate for persistent native agent CLI sessions.

TaskMux does not provide team collaboration, remote synchronization, identity management, or a web UI in the first version.

## Package Identity

- Product name: TaskMux
- npm package: `@silk/taskmux`
- CLI commands: `taskmux`, `tb`
- License: MIT

## Core Concepts

| Concept | Responsibility |
| --- | --- |
| Task | A local unit of work managed by TaskMux |
| Role | A named execution responsibility inside a task, such as `rd`, `reviewer`, or `tester` |
| Runner | A native CLI executable bound to a role, such as Codex CLI or Claude Code |
| Workspace | The filesystem directory where a role executes |
| Tmux Session | The persistent terminal session backing one TaskMux task |
| Tmux Window | The persistent terminal window backing one role |
| Transcript | Captured terminal output for inspection without attaching to the role |

## Tmux Mapping

TaskMux uses tmux as the only role execution substrate in the first version.

- One task maps to one tmux session.
- One role maps to one tmux window.
- One role window runs one native agent CLI process.

Example:

```text
task-42 -> tmux session taskmux-task-42
rd -> tmux window taskmux-task-42:rd
reviewer -> tmux window taskmux-task-42:reviewer
```

## Required Commands

TaskMux currently provides:

- `taskmux task create <title>` creates a local task with status `open`
- `taskmux task list` lists local tasks in id order
- `taskmux task show <task-id>` shows one task by id
- `taskmux task open <task-id>` shows a task context summary for outer-shell workflows
- `taskmux task shell <task-id>` opens an interactive task control shell
- `taskmux task assign <task-id> <role> --agent <agent> --workspace <path>` assigns a role to an existing task with status `idle`
- `taskmux task roles <task-id>` lists roles assigned to a task
- `taskmux task enter <task-id> <role>` creates or reuses the task tmux session and role tmux window, then attaches to the role
- `taskmux task tail <task-id> <role>` reads recent role output from tmux capture-pane
- `taskmux task detail <task-id> <role>` shows role metadata and tmux target information
- `taskmux task status <task-id> <role>` inspects tmux role window state, updates stored role status when detection succeeds, and shows role status plus tmux target information
- `taskmux task transcript <task-id> <role>` reads the current tmux capture stream for the role
- `taskmux task detach <task-id> <role>` detaches tmux clients from the task session without stopping role processes
- `taskmux task stop <task-id> <role>` sends `C-c` to the role tmux window and records the role as `exited`
- `taskmux task kill <task-id> <role>` kills the role tmux window and records the role as `exited`
- `taskmux task comment <task-id> <body>` appends a comment to a task
- `taskmux task comments <task-id>` lists comments for a task
- `taskmux doctor` checks Node.js, tmux, Codex CLI, Claude Code, and the configured TaskMux home

TaskMux should also provide future commands for:

- Dedicated transcript export formats
- Configurable custom runners
- Release automation around npm publishing

## Execution Semantics

TaskMux must clearly distinguish:

- `detach`: leave the role view while the native CLI process continues
- `exit`: let the native CLI process end
- `stop`: ask TaskMux to stop a role process
- `kill`: force terminate a role process

Users must not need to understand tmux internals for normal operation.

## Status Semantics

Role status is stored in `role.json` and may be refreshed from tmux by `task status`.

- `idle`: role assigned but no detected running tmux role window
- `running`: task tmux session contains the role window
- `detached`: reserved for a role process that is running without an attached user-facing view
- `exited`: role window has been stopped, killed, or is absent while the task session can be inspected
- `failed`: reserved for runner failures that TaskMux can classify

When tmux cannot be inspected, TaskMux keeps the stored status instead of overwriting it with an uncertain value.

## Data Storage

TaskMux stores data in a user-level application directory. It does not write task state into the project workspace by default.

The default directory is `~/.taskmux`. The `TASKMUX_HOME` environment variable overrides this path for isolated runs, tests, and automation.

Suggested layout:

```text
~/.taskmux/
  tasks/
    task-42/
      task.json
      comments.jsonl
      roles/
        rd/
          role.json
          transcript.log
```

Task, role, and comment records are versioned with `schemaVersion: 1`. TaskMux validates loaded records before using them. Invalid JSON, missing required fields, unsupported schema versions, or invalid status values must fail with `DATA_ERROR` rather than being treated as empty state.

Task ids use the stable `task-<number>` format in the first version. The next id is derived from existing local task directories.

Role records live under `tasks/<task-id>/roles/<role>/role.json`. Role names are task-scoped. Reassigning an existing role overwrites that role's current agent and workspace while preserving the task identity. Supported first-version agents are `codex` and `claude`.

Role transcripts live under `tasks/<task-id>/roles/<role>/transcript.log` after `task transcript` captures current tmux output.

Task comments live in `tasks/<task-id>/comments.jsonl`. Each line stores one comment object with `schemaVersion`, `id`, `body`, and `createdAt`.

## Error Model

TaskMux commands use stable process exit codes for scriptable failure handling.

| Exit Code | Error Code | Scope |
| --- | --- | --- |
| 2 | `USAGE_ERROR` | Missing arguments, invalid options, unsupported agents, or empty user input |
| 3 | `TASK_NOT_FOUND` / `ROLE_NOT_FOUND` | Missing task or role records |
| 4 | `DATA_ERROR` | Invalid stored JSON, unsupported schema version, or invalid stored fields |
| 5 | `RUNTIME_ERROR` | Unexpected runtime failures or unavailable execution plumbing |

Errors are printed to stderr as `<ERROR_CODE>: <message>`.

## First-Version Exclusions

- Remote synchronization
- Team permissions
- Web UI
- Non-tmux execution fallback
- Forced PTY input interception
- Guaranteed custom slash commands inside every runner
