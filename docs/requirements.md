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
- `taskmux task assign <task-id> <role> --agent <agent> --workspace <path>` assigns a role to an existing task with status `idle`
- `taskmux task roles <task-id>` lists roles assigned to a task

TaskMux should also provide commands for:

- Opening a task shell
- Binding roles to runners
- Binding roles to workspaces
- Adding task comments
- Listing roles and role status
- Entering a role session
- Detaching from a role session without stopping it
- Capturing recent role output
- Showing role details and transcripts
- Running `doctor` checks for tmux and runner availability

## Execution Semantics

TaskMux must clearly distinguish:

- `detach`: leave the role view while the native CLI process continues
- `exit`: let the native CLI process end
- `stop`: ask TaskMux to stop a role process
- `kill`: force terminate a role process

Users must not need to understand tmux internals for normal operation.

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
          tmux.json
          transcript.log
```

Task ids use the stable `task-<number>` format in the first version. The next id is derived from existing local task directories.

Role records live under `tasks/<task-id>/roles/<role>/role.json`. Role names are task-scoped. Reassigning an existing role overwrites that role's current agent and workspace while preserving the task identity.

## First-Version Exclusions

- Remote synchronization
- Team permissions
- Web UI
- Non-tmux execution fallback
- Forced PTY input interception
- Guaranteed custom slash commands inside every runner
