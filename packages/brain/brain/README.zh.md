---
description: "大脑提供方 seam（ctx.brains）：agent CLI 契约、提供方登记，以及记录用量、进程与子 agent 的会话句柄。"
kind: "package-reference"
---

# @liwa/brain

[English](README.md) | 中文

## 概述

`ctx.brains` 是 agent CLI 提供方登记的地方，也是成员层开它们会话的地方。提供方插件为一个 CLI（deepseek、Claude Code、Codex、通用 ACP）登记客户端；调用方用一份校验过的 `SessionConfig` 开会话，拿到一个流出 `BrainEvent` 的句柄。句柄汇总用量，记录每个拉起的进程与子 agent，并拒绝提供方 `Meta` 声明为 false 的语义。本包管契约与登记，不管 CLI 本身，也不管什么时候开会话。

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

### 挂载服务

在 `ctx.subprocess` 旁边挂一行；`membersRoot` 是成员配置目录所在的根。

```yaml
- id: brains
  name: '@liwa/brain'
  config:
    membersRoot: !!js liwaHomePath('members')
```

`web`、`headless` 与 `brain` 三个 profile 挂了它，连同提供方 `deepseek`（`@liwa/brain-deepseek`）和一行关着的通用 `acp`（`@liwa/brain-acp`）；`deepseek` profile 不挂，所以会话进程从不自己开会话。可选的时限（`handshakeTimeoutMs`、`callTimeoutMs`、`closeTimeoutMs`、`probeTimeoutMs`）约束对提供方的调用。`blobsDir`（缺省 `<membersRoot>/.blobs`）放图片回合输入背后的、按内容寻址的字节。

### 登记提供方

提供方插件注入 `brains`，用实现了 `BrainProvider` 的对象调用 `ctx.brains.register(provider)`：`impl`、`meta`、`sessionHome`、`probe`、`createSession`、`resumeSession`，可选 `writeMemberConfig`。登记时校验 `impl` 与 `meta`，重名拒绝，随登记它的插件释放；释放时关掉该提供方开着的会话。会话的每个进程都必须经启动上下文的 `spawn` 拉起，它先登记归属，再把请求交给 `ctx.subprocess`；`spawnProviderProcess`、`findProviderExecutable`、`execProviderCommand` 让提供方自己的拉起、查找与探测命令走同一条路。

`sessionHome` 说会话的 home 在哪：`per-member` 让成员的各会话共用 `<configDir>/<impl>`；`per-session` 给每个会话一个 `<configDir>/<impl>/<会话号>`，记进续接句柄（`home`），续接时回到同一目录。`writeMemberConfig` 写成员配置目录里属于该提供方的部分（规则、技能、设置）；登记处建好目录后调用它。

### 开会话

```text
const configDir = await ctx.brains.prepareConfigDir(member, impl, { rules, skillsDir, projectDocs })
const session = await ctx.brains.createSession(ctx, { impl, cfg: { ...config, configDir } })
session.subscribe(event => { /* BrainEvent */ })
const { turnId } = await session.startTurn({ blocks: [{ kind: 'text', text: 'hello' }] })
```

`model` 可省：不给时由提供方的 CLI 用它自己的默认模型，不传占位值。`modeId` 让会话一开就处在提供方的某个会话模式。开会话前做四项核对：压缩 `always_on` 的提供方不接 `compaction: 'off'`；原生工具去不掉（`meta.nativeTools`）的提供方不接 `nativeToolPolicy: 'none'`；没有模式（`meta.modeSwitch`）的提供方不接 `modeId`；除 `work` 外的会话种类一律关掉原生子 agent，并把这次改动记进会话的 `adjustments`。配置里其余的——原生工具、压缩、仓库指令、规矩、本事、`env`、MCP 的 `alwaysLoad`——由提供方落实，做不到的组合让 `createSession` 失败。会话随作为归属方传入的上下文关闭。

图片块引用先存好的字节：`const blob = await ctx.brains.blobs.put(bytes, 'image/png')`，再写 `{ kind: 'image', blob }`。存储是一个按内容寻址的目录；提供方经启动上下文的 `readBlob` 读回字节，读时核对大小与哈希。

### 驱动与观察

`Meta.delivery` 声明为 false 的语义，`deliver` 回 `unsupported`；`cancel` 幂等，提供方没确认的取消让会话停在 `stopping`，直到之后某次取消成功。取消一经确认，调用时在跑的回合就有了终止事件；之后的回合不会被它收尾。`canStopRuntime` 在有回合、有待答权限或有在跑的子 agent 时否决，否则再问提供方。`events()` 从调用起迭代；`usage()`、`children()`、`pendingPermissions()` 读会话的登记。`Meta.resume` 为真时，`resumeSession` 用 `persistence()` 的句柄续接。`openChildTask`（跨 CLI 子活）在 tasks 层出现之前以 `brain.not_implemented` 拒绝。

