# native/

[English](README.md) | 中文

与灵鲸一同维护的原生源码和本地包。[`system/` workspace](system/README.zh.md) 负责 Landlock 启动器、POSIX flock 绑定、平台包和[版本流程](system/docs/release.md)。

## Workspace 与打包边界

`system/` 及其包属于仓库根 pnpm workspace，并共用根锁文件。开发和 CI 中的灵鲸消费方直接使用当前 workspace 的入口包，因此启动器约定变更与消费方更新可以在同一个改动中落地并一起测试。

主仓库的 `Node Addon System` 工作流为每个受支持架构构建并测试。这些包不发布到 npm：Desktop 打包在本机编译 `darwin-arm64` 二进制，并从本 workspace 打出入口包和该平台包。入口包继续将平台包声明为可选依赖，因此安装时只会选中与操作系统和 CPU 匹配的包。
