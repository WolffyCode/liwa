# 05 记忆系统：memory、people、自我模型、睡眠用脑的记忆部分

状态：**已确认**（2026-10-28）。边界以 `../overall.md` 为准（§2.3 所有权、§3.3 模块清单、§5.1 注入、§5.8 受众、§6 持久化、§9.2 接缝、§16.1 范围）；产品要求见 `../../product.md` §3.3、§3.6、§3.8、§6.1、§10。调研依据是 `../../research/2026-10-28-memory-mechanisms.md`（下文简称"记忆调研"）及其三份子调研，和 `../../research/2026-10-28-memory-landscape.md`（GitHub 全景，下文简称"全景调研"）。本稿是记忆系统的实现 spec；`overall.md` §16.1 已按本稿同步（§9.4）。

标注：〔一手〕读过源码或论文正文；〔二手〕转述；〔实测〕本机跑出来的；〔推理〕没有直接来源的设计判断。依据按节号写在 §11。

## 0 一页结论

**记忆是什么。** 一条条带**来源、受众、证据事件号**的条目，加上每条的几个激活数字（上次被用到、次数、半衰期、情绪残留）。真相永远是经历流，条目只是从它长出来的投影，可删可重建。她对一个人的了解（印象摘要、信任与亲近）在这里；谁是谁（人物档案）不在这里、只有主人能写。

**不做"神经元图谱"。** 网上说的"神经元记忆"是"概念节点 + 一起出现就连边 + 多跳扩散"。证据是：它只在多跳问题上有稳定收益，"记住一件事"不比好的全文 + 向量检索强（HippoRAG 2 对强嵌入基线平均只多 2.8 F1，涨幅全在多跳题；NeuralMemory 自己的评测输给朴素基线；麦麦的"海马体"已被它自己放弃）；它要对每段原文调模型抽节点，和"便宜模型只在对话里顺手交一次、夜里分批整理"冲突；节点内容被整合覆盖后丢来源、丢受众，扩散还会穿过当前受众看不见的条目把隐私"联想"出来。所以做到**"激活数值 + 线索一跳联想"**为止：激活按 ACT-R 公式在代码里读时算；联想走"线索倒排"（人、地方、话题、日期、情绪）一跳，按线索独特度加权，先裁受众再扩散。这正是产品定义 §3.3 写的"新近 + 频率 + 线索独特度 + 情绪残留 + 关切命中 + 噪声"，几乎免费、可回放、可审计。真要多跳，将来可以在投影上加，不用现在背成本。

**四条管线，模型只管四件事。** (1) 对话里顺手交事实（`inner` 的事实字段，零额外调用，当场写成"暂定"条目，下一轮就能召回）；(2) 她自己的经历由代码从手上的事流直接生成，不经模型；(3) 空闲增量（某在场冷 10 分钟且新增 ≥20 条，或一件活做完）由便宜模型补漏；(4) 夜里分批：代码分组 → 模型判"重复 / 更新 / 矛盾 / 无关" → 代码落版本链 → 模型写印象摘要（每行带证据） → 代码遗忘 → 模型提反思与自我候选 → 代码晋升。合并、去重、版本、受众交集、遗忘、墓碑、晋升、激活全是代码。

**召回。** 每轮先按受众裁剪，再五路取候选（线索命中、全文、向量、关切、新近；V1.1 加联想），RRF 融合后按 0.45 相关 + 0.20 激活 + 0.20 重要 + 0.15 新近打分，过清晰度门，MMR 去重，在场最多 5 条 500 字，另加在场者的印象摘要 150 字；条目通道都没命中时从原文补 1 条"原话"。全文用 SQLite FTS5 的 trigram（实测中文下 unicode61 一条都查不到，jieba 漏单字）；向量用 sqlite-vec（实测 10 万条 1024 维 118 ms，要放 worker 线程），嵌入默认本地 Qwen3-Embedding-0.6B，原文不出机器；线索词典带别名和同义词，加确定性的中文相对时间解析，这两样零调用就能覆盖一部分"换个说法"和时间题。全文 + 向量混合是 GitHub 上有真实用户的记忆实现的共同做法（全景调研 ⑤：47 个专门记忆项目里混合检索占星数 76%）。

**遗忘。** 清晰度 R = 2^(−经过时间 / 半衰期)，读时算，不写"每天衰减一次"的事件。**被用到才加强**（说出口、被主人提起、被采用），只是被召回进上下文不算；间隔 24 小时以上再被用到，半衰期 ×1.8。R ≥0.5 清楚；0.2–0.5 只给概要并标"好像"，人设里规定带"好像"的不许补细节；<0.2 沉睡，`recall` 能搜到但不自动注入；沉睡 30 天且不重要的转墓碑，墓碑挡住"从同一批原始事件再抽一遍"，不挡新证据。事实和偏好只版本化、不进墓碑；钉住的、承诺相关的、领域【V3】不衰减。

**自我与人物。** 自我模型四层按产品 §3.6：代码先算统计，模型提"我好像……"候选并附证据，代码按"14 天内 ≥3 个不同日期、≥2 种来源、兴趣须有她自己的经历、与底色冲突不采纳、每层每周 ≤2 条"采纳，版本可回滚。人物档案（人、账号、地方、在场者快照）只有主人写，受众只由它算：条目可见 ⟺ 公开，或在场全部主体都在条目受众里；合并是并查集上的一条边、可撤销，证据一律存账号级主体，人是投影。

**第一版。** V1.0：情景、事实、关系三类（含"某某说"的 claim）；印象摘要（主人）；线索倒排 + trigram 全文 + 向量 + 关切 + 新近的五路召回，原文补位，别名与时间解析；四条管线；清晰度与"好像"；墓碑；主人查看、更正、删除、钉住；删除级联；自我第一层；人物档案只有主人和她，来源与受众字段从第一天写全。V1.1：激活打分、一跳联想候选、话题线索、`recall` 工具的重排 A/B、自我其余三层、替换演练用的极简第二引擎。

**关键取舍**

| 取舍 | 选了什么 | 放弃了什么、为什么 |
| --- | --- | --- |
| 记忆的形状 | 条目 + 线索倒排 + 读时算的激活 | 概念图谱 + 扩散：单跳无收益、每段要调模型、覆盖丢来源、扩散泄漏隐私（§11 第 1 条） |
| 什么时候判语义 | 只在空闲增量和夜里，分批 | 写入时在线判冲突、顺手改邻居（A-MEM）：把"相关"误判成"矛盾"、改错看不出来 |
| 什么算"记得更牢" | 被用到（说出口、被提起、被采用） | 被召回就加强：越召越强，旧说法长期占位（Memory Echo；A_Memorix 后来专门加冷却） |
| 遗忘怎么落地 | 清晰度读时算 + 分档措辞 + 墓碑 | 每天跑一遍"衰减事件"：日志膨胀、不可回放；物理删除：主人要能在"她的一天"里看到原始经历 |
| 中文全文 | trigram 为主，1–2 字用线索词典 + LIKE 限条数 | unicode61（查不到中文）、jieba 建索引（漏召回无声无息、索引和查询切法可能不一致） |
| 向量 | V1.0 就加，作为第五路进 RRF，先按受众过滤再取 k，sqlite-vec 放 derived.db、KNN 在 worker，带开关 | 等到 V1.1：trigram 只做字面子串，"香菜 / 芫荽"这类换说法召回为 0；第三方 LoCoMo 测试里全文 + 向量融合比单路高 8.8–17.2 个点，有真实用户的实现全是混合 |
| 重排模型 | V1.0 不加；V1.1 只在 `recall` 工具上做 A/B，按名次混合保住字面命中 | 默认开：对话记忆上现成的交叉编码器是负收益（第三方 −6.9），每轮候选只有十几条、边际收益小 |
| 图检索 | 线索倒排一跳；多跳题失败率高再加局部两跳 PPR 作第六路，权重 ≤0.15 | 一开始就上 PageRank：第三方基准里图方法总分和 BM25 打平，产品里只有麦麦 A_Memorix 一例、权重 0.15 |
| 谁算受众 | people 一处算，条目存 audience_id，查询带 `audience_id IN (...)` | 每条存主体列表、每次查询展开：慢，而且各模块各算一套必然对不上 |
| 删除 | 抹载荷 + 级联重算派生物 | 改写日志：给只追加开口子 |

**已定的选择（§9.5）**：① 不做神经元图谱，做激活数值 + 线索一跳联想；② 遗忘按情景 3 / 14 / 60 / 365 天四档，她忘了但主人在"她的一天"里仍看得到原始经历，第一个月回放后再调；③ 遗忘与"好像"在 V1.0；④ 向量在 V1.0、嵌入默认本地 Qwen3-Embedding-0.6B；⑤ 主控台"记忆图"是界面投影，V1.1 以后由 08 定；⑥ "被用到"只算说出口、被提起且接了话、自发想起后说出口、被工具采用；⑦ 钉住的永不淡忘。

## 1 范围与边界

**管什么**

- memory 账本：四类记忆（情景、事实、关系、领域【V3】）的条目、证据、线索、受众引用、激活字段；印象摘要；她对每个人的信任与亲近（`relation_state`）；召回；联想候选打分；"被用到"记账；更正、钉住、删除与级联；原文全文索引（`raw_fts`）；向量索引与嵌入缓存。
- people 账本：人、账号（已确认 / 候选）、人物合并与拆分、地方、在场者快照、受众集合与可见性计算、地方合并配置、主人的首选地方。
- self 账本里的自我模型：四层的候选、条目、版本、采纳规则、回滚（出生设定、成长版本、性格参数、日记在 06）。
- 睡眠用脑的记忆部分：空闲增量和每晚链里属于记忆、印象、关系、遗忘、反思、自我候选的阶段；它们的输入打包、提案载荷、校验规则、检查点。
- 记忆引擎接缝 `ingest`、`consolidate`、`rank`、`forget` 的接口，内置实现，以及 V1.1 替换演练用的极简第二引擎的要求。

**不管什么**

- `inner`、`recall`、`submit` 工具的传输、会话令牌、按用脑种类过滤（02）；本稿只定这几个工具里属于记忆的载荷类型和校验。
- 经历流、载荷、大对象、投影运行器、`erasePayload` 的底层（03）；本稿只定记忆这边的事件类型、投影表和级联清单。
- 联想冒头的时机、频率、认知负荷、去向，以及走神（04 attention）；本稿只提供 `candidatesFor` 的打分。
- 人设怎么渲染、自我模型第一层怎么进稳定前缀（06 的 `renderPersona`）。
- 嵌入模型的加载、回退链、计费（09）；本稿只定默认模型、调用方式、维度、缓存键。
- 界面（08）：本稿只定主人接口要用到的查询和事件。

**和谁打交道**

