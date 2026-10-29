# 调研：GitHub 上的 agent 记忆系统全景（截至 2026-10）——谁最好、主流怎么做、灵鲸在哪

日期：2026-10-28。起因：主人原话"那你去 github 上查一下最好的实现是啥，在这个记忆系统上，大家都是怎么实现的"。主人担心"算法查库很难保证查询准确"，觉得网上流行的"神经元图谱记忆"更靠谱。本稿补上一轮调研（`2026-10-28-memory-mechanisms.md`，下称"记忆调研"）没覆盖的全景、新项目和"谁在生产里用"，并把 `architecture/modules/05-memory.md`（下称"05 草稿"）放进同一张表里比。上一轮读过源码的项目（Letta、mem0、Graphiti、cognee、LangMem、麦麦、HippoRAG、A-MEM、MemOS 一部分、livingmemory、OpenClaw、Nekro、elizaOS）这次只引用结论，不重读。

标注：〔一手〕本次读了源码、官方文档原文或论文正文与表格；〔二手〕搜索摘要、第三方文章、厂商新闻稿、已有调研转述；〔推理〕我的判断。表格和 ④ 里用简写：〔一〕= 一手（本次读源码）；〔述〕= 一手，但只是项目 README 或官方文档的自述；〔旧〕= 二手，转引上一轮读过源码的笔记；〔二〕= 二手。数字一律写出处，并标"自报"（项目方自己测）或"第三方"。星数（★）和"最近推送"取自 GitHub 搜索 API 的 `stargazers_count`、`pushed_at`，读取日期 2026-10-28；`pushed_at` 是任一分支的最后一次推送，近似"最近提交"。

## ① 一页结论

1. **没有一个"最好"的实现，但最好的几家做法高度一致。** 用户面最广的（按宿主热度推断）是 OpenClaw（★39.3 万）和 Hermes Agent（★25.8 万）这类个人 agent 的内置记忆：**Markdown 文件为真相 + SQLite FTS5 全文 + 可选向量的混合检索**，外接记忆后端可插拔〔一手文档 / 二手〕。托管记忆服务里有真实客户、也被第三方测过的是 mem0、Zep/Graphiti、Supermemory〔二手〕。开源里自报分数最高、工程最完整的是 Hindsight（★5.6 万）：语义 + BM25 + 实体/因果链接扩展 + 时间臂四路召回，RRF 融合，交叉编码器重排，再乘新近/时间/证据数微调〔一手源码〕。
2. **主流做法一句话：存"抽取的事实条目"或"agent 自己写的 Markdown 文件"，用"全文 + 向量"混合检索、RRF 融合、作用域与元数据过滤、时间加权，可选重排，漏了让 agent 自己再搜；整理放后台或夜里。** 47 个专门记忆项目里，检索用混合的 25 个、占星数 76%；以图为主检索的 6 个、占 1.7%；整理放后台的 20 个，写入时在线判的 15 个，不整理的 12 个〔推理，分类见 ⑤〕。
3. **"神经元图谱"不适合当主存储和主检索。** 标榜神经元 / 海马体 / 赫布 / 扩散激活的记忆项目我数到十几个，绝大多数是 2026 年新建的小项目；把神经元 / 扩散 / 赫布当核心机制的 6 个合计不到 1 万星（占 47 个专门记忆项目星数的 1.4%），只有自报数字或没有评测，NeuralMemory 自己的评测还输给朴素基线；**没找到任何一个在有真实用户的产品里长期在用**，唯一大规模上线过的是麦麦"海马体"，已被它自己弃用〔一手 / 二手〕。产品里的图只当辅助通道：Graphiti 的 BFS（可选）、Hindsight 时间臂里最多 5 轮、逐跳衰减的扩散、麦麦 A_Memorix 的 PPR（融合权重 0.15，后验图默认关）。"图谱 + PageRank"在我列出的约 20 个有真实用户的记忆系统里只有 A_Memorix 一例〔推理〕。不少"大脑"只是品牌：hippo-memory 默认就是 BM25；MCP 官方的"知识图谱记忆"是一个 JSONL 文件加子串匹配〔一手源码〕。
4. **"查询准确"靠检索工程，不靠存储形态。** 第三方证据：MemoryAgentBench 里纯 BM25 总分 41.5，HippoRAG-v2 41.6，GraphRAG 23.4，Mem0 21.1、Zep 24.0〔一手论文表〕；LoCoMo 上"稠密 + BM25"分数融合比只用稠密高 8.8–17.2 个点 Hit@1、比只用 BM25 高 11.2，而现成的网页搜索交叉编码器重排反而掉 6.9〔一手摘要，第三方〕；MemPalace 的第三方审计证明：原文逐字存 + 一个小英文嵌入模型，LongMemEval-S 的 R@5 就有 96.6%，"宫殿结构"不贡献分数〔一手〕。厂商实验指向同一处：Redis 测"原文混合检索 + 抽取事实"86.1% 对"只用抽取事实"71.2%〔二手，自报〕。
5. **灵鲸的位置：骨架和生产主流同构，治理领先，检索手段保守一档。** 同构：经历流为真相、索引是可重建的投影（≈"文件为真相"派），RRF k=60，离线整理，读时衰减。领先：受众交集、claim 降格、来源家族去重、被用到才加强、模糊措辞、墓碑，GitHub 主流项目基本没有（最接近的是 Honcho 的"观察者→被观察者 + 会话成员时间窗"和 CrewAI 的"私有记录只对同来源可见"）。保守：V1.0 只有 trigram 全文 + 线索，没有向量、没有重排、没有查询改写——**这正是主人担心的"换个说法查不到"的那个洞**。
6. **建议改四处**〔推理，依据 ⑥⑦〕：(1) **向量检索提前到 V1.0**，作为第五路进 RRF，同时嵌入条目和原文轮次；默认本地 **Qwen3-Embedding-0.6B**（C-MTEB 检索 71.03，多语检索 64.64 对 BGE-M3 54.60，厂商自报；1024 维可截到 512），线上备选硅基流动 bge-m3；(2) **重排 V1.0 不加**，V1.1 只在慢想的 `recall` 工具上用 Qwen3-Reranker-0.6B 或便宜模型做 A/B，并用"按名次混合"防止重排冲掉字面命中；(3) **不加 PageRank 图投影**，线索倒排一跳已覆盖联想，回放题库证明多跳题失败再加"局部两跳 PPR"一路（实测 20–40 ms）；(4) 第一周就建"召回@k"回放题库，每项改动按数据开关——向量和重排都可能在某类语料上没收益（tigerless 实测向量融合 R@5 +7.6，但答题不涨）。

## ② 来源清单

| # | 来源 | 实际读了什么 | 性质 |
|---|---|---|---|
| S1 | GitHub 搜索 API（未认证），2026-10-28 | 8 批 `repo:` 合并查询拿约 60 个指定仓库的星数、推送、语言、许可；15 组关键词发现查询（返回数百条，agent memory、long-term memory、hippocampus、hebbian、spreading activation、brain-inspired、neural memory、memory mcp、knowledge graph memory、topic:agent-memory、topic:long-term-memory、"长期记忆""记忆系统"、companion）；3 个改名仓库用 core API 跟到新名；mem0 `mem0/memory/` 目录清单 | 一手 |
| S2 | vectorize-io/hindsight（HEAD 源码包） | `engine/search/retrieval.py`、`fusion.py`、`reranking.py`；`engine/memories/pg/recall.py`、`link_expansion.py`、`writes.py`；`engine/retain/fact_extraction.py` 提示词与 `Fact` 模型；`engine/consolidation/prompts.py`；`config.py` 默认值；孤儿观察回扫迁移脚本 | 一手 |
| S3 | supermemoryai/supermemory | README；`apps/docs` 的 concepts（graph-memory、container-tags、how-it-works、user-profiles）、recall/search、self-hosting/overview。引擎二进制闭源，读不到源码 | 一手文档 |
| S4 | thedotmack/claude-mem | `services/worker/SearchManager.ts`、`ProgressiveMemorySearch.ts`、`sdk/prompts.ts` | 一手 |
| S5 | MemPalace/mempalace；arXiv 2604.21284 | `searcher/query.py`、`ranking.py`、`embedding.py`；第三方审计论文 §4 与附录 B | 一手 |
| S6 | plastic-labs/honcho | `models.py`（Collection、Document）、`deriver/enqueue.py`、`utils/search.py`、`dialectic/core.py`、`crud/scope.py` 头注释 | 一手 |
| S7 | MemTensor/MemOS | `tree_text_memory/retrieve/searcher.py`、`recall.py` | 一手 |
| S8 | EverOS（原 EverMemOS）、memU、Memori、OpenViking | EverOS `memory/search/manager.py`、`llm_multiround.py` 头注释、`config/settings.py`；memU README、`app/agentic.py`、`hosts/retrieval.py`；Memori `search/_lexical.py`、`_core.py`；OpenViking README、`retrieve/hierarchical_retriever.py` 开头 | 一手 |
| S9 | 其他仓库 README（项目自述） | TencentDB-Agent-Memory、rohitg00/agentmemory、tigerless-labs/agent-memory、zilliztech/memsearch、Gentleman-Programming/engram、memvid、SimpleMem、MemMachine、m_flow、magic-context、hippo-memory、CaviraOSS/LongMemory、muninndb、NeuralMemory、hive-memory、tobi/qmd、redis/agent-memory-server、openhanako、mira、SillyTavern 扩展 qvink 与 Memory Books | 一手（自述） |
| S10 | MCP 官方 memory server | `servers/src/memory/index.ts` 的 `searchNodes` | 一手 |
| S11 | OpenClaw 文档（npm 包 openclaw@2026.7.1-2 内） | `docs/concepts/memory-builtin.md`、`docs/reference/memory-config.md`；文件清单里的 memory-honcho、memory-qmd、memory-lancedb 文档 | 一手文档 |
| S12 | 论文 HTML 表格与摘要 | HaluMem 2511.03506v3 的主结果表、分类型表、耗时表；MemoryAgentBench 2507.05257 主表与切块表；LongMemEval 2410.10813v2 表 9；BGE-M3 2402.03216 MIRACL 表；Qwen3 Embedding 2506.05176 的 C-MTEB、MMTEB、重排表；摘要：2606.04194、2607.16848、2605.03675、2608.29606 | 一手 |
| S13 | 网页 | CrewAI 记忆文档、Redis 的 LongMemEval 评测页（WebFetch）；搜索：mem0 融资与 AWS、Zep 客户、Letta 与 Bilt、Supermemory 客户、Hindsight 声明、Honcho 基准、Hermes 记忆提供方与内置记忆、ChatGPT 与 Claude 记忆逆向、Mastra 观察式记忆、Anthropic Contextual Retrieval、RAG vs GraphRAG、GraphRAG-Bench | 二手 |
| S14 | 本仓库已有调研 | 记忆调研全文；子调研 memory-oss-source、memory-benchmarks-poisoning、memory-papers-core；05 草稿 §0、§4.1–4.7 | 二手（转引） |
| S15 | 本会话环境 | Claude Code 的 auto-memory：`MEMORY.md` 索引 + 主题文件，模型用文件工具读写，没有向量库 | 一手（观察） |

