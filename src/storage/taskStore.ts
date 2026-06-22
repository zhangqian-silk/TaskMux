import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Task } from "../task/task.js";

export type TaskStore = {
  nextTaskId(): string;
  saveTask(task: Task): void;
  listTasks(): Task[];
  getTask(id: string): Task | null;
};

export function resolveTaskmuxHome(env: NodeJS.ProcessEnv): string {
  return env.TASKMUX_HOME ?? join(homedir(), ".taskmux");
}

export class FileTaskStore implements TaskStore {
  constructor(private readonly rootDir: string) {}

  nextTaskId(): string {
    const maxId = this.listTasks().reduce((max, task) => {
      const match = /^task-(\d+)$/.exec(task.id);
      if (match === null) {
        return max;
      }

      return Math.max(max, Number.parseInt(match[1], 10));
    }, 0);

    return `task-${maxId + 1}`;
  }

  saveTask(task: Task): void {
    const taskDir = this.taskDir(task.id);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(this.taskFile(task.id), `${JSON.stringify(task, null, 2)}\n`);
  }

  listTasks(): Task[] {
    const tasksDir = this.tasksDir();
    mkdirSync(tasksDir, { recursive: true });

    return readdirSync(tasksDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getTask(entry.name))
      .filter((task): task is Task => task !== null)
      .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  }

  getTask(id: string): Task | null {
    try {
      return JSON.parse(readFileSync(this.taskFile(id), "utf8")) as Task;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  private tasksDir(): string {
    return join(this.rootDir, "tasks");
  }

  private taskDir(id: string): string {
    return join(this.tasksDir(), id);
  }

  private taskFile(id: string): string {
    return join(this.taskDir(id), "task.json");
  }
}
