# 常驻人格 agent：会话划分、跨地方隐私、主动开口、派活与多人设（第二层调研笔记）

截至 2026-11-01。标注：〔一手〕我自己读了源码或官方文档；〔二手〕博客、新闻、社区整理、搜索摘要；〔推理〕我自己推的。只补 `2026-10-28-openclaw-architecture.md` 和 `2026-10-28-companion-architectures.md` 里**没有**的内容，旧笔记已有的只在需要对照时一句带过。

读的版本：
- OpenClaw：官方文档 `docs.openclaw.ai/<页>.md`（2026-11-01 抓取）+ 分版本 CHANGELOG（最新 2026.10.9），仓库 HEAD `d1d4506`（2026-11-02）。
- MaiBot：`Mai-with-u/MaiBot` `c6429547`（2026-10-30），v1.3.19。
- AstrBot：`AstrBotDevs/AstrBot` `4f60422f`（2026-11-02 JST），`pyproject.toml` 版本 4.29.4。
- Hermes Agent：`NousResearch/hermes-agent` HEAD 经 raw 抓取（2026-11-01），最新 tag `v2026.9.24`；完整 clone 没拿到，下文路径写 `HEAD`。
- elizaOS：`elizaOS/eliza` develop `b2dbeff3`（2026-11-01）。
- AIRI：`moeru-ai/airi` `7ab1ecae`（2026-11-02）。
- Letta：`letta-ai/letta-code` `3b7e3ffc`（2026-11-01）+ `docs.letta.com`。
- 产品帮助中心：Kindroid（官方）、SillyTavern（官方文档）；Nomi、Character.AI、Neuro-sama 只有二手。
- 没读到：Neuro SDK 规范原文（代理拒绝）、PETS 2026 群聊机器人隐私论文正文（PDF 无法解码）、Character.AI 官方群聊机制。

## Q1 会话怎么划分：每个角色一个常驻会话，还是按地方、按人、按对话分？为什么

### Takeaway
真正"一个角色一个常驻会话吃下所有私聊"的只有 OpenClaw 的 `dmScope: main`，它明说只适合单一使用者；而且 2026.2.22 起 CLI 引导已经把新装默认改成按"渠道 + 发送者"隔离。其余系统（Hermes、Letta、AstrBot、麦麦、AIRI、eliza）都是"身份和记忆按角色共享，对话历史按聊天或线程分开"。Hermes 甚至默认把群里每个人分开。OpenClaw 还有一个混合形态：群各自一个会话，主会话以合并通知的方式"旁观"所有群，信息只向主会话单向流动。这个形态和灵鲸的总会话最接近。

### Cited Findings

