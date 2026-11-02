# Release

Pre-1.0: treat this as a version and verification checklist, not a stability policy. Liwa does not publish these packages to npm; Desktop packaging compiles the `darwin-arm64` binary on the packaging Mac and packs the entry and platform package from this workspace ([package sources](../../../apps/desktop/packaging/README.md#package-sources)).

## Versioning

The native workspace root and every platform/entry package share one version. Run the bump helper from the repository root:

```sh
pnpm --dir native/system release:bump patch          # or minor / major / x.y.z
```

It updates `native/system/package.json` and every `native/system/packages/*` manifest, refreshes the repository root lockfile (`--ignore-scripts --lockfile-only`), and runs `release:verify`. Explicit versions accept full semver including prereleases (`pnpm --dir native/system release:bump 0.0.0-test.0`). Keep `workspace:*` dependencies in source; pnpm converts them to concrete versions during pack.

Version bumps are normal source changes: commit the launcher manifests and root lockfile together.

```sh
pnpm --dir native/system release:commit patch        # bump + stage + commit in one command
```

## Preflight

```sh
pnpm install --frozen-lockfile
pnpm --dir native/system build:ts
pnpm --dir native/system typecheck
pnpm --dir native/system test:entry
```

On a supported Linux or macOS host, also rehearse the pack path locally:

```sh
pnpm --dir native/system build:native
pnpm --dir native/system build:test-oracle
pnpm --dir native/system test:launcher
pnpm --dir native/system test:flock
pnpm --dir native/system test:packaging
node native/system/scripts/pack-release.mjs native/system/.release/npm --current-platform-only
node native/system/scripts/verify-packed-install.mjs native/system/.release/npm --current-platform-only
```
