import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TaskStore } from "../storage/taskStore.js";
import { checkGrant, recordGrantUse } from "../grant/capabilityGrant.js";
import { createProjectResources } from "../resources/projectResourceService.js";
import type { TrustedCallContext } from "../kernel/callAuthority.js";
import type { InstanceHost, ImplementationRef } from "../kernel/instanceHost.js";
import type { CapabilityRegistry, CapabilityDescriptor, CapabilityImplementation } from "../kernel/capabilityRegistry.js";
import { packagePath, readPluginPackage, type PluginPackage, type PluginValidation } from "./pluginPackage.js";
import { interpretPlugin } from "./pluginInterpreter.js";
import { PluginProcess, pluginProcessEnvironment } from "./pluginProcess.js";

const execute = promisify(execFile);
type Active = { ref: ImplementationRef; validationId: string };

/** SDK management owner. Validation is durable evidence; active implementations
 * belong to the existing Host. Restart requires explicit activation, not a
 * stored active flag, automatic author execution or an upgrade/recovery worker. */
export function createPluginService(store: TaskStore, host: InstanceHost, registry: CapabilityRegistry) {
  const resources = createProjectResources(store);
  const active = new Map<string, Active>();
  // Resource references mirror actual SDK operations/Host ownership only.
  // They prevent explicit environment release while those owners still use it.
  const environmentUsers = new Map<object, { taskId: string; preparationId: string }>();
  const retainEnvironment = (taskId: string, preparationId: string) => {
    const token = {};
    environmentUsers.set(token, { taskId, preparationId });
    return () => { environmentUsers.delete(token); };
  };
  // In-process compare token only: prevents async candidate publication after a
  // competing activate/disable. It is neither a lease nor durable workflow state.
  const changes = new Map<string, object>();
  const keyFor = (taskId: string, pluginId: string) => `plugin:${taskId}:${pluginId}`;
  const environment = (taskId: string, preparationId: string) => {
    const task = store.getTask(taskId);
    if (!task || !["draft", "active"].includes(task.status)) throw new Error("Plugin environment requires an open Task.");
    const prepared = store.getEnvironmentPreparation(taskId, preparationId);
    if (!prepared || prepared.disposition !== "adopted" || !prepared.directory || prepared.access !== "write") {
      throw new Error("Plugin development/execution requires an adopted writable T05 environment.");
    }
    // Reuses T05's current identity, resource intent and grant checks. Adoption
    // of the same record does not consume another resource use.
    return resources.adopt(taskId, preparationId);
  };
  const packageDirectory = (taskId: string, preparationId: string, directory: string) => {
    const env = environment(taskId, preparationId);
    const root = env.directory!.path;
    const path = resolve(root, directory);
    const child = relative(root, path);
    packagePath(child);
    if (realpathSync(path) !== path) throw new Error("Plugin directory must not traverse symlinks.");
    return { env, path };
  };
  const descriptors = (taskId: string, pkg: PluginPackage, ref: ImplementationRef): CapabilityDescriptor[] =>
    pkg.manifest.capabilities.map((capability) => ({
      ...capability, provider: ref, scope: { kind: "task", id: taskId },
      source: `plugin:${pkg.manifest.id}@${pkg.digest}`, required: pkg.manifest.required
    }));
  const refFor = (taskId: string, pkg: PluginPackage): ImplementationRef =>
    ({ id: keyFor(taskId, pkg.manifest.id), generation: randomUUID() });

  /** Each actual code-execution attempt consumes one precisely bounded grant.
   * The returned check rechecks that original reservation on subsequent child
   * actions; scope or a manifest is never an executable-code grant. */
  const execution = (taskId: string, preparationId: string, pkg: PluginPackage, phase: string) => {
    const params = { pluginId: pkg.manifest.id, digest: pkg.digest,
      environmentRef: `${taskId}/${preparationId}`, trust: "trusted-local", phase };
    // This grants the capability to run code without OS effect confinement;
    // it does not claim that every invocation actually has irreversible effects.
    const request = { action: "plugin.execute", params, irreversibility: "irreversible" as const };
    const reservation = `plugin/${randomUUID()}`;
    const grantId = store.transaction((tx) => {
      const env = environment(taskId, preparationId);
      const grant = tx.listCapabilityGrants(taskId).find((candidate) =>
        Object.entries(params).every(([key, value]) => candidate.parameterBounds[key]?.includes(value))
        && (candidate.scope.taskId === undefined || candidate.scope.taskId === taskId)
        && candidate.scope.projectIds === undefined && candidate.scope.repositories === undefined
        && candidate.scope.packages === undefined
        && (candidate.scope.homePath === undefined || candidate.scope.homePath === env.directory!.path)
        && checkGrant(candidate, request, new Date()).allowed);
      if (!grant) throw new Error(`Explicit trusted-local execution grant unavailable (${phase}); pluginId=${params.pluginId}, digest=${params.digest}, environmentRef=${params.environmentRef}.`);
      tx.saveCapabilityGrant(taskId, recordGrantUse(grant, new Date(), reservation));
      return grant.id;
    });
    return () => {
      environment(taskId, preparationId);
      const grant = store.listCapabilityGrants(taskId).find((candidate) => candidate.id === grantId);
      if (!grant?.useReservations.includes(reservation)
        || !checkGrant(grant, request, new Date(), { skipUsesCheck: true }).allowed) {
        throw new Error("Plugin execution authority was revoked.");
      }
    };
  };

  const prepare = async (taskId: string, preparationId: string, pkg: PluginPackage, phase: "validate" | "activate",
    executionInput = pkg) => {
    if (pkg.manifest.kind === "declarative") {
      const implementation = interpretPlugin(pkg);
      const release = retainEnvironment(taskId, preparationId);
      return { implementation, dispose: async () => { release(); } };
    }
    const check = execution(taskId, preparationId, executionInput, phase);
    const env = environment(taskId, preparationId);
    const process = new PluginProcess(env.directory!.path);
    const release = retainEnvironment(taskId, preparationId);
    const dispose = async () => { try { await process.dispose(); } finally { release(); } };
    try {
      check();
      await process.load(pkg);
      check();
      if (phase === "validate") { await process.test(); check(); }
      const implementation: CapabilityImplementation = {
        invoke(name, input, invocation) {
          const checkCall = execution(taskId, preparationId, pkg, "call");
          return process.invoke(name, input, invocation, checkCall);
        }
      };
      return { implementation, dispose };
    } catch (error) {
      try { await dispose(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "Plugin initialization and candidate cleanup failed."); }
      throw error;
    }
  };

  return {
    assertEnvironmentUnused(taskId: string, preparationId: string) {
      if ([...environmentUsers.values()].some((owner) => owner.taskId === taskId && owner.preparationId === preparationId)) {
        throw new Error("Environment has live plugin references; disable and drain its plugins or finish validation first.");
      }
    },
    scan(taskId: string, preparationId: string, directory: string) {
      const { path } = packageDirectory(taskId, preparationId, directory);
      const pkg = readPluginPackage(path, false);
      return { directory: path, preparationId, digest: pkg.digest, manifest: pkg.manifest,
        files: Object.keys(pkg.files), executedAuthorCode: false };
    },
    create(taskId: string, preparationId: string, id: string, kind: "declarative" | "trusted-local") {
      if (!/^[a-z][a-z0-9-]*$/u.test(id) || !["declarative", "trusted-local"].includes(kind)) throw new Error("Invalid plugin template.");
      const env = environment(taskId, preparationId);
      const directory = join(env.directory!.path, id);
      mkdirSync(directory, { mode: 0o700 }); // Never overwrite an author's directory.
      const name = `${id}.echo`;
      const manifest = {
        id, version: "1.0.0", apiVersion: "1", kind, entry: kind === "declarative" ? "entry.json" : "entry.mjs",
        capabilities: [{ name, contractVersion: "1", summary: "Return JSON input.", inputSchema: {}, outputSchema: {},
          effect: "query", requiredPermissions: [] }], required: [], permissions: [], reloadMode: "manual"
      };
      writeFileSync(join(directory, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      writeFileSync(join(directory, manifest.entry), kind === "declarative"
        ? JSON.stringify({ [name]: { type: "echo" } }, null, 2) + "\n"
        : `export function initialize() {\n  return { handlers: { ${JSON.stringify(name)}: async (input) => input }, dispose() {} };\n}\nexport function selfTest() { return true; }\n`,
      { flag: "wx", mode: 0o600 });
      return { directory, preparationId, kind, executedAuthorCode: false };
    },

    async validate(context: TrustedCallContext, preparationId: string, directory: string) {
      const taskId = context.targetId;
      const { env, path } = packageDirectory(taskId, preparationId, directory);
      const source = readPluginPackage(path, false);
      registry.checkRegistration(context, descriptors(taskId, source, refFor(taskId, source)));
      const checks = ["data-only manifest/schema/namespace/permissions/dependencies"];
      let pkg = source;
      if (source.manifest.build) {
        const check = execution(taskId, preparationId, source, "build");
        const [script, ...args] = source.manifest.build;
        packagePath(script);
        if (!Object.hasOwn(source.files, script)) throw new Error("Build script must be inside the captured source package.");
        const buildDirectory = mkdtempSync(join(env.directory!.path, ".plugin-build-"));
        const release = retainEnvironment(taskId, preparationId);
        try {
          for (const [file, content] of Object.entries(source.files)) {
            const target = join(buildDirectory, file);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, content, { flag: "wx", mode: 0o600 });
          }
          check();
          await execute(process.execPath, [join(buildDirectory, script), ...args], {
            cwd: buildDirectory, env: pluginProcessEnvironment(buildDirectory),
            timeout: 30_000, maxBuffer: 64 * 1024
          });
          check();
          pkg = readPluginPackage(buildDirectory);
          checks.push(`build cwd=${buildDirectory}; executable=${process.execPath}; argv=${JSON.stringify(source.manifest.build)}; exit=0`);
        } finally {
          try {
            if (realpathSync(buildDirectory) !== buildDirectory) throw new Error("Build directory identity changed; retained for inspection.");
            rmSync(buildDirectory, { recursive: true });
          } finally { release(); }
        }
        checks.push("trusted-local Node build completed");
      } else {
        if (!Object.hasOwn(source.files, source.manifest.entry)) throw new Error("Plugin entry is missing.");
        checks.push("no build command; package is directly loadable");
      }
      // Builds may change products, not silently replace permissions or contract.
      if (JSON.stringify(pkg.manifest) !== JSON.stringify(source.manifest)) throw new Error("Build changed plugin manifest; inspect and validate explicitly.");
      registry.checkRegistration(context, descriptors(taskId, pkg, refFor(taskId, pkg)));
      const candidate = await prepare(taskId, preparationId, pkg, "validate", source);
      await candidate.dispose();
      checks.push(pkg.manifest.kind === "declarative" ? "trusted interpreter parsed complete entry" : "child initialize/full contribution set/selfTest/dispose");
      const current = packageDirectory(taskId, preparationId, directory);
      if (readPluginPackage(current.path, false).digest !== source.digest) throw new Error("Plugin changed during validation.");
      registry.checkRegistration(context, descriptors(taskId, pkg, refFor(taskId, pkg)));
      const validation: PluginValidation = {
        schemaVersion: 1, id: `validation-${randomUUID()}`, taskId, directory: path, preparationId, sourceDigest: source.digest, package: pkg,
        environment: { ...env.directory!, isolation: "trusted-local", node: process.version },
        checks, createdAt: new Date().toISOString()
      };
      store.savePluginValidation(validation);
      return { ...validation, package: { manifest: pkg.manifest, digest: pkg.digest } };
    },

    inspect(taskId: string, validationId: string) {
      const validation = store.getPluginValidation(taskId, validationId);
      if (!validation) throw new Error("Plugin validation not found in this Task.");
      const { files: _files, ...pkg } = validation.package;
      return { ...validation, package: pkg };
    },

    async activate(context: TrustedCallContext, validationId: string) {
      const taskId = context.targetId;
      const validation = store.getPluginValidation(taskId, validationId);
      if (!validation) throw new Error("Plugin validation not found in this Task.");
      const { package: pkg, preparationId, directory } = validation;
      const verify = () => {
        const current = packageDirectory(taskId, preparationId, directory);
        const expected = validation.environment;
        if (current.env.directory!.device !== expected.device || current.env.directory!.inode !== expected.inode
          || current.env.directory!.path !== expected.path || expected.node !== process.version) {
          throw new Error("Validation execution environment changed; validate again.");
        }
        if (readPluginPackage(current.path, false).digest !== validation.sourceDigest) throw new Error("Plugin bytes differ from validated source.");
      };
      verify();
      const ref = refFor(taskId, pkg);
      const entries = descriptors(taskId, pkg, ref);
      registry.checkRegistration(context, entries);
      const token = {};
      changes.set(ref.id, token);
      const candidate = await prepare(taskId, preparationId, pkg, "activate");
      let attached = false;
      try {
        verify();
        registry.checkRegistration(context, entries);
        if (changes.get(ref.id) !== token) throw new Error("Plugin activation superseded by another explicit management action.");
        host.attach(ref, {
          invoke: (name: string, input: unknown, invocation: Parameters<CapabilityImplementation["invoke"]>[2]) => {
            environment(taskId, preparationId);
            return candidate.implementation.invoke(name, input, invocation);
          }
        }, [candidate.dispose]);
        attached = true;
        const previous = active.get(ref.id);
        registry.register(entries);
        active.set(ref.id, { ref, validationId });
        if (previous) {
          // Old calls keep their exact Host handle. Replacement must not block on
          // them, nor allow a cleanup error to roll back the published provider.
          void host.detach(previous.ref).catch((error: unknown) => {
            resources.saveArtifact(taskId, { kind: "content", displayName: "Plugin instance cleanup failure",
              provenance: `PluginService.dispose ${previous.ref.id}/${previous.ref.generation}`,
              content: error instanceof Error ? error.message : String(error) });
          });
        }
        return { provider: ref, validationId, digest: pkg.digest, capabilities: entries.map((entry) => entry.name),
          lifetime: "current-controller", previousDraining: previous?.ref };
      } catch (error) {
        if (attached) await host.detach(ref);
        else await candidate.dispose();
        throw error;
      }
    },

    async disable(taskId: string, pluginId: string) {
      const key = keyFor(taskId, pluginId);
      changes.set(key, {});
      const current = active.get(key);
      if (!current) return { disabled: true, providerId: key, note: "No active instance in this Controller." };
      registry.disable(key);
      active.delete(key);
      try { await host.detach(current.ref); }
      catch (error) { throw new Error(`Plugin disabled; owned cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
      return { disabled: true, provider: current.ref, drained: true };
    }
  };
}
