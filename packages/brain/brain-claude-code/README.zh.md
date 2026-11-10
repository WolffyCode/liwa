---
description: "Claude Code 大脑提供方：官方 SDK、本机 CLI、隔离的成员配置，Key 与地址像 Paseo 一样明文写在每个实例的 env 里。"
kind: "package-reference"
---

# @liwa/brain-claude-code

[English](README.md) | 中文

<a id="summary"></a>
## 概述

经精确钉住的官方 SDK 0.3.263，把本机 Claude Code CLI 接入 `ctx.brains`。每个插件行是独立提供方，有自己的模型列表、地址和明文 env（与 Paseo 的自定义提供方一致）。会话只共用成员/impl 的原生转录根。首版只接 `work`；`instance`、`think`、`own`、`tidy` 在 A2 证明真实 CLI 工具与压缩隔离之前均回 `invalid_input`。依据：〔一手〕[适配评估](../../../docs/liwa/research/2026-11-05-claude-code-adaptation.md) §4–8；实现见 [`src/provider.ts`](src/provider.ts)、[`src/config.ts`](src/config.ts)。

<a id="table-of-contents"></a>
## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

`brain-cli`、`web-app`、`headless` 三个 bundle 带默认关闭的示例行。每行一个实例，和 Paseo 的自定义提供方一样把 Key、地址直接写进 `env`；同一个插件挂几行就是几个提供方，例如一个走 reclaude 转发的 Claude、一个走 z.ai 端点的 GLM：

```yaml
- id: brain-claude-code
  name: '@liwa/brain-claude-code'
  config:
    impl: claude-reclaude
    label: Claude via reclaude
    env:
      ANTHROPIC_API_KEY: replace-with-the-reclaude-key
      ANTHROPIC_BASE_URL: http://127.0.0.1:8080
    models:
      - id: sonnet
        label: Sonnet
        isDefault: true
        thinkingOptions:
          - { id: high, label: High, isDefault: true }
          - { id: off, label: Off }
      - { id: opus, label: Opus }
    skills: /srv/liwa/claude-skills
    mcpServers:
      docs:
        type: http
        url: https://mcp.example.test/docs
    plugins: [/srv/liwa/claude-plugins/review]
    hooks:
      PreToolUse:
        - matcher: Bash
          hooks: [{ type: command, command: /srv/liwa/hooks/audit-bash.sh }]
- id: brain-claude-code-glm
  name: '@liwa/brain-claude-code'
  config:
    impl: claude-glm
    label: GLM via Claude Code
    env:
      ANTHROPIC_AUTH_TOKEN: replace-with-the-zai-key
      ANTHROPIC_BASE_URL: https://api.z.ai/api/anthropic
      API_TIMEOUT_MS: "3000000"
    disallowedTools: [WebSearch]
    models:
      - { id: glm-5-turbo, label: GLM 5 Turbo, isDefault: true }
      - { id: glm-5.1, label: GLM 5.1 }
```

`liwa brain run --provider claude-glm "任务"` 使用该实例的默认模型。必须且只能有一个默认模型；重复或未知 id 在执行前拒绝。`probe` 解析指定可执行文件，只运行其 `--version`；SDK 得到同一个绝对路径。`binaryArgs` 是紧跟可执行文件、排在 SDK 参数前的固定参数（包装脚本、容器入口），探测时同样带上。首版协议基线为 2.1.318。

`env` 是明文的子进程部署变量，和 Paseo 一样什么都能放。`ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN` 必须且只能有一个，分别对应 CLI 的 x-api-key 与 Bearer 认证头，看端点要哪种；`ANTHROPIC_BASE_URL` 可选，必须是不带账号密码的 HTTP(S)；模型别名（`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_*_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`）、`API_TIMEOUT_MS`、`MAX_THINKING_TOKENS` 等任意部署变量照写。HOME/USERPROFILE、临时与 XDG 根、配置/secure-storage 路径、进程加载器、运行时拥有的 Claude 标志、会话安全开关（含 DISABLE_COMPACT、ENABLE_TOOL_SEARCH）禁止覆盖，装载即报错。宿主只保留操作系统找可执行文件、区域和显示设置的基础变量。认证值与 `ANTHROPIC_CUSTOM_HEADERS` 从 stderr（含跨块）、诊断、日志和原生控制错误中脱敏。Key 明文存在配置里，网页配置页会原样显示；凭据服务与登录凭证的接法以后再定。

每一行还能带自己的本事目录（`skills`）、MCP 服务器（`mcpServers`，与会话的合并；`liwa` 留给内核工具，实例与会话同名在开会话时报错）、本地插件目录（`plugins`，每个须含 `.claude-plugin/plugin.json`）、settings 格式的命令钩子（`hooks`，经 CLI 的 `--settings` 层交给它）和按模型的 `thinkingOptions`（`off`、`low`、`medium`、`high`、`xhigh`、`max`、`ultracode`；会话用 `--thinking` 选一档，不选就用该模型的默认档，没列档位的模型交给 CLI 默认；`setThinking` 在回合之间换档，靠重启 Query 生效；换模型时明确选过的档位新模型也得有，否则拒绝）。路径必须是绝对路径，装载时就查；CLI 自带的全局与项目配置仍然一律不读。会话自己的 `plugins`、`hooks`、`instructions`（来自全局 agent 配置集，见 `@liwa/brain`）叠在实例行之上：插件目录追加，钩子按事件分组、会话（全局集）的在前、实例行的在后，指令放在规矩之后、仓库 `CLAUDE.md` 之前。会话模式有 `default`、`plan`、`acceptEdits`、`auto`；`bypassPermissions` 不开放。

