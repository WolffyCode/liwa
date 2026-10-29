# 子调研原文：记忆评测基准、HippoRAG、MemOS、2025–2026 新工作、记忆投毒与防御

> 来源：第 1 段对话（2026-10-27）里的调研子任务「Benchmarks, surveys, poisoning papers」的最终回复，原样存档。
> 状态：未整理、未逐条核对；语言为中文，保持原文。只删掉了一句指向已不存在的临时目录的说明。
> 用途：记忆系统模块阶段的调研起点。索引和要点见同目录 `README.md`。

---

# 灵鲸记忆系统论文调研笔记（2026-10-28）

标注说明：[一手] 表示我读过 arXiv HTML 正文或摘要原文。[二手] 表示来自博客、媒体或别的论文的转述。[推测] 是我自己的推断。全文没碰任何本地仓库，下载的内容都放在临时目录里。

## A. 评测基准

**A1 LongMemEval** https://arxiv.org/abs/2410.10813 。读了 §1、§3–5、附录 A.3/A.4/B [一手]
- **数据**：考五种能力（IE / MR / KU / TR / ABS），共 7 个题型、500 题，其中 30 道是错误前提题，用来考拒答。证据句是"间接"埋进去的，比如用户在问车险时顺带透露自己买了车。S 规模每题约 115k tokens（约 50 个 session）；M 规模 500 个 session，约 1.5M tokens。判分用 GPT-4o，和人工的一致率超过 97%。
- **框架**：indexing / retrieval / reading 三个阶段，加 value / key / query / reading 四个控制点。
- **论文提出的优化**（M 规模，检索器 Stella-1.5B）：
  - **粒度**：以 round 为单位存，优于以 session 为单位。压成 summary 或 fact 会因信息损失掉点，只有 multi-session 推理题用 fact 更好。
  - **索引键**：key 用"原文 + 抽取出的 fact"拼接，recall@k 平均 +9.4%，QA +5.4%。只用 fact 或 keyphrase 当 key 反而更差（round 粒度 R@10：原文 .692，原文+fact .784，keyphrase .392）。在索引阶段拼接，优于在检索阶段多路融合排名。
  - **时间**：给每条记忆按事件日期建索引，查询时让 LLM 抽出时间范围来过滤。时间推理题的 recall 提升 11.3%（round）/ 6.8%（session）。这一步必须用强模型，Llama-8B 抽时间范围会幻觉。
  - **阅读**：用 JSON 加 Chain-of-Note（先摘笔记再答）。即使检索完美，阅读策略差也能差 10 分。注入前按时间排序。检索 token 预算要看读者：Llama-8B 超过 3k 就陡降，GPT-4o 到 20k 以上仍在涨。
- **商用系统掉点**（2024-08，97 题，只用 3–6 个 session 的短历史，人工逐轮操作）：
  - 基准：GPT-4o 直接读全文 .918。
  - ChatGPT：用 4o 时 .577（-37%），用 4o-mini 时 .711。
  - Coze：用 4o 时 .330（-64%），用 3.5 时 .247。
  - 失败方式：ChatGPT 在压缩历史时会改写、覆盖已经记住的信息；Coze 漏记间接提供的信息。
  - 长上下文模型在 S 上比只给证据的 oracle 掉 30–60%（GPT-4o .870→.606）。
- **局限**：数据是合成的，只有用户和助手两方；S 能塞进上下文窗口（全上下文 60.2%，Mastra 的方案 84.2%）[二手]。
- **对灵鲸的启示**：原始 round（操作日志）作为 value 保留，抽出的事实作为附加 key 指回原 round。时间范围抽取由主脑在召回前做。

