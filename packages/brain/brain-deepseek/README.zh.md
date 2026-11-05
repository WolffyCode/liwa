---
description: "大脑提供方 deepseek：灵鲸自己的 agent，每个会话一个 liwa --profile deepseek 进程，经 ACP 加 _liwa 扩展（插话、用量、子 agent）驱动，登记进 ctx.brains。"
kind: "package-reference"
---

# @liwa/brain-deepseek

[English](README.md) | 中文

## 概述

把提供方 `deepseek` 登记进 `ctx.brains`：灵鲸自己的 agent，和别的 agent CLI 一样作为独立的 CLI 进程运行。每个会话拉起同一安装的一个 `liwa --profile deepseek` 进程（`@liwa/deepseek-app`），`LIWA_HOME` 指到成员配置目录下该会话自己的目录。客户端是 `@liwa/brain-acp` 的 ACP 客户端的子类，加上 `_liwa` 扩展：下一步插话、服务端用量、子 agent 记录，以及 `session/new` 的 `_meta.liwa` 里的会话种类、预算、说明与模型。

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

### 挂在哪里

`web`、`headless` 与 `brain` 三个 bundle 带一行 `brain-deepseek`；`deepseek` profile 自己不带，所以会话进程从不登记提供方。关掉这一行就去掉这个提供方；换掉它就指向另一个安装：

```text
liwa brain probe deepseek
liwa brain run --provider deepseek --cwd <dir> "<prompt>"
```

`probe` 报安装的版本，以及 API 密钥配没配；起不了 `liwa` 的安装（既没有构建的 `lib/bin.js` 也没有源码入口，例如浏览器 Worker 预览）照样登记提供方，只是探测为不可用、开会话回 `unavailable`。不给 `--model` 时，会话用 `deepseek` profile 的默认模型选择。

| 字段 | 默认 | 含义 |
|---|---|---|
| `impl` | `deepseek` | 在 `ctx.brains` 里的提供方名 |
| `launcher` | `[]` | 起 `liwa` 的 argv（不含 `--profile`）；留空用本进程所在的安装，再不行用 `PATH` 上的 `liwa` |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 密钥的名字；值从凭据服务（或启动环境）读，只以这个名字交给进程 |
| `forwardEnv` | `[DEEPSEEK_BASE_URL]` | 启动环境里有就原样转过去的变量 |
| `provider` | `deepseek-official` | 给了模型时写进会话 patch 的模型路由 |
| `presetPrefix` | `deepseek-` | 预设 id 前缀；会话种类 `work` 用 `deepseek-work` |