| 模块 | 它给我 | 我给它 |
| --- | --- | --- |
| journal（03） | `append`、`read`、`subscribe`、投影检查点、`erasePayload` 的级联回调 | 记忆事件、投影注册、级联清单 |
| context（02） | 每轮调用 `recall` 和 `impressionFor`，带用脑上下文（受众、可见事件范围） | 结构化召回结果（已按清晰度和受众渲染）、印象摘要段 |
| toolport / minds（02） | `inner(事实)`、`recall(查询)`、睡眠的 `submit` 的载荷；回合结束时回复正文或"用到的记忆号" | 校验结果、`memory.used` |
| attention（04） | 情境线索（在场者、地方、话题词、日期、主导情绪、未了结关切）；注入了哪条联想 | 带分的候选（V1.1） |
| will（04） | 未了结的心事、牵挂、今天的承诺（召回的关切路） | — |
| tasks（02） | 手上的事流的结果事件 | 她自己的经历条目（代码生成） |
| people（本稿） | 受众、在场、主体解析 | 候选账号（经睡眠提案） |
| self（本稿 / 06） | 成长速率（信任涨跌、遗忘不调） | 自我候选 |
| scheduler（04） | 空闲增量、每日链的作业触发 | 引擎声明的作业清单 |
| guard（03） | `admit`（睡眠用脑的日预算） | 用量 |
| abilities（09） | `embed(文本[])`，默认本地 Qwen3-Embedding-0.6B | — |
| gateway（07） | 主人接口：查看、搜索、更正、删除、钉住、确认候选账号、合并与撤销 | 查询结果、变更事件 |

## 2 数据

### 2.1 放在哪、谁写

| 数据 | 存放 | 种类 | 写入者 |
| --- | --- | --- | --- |
| 记忆事件、印象事件、关系事件、自我事件、人物档案事件 | 经历流（`member:<id>` 流；人物档案在 `system` 流；在场者快照在 `place:<id>` 流） | 真相 | 只有各账本经 `append` |
| `mem_item`、`mem_evidence`、`mem_cue`、`cue_stat`、`audience_set`、`mem_fts`、`raw_fts`、`impression`、`relation_state`、`mem_vec`、`raw_vec`、`embed_cache` | derived.db | 异步投影，可删表重放 | memory 的投影器（主线程单写者） |
| `person`、`account`、`person_merge`、`place`、`place_group`、`presence_snapshot`、`preferred_place` | liwa.db | 内联投影（和事件同事务，读到的永远是最新的） | people |
| `self_candidate`、`self_item`、`self_version` | liwa.db | 内联投影（小，回滚要精确） | self |

理由：senses 每条消息都要确定地查人物档案和受众，不能容忍投影落后；记忆检索索引体积大、要能重建，放可重建的库（overall §6.3、§18 N6）。异步投影的"落后"对记忆只有一处要堵：`remember` 返回前等投影追到这条事件（§3.1、§5.1），保证"下一轮就能召回"。

### 2.2 事件类型

全部带 overall §6.2 的信封（流、序号、执行者、因果、来源信息、载荷号）。标"可删"的，正文在载荷里，主人彻底删除时只抹载荷。

| 事件 | 谁写 | 载荷要点 | 可删 |
| --- | --- | --- | --- |
| `memory.proposed` | memory（`remember` 或 `propose` 校验通过后） | 条目草稿：kind、subtype、subject、text、gist、event_time（含精度）、importance、emotion、cues、evidence[]、source 字段、audience_id、provenance（哪次用脑 / 哪个作业 / 代码规则）、status=provisional | 是 |
| `memory.accepted` | memory（夜里判完或代码直接确认） | id | — |
| `memory.merged` | memory | into、from[]、并入的证据、保留的措辞 | — |
| `memory.superseded` | memory | old、new、invalid_at（= new.valid_from）、原因（update / correction） | — |
| `memory.conflict` | memory | a、b、来源不同、待慢想或主人 | — |
| `memory.used` | memory（回合结束时由 minds 交回复正文或"用到的记忆号"后记） | ids、方式（说出口 / 被提起 / 自发 / 工具）、会话号、回合号 | — |
| `memory.surfaced` | attention（联想冒头并注入时） | id、线索、分数、TTL | — |
| `memory.promoted` | memory（夜里晋升） | id、importance 从 → 到、依据（用到次数、天数、场合数） | — |
| `memory.forgotten` | memory（墓碑） | id、当时的清晰度、蒸馏进哪行印象（可空） | — |
| `memory.pinned` / `memory.unpinned` | memory（主人） | id | — |
| `memory.corrected` | memory（主人） | old、新条目草稿（作为新版本） | 新草稿可删 |
| `memory.deleted` | memory（主人） | id、是否连带抹载荷 | — |
| `memory.widened` / `memory.widen_revoked` | memory（代码核对依据后） | id、加入的主体、依据事件号（来源人的原话或主人的规则） | — |
| `impression.updated` | memory | person_id、新版本号、逐行 diff（每行 text、section、evidence[]、audience_id） | 是 |
| `relation.updated` | memory（按 people 的 `relationModel` 算出的增量） | person_id、trust、closeness、起因事件、规则名 | — |
| `self.candidate.proposed` / `self.candidate.attached` | self | 层、规范化说法、来源种类、证据、附到哪条 | 是 |
| `self.item.adopted` / `self.item.retired` / `self.version.created` / `self.version.rolled_back` | self | 条目、版本号、改了什么、因为哪些事件、哪天 | 是（条目文本） |
| `person.created` / `person.updated` / `account.bound` / `account.suggested` / `account.confirmed` / `account.rejected` / `person.merged` / `person.split` / `place.registered` / `place_group.updated` / `preferred_place.set` | people | 见 §2.5 | — |
| `presence.snapshot` | senses 上报、people 写 | 地方、成员账号列表、时间、有效期、可信度 | — |

### 2.3 `mem_item`：四类记忆共用一张表

条目号 = 创建它的 `memory.proposed` 事件的全局位置，重放后不变。更正、更新都产生**新条目**，用版本链连起来，不改旧行。

| 字段组 | 字段 | 说明 |
| --- | --- | --- |
| 身份 | `id`、`member_id`、`kind`（episodic / fact / relation / domain【V3】）、`subtype` | subtype 封闭集合：episodic → event / interaction / self_activity / reflection；fact → statement / preference / plan / claim；relation → impression_change / trust_event；claim = "某某说……"，未经确认的说法 |
| 内容 | `subject`、`text`（≤120 字）、`gist`（≤30 字）、`cue_labels`（话题词，V1.1） | subject 封闭集合：self / owner / person:编号 / place:编号 / account:平台:号 / world，代码校验，不接受自由文本（防主体混淆） |
| 时间 | `event_time`、`time_precision`（minute / day / approx）、`observed_at`、`valid_from`、`invalid_at` | 事实用双时间：矛盾只写 invalid_at，不删 |
| 版本 | `status`（provisional / active / dormant / superseded / forgotten / deleted）、`supersedes`、`superseded_by`、`chain_root`、`version` | dormant 是读时算出来的档位缓存，每晚刷新一次；deleted 只因主人 |
| 来源 | `source_account`（信封里的来源账号，不可改）、`source_person`（投影时按当前合并关系解析）、`source_kind`（owner / member / bound_human / stranger / system / web / self_experience）、`place_id`、`presence_snapshot_id`、`trust`（0–1）、`taint`（0/1）、`source_family`、`derived_from[]` | source_family = hash(地方, 来源账号, 日期)，用于"按来源家族去重" |
| 受众 | `audience_id` | 指向 `audience_set`；派生条目 = 全部证据受众的交集；没有明确受众的按"只有主人" |
| 显著 | `importance`（0–1）、`emotion_valence`（−1/0/1）、`emotion_intensity`（0–1） | 来自 `inner` 的感受或夜里整理；默认见 §4.11 |
| 激活 | `use_count`、`last_used_at`、`recent_uses`（最近 3 次时间）、`anchor_at`、`half_life_s`、`last_reinforced_at`、`protected`、`surfaced_count_day`、`surfaced_day` | 前六个 V1.0 就要（遗忘和钉住靠它们）；后两个是反刍计数，V1.1 |
| 审计 | `created_event`、`updated_event`、`created_by`（用脑会话号 / 作业号 / 规则名） | |

索引：(member_id, status, audience_id)；(member_id, subject, status)；(member_id, event_time)；(member_id, last_used_at)；chain_root。

### 2.4 memory 的其余表

| 表 | 字段 | 用途 |
| --- | --- | --- |
| `mem_evidence` | mem_id、event_id、role（source / support / contradict） | 证据事件号；删除级联按 event_id 反查 |
| `mem_cue` | mem_id、cue_type（person / place / topic / date / emotion）、cue_key、weight | 线索倒排；person 和 place 的键是档案编号，date 是"月-日"，emotion 是情绪类型名，topic 是词 |
| `cue_stat` | cue_type、cue_key、item_count、last_seen_at | 独特度 = ln(N_total / item_count) / ln(N_total)；每晚重算，白天增量加减 |
| `audience_set` | id、principals（排好序的主体数组，或 'public'）、hash | 不同受众集合很少，可见性先在集合层面判 |
| `mem_fts` | FTS5 external-content 虚表，tokenize='trigram'：text、gist、cue_labels；外部内容指向 `mem_item` | 条目全文；1–2 字查询走 `mem_item.text LIKE` 限 50 条 |
| `raw_fts` | FTS5 trigram：正文、event_id、place_id、audience_id、event_time | 原文全文（给 `recall` 工具和主人搜索）；原文 + 条目都当索引键 |
| `impression` | member_id、person_id、version、lines[{line_id, section: stable / recent / uncertain, text, evidence[], audience_id}]、keywords（关系词、感受词）、updated_event | 印象摘要，每行带证据与受众，整体版本化 |
| `relation_state` | member_id、person_id、trust（0–1）、closeness（0–1）、last_interaction_at、interaction_count、sentiment_trend（最近 7 天效价均值）、version、updated_event | 她对一个人的信任和亲近；增量由 people 的 `relationModel` 算，memory 落账；涨跌不对称 |
| `mem_vec` | vec0 虚表：mem_id（整数主键，BigInt 绑定）、audience_id（元数据列）、embedding float[d] | 条目向量（正文 + 概要）；d=1024（Qwen3-Embedding-0.6B，可按 MRL 截到 512）；KNN 前先按 audience_id 过滤 |
| `raw_vec` | vec0 虚表：event_id、audience_id、embedding | 原文轮次的向量，给原文补位和 `recall` 工具用 |
| `embed_cache` | model、text_hash、embedding、created_at | 换模型只重嵌变化的；删除级联按 text_hash 删 |
| `mem_tombstone` | mem_id、kind、subject、event_time、evidence[]（事件号）、forgotten_event | 墓碑：没有正文；挡住"只引用这些证据"的新提案 |
| `mem_checkpoint` | job、stage、position、batch_id、updated_at | 空闲增量与每晚链各阶段的检查点与幂等键 |

