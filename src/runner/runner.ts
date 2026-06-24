export type RunnerEnvironment = Record<string, string>;

export type CustomRunner = {
  schemaVersion: 1;
  id: string;
  command: string;
  args: string[];
  env: RunnerEnvironment;
  createdAt: string;
  updatedAt: string;
};

export type RunnerDefinition = {
  id: string;
  command: string;
  args: string[];
  env: RunnerEnvironment;
  source: "builtin" | "custom";
};

export function createCustomRunner(
  id: string,
  command: string,
  args: string[],
  env: RunnerEnvironment,
  now: Date
): CustomRunner {
  const trimmedId = id.trim();
  const trimmedCommand = command.trim();
  const timestamp = now.toISOString();

  if (trimmedId.length === 0) {
    throw new Error("Runner id is required.");
  }

  if (trimmedCommand.length === 0) {
    throw new Error("Runner command is required.");
  }

  return {
    schemaVersion: 1,
    id: trimmedId,
    command: trimmedCommand,
    args,
    env,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function customRunnerToDefinition(runner: CustomRunner): RunnerDefinition {
  return {
    id: runner.id,
    command: runner.command,
    args: runner.args,
    env: runner.env,
    source: "custom"
  };
}
