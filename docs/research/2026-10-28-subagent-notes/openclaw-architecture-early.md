# 子调研原文：OpenClaw 整体架构（第 1 段的早期版本）

> 来源：第 1 段对话（2026-10-27）里的调研子任务「Research OpenClaw architecture（第 1 段）」的最终回复，原样存档。
> 状态：未整理、未逐条核对；语言为中文，保持原文。只删掉了一句指向已不存在的临时目录的说明。
> 用途：整体架构（已被 2026-10-28-openclaw-architecture.md 取代，留作补充）模块阶段的调研起点。索引和要点见同目录 `README.md`。

---

任务：调研 openclaw/openclaw（Gateway、会话路由、多 agent、主动性、工作区文件、记忆、渠道插件、nodes、插件与技能、安全、存储、issue），并为灵鲸提炼借鉴点。

## 1. 实际读过的来源
- 仓库文件树：用 `git/trees/HEAD?recursive=1` 拉取，响应因限速在 2MB 处截断。docs/ 目录拿全了，src/ 没拿到，所以没读源码，接口形状全部来自 SDK 文档里的代码示例。
- 通过 raw 读过的 docs（约 70 篇）：
  - concepts：architecture、session、main-session、multi-agent、agent-workspace、soul、memory、memory-provenance、compaction、dreaming、queue、agent-runtimes、standing-intents、system-prompt、session-tool
  - gateway：heartbeat（现在是迁移页）、cli-backends、protocol/{handshake,rpc-methods}、security/{trust-model,prompt-injection}、sandbox-vs-tool-policy-vs-elevated
  - channels：channel-routing、groups、ambient-room-events、bot-loop-protection、pairing、qqbot、wechat
  - plugins：sdk-channel-plugins、sdk-channel-inbound、architecture-internals/channel-surfaces、architecture
  - 其他：tools/skills、tools/subagents、reference/templates/{SOUL,BOOTSTRAP}、reference/database-schemas/layout、architecture/writer-admission-authority、maturity/scorecard
