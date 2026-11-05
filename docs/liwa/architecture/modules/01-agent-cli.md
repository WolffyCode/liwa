# 01 agent CLI 接入（brains、`brain.provider`）：第四层的契约、三个 CLI 提供方、子 agent 与 Paseo 迁移

状态：**已确认**。第 1、2 步及两轮修复已在 dev 完成（HEAD `2eca7d13`，基于 `dsh-base 00e21375`），第 3 步设计进行中；第 4、5 步目标是 Claude Code、Codex 与 Paseo 同等功能（handoff 决策 55–61）。上位设计：`four-layers.md` §1、§4、`overall.md` §3.4、§9.2、`00-contracts.md` §5.1。配套图页 `01-agent-cli.html`，源 `01-agent-cli.src.html`，用 `python3 -I docs/liwa/scenarios/build.py docs/liwa/architecture/modules/01-agent-cli.src.html` 生成。〔一手〕任务书 03、主人 11-05 决定与 dev 提交。

依据标记：〔一手〕源码或原文；底座指 dsh-base、已实现第四层指 dev，路径相对各仓库根；Paseo 固定 `getpaseo/paseo@8018231a`（0.15.0-beta.1，Apache-2.0）。两份适配评估为 `research/2026-11-05-claude-code-adaptation.md`、`research/2026-11-05-codex-adaptation.md`，下文简称 Claude 评估／Codex 评估；安装源码行号沿报告的 `S:`／`C:`，Codex 生成协议沿 `G:`。〔二手〕外部资料或转述；〔推理〕方案建议，未确认的单列待定。
## 0 一页结论

- **第四层 = seam 包 `@liwa/brain`（契约 + `ctx.brains` 服务）+ 每个 CLI 一个提供方插件**（决策 33），形状照底座 `@liwa/llm` ↔ `llm-deepseek`、`@liwa/subprocess` ↔ `subprocess-local`〔一手，两包 README〕。**三个提供方在形态上完全一致：每个会话一个独立进程的 CLI**，本体里只有客户端。
- **自建默认 agent = 提供方 `deepseek`（包 `brain-deepseek`），进程是 `liwa --profile deepseek`**：底座 `apps/cli` 启动器 + 新 bundle `@liwa/deepseek-app`（`@liwa/base` + 底座现成的 ACP 服务器 `@liwa/acp` + 灵鲸扩展 + 五个预设）。对外说 **ACP v1 + 三个 `_liwa/*` 扩展方法 + `_meta.liwa.*` 字段**（ACP 允许 `_` 前缀自定义方法与 `_meta` 扩展〔二手〕；SDK 1.4 两端都有 `extMethod`〔一手〕）。**每个会话一个进程**，一条 ACP 连接上只有这一个会话；人设十段作为该进程的 `personaPrefix` 注入一次，进程里的子会话自动继承。本体侧的 `brain-deepseek` 是 `brain-acp` 通用客户端加 `_liwa` 扩展的薄层；steer 由 `_liwa/steer` → 底座 `agent.steer` 补上（§4.1）。
- **`brain-claude-code`、`brain-codex` 从 Paseo 迁，目标与 Paseo 同等功能**（Claude Agent SDK 精确钉 0.3.263，显式选择本机真实 `claude`；Codex app-server 用 PATH 上真实 `codex`；两家首版均用 Key、同 CLI 多提供方可并行）；**`brain-acp` 已在第 2 步实现**：SDK 1.4，它是 `brain-deepseek` 的底子。
- **子 agent 两条路**（§4.5）：① **提供方自己的子 agent**，只在干活与查资料的活里放开——`deepseek` 用底座 `subagent` seam（`subagent` / `send_message` / `interrupt_agent` / `list_agents` 四个工具，spawn / fork 进程内后端，自动继承人设），Claude 的 `Agent` 工具、Codex 的协作 agent 照 CLI 自己的方式开；灵鲸不干预，只观察、记录、计入父活的预算（`brain_child`、`brain.child.*` 事件、用量归父活）；② **跨 CLI 子活**：经内核工具 `spawn(执行者, 交接包)` 开第三层子活，由 `tasks` → `minds` → `brains` 在指定提供方上开会话，回报走活的事件——这是 Paseo `create_agent` + `notifyOnFinish` 的形状，把"agent 自管 agent"换成"活管子活"。不开放 Paseo 的 CLI 路（活的 shell 里直接起别的 agent），它绕开令牌与权限链。
- **外部 CLI 用空壳子配置**（§4.6）：不加载 CLI 自带全局／项目配置、钩子、本事与插件；规矩、项目 `CLAUDE.md` / `AGENTS.md` 内容、MCP 都由灵鲸受控注入，Codex 另给隔离 HOME。凭据与提供方实例分别隔离，真机证明不了就停下来问主人。以后再加灵鲸全局 home、本事、MCP、插件配置机制。依据：〔一手〕handoff 决策 56–58。
- **Paseo 迁移**：固定提交 `8018231a`，按文件原样拷进各包 `src/paseo/`，原地改、改动记进包内 `NOTICE`；全量盘点见附录 A，默认迁，不迁的只有两类——和灵鲸的设计冲突（以 CLI 转录为真相、agent 自管 agent、JSON 文件存储、多主机）或底座已有更好实现（插件机制、终端、浏览器、进程服务）。
- **验收用真实 CLI**（§9）：A1 真 `liwa --profile deepseek` 子进程跑完主人实例一回合、`_liwa/steer` 次步可见、重启后 `session/resume`；A2 真 `claude`；A3 真 `codex app-server`；A4 子 agent 两条路各一条、Claude 原生子 agent 被观察计费；A5 同一实例从 `deepseek` 换代到 `claude`。

## 1 范围与边界

| 管什么 | 不管什么（归谁） |
| --- | --- |
| `@liwa/brain`：契约类型、`ctx.brains` 服务（提供方登记、按 roster 解析、会话句柄包装：看门狗计时、用量汇总、事件落经历流、进程归属、成员配置目录的生成、子 agent 的观察与登记）；四个提供方插件；`deepseek-app` bundle；Paseo 代码的落位与 NOTICE；进程监管规则的提供方侧义务 | 什么时候开会话、换新、回收、投递队列（minds，02）；工具目录、令牌、同步执行（toolport，02）；准入、名额、总闸、日预算（guard，03）；进程服务本身（底座 `@liwa/subprocess`，03）；roster（04）；人设与规矩的内容（self，06）；本事的内容（skills，06） |

依赖方向：minds → brains → subprocess / llm；brains 不读账本、不读懂内容、只报事实与用量（`four-layers.md` §1 第四层行）。

### 1.1 现有底座代码到第四层的对照表

| 底座里的东西 | 和第四层的关系 | 处置 | 依据 |
| --- | --- | --- | --- |
| `core/agent` + `agent-loop`（`ctx.agents.create/resume`，`Agent.followup/steer/cancel(keepInbox)/whenIdle`，`agent/pre-step`、`agent/turn-stopping` 事件） | `liwa --profile deepseek` 进程里的会话运行时 | **留着**，不改；本体进程不再直接用它开会话 | 〔一手〕`packages/core/agent/src/index.ts:416,435`；`runtime-types.ts` |
| 预设 `agent-preset` / `-registry` / `persona`；`core/system-prompt`；`runtime-context.ts` | `deepseek-app` 里每种会话一个预设；人设十段进该进程的 `personaPrefix`，会话说明进 agent 作用域段 | **改造**：新增 `deepseek-instance` / `-work` / `-think` / `-own` / `-tidy` 预设，压缩由会话 patch 控制 | 〔一手〕`preset/persona/README.zh.md`；`core/system-prompt/README.zh.md`（agent 作用域贡献遮蔽全局）；`runtime-context.ts:157` |
| `core/tools` 的 `concludesTurn` | `concludeOn` 的落点（§4.1） | **留着** | 〔一手〕`core/tools/src/contracts.ts:331` |
| llm 路由 `@liwa/llm`、`llm-deepseek(-api-key)`、`llm-pi-ai`、`llm-retry`、`token-meter`、`agent-default-model` | `deepseek` 进程的模型来源；路由由 brains 生成的会话 patch 给 | **留着** | 〔一手〕`bundle/base/cordis.patch.yml` |
| `@liwa/subprocess` + `subprocess-local` | 就是 `overall.md` 的 procs；三个 CLI 都经它拉起 | **留着**；03 补"先登记再拉起、孤儿清理" | 〔一手〕`subprocess/src/types.ts:77,169`；README（环境剥凭据与 `LIWA_*`） |
| `session-persistence(-jsonl)`（`$LIWA_HOME/sessions/<id>/`，无删除接口） | `deepseek` 进程的转录（它的 `LIWA_HOME` 在该会话的目录下） | **留着**；底座改造项：补 `delete(sessionId)` | 〔一手〕`session-persistence-jsonl/README.zh.md` |
| `subagent` seam + `subagent-spawn-in-process` / `-fork-in-process` + `tool-subagent` + `tool-subagent-control` | `deepseek` 上干活的活的子 agent 机制（§4.5 路①） | **留着**，进 `deepseek-work` 预设 | 〔一手〕`subagent/src/types.ts:313`；两个工具包 README |
| `subagent-claude-code` / `-codex` / `-acp` / `-liwa-sdk`（一次性委派） | 被 `brain-claude-code` / `brain-codex` / `brain-acp` 取代；`subagent-claude-code/src/process.ts` 的 `claudeSpawnSpec` 与 `subagent-acp/src/run.ts` 的 SDK 1.4 调用方式**搬进对应提供方** | Claude Code／Codex 委派随提供方替代后删；ACP／liwa-sdk 删除时点待定（handoff 待定 4） | 〔一手〕`subagent-claude-code/src/run.ts:330,370`；`subagent-acp/src/run.ts:440-520` |
| `experimental/hook-protocol`、`hooks-claude-code`、`hooks-codex`、`claude-code-mods`、`subagent-oar`、`tool-subagent-oar` | 执行外部钩子格式的兼容桥 | **删掉** | 盘点 §5〔推理〕 |
| `@liwa/acp` + `bundle/acp-app`（`session/new|list|resume|close|set_config_option|prompt|cancel|request_permission`，stdio / HTTP MCP） | **`deepseek-app` 的底子** | **改造**：加 `_liwa/*` 方法与 `_meta.liwa.*` 处理、按会话预设 | 〔一手〕`packages/acp/acp/README.zh.md`；`src/index.ts:200-204`、`src/session.ts:119-124` |
| `@liwa/sdk-*` + `bundle/sdk-app` / `sdk-minimal` | 不用于第四层（无取消、`initialize` 定死模型） | **留着**，去留等裁剪 | 〔一手〕`sdk/protocol/src/types.ts:17-125` |
| `apps/cli`（`liwa <profile>`、`--patch`、`liwa plugin --profile X add`） | 本体与 `deepseek` 进程共用的启动器 | **留着** | 〔一手〕`apps/cli/src/{bin,args}.ts`；`util/official-bundles/src/bundles.ts:11-24` |
| `guard/repeat-tool-reminder`、`guard/timeout-policy`、`jobs(-local)`、`shell/tool-bash`、`sandbox-policy` | `deepseek-work` 预设里给活用；实例预设不装 | **留着** | 〔一手〕各包 README |

## 2 数据

五张表在当前阶段是 `ctx.brains` 内存登记，字段使用代码中的 camelCase；经历流持久化、流位置、跨重启对账与孤儿清理等搭第二层时补。只保留开着的会话，关闭结果随事件发出。依据：〔一手〕dev 分支 `packages/brain/brain/src/{views,index,session}.ts`；〔一手〕主人推进决定（handoff 决策 47）。

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `brain_provider` | impl、plugin、meta、available、lastProbeAt?、probeResult? | `liwa brain list` 读取并逐个探测；尚未探测时 available 未知 |
| `brain_process` | processId、sessionId、impl、command、argvHash、startedAt、state（`live` / `exited`）、exitCode?、signal?、exitedAt? | brains 分配的 processId 不是系统 pid；subprocess 不公开进程身份，本阶段不记 pid / pgid / parent_pid，不存参数原文 |
| `brain_session` | sessionId、impl、member、mindKind、owner{instanceId或taskId, gen}、model?、modeId?、configDir、homeDir、state、openedAt、resumedFrom?、adjustments、closedAt?、closeReason? | 一代会话一行；model 可省，省略用 CLI 默认值；modeId 可省 |
| `brain_child` | childId、sessionId、kind（`native-child` / `cross-cli-task`）、provider、label、parentChildId?、state、stopReason?、usage?、openedAt、endedAt? | 当前只登记提供方自己的子 agent；跨 CLI 子活等 tasks；关闭时未结束的补记 `aborted` |
| `brain_usage` | sessionId、impl、member、owner、turnId?、childId?、source（`turn` / `update` / `child`）、usage、at | 经 `onUsage` 与事件推出；子 agent 用量按 owner 归父活，guard 等第二层接入 |

