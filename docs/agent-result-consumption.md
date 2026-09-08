# Agent Result Consumption

Status: implemented contract
Date: 2026-09-04
Branch base: `8a29c294d66107c697a74f803b3190ab9c00e333`; the
contract is defined by the current branch head.

## Decision

Every explicitly dispatched AgentRun produces one durable original result. Ordinary
notifications and native conversation are not implicit AgentRuns. The next Agent
in the ownership chain reads that exact result and decides what it means.

`AgentRunResult.output` is the sole Agent-authored durable truth. Yui Core stores
it unchanged and does not parse, classify, normalize, or validate its semantic
content.

Completion creates one reference Message in the same terminal transaction.
`task message show <task/message>` expands its `resultRef` to this original result;
the Message body and ReviewRound do not store another copy.

Skills and dispatch instructions may recommend a Markdown or JSON layout to
make handoffs easier to read. That layout is not a protocol. Missing headings,
invalid JSON, omitted checks, or an imprecise conclusion are quality evidence
for the consuming Agent; they are not Core execution failures.

## Authority boundary

Yui Core owns only facts it can establish independently:

- Task, Role, AgentRun, WorkItem, ReviewRound, and ExecutionGroup identity;
- Provider and runtime lifecycle;
- exact frozen Context and Git boundaries;
- workspace ownership and write scope;
- mailbox delivery, retry fences, and terminal status;
- Core-run validation and Integration evidence.

Agents own the meaning of their prose:

- outcome and implementation sufficiency;
- review conclusion and findings;
- reported checks and residual risk;
- whether more work, another review, or acceptance is appropriate.

Core never converts Agent prose into checks, findings, severity, verdict,
delta disposition, repair topology, or acceptance.

## AgentRun result

The current contract is:

```ts
type AgentRunResult = Readonly<{
  schemaVersion: 2;
  output?: string;
  diagnostic?: string;
  completedAt: string;
  provider?: AgentRunProviderResult;
  systemEvidence?: AgentRunSystemEvidence;
  failureReason?: AgentRunFailureReason;
}>;

type AgentRunSystemEvidence = Readonly<{
  workspaceSnapshot?: ExecutionLaneGitSnapshot;
}>;
```

`output`, when present, preserves the Provider's complete non-empty Agent text,
including its outer whitespace, up to the 512 KiB durable result limit.
`diagnostic`, when present, is bounded Core-authored failure context. A
completed AgentRun requires `output` and has no failure metadata. A failed AgentRun
requires `diagnostic`; it may also retain `output` when the Agent result arrived
before a later Core-owned workspace boundary failed. Provider status and Yui
outcome remain separate: missing, empty, NUL-containing, or oversized result
text terminalizes the Yui AgentRun as `missing-result` without inventing Agent
prose. `systemEvidence` is authored and validated by Core.

A useful, optional Agent layout is:

```markdown
## Outcome

## Changes or findings

## Verification

## Risks, blockers, or uncertainty

## Recommended next action
```

Markdown, JSON, or ordinary prose are all legal.

## Terminal meaning

- `AgentRun.completed` means the Provider completed and every required Core-owned
  artifact boundary is valid.
- `AgentRun.failed` means Provider, runtime, authority, workspace, or another
  Core-owned execution boundary failed.
- Neither state means that the result is sufficient, correct, reviewed, or
  accepted.

For a writable replicated Lane, Core still requires a clean exact workspace
snapshot. A dirty workspace, wrong branch, missing durable owner, mismatched
Project set, or wrong commit fails the Lane. If the Agent result already
arrived, that exact text remains in `output` while Core records the distinct
workspace failure reason and `diagnostic`. The Agent does not need to repeat
those facts.

## Direct execution

A direct Worker or Reviewer AgentRun:

1. receives one exact frozen Context Snapshot;
2. returns one original result;
3. has Provider and Core workspace facts recorded separately;
4. emits a terminal Event containing the exact `runId`;
5. is consumed by the Leader through the exact AgentRun record.

For Review, `ReviewRound.completed` means its exact main Reviewer AgentRun
completed. It is not a machine-derived pass verdict. The Leader's later accept
or complete action is the semantic decision.

## Replicated execution