没读到的：Supermemory 引擎源码（闭源）；TencentDB-Agent-Memory、MemMachine、memvid、SimpleMem 的检索源码（只读 README）；mem0 平台版与 Zep 云的新算法（闭源）；ChatGPT、Claude.ai、Character.AI、Nomi 的实现（无公开代码，只有逆向文章）；AutoGen Teachability、LlamaIndex Memory、LangGraph store、Khoj、Second Me 本次没读源码，按已有知识写，标〔二手〕。

## ③ 全景表

项目名后的标注表示这一行的信息从哪来：〔一〕本次读源码；〔述〕只读 README 或官方文档；〔旧〕引自上一轮读过源码的笔记；〔二〕搜索摘要或第三方文章。"MAB"= MemoryAgentBench 总分（第三方学术，GPT-4o-mini 读者）；"HaluMem"= Medium 子集问答正确率（MemTensor 出品，测别家等于对手测）。"真实产品"：强 = 有可查证的大量真实用户或点名客户；中 = 厂商自述客户、或被热门 agent 当作记忆后端集成；弱 = 论文、演示或个人开发者工具。

### 3.1 专门的记忆项目

| 项目 | ★ / 最近推送 | 语言·许可 | 机制一句话 | 存储 | 写入（谁抽、几次调用） | 检索 | 整理与遗忘 | 来源与隔离 | 评测（自报 / 第三方） | 真实产品 |
|---|---|---|---|---|---|---|---|---|---|---|
| mem0〔旧〕 | 68.0k / 10-26 | Py·Apache | 单次调用只 ADD 事实，向量为主 | 向量库 + SQLite history + 实体库 | 每次 add 1 次（最近 10 条消息 + 10 条相似旧记忆） | 语义门槛 0.1 → 语义 + σ(BM25) + 0.5·实体，top 20；重排默认关 | 开源版无整理、无衰减；矛盾只连边；图与 OpenMemory 已移出主仓〔一 API〕 | user / agent / run；删后 history 留原文 | 自报 LoCoMo 66.9→2026 年 91.6–92.5；MAB 21.1，HaluMem 53.0 | 强：AWS Strands 记忆提供方（公司称"独家"），CrewAI 等原生集成〔二〕 |
| Zep / Graphiti〔旧〕 | 32.3k（zep 5.0k）/ 10-28 | Py·Apache | 双时间知识图（实体 + 事实边 + 情景） | Neo4j / FalkorDB / Kuzu | 每情景多次（抽实体、去重、抽边、判失效） | 余弦 + BM25 + BFS → RRF / MMR / 交叉编码器；默认边混合 RRF | 只失效不删；社区摘要；无淡忘 | group_id；按情景引用级联删 | 自报 LongMemEval 71.2；MAB 24.0，HaluMem 55.5 | 强：Zep 云自报 240+ 客户〔二〕 |
| Letta（含 letta-code）〔旧〕 | 25.3k（letta-code 3.7k）/ 10-18 | Py→TS·Apache | 有状态 agent：核心记忆块常驻 + 归档检索；新版把记忆做成 git 里的 Markdown | git Markdown（MemFS）；旧版 Postgres + pgvector | 反思子 agent 每 25 步或压缩时改文件并提交 | conversation_search 文本 + 语义；agent 自己多轮搜 | 后台反思；无淡忘 | 沙箱隔离各 agent；git 历史可回滚 | 文件法 LoCoMo 74.0（自报）；MemGPT 在 MAB 28.3 | 强：Bilt、11x 等〔二〕 |
| Supermemory〔述〕 | 31.5k / 10-28 | TS·MIT（引擎闭源） | 原子记忆（updates / extends / derives 关系）+ 原文块 + 画像 | 自研图引擎；每个 namespace 一个向量索引 | 摄入时模型抽取，默认成批处理 | 记忆与原文块混合，阈值 0.3；重排、查询改写可选 | `isLatest`；时间型事实到期遗忘 | namespace | 自报"三大基准第一"；HaluMem 54.1 | 强：Cluely、Scira、Composio 等〔二〕 |
| Hindsight〔一〕 | 55.5k / 10-28 | Py·MIT | 事实 / 经历 / 观察 + 实体、语义、因果、时间链接 | Postgres + pgvector | 每块 1 次抽取；后台合并成观察，每批 1 次 | 语义 + BM25 + 图扩展 + 时间臂 → RRF 60 → 交叉编码器 × 新近 / 时间 / 证据 | 观察的增改删由模型判、新旧由代码算；有观察历史 | memory bank + 标签；删文档级联观察 | 自报 LongMemEval 91.4（Gemini-3）/ 83.6（20B）；BEAM 1000 万档 64.1 | 中：Hermes 提供方；"Fortune 500 在用"为自述〔二〕 |
| MemOS〔一 / 旧〕 | 12.2k / 10-27 | Py / TS·Apache | 树形文本记忆 + 偏好 / 工具 / 技能记忆 | Neo4j + 向量 | 抽取 + 后台重组器 | 图（key / 标签）+ 向量 + BM25 + 全文 → 重排 | 状态机、版本链、归档 | user / cube；可见性 | 自报 LoCoMo 75.8、LongMemEval 77.8；自家 HaluMem 67.2 | 中：MemOS 云 |
| cognee〔旧〕 | 32.9k / 10-28 | Py·Apache | 管线建图 + `improve()` 多阶段整理 | SQLite + LanceDB + 嵌入式图 | 多次 | 多种检索类型（向量 + 图补全） | 冲突单独存；按最近访问清理 | 每 dataset 独立库 + ACL；`source_*` 字段 | MAB 20.6 | 中 |
| Memori〔一〕 | 17.1k / 10-03 | Py·未声明 | 包裹 LLM 客户端自动记、自动取 | SQL + FAISS + 云端增强 | 后台（云） | 稠密候选 → 池内 BM25 重排（词法权重 0.15，≤2 词 0.30） | — | 实体 / 进程归属 | 自报 | 中：Memori 云 |
| Honcho〔一〕 | 7.8k / 10-28 | Py·AGPL | "观察者→被观察者"的结论集 + 推理回答 + 做梦 | Postgres + pgvector | 每条消息对每个观察者推导 1 次 | 语义 + 英文全文 RRF 60 + 会话成员时间窗过滤 + 工具循环 | 演绎 / 归纳 / 矛盾层；软删 | workspace / peer / session / scope | 自报 LongMemEval 90.4、LoCoMo 89.9 | 中：Hermes、OpenClaw 后端 |
| Memobase〔述〕 | 2.9k / 01-11 | Py·Apache | 用户画像槽（topic / sub_topic）+ 事件时间线，"像 ChatGPT 背后的记忆" | Postgres | 每用户缓冲，刷新时固定 3 次调用 | 画像常驻 + 事件要点检索 | 画像合并 | user | 自报 LoCoMo "SOTA"；HaluMem 35.3、抽取召回 14.6% | 弱（更新放缓） |
| Redis Agent Memory〔述〕 | 0.3k / 09-18 | Py | 会话记忆（TTL）+ 后台提取长期事实 | Redis 向量 | 后台 | 研究配置：原文混合检索 + 抽取事实 | — | namespace / user / session | 自报 LongMemEval 86.1（README 写 86.5） | 中：Redis 托管产品 |
| LangMem〔旧〕 | 1.7k / 10-28 | Py·MIT | trustcall 抽取 / 打补丁 | LangGraph store | 热路径工具或后台 1 次 | store 语义检索 + 查询模型 | 防抖延迟整理 | namespace 模板 | Mem0 论文复测 58.1 | 弱 |
| MIRIX〔二〕 | 3.5k / 10-28 | Py·Apache | 6 类记忆、多 agent 管理、屏幕活动 | Postgres BM25 + 向量 | 多 agent 多次 | 先生成主题再各类取 10 | — | user | 自报 LoCoMo 85.4；MAB 26.2 | 弱 |
| MemMachine〔述〕 | 3.1k / 10-28 | Py·Apache | 情景 + 画像记忆层 | — | 模型抽取 | 未细读 | — | — | 自报 | 弱 |
| TencentDB Agent Memory〔述〕 | 30.1k / 10-28（2026-04 建） | TS | 团队记忆中枢：对话→原子→场景→画像四层 + Wiki + 代码图 | — | 异步管线逐层蒸馏 | 未细读 | 分层蒸馏 | 团队 / 角色权限 | — | 中：腾讯云 |
| OpenViking〔述〕 | 41.1k / 10-28（2026-01 建） | Py·AGPL | `viking://` 虚拟文件系统；L0 摘要、L1 概览、L2 原文 | 向量库（稠密 + 稀疏）+ 文件 | 会话提交时抽成 Markdown | 稠密 + 稀疏、可选重排、时间衰减；按目录限定范围 | 会话归档 | 目录 / 租户 | 自报 LoCoMo 80–83%（豆包模型） | 中：火山引擎；Hermes 提供方 |
| EverOS（原 EverMemOS）〔一〕 | 13.7k / 10-28 | Py·Apache | Markdown 为真相 + SQLite + LanceDB；用户情景 / 画像与 agent 案例 / 技能两条轨 | Markdown + SQLite + LanceDB | 模型抽取 | 关键词 / 向量 / 混合（jieba BM25 + 稠密 RRF）/ 智能体多轮 | 自演化 | user / agent / app / project / session | 旧版宣传 LoCoMo 92.3%（本次未核实） | 中：EverMind |
| memU〔一〕 | 14.6k / 10-28 | Py | 改成"Wiki 式个人记忆"，宿主 agent 定时写 | SQLite / PG + 向量 | 宿主 agent 后台任务 | 查询嵌入一次，分段 / 文件 / 资源分层排序，最多 5 条 | 定时整理 | 跨 agent | 旧版宣传 LoCoMo 92%（本次未核实） | 中：memu.so |
| claude-mem〔一〕 | 104.0k / 10-29 | TS·Apache | 钩子抓每次工具调用 → 观察者会话写 XML 观察 → 会话摘要 | SQLite FTS5 + Chroma | 每次工具调用 1 次（可跳过） | Chroma 语义优先，FTS5 兜底补足；MCP 三步渐进披露 | 不整理、不遗忘 | 按项目 | 无 | 强（开发者工具） |
| MemPalace〔一〕 | 59.8k / 10-28（2026-04 建） | Py·MIT | 原文逐字存，不抽取；wing / room 元数据 | ChromaDB + SQLite 知识图 | 0 次（确定性） | 向量 n×4 + BM25 并集 → 0.6 向量 + 0.4 BM25 | 只做精确去重 | wing / room | 第三方审计：LongMemEval-S R@5 96.6%、问答约 67% | 弱（开发者工具） |
| agentmemory〔述〕 | 30.0k / 10-28（2026-02 建） | TS·Apache | "LLM Wiki"模式 + 置信度 / 生命周期 | SQLite | — | BM25（默认）+ 向量 + 图 | 生命周期 | — | 自报 LongMemEval-S R@5 95.2（混合）/ 86.2（纯 BM25） | 弱 |
| qmd〔述〕 | 30.7k / 10-15 | TS·MIT | 本地 Markdown 搜索引擎 | SQLite FTS5 + 向量 | 0 | 查询扩展 → BM25 + 向量 → RRF 60 → 前 30 交 Qwen3-Reranker 按名次混合 | — | 集合 | 无 | 中：OpenClaw 实验后端 |
| tigerless agent-memory〔述〕 | 4.4k / 10-27（2026-09 建） | Py·MIT | Markdown 为真相 + FTS5 + 可选向量 | Markdown + SQLite | — | BM25；可选向量 RRF | 夜间提案有上限 | 文件范围 | 自报：加向量 R@5 79.0→86.6，答题不显著 | 弱 |
| memsearch〔述〕 | 2.8k / 10-27 | Py·MIT | Markdown + Milvus，三层召回 | Markdown + Milvus | — | 稠密 + BM25 稀疏 + RRF，可选重排 | 哈希跳过未变内容 | — | — | 弱 |
| engram（Gentleman）〔述〕 | 7.7k / 10-28 | Go·MIT | agent 自己存观察，单二进制 | SQLite FTS5 | agent 显式写 | 全文 | — | 项目 | — | 弱 |
| basic-memory〔述〕 | 4.4k / 10-29 | Py·AGPL | Markdown 知识图（WikiLink、观察、关系） | Markdown + SQLite | agent 写 | 全文（可加向量） | — | 项目 | — | 弱 |
| memvid〔述〕 | 17.2k / 07-14 | Rust·Apache | 单文件记忆格式，内嵌索引 | 单文件 | — | 混合 | — | — | 自报 | 弱 |
| SimpleMem〔述〕 | 3.9k / 07-24 | Py·MIT | 压缩优先 + 混合索引 + 自动调参（EvolveMem） | — | 模型压缩 | 语义 + 关键词 + 元数据 | — | — | 自报 LoCoMo F1 0.613 | 弱 |
| HippoRAG〔旧〕 | 4.1k / 10-06 | Py·MIT | OpenIE 三元组图 + 个性化 PageRank | 图 + 向量 | 每段 1 次 | 三元组过滤 → PPR | 无 | 无 | 一手论文：多跳 +2.9~9.5 F1；MAB 41.6 | 弱（研究） |
| A-MEM〔旧〕 | 1.2k（+作者仓 1.0k）| Py·MIT | 笔记 + 链接 + 写时演化邻居 | 向量 | 每条 1–2 次 | 向量 + 链接 | 写时改邻居 | 无 | Mem0 复测 J 48.4 | 弱 |
| MemoryBank〔旧〕 | 0.5k / 2023-05 | Py·MIT | 遗忘曲线 + 每日摘要 + 画像 | FAISS | 每日摘要 | 向量 | R = e^(−t/S) | 无 | 自建小测 | 弱（停更） |
| neo4j-labs agent-memory〔述〕 | 0.6k / 10-27（2026-01 建） | Py·Apache | 图原生记忆：对话入库、建知识图 | Neo4j | — | 未细读 | — | — | — | 弱 |
| mcp-memory-service〔述〕 | 2.1k / 10-28 | Py·Apache | 给 Claude 和 agent 管线用的持久记忆服务，REST + 知识图 | — | — | 未细读 | — | — | — | 弱 |
| Memary〔二〕 | 2.7k / 2024-10 | Py·MIT | 知识图 + 记忆流 | Neo4j | — | 图 | — | — | — | 弱（停更） |
| MemoRAG〔二〕 | 2.3k / 2025-09 | Py·Apache | 全局记忆模型先生成线索再检索 | 压缩 KV + 向量 | — | 线索引导检索 | — | — | MAB 30.9 | 弱（停更） |
| LightMem〔旧〕 | 1.2k / 10-26 | Py·MIT | 预压缩 + 主题分段 + 夜间更新 | 向量 | 白天软插入 | 向量 | 离线、只许新改旧 | — | 自报 token 降 10–38 倍 | 弱 |
| Nemori〔旧〕 | 0.2k / 04-16 | Py·MIT | 事件边界分段 + 预测—校准 | — | 模型 | — | — | — | 自报 LoCoMo 80.8 | 弱 |
| MemoryOS（BAI）〔二〕 | 1.6k / 07-07 | Py·Apache | 短 / 中 / 长期画像 + 热度晋升 | 向量 | 模型 | 向量 + 热度 | 热度淘汰 | user | 自报 | 弱 |
| livingmemory（AstrBot）〔旧〕 | 0.4k / 10-28 | Py·AGPL | 记忆原子 + 实体图 + 按类型寿命 | SQLite FTS5 + FAISS + NetworkX | 按轮数总结 | BM25（jieba + 二元组）+ 向量 + 图；0.5 相关 + 0.25 重要 + 0.25 新近 | 每日衰减、清理 | 会话 / 人格 | 无 | 中：AstrBot 社区 |
| m_flow〔述〕 | 4.5k / 09-01 | Py·Apache | 四层"锥形图"，向量找入口后沿边传播"路径代价" | 图 + 向量 | 模型 | 图为主 | — | — | 自跑 LoCoMo-10 81.8%（同条件 Cognee 79.4、Zep 73.4–78.4、Supermemory 64.4） | 弱 |
| LongMemory（原 CaviraOSS OpenMemory）〔述〕 | 4.5k / 10-18 | TS·Apache | Hydrograph 图：不可变节点 + 激活 / 衰减 / 再巩固 | SQLite | — | 语义 + 词法 + 实体 + 激活 + 图 | 确定性衰减 | ACL | 自称"可审计基准" | 弱 |
| muninndb〔述〕 | 0.3k / 10-27 | Go | 赫布连边 + 艾宾浩斯衰减 + 预测激活（已申请专利） | 自研 | 自动 | 全文 + 向量 + 赫布 | 自动衰减 | — | 自报工作流场景 Recall@10 +21% | 弱 |
| NeuralMemory〔旧〕 | 0.2k / 10-23 | Py·MIT | "神经元 + 纤维"图，不用嵌入，扩散激活 | 图 | 0 | 扩散 | — | — | 自测 R@5 0.380，输给朴素基线 0.466 | 弱 |
| Hillock / hive-memory〔述〕 | 0.2k / 5 | Py | 超维计算 + 赫布；SQLite + bge-m3 + 扩散激活 + 侧抑制 | — | — | 扩散 | — | — | 自测 | 弱 |
| hippo-memory〔述〕 | 0.8k / 10-29 | TS·MIT | 品牌"像大脑"，实为 SQLite + BM25（默认）+ 可选向量与交叉编码器 | SQLite + Markdown 镜像 | — | BM25 | "睡眠"时按词重合合并、衰减 | 项目 | 自报 LongMemEval oracle R@5 74.0（纯 BM25） | 弱 |

