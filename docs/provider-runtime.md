# Managed Provider Runtime

Yui treats a provider conversation as the user's conversation. It adds the
Role's Yui Skill and a pointer to the Session Manifest, then uses provider-native
requests to deliver durable Task work. Yui does not own the transcript or
require every user interaction to pass through Yui.

Task state and conversation state have different responsibilities:

- Codex or Claude owns native messages, Turns, tool activity, and native history.
- Yui owns Tasks, WorkItems, AgentRuns, workspaces, durable messages, and wake
  hints. An open AgentRun records outstanding execution intent, not actual
  Agent activity or Leader authority.
- A Provider binding owns Session, Activation, authority, Goal, and native Turn
  facts. It does not maintain a second execution record alongside Yui's AgentRun.
- The Role Skill tells the Agent when and how to read or update Yui through the
  Session Manifest's exact `YUI_SESSION_CLI` entry point.

## Components

| Component | Responsibility |
| --- | --- |
| Controller | Schedule durable Task work and submit Provider-native Turns |
| Agent Host | Keep one Yui client attachment alive and relay structured requests |
| Provider Adapter | Start/resume a native conversation and submit or inspect AgentRuns |
| Provider conversation | Hold the user-visible transcript and native execution history |

The normal delivery path is:

```text
Explicit execution -> AgentRun -> Provider input
Message/wake       -> mailbox  -> Provider input
                                  -> exact Provider Runtime Binding evidence
```

Yui's internal authority epoch fences only Yui's own submissions.
It is not a claim that Yui is the only client allowed to use the conversation.

## Codex: ordinary shared-daemon threads

Managed Codex establishes the App Server WebSocket protocol through the
byte-forwarding `codex app-server proxy` and reaches the same native daemon used
by interactive Codex clients. The daemon owns the thread and its writer state.
The Agent Host owns only its disposable proxy process and WebSocket attachment.

Global Codex Roles keep the native TUI presentation, but Yui connects that TUI
to the same default App Server daemon. The connection endpoint is internal
runtime configuration and cannot be overridden by Agent or Role arguments.
The TUI is therefore a client attachment rather than a second rollout writer.
Its Session Manifest carries a self-contained Global Context command, so
opening the same thread in Desktop does not depend on environment inherited
from the Yui-created TUI process.

For Global Codex, a thin Agent Host transparently relays that native TUI's
WebSocket connection through a disposable shared-daemon proxy. Its loopback
endpoint requires an ephemeral bearer token and accepts only the owning TUI.
The Host correlates the TUI's exact startup request and response, then exposes
the returned Thread ID through the existing startup acknowledgement. Core
commits the Session only after that acknowledgement and a live pane check.
The Host and relay have the TUI's lifetime, not the Controller's lifetime.

This is deliberately the TUI's own `thread/start`, not a pre-created empty
Thread followed by `resume`: the supported Codex 0.150.1 cannot resume such a
Thread before its first message has materialized a rollout. No bootstrap
message is inserted. An unavailable or rejected startup returns an error and
leaves no active Session; retained dead panes remain diagnostic evidence.
Previously recorded Sessions still use their exact native resume identity.
Global `notify` is not an identity or lifecycle source.

The shared daemon must already be available through the installed Codex client.
Yui never starts, restarts, or stops it in response to a Task, thread, or proxy
error; daemon/CLI repair remains outside Task lifecycle recovery.

For a new Role conversation Yui calls `thread/start` with:

- the Role workspace and configured model/effort/permission settings;
- the Role's runtime workspace roots; and
- the small config overrides already selected for that Role.

The ordinary Task message carries the Session Manifest pointer. The manifest
points to `yui-runtime` and the matching Role Skill such as `yui-leader`,
`yui-worker`, or `yui-reviewer`. This keeps the user's native developer
instructions intact. No Yui-specific hook configuration is written to the
user's global Codex config.

The returned `threadId` is the Role's native Session identity already retained
by the Task Role Session Set. It remains an ordinary Codex thread that is
visible and directly usable in Desktop. Yui does not require a takeover to use
it from another native Codex client.

If an already-running native Turn is observed while Yui resumes a thread, Yui
classifies its attempted delivery as `busy`. The pending input and mailbox batch
stay durable until that native Turn settles. A Yui AgentRun reaches terminal state
only from the native Provider terminal; there is no separate `yield` outcome.
The final visible assistant response becomes the AgentRun result.