Replicated execution retains immutable Assignment, isolated Lanes, all-Lanes
settlement, minimum successful Producer count, and one main synthesis AgentRun.
One Group supports two through eight Lanes.

Each Producer returns one opaque original result. A Producer succeeds when its
Provider completes and its required Core workspace snapshot is valid. Core
does not interpret any reported outcome, check, finding, or recommendation.

The main synthesis AgentRun receives stable source references in Lane order:

```ts
type SynthesisSource = Readonly<{
  laneId: string;
  roleName: string;
  runId: string;
}>;
```

Its frozen Context Snapshot materializes a compact source-AgentRun view for every
successful Lane: exact identity, lineage, `AgentRunResult.output`, provider facts,
and Core system evidence. It does not duplicate source prompt history,
workspace descriptors, or launch configuration. Source results have a
separate bounded Context budget, so eight maximum-size results cannot consume
the ordinary 8 MiB snapshot budget. The dispatch input contains references
rather than copied or parsed Producer objects.

The main Agent reads every source result, resolves disagreement against the
frozen source, and returns one new original result. For WorkItem execution the
Leader consumes the main Worker result. For replicated Review the Leader
consumes the main Reviewer result.

## Leader delivery

Role completion Events contain the exact `runId`, not a copied summary.

A normal Leader wake records a cursor window. `yui task wake show` resolves
terminal Events in that window to the referenced AgentRun even when the AgentRun was
created before the window and completed much later. The wake points the Leader
to:

```sh
yui task run show <task>/<run>
```

A forced steer into an already active Leader AgentRun includes commands for at
most four referenced result AgentRuns and points to `task wake show` for any
remainder. In both paths the Leader reads the complete original result before
accepting, retrying, repairing, reviewing again, or waiting.

## Review and completion

ReviewRound persistence contains Core-owned identity, frozen candidate,
workspace, execution Group, exact main Reviewer AgentRun, lifecycle status, and
optional Core failure. It does not copy Agent summary, report, checks, findings,
or evidence commits.

When a Task-final ReviewRound exists, its structural completion requires:

- a completed ReviewRound over the current exact Task heads; and
- one exact completed main Reviewer AgentRun bound to that Round.

Core does not inspect the Reviewer output to decide whether it passed. The
Leader decides whether Review is useful, reads the original result when Review
was requested, and explicitly completes the Task when the outcome is
acceptable. Core does not force a ReviewRound as a Task completion gate.

A delta recheck stores only objective lineage and diff facts. The Reviewer may
state that the change is equivalent, defective, or requires a full review, but
Core does not parse that conclusion.

## Removed concepts

The current execution path has no:

- Producer-result semantic parser;
- Review-result parser or semantic classifier;
- machine-derived check or finding projection;
- finding ledger or finding-based completion gate;
- result-driven repair wave;
- `force-fresh` Review replacement path;
- Review evidence reuse based on Agent claims.

Core-owned verification evidence remains reusable only inside the exact Core
verification contract that produced it. ChangeSets do not carry Review or
GateArtifact references into the Integration queue; each queued ChangeSet runs
the checks requested for its current target.

## Storage boundary

The current storage contract contains:

- WorkItem v15;
- AgentRun v5 with AgentRunResult v2;
- ReviewRound v8.

These record-local tags are current-shape validation guards, not independent
Home compatibility axes. A storage migration that changes one of these payloads
must rewrite it to the current shape and advance the single Home storage
version. Runtime validators reject retired semantic result fields instead of
carrying dual behavior.

## Verification

The required deterministic evidence is:

- arbitrary non-empty Worker or Reviewer prose is preserved unchanged;
- missing headings, invalid JSON, or omitted reported checks do not fail a
  AgentRun;
- missing and oversized Provider results still terminalize as `missing-result`;
- dirty or mismatched writable Lane state fails without replacing an arrived
  Agent result;
- main synthesis receives every successful source AgentRun in stable Lane order;
- Review completion depends on the exact completed main AgentRun, not its wording;
- wake inspection includes a cursor-predating AgentRun referenced by a later
  terminal Event;
- old parsed-result and finding commands are absent;
- build, focused tests, and the complete Core test suite pass.

No real Provider, paid model, shared Home, or production resource is required
for runtime verification.
