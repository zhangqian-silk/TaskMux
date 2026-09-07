import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  validateProviderAuthorityFence,
  type ProviderAuthorityFence
} from "./providerAuthorityFence.js";
import { AGENT_HOST_LAUNCH_TICKET_TTL_MS } from "./runtimeDeadlines.js";
import type { CodexThreadOptions } from "./codexAppServerRuntime.js";
import type { ImplementationRef } from "../kernel/instanceHost.js";
import { validateAgentEndpointImplementation } from "./agentEndpointIdentity.js";
import { validateExecutionEnvironmentSnapshot, type ExecutionEnvironmentSnapshot } from "../resources/projectResource.js";
import { isAgentAdapterId, type AgentAdapterId } from "../agent/adapterCatalog.js";
import { resolveAgentAdapter } from "../executor/agentAdapter.js";

/** Each adapter speaks exactly one managed transport. */
const ADAPTER_TRANSPORTS: Readonly<
  Record<AgentAdapterId, AgentHostProviderControl["transport"]>
> = Object.freeze({
  codex: "codex-app-server-proxy",
  claude: "claude-stream-json",
  acp: "acp-stdio"
});

export type AgentHostLaunchPayload = Readonly<{
  schemaVersion: 2;
  command: string;
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
  cwd: string;
  executionEnvironment?: ExecutionEnvironmentSnapshot;
  childLifecycle: "persistent" | "per-turn";
  startMode: "provider" | "idle";
  providerControl?: AgentHostProviderControl;
}>;

export type ProviderOwnedTurn = Readonly<{
  attemptId: string;
  turnId: string;
}>;

type AgentHostProviderControlBase = Readonly<{
  schemaVersion: 1;
  adapterId: AgentAdapterId;
  transport: "codex-app-server-proxy" | "claude-stream-json" | "acp-stdio";
  sessionTitle?: string;
  authority: ProviderAuthorityFence;
  codexThread?: CodexThreadOptions;
  endpointImplementation?: ImplementationRef;
  /** Session-only launch; the coordinator records its identity before any input. */
  sessionOnly?: boolean;
}>;

/**
 * Session lifecycle is independent from Turn submission. `start` creates one
 * new native Session; `restore` reattaches exactly the named Session and never
 * falls back to creating another one.
 */
export type AgentHostProviderControl = AgentHostProviderControlBase & (
  | Readonly<{
      kind: "start";
      mode: "new";
      nativeSessionId?: string;
    }>
  | Readonly<{
      kind: "restore";
      mode: "resume";
      nativeSessionId: string;
      ownedTurn?: ProviderOwnedTurn;
    }>
);

type Reservation = Readonly<{
  ticket: string;
  payload: AgentHostLaunchPayload;
  createdAt: number;
}>;

const brokers = new Map<string, LaunchBroker>();

/** One Controller-process broker per canonical Home. Payloads never hit disk or tmux. */
export function launchBrokerForHome(home: string): LaunchBroker {
  const key = resolve(home);
  const existing = brokers.get(key);
  if (existing !== undefined) return existing;
  const broker = new LaunchBroker();
  brokers.set(key, broker);
  return broker;
}

export class LaunchBroker {
  readonly #reservations = new Map<string, Reservation>();

  reserve(payload: AgentHostLaunchPayload): Readonly<{ ticket: string }> {
    validatePayload(payload);
    const ticket = randomBytes(32).toString("hex");
    this.#reservations.set(ticket, Object.freeze({
      ticket,
      payload,
      createdAt: Date.now()
    }));
    return Object.freeze({ ticket });
  }

  redeem(ticket: string): AgentHostLaunchPayload {
    const reservation = this.#reservations.get(ticket);
    if (reservation === undefined || reservation.ticket !== ticket) {
      throw new Error("Launch ticket is invalid or already consumed.");
    }
    this.#reservations.delete(ticket);
    if (Date.now() - reservation.createdAt > AGENT_HOST_LAUNCH_TICKET_TTL_MS) {
      throw new Error("Launch ticket expired before redemption.");
    }
    return reservation.payload;
  }

  revoke(ticket: string): void {
    this.#reservations.delete(ticket);
  }

  pendingCount(): number {
    return this.#reservations.size;
  }
}

export function validateAgentHostLaunchPayload(value: unknown): AgentHostLaunchPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent Host launch payload must be an object.");
  }
  return validatePayload(value as AgentHostLaunchPayload);
}

