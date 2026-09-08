import { randomUUID } from "node:crypto";

import { callController } from "../core/controllerClient.js";
import { builtinAgentDriverRegistry } from "../runtime/builtinAgentDrivers.js";
import { standardAgentError } from "../runtime/agentError.js";
import type { ProviderDeliveryFailure } from "../runtime/agentError.js";
import { transportAgentResult } from "../domain/agentResultTransport.js";
import {
  createRuntimeObservation,
  runtimeObservationSemanticKey,
  type RuntimeObservation,
  type RuntimeObservationKind,
  type RuntimeObservationPayload
} from "../runtime/runtimeObservation.js";
import type {
  StructuredProviderTurnReceipt,
  StructuredProviderTurnStarted,
  StructuredProviderTurnTerminal,
  StructuredProviderGoal
} from "../runtime/structuredProviderHost.js";
import { runtimeLifecycleSignalKey } from "../runtime/lifecycleReservation.js";
import { isForeignHandoverLockHeld } from "../release/runtimeRelease.js";
import { FileRuntimeEventInbox } from "./runtimeEventInbox.js";
import { resolveRuntimeHookRunFence } from "./runtimeHookRunFence.js";
import type { RuntimeHookRunFence } from "./runtimeHookRunFence.js";
import { openCurrentTaskStore } from "../storage/currentTaskStore.js";

let structuredSequence = 0;

/** An exact provider item id is evidence of visible input, not an inferred
 * human author. The original managed request is never replaced.
 */
export async function publishStructuredProviderInputObserved(input: Readonly<{
  home: string; environment: NodeJS.ProcessEnv;
  observed: import("../runtime/structuredProviderHost.js").StructuredProviderInputObserved;
}>): Promise<void> {
  const observed = input.observed;
  const adapterId = requireIdentity(input.environment.YUI_ADAPTER_ID, "Agent adapter id");
  const fence = resolveRuntimeHookRunFence(input.environment, adapterId, observed.nativeSessionId, {
    nativeTurnId: observed.nativeTurnId, terminal: true, sessionOnly: true
  });
  if (fence.runId === undefined) return; // Ordinary chat need not be mirrored.
  await persistAndApply(input.home, [observation({
    kind: "input.accepted", observedAt: observed.observedAt, sequence: nextStructuredSequence(), ordinal: 0,
    fence: { ...fence, driverId: builtinAgentDriverRegistry().requireByAdapterId(adapterId).id,
      conversationId: observed.conversationId, nativeTurnId: observed.nativeTurnId,
      receiptId: `native-input:${observed.nativeTurnId}/${observed.inputId}` },
    payload: { input: observed.input }
  })], fence.taskId, fence.roleName);
}

export async function publishStructuredProviderStarted(input: Readonly<{
  home: string;
  environment: NodeJS.ProcessEnv;
  started: StructuredProviderTurnStarted;
}>): Promise<void> {
  if (input.started.clientOwned) return;
  const adapterId = requireIdentity(input.environment.YUI_ADAPTER_ID, "Agent adapter id");
  const driver = builtinAgentDriverRegistry().requireByAdapterId(adapterId);
  const fence = resolveRuntimeHookRunFence(
    input.environment,
    adapterId,
    input.started.nativeSessionId,
    {
      nativeTurnId: input.started.nativeTurnId,
      sessionOnly: true
    }
  );
  const receiptId = `direct:${input.started.nativeTurnId}`;
  const startedObservation = observation({
    kind: "turn.accepted",
    observedAt: input.started.observedAt,
    sequence: nextStructuredSequence(),
    ordinal: 0,
    fence: {
      taskId: fence.taskId,
      roleName: fence.roleName,
      agentId: fence.agentId,
      driverId: driver.id,
      conversationId: input.started.conversationId,
      nativeSessionId: input.started.nativeSessionId,
      nativeTurnId: input.started.nativeTurnId,
      receiptId
    },
    payload: input.started.input === undefined ? {} : { input: input.started.input }
  });
  await persistAndApply(
    input.home,
    [startedObservation],
    fence.taskId,
    fence.roleName
  );
}

