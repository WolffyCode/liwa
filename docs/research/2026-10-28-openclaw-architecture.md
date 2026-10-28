# 调研：OpenClaw 整体架构

日期：2026-10-28。为灵鲸"整体架构"一节打底。标注：〔一手〕读到官方文档原文或源码；〔二手〕搜索摘要或第三方文章；〔推测〕调研者判断；〔未核实〕没读到原文。

覆盖说明：本次读的是 OpenClaw 官方文档站的 Markdown 导出（`docs.openclaw.ai/<页面>.md`，内容和仓库 `docs/` 目录一致），对应版本是 2026.10.x（CHANGELOG 索引里最新发布是 2026.10.7）。GitHub API 被限流，所以 **没读源码，也没直接翻 issue**，用户痛点只拿到二手资料。`early-findings.md` 和 `client-backend.md` 里已查到的事实（约 39 万星、MIT、WS 信封格式、node:sqlite 版本坑等），本文不再重复。

## 1. 来源清单

精读 30 项，都在 `mktemp -d` 临时目录里只读解析。

| # | 来源 | 读了什么 | 类别 |
| --- | --- | --- | --- |
| S1 | `docs.openclaw.ai/llms.txt` | 全站 1436 页的索引和一句话摘要，用来选页；"已退役"类页面也从这里发现 | 一手（索引） |
| S2 | `concepts/architecture.md` | 全文：Gateway、客户端、节点、握手、配对、GatewayScheduler | 一手 |
| S3 | `agent-runtime-architecture.md` | 全文：内置运行时布局、harness 选择、worker 池 | 一手 |
| S4 | `concepts/session.md` | 路由、DM 隔离、群路由、重置、重启恢复、存储位置 | 一手 |
| S5 | `concepts/main-session.md` | 全文 | 一手 |
| S6 | `concepts/queue.md` | 原理、默认值、队列模式 | 一手 |
| S7 | `concepts/multi-agent.md` | agent 定义、路径、team preset、多人设、路由规则 | 一手 |
| S8 | `channels/channel-routing.md` | session key 形状、路由优先级、broadcast groups | 一手 |
| S9 | `concepts/system-prompt.md` | 组装三层、各节、prompt 模式、启动文件注入、Codex 注入方式 | 一手 |
| S10 | `concepts/agent-workspace.md` | 文件清单，以及不在工作区里的东西 | 一手 |
| S11 | `concepts/soul.md` | 全文 | 一手 |
| S12 | `gateway/heartbeat.md` | 全文（heartbeat 迁移） | 一手 |
| S13 | `reference/templates/HEARTBEAT.md` | 全文（HEARTBEAT.md 退役说明） | 一手 |
| S14 | `automation/cron-jobs/how-it-works.md` | 全文 | 一手 |
| S15 | `concepts/memory.md` | 文件、检索、引擎、压缩前写回记忆 | 一手 |
| S16 | `concepts/memory-architecture.md` | 前约 300 行：分层、来源、写入路径、dreaming、两条召回通道 | 一手 |
| S17 | `concepts/active-memory/how-it-works.md` | 全文 | 一手 |
| S18 | `plugins/sdk-channel-plugins.md` | 插件职责、步骤 1–2、入站处理，以及子页去向 | 一手 |
| S19 | `gateway/security/trust-model.md` | 全文 | 一手 |
| S20 | `gateway/security/prompt-injection.md` | 主体 | 一手 |
| S21 | `channels/pairing.md` | DM 配对部分 | 一手 |
| S22 | `concepts/session-tool.md` | 工具表、跨会话消息、spawn、可见性 | 一手 |
| S23 | `tools/acp-agents/delivery.md` | 投递模型 | 一手 |
| S24 | `plugins/codex-harness-reference/app-server-transport.md` | 启动方式、二进制选择、字段表（按关键词摘读） | 一手 |
| S25 | `plugins/codex-harness-runtime/recovery.md` | 全文 | 一手 |
| S26 | `plugins/codex-harness-reference/supervision.md` | 前半（实际讲会话目录发现，不讲进程监管） | 一手 |
| S27 | `concepts/storage-locations.md` | 前半（实际讲备份目的地，用处不大） | 一手 |
| S28 | `raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG.md` | 只是按版本拆分的索引，没往下读 | 一手（索引） |
| S29 | WebSearch"OpenClaw token cost heartbeat"：graphscope.io 博客、clawdocs.org、insiderllm.com 等 | 搜索摘要 | 二手 |
| S30 | WebSearch"OpenClaw ClawHub malicious exposed gateways"：thehackernews.com（Koi Security 审计）、securitybrief.co.uk、barrack.ai 等 | 搜索摘要 | 二手 |

另外下载了 `concepts/queue-steering`、`concepts/agent-bindings`、`concepts/compaction`、`concepts/memory-provenance`，但只看了标题，没读正文，也没算进上面 30 项。

## 2. 机制总览

### 2.1 架构图

```
        客户端：Control UI/WebChat   macOS app   CLI/TUI   自动化脚本   节点(role:node, 相机/屏幕/定位)
                     │  每个一条 WS，首帧 connect + 设备身份签名；127.0.0.1:18789；事件不重放
┌────────────────────┴──────────────── Gateway：每台主机一个 Node 进程，由 launchd 守护 ─────────────────────────┐
│ 渠道插件 ──入站──▶ 路由：bindings → agentId；dmScope/groupScope → sessionKey（模型不选渠道）                  │
│ （配对/白名单/                    │                                                                         │
│  会话语法/出站）                  ▼                                                                          │
│                 会话控制器邮箱：每个物理会话同时只跑一轮；steer / followup / collect / interrupt            │
│                                   ▼                                                                         │
│                 全局 main lane（并发上限）｜子 agent lane（每个父会话 8 个）｜swarm lane                      │
│                                   ▼                                                                         │
│ agent 运行时：内置 runner（进程内，CPU 重活放 worker 线程）                                                  │
│              ├─ Codex harness 插件 → 子进程 `codex app-server --listen stdio://`（每个 agent 一个 CODEX_HOME）│
│              └─ ACPX 插件 → ACP 子进程（Claude Code / Cursor / Gemini CLI …）                                │
│ GatewayScheduler：全机唯一的定时器 → automations（cron、Proactive check、维护任务）                          │
│ 记忆插件 memory-core：Markdown + SQLite 索引；dreaming 后台整理；Active Memory 召回子 agent                  │
│ 共享 message 工具、会话工具、工具策略、exec 审批、沙箱（默认关）                                              │
└──────┬─────────────────────────┬──────────────────────────────────┬───────────────────────────────────────────┘
 openclaw.json（配置）   state/openclaw.sqlite（共享状态：      agents/<id>/agent/openclaw-agent.sqlite
                         automation 作业、scratch、运行历史）    （会话行、transcript、auth、记忆索引、standing intents）
                                                                 agents/<id>/agent/codex-home/
 工作区 workspace[-<id>]/：AGENTS.md SOUL.md IDENTITY.md USER.md MEMORY.md memory/YYYY-MM-DD.md DREAMS.md skills/
```

### 2.2 十个问题的结论

#### Q1 进程与分层

- **Gateway**：每台主机一个常驻进程，持有所有渠道连接，对外提供有类型的 WS API（TypeBox → JSON Schema → Swift），推送 `agent`、`chat`、`presence`、`health`、`heartbeat`、`cron` 等事件；同一端口还托管 Canvas 页面；用 launchd 或 systemd 守护。Gateway 内核只有一个 `GatewayScheduler`：只用一个主机定时器驱动下一次唤醒；系统睡眠期间错过的 tick 合并成一次；持久的截止时间由各个 owner 自己存，启动时重建，不另存一份调度器状态〔一手，S2〕。
- **客户端怎么连**：每个客户端一条 WS，第一帧必须是 `connect`，否则直接断开。鉴权有三种：共享密钥（token/password）、Tailscale Serve 或 trusted-proxy 的请求头、私网下的 `none`。所有连接都要带设备身份，并对 `connect.challenge` 的 nonce 签名（v3 签名还绑定 platform 和 deviceFamily）。新设备要配对审批，批准后发 device token；本机 loopback 可以自动批准；局域网和 tailnet 要显式批准。有副作用的方法（`send`、`agent`）必须带幂等 key。一次 `req:agent` 的返回顺序是：先回 `{runId, status:"accepted"}`，然后是 `event:agent` 流，最后是最终 res〔一手，S2〕。
- **agent 运行时在进程内**：内置运行时 id 是 `openclaw`（旧别名 `pi`），代码在 `src/agents/embedded-agent-runner/`，文档原话是"No external agent framework packages remain"。code-mode、压缩规划、文件编辑匹配这类 CPU 重活放进 `WorkerTaskPool` worker 线程，并发上限 `availableParallelism()-1`，给 Gateway 留一个核；SQLite 写入由 broker 复用两个 writer isolate。用哪个运行时，按 model/provider 配置的 `agentRuntime.id` 决定；配成 `auto` 时，如果有插件 harness 支持这条路由就用它，否则用内置运行时〔一手，S3〕。〔推测〕`pi` 这个别名说明它早期基于 Pi agent，后来改成自己维护。
- **Codex 怎么拉起**：Codex 是一个 harness 插件，用 `codex app-server --listen stdio://` 启动子进程。默认用插件自带的 `@openai/codex` 0.162.1；如果 PATH 上有更新的同大版本 codex，并且在 4 秒预算内用临时 `CODEX_HOME` 完成一次真实的 `initialize` 握手，就改用它。app-server 协议**没有版本协商**，所以只能拿大版本号判断兼容。`homeScope` 默认是 `agent`，即每个 agent 一个独立的 codex-home。传输方式有 stdio、unix 和 websocket，其中 websocket 是实验性的，不建议生产用〔一手，S24〕。
- **Codex 怎么回收**：在发 `initialize` 之前，先把父进程和子进程的身份写进 state 目录下的 SQLite plugin store。每次起新的 stdio 子进程前，先检查有没有孤儿：只清理"已登记、而且原父进程已经不在"的子进程，并核对 pid、启动时间、进程组和命令行指纹（只存摘要）。如果查不清或者清不掉，就**拒绝再起新进程**。Gateway 启动时还会在后台扫一遍。模型发现请求超时，就把那个共享 client 退役〔一手，S25〕。
- **ACP 怎么接**：ACP 会话有两种形态。一种是交互式：用 `/acp spawn --bind here` 或配置里的 `bindings[].type="acp"` 把当前会话或线程绑定到 ACP 会话，之后这里的消息都直达它。另一种是父会话发起的一次性任务：`sessions_spawn({runtime:"acp", mode:"run"})`，跑在子 agent 的后台 lane 上，完成后走 announce 回报。OpenClaw 内部的上下文信封不会发给外部 harness。要接着旧会话干，就用 `resumeSessionId`，通过 `session/load` 重放历史〔一手，S23〕。**acpx 具体怎么起、怎么监管 CLI 子进程，没读到**〔未核实〕。

