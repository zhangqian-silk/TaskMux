# Managed Turn and Session Runtime

Status: implemented contract

## Product decision

Yui preserves durable intent and exposes runtime facts; the responsible Agent
chooses recovery. Core does not own a Provider retry policy, replacement
counter, backoff episode, or recovery state machine.

Each question has one authority:

- Task, WorkItem, Message, Decision, result, Project Knowledge, and managed
  workspace records own durable progress.
- Turn owns one Provider execution boundary: every Provider-visible input and
  the final visible output. It does not copy hidden reasoning or tool traffic.
- Session owns one stable provider-native conversation identity. Its only
  durable lifecycle is `active` or `ended`; `endReason` distinguishes an
  explicit stop from failure.
- Host owns one disposable Yui attachment/process for a Role and workspace.
  Its physical identity is PID plus process start identity, not a Turn id.
- Provider Runtime Binding owns one immutable provider input attempt and its accepted, running,
  waiting, completed, failed, cancelled, or uncertain result.

Readiness and busy state are Host/Turn observations. They are not additional
writable Session statuses.

## Execution path

The normal path consists of independent operations:

```text
read facts
  -> start or restore the exact Session
  -> submit one new Turn
  -> observe the exact native Turn receipt and terminal result
```

Starting or restoring a Session never sends input. Submitting a Turn never
creates or silently replaces a Session. A terminal Turn is immutable; any
continuation is another Turn.

The Session is reusable across both Yui-dispatched and direct conversation.
Every input submitted through Yui has `source.type = yui`; its channel records
whether it came from a relayed user message, input response, Task/WorkItem
dispatch, ordinary Leader wake, or forced Leader wake. Input entered directly
in the Provider UI is `user/direct`. Provider-created Goal continuation is
`provider/goal-continuation`. These fields are provenance only: none of them
decides Task or WorkItem completion.

A Turn stores `inputs[]` because a running Provider Turn may receive a forced
Leader wake as a later input. Its terminal `result` stores the Provider's final
visible response unchanged and exact native identity. Missing, empty, invalid,
or oversized response text does not strand the Turn: Yui records the Provider
terminal boundary and fails the Turn as `missing-result` with a bounded
Core-owned diagnostic. Direct Provider Turns are recorded in the same history.
They do not claim a managed execution lane merely because they share the
Session.

## Task truth and Leader responsibility

Worker and Reviewer Turns produce evidence and, where applicable, update their
managed worktree. Their terminal output is stored automatically. A replicated
Producer Turn is non-authoritative evidence for its later main WorkItem or
Reviewer synthesis Turn. Producer terminal never creates a Candidate, Review
result, or acceptance decision, and Turn terminal alone never means that
the WorkItem, Review, or Task is accepted or complete.

The Leader is the only semantic authority that integrates accepted code and
updates WorkItem or Task truth. This also covers Leader-owned execution: the
Leader may perform the work itself in the Task worktree and update the durable
facts before ending its own Turn. A Leader Turn does not self-wake when it ends.

Terminal Worker/Reviewer Turns and other material non-Leader events enter the
Leader wake batch. The first event opens a one-minute aggregation window; new
events join the same window without resetting it. If the Leader is still in an
active Turn after that minute, the batch waits. At ten minutes from the first
event, Yui steers one forced input into that exact active Leader Turn. The input
lists the aggregate, states that it waited ten minutes, includes up to four
exact result-Turn read commands, points to the Wake record for any remainder,
and instructs the Leader to handle the events before resuming its interrupted
work.

Native child continuation reports follow the same ownership boundary. While
their parent Yui Turn is active, `continuation.reported` and
`continuation.settled` are persisted without waking a supervisor because the
parent still owns the result. If the parent Turn is already terminal or absent,
the result is routed once from the original Role to its supervisor and then
uses the ordinary Leader/Operator mailbox aggregation window. A Reviewer
result still completes through the normal Review terminal path rather than a
parallel continuation-specific review path.

## Session Goal

