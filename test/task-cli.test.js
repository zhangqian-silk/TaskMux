import { execFileSync } from "node:child_process";
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

  assert.equal(role.name, "rd");
  assert.equal(role.agent, "codex");
  assert.equal(role.workspace, "/tmp/project-a");
  assert.equal(role.status, "idle");
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
