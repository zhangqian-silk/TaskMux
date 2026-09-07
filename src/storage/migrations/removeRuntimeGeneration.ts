import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

/** Storage 3 -> 4. Frozen migration; runtime code must not depend on this module. */
export const REMOVE_RUNTIME_GENERATION_SQL = `
-- data-transform: remove-runtime-generation-records-v1
DROP TRIGGER telemetry_ai;
DROP TRIGGER telemetry_au;
DROP INDEX idx_telemetry_turn;
ALTER TABLE telemetry RENAME TO telemetry_v3;
ALTER TABLE telemetry_aggregate RENAME TO telemetry_aggregate_v3;
CREATE TABLE telemetry (
  task_id TEXT NOT NULL, role_name TEXT NOT NULL, turn_id TEXT NOT NULL,
  progress_id TEXT NOT NULL, sequence INTEGER, payload TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (task_id, role_name, turn_id, progress_id)
) WITHOUT ROWID;
CREATE INDEX idx_telemetry_turn ON telemetry(task_id, turn_id);
INSERT INTO telemetry
SELECT task_id, role_name, turn_id, progress_id, sequence, payload, received_at
FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY task_id, role_name, turn_id, progress_id
    ORDER BY received_at DESC, COALESCE(sequence, -1) DESC, generation DESC
  ) AS rank FROM telemetry_v3
) WHERE rank = 1;
CREATE TABLE telemetry_aggregate (
  task_id TEXT NOT NULL, role_name TEXT NOT NULL, turn_id TEXT NOT NULL,
  first_at TEXT NOT NULL, last_at TEXT NOT NULL, count INTEGER NOT NULL,
  max_sequence INTEGER, error_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, role_name, turn_id)
) WITHOUT ROWID;
INSERT INTO telemetry_aggregate
SELECT task_id, role_name, turn_id, MIN(first_at), MAX(last_at), SUM(count),
  MAX(max_sequence), SUM(error_count), MAX(updated_at)
FROM telemetry_aggregate_v3 GROUP BY task_id, role_name, turn_id;
DROP TABLE telemetry_v3;
DROP TABLE telemetry_aggregate_v3;
CREATE TRIGGER telemetry_ai AFTER INSERT ON telemetry
BEGIN
  INSERT INTO telemetry_aggregate
    (task_id, role_name, turn_id, first_at, last_at, count, max_sequence, error_count, updated_at)
  VALUES (NEW.task_id, NEW.role_name, NEW.turn_id, NEW.received_at, NEW.received_at,
    1, NEW.sequence,
    CASE WHEN json_valid(NEW.payload)
      AND (COALESCE(json_extract(NEW.payload, '$.error'), '') <> ''
        OR COALESCE(json_extract(NEW.payload, '$.errorKind'), '') <> '')
      THEN 1 ELSE 0 END, NEW.received_at)
  ON CONFLICT(task_id, role_name, turn_id) DO UPDATE SET
    first_at = MIN(telemetry_aggregate.first_at, excluded.first_at),
    last_at = MAX(telemetry_aggregate.last_at, excluded.last_at),
    count = telemetry_aggregate.count + 1,
    max_sequence = CASE WHEN excluded.max_sequence IS NOT NULL
      AND (telemetry_aggregate.max_sequence IS NULL OR excluded.max_sequence > telemetry_aggregate.max_sequence)
      THEN excluded.max_sequence ELSE telemetry_aggregate.max_sequence END,
    error_count = telemetry_aggregate.error_count + excluded.error_count,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER telemetry_au AFTER UPDATE ON telemetry
BEGIN
  UPDATE telemetry_aggregate SET
    last_at = MAX(last_at, NEW.received_at),
    max_sequence = CASE WHEN NEW.sequence IS NOT NULL
      AND (max_sequence IS NULL OR NEW.sequence > max_sequence) THEN NEW.sequence ELSE max_sequence END,
    updated_at = NEW.received_at
  WHERE task_id = NEW.task_id AND role_name = NEW.role_name AND turn_id = NEW.turn_id;
END;

DROP INDEX idx_session_owners_task;
ALTER TABLE session_owners RENAME TO session_owners_v3;
CREATE TABLE session_owners (
  process_key TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('task','global')),
  task_id TEXT, role_name TEXT NOT NULL, agent_id TEXT NOT NULL, native_session_id TEXT,
  provider_root_pid INTEGER, payload TEXT NOT NULL, recorded_at TEXT NOT NULL
);
INSERT INTO session_owners
SELECT process_key, scope, task_id, role_name, agent_id, native_session_id,
  provider_root_pid, payload, recorded_at
FROM (
  SELECT *,
    CAST(provider_root_pid AS TEXT) || '-' || json_extract(payload, '$.providerRoot.startIdentity') AS process_key,
    ROW_NUMBER() OVER (
      PARTITION BY provider_root_pid, json_extract(payload, '$.providerRoot.startIdentity')
      ORDER BY recorded_at DESC, launch_id DESC
    ) AS rank
  FROM session_owners_v3
) WHERE rank = 1;
DROP TABLE session_owners_v3;
CREATE INDEX idx_session_owners_task ON session_owners(task_id, role_name);

DROP INDEX idx_runtime_session_cleanup_required;
ALTER TABLE runtime_session_candidates RENAME TO runtime_session_candidates_v3;
CREATE TABLE runtime_session_candidates (
  scope TEXT NOT NULL CHECK(scope IN ('task','global')), task_id TEXT NOT NULL,
  role_name TEXT NOT NULL, agent_id TEXT NOT NULL, adapter_id TEXT NOT NULL,
  native_session_id TEXT NOT NULL, session_updated_at TEXT NOT NULL,
  PRIMARY KEY(scope, task_id, role_name),
  CHECK((scope = 'task' AND length(task_id) > 0) OR (scope = 'global' AND task_id = ''))
);
INSERT INTO runtime_session_candidates
SELECT scope, task_id, role_name, agent_id, adapter_id, native_session_id, session_updated_at
FROM runtime_session_candidates_v3;
DROP TABLE runtime_session_candidates_v3;

-- Retire only obsolete launch bookkeeping; preserve pending intent and cleanup requests.
UPDATE mailboxes SET processing = NULL
WHERE target_kind IN ('role-runtime','global-role-runtime')
  AND json_extract(processing, '$.owner') = 'runtime-lifecycle'
  AND json_extract(processing, '$.batch.reasons') = '["runtime-launch-reserved"]';
`;

