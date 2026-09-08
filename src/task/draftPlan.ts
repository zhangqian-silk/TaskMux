import type { Project } from "../repository/project.js";
import type { TaskEvent } from "../event/taskEvent.js";
import { RUNTIME_OBSERVATION_TASK_EVENT } from "../runtime/runtimeObservation.js";
import { SYSTEM_LEADER_ROLE } from "../role/systemRoles.js";
import type { TaskStore } from "../storage/taskStore.js";
import type { Task } from "./task.js";
import type { WorkItem } from "../workItem/workItem.js";

/**
 * Runtime Task-event types that are emitted with a Role but no Turn in their
 * payload. Each one is still only exempted when its `roleName` resolves to the
 * Leader — the `runtime.` prefix is never exempted, and a type absent from this
 * set keeps disqualifying the Draft.
 *
 * Turn lifecycle events are deliberately not listed: they use one generic type
 * per transition and name the Turn in their payload, so the guard resolves that
 * Turn's own purpose instead of trusting the type. Listing invented
 * `turn.planning-*` types would have exempted nothing while silently
 * disqualifying every Draft that ever held a planning conversation.
 */
export const PLANNING_ROLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "runtime.session-stop-requested",
  "runtime.session-termination",
  // Written by the liveness/host-exit paths, which admit a Draft planning Turn.
  // Its payload carries the Role and embeds the Turn only inside the serialized
  // observation, so it is resolved as Role-scoped rather than by that blob.
  "runtime.process-exit-observed"
]);

type DraftPlanFacts = Readonly<{
  task: Task;
  workItems: readonly WorkItem[];
  roleNames: ReadonlySet<string>;
  projects: ReadonlyMap<string, Project>;
}>;

export type DraftWorkItemDependencyIssue = Readonly<{
  kind: "missing-or-retired" | "cycle";
  workItemId: string;
  dependencyId: string;
}>;

export function assertDraftTaskExecutionFree(store: TaskStore, task: Task): void {
  if (task.status !== "draft") {
    throw new Error(`Task is not a Draft: ${task.id}/${task.status}.`);
  }
  const executionFact = firstDraftExecutionFact(store, task);
  if (executionFact !== undefined) {
    throw new Error(
      `Draft Task ${task.id} has execution facts (${executionFact}); `
      + "retire it and create a clean Draft instead of editing runtime history."
    );
  }
}

export function validateDraftWorkItemEdit(
  store: TaskStore,
  task: Task,
  candidate: WorkItem
): void {
  assertDraftTaskExecutionFree(store, task);
  const workItems = store.listWorkItems(task.id).map((item) => (
    item.id === candidate.id ? candidate : item
  ));
  const facts = draftPlanFacts(store, task, workItems);
  validateWorkItemReferences(facts, candidate);
  assertDraftWorkItemDependencyGraph(facts.workItems, candidate);
}

export function validateDraftTaskForActivation(store: TaskStore, task: Task): void {
  assertDraftTaskExecutionFree(store, task);
  const facts = draftPlanFacts(store, task, store.listWorkItems(task.id));
  const current = facts.workItems.filter(({ status }) => status !== "retired");
  for (const item of current) validateWorkItemReferences(facts, item);
  assertDraftWorkItemDependencyGraph(current);
}