export async function publishStructuredProviderAccepted(input: Readonly<{
  home: string;
  environment: NodeJS.ProcessEnv;
  receipt: StructuredProviderTurnReceipt;
}>): Promise<void> {
  const adapterId = requireIdentity(input.environment.YUI_ADAPTER_ID, "Agent adapter id");
  const driver = builtinAgentDriverRegistry().requireByAdapterId(adapterId);
  const startupSession = driver.capabilities.observation.sessionBootstrap;
  const fence = resolveRuntimeHookRunFence(
    input.environment,
    adapterId,
    input.receipt.nativeSessionId,
    {
      startupSession,
      nativeTurnId: input.receipt.nativeTurnId,
      attemptId: input.receipt.attemptId
    }
  );
  const observedAt = input.receipt.acceptedAt;
  const commonFence = {
    taskId: fence.taskId,
    roleName: fence.roleName,
    ...(fence.runId === undefined ? {} : { runId: fence.runId }),
    agentId: fence.agentId,
    driverId: driver.id,
    conversationId: input.receipt.conversationId,
    nativeSessionId: input.receipt.nativeSessionId,
    ...(input.receipt.nativeTurnId === undefined ? {} : {
      nativeTurnId: input.receipt.nativeTurnId
    }),
    // The structured Host owns the exact input attempt identity. Runtime
    // descriptor receipts name the AgentRun bootstrap and must not overwrite a
    // continuation or human-takeover AgentRun.
    receiptId: input.receipt.attemptId
  };
  const baseSequence = nextStructuredSequence();
  // Opening owns the Session lifecycle. A receipt arriving after
  // its terminal must not reopen either lifecycle as an acceptance side effect.
  const observations = [observation({
    kind: "turn.accepted",
    authority: input.receipt.acceptance === "transport" ? "transport" : "provider-structured",
    observedAt,
    sequence: baseSequence,
    ordinal: 0,
    fence: commonFence
  })];
  await persistAndApply(input.home, observations, fence.taskId, fence.roleName);
}

/** Steer settles an additional input, never the parent AgentRun's initial delivery. */
export async function publishStructuredProviderInputSettlement(input: Readonly<{
  home: string;
  environment: NodeJS.ProcessEnv;
  nativeSessionId: string;
  nativeTurnId: string;
  attemptId: string;
  boundedText: string;
  status: "accepted" | "rejected" | "unknown";
  failure?: ProviderDeliveryFailure;
}>): Promise<void> {
  const adapterId = requireIdentity(input.environment.YUI_ADAPTER_ID, "Agent adapter id");
  const driver = builtinAgentDriverRegistry().requireByAdapterId(adapterId);
  const fence = resolveRuntimeHookRunFence(input.environment, adapterId, input.nativeSessionId, {
    nativeTurnId: input.nativeTurnId,
    terminal: true
  });
  if (fence.runId === undefined) throw new Error("Steer settlement has no exact original AgentRun.");
  const entry = observation({
    kind: input.status === "accepted" ? "input.accepted"
      : input.status === "rejected" ? "input.rejected" : "input.delivery-unknown",
    observedAt: new Date().toISOString(),
    sequence: nextStructuredSequence(),
    ordinal: 0,
    fence: {
      taskId: fence.taskId,
      roleName: fence.roleName,
      runId: fence.runId,
      agentId: fence.agentId,
      driverId: driver.id,
      conversationId: input.nativeSessionId,
      nativeSessionId: input.nativeSessionId,
      nativeTurnId: input.nativeTurnId,
      receiptId: input.attemptId
    },
    payload: {
      input: input.boundedText,
      ...(input.failure === undefined ? {} : {
        failure: {
          error: standardAgentError({
            source: "host",
            phase: "turn-submit",
            message: input.failure.detail,
            raw: input.failure.raw ?? input.failure.detail,
            inputDisposition: input.status === "unknown" ? "unknown" : "not-accepted"
          })
        }
      })
    }
  });
  await persistAndApply(input.home, [entry], fence.taskId, fence.roleName);
}

export async function publishStructuredProviderOpened(input: Readonly<{
  home: string;
  environment: NodeJS.ProcessEnv;
  conversationId: string;
  nativeSessionId: string;
  recoverability: "unknown" | "recoverable";
  observedAt: string;
}>): Promise<void> {
  const adapterId = requireIdentity(input.environment.YUI_ADAPTER_ID, "Agent adapter id");
  const driver = builtinAgentDriverRegistry().requireByAdapterId(adapterId);
  const startupSession = driver.capabilities.observation.sessionBootstrap;
  const fence = resolveRuntimeHookRunFence(
    input.environment,
    adapterId,
    input.nativeSessionId,
    { startupSession }
  );
  const commonFence = {
    taskId: fence.taskId,
    roleName: fence.roleName,
    ...(fence.runId === undefined ? {} : { runId: fence.runId }),
    agentId: fence.agentId,
    driverId: driver.id,
    conversationId: input.conversationId,
    nativeSessionId: input.nativeSessionId,
    ...(fence.receiptId === undefined ? {} : { receiptId: fence.receiptId })
  };
  const sequence = nextStructuredSequence();
  const observations = [observation({
    kind: startupSession === "preallocated" ? "session.ready" : "session.started",
    observedAt: input.observedAt,
    sequence,
    ordinal: 0,
    fence: commonFence
  }), observation({
    kind: "conversation.observed",
    observedAt: input.observedAt,
    sequence,
    ordinal: 1,
    fence: commonFence,
    payload: { recoverability: input.recoverability }
  })];
  await persistAndApply(input.home, observations, fence.taskId, fence.roleName);
}

