# Claude 适配评估

本文是静态适配评估，建议与待定项不等于已定方案；执行范围与已定选择以 `docs/liwa/handoff.md` 决策 55–61 和 `architecture/modules/01-agent-cli.md` 为准。路径使用仓库相对路径或安装／产物占位符，源码证据、逐文件清单、测试计划与风险均完整保留。〔一手〕任务书 03 的公开仓库与内容保留要求。

状态：只读评估已交回（2026-11-05）。范围：仅写本文件；没有写代码、安装依赖、构建、提交、切分支或开子 agent；没有启动真实 Claude 会话，没有读取 `~/.claude`、`~/.codex`、`~/.paseo` 或钥匙串，也未访问任务禁止的数据目录／App。仅执行了允许的 `claude --version`。项目总规则要求读的 `~/.claude/CLAUDE.md` 被本任务更具体的禁止规则覆盖，未读取；按指定 handoff 的全局原则摘要执行。〔一手〕本任务执行记录与 handoff:47。

基线：工作目录 `liwa-dev`、分支 `dev`，交回前读取 HEAD 为 `034f825409f40c6b1fa2b58dbf5a3b763c184473`，以当前未提交工作区源码为准；Paseo HEAD `8018231a00a6b45ed6cda1856f954ba14b4824c0`。未使用 Helm。参考记录02／03／07仅作为历史判断，当前结论重新对照源码，不替它们的全量测试背书。〔一手〕本次 git只读查询、任务指定记录。

## 1. 一页结论

**能接，Claude Agent SDK 路线成立；主要落在新增 `@liwa/brain-claude-code`＋正常装配，但“公共层完全不用改”应收窄：如要完整汇总已知的失败／取消支出，需要一处通用用量补口。**不能把 Paseo 原文件照抄接上就宣称满足灵鲸隔离与预算要求。〔一手〕`S:sdk.d.ts:1495–1518,1821–1824,4957–4976`、`L:packages/brain/brain/src/session.ts:473–494`；整体评估〔推理〕。

| 主人关心的事 | 结论 |
| --- | --- |
| 怎么接／版本 | SDK 精确钉 **0.3.263**；显式 `pathToClaudeCodeExecutable` 指向受管解析的外部 claude，本机是 **2.1.318**。SDK 默认自带的是 **2.1.263**，不会自动用 PATH318；2.1.292只是后台 roster 已知门槛，建议首个验收基线设318。〔一手〕`S:package.json:83`、`sdk.d.ts:1822–1824`、`P:claude/runtime-safety.ts:19–40`；基线推荐〔推理〕 |
| 从 Paseo 迁多少 | 目录生产 **28文件／12,264行**；推荐迁后裁剪的输入 **24文件／11,883行**，最终 vendor 约8,000–10,500行＋严格自写1,200–2,000行；共享35文件已齐，无必须补迁的共享文件。逐文件表见§3。〔一手〕逐文件计数与依赖；最终规模〔推理〕 |
| 公共层到底改不改 | 提供方 API、目录生成、进程 seam、结构化问答钩子、模型／模式／子事件机制够用。**用量例外**：现在失败／取消没 usage，update 的 token 不计总和；建议 terminal 增可选 usage＋幂等结算（§6），已有提供方不带时兼容。〔一手〕`brain/src/provider.ts:149–192`、`brain-shared/src/session.ts:451–520`、`brain/src/session.ts:473–494`；补法〔推理〕 |
| 最大风险 | ① config dir 也改变钥匙串服务名，默认登录不能自动继承；② project settingSources 会带入项目 settings，claudeMdExcludes 只筛 memory；③ 原 Paseo 累计费用／主循环用量映射不能直接当含孩子的回合花费。〔一手〕`C:bin/claude.exe:2382003`、`S:sdk.d.ts:2075–2085,8144–8147,4966–4976` |
| #35／#36站不站得住 | 源码有 PostToolBatch 的 continue:false 停续推理，也有 autoCompactEnabled／DISABLE_COMPACT；比原“仅二手待测”更有把握。但成功判定、真实终止帧、长上下文不开压缩仍须 A2；maxTurns 不等于所有子任务／helper 总预算。〔一手〕`C:bin/claude.exe:2392536,2397848,2388766,2390214`；运行边界〔推理〕 |
| 需要主人定 | **先定认证方式与凭据隔离、项目可执行配置边界、公共用量小补口是否纳入**；再确认318基线、问答不可编码时拒绝／降级、最小模型 helper 的迁入例外与真CLI成本预算。推荐与理由见§10。〔推理〕 |
| 工作量 | 约 **10–16工程人日＋2–3评审人日**，不含第3步与第二层；机械搬迁、包元数据、纯codec／差分测试可交GLM；认证、隔离、生命周期和预算主逻辑不宜。〔一手〕清单规模；工时／分工〔推理〕 |

第3步应保留“常驻宿主持有会话／审批、原生UUID与稳定目录可持久化、attach不丢事件、后台任务否决回收、停止失败不能接新活、转录与日志分别归属”的能力，不把进程内现状冒充崩溃后恢复（§7）。本次只做静态评估；没有消耗Claude会话额度，也没有用假CLI通过代替A2。〔一手〕`brain/src/provider.ts:38–49,113–121`、`brain/src/session.ts:639–654,751–761`；约束〔推理〕。

## 2. 接入方式与版本

**路线成立，但必须显式选择外部 CLI；钉 SDK 不等于钉本机 CLI。**〔一手〕`S:sdk.d.ts:1821–1824`、`S:package.json:83`、`P:claude/query.ts:63–106`；〔推理〕长会话实现沿 Paseo，不复用底座一次性委派的生命周期。

| 问题 | 核查结论 | 依据 |
| --- | --- | --- |
| SDK 版本 | 保持精确 `0.3.263`；Paseo 原依赖 0.3.246，不能把原测试通过当成新 SDK 通过 | 〔一手〕本机 SDK `package.json:3`；`paseo-upstream/packages/server/package.json:108` |
| 默认 CLI | SDK 默认从平台 optional dependency 解析自带原生 CLI；不是 PATH 的 claude；SDK 元数据写 `claudeCodeVersion: 2.1.263` | 〔一手〕`S:sdk.d.ts:1821–1824`、`S:sdk.mjs:221`（`if(!WE)...NK(...)`）、`S:package.json:83` |
| 本机 CLI | `<PATH 中的 claude>` 指向 npm 包的原生 `bin/claude.exe`，`claude --version` 实测 `2.1.318 (Claude Code)`；本次未启动会话 | 〔一手〕本次只读命令、`C:package.json:3–6` |
| 如何用本机版 | 启动前通过 launch.resolveExecutable 解析 claude，把绝对路径交 `pathToClaudeCodeExecutable`，随后 SDK 的自定义 spawn 经 launch.spawn 受管 | 〔一手〕`L:packages/brain/brain/src/provider.ts:21–35,184–192`、`S:sdk.d.ts:1824`；〔推理〕推荐 |
| 是否匹配 | 控制协议路径与相关选项在 SDK 里存在，但 0.3.263＋2.1.318 的运行兼容性本次不能证明，需 A2；不能承诺版本号相近即兼容 | 〔一手〕SDK 类型与本机包；〔推理〕 |
| minVersion | 至少 `2.1.292` 才有 Paseo 已知可信的后台任务 roster；实际第一版建议以 `2.1.318` 作已验收基线，A2 通过前不声称通过。不要探测 PATH 318 却运行自带 263 | 〔一手〕`P:claude/runtime-safety.ts:19–40`；〔推理〕版本策略待主人定 |
| 底座能搬什么 | `claudeSpawnSpec`＋`sdkEnvironmentOverlay`＋`ManagedClaudeCodeProcess` 可搬入新包严格检查的 process.ts；不能搬其 `persistSession:false`、拒绝问答、只收最终结果的一次性策略 | 〔一手〕`L:packages/subagent/subagent-claude-code/src/process.ts:30–159`、`run.ts:325–369` |

本报告路径简写：`L:`＝`liwa-dev/`；`D:`＝同级 `liwa-dsh/docs/liwa/`；`P:`＝同级 `paseo-upstream/packages/server/src/server/agent/providers/`（共享文件写 `P-server:`＝`packages/server/src/`）；`S:`＝`L:node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.3.263_*/node_modules/@anthropic-ai/claude-agent-sdk/`；`C:`＝`<本机 Claude Code 安装>/`。所有行号基于本次工作区；minified 文件的一行很长，引用同时注明符号或片段。

## 3. Paseo 迁移清单

行数口径：固定 `8018231a` 工作树逐文件物理行数（含空行和注释）；不是“要新写的行数”。下表处置为本次评估推荐，涉及与附录 A 不同的保留／裁剪要先确认。所有“原样迁”仍按既定规则加来源头、`.js` → `.ts`、包内导入改共享包路径；业务逻辑不改。〔一手〕`D:architecture/modules/01-agent-cli.md:231–234,360–369`；〔推理〕。

### 3.1 Claude 目录生产源码（逐文件）

