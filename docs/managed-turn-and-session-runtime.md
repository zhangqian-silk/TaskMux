# Managed AgentRun and Session Runtime

The current detailed contract is [Leader Session, AgentRun and notifications](architecture/yui-handbook-full-architecture/architecture/07-session-run-contract.md).
This document keeps the established link and summarizes the same contract.

## Product decision

Task, WorkItem, Message, Decision, Artifact and Project Knowledge preserve
durable work. Session identifies the actual native conversation and captured
authority. AgentRun records an explicitly requested execution and its original
result. Host is a disposable attachment; it does not own Task truth.

Direct user conversation and ordinary Leader notifications do not implicitly
create AgentRuns. A valid Leader Session can read current Context and preserve
requirements without an active Run or a self-wake. Explicitly dispatched
Workers, Reviewers and Leader executions load their exact Run Context Pack.

## Execution path

Read facts, prepare the fixed Session, submit the intended input, and observe
its exact receipt and terminal. Session existence, input acceptance, native
activity, Run result and Task acceptance are distinct facts.

Busy with proven non-acceptance preserves the input and permits another
transport attempt on the same Session. Accepted input is never repeated.
Transport-only submission is not native acceptance. Unknown submission remains
fenced and observable; it does not revoke unrelated Leader management actions.
Definitive rejection terminalizes the corresponding execution.

Ordinary notifications claim a fixed mailbox batch and settle it at confirmed
acceptance, without requiring a final prose report. Later messages remain
pending. No periodic force-steer interrupts the user's conversation.

## Owner-directed collaboration

Dispatch establishes an owner and frozen Assignment. Thereafter
`task message send <task> <body> --to <role> --work-item <id>` (or
`--review-round <id>`) preserves collaboration for that exact owner. The
`message.send` capability invokes the same authenticated transaction. The
Message carries a logical recipient and the original owner Run reference;
its continuation Run is delivery evidence, not another Message or a result copy.

Busy input remains saved. The Controller reserves at most sixteen ordered
Messages in one transaction with the next AgentRun, then uses the ordinary
Provider admission path. Terminal collection checks pending Messages in its
existing result transaction, so both sides of the send/terminal race are covered.
No Message means no continuation. The same compatible native Session,
worktree (including unfinished files), effective permissions and frozen
Assignment are retained. The bounded Snapshot adds authorized Message refs
and the preceding original result, without expanding workspace or candidate
authority. Reading it is not an acknowledgement.

Changed ownership, unavailable compatible Sessions, terminal WorkItems/Tasks
and obsolete Review candidates produce visible nondelivery reasons. Pending
Messages may be handed to an already-dispatched successor for the same work
only through explicit `task message handoff <task/message> --to <role>`.
Replicated Assignment continuations remain an explicit Lane/Group operation;
a Message does not silently choose or rewrite a Producer or synthesis lineage.

Unknown Leader notifications retain their exact unconsumed wake, input window
and delivery event. `task wake show` includes delivery/resolution facts even
when they occur after that input window. `task wake resolve <task> <wake>
--reason <quiescence-evidence>` releases only that claim, without replay or
invented acceptance, after the existing native execution fences are clear.
Unknown or active native effects still prevent conflicting admission; they do
not prevent scoped local facts or independent Role work. This is an explicit
Agent/Operator operation, not an automatic recovery worker.

## Results and recovery

The runtime stores one AgentRunResult and a reference Message in the existing
terminal transaction. `task message show <task/message>` expands the original
report. Review and Candidate reference the result; Core does not parse prose
into an acceptance verdict.

Native user input with a reliable item identity may be retained as provider
observation. A new native Turn does not complete another request sharing its
Session. Message UUIDs are not invented nativeTurnIds. Local stream correlation
is used only where the serialized provider transport proves it.

A cancellation request is not physical quiescence. Exact terminal evidence
settles only its original execution and preserves partial output. Host exit,
idle UI and unrelated native results are not substitutes for that evidence.
The Agent chooses recovery; Yui does not start a rescue worker or choose a new
model automatically.

## Session authority and compatibility

Session identity is checked against the current Role binding and revocation
facts. Captured planning authority does not become delivery authority when the
Task activates. Actual workspace conflicts remain enforced at their resource
boundary. These are local control-plane guarantees, not an OS sandbox against
another process with the same user's filesystem access.

AgentRun is the current API vocabulary. Historical IDs and provider-native
terms remain opaque. The private inbox v1 codec retains pending wire facts;
the CLI's old `task turn` spelling is a bounded alias for existing Manifests.
There is one current domain schema, migrated centrally from storage 9 to 10.
Optional Message ownership/continuation/handover fields belong to that same
unreleased transition. Existing Messages remain unchanged and never acquire
guessed recipients or automatic executions during migration.
See the detailed contract for migration, Host protocol v5, rollback and the
T07/T08/T09 adoption boundary.

## Inspection

```sh
yui task context <task> --json
yui task run list <task>
yui task run show <task/run> --json
yui task message show <task/message>
yui task role session inspect <task> <role>
```

`task execution start/stop` continues to control Task-level admission, not one
AgentRun. Archive remains a separate authorized action after work and resource
ownership are settled.