export async function publishStructuredProviderGoal(input: Readonly<{
  home: string;
  environment: NodeJS.ProcessEnv;
  conversationId: string;
  goal: StructuredProviderGoal | null;
  observedAt?: string;
}>): Promise<void> {
  const adapterId = requireIdentity(input.environment.YUI_ADAPTER_ID, "Agent adapter id");
  const driver = builtinAgentDriverRegistry().requireByAdapterId(adapterId);
  const fence = resolveRuntimeHookRunFence(
    input.environment,
    adapterId,
    input.conversationId,
    { sessionOnly: true }
  );
  const goal = input.goal;
  const observedAt = input.observedAt ?? goal?.updatedAt ?? new Date().toISOString();
  const goalObservation = observation({
    kind: goal === null ? "goal.cleared" : "goal.updated",
    observedAt,
    sequence: nextStructuredSequence(),
    ordinal: 0,
    fence: {
      taskId: fence.taskId,
      roleName: fence.roleName,
      agentId: fence.agentId,
      driverId: driver.id,
      conversationId: input.conversationId,
      nativeSessionId: input.conversationId
    },
    payload: goal === null ? {} : {
      goalStatus: goal.status,
      goalObjective: goal.objective,
      goalUpdatedAt: goal.updatedAt,
      ...(goal.nativeTurnId === undefined ? {} : { goalNativeTurnId: goal.nativeTurnId }),
      ...(goal.tokenBudget === undefined ? {} : { goalTokenBudget: goal.tokenBudget })
    }
  });
  await persistAndApply(input.home, [goalObservation], fence.taskId, fence.roleName);
}

export async function publishStructuredConversationRecoverability(input: Readonly<{
  home: string;
  environment: NodeJS.ProcessEnv;
  conversationId: string;
  recoverability: "recoverable" | "unrecoverable";
  observedAt: string;
}>): Promise<void> {
  const adapterId = requireIdentity(input.environment.YUI_ADAPTER_ID, "Agent adapter id");
  const driver = builtinAgentDriverRegistry().requireByAdapterId(adapterId);
  const fence = resolveRuntimeHookRunFence(
    input.environment,
    adapterId,
    input.conversationId,
    { sessionOnly: true }
  );
  const sequence = nextStructuredSequence();
  const observationFence = {
    taskId: fence.taskId,
    roleName: fence.roleName,
    ...(fence.runId === undefined ? {} : { runId: fence.runId }),
    agentId: fence.agentId,
    driverId: driver.id,
    conversationId: input.conversationId,
    nativeSessionId: input.conversationId,
    ...(fence.receiptId === undefined ? {} : { receiptId: fence.receiptId })
  };
  const observations: RuntimeObservation[] = [observation({
    kind: "conversation.observed",
    observedAt: input.observedAt,
    sequence,
    ordinal: 1,
    fence: observationFence,
    payload: { recoverability: input.recoverability }
  })];
  await persistAndApply(input.home, observations, fence.taskId, fence.roleName);
}

