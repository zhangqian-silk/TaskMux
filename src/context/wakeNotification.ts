import type { TaskEvent } from "../event/taskEvent.js";
import type { TaskMessage } from "../message/message.js";
import type { AgentRun } from "../agentRun/agentRun.js";
import type { Task } from "../task/task.js";
import type { ReviewRound } from "../review/reviewRound.js";
import { renderWakeReason } from "../scheduler/wakeReason.js";
import { operationalTaskRecords } from "../task/taskRecordRetirement.js";

/**
 * Issue 04 (context token budget) — long-term design:
 *
 * A Leader wake is a NOTIFICATION, not a context dump. The wake envelope
 * carries only what the Agent needs for immediate orientation: the wake id,
 * aggregated reason tags, delta window, and a bounded list of active frozen
 * Task Reviews. The Agent reads delta content on demand with
 * `yui task wake show <wake-id>` and the full projection with
 * `yui task context <task>`.
 *
 * The envelope is mode-agnostic: fresh Sessions and resumed Sessions
 * receive the same minimal text. The native Session is a disposable cache of
 * working context; Yui's durable Task records (including the wake ledger) are
 * the checkpoint.
 */

/** Structural guardrail: the envelope stays far below a normal model context window. */
export const WAKE_ENVELOPE_HARD_BYTES = 2_000;

/** Maximum reason tags rendered before elision to a count. */
const REASON_DISPLAY_LIMIT = 6;

export type WakeEnvelopeRequest = Readonly<{
  taskId: string;
  /** The wake record id this envelope will be persisted as. */
  wakeId: string;
  /** Canonical wake reason tags aggregated from the mailbox pending batch. */
  reasons: readonly string[];
  /** ISO timestamp; the delta window's exclusive lower bound. */
  fromCursor: string;
  now?: Date;
}>;

export type WakeEnvelope = Readonly<{
  taskId: string;
  wakeId: string;
  fromCursor: string;
  /** Existing AgentRuns named by terminal events in the wake delta, in event order. */
  referencedRunIds: readonly string[];
  totalBytes: number;
  text: string;
}>;

/** Narrow read surface — the envelope only needs orientation, active Reviews and delta counts. */
export type WakeEnvelopeReader = Readonly<{
  getTask(taskId: string): Task | null;
  listEvents(taskId: string): readonly TaskEvent[];
  listMessages(taskId: string): readonly TaskMessage[];
  listRuns(taskId: string): readonly AgentRun[];
  listReviewRounds(taskId: string): readonly ReviewRound[];
}>;

