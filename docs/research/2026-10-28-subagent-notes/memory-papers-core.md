# 子调研原文：记忆系统核心论文精读（MemGPT、Generative Agents、MemoryBank、A-MEM、Mem0、Zep）与 LoCoMo 争议

> 来源：第 1 段对话（2026-10-27）里的调研子任务「Core memory papers deep read」的最终回复，原样存档。
> 状态：未整理、未逐条核对；语言为中文，保持原文。只删掉了一句指向已不存在的临时目录的说明。
> 用途：记忆系统模块阶段的调研起点。索引和要点见同目录 `README.md`。

---

# 灵鲸记忆系统调研笔记：MemGPT / Generative Agents / MemoryBank / A-MEM / Mem0 / Zep，以及 LoCoMo 评测争议

**一句话结论：** LoCoMo 上的分数不能当作选型依据。它的对话能整段塞进上下文，full-context 基线就有约 73% J；Letta 让 agent 用 grep 读文件，拿到 74.0%。厂商之间互相测出的数字差了将近 20 个点。灵鲸应该用自己的操作日志做评测集。

标注约定：[一手]＝我读了原文确认；[二手/推测]＝二手来源、记忆或推断。

## 1. MemGPT（https://arxiv.org/abs/2310.08560，v2 HTML）

**读了什么：** §2 全部、§3、附录 prompt。论文里的函数名（如 `working_context.replace`）只出现在图片里，HTML 文本中只有 `conversation_search`。

**数据模型** [一手]
- main context 分三段：
  - 只读的 system instructions；
  - working context：固定大小、可读写的非结构化文本，只能通过函数调用写入，存用户和 persona 的关键事实；
  - FIFO queue：第一条是被驱逐消息的递归摘要。
- external context 分两种：
  - recall storage：全部消息的数据库，永久保存；
  - archival storage：任意长度文本，用 PostgreSQL + pgvector（HNSW 索引）。

**写入与 memory pressure** [一手]
- prompt 超过 warning token count（例：上下文的 70%）时，插入一条系统警告，让 LLM 自己把要紧信息转存到 working context 或 archival。
- 到 flush（例：100%）时，驱逐约 50% 上下文的消息，并重新生成递归摘要。
- 函数执行的报错会回灌给 LLM，检索结果分页返回。

**控制流** [一手]
- 事件驱动，事件包括用户消息、系统警告、定时事件（可以"无人提示地运行"）。
- `request_heartbeat=true` 表示函数执行完立即再推理一次，实现函数链；不带这个标志就 yield，等下一个事件。

**评测** [一手]
- DMR（MSC 数据集，LLM judge）：
  | 模型 | 基线（只给有损摘要） | +MemGPT |
  |---|---|---|
  | GPT-4 Turbo | 35.3% | 93.4%（ROUGE-L 0.827） |
  | GPT-4 | 32.1% | 92.5% |
  | GPT-3.5 Turbo | 38.7% | 66.9% |
- judge prompt 明确要求 "be generous"。
- nested KV：只有 MemGPT+GPT-4 在超过 2 层嵌套时还稳定。

**缺陷**
- 论文自己承认：分页经常提前停止；GPT-3.5 函数调用能力差；GPT-4 Turbo 版反而比 GPT-4 版差 [一手]。
- Zep 论文复测：gpt-4-turbo 直接看全文就有 94.4%，所以 DMR 不能区分记忆系统 [一手]。
- 没有冲突处理和遗忘机制，全靠 LLM 自己改写。

**对灵鲸：** 把"memory pressure 警告 + 让大脑自己决定转存"做成 CLI 工具调用。heartbeat 对应 Claude Code 原生的多步工具循环，不需要自己实现。recall storage 就是操作日志本身。

## 2. Generative Agents（https://arxiv.org/abs/2304.03442，v2）

**读了什么：** §4（4.1–4.3）、§6、§7、§8.2、附录 A。

