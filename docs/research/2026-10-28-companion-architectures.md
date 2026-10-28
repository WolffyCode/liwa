# 调研：陪伴、角色类系统的整体架构（麦麦、Letta、AIRI、elizaOS）

日期：2026-10-28。阶段一第 3 步，补"灵魂"这一侧。标注：〔一手〕读到源码、仓库文档或 changelog 原文；〔二手〕搜索摘要或第三方文章；〔推测〕调研者判断；〔未核实〕没读到原文。

覆盖说明：

- 本机经代理访问 github.com 返回 502，`git clone` 不可用。源码改用 codeload 打包下载、jsDelivr 单文件、GitHub API 和 npm registry 获取，全部放在 `mktemp -d` 目录里只读，没有执行任何脚本。
- 四个项目在 2026 年都发生了大改，结论以**当前代码**为准，历史版本只用来解释"为什么改"：
  - **麦麦**：仓库已迁到 `Mai-with-u/MaiBot`（GPL-3.0，约 6.6k 星），主线 v1.3.16（2026-10-27）。核心已从"心流"换成 **Maisaka**（agent 式 Planner），`heart_flow` 只剩一层每聊天流的运行时管理器。
  - **Letta**：`letta-ai/letta` 的 main 已变成落地页，V1 Python 服务端退役，只在 `archive` 分支保留。当前实现是 `letta-ai/letta-code`（TypeScript，Apache-2.0）：一个**带记忆的 CLI agent 外壳**。按其仓库要求，V1 代码只做历史查阅，下文单独标注"历史"。
  - **AIRI**：`moeru-ai/airi`（MIT，约 5 万星），v0.12.0。大脑跑在前端渲染进程里。
  - **elizaOS**：`elizaOS/eliza`（MIT），default 分支 `develop` 已是 v2，定位是"agentic operating system"，约 3.4 万个文件；npm 稳定版仍是 1.7.2。经典的消息流程以 1.7.2 为准，身份和隐私模型以 v2 为准。
- 前两步已有的结论（OpenClaw 的 main session、队列四模式、heartbeat 退役；Paseo 的 AgentClient 契约、完成通知、journal 插入点等）不再重复，只在第 5 节合并比较。
- 路径约定：`MB/` 指麦麦 main，`MB@<tag>/` 指历史 tag；`LC/` 指 letta-code；`LV1/` 指 letta archive 分支；`AI/` 指 airi main；`EZ/` 指 eliza develop；`EZ1/` 指 npm 包 `@elizaos/plugin-bootstrap@1.7.2` 源码映射里的 `src/`。

## 1. 来源清单

| # | 来源 | 读了什么 | 类别 |
| --- | --- | --- | --- |
| M1 | 麦麦 main 打包（v1.3.16） | `AGENTS.md`、`bot.py`、`src/runtime.py`、`src/main.py` 全文；`src/chat/heart_flow/*` 全文；`src/maisaka/runtime.py`（约 1300 行）、`reasoning_engine.py` 主循环、`turn_trigger/*` 全部、`focus/manager.py` 全文、`focus/group_runtime.py` 前 520 行、`focus/tools.py` 与 `focus/context.py` 开头；`builtin_tool/reply.py`、`subagent.py` 开头；`chat/replyer/maisaka_generator_base.py` 大纲；`person_info/person_info.py` 前 200 行；`common/database/database_model.py` 相关表；`services/memory_flow_service.py` 大纲与关键段；`builtin_tool/query_memory.py`；`platform_io/types.py`、`drivers/base.py`、`legacy_driver.py`；`plugin_runtime/host/supervisor.py` 片段；`agent/service.py`、`planner.py`、`planner_state.py`、`acp.py` 前 120 行；`prompts/zh-CN/maisaka_chat*.prompt`、`maisaka_replyer.prompt`；`config/official_configs.py` 相关段 | 一手 |
| M2 | 麦麦历史 tag：0.5.15、0.6.0、0.6.3-fix4、0.8.1、0.11.6、0.12.3（0.7.0、0.9.0、0.10.3 只看目录） | 0.6.0 `heart_flow/heartflow.py`、`sub_heartflow.py`，`schedule_generator.py` 大纲；0.6.3 `heart_flow/*`（heartflow、mind、mai_state_manager、background_tasks、subheartflow_manager、interest_chatting 开头）与两份设计文档 `0.6Bing.md`、`heartFC_readme.md`、`heartFC_chatting_logic.md`；0.8.1 `sub_heartflow.py` 状态切换、`normal_chat.py` 切换条件、`willing/*`；0.11.6 `mood/mood_manager.py` 全文、`auto_talk_api.py`；0.12.3 `heart_flow/heartflow.py`、`frequency_control.py`、`dream/dream_agent.py` 提示词与调度、`DreamConfig`；0.6.3 与 0.8.1 的关系模块片段 | 一手 |
| M3 | 麦麦 changelog | main 的 `changelogs/changelog.md`（0.12.0 至 1.3.16 全文）；0.11.6 tag 的 changelog（0.5.15 至 0.11.6 全文） | 一手 |
| M4 | 麦麦 `docs/agent-connections.md`、`internal-chat.md`、`desktop-pet.md` | 全文 | 一手 |
| M5 | `Mai-with-u/maim_message`（打包） | README、`message_base.py` 结构 | 一手 |
| M6 | 麦麦 issue：按评论数排序前 40 条；正文 #282、#352、#803、#1238、#1280、#1710、#1854 | 摘要与正文 | 一手 |
| L1 | `letta-ai/letta` main | README、`AGENTS.md`（退役说明） | 一手 |
| L2 | `letta-ai/letta` archive 分支（历史 V1） | `groups/sleeptime_multi_agent_v4.py` 全文；`orm/blocks_agents.py`、`blocks_conversations.py`、`block.py`、`block_history.py`、`identity.py`、`group.py`、`conversation.py` 字段 | 一手（历史） |
| L3 | `letta-ai/letta-code` HEAD | README、`AGENTS.md`、`src/channels/README.md` 与 `AGENTS.md`、`src/websocket/listener/AGENTS.md`；技能 `maintaining-core-memory`、`managing-shared-memory`、`scheduling-tasks`、`letta-guide`；工具说明 `Wake`、`SendAgentMessage`、`MessageChannel`、`Task`；`subagents/builtin/reflection-v2.md`；`reflection-settings.ts`、`cli/helpers/memory-reminder.ts`、`post-turn-reflection.ts`、`reflection-launcher.ts`（grep）；`tools/impl/external-coding-agent.ts` 开头、`agent/parent-memory-note.ts`；`backend/local/paths.ts`、`local-conversation-record.ts`、`local-transcript.ts`（grep） | 一手 |
| L4 | Letta issue：两个仓库按评论排序；正文 letta-code #298、#417、#2666，letta #3270 | 摘要与正文 | 一手 |
| L5 | WebSearch"Letta V1 server retired" | 只有第三方博客说法 | 二手 |
| A1 | AIRI main 目录树（API） | 全树；README（架构 mermaid、路线图）、`AGENTS.md`、`DESIGN.md` 开头 | 一手 |
| A2 | `packages/core-agent/README.md` | 全文 | 一手 |
| A3 | `docs/ai/adr/2026-10-09-character-as-chat-member.md`、`2026-10-10-skills-automations-and-memory.md` | 全文 | 一手 |
| A4 | `packages/plugin-sdk/README.md`、`docs/design/architecture.md`；`packages/plugin-protocol/src/types/events.ts`（事件表与输入、上下文、spark 段）；`server-shared`、`server-runtime` README | 全文或相关段 | 一手 |
| A5 | `packages/stage-ui/src/stores/character/orchestrator/store.ts` 全文、`notebook.ts` 开头；`core-agent/src/agents/spark-notify/agent.ts`、`apps/stage-tamagotchi/src/main/services/airi/channel-server/index.ts`（grep） | 一手 |
| A6 | `integrations/discord-bot`、`satori-bot`、`telegram-bot` README；`plugins/airi-plugin-claude-code/src/cli.ts`；`services/computer-use-mcp/airi-cli-architecture.md` | 一手 |
| A7 | AIRI issue 按评论排序前 25 条；正文 #387、#520 | 一手 |
| E1 | eliza develop 目录树（API）；根 README、`packages/core/README.md`、`packages/agent/README.md` | 一手 |
| E2 | `packages/core/src/types/environment.ts` 全文；`identity.ts`、`membership.ts`、`memory.ts`、`task.ts` 前半；`access-control/memory-scope.ts`；`identity-clusters.ts` 前半；`services/trigger-scheduling.ts` 开头 | 一手 |
| E3 | `plugins/plugin-relationships`、`plugin-agent-orchestrator` README | 全文 | 一手 |
| E4 | npm `@elizaos/plugin-bootstrap@1.7.2` 源码映射：`src/index.ts`（`shouldRespond`）、`src/evaluators/reflection.ts`（`validate`）；`@elizaos/core@1.7.2` dist（`shouldRespondTemplate`） | 相关段 | 一手 |
| E5 | eliza issue 搜索 4 次 | 前几页被内部"agent 协作看板"类 tracker 占满，没有拿到有代表性的用户痛点 | 一手（但无效） |

没读到的：AIRI 的长期记忆实现代码、`room-handler-queue.ts` 与 eliza v2 受众准入算法全文、eliza 1.x core 里消息服务的完整流程、麦麦 A_Memorix 内部算法（留给记忆模块阶段）。

## 2. 麦麦 MaiBot（重点）

### 2.1 架构图（v1.3.16）

```
 QQ(NapCat/SnowLuma)  Telegram  QQ官方 …         网页聊天室 / 桌宠（platform=internal, user=owner）   外接 ACP（dsh）
   │ 旧：适配器进程经 maim_message WS 连入        │                                                  │ stdio ACP ⇄ 麦麦托管的 HTTP MCP
   │ 新：适配器插件（plugin driver）              │                                                  │
┌──┴──────────── Runner 守护进程（Worker 以退出码 42 请求重启）───────────────────────────────────────────────┐
│ Worker 进程：bot 主事件循环 + WebUI 线程事件循环（各挂一个卡顿看门狗）                                         │
│ platform_io：去重、RouteKey(platform, account_id, scope)、适配器黑白名单、出站回执                             │
│   → chat_bot.message_process（命令、过滤）→ HeartFCMessageReceiver：入库、登记 Person、记忆身份登记           │
│   → heartflow_manager：每个聊天流 session_id 一个 MaisakaHeartFlowChatting（最多 100 个，24h 无消息才淘汰）   │
│      ├ 普通模式：消息缓存 → 回合调度流水线：防抖 → wait 续接 → 静默 → @强制 → 空闲退避 → 动态门控（逻辑回归） │
│      │           → Planner 工具循环（≤16 轮：reply / wait / stop / query_memory / subagent / 表情 …）         │
│      │           → reply → Replyer（另一个模型；只看本聊天历史 + Planner 写的 reply_reference）→ 发送         │
│      └ Focus（实验）：同组多个聊天流共享一个 FocusGroupRuntime，只有一个 Planner；工具调用必须写 session_id   │
│ 后台：表达/黑话学习（上下文裁切时）、人物事实写回（每次发言后）、聊天摘要写回（按条数）、图片记忆、A_Memorix 每小时维护 │
│ 子进程：插件 Runner（内置组、第三方组；IPC + 健康检查 + 重启）、桌宠 GUI；MCP、子代理、电脑沙盒                │
└────────┬────────────────────────────────────────────────┬──────────────────────────────────────────────┘
   SQLite（SQLModel）：mai_messages、chat_sessions、person_info、       A_Memorix：SQLite 元数据 + faiss 向量 + 图谱
   expressions、jargons、tool_records、monitor_events …                JSON：Focus 检查点、ACP Planner 状态、agent runtime.json
```

### 2.2 十个问题的结论

#### Q1 怎么维持"一个自我"

**心流的演变**〔一手，M2、M3〕：