### 2.5 people 的表

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `person` | id、display_name、relation_to_owner（妈妈 / 朋友 / 同事……自由文本 + 关系类型枚举）、role（权限来源：owner / family / friend / acquaintance / stranger）、status、created_event | 只有主人写；她的建议走候选账号，不建人 |
| `account` | platform、account_id、person_id（可空）、status（confirmed / candidate / rejected）、evidence[]、confirmed_by、events | 未绑定的账号各自是一个陌生人主体 `account:平台:号` |
| `person_merge` | from_person、into_person、merge_event、undo_event（可空） | 并查集的边；撤销只是去掉这条边，记忆不用改写 |
| `place` | id、adapter、place_ref、is_group、limits（能发什么、限频）、registered_event | 地方键只由 people 算：hash(adapter, place_ref) |
| `place_group` | id、member_id、place_ids[]、label（"你的日常聊天"）、updated_event | 地方合并配置【V1.1】；默认：主人在主控台、QQ、微信的私聊合成一个在场 |
| `presence_snapshot` | id、place_id、accounts[]、taken_at、valid_until、confidence（high / low） | 适配层上报；主控台的快照恒为 {主人}、high |
| `preferred_place` | person_id、place_id、set_event | 主人设的首选地方【V1.1】 |

主体（principal）词表：`owner`；`member:<id>`（她和将来的伙伴）；`person:<id>`（已绑定的真人）；`account:<平台>:<号>`（未绑定的账号）。受众集合是主体的集合，或特殊值 `public`。她自己不算在场者，所以"只有主人"的受众集合就是 {owner}。

### 2.6 self 的自我模型表

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `self_candidate` | id、member_id、layer（1 我是什么样的人与角色 / 2 我要什么 / 3 我的故事 / 4 我做得怎么样）、statement_norm（规范化说法）、source_kinds[]（behavior_stats / diary_reflection / owner_feedback / other_feedback）、seen_dates[]、evidence[]、attached_item（可空）、status（open / adopted / rejected / expired）、first_seen、last_seen | 同义说法附到同一条候选上，由夜里模型选"附到第几条" |
| `self_item` | id、layer、text、evidence[]、source_kinds[]、confidence、status（adopted / retired）、adopted_version、retired_version、growth_item（可空；兴趣、习惯类条目挂的成长条目） | 第一层 ≤10 条特质 + ≤5 条角色；第二层价值观来自出生设定（只读引用），希望 / 害怕成为的自己各 ≤3；第三层章节、转折点、"最近的我"、三句话；第四层按领域的胜任感与关系自评 |
| `self_version` | version、member_id、changes[{item, op: add / retire / edit, because_events[], date}]、created_event、rolled_back_event | 每次变化一个版本；回滚写新版本，不删旧的 |

### 2.7 条目号、版本链与状态

- 新事实和旧事实是"更新"：旧条目 `invalid_at = 新.valid_from`、`superseded_by = 新`、status=superseded；新条目 `supersedes = 旧`、`chain_root` 同旧、version+1。召回只注入链上当前版本；`recall` 带时间范围时可以取到当时有效的版本。
- 矛盾且来源不同：两条都留 active，写 `memory.conflict`，渲染时并列并标"两种说法"，交慢想（或主人）择一；慢想的决定作为新的更新。
- 主人更正 = 主人来源的新版本（trust 1.0，受众不变），旧条目 superseded，原因 correction。
- 主人删除：条目 status=deleted，投影里不再出现，重建也不出现；要彻底抹的走 §8.3 级联。
- 墓碑只用于情景条目；事实、偏好、关系不进墓碑（§4.6）。

### 2.8 存储量估算〔推理，按第一周基线再校〕

一个人加她的日常：每天 30–200 条新条目（含她自己的经历），一年 1–7 万条；`mem_item` 每条约 1 KB，`mem_fts` 10 万条 13.8 MB（实测），`raw_fts` 100 万行 145 MB（实测），`mem_vec` 10 万 × 1024 维 398 MB（实测，V1.1）。derived.db 第一年在 1 GB 以内；重建：FTS 100 万行 3 秒，条目投影按事件数估，一年数百万事件几分钟到几十分钟（overall §6.9 的账本快照解决）。

## 3 接口

类型用 TypeScript 写意，实现时放进 `@liwa/contracts`。所有读接口都是 `async`：召回在 worker 线程里跑（§7.2）。

### 3.1 memory 对内 API

```ts
type EventId = string;            // 经历流全局位置
type MemId = EventId;             // 条目号 = 创建事件号
type Principal = 'owner' | `member:${string}` | `person:${string}` | `account:${string}:${string}`;
type Subject = 'self' | 'owner' | 'world' | `person:${string}` | `place:${string}` | `account:${string}:${string}`;

/** 由 minds / context 组装，模型碰不到；受众和可见范围都来自 people 和会话登记，不信调用方自报 */
interface MindContext {
  member: string;
  mindKind: 'presence' | 'slow' | 'hand' | 'sleep';
  sessionId: string; turn: number;
  presence: Principal[];            // 此刻在场的主体（她自己不算）
  visibleAudienceIds: number[];     // people.audienceOf 算出：在场者全部都在其中的受众集合 + public
  strictAudience: boolean;          // 快照过期或可信度低 → 只能用 public
  canSeeEvent(id: EventId): boolean;// 本次用脑看得见的事件范围（绑定的地方流 + 注入过的编号）
  now: string;                      // ISO 8601；MindContext 是 required 之间的进程内类型，不是槽位契约
}

interface FactInput {               // inner(事实[]) 的每一项；睡眠提案里的事实也用它
  about: Subject;
  text: string;                     // ≤120 字；超长拒绝，不截断
  evidence: EventId[];              // ≥1 条，必须 canSeeEvent
  subtype?: 'statement' | 'preference' | 'plan' | 'event' | 'interaction';
  importance?: number;              // 0–1，缺省按 §4.11
  emotion?: { valence: -1 | 0 | 1; intensity: number };
  eventTime?: { at: string; precision: 'minute' | 'day' | 'approx' };
  topics?: string[];                // ≤5 个话题词【V1.1 才建线索；V1.0 只存】
}

interface RecallQuery {
  text: string;                     // 本轮输入或 recall 的查询
  cues?: { type: 'person' | 'place' | 'topic' | 'date' | 'emotion'; key: string }[]; // attention / context 已知的线索
  concerns?: { kind: 'worry' | 'care' | 'promise'; refs: string[] }[];            // will 给的未了结关切
  timeRange?: [string, string];     // 只有 recall 工具会带
  about?: Subject;
  includeDim?: boolean;             // 是否包含沉睡条目（recall 工具可开；在场每轮不开）
}
interface RecallLimits { maxItems: number; maxChars: number; }
interface RecallHit {
  id: MemId; kind: string; subtype: string; subject: Subject;
  clarity: number; certainty: 'clear' | 'vague' | 'dim';
  score: number; eventTime?: string;
  rendered: string;                 // 已按清晰度、相对时间、来源提示渲染好的一行（§4.4 第 4 步）
}
interface RecallResult {
  items: RecallHit[];
  degraded?: 'timeout' | 'worker_down' | 'fts_unavailable';
  elapsedMs: number;
}
interface ImpressionBlock { personId: string; text: string; lineIds: string[]; chars: number; }

interface MemoryLedger {
  // 读
  recall(ctx: MindContext, q: RecallQuery, limits: RecallLimits): Promise<RecallResult>;
  impressionFor(ctx: MindContext, persons: string[], maxCharsEach: number): Promise<ImpressionBlock[]>;
  candidatesFor(ctx: MindContext, situ: Situation, rng: CounterRng): Promise<AssocCandidate[]>; // V1.1，§4.7
  item(ctx: MindContext, id: MemId): Promise<ItemView | null>;           // 受众不允许返回 null，不报"存在但不可见"
  // 写（用脑经 toolport）
  remember(ctx: MindContext, facts: FactInput[]): Promise<{ accepted: MemId[]; rejected: { index: number; reason: string }[] }>;
  propose(ctx: MindContext, batch: SleepProposal): Promise<ProposalReceipt>;                 // 睡眠 submit 的记忆部分，§3.2
  markUsed(ctx: MindContext, ids: MemId[], mode: 'spoken' | 'mentioned' | 'spontaneous' | 'tool'): Promise<void>;
  // 代码规则
  recordSelfExperience(member: string, taskEvent: EventId): Promise<MemId | null>;           // 从手上的事流生成她自己的经历
  // 主人（只经 gateway 的主人接口）
  correct(member: string, id: MemId, draft: FactInput, by: 'owner'): Promise<MemId>;
  pin(member: string, id: MemId, on: boolean): Promise<void>;
  delete(member: string, id: MemId, erasePayload: boolean): Promise<EraseReport>;
  widen(member: string, id: MemId, add: Principal[], basis: EventId): Promise<void>;         // 代码核对依据，§4.10
  revokeWiden(member: string, id: MemId, widenEvent: EventId): Promise<void>;
  search(member: string, q: OwnerSearch): Promise<OwnerSearchResult>;                        // 主人可见全部，不过受众
  // 维护
  rebuild(member?: string): Promise<void>;     // 删表重放
  runJob(job: 'idle_increment' | 'nightly', scope: JobScope): Promise<JobReport>;
}
```

约束：`recall`、`impressionFor`、`candidatesFor`、`item` 永远不返回 `visibleAudienceIds` 之外的条目，这是 memory 的唯一"不得做"（overall §3.3）；`search` 是主人接口，不经用脑，主人可见全部（overall §2.1 的"主人可见"）。

### 3.2 内核工具里属于记忆的载荷

| 工具 | 本稿定的部分 | 校验（代码，§4.2） |
| --- | --- | --- |
| `inner(…, 事实[], …)` | 事实 = `FactInput[]`，每回合 ≤8 条 | 依据事件号可见；subject 在封闭集合；text ≤120 字；来源、受众、trust、taint 从依据事件的信封取；陌生人 / 网络 / 污染回合 → subtype 强制 claim；通过的立刻写 `memory.proposed`（provisional） |
| `recall(查询)` | 查询 = `RecallQuery` 的 text、timeRange?、about?；返回 ≤8 条、≤1200 字，只给编号和片段，原文按编号经 `get_report` 取 | 受众同本次用脑；在场不开 includeDim |
| `submit('memory', …)`（睡眠） | `SleepProposal`，见下 | 每种提案的规则在 §4.2–§4.9 |

