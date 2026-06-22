# TaskMux Technical Solution

## Architecture

TaskMux is divided into four stable boundaries:

```text
TaskMux CLI
  -> Task Store
  -> Role Manager
  -> Tmux Manager
  -> Runner Adapter
```

tmux owns persistent terminal execution. TaskMux owns task state, role metadata, comments, transcript indexing, and user-facing commands.

## Package Boundary

TaskMux is developed as a standalone npm package. The package exports CLI entrypoints only in the first version.

## Tmux Manager

The Tmux Manager wraps tmux commands for:

- Checking tmux availability
- Creating task sessions
- Creating role windows
- Attaching to role windows
- Capturing pane output
- Inspecting window state
- Stopping or killing role windows when requested

TaskMux does not implement its own PTY supervisor in the first version.

The current tmux command contract is:

```text
task enter <task-id> <role>
  tmux has-session -t taskmux-<task-id>
  tmux new-session -d -s taskmux-<task-id>          # when missing
  tmux list-windows -t taskmux-<task-id> -F #{window_name}
  tmux new-window -t taskmux-<task-id> -n <role> -c <workspace> <agent>  # when missing
  tmux attach-session -t taskmux-<task-id>:<role>

task tail <task-id> <role>
  tmux capture-pane -p -t taskmux-<task-id>:<role> -S -80
```

`TASKMUX_TMUX_BIN` can override the tmux executable for tests and controlled environments. Normal users should rely on the default `tmux` executable.

## Runner Adapter

Runner adapters describe how to start a native CLI for a role.

Initial runners:

- Codex CLI
- Claude Code

Adapters provide:

- Executable detection
- Start command construction
- Workspace handling
- Optional environment variables
- Capability metadata for future plugin, hook, or MCP integration

## Storage

TaskMux stores state in a user-level data directory. The first version may use JSON and JSONL files.

The storage layer must keep task state independent from project workspace contents.

The current storage implementation uses:

```text
TASKMUX_HOME or ~/.taskmux
  tasks/
    task-1/
      task.json
```

`task.json` stores `id`, `title`, `status`, `createdAt`, and `updatedAt`. `FileTaskStore` owns id allocation, task persistence, task listing, and task lookup. The CLI resolves the data directory once and passes the store into task command handlers.

Role assignment uses the same store boundary:

```text
TASKMUX_HOME or ~/.taskmux
  tasks/
    task-1/
      roles/
        rd/
          role.json
```

`role.json` stores `name`, `agent`, `workspace`, `status`, `createdAt`, and `updatedAt`. The first stable role status is `idle`; tmux-backed execution will extend this path with runtime state in later slices.

Task comments are append-only JSONL records:

```text
TASKMUX_HOME or ~/.taskmux
  tasks/
    task-1/
      comments.jsonl
```

Each comment stores `id`, `body`, and `createdAt`. The first version derives comment ids from the current comment count for the task.

## Observability

TaskMux reads recent role output through tmux capture APIs. The first version should expose role detail, tail, and transcript views without attaching to the role.

Structured runner events are future work and must not be required for core role inspection.

## Testing Strategy

Domain behavior should be tested without requiring tmux. Tmux command construction and process integration should be isolated behind interfaces so unit tests can use fakes.

End-to-end tmux tests should be added only after the command surface and tmux manager interface stabilize.
