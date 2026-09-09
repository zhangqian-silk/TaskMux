import type { TaskEvent } from "../event/taskEvent.js";
import type { AgentRun } from "../agentRun/agentRun.js";
import {
  isRoleRunStalled,
  latestStallProgressAt
} from "../scheduler/roleRunStall.js";
import {
  validateRuntimeProcessExitObservation,
  type RuntimeProcessExitObservation
} from "../runtime/processExitObservation.js";
import {
  runtimeObservationFromTaskEvent,
  type RuntimeObservation
} from "../runtime/runtimeObservation.js";
import {
  projectRuntimeTaskEvents,
  type RuntimeProjection
} from "../runtime/runtimeProjection.js";
import {
  DEFAULT_RUNTIME_HEALTH_POLICY,
  type RuntimeHealthPolicy
} from "../runtime/runtimeHealthPolicy.js";
import { runOwnsBlockingProviderContinuation } from "../runtime/runtimeContinuationProjection.js";
import type {
  ExecutionGroup,
  ExecutionLane
} from "./workItemExecution.js";

export type ExecutionLaneRuntimeHealth =
  | "active"
  | "silent"
  | "suspected-stalled"
  | "confirmed-dead";

export type ExecutionLaneRecovery =
  | "none"
  | "inspect"
  | "retry-new-turn"
  | "reuse-result";

export type ExecutionLaneProjectedStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "needs-attention"
  | "failed"
  | "unknown";

export type ExecutionLaneHealthProjection = Readonly<{
  laneId: string;
  runtimeHealth?: ExecutionLaneRuntimeHealth;
  recovery: ExecutionLaneRecovery;
  resultReusable: boolean;
  reason: string;
  evidence: readonly string[];
}>;

export type ExecutionGroupHealthProjection = Readonly<{
  groupId: string;
  lanes: readonly ExecutionLaneHealthProjection[];
  activeLaneCount: number;
  silentLaneCount: number;
  suspectedStalledLaneCount: number;
  confirmedDeadLaneCount: number;
  reusableLaneIds: readonly string[];
  retryableLaneIds: readonly string[];
}>;

export type ExecutionGroupHealthSummary = Readonly<{
  groupId: string;
  purpose: "execution" | "review";
  kind: "replicated";
  laneCount: number;
  activeLaneCount: number;
  terminalLaneCount: number;
  succeededLaneCount: number;
  failedLaneCount: number;
  laneSummaries: readonly Readonly<{
    laneId: string;
    roleName: string;
    ordinal: number;
    runId?: string;
    successfulRunId?: string;
    status: ExecutionLaneProjectedStatus;
    effective?: ExecutionLane["effective"];
  } & ExecutionLaneHealthProjection>[];
  health: Omit<ExecutionGroupHealthProjection, "groupId" | "lanes">;
}>;

export type ActionableExecutionLaneRecovery = Readonly<{
  groupId: string;
  laneId: string;
  runId?: string;
  runtimeHealth?: ExecutionLaneRuntimeHealth;
  recovery: "retry-new-turn";
}>;

export type ExecutionHealthRun = Pick<
  AgentRun,
  | "id"
  | "taskId"
  | "roleName"
  | "purpose"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "workItemId"
  | "reviewRoundId"
  | "executionGroupId"
  | "executionLaneId"
> & Readonly<{
  effective: Readonly<{ agentId: string; adapterId: string }>;
}>;

export type ExecutionHealthSession = Readonly<{
  roleName: string;
  agentId: string;
  adapterId: string;
  status?: string;
  nativeSessionId?: string;
}>;

export type ExecutionGroupHealthInput = Readonly<{
  group: ExecutionGroup;
  runs: readonly ExecutionHealthRun[];
  sessions: readonly ExecutionHealthSession[];
  events: readonly TaskEvent[];
  now: Date;
  policy?: RuntimeHealthPolicy;
}>;

