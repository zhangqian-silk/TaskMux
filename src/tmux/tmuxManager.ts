import type { Role } from "../role/role.js";
import type { RoleStatus } from "../role/role.js";
import type { CommandRunner } from "./commandRunner.js";

export class TmuxManager {
  constructor(
    private readonly tmuxBin: string,
    private readonly runner: CommandRunner
  ) {}

  enterRole(taskId: string, role: Role): void {
    this.ensureSession(taskId);
    this.ensureWindow(taskId, role);
    this.runner.run(this.tmuxBin, ["attach-session", "-t", this.target(taskId, role.name)], {
      inheritStdio: true
    });
  }

  captureRole(taskId: string, roleName: string, lines = 80): string {
    return this.runner.run(this.tmuxBin, [
      "capture-pane",
      "-p",
      "-t",
      this.target(taskId, roleName),
      "-S",
      `-${lines}`
    ]);
  }

  detachRole(taskId: string): void {
    this.runner.run(this.tmuxBin, ["detach-client", "-s", this.sessionName(taskId)]);
  }

  restartRole(taskId: string, role: Role): void {
    try {
      this.killRole(taskId, role.name);
    } catch {
      // Restart must recover even when the old window is already gone.
    }

    this.enterRole(taskId, role);
  }

  detectRoleStatus(taskId: string, roleName: string, fallback: RoleStatus): RoleStatus {
    try {
      const windows = this.runner.run(this.tmuxBin, [
        "list-windows",
        "-t",
        this.sessionName(taskId),
        "-F",
        "#{window_name}"
      ]);

      return windows.split("\n").includes(roleName) ? "running" : "exited";
    } catch {
      return fallback;
    }
  }

  stopRole(taskId: string, roleName: string): void {
    this.runner.run(this.tmuxBin, ["send-keys", "-t", this.target(taskId, roleName), "C-c"]);
  }

  killRole(taskId: string, roleName: string): void {
    this.runner.run(this.tmuxBin, ["kill-window", "-t", this.target(taskId, roleName)]);
  }

  private ensureSession(taskId: string): void {
    try {
      this.runner.run(this.tmuxBin, ["has-session", "-t", this.sessionName(taskId)]);
      return;
    } catch {
      this.runner.run(this.tmuxBin, ["new-session", "-d", "-s", this.sessionName(taskId)]);
    }
  }

  private ensureWindow(taskId: string, role: Role): void {
    const windows = this.runner.run(this.tmuxBin, [
      "list-windows",
      "-t",
      this.sessionName(taskId),
      "-F",
      "#{window_name}"
    ]);

    if (windows.split("\n").includes(role.name)) {
      return;
    }

    this.runner.run(this.tmuxBin, [
      "new-window",
      "-t",
      this.sessionName(taskId),
      "-n",
      role.name,
      "-c",
      role.workspace,
      roleShellCommand(role)
    ]);
  }

  private sessionName(taskId: string): string {
    return `taskmux-${taskId}`;
  }

  private target(taskId: string, roleName: string): string {
    return `${this.sessionName(taskId)}:${roleName}`;
  }
}

function roleShellCommand(role: Role): string {
  const env = Object.entries(role.env).map(([key, value]) => `${key}=${value}`);
  const parts = env.length > 0 ? ["env", ...env, role.command, ...role.args] : [role.command, ...role.args];

  return parts.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
