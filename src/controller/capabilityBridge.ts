import type { JsonValue } from "../core/protocol.js";
import type { DurableJobCaller } from "./jobControl.js";
import type { createBuiltinCapabilities } from "../kernel/builtinCapabilities.js";
import type { CapabilityCall } from "../kernel/capabilityRegistry.js";
import { capabilitySchemaError } from "../kernel/capabilitySchema.js";

/** The same transport method is usable by CLI, Agent and an authenticated
 * Surface adapter. Credentials are an ingress envelope, never capability input. */
export function createCapabilityDispatcher(capabilities: ReturnType<typeof createBuiltinCapabilities>) {
  return async (method: string, value: JsonValue): Promise<JsonValue> => {
    const error = capabilitySchemaError({
      type: "object", required: ["taskId", "caller"],
      additionalProperties: false,
      properties: {
        taskId: { type: "string", minLength: 1 },
        caller: {
          type: "object", required: ["scope"], additionalProperties: false,
          properties: {
            scope: { enum: ["user", "global", "task"] }, taskId: { type: "string" },
            role: { type: "string" }, agentId: { type: "string" }, adapterId: { type: "string" },
            runtimeGenerationId: { type: "string" }, nativeSessionId: { type: "string" },
            turnId: { type: "string" }, callerKey: { type: "string" }
          }
        },
        query: { type: "string" },
        request: {
          type: "object", required: ["name"], additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1 }, input: {},
            contractVersion: { type: "string", minLength: 1 },
            providerId: { type: "string", minLength: 1 },
            requestId: { type: "string", minLength: 1 }
          }
        }
      }
    }, value);
    if (error) throw new Error(`Invalid capability envelope: ${error}`);
    const params = value as unknown as {
      taskId: string; caller: DurableJobCaller; query?: string; request?: CapabilityCall;
    };
    const context = capabilities.authenticate(params.caller, params.taskId);
    let result: unknown;
    if (method === "capability.search") {
      if (params.request !== undefined) throw new Error("search accepts query, not request.");
      result = { capabilities: capabilities.registry.search(context, params.query) };
    } else {
      if (params.query !== undefined || params.request === undefined) throw new Error("describe/call requires request.");
      if (method === "capability.describe") result = capabilities.registry.describe(context, params.request);
      else if (method === "capability.call") {
        if (!Object.hasOwn(params.request, "input")) throw new Error("call requires input.");
        // Target is bound before acquisition, not inferred from plugin actor data.
        const input = params.request.input;
        if (typeof input === "object" && input !== null && "taskId" in input
          && input.taskId !== params.taskId) throw new Error("Capability target is outside the authenticated Task.");
        result = await capabilities.registry.call(context, params.request);
      } else throw new Error("Unknown capability method.");
    }
    return JSON.parse(JSON.stringify(result)) as JsonValue;
  };
}
