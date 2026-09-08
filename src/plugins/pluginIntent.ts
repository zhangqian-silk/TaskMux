import { requireIdentity, requireText, requireTimestamp } from "../domain/validation.js";

/** Durable user selection, never a claim that an implementation is running.
 * A revision identifies one explicit choice, including repeated A -> A choices,
 * so a late attempt cannot publish or annotate a newer choice. */
export type PluginIntent = Readonly<{
  schemaVersion: 1;
  taskId: string;
  pluginId: string;
  revision: number;
  enabled: boolean;
  validationId?: string;
  updatedAt: string;
  lastFailure?: PluginIntentFailure;
}>;

export type PluginIntentFailure = Readonly<{ message: string; occurredAt: string }>;

export function validatePluginId(id: string): string {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/u.test(id)) throw new Error("Invalid plugin id.");
  return id;
}

export function validatePluginIntentFailure(failure: PluginIntentFailure): PluginIntentFailure {
  requireText(failure.message, "Plugin failure");
  requireTimestamp(failure.occurredAt, "Plugin failure time");
  return failure;
}

export function validatePluginIntent(intent: PluginIntent): PluginIntent {
  if (intent.schemaVersion !== 1 || typeof intent.enabled !== "boolean"
    || !Number.isSafeInteger(intent.revision) || intent.revision < 1) throw new Error("Invalid plugin intent.");
  requireIdentity(intent.taskId, "Plugin intent Task");
  validatePluginId(intent.pluginId);
  requireTimestamp(intent.updatedAt, "Plugin intent time");
  if (intent.validationId !== undefined) requireIdentity(intent.validationId, "Plugin validation reference");
  if (intent.enabled && intent.validationId === undefined) throw new Error("Enabled intent requires a fixed validation reference.");
  if (intent.lastFailure !== undefined) validatePluginIntentFailure(intent.lastFailure);
  return intent;
}
