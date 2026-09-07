import { createDurableJobControl, type DurableJobControlPort } from "../controller/jobControl.js";
import { JOB_RUNNER_IMPLEMENTATION, type DurableJob } from "../job/durableJob.js";
import type { JobSupervisorProcessPort } from "../controller/jobSupervisor.js";
import type { TaskStore } from "../storage/taskStore.js";
import { InstanceHost } from "./instanceHost.js";
import { createBuiltinCapabilities } from "./builtinCapabilities.js";
import type { ContextObservationProvider } from "../context/taskContext.js";

/** Called once by the existing Controller root. Does not open a Store, start
 * another Controller, or provide arbitrary persistence to plugin code.
 * T02 registers contributions on this Host and wraps this same Job control.
 */
export function createKernelPorts(
  store: TaskStore,
  runner: JobSupervisorProcessPort,
  signal: (taskId: string) => void = () => undefined,
  contextProviders: readonly ContextObservationProvider[] = []
) {
  const host = new InstanceHost();
  const runnerImplementation = host.attach(JOB_RUNNER_IMPLEMENTATION, runner);
  const runnerHandle = host.acquire<JobSupervisorProcessPort>(runnerImplementation);
  const jobImplementation = host.attach(
    { id: "yui:job-control", generation: "1" },
    createDurableJobControl(store)
  );
  // The Controller is a long-lived consumer of this exact implementation.
  const jobHandle = host.acquire<DurableJobControlPort>(jobImplementation);
  const capabilities = createBuiltinCapabilities(host, store, jobHandle.value, signal, contextProviders);
  return {
    host,
    capabilities,
    jobImplementation,
    runnerImplementation,
    runner: runnerHandle.value,
    jobs: jobHandle.value,
    close: async () => {
      const drain = host.close();
      await jobHandle.release();
      await runnerHandle.release();
      await drain;
    }
  };
}

/** A read model over the one Job, never separately persisted.
 * confirmed means the selected runner was observed, not that every action
 * performed by an arbitrary command succeeded. Inspect original step receipts.
 */
export function inspectJobOperation(job: DurableJob) {
  return {
    operationRef: { taskId: job.taskId, jobId: job.id },
    ...job.operation,
    state: job.status === "queued" ? "pending"
      : job.status === "running" ? "running"
      : job.status === "unknown-needs-attention" ? "unknown" : "finished",
    outcome: job.result?.outcome,
    result: job.result,
    checkpoint: job.checkpoint
  };
}
