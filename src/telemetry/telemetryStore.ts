import type { TelemetryMode } from "./telemetryConfig.js";

/**
 * One high-volume Agent Driver observation routed to the telemetry sidecar.
 * Progress belongs to a Task/Role/Turn. `sequence` is the provider counter
 * when known, not an identity for a Host attachment.
 */
export type TelemetryProgressEntry = Readonly<{
  taskId: string;
  roleName: string;
  turnId: string;
  progressId: string;
  sequence?: number;
  payload: Readonly<Record<string, string>>;
  receivedAt: string;
}>;

/**
 * Per-Turn progress summary. `count` is the total number of progress
 * observations ever recorded for the Turn (including rows pruned from the
 * retained window); the window and the aggregate are both bounded.
 */
export type TelemetryAggregate = Readonly<{
  taskId: string;
  roleName: string;
  turnId: string;
  firstAt: string;
  lastAt: string;
  count: number;
  maxSequence: number | null;
  errorCount: number;
}>;

export type TelemetryHealth = Readonly<{
  mode: TelemetryMode;
  /** False when the sidecar is unavailable; the semantic lane is unaffected. */
  available: boolean;
  /** Observations dropped because the sidecar was unavailable or overloaded. */
  dropped: number;
  /** Observations folded onto an already-pending/newer row for the same key. */
  coalesced: number;
  lastError: string | null;
  /** Retained telemetry rows across all Tasks. */
  rows: number;
}>;

export type TelemetryPage<T> = Readonly<{
  items: readonly T[];
  /** Offset for the next page, or null when this was the last page. */
  nextOffset: number | null;
}>;

/**
 * Write side of the sidecar. `observe` is best-effort and MUST NOT throw:
 * telemetry is an observation fact, so a sidecar failure only increments
 * `dropped` and records a health warning. Semantic terminal writes
 * always take priority and are never blocked by this interface.
 */
export interface TelemetrySink {
  readonly mode: TelemetryMode;
  observe(entry: TelemetryProgressEntry): void;
  health(): TelemetryHealth;
  close(): Promise<void>;
}

/**
 * Read side of the sidecar. All reads are cold/bounded: default Task context
 * never loads full progress history — it uses aggregates and the latest row
 * per Turn; full history is paged by Task ID.
 */
export interface TelemetryReader {
  count(taskId: string, turnId?: string): number;
  list(
    taskId: string,
    turnId?: string,
    page?: Readonly<{ limit: number; offset: number }>
  ): TelemetryPage<TelemetryProgressEntry>;
  /** Summary of one Turn, or null when unknown. */
  aggregate(taskId: string, turnId: string): TelemetryAggregate | null;
  /** Exact summary for one Role/Turn, or null when unknown. */
  aggregateRoleTurn(
    taskId: string,
    roleName: string,
    turnId: string
  ): TelemetryAggregate | null;
  /** All per-Turn aggregates for one Task (retention/status reads). */
  listTurnAggregates(taskId: string): TelemetryAggregate[];
  /**
   * Monotonic counter of applied writes. Consumers that cache projections
   * derived from telemetry (for example the scheduler stall fold) include it
   * in their cache key so bounded-mode liveness stays fresh.
   */
  revision(): number;
}

export interface TelemetryStore extends TelemetrySink, TelemetryReader {
  /**
   * Terminal retention: keep the newest `keep` rows per
   * (task, role, Turn) and delete older ones. The aggregate is
   * preserved. Returns the number of rows deleted.
   */
  pruneTurn(
    taskId: string,
    roleName: string,
    turnId: string,
    keep?: number
  ): number;
  /**
   * Active-Turn hard cap: trim oldest rows across the Turn beyond `cap`.
   * Returns the number of rows deleted.
   */
  capTurn(taskId: string, turnId: string, cap?: number): number;
  /**
   * Bulk-import one Turn's retained window and authoritative aggregate
   * (historical compaction). Synchronous and transactional; bypasses the
   * coalescing ingress queue because the caller already validated the data.
   */
  importTurn(
    entries: readonly TelemetryProgressEntry[],
    aggregate: TelemetryAggregate
  ): void;
  /** Block until all queued observations have been flushed. */
  flush(): Promise<void>;
}

/**
 * Wiring bundle consumed by the scheduler store adapter: the active mode
 * plus the sidecar's write and read sides.
 */
export type SchedulerTelemetry = Readonly<{
  mode: TelemetryMode;
  sink: TelemetrySink;
  reader: TelemetryReader;
  retention: TelemetryStore;
}>;

/** No-op sink for disabled telemetry and callers without a sidecar. */
export class NullTelemetrySink implements TelemetrySink {
  constructor(readonly mode: TelemetryMode = "off") {}
  observe(_entry: TelemetryProgressEntry): void {}
  health(): TelemetryHealth {
    return {
      mode: this.mode,
      available: false,
      dropped: 0,
      coalesced: 0,
      lastError: null,
      rows: 0
    };
  }
  async close(): Promise<void> {}
}
