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

test("prints shell completion scripts", () => {
  const bash = execFileSync("node", ["dist/cli.js", "completion", "bash"], {
    encoding: "utf8"
  });
  const zsh = execFileSync("node", ["dist/cli.js", "completion", "zsh"], {
    encoding: "utf8"
  });
  const fish = execFileSync("node", ["dist/cli.js", "completion", "fish"], {
    encoding: "utf8"
  });

  assert.match(bash, /complete -F _taskmux taskmux/);
  assert.match(zsh, /#compdef taskmux/);
  assert.match(fish, /complete -c taskmux/);
});