| 版本 | 结构 | 主心流做什么 | 结局 |
| --- | --- | --- | --- |
| 0.6.0（2025-04） | `Heartflow` 主心流 + 每个聊天流一个 `SubHeartflow` | 每隔 `heart_flow_update_interval`（注释写 5 分钟）调一次 LLM：把所有子心流的 `current_mind` 用 LLM 汇总，再结合日程和心情生成"总体脑内状态"，写回每个子心流的 `main_heartflow_info` | 子心流提示词里注入主想法的那一行 `# prompt += f"麦麦的总体想法是：{self.main_heartflow_info}"` **一开始就被注释掉**（`MB@0.6.0/src/heart_flow/sub_heartflow.py`）。也就是说，主心流花钱算出的"总想法"从来没进过回复 |
| 0.6.3-fix4 | `Heartflow` 变成协调器：`MaiStateInfo`、`SubHeartflowManager`、`Mind`、后台任务 | `Mind.do_a_thinking` 仍在，但没有任何调用点；`MaiState` 被写死为 `NORMAL_CHAT`（"不再允许状态变化"） | changelog 写"移除 OFFLINE 和 ABSENT 状态、移除聊天数量限制" |
| 0.7.0 | 拆成 `focus_chat` 与 `normal_chat` 两套 | — | changelog 原话："**移除主心流思考和 LLM 进入聊天判定**"、"移除日程系统，减少幻觉" |
| 0.9–0.10 | 合并 normal 和 focus | — | 0.10.0："彻底合并 normal 和 focus，完全基于 planner 决定 target message" |
| 0.12.3 | `Heartflow` 只是一个 `chat_id → HeartFChatting / BrainChatting` 字典（群聊和私聊两种循环） | — | — |
| 1.0（2026-06）起 | Maisaka：每个聊天流一个 agent 式运行时 | — | "麦麦现在和一个 Agent 一样工作"；"群聊、私聊和其他聊天的回复链路统一" |
| 1.3.12（2026-10） | 新增 **Focus 共享组**（实验，默认关） | 同组多个聊天流**共享一个 Planner 和完整上下文** | 当前形态，见下 |

**当前（1.3.16）的"自我"有三层**〔一手，M1〕：

1. **共享的部分**：人格（`global_config.personality`，全局一份）、人物信息（`person_info`）、长期记忆（A_Memorix）、学到的表达方式和黑话（可按聊天、共享组或全局）。
2. **每个聊天流各一份**：`MaisakaHeartFlowChatting` 实例，持有自己的短期上下文 `_chat_history`、消息缓存、回合状态（running / wait / stop）、动态门控统计、子代理任务。`heartflow_manager` 按 LRU 管理，最多 100 个活跃实例，只淘汰 24 小时内没消息的（`MB/src/chat/heart_flow/heartflow_manager.py`）。
3. **长期记忆默认也按聊天流隔离**：`a_memorix.global_memory_sharing_enabled` 默认 `False`，`shared_memory_groups` 把需要互相参考的聊天放进一组（`MB/src/config/official_configs.py`）。所以默认情况下，麦麦在 A 群和 B 群是"同一个人格、不同的记忆"。

**Focus 共享组**（`MB/src/maisaka/focus/`）是麦麦对"一个自我面对多个聊天"的最新答案：

- 组的划分：没配 `focus_groups` 时，所有开启 Focus 的聊天进同一个 `"global"` 组；配了之后，按规则内容哈希成组，没匹配上的聊天各自成组（`manager.py: get_focus_scope_key`）。
- 每个组只有一个 Planner 循环（`FocusGroupRuntime.run`）。各聊天的新消息带着 `session_id`、`chat_name`、`msg_id` 进入同一条时间线；每次请求前注入一份"在 X(session_id) 中的注意信息"花名册。
- 提示词规定：没有"当前关注的聊天"；**每次工具调用必须填写 session_id**；可以在一次输出里对不同聊天调用多个工具；"可以关联其他聊天的信息进行思考，但不要把个人隐私透露到其他聊天"（`prompts/zh-CN/maisaka_chat_focus.prompt`）。
- **隐私边界靠上下文构造，不只靠提示词**：Replyer"只看到目标聊天历史和这段指导"；"需要引用跨聊天信息时，把必要且可公开的事实明确写入指导"。
- `wait` 和 `stop` 作用于整个组；被 @ 能提前唤醒；@ 只排队，不打断正在生成的思考。
- 状态写 JSON 检查点。崩溃时没拿到结果的工具调用补一条 `execution_state: unknown`，原文"此调用的完成状态需要核实，**禁止自动重放**"（`group_runtime.py: _closed_entries`）。
- 代价：混合思考和摘要没法按会话拆开，清空一个会话时"涉及被清空会话的整个原子段都失效"（`remove_member`）。

**Planner 与 Replyer 的分工**〔一手，M1〕：

- Planner 是带工具的推理循环，只决定"做什么"。发言必须调用 `reply` 工具，并在 `reply_reference` 里写"上下文关键信息与回复方向"（`maisaka_chat.prompt`）。
- Replyer 是另一个模型请求，提示词由人格、回复风格、本聊天历史、Planner 的指导组成（`maisaka_replyer.prompt`、`maisaka_generator_base.py`）。另有一个"表达方式选择"子代理只看最近 10 条（`reply.py: _run_expression_selector`）。
- 实验开关 `passive_replyer`：Planner 不调工具、直接输出自然语言指导，就当作一次回复的指导（`official_configs.py`）。

**回复意愿（willing）的演变**〔一手，M2、M3、M1〕：

1. 0.6.0：子心流里有一个让 LLM 输出 1–10 的 `judge_willing`，已被注释掉不用；实际用 `willing/mode_*.py` 的数值规则（如 classical：兴趣度超过 0.4 加意愿，被提及加 1，每秒衰减 10%，回复概率 = (意愿 − 0.5) × 2）。
2. 0.8.x：normal 模式用意愿数值；normal 在"120/阈值 秒内回复数超过 6×阈值"或"思考消息堆积"时切到 focus；focus 发够一定条数后"疲惫"切回 normal，切回后冷却 10 分钟/阈值。
3. 0.9.0："重构 no_action 逻辑，不再使用小模型，采用激活度决定"。
4. 0.10.3："**移除激活度系统，现在回复完全由 planner 控制**"。
5. 1.3.2 起：**动态门控**，在 Planner 之前判断要不要启动 Planner（`maisaka/turn_trigger/`）：
   - 私聊不设门控；群聊里 @ 和点名直接强制触发。
   - 其余情况用一个**拟合好的逻辑回归**估计"进 Planner 后会调用 reply 的概率"，特征是：是否点名、是否 @ 了别人、有无问号、是否全是表情或图片、近 5 分钟麦麦发言占比、近 5 分钟消息量、距上次发言秒数、待处理条数。**不调用模型**（`reply_likelihood.py`）。
   - 阈值动态调整：1 小时窗口内，让实际回复次数贴近"不设门控时的预计回复数 × 回复频率 talk_value"；@ 强制触发占用额度；只收紧不放宽；样本不足 20 时用离线阈值表（`dynamic_gate.py`）。
   - 前面还有消息防抖（关闭/快速/自然/沉稳四档，默认自然：安静 2 秒、活跃 5 秒、整批最多 8 秒、被 @ 后最多 1 秒）和"空闲退避"（Planner 连续以 wait/stop/不调工具结束时指数退避，群聊才生效）。

**子心流（聊天流运行时）的生命周期**〔一手，M1〕：

- 创建：第一条消息到达时 `get_or_create_heartflow_chat`，先过适配器名单。启动时从消息库回灌最近消息（上下文窗口的一半），并追加一条"你离线了 X 小时"的提醒，按离线时长分 5 档措辞（`runtime.py: _restore_recent_context_from_db`）。
- 运行：内部队列只有三种触发：`message`、`timeout`（wait 到期）、`proactive`（插件主动任务、子代理结果、外接 Agent 传话）。
- 状态：`running`、`wait`（Planner 调用 `wait(seconds)`）、`stop`。连续 wait 3 次后在请求尾部提醒"延长等待或主动结束"（1.3.15 改为不强制结束）。
- 淘汰：超过 100 个且有 24 小时无消息的实例时按 LRU 停掉；`/clear` 命令或适配器名单变化也会停掉。

#### Q2 核心对象与数据模型〔一手，M1〕

| 对象 | 存储 | 要点 |
| --- | --- | --- |
| 聊天流 `ChatSession` | 表 `chat_sessions` | `session_id` 由 platform + user_id 或 group_id + account_id + scope 计算；AGENTS.md 规定业务模块不得自行计算 session_id，只能经 `chat_manager` 解析 |
| 消息 | 表 `mai_messages` | 收发都入库；带 `account_id`、`scope`、`is_mentioned`、`is_at`、`reply_to`、`is_notify`、原始消息 msgpack、发生时的回复频率 |
| 人 `PersonInfo` | 表 `person_info` | `person_id = md5(platform + "_" + user_id)`，**一个平台账号一个人，没有跨平台合并**；字段有 `person_name`（麦麦给起的名字）与 `name_reason`、昵称、按群的群名片列表、`memory_points`、认识次数和时间 |
| 人物画像 | A_Memorix | 事实写回时带证据消息 ID、来源类别（如 `user_supported`）、稳定性；持久保存"按用户 ID 的称呼映射"，同名不能唯一确定时停止检索（1.3.15 changelog） |
| 机器人账号 | 表 `bot_platform_accounts` | 同一平台可以有多个机器人账号，路由键里有 `account_id` |
| 表达方式、黑话 | 表 `expressions`、`jargons` | 带 `session_id` 或全局标记，有人工审核位 |
| 群 | 1.x 没有独立的群表；0.11 有 `GroupInfo`（群印象、成员列表、话题），当前已删〔一手，M2〕 | — |

关系模型的演变〔一手，M2〕：0.6 用一个数值 `relationship_value` 映射成"厌恶 / 冷漠 / 一般 / 友好 / 喜欢 / 暧昧"六档，还会反馈到心情；0.8 改为按聊天流的 `RelationshipBuilder`，把每个人的消息段攒够后总结成印象；0.10"新的关系系统，更精准也更克制"；1.x 由 A_Memorix 的人物画像和事实写回承担。

#### Q3 事件流与调度〔一手，M1〕

- 入口有三类：
  - 适配器消息：旧链路是独立适配器进程经 maim_message 的 WebSocket 连入；新链路是"适配器插件"，经 `platform_io` 的 plugin driver。
  - 本地消息：网页聊天室和桌宠用 `platform=internal`、`user_id=owner`、机器人账号 `self`，共用一个聊天流（`docs/internal-chat.md`）。
  - 内部任务：插件的 `enqueue_proactive_task`、子代理结果、外接 Agent 的 `agent_talk` 传话，都以 `InternalContextMessage` 追加到对应聊天流的上下文，再投递一次 `proactive` 触发（`runtime.py`）。
- 回不回：**由每个聊天流自己的调度流水线决定**，Planner 是最终决定者，门控只决定要不要叫醒 Planner（见 Q1）。
- 打断：实验开关"快速反应模式"`planner_message_steering`：Planner 强制走流式请求，思考或输出期间来了新消息就中止当前 HTTP 请求，带上新消息重来；同一次请求只打断一次（`PlannerInterruptController`）。1.3.14 转为正式功能。

#### Q4 主动性与生活〔一手，M1、M2、M3〕

- **当前没有内置的生活循环**。主动发言只有两种来源：插件调用 `enqueue_proactive_task(intent, reason, priority)`；内部任务回流（子代理结果、外接 Agent 传话）。主动回合前，若上下文里没有可引用的用户消息，会从库里回填几条作为"可回复的引用目标"。
- 历史上做过、后来删掉的：
  - **日程**（0.5–0.6）：每天用 LLM 生成"1500 字以上、精确到每半小时"的日程，每 5 分钟再让 LLM 生成"现在在做什么"，注入子心流提示词。0.7.0 移除，原话"减少幻觉（将会在未来版本回归）"，至今没有回归。
  - **主动发言**（0.11.0）：按群设"提问概率乘数"（`question_probability_multiplier`），0.12.3 仍在；1.x 代码里已无此字段〔一手，代码 grep〕，changelog 没写删除原因〔未核实〕。
  - **做梦**（0.12.0）：后台每 30 分钟（可设时段）随机挑一个聊天、随机一条记忆，跑最多 20 轮 ReAct，对聊天摘要库做合并、重写、删除；梦境文本可推送给指定用户。1.x 代码里已无此模块，1.0.0 写"A_Memorix 替代旧长期记忆链路"〔一手〕；删除原因没写〔未核实〕。
- 成本控制手段〔一手〕：动态门控（不调模型）、空闲退避、防抖合批、上下文压缩与"中期记忆"摘要、表达与黑话学习改为后台并提高缓存命中（1.3.16）、`fast_model` 任务分给小模型、Planner 最多 16 轮。
- 用户反馈的烧钱案例〔一手，M6〕：
  - #352（0.5 时代）：记忆按话题总结的任务在默认 300 秒间隔下每小时消耗约 20 万 token，还重复处理同一信息。
  - #1710（1.0 时代）：Planner 对每条消息都做全量分析，每条消耗 500–1000+ 输出 token；能力弱的模型不会正确调用结束工具，经常跑满 10 轮；"麦麦只说了十句话但群友聊了几百条，半天吃掉 10M 输出 token"。

