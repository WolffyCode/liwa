---
description: "Desktop runs the Liwa workspace in a native application. This reference covers application behavior, development and integration; the packaging guide owns local build operations."
---

# Liwa Desktop

English | [中文](README.zh.md)

## Summary

Desktop runs the Liwa workspace in a native application. This reference covers application behavior, development and integration; the packaging guide owns local build operations.

## Table of Contents

- [Application overview](#application-overview)
- [Terminal command](#terminal-command)
- [Closing the window and quitting](#closing-the-window-and-quitting)
- [Key technical decisions](#key-technical-decisions)
- [Bundled command runtime](#bundled-command-runtime)
- [Installation ownership](#installation-ownership)
- [Recovery and diagnostics](docs/diagnostics/README.md)
- [Develop](#develop)
- [Package](#package)
- [Low-level development overrides](#low-level-development-overrides)
- [Known limitations](#known-limitations)

<a id="application-overview"></a>

## Application overview

Electron caches the last confirmed UI language in `userData/desktop/locale-cache` so startup recovery dialogs can use it before Host settings are available. Missing, invalid, or unreadable caches fall back to the system language; cache write failures do not block startup. A successful Host startup or a UI language change refreshes the cache. Until then, a changed system language may differ from the cached language.

Desktop analytics follows the [product collection policy](../../packages/client/product-analytics/README.md), including its live application setting. Web usage is excluded.

The desktop application is an Electron shell around the complete liwa Web application. An Electron RunAsNode child starts the shared profile runner, and Electron immediately loads the packaged Web entry at `liwa-app://app/`. Its shared loading page waits for Host boot injections, then starts the client without navigating to another document. Electron forwards application HTTP requests to the authenticated Web Host, dropping connection-level response headers (`transfer-encoding`, `connection`, `keep-alive`) that describe the Node fetch rather than the resource, and marking plugin bundle responses `no-store` because their per-launch revisions would only accumulate in Chromium's disk cache; WebSocket streams connect to that Host with credentials attached only for the owned application window. Node IPC carries boot injections, readiness, and shutdown. Desktop listens on an OS-assigned port by default, so it cannot collide with Web’s `3080` or a reserved port; a `webserver.config.port` patch can override it.

Desktop binds `127.0.0.1`, the address Electron dials for the ready URL and the WebSocket credential filter. WebSocket streams use `ws:` or `wss:` according to the Host listener; credentials require matching authority and scheme.

The first application-menu command, **About Liwa**, opens Electron's native About panel with the application icon, product name, and current version. The menu follows the Desktop shell locale. On macOS, Hide, Hide Others, Show All, and Quit use localized labels; Hide and Quit include the Liwa product name. These commands retain their native actions and shortcuts. macOS reads the icon from its application bundle, so an unpackaged development launch displays Electron's icon; Windows receives the packaged PNG.

Desktop’s local native directory flow opens an Electron folder dialog attached to the application window, restoring, showing, and focusing that window first. Concurrent requests share one dialog; cancellation returns no path and failures remain retryable. Ordinary Web uses the Host chooser. Browse mode lists Host directories. On Linux without zenity or kdialog, automatic selection uses browse instead of the Electron dialog.

Desktop ships one pnpm distribution at `resources/runtime/primary-runtime/dependencies/pnpm`, without the native packages of other targets. Build-time production installation, the installed `liwa` CLI, Creator and the Web Plugin Manager execute its `bin/pnpm.mjs` with Electron Node mode; package operations do not require pnpm on PATH. The private Node launcher environment applies only to package operations. Agent workspace dependencies copy the same self-contained primary-runtime payload into the Liwa home and execute pnpm with its standalone Node.

Desktop microphone access is restricted to audio requests from the primary `liwa-app://app` frame. macOS uses system microphone authorization, a packaged usage description, and `com.apple.security.device.audio-input` in the main application and Helper signatures.

Press F12 (Fn+F12 on media-key keyboards), Command+Option+I on macOS, or Ctrl+Shift+I on Windows to toggle DevTools for the focused application page, including in packaged builds. These native shortcuts use hidden application-menu items. Shell dialog overlays and packaged embedded browser guests disable DevTools.

<a id="terminal-command"></a>

## Terminal command

The application menu's **Manage liwa Command…** entry, below **About Liwa**, shows the current command and offers Install, Repair, and Remove. The command uses Desktop's installed runtime and the ordinary [liwa CLI](../cli/README.md), including when the Desktop application is closed. Open a new terminal after installation and run `liwa --version`.

On macOS, installation creates `/usr/local/bin/liwa` and requests administrator authentication when the directory requires it. Shell startup files are unchanged. On Windows, the management dialog registers the command in the current user's PATH. A pre-existing command requires confirmation before switching; repairing Desktop's own selected command does not repeat that confirmation. The macOS link preserves and restores the displaced launcher; Windows preserves other PATH entries, including entries that predate registration. A command with higher PATH precedence is reported with its location. After moving the application, use Repair on macOS or Install from the new location on Windows. Remove leaves unrelated installations intact.

Command registration is optional after installing Desktop. Use **Manage liwa Command… → Remove** before deleting Desktop to remove its CLI registration; deleting the application does not remove it. Finish CLI commands before replacing or deleting Desktop. The CLI runtime version follows the installed Desktop release. See [bundled command runtime](#bundled-command-runtime) for Desktop plugin commands and runtime limitations.

<a id="closing-the-window-and-quitting"></a>

## Closing the window and quitting

Closing the main window (macOS close button and ⌘W; Windows ×, Alt+F4, and the taskbar Close window command) hides it; Windows asks for acknowledgement before the first hide. The page and the Host keep running, tasks continue, and the next show presents the same document with its session, drafts, and scroll position; a fullscreen macOS window leaves fullscreen before hiding. The window returns through the Dock icon, a second launch, or `liwa://open` on macOS, and through the tray on Windows. Minimize is unchanged. Closing the welcome window before the workspace opens quits on Windows and, on macOS, keeps the application in the Dock without a window.

Windows keeps a tray icon for the whole run. Its tooltip is the product name, a single click shows and focuses the window, and the context menu offers Open Liwa and Quit Liwa in the shell locale. Before the first hide, the shared shell dialog overlay explains that running tasks continue and the window can be reopened from the system tray. Confirm hides the window and writes `background-close-confirmed` under Electron userData; Escape, dismissal, or dialog failure keeps the window visible and does not record acknowledgement. Repeated close requests focus the existing shell dialog. The old `background-notice-shown` marker does not suppress this confirmation. Closing the window sends no system notification. The tray bitmaps are `resources/tray-windows.ico`, rendered from `resources/icon-windows.svg` at 16, 20, 24, 32, 40, 48, and 64 pixels by `pnpm run render:tray-icon`, and packaged as `resources/tray.ico`. macOS ships no menu bar icon.

Every ordinary quit entry — ⌘Q, the application menu, the Dock menu, the Windows tray and caption Application menu, and the quit caused by closing the welcome window — asks the Host what it would interrupt. The Host answers over the private IPC channel with two facts: active tasks (running agents including subagents and approval waits, queued messages, running or stopping jobs), and armed scheduled reminders reported by the `schedule` family of `workspace/session-activity` for the sessions loaded during this run. Neither fact, the quit proceeds silently. Otherwise a native message box without an owner window — hidden windows stay hidden — shows **Quit Liwa?** with one of three localized explanations: running tasks will be interrupted, scheduled tasks will not run while the application is closed, or both. Quit is the default button and Cancel answers Esc; macOS places Cancel left of Quit, Windows places Quit left of Cancel, and the Windows task dialog shows the application icon and stays light regardless of the application theme. A Host that has not reached ready or has failed cannot run tasks, so the quit proceeds without asking. An inspection failure or a Host that misses the two-second deadline is treated as running tasks. While the box is open, another quit request joins it instead of stacking a second one (macOS also raises it; Electron exposes no handle to the Windows task dialog), the explanation does not change when work starts or ends, Quit stops the application without re-inspecting, and Cancel changes nothing. Cancelling a quit that closing the welcome window started shows the welcome window again.

The confirmation is skipped when the fatal-recovery dialog exits or restarts, when the development Restart App and Host command runs, and during operating-system shutdown, restart, or log-off: Windows sets this on the definitive session-end message; macOS sets it on the power-off notification, and because another application can still cancel that shutdown, the next focus or show of the main window clears it. Desktop does not enable scheduled tasks by default, so the scheduled-task explanations appear only once that feature is on; reminders fire only in loaded sessions, and unloaded sessions are neither counted nor resumed until they are opened.

The tray renderer enlarges the mark by 20% around the tile center while preserving the background and aspect ratio; application icons retain their original proportions.

<a id="key-technical-decisions"></a>

## Key technical decisions

The original artwork lives in `resources/icon.png` and `resources/icon.svg`; platform adaptations retain the mark and tile in `resources/icon-windows.*` and `resources/icon-macos.*`. Export each platform SVG as a transparent 1024×1024 PNG.

Shortcut overrides are stored in `app.getPath('userData')/keybindings.json`, separately from `LIWA_HOME`. The main process validates and serializes changes before publishing accepted bindings. Failed reads retain the last accepted bindings and block edits, including Restore All; unreadable and future-version files remain unchanged. Development can isolate these preferences with `LIWA_DESKTOP_USER_DATA_DIR`; the launcher prints its resolved path. See the [shortcut service](../../packages/client/shortcuts/README.md) for format and conflict semantics.

The macOS File menu displays the accepted single-key binding, including arrow keys, and routes Close Page or Window through the client page owner. On Windows and macOS, all complete accepted bindings are intercepted before main-document, embedded-frame, and browser-guest input, including editing and terminal input. Recording and input-method composition remain protected. Shell dialog overlays block product shortcuts and editing-key delivery to the parent window and its browser guests from creation until the last overlay closes. Every overlay opening or closing invalidates pending chord state. The main process shares one overlay owner between shell dialogs and shortcut input through explicit creation and input-state capabilities. Two-key chords leave the first key’s initial press available to the page and do not intercept its release; complete chords and their repeats are consumed. The renderer leaves configurable binding dispatch to the native adapter. Chords have no native menu accelerator. Accepted commands are forwarded once through the trusted preload. Linux dispatches main-document shortcuts through the DOM and forwards accepted embedded-frame bindings to the client resolver. Closing the last window preserves macOS application lifetime; Windows exits the desktop instance and stops its tasks. The [close decision](../../.agents/notes/implemented/architecture/2026-09-21-desktop-page-close-shortcuts.md) records this lifecycle choice.

The macOS PNG uses an inset rounded background for legacy ICNS packaging, with representations up to 1024 pixels. It is a flattened icon, not an Icon Composer document. Apple's [app icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons) describes unmasked layers for Icon Composer; those inputs require a separate macOS export and must not reuse the rounded ICNS artwork. Verify Finder and Dock appearance on supported macOS versions after changing the icon.

<a id="bundled-workspace-dependencies"></a>

### Bundled workspace dependencies

electron-builder copies only the manifest's `dependencies` into `app.asar/node_modules`, so the Electron main bundle `lib/main.js` inlines its workspace devDependencies and leaves `electron`, Node builtins, and those `dependencies` as its only bare imports; a sandboxed preload may leave only `electron`, `events`, `timers`, and `url`, the modules its `require` polyfill resolves. The main bundle resolves the inlined packages from their `lib/` output, so the root `build:lib:host` bundles `apps/desktop` after the concurrent workspace tsdown pass, and [`desktop-bundle-imports`](scripts/desktop-bundle-imports.mjs) fails any Desktop bundle whose static, dynamic, or `require()` import the packaged application cannot resolve. Without that check an import rolldown could not resolve ships as an external specifier and fails at launch with `ERR_MODULE_NOT_FOUND`. The [archived bundle-order decision](../../.agents/notes/archived/process/2026-09-22-desktop-main-bundle-after-workspace-tsdown.md) records the alternatives.

Desktop carries independent Python, Node.js and pnpm distributions. Python includes numpy, pandas, python-docx, python-pptx, openpyxl, Pillow, lxml and XlsxWriter with their complete dependencies. The `load_workspace_dependencies` tool installs this payload offline on first use under `$LIWA_HOME/liwa-runtimes/liwa-primary-runtime` (normally `~/.liwa/liwa-runtimes/liwa-primary-runtime`) and returns absolute interpreter, pnpm script and library paths plus `pythonDistributions`, the bundled distribution names and versions. The version report excludes user-installed additions. Office tasks prefer these libraries unless user or workspace instructions select another environment. Execute the pnpm script with the returned Node executable. The returned Node library directory is reserved for bundled libraries, not pnpm's global installation directory.

Desktop exposes the compact `office` router and named authoring/operation subskills. Authoring uses bundled Python libraries; operation skills invoke the configured Node and CLI paths. Skills live in `runtime/office-skills` outside ASAR. See the [Office skill package](../../packages/skill/skill-office/README.md) for progressive loading and limitations.

The payload follows the Desktop version. `runtime.json` records the Desktop version, target, top-level interpreter/package-manager versions and the Python distribution map, and a digest of the selected target’s locked payload inputs and assembly format. Distribution names use PEP 503 normalization; duplicate normalized names reject the manifest. Legacy `components` manifests remain readable through normalization, with their existing library-version consistency checks. Matching installations are reused; a dependency or archive change replaces the directory after a complete staged copy even when the Desktop version stays unchanged. Older manifests without a digest are replaced on their next installation. User-added Python packages remain only while the payload identity matches. A failed directory replacement retains the previous installation; Windows may refuse replacement while an interpreter is still running.

The private Desktop `runtime/bin` directory is added only to package-installation processes, not the Host PATH inherited by PTC and agent shells. This tool does not change PATH, environment variables or user package-manager configuration. pnpm retains its own defaults and user settings for global packages, executable entries and its store, including native errors when the environment does not support global installation. There is no separate dependency updater. [The primary-runtime decision](../../.agents/notes/implemented/feature/2026-09-14-desktop-primary-runtime.md) records these choices.

Node prepares the bundled interpreters and Python libraries without a system Python or pip. [The download lock](../../scripts/primary-runtime/lock.json) pins interpreter archives, Python distribution versions and target-specific wheel URLs and hashes; the shared builder resolves pnpm from the root development dependency pin. The root package-manager version and the Desktop pin are checked for agreement. Wheel filenames and distribution versions must agree for every target. Preserve key order within the selected target, wheel records and distribution map, plus wheel-entry order; these affect payload identity, while top-level lock key order does not. Library wheels unpack into site-packages, retaining auxiliary files under each wheel's `.data/scripts` directory without generating command wrappers. Other installation schemes are rejected. External resources and installed copies retain the [two interpreter aliases](../../packages/skill/tool-workspace-dependencies/README.md). POSIX native-target checks require relative interpreter aliases. All native-target checks exercise command names, child execution and a pip-enabled venv, verify the locked wheel set and versions, permit the interpreter's bundled pip, and check the Python version, Office document read/write operations and dependency completeness without writing bytecode after staging cleanup. Prepared runtime files keep their own upstream signatures; the application ad-hoc signature skips them. Both `dev:desktop` and `start:desktop` prepare `.desktop-build/targets/<target>/runtime/primary-runtime` before launching Electron; first use may download locked dependencies. An unfinished preparation cannot report a successful launcher exit.

The shared Desktop/SDK runtime builder omits directories named `tests` beneath NumPy and pandas before copying or signing the payload, and removes their rows from each distribution’s `RECORD`. It retains `numpy.testing`, `pandas.testing`, `pandas._testing`, native extensions and licenses. Complete upstream suites are unavailable; native checks verify the retained testing APIs, absence of test directories and existence of recorded files.

| Decision | Why | Direct consequence |
|---|---|---|
| Version identity | The shell API, Web client, backend, and plugin graph are qualified as one combination; independent versions would create untested combinations. | Electron and `@liwa/cli` always have the same exact version. A liwa upgrade means packaging Desktop again, even when the shell code is unchanged. |
| Runtime | The application must run without a system Node.js or pnpm installation. | liwa runs under Electron with `ELECTRON_RUN_AS_NODE=1` and `--expose-internals` and every package operation uses the bundled pnpm. Package-manager configuration and the Host environment follow the user's settings. Package scripts use a `node` shell launcher that forwards to Electron. |
| Package sources | Core installation at startup adds work even when offline. | `app.asar/liwa` carries a complete production dependency tree; the profile installs only external plugins. |
| State ownership | Sharing executable dependency graphs would let CLI and Desktop change each other's liwa, Cordis, plugin, or native-module versions, while two desktop processes could race on the same profile. | Electron acquires its process-lifetime single-instance lock before any profile access and exclusively owns `$LIWA_HOME/profiles/desktop` plus its package-manager state. CLI and Desktop share supported product data under `$LIWA_HOME`, but never executable packages, plugin activation, lockfiles, or `node_modules`. |
| Transport | Web serving and authentication share one implementation. | Electron loads packaged Web assets; the Host supplies boot injections and authenticated APIs. |
| Plugin changes | Desktop and Web need the same installation and activation behavior. | The main application uses the shared Web Plugin Manager and bundled pnpm. |

The [thin-wrapper decision](../../.agents/notes/implemented/architecture/2026-09-10-desktop-web-wrapper.md) owns shared Web behavior and Desktop adapters. The [Electron packaging and update decision](../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.md) records where the version identity comes from.

Welcome loads the shared Toast palette and shadow tokens, with system typography for body-mounted notifications.

<a id="bundled-command-runtime"></a>

## Bundled command runtime

The installed `resources/runtime/cli/bin/liwa` shell script (`liwa.cmd` on Windows) runs the ordinary CLI dispatcher using Desktop's Electron executable and bundled pnpm. It works while Desktop is closed and retains the Electron runtime limitations. Ordinary profile, configuration, and plugin commands use the same implementation as npm liwa; the command does not open Desktop.

To manage Desktop's plugins, launch Desktop once to initialize its profile, fully quit the application, then run `liwa plugin --profile desktop add <package>`, `list`, or `remove <package>`. Reopen Desktop to use the changes. Package operations retain the shared profile write lock and compatibility checks. The installed command refuses an uninitialized Desktop profile instead of creating an ordinary CLI profile in its place.

Finish CLI commands before replacing or deleting Desktop; Desktop does not coordinate with running commands. The CLI does not supply Office authoring-skill resource paths. Desktop's existing Office setup and Web attachment conversion retain their own resource configuration. `prepare:runtime` copies the launch scripts without compiling a native CLI launcher.

<a id="installation-ownership"></a>

## Installation ownership

Electron owns `$LIWA_HOME/profiles/desktop`. Its `dependencies` contains packages installed by pnpm; `liwa.profile.bundles` contains the built-in bundles followed by enabled plugins. The packaged application supplies liwa, the private Desktop Host, and their production packages from `resources/app.asar/liwa`. Packaged applications select runtime profile resolution without creating package links; development profiles use filesystem links. Both host and plugins execute in the same Electron Node-mode process; Desktop does not enable `--preserve-symlinks`. The CLI cannot boot this profile. The Desktop-installed command can manage its plugins while the application is quit; npm-installed liwa cannot mutate it.

The application preload exposes boot readiness, fatal startup reporting, native directory selection, the `__LIWA_HOST_PATHS__` bridge for composer path references, and the lease-scoped Browser bridge only to `liwa-app://app` documents. Product documents use the shared authenticated HTTP APIs and receive the Desktop marker. Plugin management uses the Web application's authenticated HTTP APIs. Electron serves shell dialog documents and assets locally at `liwa-app://shell/`, independently of Host readiness. Electron exposes no plugin-management IPC or separate management document. No renderer receives filesystem access, raw Electron IPC, a shell, or arbitrary pnpm arguments.

The file-drag bridge accepts arbitrary file bytes or Session-scoped resource references from the owned product main frame. The Host authorizes resource reads through its composed filesystem, confirms a local mapping, and returns a private content digest; main checks content and the shared export filename before borrowing the source. Native startup checks the prepared file’s device, inode, size, modification time, and change time without rereading its bytes. Borrowed files are never deleted. Renamed, transformed, remote, or Blob content uses a private temporary copy. MIME data completes names without restricting file types; compatible suffixes such as `.jpeg` survive. Temporary preparations, partial writes, and retained exports share 64 MiB; unused files release on pointer leave, and OS-delivered copies expire after 60 seconds. Exhaustion reports the generic retry message until capacity is reclaimed. Caller cancellation and shutdown abort Host reads and main-process verification, interrupt icon waits, and release unused files. Shutdown waits for writes/releases and retries failed removals without waiting for the icon service. Asynchronous system file icons avoid decoding original images in main.

Only the main application window enables `<webview>`. Guest attachment must match a main-issued lease and partition; guests keep sandbox, context isolation and Web security without Node integration or guest preload. Browser IPC listeners are created only for the application document. [Sidebar Browser](../../packages/client/ui-sidebar-browser/README.md) describes storage grouping and guest limitations; Host authentication remains required independently of URL filtering.

The `liwa-app://shell/` origin serves packaged shell dialog documents, scripts, and styles without contacting the Host. Static requests retain GET/HEAD, path-containment, and MIME handling; each shell dialog document keeps its isolated preload and owned-window IPC checks.

The product UI retains Web actions, including "Open In..." through the shared authenticated HTTP routes. Desktop uses Web's automatic directory-picker selection and initializes new profiles with the shared Web template's bundles.

Electron chooses typed shell copy in the eight [shipped Client languages](../../packages/client/locale/README.md) from its application locale and falls back to English. The macOS application bundle declares all eight languages in `CFBundleLocalizations`, allowing macOS to match the initial application language to the user’s preferred languages. Saved Client UI language preferences still take precedence for the main interface. All shipped language resources must have matching keys, format placeholders, and command examples; `pnpm run check:i18n` validates them. Platform account pages and onboarding artwork use English for languages other than Chinese. On Windows, the main document's language updates desktop menus and recovery prompts. The repository Client UI i18n gate checks desktop sources.

Windows and macOS relay native fullscreen transitions and the state after each page load to the renderer, so overlays can adapt their caption clearance.

Windows uses a 40-DIP caption with native window controls and colors synchronized from the application palette. Localized Application and Edit entries beside the sidebar toggle open native popup menus. They mount only after the application frame publishes its shell overlay seat, and remain absent during startup loading. Application provides About, Manage liwa Command, and Exit; Edit provides undo, redo, cut, copy, paste, delete, and select all by sending the corresponding keys to the focused editor, independently of custom shortcut bindings. Plugin management uses the main application's Plugins page. No separate native menu row appears on Alt. Other platforms retain their native menus. Editable fields retain keyboard commands and a context menu without shortcut labels; Chromium supplies command availability, and selected read-only text offers Copy.

On macOS the custom menu retains Electron's standard Window menu and application hide commands, including Minimize (⌘M) and Hide (⌘H). Linux keeps the application and Edit menus.

### Runtime and plugin activation

The packaged `resources/app.asar/liwa/desktop-runtime.json` binds the shell version, Electron's Node version, platform, architecture, shared package versions, and final file inventory. Startup reads the metadata and checks shared package records. Runtime schema, shell version, target compatibility, and file integrity are verified during packaging. Reintroducing startup runtime comparisons requires a concrete installation failure that packaging validation and actual Host diagnostics cannot adequately explain. Core packages are never copied into profile storage or installed by pnpm at first launch.

1. The main window loads the shared Web loading page offscreen from packaged static assets before profile preparation or backend startup. Shared profile initialization creates missing manifest, empty user patch, and pnpm workspace files without overwriting existing files.
2. Before Host startup, Desktop validates the runtime descriptor and prepares the profile without modifying installed packages, declarations, or the lockfile; it removes only the `.liwa-module-fallback` projections earlier link-backend launches wrote, and startup never runs pnpm. Packages inside the profile keep native precedence, and installation package names resolve through the runtime resolution ([lookup order](../../.agents/notes/implemented/architecture/2026-09-19-profile-resolution-lookup-order.md); [cleanup removal](../../.agents/notes/implemented/simplification/2026-09-19-remove-desktop-profile-core-cleanup.md)).
3. Changes to Electron's Node version, platform, or architecture preserve installed plugins. Native incompatibilities surface during loading and can be repaired through pnpm.
4. The main application’s Plugins page uses the shared [plugin manager](../../packages/boot/plugin-manager/README.md) against the Desktop profile. Package operations use bundled pnpm with normal user and profile configuration.
5. The shared manager owns installation errors, activation, and restart requirements. Native recovery can disable third-party bundles even when the Host cannot start.

The [Web plugin UI](../../packages/client/ui-plugin-manager/README.md) owns the management interface. Desktop profile initialization and recovery preserve installed plugin files.

Desktop fatal failures use native recovery with Exit, Restart, Disable third-party plugins, back up profile patch, and restart, and Get diagnostic report. See [recovery and diagnostics](docs/diagnostics/README.md) for triggers, report locations and contents, recent operation records, and shutdown limits.

### Host environment

macOS and Linux GUI launches inherit only the session manager's environment, without variables exported by shell startup files. Before the first Host starts, Desktop runs the account's login shell (from the user database, not `$SHELL`) once as `<shell> -ilc` and reads its `env -0` output between delimiters, so `~/.zprofile` and `~/.zshrc` (or the shell's equivalents) take effect for the Host, agent shells, terminals, and profile configuration. Reading runs in parallel with profile preparation. The probe has no terminal input and sets `DISABLE_AUTO_UPDATE=true`, `ZSH_TMUX_AUTOSTARTED=true`, and `ZSH_TMUX_AUTOSTART=false` to keep oh-my-zsh and tmux plugins from blocking. Shell values replace inherited values except `PWD`, `OLDPWD`, `SHLVL`, `_`, those probe variables, and launcher-owned `LIWA_*` and `ELECTRON_*` names; Desktop resolves paths such as `LIWA_HOME` before the read, so the Host keeps the same values. The read completes at the closing delimiter, so background processes started by startup files may keep running with their output discarded. A candidate that fails to start, exits nonzero, prints no delimited output, or exceeds `LIWA_DESKTOP_LOGIN_SHELL_TIMEOUT_MS` (integer milliseconds from 1000 through 2147483647, default `10000`; its process group is killed) is logged as a warning, and Desktop tries `/bin/zsh`, `/bin/bash`, and `/bin/sh` in turn; when all fail the Host uses the inherited environment. The dump command uses POSIX syntax, so an account shell such as csh, tcsh, or nushell fails and the Host receives the environment from the first system shell's startup files instead. Quitting Desktop during the read kills the running probe's process group. The result is read once per application process, so changes to shell startup files apply after quitting and reopening Desktop. Windows GUI launches already inherit the user and system environment variables from the registry, so Windows skips this step.

<a id="develop"></a>

## Develop

The development application menu offers Reload Page (Cmd+R on macOS, Ctrl+R elsewhere) and Restart App and Host. Restart waits for Host shutdown before relaunching Electron and starting a new Host; neither action rebuilds source files.

`dev:desktop` builds the current Host, client bundles, Web frontend, and Electron shell, projects the built CLI and private Desktop Host packages with their workspace dependencies into a disposable desktop npm project, and launches Electron without resolving liwa from npm:

```sh
pnpm run dev:desktop
```

Development Liwa state defaults to `apps/desktop/.desktop-build/development/home`, the disposable npm project lives at `apps/desktop/.desktop-build/development/project`, and Electron browser data lives at `apps/desktop/.desktop-build/development/electron-user-data`. Sessions, settings, credentials, package links, and browser data therefore stay out of the user's normal Liwa home. An explicit `LIWA_HOME` replaces only the development Liwa home. Renderer DevTools opens automatically; Main, Renderer, and liwa Host debugging listen on ports 9229, 9222, and 9230. `LIWA_DESKTOP_MAIN_INSPECT_PORT`, `LIWA_DESKTOP_RENDERER_DEBUG_PORT`, and `LIWA_DESKTOP_HOST_INSPECT_PORT` replace those ports, while `LIWA_DESKTOP_OPEN_DEVTOOLS=0` keeps the detached Renderer tools closed.

After an explicit build, `start:desktop` reconstructs the disposable project and launches the existing artifacts without building again:

```sh
pnpm run start:desktop
```

Desktop package preparation keeps only the macOS arm64 optional native packages.

The Web counterparts are `pnpm run dev:web` and `pnpm run start:web`, documented in the [development guide](../../docs/development.md). Workspace development runs the current CLI and private Desktop Host packages under Electron RunAsNode. Plugin management and recovery use `$LIWA_HOME/profiles/desktop`, separate from the disposable workspace runtime. The Host uses runtime module resolution in both development and packaged builds without creating official-package fallback links; developer-installed packages, including links, retain native priority. Use the application directory from `pnpm run package:desktop:dir` to exercise Electron RunAsNode, bundled pnpm, bundled liwa resources, plugin installation and repair paths.

The [native/renderer keyboard tests](tests/keyboard.spec.ts) compile as part of the repository Client typecheck. Their Desktop imports are limited to Cordis-free input, persistence, IPC, browser-guest, and overlay modules.

Dependency installation does not run the locked Electron package's separate binary installer. Before running the [Windows console-signal tests](tests/windows-cli-signals.spec.ts) directly, prepare the locked Electron binary with `pnpm --filter @liwa/desktop exec install-electron` from the repository root. For downloads through a proxy, enable `ELECTRON_GET_USE_PROXY=1` for that installer process. Windows coverage aggregates require successful provisioning before the instrumented unit inventory starts.

### Startup onboarding

The API-key input starts empty and uses `autocomplete="new-password"` to ask Chromium not to autofill saved login passwords.

Repeated launches and `liwa://open` keep the workspace hidden until the startup credential check or a welcome action permits entry. Entering from Welcome places keyboard focus on the document without selecting a sidebar control; Tab navigation remains available.

Desktop checks configured model API-key references after the Host starts and before opening the workspace. With no configured key, the welcome window offers the API-key page. Save and continue writes through the existing credential service using the official DeepSeek provider's configured reference, then opens the workspace. Set up later opens the workspace without saving the draft or a completion setting; the next process launch checks credentials again. Back returns to the entry and clears the unsaved key and validation message. Buttons keep their labels and block competing actions while saving or opening the workspace. The Desktop preload marker suppresses the Web credential dialog, while retaining the Models settings page and the welcome notice.

The welcome window reads the shared `locale.preference` before it appears. An explicit supported language choice wins; otherwise Desktop picks the first supported OS language and falls back to English. The main UI reads the same preference and OS language order through its isolated preload before mounting. Language changes in Settings update the shell’s current dictionary and menu; automatic selection writes no preference. The welcome window has no language selector.

Welcome text uses Montserrat Light with system fallbacks; large action buttons keep the system font, while text buttons use Montserrat Light. English introductory copy is 24px throughout. Chinese introductory copy is 24px with a 26px product name. Action buttons are 240px wide with 14px labels. The API-key page uses a 20px heading and a 14px back action, with 84px between the secondary button’s bottom edge and the window bottom.

### Welcome window appearance

The welcome window follows system appearance with the design’s light/dark colors and shows the 600 × 700 entry layout and the API-key form, with native window controls, a draggable title area, a local brand SVG, system sans-serif fallbacks, and locally bundled Montserrat Light for non-button text. The window uses macOS menu vibrancy or Windows acrylic with the onboarding window tint: 40% white in light mode and 50% rgb(24 25 28) in dark mode. The local React welcome entry bundles React with its CSS; it uses the isolated preload without loading the main Web application. The entry and API-key pages share a fixed bottom action row; the back link sits below it. Buttons share the platform motion timings, and Reduce Motion disables their transitions. The OS owns blur strength and outer corners. macOS Reduce Transparency suppresses translucency, and Increase Contrast forces that setting on. Save and continue writes to the development credential store; Set up later opens the real workspace without saving a key or completion flag. The generated project links the declared workspace dependency closure as well as pnpm’s hoisted packages, so unhoisted configured plugins remain resolvable. [The window note](../../.agents/notes/implemented/architecture/2026-09-08-desktop-welcome-window-material.md) owns the material and onboarding decisions.

<a id="package"></a>

## Package

Desktop is packaged locally on an Apple Silicon Mac only: `pnpm run package:desktop` produces an ad-hoc-signed `Liwa.app` and DMG without a release certificate, notarization, upload, or automatic updates; upgrading means packaging again. See [Desktop packaging](packaging/README.md) for steps, artifact locations, and acceptance.

<a id="low-level-development-overrides"></a>

## Low-level development overrides

An unpackaged Electron process uses `.desktop-build/development/project` under its application directory as its development project. `LIWA_DESKTOP_PNPM_ENTRY` and `LIWA_DESKTOP_LIWA_DIR` are optional overrides with application-path defaults. `LIWA_DESKTOP_PRIMARY_RUNTIME_DIR` is required for every unpackaged launch: the development launchers (`dev:desktop` and `start:desktop`) set it to the primary-runtime directory of the target they prepared, and a launch without it fails with the fatal startup dialog. The directory belongs to the packaging scripts' target paths; the shell does not derive it. Packaged applications ignore these variables, resolve application resources from `process.resourcesPath`, and use the managed Desktop profile.

<a id="known-limitations"></a>

## Known limitations

- Windows material rendering still requires platform QA.

- Desktop is packaged locally on an Apple Silicon Mac only, with an ad-hoc signature, no notarization, and no automatic updates.
- Dependency lifecycle scripts follow pnpm’s build permissions; Desktop provides no separate approval dialog.
- The desktop shell shares sessions, settings, credentials, workspaces, and storage under `$LIWA_HOME` with CLI liwa, while executable packages, plugin activation, and lockfiles remain separate.

Packaged applications register `liwa://open` to show the window without passing credentials. On macOS, the development launcher prepares an ad-hoc-signed `Liwa Dev.app` under `.desktop-build/development`, declares `liwa` in its Info.plist, and registers it with Launch Services. It loads the current workspace and records the selected development home, browser-data path, and debug settings for cold starts. Starting this bundle makes it the default `liwa://` handler; starting the packaged application registers the packaged handler again. The generated bundle contains no credentials and requires the workspace and prepared runtime to remain available.
