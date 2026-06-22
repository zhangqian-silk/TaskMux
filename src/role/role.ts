export type RoleStatus = "idle" | "running" | "detached" | "exited" | "failed";

export type Role = {
  name: string;
  agent: string;
  workspace: string;
  status: RoleStatus;
  createdAt: string;
  updatedAt: string;
};

export function createRole(name: string, agent: string, workspace: string, now: Date): Role {
  const trimmedName = name.trim();
  const trimmedAgent = agent.trim();
  const trimmedWorkspace = workspace.trim();

  if (trimmedName.length === 0) {
    throw new Error("Role name is required.");
  }

  if (trimmedAgent.length === 0) {
    throw new Error("Role agent is required.");
  }

  if (trimmedWorkspace.length === 0) {
    throw new Error("Role workspace is required.");
  }

  const timestamp = now.toISOString();

  return {
    name: trimmedName,
    agent: trimmedAgent,
    workspace: trimmedWorkspace,
    status: "idle",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
