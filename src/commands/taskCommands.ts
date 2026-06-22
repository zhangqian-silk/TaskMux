import { createRole } from "../role/role.js";
import { createTask } from "../task/task.js";
import type { TaskStore } from "../storage/taskStore.js";

export function runTaskCommand(args: string[], store: TaskStore): string {
  const [command, ...rest] = args;

  switch (command) {
    case "create":
      return createTaskCommand(rest, store);
    case "list":
      return listTaskCommand(store);
    case "show":
      return showTaskCommand(rest, store);
    case "assign":
      return assignTaskRoleCommand(rest, store);
    case "roles":
      return listTaskRolesCommand(rest, store);
    default:
      return taskUsage();
  }
}

function createTaskCommand(args: string[], store: TaskStore): string {
  const title = args.join(" ").trim();
  const task = createTask(store.nextTaskId(), title, new Date());
  store.saveTask(task);

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
    return "Task id is required.\n";
  }

  const task = store.getTask(id);

  if (task === null) {
    return `Task not found: ${id}\n`;
  }

  return [
    `Task: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Created: ${task.createdAt}`,
    `Updated: ${task.updatedAt}`
  ].join("\n").concat("\n");
}

function assignTaskRoleCommand(args: string[], store: TaskStore): string {
  const [taskId, roleName, ...rest] = args;

  if (taskId === undefined || taskId.trim().length === 0) {
    return "Task id is required.\n";
  }

  if (roleName === undefined || roleName.trim().length === 0) {
    return "Role name is required.\n";
  }

  if (store.getTask(taskId) === null) {
    return `Task not found: ${taskId}\n`;
  }

  const agent = readOption(rest, "--agent");
  const workspace = readOption(rest, "--workspace");
  const role = createRole(roleName, agent, workspace, new Date());

  store.saveRole(taskId, role);

  return [
    `Assigned role ${role.name} to ${taskId}`,
    `Agent: ${role.agent}`,
    `Workspace: ${role.workspace}`
  ].join("\n").concat("\n");
}

function listTaskRolesCommand(args: string[], store: TaskStore): string {
  const [taskId] = args;

  if (taskId === undefined || taskId.trim().length === 0) {
    return "Task id is required.\n";
  }

  if (store.getTask(taskId) === null) {
    return `Task not found: ${taskId}\n`;
  }

  const roles = store.listRoles(taskId);

  if (roles.length === 0) {
    return "No roles assigned.\n";
  }

  return `${roles.map((role) => `${role.name}\t${role.agent}\t${role.status}\t${role.workspace}`).join("\n")}\n`;
}

function readOption(args: string[], name: string): string {
  const index = args.indexOf(name);

  if (index === -1 || args[index + 1] === undefined) {
    throw new Error(`${name} is required.`);
  }

  return args[index + 1];
}

export function taskUsage(): string {
  return `Task commands:
  taskmux task create <title>
  taskmux task list
  taskmux task show <task-id>
  taskmux task assign <task-id> <role> --agent <agent> --workspace <path>
  taskmux task roles <task-id>
`;
}
