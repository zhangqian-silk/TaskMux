import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const script = join(process.cwd(), "scripts", "verify-release-tag.mjs");
const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

function verifyTag(refName) {
  return execFileSync("node", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REF_NAME: refName
    }
  });
}

test("release tag verification accepts the package version tag", () => {
  assert.match(verifyTag(`v${packageJson.version}`), /Release tag verified/);
});

test("release tag verification rejects tags that do not match package version", () => {
  assert.throws(
    () => verifyTag("v999.999.999"),
    /Release tag v999\.999\.999 does not match package version/
  );
});

test("release tag verification rejects non-version tags", () => {
  assert.throws(() => verifyTag("latest"), /Release tag must match/);
});

