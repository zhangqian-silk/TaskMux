import { requireText, requireTimestamp } from "./validation.js";
import {
  formatRunReceiptId,
  formatInputRequestReceiptId,
  validateTaskRecordReference
} from "../task/taskRecordReference.js";

export type PromptSource = Readonly<{
  kind: "run" | "turn-input" | "input-request" | "notification";
  taskId: string;
  localId: string;
}>;

export type PromptEnvelope = Readonly<{
  id: string;
  source: PromptSource;
  text: string;
  createdAt: string;
}>;

export function createPromptEnvelope(input: Readonly<{
  id: string;
  source: PromptSource;
  text: string;
  createdAt: Date;
}>): PromptEnvelope {
  if (input.source.kind !== "run"
    && input.source.kind !== "turn-input"
    && input.source.kind !== "input-request" && input.source.kind !== "notification") {
    throw new Error("Prompt source kind is invalid.");
  }
  const source = validateTaskRecordReference({
    taskId: input.source.taskId,
    localId: input.source.localId
  }, input.source.kind === "input-request" ? "inputRequest"
    : input.source.kind === "notification" ? "taskWake" : "run");
  const id = requireQualifiedReceiptId(
    input.id,
    input.source.kind,
    source.taskId,
    source.localId
  );
  return {
    id,
    source: {
      kind: input.source.kind,
      taskId: source.taskId,
      localId: source.localId
    },
    text: requireText(input.text, "Prompt text"),
    createdAt: requireTimestamp(input.createdAt, "Prompt createdAt")
  };
}

function requireQualifiedReceiptId(
  value: string,
  kind: PromptSource["kind"],
  taskId: string,
  localId: string
): string {
  if (kind === "notification") {
    const prefix = `notification:${taskId}/${localId}/`;
    if (!value.startsWith(prefix) || !/^[a-zA-Z0-9-]+$/.test(value.slice(prefix.length))) {
      throw new Error("Notification attempt does not match its wake.");
    }
    return value;
  }
  const expected = kind === "run"
    ? formatRunReceiptId(taskId, localId)
    : kind === "input-request"
      ? formatInputRequestReceiptId(taskId, localId)
      : `turn-input:${taskId}/${localId}/`;
  if (kind === "turn-input") {
    if (!value.startsWith(expected)
      || !/^[1-9]\d*$/.test(value.slice(expected.length))) {
      throw new Error("Prompt envelope id does not match its source.");
    }
    return value;
  }
  if (kind === "run" && value.startsWith(`${expected}/attempt/`)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value.slice(`${expected}/attempt/`.length))) return value;
  if (value !== expected) throw new Error("Prompt envelope id does not match its source.");
  return expected;
}