**数据模型** [一手]
- 每个 memory object 含：自然语言描述、创建时间、最近访问时间。
- 类型有 observation、reflection、plan，都在同一个 stream 里参与检索。
- 用 gpt-3.5-turbo。

**打分** [一手]
- recency：按"距上次被检索的沙盒游戏小时数"做指数衰减，衰减因子 0.995。
- importance：创建时打 1–10 分，prompt 原文："On the scale of 1 to 10, where 1 is purely mundane (e.g., brushing teeth, making bed) and 10 is extremely poignant (e.g., a break up, college acceptance), rate the likely poignancy…"。示例：打扫房间 = 2，约暗恋对象 = 8。
- relevance：记忆与 query memory 的 embedding 余弦相似度。
- 三项各自 min-max 归一化到 [0,1]，`score = α_rec·rec + α_imp·imp + α_rel·rel`，所有 α 都等于 1。按分数从高到低，取能塞进上下文的部分。
- 推算 [二手/推测]：0.995/小时的半衰期约 138 小时（≈5.8 天）；换成真实时间需要重新标定。

**reflection** [一手]
- 触发：最近事件的 importance 累计超过 150，实际每天 2–3 次。
- 流程：
  1. 取最近 100 条记录，问 "what are 3 most salient high-level questions…"；
  2. 每个问题作为检索 query，召回相关记忆（含已有 reflection）；
  3. 问 "What 5 high-level insights… (because of 1, 5, 3)"；
  4. 存入 stream，并带上被引用记忆的指针，形成 reflection 树。

**planning 与人物摘要** [一手]
- 日计划分 5–8 块，再递归拆成小时级、5–15 分钟级。
- 是否 react 由 LLM 判断，判断前用两个 query 召回上下文："[观察者] 与 [对象] 是什么关系"、"[对象] 正在 [做什么]"。
- 人物摘要用三个 query 合成后缓存："core characteristics"、"current daily occupation"、"feeling about recent progress"。

**消融**（100 名评估者，TrueSkill μ）[一手]
| 条件 | μ（σ） |
|---|---|
| 完整架构 | 29.89（0.72） |
| 无 reflection | 26.88 |
| 无 reflection、无 planning | 25.64 |
| 人类众包 | 22.95 |
| 无记忆 | 21.21 |
- 完整 vs 无记忆 Cohen's d = 8.16；Kruskal-Wallis H(4) = 150.29。
- 消融版没有重新模拟，用的是完整版积累的同一份记忆，作者称这是保守估计。

**端到端（25 个 agent，2 个游戏日）** [一手]
- 信息扩散：竞选消息 4%→32%，派对消息 4%→52%。
- 网络密度 0.167→0.74。
- 认识他人的回答中幻觉占 1.3%（6/453）。

**缺陷** [一手]
- 检索遗漏、记忆残缺；会"添油加醋"（例：把邻居 Adam Smith 说成《国富论》作者）。
- 指令微调导致过度合作：Isabella 的兴趣逐渐被别的 agent 塑造。
- 作者明确提到 "memory hacking" 风险：精心设计的对话可以让 agent 相信一件从未发生的事。
- 2 天模拟花了数千美元。

**对灵鲸：** 打分公式可以直接当召回排序的初版。reflection 带证据指针，正好契合"来源"字段。"过度合作被同化"就是伙伴之间对话投毒的真实案例。

## 3. MemoryBank（https://arxiv.org/abs/2305.10250，v3）

**读了什么：** §2、§3、§4 全部。

**数据模型** [一手]
- 带时间戳的逐轮对话；
- 每日事件摘要，汇总成全局摘要；
- 每日性格分析，汇总成全局用户画像。
- prompt 原文："Summarize the events and key information…"，"…summarize the user's personality traits and emotions"。

