import { mkdirSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") {
  throw new Error("Yui's native process owner requires Linux.");
}
const output = fileURLToPath(new URL("../dist/runtime/", import.meta.url));
mkdirSync(output, { recursive: true });
const target = output + "claude-process-owner";
execFileSync(process.env.CC ?? "cc", [
  "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-static",
  fileURLToPath(new URL("../native/claude-process-owner.c", import.meta.url)),
  "-o", target + ".building"
], { stdio: "inherit" });
renameSync(target + ".building", target);
