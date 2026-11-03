# 01 agent CLI 接入（brains、`brain.provider`）：第四层的契约、三个 CLI 提供方、子 agent 与 Paseo 迁移

状态：**已确认**（2026-11-02，主人确认：自建默认 agent 第一版就是独立进程的 CLI、每会话一个进程、提供方叫 `deepseek`；子任务走 Paseo 的方式；外部 CLI 只读灵鲸管理的配置、被干活仓库的 `CLAUDE.md` / `AGENTS.md` 在干活与查资料时读且灵鲸规矩优先；原生子 agent 在干活的活里放开、只观察；其余按 §12）。上位设计：`four-layers.md` §1、§4、`overall.md` §3.4、§9.2、`00-contracts.md` §5.1。配套流程图页 `01-agent-cli.html`（源 `01-agent-cli.src.html`，用 `docs/liwa/scenarios/build.py` 生成）。依据标记：〔一手〕读过源码或原文（底座指 `dsh-base` 分支，公共层实现指 `dev` 分支 `fbb36685`，路径均相对仓库根；Paseo 写成 `paseo@8018231a:<路径>`，即 `getpaseo/paseo` 0.15.0-beta.1，2026-11-02，Apache-2.0）；〔二手〕转述调研报告；〔推理〕自己的判断。

## 0 一页结论

- **第四层 = seam 包 `@liwa/brain`（契约 + `ctx.brains` 服务）+ 每个 CLI 一个提供方插件**（决策 33），形状照底座 `@liwa/llm` ↔ `llm-deepseek`、`@liwa/subprocess` ↔ `subprocess-local`〔一手，两包 README〕。**三个提供方在形态上完全一致：每个会话一个独立进程的 CLI**，本体里只有客户端。
- **自建默认 agent = 提供方 `deepseek`（包 `brain-deepseek`），进程是 `liwa --profile deepseek`**：底座 `apps/cli` 启动器 + 新 bundle `@liwa/deepseek-app`（`@liwa/base` + 底座现成的 ACP 服务器 `@liwa/acp` + 灵鲸扩展 + 五个预设）。对外说 **ACP v1 + 三个 `_liwa/*` 扩展方法 + `_meta.liwa.*` 字段**（ACP 允许 `_` 前缀自定义方法与 `_meta` 扩展〔二手〕；SDK 1.4 两端都有 `extMethod`〔一手〕）。**每个会话一个进程**，一条 ACP 连接上只有这一个会话；人设十段作为该进程的 `personaPrefix` 注入一次，进程里的子会话自动继承。本体侧的 `brain-deepseek` 是 `brain-acp` 通用客户端加 `_liwa` 扩展的薄层；steer 由 `_liwa/steer` → 底座 `agent.steer` 补上（§4.1）。
- **`brain-claude`、`brain-codex` 从 Paseo 迁**（Claude Agent SDK 钉底座已装的 0.3.263；Codex app-server 用 PATH 上的 `codex`）；**`brain-acp` V1 也做**：迁的同时把 SDK 从 0.17 升到底座的 1.4，它是 `brain-deepseek` 的底子。
- **子 agent 两条路**（§4.5）：① **提供方自己的子 agent**，只在干活与查资料的活里放开——`deepseek` 用底座 `subagent` seam（`subagent` / `send_message` / `interrupt_agent` / `list_agents` 四个工具，spawn / fork 进程内后端，自动继承人设），Claude 的 `Agent` 工具、Codex 的协作 agent 照 CLI 自己的方式开；灵鲸不干预，只观察、记录、计入父活的预算（`brain_child`、`brain.child.*` 事件、用量归父活）；② **跨 CLI 子活**：经内核工具 `spawn(执行者, 交接包)` 开第三层子活，由 `tasks` → `minds` → `brains` 在指定提供方上开会话，回报走活的事件——这是 Paseo `create_agent` + `notifyOnFinish` 的形状，把"agent 自管 agent"换成"活管子活"。不开放 Paseo 的 CLI 路（活的 shell 里直接起别的 agent），它绕开令牌与权限链。
- **外部 CLI 的配置隔离**（§4.6）：每个成员一份由 brains 生成、CLI 只读的配置目录（`CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `LIWA_HOME` 都指进去），里面是灵鲸的规矩、本事（skills）、MCP（只有 toolport 端点）、设置；主人的 `~/.claude`、`~/.codex`、`~/.liwa` 一律不读。被干活仓库自带的 `CLAUDE.md` / `AGENTS.md` 只在干活与查资料的活里读，灵鲸规矩优先。
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
| 预设 `agent-preset` / `-registry` / `persona`；`core/system-prompt`；`runtime-context.ts` | `deepseek-app` 里每种会话一个预设；人设十段进该进程的 `personaPrefix`，会话说明进 agent 作用域段 | **改造**：新增 `deepseek-instance` / `-work` / `-think` / `-own` / `-tidy` 预设，实例预设不装 `compaction-basic` | 〔一手〕`preset/persona/README.zh.md`；`core/system-prompt/README.zh.md`（agent 作用域贡献遮蔽全局；`complete` 段）；`runtime-context.ts:157` |
| `core/tools` 的 `concludesTurn` | `concludeOn` 的落点（§4.1） | **留着** | 〔一手〕`core/tools/src/contracts.ts:331` |
| llm 路由 `@liwa/llm`、`llm-deepseek(-api-key)`、`llm-pi-ai`、`llm-retry`、`token-meter`、`agent-default-model` | `deepseek` 进程的模型来源；路由由 brains 生成的会话 patch 给 | **留着** | 〔一手〕`bundle/base/cordis.patch.yml` |
| `@liwa/subprocess` + `subprocess-local` | 就是 `overall.md` 的 procs；三个 CLI 都经它拉起 | **留着**；03 补"先登记再拉起、孤儿清理" | 〔一手〕`subprocess/src/types.ts:77,169`；README（环境剥凭据与 `LIWA_*`） |
| `session-persistence(-jsonl)`（`$LIWA_HOME/sessions/<id>/`，无删除接口） | `deepseek` 进程的转录（它的 `LIWA_HOME` 在该会话的目录下） | **留着**；底座改造项：补 `delete(sessionId)` | 〔一手〕`session-persistence-jsonl/README.zh.md` |
| `subagent` seam + `subagent-spawn-in-process` / `-fork-in-process` + `tool-subagent` + `tool-subagent-control` | `deepseek` 上干活的活的子 agent 机制（§4.5 路①） | **留着**，进 `deepseek-work` 预设 | 〔一手〕`subagent/src/types.ts:313`；两个工具包 README |
| `subagent-claude-code` / `-codex` / `-acp` / `-liwa-sdk`（一次性委派） | 被 `brain-claude` / `brain-codex` / `brain-acp` 取代；`subagent-claude-code/src/process.ts` 的 `claudeSpawnSpec` 与 `subagent-acp/src/run.ts` 的 SDK 1.4 调用方式**搬进对应提供方** | **换掉**后删（已定） | 〔一手〕`subagent-claude-code/src/run.ts:330,370`；`subagent-acp/src/run.ts:440-520` |
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
| `brain_session` | sessionId、impl、member、mindKind、owner{instanceId或taskId, gen}、model?、configDir、homeDir、state、openedAt、resumedFrom?、adjustments、closedAt?、closeReason? | 一代会话一行；model 省略语义按主人决定于第 2 步落实 |
| `brain_child` | childId、sessionId、kind（`native-child` / `cross-cli-task`）、provider、label、parentChildId?、state、stopReason?、usage?、openedAt、endedAt? | 当前只登记提供方自己的子 agent；跨 CLI 子活等 tasks；关闭时未结束的补记 `aborted` |
| `brain_usage` | sessionId、impl、member、owner、turnId?、childId?、source（`turn` / `update` / `child`）、usage、at | 经 `onUsage` 与事件推出；子 agent 用量按 owner 归父活，guard 等第二层接入 |

Cordis 事件固定使用点号与版本名：`brain.session.opened.v1`、`brain.session.closed.v1`（关闭的会话与用量汇总）、`brain.process.spawned.v1`、`brain.process.exited.v1`、`brain.child.opened.v1`、`brain.child.ended.v1`、`brain.usage.v1`、`brain.provider.unavailable.v1`；不套底座的 `域/名` 命名。经历流接入后订阅这些事件写 `instance:<id>` / `task:<id>`，提供方不可用写 system 流，回合与工具事件由 minds 记（02 §2.2）。依据：〔一手〕dev 分支 `packages/brain/brain/src/index.ts`、`packages/brain/brain/src/views.ts`；〔一手〕主人同意第 1 步事件落法（handoff 决策 53）。

## 3 接口

### 3.1 `brain.provider` 契约（在 `00-contracts.md` §5.1 之上补齐）

```ts
Meta += {
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
  projectDocs: z.boolean(),                                         // 读不读被干活仓库的 CLAUDE.md / AGENTS.md：干活与查资料 true，其余 false（§4.6）
  childPolicy: z.object({ native: z.boolean(), maxDepth: z.number().int(), maxConcurrent: z.number().int(), crossCli: z.array(ImplId) }),   // §4.5：native 只在干活与查资料的活为 true
  resume: z.object({ identityProbe: z.boolean() }).optional(),
};
BrainEvent += { kind: 'session.compacted', turnId?, preTokens?, postTokens? } | { kind: 'process.exited', pid?, code, signal }
           | { kind: 'child.started', childId, childKind: 'native-child', label, provider, parentChildId? } | { kind: 'child.ended', childId, stopReason, usage: Usage };