[配置目录](../../../docs/config-catalog.zh.md#liwabrain-deepseek)是完整来源。

### 一个会话做什么

| 契约 | `deepseek` |
|---|---|
| home | 每个会话一个 `<成员>/brains/deepseek/<会话号>/`（`sessionHome: 'per-session'`）；续接句柄记着它 |
| 人格、模型、预设 | 每次拉起前写一份 home 级 `cordis.patch.yml`：`personaPrefix` 加 `includeLiwaIdentity: false`、默认预设、给了模型时的模型 |
| 会话策略 | 同一份 patch：`agent-instructions` 只在 `projectDocs` 时读仓库的 `AGENTS.md` / `CLAUDE.md`，并读成员 `rules`（写成 `$LIWA_HOME/AGENTS.md`）；`skill-filesystem` 与 `skill` 读 `skillsDir`（`projectDocs` 时再加仓库的本事）；`compaction: 'off'` 卸下压缩器与工具结果修剪。`LIWA_AGENTS_HOME` 指进会话 home，主人的 `~/.agents` 从不被读 |
| 原生工具 | `_meta.liwa.nativeToolPolicy`：`none` 只剩经 MCP 的内核工具，`readonly` 只剩只读的原生工具；进程落实不了的组合（没有原生工具却要本事或原生子会话）让 `createSession` 失败 |
| `session/new` | `_meta.liwa`：`mindKind`、`owner`、`notes`、`version`、`limits`、`concludeOn`、`model`、`childPolicy`、`nativeToolPolicy`（服务端也接受会话级的 `keepQueue`） |
| `deliver(next_step)` | `_liwa/steer`（文本与图片）；在运行中回合的下一步送到 |
| `cancel({ reason, keepQueue })` | 标准 `session/cancel`，带 `_meta.liwa.keepQueue`；`pause`、`drain`、`owner` 还停掉在跑的子会话（`stopChildren`），`preempt`、`watchdog` 让后台子会话跑完 |
| 提问 | 进程里的 `ask_user_question` 与计划审批经表单式 elicitation 作为 `question` 请求到达 |
| 子会话审批 | 子会话的越权请求作为带 `childId` 的 `permission.request` 到达主人，并说明它要批的是什么——工具、这次调用的入参（目标路径、写入内容、所要的沙箱档位）作 `args`、提权理由作 `description`（进程转交委派的审批）；父 agent 从不代答 |
| 模型、模式 | `setModel` 经 `session/set_config_option`，在当前路由内换；`setMode` 在 `default` 与 `plan` 之间切（干活会话挂着计划模式）；回合进行中切换的在下一步生效 |
| 自己跑起来的回合 | 两次提示词之间后台子会话的结果叫醒会话时，服务端报这个回合（`_meta.liwa.turn`），它和别的回合一样流式到达 |
| 续接 | 同一 home 拉新进程，再 `session/resume` |
| 用量 | 服务端每次 prompt 的 `_meta.liwa.usage`（含子会话），会话累计用 `_liwa/usage` |
| 子会话 | 从带 `_meta.liwa.child` 的 `session_info_update` 出 `child.started` / `child.ended`；`_liwa/children` 列出它们 |
| 关闭 | 进程随会话退出；超时则杀掉它的进程组 |

提供方做不到的在 `DEEPSEEK_META` 里声明为 false，并答 `unsupported`：`deliver(next_turn)`（投递队列在回合边界补上）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`DeepseekACPAgentClient` 继承 `@liwa/brain-acp` 里 Paseo 的通用 ACP 客户端。每次拉起前，提供方为该会话号备好一个 `LiwaChannel`：给 `session/new` 与 `session/resume` 提供 `_meta.liwa`，给下一次 `session/cancel` 挂上 `keepQueue`，并把每条进来的原始消息（prompt 返回、`session_info_update`、权限请求）缓存到包好的会话订阅为止。`DeepseekBrainSession` 覆写 `PaseoBrainSession` 的钩子：用量取 `_meta.liwa`、工具名取 ACP 的标题、`turn.completed` 带收尾工具、子会话的权限请求带子会话号、插话走 `requestExtension`。`_liwa` 线格式由 `@liwa/deepseek-app` 导出（它的 `src/protocol.ts`），两端都只从这里导入。

启动器跟着正在跑的安装走：构建产物 `lib/bin.js`，或源码检出里经 `tsx` 跑 TypeScript 入口并叠源码模式的覆盖层。密钥每次拉起时解析，在剥离父环境之后作为显式环境项交给子进程，从不写进会话 home。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件：启动器、凭据、登记 |
| [`src/provider.ts`](src/provider.ts) | `DEEPSEEK_META`、`_meta.liwa`、每会话的 home 与拉起 |
| [`src/client.ts`](src/client.ts) | `LiwaChannel` 与 ACP 客户端子类 |
| [`src/session.ts`](src/session.ts) | `DeepseekBrainSession`：`_liwa` 的映射 |
| [`src/session-patch.ts`](src/session-patch.ts) | home 级会话 patch |
| [`src/launcher.ts`](src/launcher.ts) | 怎样从正在跑的安装起 `liwa` |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [@liwa/deepseek-app](../../bundle/deepseek-app/README.zh.md)——进程那一侧：`_liwa` 扩展与预设。
- [@liwa/brain-acp](../brain-acp/README.zh.md)——本提供方继承的 ACP 客户端。
- [@liwa/brain](../brain/README.zh.md)——提供方契约与成员配置目录。

-----

<a id="model-experience"></a>
## 模型体验

间接地，经 `liwa --profile deepseek` 进程；那里的 agent 用会话预设、人格前缀与本提供方发去的会话说明组装每次模型请求。

#### KV Cache 影响

人格前缀与会话说明在一个会话的生命期内不变，所以留在缓存前缀里；新的人格版本在下一代会话生效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有子会话时间线**——子会话报开始、结束、用量与权限请求；它自己的消息与工具调用不逐条流出（结果进父回合）。
- **不列模型**——提供方不列它路由下的模型；`brain run` 不给 `--model` 时用 profile 的默认选择。
- **一个会话一个进程**——从源码跑时每个会话进程约 0.75 秒启动、约 300 MB 内存。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`tests/deepseek.e2e.ts` 只在设了 `DEEPSEEK_API_KEY` 且 `LIWA_BRAIN_E2E=1` 时对真模型跑；其余测试都拉真的 `liwa --profile deepseek` 进程，对一个脚本化的 Messages 端点跑。

</details>
