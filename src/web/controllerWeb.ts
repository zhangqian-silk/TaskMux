import type { JsonValue } from "../core/protocol.js";
import { parseWebCommandOptions, startYuiWebServer, type WebServerDependencies, type YuiWebServer } from "./webServer.js";
import type { TaskStore } from "../storage/taskStore.js";

/** HTTP listener ownership only, alongside the Controller's one Kernel Host.
 * The authenticated Controller control socket starts/stops the exact listener;
 * no capability identity is accepted through this lifecycle API. */
export function createControllerWeb(store: TaskStore, dependencies: WebServerDependencies) {
  let current: { id: string; server: YuiWebServer; url: string } | undefined;
  let starting = false;
  const close = async () => {
    const owned = current;
    if (!owned) return;
    current = undefined;
    owned.server.closeTerminals();
    await new Promise<void>((resolve, reject) => {
      owned.server.close((error) => error ? reject(error) : resolve());
      owned.server.closeAllConnections();
    });
  };
  return {
    close,
    async dispatch(method: string, value: JsonValue): Promise<JsonValue> {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Web listener request.");
      const params = value as Readonly<Record<string, JsonValue>>;
      if (method === "web.status") {
        if (Object.keys(params).length) throw new Error("Web status takes no arguments.");
        return current ? { id: current.id, url: current.url } : null;
      }
      if (method === "web.stop") {
        if (Object.keys(params).some((key) => key !== "id") || typeof params.id !== "string") throw new Error("Expected Web listener id.");
        if (!current) return { stopped: false };
        if (current.id !== params.id) throw new Error("Web listener identity changed.");
        await close();
        return { stopped: true };
      }
      if (method !== "web.start" || Object.keys(params).some((key) => !["id","host","port"].includes(key))
        || typeof params.id !== "string" || !params.id.trim()
        || typeof params.host !== "string" || typeof params.port !== "number") {
        throw new Error("Expected id, host and port for Web start.");
      }
      const options = parseWebCommandOptions(["--host", params.host, "--port", String(params.port)]);
      if (starting || current) throw new Error("A Web listener is already starting or running in this Controller.");
      starting = true;
      try {
        const server = await startYuiWebServer(store, options, dependencies);
        const url = `http://${options.host === "::1" ? "[::1]" : options.host}:${options.port}`;
        current = { id: params.id, server, url };
        return { id: params.id, url };
      } finally { starting = false; }
    }
  };
}
