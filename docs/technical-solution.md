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

## Observability

TaskMux reads recent role output through tmux capture APIs. The first version should expose role detail, tail, and transcript views without attaching to the role.

Structured runner events are future work and must not be required for core role inspection.

## Testing Strategy

Domain behavior should be tested without requiring tmux. Tmux command construction and process integration should be isolated behind interfaces so unit tests can use fakes.

End-to-end tmux tests should be added only after the command surface and tmux manager interface stabilize.