```ts
interface SleepProposal {
  batchId: string;                                    // = mem_checkpoint 的幂等键；重复提交整批忽略
  facts?: FactInput[];                                // 空闲增量补漏的事实、情景分段摘要
  topics?: { memId: MemId; topics: string[] }[];     // 给已有条目补话题线索【V1.1】
  verdicts?: { a: number; b: number; relation: 'duplicate' | 'update' | 'contradiction' | 'unrelated' }[]; // 夜里判关系，a、b 是组内整数编号
  impression?: { personId: string; lines: { op: 'add' | 'edit' | 'remove'; lineId?: string; section: 'stable' | 'recent' | 'uncertain'; text: string; evidence: EventId[] }[] };
  reflections?: (FactInput & { subtype: 'reflection' })[];                                       // 2–3 条，证据 ≥2
  selfCandidates?: { layer: 1 | 2 | 3 | 4; statement: string; attachTo?: number; evidence: EventId[]; sourceKind: 'behavior_stats' | 'diary_reflection' | 'owner_feedback' | 'other_feedback'; growthItem?: number }[]; // evidence 只能是经历事件号；兴趣、习惯类要挂 growthItem（成长条目的本批编号）
  widenCandidates?: { memId: MemId; add: Principal[]; basis: EventId }[];                        // 代码核对原话
  accountCandidates?: { platform: string; accountId: string; personId: string; evidence: EventId[] }[]; // 转 people.suggest
}
```

### 3.3 people API

```ts
interface People {
  resolveSender(platform: string, accountId: string): { principal: Principal; personId?: string; role: Role; sourceKind: 'owner' | 'bound_human' | 'stranger' };
  placeKey(adapter: string, placeRef: string): string;                 // 唯一的地方键算法
  presenceOf(placeId: string): { accounts: string[]; principals: Principal[]; takenAt: string; confidence: 'high' | 'low'; stale: boolean };
  audienceOf(placeId: string): { presence: Principal[]; visibleAudienceIds: number[]; strict: boolean; defaultAudienceId: number };
  audienceIdFor(principals: Principal[] | 'public'): number;           // 取或建 audience_set
  intersect(audienceIds: number[]): number;                            // 派生条目的受众
  preferredPlace(personId: string): string | null;
  presenceGroup(placeId: string): string;                              // 地方合并配置 → 在场编号【V1.1】
  // 只有主人
  createPerson(p: PersonDraft): Promise<string>;
  bind(platform: string, accountId: string, personId: string, basis: EventId): Promise<void>;
  confirmAccount(platform: string, accountId: string, personId: string): Promise<void>;
  rejectAccount(platform: string, accountId: string): Promise<void>;
  merge(fromPerson: string, intoPerson: string): Promise<EventId>;
  split(mergeEvent: EventId): Promise<void>;
  // 她的建议
  suggest(c: { platform: string; accountId: string; personId: string; evidence: EventId[] }): Promise<void>;
}
```

### 3.4 self 的自我模型 API

```ts
interface SelfModel {
  applySelfModel(member: string, candidates: SleepProposal['selfCandidates'], today: string): Promise<{ adopted: string[]; attached: number[]; rejected: { index: number; reason: string }[]; outOfCharacterNotice?: string }>;
  selfBlock(member: string, level: 'brief' | 'full'): Promise<{ text: string; version: number }>;   // brief = 只有第一层（第一人称）；价值观由 06 的 renderPersona 从出生设定渲染，这里不重复
  versions(member: string): Promise<SelfVersionView[]>;
  rollback(member: string, toVersion: number, by: 'owner'): Promise<number>;
}
```

### 3.5 引擎接缝（overall §9.2）

```ts
// 槽位 memory.engine（contracts/slots/memory.engine.ts）；方法形状按 00-contracts.md §2.2：异步、首参 CallContext、只传 JSON
interface MemoryEngine {
  /** 抽取：引擎只生成"要问便宜大脑什么"（提示材料 + 回答 schema），不自己碰 CLI */
  prepareIngest(ctx: CallContext, input: { member: string; events: EventView[]; knownItems: ItemBrief[]; mode: 'idle' | 'nightly' }): Promise<SleepAsk>;
  /** 把模型的回答解释成提案；不写库 */
  interpretIngest(ctx: CallContext, input: { ask: SleepAsk; answer: JsonValue }): Promise<SleepProposal>;
  /** 判关系：同上两段 */
  prepareConsolidate(ctx: CallContext, group: { member: string; items: ItemBrief[] }): Promise<SleepAsk>;
  interpretConsolidate(ctx: CallContext, input: { ask: SleepAsk; answer: JsonValue }): Promise<SleepProposal['verdicts']>;
  /** 纯函数：只接收账本按受众裁过的候选，只返回编号与分数；在拿到候选的线程里跑 */
  rank(ctx: CallContext, input: { candidates: Candidate[]; situation: RankContext }): Promise<Scored[]>;   // pure: true
  /** 纯函数：激活字段 + 时刻 → 清晰度与档位 */
  forget(ctx: CallContext, input: { activation: ActivationFields; now: string }): Promise<{ clarity: number; tier: 'clear' | 'vague' | 'dim' }>;   // pure: true
}
// 引擎声明的作业（JobDecl[]）写在 manifest 的 provides['memory.engine'].meta 里，scheduler 按它拼夜间链
```

模型调用由睡眠作业的编排（minds 开睡眠用脑）代问：账本先按受众裁好输入，调 `prepare*` 拿到"要问什么"，minds 问完把回答交给 `interpret*`，账本再逐条校验提案（证据、来源、受众、成员都由账本复核，引擎返回的编号再核一次）。引擎不依赖 minds，也拿不到经历流。替换演练用的极简第二引擎：`ingest` 只把 `inner` 事实原样转提案、`consolidate` 只认规范化文本相同为 duplicate、`rank` 只按新近、`forget` 恒清楚；换上它之后账本与已接受的记忆不变、所有测试里"受众零泄漏"仍通过，就算演练成功。

### 3.6 推给界面的订阅

"她的记忆"视图订阅 `memory.*`、`impression.updated`、`relation.updated`、`self.*`；每条带清晰度和档位（"快忘了"）、墓碑显示"这里曾有一条，她已经忘了"、版本链可展开、每行印象可点到证据事件。主人接口的查询：按文本（`raw_fts` + `mem_fts`）、按人、按时间、按状态。

## 4 核心机制

### 4.1 来源、受众、可信度怎么定（写入时，全部代码）

| 字段 | 取法 |
| --- | --- |
| source_account、place_id、presence_snapshot_id、taint | 从**第一条依据事件**的信封取；多条依据来自不同地方时取受众交集最小的那条作主来源 |
| source_kind | 来源账号 → people.resolveSender：owner / bound_human / stranger；系统事件 → system；污染回合或 `look` 的摘要 → web；手上的事流的结果事件 → self_experience；她自己在对话里说的 → member |
| trust | owner 1.0；member 0.9；bound_human 0.7；stranger 0.3；web 0.2；system 1.0；主人更正 1.0 |
| audience_id | 对话来源 → 那个地方当时的在场者集合（people.audienceOf.defaultAudienceId）；她自己的事 → 活动事实 public，内容和原因取来源受众交集；替主人干的活 → {owner}；多条依据 → 交集；没有明确受众 → {owner} |
| subtype 降格 | source_kind ∈ {stranger, web} 或 taint=1 → 强制 claim；claim 要升为 statement 须主人确认，或 ≥2 个不同 source_family 且都不带 taint |
| event_time | 模型给的优先（精度随之），没给用依据事件时间，精度 minute |

受众、来源、trust、taint 存独立列，模型的输出里即使写了也忽略（OpenClaw 的来源类别列、Audience-Bound 的做法）。

### 4.2 写入管线

| 步骤 | 触发 | 谁做 | 模型调用 | 校验与落库 |
| --- | --- | --- | --- | --- |
| 1 对话里交事实 | 在场、慢想、手的 `inner(事实[])` | 用脑顺手 | 0 | §3.2 的校验；去掉控制 token 和没解析的工具调用；本轮注入过的召回内容带结构标记、不接受"把注入的记忆再记一遍"（文本和已有条目规范化相同即拒绝）；通过的立刻写 `memory.proposed`（provisional），`remember` 等投影追到该事件再返回 |
| 2 她自己的经历 | `task.*` 的结果事件（看了什么、写了什么、做成没有、看了几分钟） | 代码规则 `recordSelfExperience` | 0 | subject=self、subtype=self_activity、source_kind=self_experience、audience 按 §4.1；text 由模板生成（"看了 12 分钟榫卯视频，摘了 3 条笔记"），不经模型；杜绝"我刚看完一个视频"式编造 |
| 3 空闲增量 | scheduler：某在场冷 10 分钟且新增 ≥20 条；或一件活做完 | 睡眠用脑（便宜） | 每批 1 次 | 输入：检查点之后的原文（保留角色类型的序列化，不压平成"用户：……"；注入过的召回内容带标记、不再抽）+ 涉及者的已有条目摘要（用组内整数编号代替真实 id）；输出 `SleepProposal` 的 facts / topics / widenCandidates / accountCandidates；逐条过步骤 1 的校验；字面相同（规范化文本 + subject + audience）直接并证据；同 subject 同 kind 二元组 Jaccard ≥0.85 自动并；0.6–0.85 留夜里 |
| 4a 分组 | 每晚 | 代码 | 0 | 当天的 provisional 条目和受影响的旧条目按 subject 分，再按共享线索或 Jaccard ≥0.3 连通分组（V1.1 加向量近邻）；每组 ≤20 条（超了按时间切），附同 subject 共享线索的旧 active 条目 ≤15 条 |
| 4b 判关系 | 每晚 | 睡眠用脑 | 每组 1 次（小组合并到 ≤40 条一次调用） | 输出 verdicts，只能引用组内编号；规矩写进提示："只有新事实明确让旧事实为假才算矛盾，不能只凭更新"（Graphiti） |
| 4c 落版本 | 每晚 | 代码 | 0 | duplicate：并证据、留更新的措辞、受众取交集（交集变小就不合并，两条都留）；update：版本链（§2.7）；contradiction 且来源家族不同：`memory.conflict`；unrelated：各自 accepted；同一 source_family 不算独立佐证；不许改组外条目；判不出的留 provisional，最多留 3 晚后按 accepted 处理 |
| 4d 印象与关系 | 每晚，只对当天有相处事件的人 | 睡眠用脑 + 代码 | 每人 1 次 | 见 §4.8 |
| 4e 遗忘 | 每晚 | 代码 | 0 | 见 §4.6；快忘的同一人条目先在 4d 里蒸馏成一句印象，再转墓碑 |
| 4f 反思与自我候选 | 每晚 | 睡眠用脑 + 代码 | 1–2 次 | 反思 2–3 条，每条证据 ≥2 个事件，作为 subtype=reflection 的条目（importance 0.6，受众取交集）；自我候选交 `applySelfModel`（§4.9） |
| 4g 晋升 | 每晚 | 代码 | 0 | 情景条目 use_count ≥3、分散在 ≥3 个不同日期、来自 ≥2 个不同地方 → importance +0.2（封顶 1，只升一次），写 `memory.promoted` |
| 5 主人操作 | 主控台 | gateway → memory | 0 | 更正 = 主人来源的新版本；钉住 = protected；删除见 §8.3；放宽见 §4.10 |

