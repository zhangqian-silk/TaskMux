import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

test("prints help text", () => {
  const output = execFileSync("node", ["dist/cli.js", "--help"], {
    encoding: "utf8"
  });

  assert.match(output, /TaskMux/);
  assert.match(output, /tmux/);
});
