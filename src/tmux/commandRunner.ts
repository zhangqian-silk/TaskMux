import { execFileSync } from "node:child_process";

export type CommandRunOptions = {
  inheritStdio?: boolean;
};

export type CommandRunner = {
  run(command: string, args: string[], options?: CommandRunOptions): string;
};

export class NodeCommandRunner implements CommandRunner {
  run(command: string, args: string[], options: CommandRunOptions = {}): string {
    if (options.inheritStdio === true) {
      execFileSync(command, args, { stdio: "inherit" });
      return "";
    }

    return execFileSync(command, args, { encoding: "utf8" });
  }
}
