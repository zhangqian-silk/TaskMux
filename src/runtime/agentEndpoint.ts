import type { ImplementationRef } from "../kernel/instanceHost.js";
import { builtinAgentEndpointImplementation, requireBuiltinAgentEndpointImplementation } from "./agentEndpointIdentity.js";
import { CodexPreSubmissionError } from "./codexAppServerRuntime.js";
export { builtinAgentEndpointImplementation } from "./agentEndpointIdentity.js";
import type { AgentHostLaunchPayload } from "./launchBroker.js";
import {
  ProviderDeliveryUnknownError,
  ProviderTurnBusyError,
  ProviderTurnRejectedError,
  startStructuredProviderSession,
  type StructuredProviderGoal,
  type StructuredProviderProcessExit,
  type StructuredProviderSession,
  type StructuredProviderTurnInput,
  type StructuredProviderTurnReceipt,
  type StructuredProviderTurnStarted,
  type StructuredProviderTurnTerminal
} from "./structuredProviderHost.js";

/** These are attachment facts, not another durable Task/Turn state machine. */
export type AgentEndpointSubmission =
  | Readonly<{ status: "accepted"; receipt: StructuredProviderTurnReceipt }>
  | Readonly<{ status: "pending"; reason: "submitting" | "native-busy"; error?: ProviderTurnBusyError }>
  | Readonly<{ status: "not-submitted"; error: unknown }>
  | Readonly<{ status: "unknown"; error: ProviderDeliveryUnknownError }>;

export type AgentEndpointInput = StructuredProviderTurnInput & Readonly<{
  /** Reference to the durable input; the Endpoint never invents or owns it. */
  inputRef: string;
}>;

export type AgentEndpointEvent = Readonly<{
  implementation: ImplementationRef;
  processInstanceId: string;
}> & (
  | Readonly<{ type: "started"; value: StructuredProviderTurnStarted }>
  | Readonly<{ type: "terminal"; value: StructuredProviderTurnTerminal }>
  | Readonly<{ type: "goal"; value: StructuredProviderGoal | null }>
);

export type AgentEndpointConfiguration = Readonly<{
  implementation: ImplementationRef;
  command: string;
  args: readonly string[];
  cwd: string;
  executionEnvironment?: AgentHostLaunchPayload["executionEnvironment"];
  threadOptions?: NonNullable<AgentHostLaunchPayload["providerControl"]>["codexThread"];
}>;

export interface AgentEndpoint {
  readonly adapterId: StructuredProviderSession["adapterId"];
  readonly nativeSessionId: string;
  readonly conversationId: string;
  readonly processInstanceId: string;
  readonly configuration: AgentEndpointConfiguration;
  readonly capabilities: Readonly<{ steer: "native" | "unsupported"; cancel: "native-interrupt" | "owned-process" }>;
  submit(input: AgentEndpointInput): Promise<AgentEndpointSubmission>;
  steer(input: AgentEndpointInput): Promise<AgentEndpointSubmission>;
  inspect(): Readonly<{
    activeTurnId?: string;
    submissions: readonly Readonly<{ attemptId: string; inputRef: string; disposition: AgentEndpointSubmission }>[];
    attachment: "attached" | "detach-requested" | "exited";
    cancellation: "not-requested" | "requested";
    /** An owned client exiting does not prove shared/native descendants stopped. */
    resources: "unknown";
  }>;
  events(listener: (event: AgentEndpointEvent) => void): () => void;
  cancel(attemptId: string): Promise<Readonly<{ status: "requested" | "not-active" | "unknown"; resources: "unknown" }>>;
  detach(signal?: NodeJS.Signals): void;
  waitForExit(): Promise<StructuredProviderProcessExit>;
}

export type OpenedAgentEndpoint = Readonly<{
  session: AgentEndpoint;
  recoveredTerminal?: StructuredProviderTurnTerminal;
  goal?: StructuredProviderGoal | null;
}>;

/**
 * The only built-in managed execution factory. Product/protocol codecs remain
 * private to runtime; the Host consumes the same boundary for both providers.
 * An injected opener is useful for isolated protocol evidence, not a fallback.
 */
