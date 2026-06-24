#!/usr/bin/env node

import { runTaskCommand } from "./commands/taskCommands.js";
import { runBackupCommand, runMigrateCommand } from "./commands/migrationCommands.js";
import { runRunnerCommand } from "./commands/runnerCommands.js";
import { runDoctor } from "./doctor/doctor.js";
import { CliError, usageError } from "./errors/cliError.js";
import { runTaskShell } from "./shell/taskShell.js";
import { FileTaskStore, resolveTaskmuxHome } from "./storage/taskStore.js";
import { ensureStorageSchema, inspectStorageSchema, type StorageSchemaState } from "./storage/storageSchema.js";
import { NodeCommandRunner } from "./tmux/commandRunner.js";
import { TmuxManager } from "./tmux/tmuxManager.js";

const VERSION = "0.0.0";

const usage = `TaskMux ${VERSION}

Local task board for native agent CLI sessions backed by tmux.

Usage:
  taskmux --help
  taskmux --version
  taskmux doctor
  taskmux backup
  taskmux migrate
  taskmux runner add <runner-id> --command <command> [--arg <arg> ...] [--env KEY=value ...]
  taskmux runner list
  taskmux runner show <runner-id>
  taskmux runner remove <runner-id>
  taskmux task create <title>
  taskmux task list
  taskmux task show <task-id>
  taskmux task start <task-id>
  taskmux task done <task-id>
  taskmux task archive <task-id>
  taskmux task reopen <task-id>
  taskmux task shell <task-id>
  taskmux task assign <task-id> <role> --agent <agent> --workspace <path>
  taskmux task roles <task-id>
  taskmux task enter <task-id> <role>
  taskmux task tail <task-id> <role>
  taskmux task detail <task-id> <role>
  taskmux task status <task-id> <role>
  taskmux task refresh <task-id>
  taskmux task transcript <task-id> <role>
  taskmux task detach <task-id> <role>
  taskmux task stop <task-id> <role>
  taskmux task kill <task-id> <role>
  taskmux task restart <task-id> <role>
  taskmux task cleanup <task-id>
  taskmux task comment <task-id> <body>
  taskmux task comments <task-id>
  taskmux task events <task-id>

Role, tmux, and runner commands are defined in docs/requirements.md.
`;

const args = process.argv.slice(2);

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(`${error.code}: ${error.message}`);
    process.exit(error.exitCode);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`RUNTIME_ERROR: ${message}`);
  process.exit(5);
});

async function main(): Promise<void> {
  const rootDir = resolveTaskmuxHome(process.env);

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return;
  }

  if (args[0] === "doctor") {
    const storageSchema = inspectStorageSchema(rootDir);
    const store = new FileTaskStore(rootDir);
    const customRunners = canReadStore(storageSchema) ? listCustomRunnersForDoctor(store) : [];

    console.log(runDoctor(process.env, new NodeCommandRunner(), customRunners, storageSchema).trimEnd());
    return;
  }

  if (args[0] === "migrate") {
    console.log(runMigrateCommand(rootDir).trimEnd());
    return;
  }

  if (args[0] === "backup") {
    console.log(runBackupCommand(rootDir).trimEnd());
    return;
  }

  if (args[0] === "runner") {
    ensureStorageSchema(rootDir);
    const store = new FileTaskStore(rootDir);
    console.log(runRunnerCommand(args.slice(1), store).trimEnd());
    return;
  }

  if (args[0] === "task") {
    ensureStorageSchema(rootDir);
    const store = new FileTaskStore(rootDir);
    const tmux = new TmuxManager(process.env.TASKMUX_TMUX_BIN ?? "tmux", new NodeCommandRunner());

    if (args[1] === "shell") {
      const taskId = args[2];

      if (taskId === undefined || taskId.trim().length === 0) {
        throw usageError("Task id is required.");
      }

      await runTaskShell(taskId, store, tmux);
      return;
    }

    console.log(runTaskCommand(args.slice(1), store, tmux).trimEnd());
    return;
  }

  console.log(usage);
}

function canReadStore(state: StorageSchemaState): boolean {
  return state.status === "current" || state.status === "uninitialized";
}

function listCustomRunnersForDoctor(store: FileTaskStore) {
  try {
    return store.listCustomRunners();
  } catch {
    return [];
  }
}