#### Q5 后台认知〔一手，M1〕

| 任务 | 触发 | 谁跑 | 位置 |
| --- | --- | --- | --- |
| 表达方式、黑话、高频词学习 | 上下文被裁切时，把裁掉的那段送去学习；同一聊天最少间隔 30 秒；1.0.1 起改为后台任务 | 聊天流运行时持有的 `ExpressionLearner`、`JargonLearner`、`JargonMiner`（每聊天流一份） | `runtime.py: _trigger_trimmed_history_learning` |
| 人物事实写回 | **麦麦每发出一条消息后**入队；跳过太短的、对方未"认识"的 | `PersonFactWritebackService` 后台 worker，调用 LLM 从"麦麦的回复 + 对方最近 8 条消息"里抽事实，带证据消息 ID 写入 A_Memorix | `services/memory_flow_service.py` |
| 聊天摘要写回 | 发言后检查：自上次触发以来的消息数 ≥ 阈值 | `ChatSummaryWritebackService` | 同上 |
| 图片记忆 | 收到消息时入队 | `ImageMemoryWritebackService`，有任务日志可重试 | 同上 |
| 记忆衰减、冻结、剪枝、孤儿回收 | 默认每 1 小时 | A_Memorix `memory_maintenance_service` | `src/A_memorix/core/runtime/services/` |
| 情绪更新 | **已删除**（0.12.0"移除情绪功能"；1.3.7"移除「情绪特点」选项"） | — | — |

#### Q6 人格与情绪作为运行时对象〔一手，M1、M2〕

- 人格：配置文件里的全局字段 `personality.personality`、`reply_style`、可选的 `multiple_reply_style` 与切换概率。Planner 的系统提示词以"你的名字是…你的性格…你的行为风格…"开头；Replyer 用 `_build_personality_prompt` 注入身份。每个聊天可以另配"注意信息"（chat prompt）。运行中只有 WebUI 能改，Planner 没有改人格的工具。
- 情绪的三代：
  1. 0.6：**全局单例** `MoodManager`，愉悦度和唤醒度两个数，每 5 秒按人格的宜人性、神经质做指数衰减；文本更新、按用户关系加权；唤醒度乘到生成温度上（`MB@0.6.3/src/plugins/moods/moods.py`）。
  2. 0.9–0.11：**每个聊天流一个** `ChatMood`，情绪是一句话。**每次生成回复时都调一次 LLM** 根据最近聊天推断新情绪；另有每 45 秒的回归任务，对 200 秒没变化的聊天再调 LLM"冷静下来"，最多两次（`MB@0.11.6/src/mood/mood_manager.py`）。
  3. 0.12.0 起：删除。
- 推论〔推测〕：按聊天流分开的情绪让同一个麦麦在不同群里心情各异；每条回复多一次模型调用。changelog 没写删除原因〔未核实〕。

#### Q7 进程、分层与扩展〔一手，M1、M4、M5〕

- 进程：Runner 守护进程拉起 Worker，Worker 以退出码 42 请求重启（自更新也走这条路）。Worker 里有两个事件循环：bot 主循环、WebUI 独立线程循环，AGENTS.md 专门写了"不要阻塞事件循环"的规则，并各挂一个卡顿看门狗。
- 插件：`plugin_runtime` 把插件放进独立的 Runner 子进程，内置插件和第三方插件分组；经 UDS、TCP 或命名管道做 RPC；有健康检查、最大重启次数、组件超时和熔断。插件能力要在 manifest 里声明（如 `desktop_pet.say`）。
- 适配器边界：
  - 旧：`maim_message` 定义 `MessageBase = message_info（platform、message_id、time、user_info、group_info、format_info、template_info、additional_config、sender_info、receiver_info）+ message_segment（Seg 树：text、image、emoji、at、reply、seglist）`，WebSocket 或 TCP 传输，适配器是独立进程。
  - 新：`platform_io` 中间层统一 legacy、plugin、local 三种 driver；路由键 `RouteKey(platform, account_id, scope)` 从具体到宽泛回退；出站有回执和追踪；适配器黑白名单按平台、账号、群或私聊配置，聊天流被拒绝时立刻注销运行时。
- 外接 Agent：1.3.13 起可连接 dsh 和 dsh Desktop 作为"独立 Agent"；1.3.16 起可让外接 Agent 当指定聊天的 Planner（都是实验功能，默认关）。见 Q10。

#### Q8 持久化与事实来源〔一手，M1〕

- 主库是 SQLite（SQLModel），收发消息全部入 `mai_messages`，另有工具调用记录、Maisaka 监控事件、统计表。
- A_Memorix 自带 SQLite 元数据库、faiss 向量库（按嵌入模型分库）和图谱，有任务日志、断点续建。
- 运行态写 JSON：Focus 检查点、外接 Planner 的会话状态（`data/agent/planner/<hash>.json`）、Agent 的暂停状态。
- **没有事件日志**。重启后短期上下文从消息表回灌，长期状态在 A_Memorix。消息表是最接近"日志"的东西，但思考过程、工具结果只在监控表和推理记录里，不是可重放的真相。
- 历史：0.7.0 把 MongoDB 换成 SQLite（"不再需要繁琐的安装 MongoDB"）；1.0.4、1.0.5 两次处理"数据库大小膨胀"。

#### Q9 用户痛点与被推翻的设计〔一手，M3、M6〕

被推翻的设计：

| 旧设计 | 结局 | 原因（原文或可推断的依据） |
| --- | --- | --- |
| 主心流定期汇总各子心流想法、再广播回去 | 0.6.0 起注入就被注释；0.7.0 移除 | changelog 只写"移除主心流思考和 LLM 进入聊天判定"〔一手〕；〔推测〕汇总出来的"总想法"空泛又花钱，对单个群的回复没有帮助 |
| MaiState（离线 / 看手机 / 专心）与聊天数量限额 | 0.6.3-fix4 移除 | "大幅精简聊天状态切换，提高麦麦说话能力" |
| LLM 生成日程 | 0.7.0 移除 | "减少幻觉" |
| normal 与 focus 两套循环 + 自动切换 + 冷却 | 0.9–0.10 合并 | "消除模式间的差异和复杂性" |
| 激活度、意愿数值 | 0.10.3 移除，交给 Planner | "现在回复完全由 planner 控制" |
| 每聊天流 LLM 情绪 | 0.12.0 移除 | 未写 |
| 自动频率调整、分时频率 | 0.12.0 移除；用户 #1238 抱怨后，1.3.15 把私聊改为"暂停开关"，1.3.2 加动态门控 | #1238：私聊和群聊被同一个参数控制，"群内实际上全是麦麦的聊天消息" |
| 做梦 | 1.0 消失 | 未写 |
| 主循环里的 LLM 判定开始工具 | 1.0.8"不再由 LLM 判定开始工具，节省步骤和消耗资源" | 同左 |

常见抱怨：烧 token（#352、#1710）；自己回复自己、死循环（#1854，1.0.8 仍在，对策是"标记自身消息"和"连续 wait 上限"）；重复、群发同样内容（#1280）；频率控制不好调（#1238）。维护者 #282 自述：外部 PR 太多导致"四不像"，以后核心功能改动须先讨论。

#### Q10 对 CLI 大脑的可移植性

| 麦麦机制 | 是否依赖直接调 API | 搬到灵鲸要怎么改 |
| --- | --- | --- |
| 动态门控、防抖、空闲退避 | **否**，纯本地计算 | 可直接搬思路；权重是在麦麦自己的 QQ 群数据上拟合的，灵鲸要重拟或先用规则〔推测〕 |
| Planner 工具循环 | 是：每轮一个 HTTP 请求，最多 16 轮 | CLI 会话本身就是工具循环，天然对应。Planner 的"决策工具"由本体经 MCP 暴露 |
| 快速反应（中止流式请求、带新消息重来） | 是：依赖可中止的 HTTP 流 | 改成 CLI 的 interrupt + 重发，或 Codex `turn/steer`；ACP 只有 cancel |
| Replyer 另起一次模型调用 | 是 | 每条回复多起一个 CLI 回合，延迟和成本翻倍。改造：同一个 CLI 回合里直接产出正文；只在**跨场合发言**时，才在目标场合的会话里按"只看本场合 + 指导"生成（保留隐私边界） |
| 表达方式选择、表情选择、LLM 断句、错别字 | 是：每条回复多个小模型调用 | 不搬。改成确定性代码，或并进主回合的提示 |
| 人物事实、聊天摘要写回 | 是：每次发言后一次 LLM | 改成批量后台 CLI 任务（按条数或每晚），不每条触发 |
| **外接 ACP Planner（1.3.16 起，实验）** | 否，它本身就是"CLI 当大脑" | 可直接参考，见下 |

外接 ACP Planner 的做法〔一手，`MB/src/agent/planner.py`、`planner_state.py`、`docs/agent-connections.md`〕：

- 在 `agent.planner_sessions` 里点名的聊天流，Planner 请求改发给外部 ACP 程序（默认 `dsh --profile acp`，即 DeepSeek Harness），其余流程不变。
- **每个聊天流一个持久的 ACP 会话**，ID 存进 JSON；每次请求都新起子进程，`initialize` 后用 `session/resume` 接回原会话，用完关闭。外部 Agent 必须声明 ACP v1、`session/resume` 和 HTTP MCP 能力，否则拒绝连接。
- 只发增量：把上下文条目序列化后取哈希，已发过的不再发；系统提示变化时才重发。
- 工具调用的处理：麦麦起一个 HTTP MCP 服务，把本回合可用的工具 schema 暴露给外部 Agent。外部 Agent 调用工具时，MCP 只记录这次"决策"，回执原文是"accepted, NOT executed. End this turn and wait for the actual result."；外部回合结束后，由麦麦自己的运行时执行这些工具。
- 崩溃语义：发请求前先写 `pending=True`；崩溃后只恢复上下文，**不采用上次没交付的工具决策**；下次请求前插一段"上一轮未完成，没有实际执行结果的工具请求不能视为已执行"。
- 连接归属校验：命令、参数、工作目录、环境变量的哈希变了，就拒绝接着用旧会话。
- 另一个"独立 Agent"`agent_service`：外部 Agent 与普通聊天并行工作，麦麦的人格只作为"通信对象资料"提供，"不是要求你切换身份的系统指令"；它通过 `agent_talk` 向某个真实聊天流传话，传话进入该流的 Planner 上下文，不等于在 IM 里发言。

## 3. Letta

### 3.1 架构图

当前（Letta Code）：

```
 CLI/TUI   chat.letta.com / Desktop   Telegram / Slack / Discord / 自定义渠道插件   cron / Wake   其他 agent（SendAgentMessage）
    │             │ WS listener                │ ChannelGateway：准入（dm_policy、allowlist、admin）→ 配对 → routing.json
    │             │                            │   把 (渠道, 账号, chat) 绑到 (agent, conversation)；回复必须调 MessageChannel 工具
┌───┴─────────────┴──────── letta 进程（CLI，或 `letta server`）───────────────────────────────────────────────┐
│ 每个 conversation 一台 TurnLifecycle：idle / command / active / cancelling，每个回合一个 TurnLease            │
│ 队列"转向而不排队"：下一次请求模型前，把队头所有可合并的输入（用户、agent 消息、后台任务通知、cron、mod）一并带上 │
│ 系统提示词 = 基础提示 + MemFS 根目录 md 编译成的块（<persona>、<human>…<memory>）；会话开始时定格            │
│ 回合结束：压缩事件（默认）或每 25 步 → 后台 reflection 子 agent（同模型）在记忆仓库的 git worktree 里改、提交、合并 │
│ 子 agent：general-purpose / fork / recall；外部编码工人：claude-code / codex / opencode / cursor               │
└───┬──────────────────────────────────────────────────────────────┬───────────────────────────────────────┘
  local 后端：conversations/<id>/messages.jsonl（只追加的转录）       Letta Cloud：agent 状态在云，多台电脑跑
  MemFS：每个 agent 一个 git 仓库（persona.md、human.md、MEMORY.md、子目录、skills/）；共享记忆仓库挂在它旁边
```

