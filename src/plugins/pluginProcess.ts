import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { CapabilityCall, CapabilityInvocation } from "../kernel/capabilityRegistry.js";
import type { PluginPackage } from "./pluginPackage.js";

export function pluginProcessEnvironment(directory: string): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, LANG: "C.UTF-8" };
}

/** Parent-side RPC: the only author-controlled action is a nested capability
 * request bound to a still-live original invocation. No observe/actor ingress. */
export class PluginProcess {
  readonly #child: ChildProcess;
  readonly #closed: Promise<void>;
  readonly #pending = new Map<string, {
    resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout;
    invocation?: CapabilityInvocation; check?: () => void;
  }>();
  #ended = false;

  constructor(directory: string) {
    this.#child = fork(fileURLToPath(new URL("./pluginChild.js", import.meta.url)), [], {
      cwd: directory, env: pluginProcessEnvironment(directory),
      execArgv: ["--experimental-vm-modules", "--disable-proto=throw"],
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    this.#closed = new Promise((resolve) => this.#child.once("close", () => { this.#fail("Plugin process closed."); resolve(); }));
    this.#child.on("error", (error) => this.#fail(error.message));
    this.#child.on("message", (raw: unknown) => {
      void this.#receive(raw).catch(() => this.#fail("Invalid plugin process message."));
    });
  }

  async load(pkg: PluginPackage): Promise<void> {
    const names = await this.#request("load", { files: pkg.files, entry: pkg.manifest.entry });
    if (JSON.stringify(names) !== JSON.stringify(pkg.manifest.capabilities.map((capability) => capability.name).sort())) {
      throw new Error("Initialized contribution set differs from manifest.");
    }
  }

  test(): Promise<unknown> { return this.#request("test", {}); }

  invoke(name: string, input: unknown, invocation: CapabilityInvocation, check: () => void): Promise<unknown> {
    return this.#request("invoke", { name, input, context: invocation.context, requestId: invocation.requestId }, invocation, check);
  }

  async dispose(): Promise<void> {
    try { if (!this.#ended) await this.#request("dispose", {}); }
    finally {
      if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill("SIGKILL");
      await this.#closed;
    }
  }

  #request(type: string, data: object, invocation?: CapabilityInvocation, check?: () => void): Promise<unknown> {
    if (this.#ended) return Promise.reject(new Error("Plugin process unavailable."));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#fail("Plugin process request timed out; process terminated.");
        this.#child.kill("SIGKILL");
      }, 30_000);
      this.#pending.set(id, { resolve, reject, timer, invocation, check });
      this.#child.send({ ...data, type, id }, (error) => {
        if (error) this.#fail(error.message);
      });
    });
  }

  async #receive(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== "object") throw new Error("Invalid message.");
    const message = raw as { type: string; id: string; parentId: string; request: CapabilityCall; error?: string; value: unknown };
    if (message.type === "result") {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) pending.reject(new Error(String(message.error)));
      else pending.resolve(message.value);
    } else if (message.type === "nested") {
      const parent = this.#pending.get(message.parentId);
      let value: unknown;
      let error: string | undefined;
      try {
        if (!parent?.invocation) throw new Error("No live plugin invocation; initialization cannot call capabilities.");
        parent.check?.();
        const request = message.request;
        if (!request || typeof request !== "object" || Array.isArray(request)
          || Object.keys(request).some((key) => !["name", "input", "contractVersion", "providerId", "requestId"].includes(key))) {
          throw new Error("Invalid nested capability request.");
        }
        value = await parent.invocation.call(request);
      } catch (caught) { error = caught instanceof Error ? caught.message : "Nested call denied."; }
      if (this.#child.connected) this.#child.send({ type: "nested-result", id: message.id, value, error });
    } else throw new Error("Unsupported message.");
  }

  #fail(message: string): void {
    this.#ended = true;
    if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill("SIGKILL");
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.#pending.clear();
  }
}
