import { activeRoleAgentBinding } from "../role/role.js";
import type { TaskStore } from "../storage/taskStore.js";

/** Native Session identity supplied by the Agent transport. */
export const MANAGED_NATIVE_SESSION_ENV = "YUI_NATIVE_SESSION_ID";

/**
 * One authority for "is this process the current runtime of a Task Role?".
 *
 * The caller names its Task, Role and native Session. Durable state supplies
 * the active Agent, adapter and current Turn. Reattaching the same Session
 * does not change authority; replacing that Session does. This is a local
 * identity boundary, not protection from another process that can read and
 * modify the same user's Home.
 */
export type ManagedTaskCaller = Readonly<{
  taskId: string;
  roleName: string;
  /** Durable active Agent of the Role this process belongs to. */
  agentId: string;
  adapterId: string;
  nativeSessionId: string;
  /** Workspace the process was launched into. */
  workspace?: string;
  /** Durable active Turn of this Task/Role when the command ran, if any. */
  currentTurnId?: string;
}>;

export type ManagedCallerStore = Pick<
  TaskStore,
  "getRole" | "getActiveTurn" | "getTaskRoleSessionSet"
>;

/** Immutable self-identity a managed Task Session asserts about its own process. */
export type ManagedTaskSessionIdentity = Readonly<{
  taskId: string;
  roleName: string;
  workspace?: string;
  nativeSessionId?: string;
}>;

/**
 * A managed Session presented valid self-identity but is no longer the current
 * runtime of its Task Role. This is a bounded diagnosis rather than a bare
 * denial: the Agent can still read current state and decide whether to re-read,
 * hand back, or stop.
 */
export class ManagedRuntimeDriftError extends Error {
  readonly name = "ManagedRuntimeDriftError";

  constructor(message: string) {
    super(message);
  }
}

/** Reads the process's own immutable managed identity, or undefined when unmanaged. */
export function managedTaskSessionIdentity(
  environment: NodeJS.ProcessEnv | undefined
): ManagedTaskSessionIdentity | undefined {
  const env = environment ?? {};
  if (env.YUI_SESSION_SCOPE !== "task") return undefined;
  const taskId = identity(env.YUI_TASK_ID);
  const roleName = identity(env.YUI_ROLE);
  if (taskId === undefined || roleName === undefined) {
    throw new ManagedRuntimeDriftError(
      "Managed Task Session identity is incomplete: YUI_TASK_ID and YUI_ROLE are required."
    );
  }
  const workspace = identity(env.YUI_WORKSPACE);
  const nativeSessionId = identity(env.CODEX_THREAD_ID ?? env[MANAGED_NATIVE_SESSION_ENV]);
  return Object.freeze({
    taskId,
    roleName,
    ...(workspace === undefined ? {} : { workspace }),
    ...(nativeSessionId === undefined ? {} : { nativeSessionId })
  });
}

/**
 * Resolves the current runtime authority for a managed Task Session, or
 * undefined for an unmanaged (plain user) invocation. Throws only when the
 * process claims managed identity that durable state no longer recognizes.
 */
export function resolveManagedTaskCaller(
  store: ManagedCallerStore,
  environment: NodeJS.ProcessEnv | undefined
): ManagedTaskCaller | undefined {
  const self = managedTaskSessionIdentity(environment);
  if (self === undefined) return undefined;
  return requireCurrentRuntime(store, self);
}

/** Same as resolveManagedTaskCaller, but requires a managed Task Session. */
export function requireManagedTaskCaller(
  store: ManagedCallerStore,
  environment: NodeJS.ProcessEnv | undefined
): ManagedTaskCaller {
  const caller = resolveManagedTaskCaller(store, environment);
  if (caller === undefined) {
    throw new ManagedRuntimeDriftError("This command requires a managed Task Session.");
  }
  return caller;
}

/**
 * The current runtime authority for one Task Role, or undefined. Used by
 * command authorization that must not fail the whole invocation, only decline
 * one privileged effect.
 */
export function currentManagedRuntime(
  store: ManagedCallerStore,
  environment: NodeJS.ProcessEnv | undefined,
  taskId: string,
  roleName?: string
): ManagedTaskCaller | undefined {
  let caller: ManagedTaskCaller | undefined;
  try {
    caller = resolveManagedTaskCaller(store, environment);
  } catch {
    return undefined;
  }
  if (caller === undefined || caller.taskId !== taskId) return undefined;
  if (roleName !== undefined && caller.roleName !== roleName) return undefined;
  return caller;
}

function requireCurrentRuntime(
  store: ManagedCallerStore,
  self: ManagedTaskSessionIdentity
): ManagedTaskCaller {
  const role = store.getRole(self.taskId, self.roleName);
  if (role === null) {
    throw new ManagedRuntimeDriftError(
      `This managed Session belongs to ${self.taskId}/${self.roleName}, which no longer exists. `
        + "A new Session must be launched to act on this Task."
    );
  }
  const agentId = role.activeAgentId;
  const sessions = store.getTaskRoleSessionSet(self.taskId, self.roleName);
  const session = sessions?.sessions[agentId];
  if (self.nativeSessionId === undefined) {
    throw new ManagedRuntimeDriftError(
      `This managed Session carries no native session id, so it cannot be recognized `
        + `as the current runtime of ${self.taskId}/${self.roleName}.`
    );
  }
  if (sessions?.activeAgentId !== agentId || session === undefined || session.status !== "active"
    || session.nativeSessionId !== self.nativeSessionId
    || session.adapterId !== activeRoleAgentBinding(role).adapterId
    || (self.workspace !== undefined && self.workspace !== session.effective.workspace.root)) {
    throw new ManagedRuntimeDriftError(
      `This managed Session is no longer the current runtime of ${self.taskId}/${self.roleName} `
        + `(the Role now runs Agent ${agentId}). Its native Session was replaced or its Role was `
        + "rebound, so its native session id no longer matches. Nothing was changed. Read the "
        + `current state with \`yui task show ${self.taskId}\`; acting requires the Session Yui `
        + "launched for the current runtime."
    );
  }
  const activeTurn = store.getActiveTurn(self.taskId, self.roleName);
  return Object.freeze({
    taskId: self.taskId,
    roleName: self.roleName,
    agentId,
    adapterId: activeRoleAgentBinding(role).adapterId,
    nativeSessionId: session.nativeSessionId,
    ...(self.workspace === undefined ? {} : { workspace: self.workspace }),
    ...(activeTurn === null || activeTurn.status !== "active"
      ? {}
      : { currentTurnId: activeTurn.id })
  });
}

function identity(value: unknown): string | undefined {
  if (typeof value !== "string" || value.includes("\0")) return undefined;
  const normalized = value.trim();
  return normalized.length === 0 || normalized !== value ? undefined : normalized;
}