历史（V1，已退役）：

```
 前台 agent 一步结束 ──▶ turns_counter += 1；若 turns_counter % sleeptime_agent_frequency == 0
        │                     └▶ 为每个 sleeptime agent 建一个后台 run：把 last_processed_message_id 之后的消息转成文本发给它
        │ 共享 block（blocks_agents 多对多；version 乐观锁；block_history 记录改动者）
        ▼                         sleeptime agent 用记忆工具改这些 block，前台 agent 下一轮就读到
```

### 3.2 十个问题的结论

#### Q1 一个 agent 的状态怎么在多个来源之间共享

- 当前模型，原文〔一手，`LC/src/tools/descriptions/SendAgentMessage.md`〕："An agent has a persistent identity and shared memory. It can have multiple conversations, each with its own message history." 即**身份和记忆按 agent 共享，消息历史按 conversation 隔离**。
- 各种来源怎么落到 conversation 上〔一手，L3〕：
  - 渠道：Telegram、Slack 等经 `routing.json` 绑定到某个 agent 的某个 conversation。配对命令示例 `letta channels pair --agent <id> --conversation default`。
  - cron：可以指定 `new`（每次触发一个新会话，默认）、`self`、`default` 或具体 ID。
  - Wake：只能绑定当前会话。
  - 其他 agent：`SendAgentMessage` 发到指定会话，或只给 agent_id 时新开一个隐藏会话；自动附上发送方的回信地址。
- 记忆修改何时生效〔一手，`maintaining-core-memory/SKILL.md`〕："Edits take effect only after they are committed, and only in later system prompts. **The current conversation keeps the prompt it started with.**" 也就是说，A 会话里学到的东西，B 会话要等下一次开会话才看到。
- memory block 挂到多个 agent 上：
  - V1〔一手，历史，L2〕：`blocks_agents` 是多对多表，同一个 agent 内 label 唯一；`groups_blocks` 给整个组挂共享 block；`blocks_conversations` 让某个 conversation 用自己的 block **覆盖** agent 默认值（"isolated memory"）；block 带 `version` 乐观锁和 `block_history`（含 actor_type、actor_id）；`identities_agents`、`identities_blocks` 把外部用户身份挂到 agent 和 block 上。
  - 当前〔一手，`managing-shared-memory/SKILL.md`〕：共享记忆是组织拥有的 git 仓库，挂到多个 agent，克隆在 `$MEMORY_DIR` 旁边；回合结束后由外壳推送已提交的改动，冲突时 pull --rebase 重试一次，还有冲突就在下一回合提醒。**共享记忆不进系统提示词**。每个 agent 只能访问自己的挂载，别的 agent 的同名挂载被"cross-agent guard"挡住。
- 中心调度：没有。每个 conversation 独立跑；agent 之间靠 `SendAgentMessage` 异步通信，工具说明要求"对正在进行的工作，把执行它的 agent 当作 owner，不要接管"。

#### Q2 核心对象与数据模型〔一手，L2、L3〕

- 当前：agent（身份 + MemFS + 设置）→ 多个 conversation（`messages.jsonl`、`in_context_message_ids`、可选的 `system` 快照、模型设置、`parent_agent_id`）→ 回合与 run。渠道侧：ChannelAccount（`dm_policy`、`allowed_users`、`group_policy`、`admin_users`）→ route（chat → agent + conversation）→ 配对码。
- V1 还有 Identity（`identifier_key`、`identity_type`、`properties`）和 Group（`manager_type`：sleeptime、round_robin、supervisor、dynamic；`max_turns`、`termination_token` 等）。
- 没有"群"和"群成员"这类社交对象；一个 Slack 频道线程就是一个路由。

#### Q3 事件流与调度〔一手，L3〕

- 入站全部进同一个"按 conversation 串行"的 listener；**回不回由 agent 自己决定**，渠道消息包成 `<channel-notification>`，agent 不调 `MessageChannel` 就等于不回。README 专门提示：通知到了但没回，多半是模型或提示词问题。
- Slack 默认"机器人参与过的线程，后续人类回复都路由给它"，可按频道改成必须 @。
- 队列规则（`websocket/listener/AGENTS.md`）原文要点："Letta Code steers, it doesn't queue"；只在会话、连接、模型选择、图片策略不同时切批；"Who sent an input is never a boundary"；"Don't make the queue decide what gets through. If a feature needs to restrict something, enforce it where that thing is used"。文档还说队列"一坏就没人报错，agent 只是停止接收新消息，好几天没人发现"。
- 渠道斜杠命令在进入 agent 前处理：`/pause`、`/resume`、`/cancel`、`/reflection` 等。

#### Q4 主动性与生活〔一手，L3〕

- 定时：`Wake`（当前会话，cron 最快每小时一次）和 `letta cron`（可选会话目标、可选执行电脑，最小粒度 1 分钟）。本地调度只在有 Letta 会话运行时才触发，错过的记为 missed；云端调度不依赖本机。
- 工具说明要求 cron 的提示词写清原始请求，例如"用户让我提醒他看 PR……"，而不是只写"reminder"。
- README 定位"always-on agents that work proactively"，但没有内置的生活循环；主动行为全部是 agent 自己排的定时。
- 成本控制：主要靠"反思只在压缩事件时跑"、子 agent 用 `inherit` 模型、核心记忆有字数上限（见 Q6）。

#### Q5 后台认知〔一手，L2、L3〕

- 当前叫 dreaming 或 reflection（README："sleep-time compute (now called 'dreaming')"）：
  - 触发：每回合结束时检查。默认 `compaction-event`（发生上下文压缩时），可改为 `step-count`（默认 25 步）或关闭（`memory-reminder.ts`、`post-turn-reflection.ts`）。Windows 原生环境默认关自动反思。
  - 执行：一个后台子 agent（`reflection-v2.md`：工具 Bash、Edit；模型 inherit）。它读转录文件，按"错误与纠正 → 偏好 → 新事实 → 矛盾 → 可复用流程"的优先级挑可沉淀的内容，改 `$MEMORY_DIR`，以固定格式提交（作者 Reflection Subagent，正文列出看过的转录和改动理由）。没有值得记的就不提交。
  - 并发控制：在记忆仓库的 **git worktree** 里改，完成后合并回主线；合并策略 `auto` 或 `explicit`（由另一个子 agent 做整合）；冲突时报 `merge_conflict`；每个 agent 同时只允许一个反思（`reflection-launcher.ts`）。
  - 写作规范（`maintaining-core-memory`）：把纠正当成对"工作模型"的证据，改原则而不是追加规则；不写出处和日期，因为"message history already holds the events, and the commit message records why the line changed"。
- V1 的 sleep-time agent（历史）：前台 agent 每走完一步，计数加一；每 `sleeptime_agent_frequency` 回合，把"上次处理过的消息之后"的转录拼成文本，发给组里的每个 sleeptime agent，作为后台 run 执行；提示原文"You are NOT the primary agent… Your primary role is memory management"；它改的是和前台 agent 共享的 block（`sleeptime_multi_agent_v4.py`）。

#### Q6 人格与情绪作为运行时对象〔一手，L3〕

- 人格就是 MemFS 根目录的 `persona.md`（和 `human.md` 等），编译成系统提示词里的 `<persona>` 块；agent 自己和反思子 agent 都能改；`.memfs.config.json` 的 `readOnlyFiles` 由 pre-commit hook 强制只读；核心记忆合计默认上限 65536 字符，单文件 20000 字符。
- 注入方式：只在会话开始时编译，会话中途不变。运行时通知（恢复、提醒、mod 指令）一律用 `role: "user"` 包 `<system-reminder>`，不插系统消息，理由原文"Anthropic can reject a system-role notification after an ordinary assistant message"（`LC/AGENTS.md`）。
- 情绪：没有。

#### Q7 进程、分层与扩展〔一手，L3〕

- 进程：单个 Node 进程（开发用 Bun），CLI 交互、headless、WebSocket listener 三条编排路径共享回合逻辑；`letta server` 让本机作为"电脑"接入云端 agent。
- 分层（CI 强制禁止向上依赖）：`cli → websocket → agent → tools → backend → providers → permissions`，`cron`、`channels`、`telemetry`、`utils` 是叶子层。源文件不超过 1000 行（已超的冻结只能缩）。
- 渠道插件：`~/.letta/channels/<id>/` 下的 `channel.json` + `plugin.mjs`，导出 `createAdapter(account)`（start、stop、sendMessage、onMessage）和 `messageActions`（扩展共享的 `MessageChannel` 工具）。`ChannelGateway` 是所有渠道的唯一策略点，云端复用同一套纯逻辑子路径；传输层（Slack Socket Mode、Telegram 长轮询、云端 webhook）按部署各写各的。规定：错误文案统一走 `lifecycle-error.ts`，"Never post raw internal errors to a channel"。
- 其他扩展：skills（全局、项目、agent 级）、hooks、mods（能改外壳本身）、MCP。

#### Q8 持久化与事实来源〔一手，L3〕

- local 后端：每个会话一个只追加的 `messages.jsonl`，迁移前先备份；会话记录里存 `in_context_message_ids`；记忆是每个 agent 一个 git 仓库。
- 这是四个项目里离"日志 + 投影"最近的：转录只追加，记忆每次改动都是带理由的 commit，可以按 commit 回滚。但两者是两份并列的真相，记忆不能从转录重建。
- Cloud 后端：状态在 Letta Cloud，本机只是执行环境。

#### Q9 用户痛点与被推翻的设计

- 最大的推翻：V1 服务端（Python、多租户 API、ADE、AgentFile `.af`）整体退役，改做 CLI 外壳；`.af` 导入导出也已删除〔一手，L1、L3〕。官方没在读到的材料里写原因；第三方博客的说法是"放弃开源 agent 服务端，专注 Letta Code"〔二手，L5〕。
- issue〔一手，L4〕：
  - #2666：本地后端每个 agent 一个独立记忆目录，新会话若新建 agent，就是一块白板，看不到旧 agent 积累的记忆。
  - #417：连接时覆盖了长期 agent 的核心记忆块。
  - #3270（V1）：滑动窗口压缩无视比例，把整个上下文清空只留一条摘要。
  - #298 路线图里有"Prevent racing for concurrent agent messaging"。

#### Q10 对 CLI 大脑的可移植性

- Letta Code 本身是"直接调 API 的外壳"（provider 适配器在 `providers/`），不能把 Claude Code 当它自己的大脑。但它把 Claude Code、Codex、OpenCode、Cursor 当**外部编码工人**：后台任务、有完成通知，可以用 `SendAgentMessage` 继续对它发消息（Codex 走 app-server，Claude 走流式会话）；工人"不创建 Letta agent 或 conversation"，只拿到一句指向父 agent 记忆目录的提示，并约定不要改（`external-coding-agent.ts`、`parent-memory-note.ts`）。
- 可直接搬到 CLI 大脑上的：
  - "记忆文件编译进系统提示、会话中途不变、下一个会话才生效"：和 Claude 的 append system prompt、Codex 的 `developer_instructions` 在会话创建时注入完全对得上。
  - 反思子 agent：它本来就是"一个带 Bash/Edit 的 agent 会话在一份文件副本上干活"，用 Claude Code 或 Codex 跑没有障碍。
  - user 角色的 `<system-reminder>` 运行时通知。
- 需要改的：转向式队列要求能把输入塞进正在跑的回合。Codex 有 `turn/steer`；Claude 外壳要实测；ACP 没有，只能退回"等回合结束"。

## 4. AIRI

### 4.1 架构图

```
 stage-web（浏览器）   stage-tamagotchi（Electron 桌面）   stage-pocket（手机，实验）
        └──▶ stage-ui（Vue + Pinia）：chat store、角色 orchestrator、core-agent（调度、上下文、工具轮）、xsai 直接调模型
             多窗口用 synced-pinia 选 leader；只有 leader 跑定时触发、spark 通知、后台任务
 Electron main：channel-server（server-runtime；WS，默认 127.0.0.1 + token，可开 TLS 给手机扫码连）、
                插件 Host（扩展 manifest v2、Kit）、MCP、computer-use、Home Assistant、Godot 舞台
        ▲ WS（server-sdk）：input:text { overrides.binding, contextUpdates }、context:update、
        │   spark:notify / spark:command / spark:emit、output:gen-ai:chat:*（广播给所有模块）
 discord-bot / minecraft / telegram-bot / satori-bot（独立 Node 进程，部分自带 LLM 和数据库）、VS Code、浏览器扩展、Claude Code hook
 托管后端（可选）：api + auth + PostgreSQL + Redis；本地数据为准，服务端只是镜像
```

