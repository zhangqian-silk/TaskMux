export type TaskStatus = "open" | "active" | "done" | "archived";

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
};

export function createTask(id: string, title: string, now: Date): Task {
  const trimmedTitle = title.trim();

  if (trimmedTitle.length === 0) {
    throw new Error("Task title is required.");
  }

  const timestamp = now.toISOString();

  return {
    id,
    title: trimmedTitle,
    status: "open",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