| 文件（相对 providers/claude） | 行数 | 处置及改动 | 落位 | 依据 |
| --- | ---: | --- | --- | --- |
| `agent.ts` | 7102 | 迁后原地改：删模型目录／导入／回滚／Paseo附件与工具目录接线；进程、日志接公共 API；落实策略、差量用量、子审批、取消错误传播、预算钩子 | `brain-claude-code/src/paseo/agent/providers/claude/agent.ts` | 〔一手〕`P:claude/agent.ts:1`；处置〔推理〕 |
| `feature-definitions.ts` | 31 | 不迁：Paseo fast-mode／特性 UI；删除 agent.ts 对应入口 | `—` | 〔一手〕`P:claude/feature-definitions.ts:1`；处置〔推理〕 |
| `hooks.ts` | 21 | 原样迁：子观察钩子 matcher | `brain-claude-code/src/paseo/agent/providers/claude/hooks.ts` | 〔一手〕`P:claude/hooks.ts:1`；处置〔推理〕 |
| `import-descriptor-scheduler.ts` | 92 | 不迁：外部会话导入扫描及 p-limit，不是灵鲸功能 | `—` | 〔一手〕`P:claude/import-descriptor-scheduler.ts:1`；处置〔推理〕 |
| `interrupt-placeholder.ts` | 6 | 原样迁：过滤 Claude 中断占位文字 | `brain-claude-code/src/paseo/agent/providers/claude/interrupt-placeholder.ts` | 〔一手〕`P:claude/interrupt-placeholder.ts:1`；处置〔推理〕 |
| `model-discovery.ts` | 89 | 不迁：主动启动 query 探测模型目录；由 roster 指定模型，probe 仅 --version／可执行性 | `—` | 〔一手〕`P:claude/model-discovery.ts:1`；处置〔推理〕 |
| `model-manifest.ts` | 492 | 迁后原地改：仅保留版本解析及确实被保留代码调用的归一化辅助；删硬编码目录、thinking 选项产品逻辑 | `brain-claude-code/src/paseo/agent/providers/claude/model-manifest.ts` | 〔一手〕`P:claude/model-manifest.ts:1`；处置〔推理〕 |
| `models.ts` | 192 | 迁后原地改：只留运行时模型归一化／观察模型辅助；删设置扫描和目录接口；上下文优先取 SDK，不猜 roster 外的窗口 | `brain-claude-code/src/paseo/agent/providers/claude/models.ts` | 〔一手〕`P:claude/models.ts:1`；处置〔推理〕 |
| `options.ts` | 103 | 迁后原地改：协议类型走 brain-shared；补 tools、compaction、严格 MCP 与需要的 SDK settings；拒绝覆盖隔离参数 | `brain-claude-code/src/paseo/agent/providers/claude/options.ts` | 〔一手〕`P:claude/options.ts:1`；处置〔推理〕 |
| `partial-json.ts` | 359 | 原样迁：流式工具 JSON 修复 | `brain-claude-code/src/paseo/agent/providers/claude/partial-json.ts` | 〔一手〕`P:claude/partial-json.ts:1`；处置〔推理〕 |
| `project-dir.ts` | 126 | 迁后原地改：所有入口显式要求隔离 configDir，不再回退用户默认目录；保留 cwd 编码及同目录内查转录 | `brain-claude-code/src/paseo/agent/providers/claude/project-dir.ts` | 〔一手〕`P:claude/project-dir.ts:1`；处置〔推理〕 |
| `query.ts` | 117 | 迁后原地改：自定义 spawn 改 launch.spawn＋claudeSpawnSpec；无 Paseo env／spawn／tree-kill | `brain-claude-code/src/paseo/agent/providers/claude/query.ts` | 〔一手〕`P:claude/query.ts:1`；处置〔推理〕 |
| `rewind.ts` | 169 | 不迁：公共 rollback:false，不做文件／会话回滚 | `—` | 〔一手〕`P:claude/rewind.ts:1`；处置〔推理〕 |
| `runtime-safety.ts` | 42 | 迁后原地改：版本解析导入保留的最小 helper；roster／待通知否决规则保留 | `brain-claude-code/src/paseo/agent/providers/claude/runtime-safety.ts` | 〔一手〕`P:claude/runtime-safety.ts:1`；处置〔推理〕 |
| `sidechain-tracker.ts` | 456 | 迁后原地改：仅改共享类型导入；保留 sidechain 归属 | `brain-claude-code/src/paseo/agent/providers/claude/sidechain-tracker.ts` | 〔一手〕`P:claude/sidechain-tracker.ts:1`；处置〔推理〕 |
| `subagent-handback.ts` | 27 | 原样迁：子 agent 交回解析 | `brain-claude-code/src/paseo/agent/providers/claude/subagent-handback.ts` | 〔一手〕`P:claude/subagent-handback.ts:1`；处置〔推理〕 |
| `subagents/live-source.ts` | 567 | 迁后原地改：共享类型导入；保留声明过滤与 task-id 映射；加 agentID 审批到 canonical child 的映射出口 | `brain-claude-code/src/paseo/agent/providers/claude/subagents/live-source.ts` | 〔一手〕`P:claude/subagents/live-source.ts:1`；处置〔推理〕 |
| `subagents/observation.ts` | 96 | 迁后原地改：仅改共享类型导入；保留 fold | `brain-claude-code/src/paseo/agent/providers/claude/subagents/observation.ts` | 〔一手〕`P:claude/subagents/observation.ts:1`；处置〔推理〕 |
| `subagents/presentation.ts` | 53 | 迁后原地改：去掉目录名称依赖，用 SDK 实际模型名；保留展示事实 | `brain-claude-code/src/paseo/agent/providers/claude/subagents/presentation.ts` | 〔一手〕`P:claude/subagents/presentation.ts:1`；处置〔推理〕 |
| `subagents/replay-source.ts` | 405 | 迁后原地改：仅隔离目录内恢复已证明的子身份；共享导入调整，不给上层重灌历史 | `brain-claude-code/src/paseo/agent/providers/claude/subagents/replay-source.ts` | 〔一手〕`P:claude/subagents/replay-source.ts:1`；处置〔推理〕 |
| `subagents/task-status.ts` | 23 | 迁后原地改：仅改共享类型导入 | `brain-claude-code/src/paseo/agent/providers/claude/subagents/task-status.ts` | 〔一手〕`P:claude/subagents/task-status.ts:1`；处置〔推理〕 |
| `subagents/workflow-output.ts` | 79 | 迁后原地改：读取范围限制在当前 CLI 管理的数据／任务输出；保留结构化结果解析 | `brain-claude-code/src/paseo/agent/providers/claude/subagents/workflow-output.ts` | 〔一手〕`P:claude/subagents/workflow-output.ts:1`；处置〔推理〕 |
| `subagents/workflow-replay-source.ts` | 248 | 迁后原地改：共享导入；仅恢复原生观察，不能把回放用量当累计消耗 | `brain-claude-code/src/paseo/agent/providers/claude/subagents/workflow-replay-source.ts` | 〔一手〕`P:claude/subagents/workflow-replay-source.ts:1`；处置〔推理〕 |
| `task-notification-tool-call.ts` | 455 | 迁后原地改：共享类型导入；保留任务结果卡与回放身份 | `brain-claude-code/src/paseo/agent/providers/claude/task-notification-tool-call.ts` | 〔一手〕`P:claude/task-notification-tool-call.ts:1`；处置〔推理〕 |
| `task-state.ts` | 202 | 迁后原地改：仅改共享类型导入；保留任务状态跟踪 | `brain-claude-code/src/paseo/agent/providers/claude/task-state.ts` | 〔一手〕`P:claude/task-state.ts:1`；处置〔推理〕 |
| `tool-call-detail-parser.ts` | 245 | 迁后原地改：共享 primitives／类型导入；保留工具事实 | `brain-claude-code/src/paseo/agent/providers/claude/tool-call-detail-parser.ts` | 〔一手〕`P:claude/tool-call-detail-parser.ts:1`；处置〔推理〕 |
| `tool-call-mapper.ts` | 184 | 迁后原地改：共享协议 normalization／类型导入；保留工具事实 | `brain-claude-code/src/paseo/agent/providers/claude/tool-call-mapper.ts` | 〔一手〕`P:claude/tool-call-mapper.ts:1`；处置〔推理〕 |
| `transcript-history.ts` | 283 | 迁后原地改：只读隔离转录，供原生续接／子观察恢复；不作为灵鲸 logs／经历流权威，不做外部扫描 | `brain-claude-code/src/paseo/agent/providers/claude/transcript-history.ts` | 〔一手〕`P:claude/transcript-history.ts:1`；处置〔推理〕 |

统计：目录生产源码 **28 文件／12,264 行**；推荐保留 **24 文件的 11,883 行原始输入**，其中 models／manifest 共 684 行只留最小 helper，agent.ts 删掉大量不在灵鲸范围内的产品功能。最终 vendor 源码预计 **8,000–10,500 行**；严格检查的新适配／进程／配置／codec 预计另写 **1,200–2,000 行**。这是代码规模估计，不是已完成实现。〔一手〕以上盘点；最终行数〔推理〕。

### 3.2 已有共享源码与依赖闭包

下面 35 个文件已经在 brain-shared，不再复制进 Claude 包。原始行数取上游，对应落位、修改以当前工作区为准。直接用的核心是 AgentSession／事件类型、provider-launch-config（已接 processHost）、provider-runner、tool mapper primitives、diagnostic-utils、timeline／subagent store、system-prompt、image-output、历史时间戳和 path／timeout；其余是它们的依赖或既有公共能力。〔一手〕`L:packages/brain/brain-shared/NOTICE:15–63`、Claude `agent.ts:1–154`。

| 上游相对映射路径 | 原行数 | 处置 | 现有落位 | 依据 |
| --- | ---: | --- | --- | --- |
| `agent/agent-sdk-types.ts` | 830 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/agent-sdk-types.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/agent-sdk-types.ts:1` |
| `agent/agent-timeline-content.ts` | 145 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/agent-timeline-content.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/agent-timeline-content.ts:1` |
| `agent/agent-timeline-store-types.ts` | 68 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/agent-timeline-store-types.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/agent-timeline-store-types.ts:1` |
| `agent/agent-timeline-store.ts` | 185 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/agent-timeline-store.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/agent-timeline-store.ts:1` |
| `agent/create-agent-mode.ts` | 112 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/create-agent-mode.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/create-agent-mode.ts:1` |
| `agent/provider-history-timestamps.ts` | 17 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/provider-history-timestamps.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/provider-history-timestamps.ts:1` |
| `agent/provider-launch-config.ts` | 279 | 直接复用；Claude 只改调用以传 processHost；不重复迁 | `brain-shared/src/paseo/agent/provider-launch-config.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/provider-launch-config.ts:1` |
| `agent/provider-notices.ts` | 11 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/provider-notices.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/provider-notices.ts:1` |
| `agent/provider-options.ts` | 105 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/provider-options.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/provider-options.ts:1` |
| `agent/provider-refresh-deadline.ts` | 80 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/provider-refresh-deadline.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/provider-refresh-deadline.ts:1` |
| `agent/provider-session-import.ts` | 84 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/provider-session-import.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/provider-session-import.ts:1` |
| `agent/provider-subagents/store.ts` | 166 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/provider-subagents/store.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/provider-subagents/store.ts:1` |
| `agent/providers/custom-message.ts` | 26 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/providers/custom-message.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/providers/custom-message.ts:1` |
| `agent/providers/diagnostic-utils.ts` | 449 | 直接复用；Claude 只改调用以传 processHost；不重复迁 | `brain-shared/src/paseo/agent/providers/diagnostic-utils.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/providers/diagnostic-utils.ts:1` |
| `agent/providers/jsonl-frame-decoder.ts` | 277 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/providers/jsonl-frame-decoder.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/providers/jsonl-frame-decoder.ts:1` |
| `agent/providers/provider-image-output.ts` | 272 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/providers/provider-image-output.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/providers/provider-image-output.ts:1` |
| `agent/providers/provider-runner.ts` | 129 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/providers/provider-runner.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/providers/provider-runner.ts:1` |
| `agent/providers/question-card-answer.ts` | 23 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/providers/question-card-answer.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/providers/question-card-answer.ts:1` |
| `agent/providers/resume-process-cwd.ts` | 26 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/providers/resume-process-cwd.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/providers/resume-process-cwd.ts:1` |
| `agent/providers/tool-call-detail-primitives.ts` | 1052 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/providers/tool-call-detail-primitives.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/providers/tool-call-detail-primitives.ts:1` |
| `agent/providers/tool-call-mapper-utils.ts` | 269 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/providers/tool-call-mapper-utils.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/providers/tool-call-mapper-utils.ts:1` |
| `agent/runtime-mcp-config.ts` | 70 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/runtime-mcp-config.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/runtime-mcp-config.ts:1` |
| `agent/system-prompt.ts` | 10 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/system-prompt.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/system-prompt.ts:1` |
| `agent/timeline-projection.ts` | 742 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/agent/timeline-projection.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/agent/timeline-projection.ts:1` |
| `protocol/agent-message.ts` | 14 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/protocol/agent-message.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/protocol/agent-message.ts:1` |
| `protocol/agent-types.ts` | 545 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/protocol/agent-types.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/protocol/agent-types.ts:1` |
| `protocol/path-utils.ts` | 17 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/protocol/path-utils.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/protocol/path-utils.ts:1` |
| `protocol/provider-config.ts` | 139 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/protocol/provider-config.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/protocol/provider-config.ts:1` |
| `protocol/timeline-identity.ts` | 7 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/protocol/timeline-identity.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/protocol/timeline-identity.ts:1` |
| `protocol/timeline-turn.ts` | 24 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/protocol/timeline-turn.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/protocol/timeline-turn.ts:1` |
| `protocol/tool-call-display.ts` | 181 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/protocol/tool-call-display.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/protocol/tool-call-display.ts:1` |
| `protocol/tool-name-normalization.ts` | 94 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/protocol/tool-name-normalization.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/protocol/tool-name-normalization.ts:1` |
| `utils/path.ts` | 214 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/utils/path.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/utils/path.ts:1` |
| `utils/promise-timeout.ts` | 45 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/utils/promise-timeout.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/utils/promise-timeout.ts:1` |
| `utils/string-command-shell.ts` | 54 | 直接复用（已有灵鲸改法为准）；不重复迁 | `brain-shared/src/paseo/utils/string-command-shell.ts` | 〔一手〕`L:packages/brain/brain-shared/src/paseo/utils/string-command-shell.ts:1` |