export function projectExecutionGroupHealth(
  input: ExecutionGroupHealthInput
): ExecutionGroupHealthProjection {
  const policy = input.policy ?? DEFAULT_RUNTIME_HEALTH_POLICY;
  const lanes = input.group.lanes.map((lane) => projectExecutionLaneHealth(
    lane,
    input,
    policy
  ));
  return Object.freeze({
    groupId: input.group.id,
    lanes,
    activeLaneCount: countHealth(lanes, "active"),
    silentLaneCount: countHealth(lanes, "silent"),
    suspectedStalledLaneCount: countHealth(lanes, "suspected-stalled"),
    confirmedDeadLaneCount: countHealth(lanes, "confirmed-dead"),
    reusableLaneIds: lanes.filter(({ resultReusable }) => resultReusable).map(({ laneId }) => laneId),
    retryableLaneIds: lanes.filter(({ recovery }) => recovery === "retry-new-turn").map(({ laneId }) => laneId)
  });
}

export function summarizeExecutionGroupHealth(
  input: ExecutionGroupHealthInput
): ExecutionGroupHealthSummary {
  const health = projectExecutionGroupHealth(input);
  const healthByLane = new Map(health.lanes.map((lane) => [lane.laneId, lane]));
  const laneSummaries = input.group.lanes.map((lane) => {
    const projected = healthByLane.get(lane.id)!;
    const run = exactLaneRun(input, lane);
    return Object.freeze({
      roleName: lane.roleName,
      ordinal: lane.ordinal,
      ...(lane.currentRunId === undefined ? {} : { runId: lane.currentRunId }),
      ...(lane.successfulRunId === undefined
        ? {}
        : { successfulRunId: lane.successfulRunId }),
      status: projectedStatus(lane, run),
      ...(lane.effective === undefined ? {} : { effective: lane.effective }),
      ...projected
    });
  });
  return Object.freeze({
    groupId: input.group.id,
    purpose: "reviewRoundId" in input.group.assignment ? "review" : "execution",
    kind: "replicated",
    laneCount: input.group.lanes.length,
    activeLaneCount: laneSummaries.filter(({ status }) => status === "running").length,
    terminalLaneCount: input.group.lanes.filter(({ disposition }) => disposition !== "open").length,
    succeededLaneCount: input.group.lanes.filter(({ disposition }) => disposition === "succeeded").length,
    failedLaneCount: input.group.lanes.filter(({ disposition }) => disposition === "failed").length,
    laneSummaries,
    health: Object.freeze({
      activeLaneCount: health.activeLaneCount,
      silentLaneCount: health.silentLaneCount,
      suspectedStalledLaneCount: health.suspectedStalledLaneCount,
      confirmedDeadLaneCount: health.confirmedDeadLaneCount,
      reusableLaneIds: health.reusableLaneIds,
      retryableLaneIds: health.retryableLaneIds
    })
  });
}

export function actionableExecutionLaneRecoveries(
  groups: readonly ExecutionGroupHealthSummary[]
): ActionableExecutionLaneRecovery[] {
  return groups.flatMap((group) => group.laneSummaries.flatMap(
    (lane): ActionableExecutionLaneRecovery[] => lane.recovery !== "retry-new-turn"
      ? []
      : [{
          groupId: group.groupId,
          laneId: lane.laneId,
          ...(lane.runId === undefined ? {} : { runId: lane.runId }),
          ...(lane.runtimeHealth === undefined ? {} : { runtimeHealth: lane.runtimeHealth }),
          recovery: "retry-new-turn"
        }]
  ));
}

