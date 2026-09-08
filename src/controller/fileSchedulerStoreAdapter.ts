import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertExecutionEnvironmentCurrent } from "../runtime/executionEnvironment.js";

import type { DurableJob } from "../job/durableJob.js";
import type { MailboxEntityRef } from "../coordination/workMailbox.js";
import {
  type SchedulerTelemetry,
  type TelemetryProgressEntry
} from "../telemetry/telemetryStore.js";

import {
  activeLiveRoleAgentSession,
  bindTaskRoleProviderRuntime,
  createRoleSessionSet,
  recordRoleAgentSession,
  replaceTaskRoleAgentSession,
  recordTaskRoleTurnBoundary,
  rememberRoleAgentCompletedTurn,
  detachRoleAgentSessionHost,
  updateRoleAgentSessionStatus,
  updateTaskRoleProviderRuntime,
  type AgentSessionStatus,
  type GlobalRoleSessionSet,
  type RoleAgentSession,
  type TaskRoleSessionSet
} from "../executor/agentExecutor.js";
import {
  acceptProviderTurn,
  beginProviderTurn,
  createProviderRuntimeBinding,
  currentProviderConversation,
  managedProviderTurnId,
  clearProviderGoal,
  providerGoalContinues,
  settleProviderTurnSubmission,
  settleProviderTurn,
  transferProviderAuthority,
  supersedeProviderConversation,
  updateProviderConversationRecoverability,
  updateProviderGoal
} from "../runtime/providerRuntimeIdentity.js";
import {
  hasRecentTurnId
} from "../runtime/recentTurnIds.js";
import { createTaskEvent, type TaskEvent } from "../event/taskEvent.js";
import { operationalTaskRecords } from "../task/taskRecordRetirement.js";
import {
  buildTaskWakeEnvelope,
  type WakeEnvelope
} from "../context/wakeNotification.js";
import { createTaskWake, fallbackWakeCursor, latestTaskWake } from "../scheduler/taskWake.js";
import { answerInputRequest } from "../input/inputRequest.js";
import { activeRoleAgentBinding } from "../role/role.js";
import {
  effectiveLaunchWithTaskMainWorkspace,
  roleSessionMayContinue,
  resolveEffectiveLaunch,
  validateEffectiveLaunchSnapshot,
  type EffectiveLaunchSnapshot
} from "../executor/effectiveLaunch.js";
import { SYSTEM_OPERATOR_ROLE } from "../role/systemRoles.js";
import {
  appendTurnInput,
  createTurn,
  type Turn
} from "../turn/turn.js";
import { transportAgentResult } from "../domain/agentResultTransport.js";
import { createTurnInput } from "../context/turnInputContract.js";
import {
  classifyRuntimeProcessExit,
  validateRuntimeProcessExitObservation
} from "../runtime/processExitObservation.js";
import { terminalizeExactTaskTurn } from "../lifecycle/exactTurnTerminalization.js";
import {
  createCanonicalLifecycleEvent,
  foldCanonicalLifecycleEvent,
  type CanonicalIdentityFence,
  type CanonicalTurnExpectation
} from "../lifecycle/canonicalLifecycleEvent.js";
import type {
  ProviderLifecycleObservation
} from "./runtimeEventProcessor.js";
import type {
  DormantRuntimeOwnerCandidate,
  LeaderDispatchClaimResult,
  LeaderDispatchPersistence,
  LeaderSteerPersistence,
  RoleTurnDeliveryFailurePersistence,
  RoleTurnDeliveryPersistence,
  RoleTurnDiagnosticPersistence,
  RoleTurnProgressPersistence,
  RoleTurnStallPersistence,
  SchedulerTurnProgress,
  SchedulerRole,
  SchedulerRoleSession,
  SchedulerStorePort,
  TurnProgressFacts
} from "../scheduler/ports.js";
import { recordLeaderFailure } from "../scheduler/leaderFailure.js";
import {
  recordLeaderAttentionRequired,
  routeRoleEvent
} from "../scheduler/operatorEvent.js";
import { pendingWakeupsMatch } from "../scheduler/pendingWakeup.js";
import { queueLeaderWakeup } from "../scheduler/wakeupQueue.js";
import { wakeReason } from "../scheduler/wakeReason.js";
import {
  foldTurnProgressFacts,
  latestTurnDurableProgressAt,
  latestTurnEventTime,
  latestStallEvidenceKey,
  isRoleTurnStalled,
  TURN_PROGRESS_EVENT,
  TURN_DIAGNOSTIC_FINISHED_EVENT,
  TURN_RECOVERED_EVENT,
  TURN_STALLED_EVENT
} from "../scheduler/roleTurnStall.js";
import { pendingWakeupProjection, type TaskStore } from "../storage/taskStore.js";
import type {
  RuntimeSessionCandidate,
  RuntimeSessionCandidateQuery
} from "../runtime/runtimeSessionCandidate.js";
import { projectProviderContinuations } from "../runtime/runtimeContinuationProjection.js";
import { providerContinuationKey } from "../runtime/providerContinuation.js";
import {
  formatTurnReceiptId
} from "../task/taskRecordReference.js";
import {
  bindExecution,
  claimPending,
  completeProcessing,
  consumePendingBatch,
  mailboxHasPending,
  mailboxHasWork,
  releaseProcessing,
  type MailboxTarget,
  type WorkMailbox
} from "../coordination/workMailbox.js";
import {
  enqueueWork,
  settleRoleTurnDispatch as settleRoleTurnDispatchMailbox
} from "../coordination/workMailboxQueue.js";
import type { SchedulerMailboxClaimInput, SchedulerMailboxClaimResult } from "../scheduler/ports.js";
import {
  RUNTIME_CLEANUP_REQUIRED_REASON,
  RUNTIME_HOST_DETACH_REQUIRED_REASON,
  RUNTIME_LIFECYCLE_OWNER,
  hasRuntimeCleanupObligation,
  hasRuntimeLifecycleWork,
  isRuntimeCleanupReason,
  runtimeCleanupDisposition,
  runtimeLifecycleTarget,
  type RuntimeLifecycleTarget,
  type RuntimeRoleOwner
} from "../runtime/lifecycleReservation.js";
import {
  builtinAgentDriverRegistry
} from "../runtime/builtinAgentDrivers.js";
import type { AgentDriverRegistry } from "../runtime/agentDriver.js";
import { standardAgentError } from "../runtime/agentError.js";
import {
  RUNTIME_OBSERVATION_TASK_EVENT,
  createRuntimeObservation,
  isRuntimeTokenEvidence,
  runtimeObservationFenceMatches,
  runtimeObservationFromTaskEvent,
  runtimeObservationTurnFenceMatches,
  runtimeObservationTaskEventPayload,
  type RuntimeObservation
} from "../runtime/runtimeObservation.js";
import { contextSnapshotRef } from "../context/contextSnapshot.js";
import { snapshotExecutionLaneWorkspaceSync } from "../repository/executionLaneGitSnapshot.js";
import {
  contextSnapshotDeltaRefIds,
  freezeTurnContextSnapshot
} from "../context/turnContextPack.js";
import type { RuntimeTurnTerminalOutcome } from "./runtimeEventInbox.js";

/**
 * One durable revision's read-only facts for one Task. A scheduler pass reads
 * the same revision's large event history once per Task and folds the per-Turn
 * progress facts in a single O(events) pass; every per-Role/per-phase query is
 * then served from this bounded projection instead of re-cloning and
 * re-scanning the whole history per candidate. The projection is rebuilt as
 * soon as the durable revision advances (own commit or external writer), so it
 * is never dispatch/claim/complete authority: every mutation re-reads the
 * exact records under the storage lock/CAS.
 *
 * All seven record families the actionability digest folds (turns,
 * workItems, reviewRounds, integrationAttempts, inputRequests, durableJobs,
 * messages) are read in the same projection build, so a single digest
 * computation sees a consistent per-revision snapshot even under concurrent
 * writers (Issue 05).
 */
type TaskReadProjection = Readonly<{
  events: readonly TaskEvent[];
  turnFacts: ReadonlyMap<string, TurnProgressFacts>;
  turns: ReturnType<TaskStore["listTurns"]>;
  workItems: ReturnType<TaskStore["listWorkItems"]>;
  reviewRounds: ReturnType<TaskStore["listReviewRounds"]>;
  changeSets: ReturnType<TaskStore["listChangeSets"]>;
  integrationAttempts: ReturnType<TaskStore["listIntegrationAttempts"]>;
  inputRequests: ReturnType<TaskStore["listInputRequests"]>;
  durableJobs: ReturnType<TaskStore["listDurableJobs"]>;
  messages: ReturnType<TaskStore["listMessages"]>;
}>;

export class AgentHostProviderTurnFenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentHostProviderTurnFenceError";
  }
}

/** Maps authoritative TaskStore records to the scheduler's narrow port. */
export class FileSchedulerStoreAdapter implements SchedulerStorePort {
  /** Diagnostic telemetry is optional and never participates in runtime truth. */
  constructor(
    readonly store: TaskStore,
    private readonly telemetry: SchedulerTelemetry | null = null,
    private readonly drivers: AgentDriverRegistry = builtinAgentDriverRegistry(),
    private readonly snapshotExecutionLaneWorkspace = snapshotExecutionLaneWorkspaceSync
  ) {}

  freezeLeaderContextSnapshot(taskId: string, roleName: string, now: Date) {
    return this.store.transaction((tx) => {
      const snapshot = freezeTurnContextSnapshot(tx, {
        taskId,
        roleName,
        purpose: "execution"
      }, now);
      return Object.freeze({
        ref: contextSnapshotRef(snapshot),
        deltaRefIds: contextSnapshotDeltaRefIds(tx, snapshot)
      });
    });
  }

  /**
   * Sole provider-independent ingress for structured runtime state. Driver
   * mapping has already happened before this boundary; this method validates
   * the exact durable Turn/session fence, applies the small workflow-relevant
   * transitions, and retains the canonical observation for status projection.
   */
  observeRuntimeObservation(
    raw: RuntimeObservation,
    now = new Date()
  ): ProviderLifecycleObservation {
    const input = createRuntimeObservation(raw);
    const taskId = input.fence.taskId;
    if (taskId === undefined) return "obsolete";
    if (Date.parse(input.receivedAt) > now.getTime()) {
      return this.recordObsoleteCanonicalObservation(input, "received-at-in-future", now);
    }
    const adapterId = this.adapterForRuntimeObservation(input);
    if (adapterId === null) {
      return this.recordObsoleteCanonicalObservation(input, "driver-or-turn-mismatch", now);
    }
    if ((input.kind === "input.accepted" || input.kind === "input.rejected" || input.kind === "input.delivery-unknown")
      && input.payload.input !== undefined
      && input.fence.receiptId?.startsWith("turn-input:") === true) {
      return this.observeLeaderSteerReceipt(input, now);
    }
    // Receipt dedupe is not business-result dedupe. Terminal folds revalidate
    // their exact binding and commit result + notification + observation
    // together, including a retry after a previously interrupted fold.
    if (!isTurnTerminalObservation(input)
      && input.kind !== "turn.accepted" && input.kind !== "input.accepted"
      && hasPersistedRuntimeObservation(this.store.listEvents(taskId), input)) return "applied";
    let outcome: ProviderLifecycleObservation;
    switch (input.kind) {
      case "session.started":
      case "session.ready":
        outcome = this.observeRuntimeSession(input, adapterId, now);
        break;
      case "turn.accepted":
      case "input.accepted":
        outcome = this.observeRuntimePromptAccepted(input, adapterId, now);
        break;
      case "turn.completed":
        outcome = this.foldProviderTurnBoundary(
          input,
          adapterId,
          "completed",
          now
        );
        break;
      case "turn.failed": {
        // A Provider Turn is an activation boundary, not a Task outcome.
        // Keep the Turn and Session identity available for Agent-directed
        // restore + submit, even when a provider marks its Turn terminal.
        outcome = this.foldProviderTurnBoundary(
          input,
          adapterId,
          "failed",
          now
        );
        break;
      }
      case "operation.started":
      case "operation.completed":
      case "operation.failed":
      case "turn.waiting":
      case "activity.observed":
      case "observer.health":
      case "native-work.snapshot":
      case "continuation.started":
      case "continuation.reported":
      case "continuation.settled":
      case "input.delivery-unknown":
        outcome = this.validateCanonicalTurnObservation(input, now);
        break;
      case "turn.cancelled": {
        outcome = this.foldProviderTurnBoundary(
          input,
          adapterId,
          "cancelled",
          now
        );
        break;
      }
      case "conversation.observed":
        outcome = this.observeProviderRuntimeIdentity(input, now);
        break;
      case "goal.updated":
      case "goal.cleared":
        outcome = this.observeProviderGoal(input, now);
        break;
      case "session.ended":
      case "session.failed":
        outcome = this.validateCanonicalSessionObservation(input, now);
        break;
      case "host.observed":
        outcome = "obsolete";
        break;
      default:
        outcome = "obsolete";
    }
    if (outcome === "applied" && !isTurnTerminalObservation(input)) {
      this.persistRuntimeObservation(input, now);
    }
    return outcome;
  }

  /** A delayed steer receipt settles only its original claimed mailbox batch. */
  private observeLeaderSteerReceipt(
    input: RuntimeObservation,
    now: Date
  ): ProviderLifecycleObservation {
    return this.store.transaction((store) => {
      const taskId = input.fence.taskId!;
      const run = input.fence.turnId === undefined ? null : store.getTurn(taskId, input.fence.turnId);
      const sessions = store.getTaskRoleSessionSet(taskId, input.fence.roleName);
      const session = sessions?.sessions[input.fence.agentId];
      const binding = sessions?.providerBinding;
      if (run === null || run.roleName !== "leader" || input.fence.roleName !== "leader"
        || run.effective.agentId !== input.fence.agentId
        || session === undefined
        || session.nativeSessionId !== input.fence.nativeSessionId
        || binding?.turn?.turnId !== run.id
        || binding.turn.nativeTurnId !== input.fence.nativeTurnId) {
        recordCanonicalObservationObsolete(store, input, "steer-receipt-fence-mismatch", now);
        return "obsolete";
      }
      if (hasPersistedRuntimeObservation(store.listEvents(taskId), input)) return "applied";
      const target = { kind: "role", taskId, roleName: "leader" } as const;
      const mailbox = store.getWorkMailbox(target);
      const processing = mailbox?.processing;
      const exactBatch = processing?.owner === `leader-steer:${run.id}`
        && input.fence.receiptId === `turn-input:${taskId}/${run.id}/${processing.batchId}`;
      if (exactBatch && mailbox !== null && processing !== null && processing !== undefined) {
        if (input.kind === "input.accepted") {
          // Terminal Turns remain immutable: the canonical receipt still
          // retains their late input, without touching a successor pointer.
          if (run.status === "active" && store.getActiveTurn(taskId, "leader")?.id === run.id) {
            const updated = appendTurnInput(run, createTurnInput({
              source: { type: "yui", channel: "leader-forced-wakeup" },
              directive: input.payload.input!,
              deltaRefIds: []
            }), now);
            store.saveTurn(updated);
            store.saveActiveTurn(updated);
          }
          store.saveWorkMailbox(completeProcessing(mailbox, processing.batchId));
          store.saveEvent(taskId, createTaskEvent(store.nextEventId(taskId), taskId, "turn.input-submitted", {
            turnId: run.id,
            batchId: processing.batchId,
            attemptId: input.fence.receiptId!,
            source: "yui/leader-forced-wakeup",
            reasons: processing.batch.reasons.join(",")
          }, now));
        } else if (input.payload.failure?.error.inputDisposition === "not-accepted") {
          store.saveWorkMailbox(releaseProcessing(mailbox, processing.batchId));
        }
      }
      if (input.kind !== "input.accepted" && input.payload.failure !== undefined) {
        const error = input.payload.failure.error;
        this.recordAgentError({
          taskId, roleName: run.roleName, turnId: run.id,
          source: error.source, phase: error.phase,
          message: error.message, raw: error.raw,
          inputDisposition: error.inputDisposition,
          sessionDisposition: error.sessionDisposition,
          attemptId: input.fence.receiptId
        }, now);
      }
      this.persistRuntimeObservation(input, now);
      return "applied";
    });
  }

  private adapterForRuntimeObservation(
    input: RuntimeObservation
  ): string | null {
    const taskId = input.fence.taskId;
    const turnId = input.fence.turnId;
    if (taskId === undefined) return null;
    if (turnId === undefined) {
      const role = this.store.getRole(taskId, input.fence.roleName);
      const sessions = this.store.getTaskRoleSessionSet(taskId, input.fence.roleName);
      const session = sessions?.sessions[input.fence.agentId];
      if (role === null || sessions?.activeAgentId !== input.fence.agentId
        || session?.adapterId === undefined) return null;
      try {
        return this.drivers.requireByAdapterId(session.adapterId).id === input.fence.driverId
          ? session.adapterId
          : null;
      } catch {
        return null;
      }
    }
    const run = this.store.getTurn(taskId, turnId);
    if (run === null
      || run.roleName !== input.fence.roleName
      || run.effective.agentId !== input.fence.agentId) return null;
    try {
      return this.drivers.requireByAdapterId(run.effective.adapterId).id === input.fence.driverId
        ? run.effective.adapterId
        : null;
    } catch {
      return null;
    }
  }

  private validateCanonicalTurnObservation(
    input: RuntimeObservation,
    now: Date
  ): ProviderLifecycleObservation {
    return this.store.transaction((store) => {
      if (hasPersistedRuntimeObservation(store.listEvents(input.fence.taskId!), input)) {
        return "applied";
      }
      const run = store.getTurn(input.fence.taskId!, input.fence.turnId!);
      const active = store.getActiveTurn(input.fence.taskId!, input.fence.roleName);
      const sessions = store.getTaskRoleSessionSet(input.fence.taskId!, input.fence.roleName);
      const session = sessions?.sessions[input.fence.agentId];
      const knownContinuation = input.kind.startsWith("continuation.") && projectProviderContinuations(store.listEvents(input.fence.taskId!)).some((entry) => (
          entry.turnId === input.fence.turnId
          && entry.identity.providerNamespace === input.fence.driverId
          && entry.identity.accountScope === input.fence.agentId
          && entry.identity.conversationId === input.fence.conversationId
          && entry.identity.continuationId === input.fence.continuationId
        ));
      const requiresCurrentRuntime = input.kind !== "turn.cancelled" && !knownContinuation;
      const valid = run !== null && (!requiresCurrentRuntime || (run.status === "active" && active?.id === run.id)) && run.roleName === input.fence.roleName && run.effective.agentId === input.fence.agentId && this.drivers.requireByAdapterId(run.effective.adapterId).id === input.fence.driverId && (knownContinuation || (session !== undefined && session.nativeSessionId === input.fence.nativeSessionId)) && runtimeReceiptBelongsToTurn(store, input);
      if (!valid) {
        recordCanonicalObservationObsolete(store, input, "runtime-fence-not-current", now);
        return "obsolete";
      }
      return "applied";
    });
  }