#### Q2 消息到会话的路由

- 回复回到消息的来源渠道，由宿主配置的固定规则决定，模型不选渠道〔一手，S8〕。
- **session key 的形状**〔一手，S8〕：
  - 私聊：默认全部并进 `agent:<agentId>:main`。
  - 群：`agent:<id>:<channel>:group:<id>`。
  - 频道或房间：`agent:<id>:<channel>:channel:<id>`。
  - 线程：在上面的 key 后追加 `:thread:<id>`；Telegram 话题用 `:topic:<id>`。
  - 门户式会话：`agent:main:explicit:portal-123`〔一手，S17〕。
  - cron 隔离运行用 `cron:<jobId>` 会话〔一手，S14〕。
- **私聊怎么分会话**：由 `session.dmScope` 决定，取值有 `main`（默认，所有私聊共用一个会话）、`per-peer`、`per-channel-peer`（官方推荐）、`per-account-channel-peer`。`session.identityLinks` 能把同一个人在不同渠道的身份映射成同一个 peer。官方警告：不开隔离的话，Alice 的私聊 Bob 也能看到〔一手，S4〕。另外，即使私聊历史共用 main，沙箱和工具策略仍按"账号 + 私聊"派生的运行时 key 计算，外部私聊不会被当成本地 main 会话的运行〔一手，S8〕。
- **群怎么分会话**：`session.groupScope` 默认 `per-group`，可以改成 `main`，也可以在单条 binding 上覆盖。它只改共享上下文；提及门控和回复去向仍按原来的群走〔一手，S4〕。
- **不同来源的默认分法**：私聊共享；群、房间各自隔离；cron 每次运行一个新会话；webhook 每个 hook 一个会话〔一手，S4〕。
- **"main session"是什么**：key 固定为 `agent:<id>:main`（自定义 `mainKey` 会被忽略），是这个 agent 的根，文档原话"There is one brain, and this is where it thinks"。汇进它的东西有：
  - 所有私聊。
  - 新会话创建时的系统通知（不额外唤醒，下一轮才看到）。
  - 群动态：每个群合并成简短通知，不会一条消息唤醒一次。
  - 子任务完成后的回报。
  - 定时检查：定时检查本身就打在 main 会话上。
  在 Control UI 里，main 会话就是 Home 页〔一手，S5〕。
- **会话的生命周期**：默认不自动重置，靠压缩控制上下文长度。可以选每天定点重置（默认 4 点）或空闲重置；heartbeat、cron、exec 这类系统事件不算活跃，不会推迟重置。重置时，旧会话里排队的系统通知会被丢掉〔一手，S4〕。
- **agent 正忙时新消息怎么排队**〔一手，S6〕：
  - CLI、内置运行时、Codex 三种运行都进同一个"会话控制器邮箱"，一个物理会话同时只放行一轮；之后再进全局 `main` lane 排队，并发上限是 `agents.defaults.maxConcurrent`；子 agent 每个父会话默认 8 个并发。
  - 前台任务最多可以插队 15 秒，后台任务最多 30 秒；正在跑的回合从不被抢占。
  - 四种模式：
    - `steer`（默认）：在工具批次结束、模型做下一次决定之前，把新消息注入正在跑的回合；Codex 侧用一次批量的 `turn/steer`。
    - `followup`：等当前回合结束，每条消息各起一轮。
    - `collect`：静默窗口过后，把兼容的消息合成一轮。但在 Discord、Telegram 这类持久入站渠道上，它退化成 followup。
    - `interrupt`：中止当前回合，跑最新这条。
  - 默认值：500ms 防抖、队列上限 20、溢出时摘要。别人的 steer 默认会被拒绝，除非开 `allowCollaborativeSteering`，而开了就等于让 Bob 借用 Alice 的权限。

#### Q3 多 agent

- **一个 agent 就是一个完整的人设边界**：它有自己的工作区（AGENTS.md、SOUL.md、USER.md 等）、`agentDir`（auth、模型注册表、单 agent 配置）、`<agentDir>/openclaw-agent.sqlite`（会话和 transcript）。官方要求永远不要在两个 agent 之间复用 agentDir。技能按 agent 设白名单〔一手，S7〕。
- **bindings 怎么路由**：按 `(channel, accountId, peer, guild/team/roles)` 匹配到 agentId，越具体越优先，依次是：精确 peer、父 peer（线程继承）、peer 通配、guild+roles、guild、team、account、channel、兜底 owner。一条 binding 里写了多个字段，就要全部满足。不写 accountId 只匹配默认账号。配置了多个 agent 又没有兜底 owner 时，匹配不上的消息**不分派**，而不是交给列表里的第一个 agent〔一手，S7、S8〕。bindings 管的是路由，不是访问控制（agent-bindings 页"常见错误"一节的标题，正文未读）。
- **agent 之间怎么通信、怎么派生**〔一手，S22、S23〕：
  - `sessions_send`：让同一 Gateway 上的另一个会话跑一轮，可以选择等结果。对普通对等会话，它走 A2A：等对方回复，可以来回有限几轮，再让对方产出一条 announce 发到可见渠道。
  - `sessions_spawn`：派生后台子会话。可选 `runtime: subagent|acp`，上下文默认隔离（`context:"fork"` 可以带上父会话的 transcript），还支持 `visible`、`worktree`、`sandbox:"require"`、`thread`。深度默认最多 5 层。子会话完成后 announce 回父会话。
  - `sessions_yield`：结束本轮，等子会话的结果。
  - 文档特别提醒：父会话和它的一次性子会话之间不要再走 A2A，否则会形成回声循环。
- **team preset**：一个 coordinator 带 researcher、writer、reviewer。coordinator 是人类唯一的对接人，负责派有边界的活、检查产出；专家只向 coordinator 交产出，不再往下派。这些规则写在 AGENTS.md 里，因为派生出来的会话不加载 SOUL.md 和 IDENTITY.md〔一手，S7〕。
- **broadcast groups**：同一个外部群线程里可以让多个 agent 参与，由核心协调，用 `maxRounds`、`maxTurns` 限制轮数；Control UI 还没有专门的团队线程会话〔一手，S8〕。
- **权限隔离**：
  - `tools.sessions.visibility` 分 `self`、`tree`、`agent`、`all` 四档，**默认 `all`**；`tools.agentToAgent` **默认开**。也就是说，没开沙箱的 agent 能读、搜、给所有 agent 的会话发消息，包括别人的 transcript。
  - 收紧的办法：用 `allow` 限定哪些 agent 之间能通；用 `agentToAgent.send` 只开"发送委托"，不开读历史。开了沙箱的会话默认只能碰自己的 spawn 子树。
  - 官方原话：要严格隔离，就用不同的 Gateway〔一手，S19、S22〕。
  - 每个会话可以设"发送 / 接收消息"为 Always、Ask、Never，agent 自己改不了〔一手，S22〕。
  - 内置记忆不搜别的 agent 的 transcript〔一手，S7〕。

#### Q4 人设注入

