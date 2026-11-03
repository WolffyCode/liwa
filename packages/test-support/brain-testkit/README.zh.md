---
description: "大脑提供方的测试工具：脚本回放的提供方、直接测试提供方的宿主与事件记录器，以及每个提供方都要过的 brain.provider 契约测试。"
kind: "package-library"
---

# @liwa/brain-testkit

[English](README.md) | 中文

## 概述

大脑提供方包在这里证明自己守约。契约测试直接驱动提供方，逐项检查 `brain.provider` 的义务：事件形状、回合、送达、取消、权限、用量、子 agent、CLI 退出、续接与释放。脚本回放的提供方不需要真实 CLI 就能过这套测试，也经显式的覆盖文件给 `liwa brain` 演示用。本包是测试设施，不进任何随附 profile。

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

每个提供方包在自己的测试里跑契约测试，被测的是接上回放 CLI 的客户端。`ctx.brains` 及其消费方的测试用脚本提供方与事件记录器。

### 入口

```text
import { describeBrainProviderContract } from '@liwa/brain-testkit/contract'
import { textInput } from '@liwa/brain-testkit'

describeBrainProviderContract({
  name: 'claude',
  createProvider: host => new ClaudeBrainProvider(host.ctx, replayOptions),
  scenarioInput: scenario => textInput(fixturePromptFor(scenario)),
})
```

提供方拿到一个宿主：挂好的 `ctx.subprocess`、临时目录、记录拉起的启动上下文与一份现成的 `SessionConfig`。对每个场景（`reply`、`tool`、`permission`、`child`、`long`、`exit`），被测方给出让它的 CLI 演出该场景的输入。依赖 `Meta` 能力的测试——子 agent 观察、续接、各送达语义——按声明检查行为，包括 `unsupported`。

脚本提供方（`ScriptedBrainProvider`）按提示词选 `ScriptStep` 回放；`demoScript` 按关键词挑场景。`@liwa/brain-testkit/plugin` 把它登记进 `ctx.brains`：

```yaml
- insert:
    - id: brain-scripted-provider
      name: '@liwa/brain-testkit/plugin'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每个脚本会话都经启动上下文拉起一个空转的 node 进程，进程归属、终止与 `session.exited` 因此走真实路径。插话、取消时撤回、权限答复与子 agent 都照契约测试检查的提供方规则。

| 文件 | 职责 |
|---|---|
| [`src/contract.ts`](src/contract.ts) | `describeBrainProviderContract`，vitest 测试组 |
| [`src/scripted-provider.ts`](src/scripted-provider.ts) | `ScriptedBrainProvider`、脚本步骤与演示脚本 |
| [`src/harness.ts`](src/harness.ts) | 测试宿主、记录拉起的启动上下文、样例会话配置、事件记录器 |
| [`src/plugin.ts`](src/plugin.ts) | 登记脚本提供方的 Cordis 插件 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [@liwa/brain](../../brain/brain/README.zh.md)——被测的契约。
- [@liwa/brain-cli](../../bundle/brain-cli/README.zh.md)——脚本提供方演示的命令。

-----

<a id="model-experience"></a>
## 模型体验

无，因为脚本回合在本地回放，从不到达模型。

#### KV Cache 影响

不发模型请求，与缓存无关。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **回放素材归提供方**——每个提供方包为自己的场景录制或编写被回放的 CLI 行为；本包不带 CLI 录制。
- **线协议回环**——契约测试在进程内驱动提供方；线协议的编解码回环测试留在说该协议的提供方包里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
