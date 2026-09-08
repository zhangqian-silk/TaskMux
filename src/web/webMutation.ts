import type { TaskStore } from "../storage/taskStore.js";

export class WebRequestRejected extends Error {
  readonly disposition = "not-submitted";
}

/** For Store-only mutations with notifications excluded: an exception from
 * the callback, propagated unchanged after rollback, proves non-submission.
 * Commit/rollback failures and post-commit notifications remain unknown. */
export function webLocalMutation<T>(store: TaskStore, apply: (store: TaskStore) => T): T {
  let rejected = false;
  let callbackError: unknown;
  try { return store.transaction((tx) => {
    try { return apply(tx); }
    catch (error) { rejected = true; callbackError = error; throw error; }
  }); }
  catch (error) {
    if (rejected && error === callbackError) {
      throw new WebRequestRejected(error instanceof Error ? error.message : "Mutation rejected.");
    }
    throw error;
  }
}