Cordis 事件固定使用点号与版本名：`brain.session.opened.v1`、`brain.session.closed.v1`（关闭的会话与用量汇总）、`brain.process.spawned.v1`、`brain.process.exited.v1`、`brain.child.opened.v1`、`brain.child.ended.v1`、`brain.usage.v1`、`brain.provider.unavailable.v1`；不套底座的 `域/名` 命名。经历流接入后订阅这些事件写 `instance:<id>` / `task:<id>`，提供方不可用写 system 流，回合与工具事件由 minds 记（02 §2.2）。依据：〔一手〕dev 分支 `packages/brain/brain/src/index.ts`、`packages/brain/brain/src/views.ts`；〔一手〕主人同意第 1 步事件落法（handoff 决策 53）。

## 3 接口

### 3.1 `brain.provider` 契约（在 `00-contracts.md` §5.1 之上补齐）

```ts
Meta += {
  modeSwitch: z.boolean(),                                         // 可列出、读取、切换会话模式
  runtime: z.literal('subprocess'),                                 // 四个提供方都是每会话一个子进程；本体里只有客户端
  transport: z.enum(['acp', 'claude-sdk', 'codex-app-server', 'scripted']), // scripted 只给假提供方；deepseek 与通用 ACP 都是 acp
  kernelTools: z.array(z.enum(['mcp-http', 'mcp-stdio', 'dynamic'])).min(1),   // 内核工具一律经 MCP 到模型；dynamic 是 Codex 实验接口
  binary: z.object({ command: z.string(), minVersion: z.string().optional() }),
  children: z.object({ native: z.enum(['none', 'observe']), crossCli: z.literal(true) }),   // observe = 能观察自己的子 agent 并上报 child.* 事件（三家都要做到）；跨 CLI 子活人人都能
  extensions: z.array(z.string()).optional(),                       // 声明支持的 _liwa/* 方法（deepseek：steer、usage、children）
};
SessionConfig += {
  // model 可省，省略即所用 CLI 的默认模型；kernelTools 可省，toolport 接入前可直接给 mcpServers
  mcpServers: z.record(z.string(), McpServer).optional(),
  permission: z.object({ mode: z.enum(['kernel', 'provider']), autoAllow: z.array(z.string()) }),
  compaction: z.enum(['off', 'provider']),                          // always_on 的提供方不许开实例会话
  configDir: z.string(),                                            // brains 生成的成员配置目录（§4.6）；CLI 只读它
  rules: z.string(), skillsDir: z.string(),                         // 渲染进配置目录的规矩文本与本事目录（来自 self / skills）
  projectDocs: z.boolean(),                                         // 是否注入项目文档内容；外部 CLI 由灵鲸受控读取，不启项目配置源（§4.6）
  modeId: z.string().min(1).optional(),                               // 提供方会话模式，省略用其默认模式
  childPolicy: z.object({ native: z.boolean(), maxDepth: z.number().int(), maxConcurrent: z.number().int(), crossCli: z.array(ImplId) }),   // §4.5：native 只在干活与查资料的活为 true
  resume: z.object({ identityProbe: z.boolean() }).optional(),
};
BrainEvent += { kind: 'session.compacted', turnId?, preTokens?, postTokens? } | { kind: 'process.exited', pid?, code, signal }
           | { kind: 'child.started', childId, childKind: 'native-child', label, provider, parentChildId?, turnId? } | { kind: 'child.ended', childId, stopReason, usage: Usage }
           | { kind: 'session.mode_changed', modeId: string | null, availableModes?: BrainMode[] }
           | { kind: 'session.model_changed', model: string };
```

`Meta.nativeTools` 表示“带着关不掉的原生工具”；`permission.resolved{turnId?, requestId, optionId, effect}` 说明提供方已应用答复；`turn.interrupted.reason`、`turn.failed.code/diagnostic`、`usage.update.turnId` 可选；消息、推理、工具条目及权限请求可带 `childId`。`process.exited.pid` 可选且由 brains 发出，提供方不发；子 agent 的种类字段为 `childKind`，避免与事件判别字段 `kind` 冲突。`ResumeHandle` 另带可选的 `nativeHandle`、`metadata`、`home`；`home` 由 brains 记录 per-session 布局的目录。依据：〔一手〕dev 分支 `packages/brain/brain/src/contract.ts`、`packages/brain/brain/src/session.ts`。

提供方接口使用 `BrainProvider { impl, meta, sessionHome, writeMemberConfig?(dir, spec), probe(ctx), createSession(cfg, launch), resumeSession(handle, cfg, launch) }`；续接给完整的新代配置。`BrainProviderSession` 使用 `subscribe`、`startTurn`、`deliver`、`cancel`、`respondToPermission`、同步 `persistence()`、可选 `canStopRuntime()` / `setModel()` / `availableModes()` / `currentMode()` / `setMode()`、`close()`；不用 `CallContext` 首参、`ClientOf` 描述符或创建即缓冲的单消费者流。`BrainLaunchContext` 给会话号、home 目录、日志器与进程解析 / 拉起入口。依据：〔一手〕dev 分支 `packages/brain/brain/src/provider.ts`；完整字段见 00 §5.1。

| 项 | 规则 | 依据 |
| --- | --- | --- |
| `kernelTools` | toolport 开一个带会话令牌的 Streamable HTTP MCP 端点；Claude 经 SDK `mcpServers`、Codex 经 `config.mcp_servers`、deepseek 经 ACP 标准的 `session/new.mcpServers`（HTTP 型）连它；三条路最后都是 `toolport.invoke(token, tool, args)` | Paseo 的工具目录与传输无关、MCP 只是适配器〔一手，`paseo@8018231a:docs/providers.md`〕；底座 ACP 服务器支持 HTTP MCP〔一手，README〕 |
| `deliver(next_step)` | deepseek：`_liwa/steer`；Claude：SDK 流式输入 `priority: 'next'`；Codex：`turn/steer{expectedTurnId}`；别家 ACP CLI 恒 `unsupported` | 〔一手〕`…/providers/claude/agent.ts:2607-2640`、`codex-app-server-agent.ts:4473-4510`；ACP 无 `steerActiveTurn`（grep 为 0） |
| `cancel` 后的队列 | 先撤回提供方没读走的 `next_step` 输入再中断，否则刚停的回合会被它重新拉起 | 〔一手〕`docs/providers.md`"A steering adapter also owes its interrupt" |
| 两回合之间退出 | 必报 `session.exited`；每会话一个进程，退出只影响这一个会话 | 〔一手〕`docs/agent-lifecycle.md`"Report that exit as a turn failure" |
| 用量 | `turn.completed.usage` 必填；deepseek 的用量来自 `_meta.liwa.usage`（§4.1）；子 agent 的消耗归父活，父子总量口径按提供方核实，不把分项再累加（§4.5）；SDK 估价只记不算 | §5.1 已定 |
| 子 agent | 提供方必须把自己的子 agent 翻成 `child.started` / `child.ended`（能拿到的字段都填，拿不到的留空，不许编），按 `cancel` 原因停子或只停父，`close` 停整组 | §4.5 |

### 3.2 `ctx.brains` 服务（`@liwa/brain`，required）

```ts
interface Brains {
  register(provider: BrainProvider): () => void;
  describe(impl): Meta; list(): BrainProviderView[]; probe(impl, signal?): Promise<{ available; version?; problems[] }>;
  prepareConfigDir(member, impl, spec: MemberConfigSpec): Promise<string>; // spec 只取 rules / skillsDir / projectDocs / model? / mcpServers? / kernelTools?
  createSession(owner: Context, { impl, cfg }): Promise<BrainSession>;  resumeSession(owner: Context, { impl, resume, cfg }): Promise<BrainSession>;
  openChildTask(owner: Context, { parentTask, impl, cfg }): Promise<BrainSession>; // 当前恒以 brain.not_implemented 拒绝，等 tasks 接入
  children(sessionId): BrainChildView[];                                         // 该会话的子 agent（两条路都在）
  get(sessionId); listSessions(); processes(): BrainProcessView[]; onUsage(cb): () => void;
}
```

brains 在 `createSession` 前核对：`cfg.compaction === 'off'` 且 `meta.compaction === 'always_on'` → 拒绝；`cfg.nativeToolPolicy === 'none'` 且 `meta.nativeTools === true` → 拒绝；`cfg.childPolicy.native` 只在 `mindKind === 'work'`（干活与查资料）允许为 true，其余种类一律改为 false 并记事件。

`prepareConfigDir` 只收 `MemberConfigSpec`，返回成员 `brains/` 根目录；完整 `SessionConfig.configDir` 是它的输出，不能反过来要求完整配置作输入。调用方句柄增加 `subscribe`（多订阅者）、`events(signal?)`（可重复打开、自建立迭代订阅起收事件）、`usage()`、`children()`、`pendingPermissions()`、`view()`、`state` 与 `activeTurnId`。服务跟随归属方上下文、提供方插件和自身的卸载关闭会话，取消失败进入 stopping 并拒绝新回合，直到取消成功。依据：〔一手〕dev 分支 `packages/brain/brain/src/{index,session}.ts`、`packages/brain/brain/src/config-dir/{index,shared}.ts`。

`prepareConfigDir` 只分发到提供方可选的 `writeMemberConfig(dir, spec)`，公共层没有 Claude／Codex 名字分支；`sessionHome: 'per-session' | 'per-member'` 必填。deepseek 每会话一个 `<brains>/<impl>/<sessionId>/`，续接复用并校验 `ResumeHandle.home`；Claude Code／Codex 在新提供方包里实现自己的目录写法。`MemberConfigSpec` 只取 rules、skillsDir、projectDocs、model?、mcpServers?、kernelTools?。依据：〔一手〕dev `packages/brain/brain/src/provider.ts:149`、`packages/brain/brain/src/config-dir/shared.ts:12`、`packages/brain/brain/src/contract.ts:204`。

问答以问题号为键保留 `{ selected: string[], custom?: string }`，公共层先校验，提供方无法无损编码时返回 `invalid_input` 且保留 pending。`Meta.modeSwitch`、`SessionConfig.modeId?`、`BrainMode`、`ModeChange.appliesAt` 及模型／模式变化事件均已实现；模式是 CLI 会话模式，权限自动回答由 `--permit` 独立控制。依据：〔一手〕dev `packages/brain/brain/src/contract.ts:302`、`:352`、`:489`；`packages/bundle/brain-cli/src/startup.ts:102`。

## 4 核心机制

### 4.1 自建默认 agent：提供方 `deepseek`，进程 `liwa --profile deepseek`

第 2 步已实现 `brain-acp` + `deepseek-app` + `brain-deepseek`，每会话一个真 CLI 进程、ACP v1 加 `_liwa` 扩展。能力实现与契约证据以 dev 为准；不把本体尚未实现的第二层能力算作已交付。依据：〔一手〕dev `packages/brain/brain-deepseek/src/provider.ts:58`、`packages/bundle/deepseek-app/src/index.ts:1`；本机记录 02 §5、04、06、07。

