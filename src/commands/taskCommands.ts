import { createTaskComment } from "../comment/comment.js";
import { roleNotFound, runtimeError, taskNotFound, usageError } from "../errors/cliError.js";
import { createTaskEvent } from "../event/taskEvent.js";
import { createRole, updateRoleStatus } from "../role/role.js";
import { resolveRunner, supportedRunnerIds } from "../runner/runnerRegistry.js";
import { createTask, updateTaskMetadata, updateTaskStatus } from "../task/task.js";
import type { TaskComment } from "../comment/comment.js";
import type { TaskEvent } from "../event/taskEvent.js";
import type { Role } from "../role/role.js";
import type { TaskStore } from "../storage/taskStore.js";
import type { Task, TaskMetadata, TaskPriority, TaskStatus } from "../task/task.js";
import type { TmuxManager } from "../tmux/tmuxManager.js";

export function runTaskCommand(args: string[], store: TaskStore, tmux?: TmuxManager): string {
  const [command, ...rest] = args;

  switch (command) {
    case "create":
      return createTaskCommand(rest, store);
    case "list":
      return listTaskCommand(rest, store);
    case "board":
      return boardTaskCommand(rest, store);
    case "show":
      return showTaskCommand(rest, store);
    case "update":
      return updateTaskCommand(rest, store);
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
    case "context":
      return contextTaskCommand(rest, store);
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
  const input = parseTaskBoardInput(args, { requireTitle: true });
  const title = input.title ?? "";

  if (title.length === 0) {
    throw usageError("Task title is required.");
  }

  const task = createTask(store.nextTaskId(), title, new Date(), input.metadata);
  store.saveTask(task);
  recordTaskEvent(store, task.id, "task.created", { title: task.title });

  return `Created task ${task.id}: ${task.title}\n`;
}

function listTaskCommand(args: string[], store: TaskStore): string {
  const filters = parseTaskListFilters(args);
  const tasks = store.listTasks().filter((task) => taskMatchesFilters(task, filters));

  if (tasks.length === 0) {
    return "No tasks found.\n";
  }

  return `${tasks.map(renderTaskListRow).join("\n")}\n`;
}

function boardTaskCommand(args: string[], store: TaskStore): string {
  const filters = parseTaskListFilters(args);
  const tasks = store.listTasks().filter((task) => taskMatchesFilters(task, filters));

  return renderTaskBoard(tasks);
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
    ...renderTaskMetadataLines(task),
    `Created: ${task.createdAt}`,
    `Updated: ${task.updatedAt}`
  ].join("\n").concat("\n");
}

function updateTaskCommand(args: string[], store: TaskStore): string {
  const [id, ...rest] = args;

  if (id === undefined || id.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  const task = store.getTask(id);

  if (task === null) {
    throw taskNotFound(id);
  }

  const input = parseTaskBoardInput(rest, { requireTitle: false, allowTitleOption: true });
  const patch = input.title === undefined ? input.metadata : { title: input.title, ...input.metadata };

  if (Object.keys(patch).length === 0) {
    throw usageError("At least one task update option is required.");
  }

  const updatedTask = updateTaskMetadata(task, patch, new Date());
  store.saveTask(updatedTask);
  recordTaskEvent(store, updatedTask.id, "task.updated", { title: updatedTask.title });

  return `Updated task ${updatedTask.id}\n`;
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
    ...renderTaskMetadataLines(task),
    `Roles: ${store.listRoles(task.id).length}`,
    `Comments: ${store.listComments(task.id).length}`,
    `Next: taskmux task enter ${task.id} <role>`
  ].join("\n").concat("\n");
}

