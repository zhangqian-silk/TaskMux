import type { TrustedCallContext } from "./callAuthority.js";
import { InstanceHost, type ImplementationRef } from "./instanceHost.js";
import { capabilitySchemaError, checkCapabilitySchema, type CapabilitySchema } from "./capabilitySchema.js";

export type CapabilityEffect = "query" | "local-mutation" | "external-operation";
export type CapabilityScope = Readonly<{ kind: "global" } | { kind: "project" | "task"; id: string }>;
export type CapabilityDescriptor = Readonly<{
  name: string;
  contractVersion: string;
  summary: string;
  inputSchema: CapabilitySchema;
  outputSchema: CapabilitySchema;
  effect: CapabilityEffect;
  requiredPermissions: readonly string[];
  provider: ImplementationRef;
  source: string;
  scope: CapabilityScope;
  required?: readonly Readonly<{ name: string; contractVersion: string }>[];
  unavailable?: string;
}>;
export type CapabilityCall = Readonly<{
  name: string;
  input: unknown;
  contractVersion?: string;
  providerId?: string;
  requestId?: string;
}>;
/** Original owner's read model or receipt, never a new writable operation. */
export type CapabilityOperation = Readonly<{
  operationRef: Readonly<{ taskId: string; jobId: string }>;
  effect: "none" | "possible" | "confirmed";
  state: string;
  outcome?: string;
  receiptRefs: readonly string[];
  partialResultRefs: readonly string[];
}>;
export type CapabilityResult = Readonly<{
  kind: "value" | "operation" | "unavailable" | "ambiguous" | "denied" | "invalid" | "failed";
  effect: "none" | "possible" | "confirmed";
  operations: readonly CapabilityOperation[];
  value?: unknown;
  detail?: string;
  candidates?: readonly CapabilityDescriptor[];
  provider?: ImplementationRef;
  selection?: "explicit" | "unique";
}>;
export type CapabilityInvocation = Readonly<{
  /** No credentials, authority issuer, Store or registry is exposed to code. */
  context: TrustedCallContext;
  requestId?: string;
  call(request: CapabilityCall): Promise<CapabilityResult>;
  /** Save evidence in its semantic owner first; this preserves its locator
   * through wrapper/output failures. Not a persistence API. */
  observe(operation: CapabilityOperation): void;
}>;
export type CapabilityImplementation = Readonly<{
  invoke(name: string, input: unknown, invocation: CapabilityInvocation): unknown | Promise<unknown>;
}>;
export type CapabilityVisibility = Readonly<{ taskIds: readonly string[]; projectIds: readonly string[] }>;
type Authorize = (context: TrustedCallContext, descriptor?: CapabilityDescriptor, input?: unknown) => CapabilityVisibility;
const effectRank = { query: 0, "local-mutation": 1, "external-operation": 2 };
const reserved = new Set(["yui", "task", "config", "job", "resource", "plugin", "runtime", "grant", "capability"]);

/** One rebuildable descriptor view over the composition root's existing Host.
 * Only the trusted root owns this object. Extensions receive a bound invocation
 * port, never the registry/Host or an actor-selecting call interface. */
export class CapabilityRegistry {
  #descriptors: readonly CapabilityDescriptor[] = [];
  readonly #coreProviders = new Set<string>();

  constructor(
    private readonly host: InstanceHost,
    private readonly authorize: Authorize,
    builtins: readonly CapabilityDescriptor[] = []
  ) {
    this.#publish(builtins, true);
    builtins.forEach((entry) => this.#coreProviders.add(entry.provider.id));
  }

  /** Publish a complete provider generation atomically after owner initialization.
   * Failure leaves all existing descriptors intact. Host lifecycle remains owned
   * by the root: publish replacement, then detach old generation when appropriate. */
  register(descriptors: readonly CapabilityDescriptor[]): void {
    this.#publish(descriptors, false);
  }

  disable(providerId: string): void {
    this.#descriptors = this.#descriptors.filter((entry) => entry.provider.id !== providerId);
  }

  search(context: TrustedCallContext, query = ""): readonly CapabilityDescriptor[] {
    const visibility = this.authorize(context);
    return this.#descriptors.filter((entry) => visible(entry.scope, visibility)
      && `${entry.name} ${entry.summary}`.toLowerCase().includes(query.toLowerCase()))
      .filter((entry) => {
        try { this.authorize(context, entry); return true; } catch { return false; }
      });
  }