  private foldProviderTurnBoundary(
    input: RuntimeObservation,
    adapterId: string,
    providerStatus: "completed" | "failed" | "cancelled",
    now: Date
  ): ProviderLifecycleObservation {
    const outcome = providerStatus === "completed"
      ? input.payload.resultTransportDiagnostic === undefined
        ? transportAgentResult(input.payload.output)
        : {
            status: "failed" as const,
            diagnostic: input.payload.resultTransportDiagnostic,
            failureReason: "runtime-failed" as const
          }
      : {
          status: "failed" as const,
          diagnostic: providerStatus === "cancelled"
            ? "Provider cancelled the Agent Turn."
            : `Provider Agent Turn failed: ${input.payload.failure?.error.message ?? "unknown provider failure"}`,
          failureReason: providerStatus === "cancelled"
            ? "cancelled" as const
            : "runtime-failed" as const
        };
    const completed = {
      taskId: input.fence.taskId!,
      roleName: input.fence.roleName,
      agentId: input.fence.agentId,
      adapterId,
      conversationId: input.fence.conversationId,
      nativeSessionId: input.fence.nativeSessionId!,
      nativeTurnId: input.fence.nativeTurnId,
      attemptId: input.fence.receiptId,
      turnId: input.fence.turnId,
      ...(input.payload.input === undefined ? {} : { input: input.payload.input }),
      providerStatus,
      outcome,
      observation: input
    };
    const classification = this.classifyRuntimeTurnTerminal(completed);
    if (classification !== "apply") return classification;
    const result = this.observeRuntimeTurnTerminal(completed, now);
    return result.disposition === "obsolete" ? "obsolete" : "applied";
  }

  private validateCanonicalSessionObservation(
    input: RuntimeObservation,
    now: Date
  ): ProviderLifecycleObservation {
    return this.store.transaction((store) => {
      const run = store.getTurn(input.fence.taskId!, input.fence.turnId!);
      const sessions = store.getTaskRoleSessionSet(input.fence.taskId!, input.fence.roleName);
      const session = sessions?.sessions[input.fence.agentId];
      if (run === null || run.roleName !== input.fence.roleName || run.effective.agentId !== input.fence.agentId || this.drivers.requireByAdapterId(run.effective.adapterId).id !== input.fence.driverId || session === undefined || session.nativeSessionId !== input.fence.nativeSessionId) {
        recordCanonicalObservationObsolete(store, input, "runtime-session-not-current", now);
        return "obsolete";
      }
      const status: AgentSessionStatus = "ended";
      let updatedSessions = updateRoleAgentSessionStatus(
        sessions!,
        input.fence.agentId,
        status,
        now,
        input.kind === "session.failed" ? "failed" : "stopped"
      );
      store.saveTaskRoleSessionSet(updatedSessions);
      for (const continuation of projectProviderContinuations(
        store.listEvents(input.fence.taskId!)
      )) {
        if (continuation.turnId !== input.fence.turnId || continuation.identity.conversationId
            !== (input.fence.conversationId ?? input.fence.nativeSessionId) || continuation.execution === "quiescent" || continuation.attachment === "detached") continue;
        const key = providerContinuationKey(continuation.identity);
        const identityDigest = createHash("sha256").update(key).digest("hex");
        const detached = createRuntimeObservation({
          schemaVersion: 4,
          eventId: `derived-continuation-detached:${identityDigest}`,
          semanticKey: `continuation-detached:${identityDigest}`,
          kind: "continuation.started",
          authority: "controller",
          receivedAt: input.receivedAt,
          observedAt: input.observedAt ?? input.receivedAt,
          fence: {
            ...input.fence,
            conversationId: continuation.identity.conversationId,
            continuationId: continuation.identity.continuationId,
            ...(continuation.parentContinuationId === undefined
              ? {}
              : { parentContinuationId: continuation.parentContinuationId })
          },
          payload: {
            execution: continuation.execution,
            outcome: continuation.outcome,
            attachment: "detached",
            observationQuality: continuation.observation,
            mayWriteWorkspace: continuation.mayWriteWorkspace,
            ...(continuation.resultRef === undefined
              ? {}
              : { resultRef: continuation.resultRef })
          }
        });
        const eventId = store.nextEventId(input.fence.taskId!);
        const detachedEvent = createTaskEvent(
          eventId,
          input.fence.taskId!,
          RUNTIME_OBSERVATION_TASK_EVENT,
          runtimeObservationTaskEventPayload(detached),
          now
        );
        store.saveEvent(input.fence.taskId!, detachedEvent);
        routeContinuationResult(
          store,
          detached,
          detachedEvent,
          "provider-continuation-detached",
          now
        );
      }
      const active = store.getActiveTurn(input.fence.taskId!, input.fence.roleName);
      const role = store.getRole(input.fence.taskId!, input.fence.roleName);
      if ((input.kind === "session.ended" || input.kind === "session.failed")
        && active !== null
        && active.id === input.fence.turnId
        && active.status === "active"
        && role !== null) {
        if (role.name === "leader") {
          const message = [
            `Leader native Session became unavailable while Turn ${active.id} remains active.`,
            "Yui preserved the Turn because Session/host termination is not a Task outcome.",
            "Retire the disposable Turn, or use Task execution stop/start if the current runtime cannot be settled normally."
          ].join(" ");
          recordLeaderAttentionRequired(store, {
            taskId: input.fence.taskId!,
            reason: "leader-runtime-detached",
            payload: { message, turnId: active.id },
            now
          });
        } else {
          enqueueWork(store, {
            kind: "role",
            taskId: input.fence.taskId!,
            roleName: "leader"
          }, "role-runtime-detached", now, [
            { type: "turn", taskId: input.fence.taskId!, id: active.id }
          ]);
        }
      }
      return "applied";
    });
  }

  private persistRuntimeObservation(input: RuntimeObservation, now: Date): void {
    this.store.transaction((store) => {
      const taskId = input.fence.taskId!;
      const events = store.listEvents(taskId);
      if (hasPersistedRuntimeObservation(events, input)) return;
      if (usageSnapshotIsSuperseded(events, input)) return;
      const removable = compactedRuntimeObservationIds(events, input);
      if (removable.length > 0) store.removeEvents(taskId, removable);
      const observationEventId = store.nextEventId(taskId);
      const observationEvent = createTaskEvent(
        observationEventId,
        taskId,
        RUNTIME_OBSERVATION_TASK_EVENT,
        runtimeObservationTaskEventPayload(input),
        now
      );
      store.saveEvent(taskId, observationEvent);
      if (input.kind === "native-work.snapshot"
        && input.payload.snapshotComplete === true
        && input.payload.observationQuality === "exact") {
        for (const continuation of projectProviderContinuations(events)) {
          if (continuation.turnId !== input.fence.turnId || continuation.identity.conversationId !== input.fence.conversationId || continuation.execution === "quiescent") continue;
          const identityKey = providerContinuationKey(continuation.identity);
          const digest = createHash("sha256")
            .update(`${input.semanticKey}\u0000${identityKey}`)
            .digest("hex");
          const settled = createRuntimeObservation({
            schemaVersion: 4,
            eventId: `native-snapshot-settled:${digest}`,
            semanticKey: `native-snapshot-settled:${digest}`,
            kind: "continuation.settled",
            authority: "controller",
            receivedAt: input.receivedAt,
            observedAt: input.observedAt ?? input.receivedAt,
            fence: {
              ...input.fence,
              continuationId: continuation.identity.continuationId,
              ...(continuation.parentContinuationId === undefined
                ? {}
                : { parentContinuationId: continuation.parentContinuationId })
            },
            payload: {
              execution: "quiescent",
              outcome: "unknown",
              attachment: continuation.attachment,
              observationQuality: "exact",
              mayWriteWorkspace: false,
              ...(continuation.resultRef === undefined
                ? {}
                : { resultRef: continuation.resultRef })
            }
          });
          const settledEventId = store.nextEventId(taskId);
          const settledEvent = createTaskEvent(
            settledEventId,
            taskId,
            RUNTIME_OBSERVATION_TASK_EVENT,
            runtimeObservationTaskEventPayload(settled),
            now
          );
          store.saveEvent(taskId, settledEvent);
          routeContinuationResult(
            store,
            settled,
            settledEvent,
            "provider-continuation-settled",
            now
          );
        }
      }
      if (input.kind === "continuation.reported"
        || input.kind === "continuation.settled") {
        routeContinuationResult(
          store,
          input,
          observationEvent,
          input.kind === "continuation.reported"
            ? "provider-continuation-report"
            : "provider-continuation-settled",
          now
        );
      }
      if ((input.kind === "goal.cleared"
          || (input.kind === "goal.updated" && input.payload.goalStatus !== "active"))
        && input.fence.roleName !== "leader") {
        routeRoleEvent(
          store,
          observationEvent,
          input.fence.roleName,
          input.kind === "goal.cleared"
            ? "provider-goal-cleared"
            : `provider-goal-${input.payload.goalStatus}`,
          now
        );
      }
      if (input.kind === "turn.failed" && input.payload.failure !== undefined) {
        const failure = input.payload.failure;
        const error = failure.error;
        const run = input.fence.turnId === undefined
          ? null
          : store.getTurn(taskId, input.fence.turnId);
        const errorEvent = createTaskEvent(
          store.nextEventId(taskId),
          taskId,
          "runtime.agent-error",
          {
            sourceEventId: input.eventId,
            observationEventId,
            turnId: input.fence.turnId ?? "",
            roleName: input.fence.roleName,
            agentId: input.fence.agentId,
            adapterId: run?.effective.adapterId ?? "unknown",
            driverId: input.fence.driverId,
            nativeSessionId: input.fence.nativeSessionId ?? "",
            nativeTurnId: input.fence.nativeTurnId ?? "",
            source: error.source,
            phase: error.phase,
            category: error.category,
            code: error.code,
            message: error.message,
            raw: error.raw,
            inputDisposition: error.inputDisposition,
            sessionDisposition: error.sessionDisposition,
            ...(error.retryAfterMs === undefined
              ? {}
              : { retryAfterMs: String(error.retryAfterMs) }),
            ...(failure.lastOutput === undefined ? {} : { lastOutput: failure.lastOutput })
          },
          now
        );
        store.saveEvent(taskId, errorEvent);
        routeRoleEvent(
          store,
          errorEvent,
          input.fence.roleName,
          wakeReason("agent-error", errorEvent.id),
          now
        );
      }
      if ((input.kind === "operation.completed" || input.kind === "operation.failed")
        && input.payload.operation === "subagent") {
        const role = store.getRole(taskId, input.fence.roleName);
        const session = store.getRoleSession(
          taskId,
          input.fence.roleName
        );
        // A live provider Session owns delivery of its native child result.
        // Route a Yui wake only when that parent is gone and another observer
        // supplied the child's terminal fact.
        if (role !== null && session?.status === "ended") {
          routeRoleEvent(
            store,
            observationEvent,
            role.name,
            "detached-native-subagent-terminal",
            now
          );
        }
      }
    });
    if (this.telemetry !== null && input.fence.turnId !== undefined) {
      try {
        const entry = runtimeObservationTelemetryEntry(input);
        this.telemetry.sink.observe(entry);
        const run = this.store.getTurn(entry.taskId, input.fence.turnId);
        if (run !== null && run.status !== "active") {
          void this.telemetry.retention.flush().then(() => {
            this.telemetry?.retention.pruneTurn(
              entry.taskId,
              entry.roleName,
              entry.turnId
            );
          }).catch(() => undefined);
        }
      } catch {
        // Runtime telemetry is diagnostic; the compact durable state snapshot
        // above remains authoritative when a sidecar is unavailable.
      }
    }
  }

  private recordObsoleteCanonicalObservation(
    input: RuntimeObservation,
    reason: string,
    now: Date
  ): "obsolete" {
    const taskId = input.fence.taskId;
    if (taskId === undefined || this.store.getTask(taskId) === null) return "obsolete";
    this.store.transaction((store) => recordCanonicalObservationObsolete(store, input, reason, now));
    return "obsolete";
  }

