import type { TaskStore } from "../storage/taskStore.js";
import {
  readTaskContext, readTaskContextDelta, inspectTaskContext, withContextObservations,
  type ContextObservationProvider
} from "../context/taskContext.js";
import { BUILTIN_CAPABILITIES } from "../kernel/builtinCapabilities.js";
import { capabilitySchemaError } from "../kernel/capabilitySchema.js";
import { updateTaskMetadataCommand, sendTaskMessageCommand, type TaskCommandOptions } from "../commands/taskCommands.js";
import type { TaskMetadataUpdate } from "../task/task.js";

/** Installed only by the local-user Web composition root. HTTP authenticates
 * its token before using this port; input never supplies a caller or Role.
 * Managed capability RPC keeps its own Session authentication unchanged.
 */
export function createWebTaskSurface(
  store: TaskStore,
  options: TaskCommandOptions = {},
  observations: readonly ContextObservationProvider[] = []
) {
  const environment = {};
  return {
    message: (taskId: string, body: string) => {
      const { message, task } = sendTaskMessageCommand(store, taskId, body, "leader", { ...options, environment });
      return { record: message, revision: message.createdAt,
        disposition: task.status === "active" ? "queued" : "saved",
        target: { scope: "task", taskId, roleName: "leader" } };
    },
    read: async (taskId: string) => withContextObservations(
      readTaskContext(store, taskId, environment), observations
    ),
    delta: (taskId: string, input: { after: string; continuation?: string }) =>
      readTaskContextDelta(store, taskId, input, environment),
    inspect: (taskId: string, input: { store: string; refId: string; digest?: string }) =>
      inspectTaskContext(store, taskId, input, environment),
    update: (taskId: string, input: unknown) => {
      const descriptor = BUILTIN_CAPABILITIES.find((entry) => entry.name === "task.update")!;
      const error = capabilitySchemaError(descriptor.inputSchema, { taskId, patch: input });
      if (error) throw new Error(error);
      const patch = input as Pick<TaskMetadataUpdate, "title" | "description" | "priority" | "tags">;
      const record = updateTaskMetadataCommand(store, taskId, {
        ...patch,
        ...(patch.description === "" ? { description: null } : {}),
        ...(patch.tags?.length === 0 ? { tags: null } : {})
      }, { ...options, environment });
      return { record, revision: record.updatedAt };
    }
  };
}

export type WebTaskSurface = ReturnType<typeof createWebTaskSurface>;