- **工作区里的文件**〔一手，S10〕：

  | 文件 | 内容 | 注入方式 |
  | --- | --- | --- |
  | `AGENTS.md` | 操作规则；其中 `## Tools` 一节是本地工具约定 | 每次会话 |
  | `SOUL.md` | 人设、语气、边界 | 每次会话 |
  | `IDENTITY.md` | 名字、气质、emoji，在首次启动仪式里生成 | 每次会话 |
  | `USER.md` | 指令式用户模型：带日期的"有效 / 已取代"条目 | 每次会话，单独 4000 字符预算 |
  | `BOOTSTRAP.md` | 首次启动仪式，做完删掉 | 仅新工作区 |
  | `BOOT.md` | 启动清单 | 由 hook 在 Gateway 启动时执行 |
  | `MEMORY.md` | 精选长期记忆 | 只在主人的私密主会话里加载 |
  | `memory/YYYY-MM-DD.md` | 每日笔记 | 不注入，按需检索 |
  | `skills/` | 工作区技能 | — |

  早期教程里的独立 `TOOLS.md` 不在当前的文件表里，〔推测〕已经并进 AGENTS.md 的 `## Tools` 一节。
- **怎么拼进系统提示词**〔一手，S9〕：
  - 系统提示词完全由 OpenClaw 拥有，组装分三层：纯渲染函数 → 读配置的那一层 → 各运行时适配器收集实时信息。
  - 各节是固定的：Tooling、Execution Bias、Promised Work、Care、Runtime Context、Skills、Messaging、Workspace Files (injected) 等。
  - 以 prompt 缓存边界为界：稳定内容（项目上下文、工作区指令）放在边界上方，工具目录、记忆召回、群聊上下文、Runtime 等易变内容放在下方。
  - 风险由运行时的工具策略、审批和沙箱把关，不靠提示词里的文字劝说。
- **长度和截断**：单个文件默认最多 20000 字符，所有文件合计最多 60000 字符。超了就截断，加标记，并固定注入一句"有文件被截断，请直接读原文件"；缺文件时注入"缺失"标记〔一手，S9、S10〕。
- **子 agent 只注入 AGENTS.md**：`promptMode=minimal` 会去掉记忆、用户身份、Messaging 等节，SOUL.md、IDENTITY.md、USER.md 都被过滤掉〔一手，S9〕。如果会话在别的目录或 worktree 里执行，只追加那个目录的 AGENTS.md，不从那里加载 SOUL 等文件〔一手，S9〕。
- **Codex 上的注入方式**〔一手，S9〕：
  - AGENTS.md 由 Codex 原生的项目文档发现机制加载，OpenClaw 不再重复注入。
  - 用插件自带的 stdio app-server 时，SOUL、IDENTITY、USER 被追加到"只给父会话的模型请求指令"里，不进原生历史，所以**不会传给 Codex 原生子 agent**。
  - 外部或桌面版的连接没有托管推理中继，这时人设走可刷新的线程级 developer instructions，原生子 agent 能继承。
- **agent 能不能自己改这些文件**：
  - 官方 SOUL 指南直接给了一段"让 agent 读自己的 SOUL.md 然后重写"的提示词〔一手，S11〕。
  - 记忆分层表里写的是：AGENTS.md "只有人写"，MEMORY.md 和 USER.md 由 dreaming 整理或用户明确要求时写〔一手，S16〕。
  - 但工作区只是默认工作目录，不是沙箱〔一手，S10〕。读到的文档里**没有看到防止 agent 写 SOUL.md 或 AGENTS.md 的硬限制**〔未核实〕。
  - 版本管理靠官方建议的"工作区放进私有 git 仓库"〔一手，S10 标题〕。
  - 还有一个 `agent:bootstrap` hook，可以在注入时替换 SOUL.md〔一手，S9〕。

#### Q5 主动性

- **heartbeat 已经退役**〔一手，S12、S13〕：
  - 新工作区不再生成 `HEARTBEAT.md`，运行时也不再读它。
  - `openclaw doctor --fix` 会把旧的 monitor 转成普通 automation 作业，HEARTBEAT.md 里的内容导入成作业 scratch，合法的 `tasks:` 转成 cron。
  - heartbeat 专属的"重复内容去重"和"没有投递路由就跳过"被删掉了。
  - 系统提示词里已经没有 heartbeat 专属的一节〔一手，S9〕。
- **现在的主动机制**〔一手，S12〕：
  - 显式初始化时，给主 agent 建一个 **"Proactive check"** 作业：每 30 分钟一次，跑在 main 会话上，等会话空闲才执行，结果投给主人私聊。scratch 被显式置空就跳过。
  - 这个作业只建一次；删掉就永久删掉。
  - 可选策略：`activeHours`（按时区的活跃时段）、`idleOnly`（前台优先）、`delivery.target:"owner"`、`directPolicy`、`skipIfScratchEmpty`。
- **"说话还是不说"**：
  - 没有可见更新就回 `NO_REPLY`，这样也不需要再发一次请求生成最终回答。
  - `record_result` 可以只记录结果、不发消息；结果为 `no_change` 时不自动投递〔一手，S12〕。
  - 系统提示词里有 Silent Replies 一节，只用于外部渠道〔一手，S9〕。
- **cron 怎么调度**〔一手，S14〕：
  - 在 Gateway 进程里跑；作业、状态、运行历史存在共享 SQLite。
  - 有三种执行方式：共享命名会话、隔离的新上下文、`current`（带着创建时的会话片段独立跑）。
  - `--at` 一次性作业成功后自动删除。
  - agent 回合有 60 分钟看门狗。
  - 启动时，过期的作业只重新排期，不立即重放。
  - 连续出错的作业自动停用，并通知主人。
  - 同一件事主人反复要求时，agent 会提议把它"升级"成定时作业：主人确认后作业直接以启用状态创建，并立即试跑一次。理由是停用状态下等确认的作业谁也看不见，是更糟的失败。
- **承诺**：系统提示词的 Promised Work 一节要求：答应以后做的事，结束本轮前就要安排好完成路径；将来的跟进用 cron，不用 sleep 循环〔一手，S9〕。standing intents 是"前瞻记忆"，存在 SQLite，由 `intent` 工具写入〔一手，S16，细节未读〕。
- **成本控制**：
  - 一手做法：调间隔；在模型白名单内给作业单独选模型；用隔离上下文；只在空闲时跑；限定活跃时段；scratch 为空就跳过；heartbeat 和 cron 不推迟会话重置；Active Memory 不在后台运行里跑〔S4、S12、S17〕。
  - 二手数据：每次 heartbeat 都重新加载上下文和历史，有人估算一天两三百万 token；有人一个月产生 3600 次调用却没干活〔S29〕。

#### Q6 记忆（只讲机制）

- **文件组织**：USER.md（用户模型）、MEMORY.md（精选，启动时注入）、`memory/YYYY-MM-DD.md`（每日笔记，按需检索）、DREAMS.md（给人看的整理日志）〔一手，S15〕。分五层〔一手，S16〕：
  - 指令层：只有人写。
  - 精选核心层：由 dreaming 写入。
  - 情景层：每日笔记加 transcript。
  - 前瞻层：standing intents 和 cron。
  - 复核层：给人看，不注入。
- **检索**：
  - `memory_search` 是向量加关键词的混合检索。内置引擎基于 SQLite；默认用 OpenAI embeddings，也可以换成本地 GGUF 或 Ollama 等。另有 Honcho、LanceDB、PostgreSQL、memory-wiki 可选〔一手，S15〕。
  - 排序 = 混合相关度 × 近期衰减（半衰期 30 天）× 写入时打的重要度（1–10）〔一手，S16〕。
  - 条目可以带 trigger 短语，每条入站消息先做快速预筛，得分 ≥0.65 的条目自动注入，每轮最多 3 条，而且只限精选层〔一手，S16〕。
  - 内置 SQLite 具体用哪个向量扩展，没读到〔未核实〕。QMD 后端在 v2026.8.1 被移除〔一手，S7〕。
- **压缩前写回记忆**：压缩之前，在会话的私有副本上跑一个静默回合，提醒 agent 把重要内容写进当天的每日笔记。这时只允许追加，重复粘贴的旧内容会被拒绝；只读沙箱下跳过；写回失败也不阻塞压缩〔一手，S15〕。
- **dreaming**：默认开启，按计划在后台跑，分 light、REM、deep 三阶段。deep 阶段要过两道关才能把内容提升进精选层：
  1. 规则关：结构上直接排除来源为 `untrusted` 或 `system` 的候选。
  2. 模型整理关：合并、取代旧条目。
  替换 MEMORY.md 时先比对内容哈希（乐观并发），保存替换前的版本，并把改动摘要写进 DREAMS.md〔一手，S16〕。
- **Active Memory**：在主回复之前跑一个阻塞式的召回子 agent。默认 `escalate`：只有消息里有回忆意图、且规则通道没有强命中时才跑；`always` 是旧行为。只在交互式、持久的会话里运行，默认只在私聊，heartbeat、子 agent、一次性运行都不跑〔一手，S17〕。
- **来源**：每个记忆条目都带来源类别（owner、agent、untrusted、system），存在 SQLite 列里，模型没法通过正文改写。还记录会话类型和取代 key。读了网络内容的那一轮，之后的输出都被标为不可信（taint）。注入过的内容做了结构标记，不会被再抽成新记忆。cron、heartbeat、子 agent 会话不产生长期记忆候选〔一手，S16〕。文档还提到，生产审计发现，自动抓取的记忆里绝大部分是在复述运行时指令、heartbeat 噪音，或是召回造成的循环〔一手，S16〕。

#### Q7 渠道插件接口