  /**
   * Revision-scoped read projection. Keyed by the store's durable revision;
   * any committed mutation (ours or an external writer's) advances it and the
   * next read rebuilds. A store without getStateRevision disables caching.
   */
  #readProjection: {
    revision: number;
    tasks: Map<string, TaskReadProjection>;
  } | null = null;

  #taskReadProjection(taskId: string): TaskReadProjection {
    const revision = typeof this.store.getStateRevision === "function"
      ? this.store.getStateRevision()
      : Number.NaN;
    if (
      this.#readProjection === null
      || this.#readProjection.revision !== revision
    ) {
      this.#readProjection = { revision, tasks: new Map() };
    }
    const tasks = this.#readProjection.tasks;
    let task = tasks.get(taskId);
    if (task === undefined) {
      const events = this.store.listEvents(taskId);
      task = {
        events,
        turnFacts: foldTurnProgressFacts(events),
        turns: this.store.listTurns(taskId),
        workItems: this.store.listWorkItems(taskId),
        reviewRounds: this.store.listReviewRounds(taskId),
        changeSets: this.store.listChangeSets(taskId),
        integrationAttempts: this.store.listIntegrationAttempts(taskId),
        inputRequests: this.store.listInputRequests(taskId),
        durableJobs: this.store.listDurableJobs(taskId),
        messages: this.store.listMessages(taskId)
      };
      tasks.set(taskId, task);
    }
    return task;
  }

  withRuntimeEventTransaction<T>(execute: () => T): T {
    return this.store.withRuntimeEventTransaction(execute);
  }

  listTasks() { return this.store.listTasks(); }
  listActiveTaskIds(): readonly string[] {
    return [...this.store.listActiveTaskIds()].sort((left, right) => (
      left.localeCompare(right, undefined, { numeric: true })
    ));
  }
  getTask(taskId: string) { return this.store.getTask(taskId); }
  getTaskWorkspace(taskId: string) { return this.store.getTaskWorkspace(taskId); }
  getTaskBrief(taskId: string) { return this.store.getTaskBrief(taskId); }
  listDecisions(taskId: string) { return this.store.listDecisions(taskId); }
  listMilestones(taskId: string) { return this.store.listMilestones(taskId); }
  getTaskWakeEnvelope(taskId: string): WakeEnvelope | null {
    return this.store.transaction((reader) => {
      const pending = reader.getPendingWakeup(taskId);
      if (pending === null) return null;
      const task = reader.getTask(taskId);
      if (task === null) return null;
      const latest = latestTaskWake(reader.listTaskWakes(taskId));
      const fromCursor = latest?.toCursor ?? fallbackWakeCursor({
        taskCreatedAt: task.createdAt,
        leaderTurnCreatedAt: operationalTaskRecords(
          reader.listTurns(taskId),
          reader.listEvents(taskId),
          "turn"
        )
          .filter((run) => run.roleName === "leader")
          .at(-1)?.createdAt
      });
      return buildTaskWakeEnvelope(reader, {
        taskId,
        wakeId: reader.peekNextTaskWakeId(taskId),
        reasons: pending.reasons,
        fromCursor
      });
    });
  }
  listRoles(taskId: string): SchedulerRole[] {
    return this.store.listRoles(taskId).map((role) => mapRole(this.store, role));
  }

  getRole(taskId: string, roleName: string): SchedulerRole | null {
    const role = this.store.getRole(taskId, roleName);
    return role === null ? null : mapRole(this.store, role);
  }

  getActiveTurn(taskId: string, roleName: string) {
    return this.store.getActiveTurn(taskId, roleName);
  }

  hasOpenInputRequest(taskId: string): boolean {
    return this.store.listOpenInputRequests([taskId]).length > 0;
  }

  listOpenInputRequests(taskIds?: readonly string[]) {
    return this.store.listOpenInputRequests(taskIds);
  }

  getInputRequest(taskId: string, inputRequestId: string) {
    return this.store.getInputRequest(taskId, inputRequestId);
  }

  getOperatorDeliveryTarget() {
    const role = this.store.getGlobalRole(SYSTEM_OPERATOR_ROLE);
    if (role === null) return null;
    const sessions = this.store.getGlobalRoleSessionSet(SYSTEM_OPERATOR_ROLE);
    const effectiveSession = sessions?.sessions[sessions.activeAgentId];
    if (effectiveSession?.status !== "active") return null;
    return {
      roleName: SYSTEM_OPERATOR_ROLE,
      adapterId: effectiveSession.effective.adapterId
    } as const;
  }

  markOperatorTurnStarted(now: Date): void {
    void now;
  }

  resolveExpiredInputRecommendations(now: Date, taskIds?: ReadonlySet<string>) {
    return this.store.transaction((store) => {
      const selectedTaskIds = taskIds === undefined
        ? undefined
        : [...taskIds].sort((left, right) => (
            left.localeCompare(right, undefined, { numeric: true })
          ));
      const expired = store.listOpenInputRequests(selectedTaskIds).filter((request) => (
        request.policy.kind === "recommended"
        && Date.parse(request.policy.timeoutAt) <= now.getTime()
      ));
      const resolved = [];
      for (const request of expired) {
        const task = store.getTask(request.taskId);
        if (task?.status !== "active"
          || task.executionGate.state !== "enabled"
          || request.policy.kind !== "recommended") continue;
        const choiceKey = request.policy.recommendedChoiceKey;
        const answered = answerInputRequest(
          request,
          { choiceKey },
          "agent-timeout",
          now
        );
        store.saveInputRequest(task.id, answered);
        store.saveEvent(task.id, createTaskEvent(
          store.nextEventId(task.id),
          task.id,
          "input.auto-answered",
          { requestId: request.id, choiceKey },
          now
        ));
        queueLeaderWakeup(store, task.id, wakeReason("input-timeout", request.id), now);
        resolved.push({ inputRequestId: request.id, taskId: task.id, choiceKey });
      }
      return resolved;
    });
  }

  getRoleSession(
    taskId: string,
    roleName: string,
    agentId?: string
  ): SchedulerRoleSession | null {
    const sessions = this.store.getTaskRoleSessionSet(taskId, roleName);
    const session = agentId === undefined
      ? sessions?.sessions[sessions.activeAgentId]
      : sessions?.sessions[agentId];
    return session === undefined ? null : mapSession(session);
  }

  getTaskRoleSessionSet(taskId: string, roleName: string): TaskRoleSessionSet | null {
    return this.store.getTaskRoleSessionSet(taskId, roleName);
  }

  listEvents(taskId: string) {
    return this.#taskReadProjection(taskId).events;
  }

  listTurns(taskId: string) {
    return this.#taskReadProjection(taskId).turns;
  }

  listWorkItems(taskId: string) {
    return this.#taskReadProjection(taskId).workItems;
  }

  listReviewRounds(taskId: string) {
    return this.#taskReadProjection(taskId).reviewRounds;
  }

  listIntegrationAttempts(taskId: string) {
    return this.#taskReadProjection(taskId).integrationAttempts;
  }

  listDurableJobs(taskId: string) {
    return this.#taskReadProjection(taskId).durableJobs;
  }

  listInputRequests(taskId: string) {
    return this.#taskReadProjection(taskId).inputRequests;
  }

  listMessages(taskId: string) {
    return this.#taskReadProjection(taskId).messages;
  }

  getTurnProgressFacts(taskId: string, turnId: string): TurnProgressFacts | undefined {
    return this.#taskReadProjection(taskId).turnFacts.get(turnId);
  }

  getTurnDurableProgress(
    taskId: string,
    roleName: string,
    turnId: string
  ): SchedulerTurnProgress | null {
    const projected = this.#taskReadProjection(taskId);
    // Serve the related-record fold from the same revision's projection: the
    // event history and the WorkItem/Review/ChangeSet/Integration/Input lists
    // are read once per Task per revision, and the per-Turn checkpoint/activity
    // facts come from the one-pass fold instead of per-candidate scans.
    const view = {
      getTurn: (id: string, turnId: string) => this.store.getTurn(id, turnId),
      listEvents: () => projected.events,
      getWorkItem: (id: string, workItemId: string) => this.store.getWorkItem(id, workItemId),
      listReviewRounds: () => projected.reviewRounds,
      listChangeSets: () => projected.changeSets,
      listIntegrationAttempts: () => projected.integrationAttempts,
      listInputRequests: () => projected.inputRequests
    };
    // A missing fold entry is an authoritative empty fold, not a signal to
    // re-scan the whole history. Pass {} so latestTurnDurableProgressAt treats
    // the fold as present and skips the per-candidate fallback scans.
    return latestTurnDurableProgressAt(view, taskId, roleName, turnId, projected.turnFacts.get(turnId) ?? {});
  }

  recordRoleTurnDiagnostic(
    input: RoleTurnDiagnosticPersistence
  ): "recorded" | "already-recorded" | "state-changed" {
    return this.store.transaction((store) => {
      const task = store.getTask(input.taskId);
      const run = store.getActiveTurn(input.taskId, input.roleName);
      if (task === null || task.status !== "active" || task.executionGate.state !== "enabled"
        || run === null || run.id !== input.turnId || run.status !== "active") {
        return "state-changed";
      }
      const latest = latestTurnEventTime(
        store.listEvents(input.taskId),
        TURN_DIAGNOSTIC_FINISHED_EVENT,
        input.turnId
      );
      if (latest !== undefined && Date.parse(latest) >= Date.parse(input.startedAt)) {
        return "already-recorded";
      }
      store.saveEvent(input.taskId, createTaskEvent(
        store.nextEventId(input.taskId),
        input.taskId,
        TURN_DIAGNOSTIC_FINISHED_EVENT,
        {
          turnId: input.turnId,
          roleName: input.roleName,
          outcome: input.outcome,
          startedAt: input.startedAt
        },
        input.now
      ));
      return "recorded";
    });
  }

  recordRoleTurnStall(
    input: RoleTurnStallPersistence
  ): "raised" | "already-raised" | "state-changed" {
    return this.store.transaction((store) => {
      const task = store.getTask(input.taskId);
      const role = store.getRole(input.taskId, input.roleName);
      const run = store.getActiveTurn(input.taskId, input.roleName);
      if (
        task === null
        || task.status !== "active"
        || task.executionGate.state !== "enabled"
        || role === null
        || run === null
        || run.id !== input.turnId
        || run.status !== "active"
        || run.effective.agentId !== input.agentId
        || run.effective.adapterId !== input.adapterId
      ) return "state-changed";

      const progress = latestTurnDurableProgressAt(
        store,
        input.taskId,
        input.roleName,
        input.turnId
      );
      if (progress?.progressAt !== input.progressAt) return "state-changed";

      const session = store.getRoleSession(input.taskId, input.roleName);
      if (!matchesStallSessionFence(session, input.session)) return "state-changed";

      const existing = latestStallEvidenceKey(store.listEvents(task.id), run.id);
      if (existing?.progressAt === input.progressAt) return "already-raised";

      const event = createTaskEvent(
        store.nextEventId(task.id),
        task.id,
        TURN_STALLED_EVENT,
        {
          turnId: run.id,
          roleName: role.name,
          kind: input.kind,
          classification: input.classification,
          progressAt: input.progressAt,
          idleMs: String(Math.max(0, Math.floor(input.idleMs))),
          evidenceKey: input.evidenceKey,
          status: "diagnostic-only"
        },
        input.now
      );
      store.saveEvent(task.id, event);
      return "raised";
    });
  }

  recordRoleTurnProgress(
    input: RoleTurnProgressPersistence
  ): "recorded" | "already-recorded" | "state-changed" {
    return this.store.transaction((store) => {
      const task = store.getTask(input.taskId);
      const run = store.getActiveTurn(input.taskId, input.roleName);
      if (
        task === null
        || task.status !== "active"
        || task.executionGate.state !== "enabled"
        || run === null
        || run.id !== input.turnId
        || run.status !== "active"
      ) return "state-changed";
      const events = store.listEvents(task.id);
      const previousStall = latestStallEvidenceKey(events, run.id);
      // A progress fact can close only the matching, older stall episode. A
      // stale/native observation must never clear a newer attention point.
      if (
        previousStall !== undefined
        && Date.parse(input.progressAt) <= Date.parse(previousStall.progressAt)
      ) {
        return "already-recorded";
      }
      const existing = events.some((event) => (
        event.type === TURN_PROGRESS_EVENT
        && event.payload.turnId === run.id
        && (
          event.payload.progressAt === input.progressAt
          || (
            typeof event.payload.progressAt === "string"
            && Number.isFinite(Date.parse(event.payload.progressAt))
            && Date.parse(event.payload.progressAt) >= Date.parse(input.progressAt)
          )
        )
      ));
      // Advisory 30-minute diagnostics are intentionally not lifecycle
      // episodes and therefore must never synthesize turn.recovered.
      const recovered = isRoleTurnStalled(events, run.id);
      if (!existing) {
        store.saveEvent(task.id, createTaskEvent(
          store.nextEventId(task.id),
          task.id,
          TURN_PROGRESS_EVENT,
          {
            turnId: run.id,
            roleName: input.roleName,
            kind: "durable-fold",
            progressAt: input.progressAt,
            evidence: input.evidence ?? ""
          },
          input.now
        ));
      }
      if (recovered) {
        store.saveEvent(task.id, createTaskEvent(
          store.nextEventId(task.id),
          task.id,
          TURN_RECOVERED_EVENT,
          {
            turnId: run.id,
            roleName: input.roleName,
            progressAt: input.progressAt,
            kind: "durable-progress"
          },
          input.now
        ));
      }
      return existing && !recovered ? "already-recorded" : "recorded";
    });
  }

  beginAgentHostProviderTurn(input: Readonly<{
    taskId: string;
    roleName: string;
    turnId?: string;
    agentId: string;
    nativeSessionId: string;
    attemptId: string;
    authorityEpoch: number;
    authorityOwner: "controller" | "human";
    holderId: string;
    now: Date;
  }>): void {
    this.store.transaction((store) => {
      const sessions = store.getTaskRoleSessionSet(input.taskId, input.roleName);
      const session = sessions?.sessions[input.agentId];
      const binding = sessions?.providerBinding;
      const active = store.getActiveTurn(input.taskId, input.roleName);
      if (sessions === null || sessions === undefined || binding === null || binding === undefined || (input.turnId !== undefined && (active?.id !== input.turnId || active.effective.agentId !== input.agentId)) || session === undefined || session.nativeSessionId !== input.nativeSessionId || currentProviderConversation(binding).conversationId !== input.nativeSessionId || binding.authority.owner !== input.authorityOwner || binding.authority.epoch !== input.authorityEpoch || binding.authority.holderId !== input.holderId) {
        throw new AgentHostProviderTurnFenceError(
          "Agent Host Provider Turn carries a stale durable writer fence. Release and reacquire Provider authority before retrying input."
        );
      }
      const currentTurn = binding.turn;
      if (session.effective.executionEnvironment !== undefined) {
        assertExecutionEnvironmentCurrent(store, input.taskId, session.effective.executionEnvironment);
      }
      if (input.turnId !== undefined
        && !isDeepStrictEqual(active?.effective.executionEnvironment, session.effective.executionEnvironment)) {
        throw new AgentHostProviderTurnFenceError("Turn and native Session execution environments differ; start a new Session.");
      }
      const exactReplay = currentTurn !== null
        && currentTurn.turnId === input.turnId
        && currentTurn.attemptId === input.attemptId
        && currentTurn.authorityEpoch === input.authorityEpoch
        && currentTurn.status === "submitting";
      if (!exactReplay && binding.turn !== null
        && ["submitting", "accepted", "delivery-unknown"]
          .includes(binding.turn.status)) {
        throw new AgentHostProviderTurnFenceError(
          "Provider Conversation already has an unsettled Turn."
        );
      }
      store.saveTaskRoleSessionSet(updateTaskRoleProviderRuntime(
        sessions,
        beginProviderTurn(binding, {
          ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
          attemptId: input.attemptId,
          authorityEpoch: input.authorityEpoch,
          submittedAt: input.now.toISOString()
        }),
        input.now
      ));
    });
  }

  resolveAgentHostProviderTurnSubmission(input: Readonly<{
    taskId: string;
    roleName: string;
    turnId?: string;
    attemptId: string;
    status: "rejected" | "delivery-unknown";
    reason: string;
    raw: string;
    now: Date;
  }>): void {
    this.store.transaction((store) => {
      const sessions = store.getTaskRoleSessionSet(input.taskId, input.roleName);
      const binding = sessions?.providerBinding;
      if (sessions === null || sessions === undefined
        || binding === null || binding === undefined
        || binding.turn?.turnId !== input.turnId
        || binding.turn?.attemptId !== input.attemptId) {
        throw new Error("Agent Host Provider Turn submission is no longer current.");
      }
      const updated = settleProviderTurnSubmission(binding, {
        attemptId: input.attemptId,
        status: input.status,
        reason: input.reason,
        resolvedAt: input.now.toISOString()
      });
      store.saveTaskRoleSessionSet(updateTaskRoleProviderRuntime(sessions, updated, input.now));
      if (input.turnId === undefined) return;
      const run = store.getTurn(input.taskId, input.turnId);
      const session = sessions.sessions[sessions.activeAgentId];
      const driver = run === null
        ? null
        : this.drivers.findByAdapterId(run.effective.adapterId);
      const error = standardAgentError({
        source: "driver",
        phase: "turn-submit",
        classification: driver?.runtime.mapError({
          message: input.reason,
          raw: input.raw
        }),
        message: input.reason,
        raw: input.raw,
        inputDisposition: input.status === "rejected" ? "not-accepted" : "unknown"
      });
      const errorEvent = createTaskEvent(
        store.nextEventId(input.taskId),
        input.taskId,
        "runtime.agent-error",
        {
          sourceEventId: input.attemptId,
          turnId: input.turnId,
          roleName: input.roleName,
          agentId: run?.effective.agentId ?? sessions.activeAgentId,
          adapterId: run?.effective.adapterId ?? session?.adapterId ?? "unknown",
          driverId: driver?.id ?? "unknown",
          // No native Turn exists at submission resolution, and the Session
          // facts may be absent. An unknown fact is an absent key: an empty
          // string reads back as a real value and cannot be told apart from
          // one the Provider genuinely reported.
          ...optionalEventFields({
            nativeSessionId: session?.nativeSessionId
          }),
          source: error.source,
          phase: error.phase,
          category: error.category,
          code: error.code,
          message: error.message,
          raw: error.raw,
          inputDisposition: error.inputDisposition,
          sessionDisposition: error.sessionDisposition
        },
        input.now
      );
      store.saveEvent(input.taskId, errorEvent);
      const route = input.roleName === "leader"
        ? { kind: "operator" } as const
        : { kind: "role", taskId: input.taskId, roleName: "leader" } as const;
      enqueueWork(
        store,
        route,
        input.roleName === "leader"
          ? "leader-turn-submission-error"
          : wakeReason("agent-error", errorEvent.id),
        input.now,
        [{ type: "event", taskId: input.taskId, id: errorEvent.id }],
        {
          source: driver?.id ?? "agent-host",
          dedupeKey: `agent-error:${input.taskId}:${input.attemptId}`
        }
      );
    });
  }

  getProviderAuthorityFence(input: Readonly<{
    taskId: string;
    roleName: string;
    turnId: string;
    agentId: string;
    nativeSessionId: string;
  }>): Readonly<{
    conversationId: string;
    epoch: number;
    owner: "controller" | "human" | "none" | "unknown";
    holderId?: string;
  }> | null {
    const sessions = this.store.getTaskRoleSessionSet(input.taskId, input.roleName);
    const session = sessions?.sessions[input.agentId];
    const binding = sessions?.providerBinding;
    if (binding === null || binding === undefined || session === undefined || session.nativeSessionId !== input.nativeSessionId || currentProviderConversation(binding).conversationId !== input.nativeSessionId) return null;
    return {
      conversationId: currentProviderConversation(binding).conversationId,
      ...binding.authority
    };
  }

  peekNextTurnId(taskId: string): string {
    return this.store.peekNextTurnId(taskId);
  }
  getWorkMailbox(target: MailboxTarget) { return this.store.getWorkMailbox(target); }
  listWorkMailboxes() { return this.store.listWorkMailboxes(); }
  listReadyWorkMailboxes() { return this.store.listReadyWorkMailboxes(); }

  queueTaskProgress(taskId: string, reason: string, now: Date): void {
    this.store.transaction((store) => {
      enqueueWork(store, { kind: "task", taskId }, reason, now, [
        { type: "task", id: taskId }
      ]);
    });
  }

  enqueueLeaderWakeup(taskId: string, reason: string, now: Date) {
    return this.store.transaction((store) => {
      const mailbox = enqueueWork(
        store,
        { kind: "role", taskId, roleName: "leader" },
        reason,
        now
      );
      const wakeup = pendingWakeupProjection(mailbox);
      if (wakeup === null) throw new Error(`Leader wakeup was not persisted: ${taskId}.`);
      return wakeup;
    });
  }

  recordAgentError(input: Readonly<{
    taskId: string;
    roleName: string;
    turnId: string;
    source: import("../runtime/agentError.js").AgentErrorSource;
    phase: import("../runtime/agentError.js").AgentErrorPhase;
    message: string;
    raw: string;
    inputDisposition?: import("../runtime/agentError.js").AgentErrorInputDisposition;
    sessionDisposition?: import("../runtime/agentError.js").AgentErrorSessionDisposition;
    errorName?: string;
    causeName?: string;
    hostState?: string;
    attemptId?: string;
    registrationDisposition?:
      import("../runtime/agentError.js").AgentErrorRegistrationDisposition;
  }>, now: Date): string {
    return this.store.transaction((store) => {
      const run = store.getTurn(input.taskId, input.turnId);
      const sessionSet = store.getTaskRoleSessionSet(input.taskId, input.roleName);
      const sessionAgentId = run?.effective.agentId ?? sessionSet?.activeAgentId;
      const session = sessionAgentId === undefined
        ? undefined
        : sessionSet?.sessions[sessionAgentId];
      const driver = run === null
        ? null
        : this.drivers.findByAdapterId(run.effective.adapterId);
      const error = standardAgentError({
        source: input.source,
        phase: input.phase,
        classification: driver?.runtime.mapError({
          message: input.message,
          raw: input.raw
        }),
        message: input.message,
        raw: input.raw,
        ...(input.inputDisposition === undefined
          ? {}
          : { inputDisposition: input.inputDisposition }),
        ...(input.sessionDisposition === undefined
          ? {}
          : { sessionDisposition: input.sessionDisposition })
      });
      const duplicate = [...store.listEvents(input.taskId)].reverse().find((event) => (
        event.type === "runtime.agent-error"
        && event.payload.turnId === input.turnId
        && event.payload.roleName === input.roleName
        && event.payload.phase === input.phase
        && event.payload.attemptId === input.attemptId
        && event.payload.source === error.source
        && event.payload.inputDisposition === error.inputDisposition
        && event.payload.sessionDisposition === error.sessionDisposition
        && event.payload.registrationDisposition === input.registrationDisposition
        && event.payload.hostState === input.hostState
        && (input.attemptId === undefined
          ? event.payload.raw === error.raw
          : event.payload.message === error.message
            && event.payload.errorName === input.errorName
            && event.payload.causeName === input.causeName)
      ));
      // Re-reading one failed attempt may add a different caller stack, not a
      // new execution fact. Preserve its first full cause without multiplying
      // notifications; changed disposition/identity/diagnostic remains visible.
      if (duplicate !== undefined) return duplicate.id;
      const event = createTaskEvent(
        store.nextEventId(input.taskId),
        input.taskId,
        "runtime.agent-error",
        {
          sourceEventId: `${input.turnId}:${input.phase}${input.attemptId === undefined ? "" : `:${input.attemptId}`}`,
          turnId: input.turnId,
          roleName: input.roleName,
          agentId: run?.effective.agentId ?? session?.agentId ?? "unknown",
          adapterId: run?.effective.adapterId ?? session?.adapterId ?? "unknown",
          driverId: driver?.id ?? "unknown",
          source: error.source,
          phase: error.phase,
          category: error.category,
          code: error.code,
          message: error.message,
          raw: error.raw,
          inputDisposition: error.inputDisposition,
          sessionDisposition: error.sessionDisposition,
          // Structured facts from the failing operation. Absent keys stay
          // absent rather than becoming an empty string, so a reader can tell
          // "the Host did not report this" from "the Host reported nothing".
          // The Session identities follow the same rule: this failure can
          // happen before any Session record exists, and there is no native
          // Turn to name at all.
          ...optionalEventFields({
            nativeSessionId: session?.nativeSessionId,
            errorName: input.errorName,
            causeName: input.causeName,
            hostState: input.hostState,
            attemptId: input.attemptId,
            registrationDisposition: input.registrationDisposition
          })
        },
        now
      );
      store.saveEvent(input.taskId, event);
      const leaderCannotReceive = input.roleName === "leader"
        && ["host-start", "session-start", "session-restore", "turn-submit"].includes(
          input.phase
        );
      if (!leaderCannotReceive) {
        enqueueWork(
          store,
          { kind: "role", taskId: input.taskId, roleName: "leader" },
          wakeReason("agent-error", event.id),
          now,
          [{ type: "event", taskId: input.taskId, id: event.id }],
          {
            source: driver?.id ?? input.source,
            dedupeKey: `agent-error:${input.taskId}:${input.turnId}:${input.phase}:${event.id}`
          }
        );
      }
      if (leaderCannotReceive) {
        enqueueWork(
          store,
          { kind: "operator" },
          "leader-agent-error",
          now,
          [{ type: "event", taskId: input.taskId, id: event.id }],
          {
            source: driver?.id ?? input.source,
            dedupeKey: `leader-agent-error:${input.taskId}:${input.turnId}:${event.id}`
          }
        );
      }
      return event.id;
    });
  }

  /**
   * Records that a Leader wake was suppressed by scheduler single-flight
   * (the Role runtime lifecycle lane was busy). The wake stays durable and
   * is retried after the lane settles; this event is the audit trail that
   * separates scheduler backpressure from real Turn failures.
   */
  recordWakeSuppression(
    taskId: string,
    reason: string,
    now: Date
  ): void {
    this.store.transaction((store) => {
      const task = store.getTask(taskId);
      if (task === null) return;
      store.saveEvent(taskId, createTaskEvent(
        store.nextEventId(taskId),
        taskId,
        "wake.suppressed",
        { reason },
        now
      ));
    });
  }

  listActiveDurableJobs(): readonly DurableJob[] {
    return this.store.listActiveDurableJobs();
  }

  /**
   * Apply one durable-job transition and, in the SAME transaction, enqueue
   * the Leader wakeup. A terminal job without its wakeup enqueued is a lost
   * wakeup, so the two writes commit together or not at all.
   *
   * f6: The wakeup targets the Leader role mailbox (not the Task mailbox).
   * That mailbox is also the PendingWakeup authority consumed by
   * processLeaderWakeups, so the signal must be enqueued exactly once.
   */
  transitionDurableJob(
    taskId: string,
    jobId: string,
    transition: (job: DurableJob) => DurableJob,
    now: Date,
    wakeup?: { reason: string; refs: readonly MailboxEntityRef[] }
  ): DurableJob | null {
    return this.store.transaction((store) => {
      const current = store.getDurableJob(taskId, jobId);
      if (current === null) return null;
      const next = transition(current);
      store.saveDurableJob(taskId, next);
      if (wakeup !== undefined) {
        enqueueWork(
          store,
          { kind: "role", taskId, roleName: "leader" },
          wakeup.reason,
          now,
          [...wakeup.refs]
        );
      }
      return next;
    });
  }

  releaseLeaderWakeupAndEnqueue(
    taskId: string,
    batchId: string,
    reason: string,
    now: Date
  ): boolean {
    const target = { kind: "role", taskId, roleName: "leader" } as const;
    return this.store.transaction((store) => {
      const mailbox = store.getWorkMailbox(target);
      if (mailbox?.processing?.batchId !== batchId) return false;
      store.saveWorkMailbox(releaseProcessing(mailbox, batchId));
      enqueueWork(store, target, reason, now);
      return true;
    });
  }

  claimWorkMailbox(input: SchedulerMailboxClaimInput): SchedulerMailboxClaimResult {
    return this.store.transaction((store) => {
      const mailbox = store.getWorkMailbox(input.target);
      if (mailbox === null || !mailboxHasWork(mailbox)) {
        return { status: "empty" };
      }
      if (mailbox.processing !== null) {
        return { status: "processing", processing: mailbox.processing };
      }
      let claimed = claimPending(mailbox, {
        batchId: input.batchId,
        owner: input.owner,
        startedAt: input.now.toISOString()
      });
      if (input.executionRef !== undefined) {
        claimed = bindExecution(claimed, input.batchId, input.executionRef);
      }
      store.saveWorkMailbox(claimed);
      return { status: "claimed", processing: claimed.processing! };
    });
  }

  settleRoleTurnDispatch(
    input: Parameters<SchedulerStorePort["settleRoleTurnDispatch"]>[0]
  ): ReturnType<SchedulerStorePort["settleRoleTurnDispatch"]> {
    return this.store.transaction((store) => (
      settleRoleTurnDispatchMailbox(
        store,
        input,
        input.expected
      )
    ));
  }

  completeWorkMailbox(target: MailboxTarget, batchId: string): boolean {
    return this.store.transaction((store) => {
      const mailbox = store.getWorkMailbox(target);
      if (mailbox?.processing?.batchId !== batchId) return false;
      const completed = completeProcessing(mailbox, batchId);
      if (
        target.kind === "role-runtime"
        || target.kind === "global-role-runtime"
      ) {
        saveRuntimeLifecycleMailbox(store, completed);
      } else {
        store.saveWorkMailbox(completed);
      }
      return true;
    });
  }

  releaseWorkMailbox(target: MailboxTarget, batchId: string): boolean {
    return this.store.transaction((store) => {
      const mailbox = store.getWorkMailbox(target);
      if (mailbox?.processing?.batchId !== batchId) return false;
      store.saveWorkMailbox(releaseProcessing(mailbox, batchId));
      return true;
    });
  }

  completeRuntimeCleanup(
    target: Extract<
      MailboxTarget,
      { kind: "role-runtime" | "global-role-runtime" }
    >,
    now: Date
  ): boolean {
    return this.store.transaction((store) => {
      let mailbox = store.getWorkMailbox(target);
      const disposition = runtimeCleanupDisposition(mailbox);
      if (mailbox === null || disposition === null) return false;
      if (mailbox.processing !== null) {
        if (
          !mailbox.processing.batch.reasons.every(isRuntimeCleanupReason)
        ) {
          return false;
        }
        mailbox = completeProcessing(mailbox, mailbox.processing.batchId);
      }
      const pending = mailbox.pending;
      if (pending !== null) {
        if (
          pending.reasons.length === 0
          || !pending.reasons.every(isRuntimeCleanupReason)
        ) {
          return false;
        }
        const batchId = `runtime-cleanup-complete:${pending.fromSequence}-${pending.toSequence}`;
        mailbox = completeProcessing(claimPending(mailbox, {
          batchId,
          owner: RUNTIME_LIFECYCLE_OWNER,
          startedAt: now.toISOString()
        }), batchId);
      }
      const owner = runtimeOwnerFromTarget(target);
      if (disposition === "end-session") {
        endRuntimeOwnerSession(store, owner, now);
      } else {
        detachRuntimeOwnerHost(store, owner, now);
      }
      saveRuntimeLifecycleMailbox(store, mailbox);
      return true;
    });
  }

  listDormantRuntimeOwners(): readonly DormantRuntimeOwnerCandidate[] {
    return this.listRuntimeSessionCandidates().flatMap((candidate) => {
      if (
        hasRuntimeLifecycleWork(
          this.store.getWorkMailbox(runtimeLifecycleTarget(candidate.owner))
        )
        || (
          candidate.owner.scope === "task"
          && this.store.getActiveTurn(
            candidate.owner.taskId,
            candidate.owner.roleName
          ) !== null
        )
      ) {
        return [];
      }
      return [{
        owner: candidate.owner,
        agentId: candidate.agentId,
        adapterId: candidate.adapterId,
        nativeSessionId: candidate.nativeSessionId,
        sessionUpdatedAt: candidate.sessionUpdatedAt
      }];
    });
  }

  listRuntimeSessionCandidates(
    query: RuntimeSessionCandidateQuery = {}
  ): readonly RuntimeSessionCandidate[] {
    return this.store.listRuntimeSessionCandidates(query);
  }

  enqueueRuntimeCleanup(
    owner: RuntimeRoleOwner,
    now = new Date(),
    expectedDormantCandidate?: DormantRuntimeOwnerCandidate
  ): RuntimeLifecycleTarget | null {
    return this.store.transaction((store) => {
      if (
        expectedDormantCandidate !== undefined
        && (
          !sameRuntimeOwner(owner, expectedDormantCandidate.owner)
          || !dormantRuntimeCandidateIsCurrent(store, expectedDormantCandidate)
        )
      ) {
        return null;
      }
      if (owner.scope === "task" && store.getTask(owner.taskId) === null) {
        return null;
      }
      const target = runtimeLifecycleTarget(owner);
      enqueueWork(
        store,
        target,
        RUNTIME_CLEANUP_REQUIRED_REASON,
        now,
        owner.scope === "task" ? [{ type: "task", id: owner.taskId }] : []
      );
      return target;
    });
  }

  enqueueRuntimeHostDetach(
    owner: RuntimeRoleOwner,
    now = new Date(),
    expectedDormantCandidate?: DormantRuntimeOwnerCandidate
  ): RuntimeLifecycleTarget | null {
    return this.store.transaction((store) => {
      if (
        expectedDormantCandidate !== undefined
        && (
          !sameRuntimeOwner(owner, expectedDormantCandidate.owner)
          || !dormantRuntimeCandidateIsCurrent(store, expectedDormantCandidate)
        )
      ) {
        return null;
      }
      if (owner.scope === "task" && store.getTask(owner.taskId) === null) {
        return null;
      }
      const target = runtimeLifecycleTarget(owner);
      enqueueWork(
        store,
        target,
        RUNTIME_HOST_DETACH_REQUIRED_REASON,
        now,
        owner.scope === "task" ? [{ type: "task", id: owner.taskId }] : []
      );
      return target;
    });
  }
  getPendingWakeup(taskId: string) { return this.store.getPendingWakeup(taskId); }
  listPendingWakeups() { return this.store.listPendingWakeups(); }
  savePendingWakeup(wakeup: Parameters<TaskStore["savePendingWakeup"]>[0]): void {
    this.store.savePendingWakeup(wakeup);
  }
  clearPendingWakeup(taskId: string): void { this.store.clearPendingWakeup(taskId); }
  getLeaderFailure(taskId: string) { return this.store.getLeaderFailure(taskId); }

  saveLeaderDispatch(input: LeaderDispatchPersistence): LeaderDispatchClaimResult {
    return this.store.transaction((store) => {
      const task = store.getTask(input.task.id);
      if (task === null || task.status !== "active" || task.executionGate.state !== "enabled") {
        return "unavailable";
      }
      const role = requireRole(store, input.task.id, input.role.name);
      const binding = activeRoleAgentBinding(role);
      if (role.activeAgentId !== input.role.activeAgentId
        || binding.adapterId !== input.role.adapterId
        || binding.config.model !== input.role.model
        || binding.config.effort !== input.role.effort
        || role.workspace !== input.role.workspace) {
        return "state-changed";
      }
      if (!isDeepStrictEqual(input.turn.effective, input.role.effective)) {
        return "state-changed";
      }
      if (store.getTurn(input.task.id, input.turn.id) !== null) return "state-changed";
      if (store.getActiveTurn(input.task.id, input.role.name) !== null) return "busy";
      const pending = store.getPendingWakeup(input.task.id);
      if (pending === null || !pendingWakeupsMatch(pending, input.wakeup)) {
        return "state-changed";
      }
      const target = { kind: "role", taskId: input.task.id, roleName: input.role.name } as const;
      const mailbox = store.getWorkMailbox(target);
      if (mailbox === null || !mailboxHasPending(mailbox)) return "state-changed";
      if (store.peekNextTurnId(input.task.id) !== input.turn.id) {
        return "state-changed";
      }
      const allocatedTurnId = store.nextTurnId(input.task.id);
      if (allocatedTurnId !== input.turn.id) {
        throw new Error(`Leader Turn allocation changed unexpectedly: ${input.task.id}.`);
      }
      // The durable Turn row and its active pointer are separate projections;
      // keep both writes in the same storage transaction.
      store.saveTurn(input.turn);
      store.saveActiveTurn(input.turn);
      store.saveWorkMailbox(consumePendingBatch(mailbox));
      store.clearPendingWakeup(input.task.id);
      store.saveEvent(input.task.id, createTaskEvent(
        store.nextEventId(input.task.id),
        input.task.id,
        "turn.dispatched",
        turnLaunchEventPayload(input.turn),
        input.now
      ));
      if (input.wakeId !== undefined && input.wakeFromCursor !== undefined) {
        if (store.peekNextTaskWakeId(input.task.id) !== input.wakeId) {
          return "state-changed";
        }
        const allocatedWakeId = store.nextTaskWakeId(input.task.id);
        if (allocatedWakeId !== input.wakeId) {
          throw new Error(`Leader TaskWake allocation changed unexpectedly: ${input.task.id}.`);
        }
        store.saveTaskWake(input.task.id, createTaskWake({
          id: allocatedWakeId,
          taskId: input.task.id,
          reasons: input.wakeup.reasons,
          fromCursor: input.wakeFromCursor,
          toCursor: input.now.toISOString(),
          turnId: input.turn.id,
          now: input.now
        }));
      }
      if (input.turn.mode !== "new"
        && input.session !== null
        && input.session.nativeSessionId !== undefined) {
        saveTaskSession(store, role, {
          ...input.session,
          nativeSessionId: input.session.nativeSessionId
        }, "active", input.now);
      }
      store.clearLeaderFailure(input.task.id);
      return "claimed";
    });
  }

  saveLeaderSteer(input: LeaderSteerPersistence): LeaderDispatchClaimResult {
    return this.store.transaction((store) => {
      if (store.listEvents(input.taskId).some((event) => event.type === "turn.input-submitted"
        && event.payload.turnId === input.turnId && event.payload.batchId === input.batchId)) {
        return "claimed";
      }
      const task = store.getTask(input.taskId);
      const active = store.getActiveTurn(input.taskId, "leader");
      if (task === null || task.status !== "active" || task.executionGate.state !== "enabled") {
        return "unavailable";
      }
      if (active === null || active.id !== input.turnId || active.status !== "active") return "busy";
      const target = { kind: "role", taskId: input.taskId, roleName: "leader" } as const;
      const mailbox = store.getWorkMailbox(target);
      const processing = mailbox?.processing;
      if (mailbox === null
        || processing?.batchId !== input.batchId
        || processing.owner !== `leader-steer:${input.turnId}`) return "state-changed";
      const updated = appendTurnInput(active, input.input, input.now);
      store.saveTurn(updated);
      store.saveActiveTurn(updated);
      store.saveWorkMailbox(completeProcessing(mailbox, input.batchId));
      store.saveEvent(input.taskId, createTaskEvent(
        store.nextEventId(input.taskId),
        input.taskId,
        "turn.input-submitted",
        {
          turnId: active.id,
          batchId: input.batchId,
          sequence: String(updated.inputs.length),
          source: `${input.input.source.type}/${input.input.source.channel}`,
          reasons: processing.batch.reasons.join(",")
        },
        input.now
      ));
      return "claimed";
    });
  }

  saveRoleTurnPrepared(input: RoleTurnDeliveryPersistence): void {
    this.store.transaction((store) => {
      const task = store.getTask(input.task.id);
      if (task === null || task.status !== "active" || task.executionGate.state !== "enabled") {
        throw new Error(`Task is not active: ${input.task.id}.`);
      }
      const role = requireRole(store, input.task.id, input.role.name);
      const active = store.getActiveTurn(input.task.id, input.role.name);
      if (active === null || active.id !== input.turn.id) {
        throw new Error(`Active Turn changed before preparation was persisted: ${input.turn.id}.`);
      }
      if (store.getTaskRoleSessionSet(input.task.id, input.role.name) === null) {
        store.saveTaskRoleSessionSet(createRoleSessionSet(
          { scope: "task", taskId: input.task.id, roleName: input.role.name },
          input.turn.effective.agentId,
          input.now
        ));
      }
      if (input.session !== null && input.session.nativeSessionId !== undefined) {
        const existing = store.getRoleSession(input.task.id, input.role.name);
        // A terminal Session is audit history, not the current execution
        // identity. Preallocated providers must publish the replacement fence
        // before the new Agent Host starts so its exact-runtime preflight sees
        // the new launch. Only a still-live conflicting Session is deferred.
        const defersConversationReplacement = active.mode === "new"
          && existing !== null
          && existing.nativeSessionId !== input.session.nativeSessionId
          && existing.status === "active";
        if (!defersConversationReplacement && (existing?.nativeSessionId !== input.session.nativeSessionId || existing.status !== "active")) {
          saveTaskSession(store, role, {
            ...input.session,
            nativeSessionId: input.session.nativeSessionId
          }, "active", input.now);
        }
      }
    });
  }

  saveRoleTurnDeliveryFailure(
    input: RoleTurnDeliveryFailurePersistence
  ): "failed" | "state-changed" {
    return this.store.transaction((store) => {
      const task = store.getTask(input.taskId);
      const role = store.getRole(input.taskId, input.roleName);
      const active = store.getActiveTurn(input.taskId, input.roleName);
      const sessions = store.getTaskRoleSessionSet(input.taskId, input.roleName);
      const session = sessions?.sessions[input.agentId];
      if (
        task === null
        || task.status !== "active"
        || task.executionGate.state !== "enabled"
        || role === null
        || active === null
        || active.id !== input.turnId
        || active.status !== "active"
        || active.effective.agentId !== input.agentId
        || active.effective.adapterId !== input.adapterId
      ) {
        return "state-changed";
      }

      const summary = input.summary
        ?? `Role delivery failed conclusively before exact Turn input acceptance: ${input.turnId}.`;
      const result = terminalizeExactTaskTurn(store, {
        taskId: input.taskId,
        roleName: input.roleName,
        agentId: input.agentId,
        turnId: input.turnId,
        ...(session?.nativeSessionId === undefined
          ? {}
          : { nativeSessionId: session.nativeSessionId }),
        outcome: { status: "failed", diagnostic: summary, failureReason: input.failureReason }
      }, input.now);
      if (result.disposition !== "applied" || result.turn === null) {
        return "state-changed";
      }

      const terminal = result.turn;
      const deliveryFailureEvent = createTaskEvent(
        store.nextEventId(input.taskId),
        input.taskId,
        "runtime.role-delivery-failed",
        {
          turnId: terminal.id,
          roleName: input.roleName,
          outcome: terminal.status
        },
        input.now
      );
      store.saveEvent(input.taskId, deliveryFailureEvent);

      routeRoleEvent(
        store,
        deliveryFailureEvent,
        input.roleName,
        terminal.purpose === "review" ? "review-failed" : "role-turn-failed",
        input.now
      );
      if (input.roleName === "leader") {
        store.saveLeaderFailure(recordLeaderFailure(
          input.taskId,
          session?.nativeSessionId ?? "(unregistered)",
          summary,
          input.now,
          store.getLeaderFailure(input.taskId)
        ));
      }
      return "failed";
    });
  }

  /** Called by the internal Codex notify hook, never by an LLM prompt. */
  recordRuntimeNativeSession(input: Readonly<{
    taskId: string;
    roleName: string;
    agentId: string;
    adapterId: string;
    nativeSessionId: string;
  }>, now = new Date()): RoleAgentSession {
    return this.store.transaction((store) => (
      recordTaskRuntimeNativeSession(store, input, now)
    ));
  }

  recordLaunchedRuntimeNativeSession(input: Readonly<{
    owner: RuntimeRoleOwner;
    agentId: string;
    adapterId: string;
    nativeSessionId: string;
    effective: EffectiveLaunchSnapshot;
  }>, assertCurrent: () => void, now = new Date()): RoleAgentSession {
    return this.store.transaction((store) => {
      assertCurrent();
      const session = input.owner.scope === "task"
        ? recordTaskRuntimeNativeSession(store, {
            taskId: input.owner.taskId,
            roleName: input.owner.roleName,
            agentId: input.agentId,
            adapterId: input.adapterId,
            nativeSessionId: input.nativeSessionId,
            effective: input.effective
          }, now)
        : recordGlobalRuntimeNativeSession(store, {
            roleName: input.owner.roleName,
            agentId: input.agentId,
            adapterId: input.adapterId,
            nativeSessionId: input.nativeSessionId,
            effective: input.effective
          }, now);
      if (input.owner.scope === "task") {
        const sessions = store.getTaskRoleSessionSet(input.owner.taskId, input.owner.roleName);
        const binding = sessions?.providerBinding;
        if (sessions !== null && binding !== null && binding !== undefined
          && binding.authority.owner === "none"
          && currentProviderConversation(binding).conversationId === input.nativeSessionId) {
          store.saveTaskRoleSessionSet(updateTaskRoleProviderRuntime(
            sessions,
            transferProviderAuthority(binding, {
              expectedEpoch: binding.authority.epoch,
              expectedOwner: "none",
              owner: "controller",
              holderId: "controller",
              changedAt: now.toISOString()
            }),
            now
          ));
        }
      }
      return session;
    });
  }

  /**
   * Fast hook path: validates the native Turn boundary before it is either
   * retained as an intermediate child wait or recorded as a ready boundary
   * for later mailbox input. It never performs tmux, workspace, or Controller I/O.
   */
  classifyRuntimeTurnTerminal(input: Readonly<{
    taskId: string;
    roleName: string;
    agentId: string;
    adapterId: string;
    nativeSessionId: string;
    nativeTurnId?: string;
    attemptId?: string;
    turnId?: string;
    providerStatus: "completed" | "failed" | "cancelled";
    outcome: RuntimeTurnTerminalOutcome;
  }>): "apply" | "deferred" | "obsolete" {
    return resolveTerminalExecution(this.store, input) === null ? "obsolete" : "apply";
  }

  observeRuntimeTurnTerminal(input: Readonly<{
    taskId: string;
    roleName: string;
    agentId: string;
    adapterId: string;
    nativeSessionId: string;
    nativeTurnId?: string;
    attemptId?: string;
    turnId?: string;
    input?: string;
    providerStatus: "completed" | "failed" | "cancelled";
    outcome: RuntimeTurnTerminalOutcome;
    observation?: RuntimeObservation;
  }>, now = new Date()): Readonly<{
    session?: RoleAgentSession;
    duplicate: boolean;
    turn?: Turn;
    disposition?: "obsolete";
  }> {
    // Resource inspection is bounded but external to SQLite. Revalidate the
    // immutable Turn workspace after acquiring the write transaction.
    const preparedTurn = resolveTerminalExecution(this.store, input)?.turn;
    const workspace = preparedTurn?.status === "active"
      && preparedTurn.executionGroupId !== undefined
      && preparedTurn.executionLaneId !== undefined
      && preparedTurn.workspace !== undefined
      && input.outcome.status === "completed"
      ? this.snapshotExecutionLaneWorkspace(this.store, preparedTurn.workspace)
      : undefined;
    return this.store.transaction((store) => {
      const task = store.getTask(input.taskId);
      if (task === null) throw new Error(`Task not found: ${input.taskId}.`);
      if (task.status === "archived") {
        throw new Error(`Cannot complete a runtime turn for unavailable Task: ${input.taskId}.`);
      }
      const resolved = resolveTerminalExecution(store, input);
      if (resolved === null) throw new Error("Runtime terminal has no exact execution binding.");
      const { turn: observedTurn, current: recordedProviderTurn, attemptId } = resolved;
      if (!isDeepStrictEqual(preparedTurn?.workspace, observedTurn?.workspace)) {
        throw new Error("Runtime terminal workspace changed during result preparation.");
      }
      if (workspace !== undefined && observedTurn?.workspace !== undefined
        && !isDeepStrictEqual(store.getManagedWorkspace(observedTurn.workspace.owner), observedTurn.workspace)) {
        throw new Error("Runtime terminal workspace ownership changed during result preparation.");
      }
      let sessions = store.getTaskRoleSessionSet(input.taskId, input.roleName)
        ?? createRoleSessionSet(
          { scope: "task", taskId: input.taskId, roleName: input.roleName },
          input.agentId,
          now
        );
      const canonicalTurnId = input.nativeTurnId ?? resolved.nativeTurnId;
      const existing = sessions.sessions[input.agentId];
      const owner = {
        scope: "task" as const,
        taskId: input.taskId,
        roleName: input.roleName
      };
      assertConsistentTerminal(store, input, observedTurn);
      // A historical operation failure stays failed. The immutable terminal
      // observation retains the late report for explicit Leader adoption.
      // Never touch a successor Session, active pointer, mailbox or Review.
      if (!recordedProviderTurn || (observedTurn !== null && observedTurn.status !== "active")) {
        // A failed operation and a subsequently confirmed Provider outcome are
        // distinct facts. Settle only the still-owned original attempt, never
        // rewriting the historical Task result or a successor's binding.
        if (recordedProviderTurn && sessions.providerBinding?.turn !== null
          && sessions.providerBinding?.turn !== undefined
          && ["submitting", "accepted", "delivery-unknown"].includes(
            sessions.providerBinding.turn.status
          )) {
          if (sessions.providerBinding.turn.status !== "accepted") {
            sessions = updateTaskRoleProviderRuntime(sessions, acceptProviderTurn(sessions.providerBinding, {
              attemptId,
              ...(canonicalTurnId === undefined ? {} : { nativeTurnId: canonicalTurnId }),
              acceptedAt: now.toISOString()
            }), now);
          }
          sessions = settleStructuredProviderTurn(sessions, canonicalTurnId, input.providerStatus, now, attemptId);
          store.saveTaskRoleSessionSet(sessions);
        }
        if (input.observation !== undefined) this.persistRuntimeObservation(input.observation, now);
        return {
          ...(sessions.sessions[input.agentId] === undefined
            ? {} : { session: sessions.sessions[input.agentId] }),
          duplicate: true,
          ...(observedTurn === null ? {} : { turn: observedTurn })
        };
      }
      const pending = sessions.providerBinding!;
      if (pending.turn?.status === "submitting" || pending.turn?.status === "delivery-unknown") {
        sessions = updateTaskRoleProviderRuntime(sessions, acceptProviderTurn(pending, {
          attemptId,
          ...(canonicalTurnId === undefined ? {} : { nativeTurnId: canonicalTurnId }),
          acceptedAt: now.toISOString()
        }), now);
      }
      sessions = settleStructuredProviderTurn(
        sessions,
        canonicalTurnId,
        input.providerStatus,
        now,
        attemptId
      );
      if (canonicalTurnId !== undefined) sessions = recordTaskRoleTurnBoundary(sessions, {
        agentId: input.agentId,
        nativeSessionId: input.nativeSessionId,
        turnId: canonicalTurnId
      }, now);
      store.saveTaskRoleSessionSet(sessions);
      let terminalTurn: Turn | undefined;
      if (recordedProviderTurn && observedTurn?.status === "active") {
        const binding = sessions.providerBinding!;
        const conversation = binding.conversations.find((entry) => entry.conversationId === input.nativeSessionId)!;
        const providerStatus = input.providerStatus;
        let systemEvidence: Parameters<typeof terminalizeExactTaskTurn>[1]["systemEvidence"];
        let workspaceFailure: Parameters<typeof terminalizeExactTaskTurn>[1]["workspaceFailure"];
        if ((observedTurn.purpose === "execution" || observedTurn.purpose === "review")
          && observedTurn.executionGroupId !== undefined
          && observedTurn.executionLaneId !== undefined
          && observedTurn.workspace !== undefined
          && input.outcome.status === "completed") {
          const gitSnapshot = workspace!;
          if (gitSnapshot.status === "captured") {
            systemEvidence = { workspaceSnapshot: gitSnapshot.snapshot };
          } else {
            workspaceFailure = {
              failureReason: gitSnapshot.cause === "workspace-dirty"
                ? "workspace-dirty"
                : gitSnapshot.cause === "branch-mismatch"
                  ? "workspace-branch-mismatch"
                  : "workspace-unavailable",
              diagnostic: gitSnapshot.diagnostic
            };
          }
        }
        const terminalized = terminalizeExactTaskTurn(store, {
          taskId: input.taskId,
          roleName: input.roleName,
          agentId: input.agentId,
          turnId: observedTurn.id,
          nativeSessionId: input.nativeSessionId,
          outcome: {
            ...input.outcome,
            provider: {
              providerNamespace: binding.providerNamespace,
              accountScope: binding.accountScope,
              conversationId: conversation.conversationId,
              ...(canonicalTurnId === undefined ? {} : { nativeTurnId: canonicalTurnId }),
              attemptId,
              status: providerStatus
            }
          },
          ...(systemEvidence === undefined ? {} : { systemEvidence }),
          ...(workspaceFailure === undefined ? {} : { workspaceFailure })
        }, now);
        if (terminalized.disposition !== "applied" || terminalized.turn === null) {
          throw new Error(
            `Provider Turn terminal could not complete its exact Turn: ${
              terminalized.reason ?? "obsolete"
            }.`
          );
        }
        terminalTurn = terminalized.turn;
        const event = createTaskEvent(
          store.nextEventId(input.taskId),
          input.taskId,
          terminalTurn.status === "completed" ? "turn.completed" : "turn.failed",
          {
            turnId: terminalTurn.id,
            roleName: terminalTurn.roleName,
            ...(canonicalTurnId === undefined ? {} : { providerTurnId: canonicalTurnId }),
            providerStatus
          },
          now
        );
        store.saveEvent(input.taskId, event);
        // A structured failure routes its original runtime.agent-error below;
        // the Turn terminal is the same fact, not a second notification.
        const structuredFailure = input.observation?.kind === "turn.failed"
          && input.observation.payload.failure !== undefined;
        if (!structuredFailure && (
          terminalTurn.status === "failed"
          || (terminalTurn.roleName !== "leader" && !providerGoalContinues(binding.goal))
        )) {
          routeRoleEvent(
            store,
            event,
            terminalTurn.roleName,
            terminalTurn.purpose === "review" ? "review-result" : "role-turn-result",
            now
          );
        }
      }
      if (input.observation !== undefined) this.persistRuntimeObservation(input.observation, now);
      return {
        session: sessions.sessions[input.agentId]!,
        duplicate: false,
        ...(terminalTurn === undefined ? {} : { turn: terminalTurn })
      };
    });
  }

  saveRoleHostExitObservation(input: Readonly<{
    taskId: string;
    roleName: string;
    turnId: string;
    nativeSessionId?: string;
    deadStatus?: number;
    observedAt: Date;
  }>): void {
    this.store.transaction((store) => {
      const identity = [
        input.taskId,
        input.roleName,
        input.turnId,
        String(input.deadStatus ?? "unknown-status")
      ].join("\0");
      const observationId = `tmux-host-exit-${createHash("sha256").update(identity).digest("hex")}`;
      const events = store.listEvents(input.taskId);
      if (events.some((event) => (
        event.type === "runtime.process-exit-observed"
        && event.payload.observationId === observationId
      ))) return;
      const observation = validateRuntimeProcessExitObservation({
        schemaVersion: 2,
        observationId,
        hostSequence: 1,
        hostInstanceId: `tmux-${input.roleName}`,
        taskId: input.taskId,
        roleName: input.roleName,
        turnId: input.turnId,
        ...(input.nativeSessionId === undefined
          ? {}
          : { nativeSessionId: input.nativeSessionId }),
        processKind: "agent-host",
        ...(input.deadStatus === undefined ? {} : { exitCode: input.deadStatus }),
        observedAt: input.observedAt.toISOString()
      });
      const classification = classifyRuntimeProcessExit(observation, {});
      store.saveEvent(input.taskId, createTaskEvent(
        store.nextEventId(input.taskId),
        input.taskId,
        "runtime.process-exit-observed",
        {
          observationId,
          processKind: "agent-host",
          roleName: input.roleName,
          observedAt: observation.observedAt,
          classification,
          observation: JSON.stringify(observation)
        },
        input.observedAt
      ));
    });
  }

  /**
   * Issue 04: reopens each due retry on its original Native Session. A Turn
   * whose Session is proven dead terminalizes with an exact replacement
   * blocker; a live Session is reopened for the existing delivery path, which
   * re-pushes the exact same input in the same pass.
   */
  private observeProviderRuntimeIdentity(
    input: RuntimeObservation,
    now: Date
  ): ProviderLifecycleObservation {
    return this.store.transaction((store) => {
      const taskId = input.fence.taskId!;
      const sessions = store.getTaskRoleSessionSet(taskId, input.fence.roleName);
      if (sessions === null || sessions.providerBinding === null
        || input.fence.conversationId === undefined) {
        recordCanonicalObservationObsolete(store, input, "provider-binding-missing", now);
        return "obsolete";
      }
      let binding = sessions.providerBinding;
      if (input.fence.conversationId !== binding.conversations.find((entry) => (
        entry.epoch === binding.currentConversationEpoch
      ))?.conversationId) {
        recordCanonicalObservationObsolete(store, input, "provider-conversation-mismatch", now);
        return "obsolete";
      }
      try {
        if (input.kind === "conversation.observed") {
          binding = updateProviderConversationRecoverability(
            binding,
            input.payload.recoverability!
          );
        }
      } catch {
        recordCanonicalObservationObsolete(store, input, "provider-identity-conflict", now);
        return "obsolete";
      }
      store.saveTaskRoleSessionSet(updateTaskRoleProviderRuntime(sessions, binding, now));
      return "applied";
    });
  }

  private observeProviderGoal(
    input: RuntimeObservation,
    now: Date
  ): ProviderLifecycleObservation {
    return this.store.transaction((store) => {
      const taskId = input.fence.taskId!;
      const sessions = store.getTaskRoleSessionSet(taskId, input.fence.roleName);
      const binding = sessions?.providerBinding;
      if (sessions === null || sessions === undefined || binding === null || binding === undefined
        || input.fence.conversationId !== currentProviderConversation(binding).conversationId) {
        recordCanonicalObservationObsolete(store, input, "provider-goal-session-mismatch", now);
        return "obsolete";
      }
      const updated = input.kind === "goal.cleared"
        ? clearProviderGoal(binding)
        : updateProviderGoal(binding, {
            status: input.payload.goalStatus!,
            objective: input.payload.goalObjective!,
            updatedAt: input.payload.goalUpdatedAt!,
            ...(input.payload.goalNativeTurnId === undefined
              ? {}
              : { nativeTurnId: input.payload.goalNativeTurnId }),
            ...(input.payload.goalTokenBudget === undefined
              ? {}
              : { tokenBudget: input.payload.goalTokenBudget })
          });
      store.saveTaskRoleSessionSet(updateTaskRoleProviderRuntime(sessions, updated, now));
      return "applied";
    });
  }

  private observeRuntimeSession(
    input: RuntimeObservation,
    adapterId: string,
    now: Date
  ): ProviderLifecycleObservation {
    return this.store.transaction((store) => {
      const event = createCanonicalLifecycleEvent({
        phase: input.kind === "session.ready" ? "provider-ready" : "provider-session-started",
        source: "provider-native",
        evidence: "provider-native-durable",
        ...(input.kind === "session.ready"
          ? {
              preInputReady: true,
              readinessVariant: `${input.fence.driverId}:session.ready`
            }
          : {}),
        fence: runtimeObservationLifecycleFence(input, adapterId)
      });
      const decision = this.foldRuntimeLifecycleEvent(store, event, input);
      switch (decision.kind) {
        case "obsolete":
          recordCanonicalObservationObsolete(store, input, decision.reason, now);
          return "obsolete";
        case "deferred":
          return "deferred";
        case "idempotent":
          return "applied";
        case "apply": {
          if (decision.outcome.outcome === "mark-ready"
            && store.getTaskRoleSessionSet(input.fence.taskId!, input.fence.roleName)
              ?.sessions[input.fence.agentId] === undefined) {
            return preallocatedRuntimeReadyAwaitingProjection(store, input, this.drivers)
              ? "applied"
              : "deferred";
          }
          if (decision.outcome.outcome === "bind-native-session") {
            const taskId = input.fence.taskId!;
            const role = store.getRole(taskId, input.fence.roleName);
            const sessions = store.getTaskRoleSessionSet(taskId, input.fence.roleName);
            const run = store.getTurn(taskId, input.fence.turnId!);
            if (role === null || sessions === null || run === null) {
              recordCanonicalObservationObsolete(store, input, "bind-state-missing", now);
              return "obsolete";
            }
            const existingSession = sessions.sessions[input.fence.agentId];
            const existingNativeSessionId = existingSession?.nativeSessionId;
            const replacingNativeSession = existingNativeSessionId !== undefined
              && existingNativeSessionId !== decision.outcome.nativeSessionId;
            const replacementBasis = terminalSessionReplacementBasis(
              sessions,
              input,
              run
            ) ?? null;
            if (replacingNativeSession && replacementBasis === null) {
              recordCanonicalObservationObsolete(
                store,
                input,
                "session-replacement-not-terminal",
                now
              );
              return "obsolete";
            }
            const sessionInput = {
              agentId: input.fence.agentId,
              adapterId,
              nativeSessionId: decision.outcome.nativeSessionId,
              policy: "fixed" as const,
              status: "active" as const,
              effective: run.effective
            };
            const bound = replacementBasis === null
              ? recordRoleAgentSession(sessions, sessionInput, now)
              : replaceTaskRoleAgentSession(
                  sessions,
                  sessionInput,
                  now
                );
            const withProvider = bindOrSupersedeProviderRuntime(
              bound,
              input,
              now,
              replacementBasis
                ?? terminalProviderReplacementBasis(bound, input, run.mode)
            );
            store.saveTaskRoleSessionSet(withProvider);
          }
          const current = store.getTaskRoleSessionSet(
            input.fence.taskId!,
            input.fence.roleName
          );
          const currentSession = current?.sessions[input.fence.agentId];
          if (current !== null && current !== undefined
            && currentSession?.nativeSessionId === input.fence.nativeSessionId) {
            const run = input.fence.turnId === undefined
              ? null
              : store.getTurn(input.fence.taskId!, input.fence.turnId);
            const replacementBasis = run === null
              ? undefined
              : terminalSessionReplacementBasis(current, input, run)
                ?? terminalProviderReplacementBasis(current, input, run.mode);
            if (current.providerBinding !== null
              && currentProviderConversation(current.providerBinding).conversationId
                !== (input.fence.conversationId ?? input.fence.nativeSessionId)
              && replacementBasis === undefined) {
              recordCanonicalObservationObsolete(
                store,
                input,
                "session-replacement-not-terminal",
                now
              );
              return "obsolete";
            }
            store.saveTaskRoleSessionSet(bindOrSupersedeProviderRuntime(
              current,
              input,
              now,
              replacementBasis
            ));
          }
          return "applied";
        }
      }
    });
  }

  /** Provider acceptance is canonical before storage and remains receipt-fenced. */
  private observeRuntimePromptAccepted(
    input: RuntimeObservation,
    adapterId: string,
    now: Date
  ): ProviderLifecycleObservation {
    return this.store.transaction((store) => {
      const continuation = input.fence.receiptId?.startsWith("turn-input:") === true;
      const ordinaryAttemptId = input.fence.receiptId;
      if (!continuation && input.fence.turnId !== undefined) {
        const exact = resolveTerminalExecution(store, {
          taskId: input.fence.taskId!,
          roleName: input.fence.roleName,
          agentId: input.fence.agentId,
          adapterId,
          conversationId: input.fence.conversationId,
          nativeSessionId: input.fence.nativeSessionId!,
          nativeTurnId: input.fence.nativeTurnId,
          attemptId: ordinaryAttemptId,
          turnId: input.fence.turnId
        });
        if (exact === null) return "obsolete";
        // A terminal can prove acceptance before the delayed receipt. Retain
        // the receipt without recreating lifecycle state or touching a successor.
        if (!exact.current || exact.turn?.status !== "active") return "applied";
      }
      if (input.fence.turnId === undefined
        && ordinaryAttemptId?.startsWith("direct:") === true) {
        const taskId = input.fence.taskId!;
        const sessions = store.getTaskRoleSessionSet(taskId, input.fence.roleName);
        const session = sessions?.sessions[input.fence.agentId];
        const binding = sessions?.providerBinding;
        const nativeTurnId = input.fence.nativeTurnId!;
        const active = store.getActiveTurn(taskId, input.fence.roleName);
        if (sessions === null || sessions === undefined || binding === null || binding === undefined || session === undefined || session.nativeSessionId !== input.fence.nativeSessionId || currentProviderConversation(binding).conversationId !== input.fence.nativeSessionId) {
          recordCanonicalObservationObsolete(store, input, "direct-turn-session-mismatch", now);
          return "obsolete";
        }
        if (binding.turn?.attemptId === ordinaryAttemptId
          && binding.turn.nativeTurnId === nativeTurnId
          && binding.turn.turnId !== undefined
          && active?.id === binding.turn.turnId) {
          return "applied";
        }
        if (active !== null) {
          recordCanonicalObservationObsolete(store, input, "direct-turn-conflicts-with-active-turn", now);
          return "obsolete";
        }
        const turnId = store.nextTurnId(taskId);
        const goalContinuation = input.payload.input === undefined
          && providerGoalContinues(binding.goal);
        const direct = createTurn(
          turnId,
          taskId,
          input.fence.roleName,
          "resume",
          createTurnInput({
            source: goalContinuation
              ? { type: "provider", channel: "goal-continuation" }
              : { type: "user", channel: "direct" },
            ...(input.payload.input === undefined
              ? {}
              : { directive: input.payload.input }),
            deltaRefIds: []
          }),
          now,
          { effective: session.effective }
        );
        const submittedAt = input.observedAt ?? input.receivedAt;
        const accepted = acceptProviderTurn(beginProviderTurn(binding, {
          turnId,
          attemptId: ordinaryAttemptId,
          authorityEpoch: binding.authority.epoch,
          submittedAt
        }), {
          attemptId: ordinaryAttemptId,
          nativeTurnId,
          acceptedAt: submittedAt
        });
        store.saveTurn(direct);
        store.saveActiveTurn(direct);
        store.saveTaskRoleSessionSet(updateTaskRoleProviderRuntime(sessions, accepted, now));
        store.saveEvent(taskId, createTaskEvent(
          store.nextEventId(taskId),
          taskId,
          "turn.dispatched",
          turnLaunchEventPayload(direct),
          now
        ));
        return "applied";
      }
      if (ordinaryAttemptId !== undefined) {
        const sessions = store.getTaskRoleSessionSet(
          input.fence.taskId!,
          input.fence.roleName
        );
        const session = sessions?.sessions[input.fence.agentId];
        const binding = sessions?.providerBinding;
        if (sessions !== null && sessions !== undefined
          && binding !== null && binding !== undefined
          && binding.turn?.turnId === undefined
          && binding.turn?.attemptId === ordinaryAttemptId) {
          if (session === undefined || session.nativeSessionId !== input.fence.nativeSessionId) {
            recordCanonicalObservationObsolete(store, input, "ordinary-turn-session-mismatch", now);
            return "obsolete";
          }
          store.saveTaskRoleSessionSet(recordStructuredProviderAcceptance(
            sessions,
            input,
            now
          ));
          return "applied";
        }
      }
      if (continuation) {
        const active = store.getActiveTurn(input.fence.taskId!, input.fence.roleName);
        const sessions = store.getTaskRoleSessionSet(
          input.fence.taskId!,
          input.fence.roleName
        );
        const session = sessions?.sessions[input.fence.agentId];
        if (active === null || active.id !== input.fence.turnId || active.status !== "active" || sessions === null || sessions === undefined || session === undefined || session.nativeSessionId !== input.fence.nativeSessionId) {
          recordCanonicalObservationObsolete(store, input, "continuation-fence-mismatch", now);
          return "obsolete";
        }
        store.saveTaskRoleSessionSet(recordStructuredProviderAcceptance(
          sessions,
          input,
          now
        ));
        store.saveEvent(input.fence.taskId!, createTaskEvent(
          store.nextEventId(input.fence.taskId!),
          input.fence.taskId!,
          "turn.input-delivered",
          {
            attemptId: input.fence.receiptId!,
            turnId: active.id,
            conversationId: input.fence.conversationId ?? input.fence.nativeSessionId!,
            ...(input.fence.nativeTurnId === undefined
              ? {}
              : { nativeTurnId: input.fence.nativeTurnId })
          },
          now
        ));
        return "applied";
      }
      const event = createCanonicalLifecycleEvent({
        phase: "provider-accepted",
        source: "provider-native",
        evidence: "provider-native-durable",
        fence: runtimeObservationLifecycleFence(input, adapterId)
      });
      const decision = this.foldRuntimeLifecycleEvent(store, event, input);
      if (decision.kind === "obsolete") {
        recordCanonicalObservationObsolete(store, input, decision.reason, now);
        return "obsolete";
      }
      if (decision.kind === "deferred") return "deferred";
      if (decision.kind === "idempotent") return "applied";
      const active = store.getActiveTurn(input.fence.taskId!, input.fence.roleName);
      if (active === null
        || active.id !== input.fence.turnId
        || active.status !== "active") {
        recordCanonicalObservationObsolete(store, input, "turn-not-active", now);
        return "obsolete";
      }
      const sessions = store.getTaskRoleSessionSet(
        input.fence.taskId!,
        input.fence.roleName
      );
      if (sessions !== null) {
        store.saveTaskRoleSessionSet(recordStructuredProviderAcceptance(
          sessions,
          input,
          now
        ));
      }
      return "applied";
    });
  }

  private foldRuntimeLifecycleEvent(
    store: TaskStore,
    event: ReturnType<typeof createCanonicalLifecycleEvent>,
    observation: RuntimeObservation
  ): Readonly<
    | { kind: "apply"; outcome: ReturnType<typeof foldCanonicalLifecycleEvent> }
    | { kind: "idempotent"; reason: string }
    | { kind: "deferred"; reason: string }
    | { kind: "obsolete"; reason: string }
  > {
    const expectation = this.projectTurnExpectation(
      store,
      event.fence,
      observation.fence.turnId
    );
    if (expectation === null) {
      return preallocatedRuntimeReadyAwaitingProjection(
        store,
        observation,
        this.drivers
      )
        ? { kind: "apply", outcome: { outcome: "mark-ready", preInputReady: true } }
        : { kind: "obsolete", reason: "turn-or-role-missing" };
    }
    const outcome = foldCanonicalLifecycleEvent(event, expectation);
    switch (outcome.outcome) {
      case "obsolete":
        return { kind: "obsolete", reason: outcome.reason };
      case "fail-closed":
        return { kind: "obsolete", reason: `fail-closed:${outcome.reason}` };
      case "deferred":
        return { kind: "deferred", reason: outcome.reason };
      case "idempotent":
        return { kind: "idempotent", reason: outcome.reason };
      default:
        return { kind: "apply", outcome };
    }
  }

  /** Reads durable Turn + Session state into the pure fold's expectation shape. */
  private projectTurnExpectation(
    store: TaskStore,
    fence: CanonicalIdentityFence,
    turnId: string | undefined
  ): CanonicalTurnExpectation | null {
    const role = store.getRole(fence.taskId, fence.roleName);
    if (role === null) return null;
    const sessionSet = store.getTaskRoleSessionSet(fence.taskId, fence.roleName);
    const session = sessionSet?.sessions[fence.agentId] ?? null;
    if (turnId === undefined) {
      return {
        fence,
        sessionStarted: false,
        ready: false,
        pushed: false,
        accepted: false,
        terminal: false,
        ...(session?.nativeSessionId === undefined
          ? {}
          : { boundNativeSessionId: session.nativeSessionId })
      };
    }
    const run = store.getTurn(fence.taskId, turnId);
    if (run === null || run.status !== "active") return null;
    const freshConversationLaunch = run.mode === "new" && session?.status !== "active";
    const boundNativeSessionId = freshConversationLaunch
      ? undefined
      : session?.nativeSessionId;
    const providerTurn = sessionSet?.providerBinding?.turn;
    const managedTurnMatches = managedProviderTurnId(providerTurn) === run.id;
    const expectedFence: CanonicalIdentityFence = {
      taskId: fence.taskId,
      roleName: fence.roleName,
      agentId: run.effective.agentId,
      adapterId: run.effective.adapterId,
      turnId: run.id,
      receiptId: managedTurnMatches && providerTurn !== null && providerTurn !== undefined
        ? providerTurn.attemptId
        : formatTurnReceiptId(run.taskId, run.id),
      ...(boundNativeSessionId === undefined ? {} : { nativeSessionId: boundNativeSessionId })
    };
    const driverId = this.drivers.requireByAdapterId(run.effective.adapterId).id;
    const lifecycleEvents = store.listEvents(fence.taskId).flatMap((event) => {
      const observation = runtimeObservationFromTaskEvent(event);
      return observation !== null && (observation.kind === "session.started" || observation.kind === "session.ready") && observation.fence.roleName === fence.roleName && observation.fence.agentId === run.effective.agentId && observation.fence.driverId === driverId && observation.fence.nativeSessionId === (boundNativeSessionId ?? fence.nativeSessionId)
        ? [observation]
        : [];
    });
    return {
      fence: expectedFence,
      sessionStarted: lifecycleEvents.length > 0,
      ready: lifecycleEvents.some((event) => event.kind === "session.ready"),
      pushed: managedTurnMatches,
      accepted: managedTurnMatches && providerTurn !== null && providerTurn !== undefined
        && ["accepted", "completed", "failed", "cancelled"]
          .includes(providerTurn.status),
      terminal: run.status !== "active",
      ...(boundNativeSessionId === undefined ? {} : { boundNativeSessionId })
    };
  }

  observeObsoleteRuntimeEvent(input: Readonly<{
    eventId: string;
    eventType: string;
    taskId: string;
    roleName: string;
    agentId: string;
    turnId?: string;
    nativeSessionId: string;
    reason: string;
  }>, now = new Date()): void {
    this.store.transaction((store) => {
      if (store.getTask(input.taskId) === null) return;
      recordObsoleteRuntimeEvent(store, input, input.reason, now);
    });
  }

  recordGlobalRuntimeNativeSession(input: Readonly<{
    roleName: string;
    agentId: string;
    adapterId: string;
    nativeSessionId: string;
  }>, now = new Date()): RoleAgentSession {
    return this.store.transaction((store) => (
      recordGlobalRuntimeNativeSession(store, input, now)
    ));
  }

  observeGlobalRuntimeTurnTerminal(input: Readonly<{
    roleName: string;
    agentId: string;
    adapterId: string;
    nativeSessionId: string;
    nativeTurnId: string;
    title?: string;
    providerStatus: "completed" | "failed" | "cancelled";
    outcome: RuntimeTurnTerminalOutcome;
  }>, now = new Date()): RoleAgentSession {
    return this.store.transaction((store) => {
      const role = store.getGlobalRole(input.roleName);
      if (role === null) throw new Error(`Global Role not found: ${input.roleName}.`);
      let current: GlobalRoleSessionSet = store.getGlobalRoleSessionSet(input.roleName)
        ?? createRoleSessionSet(
          { scope: "global", roleName: input.roleName },
          input.agentId,
          now
        );
      const existing = current.sessions[input.agentId];
      const owner = {
        scope: "global" as const,
        roleName: input.roleName
      };
      if (
        existing === undefined && !runtimeHookMatchesLaunchIntent(store, owner)
      ) {
        throw new Error(
          "Runtime turn completion has no matching global Session intent."
        );
      }
      const nativeSessionId = input.nativeSessionId;
      const effectiveExisting = nativeTransitionExisting(
        store,
        owner,
        existing,
        nativeSessionId,
        "Runtime turn completion conflicts with the fixed global Role session."
      );
      const effective = globalSessionEffective(role, effectiveExisting);
      if (effective.agentId !== input.agentId || effective.adapterId !== input.adapterId) {
        throw new Error("Runtime turn completion does not match the effective global runtime identity.");
      }
      const completedStatus = effectiveExisting?.status ?? "active";
      current = recordRoleAgentSession(current, {
        agentId: input.agentId,
        adapterId: input.adapterId,
        nativeSessionId,
        title: effectiveExisting?.title ?? input.title,
        preview: effectiveExisting?.preview ?? sessionPreview(
          input.outcome.status === "completed"
            ? input.outcome.output
            : input.outcome.diagnostic
        ),
        policy: "fixed",
        status: completedStatus,
        ...(effectiveExisting?.endReason === undefined
          ? {}
          : { endReason: effectiveExisting.endReason }),
        effective
      }, now);
      current = rememberRoleAgentCompletedTurn(
        current,
        input.agentId,
        nativeSessionId,
        input.nativeTurnId,
        now
      );
      store.saveGlobalRoleSessionSet(current);
      if (
        input.roleName === SYSTEM_OPERATOR_ROLE
        && input.adapterId === "codex"
        && completedStatus === "active"
      ) {
        const operatorMailbox = store.getWorkMailbox({ kind: "operator" });
        // A completed foreground Codex Turn leaves its native TUI attached to
        // the thread. Stop only that idle Role runtime so Desktop can become
        // the writer; the durable nativeSessionId remains available to resume.
        if (operatorMailbox === null || !mailboxHasWork(operatorMailbox)) {
          enqueueWork(
            store,
            runtimeLifecycleTarget(owner),
            RUNTIME_HOST_DETACH_REQUIRED_REASON,
            now
          );
        }
      }
      return current.sessions[input.agentId]!;
    });
  }

  classifyGlobalRuntimeTurnTerminal(input: Readonly<{
    roleName: string;
    agentId: string;
    adapterId: string;
    nativeSessionId: string;
    providerStatus: "completed" | "failed" | "cancelled";
    outcome: RuntimeTurnTerminalOutcome;
  }>): "apply" | "obsolete" {
    const role = this.store.getGlobalRole(input.roleName);
    if (role === null) return "obsolete";
    const existing = this.store.getGlobalRoleSessionSet(input.roleName)
      ?.sessions[input.agentId];
    const owner = {
      scope: "global" as const,
      roleName: input.roleName
    };
    if (
      existing === undefined && !runtimeHookMatchesLaunchIntent(this.store, owner)
    ) return "obsolete";
    const nativeSessionId = input.nativeSessionId;
    let effectiveExisting: RoleAgentSession | undefined;
    try {
      effectiveExisting = nativeTransitionExisting(
        this.store,
        owner,
        existing,
        nativeSessionId,
        "Runtime turn completion conflicts with the fixed global Role session."
      );
    } catch {
      return "obsolete";
    }
    const effective = globalSessionEffective(role, effectiveExisting);
    if (effective.agentId !== input.agentId || effective.adapterId !== input.adapterId) {
      return "obsolete";
    }
    return "apply";
  }
}

