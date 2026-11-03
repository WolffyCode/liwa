---
description: "灵鲸各大脑提供方共用的 Paseo 提供方代码（agent 契约类型、协议文件、提供方工具、子 agent 存储、MCP 注入），以及它通往 subprocess seam 的桥。"
kind: "package-library"
---

# @liwa/brain-shared

[English](README.md) | 中文

## 概述

大脑提供方包的 Claude Code、Codex 与 ACP 客户端建在 Paseo 的代码上。本库放这些客户端共用的 Paseo 文件——从一个固定提交原样拷来、需要处原地改——以及把它们的进程操作送进 `ctx.subprocess` 的桥。提供方包按上游形状的子路径导入迁来的模块。本包不登记任何东西，也不拥有提供方；`NOTICE` 记录来源与每处原地改动。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时使用

提供方包（`brain-acp`、`brain-deepseek`、`brain-claude`、`brain-codex`）改造各自拷来的 Paseo 客户端时导入它：共用的 agent 契约、协议工具、提供方工具、提供方子 agent 存储与运行时 MCP 配置都只在这里放一份，各提供方不再各拷一份。

### 入口

```text
import type { AgentSession, AgentStreamEvent } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { checkProviderLaunchAvailable, resolveProviderLaunch } from '@liwa/brain-shared/paseo/agent/provider-launch-config'
import { spawnProviderProcess } from '@liwa/brain-shared'

const launch = await resolveProviderLaunch({ defaultBinary: 'claude' })
const { available } = await checkProviderLaunchAvailable(launch, ctx.subprocess)
const child = spawnProviderProcess(launchContext, launch.command, launch.args, { cwd, graceMs: 5_000 })
```

包根导出桥：`findProviderExecutable`（解析出的路径，或 `null`）、`execProviderCommand`（收集到的输出，或带退出事实的 `ProviderCommandError`）、`spawnProviderProcess`（管道 stdio，经句柄终止）。把大脑会话的启动上下文当作 host 传入，会话就会登记这个进程。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`src/paseo/` 下每个文件都是上游 Paseo 源码，第一行注明来源；要改的行原地改并标注，不叠映射层。本包按 Paseo 自己的严格程度编译 `src/paseo/`（不开 `noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes`），lint、导出文档、断言、重复代码与覆盖率检查对 `src/paseo/` 的处理与 `vendor/` 相同。

| 路径 | 职责 |
|---|---|
| [`src/paseo/agent/`](src/paseo/agent/agent-sdk-types.ts) | agent 契约、启动配置、提供方选项与提示、刷新时限、会话导入、时间线工具、子 agent 存储、运行时 MCP 配置 |
| [`src/paseo/agent/providers/`](src/paseo/agent/providers/provider-runner.ts) | 提供方回合驱动、工具调用映射工具、诊断、图片输出、JSONL 分帧 |
| [`src/paseo/protocol/`](src/paseo/protocol/agent-types.ts) | 协议类型、提供方配置 schema、工具名、路径、工具调用展示 |
| [`src/paseo/utils/`](src/paseo/utils/path.ts) | 超时、路径等价、字符串命令 shell |
| [`src/process.ts`](src/process.ts) | 从 Paseo 进程调用到 subprocess seam 的桥 |
| [`NOTICE`](NOTICE) | 上游提交、许可证与逐文件改动清单 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [@liwa/brain](../brain/README.zh.md)——提供方适配器把这些类型映射到的契约。
- [@liwa/subprocess](../../subprocess/subprocess/README.zh.md)——桥对接的进程 seam。
- [第三方声明](../../../THIRD_PARTY_NOTICES.md)——全仓库拷入源码的记录。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本库只提供提供方侧的代码；每个提供方包管它的 CLI 发给模型的内容。

#### KV Cache 影响

这里没有任何东西组装模型请求，不会让已缓存的前缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Paseo 的产品功能链没迁**——附件、Paseo 自己的工具目录与展示、提供方快照管理、OpenCode 桥与 AgentManager 胶水都没拷；受影响的类型与分支已原地删去。
- **跟进上游要手工**——升到更新的 Paseo 提交，要重新拷文件并重做 `NOTICE` 列出的改动。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