export function removeRuntimeGenerationRecords(db: Database.Database): void {
  type JsonObject = Record<string, unknown>;
  const object = (value: unknown): value is JsonObject => (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
  const obsolete = new Set([
    "runtimeGenerationId", "hostActivationId", "activationId", "continuationGeneration"
  ]);
  // Accepted Jobs retain exactly the Session authority they already had.
  // Never refresh a revoked/stale binding to the currently active Session.
  for (const row of db.prepare("SELECT task_id, job_id, payload FROM durable_jobs").all() as
    Array<{ task_id: string; job_id: string; payload: string }>) {
    const job = JSON.parse(row.payload) as JsonObject;
    if (!object(job.operation) || typeof job.operation.actorId !== "string") continue;
    const prefix = `task:${row.task_id}/role:`;
    if (!job.operation.actorId.startsWith(prefix)) continue;
    const roleName = job.operation.actorId.slice(prefix.length);
    const roleRow = db.prepare("SELECT payload FROM task_roles WHERE task_id = ? AND role_name = ?")
      .get(row.task_id, roleName) as { payload: string } | undefined;
    const sessionsRow = db.prepare("SELECT payload FROM role_session_sets WHERE task_id = ? AND role_name = ?")
      .get(row.task_id, roleName) as { payload: string } | undefined;
    if (roleRow === undefined || sessionsRow === undefined) continue;
    const role = JSON.parse(roleRow.payload);
    const sessions = JSON.parse(sessionsRow.payload);
    const session = sessions.sessions?.[sessions.activeAgentId];
    if (session?.status !== "active" || role.activeAgentId !== sessions.activeAgentId) continue;
    const key = db.prepare("SELECT hash FROM job_caller_key_hashes WHERE task_id = ? AND role_name = ? AND agent_id = ?")
      .get(row.task_id, roleName, session.agentId) as { hash: string } | undefined;
    if (key === undefined) continue;
    const identity = [session.agentId, session.adapterId, session.nativeSessionId];
    const prior = createHash("sha256").update(JSON.stringify([key.hash, ...identity])).digest("hex");
    if (job.operation.authorityRef !== prior) continue;
    job.operation.authorityRef = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    db.prepare("UPDATE durable_jobs SET payload = ? WHERE task_id = ? AND job_id = ?")
      .run(JSON.stringify(job), row.task_id, row.job_id);
  }
  db.exec("DROP TABLE job_caller_key_hashes");
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (!object(value)) return value;
    const next: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      if (obsolete.has(key)) continue;
      if (key === "activations" && typeof value.providerNamespace === "string"
        && Array.isArray(value.conversations)) continue;
      if (key === "generation" && typeof value.continuationId === "string") continue;
      if (key === "generation" && value.kind === "yui-task-runtime-isolation") continue;
      next[key] = clean(child);
    }
    if (typeof next.providerNamespace === "string" && Array.isArray(next.conversations)
      && object(next.authority) && next.authority.owner === "controller") {
      next.authority.holderId = "controller";
    }
    if (next.authorityOwner === "controller" && typeof next.holderId === "string") {
      next.holderId = "controller";
    }
    if (next.kind === "yui-task-runtime-isolation" && object(next.roots)) {
      next.roots.runtime = next.roots.generation;
      delete next.roots.generation;
    }
    return next;
  };
  // These are system-owned record families, not arbitrary user documents or Job outputs.
  for (const table of ["role_session_sets", "global_role_session_sets", "turns", "session_owners", "events"]) {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; pk: number }>;
    const keys = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>;
    const where = keys.map((key) => `"${key}" = ?`).join(" AND ");
    const update = db.prepare(`UPDATE "${table}" SET payload = ?${table === "events" ? ", type = ?" : ""} WHERE ${where}`);
    for (const row of rows) {
      const raw = JSON.parse(row.payload as string) as JsonObject;
      const migrated = clean(raw) as JsonObject;
      if (table === "events" && object(migrated.payload)
        && typeof migrated.payload.observation === "string"
        && typeof migrated.type === "string" && migrated.type.startsWith("runtime.")) {
        const observation = JSON.parse(migrated.payload.observation) as JsonObject;
        const current = clean(observation) as JsonObject;
        if (typeof current.kind === "string" && current.kind.startsWith("activation.")) {
          // Keep the historical fact, but it is no longer a current lifecycle event.
          migrated.type = "runtime.historical-attachment-observed";
        }
        if (typeof current.stopReceiptId === "string") {
          current.stopRequested = true;
          delete current.stopReceiptId;
        }
        migrated.payload.observation = JSON.stringify(current);
      }
      update.run(
        JSON.stringify(migrated),
        ...(table === "events" ? [migrated.type] : []),
        ...keys.map((key) => row[key])
      );
    }
  }
}