function runtimeObservationLifecycleFence(
  input: RuntimeObservation,
  adapterId: string
): CanonicalIdentityFence {
  return {
    taskId: input.fence.taskId!,
    roleName: input.fence.roleName,
    agentId: input.fence.agentId,
    adapterId,
    ...(input.fence.turnId === undefined ? {} : { turnId: input.fence.turnId }),
    ...(input.fence.nativeSessionId === undefined
      ? {}
      : { nativeSessionId: input.fence.nativeSessionId }),
    ...(input.fence.receiptId === undefined ? {} : { receiptId: input.fence.receiptId })
  };
}

/**
 * A live parent Turn still owns its native child result. Only after that Turn
 * is terminal or absent does Yui route the continuation fact to the original
 * Role's supervisor. Mailbox coalescing remains the downstream batching
 * mechanism; this guard decides ownership before any wake is enqueued.
 */
function routeContinuationResult(
  store: TaskStore,
  observation: RuntimeObservation,
  event: TaskEvent,
  reason: string,
  now: Date
): void {
  const taskId = observation.fence.taskId;
  if (taskId === undefined) return;
  const parentTurn = observation.fence.turnId === undefined
    ? null
    : store.getTurn(taskId, observation.fence.turnId);
  if (parentTurn?.status === "active") return;
  if (store.getRole(taskId, observation.fence.roleName) === null) return;
  routeRoleEvent(
    store,
    event,
    observation.fence.roleName,
    reason,
    now
  );
}