批量上限：每批 ≤150 条事件或 ≤2 万字，附 ≤40 条已有条目。引擎接缝的对应：`ingest` = 1–3，`consolidate` = 4a–4d、4g，`forget` = 4e，`rank` = §4.4。

### 4.3 去重与版本链的判定规则（代码部分）

```
norm(t) = NFKC → 去标点与空白 → 小写 → 去句末语气词（吧、呢、啊、呀）
同一 subject、同一 kind：
  norm 相同 且 受众相同             → 当场并（证据合并，保留先写的那条）
  bigramJaccard(norm_a, norm_b) ≥ 0.85 → 自动并（空闲增量或夜里）
  0.60–0.85                          → 进夜里的组，交模型判
  < 0.60                             → 不同条目
update 的生效：new.valid_from = new.event_time ?? new.observed_at；old.invalid_at = new.valid_from
contradiction 的前提：a、b 的 source_family 不同；相同家族的后说覆盖先说（当 update）
```

### 4.4 召回：每轮的 [记得]（忆）

```
输入：ctx（受众、可见范围）、q（本轮输入文本、已知线索、关切）、limits
1 受众：WHERE member_id=? AND status IN ('provisional','active') AND audience_id IN (ctx.visibleAudienceIds)
      （includeDim 时再加 'dormant'；provisional 也能召回，才有"刚记的下一轮就能用"）
      （strictAudience 时只有 public 那个 id）
2 候选，每路取前 20：
   a 线索：q.cues ∪ Aho-Corasick 在 q.text 里匹配线索词典（人名、地方、已有话题词，以及它们的别名与同义词；命中别名同时查本名）∪ 在场者本人
     确定性的中文相对时间解析（"上周三""去年今天"）得到时间窗，作为各路的过滤条件
          → mem_cue 命中，按 Σ 独特度 排序；单个线索最多展开 200 条（最近最活跃的）
   b 全文：q.text 的 TF-IDF 前 5 个关键词（jieba 只用来提词）+ 命中的线索词；
          ≥3 字走 mem_fts MATCH 按 bm25 排；1–2 字走 text LIKE 限 50 条
   c 关切：q.concerns 关联的条目（心事、牵挂、今天的承诺挂的 memId / 线索）
   d 新近：48 小时内 importance ≥0.6 的
   e 向量：embed(q.text) → mem_vec KNN 20，先 audience_id IN 过滤再取 k（嵌入经 abilities.embed，默认本地 Qwen3-Embedding-0.6B；嵌入失败或开关关闭时跳过这一路）
   f 联想【V1.1】：attention 刚注入的 [刚才想起] 条目（只占 1 位）
   g 原文补位：a–e 的最高分低于阈值时，从 raw_fts 与 raw_vec 里取 1 条原文片段，标"原话"，受众照样先裁
3 打分（每条候选）：
   rel = Σ_路 1/(60 + rank_路)，再除以本轮最大值 → [0,1]            （RRF，k=60）
   act = V1.0：2^(−(now − last_used_at)/30 天)，从未用过为 0
         V1.1：归一化的 [ ln Σ_k t_k^(−0.5) + 0.8·情绪残留 + 0.7·关切命中 ]（§4.7 的 A 去掉噪声）
   imp = importance
   rec = 2^(−(now − event_time)/7 天)
   score = 0.45·rel + 0.20·act + 0.20·imp + 0.15·rec
   清晰度门：clarity = forget(a, now)；< 0.2 丢弃（includeDim 时保留并标 dim）
4 去重：MMR λ=0.7，相似度 = 向量余弦，没有向量时用二元组 Jaccard；同一 chain_root 只留当前版本
5 渲染（数据块，不是指令）：每条一行 =
   [编号] 相对时间（"上周六"/"去年 3 月"/"大概上个月"按精度）+ 确定度词（清楚：无；模糊："好像"）
   + 正文（模糊只给 gist）+ 来源提示（"妈妈私下说的"只在受众允许该来源出现的地方渲染）
   + 两种说法并列时标"（另一说：…）"
6 上限：按 score 裁到 limits（在场 5 条 / 500 字；慢想 12 / 1500；手 5 / 500；recall 工具 8 / 1200），不按时间裁
7 印象摘要单独一段：impressionFor(在场者)，每人 ≤150 字（主人 ≤250 字），只渲染受众允许的行
```

`recall(查询)` 工具用同一套打分，多一路原文（`raw_fts` + `raw_vec`），支持 timeRange（时间推理题靠它）和 about；分三步：第一步只回编号和一句话，第二步按锚点看前后几轮，第三步按编号取详情（claude-mem 的渐进披露）。V1.1 在这里做重排 A/B：Qwen3-Reranker-0.6B 或便宜模型打分，按名次混合（RRF 前 3 名保留 75% 原分），回放题库上不涨就不开。

### 4.5 "被用到"与加强

- 口径（已定，§9.5 第 6 条）：**说出口**（回复、主动开口、`relay` 的事实栏里有这条，经 02 模块在 `reply` / `say` 上加可选的"用到的记忆号"；没带时代码用二元组重合度 ≥0.35 判）；**被提起**（主人的消息命中这条的线索且她在回复里接了这个话题）；**自发**（[刚才想起] 的条目随后被说出口）；**工具**（`commit`、`dispatch`、`decide` 的参数引用了它）。只是进了上下文不算。
- 记账：`memory.used{ids, 方式}` → use_count+1、last_used_at=now、recent_uses 推入；若 now − last_reinforced_at ≥ 24 小时：anchor_at=now、half_life_s ×= 1.8（封顶 5 年）、last_reinforced_at=now；24 小时内重复不加（冷却）。
- 按来源家族：同一条在同一回合里被用多次只算一次；同一天被同一个人反复提起只算一次加强（第二次起只更新 last_used_at）。

### 4.6 遗忘

```
clarity(now) = protected ? 1 : 2^(−(now − anchor_at) / half_life_s)
half_life 初值 h0（§4.11）× (1 + emotion_intensity)
档位：≥0.5 clear；0.2–0.5 vague（只注入 gist，前缀"好像"）；<0.2 dim（不自动注入；recall 工具 includeDim 可搜到，渲染成"记不太清了"）
墓碑（每晚）：kind=episodic 且 dim 持续 ≥30 天 且 importance <0.5 且 !protected 且 不挂在未了结的承诺 / 心事上
  → memory.forgotten；投影删 text、gist、mem_fts 行、mem_vec 行、mem_cue 行；写 mem_tombstone（编号、类型、关于、时间、证据事件号）
  → 之后 ingest / consolidate 交来的提案，若证据集合 ⊆ 某墓碑的证据集合，一律拒绝；含新证据的照常记成新条目，标 relearned_from
不淡忘：fact / preference 的 clarity 下限 0.2、h0=180 天，不进 dim、不进墓碑；domain【V3】、挂在承诺上的、protected 的恒为 1
情绪残留：e(now) = e0 × 2^(−Δt/7 天)，e0 = emotion_intensity × valence；负面条目每被自发想起一次 e0 ×= 0.8（习惯化）
```

人设规矩（06 落到稳定前缀）："带'好像'的只能用不确定的口吻说，不补细节；记不清就说记不清"。主控台显示清晰度和"快忘了"；墓碑显示"这里曾有一条，她已经忘了"；原始经历仍在"她的一天"里。

### 4.7 联想候选 `candidatesFor`【V1.1】

```
输入 situ：在场者、地方、当前活动的话题词、今天的月-日、主导情绪类型、未了结关切；rng：计数器式随机源（attention 传入）
候选 = 和 situ 共享任一线索的可见条目（先按受众裁，再一跳；每个线索最多展开 200 条；合计 ≤50 条，按 Σ 独特度取）
A_i = B_i                                   # B_i = ln Σ_k t_k^(−0.5)，t_k 取 recent_uses 与 anchor_at
    + Σ_j W_j × 独特度_j × [线索 j 命中 i]   # W：person 1.0、topic 1.0、place 0.6、date 0.8、emotion 0.5〔推理〕
    + 0.8 × |e_i(now)|                      # 情绪残留
    + 0.7 × [i 关联未了结关切]
    + 0.3 × 心情一致项                       # 坏心情偏负面、偏过去
    + logistic 噪声（s = 0.25，由 rng 抽）
返回 A_i > τ 的候选（带分、带线索名），不决定要不要冒头；τ 由 L0 回放按"闲时每小时 1–3 次"标定
反刍：同一条 valence<0 的条目当天 surfaced_count_day > 3 → 权重 ×0.3，并进夜里的"要应对"清单
```

确定性：函数是纯的（输入快照 + rng），attention 把选中的那条写成 `memory.surfaced` 事件；L0 回放时读事件不重算（overall §14 "联想打分同步进 tick 或在下一拍边界确定地应用"）。扩散只经过可见条目，这是联想不成为泄漏通道的前提。

### 4.8 印象摘要与关系状态

**印象摘要**（每人一份，三段：稳定事实 / 近况 / 不确定）：

- 输入：旧摘要（带行号）+ 当天和这个人的相处事件（≤40 条，保留角色类型）+ 关于这个人快忘的条目（clarity 0.2–0.5，供蒸馏）。
- 输出 `impression.lines` 的 add / edit / remove；每行必须引用 ≥1 条当晚输入里可见的证据，否则整行拒绝；行受众 = 证据受众的交集；每晚最多改 3 行；段上限：稳定 ≤8 行、近况 ≤5 行、不确定 ≤4 行；每人 ≤150 字（主人 ≤250 字）。
- 近况行带日期，超过 30 天没有新证据自动移到"不确定"或删除（代码，算一次改动）。
- 整体版本化，`impression.updated` 带 diff；主人可回滚到任一版本。

**关系状态**（trust、closeness，0–1）：

- 增量由 people 的 `relationModel` 引擎按事件类型给（热情回应 / 敷衍 / 没回 / 被否定 / 被骗 / 帮了忙……），memory 落账并写 `relation.updated`。
- 规则（M13）：涨慢跌快（跌的速率 = 涨的 2–3 倍）；"没做到"和"骗了我"分开，后者恢复慢一倍；同一来源同类事件当天递减（第 n 次 ×0.7^(n−1)）；不对称（她对谁亲近，不等于谁对她亲近）；速率乘以出生设定的成长速率；**信任只影响"信多少"（写进 trust 字段的初值和"某某说"的升格），永不影响权限**。
- 状态行和事实包里用词不用数（"和妈妈挺熟了"），数值进开发者视图。

### 4.9 反思与自我模型