function projectExecutionLaneHealth(
  lane: ExecutionLane,
  input: ExecutionGroupHealthInput,
  policy: RuntimeHealthPolicy
): ExecutionLaneHealthProjection {
  const run = exactLaneRun(input, lane);
  const continuationAgentId = run?.effective.agentId ?? lane.effective?.agentId;
  if (lane.disposition === "open"
    && lane.currentRunId !== undefined
    && continuationAgentId !== undefined
    && runOwnsBlockingProviderContinuation(input.events, {
      taskId: input.group.taskId,
      roleName: lane.roleName,
      runId: lane.currentRunId,
      agentId: continuationAgentId
    })) {
    return projection(lane, {
      runtimeHealth: "active",
      recovery: "none",
      resultReusable: false,
      reason: "the exact AgentRun still owns an unsettled Provider continuation writer",
      evidence: ["runtime-continuation-writer-owned"]
    });
  }
  if (lane.disposition === "succeeded") {
    return projection(lane, {
      recovery: "reuse-result",
      resultReusable: true,
      reason: "the successful Producer result is durable and immutable",
      evidence: ["execution-lane-success"]
    });
  }
  if (lane.disposition === "failed") {
    return projection(lane, {
      runtimeHealth: "confirmed-dead",
      recovery: "none",
      resultReusable: false,
      reason: "the logical Producer Lane was explicitly settled as failed",
      evidence: ["execution-lane-settled-failure"]
    });
  }
  if (lane.currentRunId === undefined) {
    return projection(lane, {
      recovery: "none",
      resultReusable: false,
      reason: "the Producer Lane has not been dispatched",
      evidence: []
    });
  }
  if (run === undefined) {
    return projection(lane, {
      runtimeHealth: "suspected-stalled",
      recovery: "inspect",
      resultReusable: false,
      reason: "the open Lane has no exact current AgentRun",
      evidence: ["execution-lineage-missing"]
    });
  }
  if (run.status === "failed") {
    return projection(lane, {
      runtimeHealth: "confirmed-dead",
      recovery: "retry-new-turn",
      resultReusable: false,
      reason: "the exact current AgentRun is durably failed",
      evidence: ["turn-terminal-failure"]
    });
  }
  if (run.status === "completed") {
    return projection(lane, {
      runtimeHealth: "suspected-stalled",
      recovery: "inspect",
      resultReusable: false,
      reason: "the current AgentRun completed without settling its logical Lane",
      evidence: ["execution-lineage-inconsistent"]
    });
  }
  const session = input.sessions.find((candidate) => (
    candidate.roleName === run.roleName
    && candidate.agentId === run.effective.agentId
    && candidate.adapterId === run.effective.adapterId
  ));
  const observations = exactRunObservations(input.events, run, session);
  const runtime = runtimeProjection(observations, input.events, run);
  const unsettledContinuation = runtime !== null
    && Object.values(runtime.continuations).some((continuation) => (
      continuation.execution === "active"
      || continuation.execution === "unknown"
      || continuation.identityConflict
    ));
  const unsettledChildWork = runtime !== null
    && (Object.values(runtime.operations).some(({ kind }) => kind === "subagent")
      || unsettledContinuation);
  if (observations.some((observation) => (
    observation.kind === "turn.failed"
    && observation.payload.failure?.runTerminal === true
  )) && !unsettledChildWork) {
    return projection(lane, {
      runtimeHealth: "confirmed-dead",
      recovery: "inspect",
      resultReusable: false,
      reason: "the Provider reported an exact AgentRun-terminal failure",
      evidence: ["provider-turn-terminal"]
    });
  }

  const runtimeTerminalEvidence = runtime === null
    ? []
    : [
        ...(runtime.host === "exited" ? ["runtime-host-exited"] : []),
        ...(runtime.session === "ended" || runtime.session === "failed"
          ? [`runtime-session-${runtime.session}`]
          : [])
      ];
  if (runtimeTerminalEvidence.length > 0 && !unsettledChildWork) {
    return projection(lane, {
      runtimeHealth: "confirmed-dead",
      recovery: "inspect",
      resultReusable: false,
      reason: "the exact runtime host or Session is terminal and no unsettled child work remains",
      evidence: runtimeTerminalEvidence
    });
  }

  const exit = latestExactProcessExit(input.events, run, session);
  if (session?.status === "ended"
    && exit !== null
    && isAbnormalExit(exit.classification)
    && !unsettledChildWork) {
    return projection(lane, {
      runtimeHealth: "confirmed-dead",
      recovery: "inspect",
      resultReusable: false,
      reason: "the exact Session and abnormal process exit independently confirm death",
      evidence: ["native-session-terminal", `process-exit:${exit.classification}`]
    });
  }

  if (isRoleRunStalled(input.events, run.id)) {
    return projection(lane, {
      runtimeHealth: "suspected-stalled",
      recovery: "inspect",
      resultReusable: false,
      reason: `the durable progress clock has not advanced since ${
        latestStallProgressAt(input.events, run.id) ?? run.updatedAt
      }; no death proof exists`,
      evidence: ["turn-stalled"]
    });
  }

  const activeOperation = runtime !== null
    && (Object.keys(runtime.operations).length > 0 || unsettledContinuation);
  const lastActivityAt = runtime?.lastRuntimeActivityAt
    ?? run.updatedAt
    ?? run.createdAt;
  const recentActivity = input.now.getTime() - Date.parse(lastActivityAt) < policy.quietAfterMs;
  if (activeOperation || recentActivity) {
    return projection(lane, {
      runtimeHealth: "active",
      recovery: "none",
      resultReusable: false,
      reason: unsettledContinuation
        ? "the exact runtime reports unsettled continuation work"
        : activeOperation
          ? "the exact runtime reports an active operation"
          : "the exact AgentRun has recent structured runtime activity",
      evidence: unsettledContinuation
        ? ["runtime-continuation-unsettled"]
        : activeOperation
          ? ["runtime-operation-active"]
          : ["runtime-activity-recent"]
    });
  }
  return projection(lane, {
    runtimeHealth: "silent",
    recovery: "none",
    resultReusable: false,
    reason: "the exact AgentRun remains active without recent structured activity; silence alone is not death",
    evidence: ["turn-active"]
  });
}