**检索** [一手]
- DPR 式双塔，FAISS 索引；每轮对话和每条事件摘要各算一个 memory piece。
- 嵌入模型：英文 MiniLM，中文 Text2vec，经 LangChain 调用。
- 注入 prompt 的内容：召回记忆 + 全局画像 + 全局事件摘要。

**遗忘** [一手]
- `R = e^{-t/S}`，S 首次提及时初始化为 1；每被召回一次，S 加 1 且 t 归零。
- 作者自称是 "exploratory and highly simplified"。
- 论文没有给出 t 的单位、遗忘阈值，也没有消融（原文只说 "forget it with a lower probability"）。

**评测** [一手]
- ChatGPT 模拟 15 个用户 × 10 天对话，194 个人工探针问题（中英各 97）。
- ChatGPT 版英文：检索准确率 0.763、正确性 0.716、连贯性 0.912；中文：0.711 / 0.655 / 0.675。
- 没有无记忆基线的量化对比。在 A-MEM 论文的表里它是最弱的一档（GPT-4o-mini，single-hop F1 = 5.00）。

**对灵鲸：** 情景记忆可以用"召回强化 S++"。推算：S=1、t 以天计时，1 天后 R = 0.37，太激进，要自己标定 [二手/推测]。领域记忆应豁免衰减。

## 4. A-MEM（https://arxiv.org/abs/2502.12110，v11）

**读了什么：** §3、§4、§6、附录 A.5、附录 B 的 prompt。

**笔记结构** [一手]
- `m_i = {c 原文, t 时间, K 关键词, G 标签, X 一句话上下文, e 向量, L 链接}`。
- K/G/X 由 LLM 按 JSON 模板生成。
- `e = enc(concat(c, K, G, X))`，编码器是 all-minilm-l6-v2。

**link generation** [一手]
- 新笔记先按余弦取 top-k 邻居，再由 LLM 决定和谁建链。

**memory evolution** [一手]
- 对每个邻居，LLM 决定要不要改写它的 context、keywords、tags，改完直接替换原笔记。
- prompt 的 actions 里还列了 merge / prune，但正文没有描述。

**检索** [一手]
- 余弦 top-k，默认 k=10；同一个"box"里有链接的记忆一并取出。
- 但 GPT 系列模型的 k 是按题型调的（40/50，附录表 8）。这等于在测试集上调参。

**评测**（LoCoMo，GPT-4o-mini，F1）[一手]
| 题型 | A-Mem | MemGPT | 去掉 LG 和 ME | 去掉 ME |
|---|---|---|---|---|
| Multi-hop | 27.02 | 26.65 | 9.65 | 21.35 |
| Temporal | 45.85 | 25.52 | 24.55 | 31.24 |
| Open Domain | 12.14 | 9.15 | 7.77 | 10.13 |
| Single-hop | 44.65 | 41.04 | 13.28 | 39.17 |
| Adversarial | 50.03 | 43.29 | 15.32 | 44.16 |
- 每题平均 token：A-Mem 2,520，LoCoMo / MemGPT 约 16.9k。
- 每次记忆操作约 1.2k token、成本低于 $0.0003、耗时 5.4 s（4o-mini）；本地 Llama 3.2 1B 上 1.1 s。
- DialSim F1：A-Mem 3.45，LoCoMo 2.55，MemGPT 1.18。

**题型标签不一致** [一手]
- Mem0 论文转载 A-Mem 的同一组数字时，题型名对不上。例：A-Mem 自己标 "Multi Hop" 的 27.02，在 Mem0 表里被标成 Single-hop。
- 说明 LoCoMo 的 category 编号到题型名的映射，各家不一致。

**缺陷**
- 作者承认：组织质量依赖底层 LLM；只支持文本 [一手]。
- 没有删除或冲突处理。
- evolution 会无痕改写旧笔记，来源被污染，投毒能顺着链接扩散 [二手/推测]。
- Mem0 用 J 指标复测，A-Mem 整体只有 48.38 [一手]。

