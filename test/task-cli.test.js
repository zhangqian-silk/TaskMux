import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const cli = join(process.cwd(), "dist", "cli.js");

function runTaskmux(args, env) {
  return execFileSync("node", [cli, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
}

function runTaskmuxFailure(args, env) {
  return spawnSync("node", [cli, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
}

function runTaskmuxInteractive(args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [cli, ...args], {
      env: {
        ...process.env,
        ...env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`taskmux exited with ${code}: ${stderr}`));
        return;
      }

      resolve(stdout);
    });

    child.stdin.end(input);
  });
}

function createFakeTmux(home) {
  const fakeTmux = join(home, "fake-tmux.js");
  const logFile = join(home, "tmux-calls.jsonl");

  writeFileSync(
    fakeTmux,
    `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_TMUX_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "has-session") process.exit(1);
if (args[0] === "list-windows") process.exit(0);
if (args[0] === "capture-pane") {
  process.stdout.write("recent reviewer output\\n");
  process.exit(0);
}
process.exit(0);
`
  );
  chmodSync(fakeTmux, 0o755);

  return { fakeTmux, logFile };
}

function createStatusTmux(home) {
  const fakeTmux = join(home, "fake-status-tmux.js");

  writeFileSync(
    fakeTmux,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "list-windows") {
  process.stdout.write("rd\\n");
  process.exit(0);
}
process.exit(0);
`
  );
  chmodSync(fakeTmux, 0o755);

  return fakeTmux;
}

function createFakeExecutable(home, name, output) {
  const executable = join(home, name);

  writeFileSync(
    executable,
    `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(output)});