- Issue：search API 按评论数排序，看了总榜加 memory、heartbeat、prompt injection、group mention 几个关键词。正文读过 #110950、#8776、#7707、#143524、#116277、#25592、#44925、#91588。
- 仓库数据：39.3 万 star，TypeScript，MIT，创建于 2025-11-24，open issue 加 PR 共 7772。
- WebSearch 补充：
  - 安全：[THN 341 个恶意 ClawHub 技能](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html)、[Immersive Labs](https://www.immersivelabs.com/resources/c7-blog/openclaw-what-you-need-to-know-before-it-claws-its-way-into-your-organization)、[clawdocs 已知漏洞](https://clawdocs.org/security/known-vulnerabilities)
  - 改名史：[Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)
  - token 成本：[Notebookcheck](https://www.notebookcheck.net/18-75-overnight-to-ask-Is-it-daytime-yet-The-absurd-economics-of-OpenClaw-s-token-use.1219925.0.html)、[GraphScope](https://graphscope.io/blog/tech/2026/03/18/OpenClaw-User-Token-Cost-Analysis)
- 本 fork 用掉 6 次 core 配额（1 次文件树 + 5 次单 issue）。那 5 次都撞上 core 配额被耗尽而失败，正文改从已存的 search 结果里取。core 配额现已为 0（三个 fork 共用），本小时内其他 fork 无法再调 core API。

## 2. 按维度的发现

**分层与进程模型**【一手：concepts/architecture】
- 每台主机一个常驻 Gateway 进程（Node），独占所有渠道连接。
- 控制端（mac app、CLI、Web UI）和节点都走同一个 WS 端口 18789。
- 帧格式：`{type:"req",id,method,params}` / `{type:"res",id,ok,payload|error}` / `{type:"event",event,payload,seq?,stateVersion?}`。
- 首帧必须是 `connect`。用 TypeBox 定义 schema，生成 JSON Schema，再生成 Swift 模型。
- 带副作用的方法（send、agent）必须带 idempotency key。
- 事件不重放，客户端发现断档要自己刷新。
- 内核持有一个 `GatewayScheduler` 统一管理定时唤醒。
- 插件 in-process 加载，文档明说"不是沙箱，与核心同信任边界"。
- 性能问题：SQLite 写入准入在主线程。文档给的实测是 20 个发送方时 `chat.send` ACK 的 p50/p99 为 1.2s/1.7s，765ms 里有 673ms 在排队，目前正在拆到 worker。

**事件与路由**【一手：channel-routing、queue】
- 回复固定回原渠道，"模型不选渠道"。
- binding 匹配优先级：peer 精确 > 父 peer（线程继承）> peer 通配 > guild+roles > guild > team > account > channel > 兜底 owner。
- 多个 agent 但没有 owner 时必须有 binding，不会默认挑第一个。
- 每个会话一个 mailbox，再进入全局 lane（FIFO，前台最多插队 15s，后台 30s，有老化）。
- 排队模式有 steer（默认，把新消息注入正在跑的回合）、followup、collect（500ms 防抖后合并）、interrupt。
- 别人的消息默认不能 steer 你的回合，防止借权。

**会话 key**【一手：session、main-session】
- 私聊默认全部汇进 `agent:<id>:main`，即"主会话"："There is one brain, and this is where it thinks"。
- 群：`agent:<id>:<channel>:group:<id>`；线程追加 `:thread:<id>`；子 agent 是 `agent:<id>:subagent:<uuid>`。
- `dmScope` 可选 main / per-peer / per-channel-peer / per-account-channel-peer。多人场景文档推荐 per-channel-peer，否则"Alice 的私聊 Bob 能看到"。
- 跨渠道认人靠 `session.identityLinks`。
- 原来的 channel docking（/dock 手动切换回复渠道）已删除。

**主会话汇聚**【一手：main-session】
- 群会话默认保持隔离，但主会话会"旁观"它们：群里的动静按会话合并成简短通知排队，每条消息不单独唤醒。
- 主会话在下一次被用户找或定时检查时才看到这些通知。
- 子 agent 完成后会 announce 回发起它的会话。
- 新建会话时，主会话会收到一条系统通知。

**人设与多 agent**【一手：agent-workspace、multi-agent、templates】
- 一个 agent 是一个完整的人设作用域，包含 workspace、agentDir（auth、模型）和独立的 `openclaw-agent.sqlite`。
- 工作区文件：

  | 文件 | 作用 | 注入方式 |
  | --- | --- | --- |
  | AGENTS.md | 操作规则，含 ## Tools 约定 | 每会话 |
  | SOUL.md | 语气与边界 | 每会话 |
  | USER.md | 用户模型，记成带日期的有效/失效指令 | 单独 4000 字符预算 |
  | IDENTITY.md | 名字、风格、emoji | 首次运行仪式里写 |
  | BOOTSTRAP.md | 首次运行仪式 | 完成后删除 |
  | BOOT.md | 启动清单 | 由 hook 触发 |
  | MEMORY.md | 长期记忆 | 只在私有主会话加载 |
  | memory/YYYY-MM-DD.md | 日记 | 不注入，靠检索 |

- 注入上限：单文件 20000 字符，总计 60000 字符，超出截断。
- SOUL 模板原文写着 "This file is yours to evolve"：agent 自己可以改人设，只要求改了告诉用户。
- agent 也能申请创建新 agent，要经运营者审批，并记录来源（operator / agent / claw）。

**群组建模**【一手：groups、ambient-room-events、bot-loop-protection】
- 准入层：`groupPolicy`、allowlist，默认 `requireMention`。隐式提及（回复 bot、引用 bot）按渠道产出。
- `mentionPatterns` 作为正则兜底。
- 群主可以用 `/activation mention|always` 切换模式。
- `contextVisibility` 是独立于准入的另一层：控制非白名单发送者的引用和历史是否进入上下文。
- 关键演进是 ambient room events：
  - 未被点名的消息变成静默的"房间事件"，final 文本私有。
  - 要说话必须调 `message(action=send)`。
  - 文档明说这样就"不再需要让模型回 NO_REPLY 的旧 prompt 模式"。
- broadcast：一条入站消息可以让多个 agent 各开一个会话参与，上限 4 轮、32 个参与回合，预算只在内存里，重启丢失。
- bot 互聊防环：双向配对计数，滑动窗口每 60s 最多 20 条，超限冷却 60s。

**主动性调度**【一手：gateway/heartbeat 迁移页；issue #110950】
- 原先的 heartbeat 加 HEARTBEAT.md 已退役，统一成普通 automation（cron）任务。
- 首次安装会建一个 "Proactive check" 任务：每 30 分钟一次，跑在主会话里，`idleOnly`，投递到 owner 私聊。
- 任务属性有 `activeHours`、scratch（替代 HEARTBEAT.md，带 revision 防覆盖）。
- 静默用 `NO_REPLY`；`record_result` 只记录结果、不发消息。
- 原先 heartbeat 专属的去重和"无路由就跳过"已删除。
- #110950 的理由：七套自动化机制重叠（heartbeat、cron、后台任务、hooks、Task Flow、standing orders、commitments）；HEARTBEAT.md 是"调度器里的调度器"，每次 tick 都要解析；agent 自己提出的 nextCheck 也不被执行。
- 按事件触发的未来动作另有 standing intents（存 SQLite，回复前检查）。三类意图对应三种存储：按时间的走 cron，按事件的走 intent，长期愿望写进 Markdown。

**渠道适配器接口**【一手：sdk-channel-plugins、sdk-channel-inbound、channel-surfaces】
- 写法是 `createChatChannelPlugin<ResolvedAccount>({ base: createChannelPluginBase({id, config:{listAccountIds, resolveAccount, inspectAccount}, setup:{applyAccountConfig}}), security:{dm:{resolvePolicy, resolveAllowFrom, defaultPolicy}}, pairing:{text:{notify}}, threading:{topLevelReplyToMode}, outbound:{attachedResults:{sendText→{messageId}}, base:{sendMedia}} })`。
- 其他能力面：`capabilities.chatTypes/reactions`、`messaging.inferTargetChatType/targetResolver/resolveOutboundSessionRoute`、`agentPrompt.inboundFormattingHints/messageToolHints`。
- 入站流程：platform event → `buildChannelInboundEventContext` → `runChannelInboundEvent`（ingest → classify → preflight → resolve → record → dispatch → finalize）。
- 入站上下文字段：`ChatType`、`GroupSubject`、`GroupMembers`、`WasMentioned`、`ReplyToId/Body/Sender`。
- 职责划分：插件不实现发送工具，核心提供统一的 `message` 工具，并拥有会话 key 外形、参与者调度和预算；插件拥有配置、DM 安全、配对、会话语法和出站发送。
- 富消息走通用的 `MessagePresentation`，由核心决定原生渲染还是降级成文本。
- 有 durable ingress（入站持久化、重放去重）。
- 中国渠道：QQ Bot（腾讯官方插件，私聊与群 @）、微信（`@tencent-weixin/openclaw-weixin`，基于 iLink，只支持私聊，不支持群）。

**Nodes**【一手：nodes/index、handshake】
- 节点是外设，不是网关：用 `role:"node"` 连接，在 connect 里声明 `caps/commands`（如 camera.snap、screen.record、location.get），通过 `node.invoke` 调用。
- 设备身份需配对，并对 challenge 签名。

**能力扩展**【一手：plugins/architecture、tools/skills】
- 插件：npm 包，带 `openclaw.plugin.json`（channels、configSchema、channelConfigs）。
- 技能：遵循 AgentSkills 规范的 SKILL.md。系统提示里只注入名字和描述，每个技能约 24 token，有预算截断。
- Skill Workshop：agent 可以自己存、改技能，每次改动都会通知，并保留前一版可撤销。
- ClawHub 有 VirusTotal 和 ClawScan 扫描、`skills verify` 信任信封、`security.installPolicy` 安装前钩子。

**大脑 / CLI 后端**【一手：cli-backends、agent-runtimes】
- 三层分开：Provider / Model / Runtime（`claude-cli`、`codex`）/ Channel。
- `claude-cli`：保持一个热的 stdio 子进程，JSONL 流式输出，按 backend 持久化原生 session id，resume 前先校验原生 transcript 是否还在。
- 工具通过 loopback MCP 桥（`bundleMcp`）给 CLI，不往 CLI 协议里注入工具调用。
- `ownsNativeCompaction`：Claude Code 自己做压缩，OpenClaw 不再跑第二个摘要器（两个摘要器会打架，可能让回合直接失败）。
- resume 时把 CLI 不在场期间产生的会话行（cron 结果、子任务 announce）作为前缀补给它：最近 8 条，每条最多 2000 字符。
- 跨账号时不自动重放历史。
- Codex 走 app-server harness，原生 Codex 会把每条消息写进它自己的 `logs_2.sqlite`，无法关闭。

**记忆**【一手：memory、compaction、dreaming、memory-provenance】
- 只有 Markdown，"没有隐藏状态"。检索靠 `memory_search/get`。
- 压缩前先跑一次静默的 memory flush 回合，把要点写进日记。这一回合会关掉 provider 侧压缩，保证看到未摘要的原文。
- Dreaming（默认开启）是每晚整理，分 light / deep / REM 三阶段：只把晋升结果写进 MEMORY.md；改写前把原文快照存进 SQLite；给人看的摘要写进 DREAMS.md。
- `memory forget` 按来源会话谱系删除，并登记，防止之后重新摄入。
- #7707"按来源给记忆打信任标签"于 2026-10-22 以 not_planned 关闭。

**安全**【一手：trust-model、prompt-injection、pairing】
- 信任边界是"一个 Gateway 等于一个信任域"，不支持互不信任的多租户；sessionKey 只是路由键，不是授权。
- 优先级明确：先认身份（配对 / allowlist），再定范围（群 allowlist、mention、工具、沙箱），模型放最后（"假设模型会被操纵"）。
- DM 配对：8 位码，1 小时过期，每个账号最多 3 个待审。
- 沙箱模式 off / non-main / all（Docker 等后端），配合 tool policy 和 elevated（exec 的逃生口）。
- 外部内容用 `<<<EXTERNAL_UNTRUSTED_CONTENT>>>` 包裹，并剥离聊天模板特殊 token。
- 默认值很宽：`tools.sessions.visibility:"all"`、`agentToAgent` 默认开启，任何未沙箱的 agent 都能读所有会话。
- 推荐把不可信内容交给只读 reader agent 摘要后再传。

**存储**【一手：database-schemas/layout、session】
- 全局控制面：`state/openclaw.sqlite`。
- 每 agent 数据面：`openclaw-agent.sqlite`，含会话、转录、记忆索引、auth、intents。
- 可选 PostgreSQL。
- 旧的 `sessions.json` 加 JSONL 转录已迁到 SQLite（#88838，2026-06）。遇到旧存储时启动拒绝就绪，必须先跑 doctor。
- 磁盘预算默认 10GB，超出后把最旧的历史压缩归档。

**成熟度与社区反馈**
- 【一手：scorecard】自评成熟度 68%；QA 覆盖率 Memory 仅 3/23，Heartbeat 1/4，Cron 12/22。
- 【二手：媒体】最大的抱怨是 token 成本：每 30 分钟的 heartbeat 带着整段上下文，有人一夜花 $18.75。其次是升级回归和安装复杂。

## 3. 对灵鲸的借鉴与反模式

**值得借鉴**
1. **会话 key 语法加一个主会话做汇聚点**，直接对应"主意识"。
   - key 形如 `agent:<id>:<surface>:<kind>:<id>[:thread]`，DM 合并到 main，群隔离。
   - 群和任务对话的动静以合并后的通知流进主意识，不逐条唤醒。
   - 依据：main-session。这套方案已经在 39 万 star 级别的用户量上跑过。
2. **核心持有一个 message 工具，渠道只做适配。** 渠道插件只管配置、身份准入、会话语法、出站发送和能力声明；轮次调度、预算、富消息降级归核心。这和灵鲸"感知 + 行动"的适配器定义一致，能避免每个渠道各自实现一套发言逻辑。
3. **群聊分寸用"房间事件 + 必须调工具才发言"**，不要用"模型回 NO_REPLY 才闭嘴"。OpenClaw 正是从后者演进到前者的，#25592（工具调用间的文本泄露到渠道）和 #116277（静默失败后发出通用兜底话术）都是旧模式的代价。
4. **所有主动行为统一成一种调度原语**：任务自带 activeHours、idleOnly、scratch、run history、静默结果。在此之上再分"按事件的意图"和"按时间的承诺"。#110950 记录了七套机制重叠的教训。灵鲸的作息、兑现承诺、早安应该从第一版就是同一种 job。
5. **CLI 大脑的三条硬规矩**：
   - 本体保留规范转录，CLI 原生 session 只是可丢弃的缓存（resume 前校验，丢了就从本体重新播种）。
   - 原生会自己压缩的 CLI，本体不再做第二次摘要。
   - CLI 不在场期间的事件在 resume 时以有界前缀补给它。
   - 这正好支撑"换了 CLI 她还是她"。
6. **身份优先于模型**：配对加 allowlist 加"只有 owner 能执行的命令"，区分"谁能触发"和"哪些内容能进上下文"（contextVisibility）。正好对应灵鲸的"身份只认绑定"和"隐私按来源"。
7. **SQLite 按归属拆分**：全局控制面一个库，每个成员一个库。和"每个数字生命的记忆各自独立"的边界吻合，也方便整体打包备份和搬家。
8. **技能自学加版本加通知加可撤销**（Skill Workshop），以及**压缩前的记忆 flush 和夜间整理**（dreaming，改写前存快照）。这些可以直接对上灵鲸的"技能可回滚""每晚整理"。

**应避免**
1. **人设文件让 agent 自己可写，且和工具同权。** SOUL 模板写着 "yours to evolve"；#8776 soul-evil 展示了"写文件 + config.patch"能静默替换人设。灵鲸的出生设定必须只读，成长层单独存储、每次变更有日志、可回滚。
2. **默认全局可见**（sessions visibility=all、agentToAgent 默认开）。这和"记忆各自独立、只通过对话交换"直接冲突，灵鲸应默认 self，跨成员只能"发消息"。
3. **插件 in-process 且不设防，技能市场开放上传**：ClawHavoc 一次就有 341 个恶意技能，最终统计接近 900 个。
4. **单进程加主线程 SQLite**：#143524 WAL 涨到 2.8GB 后网关无法启动；#91588 RSS 涨到 15.5GB；还有前面说的 ACK 秒级延迟。
5. **多套记忆来源并存**：Markdown 文件、SQLite 转录、原生 CLI 日志三处并存，provenance 是事后补的，按来源打信任标签的提议最终 not_planned。灵鲸定了"日志为唯一事实来源"，应该从设计上让记忆成为日志的派生物，每条带 source 和场合。
6. **配置面爆炸**：doctor 迁移极重，#153257 一次升级花了 8 小时恢复。灵鲸应少开关、强默认。

**与 OpenClaw 的本质差异**
- OpenClaw 的"agent"是隔离的人设加 workspace，多 agent 之间靠路由分流。主会话是一种路由约定，并不是一个持续存在的意识。
- 灵鲸需要的是"一个主意识加多个同人格分身"：分身的经历要汇回同一份记忆，所以分身不能是 OpenClaw 那种独立 agent，而应是同一成员下的子会话。可参考 subagent 的 announce 回传，并补上"失败也必须回传"（#44925 记录了完成结果静默丢失）。
- "朋友"则对应独立 agent，加上 send-only 的跨成员通道。

## 4. 真实 issue 和被推翻的设计
- 被推翻或改掉的设计：
  - heartbeat 和 HEARTBEAT.md 改为 cron 任务（#110950，2026-07 关闭）。
  - HEARTBEAT_OK 改为 NO_REPLY；heartbeat 专属去重删除。
  - JSONL 转录迁到 SQLite（#88838）。
  - channel docking 删除。
  - 整个 agent 的 runtime 配置改为按模型配置。
  - 群里从"NO_REPLY 才闭嘴"改为"room_event + 必须用 message 工具发言"。
  - 名字从 Warelay、CLAWDIS 到 Clawdbot，2026-01-27 因 Anthropic 商标问题改名 Moltbot，三天后改为 OpenClaw；换 handle 的约 10 秒空档被骗子抢注。
- heartbeat 相关的坑：
  - #3181：失控循环，烧钱又占 CPU。
  - #143278：内部输出泄露到 Telegram。
  - #151962：内部字符串变成"幽灵用户消息"。
  - #64810：heartbeat 打断并吞掉正在进行的回复。
  - #85913、#52015：同一会话上并发抢占、嵌套 key。
  - #10841：agent 不知道当前时间，提醒时间设错。
- 其他：#116277 和 #121058（静默回复失败反复出现）、#44925（子 agent 结果丢失）、#25592（中间文本泄露）、#91588 和 #159662（内存泄漏）、#143524 和 #164294（WAL 不 checkpoint）、#52885（微信插件升级后不兼容）。
- 安全事件：CVE-2026-25253（一键 RCE，CVSS 8.8）；默认监听所有网卡导致公网暴露的实例从 4 万多涨到 13.5 万以上【二手】。

## 5. 未能确认的点
- src/ 源码没读到（文件树截断，core 配额耗尽）：`ChannelPlugin` 的完整 TS 类型、入站 `MsgContext` 的完整字段、WS 方法的完整清单，都只来自文档。
- per-agent schema 的实际表结构（文档写当前是 31 版）没核对。
- QQ、微信插件的群能力和风控表现、iLink 的稳定性，需要实测。
- 公网暴露实例数、恶意技能总数只来自媒体，没有一手核实。
- 文档的时间戳显示变化极快（2026-09 到 10 月仍在大改）。上述行为以当天 HEAD 为准，可能已经不是稳定版的行为。
