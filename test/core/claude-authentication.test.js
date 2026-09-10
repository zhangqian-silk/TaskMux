import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteTaskStore } from "../../dist/storage/sqliteStore.js";
import { createConfiguredAgent } from "../../dist/agent/agent.js";
import { createGlobalRole, createRoleAgentBinding, updateGlobalRole } from "../../dist/role/role.js";
import { FileRoleLaunchPlanner } from "../../dist/executor/fileRoleLaunchPlanner.js";
import { nativeAgentEnvironmentNames, operationalAgentEnvironment } from "../../dist/agent/launchEnvironment.js";
import { refreshRunningFileTaskControllerEnvironment } from "../../dist/controller/clientRuntime.js";

const at = new Date("2026-09-11T00:00:00Z");
function fixture(t, environment = {}, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "yui-claude-auth-"));
  const home = join(root, "yui"), native = join(root, "claude"), workspace = join(root, "workspace");
  for (const directory of [native, workspace]) mkdirSync(directory, { recursive: true });
  const store = new SqliteTaskStore(home);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const agent = createConfiguredAgent("claude", "claude", "/fixture/claude", [], [], at);
  store.saveConfiguredAgent(agent);
  const role = createGlobalRole("operator", [createRoleAgentBinding(agent, {
    adapterId: "claude", permission: { strategy: "bypass" }, ...config
  })], agent.id, workspace, at);
  store.saveGlobalRole(role);
  const env = { PATH: process.env.PATH, HOME: join(root, "user"), CLAUDE_CONFIG_DIR: native, ...environment };
  const planner = new FileRoleLaunchPlanner(home, store, { environment: env });
  const plan = () => planner.planGlobalRole({
    roleName: "operator", agentId: "claude", adapterId: "claude", mode: "new"
  });
  return { root, home, native, workspace, store, env, planner, plan };
}
test("Claude receives native authentication inputs without selecting credentials or leaking them to other drivers", t => {
  const key = "fixture-only-api-key";
  const f = fixture(t, { ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: "https://gateway.invalid" });
  const prefs = join(f.native, ".claude.json");
  const original = JSON.stringify({ hasCompletedOnboarding: false, customApiKeyResponses: { approved: [], rejected: [] } });
  writeFileSync(prefs, original);
  const plan = f.plan();
  assert.equal(plan.launch.env.ANTHROPIC_API_KEY, key);
  assert.equal(plan.launch.env.ANTHROPIC_BASE_URL, "https://gateway.invalid");
  assert.equal(plan.launch.env.HOME, f.env.HOME);
  assert.equal(plan.launch.env.CLAUDE_CONFIG_DIR, f.native);
  assert.equal(plan.launch.args.includes("--settings"), false);
  assert.ok(!JSON.stringify(plan.launch.args).includes(key));
  assert.ok(!JSON.stringify(plan.session?.effective).includes(key));
  assert.equal(readFileSync(prefs, "utf8"), original);
  assert.equal(operationalAgentEnvironment("codex", f.env).ANTHROPIC_API_KEY, undefined);
  assert.equal(operationalAgentEnvironment("acp", f.env).ANTHROPIC_API_KEY, undefined);
  f.planner.refreshAgentEnvironment({
    sourceNames: [], sources: {}, nativeNames: nativeAgentEnvironmentNames("claude"),
    nativeSources: { CLAUDE_CONFIG_DIR: f.native }
  });
  const revoked = f.plan();
  assert.equal(revoked.launch.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(revoked.launch.args.includes("--settings"), false);
});

test("Claude owns native settings and explicit settings paths without Yui authentication overlays", t => {
  const f = fixture(t);
  const path = join(f.native, "settings.json");
  const configured = { env: { ANTHROPIC_API_KEY: "user-file-key", ANTHROPIC_BASE_URL: "https://file.invalid" } };
  writeFileSync(path, JSON.stringify(configured));
  const plan = f.plan();
  assert.equal(plan.launch.args.includes("--settings"), false);
  assert.equal(plan.launch.env.ANTHROPIC_API_KEY, undefined, "Native file values are loaded by Claude, not copied by Yui.");
  assert.equal(readFileSync(path, "utf8"), JSON.stringify(configured));
  assert.equal(existsSync(join(f.native, ".claude.json")), false);
  for (const explicit of [
    { apiKeyHelper: "/existing/helper" },
    { forceLoginMethod: "claudeai" },
    { env: { ...configured.env, ANTHROPIC_AUTH_TOKEN: "existing-bearer" } },
    { env: { ...configured.env, CLAUDE_CODE_USE_BEDROCK: "1" } }
  ]) {
    writeFileSync(path, JSON.stringify({ ...configured, ...explicit }));
    assert.equal(f.plan().launch.args.includes("--settings"), false);
  }
  writeFileSync(path, "{}");
  mkdirSync(join(f.workspace, ".claude"));
  writeFileSync(join(f.workspace, ".claude", "settings.json"), JSON.stringify(configured));
  assert.equal(f.plan().launch.args.includes("--settings"), false, "Repository content must not nominate credentials.");

  const explicit = join(f.root, "explicit.json");
  const contents = JSON.stringify({ env: { ANTHROPIC_API_KEY: "explicit-file-key" }, language: "English" });
  writeFileSync(explicit, contents, { mode: 0o600 });
  const role = f.store.getGlobalRole("operator");
  f.store.saveGlobalRole(updateGlobalRole(role, { agentBindings: {
    claude: { ...role.agentBindings.claude, config: {
      ...role.agentBindings.claude.config, settingsFile: explicit, settingsSources: ["project"]
    } }
  } }, at));
  writeFileSync(path, JSON.stringify({ apiKeyHelper: "/disabled-user-source/helper" }));
  const selected = f.plan();
  assert.equal(selected.launch.args[selected.launch.args.indexOf("--settings") + 1], explicit);
  assert.equal(selected.launch.args[selected.launch.args.indexOf("--setting-sources") + 1], "project");
  assert.equal(existsSync(join(f.home, "runtime", "claude-auth")), false);
  assert.ok(!JSON.stringify(selected.launch.args).includes("explicit-file-key"));
  assert.equal(readFileSync(explicit, "utf8"), contents);
});

test("Claude credential environment refresh is scoped and does not persist secret values", async t => {
  const f = fixture(t);
  let request;
  const source = { ...f.env, ANTHROPIC_API_KEY: "ephemeral-key", OPENAI_API_KEY: "other-agent-secret" };
  await refreshRunningFileTaskControllerEnvironment(f.home, f.store, source, {
    call: async (_home, method, params) => { request = { method, params }; return {}; }
  });
  assert.equal(request.params.nativeSources.ANTHROPIC_API_KEY, "ephemeral-key");
  assert.equal(request.params.nativeSources.OPENAI_API_KEY, undefined);
  assert.ok(!JSON.stringify(f.store.getConfiguredAgent("claude")).includes("ephemeral-key"));
  assert.ok(!JSON.stringify(f.store.getGlobalRole("operator")).includes("ephemeral-key"));
  assert.equal(statSync(join(f.home, "yui.db")).isFile(), true);
});
