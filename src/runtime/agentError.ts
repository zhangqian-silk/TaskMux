/**
 * Provider-neutral Agent failure facts.
 *
 * Drivers recognize provider-native failures. Core persists the resulting
 * facts and routes them to an Agent; it does not attach a recovery policy.
 * `unknown` is the required fallback and the complete native payload is always
 * retained in `raw`.
 */

export const AGENT_ERROR_CATEGORIES = Object.freeze([
  "availability",
  "rate-limit",
  "transport",
  "access",
  "invalid-request",
  "context",
  "session",
  "runtime",
  "conflict",
  "cancelled",
  "unknown"
] as const);

export type AgentErrorCategory = (typeof AGENT_ERROR_CATEGORIES)[number];
export type AgentErrorSource = "provider" | "driver" | "host" | "yui";

export type AgentErrorPhase =
  | "host-start"
  | "session-start"
  | "session-restore"
  | "turn-submit"
  | "turn-execute"
  | "turn-reconcile"
  | "host-stop";

export type AgentErrorInputDisposition = "accepted" | "not-accepted" | "unknown";
export type AgentErrorSessionDisposition = "recoverable" | "unrecoverable" | "unknown";

export type AgentDriverErrorInput = Readonly<{
  /** Human-readable Provider message without losing the native payload. */
  message: string;
  /** Complete serialized Provider exception/payload. */
  raw: string;
}>;

/** Provider-specific recognition result. It contains facts, never strategy. */
export type AgentErrorClassification = Readonly<{
  category: AgentErrorCategory;
  /** Stable namespaced code such as `provider.model-capacity`. */
  code: string;
  inputDisposition?: AgentErrorInputDisposition;
  sessionDisposition?: AgentErrorSessionDisposition;
}>;

export type StandardAgentError = Readonly<{
  source: AgentErrorSource;
  phase: AgentErrorPhase;
  category: AgentErrorCategory;
  code: string;
  message: string;
  raw: string;
  inputDisposition: AgentErrorInputDisposition;
  sessionDisposition: AgentErrorSessionDisposition;
  retryAfterMs?: number;
}>;

export function standardAgentError(input: Readonly<{
  source: AgentErrorSource;
  phase: AgentErrorPhase;
  classification?: AgentErrorClassification;
  message: string;
  raw: string;
  inputDisposition?: AgentErrorInputDisposition;
  sessionDisposition?: AgentErrorSessionDisposition;
  retryAfterMs?: number;
}>): StandardAgentError {
  const classification = input.classification ?? UNKNOWN_AGENT_ERROR_CLASSIFICATION;
  const retryAfterMs = input.retryAfterMs;
  if (retryAfterMs !== undefined
    && (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0)) {
    throw new Error("Agent error retryAfterMs must be a non-negative safe integer.");
  }
  return Object.freeze({
    source: input.source,
    phase: input.phase,
    category: classification.category,
    code: requiredErrorText(classification.code, "Agent error code"),
    // Both readable fields pass the same redaction boundary. `message` is
    // often a Provider string interpolated by a caller, so it can carry a
    // credential even when `raw` is already clean.
    message: redactAgentErrorText(
      requiredErrorText(input.message, "Agent error message")
    ),
    raw: redactAgentErrorText(
      requiredErrorText(input.raw, "Agent error raw payload")
    ),
    inputDisposition: input.inputDisposition
      ?? classification.inputDisposition
      ?? "unknown",
    sessionDisposition: input.sessionDisposition
      ?? classification.sessionDisposition
      ?? "unknown",
    ...(retryAfterMs === undefined ? {} : { retryAfterMs })
  });
}

export const UNKNOWN_AGENT_ERROR_CLASSIFICATION: AgentErrorClassification = Object.freeze({
  category: "unknown",
  code: "unknown"
});

/**
 * Why a managed Provider write did not reach `delivered`.
 *
 * The Agent Host owns these facts; every layer above it forwards this record
 * unchanged instead of re-deriving a reason from a collapsed string enum. It
 * deliberately carries no `category`/`code`: driver classification stays at
 * the single `recordAgentError` boundary that already owns it.
 *
 * `inputDisposition` is the load-bearing field. `not-accepted` means the
 * Provider provably never saw the input and the attempt may be retried;
 * `unknown` forbids automatic replay.
 */
export type ProviderDeliveryFailure = Readonly<{
  /** Host-supplied cause, already redacted and bounded. */
  detail: string;
  /** Failure class name (e.g. `ProviderTurnRejectedError`) when the Host knew it. */
  errorName?: string;
  phase: AgentErrorPhase;
  /** Observed Agent Host provider state at the failure. */
  hostState?: string;
  expectedRuntimeGenerationId?: string;
  observedRuntimeGenerationId?: string;
  attemptId?: string;
  inputDisposition: AgentErrorInputDisposition;
  sessionDisposition?: AgentErrorSessionDisposition;
}>;

export function providerDeliveryFailure(
  input: ProviderDeliveryFailure
): ProviderDeliveryFailure {
  return Object.freeze({
    ...definedDeliveryFields(input),
    detail: redactAgentErrorText(
      requiredErrorText(input.detail, "Provider delivery failure detail")
    ),
    phase: input.phase,
    inputDisposition: input.inputDisposition
  });
}

/**
 * Renders a delivery failure as one readable line for a Turn summary. The
 * complete record stays available on `runtime.agent-error`; this is the
 * bounded projection, never a replacement for the original cause.
 */