`CLAUDE_CONFIG_DIR` 指向生成的成员/impl 根；`HOME` 是其下的空目录。继承的认证、配置覆盖和 `CLAUDE_SECURESTORAGE_CONFIG_DIR` 被移除，不读取默认登录。空 `settingSources`、严格 MCP 和显式插件/本事快照阻止选择宿主配置。`projectDocs: true` 只把 `<cwd>/CLAUDE.md` 当文本读入系统提示，不启用项目 settings 或 hooks。文档不存在可以省略，不可读或指令超长则报错。`instructionsMaxBytes`、`probeTimeoutMs`、`controlTimeoutMs`、`graceMs` 均可配置。

<a id="understand-the-implementation"></a>
## 理解实现

Paseo 的 Claude 会话与任务观察源码在 `src/paseo/` 原地修改；[`NOTICE`](NOTICE) 逐文件记录。严格适配器拥有进程桥、配置、答案编码、用量与预算策略。官方 SDK 处理 stream-json；每个子进程均走 `launch.spawn`，释放等整个受管范围退出。模型和模式切换成功后发事件。模式只开放 `default` 和 `plan`；批准计划回到 `default`，不扩权为免审编辑。

权限请求保留工具入参与子归属。精确 MCP 工具可以“本会话允许”，不开放永久规则、目录或模式扩权建议。问答按问题全文编码，支持单选、无歧义多选与自由文字。重复问题/选项、逗号歧义、选项加补充文字均拒绝，并保留待答；后一项需要真 CLI 验证 annotations。

`next_step` 使用 SDK priority `next`；`next_turn` 回 `unsupported`。取消先撤未读取的输入，再中断并等待结果；控制失败向上抛。owner、pause、drain、hard_limit 先停已知原生任务；preempt、watchdog 保留后台任务。原生 `task_id` 映到 Paseo 稳定的首次 `tool_use_id`；权限回调等待对应任务声明，超时直接拒绝这次原生审批，不发布替代 childId，原生 taskId 仅放诊断；abort 和 close 立即结束等待。

`modelUsage` 与估算费用都是 Query 累计值。适配器逐模型取差量，缓存读写分开；新 Query 或原生 clear 重设基线。成功、中断、失败回合的已知消费经 G1 只结算一次。子分项不重复累加；`task_notification.total_tokens` 是上下文大小，不当成子消费。崩溃/启动失败的零计数结果保留原失败原因，消费保持未知，不重置已有累计基线；其他非法回退仍大声失败。上下文快照与支出分开。

续接句柄绑定原成员/impl 根与完整 UUID。原生 JSONL 转录缺失报 `not_found`，不可读或损坏报 `unavailable`；错根及链接越界在打开前拒绝。UI 回放容错与续接准入分开；CLI 随后报告该会话不存在（No conversation found）时，本代会话和句柄失效，需恢复资料后重新开会话；首回合的其他失败按普通回合失败处理，句柄保留。

`maxTurns` 限制主循环。`PostToolUse` 记录命中 `concludeOn` 的成功父 MCP 调用；`PostToolUseFailure` 撤成功事实，`PostToolBatch` 在下一模型步骤前返回 `continue: false`。子工具、失败调用、未配置的 MCP 服务器不能收掉父回合。kernel 权限模式用 `PreToolUse` 的 ask 决策强制进入审批。关闭压缩同时设置 `autoCompactEnabled: false` 与 `DISABLE_COMPACT=1`。

<a id="model-experience"></a>
## 模型体验

### 干活会话的指令与工具

#### 模型看到的内容

CLI 得到干活预设，追加稳定人设、显式规矩、可选项目文档与 notes。JPEG、PNG、GIF、WebP 图片走 SDK 内容块，其他图片类型明确拒绝。只有会话给的 MCP 与显式成员本事快照可用；原生工具可以全关，readonly 则只留 Read/Glob/Grep。原生子 agent 要求 worktree 策略。

#### Token 影响

追加指令与配置的工具定义占用每次请求的上下文；图片和工具结果按所选端点的规则消耗 token。完整追加指令受 `instructionsMaxBytes` 限制。

#### KV Cache 影响

稳定指令在前，变化的 notes 在后。提示组装与缓存由 Claude 拥有；用量报告缓存读写，不假定命中率。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 真实 CLI 兼容性、文件访问隔离、annotations 与压缩压力仍需另行授权的 A2。假 CLI 测试覆盖官方 SDK 和进程归属，不证明真 Claude 的模型或文件加载行为。
- 不提供下一回合队列、回滚、额度查询或严格总工具次数预算。`maxTurns` 不约束所有原生子任务/helper 推理；原生子任务深度与并发上限不能保证。
- 无法归属结果的后台支出，以及终止结果前丢失的消费，仍是未知，不伪造零。会话级后台归账不在 G1 范围。
- 支持精确 MCP 工具的会话规则，原生 shell/文件的更宽规则留后续。选项加补充文字在 A2 前拒绝。不实现项目文档继承和递归项目技能发现。

<a id="dev-note"></a>
### 开发备注

本包遵循 [brain 契约](../brain/README.zh.md) 与[共享会话映射](../brain-shared/README.zh.md)。能力声明在 `CLAUDE_META`；实例准入与压缩开关的声明分别判断。
