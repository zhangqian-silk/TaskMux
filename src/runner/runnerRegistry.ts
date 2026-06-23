import type { CustomRunner, RunnerDefinition } from "./runner.js";
import { customRunnerToDefinition } from "./runner.js";

export type RunnerId = "codex" | "claude";

const RUNNERS: RunnerDefinition[] = [
  { id: "codex", command: "codex", args: [], env: {}, source: "builtin" },
  { id: "claude", command: "claude", args: [], env: {}, source: "builtin" }
];

export function resolveRunner(id: string, customRunners: CustomRunner[] = []): RunnerDefinition | null {
  return listRunnerDefinitions(customRunners).find((runner) => runner.id === id) ?? null;
}

export function listRunnerDefinitions(customRunners: CustomRunner[] = []): RunnerDefinition[] {
  return [
    ...RUNNERS,
    ...customRunners.map((runner) => customRunnerToDefinition(runner))
  ];
}

export function supportedRunnerIds(customRunners: CustomRunner[] = []): string[] {
  return listRunnerDefinitions(customRunners).map((runner) => runner.id);
}

export function isBuiltinRunnerId(id: string): boolean {
  return RUNNERS.some((runner) => runner.id === id);
}
