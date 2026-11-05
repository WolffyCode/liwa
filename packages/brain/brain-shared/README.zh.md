---
description: "灵鲸各大脑提供方共用的 Paseo 提供方代码（agent 契约类型、协议文件、提供方工具、子 agent 存储、MCP 注入），以及灵鲸把 Paseo agent 会话映射到 brain.provider 会话契约的那一层。"
kind: "package-library"
---

# @liwa/brain-shared

[English](README.md) | 中文

## 概述

大脑提供方包的 Claude Code、Codex 与 ACP 客户端建在 Paseo 的代码上。本库放这些客户端共用的 Paseo 文件——从一个固定提交原样拷来、需要处原地改——以及每个基于 Paseo 的提供方共用的灵鲸代码：Paseo agent 会话到 `brain.provider` 会话契约的映射、回合输入的渲染、拷来代码要的 pino 形状日志器。提供方包按上游形状的子路径导入迁来的模块。本包不登记任何东西，也不拥有提供方；`NOTICE` 记录来源与每处原地改动。

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

提供方包（`brain-acp`、`brain-deepseek`、`brain-claude`、`brain-codex`）改造各自拷来的 Paseo 客户端时导入它：共用的 agent 契约、协议工具、提供方工具、提供方子 agent 存储与运行时 MCP 配置都只在这里放一份，各提供方不再各拷一份。客户端产出 Paseo `AgentSession` 的提供方用 `PaseoBrainSession` 包住它，只覆写不同之处，不自己再映射一遍事件。

### 入口

```text
import type { AgentSession } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { PaseoBrainSession, paseoLogger } from '@liwa/brain-shared'

const logger = paseoLogger(ctx.logger('brain-claude'))           // what copied Paseo code calls `Logger`
const session: AgentSession = await client.createSession(paseoConfig, { agentId: launch.sessionId, processHost: launch })
return new PaseoBrainSession({ impl, meta, session, blobs: launch }) // a BrainProviderSession
```

`PaseoBrainSession` 把 `AgentStreamEvent` 翻成 `BrainEvent`，按 `Meta.delivery` 答 `deliver`：

- **回合与条目**——父会话开着的消息与思考按回合各记一份，回合结束只给它自己的消息补 final：旧回合的取消确认晚到，也碰不到新回合的条目；已结束回合晚到的条目丢掉。每个工具调用记着自己的回合与子 agent，父回合结束只收尾父会话自己没结束的调用。两回合之间运行时退出报 `session.exited`；`beginProviderTurn` / `finishTurn` 报 CLI 自己开始的回合。
- **子 agent**——`provider_subagent` 翻成 `child.*`。子 agent 的条目带它的 `childId` 与开它的回合，那个回合结束后照常到达；结束过的子 agent 又报在跑时重新打开。
- **权限与问答**——原生动作翻成一次性选项；没有动作的请求（Claude、Codex 的工具审批与提问）给一个 `allow_once`（提问是"作答"），每个请求都补上 `deny_once` 与 `cancel`；对不上的选项号按 `deny_once` 答。提问带有类型的 `questions`（`permissionQuestions`，默认读 Paseo 的 `input.questions`），允许类答复必须带 `answers`。答案过边界时一直是结构：`permissionAnswerInput` 交给提供方适配器的 `updatedInput.answers` 以问题号为键，每个是 `{ selected, custom? }`（`structuredAnswers`），从不把选项与补充文字拼成展示文字；适配器要原生形状的提供方在这里翻，原生形状装不下的答案以 `invalid_input` 拒绝（请求仍待答）。`permissionChildId` 把请求归到子 agent，这样的请求可以在没有父回合时到达。
- **取消**——Paseo 确认了中断就够：`interruptTurn` 完成后，调用时捕获的回合若还没结束就补报 `turn.interrupted`，之后的回合不受影响。中断只是通知的协议在自己的子类里等（`whenTurnEnds`）。
- **模型与模式**——`setModel` 换完核对运行时信息，没换成就拒绝；`availableModes`、`currentMode`、`setMode` 映射 Paseo 的模式，"下一回合生效"的提示变成 `appliesAt: 'next_turn'`。`mode_changed`、`model_changed` 翻成 `session.*_changed` 事件；一次切换 Paseo 会报两遍模式状态（切换调用一遍、CLI 确认一遍），状态没变只报一次。
- **输入**——`toPaseoPrompt` 渲染 `TurnInput`：具名块渲染成 `<liwa-block name="…">` 并转义结束标记，图片从 blob 存储读回，成为 Paseo 的内联图片块。

子类覆写受保护的钩子：`toolName`、`toolArgs`、`toolResult`、`permissionTool`、`permissionChildId`、`permissionOptions`、`permissionQuestions`、`permissionAnswerInput`、`turnUsage`、`childUsage`、`modelName`、`nativeModel`、`modeAppliesAt`、`steer`、`interruptTurn`、`decorate`。续接句柄里去掉 Paseo 的配置元数据。进程帮助（`spawnProviderProcess` 等）在 `@liwa/brain`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`src/paseo/` 下每个文件都是上游 Paseo 源码，第一行注明来源；要改的行原地改并标注，不叠映射层。`src/paseo/` 是单独的 TypeScript 项目（`tsconfig.paseo.json`），按 Paseo 自己的严格程度编译（不开 `noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes`）；灵鲸自己的模块是本包的主项目（`tsconfig.json`），按全仓库的严格程度编译，单向引用拷来的项目。lint、导出文档、断言、重复代码与覆盖率检查对 `src/paseo/` 的处理与 `vendor/` 相同。

| 路径 | 职责 |
|---|---|
| [`src/paseo/agent/`](src/paseo/agent/agent-sdk-types.ts) | agent 契约、启动配置、提供方选项与提示、刷新时限、会话导入、时间线工具、子 agent 存储、运行时 MCP 配置 |
| [`src/paseo/agent/providers/`](src/paseo/agent/providers/provider-runner.ts) | 提供方回合驱动、工具调用映射工具、诊断、图片输出、JSONL 分帧 |
| [`src/paseo/protocol/`](src/paseo/protocol/agent-types.ts) | 协议类型、提供方配置 schema、工具名、路径、工具调用展示 |
| [`src/paseo/utils/`](src/paseo/utils/path.ts) | 超时、路径等价、字符串命令 shell |
| [`src/session.ts`](src/session.ts) | `PaseoBrainSession`：把 Paseo agent 会话当作 `brain.provider` 会话 |
| [`src/turn-input.ts`](src/turn-input.ts) | 回合输入到 Paseo 提示词块、`<liwa-block>` 渲染 |
| [`src/logger.ts`](src/logger.ts) | 接在 cordis logger 上的 pino 形状日志器 |
| [`NOTICE`](NOTICE) | 上游提交、许可证与逐文件改动清单 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [@liwa/brain](../brain/README.zh.md)——提供方适配器把这些类型映射到的契约。
- [@liwa/brain-acp](../brain-acp/README.zh.md)——第一个建在这些模块上的提供方。
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
