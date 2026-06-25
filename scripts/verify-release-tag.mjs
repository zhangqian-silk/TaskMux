import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
const releaseTag = process.env.GITHUB_REF_NAME ?? "";
const expectedTag = `v${packageJson.version}`;

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseTag)) {
  console.error(`Release tag must match v<package-version>. Received: ${releaseTag || "(empty)"}`);
  process.exit(1);
}

if (releaseTag !== expectedTag) {
  console.error(`Release tag ${releaseTag} does not match package version ${packageJson.version}`);
  process.exit(1);
}

console.log(`Release tag verified: ${releaseTag}`);

