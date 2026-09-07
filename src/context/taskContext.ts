import { usageError, taskNotFound } from "../errors/cliError.js";
import { resolveManagedTaskCaller } from "../runtime/managedCaller.js";
import type { TaskStore } from "../storage/taskStore.js";
import { contextContentDigest } from "./contextSnapshot.js";
import { buildTurnContextPack } from "./turnContextPack.js";
import { sourceTurnContextValue } from "./sourceTurnContext.js";
import type { TaskMessage } from "../message/message.js";

const MAX_RECORDS = 256;
const MAX_VALUE_BYTES = 4096;
const MAX_PAGE_BYTES = 128 * 1024;
const MAX_INSPECT_BYTES = 4 * 1024 * 1024;
const MAX_EVENTS = 100;
type Ref = Readonly<{ store: string; refId: string; revision: string; digest: string }>;
type Entry = Readonly<{ ref: Ref; value: unknown }>;
type Cursor = Readonly<{ taskId: string; sequence: number; revision: number }>;
type PageCursor = Cursor & Readonly<{ after: number }>;
export type ContextObservation = Readonly<{
  source: string;
  observedAt: string;
  coverage: "known" | "partial" | "unknown";
  status: "available" | "unavailable";
  value?: unknown;
}>;
export type ContextObservationProvider = Readonly<{
  source: string;
  read: (core: Readonly<ReturnType<typeof readTaskContext>>, signal: AbortSignal) =>
    Promise<Readonly<{ coverage: ContextObservation["coverage"]; value: unknown }>>;
}>;

/** A current read model, not a second snapshot store or a delivery receipt.
 * Every public path uses the same authorized entries before counting or paging.
 */
export function readTaskContext(
  store: TaskStore, taskId: string, environment: NodeJS.ProcessEnv = {}
) {
  return store.transaction((reader) => {
    const entries = authorizedEntries(reader, taskId, environment);
    const cursor = currentCursor(reader, taskId);
    let bytes = 0;
    const records: Array<{ ref: Ref; summary?: string; value?: unknown; omitted: boolean }> = [];
    for (const entry of entries) {
      const valueBytes = Buffer.byteLength(JSON.stringify(entry.value));
      const record = valueBytes > MAX_VALUE_BYTES
        ? { ref: entry.ref, summary: summarize(entry.value), omitted: true }
        : { ...entry, omitted: false };
      const size = Buffer.byteLength(JSON.stringify(record));
      if (records.length >= MAX_RECORDS || bytes + size > MAX_PAGE_BYTES) break;
      records.push(record);
      bytes += size;
    }
    return {
      taskId, coreCursor: encode(cursor), throughCursor: encode(cursor),
      records, count: entries.length,
      omitted: { records: entries.length - records.length, values: records.filter((r) => r.omitted).length },
      observations: [] as ContextObservation[],
      limits: { records: MAX_RECORDS, valueBytes: MAX_VALUE_BYTES, pageBytes: MAX_PAGE_BYTES }
    };
  });
}

/** Delta is immutable Task event history, not latest mutable record contents
 * mislabeled as an old snapshot. Inspect/read explicitly obtains current facts.
 * A continuation carries the first page's fixed upper event bound.
 */
export function readTaskContextDelta(
  store: TaskStore, taskId: string,
  input: Readonly<{ after: string; continuation?: string; limit?: number }>,
  environment: NodeJS.ProcessEnv = {}
) {
  return store.transaction((reader) => {
    const entries = authorizedEntries(reader, taskId, environment);
    const allowedEvents = new Set(entries.filter((e) => e.ref.store === "task-event").map((e) => e.ref.refId));
    const start = decode(input.after, taskId);
    const now = currentCursor(reader, taskId);
    const continuation = input.continuation === undefined ? undefined : decodePage(input.continuation, taskId);
    const bound = continuation ?? now;
    const after = continuation?.after ?? start.sequence;
    if (start.sequence > bound.sequence || after < start.sequence || after > bound.sequence
      || bound.sequence > now.sequence || start.revision > now.revision || bound.revision > now.revision) {
      throw usageError("Context cursor is outside the current Task history.");
    }
    const limit = input.limit ?? MAX_EVENTS;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENTS) {
      throw usageError(`Context delta limit must be between 1 and ${MAX_EVENTS}.`);
    }
    const events = reader.listEvents(taskId)
      .filter((event) => allowedEvents.has(event.id) && sequence(event.id) > after && sequence(event.id) <= bound.sequence)
      .sort((a, b) => sequence(a.id) - sequence(b.id));
    const page: Array<{ ref: Ref; value?: unknown; omitted: boolean }> = [];
    let bytes = 0;
    for (const event of events) {
      const entry = materialize("task-event", event.id, event);
      const record = Buffer.byteLength(JSON.stringify(event)) > MAX_VALUE_BYTES
        ? { ref: entry.ref, omitted: true }
        : { ...entry, omitted: false };
      const size = Buffer.byteLength(JSON.stringify(record));
      if (page.length >= limit || bytes + size > MAX_PAGE_BYTES) break;
      page.push(record);
      bytes += size;
    }
    const last = page.at(-1)?.ref.refId;
    const more = events.length > page.length;
    const through = { taskId, sequence: bound.sequence, revision: bound.revision };
    return {
      taskId, events: page, count: events.length, throughCursor: encode(through),
      ...(more && last !== undefined
        ? { continuation: encode({ ...through, after: sequence(last) }) } : {}),
      observations: [] as ContextObservation[]
    };
  });
}

