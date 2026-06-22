import { resolveTaskmuxHome } from "../storage/taskStore.js";
import type { CommandRunner } from "../tmux/commandRunner.js";

export function runDoctor(env: NodeJS.ProcessEnv, runner: CommandRunner): string {
  const checks = [
    checkNode(),
    checkExecutable("tmux", env.TASKMUX_TMUX_BIN ?? "tmux", ["-V"], runner),
    checkExecutable("codex", env.TASKMUX_CODEX_BIN ?? "codex", ["--version"], runner),
    checkExecutable("claude", env.TASKMUX_CLAUDE_BIN ?? "claude", ["--version"], runner),
    {
      name: "taskmux home",
      status: "ok",
      detail: resolveTaskmuxHome(env)
    }
  ];

  return `TaskMux doctor\n${checks
    .map((check) => `${check.name}\t${check.status}\t${check.detail}`)
    .join("\n")}\n`;
}

type DoctorCheck = {
  name: string;
  status: "ok" | "missing";
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
