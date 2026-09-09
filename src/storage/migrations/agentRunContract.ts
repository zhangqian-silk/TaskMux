import type Database from "better-sqlite3";
import { createContextSnapshot, contextContentDigest, type ContextSnapshot } from "../../context/contextSnapshot.js";

/** Storage 12 -> 13 only. Text, native identities and opaque record/receipt ids
 * are never renamed. Ordinary runtime stores do not interpret old payloads.
 * v13 also introduces optional Message recipient/continuation/handovers.
 * Existing messages have no recipient and remain informational/Leader wakes;
 * migration never guesses an owner or causes historical messages to execute.
 */
export function migrateAgentRunContract(db: Database.Database): void {
  // T08 already stored real planning executions. Use that frozen evidence,
  // never the Task's current status, to classify their shared Session snapshots.
  const planningLaunches = new Set<string>();
  for (const row of db.prepare("SELECT task_id, payload FROM turns").all() as { task_id: string; payload: string }[]) {
    const run = JSON.parse(row.payload);
    if (run.purpose === "planning") {
      planningLaunches.add(`${row.task_id}:${contextContentDigest(run.effective)}`);
    }
  }
  const snapshotDigests = new Map<string, string>();
  const renameKey = (key: string): string => {
    if (key === "turn") return "run";
    if (key === "turns") return "runs";
    if (key === "turnId") return "runId";
    if (key === "turnIds") return "runIds";
    if (/NativeTurn|ProviderTurn|CompletedTurn|nativeTurn|providerTurn/.test(key)) return key;
    return key.replaceAll("Turn", "Run").replace(/^turn(?=[A-Z])/, "run")
      .replaceAll("TURN_", "RUN_").replaceAll("_TURN", "_RUN");
  };
  const untouched = new Set(["advanced", "metadata", "environment", "raw", "output", "body",
    "description", "summary", "directive", "config"]);
  const migrate = (value: unknown, taskId?: string, purpose?: string): any => {
    if (Array.isArray(value)) return value.map((entry) => migrate(entry, taskId, purpose));
    if (value === null || typeof value !== "object") return value;
    const input = value as Record<string, unknown>;
    const ownerTaskId = typeof input.taskId === "string" ? input.taskId : taskId;
    const executionPurpose = typeof input.purpose === "string" ? input.purpose : purpose;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) {
      let next = untouched.has(key) ? child : migrate(child, ownerTaskId, executionPurpose);
      if ((key === "type" || key === "recordKind" || key === "store") && child === "turn") next = "run";
      if (key === "type" && typeof child === "string" && child.startsWith("turn.")
        && typeof input.id === "string" && input.id.startsWith("event-") && input.createdAt !== undefined) {
        next = child.replace(/^turn\./, "run.");
      }
      if (key === "store" && child === "source-turn") next = "source-run";
      // Runtime envelopes are structured evidence encoded inside Task Events,
      // not free-form Provider output.
      if (key === "observation" && typeof child === "string") {
        const parsed = JSON.parse(child);
        next = JSON.stringify(migrate(parsed, ownerTaskId));
      }
      result[renameKey(key)] = next;
    }
    if (typeof input.digest === "string" && typeof input.id === "string"
      && input.id.startsWith("context-snapshot-") && typeof input.sequence === "number") {
      result.digest = snapshotDigests.get(input.digest) ?? input.digest;
    }
    // A Run has its own authoritative purpose. Session copies are classified
    // by the exact planning launch they retain; activation never upgrades them.
    if (input.schemaVersion === 3 && typeof input.agentId === "string"
      && typeof input.sourceDesiredRevision === "number" && input.workspace !== undefined
      && input.context !== undefined && input.permission !== undefined) {
      result.executionAuthority = executionPurpose === "planning"
        || (ownerTaskId !== undefined && planningLaunches.has(`${ownerTaskId}:${contextContentDigest(input)}`))
        ? "planning" : "delivery";
    }
    return result;
  };

  const snapshots = db.prepare("SELECT rowid, payload FROM context_snapshots")
    .all() as { rowid: number; payload: string }[];
  const originals = new Map<string, { rowid: number; payload: string; snapshot: ContextSnapshot }>(snapshots.map((row) => {
    const snapshot = JSON.parse(row.payload) as ContextSnapshot;
    return [`${snapshot.taskId}/${snapshot.id}`, { ...row, snapshot }] as const;
  }));
  const visiting = new Set<string>();
  const completed = new Set<string>();
  const migrateSnapshot = (key: string): void => {
    if (completed.has(key)) return;
    const row = originals.get(key);
    if (row === undefined) return; // Preserve unresolved historical references as references.
    if (visiting.has(key)) throw new Error("Context Snapshot references contain a cycle.");
    visiting.add(key);
    const original = row.snapshot;
    // Dependency order, not wall-clock order: async callers can freeze with
    // an earlier pass timestamp while referencing an already committed parent.
    const visitReferences = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(visitReferences); return; }
      const ref = value as Record<string, unknown>;
      if (typeof ref.id === "string" && ref.id.startsWith("context-snapshot-")
        && typeof ref.taskId === "string" && typeof ref.digest === "string"
        && typeof ref.sequence === "number") migrateSnapshot(`${ref.taskId}/${ref.id}`);
      for (const [field, child] of Object.entries(ref)) {
        if (!untouched.has(field)) visitReferences(child);
      }
    };
    visitReferences(original.parentRef);
    visitReferences(original.resources);
    const current = migrate(original) as ContextSnapshot;
    const resources = current.resources.map((entry) => ({
      ...entry, ref: { ...entry.ref, digest: contextContentDigest(entry.value) }
    }));
    const refs = current.refs.map((ref) => resources.find((entry) =>
      entry.ref.layer === ref.layer && entry.ref.store === ref.store && entry.ref.refId === ref.refId)?.ref ?? ref);
    const snapshot = createContextSnapshot({ ...current, resources, refs, frozenAt: new Date(current.frozenAt) });
    snapshotDigests.set(original.digest, snapshot.digest);
    db.prepare("UPDATE context_snapshots SET payload = ?, digest = ? WHERE rowid = ?")
      .run(JSON.stringify(snapshot), snapshot.digest, row.rowid);
    visiting.delete(key);
    completed.add(key);
  };
  for (const key of originals.keys()) migrateSnapshot(key);
  const tables = [
    "config", "agent_profiles", "global_roles", "global_role_session_sets",
    "task_records", "task_roles", "role_session_sets", "work_items", "work_item_candidates",
    "turns", "active_turns", "review_rounds", "change_sets", "integration_attempts",
    "messages", "input_requests", "decisions", "milestones", "events", "task_projections",
    "durable_jobs", "integration_queue", "task_wakes", "telemetry", "telemetry_aggregate"
  ];
  const rewriteColumn = (table: string, column: string): void => {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; pk: number }[];
    if (!columns.some((entry) => entry.name === column)) return;
    const keys = columns.filter((entry) => entry.pk > 0).sort((a, b) => a.pk - b.pk).map((entry) => entry.name);
    if (!keys.length) throw new Error(`Migration requires the primary key of ${table}.`);
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = db.prepare(`SELECT * FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL`)
      .all() as Record<string, unknown>[];
    const update = db.prepare(`UPDATE ${quote(table)} SET ${quote(column)} = ? WHERE ${
      keys.map((key) => `${quote(key)} = ?`).join(" AND ")}`);
    for (const row of rows) {
      update.run(JSON.stringify(migrate(JSON.parse(row[column] as string),
        typeof row.task_id === "string" ? row.task_id : undefined)), ...keys.map((key) => row[key]));
    }
  };
  for (const table of tables) {
    rewriteColumn(table, "payload");
  }
  for (const column of ["pending", "processing"]) {
    rewriteColumn("mailboxes", column);
  }
  db.prepare("UPDATE id_sequences SET kind = 'run' WHERE kind = 'turn'").run();
}
