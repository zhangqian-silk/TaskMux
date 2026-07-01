# TaskMux Requirements

## Product Boundary

TaskMux is a personal local CLI task board. It is installed as an npm package and uses tmux as the execution substrate for persistent native agent CLI sessions.

TaskMux does not provide team collaboration, remote synchronization, identity management, or a web UI in the first version.

## Package Identity

- Product name: TaskMux
- npm package: `@zq-silk/taskmux`
- CLI command: `taskmux`
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
| Event | An append-only local record of task-level mutations |

## Tmux Mapping

TaskMux uses tmux as the only role execution substrate in the first version.

- One task maps to one tmux session.
- One role maps to one tmux window.
- One role window runs one native agent CLI process.
- Every task includes the system `owner` role. `owner` is created during task creation and cannot be renamed.

Example:

```text
task-42 -> tmux session taskmux-task-42
rd -> tmux window taskmux-task-42:rd
reviewer -> tmux window taskmux-task-42:reviewer
```

## Required Commands

TaskMux currently provides:

- `taskmux runner add <runner-id> --command <command> [--arg <arg> ...] [--env KEY=value ...]` creates or replaces a custom runner definition
- `taskmux runner list` lists configured runner definitions
- `taskmux runner show <runner-id>` shows one runner definition
- `taskmux runner remove <runner-id>` removes a custom runner definition
- `taskmux completion bash|zsh|fish` prints shell completion for the selected shell
- `taskmux config show` shows local defaults
- `taskmux config set default-agent <runner-id>` stores the default runner id
- `taskmux config set default-workspace <path>` stores the default role workspace
- `taskmux config unset default-agent|default-workspace` removes one default
- `taskmux task create <title> [--description <body>] [--priority low|medium|high|urgent] [--tag <tag> ...] [--owner <owner>] [--due YYYY-MM-DD]` creates a local task with status `open` and optional task board metadata
- `taskmux task create <title> --template feature|bug|review [--agent <agent>] [--workspace <path>]` creates a task from a built-in template and assigns default roles
- `taskmux task update <task-id> [--title <title>] [--description <body>] [--priority low|medium|high|urgent] [--tag <tag> ...] [--owner <owner>] [--due YYYY-MM-DD] [--clear-description] [--clear-priority] [--clear-tags] [--clear-owner] [--clear-due]` updates or clears task board metadata
- `taskmux task list [--status <status>] [--owner <owner>] [--tag <tag>] [--priority <priority>] [--search <text>]` lists local tasks in id order with optional filters
- `taskmux task board [--status <status>] [--owner <owner>] [--tag <tag>] [--priority <priority>] [--search <text>] [--with-roles]` renders local tasks grouped by lifecycle status with optional filters and role status counts
- `taskmux task show <task-id>` shows one task by id
- `taskmux task current [<task-id>]` shows or sets the current task pointer
- `taskmux task last` shows the most recently touched task pointer
- `taskmux task clone <task-id> [--title <title>]` creates a new task from existing task metadata and assigned roles
- `taskmux task start <task-id>` updates a task to status `active`
- `taskmux task done <task-id>` updates a task to status `done`
- `taskmux task archive <task-id>` updates a task to status `archived`
- `taskmux task reopen <task-id>` updates a task to status `open`
- `taskmux task delete <task-id>` moves a task into local trash
- `taskmux task restore <task-id>` restores a deleted task from local trash
- `taskmux task open <task-id>` shows a task context summary for outer-shell workflows
- `taskmux task context <task-id> [--format text|json] [--include-transcripts]` renders a task handoff snapshot across metadata, roles, comments, events, and optional stored role transcripts
- `taskmux task shell <task-id>` opens an interactive task control shell
- `taskmux task assign <task-id> <role> --agent <agent> --workspace <path>` assigns a role to an existing task with status `idle`
- `taskmux task assign-many <task-id> --role <role> ... [--agent <agent>] [--workspace <path>]` assigns multiple roles at once
- `taskmux task role update <task-id> <role> [--agent <agent>] [--workspace <path>]` updates a role's runner contract or workspace
- `taskmux task role rename <task-id> <role> <new-role>` renames a role and attempts to rename the matching tmux window
- `taskmux task roles <task-id>` lists roles assigned to a task
- `taskmux task enter <task-id> <role>` creates or reuses the task tmux session and role tmux window, then attaches to the role
- `taskmux task tail <task-id> <role>` reads recent role output from tmux capture-pane
- `taskmux task detail <task-id> <role>` shows role metadata and tmux target information
- `taskmux task status <task-id> <role>` inspects tmux role window state, updates stored role status when detection succeeds, and shows role status plus tmux target information
- `taskmux task refresh <task-id>` inspects every assigned role for a task and writes detected statuses to storage
- `taskmux task transcript <task-id> <role>` reads the current tmux capture stream for the role
- `taskmux task transcript export <task-id> <role> [--format text|json|markdown] [--output <file>]` renders a stored role transcript
- `taskmux task activity <task-id>` summarizes role status, agent, transcript line count, and update time
- `taskmux task timeline <task-id>` renders task events and comments in one chronological view
- `taskmux task detach <task-id> <role>` detaches tmux clients from the task session without stopping role processes
- `taskmux task stop <task-id> <role>` sends `C-c` to the role tmux window and records the role as `exited`
- `taskmux task kill <task-id> <role>` kills the role tmux window and records the role as `exited`
- `taskmux task restart <task-id> <role>` recreates and attaches to a role window using stored role metadata, then records the role as `running`
- `taskmux task cleanup <task-id>` refreshes stored role state from tmux and marks stale role windows as `exited`
- `taskmux task comment <task-id> <body>` appends a comment to a task
- `taskmux task comments <task-id>` lists comments for a task
- `taskmux task events <task-id>` lists the local event history for a task
- `taskmux doctor` checks Node.js, tmux, configured runners, TaskMux home, storage schema, storage permissions, and stored record health
- `taskmux setup [tmux] [--yes]` checks installable system dependencies, installs tmux through a supported package manager only when `--yes` is provided, and prints owner-role CLI binding guidance
- `taskmux backup` creates a timestamped raw storage backup
- `taskmux migrate` upgrades older local storage schemas after creating a backup
- `taskmux migrate --dry-run` reports migration work without writing storage
- `taskmux export --output <file>` writes a local JSON snapshot
- `taskmux import <file>` imports a local JSON snapshot
- `taskmux prune --trash [--backups] [--keep-backups <count>]` prunes deleted tasks and old backups

