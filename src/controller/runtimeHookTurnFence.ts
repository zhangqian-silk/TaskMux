import { openCurrentTaskStore } from "../storage/currentTaskStore.js";
import {
  hasRuntimeCleanupObligation,
  runtimeLifecycleTarget
} from "../runtime/lifecycleReservation.js";
import {
  runtimeObservationFromTaskEvent,
  type RuntimeObservation
} from "../runtime/runtimeObservation.js";
import { formatTurnReceiptId } from "../task/taskRecordReference.js";
import { currentProviderConversation, managedProviderTurnId } from "../runtime/providerRuntimeIdentity.js";
import type { TaskEvent } from "../event/taskEvent.js";

export type RuntimeHookTurnFence = Readonly<{
  taskId: string;
  roleName: string;
  agentId: string;
  turnId?: string;
  receiptId?: string;
  nativeSessionId: string;
  workspace: string;
}>;

export type RuntimeHookTurnFenceOptions = Readonly<{
  startupSession?: "preallocated" | "discovered";
  /** Terminal Hooks may arrive after the exact Turn has already completed. */
  terminal?: boolean;
  /** Stable Provider Turn identity used to recover its durable accepted Turn. */
  nativeTurnId?: string;
  /** Stable input identity used before the Provider has recorded a Turn id. */
  attemptId?: string;
  /** Session lifecycle observations remain valid while no Turn is active. */
  sessionOnly?: boolean;
  continuationId?: string;
}>;

/**
 * Resolve observations by Session and exact input identity. A startup Hook
 * may introduce a Session for an explicit new-Session Turn.
 */
