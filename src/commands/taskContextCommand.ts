import { usageError } from "../errors/cliError.js";
import type { TaskStore } from "../storage/taskStore.js";
import { inspectTaskContext, readTaskContext, readTaskContextDelta } from "../context/taskContext.js";

/** CLI parsing only; typed callers and capability ingress share the read model. */
export function runTaskContextCommand(
  args: string[], store: TaskStore, environment: NodeJS.ProcessEnv = {}
) {
  const explicit = ["read", "delta", "inspect"].includes(args[0] ?? "");
  const action = explicit ? args[0]! : "read";
  const taskId = args[explicit ? 1 : 0];
  if (!taskId || taskId.startsWith("--")) throw usageError(
    "Task context usage: yui task context [read|delta|inspect] <task> [--after <cursor>] [--continuation <cursor>] [--limit <1..100>] [--store <store> --ref <id> --digest <digest>]."
  );
  const options = new Map<string, string>();
  const rest = args.slice(explicit ? 2 : 1);
  const allowed = action === "read" ? [] : action === "delta"
    ? ["--after", "--continuation", "--limit"] : ["--store", "--ref", "--digest"];
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!;
    const value = rest[i + 1];
    if (!allowed.includes(flag) || options.has(flag) || value === undefined || value.startsWith("--")) {
      throw usageError(`Invalid Context option: ${flag}.`);
    }
    options.set(flag, value);
  }
  let data: unknown;
  if (action === "read") data = readTaskContext(store, taskId, environment);
  else if (action === "delta") {
    const after = options.get("--after");
    if (after === undefined) throw usageError("Context delta requires --after from a previous read.");
    data = readTaskContextDelta(store, taskId, {
      after, continuation: options.get("--continuation"),
      ...(options.has("--limit") ? { limit: Number(options.get("--limit")) } : {})
    }, environment);
  } else {
    const family = options.get("--store");
    const refId = options.get("--ref");
    if (family === undefined || refId === undefined) throw usageError("Context inspect requires --store and --ref.");
    data = inspectTaskContext(store, taskId, { store: family, refId, digest: options.get("--digest") }, environment);
  }
  return { kind: "output" as const, output: `${JSON.stringify(data, null, 2)}\n`, data };
}