### 4.2 十个问题的结论

#### Q1 怎么维持"一个自我"〔一手，A3〕

ADR `2026-10-10-skills-automations-and-memory`（Accepted）原文："AIRI keeps **one main conversation agent per persona**. Skills and memory extend that agent. Background tasks work beside it." 具体规则：

- 外部场合（如一个 Discord 频道）对应一个 binding，宿主为每个 binding 维护一个持久会话；`discord-bot` 把文字和语音转写都绑到 `discord:channel:<id>`，没有 binding 的回复会进主人的私密会话（`integrations/discord-bot/README.md`）。
- 后台任务在新的隐藏会话里跑，**从不重发主会话内容**；结束时主 agent 收到带来源标记的 notice，"decides what to say, or says nothing"；notice 不算主人说的话。
- 发声规则：回复主人的会话会说出声（包括模块代主人发来的输入）；场合回复和后台任务不出声。
- 每次运行开始时读取所属角色的身份，"会话不存系统提示快照，所以改卡片下一次运行就生效"——与 Letta"会话开始时定格"相反。
- ADR 自己列出的未解问题："Scene privacy: chat output reaches every connected module, and a scene prompt reads every shared context."

#### Q2 核心对象与数据模型〔一手，A3、A5〕

- ADR `character-as-chat-member`（proposed）的 ER：CHAT 有多个 MEMBER；MEMBER 是 USER 或 CHARACTER；CHARACTER 有 VOICE、PERSONA、CHAT_MODEL、多个 DISPLAY_MODEL，以后有 MEMORY。目前一个 chat 只有一个用户和一个角色，群聊用同一套关系加成员。
- 记忆（ADR 已接受）：一个索引 + 每条事实一个条目；索引在每次运行开始时和身份一起注入；新条目归属当前角色卡，其他卡读不到；主人可以在设置里把某条设为"通用"，所有卡都读，运行时不能改通用条目。
- 现有代码里的 `notebook` store：笔记、日记、focus 三类条目，加带优先级和到期时间的待办；ADR 说它"stays global"，新记忆数据必须以角色 ID 为键。
- 没有"人"或"跨平台账号"这类对象。

#### Q3 事件流与调度〔一手，A4、A5〕

- 模块经 WS 发 `input:text`，可带 `overrides.binding`（"Stable external scene identity. The host resolves it to a persistent persona session"）和 `contextUpdates`。
- `context:update` 有 `lane`、`strategy`（`replace-self` 替换自己写过的条目，`append-self` 追加）、`destinations`；运行时上下文"每个写入者一个桶"，模块离开时整桶移除（`core-agent/README.md`）。
- `spark:notify` 用于 agent 网络里的事件上报，有 `kind`（alarm、ping、reminder）和 `urgency`（immediate、soon、later）。角色 orchestrator 每 2 秒 tick 一次：immediate 且空闲就立即处理，否则按 0、10、60 秒基础延迟入队，失败重试最多 3 次；到期的笔记待办也转成 spark:notify（`character/orchestrator/store.ts`）。处理方式是调一次 LLM（spark-notify agent），提示原文"You do not need to respond to every spark:notify event directly"，可以用 `builtIn_sparkCommand` 向子 agent（如 Minecraft）下指令，或输出一句角色要说的话。
- 输出 `output:gen-ai:chat:*` 广播给所有连接的模块。
- `streamFrom` 的重试：在任何流事件到达前遇到 408、429、5xx 才重试，最多 3 次；已有输出或工具调用后失败就不重试，"so text and tool side effects never repeat"。

#### Q4 主动性与生活〔一手，A3〕

- automation：触发条件有沉默一段时间、固定间隔、选定星期的本地时间、主人离开后又开始动鼠标键盘、某个模块有新观察；可加时间段、星期、闲/忙状态的条件和冷却。"**Code decides each trigger from the clock and the observations, without a model call.**"
- 自动运行的 recipe 一律在后台跑，结果以 notice 报告给主人最近使用的那张卡的主会话。
- 模型定时：`builtIn_armRecipe` 按主人的话设一次性运行，不需审批；主人要求重复做的事变成提案，`builtIn_proposeRecipe` 也可主动提案，每个提案等主人批一次。
- 桌面端读系统空闲时间，所以在任何应用里的输入都算主人活动；网页端只能看到本页输入。

#### Q5 后台认知〔一手，A3、A7〕

- 没有成熟的记忆整理。ADR 只规定运行时用记忆工具读、写、遗忘条目，"无需审批"。
- README 路线图里 Memory 还是未完成项，"Memory Alaya (WIP)"；#879 提出 Alaya 记忆层（open）；#387 讨论过"各平台各自建库"还是"Docker 集中记忆服务"，前者的缺点原文是"Memories don't sync between platforms"。

#### Q6 人格与情绪〔一手，A2、A3〕

- 人格是角色卡里的 persona（还有声音、聊天模型、形象）；每次运行开始时读取。
- 情绪：代码里有贴纸目录里的"emotion tags"供模型挑表情，没有持续的情绪状态。

#### Q7 进程、分层与扩展〔一手，A1、A4、A6〕

- 进程：Electron 主进程托管 channel-server、插件 Host、MCP 等；**agent 运行在渲染进程**（Pinia store），多窗口靠 leader 选举避免重复执行。集成（discord-bot、telegram-bot 等）是独立 Node 进程。
- 插件平台：
  - 扩展 manifest v2 严格校验；Kit 是"契约 + 提供方"，提供方版本精确匹配、使用方按范围匹配；setup 失败整体回滚注册。
  - 设计文档把流量分成控制面（生命周期、配置、权限、UI）和数据面（音频、视觉帧、转写、角色输出），都走 Eventa。
  - Plugin Host 可以嵌在 Electron main、独立 Node 进程或远程服务器。
  - core-agent 的语音插件"是受信任的进程内代码。授权只管控制命令，不是沙箱"。
- 集成的现状：`satori-bot` 的 README 自承"Mini-Core"（自带事件循环、调度、planner 和 PGlite）是临时方案，将来要退化成只做协议适配和能力提供、"delegating the cognitive loop to the main AIRI process"。`telegram-bot` 自带 LLM、视觉模型、嵌入模型和 PostgreSQL。
- Claude Code 插件只是一个 hook：把 Claude Code 的 `UserPromptSubmit` 事件转成 `input:text` 发给 AIRI，让她"看到"主人在 Claude Code 里说了什么（`plugins/airi-plugin-claude-code/src/cli.ts`）。

#### Q8 持久化与事实来源〔一手，A1、A3、A7〕

- local-first："The local data is the source. The server is a mirror"。浏览器用 IndexedDB、DuckDB-WASM、pglite；后台任务会话和 binding 只留在本机，云端聊天不带 notice。
- 没有事件日志。被中断的生成不提交 turn，但可见输出保留在本地并标 `interrupted: true`。
- #400：Firefox 刷新页面后记忆丢失。

#### Q9 用户痛点与被推翻的设计〔一手，A6、A7〕

- 桌面端从 Tauri（Rust）重写为 Electron（#520 描述的是 `src-tauri` 时代的结构）。
- #520 的目标"不依赖浏览器能力，以便 headless 长期运行在服务器上；Input、Output、ModelProvider 不依赖 Vue 和 Pinia"，**至今没有做到**：ADR 写"The renderer leader runs recipe triggers"。
- 各集成各自带大脑和数据库，多个"她"并存；官方定性为临时。
- 记忆一直没落地；场合隐私未解。
- 高评论 issue 大多是渲染和安装问题（WebGL、VRM、macOS 签名）。

#### Q10 对 CLI 大脑的可移植性

- core-agent 依赖直接流式调用模型：逐 token 驱动语音合成和打断（`VoiceController`），同一回合可以在 Chat Completions 和 Responses 两种协议之间切换。实时语音这一块搬不到 CLI 上，与 handoff 待定事项 4 一致。
- spark-notify 每条通知调一次 LLM。改造：作为带紧急度的 notice 合批进入主意识会话。
- automation 判定不调模型，可以直接搬。
- "每次运行读最新身份"在 CLI 上做不到，因为会话开始后系统提示就固定了。改成"稳定人设在会话创建时注入，易变部分走 user 角色 reminder"（Letta 的做法）。

## 5. elizaOS

### 5.1 架构图

```
 v1（npm 稳定版 1.7.2）
 Discord / Telegram / X … 连接器（插件里的 Service）──MESSAGE_RECEIVED──▶ AgentRuntime（一个 character 一个 runtime）
   ensureWorld / ensureRoom / ensureEntity → 存 Memory（messages 表）
   → shouldRespond：DM、VOICE_DM、SELF、API 频道，client_chat 来源，平台 @ 或回复 → 直接回；其余 → TEXT_SMALL 判断
   → composeState（providers：角色、最近消息、实体、关系、事实、世界、设置…）→ messageHandler（TEXT_LARGE 选 actions）
   → actions（REPLY / IGNORE / FOLLOW_ROOM / MUTE_ROOM / UPDATE_ENTITY …）→ evaluators（reflection：抽事实与关系）
   TaskService + TaskWorker；数据库适配器（plugin-sql：PGlite / Postgres）
 v2（develop）："agentic OS"：@elizaos/agent 宿主 + app（Electrobun 桌面、手机）+ 可选 Eliza Cloud
   身份权威（Principal / IdentityClaim / IdentityCluster）、成员权威（publisher 围栏快照）、记忆作用域 + 受众准入
   plugin-agent-orchestrator：经 ACP 拉起 Claude / Codex / Kimi 等编码子 agent；触发器（cron / interval / once / event）
```

### 5.2 十个问题的结论

#### Q1 一个自我〔一手，E2、E4〕

- 一个 character 对应一个 `AgentRuntime`；所有平台、所有房间的消息进同一个 runtime，但**按房间处理**：最近消息、反思、跟随或静音都以 `roomId` 为单位。没有跨房间的统一思考，跨房间只靠共享的实体、关系、事实记忆。
- v2 把"跨房间能说什么"做成了权限问题（见 Q2 的身份与记忆作用域）。

#### Q2 核心对象与数据模型（World / Room / Entity）〔一手，E2〕

`EZ/packages/core/src/types/environment.ts`：

| 对象 | 字段要点 | 对应 |
| --- | --- | --- |
| `World` | `id`、`agentId`、`messageServerId`、`metadata`（ownership.ownerId、`roles: Record<entityId, Role>`、settings、chatType、服务器级静音） | 一个 Discord 服务器、一个 Telegram 群组空间、"某角色的 Feed" |
| `Room` | `source`、`type: ChannelType`（DM、GROUP、VOICE_DM、FEED、API、SELF…）、`channelId`、`worldId`、`serverId` | 一个频道、一个私聊、一个时间线 |
| `Entity` | `names[]`、`metadata`、`agentId`、`components[]` | 一个用户或 agent；**按 agent 视角存**（agentId 字段） |
| `Component` | `entityId`、`roomId`、`worldId`、`sourceEntityId`、`type`、`data` | 挂在实体上、按世界和房间作用域的数据，记录由谁写入 |
| `Participant` | 房间成员 | — |
| `Relationship` | `sourceEntityId → targetEntityId`、`tags[]`、`metadata` | 有向关系 |
| `Role` | OWNER、ADMIN、MEMBER、GUEST、NONE | 世界内的权限 |

v2 的身份权威（`types/identity.ts`）：

- `Principal`：person、agent、service、organization。
- `IdentityClaim`：键是 `(namespace, connectorId, connectorAccountId, externalSubjectId)`；验证等级 unverified、observed、verified、`owner_bound`；状态 active、revoked、superseded、disputed；带置信度、来源、证据；原文"**Only this separately verified binding can confer owner authority**"（指 `ownerBindingId`）。
- `IdentityCluster` 的合并与拆分是"版本化重定向"，可回退；文件头原文"Identity mutations preserve source principals and evidence; callers resolve through versioned redirects instead of rewriting or deleting history"。
- `identity-clusters.ts`：只有验证过的关联才能授权"跨房间私密披露"，原文"**Inferred same-handle clusters never authorize this path**"。

v2 的记忆作用域（`types/memory.ts`）：`shared`、`private`、`room`、`global`、`owner-private`、`user-private`、`agent-private`；原文"`owner-private` is the fail-closed default"；准入策略是"min-over-members"，即房间里**每个**成员都要有资格看到才能说；另有按实体的显式授权，"a grant beats the ladder in both directions"。