export function buildTaskWakeEnvelope(
  reader: WakeEnvelopeReader,
  request: WakeEnvelopeRequest
): WakeEnvelope {
  const task = reader.getTask(request.taskId);
  if (task === null) throw new Error(`Task not found: ${request.taskId}.`);
  if (request.reasons.length === 0) {
    throw new Error(`Wake envelope ${request.wakeId} must carry at least one reason.`);
  }

  const fromTime = Date.parse(request.fromCursor);
  const events = reader.listEvents(request.taskId);
  const deltaEvents = events.filter((record) => Date.parse(record.createdAt) > fromTime);
  const runs = operationalTaskRecords(reader.listRuns(request.taskId), events, "run");
  const referencedRunIds = referencedWakeRunIds(runs, events, deltaEvents);
  const changedRunIds = new Set([
    ...runs
      .filter((record) => Date.parse(record.createdAt) > fromTime)
      .map(({ id }) => id),
    ...referencedRunIds
  ]);
  const counts = {
    events: deltaEvents.length,
    messages: operationalTaskRecords(reader.listMessages(request.taskId), events, "message")
      .filter((record) => Date.parse(record.createdAt) > fromTime).length,
    runs: changedRunIds.size
  };
  const activeReviews = reader.listReviewRounds(request.taskId).filter((round) => (
    (round.scope ?? "work-item") === "task"
    && (round.status === "pending" || round.status === "running")
  ));
  const renderReviewOrientation = (limit: number) => activeReviews.slice(0, limit).map((round) => {
    const projects = round.taskCandidate?.projects ?? [];
    const heads = projects.slice(0, 2).map(({ projectId, commit }) => (
      `${projectId}@${commit.slice(0, 12)}`
    )).join("+");
    return `${round.id}/${round.reviewerRoleName}`
      + `/${round.deltaRecheck === undefined ? "full" : "delta"}`
      + `[${round.status}]`
      + `@${heads || round.reviewBaseCommit.slice(0, 12)}`
      + `${projects.length > 2 ? `+${projects.length - 2}` : ""}`;
  }).join(", ");

  const render = (
    reasonLimit: number,
    resultRunLimit: number,
    reviewLimit: number
  ): string => {
    const reviewOrientation = renderReviewOrientation(reviewLimit);
    return [
      `Wake: ${request.wakeId} — delta since ${request.fromCursor}`,
      `  Reasons: ${renderReasons(request.reasons, reasonLimit)}`,
      `  Changed: ${counts.events} events, ${counts.messages} messages, ${counts.runs} AgentRuns`
        + ` → yui task wake show ${request.taskId} ${request.wakeId}`,
      `  Result AgentRuns: ${renderResultRuns(
        request.taskId,
        referencedRunIds,
        resultRunLimit
      )}`,
      `  Active Task Reviews: ${activeReviews.length === 0
        ? "none"
        : reviewLimit === 0
          ? `${activeReviews.length} → yui task context ${request.taskId}`
          : `${reviewOrientation}${activeReviews.length > reviewLimit
            ? `, … (+${activeReviews.length - reviewLimit})`
            : ""}`}`,
      `Full context: yui task context ${request.taskId}`
    ].join("\n");
  };

  let reasonLimit = Math.min(REASON_DISPLAY_LIMIT, request.reasons.length);
  let resultRunLimit = Math.min(4, referencedRunIds.length);
  let reviewLimit = Math.min(3, activeReviews.length);
  let body = render(reasonLimit, resultRunLimit, reviewLimit);
  while (byteLength(body) + 1 > WAKE_ENVELOPE_HARD_BYTES) {
    if (resultRunLimit > 0) resultRunLimit -= 1;
    else if (reasonLimit > 0) reasonLimit -= 1;
    else if (reviewLimit > 0) reviewLimit -= 1;
    else break;
    body = render(reasonLimit, resultRunLimit, reviewLimit);
  }
  if (byteLength(body) + 1 > WAKE_ENVELOPE_HARD_BYTES) {
    body = fitUtf8([
      `Wake: ${request.wakeId}`,
      `Inspect: yui task wake show ${request.taskId} ${request.wakeId}`,
      `Full context: yui task context ${request.taskId}`
    ].join("\n"), WAKE_ENVELOPE_HARD_BYTES - 1);
  }
  const totalBytes = byteLength(body) + 1;

  return Object.freeze({
    taskId: request.taskId,
    wakeId: request.wakeId,
    fromCursor: request.fromCursor,
    referencedRunIds: Object.freeze(referencedRunIds),
    totalBytes,
    text: `${body}\n`
  });
}

export function referencedWakeRunIds(
  runs: readonly AgentRun[],
  allEvents: readonly TaskEvent[],
  terminalEvents: readonly TaskEvent[]
): readonly string[] {
  const turnsById = new Map(
    operationalTaskRecords(runs, allEvents, "run").map((run) => [run.id, run])
  );
  return [...new Set(terminalEvents.flatMap((event) => {
    if (!["run.completed", "run.failed", "run.cancelled"].includes(event.type)) return [];
    const runId = event.payload.runId;
    return runId !== undefined && turnsById.has(runId) ? [runId] : [];
  }))];
}

function renderReasons(reasons: readonly string[], limit: number): string {
  if (limit === 0) return `${reasons.length} reason tags`;
  const selected = reasons.slice(0, limit);
  const elided = reasons.length - selected.length;
  const rendered = selected.map(renderWakeReason).join(", ");
  return elided === 0 ? rendered : `${rendered}, … (+${elided} more)`;
}

function renderResultRuns(
  taskId: string,
  runIds: readonly string[],
  limit: number
): string {
  if (runIds.length === 0) return "none";
  if (limit === 0) return `${runIds.length} → inspect the wake delta`;
  return `${runIds.slice(0, limit)
    .map((runId) => `${runId} → yui task run show ${taskId}/${runId}`)
    .join(", ")}${runIds.length > limit ? `, … (+${runIds.length - limit})` : ""}`;
}

function fitUtf8(value: string, maxBytes: number): string {
  let fitted = "";
  for (const character of value) {
    if (byteLength(fitted) + byteLength(character) > maxBytes) break;
    fitted += character;
  }
  return fitted;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
