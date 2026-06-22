import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TaskComment } from "../comment/comment.js";
import type { Role } from "../role/role.js";
import type { Task } from "../task/task.js";

export type TaskStore = {
  nextTaskId(): string;
  saveTask(task: Task): void;
  listTasks(): Task[];
  getTask(id: string): Task | null;
  saveRole(taskId: string, role: Role): void;
  listRoles(taskId: string): Role[];
  getRole(taskId: string, name: string): Role | null;
  nextCommentId(taskId: string): string;
  saveComment(taskId: string, comment: TaskComment): void;
  listComments(taskId: string): TaskComment[];
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

  saveRole(taskId: string, role: Role): void {
    const roleDir = this.roleDir(taskId, role.name);
    mkdirSync(roleDir, { recursive: true });
    writeFileSync(this.roleFile(taskId, role.name), `${JSON.stringify(role, null, 2)}\n`);
  }

  listRoles(taskId: string): Role[] {
    const rolesDir = this.rolesDir(taskId);
    mkdirSync(rolesDir, { recursive: true });

    return readdirSync(rolesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getRole(taskId, entry.name))
      .filter((role): role is Role => role !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getRole(taskId: string, name: string): Role | null {
    try {
      return JSON.parse(readFileSync(this.roleFile(taskId, name), "utf8")) as Role;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  nextCommentId(taskId: string): string {
    return `comment-${this.listComments(taskId).length + 1}`;
  }

  saveComment(taskId: string, comment: TaskComment): void {
    mkdirSync(this.taskDir(taskId), { recursive: true });
    appendFileSync(this.commentsFile(taskId), `${JSON.stringify(comment)}\n`);
  }

  listComments(taskId: string): TaskComment[] {
    try {
      return readFileSync(this.commentsFile(taskId), "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as TaskComment);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
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

  private commentsFile(taskId: string): string {
    return join(this.taskDir(taskId), "comments.jsonl");
  }

  private rolesDir(taskId: string): string {
    return join(this.taskDir(taskId), "roles");
  }

  private roleDir(taskId: string, name: string): string {
    return join(this.rolesDir(taskId), name);
  }

  private roleFile(taskId: string, name: string): string {
    return join(this.roleDir(taskId, name), "role.json");
  }
}