- **插件负责**〔一手，S18〕：
  - 配置：账号解析、设置向导。
  - 安全：DM 策略、白名单。
  - 配对。
  - 会话语法：平台的会话 id 怎么映射成基础会话、线程和父会话。
  - 出站：文本、媒体、投票。
  - 线程化。
  - 可选的输入中状态。
  - 格式约定（`agentPrompt.inboundFormattingHints`）和发消息提示。
  - 能力声明：`capabilities.chatTypes`、`reactions`、`reactionSlots`，以及是否支持原生 `ask_user` 按钮。
- **核心负责**：唯一的共享 `message` 工具（插件不实现发送、编辑、回应工具）、提示词接线、session key 的外层形状、通用的 `:thread:` 记账、分派、群线程里的参与者选择和轮次预算〔一手，S18〕。
- **入站**：每个插件自己负责入站流程（例如用 `registerHttpRoute` 收 webhook）。私聊用 `dispatchInboundDirectDm` 分派，并传一个 `assertAuthority` 回调；核心会在记录会话、提交元数据、分派 agent 之前各重新检查一次发送者的实时权限，权限被撤销就拒绝〔一手，S18〕。持久入站（队列、重放去重、至少一次的副作用）和媒体（大小限制、托管媒体存储、入站媒体信息）在子页面里，只看到了标题〔一手，S18 子页列表〕。
- **SDK 边界**：插件只能用文档公开的 `openclaw/plugin-sdk/*` 入口，不能 import `src/**`〔一手，S3〕。打包时在 `package.json` 写 `openclaw.extensions`，在 `openclaw.plugin.json` 声明 `channels`、`configSchema`、`channelConfigs`（JSON Schema 加 uiHints），用 `createChatChannelPlugin` 构建〔一手，S18〕。旧的兼容层正在下线，同步 SQLite API 在 2026-12-31 之后不再兼容〔一手，S1 索引〕。

#### Q8 安全

- **信任模型**：一个 Gateway 就是一个信任边界，只支持一个运营者或互相信任的团队，不支持互不信任的人共用一个带工具的 agent。所有能给 agent 发消息的人，共享这个 agent 被授予的工具权限。sessionKey 只是路由选择器，不是鉴权令牌。处置顺序是：先管身份，再管能做什么的范围，最后才指望模型〔一手，S19〕。单运营者的默认设置下，主机上执行命令**不需要审批**（`security="full"`、`ask="off"`）〔一手，S19〕。
- **私聊配对**：`dmPolicy: "pairing"` 下，陌生人会收到一个 8 位码（1 小时过期，每个账号最多 3 个待批），批准之前他的消息不处理。批准只开私聊，不开群。第一次用 CLI 批准时，会顺带把这个人设成命令 owner。`open` 只有在白名单里有 `"*"` 时才真的公开〔一手，S21〕。只有一个 owner 时，非 owner 的私聊不能改写 main 会话的回复路由〔一手，S8〕。
- **沙箱**：默认不开；工作区不是沙箱；不开沙箱时，`host=auto` 直接在 Gateway 主机上执行〔一手，S10、S20〕。后端有 Docker、Podman、SSH、OpenShell、Crabbox〔一手，S1 索引〕。
- **提示注入**〔一手，S20、S9〕：
  - 把模型选型当第一道防线：文中引用了一组 2026 年的攻防数据。
  - 外部内容用 `<<<EXTERNAL_UNTRUSTED_CONTENT>>>` 标记包起来，并去掉各家聊天模板的特殊 token。
  - 出站前清掉泄露出来的 `<tool_call>`、`<system-reminder>` 之类的内部标记。
  - 先用只读的 reader agent 把不可信内容总结一遍，再只做发送委托交给主 agent。
  - 上下文的来源和消息正文分开存放；但官方明说这只是加固，不是授权边界。

#### Q9 存储

| 内容 | 位置与格式 | 出处 |
| --- | --- | --- |
| 配置 | `~/.openclaw/openclaw.json`（JSON5） | 一手 S7 |
| 共享状态 | `~/.openclaw/state/openclaw.sqlite`：工作区初始化状态、attestation、automation 作业、scratch、运行历史；schema 30 | 一手 S10、S12、S14 |
| 每个 agent 的运行状态 | `~/.openclaw/agents/<id>/agent/openclaw-agent.sqlite`：auth、路由状态、standing intents、会话行、transcript、记忆索引；schema 31 | 一手 S10、S12 |
| 会话归档 | `agents/<id>/sessions/`；旧的 `sessions.json` 加 JSONL 只能由 doctor 导入 | 一手 S4 |
| Codex 原生状态 | `agents/<id>/agent/codex-home/` | 一手 S10 |
| 人格与记忆 | 工作区 Markdown，建议放私有 git | 一手 S10 |
| 容量控制 | `pruneAfter` 30 天、`maxEntries` 5000、`maxDiskBytes` 10GB；超出时把最旧历史压缩归档后再删行 | 一手 S4、S5 |
| 无痕会话 | 只在内存里，最多 24 小时，Gateway 重启即失效 | 一手 S4 |

transcript 只追加：编辑或删除消息不改写旧行〔一手，S4〕。

#### Q10 用户痛点与被推翻的设计

被改掉的设计〔一手〕：

| 旧设计 | 现状 | 原因或说明 |
| --- | --- | --- |
| heartbeat 是独立机制，配 `HEARTBEAT.md` | v2026.8.1 退役，并进普通 automation | 官方理由是统一自动化概念：七套自动化机制重叠，heartbeat 和 cron 是两个重复的调度 owner，`HEARTBEAT.md` 是"调度器里的调度器"；理由里没提 token 成本〔一手，#110950、#112585、#112967，见 8.2〕 |
| 会话存 `sessions.json` 加 JSONL，工作区状态存 JSON 侧车文件 | 每 agent 一个 SQLite 加共享 SQLite；启动时发现旧存储就拒绝就绪 | 〔S4、S10〕 |
| `/dock-*` 手动把回复改发到别的渠道 | 删除，改用 identityLinks 和绑定线程的会话 | 〔S4〕 |
| QMD 记忆后端和跨 agent 记忆搜索 | v2026.8.1 移除 | 〔S7〕 |
| Active Memory 每轮都跑 | 默认改成 `escalate` | 〔S17〕 |
| 多 agent 时默认交给第一个 agent，或靠 `default: true` 标记 | 必须显式 binding 或 owner，匹配不上就不分派 | 〔S7、S8〕 |
| 用 `before_prompt_build` hook 改提示词 | 从 v2026.4.5 起推荐 provider 贡献的分节 | 〔S9〕 |
| 内置运行时依赖外部 agent 框架（别名 `pi`） | 改成自己的代码 | 〔S3〕 |
| 渠道 SDK 兼容层、同步 SQLite API | 正在下线 | 〔S1〕 |

用户痛点〔二手〕：

1. **token 成本失控**：heartbeat 和上下文反复加载是公认的元凶，有人从每天 150 美元降到 6 美元〔S29〕。
2. **安全**：
   - 暴露在公网的实例据报从 8 万涨到 13.5 万，原因被归到默认绑定所有网卡。
   - ClawHub 技能市场被投毒：Koi Security 审计了 2857 个技能，发现 341 个恶意技能，主要来自"ClawHavoc"行动；之后各家报道的数字更高，口径不一致。
   - 结构性原因：技能是带文件系统和网络权限的可执行代码，市场谁都能上传。
   - CVE 编号和漏洞的对应关系，各来源说法矛盾〔S30〕。
3. **"它忘了"**：记忆没保存〔S29〕。

GitHub issue 的一手统计没做成，因为 API 被限流〔未核实〕。

## 3. 对照灵鲸

