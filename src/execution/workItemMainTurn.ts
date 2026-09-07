import { isDeepStrictEqual } from "node:util";

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
import type { TaskStore } from "../storage/taskStore.js";
import { createTurn, type Turn } from "../turn/turn.js";
import {
  currentWorkItemExecutionGroup,
  type WorkItem
} from "../workItem/workItem.js";
import {
  type WorkItemExecutionGroup
} from "./workItemExecution.js";

export type WorkItemSynthesisProducer = Readonly<{
  laneId: string;
  roleName: string;
  turnId: string;
}>;

export function selectedWorkItemSynthesisProducers(
  store: Pick<TaskStore, "getTurn">,
  item: WorkItem,
  group: WorkItemExecutionGroup,
  sourceTurnIds: readonly string[]
): readonly WorkItemSynthesisProducer[] {
  if (sourceTurnIds.length === 0 || new Set(sourceTurnIds).size !== sourceTurnIds.length) {
    throw new Error("Synthesis requires explicit, distinct source Turn references.");
  }
  return sourceTurnIds.map((turnId) => {
    const turn = store.getTurn(item.taskId, turnId);
    const lane = group.lanes.find(({ id }) => id === turn?.executionLaneId);
    if (turn === null
      || lane === undefined
      || !["completed", "failed"].includes(turn.status)
      || turn.purpose !== "execution"
      || turn.workItemId !== item.id
      || turn.executionGroupId !== group.id
      || turn.executionLaneId !== lane.id
      || turn.roleName !== lane.roleName
      || turn.result === undefined) {
      throw new Error(
        `Synthesis source is not an exact terminal Producer result: ${group.id}/${turnId}.`
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
export function dispatchWorkItemSynthesis(
  store: TaskStore,
  taskId: string,
  workItemId: string,
  sourceTurnIds: readonly string[],
  now: Date
): Turn {
  const task = store.getTask(taskId);
  if (task === null || task.status !== "active" || task.executionGate.state !== "enabled") {
    throw new Error(`Task execution is not enabled: ${taskId}.`);
  }
  const item = store.getWorkItem(taskId, workItemId);
  if (item === null || item.status !== "running") {
    throw new Error(`WorkItem is not running: ${taskId}/${workItemId}.`);
  }
  const group = currentWorkItemExecutionGroup(item);
  if (group === undefined) throw new Error(`WorkItem has no ExecutionGroup: ${item.id}.`);
  const producers = selectedWorkItemSynthesisProducers(store, item, group, sourceTurnIds);
  const existing = store.listTurns(taskId).some((turn) => (
    turn.purpose === "execution"
    && turn.workItemId === item.id
    && turn.sourceExecutionGroupId === group.id
  ));
  if (existing) throw new Error(`Synthesis already exists for ${group.id}; retry its Turn explicitly.`);
  if (item.assignee === undefined) {
    throw new Error(`Replicated WorkItem has no main assignee: ${item.id}.`);
  }
  const role = store.getRole(taskId, item.assignee);
  if (role === null) throw new Error(`WorkItem main Role is missing: ${taskId}/${item.assignee}.`);
  if (store.getActiveTurn(taskId, role.name) !== null) {
    throw new Error(`WorkItem main Role already has an active Turn: ${role.name}.`);
  }
  const workspace = role.name === "leader"
    ? store.getTaskWorkspace(taskId)
    : store.getWorkItemWorkspace(taskId, item.id);
  if (workspace === null) {
    throw new Error(`WorkItem main workspace is missing: ${taskId}/${item.id}.`);
  }
  const visibleProjectIds = workspace.entries.map(({ projectId }) => projectId).sort();
  const taskProjectIds = task.projectBindings.map(({ projectId }) => projectId).sort();
  const writableProjectIds = workspace.entries
    .filter(({ access }) => access === "write")
    .map(({ projectId }) => projectId)
    .sort();
  if (!isDeepStrictEqual(visibleProjectIds, taskProjectIds)
    || !isDeepStrictEqual(writableProjectIds, [...item.writeProjectIds].sort())) {
    throw new Error(`WorkItem main workspace does not match its approved scope: ${item.id}.`);
  }
  const effective = resolveEffectiveLaunch({
    role,
    purpose: "execution",
    workspace,
    workItemWriteProjectIds: item.writeProjectIds
  });
  const snapshot = freezeTurnContextSnapshot(store, {
    taskId,
    roleName: role.name,
    purpose: "execution",
    workItemId: item.id,
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
      source: { type: "yui", channel: "workitem-dispatch" },
      directive: synthesisDirective(group, producers),
      contextSnapshotRef: contextSnapshotRef(snapshot),
      deltaRefIds: contextSnapshotDeltaRefIds(store, snapshot)
    }),
    now,
    {
      workItemId: item.id,
      sourceExecutionGroupId: group.id,
      workspace,
      effective
    }
  );
  store.saveTurn(turn);
  store.saveActiveTurn(turn);
  enqueueRoleTurnDispatch(store, {
    taskId,
    roleName: role.name,
    turnId: turn.id,
    reason: "workitem-synthesis-ready",
    occurredAt: now
  });
  store.saveEvent(taskId, createTaskEvent(
    store.nextEventId(taskId),
    taskId,
    "turn.dispatched",
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
      workItemId: item.id,
      sourceExecutionGroupId: group.id
    },
    now
  ));
  return turn;
}

function synthesisDirective(
  group: WorkItemExecutionGroup,
  producers: readonly WorkItemSynthesisProducer[]
): string {
  return [
    "Synthesize the explicitly selected Producer results in the supplied order.",
    "Expand each exact source Turn from the frozen Context Snapshot and consume its original result text plus Core-authored system evidence.",
    "Do not rerun, retry, append, or abandon any Lane. Form the final WorkItem result from these records.",
    JSON.stringify({
      schemaVersion: 1,
      sourceExecutionGroupId: group.id,
      producers
    }, null, 2)
  ].join("\n\n");
}