**对灵鲸：** 链接 + 邻居演化可以借鉴，但只能放在每晚整理里做，必须保留版本、不能覆盖原文。

## 5. Mem0（https://arxiv.org/abs/2504.19413，v1）

**读了什么：** §2、§3、§4 全部，附录 A–C。

**抽取** [一手]
- 每来一对新消息 `(m_{t-1}, m_t)`，prompt 为 `P = (S, 最近 m=10 条消息, m_{t-1}, m_t)`。
- S 是全局对话摘要，由一个异步模块定期刷新。
- LLM 从中抽出候选事实 Ω。

**更新** [一手]
- 每个候选事实取 top s=10 个相似记忆，交给 LLM 通过 tool call 选择操作：
  - ADD：新增；
  - UPDATE：补充，信息量更大才替换；
  - DELETE：与新信息矛盾，直接物理删除；
  - NOOP：不变。
- 全程用 GPT-4o-mini。
- 回答 prompt 里写着 "contradictory → prioritize the most recent memory"，即冲突留到读的时候再裁决。

**Mem0g（图变体）** [一手]
- Neo4j 存储；先抽实体，再生成三元组 `(v_s, r, v_d)`。
- 节点相似度超过阈值 t 就复用已有节点。
- 冲突时由 LLM resolver 把旧关系标记为 invalid，不物理删除。
- 检索两路：实体中心（找到锚点节点后扩展出入边）+ 三元组语义匹配（超过阈值）。

**评测设置** [一手]
- LoCoMo：10 段对话，每段约 600 轮、约 26k token、约 200 题；adversarial 类被剔除。
- J 指标跑 10 次取平均；judge 模型论文没有写明，prompt 改自 MemGPT 的"宽松"版。

**分题型 J** [一手]
| 方法 | Single-hop | Multi-hop | Open Domain | Temporal |
|---|---|---|---|---|
| Mem0 | 67.13 | 51.15 | 72.93 | 55.51 |
| Mem0g | 65.71 | 47.19 | 75.71 | 58.13 |
| Zep | 61.70 | 41.35 | 76.60 | 49.31 |
| LangMem | 62.23 | 47.92 | 71.12 | 23.43 |
| OpenAI | 63.79 | 42.92 | 62.29 | 21.71 |
| A-Mem* | 39.79 | 18.85 | 54.05 | 49.91 |

**整体 J、检索 token 与延迟** [一手]
| 方法 | 整体 J | 检索 token | 搜索 p50 / p95 | 总延迟 p50 / p95 |
|---|---|---|---|---|
| Full-context | **72.90** | 26,031 | — | 9.87 / 17.12 s |
| Mem0g | 68.44 | 3,616 | 0.476 / 0.657 s | 1.091 / 2.59 s |
| Mem0 | 66.88 | 1,764 | 0.148 / 0.200 s | 0.708 / 1.44 s |
| Zep | 65.99 | 3,911 | 0.513 / 0.778 s | 1.292 / 2.926 s |
| 最佳 RAG（k=2，chunk 256） | 60.97 | — | — | — |
| LangMem | 58.10 | 127 | 17.99 / 59.82 s | 18.53 / 60.40 s |
| OpenAI | 52.90 | 4,437 | — | 0.466 / 0.889 s |
| A-Mem | 48.38 | 2,520 | 0.668 / 1.485 s | 1.410 / 4.374 s |
- 记忆库体积：Mem0 约 7k token/对话，Mem0g 约 14k，Zep 超过 600k。
- 论文称 Zep 入库后立刻检索效果差，几小时后才变好。

**缺陷**
- full-context 仍然最好（72.90）[一手]。
- 所有基线都是 Mem0 自己跑的；OpenAI 拿到的是"全部记忆"的特权访问 [一手]。
- DELETE 是物理删除，没有历史，主人无法审计 [一手]。

**对灵鲸：** "摘要 + 最近 10 条"作为抽取上下文、四操作 tool call，可以直接用于事实记忆。但 DELETE 要改成软失效并留历史；候选事实要带上来源字段。