| OpenClaw 机制 | 灵鲸对应的需求 | 建议 | 理由 |
| --- | --- | --- | --- |
| 单个 Gateway 进程 + WS 控制面 + 设备配对；事件不重放，缺口时客户端刷新 | 本体常驻；主控台和网页连本体 | **照搬**结构；**改造**鉴权 | 和 `client-backend.md` 的"单进程模块化单体 + CLI 子进程"结论一致。灵鲸只有一个主人：本机免配对，远程连接用 token 就够了 |
| Codex 走 stdio 子进程；每个 agent 一个 CODEX_HOME；spawn 前把进程身份写进 SQLite；按 pid、启动时间、命令行指纹清孤儿；查不清就拒绝再 spawn | 决策 4"大脑全部走 CLI"；本体崩溃后不能留下孤儿 CLI | **照搬** | 是 `client-backend.md` 坑 7"孤儿进程"的现成做法，而且更严格：查不清就拒绝 spawn |
| 内置的进程内 agent 运行时 | — | **不要** | 决策 4 已定全部走 CLI |
| main session 是 agent 的根：主人私聊汇入；群动态合并成通知流入；子任务完成回报；定时检查唤醒它 | 唯一主意识 | **照搬**结构，**改造**汇入规则 | 这是现成最接近"一个她 + 很多对话"的模型。但 OpenClaw 默认把**所有人**的私聊塞进同一个上下文，官方自己都警告会泄露。灵鲸只把**主人**各个形态的私聊并进主意识；家人和朋友的私聊、群聊各自成会话，只以带来源标签的通知汇入 |
| sessionKey 语法、dmScope/groupScope、identityLinks | 跨形态连续；跨平台认人；身份只认绑定 | **照搬** key 语法和 identityLinks；**改造**为只能由主人绑定 | identityLinks 正是"同一个人的多个账号算一个 peer"，灵鲸规定只有主人能绑定 |
| 会话控制器邮箱：每会话一次一轮；steer、followup、collect、interrupt；默认拒绝非请求者 steer | 主意识正忙时主人追加消息；分身执行中主人补充要求 | **照搬** | 主意识默认 collect（聊天常连发几条）；分身对话默认 steer（Codex `turn/steer`）。"别人不能借主人的权限来 steer"这条规则对外部群尤其重要 |
| `sessions_spawn` 子 agent：只注入 AGENTS.md；子 agent 会话不产生记忆；完成后 announce 回报；深度 ≤5，每会话并发 8 | 分身 | **改造** | 并发和深度上限、完成回报、可见或隐藏这几点照搬。但分身必须带她的完整人设；分身的经历要以"这件活是我做的"进她的记忆（来源标"分身"）。OpenClaw 的两条默认做法正好相反 |
| Codex 人设注入：经托管中继只给父会话，原生子 agent 不继承；经线程级 developer instructions 则会被继承 | 决策 4 的人设追加注入 | **参考** | 说明用 `developer_instructions` 注入的人设，会被 Codex 原生子 agent 继承。灵鲸的子对话是本体自己开的，不依赖原生子 agent，但要实测 Codex 原生子 agent 会不会把她的人设带进去 |
| 每个 agent 有独立的工作区、agentDir、SQLite；`sessions_send` 走 A2A；team preset 的协调者 | 朋友（伙伴）；主意识派活 | **照搬**"每个成员一个独立人格边界和独立存储"；**改造**派活 | OpenClaw 的协调者是"派有边界的活"，也就是由它转述；灵鲸要求派活传原话。朋友在外部渠道默认不露面，所以不需要 bindings，由主意识或分身发起。请求方那边"我请老师做了什么、结论是什么"这条记录，要本体自己写 |
| 跨 agent 会话可见性默认 `all`，agentToAgent 默认开 | 隐私按来源；每个成员的记忆独立 | **不要**这个默认值 | 灵鲸默认 self 或 tree，跨成员只开发送委托，不开读历史 |
| 工作区启动文件；单文件 2 万、合计 6 万字符截断；按 prompt 缓存边界分上下两区 | 人设三层注入 | **改造** | 出生设定是稳定内容，放缓存边界上方；成长按版本注入；当下状态易变，放下方。截断标记和固定提示照搬 |
| agent 可以自己重写 SOUL.md，只靠 git 做版本 | 出生设定只有主人能改；成长可查、可回滚 | **不要** | 和灵鲸的规矩冲突。成长要单独存、带版本，由本体写入 |
| heartbeat 退役，并进 automation：Proactive check 每 30 分钟，可设 activeHours、idleOnly，没话说就 NO_REPLY，有 record_result | 主动关心、生活循环、作息、自主开关 | **照搬**"主动 = 普通定时任务 + 安静返回协议 + 只在空闲时 + 活跃时段"；**改造**内容 | 作息对应 activeHours；自主开关关闭 = 不建主动任务，这样也直接对上"只有开启自主的成员持续消耗 token"。但它的 Proactive check 只是一张巡检清单，生活循环得自己设计 |
| Promised Work 要求 + 用 cron 跟进；作业创建即启用并立即试跑；连续出错自动停用并通知 | 兑现承诺 | **照搬** | "答应了就建定时任务"能直接把承诺变成可查的对象；"等确认的停用作业谁也看不见"这个教训也适用于灵鲸的任务看板 |
| 记忆：Markdown + SQLite 索引；来源存成正文写不进去的列；写入路径就是安全边界；后台整理；召回分规则通道和 escalate 通道 | 四类记忆、每晚整理、记来源 | **方向照搬**，深挖留给记忆调研 | OpenClaw 的来源只表示**信任等级**，决定能不能被提升进精选层；灵鲸还需要**受众范围**，决定能在哪说出口 |
| 没有统一的事件日志：会话在每 agent 的 SQLite，作业在共享 SQLite，人格和记忆在 Markdown，审计只记元数据 | 操作日志是唯一事实来源 | **不要照搬** | 灵鲸要以只追加的日志为真相，transcript、记忆、人格变化都是它的投影。OpenClaw 的"no hidden state，文件即真相"只覆盖记忆 |
| 渠道插件和核心的分工（插件管入站、配对、白名单、会话语法、出站；核心管 message 工具、路由、key 外形）；`assertAuthority` 在每次副作用前复核权限 | 形态插件（感知 + 行动）；适配器开发包 | **照搬** | 分工清楚，正好对应 product.md 里"每个适配器提供感知和行动" |
| 一个 Gateway 一个信任边界；先身份、再范围、最后模型；外部内容打标；reader agent | 防操控；身份只认绑定 | **照搬**原则；**改造**多方场景 | OpenClaw 明说不支持互不信任的人共用一个带工具的 agent，而灵鲸在外部群里就是这种场景。所以非主人发起的回合，默认不带主人的工具权限 |
| SQLite 优先；从 JSON/JSONL 迁到 SQLite 吃了迁移的苦 | 存储（决策 3） | **照搬**，一开始就用 SQLite | 避开 OpenClaw 和 Paseo 走过的 JSON 文件弯路 |
| 重启后续跑被中断的回合（保留已记录的工具调用，3 次启动失败用尽预算，重新校验原调用者权限） | 出错也像人；本体崩溃后的恢复 | **照搬** | 现成、细致的规则 |
| Codex 的诊断日志 `logs_2.sqlite` 即使在无痕会话里也照写 | 隐私；记忆删除；备份搬家 | **警示** | CLI 大脑会在本体之外留下副本，删除和隐私要覆盖到 CLI 那一侧 |
| broadcast groups（一个外部群里多个 agent，限轮次） | 第五版：外部群里多个成员各用自己的账号 | 到时参考 | — |

## 4. OpenClaw 没有、灵鲸必须自己设计的

1. **带人设的分身和经历回流**：OpenClaw 的子 agent 去掉了 SOUL.md 和 IDENTITY.md，子 agent 会话也被结构性地排除在记忆之外，没有"分身也是她"的概念。
2. **派活传原话的契约**：`sessions_spawn` 的任务是模型写的转述文本；灵鲸要把原话、相关聊天和记忆原样交接，还要有固定格式的进度摘要。
3. **人格三层**：OpenClaw 只有一份 agent 能改的 SOUL.md。出生设定只读、成长带版本可回滚、当下状态随时间消退，这三层都得自己做。
4. **当下状态（心情）**：读到的文档里完全没有情绪或状态模型。
5. **按受众管理的隐私**：OpenClaw 的来源字段管的是"可不可信、能不能进精选层"，群和私聊的隔离也是在会话层面；"这条记忆能在哪、对谁说"要自己设计。
6. **操作日志是唯一事实来源**：OpenClaw 是"状态表 + Markdown 文件"，审计只记元数据，无法从日志重建记忆和人格。
7. **自主开关**：OpenClaw 只有每个 agent 的工具策略和沙箱，没有"有没有自己的生活、能不能主动找人"的开关。
8. **花钱总闸**：读到的文档里没出现系统级的预算熔断〔未核实是否存在〕。
9. **生活循环**：Proactive check 本质是巡检清单。按兴趣自己找事做、逛 B 站、自学这些，需要另外的任务生成机制。
10. **关系模型**：USER.md 只描述主人一个人；家人、朋友、成员之间的关系和印象没有建模。
11. **干活流程的状态机**：OpenClaw 有进度卡片和 exec 审批，但没有"设计 → 审设计 → 执行 → 验收"这样的审核关口。
12. **内部群**：Control UI 还没有团队线程；broadcast groups 只用在外部渠道。
13. **快照、回收站、一键回滚**：读到的文档里只有"工作区放进 git 备份"的建议〔未核实有没有其他机制〕。
14. **出错也像人**：OpenClaw 出错时报的是固定文案。

## 5. 坑与反例