function exactLaneRun(
  input: ExecutionGroupHealthInput,
  lane: ExecutionLane
): ExecutionHealthRun | undefined {
  return lane.currentRunId === undefined
    ? undefined
    : input.runs.find((run) => (
        run.taskId === input.group.taskId
        && run.id === lane.currentRunId
        && run.executionGroupId === input.group.id
        && run.executionLaneId === lane.id
        && run.roleName === lane.roleName
      ));
}

function exactRunObservations(
  events: readonly TaskEvent[],
  run: ExecutionHealthRun,
  session: ExecutionHealthSession | undefined
): RuntimeObservation[] {
  return events.map(runtimeObservationFromTaskEvent)
    .filter((observation): observation is RuntimeObservation => (
      observation !== null && observation.fence.taskId === run.taskId && observation.fence.runId === run.id && observation.fence.roleName === run.roleName && observation.fence.agentId === run.effective.agentId && (session?.nativeSessionId === undefined || observation.fence.nativeSessionId === session.nativeSessionId)
    ));
}

function runtimeProjection(
  observations: readonly RuntimeObservation[],
  events: readonly TaskEvent[],
  run: ExecutionHealthRun
): RuntimeProjection | null {
  const first = observations[0];
  return first === undefined
    ? null
    : projectRuntimeTaskEvents(first.fence, run.createdAt, events);
}

type ExactProcessExit = Readonly<{
  observation: RuntimeProcessExitObservation;
  classification: string;
}>;

function latestExactProcessExit(
  events: readonly TaskEvent[],
  run: ExecutionHealthRun,
  session: ExecutionHealthSession | undefined
): ExactProcessExit | null {
  const matching = events.flatMap((event): ExactProcessExit[] => {
    if (event.type !== "runtime.process-exit-observed") return [];
    try {
      const observation = validateRuntimeProcessExitObservation(
        JSON.parse(event.payload.observation ?? "") as RuntimeProcessExitObservation
      );
      if (observation.taskId !== run.taskId || observation.runId !== run.id || observation.roleName !== run.roleName || (session?.nativeSessionId !== undefined && observation.nativeSessionId !== session.nativeSessionId)) return [];
      return [{
        observation,
        classification: event.payload.classification ?? "unknown"
      }];
    } catch {
      return [];
    }
  });
  return matching.sort((left, right) => (
    Date.parse(right.observation.observedAt) - Date.parse(left.observation.observedAt)
  ))[0] ?? null;
}

function isAbnormalExit(classification: string): boolean {
  return classification === "host-abnormal" || classification === "provider-turn-failed";
}

function projectedStatus(
  lane: ExecutionLane,
  run: ExecutionHealthRun | undefined
): ExecutionLaneProjectedStatus {
  if (lane.disposition === "succeeded") return "succeeded";
  if (lane.disposition === "failed") return "failed";
  if (lane.currentRunId === undefined) return "pending";
  if (run === undefined) return "unknown";
  if (run.status === "active") return "running";
  if (run.status === "failed") return "needs-attention";
  return "unknown";
}

function projection(
  lane: ExecutionLane,
  fields: Omit<ExecutionLaneHealthProjection, "laneId">
): ExecutionLaneHealthProjection {
  return Object.freeze({ laneId: lane.id, ...fields });
}

function countHealth(
  lanes: readonly ExecutionLaneHealthProjection[],
  health: ExecutionLaneRuntimeHealth
): number {
  return lanes.filter(({ runtimeHealth }) => runtimeHealth === health).length;
}