| 项 | 当前做法 | 依据 |
| --- | --- | --- |
| 形态与装配 | `deepseek` profile = `@liwa/base` + `@liwa/deepseek-app`；web、headless、brain-cli 挂 `brain-deepseek`；`deepseek` 进程自身不挂 brain 提供方，避免递归 | 〔一手〕dev `packages/util/official-bundles/src/bundles.ts:1`、`packages/bundle/brain-cli/cordis.patch.yml:1` |
| 启动／续接 | 优先使用本体安装的 `lib/bin.js`，源码用 tsx；每会话 home 存 patch、profile、转录；`session/resume` 在同 home 重拉。安装不可启动时照常登记、probe 报不可用、开会话明确失败 | 〔一手〕dev `packages/brain/brain-deepseek/src/launcher.ts:1`、`src/provider.ts:117`；本机记录 02 §1 |
| 人设与模型 | 五个预设不带人格行；人设稳定段走 `system-prompt.personaPrefix`、`includeLiwaIdentity:false`，notes 走 agent 作用域并 `interpolate:false`；model 可省，有值才写默认模型与选择 | 〔一手〕dev `packages/brain/brain-deepseek/src/session-patch.ts:53`；本机记录 02 §5.2／10 |
| 会话策略 | patch 控制 agent-instructions、skill-filesystem、tool-skill、compaction-basic、tool-result-pruner；规矩写会话 home 的 AGENTS.md，LIWA_AGENTS_HOME 指空隔离目录；`projectDocs:false` 清空项目候选，`compaction:off` 真关两条压缩行 | 〔一手〕dev `packages/brain/brain-deepseek/src/session-patch.ts:66`、`:114`；本机记录 04 M1 |
| 原生工具 | `none` 清空原生工具，`readonly` 按已校验的 readonlyTools 白名单，MCP 不受影响；none＋skillsDir、非 worktree＋原生子 agent 在拉进程前拒绝。工具指引随工具可见性出现 | 〔一手〕dev `packages/brain/brain-deepseek/src/provider.ts:151`、`packages/bundle/deepseek-app/src/index.ts:232`；本机记录 04 M1 |
| 回合／送达 | `startTurn` 发 session/prompt；`next_step` 走 `_liwa/steer`，无在途回合回 unavailable；`nextTurn:false`，`deliver(next_turn)` 恒 unsupported，上层在边界调用 startTurn | 〔一手〕dev `packages/brain/brain-deepseek/src/provider.ts:64`、`src/session.ts:183` |
| 收尾与预算 | `agent/pre-step` 拒绝超预算下一步；工具预算／子策略拒绝调用；成功的 concludeOn 工具让回合收尾，不额外装预设 complete 段 | 〔一手〕dev `packages/bundle/deepseek-app/src/index.ts:1`；本机记录 02 §5.2、§6C⑦ |
| 权限／问答 | approval 经根会话 `session/request_permission`；带工具 title、rawInput、理由 content，子请求加 childId、直达主人；ask_user_question／计划审批走表单 elicitation，无损答案在严格 `elicitation.ts` 编解码，不能编码就拒绝 | 〔一手〕dev `packages/acp/acp/src/updates.ts:74`、`packages/brain/brain-acp/src/elicitation.ts:182`；本机记录 06 N1／N3、07 §2 |
| 模型／模式 | `setModel` 当前路由内切换并核对；模式 `default` / `plan`，空闲立刻、在途下一步生效；计划获批回 default，状态未变不重复发事件；`--mode` 为模式、`--permit ask|allow-once|allow-session|deny` 为自动答权限 | 〔一手〕dev `packages/brain/brain-deepseek/src/session.ts:137`、`:160`、`packages/acp/acp/src/modes.ts:1`、`packages/bundle/brain-cli/src/startup.ts:102` |
| 子 agent | deepseek 装配 delegatedApproval:forward；底座默认 reject（钉 never），forward 继承父审批策略并上送主人，父 agent 不能代批。子结果可叫醒 CLI 自开回合，后台子事件保留原回合归属；当前不流逐条子消息／工具时间线 | 〔一手〕dev `packages/bundle/deepseek-app/cordis.patch.yml:48`、`packages/subagent/subagent/src/child-agent.ts:227`；本机记录 04 M3／M5、06 §6 |
| 取消 | shared 接受已确认的原生中断，只收尾调用时捕获的回合；ACP 通知要等该回合终止。deepseek 的 pause／drain／owner 停后代，preempt／watchdog／hard_limit 当前只停父；close 停稳并释放进程组 | 〔一手〕dev `packages/brain/brain-deepseek/src/session.ts:38`、`:205`、`packages/brain/brain-shared/src/session.ts:990`；本机记录 06 N2 |
| 用量／扩展 | `_liwa/usage` 查累计，`_liwa/children` 查子名单，`_meta.liwa.usage` 报回合与子用量；CLI 自开回合经 `_meta.liwa.turn` 报 started／ended。G1 的失败／取消总计与 G4 整轮看门狗仍计划补 | 〔一手〕dev `packages/bundle/deepseek-app/src/protocol.ts:1`、`packages/brain/brain-deepseek/src/session.ts:80`；两评估 §6 |

**第 2 步实现约束十项**（对应本机记录 02 §5；下表只写当前状态）：

| # | 约束与现状 | 依据 |
| --- | --- | --- |
| 1 | deepseek 原生 next_turn 不支持，声明 false，回合边界投递归上层 | 〔一手〕dev `packages/brain/brain-deepseek/src/provider.ts:64` |
| 2 | 预设不带人格行／complete 段；稳定人设由 personaPrefix，成功工具由 concludeOn 收尾 | 〔一手〕dev `packages/brain/brain-deepseek/src/session-patch.ts:60`；记录 02 §5.2 |
| 3 | 契约用真 CLI＋脚本化 Messages SSE 模型端点；跨进程不使用绑定进程内格式的 llm-replay | 〔一手〕dev `packages/brain/brain-deepseek/tests/fixtures/scripted-model.ts:1`；记录 02 §5.3 |
| 4 | acpExtensions 文档归底座 `docs/subsystems/brain.md`，不单开页 | 〔一手〕dev `docs/subsystems/brain.md:1` |
| 5 | jsonl-rpc-process 未迁，Pi／OMP 接入时再迁 | 〔一手〕记录 02 §5.5；Claude／Codex 评估 §3 依赖闭包 |
| 6 | 子会话提权经 delegatedApproval:forward 与根会话路由到主人；默认底座 reject | 〔一手〕dev `packages/bundle/deepseek-app/cordis.patch.yml:48`；记录 04 M5、06 N3 |
| 7 | brain-acp 在三个 bundle 有默认 disabled 的行，启用必须给 command；仅 mock 线协议已验，别家真 CLI 未验 | 〔一手〕dev `packages/bundle/brain-cli/cordis.patch.yml:1`；记录 02 §5.7、§8 |
| 8 | `_liwa` 线格式与扩展插件归 `@liwa/deepseek-app` 包根，构建入口只有包根／startup | 〔一手〕dev `packages/bundle/deepseek-app/src/index.ts:1`、`src/protocol.ts:1`；记录 02 §5.8 |
| 9 | 有 installAnchor 时跟本体安装；没有才回退 PATH liwa，找到安装但入口缺失要报 unavailable | 〔一手〕dev `packages/brain/brain-deepseek/src/launcher.ts:1`；记录 02 §5.9 |
| 10 | personaPrefix 含双花括号仍会被底座模板插值；notes 不插值。人设生成方需认识这一限制，不声称任意文本逐字注入 | 〔一手〕dev `packages/brain/brain-deepseek/src/session-patch.ts:60`；记录 02 §5.10 |

公共进程桥归严格编译的 `@liwa/brain/src/process.ts`；shared／acp 的主 tsconfig 严格，只有独立 `tsconfig.paseo.json` 编译迁入源码。问答 codec 属严格自写源码，迁入 ACP 文件只接 schema／content。依据：〔一手〕dev `packages/brain/brain/src/process.ts:1`、`packages/brain/brain-shared/tsconfig.json:1`、`packages/brain/brain-acp/src/elicitation.ts:1`；本机记录 06 建议修 3、08。

### 4.2 `brain-claude-code`（Claude Code，经 Claude Agent SDK）

| 项 | 做法与边界 | 依据 |
| --- | --- | --- |
| 来源 | 迁 Paseo Claude 长会话与完整原生子观察；推荐的生产输入 24 文件／11,883 行，models／manifest 最小 helper 留法待第 4 步确认，不迁整个 Manager／外部历史导入 | 〔一手〕Claude 评估 §3.1–3.3；〔推理〕裁剪建议 |
| SDK／二进制 | SDK 精确 `0.3.263`，经 launch.resolveExecutable 解析本机真实 claude，显式给 pathToClaudeCodeExecutable；评估版本 2.1.318，SDK 自带 2.1.263 不用；2.1.292 仅为后台 roster 已知门槛，正式下限待真机验收 | 〔一手〕Claude 评估 §2；`S:sdk.d.ts:1822`、`S:package.json:83`；handoff 决策 60 |
| 受管进程 | SDK 的 spawnClaudeCodeProcess 走 launch.spawn／ctx.subprocess；搬底座 claudeSpawnSpec／ManagedClaudeCodeProcess 的桥，不搬一次性委派的 persistSession:false、拒问答与只收最终答案策略 | 〔一手〕Claude 评估 §2；dev `packages/subagent/subagent-claude-code/src/process.ts:30` |
| 配置／Key | 空壳子、只加载灵鲸注入内容；不启项目 settingSources，claudeMdExcludes 只能筛 memory，不能过滤项目 hooks/settings。首版 Key 与可选兼容 Messages BASE_URL，隔离 config／securestorage，禁止读默认身份；确切组合与零读取仍须 A2 | 〔一手〕handoff 决策 57–58；Claude 评估 §5，`S:sdk.d.ts:2075`、`:8144` |
| 人设 | 实例／想事／自己的事／整理用 custom systemPrompt；干活用 claude_code preset + append，stable 在前、notes 在后；项目文档受控注入，不能覆盖人设／家规 | 〔一手〕Claude 评估 §4；`S:sdk.d.ts:2108`；决策 33、58 |
| 原生工具／审批 | tools:[] 可关闭 built-in，MCP 单独注入；permissionMode 显式，禁 bypass。canUseTool 只处理需审批调用，要求每次经内核时需额外 PreToolUse 门，不能把 allowedTools 当工具白名单 | 〔一手〕Claude 评估 §4；`S:sdk.d.ts:1495`、`S:sdk.mjs:202`；〔推理〕策略落实 |
| 问答／会话允许 | 新包覆写 permissionAnswerInput；按问题号找原文，annotations.notes 与多选表达必须真机核验；逗号歧义／重复全文等装不下时拒绝并保留待答。allow_session 仅对可生成窄规则的工具推荐展示，是否列首版见 handoff 待定 10／12 | 〔一手〕Claude 评估 §4，`S:sdk-tools.d.ts:2575`、`:3823`；〔推理〕编码边界 |
| 原生子 agent | work 放开 Agent；Paseo canonical childId 是首次 Agent tool_use_id，task_id／agentID 用映射关联，不能直接混用。后台跨回合、roster 未知不回收；pause／drain／owner 先逐个 stopTask 再 interrupt，preempt／watchdog 只停父，hard_limit 策略待定；close 终止进程组 | 〔一手〕Claude 评估 §4；`paseo@8018231a:packages/server/src/server/agent/providers/claude/subagents/live-source.ts:147`；〔推理〕取消接线 |
| 送达／取消 | next_step 用 priority:next；next_turn 须补专用入队／撤回并验证，未验前 false；撤未读输入后 interrupt，Paseo 吞中断错误的分支不能保留，未知停止须使公共层 stopping | 〔一手〕Claude 评估 §4；Paseo `claude/agent.ts:4501`；〔推理〕 |
| 预算／收尾 #35 | maxTurns 管主循环，不是所有子任务/helper 的总限额；PostToolBatch continue:false 有源码支持，需成功调用账本、区分父子／并行批、确认终止帧；未通过前不声明 concludeOn:true | 〔一手〕Claude 评估 §4、§8；`C:bin/claude.exe:2392536`、`:2397848`；〔推理〕落法 |
| 压缩 #36 | 源码有 settings.autoCompactEnabled:false、DISABLE_AUTO_COMPACT、DISABLE_COMPACT；后者覆盖 reactive／手动压缩路径。实例开放前做长上下文实测，不能直接把开关存在当验收通过 | 〔一手〕Claude 评估 §4；`C:bin/claude.exe:2388766`、`:2390214`、`:2391829` |
| 用量／续接 | modelUsage 是 Query 生命周期累计且含子／sidechain，逐模型差分；result.usage 只主循环，task_notification.total_tokens 是上下文，不能当子消费；未知分项留空。resume 用原生 UUID＋同配置根，G1 后补取消／失败结算 | 〔一手〕Claude 评估 §4／§6；`S:sdk.d.ts:4966`；Paseo `claude/project-dir.ts:33` |

