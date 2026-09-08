import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteTaskStore } from "../../dist/storage/sqliteStore.js";
import { createTask, activateTask } from "../../dist/task/task.js";
import { createGlobalRole, createRoleAgentBinding } from "../../dist/role/role.js";
import { createRoleSessionSet, recordRoleAgentSession } from "../../dist/executor/agentExecutor.js";
import { resolveEffectiveLaunch } from "../../dist/executor/effectiveLaunch.js";
import { createBuiltinCapabilities } from "../../dist/kernel/builtinCapabilities.js";
import { createCapabilityDispatcher } from "../../dist/controller/capabilityBridge.js";
import { createDurableJobControl } from "../../dist/controller/jobControl.js";
import { InstanceHost } from "../../dist/kernel/instanceHost.js";

// One primary product path. Fault injection, trust-boundary matrices and
// performance regressions remain change-specific development evidence.
test("an independent declarative plugin follows the authenticated lifecycle and persists its selection", async () => {
  const home = mkdtempSync(join(tmpdir(), "yui-plugin-smoke-"));
  const store = new SqliteTaskStore(home);
  const host = new InstanceHost();
  try {
    const now = new Date();
    const task = activateTask(createTask("task-1", "Plugin smoke", now), now);
    store.saveTask(task);
    const binding = createRoleAgentBinding({ id: "codex", adapterId: "codex" });
    const role = createGlobalRole("operator", [binding], binding.agentId, home, now);
    store.saveGlobalRole(role);
    store.saveGlobalRoleSessionSet(recordRoleAgentSession(
      createRoleSessionSet({ scope: "global", roleName: "operator" }, binding.agentId, now),
      { agentId: binding.agentId, adapterId: binding.adapterId, nativeSessionId: "plugin-smoke-session",
        policy: "fixed", status: "active", effective: resolveEffectiveLaunch({ role, purpose: "execution" }) }, now));
    const dispatch = createCapabilityDispatcher(createBuiltinCapabilities(host, store, createDurableJobControl(store)));
    let sequence = 0;
    const call = async (name, input) => {
      const result = await dispatch("capability.call", {
        taskId: task.id,
        caller: { scope: "global", role: "operator", nativeSessionId: "plugin-smoke-session" },
        request: { name, input, requestId: `smoke-${++sequence}` }
      });
      assert.equal(result.kind, "value", JSON.stringify(result));
      return result.value;
    };
    const prepared = await call("environment.prepare", { taskId: task.id, plan: { kind: "scratch" } });
    await call("environment.adopt", { taskId: task.id, preparationId: prepared.id });
    const created = await call("plugin.create", { preparationId: prepared.id, id: "demo", kind: "declarative" });
    const report = await call("plugin.validate", { preparationId: prepared.id, directory: created.directory });
    await call("plugin.activate", { validationId: report.id });
    assert.deepEqual(await call("demo.echo", { text: "hello" }), { text: "hello" });
    const current = await call("plugin.inspect", { id: "demo" });
    assert.equal(current.desired.validationId, report.id);
    assert.equal(current.actual.validationId, report.id);
    assert.equal((await call("plugin.disable", { id: "demo" })).drained, true);
    await host.close();
    store.close();
    const reopened = new SqliteTaskStore(home);
    try {
      assert.equal(reopened.getPluginIntent(task.id, "demo").enabled, false);
      assert.equal(reopened.getPluginValidation(task.id, report.id).package.digest, report.package.digest);
    } finally { reopened.close(); }
  } finally {
    await host.close();
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
