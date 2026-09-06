/**
 * Opt-in T00 baseline capture, not a default regression suite.
 * Creates and removes disposable fixtures; never starts an Agent or Controller.
 * Run after make install-local. No caller-supplied Home or cleanup path.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Writable } from "node:stream";
import Database from "better-sqlite3";
import { runSetupCommand } from "../../../../dist/setup/setupCommand.js";
import { createConfiguredAgent } from "../../../../dist/agent/agent.js";
import { createProject } from "../../../../dist/repository/project.js";
import { openCurrentTaskStore } from "../../../../dist/storage/currentTaskStore.js";
import { openAsyncTaskStoreClient } from "../../../../dist/storage/storeRpc.js";
import { runTaskCommand } from "../../../../dist/commands/taskCommands.js";
import { runOperatorCommand } from "../../../../dist/commands/operatorCommands.js";
import { activateTask } from "../../../../dist/task/task.js";
import { createTaskBrief } from "../../../../dist/brief/taskBrief.js";
import { createRole, createRoleAgentBinding } from "../../../../dist/role/role.js";
import { resolveEffectiveLaunch } from "../../../../dist/executor/effectiveLaunch.js";
import { createTurn, completeTurn, failTurn } from "../../../../dist/turn/turn.js";
import { createTurnInput } from "../../../../dist/context/turnInputContract.js";
import { createWorkItem } from "../../../../dist/workItem/workItem.js";
import { createInputRequest } from "../../../../dist/input/inputRequest.js";
import { createDurableJob } from "../../../../dist/job/durableJob.js";
import { builtinAgentDriverRegistry } from "../../../../dist/runtime/builtinAgentDrivers.js";
import { NodeGitWorkspace } from "../../../../dist/repository/gitWorkspace.js";
import { runStorageUpgrade } from "../../../../dist/storage/upgrade/upgradeOrchestrator.js";

const root = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const area = mkdtempSync(join(tmpdir(), "yui-t00-baseline-"));
const home = join(area, "home");
const now = new Date("2026-09-06T00:00:00.000Z");
const report = { scope: "isolated-current-baseline", checks: [], fixtures: [],
  notRun: ["real-provider", "native-UI", "shared-controller", "target-plugin-switch",
    "version-1-to-new-version-migration", "task-9-increment"] };
let store;
let asyncStore;
const check = (name) => report.checks.push(name);
// Do not inherit managed caller identity, credentials, Git configuration, or Home.
const env = { PATH: process.env.PATH, TMPDIR: area, YUI_HOME: home,
  XDG_CONFIG_HOME: join(area, "config"), XDG_CACHE_HOME: join(area, "cache"),
  XDG_DATA_HOME: join(area, "data"), XDG_STATE_HOME: join(area, "state"),
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
// NodeGitWorkspace uses its process environment; sanitize this disposable
// capture process too, not only CLI children. The caller's shell is unchanged.
for (const key of Object.keys(process.env)) {
  if (!Object.hasOwn(env, key)) delete process.env[key];
}
Object.assign(process.env, env);
const cli = (...args) => {
  const result = JSON.parse(execFileSync(join(root, "output/dev/bin/yui"),
    ["--json", ...args], { cwd: root, env, encoding: "utf8", timeout: 15000 }));
  assert.equal(result.ok, true);
  return result.data;
};
try {
  const bin = join(area, "bin");
  mkdirSync(bin);
  // Presence-only setup discovery: this is not a fake provider execution.
  symlinkSync(process.execPath, join(bin, "codex"));
  const setup = await runSetupCommand([], { ...env, PATH: bin },
    { run: (command, args) => {
      assert.deepEqual(args, ["-V"]);
      return "tmux fixture";
    } },
    { input: Readable.from([]), output: new Writable({ write(c, e, done) { done(); } }),
      forceInteractive: true });
  assert.match(setup, /Yui setup complete/);
  report.fixtures.push("setup: fake tmux probe and presence-only Agent discovery");
  store = openCurrentTaskStore(home);
  store.saveConfiguredAgent(createConfiguredAgent("claude", "claude", "claude", [], [], now));
  const repo = join(area, "repo");
  mkdirSync(repo);
  const git = (...args) => execFileSync("git", args,
    { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("-c", "user.name=T00", "-c", "user.email=t00@example.invalid",
    "commit", "--allow-empty", "-m", "disposable baseline");
  const head = git("rev-parse", "HEAD");
  store.saveProject(createProject("project-1", "fixture", repo,
    { stable: "main", development: "main" }, now));
  const options = { now: () => now, environment: {} };
  const draft = runTaskCommand(["create", "T00 draft fixture"], store, options).data.task;
  const activeDraft = runTaskCommand(["create", "T00 active fixture"], store, options).data.task;
  const active = activateTask(activeDraft, now);
  store.saveTask(active);
  report.fixtures.push("Active: domain construction, not CLI activation or Draft chat");
  store.saveTaskBrief(active.id, createTaskBrief({ objective: "Keep exact fixture evidence",
    boundaries: ["Disposable only"], currentFocus: "Read baseline",
    leaderSummary: "No Provider execution", updatedBy: "fixture" }, now));
  const leader = store.getRole(active.id, "leader");
  assert.ok(leader);
  const worker = createRole(active.id, "worker",
    [createRoleAgentBinding({ id: "claude", adapterId: "claude" })],
    "claude", area, now);
  store.saveRole(active.id, worker);
  const work = createWorkItem("work-item-1", active.id, { title: "Fixture responsibility",
    assignee: worker.name }, now);
  store.saveWorkItem(active.id, work);
  for (const [index, role] of [leader, worker].entries()) {
    const turn = createTurn(`turn-${index + 1}`, active.id, role.name, "new",
      createTurnInput({ source: { type: "user", channel: "direct" }, deltaRefIds: [],
        directive: "Offline fixture; no Provider was invoked." }), now,
      { effective: resolveEffectiveLaunch({ role, purpose: "execution" }),
        ...(index === 1 ? { workItemId: work.id } : {}) });
    store.saveTurn(index === 0 ? completeTurn(turn, "T00 retained result", now)
      : failTurn(turn, "runtime-failed", "T00 fixture failure", now));
  }
  report.fixtures.push("Turn: completed Codex Leader / failed Claude Worker, domain constructors");
  runOperatorCommand(["submit", "T00 pending input", "--task", active.id], store, options);
  store.saveInputRequest(active.id, createInputRequest("input-1", active.id,
    { taskId: active.id, roleName: "leader", agentId: leader.activeAgentId, turnId: "turn-1" },
    { question: "Fixture only", choices: [], blockedRefs: [] }, now));
  store.saveDurableJob(active.id, createDurableJob({
    id: "job-1", taskId: active.id, owner: { kind: "task" },
    projectId: "project-1", head, workspace: repo,
    env: {}, steps: [{ name: "not-executed", command: "false" }],
    artifactsLocator: "job-artifacts/job-1"
  }, now));
  report.fixtures.push("pending InputRequest and queued DurableJob: saved, never executed");

  const messagesBefore = store.listMessages(active.id);
  const mailboxBefore = store.getWorkMailbox({ kind: "role", taskId: active.id, roleName: "leader" });
  runTaskCommand(["context", active.id], store, options);
  assert.deepEqual(store.listMessages(active.id), messagesBefore);
  assert.deepEqual(store.getWorkMailbox({ kind: "role", taskId: active.id, roleName: "leader" }),
    mailboxBefore);
  check("Context read preserves Message and mailbox delivery state");

  asyncStore = openAsyncTaskStoreClient(home);
  assert.equal((await asyncStore.getTurn(active.id, "turn-1")).result.output, "T00 retained result");
  const nextBrief = { ...store.getTaskBrief(active.id), currentFocus: "Worker-store write observed" };
  await asyncStore.saveTaskBrief(active.id, nextBrief);
  assert.equal(store.getTaskBrief(active.id).currentFocus, nextBrief.currentFocus);
  await asyncStore.close();
  asyncStore = undefined;
  check("sync Store and persistence-worker share Turn reads and one Brief write");
  store.close();
  store = undefined;
  cli("config", "show");
  cli("operator", "status");
  cli("task", "show", draft.id);
  cli("task", "show", active.id);
  cli("task", "role", "show", active.id, "leader");
  cli("task", "turn", "show", `${active.id}/turn-1`);
  check("absolute local CLI: config, Operator status, Draft/Active, Leader, result reads");

  const drivers = builtinAgentDriverRegistry();
  for (const adapter of ["codex", "claude"]) {
    const driver = drivers.requireByAdapterId(adapter);
    assert.equal(driver.runtime.nativeSessionId({
      hookEventName: "SessionStart", payload: { session_id: "fixture-session" }
    }), "fixture-session");
    const terminal = driver.runtime.mapHook({
      hookEventName: "Stop", payload: { last_assistant_message: "fixture-output" },
      occurrenceId: "fixture-stop"
    });
    const events = Array.isArray(terminal) ? terminal : [terminal];
    assert.ok(events.some((event) => event.kind === "turn.completed"));
  }
  check("Codex/Claude Driver identity and terminal mapping (fixture only)");

  const resource = new NodeGitWorkspace();
  const request = { repositoryPath: repo, container: join(area, "worktrees"),
    taskSegment: "task-1", roleName: "worker", baseRef: "main" };
  const prepared = await resource.ensureWorktree(request);
  assert.equal(prepared.baseCommit, git("rev-parse", "HEAD"));
  assert.equal(await resource.isClean(prepared.path), true);
  await resource.removeWorktree({ ...request, deleteBranch: true });
  check("real disposable Git: prepare, fixed commit, clean inspection, remove");

  assert.equal((await runStorageUpgrade({ home, mode: "dry-run" })).outcome, "already-current");
  assert.equal((await runStorageUpgrade({ home, mode: "execute" })).outcome, "already-current");
  const backup = join(area, "backup.db");
  const db = new Database(join(home, "yui.db"));
  try { await db.backup(backup); } finally { db.close(); }
  const restoredHome = join(area, "restored");
  mkdirSync(restoredHome);
  copyFileSync(backup, join(restoredHome, "yui.db"));
  store = openCurrentTaskStore(restoredHome);
  assert.equal(store.getTask(draft.id).status, "draft");
  assert.equal(store.getTask(active.id).status, "active");
  assert.equal(store.getTurn(active.id, "turn-1").result.output, "T00 retained result");
  assert.equal(store.getTurn(active.id, "turn-2").status, "failed");
  assert.equal(store.listMessages(active.id).length, messagesBefore.length);
  assert.equal(store.listInputRequests(active.id)[0].status, "open");
  assert.equal(store.getDurableJob(active.id, "job-1").status, "queued");
  check("storage v1 no-op upgrade and SQLite backup restored into separate Home");
  console.log(JSON.stringify({ ...report, status: "passed" }, null, 2));
} finally {
  if (asyncStore) await asyncStore.close();
  store?.close();
  // Only the mkdtemp directory created above; never accept a user cleanup target.
  rmSync(area, { recursive: true, force: true });
}
