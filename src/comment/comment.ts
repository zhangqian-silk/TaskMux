export type TaskComment = {
  id: string;
  body: string;
  createdAt: string;
};

export function createTaskComment(id: string, body: string, now: Date): TaskComment {
  const trimmedBody = body.trim();

  if (trimmedBody.length === 0) {
    throw new Error("Comment body is required.");
  }

  return {
    id,
    body: trimmedBody,
    createdAt: now.toISOString()
  };
}