### 3.2 宿主自带的记忆（记忆是框架或产品的子系统）

| 宿主 | ★ / 最近推送 | 做法 | 真实产品 |
|---|---|---|---|
| OpenClaw〔述 / 旧〕 | 393.3k / 10-29 | `MEMORY.md` 与 `memory/*.md` 按 400 token、80 重叠分块进每个 agent 的 SQLite；FTS5 BM25（中日韩用 trigram）+ 向量，权重 0.7 / 0.3，候选 ×4，最多 6 条、最低分 0.35；MMR（λ 0.7）与时间衰减（半衰期 30 天）可开；夜里 dreaming 晋升；可换 qmd、Honcho、LanceDB 后端 | 强 |
| Hermes Agent〔二〕 | 258.1k / 10-29 | `MEMORY.md`（2200 字符）+ `USER.md`（1375 字符）开会话时快照进系统提示；会话存 SQLite FTS5，由 agent 显式调用 session_search；可另开一个外部提供方（Honcho、OpenViking、Mem0、Hindsight、Holographic、RetainDB、ByteRover、Supermemory） | 强 |
| Claude Code〔一 观察〕 | 闭源 | `CLAUDE.md` + auto-memory（`MEMORY.md` 索引 + 主题文件），模型用文件工具读写，无向量 | 强 |
| Claude.ai〔二〕 | 闭源 | 不预载档案；需要时调用 conversation_search / recent_chats 工具搜原聊天，带引用；另有按主题保存的记忆 | 强 |
| ChatGPT〔二〕 | 闭源 | 逆向文章称：保存的记忆 + 近期对话标题与摘要常驻注入，不做 RAG | 强 |
| Mastra 观察式记忆〔二〕 | mastra 29.2k / 10-29 | 观察者、反思者两个后台 agent 把对话压成带日期的观察日志常驻上下文（平均约 3 万 token），不检索；自报 LongMemEval-S 84.23（gpt-4o）/ 94.87（gpt-5-mini），Redis 复测 84.2 | 中 |
| SillyTavern〔述 / 二〕 | 35.1k / 10-02 | 内置 Vector Storage（消息与资料库向量化）+ 摘要；扩展 Memory Books（场景→可编辑的世界书条目，★325）、qvink（逐条摘要，短期轮换、长期手动标记，不用嵌入，★168） | 强（社区） |
| 麦麦 MaiBot〔旧〕 | 6.7k / 10-28 | A_Memorix：向量 + BM25 加权 RRF，PPR 融合权重 0.15，后验图默认关；"海马体"已弃用 | 强（QQ 社区） |
| CrewAI〔二 文档〕 | 60.2k / 10-28 | LanceDB；模型抽取并推断范围与重要度；分数 = 0.5 语义 + 0.3 新近（半衰期 30 天）+ 0.2 重要；长查询（≥200 字符）先让模型分析；相似 ≥0.85 时模型决定保留 / 更新 / 删除；私有记录只对同来源可见 | 中 |
| LangGraph / LlamaIndex / AutoGen〔二〕 | 44.1k / 52.7k / 61.6k | LangGraph：命名空间 store + 可选语义索引；LlamaIndex：SQL 短期 + 静态 / 事实抽取 / 向量记忆块；AutoGen Teachability：把"教训"存向量库检索，框架已进入维护期 | 中 / 中 / 弱 |
| MCP 官方 memory server〔一〕 | servers 91.6k | JSONL 存实体、关系、观察；`searchNodes` 是大小写不敏感的子串匹配，再带上一端命中的关系 | 强（MCP 常用） |
| Khoj / Second Me / WeClone〔二〕 | 37.9k / 15.7k / 18.3k | Khoj：文档 RAG（双塔 + 交叉编码器重排）；Second Me（2025-09 后停更）、WeClone：用个人数据微调"分身"模型 | 中 / 弱 / 弱 |
| openhanako / mira〔述〕 | 6.9k / 0.5k | 同类"数字人"项目：openhanako 中文个人 agent，better-sqlite3，小 / 大工具模型做记忆编译（作者自述"近期记得牢，有待优化"）；mira 第一人称记忆痕迹 + 衰减公式 + 每轮"皮层下"检索做指代消解 | 弱 |

