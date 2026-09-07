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
            role: { type: "string" }, agentId: { type: "string" }, adapterId: { type: "string" }, nativeSessionId: { type: "string" },
            turnId: { type: "string" }
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
    if (error) throw invalidParams(`Invalid capability envelope: ${error}`);
    const params = value as unknown as {
      taskId: string; caller: DurableJobCaller; query?: string; request?: CapabilityCall;
    };
    const context = capabilities.authenticate(params.caller, params.taskId);
    let result: unknown;
    if (method === "capability.search") {
      if (params.request !== undefined) throw invalidParams("search accepts query, not request.");
      result = { capabilities: capabilities.registry.search(context, params.query) };
    } else {
      if (params.query !== undefined || params.request === undefined) throw invalidParams("describe/call requires request.");
      if (method === "capability.describe") result = capabilities.registry.describe(context, params.request);
      else if (method === "capability.call") {
        if (!Object.hasOwn(params.request, "input")) throw invalidParams("call requires input.");
        // Target is bound before acquisition, not inferred from plugin actor data.
        const input = params.request.input;
        if (typeof input === "object" && input !== null && "taskId" in input
          && input.taskId !== params.taskId) throw invalidParams("Capability target is outside the authenticated Task.");
        result = await capabilities.registry.call(context, params.request);
      } else throw invalidParams("Unknown capability method.");
    }
    return JSON.parse(JSON.stringify(result)) as JsonValue;
  };
}

/** Expected ingress rejections use the Controller's existing safe error shape. */
function invalidParams(message: string): Error {
  return Object.assign(new Error(message), { name: "CoreApplicationError", code: "INVALID_PARAMS" });
}
