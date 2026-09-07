import { enqueueRoleTurnDispatch } from "../coordination/workMailboxQueue.js";
import { createTurnInput } from "../context/turnInputContract.js";
import {
  contextSnapshotDeltaRefIds,
  freezeTurnContextSnapshot
} from "../context/turnContextPack.js";
import { contextSnapshotRef } from "../context/contextSnapshot.js";
import { roleAgentSessionResumeMode } from "../executor/agentExecutor.js";
import { resolveEffectiveLaunch } from "../executor/effectiveLaunch.js";
import { createTaskEvent } from "../event/taskEvent.js";
import {
  startReviewRound,
  type ReviewRound
} from "../review/reviewRound.js";
import type { TaskStore } from "../storage/taskStore.js";
import { createTurn, type Turn } from "../turn/turn.js";
import {
  type ReviewExecutionGroup
} from "./workItemExecution.js";

export type ReviewSynthesisProducer = Readonly<{
  laneId: string;
  roleName: string;
  turnId: string;
}>;

export function selectedReviewSynthesisProducers(
  store: Pick<TaskStore, "getTurn">,
  round: ReviewRound,
  group: ReviewExecutionGroup,
  sourceTurnIds: readonly string[]
): readonly ReviewSynthesisProducer[] {
  if (sourceTurnIds.length === 0 || new Set(sourceTurnIds).size !== sourceTurnIds.length) {
    throw new Error("Synthesis requires explicit, distinct source Turn references.");
  }
  return sourceTurnIds.map((turnId) => {
    const turn = store.getTurn(round.taskId, turnId);
    const lane = group.lanes.find(({ id }) => id === turn?.executionLaneId);
    if (turn === null
      || lane === undefined
      || !["completed", "failed"].includes(turn.status)
      || turn.purpose !== "review"
      || turn.reviewRoundId !== round.id
      || turn.executionGroupId !== group.id
      || turn.executionLaneId !== lane.id
      || turn.roleName !== lane.roleName
      || turn.result === undefined) {
      throw new Error(
        `Synthesis source is not an exact terminal Review Producer result: `
        + `${group.id}/${turnId}.`
      );
    }
    return {
      laneId: lane.id,
      roleName: lane.roleName,
      turnId: turn.id
    };
  });
}

/** Called within the caller's transaction after Task authority is checked. */
export function dispatchReviewSynthesis(
  store: TaskStore,
  taskId: string,
  reviewRoundId: string,
  sourceTurnIds: readonly string[],
  now: Date
): Turn {
  const task = store.getTask(taskId);
  if (task === null || task.status !== "active" || task.executionGate.state !== "enabled") {
    throw new Error(`Task execution is not enabled: ${taskId}.`);
  }
  const round = store.getReviewRound(taskId, reviewRoundId);
  if (round === null || round.status !== "running") {
    throw new Error(`ReviewRound is not running: ${taskId}/${reviewRoundId}.`);
  }
  const group = round.executionGroup;
  if (group === undefined) throw new Error(`ReviewRound has no ExecutionGroup: ${round.id}.`);
  const producers = selectedReviewSynthesisProducers(store, round, group, sourceTurnIds);
  const existing = store.listTurns(taskId).filter((turn) => (
    turn.purpose === "review"
    && turn.reviewRoundId === round.id
    && turn.sourceExecutionGroupId === group.id
  ));
  if (existing.length > 0 || round.reviewerTurnId !== undefined) {
    throw new Error(`Synthesis already exists for ${group.id}; retry its Turn explicitly.`);
  }
  const role = store.getRole(taskId, round.reviewerRoleName);
  if (role === null) {
    throw new Error(`Review main Role is missing: ${taskId}/${round.reviewerRoleName}.`);
  }
  if (store.getActiveTurn(taskId, role.name) !== null) {
    throw new Error(`Review main Role already has an active Turn: ${role.name}.`);
  }
  const workspace = store.getReviewRoundWorkspace(taskId, round.id);
  if (workspace === null) {
    throw new Error(`Review main workspace is missing: ${taskId}/${round.id}.`);
  }
  const effective = resolveEffectiveLaunch({
    role,
    purpose: "review",
    workspace,
    reviewRoundId: round.id,
    reviewBaseCommit: round.reviewBaseCommit
  });
  const snapshot = freezeTurnContextSnapshot(store, {
    taskId,
    roleName: role.name,
    purpose: "review",
    ...(round.workItemId === undefined ? {} : { workItemId: round.workItemId }),
    reviewRoundId: round.id,
    sourceExecutionGroupId: group.id,
    workspace
  }, now, "leader", group.assignment.contextSnapshotRef, sourceTurnIds);
  const turn = createTurn(
    store.nextTurnId(taskId),
    taskId,
    role.name,
    roleAgentSessionResumeMode(
      store.getTaskRoleSessionSet(taskId, role.name),
      effective.agentId,
      effective
    ),
    createTurnInput({
      source: {
        type: "yui",
        channel: round.workItemId === undefined ? "task-dispatch" : "workitem-dispatch"
      },
      directive: synthesisDirective(group, producers),
      contextSnapshotRef: contextSnapshotRef(snapshot),
      deltaRefIds: contextSnapshotDeltaRefIds(store, snapshot)
    }),
    now,
    {
      ...(round.workItemId === undefined ? {} : { workItemId: round.workItemId }),
      purpose: "review",
      reviewRoundId: round.id,
      sourceExecutionGroupId: group.id,
      workspace,
      effective
    }
  );
  store.saveTurn(turn);
  store.saveReviewRound(taskId, startReviewRound(round, turn.id));
  store.saveActiveTurn(turn);
  enqueueRoleTurnDispatch(store, {
    taskId,
    roleName: role.name,
    turnId: turn.id,
    reason: "review-synthesis-ready",
    occurredAt: now
  });
  store.saveEvent(taskId, createTaskEvent(
    store.nextEventId(taskId),
    taskId,
    "turn.review-dispatched",
    {
      turnId: turn.id,
      role: turn.roleName,
      purpose: turn.purpose,
      mode: turn.mode,
      agent: `${turn.effective.agentId}/${turn.effective.adapterId}`,
      effectiveRevision: String(turn.effective.sourceDesiredRevision),
      profileAccess: turn.effective.profileAccess,
      effectivePermission: turn.effective.permission.strategy,
      writeProjectIds: turn.effective.writeProjectIds.join(",") || "none",
      reviewRoundId: round.id,
      sourceExecutionGroupId: group.id
    },
    now
  ));
  return turn;
}

function synthesisDirective(
  group: ReviewExecutionGroup,
  producers: readonly ReviewSynthesisProducer[]
): string {
  return [
    "Act as the main Reviewer over the explicitly selected Producer results in the supplied order.",
    "Expand each exact source Turn from the frozen Context Snapshot and consume its original result text plus Core-authored system evidence.",
    "Resolve disagreements through review judgment against the frozen candidate. Do not rerun, retry, append, select, or abandon Lanes.",
    "Return one complete original review result for the Leader; Yui Core does not parse or validate its semantic structure.",
    JSON.stringify({
      schemaVersion: 1,
      sourceExecutionGroupId: group.id,
      producers
    }, null, 2)
  ].join("\n\n");
}