**A2 LoCoMo** https://arxiv.org/abs/2402.17753 。读了 §3–8、附录 B.1 [一手]；批评部分是 [二手]
- **构造**：两个 gpt-3.5 agent，各带 persona 和一张时间事件图（不超过 25 个有因果关系的事件，跨 6–12 个月），能分享图片（BLIP-2 生成描述）。人工改了约 15% 的轮次。论文版本是 50 段对话，平均 19.3 个 session、9.2k tokens，7,512 道题：single-hop 36%、multi-hop 14.6%、temporal 20.6%、open-domain 3.9%、adversarial 24.9%。
- **结论**：GPT-4-turbo 得 32.4，人类 87.9。长上下文模型在 adversarial 题上只有 2.1%。RAG 以"observation"（每轮抽出的断言）为单位效果最好，比原始对话 +5%，召回更多反而下降。session 摘要召回率高但答得差。temporal 和 open-domain 最难。
- **社区实际用法**：大家用的是公开的 10 段子集（每段约 26k tokens、约 200 题），并且照 Mem0 的惯例剔除 adversarial 题 [一手，MIRIX §4.1]。
- **数据质量批评**：
  - [Penfield 审计](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg)：1,540 道非对抗题里 99 道（6.4%）答案错，包括幻觉事实、"上周六"日期换算错、24 道说话人张冠李戴；满分上限约 93.6%。gpt-4o-mini 判官会接受 62.81% "主题相近但错误"的答案 [二手]。
  - [Zep 博客](https://www.getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)：category 5 没有标准答案；有些题有多个合理答案；对话长度在模型窗口内，Mem0 自报的全上下文基线 72.9% 高于 Mem0 本身的 66.9/68.4%；Zep 被测成 65.99，Zep 自测是 75.14 [二手]。
  - ATANT v1.1 (2604.10981)：参考实现里"标准答案为空"的判分 bug 让 23% 的题无法判分 [一手，摘要]。
  - 跨论文分数不可比：MIRIX 自报 85.4，在 MemOS 论文里只有 64.33。
- **对灵鲸的启示**：LoCoMo 只能当冒烟测试。灵鲸要自建评测，覆盖多说话人、更正、隐私场合，并用"错误但相关"的答案校准判官。

**A3 MemoryAgentBench** https://arxiv.org/abs/2507.05257 。读了 §1、§3–4、附录 B.4/G [一手]
- **四项能力**：Accurate Retrieval、Test-Time Learning、Long-Range Understanding、Selective Forgetting。早期版本可能把最后一项叫 Conflict Resolution [推测]。内容按 chunk 增量喂入。新建了 FactConsolidation 数据集：MQuAKE 的反事实对，新事实排在旧事实后面，长度 6K–262K；prompt 里明确说"序号大的更新"。
- **结论**：RAG 赢准确检索，长上下文赢 TTL 和 LRU。冲突更新全部失败：多跳版本最高只有 28%（GPT-5-mini），多数不超过 7%；o4-mini 在 6K 上得 80，到 32K 掉到 14。
- **各系统总分**：Mem0 21.1、Zep 24.0、MemGPT 28.3、MIRIX 26.2；HippoRAG-v2 41.6（准确检索 65.1）；BM25 41.5；GPT-4o 长上下文 48.8。chunk 切小有利于准确检索，但伤长程理解。
- **局限**：冲突更新这项是合成的。
- **对灵鲸的启示**：别指望读的时候让模型自己判断哪条更新。冲突要在写入或夜间整理时显式版本化（用 supersedes 链），读时只注入当前版本。

## B. HippoRAG 1/2
https://arxiv.org/abs/2405.14831 、 https://arxiv.org/abs/2502.14802 。读了方法、结果、消融、成本附录 [一手]

**v1 机制**：
- 建图：LLM 分两步做 OpenIE（先 NER，再抽三元组）。用检索编码器在余弦相似度超过阈值 τ 的短语之间加 synonym edge。
- 检索：查询中的实体作为种子跑 Personalized PageRank，再乘节点→段落矩阵给段落打分。node specificity 相当于局部 IDF。

**v1 数字**：
- R@5：2Wiki 89.1（ColBERT 68.2），HotpotQA 77.7（略低于 ColBERT 的 79.3）。
- 消融：去掉 PPR，R@5 平均从 72.9 降到 56.2；去掉 synonym edge 降到 70.5。
- 成本：在线检索比 IRCoT 便宜 10–30 倍、快 6–13 倍。离线索引 1 万段：GPT-3.5 约 $15、60 分钟；本地 Llama-70B 约 250 分钟。

**v2 机制**：
- 加 passage node，用 "contains" 边连到其中的短语。
- 查询直接匹配三元组（query-to-triple），比 NER→节点的方式 R@5 +12.5。
- LLM 过滤三元组；passage 节点的 reset 权重设为 0.05。

**v2 数字**：
- 平均 F1 59.8（NV-Embed-v2 57.0，GraphRAG 49.6）。去掉 passage node，R@5 从 87.1 降到 81.0。
- 成本（11.6k 段）：9.2M 输入 / 3.0M 输出 tokens，GraphRAG 是 115.5M / 36.1M。

**局限**：主要误差来自 OpenIE；没有时间语义，也没有冲突语义。

**对灵鲸的启示**：图加 PPR 适合关系记忆和多跳联想，PPR 可以在 TS 进程里直接对 SQLite 边表跑。三元组抽取应并入每轮的抽取调用里。原文段落节点必须保留。

## C. MemOS
https://arxiv.org/abs/2505.22101 读了 §3–4；https://arxiv.org/abs/2507.03724 读了 §4、§5.4–5.5、§6.1、§6.5 [一手]
- **三类记忆**：plaintext、activation（KV cache）、parametric（LoRA）。三者可以互相迁移：常用的 plaintext 转成 KV，稳定的知识蒸馏进参数，过时的参数回退成 plaintext。
- **MemCube 元数据**：
  - 描述类：时间戳、origin signature（来源：推理抽取 / 用户输入 / 外部检索 / 微调）、语义类型。
  - 治理类：读 / 写 / 共享范围，TTL 或衰减，优先级，敏感标签和日志。
  - 行为类：访问频率和新近度（冷热）、version chain（支持冲突消解和回滚）。
- **生命周期**：Generated→Activated→Merged→Archived，另有 Frozen（不可修改、保留审计），可快照回滚。记忆分 private / shared / global 三层。权限按"用户 × 记忆对象 × 调用上下文"判定。
- **数字**（gpt-4o-mini，厂商自报）：
  - LoCoMo：75.80（Mem0 64.57，Zep 59.22），上下文约 1.6k tokens。
  - LongMemEval：77.8（Zep 63.8），约 1.4k tokens。
  - KV 注入：首 token 延迟（TTFT）最多降 91.4%。
- **局限**：治理和权限部分没有量化评测，LoCoMo 结果不含对抗题。
- **对灵鲸的启示**：灵鲸只能通过 CLI 调用大脑，activation 和 parametric 两类用不上。但 MemCube 元数据可以直接当 SQLite schema 的蓝本；"领域记忆长期不淡忘"可以对应 Frozen / 不衰减类。

## D. 2025–2026 新工作 [一手，除注明外]
- **综述**：
  - 2512.13564：从形式 / 功能 / 动态三个角度分类；遗忘分为按时间、按频率、按重要性三种。我只读了摘要和目录，多 agent 共享记忆和可信记忆两章没读到。
  - 2504.15965、2505.00675：概念性分类框架（后者定义了 Consolidation / Updating / Indexing / Forgetting / Retrieval / Condensation 六种操作）。
- **记忆粒度**：
  - SeCom 2502.05589：按话题切 segment，再用 LLMLingua-2 压缩去噪；去掉去噪后 LoCoMo 从 69.33 掉到 59.87。
  - RMM 2503.08026：自适应粒度，加上用"LLM 引用了哪条证据"做奖励的在线 RL 来调 reranker；LongMemEval 比无记忆管理高 10% 以上。
  - Nemori 2508.03341：按事件边界切出 episode，先用已有知识预测这一段，只把预测误差蒸馏成语义记忆；LoCoMo 80.8，略高于全上下文的 80.6，temporal 77.3。
- **冲突更新**：
  - LightMem 2510.18866：白天只做软插入，夜间（sleep-time）并行更新，且只允许时间更晚的条目更新更早的。论文指出在线 LLM 会把"相关但不矛盾"误判成冲突、删掉旧条目，造成不可逆损失。token 消耗降 10–38 倍。
  - Memory-R1 2508.19828：用 RL 学 ADD / UPDATE / DELETE / NOOP 操作，只用 152 条训练样本，比 MemoryOS 的 J 分高 30.2%。
  - Mem-α 2509.25911：用 30k 训练，泛化到 400k 以上。
  - 这两篇需要训练开放模型，灵鲸用不上，只能借鉴它们的操作集。
  - Zep 2501.13956：时序知识图谱，旧边设为失效而不是删除；LongMemEval 最多 +18.5% [摘要]。
- **遗忘策略**：
  - MemoryOS 2506.06326：Heat = α·访问次数 + β·交互页数 + γ·新近度；超容量时踢掉热度最低的，热度超过 5 升入长期记忆。
  - MIRIX 2507.07957：六类记忆。Semantic 带 source 字段；Knowledge Vault 按敏感度分级，高敏内容不进普通检索；先生成 topic，再从每类各取 top-10。
- **多 agent、来源与访问控制**：
  - Collaborative Memory 2505.18279：每个片段带不可变 provenance（时间 / 用户 / agent / 资源）。可读条件是"片段的 agent ⊆ 用户当前可调的 agent，且片段的资源 ⊆ 当前 agent 可访问的资源"，所以权限撤销会回溯生效。只做了效率实验，没有对抗实验。
  - Audience-Bound 2609.36373（与灵鲸最贴合）：
    - 写入时把"当时在场者"绑定为这条记忆的 audience；在场者不明就拒绝写入。
    - 派生记忆有四种处理：按来源拆分、取各来源 audience 的交集、显式授权、或隔离抑制。
    - 只有当前所有在场者都在某个授权 audience 里，这条记忆才能进上下文；在场者不明时只用公开记忆。
    - 1 万段多方历史中 0 泄漏；不加作用域的检索有 82% 的上下文泄漏，而加作用域后 Recall@5 反而高 0.30。
  - Memory Echo 2610.17763 [摘要]：同一来源的旧说法经反复召回和回写会占据多个检索位，被更正后仍持续影响回答。按"来源家族"去重后，准确率从 .825 升到 .920。
  - Compaction Laundering 2610.29869 [摘要]：把对话压平成带 "[User]:" 标签的字符串再摘要，伪造的用户回合压缩后就成了"真实指令"，成功率 87–100%；保持角色类型的序列化方式是 0%。
- **对灵鲸的启示**：夜间合并和压缩是隐私和投毒的高危环节。派生记忆的可见范围取交集，保留说话人类型，不要按出现频次去"强化"同一来源的说法。

## E. 记忆投毒与防御
- **MINJA** 2503.03704 [一手 §3–5]：
  - 机制：攻击者是普通用户（前提是共享记忆库），用 bridging steps（如"A 的数据存在 B 下"）配合逐步删掉诱导提示（progressive shortening），让 agent 自己生成并存下恶意记录。
  - 效果：注入成功率超过 95%，攻击成功率多数超过 70%。
  - 防御实测：嵌入过滤失败（恶意和正常记录在嵌入空间里分不开）。GPT-4o 定向检测在 EHR 上 131/135，但在 RAP 和 QA 上为 0；通用检测误报 34/50。按用户隔离可以被冒充身份绕过；时间衰减无效。
  - 复现 2601.05504：库里已有正常记忆时，注入成功率降到约 25%；但召回数 k 调到 10 又回到 100%。trust-score 消毒要么把全部 23 条都拒掉，要么以满分信任接受了 54 条毒记录。
- **AgentPoison** 2407.12784：投毒率低于 0.1% 时攻击成功率不低于 80%；困惑度过滤和改写都无效 [一手]。
- **PoisonedRAG** 2402.07867：在百万级库里每题放 5 条文本即可 90% 成功；改写、困惑度、去重都无效；k 扩到 50 仍有 41–43% [一手]。
- **ChatGPT / Gemini 记忆公开事件**：
  - [SpAIware](https://embracethered.com/blog/posts/2024/chatgpt-macos-app-persistent-data-exfiltration/)：外泄通道在 1.2024.247 修了，但"不可信文档仍能写入任意记忆"这个根因没修。
  - [Gemini](https://embracethered.com/blog/posts/2025/gemini-memory-persistence-prompt-injection/)：delayed tool invocation——文档里藏指令"用户回复 yes 时就保存这些记忆"，用户随口一答就写进了假记忆。作者建议写记忆前显式确认 [一手博客]。
- **A-MemGuard** 2510.02373：对每条召回记忆单独生成推理路径，剔除偏离多数共识的，并存"教训"记忆。自报对 AgentPoison 的攻击成功率从 100 降到 2.13，对间接注入从 .667 降到 .256。
- **FARMA / SENTINEL** 2607.05029：
  - FARMA：伪造"推理日志"（如"此前已验证过"），再追加互相引用的伪条目把自己放大成共识，击穿 A-MemGuard，成功率 100%。
  - SENTINEL：写入时多层检查（来源标签、"先例数量"与库内实际不符、不合理声明），攻击成功率降到 0；但对知道规则的自适应攻击无效。
- **MPBench 2606.04329 / MemForm 2610.14431** [一手，摘要]：写入越激进越容易被利用；现有提示词注入防御覆盖不到记忆投毒；连合并顺序都能改变 agent 的行为。

| 攻击 | 防御 | 证据强弱 |
|---|---|---|
| MINJA 查询式注入 | 用已有正常记忆稀释、减小召回 k | 中（单篇复现，k 一大就失效） |
| 同上 | 嵌入过滤、时间衰减、按用户隔离 | 无效 |
| 同上 | LLM 判官、trust-score | 弱或负面 |
| AgentPoison / PoisonedRAG | 困惑度过滤、改写、去重、扩大 k | 无效 |
| 同上 | A-MemGuard 共识校验 | 中（自报 -95%，已被 FARMA 击穿） |
| FARMA 伪推理日志 + 放大 | SENTINEL | 中偏弱（扛不住自适应攻击） |
| 不可信内容调用记忆工具 | 写前确认、界面提示、可审阅可删除 | 厂商做法，根因未修 |
| 压缩时伪造角色 | 保持角色类型的序列化 | 强（0% vs 87–100%） |
| 跨场合泄露 | 写入绑定在场者、派生取交集、检索前排除、不明时只放公开 | 强（构造性保证，1 万段历史 0 泄漏） |

**结论**：文献里所有基于内容的检测都被绕过了，有强证据的只有结构性手段。对灵鲸的建议 [推测]：
- 群聊里非主人说的内容，只能以"X 在 Y 场合声称……"的形式入库，不能升级成事实，也不能存成指令。
- 一条说法要升级成事实，需要主人确认，或者有多个独立来源（按来源家族计数，不按出现频次）。
- 记忆注入时作为 JSON 数据块，和指令通道分开。