Goal is explicit Session-scoped Provider state and may span multiple Turns. It
is never inferred from a quiet period. Codex exposes the thread Goal API and
Goal notifications; Claude exposes `active_goal`. While a non-Leader Session
Goal is active, an individual Turn terminal is recorded but does not yet wake
the Leader because the Session-level intent is still running. Goal completion,
pause, block, limit, or clear emits the material event that wakes the Leader.
The Leader still decides whether durable Task or WorkItem facts change.

No `yield` command participates in this contract. Agent-to-Agent delivery is
the stored Turn result plus durable wake/event references; the absence of a
special command cannot redefine whether the Provider Turn ended.

Native Session id is the continuity and caller identity. A later Turn can reuse
the same Host and Session; a new Host or direct Desktop interaction can resume
the same Session without changing its authority. Turn ids identify units of
work, not launches. Yui has no Agent launch generation or durable launch
reservation; the Controller serializes concurrent launches for one Role locally.

This does not remove the implementation `generation` used by the Kernel
InstanceHost and CapabilityRegistry. That identity selects code/configuration,
not an Agent launch or caller credential. It follows the architecture handbook's
call/Session implementation boundary.

Execution evidence remains exact without a launch identity: a native Session
and input `attemptId` identify a submission, with `nativeTurnId` only when the
Provider supplies it. Late results belong to the original Turn, not the current
active Turn. Detaching a Host does not settle accepted or unknown input. A busy
Host preserves the pending request; it is not a failed execution or permission
to resend an input whose outcome is unknown.

The capability bridge, CLI, and Job entry points all use the current native
Session binding. Reconnecting does not rotate a Host credential; replacing the
Session or withdrawing actual authorization prevents new controlled actions.
The handbook's T01/T02 evidence records describe their historical caller-key
checks, not this development tree's current authentication contract.

Concrete Host processes are recorded by PID plus process start identity, with
Task/Role/Session attribution. A stop targets recorded Host roots, not all
applications the Agent ever started. Historical directories and child processes
are resource facts for the Agent to inspect and explicitly retain or remove.
Host failure or missing launch acknowledgement preserves these resources.

Only
facts that make continuation impossible end a Session: no recoverable native
Session, a different Agent or adapter, or a different physical workspace.
Desired launch configuration such as model, effort, permission, Role context,
Skills, or declared write scope shapes the next activation instead, exactly as a
user editing that configuration would keep typing in the Session they already
have. Turn-scoped facts—ReviewRound identity, candidate commits, workspace base
commits, desired-revision bookkeeping—never affect activation reuse.

Because a live Session keeps the configuration it started with, the divergence
is reported where the configuration changes: `config role update`, `task role
update`, and `config agent update` refuse once with the affected Session's facts
and require `--yes` to record the change and keep that Session. Stopping the
Session remains the way to apply the change immediately. Runtime status shows the
Session's launch revision next to the desired revision, so the pending
divergence stays visible until the next activation.

The same rule governs a Session's own entry point. A managed Session invokes Yui
through the wrapper its Manifest names, because a Provider command runner may
rebuild `PATH` and a bare `yui` could resolve to another install or Home. That
wrapper carries only the resolved entry point, never a package or build identity:
version identity changes on every release while a Session legitimately outlives
it. A compatible update retargets those wrappers to the activated install, and an
ordinary Agent command is authorized by the compatible continuity contract plus
the native Session id bound to its current Role.

No launch-time snapshot exists to gate a later command. One
question has one authority: whether a command may run at all is proven against
the current CLI, Home, and Controller; which Session and Role it speaks for is
proven by the Session Manifest and current native Session binding; what is currently
true comes from durable Task, Role, and Turn records. Yui's own internal
callbacks are trusted because they run inside the Host process Yui started. A
Task's final-review contract likewise promises exactly what it says — this Task's
final review belongs to this Reviewer Role — and never records the runtime that
established it. A Session therefore stays fully usable
across an ordinary upgrade — including the callbacks that report its Turn
terminals — while a real disagreement between CLI and Home still fails closed.
An Agent never needs to know which package version or storage version its Home
is on.