1. **heartbeat 成了第二套调度器，最后被并进 cron**〔一手〕：官方给的退役理由是概念重复，不是费用。七套自动化机制重叠；heartbeat 和 cron 各管一套节奏、投递和会话配置；`HEARTBEAT.md` 是每个 tick 都要解析的"文件里的调度器"（#110950，v2026.8.1）。空跑烧钱是用户这边最常见的 heartbeat 抱怨（#61690、#67308），但官方理由里没有这一条。灵鲸一开始就不该有"心跳"这个独立概念：主动性就是普通定时任务，只是带上活跃时段、只在空闲时跑、安静返回这几项属性。
2. **默认把所有私聊并进一个会话**〔一手〕：对多人场景，官方自己就警告会泄露。默认值只适合"只有主人一个人在用"。
3. **默认跨 agent 全可见**〔一手〕：没开沙箱的 agent 能读其他 agent 和其他用户的 transcript，官方把这定性为"设计如此，不算漏洞"。
4. **子 agent 丢人设**〔一手〕：派生出去的会话只有 AGENTS.md。如果灵鲸照抄子 agent 机制，分身就不是"她"了。
5. **工作区不是沙箱**〔一手〕：用绝对路径照样能碰到主机上的任何地方；沙箱默认关，主机执行命令默认不需要审批。
6. **bindings 不是访问控制，sessionKey 不是鉴权**〔一手〕：路由和权限必须是两套机制。
7. **记忆被噪音淹没**〔一手〕：自动抓取的记忆大部分是在复述运行时指令、heartbeat 噪音和召回循环。OpenClaw 靠"按会话类型挡掉"和"注入过的内容不再抽取"来防。
8. **collect 在持久入站渠道上失效**〔一手〕：Telegram、Discord 上会退化成 followup。灵鲸以后接 QQ、微信时要先确认。
9. **协作 steer 等于借权限**〔一手〕：让 Bob 能 steer Alice 发起的回合，就等于让 Bob 用上了 Alice 的权限。
10. **CLI 大脑在本体之外留数据**〔一手〕：Codex 无论如何都会把消息写进 `logs_2.sqlite`；app-server 协议没有版本协商，同一个大版本内的变化也可能出问题。
11. **复杂度爆炸**〔一手〕：文档 1436 页；到处是 `doctor --fix` 迁移；SQLite schema 已经到 30 和 31；为了兼容，文档里满是例外条款。这和 `client-backend.md` 里 Paseo 的教训一样。
12. **安全事故**〔二手〕：十几万个实例暴露在公网；技能市场被大规模投毒。灵鲸的技能和自写工具不能是"谁都能装的可执行代码市场"，要有隔离。

## 6. 待实测或待核实

- acpx 怎么拉起、监管、回收 Claude Code 这类 ACP CLI 子进程（这次没读）。
- heartbeat 退役的官方理由和具体版本：要去 `CHANGELOG/2026.*.md` 或公告里找。
- agent 的文件工具有没有硬性禁止写 SOUL.md 或 AGENTS.md。
- 有没有系统级的预算或花钱上限。
- 模型接口失败时的 fallback 链细节。
- 多端接续同一个会话的机制（`concepts/session-attachment`，没读）。
- 内置记忆 SQLite 用的是哪个向量扩展；standing intents 的数据结构；dreaming 的调度时间。
- GitHub issue 里最多的抱怨（一手统计）：等 API 配额恢复或换认证后再查。
- 实测：Codex 原生子 agent 会不会继承用 `developer_instructions` 注入的人设（关系到决策 4 和分身）。
- 沿用旧报告的遗留项：WS 协议的 seq 起点、stateVersion 覆盖哪些状态。

## 7. 整体架构问题 A–J 速答

- **A 进程模型与分层**：每台主机一个 Gateway Node 进程，渠道、路由、队列、调度、内置 agent 运行时、记忆插件都在进程内。CPU 重活放进 worker 线程；Codex app-server 和 ACP CLI 是子进程；客户端和设备节点经 WS 连进来。
- **B 核心对象与数据模型**：
  - agent 是人格边界，包括工作区、agentDir 和自己的 SQLite。一个 agent 有多个 session。
  - sessionKey 是上下文的桶和并发单位，背后指向当前 sessionId 的 transcript；重置换 sessionId，key 不变。
  - session 和 conversation（外部地址 `conversationRef`）是两回事：多个私聊地址可以共用一个 main 会话。
  - 一次执行是一个 run（runId），按轮次进会话邮箱；事件是 WS 推送，带连接内的 seq，不重放。
  - automation 作业和 standing intent 是独立对象。
- **C 事件流**：
  - 外部消息：渠道插件（鉴权、配对、提及判定）→ bindings 选出 agent → 按 scope 规则算出 sessionKey → 会话邮箱（steer、followup、collect、interrupt）→ 全局 lane 的并发上限。
  - 时钟：GatewayScheduler 触发 automation 作业，作业跑在共享、隔离或 detached 会话里。
  - 内部事件（子任务完成、后台进程结束、群动态、新会话创建）：作为系统通知排进目标会话（大多是 main），不额外唤醒。
- **D 中心调度还是多 agent 平级**：没有全局的中心大脑。各 agent 平级，各自以 main 会话为根；Gateway 是确定性的路由器。层级只存在于 spawn 树里（父到子，最多 5 层）；team preset 的协调者只是写在 AGENTS.md 里的约定。
- **E 主动性调度**：heartbeat 已退役，并进 automation。默认一个每 30 分钟的 Proactive check 跑在 main 会话上，可以限定活跃时段、只在空闲时跑，没话说就 NO_REPLY。承诺和提醒走 cron；standing intents 作为前瞻记忆。
- **F 事实来源与持久化**：以状态表为主，不是事件日志。会话行和 transcript 在每个 agent 的 SQLite（只追加），作业在共享 SQLite，人格和记忆是工作区 Markdown（"no hidden state"），审计只记元数据。
- **G 插件和适配器的边界**：插件只能走 `openclaw/plugin-sdk/*`。渠道插件管入站、配对、白名单、会话语法、出站、线程；核心管共享的 message 工具、key 外形、路由和调度。大脑以 harness 插件的形式注册 runtime id。
- **H 多端连接与同步**：所有会话状态归 Gateway，客户端只查询。每个客户端一条 WS，hello-ok 带快照，事件不重放，出现缺口就刷新。主人从任何渠道私聊都进同一个 main 会话（在 Control UI 里是 Home）。多端接续同一会话的细节没读。
- **I 安全与权限边界**：一个 Gateway 一个信任边界；顺序是身份（配对、白名单）→ 范围（提及门控、工具策略、沙箱）→ 模型。sessionKey 不是鉴权；沙箱默认关；跨 agent 的会话可见性默认全开。
- **J 出错与恢复**：
  - Gateway 重启：已受理但被中断的回合自动续跑，保留已记录的工具调用；3 次启动失败就用尽预算；续跑前重新校验原调用者的权限。
  - cron：被中断的运行记为失败，还没投递的给一次重试，过期的作业重新排期而不重放。
  - Codex：子进程孤儿按登记清理，查不清就拒绝再 spawn。
  - 投递结果不明时，在下一轮提示。
  - 记忆相关的步骤失败不阻塞回复。
  - 模型接口失败走 fallback 链，细节没读。

## 8. 补充调研（2026-10-28）

补两处缺口：GitHub issue 里用户痛点的一手统计，以及 heartbeat 退役的版本和官方理由。用的是未认证的 GitHub search API（返回结果自带 issue 和 PR 正文）、REST API（只读了一个 issue 的评论）、raw 地址下的分版本 CHANGELOG，都下载到 `mktemp -d` 临时目录里只读解析。

### 8.0 新增来源

| # | 来源 | 读了什么 | 类别 |
| --- | --- | --- | --- |
| S31 | search：`repo:openclaw/openclaw is:issue`，按评论数取前 50 | 标题、标签、计数，按需读正文；全仓 issue 总数 61,577（2026-10-27） | 一手 |
| S32 | search：同上，按 reactions 取前 50 | 同上 | 一手 |
| S33 | search：按架构主题的标题关键词专查（heartbeat、费用、记忆、投毒、遗忘、串话、泄露、刷屏、崩溃、升级）和 4 个机器人打的 `impact:*` 标签 | 命中数 + 每组前 30 条（按评论数）的标题；代表 issue 读正文 | 一手 |
| S34 | `CHANGELOG/2026.7.1.md` 至 `2026.10.8.md` 及 `Unreleased.md`（raw） | 按 heartbeat、HEARTBEAT.md、scratch、monitor 和 PR 号检索；`2026.9.6.md` 下载超时，没读 | 一手 |
| S35 | issue #110950 "Everything is a cron" | 正文 + 全部 10 条评论 | 一手 |
| S36 | PR #112585、#112967、#113131 | 正文；同一计划的其余 PR（#110978、#111112、#112387、#113135、#113165、#113455、#113621）只读了标题和合并日期 | 一手 |
| S37 | `docs.openclaw.ai/concepts/session-tool.md` | Visibility 一节，用来复核 Q3 | 一手 |
| S38 | WebSearch 两次（heartbeat 退役原因） | 没找到解释退役原因的二手文章 | 二手 |

### 8.1 用户痛点的一手统计

#### 8.1.1 热门榜归类

做法：按评论数和按 reactions 各取前 50，两份重叠 11 条，并集 89 条。每条只归入一个主类；"由升级引起"另外单独统计（带 `regression` 标签，或标题、正文写明升级到某版本后出问题）。