## 6. Zep / Graphiti（https://arxiv.org/abs/2501.13956，v1）

**读了什么：** §2–§5、附录 prompt。HTML 本身丢了 §2.2.2 开头一段。

**三层图** [一手]
- episode：原始消息 / 文本 / JSON，无损存储，每条带 `t_ref`；
- semantic entity：实体节点 + 事实边；
- community：label propagation 聚类出的强连通实体群，带 map-reduce 摘要和名字向量。
- episode 与它派生的边之间有双向索引，可回溯到出处。

**双时间** [一手]
- 事件时间线 T：`t_valid` / `t_invalid`，表示事实成立的区间；
- 入库时间线 T'：`t'_created` / `t'_expired`，用于审计。
- 时间抽取 prompt 依据 `t_ref` 换算相对时间，统一用 ISO 8601。

**实体消解** [一手]
- 实体抽取时看当前消息 + 前 n=4 条（两轮对话）；说话人强制作为一个实体；用 reflexion 式自检减少幻觉。
- 实体名嵌入 1024 维，做余弦检索，同时对名字和摘要做全文检索，得到候选。
- LLM 判断 `is_duplicate`，返回 uuid 和更完整的名字，更新名字与摘要。
- 写库用预定义 Cypher，不让 LLM 生成查询。

**事实与失效** [一手]
- 边去重：混合检索只在同一实体对之间的边里找。
- 矛盾检测：LLM 比较新边与语义相关的旧边；遇到时间重叠的矛盾，把旧边的 `t_invalid` 设为新边的 `t_valid`；按 T' 新信息优先。
- 社区增量更新：新节点归入邻居中占多数的社区，所以需要定期全量刷新。

**检索** [一手]
- 流程：search → rerank → construct。
- search 三路：cosine、BM25（Neo4j 的 Lucene）、BFS n 跳（可以用最近的 episode 作种子）。
- rerank 可选：RRF、MMR、episode-mentions（按被提及频次）、node distance（离中心节点的图距离）、cross-encoder（最贵）。
- 输出：事实 + 有效日期区间 + 实体摘要 + 社区摘要。

**实验设置** [一手]
- BGE-m3 做嵌入和 rerank；gpt-4o-mini-2024-07-18 建图。
- 取 top 20 边/节点；DMR 一节写的却是 top 10，前后不一致。

**评测** [一手]
- DMR：
  | 方法 | gpt-4-turbo | gpt-4o-mini |
  |---|---|---|
  | Zep | 94.8% | 98.2% |
  | full-context | 94.4% | 98.0% |
  | 会话摘要 | 78.6% | 88.0% |
  - 论文自己批评 DMR：每段只有 60 条消息，全都是单轮事实题。
- LongMemEval_s（约 115k token，judge 为 GPT-4o）：
  | 方法 | 准确率 | 延迟 | 上下文 |
  |---|---|---|---|
  | full-context（4o-mini） | 55.4% | 31.3 s | 115k |
  | Zep（4o-mini） | 63.8% | 3.20 s | 1.6k |
  | full-context（4o） | 60.2% | 28.9 s | 115k |
  | Zep（4o） | 71.2% | 2.58 s | 1.6k |
- 4o 分题型（full → Zep）：preference 20.0→56.7、temporal 45.1→62.4、multi-session 44.3→57.9、knowledge-update 78.2→83.3、single-session-user 81.4→92.9、single-session-assistant 94.6→80.4（下降）。

**缺陷**
- 论文没报入库成本；MemGPT 没能跑 LongMemEval；对 assistant 侧信息记得差 [一手]。
- 每条消息要调多次 LLM。灵鲸通过 CLI 调用的话会很慢、很贵 [二手/推测]。

**对灵鲸：** 双时间 + episode 回指，正好承载"来源 / 可更正 / 审计"。失效时只写 `t_invalid`、不删，适合主人更正。"去重只在同一实体对之间做"可以直接照搬。

