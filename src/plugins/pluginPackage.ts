import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, posix } from "node:path";
import { capabilitySchemaError, checkCapabilitySchema, type CapabilitySchema } from "../kernel/capabilitySchema.js";
import type { CapabilityDescriptor } from "../kernel/capabilityRegistry.js";

export type PluginCapability = Omit<CapabilityDescriptor, "provider" | "source" | "scope" | "required" | "unavailable">;
export type PluginManifest = Readonly<{
  id: string; version: string; apiVersion: "1"; entry: string;
  kind: "declarative" | "trusted-local";
  capabilities: readonly PluginCapability[];
  required: readonly Readonly<{ name: string; contractVersion: string }>[];
  permissions: readonly string[];
  reloadMode: "manual";
  build?: readonly string[];
}>;
export type PluginPackage = Readonly<{
  manifest: PluginManifest; files: Readonly<Record<string, string>>; digest: string;
}>;
export type PluginValidation = Readonly<{
  schemaVersion: 1;
  id: string; taskId: string; directory: string; preparationId: string;
  sourceDigest: string; package: PluginPackage;
  environment: Readonly<{ path: string; device: string; inode: string; isolation: "trusted-local"; node: string }>;
  checks: readonly string[]; createdAt: string;
}>;

const text: CapabilitySchema = { type: "string", minLength: 1 };
const texts: CapabilitySchema = { type: "array", items: text };
const object = (properties: Record<string, CapabilitySchema>, required = Object.keys(properties)): CapabilitySchema =>
  ({ type: "object", properties, required, additionalProperties: false });
const manifestSchema = object({
  id: text, version: text, apiVersion: { const: "1" }, entry: text,
  kind: { enum: ["declarative", "trusted-local"] }, reloadMode: { const: "manual" },
  permissions: texts,
  required: { type: "array", items: object({ name: text, contractVersion: text }) },
  capabilities: { type: "array", minItems: 1, items: object({
    name: text, contractVersion: text, summary: text,
    inputSchema: { type: "object" }, outputSchema: { type: "object" },
    effect: { enum: ["query", "local-mutation", "external-operation"] }, requiredPermissions: texts
  }) },
  build: { type: "array", minItems: 1, items: text }
}, ["id", "version", "apiVersion", "entry", "kind", "reloadMode", "permissions", "required", "capabilities"]);

export function parsePluginManifest(value: unknown): PluginManifest {
  const error = capabilitySchemaError(manifestSchema, value);
  if (error) throw new Error(`Plugin manifest: ${error}`);
  const manifest = value as PluginManifest;
  if (!/^[a-z][a-z0-9-]*$/u.test(manifest.id)) throw new Error("Plugin id must be a lowercase unqualified name.");
  packagePath(manifest.entry);
  if (manifest.kind === "declarative" && manifest.build !== undefined) throw new Error("Declarative packages do not execute builds.");
  if (new Set(manifest.permissions).size !== manifest.permissions.length) throw new Error("Duplicate plugin permissions.");
  if (manifest.permissions.includes("plugin:manage")) throw new Error("Task-local plugins cannot manage their own Host or other plugins.");
  for (const capability of manifest.capabilities) {
    checkCapabilitySchema(capability.inputSchema);
    checkCapabilitySchema(capability.outputSchema);
    if (capability.requiredPermissions.some((permission) => !manifest.permissions.includes(permission))) {
      throw new Error("Capability permission exceeds the manifest permission set.");
    }
  }
  return manifest;
}

export function packagePath(value: string): string {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")
    || value.split("/").some((part) => !part || part === "." || part === "..")
    || posix.normalize(value) !== value) throw new Error("Package paths must be normalized relative paths.");
  return value;
}

/** Data-only scan. Symlinks, special files and non-UTF8 dependencies are not a
 * supported package. Capture every byte, including build inputs and dependencies. */
export function readPluginPackage(directory: string, requireEntry = true): PluginPackage {
  if (realpathSync(directory) !== directory) throw new Error("Plugin directory must be canonical.");
  const files: Record<string, string> = Object.create(null);
  let bytes = 0;
  const walk = (prefix: string) => {
    for (const name of readdirSync(join(directory, prefix)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      packagePath(path);
      const stat = lstatSync(join(directory, path));
      if (stat.isDirectory()) walk(path);
      else {
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Plugin package contains a non-regular file.");
        bytes += stat.size;
        if (bytes > 4 * 1024 * 1024 || Object.keys(files).length >= 256) throw new Error("Plugin package exceeds 4 MiB/256 files.");
        const buffer = readFileSync(join(directory, path));
        const content = buffer.toString("utf8");
        if (!Buffer.from(content).equals(buffer)) throw new Error("Plugin package files must be UTF-8.");
        files[path] = content;
      }
    }
  };
  walk("");
  const manifest = parsePluginManifest(JSON.parse(files["plugin.json"] ?? "null"));
  if (requireEntry && !Object.hasOwn(files, manifest.entry)) throw new Error("Plugin entry is missing.");
  return { manifest, files, digest: packageDigest(files) };
}

export function packageDigest(files: Readonly<Record<string, string>>): string {
  return createHash("sha256").update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}

export function validatePluginValidation(record: PluginValidation): PluginValidation {
  if (record.schemaVersion !== 1 || !record.id?.startsWith("validation-") || !record.taskId || !record.directory || !record.preparationId
    || !record.environment?.path || record.environment.isolation !== "trusted-local"
    || !record.environment.node || !record.environment.device || !record.environment.inode
    || !/^[0-9a-f]{64}$/u.test(record.sourceDigest) || !Number.isFinite(Date.parse(record.createdAt))
    || !Array.isArray(record.checks) || !record.checks.every((value) => typeof value === "string")) {
    throw new Error("Invalid plugin validation record.");
  }
  const manifest = parsePluginManifest(JSON.parse(record.package.files["plugin.json"]));
  if (JSON.stringify(manifest) !== JSON.stringify(record.package.manifest)
    || packageDigest(record.package.files) !== record.package.digest
    || !Object.hasOwn(record.package.files, manifest.entry)) throw new Error("Plugin validation content mismatch.");
  return record;
}