/** Accepts the original Turn receipt or a later mailbox activation receipt. */
function runtimeReceiptBelongsToTurn(
  store: TaskStore,
  input: RuntimeObservation
): boolean {
  const taskId = input.fence.taskId!;
  const turnId = input.fence.turnId!;
  const receiptId = input.fence.receiptId;
  if (receiptId === formatTurnReceiptId(taskId, turnId)) return true;
  if (receiptId === undefined) return false;
  return store.listEvents(taskId).some((event) => {
    const accepted = runtimeObservationFromTaskEvent(event);
    return accepted?.kind === "turn.accepted" && accepted.fence.turnId === turnId && accepted.fence.roleName === input.fence.roleName && accepted.fence.agentId === input.fence.agentId && accepted.fence.nativeSessionId === input.fence.nativeSessionId && accepted.fence.receiptId === receiptId;
  });
}

function recordCanonicalObservationObsolete(
  store: TaskStore,
  input: RuntimeObservation,
  reason: string,
  now: Date
): void {
  const taskId = input.fence.taskId;
  if (taskId === undefined) return;
  recordObsoleteRuntimeEvent(store, {
    eventId: input.eventId,
    dedupeKey: input.semanticKey,
    eventType: input.kind,
    taskId,
    roleName: input.fence.roleName,
    agentId: input.fence.agentId,
    ...(input.fence.turnId === undefined ? {} : { turnId: input.fence.turnId }),
    ...(input.fence.nativeSessionId === undefined ? {} : { nativeSessionId: input.fence.nativeSessionId })
  }, reason, now);
}

