---
name: yui-runtime
description: Load and use the authorized context for every Yui-managed Leader, Worker, Reviewer, Operator, or custom Role AgentRun, and complete that AgentRun through its bounded control-plane protocol.
---

# Yui Runtime

Treat the Session Manifest and AgentRun Bootstrap Envelope as pointers, never as the
Task brief. Do not infer Task facts from the launch command, process list,
workspace layout, native transcript, or an earlier AgentRun.

There are two normal Task entry points. A user may continue directly with the
current, unrevoked Leader Session: read current context using the Session CLI
with `task context <task-id> --json`. Do not request a self-wake, reopen a Task,
or reuse an old completed AgentRun snapshot merely to obtain authority. Pending
delivery, unknown execution evidence and missing reports do not themselves
revoke Session authority. Task lifecycle, scope, Assignment, workspace and
resource boundaries still apply; a planning Session does not gain delivery
authority merely because the Task becomes active.

For every explicitly dispatched managed Task AgentRun:

1. Read the exact AgentRun identity from the newest Bootstrap Envelope.
2. Before acting, load its authorized pack with the Session CLI named by the
   current Session Manifest:

   ```sh
   "$YUI_SESSION_CLI" task run context "$YUI_TASK_ID/<run-id>" --json
   ```

3. Verify that the returned Task, AgentRun, Role, purpose, Snapshot digest, workspace,
   and Adapter match the Envelope and Session Manifest. Stop and report a
   context-load failure if the pack is missing, stale, unauthorized, malformed,
   or mismatched. Never request an inline/full-prompt fallback.
4. Use pack summaries and pointers first. Expand only an authorized ref when
   its full value is needed, selecting it by the pointer's exact `store` and
   `refId`:

   ```sh
   "$YUI_SESSION_CLI" task run context expand "$YUI_TASK_ID/<run-id>" <ref-id> --store <store> --mode full --json
   ```

   A bare `<ref-id>` remains supported only when it identifies exactly one
   authorized pointer. If multiple stores use that id, bare expansion fails
   closed; never guess which store was intended.

5. On a later wake, request only the declared delta after the last pack cursor.
   If no cursor is available, reload the exact pack; do not reconstruct state
   from transcript memory.

`liveTaskState.activeRuns` and `liveTaskState.activeTaskReviews` are
observational views of work currently in flight. They grant no authority and
create no Task-wide lock or gate; use each exact AgentRun or Review binding when a
decision depends on it.

The pack's authority view and writable Project IDs are hard boundaries. A
native subagent inherits the parent AgentRun's refs and authority; it does not gain a
new Yui actor, AgentRun, Session, or cross-Task read permission.

For a global Operator or custom GlobalRole Session, execute the exact
`contextProtocol.loadCommand` carried by the current Session Manifest before
routing or acting. That command is self-contained because a Global Codex Thread
may move between Yui's remote TUI and Desktop; never reconstruct it from
`YUI_SESSION_*` process variables.

Global context grants no Task implementation workspace. Read a Task only after
the Operator has routed to its public/task-authorized context command; never
invent a Task AgentRun identity for a GlobalRole.

## Separate execution from real-resource validation

The current Leader and configured Worker, Reviewer, Operator, custom Role, and
native child Agents are normal execution resources. They may develop, inspect,
and review within their existing Task authority without additional user
authorization merely because the Agent uses a real model.

Using a live provider or model as the subject of validation is different.
Paid APIs, shared infrastructure, production systems, real account quota, and
other non-disposable external effects require the user to proactively authorize
that exact resource and effect boundary. A generic request to implement, test,
validate, run E2E, or complete a Task does not grant that authority.

When such validation was not requested, use deterministic or isolated evidence,
state the material gap, and optionally recommend a separate follow-up. Do not
create an InputRequest merely to solicit permission for it.

Provider acceptance, Context load, AgentRun completion, and Task completion are
separate facts. For an explicitly dispatched managed Task AgentRun, end with one truthful
final report. Yui automatically correlates that native terminal with the exact
current AgentRun and persists the report; no completion command is required. The
Leader alone decides whether the WorkItem or Task is complete.

Ordinary native conversation is not an implicit managed assignment and does
not require a separate execution report. Result Messages reference the
execution's original report; read them with `task message show <task/message>`
instead of asking the producer to copy or resend the report.

After a failed Provider Turn, read the referenced `runtime.agent-error` fact.
The failed AgentRun is immutable; a recovery is always a new AgentRun. Continue on the
same native Session when it remains recoverable, and load only the current AgentRun
delta instead of replaying its original Assignment. A new Host process does not
imply a new Session, and a new Session must never be substituted silently for
the persisted native Session id.