## ④ 前 10 个"最好的"精读

### 4.0 怎么选的

"最好"按三条合起来判：第三方或可复现的基准成绩、真实产品采用、工程成熟度（活跃度、测试、迁移脚本、文档）。上一轮读过源码的四个（OpenClaw、mem0、Zep/Graphiti、Letta）只引用旧笔记；其余六个本次读检索和写入的源码或文档。cognee（★3.3 万，MAB 20.6）上一轮已读，这里不展开。

| # | 项目 | 第三方 / 可复现评测 | 真实产品采用 | 工程成熟度 | 本次怎么读 |
|---|---|---|---|---|---|
| 1 | OpenClaw 记忆 | 无公开记忆评测 | 极强：39.3 万星宿主默认开启 | 高：文档全、后端可换 | 旧笔记 + 本次文档 |
| 2 | mem0 | MAB 21.1、HaluMem 53.0（偏低） | 强 | 高 | 旧笔记 + API 核目录 |
| 3 | Zep / Graphiti | MAB 24.0、HaluMem 55.5 | 强 | 高 | 旧笔记 |
| 4 | Letta | 文件法 LoCoMo 74.0（自报）；MemGPT 在 MAB 28.3 | 强（Bilt） | 高 | 旧笔记 |
| 5 | Hindsight | 自报（"合作方复现"未核实）；BEAM | 中（Hermes 提供方） | 高：迁移脚本、系统评测、多语言客户端 | 本次精读源码 |
| 6 | Supermemory | HaluMem 54.1 | 强 | 中：引擎闭源 | 本次读文档 |
| 7 | Honcho | 自报 | 中（Hermes、OpenClaw 后端） | 高 | 本次精读源码 |
| 8 | MemOS | 自家 HaluMem 67.2 | 中 | 中 | 本次读检索路径 |
| 9 | claude-mem | 无 | 强（开发者） | 中高 | 本次精读源码 |
| 10 | MemPalace | 第三方审计复现 | 弱中 | 中 | 本次精读源码 + 审计论文 |

### 4.1 OpenClaw 记忆〔旧 + 一手文档〕

- **检索**：每个 agent 一个 SQLite；`MEMORY.md` 与 `memory/*.md` 切成 400 token、80 重叠的块；FTS5 BM25（中日韩走 trigram）+ 向量（sqlite-vec，加载失败退回进程内余弦），加权 0.7 向量 / 0.3 文本，候选 ×4，最多 6 条、最低分 0.35；MMR（λ 0.7）与时间衰减（半衰期 30 天）文档默认关、示例里打开〔一手 `memory-config.md`〕。上一轮读过 `hybrid.ts`、`temporal-decay.ts` 和来源表（owner / agent / untrusted / system）〔旧〕。
- **写入**：agent 自己写 Markdown（会话转写、压缩前写回）；dreaming 每晚把"被召回 ≥3 次、来自 ≥3 个不同问题、分数 ≥0.75"的短期条目晋升，不可信来源不能晋升〔旧〕。
- **兜底**：`memory_search` 工具；Active Memory 只在"有回忆意图、规则通道没命中"时跑召回子 agent〔旧〕。
- **隔离与删除**：按 agent 分库；文件是真相，删文件后索引重建〔推理〕。后端可换 qmd（BM25 + 向量 + LLM 重排）、Honcho、LanceDB、memory-wiki〔一手文件清单〕。
- **对灵鲸**：同是 Node + `node:sqlite` + 本机运行，最该对齐的参照。它第一版就把向量和全文放在一起，权重偏向量。

### 4.2 mem0〔旧〕

- **写入**：`mem0/memory/main.py` 的 `_add_to_vector_store`：取最近 10 条消息 + 作用域内 10 条相似旧记忆（UUID 换成整数编号防幻觉），单次调用 `ADDITIVE_EXTRACTION_PROMPT`，只做 ADD，MD5 去重；矛盾只连边、不消解。本次用 API 核实：`mem0/memory/` 里已没有图记忆文件，主仓根目录也没有 OpenMemory 了〔一手〕。
- **检索**：语义门槛 0.1 → (语义 + sigmoid(BM25) + 0.5·实体) / 最大可能分，top_k 20，重排默认关；BM25 只加分、不扩大召回〔旧〕。
- **隔离与删除**：user / agent / run 必须写进 filters；删除后 history 表仍留旧原文〔旧〕。
- **生产**：自称数千团队在用；AWS Strands Agent SDK 的记忆提供方（公司称"独家"，Sacra 指出 AWS 自己也有 AgentCore Memory）；2025-10 融资 2400 万美元〔二手〕。
- **评测**：论文自报 LoCoMo 66.9；2026 年新算法自报 LoCoMo 91.6–92.5、LongMemEval 93.4–94.4（不同页面口径不一）；第三方 MAB 21.1、HaluMem 53.0〔一手表 / 二手〕。语义门槛先卡掉候选、BM25 救不回来，和它在第三方测试里偏低吻合〔推理〕。
- **对灵鲸**：整数编号映射、按观察日期解析相对时间可借；"只 ADD 不消解""删了还留原文"不能借。

### 4.3 Zep / Graphiti〔旧〕

- **写入**：`add_episode`：抽节点（说话人强制为实体）→ 先确定性去重（精确或 MinHash ≥0.9）不行再交模型 → 抽边 → 只在同一对端点之间找重复、另找失效候选 → 模型判重复 / 矛盾 → 代码写 `invalid_at`；每个情景要调多次模型〔旧〕。
- **检索**：cosine、BM25、BFS（深度 3）三路，重排可选 RRF、MMR、节点距离、情景提及数、交叉编码器；默认 `EDGE_HYBRID_SEARCH_RRF`；`sim_min_score` 0.6〔旧〕。
- **隔离与删除**：只有 group_id；`remove_episode` 按情景引用计数级联删边、删孤立节点、重建摘要〔旧〕。
- **生产与评测**：Zep 云自报 240+ 客户，点名 AWS、Samsung、Writer、HoneyBook 等；451 Research 称 ARR 接近 100 万美元〔二手〕。自报 LongMemEval 71.2（gpt-4o）；第三方 MAB 24.0、HaluMem 55.5〔一手表〕。另一篇第三方研究（2607.16848）发现它在论文记忆基准上的领先靠每问 260 万字符的上下文，控制检索预算后消失〔一手摘要〕。
- **对灵鲸**：双时间、情景回指、"只有新事实明确推翻旧事实才算矛盾"已经采纳；图数据库和每条多次调用不借。

### 4.4 Letta〔旧〕

- **存储**：letta-code 把记忆做成 git 里的 Markdown（MemFS），根目录文件常驻进提示（合计 ≤6.5 万字符），子目录只列索引。
- **写入**：反思子 agent 每 25 步或压缩时，按"更正 > 偏好 > 新事实 > 矛盾 > 流程"改文件并提交。
- **检索**：`conversation_search` 文本 + 语义混合，可按角色、日期过滤，默认 5 条；主要靠 agent 自己多轮搜。Letta 博客的实验只给 grep 和文件语义搜索，LoCoMo 74.0〔旧，自报〕。
- **隔离**：沙箱让子 agent 读不到别的 agent 的记忆〔旧〕。
- **生产**：Bilt 用它跑"百万 agent"推荐，改一个共享记忆块就改变几十万个 agent 的行为；客户还有 11x、Kognitos〔二手〕。
- **对灵鲸**：自我模型的渲染、"改动下个会话生效"已借；"让模型自己搜"就是灵鲸的 `recall` 工具。

### 4.5 Hindsight〔一手〕

- **检索**：`engine/search/retrieval.py` 的 `retrieve_all_fact_types_parallel` 先抽时间范围（`resolve_temporal_constraint`；有 `chinese_temporal_periods.py` 处理中文时间说法），再把每类事实（world / experience / observation）交给存储层 `recall_unified` 并行跑四路：① 语义（pgvector HNSW，按事实类型分区索引）；② BM25（和语义在同一条 UNION 查询里，`retrieve_semantic_bm25_combined_sql`）；③ 图（`link_expansion.py`：从语义种子出发，沿"共享实体"（每个实体最多展开 200 条，防热门实体爆炸）、写入时预计算的语义近邻边、因果边（加 1 分）扩展）；④ 时间臂（`retrieve_temporal_combined_sql`：时间窗内按相似度取入口、保证覆盖整个时间窗，再沿时间 / 因果链接扩散，每个源 10 个邻居、最多 5 轮，分数逐跳衰减）。
- **融合与重排**：`fusion.py` 的 `reciprocal_rank_fusion`（k=60），融合前每路先截断，免得一路挤掉别的；整理去重时改用 `interleave_fusion`（轮流取各路第一名——注释说 RRF 会把"语义第一、别的路没有"的近似双胞胎排到后面，导致建出重复）；`reranking.py` 的 `apply_combined_scoring`：交叉编码器分为主（默认最多重排 300 个候选），乘新近（±10%，默认一年线性衰到 0.1）、时间接近度（±10%）、证据数（±5%）。默认嵌入 `BAAI/bge-small-en-v1.5`（384 维）、重排 `cross-encoder/ms-marco-MiniLM-L-6-v2`，都是英文小模型，可换 TEI、Cohere、SiliconFlow 等〔一手 `config.py`〕。
- **写入**：`fact_extraction.py` 的 `_BASE_FACT_EXTRACTION_PROMPT`：只抽"6 个月后还有用"的事实；五维 what / when / where / who / why；指代消解成"Emily（用户的室友）"；相对时间一律换成绝对日期；区分 world（含用户偏好与更正）和 assistant 自己做过的事；附实体列表；每块 1 次调用。之后后台把事实并进"观察"（`consolidation/prompts.py`）：模型只能 UPDATE / CREATE / DELETE，规则写明"优先更新、不建近似兄弟""不做算术""按 mentioned_at 判新旧"，并且**新旧由代码先比好、标 `newer_than_input_facts`**——注释说小模型会读错时间、让旧规则覆盖新修订〔一手〕。
- **隔离**：memory bank（bank_id）+ 标签 / 标签组；时间窗和标签条件在每一路（包括扩散）里重复施加，防止扩散把窗外邻居带进来〔一手〕。
- **删除**：`writes.py` 的 `delete_document` 连带删事实和只依赖它们的观察（`delete_stale_observations`）；2026-03 的迁移脚本专门回扫"所有来源都已删除的孤儿观察"，说明早期版本漏过〔一手〕。
- **评测与生产**：自报 LongMemEval-S 91.4（Gemini-3 Pro）、83.6（开源 20B 模型，同模型全上下文 39.0）；BEAM 1000 万 token 档 64.1；ACL 2026 demo 论文，合作者有华盛顿邮报和弗吉尼亚理工；Hermes Agent 的 8 个记忆提供方之一；"Fortune 500 在用"是自述〔二手〕。
- **对灵鲸**：最值得借的是"多路召回、每路截断、RRF、乘法微调"的结构，和"时间先后交给代码"；英文默认模型、Postgres 依赖不借。