export function createAgentEndpointFactory(
  start: typeof startStructuredProviderSession = startStructuredProviderSession
): Readonly<{
  open(payload: AgentHostLaunchPayload): Promise<OpenedAgentEndpoint>;
  resume(payload: AgentHostLaunchPayload): Promise<OpenedAgentEndpoint>;
}> {
  const connect = async (payload: AgentHostLaunchPayload, mode: "new" | "resume"): Promise<OpenedAgentEndpoint> => {
    const control = payload.providerControl;
    if (control === undefined || control.mode !== mode) {
      throw new Error(`AgentEndpoint ${mode === "new" ? "open" : "resume"} requires matching Session intent.`);
    }
    const pinned = control.endpointImplementation;
    const implementation = pinned === undefined ? builtinAgentEndpointImplementation(control.adapterId)
      : Object.freeze({ ...requireBuiltinAgentEndpointImplementation(control.adapterId, pinned) });
    // Clone before asynchronous startup; callers must not mutate the Session's
    // effective invocation when configuration changes for a subsequent Turn.
    const configuration = Object.freeze({
      implementation,
      command: payload.command,
      args: Object.freeze([...payload.args]),
      cwd: payload.cwd,
      ...(payload.executionEnvironment === undefined ? {} : {
        executionEnvironment: freezeConfiguration(structuredClone(payload.executionEnvironment))
      }),
      ...(control.codexThread === undefined ? {} : {
        threadOptions: freezeConfiguration(structuredClone(control.codexThread))
      })
    });
    let endpoint: BuiltinAgentEndpoint | undefined;
    const openingEvents: EventValue[] = [];
    const emit = (event: EventValue): void => {
      if (endpoint === undefined) openingEvents.push(event);
      else endpoint.observe(event);
    };
    const opened = await start(payload, {
      onStarted: (value) => emit({ type: "started", value }),
      onTerminal: (value) => emit({ type: "terminal", value }),
      onGoal: (value) => emit({ type: "goal", value })
    });
    endpoint = new BuiltinAgentEndpoint(opened.session, configuration);
    for (const event of openingEvents) endpoint.observe(event);
    return Object.freeze({
      session: endpoint,
      ...(opened.recoveredTerminal === undefined ? {} : { recoveredTerminal: opened.recoveredTerminal }),
      ...(opened.goal === undefined ? {} : { goal: opened.goal })
    });
  };
  return Object.freeze({
    open: (payload) => connect(payload, "new"),
    resume: (payload) => connect(payload, "resume")
  });
}

function freezeConfiguration<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value)) freezeConfiguration(member);
    Object.freeze(value);
  }
  return value;
}

type EventValue =
  | Readonly<{ type: "started"; value: StructuredProviderTurnStarted }>
  | Readonly<{ type: "terminal"; value: StructuredProviderTurnTerminal }>
  | Readonly<{ type: "goal"; value: StructuredProviderGoal | null }>;