### 4.3 `brain-codex`（Codex app-server）

| 项 | 做法与边界 | 依据 |
| --- | --- | --- |
| 来源／二进制 | 迁 Paseo 8 个生产文件原始 10,131 行，已有 35 个 shared 复用；用 PATH 本机真实 codex app-server，评估版本 0.163.0，正式下限待 A3；不用 Codex daemon/proxy 代替灵鲸宿主 | 〔一手〕Codex 评估 §2–3；handoff 决策 60 |
| 进程 | 每会话一个、全部走 launch.spawn；提供方不自行脱管或 unref。底座 POSIX detached:true 用于建立受管进程组，保留底座所有权与终止阶梯 | 〔一手〕dev `packages/subprocess/subprocess-local/src/spawn.ts:448`；Codex 评估 §2 |
| 配置／Key | 空壳子：CODEX_HOME 与 HOME 均隔离，禁自带全局／项目设置、技能、钩子与插件；project_doc_max_bytes=0 只关自动文档，不等于隔离所有来源。项目内容、developerInstructions、MCP 由灵鲸注入；Key 采用明确 API／自定义 provider env_key 路线，不默认读取主人登录 | 〔一手〕handoff 决策 57–58；Codex 评估 §5；〔二手〕官方 0.163 配置／skills 源码 |
| 范围／原生工具 | V1 只 work（干活与查资料）；原生工具按 Codex 沙箱与审批，默认 workspace-write＋on-request。read-only 仍能读／跑只读命令，on-request 不保证每次经过本体；不接受要求清空原生工具的组合 | 〔一手〕handoff 决策 59；Codex 评估 §4.1 |
| 人设／模式 | thread/start 与 resume 均带完整新代 developerInstructions、cwd、审批、沙箱、模型与 MCP；模式映射 plan，不能把审批档位当成相同的模式语义 | 〔一手〕Codex 评估 §2／§4；`G:v2/ThreadResumeParams.ts:29` |
| 送达／取消 | turn/start、turn/steer(expectedTurnId)、turn/interrupt；idle 退出报 session.exited；取消后未确认停稳就拒绝新活，原生后台终端与子线程需各自核实停止 | 〔一手〕Codex 评估 §4.1／§8；Paseo `codex-app-server-agent.ts:5061` |
| 权限／问答 | 请求保留 string／number RPC id；会话允许按原生 availableDecisions 生成，永久规则不自动开放。答案按 question.id 逐项保留、custom 编独立 user_note，不能 split 逗号或缺答案默认首项；isOther 不是 notes 开关；原生 schema 没有 multiSelect。异步问题／计划审批由 G2 承载，秘密输入无通道时明确拒绝 | 〔一手〕Codex 评估 §2、§4.2／§6；`G:v2/ToolRequestUserInputQuestion.ts:9`；〔二手〕官方 TUI notes 行为 |
| 原生子 agent／用量 | threadId 作稳定 childId，观察 collabAgentToolCall／subAgentActivity、父子归属与重开；移除 Paseo 丢子 telemetry 的过滤。⑪ 实测同连接到达与父 total 包含关系，G3 才能承载实时 childId；缺通知标未知，不填 0 | 〔一手〕Codex 评估 §4.1／§6；Paseo `codex-app-server-agent.ts:5671`；`G:v2/ThreadTokenUsageUpdatedNotification.ts:6` |
| 次数／收尾 | budget.inferences:false、toolCalls:false；reasoning/message 条目不是请求数，通知不是执行前闸。concludeOn 仅候选成功后中断、确认停止再报 completed，不能保证零额外推理；#40 通过前 false | 〔一手〕handoff 决策 59；Codex 评估 §4.1／4.3；〔推理〕候选收尾 |
| token／额度／压缩 | total 按线程基线差分，last 只作上下文线索；父总量与子分项不重复加。账号额度是窗口快照，非会话 token／余额；无需全局 usage-source 扫描。off 未证实，保守 always_on，V1 不跑实例 | 〔一手〕Codex 评估 §4／§6；`G:v2/ThreadTokenUsage.ts:6`；〔推理〕保守 Meta |
| 一次性／续接 | Paseo persistSession:false 已发 thread/start.ephemeral:true；此时 persistence 必为 null，不承诺整个 home 零文件。普通 work 用原生 thread.id 续接；查资料一次性选择是实例配置还是可选会话字段待主人定，不能按提示词猜；Codex V1 不执行 tidy | 〔一手〕Codex 评估 §2／§4；Paseo `codex-app-server-agent.ts:5563`、`:7501`；`G:v2/ThreadStartParams.ts:44` |

### 4.4 `brain-acp`（通用 ACP：别家 CLI，也是 `brain-deepseek` 的底子）

Paseo ACP 客户端、GenericACPAgentClient 与五个厂商 shim 已迁入 brain-acp，SDK 1.4；严格 adapter／elicitation 负责契约与问答编解码，迁入文件只接线。插件一行一个 impl，默认 disabled，启用时必须配置 command；通用 ACP nextStep:false 恒 unsupported，原生 nextTurn 行为须按能力声明。真 deepseek 通路与 mock ACP 契约已验，Gemini／OpenCode 等真实 CLI 未验；不把厂商 shim 存在算作已经接通。ACP 标准无人设字段，别家提供方的指令注入与空壳子能力要逐家验证，做不到的组合拒绝。依据：〔一手〕dev `packages/brain/brain-acp/src/adapter.ts:1`、`src/index.ts:1`、`src/elicitation.ts:1`；本机记录 02 §7、06 §4.3。

### 4.5 子 agent：Paseo 的方式怎么落到灵鲸

**Paseo 怎么做**〔一手，`paseo@8018231a:public-docs/mcp.md`、`docs/agent-lifecycle.md`、`…/agent/mcp-server.ts`、`finish-subscriptions/index.ts`、`agent-messages/`〕：给每个 agent 挂一个 MCP 服务器（`/mcp/agents`，支持原生工具的提供方直接注册），工具有 `create_agent`（`provider/model`、`initialPrompt`、`workspaceId`、`settings`、`notifyOnFinish`）、`send_agent_prompt`、`get_agent_status`、`get_agent_activity`、`list_agents`、`cancel_agent`、`archive_agent`、`kill_agent`、`update_agent`、`set_agent_mode`、`list_pending_permissions`、`respond_to_permission`，再加工作区、终端、调度、档案、提供方几组；子 agent 由标签 `paseo.parent-agent-id` 挂在父下、父归档级联；创建一律异步；`notifyOnFinish` 默认 true，完成 / 出错 / 权限请求以 `<paseo-system>` 信封的 agent 消息投给父（2 秒安静窗口合批，父在跑就 steer）；订阅意图持久化在 `finish-subscriptions.json`、至少一次；父可以 `respond_to_permission` 代批；CLI 自己的子 agent（Claude `Agent`、Codex 协作、OMP `child_session`）只观测，存描述符与只读时间线；还有一条 CLI 路：agent 的 shell 里跑 `paseo run --provider codex --no-wait`，子 agent 进同一工作区。

**灵鲸的两条路**（主人定："默认走自己的 agent 子机制，然后通过 paseo 可以调用其他 cli 的子 agent"；"原生子 agent 干活的活里放开，只观察"）：

| | 路 ① 提供方自己的子 agent（默认） | 路 ② 跨 CLI 子活 |
| --- | --- | --- |
| 谁能用 | **只有干活与查资料的活**（`childPolicy.native` 只对 `work` 为 true）；实例、想事、自己的事、整理一律没有 | 干活活与想事·立场类（`spawn` 在工具档里，任何提供方） |
| 怎么开 | `deepseek`：底座 `tool-subagent`（`subagent{ prompt, description, cwd?, agentPreset? }`）+ `tool-subagent-control`（`send_message`、`interrupt_agent`、`list_agents`），spawn（空对话）或 fork（带父已完成轮次）进程内后端；Claude：`Agent` 工具；Codex：协作 agent 工具。CLI 怎么调度、几个并发，按各家自己的规则，灵鲸不干预 | 内核工具 `spawn(执行者, 交接包)`（`overall.md` §5.2 已有）+ `look(活号)` + `answer(活号, 答复)`（给干活活开放、限自己的子活） → toolport → tasks 开子活（`tasks.open{ 父活, 种类, 执行者 }`）→ minds → `brains.openChildTask` 在指定提供方上开会话 |
| 人设 | `deepseek`：进程级 `personaPrefix` 是全局段，子 agent 的 scope 自动继承；Claude / Codex 的原生子 agent 不带她的人设——它们是父活的执行细节，不对外说话、不写账本、不进第三层，产出只经父活回到她（决策 5 的边界由此守住） | 子活是第三层的活，按 §4.2 / §4.3 注入 |
| 归属 | 父活的内部细节：不登记成第三层的活，不进看板；`brain_child{ native-child }` 登记 | 第三层的活，`父活` 字段指向父；归属实例与父活相同（`four-layers.md` §2.7） |
| 观察与记录 | 三家都翻成 `child.started{ childId, label, provider, parentChildId? }` / `child.ended{ stopReason, usage }`：`deepseek` 从 `ctx.subagents` 的 `subagent/start|end` 经 `_meta.liwa`；Claude 从任务协议（`task_*` 消息）；Codex 从 `collabAgentToolCall` / `subAgentActivity` 条目。brains 写 `brain_child` 与 `brain.child.*` 事件；主控台的活页能看到子 agent 的名单、状态与用量（只读） | 全是第三层事件（`task:<子活>` 流） |
| 回报 | 按各家自己的方式回到父（`deepseek`：结果作为父的下一步输入；Claude：`task_notification`；Codex：`wait`）；灵鲸不插手 | 子活的 `report` / `ask` / `ended` 事件经 tasks 投给父活（`next_turn`，合批）；父活 `answer` 回问 |
| 预算 | 子 agent 可跨父回合，支出归父活；父总量与子分项不得重复累加，后台末尾口径待 ⑩／⑪，实时 childId 等 G3；`childPolicy{ maxDepth, maxConcurrent }` 只有 `deepseek` 能在服务端 `setup` 限死（底座 `delegationDepth`、`maxDepth`），Claude / Codex 靠各家可兑现能力；Codex 不承诺推理／工具硬限，公共整轮看门狗待 G4 落实，不能把它写成已有兜底 | 子活有自己的 `limits`，从父活预算里划；tasks 记账 |
| 权限 | 子 agent 的权限请求经父会话的同一条路上报、带 `childId` → `task.permission` → 直推主人（**父活不能代批**：Paseo 让父代批，弱模型替主人做安全决定不合适） | `task.permission` 直推主人 |
| 清理 | 父会话 `cancel(pause | drain | owner)` 先停子 agent 再停主回合；`cancel(preempt | watchdog)` 只停主回合；hard_limit 的统一子清理策略待定（deepseek 当前只停父）；`close` 杀整个进程组；父活 `manage(stop)` 一并停；未收到 `child.ended` 的在 `session.closed` 时补记 `ended{ stopReason: 'aborted' }` | 父活结束时 tasks 级联 `manage(stop)` 子活；孤儿由 brains 的 `brain_child` 对账 |
| 不做 | — | Paseo 的 CLI 路（活的 shell 里起别的 agent）：绕开令牌与权限链，不开放 |

