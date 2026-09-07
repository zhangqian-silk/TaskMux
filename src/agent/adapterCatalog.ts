export type AgentAdapterId = "codex" | "claude" | "acp";

export type AgentAdapterCatalogEntry = Readonly<{
  id: AgentAdapterId;
  label: string;
}>;

export const AGENT_ADAPTER_CATALOG: readonly AgentAdapterCatalogEntry[] = Object.freeze([
  Object.freeze({ id: "codex", label: "Codex" }),
  Object.freeze({ id: "claude", label: "Claude" }),
  // One adapter for the Agent Client Protocol, not one per product. Which ACP
  // Agent runs is a launch descriptor fact, so a further ACP product needs no
  // new adapter and no new branch anywhere above this line.
  Object.freeze({ id: "acp", label: "Agent Client Protocol" })
]);

export function supportedAgentAdapterIds(): AgentAdapterId[] {
  return AGENT_ADAPTER_CATALOG.map(({ id }) => id).sort();
}

export function isAgentAdapterId(value: unknown): value is AgentAdapterId {
  return AGENT_ADAPTER_CATALOG.some(({ id }) => id === value);
}

/**
 * The catalog's own display label, falling back to the raw id.
 *
 * The fallback is deliberate: a stored binding may name an adapter this build
 * no longer ships, and showing that id is more useful than hiding it.
 */
export function agentAdapterLabel(adapterId: string): string {
  return AGENT_ADAPTER_CATALOG.find(({ id }) => id === adapterId)?.label ?? adapterId;
}
