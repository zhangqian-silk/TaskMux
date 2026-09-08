import type { CapabilityImplementation } from "../kernel/capabilityRegistry.js";
import { capabilitySchemaError, type CapabilitySchema } from "../kernel/capabilitySchema.js";
import type { PluginPackage } from "./pluginPackage.js";

/** Bounded data interpreter, not JavaScript evaluation or a workflow engine. */
export function interpretPlugin(pkg: PluginPackage): CapabilityImplementation {
  const handlers: unknown = JSON.parse(pkg.files[pkg.manifest.entry]);
  const text: CapabilitySchema = { type: "string", minLength: 1 };
  const handlerSchema: CapabilitySchema = {
      anyOf: [
        { type: "object", properties: { type: { const: "echo" } }, required: ["type"], additionalProperties: false },
        { type: "object", properties: { type: { const: "constant" }, value: {} }, required: ["type", "value"], additionalProperties: false },
        { type: "object", properties: { type: { const: "call" }, name: text, contractVersion: text, providerId: text },
          required: ["type", "name", "contractVersion"], additionalProperties: false }
      ]
  };
  const error = capabilitySchemaError({
    type: "object", required: pkg.manifest.capabilities.map((capability) => capability.name),
    properties: Object.fromEntries(pkg.manifest.capabilities.map((capability) => [capability.name, handlerSchema])),
    additionalProperties: false
  }, handlers);
  if (error) throw new Error(`Declarative entry: ${error}`);
  const entries = handlers as Record<string, { type: string; value?: unknown; name: string; contractVersion: string; providerId?: string }>;
  for (const handler of Object.values(entries)) {
    if (handler.type === "call" && !pkg.manifest.required.some((dependency) =>
      dependency.name === handler.name && dependency.contractVersion === handler.contractVersion)) {
      throw new Error("Declarative call must name a required dependency.");
    }
  }
  return {
    async invoke(name, input, invocation) {
      const handler = entries[name];
      if (handler.type === "echo") return input;
      if (handler.type === "constant") return structuredClone(handler.value);
      const result = await invocation.call({
        name: handler.name, input, contractVersion: handler.contractVersion,
        providerId: handler.providerId, requestId: invocation.requestId
      });
      if (!["value", "operation"].includes(result.kind)) throw new Error(result.detail ?? result.kind);
      return result.value;
    }
  };
}