**OpenClaw（补新）**
- `dmScope` 的来历：2026.1.15 才加入，changelog 原文 "add `session.dmScope` for multi-user DM isolation and audit warnings"（#948）〔一手，[CHANGELOG/2026.1.15](https://raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG/2026.1.15.md)〕。也就是说，最早只有"所有私聊进 main"一种形态，多人共用出问题后才补的隔离。
- 2026.2.22 **BREAKING**："CLI local onboarding now sets `session.dmScope` to `per-channel-peer` by default for new/implicit DM scope configuration. If you depend on shared DM continuity across senders, explicitly set `session.dmScope` to `main`"（#23468）〔一手，[CHANGELOG/2026.2.22](https://raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG/2026.2.22.md)〕。2026.2.13 已经在安全审计、doctor 和渠道引导里给出 `openclaw config set session.dmScope ...` 的修复命令（#13129）〔一手，[CHANGELOG/2026.2.13](https://raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG/2026.2.13.md)〕。
- 当前文档仍把 main 写成"个人 agent 的默认"：配置项默认值是 `main`；main-session 页原文 "OpenClaw is a personal agent first. Out of the box, every direct message … lands in one rolling conversation … There is one brain, and this is where it thinks"〔一手，[concepts/main-session.md](https://docs.openclaw.ai/concepts/main-session.md)、[concepts/session.md](https://docs.openclaw.ai/concepts/session.md)〕。所以有**两个默认**：配置默认是 `main`，CLI 引导写入的是 `per-channel-peer`。当前引导页没提 dmScope，2026.10 的引导是否仍写 `per-channel-peer` 未核实。
- **群的旁观（ambient watching）**：`groupScope: per-group`（默认）下，群会话各自隔离，"while the main session automatically watches them. Activity queues up as compact notices — coalesced per conversation, never one wake-up per message — and the agent sees them the next time it runs"；主会话的系统提示"names watched groups so it knows where recent activity happened"〔一手，main-session.md〕。新建会话也会给 Home 排一条通知，但"creation does not trigger an extra wake-up"（`session.notifyOnCreate`）〔一手，同上〕。
- 把群并进 main（`groupScope: main` 或 binding 覆盖）会触发审计项 `security.trust_model.group_scope_main`："Every member of each matched room shares that context, so reserve this for trusted rooms"〔一手，[cli/security.md](https://docs.openclaw.ai/cli/security.md)〕。
- 例外：Slack Agent View / Assistant View 的私聊即使在 `main` 下也按根线程各开一个会话〔一手，session.md〕。
- 重置：默认 `mode: "none"`（不自动重置，靠压缩），`daily`（默认 4 点）、`idle` 可选，还可以用 `resetByType`（direct / group / thread）和 `resetByChannel` 覆盖。`/new`、`/reset` 时把旧会话的尾部写进当天记忆笔记，新会话会重新带上近几天的笔记〔一手，session.md、main-session.md〕。

**Hermes Agent（新）**
- 会话键：`<ns>:<platform>:<chat_type>[:<chat_id>][:<thread_id>][:<user>]`。私聊按 chat_id 各一个会话；**群和频道默认按"群 + 发送者"各一个**（`group_sessions_per_user: true`）；话题和线程默认整线程共享（`thread_sessions_per_user: false`）；拿不到发送者 ID 时退回整群一个会话〔一手，[gateway/session.py `build_session_key`](https://github.com/NousResearch/hermes-agent/blob/HEAD/gateway/session.py)、[website/docs/user-guide/sessions.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/sessions.md)〕。
- 理由原文："Alice and Bob can both talk to Hermes in the same Discord channel without sharing transcript history; one user's long tool-heavy task does not pollute another user's context window"。改成 `false` 就是"one shared 'room brain'"，代价是"shares token costs, interrupt state, and context growth"〔一手，sessions.md〕。
- 多人共享的会话里，系统提示**不写**某个人的名字（每轮都变，会打掉前缀缓存），改为每条用户消息前加 `[sender name]`〔一手，session.py 第 429–434 行注释〕。
- 多个 profile（人设）服务同一个聊天时，会话键的命名空间是 `agent:<profile>`，"so two profiles serving the same chat never collide"〔一手，session.py `_session_key_namespace`〕。
- 网关对话不会因为闲置或跨天自动重置，旧的 `session_reset` 配置被核心忽略，要定时重置得装插件〔一手，sessions.md；[messaging 文档](https://hermes-agent.nousresearch.com/docs/user-guide/messaging)〕。
- 官网宣传 "cross-platform conversation continuity"〔二手，[hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/)〕；代码层面的会话是按聊天分的，跨平台只有 `/handoff <platform>` 把 CLI 会话整段转到某平台 home 频道的新线程（同一个 session id）〔一手，sessions.md "Cross-Platform Handoff"〕。

**Letta（补新）**
- "One agent can have many conversations, and every conversation uses the same agent identity and long-term memory"；什么时候开新对话"There is no correct answer. Many users tend to have a single, very long main thread"〔一手，[concepts/conversations](https://docs.letta.com/concepts/conversations/index.md)〕。
- Discord 渠道："Each DM gets a 1:1 mapping to a conversation. Routes are auto-created"；"Each mention creates a new conversation for the agent. The agent replies in-thread"〔一手，[self-hosting/channels/discord](https://docs.letta.com/self-hosting/channels/discord/index.md)〕。Telegram 整体绑到一个 conversation（默认 `default`）〔一手，[channels/telegram](https://docs.letta.com/self-hosting/channels/telegram/index.md)〕。
- 组织共享的 agent："Conversations are private to the collaborator who created them by default … Sharing an agent … does not make your existing conversations visible to them"〔一手，[teams/permissions](https://docs.letta.com/teams/permissions/index.md)〕。

**AstrBot（新）**
- 会话标识 UMO = `平台:消息类型:session_id`。群聊默认整群一个会话；`platform_settings.unique_session`（界面名"隔离对话"）默认 `False`，打开后"支持隔离的渠道会为每位群成员使用独立上下文"〔一手，[astrbot/core/event_bus.py](https://github.com/AstrBotDevs/AstrBot/blob/4f60422f9ca15b7e1ebb9d22b2ac289eae782f8e/astrbot/core/event_bus.py) 第 105–128 行、`config/default.py` 第 94、4418–4421 行〕。
- "会话"和"对话"是两层：一个会话（如某个群）下可以建多个对话并切换〔一手，`astrbot/core/conversation_mgr.py` 文件头〕。UMO 可以按通配路由到不同的配置文件（`umop_config_router.py`），自定义规则还能"对这个会话强制使用指定人格"〔一手，`docs/zh/use/custom-rules.md`〕。

**麦麦（补 1.3.16 之后的新内容）**
- 1.3.17–1.3.19 没有改会话划分。新增的有：1.3.19 支持"保存多套全局备选人设……手动切换，配置保存后热重载"，插件 SDK 可以查询和持久切换当前人设；1.3.18 注意力漂移分群聊、私聊两个开关〔一手，[changelogs/changelog.md](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/changelogs/changelog.md)〕。
- A_Memorix 的 `global_memory_sharing_enabled` 默认仍是 `False`（`official_configs.py` 第 3909 行）；Focus 共享组默认为空列表（第 1167 行）〔一手〕。

**AIRI（复核）**
- ADR `2026-10-10-skills-automations-and-memory` 仍是 Accepted："AIRI keeps one main conversation agent per persona"；"An external scene, for example a Discord channel, names a binding. The host keeps one persistent session for each binding"〔一手，[ADR](https://github.com/moeru-ai/airi/blob/7ab1ecae4bde4e6973e324198374580aa796a794/docs/ai/adr/2026-10-10-skills-automations-and-memory.md) 第 12、72 行〕。

### Inferences
- 〔推理〕灵鲸 V1（只有主人）的总会话就是 OpenClaw `dmScope: main` 的个人形态，后者正是官方推荐的单人默认，所以 V1 有现成先例。V2 一接家人私聊，在 OpenClaw 的规则下就属于"多个私聊发送者共享 main"，审计会报警。OpenClaw 自己为此把新装默认改成了隔离。
- 〔推理〕"主人的地方进主会话、别人的地方各自一个会话、主会话旁观它们的合并通知"是 OpenClaw 已经产品化的形态（DM 隔离 + `groupScope: per-group` + ambient watching），和灵鲸 §2.6 的回退方案几乎一样。这说明回退方案不是退路，而是业内的默认。
- 〔推理〕没有任何一家把"妈妈的私聊"和"主人的私聊"放进同一个模型会话还把它当推荐配置。Hermes 连群内的不同人都默认分开，理由是上下文污染和成本，不只是隐私。

### Gaps
- OpenClaw 2026.10 的 CLI 引导是否仍把 dmScope 写成 `per-channel-peer`（引导文档没提）。
- Hermes 的完整 clone 被并行任务占用、处于损坏状态，只读了 raw 单文件，没核对 tag 与 HEAD 的差异。

## Q2 跨地方、跨受众的隐私：各家怎么做，有哪些已知泄露

### Takeaway
各家的隐私做法分三档：① 结构上分会话（OpenClaw 隔离档、Hermes、AstrBot 隔离档、Letta 按对话）；② 共享一个决策上下文，但出口和召回由代码裁剪（OpenClaw 的跨对话召回排除群、麦麦 Replyer 只看目标聊天、eliza 的受众准入）；③ 只靠提示词（麦麦 Focus 的"不要把个人隐私透露到其他聊天"）。共同的漏洞在**记忆**：Letta、Hermes、Nomi、Kindroid 的长期记忆都按角色全局共享，A 处学到的事会在下次会话出现在 B 处。eliza 连自己的上下文装配路径都还没接上受众准入。公开的泄露事故只找到 OpenClaw 生态里一个第三方 skill 的"认不出群就加载私聊记忆"（fail-open）。

### Cited Findings

**OpenClaw**
- 安全审计的定位原文："Warns when multiple DM senders share the main session and recommends secure DM mode … This is cooperative/shared-inbox hardening, not isolation for mutually untrusted operators; split trust boundaries with separate gateways (or separate OS users/hosts)"；另有 `security.trust_model.multi_user_heuristic`："OpenClaw's default trust model is personal-assistant (one operator), not hostile multi-tenant isolation"，以及 `cross_agent_session_access_default`〔一手，[cli/security.md](https://docs.openclaw.ai/cli/security.md)〕。
- **跨对话召回** `rememberAcrossConversations`（v2026.8.1，#110597）〔一手，[reference/memory-config.md](https://docs.openclaw.ai/reference/memory-config.md)、[CHANGELOG/2026.8.1](https://raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG/2026.8.1.md) 第 26 行〕：
  - 默认值："On for personal installs; off with configured DM isolation"。
  - 边界："only the same agent's recognized private conversations are eligible; the conversation being answered is excluded; **groups and channels are excluded as sources and destinations**; **unknown conversation kinds block recall**; sandboxed recall cannot use the special cross-conversation authorization"。
  - 执行方式："a bounded read-only retrieval pass; unavailable or timed-out retrieval does not block the reply"；不改变会话键、存储、投递路由和 `sessions_*` 工具的权限。
- 信息方向：群 → 主会话（以通知形式旁观）；召回不以群为目的地。即私聊内容不会经召回进入群里的回复〔一手，main-session.md + memory-config.md 合读；方向性的概括是〔推理〕〕。
- 2026.10.1 的安全项包括 "kept private runtime context out of replies and saved conversations"〔一手，[CHANGELOG/2026.10.1](https://raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG/2026.10.1.md) 第 38 行〕。
- **第三方 skill 的已知泄露**：ClawHub 上的 `apm-agent-progressive-memory` v1.6.1，审计（2026-09-16）标为 High："Fail-Open Group Detection Injects Private DM Memory into Group Sessions"。检测到群聊但找不到群名映射时，回退到私聊记忆加载器（`memory/main/*` 与每日笔记）注入群会话的启动上下文；未知会话键也默认按私聊处理；代码注释自己写着"private memory may leak into group chat"〔二手，[ClawHub 审计页](https://clawhub.ai/biociao/skills/apm-agent-progressive-memory/security-audit)，我没读 skill 源码〕。

**麦麦**
- Focus 共享组提示词（一个 Planner 看多个聊天）：第 11 行"可以关联其他聊天的信息进行思考，但不要把个人隐私透露到其他聊天"；第 16 行"回复器只看到目标聊天历史和这段指导；需要引用跨聊天信息时，把必要且可公开的事实明确写入指导"〔一手，[prompts/zh-CN/maisaka_chat_focus.prompt](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/prompts/zh-CN/maisaka_chat_focus.prompt)〕。旧笔记已有，此处只复核仍存在。
- 1.3.16 文件功能："麦麦只能访问当前聊天的文件"〔一手，changelog〕。
- 公开渠道没找到麦麦跨群泄露的 issue 或报告；官方 FAQ 只说数据存在本地，隐私政策说第三方插件的数据处理不在其控制范围〔二手，搜索 [docs.mai-mai.org FAQ](https://docs.mai-mai.org/en/manual/faq/)、[PRIVACY](https://docs.mai-mai.org/en/about/PRIVACY)〕。

**elizaOS（补新）**
- `DisclosureGate` 挂在 Action 上，两种形态：`{ require: "owner_exclusive" }` 或 `{ require: "audience_admission"; subject }`；Action 还要声明 `egress`（可能向哪些外部目的地发数据），装了宿主处理策略时，没声明的 Action 在 handler 运行前就被拒绝〔一手，[packages/core/src/types/components.ts](https://github.com/elizaOS/eliza/blob/b2dbeff3ab689a69f7e518deb7d608d1c4607790/packages/core/src/types/components.ts) 第 377–379、634–643 行〕。
- **Provider（往提示词里拼上下文的组件）只允许 `owner_exclusive`**，注释原文："every provider enforcement site in `runtime.ts` tests `require === "owner_exclusive"` literally, so a provider declaring `audience_admission` would compose into the prompt with NO enforcement at all. Widen this only in the same change that wires the provider path"〔一手，同文件第 920–926 行〕。也就是说，受众准入目前只管动作，不管上下文装配。
- 准入算法："Computes audience disclosure as the minimum admitted level across non-agent members. Callers must first verify audience freshness and binding. Missing, malformed, or empty evidence and resolver failures grant nothing"〔一手，`packages/core/src/access-control/audience-disclosure.ts` 文件头〕。共享时会记下房间成员快照 `ArtifactRoomSnapshot{roomId, entityIds, atMs}`〔一手，`types/memory.ts`〕。
- 公开渠道没找到 eliza 跨房间泄露的事故；有记录的是"写入型"攻击：普林斯顿研究者通过篡改记忆，让 eliza agent 在主网执行了真实转账〔二手，[Decrypt 2025-05](https://decrypt.co/318200/elizaos-vulnerability-ai-gaslit-losing-millions)〕。

**AIRI**
- ADR 的未解问题至今未关："Scene privacy: chat output reaches every connected module, and a scene prompt reads every shared context"〔一手，ADR 2026-10-10 第 94 行，`7ab1eca`〕。
- 声纹 ADR（2026-10-15）的做法值得注意：说话人证据**不进提示词**，"The cosine has no calibrated threshold yet, and the model can read a low score as another person. The speaker gates decide what the model receives"〔一手，[2026-10-15-speaker-evidence.md](https://github.com/moeru-ai/airi/blob/7ab1ecae4bde4e6973e324198374580aa796a794/docs/ai/adr/2026-10-15-speaker-evidence.md)〕。"谁在说话"由代码闸门判，不交给模型。

**Hermes**
- `privacy.redact_pii: true` 在支持的平台上把模型可见上下文里的标识符换成哈希，原始 ID 只在内部用于路由；`/sessions all` 只有管理员能用，普通用户只看到自己聊天来源的会话〔一手，[messaging 文档](https://hermes-agent.nousresearch.com/docs/user-guide/messaging)〕。
- 记忆 `MEMORY.md` / `USER.md` 按 profile 一份，"injected into the system prompt as a frozen snapshot at session start"〔一手，[features/memory.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/memory.md) 第 20、57 行〕。文档没写群内按人隔离记忆。

**Letta**
- 记忆归 agent："Long-term knowledge belongs to the agent's MemFS memory, not one conversation. Durable lessons saved there remain available across conversations"〔一手，concepts/conversations〕。渠道文档和 letta-code `src/channels/README.md` 只讲准入（`dm_policy`、`group_policy`、`admin_users`），没有跨对话隐私的说明〔一手，`3b7e3ff`〕。

**AstrBot**
- 默认整群一个会话，即群里所有人共享上下文；隔离要开 `unique_session`〔一手，见 Q1〕。
- 定时任务的权限按会话限定："群聊中的所有成员都可以查询本群会话的全部任务……普通成员只能修改和删除自己在本群创建的任务……以上权限均限定在当前会话，不能跨群管理"〔一手，[docs/zh/use/proactive-agent.md](https://github.com/AstrBotDevs/AstrBot/blob/4f60422f9ca15b7e1ebb9d22b2ac289eae782f8e/docs/zh/use/proactive-agent.md)〕。

**陪伴产品**
- **Kindroid**（官方帮助中心）：群里的"Share Short Term Memory"默认关闭，"groupchats are siloed off from individual chats"；但群聊历史默认会整理进每个参与者的长期记忆；每个群有 Memory Formation、Update Individual Learned Context、Memory Recall、Share Short Term Memory 四个开关；打开共享后，Kin 也只在被明确问到时才回忆群里的内容〔一手，[Kindroid Groupchats](https://kindroid.ai/v2/docs/groupchats/)；旧版帮助文章说群的长期记忆形成不可关，与新版冲突，以新版为准〕。
- **Nomi**：长期记忆全局共享，"they will remember things you say in your group chat in your private conversations and vice-versa"；心智图（mind map）条目在群聊和单聊之间互不可见；"backchanneling"默认关闭，打开后群聊与该 Nomi 的私聊实时互通最近约 10 条，**群与群之间不互通**；FAQ 建议想要自成一体的故事就别开〔二手，r/NomiAI 社区 wiki 经搜索摘要，[镜像页](https://axebps-redlib.hf.space/r/NomiAI/wiki/index/faqs/group-chat) 我抓取失败〕。
- **SillyTavern**："Group chat history is shared among all members in every mode"〔一手，[官方文档](https://docs.sillytavern.app/usage/core-concepts/groupchats/)〕。

### Inferences
- 〔推理〕OpenClaw 的跨对话召回规则可以几乎原样作为灵鲸总会话"每轮前缀按受众裁"的判定规则：只从主人认可的私密地方召回，当前回答的地方除外，群永远不作来源也不作去处，认不出种类就拒绝。认不出就拒绝（fail-closed）恰好是 ClawHub 那个泄露的反面。
- 〔推理〕eliza 给灵鲸一个警示：它花大力气做了受众准入，最难的部分（上下文装配）却还没接上，provider 注释明说"NO enforcement"。灵鲸 §2.6 的"出口校验 + 前缀裁剪"里，前缀裁剪才是主要防线，出口的"用到的记忆号"校验只能抓住模型老实上报的那部分。
- 〔推理〕记忆是被普遍低估的泄露通道：Letta 和 Hermes 都在"会话开始时冻结记忆快照"，所以 A 处写入的事实，下次换新后会出现在所有地方的系统提示里。灵鲸的 `inner` 写入必须带来源地方与受众，前缀渲染时按受众过滤，否则夜里换新就把妈妈私聊里的事带进主人的总会话前缀，或者反过来。
- 〔推理〕Kindroid 与 Nomi 的默认值都是"短期隔离，长期合流"，这说明陪伴产品的用户更在意"她记得我"，不太在意隔离。但这两家都是一对一产品，不涉及"别人"的隐私。灵鲸 V2 有家人，不能照搬"长期合流"。

### Gaps
- 没找到任何产品公开的跨地方泄露率实测；只有学术基准（ConfAIde、MuPPET，见灵鲸 `structure-validation` §0）。
- PETS 2026（popets-2026-0016）研究群聊里人们怎么看待聊天机器人的隐私，正文 PDF 解码失败，没读到结论。
- Character.AI 群聊的记忆隔离规则没找到官方说明。

## Q3 主动开口：谁决定、怎么决定

### Takeaway
各家都把"要不要醒"交给代码（定时、通知合批、门控），把"醒了说不说"交给模型，并明确允许安静收场（NO_REPLY、"没有必要就别发"）。OpenClaw 把各种动静都汇到主会话，平时不叫醒，下一次醒来时一起看；AstrBot 和 Hermes 把定时结果送回发起的会话，并写死"别寒暄、别无事找事"的提示。群聊的轮流发言用"每轮上限 + 把话轮交回用户"来控。

### Cited Findings
- **OpenClaw**：
  - 主会话汇集新会话通知、群动态、子任务回报，"Home sees it on its next turn or scheduled heartbeat; creation does not trigger an extra wake-up"；群动态"coalesced per conversation, never one wake-up per message"〔一手，main-session.md〕。
  - 子任务完成后的回合可以安静收场："A requester completion turn may finish with `NO_REPLY` or no visible text. That settles the child's completion without a retry, an extra model turn, or a blocked delivery notice"〔一手，[tools/subagents/announce.md](https://docs.openclaw.ai/tools/subagents/announce.md)〕。
  - heartbeat 在 v2026.8.1 并入普通 automation，旧笔记已有。
- **AstrBot**：
  - 主动能力（v4.14.0 引入，仍是实验性）给模型一个 `future_task` 工具，在聊天里创建一次性或循环任务。到点由 `wake_main_agent` "Queue a triggered user turn without waiting for agent execution"，用目标 UMO 当前对话作为上下文，并标明触发来源（cron、后台任务、插件）〔一手，[astrbot/core/astr_agent_wakeup.py](https://github.com/AstrBotDevs/AstrBot/blob/4f60422f9ca15b7e1ebb9d22b2ac289eae782f8e/astrbot/core/astr_agent_wakeup.py)、proactive-agent.md〕。
  - 后台任务结果唤醒主 agent 时的固定提示："Use the existing conversation to decide what to do next. Do not greet the user, ask unnecessary questions, or send a message if no meaningful action is required. If contacting the user, explain why and refer to the task naturally"〔一手，`astrbot/core/astr_main_agent_resources.py` 第 117–125 行〕。
  - 文档的告诫："任务需求中应写明必要信息，不要只写'按刚才说的做'"；一次性任务"执行失败也会删除"；不保证补发停机期间错过的提醒〔一手，proactive-agent.md〕。
- **Hermes**：cron 每 60 秒检查一次；最终回复经 `state.db` 的持久投递台账，24 小时内最多重投 3 次；`/sethome` 设 home 频道接收重启通知和断路器通知；`allow_silence: true` 允许某个房间里只回标记、不出声〔一手，messaging 文档〕。后台委派的结果"posts the result back as a new message"〔一手，[features/delegation.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/delegation.md) 第 11 行〕。
- **麦麦**：后台子代理的结论"作为一条新的 user 消息追加到上下文末尾并唤醒 Planner"〔一手，[src/maisaka/subagent_tasks.py](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/src/maisaka/subagent_tasks.py) 文件头〕。动态门控和 wait/stop 见旧笔记。
- **群聊轮流**：
  - Kindroid 自动模式："up to one per Kin in the group and at most 5 per round"，AI 可以提前把话轮交回用户；手动模式"no one replies until you pick a Kindroid"〔一手，Kindroid Groupchats〕。一位用户认为"automatic is terrible at deciding who gets to talk"〔二手，Reddit 快照，单人观点〕。
  - SillyTavern：Natural Order = 名字提及 → talkativeness（0–100%，新角色默认 50%）→ 随机；Pooled Order 优先选"自上条用户消息后还没说过话"的角色；自动模式在最后一位发言后等 5 秒再开下一轮，用户一打字就关掉自动模式〔一手，SillyTavern 文档〕。
  - Nomi 的自动群聊"intelligently decide who should talk next"，机制未公开〔二手〕。

### Inferences
- 〔推理〕AstrBot 那段固定提示和灵鲸 §2.4 的"说 / 留心事 / 不说"三选一是同一个思路，可以直接借它的措辞作为"活的汇报回到总会话"那类回合的提示：不寒暄；要说就说明为什么、自然地提到那件事。
- 〔推理〕OpenClaw 的"新会话、群动态只排通知、不叫醒"对应灵鲸 §2.5 的 `inject`。两边一致，说明低显著事件不起回合是业内共识。
- 〔推理〕灵鲸 V3 内部群有多个成员的总会话。Kindroid 的"每人每轮最多一次、全组每轮 ≤5、可以提前交还话轮"可以直接作为内部群的代码闸。

### Gaps
- 没有找到任何一家对"主动开口被用户接受的比例"的公开实测。

## Q4 长活与深想怎么派出去，同时保持人设、不挡对话

### Takeaway
2025–2026 各家收敛到同一个形状：子 agent 从空白上下文开始，只拿到父 agent 写的任务说明；没有发言、等待、写记忆、再派活的工具；在后台跑，结果在父 agent 的两个回合之间作为一条新消息回来；父 agent 应结束本回合而不是轮询，并用自己的口吻转述。**几乎没有人把主角色的人设带进子 agent**：Hermes 明确排除 `SOUL.md`，麦麦子代理的系统提示里没有人格，OpenClaw 的子会话不加载 SOUL.md。AstrBot 给每个子代理配一个"人格"，但那是角色化的工具人格，不是主角色本人。

### Cited Findings
- **麦麦 subagent**（`c642954`）〔一手，[src/maisaka/builtin_tool/subagent.py](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/src/maisaka/builtin_tool/subagent.py)、`subagent_tasks.py`〕：
  - 文件头："子代理在独立上下文里运行，看不到当前聊天，只拿到 Planner 写的任务说明和被授权的工具……最后只把结论交还给 Planner，中间过程不进入 Planner 上下文"。
  - 工具说明："子代理看不到当前聊天，也不能发言：发言、等待和群管理操作必须由你自己完成"；"只需要一次简单查询时直接调用对应工具即可"。
  - 禁用清单 `SUBAGENT_FORBIDDEN_TOOL_NAMES`：subagent 三件套、`react_message`、`reply`、`send_emoji`、`show_emoji_list`、`tool_search`、`wait`；另外"明确标注为破坏性的工具不交给看不到聊天上下文的子代理"（`annotation.destructive`）。
  - 两种模式：同步（默认）最多 5 轮，Planner 等结论；`capabilities.advanced_sub_agent`（默认 `False`）开启后转后台，立刻返回任务 id，最多 20 轮，"同一会话里同时运行的后台子代理上限" 3 个，结论以 `<subagent_result>` 消息送回并唤醒 Planner，另有 `subagent_status` / `subagent_stop`。
  - 子代理的系统提示没有人格："你是一个被派发任务的子代理……任务说明就是你知道的全部背景……你不能向任何人发言，也不能把任务再派发出去。结论控制在 800 字以内"；要求 id、链接、路径、版本号原样保留。
- **Hermes `delegate_task`**〔一手，features/delegation.md〕：
  - "Top-level model calls run in the background automatically. Hermes returns a handle immediately so the conversation can continue, then posts the result back as a new message"（第 11 行）。
  - "Results are delivered only between the parent's turns: the parent should finish anything that does not depend on the children, then end its turn rather than polling"（第 186 行）。
  - "Subagents Know Nothing … only context comes from the `goal` and `context` fields"；工作区的项目上下文文件会带上，但"**SOUL.md is excluded**"（第 80–86 行）。例外：`profile_routes` 让子 agent 以某个 profile 运行，用那个 profile 的模型、凭据、技能和 `SOUL.md`（第 300、337 行）。
  - 子 agent 禁用：`delegate_task`（叶子节点）、`clarify`（"subagents cannot interact with the user"）、`memory`（"no writes to shared persistent memory"）；工具集继承自父 agent，模型不能给子 agent 额外授权（第 377–382 行）。二手资料还列了 `send_message`、`execute_code`〔二手，[架构整理](https://yoniebans.github.io/hermes-architecture/)〕。
  - 并发默认 10；卡死检测：轮次之间 450 秒无动静、工具内 1200 秒无动静就中断，并放弃等待；后续消息和普通停止**不会**取消后台批次，`/stop` 或重置会话才会（第 211–215、404 行）。
  - 主会话忙时的新消息：`busy_input_mode` = `interrupt`（默认）/ `queue` / `steer`；`interrupt` 时正在跑的前台终端命令转后台而不是被杀〔一手，messaging 文档〕。`/bg <prompt>` 开一个独立会话的后台 agent，"has no knowledge of your current chat context"〔一手，同上〕。
- **OpenClaw**〔一手，[tools/subagents.md](https://docs.openclaw.ai/tools/subagents.md)、announce.md〕：
  - 目标之一："Keep the tool surface hard to misuse: sub-agents do **not** get session or message tools by default"；成本建议：子 agent 用便宜模型，主 agent 用好模型（`agents.defaults.subagents.model`）。
  - 回报："Internal metadata is meant for orchestration only; user-facing replies should be rewritten in normal assistant voice"。
  - 子任务必须给出有意义的结果或具体阻碍，子 agent 回 `NO_REPLY` 或无输出会触发缺答恢复。
  - "Completion follow-up turns retain the requester's authority"；"The requester turn's captured origin owns completion routing"。
  - 只有用户要求单独会话或需要回头 steer 时才开可见的持久会话："A PR or report, a long run, or an isolated worktree alone does not make a worker a separate user-facing task"。
  - 派生出来的会话不加载 SOUL.md 和 IDENTITY.md，只注入 AGENTS.md，所以团队规则只能写进 AGENTS.md〔一手，转引旧笔记 `2026-10-28-openclaw-architecture.md` Q3 与"照搬"表，本次未重读〕。
- **AstrBot SubAgent**（v4.14.0 引入，实验性）〔一手，[docs.astrbot.app/use/subagent.html](https://docs.astrbot.app/use/subagent.html)、`astrbot/core/agent/handoff.py`、`astr_agent_tool_exec.py`〕：
  - 主 agent 多出 `transfer_to_<name>` 工具，自己的工具也保留（可选"去重"，把子代理已有的工具从主 agent 隐藏）。
  - 每个子代理**必须**绑定一个人格（人格 = 提示词 + 工具范围），可另选模型。
  - 交接工具参数 `background_task`："Set to true if the task may take noticeable time, involves external tools, or the user does not need to wait"；后台时先回 "Background task submitted. task_id=…"，结束后用 Q3 那段 system_reminder 唤醒主 agent。
  - 已知限制："子代理的执行历史不会作为独立会话长期保存"；不支持多层嵌套；"不是独立容器或权限边界"。
- **elizaOS plugin-agent-orchestrator**〔一手，[plugins/plugin-agent-orchestrator/src](https://github.com/elizaOS/eliza/tree/b2dbeff3ab689a69f7e518deb7d608d1c4607790/plugins/plugin-agent-orchestrator/src)〕：
  - 子 agent 经 ACP 拉起（默认原生传输，`ELIZA_ACP_DEFAULT_AGENT` 可设为 codex 等）。
  - 完成后以 `MESSAGE_SOURCE_SUB_AGENT` 的"synthetic memory"回到房间；evaluator 决定"relay the sub-agent's answer directly to the user, or step aside for a concrete planner follow-up"；结果被截断（`length` / `content_filter`）时明确拒收而不是重新派生，"that is the guard against the weak-model re-spawn loop (elizaOS/eliza#8875)"；任务还在验证中时，转述带"待验证"标注，"so the user never reads an unverified claim as a final result"（`evaluators/sub-agent-completion.ts` 文件头）。
  - 房间里有人说话时，按参与者分别判 INTERRUPT / QUEUE / DELIVER / IGNORE，"Bias: a working sub-agent keeps working. We only INTERRUPT on an explicit stop/redirect"（`services/interruption-decider.ts` 文件头）。

### Inferences
- 〔推理〕灵鲸 §2.3 的 R2（没有工具就只能派）、R4（不能挡住对话、结果以事件回来）和麦麦、Hermes、OpenClaw 完全同构，有充分先例。Hermes 的"结束本回合，不要轮询"与 Super-agent 原型的"never wait … end the turn"是同一条规则。
- 〔推理〕灵鲸让第三层的活带她的人设（决策 5），这在同类里是少数派：Hermes 是刻意排除 SOUL.md，麦麦和 OpenClaw 也不带。代价是人设和任务指令争上下文、要额外的身份探针；好处是活的经历可以作为"她做的事"回流。这个取舍应当在文档里写明是**有意偏离业内做法**，理由是"活也是她"。
- 〔推理〕OpenClaw 的"面向用户的回复要用助手的正常口吻重写"、eliza 的"未验证就标待验证"可以并进灵鲸 R3（统一回复）：活的汇报原文不直接投递，总会话用自己的口吻转述；`tasks` 核验没过时，转述必须带"还没确认"。
- 〔推理〕麦麦"破坏性工具不交给看不到聊天的子代理"、Hermes"模型不能给子 agent 额外授权"，对应灵鲸"工具档由代码按活的种类给"，方向一致。

### Gaps
- Hermes 没有公开数据说明后台委派对主会话响应延迟的影响。
- AstrBot 后台交接的结果怎样措辞（是否带人格）取决于主 agent 的人格提示，代码里没有专门的转述规则，没做实测。

## Q5 多人设与人设之间的关系

### Takeaway
多人设有两种做法：一是"多个独立的 agent / profile，各有一套记忆和会话命名空间"（OpenClaw agent、Hermes profile、eliza 一个角色一个 runtime）；二是"一个群聊里多个角色轮流说话"（Kindroid、Nomi、SillyTavern、Character.AI）。后一类普遍**不让角色看彼此的设定**（Kindroid 明说是长度原因），关系写进群的公共设定；群历史对所有成员共享，长期记忆各记各的。麦麦的"多套人设"只是同一个机器人切换，不是并存。

### Cited Findings
- **Hermes profiles**："Memory is scoped per profile by design — give a second agent its own profile, and if they need shared memory, use an external memory provider"；"Don't point two agent processes at the same Hermes home directory … two writers sharing one home will compound each other's entries into state neither of them (nor you) authored"〔一手，features/memory.md 第 23 行〕；会话键命名空间按 profile 隔开〔一手，session.py〕。
- **麦麦** 1.3.19："支持保存多套全局备选人设、重命名、删除与手动切换"，同一时刻只有一套生效〔一手，changelog〕。
- **AstrBot**：人设按配置文件给默认值，可以按对话选，也可以按 UMO 用自定义规则强制；每个子代理绑一个人设〔一手，`persona_mgr.resolve_selected_persona`、custom-rules.md、subagent 文档〕。
- **Kindroid**〔一手，Kindroid Groupchats〕：
  - "Each Kindroid will be able to access its own backstory and memories, but not each other's"。
  - 共同背景写进 group context："use the group context to provide a group backstory that all the Kindroids can use for common context"；角色彼此不知道对方的设定，"due to length considerations"。
  - 每群最多 10 个 Kin；每群有自己的日记（group journal）。
- **Nomi**：每个群聊有一份 shared note，社区 FAQ 建议在里面写清群的目的和每个 Nomi 的角色；shared note 始终可见〔二手，社区 wiki 搜索摘要〕。
- **SillyTavern**：默认"Swap character cards"，只把当前发言者的角色卡放进上下文；"Join character cards"把所有成员的卡合成一份提示，文档警告会造成"confusion, merged personalities, and uncertain traits"；群可以用 Scenario Override 统一场景〔一手，SillyTavern 文档〕。
- **Character.AI**：群聊先对 c.ai+ 订阅者开放，最初只在移动端，可以全是 AI 角色，也可以人与 AI 混合；轮流机制与记忆规则未公开〔二手，[TechCrunch](https://techcrunch.com/?p=2613433)、[Yahoo 转载](https://sg.news.yahoo.com/character-ai-introduces-group-chats-202445269.html)〕。
- **Neuro-sama / Evil Neuro**：Evil Neuro 2023 年 3 月作为独立人格出现，Wikipedia 说它有不同的模型、声音与人格；它到底是单独微调还是提示词变体，社区没有定论；技术架构未公开〔二手，[Wikipedia](https://en.wikipedia.org/wiki/Neuro-sama)、[整理页（2026-04-27）](https://lin-guanguo.github.io/llm-memory-research/neuro-sama.research/)〕。游戏经公开的 Neuro SDK 接入：游戏注册动作（名称、描述、JSON schema）、发纯文本上下文、用"force"要求她从限定动作里选，游戏端负责校验和执行〔二手，同一整理页转述 VedalAI/neuro-sdk；规范原文我抓取被代理拒绝〕。
- eliza 的 `plugin-relationships`、AIRI 的"角色是聊天成员"、Letta 的 `SendAgentMessage` 与共享记忆仓库，旧笔记已有，没有新变化需要补。

### Inferences
- 〔推理〕灵鲸 §2.9 的"关系的定义唯一归 people（主人设），感受唯一归各自 memory"，比陪伴产品的"关系写进群公共设定"更结构化，方向没问题。Kindroid 证明"角色不看彼此设定"在产品上可以接受。
- 〔推理〕Neuro SDK 的"游戏只能注册动作和发上下文，她只能从注册的动作里选，游戏校验执行"，就是灵鲸"代码摆桌子、她选、代码执行"的又一个实例，而且是在直播这种高频场景里跑通的（二手）。
- 〔推理〕SillyTavern 文档对"合并角色卡"的警告，佐证了灵鲸"每个成员一个总会话"而不是"一个会话扮演多个成员"。

### Gaps
- 没有找到哪个产品公开"多个常驻角色各有一个常驻会话、彼此用消息交流"的实测数据（eliza、AIRI 有设计，没有运行数据）。
- Nomi 官方帮助中心原文没抓到。

## Q6 有记录的问题与实测

### Takeaway
最有价值的一手证据是 OpenClaw 自 2026.1 起围绕 `dmScope` 的一连串修复：共享 main 会话本身没被报过"泄露"，问题集中在**模式切换后的投递路由**（重复投递、投递上下文被污染、完成结果滞留在孤立队列）。其余是 eliza 的弱模型重复派生循环、Hermes 的后台子 agent 卡死和长会话成本。没有任何一家公开跨地方泄露率。

### Cited Findings
- **OpenClaw dmScope 时间线**〔一手，分版本 CHANGELOG，URL 形如 `https://raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG/<版本>.md`〕：
  - 2026.1.15 加入 `dmScope` 和审计警告（#948）。
  - 2026.1.23 外发消息镜像进目标会话键（threads + dmScope）（#1520）。
  - 2026.2.13 审计和引导给出明确的修复命令（#13129）。
  - 2026.2.22 BREAKING：引导默认 `per-channel-peer`（#23468）。
  - 2026.2.27 切到非 main 后，旧 `agent:*:main` 的投递路由元数据残留，导致 Telegram 私聊重复回报（#31010）。
  - 2026.3.7 `dmScope=main` 下跨入口重复回复（#33629 等）。
  - 2026.5.12 新增 `openclaw sessions cleanup --fix-dm-scope`，供改回 main 的用户清理残留的私聊会话行（修 #47561、#45554）；webchat 的 `/new` 在 main 下原地重置，不再开平行子会话（#77434）。
  - 2026.5.19 "keep direct-message last-route writes on isolated `per-channel-peer` sessions instead of contaminating the agent main session with channel delivery context"（修 #36614）。
  - 2026.5.22 单一使用者 `dmScope=main` 下，exec 与 cron 的异步完成"no longer strand context in orphan direct-DM queues"（修 #71581）。
  - 2026.6.9 斜杠命令路由没读到 dmScope（#39605）；`dmScope=main` 下 webchat 回复渲染两次（#93044）。
  - 2026.8.1 个人安装默认开启跨对话召回（#110597）。
- **ClawHub skill 的私聊记忆进群**（2026-09-16 审计，High），见 Q2〔二手〕。
- **eliza #8875**：弱模型拿到不完整的子任务结果后反复重新派生，现在的对策是明确拒收、不重派〔一手，sub-agent-completion.ts 注释〕。
- **Hermes**：后台子 agent 卡死曾长期占住会话租约，现在用 450 / 1200 秒的停滞检测关掉了这个失败模式〔一手，delegation.md 第 404、470 行〕。长会话："If you never reset, a chat can run for weeks as a single session: convenient, but it grows expensive … and the learning loop of forget → recall from memory → search past sessions almost never gets to fire"；建议在自然边界 `/new`〔一手，features/memory.md 第 63–65 行〕。
- **麦麦** 1.3.15 的记忆修复与灵鲸的认人问题相关：人物写回按用户 ID 去重，"按用户 ID 持久映射昵称和历史称呼，避免同名或改名导致身份混淆"；"指定人物查询通过持久称呼映射解析目标，避免私聊对象的 ID 覆盖查询人物，同名称不能唯一确定时停止检索"；普通与 Focus 模式"连续等待后不再强制结束对话"〔一手，changelog 1.3.15〕。
- **Kindroid、Nomi 用户反馈**：自动轮流不好用、群聊记忆变弱、backchanneling 后私聊里只记得零星片段，均为个人观点〔二手，Reddit 快照〕。

### Inferences
- 〔推理〕OpenClaw 的事故说明：一旦同时支持"一个主会话"和"按地方分会话"两种模式，最容易坏的不是模型，而是**回复往哪送**。灵鲸草案让 `reply` 的目标只来自事件、模型指定不了，正好避开这一类问题；如果保留回退路径的代码，还要测"模式切换后旧路由元数据不残留"。
- 〔推理〕麦麦 1.3.15 "私聊对象的 ID 覆盖查询人物"的修复，是"当前地方的身份污染召回目标"一类的真实 bug，和灵鲸 V2 按受众召回同类，应进灵鲸的测试场景。

### Gaps
- OpenClaw 那些 issue 的正文（具体用户、是否造成内容泄露）没读，只读了 changelog 的一行描述（GitHub API 今天已限流）。

## Q7 对灵鲸第二层的启示

### Takeaway
证据支持灵鲸第二层的主体设计：总会话没有改世界的工具、结果以事件回来、不轮询、统一用她的口吻转述、低显著事件不叫醒，这几条都是业内共识。证据**不支持** V2 把家人私聊和群也并进同一个总会话：唯一这样做的 OpenClaw 自己声明只适合单人，并把新装默认改成了隔离；更常见、也被产品化的是"主人的地方一个主会话 + 别人的地方各自会话 + 主会话旁观合并通知 + 召回绝不进群"。建议把 §2.6 的回退方案提前为 V2 的默认，至少群从一开始就分会话（§10 第 9 条）。

### Cited Findings
- OpenClaw：单人默认 main，多发送者时审计建议隔离，并且明说这不是互不信任者之间的隔离〔一手，cli/security.md〕；新装默认已改为隔离〔一手，CHANGELOG 2026.2.22〕。
- OpenClaw 的混合形态：DM 隔离 + 群各自会话 + 主会话旁观 + 召回排除群〔一手，main-session.md、memory-config.md〕。
- Hermes 默认连群内不同的人都分开，理由是上下文污染与成本〔一手，sessions.md〕。
- 麦麦 Focus 是唯一"一个决策上下文看多个聊天"的现役实现，隐私靠"Replyer 只看目标聊天 + 指导里只写可公开的事实"，加一条提示词规则〔一手，maisaka_chat_focus.prompt〕；它是实验功能，默认不开〔一手，official_configs.py〕。
- 子 agent 的共识形状：空白上下文、没有发言和写记忆的工具、后台跑、回合之间回报、父 agent 用自己的口吻重写〔一手，麦麦、Hermes、OpenClaw、AstrBot，见 Q4〕。

### Inferences
1. **V2 的会话划分**〔推理〕：
   - 主人的所有地方（主控台、主人的 QQ / 微信私聊）进总会话，相当于 OpenClaw 的 `main` + `identityLinks`。
   - 每个非主人的地方开一个"在场"会话：结构同总会话，工具只有 reply / inner / recall，受众只含该地方。
   - 在场会话的动静以合并通知 `inject` 进总会话，只向上流；总会话要对别人主动说话，走 `say(地方)`，正文在那个地方的在场会话里生成，只带"可公开的指导"（麦麦 Replyer 模式）。
   - 这就是 `overall.md` §2.5 的原设计。证据显示它是主流，而不是保守的退路。
2. **召回规则直接借 OpenClaw**〔推理〕：
   - 只从主人认可的私密地方召回，当前地方除外。
   - 群永远不作来源，也不作去处。
   - 认不出地方的种类就不召回（fail-closed）。
   - 召回超时不挡回复。
   - 这几条能写成代码检查，替代 §2.6 里"每轮前缀按受众裁"的模糊表述。
3. **记忆写入带来源受众**〔推理〕：Letta 和 Hermes 的"会话开始时冻结记忆快照"说明，经记忆泄露发生在换新时，不在当轮。`inner` 的事实、印象必须带"在哪听到、谁能知道"，`context.forCreation` 重建前缀时按总会话的受众（V2 起为"主人"）过滤。
4. **eliza 的教训：前缀裁剪是主防线**〔推理〕。出口的"用到的记忆号"校验只能抓住模型如实上报的部分。V2 若坚持单会话，至少要像 eliza 的 Action 一样给 `say` / `reply` 加按受众的准入（受众里每个人都有资格才放行，证据缺失就拒绝），并测"上下文装配"这条路径。
5. **派活**〔推理〕：
   - 补两条规则：活的汇报不原样投递，由总会话用她的口吻转述（OpenClaw "rewritten in normal assistant voice"）；核验没过的转述必须带"还没确认"（eliza）。
   - 第三层带人设是刻意偏离业内做法（Hermes 排除 SOUL.md），文档里写明理由。
   - 借麦麦的两条限制：后台活每成员并发有上限；破坏性工具不给看不到对话的会话。
6. **主动开口**〔推理〕：可以借 AstrBot 的固定措辞，作为"活的结果回来"与"冲动过线"两类回合的提示："没有必要就别发；要发就说明为什么、自然提到那件事；别寒暄"。OpenClaw 的"完成回合可以安静收场、不重试"对应灵鲸 R10 的反面：系统发起的回合允许没有回复，主人发起的回合才要求必须回复或派活。
7. **换新**〔推理〕：Hermes 指出几周不换的会话既贵又让"忘 → 查记忆"的循环不触发，支持灵鲸"至少每天夜里换新"。OpenClaw 的 `resetByType` 可以借来让别人的地方用更短的闲置重置（对应 §2.6 第④条"按轮数换新"）。
8. **多成员**〔推理〕：内部群借 Kindroid 的代码闸（每成员每轮 ≤1 次、全组每轮有上限、可交还话轮）；成员彼此不读对方的设定，关系由 people 账本给出，与 Kindroid 的"group context"同理，但更结构化。

### Gaps
- 没有公开数据能量化"单会话 + 提示词规则"与"分会话"之间泄露率的差别；麦麦 Focus 是实验功能，没有公开的隐私评测。灵鲸路线图 4.4"多方历史零泄漏测试"仍然是唯一能给出答案的办法。