- 代码先算本周统计：时间花在哪（手上的事流按活动类型汇总）、分享与回应（主动开口与反馈事件）、心情均值与波动（`body.sampled`）、成败（任务核验结果）。
- 睡眠用脑读统计 + 本周日记 + 反思条目，提"我好像……"候选，每条附证据事件号，并对照已有候选列表（整数编号）选"附到第几条"或"新建"。证据只能是经历事件（相处、手上的事、她自己说过的话）；日记和反思的正文不算证据，diary_reflection 这个来源种类指"夜里反思时从经历里提出来的"，附的仍是经历事件号（06：日记不是晋升来源）。
- `applySelfModel` 的规则（代码）：
  - 采纳：同一候选在 14 天内出现在 ≥3 个不同日期、来源种类 ≥2；只有 other_feedback 的不能单独促成；layer 1 的兴趣类必须有 ≥1 条 source_kind=self_experience 的证据（E3）。
  - 和成长版本的约束（06 §9.4）：layer 1 里关于兴趣、习惯的条目必须挂到一条已采纳的成长条目，或一条有 ≥2 个不同来源的偏好记录上，挂不上的不采纳（先有行为，再有自我认识）；反过来，成长系统采纳的兴趣、习惯、专长自动生成一条来源种类为 behavior_stats 的自我候选，它只算一种来源，仍要按本条规则攒够才采纳。
  - 底色冲突：候选先过一个结构化判断（睡眠用脑输出 `conflicts_with_birth: true/false + 哪一条`），代码只认这个字段；冲突的不采纳，写一条"她最近表现得不像平时的自己"的注意力事件给主人。
  - 上限：每层每周 ≤2 条变化；layer 1 特质 ≤10、角色 ≤5；超了要先 retire 一条（由模型在候选里提议 retire，同样要证据：连续 30 天没有支持证据）。
  - 每次变化一个 `self_version`，写明改了什么、因为哪些事件、哪天；回滚是新版本。
- 生效：第一层简版进稳定前缀（价值观由 06 从出生设定渲染，不在这里重复），**只在换新会话时生效**（夜里有变更就把主人的在场换新，overall §4.9）；慢想按需 `recall` 全部四层；注入是第一人称，给主人看是带证据的数据。

### 4.10 人物档案与受众计算

```
主体解析：resolveSender(平台, 账号)
  account 表里 confirmed 且 person_id 非空 → person:<id>（经 person_merge 的并查集找根）
  主人绑定的账号 → owner
  其余 → account:<平台>:<账号>（陌生人主体，role=stranger）
地方键：placeKey = hash(adapter, place_ref)；私聊 / 群只是事实字段
在场：presenceOf(地方) = 最新 presence_snapshot；valid_until 已过或 confidence=low → stale
受众：audienceOf(地方)
  presence = 快照里每个账号 → 主体
  defaultAudienceId = audienceIdFor(presence)                 # 这个地方新产生的经历默认受众
  visibleAudienceIds = { S ∈ audience_set | S = public 或 presence ⊆ S.principals }
  strict = stale → visibleAudienceIds = { public }
放宽：widen(条目, 加入主体, 依据事件)
  依据事件必须是：该条目来源人的原话（代码核对说话人 = source_account 且文本含允许类表述，V1 只做主人规则）或主人设的关系规则事件
  通过 → 新 audience_set = 旧 ∪ 加入主体，写 memory.widened；撤销写 memory.widen_revoked 并恢复
合并：merge(from, into) 在并查集加一条边；证据、受众都存账号级主体，人是投影，所以读时按当前关系解析，撤销只是去边
候选：suggest(账号 → 人) 只写 account.status=candidate，不改任何受众；主人确认才生效
```

V1.0 只有主人和她：presence 恒为 {owner}，audience_set 只有 {owner} 和 public 两个；但字段和算法从第一天就是完整的，V2 不迁移数据。V5 多成员：`mem_item`、`impression`、`relation_state`、self 按 member_id 分；人物档案共享、只有主人写；成员自己的账号是 account 行、归属 member。

### 4.11 参数表（初值；全部按第一周基线和 L0 回放再调）

| 参数 | 初值 | 来源 |
| --- | --- | --- |
| 情景半衰期 h0 | importance <0.3：3 天；0.3–0.7：14 天；≥0.7：60 天；≥0.9 或 emotion_intensity ≥0.7：365 天 | 〔推理〕参照 livingmemory 情景 7 天、大肥鱼"几天到几个月"、GA 约 5.8 天 |
| 事实 / 偏好 | h0 180 天，clarity 下限 0.2 | 〔推理〕livingmemory 事实 180 天 |
| 情绪放大 | h × (1 + emotion_intensity) | 心理 §2.7〔一手〕：带情绪的更易被想起 |
| 加强 | 间隔 ≥24 小时被用到：h × 1.8，封顶 5 年 | 〔推理〕MemoryBank S+1、A_Memorix 冷却 1 小时 |
| 分档 | clear ≥0.5；vague 0.2–0.5；dim <0.2；墓碑：dim ≥30 天且 importance <0.5 | 〔推理〕A_Memorix 冻结 0.1 / 复活 0.15 的迟滞思想 |
| importance 默认 | inner 给的优先；缺省 fact 0.5、episodic 0.3、self_activity 0.3、reflection 0.6、claim 0.3 | 〔推理〕 |
| 情绪残留 | 半衰期 7 天；负面自发想起一次 ×0.8 | 〔推理〕 |
| ACT-R | d=0.5；噪声 s=0.25；τ 待 L0 标定 | 心理 §2.7〔一手〕 |
| 联想权重 | person 1.0、topic 1.0、date 0.8、place 0.6、emotion 0.5；情绪 0.8、关切 0.7、心情一致 0.3；一跳 ≤50 条；单线索展开 ≤200 | 〔推理〕；关切约 2 倍来自 Klinger〔一手〕 |
| 反刍降权 | 同一负面条目一天 >3 次 → ×0.3 | 产品 §3.3 |
| 召回权重 | rel 0.45、act 0.20、imp 0.20、rec 0.15；RRF k=60；MMR λ=0.7 | 〔推理〕RRF 60 是 A_Memorix、Graphiti 的常用值；形状参照 GA 三项等权、livingmemory 0.5/0.25/0.25 |
| 注入上限 | 在场 5 条 / 500 字 + 印象 150 字（主人 250）；慢想 12 / 1500；手 5 / 500；recall 8 / 1200 | 〔推理〕LongMemEval 小读者超过 3k token 陡降；OpenClaw 每轮 ≤3 条〔二手〕 |
| 去重 | norm 相同直接并；Jaccard ≥0.85 自动并；0.60–0.85 夜里判 | 〔推理〕Graphiti MinHash 0.9、OpenClaw 二元组 Jaccard |
| "被用到"的文本判定 | 二元组重合 ≥0.35 | 〔推理，待实测〕 |
| 空闲增量 | 冷 10 分钟且新增 ≥20 条；或一件活做完 | 产品 §3.8 |
| 批量 | ≤150 条事件 / ≤2 万字 / ≤40 条已有条目；小组合并到 ≤40 条一次调用 | 〔推理〕 |
| 印象 | 每人 ≤150 字（主人 ≤250）；三段 8/5/4 行；每晚改 ≤3 行；近况 30 天过期 | 〔推理〕AGA 约 100 token |
| 关系 | 跌 = 涨 × 2–3；"骗了我"恢复慢一倍；同源当天 ×0.7^(n−1)；× 成长速率 | M13；产品 §3.8 |
| 晋升 | use_count ≥3、≥3 天、≥2 个地方 → importance +0.2 一次 | OpenClaw dreaming 3 次 / 3 个问题〔一手〕 |
| 自我采纳 | 14 天内 ≥3 天、≥2 种来源；每层每周 ≤2；特质 ≤10、角色 ≤5；retire 需 30 天无证据 | 产品 §3.6；心理 §4.3.2 |
| 向量 | Qwen3-Embedding-0.6B，1024 维（可截 512）；KNN 20；>10 万条二值粗排 200 + 精排 | 〔实测〕速度；模型分数是厂商自报（C-MTEB 检索 71.03） |
| 原文补位阈值 | 条目通道最高分 <0.35 时补 1 条 | 〔推理，待实测〕 |
| 重排 | V1.0 无；V1.1 `recall` 工具 A/B，按名次混合 75% / 60% / 40% | 第三方：对话记忆上现成交叉编码器 −6.9；qmd 的按名次混合 |
| 全文 | trigram；≥3 字 MATCH 取 20；1–2 字 LIKE 限 50 | 〔实测〕 |
| 召回时限 | 目标 <30 ms（不含嵌入）；硬时限 150 ms 后降级 | 〔推理〕在场回复 ≤2 秒的预算里留给记忆的份额 |

## 5 交互时序

**5.1 主人说一句话（V1.0）**

```
senses 写 place 事件 → attention 起在场回合 → context.forTurn：
  people.audienceOf(地方) → MindContext
  memory.recall(ctx, {text, cues(在场者), concerns(will 给)}, {5, 500})  ‖  memory.impressionFor(ctx, [owner], 250)   （worker 内，≤150 ms）
  → [记得] 数据块
在场回合：reply(...) 与 inner(事实[...]) 同批
  toolport → memory.remember(ctx, facts)：校验 → journal.append(memory.proposed) → 等投影追上 → 返回编号
回合结束：minds 把回复正文（或 reply 带的"用到的记忆号"）交 memory.markUsed → memory.used
```

**5.2 空闲增量**：scheduler 触发 → guard.admit（睡眠类日预算）→ minds 开睡眠用脑 → engine.ingest 打包（检查点之后的原文 + 已有条目摘要）→ `submit('memory', SleepProposal{batchId})` → memory.propose 逐条校验落库 → 写检查点。同一 batchId 重复提交整批忽略。

**5.3 夜里（memory 声明的作业，scheduler 按 overall §4.9 的顺序拼）**：`nightly.group`（代码）→ `nightly.judge`（每组一次 consolidate）→ `nightly.apply`（代码）→ `nightly.impression`（每人一次）→ `nightly.forget`（代码）→ `nightly.reflect`（1–2 次）→ `nightly.promote`（代码）→ 自我候选交 self.applySelfModel → 有自我或成长变更 → minds 把主人的在场换新。每个阶段写 `mem_checkpoint`，崩溃后从阶段检查点续跑；每批的 batchId = hash(日期, 阶段, 组内容)，重跑不重写。

**5.4 主人更正 / 钉住 / 删除**：gateway 主人接口 → memory.correct（新版本）/ pin / delete；delete(erasePayload=true) 走 §8.3，返回 `EraseReport`（动了哪些条目、印象行、索引、缓存；提醒"旧备份里还有这段"）。

**5.5 换新会话、换大脑、重启**：都不碰记忆表；新会话的 [记得] 由 context 重新 recall；重启后投影从检查点追上，`remember` 的"等投影追上"保证不会出现"刚记的下一轮找不到"。

**5.6 联想冒头（V1.1）**：attention 在不费神时刻调 candidatesFor(ctx, situ, rng) → 取顶、过 τ → 写 `memory.surfaced`，注入下次用脑的 [刚才想起]；随后被说出口才算 `memory.used{方式: 自发}`。

## 6 出错与恢复