class BuiltinAgentEndpoint implements AgentEndpoint {
  readonly capabilities;
  readonly #listeners = new Set<(event: AgentEndpointEvent) => void>();
  readonly #openingEvents: AgentEndpointEvent[] = [];
  readonly #attempts = new Map<string, {
    input: AgentEndpointInput;
    operation: "submit" | "steer";
    disposition: AgentEndpointSubmission;
  }>();
  #attachment: "attached" | "detach-requested" | "exited" = "attached";
  #cancellation: "not-requested" | "requested" = "not-requested";

  constructor(
    private readonly driver: StructuredProviderSession,
    readonly configuration: AgentEndpointConfiguration
  ) {
    this.capabilities = Object.freeze({
      steer: driver.adapterId === "codex" ? "native" as const : "unsupported" as const,
      cancel: driver.adapterId === "codex" ? "native-interrupt" as const : "owned-process" as const
    });
    void driver.waitForExit().then(() => { this.#attachment = "exited"; });
  }

  get adapterId(): StructuredProviderSession["adapterId"] { return this.driver.adapterId; }
  get nativeSessionId(): string { return this.driver.nativeSessionId; }
  get conversationId(): string { return this.driver.conversationId; }
  get processInstanceId(): string { return this.driver.processInstanceId; }

  submit(input: AgentEndpointInput): Promise<AgentEndpointSubmission> {
    return this.deliver(input, "submit");
  }

  steer(input: AgentEndpointInput): Promise<AgentEndpointSubmission> {
    return this.deliver(input, "steer");
  }

  private async deliver(input: AgentEndpointInput, operation: "submit" | "steer"): Promise<AgentEndpointSubmission> {
    if (!input.attemptId || !input.inputRef) throw new Error("Endpoint input requires attemptId and inputRef.");
    const previous = this.#attempts.get(input.attemptId);
    if (previous !== undefined) {
      if (previous.input.inputRef !== input.inputRef || previous.input.boundedText !== input.boundedText
        || previous.operation !== operation) {
        throw new Error("Endpoint attempt identity cannot be reused for different input or operation.");
      }
      // Busy is a proven non-write: the same durable request may be tried
      // explicitly later. Unknown, accepted and in-flight input are never resent.
      if (previous.disposition.status !== "pending" || previous.disposition.reason !== "native-busy") {
        return previous.disposition;
      }
    }
    if (this.#attachment !== "attached") {
      return { status: "not-submitted", error: new ProviderTurnRejectedError("Endpoint is detached.", input.attemptId) };
    }
    const attempt = {
      input: Object.freeze({ ...input }),
      operation,
      disposition: { status: "pending", reason: "submitting" } as AgentEndpointSubmission
    };
    this.#attempts.set(input.attemptId, attempt);
    try {
      const receipt = await (operation === "submit"
        ? this.driver.submitTurn(input) : this.driver.steerTurn(input));
      if (receipt.attemptId !== input.attemptId || receipt.nativeSessionId !== this.nativeSessionId
        || receipt.conversationId !== this.conversationId) {
        throw new ProviderDeliveryUnknownError("Provider receipt does not match Endpoint input.", input.attemptId);
      }
      if (attempt.disposition.status !== "accepted") {
        attempt.disposition = { status: "accepted", receipt };
      }
    } catch (error) {
      if (attempt.disposition.status === "accepted") return attempt.disposition;
      attempt.disposition = error instanceof ProviderTurnBusyError
        ? { status: "pending", reason: "native-busy", error }
        : error instanceof ProviderTurnRejectedError || error instanceof CodexPreSubmissionError
          ? { status: "not-submitted", error }
          : {
              status: "unknown",
              error: error instanceof ProviderDeliveryUnknownError ? error
                : new ProviderDeliveryUnknownError("Provider submission outcome is unknown.", input.attemptId, { cause: error })
            };
    }
    return attempt.disposition;
  }

  inspect(): ReturnType<AgentEndpoint["inspect"]> {
    return Object.freeze({
      ...(this.driver.activeTurnId === undefined ? {} : { activeTurnId: this.driver.activeTurnId }),
      submissions: Object.freeze([...this.#attempts].map(([attemptId, attempt]) => Object.freeze({
        attemptId, inputRef: attempt.input.inputRef, disposition: attempt.disposition
      }))),
      attachment: this.#attachment,
      cancellation: this.#cancellation,
      resources: "unknown"
    });
  }

  observe(value: EventValue): void {
    if (value.type !== "goal"
      && (value.value.nativeSessionId !== this.nativeSessionId || value.value.conversationId !== this.conversationId)) return;
    if (value.type === "goal" && value.value !== null && value.value.conversationId !== this.conversationId) return;
    if (value.type === "terminal" && value.value.clientOwned && value.value.attemptId !== undefined) {
      const attempt = this.#attempts.get(value.value.attemptId);
      if (attempt !== undefined) {
        const prior = attempt.disposition;
        if (prior.status === "accepted" && prior.receipt.nativeTurnId !== undefined
          && prior.receipt.nativeTurnId !== value.value.nativeTurnId) return;
        // An exactly correlated terminal is stronger evidence than pipe write
        // or a lost acknowledgement. It never adopts the current attempt.
        attempt.disposition = {
          status: "accepted",
          receipt: {
            attemptId: value.value.attemptId,
            nativeSessionId: this.nativeSessionId,
            conversationId: this.conversationId,
            ...(value.value.nativeTurnId === undefined ? {} : { nativeTurnId: value.value.nativeTurnId }),
            acceptedAt: value.value.observedAt,
            acceptance: "provider"
          }
        };
      }
    }
    const event = Object.freeze({
      ...value, implementation: this.configuration.implementation, processInstanceId: this.processInstanceId
    });
    if (this.#listeners.size === 0) this.#openingEvents.push(event);
    else for (const listener of this.#listeners) listener(event);
  }

  events(listener: (event: AgentEndpointEvent) => void): () => void {
    this.#listeners.add(listener);
    for (const event of this.#openingEvents.splice(0)) listener(event);
    return () => { this.#listeners.delete(listener); };
  }

  async cancel(attemptId: string): ReturnType<AgentEndpoint["cancel"]> {
    this.#cancellation = "requested";
    const status = await this.driver.cancelTurn(attemptId);
    return Object.freeze({ status, resources: "unknown" });
  }

  detach(signal: NodeJS.Signals = "SIGTERM"): void {
    if (this.#attachment === "exited") return;
    this.#attachment = "detach-requested";
    // The driver terminates only its owned proxy/stream process group.
    this.driver.terminate(signal);
  }

  waitForExit(): Promise<StructuredProviderProcessExit> { return this.driver.waitForExit(); }
}
