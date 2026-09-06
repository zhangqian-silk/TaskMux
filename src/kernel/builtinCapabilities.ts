import { runTaskCommand } from "../commands/taskCommands.js";
import { runConfigCommand } from "../commands/configCommands.js";
import { CONFIG_DOMAINS, type ConfigDomain } from "../config/configCatalog.js";
import {
  createJobCallAuthority, parseDurableJobStartParams,
  type DurableJobCaller, type DurableJobControlPort
} from "../controller/jobControl.js";
import type { JsonValue } from "../core/protocol.js";
import type { TaskStore } from "../storage/taskStore.js";
import type { TrustedCallContext } from "./callAuthority.js";
import type { InstanceHost } from "./instanceHost.js";
import { inspectJobOperation } from "./kernelPorts.js";
import {
  CapabilityRegistry, type CapabilityDescriptor, type CapabilityImplementation,
} from "./capabilityRegistry.js";
import type { CapabilitySchema } from "./capabilitySchema.js";

const text: CapabilitySchema = { type: "string", minLength: 1 };
const strings: CapabilitySchema = { type: "object", additionalProperties: { type: "string" } };
const object = (properties: Record<string, CapabilitySchema>, required = Object.keys(properties)): CapabilitySchema => ({
  type: "object", properties, required, additionalProperties: false
});
const taskInput = object({ taskId: text });
const taskOutput: CapabilitySchema = { type: "object", required: ["id", "status", "title"], properties: {
  id: text, status: text, title: text
} };
const provider = Object.freeze({ id: "yui:builtin-capabilities", generation: "1" });

/** Source locators identify the existing semantic owner, not a new Store. */
const definitions: readonly Omit<CapabilityDescriptor, "contractVersion" | "provider" | "scope">[] = [
  {
    name: "task.read", summary: "Read the current Task record.", effect: "query",
    inputSchema: taskInput, outputSchema: taskOutput, requiredPermissions: ["task:read"],
    source: "TaskStore.getTask (task show)"
  },
  {
    name: "task.update", summary: "Update Task metadata through the existing command transaction.",
    effect: "local-mutation", requiredPermissions: ["task:manage"],
    source: "runTaskCommand/updateTaskCommand (task update)",
    inputSchema: object({
      taskId: text,
      patch: object({
        title: text, description: { type: "string" },
        priority: { enum: ["low", "medium", "high", "urgent"] },
        tags: { type: "array", items: text }
      }, [])
    }), outputSchema: taskOutput
  },
  {
    name: "config.read", summary: "Read effective global configuration (Operator only).",
    effect: "query", requiredPermissions: ["config:read"],
    source: "runConfigCommand (config <domain> show)",
    inputSchema: object({ domain: { enum: CONFIG_DOMAINS } }),
    outputSchema: { type: "object" }
  },
  {
    name: "resource.workspaces", summary: "Read the Task's managed workspace resources.",
    effect: "query", requiredPermissions: ["task:read"],
    source: "TaskStore.listManagedWorkspaces (task workspace list)",
    inputSchema: taskInput, outputSchema: { type: "array", items: { type: "object", required: ["owner", "root", "entries"] } }
  },
  {
    name: "job.get", summary: "Read the original Job and its operation evidence.",
    effect: "query", requiredPermissions: ["task:read"],
    source: "DurableJobControlPort.getJob (job.get RPC)",
    inputSchema: object({ taskId: text, jobId: text }),
    outputSchema: { type: "object", required: ["job", "operation"] }
  },
  {
    name: "job.start", summary: "Request an idempotent Job through the existing Controller owner.",
    effect: "external-operation", requiredPermissions: ["job:start"],
    source: "DurableJobControlPort.startJob (job.start RPC)",
    inputSchema: object({
      taskId: text, projectId: text, head: text, workspace: text,
      owner: { anyOf: [
        object({ kind: { const: "task" } }),
        object({ kind: { const: "work-item" }, workItemId: text }),
        object({ kind: { const: "integration-attempt" }, integrationAttemptId: text })
      ] },
      env: strings,
      steps: { type: "array", minItems: 1, items: object({
        name: text, command: text, timeoutMs: { type: "integer" }
      }, ["name", "command"]) },
      retryOf: text
    }, ["taskId", "projectId", "head", "workspace", "owner", "env", "steps"]),
    outputSchema: { type: "object", required: ["job", "created", "operation"], properties: { created: { type: "boolean" } } }
  },
  ...["create", "validate", "activate", "disable"].map((action) => ({
    name: `plugin.${action}`, summary: "Plugin SDK management is not implemented.",
    effect: "local-mutation" as const, requiredPermissions: ["plugin:manage"],
    source: "T09 (not implemented)", inputSchema: object({}), outputSchema: object({}),
    unavailable: "The executable plugin SDK is not implemented. Existing Agent Drivers and Project Skills retain their typed management interfaces."
  }))
];
export const BUILTIN_CAPABILITIES: readonly CapabilityDescriptor[] = definitions.map((entry) => ({
  ...entry, contractVersion: "1", provider, scope: { kind: "global" as const }
}));

