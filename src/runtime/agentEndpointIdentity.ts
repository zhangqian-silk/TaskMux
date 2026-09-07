import type { ImplementationRef } from "../kernel/instanceHost.js";

/** Execution implementation revision, independent from the surrounding CLI release. */
export function builtinAgentEndpointImplementation(adapterId: string): ImplementationRef {
  if (adapterId !== "codex" && adapterId !== "claude") {
    throw new Error(`No managed Endpoint implementation for adapter: ${adapterId}.`);
  }
  return Object.freeze({ id: `yui.agent-endpoint.${adapterId}`, generation: "1" });
}

export function validateAgentEndpointImplementation(ref: ImplementationRef): ImplementationRef {
  if (ref === null || typeof ref !== "object"
    || typeof ref.id !== "string" || !ref.id.trim() || ref.id.includes("\0")
    || typeof ref.generation !== "string" || !ref.generation.trim() || ref.generation.includes("\0")) {
    throw new Error("Session Endpoint implementation identity is invalid.");
  }
  return ref;
}

/** Missing old code is an explicit inability to resume, never a Provider fallback. */
export function requireBuiltinAgentEndpointImplementation(
  adapterId: string,
  ref: ImplementationRef
): ImplementationRef {
  validateAgentEndpointImplementation(ref);
  const current = builtinAgentEndpointImplementation(adapterId);
  if (ref.id !== current.id || ref.generation !== current.generation) {
    throw new Error(`Session Endpoint ${ref.id}@${ref.generation} is unavailable; explicitly select a new Session.`);
  }
  return ref;
}
