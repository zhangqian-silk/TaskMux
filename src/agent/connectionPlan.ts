/**
 * The connection plan: how Yui reaches an execution component.
 *
 * Yui's adapter id has always carried this meaning, but two of its values are
 * product names and one is a protocol name, which reads as a single mixed axis.
 * Nothing about the plans changes here; they are stated explicitly instead of
 * being implied by an adapter id and a lookup table elsewhere.
 *
 * A plan names its protocol and its transport together, as one authoritative
 * binding. Protocol and transport are not independently selectable: there is no
 * combination graph to assemble, because a wire protocol and the carrier it
 * runs over are decided as a pair by the implementation that speaks them.
 *
 * Static protocol support is what this table records: what Yui's own client
 * implements. It is not what a given Agent agreed to. Live handshake facts are
 * negotiated per connection and reported separately; where a plan negotiates
 * nothing, its handshake is explicitly `none` rather than silently absent.
 */

import { AGENT_ADAPTER_CATALOG, type AgentAdapterId } from "./adapterCatalog.js";

export type AgentWireProtocol =
  | "codex-app-server"
  | "claude-stream-json"
  | "agent-client-protocol";

export type AgentTransport = "codex-app-server-proxy" | "claude-stream-json" | "acp-stdio";

/** How a plan learns what the far side supports. */
export type AgentHandshakeKind =
  /** A protocol exchange settles capabilities per connection. */
  | "negotiated"
  /** The plan has no capability exchange; static support is the whole answer. */
  | "none";

export type AgentConnectionPlan = Readonly<{
  /** The plan is addressed by the adapter id already stored everywhere. */
  id: AgentAdapterId;
  label: string;
  protocol: AgentWireProtocol;
  /**
   * The protocol revision Yui's client implements, or `unknown` where the
   * product versions the interface rather than the protocol.
   */
  protocolVersion: string | "unknown";
  transport: AgentTransport;
  handshake: AgentHandshakeKind;
  /** The method that negotiates capabilities, when the plan has one. */
  handshakeMethod?: string;
}>;

export const AGENT_CONNECTION_PLANS: readonly AgentConnectionPlan[] = Object.freeze([
  Object.freeze({
    id: "codex",
    label: "Codex app-server",
    protocol: "codex-app-server",
    // Codex versions its app-server interface with the CLI, not separately.
    protocolVersion: "unknown",
    transport: "codex-app-server-proxy",
    handshake: "none"
  } as const),
  Object.freeze({
    id: "claude",
    label: "Claude Code stream-json",
    protocol: "claude-stream-json",
    protocolVersion: "unknown",
    transport: "claude-stream-json",
    handshake: "none"
  } as const),
  Object.freeze({
    id: "acp",
    label: "Agent Client Protocol (stdio)",
    protocol: "agent-client-protocol",
    protocolVersion: "1",
    transport: "acp-stdio",
    handshake: "negotiated",
    handshakeMethod: "initialize"
  } as const)
]);

export function agentConnectionPlan(adapterId: AgentAdapterId): AgentConnectionPlan {
  const plan = AGENT_CONNECTION_PLANS.find(({ id }) => id === adapterId);
  if (plan === undefined) {
    throw new Error(`No connection plan for adapter: ${adapterId}.`);
  }
  return plan;
}

export function agentTransportForAdapter(adapterId: AgentAdapterId): AgentTransport {
  return agentConnectionPlan(adapterId).transport;
}

// Every catalogued adapter must have exactly one plan. Checking at module load
// turns a missing entry into an immediate, obvious failure rather than a
// transport mismatch surfacing at launch.
for (const { id } of AGENT_ADAPTER_CATALOG) agentConnectionPlan(id);
