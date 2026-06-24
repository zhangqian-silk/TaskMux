import { createTaskComment } from "../comment/comment.js";
import { roleNotFound, runtimeError, taskNotFound, usageError } from "../errors/cliError.js";
import { createTaskEvent } from "../event/taskEvent.js";
import { createRole, updateRoleStatus } from "../role/role.js";
import { resolveRunner, supportedRunnerIds } from "../runner/runnerRegistry.js";
import { createTask, updateTaskStatus } from "../task/task.js";
import type { TaskStore } from "../storage/taskStore.js";
import type { TaskStatus } from "../task/task.js";
import type { TmuxManager } from "../tmux/tmuxManager.js";

export function runTaskCommand(args: string[], store: TaskStore, tmux?: TmuxManager): string {
  const [command, ...rest] = args;

  switch (command) {
    case "create":
      return createTaskCommand(rest, store);
    case "list":
      return listTaskCommand(store);
    case "show":
      return showTaskCommand(rest, store);
    case "start":
      return updateTaskStatusCommand(rest, store, "active", "Started");
    case "done":
      return updateTaskStatusCommand(rest, store, "done", "Completed");
    case "archive":
      return updateTaskStatusCommand(rest, store, "archived", "Archived");
    case "reopen":
      return updateTaskStatusCommand(rest, store, "open", "Reopened");
    case "open":
      return openTaskCommand(rest, store);
    case "assign":
      return assignTaskRoleCommand(rest, store);
    case "roles":
      return listTaskRolesCommand(rest, store);
    case "enter":
      return enterTaskRoleCommand(rest, store, tmux);
    case "tail":
      return tailTaskRoleCommand(rest, store, tmux);
    case "detail":
      return detailTaskRoleCommand(rest, store);
    case "status":
      return statusTaskRoleCommand(rest, store, tmux);
    case "refresh":
      return refreshTaskRolesCommand(rest, store, tmux, "Refreshed");
    case "transcript":
      return transcriptTaskRoleCommand(rest, store, tmux);
    case "detach":
      return detachTaskRoleCommand(rest, store, tmux);
    case "stop":
      return stopTaskRoleCommand(rest, store, tmux);
    case "kill":
      return killTaskRoleCommand(rest, store, tmux);
    case "restart":
      return restartTaskRoleCommand(rest, store, tmux);
    case "cleanup":
      return refreshTaskRolesCommand(rest, store, tmux, "Cleaned");
    case "comment":
      return addTaskCommentCommand(rest, store);
    case "comments":
      return listTaskCommentsCommand(rest, store);
    case "events":
      return listTaskEventsCommand(rest, store);
    default:
      return taskUsage();
  }
}

function createTaskCommand(args: string[], store: TaskStore): string {
  const title = args.join(" ").trim();

  if (title.length === 0) {
    throw usageError("Task title is required.");
  }

  const task = createTask(store.nextTaskId(), title, new Date());
  store.saveTask(task);
  recordTaskEvent(store, task.id, "task.created", { title: task.title });

  return `Created task ${task.id}: ${task.title}\n`;
}

function listTaskCommand(store: TaskStore): string {
  const tasks = store.listTasks();

  if (tasks.length === 0) {
    return "No tasks found.\n";
  }

  return `${tasks.map((task) => `${task.id}\t${task.status}\t${task.title}`).join("\n")}\n`;
}

