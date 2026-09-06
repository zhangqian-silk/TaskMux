import { requireIdentity } from "../domain/validation.js";
import type { ReviewConfig } from "./reviewConfig.js";

export const TASK_FINAL_REVIEW_ARGUMENT = "--yui-task-final-review";

/**
 * Immutable capability established by the Task Leader's managed Session. It is
 * persisted with the first Candidate so later changes to the shared review
 * config cannot weaken the Task's completion gate. Its identity is exactly what
 * it promises — this Task's final review belongs to this Reviewer Role — and
 * never the runtime that happened to establish it.
 *
 * It carries no record version tag: its required fields are its whole shape, so
 * validating them is the same question a tag would ask. A tag earns its place
 * only where a Home migration rewrites that record family and marks it.
 */
export type TaskFinalReviewContract = Readonly<{
  taskId: string;
  reviewerRoleName: string;
}>;

export type TaskFinalReviewRequest = Readonly<{
  taskId: string;
  reviewerRoleName: string;
}>;

export function createTaskFinalReviewContract(input: Readonly<{
  taskId: string;
  reviewerRoleName: string;
}>): TaskFinalReviewContract {
  const taskId = requireIdentity(input.taskId, "Task final-review contract Task id");
  const reviewerRoleName = requireIdentity(
    input.reviewerRoleName,
    "Task final-review contract Reviewer Role"
  );
  return Object.freeze({
    taskId,
    reviewerRoleName
  });
}

export function validateTaskFinalReviewContract(
  value: TaskFinalReviewContract
): TaskFinalReviewContract {
  if (typeof value !== "object" || value === null) {
    throw new Error("Task final-review contract must be a record.");
  }
  // A contract recorded by an earlier release also carried a version tag and the
  // runtime that established it. Those fields are historical evidence and are
  // never read again; the required fields below are the whole contract.
  createTaskFinalReviewContract(value);
  return value;
}

export function taskFinalReviewConfig(
  contract: TaskFinalReviewContract
): ReviewConfig {
  const validated = validateTaskFinalReviewContract(contract);
  return { roleName: validated.reviewerRoleName, trigger: "final" };
}

export function sameTaskFinalReviewContract(
  left: TaskFinalReviewContract | undefined,
  right: TaskFinalReviewContract | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const first = validateTaskFinalReviewContract(left);
  const second = validateTaskFinalReviewContract(right);
  return first.taskId === second.taskId
    && first.reviewerRoleName === second.reviewerRoleName;
}

/**
 * The contract switch is an exact CLI prefix, never an environment variable.
 * It must be the first CLI argument so the preflight can bind it to the
 * Leader's managed Session before opening mutable storage.
 */
export function extractTaskFinalReviewRequest(args: readonly string[]): Readonly<{
  request?: TaskFinalReviewRequest;
  args: readonly string[];
  error?: string;
}> {
  const index = args.indexOf(TASK_FINAL_REVIEW_ARGUMENT);
  if (index < 0) return { args: [...args] };
  if (index !== 0) {
    return {
      args: [...args],
      error: `${TASK_FINAL_REVIEW_ARGUMENT} must immediately follow the exact control prefix.`
    };
  }
  const taskId = args[1];
  const reviewerRoleName = args[2];
  if (taskId === undefined || reviewerRoleName === undefined) {
    return {
      args: args.slice(3),
      error: `${TASK_FINAL_REVIEW_ARGUMENT} requires <task-id> <reviewer-role>.`
    };
  }
  try {
    return {
      request: {
        taskId: requireIdentity(taskId, "Task final-review contract Task id"),
        reviewerRoleName: requireIdentity(
          reviewerRoleName,
          "Task final-review contract Reviewer Role"
        )
      },
      args: args.slice(3)
    };
  } catch (error) {
    return {
      args: args.slice(3),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