Before sending input through a reused Agent Host, Yui checks the native Session
and whether the Host can accept input. Busy or invalid acknowledgements return
a diagnosis without destroying the Host. The Agent decides whether to inspect,
retry or explicitly stop it. Session identity is a local authority contract,
not an authentication secret against another process with the same Home access.

The stable attempt id and Provider Turn fence prevent duplicate input. A
`delivery-unknown` input is not replayed automatically because it may already
exist at the provider. A provider-proven `busy` result is safe to try later
because the requested Turn was not created.

## Standard Agent errors

Every Agent-facing failure becomes one `runtime.agent-error` fact with:

- source and phase;
- provider-neutral category and stable code;
- whether the input was accepted;
- whether the Session is recoverable;
- human-readable message and optional retry-after hint; and
- the complete serialized original exception or provider payload.

Categories are `availability`, `rate-limit`, `transport`, `access`,
`invalid-request`, `context`, `session`, `runtime`, `conflict`, `cancelled`,
and the required fallback `unknown`.

Codex, Claude, and future Drivers recognize their own native failures at the
edge. Core persists and routes the resulting facts; it does not turn a category
into a mandatory action.

## Agent-directed recovery

The ordinary choices are deliberately small:

| Facts | Useful Agent action |
| --- | --- |
| An accepted Turn fails with availability, `429`, capacity, or a recoverable transport error; Session remains usable | Keep the Session, restore the same native id if necessary, and submit a new Turn |
| A known Host process is gone; Session remains recoverable | Start a Host and restore the same native Session id; no launch identity needs retirement |
| Session preparation otherwise fails, or the Driver rejects input before acceptance | The exact Turn fails once; inspect the error, then explicitly retry the failed Turn if another attempt is useful |
| Another native Turn is active | Observe or wait; retain pending delivery |
| Input delivery is unknown | Inspect native history; do not blindly replay |
| Driver proves Session missing, ended, expired, or unusable | Settle the exact Turn, stop that Role Session/Host, then create the next Turn on a new Session |
| Error is unclassified | Read the complete raw error and current facts, then choose explicitly |

The read and stop primitives are:

```sh
yui task event show <task> <agent-error-event>
yui task role session inspect <task> <role>
yui task role session stop <task> <role> --reason "<decision>"
```

Core never redelivers an input that was not accepted merely because a periodic
scheduler pass runs again. A Session preparation failure or explicit Turn
rejection terminalizes the exact Turn and routes the error to the responsible
Agent. For a continuation on an already accepted Turn, the exact unaccepted
error fact itself fences further scheduler attempts for that Turn. This makes
recovery a visible Agent action instead of an implicit launch loop, without a
second writable recovery status. A `delivery-unknown` Turn remains fenced until
native history resolves whether the provider accepted it.

An idle `session stop` terminates the recorded Role Host processes and marks
that Session ended. It requires the Agent to settle or retire an active Turn
first. The next explicit Turn dispatch then starts a new Session. Its Context
Pack includes the prior error event, so the receiving Agent can see the old
Agent/adapter, Turn, native Session and Provider Turn identities, and
complete raw failure without transcript reconstruction.

There is no fixed number of allowed replacements. Leader or Operator reads the
recent error history and decides whether another fresh Session has positive
value. Repeated fresh-Session failures should be summarized to the user with
the observed evidence and bounded options, not hidden behind an automatic
replacement loop.

## Task completion and fallback

Task completion remains semantic. Runtime identities are retained as audit
evidence and physical resources are cleaned independently.

The global operational fallback is still:

```sh
yui task execution stop <task> --force --reason <text>
yui task execution start <task>
```

This fences the whole Task and is appropriate only when Role-local atomic
recovery cannot establish a trustworthy physical owner. It preserves durable
Task progress and does not attempt to repair or replay a provider transcript.