成员权威（`types/membership.ts`）：连接器作为 publisher 上报群成员的完整快照或有序增量，带代际号和过期时间；状态有 current、stale、unavailable、unsupported。

#### Q3 事件流与调度〔一手，E4〕

- v1：连接器把平台事件转成 `MESSAGE_RECEIVED`；bootstrap 插件先确保 World、Room、Entity 存在，存消息，再走 `shouldRespond`。规则分四档：
  1. DM、VOICE_DM、SELF、API 频道直接回。
  2. `client_chat` 来源直接回。
  3. 平台层判定的 @ 或回复直接回。
  4. 其余"let the LLM decide"，用 `shouldRespondTemplate`（RESPOND、IGNORE、STOP）调一次小模型。
  每档都可以用 `ALWAYS_RESPOND_CHANNELS`、`ALWAYS_RESPOND_SOURCES` 配置覆盖。
- 回不回由"规则 + 小模型"决定，在主回复模型之前。

#### Q4 主动性〔一手，E2、E4〕

- v1 的 `postGeneratedHandler`：在"角色 Feed"世界里定时生成推文类内容。TaskService 跑 TaskWorker。
- v2 的触发器支持 cron、interval（1 分钟到 31 天）、once、event。TaskWorker 有两道闸：`shouldRun`（调度器侧，不加载上下文）和 `canExecute`（动作侧，带完整上下文做授权）。注释说明分开的理由是避免"为了跳过而加载上下文"。

#### Q5 后台认知〔一手，E4〕

- v1 `reflection` evaluator：每次回复后检查，同一房间自上次处理以来的新消息数超过 `conversationLength / 4` 才跑；用 TEXT_SMALL 写一段自我反思，同时抽取事实和实体间关系。处理进度存在缓存键 `<roomId>-reflection-last-processed` 里。
- 按房间、按消息量触发，跑在请求路径之后。

#### Q6 人格与情绪〔一手，E1、E4〕

- 人格是 character 定义：bio、lore、风格、消息示例、templates 等。每回合由 `CHARACTER` provider 拼进上下文；运行中不改。
- 情绪：没有情绪状态。bootstrap 的 `anxiety` provider 名字像情绪，实际是按频道类型随机挑三句"社交指引"，内容是"你话太多，不确定时用 IGNORE"之类〔一手，`EZ1/providers/anxiety.ts`〕。

#### Q7 进程、分层与扩展〔一手，E1、E3〕

- 插件导出一个 `Plugin` 对象，可注册 actions、providers、evaluators、services、模型处理器、HTTP 路由、事件、测试、应用视图。连接器（Discord、Telegram 等）就是插件里的 Service，跑在 runtime 同一进程。
- v2 的分层：`@elizaos/core`（运行时内核）、`@elizaos/host`（HTTP 生命周期、平台探测、重启）、`@elizaos/agent`（独立宿主）、`@elizaos/app`（应用宿主）。
- `plugin-agent-orchestrator`："spawning and orchestrating coding sub-agents via ACP, with workspace lifecycle, GitHub integration, task history"；默认 adapter 可选 elizaos、pi-agent、claude、codex、kimi、grok；"Child session identities and credential environments are spawn-managed"。

#### Q8 持久化与事实来源〔一手，E1、E2〕

- 数据库适配器存 Memory 表（messages、facts、documents、fragments…），带 roomId、entityId、worldId；可选嵌入向量。
- v2 交互任务另有一套 journal 规则（`packages/agent/README.md`）："Persist a dispatch transition before any effect"；启动恢复时"pauses unfinished work and marks dispatched outcomes unknown"；对结果不明的操作只能做"只读取证"的对账，"never repeat the effect"。

#### Q9 痛点〔一手，E5；其余未核实〕

- 仓库 issue 现在主要被内部"agent 协作看板"类 tracker 占据（单条上千评论），搜索 shouldRespond、记忆泄漏等关键词也拿不到有代表性的用户痛点。
- 被推翻的设计：从 0.x 的"clients"演进到 1.x 的"连接器即 Service"，再到 v2 的 OS 化〔一手，目录结构对比；细节未核实〕。

#### Q10 对 CLI 大脑的可移植性

- 每条模糊群消息调一次小模型判 shouldRespond：CLI 上太慢太贵。改成麦麦式本地门控。
- composeState 每回合跑一串 providers 拼上下文：CLI 上改为"稳定部分进会话创建时的指令，动态部分做成 MCP 工具按需拉取"。
- TEXT_SMALL、TEXT_LARGE、EMBEDDING 多种模型类型：嵌入本来就不是"大脑"，可以放在本地模型服务里（决策 3 允许 Python 独立服务）。
- v2 的 orchestrator 本身就在用 ACP 拉 Claude、Codex，是"主 agent 调 CLI 子 agent"的又一个现成样本。

## 6. 四个项目横向对比（整体架构问题 A–J）

| 问题 | 麦麦 1.3.16 | Letta（Code 为主，V1 为历史） | AIRI 0.12 | elizaOS（1.7.2 / v2） |
| --- | --- | --- | --- | --- |
| A 进程模型 | Runner + Worker 两级；Worker 里两个事件循环；插件 Runner 子进程分组；适配器是独立进程或插件；外接 ACP 子进程每轮现起 | 单个 Node 进程（CLI、headless、WS listener 共用回合逻辑）；外部编码工人是子进程；云端可托管状态 | Electron main（channel-server、插件 Host、MCP）+ 渲染进程（agent 本体）+ 集成独立进程 | 单进程 runtime，连接器是进程内 Service；v2 有 host、agent、app 三层宿主 |
| B 核心对象 | 聊天流（session）、消息、Person（按平台账号）、机器人账号、表达、黑话、A_Memorix 画像；没有群对象 | agent → conversation → 回合；MemFS（git）；渠道账号、路由；V1 有 block、identity、group | 角色（卡）是聊天成员；聊天、成员、消息；记忆按角色；notebook | World / Room / Entity / Component / Relationship / Role；v2 加 Principal、IdentityClaim、Membership |
| C 事件流 | 适配器 → platform_io → 聊天流运行时；门控决定要不要叫醒 Planner，Planner 决定回不回 | 渠道 → ChannelGateway（准入、配对、路由）→ 会话 listener；转向式合批；agent 不调 MessageChannel 就是不回 | 模块发 input / context:update / spark:notify；orchestrator 2 秒 tick 按紧急度排队 | 连接器 → MESSAGE_RECEIVED → 规则或小模型 shouldRespond → 主模型选 actions |
| D 一个自我 + 多个对话 | 默认每个聊天流一个运行时，共享人格、人物信息；记忆默认按流隔离；Focus 组可以让多个流共用一个 Planner | 身份和记忆按 agent 共享，历史按会话隔离；记忆改动下个会话才生效；没有中心 | 每个人设一个主会话；场合按 binding 各自持久会话；后台任务隐藏会话、以 notice 回报 | 一个 runtime 收所有房间，按房间处理；跨房间靠共享实体和事实 |
| E 主动性 | 无内置生活循环；插件主动任务 API；日程、主动发言、做梦都已删除 | Wake / cron 绑定会话；本地调度只在会话运行时触发 | automation 由代码判定触发（沉默、间隔、时刻、主人回来、模块观察）+ 冷却，后台跑，notice 回报 | v1 Feed 定时发帖、TaskWorker；v2 触发器 + shouldRun/canExecute 两道闸 |
| F 事实来源 | SQLite 状态表 + A_Memorix + JSON 检查点；无事件日志 | 每会话只追加的 jsonl + 记忆 git 仓库（两份并列真相） | local-first 存储，服务器做镜像；无日志 | 数据库 Memory 表；v2 交互任务有"先记派发再执行"的 journal |
| G 扩展边界 | 插件子进程 + manifest 能力声明；适配器经 maim_message 或适配器插件；MCP | 渠道插件（createAdapter + messageActions）、skills、hooks、mods、MCP；ChannelGateway 统一策略 | 扩展 manifest v2、Kit 契约、控制面与数据面分离；集成走 WS 协议；插件不沙箱 | Plugin 对象（actions、providers、evaluators、services、路由）；连接器是 Service |
| H 多端 | WebUI + 网页聊天室 + 桌宠共用 owner 身份；无多设备同步 | Letta Cloud 托管状态，多台电脑执行；同一会话同一时刻只在一台电脑活跃 | 浏览器、桌面、手机共用 stage-ui；多窗口选 leader；云端镜像同步聊天成员 | Eliza Cloud 可选；网页、桌面、手机应用 |
| I 安全与权限 | 适配器黑白名单；WebUI token；插件能力声明；外接 MCP 用 Bearer + Host 校验；桌宠消息没有受保护命令权限 | dm_policy（pairing、allowlist、open）、group_policy、管理员分级；权限模式；跨 agent 记忆挂载隔离；secrets 混淆 | channel-server 默认绑回环 + token；模块权限声明、申请、授予；插件不沙箱；任意模块能读任意聊天资产 | World 角色；v2 身份声明分验证等级，只有 owner_bound 授予主人权限；记忆作用域默认 owner-private；受众准入取所有成员的最小权限 |
| J 出错与恢复 | Worker 重启；循环崩溃自动拉起；启动时回灌上下文并告诉模型离线多久；Focus 中断的工具调用标 unknown、禁止自动重放；外接 Agent 故障暂停，不重发结果不明的任务 | TurnLease 防止过期回合写状态；进程重启后恢复审批；反思 worktree 冲突时报告并清理；渠道错误文案统一包装，不发原始错误 | 有输出之前才重试，有输出或工具调用后不重试；中断的回合不提交；spark 失败重试 3 次 | v2：先持久化派发再执行；恢复时把已派发的标为 unknown；对账只读不重做 |

## 7. 对照灵鲸

### 7.1 唯一主意识加多个对话

| 机制 | 灵鲸对应的需求 | 建议 | 理由 |
| --- | --- | --- | --- |
| 麦麦 0.6 主心流：定期用 LLM 汇总所有子心流的想法再广播回去 | 主意识知道各个对话在发生什么 | **不要** | 麦麦自己从第一天起就没把汇总结果注入回复，0.7 删除。"周期性总想法"花钱又空泛。主意识应该收**具体事件**（带来源的 notice、里程碑），不是收一段想法的摘要 |
| 麦麦 Focus：一个 Planner 看多个聊天合并的时间线，消息带 session_id，每个工具调用必须写目标 session_id | 主意识同时面对主控台、网页，以后还有 QQ、微信 | **改造** | 这是现成的"一个决策上下文 + 多个出口"实现。灵鲸的主意识会话收到的每条输入都带来源、场合、受众标签；她的每个动作（回复、派活、提醒）都必须指明目标对话。第一版只有主人一个人在多个形态说话，直接按这个做 |
| 麦麦 Replyer"只看目标聊天历史 + Planner 的指导" | 隐私按来源；在别处说话时不能带出私聊内容 | **改造后照搬** | 隐私靠**上下文构造**而不是提示词劝说。灵鲸不需要每条回复都分两次模型调用（CLI 太贵），但凡是**跨场合**发言（主意识决定去群里说一句），正文必须在目标场合的上下文里生成，只带"可公开"的指导 |
| AIRI：每个人设一个主会话；外部场合按 binding 各有一个持久会话；后台任务开隐藏会话，结束以 notice 回报，主 agent 决定说不说 | 主意识 + 分身汇报；外部群 | **照搬**结构 | 和灵鲸的"主意识只收里程碑"一致，也和 OpenClaw 的 main session、Paseo 的完成通知同构。外部群聊（第二版）建议用"场合会话"：同一个她、同一份人设，只读按受众过滤后的记忆，群里发生的事以 notice 汇入主意识。**这个"场合会话"既不是分身也不是朋友，是否符合决策 5 需要用户拍板** |
| Letta：身份与记忆按 agent 共享，历史按会话隔离；记忆改动只在**下一个会话**生效 | 分身也是她；分身的经历回流她的记忆 | **照搬** | 分身就是"她的另一个会话"：创建时注入人设和当时的记忆快照；分身做事期间主意识学到的新东西，分身看不到也不需要看到。这和 CLI 会话"系统提示在创建时固定"天然一致 |
| Letta：会话中途的运行时通知用 user 角色 `<system-reminder>`，不插系统消息 | 当下状态、notice 注入正在运行的 CLI 会话 | **照搬** | Letta 给出了理由：Anthropic 会拒绝出现在普通 assistant 消息之后的 system 角色通知 |
| Letta："转向而不排队"，发送者不是切批边界；"不要让队列决定什么能通过，限制放在使用处" | 主意识收件箱 | **参考** | OpenClaw 报告已定"主意识默认 collect、分身默认 steer"，不推翻。补一条原则：权限和隐私的限制放在工具和输出处，不放在队列里 |
| Letta 外部编码工人、eliza orchestrator、麦麦外接 Agent：都把 Claude Code / Codex 当**无人设**的工人 | 分身必须带她的人设 | **不要**照抄默认 | 三家做法一致，但都和灵鲸的决策 5 相反。只借进程管理部分（后台任务、完成通知、继续发消息） |
| 麦麦外接 ACP Planner：每个聊天流一个持久 ACP 会话；增量发送；工具调用经本体的 MCP 只记录"决策"，回合结束后由本体执行；崩溃不采用未交付的决策 | 主意识和分身都走 CLI（决策 4） | **照搬**思路 | 这是国内同类项目里"CLI 当决策层"的现成实现，证明可行。"MCP 回执说'已受理未执行'，本体事后执行"这个模式让本体保留执行权和日志写入权，适合灵鲸的总闸、一键暂停和操作日志 |

