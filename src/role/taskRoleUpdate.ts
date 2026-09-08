import type { TaskStore } from "../storage/taskStore.js";
import type { TaskRoleSessionSet } from "../executor/agentExecutor.js";
import { createTaskEvent, type TaskEventPayload } from "../event/taskEvent.js";
import { enqueueWork } from "../coordination/workMailboxQueue.js";
import type { TaskRole } from "./role.js";

/** Called inside the owner's transaction, after authorization and validation.
 * Current Role, history and durable wake are one mutation. Runtime notification
 * belongs to the entry point, only after the outer transaction commits.
 */
export function saveTaskRoleUpdate(
  store: TaskStore, previous: TaskRole, current: TaskRole, now: Date,
  source: TaskEventPayload
): void {
  store.saveRole(current.taskId, current);
  store.saveEvent(current.taskId, createTaskEvent(
    store.nextEventId(current.taskId), current.taskId, "role.updated", {
      ...source,
      role: current.name,
      ...roleLaunchEventPayload(current, store.getTaskRoleSessionSet(current.taskId, current.name)),
      previous: JSON.stringify(previous),
      current: JSON.stringify(current)
    }, now
  ));
  enqueueWork(store, { kind: "task", taskId: current.taskId }, "role-updated", now,
    [{ type: "task", id: current.taskId }]);
}

export function roleLaunchEventPayload(
  role: TaskRole, sessions: TaskRoleSessionSet | null
): TaskEventPayload {
  const effective = sessions?.sessions[sessions.activeAgentId]?.effective;
  return {
    desiredRevision: String(role.launchRevision),
    defaultAccess: role.defaultAccess,
    effectiveRevision: effective === undefined ? "none" : String(effective.sourceDesiredRevision),
    profileAccess: effective?.profileAccess ?? "none",
    effectivePermission: effective?.permission.strategy ?? "none",
    desiredDrift: effective === undefined
      ? "not-started"
      : effective.sourceDesiredRevision === role.launchRevision ? "none" : "pending-next-launch"
  };
}
