# 01 agent CLI 接入（brains、`brain.provider`）：第四层的契约、三个 CLI 提供方、子 agent 与 Paseo 迁移

状态：**已确认**。第 1、2 步已有实现；④ Claude Code 与 G1 已在 `13a66153` 提交待合回；常驻宿主设计见 [01-brain-host.md](01-brain-host.md)，数据／生命周期由 [02-minds.md](02-minds.md) 唯一拥有，计划接口见 [00-contracts.md](00-contracts.md) §5.1。推进顺序为 **④ Claude Code＋G1 → ③ 宿主（G4 与 JSON 严格读取前置）→ ⑤ Codex＋G2/G3**；Claude 可先在现有一次性 brain run 验收。配套[流程图](01-agent-cli.html)，源为 [01-agent-cli.src.html](01-agent-cli.src.html)。〔一手〕handoff 决策 65、66；`packages/bundle/brain-cli/src/index.ts:308`。

依据标记：〔一手〕源码或原文；底座指 dsh-base、已实现第四层指 dev，路径相对各仓库根；Paseo 固定 `getpaseo/paseo@8018231a`（0.15.0-beta.1，Apache-2.0）。两份适配评估为 `research/2026-11-05-claude-code-adaptation.md`、`research/2026-11-05-codex-adaptation.md`，下文简称 Claude 评估／Codex 评估；安装源码行号沿报告的 `S:`／`C:`，Codex 生成协议沿 `G:`。〔二手〕外部资料或转述；〔推理〕方案建议，未确认的单列待定。
## 0 一页结论

- **第四层 = seam 包 `@liwa/brain`（契约 + `ctx.brains` 服务）+ 每个 CLI 一个提供方插件**（决策 33），形状照底座 `@liwa/llm` ↔ `llm-deepseek`、`@liwa/subprocess` ↔ `subprocess-local`〔一手，两包 README〕。**三个提供方在形态上完全一致：每个会话一个独立进程的 CLI**，本体里只有客户端。
- **自建默认 agent = 提供方 `deepseek`（包 `brain-deepseek`），进程是 `liwa --profile deepseek`**：底座 `apps/cli` 启动器 + 新 bundle `@liwa/deepseek-app`（`@liwa/base` + 底座现成的 ACP 服务器 `@liwa/acp` + 灵鲸扩展 + 五个预设）。对外说 **ACP v1 + 三个 `_liwa/*` 扩展方法 + `_meta.liwa.*` 字段**（ACP 允许 `_` 前缀自定义方法与 `_meta` 扩展〔二手〕；SDK 1.4 两端都有 `extMethod`〔一手〕）。**每个会话一个进程**，一条 ACP 连接上只有这一个会话；人设十段作为该进程的 `personaPrefix` 注入一次，进程里的子会话自动继承。本体侧的 `brain-deepseek` 是 `brain-acp` 通用客户端加 `_liwa` 扩展的薄层；steer 由 `_liwa/steer` → 底座 `agent.steer` 补上（§4.1）。
- **`brain-claude-code`、`brain-codex` 从 Paseo 迁，目标与 Paseo 同等功能**（Claude Agent SDK 精确钉 0.3.263，显式选择本机真实 `claude`；Codex app-server 用 PATH 上真实 `codex`；两家首版均用 Key、同 CLI 多提供方可并行）；**`brain-acp` 已在第 2 步实现**：SDK 1.4，它是 `brain-deepseek` 的底子。
- **子 agent 两条路**（§4.5）：① **提供方自己的子 agent**，只在干活与查资料的活里放开——`deepseek` 用底座 `subagent` seam（`subagent` / `send_message` / `interrupt_agent` / `list_agents` 四个工具，spawn / fork 进程内后端，自动继承人设），Claude 的 `Agent` 工具、Codex 的协作 agent 照 CLI 自己的方式开；灵鲸不干预，只观察、记录、计入父活的预算（`brain_child`、`brain.child.*` 事件、用量归父活）；② **跨 CLI 子活**：经内核工具 `spawn(执行者, 交接包)` 开第三层子活，由 `tasks` → `minds` → `brains` 在指定提供方上开会话，回报走活的事件——这是 Paseo `create_agent` + `notifyOnFinish` 的形状，把"agent 自管 agent"换成"活管子活"。不开放 Paseo 的 CLI 路（活的 shell 里直接起别的 agent），它绕开令牌与权限链。
- **外部 CLI 用空壳子配置**（§4.6）：不加载 CLI 自带全局／项目配置、钩子、本事与插件；规矩、项目 `CLAUDE.md` / `AGENTS.md` 内容、MCP 都由灵鲸受控注入，Codex 另给隔离 HOME。认证与提供方实例分别隔离，真机证明不了就停下来问主人。全局 agent 集与四级文件选择已实现，规范见 [03-agent-config.md](03-agent-config.md)；主控台／roster 配置事件后续接入。依据：〔一手〕handoff 决策 56–58。
- **Paseo 迁移**：固定提交 `8018231a`，按文件原样拷进各包 `src/paseo/`，原地改、改动记进包内 `NOTICE`；全量盘点见附录 A，适配器按既定方法迁；agent 管理层与 MCP 目录整块搬运并按 §4.9 插件化融合；不迁 daemon 壳、Paseo 插件平台、远程接入与已有底座进程服务；日志以灵鲸 JSONL 为真相。
- **验收用真实 CLI**（§9）：A1 真 `liwa --profile deepseek` 子进程跑完主人实例一回合、`_liwa/steer` 次步可见、重启后 `session/resume`；A2 真 `claude`；A3 真 `codex app-server`；A4 子 agent 两条路各一条、Claude 原生子 agent 被观察计费；A5 同一实例从 `deepseek` 换代到 `claude`。

## 1 范围与边界

| 管什么 | 不管什么（归谁） |
| --- | --- |
| `@liwa/brain`：契约类型、`ctx.brains` 服务（提供方登记、按 roster 解析、提供方目录、探测、blob 与成员配置目录；会话/用量/进程观察移交 minds，见 §3.2）；四个提供方插件；`deepseek-app` bundle；Paseo 代码的落位与 NOTICE；进程监管规则的提供方侧义务 | 什么时候开会话、换新、回收、投递队列（minds，02）；工具目录、令牌、同步执行（toolport，02）；准入、名额、总闸、日预算（guard，03）；进程服务本身（底座 `@liwa/subprocess`，03）；roster（04）；人设与规矩的内容（self，06）；本事的内容（skills，06） |

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
| `@liwa/acp` + `bundle/acp-app`（`session/new\|list\|resume\|close\|set_config_option\|prompt\|cancel\|request_permission`，stdio / HTTP MCP） | **`deepseek-app` 的底子** | **改造**：加 `_liwa/*` 方法与 `_meta.liwa.*` 处理、按会话预设 | 〔一手〕`packages/acp/acp/README.zh.md`；`src/index.ts:200-204`、`src/session.ts:119-124` |
| `@liwa/sdk-*` + `bundle/sdk-app` / `sdk-minimal` | 不用于第四层（无取消、`initialize` 定死模型） | **留着**，去留等裁剪 | 〔一手〕`sdk/protocol/src/types.ts:17-125` |
| `apps/cli`（`liwa <profile>`、`--patch`、`liwa plugin --profile X add`） | 本体与 `deepseek` 进程共用的启动器 | **留着** | 〔一手〕`apps/cli/src/{bin,args}.ts`；`util/official-bundles/src/bundles.ts:11-24` |
| `guard/repeat-tool-reminder`、`guard/timeout-policy`、`jobs(-local)`、`shell/tool-bash`、`sandbox-policy` | `deepseek-work` 预设里给活用；实例预设不装 | **留着** | 〔一手〕各包 README |

## 2 数据

五张表是当前 `ctx.brains` 的内存观测形状，字段使用 camelCase；它只保留开着的句柄，关闭结果随事件发出。第 3 步的持久 agent、队列、代次、回合与待答只由 [02-minds.md](02-minds.md) §2.3–§2.7/§4.0 定义，逐条进程台账见下节，宿主调用这些 API，不建立第二生命周期。依据：〔一手〕develop 源码 `packages/brain/brain/src/{views,index,session}.ts`；〔一手〕主人推进决定（handoff 决策 47）。

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `brain_provider` | impl、plugin、meta、available、lastProbeAt?、probeResult? | `liwa brain list` 读取并逐个探测；尚未探测时 available 未知 |
| `brain_process` | processId、sessionId、impl、command、argvHash、startedAt、state（`live` / `exited`）、exitCode?、signal?、exitedAt? | brains 分配的 processId 不是系统 pid；subprocess 不公开进程身份，本阶段不记 pid / pgid / parent_pid，不存参数原文 |
| `brain_session` | sessionId、impl、member、mindKind、owner{instanceId或taskId, gen}、model?、modeId?、configDir、homeDir、state、openedAt、resumedFrom?、adjustments、closedAt?、closeReason? | 一代会话一行；model 可省，省略用 CLI 默认值；modeId 可省 |
| `brain_child` | childId、sessionId、kind（`native-child` / `cross-cli-task`）、provider、label、parentChildId?、state、stopReason?、usage?、openedAt、endedAt? | 当前只登记提供方自己的子 agent；跨 CLI 子活等 tasks；关闭时未结束的补记 `aborted` |
| `brain_usage` | sessionId、impl、member、owner、turnId?、childId?、source（`turn` / `update` / `child`）、usage、at | 经 `onUsage` 与事件推出；子 agent 用量按 owner 归父活，guard 等第二层接入 |

Cordis 事件固定使用点号与版本名：`brain.session.opened.v1`、`brain.session.closed.v1`（关闭的会话与用量汇总）、`brain.process.spawned.v1`、`brain.process.exited.v1`、`brain.child.opened.v1`、`brain.child.ended.v1`、`brain.usage.v1`、`brain.provider.unavailable.v1`；不套底座的 `域/名` 命名。经历流接入后订阅这些事件写 `instance:<id>` / `task:<id>`，提供方不可用写 system 流，回合与工具事件由 minds 记（02 §2.2）。依据：〔一手〕develop 源码 `packages/brain/brain/src/index.ts`、`packages/brain/brain/src/views.ts`；〔一手〕主人同意第 1 步事件落法（handoff 决策 53）。

### 2.1 受管进程台账（计划）

一个受管进程／启动 intent 一份 JSON，经底座 storage-domain＋storage-json/per-record 写入；示例领域路径为 `state/runtime/managed-processes/<recordId>.json`，物理根由 Config 指定。唯一写入者是 subprocess 的持久监管能力，brains 只附会话归属，minds 只保存引用。〔一手〕`packages/storage/storage-json/README.zh.md:90`；`paseo-upstream@8018231a:docs/data-model.md:64`；handoff 决策 62；〔推理〕落位。

| 字段组 | 计划字段 | 约束 |
| --- | --- | --- |
| 稳定身份 | recordId/processId、role、agentId/sessionId/gen、ownerBootId | 安全不透明文件键，一次启动有明确 owner；不靠 cwd 猜归属 |
| OS 出生／范围 | osBootIdentity、pid、pgid/scopeId、birthIdentity、实际可执行路径 | PID 复用不能误杀；无法观测则 unknown，不能仅凭旧 pgid 发信号 |
| 启动事实 | command、argvHash、prepared/born/released、startedAt | 不存 argv/env 明文；intent 与出生身份、owner 引用 durable 后才放行 CLI |
| 结束／对账 | state、exitCode/signal、exitedAt、reconciledAt、cleanupResult | done 只表示直系结果，waitForExit 才确认受管范围；未停稳保留记录 |

表中字段为〔推理〕计划，当前 `BrainProcessView` 仍只有命令／哈希等内存字段，未公开系统 pid／出生身份。现状依据：〔一手〕`packages/brain/brain/src/views.ts:30`、`packages/brain/brain/src/session.ts:420`、`packages/subprocess/subprocess/src/types.ts:180`。严格读取、每条原子写、跨文件 intent 的共同保证见 [02-minds.md](02-minds.md) §2.6–§2.7；进程启动对账由公开 subprocess API 实施，不由宿主私读文件。