依据：〔一手〕底座 `tool-subagent/README.zh.md`（"外部后端执行一次任务，并通过完成通知返回最终回答"）、`tool-subagent-control/src/{index,list-agents}.ts:30,76,82`、`subagent-spawn-in-process/README.zh.md`、`subagent/src/types.ts:31-66,136-186,287-356`（`SubagentActivationSpec.delivery: 'parent' | 'caller'`、`maxDepth`、`agentPreset`）、`core/agent/src/index.ts:66`（`meta.delegationDepth`）；Paseo `docs/agent-lifecycle.md`"The subagents track"（提供方子 agent不插进 AgentManager，只存描述符与只读时间线）、`provider-subagents/store.ts`；`paseo-architecture.md` §3"不要默认代批"；决策 5、14。〔推理〕路 ② 用 `spawn` 而不照搬 `create_agent` 全家桶：灵鲸的活有归属实例、受众、交接包与核验，这些 Paseo 没有，"活管子活"比"agent 管 agent"少一套平行的生命周期。

### 4.6 外部 CLI 配置：空壳子，内容由灵鲸注入

CLI 自带的全局与项目配置、钩子、本事、插件一律不加载；灵鲸给人设、规矩、项目文档内容与 MCP。`projectDocs` 表示是否由灵鲸受控读取并注入项目 CLAUDE.md／AGENTS.md，不能据此开启 CLI 的 project/local 配置源；干活／查资料需要项目事实，其余会话不注入。具体子目录继承、长度与去重在第 4、5 步设计，未确认前不自行扩展。依据：〔一手〕handoff 决策 58、任务书 03；〔推理〕注入实现需设计。

| 提供方 | 受控来源与隔离 | 真机验收边界 | 依据 |
| --- | --- | --- | --- |
| Claude Code | CLAUDE_CONFIG_DIR 与 securestorage 根固定到成员／impl，SDK 明确禁用 CLI 自带来源，灵鲸设置／自有 hooks／MCP 显式传入；不加 project/local；strictMcpConfig 限制 MCP | settingSources、memory、插件与 hooks 有不同入口；claudeMdExcludes 不能隔离 settings。设备身份等固定 home 读取路径须文件访问审计；不能用 disableAllHooks 破坏自身收尾钩子 | 〔一手〕Claude 评估 §5、§10；`S:sdk.d.ts:2075`、`:8144`；`C:bin/claude.exe:2386243` |
| Codex | CODEX_HOME ＋单独 HOME；project_doc_max_bytes=0 关原生项目文档自动注入，developerInstructions 注入灵鲸内容；配置／skills／系统管理层另逐项禁用或隔离 | CODEX_HOME 不能独自隔离 HOME/.agents、项目技能与系统设置；untrusted 与文档注入分开；0 不是禁止原生工具主动读文件，不能声称是文件系统沙箱 | 〔一手〕Codex 评估 §5；〔二手〕官方 0.163 agents_md、host_roots、local loader |
| deepseek | 已实现每会话 LIWA_HOME、LIWA_AGENTS_HOME 隔离、会话 patch 与规矩；projectDocs 控制内置指令／本事来源 | 自建 CLI 的现状见 §4.1；它的受管指令机制属于灵鲸，不能据此推导外部两家也已隔离 | 〔一手〕dev `packages/brain/brain-deepseek/src/session-patch.ts:66`、`src/provider.ts:173` |
| 其他 ACP | 各提供方通过配置变量与原生接口隔离并注入 | 逐家验，不能只凭 home 环境变量承诺全部隔离 | 〔一手〕本机记录 02 §8；〔推理〕 |

“配置由灵鲸拥有”不等于把整个状态目录设为只读：CLI 仍需写自己的转录、索引与缓存；会话令牌、模式、权限与模型按会话覆盖，不能反复覆写成员共用配置导致并发串用。每个 impl 分开配置根与认证，删除一个会话只删其确定资料，不误删同实例其他会话。子进程环境先剥凭据再显式注入，ResumeHandle、日志与 argv 不含秘密。Key 值的凭据引用机制待定，见 §4.10。依据：〔一手〕两份评估 §5；dev `packages/brain/brain/src/provider.ts:149`；〔推理〕并发与删除边界。

验收用假的全局／项目配置、hooks、skills、插件、MCP 分别放哨兵并审计实际文件访问；不以“没有新文件”证明“没读取”。若本机真实 CLI 证明不了空壳子隔离，停止并问主人，不静默放宽。两家 V1 首先用 Key，不复用主人默认 OAuth 身份；具体配置能力以后逐项扩充。依据：〔一手〕handoff 决策 57–58；两份评估 §8。

### 4.7 人设注入与前缀（按提供方）

| 提供方 | 稳定前缀 | 会话说明 | 每轮前缀 | 续接后 |
| --- | --- | --- | --- | --- |
| deepseek | 会话 patch 的 `personaPrefix`（进程级，一次；子会话继承） | `_meta.liwa.notes` → agent 作用域段 | 提示词最前的 `<liwa-block name="前缀">` | 同一目录重拉进程 + `session/resume`，身份探针 |
| claude | 自定义 `systemPrompt` / 预设 + `append` | 同上拼进去 | 同上 | `resume` + 同一份 `systemPrompt`，身份探针 |
| codex | `developerInstructions` | 同上 | 同上 | `thread/resume` 再带，身份探针 |
| 别家 ACP | 指令文件或前缀 | 同上 | 同上 | 同上 |

### 4.8 Paseo 迁移的方法与落位

**方法**（决策 1、28；`engineering.md` §9 末条；主人定"原地改 + NOTICE"）：固定 `8018231a`；每个文件原样拷进目标包的 `src/paseo/<原相对路径>`，文件头加来源行；**原地改**需要改的行，不叠映射层；每包 `NOTICE` 写来源与提交、Apache-2.0 链接、逐文件改动摘要（Apache 4(b) 标注改动、4(c) 保留声明；上游无 `NOTICE` 文件〔一手，`paseo@8018231a:LICENSE`〕）；根 `THIRD_PARTY_NOTICES.md` 加条目。`src/adapter.ts` 只做类型映射（`AgentSession` → 契约句柄、`AgentStreamEvent` → `BrainEvent`、`AgentPermissionRequest.actions` → `options[]`、`AgentUsage` → `Usage`、提供方子 agent 描述符 → `child.*`）。依赖映射：`utils/spawn` → `ctx.subprocess.spawn`；`tree-kill` → `SubprocessHandle.terminate()`；`executable-resolution` → `ctx.subprocess` 的可执行解析；pino → cordis logger；`@getpaseo/protocol/*` 五个小文件拷进 `brain-shared`；`@agentclientprotocol/sdk` 升 1.4.0；`lru-cache`、`zod` 4 保留。落位逐项见附录 A。

### 4.9 包划分与进程模型

| 包 | 内容 | 进程 |
| --- | --- | --- |
| `packages/brain/brain` | 契约、`ctx.brains`、会话句柄包装、配置目录生成、子 agent 登记；`structured.ts`（Paseo `agent-response-loop` 改造版）待后续接入 | 本体 |
| `packages/bundle/brain-cli` | 组合包 `@liwa/brain-cli`，提供 `liwa brain list / probe / run`，经随附 profile `brain` 启动；命令行依赖归它 | 一次性本体命令；常驻会话托管在推进第 ③ 步补 |
| `packages/brain/brain-shared` | `src/paseo/` 已迁入 35 个共享文件，含时间线三件及其类型、`jsonl-frame-decoder`、`provider-subagents/store.ts`；`PaseoBrainSession`、回合输入／liwa-block 渲染与日志器；进程桥归严格 `@liwa/brain` | 库 |
| `packages/test-support/brain-testkit` | 假提供方 `scripted`、契约测试 `describeBrainProviderContract`、测试宿主与事件记录器 | 测试 |
| `packages/brain/brain-acp` | Paseo ACP 客户端（SDK 1.4）+ `src/adapter.ts` + 厂商 shim 配置 | 本体里的客户端 |
| `packages/brain/brain-deepseek` | `brain-acp` 子类 + `_liwa` 三方法 + 会话 patch 生成 | 本体里的客户端 |
| `packages/brain/brain-claude-code`、`brain-codex` | `src/paseo/` + `src/adapter.ts` + `src/index.ts` + `NOTICE` | 本体里的客户端 |
| `packages/bundle/deepseek-app` | `liwa --profile deepseek`：`@liwa/acp` + `_liwa` 扩展处理器 + 五个预设 + 人设行 + `subagent` 系列 | **独立进程，每会话一个** |

`brain` profile 为 `@liwa/base` + `@liwa/brain-cli`，默认挂 deepseek，通用 ACP 行 disabled；测试用显式 patch 挂假提供方。`liwa brain run --provider <impl> [--model <model>] <提示词>` 开一会话、跑一回合、输出事件并关闭；不给 `--model` 就省略模型值，配置目录也不写占位值，由 CLI 采用自己的默认模型。依据：〔一手〕dev 分支 `packages/bundle/brain-cli/{cordis.patch.yml,src/startup.ts,src/index.ts}`、`packages/util/official-bundles/src/bundles.ts`（命令与组合）；〔一手〕主人已定模型省略语义（handoff 决策 53，已实现）。

`brain-shared` 与 `brain-acp` 的主项目按全仓严格度检查，仅 `tsconfig.paseo.json` 对 src/paseo 采用迁入源码编译选项；自写 codec／session／process 不借此放宽。时间线、store 与协议类型只有 brain-shared 一份，网关直接引用；JSONL decoder 由 ACP／Codex 共用。依据：〔一手〕dev `packages/brain/brain-shared/tsconfig.json:1`、`tsconfig.paseo.json:1`、`packages/brain/brain-acp/tsconfig.json:1`、`packages/brain/brain/src/process.ts:1`。

进程表：本体一个；`liwa --profile deepseek`、`claude`、`codex app-server`、别家 ACP agent 都是每会话一个（闲置回收后下次续接再拉）。全部经 `ctx.subprocess.spawn`：进程组一起杀、环境剥凭据、`graceMs` 内先礼后兵；会话进程经 `BrainLaunchContext.spawn`，拉起前 brains 在内存登记 `brain_process`，命令与 argv 哈希用于归属记录，本阶段不记录 pid；握手 30 秒。依据：〔一手〕dev 分支 `packages/brain/brain/src/session.ts`；〔一手〕Paseo 生命周期设计（§11）。

### 4.10 同一个 CLI 多个提供方

同一个插件在 cordis.yml 挂多行，每行一个不同 impl，分别给 label、模型列表、环境、禁用工具、二进制覆盖；一行就是独立提供方实例，可同时开会话。不是复制插件包，也不把 CLI 类型写死成所有会话共用一个身份。Claude Code／Codex 沿 brain-acp／brain-deepseek 的一行一实例形状，配置与认证根按 `<成员>/brains/<impl>/` 分开。依据：〔一手〕handoff 决策 57；`paseo@8018231a:public-docs/custom-providers.zh-CN.md:1`；dev `packages/brain/brain/src/provider.ts:158`。

Paseo 自定义提供方的 extends(claude/codex/acp)、label、env、models、disallowedTools 与二进制覆盖是功能参照，灵鲸用插件装配与 impl 表达；具体字段 schema、缺省解析和模型目录 API 在各自设计中明确。Key 推荐用 credential-ref 指向受管凭据，由宿主仅向对应进程注入，值不明文写配置；凭据引用的名字、存储归属与解析 API 尚待主人确认。依据：〔一手〕待写回清单第 7 条；〔推理〕凭据引用建议，不作为已实现契约。

### 4.11 公共层 G1–G4

