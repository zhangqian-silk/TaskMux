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

task transcript <task-id> <role>
  tmux capture-pane -p -t taskmux-<task-id>:<role> -S -80

task status <task-id> <role>
  tmux list-windows -t taskmux-<task-id> -F #{window_name}
  # role window present -> running
  # task session inspectable but role window absent -> exited

task detach <task-id> <role>
  tmux detach-client -s taskmux-<task-id>

task stop <task-id> <role>
  tmux send-keys -t taskmux-<task-id>:<role> C-c

task kill <task-id> <role>
  tmux kill-window -t taskmux-<task-id>:<role>
```

`TASKMUX_TMUX_BIN` can override the tmux executable for tests and controlled environments. Normal users should rely on the default `tmux` executable.

`detectRoleStatus` treats tmux inspection as best-effort. If the tmux command fails, it returns the stored role status so TaskMux does not overwrite state with an uncertain result.

## Doctor

`taskmux doctor` runs environment checks without mutating task state.

Current checks:

- Node.js version from the current process
- tmux executable using `tmux -V`
- Codex CLI executable using `codex --version`
- Claude Code executable using `claude --version`
- resolved TaskMux home directory

Executable paths can be overridden with `TASKMUX_TMUX_BIN`, `TASKMUX_CODEX_BIN`, and `TASKMUX_CLAUDE_BIN` for tests and managed environments.

## Runner Adapter

Runner adapters describe how to start a native CLI for a role.

Initial runners:

- Codex CLI
- Claude Code

`src/runner/runnerRegistry.ts` is the single source of supported runner ids. Role assignment rejects unsupported agents before writing `role.json`.

Adapters provide:

- Executable detection
- Start command construction
- Workspace handling
- Optional environment variables
- Capability metadata for future plugin, hook, or MCP integration

## Interactive Task Shell

The interactive shell is implemented in `src/shell/taskShell.ts`. It loads a task, prints the same summary as `task open`, then maps shell commands to existing task commands.

Examples:

```text
summary -> task open <task-id>
roles -> task roles <task-id>
comment <body> -> task comment <task-id> <body>
enter <role> -> task enter <task-id> <role>
```

The shell does not implement separate business logic and does not intercept native Codex or Claude input after `enter`.

Structured `CliError` failures are printed in the shell without closing the prompt. Non-interactive commands let `src/cli.ts` convert the same error type into stderr and a process exit code.

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

`task.json` stores `schemaVersion`, `id`, `title`, `status`, `createdAt`, and `updatedAt`. `FileTaskStore` owns id allocation, task persistence, task listing, and task lookup. The CLI resolves the data directory once and passes the store into task command handlers.

Role assignment uses the same store boundary:

```text
TASKMUX_HOME or ~/.taskmux
  tasks/
    task-1/
      roles/
        rd/
          role.json
```

`role.json` stores `schemaVersion`, `name`, `agent`, `workspace`, `status`, `createdAt`, and `updatedAt`. The first stable role status is `idle`; `task stop` and `task kill` update role status to `exited`. `task status` refreshes role status from tmux when possible and writes detected changes back to `role.json`; `task detail` reads stored role metadata without probing tmux.

Task comments are append-only JSONL records:

```text
TASKMUX_HOME or ~/.taskmux
  tasks/
    task-1/
      comments.jsonl
```

Each comment stores `schemaVersion`, `id`, `body`, and `createdAt`. The first version derives comment ids from the current comment count for the task.

Storage reads validate JSON records before returning domain objects:

- Task records require `schemaVersion: 1`, string ids and timestamps, and a valid task status.
- Role records require `schemaVersion: 1`, string name, agent, workspace, timestamps, and a valid role status.
- Comment records require `schemaVersion: 1`, string id, body, and timestamp.

Invalid records raise `DATA_ERROR` instead of being skipped silently.

## Error Handling

`src/errors/cliError.ts` defines the CLI error contract.

| Error Code | Exit Code |
| --- | --- |
| `USAGE_ERROR` | 2 |
| `TASK_NOT_FOUND` | 3 |
| `ROLE_NOT_FOUND` | 3 |
| `DATA_ERROR` | 4 |
| `RUNTIME_ERROR` | 5 |

Command handlers throw `CliError` for expected user, lookup, and storage failures. The CLI entrypoint prints `<ERROR_CODE>: <message>` to stderr and exits with the mapped code. Unexpected errors are wrapped as `RUNTIME_ERROR` at the process boundary.

## Observability

TaskMux reads recent role output through tmux capture APIs. The first version should expose role detail, tail, and transcript views without attaching to the role.

Structured runner events are future work and must not be required for core role inspection.

`task detail` reads role metadata from `role.json` and derives the tmux target as `taskmux-<task-id>:<role>`. `task status` probes tmux window state and persists detected status changes. `task transcript` reads tmux capture output and persists it to `roles/<role>/transcript.log`.

`task open` reads task, role, and comment counts from storage and prints a task context summary. `task shell` provides an interactive wrapper over the same task command handlers. `task detach` detaches tmux clients for the task session and does not terminate the role process.

## Testing Strategy

Domain behavior should be tested without requiring tmux. Tmux command construction and process integration should be isolated behind interfaces so unit tests can use fakes.

End-to-end tmux tests should be added only after the command surface and tmux manager interface stabilize.
