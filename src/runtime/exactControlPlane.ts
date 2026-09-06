import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { callController as defaultCallController } from "../core/controllerClient.js";
import type { JsonValue } from "../core/protocol.js";
import {
  inspectStorageSchema,
  type StorageSchemaState
} from "../storage/storageSchema.js";
import {
  yuiVersionIdentity,
  type YuiVersionIdentity
} from "../version.js";

/**
 * Provenance for one Session launch: which installation created it, at which
 * Home, under which version identity. It is recorded as immutable audit
 * material and is never a gate. Whether a command may run is proven against
 * the current CLI, Home, and Controller, and who may act is proven by the
 * Session Manifest plus the Session's caller key.
 */
export type ExactControlPlaneDescriptor = Readonly<{
  schemaVersion: 1;
  kind: "yui-control-plane";
  executable: string;
  cliEntry: string;
  yuiHome: string;
  identity: YuiVersionIdentity;
  /**
   * Issue 02: the release build ID this control plane runs. Present when the
   * Controller runs from an installed release; absent for a dev checkout.
   * When present, the preflight gates on the Home's active release pointer.
   */
  buildId?: string;
  /** Package SHA-256 of the active release, when known. */
  activeReleaseDigest?: string;
}>;

export type ExactControlPlanePreflightOptions = Readonly<{
  identity?: YuiVersionIdentity;
  inspectStorage?: (home: string) => StorageSchemaState | Readonly<{
    status: string;
    currentVersion?: number;
    direction?: "older" | "newer";
  }>;
  callController?: (
    home: string,
    method: string,
    params: JsonValue
  ) => Promise<JsonValue>;
  checkController?: boolean;
}>;

export type CompatibleControlPlanePreflightInput = Readonly<{
  actualHome: string;
}>;

export function createExactControlPlaneDescriptor(input: Readonly<{
  executable: string;
  cliEntry: string;
  yuiHome: string;
  identity?: YuiVersionIdentity;
  buildId?: string;
  activeReleaseDigest?: string;
}>): ExactControlPlaneDescriptor {
  const identity = validateVersionIdentity(input.identity ?? yuiVersionIdentity());
  return Object.freeze({
    schemaVersion: 1,
    kind: "yui-control-plane",
    executable: canonicalPath(input.executable),
    cliEntry: canonicalPath(input.cliEntry),
    yuiHome: canonicalPath(input.yuiHome),
    identity: Object.freeze({ ...identity }),
    ...(input.buildId === undefined ? {} : { buildId: input.buildId }),
    ...(input.activeReleaseDigest === undefined
      ? {}
      : { activeReleaseDigest: input.activeReleaseDigest })
  });
}

export function serializeExactDescriptor(
  descriptor: ExactControlPlaneDescriptor
): string {
  return JSON.stringify(descriptor);
}

export function parseExactControlPlaneDescriptor(value: string): ExactControlPlaneDescriptor {
  const record = parseDescriptorRecord(value);
  assertDescriptorKind(record, "yui-control-plane");
  if (record.schemaVersion !== 1) {
    throw new Error("Exact control-plane descriptor schema version is invalid.");
  }
  return createExactControlPlaneDescriptor({
    executable: requireText(record.executable, "Control-plane executable"),
    cliEntry: requireText(record.cliEntry, "Control-plane CLI entry"),
    yuiHome: requireText(record.yuiHome, "Control-plane YUI_HOME"),
    identity: validateVersionIdentity(record.identity),
    ...(typeof record.buildId !== "string" ? {} : { buildId: record.buildId }),
    ...(typeof record.activeReleaseDigest !== "string"
      ? {}
      : { activeReleaseDigest: record.activeReleaseDigest })
  });
}

export function exactControlPlaneDigest(descriptor: ExactControlPlaneDescriptor): string {
  return createHash("sha256").update(serializeExactDescriptor(descriptor)).digest("hex");
}

/**
 * Compatibility gate for an ordinary `yui` invocation inside a managed
 * Session. The Session Manifest and durable runtime state authenticate the
 * actor separately; this gate proves that the current CLI can safely share the
 * Home with its storage and Controller without pinning package/build identity.
 */
