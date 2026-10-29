# 第 1 段对话的子调研原文存档

日期：2026-10-28 存档。第 1 段对话（2026-10-27）开了六个调研方向，其中记忆系统、人格与成长、CLI 编排、同类系统对比四个方向在中途被叫停。当时的说法是"没整理成结论"，但核对原始日志后发现，这四个方向下面有 8 个子任务已经写完了完整结论，只是从没进仓库。这里原样存档，供模块阶段直接当调研起点，避免重做。

- 都是原文，没有整理成 `docs/research/` 其他报告那样的格式，也没有逐条核对。英文的保持英文。
- 每条结论的一手、二手标注见各文件正文。
- 能力插件、客户端与前后端两个方向的子任务结论，当时已经并入 `2026-10-28-ability-plugins.md` 和 `2026-10-28-client-backend.md`，这里不重复。
- 没有结论、只剩原始工具输出的子任务（人格与成长、OpenClaw/麦麦/LivingMemory 的记忆实现，以及三个父任务）不存档，只在原始日志里，位置见 `docs/handoff.md`。

## 文件索引

| 文件 | 内容 | 用在哪个模块 |
| --- | --- | --- |
| `cli-claude-sdk-codex-app-server.md` | Claude Agent SDK 0.3.311 的 `sdk.d.ts` 与 changelog、Codex app-server 协议源码：会话、回合、中途插话、人设注入、钩子、权限、用量、压缩、出错 | 主意识与分身的 CLI 编排 |
| `cli-protocols-acp-a2a-mcp.md` | ACP v1（及 v2 草案）、A2A 1.0、MCP 2026-07-28 的规范现状 | 主意识与分身的 CLI 编排 |
| `cli-multi-agent-practice.md` | Anthropic、Cognition、OpenAI Agents SDK、LangChain、Magentic-One、MAST、Chroma 等的多 agent 实践；末尾有"主意识与干活分身契约"的十条建议 | 主意识与分身的 CLI 编排 |
| `cli-paseo-upstream-openclaw-orchestration.md` | Paseo 上游 0.14 相对 Helm 的编排变化；OpenClaw 子 agent、队列、ACP、压缩、失败切换的配置项和默认值 | 主意识与分身的 CLI 编排 |
| `memory-papers-core.md` | MemGPT、Generative Agents、MemoryBank、A-MEM、Mem0、Zep 的数据模型和评测数字；LoCoMo 评测争议 | 记忆系统 |
| `memory-oss-source.md` | Letta、mem0、Graphiti、cognee、LangMem 的源码笔记和横向对比 | 记忆系统 |
| `memory-benchmarks-poisoning.md` | LongMemEval、LoCoMo、MemoryAgentBench；HippoRAG；MemOS；2025–2026 新工作；记忆投毒与防御 | 记忆系统 |
| `openclaw-architecture-early.md` | OpenClaw 整体架构的早期调研，已被 `2026-10-28-openclaw-architecture.md` 取代；多出的部分有群里的 room_event、bot 循环保护、写入准入的性能数据 | 整体架构（补充） |

## 和整体架构稿直接相关的要点

下面这些不改变 `docs/architecture/overall.md` 的结构，只是给已有设计点补了一手依据，或者给待实测项提供了文档层面的答案（仍然要实测）。

| 要点 | 出处 | 关系到 overall.md |
| --- | --- | --- |
| Claude Code 的 `systemPrompt`（preset + append）默认 `snapshot`：第一次请求时渲染，之后整个会话复用；中途换 append 要到压缩或新会话才生效 | `cli-claude-sdk-codex-app-server.md` §1 | 印证 §5.4"成长版本只在新会话生效" |
| Claude Code 可以用 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 显式标出缓存前缀和动态后缀 | 同上 | 印证 §4.2 的缓存边界做法 |
| Claude Code 回合中途再往输入流里送一条消息，会在工具轮之间并进正在跑的回合；`shouldQuery:false` 只追加进转录、不起新回合；`interrupt()` 返回回执，列出还在排队的消息 | 同上 | §4.7 会话邮箱、N5 抢占、§16 第 2 条（会话中途注入提醒） |
| Codex 的 `thread/start`、`thread/resume` 都能传 `developerInstructions`（追加）；`turn/steer` 必须带 `expectedTurnId`；`thread/inject_items` 不起回合就把内容加进历史；`additionalContext` 可标 `untrusted` 或 `application` | 同上 §2 | §4.2、§5.4、§8.2 R5、§16 第 2 条 |
| Codex 有实验性的 `dynamicTools`：由客户端执行工具，经 `item/tool/call` 把结果交回 | 同上 §2 | N4（内核工具在调用当中同步执行） |
| Claude Code 走 DeepSeek 时 `total_cost_usd` 是按默认 Claude 价格猜的（`costBasis:'unknown'`），Codex 流里只有 token 没有费用 | 同上 | 印证 §11.8"计量保留原始单位，换算成钱只在 guard 里做"；§16 第 6 条 |
| Claude Code 支持 `CLAUDE_CONFIG_DIR` 指定数据目录；`settingSources` 省略时会加载主人自己的全部 Claude Code 设置 | 同上 | §16 第 8 条；§3.4"每个成员一个 CLI 数据目录" |
| ACP v1 没有系统提示字段（有 RFD 在推进），没有回合中途插话；`usage_update` 已稳定 | `cli-protocols-acp-a2a-mcp.md` | 印证决策 2、4 和 §9.2 |
| MCP 当前版本 2026-07-28 去掉了 `initialize`、改成无状态；Claude Code 同时支持新旧两版 | 同上 | §9.5 内核工具端点要兼容两版（模块阶段定） |
| LangChain 基准：主管转述子 agent 的回复会引入错误，加一个"原样转发"工具约提升 50% | `cli-multi-agent-practice.md` [10/11] | 印证决策 5、14"传原话"；汇报方向也可以原样转发 |
| OpenClaw #148707：同一会话里第二个回合挤掉正在跑的回合，回复丢失 | `cli-paseo-upstream-openclaw-orchestration.md` Pitfalls | N5 的实现要把被中断回合的输入放回去（§4.7 已这样写） |
| Audience-Bound（arXiv 2609.36373）：写入时把在场者绑定为受众；派生记忆取各来源受众的交集；在场者不明时只用公开记忆；1 万段多方历史零泄漏 | `memory-benchmarks-poisoning.md` §D | 印证 §11.4"按受众的隐私" |
| Compaction Laundering（arXiv 2610.29869）：把对话压平成带"[User]:"的字符串再摘要，伪造的用户回合会变成"真实指令"；保留角色类型的序列化不受影响 | 同上 §D | 补强 §6.6"写进记忆之前先清洗" |
| 记忆投毒：基于内容的检测都被绕过，只有结构性手段（来源标签、写入绑定受众、非主人的话只记成"某某说"）有强证据 | 同上 §E | 印证 §11.5 防操控 |
| MemoryAgentBench：读的时候让模型自己判断哪条更新，普遍失败 | 同上 §A3 | 记忆模块：冲突要在写入或夜间整理时显式版本化 |
