#!/usr/bin/env node

import { runConfigCommand } from "./commands/configCommands.js";
import { runExportCommand, runImportCommand, runPruneCommand } from "./commands/maintenanceCommands.js";
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
  taskmux completion bash|zsh|fish
  taskmux doctor
  taskmux backup
  taskmux migrate [--dry-run]
  taskmux export --output <file>
  taskmux import <file>
  taskmux prune [--trash] [--backups] [--keep-backups <count>]
  taskmux config show
  taskmux config set default-agent <runner-id>
  taskmux config set default-workspace <path>
  taskmux runner add <runner-id> --command <command> [--arg <arg> ...] [--env KEY=value ...]
  taskmux runner list
  taskmux runner show <runner-id>
  taskmux runner remove <runner-id>
  taskmux task create <title> [--template feature|bug|review] [--agent <agent>] [--workspace <path>] [--description <body>] [--priority low|medium|high|urgent] [--tag <tag> ...] [--owner <owner>] [--due YYYY-MM-DD]
  taskmux task update <task-id> [--title <title>] [--description <body>] [--priority low|medium|high|urgent] [--tag <tag> ...] [--owner <owner>] [--due YYYY-MM-DD] [--clear-description] [--clear-priority] [--clear-tags] [--clear-owner] [--clear-due]
  taskmux task list [--status <status>] [--owner <owner>] [--tag <tag>] [--priority <priority>] [--search <text>]
  taskmux task board [--status <status>] [--owner <owner>] [--tag <tag>] [--priority <priority>] [--search <text>] [--with-roles]
  taskmux task show <task-id>
  taskmux task current [<task-id>]
  taskmux task last
  taskmux task clone <task-id> [--title <title>]
  taskmux task start <task-id>
  taskmux task done <task-id>
  taskmux task archive <task-id>
  taskmux task reopen <task-id>
  taskmux task delete <task-id>
  taskmux task restore <task-id>
  taskmux task shell <task-id>
  taskmux task context <task-id> [--format text|json] [--include-transcripts]
  taskmux task assign <task-id> <role> --agent <agent> --workspace <path>
  taskmux task assign-many <task-id> --role <role> ... [--agent <agent>] [--workspace <path>]
  taskmux task role update <task-id> <role> [--agent <agent>] [--workspace <path>]
  taskmux task role rename <task-id> <role> <new-role>
  taskmux task roles <task-id>
  taskmux task enter <task-id> <role>
  taskmux task tail <task-id> <role>
  taskmux task detail <task-id> <role>
  taskmux task status <task-id> <role>
  taskmux task refresh <task-id>
  taskmux task transcript <task-id> <role>
  taskmux task transcript export <task-id> <role> [--format text|json|markdown] [--output <file>]
  taskmux task activity <task-id>
  taskmux task timeline <task-id>
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

  if (args[0] === "completion") {
    console.log(renderCompletion(args[1]).trimEnd());
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
    console.log(runMigrateCommand(rootDir, args.slice(1)).trimEnd());
    return;
  }

  if (args[0] === "backup") {
    console.log(runBackupCommand(rootDir).trimEnd());
    return;
  }

  if (args[0] === "config") {
    ensureStorageSchema(rootDir);
    const store = new FileTaskStore(rootDir);
    console.log(runConfigCommand(args.slice(1), store).trimEnd());
    return;
  }

  if (args[0] === "export") {
    ensureStorageSchema(rootDir);
    const store = new FileTaskStore(rootDir);
    console.log(runExportCommand(args.slice(1), store).trimEnd());
    return;
  }

  if (args[0] === "import") {
    ensureStorageSchema(rootDir);
    const store = new FileTaskStore(rootDir);
    console.log(runImportCommand(args.slice(1), store).trimEnd());
    return;
  }

  if (args[0] === "prune") {
    ensureStorageSchema(rootDir);
    console.log(runPruneCommand(args.slice(1), rootDir).trimEnd());
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

function renderCompletion(shell: string | undefined): string {
  const commands = [
    "doctor", "backup", "migrate", "export", "import", "prune", "config", "runner", "task", "completion",
    "create", "update", "list", "board", "show", "start", "done", "archive", "reopen", "delete", "restore",
    "shell", "context", "assign", "assign-many", "role", "roles", "enter", "tail", "detail", "status",
    "refresh", "transcript", "activity", "timeline", "detach", "stop", "kill", "restart", "cleanup",
    "comment", "comments", "events", "current", "last", "clone"
  ].join(" ");

  if (shell === "bash") {
    return `_taskmux() {
  COMPREPLY=( $(compgen -W "${commands}" -- "\${COMP_WORDS[COMP_CWORD]}") )
}
complete -F _taskmux taskmux
`;
  }

  if (shell === "zsh") {
    return `#compdef taskmux
_arguments '*::taskmux command:(${commands})'
`;
  }

  if (shell === "fish") {
    return commands
      .split(" ")
      .map((command) => `complete -c taskmux -f -a ${command}`)
      .join("\n")
      .concat("\n");
  }

  throw usageError("Completion shell must be one of bash, zsh, fish.");
}