**没有发现 Claude 生产路径还必须补迁的 Paseo 共享文件。**现有严格层 `PaseoBrainSession`、`toPaseoPrompt`、`paseoLogger` 直接复用；新 Claude 包覆写已有受保护钩子，而非把厂商分支加进共享层。`AgentUsage` 不含 cacheWrite，可在 Claude 包用原始 SDK 帧收集、经 turnUsage／decorate 补入契约，不必为了这一家扩大共享类型。〔一手〕`L:packages/brain/brain-shared/src/session.ts:393–395,475–500,510–520,568–569`、`src/paseo/agent/agent-sdk-types.ts:220–227`；〔推理〕。

以下依赖在“不迁”边界处截断，不顺着它们再引入整套 Paseo 运行时。Node 内建模块不是迁入文件；外部 npm 依赖为精确 SDK 0.3.263、现有 zod 4／lru-cache；pino 以已有 paseoLogger 的形状适配，p-limit 随导入调度裁掉，tree-kill／plugin/server 不增加。〔一手〕`P:claude/agent.ts:1–154`、`query.ts:1–9`、`import-descriptor-scheduler.ts:1`；〔推理〕。

| 目录外依赖 | 行数 | 处置 | 落位 | 依据 |
| --- | ---: | --- | --- | --- |
| `server/paseo-env.ts` | 82 | 不迁：Paseo 进程身份／环境专属，改用 scrubbedParentEnv、SDK env overlay | — | 〔一手〕`P-server:server/paseo-env.ts:1`；处置〔推理〕 |
| `utils/spawn.ts` | 78 | 不迁：经公共 processHost／launch.spawn，不迁 plugin/server 依赖 | — | 〔一手〕`P-server:utils/spawn.ts:1`；处置〔推理〕 |
| `utils/tree-kill.ts` | 122 | 不迁：SubprocessHandle.terminate＋waitForExit 是唯一进程组所有者 | — | 〔一手〕`P-server:utils/tree-kill.ts:1`；处置〔推理〕 |
| `server/agent/prompt-attachments.ts` | 223 | 不迁：公共输入已删除 Paseo 附件种类；agent.ts 删该不可达分支 | — | 〔一手〕`P-server:server/agent/prompt-attachments.ts:1`；处置〔推理〕 |
| `server/agent/permission-response.ts` | 40 | 不补迁：这是 AgentManager 的启动／答复编排，Claude 适配器未直接依赖；brains 已有答复 API | — | 〔一手〕`P-server:server/agent/permission-response.ts:1`；处置〔推理〕 |
| `server/agent/provider-runtime.ts` | 62 | 不补迁：这是多提供方运行时装配，还依赖 OpenCode bridge；灵鲸插件装配已有归属 | — | 〔一手〕`P-server:server/agent/provider-runtime.ts:1`；处置〔推理〕 |
| `packages/server/src/executable-resolution/executable-resolution.ts` | 181 | 不迁：间接依赖由 brain-shared 已改的可执行解析截断 | — | 〔一手〕文件:1；`L:packages/brain/brain-shared/NOTICE:36`；处置〔推理〕 |

### 3.3 与设计附录 A 的差异

| 项 | 附录 A | 实际盘点／建议 |
| --- | --- | --- |
| Claude 核心 12 文件 | ≈8,600 行 | **8,615 行**；数量近似正确，agent.ts 占 7,102 行，绝不是一个几百行薄封装。〔一手〕逐文件计数、`D:architecture/modules/01-agent-cli.md:367` |
| 子观察 | ≈1,110＋subagents 目录 | 三件 **1,113 行**，subagents 七件 **1,471 行**，合计需显式计入；不能把“＋目录”当零。〔一手〕逐文件计数、设计:368 |
| 模型目录等五件 | ≈1,030，全部不迁 | 实计 **1,034 行**；但 runtime-safety 用 parseClaudeCodeVersion，agent／子展示用 models helper，不能只删文件还留悬空导入。建议 models／manifest 原文件迁后裁至最小 helper（不迁目录产品功能），其余三件不迁。〔一手〕`P:claude/runtime-safety.ts:2,21`、`subagents/live-source.ts:6`、`agent.ts:39–50`；处置〔推理〕 |
| feature-definitions | 未单列 | **31 行**，建议随 fast／feature UI 裁掉。〔一手〕该文件:1；〔推理〕 |
| 共享增量 | 总盘点含未来共享项 | Claude 直接依赖已经覆盖，额外 prompt-attachments／Paseo env／spawn 不补迁；permission-response／provider-runtime 不因列在附录就引入。〔一手〕上表；〔推理〕 |
| 全量目录 | 未计测试 | 本地全部 **81 文件／33,214 行**；生产代码／测试夹具必须分开算。〔一手〕逐文件计数 |

### 3.4 测试与夹具逐文件处置