### 7.2 跨平台认人和群组建模

| 机制 | 灵鲸对应的需求 | 建议 | 理由 |
| --- | --- | --- | --- |
| eliza v2：`IdentityClaim(namespace, connector, connectorAccount, externalSubject)` + 验证等级 + `owner_bound`；合并与拆分是可回退的版本化重定向 | 跨平台认人；身份只认绑定 | **照搬**，简化 | 灵鲸规定只有主人能绑定，所以验证等级可以只留"观察到"和"主人绑定"两档。合并与拆分可回退，正好满足"主人可更正"。要注意 eliza 的规则：**同名推断出的关联永远不能授权私密内容跨场合披露** |
| 麦麦：`person_id = md5(platform_user)`，按账号；记录每个群的群名片和昵称历史；同名无法唯一确定时停止检索 | 认人的证据 | **照搬**证据记录 | 群名片、昵称、称呼映射作为 IdentityClaim 的证据；跨平台合并只由主人做 |
| eliza World / Room / Entity / Component / Relationship / Role | 内部群、外部群、私聊；家人和朋友；关系 | **改造** | World 对应"一个平台上的空间"或"灵鲸之家"，Room 对应群、私聊、内部群，Entity 对应真人或数字生命，Component 存"某人在某群的群名片、角色"这类按场合的数据。灵鲸还要把关系拆成"主人设定、不可变的部分"和"相处中变化的印象"两层，eliza 只有 tags |
| eliza 记忆作用域默认 `owner-private`，受众准入取房间所有成员的最小权限 | 隐私按来源 | **照搬** | 这正是灵鲸"这条记忆能在哪说出口"的形式化：默认最严，只能放宽；群里只要有一个人不该知道就不说。麦麦的"按聊天流隔离 + 共享组"粒度太粗，AIRI 则还没解决 |
| eliza 成员权威：连接器上报成员快照或增量，带代际号和过期时间 | 判断"群里都有谁"，受众准入要用 | **参考**，第二版 | 成员表过期时应当按"不确定"处理，也就是最严的受众 |
| AIRI：角色是聊天成员（chat 有 member，member 是用户或角色） | 第三版内部群 | **照搬** | 内部群就是"一个 chat、多个成员"，主人和数字生命都是成员 |
| 麦麦 `RouteKey(platform, account_id, scope)` 与 `bot_platform_accounts` | 第五版：外部群里多个成员各用自己的账号 | **照搬** | 路由键一开始就带"哪个账号"，以后不用改表 |
| Letta 渠道准入：dm_policy（pairing、allowlist、open）、group_policy、管理员分级；斜杠命令在进 agent 之前处理 | 外部渠道准入；一键暂停 | **照搬** | 与 OpenClaw 配对一致。`/pause`、`/cancel` 不经过模型这一条值得照搬 |

### 7.3 生活循环和主动性

| 机制 | 灵鲸对应的需求 | 建议 | 理由 |
| --- | --- | --- | --- |
| AIRI automation：触发由代码判定，不调模型（沉默、间隔、时刻、主人回来、模块观察）+ 条件 + 冷却；后台跑，结果以 notice 回报主会话；主人要求重复的事变成提案，等一次批准 | 作息、主动关心、自主开关 | **照搬** | 与 OpenClaw 的"主动 = 普通定时任务"一致，又多了"主人回来了"和"模块有新观察"两类对陪伴很关键的触发。只有触发命中才起 CLI 回合，花费可控 |
| AIRI spark:notify 的紧急度（immediate、soon、later）+ 基础延迟 + 重试 | 内部事件进主意识的优先级 | **照搬** | 分身完成、伙伴回信、模块告警都按紧急度排队，主意识空闲时合批处理 |
| Letta Wake / cron：绑定当前会话、新会话或默认会话；提示词必须写清原始请求 | 兑现承诺 | **照搬**目标语义 | 与 Paseo 的"新对话 / 唤醒已有对话"两种目标对上。"提示词写清原始请求"可以直接写进灵鲸的承诺记录格式 |
| 麦麦日程生成（每天 LLM 写 1500 字日程，每 5 分钟再写"正在做什么"） | 生活循环 | **不要** | 0.7 以"减少幻觉"删除，至今没回归。灵鲸的"生活"应由真实可执行的事组成（逛 B 站、追更新、写日记），不靠模型编一段日程 |
| 麦麦动态门控：拟合的逻辑回归 + 按目标回复率动态调阈值 + @ 强制 + 防抖 + 空闲退避 | 第二版群聊分寸、不刷屏 | **照搬**结构，重拟权重 | 每条群消息不调模型就能决定要不要叫醒大脑，对 CLI 大脑尤其重要。权重来自麦麦的 QQ 群数据，灵鲸的家人群需要重新拟合或先用规则 |
| 麦麦 Planner 的 wait、stop 工具 + 连续 wait 提醒 | 安静返回 | **照搬** | 与 OpenClaw 的 NO_REPLY 同类，多了"wait N 秒后再看一眼" |
| 麦麦主动回合前回填"可引用的用户消息"；启动时告诉模型"你离线了 X 小时" | 出错也像人；跨重启连续 | **照搬** | 便宜而有效的连续感 |

### 7.4 后台认知任务放在哪

| 机制 | 灵鲸对应的需求 | 建议 | 理由 |
| --- | --- | --- | --- |
| Letta 反思子 agent：回合结束时按"压缩事件"或"每 N 步"触发；在记忆文件的 worktree 里改；带理由提交；合并回主线；同一 agent 同时只跑一个；没东西就不提交 | 每晚整理；记忆抽取；成长提案 | **改造** | 这是"后台任务走 CLI"最贴近的现成做法：一个带 Bash/Edit 的 CLI 会话，在一份副本上干活。灵鲸的改法：副本和合并放在操作日志上（"成长提案"事件 → 本体校验 → "成长生效"事件），不另立 git 作为第二份真相；出生设定文件只读，由本体强制（对应 Letta 的 `readOnlyFiles` + pre-commit hook） |
| Letta V1 sleep-time：每 N 回合，把"上次处理过的消息之后"的转录发给后台 agent | 增量处理 | **照搬**检查点 | 每个后台任务记自己的"处理到哪条日志"，与 eliza 反思的 `last-processed` 缓存键同理 |
| Letta 记忆写作规范：改原则不追加规则；不写出处；只凭模式或明确指示更新，不凭单次模糊事件 | 成长不漂移、防操控 | **照搬**为后台任务的提示词规范 | 直接对应"成长不会改变底色，不会被某个群带偏几天" |
| 麦麦：每次发言后抽人物事实、按条数写摘要、上下文裁切时学表达 | 关系记忆、事实记忆 | **改造** | 触发点合理，但每条一次 LLM 太贵（#352、#1710）。灵鲸改为按条数或按时间批量，交给后台 CLI 任务 |
| 麦麦 0.12 做梦：每 30 分钟随机挑一个聊天整理摘要 | 每晚整理 | **不要**随机挑选 | 1.x 已删。整理应按日志增量和固定作息跑，可追溯 |
| eliza v1 reflection：每房间新消息超过 conversationLength/4 才跑，小模型抽事实和关系 | 同上 | **参考**阈值 | 按场合计数触发，避免冷清的场合被频繁整理 |

### 7.5 人格和情绪的运行时位置

| 机制 | 灵鲸对应的需求 | 建议 | 理由 |
| --- | --- | --- | --- |
| Letta：人格是记忆文件，编译进系统提示；核心记忆有总量和单文件上限；超出就移到"按需读取"的子目录 | 人格三层的注入 | **照搬**分层与上限 | 出生设定、成长编译进会话创建时的指令（稳定、可缓存）；当下状态和本轮相关记忆走 user 角色 reminder。上限照搬：根文件合计 6.5 万字符、单文件 2 万 |
| AIRI：每次运行开始时读最新身份，不存快照 | 改了人设立即生效 | **不要** | CLI 会话中途改不了系统提示。改为：出生设定和成长版本变化时，新会话用新版本；正在进行的会话收到一条 reminder |
| 麦麦 0.6 全局单例情绪（两个数，按人格衰减）→ 0.9 每聊天流一句话情绪、每次回复调 LLM → 0.12 删除 | 当下状态（心情）影响语气和语音 | **不要**后两种 | 每聊天流各一份情绪等于"在不同群里是不同的人"；每条回复多一次模型调用不可接受。四个项目里**没有一个有能用的情绪运行时**。灵鲸的当下状态要自己设计：全局唯一一份、在明确事件（主人的话、完成的活、作息）时更新、随时间衰减，0.6 的数值衰减模型可以作为起点。细节留给人格与成长模块 |
| 麦麦人格只在配置里，Planner 没有改人格的工具；eliza character 运行中不变 | 出生设定只有主人能改 | **照搬** | 与 OpenClaw 报告"不要让 agent 自改 SOUL.md"一致 |

### 7.6 操作日志作为唯一事实来源

| 机制 | 灵鲸对应的需求 | 建议 | 理由 |
| --- | --- | --- | --- |
| 四个项目都没有"日志是真相" | — | 灵鲸自建，维持原结论 | 麦麦是状态表 + 记忆库 + JSON；Letta 是会话 jsonl + 记忆 git 两份并列；AIRI 是本地存储 + 镜像；eliza 是数据库 |
| Letta 会话 `messages.jsonl` 只追加；记忆改动都是带理由的提交，可回滚 | 成长可查、可回滚 | **改造** | 证明"可回滚的人格变化"在工程上成立。灵鲸把"带理由的提交"换成日志里的成长事件（谁提的、依据哪些日志、改了什么），投影出当前人格文件 |
| 麦麦 Focus：中断的工具调用标 `execution_state: unknown`、禁止自动重放；外接 Planner：请求前写 pending，崩溃后不采用未交付决策 | 本体崩溃后的恢复 | **照搬** | 与 OpenClaw 的续跑规则、Paseo 的"结果不明不重复"一致，是第三、第四个独立样本 |
| eliza v2 交互任务："任何副作用之前先持久化派发转换"；恢复时标 unknown；对账只读取证、不重做 | 同上；兜底靠可撤销 | **照搬** | 正好是操作日志的写入顺序规则：先写"将要做"，再做，再写"做了什么" |
| AIRI：有输出或工具调用之后就不再重试模型请求 | 出错也像人；不重复副作用 | **照搬** | 备用大脑切换时同理：只在没有副作用时重发 |

## 8. 和 OpenClaw、Paseo 的结论合起来看