function recordObsoleteRuntimeEvent(
  store: TaskStore,
  input: Readonly<{
    eventId: string;
    dedupeKey?: string;
    eventType?: string;
    type?: string;
    taskId: string;
    roleName: string;
    agentId: string;
    turnId?: string;
    nativeSessionId?: string;
  }>,
  reason: string,
  now: Date
): void {
  if (store.listEvents(input.taskId).some((event) => (
    event.type === "runtime.event-obsolete"
    && (event.payload.dedupeKey ?? event.payload.eventId) === (input.dedupeKey ?? input.eventId)
  ))) return;
  store.saveEvent(input.taskId, createTaskEvent(
    store.nextEventId(input.taskId),
    input.taskId,
    "runtime.event-obsolete",
    {
      eventId: input.eventId,
      ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
      eventType: input.eventType ?? input.type ?? "unknown",
      roleName: input.roleName,
      agentId: input.agentId,
      ...(input.nativeSessionId === undefined ? {} : { nativeSessionId: input.nativeSessionId }),
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      reason
    },
    now
  ));
}

function sessionPreview(value: string): string {
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  const truncated = normalized.slice(0, 1_024);
  return /[\uD800-\uDBFF]$/.test(truncated)
    ? truncated.slice(0, -1)
    : truncated;
}

