---
description: "Desktop 在原生应用中运行灵鲸工作区。本参考文档说明应用行为、开发与集成；本地打包操作见打包指南。"
---

# 灵鲸桌面端

[English](README.md) | 中文

## 概述

Desktop 在原生应用中运行灵鲸工作区。本参考文档说明应用行为、开发与集成；本地打包操作见打包指南。

## 目录

- [应用概览](#application-overview)
- [终端命令](#terminal-command)
- [关闭窗口与退出](#closing-the-window-and-quitting)
- [关键技术决策](#key-technical-decisions)
- [内置命令运行时](#bundled-command-runtime)
- [安装归属](#installation-ownership)
- [故障恢复与诊断](docs/diagnostics/README.zh.md)
- [开发](#develop)
- [打包](#package)
- [底层开发覆盖项](#low-level-development-overrides)
- [已知限制](#known-limitations)

<a id="application-overview"></a>

## 应用概览

Electron 在 `userData/desktop/locale-cache` 缓存最近确认的界面语言，使启动恢复弹窗在 Host 设置尚不可用时也能使用该语言。缓存缺失、无效或不可读时回退到系统语言；缓存写入失败不阻断启动。Host 成功启动或界面语言变更时会刷新缓存；在此之前，变更后的系统语言可能与缓存语言不同。

桌面应用是完整 liwa Web 应用外的一层 Electron 壳。Electron RunAsNode 子进程启动共享 profile runner，Electron 立即从 `liwa-app://app/` 加载打包内的 Web 入口。共享加载页等待 Host 启动注入，然后在同一文档中启动客户端。Electron 将应用 HTTP 请求转发给已认证的 Web Host，转发时丢弃描述 Node fetch 连接而非资源本身的响应头（`transfer-encoding`、`connection`、`keep-alive`），并把插件 bundle 响应标记为 `no-store`，因为其每次启动都变化的 revision 只会在 Chromium 磁盘缓存中累积；WebSocket 流连接到该 Host，仅为归属的应用窗口附加凭据。Node IPC 承载启动注入、就绪与关闭。Desktop 默认监听系统分配的端口，因此不会与 Web 的 `3080` 或系统保留端口冲突；可通过 `webserver.config.port` patch 覆盖。

Desktop 绑定 `127.0.0.1`，即 Electron 为就绪 URL 与 WebSocket 凭据过滤器拨号的地址。WebSocket 流按 Host 监听器使用 `ws:` 或 `wss:`；附加凭据要求 authority 与 scheme 均匹配。

应用菜单第一项“**关于 Liwa**”打开 Electron 原生关于面板，展示应用图标、产品名称和当前版本。菜单文案跟随桌面壳的语言。macOS 的隐藏、隐藏其他、显示全部和退出条目使用本地化文案，隐藏和退出条目包含产品名称 Liwa。这些条目保留原生动作和快捷键。macOS 从应用包读取图标，因此未打包的开发启动会显示 Electron 图标；Windows 使用随包分发的 PNG。

Desktop 的本地原生目录流程打开绑定应用窗口的 Electron 文件夹对话框，并先恢复、显示和聚焦该窗口。并发请求共用一个对话框；取消不返回路径，失败后可以重试。普通 Web 使用 Host 选择器。浏览模式列出 Host 目录。Linux 缺少 zenity 或 kdialog 时，自动选择使用浏览模式，不使用 Electron 对话框。

Desktop 在 `resources/runtime/primary-runtime/dependencies/pnpm` 中携带一份 pnpm 分发包，不含其他目标平台的原生包。构建时的生产依赖安装、安装版 `liwa` CLI、Creator 和 Web 插件管理器通过 Electron Node 模式执行其中的 `bin/pnpm.mjs`；包操作不要求 PATH 上存在 pnpm。私有 Node 启动器环境仅用于包操作。agent（智能体）的工作区依赖将同一份完整 primary-runtime 复制到灵鲸主目录，并使用其中的独立 Node 执行 pnpm。

桌面麦克风访问仅允许主 `liwa-app://app` 页面发起的音频请求。macOS 使用系统麦克风授权、随包用途说明，以及主应用与 Helper 签名中的 `com.apple.security.device.audio-input` 权限。

按 F12（多媒体功能键键盘上为 Fn+F12）、macOS 的 Command+Option+I 或 Windows 的 Ctrl+Shift+I，可切换当前获得焦点的应用页面的 DevTools，打包版本同样支持。这些原生快捷键通过隐藏的应用菜单项注册。壳弹窗遮罩和打包版本的内嵌浏览器禁用 DevTools。

<a id="terminal-command"></a>

## 终端命令

应用菜单中的**管理 liwa 命令…**位于**关于 Liwa**下方，显示当前命令，并提供安装、修复和移除操作。命令复用 Desktop 已安装的运行时和普通 [liwa CLI](../cli/README.zh.md)，Desktop 应用关闭后也可以使用。安装后打开新终端，运行 `liwa --version`。

macOS 安装会创建 `/usr/local/bin/liwa`；目录权限需要时，系统会请求管理员认证，不会修改 shell 启动文件。Windows 管理对话框将命令注册到当前用户的 PATH。切换已有命令前会要求确认；修复当前已选中的 Desktop 命令不会重复要求切换确认。macOS 链接会保留并恢复被替换的启动器；Windows 会保留其他 PATH 条目，包括注册前就已存在的条目。若其他命令的 PATH 优先级更高，对话框会显示其位置。移动应用后，macOS 使用“修复”，Windows 从新位置使用“安装”。“移除”不会改动无关安装。

命令注册是安装 Desktop 后的可选操作。删除 Desktop 前，请通过**管理 liwa 命令… → 移除**删除其 CLI 注册；删除应用不会移除该注册。替换或删除 Desktop 前请结束 CLI 命令。CLI 运行时版本随已安装的 Desktop 版本变化。Desktop 插件命令与运行时限制见[内置命令运行时](#bundled-command-runtime)。

<a id="closing-the-window-and-quitting"></a>

## 关闭窗口与退出

关闭主窗口（macOS 的关闭按钮和 ⌘W；Windows 的 ×、Alt+F4 和任务栏"关闭窗口"）会隐藏窗口；Windows 首次隐藏前需要确认。页面和 Host 继续运行，任务不受影响，下次显示时仍是原来的文档，会话、草稿和滚动位置都保留；macOS 全屏窗口先退出全屏再隐藏。macOS 通过 Dock 图标、再次启动或 `liwa://open` 找回窗口，Windows 通过托盘找回。最小化行为不变。进入工作区前关闭欢迎窗口，Windows 上走退出流程，macOS 上应用留在 Dock 中且没有窗口。

Windows 在整个运行期间常驻托盘图标。悬停提示为产品名，单击显示并聚焦窗口，右键菜单提供壳语言下的"打开 Liwa"和"退出 Liwa"。首次隐藏前复用壳弹窗，显示“正在运行的任务不会中断，可在系统托盘中重新打开窗口”和“确认”按钮。确认后隐藏窗口，并在 Electron userData 下写入 `background-close-confirmed`；Esc、关闭弹窗或加载失败均保持主窗口可见，不记录确认。重复关闭请求会聚焦已有壳弹窗。旧的 `background-notice-shown` 标记不会跳过此确认。关闭窗口不发送系统通知。托盘位图是 `resources/tray-windows.ico`，由 `pnpm run render:tray-icon` 从 `resources/icon-windows.svg` 按 16、20、24、32、40、48、64 像素分别渲染，打包为 `resources/tray.ico`。macOS 不提供菜单栏图标。

所有普通退出入口——⌘Q、应用菜单、Dock 菜单、Windows 托盘和标题栏"应用程序"菜单，以及关闭欢迎窗口引起的退出——都先向 Host 查询退出会中断什么。Host 通过私有 IPC 通道回答两项事实：运行中任务（运行中的 agent，包括子代理和等待审批的回合、排队消息、运行中或停止中的后台任务），以及本次运行中已加载会话里由 `workspace/session-activity` 的 `schedule` family 报告的已挂定时器的提醒。两项都没有时直接退出，不弹框。否则弹出一个没有父窗口的原生消息框——隐藏的窗口保持隐藏——标题为**退出 Liwa？**，正文为三种本地化说明之一：正在运行的任务将会中断、应用关闭期间定时任务不会运行，或两者兼有。"退出"是默认按钮，Esc 等同"取消"；macOS 上"取消"在"退出"左侧，Windows 上"退出"在"取消"左侧，Windows 任务对话框显示应用图标且不跟随应用主题、始终为浅色。Host 尚未就绪或已失败时不可能有任务在跑，直接退出。查询失败或 Host 超过两秒截止时间未答复，按运行中任务处理。弹框打开期间，再次请求退出只会并入同一弹框而不叠加新弹框（macOS 上还会把它提到前面；Electron 不暴露 Windows 任务对话框的句柄）；任务开始或结束不会改变文案；点"退出"不再重新查询即停止应用；点"取消"不发生任何变化。取消由关闭欢迎窗口引起的退出时，欢迎窗口会重新显示。

以下情况跳过确认：致命错误恢复对话框中的退出或重启、开发版"重启应用与 Host"命令，以及操作系统关机、重启或注销：Windows 在确定性的会话结束消息上设置该状态；macOS 在关机通知上设置，而其他应用仍可能取消这次关机，因此主窗口下一次获得焦点或显示时会清除它。Desktop 默认未开启定时任务，定时任务的说明只在该功能开启后出现；提醒只在已加载的会话中触发，未加载的会话既不计入，也要等到打开后才会继续。

托盘渲染器以底板中心为基准将标记放大 20%，保留背景和宽高比；应用图标保持原有比例。

<a id="key-technical-decisions"></a>

## 关键技术决策

原稿位于 `resources/icon.png` 和 `resources/icon.svg`；平台适配保留标记与底板，分别位于 `resources/icon-windows.*` 和 `resources/icon-macos.*`。将各平台 SVG 导出为透明的 1024×1024 PNG。

快捷键覆盖保存在 `app.getPath('userData')/keybindings.json`，与 `LIWA_HOME` 分离。主进程校验并串行保存修改后才发布已接受键位。读取失败保留上次接受的键位并阻止编辑，包括全部恢复；不可读和未来版本的文件保持不变。开发时可通过 `LIWA_DESKTOP_USER_DATA_DIR` 隔离这些偏好，启动器会输出解析后的路径。格式和冲突语义见[快捷键服务](../../packages/client/shortcuts/README.zh.md)。

macOS“文件”菜单显示已接受的单键绑定（包括方向键），并通过 Client 页面 owner 路由“关闭页面或窗口”。Windows 和 macOS 在主文档、内嵌 frame 和浏览器 guest 输入之前拦截所有已接受的完整绑定，包括编辑和终端输入。录制和输入法组合状态仍受保护。壳弹窗蒙层从创建到最后一个蒙层关闭期间阻挡父窗口及其浏览器 guest 的产品快捷键和编辑按键递送。每次打开或关闭蒙层都会作废待完成的组合键状态。主进程通过显式的创建能力和输入状态读取能力，让壳弹窗与快捷键输入共享同一个蒙层管理实例。双键组合会将首键的初次按下事件交给页面，且不拦截其松开事件；完整组合及其重复事件会被消费。渲染进程将可配置绑定的分发交给原生适配器。双键组合不注册原生菜单快捷键。已接受的命令通过可信 preload 转发一次。Linux 通过 DOM 分发主文档快捷键，并将已接受的内嵌 frame 绑定转发给 Client 解析器。关闭最后一个窗口后 macOS 保留应用生命周期；Windows 退出桌面实例并停止其任务。[关窗决策](../../.agents/notes/implemented/architecture/2026-09-21-desktop-page-close-shortcuts.zh.md)记录了这一生命周期选择。

macOS PNG 使用带留白的圆角底板，供传统 ICNS 打包使用，包含最高 1024 像素的表示。它是扁平图标，并非 Icon Composer 文档。Apple 的[应用图标指南](https://developer.apple.com/design/human-interface-guidelines/app-icons)要求向 Icon Composer 提供未遮罩的图层；这些输入需要在 macOS 上单独导出，不能复用已做圆角的 ICNS 图案。更换图标后须在支持的 macOS 版本中验收 Finder 和 Dock 的显示效果。

<a id="bundled-workspace-dependencies"></a>

### 内置工作区依赖

electron-builder 只把清单中的 `dependencies` 复制进 `app.asar/node_modules`，因此 Electron 主进程 bundle `lib/main.js` 内联其工作区 devDependencies，裸导入只剩 `electron`、Node 内置模块与这些 `dependencies`；沙箱 preload 只能留下 `electron`、`events`、`timers` 与 `url`，即其 `require` polyfill 能解析的模块。主进程 bundle 从被内联包的 `lib/` 产物解析它们，所以根 `build:lib:host` 在并发的工作区 tsdown 阶段之后才为 `apps/desktop` 打 bundle，并由 [`desktop-bundle-imports`](scripts/desktop-bundle-imports.mjs) 让任何静态、动态或 `require()` 导入无法在打包应用内解析的 Desktop bundle 直接失败。没有这项检查时，rolldown 无法解析的导入会作为外部说明符进入产物，并在启动时以 `ERR_MODULE_NOT_FOUND` 失败。[已归档的bundle 顺序决策](../../.agents/notes/archived/process/2026-09-22-desktop-main-bundle-after-workspace-tsdown.md)记录了备选方案。

Desktop 携带独立的 Python、Node.js 和 pnpm 分发包。Python 包含 numpy、pandas、python-docx、python-pptx、openpyxl、Pillow、lxml、XlsxWriter 及其完整依赖。`load_workspace_dependencies` 工具首次使用时，将该产物离线安装到 `$LIWA_HOME/liwa-runtimes/liwa-primary-runtime`（通常为 `~/.liwa/liwa-runtimes/liwa-primary-runtime`），并返回解释器、pnpm 脚本和库目录的绝对路径，以及记录内置分发包名称与版本的 `pythonDistributions`。版本报告不包含用户自行安装的包。Office 任务默认使用这些库，用户或工作区指令指定其他环境时遵循其要求。pnpm 脚本通过返回的 Node 可执行文件运行。返回的 Node 库目录为随包交付的库预留，不是 pnpm 的全局安装目录。

Desktop 展示精简的 `office` 路由及可具名调用的创作／操作子技能。创作使用内置 Python 库；操作技能调用配置的 Node 和 CLI 路径。技能位于 ASAR 外的 `runtime/office-skills`。渐进加载与限制见 [Office 技能包](../../packages/skill/skill-office/README.zh.md)。

该产物随 Desktop 版本打包。`runtime.json` 记录 Desktop 版本、目标平台、顶层解释器和包管理器版本及 Python 分发包版本表，以及所选目标的锁定产物输入与组装格式的摘要。分发包名称按 PEP 503 归一化；名称归一化后重复时，清单会被拒绝。旧 `components` 清单通过归一化继续可读，并保留其原有库版本一致性校验。匹配的安装会被复用；依赖或压缩包变化后，即使 Desktop 版本不变，也会在完整暂存副本完成后替换目录。不含摘要的旧清单会在下次安装时被替换。用户自行添加的 Python 包仅在产物身份一致时保留。目录替换失败时保留之前的安装；解释器仍在运行时，Windows 可能拒绝替换。

Desktop 私有的 `runtime/bin` 目录仅添加到包安装进程，不进入 PTC 和 agent shell 从 Host 继承的 PATH。该工具不修改 PATH、环境变量或用户包管理器配置。pnpm 的全局包、命令入口和 store 保留自身默认值及用户设置，包括环境不支持全局安装时的原生错误。不提供独立依赖更新器。[第一方 Runtime 决策](../../.agents/notes/implemented/feature/2026-09-14-desktop-primary-runtime.zh.md)记录这些选择。

Node 准备内置解释器和 Python 库，无需系统 Python 或 pip。[下载锁](../../scripts/primary-runtime/lock.json)固定解释器压缩包、Python 分发包版本及目标平台 wheel 的 URL 和哈希；共享构建器从根开发依赖中解析 pnpm 固定版本。测试检查根 package-manager 版本和 Desktop 固定版本保持一致。每个目标的 wheel 文件名必须与分发包版本一致。所选目标、wheel 记录及分发包映射内部的键顺序，以及 wheel 条目顺序都会影响产物身份，编辑时须保留；锁文件顶层键的顺序不影响该身份。库 wheel 解压到 site-packages，各 wheel 的 `.data/scripts` 目录保留辅助文件，不生成命令行包装器。其他安装方案会被拒绝。外部资源及安装副本保留[两个解释器别名](../../packages/skill/tool-workspace-dependencies/README.zh.md)。POSIX 本机目标检查要求解释器别名为相对链接。所有本机目标检查验证命令名、子进程执行及包含 pip 的 venv，并在清理暂存目录后验证锁定 wheel 的集合与版本，允许解释器自带的 pip，并检查 Python 版本、Office 文档读写和依赖完整性，不写入字节码。准备好的运行时文件保留各自的上游签名，应用的临时签名跳过它们。`dev:desktop` 和 `start:desktop` 都会在启动 Electron 前准备 `.desktop-build/targets/<target>/runtime/primary-runtime`；首次准备可能需要下载锁定的依赖。准备未完成时，启动命令不能报告成功退出。

Desktop/SDK 共享运行时构建器在复制或签名产物前，裁剪 NumPy 和 pandas 下名为 `tests` 的目录，并移除各分发包 `RECORD` 中对应的记录。它保留 `numpy.testing`、`pandas.testing`、`pandas._testing`、原生扩展和许可证。完整上游测试套件不可用；本机检查验证保留的 testing API、测试目录已移除，以及清单所列文件存在。

| 决策 | 原因 | 直接结果 |
|---|---|---|
| 版本身份 | 桌面壳 API、Web 客户端、后端与插件依赖图作为一个组合完成验证；独立版本会产生未经验证的组合。 | Electron 与 `@liwa/cli` 始终使用同一精确版本。即使桌面壳代码不变，升级 liwa 也要重新打包 Desktop。 |
| 运行时 | 应用必须能够在没有系统 Node.js 或 pnpm 的机器上运行。 | liwa 通过设置 `ELECTRON_RUN_AS_NODE=1` 和 `--expose-internals` 的 Electron 运行，所有包操作都使用内置 pnpm。包管理器配置和 Host 环境遵循用户设置。包脚本通过 `node` shell 启动器转发给 Electron。 |
| 包来源 | 即使离线，启动时安装核心依赖也会增加开销。 | `app.asar/liwa` 携带完整生产依赖树；profile 只安装外部插件。 |
| 状态归属 | 共享可执行依赖图会让 CLI（命令行界面）与 Desktop 相互改变 liwa、Cordis、插件或原生模块版本，而两个桌面进程还可能争用同一个 profile。 | Electron 在访问任何 profile 前获取进程生命周期单实例锁，并独占 `$LIWA_HOME/profiles/desktop` 及其包管理器状态。CLI 与 Desktop 共享 `$LIWA_HOME` 下受支持的产品数据，但绝不共享可执行包、插件激活、锁文件或 `node_modules`。 |
| 传输 | Web 服务与认证共享一套实现。 | Electron 加载打包的 Web 资源；Host 提供启动注入和经过认证的 API。 |
| 插件变更 | Desktop 与 Web 需要一致的安装和激活行为。 | 主应用使用共享 Web 插件管理器和内置 pnpm。 |

[薄壳决策](../../.agents/notes/implemented/architecture/2026-09-10-desktop-web-wrapper.zh.md)负责共享 Web 行为与 Desktop 适配。[Electron 打包与更新决策](../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)记录了版本身份的由来。

Welcome 加载共享 Toast 的配色和阴影变量，挂载在 body 下的通知使用系统字体。

<a id="bundled-command-runtime"></a>

## 内置命令运行时

安装后的 `resources/runtime/cli/bin/liwa` shell 脚本（Windows 为 `liwa.cmd`）使用 Desktop 的 Electron 可执行文件和内置 pnpm 运行普通 CLI 分派入口。Desktop 关闭时也可使用，并保留 Electron 运行时限制。普通 profile、配置和插件命令与 npm liwa 使用相同实现；该命令不会打开 Desktop。

管理 Desktop 插件前，先启动一次 Desktop 以初始化其 profile，完全退出应用，再运行 `liwa plugin --profile desktop add <package>`、`list` 或 `remove <package>`。重新打开 Desktop 后使用更改。包操作保留共享的 profile 写锁和兼容性检查。内置命令拒绝未初始化的 Desktop profile，不会在其位置创建普通 CLI profile。

替换或删除 Desktop 前请结束 CLI 命令；Desktop 不与运行中的命令协调。CLI 不提供 Office 创作 skill 的资源路径。Desktop 现有 Office 设置与 Web 附件转换保留各自的资源配置。`prepare:runtime` 复制启动脚本，无需编译原生 CLI 启动器。

<a id="installation-ownership"></a>

## 安装归属

Electron 拥有 `$LIWA_HOME/profiles/desktop`。其 `dependencies` 包含 pnpm 安装的包；`liwa.profile.bundles` 包含内置 bundle，后接已启用插件。打包应用从 `resources/app.asar/liwa` 提供 liwa、私有 Desktop Host 及其生产依赖。打包应用选择 runtime profile 解析，不创建包链接；开发 profile 使用文件系统链接。宿主与插件在同一个 Electron Node 模式进程中执行；Desktop 不启用 `--preserve-symlinks`。CLI 不能启动此 profile。Desktop 内置命令可在应用退出后管理其插件；npm 安装的 liwa 不能修改它。

应用 preload 只向 `liwa-app://app` 文档暴露启动就绪、致命启动失败上报、原生目录选择、用于 composer 路径引用的 `__LIWA_HOST_PATHS__` 桥接和租约范围内的 Browser 桥接。产品页面还获得 Desktop 标记。插件管理使用 Web 应用经过认证的 HTTP API；Electron 在 `liwa-app://shell/` 本地提供壳弹窗文档和资源，不依赖 Host 就绪。Electron 不提供插件管理 IPC 或独立管理页面。任何渲染进程都不会获得文件系统访问、原始 Electron IPC、shell 或任意 pnpm 参数。

文件拖放桥接接受所属主应用主框架传入的任意文件字节或 Session 资源地址。Host 通过组合的文件系统授权读取、确认本地映射并返回私有内容摘要；主进程检查内容与统一解析的导出名后借用源文件。原生起拖核对准备时的设备、inode、大小、修改时间和变更时间，不再读取整份字节。借用文件不会被删除。改名、转换、远程或 Blob 内容使用私有临时副本。MIME 数据补全名称，不限制文件类型；`.jpeg` 等兼容后缀保持不变。临时准备、部分写入及保留的导出共享 64 MiB；指针移开释放未使用文件，已交给系统的副本在 60 秒后过期。空间耗尽时显示通用重试提示，容量回收后可重试。调用方取消及退出会中止 Host 读取和主进程验证、打断图标等待并释放未使用文件。退出等待写入和释放，重试失败的删除，但不等待图标服务。异步系统文件图标避免主进程解码原图。

只有主应用窗口启用 `<webview>`。guest 挂载必须匹配主进程签发的租约和分区；guest 保持 sandbox、context isolation 和 Web security，不启用 Node integration 或 guest preload。Browser IPC 监听只为应用文档创建。[Sidebar Browser](../../packages/client/ui-sidebar-browser/README.zh.md) 说明存储分组和 guest 限制；Host 鉴权仍独立于 URL 过滤而必需。

`liwa-app://shell/` 无需联系 Host 即可提供打包的壳弹窗文档、脚本和样式。静态请求保留 GET/HEAD、路径范围和 MIME 处理；每个壳弹窗文档继续使用隔离 preload 和所属窗口的 IPC 校验。

产品 UI 保留 Web 操作，包括通过共享认证 HTTP 路由执行的“打开方式…”。Desktop 使用 Web 的自动目录选择机制，并以共享 Web 模板的 bundle 列表初始化新 profile。

Electron 根据应用语言选择类型化的八种[内置 Client 语言](../../packages/client/locale/README.zh.md)的 shell 文案，并回退到英文。macOS 应用包通过 `CFBundleLocalizations` 声明支持全部八种语言，让 macOS 根据用户的首选语言匹配初始应用语言。主界面仍优先使用已保存的 Client UI 语言偏好。全部内置语言资源的键、格式占位符和命令示例必须一致，`pnpm run check:i18n` 负责检查。账户平台页面和引导插图对中文以外的语言使用英文。在 Windows 上，主文档的语言会更新桌面菜单和恢复提示。仓库 Client UI i18n 检查覆盖桌面端源码。

Windows 和 macOS 会在原生全屏切换及每次页面加载后向渲染器同步全屏状态，让浮层调整顶栏避让距离。

Windows 使用 40 DIP 顶栏，保留原生窗口按钮，颜色随应用调色板同步。侧栏开关旁的本地化“应用”和“编辑”入口打开原生弹出菜单。仅当应用框架发布 shell overlay 席位后才挂载菜单，启动加载期间不显示。“应用”提供关于、管理 liwa 命令和退出；“编辑”向当前编辑器发送对应按键，提供撤销、重做、剪切、复制、粘贴、删除和全选，不受自定义快捷键绑定影响。插件管理使用主应用的“插件”页面。按 Alt 不会出现额外的原生菜单行。其他平台保留原生菜单。可编辑区域保留快捷键和不带快捷键标注的右键菜单；命令可用状态由 Chromium 提供，选中的只读文本提供“复制”命令。

macOS 上自定义菜单保留 Electron 的标准 Window 菜单及应用隐藏命令，包括 Minimize（⌘M）和 Hide（⌘H）。Linux 保留应用菜单和 Edit 菜单。

### 运行时与插件激活

应用资源中的 `resources/app.asar/liwa/desktop-runtime.json` 绑定 shell 版本、Electron 的 Node 版本、平台、架构、共享包版本和最终文件清单。启动读取元数据，并检查共享包记录。运行时 schema、shell 版本、目标兼容性和文件完整性在打包时验证。只有出现打包校验与实际 Host 诊断无法充分解释的具体安装故障，才重新引入启动时的运行时信息比较。首次启动不会把核心包复制到 profile 存储或通过 pnpm 安装核心包。

1. 主窗口在 profile 准备或后端启动前，从打包静态资源于屏幕外加载共享 Web 加载页。共享 profile 初始化创建缺失的 manifest、空用户 patch 与 pnpm workspace 文件，不覆盖现有文件。
2. 启动 Host 前，Desktop 校验运行时描述符并准备 profile，不改动已安装的包、依赖声明与锁文件；只删除早期 Link 后端启动写下的 `.liwa-module-fallback` 投影，启动从不运行 pnpm。profile 内的包保持原生优先级，本体包名通过 runtime resolution 解析（[查找顺序](../../.agents/notes/implemented/architecture/2026-09-19-profile-resolution-lookup-order.zh.md)；[清理移除](../../.agents/notes/implemented/simplification/2026-09-19-remove-desktop-profile-core-cleanup.zh.md)）。
3. Electron 的 Node 版本、平台或架构变化时保留已安装插件。原生兼容性问题在加载时报错，可通过 pnpm 修复。
4. 主应用的“插件”页面通过共享[插件管理器](../../packages/boot/plugin-manager/README.zh.md)操作 Desktop profile。包操作使用内置 pnpm 及正常的用户和 profile 配置。
5. 共享管理器负责安装错误、激活和重启要求。即使 Host 无法启动，原生恢复仍可禁用第三方 bundle。

[Web 插件 UI](../../packages/client/ui-plugin-manager/README.zh.md)负责管理界面。Desktop profile 初始化和恢复保留已安装插件文件。

Desktop 的致命故障通过原生恢复对话框提供退出、重启、禁用第三方插件并备份 profile patch 后重启，以及获取诊断报告。触发范围、报告位置与内容、近期操作记录和退出限制见[故障恢复与诊断](docs/diagnostics/README.zh.md)。

### Host 环境

macOS 和 Linux 从图形界面启动的程序只继承会话管理器提供的环境，不包含 shell 启动文件导出的变量。第一个 Host 启动之前，Desktop 以 `<shell> -ilc` 运行一次账户的登录 shell（取自用户数据库，不看 `$SHELL`），读取定界符之间的 `env -0` 输出，使 `~/.zprofile` 和 `~/.zshrc`（或该 shell 的对应文件）对 Host、agent shell、终端和 profile 配置生效。读取与 profile 准备并行进行。读取进程没有终端输入，并设置 `DISABLE_AUTO_UPDATE=true`、`ZSH_TMUX_AUTOSTARTED=true` 和 `ZSH_TMUX_AUTOSTART=false`，避免 oh-my-zsh 和 tmux 插件阻塞。shell 的值覆盖继承的值，但 `PWD`、`OLDPWD`、`SHLVL`、`_`、上述读取变量以及启动方自有的 `LIWA_*` 和 `ELECTRON_*` 除外；Desktop 在读取之前已按 `LIWA_HOME` 等变量解析路径，因此 Host 保持相同的值。读取在结束定界符出现时完成，因此启动文件启动的后台进程可以继续运行，其输出被丢弃。候选 shell 无法启动、以非零状态退出、没有输出定界内容或超过 `LIWA_DESKTOP_LOGIN_SHELL_TIMEOUT_MS`（1000 到 2147483647 的整数毫秒，默认 `10000`；超时会结束其进程组）时，Desktop 记录一条警告，并依次尝试 `/bin/zsh`、`/bin/bash` 和 `/bin/sh`；全部失败时 Host 使用继承的环境。读取命令使用 POSIX 语法，因此 csh、tcsh 或 nushell 等账户 shell 会失败，Host 改为获得第一个系统 shell 的启动文件所设置的环境。读取期间退出 Desktop 会结束正在运行的读取进程组。每个应用进程只读取一次，因此修改 shell 启动文件后需要退出并重新打开 Desktop。Windows 从图形界面启动的程序已经从注册表继承用户和系统环境变量，因此 Windows 跳过这一步。

<a id="develop"></a>

## 开发

开发环境应用菜单提供“刷新页面”（macOS 为 Cmd+R，其他平台为 Ctrl+R）和“重启应用与 Host”。重启会等待 Host 关闭，再重新启动 Electron 和新的 Host；这两项操作都不会重新构建源码。

`dev:desktop` 会构建当前 Host、客户端 bundle、Web 前端和 Electron 壳，把已构建的 CLI 包、私有 Desktop Host 包及其 workspace 依赖投影为一次性桌面 npm 项目，然后直接启动 Electron；这条路径不从 npm 解析 liwa：

```sh
pnpm run dev:desktop
```

开发灵鲸状态默认写入 `apps/desktop/.desktop-build/development/home`，一次性 npm 项目位于 `apps/desktop/.desktop-build/development/project`，Electron 浏览器数据则位于 `apps/desktop/.desktop-build/development/electron-user-data`。因此，会话、设置、凭据、包链接和浏览器数据都不会进入用户正常使用的灵鲸 home；显式 `LIWA_HOME` 只会替换开发灵鲸 home。Renderer DevTools 默认自动打开，Main、Renderer 和 liwa Host 调试端口依次为 9229、9222 和 9230。`LIWA_DESKTOP_MAIN_INSPECT_PORT`、`LIWA_DESKTOP_RENDERER_DEBUG_PORT` 与 `LIWA_DESKTOP_HOST_INSPECT_PORT` 可以替换这些端口，`LIWA_DESKTOP_OPEN_DEVTOOLS=0` 则保持 Renderer 调试窗口关闭。

显式构建完成后，`start:desktop` 会重新生成一次性项目，并跳过构建直接启动已有产物：

```sh
pnpm run start:desktop
```

桌面包准备过程只保留 macOS arm64 的可选原生包。

Web 侧的对应命令是 `pnpm run dev:web` 与 `pnpm run start:web`，见[开发指南](../../docs/development.zh.md)。Workspace 开发使用 Electron RunAsNode 运行当前 CLI 与私有 Desktop Host 包，插件管理和恢复使用 `$LIWA_HOME/profiles/desktop`，与一次性工作区运行时分离。Host 在开发与打包构建中都使用 runtime 模块解析，不创建官方包的 fallback 链接；开发者安装的包（包括链接）保留原生优先级。需要验证 Electron RunAsNode、内置 pnpm、内置 liwa 资源、插件安装和修复时，应运行 `pnpm run package:desktop:dir` 生成的应用目录。

[原生输入与渲染进程键盘测试](tests/keyboard.spec.ts)直接纳入仓库 Client 类型检查。它只导入不依赖 Cordis 的 Desktop 输入、持久化、IPC、浏览器 guest 和蒙层模块。

安装工作区依赖不会自动运行锁定版本 Electron 提供的独立二进制安装程序。直接运行 [Windows 控制台信号测试](tests/windows-cli-signals.spec.ts)前，在仓库根目录执行 `pnpm --filter @liwa/desktop exec install-electron`，准备锁定版本的 Electron 二进制。通过代理下载时，为该安装进程启用 `ELECTRON_GET_USE_PROXY=1`。Windows 覆盖率检查要求安装成功后，才启动带覆盖率插桩的单元测试集。

### 启动引导

API Key 输入框初始为空，并通过 `autocomplete="new-password"` 请求 Chromium 不要自动填入已保存的登录密码。

重复启动和 `liwa://open` 会保持工作区隐藏，直到启动凭据检查或欢迎页操作允许进入。从 Welcome 进入时，键盘焦点落在文档上，不选中侧边栏控件；Tab 导航仍可使用。

Desktop 在 Host 启动后、打开工作区前检查模型 API Key 引用是否已配置。没有已配置的密钥时，欢迎窗口提供 API Key 页面。“保存并继续”通过现有凭证服务写入 DeepSeek 官方提供方配置的引用，然后打开工作区。“稍后配置”打开工作区，但不保存草稿或完成标记；下次进程启动时会重新检查凭证。“返回”回到入口并清空未保存的密钥和校验提示。保存或打开工作区期间，按钮保持原文案并禁用竞争操作。Desktop preload 标记使 Web 凭证弹窗不再显示，同时保留模型设置页和欢迎须知。

欢迎窗口在显示前读取共享的 `locale.preference`。用户明确选择的受支持语言优先；否则 Desktop 按系统语言顺序匹配支持的语言，并以英文兜底。主界面在挂载前通过隔离 preload 读取同一偏好和系统语言顺序。在设置中切换语言会更新桌面壳的当前词典和菜单；自动选择不会写入偏好。欢迎窗口不提供语言切换入口。

Welcome 文字使用 Montserrat Light 并回退到系统字体，底部大按钮保留系统字体，文字按钮使用 Montserrat Light。英文欢迎正文及产品名均为 24px，中文欢迎正文为 24px、产品名为 26px。操作按钮宽 240px，文字为 14px。API Key 页的标题为 20px，返回操作为 14px，次级按钮底边距窗口底部 84px。 样式表、WOFF2 文件和 SIL Open Font License 由 `renderer/` 持有并随该目录打包，仅由欢迎页加载。

### 欢迎窗口外观

欢迎窗口使用设计稿的 light/dark 颜色跟随系统外观，展示 600 × 700 的入口布局和 API Key 表单，包含原生窗口控件、可拖动标题区域、本地品牌 SVG、系统无衬线字体回退，以及非按钮文字使用的本地 Montserrat Light 字体。窗口使用 macOS menu vibrancy 或 Windows acrylic，叠加 onboarding 的窗口背景色：浅色模式为 40% 白色，深色模式为 50% rgb(24 25 28)。本地 React 欢迎入口将 React 及其 CSS 一起打包；它通过隔离 preload 工作，不加载主 Web 应用。入口和 API Key 页面共用固定的底部操作行；“返回”链接位于操作行下方。按钮共用平台的过渡时序，开启“减少动态效果”会禁用过渡。操作系统控制模糊强度和外部圆角。macOS 的“降低透明度”会抑制半透明效果，“增强对比度”会强制开启该设置。“保存并继续”写入开发环境的凭证存储；“稍后配置”打开真实工作区，不保存密钥或完成标记。生成的开发项目同时链接已声明的 workspace 依赖闭包和 pnpm 提升的包，因此未提升的配置插件仍能解析。[窗口记录](../../.agents/notes/implemented/architecture/2026-09-08-desktop-welcome-window-material.zh.md)负责材质与引导决策。

<a id="package"></a>

## 打包

桌面应用只在 Apple Silicon Mac 上本地打包：`pnpm run package:desktop` 生成带临时签名的 `Liwa.app` 和 DMG，不使用发布证书、不公证、不上传，也没有自动更新；升级方式是重新打包。步骤、产物位置和验收见 [Desktop 打包](packaging/README.zh.md)。

<a id="low-level-development-overrides"></a>

## 底层开发覆盖项

未打包的 Electron 进程使用应用目录下的 `.desktop-build/development/project` 作为开发项目。`LIWA_DESKTOP_PNPM_ENTRY` 和 `LIWA_DESKTOP_LIWA_DIR` 是带应用路径默认值的可选覆盖项。每次未打包启动都必须设置 `LIWA_DESKTOP_PRIMARY_RUNTIME_DIR`：开发启动器（`dev:desktop`、`start:desktop`）会把它设置为自己已准备目标的 primary-runtime 目录；缺少该变量的启动会以致命启动对话框失败。目录归打包脚本的目标路径所有，壳不自行推导。打包应用会忽略这些变量，从 `process.resourcesPath` 解析应用资源，并使用受管 Desktop profile。

<a id="known-limitations"></a>

## 已知限制

- Windows 材质效果仍需平台验证。

- 桌面应用只在 Apple Silicon Mac 上本地打包，只带临时签名、不公证，也没有自动更新。
- 依赖的生命周期脚本遵循 pnpm 的构建权限；Desktop 不提供单独的审批对话框。
- 桌面壳与 CLI liwa 共享 `$LIWA_HOME` 下的会话、设置、凭据、工作区和存储，但可执行包、插件激活和锁文件彼此隔离。

打包应用注册 `liwa://open`，只显示窗口而不传递凭证。macOS 开发启动器在 `.desktop-build/development` 下准备经临时签名的 `Liwa Dev.app`，在 Info.plist 中声明 `liwa` 并注册到 Launch Services。它加载当前工作区，并记录选定的开发 home、浏览器数据路径和调试设置，以供冷启动使用。启动此应用会将其设为 `liwa://` 默认处理程序；启动打包应用会重新注册打包版处理程序。生成的应用包不包含凭证，依赖工作区和已准备的运行环境继续存在。
