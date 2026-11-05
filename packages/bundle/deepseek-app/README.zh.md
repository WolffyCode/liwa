---
description: "liwa 的 deepseek profile：每个进程经 ACP stdio 提供一个灵鲸 agent 会话，带灵鲸的 _liwa 扩展，每种会话一个 agent 预设——大脑提供方 deepseek 拉起的进程。"
kind: "package-bundle"
---

# @liwa/deepseek-app

[English](README.md) | 中文

## 概述

`liwa --profile deepseek` 是把灵鲸自己的 agent 做成一个 agent CLI：底座的标准 ACP v1 服务器跑在 stdio 上，加上 `_liwa` 扩展与五个 agent 预设，每种会话一个。它不开端口。大脑提供方 `deepseek`（`@liwa/brain-deepseek`）为每个会话拉起一个这样的进程，各自一个 `LIWA_HOME`；去掉 `_liwa` 那一行，进程就是任何 ACP 客户端都能驱动的普通 ACP agent。包根就是 `_liwa` 扩展插件，也导出 `_liwa` 线格式，提供方从这里导入。

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

### 运行

随包的 `deepseek` profile（`@liwa/base`、`@liwa/deepseek-app`）首次使用时建好。它在 stdin 与 stdout 上提供 ACP，直到客户端断开：

```text
liwa --profile deepseek
```

通常由提供方 `deepseek` 拉起它；每次拉起前提供方往会话的 `LIWA_HOME` 写一份 home 级 `cordis.patch.yml`，放人格前缀、模型与默认预设。

### `_liwa` 扩展

| 消息 | 方向 | 含义 |
|---|---|---|
| `session/new`、`session/resume` 的 `_meta.liwa` | 客户端 → agent | `mindKind`（选预设）、`owner`、`notes`（一个 Agent 作用域的系统提示词段）、`version`、`limits`（每回合的推理与工具调用次数）、`concludeOn`、`model`、`keepQueue`、`childPolicy`、`nativeToolPolicy`（`none` 只留会话的 MCP 工具，`readonly` 只留配置的 `readonlyTools`） |
| `_liwa/steer` | 客户端 → agent | 在运行中回合（提示词，或会话自己跑起来的回合）的下一步送到的文本与内联图片；答 `accepted` 或 `unavailable` |
| `_liwa/usage` | 客户端 → agent | 会话开着以来的用量（含子会话），附 `mindKind` 与 `version` |
| `_liwa/children` | 客户端 → agent | 会话的原生子 agent 与它们的用量 |
| `session/prompt` 返回的 `_meta.liwa` | agent → 客户端 | 这次 prompt 的 `usage`；收尾工具结束回合时带 `concludedBy` |
| `session_info_update` 的 `_meta.liwa.child` | agent → 客户端 | 子 agent 开始或结束，带它的用量 |
| `session/request_permission` 的 `_meta.liwa.childId` | agent → 客户端 | 请求来自哪个子会话（根会话的请求不带） |
| `session/cancel` 的 `_meta.liwa.keepQueue`、`stopChildren` | 客户端 → agent | 取消时保留还是丢掉排队的输入；是否连在跑的子 agent 一起停 |
| `session_info_update` 的 `_meta.liwa.turn` | agent → 客户端 | 根会话在没有提示词时开始了一个回合（后台子 agent 的结果叫醒了它）或结束了它，带这一回合的用量与结束原因 |

推理预算拒绝下一步，所以回合在最后一次允许的推理之后正常结束；工具预算与子会话策略拒绝那次工具调用，并给模型一句原因。进程内子 agent 转交它们的审批（`subagent.delegatedApproval: forward`），子 agent 的越权请求带着 `childId` 经根会话到达客户端；ACP 服务器经表单式 elicitation 提问（`ask_user_question`、计划审批），并把计划模式映射成会话模式 `default` 与 `plan`。

### 预设