## 3 接口

### 3.1 `brain.provider` 契约（在 `00-contracts.md` §5.1 之上补齐）

提供方保留 impl/meta/sessionHome/writeMemberConfig?/probe 与受管 launch，createSession/resumeSession 返回完整 Paseo AgentSession；同时供应 AgentClient 的 catalog、可用性、诊断、模式／配置解析、native archive 与 shutdown 能力，不供应外部会话导入。完整接口与逐字段配置表只在 [00-contracts.md](00-contracts.md) §5.1 维护。BrainProviderSession 退役；事件纯 reducer 归 brain-shared，minds 分发器调用它；Claude/ACP 直通，deepseek/testkit 临时适配在 D′ 结束删除。〔一手〕主人工作记录 20 C1；`packages/brain/brain-shared/src/paseo/agent/agent-sdk-types.ts:677`；〔推理〕接缝。

### 3.2 `ctx.brains` 服务（`@liwa/brain`，提供方表）

brains 只拥有提供方登记、probe、prepareConfigDir、blobs；minds 持有 ManagedAgent/AgentManager 与提供方目录三件，负责模型／模式目录缓存、诊断与默认模型。createSession → createAgent；resumeSession → resumeAgentFromPersistence；openChildTask → create-agent/create + finish-subscriptions；listSessions/get → listAgents/getAgent 与 AgentDirectory；children → listProviderSubagents；processes → subprocess 台账查询，minds 只存 processRefs；onUsage → minds 已提交事件分发并继续发 brain.usage.v1。调用方不再拿 ManagedBrainSession 建第二套回合／pending 状态机。〔一手〕Paseo `agent/agent-manager.ts:1088`、`:1278`、`:1348`、`:1426`；〔推理〕C1。

prepareConfigDir(member,impl,spec) 返回成员 brains 根，只分发提供方 writeMemberConfig；per-session/per-member 布局与受管进程／blob 入口保留。提供方配置错误在唯一 resolve/create 执行点拒绝；权限问题保持结构、子请求直推主人，能力不支持的组合不静默降级。H′ 之前 brain-cli 保持当前一次性运行，H′ 改走 minds；本节不把计划服务形状写成当前发布 API。〔一手〕`packages/brain/brain/src/config-dir/shared.ts:12`、`packages/bundle/brain-cli/src/startup.ts:81`；〔推理〕。

## 4 核心机制

### 4.1 自建默认 agent：提供方 `deepseek`，进程 `liwa --profile deepseek`

第 2 步已实现 `brain-acp` + `deepseek-app` + `brain-deepseek`，每会话一个真 CLI 进程、ACP v1 加 `_liwa` 扩展。能力实现与契约证据以 dev 为准；不把本体尚未实现的第二层能力算作已交付。依据：〔一手〕`packages/brain/brain-deepseek/src/provider.ts:58`、`packages/bundle/deepseek-app/src/index.ts:1`。

| 项 | 当前做法 | 依据 |
| --- | --- | --- |
| 形态与装配 | `deepseek` profile = `@liwa/base` + `@liwa/deepseek-app`；web、headless、brain-cli 挂 `brain-deepseek`；`deepseek` 进程自身不挂 brain 提供方，避免递归 | 〔一手〕`packages/util/official-bundles/src/bundles.ts:1`、`packages/bundle/brain-cli/cordis.patch.yml:1` |
| 启动／续接 | 优先使用本体安装的 `lib/bin.js`，源码用 tsx；每会话 home 存 patch、profile、转录；`session/resume` 在同 home 重拉。安装不可启动时照常登记、probe 报不可用、开会话明确失败 | 〔一手〕`packages/brain/brain-deepseek/src/launcher.ts:1`、`src/provider.ts:117`|
| 人设与模型 | 五个预设不带人格行；人设稳定段走 `system-prompt.personaPrefix`、`includeLiwaIdentity:false`，notes 走 agent 作用域并 `interpolate:false`；model 可省，有值才写默认模型与选择 | 〔一手〕`packages/brain/brain-deepseek/src/session-patch.ts:53`|
| 会话策略 | patch 控制 agent-instructions、skill-filesystem、tool-skill、compaction-basic、tool-result-pruner；规矩写会话 home 的 AGENTS.md，LIWA_AGENTS_HOME 指空隔离目录；`projectDocs:false` 清空项目候选，`compaction:off` 真关两条压缩行 | 〔一手〕`packages/brain/brain-deepseek/src/session-patch.ts:66`、`:114`|
| 原生工具 | `none` 清空原生工具，`readonly` 按已校验的 readonlyTools 白名单，MCP 不受影响；none＋skillsDir、非 worktree＋原生子 agent 在拉进程前拒绝。工具指引随工具可见性出现 | 〔一手〕`packages/brain/brain-deepseek/src/provider.ts:151`、`packages/bundle/deepseek-app/src/index.ts:232`|
| 回合／送达 | `startTurn` 发 session/prompt；`next_step` 走 `_liwa/steer`，无在途回合回 unavailable；`nextTurn:false`，`deliver(next_turn)` 恒 unsupported，上层在边界调用 startTurn | 〔一手〕`packages/brain/brain-deepseek/src/provider.ts:64`、`src/session.ts:183` |
| 收尾与预算 | `agent/pre-step` 拒绝超预算下一步；工具预算／子策略拒绝调用；成功的 concludeOn 工具让回合收尾，不额外装预设 complete 段 | 〔一手〕`packages/bundle/deepseek-app/src/index.ts:1`|
| 权限／问答 | approval 经根会话 `session/request_permission`；带工具 title、rawInput、理由 content，子请求加 childId、直达主人；ask_user_question／计划审批走表单 elicitation，无损答案在严格 `elicitation.ts` 编解码，不能编码就拒绝 | 〔一手〕`packages/acp/acp/src/updates.ts:74`、`packages/brain/brain-acp/src/elicitation.ts:182`|
| 模型／模式 | `setModel` 当前路由内切换并核对；模式 `default` / `plan`，空闲立刻、在途下一步生效；计划获批回 default，状态未变不重复发事件；`--mode` 为模式、`--permit ask\|allow-once\|allow-session\|deny` 为自动答权限 | 〔一手〕`packages/brain/brain-deepseek/src/session.ts:137`、`:160`、`packages/acp/acp/src/modes.ts:1`、`packages/bundle/brain-cli/src/startup.ts:102` |
| 子 agent | deepseek 装配 delegatedApproval:forward；底座默认 reject（钉 never），forward 继承父审批策略并上送主人，父 agent 不能代批。子结果可叫醒 CLI 自开回合，后台子事件保留原回合归属；当前不流逐条子消息／工具时间线 | 〔一手〕`packages/bundle/deepseek-app/cordis.patch.yml:48`、`packages/subagent/subagent/src/child-agent.ts:227`|
| 取消 | shared 接受已确认的原生中断，只收尾调用时捕获的回合；ACP 通知要等该回合终止。deepseek 的 pause／drain／owner 停后代，preempt／watchdog／hard_limit 当前只停父；close 请求终止并等待；受管范围确认的计划补口见 §4.12 | 〔一手〕`packages/brain/brain-deepseek/src/session.ts:38`、`:205`、`packages/brain/brain-shared/src/session.ts:990`|
| 用量／扩展 | `_liwa/usage` 查累计，`_liwa/children` 查子名单，`_meta.liwa.usage` 报回合与子用量；CLI 自开回合经 `_meta.liwa.turn` 报 started／ended。G1 取消／失败已知用量已在公共层补，D′ 迁入 Manager 时需保留；G4 整轮看门狗仍为宿主前置 | 〔一手〕`packages/bundle/deepseek-app/src/protocol.ts:1`、`packages/brain/brain-deepseek/src/session.ts:80`；两评估 §6 |

**第 2 步实现约束十项**（下表只写当前代码状态）：

| # | 约束与现状 | 依据 |
| --- | --- | --- |
| 1 | deepseek 原生 next_turn 不支持，声明 false，回合边界投递归上层 | 〔一手〕`packages/brain/brain-deepseek/src/provider.ts:64` |
| 2 | 预设不带人格行／complete 段；稳定人设由 personaPrefix，成功工具由 concludeOn 收尾 | 〔一手〕`packages/brain/brain-deepseek/src/session-patch.ts:60`；记录 02 §5.2 |
| 3 | 契约用真 CLI＋脚本化 Messages SSE 模型端点；跨进程不使用绑定进程内格式的 llm-replay | 〔一手〕`packages/brain/brain-deepseek/tests/fixtures/scripted-model.ts:1`；记录 02 §5.3 |
| 4 | acpExtensions 文档归底座 `docs/subsystems/brain.md`，不单开页 | 〔一手〕dev `docs/subsystems/brain.md:1` |
| 5 | jsonl-rpc-process 未迁，Pi／OMP 接入时再迁 | 〔一手〕记录 02 §5.5；Claude／Codex 评估 §3 依赖闭包 |
| 6 | 子会话提权经 delegatedApproval:forward 与根会话路由到主人；默认底座 reject | 〔一手〕`packages/bundle/deepseek-app/cordis.patch.yml:48`；记录 04 M5、06 N3 |
| 7 | brain-acp 在三个 bundle 有默认 disabled 的行，启用必须给 command；仅 mock 线协议已验，别家真 CLI 未验 | 〔一手〕`packages/bundle/brain-cli/cordis.patch.yml:1`；记录 02 §5.7、§8 |
| 8 | `_liwa` 线格式与扩展插件归 `@liwa/deepseek-app` 包根，构建入口只有包根／startup | 〔一手〕`packages/bundle/deepseek-app/src/index.ts:1`、`src/protocol.ts:1`；记录 02 §5.8 |
| 9 | 有 installAnchor 时跟本体安装；没有才回退 PATH liwa，找到安装但入口缺失要报 unavailable | 〔一手〕`packages/brain/brain-deepseek/src/launcher.ts:1`；记录 02 §5.9 |
| 10 | personaPrefix 含双花括号仍会被底座模板插值；notes 不插值。人设生成方需认识这一限制，不声称任意文本逐字注入 | 〔一手〕`packages/brain/brain-deepseek/src/session-patch.ts:60`；记录 02 §5.10 |

公共进程桥归严格编译的 `@liwa/brain/src/process.ts`；shared／acp 的主 tsconfig 严格，只有独立 `tsconfig.paseo.json` 编译迁入源码。问答 codec 属严格自写源码，迁入 ACP 文件只接 schema／content。依据：〔一手〕`packages/brain/brain/src/process.ts:1`、`packages/brain/brain-shared/tsconfig.json:1`、`packages/brain/brain-acp/src/elicitation.ts:1`。

### 4.2 `brain-claude-code`（Claude Code，经 Claude Agent SDK）

第④步已提交 `13a66153`，未合回／未推送；A2 第一轮使用真实 Claude Code 2.1.319，经 DeepSeek Anthropic 端点验证隔离与主流程，后续修复与增加能力以代码／测试为依据，不能把第一轮真机结果扩大到所有组合。研究报告保留其评估时事实，不当现状说明。〔一手〕主人工作记录 13 交回、待写回第 16–19 条；`packages/brain/brain-claude-code/src/provider.ts:20`。