function showTaskCommand(args: string[], store: TaskStore): string {
  const [id] = args;

  if (id === undefined || id.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  const task = store.getTask(id);

  if (task === null) {
    throw taskNotFound(id);
  }

  return [
    `Task: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Created: ${task.createdAt}`,
    `Updated: ${task.updatedAt}`
  ].join("\n").concat("\n");
}

function updateTaskStatusCommand(
  args: string[],
  store: TaskStore,
  status: TaskStatus,
  action: string
): string {
  const [id] = args;

  if (id === undefined || id.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  const task = store.getTask(id);

  if (task === null) {
    throw taskNotFound(id);
  }

  const updatedTask = updateTaskStatus(task, status, new Date());
  store.saveTask(updatedTask);
  recordTaskEvent(store, updatedTask.id, "task.status_changed", {
    from: task.status,
    to: updatedTask.status
  });

  return `${action} task ${updatedTask.id}\n`;
}

function openTaskCommand(args: string[], store: TaskStore): string {
  const [id] = args;

  if (id === undefined || id.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  const task = store.getTask(id);

  if (task === null) {
    throw taskNotFound(id);
  }

  return [
    `Task: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Roles: ${store.listRoles(task.id).length}`,
    `Comments: ${store.listComments(task.id).length}`,
    `Next: taskmux task enter ${task.id} <role>`
  ].join("\n").concat("\n");
}

function assignTaskRoleCommand(args: string[], store: TaskStore): string {
  const [taskId, roleName, ...rest] = args;

  if (taskId === undefined || taskId.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  if (roleName === undefined || roleName.trim().length === 0) {
    throw usageError("Role name is required.");
  }

  if (store.getTask(taskId) === null) {
    throw taskNotFound(taskId);
  }

  const agent = readOption(rest, "--agent").trim();
  const workspace = readOption(rest, "--workspace").trim();

  if (agent.length === 0) {
    throw usageError("--agent is required.");
  }

  if (workspace.length === 0) {
    throw usageError("--workspace is required.");
  }

  const runner = resolveRunner(agent, store.listCustomRunners());

  if (runner === null) {
    throw usageError(`Unsupported agent: ${agent}\nSupported agents: ${supportedRunnerIds(store.listCustomRunners()).join(", ")}`);
  }

  const role = createRole(roleName, runner, workspace, new Date());

  store.saveRole(taskId, role);
  recordTaskEvent(store, taskId, "role.assigned", { role: role.name, agent: role.agent });

  return [
    `Assigned role ${role.name} to ${taskId}`,
    `Agent: ${role.agent}`,
    `Workspace: ${role.workspace}`
  ].join("\n").concat("\n");
}

function listTaskRolesCommand(args: string[], store: TaskStore): string {
  const [taskId] = args;

  if (taskId === undefined || taskId.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  if (store.getTask(taskId) === null) {
    throw taskNotFound(taskId);
  }

  const roles = store.listRoles(taskId);

  if (roles.length === 0) {
    return "No roles assigned.\n";
  }

  return `${roles.map((role) => `${role.name}\t${role.agent}\t${role.status}\t${role.workspace}`).join("\n")}\n`;
}

function enterTaskRoleCommand(args: string[], store: TaskStore, tmux?: TmuxManager): string {
  const roleLookup = findRole(args, store);

  if (typeof roleLookup === "string") {
    throw usageError(roleLookup.trim());
  }

  if (tmux === undefined) {
    throw runtimeError("Tmux manager is not configured.");
  }

  tmux.enterRole(roleLookup.taskId, roleLookup.role);
  store.saveRole(roleLookup.taskId, updateRoleStatus(roleLookup.role, "running", new Date()));

  return `Attached role ${roleLookup.role.name} for ${roleLookup.taskId}\n`;
}

function tailTaskRoleCommand(args: string[], store: TaskStore, tmux?: TmuxManager): string {
  const roleLookup = findRole(args, store);

  if (typeof roleLookup === "string") {
    throw usageError(roleLookup.trim());
  }

  if (tmux === undefined) {
    throw runtimeError("Tmux manager is not configured.");
  }

  return tmux.captureRole(roleLookup.taskId, roleLookup.role.name);
}

function transcriptTaskRoleCommand(args: string[], store: TaskStore, tmux?: TmuxManager): string {
  const roleLookup = findRole(args, store);

  if (typeof roleLookup === "string") {
    throw usageError(roleLookup.trim());
  }

  if (tmux === undefined) {
    throw runtimeError("Tmux manager is not configured.");
  }

  const transcript = tmux.captureRole(roleLookup.taskId, roleLookup.role.name);
  store.saveTranscript(roleLookup.taskId, roleLookup.role.name, transcript);

  return transcript;
}

function detailTaskRoleCommand(args: string[], store: TaskStore): string {
  const roleLookup = findRole(args, store);

  if (typeof roleLookup === "string") {
    throw usageError(roleLookup.trim());
  }

  const role = roleLookup.role;

  return [
    `Task: ${roleLookup.taskId}`,
    `Role: ${role.name}`,
    `Agent: ${role.agent}`,
    `Workspace: ${role.workspace}`,
    `Status: ${role.status}`,
    `Tmux: taskmux-${roleLookup.taskId}:${role.name}`,
    `Created: ${role.createdAt}`,
    `Updated: ${role.updatedAt}`
  ].join("\n").concat("\n");
}

function refreshTaskRolesCommand(
  args: string[],
  store: TaskStore,
  tmux: TmuxManager | undefined,
  action: string
): string {
  const [taskId] = args;

  if (taskId === undefined || taskId.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  if (store.getTask(taskId) === null) {
    throw taskNotFound(taskId);
  }

  if (tmux === undefined) {
    throw runtimeError("Tmux manager is not configured.");
  }

  const roles = store.listRoles(taskId);

  if (roles.length === 0) {
    return `${action} task ${taskId} roles\nNo roles assigned.\n`;
  }

  const currentRoles = roles.map((role) => {
    const status = tmux.detectRoleStatus(taskId, role.name, role.status);
    const currentRole = status === role.status ? role : updateRoleStatus(role, status, new Date());

    if (currentRole !== role) {
      store.saveRole(taskId, currentRole);
    }

    return currentRole;
  });

  return [
    `${action} task ${taskId} roles`,
    ...currentRoles.map((role) => `${role.name}\t${role.status}`)
  ].join("\n").concat("\n");
}

function statusTaskRoleCommand(args: string[], store: TaskStore, tmux?: TmuxManager): string {
  const roleLookup = findRole(args, store);

  if (typeof roleLookup === "string") {
    throw usageError(roleLookup.trim());
  }

  const role = roleLookup.role;
  const status = tmux?.detectRoleStatus(roleLookup.taskId, role.name, role.status) ?? role.status;
  const currentRole = status === role.status ? role : updateRoleStatus(role, status, new Date());

  if (currentRole !== role) {
    store.saveRole(roleLookup.taskId, currentRole);
  }

  return [
    `Task: ${roleLookup.taskId}`,
    `Role: ${currentRole.name}`,
    `Agent: ${currentRole.agent}`,
    `Workspace: ${currentRole.workspace}`,
    `Status: ${currentRole.status}`,
    `Tmux: taskmux-${roleLookup.taskId}:${currentRole.name}`,
    `Created: ${currentRole.createdAt}`,
    `Updated: ${currentRole.updatedAt}`
  ].join("\n").concat("\n");
}

function detachTaskRoleCommand(args: string[], store: TaskStore, tmux?: TmuxManager): string {
  const roleLookup = findRole(args, store);

  if (typeof roleLookup === "string") {
    throw usageError(roleLookup.trim());
  }

  if (tmux === undefined) {
    throw runtimeError("Tmux manager is not configured.");
  }

  tmux.detachRole(roleLookup.taskId);
  store.saveRole(roleLookup.taskId, updateRoleStatus(roleLookup.role, "detached", new Date()));

  return `Detached role ${roleLookup.role.name} for ${roleLookup.taskId}\n`;
}

function restartTaskRoleCommand(args: string[], store: TaskStore, tmux?: TmuxManager): string {
  const roleLookup = findRole(args, store);

  if (typeof roleLookup === "string") {
    throw usageError(roleLookup.trim());
  }

  if (tmux === undefined) {
    throw runtimeError("Tmux manager is not configured.");
  }

  tmux.restartRole(roleLookup.taskId, roleLookup.role);
  store.saveRole(roleLookup.taskId, updateRoleStatus(roleLookup.role, "running", new Date()));

  return `Restarted role ${roleLookup.role.name} for ${roleLookup.taskId}\n`;
}

function stopTaskRoleCommand(args: string[], store: TaskStore, tmux?: TmuxManager): string {
  const roleLookup = findRole(args, store);

  if (typeof roleLookup === "string") {
    throw usageError(roleLookup.trim());
  }

  if (tmux === undefined) {
    throw runtimeError("Tmux manager is not configured.");
  }

  tmux.stopRole(roleLookup.taskId, roleLookup.role.name);
  store.saveRole(roleLookup.taskId, updateRoleStatus(roleLookup.role, "exited", new Date()));

  return `Stopped role ${roleLookup.role.name} for ${roleLookup.taskId}\n`;
}

function killTaskRoleCommand(args: string[], store: TaskStore, tmux?: TmuxManager): string {
  const roleLookup = findRole(args, store);

  if (typeof roleLookup === "string") {
    throw usageError(roleLookup.trim());
  }

  if (tmux === undefined) {
    throw runtimeError("Tmux manager is not configured.");
  }

  tmux.killRole(roleLookup.taskId, roleLookup.role.name);
  store.saveRole(roleLookup.taskId, updateRoleStatus(roleLookup.role, "exited", new Date()));

  return `Killed role ${roleLookup.role.name} for ${roleLookup.taskId}\n`;
}

function addTaskCommentCommand(args: string[], store: TaskStore): string {
  const [taskId, ...bodyParts] = args;

  if (taskId === undefined || taskId.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  if (store.getTask(taskId) === null) {
    throw taskNotFound(taskId);
  }

  const body = bodyParts.join(" ").trim();

  if (body.length === 0) {
    throw usageError("Comment body is required.");
  }

  const comment = createTaskComment(store.nextCommentId(taskId), body, new Date());
  store.saveComment(taskId, comment);
  recordTaskEvent(store, taskId, "comment.added", { comment: comment.id });

  return `Added comment to ${taskId}: ${comment.body}\n`;
}

function listTaskCommentsCommand(args: string[], store: TaskStore): string {
  const [taskId] = args;

  if (taskId === undefined || taskId.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  if (store.getTask(taskId) === null) {
    throw taskNotFound(taskId);
  }

  const comments = store.listComments(taskId);

  if (comments.length === 0) {
    return "No comments found.\n";
  }

  return `${comments.map((comment) => `${comment.id}\t${comment.createdAt}\t${comment.body}`).join("\n")}\n`;
}

function listTaskEventsCommand(args: string[], store: TaskStore): string {
  const [taskId] = args;

  if (taskId === undefined || taskId.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  if (store.getTask(taskId) === null) {
    throw taskNotFound(taskId);
  }

  const events = store.listEvents(taskId);

  if (events.length === 0) {
    return "No events found.\n";
  }

  return `${events
    .map((event) => `${event.id}\t${event.createdAt}\t${event.type}\t${renderEventPayload(event.payload)}`)
    .join("\n")}\n`;
}

function recordTaskEvent(
  store: TaskStore,
  taskId: string,
  type: string,
  payload: Record<string, string>
): void {
  store.saveEvent(taskId, createTaskEvent(store.nextEventId(taskId), type, payload, new Date()));
}

function renderEventPayload(payload: Record<string, string>): string {
  return Object.entries(payload)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function findRole(
  args: string[],
  store: TaskStore
): { taskId: string; role: NonNullable<ReturnType<TaskStore["getRole"]>> } | string {
  const [taskId, roleName] = args;

  if (taskId === undefined || taskId.trim().length === 0) {
    return "Task id is required.\n";
  }

  if (roleName === undefined || roleName.trim().length === 0) {
    return "Role name is required.\n";
  }

  if (store.getTask(taskId) === null) {
    throw taskNotFound(taskId);
  }

  const role = store.getRole(taskId, roleName);

  if (role === null) {
    throw roleNotFound(roleName);
  }

  return { taskId, role };
}

function readOption(args: string[], name: string): string {
  const index = args.indexOf(name);

  if (index === -1 || args[index + 1] === undefined) {
    throw usageError(`${name} is required.`);
  }

  return args[index + 1];
}

export function taskUsage(): string {
  return `Task commands:
  taskmux task create <title>
  taskmux task list
  taskmux task show <task-id>
  taskmux task start <task-id>
  taskmux task done <task-id>
  taskmux task archive <task-id>
  taskmux task reopen <task-id>
  taskmux task open <task-id>
  taskmux task assign <task-id> <role> --agent <agent> --workspace <path>
  taskmux task roles <task-id>
  taskmux task enter <task-id> <role>
  taskmux task tail <task-id> <role>
  taskmux task detail <task-id> <role>
  taskmux task status <task-id> <role>
  taskmux task refresh <task-id>
  taskmux task transcript <task-id> <role>
  taskmux task detach <task-id> <role>
  taskmux task stop <task-id> <role>
  taskmux task kill <task-id> <role>
  taskmux task restart <task-id> <role>
  taskmux task cleanup <task-id>
  taskmux task comment <task-id> <body>
  taskmux task comments <task-id>
  taskmux task events <task-id>
`;
}