| 缺口 | 当前事实 | 安排／待设计的补法 | 依据 |
| --- | --- | --- | --- |
| G1 取消／失败用量 | 只有 completed 累加 token／inferences，interrupted／failed 无 usage；update 仅保留观测快照，总量漏已知支出 | 现在独立小活补；推荐可选 terminal.usage＋按回合幂等结算与 shared 透传，不伪装 completed、不盲加累计快照；字段待独立设计 | 〔一手〕dev `packages/brain/brain/src/contract.ts:397`、`src/session.ts:473`；两评估 §6；〔推理〕补法 |
| G2 会话级待答 | 父回合终止清父 pending，idle 父请求拒绝，Paseo followUpPrompt 未消费；承载不了 Codex 跨回合异步问题／计划审批 | 接 Codex 时补；推荐会话级生命周期，答复后的回合另经正常准入；不伪装成子 agent、不延迟真实 terminal | 〔一手〕Codex 评估 §6；dev `packages/brain/brain/src/session.ts:529`；〔推理〕补法 |
| G3 实时子用量 | usage.update 没 childId，只有 child.ended 带分项，不能逐通知写子归属 | 接 Codex 时补，先测⑪；快照／消费增量／父总量与子分项的唯一结算口径需确定，后台跨父 terminal 支出不借新回合归账 | 〔一手〕dev `packages/brain/brain/src/contract.ts:487`、`src/views.ts:124`；Codex 评估 §6；〔推理〕补法 |
| G4 回合看门狗 | watchdogMs 只有配置，当前 API call 超时不是整轮计时 | 现在独立小活落实公共职责；每回合定时器只取消捕获轮，terminal／close 清理，取消失败维持 stopping，不影响后来新轮 | 〔一手〕dev `packages/brain/brain/src/contract.ts:168`、`src/session.ts:205`；Codex 评估 §6；〔推理〕补法 |

四项均未实现；G1／G4 是两家共用缺口，不在 Codex 包再建另一套机制。每项需回归现有 scripted／ACP／deepseek，验证终止去重、跨回合 pending、子分项不重算和旧 timer 不取消新回合。是否增加问题补充文字标志、ephemeral 逐会话选择另列待定，不混成已批准字段。依据：〔一手〕handoff 决策 61；两评估 §6；〔推理〕验证要求。

## 5 交互时序

以下为第二层接入后的目标时序；本阶段调用方直接经 `ctx.brains` 开会话，归属、人设、预算等显式给值，经历流、minds、toolport、tasks、guard、跨重启恢复与孤儿清理等搭第二层时补。网页现有对话继续使用进程内会话，界面接公共层也在第二层做。依据：〔一手〕主人推进决定（handoff 决策 47）；〔一手〕dev 分支 `packages/bundle/brain-cli/src/index.ts`。

**第三层：`tasks.open` → 活会话**。tasks 裁好工具档与交接包 → `minds.openTask` → minds 从 roster 取 `{ impl, model?, fallback }` → `toolport.issue` 拿令牌 → `brains.prepareConfigDir` → `brains.createSession({ impl, cfg })`（`owner{taskId, gen}`、`mindKind`、`persona`、`cwd` = worktree、`configDir`、`projectDocs`、`kernelTools`、`nativeToolPolicy`、`permission{ kernel }`、`compaction`、`limits`、`concludeOn`、`childPolicy`）→ brains 登记进程、经 `ctx.subprocess` 拉起（deepseek：`liwa --profile deepseek --patch`；claude：SDK `query`；codex：`codex app-server`）、握手 → `session/new` / `query` / `thread/start` → 句柄交回 → `startTurn(交接包)`。之后：`tasks.send` 四种类型 → `deliver(next_turn)` / `deliver(next_step)` / `cancel` / 高优先 `next_turn`；`permission.request` → `task.permission` → 主人 → `respondToPermission`；活里开自己的子 agent → 路①（brains 只观察登记）；活里 `spawn` → 路②（toolport → `tasks.open{父活}` → 同一条链再开一个会话）；结束 → `close`（进程一起关）→ `toolport.revoke`。

**第二层：实例会话**。minds 重建 → 同上 `createSession`（`mindKind: 'instance'`、`nativeToolPolicy: 'none'`、`compaction: 'off'`、`concludeOn: ['reply','no_reply','say']`、`childPolicy.native: false`，默认 impl `deepseek`）→ 补投。每条输入：投递器合批 → `deliver(next_turn, wake)`（deepseek 的 next_turn 为 unsupported，由投递器在边界改调 `startTurn` → `session/prompt`）；主人对自己回合的追加 → `deliver(next_step)`（deepseek：`_liwa/steer`）；抢占 → `cancel(preempt, keepQueue)`；看门狗 → `cancel(watchdog)`；换新或换提供方 → `close` + 新代 `createSession`；回收 = 关进程保留目录；再醒 → 先试 `resumeSession`（同一目录重拉进程 + `session/resume`），续接后身份探针，答不对就换代重建。

**恢复**：本体重启 → brains `recover`：`brain_session` 里 `open` 的全部标 `closed{restart}`，`brain_process` 里 `live` 的交 03 清孤儿，`brain_child` 里未结束的标 `aborted`；minds 按 02 §6 决定重建还是续接。

## 6 出错与恢复

| 情形 | 第四层做什么 | 依据 |
| --- | --- | --- |
| CLI 两回合之间退出 | 报 `session.exited{process_exit}`，只影响这一个会话；未结束的子 agent 补记 `child.ended{aborted}`；minds 续接或重建 | `agent-lifecycle.md`〔一手〕 |
| 握手超时、二进制缺失、鉴权失败 | `createSession` 抛 `unavailable` / `auth`；minds 换 fallback | `overall.md` §12.3 |
| `cancel` 被拒或超时 | 标"停止中"、拒绝新 `startTurn`；minds 换代 | `agent-lifecycle.md` Cancellation〔一手〕 |
| 续接失败 | `resumeSession` 抛 `not_found` / `unavailable`；minds 新代重建，不读旧转录 | `overall.md` §12.2 |
| 子 agent 卡住 | 路①：按取消原因处理子 agent，公共整轮看门狗待 G4；watchdog 只停父，不承诺它会停全部孩子；路②：子活自己的看门狗；父活结束级联 | §4.5 |
| 会话与配置目录 | deepseek：`<成员>/brains/deepseek/<sessionId>/`（整个目录随会话删除）；claude：`<成员>/brains/claude/projects/…`；codex：`<成员>/brains/codex/sessions/…`；按保留期删（底座 `SessionPersistence` 加 `delete`，03）；主人删除内容时按事件号找代次整目录删；备份不含 | `overall.md` §6.4；02 §4.1 |
| 提供方自带压缩触发 | 报 `session.compacted`；实例会话出现即换新并记质量事件 | §3.1 |

## 7 成本与性能

brains 零模型调用。每个活会话一个进程；deepseek 第 2 步源码启动中位 736 ms／315 MB、构建产物 490 ms／265 MB；两轮修复最终测量 744 ms／316 MB、496 ms／264 MB，steer RPC 1 ms、工具结束到次步 24 ms、取消 3 ms（真模型 6 ms）。11-05 同时 10 个进程实际约 2.37 GB、平均 237 MB；并发负载观测与单进程 RSS 口径不同。实例常驻摊薄启动，想事新开要算进延迟，是否预热待定。依据：〔一手〕本机记录 02 §6C、06 §4.7；任务书 03 的实测数字。

用量按提供方真实累计／差量语义结算，子分项不再加到已含子的父总量，未知留空；G1／G3 完成前明确总计缺口。token、自报美元估价、账号额度窗口是不同口径；guard 在第二层按单价与预算准入，不能把换目录视为独立计费额度。依据：〔一手〕两份评估 §4／§6；dev `packages/brain/brain/src/views.ts:124`；〔推理〕汇总边界。

## 8 安全与隐私

令牌只在 `SessionConfig` 与内存，按代次作废；适配器不能自报身份；三个 CLI 的子进程环境由 subprocess 剥干净再显式注入；配置目录每成员一份、CLI 只读它，不碰主人的全局目录；原生工具权限按能力兑现，Codex 交自身沙箱／审批，不承诺每次经过本体；内核 MCP 仍经 toolport，总闸与暂停在第二层落实；子 agent 的权限不让父代批；原生子 agent 只在干活的活里、跑在父会话的沙箱与 worktree 内；转录目录随删除级联、不进备份；`liwa --profile deepseek` 只监听 stdio，不开端口。

## 9 第一版范围与验收

**第 1、2 步已完成**：公共层、35 个共享文件、brain CLI、通用 ACP 与独立 deepseek；deepseek 契约 23/23、真模型 11/11 无重试，结构化问答／子审批／模式／图片／跨回合与取消竞态已核验。07 复核确认修复行为，08 补测使 elicitation 语句／分支／函数／行均达 100%；这不是全仓覆盖率结果。网页仍走进程内路径，第二层相关能力尚未交付。依据：〔一手〕本机记录 06 §4、07、08；dev `2eca7d13`。

**交付目标**：③ 常驻宿主与 Paseo 终端命令（设计中）→ ④ Claude Code → ⑤ Codex，完成后接入达到与 Paseo 同等功能，不能只迁基本聊天后把问答、模式、后台子 agent、审批、计量等静默删出范围。认证首版 Key、同 CLI 多提供方并行、空壳子配置；Codex 的原生沙箱／审批与非硬限边界已定。G1／G4 现在独立补，G2／G3 随 Codex。以后再加灵鲸全局 home、本事、MCP、插件配置机制。依据：〔一手〕handoff 决策 54–61、任务书 03。

下列范围与 A1–A6 中依赖第二层的项目在搭第二层时补验；`session/resume` 的提供方能力可先验，跨重启恢复与孤儿清理不列为当前提供方步骤的完成条件。依据：〔一手〕主人推进决定（handoff 决策 47）。

- **m0**：`@liwa/brain` + `brain-acp`（SDK 1.4）+ `brain-deepseek` + `deepseek-app`（实例预设、`reply` / `no_reply` / `inner`、`_liwa/steer`）；契约测试与回环编解码；`liwa brain list / probe / run`。
- **V1.0**：`brain-claude-code` 全验证（实例、想事、整理、干活）；`brain-codex` 干活与查资料；五个预设；路①（三家的观察）与路②；配置目录生成；备用提供方切换；Paseo 代码与 NOTICE 进仓。
- **V1.1**：Codex 当实例会话、`dynamicTools`、Claude 订阅额度窗口、预热空闲 `deepseek` 进程、离线预审、别家 ACP CLI 验证、主控台的子 agent 面板。

**验收（真实 CLI，Key 由受管入口注入，凭据引用细节待定）**：

| # | 怎么算接通 |
| --- | --- |
| A1 | `brain-deepseek`：本体为主人实例拉起真 `liwa --profile deepseek` 子进程（`LIWA_HOME` 在该会话目录、`~/.liwa` 无新文件）→ `liwa chat` 一句话 → `session/new` 带 `_meta.liwa` → 事件 `brain.session.opened → turn.started → tool.called(reply, inner 同批) → turn.completed{concludedBy: reply, usage.tokens 非空, inferences = 1}`；第 4 步被 `agent/pre-step` 拒；主人追加一句经 `_liwa/steer` 在下一步可见；杀本体重启 → 清孤儿杀掉旧进程 → 同一目录重拉 → `session/resume` 成功、身份探针答对 |
| A2 | `brain-claude-code`：本机真实 `claude`（评估版 2.1.318，正式下限待定）开一件想事活（自定义 `systemPrompt`、`settingSources` 仅限受控灵鲸来源、`CLAUDE_CONFIG_DIR` 在成员目录、`tools: []`），`conclude` 经 MCP 到 toolport（未搭时以受控 HTTP MCP 夹具单验提供方通路）；`maxTurns=3` 第 4 次主循环推理不发生（不代表子任务／helper 总限额）；`~/.claude/projects` 无新文件；`kill -9` 本体后 `claude` 进程被下次启动清掉；`deliver(next_step)` 在下一步可见 |
| A3 | `brain-codex`：真 `codex app-server` 开一件干活活（`developerInstructions`、`CODEX_HOME` 在成员目录、`workspace-write` 限 worktree、读到灵鲸注入的项目 `AGENTS.md` 内容、HOME 隔离）；`report` 经 MCP 到 toolport；写 worktree 外触发 `requestApproval` → `permission.request` → `deny_once` 后回合继续；`turn/steer` 次步可见；`thread/tokenUsage/updated` 进 `brain_usage` |
| A4 | 子 agent：`deepseek` 上的干活活调 `subagent` 开子会话、子结束结果回到父的下一步、`brain_child` 与用量归父；Claude 上的干活活用 `Agent` 工具开一个子 agent → `child.started / ended` 出现在 `task:<id>` 流、用量记在父活、`cancel(owner)` 时子 agent 被 `stopTask`；同一活调 `spawn(codex, 交接包)` 开子活、子活 `report` 回到父活、父活结束级联停掉子活；子 agent 的一次权限请求直推主人而不是父 |
| A5 | 切换：roster 把主人实例从 `deepseek` 改成 `claude` → 空闲换代 → 上下文从账本重建 → 身份探针通过 → 再改回 |
| A6 | 契约：四个提供方过同一套契约测试（假 CLI 回放）与回环编解码；`Meta` 声明为 false 的语义恒回 `unsupported` |