function runtimeHookMatchesLaunchIntent(
  store: TaskStore,
  owner: RuntimeRoleOwner
): boolean {
  const mailbox = store.getWorkMailbox(runtimeLifecycleTarget(owner));
  if (hasRuntimeCleanupObligation(mailbox)) return false;
  if (owner.scope === "global") return true;
  return store.getActiveTurn(owner.taskId, owner.roleName)?.mode === "new";
}

function preallocatedRuntimeReadyAwaitingProjection(
  store: TaskStore,
  observation: RuntimeObservation,
  drivers: AgentDriverRegistry
): boolean {
  const taskId = observation.fence.taskId;
  const turnId = observation.fence.turnId;
  const nativeSessionId = observation.fence.nativeSessionId;
  const driver = drivers.find(observation.fence.driverId);
  if (observation.kind !== "session.ready"
    || driver?.capabilities.observation.sessionBootstrap !== "preallocated"
    || taskId === undefined
    || turnId === undefined
    || nativeSessionId === undefined) return false;

  const task = store.getTask(taskId);
  const role = store.getRole(taskId, observation.fence.roleName);
  const run = store.getActiveTurn(taskId, observation.fence.roleName);
  const sessions = store.getTaskRoleSessionSet(taskId, observation.fence.roleName);
  if (task?.status !== "active"
    || task.executionGate.state !== "enabled"
    || role?.activeAgentId !== observation.fence.agentId
    || run?.id !== turnId
    || run.status !== "active"
    || run.effective.agentId !== observation.fence.agentId
    || run.effective.adapterId !== driver.adapterId
    || observation.fence.receiptId !== formatTurnReceiptId(run.taskId, run.id)
    || sessions?.sessions[observation.fence.agentId] !== undefined) return false;

  const mailbox = store.getWorkMailbox(runtimeLifecycleTarget({
    scope: "task",
    taskId,
    roleName: observation.fence.roleName
  }));
  return !hasRuntimeCleanupObligation(mailbox);
}

function saveRuntimeLifecycleMailbox(
  store: TaskStore,
  mailbox: WorkMailbox
): void {
  if (!mailboxHasWork(mailbox)) {
    store.removeWorkMailbox(mailbox.target);
    return;
  }
  store.saveWorkMailbox(mailbox);
}

function runtimeOwnerFromTarget(
  target: RuntimeLifecycleTarget
): RuntimeRoleOwner {
  return target.kind === "role-runtime"
    ? {
        scope: "task",
        taskId: target.taskId,
        roleName: target.roleName
      }
    : {
        scope: "global",
        roleName: target.roleName
      };
}

function sameRuntimeOwner(
  left: RuntimeRoleOwner,
  right: RuntimeRoleOwner
): boolean {
  return left.scope === "task"
    ? right.scope === "task"
      && left.taskId === right.taskId
      && left.roleName === right.roleName
    : right.scope === "global" && left.roleName === right.roleName;
}

function dormantRuntimeCandidateIsCurrent(
  store: TaskStore,
  candidate: DormantRuntimeOwnerCandidate
): boolean {
  const { owner } = candidate;
  if (hasRuntimeLifecycleWork(
    store.getWorkMailbox(runtimeLifecycleTarget(owner))
  )) {
    return false;
  }
  if (
    owner.scope === "task"
    && store.getActiveTurn(owner.taskId, owner.roleName) !== null
  ) {
    return false;
  }
  const sessions = runtimeOwnerSessionSet(store, owner);
  const active = sessions?.sessions[sessions.activeAgentId];
  return active !== undefined && active.status === "active" && active.agentId === candidate.agentId && active.adapterId === candidate.adapterId && active.nativeSessionId === candidate.nativeSessionId && active.updatedAt === candidate.sessionUpdatedAt;
}

function endRuntimeOwnerSession(
  store: TaskStore,
  owner: RuntimeRoleOwner,
  now: Date
): boolean {
  if (owner.scope === "task") {
    const sessions = store.getTaskRoleSessionSet(
      owner.taskId,
      owner.roleName
    );
    if (sessions === null) return false;
    const active = sessions.sessions[sessions.activeAgentId];
    if (active === undefined) return false;
    let stopped = active.status === "ended"
      ? sessions
      : updateRoleAgentSessionStatus(
          sessions,
          sessions.activeAgentId,
          "ended",
          now,
          "stopped"
        );
    if (stopped === sessions) return false;
    store.saveTaskRoleSessionSet(stopped);
    return true;
  }
  const sessions = store.getGlobalRoleSessionSet(owner.roleName);
  if (sessions === null) return false;
  const active = sessions.sessions[sessions.activeAgentId];
  if (active === undefined || active.status === "ended") return false;
  store.saveGlobalRoleSessionSet(updateRoleAgentSessionStatus(
    sessions,
    sessions.activeAgentId,
    "ended",
    now,
    "stopped"
  ));
  return true;
}

function detachRuntimeOwnerHost(
  store: TaskStore,
  owner: RuntimeRoleOwner,
  now: Date
): boolean {
  if (owner.scope === "task") {
    const sessions = store.getTaskRoleSessionSet(owner.taskId, owner.roleName);
    if (sessions === null) return false;
    const detached = detachRoleAgentSessionHost(sessions, now);
    if (detached === sessions) return false;
    store.saveTaskRoleSessionSet(detached);
    return true;
  }
  const sessions = store.getGlobalRoleSessionSet(owner.roleName);
  if (sessions === null) return false;
  const detached = detachRoleAgentSessionHost(sessions, now);
  if (detached === sessions) return false;
  store.saveGlobalRoleSessionSet(detached);
  return true;
}

function runtimeOwnerSessionSet(
  store: TaskStore,
  owner: RuntimeRoleOwner
): TaskRoleSessionSet | GlobalRoleSessionSet | null {
  return owner.scope === "task"
    ? store.getTaskRoleSessionSet(owner.taskId, owner.roleName)
    : store.getGlobalRoleSessionSet(owner.roleName);
}

function recordTaskRuntimeNativeSession(
  store: TaskStore,
  input: Readonly<{
    taskId: string;
    roleName: string;
    agentId: string;
    adapterId: string;
    nativeSessionId: string;
    effective?: EffectiveLaunchSnapshot;
  }>,
  now: Date
): RoleAgentSession {
  const task = store.getTask(input.taskId);
  if (task === null) throw new Error(`Task not found: ${input.taskId}.`);
  if (task.status === "archived") {
    throw new Error(`Cannot register a native session for archived Task: ${input.taskId}.`);
  }
  if (task.status !== "active" || task.executionGate.state !== "enabled") {
    throw new Error(
      `Cannot register a native session for a Task that is not active: ${input.taskId}.`
    );
  }
  const role = requireRole(store, input.taskId, input.roleName);
  if (role.activeAgentId !== input.agentId
    || activeRoleAgentBinding(role).adapterId !== input.adapterId) {
    throw new Error("Native Session registration does not match the active Role Agent.");
  }
  const current = store.getRoleSessionSet(input.taskId, input.roleName)
    ?? createRoleSessionSet(
      { scope: "task", taskId: input.taskId, roleName: input.roleName },
      input.agentId,
      now
    );
  const existing = current.sessions[input.agentId];
  const effectiveExisting = nativeTransitionExisting(
    store,
    { scope: "task", taskId: input.taskId, roleName: input.roleName },
    existing,
    input.nativeSessionId,
    "Native session registration conflicts with the fixed Role session."
  );
  if (existing?.status === "active") return existing;
  const resolvedEffective = taskSessionEffective(
    store,
    input.taskId,
    input.roleName,
    input.agentId,
    effectiveExisting
  );
  const effective = input.effective === undefined
    ? resolvedEffective
    : validateEffectiveLaunchSnapshot(input.effective);
  if (!roleSessionMayContinue(
    resolvedEffective,
    effective
  )) {
    throw new Error("Native Session effective launch changed before persistence.");
  }
  if (effective.agentId !== input.agentId || effective.adapterId !== input.adapterId) {
    throw new Error("Native session registration does not match the effective runtime identity.");
  }
  const updated = recordRoleAgentSession(current, {
    agentId: input.agentId,
    adapterId: input.adapterId,
    nativeSessionId: input.nativeSessionId,
    policy: "fixed",
    status: "active",
    effective: effectiveExisting?.effective ?? effective
  }, now);
  store.saveRoleSessionSet(updated);
  return updated.sessions[input.agentId]!;
}

function recordGlobalRuntimeNativeSession(
  store: TaskStore,
  input: Readonly<{
    roleName: string;
    agentId: string;
    adapterId: string;
    nativeSessionId: string;
    effective?: EffectiveLaunchSnapshot;
  }>,
  now: Date
): RoleAgentSession {
  const role = store.getGlobalRole(input.roleName);
  if (role === null) throw new Error(`Global Role not found: ${input.roleName}.`);
  if (role.activeAgentId !== input.agentId
    || role.agentBindings[role.activeAgentId]?.adapterId !== input.adapterId) {
    throw new Error("Native Session registration does not match the active global Role Agent.");
  }
  const current: GlobalRoleSessionSet = store.getGlobalRoleSessionSet(input.roleName)
    ?? createRoleSessionSet(
      { scope: "global", roleName: input.roleName },
      input.agentId,
      now
    );
  const existing = current.sessions[input.agentId];
  const effectiveExisting = nativeTransitionExisting(
    store,
    { scope: "global", roleName: input.roleName },
    existing,
    input.nativeSessionId,
    "Native session registration conflicts with the fixed global Role session."
  );
  if (existing?.status === "active") return existing;
  const resolvedEffective = globalSessionEffective(role, effectiveExisting);
  const effective = input.effective === undefined
    ? resolvedEffective
    : validateEffectiveLaunchSnapshot(input.effective);
  if (!roleSessionMayContinue(resolvedEffective, effective)) {
    throw new Error("Global native Session effective launch changed before persistence.");
  }
  if (effective.agentId !== input.agentId || effective.adapterId !== input.adapterId) {
    throw new Error("Native session registration does not match the effective global runtime identity.");
  }
  const updated = recordRoleAgentSession(current, {
    agentId: input.agentId,
    adapterId: input.adapterId,
    nativeSessionId: input.nativeSessionId,
    policy: "fixed",
    status: "active",
    effective
  }, now);
  store.saveGlobalRoleSessionSet(updated);
  return updated.sessions[input.agentId]!;
}

function nativeTransitionExisting(
  store: TaskStore,
  owner: RuntimeRoleOwner,
  existing: RoleAgentSession | undefined,
  nativeSessionId: string,
  conflictMessage: string
): RoleAgentSession | undefined {
  if (existing === undefined || existing.nativeSessionId === nativeSessionId) {
    return existing;
  }
  if (
    existing.status === "ended" && runtimeHookMatchesLaunchIntent(store, owner)
  ) {
    return undefined;
  }
  throw new Error(conflictMessage);
}

function mapRole(
  store: TaskStore,
  role: NonNullable<ReturnType<TaskStore["getRole"]>>
): SchedulerRole {
  const binding = activeRoleAgentBinding(role);
  const item = store.listWorkItems(role.taskId).find((candidate) => (
    candidate.assignee === role.name
      && !["accepted", "retired"].includes(candidate.status)
  )) ?? null;
  const workspace = (item === null
    ? store.getTaskWorkspace(role.taskId)
    : store.getWorkItemWorkspace(role.taskId, item.id))
    ?? store.getTaskWorkspace(role.taskId)
    ?? undefined;
  const reopened = role.name === "leader"
    && store.getPendingWakeup(role.taskId)?.reasons.includes("task-reopened") === true;
  const liveSession = activeLiveRoleAgentSession(
    store.getTaskRoleSessionSet(role.taskId, role.name)
  );
  // This projection plans future dispatch. A live Session retains its actual
  // source, but cannot silently override an explicit next-Agent selection.
  // Active Turn delivery separately and exclusively uses turn.effective.
  const effective = reopened || (liveSession !== null && liveSession.agentId !== role.activeAgentId)
    ? resolveEffectiveLaunch({
        role,
        purpose: "execution",
        ...(workspace === undefined ? {} : { workspace })
      })
    : liveSession !== null && workspace?.owner.type === "task"
      ? effectiveLaunchWithTaskMainWorkspace(liveSession.effective, workspace)
      : liveSession?.effective ?? resolveEffectiveLaunch({
          role,
          purpose: "execution",
          ...(workspace === undefined ? {} : { workspace })
        });
  return {
    taskId: role.taskId,
    name: role.name,
    activeAgentId: role.activeAgentId,
    adapterId: binding.adapterId,
    ...(binding.config.model === undefined ? {} : { model: binding.config.model }),
    ...(binding.config.effort === undefined ? {} : { effort: binding.config.effort }),
    effective,
    workspace: role.workspace,
    ...(workspace === undefined ? {} : { managedWorkspace: workspace })
  };
}

function taskSessionEffective(
  store: TaskStore,
  taskId: string,
  roleName: string,
  agentId: string,
  existing: RoleAgentSession | undefined
) {
  const active = store.getActiveTurn(taskId, roleName);
  if (active !== null) {
    if (active.effective.agentId !== agentId) {
      throw new Error(
        `Native Session registration does not match the effective Turn Agent: ${taskId}/${roleName}.`
      );
    }
    if (existing !== undefined) {
      if (!roleSessionMayContinue(
        existing.effective,
        active.effective
      )) {
        throw new Error(
          `Native Session effective launch does not match the active Turn: ${taskId}/${roleName}.`
        );
      }
      return existing.effective;
    }
    return active.effective;
  }
  if (existing !== undefined) return existing.effective;
  const role = store.getRole(taskId, roleName);
  if (role === null) throw new Error(`Role not found: ${taskId}/${roleName}.`);
  const item = store.listWorkItems(taskId).find((candidate) => (
    candidate.assignee === roleName
      && !["accepted", "retired"].includes(candidate.status)
  )) ?? null;
  const workspace = (item === null
    ? store.getTaskWorkspace(taskId)
    : store.getWorkItemWorkspace(taskId, item.id))
    ?? store.getTaskWorkspace(taskId)
    ?? undefined;
  const effective = resolveEffectiveLaunch({
    role,
    purpose: "execution",
    ...(workspace === undefined ? {} : { workspace }),
    ...(item === null ? {} : { workItemWriteProjectIds: item.writeProjectIds })
  });
  if (effective.agentId !== agentId) {
    throw new Error(`Native Session registration does not match Role desired Agent: ${agentId}.`);
  }
  return effective;
}

