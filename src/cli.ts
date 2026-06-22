#!/usr/bin/env node

import { runTaskCommand } from "./commands/taskCommands.js";
import { FileTaskStore, resolveTaskmuxHome } from "./storage/taskStore.js";

const VERSION = "0.0.0";

const usage = `TaskMux ${VERSION}

Local task board for native agent CLI sessions backed by tmux.

Usage:
  taskmux --help
  taskmux --version
  taskmux task create <title>
  taskmux task list
  taskmux task show <task-id>

Role, tmux, and runner commands are defined in docs/requirements.md.
`;

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (args[0] === "task") {
  const store = new FileTaskStore(resolveTaskmuxHome(process.env));
  console.log(runTaskCommand(args.slice(1), store).trimEnd());
  process.exit(0);
}

console.log(usage);
