import type { CustomRunner, RunnerDefinition } from "./runner.js";
import { customRunnerToDefinition } from "./runner.js";

export function resolveRunner(id: string, customRunners: CustomRunner[] = []): RunnerDefinition | null {
  return listRunnerDefinitions(customRunners).find((runner) => runner.id === id) ?? null;
}

export function listRunnerDefinitions(customRunners: CustomRunner[] = []): RunnerDefinition[] {
  return customRunners.map((runner) => customRunnerToDefinition(runner));
}

export function supportedRunnerIds(customRunners: CustomRunner[] = []): string[] {
  return listRunnerDefinitions(customRunners).map((runner) => runner.id);
}