| 预设 | 会话种类 | 工具 |
|---|---|---|
| `deepseek-instance` | 成员的实例 | 无（内核工具经 MCP） |
| `deepseek-work`（默认） | 工作与研究任务 | shell、文件、搜索、后台任务、待办、网络、`present`、`ask_user_question`、目标、计划模式、原生子 agent（可选子 agent 模型的 `subagent`、`subagent_fork`、工作流） |
| `deepseek-think` | 思考任务 | 只读文件、搜索、网络 |
| `deepseek-own` | 她自己的活动 | 文件、搜索、网络、待办 |
| `deepseek-tidy` | 夜间整理 | 只读文件与搜索 |

仓库说明与成员规矩（`agent-instructions`）、技能（`skill-filesystem`、`skill`）、压缩（`compaction-basic`、`tool-result-pruner`）在这里是宿主层的行，默认挂着；`deepseek` 提供方的会话 patch 按 `projectDocs`、`rules`、`skillsDir`、`compaction` 逐会话开关它们。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

patch 插入启动行、`acp` 行（等启动服务与默认模型选择）和 `deepseek-liwa`（包根）；关掉宿主上面向模型的工具行，把它们挪进预设；插入以 `deepseek-work` 为默认的 `agent-preset-registry`。`deepseek-liwa` 只经 `ctx.acpExtensions` 接到 ACP 服务器：每个会话在建好的 agent 上挂预设、加说明段、选模型、装预算与收尾钩子；全局地数工具调用、累计 assistant 用量，并把 `subagent/start`、`subagent/end` 变成子会话更新。预设不带人格行，因为人格是会话 patch 里的 `personaPrefix`。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | profile 叠在 base 上的各行 |
| [`presets/`](presets/work.patch.yml) | 每种会话一个 agent 预设 |
| [`src/index.ts`](src/index.ts) | `_liwa` 扩展插件（包根），并转出线格式 |
| [`src/protocol.ts`](src/protocol.ts) | `_liwa` 线格式（zod schema） |
| [`src/startup.ts`](src/startup.ts) | 命令行、帮助与 stdin 结束 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [@liwa/brain-deepseek](../../brain/brain-deepseek/README.zh.md)——拉起这个进程的提供方。
- [@liwa/acp](../../acp/acp/README.zh.md)——ACP 服务器与它的扩展口。
- [Bundle 分组](../README.zh.md)——其余随包的层。

-----

<a id="model-experience"></a>
## 模型体验

### 会话说明系统提示词段

#### 模型看到的内容

`_meta.liwa.notes` 非空时，它的文本成为 Agent 作用域的系统提示词段 `liwa:session-notes`（顺序 `10150`），原样插入，不做模板插值：

##### 会话说明段

```markdown
<the text of _meta.liwa.notes>
```

#### Token 影响

说明的长度，会话的每次请求都带。

#### KV Cache 影响

会话打开时就定了，所以留在缓存的系统提示词前缀里；新的说明在下一代会话生效。

### 插话消息

#### 模型看到的内容

`_liwa/steer` 在运行中回合的下一步之前作为一条用户消息到达，文本块原样：

##### 插话输入

```markdown
<the text blocks of the _liwa/steer prompt>
```

#### Token 影响

插话文本，往对话里追加一次。

#### KV Cache 影响

仅追加；位于缓存前缀之后，不使任何条目失效。

### 预算与子会话策略的拒绝

#### 模型看到的内容

被拒的工具调用返回一个带原因的错误工具结果：`Error: the tool-call budget of this turn (<n>) is spent; conclude the turn`、`Error: native child agents are disabled for this session`、`Error: child agents may nest at most <n> level(s)` 或 `Error: at most <n> child agent(s) may run at once`。

#### Token 影响

每次被拒一句短话。

#### KV Cache 影响

仅追加，与任何工具结果一样。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **子会话不继承审批**——底座把进程内委派的子会话的审批固定为 `never`，子会话的提权直接被拒，到不了客户端。
- **预设没有 `complete` 步骤**——预设没有用结构化结果结束任务的钩子；任务靠收尾工具结束。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