| 项 | 当前实现与冻结边界 | 依据 |
| --- | --- | --- |
| SDK／二进制 | SDK 0.3.263，显式解析本机真实 claude；`binaryArgs: string[]` 位于可执行文件后、SDK 参数前，--version 探测同样带；不用 SDK 自带 CLI；正式下限仍待实测 | 〔一手〕`packages/brain/brain-claude-code/src/config.ts:24`、`src/provider.ts:80` |
| 实例 Key | Config.env 直接配明文 Key，ANTHROPIC_API_KEY／ANTHROPIC_AUTH_TOKEN 必须且只能一个，BASE_URL 可选；装载校验；无 apiKeyEnv/authType/secretEnv/baseUrl、无该包 credentials/launch-environment 接线，不读默认 OAuth | 〔一手〕`src/config.ts:18`、`:177`；主人工作记录 15 |
| 多实例 | 同插件多行，各 impl/label/env/models/禁用工具/binary/binaryArgs 独立，可并行；reclaude 与 z.ai GLM 两行示例仅示意，不含真实 Key | 〔一手〕`packages/bundle/brain-cli/cordis.patch.yml:36` |
| 空壳 | settingSources:[]、strictMcpConfig、独立 HOME/config/securestorage；项目说明类由灵鲸收集并注入，执行类 settings/hooks/.mcp.json 不自动读取；显式本事／MCP／插件／命令钩子由灵鲸注入 | 〔一手〕`src/config.ts:236`、`:310`；A2 第一轮 |
| 当前开放范围 | `mindKind !== work` 在准入拒绝，不能把 CLAUDE_META.compaction='switchable' 当成实例组合已通过长上下文隔离验收；实例／想事／整理要在后续真实组合验收后开放 | 〔一手〕`src/config.ts:273` |
| 模式 | default／plan／acceptEdits／auto；bypassPermissions、dontAsk 拒绝，allowDangerouslySkipPermissions:false；工具范围与模式分别校验 | 〔一手〕`src/config.ts:342` |
| thinking | 模型目录 thinkingOptions 为 off/low/medium/high/xhigh/max/ultracode；现 SessionConfig.thinking、--thinking、setThinking、Meta.thinkingSwitch、view().thinking 与 session.thinking_changed 已实现；切档只在回合之间，未知档拒绝；D′ 合并配置只留 thinkingOptionId、方法对齐 setThinkingOption | 〔一手〕`src/config.ts:61`、`src/session.ts:46`、`packages/brain/brain/src/views.ts:70`；00 §5.1 |
| 配置入口 | 实例 Config 的 skills/mcpServers/plugins/hooks + 会话 plugins/hooks/instructions + 全局四级选择已实现；模型、规矩、MCP、令牌各会话独立快照 | 〔一手〕`src/config.ts:30`、`packages/brain/brain/src/agents-config/index.ts:1`；03-agent-config |
| 问答／会话允许 | selected 保留在 answers，选项备注走 annotations[问题全文].notes；会话许可展示 CLI 窄规则并改写为 session，精确 MCP 使用同一种选项；父不代批子权限 | 〔一手〕`src/session.ts:108`、`:126` |
| 原生子 agent | work 开放 Agent，canonical childId 不与 task_id 混用；后台跨回合保持；pause/drain/owner/hard_limit 先 stopTasks 再 interrupt，preempt/watchdog 只停父；close 收整组 | 〔一手〕`src/session.ts:151`；Claude 评估 §4〔二手〕 |
| 送达 | nextStep:true，流式输入 priority:next；nextTurn:false，由 minds 在回合边界补，不声称 provider 已有 durable next_turn | 〔一手〕`src/provider.ts:23`；00 §5.1 |
| 预算／收尾 | maxTurns 管主循环，不把子任务/helper 算成相同硬限；真实 assistant 主线程帧计推理次数，成功工具与 PostToolBatch 收尾；原生工具总次数硬限不承诺 | 〔一手〕`src/provider.ts:24`、`src/usage.ts:3`、`src/budget.ts:1` |
| 用量／续接 | 同一 UUID 续接；帧账 + result 累计对账，含 token/成本基线，后台子消费归下一结算回合；取消／失败保留已知帧（G1）；num_turns 不作为推理计数；child.ended.usage 可为空，不填零、不重算父已含的子消费 | 〔一手〕`src/usage.ts:1`、`:91`、`src/session.ts:64`；主人工作记录 16–19 |
| 认证失败／diagnostic | probe 默认报静态认证事实，--check-auth 只跑 auth status；stream-json 的 system/api_retry 归 diagnostic；401/403 立即失败，不等十次退避；错误与 stderr 经已知秘密脱敏；第三方端点 providerReportedCostUsd 只展示不当实价 | 〔一手〕`src/diagnostics.ts:1`、`src/usage.ts:3`；主人工作记录 16–17 |
| 不做 | Claude fast mode/feature 接线与 SDK 自定义 agents 配置入口不做；Manager 通用 setFeature 接口保留不等于 Claude 开放 | 〔一手〕主人工作记录 19；`src/config.ts:18` |

### 4.3 `brain-codex`（Codex app-server）

| 项 | 做法与边界 | 依据 |
| --- | --- | --- |
| 来源／二进制 | 迁 Paseo 8 个生产文件原始 10,131 行，已有 35 个 shared 复用；用 PATH 本机真实 codex app-server，评估版本 0.163.0，正式下限待 A3；不用 Codex daemon/proxy 代替灵鲸宿主 | 〔一手〕Codex 评估 §2–3；handoff 决策 60 |
| 进程 | 每会话一个、全部走 launch.spawn；提供方不自行脱管或 unref。底座 POSIX detached:true 用于建立受管进程组，保留底座所有权与终止阶梯 | 〔一手〕`packages/subprocess/subprocess-local/src/spawn.ts:448`；Codex 评估 §2 |
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

Paseo ACP 客户端、GenericACPAgentClient 与五个厂商 shim 已迁入 brain-acp，SDK 1.4；严格 adapter／elicitation 负责契约与问答编解码，迁入文件只接线。插件一行一个 impl，默认 disabled，启用时必须配置 command；通用 ACP nextStep:false 恒 unsupported，原生 nextTurn 行为须按能力声明。真 deepseek 通路与 mock ACP 契约已验，Gemini／OpenCode 等真实 CLI 未验；不把厂商 shim 存在算作已经接通。ACP 标准无人设字段，别家提供方的指令注入与空壳子能力要逐家验证，做不到的组合拒绝。依据：〔一手〕`packages/brain/brain-acp/src/adapter.ts:1`、`src/index.ts:1`、`src/elicitation.ts:1`。

### 4.5 子 agent：Paseo 的方式怎么落到灵鲸

**Paseo 怎么做**〔一手，`paseo-upstream@8018231a:public-docs/mcp.md`、`docs/agent-lifecycle.md`、`…/agent/mcp-server.ts`、`finish-subscriptions/index.ts`、`agent-messages/`〕：给每个 agent 挂一个 MCP 服务器（`/mcp/agents`，支持原生工具的提供方直接注册），工具有 `create_agent`（`provider/model`、`initialPrompt`、`workspaceId`、`settings`、`notifyOnFinish`）、`send_agent_prompt`、`get_agent_status`、`get_agent_activity`、`list_agents`、`cancel_agent`、`archive_agent`、`kill_agent`、`update_agent`、`set_agent_mode`、`list_pending_permissions`、`respond_to_permission`，再加工作区、终端、调度、档案、提供方几组；子 agent 由标签 `paseo.parent-agent-id` 挂在父下、父归档级联；创建一律异步；`notifyOnFinish` 默认 true，完成 / 出错 / 权限请求以 `<paseo-system>` 信封的 agent 消息投给父（2 秒安静窗口合批，父在跑就 steer）；订阅意图持久化在 `finish-subscriptions.json`、至少一次；父可以 `respond_to_permission` 代批；CLI 自己的子 agent（Claude `Agent`、Codex 协作）只观测，存描述符与只读时间线；还有一条 CLI 路：agent 的 shell 里跑 `paseo run --provider codex --no-wait`，子 agent 进同一工作区。

**灵鲸的两条路**（主人定："默认走自己的 agent 子机制，然后通过 paseo 可以调用其他 cli 的子 agent"；"原生子 agent 干活的活里放开，只观察"）：

| | 路 ① 提供方自己的子 agent（默认） | 路 ② 跨 CLI 子活 |
| --- | --- | --- |
| 谁能用 | **只有干活与查资料的活**（`childPolicy.native` 只对 `work` 为 true）；实例、想事、自己的事、整理一律没有 | 干活活与想事·立场类（`spawn` 在工具档里，任何提供方） |
| 怎么开 | `deepseek`：底座 `tool-subagent`（`subagent{ prompt, description, cwd?, agentPreset? }`）+ `tool-subagent-control`（`send_message`、`interrupt_agent`、`list_agents`），spawn（空对话）或 fork（带父已完成轮次）进程内后端；Claude：`Agent` 工具；Codex：协作 agent 工具。CLI 怎么调度、几个并发，按各家自己的规则，灵鲸不干预 | 内核工具 `spawn(执行者, 交接包)`（`overall.md` §5.2 已有）+ `look(活号)` + `answer(活号, 答复)`（给干活活开放、限自己的子活） → toolport → tasks 开子活（`tasks.open{ 父活, 种类, 执行者 }`）→ minds → minds 的 create-agent/create + createAgent 在指定提供方上开会话 |
| 人设 | `deepseek`：进程级 `personaPrefix` 是全局段，子 agent 的 scope 自动继承；Claude / Codex 的原生子 agent 不带她的人设——它们是父活的执行细节，不对外说话、不写账本、不进第三层，产出只经父活回到她（决策 5 的边界由此守住） | 子活是第三层的活，按 §4.2 / §4.3 注入 |
| 归属 | 父活的内部细节：不登记成第三层的活，不进看板；`brain_child{ native-child }` 登记 | 第三层的活，`父活` 字段指向父；归属实例与父活相同（`four-layers.md` §2.7） |
| 观察与记录 | 三家都翻成 `child.started{ childId, label, provider, parentChildId? }` / `child.ended{ stopReason, usage }`：`deepseek` 从 `ctx.subagents` 的 `subagent/start\|end` 经 `_meta.liwa`；Claude 从任务协议（`task_*` 消息）；Codex 从 `collabAgentToolCall` / `subAgentActivity` 条目。brains 写 `brain_child` 与 `brain.child.*` 事件；主控台的活页能看到子 agent 的名单、状态与用量（只读） | 全是第三层事件（`task:<子活>` 流） |
| 回报 | 按各家自己的方式回到父（`deepseek`：结果作为父的下一步输入；Claude：`task_notification`；Codex：`wait`）；灵鲸不插手 | 子活的 `report` / `ask` / `ended` 事件经 tasks 投给父活（`next_turn`，合批）；父活 `answer` 回问 |
| 预算 | 子 agent 可跨父回合，支出归父活；父总量与子分项不得重复累加，后台末尾口径待 ⑩／⑪，实时 childId 等 G3；`childPolicy{ maxDepth, maxConcurrent }` 只有 `deepseek` 能在服务端 `setup` 限死（底座 `delegationDepth`、`maxDepth`），Claude / Codex 靠各家可兑现能力；Codex 不承诺推理／工具硬限，公共整轮看门狗待 G4 落实，不能把它写成已有兜底 | 子活有自己的 `limits`，从父活预算里划；tasks 记账 |
| 权限 | 子 agent 的权限请求经父会话的同一条路上报、带 `childId` → `task.permission` → 直推主人（**父活不能代批**：Paseo 让父代批，弱模型替主人做安全决定不合适） | `task.permission` 直推主人 |
| 清理 | 父会话 `cancel(pause \| drain \| owner)` 先停子 agent 再停主回合；`cancel(preempt \| watchdog)` 只停主回合；hard_limit 的统一子清理策略待定（deepseek 当前只停父）；`close` 杀整个进程组；父活 `manage(stop)` 一并停；未收到 `child.ended` 的在 `session.closed` 时补记 `ended{ stopReason: 'aborted' }` | 父活结束时 tasks 级联 `manage(stop)` 子活；孤儿由 brains 的 `brain_child` 对账 |
| 不做 | — | Paseo 的 CLI 路（活的 shell 里起别的 agent）：绕开令牌与权限链，不开放 |