### 4.6 Supermemory〔一手文档，引擎闭源〕

- **模型**：文档（原始输入，供 RAG）与记忆（抽出的原子事实）分开；记忆之间有 updates（新事实取代旧的，旧的留作历史）、extends、derives（推出的新事实）三种关系，`isLatest` 让检索只拿当前版本；时间型事实（"明天考试"）到期自动遗忘。
- **写入**：摄入时模型抽取；默认 `dreaming: "dynamic"` 把相关文档凑成一批再抽。
- **检索**：`searchMode: "hybrid"`（默认）同时搜记忆和原文块；`threshold` 默认 0.3（v4 是 0.6）；`rerank` 可选（"order" 约多 100 ms）；`rewriteQuery` 可选（生成多个改写分别搜再合并）；`limit` 默认 10；用户画像分 static（长期事实）与 dynamic（近况），约 50 ms。
- **隔离与删除**：namespace（原 containerTag），每个 namespace 背后是独立的向量索引。记忆的 `forget` 是软删（检索默认排除，但保留）；还能"按意思遗忘"——给一句"忘掉关于某项目的一切"，服务端语义检索、由模型挑出相关记忆，先 dryRun 预览再按编号执行；原文档另有删除接口〔一手文档〕。
- **自托管**：单个闭源二进制，本地默认嵌入 `Xenova/bge-base-en-v1.5`（英文）；托管版用自研模型。
- **评测与生产**：README 自称 LongMemEval、LoCoMo、ConvoMem"全部第一"；HaluMem（对手测）54.1；客户有 Cluely、Montra、Scira、Composio 等（2025）；2026-09 停掉"company brain"和 Nova 两个产品、专做记忆引擎〔二手〕。
- **对灵鲸**："记忆 + 原文块同查""isLatest""静态 / 动态画像"和 05 草稿的版本链、`raw_fts`、印象摘要"稳定 / 近况"分段一致；闭源引擎不可依赖。

### 4.7 Honcho〔一手〕

- **模型**：结论存在 `Collection(observer, observed, workspace)` 里，意思是"A 对 B 知道什么"；`Document.level` ∈ explicit / deductive / inductive / contradiction，带 `times_derived`、指回消息的 `source_links`、软删的 `deleted_at`（`models.py`）。
- **写入**：`deriver/enqueue.py`：每条消息的观察者 = 发言者自己（observe_me）+ 会话里开了 observe_others、且仍在场的其他 peer；为这些观察者各推导一次。抽取提示词（`deriver/prompts.py` 的 `minimal_deriver_prompt`）把每条消息包成带 idx、peer、target、time 的标签（并转义正文里伪造的标签），只从 target 本人说的话里抽"显式原子事实"，**明确禁止根据别人说的话给 target 下结论**，相对时间换成绝对时间。dreamer 后台做演绎、归纳、找矛盾。
- **检索**：`utils/search.py`：pgvector 语义 + Postgres 全文（`to_tsvector("english")`）→ `reciprocal_rank_fusion`（k=60）；`_filter_by_peer_perspective` 只保留"该 peer 当时在场、时间在 joined_at 与 left_at 之间"的会话消息；回答走 `dialectic/core.py` 的工具循环（多轮检索，先预取相关观察）。
- **隔离**：workspace / peer / session / scope（scope 是一个只观察不说话的特殊 peer，`crud/scope.py`）。
- **评测与生产**：自报 LongMemEval-S 90.4、LoCoMo 89.9（摄入用 gemini-2.5-flash-lite，回答用 claude-haiku-4-5）；Hindsight 的博客称它在 BEAM 1000 万档只有 40.6；Hermes 提供方之一，OpenClaw 文档里有 Honcho 后端〔二手 / 一手文件清单〕。
- **对灵鲸**：**全景里最接近"受众"的设计**。差别有三：它回答"谁知道什么"（心智模型），灵鲸要回答"当着谁能说什么"；它在检索之后才过滤（先取 top-k 再滤会掉召回），灵鲸先裁受众再打分；派生结论没有"受众取交集"。它的全文用英文分词配置，照搬到中文查不到。

### 4.8 MemOS〔一手检索路径 + 旧〕

- **检索**：`searcher.py` 的 `Searcher.search` 按 WorkingMemory / LongTermMemory / UserMemory 分区；`recall.py` 的 `GraphMemoryRetriever.retrieve` 并行四路：图召回（`task_goal_parser` 先让模型把查询解析成 keys / tags，key 精确匹配或标签重合 ≥2）、向量、BM25、全文，合并后默认重排；偏好、工具、技能记忆各取 6 / 6 / 3 条。
- **写入与整理**：条目有状态机、版本链、来源、可见性；后台"重组器"把近邻聚类写父节点，关系检测器两两判冲突〔旧〕。
- **评测**：自报 LoCoMo 75.8、LongMemEval 77.8；在自家 HaluMem 上 67.2，别家在 35–56〔一手表 / 旧〕。
- **对灵鲸**："模型把查询解析成关键词再精确命中"这一路，等于让模型临时生成线索；灵鲸用确定性的线索词典做同样的事，零调用。

### 4.9 claude-mem〔一手〕

- **写入**：Claude Code 钩子把每次工具调用（名字、输入、输出）送给后台"观察者"会话（Agent SDK），按 `sdk/prompts.ts` 的 XML 模板写 `<observation>`（type、title、subtitle、facts、narrative、concepts、files_read / files_modified），没价值就回 `<skip_summary/>`；会话结束写摘要。
- **检索**：`SearchManager.ts`：Chroma 语义检索优先，失败或没结果退回 SQLite FTS5，按日期排序时把两边合并；`ProgressiveMemorySearch.ts` 做"渐进披露"三步——先给标题索引（取一整窗候选，再按标题词重排，防止字面命中被切掉）、再按锚点看前后时间线、最后按编号取详情，由模型通过 MCP 工具决定看多少。
- **整理、隔离与删除**：不合并、不遗忘；默认取 20 条、Chroma 每批 100；按项目隔离，服务器版按（项目, 团队）限定，删观察时来源链接级联删除。向量库是单独的 Python 进程（chroma-mcp），`supervisor/orphan-chroma-sweep.ts` 的注释记录了进程被强杀后孤儿进程累积到 600–800 对、吃掉几十 GB 交换区的事故。
- **生产**：10.4 万星，Claude Code 用户里最流行的记忆插件之一，没有公开评测〔推理〕。
- **对灵鲸**：灵鲸的大脑就是 Claude Code / Codex，"索引 → 时间线 → 详情"三步工具正好适合慢想的 `recall`；每次工具调用压缩一次太贵，不借。

### 4.10 MemPalace〔一手 + 第三方审计〕

- **写入**：确定性、零模型调用：`convo_miner.py` 的 `chunk_exchanges` 按一问一答切块、`detect_convo_room` 按关键词归房间，原文逐字存进 ChromaDB，另有 SQLite 知识图和有损压缩"AAAK"。删除只有存储后端的按 id / 条件删，没有派生物级联的概念。
- **检索**：`searcher/query.py` 的 `search_memories`：向量取 n×4 候选，BM25 候选并进来，按 closet 命中给 0.40 / 0.25 / 0.15 / 0.08 / 0.04 加分；`ranking.py` 的 `_hybrid_rank` 最终分 = 0.6×向量相似 + 0.4×归一化 BM25，默认返回 5 条。默认嵌入 all-MiniLM-L6-v2（只用英文训练），`embedding.py` 注释建议非英文换 embeddinggemma。
- **审计（arXiv 2604.21284，第三方）**：96.6% 是 LongMemEval-S 的 recall_any@5，**光用 ChromaDB 默认配置 + 原文就能复现，宫殿结构不需要**；端到端问答约 67.2%；"100%"是看着错题迭代 LLM 重排得来，维护者已改报留出集 98.4%；AAAK 掉到 84.2%；文档宣称的"语义矛盾检测"代码里只是精确去重；LoCoMo 的"100%"用 top_k=50 等于把整段对话取回，正常 k 下 R@10 原文 60.3%、混合 + LLM 重排 88.9%。
- **对灵鲸**：两条硬结论——原文必须留着当检索键（经历流 + `raw_fts` 已满足）；花哨的组织结构不等于检索准确。

## ⑤ 主流做法归纳与统计

### 5.1 专门记忆项目的分类统计〔推理：分类是我的判断，星数为一手〕

口径：3.1 表的 46 个项目，加上 3.2 里 SillyTavern 的两个记忆扩展（Memory Books 与 qvink 合计一个），共 47 个专门记忆项目（Graphiti 与 zep、A-MEM 两个仓各合并计），星数合计 69.6 万；宿主项目（OpenClaw、Hermes、SillyTavern 等）不计入星数，单列在 5.2。每个项目只归一个主类。"真实产品"沿用 ③ 的强 / 中 / 弱。

| 维度 | 类别 | 项目数 | 星数 | 占比 | 真实产品 强 / 中 / 弱 | 代表 |
|---|---|---|---|---|---|---|
| 存什么 | 抽取的事实条目 | 17 | 31.5 万 | 45.2% | 3 / 5 / 9 | mem0、Hindsight、Supermemory、claude-mem、MemOS、Memori |
| | 文件为真相（agent 写 Markdown / Wiki，索引是投影） | 10 | 17.1 万 | 24.5% | 1 / 4 / 5 | Letta、OpenViking、TencentDB、EverOS、memU、agentmemory |
| | 原文分块（不抽取） | 4 | 11.0 万 | 15.8% | 0 / 1 / 3 | MemPalace、qmd、memvid、MemoRAG |
| | 三元组 / 时序图谱 | 5 | 7.8 万 | 11.1% | 1 / 1 / 3 | Graphiti / Zep、cognee、HippoRAG、Memary |
| | 摘要 / 画像 | 5 | 1.3 万 | 1.9% | 0 / 2 / 3 | Honcho、Memobase、MemoryBank |
| | 神经元 / 扩散 / 赫布 | 6 | 1.0 万 | 1.4% | 0 / 0 / 6 | m_flow、LongMemory、muninndb、NeuralMemory |
| 怎么查 | 混合（全文 / BM25 + 向量），含加重排、加智能体 | 25 | 52.9 万 | 76.1% | 3 / 10 / 12 | Hindsight、Supermemory、Graphiti、claude-mem、MemOS、Honcho |
| | 向量为主（BM25 至多在候选内加分） | 10 | 10.9 万 | 15.7% | 1 / 2 / 7 | mem0、Memori、memU、LangMem、A-MEM |
| | agent 自己用工具搜 | 1 | 2.9 万 | 4.2% | 1 / 0 / 0 | Letta |
| | 只用全文 | 3 | 1.3 万 | 1.8% | 0 / 0 / 3 | engram、basic-memory、hippo-memory |
| | 图为主（PPR / 扩散 / 路径代价） | 6 | 1.2 万 | 1.7% | 0 / 0 / 6 | HippoRAG、m_flow、NeuralMemory、Memary |
| | 常驻注入、不检索 | 2 | 0.3 万 | 0.5% | 0 / 1 / 1 | Memobase、SillyTavern 摘要扩展 |
| 怎么整理 | 后台 / 离线 | 20 | 28.9 万 | 41.5% | 1 / 9 / 10 | Hindsight、Letta、Honcho、MemOS、OpenViking |
| | 不整理 | 12 | 23.6 万 | 34.0% | 1 / 2 / 9 | claude-mem、MemPalace、qmd |
| | 写入时在线判 | 15 | 17.1 万 | 24.5% | 3 / 2 / 10 | mem0、Graphiti、Supermemory、Memori、MIRIX |

