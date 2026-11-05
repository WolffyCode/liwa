---
description: "通用的 Agent Client Protocol 大脑提供方：Paseo 的 ACP 客户端升到 ACP SDK 1.4，为任意 ACP agent CLI 登记进 ctx.brains，Paseo 的厂商适配做成配置。"
kind: "package-reference"
---

# @liwa/brain-acp

[English](README.md) | 中文

## 概述

把任何说 Agent Client Protocol 的 agent CLI（Gemini CLI、OpenCode、Copilot、Cursor、Kimi、Kiro、Trae…）作为大脑提供方接进 `ctx.brains`。客户端是 Paseo 的 `ACPAgentClient`，原样拷来、从 ACP SDK 0.17 升到 1.4；Paseo 的厂商适配是一项 `vendor` 配置。一行插件配置是一个提供方；同一个插件用不同的行挂多次，就接多家 CLI。`deepseek` 提供方也建在这个客户端上。

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

### 配置一个提供方

跑灵鲸进程的 bundle（`web`、`headless`、`brain`）带一行关着的 `brain-acp`。打开它并写上 CLI 的命令；每多接一家 CLI 就再加一行、换一个 `impl`：

```yaml
- id: brain-acp
  name: '@liwa/brain-acp'
  config:
    impl: gemini
    command: [gemini, --experimental-acp]
    env: {}
    vendor: generic
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `impl` | `acp` | 在 `ctx.brains` 里的提供方名 |
| `command` | — | CLI 的 argv，从不经 shell 解释。除 `copilot`（默认 `copilot --acp`）外必填 |
| `env` | `{}` | 显式交给 CLI 的环境项，越过 subprocess 的剥离 |
| `vendor` | `generic` | Paseo 的厂商适配：`generic`、`copilot`、`cursor`、`kimi`、`kiro`、`trae` |
| `label` | — | 诊断里显示的名字 |

[配置目录](../../../docs/config-catalog.zh.md#liwabrain-acp)是完整来源。

### 一个会话做什么

会话经它的启动上下文拉起一个 CLI 进程（`ctx.brains` 因此记下它），用会话的 MCP 服务器（toolport 端点与调用方给的服务器）跑 `initialize` 与 `session/new`，把 `session/update` 流成 `BrainEvent`，经 `permission.request` 回答 `session/request_permission`（只给一次性选项；CLI 只给永久选项时才露出永久选项；请求自己带的工具事实——标题、种类、原始入参、它的文字作 `description`——优先于先前的快照，所以 CLI 没流过的调用（例如子会话的）也有说明），把表单式的 `elicitation/create` 翻成一个 `question` 请求、用它结构化的 `answers` 填表（选项进各问题自己的字段，补充文字进它的"其他"字段；表单装不下的答案被拒，不丢），经 `session/load` 或 `session/resume` 续接。模型走标准的 `session/set_config_option`，模式走 `session/set_mode`（会话没有的 `modeId` 让 `createSession` 失败），图片作为 ACP 图片块发出，`SessionConfig.env` 交给 CLI 进程。`session/cancel` 只是通知，所以 `cancel` 等被取消的提示词返回。通用 CLI 声明没有下一步投递（`deliver(next_step)` 答 `unsupported`）、原生工具关不掉、压缩恒开；ACP 表达不了 `alwaysLoad`，标了它的 MCP 服务器被拒，除非提供方知道它的 CLI 从不延迟加载工具（`defersMcpTools: false`）。

### 在它上面建别的提供方

`AcpBrainProvider` 包住任意 `ACPAgentClient`；子类覆写 `sessionConfig`、`launchContext` 或 `wrap`，把会话交给 `AcpBrainSession`（或它自己的子类）。`ACPAgentClient.sessionExtension` 给每个会话挂一个 `ACPMetaExtension`：给发出的请求加 `_meta`，并在 Paseo 翻译前看到每条进来的原始消息。`ACPAgentSession.requestExtension` 调会话上一个 `_` 开头的方法。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`src/paseo/agent/providers/` 放 Paseo 的 ACP 客户端和它的厂商适配，从一个固定提交拷来、原地改（`NOTICE` 列出每处改动）。ACP SDK 在那里从 0.17 升到 1.4：`ClientSideConnection` 换成 `client()` 加 `connect(ndJsonStream(...))`，每个调用换成 `connection.agent.request(methods.agent.…)`，取消换成 `notify`，扩展通知按名字登记。进程走 `@liwa/brain` 的进程帮助与 subprocess 句柄，不用 `node:child_process` 与 `tree-kill`。运行时在两回合之间退出，按 Paseo 的 Claude 适配器的方式报：一个不带回合号的 `turn_failed`。`src/adapter.ts` 只映射类型，`src/elicitation.ts` 把表单读成问题、把答案填回表单；拷来的客户端只为表单问答接线。事件翻译本身是 `@liwa/brain-shared` 的 `PaseoBrainSession`。`src/paseo/` 是单独的 TypeScript 项目，用 Paseo 的编译选项；`src/*.ts` 按全仓库的严格程度编译。

| 路径 | 职责 |
|---|---|
| [`src/paseo/agent/providers/acp-agent.ts`](src/paseo/agent/providers/acp-agent.ts) | Paseo 的 ACP 客户端与会话（SDK 1.4） |
| [`src/paseo/agent/providers/generic-acp-agent.ts`](src/paseo/agent/providers/generic-acp-agent.ts) | 按命令配置的通用客户端 |
| [`src/adapter.ts`](src/adapter.ts) | 契约配置、启动上下文、权限选项；`AcpBrainProvider` |
| [`src/elicitation.ts`](src/elicitation.ts) | 表单式 elicitation 与契约问题、结构化答案的互转 |
| [`src/index.ts`](src/index.ts) | 插件：选厂商适配并登记 |
| [`NOTICE`](NOTICE) | 上游提交、许可证与逐文件改动清单 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [@liwa/brain](../brain/README.zh.md)——提供方契约与 `ctx.brains`。
- [@liwa/brain-shared](../brain-shared/README.zh.md)——共用的 Paseo 代码与会话映射。
- [@liwa/brain-deepseek](../brain-deepseek/README.zh.md)——建在这个客户端上的灵鲸自己的 agent，带 `_liwa` 扩展。

-----

<a id="model-experience"></a>
## 模型体验

间接地，经它驱动的 ACP agent CLI；每次模型请求都由那个 CLI 用会话给它的提示词与 MCP 服务器组装。

#### KV Cache 影响

提供方不往请求里加任何东西；哪些内容留在缓存里由 CLI 自己的提示词组装决定。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只有 `deepseek` 对真 CLI 验收过**——厂商适配作为配置迁来了；Gemini CLI、OpenCode、Copilot 等还没端到端跑过。
- **没有插话，也没有模型目录**——ACP 没有下一步投递；Paseo 的模型目录、导入与诊断方法迁来了，但 `ctx.brains` 里还没有东西调它们。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
