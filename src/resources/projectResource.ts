import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { requireIdentity, requireText, requireTimestamp } from "../domain/validation.js";

/** Content belongs to the Home, never to an executable plugin or workspace. */
export type Artifact = Readonly<{
  schemaVersion: 1;
  id: string;
  taskId: string;
  displayName: string;
  mediaType: string;
  provenance: string;
  createdAt: string;
} & (
  | { kind: "content"; content: string; digest: string }
  | { kind: "external-version"; resourceId: string; version: string; verification: string }
  | { kind: "receipt"; jobId: string; receiptRef: string; content: string; digest: string }
  | { kind: "reference"; locator: string; observedAt: string }
)>;

export type ArtifactRef = Readonly<{ taskId: string; artifactId: string; kind: Exclude<Artifact["kind"], "reference">; digest?: string }>;

/** Concrete local directory identity. Git keeps its existing owner stores. */
export type LocalResource = Readonly<{
  schemaVersion: 1;
  id: string;
  kind: "local-directory";
  displayName: string;
  path: string;
  device: string;
  inode: string;
  ownership: "user";
  createdAt: string;
}>;

export type EnvironmentPreparation = Readonly<{
  schemaVersion: 1;
  id: string;
  taskId: string;
  disposition: "prepared" | "adopted" | "released";
  intentDigest: string;
  resourceRefs: readonly string[];
  access: "read" | "write";
  /** A directory grant is not a process, filesystem or network sandbox. */
  isolation: "none" | "trusted-local";
  environmentRef?: string;
  directory?: Readonly<{ path: string; device: string; inode: string; ownership: "preparation" | "user" }>;
  createdAt: string;
  updatedAt: string;
  releaseEvidence?: string;
}>;

/** Immutable physical environment selected for one native Session. */
export type ExecutionEnvironmentSnapshot = Readonly<{
  taskId: string;
  preparationId: string;
  environmentRef: string;
  access: "read" | "write";
  isolation: "trusted-local";
  directory: Readonly<{ path: string; device: string; inode: string; ownership: "preparation" | "user" }>;
}>;

export function validateExecutionEnvironmentSnapshot(value: ExecutionEnvironmentSnapshot): ExecutionEnvironmentSnapshot {
  if (!value || typeof value !== "object") throw new Error("Execution environment must be an object.");
  requireIdentity(value.taskId, "Execution environment Task");
  requireIdentity(value.preparationId, "Execution environment preparation");
  if (value.environmentRef !== `${value.taskId}/${value.preparationId}`) {
    throw new Error("Execution environment reference does not match its preparation.");
  }
  if (!["read", "write"].includes(value.access) || value.isolation !== "trusted-local" || !value.directory) {
    throw new Error("Execution environment requires a trusted-local directory and explicit access.");
  }
  requireText(value.directory.path, "Execution environment path");
  if (!isAbsolute(value.directory.path) || resolve(value.directory.path) !== value.directory.path) {
    throw new Error("Execution environment path must be absolute and normalized.");
  }
  requireText(value.directory.device, "Execution environment device");
  requireText(value.directory.inode, "Execution environment inode");
  if (!["preparation", "user"].includes(value.directory.ownership)) throw new Error("Invalid execution directory owner.");
  return value;
}