/** Derive the first invalid edge in the current Draft dependency graph. */
export function draftWorkItemDependencyIssue(
  workItems: readonly WorkItem[],
  onlyItem?: WorkItem
): DraftWorkItemDependencyIssue | undefined {
  const current = workItems.filter(({ status }) => status !== "retired");
  const byId = new Map(current.map((item) => [item.id, item] as const));
  for (const item of onlyItem === undefined ? current : [onlyItem]) {
    const dependencyId = item.dependsOn.find((id) => !byId.has(id));
    if (dependencyId !== undefined) {
      return { kind: "missing-or-retired", workItemId: item.id, dependencyId };
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (item: WorkItem): DraftWorkItemDependencyIssue | undefined => {
    visiting.add(item.id);
    for (const dependencyId of item.dependsOn) {
      if (visiting.has(dependencyId)) {
        return { kind: "cycle", workItemId: item.id, dependencyId };
      }
      if (visited.has(dependencyId)) continue;
      const dependency = byId.get(dependencyId);
      if (dependency === undefined) continue;
      const issue = visit(dependency);
      if (issue !== undefined) return issue;
    }
    visiting.delete(item.id);
    visited.add(item.id);
    return undefined;
  };
  for (const item of current) {
    if (visited.has(item.id)) continue;
    const issue = visit(item);
    if (issue !== undefined) return issue;
  }
  return undefined;
}

function draftPlanFacts(
  store: TaskStore,
  task: Task,
  workItems: readonly WorkItem[]
): DraftPlanFacts {
  const projects = new Map<string, Project>();
  for (const binding of task.projectBindings) {
    const project = store.getProject(binding.projectId);
    if (project === null) {
      throw new Error(`Task Project not found: ${binding.projectId}.`);
    }
    if (project.status !== "active") {
      throw new Error(`Task Project is not active: ${project.id}/${project.status}.`);
    }
    projects.set(project.id, project);
  }
  return {
    task,
    workItems,
    roleNames: new Set(store.listRoles(task.id).map(({ name }) => name)),
    projects
  };
}

function validateWorkItemReferences(facts: DraftPlanFacts, item: WorkItem): void {
  if (item.assignee !== undefined && !facts.roleNames.has(item.assignee)) {
    throw new Error(`Work Item assignee Role not found: ${item.id}/${item.assignee}.`);
  }
  for (const projectId of item.writeProjectIds) {
    if (!facts.projects.has(projectId)) {
      throw new Error(`Work Item writable Project is not bound: ${item.id}/${projectId}.`);
    }
  }
  for (const baseRef of item.baseRefs ?? []) {
    if (!item.writeProjectIds.includes(baseRef.projectId)) {
      throw new Error(
        `Work Item base-ref Project is not writable: ${item.id}/${baseRef.projectId}.`
      );
    }
  }
}

function assertDraftWorkItemDependencyGraph(
  workItems: readonly WorkItem[],
  onlyItem?: WorkItem
): void {
  const issue = draftWorkItemDependencyIssue(workItems, onlyItem);
  if (issue === undefined) return;
  if (issue.kind === "missing-or-retired") {
    throw new Error(
      `Work Item dependency is missing or retired: ${issue.workItemId}/${issue.dependencyId}.`
    );
  }
  throw new Error(
    `Work Item dependency cycle detected: ${issue.workItemId}/${issue.dependencyId}.`
  );
}

function firstDraftExecutionFact(store: TaskStore, task: Task): string | undefined {
  if (task.workspaceIdentity !== undefined || task.cwd !== undefined) return "Task workspace";
  // Draft planning is a first-class Leader conversation, so its Turns, its
  // Session and its Host are ordinary planning facts rather than execution
  // history. Anything that could only exist after delivery still disqualifies
  // the Draft, and a planning Turn can never carry a WorkItem, ReviewRound,
  // Lane or workspace (validateTurn enforces that), so this stays a narrow
  // exemption rather than a hole.
  const turn = store.listTurns(task.id).find(({ purpose }) => purpose !== "planning");
  if (turn !== undefined) return `Turn ${turn.id}/${turn.purpose}`;
  const hostOwner = store.listSessionOwners().find(({ owner }) => (
    owner.scope === "task" && owner.taskId === task.id && owner.roleName !== SYSTEM_LEADER_ROLE
  ));
  if (hostOwner !== undefined) return `Host process (${hostOwner.providerRoot.pid})`;
  const sessionSet = store.listRoleSessionSets(task.id).find(
    ({ owner }) => owner.roleName !== SYSTEM_LEADER_ROLE
  );
  if (sessionSet !== undefined) return `Role Session (${sessionSet.owner.roleName})`;
  if (store.listDurableJobs(task.id).length > 0) return "DurableJob";
  if (store.listManagedWorkspaces(task.id).length > 0) return "managed Workspace";
  if (store.listReviewRounds(task.id).length > 0) return "ReviewRound";
  if (store.listIntegrationAttempts(task.id).length > 0) return "Integration Attempt";
  if (store.listChangeSets(task.id).length > 0) return "ChangeSet";
  const itemWithExecution = store.listWorkItems(task.id).find((item) => (
    item.executionGroups.length > 0
    || item.currentExecutionGroupId !== undefined
    || item.candidates.length > 0
    || item.workspaceDisposition !== undefined
    || !["open", "retired"].includes(item.status)
  ));
  if (itemWithExecution !== undefined) {
    return `Work Item execution (${itemWithExecution.id})`;
  }
  const runtimeEvent = store.listEvents(task.id).find((event) => {
    const { type } = event;
    if (!(type.startsWith("runtime.") || type.startsWith("turn.")
      || type.startsWith("review.") || type.startsWith("integration."))) {
      return false;
    }
    return !isDraftPlanningEvent(store, task, event);
  });
  return runtimeEvent === undefined ? undefined : `event ${runtimeEvent.id}/${runtimeEvent.type}`;
}

/**
 * Whether one runtime/Turn Task event belongs to this Draft's own planning
 * conversation.
 *
 * The binding the event carries decides this, never its type prefix:
 *
 * - it names a Turn → that Turn must exist on this Task and be `planning`;
 * - it names no Turn → its exact type must be Role-scoped by construction and
 *   its `roleName` must be the Leader, the only Role a Draft may run.
 *
 * Everything else stays disqualifying, so an unrecognized type, a foreign Role
 * or a Turn reference that cannot be resolved fails closed.
 */
function isDraftPlanningEvent(store: TaskStore, task: Task, event: TaskEvent): boolean {
  // Several emitters write an absent Turn as an empty string, so only a
  // non-empty id counts as a reference worth resolving.
  const turnId = event.payload["turnId"];
  if (typeof turnId === "string" && turnId !== "") {
    return store.getTurn(task.id, turnId)?.purpose === "planning";
  }
  // A canonical runtime observation is the event normal delivery writes for
  // session.started/conversation.observed/turn.accepted and every terminal. It
  // names its Turn in the same payload field as everything else and was
  // resolved above; only an unfenced host-level observation reaches here, where
  // the Role still has to prove it. Admitting this one type by its own binding
  // is not the same as admitting the `runtime.` prefix.
  if (event.type !== RUNTIME_OBSERVATION_TASK_EVENT
    && !PLANNING_ROLE_EVENT_TYPES.has(event.type)) {
    return false;
  }
  return event.payload["roleName"] === SYSTEM_LEADER_ROLE;
}