她看到的 MCP 服务器名为 `liwa`，工具词汇以 overall.md §5.2 为唯一来源；Paseo 处理器代码与测试里的原名不改。`@liwa/toolport-minds/src/catalog.ts` 做模块边界的接口适配并经 `ctx.toolport.register` 登记，不是一层保留旧接口的兼容机制。〔一手〕主人工作记录 20 C6；〔推理〕接线。

| 灵鲸工具／变体 | 搬来的 Paseo 处理器 | 暴露范围 |
| --- | --- | --- |
| spawn(执行者,交接包) | create_agent + notifyOnFinish 订阅 | 按工具档与子归属校验，创建前持久订阅意图 |
| look(活号) | get_agent_status + get_agent_activity | 限可见活与自己的子活 |
| look(执行者) | list_providers／list_models／inspect_provider | 只给安全目录／诊断，不泄漏实例 env |
| look(路径) | 不走 Paseo，交文件能力 | 不硬塞到 get_agent_activity |
| look 的 agent 列表／待答变体 | list_agents／list_pending_permissions | 只读与当前调用者可见范围；主人 CLI 可看完整清单 |
| answer(活号,答复) | send_agent_prompt | 普通子活回问／消息；主人权限审批另走 permit，不能代批 |
| manage(stop) | cancel_agent | 业务停止按 tools/minds 策略处理，不称永久删除 |
| manage(archive) | archive_agent | 权限与停稳检查后归档 |
| manage(update) | update_agent／set_agent_mode | 不越过实例禁用工具与模式 |
| 不给 agent／不进 CLI | respond_to_permission、detach、kill_agent | 权限答复只给主人 permit；detachAgent 和 kill_agent 的代码搬但不公开，kill_agent 实际调 closeAgent、保留记录 |

依据：〔一手〕底座 `tool-subagent/README.zh.md`（"外部后端执行一次任务，并通过完成通知返回最终回答"）、`tool-subagent-control/src/{index,list-agents}.ts:30,76,82`、`subagent-spawn-in-process/README.zh.md`、`subagent/src/types.ts:31-66,136-186,287-356`（`SubagentActivationSpec.delivery: 'parent' | 'caller'`、`maxDepth`、`agentPreset`）、`core/agent/src/index.ts:66`（`meta.delegationDepth`）；Paseo `docs/agent-lifecycle.md`"The subagents track"（提供方子 agent不插进 AgentManager，只存描述符与只读时间线）、`provider-subagents/store.ts`；`paseo-architecture.md` §3"不要默认代批"；决策 5、14。〔推理〕路 ② 用 `spawn` 而不照搬 `create_agent` 全家桶：灵鲸的活有归属实例、受众、交接包与核验，这些 Paseo 没有，"活管子活"比"agent 管 agent"少一套平行的生命周期。

### 4.6 外部 CLI 配置：空壳子，内容由灵鲸注入

被干活仓库的文件按说明类／执行类区分：说明类由灵鲸受控读取，执行类 `.claude/settings*.json`、hooks、`.mcp.json` 不自动读取；个人 home 下的说明与配置不读取。Claude 的 `settingSources: []` 保持空壳；`projectDocs` 控制全部项目说明与文件式 agents／commands／skills 的导入，不开启 CLI 的 project/local 源。共享纯收集器 `collectProjectDocs` 的规则只归 brain，文件读取由同包 readProjectDocs 完成。〔一手〕`packages/brain/brain/src/project-docs.ts:1`；主人 11-11（决策 71）。