## 7. 争议与博客结论

**Mem0 论文（2025-04）的说法** [一手]
- 自己测 Zep：整体 J 65.99，p95 搜索 0.778 s，记忆库超过 600k token，入库后需要等几小时。

**Zep 博客 "Lies, Damn Lies & Statistics"（2025-05-06）**
- 指出 Mem0 跑错了 [一手，WebFetch]：
  - 对话两方都被设成 user 角色，用的是单用户图；
  - 时间戳被拼进消息正文，没用 `created_at`；
  - 搜索串行执行，夸大了延迟。
- 修正后：Zep 75.14 ± 0.17，p95 搜索 0.632 s [一手，WebFetch]。
- 原文承认 "we erred in how we calculated Zep's LoCoMo score"；后来又发了更新："80% at <200ms"（页面上的日期写成了 2015，应是笔误）[一手，WebFetch]。
- 最初约 84% 的说法错在：category 5 从分母去掉了、分子却保留。这是 Mem0 CTO 在 getzep/zep-papers issue #5 里指出的，他重算为约 58.44% [二手/推测]。GitHub API 返回 403，我没能核实这个 issue。
- Zep 对 LoCoMo 本身的批评 [一手，WebFetch]：
  - 对话只有 16–26k token，能整段塞进上下文；
  - 没有 knowledge-update 题；
  - category 5 没有标准答案；
  - BLIP 生成的图片描述缺信息；
  - 有说话人张冠李戴、一题多解的题目。

**Letta 博客 "Is a Filesystem All You Need?"（2025-08-12）** [一手，WebFetch]
- 设置：gpt-4o-mini；对话放进一个文件挂给 agent；工具只有 grep、search_files（语义检索）、open、close。
- 规则：必须先调 search_files，自己决定循环几次，直到调用 answer_question 结束；prompt 只做了极少调优。
- 结果 74.0%，高于 Mem0 报告的 68.5%。
- 结论：记忆的关键在于 agent 怎么管理上下文、能不能自己迭代生成 query，而不在检索机制本身；文件工具贴合模型在 agentic coding 上的后训练。
- Mem0 没有回应他们关于 MemGPT 数字是怎么算出来的询问。

**后续** [二手/推测]
- Mem0 2026 年新算法自称 LoCoMo 92.5（managed 平台、top_200 检索、约 7k token），旧算法 71.4。
- 第三方审计：LoCoMo 答案表约 6.4–7% 有误；同一批答案换 judge prompt 重新评分，分数从 55.8% 摆到 81.4%。
- 公开版 LoCoMo 共 1,986 题，去掉 category 5 的 446 题后剩 1,540 题。

**对灵鲸的含义**
- 别用 LoCoMo 选型，用自己的操作日志做评测集。
- 必须跑 full-context 基线。
- 灵鲸的大脑本来就是 Claude Code / Codex，"把记忆做成文件 + 让大脑用 grep / 搜索工具查"很可能是性价比最高的读取路径；结构化抽取的价值主要在来源、更正和防投毒上，不在召回分数上 [二手/推测]。

Sources:
- [Zep: Lies, Damn Lies & Statistics](https://www.getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)
- [Letta: Benchmarking AI Agent Memory](https://www.letta.com/blog/benchmarking-ai-agent-memory)
- [braindetox：记忆基准分数怎么读](https://braindetox.kr/en/posts/memory_benchmark_scores_reliability_2026.html)
- [Wyrm COMPARISON.md](https://cdn.jsdelivr.net/npm/wyrm-mcp@8.5.8/COMPARISON.md)
- [Mem0 research](https://mem0.ai/research)
- [Mem0 blog: AI memory benchmarks](https://mem0.ai/blog/ai-memory-benchmarks)
- [mem0ai on PyPI](https://pypi.org/project/mem0ai/2.0.16/)