If a proxy disconnects, the Agent Host may attach a bounded replacement client
and resume the same thread from exact native history. Task execution stop
terminates the Agent Host and proxy, but leaves the shared daemon and native
thread untouched. Start creates a new proxy attachment. A failed fresh
attachment is stopped and its launch reservation is released; it cannot leave
`runtimeCleanupPending` as a prerequisite for the next attempt.

A Codex native config profile is rejected for Managed Codex because it cannot
be scoped to one shared-daemon thread. Role model, effort, permissions,
workspace, and shell settings remain thread-scoped. Yui never mutates the
underlying Codex config.

## Claude Code: independent structured process

Managed Claude continues to use a persistent `--input-format stream-json` and
`--output-format stream-json` process. Yui preallocates the native Session ID,
and Agent Host is that process's sole input writer. A completed pipe write is
transport evidence, not native acceptance. The matching Claude `result` supplies
acceptance and terminal evidence through the exact local attempt. A result-message
UUID is not a nativeTurnId.

The tmux view/takeover gateway remains the human-control boundary for providers
with an independent managed process, such as Claude. Codex users operate the
ordinary shared thread directly in Desktop.

## Delivery outcomes

Before Yui writes a Task-owned input, it records a `submitting` Provider Turn
observation using a stable attempt id. The provider result is one of:

- `accepted`: exact Provider evidence, including verified local stream correlation;
- `busy`: another ordinary client has an active native Turn, so Yui keeps the work
  pending;
- `rejected`: the provider definitively rejected the input before creating a
  native Turn; or
- `delivery-unknown`: the write may have happened but no exact receipt was
  observed.

`delivery-unknown` is never retried automatically. `busy` is safe to retry
because the provider proved that Yui's input was not accepted.

## Recovery

Conversation recovery uses provider-native evidence:

| Observation | Available Agent choice |
| --- | --- |
| Thread has Yui's exact persisted active AgentRun | Reattach and continue observing it |
| Thread has another client's active native Turn | Wait; retain pending Yui work |
| Yui's persisted AgentRun is terminal in native history | Fold the recovered terminal exactly once |
| Thread exists and is idle | Resume and deliver the pending input |
| Driver proves the thread is missing, ended, expired, or out of context | Settle the current AgentRun, explicitly stop the exact Session/Host, then dispatch a new AgentRun on a new Session; the complete prior error and identities remain readable |
| Availability, capacity, or `429`; input was accepted and Session is recoverable | Submit a new AgentRun in the same Session when useful |
| Delivery is unknown | Inspect native history and preserve identity; do not blindly duplicate the input |

A dead pane, process exit, timeout, or App Server disconnect is not proof that
a thread is missing. Yui may replace its owned process, but it replaces a
thread only after exact Driver evidence that the native conversation is dead
or cannot continue because its context is exhausted.

## Required invariants

1. A stable Provider Turn attempt exists before its provider write.
2. Provider acceptance carries exact native identity or verified local correlation.
3. Ambiguous delivery is never automatically duplicated.
4. A busy ordinary thread keeps Yui work pending instead of failing the AgentRun.
5. A replacement conversation is created only after the responsible Agent
   explicitly ends the old Session; Core never replaces it as error policy.
6. Yui Skill/config does not mutate global Codex config.
7. Task stop owns and terminates every Yui Agent Host and proxy without treating
   the shared Codex daemon or native conversation as Task cleanup.
8. Provider runtime state is not the Leader's general management authority.
9. TaskRole carries desired configuration only; displayed activity is derived
   from native evidence separately from AgentRun lifecycle.

## Direct dialogue and Goal

Only explicitly requested tracked work becomes an AgentRun. Ordinary notifications,
native dialogue and Goal continuation do not automatically create one.
Yui-delivered execution input retains its source/channel; accurately observed native
items may append `provider/visible-input` without attributing an unverified human
origin. Reasoning and tool traffic remain Provider-native.

A Session may span many AgentRuns. An explicit Codex Goal event or Claude
`active_goal` fact is Session-scoped and may span those AgentRuns. A AgentRun terminal
does not imply Goal, WorkItem, or Task completion, and Yui never guesses Goal
completion from a quiet interval. Leader alone updates durable WorkItem and
Task meaning.

See [Session, AgentRun and notification boundaries](architecture/yui-handbook-full-architecture/architecture/07-session-run-contract.md)
for the current API, result Messages, planning authority and migration.