function validatePayload(payload: AgentHostLaunchPayload): AgentHostLaunchPayload {
  if (payload.schemaVersion !== 2) throw new Error("Agent Host launch payload version is invalid.");
  text(payload.command, "command");
  text(payload.cwd, "cwd");
  if (!Array.isArray(payload.args)) throw new Error("Agent Host launch args must be an array.");
  payload.args.forEach((value) => text(value, "argument"));
  if (payload.environment === null || typeof payload.environment !== "object") {
    throw new Error("Agent Host launch environment must be an object.");
  }
  for (const [key, value] of Object.entries(payload.environment)) {
    text(key, "environment key");
    if (typeof value !== "string" || value.includes("\0")) {
      throw new Error("Agent Host launch environment value is invalid.");
    }
  }
  if (payload.executionEnvironment !== undefined) {
    const adopted = validateExecutionEnvironmentSnapshot(payload.executionEnvironment);
    if (payload.environment.YUI_SESSION_SCOPE !== "task"
      || payload.environment.YUI_TASK_ID !== adopted.taskId
      || payload.cwd !== adopted.directory.path) {
      throw new Error("Agent Host execution environment does not match its Task and cwd.");
    }
  }
  if (payload.childLifecycle !== "persistent" && payload.childLifecycle !== "per-turn") {
    throw new Error("Agent Host child lifecycle is invalid.");
  }
  if (payload.startMode !== "provider" && payload.startMode !== "idle") {
    throw new Error("Agent Host start mode is invalid.");
  }
  if (payload.providerControl !== undefined) validateProviderControl(payload.providerControl);
  return payload;
}

function validateProviderControl(control: AgentHostProviderControl): void {
  if (control.schemaVersion !== 1) throw new Error("Agent Host Provider control version is invalid.");
  if (control.endpointImplementation !== undefined) validateAgentEndpointImplementation(control.endpointImplementation);
  if (!isAgentAdapterId(control.adapterId)) {
    throw new Error("Agent Host Provider control adapter is invalid.");
  }
  if (control.transport !== ADAPTER_TRANSPORTS[control.adapterId]) {
    throw new Error("Agent Host Provider control transport does not match its adapter.");
  }
  if ((control.adapterId === "codex") !== (control.codexThread !== undefined)) {
    throw new Error("Agent Host Provider thread settings do not match its adapter.");
  }
  if (control.codexThread !== undefined) validateCodexThreadOptions(control.codexThread);
  if (control.mode !== "new" && control.mode !== "resume") {
    throw new Error("Agent Host Provider control mode is invalid.");
  }
  if (control.kind !== "start" && control.kind !== "restore") {
    throw new Error("Agent Host Provider control kind is invalid.");
  }
  if ((control.kind === "start") !== (control.mode === "new")) {
    throw new Error("Agent Host Provider control kind does not match its transport mode.");
  }
  if (control.kind !== "restore" && "ownedTurn" in control) {
    throw new Error("Only Session restore can reconcile an owned Turn.");
  }
  if (control.kind === "restore" && control.ownedTurn !== undefined) {
    if (control.adapterId !== "codex") {
      throw new Error("Only Managed Codex can recover an owned Turn across client attachment.");
    }
    text(control.ownedTurn.attemptId, "owned Provider input attemptId");
    text(control.ownedTurn.turnId, "owned Provider Turn id");
  }
  // Resume always needs the id being resumed. A new launch needs one only from
  // an Agent that accepts a caller-chosen Session id; the others report theirs
  // once they answer, so demanding it up front rejects a valid launch.
  const requiresNativeSessionId = control.mode === "resume"
    || resolveAgentAdapter(control.adapterId).capabilities.nativeSessionDiscovery === "preallocated";
  if (requiresNativeSessionId !== (control.nativeSessionId !== undefined)) {
    throw new Error("Agent Host Provider resume identity is inconsistent.");
  }
  if (control.nativeSessionId !== undefined) text(control.nativeSessionId, "nativeSessionId");
  if (control.sessionTitle !== undefined) {
    const title = control.sessionTitle.trim();
    if (
      title.length === 0
      || title.length > 1_024
      || /[\r\n\0]/u.test(title)
    ) {
      throw new Error("Agent Host Provider session title is invalid.");
    }
  }
  validateProviderAuthorityFence(control.authority);
}

function validateCodexThreadOptions(options: CodexThreadOptions): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Agent Host Codex thread settings are invalid.");
  }
  for (const [value, label] of [
    [options.model, "model"],
    [options.approvalPolicy, "approval policy"],
    [options.sandbox, "sandbox"],
    [options.developerInstructions, "developer instructions"]
  ] as const) {
    if (value !== undefined) text(value, `Codex thread ${label}`);
  }
  if (options.runtimeWorkspaceRoots !== undefined) {
    if (!Array.isArray(options.runtimeWorkspaceRoots)) {
      throw new Error("Agent Host Codex runtime workspace roots are invalid.");
    }
    options.runtimeWorkspaceRoots.forEach((root) => text(root, "Codex runtime workspace root"));
  }
  if (options.config !== undefined
    && (options.config === null || typeof options.config !== "object"
      || Array.isArray(options.config))) {
    throw new Error("Agent Host Codex thread config is invalid.");
  }
}

function text(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(`Agent Host ${label} is invalid.`);
  }
  return value;
}
