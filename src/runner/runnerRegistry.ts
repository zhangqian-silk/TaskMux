export type RunnerId = "codex" | "claude";

export type RunnerDefinition = {
  id: RunnerId;
  command: string;
};

const RUNNERS: RunnerDefinition[] = [
  { id: "codex", command: "codex" },
  { id: "claude", command: "claude" }
];

export function resolveRunner(id: string): RunnerDefinition | null {
  return RUNNERS.find((runner) => runner.id === id) ?? null;
}

export function supportedRunnerIds(): string[] {
  return RUNNERS.map((runner) => runner.id);
}