读法：混合检索是压倒性的主流；图为主和神经元类加起来不到 3% 的星数，且没有一个"强"。"抽取条目 + 混合检索"是托管服务的主流，"文件为真相 + 混合检索"是 2026 年个人 agent 与编码 agent 的主流。

### 5.2 有真实用户的系统都在怎么做〔一手文档 / 二手〕

把"强"和"中"里用户最多的拿出来：OpenClaw、Hermes、Claude Code、Claude.ai、ChatGPT、SillyTavern、麦麦、AstrBot、CrewAI、Mastra、MCP 官方 memory、mem0、Zep、Letta、Supermemory、claude-mem、Hindsight、Honcho、OpenViking、MemOS，共 20 个。

- **文件为真相 + 全文（+ 向量）**：OpenClaw、Hermes、Claude Code、Letta——个人 agent 的默认形态。
- **常驻注入、不检索或少检索**：ChatGPT（保存的记忆 + 近期对话摘要）、Mastra 观察式记忆、Hermes 的快照、Letta 的核心块。
- **工具检索（让模型自己搜）**：Claude.ai 的 conversation_search、Hermes 的 session_search、Letta、claude-mem、Honcho 的推理回答。
- **抽取条目 + 向量 / 混合**：mem0、Supermemory、Hindsight、MemOS、CrewAI、SillyTavern 的 Vector Storage。
- **图**：Zep / Graphiti（图是主存储，但默认检索是边上的 BM25 + 向量 RRF）、麦麦 A_Memorix（PPR 权重 0.15）、MCP 官方 memory（JSONL + 子串匹配）。

**特别回答一：神经元图谱 / 扩散激活有没有在有真实用户的产品里长期在用？没有找到。** 麦麦 0.5–0.10 的"海马体"是唯一上过大量真实用户的，0.10.1 起被禁用、1.0 换成 A_Memorix〔旧〕。2026 年冒出的十几个"类脑"项目（3.1 表最后几行）都是开发者工具或研究原型，星数最多的 m_flow、LongMemory 也只有 4500 左右，评测全部自报。产品里的"扩散"只以辅助通道出现：Hindsight 时间臂的有界扩散（RRF 四路之一，后面还有重排）、Graphiti 可选的 BFS。

**特别回答二："图谱 + PageRank"在产品里的占比：上面 20 个里只有 A_Memorix 一个（约 5%），而且只占融合权重 0.15、后验图补位默认关。** HippoRAG、fast-graphrag（★4.0k，最近推送 2025-11）用 PPR，但都是研究或文档 RAG 工具。产品里用图，多半是为了"版本 / 关系 / 可视化"，不是为了排序：Supermemory 用 updates 关系决定 `isLatest`，Zep 用失效边做更正历史，livingmemory、OpenViking、Supermemory 都做了图可视化〔推理〕。mem0 开源版 2026 年把图记忆整个删了（本次 API 核实）；HaluMem 里 Mem0 图版只比普通版高 1.6（Medium）/ 4.3（Long）个点〔一手表〕。

### 5.3 2026 年的三个新动向

1. **"Markdown / 文件为真相 + 派生索引"成了新主流**：OpenClaw、Hermes、letta-code、Claude Code，加上今年转型的 EverOS（原 EverMemOS）、memU（改成 Wiki），新起的 OpenViking、TencentDB、agentmemory、memsearch、tigerless、basic-memory。理由几乎一样：人能看、能改、能 diff，索引坏了可重建〔一手自述〕。这和灵鲸"经历流是唯一真相、记忆是可删可重放的投影"是同一个思路，灵鲸更严格（事件溯源、带受众）。
2. **编码 agent 记忆爆发**：claude-mem（10.4 万星）、agentmemory、engram、beads、context-mode 等，套路是"钩子抓工具调用 + 小模型压缩 + SQLite FTS5 / 向量 + MCP 渐进披露"〔一手 / 自述〕。
3. **基准被刷到 90%+，同时出现审计与反思**：LongMemEval-S、LoCoMo 上自报 90% 以上的已有 Hindsight、Honcho、Mastra、mem0、Agent Zero Memory（2608.29606：95.6 / 93.6）等；第三方审计 MemPalace、LoCoMo 答案表错 6.4%〔旧〕；更难的 BEAM（百万到千万 token）出现；研究开始强调"控制检索预算再比较"（2607.16848）。自报数字之间基本不可比〔推理〕。

## ⑥ "查询准确"大家怎么保证

### 6.1 前 10 个项目的实际手段〔一手源码 / 文档，前四行为旧笔记〕

| 项目 | 换个说法也能查到 | 硬线索不漏（字面 / 实体 / 时间） | 漏了怎么兜底 | 默认嵌入 / 重排 |
|---|---|---|---|---|
| OpenClaw | 向量（权重 0.7） | FTS5 BM25（0.3，中日韩 trigram）；可开时间衰减 | `memory_search` 工具；Active Memory 召回子 agent | 自动探测云端嵌入，可本地 GGUF；内置无重排，qmd 后端有 LLM 重排 |
| mem0 | 向量（门槛 0.1） | BM25 与实体只加分，不扩召回 | 无；重排默认关 | 可配 |
| Zep / Graphiti | 余弦 | BM25 + 实体节点 + BFS；有效期过滤 | 交叉编码器可选 | 论文实验用 BGE-m3 |
| Letta | 归档语义检索 | conversation_search 文本 + 语义，按角色 / 日期过滤 | agent 自己多轮 grep / 搜 | 可配 |
| Hindsight | 语义臂 | BM25 臂 + 实体链接臂 + 时间臂（含中文时间说法解析） | 交叉编码器 + reflect 工具 | bge-small-en / ms-marco-MiniLM（英文，可换） |
| Supermemory | 记忆与原文块混合 | 元数据过滤、`isLatest` | 查询改写、重排（均可选）；MCP | 托管自研；本地 bge-base-en |
| Honcho | pgvector 语义 | 英文全文；成员时间窗过滤 | 推理回答的工具循环 | 可配 |
| MemOS | 向量 | BM25 + 全文 + key / 标签精确命中（模型解析查询） | 默认重排；可选联网检索 | 可配 |
| claude-mem | Chroma | FTS5 兜底补足；按日期合并 | 索引→时间线→详情三步工具 | Chroma 默认 |
| MemPalace | 向量 | BM25 并集 + closet 加分 | 基准里用 LLM 重排 | all-MiniLM-L6-v2（英文） |

归纳〔推理〕：
- **换说法靠向量**：10 个全都有向量通道；Letta 另外主要靠 agent 自己换着说法多轮搜。
- **硬线索靠全文 + 元数据 + 时间**：8 个有全文通道。mem0 例外——BM25 只在语义候选里加分，召回仍被语义门槛卡住。
- **兜底有两种**：让模型再搜一次（Letta、Claude.ai、Hermes、claude-mem、Honcho、EverOS、OpenClaw 的 Active Memory）；或者保留原文检索通道（Supermemory 的原文块、Redis 的 Remis、LongMemEval 的"原文 + 事实"键）。
- **融合几乎都是 RRF k=60**（Hindsight、Honcho、EverOS、qmd、A_Memorix）或固定加权（OpenClaw 0.7 / 0.3、MemPalace 0.6 / 0.4、Memori 0.85 / 0.15）。
- **重排有正有负**：文档 RAG 上正收益（Anthropic）；对话记忆上现成的网页搜索交叉编码器是负收益（2606.04194 −6.9；EverOS 多轮检索路径的源码注释说交叉编码器"实测净负"，把正确答案压到 20 名以后，所以这条路径只用 RRF，另一条 AGENTIC 路径仍保留交叉编码器）；Hindsight 默认开，但用乘法微调；qmd 用"按名次混合"（RRF 前 3 名保留 75% 检索分）防止重排冲掉字面第一名〔一手〕。
- **查询改写**：Supermemory（多路改写合并）、qmd（专门微调的 1.7B 模型生成 lex / vec / hyde 三类子查询）、CrewAI（≥200 字符的长查询先让模型分析）、MemOS（解析 keys / tags）、EverOS（多轮子查询，每个子查询单独 RRF 不混池）、mira（每轮做指代消解）〔一手 / 二手〕。
- **评测驱动调参**：Hindsight、EverOS、MemPalace、agentmemory、tigerless 都带可复现的基准脚本；SimpleMem 的 EvolveMem 让模型自动调 top_k、融合方式；MemPalace 的教训是不能在测试集上调〔一手自述〕。

### 6.2 混合 vs 纯向量 vs 图谱：公开数字（第三方优先）

