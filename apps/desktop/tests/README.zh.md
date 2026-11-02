# Desktop 本地验证

[English](README.md) | 中文

## 概述

本页记录 Desktop 壳的本地验证方法：故障报告、壳弹窗主题和原生浮层可见性。打包产物的验收见 [Desktop 打包](../packaging/README.zh.md#verification)。

## 目录

- [故障报告验证](#verification-diagnostics)
- [壳弹窗主题](#verification-theme)
- [原生浮层可见性](#verification-overlay)

<a id="verification-diagnostics"></a>

## 故障报告验证

产品行为与限制见[故障恢复与诊断](../docs/diagnostics/README.zh.md)。

使用可丢弃的 profile、独立的 Electron `userData` 和实际打包客户端。构造最小本地组合包：`package.json` 的 `liwa.bundle.patch` 指向 `cordis.patch.yml`，需要执行代码时再加入插件模块，然后打成可本地安装的 `.tgz`。这些包会故意使应用出错，不得发布或安装到日常 profile。

分别构造模块导入异常、插件初始化异常、`appReady` 后的异步异常，以及 Host 非零退出。用 patch 禁用 `agent`、`session`、`llm`、`tools` 提供者，检查服务缺失诊断。跨重启场景通过 `pluginManager` 选入该组合包，再重启同一 profile。运行期场景须实际观察客户端就绪；`appReady` 不代表窗口已经显示。

检查原始错误与 cause 或退出码、跨重启的操作 ID 和 Host 运行 ID、报告收集完成标记与遗漏信息、原生弹窗中的文件获取，以及禁用插件恢复后的启动。记录安装包版本和源码提交；生成测试包成功或管理操作返回成功，都不能代替客户端功能验证。测试后恢复协议关联并退出测试进程。

资源验证可构造大型稀疏历史文件、大量无关文件、密集记录，以及损坏行和未完成行。在独立新进程中测量，分开记录数据构造与收集开销，并核对实际读取量、输出大小、耗时和峰值内存。验证 Worker 取消时，可用仅测试加载的模块钩子在写入进入标记后挂起异步文件打开操作；先确认标记，再观察期限到达后的 Worker 退出，并逐字节核对基本报告。该方法不模拟内核系统调用卡死，也不代替打包客户端验证。

<a id="verification-theme"></a>

## 壳弹窗主题

执行 `pnpm --dir apps/desktop run build` 后，在 macOS 上运行真实 Electron 配色夹具：

```sh
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/update-theme.mjs
```

夹具创建独立 profile，加载生产壳 HTML、sandboxed preload、渲染脚本及打包的 design token，仅替换固定 IPC 状态响应。6 个用例覆盖壳弹窗文档的浅色／暗色初始状态、打开时切换及跟随系统。它检查文档背景透明、卡片／文字／按钮／遮罩配色、代码／地址表面、仅暗色显示的 1 CSS px 内描边及关闭图标，并将两张截图和 `result.json` 写入 `.desktop-build/qualification/update-theme-*`。它不启动 Host，也不验证 Windows 原生渲染。首次关闭提示共用该文档的 CSS 和主题脚本。

<a id="verification-overlay"></a>

## 原生浮层可见性

在 macOS 上，编译 Desktop Host 源码后复用缓存的 Electron 运行时：

```sh
pnpm exec tsc -b apps/desktop/tsconfig.host.json
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/update-overlay-visibility.mjs
```

夹具使用独立 profile，在 `.desktop-build/qualification/update-overlay-*` 下写入 `result.json`。它检查可见和隐藏的父窗口、不创建原生子窗口、父窗口可见性通知后独立对照窗口仍保留焦点，以及销毁父窗口时的视图和输入清理。它不使用网络、产品登录或 liwa Host。这项验证覆盖窗内承载方式，不覆盖完整的首次登录或安装流程。
