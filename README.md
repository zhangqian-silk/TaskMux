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
- Codex CLI and Claude Code keep their native terminal behavior.

## Example

```sh
tb task create "Refactor login page"
tb task list
tb task show task-1
tb task assign task-1 rd --agent codex --workspace ~/projects/app
tb task assign task-1 reviewer --agent claude --workspace ~/projects/app
tb task roles task-1
tb task open task-42
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
tb task assign task-1 rd --agent codex --workspace ~/projects/app
tb task roles task-1
```

Assigned roles are stored under the task directory. Each role currently records its name, agent, workspace, status, and timestamps.

## License

MIT
