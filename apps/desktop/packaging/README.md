---
description: "Package the Liwa desktop application locally on an Apple Silicon Mac: commands, artifact locations, signing and identity, package sources, and verification. No release certificate, notarization, or publication."
---

# Desktop packaging

English | [中文](README.zh.md)

## Summary

Package the Liwa desktop application locally on an Apple Silicon Mac: commands, artifact locations, signing and identity, package sources, and verification. No release certificate, notarization, or publication.

## Table of Contents

- [Packaging commands](#commands)
- [Signing and application identity](#signing-and-identity)
- [Package sources](#package-sources)
- [Runtime file selection](#runtime-file-selection)
- [Desktop runtime preparation](#desktop-runtime-preparation)
- [Verification](#verification)

<a id="commands"></a>

## Packaging commands

Desktop has one target: an Apple Silicon Mac (`mac-arm64`). Packaging commands fail immediately on any other host. Run from the repository root:

```sh
pnpm run package:desktop        # Liwa.app and DMG
pnpm run package:desktop:dir    # runnable Liwa.app only
pnpm run prepare:desktop        # stop after preparing the runtime and package set, without electron-builder
pnpm --dir apps/desktop run check:package   # check the host and toolchain only
```

Every command rebuilds from the current workspace: it builds the repository with the `official` profile (window title Liwa), packs workspace packages, compiles the native flock addon on this Mac, prepares Electron and the primary runtime, installs the liwa production tree, then runs electron-builder and the packaged smoke. `prepare:desktop` is a different stopping point; a later `package:desktop*` still redoes everything, so stale packages or runtimes are never reused.

Artifacts live under `apps/desktop/.desktop-build/targets/mac-arm64/`, which Git ignores:

- `artifacts/mac-arm64/Liwa.app`: the unpacked application;
- `artifacts/liwa-<version>-mac-arm64.dmg`: the DMG, LZMA-compressed through `dmg.format: 'ULMO'` in the [electron-builder configuration](../scripts/electron-builder-config.mjs); a [build-time patch](../../../patches/app-builder-lib@26.17.0.patch) lets the pinned builder accept the format;
- `apps/desktop/.desktop-build/packaging-runs/`: per-run stage records in `events.jsonl`; logs redact values of environment variables whose names contain KEY, SECRET, TOKEN, or PASSWORD.

`LIWA_DESKTOP_PACKAGE_CACHE_DIR` in the packaging environment names a nonempty absolute directory for the shared `downloads` and `pnpm-store` caches; `.desktop-build` is used when it is omitted. Cache disk usage is managed by the user and never evicted automatically.

<a id="signing-and-identity"></a>

## Signing and application identity

The application carries only an ad-hoc signature with the hardened runtime and the entitlements in [`macos-entitlements.plist`](../scripts/macos-entitlements.plist). Packaging removes `CSC_*`, `WIN_CSC_*`, and `APPLE_*` variables from its subprocess environment and disables certificate discovery, so developer certificates in the local keychain are never used. There is no notarization, the DMG is unsigned, and electron-builder runs with `--publish never`.

| Item | Value |
|---|---|
| Application name | `Liwa` (the same in every language) |
| Bundle ID | `com.wolffycode.liwa`; the development launcher uses `com.wolffycode.liwa.dev.<workspace hash>` |
| Link scheme | `liwa://` (`liwa://open` only brings the window forward) |
| Icon | `resources/icon-macos.png` |

The bundle ID and link scheme have one source: `DESKTOP_APP_ID` and `DESKTOP_LINK_SCHEME` exported by the [electron-builder configuration](../scripts/electron-builder-config.mjs); the development launcher and the main process use the same values.

<a id="package-sources"></a>

## Package sources

Every `@liwa/*` package in the application comes from a tarball packed from this workspace, including the private Desktop Host, the vendor packages, and `@liwa/node-addon-system` with its `darwin-arm64` platform package compiled on this Mac. Preparation checks the runtime lockfile: any `@liwa/*` entry that is not a local file or link fails packaging instead of falling back to the npm registry. Third-party dependencies are installed from the npm registry through the bundled pnpm; set `LIWA_DESKTOP_NPM_REGISTRY` to an HTTPS origin without credentials or path to use a mirror.

<a id="runtime-file-selection"></a>

## Runtime file selection

The [Desktop file policy](../scripts/runtime-file-policy.ts) filters the immutable `resources/app.asar/liwa/node_modules` copy before integrity sealing. It excludes TypeScript declarations, recognized JavaScript/CSS/TypeScript source maps, TypeScript build caches, Domino test directories and Yarn development metadata, selected native compiler outputs, node-pty prebuilds for other platforms, and `node-pty/third_party/conpty`. It keeps runtime JavaScript, native modules for the target platform, WASM, unknown resources, licenses, and notices. Dependency manifests pass through electron-builder's metadata cleanup before integrity sealing, so the archive keeps the recorded bytes. The policy does not modify npm tarballs, the bundled package manager, or user-installed plugin files.

The [Electron shell file list](../scripts/electron-builder-config.mjs) excludes recognized source maps and TypeScript build caches from the separately collected `resources/app.asar/node_modules` dependencies, while keeping runtime code, native modules, WASM, data files (including ordinary `.map` assets), licenses, and notices; the [shell archive test](../tests/shell-file-selection.spec.ts) checks retained bytes and exclusions.

The [Office conversion provider](../../../packages/document/office-to-pdf/README.md) carries the native engine the target declares, or the WASM engine when the kit declares no matching native target. Preparation rejects a missing target engine before packaging. The complete Office dependency is unpacked under `resources/app.asar.unpacked/liwa/node_modules/`. The Desktop Host resolves the engine manifest to those physical directories and gives loaded skills absolute paths to the standalone Node (`resources/runtime/primary-runtime/dependencies/node/bin/`) and the unpacked CLI (`@deepseek-ai/libreoffice-kit/lib/cli.js`).

The packaged application runs compiled JavaScript and pre-generated Typert metadata; it does not compile TypeScript plugins. The [copy-rule test](../tests/runtime-file-policy.spec.ts) covers exclusions and retained resources.

<a id="desktop-runtime-preparation"></a>

## Desktop runtime preparation

Electron and the primary runtime are prepared in sequence; the CLI is prepared and `versions.json` written only after both runtime resources succeed. Temporary install projects, lockfiles, and configuration are created per run; runtime installation verifies store integrity and copies package files, and cleanup keeps the caches.

The Desktop [patch policy](../scripts/runtime-patch-policy.ts) classifies every workspace patch as shared, workspace-only, or runtime-only. Shared entries reuse the root patch bytes and check their hash against the root lockfile; runtime-only entries use separate files in the repository without changing the workspace install. Unclassified or stale entries, missing files, changed hashes, incompatible resolved versions, and workspace-only packages reaching the runtime all stop packaging. The [preparation script](../scripts/prepare-runtime-patches.ts) writes only to the temporary project. Desktop dependency overrides are declared separately in the patch-policy module; every build re-resolves the runtime lockfile before installing with `--frozen-lockfile`, so dependency resolution is not yet reproducible across builds.

`prepare:liwa` installs the production graph once, materializes the packages electron-builder archives into `app.asar/liwa`, removes package-manager metadata, and writes `desktop-runtime.json` with shared package versions and final file hashes. Native executables and libraries are unpacked beside the ASAR; Python, the standalone Node, and pnpm stay in the external runtime resources and keep their own upstream signatures. The unpacked application contains Electron, the materialized liwa production tree, pnpm, and the shell; the layout trades more files inside the application for no core-package installation on the user's machine.

<a id="verification"></a>

## Verification

Packaging carries two smoke layers: the [payload smoke](../tests/fixtures/runtime-payload-smoke.mjs) in `prepare:liwa` resolves ripgrep under Electron RunAsNode and checks text search and file enumeration; the [Host smoke](../scripts/smoke-runtime.ts) creates DOCX, XLSX, and PPTX inputs with the bundled Python, converts them through the real Office provider, and checks the PDFs. After electron-builder, the [packaged smoke](../scripts/smoke-packaged-runtime.ts) repeats these checks against the ASAR inside `Liwa.app` and verifies archive integrity, execute flags, and unpacked file permissions. Any failed check makes the command exit nonzero.

For manual acceptance, confirm that `Liwa.app/Contents/Info.plist` has `CFBundleIdentifier` `com.wolffycode.liwa` and `CFBundleURLSchemes` `liwa`, then launch the application with a separate `LIWA_HOME` and check the window title, About panel, and plugin loading. The [Desktop test record](../tests/README.md) keeps the remaining verification limits.
