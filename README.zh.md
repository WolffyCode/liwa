# 灵鲸

[English](README.md) | 中文

灵鲸（Liwa，命令 `liwa`）是主人自托管的数字生命。代码底座 fork 自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT，提交 `f3803c96`，0.2.2-alpha.2），已独立维护，不再跟随上游同步。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。灵鲸经 DeepSeek API 使用 DeepSeek 的模型。

## 开发者预览

灵鲸处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

<a id="run-from-source"></a>

### 从源码运行

灵鲸没有发布到 npm。如需从仓库源码运行：

```sh
git clone https://github.com/WolffyCode/liwa.git
cd liwa
pnpm install
pnpm run build
pnpm liwa web
```

`pnpm run build` 会准备仓库产物。`pnpm liwa web` 会直接使用这些已构建产物，不会重新构建。该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

灵鲸的数据放在 `~/.liwa`；设置 `LIWA_HOME` 可改用其他目录。

桌面应用只在 Apple Silicon Mac 上本地打包：`pnpm run package:desktop` 生成 `Liwa.app`，不签发布证书、不公证、也没有自动更新。详见 [Desktop 打包](apps/desktop/packaging/README.zh.md)。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)。上游 DeepSeek Harness 的版权声明保留在其中。

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