  describe(context: TrustedCallContext, request: Omit<CapabilityCall, "input">): CapabilityResult {
    try {
      const candidates = this.search(context).filter((entry) => entry.name === request.name
        && (request.contractVersion === undefined || request.contractVersion === entry.contractVersion)
        && (request.providerId === undefined || request.providerId === entry.provider.id));
      if (!candidates.length) return result("unavailable", "No authorized compatible Provider is available.");
      if (candidates.length > 1) return { ...result("ambiguous", "Select an explicit Provider and contract version."), candidates };
      const selected = candidates[0];
      if (selected.unavailable) return { ...result("unavailable", selected.unavailable), candidates };
      // Explicit required names/versions only; no download, execution or solver.
      const available = this.search(context);
      const missing = selected.required?.filter((dependency) => !available.some((entry) => (
        !entry.unavailable && entry.name === dependency.name && entry.contractVersion === dependency.contractVersion
      )));
      if (missing?.length) return { ...result("unavailable", `Missing required capabilities: ${missing.map((entry) => `${entry.name}@${entry.contractVersion}`).join(", ")}.`), candidates };
      return {
        ...result("value"), value: selected, candidates, provider: selected.provider,
        selection: request.providerId === undefined ? "unique" : "explicit"
      };
    } catch {
      return result("denied", "Current call authority is unavailable.");
    }
  }

  call(context: TrustedCallContext, request: CapabilityCall): Promise<CapabilityResult> {
    return this.#call(context, request, "external-operation");
  }

