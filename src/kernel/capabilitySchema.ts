import { isDeepStrictEqual } from "node:util";

/** Deliberately bounded JSON Schema dialect. Reject unsupported keywords at
 * registration rather than publishing a contract we do not enforce. */
export type CapabilitySchema = Readonly<{
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Readonly<Record<string, CapabilitySchema>>;
  required?: readonly string[];
  additionalProperties?: boolean | CapabilitySchema;
  items?: CapabilitySchema;
  enum?: readonly unknown[];
  const?: unknown;
  anyOf?: readonly CapabilitySchema[];
  minLength?: number;
  minItems?: number;
}>;

export function checkCapabilitySchema(schema: CapabilitySchema): void {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error("Capability schema must be an object.");
  }
  const keywords = new Set([
    "type", "properties", "required", "additionalProperties", "items",
    "enum", "const", "anyOf", "minLength", "minItems"
  ]);
  for (const key of Object.keys(schema)) {
    if (!keywords.has(key)) throw new Error(`Unsupported schema keyword: ${key}.`);
  }
  if (schema.type !== undefined
    && !["object", "array", "string", "number", "integer", "boolean", "null"].includes(schema.type)) {
    throw new Error("Unsupported schema type.");
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required)
    || schema.required.some((key) => typeof key !== "string"))) throw new Error("Invalid schema required.");
  for (const bound of [schema.minLength, schema.minItems]) {
    if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 0)) throw new Error("Invalid schema bound.");
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    throw new Error("Invalid schema enum.");
  }
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || !schema.anyOf.length) throw new Error("Invalid schema anyOf.");
    schema.anyOf.forEach(checkCapabilitySchema);
  }
  if (schema.properties !== undefined) {
    if (typeof schema.properties !== "object" || schema.properties === null || Array.isArray(schema.properties)) {
      throw new Error("Invalid schema properties.");
    }
    Object.values(schema.properties).forEach(checkCapabilitySchema);
  }
  if (schema.items !== undefined) checkCapabilitySchema(schema.items);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    checkCapabilitySchema(schema.additionalProperties);
  }
}

export function capabilitySchemaError(schema: CapabilitySchema, value: unknown, path = "$"): string | undefined {
  if ("const" in schema && !isDeepStrictEqual(value, schema.const)) return `${path}: unexpected value.`;
  if (schema.enum && !schema.enum.some((item) => isDeepStrictEqual(item, value))) return `${path}: not in enum.`;
  if (schema.anyOf && !schema.anyOf.some((branch) => capabilitySchemaError(branch, value) === undefined)) {
    return `${path}: no matching schema branch.`;
  }
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema.type !== undefined && (schema.type === "integer"
    ? typeof value !== "number" || !Number.isSafeInteger(value)
    : type !== schema.type)) return `${path}: expected ${schema.type}.`;
  if (typeof value === "number" && !Number.isFinite(value)) return `${path}: non-finite number.`;
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) {
    return `${path}: string too short.`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path}: array too short.`;
    if (schema.items) {
      for (const [index, item] of value.entries()) {
        const error = capabilitySchemaError(schema.items, item, `${path}[${index}]`);
        if (error) return error;
      }
    }
  } else if (type === "object") {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(record, key)) return `${path}.${key}: required.`;
    }
    for (const [key, item] of Object.entries(record)) {
      const property = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties![key] : undefined;
      if (!property && schema.additionalProperties === false) return `${path}.${key}: unexpected property.`;
      const child = property ?? (typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined);
      const error = child && capabilitySchemaError(child, item, `${path}.${key}`);
      if (error) return error;
    }
  }
  return undefined;
}
