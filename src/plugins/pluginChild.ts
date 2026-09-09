/** Dedicated trusted-local process. Module linking fixes the dependency closure
 * to captured package bytes; node:vm is NOT a security boundary. The explicit
 * trusted-local execution grant, not this loader, authorizes author code. */
import { createContext, SourceTextModule, type Module } from "node:vm";
import { posix } from "node:path";

type Message = { id: string; type: string; [key: string]: unknown };
const send = (message: unknown) => process.send?.(message);
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
let nextCall = 0;
let instance: { handlers: Record<string, (input: unknown, api: unknown) => unknown>; dispose?: () => unknown };
let selfTest: (() => unknown) | undefined;
const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });

process.on("message", (raw: Message) => {
  if (raw.type === "nested-result") {
    const entry = pending.get(raw.id);
    if (!entry) return;
    pending.delete(raw.id);
    if (raw.error) entry.reject(new Error(String(raw.error)));
    else entry.resolve(raw.value);
    return;
  }
  void execute(raw).then(
    (value) => send({ type: "result", id: raw.id, value }),
    (error: unknown) => send({ type: "result", id: raw.id, error: error instanceof Error ? error.message : String(error) })
  );
});

async function execute(message: Message): Promise<unknown> {
  if (message.type === "load") {
    const files = message.files as Record<string, string>;
    const modules = new Map<string, SourceTextModule>();
    const load = (name: string): SourceTextModule => {
      const previous = modules.get(name);
      if (previous) return previous;
      if (!Object.hasOwn(files, name)) throw new Error(`Package module missing: ${name}`);
      const module = new SourceTextModule(files[name], {
        context, identifier: name,
        importModuleDynamically: async () => { throw new Error("Dynamic imports are not supported; bundle package dependencies."); }
      });
      modules.set(name, module);
      return module;
    };
    const root = load(message.entry as string);
    await root.link((specifier: string, parent: Module) => {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) throw new Error("Only package-relative module imports are supported.");
      const path = posix.normalize(posix.join(posix.dirname(parent.identifier), specifier));
      if (path.startsWith("../") || path.startsWith("/")) throw new Error("Module import escapes the captured package.");
      return load(path);
    });
    await root.evaluate();
    const exports = root.namespace as unknown as { initialize(): typeof instance | Promise<typeof instance>; selfTest?: () => unknown };
    if (typeof exports.initialize !== "function") throw new Error("Executable entry must export initialize().");
    // No host invocation/identity/resource port exists during initialization.
    instance = await exports.initialize();
    if (!instance || typeof instance.handlers !== "object" || !instance.handlers
      || Object.values(instance.handlers).some((handler) => typeof handler !== "function")
      || (instance.dispose !== undefined && typeof instance.dispose !== "function")) {
      throw new Error("initialize() must return handlers and an optional dispose function.");
    }
    selfTest = exports.selfTest;
    return Object.keys(instance.handlers).sort();
  }
  if (message.type === "test") {
    if (typeof selfTest !== "function") throw new Error("Executable validation requires exported selfTest().");
    if (await selfTest() !== true) throw new Error("selfTest() must return true.");
    return true;
  }
  if (message.type === "dispose") {
    await instance?.dispose?.();
    return null;
  }
  if (message.type !== "invoke") throw new Error("Unknown child request.");
  let open = true;
  try {
    const value = await instance.handlers[message.name as string](message.input, Object.freeze({
      context: Object.freeze(message.context as object), requestId: message.requestId,
      call: (request: unknown) => {
        if (!open) return Promise.reject(new Error("Plugin invocation ended."));
        const id = `nested-${++nextCall}`;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          send({ type: "nested", id, parentId: message.id, request });
        });
      }
    }));
    // IPC's JSON projection must not hide bad output from the parent registry.
    return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint" || typeof item === "function" || typeof item === "symbol"
        || (typeof item === "number" && !Number.isFinite(item))) throw new Error("Plugin output is not JSON data.");
      return item;
    }));
  } finally { open = false; }
}