`
  );
  chmodSync(executable, 0o755);

  return executable;
}

function writeStorageSchema(home, storageVersion) {
  writeFileSync(
    join(home, "schema.json"),
    JSON.stringify({
      schemaVersion: 1,
      storageVersion,
      updatedAt: "2026-06-24T00:00:00.000Z"
    })
  );
}

test("creates a task in the configured taskmux home", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  const output = runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });

  assert.match(output, /Created task task-1/);
  assert.match(output, /Refactor login page/);

  const task = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "task.json"), "utf8")
  );
  const taskInfo = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "info.json"), "utf8")
  );

  assert.equal(task.schemaVersion, 1);
  assert.equal(task.id, "task-1");
  assert.equal(task.status, "open");
  assert.equal(task.title, undefined);
  assert.equal(taskInfo.schemaVersion, 1);
  assert.equal(taskInfo.title, "Refactor login page");
});

test("initializes the latest storage schema manifest on first startup", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });

  const schema = JSON.parse(readFileSync(join(home, "schema.json"), "utf8"));

  assert.equal(schema.schemaVersion, 1);
  assert.equal(schema.storageVersion, 1);
  assert.equal(typeof schema.updatedAt, "string");
});

test("blocks normal commands when storage schema requires migration", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  writeStorageSchema(home, 0);

  const result = runTaskmuxFailure(["task", "list"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Storage schema upgrade required: 0 -> 1/);
  assert.match(result.stderr, /Run `taskmux migrate`/);
});

test("migrates storage schema to the latest version", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  writeStorageSchema(home, 0);

  const output = runTaskmux(["migrate"], {
    TASKMUX_HOME: home
  });
  const schema = JSON.parse(readFileSync(join(home, "schema.json"), "utf8"));

  assert.match(output, /Migrated storage schema 0 -> 1/);
  assert.equal(schema.schemaVersion, 1);
  assert.equal(schema.storageVersion, 1);
  assert.equal(typeof schema.updatedAt, "string");
  assert.match(
    runTaskmux(["task", "list"], { TASKMUX_HOME: home }),
    /No tasks found/
  );
});

test("reads edited task info from the user-editable info file", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  writeFileSync(
    join(home, "tasks", "task-1", "info.json"),
    JSON.stringify({ schemaVersion: 1, title: "Edited task title" })
  );

  const showOutput = runTaskmux(["task", "show", "task-1"], {
    TASKMUX_HOME: home
  });
  const listOutput = runTaskmux(["task", "list"], {
    TASKMUX_HOME: home
  });

  assert.match(showOutput, /Title: Edited task title/);
  assert.match(listOutput, /task-1\s+open\s+Edited task title/);
});

test("rejects task records with inline titles", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const taskDir = join(home, "tasks", "task-1");
  execFileSync("mkdir", ["-p", taskDir]);
  writeFileSync(
    join(taskDir, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "task-1",
      title: "Legacy task title",
      status: "open",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    })
  );

  const result = runTaskmuxFailure(["task", "show", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid task record: task-1/);
});

test("rejects task records missing editable task info", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const taskDir = join(home, "tasks", "task-1");
  execFileSync("mkdir", ["-p", taskDir]);
  writeFileSync(
    join(taskDir, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "task-1",
      status: "open",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    })
  );

  const result = runTaskmuxFailure(["task", "show", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid task info record: task-1/);
});

test("lists tasks from the configured taskmux home", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "First task"], { TASKMUX_HOME: home });
  runTaskmux(["task", "create", "Second task"], { TASKMUX_HOME: home });

  const output = runTaskmux(["task", "list"], { TASKMUX_HOME: home });

  assert.match(output, /task-1\s+open\s+First task/);
  assert.match(output, /task-2\s+open\s+Second task/);
});

test("shows a task by id", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Review checkout flow"], {
    TASKMUX_HOME: home
  });

  const output = runTaskmux(["task", "show", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.match(output, /Task: task-1/);
  assert.match(output, /Title: Review checkout flow/);
  assert.match(output, /Status: open/);
});

test("updates task lifecycle status", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Review checkout flow"], {
    TASKMUX_HOME: home
  });

  assert.match(
    runTaskmux(["task", "start", "task-1"], { TASKMUX_HOME: home }),
    /Started task task-1/
  );
  assert.match(
    runTaskmux(["task", "done", "task-1"], { TASKMUX_HOME: home }),
    /Completed task task-1/
  );
  assert.match(
    runTaskmux(["task", "archive", "task-1"], { TASKMUX_HOME: home }),
    /Archived task task-1/
  );
  assert.match(
    runTaskmux(["task", "reopen", "task-1"], { TASKMUX_HOME: home }),
    /Reopened task task-1/
  );

  const task = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "task.json"), "utf8")
  );
  assert.equal(task.status, "open");
});

test("assigns a role to an existing task", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });

  const output = runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  assert.match(output, /Assigned role rd to task-1/);
  assert.match(output, /Agent: codex/);
  assert.match(output, /Workspace: \/tmp\/project-a/);

  const role = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  const roleInfo = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "info.json"), "utf8")
  );

  assert.equal(role.schemaVersion, 1);
  assert.equal(role.name, undefined);
  assert.equal(role.agent, "codex");
  assert.equal(role.workspace, "/tmp/project-a");
  assert.equal(role.status, "idle");
  assert.equal(roleInfo.schemaVersion, 1);
  assert.equal(roleInfo.name, "rd");
});

test("reads edited role info from the user-editable info file", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );
  writeFileSync(
    join(home, "tasks", "task-1", "roles", "rd", "info.json"),
    JSON.stringify({ schemaVersion: 1, name: "engineer" })
  );

  const rolesOutput = runTaskmux(["task", "roles", "task-1"], {
    TASKMUX_HOME: home
  });
  const detailOutput = runTaskmux(["task", "detail", "task-1", "engineer"], {
    TASKMUX_HOME: home
  });

  assert.match(rolesOutput, /engineer\s+codex\s+idle\s+\/tmp\/project-a/);
  assert.match(detailOutput, /Role: engineer/);
});

test("rejects role records with inline names", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const taskDir = join(home, "tasks", "task-1");
  const roleDir = join(taskDir, "roles", "rd");
  execFileSync("mkdir", ["-p", roleDir]);
  writeFileSync(
    join(taskDir, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "task-1",
      status: "open",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    })
  );
  writeFileSync(
    join(taskDir, "info.json"),
    JSON.stringify({
      schemaVersion: 1,
      title: "Current task title"
    })
  );
  writeFileSync(
    join(roleDir, "role.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "rd",
      agent: "codex",
      workspace: "/tmp/project-a",
      status: "idle",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    })
  );

  const result = runTaskmuxFailure(["task", "detail", "task-1", "rd"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid role record: rd/);
});

test("rejects role records missing editable role info", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const taskDir = join(home, "tasks", "task-1");
  const roleDir = join(taskDir, "roles", "rd");
  execFileSync("mkdir", ["-p", roleDir]);
  writeFileSync(
    join(taskDir, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "task-1",
      status: "open",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    })
  );
  writeFileSync(
    join(taskDir, "info.json"),
    JSON.stringify({
      schemaVersion: 1,
      title: "Current task title"
    })
  );
  writeFileSync(
    join(roleDir, "role.json"),
    JSON.stringify({
      schemaVersion: 1,
      agent: "codex",
      command: "codex",
      args: [],
      env: {},
      workspace: "/tmp/project-a",
      status: "idle",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    })
  );

  const result = runTaskmuxFailure(["task", "detail", "task-1", "rd"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid role info record: rd/);
});

test("rejects role records missing command contract", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const taskDir = join(home, "tasks", "task-1");
  const roleDir = join(taskDir, "roles", "rd");
  execFileSync("mkdir", ["-p", roleDir]);
  writeFileSync(
    join(taskDir, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "task-1",
      status: "open",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    })
  );
  writeFileSync(
    join(taskDir, "info.json"),
    JSON.stringify({
      schemaVersion: 1,
      title: "Current task title"
    })
  );
  writeFileSync(
    join(roleDir, "role.json"),
    JSON.stringify({
      schemaVersion: 1,
      agent: "codex",
      workspace: "/tmp/project-a",
      status: "idle",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    })
  );
  writeFileSync(
    join(roleDir, "info.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "rd"
    })
  );

  const result = runTaskmuxFailure(["task", "detail", "task-1", "rd"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid role record: rd/);
});

test("rejects unsupported role agents", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });

  const result = runTaskmuxFailure(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "unknown",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /USAGE_ERROR: Unsupported agent: unknown/);
  assert.match(result.stderr, /Supported agents: codex, claude/);
});

test("returns a usage exit code for unsupported agents", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });

  const result = runTaskmuxFailure(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "unknown",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /USAGE_ERROR: Unsupported agent: unknown/);
});

test("lists roles for a task", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "reviewer",
      "--agent",
      "claude",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "roles", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.match(output, /rd\s+codex\s+idle\s+\/tmp\/project-a/);
  assert.match(output, /reviewer\s+claude\s+idle\s+\/tmp\/project-a/);
});

test("enters a role through tmux without requiring real tmux", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const { fakeTmux, logFile } = createFakeTmux(home);

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "enter", "task-1", "rd"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  assert.match(output, /Attached role rd for task-1/);

  const calls = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.deepEqual(calls[0], ["has-session", "-t", "taskmux-task-1"]);
  assert.deepEqual(calls[1], ["new-session", "-d", "-s", "taskmux-task-1"]);
  assert.deepEqual(calls[2], ["list-windows", "-t", "taskmux-task-1", "-F", "#{window_name}"]);
  assert.deepEqual(calls[3], [
    "new-window",
    "-t",
    "taskmux-task-1",
    "-n",
    "rd",
    "-c",
    "/tmp/project-a",
    "codex"
  ]);
  assert.deepEqual(calls[4], ["attach-session", "-t", "taskmux-task-1:rd"]);

  const role = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  assert.equal(role.status, "running");
});

test("tails role output through tmux capture-pane", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const { fakeTmux, logFile } = createFakeTmux(home);

  runTaskmux(["task", "create", "Review checkout flow"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "reviewer",
      "--agent",
      "claude",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "tail", "task-1", "reviewer"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  assert.match(output, /recent reviewer output/);

  const calls = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.deepEqual(calls[0], [
    "capture-pane",
    "-p",
    "-t",
    "taskmux-task-1:reviewer",
    "-S",
    "-80"
  ]);
});

test("shows role detail for a task", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "detail", "task-1", "rd"], {
    TASKMUX_HOME: home
  });

  assert.match(output, /Task: task-1/);
  assert.match(output, /Role: rd/);
  assert.match(output, /Agent: codex/);
  assert.match(output, /Workspace: \/tmp\/project-a/);
  assert.match(output, /Status: idle/);
  assert.match(output, /Tmux: taskmux-task-1:rd/);
});

test("reads role transcript through tmux capture-pane", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const { fakeTmux, logFile } = createFakeTmux(home);

  runTaskmux(["task", "create", "Review checkout flow"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "reviewer",
      "--agent",
      "claude",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "transcript", "task-1", "reviewer"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  assert.match(output, /recent reviewer output/);
  assert.match(
    readFileSync(
      join(home, "tasks", "task-1", "roles", "reviewer", "transcript.log"),
      "utf8"
    ),
    /recent reviewer output/
  );
}
);

test("opens a task context summary", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );
  runTaskmux(["task", "comment", "task-1", "Keep old session compatibility."], {
    TASKMUX_HOME: home
  });

  const output = runTaskmux(["task", "open", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.match(output, /Task: task-1/);
  assert.match(output, /Title: Refactor login page/);
  assert.match(output, /Roles: 1/);
  assert.match(output, /Comments: 1/);
  assert.match(output, /Next: taskmux task enter task-1 <role>/);
});

test("detaches a task role through tmux", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const { fakeTmux, logFile } = createFakeTmux(home);

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "detach", "task-1", "rd"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  assert.match(output, /Detached role rd for task-1/);

  const calls = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.deepEqual(calls[0], ["detach-client", "-s", "taskmux-task-1"]);

  const role = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  assert.equal(role.status, "detached");
});

test("shows role status", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "status", "task-1", "rd"], {
    TASKMUX_HOME: home
  });

  assert.match(output, /Role: rd/);
  assert.match(output, /Status: idle/);
  assert.match(output, /Tmux: taskmux-task-1:rd/);
});

test("detects running role status from tmux", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const fakeTmux = createStatusTmux(home);

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "status", "task-1", "rd"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux
  });

  assert.match(output, /Status: running/);

  const role = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  assert.equal(role.status, "running");
});

test("detects exited role status when tmux window is absent", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const { fakeTmux, logFile } = createFakeTmux(home);

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "status", "task-1", "rd"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  assert.match(output, /Status: exited/);

  const role = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  assert.equal(role.status, "exited");
});

test("refreshes every role status for a task", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const fakeTmux = createStatusTmux(home);

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "reviewer",
      "--agent",
      "claude",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "refresh", "task-1"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux
  });

  assert.match(output, /Refreshed task task-1 roles/);
  assert.match(output, /rd\s+running/);
  assert.match(output, /reviewer\s+exited/);

  const rd = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  const reviewer = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "reviewer", "role.json"), "utf8")
  );
  assert.equal(rd.status, "running");
  assert.equal(reviewer.status, "exited");
});

test("restarts a role through tmux and updates status", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const { fakeTmux, logFile } = createFakeTmux(home);

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );
  runTaskmux(["task", "kill", "task-1", "rd"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  const output = runTaskmux(["task", "restart", "task-1", "rd"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  assert.match(output, /Restarted role rd for task-1/);

  const calls = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls.at(-6), ["kill-window", "-t", "taskmux-task-1:rd"]);
  assert.deepEqual(calls.at(-1), ["attach-session", "-t", "taskmux-task-1:rd"]);

  const role = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  assert.equal(role.status, "running");
});

test("cleans stale role windows into exited status", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const { fakeTmux, logFile } = createFakeTmux(home);

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "cleanup", "task-1"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  assert.match(output, /Cleaned task task-1 roles/);
  assert.match(output, /rd\s+exited/);

  const role = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  assert.equal(role.status, "exited");
});

test("stops a role through tmux and updates status", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const { fakeTmux, logFile } = createFakeTmux(home);

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "stop", "task-1", "rd"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  assert.match(output, /Stopped role rd for task-1/);

  const calls = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls[0], ["send-keys", "-t", "taskmux-task-1:rd", "C-c"]);

  const role = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  assert.equal(role.status, "exited");
});

test("kills a role tmux window and updates status", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const { fakeTmux, logFile } = createFakeTmux(home);

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = runTaskmux(["task", "kill", "task-1", "rd"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  assert.match(output, /Killed role rd for task-1/);

  const calls = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls[0], ["kill-window", "-t", "taskmux-task-1:rd"]);

  const role = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  assert.equal(role.status, "exited");
});

test("adds and lists task comments", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });

  const addOutput = runTaskmux(
    ["task", "comment", "task-1", "Keep old session compatibility."],
    { TASKMUX_HOME: home }
  );

  assert.match(addOutput, /Added comment to task-1/);

  const commentsFile = readFileSync(join(home, "tasks", "task-1", "comments.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(commentsFile[0].schemaVersion, 1);
  assert.equal(commentsFile[0].body, "Keep old session compatibility.");

  runTaskmux(["task", "comment", "task-1", "Reviewer should check copy."], {
    TASKMUX_HOME: home
  });

  const listOutput = runTaskmux(["task", "comments", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.match(listOutput, /Keep old session compatibility\./);
  assert.match(listOutput, /Reviewer should check copy\./);
});

test("records and lists task event history", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(["task", "start", "task-1"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );
  runTaskmux(["task", "comment", "task-1", "Keep old session compatibility."], {
    TASKMUX_HOME: home
  });

  const events = readFileSync(join(home, "tasks", "task-1", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(events[0].schemaVersion, 1);
  assert.equal(events[0].id, "event-1");
  assert.equal(events[0].type, "task.created");
  assert.equal(events[0].payload.title, "Refactor login page");
  assert.equal(events[1].type, "task.status_changed");
  assert.deepEqual(events[1].payload, { from: "open", to: "active" });
  assert.equal(events[2].type, "role.assigned");
  assert.deepEqual(events[2].payload, { role: "rd", agent: "codex" });
  assert.equal(events[3].type, "comment.added");
  assert.deepEqual(events[3].payload, { comment: "comment-1" });

  const output = runTaskmux(["task", "events", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.match(output, /event-1\s+.+\s+task\.created\s+title=Refactor login page/);
  assert.match(output, /event-2\s+.+\s+task\.status_changed\s+from=open to=active/);
  assert.match(output, /event-3\s+.+\s+role\.assigned\s+role=rd agent=codex/);
  assert.match(output, /event-4\s+.+\s+comment\.added\s+comment=comment-1/);
});

test("returns a data error exit code for invalid event schema", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  writeFileSync(join(home, "tasks", "task-1", "events.jsonl"), "{\"schemaVersion\":2}\n");

  const result = runTaskmuxFailure(["task", "events", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid event record: task-1:1/);
});

test("returns a not found exit code for missing tasks", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  const result = runTaskmuxFailure(["task", "show", "task-404"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 3);
  assert.match(result.stderr, /TASK_NOT_FOUND: Task not found: task-404/);
});

test("returns a role not found exit code for missing roles", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });

  const result = runTaskmuxFailure(["task", "detail", "task-1", "reviewer"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 3);
  assert.match(result.stderr, /ROLE_NOT_FOUND: Role not found: reviewer/);
});

test("returns a usage exit code for missing task shell ids", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  const result = runTaskmuxFailure(["task", "shell"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /USAGE_ERROR: Task id is required/);
});

test("returns a data error exit code for invalid task schema", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const taskDir = join(home, "tasks", "task-1");
  execFileSync("mkdir", ["-p", taskDir]);
  writeFileSync(join(taskDir, "task.json"), JSON.stringify({ id: "task-1" }));

  const result = runTaskmuxFailure(["task", "show", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid task record: task-1/);
});

test("returns a data error exit code for invalid task info schema", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  writeFileSync(join(home, "tasks", "task-1", "info.json"), JSON.stringify({ schemaVersion: 2 }));

  const result = runTaskmuxFailure(["task", "show", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid task info record: task-1/);
});

test("returns a data error exit code for invalid role schema", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const taskDir = join(home, "tasks", "task-1");
  const roleDir = join(taskDir, "roles", "rd");
  execFileSync("mkdir", ["-p", roleDir]);
  writeFileSync(
    join(taskDir, "task.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "task-1",
      status: "open",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    })
  );
  writeFileSync(
    join(taskDir, "info.json"),
    JSON.stringify({
      schemaVersion: 1,
      title: "Refactor login page"
    })
  );
  writeFileSync(join(roleDir, "role.json"), JSON.stringify({ schemaVersion: 2 }));

  const result = runTaskmuxFailure(["task", "detail", "task-1", "rd"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid role record: rd/);
});

test("returns a data error exit code for invalid role info schema", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );
  writeFileSync(
    join(home, "tasks", "task-1", "roles", "rd", "info.json"),
    JSON.stringify({ schemaVersion: 2 })
  );

  const result = runTaskmuxFailure(["task", "roles", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid role info record: rd/);
});

test("returns a data error exit code for invalid comment schema", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  writeFileSync(join(home, "tasks", "task-1", "comments.jsonl"), "{\"schemaVersion\":2}\n");

  const result = runTaskmuxFailure(["task", "comments", "task-1"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid comment record: task-1:1/);
});

test("adds lists and shows custom runners", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const fakeAgent = createFakeExecutable(home, "custom-agent.js", "custom agent 1.0\n");

  const addOutput = runTaskmux(
    [
      "runner",
      "add",
      "agent-js",
      "--command",
      fakeAgent,
      "--arg",
      "--model",
      "--arg",
      "review",
      "--env",
      "TASKMUX_MODE=dev"
    ],
    { TASKMUX_HOME: home }
  );

  assert.match(addOutput, /Added runner agent-js/);

  const runner = JSON.parse(
    readFileSync(join(home, "runners", "agent-js", "runner.json"), "utf8")
  );
  assert.equal(runner.schemaVersion, 1);
  assert.equal(runner.id, "agent-js");
  assert.equal(runner.command, fakeAgent);
  assert.deepEqual(runner.args, ["--model", "review"]);
  assert.deepEqual(runner.env, { TASKMUX_MODE: "dev" });

  const listOutput = runTaskmux(["runner", "list"], { TASKMUX_HOME: home });
  assert.match(listOutput, /codex\s+builtin\s+codex/);
  assert.match(listOutput, /claude\s+builtin\s+claude/);
  assert.match(listOutput, new RegExp(`agent-js\\s+custom\\s+${fakeAgent.replaceAll("\\", "\\\\")}`));

  const showOutput = runTaskmux(["runner", "show", "agent-js"], { TASKMUX_HOME: home });
  assert.match(showOutput, /Runner: agent-js/);
  assert.match(showOutput, new RegExp(`Command: ${fakeAgent.replaceAll("\\", "\\\\")}`));
  assert.match(showOutput, /Args: --model review/);
  assert.match(showOutput, /Env: TASKMUX_MODE=dev/);
});

test("assigns custom runners and starts configured commands", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const fakeAgent = createFakeExecutable(home, "custom-agent.js", "custom agent 1.0\n");
  const { fakeTmux, logFile } = createFakeTmux(home);

  runTaskmux(
    [
      "runner",
      "add",
      "agent-js",
      "--command",
      fakeAgent,
      "--arg",
      "--model",
      "--arg",
      "review",
      "--env",
      "TASKMUX_MODE=dev"
    ],
    { TASKMUX_HOME: home }
  );
  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });

  const assignOutput = runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "agent-js",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  assert.match(assignOutput, /Assigned role rd to task-1/);
  assert.match(assignOutput, /Agent: agent-js/);

  const role = JSON.parse(
    readFileSync(join(home, "tasks", "task-1", "roles", "rd", "role.json"), "utf8")
  );
  assert.equal(role.agent, "agent-js");
  assert.equal(role.command, fakeAgent);
  assert.deepEqual(role.args, ["--model", "review"]);
  assert.deepEqual(role.env, { TASKMUX_MODE: "dev" });

  runTaskmux(["task", "enter", "task-1", "rd"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    FAKE_TMUX_LOG: logFile
  });

  const calls = readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls[3], [
    "new-window",
    "-t",
    "taskmux-task-1",
    "-n",
    "rd",
    "-c",
    "/tmp/project-a",
    `env TASKMUX_MODE=dev ${fakeAgent} --model review`
  ]);
});

test("removes custom runners", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const fakeAgent = createFakeExecutable(home, "custom-agent.js", "custom agent 1.0\n");

  runTaskmux(["runner", "add", "agent-js", "--command", fakeAgent], {
    TASKMUX_HOME: home
  });

  const removeOutput = runTaskmux(["runner", "remove", "agent-js"], {
    TASKMUX_HOME: home
  });

  assert.match(removeOutput, /Removed runner agent-js/);

  const result = runTaskmuxFailure(["runner", "show", "agent-js"], {
    TASKMUX_HOME: home
  });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /RUNNER_NOT_FOUND: Runner not found: agent-js/);
});

test("runs doctor checks with configured executables", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const fakeTmux = createFakeExecutable(home, "fake-tmux.js", "tmux 3.4\n");
  const fakeCodex = createFakeExecutable(home, "fake-codex.js", "codex 1.0.0\n");
  const fakeClaude = createFakeExecutable(home, "fake-claude.js", "claude 2.0.0\n");

  const output = runTaskmux(["doctor"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    TASKMUX_CODEX_BIN: fakeCodex,
    TASKMUX_CLAUDE_BIN: fakeClaude
  });

  assert.match(output, /TaskMux doctor/);
  assert.match(output, /node\s+ok\s+v/);
  assert.match(output, /tmux\s+ok\s+tmux 3\.4/);
  assert.match(output, /codex\s+ok\s+codex 1\.0\.0/);
  assert.match(output, /claude\s+ok\s+claude 2\.0\.0/);
  assert.match(output, /taskmux home\s+ok/);
  assert.match(output, /storage schema\s+ok\s+latest=1/);
  assert.match(output, new RegExp(home.replaceAll("\\", "\\\\")));
});

test("doctor guides users when storage schema needs migration", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const fakeTmux = createFakeExecutable(home, "fake-tmux.js", "tmux 3.4\n");
  const fakeCodex = createFakeExecutable(home, "fake-codex.js", "codex 1.0.0\n");
  const fakeClaude = createFakeExecutable(home, "fake-claude.js", "claude 2.0.0\n");
  writeStorageSchema(home, 0);

  const output = runTaskmux(["doctor"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    TASKMUX_CODEX_BIN: fakeCodex,
    TASKMUX_CLAUDE_BIN: fakeClaude
  });

  assert.match(output, /storage schema\s+upgrade-required\s+current=0 latest=1; run taskmux migrate/);
});

test("runs doctor checks for custom runner executables", () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));
  const fakeTmux = createFakeExecutable(home, "fake-tmux.js", "tmux 3.4\n");
  const fakeCodex = createFakeExecutable(home, "fake-codex.js", "codex 1.0.0\n");
  const fakeClaude = createFakeExecutable(home, "fake-claude.js", "claude 2.0.0\n");
  const fakeAgent = createFakeExecutable(home, "custom-agent.js", "custom agent 1.0\n");

  runTaskmux(["runner", "add", "agent-js", "--command", fakeAgent], {
    TASKMUX_HOME: home
  });

  const output = runTaskmux(["doctor"], {
    TASKMUX_HOME: home,
    TASKMUX_TMUX_BIN: fakeTmux,
    TASKMUX_CODEX_BIN: fakeCodex,
    TASKMUX_CLAUDE_BIN: fakeClaude
  });

  assert.match(output, /runner:agent-js\s+ok\s+custom agent 1\.0/);
});

test("runs an interactive task shell", async () => {
  const home = mkdtempSync(join(tmpdir(), "taskmux-test-"));

  runTaskmux(["task", "create", "Refactor login page"], {
    TASKMUX_HOME: home
  });
  runTaskmux(
    [
      "task",
      "assign",
      "task-1",
      "rd",
      "--agent",
      "codex",
      "--workspace",
      "/tmp/project-a"
    ],
    { TASKMUX_HOME: home }
  );

  const output = await runTaskmuxInteractive(
    ["task", "shell", "task-1"],
    "summary\nroles\ncomment hello from shell\ncomments\nevents\nexit\n",
    { TASKMUX_HOME: home }
  );

  assert.match(output, /Task: task-1/);
  assert.match(output, /tb task-1>/);
  assert.match(output, /rd\s+codex\s+idle\s+\/tmp\/project-a/);
  assert.match(output, /Added comment to task-1: hello from shell/);
  assert.match(output, /hello from shell/);
  assert.match(output, /task\.created/);
  assert.match(output, /role\.assigned/);
  assert.match(output, /comment\.added/);
});
