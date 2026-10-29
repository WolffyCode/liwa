# AGENTS.md — vendor

本目录是 cordis 框架和它的基础库的源码副本（cordis `4.0.0-rc.12`、Loader `1.0.0-rc.9` 等，清单和上游提交号见 [README.md](README.md)），带本地修改。灵鲸 fork 后独立，这些副本归我们维护，不再从上游同步。

- 不要随手改 `vendor/*/src/`。每一处和上游的差异都要完整记进 [README.md](README.md) 的"Local modifications"，写明改了什么、为什么。
- `vendor/*/tsconfig.json` 是例外：它们为适配本仓库的构建生成，类型检查策略变了（例如 `noImplicitAny`）可以改。
- 改完跑 `pnpm run test` 和 `pnpm run build`。