export function formatProviderDeliveryFailure(
  failure: ProviderDeliveryFailure
): string {
  const fields = [
    `phase=${failure.phase}`,
    `inputDisposition=${failure.inputDisposition}`
  ];
  if (failure.hostState !== undefined) fields.push(`hostState=${failure.hostState}`);
  if (failure.errorName !== undefined) fields.push(`error=${failure.errorName}`);
  if (failure.expectedRuntimeGenerationId !== undefined) {
    fields.push(`expectedGeneration=${failure.expectedRuntimeGenerationId}`);
  }
  if (failure.observedRuntimeGenerationId !== undefined) {
    fields.push(`observedGeneration=${failure.observedRuntimeGenerationId}`);
  }
  if (failure.attemptId !== undefined) fields.push(`attemptId=${failure.attemptId}`);
  if (failure.sessionDisposition !== undefined) {
    fields.push(`sessionDisposition=${failure.sessionDisposition}`);
  }
  return `${failure.detail} (${fields.join(" ")})`;
}

function definedDeliveryFields(
  value: ProviderDeliveryFailure
): ProviderDeliveryFailure {
  return Object.fromEntries(
    Object.entries(value).filter(([, member]) => member !== undefined)
  ) as unknown as ProviderDeliveryFailure;
}

export function isAgentErrorCategory(value: unknown): value is AgentErrorCategory {
  return typeof value === "string"
    && (AGENT_ERROR_CATEGORIES as readonly string[]).includes(value);
}

export function isStandardAgentError(value: unknown): value is StandardAgentError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const error = value as Partial<StandardAgentError>;
  return ["provider", "driver", "host", "yui"].includes(error.source ?? "")
    && [
      "host-start",
      "session-start",
      "session-restore",
      "turn-submit",
      "turn-execute",
      "turn-reconcile",
      "host-stop"
    ].includes(error.phase ?? "")
    && isAgentErrorCategory(error.category)
    && isErrorText(error.code)
    && isErrorText(error.message)
    && isErrorText(error.raw)
    && ["accepted", "not-accepted", "unknown"].includes(error.inputDisposition ?? "")
    && ["recoverable", "unrecoverable", "unknown"].includes(
      error.sessionDisposition ?? ""
    )
    && (error.retryAfterMs === undefined
      || (Number.isSafeInteger(error.retryAfterMs) && error.retryAfterMs >= 0));
}

/**
 * Upper bound for one persisted raw payload. A Provider stack trace or a
 * transport dump stays readable well below this; anything larger is truncated
 * with an explicit marker so a reader never mistakes a clipped payload for the
 * complete cause.
 */
const MAX_RAW_CHARS = 16_000;

/**
 * Serializes any failure into one bounded, secret-redacted payload.
 *
 * `raw` is the authoritative cause and is persisted verbatim on
 * `runtime.agent-error`, so it is the last boundary before a Provider
 * credential could reach durable storage or a public read. Redaction happens
 * here rather than at each call site: an unredacted path added later would
 * otherwise silently leak. `cause` chains and non-enumerable Error fields are
 * retained because they usually carry the real reason.
 */
export function serializeAgentErrorRaw(value: unknown): string {
  return boundRawPayload(redactAgentErrorText(rawPayloadText(value)));
}

function rawPayloadText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "Agent operation failed without an error payload.";
  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(value, (_key, member: unknown) => {
      if (typeof member === "bigint") return member.toString();
      if (member !== null && typeof member === "object") {
        if (seen.has(member)) return "[Circular]";
        seen.add(member);
        if (member instanceof Error) {
          // Error's own fields are non-enumerable, and `cause` is where a
          // wrapped transport/controller failure keeps its real reason.
          return Object.fromEntries(Object.getOwnPropertyNames(member).map((name) => [
            name,
            (member as unknown as Record<string, unknown>)[name]
          ]));
        }
      }
      return member;
    });
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

const SECRET_ASSIGNMENT_PATTERN =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|cookie|authorization)(\\?["']?\s*[=:]\s*\\?["']?)([^\s,;"'\\]+)/gi;
// Word boundary keeps "task-5-…" workspace paths from being mistaken for keys.
const PROVIDER_KEY_PATTERN = /\b(?:sk|pat|ghp|gho|ghs|github_pat)-[A-Za-z0-9_-]{6,}/gu;
const BEARER_PATTERN = /\b(bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi;

/**
 * Redacts credential-shaped text from a failure payload. This mirrors the
 * launch-diagnostic redaction but is applied to the Agent error chain, whose
 * payloads are persisted and publicly readable through the Task event.
 */
export function redactAgentErrorText(value: string): string {
  return value
    .replace(PROVIDER_KEY_PATTERN, "[REDACTED]")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1$2[REDACTED]");
}

function boundRawPayload(value: string): string {
  const text = isErrorText(value) ? value : "Agent operation failed without a readable error payload.";
  if (text.length <= MAX_RAW_CHARS) return text;
  // Keep the head: a Provider failure states its reason before its stack.
  return `${text.slice(0, MAX_RAW_CHARS)}…[truncated ${text.length - MAX_RAW_CHARS} chars of ${text.length}]`;
}

function isErrorText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
}

function requiredErrorText(value: string, label: string): string {
  if (!isErrorText(value)) throw new Error(`${label} is required.`);
  return value;
}