| 来源（可信度） | 设置 | 结果 |
|---|---|---|
| MemoryAgentBench 2507.05257（第三方学术）〔一手表〕 | GPT-4o-mini 读者；"准确检索"四项均值 / 总分 | BM25 60.5 / 41.5；Text-Embed-3-Large 54.6 / 38.0；Qwen3-Embedding-4B 54.7 / 38.2；HippoRAG-v2 65.1 / 41.6；GraphRAG 40.9 / 23.4；RAPTOR 36.8 / 27.0；Zep 37.5 / 24.0；Mem0 32.6 / 21.1；Cognee 28.3 / 20.6；MemGPT 34.3 / 28.3；长上下文 GPT-5-mini 74.4 / 60.6。没有"混合检索"这一组 |
| 同上，切块消融 | 单跳文档问答，块 512→4096 | BM25 66→66；Qwen3-Embedding-4B 57→50；HippoRAG-v2 76→49（图方法对切块最敏感） |
| 2606.04194（第三方学术，检索阶段）〔一手摘要〕 | LoCoMo Hit@1，6 个编码器 | 稠密（晚交互）+ BM25 分数融合比只用稠密 +8.8~17.2；最好 Hit@1 0.752（e5-large-v2），比只用 BM25 +11.2；融合 top-10 上加现成网页交叉编码器 −6.9；LongMemEval-S 上 BM25 已饱和，融合增益不显著；稠密擅长多跳和时间题，BM25 擅长对抗题 |
| 2607.16848（第三方学术，论文记忆）〔一手摘要〕 | 5 万字符检索预算 | 稀疏—稠密混合是"最显著的单项干预"，Simple RAG、Mem0、Theoria 加 BM25 后并列第一（差 <0.03）；Graphiti 的领先靠每问 260 万字符，控制预算后消失 |
| LongMemEval 论文（基准作者）〔一手表〕 | LongMemEval_M，会话粒度 R@5 / 轮粒度 R@5 | BM25 .634 / .472；Contriever .723 / .589；Stella-1.5B .720 / .660；键改成"原文 + 抽取事实"后 BM25 .683、Contriever .762 |
| MemPalace 审计 2604.21284（第三方）〔一手〕 | LongMemEval-S、LoCoMo | 原文 + all-MiniLM-L6-v2：R@5 96.6%，端到端问答约 67.2%；有损压缩掉到 84.2%；LoCoMo R@10 原文 60.3% → 混合 + LLM 重排 88.9% |
| HaluMem 2511.03506（MemTensor 出品）〔一手表〕 | Medium 问答正确率 / 抽取召回 | Mem0 53.0 / 42.9；Mem0 图版 54.7 / 43.3；Supermemory 54.1 / 41.5；Zep 55.5 / —；Memobase 35.3 / 14.6；MemOS 67.2 / 74.1（自家）。Long 子集 Mem0 28.1、图版 32.4。除 MemOS（自家）外，Medium 抽取召回只有 14.6–43.3%，Long 子集 Mem0 只剩 3.2% |
| 厂商自测〔二手 / 一手自述〕 | 各自设置 | Redis：原文混合 + 抽取事实 86.1% 对只用事实 71.2%（LongMemEval-S，gpt-4o）；agentmemory：混合 R@5 95.2 对纯 BM25 86.2；tigerless：加向量 RRF R@5 79.0→86.6，延迟 5.1→139.2 ms，答题 17/24 对 18/24 不显著；Anthropic Contextual Retrieval（文档 RAG）：top-20 失败率 5.7%→3.7%（上下文化嵌入）→2.9%（+BM25）→1.9%（+重排）；Mastra 不检索的观察日志 84.23%（gpt-4o），Redis 复测 84.2% |

可信度小结〔推理〕：第三方结果一致指向三点——混合 ≥ 单路（在"换说法"多的语料上差距大，在字面重合高的 LongMemEval-S 上很小）；图方法只在多跳上有优势，整体不比 BM25 好；托管记忆层的默认配置在第三方测试里普遍不如简单 BM25。厂商自报数字只能看趋势。

### 6.3 中文检索的公开数字

| 来源 | 指标 | 数字 |
|---|---|---|
| BGE-M3 论文 2402.03216（BAAI 自报）〔一手表〕 | MIRACL 中文 nDCG@10 | BM25 17.5；mE5-large 56.0；E5-mistral-7b 54.0；BGE-M3 稠密 62.7、稀疏 36.1、多向量 63.7、稠密 + 稀疏 63.5、三者全用 64.9 |
| Qwen3 Embedding 论文 2506.05176（阿里自报）〔一手表〕 | C-MTEB 检索 | multilingual-e5-large-instruct 63.65；gte-Qwen2-1.5B 71.86；gte-Qwen2-7B 75.70；Qwen3-Embedding-0.6B 71.03、4B 77.03、8B 78.21 |
| 同上 | MMTEB 检索（多语） | BGE-M3 54.60；mE5-large-instruct 57.12；text-embedding-3-large 59.27；Gemini Embedding 67.71；Qwen3-Embedding-0.6B 64.64、4B 69.60、8B 70.88 |
| 同上 | CMTEB-R（Qwen3-Embedding-0.6B 召回前 100 再重排） | 不重排 71.02；BGE-reranker-v2-m3 72.16；gte-multilingual-reranker-base 74.08；Qwen3-Reranker-0.6B 71.31、4B 75.94、8B 77.45 |
| 记忆调研本机实测（合成数据） | 中文全文 | unicode61 直接索引中文 0 召回；trigram 与子串真值一致；jieba 预分词漏单字 |

注意〔推理〕：MIRACL、C-MTEB 是百科、搜索类语料，不是聊天记忆；全是厂商自报。MIRACL 的 BM25 17.5 是基线默认分词的结果，不代表处理过中文的全文检索（记忆调研实测 trigram 在字面上全对）。中文聊天记忆上没有找到可靠的公开对比，只能自己测。

## ⑦ 对照灵鲸与建议

### 7.1 同一张表里比〔推理，依据 ③–⑥〕

| 维度 | 主流做法（谁） | 05 草稿 | 灵鲸的位置 |
|---|---|---|---|
| 真相与存储 | 抽取条目进向量库（mem0、Supermemory）；或 Markdown 文件为真相 + 派生索引（OpenClaw、Hermes、Letta、EverOS、OpenViking） | 经历流为真相，记忆是 derived.db 里可删可重放的投影 | 与"文件为真相"派同构，更严格（事件溯源、带受众） |
| 记忆单元 | 原子事实 + 保留原文（Supermemory 记忆 + 原文块；Redis 原文 + 事实；LongMemEval"原文 + 事实"作键） | `mem_item`（正文 ≤120 字 + 概要）+ `raw_fts`（只给 `recall` 工具） | 基本一致；每轮召回没有原文通道 |
| 写入代价 | 每条消息或每批 1 次（mem0、Hindsight、Supermemory）；每情景多次（Graphiti）；每次工具调用 1 次（claude-mem） | 对话里顺手交（0 次）+ 空闲增量（每批 1 次）+ 夜里判 | 更省；风险是便宜模型漏记（HaluMem 里除 MemOS 外，抽取召回都不到 45%） |
| 去重、更新、冲突 | 写入时让模型判（Graphiti、CrewAI 相似 ≥0.85、Supermemory）；后台合并（Hindsight、Honcho、MemOS） | 代码字面去重 + 夜里模型判 + 代码落版本链 | 更保守，与 LightMem、MemoryAgentBench 的结论一致；Hindsight 同样把"新旧比较"交给代码 |
| 候选通道 | 全文 + 向量（47 个里 25 个，占 76% 星数），另有实体、时间、图扩展 | V1.0：线索、trigram、关切、新近；V1.1 才加向量 | **比主流保守一档：V1.0 没有向量** |
| 融合 | RRF k=60 或固定加权 | RRF k=60 后按 0.45 相关 / 0.20 激活 / 0.20 重要 / 0.15 新近加权 | 一致 |
| 重排 | Hindsight、qmd 默认开；Supermemory、Graphiti、OpenViking 可选；EverOS 多轮路径因实测负收益不用 | 无 | 保守，合理 |
| 查询改写 / 扩展 | Supermemory、qmd、CrewAI、MemOS、EverOS、mira | 无；慢想由强模型自己写查询，时间范围由调用方给 | 部分覆盖：在场路径没有 |
| 时间 | 时间臂（Hindsight）；半衰期 30 天（OpenClaw、CrewAI）；`isLatest` + 到期遗忘（Supermemory）；双时间（Graphiti） | 双时间 + 新近（7 天半衰期）+ 读时清晰度 | 一致，略强 |
| 图 | 只当辅助通道（Graphiti BFS、Hindsight 链接扩展、A_Memorix PPR 0.15） | 线索倒排一跳（V1.1 联想） | 与产品主流一致 |
| 作用域与隔离 | user / agent / session / namespace / bank；Honcho 观察者→被观察者 + 成员时间窗（检索后过滤）；CrewAI 私有记录只对同来源可见 | 受众集合；先裁受众再打分；派生条目受众取交集；陌生人内容降为 claim | **独有**（同类只有 Audience-Bound 论文） |
| 来源与防投毒 | mem0 `attributed_to`；cognee `source_*`；OpenClaw 来源类别；Hindsight 证据数 | 来源列取自信封；来源家族去重；claim 升格要主人确认或多个独立来源 | 领先 |
| 遗忘 | 多数不遗忘（mem0 开源版只有到期隐藏，Graphiti 只失效）；Supermemory 到期遗忘；livingmemory、hippo 衰减后删；OpenClaw、CrewAI 只在排序上衰减 | 读时清晰度 + 被用到才加强 + "好像"措辞 + 墓碑 | 更激进，需要 L0 回放标定 |
| 删除 | Graphiti 按情景引用级联；Hindsight 文档级联 + 孤儿观察回扫（曾漏）；mem0 history 留原文；Honcho 软删 | 抹载荷 + 按证据级联重算派生物 | 与最好做法一致；要专门测"孤儿派生物" |
| 读取方式 | 每轮自动注入少量 + 工具检索兜底（OpenClaw、Hermes、Supermemory、claude-mem） | [记得] 自动注入 ≤5 条 + `recall` 工具 | 一致 |
| 评测 | 自带基准脚本 + LongMemEval / LoCoMo（Hindsight、EverOS、MemPalace、agentmemory、tigerless） | 回放题库 + 全上下文基线 + 受众、投毒题 | 一致；缺"召回@k"这一层指标 |

一句话：**别人有、我们没有的是检索质量手段（向量、重排、查询扩展、时间臂、原文通道）；我们有、别人没有的是治理（受众、来源、遗忘、墓碑、事件溯源）。** 主人担心的"查不准"落在前一类，补起来便宜；后一类是灵鲸的立身之本，主流项目做不到，不要为了"像主流"丢掉。

### 7.2 四个问题的明确建议

**(1) 要不要把向量检索提前到 V1.0？——要，作为第五路进 RRF，但带开关、靠数据决定留不留。**
- 理由：trigram 只能做字面子串，"香菜 / 芫荽""不吃辣 / 怕辣""加班 / 熬夜干活"这类换说法召回为 0，这正是主人担心的点；第三方 LoCoMo 结果里融合比单用一路高 8.8–17.2（对稠密）和 11.2（对 BM25）个点 Hit@1；有真实用户的开源实现（OpenClaw、Hindsight、claude-mem、Honcho、MemOS）全都是全文 + 向量一起上〔一手〕。
- 代价很小：V1.0 只有一个受众、几千条记忆；按记忆调研实测（2 万条 1024 维暴力检索 24 ms）线性推算，5000 条约 6 ms〔推理〕；嵌入按（模型, 文本哈希）缓存，换模型只重嵌变化的；向量在 derived.db，可删可重建，不破坏可回放。
- 风险与对策：字面重合高的语料上融合增益可能不显著（2606.04194 的 LongMemEval-S；tigerless 召回涨、答题不涨）→ 第一周用回放题库比较"无向量 / 有向量"的召回@5 与答题，没增益就关；KNN 必须先按 `audience_id IN (...)` 过滤再取 k（sqlite-vec 元数据列；记忆调研实测过带受众过滤的检索，10 万条 93 ms，`IN` 多值过滤待测），不能像 Honcho 那样检索后再滤；KNN 放 worker，不卡主线程。
- 嵌什么：条目的正文 + 概要（每轮 [记得] 用）；原文轮次（`recall` 工具和"补位"通道用，见 7.3）。

