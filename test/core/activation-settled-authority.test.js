import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteTaskStore } from "../../dist/storage/sqliteStore.js";
import { createTask, MAX_SETTLED_ACTIVATION_REQUESTS } from "../../dist/task/task.js";
import {
  admitStoredTaskActivation,
  cancelTaskActivation,
  requestTaskActivation
} from "../../dist/task/taskActivationService.js";

// F5: a requestId whose outcome was already decided must keep that terminal
// outcome and its stable identity no matter how many later requests were
// recorded. The bounded settled-request payload is a display projection; the
// authority is the durable, never-compacted activation event ledger. These
// tests drive the real public request/cancel/admission path against a real
// SQLite store that is closed and reopened, so the evidence cannot come from a
// live in-memory object that skips persistence.

const now = () => new Date();

function newHome(t) {
  const home = mkdtempSync(join(tmpdir(), "yui-activation-settled-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function requestEmpty(store, requestId) {
  return requestTaskActivation(store, {
    taskId: "task-1",
    requestId,
    actorId: "global:operator",
    authorityRef: "operator-session",
    environmentPlan: { kind: "empty" }
  }, now());
}

test("an evicted cancelled requestId is still refused after a real store reopen", (t) => {
  const home = newHome(t);
  let store = new SqliteTaskStore(home);
  t.after(() => { try { store.close(); } catch { /* already closed */ } });

  store.transaction((tx) => {
    tx.saveTask(createTask("task-1", "F5 authority boundary", now()));
  });

  // Drive the public request/cancel path more times than the bounded display
  // payload can hold, so the earliest ids are the ones eviction drops.
  const overflow = MAX_SETTLED_ACTIVATION_REQUESTS + 2;
  for (let i = 0; i < overflow; i += 1) {
    requestEmpty(store, `req-${i}`);
    cancelTaskActivation(store, "task-1", `req-${i}`, `withdrew ${i}`, now());
  }

  const beforeReopen = store.getTask("task-1").settledActivationRequests ?? [];
  assert.ok(
    beforeReopen.length <= MAX_SETTLED_ACTIVATION_REQUESTS,
    "the display payload must still honour its bounded limit"
  );

  // Reopen: authority must survive a real process boundary, not just live
  // objects that never round-tripped through SQLite.
  store.close();
  store = new SqliteTaskStore(home);

  const evicted = "req-0";
  const stillShown = (store.getTask("task-1").settledActivationRequests ?? [])
    .some(({ operation }) => operation.requestId === evicted);
  assert.equal(stillShown, false, "the earliest cancelled id must have left the display payload");

  // The evicted cancellation must be refused, naming its original outcome, and
  // it must create no new authority.
  assert.throws(
    () => requestEmpty(store, evicted),
    (error) => {
      assert.match(error.message, /already cancelled/, "refusal must name the terminal outcome");
      assert.match(error.message, /withdrew 0/, "the original cancellation reason must survive eviction");
      return true;
    }
  );

  // No side effect: the refused replay must not have seized the live slot or
  // become what admission would adopt.
  const after = store.getTask("task-1");
  assert.equal(after.status, "draft", "the Task stays a continuable Draft");
  assert.equal(
    after.activationRequest?.operation.requestId,
    `req-${overflow - 1}`,
    "the refused replay must not seize the live request slot"
  );
  const admission = admitStoredTaskActivation(store, "task-1");
  assert.ok(
    admission.disposition !== "ready" || admission.request.operation.requestId !== evicted,
    "the evicted cancelled id is never what admission would adopt"
  );
});

test("a still-displayed cancelled id is refused by the same rule (no split behaviour)", (t) => {
  const home = newHome(t);
  const store = new SqliteTaskStore(home);
  t.after(() => store.close());

  store.transaction((tx) => {
    tx.saveTask(createTask("task-1", "F5 authority boundary", now()));
  });
  requestEmpty(store, "req-a");
  cancelTaskActivation(store, "task-1", "req-a", "withdrew a", now());

  // The id still occupies the live slot: it must be refused with exactly the
  // same authority as an evicted one, so eviction is never a behaviour fork.
  assert.throws(
    () => requestEmpty(store, "req-a"),
    (error) => {
      assert.match(error.message, /already cancelled/);
      assert.match(error.message, /withdrew a/);
      return true;
    }
  );
});

test("same requestId with different inputs is rejected; an identical pending replay stays idempotent", (t) => {
  const home = newHome(t);
  const store = new SqliteTaskStore(home);
  t.after(() => store.close());

  store.transaction((tx) => {
    tx.saveTask(createTask("task-1", "F5 authority boundary", now()));
  });

  const first = requestEmpty(store, "req-x");
  assert.equal(first.created, true, "the first request is created");

  // Different inputs under a live pending id is a conflict, not a resurrection:
  // the pre-existing contract must not regress.
  assert.throws(
    () => requestTaskActivation(store, {
      taskId: "task-1",
      requestId: "req-x",
      actorId: "global:operator",
      authorityRef: "operator-session",
      environmentPlan: { kind: "scratch" }
    }, now()),
    /already used for different inputs/
  );

  // An identical replay of the still-pending request is idempotent: the same
  // operation ref, not a second activation.
  const replay = requestEmpty(store, "req-x");
  assert.equal(replay.created, false, "an identical pending replay is not re-created");
  assert.equal(replay.operationRef, first.operationRef, "it returns the same operation ref");
});