function globalSessionEffective(
  role: Parameters<typeof resolveEffectiveLaunch>[0]["role"],
  existing: RoleAgentSession | undefined,
) {
  return existing?.effective ?? resolveEffectiveLaunch({ role, purpose: "execution" });
}

function mapSession(session: RoleAgentSession): SchedulerRoleSession {
  return {
    agentId: session.agentId,
    adapterId: session.adapterId,
    nativeSessionId: session.nativeSessionId,
    ...(session.title === undefined ? {} : { title: session.title }),
    status: session.status,
    ...(session.endReason === undefined ? {} : { endReason: session.endReason }),
    effective: session.effective,
    updatedAt: session.updatedAt
  };
}

function saveTaskSession(
  store: TaskStore,
  role: NonNullable<ReturnType<TaskStore["getRole"]>>,
  session: SchedulerRoleSession & { nativeSessionId: string },
  status: AgentSessionStatus,
  now: Date
): void {
  const current = store.getRoleSessionSet(role.taskId, role.name)
    ?? createRoleSessionSet(
      { scope: "task", taskId: role.taskId, roleName: role.name },
      session.agentId,
      now
    );
  const updated = recordRoleAgentSession(current, {
    agentId: session.agentId,
    adapterId: session.adapterId,
    nativeSessionId: session.nativeSessionId,
    ...(session.title === undefined ? {} : { title: session.title }),
    policy: "fixed",
    status,
    ...(status !== "ended" || session.endReason === undefined
      ? {}
      : { endReason: session.endReason }),
    effective: session.effective
  }, now);
  store.saveRoleSessionSet(updated);
}

function matchesStallSessionFence(
  current: SchedulerRoleSession | null,
  expected: RoleTurnStallPersistence["session"]
): boolean {
  if (current === null || expected === null) return current === expected;
  return current.agentId === expected.agentId && current.adapterId === expected.adapterId && current.nativeSessionId === expected.nativeSessionId && current.status === expected.status;
}

function requireRole(store: TaskStore, taskId: string, roleName: string) {
  const role = store.getRole(taskId, roleName);
  if (role === null) throw new Error(`Role not found: ${taskId}/${roleName}.`);
  return role;
}

function turnLaunchEventPayload(turn: Turn): Record<string, string> {
  return {
    turnId: turn.id,
    role: turn.roleName,
    purpose: turn.purpose,
    mode: turn.mode,
    agent: `${turn.effective.agentId}/${turn.effective.adapterId}`,
    effectiveRevision: String(turn.effective.sourceDesiredRevision),
    profileAccess: turn.effective.profileAccess,
    effectivePermission: turn.effective.permission.strategy,
    writeProjectIds: turn.effective.writeProjectIds.join(",") || "none"
  };
}

/**
 * Keeps only the fields the caller actually knew. Event payloads are a
 * string map, so an unknown fact has to be an absent key: writing `""` would
 * claim the Host reported an empty value.
 */
function optionalEventFields(
  fields: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].trim().length > 0
    )
  );
}

function runtimeObservationTelemetryEntry(
  input: RuntimeObservation
): TelemetryProgressEntry {
  return {
    taskId: input.fence.taskId!,
    roleName: input.fence.roleName,
    turnId: input.fence.turnId!,
    progressId: [
      input.kind,
      input.payload.operationId ?? input.payload.activity ?? "state"
    ].join(":"),
    ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
    payload: {
      eventId: input.eventId,
      kind: input.kind,
      authority: input.authority,
      driverId: input.fence.driverId,
      nativeSessionId: input.fence.nativeSessionId ?? "",
      nativeTurnId: input.fence.nativeTurnId ?? "",
      ...(input.payload.operation === undefined
        ? {}
        : { operation: input.payload.operation }),
      ...(input.payload.activity === undefined
        ? {}
        : { activity: input.payload.activity }),
      ...(input.payload.usage === undefined
        ? {}
        : { usage: JSON.stringify(input.payload.usage) })
    },
    receivedAt: input.receivedAt
  };
}

/**
 * Usage observations and incomplete request boundaries are authoritative
 * read-only history: retain each one so consecutive deltas remain projectable.
 * Other activity observations are a current explicit boundary and may replace
 * their predecessor. Token evidence never becomes lifecycle activity.
 */
function compactedRuntimeObservationIds(
  events: readonly TaskEvent[],
  incoming: RuntimeObservation
): string[] {
  const existing = events.flatMap((event) => {
    const observation = runtimeObservationFromTaskEvent(event);
    const matches = incoming.kind.startsWith("operation.")
      ? observation !== null
        && runtimeObservationTurnFenceMatches(observation.fence, incoming.fence)
      : observation !== null
        && runtimeObservationFenceMatches(observation.fence, incoming.fence);
    return observation !== null
      && matches
      ? [{ event, observation }]
      : [];
  });
  const remove = ({ observation }: typeof existing[number]): boolean => {
    if (incoming.kind === "activity.observed") {
      if (isRuntimeTokenEvidence(incoming)) return false;
      return observation.kind === "activity.observed"
        && !isRuntimeTokenEvidence(observation);
    }
    if (incoming.kind === "operation.started") {
      return (observation.kind === "operation.started"
          && observation.payload.operationId === incoming.payload.operationId)
        || observation.kind === "operation.completed"
        || observation.kind === "operation.failed";
    }
    if (incoming.kind === "operation.completed" || incoming.kind === "operation.failed") {
      return (observation.kind.startsWith("operation.")
          && observation.payload.operationId === incoming.payload.operationId)
        || observation.kind === "operation.completed"
        || observation.kind === "operation.failed";
    }
    if (incoming.kind === "turn.waiting") return observation.kind === "turn.waiting";
    if (incoming.kind === "observer.health") {
      return observation.kind === "observer.health"
        && observation.payload.sourceId === incoming.payload.sourceId;
    }
    if (["turn.completed", "turn.failed", "turn.cancelled"].includes(incoming.kind)) {
      return (observation.kind.startsWith("operation.")
          && observation.payload.operation !== "subagent")
        || observation.kind === "turn.waiting"
        || observation.kind === "turn.completed"
        || observation.kind === "turn.failed"
        || observation.kind === "turn.cancelled";
    }
    if (incoming.kind === "turn.accepted") return observation.kind === "turn.accepted";
    if (incoming.kind.startsWith("session.")) return observation.kind.startsWith("session.");
    return false;
  };
  return existing.filter(remove).map(({ event }) => event.id);
}

function recordStructuredProviderAcceptance(
  sessions: TaskRoleSessionSet,
  input: RuntimeObservation,
  now: Date
): TaskRoleSessionSet {
  const current = sessions.providerBinding;
  const attemptId = input.fence.receiptId;
  const turnId = input.fence.nativeTurnId;
  if (current === null || attemptId === undefined) return sessions;
  if (current.turn === null
    || current.turn.turnId !== input.fence.turnId) return sessions;
  if (current.turn.attemptId === attemptId
    && ["accepted", "completed", "failed", "cancelled"].includes(
      current.turn.status
    )) return sessions;
  const binding = acceptProviderTurn(current, {
    attemptId,
    nativeTurnId: turnId,
    acceptedAt: input.observedAt ?? input.receivedAt
  });
  return updateTaskRoleProviderRuntime(sessions, binding, now);
}

type TerminalExecutionInput = Readonly<{
  taskId: string;
  roleName: string;
  agentId: string;
  adapterId: string;
  conversationId?: string;
  nativeSessionId: string;
  nativeTurnId?: string;
  attemptId?: string;
  turnId?: string;
}>;

/** One correlation boundary shared by classification and the committing fold. */
function resolveTerminalExecution(store: TaskStore, input: TerminalExecutionInput): Readonly<{
  turn: Turn | null;
  current: boolean;
  attemptId: string;
  nativeTurnId?: string;
}> | null {
  const task = store.getTask(input.taskId);
  if (task === null || task.status === "archived") return null;
  if (input.conversationId !== undefined && input.conversationId !== input.nativeSessionId) return null;
  const sessions = store.getTaskRoleSessionSet(input.taskId, input.roleName);
  const session = sessions?.sessions[input.agentId];
  const binding = sessions?.providerBinding;
  const pending = binding?.turn;
  const evidence = store.listEvents(input.taskId).map(runtimeObservationFromTaskEvent)
    .filter((event): event is RuntimeObservation => event !== null
      && (event.kind === "turn.accepted" || isTurnTerminalObservation(event)));
  if (input.attemptId !== undefined && evidence.some((event) => (
    event.fence.roleName === input.roleName
    && event.fence.agentId === input.agentId
    && event.fence.nativeSessionId === input.nativeSessionId
    && event.fence.receiptId === input.attemptId
    && input.nativeTurnId !== undefined && event.fence.nativeTurnId !== undefined
    && event.fence.nativeTurnId !== input.nativeTurnId
  ))) return null;
  const identityMatches = (attemptId: string | undefined, nativeTurnId: string | undefined) => (
    (input.attemptId === undefined
      ? input.nativeTurnId !== undefined && input.nativeTurnId === nativeTurnId
      : input.attemptId === attemptId)
    && !(input.nativeTurnId !== undefined && nativeTurnId !== undefined
      && input.nativeTurnId !== nativeTurnId)
  );
  if (binding !== null && binding !== undefined && pending !== null && pending !== undefined
    && session?.adapterId === input.adapterId
    && session.nativeSessionId === input.nativeSessionId
    && currentProviderConversation(binding).conversationId === input.nativeSessionId
    && identityMatches(pending.attemptId, pending.nativeTurnId)
    && (input.turnId === undefined || input.turnId === pending.turnId)
    && pending.status !== "rejected") {
    const turn = pending.turnId === undefined ? null : store.getTurn(input.taskId, pending.turnId);
    if (pending.turnId === undefined || (
      turn !== null && turn.roleName === input.roleName
      && turn.effective.agentId === input.agentId && turn.effective.adapterId === input.adapterId
    )) return {
      turn, current: true, attemptId: pending.attemptId,
      nativeTurnId: pending.nativeTurnId,
    };
  }
  // Old results use immutable acceptance/terminal evidence, not today's Role
  // config, Session status or active Turn pointer.
  const matches = evidence.filter((event) => event.fence.roleName === input.roleName
      && event.fence.agentId === input.agentId
      && event.fence.nativeSessionId === input.nativeSessionId
      && identityMatches(event.fence.receiptId, event.fence.nativeTurnId)
      && event.fence.turnId !== undefined
      && (input.turnId === undefined || event.fence.turnId === input.turnId));
  const accepted = matches[0];
  if (accepted === undefined || accepted.fence.receiptId === undefined) return null;
  if (matches.some((event) => event.fence.turnId !== accepted.fence.turnId
    || event.fence.receiptId !== accepted.fence.receiptId)) {
    throw new Error("Runtime terminal has conflicting durable execution bindings.");
  }
  const turn = store.getTurn(input.taskId, accepted.fence.turnId!);
  if (turn === null || turn.effective.adapterId !== input.adapterId
    || turn.effective.agentId !== input.agentId || turn.roleName !== input.roleName) return null;
  return {
    turn, current: false, attemptId: accepted.fence.receiptId,
    nativeTurnId: accepted.fence.nativeTurnId,
  };
}

function isTurnTerminalObservation(input: RuntimeObservation): boolean {
  return ["turn.completed", "turn.failed", "turn.cancelled"].includes(input.kind);
}

function assertConsistentTerminal(
  store: TaskStore,
  input: TerminalExecutionInput & Readonly<{
    providerStatus: "completed" | "failed" | "cancelled";
    outcome: RuntimeTurnTerminalOutcome;
    observation?: RuntimeObservation;
  }>,
  turn: Turn | null
): void {
  const previous = store.listEvents(input.taskId).map(runtimeObservationFromTaskEvent)
    .filter((event): event is RuntimeObservation => event !== null
      && isTurnTerminalObservation(event)
      && event.fence.roleName === input.roleName
      && event.fence.agentId === input.agentId
      && event.fence.nativeSessionId === input.nativeSessionId
      && (input.attemptId === undefined
        ? input.nativeTurnId !== undefined && event.fence.nativeTurnId === input.nativeTurnId
        : event.fence.receiptId === input.attemptId));
  if (input.observation !== undefined && previous.some((event) => (
    event.kind !== input.observation!.kind
    || !isDeepStrictEqual(event.payload, input.observation!.payload)
    || event.fence.turnId !== input.observation!.fence.turnId
  ))) throw new Error("Conflicting terminal content for the same execution.");
  if (turn?.result?.provider !== undefined) {
    if (turn.result.provider.status !== input.providerStatus
      || (input.outcome.status === "completed" && turn.result.output !== input.outcome.output)
      || (previous.length === 0 && input.outcome.status === "failed"
        && turn.result.diagnostic !== input.outcome.diagnostic)) {
      throw new Error("Conflicting result for the same execution.");
    }
  }
}

function terminalSessionReplacementBasis(
  sessions: TaskRoleSessionSet,
  input: RuntimeObservation,
  run: Turn
): "terminal-session" | undefined {
  const binding = sessions.providerBinding;
  const session = sessions.sessions[input.fence.agentId];
  const incomingConversationId = input.fence.conversationId ?? input.fence.nativeSessionId;
  if (run.mode !== "new"
    || binding === null
    || session === undefined
    || incomingConversationId === undefined
    || currentProviderConversation(binding).conversationId === incomingConversationId
    || session.status !== "ended") {
    return undefined;
  }
  return "terminal-session";
}

function bindOrSupersedeProviderRuntime(
  sessions: TaskRoleSessionSet,
  input: RuntimeObservation,
  now: Date,
  replacementBasis?: "terminal-session"
): TaskRoleSessionSet {
  const conversationId = input.fence.conversationId ?? input.fence.nativeSessionId!;
  if (sessions.providerBinding === null) {
    return bindTaskRoleProviderRuntime(sessions, createProviderRuntimeBinding({
      providerNamespace: input.fence.driverId,
      accountScope: input.fence.agentId,
      conversationId,
      startedAt: input.observedAt ?? input.receivedAt
    }), now);
  }
  const current = currentProviderConversation(sessions.providerBinding);
  if (current.conversationId === conversationId) {
    return sessions;
  }
  if (replacementBasis === undefined) {
    throw new Error("A fresh Provider Conversation requires a terminal prior Session.");
  }
  return updateTaskRoleProviderRuntime(
    sessions,
    supersedeProviderConversation(sessions.providerBinding, {
      conversationId,
      switchedAt: input.observedAt ?? input.receivedAt,
      basis: replacementBasis
    }),
    now
  );
}

function terminalProviderReplacementBasis(
  sessions: TaskRoleSessionSet,
  input: RuntimeObservation,
  mode: Turn["mode"]
): "terminal-session" | undefined {
  if (mode !== "new" || sessions.providerBinding === null) return undefined;
  if (sessions.providerBinding.providerNamespace !== input.fence.driverId
    || sessions.providerBinding.accountScope !== input.fence.agentId) {
    return undefined;
  }
  const current = sessions.sessions[input.fence.agentId];
  if (current === undefined || current.status !== "active" || current.nativeSessionId !== input.fence.nativeSessionId) {
    return undefined;
  }
  const replaced = [...(sessions.history ?? [])].reverse().find((session) => (
    session.agentId === current.agentId
    && session.adapterId === current.adapterId
    && session.status === "ended"
    && session.nativeSessionId === currentProviderConversation(sessions.providerBinding!).conversationId
  ));
  return replaced === undefined ? undefined : "terminal-session";
}

function settleStructuredProviderTurn(
  sessions: TaskRoleSessionSet,
  turnId: string | undefined,
  status: "completed" | "failed" | "cancelled",
  now: Date,
  attemptId?: string
): TaskRoleSessionSet {
  const binding = sessions.providerBinding;
  if (binding === null || binding.turn === null
    || (attemptId === undefined ? binding.turn.nativeTurnId !== turnId : binding.turn.attemptId !== attemptId)) {
    return sessions;
  }
  if (["completed", "failed", "cancelled"].includes(binding.turn.status)) return sessions;
  return updateTaskRoleProviderRuntime(sessions, settleProviderTurn(binding, {
    nativeTurnId: turnId,
    ...(attemptId === undefined ? {} : { attemptId }),
    status,
    settledAt: now.toISOString()
  }), now);
}

function usageSnapshotIsSuperseded(
  events: readonly TaskEvent[],
  incoming: RuntimeObservation
): boolean {
  if (incoming.kind !== "activity.observed" || incoming.payload.usage === undefined) {
    return false;
  }
  return events
    .map(runtimeObservationFromTaskEvent)
    .some((observation) => observation !== null
      && observation.kind === "activity.observed"
      && observation.payload.usage !== undefined
      && runtimeObservationFenceMatches(observation.fence, incoming.fence)
      && observationIsStrictlyNewer(observation, incoming));
}

function hasPersistedRuntimeObservation(
  events: readonly TaskEvent[],
  incoming: RuntimeObservation
): boolean {
  const usageIdentity = isRuntimeTokenEvidence(incoming)
    ? incoming.eventId
    : undefined;
  return events.some((event) => (
    event.type === RUNTIME_OBSERVATION_TASK_EVENT
    && (usageIdentity === undefined
      ? event.payload.semanticKey === incoming.semanticKey
      : event.payload.eventId === usageIdentity)
  ));
}

function observationIsStrictlyNewer(
  left: RuntimeObservation,
  right: RuntimeObservation
): boolean {
  return compareCanonicalObservationOrder(left, right) > 0;
}

function compareCanonicalObservationOrder(
  left: RuntimeObservation,
  right: RuntimeObservation
): number {
  return left.receivedAt.localeCompare(right.receivedAt)
    || (left.sequence ?? -1) - (right.sequence ?? -1)
    || (left.ordinal ?? -1) - (right.ordinal ?? -1)
    || left.eventId.localeCompare(right.eventId);
}
