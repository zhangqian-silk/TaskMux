#!/usr/bin/env node

import { runTaskCommand } from "./commands/taskCommands.js";
import { runDoctor } from "./doctor/doctor.js";
import { CliError, usageError } from "./errors/cliError.js";
import { runTaskShell } from "./shell/taskShell.js";
import { FileTaskStore, resolveTaskmuxHome } from "./storage/taskStore.js";
import { NodeCommandRunner } from "./tmux/commandRunner.js";
import { TmuxManager } from "./tmux/tmuxManager.js";

const VERSION = "0.0.0";

const usage = `TaskMux ${VERSION}

Local task board for native agent CLI sessions backed by tmux.

Usage:
  taskmux --help
  taskmux --version
  taskmux doctor
  taskmux task create <title>
  taskmux task list
  taskmux task show <task-id>
  taskmux task shell <task-id>
  taskmux task assign <task-id> <role> --agent <agent> --workspace <path>
  taskmux task roles <task-id>
  taskmux task enter <task-id> <role>
  taskmux task tail <task-id> <role>

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
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return;
  }

  if (args[0] === "doctor") {
    console.log(runDoctor(process.env, new NodeCommandRunner()).trimEnd());
    return;
  }

  if (args[0] === "task") {
    const store = new FileTaskStore(resolveTaskmuxHome(process.env));
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