function contextTaskCommand(args: string[], store: TaskStore): string {
  const [taskId, ...rest] = args;

  if (taskId === undefined || taskId.trim().length === 0) {
    throw usageError("Task id is required.");
  }

  const task = store.getTask(taskId);

  if (task === null) {
    throw taskNotFound(taskId);
  }

  const options = parseTaskContextOptions(rest);
  const context = buildTaskContext(task, store, options.includeTranscripts);

  if (options.format === "json") {
    return `${JSON.stringify(context, null, 2)}\n`;
  }

  return renderTaskContextText(context, options.includeTranscripts);
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

type TaskContextFormat = "text" | "json";

type TaskContextOptions = {
  format: TaskContextFormat;
  includeTranscripts: boolean;
};

type TaskContextRole = Role & {
  transcript?: string | null;
};

type TaskContext = {
  task: Task;
  roles: TaskContextRole[];
  comments: TaskComment[];
  events: TaskEvent[];
};

function parseTaskContextOptions(args: string[]): TaskContextOptions {
  assertKnownOptions(args, new Set(["--format", "--include-transcripts"]));

  const format = parseTaskContextFormat(readOptionalOption(args, "--format"));

  return {
    format,
    includeTranscripts: hasFlag(args, "--include-transcripts")
  };
}

function parseTaskContextFormat(value: string | undefined): TaskContextFormat {
  if (value === undefined) {
    return "text";
  }

  if (value !== "text" && value !== "json") {
    throw usageError("--format must be one of text, json.");
  }

  return value;
}

function buildTaskContext(task: Task, store: TaskStore, includeTranscripts: boolean): TaskContext {
  return {
    task,
    roles: store.listRoles(task.id).map((role) => includeTranscripts
      ? { ...role, transcript: store.readTranscript(task.id, role.name) }
      : role),
    comments: store.listComments(task.id),
    events: store.listEvents(task.id)
  };
}

function renderTaskContextText(context: TaskContext, includeTranscripts: boolean): string {
  return [
    "Task Context",
    ...renderTaskContextTaskLines(context.task),
    "",
    "Roles",
    ...renderTaskContextRoles(context.roles, includeTranscripts),
    "",
    "Comments",
    ...renderTaskContextComments(context.comments),
    "",
    "Events",
    ...renderTaskContextEvents(context.events)
  ].join("\n").concat("\n");
}

function renderTaskContextTaskLines(task: Task): string[] {
  return [
    `Task: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    ...renderTaskMetadataLines(task),
    `Created: ${task.createdAt}`,
    `Updated: ${task.updatedAt}`
  ];
}

function renderTaskContextRoles(roles: TaskContextRole[], includeTranscripts: boolean): string[] {
  if (roles.length === 0) {
    return ["  No roles."];
  }

  return roles.flatMap((role) => {
    const lines = [`  ${role.name}\t${role.agent}\t${role.status}\t${role.workspace}`];

    if (includeTranscripts && role.transcript !== undefined) {
      const transcript = role.transcript;
      lines.push(`    Transcript: ${transcript === null ? "not captured" : transcript.trimEnd()}`);
    }

    return lines;
  });
}

function renderTaskContextComments(comments: TaskComment[]): string[] {
  if (comments.length === 0) {
    return ["  No comments."];
  }

  return comments.map((comment) => `  ${comment.id}\t${comment.body}`);
}

function renderTaskContextEvents(events: TaskEvent[]): string[] {
  if (events.length === 0) {
    return ["  No events."];
  }

  return events.map((event) => `  ${event.id}\t${event.type}\t${renderEventPayload(event.payload)}`);
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

type TaskBoardInput = {
  title?: string;
  metadata: TaskMetadata;
};

type TaskListFilters = {
  status?: TaskStatus;
  owner?: string;
  tag?: string;
  priority?: TaskPriority;
  search?: string;
};

function parseTaskBoardInput(
  args: string[],
  options: { requireTitle: boolean; allowTitleOption?: boolean }
): TaskBoardInput {
  const optionStart = args.findIndex((arg) => arg.startsWith("--"));
  const titleParts = optionStart === -1 ? args : args.slice(0, optionStart);
  const optionArgs = optionStart === -1 ? [] : args.slice(optionStart);
  const titleFromOption = options.allowTitleOption === true ? readOptionalOption(optionArgs, "--title")?.trim() : undefined;
  const title = (titleFromOption ?? titleParts.join(" ")).trim();
  const metadata: TaskMetadata = {};
  const description = readOptionalOption(optionArgs, "--description")?.trim();
  const priority = parseTaskPriority(readOptionalOption(optionArgs, "--priority"));
  const tags = readRepeatedOption(optionArgs, "--tag").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  const owner = readOptionalOption(optionArgs, "--owner")?.trim();
  const dueAt = readOptionalOption(optionArgs, "--due")?.trim();

  assertKnownOptions(optionArgs, new Set(["--title", "--description", "--priority", "--tag", "--owner", "--due"]));

  if (options.requireTitle && title.length === 0) {
    throw usageError("Task title is required.");
  }

  if (description !== undefined && description.length > 0) {
    metadata.description = description;
  }

  if (priority !== undefined) {
    metadata.priority = priority;
  }

  if (tags.length > 0) {
    metadata.tags = tags;
  }

  if (owner !== undefined && owner.length > 0) {
    metadata.owner = owner;
  }

  if (dueAt !== undefined && dueAt.length > 0) {
    assertDueAt(dueAt);
    metadata.dueAt = dueAt;
  }

  return {
    title: title.length === 0 ? undefined : title,
    metadata
  };
}

function parseTaskListFilters(args: string[]): TaskListFilters {
  assertKnownOptions(args, new Set(["--status", "--owner", "--tag", "--priority", "--search"]));

  const status = parseTaskStatus(readOptionalOption(args, "--status"));

  return {
    status,
    owner: readOptionalOption(args, "--owner")?.trim(),
    tag: readOptionalOption(args, "--tag")?.trim(),
    priority: parseTaskPriority(readOptionalOption(args, "--priority")),
    search: readOptionalOption(args, "--search")?.trim().toLowerCase()
  };
}

function taskMatchesFilters(task: Task, filters: TaskListFilters): boolean {
  if (filters.status !== undefined && task.status !== filters.status) {
    return false;
  }

  if (filters.owner !== undefined && task.owner !== filters.owner) {
    return false;
  }

  if (filters.tag !== undefined && !(task.tags ?? []).includes(filters.tag)) {
    return false;
  }

  if (filters.priority !== undefined && task.priority !== filters.priority) {
    return false;
  }

  if (filters.search !== undefined && !taskSearchText(task).includes(filters.search)) {
    return false;
  }

  return true;
}

function renderTaskListRow(task: Task): string {
  const metadata = renderTaskMetadataSummary(task);

  return `${task.id}\t${task.status}\t${task.title}${metadata.length === 0 ? "" : `\t${metadata}`}`;
}

function renderTaskBoard(tasks: Task[]): string {
  const groups: Array<{ status: TaskStatus; title: string }> = [
    { status: "open", title: "Open" },
    { status: "active", title: "Active" },
    { status: "done", title: "Done" },
    { status: "archived", title: "Archived" }
  ];
  const lines = groups.flatMap((group) => {
    const groupedTasks = tasks.filter((task) => task.status === group.status);

    if (groupedTasks.length === 0) {
      return [group.title, "  No tasks."];
    }

    return [group.title, ...groupedTasks.map(renderTaskBoardRow)];
  });

  return `${lines.join("\n")}\n`;
}

function renderTaskBoardRow(task: Task): string {
  const metadata = renderTaskMetadataSummary(task);

  return `  ${task.id}\t${task.title}${metadata.length === 0 ? "" : `\t${metadata}`}`;
}

function renderTaskMetadataLines(task: Task): string[] {
  const lines: string[] = [];

  if (task.description !== undefined) {
    lines.push(`Description: ${task.description}`);
  }

  if (task.priority !== undefined) {
    lines.push(`Priority: ${task.priority}`);
  }

  if (task.tags !== undefined && task.tags.length > 0) {
    lines.push(`Tags: ${task.tags.join(", ")}`);
  }

  if (task.owner !== undefined) {
    lines.push(`Owner: ${task.owner}`);
  }

  if (task.dueAt !== undefined) {
    lines.push(`Due: ${task.dueAt}`);
  }

  return lines;
}

function renderTaskMetadataSummary(task: Task): string {
  return [
    task.priority === undefined ? null : `priority=${task.priority}`,
    task.owner === undefined ? null : `owner=${task.owner}`,
    task.tags === undefined || task.tags.length === 0 ? null : `tags=${task.tags.join(",")}`,
    task.dueAt === undefined ? null : `due=${task.dueAt}`
  ]
    .filter((item): item is string => item !== null)
    .join(" ");
}

function taskSearchText(task: Task): string {
  return [
    task.title,
    task.description,
    task.owner,
    task.priority,
    task.dueAt,
    ...(task.tags ?? [])
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();
}

function readOptionalOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  if (args[index + 1] === undefined || args[index + 1].startsWith("--")) {
    throw usageError(`${name} is required.`);
  }

  return args[index + 1];
}

function readRepeatedOption(args: string[], name: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue;
    }

    if (args[index + 1] === undefined || args[index + 1].startsWith("--")) {
      throw usageError(`${name} is required.`);
    }

    values.push(args[index + 1]);
    index += 1;
  }

  return values;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function assertKnownOptions(args: string[], knownOptions: Set<string>): void {
  for (const arg of args) {
    if (arg.startsWith("--") && !knownOptions.has(arg)) {
      throw usageError(`Unsupported option: ${arg}`);
    }
  }
}

function parseTaskPriority(value: string | undefined): TaskPriority | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!["low", "medium", "high", "urgent"].includes(value)) {
    throw usageError("--priority must be one of low, medium, high, urgent.");
  }

  return value as TaskPriority;
}

function parseTaskStatus(value: string | undefined): TaskStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!["open", "active", "done", "archived"].includes(value)) {
    throw usageError("--status must be one of open, active, done, archived.");
  }

  return value as TaskStatus;
}

function assertDueAt(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw usageError("--due must use YYYY-MM-DD.");
  }
}

export function taskUsage(): string {
  return `Task commands:
  taskmux task create <title> [--description <body>] [--priority low|medium|high|urgent] [--tag <tag> ...] [--owner <owner>] [--due YYYY-MM-DD]
  taskmux task update <task-id> [--title <title>] [--description <body>] [--priority low|medium|high|urgent] [--tag <tag> ...] [--owner <owner>] [--due YYYY-MM-DD]
  taskmux task list [--status <status>] [--owner <owner>] [--tag <tag>] [--priority <priority>] [--search <text>]
  taskmux task board [--status <status>] [--owner <owner>] [--tag <tag>] [--priority <priority>] [--search <text>]
  taskmux task show <task-id>
  taskmux task start <task-id>
  taskmux task done <task-id>
  taskmux task archive <task-id>
  taskmux task reopen <task-id>
  taskmux task open <task-id>
  taskmux task context <task-id> [--format text|json] [--include-transcripts]
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