测试迁入 **tests/paseo/**，不放 src/paseo 的生产检查豁免区；以下是迁移范围，不是执行清单。大文件要按保留功能选用，不能把完整上游 test 目录复制后批量 skip；本次未运行其中任何真实测试。〔推理〕。

| 文件 | 原行数 | 处置 | 落位 | 依据 |
| --- | ---: | --- | --- | --- |
| `agent-commands.e2e.test.ts` | 61 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/agent-commands.e2e.test.ts:1`；处置〔推理〕 |
| `agent-commands.real.e2e.test.ts` | 51 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/agent-commands.real.e2e.test.ts:1`；处置〔推理〕 |
| `agent.auto-plan-approval.test.ts` | 92 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.auto-plan-approval.test.ts` | 〔一手〕`P:claude/agent.auto-plan-approval.test.ts:1`；处置〔推理〕 |
| `agent.background-subagent.test.ts` | 844 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.background-subagent.test.ts` | 〔一手〕`P:claude/agent.background-subagent.test.ts:1`；处置〔推理〕 |
| `agent.context-switch.real.e2e.test.ts` | 42 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.context-switch.real.e2e.test.ts` | 〔一手〕`P:claude/agent.context-switch.real.e2e.test.ts:1`；处置〔推理〕 |
| `agent.context-usage.local.e2e.test.ts` | 140 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.context-usage.local.e2e.test.ts` | 〔一手〕`P:claude/agent.context-usage.local.e2e.test.ts:1`；处置〔推理〕 |
| `agent.context-window.test.ts` | 218 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.context-window.test.ts` | 〔一手〕`P:claude/agent.context-window.test.ts:1`；处置〔推理〕 |
| `agent.env.test.ts` | 226 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.env.test.ts` | 〔一手〕`P:claude/agent.env.test.ts:1`；处置〔推理〕 |
| `agent.error-result.test.ts` | 226 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.error-result.test.ts` | 〔一手〕`P:claude/agent.error-result.test.ts:1`；处置〔推理〕 |
| `agent.event-stream.real.e2e.test.ts` | 502 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.event-stream.real.e2e.test.ts` | 〔一手〕`P:claude/agent.event-stream.real.e2e.test.ts:1`；处置〔推理〕 |
| `agent.history-load.test.ts` | 727 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/agent.history-load.test.ts:1`；处置〔推理〕 |
| `agent.history.test.ts` | 41 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/agent.history.test.ts:1`；处置〔推理〕 |
| `agent.image-rendering.test.ts` | 248 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.image-rendering.test.ts` | 〔一手〕`P:claude/agent.image-rendering.test.ts:1`；处置〔推理〕 |
| `agent.import-large-record.test.ts` | 53 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/agent.import-large-record.test.ts:1`；处置〔推理〕 |
| `agent.import-titles.test.ts` | 300 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/agent.import-titles.test.ts:1`；处置〔推理〕 |
| `agent.interrupt-restart-regression.test.ts` | 1090 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.interrupt-restart-regression.test.ts` | 〔一手〕`P:claude/agent.interrupt-restart-regression.test.ts:1`；处置〔推理〕 |
| `agent.live-settings.test.ts` | 157 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.live-settings.test.ts` | 〔一手〕`P:claude/agent.live-settings.test.ts:1`；处置〔推理〕 |
| `agent.max-effort.real.e2e.test.ts` | 68 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/agent.max-effort.real.e2e.test.ts:1`；处置〔推理〕 |
| `agent.nested-subagent-ownership.real.e2e.test.ts` | 149 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.nested-subagent-ownership.real.e2e.test.ts` | 〔一手〕`P:claude/agent.nested-subagent-ownership.real.e2e.test.ts:1`；处置〔推理〕 |
| `agent.real.e2e.test.ts` | 479 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.real.e2e.test.ts` | 〔一手〕`P:claude/agent.real.e2e.test.ts:1`；处置〔推理〕 |
| `agent.redesign.test.ts` | 2062 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.redesign.test.ts` | 〔一手〕`P:claude/agent.redesign.test.ts:1`；处置〔推理〕 |
| `agent.request-journal.test.ts` | 237 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.request-journal.test.ts` | 〔一手〕`P:claude/agent.request-journal.test.ts:1`；处置〔推理〕 |
| `agent.rewind-anchors.test.ts` | 319 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/agent.rewind-anchors.test.ts:1`；处置〔推理〕 |
| `agent.runtime-exit.test.ts` | 351 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.runtime-exit.test.ts` | 〔一手〕`P:claude/agent.runtime-exit.test.ts:1`；处置〔推理〕 |
| `agent.runtime-info.test.ts` | 48 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/agent.runtime-info.test.ts:1`；处置〔推理〕 |
| `agent.spawn.test.ts` | 105 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.spawn.test.ts` | 〔一手〕`P:claude/agent.spawn.test.ts:1`；处置〔推理〕 |
| `agent.sub-agent-replay.test.ts` | 1391 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.sub-agent-replay.test.ts` | 〔一手〕`P:claude/agent.sub-agent-replay.test.ts:1`；处置〔推理〕 |
| `agent.sub-agent-sidechain.test.ts` | 659 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.sub-agent-sidechain.test.ts` | 〔一手〕`P:claude/agent.sub-agent-sidechain.test.ts:1`；处置〔推理〕 |
| `agent.subagent-handback.real.e2e.test.ts` | 56 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.subagent-handback.real.e2e.test.ts` | 〔一手〕`P:claude/agent.subagent-handback.real.e2e.test.ts:1`；处置〔推理〕 |
| `agent.subagent-interrupt.test.ts` | 209 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.subagent-interrupt.test.ts` | 〔一手〕`P:claude/agent.subagent-interrupt.test.ts:1`；处置〔推理〕 |
| `agent.test.ts` | 4344 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/agent.test.ts` | 〔一手〕`P:claude/agent.test.ts:1`；处置〔推理〕 |
| `agent.voice-history-regression.test.ts` | 400 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/agent.voice-history-regression.test.ts:1`；处置〔推理〕 |
| `hooks.test.ts` | 36 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/hooks.test.ts` | 〔一手〕`P:claude/hooks.test.ts:1`；处置〔推理〕 |
| `models.test.ts` | 1019 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/models.test.ts:1`；处置〔推理〕 |
| `partial-json.test.ts` | 42 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/partial-json.test.ts` | 〔一手〕`P:claude/partial-json.test.ts:1`；处置〔推理〕 |
| `project-dir.test.ts` | 115 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/project-dir.test.ts` | 〔一手〕`P:claude/project-dir.test.ts:1`；处置〔推理〕 |
| `question-response.test.ts` | 164 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/question-response.test.ts` | 〔一手〕`P:claude/question-response.test.ts:1`；处置〔推理〕 |
| `replay-memory.fixture.ts` | 202 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/replay-memory.fixture.ts:1`；处置〔推理〕 |
| `rewind.test.ts` | 321 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/rewind.test.ts:1`；处置〔推理〕 |
| `sdk-behavior.real.e2e.test.ts` | 179 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/sdk-behavior.real.e2e.test.ts` | 〔一手〕`P:claude/sdk-behavior.real.e2e.test.ts:1`；处置〔推理〕 |
| `settings-argv.test.ts` | 46 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/settings-argv.test.ts` | 〔一手〕`P:claude/settings-argv.test.ts:1`；处置〔推理〕 |
| `sidechain-tracker.test.ts` | 172 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/sidechain-tracker.test.ts` | 〔一手〕`P:claude/sidechain-tracker.test.ts:1`；处置〔推理〕 |
| `subagents/live-source.test.ts` | 789 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/subagents/live-source.test.ts` | 〔一手〕`P:claude/subagents/live-source.test.ts:1`；处置〔推理〕 |
| `subagents/observation.test.ts` | 139 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/subagents/observation.test.ts` | 〔一手〕`P:claude/subagents/observation.test.ts:1`；处置〔推理〕 |
| `subagents/presentation.test.ts` | 31 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/subagents/presentation.test.ts` | 〔一手〕`P:claude/subagents/presentation.test.ts:1`；处置〔推理〕 |
| `subagents/replay-source.test.ts` | 743 | 迁后改测试：只验原生子观察恢复，不验灵鲸历史权威 | `brain-claude-code/tests/paseo/subagents/replay-source.test.ts` | 〔一手〕`P:claude/subagents/replay-source.test.ts:1`；处置〔推理〕 |
| `subagents/workflow-output.test.ts` | 65 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/subagents/workflow-output.test.ts` | 〔一手〕`P:claude/subagents/workflow-output.test.ts:1`；处置〔推理〕 |
| `subagents/workflow-replay-source.test.ts` | 229 | 迁后改测试：只验原生子观察恢复，不验灵鲸历史权威 | `brain-claude-code/tests/paseo/subagents/workflow-replay-source.test.ts` | 〔一手〕`P:claude/subagents/workflow-replay-source.test.ts:1`；处置〔推理〕 |
| `task-notification-tool-call.test.ts` | 113 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/task-notification-tool-call.test.ts` | 〔一手〕`P:claude/task-notification-tool-call.test.ts:1`；处置〔推理〕 |
| `task-state.test.ts` | 127 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/task-state.test.ts` | 〔一手〕`P:claude/task-state.test.ts:1`；处置〔推理〕 |
| `test-fixtures/import-session-native-titles.jsonl` | 6 | 不迁：对应导入／回滚／产品目录／Paseo历史 UI 路径已裁掉；原生恢复需要的断言另选保留 | `—` | 〔一手〕`P:claude/test-fixtures/import-session-native-titles.jsonl:1`；处置〔推理〕 |
| `test-rewind-claude-sdk.ts` | 36 | 不迁：回滚专用假 SDK | `—` | 〔一手〕`P:claude/test-rewind-claude-sdk.ts:1`；处置〔推理〕 |
| `tool-call-mapper.test.ts` | 481 | 迁后改测试：留相关断言，改共享导入、假 Query／进程与隔离配置；真实 e2e 默认不运行 | `brain-claude-code/tests/paseo/tool-call-mapper.test.ts` | 〔一手〕`P:claude/tool-call-mapper.test.ts:1`；处置〔推理〕 |


## 4. 契约映射与 Meta 草案

“能做到”指本机源码提供通路，需要新包实现；不等于本次已真机验收。以下 `B`＝`L:packages/brain/brain/src/contract.ts`，`W`＝`L:packages/brain/brain-shared/src/session.ts`。〔一手〕B:49–85,149–193、`provider.ts:77–192`。

| 契约／能力 | 结论 | Claude 落法、边界与依据 |
| --- | --- | --- |
| BrainProvider 登记／probe | 能 | 新插件登记；probe 经受管 exec 跑指定 binary 的 --version，版本不够明确 unavailable，不用 model-discovery 开模型会话。〔一手〕`provider.ts:158–192`、P:claude/agent.ts:1852–1984；落法〔推理〕 |
| createSession／resumeSession | 能 | 新代完整 cfg＋launch；sessionHome 用 per-member，writeMemberConfig 在 Claude 包；实际每个会话一个 Query／CLI。〔一手〕`provider.ts:149–192`、P:claude/agent.ts:1637–1685,3683–3688 |
| 流式 | 能 | includePartialMessages＋持续 query pump，流式 text／thinking／tool 转 BrainEvent；多订阅沿 W。〔一手〕P:claude/agent.ts:1244–1514,3692,4133–4253；W:610–665 |
| 续接 | 能 | persistSession:true，sessionRef／nativeHandle 为 Claude session UUID；新 Query 给 resume，并沿同一隔离 config 根查原转录。不能从任意不同目录空续。〔一手〕P:claude/agent.ts:2975–2989,3683–3688；P:claude/project-dir.ts:33–65；W:1046–1055 |
| 原生工具 tools:[] | 能 | SDK 明文规定空数组禁用全部 built-in；MCP 单独注册，因此工具全关不等于关内核 MCP；nativeTools:false 表示“能关掉”，不是 Claude 没工具。〔一手〕S:sdk.d.ts:1495–1508,2134；B:45–52 |
| readonly／worktree | 部分 | tools 白名单／disallowedTools＋SDK sandbox＋PreToolUse；Read/Bash 的参数和子 agent 的工具都需验证。仅 allowedTools 是免审批，不是可用工具白名单；plan 也不等于只读安全边界。不能保证的组合开会话时拒绝，尤其 readonly＋native child。〔一手〕P:claude/options.ts:48–87；S:sdk.d.ts:1495–1508；S:sdk.mjs:202 的 canUseTool shadow 提示；落法〔推理〕 |
| 权限审批 | 能，但非每次工具必回调 | canUseTool 只处理需要审批的调用；CLI 预批准／settings allow 可先批准，显式 deny 也可能先拒绝。kernel 模式要求每次工具都过内核判定时应在 PreToolUse 建门，不可只靠回调。禁用 bypass／acceptEdits／auto 等可改变审批语义的模式，或按 cfg 权限限制列表。〔一手〕P:claude/agent.ts:3693–3699,5207–5300；S:sdk.mjs:202；落法〔推理〕 |
| 本会话允许 | 能；原实现没接好 | 在 ClaudeBrainSession.permissionOptions 加 allow_session 选项，response 带 `updatedPermissions:[{type:'addRules',rules,behavior:'allow',destination:'session'}]`；只对能生成窄规则的工具显示，不能把整个 suggestions（可能 userSettings／setMode／目录扩权）照抄。W 已支持返回完整 response，不需公共改动。〔一手〕S:sdk.d.ts:2358–2387；P:claude/agent.ts:2956–2959,5240–5244；W:490–500,1024–1038；规则选择〔推理〕 |
| AskUserQuestion 结构化请求／allowOther | 能 | 原生 questions 有 question／header／options／multiSelect；Paseo 补 allowOther:true 并在回送前剥掉 UI 字段。公共类型没有 allowOther，但本提供方始终允许自由文字，公共 custom 正好能承载；不要把 Other 伪造为模型选项。〔一手〕P:claude/agent.ts:167–207；W:265–299；S:sdk-tools.d.ts:1045,2575–2591 |
| permissionAnswerInput | 部分；必须覆写 | 以契约 question.id 精确找原请求，答案键改成完整 question 文本。普通单选 → answers[全文]=label；纯自由文字 → string；选项＋补充文字可利用原生 annotations[全文].notes 保留补充（须验证实际工具输出保留，不能仅假 CLI 自洽）；多选原生输出是逗号分隔，标签含逗号、重复问题全文等不可逆组合必须 invalid_input、保持待答。绝不能把 {selected,custom} 直接交给旧字符串 normalizer，或盲目 join 后宣称无损。〔一手〕W:475–481,1030–1041；P:claude/agent.ts:217–301,2949–2955；S:sdk-tools.d.ts:2575–2591,3823–3845；编码边界〔推理〕 |
| next_step 插话 | 能 | SDKUserMessage.priority='next'；校验 captured query／input／expectedTurnId，压缩中 unavailable；保留 Paseo 竞态防护。〔一手〕P:claude/agent.ts:2607–2661；S:sdk.d.ts:5377 |
| next_turn 队列 | 部分；不能只复用 W 默认 deliver | W 在回合在跑／wake:false 时恒 unavailable；Paseo startTurn 也不是通用入队 API。Claude 包需覆写 deliver 并在迁入会话提供专用入队／撤回通路，确保 next_turn 不被 next_step 吞进当前回合；SDK 的 later 优先级可用于排到后续回合，但 idle＋wake:false 不能直接把消息送 CLI 后意外叫醒。未验前 Meta.nextTurn:false；这不是缺公共字段。〔一手〕W:970–981；P:claude/agent.ts:2507–2605,6610–6661；S:sdk.d.ts:5377；C:bin/claude.exe:2396549（276230639，later 不作 mid-turn 输入）；方案〔推理〕 |
| cancel／排队撤回 | 能；迁入代码要修错误处理 | 先 cancelAsyncMessage 撤未开始 UUID，再 interrupt；0.3.263 运行时有此控制，但公开 sdk.d.ts 仍未声明 cancelAsyncMessage，需把能力检测／窄类型扩展留在 Claude 包。Paseo interruptActiveTurn 却 catch 后只 warn，不能照搬：未确认停止必须拒绝，让公共层保持 stopping，不能假报已中断并接新回合。〔一手〕P:claude/agent.ts:4501–4568；W:990–996；`provider.ts:100–105`；S:sdk.mjs:123 的 cancelAsyncMessage；落法〔推理〕 |
| cancel 原因与原生子任务 | 能，需新增接线 | pause／drain／owner／hard_limit：对 roster 活任务 stopTask，再 interrupt；preempt／watchdog：perTaskStopAffordance:true 仅停主回合。Paseo 普通 interrupt 没按灵鲸原因停子任务，新包覆写 interruptTurn；close 经受管进程组清理。〔一手〕S:sdk.d.ts:1653–1672,2926；B:528；W:568–569；D:architecture/modules/01-agent-cli.md:204；hard_limit 落法〔推理〕 |
| 切模型 | 能 | Query.setModel，新包支持别名／供应商模型名并沿 W 核对 getRuntimeInfo；不复制目录，不猜不存在模型。运行中切模型的精确生效时机需 A2。〔一手〕S:sdk.d.ts:2643–2649；P:claude/agent.ts:2751–2768；W:1065–1088 |
| 切模式、plan | 能，受策略限制 | getAvailableModes／current／setPermissionMode；plan 通过 ExitPlanMode 请求计划批准。原 Paseo “批准即 acceptEdits”会改变安全策略，必须按 cfg 限制；不暴露 bypassPermissions，不能迁 3697 的 true。〔一手〕P:claude/agent.ts:2720–2748,2928–2947,3697；S:sdk.d.ts:2622；W:657–663 |
| 自动压缩 off（#36） | 源码证实有开关，仍需实测 | settings.autoCompactEnabled:false；更强的进程级 DISABLE_COMPACT=1 同时禁手动／插件 compact，DISABLE_AUTO_COMPACT 只关自动。CLI Fu 检查开关，idle 也先检查 Fu，reactive 路径 MJo 再检查 DISABLE_COMPACT。实例建议明确设 off 并拒绝矛盾覆盖；Meta 可候选 switchable，长上下文压力实测后兑现。〔一手〕S:sdk.d.ts:8181；C:bin/claude.exe:2388766（267171539，o/Fu）,2390214（269258757，m4o）,2391829（270028076，MJo）,2389524（268316105，session.compact 拒绝） |
| 推理预算 maxTurns | 部分 | 可给 limits.maxInferencesPerTurn；CLI agentic turns／API round-trips 有上限，主循环对应 #35。不是所有子 agent／辅助模型调用的全局总上限；并行子任务仍需外部预算／看门狗。stream 多回合的重置边界必须验证。〔一手〕S:sdk.d.ts:1772；C:bin/claude.exe:2382286（260131344，schema）、2397848（277119855，max_turns）、2415201（298104800，gk.tally 对 ownWord 清零）；〔推理〕不可等同全模型预算 |
| 工具次数预算 | 部分 | SDK 没有顶层 maxToolCalls；可在 Claude 包 PreToolUse 作原子计数，但要定义平行批次／子任务口径并验收。不做则 Meta.budget.toolCalls:false，交上层看门狗，不能宣称严格次数硬上限。〔一手〕S:sdk.d.ts 的 Options／HookInput；B:64,168–171；实现选择〔推理〕 |
| PostToolBatch＋concludeOn（#35） | 源码支持，需补成功判定 | PostToolBatch 在整批结束、下次模型请求前运行，continue:false → preventContinuation → hook_stopped，不会再普通续推理。hook 的 tool_response 只有 unknown，无必有 is_error；应合并 PostToolUse／Failure 或可信 toolport 成功事实，按 tool_use_id 判成功，防止失败工具误收尾；只认当前父回合允许的 MCP 收尾工具，不让子工具结束父回合。记录 concludedBy 后经 decorate 报 turn.completed。〔一手〕S:sdk.d.ts:2451–2468,8485–8502；C:bin/claude.exe:2392536（271074262，continue:false）、2397848（277113307–277114830，Fsr／hook_stopped）；D:architecture/modules/01-agent-cli.md:163；落法〔推理〕 |
| task_* → child.started／ended | 能 | 迁 live-source＋observation＋sidechain，过滤 local_bash／skip_transcript，未声明的任务不造 child；后台消息跨回合继续送达。**Paseo canonical id 是首次 Agent 工具调用的 tool_use_id，不是 task_id**；要么沿其稳定 ID，要么全套改为 task_id，不能只改事件字段。〔一手〕P:claude/subagents/live-source.ts:51–75,147–182；Paseo docs/agent-lifecycle.md:319–332；W:914–943 |
| 子权限 childId | 能；Paseo 原实现会丢 | SDK CanUseTool options.agentID 是原生子 id，对应 task_id；Paseo handlePermissionRequest 只留 toolUseID，未带 agentID。迁入时保留到 metadata，并经声明表映到 canonical id；覆写 permissionChildId。后台未知子请求也要保留事实／明确未知，不能冒充父来源。〔一手〕S:sdk.d.ts:248–250；P:claude/agent.ts:5215–5244；W:451–452；落法〔推理〕 |
| token／缓存／modelUsage | 能；不能沿旧映射 | result.usage 只有主循环本回合；modelUsage 包含主循环、Task 子任务、sidechain、压缩等 query-pipeline，且是**此 Query 生命周期累计**。按模型保存上次快照求差，再汇总 input/output/cacheRead/cacheWrite；total_cost_usd 也求差，续接／新 Query／clear 重设基准；不得对累计结果逐回合求和。原 Paseo buildResultUsage 用主循环且不报 cacheWrite，需要 Claude 私有 collector＋turnUsage／decorate。〔一手〕S:sdk.d.ts:1307–1320,4966–4976,5029–5039；P:claude/agent.ts:2199–2229；W:108–122,510–520 |
| 子分项用量 | 部分，拿不到完整 input/output 时留空 | task_notification usage.total_tokens 是最后上下文大小，不是累计花费，不能拆成 tokens.input/output；child.ended.usage 可 {}，总支出来自父 Query modelUsage 差量，勿再加子用量一次。离父回合后来的后台消耗需总量更新／后续 result 对账，无法准确归原回合时如实保留“会话级可归属，回合归属待验”。〔一手〕Paseo docs/agent-lifecycle.md:330–332；P:claude/subagents/live-source.ts:87–117；B:245–271,502；〔推理〕 |
| context_usage／压缩事件 | 能 | SDK context 与 compact_boundary 映到 Usage.context／session.compacted；context 是当前占用，不是 token 支出，不能同 modelUsage 累加。〔一手〕P:claude/agent.ts:2141–2279,6300–6325；B:409–414；W 的 timeline compaction 映射 |
| 图片输入 | 能（看具体模型） | Brain blob 经 launch.readBlob→toPaseoPrompt base64，再 SDK image content block；支持 MIME 需校验，模型不支持时报明确错误；不写临时用户图片路径。〔一手〕`L:packages/brain/brain-shared/src/turn-input.ts:1`；P:claude/agent.ts:3799–3858；S:sdk.d.ts:5365–5370 |
| 内核工具 MCP | 能 | SDK mcpServers 的 http／stdio 都支持；V1 toolport HTTP 带 session token；strictMcpConfig:true，显式 alwaysLoad 策略（工具搜索不能藏收尾工具，必要时关闭搜索），工具名 mcp__server__tool 与 concludeOn 的规范名统一。〔一手〕P:claude/agent.ts:1098–1125,3733–3735；S:sdk.d.ts:2134；B:97–140；落法〔推理〕 |
| persona／rules／skills／projectDocs | 部分 | custom stable＋notes／work preset append 均有 SDK API；settings／memory 不是同一开关。tools:[] 下 Skill built-in 被关，不能承诺仍能调用技能，需拒绝冲突或预渲染说明（后者须主人定）。成员配置更新与在跑进程 snapshot／同成员并发会话不要互相覆盖策略。〔一手〕S:sdk.d.ts:2108,2240–2246；P:claude/agent.ts:3703–3708；B:149–193；〔推理〕 |
| rollback／quota | V1 不做 | Meta.rollback:false；usage:'tokens'，不因 SDK 新增 rate_limit_event 就宣称完整订阅额度查询；modelUsage 不等于订阅余额。〔一手〕B:54,65；D:architecture/modules/01-agent-cli.md:294；S:sdk.d.ts:4937–4955；〔推理〕 |

### Meta 草案

以下为**保守的首轮能力声明**，不是把未实测项直接登记为事实。nextTurn 与 concludeOn 在单独探针通过后再翻 true；压缩 switchable 的源码证据较充分，但实例开放仍以 #36 实测为门槛。若主人要求按已定 V1 完整范围交付，不能以这份保守声明代替补完能力。〔一手〕B:49–85；D:architecture/modules/01-agent-cli.md:307–309；〔推理〕。

```ts
{
  streaming: true,
  resume: true,
  nativeTools: false,
  permissionHook: true,
  rollback: false,
  modelSwitch: true,
  modeSwitch: true, // 仅当前 cfg 许可的安全模式
  delivery: { nextStep: true, nextTurn: false, cancelKeepsQueue: false },
  compaction: 'switchable', // #36 验收前不开放实例
  budget: { inferences: true, toolCalls: false, concludeOn: false },
  usage: 'tokens',
  personaInjection: {
    instance: 'system_prompt', work: 'preset_append',
    think: 'system_prompt', own: 'system_prompt', tidy: 'system_prompt',
  },
  runtime: 'subprocess', transport: 'claude-sdk',
  kernelTools: ['mcp-http', 'mcp-stdio'],
  binary: { command: 'claude', minVersion: '2.1.318' },
  children: { native: 'observe', crossCli: true },
}
```

各 true 仍须对应契约／A2 通过；inferences 只声明主循环 maxTurns，不声明子任务总推理预算。crossCli:true 是能经内核 MCP 开第三层子活的协议能力，不代表本阶段 `openChildTask` 已实现。成熟候选值：nextTurn:true（Claude 包专用队列通过），concludeOn:true（成功批收尾通过）；不保证的工具硬上限仍为 false。〔一手〕`L:packages/brain/brain/src/index.ts` 的 openChildTask not_implemented；〔推理〕。


## 5. 配置隔离与登录

**目录隔离不会自动继承默认订阅登录。推荐灵鲸专用目录单独登录，或显式注入 API Key；不要默默共享主人的默认凭据。**〔一手〕`S:sdk.mjs:202` 的 `EZ`、`C:bin/claude.exe:2382003` 的 `qz`；〔推理〕选择仍需主人确认。

本机 CLI 是原生 Bun 打包文件，内含可读的 bundled JavaScript；本次用 Python 只读该安装文件，在内存定位代码，没有执行提取器、没有生成源码文件。这里 `C:bin/claude.exe:<行>` 是按文件原始字节的 LF 计数定位，并附字节偏移和符号方便复查；不是把二进制里的字符串误当运行结果。没有读取任何用户配置、环境凭据值或钥匙串。〔一手〕本次静态定位。

| 问题 | 源码事实 | 依据 |
| --- | --- | --- |
| 配置与转录位置 | `CLAUDE_CONFIG_DIR` 影响 config 根；转录按 cwd 编码在 `<config>/projects/<项目>/<session>.jsonl`；全局用户状态 `.claude.json` 也要考虑，不只是 settings.json | 〔一手〕`S:sdk.mjs:116` 的 `Gt`、`:119` 的 `ave`；`P:claude/project-dir.ts:18–65,119–126` |
| macOS OAuth 存哪 | 安全存储载荷含 `claudeAiOauth`（accessToken / refreshToken 等）；macOS 走钥匙串 generic password；另有 `<凭据根>/.credentials.json` 文件后端／回退，不能假定只在文件或只在钥匙串 | 〔一手〕`C:bin/claude.exe:2382015–2382016`（259471765、259474102、259474975），`:2382521`（261446360，`claudeAiOauth` 更新） |
| 服务名 | 生产默认通常是 `Claude Code-credentials`；设 config dir 后变为 `Claude Code-credentials-<SHA256(NFC目录字符串)前8位>`；OAuth 环境（本地／staging）还可能加 `OAUTH_FILE_SUFFIX`。账户字段来自 USER / OS username，目录不是账户名 | 〔一手〕`S:sdk.mjs:202` 的 `EZ/xZ/bZ`；`C:bin/claude.exe:2382003`（259464863–259465294，`qz/R0`） |
| 独立控制凭据根 | `CLAUDE_SECURESTORAGE_CONFIG_DIR` 若存在，覆盖凭据命名／文件根；空字符串明确选默认身份（无目录 hash），而非“没配”。必须清掉继承来的此变量，或显式设为隔离目录 | 〔一手〕同上 `qz`、`Z$`（259464882）；〔推理〕启动环境规则 |
| 隔离后凭据从哪来 | 在那份独立目录下新登录生成对应身份，或由宿主显式提供 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN`；空的新目录并无现成登录 | 〔一手〕`C:bin/claude.exe:2382520`（261418871 `Aa`、261422067 `Tx`）；〔推理〕 |
| API Key 与中转 | API Key／Bearer 都有源码入口，Anthropic 客户端有 `baseURL = ANTHROPIC_BASE_URL`；因此可用兼容 Anthropic Messages API 的中转，但不能保证任意 OpenAI API 中转可用；中转模型与工具协议仍需验 | 〔一手〕`S:sdk.mjs:72` 的 `Nt` 构造器；`C:bin/claude.exe:2382520` 的 `Tx/fg`，`:2408205`（288445598，CLI 自带说明明确 BASE_URL＋API_KEY／AUTH_TOKEN）；〔推理〕协议限制 |
| SDK 自己会不会取默认凭据 | 普通 query 的 `env` 默认是 process.env；可给显式 scrubbed env。尤其 `sessionStore` 恢复路径会读配置、复制凭据，并在没给 config dir 且没显式 key/token 时调用钥匙串；第一版不要启用它 | 〔一手〕`S:sdk.mjs:121,221–222` 的 `bne/int`；`S:sdk.d.ts:1682–1687`；〔推理〕避免额外全局读取 |
| “只读目录”字面含义 | CLI 必须能写转录、OAuth 刷新／状态；只能理解成“规矩／配置由灵鲸拥有，CLI 不自行决定来源”，不能把整个 config dir chmod 只读 | 〔一手〕`S:sdk.d.ts:1682–1687`；`C:bin/claude.exe:2382521` 的凭据刷新写入；〔推理〕需澄清设计措辞 |

| 可选方案 | 隔离效果与代价 | 推荐 |
| --- | --- | --- |
| A：灵鲸专用 config／securestorage 目录下由主人单独 OAuth 登录 | 不读默认用户目录／默认钥匙串身份；订阅仍是同一账户额度，目录不能隔离计费；每成员一份身份会增加登录／刷新维护 | **订阅方式首选**，凭据目录路径必须稳定；登录是后续经主人操作的前置，不是本次动作。〔一手〕上述服务名与存储逻辑；〔推理〕 |
| B：宿主显式注入 API Key＋可选 BASE_URL | 无需默认订阅凭据；按 API 账户或中转计费；密钥只在受控环境注入，不写报告、argv、ResumeHandle 或日志 | **最容易做独立验收**；可用专用额度的 key。〔一手〕上述入口；〔推理〕 |
| C：隔离配置但 securestorage 指默认身份（空字符串），或宿主读取默认 OAuth 再注入 | 技术上可共享默认登录，刷新和过期仍要管；和“不读主人全局配置／凭据”的当前要求冲突，不应悄悄采用 | 不推荐；若主人确实要共享，必须先明确修改凭据隔离要求。〔一手〕`qz/Z$`；〔推理〕 |
| D：复制默认 .credentials.json／导出钥匙串 | 会触碰明确禁止的来源、复制敏感材料，且容易引入刷新竞争／失效副本 | 不推荐。〔一手〕当前任务硬规则；〔推理〕 |

**配置隔离还有两项不能照设计原文推断。**`settingSources:['user','project']` 会加载项目 `.claude/settings.json`，其中 hooks、插件／权限等不是 CLAUDE.md；`claudeMdExcludes` 只过滤 memory 文件，不会过滤 hooks／commands 的配置。`plugins` 省略也不等于关掉配置里启用的插件；`strictMcpConfig:true` 才能强制仅用 SDK 给的 MCP。因此要把“允许项目事实文件”与“允许项目设置执行”分别验证，并由 Claude 包明确限制设置、钩子、插件与 MCP 来源；若 SDK 不能按已定边界实现，应拒绝该配置或请主人确认降级，不能放宽。〔一手〕`S:sdk.d.ts:2075–2085,8144–8147`、`P:claude/agent.ts:157–161,3690–3735`；〔推理〕。

“从不读 ~/.claude”还不能仅凭 settingSources 声明保证：CLI 有设备身份 `p_r()` 固定拼 `homedir()/.claude/.device-keys.json` 的可选路径；是否进入由认证／远程功能路径决定。第一版应关掉无关远程功能，A2 以文件访问审计验证，而不只检查有没有新文件。〔一手〕`C:bin/claude.exe:2386243`（263968439，`p_r/uMt`）；〔推理〕；本次不调用此路径，也不判断主人机器是否存在该文件。

## 6. 公共层改动

**不能无条件写“无”。提供方接入、配置生成与共享转换主体不用改；但要如实汇总取消／失败回合的支出，公共用量结算至少需要一个小补口。**这不是要求重做提供方接口，也不是新增 Claude 名字分支。〔一手〕`L:packages/brain/brain/src/session.ts:473–494`、`contract.ts:397–405,487`；〔推理〕。

| 核实项 | 结果 | 最小落法／影响 |
| --- | --- | --- |
| 配置目录不按厂商 switch | 已满足 | provider.writeMemberConfig、sessionHome 已存在，新 Claude 包自己写；不恢复已删的公共 claude.ts。〔一手〕`provider.ts:149–171`、`index.ts:334–337,475–478` |
| Query 进程与 SDK bridge | 已满足 | launch.resolveExecutable／spawn＋底座 claudeSpawnSpec／ManagedClaudeCodeProcess 够用；可扩展新包内 process.ts 的 stderr 管道与诊断，不引入第二进程所有者。〔一手〕`provider.ts:21–49`、`session.ts:383–390,420–435`；底座 `process.ts:46–159` |
| 结构化问答／会话允许／子归属 | 已有扩展点 | permissionAnswerInput／permissionOptions／permissionChildId 已可覆写；编码器在新包严格 src，原 Paseo 文件只接线；影响仅 Claude。〔一手〕`brain-shared/src/session.ts:451–500,1015–1041` |
| 累计 modelUsage、cacheWrite、concludedBy | 新包可自行做 | 私有 raw SDK collector＋turnUsage／decorate／childUsage；不往 brain-shared 的 AgentUsage 加厂商字段。〔一手〕`brain-shared/src/session.ts:393–395,510–520`；〔推理〕 |
| next_turn、按原因 cancel、真实错误传播 | 新包可自行做 | 覆写 deliver／interruptTurn，迁入原会话增加受控入口，不改公共方法签名。〔一手〕同文件:568–569,970–995；〔推理〕 |
| **取消／失败支出汇总** | **公共缺口** | 成功回合 `accumulateUsage`；interrupted／failed 没 usage；update 只 latestOnly（忽略 token／推理），因此 Claude 即便准确报中途花费，usage() 总计仍漏算。最小建议：给这两种终止事件增加可选 usage，ManagedBrainSession 收到时按回合只结算一次；共享映射有该值时传递，新 Claude 包从 SDK result 供应。不应把失败伪装 completed，也不应把所有 usage.update 盲目累加。〔一手〕`brain/src/contract.ts:397–405,487`、`brain/src/session.ts:473–494`、S:sdk.d.ts:4957–4976；补法〔推理〕 |
| 后台任务／崩溃前最后未结支出 | 受上游可观测性限制 | 尚无 SDK result 的消费无法凭空还原；若要求 `usage.update` 里的支出也进入总计，必须另定“累计还是差量／如何与终止结果去重”，当前字段未约定。可先把完整“已知终止结果”结算补齐，未知部分明确 incomplete，不能假填 0。〔一手〕S:sdk.d.ts:4974；`brain/src/session.ts:491–494`；〔推理〕 |

建议最小公共改动影响：`brain/contract.ts` 的两个可选字段、`brain/session.ts` 的幂等结算、`brain-shared/session.ts` 的可选透传／测试及 brain-testkit 的失败／取消有消费用例。ACP／DeepSeek 继续不带可选字段时行为不变，补带后才能改善自身取消支出漏计；需要跑现有三类契约回归，防止 update＋terminal 重算。**这些是待确认的最小改法，不是本任务已修改的代码。**〔一手〕现有字段均可向后兼容扩展；〔推理〕。

前次 07 报告结论限定在当次列出的 N1/N2/N3 与共享转换能力，不能证明未来厂商所有用量口径都已覆盖。本次不推翻当次已验证修复；新增判断来自 SDK 明确给出的失败结果用量与当前总计分支对照。〔一手〕`参考-第1-2步记录/07-Codex复核-第二轮修复.md` §4；上述源码。


## 7. 对第 3 步的约束

只列 Claude 加入后必须满足的条件，不给常驻服务的实现方案。〔推理〕以下各项从当前 seam 与 Paseo 生命周期推出。

| 终端操作／主题 | 约束 | 依据 |
| --- | --- | --- |
| run／start、进程归属 | CLI 客户端退出不能带走会话 owner 的 Cordis context；常驻宿主必须持有 BrainSession、Query 输入流、待审批 Promise、每会话的受管 CLI。SDK 内部重开 Query 也必须经 launch.spawn 登记，不脱管 | 〔一手〕`brain/src/session.ts:383–435`、P:claude/query.ts:63–106；〔推理〕 |
| ls／status／inspect | 区分前台 idle、后台 native child 仍在跑、待审批、stopping、process 已退出；“主回合结束”不能直接显示为可回收／已停稳 | 〔一手〕P:claude/agent.ts:2992–3000；P:claude/runtime-safety.ts:29–40；〔推理〕 |
| 续接句柄 | 原生 UUID 可能初始化后才有；一旦 persistence 非 null 就可靠保存，并随会话代次、impl、config 根、cwd 关联。不能只靠 liwa session id；恢复时给新代完整 cfg，不把旧 MCP token／密钥塞 metadata | 〔一手〕W:1046–1055；`brain/src/provider.ts:186–192`；P:claude/project-dir.ts:33–65；〔推理〕 |
| logs／attach | 灵鲸自己的事件记录提供回放；Claude native projects 转录只是原生 resume 所需旁存，不是灵鲸经历流真相。新订阅从订阅时开始，attach 不能用先快照后订阅的竞态漏事件；需明确日志游标和会话／代次 | 〔一手〕`brain/src/session.ts` 的 EventQueue、`BrainSession.events`；D:architecture/modules/01-agent-cli.md:12,233,383；〔推理〕 |
| 转录位置 | 必须保存稳定 `<成员>/brains/claude/projects/<cwd编码>/<native UUID>.jsonl` 与关联子 sidecar；同成员多会话共用根，不得全目录 rm 一个会话；dataDir 的灵鲸日志与 native 项目目录要分别登记 | 〔一手〕P:claude/project-dir.ts:18–65；S:sdk.d.ts:1041,1674–1687；〔推理〕 |
| send | 支持 expectedTurnId／next_step／next_turn／wake；native 队列不能与宿主队列重复投递；accepted 仅表示收下，不能宣称模型已看到。nextTurn:false 时由调用方回合边界排队，不静默丢弃 | 〔一手〕B:509–525；W:970–981；P:claude/agent.ts:2607–2638；〔推理〕 |
| wait | 权限请求是等待人的检查点，不是终止；前台 terminal 与后台任务完成是两个等待条件；明确 wait 默认等哪一个、超时退出不隐式 stop | 〔一手〕Paseo docs/agent-lifecycle.md:55–63,175–176；〔推理〕 |
| permit | CLI 返回／attach 断开后 SDK canUseTool 的 Promise 仍在宿主挂起；用 session＋requestId＋generation 路由，答复成功才删 pending，失败可重答；只显示安全的会话允许规则，子权限直达主人；重启后的旧 requestId 不能冒充仍可作答 | 〔一手〕P:claude/agent.ts:2914–2925,5260–5299；`brain/src/session.ts:658`；〔推理〕 |
| stop | 与 cancel 原因、keepQueue 明确对应；pause／owner 应停后台任务，preempt／watchdog 保留；失败不可显示“已停”，stopping 继续拒绝 send／新回合 | 〔一手〕`brain/src/session.ts:639–654`；S:sdk.d.ts:1653–1672；〔推理〕 |
| archive／delete | archive 是保留续接资料的逻辑结束；delete 先停稳，再删确切本会话转录／sidecars／灵鲸日志；成员 OAuth 身份及同成员其他会话不得随单会话 delete 擦掉 | 〔一手〕Paseo docs/agent-lifecycle.md:211–218；P:claude/project-dir.ts:38–65；〔推理〕 |
| restart／常驻恢复 | 当前公共表只在内存，已有 process view 无 OS pid／出生身份，不能宣称它已支持崩溃后清孤儿；第 3 步能做的能力与后续第二层责任按主人顺序分清，至少承认 A2 kill-9 清孤儿依赖未来持久身份核对，不能乱杀所有 claude | 〔一手〕D:architecture/modules/01-agent-cli.md:43–51,288–290；`brain/src/views.ts`、`session.ts:424–434`；〔推理〕 |
| provider | 探测同一被选的可执行路径，不探订阅、不发模型请求；安装存在与认证可用分开显示。SDK、运行 CLI、最低版本与失败原因可检查 | 〔一手〕`provider.ts:60–68`、S:sdk.d.ts:1822；〔推理〕 |
| usage | token 包含 cacheRead／cacheWrite；每 Query modelUsage 差量；区分估算美元与订阅额度；记录来源 turn／update／child，不能总计把子分项加两遍；失败取消结算见 §6 | 〔一手〕S:sdk.d.ts:4966–4976；`brain/src/views.ts`、`session.ts:491–494,554–566`；〔推理〕 |
| 闲置回收 | canStopRuntime:false／超时／未知 roster 一律保留；空 roster 还要等已挂起 completion notification 被消费，不能只看孩子列表为空 | 〔一手〕P:claude/runtime-safety.ts:29–40；`brain/src/session.ts:751–761` |


## 8. 测试与验收方案

本次未运行任何模型会话、测试或构建。下表是实施时的验收计划；测试文件／缓存／转录的生成均属于后续实现任务，本次没有创建。〔一手〕本次执行范围。

### 8.1 契约：假 CLI 为主，固定帧回放为辅

| 层 | 怎么验 | 为什么这样验／依据 |
| --- | --- | --- |
| 公共契约 | `describeBrainProviderContract`（testkit `src/contract.ts:159`）接新 Claude provider；用 **官方 SDK＋假 stream-json CLI 子进程**，经真 launch.spawn／ManagedClaudeCodeProcess。脚本按 SDK control_request 应答 init／permission／interrupt／set_model／set_permission_mode／cancel_async_message／stop_task，发约定 SDK 帧 | 不能只拿 ScriptedBrainProvider 证明 Claude 接通；真实子进程能验 ownership／关闭／重启／流协议。〔一手〕`brain-testkit/src/contract.ts:1–9,36–76`、`harness.ts`；S:sdk.mjs:121–123；落法〔推理〕 |
| 转换单测 | Paseo 假 Query 帧、固定脱敏 task 协议和故障序列回放；纯 codec／计量函数给精确输入输出 | 固定帧更适合覆盖竞态、嵌套子归属、重复通知、累计归零；不依赖模型服从提示。〔一手〕P:claude/agent.interrupt-restart-regression.test.ts:1、subagents/live-source.test.ts:6；〔推理〕 |
| 关键异步行为 | 取消撤未读 steer、撤回时恰好已 dequeue、新回合紧跟取消、迟到旧 result、SDK 控制超时／拒绝不假成功、idle exit、后台孩子跨回合、roster 清空但通知未到 | 这是公共 contract 和原 Paseo 代码真正承担的义务。〔一手〕testkit contract.ts:352–390；P:claude/agent.ts:4501–4568；runtime-safety.ts:29–40 |
| 结构化问答 | 正常单选、多选、自由文字、选项＋notes；问题全文重复／选项含逗号／多选含歧义／原生不保留 annotations 的组合必须报 invalid_input、可重新答，不偷拼展示文本 | testkit 的 answers 场景要求任意逗号＋结构完整，Claude 原生格式做不到全覆盖，应显式 unsupported:'answers' 并给原因，同时**另测**实际支持和拒绝边界；不是放宽整个套件。〔一手〕testkit contract.ts:28–34,71–72,120–128；S:sdk-tools.d.ts:3823–3845；〔推理〕 |
| 用量 | 两回合 cumulative=100→150 只计100＋50；缓存创建／读取分开；多模型／子模型；新 Query／clear／恢复清零；失败／中断消费不漏、重复 result 不重算、child 分项不叠总额 | 新 SDK 注释已定义累计口径；补 §6 回归是必要检查。〔一手〕S:sdk.d.ts:4966–4976；brain/src/session.ts:473–494；〔推理〕 |
| 配置 | 构造宿主污染环境和项目夹具：假的全局 hooks／MCP／plugin、项目 hooks 与 docs 不同 sentinel，输出最终 SDK options／受管 spawn spec，确认保留灵鲸钩子且无额外工具来源 | 不能靠字符串中出现 CLAUDE_CONFIG_DIR 就证明隔离。Fake 不会验证真 CLI 的文件加载，仍需下面 A2。〔一手〕P:claude/agent.env.test.ts:1；S:sdk.d.ts:2075–2085,2134；〔推理〕 |
| 检查范围 | 新 package 单元／contract，现有 brain／shared／ACP／DeepSeek／testkit 回归；自写 src 按原 100% 覆盖率门槛；迁入 src/paseo 保持既定例外，纯自写 codec／process／collector 不放进去；最终 build:artifacts 后 build:check、lint、相关文档 doc-sync | 〔一手〕L:AGENTS.md“检查”“技术约定”、brain-acp/tsconfig.json:8–18；〔推理〕实施检查选择 |

建议未来执行入口是 `pnpm exec vitest run packages/brain/brain-claude-code/tests/contract.spec.ts` 与相应单测；真实 e2e 必须独立显式 opt-in，不能混进无凭据 test 默认入口。录制回放仅用仓库内可公开的脱敏固定帧／人造数据，不录主人的原始会话、凭据或机器配置。〔一手〕任务硬规则与公开仓库规则；〔推理〕。

### 8.2 真 CLI：A2 分成有成本的受控验收

**会消耗额度。**订阅 OAuth 用同一账户，无论目录／HOME 怎么隔离都仍会消耗其订阅额度，可能还触发账户已启用的超额计费；API Key 则按 API 或中转付费。`maxTurns=3` 不是美元或所有 helper 调用的绝对限额。要做本轮禁止的真会话，必须由主人另行授权和准备身份；本报告不请求／执行。〔一手〕S:sdk.d.ts:1772–1782,4966–4976；C:bin/claude.exe:2382520 的认证源；成本归属〔推理〕。

| 前提／用例 | 验收要求 |
| --- | --- |
| 身份与目录 | 先选 §5 A／B；专用临时 worktree、稳定测试 config 根及 securestorage 根、独立 cwd／dataDir／临时 HOME；只显式注入必要认证项，清掉 inherited host auth／profile／securestorage 覆盖。订阅登录只能由主人后续在该隔离身份完成，不从默认目录复制凭据。〔一手〕§5 源码；〔推理〕 |
| MCP | 使用只暴露 `conclude`／计数工具的本地受控 HTTP MCP，带专用测试令牌；toolport 未搭好可用同协议夹具代替，只证明提供方通路，不能说完整 toolport 已验收。〔一手〕B:158–159；D:architecture/modules/01-agent-cli.md:89,290,301；〔推理〕 |
| 最小连通 | 真 binary 2.1.318＋SDK0.3.263；think custom prompt、tools:[]，只调一次 MCP conclude；核对实际 init 版本／配置根、完整流式与 concludedBy、无内置工具。〔一手〕设计:301；〔推理〕 |
| #35／次数 | 强制工具驱动的 4 步任务，maxTurns=3 确认第四次主推理没发；另测成功收尾阻止续推理、失败收尾继续／报错、同批多个工具、子工具不能收掉父。用协议记录／服务端计数验证，不靠模型一句“我停了”。〔一手〕C:bin/claude.exe:2397848；〔推理〕 |
| #36／隔离 | 先查可观测 autocompact/context 状态，再用足够长的受控上下文触发阈值验证不开压缩；成本高的压力试验单列。文件访问审计验证不访问禁止全局配置，不仅读“没有新增转录”；核对项目 docs sentinel 可见而项目 hooks／额外 MCP／插件不执行。〔一手〕S:sdk.d.ts:3702–3703；C:bin/claude.exe:2382286 的 autocompact_state；〔推理〕 |
| 问答／权限／子观察 | 少量确定性提示或受控工具诱发 request，测 allow_once／allow_session／deny／cancel；子 Agent 只开一个，验证 child.started/ended、agentID 映射、owner 停子任务、preempt 保留、后台消费计量。不同认证／中转能力可能不同，失败就记录真实限制。〔一手〕设计:303；〔推理〕 |
| resume／插话 | 进程正常关闭保留资料，用相同 config 根＋UUID 新 Query 续接；验证 next_step 内容在下一模型请求出现，撤回后不重启旧回合；如实现 nextTurn 再单验队列。〔一手〕设计:301；P:claude/agent.ts:2607–2638,4546–4568；〔推理〕 |
| kill-9／清理 | 必须到具备持久进程身份与安全对账能力的阶段才验“下次启动清孤儿”。当前 brains 只内存登记，不能靠手工 kill 全部 claude 冒充 A2 已过；测试结束释放确切进程组、MCP、临时目录，认证撤销／保留按主人选择。〔一手〕设计:43–51,288–301；〔推理〕 |

这组真机验收应先跑最小一回合拿到实际成本／用量，再决定是否继续长上下文／子任务压力用例；未跑的逐项保留，不把 fake CLI 全绿当 A2。〔推理〕。


## 9. 工作量与拆分

预计 **10–16 个工程人日＋独立评审约 2–3 人日**，不含第 3 步常驻服务、不含 toolport／minds／guard，也不含等待主人完成登录／成本批准的时间。规模依据是 11,883 行迁入原始输入（最终 vendor 约8,000–10,500）、自写严格源码约1,200–2,000、选留／改造测试约4,000–7,000行；大头是生命周期与隔离验证，不是复制文件。是估算，不是承诺工期。〔一手〕§3 清单；工时／最终行数〔推理〕。

| 块 | 可单独实现／交回的边界 | 规模与验收 | 可交 GLM？ |
| --- | --- | --- | --- |
| 0：先锁定边界与探针用例 | 版本／认证方式、项目可执行配置边界、#35／#36、问答原生表达能力；只产出结论和固定脱敏帧 | 0.5–1日；真试验须另授权，有失败也可独立评审 | 不建议：涉及安全取舍与未定语义。〔推理〕 |
| 1：来源迁入与裁剪 | 依 §3 的24文件逐个处理、共享 import、NOTICE／许可；产出可编译的低层事件与私有会话，删除不迁入口 | 1.5–2.5日；原始差异可逐文件对照 | **机械搬迁／来源头／导入替换可交 GLM**；删生命周期分支、models helper 收缩由有经验实现者评审。〔一手〕§3；〔推理〕 |
| 2：受管进程／版本／配置 | process bridge、外部 binary 解析与 --version、writeMemberConfig、env conflict、配置来源 admission；可用 fake SDK spawn 独立测 | 1.5–2.5日；逐项 isolation／进程释放测试 | 认证／隔离主逻辑不建议；manifest／tsconfig／locale 接线在字段定死后可交 GLM。〔推理〕 |
| 3：契约交互 | ClaudeBrainProvider／Session；结构化 codec、allow_session、子权限、模式限制、next_step／next_turn／取消确认 | 2–3日；testkit＋专属不可编码／竞态用例 | 纯 codec 正反例在规格确认后可交 GLM；会话并发／安全审批留主实现者。〔一手〕§4；〔推理〕 |
| 4：原生观察与用量 | task-id／canonical-id 对照、后台 roster、stopTask 原因表、modelUsage 差分／缓存／归零；只通过已有事件接口输出 | 1.5–2.5日；固定帧序列可独立评审，不依赖真实模型 | 纯数学差分、重复帧用例可交 GLM；后台生命周期／预算归属不建议。〔推理〕 |
| 5：预算／收尾／公共结算补口 | SDK maxTurns、PostToolBatch success ledger、compaction off；§6 的可选终止 usage 与幂等汇总作为单独小变更 | 1–2日；失败／取消消费与三类旧 provider 回归；#35／#36探针另记 | 不建议主改交 GLM；既定格式的测试数据可以。〔推理〕 |
| 6：装配与 A2 交付 | 插件包 package／exports／TS refs／产品正常装配、文档／NOTICE；fake 契约与真 CLI 验收记录 | 1–2日；原产物检查＋真实成本／限制清单 | **包元数据、文档、固定装配行可交 GLM**；A2与凭据操作由授权实现者／主人。〔推理〕 |

每块应交“文件清单＋原地差异＋相关测试原文＋未验项”；低层块可先以假宿主独立验，集成顺序为 0→1/2→3/4→5→6。同一个 `paseo/.../agent.ts` 的改动应顺序合入，不把多个实现者同时派去改它；本次未派任何 agent。〔一手〕任务书与 handoff 协作规则；〔推理〕。


## 10. 风险与待定点

| 优先级 | 风险／要主人定的点 | 推荐与理由 | 依据 |
| --- | --- | --- | --- |
| P0／待定 | 订阅还是 API／中转，凭据是否独立 | 先选独立 OAuth 身份或专用 API Key；默认不共享主人的默认 securestorage。配置隔离不能隔离计费，不能静默改读全局凭据 | 〔一手〕§5 的 qz／Z$／Aa／Tx；推荐〔推理〕 |
| P0／待定 | 项目 CLAUDE.md 可读，项目 settings／hooks／plugins 是否可执行 | 维持已定“不读用户配置、项目只当事实”；不要用 claudeMdExcludes 假装隔离可执行配置。优先试验“只加载受信生成设置＋受控注入项目指令”；若需扩大来源，先由主人确认 | 〔一手〕S:sdk.d.ts:2075–2085,8144–8147；推荐〔推理〕 |
| P0／待定 | **公共层小补口是否纳入本轮** | 建议纳入可选 terminal.usage＋幂等结算，至少不漏已知取消／失败消费；若先不改，应明确本轮 usage 总计不完整，不能写“完整记账” | 〔一手〕brain/src/session.ts:473–494；S:sdk.d.ts:4957–4976；推荐〔推理〕 |
| P1／待定 | SDK 自带263 vs 本机318、最低版本 | 精确 SDK0.3.263＋显式外部 binary；minVersion建议2.1.318作首个验收基线。2.1.292只是 roster 的已知门槛，未证明所有新选项在该版可用 | 〔一手〕S:package.json:83；P:claude/runtime-safety.ts:19–40；推荐〔推理〕 |
| P1／待定 | Claude 当实例是否首轮开放 | 先完成 off＋tools:[]＋MCP conclude 的真实探针，成功才开放；否则暂限活，按设计如实声明 always_on／预算缺项，不偷偷放自动压缩进实例 | 〔一手〕设计:163–164,307–309；C:bin/claude.exe:2388766,2397848；推荐〔推理〕 |
| P1／待定 | 问答的不可逆组合 | 允许 SDK 能表达的答案，带歧义逗号／重复全文等明确拒绝；选项＋补充优先 annotations.notes，若真 CLI 不保留则拒绝组合或请主人选产品降级，不能拼成展示文字冒充结构 | 〔一手〕S:sdk-tools.d.ts:2575–2591,3823–3845；W:475–481；推荐〔推理〕 |
| P1 | 原 Paseo 取消吞错、永久 bypass 能力 | 必须在新包改；停止未确认继续接活会串会话，bypass 能力与 kernel 审批相冲突 | 〔一手〕P:claude/agent.ts:3697,4531–4538；provider.ts:100–105；判断〔推理〕 |
| P1 | childId 不是 task_id、子权限漏 agentID | 保留稳定 canonical 映射，任务停止用原生 task_id；审批与 sidechain 不能各用一套 id | 〔一手〕P:claude/subagents/live-source.ts:147–182；P:claude/agent.ts:5215–5244；判断〔推理〕 |
| P1 | modelUsage 累计、子 total_tokens 是上下文 | 逐 Query／逐模型差分；未知子 input/output留空；不叠子分项，不对费用估算当余额 | 〔一手〕S:sdk.d.ts:4966–4976；Paseo docs/agent-lifecycle.md:330–332；推荐〔推理〕 |
| P1 | 预算只限主循环，子并发深度未硬约束 | 如设计明确标 Claude 的 maxDepth／maxConcurrent 不是可强制承诺；父看门狗／暂停要真停后台，不把配置存在当生效 | 〔一手〕设计:202–204；S:sdk.d.ts:1653–1672；推荐〔推理〕 |
| P1 | 单成员配置根并发与 OAuth 刷新 | 会话级 model／权限／compaction 放 SDK 明确选项／settings overlay，不靠反复覆盖共用 settings 来区分会话；凭据／路径稳定且不随删除一个活擦除 | 〔一手〕provider.ts:149–171；C:bin/claude.exe:2382521；推荐〔推理〕 |
| P1／待定 | 附录 A 的模型文件“不迁”与真实依赖冲突 | 同意只迁最小 helper 原地裁剪，或新包另写等价极小 helper；推荐前者保留来源，目录产品功能依旧不迁 | 〔一手〕runtime-safety.ts:2、models.ts:6–11；推荐〔推理〕 |
| P2／待定 | next_turn 首轮兑现程度 | 若本轮目标要等价设计，补 Claude 私有队列并验；若分期，先 Meta.nextTurn:false，宿主按回合边界投递，不能未经主人确认把该项从验收删掉 | 〔一手〕W:970–981；推荐〔推理〕 |
| P2 | #35 成功判断、钩子隔离相互作用 | SDK own hooks、项目 hooks来源分别控制；不能未经验证就用 disableAllHooks:true 再期望 PostToolBatch 生效。成功 ledger 与并行 batch、hook timeout 必须有真实用例 | 〔一手〕S:sdk.d.ts:2451–2468,6251–6254；C:bin/claude.exe:2392526（Fsr 的 settingsHooksOff 早退）；判断〔推理〕 |
| P2 | kill-9 清孤儿不在当前内存 seam 能力内 | 当作常驻／后续恢复的依赖验收项单列；不提前承诺、不乱杀同机其他 Claude | 〔一手〕设计:43–51,288–301；推荐〔推理〕 |

本次可直接确定的是：SDK 路线和原生控制通路存在、配置根影响钥匙串身份、压缩开关存在、modelUsage 的累计口径已明文、原迁入代码需要上述策略改造。仍不能确定的是：SDK0.3.263＋CLI2.1.318 的真实组合兼容、认证后实际协议／成本、完整隔离的文件访问、#35终止结果细节、#36长上下文行为和后台计量末尾口径；这些都应保留为显式验收项。〔一手〕本报告静态证据；未测边界〔推理〕。



复核记录：报告十节齐全；Claude目录81个文件均在清单中有处置；生产28件、建议迁入24件、已有共享35件的计数重新核对。源码定位用CLI安装文件SHA-256 `677a2ea7bf576cedd20e191d973914ed8a41796f53a63b1923381ddc4d5b5e7d`；SDK sdk.mjs SHA-256 `3d690c23ec82b4ba05f7ac8c26e2510f84e112c68ced68053ec40cf7d5dcbfe2`。本次没有运行单元／契约／覆盖率／build，也没有宣称这些通过；完整运行验收仍按§8进行。〔一手〕本次只读计数、哈希及文档完整性检查。
