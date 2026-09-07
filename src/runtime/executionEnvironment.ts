import { isDeepStrictEqual } from "node:util";
import type { TaskStore } from "../storage/taskStore.js";
import { openCurrentTaskStore } from "../storage/currentTaskStore.js";
import { createProjectResources } from "../resources/projectResourceService.js";
import type { ExecutionEnvironmentSnapshot } from "../resources/projectResource.js";
import type { AgentHostLaunchPayload } from "./launchBroker.js";

/** Revalidate the adopted owner; a saved path alone never authorizes execution. */
export function assertExecutionEnvironmentCurrent(
  store: TaskStore,
  taskId: string,
  snapshot: ExecutionEnvironmentSnapshot
): void {
  if (snapshot.taskId !== taskId) throw new Error("Execution environment belongs to another Task.");
  const current = createProjectResources(store).resolveExecutionEnvironment(taskId, snapshot.preparationId);
  if (!isDeepStrictEqual(current, snapshot)) {
    throw new Error("Execution environment changed; select an adopted environment and start a new Session.");
  }
}

/** Last local check before native process creation or another Provider input. */
export function assertAgentExecutionEnvironment(
  home: string,
  payload: AgentHostLaunchPayload
): void {
  const snapshot = payload.executionEnvironment;
  if (snapshot === undefined) return;
  if (payload.environment.YUI_SESSION_SCOPE !== "task"
    || payload.environment.YUI_TASK_ID !== snapshot.taskId
    || payload.cwd !== snapshot.directory.path) {
    throw new Error("Agent launch does not match its adopted execution environment.");
  }
  const store = openCurrentTaskStore(home);
  try {
    assertExecutionEnvironmentCurrent(store, snapshot.taskId, snapshot);
  } finally {
    store.close();
  }
}
