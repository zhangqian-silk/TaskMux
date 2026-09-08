import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { ImplementationRef } from "../kernel/instanceHost.js";

/**
 * The modules whose bytes decide how a managed Endpoint actually behaves. A
 * generation names this exact code, so replacing these files in place cannot
 * keep claiming the previous generation's content is unchanged.
 *
 * Adapter selection, transport codecs and the driver live here. Deliberately
 * excluded: the surrounding CLI, storage and the Controller, which upgrade on
 * their own axes and must not rotate every live Session's Endpoint identity.
 */
const ENDPOINT_IMPLEMENTATION_MODULES = Object.freeze([
  "agentEndpoint.js",
  "agentEndpointIdentity.js",
  "structuredProviderHost.js",
  "codexAppServerRuntime.js"
]);

/** Digest of the running Endpoint code. Computed once per process: these files
 * are already loaded, so re-reading them later would report a build that this
 * process is not executing. */
let endpointCodeDigest: string | undefined;

function agentEndpointCodeDigest(): string {
  if (endpointCodeDigest !== undefined) return endpointCodeDigest;
  const hash = createHash("sha256");
  for (const module of ENDPOINT_IMPLEMENTATION_MODULES) {
    // A module that cannot be read is a broken installation, not a reason to
    // fall back to an identity that would silently match a different build.
    const bytes = readFileSync(new URL(module, import.meta.url));
    hash.update(module).update("\0").update(bytes).update("\0");
  }
  endpointCodeDigest = hash.digest("hex").slice(0, 32);
  return endpointCodeDigest;
}

/** Execution implementation revision, independent from the surrounding CLI release. */
export function builtinAgentEndpointImplementation(adapterId: string): ImplementationRef {
  if (adapterId !== "codex" && adapterId !== "claude") {
    throw new Error(`No managed Endpoint implementation for adapter: ${adapterId}.`);
  }
  return Object.freeze({
    id: `yui.agent-endpoint.${adapterId}`,
    generation: agentEndpointCodeDigest()
  });
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
