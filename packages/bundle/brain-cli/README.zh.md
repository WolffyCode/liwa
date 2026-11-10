---
description: "liwa brain 命令：在终端里列出、探测并试用 ctx.brains 的 agent CLI 提供方，以 liwa-base 之上的随附 brain profile 交付。"
kind: "package-bundle"
---

# @liwa/brain-cli

[English](README.md) | 中文

## 概述

`liwa brain` 列出、探测并试用一个 profile 挂载的 agent CLI 提供方。随附的 `brain` profile 把这一层叠在 `liwa-base` 之上，所以 `liwa brain list` 不用任何设置就能用。`run` 在本进程里开一个会话，每个事件打一行，答复权限请求，跑一个回合后关会话。提供方来自 profile 挂载的插件；本层挂 `deepseek`（灵鲸自己的 agent）和一行关着的通用 `acp`。

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

### 装进 profile

本层随安装提供：随附的 `brain` profile（`@liwa/base`、`@liwa/brain-cli`）在第一次使用时建好，`liwa brain <子命令>` 是 `liwa --profile brain <子命令>` 的简写。提供方插件像任何插件一样加进这个 profile：

```text
liwa plugin --profile brain add <provider-package>
```

### 得到什么

```text
liwa brain list [--json]
liwa brain probe <impl> [--json]
liwa brain run --provider <impl> [--model <m>] [--mode <mode>] [--thinking <option>] [--cwd <dir>] [--permit ask|allow-once|allow-session|deny]
               [--image <file>]... [--member <name>] [--mind <kind>] [--json] "<prompt>"
```

`list` 探测每个已登记的提供方并打一张表；提供方不可用时 `probe` 以 1 退出。`run` 准备成员配置目录，用命令给的值与执行行的回合预算开会话，事件打到 stdout、会话说明打到 stderr，回合正常结束时以 0 退出。`--mode` 是提供方的会话模式，同 `paseo run`（`deepseek` 有 `plan` 与 `default`）。`--thinking` 在提供方给所选模型列了档位时选一档。开会话前，`run` 读本行 `agentsRoot`（`$LIWA_HOME/agents`）下的全局 agent 配置集和 `--cwd` 的目录级文件，为该提供方选出条目，把本事拷进临时目录，再把本事、MCP 服务器、插件、钩子、指令交给会话，往 stderr 打一行 `agent config for <impl>: …`，会话关闭后删掉临时目录。`--permit` 决定怎么答权限请求与提问：`ask` 在终端里问（终端上的默认），允许类策略给每个问题答它的第一个选项，`deny`（其他情况的默认）谢绝。`--image` 给提示词附一个 png、jpeg、webp 或 gif 文件。测试用的脚本提供方经显式覆盖文件加入：

```text
liwa brain --patch apps/cli/tests/profiles/brain/scripted-provider.patch.yml run --provider fake "hello"
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

patch 在 base 之上插入这些行：`brains`（`@liwa/brain`，`membersRoot` 在灵鲸 home 下）、提供方行 `brain-deepseek` 与 `brain-acp`（设好 `command` 之前关着）、`brain-cli-startup`（解析启动器交来的内部参数，提供 `brainStartup`）、`brain-cli`（等 loader 装配完成后执行命令，再请求退出）。它像一次性的 headless profile 一样关掉 HMR 与交互式凭据存储。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 本层的行 |
| [`src/startup.ts`](src/startup.ts) | 命令语法与帮助；发布 `brainStartup` |
| [`src/index.ts`](src/index.ts) | `list`、`probe`、`run`；事件行与权限答复 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [@liwa/brain](../../brain/brain/README.zh.md)——命令驱动的服务。
- [组合包分组](../README.zh.md)——其他随附的层。
- [liwa 应用](../../../apps/cli/README.zh.md)——`liwa <名字>` 怎么选 profile。

-----

<a id="model-experience"></a>
## 模型体验

间接经由所选的提供方：`run` 把提示词交给该提供方的 CLI，模型请求全由它组装。

#### KV Cache 影响

命令自己不加任何模型输入；缓存归提供方。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **一次一个回合**——`run` 在第一个回合后关会话；常驻会话、多会话管理与断开再连归以后的网关。
- **没有 `sessions`、`children` 子命令**——一次性进程里除了自己这次 run 没有会话可列。
- **不列模型**——不给 `--model` 时会话不带模型，由提供方的 CLI 用它自己的默认模型；命令还不能列出提供方的模型。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
