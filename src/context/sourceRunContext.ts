import {
  type AgentRun
} from "../agentRun/agentRun.js";
import { MAX_RUN_RESULT_OUTPUT_BYTES } from "../domain/agentResultTransport.js";

export const MAX_SYNTHESIS_SOURCE_RUNS = 8;
export const MAX_CONTEXT_SOURCE_RUNS = MAX_SYNTHESIS_SOURCE_RUNS + 1;
export const MAX_CONTEXT_SOURCE_RUN_BYTES =
  MAX_CONTEXT_SOURCE_RUNS * (MAX_RUN_RESULT_OUTPUT_BYTES + 16 * 1024);

/**
 * Frozen input for synthesis. The main Agent needs the producer identity and
 * exact result, not another copy of its prompt history, launch configuration,
 * or workspace descriptor.
 */
export function sourceRunContextValue(
  run: Readonly<Pick<
    AgentRun,
    "id" | "taskId" | "roleName" | "purpose" | "workItemId" | "reviewRoundId"
      | "executionGroupId" | "executionLaneId" | "result" | "createdAt" | "updatedAt"
  >>
): Readonly<Record<string, unknown>> {
  if (run.result === undefined) {
    throw new Error(`Source AgentRun has no result: ${run.id}.`);
  }
  return Object.freeze({
    schemaVersion: 1,
    id: run.id,
    taskId: run.taskId,
    roleName: run.roleName,
    purpose: run.purpose,
    ...(run.workItemId === undefined ? {} : { workItemId: run.workItemId }),
    ...(run.reviewRoundId === undefined ? {} : { reviewRoundId: run.reviewRoundId }),
    ...(run.executionGroupId === undefined
      ? {}
      : { executionGroupId: run.executionGroupId }),
    ...(run.executionLaneId === undefined ? {} : { executionLaneId: run.executionLaneId }),
    result: run.result,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  });
}