export async function assertCompatibleControlPlanePreflight(
  input: CompatibleControlPlanePreflightInput,
  options: ExactControlPlanePreflightOptions = {}
): Promise<YuiVersionIdentity> {
  const home = canonicalPath(input.actualHome);
  const identity = validateVersionIdentity(options.identity ?? yuiVersionIdentity());
  const storage = (options.inspectStorage ?? inspectStorageSchema)(home);
  if (storage.status !== "current") {
    throw new Error(`Managed control-plane storage is not current: ${storage.status}.`);
  }
  if (storage.currentVersion !== identity.storageVersion) {
    throw new Error(
      "Managed control-plane storage version is incompatible "
        + `(expected ${identity.storageVersion}, found `
        + `${storage.currentVersion ?? "unknown"}).`
    );
  }
  if (options.checkController !== false) {
    const call = options.callController ?? defaultCallController;
    try {
      const status = await call(home, "controller.status", {});
      assertControllerContinuityIdentity(status, identity);
    } catch (error) {
      if (!isDefinitelyNotRunning(error)) throw error;
    }
  }
  return identity;
}

export function assertControllerStatusIdentity(
  status: JsonValue,
  expected: YuiVersionIdentity = yuiVersionIdentity()
): void {
  if (!isRecord(status) || status.running !== true) {
    throw new Error("Controller status does not describe a running Controller.");
  }
  assertControllerField(
    status.protocolVersion,
    expected.controllerProtocolVersion,
    "protocol"
  );
  assertControllerField(status.version, expected.version, "version");
  assertControllerField(
    status.storageVersion,
    expected.storageVersion,
    "storage version"
  );
  assertControllerField(
    status.minimumStorageVersion,
    expected.minimumStorageVersion,
    "minimum storage migration version"
  );
}

function validateVersionIdentity(value: unknown): YuiVersionIdentity {
  if (!isRecord(value)) throw new Error("Yui version identity is invalid.");
  const version = requireText(value.version, "Yui version");
  const controllerProtocolVersion = requireVersion(
    value.controllerProtocolVersion,
    "Controller protocol version"
  );
  const storageVersion = requireVersion(
    value.storageVersion,
    "Storage version"
  );
  const minimumStorageVersion = requireVersion(
    value.minimumStorageVersion,
    "Minimum storage migration version"
  );
  if (minimumStorageVersion > storageVersion) {
    throw new Error(
      "Minimum storage migration version cannot exceed the current storage version."
    );
  }
  return {
    version,
    controllerProtocolVersion,
    storageVersion,
    minimumStorageVersion
  };
}

function assertControllerContinuityIdentity(
  status: JsonValue,
  expected: YuiVersionIdentity
): void {
  if (!isRecord(status) || status.running !== true) {
    throw new Error("Controller status does not describe a running Controller.");
  }
  if (typeof status.version !== "string" || status.version.trim().length === 0) {
    throw new Error("Controller version is invalid at the managed continuity gate.");
  }
  assertControllerField(
    status.protocolVersion,
    expected.controllerProtocolVersion,
    "protocol"
  );
  assertControllerField(
    status.storageVersion,
    expected.storageVersion,
    "storage version"
  );
}

function assertControllerField(
  actual: unknown,
  expected: string | number,
  label: string
): void {
  if (actual !== expected) {
    throw new Error(
      `Controller ${label} is incompatible with the exact control plane `
        + `(expected ${expected}, found ${typeof actual === "string" || typeof actual === "number" ? actual : "unknown"}). `
        + "Run controller restart through the matching exact control-plane invocation "
        + "before writing new Task records."
    );
  }
}

function parseDescriptorRecord(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requireText(value, "Exact descriptor"));
  } catch (error) {
    throw new Error("Exact descriptor is not valid JSON.", { cause: error });
  }
  if (!isRecord(parsed)) throw new Error("Exact descriptor must be an object.");
  return parsed;
}

function assertDescriptorKind(
  value: Record<string, unknown>,
  expected: ExactControlPlaneDescriptor["kind"]
): void {
  if (value.kind !== expected) {
    throw new Error(
      `Exact descriptor kind is invalid: expected ${expected}, found `
        + `${typeof value.kind === "string" ? value.kind : "unknown"}.`
    );
  }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireDigest(value: unknown): string {
  const digest = requireText(value, "Control-plane digest");
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error("Control-plane digest is invalid.");
  }
  return digest;
}

function requireVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function canonicalPath(value: string): string {
  const absolute = resolve(requireText(value, "Path"));
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefinitelyNotRunning(error: unknown): boolean {
  return isRecord(error) && error.code === "CONTROLLER_NOT_RUNNING";
}
