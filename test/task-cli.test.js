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

  assert.equal(task.schemaVersion, 1);
  assert.equal(task.id, "task-1");
  assert.equal(task.title, "Refactor login page");
  assert.equal(task.status, "open");
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

  assert.equal(role.schemaVersion, 1);
  assert.equal(role.name, "rd");
  assert.equal(role.agent, "codex");
  assert.equal(role.workspace, "/tmp/project-a");
  assert.equal(role.status, "idle");
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
      title: "Refactor login page",
      status: "open",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    })
  );
  writeFileSync(join(roleDir, "role.json"), JSON.stringify({ schemaVersion: 2 }));

  const result = runTaskmuxFailure(["task", "detail", "task-1", "rd"], {
    TASKMUX_HOME: home
  });

  assert.equal(result.status, 4);
  assert.match(result.stderr, /DATA_ERROR: Invalid role record: rd/);
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
  assert.match(output, new RegExp(home.replaceAll("\\", "\\\\")));
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
    "summary\nroles\ncomment hello from shell\ncomments\nexit\n",
    { TASKMUX_HOME: home }
  );

  assert.match(output, /Task: task-1/);
  assert.match(output, /tb task-1>/);
  assert.match(output, /rd\s+codex\s+idle\s+\/tmp\/project-a/);
  assert.match(output, /Added comment to task-1: hello from shell/);
  assert.match(output, /hello from shell/);
});