## Release Automation

TaskMux publishes `@zq-silk/taskmux` through npm Trusted Publishing from GitHub Actions.

- Releases are triggered by `v*` git tags.
- The release tag must exactly match `package.json` version.
- Publishing runs in the GitHub `npm` environment.
- The workflow uses OIDC with `id-token: write` and must not use long-lived npm tokens.
- The workflow must complete install, build, tests, lint, package dry-run, and `npm publish --access public`.

## Execution Semantics

TaskMux must clearly distinguish:

- `detach`: leave the role view while the native CLI process continues
- `exit`: let the native CLI process end
- `stop`: ask TaskMux to stop a role process
- `kill`: force terminate a role process

Users must not need to understand tmux internals for normal operation.

## Task Status Semantics

Task status is explicit user-managed state.

- `open`: task is created or reopened
- `active`: task is in progress
- `done`: task work is completed
- `archived`: task is retained but no longer part of the active board

## Status Semantics

Role status is stored in `role.json` and may be refreshed from tmux by `task status`.

- `idle`: role assigned but no detected running tmux role window
- `running`: task tmux session contains the role window
- `detached`: TaskMux detached clients from the task session while leaving the role process available
- `exited`: role window has been stopped, killed, or is absent while the task session can be inspected
- `failed`: reserved for runner failures that TaskMux can classify

When tmux cannot be inspected, TaskMux keeps the stored status instead of overwriting it with an uncertain value.

## Runner Semantics

TaskMux supports user-configured runner ids.

- Runner definitions are stored locally and are task-independent.
- A runner defines a command, ordered args, and environment variables.
- Fresh installs have no default runner definitions. `codex` and `claude` are ordinary runner ids users may bind with `runner add`.
- `task assign --agent <runner-id>` resolves the runner id before writing role state.
- `task role update --agent <runner-id>` resolves the runner id and overwrites that role's stored command, args, env, and agent id.
- A role stores the resolved runner command, args, and env so later `enter` and `restart` use the same execution contract even if the runner definition changes.

## Template And Defaults

TaskMux stores local defaults in `config.json` under the TaskMux home.

- `default-agent` is used when task creation, a template, or multi-role assignment does not specify `--agent`.
- `default-workspace` is used when task creation, a template, or multi-role assignment does not specify `--workspace`.
- `currentTaskId` stores the task selected by `task current <task-id>`.
- `lastTaskId` stores the most recently touched task from creation, clone, show, open, context, or explicit current selection.
- `task create` creates the system `owner` role for every task.
- `task create --template feature` creates `owner`, `rd`, and `reviewer` roles and adds the `feature` tag with medium priority unless overridden.
- `task create --template bug` creates `owner`, `rd`, and `tester` roles and adds the `bug` tag with high priority unless overridden.
- `task create --template review` creates `owner` and `reviewer` roles and adds the `review` tag with medium priority unless overridden.

`task clone` copies the source task's editable metadata and assigned role execution contracts into a new task, resets cloned roles to `idle`, records the clone source in the new task's event log, and updates the last-task pointer.

## Data Storage

TaskMux stores data in a user-level application directory. It does not write task state into the project workspace by default.

The default directory is `~/.taskmux`. The `TASKMUX_HOME` environment variable overrides this path for isolated runs, tests, and automation.

Suggested layout:

```text
~/.taskmux/
  config.json
  schema.json
  backups/
    backup-<timestamp>/
  trash/
    tasks/
      task-42/
  tasks/
    task-42/
      info.json
      task.json
      comments.jsonl
      events.jsonl
      roles/
        rd/
          info.json
          role.json
          transcript.log
```