## 10 探针与待实测

源码通路和运行保证分开记录。Claude Code／Codex 两份评估没有启动真实会话，不能当 A2／A3 通过；正式版本下限、隔离、成功收尾与未知用量都以真 CLI 结果决定 Meta。承接 overall §17 的 #35（工具收尾／步数）、#36（压缩）、#40（Codex 中断式收尾），按下面矩阵验。依据：〔一手〕两评估 §8；handoff 决策 60。

| 项 | 已有证据 | 尚待验证与安排 | 依据 |
| --- | --- | --- | --- |
| ① deepseek steer | 真 CLI 透传，脚本端点中位 RPC 1 ms、工具后约 24 ms，真模型同轮次步可见 | 维持回归，不宣称网络响应总耗时是 1 ms | 〔一手〕本机记录 02 §6C、06 §4.4／4.7 |
| ② deepseek 取消 | 脚本模型中位 3 ms、真模型最终 6 ms，旧取消不串新条目 | G1／G4 后回归幂等与只停捕获轮 | 〔一手〕记录 06 N2／§4.7、07 §2 |
| ③ Claude #35 | SDK PostToolBatch 形状、本机 continue:false → preventContinuation → hook_stopped 源码；maxTurns 控主循环 | 成功／失败／并行工具批／子工具、真实终止帧、后续主推理是否停止、队列撤回与多回合重置 | 〔一手〕Claude 评估 §4；`S:sdk.d.ts:2451`；`C:bin/claude.exe:2392536`、`:2397848` |
| ④ Claude #36 | settings.autoCompactEnabled、DISABLE_AUTO_COMPACT、DISABLE_COMPACT 存在，reactive 路径检查后者 | 真 CLI 长上下文压力与文件访问审计；实例的 tools:[]＋MCP 收尾组合，不能只靠类型判断 | 〔一手〕Claude 评估 §4／§8；`C:bin/claude.exe:2388766`、`:2390214`、`:2391829` |
| ⑤ Codex 隔离／压缩／dynamicTools | 本机生成协议有形状；官方 0.163 源码说明 project_doc_max_bytes=0 只关自动项目文档；HOME／项目技能另扫描 | 空壳子全局／项目／系统来源哨兵＋文件审计、灵鲸注入项目内容可见、隔离 HOME；auto compact off 未证实，保守 always_on；dynamicTools 另验稳定性 | 〔一手〕Codex 评估 §2／§4；〔二手〕§5 官方 loader／skills 证据 |
| ⑥ Codex #40 | 成功工具通知后可请求 interrupt，通知不能作执行前闸 | 真实停止状态／成功事实／并行批、是否追加推理，确认前不置 concludeOn:true；推理与工具次数硬限不承诺 | 〔一手〕Codex 评估 §4.3、§8；〔推理〕候选收尾 |
| ⑦ deepseek 拒步 | 第 2 步 pre-step 拒第二步，step/end 后 turn/end blocked 正常落，客户端 completed，1 次推理 | 保留回归，completed 不等于工具成功收尾 | 〔一手〕记录 02 §6C、06 §4.7 |
| ⑧ 进程成本 | 启动与 RSS 见 §7，11-05 十进程约 2.37 GB | 想事活延迟与预热是否值得仍待主人定 | 〔一手〕任务书 03；〔推理〕预热取舍 |
| ⑨ 子权限 | deepseek forward 路由＋childId＋args＋理由真模型无重试通过，父不能代批 | 网页 reject 是否转 forward 待公共层接网页时主人决定 | 〔一手〕记录 06 N3、07 §2；handoff 待定 9 |
| ⑩ Claude 子用量 | Query modelUsage 累计含子／sidechain；task total_tokens 是上下文，canonical childId 与 task_id 不同 | A2 父子累计差分、缓存创建、后台跨父轮末尾、无 result 消费缺项；子分项不重加 | 〔一手〕Claude 评估 §4；`S:sdk.d.ts:4966`；Paseo lifecycle:330 |
| ⑪ Codex 子用量 | 通知有 threadId／turnId／total／last；Paseo 主动丢子 telemetry；公共 update 尚无 childId（G3） | 同连接根＋子至少两次响应、父结束孩子继续，核实通知到达和父 total 是否含子，再定唯一结算；未收到不是零 | 〔一手〕Codex 评估 §4／§6／§8；`G:v2/ThreadTokenUsageUpdatedNotification.ts:6`；Paseo 主文件:5683 |

补充：两家真实组合的版本／Key／模型连通、多提供方并行、结构化问答可编码矩阵、会话允许与跨回合待答、owner 停后台／preempt 保留／close 整组退出均须验；隔离不成立就停问主人。涉及额度的真机任务单独按主人任务书授权，本任务不运行。依据：〔一手〕handoff 决策 57–60；两评估 §8；〔推理〕验收组合。

## 11 依据

- 〔一手〕底座 `dsh-base` `ad4e3c50`：`packages/core/agent/src/{index,runtime-types,types}.ts`；`core/agent-loop/src/{index,agent,runtime-context,constants}.ts`；`core/tools/src/contracts.ts`；`preset/*/README.zh.md`；`core/system-prompt/README.zh.md`；`llm/*/README.zh.md`；`bundle/{base,acp-app,headless,sdk-app,sdk-minimal}/cordis.patch.yml`；`acp/acp/{README.zh.md,src/index.ts,src/session.ts}`；`sdk/*/src`；`subagent/{subagent,tool-subagent,tool-subagent-control,subagent-spawn-in-process,subagent-fork-in-process,subagent-claude-code,subagent-codex,subagent-acp}`；`subprocess/*`；`session/session-persistence-jsonl/README.zh.md`；`jobs/jobs/README.zh.md`；`guard/*`；`apps/cli/src/*`；`util/official-bundles/src/bundles.ts`；`docs/agent-lifecycle.zh.md`；安装包 `@anthropic-ai/claude-agent-sdk@0.3.263/sdk.d.ts`、`@agentclientprotocol/sdk@1.4.0/dist/acp.d.ts:857,1482`。
- 〔一手〕`paseo@8018231a`：`LICENSE`、`package.json`、`CHANGELOG.md`、`packages/server/package.json`；`packages/server/src/server/agent/{agent-sdk-types,agent-manager,provider-registry,provider-launch-config,system-prompt,agent-response-loop,mcp-server,paseo-tool-policy}.ts`、`providers/claude/*`（含 `subagents/`、`runtime-safety.ts`）、`providers/codex-app-server-agent.ts`、`providers/codex/*`、`providers/{acp-agent,generic-acp-agent,provider-runner}.ts`、`tools/paseo-tools.ts`、`agent-messages/*`、`finish-subscriptions/index.ts`、`provider-subagents/store.ts`、`create-agent/intent.ts`、`idle-runtime-cleanup/index.ts`、`restart-recovery/index.ts`、`managed-processes/managed-processes.ts`、`utils/spawn.ts`、`paseo-env.ts`；各目录行数（附录 A）；`docs/{providers,agent-lifecycle,data-model}.md`；`public-docs/{mcp,orchestration,orchestration-workflows,skills,agent-profiles,codex}.md`。
- 〔二手〕`research/2026-10-28-subagent-notes/cli-claude-sdk-codex-app-server.md`（SDK `perTaskStopAffordance`、`stopTask`、`usage` 只算主循环；Codex `collabAgentToolCall` / `subAgentActivity`）、`cli-protocols-acp-a2a-mcp.md`（`_` 前缀自定义方法、`_meta`）、`research/2026-10-28-paseo-architecture.md`、`2026-11-01-dsh-superagent.md`、闲置包盘点 §5。
- 已确认与上位文档：`four-layers.md` §1–§5；`overall.md` §3.4、§5、§6.4、§9.2、§11、§12、§16.1、§17；`00-contracts.md` §2、§5.1、§6；`00-commands.md` §3；`02-minds.md`；决策 1、2、4、5、6、14、28、33、36、43。
- 〔推理〕标注处：`_liwa` 字段名与代码量估计；路 ② 用 `spawn` 不照搬 `create_agent`；Codex 中断式收尾；Codex 子线程的清理方式；验收阈值。

## 12 已定的点

| # | 点 | 定了什么 |
| --- | --- | --- |
| 1 | 自建默认 agent 的形态 | 第一版就是独立进程的 CLI，`liwa --profile deepseek`，和 Claude Code、Codex 同形 |
| 2 | 进程粒度 | **每个会话一个进程**（不是每成员一个） |
| 3 | 提供方名 | 自建默认 agent 叫 `deepseek`（包 `brain-deepseek`、bundle `deepseek-app`、profile `deepseek`）；`claude`、`codex` 不变；通用 ACP 叫 `acp` |
| 4 | ACP 扩展 | 三个 `_liwa/*` 方法（steer、usage、children）+ `_meta.liwa` 字段 |
| 5 | 子任务 | 走 Paseo 的方式：默认用提供方自己的子 agent 机制，需要时经 `spawn` 子活调别家 CLI；不开放 CLI 路 |
| 6 | Claude / Codex 的原生子 agent | 干活与查资料的活里放开；灵鲸只观察、记录、计入父活预算；不带她的人设 |
| 7 | 底座 `subagent` 系列 | 留 seam + 进程内 spawn / fork + 两个工具；Claude Code／Codex 外部委派替代后删，ACP／liwa-sdk 删除时点待定，OAR 去留按已定裁剪范围 |
| 8 | 外部 CLI 的配置 | 全局一律不读；每成员／impl 独立的灵鲸配置；外部 CLI 空壳子，Codex 另隔离 HOME |
| 9 | 被干活仓库的 `CLAUDE.md` / `AGENTS.md` | 干活与查资料由灵鲸受控读取内容后注入，CLI 不启项目来源；其余会话不注入 |
| 10 | Codex 二进制 | PATH 上的 `codex`；底座随包的 0.153.4 随 `subagent-codex` 删 |
| 11 | Paseo 代码的改法 | 原地改 + 每包 `NOTICE` 改动清单 |
| 12 | `brain-acp` | V1 做，迁时升到 SDK 1.4 |
| 13 | 内核工具到 CLI | V1 toolport HTTP MCP，三家一个端点 |
| 14 | 待实测项 | 先派一个探针任务跑完 §10 的十一项，结果决定 `Meta` 的真值 |

**待定点**（设计暂按本节其余条目）：① 想事·立场类的活要不要也放开子 agent（本稿只给干活与查资料的活）；② 原生子 agent 不带她的人设，是决策 5"执行者只能是她"的一个边界例外，建议记进 handoff 的决策表；③ 每会话一个 `deepseek` 进程给想事活带来的启动延迟，探针测出数字后再定要不要 V1.1 的预热。

## 13 以后

`liwa acp serve` 与 `deepseek-app` 合一；Codex 当实例会话；`dynamicTools`；主控台的子 agent 面板（Paseo `provider-subagents` 的只读时间线）；Claude 订阅额度窗口（条款核实在前，`four-layers.md` §10 第 15 条）；离线预审与自动切换名单；预热空闲 `deepseek` 进程；别家 ACP CLI（Gemini CLI、OpenCode）验证；Paseo 0.15 的"重启后自动续跑被打断的 agent"（CHANGELOG #8127）与 `overall.md` §12.1 对照；附录 A 里标 V1.1 / V2 的项。

## 14 其他文档的同步清单

以下列为相关模块的同步目标，本任务只更新 00 §5.1、01、图页与 handoff；涉及其他模块的设计安排须单独任务落实。依据：〔一手〕任务书 03 的范围；〔推理〕关联清单。