export function resolveRuntimeHookTurnFence(
  environment: NodeJS.ProcessEnv,
  adapterId: string,
  payloadNativeSessionId: string,
  options: RuntimeHookTurnFenceOptions = {}
): RuntimeHookTurnFence {
  if (environment.YUI_SESSION_SCOPE !== "task") {
    throw new Error("Runtime observation Hook requires a Task session scope.");
  }
  if (environment.YUI_ADAPTER_ID !== adapterId) {
    throw new Error(`Runtime observation Hook requires the ${adapterId} adapter.`);
  }
  const home = requireIdentity(environment.YUI_HOME, "YUI_HOME");
  const taskId = requireIdentity(environment.YUI_TASK_ID, "Task id");
  const roleName = requireIdentity(environment.YUI_ROLE, "Role name");
  const agentId = requireIdentity(environment.YUI_AGENT_ID, "Agent id");
  const workspace = requireIdentity(environment.YUI_WORKSPACE, "YUI workspace");
  const nativeSessionId = requireIdentity(payloadNativeSessionId, "Provider session id");

  const store = openCurrentTaskStore(home);
  const task = store.getTask(taskId);
  if (task === null) {
    throw new Error("Runtime observation Hook Task does not accept this lifecycle boundary.");
  }
  const role = store.getRole(taskId, roleName);
  const sessions = store.getTaskRoleSessionSet(taskId, roleName);
  const session = sessions?.sessions[agentId];
  const executionSession = session?.nativeSessionId === nativeSessionId
    ? session
    : sessions?.history?.find((entry) => (
        entry.agentId === agentId && entry.nativeSessionId === nativeSessionId
      ));
  const activeTurn = store.getActiveTurn(taskId, roleName);
  const providerTurn = sessions?.providerBinding?.turn;
  const matchesProviderTurn = providerTurn !== null
    && providerTurn !== undefined
    && executionSession?.adapterId === adapterId
    && executionSession.effective.workspace.root === workspace
    && sessions?.providerBinding != null
    && currentProviderConversation(sessions.providerBinding).conversationId === nativeSessionId
    && (
      (options.attemptId !== undefined && providerTurn.attemptId === options.attemptId)
      || (options.nativeTurnId !== undefined && providerTurn.nativeTurnId === options.nativeTurnId)
    )
    && (options.attemptId === undefined || providerTurn.attemptId === options.attemptId)
    && (options.nativeTurnId === undefined || providerTurn.nativeTurnId === undefined
      || providerTurn.nativeTurnId === options.nativeTurnId);
  const acceptedTurn = acceptedTurnBinding(store.listEvents(taskId), {
    taskId, roleName, agentId, nativeSessionId,
    ...(options.nativeTurnId === undefined ? {} : { nativeTurnId: options.nativeTurnId }),
    ...(options.attemptId === undefined ? {} : { attemptId: options.attemptId })
  });
  const acceptedBinding = acceptedTurn ?? (
    options.continuationId === undefined ? null : knownContinuationBinding(
      store.listEvents(taskId),
      {
        taskId, roleName, agentId, nativeSessionId,
        continuationId: options.continuationId,
      }
    )
  );
  // Collection of an exactly accepted terminal fact is not a new action by
  // the Role. A successor's active Agent or revoked execution permission
  // cannot erase the original Turn's evidence.
  const existingExecutionObservation = (options.terminal === true || options.attemptId !== undefined)
    && (acceptedBinding !== null || matchesProviderTurn);
  if (!(task.status === "active" && task.executionGate.state === "enabled")
    && !(task.status === "completed" && options.sessionOnly === true)
    && !existingExecutionObservation) {
    throw new Error("Runtime observation Hook Task does not accept this lifecycle boundary.");
  }
  if (!existingExecutionObservation && (role === null || role.activeAgentId !== agentId
    || (sessions !== null && sessions.activeAgentId !== agentId))) {
    throw new Error("Runtime observation Hook Role or Agent is not current.");
  }
  const lifecycleMailbox = store.getWorkMailbox(runtimeLifecycleTarget({
    scope: "task",
    taskId,
    roleName
  }));
  const directProviderTurn = matchesProviderTurn && providerTurn.turnId === undefined;
  const sessionOnlyObservation = options.sessionOnly === true && activeTurn === null;
  if (acceptedBinding === null && (directProviderTurn || sessionOnlyObservation)) {
    const observedSession = directProviderTurn ? executionSession : session;
    if (observedSession === undefined
      || observedSession.adapterId !== adapterId
      || observedSession.nativeSessionId !== nativeSessionId
      || observedSession.effective.workspace.root !== workspace) {
      throw new Error("Runtime observation Hook Session does not match durable state.");
    }
    return {
      taskId,
      roleName,
      agentId,
      ...(directProviderTurn ? { receiptId: providerTurn.attemptId } : {}),
      nativeSessionId,
      workspace
    };
  }
  const inputReceiptId = matchesProviderTurn
    ? providerTurn.attemptId
    : providerTurn !== null
    && providerTurn !== undefined
    && managedProviderTurnId(providerTurn) === activeTurn?.id
    ? providerTurn.attemptId
    : activeTurn === null ? undefined : formatTurnReceiptId(taskId, activeTurn.id);
  const startupTurnId = options.startupSession === undefined ? undefined : activeTurn?.id;
  const startupIntent = startupTurnId !== undefined
    && !hasRuntimeCleanupObligation(lifecycleMailbox);
  const startupTurn = startupTurnId === undefined
    ? null
    : store.getTurn(taskId, startupTurnId);
  const replacementStartup = options.startupSession !== undefined
    && session !== undefined
    && sessions !== null
    && startupIntent
    && startupTurn?.mode === "new"
    && session.status === "ended";
  const resumedStartup = startupIntent
    && startupTurn?.mode === "resume"
    && session !== undefined
    && session.adapterId === adapterId
    && session.nativeSessionId === nativeSessionId
    && session.effective.workspace.root === workspace;
  // New Session identity is provided by the native adapter, not a launch token.
  const preallocatedStartup = options.startupSession === "preallocated"
    && (session === undefined || replacementStartup)
    && startupIntent
    && startupTurn?.mode === "new";
  const discoveredStartup = options.startupSession === "discovered"
    && (session === undefined || replacementStartup)
    && startupIntent
    && startupTurn?.mode === "new";
  const registeredTurnId = acceptedBinding === null && matchesProviderTurn
    ? managedProviderTurnId(providerTurn) ?? undefined
    : undefined;
  if (options.terminal === true && acceptedBinding === null && registeredTurnId === undefined) {
    throw new Error("Runtime observation Hook terminal has no exact accepted execution binding.");
  }
  const terminalTurn = acceptedBinding !== null
    ? store.getTurn(taskId, acceptedBinding.fence.turnId!)
    : registeredTurnId === undefined
    ? null
    : store.getTurn(taskId, registeredTurnId);
  const exactTerminal = terminalTurn !== null
    && terminalTurn.status !== "active"
    && terminalTurn.roleName === roleName
    && terminalTurn.effective.agentId === agentId
    && terminalTurn.effective.adapterId === adapterId
    && session !== undefined;
  if (activeTurn === null
    && !preallocatedStartup
    && !discoveredStartup
    && !resumedStartup
    && !exactTerminal
    && registeredTurnId === undefined
    && acceptedBinding === null) {
    throw new Error("Runtime observation Hook has no matching durable in-flight Turn.");
  }
  const turnId = acceptedBinding?.fence.turnId
    ?? registeredTurnId
    ?? activeTurn?.id
    ?? startupTurnId;
  const turn = acceptedBinding !== null || registeredTurnId !== undefined
    ? terminalTurn
    : store.getActiveTurn(taskId, roleName);
  if (turn === null
    || turn.id !== turnId
    || (acceptedBinding === null && registeredTurnId === undefined && !exactTerminal && turn.status !== "active")
    || turn.roleName !== roleName
    || turn.effective.agentId !== agentId
    || turn.effective.adapterId !== adapterId) {
    throw new Error("Runtime observation Hook Turn does not match durable active state.");
  }
  if (turn.effective.workspace.root !== workspace) {
    throw new Error("Runtime observation Hook workspace does not match the durable Turn snapshot.");
  }
  if (session !== undefined && acceptedBinding === null && !matchesProviderTurn && !replacementStartup && !resumedStartup) {
    if (session.adapterId !== adapterId
      || session.nativeSessionId !== nativeSessionId
      || session.effective.workspace.root !== workspace) {
      throw new Error("Runtime observation Hook Session does not match durable state.");
    }
  } else if (acceptedBinding === null && !matchesProviderTurn && (session === undefined || replacementStartup)) {
    if (!discoveredStartup && !preallocatedStartup) {
      throw new Error("Runtime observation Hook has no matching new-Session intent.");
    }
  }
  return {
    taskId,
    roleName,
    agentId,
    turnId,
    ...(acceptedBinding?.fence.receiptId === undefined
      ? inputReceiptId === undefined ? {} : { receiptId: inputReceiptId }
      : { receiptId: acceptedBinding.fence.receiptId }),
    nativeSessionId,
    workspace
  };
}