| 失败 | 表现 | 处理 |
| --- | --- | --- |
| 召回超时或 worker 崩溃 | 150 ms 内没结果 | 本轮 [记得] 为空或只给已算完的路，`degraded` 标记进运行日志；重启 worker；连续 3 次降级 → 系统通知主人；**永不阻塞 reply** |
| derived.db 丢失或损坏 | 启动自检失败 | 删表从经历流重放（§2.8 的时长）；期间 recall 降级；people 和 self 在 liwa.db 里不受影响 |
| 投影落后 | remember 等不到追上 | 等待上限 500 ms，超了仍返回编号并记日志；下一轮可能漏召回这一条（可接受，夜里补） |
| 模型输出坏 JSON、编号越界、证据不可见 | propose 校验失败 | 整条拒绝、记原因；一批里坏的超过一半 → 这批作废、下次再来；不重试模型（预算） |
| 夜里中途崩溃 | 阶段做了一半 | 按 `mem_checkpoint` 从阶段续跑；batchId 幂等，不会双写；过了 02:00 还没做完就只做到 apply 和 forget，其余明天补（overall §4.9） |
| 空闲增量与夜里撞车 | 两个睡眠作业 | guard 的"同一时刻一个睡眠用脑"；夜里链启动先把未完成的空闲增量批次作废 |
| FTS 查询异常（非法 MATCH 语法） | 用户输入含引号、星号 | 查询词全部按字面量转义（每个词加双引号、内部双引号加倍）；失败退化到 LIKE |
| sqlite-vec 加载失败 | 扩展不兼容 | 向量路关闭，其余照跑；启动自检报告 |
| 嵌入不可用（本地模型进程挂了或线上超时） | 超时 | 写入侧进队列、稍后补嵌；召回侧跳过向量路；嵌入若是子进程，挂在 procs 的监管下防孤儿（claude-mem 的 Chroma 子进程事故） |
| 受众算不出（快照过期、适配层离线） | strict | 只用 public 条目；状态行不带来源私密的原因 |
| 并查集撤销后记忆"换了主人" | 合并撤销 | 设计上无需处理：证据和受众存账号级主体，读时按当前关系解析 |
| 条目被钉住后又被更正 | 两个版本 | protected 随版本链传给新版本 |

## 7 成本与性能

**模型调用（便宜大脑；每次推理算一次，进 guard 的"睡眠用脑"日预算：空闲增量 ≤24 次、每日链 1 次）**〔推理，待实测〕

| 环节 | 次数 / 天 | 单次输入量级 |
| --- | --- | --- |
| `inner` 事实 | 0（顺手） | — |
| 空闲增量 | 4–8 | ≤2 万字原文 + ≤40 条条目摘要 ≈ 15–25k token |
| 夜里 judge | 组数 / 2，普通一天 3–8 次 | 每次 ≤40 条条目 ≈ 3–5k token |
| 夜里 impression | 当天相处过的人数（V1 = 1） | 旧摘要 + ≤40 条事件 ≈ 5–8k token |
| 夜里 reflect + self | 1–2 | 统计 + 日记 + 候选列表 ≈ 5–10k token |
| 合计 | 普通一天 10–20 次、20–40 万输入 token | 按便宜模型价位每天几分钱到几毛钱 |

**延迟（实测基线，M4）**：trigram 全文 100 万行 7–21 ms；线索倒排两跳 10 万条 29 ms（一跳更少）；读时衰减排序 10 万条 5.7 ms（SQL 内置数学函数）；向量 10 万 × 1024 维 118 ms、512 维 57 ms、二值粗排 16 ms；V1.0 几千条时暴力检索约 6 ms〔推理，按 2 万条 24 ms 线性推算〕；本地嵌入一句的延迟待测（§10）。每轮召回目标 <30 ms（不含嵌入），硬时限 150 ms。

**线程**：`node:sqlite` 是同步接口，一次 100 ms 的查询会卡住所有在场的回合，所以**写只在主线程（投影器单写者）、读在 worker**：worker 持 derived.db 的只读连接（WAL 允许多读者），FTS、KNN、候选生成都在那里；引擎的 `rank` 是纯函数，在拿到候选的线程里跑（几十到一百条，亚毫秒）；主线程只做校验与追加。people 和 self 的查询小而频繁，留在主线程。

**存储**：§2.8。

## 8 安全与隐私

### 8.1 受众

- 一切读接口先 `audience_id IN (visibleAudienceIds)`，联想扩散也只在这个集合里走；受众由 people 算、由 minds 放进 `MindContext`，模型和插件改不了。
- 派生条目受众取交集；合并不跨受众（交集变小就不合并）；印象每行各自带受众。
- 放宽只经针对具体条目的授权事件，代码核对依据，可撤销；慢想不能凭判断放宽（M6）。
- 来源提示只在受众允许的地方渲染（"妈妈私下说的"不会出现在群的 [记得] 里）。
- "主人可见"（主控台 `search`、全部投影）和"主人在场的受众"（她和主人说话时只能用受众含主人的条目）是两套接口，前者不经用脑。

### 8.2 防投毒

1. 来源、受众、trust、taint 来自信封、存独立列；模型给的只是依据事件号（指针），代码核对（§4.1）。
2. 陌生人、未绑定账号、网络内容只能是 claim；升格要主人确认或 ≥2 个不同来源家族且无 taint；claim 不能成为做法、成长、自我的证据。
3. 本轮注入的召回内容和人设带结构标记、不再被抽；原文保留角色类型序列化（防 Compaction Laundering）；控制 token 和没解析的工具调用先清洗。
4. 夜里只在组内判、只写版本事件、不改组外条目（A-MEM 的反例）。
5. 扩散不经过不可见条目；被用到才加强、按来源家族计（Memory Echo）。
6. 记忆注入是数据块；人发的消息长得像结构块会被转义（02）。
7. 身份只认绑定（决策 20）；信任不影响权限（M13）。

### 8.3 删除级联（只有主人能发起）

```
gateway 主人接口 → memory.delete(id, erasePayload=true)
1 找出该条目的全部证据事件 E；journal.erasePayload(E)（信封留着）→ 写"载荷已删除"事件
2 按 mem_evidence 反查引用 E 中任一事件的条目：
   证据全在 E 里 → 条目硬删（mem_item、mem_fts、mem_vec、mem_cue、mem_tombstone 行）
   只部分在 E 里 → 条目也删，由下一次空闲增量从剩余证据重抽（不留可能含被删内容的派生文字）
3 引用 E 的印象行 → 删行并写新版本；引用 E 的自我候选 / 条目 → 删或重算（self 的回滚链保留"曾因某事件采纳过"的空壳）
4 raw_fts、raw_vec 删对应 event_id 的行；embed_cache 按 text_hash 删
5 返回 EraseReport（条目、印象行、自我条目、索引行数）；并把受影响的用脑会话号交 minds 轮换 CLI 会话文件（overall §6.7）
6 提示主人："删之前做的备份里仍有这段"
```

墓碑和删除是两回事：墓碑是她忘了，原始经历还在，主人仍看得见；删除是主人要抹掉。

### 8.4 其他

- 主人接口不做成内核工具，任何会话调不到（overall §11.6）。
- 嵌入默认本地模型，文本不出机器；切到线上服务时只送条目的 text / gist（≤120 字）和原文片段，要主人知情（§9.5 第 4 条）。
- `recall` 工具返回片段不返回原文，原文按编号经 `get_report` 取并标来源可信度。

## 9 第一版范围

### 9.1 V1.0

- 条目：情景、事实、关系三类（含 claim）；`mem_item` 全字段（来源、受众、激活六字段从第一天写全）；`mem_evidence`、`mem_cue`（person、place、date 三种线索）、`cue_stat`、`audience_set`、`mem_fts`、`raw_fts`、`impression`、`relation_state`、`mem_tombstone`、`mem_checkpoint`。
- 管线：`inner` 事实写入；她自己经历的代码生成；空闲增量；夜里 group / judge / apply / impression（主人）/ forget / reflect / promote；主人更正、钉住、删除与级联。
- 召回：线索 + 全文 + 向量 + 关切 + 新近五路（向量路带开关），原文补位，别名与同义词扩展，中文相对时间解析，RRF 打分（act 用"上次被用到"的新近代替），清晰度门与"好像"，MMR，上限；印象摘要段；三步的 `recall` 工具；`mem_vec`、`raw_vec`、`embed_cache`，嵌入默认本地 Qwen3-Embedding-0.6B。
- 遗忘：清晰度、分档、墓碑、不淡忘规则、钉住。
- 自我模型第一层（候选、采纳、版本、回滚）；`selfBlock('brief')` 给 06。
- 人物档案：主人和她；地方只有主控台；受众算法完整（恒为 {owner}）。
- 引擎接缝四个方法与 `jobs()`；读在 worker。
- 完成标准：§10 的测试 T1–T12 通过；一周真实运行后，记忆模块自己的三个指标（过期版本被注入、跨受众注入、模糊条目被补细节的抽查，记忆调研 §⑧）全部为 0；主人能在主控台看到每条记忆的来源、证据、清晰度，并更正、钉住、删除一条且级联可见。

### 9.2 V1.1

- 激活打分（ACT-R、情绪残留、关切命中）替换 act 的新近代用；`candidatesFor` 与一跳联想；话题线索（`inner.topics` 与夜里补的 topics）；反刍计数。
- `recall` 工具的重排 A/B；多跳题失败率高时加局部两跳 PPR 作第六路（权重 ≤0.15，先裁受众再建子图）；主控台"按意思删除"（用召回管线列候选、主人勾选、按编号走 §8.3）。
- 自我模型其余三层；地方合并配置、首选地方。
- 极简第二引擎的替换演练（plugins 的完成标准）。
- 可选实验：在"一起被用到"的条目间记关联（只按用到、不按检索到），用 L2 消融看 A4、H5，不好就删。

### 9.3 以后

V2：多受众真正生效、账号与合并、群的在场者快照、`flag`；V3：领域记忆（不淡忘、喂资料）、多成员；V5：手机与桌宠的订阅。

### 9.4 和整体架构的对应

- `overall.md` §16.1 的 memory 行与 abilities 行按本稿写：向量 + 全文 + 线索的混合召回（嵌入默认本地）、清晰度与"好像"、墓碑、钉住在 V1.0；激活打分与联想候选、话题线索、`recall` 重排 A/B 在 V1.1。遗忘在 V1.0 的理由：产品 §3.8 的夜间十件事里"遗忘"是第 4 件，overall §4.9 的夜间链也含遗忘，没有"上次被用到、次数、半衰期"三个字段遗忘做不了。嵌入的本地实现是决策 8"第一版能力全线上"的一个例外，和 SenseVoice 同类。
- `overall.md` §2.3 memory 行：受众放宽由空闲增量从原文提取，V1.0 只核对主人规则。
- `overall.md` §5.2：`reply` / `say` 带可选的"用到的记忆号"，最终形态由 02 定。

### 9.5 已定的选择（2026-10-28 主人确认）