| 文档 | 同步目标 |
| --- | --- |
| overall §3.4／§9.2 | deepseek 每会话一个受管 CLI；Meta、SessionConfig、问答／模式／子归属以 00 §5.1 与实现为准；G1–G4 记为计划 |
| overall §5.2／§5.9、four-layers §3.1 | 原生子 agent 与跨 CLI 子活两条路；权限直达主人；Codex 原生沙箱／审批与软预算边界 |
| overall §15–17、architecture README、roadmap | 第 1、2 步完成，第 3 步设计中，第 4、5 步同等功能目标与真 CLI 验收矩阵 |
| four-layers、02-minds | 投递器按能力退化；deepseek next_turn 由回合边界调用 startTurn；后台子工作与 CLI 自开回合照实记录 |
| engineering、00-plugin-kernel | 包名 brain-claude-code；自写严格模块与 src/paseo 分开；配置写法唯一归属提供方 |
| 05-memory、06-growth | self／skills 给灵鲸注入内容；外部 CLI 空壳子、项目文档受控注入，灵鲸自己的配置机制按决策 56 后续设计 |

## 附录 A　Paseo 能力盘点与迁移地图（默认迁）

行数为 `wc -l` 非测试代码；"迁"= 原样拷贝 + 原地改；"迁规则"= 不拷代码、把行为写进对应模块文档；"不迁"要写理由。路径省略 `packages/server/src/server/`。

| 能力 | Paseo 位置（行） | 处置 | 落到 | 理由 / 改什么 |
| --- | --- | --- | --- | --- |
| 统一 agent 契约 | `agent/agent-sdk-types.ts`（830） | 迁 | `brain-shared/src/paseo/` | 映射在各 adapter |
| Claude 适配器 | `providers/claude/{agent,query,options,project-dir,transcript-history,tool-call-mapper,tool-call-detail-parser,partial-json,runtime-safety,hooks,subagent-handback,interrupt-placeholder}.ts`（≈ 8 600） | 迁 | `brain-claude-code` | §4.2 的改法 |
| Claude 原生子 agent 观测 | `providers/claude/{sidechain-tracker,task-state,task-notification-tool-call}.ts`、`subagents/`（≈ 1 110 + 目录） | 迁（V1） | `brain-claude-code` | §4.5 路①的观察 |
| Claude 模型目录、回滚、导入 | `providers/claude/{model-manifest,models,model-discovery,rewind,import-descriptor-scheduler}.ts`（≈ 1 030） | 不迁 | — | 不迁目录产品功能、回滚与导入；最小 models／manifest helper 保留方案待第 4 步确认（Claude 评估 §3.3） |
| Codex 适配器 | `providers/codex-app-server-agent.ts`、`codex-feature-definitions.ts`、`providers/codex/{app-server-transport,options,thread-history,tool-call-mapper,tool-call-detail-parser,async-questions}.ts`（≈ 10 000） | 迁 | `brain-codex` | §4.3 的改法（含协作子 agent 条目的翻译）；`codex/rewind.ts` 不迁 |
| ACP 适配器与厂商 shim | `providers/{acp-agent,generic-acp-agent,acp-options,jsonl-rpc-process}.ts`（≈ 5 060）、`{copilot,cursor,kimi,kiro,trae}-acp-agent.ts`（≈ 580） | 迁 + 升 SDK 1.4 | `brain-acp` | §4.4 |
| OpenCode 适配器 | `providers/opencode-agent.ts`、`opencode/`（≈ 5 540 +） | 不迁（V2 候选） | — | 要管 OpenCode 服务器 helper 与插件桥；灵鲸 V1 不用 OpenCode；真要接先走 `brain-acp` |
| Pi / OMP 适配器 | `providers/pi/`、`providers/omp/` | 不迁 | — | 灵鲸不装 pi / omp；OMP 的 `child_session` 导入思路归 §4.5 的观察 |
| 共享提供方工具 | `providers/{provider-runner,tool-call-detail-primitives,tool-call-mapper-utils,diagnostic-utils,question-card-answer,custom-message,resume-process-cwd,provider-image-output}.ts`、`agent/{provider-launch-config,provider-options,provider-notices,provider-refresh-deadline,provider-session-import,system-prompt,permission-response,provider-runtime}.ts`（≈ 2 900） | 迁 | `brain-shared` | `provider-launch-config` 的可执行解析改接 subprocess |
| 协议小文件 | `packages/protocol/src/{provider-config,agent-types,tool-name-normalization,agent-message,path-utils,tool-call-display}.ts`（≈ 990） | 迁 | `brain-shared/src/paseo/protocol/` | — |
| 提供方子 agent 存储 | `agent/provider-subagents/store.ts` | 迁（V1） | `brain-shared` | 三家原生子 agent 的描述符与只读时间线；主控台面板 V1.1 |
| 结构化生成循环 | `agent/agent-response-loop.ts`、`structured-generation-providers.ts`（789） | 迁 + 改造 | `brain/structured.ts` | AgentManager 换 `ctx.brains`；给整理活、查资料活用 |
| agent 互发消息与信封 | `agent/agent-messages/{envelope,delivery}.ts`（422） | 不迁 | — | 信封换 `liwa-block`（R5）；投递、合批、steer-or-queue 的规则 02 §4.2 已定且更严（不进正在跑的主人回合） |
| 完成订阅 | `agent/finish-subscriptions/`（381） | 迁规则 | tasks（07 之后）、02 | 至少一次、先记意图再承诺通知、权限是检查点不是终点：灵鲸用 `task:<id>` 事件 + 投递器实现，数据在经历流不在 JSON |
| 子 agent 工具与 MCP 服务器 | `agent/mcp-server.ts`（55）、`tools/paseo-tools.ts`（3 347）、`paseo-tool-policy.ts` | 迁规则 | toolport、tasks | 工具目录是灵鲸自己的（`overall.md` §5.2）；"按提供方过滤工具、原生优先 MCP 兜底"照搬进 toolport |
| 建 agent 的意图与幂等 | `agent/create-agent/{intent,create}.ts`、`creation/`（≈ 500） | 迁规则 | tasks、actions | 父标签、幂等键、`outcome unknown` 不重复 |
| 闲置回收、重启恢复 | `agent/idle-runtime-cleanup/`（167）、`restart-recovery/`（81） | 迁规则 | 02 §4.1、03 | 1 小时、`canStopRuntime` 否决、启动把 running 修 closed；0.15 的自动续跑对照 `overall.md` §12.1 |
| AgentManager、提供方注册表、agent 存储 | `agent/agent-manager.ts`（5 794）、`provider-registry.ts`（1 021）、`agent-storage.ts`、`agent-archive.ts` | 不迁 | — | 巨型对象 + JSON 文件 + 以 CLI 转录为真相（决策 3、`overall.md` §6.1）；职责已拆到 minds / brains / tasks / journal |
| 时间线三件 | `agent/{timeline-projection,agent-timeline-store,agent-timeline-content}.ts` 与 `agent-timeline-store-types.ts` | 已迁 | `brain-shared/src/paseo/agent/` | 提供方子 agent 存储与适配器共用；网关（07）直接引用这一份〔一手：dev 分支 `packages/brain/brain-shared/NOTICE`、`packages/brain/brain-shared/src/paseo/agent/provider-subagents/store.ts`〕 |
| 时间线合流与摘要 | `agent/{agent-stream-coalescer,activity-curator}.ts` | 迁 | gateway（07） | 主控台时间线与“她的一天”摘要，等网关接入 |
| JSONL 帧解码 | `agent/providers/jsonl-frame-decoder.ts` | 已迁 | `brain-shared/src/paseo/agent/providers/` | ACP 与 Codex 传输共用〔一手：dev 分支 `packages/brain/brain-shared/NOTICE`、`packages/brain/brain-shared/src/paseo/agent/providers/jsonl-frame-decoder.ts`〕 |
| 运行时 MCP 配置注入 | `agent/runtime-mcp-config.ts` | 迁 | `brain-shared` | 给 CLI 写 toolport 端点 |
| 会话导入、历史搜索 | `agent/import-sessions.ts`、`chat-search/`、`agent-history-search.ts` | 不迁 | — | 记忆召回归 memory；导入外部会话不是灵鲸功能 |
| 语音 | `speech/`（6 083）、`dictation/`（816）、`stt-manager` / `tts-manager` | 迁（V1.1） | `ability-speech-local`（09） | 决策 1 已定，带 SenseVoice 与 Whisper |
| 调度 | `schedule/{cron,service,store}.ts`（1 526） | 迁 `cron.ts`；其余迁规则 | `job-trigger-time`、scheduler（04） | 解析与 `computeNextRunAt` 照搬；service / store 改 SQLite，补补跑与 60 分钟看门狗 |
| 工作树与工作区 | `worktree/commands.ts`、`paseo-worktree-service.ts`、`plugins/worktree-include/`、`projects` / `workspace-labels/`（≈ 1 200） | 迁 worktree 命令与 `.worktreeinclude` 复制；注册表不迁 | workspace（03） | 工作区登记归 workspace 的 SQLite |
| 签出与 diff | `checkout/`、`checkout-diff-{manager,cache}.ts`、`checkout-git-utils.ts`（≈ 700） | 迁（V1.1） | workspace、console（08） | 对话编程的"看 diff" |
| 文件观察、文件浏览、上传下载、目录同步 | `file-observer/`、`file-explorer/`、`file-upload/`、`file-download/`、`directory-sync/`（≈ 3 300） | 迁 `file-observer`（V1.1）；其余不迁 | workspace | 观察改动给"改了哪个文件"；浏览与上传是界面功能，08 再看 |
| 进程登记 | `managed-processes/`（469）、`utils/{spawn,tree-kill}.ts`、`paseo-env.ts`、`plugin/src/server/process.ts` | 不迁 | — | 底座 `@liwa/subprocess` 更全（环境剥离、进程组、检查器）；"登记后对账、只杀对得上的"规则进 03 |
| 终端 | `src/terminal/`（9 197） | 不迁（V1.1 借） | — | 底座 `tool-terminal` / `terminal-bundle` 已有 PTY；Paseo 的"重启后终端不断"以后借 |
| 浏览器工具 | `browser-tools/`（1 658） | 不迁 | — | 底座 `browser-use` 已有 |
| forge（GitHub / GitLab / Gitea）、合并后自动归档 | `src/services/`（9 380）、`auto-archive-on-merge/`、`webhook` | 迁（V1.1，订阅直通时） | tasks、senses | 底座也有 `webhook-github` / `forge-github`，到时二选一 |
| 任务清单 | `src/tasks/`（747） | 不迁 | — | 灵鲸的 tasks 有自己的状态机与核验 |
| 编排技能 | `orchestration-skills/`（1 440）、`skills/*` | 迁规则 | skills（06） | "技能目录安装与更新"的做法给本事导出用；Paseo 技能本身是它的用法 |
| agent 档案 | `agent-profile` | 迁规则 | roster | 就是 roster 的"按会话种类配提供方 + 选择说明" |
| 额度来源插件 | `plugins/{claude,codex}-usage-source`；其余 7 家 | Claude V1.1 再评估，Codex 直接用受管连接通知 | `brain-claude-code` / `brain-codex` | 不迁扫描全局 auth 的 Codex usage-source；账号窗口不等于会话消费〔一手〕Codex 评估 §2／§4 |
| 插件平台、Hub、连接主机、中继、推送、配对、WebSocket 会话 | `plugins/`（7 137）、`hub/`、`connected-hosts/`、`relay`、`push/`、`pairing-*`、`session/`（9 529）、`websocket/`、`authorization/`、`auth.ts` | 不迁 | — | 插件机制是底座的 cordis；单机单主人（决策 3）；前后端协议是 gateway 自己的（07） |
| 守护进程壳 | `daemon-worker.ts`、`supervisor`、`pid-lock.ts`、`bootstrap.ts`、配置存储 | 不迁（借自检） | 本体入口 | launchd 守护；`overall.md` §12.1 |
| 客户端与 CLI | `packages/{cli,client,app,desktop,website,expo-two-way-audio,highlight}` | 不迁（CLI 借形状） | `00-commands.md` 已定 | — |
| 第三方提供方插件 | `plugins/{antigravity,hoplite,muse}-provider` | 不迁 | — | 灵鲸不用这些产品 |