export function inspectTaskContext(
  store: TaskStore, taskId: string, selector: Readonly<{ store: string; refId: string; digest?: string }>,
  environment: NodeJS.ProcessEnv = {}
) {
  return store.transaction((reader) => {
    const entry = authorizedEntries(reader, taskId, environment)
      .find(({ ref }) => ref.store === selector.store && ref.refId === selector.refId);
    if (entry === undefined) throw usageError("Context reference is unavailable in the caller's current scope.");
    if (selector.digest !== undefined && entry.ref.digest !== selector.digest) {
      throw usageError("Context reference changed; read its current reference before inspecting again.", undefined, {
        currentRef: entry.ref
      });
    }
    if (Buffer.byteLength(JSON.stringify(entry.value)) > MAX_INSPECT_BYTES) {
      throw usageError("Context value exceeds the bounded inspect limit.", undefined, { ref: entry.ref, maxBytes: MAX_INSPECT_BYTES });
    }
    return { ...entry, coreCursor: encode(currentCursor(reader, taskId)) };
  });
}

export function listContextMessages(
  store: TaskStore, taskId: string, environment: NodeJS.ProcessEnv = {}
): TaskMessage[] {
  return store.transaction((reader) => authorizedEntries(reader, taskId, environment)
    .filter(({ ref }) => ref.store === "task-message")
    .map(({ value }) => value as TaskMessage)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
}

/** Optional read-only providers receive only the caller's bounded core view.
 * No Store, credentials or mutation port is exposed. An unavailable provider
 * cannot prevent returning the core. This is a trusted in-process port, not a
 * JavaScript sandbox; executable plugin admission belongs to its owner.
 */
export async function withContextObservations(
  core: ReturnType<typeof readTaskContext>,
  providers: readonly ContextObservationProvider[],
  timeoutMs = 250
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1000 || providers.length > 8) {
    throw usageError("Optional Context providers exceed the bounded observation budget.");
  }
  const observations = await Promise.all(providers.map(async (provider): Promise<ContextObservation> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => provider.read(freeze(JSON.parse(JSON.stringify(core))), controller.signal)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, timeoutMs);
        })
      ]);
      if (!["known", "partial", "unknown"].includes(value.coverage)
        || Buffer.byteLength(JSON.stringify(value)) > MAX_VALUE_BYTES) throw new Error("unbounded observation");
      return { source: provider.source.slice(0, 200), observedAt: new Date().toISOString(),
        coverage: value.coverage, status: "available", value: JSON.parse(JSON.stringify(value.value)) };
    } catch {
      return { source: provider.source.slice(0, 200), observedAt: new Date().toISOString(),
        coverage: "unknown", status: "unavailable" };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  }));
  return { ...core, observations };
}

