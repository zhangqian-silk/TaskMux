import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

test("npm publish workflow uses trusted publishing", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github", "workflows", "publish.yml"),
    "utf8"
  );

  assert.match(workflow, /tags:\n\s+- "v\*"/);
  assert.match(workflow, /id-token:\s+write/);
  assert.match(workflow, /environment:\s+npm/);
  assert.match(workflow, /node-version:\s+"24"/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run verify:release-tag/);
  assert.match(workflow, /npm run pack:dry-run/);
  assert.match(workflow, /npm publish --access public/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|--otp/);
});

