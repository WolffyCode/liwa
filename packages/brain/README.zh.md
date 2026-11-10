---
description: "大脑能力包：agent CLI 契约与 ctx.brains，以及各 CLI 提供方共用的 Paseo 提供方代码。"
kind: "package-group"
---

# packages/brain

[English](README.md) | 中文

## 概述

大脑提供方把 agent CLI——deepseek agent 进程、Claude Code、Codex 与通用 ACP agent——以同一份会话契约接进灵鲸。本组拥有这份契约与 `ctx.brains` 服务，以及各 CLI 提供方共用的 Paseo 提供方代码。每个 CLI 提供方是单独的包，登记进 `ctx.brains`。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

`brain` 挂一次；提供方包基于 `brain-shared` 并登记进它。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`brain`](brain/README.zh.md) | 大脑提供方契约、提供方登记与会话句柄 | `ctx.brains` |
| [`brain-shared`](brain-shared/README.zh.md) | 各 CLI 提供方共用的 Paseo 提供方代码，以及 Paseo 会话到契约的映射 | —（库） |
| [`brain-acp`](brain-acp/README.zh.md) | 建在 Paseo ACP 客户端上的通用 ACP agent CLI 提供方 | 登记进 `ctx.brains` |
| [`brain-deepseek`](brain-deepseek/README.zh.md) | 提供方 `deepseek`：每个会话一个 `liwa --profile deepseek` 进程 | 登记进 `ctx.brains` |
| [`brain-claude-code`](brain-claude-code/README.zh.md) | 官方 SDK 接本机 Claude Code，成员与提供方配置隔离 | 登记进 `ctx.brains` |

<a id="related-documentation"></a>
## 相关文档

- [大脑提供方](../../docs/subsystems/brain.zh.md)——契约、会话句柄与带版本的登记。
- [大脑测试工具](../test-support/brain-testkit/README.zh.md)——脚本提供方与契约测试。
- [大脑命令](../bundle/brain-cli/README.zh.md)——`liwa brain list|probe|run`。

<a id="dev-note"></a>
## 开发备注

无。
