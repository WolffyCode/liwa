# Desktop local verification

English | [中文](README.zh.md)

## Summary

This page records local verification methods for the Desktop shell: failure reports, shell dialog theme, and native overlay visibility. Packaged-artifact acceptance lives in [Desktop packaging](../packaging/README.md#verification).

## Table of Contents

- [Fault-report verification](#verification-diagnostics)
- [Shell dialog theme](#verification-theme)
- [Native overlay visibility](#verification-overlay)

<a id="verification-diagnostics"></a>

## Fault-report verification

See [recovery and diagnostics](../docs/diagnostics/README.md) for product behavior and limitations.

Use a disposable profile and separate Electron `userData` with the actual packaged client. Construct a minimal local bundle with `package.json`, `liwa.bundle.patch` pointing to `cordis.patch.yml`, and an optional plugin module; archive it as a local `.tgz`. These packages deliberately break the application and must not be published or installed in a daily profile.

Exercise import and plugin-initialization exceptions, an asynchronous exception after `appReady`, and a nonzero Host exit. A patch disabling the `agent`, `session`, `llm`, and `tools` providers exercises missing-service diagnostics. To check cross-restart history, select that bundle through `pluginManager`, then restart the same profile. Runtime scenarios require observing actual client readiness; `appReady` alone does not establish that the window is visible.

Check the original error and cause or exit code, operation and Host run IDs across restart, report-collection completion and omissions, file retrieval from the native dialog, and startup after plugin recovery. Record the package version and source commit; successful package generation or a management result alone does not establish client functionality. Restore protocol associations and stop test processes afterward.

For resource checks, use large sparse history files, unrelated files, dense records, and malformed or unfinished lines. Measure setup separately from collection in fresh processes, recording actual bytes read, output size, time, and peak memory. To check Worker cancellation, a test-only module hook can hold an asynchronous file open after writing an entry marker. Confirm that marker, observe Worker exit after the deadline, and compare the basic report bytes. This does not reproduce a kernel-hung system call or establish packaged-client behavior.

<a id="verification-theme"></a>

## Shell dialog theme

After `pnpm --dir apps/desktop run build`, run the real Electron palette fixture on macOS:

```sh
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/update-theme.mjs
```

The fixture creates a private profile, loads the production shell HTML, sandboxed preloads, renderer scripts, and bundled design tokens, and substitutes only fixed IPC status responses. Its 6 cases cover the shell dialog document starting in light/dark mode, switching while open, and following system appearance. It checks transparent document backgrounds, surface/text/button/mask colors, the code/address surface, the dark-only 1 CSS px inset outline, and the close icon, then writes two screenshots and `result.json` to `.desktop-build/qualification/update-theme-*`. It does not start a Host or qualify Windows native rendering. The first-close notice shares that document's CSS and theme script.

<a id="verification-overlay"></a>

## Native overlay visibility

On macOS, reuse the cached Electron runtime after compiling the Desktop Host sources:

```sh
pnpm exec tsc -b apps/desktop/tsconfig.host.json
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/update-overlay-visibility.mjs
```

The fixture owns a unique profile and writes `result.json` under `.desktop-build/qualification/update-overlay-*`. It checks visible and hidden owners, absence of native child windows, retention of a separate control window’s focus after owner visibility notifications, and view/input cleanup including owner destruction. It uses no network, product login, or liwa Host. It qualifies the in-window carrier, not the full first-login or installation flow.
