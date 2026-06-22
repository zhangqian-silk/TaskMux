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

export function taskUsage(): string {
  return `Task commands:
  taskmux task create <title>
  taskmux task list
  taskmux task show <task-id>
`;
}