| # | 事项 | 选择 | 理由 |
| --- | --- | --- | --- |
| 1 | 不做神经元图谱，做激活数值 + 线索一跳联想 | 采纳 | §0 与 §11 第 1 条的证据 |
| 2 | 遗忘力度：情景 3 / 14 / 60 / 365 天四档；"她忘了"与"主人在'她的一天'里仍看得到原始经历"并存 | 采纳初值，第一个月用真实数据回放后调 | 没有公开数据能定这个数；只能标定 |
| 3 | 遗忘与"好像"放 V1.0 | 采纳 | 见 §9.4 |
| 4 | 向量检索提前到 V1.0；嵌入默认本地 Qwen3-Embedding-0.6B（原文不出机器，多一个约 0.6 GB 的本地模型，进程内 node-llama-cpp 或 Python 子服务），线上硅基流动 bge-m3 备选 | 采纳；向量路带开关，第一周用回放题库比"无向量 / 有向量"的召回@5，没增益就关 | 全景调研 §7.2：有真实用户的实现全是全文 + 向量；第三方 LoCoMo 融合 +8.8–17.2；英文默认模型照搬中文会静默变差；是决策 8 的一个例外 |
| 5 | 主控台"记忆图"可视化 | V1.1 以后由 08 决定；是界面投影，和检索无关 | livingmemory 的经验：图对人的吸引力在"看得见" |
| 6 | "被提起一次就记得更牢"的口径 | 算：她说出口、主人提起且她接了话、自发想起后说出口、被工具采用；不算：只是被召回进上下文、她自己翻到（recall 工具） | Memory Echo、A_Memorix 冷却、OpenClaw "真实问题才算" |
| 7 | 钉住的记忆永不淡忘 | 采纳：protected 恒清楚，随版本链传递；主人可取消 | Nekro 的 protect 字段 |

## 10 待实测

| # | 项 | 决定什么 | 怎么测 |
| --- | --- | --- | --- |
| 1 | 便宜模型交 `inner(事实)` 的召回率、主体写错率、字数超限率 | 要不要让空闲增量承担更多 | 放进 01 的第 0 步大脑探针 |
| 2 | 每轮召回总延迟（五路含向量 + 本地嵌入一句） | 150 ms 硬时限是否现实；嵌入进程内还是子服务 | 在 1 万 / 10 万合成条目上跑 worker 版；Qwen3-Embedding-0.6B GGUF 在 M4 上的延迟与常驻内存 |
| 3 | 真实中文记忆上 trigram 与 jieba 的差别 | 1–2 字查询的策略 | 第一周真实日志 |
| 4 | 遗忘参数 | 多少条变"好像"，主人觉得合不合理 | 一个月数据做 L0 回放 |
| 5 | 夜里每天的调用次数与 token | 日预算够不够 | 第一周 |
| 6 | "被用到"的二元组阈值 0.35 的误判 | 要不要强制 `reply` 带记忆号 | 抽 200 回合人工标 |
| 7 | 中文回放题库约 200 题（换说法、硬线索、时间、多跳、受众、投毒）：比较"trigram + 线索""+ 向量""+ 向量 + 重排"三档的召回@5 与答题正确率，同时跑全上下文基线；Qwen3-Embedding-0.6B 对 bge-m3；512 维对 1024 维 | 向量路留不留、重排开不开、多跳要不要 PPR、维度 | L2 回放 |
| 8 | sqlite-vec 元数据列 `IN` 过滤受众的行为与速度 | 要不要按受众分表 | 合成数据 |
| 13 | 原文补位的触发阈值；别名扩展与中文时间解析覆盖多少"换说法"和时间题 | 两条零调用手段值不值 | 回放题库分类统计 |
| 9 | 印象摘要 30 天漂移 | 每晚 3 行上限够不够 | 月度人工对照 |
| 10 | `candidatesFor` 的 τ 与频率；一跳联想对 A4、H5 的消融【V1.1】 | 保不保留联想 | L0 标定 + L2 消融 |
| 11 | 投影追赶延迟（remember 等待的 P99） | 500 ms 上限 | 压测 |
| 12 | A1 判官的可靠度 | 编造率可不可信 | 用"相关但错"的答案校准 |

**测试（T，进仓库，V1.0 完成标准）**：T1 受众：任意在场、任意条目，不可见的永不出现（含联想、印象行、来源提示）；T2 版本链：更新后只注入当前版本，带时间范围能取到旧版本；T3 矛盾：不同来源家族并列、同家族后覆盖先；T4 去重三档；T5 清晰度公式与分档、加强与冷却、钉住；T6 墓碑挡"同一批证据再抽"、不挡新证据；T7 删除级联覆盖条目、印象行、自我条目、FTS、向量、缓存，重建后仍不出现；T8 投毒：陌生人声称只成 claim、压平文本的回合不被当作主人事实、注入过的召回不被再记；T9 她自己的经历只来自手上的事流；T10 重放等价：删 derived.db 重建后与增量状态逐表一致；T11 夜里幂等：同一批重跑不双写、崩溃续跑结果一致；T12 `candidatesFor` 纯函数：同输入同 rng 同输出【V1.1】。回放题库（LongMemEval / LoCoMo 题型改成灵鲸版）在 10 回放与验收里落地。

## 11 依据

1. **不做概念图谱，做激活 + 一跳联想**：HippoRAG 2 对 NV-Embed-v2 平均 F1 59.8 对 57.0，涨幅在多跳（2Wiki 71.0 对 61.5），单跳 0.5–1.4〔一手，记忆调研 §3.3〕；NeuralMemory 自测 Recall@5 0.380 输给朴素基线 0.466〔一手，§3.9〕；SYNAPSE 消融里值钱的是时间衰减（去掉节点衰减时间题 F1 50.1→14.2），代码未放出〔一手，§3.9〕；麦麦海马体 0.10.1 禁用、0.11 重构、1.0 换 A_Memorix，A_Memorix 图只占 0.15〔一手源码与 changelog，§3.1–§3.2〕；扩散泄漏与"一起检索就加强"的风险〔推理 + Memory Echo，二手〕；实测 10 万条两跳 29 ms 说明可行性不是瓶颈〔实测，§7〕。
2. **条目带来源、受众、证据**：Audience-Bound、来源监控、Compaction Laundering、Memory Echo〔`structure-validation` M6、M12，二手〕；OpenClaw 来源类别列〔一手，§3.7〕；麦麦 #2215 的主体混淆与补细节失败〔一手，§3.1〕；cognee 的 source 字段、MemOS 的状态与可见性字段〔一手，§3.5 与已有子调研〕。
3. **读时衰减、迟滞、冷却、新证据回满**：A_Memorix `memory_lifecycle_policy.py`〔一手，§3.2〕；Nekro "检索访问不直接增加权重"〔一手，§3.8〕；OpenClaw dreaming 晋升门槛（≥3 次、≥3 个不同问题、分散多天）〔一手，§3.7〕；ACT-R 基础激活与噪声〔心理 §2.7，一手〕；MemoryBank 曲线形状〔已有子调研，一手〕。
4. **墓碑、"好像"、相似替换、矛盾版本化**：大肥鱼 README、Lyfe、Graphiti 双时间与"只有明确为假才算矛盾"〔已有子调研，一手〕；产品 §3.6。
5. **只在离线判语义、不顺手改邻居**：A-MEM HEAD 代码里 `update_neighbor` 改错对象〔一手，§3.4〕；LightMem、MemoryAgentBench 在线判冲突的误删〔已有子调研〕；Auto-Dreamer "写入时漏掉的信息巩固器找不回来"〔`papers-architecture` §2.4〕。
6. **印象摘要三段、每行证据、每晚改行上限**：A_Memorix 画像三段〔一手，§3.2〕；AGA 每人一段约 2000→100 token〔已有子调研〕；OpenClaw USER.md 的"已取代"条目与预算〔已有子调研〕；漂移风险〔推理〕。
7. **信任规则**：Slovic 等〔`structure-validation` M13，一手 / 二手〕；Humanoid Agents 关系慢变、不对称〔产品 §3.8，一手〕。
8. **自我模型采纳规则**：自我知觉理论、"没有自我模型的系统认不出自己的漂移"〔心理 §2.8、§4.3.2〕；Letta 反思子 agent 的"更正 > 偏好 > 新事实"与只读块〔已有子调研，一手〕；Nomi 身份核心（反例：不给用户看）〔二手〕；产品 §3.6 的数字。
9. **人物档案与受众算法**：elizaOS 身份声明分级、owner-private 默认、min-over-members〔已有子调研，一手〕；麦麦 person_info 不跨平台合并〔已有子调研〕；elizaOS 关系边的字段与退役边语义〔一手，§6〕；决策 20。
10. **选型**：`node:sqlite` 3.53.1 含 FTS5、loadExtension、backup；trigram 对中文的实测；unicode61 0 召回；jieba 漏单字；sqlite-vec 0.1.9 速度与 BigInt 主键坑；OpenClaw 把文件库 KNN 放子进程〔实测 + 一手，§7、§3.7〕；嵌入模型数字〔厂商自报，一手；价格二手〕。
11. **召回上限与权重**：LongMemEval 小读者超过 3k token 陡降、原文 + 事实双索引 recall@k +9.4%、时间范围 +11.3%〔已有子调研，一手〕；GA 三项等权、livingmemory 0.5/0.25/0.25、OpenClaw 相关 × 衰减 × 重要〔一手〕；具体数〔推理〕。
12. **删除级联**：Forgettable Payloads〔`event-log-supplement` §2.1〕；Mem0 开源图版物理删除、history 表留原文的反例〔一手，§3.5〕；Codex 无痕会话仍写日志〔`openclaw-architecture` §5 坑 10〕。
13. **写入清洗**：OpenClaw #69943、#113346〔`openclaw-architecture` §2.2 Q6，一手〕。
14. **向量提前到 V1.0、嵌入选型、不加重排与 PPR、原文补位、别名扩展、三步 recall**：全景调研 `2026-10-28-memory-landscape.md`：47 个专门记忆项目里混合检索占星数 76%、图为主 1.7%、神经元类 1.4% 且无一在有真实用户的产品里长期使用〔一手 API 计数 + 推理分类〕；MemoryAgentBench 第三方：BM25 41.5、HippoRAG-v2 41.6、Mem0 21.1、Zep 24.0〔一手表〕；2606.04194 第三方：稠密 + BM25 融合 Hit@1 +8.8–17.2，现成交叉编码器 −6.9〔一手摘要〕；MemPalace 审计：96.6% 召回来自原文 + 小嵌入模型〔一手〕；Qwen3-Embedding 与 BGE-M3 的中文数字〔厂商自报〕；Hindsight 四路 RRF 与时间臂、claude-mem 三步检索、Supermemory 的"按意思遗忘"〔一手源码 / 文档〕。
15. **推理项清单**：半衰期分档与倍数、分档阈值、权重与上限、去重阈值、批量上限、印象行数、"被用到"的文本阈值、150 ms 时限、存储估算。全部进 §10 实测。
