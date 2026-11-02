---
description: "在 Apple Silicon Mac 上本地打包 Liwa 桌面应用：命令、产物位置、签名与身份、包来源和验收。不签发布证书、不公证、不发布。"
---

# Desktop 打包

[English](README.md) | 中文

## 概述

在 Apple Silicon Mac 上本地打包 Liwa 桌面应用：命令、产物位置、签名与身份、包来源和验收。不签发布证书、不公证、不发布。

## 目录

- [打包命令](#commands)
- [签名与应用身份](#signing-and-identity)
- [包来源](#package-sources)
- [运行时文件筛选](#runtime-file-selection)
- [Desktop 运行时准备](#desktop-runtime-preparation)
- [验收](#verification)

<a id="commands"></a>

## 打包命令

桌面应用只有一个目标：Apple Silicon Mac（`mac-arm64`）。其他主机上运行打包命令会直接报错。从仓库根目录运行：

```sh
pnpm run package:desktop        # Liwa.app and DMG
pnpm run package:desktop:dir    # runnable Liwa.app only
pnpm run prepare:desktop        # stop after preparing the runtime and package set, without electron-builder
pnpm --dir apps/desktop run check:package   # check the host and toolchain only
```

每条命令都从当前工作区重新构建：以 `official` 档位构建仓库（窗口标题为 Liwa），打包工作区包，在本机编译原生 flock 插件，准备 Electron 与 primary-runtime，安装 liwa 生产依赖树，最后运行 electron-builder 和打包后 smoke。`prepare:desktop` 是另一种停止位置，之后的 `package:desktop*` 仍会完整重做，避免使用陈旧的包或运行时。

产物位于 `apps/desktop/.desktop-build/targets/mac-arm64/`，Git 忽略该目录：

- `artifacts/mac-arm64/Liwa.app`：未压缩的应用；
- `artifacts/liwa-<版本>-mac-arm64.dmg`：DMG，使用 [electron-builder 配置](../scripts/electron-builder-config.mjs)中的 `dmg.format: 'ULMO'`（LZMA 压缩），[构建时补丁](../../../patches/app-builder-lib@26.17.0.patch)让固定版本的 builder 接受此格式；
- `apps/desktop/.desktop-build/packaging-runs/`：每次运行的阶段记录 `events.jsonl`，日志中名称含 KEY、SECRET、TOKEN、PASSWORD 的环境变量值会被遮盖。

打包进程环境中的 `LIWA_DESKTOP_PACKAGE_CACHE_DIR` 为共享的 `downloads` 和 `pnpm-store` 缓存指定非空绝对目录；省略时使用 `.desktop-build`。缓存磁盘用量由使用者自行管理，不自动淘汰。

<a id="signing-and-identity"></a>

## 签名与应用身份

应用只带临时（ad-hoc）签名，启用 hardened runtime，权限来自 [`macos-entitlements.plist`](../scripts/macos-entitlements.plist)。打包会从子进程环境中移除 `CSC_*`、`WIN_CSC_*` 和 `APPLE_*` 变量并关闭证书自动发现，因此本机钥匙串里的开发者证书不会被用上。不公证，DMG 不签名，electron-builder 以 `--publish never` 运行。

| 项目 | 值 |
|---|---|
| 应用名 | `Liwa`（各语言相同） |
| Bundle ID | `com.wolffycode.liwa`；开发启动器为 `com.wolffycode.liwa.dev.<工作区哈希>` |
| 链接协议 | `liwa://`（`liwa://open` 只把窗口置前） |
| 图标 | `resources/icon-macos.png` |

Bundle ID 与链接协议的唯一来源是 [electron-builder 配置](../scripts/electron-builder-config.mjs)导出的 `DESKTOP_APP_ID` 与 `DESKTOP_LINK_SCHEME`；开发启动器和主进程使用同一取值。

<a id="package-sources"></a>

## 包来源

应用携带的 `@liwa/*` 包全部来自本工作区打出的 tarball，包括私有 Desktop Host、vendor 包，以及在本机编译的 `@liwa/node-addon-system` 及其 `darwin-arm64` 平台包。准备阶段校验运行时 lockfile：任何 `@liwa/*` 条目若不是本地文件或链接，打包立即失败，不会退回 npm registry。第三方依赖经内置 pnpm 从 npm registry 安装；需要镜像时，用 `LIWA_DESKTOP_NPM_REGISTRY` 指定不带凭据和路径的 HTTPS origin。

<a id="runtime-file-selection"></a>

## 运行时文件筛选

[Desktop 文件策略](../scripts/runtime-file-policy.ts)在完整性封装前过滤不可变的 `resources/app.asar/liwa/node_modules` 副本。它排除 TypeScript 声明、已识别的 JavaScript/CSS/TypeScript source map、TypeScript 构建缓存、Domino 测试目录及 Yarn 开发元数据、选定的原生编译器输出、其他平台的 node-pty 预构建文件和 `node-pty/third_party/conpty`。它保留运行时 JavaScript、目标平台的原生模块、WASM、未知资源、许可证和 notices。依赖清单在完整性封装前经过 electron-builder 的元数据清理，确保归档保持已记录的字节。该策略不修改 npm tarball、内置包管理器或用户安装的插件文件。

[Electron 外壳文件清单](../scripts/electron-builder-config.mjs)从单独收集的 `resources/app.asar/node_modules` 依赖中排除已识别的 source map 和 TypeScript 构建缓存，保留运行时代码、原生模块、WASM、数据文件（包括普通 `.map` 资源）、许可证和 notices；[外壳归档测试](../tests/shell-file-selection.spec.ts)检查保留文件的字节和排除项。

[Office 转换提供方](../../../packages/document/office-to-pdf/README.zh.md)携带目标已声明的原生引擎；kit 未声明匹配原生目标时携带 WASM 引擎。准备阶段在打包前拒绝缺少目标引擎的情况。完整 Office 依赖解包到 `resources/app.asar.unpacked/liwa/node_modules/` 下。Desktop Host 将引擎清单解析到这些物理目录，并向加载的技能提供独立 Node（`resources/runtime/primary-runtime/dependencies/node/bin/`）和解包后 CLI（`@deepseek-ai/libreoffice-kit/lib/cli.js`）的绝对路径。

打包应用运行编译后的 JavaScript 和预生成的 Typert 元数据，不编译 TypeScript 插件。[复制规则测试](../tests/runtime-file-policy.spec.ts)覆盖排除项和保留资源。

<a id="desktop-runtime-preparation"></a>

## Desktop 运行时准备

Electron 和 primary-runtime 串行准备；两份运行时资源都成功后，才会准备 CLI 并写入 `versions.json`。临时安装项目、lockfile 和配置逐次独立创建；运行时安装校验 store 完整性并复制包文件，清理时保留缓存。

Desktop [补丁策略](../scripts/runtime-patch-policy.ts)将每份工作区补丁明确归为共享、仅工作区或仅运行时。共享项复用根目录补丁字节，并对照根锁文件校验 hash；仅运行时项使用仓库内的独立文件，不改变工作区安装。未分类或过期的条目、文件缺失、hash 改变、解析版本不兼容，以及仅工作区包进入运行时，都会阻止打包。[准备脚本](../scripts/prepare-runtime-patches.ts)只写入临时项目。Desktop 依赖 overrides 在补丁策略模块中单独声明；每次构建重新解析运行时锁文件，再通过 `--frozen-lockfile` 安装，不同构建之间的依赖解析尚不保证可复现。

`prepare:liwa` 安装一次生产依赖图，准备物化包供 electron-builder 归档到 `app.asar/liwa`，移除包管理器元数据，并生成包含共享包版本和最终文件哈希的 `desktop-runtime.json`。原生可执行文件及库解包到 ASAR 旁；Python、独立 Node 和 pnpm 保留在外部 runtime 资源中，并保留各自的上游签名。未压缩产物包含 Electron、物化后的 liwa 生产依赖树、pnpm 和壳应用；这种布局用更多应用内文件换取用户机器上不再安装核心包。

<a id="verification"></a>

## 验收

打包流程自带两层 smoke：`prepare:liwa` 中的[产物 smoke](../tests/fixtures/runtime-payload-smoke.mjs)用 Electron RunAsNode 解析 ripgrep 并验证文本搜索与文件枚举；[Host smoke](../scripts/smoke-runtime.ts)用内置 Python 创建 DOCX、XLSX 和 PPTX，经真实 Office 提供方转换并检查 PDF。electron-builder 完成后，[打包后 smoke](../scripts/smoke-packaged-runtime.ts)针对 `Liwa.app` 中的 ASAR 重复这些检查，并核对归档完整性、执行标志和解包文件权限。任一检查失败都会让命令以非零状态退出。

手动验收时，确认 `Liwa.app/Contents/Info.plist` 中的 `CFBundleIdentifier` 为 `com.wolffycode.liwa`、`CFBundleURLSchemes` 为 `liwa`，并用独立的 `LIWA_HOME` 启动应用检查窗口标题、关于面板和插件加载。[Desktop 测试记录](../tests/README.zh.md)维护其余验证限制。