```

`Meta.nativeTools` 表示“带着关不掉的原生工具”；`permission.resolved{turnId?, requestId, optionId, effect}` 说明提供方已应用答复；`turn.interrupted.reason`、`turn.failed.code/diagnostic`、`usage.update.turnId` 可选；消息、推理、工具条目及权限请求可带 `childId`。`process.exited.pid` 可选且由 brains 发出，提供方不发；子 agent 的种类字段为 `childKind`，避免与事件判别字段 `kind` 冲突。`ResumeHandle` 另带可选的 `nativeHandle`、`metadata`。依据：〔一手〕dev 分支 `packages/brain/brain/src/contract.ts`、`packages/brain/brain/src/session.ts`。

提供方接口使用 `BrainProvider { impl, meta, probe(ctx), createSession(cfg, launch), resumeSession(handle, cfg, launch) }`；续接给完整的新代配置。`BrainProviderSession` 使用 `subscribe`、`startTurn`、`deliver`、`cancel`、`respondToPermission`、同步 `persistence()`、可选 `canStopRuntime()` / `setModel()`、`close()`；不用 `CallContext` 首参、`ClientOf` 描述符或创建即缓冲的单消费者流。`BrainLaunchContext` 给会话号、home 目录、日志器与进程解析 / 拉起入口。依据：〔一手〕dev 分支 `packages/brain/brain/src/provider.ts`；完整字段见 00 §5.1。

| 项 | 规则 | 依据 |
| --- | --- | --- |
| `kernelTools` | toolport 开一个带会话令牌的 Streamable HTTP MCP 端点；Claude 经 SDK `mcpServers`、Codex 经 `config.mcp_servers`、deepseek 经 ACP 标准的 `session/new.mcpServers`（HTTP 型）连它；三条路最后都是 `toolport.invoke(token, tool, args)` | Paseo 的工具目录与传输无关、MCP 只是适配器〔一手，`paseo@8018231a:docs/providers.md`〕；底座 ACP 服务器支持 HTTP MCP〔一手，README〕 |
| `deliver(next_step)` | deepseek：`_liwa/steer`；Claude：SDK 流式输入 `priority: 'next'`；Codex：`turn/steer{expectedTurnId}`；别家 ACP CLI 恒 `unsupported` | 〔一手〕`…/providers/claude/agent.ts:2607-2640`、`codex-app-server-agent.ts:4473-4510`；ACP 无 `steerActiveTurn`（grep 为 0） |
| `cancel` 后的队列 | 先撤回提供方没读走的 `next_step` 输入再中断，否则刚停的回合会被它重新拉起 | 〔一手〕`docs/providers.md`"A steering adapter also owes its interrupt" |
| 两回合之间退出 | 必报 `session.exited`；每会话一个进程，退出只影响这一个会话 | 〔一手〕`docs/agent-lifecycle.md`"Report that exit as a turn failure" |
| 用量 | `turn.completed.usage` 必填；deepseek 的用量来自 `_meta.liwa.usage`（§4.1）；子 agent 的消耗算在父会话的回合里（§4.5）；SDK 估价只记不算 | §5.1 已定 |
| 子 agent | 提供方必须把自己的子 agent 翻成 `child.started` / `child.ended`（能拿到的字段都填，拿不到的留空，不许编），并在 `cancel` / `close` 时一并停掉 | §4.5 |

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

当前 `prepareConfigDir` 已生成 Claude 的 `CLAUDE.md`、只含模型的 `settings.json`、skills 与 projects 目录；Codex 的 `AGENTS.md`、含模型 / `project_doc_max_bytes` / MCP 的 `config.toml`、skills 与 sessions 目录；deepseek 在开会话时创建独立的 `deepseek/<sessionId>/` home。权限、禁用工具、模型提供方与沙箱等细节等各提供方接入时补。规矩文件开头为“本交接优先于通用指令。”依据：〔一手〕dev 分支 `packages/brain/brain/src/config-dir/{index,shared,claude,codex}.ts`；模型可省后不写占位值，按决策 53 在第 ② 步落实。

## 4 核心机制

### 4.1 自建默认 agent：提供方 `deepseek`，进程 `liwa --profile deepseek`

| 项 | 做法 | 依据 |
| --- | --- | --- |
| 形态 | 新 bundle `packages/bundle/deepseek-app`，`PROFILE_TEMPLATES.deepseek = ['@liwa/base', '@liwa/deepseek-app']`；`deepseek-app` = `@liwa/acp`（ACP v1 服务器）+ 五个预设 + `_liwa` 扩展处理器 + 人设行。名字跟提供方走（主人定提供方叫 `deepseek`），和模型适配器 `llm-deepseek` 是两层东西：前者是整个 agent 进程，后者是它里面的一条模型路由 | 〔一手〕`util/official-bundles/src/bundles.ts`；`bundle/acp-app/cordis.patch.yml` 就是"base + acp"两行 |
| 进程 | **每个会话一个**（主人定）：`createSession` → `ctx.subprocess.spawn(['liwa', '--profile', 'deepseek', '--patch', <会话 patch>])`，`LIWA_HOME = <成员配置目录>/deepseek/<sessionId>/`（该会话的转录、profile、patch 都在里面；续接时用同一目录重拉进程，所以 `LIWA_HOME` 不在进程之间共用）；stdio 归 ACP；握手 `initialize` 30 秒；会话关闭或闲置回收 → 进程一起关 | 〔一手〕`apps/cli/src/profile-boot.ts`（profile = bundle 层 + `cordis.patch.yml` + `--patch`）；`acp-app` 注释"Stdout belongs to ACP" |
| 会话 patch | brains 从 roster 与 self 生成：llm 路由（`llm-deepseek-api-key` / `llm-pi-ai` 的 providers 与 `apiKeyEnv`，密钥名经环境传入、值从钥匙串读）、`system-prompt.personaPrefix = 人设十段`、`includeLiwaIdentity: false`、`agent-default-model` 兜底、该会话种类的预设 | 〔一手〕`core/system-prompt/README.zh.md`（`personaPrefix` 顺序 0；`includeLiwaIdentity`） |
| 会话 | ACP `session/new{ cwd, mcpServers: [toolport HTTP 端点 + 令牌], _meta.liwa{ mindKind, owner, notes, version, limits, concludeOn, model, childPolicy } }` → 服务端 `AcpSession.create` 的 `setup` 里：选预设 `deepseek-<mindKind>`、注册 agent 作用域段（会话说明）、挂 `agent/pre-step` 预算监听、包工具结果（`concludeOn` 命中 → `concludesTurn: true`）、`model` 给定时才调 `agent.model.select(model)`、按 `childPolicy` 装或不装 `subagent` 工具 | 〔一手〕`packages/acp/acp/src/session.ts:119-124`（`ctx.agents.create({ meta:{cwd}, agentOptions, setup })`）；`core/agent/src/index.ts:66`（`setup` 在 `agent/created` 与首次组装之前生效）；`runtime-types.ts` `PreStepDecision` |
| 回合 | `startTurn` / `deliver(next_turn)` → `session/prompt`（一会话一次一个提示词，阻塞到回合结束，正合 minds 的回合边界）；返回里 `_meta.liwa.usage`；流式经 `session/update`；每轮前缀块 `<liwa-block name="前缀">` 放提示词最前 | 〔一手〕README"每个会话一次一个提示词""上下文用量" |
| steer | `_liwa/steer{ sessionId, prompt }` → `agent.steer(message)`；服务端只在该会话有进行中的提示词时接受，否则回 `unavailable`（本体退化为下一回合） | 〔一手〕`runtime-types.ts` `steer`"a running driver consumes it at its next step boundary"；SDK 1.4 `extMethod` |
| 取消 | 标准 `session/cancel`（→ `agent.cancel({ kind: 'user' })`）；`_meta.liwa.keepQueue` 为 true 时服务端改调 `agent.cancel(cause, { keepInbox: true })`；取消连带子会话（`subagent` seam 的 `dispose`） | 〔一手〕`packages/acp/acp/src/session.ts:309-312`；`runtime-types.ts` `CancelOptions` |
| 权限 | 标准 `session/request_permission`（子会话的请求也经同一会话上报，`_meta.liwa.childId` 标明来源） | 〔一手〕README |
| 续接 | 回收 = 关进程保留目录；续接 = 同一目录重拉进程 + `session/resume{ sessionId, cwd, mcpServers }`（底座支持，`session/load` 不支持）；`ResumeHandle.sessionRef = sessionId`；续接后本体发身份探针 | 〔一手〕README；`src/index.ts:252-290` |
| 换模型 | 标准 `session/set_config_option(model)` | 〔一手〕README |
| 用量 | 服务端从 `session/event` 的 `assistant/message`（嵌入流含 usage 分片）与 `ctx.tokenMeter` 汇总，含子会话；经 `session/update._meta.liwa.usage` 与 `session/prompt` 返回里的 `_meta.liwa.usage` 上报 | 〔一手〕`docs/agent-lifecycle.zh.md`；`token-meter/README.zh.md` |
| 关闭 | `session/close`（停稳、释放后代）→ 进程退出；超时就 `terminate()` 整个进程组 | 〔一手〕README"`session/close` … 后代释放" |
| 客户端 | `brain-deepseek` 插件 = `brain-acp` 的 `GenericACPAgentClient` 子类（命令固定为 `liwa --profile deepseek`）+ `_liwa` 三个方法 + `Meta{ delivery.nextStep: true, children.native: 'observe', extensions }` | Paseo 的 shim 模式〔一手，`generic-acp-agent.ts`、`docs/providers.md`"ACP -- recommended"〕 |

**三个扩展方法与 `_meta.liwa` 字段**（服务端 `deepseek-app`，客户端 `brain-deepseek`，都是我们的代码）：

| 名字 | 方向 | 内容 | 代价 |
| --- | --- | --- | --- |
| `_liwa/steer` | 客户端 → 服务端 | `{ sessionId, prompt: ContentBlock[] }` → `accepted | unavailable` | 服务端约 40 行（校验在途提示词 + `agent.steer`）；客户端走 `extMethod` |
| `_liwa/usage` | 客户端 → 服务端 | 查该会话累计用量（续接后对账用） | 约 30 行 |
| `_liwa/children` | 客户端 → 服务端 | 列该会话的子会话（id、label、状态、用量） | 约 40 行；数据从 `ctx.subagents` 取 |
| `_meta.liwa` 于 `session/new` | 客户端 → 服务端 | `mindKind、owner、notes、version、limits、concludeOn、model、keepQueue、childPolicy` | 服务端 `setup` 约 150 行；是本稿最大的一块新代码 |
| `_meta.liwa` 于 `session/update`、`session/prompt` 返回、`session/request_permission` | 服务端 → 客户端 | `usage`、`childId`、`inferences`、`child.started / ended` | 约 80 行 |

别的 ACP 客户端（编辑器）连 `liwa --profile deepseek` 时看不到这些扩展，照常能用：决策 2 的"对外再开 ACP 服务端口"顺手完成。

**每会话一个进程的后果**（主人定；和 Claude、Codex 完全同形）：一个会话把进程搞挂只影响它自己；人设十段每个进程注入一次，同成员各会话之间没有进程内的共享，前缀缓存按模型服务商的缓存规则各自命中；每个活会话多一次底座启动（base bundle 约 30 个插件，启动时间与内存待实测 #21、⑧）——实例会话常驻可摊薄，想事活每次新开要算进 `ponder` 的延迟（`overall.md` §17 第 23 项）；V1.1 可按需预热一个空闲进程（§13）。

### 4.2 `brain-claude`（Claude Code，经 Claude Agent SDK）

| 项 | 做法 | 依据 |
| --- | --- | --- |
| 来源 | Paseo `providers/claude/*` 照搬（附录 A），核心类 `ClaudeAgentClient` / `ClaudeAgentSession`；子 agent 观测（`subagents/`、`sidechain-tracker`、`task-state`、`task-notification-tool-call`、`runtime-safety`）一起迁 | 〔一手〕`paseo@8018231a:…/providers/claude/agent.ts:1598,2282`（7 102 行）；`providers/claude/subagents/` |
| SDK | 钉底座已装的 0.3.263（Paseo 钉 0.3.246）；`maxTurns`、`persistSession`、`settingSources`、`spawnClaudeCodeProcess`、`systemPrompt.snapshot`、`PostToolBatch`、`skills`、`plugins`、`claudeMdExcludes` 都在 | 〔一手〕安装包 `sdk.d.ts:75,1680,1874,2085,2108,2240,2278,8145` |
| 进程 | 保留 `query.ts` 的 `spawnClaudeCodeProcess` 封装，内部换成 `ctx.subprocess.spawn(claudeSpawnSpec(options))`（从 `subagent-claude-code/src/process.ts` 搬）；SDK 每次 `query` 拉一个 `claude`，续接再拉 | 〔一手〕`providers/claude/query.ts`；`subagent-claude-code/src/process.ts` |
| 配置隔离 | `env.CLAUDE_CONFIG_DIR = <成员配置目录>/claude`；`settingSources: ['user']`——"user"层就是灵鲸生成的那份；干活与查资料的活加 `'project'`（读仓库 `CLAUDE.md`）并用 `claudeMdExcludes` 排掉 `.claude/rules/**` 之类的钩子与命令文件；Paseo 原值 `['user','project','local']` 必须改；`mcpServers` 只给 toolport 端点；`hooks` 只有我们的 | 〔一手〕`agent.ts:157-161`；`project-dir.ts:120-126`（`CLAUDE_CONFIG_DIR ?? ~/.claude`）；`sdk.d.ts:2080-2086`（省略 = 全部加载，`[]` = 隔离，`project` 才读 CLAUDE.md）、`:8145`（`claudeMdExcludes`） |
| 人设 | 实例 / 想事 / 自己的事 / 整理：`systemPrompt: { type: 'custom', prompt: stable + notes }`（`snapshot` 默认 true，换代即新会话）；干活：`{ type: 'preset', preset: 'claude_code', append }`，append 开头写"本交接优先于通用指令" | 决策 33；〔二手〕`snapshot` 语义 |
| 原生工具与权限 | `permissionMode` 显式给；不设 `allowDangerouslySkipPermissions`；实例类会话 `tools: []`；`canUseTool` → `permission.request{options}`，子 agent 的工具调用同样经它（带 `agent_id` / `parent_tool_use_id` 时填 `childId`） | 〔一手〕Paseo `agent.ts:3697-3699,5207-5250` |
| 原生子 agent | 干活与查资料的活：**不禁用 `Agent` 工具**（主人定：放开，只观察）；其余种类 `tools: []` 本来就没有。观察：SDK 流上的 `task_started / task_updated / task_progress / task_notification` 与带 `parent_tool_use_id` 的帧，经 Paseo 的 `subagents/live-source.ts` + `observation.ts` 翻成 `child.started{ childId: task_id, label, parentChildId }` / `child.ended{ stopReason }`，只认声明过的任务（没有 `task_started` 的不造描述符）；计费：子 agent 跑在同一个 `claude` 进程、同一个回合里，`result.modelUsage` 的总量记在父活的回合上（主循环的 `usage` 只算主线程；子 agent 的分项用量只在 `task_notification` 里尽力填 `child.ended.usage`，口径待实测 ⑩）；清理：`cancel(pause | drain | owner)` 先对活着的子 agent 逐个 `stopTask`，再 `interrupt()`；`cancel(preempt | watchdog)` 只停主回合、让后台子 agent 跑完（SDK 的 `perTaskStopAffordance`）；`close` 杀进程组；`canStopRuntime` 看子 agent 名单（CLI ≥ 2.1.292 才可信，本机 2.1.303）。它们不带她的人设：子 agent 是父活的执行细节，不对外说话、不写账本、不进第三层，产出只经父活回到她 | 〔一手〕`docs/agent-lifecycle.md`"Claude provider subagents: the task protocol"、`runtime-safety.ts`；〔二手〕`perTaskStopAffordance`、`stopTask`、`usage` 只算主循环 |
| 送达 | `next_turn`：往流式输入 `push` 一条 `SDKUserMessage`；`next_step`：同一条 `priority: 'next'` | 〔一手〕`agent.ts:2607-2640` |
| 取消 | 先撤回未开始的排队消息，再 `query.interrupt()`（只在主回合在途时）；`cancelKeepsQueue: false` | 〔一手〕`docs/providers.md`；`agent.ts:2672` |
| 预算与收尾 | `maxTurns = limits.maxInferencesPerTurn`；`PostToolBatch` 钩子在批里命中 `concludeOn` 且成功时返回 `{ continue: false }`（待实测 #35） | 〔一手〕`sdk.d.ts:75`；〔二手〕 |
| 压缩 | 实例会话必须关自动压缩：开关待实测（#36）；关不掉则 `Meta.compaction: 'always_on'`，Claude 只跑活 | `overall.md` §3.4 |
| 用量 | 每回合 `result.usage` / `modelUsage` 的 token 进 `Usage.tokens`，`context_usage` 进 `Usage.context`；`total_cost_usd` 只进 `providerReportedCostUsd` | 〔二手〕 |
| 续接 | `ResumeHandle.sessionRef = claude session id`；`resume:` | 〔一手〕`agent.ts:2975-3000` |

### 4.3 `brain-codex`（Codex app-server）

| 项 | 做法 | 依据 |
| --- | --- | --- |
| 来源 | Paseo `codex-app-server-agent.ts` + `codex/*` 照搬 | 〔一手〕7 881 + 2 300 行 |
| 二进制 | PATH 上的 `codex`（本机 0.163.0；`minVersion` 定在实测通过的版本）；底座 `subagent-codex` 随包的 `@openai/codex` 0.153.4 随它删（已定） | 〔一手〕`subagent-codex/package.json:51` |
| 进程 | `ctx.subprocess.spawn(['codex', 'app-server'])`，**不** `detached`（Paseo 是 detached 且不登记）；每会话一个 | 〔一手〕`codex-app-server-agent.ts:7468-7490` |
| 配置隔离 | `env.CODEX_HOME = <成员配置目录>/codex`（Paseo 读 `env.CODEX_HOME ?? ~/.codex`）：灵鲸写 `config.toml`（模型提供方、`mcp_servers` 只有 toolport、沙箱默认、`project_doc_max_bytes`：干活与查资料按默认读仓库 `AGENTS.md`，其余会话设 0）、`AGENTS.md`（规矩，开头写"本交接优先于通用指令"）、`skills/` | 〔一手〕`:648`；〔二手〕`project_doc_max_bytes`，待实测 ⑤ |
| 人设 | `thread/start` 与 `thread/resume` 都带 `developerInstructions = stable + notes` | 〔一手〕`:5550-5565,4102-4132` |
| 原生工具与沙箱 | 干活：`sandbox: 'workspace-write'` + `approvalPolicy: 'on-request'`；实例类会话 Codex **收不干净原生工具**（`read-only` 仍能读文件、跑只读命令），所以 **V1 Codex 只给干活与查资料的活** | 〔一手〕`MODE_PRESETS` `:320-343` |
| 原生子 agent | 干活与查资料的活放开（主人定）。观察：`collabAgentToolCall` 条目（`spawnAgent / sendInput / wait / closeAgent …`，带 `receiverThreadIds` 与 `agentsStates`）与 `subAgentActivity` 条目（`started / interacted / interrupted / completed`，带 `agentThreadId`）翻成 `child.started{ childId: agentThreadId }` / `child.ended`；计费：子线程的 `thread/tokenUsage/updated{threadId}` 带 `child_id` 记进 `brain_usage`、归父活（子线程的用量通知是否经同一连接到达待实测 ⑪，到不了就只记父线程）；清理：`turn/interrupt` 父线程后，对仍在跑的子线程逐个 `turn/interrupt`，`close` 杀进程组 | 〔二手〕`cli-claude-sdk-codex-app-server.md` Multi-agent 一节 |
| 权限 | `item/commandExecution/requestApproval`、`item/fileChange/requestApproval` → `permission.request{ accept / acceptForSession / decline / cancel }`；子线程的请求同样上报、带 `childId` | 〔一手〕`:3973-3976` |
| 送达 / 取消 | `turn/start`；`turn/steer{ threadId, expectedTurnId }`；`turn/interrupt`（Codex 自清未读输入） | 〔一手〕`:4457,4503,5062` |
| 预算与收尾 | brains 数 `item/started(agentMessage|reasoning)` 作推理次数，超限 `turn/interrupt`；`concludeOn` 工具返回后 `turn/interrupt`，记成 `turn.completed{concludedBy}`（待实测 #40） | 〔推理〕 |
| 用量 / 续接 / 一次性 | `thread/tokenUsage/updated`、`account/rateLimits/updated`；`thread/resume`；整理、查资料用 `ephemeral: true`（`persistSession: false` 是空操作） | 〔一手〕`:2745,4957,5563,7503`；`subagent-codex/src/wire.ts:292` |

### 4.4 `brain-acp`（通用 ACP：别家 CLI，也是 `brain-deepseek` 的底子）

Paseo 的 `ACPAgentClient` / `ACPAgentSession`（4 208 行）+ `GenericACPAgentClient`（命令、环境可配）+ 五个厂商 shim 照搬，**迁的同时把 SDK 从 `^0.17.1` 升到底座的 1.4.0**（已定）：改连接建立（`clientApp.connect(ndJsonStream(stdin, stdout))`）、`loadSession` / `unstable_resumeSession` → `session/load` / `session/resume`、`extMethod`；调用方式照底座 `subagent-acp/src/run.ts:440-520` 已验证的写法〔一手〕。人设：ACP 没有系统提示词，对别家 CLI 退到工作目录里的指令文件或提示词前缀（决策 4），对我们自己的 `deepseek` 进程走 `_meta.liwa`。`as:` 多实例接 Gemini CLI、OpenCode 等（决策 33）。V1 验收只到"连上 `liwa --profile deepseek`"；别家 CLI 冒烟。

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
| 预算 | 子 agent 跑在父会话的进程与回合里，消耗一律记在父活的回合与预算上；分项用量能拿到就带 `child_id` 记进 `brain_usage`（口径待实测 ⑩、⑪）；`childPolicy{ maxDepth, maxConcurrent }` 只有 `deepseek` 能在服务端 `setup` 限死（底座 `delegationDepth`、`maxDepth`），Claude / Codex 靠各家自己的上限 + 父活的看门狗与回合预算兜底 | 子活有自己的 `limits`，从父活预算里划；tasks 记账 |
| 权限 | 子 agent 的权限请求经父会话的同一条路上报、带 `childId` → `task.permission` → 直推主人（**父活不能代批**：Paseo 让父代批，弱模型替主人做安全决定不合适） | `task.permission` 直推主人 |
| 清理 | 父会话 `cancel(pause | drain | owner)` 先停子 agent 再停主回合；`cancel(preempt | watchdog)` 只停主回合；`close` 杀整个进程组；父活 `manage(stop)` 一并停；未收到 `child.ended` 的在 `session.closed` 时补记 `ended{ stopReason: 'aborted' }` | 父活结束时 tasks 级联 `manage(stop)` 子活；孤儿由 brains 的 `brain_child` 对账 |
| 不做 | — | Paseo 的 CLI 路（活的 shell 里起别的 agent）：绕开令牌与权限链，不开放 |

依据：〔一手〕底座 `tool-subagent/README.zh.md`（"外部后端执行一次任务，并通过完成通知返回最终回答"）、`tool-subagent-control/src/{index,list-agents}.ts:30,76,82`、`subagent-spawn-in-process/README.zh.md`、`subagent/src/types.ts:31-66,136-186,287-356`（`SubagentActivationSpec.delivery: 'parent' | 'caller'`、`maxDepth`、`agentPreset`）、`core/agent/src/index.ts:66`（`meta.delegationDepth`）；Paseo `docs/agent-lifecycle.md`"The subagents track"（提供方子 agent不插进 AgentManager，只存描述符与只读时间线）、`provider-subagents/store.ts`；`paseo-architecture.md` §3"不要默认代批"；决策 5、14。〔推理〕路 ② 用 `spawn` 而不照搬 `create_agent` 全家桶：灵鲸的活有归属实例、受众、交接包与核验，这些 Paseo 没有，"活管子活"比"agent 管 agent"少一套平行的生命周期。

### 4.6 外部 CLI 的配置隔离：只读灵鲸管理的那一份

主人定："接入我们这里的什么都读取，完全遵守我们这里的规则，不读取全局的那些配置"；被干活仓库的 `CLAUDE.md` / `AGENTS.md`"干活、查资料时读，灵鲸规矩优先"。

| | 成员配置目录 `<成员数据目录>/brains/` 下 | 怎么让 CLI 只读它 | 不读的 |
| --- | --- | --- | --- |
| Claude Code | `claude/CLAUDE.md`（规矩）、`claude/settings.json`（权限模式、禁用工具、模型与 `ANTHROPIC_BASE_URL`）、`claude/skills/<本事>/SKILL.md`、`claude/projects/`（转录） | `CLAUDE_CONFIG_DIR` 指进去 + `settingSources: ['user']`（干活与查资料加 `'project'`）；MCP 只经 SDK `mcpServers`（toolport）；`plugins` 不配 | `~/.claude/*`、`local` 源；非干活会话也不读项目 `.claude/` 与 `.mcp.json` |
| Codex | `codex/config.toml`（`model_provider`、`mcp_servers.liwa`、沙箱默认、`project_doc_max_bytes`）、`codex/AGENTS.md`（规矩）、`codex/skills/`、`codex/sessions/`（转录） | `CODEX_HOME` 指进去；干活与查资料按默认读仓库 `AGENTS.md`，其余 `project_doc_max_bytes = 0` | `~/.codex/*` |
| `deepseek` 进程 | `deepseek/<sessionId>/`（`LIWA_HOME`：`sessions/`、`profiles/deepseek/`、会话 patch） | `LIWA_HOME` 指进去 | 主人的 `~/.liwa/cordis.patch.yml` |
| 别家 ACP CLI | 各自的 home 变量（`as:` 实例里配） | 环境变量 | 各自全局目录 |

生成规则：brains 在 `createSession` 前 `prepareConfigDir`，内容来自 self（规矩：活的规矩、汇报格式、"本交接优先于通用指令"）与 skills（本事导出成 `SKILL.md`，决策"能"），每次覆盖、CLI 只读；目录随成员删除级联；转录目录的删除与备份照 02 §4.1。子进程环境由 `@liwa/subprocess` 先剥掉凭据与 `LIWA_*`，再显式注入该 CLI 需要的变量名（`ANTHROPIC_*`、`OPENAI_*`、`DEEPSEEK_API_KEY`，值从钥匙串读）〔一手，README〕。**仓库自带指令的优先级**：它们写的是"这个项目怎么构建、怎么测、什么别碰"，是项目事实不是人设；灵鲸规矩在 `CLAUDE.md` / `AGENTS.md` / `append` 的开头声明"本交接优先于通用指令"（`four-layers.md` §3.2），Claude 再用 `claudeMdExcludes` 排掉项目里的钩子与命令文件；主人项目之外克隆下来的仓库不读（查资料活的 `projectDocs` 由 tasks 按仓库是否主人的项目给）。依据：Claude 的 `settingSources` 与 `CLAUDE_CONFIG_DIR` 语义〔一手，`sdk.d.ts:2080-2086,1683`；`project-dir.ts:120`〕；Codex 的 `CODEX_HOME`〔一手，Paseo `:648`〕与 `project_doc_max_bytes`〔二手，待实测 ⑤〕。

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
| `packages/brain/brain-shared` | `src/paseo/` 已迁入 35 个共享文件，含时间线三件及其类型、`jsonl-frame-decoder`、`provider-subagents/store.ts`；现有进程桥 `src/process.ts` 在第 ② 步移到严格类型检查的模块；`liwa-block` 渲染与转义待后续 | 库 |
| `packages/test-support/brain-testkit` | 假提供方 `scripted`、契约测试 `describeBrainProviderContract`、测试宿主与事件记录器 | 测试 |
| `packages/brain/brain-acp` | Paseo ACP 客户端（SDK 1.4）+ `src/adapter.ts` + 厂商 shim 配置 | 本体里的客户端 |
| `packages/brain/brain-deepseek` | `brain-acp` 子类 + `_liwa` 三方法 + 会话 patch 生成 | 本体里的客户端 |
| `packages/brain/brain-claude`、`brain-codex` | `src/paseo/` + `src/adapter.ts` + `src/index.ts` + `NOTICE` | 本体里的客户端 |
| `packages/bundle/deepseek-app` | `liwa --profile deepseek`：`@liwa/acp` + `_liwa` 扩展处理器 + 五个预设 + 人设行 + `subagent` 系列 | **独立进程，每会话一个** |

`brain` profile 为 `@liwa/base` + `@liwa/brain-cli`，默认不挂提供方，测试用显式 patch 挂假提供方。`liwa brain run --provider <impl> [--model <model>] <提示词>` 开一会话、跑一回合、输出事件并关闭；不给 `--model` 就省略模型值，配置目录也不写占位值，由 CLI 采用自己的默认模型。依据：〔一手〕dev 分支 `packages/bundle/brain-cli/{cordis.patch.yml,src/startup.ts,src/index.ts}`、`packages/util/official-bundles/src/bundles.ts`（命令与组合）；〔一手〕主人已定模型省略语义（handoff 决策 53，第 ② 步落实）。

`brain-shared` 为保留 Paseo 源码写法，关闭 `noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes`；这一放宽范围目前覆盖灵鲸进程桥 `src/process.ts`，第 ② 步将桥移出该范围。时间线的 `timeline-projection`、`agent-timeline-store`、`agent-timeline-content` 及类型归 `brain-shared`，以后网关直接引用；`jsonl-frame-decoder` 供 ACP、Codex 共用。依据：〔一手〕dev 分支 `packages/brain/brain-shared/tsconfig.json`、`packages/brain/brain-shared/NOTICE`、`packages/brain/brain-shared/src/paseo/agent/provider-subagents/store.ts`；〔一手〕主人对第 1 步验收后的决定（handoff 决策 53）。

进程表：本体一个；`liwa --profile deepseek`、`claude`、`codex app-server`、别家 ACP agent 都是每会话一个（闲置回收后下次续接再拉）。全部经 `ctx.subprocess.spawn`：进程组一起杀、环境剥凭据、`graceMs` 内先礼后兵；会话进程经 `BrainLaunchContext.spawn`，拉起前 brains 在内存登记 `brain_process`，命令与 argv 哈希用于归属记录，本阶段不记录 pid；握手 30 秒。依据：〔一手〕dev 分支 `packages/brain/brain/src/session.ts`；〔一手〕Paseo 生命周期设计（§11）。

## 5 交互时序

以下为第二层接入后的目标时序；本阶段调用方直接经 `ctx.brains` 开会话，归属、人设、预算等显式给值，经历流、minds、toolport、tasks、guard、跨重启恢复与孤儿清理等搭第二层时补。网页现有对话继续使用进程内会话，界面接公共层也在第二层做。依据：〔一手〕主人推进决定（handoff 决策 47）；〔一手〕dev 分支 `packages/bundle/brain-cli/src/index.ts`。

**第三层：`tasks.open` → 活会话**。tasks 裁好工具档与交接包 → `minds.openTask` → minds 从 roster 取 `{ impl, model?, fallback }` → `toolport.issue` 拿令牌 → `brains.prepareConfigDir` → `brains.createSession({ impl, cfg })`（`owner{taskId, gen}`、`mindKind`、`persona`、`cwd` = worktree、`configDir`、`projectDocs`、`kernelTools`、`nativeToolPolicy`、`permission{ kernel }`、`compaction`、`limits`、`concludeOn`、`childPolicy`）→ brains 登记进程、经 `ctx.subprocess` 拉起（deepseek：`liwa --profile deepseek --patch`；claude：SDK `query`；codex：`codex app-server`）、握手 → `session/new` / `query` / `thread/start` → 句柄交回 → `startTurn(交接包)`。之后：`tasks.send` 四种类型 → `deliver(next_turn)` / `deliver(next_step)` / `cancel` / 高优先 `next_turn`；`permission.request` → `task.permission` → 主人 → `respondToPermission`；活里开自己的子 agent → 路①（brains 只观察登记）；活里 `spawn` → 路②（toolport → `tasks.open{父活}` → 同一条链再开一个会话）；结束 → `close`（进程一起关）→ `toolport.revoke`。

**第二层：实例会话**。minds 重建 → 同上 `createSession`（`mindKind: 'instance'`、`nativeToolPolicy: 'none'`、`compaction: 'off'`、`concludeOn: ['reply','no_reply','say']`、`childPolicy.native: false`，默认 impl `deepseek`）→ 补投。每条输入：投递器合批 → `deliver(next_turn, wake)`（deepseek：`session/prompt`）；主人对自己回合的追加 → `deliver(next_step)`（deepseek：`_liwa/steer`）；抢占 → `cancel(preempt, keepQueue)`；看门狗 → `cancel(watchdog)`；换新或换提供方 → `close` + 新代 `createSession`；回收 = 关进程保留目录；再醒 → 先试 `resumeSession`（同一目录重拉进程 + `session/resume`），续接后身份探针，答不对就换代重建。

**恢复**：本体重启 → brains `recover`：`brain_session` 里 `open` 的全部标 `closed{restart}`，`brain_process` 里 `live` 的交 03 清孤儿，`brain_child` 里未结束的标 `aborted`；minds 按 02 §6 决定重建还是续接。

## 6 出错与恢复

| 情形 | 第四层做什么 | 依据 |
| --- | --- | --- |
| CLI 两回合之间退出 | 报 `session.exited{process_exit}`，只影响这一个会话；未结束的子 agent 补记 `child.ended{aborted}`；minds 续接或重建 | `agent-lifecycle.md`〔一手〕 |
| 握手超时、二进制缺失、鉴权失败 | `createSession` 抛 `unavailable` / `auth`；minds 换 fallback | `overall.md` §12.3 |
| `cancel` 被拒或超时 | 标"停止中"、拒绝新 `startTurn`；minds 换代 | `agent-lifecycle.md` Cancellation〔一手〕 |
| 续接失败 | `resumeSession` 抛 `not_found` / `unavailable`；minds 新代重建，不读旧转录 | `overall.md` §12.2 |
| 子 agent 卡住 | 路①：父活的看门狗与回合预算兜底，`cancel` 时一并停；路②：子活自己的看门狗；父活结束级联 | §4.5 |
| 会话与配置目录 | deepseek：`<成员>/brains/deepseek/<sessionId>/`（整个目录随会话删除）；claude：`<成员>/brains/claude/projects/…`；codex：`<成员>/brains/codex/sessions/…`；按保留期删（底座 `SessionPersistence` 加 `delete`，03）；主人删除内容时按事件号找代次整目录删；备份不含 | `overall.md` §6.4；02 §4.1 |
| 提供方自带压缩触发 | 报 `session.compacted`；实例会话出现即换新并记质量事件 | §3.1 |

## 7 成本与性能

brains 零模型调用。进程：每个活会话一个 CLI 进程；`deepseek` 进程是整个底座（base bundle 约 30 个插件），启动时间与内存待实测 #21、⑧；实例会话常驻可摊薄，想事活每次新开要算进 `ponder` 延迟。用量：每回合 `turn.completed.usage` 写 `brain_usage`，`onUsage` 推给 guard；子 agent 的消耗记在父活上；guard 按 roster 单价表从 token 自算费用；订阅制账号用 `quotaWindows` / `balances`（Codex 的 `account/rateLimits/updated` V1；Claude 订阅经 Paseo `claude-usage-source` 插件思路 V1.1）；预算的原子预留在 guard，发生在 `startTurn` / `deliver(wake)` 之前。

## 8 安全与隐私

令牌只在 `SessionConfig` 与内存，按代次作废；适配器不能自报身份；三个 CLI 的子进程环境由 subprocess 剥干净再显式注入；配置目录每成员一份、CLI 只读它，不碰主人的全局目录；`permission.mode: 'kernel'` 时原生工具每次经本体，暂停与总闸能拦住（待实测 #5）；子 agent 的权限不让父代批；原生子 agent 只在干活的活里、跑在父会话的沙箱与 worktree 内；转录目录随删除级联、不进备份；`liwa --profile deepseek` 只监听 stdio，不开端口。

## 9 第一版范围与验收

第一阶段（第 1 步）已在 dev `fbb36685` 交付 `@liwa/brain` 契约与 `ctx.brains`、35 个 Paseo 共享文件、`@liwa/brain-testkit`、`@liwa/brain-cli` 和 `liwa brain list / probe / run`；`ctx.brains` 已挂到 web 与 headless，但网页对话仍走进程内路径。会话暂存内存并发出 `brain.*.v1` 事件，经历流、minds、toolport、tasks、guard、跨重启恢复、孤儿清理与网页接公共层等搭第二层时补。依据：〔一手〕dev 分支 `packages/brain/brain/src/index.ts`、`packages/brain/brain-shared/NOTICE`、`packages/test-support/brain-testkit/src/contract.ts`、`packages/bundle/{brain-cli,web-app,headless}/cordis.patch.yml`；〔一手〕主人决定（handoff 决策 47）。

当前推进顺序：① 公共层（已完成）→ ② `brain-acp` + `deepseek-app` + `brain-deepseek`（独立进程的 deepseek CLI，同时实现模型可省、进程桥移出放宽类型检查范围）→ ③ 常驻进程托管会话，并借鉴 Paseo 的 `run / ls / logs / attach / send / wait / stop / inspect / permit / delete / archive / provider / usage` 与 `start / status / restart` → ④ Claude 适配器 → ⑤ Codex 适配器。各步用真 CLI 验收，到 ⑤ 第一版第三、四层基础搭完。依据：〔一手〕主人推进与命令集决定（handoff 决策 48、54）。

下列范围与 A1–A6 中依赖第二层的项目在搭第二层时补验；`session/resume` 的提供方能力可先验，跨重启恢复与孤儿清理不列为当前提供方步骤的完成条件。依据：〔一手〕主人推进决定（handoff 决策 47）。

- **m0**：`@liwa/brain` + `brain-acp`（SDK 1.4）+ `brain-deepseek` + `deepseek-app`（实例预设、`reply` / `no_reply` / `inner`、`_liwa/steer`）；契约测试与回环编解码；`liwa brain list / probe / run`。
- **V1.0**：`brain-claude` 全验证（实例、想事、整理、干活）；`brain-codex` 干活与查资料；五个预设；路①（三家的观察）与路②；配置目录生成；备用提供方切换；Paseo 代码与 NOTICE 进仓。
- **V1.1**：Codex 当实例会话、`dynamicTools`、Claude 订阅额度窗口、预热空闲 `deepseek` 进程、离线预审、别家 ACP CLI 验证、主控台的子 agent 面板。

**验收（真实 CLI，密钥从钥匙串读）**：

| # | 怎么算接通 |
| --- | --- |
| A1 | `brain-deepseek`：本体为主人实例拉起真 `liwa --profile deepseek` 子进程（`LIWA_HOME` 在该会话目录、`~/.liwa` 无新文件）→ `liwa chat` 一句话 → `session/new` 带 `_meta.liwa` → 事件 `brain.session.opened → turn.started → tool.called(reply, inner 同批) → turn.completed{concludedBy: reply, usage.tokens 非空, inferences = 1}`；第 4 步被 `agent/pre-step` 拒；主人追加一句经 `_liwa/steer` 在下一步可见；杀本体重启 → 清孤儿杀掉旧进程 → 同一目录重拉 → `session/resume` 成功、身份探针答对 |
| A2 | `brain-claude`：真 `claude`（≥ 2.1.292）开一件想事活（自定义 `systemPrompt`、`settingSources: ['user']`、`CLAUDE_CONFIG_DIR` 在成员目录、`tools: []`），`conclude` 经 MCP 到 toolport；`maxTurns=3` 第 4 次推理不发生；`~/.claude/projects` 无新文件；`kill -9` 本体后 `claude` 进程被下次启动清掉；`deliver(next_step)` 在下一步可见 |
| A3 | `brain-codex`：真 `codex app-server` 开一件干活活（`developerInstructions`、`CODEX_HOME` 在成员目录、`workspace-write` 限 worktree、读到仓库 `AGENTS.md`）；`report` 经 MCP 到 toolport；写 worktree 外触发 `requestApproval` → `permission.request` → `deny_once` 后回合继续；`turn/steer` 次步可见；`thread/tokenUsage/updated` 进 `brain_usage` |
| A4 | 子 agent：`deepseek` 上的干活活调 `subagent` 开子会话、子结束结果回到父的下一步、`brain_child` 与用量归父；Claude 上的干活活用 `Agent` 工具开一个子 agent → `child.started / ended` 出现在 `task:<id>` 流、用量记在父活、`cancel(owner)` 时子 agent 被 `stopTask`；同一活调 `spawn(codex, 交接包)` 开子活、子活 `report` 回到父活、父活结束级联停掉子活；子 agent 的一次权限请求直推主人而不是父 |
| A5 | 切换：roster 把主人实例从 `deepseek` 改成 `claude` → 空闲换代 → 上下文从账本重建 → 身份探针通过 → 再改回 |
| A6 | 契约：四个提供方过同一套契约测试（假 CLI 回放）与回环编解码；`Meta` 声明为 false 的语义恒回 `unsupported` |

## 10 待实测（已定：先派一个探针任务跑完，结果决定 `Meta` 的真值）

承接 `overall.md` §17 第 2、4、5、6、8、9、32、35、36、40 项，再加：① `_liwa/steer` 经 SDK 1.4 两端透传与到达下一步的延迟；② `session/prompt` 阻塞期间 `session/cancel` 的返回时序；③ SDK `PostToolBatch` 的 `continue: false`；④ Claude 自动压缩的开关；⑤ Codex `project_doc_max_bytes = 0` 是否真不读仓库 `AGENTS.md`、`dynamicTools` 的稳定性、自动压缩能否关；⑥ `turn/interrupt` 作收尾时 Codex 报什么状态；⑦ `agent/pre-step` 在 `step ≥ 2` 拒步后 `turn/end` 是否正常落；⑧ 每会话一个 `liwa --profile deepseek` 进程的内存与启动时间，想事活因此多出的延迟；⑨ 子会话的权限请求是否经父会话的 `session/request_permission` 上报；⑩ Claude 原生子 agent 的用量口径（`result.modelUsage` 是否含子 agent、`task_notification` 里有没有分项）；⑪ Codex 子线程的 `thread/tokenUsage/updated` 是否经同一连接到达。

## 11 依据

- 〔一手〕底座 `dsh-base` `ad4e3c50`：`packages/core/agent/src/{index,runtime-types,types}.ts`；`core/agent-loop/src/{index,agent,runtime-context,constants}.ts`；`core/tools/src/contracts.ts`；`preset/*/README.zh.md`；`core/system-prompt/README.zh.md`；`llm/*/README.zh.md`；`bundle/{base,acp-app,headless,sdk-app,sdk-minimal}/cordis.patch.yml`；`acp/acp/{README.zh.md,src/index.ts,src/session.ts}`；`sdk/*/src`；`subagent/{subagent,tool-subagent,tool-subagent-control,subagent-spawn-in-process,subagent-fork-in-process,subagent-claude-code,subagent-codex,subagent-acp}`；`subprocess/*`；`session/session-persistence-jsonl/README.zh.md`；`jobs/jobs/README.zh.md`；`guard/*`；`apps/cli/src/*`；`util/official-bundles/src/bundles.ts`；`docs/agent-lifecycle.zh.md`；安装包 `@anthropic-ai/claude-agent-sdk@0.3.263/sdk.d.ts`、`@agentclientprotocol/sdk@1.4.0/dist/acp.d.ts:857,1482`。
- 〔一手〕`paseo@8018231a`：`LICENSE`、`package.json`、`CHANGELOG.md`、`packages/server/package.json`；`packages/server/src/server/agent/{agent-sdk-types,agent-manager,provider-registry,provider-launch-config,system-prompt,agent-response-loop,mcp-server,paseo-tool-policy}.ts`、`providers/claude/*`（含 `subagents/`、`runtime-safety.ts`）、`providers/codex-app-server-agent.ts`、`providers/codex/*`、`providers/{acp-agent,generic-acp-agent,provider-runner}.ts`、`tools/paseo-tools.ts`、`agent-messages/*`、`finish-subscriptions/index.ts`、`provider-subagents/store.ts`、`create-agent/intent.ts`、`idle-runtime-cleanup/index.ts`、`restart-recovery/index.ts`、`managed-processes/managed-processes.ts`、`utils/spawn.ts`、`paseo-env.ts`；各目录行数（附录 A）；`docs/{providers,agent-lifecycle,data-model}.md`；`public-docs/{mcp,orchestration,orchestration-workflows,skills,agent-profiles,codex}.md`。
- 〔二手〕`research/2026-10-28-subagent-notes/cli-claude-sdk-codex-app-server.md`（SDK `perTaskStopAffordance`、`stopTask`、`usage` 只算主循环；Codex `collabAgentToolCall` / `subAgentActivity`）、`cli-protocols-acp-a2a-mcp.md`（`_` 前缀自定义方法、`_meta`）、`research/2026-10-28-paseo-architecture.md`、`2026-11-01-dsh-superagent.md`、闲置包盘点 §5。
- 已确认与上位文档：`four-layers.md` §1–§5；`overall.md` §3.4、§5、§6.4、§9.2、§11、§12、§16.1、§17；`00-contracts.md` §2、§5.1、§6；`00-commands.md` §3；`02-minds.md`；决策 1、2、4、5、6、14、28、33、36、43。
- 〔推理〕标注处：`_liwa` 字段名与代码量估计；路 ② 用 `spawn` 不照搬 `create_agent`；Codex 推理计数与收尾；Codex 子线程的清理方式；验收阈值。

## 12 已定的点（主人 2026-11-02 两次答复）

| # | 点 | 定了什么 |
| --- | --- | --- |
| 1 | 自建默认 agent 的形态 | 第一版就是独立进程的 CLI，`liwa --profile deepseek`，和 Claude Code、Codex 同形 |
| 2 | 进程粒度 | **每个会话一个进程**（不是每成员一个） |
| 3 | 提供方名 | 自建默认 agent 叫 `deepseek`（包 `brain-deepseek`、bundle `deepseek-app`、profile `deepseek`）；`claude`、`codex` 不变；通用 ACP 叫 `acp` |
| 4 | ACP 扩展 | 三个 `_liwa/*` 方法（steer、usage、children）+ `_meta.liwa` 字段 |
| 5 | 子任务 | 走 Paseo 的方式：默认用提供方自己的子 agent 机制，需要时经 `spawn` 子活调别家 CLI；不开放 CLI 路 |
| 6 | Claude / Codex 的原生子 agent | 干活与查资料的活里放开；灵鲸只观察、记录、计入父活预算；不带她的人设 |
| 7 | 底座 `subagent` 系列 | 留 seam + 进程内 spawn / fork + 两个工具；删四个外部委派与 OAR |
| 8 | 外部 CLI 的配置 | 全局一律不读；每成员一份灵鲸生成、CLI 只读的目录 |
| 9 | 被干活仓库的 `CLAUDE.md` / `AGENTS.md` | 干活与查资料的活读，灵鲸规矩优先；其余会话不读 |
| 10 | Codex 二进制 | PATH 上的 `codex`；底座随包的 0.153.4 随 `subagent-codex` 删 |
| 11 | Paseo 代码的改法 | 原地改 + 每包 `NOTICE` 改动清单 |
| 12 | `brain-acp` | V1 做，迁时升到 SDK 1.4 |
| 13 | 内核工具到 CLI | V1 toolport HTTP MCP，三家一个端点 |
| 14 | 待实测项 | 先派一个探针任务跑完 §10 的十一项，结果决定 `Meta` 的真值 |

**待定点**（设计暂按本节其余条目）：① 想事·立场类的活要不要也放开子 agent（本稿只给干活与查资料的活）；② 原生子 agent 不带她的人设，是决策 5"执行者只能是她"的一个边界例外，建议记进 handoff 的决策表；③ 每会话一个 `deepseek` 进程给想事活带来的启动延迟，探针测出数字后再定要不要 V1.1 的预热。

## 13 以后

`liwa acp serve` 与 `deepseek-app` 合一；Codex 当实例会话；`dynamicTools`；主控台的子 agent 面板（Paseo `provider-subagents` 的只读时间线）；Claude 订阅额度窗口（条款核实在前，`four-layers.md` §10 第 15 条）；离线预审与自动切换名单；预热空闲 `deepseek` 进程；别家 ACP CLI（Gemini CLI、OpenCode）验证；Paseo 0.15 的"重启后自动续跑被打断的 agent"（CHANGELOG #8127）与 `overall.md` §12.1 对照；附录 A 里标 V1.1 / V2 的项。

## 14 其他文档的同步清单

| 文档 | 改什么 |
| --- | --- |
| `overall.md` §3.4 | "底座自带 agent 在本体进程内、不走 procs"改为"`liwa --profile deepseek` 每会话一个子进程、经 `ctx.subprocess`，和 Claude / Codex 同形"；procs 改称底座 `@liwa/subprocess` |
| `overall.md` §9.2 | `Meta` 加 `runtime` / `transport` / `kernelTools` / `binary` / `children` / `extensions`；`SessionConfig` 加 `permission` / `compaction` / `configDir` / `rules` / `skillsDir` / `projectDocs` / `childPolicy`；`BrainEvent` 加 `session.compacted` / `process.exited` / `child.*`；"底座自带 agent 用 `ctx.agents.create`"改为经 ACP；impl 名 `deepseek` |
| `overall.md` §5.2 工具表、§5.9 | 干活的活加 `subagent` / `send_message` / `interrupt_agent` / `list_agents`（`deepseek` 上）与 `answer`（限子活）；§5.9"子会话"改为两条路；CLI 原生工具行注明原生子 agent 放开 |
| `overall.md` §15.1、§16.1、§17 | Paseo 提交号 `8018231a`；brains 行"ACP 从上游摘进来但不列入验收"改为"V1 做、连 `deepseek` 进程验收"；§17 加 §10 的十一项 |
| `four-layers.md` §0、§1、§3.1、§4、§2.16 | "底座自带 agent（默认；进程内 agent-loop）"改为"`deepseek` CLI（默认；每会话一个独立进程）"；§3.1 干活行注明子 agent 两条路；§4 四个实现都是 CLI |
| `02-minds.md` §1、§4.2、§4.5、§4.6、§9 | brains 归 01；投递器落点表的"底座自带 agent"列改为 `deepseek` CLI（`session/prompt`、`_liwa/steer`、`session/cancel`）；§4.6 活里的子 agent；m0 提供方是 `deepseek` CLI 进程 |
| `engineering.md` §4.7、§4.8、§9 | 落位表按附录 A 重写；`src/paseo/**` 例外沿用 |
| `architecture/README.md` §2 "01" 节 | 第四层说明以本稿为准；ACP 在 V1 实现并接 deepseek CLI 验收 |
| `roadmap.md` 2.4、3.1 | ACP 提前到 V1.0；Codex 干活验证 V1.0 |
| `00-plugin-kernel.md` §16 | "模型 / 大脑"行与 subagent 行按本稿改 |
| `06-growth.md`（待确认稿）、`05-memory.md` | 本事（skills）要能导出成 `SKILL.md` 进成员配置目录；规矩文本由 self 提供（§4.6 的来源） |

## 附录 A　Paseo 能力盘点与迁移地图（默认迁）

行数为 `wc -l` 非测试代码；"迁"= 原样拷贝 + 原地改；"迁规则"= 不拷代码、把行为写进对应模块文档；"不迁"要写理由。路径省略 `packages/server/src/server/`。

| 能力 | Paseo 位置（行） | 处置 | 落到 | 理由 / 改什么 |
| --- | --- | --- | --- | --- |
| 统一 agent 契约 | `agent/agent-sdk-types.ts`（830） | 迁 | `brain-shared/src/paseo/` | 映射在各 adapter |
| Claude 适配器 | `providers/claude/{agent,query,options,project-dir,transcript-history,tool-call-mapper,tool-call-detail-parser,partial-json,runtime-safety,hooks,subagent-handback,interrupt-placeholder}.ts`（≈ 8 600） | 迁 | `brain-claude` | §4.2 的改法 |
| Claude 原生子 agent 观测 | `providers/claude/{sidechain-tracker,task-state,task-notification-tool-call}.ts`、`subagents/`（≈ 1 110 + 目录） | 迁（V1） | `brain-claude` | §4.5 路①的观察 |
| Claude 模型目录、回滚、导入 | `providers/claude/{model-manifest,models,model-discovery,rewind,import-descriptor-scheduler}.ts`（≈ 1 030） | 不迁 | — | 目录给 Paseo 界面用，模型由 roster 配；回滚与导入是 Paseo 产品功能 |
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
| 额度来源插件 | `plugins/{claude,codex}-usage-source`；其余 7 家 | 迁两家（V1.1） | `brain-claude` / `brain-codex` | `usage.update.quotaWindows` 的来源 |
| 插件平台、Hub、连接主机、中继、推送、配对、WebSocket 会话 | `plugins/`（7 137）、`hub/`、`connected-hosts/`、`relay`、`push/`、`pairing-*`、`session/`（9 529）、`websocket/`、`authorization/`、`auth.ts` | 不迁 | — | 插件机制是底座的 cordis；单机单主人（决策 3）；前后端协议是 gateway 自己的（07） |
| 守护进程壳 | `daemon-worker.ts`、`supervisor`、`pid-lock.ts`、`bootstrap.ts`、配置存储 | 不迁（借自检） | 本体入口 | launchd 守护；`overall.md` §12.1 |
| 客户端与 CLI | `packages/{cli,client,app,desktop,website,expo-two-way-audio,highlight}` | 不迁（CLI 借形状） | `00-commands.md` 已定 | — |
| 第三方提供方插件 | `plugins/{antigravity,hoplite,muse}-provider` | 不迁 | — | 灵鲸不用这些产品 |
