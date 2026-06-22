# npm Release

TaskMux publishes as `@silk/taskmux`.

## Preflight

```sh
npm ci
npm run build
npm test
npm run lint
npm run pack:dry-run
```

## Publish

```sh
npm publish --access public
```

The package is scoped. Public scoped packages must be published with `--access public`.