**(2) 要不要加重排？——V1.0 不加；V1.1 只在 `recall` 工具上做 A/B。**
- 证据两头都有：文档 RAG 上加重排把 top-20 失败率从 2.9% 降到 1.9%（Anthropic，厂商自报）；Qwen3-Reranker-4B 在 CMTEB-R 上比不重排高 4.9（厂商自报）；但对话记忆上现成的网页交叉编码器把 LoCoMo Hit@1 拉低 6.9（第三方），EverOS 的多轮检索路径也因实测净负而不用〔一手〕。
- 做法：候选只有十几条、每轮注入 ≤5 条，重排的边际收益小，还要多 100 ms 量级延迟和一个模型；慢想的 `recall` 一次取 8 条、对准确度更敏感，在这里试：本地 Qwen3-Reranker-0.6B（GGUF，约 640 MB），或让便宜模型给候选打分；照 qmd 的办法按名次混合（RRF 前 3 名保留 75% 原分、4–10 名 60%、之后 40%），免得重排把字面命中冲掉；回放题库上不涨就不开。

**(3) 要不要加 PageRank 图投影？——不加；线索倒排一跳够用，多跳题证明失败后再加局部 PPR。**
- 证据：MemoryAgentBench 里 HippoRAG-v2 总分 41.6 与 BM25 41.5 打平，GraphRAG 23.4，而且图方法对切块最敏感；HippoRAG 2 的增益集中在多跳；HaluMem 里 Mem0 图版只比普通版高 1.6–4.3；mem0 开源版删了图；产品里 PPR 只有 A_Memorix 一例，权重 0.15、后验图默认关；"神经元图谱"类无一在生产中长期使用〔一手 / 二手〕。
- 灵鲸的线索倒排本身就是"记忆—线索"二部图，一跳扩散按线索独特度加权，相当于 HippoRAG 的节点特异性；联想不经过看不见的条目，这一点 PPR 很难保证。
- 留一个实验口子：回放题库里设一类多跳题（"提书架那天他还说了什么"），失败率高再在 `mem_cue` 上加"局部两跳子图 PPR"作第六路，权重 ≤0.15，先裁受众再建子图（记忆调研实测 10 万条 20 ms、100 万条 40 ms）。

**(4) 嵌入模型选哪个？——本地默认 Qwen3-Embedding-0.6B；线上备选 bge-m3；不用英文默认模型。**

| 选项 | 中文相关数字（全部厂商自报） | 部署 | 判断 |
|---|---|---|---|
| Qwen3-Embedding-0.6B | C-MTEB 检索 71.03；多语检索 64.64；1024 维，可按 MRL 截到 512；32K 上下文 | 本地 GGUF（Q8 约 0.6 GB，与 qmd 用的 0.6B 重排模型同量级〔推理〕）：进程内用 node-llama-cpp（qmd 就这么跑，并推荐它处理中日韩），或按整体架构放 Python 子服务 | **首选**：记忆原文不出本机；分数在同尺寸里最高 |
| Qwen3-Embedding-4B | C-MTEB 检索 77.03；多语检索 69.60；2560 维 | 本地，M4 24 GB 能跑，延迟待测 | 升级选项 |
| BAAI/bge-m3 | MIRACL 中文稠密 62.7、稠密 + 稀疏 63.5；多语检索 54.60 | 硅基流动免费 API 或本地 | 线上备选（要把原文发给服务商，需主人拍板） |
| 百炼 text-embedding-v4 | 没找到可靠的中文检索公开分 | 线上，按量付费，维度 64–2048 | 待实测 |
| all-MiniLM-L6-v2、bge-small/base-en、embeddinggemma-300M | 英文训练或中日韩覆盖有限（MemPalace、qmd 文档自承） | — | **不用**：Hindsight、MemPalace、agentmemory、Supermemory 本地版的默认值，照搬到中文会静默变差 |

### 7.3 另外四条小建议〔推理〕

1. **原文"补位"通道**：Redis 的"原文 + 事实"比只用事实高 14.9 个点（自报），LongMemEval 的"原文 + 事实"作键召回高 9.4%（基准作者）。灵鲸每轮预算小（5 条 / 500 字），建议只做补位：条目通道的最高分低于阈值时，从原文轮次（全文 + 向量）里补 1 条片段，标明"原话"，受众照样先裁。
2. **零调用的查询扩展**：在线索词典里加"别名 / 同义词"（人名昵称、"香菜—芫荽"），由夜间整理顺手提议、代码核对、主人可改；Aho-Corasick 命中别名时同时查本名。再加一个确定性的中文相对时间解析（"上周三""去年今天"）作为时间通道——Hindsight 有现成的中文时间模块可参考。这样在场路径不加模型调用，也能覆盖一部分"换说法"和时间题。
3. **`recall` 改成三步**：照 claude-mem 的"索引 → 时间线 → 详情"，第一步只回编号和一句话，慢想再按编号取前后文；这和 05 草稿"只返回编号和片段，原文按编号取"一致，补一个"按锚点看前后"的操作即可，省 token，也给"漏了怎么兜底"一个确定的答案。
4. **主控台"按意思删除"**：照 Supermemory 的 `forgetMatching`，主人说"把关于某事的都删掉"，用召回管线（受众不限、含沉睡条目）列出候选，主人勾选确认后按编号走 05 草稿 §8.3 的删除级联；先预览、按编号执行，避免语义匹配两次结果漂移。

### 7.4 若主人采纳，05 草稿要改的地方（本稿不改）

- §0 召回段、§4.4 第 2 步：把 e 路（向量）从【V1.1】挪到 V1.0，候选从四路变五路；加 7.3 的原文补位和别名扩展。
- §9.1 / §9.2 版本表：向量、嵌入缓存进 V1.0；重排、局部 PPR 列为 V1.1 实验项。
- §9.5 第 4 条拍板项：从"V1.1 嵌入用线上还是本地"改成"V1.0 嵌入默认本地 Qwen3-Embedding-0.6B，线上 bge-m3 备选"。
- §10 待实测：加"召回@5 回放题库"与 ⑧ 列的几项。

## ⑧ 坑、未核实、待实测

**坑**

1. **英文默认值**：Hindsight（bge-small-en + ms-marco 交叉编码器）、MemPalace / agentmemory（MiniLM）、Supermemory 本地版（bge-base-en）、Honcho 全文（`to_tsvector("english")`）照搬到中文会静默失效〔一手〕。
2. **先检索后过滤会掉召回**：Honcho 的成员时间窗过滤在检索之后做；灵鲸必须先裁受众再取 k。
3. **重排可能帮倒忙**：对话记忆上现成交叉编码器负收益（2606.04194、EverOS）。
4. **指标混用与刷分**：R@5 和问答准确率被放进同一列（MemPalace 后来撤回）；LoCoMo 去不去对抗题能差 10 点；在测试集上调参（MemPalace 的"100%"）；LoCoMo 答案表约 6.4% 有误〔一手 / 旧〕。
5. **删除漏派生物**：Hindsight 曾留下孤儿观察（迁移脚本回扫）；mem0 删除后 history 仍留原文〔一手 / 旧〕。
6. **品牌与机制不符**：hippo-memory 默认 BM25；magic-context 说"给编码 agent 的海马体"，其实是上下文压缩；MCP 官方"知识图谱记忆"是 JSONL + 子串匹配〔一手〕。
7. **项目转型快**：memU、EverOS 今年整体改成 Markdown / Wiki；mem0 开源版删了图和 OpenMemory；Supermemory 2026-09 停掉两个产品专做引擎；Zep 2026-02 弃用 V2 SDK〔一手 / 二手〕。05 草稿已有引擎接缝，不要绑死任何记忆服务。
8. **嵌入是新依赖**：本地模型多一个常驻进程或原生扩展、约 0.6 GB 内存〔推理〕；线上要把记忆原文发给服务商。独立的向量 / 嵌入进程要有监管：claude-mem 的 Chroma 子进程被强杀后孤儿累积到几百对、吃掉几十 GB 交换区〔一手注释〕；灵鲸的 sqlite-vec 在进程内，嵌入模型若做子进程，必须挂在 03 守护的进程监管下。

**未核实**

- 2026 年新项目的星数增长极快（MemPalace 两周 4.7 万星、claude-mem、agentmemory、TencentDB），只当热度，不当质量。
- 生产客户名单大多是厂商自述：mem0 的"AWS 独家"、Zep 的 240+ 客户、Hindsight 的"Fortune 500"和"弗吉尼亚理工复现"（只见于镜像页）、Supermemory 客户（2025 年的名单）。
- AutoGen Teachability、LlamaIndex Memory、LangGraph store、Khoj、Second Me、MIRIX、Memary、MemoryOS 的机制按已有知识或搜索摘要写，本次没读源码；TencentDB、MemMachine、memvid、SimpleMem 只读 README。
- ChatGPT、Claude.ai 的记忆机制来自逆向文章，可能已变。
- 百炼 text-embedding-v4 的中文检索分、Qwen3-Embedding 在中文聊天语料上的真实表现，都没有找到第三方数字。
- "约 20 个有真实用户的系统里 PPR 只有一例"是在我列出的范围内数的，闭源产品（Character.AI、Nomi、Kindroid 等）内部用什么无从得知。

**待实测**

1. 中文回放题库（约 200 题）：换说法题、硬线索题（人名、店名、数字）、时间题、多跳题、受众题、投毒题；比较"trigram + 线索""+ 向量""+ 向量 + 重排"三档的召回@5 与答题正确率，同时跑全上下文基线。
2. Qwen3-Embedding-0.6B（GGUF）在 M4 上的单句嵌入延迟与常驻内存；node-llama-cpp 进程内与 Python 子服务两种跑法对比；与线上 bge-m3 的召回对比。
3. 512 维（MRL 截断）相对 1024 维在中文记忆上的召回损失。
4. sqlite-vec 带 `audience_id IN` 过滤的 KNN 在 1 万条、10 万条规模下的延迟。
5. Qwen3-Reranker-0.6B 与"便宜模型打分"在 `recall` 工具上的增益或损失，以及按名次混合的效果。
6. 原文补位通道的触发阈值；别名扩展和中文时间解析覆盖多少"换说法"和时间题。
7. 多跳题失败率，决定要不要上局部 PPR。
8. 便宜模型在 `inner` 里顺手交事实的召回率（HaluMem 显示抽取式记忆普遍漏记，这是灵鲸写入路径的最大风险）。
