import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { usageError } from "../errors/cliError.js";
import type { CommandRunner } from "../tmux/commandRunner.js";

export type SetupDependency = "tmux";

type SetupOptions = {
  dependency?: SetupDependency;
  yes: boolean;
};

type InstallStep = {
  command: string;
  args: string[];
};

type InstallPlan = {
  manager: string;
  steps: InstallStep[];
  manualHint: string;
};

export function runSetupCommand(args: string[], env: NodeJS.ProcessEnv, runner: CommandRunner): string {
  const options = parseSetupOptions(args);
  const dependencies: SetupDependency[] = options.dependency === undefined ? ["tmux"] : [options.dependency];
  const lines = ["TaskMux setup", ...setupCliBindingGuide()];

  for (const dependency of dependencies) {
    if (dependency === "tmux") {
      lines.push(...setupTmux(options.yes, env, runner));
    }
  }

  return `${lines.join("\n")}\n`;
}

function setupCliBindingGuide(): string[] {
  return [
    "owner\tbuiltin\tEvery task includes the owner role.",
    "cli\toption\ttaskmux runner add codex --command codex",
    "cli\toption\ttaskmux runner add claude --command claude",
    "cli\tcustom\ttaskmux runner add <runner-id> --command <command>",
    "owner\tnext\tSet default-agent to the runner id that should back owner.",
    "owner\tnext\tSet default-workspace or pass --workspace when creating a task."
  ];
}

function parseSetupOptions(args: string[]): SetupOptions {
  let dependency: SetupDependency | undefined;
  let yes = false;

  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }

    if (arg === "tmux") {
      dependency = "tmux";
      continue;
    }

    throw usageError("Setup usage: taskmux setup [tmux] [--yes]");
  }

  return { dependency, yes };
}

function setupTmux(yes: boolean, env: NodeJS.ProcessEnv, runner: CommandRunner): string[] {
  const tmuxCommand = env.TASKMUX_TMUX_BIN ?? "tmux";

  if (hasExecutable(tmuxCommand, ["-V"], runner)) {
    return ["tmux\tok\talready installed"];
  }

  const plan = detectTmuxInstallPlan(env, runner);

  if (plan === null) {
    return [
      "tmux\tmissing\tno supported package manager detected",
      "tmux\tmanual\tInstall tmux manually, then run taskmux doctor."
    ];
  }

  if (!yes) {
    return [
      `tmux\tmissing\tinstall with ${plan.manager}`,
      ...plan.steps.map((step) => `tmux\tplan\t${renderStep(step)}`),
      "tmux\tnext\tRun taskmux setup --yes to execute the install plan."
    ];
  }

  for (const step of plan.steps) {
    runner.run(step.command, step.args, { inheritStdio: true });
  }

  if (!hasExecutable(tmuxCommand, ["-V"], runner)) {
    return [
      `tmux\tinvalid\tinstall command completed, but ${tmuxCommand} is still unavailable`,
      `tmux\tmanual\t${plan.manualHint}`
    ];
  }

  return ["tmux\tok\tinstalled"];
}

function detectTmuxInstallPlan(env: NodeJS.ProcessEnv, runner: CommandRunner): InstallPlan | null {
  if (process.platform === "darwin" && commandExists("brew", env, runner)) {
    return {
      manager: "Homebrew",
      steps: [{ command: "brew", args: ["install", "tmux"] }],
      manualHint: "brew install tmux"
    };
  }

  if (process.platform !== "linux") {
    return null;
  }

  if (commandExists("apt-get", env, runner)) {
    const updateStep = withLinuxPrivilege("apt-get", ["update"], env, runner);
    const installStep = withLinuxPrivilege("apt-get", ["install", "-y", "tmux"], env, runner);

    if (updateStep === null || installStep === null) {
      return null;
    }

    return {
      manager: "apt-get",
      steps: [updateStep, installStep],
      manualHint: "sudo apt-get update && sudo apt-get install -y tmux"
    };
  }

  if (commandExists("dnf", env, runner)) {
    const installStep = withLinuxPrivilege("dnf", ["install", "-y", "tmux"], env, runner);

    if (installStep === null) {
      return null;
    }

    return {
      manager: "dnf",
      steps: [installStep],
      manualHint: "sudo dnf install -y tmux"
    };
  }

  if (commandExists("pacman", env, runner)) {
    const installStep = withLinuxPrivilege("pacman", ["-S", "--noconfirm", "tmux"], env, runner);

    if (installStep === null) {
      return null;
    }

    return {
      manager: "pacman",
      steps: [installStep],
      manualHint: "sudo pacman -S --noconfirm tmux"
    };
  }

  if (commandExists("apk", env, runner)) {
    const installStep = withLinuxPrivilege("apk", ["add", "tmux"], env, runner);

    if (installStep === null) {
      return null;
    }

    return {
      manager: "apk",
      steps: [installStep],
      manualHint: "sudo apk add tmux"
    };
  }

  return null;
}

function hasExecutable(command: string, args: string[], runner: CommandRunner): boolean {
  try {
    runner.run(command, args);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command: string, env: NodeJS.ProcessEnv, runner: CommandRunner): boolean {
  if (command.includes("/")) {
    return existsSync(command);
  }

  const pathValue = env.PATH ?? "";
  const pathEntries = pathValue.split(delimiter).filter((entry) => entry.length > 0);

  if (pathEntries.some((entry) => existsSync(join(entry, command)))) {
    return true;
  }

  return hasExecutable(command, ["--version"], runner);
}

function withLinuxPrivilege(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  runner: CommandRunner
): InstallStep | null {
  if (process.getuid?.() === 0) {
    return { command, args };
  }

  if (!commandExists("sudo", env, runner)) {
    return null;
  }

  return { command: "sudo", args: [command, ...args] };
}

function renderStep(step: InstallStep): string {
  return [step.command, ...step.args].join(" ");
}
