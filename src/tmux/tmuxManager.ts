import type { Role } from "../role/role.js";
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
      role.agent
    ]);
  }

  private sessionName(taskId: string): string {
    return `taskmux-${taskId}`;
  }

  private target(taskId: string, roleName: string): string {
    return `${this.sessionName(taskId)}:${roleName}`;
  }
}