`respondToPermission` 只接受待答的请求。请求的 `category` 分开工具审批、计划审批、模式审批与提问；提问带有类型的 `questions`，允许类的答复必须带以问题号为键的 `answers`（`{ selected, custom? }`，交给提供方之前先核对）。可见选项是一次性的（`allow_once`、`allow_session`、`deny_once`、`cancel`）；父 agent 从不代答子 agent 的请求——它们带着 `childId` 到达主人。

提供方声明了 `modelSwitch` / `modeSwitch` 时，`setModel(model)` 与 `setMode(modeId)` 才可用；关闭或停止中的会话拒绝；成功后 `view().model` / `view().modeId` 更新，并发 `session.model_changed` / `session.mode_changed`；`setMode` 说明模式是立刻、下一步还是下一回合生效。`availableModes()` 与 `currentMode()` 读提供方的模式。

提供方的子 agent 是会话级的：它们的条目带 `childId` 与开它的那个回合，那个回合结束后照常到达（后台子 agent），不借用后来的回合。提供方可以自己开一个回合（后台子 agent 的结果叫醒了 CLI），它作为普通的 `turn.started` 到达，没有对应的 `startTurn`。

### 登记与事件

`list`、`describe`、`probe`、`listSessions`、`children`、`processes` 读内存登记，`onUsage` 推用量。同样的登记以 Cordis 事件发出：`brain.session.opened.v1`、`brain.session.closed.v1`、`brain.process.spawned.v1`、`brain.process.exited.v1`、`brain.child.opened.v1`、`brain.child.ended.v1`、`brain.usage.v1`、`brain.provider.unavailable.v1`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

提供方侧接口照 Paseo 的 `AgentClient` / `AgentSession`，基于迁来的 Paseo 代码的适配器因此几乎一一对应；数据契约用 zod，插件配置用 schemastery。登记处把每个提供方会话包进一个句柄，句柄负责扇出、回合跟踪、权限跟踪、用量汇总、进程登记与子 agent 登记。

| 文件 | 职责 |
|---|---|
| [`src/contract.ts`](src/contract.ts) | zod schema 与类型：`Meta`、`SessionConfig`、`ResumeHandle`、`TurnInput`、`Usage`、`BrainEvent` |
| [`src/provider.ts`](src/provider.ts) | `BrainProvider`、`BrainProviderSession`、启动与探测上下文 |
| [`src/index.ts`](src/index.ts) | `BrainRegistry`（`ctx.brains`）、Cordis 事件、开会话前的核对 |
| [`src/session.ts`](src/session.ts) | 会话句柄：扇出、登记、取消与关闭语义 |
| [`src/config-dir/`](src/config-dir/index.ts) | 成员配置目录与会话 home；各提供方写自己的部分 |
| [`src/process.ts`](src/process.ts) | 进程帮助：让提供方的拉起与探测经启动上下文或 `ctx.subprocess` |
| [`src/views.ts`](src/views.ts) | 提供方、进程、会话、子 agent、用量的登记形状 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [@liwa/brain-shared](../brain-shared/README.zh.md)——提供方包所基于的、迁来的 Paseo 提供方代码。
- [@liwa/brain-deepseek](../brain-deepseek/README.zh.md) 与 [@liwa/brain-acp](../brain-acp/README.zh.md)——目前登记的提供方。
- [@liwa/brain-testkit](../../test-support/brain-testkit/README.zh.md)——脚本回放的提供方，以及每个提供方都要过的契约测试。
- [@liwa/brain-cli](../../bundle/brain-cli/README.zh.md)——基于本服务的 `liwa brain` 命令。
- [@liwa/subprocess](../../subprocess/subprocess/README.zh.md)——每个提供方都经它拉起进程的 seam。

-----

<a id="model-experience"></a>
## 模型体验

间接经由提供方插件：每个 agent CLI 根据会话配置自己组装模型请求，本 seam 只转递会话、事件与用量。

#### KV Cache 影响

本包不往任何模型请求里加东西；前缀是否稳定归提供方及其驱动的 CLI。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **登记只在内存**——会话、进程、子 agent 与用量只在内存与发出的事件里；重启恢复与孤儿清理等落库它们的经历流。
- **没有进程号**——subprocess seam 不公开目标身份，进程登记记的是命令与 argv 哈希，不是 pid。
- **跨 CLI 子活**——`openChildTask` 只留接口位置，等 tasks 层。
- **上层字段**——归属、人设、回合预算、收尾工具、子 agent 策略在成员层、guard 与 roster 出现之前由调用方直接给；`kernelTools` 等 toolport，期间调用方经 `mcpServers` 直接给。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

Claude Code 与 Codex 的成员配置写法等这两个提供方包落地时作为 `writeMemberConfig` 搬进各自的包；先前的写法在本包的 git 历史里。

</details>
