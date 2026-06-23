import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runTaskCommand } from "../commands/taskCommands.js";
import { CliError, taskNotFound } from "../errors/cliError.js";
import type { TaskStore } from "../storage/taskStore.js";
import type { TmuxManager } from "../tmux/tmuxManager.js";

export async function runTaskShell(
  taskId: string,
  store: TaskStore,
  tmux: TmuxManager
): Promise<void> {
  if (store.getTask(taskId) === null) {
    throw taskNotFound(taskId);
  }

  output.write(runTaskCommand(["open", taskId], store, tmux));

  const rl = createInterface({ input, output });

  try {
    if (!input.isTTY) {
      for await (const line of rl) {
        output.write(`tb ${taskId}> `);
        if (handleShellLine(taskId, line, store, tmux) === "exit") {
          break;
        }
      }
      return;
    }

    while (true) {
      const line = await rl.question(`tb ${taskId}> `);
      if (handleShellLine(taskId, line, store, tmux) === "exit") {
        break;
      }
    }
  } finally {
    rl.close();
  }
}

function handleShellLine(
  taskId: string,
  line: string,
  store: TaskStore,
  tmux: TmuxManager
): "continue" | "exit" {
  const command = parseCommandLine(line);

  if (command.length === 0) {
    return "continue";
  }

  const [name, ...args] = command;

  if (name === "exit" || name === "quit") {
    return "exit";
  }

  if (name === "help") {
    output.write(shellHelp());
    return "continue";
  }

  try {
    output.write(runTaskCommand(toTaskCommand(taskId, name, args), store, tmux));
  } catch (error) {
    if (error instanceof CliError) {
      output.write(`${error.code}: ${error.message}\n`);
      return "continue";
    }

    throw error;
  }
  return "continue";
}

function toTaskCommand(taskId: string, name: string, args: string[]): string[] {
  switch (name) {
    case "summary":
      return ["open", taskId];
    case "start":
    case "done":
    case "archive":
    case "reopen":
    case "refresh":
    case "cleanup":
      return [name, taskId];
    case "roles":
    case "comments":
      return [name, taskId];
    case "comment":
      return [name, taskId, ...args];
    case "assign":
      return [name, taskId, ...args];
    case "enter":
    case "tail":
    case "detail":
    case "status":
    case "transcript":
    case "detach":
    case "stop":
    case "kill":
    case "restart":
      return [name, taskId, ...args];
    default:
      return [name, ...args];
  }
}

function parseCommandLine(line: string): string[] {
  const tokens = line.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

  return tokens.map((token) => {
    if (
      (token.startsWith("\"") && token.endsWith("\"")) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }

    return token;
  });
}

function shellHelp(): string {
  return `Task shell commands:
  summary
  start
  done
  archive
  reopen
  roles
  refresh
  cleanup
  comments
  comment <body>
  assign <role> --agent <agent> --workspace <path>
  enter <role>
  tail <role>
  detail <role>
  status <role>
  transcript <role>
  detach <role>
  stop <role>
  kill <role>
  restart <role>
  help
  exit
`;
}