export function contentDigest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function validateArtifact(artifact: Artifact): Artifact {
  if (artifact.schemaVersion !== 1) throw new Error("Artifact schemaVersion must be 1.");
  requireIdentity(artifact.id, "Artifact id");
  requireIdentity(artifact.taskId, "Artifact Task");
  requireText(artifact.displayName, "Artifact name");
  requireText(artifact.mediaType, "Artifact media type");
  requireText(artifact.provenance, "Artifact provenance");
  requireTimestamp(artifact.createdAt, "Artifact timestamp");
  if (artifact.kind === "content" || artifact.kind === "receipt") {
    if (typeof artifact.content !== "string" || Buffer.byteLength(artifact.content) > 8 * 1024 * 1024) {
      throw new Error("Artifact content must be UTF-8 text of at most 8 MiB.");
    }
    if (artifact.digest !== contentDigest(artifact.content)) throw new Error("Artifact content digest mismatch.");
    if (artifact.kind === "receipt") {
      requireIdentity(artifact.jobId, "Artifact Job");
      requireText(artifact.receiptRef, "Artifact receipt");
    }
  } else if (artifact.kind === "external-version") {
    requireIdentity(artifact.resourceId, "Artifact resource");
    requireText(artifact.version, "Artifact external version");
    requireText(artifact.verification, "Artifact version verification");
  } else if (artifact.kind === "reference") {
    requireText(artifact.locator, "Reference locator");
    requireTimestamp(artifact.observedAt, "Reference observation");
  } else throw new Error("Unknown Artifact kind.");
  return artifact;
}

export function stableArtifactRef(artifact: Artifact): ArtifactRef {
  validateArtifact(artifact);
  if (artifact.kind === "reference") throw new Error("Reference material is not a fixed result.");
  return { taskId: artifact.taskId, artifactId: artifact.id, kind: artifact.kind,
    ...("digest" in artifact ? { digest: artifact.digest } : {}) };
}

/** Listings expose locators and provenance without replaying every body. */
export function artifactSummary(artifact: Artifact) {
  if ("content" in artifact) {
    const { content, ...summary } = artifact;
    return { ...summary, contentBytes: Buffer.byteLength(content, "utf8") };
  }
  return artifact;
}

export function validateLocalResource(resource: LocalResource): LocalResource {
  if (resource.schemaVersion !== 1 || resource.kind !== "local-directory" || resource.ownership !== "user") {
    throw new Error("Invalid local Resource record.");
  }
  requireIdentity(resource.id, "Resource id");
  requireText(resource.displayName, "Resource name");
  requireText(resource.path, "Resource path");
  requireText(resource.device, "Resource device");
  requireText(resource.inode, "Resource inode");
  requireTimestamp(resource.createdAt, "Resource timestamp");
  return resource;
}

export function validateEnvironmentPreparation(record: EnvironmentPreparation): EnvironmentPreparation {
  if (record.schemaVersion !== 1 || !["prepared", "adopted", "released"].includes(record.disposition)) {
    throw new Error("Invalid Environment preparation.");
  }
  requireIdentity(record.id, "Preparation id");
  requireIdentity(record.taskId, "Preparation Task");
  requireText(record.intentDigest, "Preparation intent");
  if (!Array.isArray(record.resourceRefs) || new Set(record.resourceRefs).size !== record.resourceRefs.length) {
    throw new Error("Preparation resources must be unique.");
  }
  record.resourceRefs.forEach((id) => requireIdentity(id, "Preparation resource"));
  if (!["read", "write"].includes(record.access)) throw new Error("Invalid preparation access.");
  if (!["none", "trusted-local"].includes(record.isolation)
    || (record.directory === undefined) !== (record.isolation === "none")) {
    throw new Error("Environment isolation must describe the actual local preparation.");
  }
  if ((record.directory === undefined) !== (record.environmentRef === undefined)) {
    throw new Error("Environment reference requires an actual directory.");
  }
  if (record.directory) {
    requireText(record.directory.path, "Environment path");
    requireText(record.directory.device, "Environment device");
    requireText(record.directory.inode, "Environment inode");
    if (!["preparation", "user"].includes(record.directory.ownership)) throw new Error("Invalid directory owner.");
  }
  requireTimestamp(record.createdAt, "Preparation timestamp");
  requireTimestamp(record.updatedAt, "Preparation update");
  if (record.releaseEvidence !== undefined) {
    if (record.disposition !== "released") throw new Error("Release evidence requires a released preparation.");
    requireText(record.releaseEvidence, "Release evidence");
  }
  return record;
}
