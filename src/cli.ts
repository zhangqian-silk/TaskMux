#!/usr/bin/env node

import { runTaskCommand } from "./commands/taskCommands.js";
import { runDoctor } from "./doctor/doctor.js";
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

if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (args[0] === "doctor") {
  console.log(runDoctor(process.env, new NodeCommandRunner()).trimEnd());
  process.exit(0);
}

if (args[0] === "task") {
  const store = new FileTaskStore(resolveTaskmuxHome(process.env));
  const tmux = new TmuxManager(process.env.TASKMUX_TMUX_BIN ?? "tmux", new NodeCommandRunner());

  if (args[1] === "shell") {
    await runTaskShell(args[2] ?? "", store, tmux);
    process.exit(0);
  }

  console.log(runTaskCommand(args.slice(1), store, tmux).trimEnd());
  process.exit(0);
}

console.log(usage);
