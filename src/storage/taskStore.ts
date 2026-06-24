import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TaskComment } from "../comment/comment.js";
import { dataError } from "../errors/cliError.js";
import type { TaskEvent } from "../event/taskEvent.js";
import type { Role } from "../role/role.js";
import type { CustomRunner } from "../runner/runner.js";
import type { Task, TaskStatus } from "../task/task.js";

type TaskInfo = {
  schemaVersion: 1;
  title: string;
};

type TaskRecord = Omit<Task, "title"> & {
  title?: string;
};

type RoleInfo = {
  schemaVersion: 1;
  name: string;
};

type RoleRecord = Omit<Role, "name"> & {
  name?: string;
};

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
  nextEventId(taskId: string): string;
  saveEvent(taskId: string, event: TaskEvent): void;
  listEvents(taskId: string): TaskEvent[];
  saveTranscript(taskId: string, roleName: string, transcript: string): void;
  saveCustomRunner(runner: CustomRunner): void;
  listCustomRunners(): CustomRunner[];
  getCustomRunner(id: string): CustomRunner | null;
  removeCustomRunner(id: string): boolean;
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
    writeFileSync(this.taskFile(task.id), `${JSON.stringify(taskRecord(task), null, 2)}\n`);
    writeFileSync(this.taskInfoFile(task.id), `${JSON.stringify(taskInfo(task), null, 2)}\n`);
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
      const taskRecordValue = parseTaskRecord(id, readFileSync(this.taskFile(id), "utf8"));
      const taskInfoRaw = this.readOptionalText(this.taskInfoFile(id));
      const info = taskInfoRaw === null
        ? legacyTaskInfo(id, taskRecordValue)
        : parseTaskInfo(id, taskInfoRaw);

      return {
        ...taskRecordValue,
        title: info.title
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  saveRole(taskId: string, role: Role): void {
    const storageName = this.resolveRoleStorageName(taskId, role.name) ?? role.name;
    const roleDir = this.roleDir(taskId, storageName);
    mkdirSync(roleDir, { recursive: true });
    writeFileSync(this.roleFile(taskId, storageName), `${JSON.stringify(roleRecord(role), null, 2)}\n`);
    writeFileSync(this.roleInfoFile(taskId, storageName), `${JSON.stringify(roleInfo(role), null, 2)}\n`);
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
      return this.getRoleByStorageName(taskId, name) ?? this.findRoleByInfoName(taskId, name);
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
        .map((line, index) => parseComment(`${taskId}:${index + 1}`, line));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  nextEventId(taskId: string): string {
    return `event-${this.listEvents(taskId).length + 1}`;
  }

  saveEvent(taskId: string, event: TaskEvent): void {
    mkdirSync(this.taskDir(taskId), { recursive: true });
    appendFileSync(this.eventsFile(taskId), `${JSON.stringify(event)}\n`);
  }

  listEvents(taskId: string): TaskEvent[] {
    try {
      return readFileSync(this.eventsFile(taskId), "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line, index) => parseEvent(`${taskId}:${index + 1}`, line));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  saveTranscript(taskId: string, roleName: string, transcript: string): void {
    const storageName = this.resolveRoleStorageName(taskId, roleName) ?? roleName;
    const roleDir = this.roleDir(taskId, storageName);
    mkdirSync(roleDir, { recursive: true });
    writeFileSync(this.transcriptFile(taskId, storageName), transcript);
  }

  saveCustomRunner(runner: CustomRunner): void {
    const runnerDir = this.runnerDir(runner.id);
    mkdirSync(runnerDir, { recursive: true });
    writeFileSync(this.runnerFile(runner.id), `${JSON.stringify(runner, null, 2)}\n`);
  }

  listCustomRunners(): CustomRunner[] {
    const runnersDir = this.runnersDir();
    mkdirSync(runnersDir, { recursive: true });

    return readdirSync(runnersDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getCustomRunner(entry.name))
      .filter((runner): runner is CustomRunner => runner !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  getCustomRunner(id: string): CustomRunner | null {
    try {
      return parseCustomRunner(id, readFileSync(this.runnerFile(id), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  removeCustomRunner(id: string): boolean {
    try {
      rmSync(this.runnerDir(id), { recursive: true });
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return false;
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

  private taskInfoFile(id: string): string {
    return join(this.taskDir(id), "info.json");
  }

  private commentsFile(taskId: string): string {
    return join(this.taskDir(taskId), "comments.jsonl");
  }

  private eventsFile(taskId: string): string {
    return join(this.taskDir(taskId), "events.jsonl");
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

  private roleInfoFile(taskId: string, name: string): string {
    return join(this.roleDir(taskId, name), "info.json");
  }

  private transcriptFile(taskId: string, name: string): string {
    return join(this.roleDir(taskId, name), "transcript.log");
  }

  private runnersDir(): string {
    return join(this.rootDir, "runners");
  }

  private runnerDir(id: string): string {
    return join(this.runnersDir(), id);
  }

  private runnerFile(id: string): string {
    return join(this.runnerDir(id), "runner.json");
  }

  private getRoleByStorageName(taskId: string, storageName: string): Role | null {
    try {
      const roleRecordValue = parseRoleRecord(storageName, readFileSync(this.roleFile(taskId, storageName), "utf8"));
      const roleInfoRaw = this.readOptionalText(this.roleInfoFile(taskId, storageName));
      const info = roleInfoRaw === null
        ? legacyRoleInfo(storageName, roleRecordValue)
        : parseRoleInfo(storageName, roleInfoRaw);

      return {
        ...roleRecordValue,
        name: info.name
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  private findRoleByInfoName(taskId: string, name: string): Role | null {
    const rolesDir = this.rolesDir(taskId);
    mkdirSync(rolesDir, { recursive: true });

    for (const entry of readdirSync(rolesDir, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      const role = this.getRoleByStorageName(taskId, entry.name);

      if (role !== null && role.name === name) {
        return role;
      }
    }

    return null;
  }

  private resolveRoleStorageName(taskId: string, name: string): string | null {
    const rolesDir = this.rolesDir(taskId);
    mkdirSync(rolesDir, { recursive: true });

    if (this.readOptionalText(this.roleFile(taskId, name)) !== null) {
      return name;
    }

    for (const entry of readdirSync(rolesDir, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      const role = this.getRoleByStorageName(taskId, entry.name);

      if (role !== null && role.name === name) {
        return entry.name;
      }
    }

    return null;
  }

  private readOptionalText(path: string): string | null {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }
}

function taskRecord(task: Task): TaskRecord {
  return {
    schemaVersion: task.schemaVersion,
    id: task.id,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function taskInfo(task: Task): TaskInfo {
  return {
    schemaVersion: 1,
    title: task.title
  };
}

function parseTaskRecord(id: string, raw: string): TaskRecord {
  const value = parseJson(raw, `Invalid task record: ${id}`);

  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    (value.title !== undefined && typeof value.title !== "string") ||
    !isTaskStatus(value.status) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw dataError(`Invalid task record: ${id}`);
  }

  return value as TaskRecord;
}

function parseTaskInfo(id: string, raw: string): TaskInfo {
  const value = parseJson(raw, `Invalid task info record: ${id}`);

  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.title !== "string") {
    throw dataError(`Invalid task info record: ${id}`);
  }

  return value as TaskInfo;
}

function legacyTaskInfo(id: string, task: TaskRecord): TaskInfo {
  if (typeof task.title !== "string") {
    throw dataError(`Invalid task info record: ${id}`);
  }

  return {
    schemaVersion: 1,
    title: task.title
  };
}

function roleRecord(role: Role): RoleRecord {
  return {
    schemaVersion: role.schemaVersion,
    agent: role.agent,
    command: role.command,
    args: role.args,
    env: role.env,
    workspace: role.workspace,
    status: role.status,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt
  };
}

function roleInfo(role: Role): RoleInfo {
  return {
    schemaVersion: 1,
    name: role.name
  };
}

function parseRoleRecord(name: string, raw: string): RoleRecord {
  const value = parseJson(raw, `Invalid role record: ${name}`);

  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    (value.name !== undefined && typeof value.name !== "string") ||
    typeof value.agent !== "string" ||
    (value.command !== undefined && typeof value.command !== "string") ||
    (value.args !== undefined && !isStringArray(value.args)) ||
    (value.env !== undefined && !isStringRecord(value.env)) ||
    typeof value.workspace !== "string" ||
    !["idle", "running", "detached", "exited", "failed"].includes(String(value.status)) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw dataError(`Invalid role record: ${name}`);
  }

  return value as RoleRecord;
}

function parseRoleInfo(name: string, raw: string): RoleInfo {
  const value = parseJson(raw, `Invalid role info record: ${name}`);

  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.name !== "string") {
    throw dataError(`Invalid role info record: ${name}`);
  }

  return value as RoleInfo;
}

function legacyRoleInfo(name: string, role: RoleRecord): RoleInfo {
  if (typeof role.name !== "string") {
    throw dataError(`Invalid role info record: ${name}`);
  }

  return {
    schemaVersion: 1,
    name: role.name
  };
}

function parseCustomRunner(id: string, raw: string): CustomRunner {
  const value = parseJson(raw, `Invalid runner record: ${id}`);

  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    typeof value.command !== "string" ||
    !isStringArray(value.args) ||
    !isStringRecord(value.env) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw dataError(`Invalid runner record: ${id}`);
  }

  return value as CustomRunner;
}

function parseComment(id: string, raw: string): TaskComment {
  const value = parseJson(raw, `Invalid comment record: ${id}`);

  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    typeof value.body !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw dataError(`Invalid comment record: ${id}`);
  }

  return value as TaskComment;
}

function parseEvent(id: string, raw: string): TaskEvent {
  const value = parseJson(raw, `Invalid event record: ${id}`);

  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    !isStringRecord(value.payload) ||
    typeof value.createdAt !== "string"
  ) {
    throw dataError(`Invalid event record: ${id}`);
  }

  return value as TaskEvent;
}

function parseJson(raw: string, message: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw dataError(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isTaskStatus(status: unknown): status is TaskStatus {
  return ["open", "active", "done", "archived"].includes(String(status));
}