静态层从 git 根走到 cwd；无 git 根只读 cwd。每级依次收集 CLAUDE.md（没有时才用 AGENTS.md）、.claude/CLAUDE.md、无 paths 前置条件的 .claude/rules/*.md、CLAUDE.local.md，按 realpath 去重。@路径 导入限制在 git 根以内，跳过代码块与行内代码，越界／循环／缺失／超深明确失败；深度上限 5，根深度为 0。每段标来源相对路径，完整系统注入超 instructionsMaxBytes 拒绝而不截断。〔一手〕`packages/brain/brain/src/project-docs.ts:13`；SDK 0.3.263 随附 CLI 的 wgs=5（字节 166218052）与 lD 的 d>=wgs（字节 166218669）。

子目录说明与带 paths 的规则在 SDK PreToolUse 首次触及相应文件路径时按需注入 additionalContext；每份每代会话一次，先记录含全文的 session.project_document，单份超限或读取失败发 session.project_document_failed 且不注入。文件式 agents、commands、skills 与实例、agents.yml 选择的材料合成会话快照插件，同名冲突报出两处来源。MCP 和 settings 写会话快照内的 0600 文件，以文件路径传参，关闭无论成败均清理。〔一手〕`packages/brain/brain-claude-code/src/project-context.ts:1`、`src/config.ts:1`、`src/session.ts:1`。

kernel 模式下，主人对某原生工具选了会话窄规则后，本会话该工具交 CLI 判定：命中规则与 CLI 自带的工作目录内只读命令放行，其余仍上送主人。未选规则的工具继续强制 ask；MCP 精确名会话许可仍由钩子 allow；子 agent 同名工具相同。provider 模式直接交 CLI 匹配会话规则，不自写规则解析器、不写 settings 权限规则。〔一手〕2026-11-11 真机核实（claude 2.1.322）；`packages/brain/brain-claude-code/src/budget.ts:1`。

| 提供方 | 受控来源与隔离 | 真机验收边界 | 依据 |
| --- | --- | --- | --- |
| Claude Code | CLAUDE_CONFIG_DIR 与 securestorage 根固定到成员／impl，SDK 明确禁用 CLI 自带来源，灵鲸设置／自有 hooks／MCP 显式传入；不加 project/local；strictMcpConfig 限制 MCP | settingSources、memory、插件与 hooks 有不同入口；claudeMdExcludes 不能隔离 settings。设备身份等固定 home 读取路径须文件访问审计；不能用 disableAllHooks 破坏自身收尾钩子 | 〔一手〕Claude 评估 §5、§10；`S:sdk.d.ts:2075`、`:8144`；`C:bin/claude.exe:2386243` |
| Codex | CODEX_HOME ＋单独 HOME；project_doc_max_bytes=0 关原生项目文档自动注入，developerInstructions 注入灵鲸内容；配置／skills／系统管理层另逐项禁用或隔离 | CODEX_HOME 不能独自隔离 HOME/.agents、项目技能与系统设置；untrusted 与文档注入分开；0 不是禁止原生工具主动读文件，不能声称是文件系统沙箱 | 〔一手〕Codex 评估 §5；〔二手〕官方 0.163 agents_md、host_roots、local loader |
| deepseek | 已实现每会话 LIWA_HOME、LIWA_AGENTS_HOME 隔离、会话 patch 与规矩；projectDocs 控制内置指令／本事来源 | 自建 CLI 的现状见 §4.1；它的受管指令机制属于灵鲸，不能据此推导外部两家也已隔离 | 〔一手〕`packages/brain/brain-deepseek/src/session-patch.ts:66`、`src/provider.ts:173` |
| 其他 ACP | 各提供方通过配置变量与原生接口隔离并注入 | 逐家验，不能只凭 home 环境变量承诺全部隔离 | 〔一手〕；〔推理〕 |

“配置由灵鲸拥有”不等于把整个状态目录设为只读：CLI 仍需写自己的转录、索引与缓存；会话令牌、模式、权限与模型按会话覆盖，不能反复覆写成员共用配置导致并发串用。每个 impl 分开配置根与认证，删除一个会话只删其确定资料，不误删同实例其他会话。子进程环境先剥凭据再显式注入，ResumeHandle、日志与 argv 不含秘密。Key 按主人已定方案写提供方实例 env，见 §4.10。依据：〔一手〕两份评估 §5；`packages/brain/brain/src/provider.ts:149`；〔推理〕并发与删除边界。

验收用假的全局／项目配置、hooks、skills、插件、MCP 分别放哨兵并审计实际文件访问；不以“没有新文件”证明“没读取”。若本机真实 CLI 证明不了空壳子隔离，停止并问主人，不静默放宽。两家 V1 首先用 Key，不复用主人默认 OAuth 身份；全局集合与四级选择已实现，文件规范与各家支持边界见 [03-agent-config.md](03-agent-config.md)。依据：〔一手〕handoff 决策 57–58；两份评估 §8。

### 4.7 人设注入与前缀（按提供方）

| 提供方 | 稳定前缀 | 会话说明 | 每轮前缀 | 续接后 |
| --- | --- | --- | --- | --- |
| deepseek | 会话 patch 的 `personaPrefix`（进程级，一次；子会话继承） | `_meta.liwa.notes` → agent 作用域段 | 提示词最前的 `<liwa-block name="前缀">` | 同一目录重拉进程 + `session/resume`，身份探针 |
| claude | 自定义 `systemPrompt` / 预设 + `append` | 同上拼进去 | 同上 | `resume` + 同一份 `systemPrompt`，身份探针 |
| codex | `developerInstructions` | 同上 | 同上 | `thread/resume` 再带，身份探针 |
| 别家 ACP | 指令文件或前缀 | 同上 | 同上 | 同上 |

提供方只拼一份最终系统注入：`persona.stable → rulesDocument(rules) → instructions → 受控项目正文 → persona.notes`，notes 始终在末尾。agents.yml 各级指令先由解析器合成 instructions，不在 AgentManager 再 append；work 映射为 claude_code preset 的一份 append，其他提供方映射至各自原生字段。总字节超限拒绝、不截断。〔一手〕`packages/brain/brain-claude-code/src/config.ts:284`；〔推理〕冻结注入顺序。

### 4.8 Paseo 迁移的方法与落位

**方法**（决策 1、28；`engineering.md` §9 末条；主人定"原地改 + NOTICE"）：固定 `8018231a`；每个文件原样拷进目标包的 `src/paseo/<原相对路径>`，文件头加来源行；**原地改**需要改的行，不叠映射层；每包 `NOTICE` 写来源与提交、Apache-2.0 链接、逐文件改动摘要（Apache 4(b) 标注改动、4(c) 保留声明；上游无 `NOTICE` 文件〔一手，`paseo-upstream@8018231a:LICENSE`〕）；根 `THIRD_PARTY_NOTICES.md` 加条目。`src/adapter.ts` 只做类型映射（`AgentSession` → 契约句柄、`AgentStreamEvent` → `BrainEvent`、`AgentPermissionRequest.actions` → `options[]`、`AgentUsage` → `Usage`、提供方子 agent 描述符 → `child.*`）。依赖映射：`utils/spawn` → `ctx.subprocess.spawn`；`tree-kill` → `SubprocessHandle.terminate()`；`executable-resolution` → `ctx.subprocess` 的可执行解析；pino → cordis logger；`@getpaseo/protocol/*` 五个小文件拷进 `brain-shared`；`@agentclientprotocol/sdk` 升 1.4.0；`lru-cache`、`zod` 4 保留。落位逐项见附录 A。

### 4.9 包划分与进程模型

本表是决策 67 的计划包边界，B′ 才建包。服务定义必须是 Cordis `Service` 类；提供方实现能力，消费方经公开 API 使用它；可替换策略各自一个插件行，不能由 minds 构造函数一口气 new 成不可关的大包。所有登记跟随 effect；拷入文件逐个记 NOTICE，`tsconfig.paseo.json` 编译 `src/paseo/`；minds 与 toolport 另将迁入源码直接引用的纯类型 `src/seams/` 列为输入，主项目仍独立严格检查这些接口。其余灵鲸自写源码保持主项目的严格检查。〔一手〕`docs/glossary.md:9`、`packages/brain/brain-shared/NOTICE:16`；主人工作记录 19 §2.7、20 C11。

| 包／seam 角色 | 搬来的文件（省略 agent/ 与 .ts） | 灵鲸文件／inject |
| --- | --- | --- |
| `@liwa/minds`，`packages/brain/minds`；会话运行服务定义 + 实现 | `src/paseo/agent/`：agent-manager、agent-run-state、agent-stream-coalescer、agent-projections、agent-loading、agent-archive、agent-storage（schema/接口）、agent-owner、agent-prompt、lifecycle-command、permission-response、directory、create-agent/{create,intent}、create-agent-title、finish-subscriptions 全组、agent-messages 全组、rewind/rewind、stale-provider-session-error、prompt-attachments、activity-curator、timeline-prompt-index、host-operations/index（只本机）、provider-snapshot-manager、mutable-provider-config-owner、agent-configuration-validator、mcp-shared；另迁 server/persistence-hooks、client-message-id、path-utils、atomic-file、json-utils 与 daemon-config-store 的配置纯函数摘录到保留相对层级的位置 | `src/index.ts`（Service、Config、minds.*.v1）、storage.ts、timeline.ts、delivery.ts、gen.ts；inject brains、storageDomain、sessionPersistence、sessionProjections、subprocess；不 inject toolport |
| `@liwa/toolport`，`packages/brain/toolport`；内核工具登记服务定义 + MCP 端点提供方 | `src/paseo/agent/{mcp-server,tools/paseo-tool-serialization}.ts` | `src/index.ts`（路由、Bearer/代次）、registry.ts；inject minds、底座 webserver；ready 时向 minds.attachToolport 登记能力 |
| `@liwa/toolport-minds`，`packages/brain/toolport-minds`；工具消费方／toolport 贡献提供方 | `src/paseo/agent/tools/paseo-tools.ts` 的 agent 工具处理器组，保留内部 Paseo 名 | `src/catalog.ts`（spawn/look/answer/manage 参数 → 处理器）、index.ts；inject minds、brains、toolport；向 toolport.register 登记 |
| `@liwa/minds-restart-recovery`，`packages/brain/minds-restart-recovery`；可替换恢复策略消费方 | `src/paseo/agent/restart-recovery/index.ts` | src/index.ts；inject minds、storageDomain；只经 minds 的存储业务 API，不另 open 同名 domain |
| `@liwa/minds-idle-cleanup`，`packages/brain/minds-idle-cleanup`；可替换回收策略消费方 | `src/paseo/agent/idle-runtime-cleanup/index.ts` | src/index.ts；inject minds；候选与 close admission 仍归 Manager |
| `@liwa/minds-structured-generation`，`packages/brain/minds-structured-generation`；结构化生成服务定义 + 能力提供方，消费 minds/brains | `src/paseo/agent/{agent-response-loop,structured-generation-providers}.ts` | src/index.ts；独立 `ctx.structuredGeneration`，inject minds、brains；调用方为 output-schema 命令／后续整理活 |
| `@liwa/brain`，现有提供方服务定义／登记表 | B′ 不动；D′ 产出提供方表快照给 minds；provider-registry/provider-runtime 不搬 | index.ts 登记表产生 clients/providerDefinitions 快照，撤登记触发 minds 停对应会话；agents-config、probe、prepareConfigDir、blobs 留此包；inject subprocess |
| `@liwa/brain-shared`；共享库 | 已搬类型、timeline projection/store/types、provider-subagents、runtime MCP；新增 agent/tools/types、agent/paseo-tool-policy 与协议子集见附录 A | 事件纯 reducer、turn-input、logger；不登记服务 |
| `@liwa/brain-cli` 与 brain-host bundle；装配／命令消费方 | 不搬 Paseo daemon 壳 | H′ 才把 run 改走 minds；此前保持一次性 run；宿主装配草案见 01-brain-host §4.1 |
| brain-acp／brain-deepseek／brain-claude-code／brain-codex | 各自提供方 src/paseo；共用类型只引 brain-shared | 提供 BrainProvider；testkit 同契约；deepseek-app 每会话一个独立进程 |

host-operations 是19草稿 §1.1 要搬而 §2.7 包表漏列的文件，归 minds 的本机分派；客户端／远端观察分支删。`client-message-id.ts` 也按原相对层级搬入 minds。finish-subscriptions 保留核心，因为它与 durable delivery 的通知意图、ACK、至少一次和回收否决共同构成可靠性，不是另开一套可随意失效的消息平台。〔一手〕Paseo `agent/host-operations/index.ts:1`、`agent/finish-subscriptions/index.ts:21`；〔推理〕落位。

| 包 | Config 字段草案（实现时由 schemastery 校验并显式 resolve） |
| --- | --- |
| minds | `storageRoot`：与 json.root 同根；`eventsRoot`：JSONL 后端根；`collectWindowMs`：人类连发窗口（初值 1000）；`batchWindowMs`：非链优先窗口（30000）；`batchMaxItems`／`batchMaxChars`：每批上限（20／8000）；`pendingMaxPerOwner`：队列上限（200，满时报错不丢）；`agentStreamCoalesceWindowMs`：增量合并（60）；`logBatchMs`／`logBatchBytes`：文字日志刷新阈值（实现任务量后给默认）；`lastActivityWriteMs`：摘要节流间隔；`rescueTimeouts.reloadSessionCloseMs`／`interruptSessionMs`：reload/interrupt 救援上限（3000/2000）；`watchdogMs`／`hardLimitMs`：没有会话覆盖时的整轮时限（60000/120000），不是 rescueTimeouts；`finishRetryDelayMs`／`finishRetryMaxMs`：通知重试退避（1000/5000）；`retiredInternalTtlMs`：内部结果缓存期（600000）；`timelineContentMaxChars`：时间线内容上限；`operationRetentionMs`：回执保留期；`catalogRefreshTimeoutMs`、`diagnosticTimeoutMs`、`catalogConcurrency`：目录刷新时限／诊断时限／并发，显式配置，不保留隐藏环境变量默认 |
| minds-restart-recovery | `enabled`：恢复策略开关，默认 true；`prompt`：继续提示（默认 Resume working.）；禁用该插件行等效关闭自动续跑，并消费旧 intent，不留待启用后复活 |
| minds-idle-cleanup | `idleAfterMs`：闲置阈值（3600000）；`sweepIntervalMs`：扫描周期（60000）；`probeTimeoutMs`：提供方否决检查时限（10000）；禁用该插件行取消扫描，已开始关闭照常结算 |
| minds-structured-generation | `maxCorrections`：同一操作最多纠正次数（2），每次都是正常计费回合，不通过关停/权限/预算限制 |
| toolport | `listen`：使用底座本机 HTTP 挂载方式（复用回环 webserver）；`route`：默认 /mcp/agents；`tokenTtlMs`：令牌有效时长，ready 时显式 resolve；`toolTimeoutMs`：调用等待上限（10000），超时副作用结果不明不得重调 |
| toolport-minds | 无部署 Config；业务选择由当前 agent、工具 schema 与执行点权限提供 |
| brain | 现有 membersRoot/blobsDir/probeTimeoutMs 等 |

可调值进对应 Config，而非保留搬来的 DEFAULT 常量或只给测试用的钩子。结构化生成 `ctx.structuredGeneration.generate(request)` 输入 provider 选择、agentConfig、prompt、schema，输出校验后的 JSON 与 agentId/operationId；显式传 agentId 时复用同一会话，默认临时 internal agent。output-schema 命令创建的公开 agent 仍在原 operation 下纠正，不暗开无归属 helper。〔一手〕Paseo `agent/agent-response-loop.ts:62`、`agent/idle-runtime-cleanup/index.ts:32`；〔推理〕Config 与独立服务键。

进程模型：本体一个，每个 deepseek／claude／codex app-server／其他 ACP 会话一个受管 CLI 进程，全部经 BrainLaunchContext.spawn → subprocess；持久监管与出生屏障在原 subprocess seam。H′ 前 `liwa brain run --provider <impl> [--model <id>] [--thinking <id>]` 仍开一会话、跑一回合并关闭；H′ 改走 minds，冷读不启动 CLI。〔一手〕`packages/bundle/brain-cli/src/startup.ts:81`、`packages/brain/brain/src/session.ts:420`；〔推理〕。

### 4.10 同一个 CLI 多个提供方

同一个插件在 cordis.yml 挂多行，每行一个不同 impl，分别给 label、模型列表、环境、禁用工具、二进制覆盖；一行就是独立提供方实例，可同时开会话。不是复制插件包，也不把 CLI 类型写死成所有会话共用一个身份。Claude Code／Codex 沿 brain-acp／brain-deepseek 的一行一实例形状，配置与认证根按 `<成员>/brains/<impl>/` 分开。依据：〔一手〕handoff 决策 57；`paseo-upstream@8018231a:public-docs/custom-providers.zh-CN.md:1`；`packages/brain/brain/src/provider.ts:158`。

Paseo 自定义提供方的 extends(claude/codex/acp)、label、env、models、disallowedTools 与二进制覆盖是功能参照，灵鲸用插件装配与 impl 表达；具体字段 schema、缺省解析和模型目录 API 在各自设计中明确。Claude Code／Codex 首版 Key 明文写所选提供方实例 env；Claude 必须且只能给 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN 之一，可配 ANTHROPIC_BASE_URL，装载时校验。凭据库／登录接法以后另定，不默认 credential-ref。值仅向对应进程注入，不进 agent JSON／resume／argv／日志。稳定成员/impl 身份根与不可变材料 revision、每会话 LaunchSpec 分开；模型／规则／MCP 令牌不能靠覆写共享根注入；安全值 reload 对新会话生效，结构性插件变动须 restart。〔一手〕handoff 决策 65；`packages/brain/brain-claude-code/src/config.ts:144`；决策 68；〔推理〕实现分工。

### 4.11 公共层 G1–G4

| 缺口 | 已有事实／搬运所得 | 余下交接 |
| --- | --- | --- |
| G1 取消／失败已知用量 | 随④已做，异常 terminal 可带 usage、每 turn 首次终止幂等结算；Claude 帧账与累计账对账，子分项不重加 | D′ 将提供方已知 terminal usage 保留到 AgentStreamEvent，Manager 更新 lastUsage；lastUsage 是最近快照，账本仍按 turn 结算，不从 usage_updated 盲加消费 |
| G2 跨回合待答 | Manager.pendingPermissions 是会话级 Map，respondToPermission 返回 AgentPermissionResult.followUpPrompt；搬运保留这些能力 | 不是“搬来就全好”：原生取消／失败路径仍会拒绝 pending；须区分 session/turn/child lifetime、保留 idle 问题，响应幂等与旧代失效；followUpPrompt 经同一 durable delivery/准入。③先接消费面，⑤ Codex 完整验证 |
| G3 实时子用量 | provider_subagent 记录原生孩子，usage_updated 上报用量，但当前 usage_updated 没有 childId，不能由这两类事件自动关联出计费归属 | ⑤增加显式 childId/原生 thread/turn 关联与完整度，实测父 total 包含关系；未知不填零、不把后台消费伪归旧回合；Claude 当前后台尾量进入下一结算回合 |
| G4 整轮看门狗 | 当前 limits.watchdogMs 仅声明；Paseo rescueTimeouts 只管理 reload close／interrupt 救援，不是 watchdog | 在 minds 回合包装的 turn_started（包括自主回合）上捕获 agentId/gen/turnId，以 limits.watchdogMs 与可选 hardLimitMs 计整轮，包含待审批时间；到点检查仍是捕获轮，再调 cancelAgentRun，terminal/close/换代清 timer；refused/结果不明维持 stopping，不取消后来新轮 |

依据：〔一手〕`packages/brain/brain/src/contract.ts:397`、`packages/brain/brain-claude-code/src/usage.ts:1`；`paseo-upstream@8018231a:packages/server/src/server/agent/agent-manager.ts:432`、`:3309`、`:3347`、`:4675`、`:4989`；〔推理〕C9。G4 与原存储 seam 的 per-record 严格读取仍是③对外开放的前置，在 D′/G′ 安放实现，不在 brains 与宿主各留一个 timer。G2/G3 的完整提供方接线随⑤；问题补充文字标志、Codex ephemeral 选择仍待定。

### 4.12 第 3 步的提供方义务与窄补口（计划）

这些是已确认的实施方向，**尚非当前接口**；字段／方法增量只在 [00-contracts.md](00-contracts.md) §5.1 的计划表维护。第④步 Claude 使用现有 create/start/subscribe/persistence，G1 一并完成，不等待这些宿主补口。〔一手〕`packages/brain/brain/src/provider.ts:77`；handoff 决策 65、66。

| 义务 | 提供方／公共层的计划责任 | 当前缺口依据 |
| --- | --- | --- |
| 创建前持久观察 | owner 在 provider 初始化前安装持久 sink 或有界开场缓冲；重要回执等 durable 屏障；连接断开不撤任务 owner | 〔一手〕`packages/brain/brain/src/index.ts:491`、`:505` |
| 续接句柄通知 | 原生 UUID/threadId 延后成为可恢复事实时可靠通知；仅发无秘密句柄，创建／终止／关闭再核对；无句柄不伪造 resume | 〔一手〕`packages/brain/brain/src/provider.ts:113`；〔二手〕`docs/liwa/research/2026-11-05-claude-code-adaptation.md:330` |
| 可靠停稳 | 先登记身份与归属后放行；terminate 后等 waitForExit；关失败保留可清理状态、拒新代，不能吞退出超时再 closed | 〔一手〕`packages/brain/brain/src/session.ts:803`、`packages/subprocess/subprocess/src/types.ts:188` |
| 模型目录／诊断 | provider 自己供应 catalog 与 installed/version/config/auth 分项；默认不发模型提示、不扫个人 home；probe 与运行用同一真实 executable | 〔一手〕`packages/brain/brain/src/provider.ts:60`；`paseo-upstream@8018231a:docs/providers.md:118` |
| 资源／后台 | 通用 subprocess 采样与出生身份核对；provider 报活动／unknown／回收否决，不以父 idle 推导后台为零 | 〔一手〕`packages/brain/brain/src/session.ts:751`；〔推理〕 |
| 原生材料清理 | provider 注册精确会话／孩子材料清理 API；不删成员共用根和凭据；Codex 尊重线程索引，不只猜 jsonl 路径 | 〔二手〕`docs/liwa/research/2026-11-05-codex-adaptation.md:373`；〔推理〕 |
| 配置与账号报告 | 每 impl 安全配置 revision、不可变启动材料；Key 来自所选实例 env；可选账号用量报告只能访问选定身份，没有数据就 unavailable | 〔一手〕`packages/brain/brain/src/process.ts:223`；〔推理〕 |

原生进程重开、诊断进程和清理辅助进程都经 launch/subprocess 登记，不自行脱管；AgentManager 层按决策 67 搬进 minds，AgentStorage 接口/schema 搬、实现换 storage-domain；daemon 认证壳与 fs 存储不搬。会话与回合策略只归 [02-minds.md](02-minds.md) §4.0；宿主／CLI 见 [01-brain-host.md](01-brain-host.md)。〔一手〕handoff 决策 62、65；〔推理〕。

## 5 交互时序

以下为完整第二层的目标时序。第③步基于 AgentManager 的 direct 宿主的 run/attach/permit/restart 见 [01-brain-host.md](01-brain-host.md) §5；最小 minds、持久登记、跨重启恢复与孤儿清理由该阶段实现，完整 context/toolport/tasks/guard 与网页接公共层按第二层阶段推进。当前一次性 CLI 仍可用于第④步 Claude 验收。〔一手〕handoff 决策 65、66；`packages/bundle/brain-cli/src/index.ts:308`。

**第三层：`tasks.open` → 活会话**。tasks 裁好工具档与交接包 → `minds.openTask` → minds 从 roster 取 `{ impl, model?, fallback }` → `toolport.issue` 拿令牌 → `brains.prepareConfigDir` → `minds.createAgent(cfg)`（`owner{taskId, gen}`、`mindKind`、`persona`、`cwd` = worktree、`configDir`、`projectDocs`、`kernelTools`、`nativeToolPolicy`、`permission{ kernel }`、`compaction`、`limits`、`concludeOn`、`childPolicy`）→ minds 通过受管 launch 登记进程、经 `ctx.subprocess` 拉起（deepseek：`liwa --profile deepseek --patch`；claude：SDK `query`；codex：`codex app-server`）、握手 → `session/new` / `query` / `thread/start` → 句柄交回 → `minds.streamAgent(agentId, 交接包)`。之后：`tasks.send` 四种类型 → `deliver(next_turn)` / `deliver(next_step)` / `cancel` / 高优先 `next_turn`；`permission.request` → `task.permission` → 主人 → `respondToPermission`；活里开自己的子 agent → 路①（brains 只观察登记）；活里 `spawn` → 路②（toolport → `tasks.open{父活}` → 同一条链再开一个会话）；结束 → `close`（进程一起关）→ `toolport.revoke`。

**第二层：实例会话**。minds 重建 → 同上 `createSession`（`mindKind: 'instance'`、`nativeToolPolicy: 'none'`、`compaction: 'off'`、`concludeOn: ['reply','no_reply','say']`、`childPolicy.native: false`，默认 impl `deepseek`）→ 补投。每条输入：投递器合批 → `deliver(next_turn, wake)`（deepseek 的 next_turn 为 unsupported，由投递器在边界改调 `startTurn` → `session/prompt`）；主人对自己回合的追加 → `deliver(next_step)`（deepseek：`_liwa/steer`）；抢占 → `cancel(preempt, keepQueue)`；看门狗 → `cancel(watchdog)`；换新或换提供方 → `close` + 新代 `createSession`；回收 = 关进程保留目录；再醒 → 先试 `resumeSession`（同一目录重拉进程 + `session/resume`），续接后身份探针，答不对就换代重建。

**恢复**：本体重启 → minds 按 02 §2.6/§4.0 捕获恢复 intent、对账日志／进程、失效旧代 pending，再由可禁用 restart-recovery 策略决定合格 running 的续跑；唯一生命周期属于 Manager，brains 不另做 recover。

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

brains 零模型调用。每个活会话一个进程；deepseek 第 2 步源码启动中位 736 ms／315 MB、构建产物 490 ms／265 MB；两轮修复最终测量 744 ms／316 MB、496 ms／264 MB，steer RPC 1 ms、工具结束到次步 24 ms、取消 3 ms（真模型 6 ms）。11-05 同时 10 个进程实际约 2.37 GB、平均 237 MB；并发负载观测与单进程 RSS 口径不同。实例常驻摊薄启动，想事新开要算进延迟，是否预热待定。依据：〔二手〕既有验收记录；任务书 03 的实测数字。

用量按提供方真实累计／差量语义结算，子分项不再加到已含子的父总量，未知留空；G1／G3 完成前明确总计缺口。token、自报美元估价、账号额度窗口是不同口径；guard 在第二层按单价与预算准入，不能把换目录视为独立计费额度。依据：〔一手〕两份评估 §4／§6；`packages/brain/brain/src/views.ts:124`；〔推理〕汇总边界。

## 8 安全与隐私

令牌只在 `SessionConfig` 与内存，按代次作废；适配器不能自报身份；三个 CLI 的子进程环境由 subprocess 剥干净再显式注入；配置目录每成员一份、CLI 只读它，不碰主人的全局目录；原生工具权限按能力兑现，Codex 交自身沙箱／审批，不承诺每次经过本体；内核 MCP 仍经 toolport，总闸与暂停在第二层落实；子 agent 的权限不让父代批；原生子 agent 只在干活的活里、跑在父会话的沙箱与 worktree 内；转录目录随删除级联、不进备份；`liwa --profile deepseek` 只监听 stdio，不开端口。

## 9 第一版范围与验收

**第 1、2 步已完成**：公共层、35 个共享文件、brain CLI、通用 ACP 与独立 deepseek；deepseek 契约 23/23、真模型 11/11 无重试，结构化问答／子审批／模式／图片／跨回合与取消竞态已核验。07 复核确认修复行为，08 补测使 elicitation 语句／分支／函数／行均达 100%；这不是全仓覆盖率结果。网页仍走进程内路径，第二层相关能力尚未交付。依据：〔二手〕既有验收记录；develop 的第 2 步实现。

**交付顺序**：④ Claude Code＋G1 已提交待合回 → ③ 按 A′–I′ 搬运融合与宿主命令 → ⑤ Codex＋G2/G3；G4 与关键 JSON 严格读取是③前置。Claude 可插现有公共层，经一次性 brain run 真机验，不依赖宿主。③按 [01-brain-host.md](01-brain-host.md) A′–I′ 实施，以 DeepSeek、Claude 两个真提供方加假 CLI 验。命令目标为 provider ls/diagnostic 和常驻 run，语法／默认值只在宿主文档维护。〔一手〕handoff 决策 65、66。

下列范围与 A1–A6 中依赖第二层的项目在搭第二层时补验；`session/resume` 的提供方能力可先验，跨重启恢复与孤儿清理不列为当前提供方步骤的完成条件。依据：〔一手〕主人推进决定（handoff 决策 47）。

- **m0**：`@liwa/brain` + `brain-acp`（SDK 1.4）+ `brain-deepseek` + `deepseek-app`（实例预设、`reply` / `no_reply` / `inner`、`_liwa/steer`）；契约测试与回环编解码；`liwa brain list / probe / run`。
- **V1.0**：`brain-claude-code` 全验证（实例、想事、整理、干活）；`brain-codex` 干活与查资料；五个预设；路①（三家的观察）与路②；配置目录生成；备用提供方切换；Paseo 代码与 NOTICE 进仓。
- **V1.1**：Codex 当实例会话、`dynamicTools`、Claude 订阅额度窗口、预热空闲 `deepseek` 进程、离线预审、别家 ACP CLI 验证、主控台的子 agent 面板。

**验收（真实 CLI，Key 由所选实例 env 经受管进程注入）**：

A1–A5 是分阶段的完整目标：第④步 A2 先验 provider/G1、本机 CLI、空壳、问答／模式／用量与原生续接；其中依赖宿主的崩溃对账、跨命令托管与恢复子项在第③步验，依赖完整 toolport/tasks/实例的子项按第二层阶段验。第④步不以第③步尚未实现的宿主为前置。〔一手〕handoff 决策 66；〔推理〕验收拆分。

| # | 怎么算接通 |
| --- | --- |
| A1 | `brain-deepseek`：本体为主人实例拉起真 `liwa --profile deepseek` 子进程（`LIWA_HOME` 在该会话目录、`~/.liwa` 无新文件）→ `liwa chat` 一句话 → `session/new` 带 `_meta.liwa` → 事件 `brain.session.opened → turn.started → tool.called(reply, inner 同批) → turn.completed{concludedBy: reply, usage.tokens 非空, inferences = 1}`；第 4 步被 `agent/pre-step` 拒；主人追加一句经 `_liwa/steer` 在下一步可见；杀本体重启 → 清孤儿杀掉旧进程 → 同一目录重拉 → `session/resume` 成功、身份探针答对 |
| A2 | `brain-claude-code`：本机真实 `claude`（评估版 2.1.318，正式下限待定）开一件想事活（自定义 `systemPrompt`、`settingSources` 仅限受控灵鲸来源、`CLAUDE_CONFIG_DIR` 在成员目录、`tools: []`），`conclude` 经 MCP 到 toolport（未搭时以受控 HTTP MCP 夹具单验提供方通路）；`maxTurns=3` 第 4 次主循环推理不发生（不代表子任务／helper 总限额）；项目静态／按需说明在模型可见，按需全文可由事件重建，执行类哨兵不触发；私有配置文件不进 argv、关闭清理；宿主的 `kill -9`／孤儿对账子项在第③步验收；`deliver(next_step)` 在下一步可见 |
| A3 | `brain-codex`：真 `codex app-server` 开一件干活活（`developerInstructions`、`CODEX_HOME` 在成员目录、`workspace-write` 限 worktree、读到灵鲸注入的项目 `AGENTS.md` 内容、HOME 隔离）；`report` 经 MCP 到 toolport；写 worktree 外触发 `requestApproval` → `permission.request` → `deny_once` 后回合继续；`turn/steer` 次步可见；`thread/tokenUsage/updated` 进 `brain_usage` |
| A4 | 子 agent：`deepseek` 上的干活活调 `subagent` 开子会话、子结束结果回到父的下一步、`brain_child` 与用量归父；Claude 上的干活活用 `Agent` 工具开一个子 agent → `child.started / ended` 出现在 `task:<id>` 流、用量记在父活、`cancel(owner)` 时子 agent 被 `stopTask`；同一活调 `spawn(codex, 交接包)` 开子活、子活 `report` 回到父活、父活结束级联停掉子活；子 agent 的一次权限请求直推主人而不是父 |
| A5 | 切换：roster 把主人实例从 `deepseek` 改成 `claude` → 空闲换代 → 上下文从账本重建 → 身份探针通过 → 再改回 |
| A6 | 契约：四个提供方过同一套契约测试（假 CLI 回放）与回环编解码；`Meta` 声明为 false 的语义恒回 `unsupported` |

## 10 探针与待实测

源码通路和运行保证分开记录。Claude Code／Codex 两份评估不能替代 A2／A3 的真实会话证据；正式版本下限、隔离、成功收尾与未知用量都以真 CLI 结果决定 Meta。承接 overall §17 的 #35（工具收尾／步数）、#36（压缩）、#40（Codex 中断式收尾），按下面矩阵验。依据：〔一手〕两评估 §8；handoff 决策 60。

| 项 | 已有证据 | 尚待验证与安排 | 依据 |
| --- | --- | --- | --- |
| ① deepseek steer | 真 CLI 透传，脚本端点中位 RPC 1 ms、工具后约 24 ms，真模型同轮次步可见 | 维持回归，不宣称网络响应总耗时是 1 ms | 〔一手〕|
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

④ Claude＋G1 先于③宿主，⑤ Codex＋G2/G3 接同一宿主；自动续跑已属③。手机／独立客户端完成后，经主人 SSH VPS 借鉴 relay/E2EE、配对、推送；方向见 [01-brain-host.md](01-brain-host.md) §13，本步不建设多端后端。〔一手〕handoff 决策 63、65、66。

`liwa acp serve` 与 `deepseek-app` 合一；Codex 当实例会话；`dynamicTools`；主控台的子 agent 面板（Paseo `provider-subagents` 的只读时间线）；Claude 订阅额度窗口（条款核实在前，`four-layers.md` §10 第 15 条）；离线预审与自动切换名单；预热空闲 `deepseek` 进程；别家 ACP CLI（Gemini CLI、OpenCode）验证；附录 A 里标 V1.1 / V2 的项。

## 14 其他文档的同步清单

接口归本模块与 00 §5.1；生命周期和数据归 02-minds；宿主／终端面归 01-brain-host。其余模块只链接所拥有的事实，不复制另一份定义。〔一手〕handoff 决策 65；〔推理〕关联清单。

| 文档 | 同步目标 |
| --- | --- |
| overall §3.4／§9.2 | deepseek 每会话一个受管 CLI；Meta、SessionConfig、问答／模式／子归属以 00 §5.1 与实现为准；G1–G4 记为计划 |
| overall §5.2／§5.9、four-layers §3.1 | 原生子 agent 与跨 CLI 子活两条路；权限直达主人；Codex 原生沙箱／审批与软预算边界 |
| overall §15–17、architecture README、roadmap | 第 1、2 步已实现；④ Claude＋G1 → ③宿主（G4/JSON 严格读前置）→ ⑤ Codex＋G2/G3，同等功能验收 |
| four-layers、02-minds | 投递器按能力退化；deepseek next_turn 由回合边界调用 startTurn；后台子工作与 CLI 自开回合照实记录 |
| engineering、00-plugin-kernel | 包名 brain-claude-code；自写严格模块与 src/paseo 分开；配置写法唯一归属提供方 |
| 05-memory、06-growth | self／skills 给灵鲸注入内容；外部 CLI 空壳子、项目文档受控注入，灵鲸自己的配置机制按决策 56 后续设计 |

## 附录 A　Paseo 能力盘点与迁移地图（默认迁）

行数为 `wc -l` 非测试代码；"迁"= 原样拷贝 + 原地改；"迁规则"= 不拷代码、把行为写进对应模块文档；"不迁"要写理由。路径省略 `packages/server/src/server/`。

| 能力 | Paseo 位置（行） | 处置 | 落到 | 理由 / 改什么 |
| --- | --- | --- | --- | --- |
| Claude 项目说明与文件式 agents／commands | CLI 说明与插件目录 | 灵鲸受控收集与快照注入 | brain/project-docs、brain-claude-code | §4.6；SDK 程序化 agents 不用，执行类不自动读 |
| 统一 agent 契约 | `agent/agent-sdk-types.ts`（830） | 迁 | `brain-shared/src/paseo/` | 映射在各 adapter |
| Claude 适配器 | `providers/claude/{agent,query,options,project-dir,transcript-history,tool-call-mapper,tool-call-detail-parser,partial-json,runtime-safety,hooks,subagent-handback,interrupt-placeholder}.ts`（≈ 8 600） | 迁 | `brain-claude-code` | §4.2 的改法 |
| Claude 原生子 agent 观测 | `providers/claude/{sidechain-tracker,task-state,task-notification-tool-call}.ts`、`subagents/`（≈ 1 110 + 目录） | 迁（V1） | `brain-claude-code` | §4.5 路①的观察 |
| Claude 模型目录、回滚、导入 | `providers/claude/{model-manifest,models,model-discovery,rewind,import-descriptor-scheduler}.ts`（≈ 1 030） | 不迁 | — | 不迁目录产品功能、回滚与导入；最小 models／manifest helper 保留方案待第 4 步确认（Claude 评估 §3.3） |
| Codex 适配器 | `providers/codex-app-server-agent.ts`、`codex-feature-definitions.ts`、`providers/codex/{app-server-transport,options,thread-history,tool-call-mapper,tool-call-detail-parser,async-questions}.ts`（≈ 10 000） | 迁 | `brain-codex` | §4.3 的改法（含协作子 agent 条目的翻译）；`codex/rewind.ts` 不迁 |
| ACP 适配器与厂商 shim | `providers/{acp-agent,generic-acp-agent,acp-options,jsonl-rpc-process}.ts`（≈ 5 060）、`{copilot,cursor,kimi,kiro,trae}-acp-agent.ts`（≈ 580） | 迁 + 升 SDK 1.4 | `brain-acp` | §4.4 |
| OpenCode 适配器 | `providers/opencode-agent.ts`、`opencode/`（≈ 5 540 +） | 不迁（V2 候选） | — | 要管 OpenCode 服务器 helper 与插件桥；灵鲸 V1 不用 OpenCode；真要接先走 `brain-acp` |
| Pi / OMP 适配器 | `providers/pi/`、`providers/omp/` | 不迁 | — | 灵鲸不装 pi / omp；不承诺文档提到但代码未实现的 OMP child_session 导入 |
| 共享提供方工具 | `providers/{provider-runner,tool-call-detail-primitives,tool-call-mapper-utils,diagnostic-utils,question-card-answer,custom-message,resume-process-cwd,provider-image-output}.ts`、`agent/{provider-launch-config,provider-options,provider-notices,provider-refresh-deadline,provider-session-import,system-prompt}.ts`（≈ 2 900） | 迁 | `brain-shared` | `provider-launch-config` 的可执行解析改接 subprocess |
| 协议小文件 | 已搬 provider-config/agent-types/tool-name-normalization/agent-message/path-utils/tool-call-display；加 agent-labels/agent-lifecycle/agent-title-limits 与 messages 子集 | 迁 | brain-shared/src/paseo/protocol | 精确导出、删分支与私有 schema 闭包见附录 A.1，整份 WebSocket messages 不搬 |
| 提供方子 agent 存储 | `agent/provider-subagents/store.ts` | 迁（V1） | `brain-shared` | 三家原生子 agent 的描述符与只读时间线；主控台面板 V1.1 |
| 结构化生成循环 | `agent/agent-response-loop.ts`、`structured-generation-providers.ts`（789） | 迁 + 改造 | `@liwa/minds-structured-generation` | 独立 ctx.structuredGeneration；Config.maxCorrections，消费 minds/brains，见 §4.9 |
| agent 互发消息与信封 | `agent/agent-messages/`（433） | 迁 | minds | 从 delivery.ts 扩展 durable 队列，包含人类输入；语义按 02 §4.2，信封换 liwa-block |
| 完成订阅 | `agent/finish-subscriptions/`（820） | 迁 | minds 核心 | 意图存 storage-domain 表，至少一次／权限检查点继续观察；删除远端分支，通知通过同一 durable delivery |
| 子 agent 工具与 MCP 服务器 | `agent/mcp-server.ts`（52）、`tools/paseo-tools.ts`（3347）、mcp-shared、工具类型／序列化／策略 | 迁 | toolport（端点、序列化）+ toolport-minds（agent 工具）+ minds（mcp-shared）+ brain-shared（工具类型与策略） | 工具登记表与 Bearer 按代次；灵鲸名经 catalog 适配；父不能代批，不开放 shell 路 |
| 建 agent 的意图与幂等 | `agent/create-agent/{intent,create}.ts` | 迁 | minds | 保留创建／首 prompt／通知流程；删除 worktree/forge/terminal 分支，持久 operation 处理 unknown |
| 闲置回收、重启恢复 | `agent/idle-runtime-cleanup/`（167）、`restart-recovery/`（81） | 迁 | minds-idle-cleanup／minds-restart-recovery | 两个可禁用策略插件；D4/D12 语义不变，Config 管阈值／prompt |
| AgentManager、提供方注册表、agent 存储 | `agent-manager.ts`（5794）、agent-storage、agent-archive；provider-snapshot-manager 等目录三件 | 迁 + 融合；provider-registry／provider-runtime 除外 | minds（目录三件同在 minds，brains 只出提供方表快照） | provider-registry 直接 import 全家实现，换 brains.register；provider-runtime 只启动 OpenCodeBridge 不搬；存储 schema/接口留、实现换 storage-domain |
| 时间线三件 | `agent/{timeline-projection,agent-timeline-store,agent-timeline-content}.ts` 与 `agent-timeline-store-types.ts` | 已迁 | `brain-shared/src/paseo/agent/` | 提供方子 agent 存储与适配器共用；网关（07）直接引用这一份〔一手：develop 源码 `packages/brain/brain-shared/NOTICE`、`packages/brain/brain-shared/src/paseo/agent/provider-subagents/store.ts`〕 |
| 时间线合流与摘要 | `agent/{agent-stream-coalescer,activity-curator,timeline-prompt-index}.ts` | 迁 | minds | Manager 单一时间线；网关消费公开 API，不再拷一份 |
| JSONL 帧解码 | `agent/providers/jsonl-frame-decoder.ts` | 已迁 | `brain-shared/src/paseo/agent/providers/` | ACP 与 Codex 传输共用〔一手：develop 源码 `packages/brain/brain-shared/NOTICE`、`packages/brain/brain-shared/src/paseo/agent/providers/jsonl-frame-decoder.ts`〕 |
| 运行时 MCP 配置注入 | `agent/runtime-mcp-config.ts` | 迁 | `brain-shared` | 给 CLI 写 toolport 端点 |
| 会话导入、历史搜索 | `agent/import-sessions.ts`、`chat-search/`、`agent-history-search.ts` | 不迁 | — | 记忆召回归 memory；导入外部会话不是灵鲸功能 |
| 语音 | `speech/`（6 083）、`dictation/`（816）、`stt-manager` / `tts-manager` | 迁（V1.1） | `ability-speech-local`（09） | 决策 1 已定，带 SenseVoice 与 Whisper |
| 调度 | `schedule/{cron,service,store}.ts`（1 526） | 迁 `cron.ts`；其余迁规则 | `job-trigger-time`、scheduler（04） | 解析与 `computeNextRunAt` 照搬；service / store 改 SQLite，补补跑与 60 分钟看门狗 |
| 工作树与工作区 | `worktree/commands.ts`、`paseo-worktree-service.ts`、`plugins/worktree-include/`、`projects` / `workspace-labels/`（≈ 1 200） | 迁 worktree 命令与 `.worktreeinclude` 复制；注册表不迁 | workspace（03） | 工作区登记归 workspace 的 SQLite |
| 签出与 diff | `checkout/`、`checkout-diff-{manager,cache}.ts`、`checkout-git-utils.ts`（≈ 700） | 迁（V1.1） | workspace、console（08） | 对话编程的"看 diff" |
| 文件观察、文件浏览、上传下载、目录同步 | `file-observer/`、`file-explorer/`、`file-upload/`、`file-download/`、`directory-sync/`（≈ 3 300） | 迁 `file-observer`（V1.1）；其余不迁 | workspace | 观察改动给"改了哪个文件"；浏览与上传是界面功能，08 再看 |
| 进程登记 | `managed-processes/`（469）、`utils/{spawn,tree-kill}.ts`、`paseo-env.ts`、`plugin/src/server/process.ts` | 不迁 | — | 底座 `@liwa/subprocess` 更全（环境剥离、进程组、检查器）；逐条 JSON 台账／启动对账规则在③落 subprocess 公共能力，字段见 §2.1 |
| 终端 | `src/terminal/`（9 197） | 不迁（V1.1 借） | — | 底座 `tool-terminal` / `terminal-bundle` 已有 PTY；Paseo 的"重启后终端不断"以后借 |
| 浏览器工具 | `browser-tools/`（1 658） | 不迁 | — | 底座 `browser-use` 已有 |
| forge（GitHub / GitLab / Gitea）、合并后自动归档 | `src/services/`（9 380）、`auto-archive-on-merge/`、`webhook` | 迁（V1.1，订阅直通时） | tasks、senses | 底座也有 `webhook-github` / `forge-github`，到时二选一 |
| 任务清单 | `src/tasks/`（747） | 不迁 | — | 灵鲸的 tasks 有自己的状态机与核验 |
| 编排技能 | `orchestration-skills/`（1 440）、`skills/*` | 迁规则 | skills（06） | "技能目录安装与更新"的做法给本事导出用；Paseo 技能本身是它的用法 |
| agent 档案 | `agent-profile` | 迁规则 | roster | 就是 roster 的"按会话种类配提供方 + 选择说明" |
| 额度来源插件 | `plugins/{claude,codex}-usage-source`；其余 7 家 | Claude V1.1 再评估，Codex 直接用受管连接通知 | `brain-claude-code` / `brain-codex` | 不迁扫描全局 auth 的 Codex usage-source；账号窗口不等于会话消费〔一手〕Codex 评估 §2／§4 |
| 插件平台与远程接入部件 | `plugins/`（7 137）、`hub/`、`connected-hosts/`、`relay`、`push/`、`pairing-*`、`session/`（9 529）、`websocket/`、`authorization/`、`auth.ts` | 插件平台不迁；多端阶段借相关能力 | 01-brain-host §13 | 插件/RPC 仍底座；Hub、host、relay/E2EE、配对／推送等客户端完成后走主人 VPS，不另造后端 |
| 守护进程壳 | `daemon-worker.ts`、`supervisor`、`pid-lock.ts`、`bootstrap.ts`、配置存储 | 不迁（借自检） | 本体入口 | brain-host profile 与短命 restart 载体；本步不安装 launchd，不搬整块 supervisor |
| 客户端与 CLI | `packages/{cli,client,app,desktop,website,expo-two-way-audio,highlight}` | 不迁（CLI 借形状） | 01-brain-host §3/§9 | 命令形状与默认语义按功能同等，独立客户端多端阶段走 VPS |
| 第三方提供方插件 | `plugins/{antigravity,hoplite,muse}-provider` | 不迁 | — | 灵鲸不用这些产品 |

| 不搬组 | 文件／范围 | 处置与理由 | 灵鲸归属 | 依据 |
| --- | --- | --- | --- | --- |
| 语音内部文件 | audio-utils、dictation-debug、pcm16-resampler、recordings-debug、stt-debug、stt-manager、tts-debug、tts-manager | 不进本层 | 09 的语音能力阶段 | 〔一手〕主人工作记录 19 §1.4 |
| Paseo 插件平台三文件 | plugin-provider、plugin-session-history、tools/plugin-tools | 文件不搬；功能 2/14/54/112 为“改”：工具登记、opening、流信号与卸载换成 Cordis，能力不丢 | 02 §4.4 | 〔一手〕Paseo agent-manager.ts:907、931、1363、5394 |
| 导入与聊天搜索 | import-sessions、chat-search | 不扫描接管外部会话，搜索另归 memory／主控台 | 后续领域 | 〔一手〕01-brain-host §9.1.1 |
| worktree 归档联动 | create-agent-lifecycle-dispatch | 工作区/终端/调度下一批 | workspace | 〔一手〕决策 65 D2 |
| 测试替身 | rewind/test-rewind-session | 不作生产文件搬；相关测试保留所需测试夹具 | tests/paseo 夹具 | 〔一手〕Paseo rewind/rewind.test.ts:1 |
| 周边产品目录 | speech、schedule、hub、terminal、plugins、managed-processes；daemon Session/websocket/relay | 不进 agent 核心，不复制 daemon 壳 | 底座进程服务／各产品阶段 | 〔一手〕决策 67；§4.9 |

### 附录 A.1 agent 协议子集的精确边界（F7）

逐文件读 import 后，以下是 §1.1 搬运闭包对 messages 的全部直接引用（包括上游 server/messages.ts 的重导出）。先列原始引用，再列删分支后的真正导出，不能把原始闭包全部搬进来。依据：〔一手〕`paseo-upstream@8018231a:packages/server/src/server/agent/` 表内文件行；server/messages.ts:1–17 只是重导出和 serializer。

| 引用文件:行（相对 server/agent） | 原始导出名 |
| --- | --- |
| agent-prompt.ts:9；host-operations/index.ts:3 | ActiveTurnBehavior；AgentSnapshotPayload（host-operations） |
| tools/paseo-tools.ts:19、21、46 | ActiveTurnBehaviorSchema、AgentProfileSchema、AgentFeatureSchema、AgentPermissionRequestPayloadSchema、AgentListItemPayloadSchema、AgentPermissionResponseSchema、AgentSnapshotPayloadSchema、WorkspaceScriptPayloadSchema、FirstAgentContext |
| agent-projections.ts:2 | AgentListItemPayload、AgentSnapshotPayload、RecentProviderSessionDescriptorPayload |
| agent-storage.ts:7 | AgentFeatureSchema、AgentStatusSchema |
| directory.ts:1；finish-subscriptions/internal/observation-stream.ts:1、observation.ts:10 | AgentSnapshotPayload |
| create-agent-title.ts:2；create-agent/create.ts:13 | FirstAgentContext；AgentAttachment（create） |
| prompt-attachments.ts:2；activity-curator.ts:3 | AgentAttachment |
| agent-configuration-validator.ts:2；provider-snapshot-manager.ts:47 | HubExecutionAgentValidationIssue |
| mcp-shared.ts:9 | serializeAgentSnapshot，实际是 server/messages.ts 的函数，不是 protocol/messages 导出；原地改调 agent-projections.toAgentPayload |

冻结写入 `brain-shared/src/paseo/protocol/messages.ts` 的公开导出仅为：`ActiveTurnBehaviorSchema`、`ActiveTurnBehavior`、`AgentStatusSchema`、`AgentFeatureToggleSchema`、`AgentFeatureSelectSchema`、`AgentFeatureSchema`、`AgentPermissionRequestPayloadSchema`、`AgentPermissionResponseSchema`、`AgentSnapshotPayloadSchema`、`AgentSnapshotPayload`、`AgentListItemPayloadSchema`、`AgentListItemPayload`、`FirstAgentContextSchema`、`FirstAgentContext`、`HubExecutionAgentValidationIssueSchema`、`HubExecutionAgentValidationIssue`。`FirstAgentContext` 只留 prompt，文本／图片／聊天历史走已搬 AgentPromptInput，删除 forge／上传附件分支；校验 issue 虽带 Hub 名但只含 path/message，保留原名不引入 Hub 传输。〔一手〕Paseo `packages/protocol/src/messages.ts:306`、`:337`、`:510`、`:526`、`:863`、`:898`、`:1254`、`:2602`、`:6717`；〔推理〕精确子集。

依赖闭包中的私有 schema 一并抽取但不扩大公开目录：AgentModeSchema、AgentSelectOptionSchema、AgentCapabilityFlagsSchema、AgentUsageSchema、AgentPermissionUpdateSchema、AgentPermissionActionSchema、AgentPersistenceHandleSchema、AgentRuntimeInfoSchema、AgentActiveTurnPayloadSchema、ToolCallDetailPayloadSchema 及其工具详情子 schema／JSON 值校验。会话配置 schema 不从 messages 复制，唯一校验者仍是 00 §5.1 的 contract.ts；相关品牌／业务字段在该处合并。〔一手〕Paseo `packages/protocol/src/messages.ts:308`–`:858`；〔推理〕防双真相。

| 保留／不搬项 | 随哪个分支处理 | 依据 |
| --- | --- | --- |
| agent-labels、agent-lifecycle、agent-title-limits | 搬；父标签改 liwa.；tab 标签／相关自动 detach 分支删；title 常量从此引用，不在 create-agent-title 再拷一份 | 〔一手〕Paseo agent-manager.ts:12–22、create-agent-title.ts:1 |
| AgentProfileSchema | 随 list_profiles 工具分支删，配置绑定归 roster／03；当前本任务只搬 agent 工具组，不增加 list_profiles | 〔一手〕Paseo tools/paseo-tools.ts:3077 |
| RecentProviderSessionDescriptorPayload | 随 toRecentProviderSessionDescriptorPayload 与外部会话导入／搜索分支删 | 〔一手〕Paseo agent-projections.ts:351 |
| AgentAttachment、AgentAttachmentSchema | 随 forge／上传附件分支删，不恢复 shared 已删的附件联合 | 〔一手〕`packages/brain/brain-shared/NOTICE:29` |
| WorkspaceScriptPayloadSchema | 随工作区脚本工具组删 | 〔一手〕Paseo tools/paseo-tools.ts:21 |
| provider-manifest | 随 built-in registry／界面清单／OpenCodeBridge 分支删；AgentProvider 使用已搬 z.string 定义 | 〔一手〕Paseo provider-snapshot-manager.ts:40；brain-shared NOTICE |
| schedule/*、hosts、forge-manifest、terminal-* | 分别随调度／远程／forge／终端工具组删；不因类型依赖带回整个产品域 | 〔一手〕Paseo tools/paseo-tools.ts:47–67、host-operations/index.ts:13 |
| paseo-tool-presentation | 删除专属目录展示分支，活动摘要用已搬 tool-call-display | 〔一手〕brain-shared NOTICE:38 |
| @getpaseo/client/internal/daemon-client、daemon-client-transport-types | 随 host-operations 与 finish-subscriptions 的远端连接／观察分支删；本地 WaitForFinishResult 直接使用 Manager 观察结果的窄类型 | 〔一手〕Paseo host-operations/index.ts:6、finish-subscriptions/index.ts:5 |

B′ 逐文件来源与“灵鲸改”记入各包 NOTICE，brain-shared README 记录实际迁入的协议与工具词汇；接缝尚未装配，不能视为业务验收通过。〔一手〕各包 NOTICE；〔推理〕实现与验收区分。