/** Authenticated managed bridge. Socket possession/scope JSON is not a grant.
 * A future user/Web ingress must provide its own verified identity adapter;
 * this one deliberately accepts only the existing managed credentials. */
export function createBuiltinCapabilities(
  host: InstanceHost,
  store: TaskStore,
  jobs: DurableJobControlPort,
  signal: (taskId: string) => void = () => undefined
) {
  const authority = createJobCallAuthority(store);
  const callers = new WeakMap<TrustedCallContext, DurableJobCaller>();
  const current = (context: TrustedCallContext) => {
    authority.authorize(context, context.targetId);
    const caller = callers.get(context);
    if (!caller) throw new Error("Untrusted capability ingress.");
    return caller;
  };
  const implementation: CapabilityImplementation = {
    invoke(name, input, invocation) {
      const caller = current(invocation.context);
      const params = input as Record<string, unknown>;
      if (params.taskId !== undefined && params.taskId !== invocation.context.targetId) {
        throw new Error("Capability target is outside the authenticated Task.");
      }
      const taskId = invocation.context.targetId;
      if (name === "task.read") return requireTask(store, taskId);
      if (name === "resource.workspaces") return store.listManagedWorkspaces(taskId);
      if (name === "config.read") return runConfigCommand(params.domain as ConfigDomain, ["show"], store).data;
      if (name === "task.update") {
        const patch = params.patch as Record<string, unknown>;
        const args = ["update", taskId];
        for (const [key, value] of Object.entries(patch)) {
          if (key === "tags") {
            const tags = value as string[];
            if (tags.some((tag) => tag.includes(","))) throw new Error("Task tags cannot contain commas.");
            args.push(...(tags.length ? ["--tags", tags.join(",")] : ["--clear-tags"]));
          } else if (key === "description" && value === "") args.push("--clear-description");
          else args.push(`--${key}`, value as string);
        }
        runTaskCommand(args, store, {
          environment: callerEnvironment(caller),
          runtime: { notifyStateChanged: signal, reconcileTask: signal }
        });
        return requireTask(store, taskId);
      }
      if (name === "job.get") {
        const job = jobs.getJob(taskId, params.jobId as string);
        if (!job) throw new Error(`Job not found: ${taskId}/${params.jobId}.`);
        const operation = inspectJobOperation(job);
        invocation.observe(operation);
        return { job, operation };
      }
      if (name === "job.start") {
        const parsed = parseDurableJobStartParams({
          ...params, caller, requestId: invocation.requestId
        } as JsonValue);
        const { job, created } = jobs.startJob(parsed, new Date());
        const operation = inspectJobOperation(job);
        invocation.observe(operation);
        if (created) signal(taskId);
        return { job, created, operation };
      }
      throw new Error(`Builtin capability unavailable: ${name}.`);
    }
  };
  host.attach(provider, implementation);
  const registry = new CapabilityRegistry(host, (context, descriptor, input) => {
    const caller = current(context);
    const task = requireTask(store, context.targetId);
    if (typeof input === "object" && input !== null && "taskId" in input && input.taskId !== task.id) {
      throw new Error("Capability target is outside the authenticated Task.");
    }
    for (const permission of descriptor?.requiredPermissions ?? []) {
      if (permission === "task:read" || permission === "job:start") continue;
      if (permission === "task:manage" && (
        (caller.scope === "task" && caller.role === "leader")
        || (caller.scope === "global" && caller.role === "operator")
      )) continue;
      if ((permission === "config:read" || permission === "plugin:manage")
        && caller.scope === "global" && caller.role === "operator") continue;
      throw new Error(`Permission unavailable: ${permission}.`);
    }
    return { taskIds: [task.id], projectIds: task.projectBindings.map((binding) => binding.projectId) };
  }, BUILTIN_CAPABILITIES);
  return {
    registry,
    authenticate(caller: DurableJobCaller, taskId: string): TrustedCallContext {
      const credential = Object.freeze({ ...caller });
      const context = authority.authenticate(credential, taskId);
      callers.set(context, credential);
      return context;
    }
  };
}

function requireTask(store: TaskStore, taskId: string) {
  const task = store.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}.`);
  return task;
}

function callerEnvironment(caller: DurableJobCaller): NodeJS.ProcessEnv {
  return {
    YUI_SESSION_SCOPE: caller.scope, YUI_TASK_ID: caller.taskId,
    YUI_ROLE: caller.role, YUI_AGENT_ID: caller.agentId,
    YUI_ADAPTER_ID: caller.adapterId, YUI_JOB_CALLER_KEY: caller.callerKey
  };
}