Task, role, comment, and event records are versioned with `schemaVersion: 1`. TaskMux validates loaded records before using them. Invalid JSON, missing required fields, unsupported schema versions, or invalid status values must fail with `DATA_ERROR` rather than being treated as empty state.

The data directory has a global storage schema manifest at `schema.json`. Normal task and runner commands run a storage preflight on startup:

- Missing manifests are initialized to the current storage schema version.
- Current manifests allow the command to continue.
- Older manifests fail with `DATA_ERROR` and instruct the user to run `taskmux migrate`.
- Newer or invalid manifests fail with `DATA_ERROR`.

`taskmux backup` creates a timestamped raw copy of the current data directory under `backups/`. Backup creation excludes the `backups/` directory itself so backups do not recursively copy previous backups.

`taskmux migrate` is the only place where older storage schemas are upgraded. Migrations run in version order and update `schema.json` after all required steps succeed. When a migration upgrades an older schema, TaskMux creates a backup before applying migration steps and prints the backup path. Business stores read and write only the latest schema.

`taskmux migrate --dry-run` reports whether schema initialization or upgrade would happen without writing `schema.json` or creating a backup.

`taskmux export --output <file>` writes a JSON snapshot with config, custom runners, active tasks, roles, comments, events, and stored transcripts. `taskmux import <file>` restores that snapshot into the configured TaskMux home.

`taskmux prune --trash` removes deleted task directories under `trash/tasks`. `taskmux prune --backups --keep-backups <count>` removes older backup directories after keeping the newest entries.

`doctor` reports storage schema status, storage directory read/write permission, and stored record health. Outdated storage is reported as `upgrade-required` with `current`, `latest`, and `run taskmux migrate` guidance. Invalid stored records are reported as `storage records invalid` without aborting the rest of the doctor report.

Task and role user-editable labels are isolated from runtime state:

- Task title, description, priority, tags, owner, and due date live in `tasks/<task-id>/info.json`.
- Role name lives in `tasks/<task-id>/roles/<role>/info.json`.
- Runtime records do not require title or role name fields.
- Users may edit `info.json` directly; TaskMux reads the edited title or role name on the next command.
- Runtime records containing inline task title or role name are invalid in the current schema.

Task priorities are `low`, `medium`, `high`, and `urgent`. Due dates use `YYYY-MM-DD`. `task update` can clear optional metadata fields with the `--clear-*` flags. `task list` filters by status, owner, tag, priority, and case-insensitive search across title, description, owner, priority, due date, and tags. `task board` uses the same filters and groups matching tasks under `open`, `active`, `done`, and `archived`; `--with-roles` appends stored role status counts.

Task ids use the stable `task-<number>` format in the first version. The next id is derived from existing local task directories.

Custom runner records live under `runners/<runner-id>/runner.json`.

Role runtime records live under `tasks/<task-id>/roles/<role>/role.json`. Role names are task-scoped and resolved from `info.json`. Reassigning an existing role overwrites that role's current agent, command, args, env, and workspace while preserving the task identity. `task role update` changes the same runtime contract without changing the role name. `task role rename` updates `info.json` and attempts `tmux rename-window` for the current role target; tmux rename failures do not block local metadata updates when the window is absent.

Role transcripts live under `tasks/<task-id>/roles/<role>/transcript.log` after `task transcript` captures current tmux output.

`task context` reads the current task, assigned roles, comments, events, and optionally stored role transcripts. The default text format is intended for human handoff. `--format json` returns a structured object with `task`, `roles`, `comments`, and `events`. `--include-transcripts` does not call tmux; it only includes transcript files already persisted by `task transcript`.

Task comments live in `tasks/<task-id>/comments.jsonl`. Each line stores one comment object with `schemaVersion`, `id`, `body`, and `createdAt`.

Deleted tasks are moved to `trash/tasks/<task-id>` and are excluded from active task list, board, show, role, comment, event, and context commands. `task restore` moves the task directory back into `tasks/<task-id>` and preserves comments, events, roles, and transcripts.

Task events live in `tasks/<task-id>/events.jsonl`. Each line stores one event object with `schemaVersion`, `id`, `type`, `payload`, and `createdAt`. Event ids use `event-<number>` within the task. The first event set records `task.created`, `task.cloned`, `task.updated`, `task.deleted`, `task.restored`, `task.status_changed`, `role.assigned`, `role.updated`, `role.renamed`, and `comment.added`.

The interactive task shell supports short aliases for repeated task-board work: `q` exits, `r` lists roles, `c` lists comments, `e` lists events, `a` shows role activity, and `t` shows the timeline.

## Error Model

TaskMux commands use stable process exit codes for scriptable failure handling.

| Exit Code | Error Code | Scope |
| --- | --- | --- |
| 2 | `USAGE_ERROR` | Missing arguments, invalid options, unsupported agents, or empty user input |
| 3 | `TASK_NOT_FOUND` / `ROLE_NOT_FOUND` / `RUNNER_NOT_FOUND` | Missing task, role, or runner records |
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