| 主题 | 评论前 50 | reactions 前 50 | 并集 89 | 代表 issue（已读正文） |
| --- | --- | --- | --- | --- |
| 安装、打包、平台与界面（npm 包缺文件、systemd、Docker、Linux/Windows 客户端、WebUI） | 10 | 13 | 19 | #52808、#75、#1818 |
| 功能请求：新模型和 provider、搜索、MCP、实时语音、i18n | 1 | 18 | 18 | #4834、#7200 |
| 模型和 provider 的兼容与鉴权（接口格式报错、OAuth、账号被封、误报限流） | 9 | 7 | 13 | #17019、#2697、#14203 |
| 渠道接入（飞书、钉钉、微信、WhatsApp、Discord…） | 5 | 7 | 10 | #8650、#52885 |
| 网关稳定性：内存泄漏、OOM、CPU 打满、SQLite WAL 卡住启动、子进程拖垮主进程 | 10 | 0 | 10 | #143524、#91588、#144911、#153257 |
| 回复丢失、静默失败（含子 agent 结果丢失） | 4 | 0 | 4 | #116277、#121058、#44925 |
| 安全、信任与泄露（工具调用之间的文字漏到渠道、记忆按来源打信任标签、多用户权限） | 3 | 1 | 4 | #25592、#7707、#8081 |
| 费用与上下文膨胀 | 1 | 2 | 3 | #42475、#2254 |
| 连接鉴权与配对 | 3 | 0 | 3 | #4531 |
| 项目治理与其他（Stabilisation Mode 公告、维护者跟踪单、钓鱼帖） | 2 | 2 | 3 | #5799、#88838 |
| 工具突然不可用、agent 只说不做 | 2 | 0 | 2 | #34810 |
| 合计 | 50 | 50 | 89 | |
| 其中由升级引起（交叉统计） | 11 | 3 | 13 | #153257、#52885、#52808 |

偏差说明：
- 按 reactions 的前 50 全部创建于 2026 年 1–3 月（项目爆红期），按评论数的前 50 也有 35 条在 1–3 月。所以热门榜主要反映"装不上、连不上、某个模型或渠道用不了"。
- 下半年 issue 的评论数里混着机器人（clawsweeper）的审查回帖和用户自建监控 cron 的自动回帖（例如 #121058 的作者用 cron 持续记录复发），评论数不完全代表人的关注度。
- 和整体架构相关的主题在热门榜里条数少，需要按关键词专查，见 8.1.2。

热门榜里和架构相关的代表 issue〔一手，正文〕：
- **#116277 / #121058**（P1，message-loss）：`deepseek-v4-flash` 在 Telegram 群里一轮跑完却没有生成回复，只发出通用兜底文案"No reply was generated…"，不带任何诊断信息。修复 #118305 合并后，仍有一种失败形态持续复发：`visible channel turn dispatched with no queued reply payloads`。
- **#143524**（P0）：10 个 agent 的 Windows 主机上，其中一个 agent 的 `openclaw-agent.sqlite-wal` 两天内涨到 1.4–2.8 GB，网关进程活着但始终不绑定端口；只有离线做 checkpoint 能恢复。
- **#144911**（P1，crash-loop）：一个 stdio MCP server 在 30 秒内没完成 `initialize`，子进程清理路径抛出未处理的 rejection，整个 Gateway 退出，所有渠道和会话同时掉线；靠 systemd 重启加 main 会话的重启恢复才回来。
- **#153257**（P1，crash-loop，open）：升级到 2026.9.5 后，原本稳定的环境里 CPU 148%、RSS 3.9 GB、`SQLite transaction admission was refused`，作者排查了 8 小时，原话"OpenClaw made me believe the problem was mine"。
- **#44925**（P1，open）：子 agent 完成后 announce 回父会话失败，结果静默丢失（生产环境至少 9 次）；子 agent 超时后既不重试也不通知；子 agent 声称"文件已创建"，实际文件不存在。
- **#25592**（P1，security）：工具调用之间的叙述、报错、对系统事件的确认都被当成消息发到 Slack 和 iMessage。唯一的规避办法是要求 agent 除最终回复外一律回 `NO_REPLY`，作者说这"fragile and fails regularly"。
- **#42475**（open，2026-03-10 至今）：请求在网关层按 agent 设每日、每月花费上限。据作者对源码的描述，现有用量统计只用于观察，没有任何强制执行。

#### 8.1.2 按架构主题专查

命中数是标题关键词的命中，含噪声，只能看量级。

| 主题 | 检索（标题） | 命中 | 代表 issue（已读正文）和要点 |
| --- | --- | --- | --- |
| token 和费用失控 | `cost OR tokens OR billing OR spend` | 712（含 OAuth token 噪声） | **#61690**：`HEARTBEAT.md` 是空的，heartbeat 每 30 分钟仍在 main 会话里重放整段历史，每次约 2.7 万输入 token，3 天花了约 20 美元。**#67308**：用户什么都没做，每天被自动用掉至少 1 亿 token。**#20894**：每条消息的元数据（含 `message_id`）注入系统提示词，破坏 Anthropic 前缀缓存，cache_write 增加 80–170 倍。**#143017**（open）：持久会话有五种改写前缀的方式，实测 2130 万 cache-write token。标题含 `HEARTBEAT.md` 的 issue 共 45 条，取回的前 40 条里有 11 条和空跑费用直接相关（抱怨空跑花钱，或请求清单为空时不调模型） |
| 记忆出错或被投毒 | `memory`（排除 leak/OOM/RSS）；`poison OR poisoning OR "prompt injection"`；`forgets OR amnesia OR "lost context"` 等 | 2196（多数是 memory-core 的索引、超时 bug）；153；87 | **#69943**（P1，security）：session-memory hook 把原始 chat-template 控制 token 和没解析的 tool call 存进每日记忆，下次 `/new` 时作为摘要再注入，模型输出更坏，再被存下来，每次 `/new` 都更糟；只能关掉 hook 并隔离记忆文件。**#113346**：一个 agent（`deepseek-v4-flash`）陷入工具调用循环，之后它自己或另一个 agent 读了这段 transcript 也开始循环，压缩摘要会把这个模式继续带下去。**#43747**：同一团队三个人的记忆行为三种样子。**#60213、#98156**：压缩或中止超时后静默新开一个空会话，整段上下文丢失 |
| 主动消息打扰人 | `heartbeat`；`unsolicited OR spam OR unwanted OR phantom` | 879；119 | **#143278**（P1，open）：升级到 2026.9.3 后，heartbeat 的内部输出（NO_REPLY、scratch 笔记）直接发到用户的 Telegram 私聊，用户只能关掉 heartbeat。**#3181**：重复注入的 heartbeat poll 加上 Telegram 发送失败的重试，形成重试风暴，CPU 和调用费用都飙升。**#68478**：创建 cron、安装技能这类系统确认消息刷屏，而且没法关。**#116348**：provider 故障期间，每次失败的轮次（包括自动重试）都在群里发同一条兜底文案，群友开始回复这些兜底消息，又污染了后续上下文。**#30197**：用户消息被 steer 进正在跑的 heartbeat 回合，模型先回 `HEARTBEAT_OK`，结果对用户的真实回复被一起吞掉 |
| 多 agent、多会话串话 | `"wrong session" OR "wrong channel" OR "wrong chat" OR "cross-session" OR …` | 214 | **#24148**：一个非管理员员工在 Teams 私聊了一句，覆盖了 main 会话的回复目标；Teams 插件崩溃恢复后，heartbeat 把财务数字和安全告警发给了这位员工。**#135117**（P1，open，待安全审查）：2026.8.1 上，一条已经投递过的 cron 结果 9 分钟后被重放进 `heartbeat-main` 会话，用了早先一个无关工作流留下的 Discord 路由，发到了错误的频道。**#99912**：给某个 agent 配了 `isolatedSession` 的 heartbeat，实际却跑在默认 agent 的会话里。**#79308**：群会话建得没错，回复却发到了用户私聊。**#151962**：一个 13 天的长会话里，heartbeat poll、异步命令完成通知等内部字符串被当成"用户消息"提交给模型，又没写进 transcript，用户和模型对"说过什么"的认知不一致 |
| 隐私泄露、内部内容外泄 | `leaks OR leaked OR leaking` | 535（约一半是进程或资源泄漏） | **#25592**（见上）。**#137927**（P1，security）：每轮注入的内部上下文块 `<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>` 以可见文本形式出现在 Telegram 消息里；它的措辞像提示注入，模型识别后拒绝继续。**#24148**（见上） |
| 进程崩溃和恢复 | `crash OR OOM OR crashloop OR hang`；标签 `impact:crash-loop` | 2033；1959 | **#91588**（P0，open）：网关 RSS 两三天内从 350 MB 涨到 15.5 GB，被 OOM 杀掉后反复重启。**#97616**：hook 和工具的子进程（bash、codex、chrome-headless）不回收，僵尸进程越积越多，直到 `spawn EAGAIN`，重启才恢复；2026.6.x 多个版本都有。**#144911**、**#143524**（见上） |
| 升级迁移带来的破坏 | 标签 `regression`；`upgrade OR updating OR migration` | 3224；1303 | **#153257**（见上）。**#123057**（P0，data-loss）：2026.8.1-beta.1 的 `doctor --fix` 在没有接收方 cron 作业时删掉了 `HEARTBEAT.md`，还报告迁移成功，内容没有任何存档。**#52885**：升级到 2026.3.22 后，腾讯的微信插件报 `Cannot find module 'openclaw/plugin-sdk'`，直接加载失败。**#186185**（2026-10-27）：heartbeat 迁移完成后，如果用户重建了一个 `HEARTBEAT.md`（例如指向工作区外的符号链接），每次 `doctor --fix` 都会失败，升级也被拒绝 |

机器人 clawsweeper 给 issue 打的影响标签（只覆盖它审过的 issue，标签之间有重叠）：`impact:session-state` 6352、`impact:message-loss` 4485、`impact:security` 3050、`impact:crash-loop` 1959。

