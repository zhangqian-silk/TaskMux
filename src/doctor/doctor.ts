import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomRunner } from "../runner/runner.js";
import { FileTaskStore, resolveTaskmuxHome } from "../storage/taskStore.js";
import { inspectStorageSchema, type StorageSchemaState } from "../storage/storageSchema.js";
import type { CommandRunner } from "../tmux/commandRunner.js";

export function runDoctor(
  env: NodeJS.ProcessEnv,
  runner: CommandRunner,
  customRunners: CustomRunner[] = [],
  storageSchema: StorageSchemaState = inspectStorageSchema(resolveTaskmuxHome(env))
): string {
  const checks = [
    checkNode(),
    checkExecutable("tmux", env.TASKMUX_TMUX_BIN ?? "tmux", ["-V"], runner),
    ...customRunners.map((customRunner) =>
      checkExecutable(`runner:${customRunner.id}`, customRunner.command, ["--version"], runner)
    ),
    {
      name: "taskmux home",
      status: "ok",
      detail: resolveTaskmuxHome(env)
    },
    checkStorageSchema(storageSchema),
    checkStoragePermissions(resolveTaskmuxHome(env)),
    checkStorageRecords(resolveTaskmuxHome(env), storageSchema)
  ];

  return `TaskMux doctor\n${checks
    .map((check) => `${check.name}\t${check.status}\t${check.detail}`)
    .join("\n")}\n`;
}

type DoctorCheck = {
  name: string;
  status: "ok" | "missing" | "upgrade-required" | "unsupported" | "invalid";
  detail: string;
};

function checkNode(): DoctorCheck {
  return {
    name: "node",
    status: "ok",
    detail: process.version
  };
}

function checkExecutable(
  name: string,
  executable: string,
  args: string[],
  runner: CommandRunner
): DoctorCheck {
  try {
    return {
      name,
      status: "ok",
      detail: firstLine(runner.run(executable, args))
    };
  } catch {
    return {
      name,
      status: "missing",
      detail: executable
    };
  }
}

function firstLine(output: string): string {
  return output.trim().split("\n")[0] ?? "";
}

function checkStorageSchema(state: StorageSchemaState): DoctorCheck {
  switch (state.status) {
    case "uninitialized":
      return {
        name: "storage schema",
        status: "ok",
        detail: `latest=${state.latestVersion}`
      };
    case "current":
      return {
        name: "storage schema",
        status: "ok",
        detail: `current=${state.currentVersion} latest=${state.latestVersion}`
      };
    case "upgrade-required":
      return {
        name: "storage schema",
        status: "upgrade-required",
        detail: `current=${state.currentVersion} latest=${state.latestVersion}; run taskmux migrate`
      };
    case "unsupported":
      return {
        name: "storage schema",
        status: "unsupported",
        detail: `current=${state.currentVersion} latest=${state.latestVersion}`
      };
    case "invalid":
      return {
        name: "storage schema",
        status: "invalid",
        detail: state.detail
      };
  }
}

function checkStoragePermissions(rootDir: string): DoctorCheck {
  const probePath = join(rootDir, ".taskmux-doctor-write-check");

  try {
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(probePath, "ok\n");
    rmSync(probePath);

    return {
      name: "storage permissions",
      status: "ok",
      detail: "read-write"
    };
  } catch (error) {
    return {
      name: "storage permissions",
      status: "invalid",
      detail: errorMessage(error)
    };
  }
}

function checkStorageRecords(rootDir: string, state: StorageSchemaState): DoctorCheck {
  if (state.status === "upgrade-required") {
    return {
      name: "storage records",
      status: "upgrade-required",
      detail: "run taskmux migrate"
    };
  }

  if (state.status === "unsupported") {
    return {
      name: "storage records",
      status: "unsupported",
      detail: `current=${state.currentVersion} latest=${state.latestVersion}`
    };
  }

  if (state.status === "invalid") {
    return {
      name: "storage records",
      status: "invalid",
      detail: state.detail
    };
  }

  try {
    const store = new FileTaskStore(rootDir);
    const tasks = store.listTasks();
    const roleCount = tasks.reduce((count, task) => count + store.listRoles(task.id).length, 0);
    const runnerCount = store.listCustomRunners().length;

    return {
      name: "storage records",
      status: "ok",
      detail: `tasks=${tasks.length} roles=${roleCount} runners=${runnerCount}`
    };
  } catch (error) {
    return {
      name: "storage records",
      status: "invalid",
      detail: errorMessage(error)
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