| 问题 | OpenClaw | Paseo | 麦麦 | Letta | AIRI | elizaOS | 对灵鲸更合适的 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 一个自我怎么维持 | main session 是根，主人私聊汇入，群动态以通知汇入 | 没有，每个工作区一棵 agent 树 | 每流一个运行时，共享人格；Focus 组共享一个 Planner | 身份和记忆按 agent 共享，历史按会话 | 每人设一个主会话 + 每场合一个 binding 会话 + 后台隐藏会话 | 一个 runtime、按房间处理 | 主会话为根（OpenClaw、AIRI）+ 输入带来源、输出指明目标（麦麦 Focus）+ 分身是同一 agent 的新会话（Letta） |
| 回不回谁决定 | 宿主规则（提及门控）+ 模型 NO_REPLY | 不涉及 | 本地门控决定叫不叫醒，Planner 决定说不说 | 模型决定（不调工具就是不回） | 主会话模型决定；notice 可以不回 | 规则，其余小模型 | 代码门控在前，模型在后；不为每条消息调模型 |
| 主动性 | 普通定时任务 + 活跃时段 + 空闲才跑 + NO_REPLY | schedule 与 heartbeat 共用 cron | 已全部删掉，只剩插件 API | Wake / cron 绑会话 | 代码判定触发 + 冷却 + 后台 + notice | 触发器 + 两道闸 | 共识：触发由代码决定、模型只在触发后运行、可以安静返回。灵鲸取 AIRI 的触发种类 + OpenClaw 的策略 + Letta 的目标会话语义 |
| 后台认知 | dreaming（三阶段，提升有规则关） | 结构化生成 + 兜底链 | 每次发言后写回、按条数摘要、裁切时学习 | 反思子 agent 在副本上改、合并 | 无 | 每房间按量反思 | Letta 的"后台会话在副本上改、本体合并"+ OpenClaw 的提升关 + 按量批处理 |
| 人格位置 | 工作区 SOUL.md，agent 可改 | systemPrompt 两段 | 全局配置，只读 | 记忆文件，可改，可设只读 | 角色卡，每次运行读 | character，只读 | 出生设定只读（麦麦、eliza）；成长经后台提案修改（Letta 的流程，日志化）；会话中途变化用 reminder |
| 情绪 | 无 | 无 | 做过两代，都删了 | 无 | 无 | 无 | 没有可借鉴的成熟实现，自己设计 |
| 认人 | identityLinks（只是路由） | 无 | 按账号，不合并 | 渠道配对 | 无 | IdentityClaim + 验证等级 + 可回退合并 | eliza v2 |
| 隐私 | 来源类别管"可不可信"；DM 分会话 | 无 | 按聊天流隔离 + 共享组 + Replyer 只看目标聊天 | 跨 agent 挂载隔离 | 自认未解 | owner-private 默认 + 受众最小权限 | eliza v2 的作用域 + 麦麦的"在目标场合生成正文" |
| 事实来源 | 状态表 + Markdown | CLI 转录 | 状态表 + 记忆库 | jsonl + git | 本地存储 | 数据库；交互任务 journal | 都不是。灵鲸的 journal 仍是独有设计，恢复语义取 OpenClaw、麦麦、eliza 的共识 |
| CLI 大脑 | Codex 与 ACP 是插件 harness，内置 runner 为主 | 只包外部 CLI | 外接 ACP Planner（实验） | 外部编码工人 | Claude Code 只是事件来源 | ACP 编码子 agent | Paseo 的契约 + 麦麦的"MCP 只收决策、本体执行" |
| 子 agent 的人设 | 只注入 AGENTS.md | 不继承 | 子代理只拿 Planner 写的任务说明 | 外部工人无人设，只给记忆目录指针 | 后台任务用同一人设的隐藏会话 | 编码子 agent 无人设 | 只有 AIRI 的后台任务"是她"；灵鲸由本体显式注入人设（Paseo 报告已定） |

**共识**：

1. 身份和长期记忆按"人设"共享，工作上下文按会话或房间隔离；主人有一个特殊的"家"会话。
2. 回不回、何时主动，先由代码判定，模型只在必要时运行；允许安静返回。
3. 后台认知异步、按触发跑，产出写进记忆，不写进对话。
4. 恢复时"结果不明的副作用不重放"。

**分歧**：

1. 决策上下文要不要合一：麦麦 Focus、OpenClaw main 选择合一；Letta、eliza、AIRI 的场合会话各自独立。
2. 人格能不能自改：Letta、OpenClaw 能；麦麦、eliza 不能。
3. 身份快照在会话开始定格（Letta）还是每次运行重读（AIRI）。

**对灵鲸的取舍**〔推测〕：

- 主人在各形态的私聊合进主意识一个会话，内部事件以带紧急度的 notice 进来，这一点没有争议。
- 家人朋友的私聊和外部群，走"场合会话 + notice 汇入"比塞进主意识更稳，理由有三：隐私边界清楚，主意识上下文不被群消息淹没，CLI 回合数可控。麦麦 Focus 证明了"一个大脑看多个群"能做，但它的代价（整组 wait、无法按会话清理、跨群隐私只靠提示词和 Replyer 边界）在家人场景里风险更高。
- 快照语义取 Letta：CLI 决定了只能这样做。

## 9. 坑与反例

1. **"主意识定期汇总子意识"是死路**〔一手〕：麦麦 0.6.0 的主心流每几分钟汇总一次，结果从未注入回复，0.7 删除。
2. **每条消息一次小模型判断**〔一手〕：麦麦 0.6 的 `judge_willing`（写了就注释掉）、eliza 的 shouldRespond 小模型。麦麦的最终答案是不调模型的回归门控。
3. **Planner 对每条消息全量分析烧钱**〔一手，#1710〕：弱模型不会正确调用结束工具，循环跑满，"麦麦只说了十句话，半天吃掉 10M 输出 token"。灵鲸的主意识大脑草案是 DeepSeek Flash（决策 6），要防同类问题：回合上限、门控在前、提示词要求"不需要时简短结束"。
4. **自己回复自己**〔一手，#1854〕：模型把自己的话认成别人的话。麦麦的对策是"标记自身消息"、过滤机器人账号、连续 wait 上限。灵鲸在外部群里以自己的账号发言后，回流的消息必须标记为"她自己说的"。
5. **频率参数一刀切**〔一手，#1238〕：私聊和群聊共用一个回复频率，用户只好关掉麦麦。私聊改成"暂停开关"、群聊用动态门控是后来的修正。
6. **LLM 编日程制造幻觉**〔一手，0.7 changelog〕。
7. **按会话分开的情绪 + 每条回复一次模型调用**〔一手〕，最后整个删除。
8. **记忆总结烧钱且重复**〔一手，#352〕：300 秒一次的话题总结，每小时约 20 万 token。
9. **身份绑在会话或 agent ID 上导致失忆**〔一手，Letta #2666〕：新会话新建 agent 就是白板。灵鲸的"她"必须是本体里稳定的对象，和任何 CLI 会话 ID 解耦（与"换 CLI 她还是她"一致）。
10. **连接时覆盖核心记忆**〔一手，Letta #417〕：外壳初始化逻辑把长期 agent 的记忆块写回默认值。灵鲸的人设注入只能读，不能回写。
11. **整个服务端架构被放弃**〔一手 + 二手〕：Letta V1 退役、`.af` 格式删除。说明"给 agent 做通用多租户服务端"这条路在维护上很重，灵鲸做单主人单机，不要往这个方向扩。
12. **场合隐私没人解决**〔一手〕：AIRI 的 ADR 自认"所有模块都能收到聊天输出，场合提示能读所有共享上下文"；AIRI 的任何模块都能读任意聊天资产。灵鲸的形态插件不能默认订阅全部输出。
13. **大脑放在 UI 进程里**〔一手〕：AIRI 的 agent 跑在渲染进程，要靠多窗口选 leader；#520 想做 headless 至今未成；Firefox 刷新丢记忆（#400）。灵鲸已定"本体是后端常驻服务"，这条是反面佐证。
14. **每个集成自带一个大脑**〔一手〕：AIRI 的 telegram-bot、satori-bot 各自有 LLM 和数据库，等于多个"她"。灵鲸的形态插件只做感知和行动，不带认知。
15. **同名推断合并身份**〔一手，eliza v2 明文禁止〕：同名推断出的关联不能授权私密内容跨场合披露。
16. **共享上下文的连带清理**〔一手，麦麦 Focus〕：混合思考没法按会话拆分，清空一个会话会让整段失效；整组 `wait` 让所有聊天一起暂停。
17. **外接 CLI 每轮现起进程**〔一手，麦麦〕：`initialize → resume → prompt → close` 每轮一遍，切换工作目录后不能 resume，连接配置一变就拒绝接着用旧会话。灵鲸主意识要常驻会话，不能照这个开销做。
18. **队列一坏就静默失联**〔一手，Letta listener AGENTS.md〕：不报错，只是停止接收新消息，好几天没人发现。灵鲸的收件箱要有"最后一次被消费的时间"监控。
19. **默认按聊天隔离记忆让"她"在不同场合像不同的人**〔一手，麦麦默认值〕；而打开"全局共享"又会把私聊内容带到群里。只有"按受众准入"能同时解决两头，这正是灵鲸要做的。
20. **许可证**〔一手〕：麦麦是 GPL-3.0，只借鉴思路，不能摘代码进灵鲸。Letta 是 Apache-2.0，AIRI 和 eliza 是 MIT，可以摘取（注明出处）。

## 10. 待实测或待核实

- **CLI 主意识的回合成本**：麦麦式"门控后叫醒大脑"在 Claude Code 外壳 + DeepSeek Flash 上，一次 resume + 一回合要多少秒、多少 token。直接决定第二版群聊能不能走"场合会话"。
- **会话中途注入**：Claude Code（SDK 流式输入）和 Codex（`turn/steer`、developer 消息）能否在会话中途接收 user 角色的 `<system-reminder>`，用来送当下状态和 notice。沿用前两份报告的待测项。
- **MCP"只记录决策、本体执行"在 Claude Code / Codex 上的表现**：模型拿到"已受理未执行"的回执后，会不会正确结束回合等待结果（麦麦是对 dsh 做的）。
- **麦麦动态门控权重的可迁移性**：是在麦麦自己的群聊数据上拟合的（`scripts/explore_reply_necessity.py`，未读）。
- 麦麦删除做梦、0.11 主动发言、情绪的具体原因：changelog 没写〔未核实〕。
- 麦麦 0.6.0 之前 MaiState 是否真的切换过（只读到 0.6.3-fix4 的写死版本）〔未核实〕。
- Letta V1 退役的官方理由〔只有二手〕；Letta Code 反思合并冲突的频率与处理效果〔未实测〕。
- AIRI 长期记忆（ADR 已接受）的实现位置与完成度〔未读代码〕。
- eliza v2 受众准入算法全文、`room-handler-queue.ts`（jsDelivr 返回 403）、1.x core 消息服务全流程〔未读〕。
- eliza 的真实用户痛点：issue 区被内部 tracker 占满，需要换渠道（Discord、论坛）〔未核实〕。
- 本次全部通过打包下载和单文件 CDN 获取，没有 git 历史；"某功能何时删除"以 changelog 为准，没有逐提交核对。

## 11. 整体架构问题 A–J 速答（本步新增的结论）

- **A 进程模型**：四家都是"一个常驻宿主进程 + 子进程"。麦麦把插件放子进程、两级守护；AIRI 把大脑放 UI 进程是反例。对灵鲸：维持"本体单进程 + CLI 子进程"，形态插件不带认知。
- **B 核心对象**：新增可用的模型有 eliza 的 World / Room / Entity / Component / Relationship + IdentityClaim（认人）、Letta 的 agent → conversation（分身就是她的会话）、AIRI 的"角色是聊天成员"（内部群）、eliza 的记忆作用域（隐私）。
- **C 事件流**：入站先过代码门控（麦麦），再进按会话串行的收件箱（Letta、OpenClaw）；内部事件按紧急度排队（AIRI）；输出必须指明目标对话（麦麦 Focus）。
- **D 唯一主意识 + 多对话**：主会话为根；跨场合发言在目标场合的上下文里生成；分身是同一 agent 的新会话，记忆在创建时定格。外部场合是否用"场合会话"需用户拍板。
- **E 主动性**：代码判定触发（含"主人回来了""模块有新观察"），模型只在触发后运行，结果以 notice 回主意识；不让模型编日程。
- **F 事实来源**：四家都没有日志为真；恢复语义的共识是"先记派发再执行、结果不明标 unknown、不重放"。
- **G 扩展边界**：适配器只做感知和行动，路由键带账号（麦麦）；渠道准入和斜杠命令在进大脑之前处理（Letta）；插件默认不能订阅全部输出（AIRI 的反面）。
- **H 多端**：主人在各形态的私聊合进一个主会话（麦麦的 internal/owner 身份、OpenClaw main），本报告无新增分歧。
- **I 安全与权限**：身份声明分验证等级，只有主人绑定授予权限；记忆默认最严、按受众最小权限放行（eliza v2）。
- **J 出错与恢复**：有输出或副作用后不重试（AIRI）；离线后恢复时告诉她离开了多久（麦麦）；渠道错误统一包装、不发原始错误（Letta，对应"出错也像人"）。