  async #call(context: TrustedCallContext, request: CapabilityCall, ceiling: CapabilityEffect): Promise<CapabilityResult> {
    // Freeze one input snapshot across validation/acquisition and async nesting.
    try { request = deepFreeze(structuredClone(request)); } catch {
      return result("invalid", "Capability request must be cloneable data.");
    }
    const resolved = this.describe(context, request);
    if (resolved.kind !== "value") return resolved;
    const descriptor = resolved.value as CapabilityDescriptor;
    const origin = { provider: descriptor.provider, selection: resolved.selection };
    if (effectRank[descriptor.effect] > effectRank[ceiling]) {
      return { ...result("denied", "Nested call exceeds the parent's effect boundary."), ...origin };
    }
    const inputError = capabilitySchemaError(descriptor.inputSchema, request.input);
    if (inputError) return { ...result("invalid", inputError), ...origin };
    if (descriptor.effect !== "query" && (typeof request.requestId !== "string" || !request.requestId.trim())) {
      return { ...result("invalid", "Effectful calls require requestId."), ...origin };
    }
    try { this.authorize(context, descriptor, request.input); } catch {
      return { ...result("denied", "Current call authority was revoked."), ...origin };
    }
    const operations: CapabilityOperation[] = [];
    let effect: CapabilityResult["effect"] = "none";
    const observe = (operation: CapabilityOperation) => {
      operations.push(structuredClone(operation));
      effect = accumulatedEffect(effect, operation.effect);
    };
    let entered = false;
    try {
      const value = await this.host.use<CapabilityImplementation, unknown>(descriptor.provider, async (implementation) => {
        entered = true;
        let open = true;
        const children: Promise<CapabilityResult>[] = [];
        try {
          return await implementation.invoke(descriptor.name, request.input, Object.freeze({
            context, requestId: request.requestId,
            observe: (operation: CapabilityOperation) => {
              if (!open) throw new Error("Capability invocation has ended.");
              observe(operation);
            },
            call: (nested: CapabilityCall) => {
              if (!open) return Promise.resolve(result("denied", "Capability invocation has ended."));
              const child = this.#call(context, nested, descriptor.effect).then((outcome) => {
                outcome.operations.forEach(observe);
                effect = accumulatedEffect(effect, outcome.effect);
                return outcome;
              });
              children.push(child);
              return child;
            }
          }));
        } finally {
          open = false;
          // A wrapper throwing early must not detach its already-issued child
          // operations from the returned evidence or release the parent handle.
          await Promise.all(children);
        }
      });
      if (descriptor.effect === "local-mutation") effect = accumulatedEffect(effect, "confirmed");
      // An external implementation without an owner's operation reference is not
      // proof of success. Preserve uncertainty rather than return a value success.
      if (descriptor.effect === "external-operation" && !operations.length) {
        return { kind: "failed", detail: "External implementation returned no operation evidence.", effect: "possible", operations, ...origin };
      }
      let output: unknown;
      try { output = JSON.parse(JSON.stringify(value)); } catch {
        return { kind: "invalid", detail: "Output is not JSON serializable.", effect, operations, ...origin };
      }
      const outputError = capabilitySchemaError(descriptor.outputSchema, output);
      if (outputError) return { kind: "invalid", detail: `Output ${outputError}`, effect, operations, ...origin };
      return { kind: operations.length ? "operation" : "value", value: output, effect, operations, ...origin };
    } catch (error) {
      if (entered && descriptor.effect !== "query" && !operations.length) effect = "possible";
      return {
        kind: entered ? "failed" : "unavailable",
        detail: error instanceof Error ? error.message : "Capability invocation failed.",
        effect, operations, ...origin
      };
    }
  }

  #publish(descriptors: readonly CapabilityDescriptor[], core: boolean): void {
    if (!descriptors.length) return;
    const prepared = structuredClone(descriptors);
    const provider = prepared[0].provider;
    if (!core && this.#coreProviders.has(provider.id)) throw new Error("Core Provider identity is reserved.");
    const names = new Set<string>();
    for (const entry of prepared) {
      if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(entry.name)
        || !entry.contractVersion?.trim() || !entry.source?.trim()
        || !Object.hasOwn(effectRank, entry.effect)
        || !Array.isArray(entry.requiredPermissions)
        || entry.requiredPermissions.some((permission) => typeof permission !== "string" || !permission.trim())) {
        throw new Error("Invalid capability descriptor.");
      }
      if (!core && reserved.has(entry.name.split(".")[0])) throw new Error("Core capability namespace is reserved.");
      if (!["global", "project", "task"].includes(entry.scope.kind)
        || (entry.scope.kind !== "global" && !entry.scope.id?.trim())) throw new Error("Invalid capability scope.");
      if (entry.provider.id !== provider.id || entry.provider.generation !== provider.generation) {
        throw new Error("Publish one complete Provider generation at a time.");
      }
      const key = `${entry.name}@${entry.contractVersion}`;
      if (names.has(key)) throw new Error(`Duplicate capability: ${key}.`);
      names.add(key);
      checkCapabilitySchema(entry.inputSchema);
      checkCapabilitySchema(entry.outputSchema);
      for (const dependency of entry.required ?? []) {
        if (!dependency.name?.trim() || !dependency.contractVersion?.trim()) throw new Error("Invalid required capability.");
      }
    }
    // Validate acquisition before publishing; no implementation is invoked.
    if (prepared.some((entry) => !entry.unavailable)) {
      const handle = this.host.acquire<CapabilityImplementation>(provider);
      try {
        if (typeof handle.value?.invoke !== "function") throw new Error("Provider has no capability implementation.");
      } finally { void handle.release(); }
    }
    this.#descriptors = [
      ...this.#descriptors.filter((entry) => entry.provider.id !== provider.id),
      ...prepared.map((entry) => deepFreeze(entry))
    ];
  }
}

function visible(scope: CapabilityScope, visibility: CapabilityVisibility): boolean {
  return scope.kind === "global" || (scope.kind === "task"
    ? visibility.taskIds.includes(scope.id) : visibility.projectIds.includes(scope.id));
}
function result(kind: CapabilityResult["kind"], detail?: string): CapabilityResult {
  return { kind, effect: "none", operations: [], ...(detail === undefined ? {} : { detail }) };
}
function accumulatedEffect(a: CapabilityResult["effect"], b: CapabilityResult["effect"]): CapabilityResult["effect"] {
  return a === "confirmed" || b === "confirmed" ? "confirmed" : a === "possible" || b === "possible" ? "possible" : "none";
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
