export type TaskEventPayload = Record<string, string>;

export type TaskEvent = {
  schemaVersion: 1;
  id: string;
  type: string;
  payload: TaskEventPayload;
  createdAt: string;
};

export function createTaskEvent(
  id: string,
  type: string,
  payload: TaskEventPayload,
  now: Date
): TaskEvent {
  return {
    schemaVersion: 1,
    id,
    type,
    payload,
    createdAt: now.toISOString()
  };
}
