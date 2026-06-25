# npm Release

TaskMux publishes as `@zq-silk/taskmux`.

Publishing uses npm Trusted Publishing from GitHub Actions. The release workflow does not use `NPM_TOKEN`, `NODE_AUTH_TOKEN`, npm passwords, or OTP values.

## Preflight

```sh
npm ci
npm run build
npm test
npm run lint
npm run verify:release-tag
npm run pack:dry-run
```

`npm run verify:release-tag` expects `GITHUB_REF_NAME` to be the exact package version tag, for example `v0.1.0` for package version `0.1.0`.

## Automated Publish

Release commits are published by pushing a version tag:

```sh
npm version patch
git push origin master --follow-tags
```

The GitHub Actions workflow `.github/workflows/publish.yml` runs in the `npm` environment and requires npm Trusted Publishing to be configured for:

```text
Repository: zhangqian-silk/TaskMux
Workflow filename: publish.yml
Environment name: npm
Package: @zq-silk/taskmux
```

The workflow grants `id-token: write` for OIDC, runs install, tag verification, build, tests, lint, package dry-run, and then publishes:

```sh
npm publish --access public
```

The package is scoped. Public scoped packages must be published with `--access public`.

## Manual Fallback

Manual publishing is reserved for recovery. Use the same preflight checks and publish with `npm publish --access public` from a clean `master` checkout only when the GitHub Actions workflow is unavailable.