function knownContinuationBinding(
  events: readonly TaskEvent[],
  expected: Readonly<{
    taskId: string;
    roleName: string;
    agentId: string;
    nativeSessionId: string;
    continuationId: string;
  }>
): RuntimeObservation | null {
  const matches = events
    .map(runtimeObservationFromTaskEvent)
    .filter((observation): observation is RuntimeObservation => observation !== null
      && observation.kind.startsWith("continuation.")
      && observation.fence.taskId === expected.taskId
      && observation.fence.roleName === expected.roleName
      && observation.fence.agentId === expected.agentId
      && observation.fence.nativeSessionId === expected.nativeSessionId
      && observation.fence.continuationId === expected.continuationId
      && observation.fence.turnId !== undefined)
    .sort((left, right) => (
      left.receivedAt.localeCompare(right.receivedAt)
      || (left.sequence ?? -1) - (right.sequence ?? -1)
      || (left.ordinal ?? -1) - (right.ordinal ?? -1)
      || left.eventId.localeCompare(right.eventId)
    ));
  const binding = matches.at(-1) ?? null;
  if (binding === null) return null;
  if (matches.some((candidate) => candidate.fence.turnId !== binding.fence.turnId
    || candidate.fence.receiptId !== binding.fence.receiptId)) {
    throw new Error("Runtime observation Hook continuation has conflicting durable Turn bindings.");
  }
  return binding;
}

function acceptedTurnBinding(
  events: readonly TaskEvent[],
  expected: Readonly<{
    taskId: string;
    roleName: string;
    agentId: string;
    nativeSessionId: string;
    nativeTurnId?: string;
    attemptId?: string;
  }>
): RuntimeObservation | null {
  if (expected.nativeTurnId === undefined && expected.attemptId === undefined) return null;
  const matches = events
    .map(runtimeObservationFromTaskEvent)
    .filter((observation): observation is RuntimeObservation => observation !== null
      && ["turn.accepted", "turn.completed", "turn.failed", "turn.cancelled"].includes(observation.kind)
      && observation.fence.taskId === expected.taskId
      && observation.fence.roleName === expected.roleName
      && observation.fence.agentId === expected.agentId
      && observation.fence.nativeSessionId === expected.nativeSessionId
      && (
        (expected.attemptId !== undefined && observation.fence.receiptId === expected.attemptId)
        || (expected.nativeTurnId !== undefined && observation.fence.nativeTurnId === expected.nativeTurnId)
      )
      && observation.fence.turnId !== undefined)
    .sort((left, right) => (
      left.receivedAt.localeCompare(right.receivedAt)
      || (left.sequence ?? -1) - (right.sequence ?? -1)
      || (left.ordinal ?? -1) - (right.ordinal ?? -1)
      || left.eventId.localeCompare(right.eventId)
    ));
  const binding = matches.at(-1) ?? null;
  if (binding === null) return null;
  if (matches.some((candidate) => (
    (expected.attemptId !== undefined && candidate.fence.receiptId !== expected.attemptId)
    || (expected.nativeTurnId !== undefined && candidate.fence.nativeTurnId !== undefined
      && candidate.fence.nativeTurnId !== expected.nativeTurnId)
    || candidate.fence.turnId !== binding.fence.turnId
    || candidate.fence.receiptId !== binding.fence.receiptId))) {
    throw new Error("Runtime observation Hook native Turn has conflicting durable Turn bindings.");
  }
  return binding;
}

function requireIdentity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 1_024) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}
