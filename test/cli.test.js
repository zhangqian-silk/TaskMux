import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("prints help text", () => {
  const output = execFileSync("node", ["dist/cli.js", "--help"], {
    encoding: "utf8"
  });

  assert.match(output, new RegExp(`TaskMux ${packageJson.version}`));
  assert.match(output, /tmux/);
});

test("prints package version", () => {
  const output = execFileSync("node", ["dist/cli.js", "--version"], {
    encoding: "utf8"
  });

  assert.equal(output.trim(), packageJson.version);
});

test("prints help text for short help aliases", () => {
  for (const helpFlag of ["-h", "-help"]) {
    const output = execFileSync("node", ["dist/cli.js", helpFlag], {
      encoding: "utf8"
    });

    assert.match(output, new RegExp(`TaskMux ${packageJson.version}`));
    assert.match(output, /taskmux --version/);
  }
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