function authorizedEntries(store: TaskStore, taskId: string, environment: NodeJS.ProcessEnv): Entry[] {
  const caller = resolveManagedTaskCaller(store, environment);
  if (caller !== undefined && caller.taskId !== taskId) throw usageError("Context is outside the caller's Task.");
  if (caller === undefined && environment.YUI_SESSION_SCOPE === "global" && environment.YUI_ROLE !== "operator") {
    throw usageError("Only Operator may read Task context from a global Session.");
  }
  if (caller === undefined && environment.YUI_SESSION_SCOPE === undefined
    && (environment.YUI_ROLE !== undefined || environment.YUI_JOB_CALLER_KEY !== undefined
      || environment.YUI_TASK_ID !== undefined || environment.YUI_AGENT_ID !== undefined)) {
    throw usageError("Incomplete managed Context caller identity.");
  }
  if (environment.YUI_SESSION_SCOPE !== undefined && !["task", "global"].includes(environment.YUI_SESSION_SCOPE)) {
    throw usageError("Incomplete managed Context caller identity.");
  }
  const task = store.getTask(taskId);
  if (task === null) throw taskNotFound(taskId);
  let allow: Set<string> | undefined;
  if (caller !== undefined && caller.roleName !== "leader") {
    if (caller.currentTurnId === undefined) throw usageError("A managed Role needs a current Turn to read its scoped Context.");
    const pack = buildTurnContextPack(store, taskId, caller.currentTurnId);
    allow = new Set(pack.authority.readableRefs.map((ref) => `${ref.store}:${ref.refId}`));
    allow.add(`role:${caller.roleName}`);
    allow.add(`turn:${caller.currentTurnId}`);
  }
  const entries: Entry[] = [];
  const add = (family: string, id: string, value: unknown) => {
    if (value !== null && (allow === undefined || allow.has(`${family}:${id}`))) {
      entries.push(materialize(family, id, value));
    }
  };
  add("task", taskId, task);
  add("task-brief", taskId, store.getTaskBrief(taskId));
  for (const role of store.listRoles(taskId)) {
    add("role", role.name, role);
    add("role-profile", role.name, {
      name: role.name, defaultAccess: role.defaultAccess, description: role.description,
      responsibilities: role.responsibilities ?? [], constraints: role.constraints ?? [],
      skills: role.skills ?? [], launchRevision: role.launchRevision
    });
  }
  for (const binding of task.projectBindings) {
    const project = store.getProject(binding.projectId);
    if (project === null) continue;
    const { knowledge, ...policy } = project;
    add("project-policy", project.id, policy);
    for (const entry of knowledge.filter((k) => k.status === "active")) {
      add("project-knowledge", `${project.id}:${entry.id}`, { projectId: project.id, ...entry });
    }
  }
  // Current responsibilities and unanswered inputs precede historical bulk.
  for (const request of store.listInputRequests(taskId).filter((r) => r.status === "open")) add("input-request", request.id, request);
  for (const item of store.listWorkItems(taskId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    add("work-item", item.id, item);
    if (allow?.has(`accepted-work-item:${item.id}`)) add("accepted-work-item", item.id, item);
    for (const candidate of [...item.candidates].reverse()) add("candidate", candidate.id, candidate);
  }
  for (const message of store.listMessages(taskId).reverse()) add("task-message", message.id, message);
  for (const turn of store.listTurns(taskId).reverse()) {
    add("turn", turn.id, turn);
    if (allow?.has(`source-turn:${turn.id}`)) add("source-turn", turn.id, sourceTurnContextValue(turn));
  }
  for (const round of store.listReviewRounds(taskId).reverse()) add("review-round", round.id, round);
  for (const request of store.listInputRequests(taskId).filter((r) => r.status !== "open")) add("input-request", request.id, request);
  if (allow === undefined) {
    add("mailbox", "task", store.getWorkMailbox({ kind: "task", taskId }));
    for (const role of store.listRoles(taskId)) {
      add("mailbox", `role:${role.name}`, store.getWorkMailbox({ kind: "role", taskId, roleName: role.name }));
    }
  }
  for (const decision of store.listDecisions(taskId)) add("task-decision", decision.id, decision);
  for (const milestone of store.listMilestones(taskId)) add("task-milestone", milestone.id, milestone);
  for (const job of store.listDurableJobs(taskId)) add("job", job.id, job);
  for (const publication of store.listPublicationReferences(taskId)) add("publication", publication.id, publication);
  for (const event of store.listEvents(taskId).reverse()) add("task-event", event.id, event);
  return entries;
}

function materialize(store: string, refId: string, value: unknown): Entry {
  const digest = contextContentDigest(value);
  const record = value as Record<string, unknown>;
  return { ref: { store, refId, revision: String(record.revision ?? record.updatedAt ?? record.createdAt ?? digest), digest }, value };
}
function currentCursor(store: TaskStore, taskId: string): Cursor {
  return { taskId, sequence: store.listEvents(taskId).reduce((max, e) => Math.max(max, sequence(e.id)), 0), revision: store.getStateRevision() };
}
function sequence(id: string): number {
  const result = /^event-(\d+)$/.exec(id);
  if (result === null || !Number.isSafeInteger(Number(result[1]))) throw usageError("Task event has an invalid sequence.");
  return Number(result[1]);
}
function encode(value: Cursor | PageCursor): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function decode(value: string, taskId: string): Cursor {
  try {
    if (value.length > 1024) throw new Error("size");
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString()) as Cursor;
    if (cursor.taskId !== taskId || !Number.isSafeInteger(cursor.sequence) || cursor.sequence < 0
      || !Number.isSafeInteger(cursor.revision) || cursor.revision < 0) throw new Error("shape");
    return cursor;
  } catch { throw usageError("Invalid Context cursor for this Task."); }
}
function decodePage(value: string, taskId: string): PageCursor {
  const cursor = decode(value, taskId) as PageCursor;
  if (!Number.isSafeInteger(cursor.after) || cursor.after < 0) throw usageError("Invalid Context continuation.");
  return cursor;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
function summarize(value: unknown): string {
  const record = value as Record<string, unknown>;
  return ["title", "objective", "summary", "body", "status"]
    .flatMap((key) => typeof record[key] === "string" ? [`${key}: ${record[key]}`] : [])
    .join("; ").slice(0, 400);
}