export async function publishStructuredProviderTerminal(input: Readonly<{
  home: string;
  environment: NodeJS.ProcessEnv;
  terminal: StructuredProviderTurnTerminal;
}>): Promise<void> {
  const adapterId = requireIdentity(input.environment.YUI_ADAPTER_ID, "Agent adapter id");
  const driver = builtinAgentDriverRegistry().requireByAdapterId(adapterId);
  const fence = resolveRuntimeHookRunFence(
    input.environment,
    adapterId,
    input.terminal.nativeSessionId,
    {
      terminal: true,
      nativeTurnId: input.terminal.nativeTurnId,
      attemptId: input.terminal.attemptId,
      ...(input.terminal.clientOwned ? {} : { sessionOnly: true })
    }
  );
  const kind: RuntimeObservationKind = input.terminal.status === "completed"
    ? "turn.completed"
    : input.terminal.status === "cancelled" ? "turn.cancelled" : "turn.failed";
  const transported = transportAgentResult(input.terminal.output);
  const payload: RuntimeObservationPayload = kind === "turn.completed"
    ? {
        ...(input.terminal.input === undefined ? {} : { input: input.terminal.input }),
        ...(transported.status === "completed"
          ? { output: transported.output }
          : transported.failureReason === "runtime-failed"
            ? { resultTransportDiagnostic: transported.diagnostic }
            : {})
      }
    : kind === "turn.failed"
      ? {
          failure: {
            error: standardAgentError({
              source: "provider",
              phase: "turn-execute",
              classification: driver.runtime.mapError({
                message: input.terminal.error ?? "Provider Turn failed.",
                raw: input.terminal.rawError
                  ?? input.terminal.error
                  ?? "Provider Turn failed without an error payload."
              }),
              message: input.terminal.error ?? "Provider Turn failed.",
              raw: input.terminal.rawError
                ?? input.terminal.error
                ?? "Provider Turn failed without an error payload.",
              inputDisposition: "accepted"
            })
          },
          summary: input.terminal.error ?? "Provider Turn failed.",
          ...(input.terminal.input === undefined ? {} : { input: input.terminal.input })
        }
      : {};
  const terminalObservation = observation({
    kind,
    observedAt: input.terminal.observedAt,
    sequence: nextStructuredSequence(),
    ordinal: 0,
    fence: {
      taskId: fence.taskId,
      roleName: fence.roleName,
      ...(fence.runId === undefined ? {} : { runId: fence.runId }),
      agentId: fence.agentId,
      driverId: driver.id,
      conversationId: input.terminal.conversationId,
      nativeSessionId: input.terminal.nativeSessionId,
      ...(input.terminal.nativeTurnId === undefined ? {} : {
        nativeTurnId: input.terminal.nativeTurnId
      }),
      ...(input.terminal.attemptId === undefined
        ? fence.receiptId === undefined ? {} : { receiptId: fence.receiptId }
        : { receiptId: input.terminal.attemptId })
    },
    payload: {
      ...payload,
      ...(kind !== "turn.completed" && transported.status === "completed"
        ? { output: transported.output } : {}),
      ...(input.terminal.input === undefined ? {} : { input: input.terminal.input })
    }
  });
  await persistAndApply(
    input.home,
    [terminalObservation],
    fence.taskId,
    fence.roleName
  );
}

function observation(input: Readonly<{
  kind: RuntimeObservationKind;
  observedAt: string;
  sequence: number;
  ordinal: number;
  fence: RuntimeObservation["fence"];
  payload?: RuntimeObservationPayload;
  authority?: RuntimeObservation["authority"];
}>): RuntimeObservation {
  const eventId = `agent-host-${randomUUID()}`;
  const partial = {
    eventId,
    kind: input.kind,
    fence: input.fence,
    sequence: input.sequence,
    payload: input.payload ?? {}
  };
  return createRuntimeObservation({
    schemaVersion: 4,
    eventId,
    semanticKey: runtimeObservationSemanticKey(partial),
    kind: input.kind,
    authority: input.authority ?? "provider-structured",
    receivedAt: new Date().toISOString(),
    observedAt: input.observedAt,
    sequence: input.sequence,
    ordinal: input.ordinal,
    fence: input.fence,
    payload: input.payload ?? {}
  });
}

async function signalController(home: string, taskId: string, roleName: string): Promise<void> {
  await callController(home, "scheduler.signal", {
    key: runtimeLifecycleSignalKey({ scope: "task", taskId, roleName })
  }, { timeoutMs: 100 }).catch(() => {});
}

function nextStructuredSequence(): number {
  structuredSequence = (structuredSequence + 1) % Number.MAX_SAFE_INTEGER;
  return structuredSequence;
}

function requireIdentity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

async function persistAndApply(
  home: string,
  observations: readonly RuntimeObservation[],
  taskId: string,
  roleName: string
): Promise<void> {
  const inbox = new FileRuntimeEventInbox(home);
  for (const entry of observations) inbox.enqueueObservation(entry);
  // The immutable inbox is authoritative. During a release/update handover the
  // old Controller is draining and the replacement is not ready yet; leave the
  // entries for normal inbox replay instead of turning a healthy Provider Turn
  // into a transport failure.
  if (isForeignHandoverLockHeld(home)) return;
  for (const entry of observations) {
    let result: Readonly<{ outcome?: string }>;
    try {
      result = await callController(home, "runtime.observation-apply", entry, {
        timeoutMs: 10_000
      }) as Readonly<{ outcome?: string }>;
    } catch (error) {
      // Close the race where the handover begins after the first check but
      // before this socket call. The durable entry remains pending for replay.
      if (isForeignHandoverLockHeld(home)) return;
      throw error;
    }
    // A fast Provider can accept the initial AgentRun before the scheduler call
    // that launched this Host has returned and committed `turn.pushed`. The
    // immutable inbox entry already makes that exact fenced fact durable;
    // `deferred` therefore means "retained for replay", not delivery failure.
    // The signal below schedules the replay after the transport transaction.
    if (result.outcome !== "applied" && result.outcome !== "deferred") {
      throw new Error(`Structured Provider observation was not applied: ${result.outcome ?? "unknown"}.`);
    }
  }
  await signalController(home, taskId, roleName);
}