#### 8.1.3 对灵鲸整体架构最有警示意义的五条

1. **内部内容和对外发言没有结构上的隔离，是泄露和打扰的最大来源**（#25592、#137927、#143278、#151962）。OpenClaw 默认把模型的裸文本发到渠道，"不说话"要靠模型记得输出 `NO_REPLY` 或 `HEARTBEAT_OK`；内部上下文和系统事件又以文本形式拼进用户这一轮。灵鲸的对应做法：对外发言只能通过显式的发送动作，裸文本一律算内部；通知、自主触发和人说的话走不同的结构通道，不拼成同一段文本。这样决策 11 的"没话可以不说"就是默认状态，不用模型额外表态。
2. **投递目标不能是会被改写的会话状态**（#24148、#135117、#99912、#79308）。OpenClaw 的串话大多源于"会话记着最近一次的回复目标"，别的来源一改，主动消息就发错人。灵鲸的对应做法：每条外发消息的目标由触发它的那条事件显式携带；主意识主动发起的消息只发给主人或明确指定的人（决策 11、12）。
3. **子任务结果会静默丢失，"已完成"的说法可能是假的**（#44925）。决策 12、14 里干活分身要向主意识汇报：汇报要先落日志再投递，失败要重试，超时要告诉主人；"文件已创建"这类可以核对的说法，要在交接包的审核点里核对。
4. **坏输出被存成记忆或摘要，再注入后会自我强化，还会在 agent 之间传染**（#69943、#113346）。每晚整理和分身经历回流写入记忆之前要先清洗：去掉控制 token、没解析的工具调用和重复循环的片段。这和 Q6 里 OpenClaw 现在的"注入过的内容不再抽取"是同一类防线，灵鲸也要有。
5. **单进程里一个外部依赖就能拖垮全局，升级迁移也会破坏原本稳定的环境**（#144911、#97616、#143524、#91588、#153257、#123057）。灵鲸也是单进程本体加 CLI 子进程（决策 4）：子进程或 MCP 失败只能影响当前这一轮；子进程要回收；SQLite 的 checkpoint 要有明确的负责方；迁移必须先备份，确认接收方已经写入成功，才能删旧数据。

和已定决策直接相关的另外两点（不重新讨论决策，只说影响）：
- 决策 6 的主意识默认大脑是 DeepSeek V4.1 Flash。issue 里 `deepseek-v4-flash`（不是同一版本）出现过静默空回复（#116277、#121058）和工具调用循环（#113346）。建议把"空回复、没有投递"和"陷入循环"加进上线前那约 20 个真实场景的验证里。
- 决策 9 的花钱总闸：OpenClaw 至今没有网关层的花费上限（#42475 仍开着）。空跑重放整段历史（#61690）、易变内容破坏前缀缓存（#20894、#143017）是费用失控的两大来源，这也支持决策 13④ 的做法：人设放缓存边界上方，当下状态和通知收件箱放下方。

### 8.2 heartbeat 为什么退役

**版本：v2026.8.1**〔一手〕。退役相关的 10 个 PR 都列在 `CHANGELOG/2026.8.1.md` 的贡献记录里；`2026.9.1.md` 也写明 #112967 已在 v2026.8.1 发布。2026.7.1 里与此相关的只有一条"doctor lint 能识别旧的带围栏的 HEARTBEAT.md 模板"（#98400）。8.1 的 Highlights 和 Changes 里**没有单独写这次退役**，只能从贡献记录里的 PR 号查到。

**过程**〔一手，S35、S36〕：全部由维护者 steipete 完成（PR 带 maintainer 标签）。
- 2026-07-18：开 #110950 "Everything is a cron — unify heartbeat, watchers, and scheduled automation"；当天合并 #110978（作业按自身节奏动态调度，模型提议下次检查时间，超出范围就夹到边界）。
- 07-19 至 07-21：#111112（脚本作为作业的载荷）、#112387（长期运行进程的输出流作为调度来源）。
- 07-22：#112585，用"系统拥有的 heartbeat monitor 作业"替换专门的定时器。
- 07-23：#112967，`HEARTBEAT.md` 改存到数据库里每个作业的 scratch；#113135，节奏归 cron 作业行管；#113165，`tasks:` 条目转成独立的 cron 作业。当天 #110950 关闭，作者总结："Every schedule-like construct now lives in cron-owned database state."
- 07-24：#113131，删除运行时读旧 `HEARTBEAT.md` 的兜底路径。原计划等一个稳定版的升级窗口再删，PR 里写的是"operator decision (2026-07-24): land now rather than holding for a stable upgrade window"，从此 `doctor --fix` 是唯一的迁移路径。
- 07-25：#113455（文档对齐已退役的配置项）、#113621（agent 文件编辑器里不再显示 `HEARTBEAT.md`）。
- 之后的余波：#123057（8.1-beta.1，`doctor --fix` 删了文件却没迁进去，P0 数据丢失）；2026.9.7 的 #156859"迁移已退役的 heartbeat 等配置"；2026-10-27 的 #186185、#186307（重建的 `HEARTBEAT.md` 阻塞 doctor 和升级）。

**官方理由**〔一手，#110950 正文，#112585、#112967、#113131 正文〕：
1. **概念泛滥**：heartbeat、cron、后台任务、hooks、Task Flow、standing orders、commitments，七套自动化机制是"自然长出来的"，彼此重叠。
2. **heartbeat 和 cron 重复**：节奏配置、投递目标、模型和超时覆盖、会话目标各有一份；两个调度 owner 意味着两套调度逻辑。heartbeat 的节奏也看不见：`cron list` 里没有它，也没有运行记录。
3. **`HEARTBEAT.md` 是"调度器里的调度器"**：一个每个 tick 都要重新解析的文件；按存储策略它属于该进 SQLite 的遗留文件存储；没有修订保护（多个写入方会互相覆盖）；monitor 也没法拥有自己的上下文。
4. **agent 没法调整自己的唤醒节奏**：`heartbeat_respond` 工具已经会记录 `nextCheck`，但调度器不理会。
5. 明确接受的代价：失去用 git 同步这份清单的能力，改为用 `openclaw cron scratch` 和 Control UI 编辑。

**理由里没有 token 费用**：上面四份正文和 #110950 的 10 条评论都没提成本。费用是用户这边最常见的 heartbeat 抱怨（见 8.1.2），但没有被官方列为退役理由。之前的二手说法（S29：退役是为了省 token）**没有一手依据**；两次 WebSearch 也没找到解释退役原因的二手文章。

**保留下来的部分**〔一手，#110950、#112585〕：唤醒总线和 `runHeartbeatOnce` 保留下来，作为唯一的投递通道（服务约 17 个事件来源，cron 只是其中之一）；活跃时段、相位错开、防洪这些原先 heartbeat 独有的保护推广到所有作业；`HEARTBEAT_OK` 抑制、去重、可见性、保持新鲜度变成作业的显式属性。所以"heartbeat"这个词至今还在 2026.9.x 和 10.x 的 CHANGELOG 里大量出现，指的是系统拥有的 monitor 作业和这条唤醒通道，不是旧的独立机制。

**对灵鲸的含义**：OpenClaw 用了半年、几百条 issue 才把"心跳"拆回普通定时任务（标题含 heartbeat 的 issue 有 879 条，其中大量是节奏失灵、串到别的会话、内部输出外泄、吞掉用户回复）。灵鲸的作息、闲时、承诺到期这些自主触发（决策 11、13），从第一天起就应该是同一种定时或事件作业，按作业属性区分，不另立一套调度。#113131 和 #123057 也说明：删除旧路径不要早于升级窗口，迁移要先确认接收方已经写入。

### 8.3 对前文的修改和复核

- **改了 Q10 表格的 heartbeat 一行**：原来写"文档只写了迁移步骤，没写原因；二手资料普遍认为是 token 成本"，现在改为退役版本 v2026.8.1 和一手的官方理由。原因：查到了官方理由，而且其中没有成本。
- **改了第 5 节第 1 条**：原标题是"heartbeat 烧钱，最后被拆掉"，把退役归因于费用。现在改为"heartbeat 成了第二套调度器，最后被并进 cron"，并注明费用是用户侧的抱怨，不是官方理由。"灵鲸不该有独立心跳概念"这个结论不变，依据更直接了。
- **没改、但已经由本节回答的**：第 6 节的"heartbeat 退役的官方理由和具体版本"和"GitHub issue 里最多的抱怨"两项，以及 Q10 末尾"GitHub issue 的一手统计没做成"一句。第 6 节"有没有系统级的预算上限"一项现在有部分答案：据 #42475（open），网关层没有。
- **复核 Q5**："heartbeat 已经退役"成立。需要补充的细节是：退役的是独立定时器、`HEARTBEAT.md` 和 heartbeat 专属配置，唤醒通道和 `heartbeat_respond` 工具还在（见 8.2）。
- **复核 Q3**：跨会话可见性默认 `all`，当前文档仍然这样写，结论不变。2026.8.2 的版本说明写过"未开沙箱的会话默认可以访问同一 agent 的其他会话"，中间可能改过不止一次〔未核实〕。
