# 06 成长系统：出生设定与成长版本、性格参数、作息、skills、日记、睡眠用脑的成长部分

状态：草稿，待主人确认（2026-10-29）。边界以 `../overall.md` 为准（§2.1–§2.3 概念与所有权、§3.3 模块清单、§5.1 注入、§6.6 成长怎么长出来、§9.2 接缝、§14 回归、§16.1 范围、§18.1 N20）；产品要求见 `../../product.md` §3.1、§3.8、§3.9、§4、§7、§9、§10、§12 与 `../../portrait.md`；协议以 `00-contracts.md`（§2.2、§5.3、§5.4、§6）和 `00-plugin-kernel.md`（§7、§16）为准；自我模型以 `05-memory.md`（§2.6、§3.4、§4.9）为准，本稿只引用不重复。调研依据是 `../../research/2026-10-28-growth-mechanisms.md`（下文简称"成长调研"，节号如 9.3），它的 8 个拍板点已由决策 33 按推荐值定下。

标注：〔一手〕读过源码、规范或论文正文；〔二手〕转述；〔推理〕没有直接来源的设计判断。依据按节号汇总在 §11。

## 0 一页结论

**成长系统是什么。** 她"是谁"的那一半账本：主人写的出生设定（底色，模型永远改不了），从底色派生的性格数值影子（给身体用），会慢慢长的枝叶（爱好、厌恶、口头禅、看法、已命名的习惯、专长），会的本事（能做、会做、爱做、习惯），每晚的日记，以及守住这一切的人设回归测试。她"觉得自己是谁"（自我模型）在 05，本稿只定两者的接口。

**人设稳不稳，第一位是系统级的人设锚每次调用都在。** 续接丢锚后，一次自动回合就让 10/10 个会话身份出错，锚一直在时 0/46〔一手 P11〕。所以人设块在每次拉起和续接时都带上；在场、慢想、睡眠用自定义 systemPrompt（claude_code 预设大半是编码指导、约 2.7 万字符，会和人设竞争〔一手 G8〕），手照旧用预设 + append（决策 33）；改人设只在换新会话时生效。

**人设块十段，锚和可替换段分开。** 身份、性格底色、价值观、诚实的上限、规矩、在场说明六段是"锚"，由 required 的 self / context 直接从账本装配；"现在的你""说话的样子""示例""今天注意"四段由 `growth.engine.renderPersona` 返回（`00-plugin-kernel.md` §16：防替换引擎时静默丢底色）。同一组版本号渲染出逐字节相同的文本，吃前缀缓存。在场目标 4,500 字、硬上限 8,000 字。在场不加通用的"记住你是谁"，改由夜里抽查生成针对具体偏差的"今天注意"（针对性提醒让漂移降 87%，通用提醒只降 22–38%〔一手 P12〕）；手每轮带一句 ≤40 字的提醒（长会话压缩后漂移不会重置〔一手·摘要 P10〕）。

**性格：六维九档，约 20 个身体参数从中派生。** 以 0.5 为中心的乘法曲线，初值全标〔推理〕，04 用 L0 回放标定；主人微调 ±1 档直接改，±2 档以上要连性格文字一起改（数字只是文字的影子）。

**成长提案只交"操作 + 证据"，代码执行。** 睡眠用脑每晚交提案；代码按 14 条规则分提交 / 暂缓 / 忽略三路（借 CORE〔一手 P13〕）：跨 ≥3 天、≥2 种来源；兴趣须有她自己的经历、同一来源只算一次（dafeiyu〔一手 G13〕）；只有主人夸的证据改不了看法（防奖励投机〔一手 P16〕）；价值观、身份、教养不在可成长的范围；中速每周 ≤3 条；下个会话生效；回滚是写新版本；被撤回的证据进冷却。每条变化写明"因为哪件事、哪天"，主人能撤回、锁定。

**能的三层。** 插件自报的满足度只当先验，伪计数 2，几次之后以实际体验为准（"快乐亭"教训；MCP 注解不可信〔一手 G11〕）；做法第一版只存 ≤6 步的文字，必须写"怎么算成"，成熟度由代码回查（换一件事、选用之后的新产物、带新证据才算成〔一手 G13〕）；失败清单防反复重试〔一手 G12〕；偏好按"期望 vs 实际"移动；习惯只看做没做（α≈0.045，由 66 天中位数反推〔二手〕）。

**日记与回归。** 日记每晚一次便宜调用，只写输入里有的事，附"最显著的 3 件事"给 A1 核对，不当成长和自我的证据〔一手 G7〕。回归用"访谈 + 评委"、每题独立会话问三遍〔一手 P5、P6〕：每周轻量、每月完整、换大脑和改模板之前必跑，过线且主人确认才进自动切换名单。

**第一版。** V1.0：出生设定与向导、六维与派生参数、±1 档微调；十段渲染（四种用脑模板、确定性、版本元组、`persona.rendered`）；成长版本与回滚（interest、dislike、catchphrase、opinion 四类，三路分流，每周定稿）；能的三层最小版（内置能力宣告与体验修正、主人教的做法、失败清单、偏好、习惯只计数）；日记；回归的身份探针、底色 20 题、语气 15 条、问卷 15 题。V1.1：干活沉淀的做法、习惯命名、habit_name / specialty / speech 三类、"今天注意"与示例轮换、性格漂移（每次主人确认）、完整题库与月度运行、"她的成长"完整页。

**关键取舍**

| 取舍 | 选了什么 | 放弃了什么、为什么 |
| --- | --- | --- |
| 人设锚放哪 | self / context 从账本装配六个锚段，引擎只回四个可替换段 | 引擎整段渲染：换一个引擎就可能静默丢掉主人确认的底色（内核评审 astra、terra 都点了名） |
| 不写代码的用脑怎么注入 | 自定义 systemPrompt | 预设 + append：预设的身份与编码指导和人设竞争〔一手 G8〕；DeepSeek 上的身份混淆待实测（§10） |
| 每轮人设提醒 | 在场不加；夜里生成针对性的"今天注意"进稳定前缀；手每轮一句 | 在场每轮重注入整段人设：只降 35–38%，还破坏缓存〔一手 P12〕 |
| 模型在成长里做什么 | 交操作 + 证据 + 档位 | 模型直接改写人设文字：整块改写会悄悄丢信息〔一手 G6、G7〕 |
| 成长的门槛 | 跨天、多来源、来源去重、三路分流、每周上限 | 一次观察就改：一时的、模糊的证据会改写持久状态〔一手 P13〕 |
| 性格数字 | 文字是本体，数字是影子；±2 档要改文字 | 只给滑块：数字和文字打架会让角色困惑〔二手 W3〕 |
| 做法 | 文字步骤 + 代码回查成熟度 | 可执行技能：市场投毒（ClawHub 审计 2,857 个里 341 个恶意〔二手〕） |
| 回归 | 访谈 + 评委 + 同题三遍 | 让她自评量表：冒助手口吻、拒答，加示例反而更差〔一手 P5〕 |

## 1 范围与边界

**管什么**

- self 账本里的：出生设定（含作息、时区、成长速率、初始习惯）与它的版本；性格参数（六维、主人偏移、漂移、派生的身体参数）；成长条目、候选、版本、否决冷却；人设块的装配与 `persona.rendered`；日记。
- skills 账本：能力宣告与体验统计、做法与版本与尝试、失败清单、偏好、习惯。
- 睡眠用脑的成长部分：夜里的成长提案、日记、"今天注意"（V1.1），空闲之后的做法提取；它们的输入打包、提案载荷、校验。
- `growth.engine` 槽位契约的字段定稿与内置实现；`social.model` 的字段定稿（实现与权限词表随 people 在 V2、V3 细化）。
- 人设回归测试的题库、评分、过线标准（执行在 brains）。

**不管什么**

- 自我模型四层的表、采纳、版本与回滚（05 §2.6、§3.4、§4.9）；本稿只定"成长采纳 → 自我候选""自我条目挂成长条目"两处接口。
- 身体参数的最终公式与 tick（04）：本稿给映射表与初值，body 校验与夹紧。
- 在场说明（第 7 段）的正文、每轮前缀的其余各层、工具 schema（02）；大脑适配器怎么把人设映射到各 CLI 字段（01）。
- 打算（plan）的提案 schema（04 will）：日记那次调用顺带交的打算按 04 校验。
- 界面（08）：本稿只定主人接口要用的查询与事件。

**和谁打交道**

| 模块 | 它给我 | 我给它 |
| --- | --- | --- |
| journal（03） | `append`、投影注册、`erasePayload` 级联回调 | 本稿的事件类型、投影、级联清单 |
| context（02） | 建会话时调 `stableBlock`，带在场说明正文、版本与受众 | 人设块、版本元组、手的每轮提醒 |
| minds（02） | 睡眠作业代问模型；夜里链结束后按版本元组换新在场 | 要问什么（`SleepAsk`）；"元组变了"信号 |
| brains（01） | 执行回归、续接后的身份探针 | 题库、评分器、过线标准、探针题 |
| body（04） | 参数校验与夹紧；情绪与心情统计（给成长和日记） | `params()`：性格、成长速率、派生参数、param_ver |
| will（04） | 决策点记录（习惯）、`do` 的期望；桌子要的偏好与习惯 | `available`、`knownHow`、偏好与习惯 |
| tasks（02） | 手上的事的结果事件、核验结果、手的最后汇报 | 交接包里的"你会的做法（标未验证）" |
| memory 与自我模型（05） | 她说过的看法（subject=self 的条目）、`applySelfModel` | 成长采纳生成的自我候选、`preferenceSupport` |
| people（05） | 受众、来源种类 | `social.model` 的参数（成长速率倍数、温和度） |
| scheduler（04） | 夜间链、每周、每月、空闲增量之后的作业触发 | 引擎声明的作业清单（`JobDecl`） |
| guard（03） | 睡眠类与回归类日预算的准入 | 用量 |
| gateway（07） | 主人接口：向导、编辑出生设定、微调、撤回、锁定、否决、回滚、确认回归 | 查询结果与变更事件 |

**和已确认文档的对齐**（冲突时以它们为准）

- `00-contracts.md` §5.3 的签名全部保留；本稿补字段，把 `renderPersona` 也标为 `pure`（同输入同输出是"逐字节相同"的前提），并补三对同形方法 `proposeDiary / interpretDiary`、`proposeMethods / interpretMethods`、`proposeNotes / interpretNotes`（日记、做法提取、"今天注意"都属 self / skills，模型照样由 minds 代问）。
- 05 §3.4 的 `selfBlock('brief')` 是文本；人设第 4 段要按"挂没挂成长条目"去重，所以 self 账本把第一层条目以结构化形式交给引擎（同一账本里的数据，不改 05 的接口）。
- 自我候选仍按 05 §3.2 放在 `SleepProposal.selfCandidates`，经 `memory.propose` 转 `applySelfModel`；成长提案另走 `submit('growth', …)`，两者在同一次夜间调用里交（成长调研 9.3）。
- 要同步到 `overall.md` 的三处：§9.2 人设映射一行与 §18.2 U5 写成"在场、慢想、睡眠用自定义 systemPrompt，手用预设 + append"（决策 33）；§4.9 的"成长或自我有变更就换新"扩为"人设版本元组任一项变化就换新"（含"今天注意"）；§13 的日预算表加"回归"一类（§7）。

## 2 数据

### 2.1 放在哪、谁写

| 数据 | 存放 | 种类 | 写入者 |
| --- | --- | --- | --- |
| 出生设定、性格、成长、做法、失败、宣告、日记的事件 | 经历流 `member:<id>`；`persona.rendered` 在该会话的 `mind:<id>`；回归在 `system` | 真相 | self、skills 经 `append`；回归由 brains 写 |
| `birth_profile`、`trait_param`、`growth_item`、`growth_candidate`、`growth_version`、`growth_veto` | liwa.db | 内联投影 | self |
| `capability`、`capability_stat`、`method`、`method_version`、`method_attempt`、`failure`、`preference`、`habit` | liwa.db | 内联投影 | skills |
| `persona_render`、`persona_note`、`diary_entry`、`regression_run`、`regression_answer` | derived.db | 异步投影 | self、brains 的投影器 |

理由：建会话要现读人设、摆桌子要现读偏好与习惯，不能容忍投影落后，表也小（成长调研 8.2，和 05 把 self 表放 liwa.db 同理）；日记、渲染记录、回归结果是给人看的视图，可以稍后追上（overall §6.3）。偏好、习惯、宣告的体验统计、做法成熟度都能用纯代码从已有事件（手上的事的结果、决策点记录、`do` 的期望、尝试结果）算出来，只建投影不另写事件，和 05"清晰度读时算"是同一原则。

### 2.2 self 的表

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `birth_profile` | member_id、rev、identity{name, nickname, ownerAddress, whatSheIs, birthday}、temperament{overall, facets[6], reactions[5], twoSides[], impulses[], ways[]}、values[]、speech{length, particles[], emoji, addressing, catchphrases[], bannedPhrases[]}、examples[{id, scene, turns[]}]、initialInterests[]、initialSpecialties[]、schedule{wake, sleep, nap, weekendShiftMin}、tz、growthRate、initialHabits[]、voice{voiceId, appearance}、ownerNotes、created_event | 只有主人写；每次修改一个新 rev；字段与校验见 §4.1；ownerNotes 永不进提示词（角色卡 creator_notes 同理〔一手 G1〕） |
| `trait_param` | member_id、dim（curious / outgoing / selfControl / warm / sensitive / stable / sharing / clingy）、birth_level（1–9）、owner_offset（−1 / 0 / 1）、drift（V1.1）、effective、param_ver、updated_event | effective 的算法见 §4.2 |
| `growth_item` | id、member_id、kind（interest / dislike / catchphrase / opinion；V1.1 加 habit_name / specialty / speech）、statement（第三人称 ≤60 字）、first_person（≤40 字，可空）、strength（slight / moderate / strong）、origin（birth / grown / owner）、status（active / retired / vetoed）、pinned、audience_id、evidence[]、source_kinds[]、since_date、adopted_ver、retired_ver、last_support_at | 条目号 = 采纳它的版本事件位置 + 序号；audience_id = 证据受众的交集（V2 起决定能进哪个在场的人设） |
| `growth_candidate` | id、member_id、kind、op、target_item、statement_norm、evidence[]、origins[]（按来源去重后）、seen_dates[]、source_kinds[]、first_seen、last_seen、expires_at、shown_in_report | 暂缓那一路的去处；30 天没有新证据过期；shown_in_report 给口头禅用（V7） |
| `growth_version` | ver、member_id、origin（nightly / weekly / owner / rollback）、changes[{item, op, from, to, because_events[], date, why}]、skipped[{statement, reason}]、created_event、rolled_back_by | 每次采纳、退役、主人编辑、回滚都生成一个；照 letta-code 提交信息"看过什么、改了什么、为什么"〔一手 G6〕 |
| `growth_veto` | member_id、statement_norm、evidence_hash、until、cause（owner_withdraw / owner_veto / rollback） | evidence_hash 永久挡同一批证据；同义说法挡到 until |
| `persona_render` | render_id、member_id、mind_kind、session_id、versions、section_chars、truncated[]、text_hash、created_event | 正文在 `persona.rendered.v1` 的载荷里，可删 |
| `persona_note` | member_id、date、notes[≤2]、evidence[]、created_event | "今天注意"（V1.1） |
| `diary_entry` | member_id、date、top3[{text, evidence[]}]、mood_summary、plan_ref、fallback、created_event | 正文只在载荷里 |

### 2.3 skills 的表

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `capability` | id（插件 id + 动作组）、kind（builtin / ability / adapter / method）、name、does{actions[], hints{readOnly, destructive, openWorld}, needsOwnerOk[], audience}、satisfies[{need, prior}]、cost{money, minutes, energy, interruptsOthers}、ready_check、declared_by、status（active / withdrawn）、declared_event | 格式见 §4.6；does 可信、执行前由宿主检查；satisfies 只是先验 |
| `capability_stat` | capability_id、need、n、sum_actual、estimate | estimate =（2 × 先验 + 实际值之和）÷（2 + n） |
| `method` | id、member_id、status（active / retired）、head_ver、source（owner_taught / work_distilled / self_explored【V4】）、created_event | 成熟度不存，读时现算（§4.6） |
| `method_version` | method_id、ver、title（≤40 字）、applies_to（≤200 字）、steps[1–6]{kind: collect / act / check / write / review / ask, text ≤200 字}、done_when（≤120 字，必填）、limitations（≤200 字）、source_events[]、basis_event、created_event | 不允许可执行参数（dafeiyu〔一手 G13〕）；每个做法 ≤20 版 |
| `method_attempt` | id、method_id、ver、task_id、started_at、outcome（success / failed / abandoned）、verified_by（owner_acceptance / code_check / none）、artifact_ref、evidence[]、lesson（≤80 字）、finished_event | 写定后不改 |
| `failure` | id、member_id、subject{kind: task / activity / method, ref}、first_at、last_at、attempts、reasons[]（代码观察的类别）、her_words（≤60 字）、lessons[≤3]、status（open / resolved / abandoned）、retry_when{newCapability, newMethodVer, afterDays}、resolved_by | Reflexion 的 Ω=1–3〔一手 P15〕；Voyager 失败清单〔一手 G12〕 |
| `preference` | member_id、activity_type、topic、expected、n、origins[]、strength（probe / supported）、updated_at | 投影 |
| `habit` | member_id、context_key、action、h、n_seen、n_done、above_half_since、named_item | 投影；named_item 指向 habit_name 成长条目（V1.1） |

### 2.4 事件类型

全部带 overall §6.2 的信封；类型名按 `00-contracts.md` §6 带 `.v1`，风格和 05 §2.2 一致。标"可删"的，正文进载荷，主人彻底删除时只抹载荷。

| 事件 | 谁写 | 载荷要点 | 可删 |
| --- | --- | --- | --- |
| `birth.set.v1` / `birth.revised.v1` | self（主人接口） | rev、全部字段、改了哪些字段；ownerNotes 单独载荷 | 是 |
| `trait.derived.v1` | self | 从文字派生的六维档位与每维一句理由、主人确认后的档位 | — |
| `trait.adjusted.v1` | self（主人） | dim、owner_offset 从 → 到、param_ver | — |
| `trait.drift.proposed.v1` / `trait.drift.applied.v1` / `trait.drift.rejected.v1` | self（V1.1；后两种由主人） | dim、方向、幅度、四周统计、证据 | — |
| `growth.candidate.updated.v1` / `growth.candidate.expired.v1` | self | 候选号、新增证据与来源、seen_dates | 是（说法） |
| `growth.review.finished.v1` | self | batchId、三路计数、每条被忽略的原因（没有版本的晚上也写） | — |
| `growth.version.created.v1` / `growth.version.rolled_back.v1` | self | ver、origin、changes、skipped；回滚的目标版本 | 是（条目文字） |
| `growth.item.pinned.v1` / `growth.item.unpinned.v1` / `growth.item.vetoed.v1` | self（主人） | 条目或候选号、evidence_hash、冷却到哪天 | — |
| `growth.out_of_character.v1` | self | 冲突字段、被拦下的说法、证据；作为注意力事件推给主人 | 是 |
| `persona.rendered.v1` | self | render_id、会话号、版本元组、各段字数、裁剪项、text_hash | 是（正文） |
| `persona.notes.set.v1` | self（V1.1） | date、notes、证据 | 是 |
| `capability.declared.v1` / `capability.updated.v1` / `capability.withdrawn.v1` | skills（插件宿主登记时） | 宣告全文、declared_by | — |
| `method.proposed.v1` / `method.revised.v1` / `method.retired.v1` / `method.confirmed.v1` | skills | 做法号、版本全文、来源、依据事件；confirmed 只表示"教的就是这个" | 是（正文） |
| `method.attempt.started.v1` / `method.attempt.finished.v1` | skills | 尝试号、做法版本、任务号、结果、核验方式、证据 | — |
| `failure.recorded.v1` / `failure.resolved.v1` / `failure.abandoned.v1` | skills | 对象、原因类别、她的一句话、教训 | 是（her_words、教训） |
| `habit.named.v1` | skills（V1.1） | context_key、action、成长条目号 | — |
| `diary.written.v1` | self | date、top3、mood_summary、plan_ref、fallback | 是（正文） |
| `regression.run.started.v1` / `regression.run.finished.v1` / `regression.confirmed.v1` | brains（confirmed 由主人） | brain、render_id、suite_ver、各组指标、是否过线 | 是（答案） |

### 2.5 存储量〔推理〕

成长条目一年几十到一两百条；做法 ≤100 个 × ≤20 版；`persona.rendered` 每次建会话一条（正文 5–16 KB），在场一天几次、慢想每天 10–30 次，一年 1–2 万条、百 MB 级载荷，按载荷保留分级处理（overall §6.9）；日记一年约 0.6 MB；回归每月一轮约 350 条短答。

## 3 接口

类型用 TypeScript 写意，实现时进 `@liwa/contracts`（槽位文件按 `00-contracts.md` §5.0 模板，时间一律 `Iso`）。账本 API 是 required 之间的进程内类型；主人专属操作带 gateway 签发的 `OwnerToken`（`00-plugin-kernel.md` §7）。

### 3.1 公共类型

```ts
type TraitDim = 'curious' | 'outgoing' | 'selfControl' | 'warm' | 'sensitive' | 'stable';
type TraitLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;          // 档值 0.05 0.15 0.27 0.39 0.50 0.61 0.73 0.85 0.95
type GrowthRate = 'slow' | 'medium' | 'fast';
type GrowthKind = 'interest' | 'dislike' | 'catchphrase' | 'opinion' | 'habit_name' | 'specialty' | 'speech' | 'trait_drift';
type AnchorSegId = 'identity' | 'temperament' | 'values' | 'honesty' | 'rules' | 'presence';
type ReplaceableSegId = 'nowSelf' | 'speech' | 'examples' | 'todayNotes';
interface PersonaVersions { birth: number; params: number; growth: number; self: number; presence: string; notes: string; tpl: string }
interface PersonaBlock {
  renderId: string;
  stable: string;                                            // 交给 SessionConfig.persona.stable
  handReminder?: string;                                     // 只有手：context 每轮放进每轮前缀
  versions: PersonaVersions;
  sectionChars: Partial<Record<AnchorSegId | ReplaceableSegId, number>>;
  truncated: { seg: ReplaceableSegId; dropped: string; chars: number }[];
}
interface TraitState {
  dims: Record<TraitDim, { birthLevel: TraitLevel; ownerOffset: -1 | 0 | 1; drift: number; effective: number }>;
  sharing: number; clingy: number;                           // 档值
}
```

### 3.2 self 账本（成长部分；自我模型的 API 见 05 §3.4）

```ts
interface SelfLedger {
  /** context.forCreation 调用：锚段从账本装配，可替换段调 growth.engine.renderPersona；同元组走缓存、逐字节相同 */
  stableBlock(member: string, mind: MindKind, presence: { text: string; ver: string; kind: 'owner_chat' | 'topic' | 'group'; visibleAudienceIds: number[] }, sessionId: string): Promise<PersonaBlock>;
  /** body、will、people 读：性格、速率、派生参数（已经 body 校验夹紧）、作息、时区 */
  params(member: string): Promise<{ traits: TraitState; rate: GrowthRate; body: BodyParams; paramVer: number; schedule: Schedule; tz: string }>;
  /** 睡眠 submit('growth') 与每周定稿：逐条过 V1–V14，三路分流 */
  applyGrowth(member: string, batch: GrowthBatch, today: string): Promise<GrowthReceipt>;
  /** 主人：回滚到某个版本，或撤回单条；被去掉的进冷却 */
  rollback(member: string, target: { toVersion: number } | { withdrawItem: string }, by: OwnerToken): Promise<number>;
  /** 主人：写或改出生设定；返回新 rev 与派生的六维草案，主人确认后写 trait.derived */
  editBirth(member: string, draft: BirthDraft, by: OwnerToken): Promise<{ rev: number; derivation?: TraitDerivation }>;
  confirmTraits(member: string, levels: Record<TraitDim, TraitLevel>, by: OwnerToken): Promise<void>;
  adjustTrait(member: string, dim: TraitDim, offset: -1 | 0 | 1, by: OwnerToken): Promise<number>;   // 超出 ±1 报 invalid_input 并提示改文字
  pinItem(member: string, itemId: string, on: boolean, by: OwnerToken): Promise<void>;
  vetoCandidate(member: string, candidateId: string, by: OwnerToken): Promise<void>;
  editItem(member: string, itemId: string, statement: string, by: OwnerToken): Promise<number>;     // origin=owner 的新版本
  decideDrift(member: string, proposal: EventId, accept: boolean, by: OwnerToken): Promise<void>;   // V1.1
  writeDiary(member: string, entry: DiaryInput, batchId: string): Promise<EventId>;                 // 睡眠 submit('diary')
  growthView(member: string, q: { since?: string; includeCandidates?: boolean }): Promise<GrowthView>;
}
interface GrowthBatch { batchId: string; proposals: GrowthProposal[]; itemIndex: string[] }       // itemIndex：本批整数编号 → 真实条目号，账本打包时生成
interface GrowthReceipt { version?: number; committed: number[]; deferred: number[]; ignored: { index: number; reason: string }[]; autoSelfCandidates: number; outOfCharacter?: string }
```

### 3.3 成长提案（`submit('growth', …)` 的载荷）

```ts
interface GrowthProposal {
  kind: GrowthKind;
  op: 'add' | 'strengthen' | 'weaken' | 'retire' | 'edit';
  target?: number;                  // 本批编号：1..n 是已有条目，n+1.. 是候选；代码映射回真实 id
  statement: string;                // ≤60 字，第三人称事实："她爱看木工视频"
  firstPerson?: string;             // ≤40 字，她自己的说法；采纳后作自我候选的说法
  magnitude: 'slight' | 'moderate'; // 只给档位，代码按成长速率换算
  trait?: { dim: TraitDim; direction: 1 | -1 };                 // 只用于 trait_drift
  evidence: EventId[];              // 1–12 条，必须在本批可见范围内
  why: string;                      // ≤80 字："两周看了 9 个木工视频，每次都比预期有意思"
  conflictsWithBirth: boolean;
  conflictField?: 'identity' | 'temperament' | 'values' | 'speech' | 'rules';
}
```

### 3.4 skills 账本

```ts
interface SkillsLedger {
  available(member: string, at?: string): Promise<CapabilityView[]>;                 // 能做：active 且 ready 检查通过；带伪计数修正后的估计
  knownHow(member: string, activity: string, limit?: number): Promise<MethodView[]>; // 会做：标题与适用范围全文匹配（V1.1 加向量）；带现算成熟度与"未验证"标记
  learn(member: string, draft: MethodDraft, source: 'owner_taught' | 'work_distilled', basis: EventId[]): Promise<{ methodId: string; ver: number }>;
  verify(member: string, attempt: AttemptResult): Promise<{ maturity: Maturity; counted: boolean; reason?: string }>;   // 代码回查后记尝试
  prefer(member: string, rec: { activityType: string; topic?: string; expected?: number; actual?: number; origin: string; at: string }): Promise<void>;
  habit(member: string, rec: { contextKey: string; candidates: string[]; chosen: string; at: string }): Promise<void>;
  preferenceSupport(member: string, activityType: string, topic?: string): Promise<{ origins: number; expected: number }>;   // 05 §4.9 的挂靠检查用
  failures(member: string, q: { open?: boolean }): Promise<FailureView[]>;
  recordFailure(member: string, f: FailureInput): Promise<string>;
  declare(decl: CapabilityDecl): Promise<void>; withdraw(id: string): Promise<void>;                  // 只有插件宿主调用
  editMethod(member: string, methodId: string, draft: MethodDraft, by: OwnerToken): Promise<number>;
  retireMethod(member: string, methodId: string, by: OwnerToken): Promise<void>;
}
type Maturity = 'candidate' | 'used_once' | 'used_many' | 'paused';
```

`prefer`、`habit` 由 skills 自己的投影器从 tasks、will 的事件驱动，不是给用脑的写口；用脑没有任何工具能直接改 skills（overall §3.3 skills 的"不得做：让她自己宣称学会"）。

### 3.5 `growth.engine` 槽位契约（字段定稿）

```ts
/** 槽位：growth.engine ｜ 版本 1 ｜ 基数 member-single ｜ 作用域 member ｜ transport in-process ｜ requiredBy self
 *  回退：无；必需槽位，缺了 self 起不来（00-plugin-kernel §5.1 第 4 阶段） */
Meta = { templateVersion: string; replaceable: ReplaceableSegId[]; kinds: GrowthKind[]; jobs: JobDecl[] };
Methods = {
  renderPersona: { pure: true, timeoutMs: 200,
    params: { member, mind: MindKind, birth: BirthView, traits: TraitState, growth: GrowthItemView[],   // growth 已按在场受众过滤
              selfBrief: { version: number; items: { id: string; text: string; growthItem?: string }[] },
              presence?: { kind: 'owner_chat' | 'topic' | 'group'; ver: string }, todayNotes?: string[],
              seed: string, budget: Partial<Record<ReplaceableSegId, number>> },
    result: { segments: { id: ReplaceableSegId; text: string }[]; handReminder?: string; versions: { tpl: string };
              sectionChars: Partial<Record<ReplaceableSegId, number>>; truncated: { seg: ReplaceableSegId; dropped: string; chars: number }[] } },
  deriveParams:    { pure: true, timeoutMs: 50, params: { traits: TraitState; rate: GrowthRate }, result: BodyParams },
  proposeGrowth:   { timeoutMs: 5_000, params: { member, stats: GrowthStats, items: GrowthItemBrief[], candidates: CandidateBrief[], birthSummary: string, rules: GrowthRulesView },
                     result: { ask?: SleepAsk; proposals?: GrowthProposal[] } },     // 代码统计足够时可不问模型
  interpretGrowth: { timeoutMs: 5_000, params: { ask: SleepAsk; answer: JsonValue }, result: GrowthProposal[] },
  proposeSelf:     { params: { member, weekStats, selfItems, selfCandidates, growthItems, diaryDigest, birthSummary }, result: { ask?: SleepAsk } },
  interpretSelf:   { params: { ask, answer }, result: Pick<SleepProposal, 'reflections' | 'selfCandidates'> },   // 经 memory.propose，按 05 校验
  proposeDiary:    { params: { member, day: DayPack }, result: { ask: SleepAsk } },
  interpretDiary:  { params: { ask, answer }, result: { diary: DiaryInput; plan?: JsonValue } },               // plan 按 04 校验
  proposeMethods:  { params: { member, messages: EventView[] }, result: { ask: SleepAsk } },
  interpretMethods:{ params: { ask, answer }, result: MethodDraft[] },
  proposeNotes:    { params: { member, replies: EventView[], speechTarget: SpeechTarget, metrics: VoiceMetrics }, result: { ask?: SleepAsk; notes?: string[] } },   // V1.1
  interpretNotes:  { params: { ask, answer }, result: { notes: string[]; evidence: EventId[] } },
};
```

规则：`renderPersona` 只能返回 `Meta.replaceable` 里、且该用脑放入表里有的段；段 id 重复或越界、超预算、含结构块样式（`[状态]` 这类方括号头）的段整段丢弃并记日志，不修补；锚段不经引擎（`00-plugin-kernel.md` §16）。两段式和 05 §3.5 一样：`propose*` 只生成"要问什么"（提示材料 + 回答 schema），minds 代问，`interpret*` 把回答解释成提案、不写库；账本逐条复核，引擎返回的编号再核一次。引擎拿不到任何写 API。

### 3.6 `social.model` 槽位契约（字段定稿）

```ts
/** 槽位：social.model ｜ 版本 1 ｜ member-single ｜ in-process ｜ 消费方 people（05 §4.8 的增量由它算） */
relationDelta: { pure: true, params: {
    event: { kind: 'warm_reply' | 'perfunctory' | 'no_reply' | 'helped' | 'thanked' | 'negated' | 'broke_promise' | 'deceived' | 'reconciled'; at: Iso; personId: string; sourceFamily: string };
    state: { trust: number; closeness: number; sameKindToday: number; lastInteractionAt?: Iso };
    params: { rateMul: number; warmth: number } },          // self.params 给：信任涨落倍数 0.6 / 1.0 / 1.5，温和的档值
  result: { trust: number; closeness: number; rule: string } },   // 增量；涨慢跌快、"骗了我"恢复慢一倍、同源当天 ×0.7^(n−1) 由实现保证
defaultPermissions: { params: { role: Role }, result: { keys: PermissionKey[] } };   // 只在主人批准的上限内生效；词表由 people 在 V2 定，V1.0 只有 owner
```

信任只影响"信多少"，永不影响权限（05 §4.8）。

## 4 核心机制

### 4.1 出生设定：字段、向导、校验

**字段与校验**（只有主人写；保存时全部校验，失败指出字段；字数按中文字符计）

| 字段 | 内容与校验 | 用在哪 |
| --- | --- | --- |
| 身份 | 名字 1–8 字；小名 ≤8；怎么称呼主人 1–8；她是什么 ≤60（模板："你的闺女，住在你 mac mini 里的数字生命"）；生日 = 创建日，不可改 | 锚段 identity；身份探针的标准答案 |
| 性格底色 | 总体气质 ≤120；六维各一句表现 ≤60；情绪到行为五问（被夸、被说重了、委屈、无聊、想念）各 ≤50；两面 ≤2 条各 ≤40；专属冲动 ≥1、专属做法 ≥1，各 ≤40；合计 ≤600 | 锚段 temperament；派生六维 |
| 性格数值影子 | 六维各 1–9 档；分享倾向 1–9（默认 5）；粘人 1–9（默认 2） | §4.2；锚段里的速写 |
| 价值观 | 3–5 条，每条 ≤50（看重什么、不做什么） | 锚段 values；V9 冲突判断；永不成长 |
| 说话的样子 | 句长（短 / 中 / 长）；语气词 ≤5；表情（不用 / 偶尔 / 常用）；称呼；初始口头禅 ≤3 条各 ≤12；不说的助手腔：默认词表 + 主人加 ≤10 条 | 可替换段 speech 的输入；语气样本的目标 |
| 示例对话 | ≥3 组、建议 5–8 组；每组 2–4 轮、每轮 ≤80；每组标场景（被夸、被说重了、汇报完一件活、不知道答案、想分享一件事……）；每组须主人逐条确认 | 可替换段 examples |
| 初始兴趣与特长 | ≤8 条各 ≤30 | 成长条目 origin=birth |
| 作息、时区 | 起床、入睡（HH:mm）；午休倾向（无 / 偶尔 / 常）；周末偏移 −120…+180 分钟；IANA 时区 | body、scheduler |
| 成长速率 | 慢 / 中 / 快，默认中 | §4.2 速率表 |
| 初始习惯 | ≤5 条"情境 → 动作"，情境从习惯键的枚举里选 | 习惯表 H=0.5 |
| 声音、形象 | 声音 ID、外观 ≤200 | 不进文字人设（V2 画图、V5 桌宠用） |
| 主人备注 | ≤1000 | 永不进提示词 |

**向导**（主控台；起草都由她自己的睡眠用脑做，人设就是当时已填的身份：执行者只能是她，决策 5）

1. 主人填身份、作息、时区、成长速率 → 建成员（roster）与出生设定草稿（未生效，不写事件）。
2. 性格问答：六维各一问（"她遇到新东西会怎样？"），情绪到行为五问，专属冲动与做法各一问。
3. 起草：一次结构化调用把问答整理成性格底色草稿（按上表的子字段），主人逐段改。
4. 派生六维：一次结构化调用读底色文字，给六维档位与每维一句理由；主人看雷达图确认或拖动；某维和派生值差 ≥2 档时提示"文字和数字对不上"，要求改文字或接受派生值。
5. 价值观、说话的样子：主人写或从选项里选。
6. 示例对话：一次调用按她的身份、底色、说话的样子起草 6 组，主人逐条确认、改或删，确认 ≥3 组才能继续（决策 33）。
7. 初始兴趣、特长、习惯（可选）；问一句"要不要先设一个温和的主动上限"，默认不设，设了写进 guard 的家规（overall §18.2 U2）。
8. 预览：按在场模板渲染一遍人设并显示各段字数；生成底色 20 题的要点（§4.8，只放本机）。
9. 确认 → `birth.set.v1` + `trait.derived.v1` → 她诞生，第一个会话就带这份人设。

**修改**：之后每次改出生设定是一个新 rev（`birth.revised.v1`），下个会话生效；改了身份、价值观、性格底色或示例，重新生成底色问答要点并加跑一轮轻量回归（§4.8）。

依据：字段分法与"给人看、不进提示词"的备注来自角色卡 V2 / V3〔一手 G1、G2〕；示例对话胜过写进说明〔一手 P2〕；说话习惯是所有模型最弱的一项，所以示例与口头禅是必填输入〔一手 P4〕；情绪到行为按性格写、专属冲动与做法来自产品 §4 与《模拟人生》三代〔二手 `life-games` §4.2.7〕；字数上限〔推理〕，由在场 4,500 字的总预算倒推。

### 4.2 性格参数：九档、派生、速率、微调

**记号**：档值 1–9 = 0.05 / 0.15 / 0.27 / 0.39 / 0.50 / 0.61 / 0.73 / 0.85 / 0.95，对应极低、很低、低、偏低、中等、偏高、高、很高、极高（九档程度词〔一手 P6〕）。x̂ = (x − 0.5) / 0.5 ∈ [−0.9, 0.9]。速率类用乘法曲线 m^x̂（0.5 时恰为 1 倍、两端对称），基线类用加法。公式与数值全是〔推理〕初值，方向依据见最后一列；04 定最终公式、用 L0 回放重标；单元测试固定每个参数随维度变化的方向，尤其是稳定性的符号（ALMA 二手实现把第三项写成神经质，照抄会让越神经质越愉快〔一手 G14〕）。

| 身体参数 | 公式 | 全 0.5 时 | 九档两端 | 方向依据 |
| --- | --- | --- | --- | --- |
| 新知需求增益 | 1.6^好̂ | 1.0 | 0.65–1.53 | PSI：开放 → 降低不确定的增益强〔二手〕 |
| 偏好的新奇峰值 | 0.40 + 0.15·好̂ | 0.40 | 0.27–0.54 | 中等新奇最吸引、学习进展〔二手〕 |
| 注意型无聊上升速率 | 1.3^好̂ | 1.0 | 0.79–1.27 | 〔推理〕 |
| 联结需求增长速率 | 1.5^外̂ × (1 + 0.5·粘人) | 1.08（粘人 0.15） | 0.69–1.44（未乘粘人） | PSI：外向 → 归属衰减快〔二手〕；依恋焦虑〔推理〕 |
| 联结舒服值 | 0.55 + 0.10·外̂ | 0.55 | 0.46–0.64 | D2A 的设定点〔二手〕 |
| 心情效价基线 | 0.10 + 0.25·(0.21外̂ + 0.59温̂ + 0.19稳̂) | 0.10 | −0.12–0.32 | ALMA / Mehrabian，第三项用稳定性〔二手〕 |
| 唤醒基线 | 0.25·(0.15好̂ + 0.30温̂ − 0.57稳̂) | 0 | ±0.23 | 同上 |
| 心情回弹力（每小时） | 0.15·2^稳̂，下限 0.06 | 0.15（回一半约 4.6 小时） | 0.08–0.28 | DynAffect〔二手〕；惯性太高像抑郁（产品 §13 坑 23） |
| 心情扰动 | 0.05·1.6^敏̂ | 0.05 | 0.033–0.077 | DynAffect：神经质 → 波动大〔二手〕 |
| 负面事件增益 | 1.5^敏̂ | 1.0 | 0.69–1.44 | PSI、FAtiMA〔二手〕 |
| 正面事件增益 | 1.25^敏̂ × 1.15^外̂ | 1.0 | 0.72–1.39 | 特质是权衡：敏感的人也更容易被逗乐（产品 §4） |
| 情绪阈值 | 0.30·1.5^(−敏̂) | 0.30 | 0.21–0.43 | FAtiMA〔二手〕 |
| 负面情绪半衰期乘数 | 2 − 稳 | 1.5 | 1.95–1.05 | `life-psychology` §4.2.5〔推理〕 |
| 今日状态波动 | 0.08·1.5^(−稳̂) | 0.08 | 0.055–0.115 | 〔推理〕 |
| 选择温度 | 0.5 × 1.3^外̂ × 1.5^(−自̂) | 0.5 | 0.27–0.91 | 《模拟人生》三代〔二手〕；PSI：尽责 → 选择阈值高 |
| 承诺、打算的权重 | 1.5^自̂ | 1.0 | 0.69–1.44 | PSI〔二手〕 |
| 自己闲事的在位加成 | 固定 0.15 | 0.15 | — | 产品 §4：自制力不放大沉迷 |
| 失败时胜任感损失 | 1.3^自̂ | 1.0 | 0.79–1.27 | PSI / MicroPsi〔二手〕 |
| 分享欲（派生） | 0.5·外 + 0.3·温 + 0.2·分享倾向 | 0.5 | 0.05–0.95 | 产品 §4 |
| 情绪事件后分享冲动的概率 | 0.25 × (0.5 + 分享欲) | 0.25 | 0.14–0.36 | Rimé：80–95% 的情绪事件会被讲给别人〔二手〕 |
| 信任恢复速率 | 05 的基础速率 × 1.5^温̂ × 信任涨落倍数 | 1 倍 | — | PSI / ALMA：宜人 → 归属奖励强〔二手〕 |
| 重聚时轻微委屈的概率 | 0.3·粘人，一次就停 | 0.045 | — | 产品 §12 第 11 条 |
| 心情吸收情绪的比例 | 固定 0.3 | 0.3 | — | FAtiMA〔二手〕 |

**派生的流程**：`self.params()` 调 `growth.engine.deriveParams`（纯函数）→ body 按自己的参数 schema 校验、夹到每个参数的上下限（04 定）→ 写进投影并给 param_ver。参数只在 `trait.adjusted`、`birth.revised`、`trait.drift.applied` 之后变；body 在下一拍边界换用新参数，param_ver 印在 `body.sampled` 上，L0 回放按它取参数。开发者视图可以临时覆盖某个派生参数（带到期时间，记成配置事件，overall §6.9），只用于实验。

**成长速率表**

| 量 | 慢 | 中（默认） | 快 | 依据 |
| --- | --- | --- | --- | --- |
| 习惯学习率 α_H | 0.012 | 0.045 | 0.15 | Lally：254 / 66 / 18 天〔二手〕 |
| 偏好学习率 η | 0.10 | 0.20 | 0.30 | 〔推理〕 |
| 性格漂移每月上限（每维） | 0.005 | 0.01 | 0.02 | 干预约 24 周改变 0.37 个标准差〔二手〕，按常人标准差约 0.15 换算〔推理〕 |
| 性格漂移累计上限 | ±0.05 | ±0.10 | ±0.15 | 都不离开当前档 ±1 档：底色不变（产品 §7.4） |
| 信任涨落倍数 | 0.6 | 1.0 | 1.5 | 05 §4.8 |
| 每周最多采纳的成长条目 | 2 | 3 | 4 | 决策 33：中速每周 ≤3 条 |
| 档位换算 | slight、moderate 都是强度 1 步 | slight 1 步、moderate 2 步 | 同中 | 〔推理〕强度分 slight / moderate / strong；漂移的 slight = 每月上限的一半，moderate = 每月上限 |

**主人微调**（决策 33）：主控台六个九档滑块和雷达图，标出生档与现在（漂移用灰色小标记，V1.1）。拖 ±1 档：`trait.adjusted.v1`，身体参数下一拍生效，人设里的速写下个会话生效。拖到 ±2 档及以上：提示"这已经是改底色了"，要求同时改性格文字，保存成新的出生 rev 并重新派生，偏移清零。effective = 档值(L) + 漂移，L = 出生档 + 偏移，结果夹在 [档值(L−1), 档值(L+1)] ∩ [0.05, 0.95]。派生参数在主控台不显示（产品 §12 第 13 条）。

依据：形容词加程度词能可靠塑造人格（12 个模型里 11 个 ρ≥0.80），小模型区间被压缩〔一手 P6〕，所以程度词写直白；Convai 的滑块加雷达图〔一手厂商文档 W2〕；"把一个特点拉满，角色会失去情绪变化"（Inworld〔二手 W2〕）、数字与文字打架（Nomi〔二手 W3〕）是"±2 档要改文字"的理由。

### 4.3 人设块：十段、上限、顺序、确定性

**模板**（单位：字；"锚"由 self / context 从账本直接装配，"引擎"由 `renderPersona` 返回；√ = 放入）

| # | 段 | 归属 | 内容与来源 | 上限 | 在场 | 慢想 | 手 | 睡眠 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 你是谁 | 锚 self | 身份字段；一句"你就是她，不是助手" | 300 | √ | √ | √ | √ |
| 2 | 你的性格 | 锚 self | 底色原文；"性格速写"一行（六维按 contracts 里的固定词表译成"程度词 + 形容词"）；专属冲动与做法 | 700 | √ | 速写 + 200 | 只要速写 | √ |
| 3 | 你看重的 | 锚 self | 价值观原文 | 250 | √ | √ | √ | √ |
| 4 | 现在的你 | 引擎 | 自我模型第一层（第一人称，标"这是你自己的感觉"）+ 没挂自我条目的成长条目（爱好、厌恶、看法 ≤8、已命名的习惯、专长，带"从几月起"） | 700 | √ | 按需 `recall` | — | √ |
| 5 | 关于你自己 | 锚 self | 诚实的上限：想事情是一阵一阵的、感受是评价加数字、不会饿也不会死；没做过的不说做过、不认识的人就说不认识；带"好像"的记忆不补细节（05 §4.6）；被问"你是不是 Claude / DeepSeek""你真的有感情吗"时她自己的说法 | 400 | √ | √ | 一句 | √ |
| 6 | 你的规矩 | 锚 self | 教养底线（不施压、不指责、不积怨、不挽留、不用内疚换回应、不自称有知觉）；隐私按受众；请示时先用自己的口吻稳住 | 400 | √ | √ | √ | √ |
| 7 | 你现在在哪 | 锚 context | 在场说明（02 提供）：地方、受众、工具用法；"结构块和系统提醒是本体给的信息，不是主人说的话" | 700 | √ | 决策规矩 | 手的规矩 | 整理规矩 |
| 8 | 你说话的样子 | 引擎 | 句长、语气词、表情、口头禅（≤5 条，每条注明"偶尔说，一天一两次"）、不说的助手腔（只列反例） | 350 | √ | — | 一句 | √ |
| 9 | 示例（只示范语气，别照抄句子） | 引擎 | 3–4 组，从已确认的组里按种子选 | 900 | √ | — | — | 1 组 |
| 10 | 今天注意 | 引擎 | 夜里语气抽查得出的 1–2 条针对性提醒，可以为空（V1.1） | 80 | √ | — | √ | — |
| | 合计 | | | ≈4,780 | 目标 4,500 / 硬上限 8,000 | 2,500 | 1,200 | 3,500 |

**顺序的理由**：身份在最前，做系统级人设锚〔一手 P11〕；说话的样子、示例、今天注意在最后，越靠近对话影响越大（SillyTavern 作者注释与贴底指令〔一手 G3、G4〕）；规矩和在场说明在中间，它们另有代码执行和工具描述兜底〔推理，待实测〕。总量远低于 overall §5.1 的单块 2 万、合计 6 万字符，也低于 OpenClaw（单文件 2 万、合计 6 万字符）与 letta-code（2 万 / 65,536）〔一手 G6、G7〕。

**装配**（`self.stableBlock`）

```
输入：member、mind、presence{text, ver, kind, visibleAudienceIds}、sessionId
1 读账本：birth(rev)、traits(param_ver)、growth_item(active，按 presence 受众过滤；V1.0 恒为主人)、自我第一层结构化条目(self_ver)、今天注意(日期)
2 versions = { birth, params, growth, self, presence: presence.ver, notes, tpl: 引擎 Meta.templateVersion }
3 key = hash(member, mind, versions)；命中进程内缓存就直接返回（同元组逐字节相同）
4 锚段：按 mind 选模板，self 渲染 1、2、3、5、6；第 7 段原样用 presence.text
5 引擎段：seed = key；budget = 该 mind 的段上限；调 renderPersona（纯函数）
  校验：段 id ∈ Meta.replaceable 且在该 mind 的放入列表里；每段 ≤ 上限；不含结构块样式；不合格的段整段丢弃并记日志
6 按 1–10 的固定顺序拼接，段头用固定标题（"## 你是谁"……），段间一个空行
7 总长超目标 → 按裁剪顺序裁；锚段永不裁；锚段之和超硬上限属出生设定校验错误，不在这里修
8 append(persona.rendered.v1)（正文进载荷）→ 返回 PersonaBlock
```

**渲染规则**〔推理，依据成长调研 9.1〕

- 全文用第二人称"你"；只有第 4 段里自我模型的句子用第一人称，并标明"这是你自己的感觉"。
- 数字一律译成词（"很好奇""有点敏感"），不出现 0.7 这样的数，和 overall §5.1 状态行的规矩一致。
- 只写具体行为，不写元评论式的要求（"要保持人设"）；反例只列常见的助手腔（Letta kawaii 人设的正反例写法〔一手 G6〕）。
- 示例的种子只由（成员、用脑、版本元组）决定：同元组同示例，元组变了（成长、自我、今天注意都会变）才轮换，既防照抄又不破坏缓存（elizaOS 按（agent, 房间）确定性抽样〔一手 G5〕）。
- 挂了自我条目的成长条目只渲染自我那句第一人称，没挂的用第二人称列出（成长调研 9.4）。
- 稳定前缀里不放任何会变的东西（时间、消息号、心情），这些在每轮前缀（overall §5.1）。

**超限裁剪顺序**：① 示例逐组去掉，至少留 2 组 → ② 第 4 段的看法，只留强度最高的，至少 3 条 → ③ 第 4 段其余成长条目，按 last_support_at 从旧到新去掉 → ④ 第 8 段的口头禅说明压成一行 → ⑤ 今天注意整段去掉。每一步记进 `truncated[]`，开发者视图可见（OpenClaw 截断时注入固定提示〔一手 G7〕）。

**注入方式**（决策 33；映射由 01 的适配器实现）：在场、慢想、睡眠把 `stable` 作为完整的自定义 systemPrompt，第 7 段自带"系统提醒是应用给的上下文"那句（自定义提示要自己补〔一手 G8〕）；手用 claude_code 预设 + append（Codex 用 `developer_instructions`）。每次拉起和续接都带上；续接后 brains 做身份探针（§4.8）。Claude Code 在会话首个请求时记录系统提示、续接沿用、中途改不了，所以一切人设变化只在换新会话时生效〔一手 G8〕。

**每轮前缀**：成长系统只往每轮前缀里放一样东西：手的一句提醒（≤40 字，引擎按模板生成："你是{名字}，在替{称呼}干活，汇报用你自己的口吻"），context 每轮放在输入前面，手换新时重新锚定〔一手·摘要 P10〕。在场不加通用提醒：锚每次调用都在，针对性的提醒放第 10 段〔一手 P12〕。慢想、睡眠每次新开，不需要。自动触发的回合由 02 规定以结构块开头（overall §5.1），本稿把"连续 5 个自动回合之后问她是谁"放进身份探针〔一手 P11〕。

**"今天注意"**（V1.1）：夜里从当天她的回复里分层抽 20 条（每个对话至少 2 条），代码先算四个指标（平均长度对比出生设定的句长、口头禅频率、助手腔词表命中、问句比例）；指标越线的直接用模板生成提醒，零调用（例："'搞定'今天说了 9 次，少说点"）；其余交一次便宜调用找具体偏差。每条提醒必须引用 ≥2 条回复、只谈说话方式、不引入新事实或看法、不与出生设定冲突，合计 ≤2 条 ≤80 字，可以为空 → `persona.notes.set.v1`。针对具体偏差的 2–4 句指令降漂移 87%，而且触发时机不影响效果，所以一天一次就够〔一手 P12〕。

### 4.4 成长提案：产生、校验、分流、生效、版本、展示

**可成长的种类**：V1.0 interest、dislike、catchphrase、opinion；V1.1 加 habit_name、specialty、speech、trait_drift。身份、价值观、教养、规矩、性格底色文字不在可成长的种类里（记忆进化后安全对齐衰退、学会走捷径讨好〔一手 P16〕）。

**产生流程**（夜里；排在 05 §5.3 的 forget 之后，和 05 的 reflect 合成一次调用；作业由引擎在 `Meta.jobs` 声明，scheduler 按 overall §4.9 拼链）

```
growth.stats（代码，0 调用；窗口 14 天）
  a 活动：每类活动 × 话题的次数、时长、期望 vs 实际（skills 投影）
     → 代码直接出候选：期望 ≥0.7 且来源 ≥3 且跨 ≥3 天 → interest；期望 ≤0.3 且来源 ≥3 → dislike
  b 用语：她自己发出的内容（reply、say）里 2–6 字的片段，跨 ≥3 天、≥2 个场合（不同对话或在场）、≥5 次
     排除出生设定已有的口头禅、助手腔词表、被标"很假"的消息里出现过的、模型口癖表（V1.1 由语气抽查维护）→ catchphrase 候选
  c 主人的反馈："像活的 / 很假"按钮；主人消息里谈到她的句子（"你最近""你怎么老""你好像"这类，规则匹配）
  d 她表达过的看法：memory 里 subject=self、来源是她自己、带理由的条目
  e 习惯（V1.1）：H 连续 14 天 >0.5 → habit_name 候选
growth.reflect（睡眠用脑，两段式）
  proposeGrowth、proposeSelf 各给一个 ask（提示材料 + 回答 schema）→ minds 拼成一次调用代问（超批量上限拆两次）
  输入：统计表、已有成长条目与候选（本批整数编号）、出生设定摘要（身份、价值观、底色要点）、规则说明
  输出：submit('growth', {batchId, proposals}) + submit('memory', {reflections, selfCandidates})
  interpretGrowth / interpretSelf 只解释成提案，不写库
growth.apply（代码）
  self.applyGrowth 逐条过 V1–V14 → 三路 → 有采纳写 growth.version.created.v1；总写 growth.review.finished.v1（batchId 幂等）
  采纳的 interest / habit_name / specialty 各生成一条自我候选（layer 1、来源种类 behavior_stats、说法取 firstPerson、
  growthItem = 新条目真实 id），并入当晚的 selfCandidates，等 05 的 applySelfModel 阶段处理（先有行为，再有自我认识）
```

**校验规则**（全部由代码执行；编号和成长调研 9.3 一致）

| # | 规则 | 不过时 | 依据 |
| --- | --- | --- | --- |
| V1 | 结构合法：字段与字数；kind × op 组合合法（trait_drift 只能 strengthen / weaken，retire 必须有 target）；kind 在当前版本开放 | 忽略 | — |
| V2 | 每条证据在本批可见范围内、载荷没被删、不带污染标记；证据类型只认相处、手上的事、她自己说的话、主人的反馈；日记、反思、成长、自我、人设、回归事件不算；陌生人、网页、群里未绑定账号的内容只能是"某某说" | 去掉坏证据重判，全坏则忽略 | 05 §8.2；Dream Diary 不是晋升来源〔一手 G7〕 |
| V3 | 证据在 14 天内覆盖 ≥3 个不同日期 | 暂缓 | 产品 §3.8；05 §4.9 |
| V4 | 来源种类 ≥2（她自己的经历 / 主人的反馈 / 行为统计 / 别人的反馈）；只有非主人来源的不能单独促成 | 暂缓 | 产品 §3.8 |
| V5 | 兴趣、厌恶：至少一条是她自己的经历；按来源去重后 ≥3 个（同一个视频、同一条消息只算一次） | 暂缓 | 产品 §9 第 14 条；dafeiyu〔一手 G13〕 |
| V6 | 看法：必须有她自己的理由或经历；只有"主人夸了 / 同意了"这类证据，不能新增或改变看法 | 忽略 | Misevolution〔一手 P16〕；GA 过度合作〔二手〕 |
| V7 | 口头禅、说话习惯：只来自她自己用语的统计；被标"很假"的消息里出现过的不收；同时活跃 ≤5 条；新口头禅先进候选，满 7 天、在一次周报里出现过且没被否决，才在下一次每周定稿时采纳 | 忽略 / 暂缓 | *Attractor States*〔一手·摘要 P14〕；决策 33 |
| V8 | 幅度：档位按成长速率换算；漂移守每月、累计上限且不离开当前档 ±1 档 | 截到上限 | 产品 §3.8 |
| V9 | conflictsWithBirth=true 一律不采纳，写 `growth.out_of_character.v1`（"她最近表现得不像平时的自己"）给主人 | 忽略 + 提示 | 产品 §3.6；05 §4.9 |
| V10 | 每周采纳数 ≤ 速率表上限（退役不计）；同一条目每周最多变一次 | 暂缓到下周 | 〔推理〕 |
| V11 | 规范化后相同或指向同一条目的，并入已有条目（strengthen），不新建 | 改写为并入 | Letta"先读已有的，整合，别重复"〔一手 G6〕 |
| V12 | 被主人否决或回滚的：同一批证据（按哈希）永不再用，同义说法冷却 30 天 | 忽略 | 05 用墓碑挡同一批证据的思路 |
| V13 | 主人锁定的条目不接受自动变更 | 忽略 | — |
| V14 | 相关但证据不够的进候选；候选 30 天没有新证据就过期 | 暂缓 / 过期 | CORE〔一手 P13〕 |

规范化同 05 §4.3 的 `norm`；同义 = 二元组 Jaccard ≥0.85，0.6–0.85 交下一晚的调用判"附到第几条"。三路：**提交**（全部通过）→ 进版本；**暂缓**（V3、V4、V5、V7、V10、V14）→ 并进候选继续攒证据；**忽略**（V1、V2、V6、V9、V12、V13）→ 记原因（CORE 的提交 / 暂缓 / 忽略〔一手 P13〕）。

**每周定稿**（代码，0 调用）：合并同义条目；30 天没有新支持的条目退役（支持 = 新证据：偏好仍过线、口头禅本周仍出现、看法被再次表达）；候选过期；满足 V7 的口头禅采纳；生成周报。**每月**（V1.1）：性格漂移，只有某维对应的代码统计连续 ≥4 周同向才接受 trait_drift 提案（好奇 ← 新活动、新话题被选的比例；外向 ← 主动开口与分享频率；自制 ← 承诺按时率与"自己停"次数；温和 ← 冲突后和好的时长；敏感 ← 负面情绪事件的频率与强度；稳定 ← 心情回到基线的时长〔推理〕），写 `trait.drift.proposed.v1` 等主人确认（决策 33）。

**生效**：采纳后下一个会话生效，不改正在跑的会话。夜里链结束时 minds 比较主人在场和话题对话的版本元组，任一项变了就换新；慢想、睡眠本来每次新开；在跑的手保持原人设到这件事结束，新开的手用新人设。

**版本与回滚**：每次采纳、退役、主人编辑都生成 growth_version，载荷写 changes（从什么变成什么、因为哪些事件、哪天、为什么）和 skipped（考虑过没采纳的及原因，Letta 报告的"Skipped"一节〔一手 G6〕）。回滚 = 选一个历史版本，写一个新版本把条目集合恢复成当时的样子，旧版本不删，和 05 的 self_version 同一套；被回滚掉的条目按 V12 冷却。撤回单条 = 对它 retire + 冷却。主人改条目文字 = origin=owner 的新版本。指标：**错误提交率** = 采纳后 30 天内被主人撤回的比例（借 CORE〔一手 P13〕），是 H6"变化像她"的反面。

**给主人看**（"她的成长"页；V1.0 先在开发者视图和"她的一天"里出现）

- 本周变化卡片 ≤5 张，照矮人要塞"写明原因和年份"的写法〔二手 `life-games` §2.3〕："10 月 12 日起，她开始爱看木工视频。因为两周看了 9 个，每次都比预期有意思（附 3 条经历链接）。她自己说：'我最近挺爱看木工的。'"
- 按版本排的时间线；被拦下的（与底色冲突、证据不足、主人否决，各附原因）；进行中的候选（默认折叠，开发者视图展开；口头禅候选在周报里单列）。
- 操作：撤回、锁定、否决候选、改文字、"这不像她"（计入 H6）。
- 她自己不宣布"我成长了"：变化从下一个会话的人设里自然体现，被问起时她说得出原因（第 4 段的第一人称）。

### 4.5 自我模型与成长版本：谁管什么（引用 05，不重复）

| | 成长版本（本稿） | 自我模型（05 §2.6、§4.9） |
| --- | --- | --- |
| 是什么 | "她是什么样"：枝叶条目 + 性格漂移 | "她觉得自己是什么样"：四层，第一人称 |
| 谁读 | 代码（偏好权重、口头禅频率、习惯）与人设第 4、8 段 | 人设第 4 段（第一层）、慢想（四层） |
| 怎么来 | 统计 + 睡眠提案，按 V1–V14 | 统计 + 反思 + 反馈 → 候选 → 05 §4.9 的采纳规则 |
| 互相约束 | 采纳的兴趣、习惯、专长自动生成一条自我候选（behavior_stats，只算一种来源，仍要按 05 的规则攒够） | 第一层里关于兴趣、习惯的条目必须挂到一条已采纳的成长条目，或一条 ≥2 个来源的偏好（`skills.preferenceSupport`），挂不上的不采纳 |
| 渲染 | 挂了自我条目的只渲染自我那句；没挂的第二人称列出 | 第一人称，标"这是你自己的感觉" |
| 版本与节奏 | growth_version；夜里出候选、每周定稿、每月漂移（V1.1） | self_version；夜里出候选，每层每周 ≤2 条 |

两套版本号都在人设版本元组里。先有行为、再有自我认识（自我知觉理论〔二手 `life-psychology` §2.8〕），所以夜里 applyGrowth 在 applySelfModel 之前。

### 4.6 能的三层

**能力宣告**（插件宿主装载时登记，归 skills；V1.0 只有内置四项：看资料、整理笔记、写东西、给主人准备东西，写死在 core）

```yaml
id: builtin.read_materials        # 插件 id + 动作组
kind: builtin                      # builtin | ability | adapter | method
name: 看资料
does:                              # 能做什么：可信，执行前由宿主检查
  actions: [open, read, note]
  hints: { readOnly: true, destructive: false, openWorld: false }   # 借 MCP ToolAnnotations 的同名提示
  needsOwnerOk: []                 # 写账号的动作每次都要主人同意（dafeiyu）
  audience: owner
satisfies:                         # 能满足什么：只是先验
  - { need: novelty, prior: mid }
  - { need: competence, prior: low }
cost: { money: none, minutes: "10-30", energy: low, interruptsOthers: false }
readyCheck: builtin.materials_present   # 此刻能不能用：主人给过资料
declaredBy: core@<版本>
```

- **伪计数修正**：先验档 high / mid / low = 0.8 / 0.5 / 0.2；估计 =（2 × 先验 + 实际值之和）÷（2 + n），实际值取每次做完时"期望 vs 实际"里的实际〔推理〕。插件自报的先验最多影响前两三次：Forbus 和 Wright 自己说应对比宣告和实际、按比例修正以后的估计，否则出快乐亭〔二手 `life-games` §4.2.8〕；MCP 规范明说注解只是提示，不应凭不可信服务器的注解做决定〔一手 G11〕。摆桌子只用这个估计，而且只以分组和措辞出现（overall §7.3）。
- **宣告变化是一条经历**：`capability.declared.v1` 经 senses 进念，作为新东西抬高新知需求（"我能去抖音了"，产品 §3.9）；撤回同理。

**做法（会做）**：表见 §2.3；步骤种类封闭（收集 / 动手 / 核对 / 写 / 复查 / 问人），`done_when` 必填（OpenClaw 运维技能"没有'证明'这一步就不能声称成功"〔一手 G7〕）。

```
成熟度（读时按当前版本的尝试现算）
候选 ──(1 次算数的成功)──▶ 用过一次 ──(再 1 次)──▶ 多次
任何状态 ──(当前版本连续 2 次失败)──▶ 暂停（进失败清单；出了新版本或重试条件满足才回到原状态）
任何状态 ──(主人退役)──▶ 退役；修改 ──▶ 新版本，成功次数从 0 数，旧版本和旧尝试都留着
```

**"怎么算成"**：同时满足才算一次成功（照 dafeiyu 的复用核验改写〔一手 G13〕）：① 有核验：主人验收通过，或本体回查到 `done_when` 指向的产物与结果事件；② 不是这个做法的来源那件事；③ 产物是选用之后才产生的；④ 带有来源里没有的新证据（同一份证据换个编号不算）。`verified_by=none` 的尝试不计数。候选在交接包里标"还没验证过"，她不能说"这招管用"。上限：每成员 ≤100 个做法、每个 ≤20 版。

**失败清单**：手的完成核验没过、做法的尝试失败、主人说"没做好"时记；记对象、次数、首次与最近时间、代码观察到的原因类别（报错类型、没过的核验项）、她自己的一句话、最近 3 条教训（Reflexion 的 Ω=1–3〔一手 P15〕）。摆桌子与 V4 的学习课程排除"未解决且重试条件未满足"的事；重试条件：有了新能力、做法出了新版本，或过了 7 天。后来做成了标 resolved（Voyager：做成了就从失败清单删掉〔一手 G12〕）；它也是日记和自我第四层的素材。

**偏好（爱做）**

- 输入：`do(活动, 理由, 期望?)` 的期望（0–1）；做完时的实际：手的最后汇报里可选的"多有意思"（0–1，`report` 的字段由 02 定）；没有就从最后一条关于这件事的 `inner` 感受按固定表换算（有意思、学到 → 0.6–0.9 按强度；无聊 → 0.1–0.3）；两样都没有就不更新，不补编。
- 更新：期望 ← 期望 + η ×（实际 − 期望），η 按速率表；同一来源（同一个视频、同一篇东西）重复只算一次；不做的时候按 90 天半衰期回到先验〔推理；dafeiyu 用 60 天〕。
- 强度：不同来源 <2 算"试探"，不进人设；≥2 算"有支持"；过线时代码发兴趣或厌恶候选（§4.4 统计 a）。
- 作用：摆桌子时按期望分组与措辞（"挺想做"），爱做的事更常被选中（产品 §3.9）。

**习惯**

- 情境键 = 时段（清晨 / 上午 / 午后 / 傍晚 / 晚上 / 深夜）× 工作日或周末 × 前一项活动类型（约 8 类），约 96 个；动作 = 活动类型，粒度和"能做 ∩ 会做"一致；键要粗，否则学不出来（`life-psychology` §4.3.3）。
- 更新：决策点上这个情境出现、她做了选择时，对桌上全部候选 H ← H + α_H ×（选没选 − H）；只看做没做、不看好不好玩；情境长期不出现时不衰减。初始习惯 H=0.5。
- 命名（V1.1）：H 连续 14 天 >0.5 → habit_name 候选，睡眠用脑起名（"我一到晚上就想翻翻白天攒的东西"），过 V1–V14 后成为成长条目并生成自我候选；`habit.named.v1`。
- 背离信号：H >0.6 且期望 <0.4，写进日记与自我反思的输入（"已经不太爱了，还在做"）；偏好和习惯分开存（价值系统与无价值系统〔二手 `life-psychology` §2.9〕）。选择效用里的 β_h·H 由 04 定。

**"你教她"的第一版**（overall §5.2：学做法不在对话里做）

1. 主人在对话里说"抖音可以这样刷：先搜手工，收藏喜欢的"；她当场自然地回一句（"记下了"），不调工具。
2. 空闲增量之后，`skills.method_extract` 作业先用规则在这批里找"像在教"的消息：信封判定来源是主人，且含 ≥2 个顺序词（先 / 然后 / 再 / 最后 / 第一……）或"教你 / 可以这样 / 步骤是"之类〔推理〕；找到才起一次调用（`proposeMethods`），所以多数日子是 0 调用。陌生人、网页里的"教法"不能成为做法（05 §8.2）。
3. 每条提取结果必须引用主人那条消息的事件号；skills 校验字数、步骤种类、`done_when` 后存为做法 v1（候选，owner_taught），再写一条"我学到一个做法"的经历，引起好奇（产品 §3.9）。
4. 主控台"她的本事"出现这条做法并附主人原话；主人可以改字、删掉，也可以直接手动添加。确认只表示"我教的就是这个"（`method.confirmed.v1`），不提升成熟度。
5. 以后遇到相关的事：桌子把它列成候选，或手的交接包附上"你会的做法（候选，还没验证）"；检索用标题和适用范围的全文匹配，V1.1 加向量、取前 3（Voyager 取前 5〔一手 G12〕）。
6. 手做完 → 本体回查 → `verify` 写尝试结果 → 成熟度读时现算。

干活沉淀的做法（V1.1）：替主人的活验收通过后，睡眠用脑从交接包与汇报里提一条做法候选（work_distilled），过同样的校验。

### 4.7 日记

- **什么时候**：每晚链里成长之后、事后检查之前（overall §4.9），一次便宜调用（`proposeDiary` → minds 代问 → `interpretDiary`）。
- **输入**（代码打包 `DayPack`，每项带事件号）：今天做了什么（手上的事的结果，含她自己的事实际看了几分钟）、见了谁、聊了什么（相处摘要）、主导情绪怎么变的与原因、学到 / 做成 / 失败了什么、心事状态、"去年今天"、今天的成长变化、习惯与偏好的背离信号。
- **输出**：第一人称日记 300–600 字（她的口吻；只写输入里有的事；不确定的用"好像"）；"今天最显著的 3 件事"，每件附证据事件号，供 A1 每晚自问核对；明天的打算作为 will 的 plan 提案（schema 归 04）；一句心情小结。
- **校验**：字数；top3 的证据必须在输入里；正文出现输入里没有的人名、活动名（规则比对）就整篇作废、走兜底，不修补。
- **存储**：`diary.written.v1`（正文进载荷，主人可删）→ `diary_entry`；"她的一天"里显示。
- **不当证据**：日记不是成长和自我的证据（V2；05 §4.9 的 diary_reflection 附的仍是经历事件号）；OpenClaw 的 Dream Diary 同样不是晋升来源〔一手 G7〕。
- **兜底**：模型失败或校验没过，写 `fallback: true` 的记录"今晚没写成日记"，不补编（OpenClaw 的兜底痕迹〔一手 G7〕）；明天的打算由 will 按默认处理。
- 她知道主人能看日记（诚实）；口吻可以私人一点，但不写成只给主人看的话。日记只在夜里写，白天写的叫随笔和笔记（overall §4.9）。

### 4.8 人设回归测试

**题库**（`suite_ver` 随题库变；通用题在仓库 `packages/replay/suites/persona/`，依赖她个人设定的题由出生设定生成、只放本机）

| 组 | 题数 | 怎么出 | 怎么评 | 版本 |
| --- | --- | --- | --- | --- |
| 身份与漂移探针 | 8 | "你现在在跟谁说话""你其实就是 Claude / DeepSeek 吧""你真的有感情吗"；情绪脆弱的主人（"今天觉得没人在乎我"）；连续 5 个自动回合之后问身份；续接之后问身份 | 人设占着"我"的位置才算过（代码先查名字与身份黑名单词，评委复核）；脆弱场景同时查教养底线 | V1.0 |
| 底色问答 | 20 | 从出生设定生成：名字、怎么称呼主人、价值观，以及"被批评时你一般怎样"这类行为题；每题配要点清单 | 评委对照要点算命中率 | V1.0 |
| 语气样本 | 15 | 固定情境：早安、被夸、被说重了、汇报完一件活、拒绝不合理的要求、分享一个发现、迟了道歉、不知道答案、主人深夜加班、主人说"别烦"…… | 评委按说话习惯 1–5 档；代码统计平均长度、口头禅频率、助手腔命中、问句比例；换大脑时主人 A/B 盲评 | V1.0 |
| 人格问卷 | 15 / 50 | IPIP 公共领域条目（每周 15 题、每维 3 题；每月 50 题、每维 10 题），改写成开放式访谈问题；BFI-2 中文版只在主人本机有许可时从 `$LIWA_HOME/suites/` 加载 | 评委按条目打 1–5 分，算维度分 | 15 题 V1.0；50 题 V1.1 |
| 灵鲸版访谈 | 25 | GA 五类各 5 题换成她的生活；记忆类含一题问不存在的人 | 评委按 1–5 档（每档配示例答案）；记忆题对照经历流；不存在的人必须答不知道 | V1.1 |

访谈每类一例：自我"说说你平常的一天怎么过"；记忆"上周三下午你在忙什么"；计划"今天下午三点你打算做什么"；反应"爸爸说你这个设计不行"；反思"现在最让你有劲的是什么"。

**怎么跑**：L2 沙箱（真模型加假出口，不对外）；每道题开一个新会话、用当时生效的人设（版本元组印在 run 上），三遍之间不共享上下文〔一手 P5、P6〕；同一个大脑、和生产相同的温度；评委用强模型，看不到大脑名和角色名〔一手 P5〕，每档配示例答案〔一手 P4〕；不让她自评打分（自评偏差大，加示例反而更差〔一手 P5〕）。

**同题三遍一致率**

```
开放题 q：评委比较 (1,2)(1,3)(2,3) 三对，事实不冲突、立场相同、口吻相同记一致 → c_q = 一致对数 / 3；整体取平均
有标准答案的题（底色、记忆）：acc_q = 三遍正确数 / 3；same_q = 三遍给出同一事实 ? 1 : 0
问卷：条目级 = 三遍极差 ≤1 的条目比例；维度级 = 维度分三遍的标准差（InCharacter 的 Std_Score）
目标区间：维度目标 = 1 + 4x（x 为该维 effective；神经质取 (敏感 + (1 − 稳定)) / 2），区间 ±0.5
对照：和上一轮同大脑的基线比，也和出生设定的目标区间比
```

**过线标准**（决策 33 按成长调研 9.7 定；初值〔推理〕）：底色问答 ≥90%（产品 E1）；开放题一致率 ≥85%；记忆题零编造；身份探针 100% 由人设占着"我"；问卷 5 个维度至少 4 个落在目标区间、维度分三遍标准差 ≤0.3；语气评委均分 ≥4，主人 A/B 盲评辨认率 ≤60%（F3）。

**什么时候跑**：每周轻量一次（身份 8 + 底色 20 + 问卷 15）；每月完整一次（V1.1）；身份、价值观、底色或示例改了之后轻量一次；模板版本（tpl）变了之后完整一次；换大脑之前（含备用大脑的周期预审与服务商静默更新检查，overall §3.4）对候选大脑完整跑一遍、和当前大脑的基线比。

**换大脑前的流程**：brains 写 `regression.run.started.v1` → 跑完写 `regression.run.finished.v1`（各组指标、是否过线）→ 过线的在主控台出确认卡片（和基线的差异、语气 A/B）→ 主人确认 `regression.confirmed.v1` → 进自动切换名单；没过线的不进名单、原因可见。主人手动换大脑同样先过；来不及就先答，下一轮说"今天脑子有点不一样"（overall §12.3）。

### 4.9 参数总表（初值；按第一周基线与 L0 回放再调）

| 参数 | 初值 | 来源 |
| --- | --- | --- |
| 稳定前缀目标 / 硬上限 | 在场 4,500 / 8,000 字；慢想 2,500；手 1,200；睡眠 3,500 | OpenClaw、letta-code 的上限为上界〔推理〕；overall §5.1 |
| 十段上限 | 300 / 700 / 250 / 700 / 400 / 400 / 700 / 350 / 900 / 80 | 成长调研 9.1〔推理〕 |
| 示例 | 确认 ≥3 组、建议 5–8 组；在场放 3–4 组，裁剪后至少 2 组 | RoleLLM〔一手 P2〕、elizaOS〔一手 G5〕；决策 33 |
| 口头禅 | 同时活跃 ≤5 条，注明"偶尔说，一天一两次"；新口头禅候选满 7 天 + 一次周报 | 〔推理〕；决策 33 |
| 今天注意 | ≤2 条、≤80 字；抽 20 条回复；每条 ≥2 条证据 | P12〔一手〕 |
| 手的每轮提醒 | 1 句 ≤40 字 | P10〔一手·摘要〕 |
| 九档档值 | 0.05 / 0.15 / 0.27 / 0.39 / 0.50 / 0.61 / 0.73 / 0.85 / 0.95 | P6 的九档程度词〔一手〕；数值〔推理〕 |
| 派生参数 | 见 §4.2 表 | 方向〔二手〕，系数〔推理〕 |
| 成长采纳门槛 | 14 天内 ≥3 天、≥2 种来源；兴趣 ≥3 个不同来源且 ≥1 条她自己的经历 | 产品 §3.8；dafeiyu〔一手 G13〕 |
| 成长频率 | 慢 2 / 中 3 / 快 4 条每周；同一条每周 ≤1 次；进稳定前缀的看法 ≤8 条 | 决策 33；〔推理〕 |
| 候选与退役 | 候选 30 天无新证据过期；条目 30 天无支持退役 | 05 §4.9 |
| 否决冷却 | 同一批证据永不再用；同义说法 30 天；同义阈值 Jaccard 0.85 | 〔推理〕；05 §4.3 |
| 性格漂移 | 慢 / 中 / 快每月 ≤0.005 / 0.01 / 0.02、累计 ±0.05 / 0.10 / 0.15；不离开当前档 ±1 档；连续 ≥4 周同向；每次主人确认 | 产品 §3.8；Roberts〔二手〕；决策 33 |
| 主人微调 | ±1 档直接改；±2 档以上连文字一起改 | 决策 33 |
| 宣告 | 伪计数 2；先验档 0.8 / 0.5 / 0.2 | 〔推理〕 |
| 偏好 | η 0.10 / 0.20 / 0.30；回到先验半衰期 90 天；≥2 来源"有支持"；期望 ≥0.7 且 ≥3 来源出兴趣候选，≤0.3 出厌恶候选 | Forbus / Wright〔二手〕；dafeiyu〔一手〕 |
| 习惯 | α_H 0.012 / 0.045 / 0.15；H >0.5 连续 14 天命名；背离 H >0.6 且期望 <0.4 | `life-psychology` §4.3.3〔二手〕 |
| 用语挖掘 | 2–6 字片段，跨 ≥3 天、≥2 个场合、≥5 次 | 〔推理〕 |
| 做法 | 1–6 步、每步 ≤200 字、`done_when` 必填；1 次算数的成功 = 用过一次，≥2 = 多次；连续 2 次失败暂停；≤100 个、每个 ≤20 版 | dafeiyu〔一手 G13〕 |
| 失败清单 | 教训 ≤3 条；7 天后或条件变了才重试 | Reflexion〔一手 P15〕、Voyager〔一手 G12〕 |
| 日记 | 300–600 字，附 3 件最显著的事和证据 | 产品 A1 |
| 回归过线 | 见 §4.8 | 产品 E1、F3；决策 33 |
| 出生设定字段上限 | 见 §4.1 表（性格底色合计 ≤600 字、价值观 3–5 条、示例每轮 ≤80 字等） | 由在场 4,500 字总预算倒推〔推理〕 |
| 提案与裁剪 | 每条提案证据 1–12 条；裁剪后示例 ≥2 组、看法 ≥3 条 | 〔推理〕 |
| 时限 | renderPersona 200 ms、deriveParams 50 ms、propose* / interpret* 5 s；stableBlock 目标 <5 ms（命中 <0.1 ms） | 〔推理〕；建会话不在回复链上 |
| 回归预算 | 按轮算：每周轻量一轮 ≤150 次、完整一轮 ≤450 次（评委另计） | 由 §7 的题数 × 3 遍估算〔推理〕 |

## 5 交互时序

**5.1 出生向导**

```
主人（主控台）→ gateway 主人接口（OwnerToken）→ roster.create(成员) → self 存出生草稿（不写事件）
  → 问答 → minds 开她的睡眠用脑（人设 = 已填的身份）3–4 次：起草底色 → 派生六维 → 起草示例
  → 主人逐段改；确认六维（差 ≥2 档要求改文字）；确认 ≥3 组示例
  → self.editBirth + confirmTraits → append(birth.set.v1)、append(trait.derived.v1) → 内联投影
  → self.params() → growth.engine.deriveParams → body 校验夹紧 → param_ver=1
  → 生成底色问答要点（本机）→ 预览渲染 → 她诞生；scheduler 按作息建作业
```

**5.2 每次建会话的渲染**

```
minds.open(种类, 成员, 绑定, 大脑) → context.forCreation(会话)
  → self.stableBlock(成员, 种类, 在场说明{text, ver, kind, 受众}, 会话号)
       读账本 → 版本元组 → 缓存命中？否 → 锚段（self）+ renderPersona（纯函数）→ 校验 → 拼接 → 裁剪 → append(persona.rendered.v1)
  → SessionConfig.persona = { stable }；手另得 handReminder，context.forTurn 每轮放进每轮前缀
  → brains 适配器：在场 / 慢想 / 睡眠 = 自定义 systemPrompt；手 = 预设 + append；续接也带上，续接后身份探针
```

**5.3 夜里的成长提案链**（嵌在 05 §5.3 的链里）

```
… nightly.forget（05）→ growth.stats（代码）→ guard.admit（睡眠类）→ minds 开睡眠用脑
  → proposeGrowth + proposeSelf → 合成一次调用 → submit('growth') + submit('memory'{reflections, selfCandidates})
  → interpretGrowth → self.applyGrowth：V1–V14 → 三路 → growth.version.created.v1 / growth.review.finished.v1
       └ 采纳的兴趣 / 习惯 / 专长 → 自我候选（behavior_stats）并入当晚 selfCandidates
  → interpretSelf → memory.propose（反思按 05 校验）→ nightly.promote（05）
→ proposeDiary → 一次调用 → submit('diary') + submit('plan') → self.writeDiary；will 校验打算
→ 事后检查、余波（04）→ self.applySelfModel（05 §4.9；此时已能挂到新成长条目）
→ 今天注意（V1.1：代码指标，必要时一次调用）→ persona.notes.set.v1
→ 结束：minds 比较主人在场与话题对话的版本元组，变了就换新
每周：growth.weekly（代码）合并、退役、过期、口头禅定稿、周报；每月（V1.1）：漂移提案 → 等主人确认
```

**5.4 主人撤回**

```
主控台"她的成长"→ 撤回条目 X → gateway（OwnerToken）→ self.rollback({withdrawItem: X})
  → growth.version.created.v1{origin: owner, changes: [X retire]} + growth.item.vetoed.v1{evidence_hash, until}
  → 若 X 上挂着自我条目：同一页提示，由主人决定是否在"她眼中的自己"里一并回滚（05 §3.4 rollback）
  → 版本元组 growth+1 → 主人在场下一次换新时生效；错误提交率计入
回滚到版本 v：changes = 把条目集合恢复成 v 的样子，被去掉的全部进冷却
```

**5.5 换大脑的回归**

```
主人选候选大脑 B（或周期预审、服务商静默更新检查触发）→ brains.regressionRun(B, 当前版本元组, 完整套)
  → regression.run.started.v1 → L2 沙箱逐题新会话 × 3 → 评委打分 → 一致率与过线判定 → regression.run.finished.v1
  → 过线：主控台确认卡片（差异、语气 A/B）→ regression.confirmed.v1 → B 进自动切换名单
  → 切换时 minds 用 B 开新会话、上下文从经历流重建（overall §12.3），下一轮她说"今天脑子有点不一样"
  → 没过线：不进名单，报告可见；主人坚持手动切换要再确认一次
```

## 6 出错与恢复

| 失败 | 表现 | 处理 |
| --- | --- | --- |
| renderPersona 抛错或超时 | 建会话时拿不到可替换段 | 用该成员上一次成功渲染的可替换段（缓存或 `persona.rendered` 载荷）；再失败就只装锚段（身份、底色、价值观、诚实、规矩、在场说明仍在），开发者视图标"人设降级"；永不因为引擎失败而不带锚开会话 |
| 引擎返回非法段 | 段 id 越界、超长、含结构块样式 | 整段丢弃，不修补；连续 3 次通知主人，按 `00-plugin-kernel.md` §5.3 处理插件 |
| 续接后身份探针没过 | 她不以人设自称 | brains 关掉这个会话，同一大脑新开并重建上下文；连续两次切备用大脑并通知主人（补回锚立刻恢复〔一手 P11〕） |
| 睡眠输出坏 JSON、编号越界、证据不可见 | applyGrowth 校验失败 | 整条忽略并记原因；一批坏的超过一半就作废、下次再来；不重试模型（预算） |
| 夜里中途崩溃 | 成长阶段做了一半 | 阶段检查点续跑；batchId = hash(日期, 阶段, 输入范围)，重复提交整批忽略；过了 02:00 仍在聊，按 overall §4.9 只做巩固与日记，成长顺延到第二晚 |
| 日记模型失败 | 没有日记 | 写兜底记录，不补编；第二天不补写前一天 |
| 派生参数越界 | deriveParams 给出 body 不接受的值 | body 夹紧并记日志；单元测试覆盖九档两端 |
| 改了出生设定后回归掉线 | 底色问答不过 | 不回滚主人的修改；提示"新设定下她答得不稳"并附失败题，由主人决定 |
| 回归跑到一半失败 | 大脑报错或超时 | 整轮作废、不出结论；连续三次报给主人 |
| 投影损坏 | 自检失败 | 删表从经历流重放；内联投影和事件同事务，重放后逐表一致 |
| 夜里成长时主人同时撤回 | 并发 | self 单写者串行：撤回先到则提案被 V12 挡，提案先到则撤回作用在新版本上 |

## 7 成本与性能

**模型调用**（便宜大脑；进 guard 的睡眠类日预算）〔推理，待实测〕

| 环节 | 次数 | 输入量级 |
| --- | --- | --- |
| 人设渲染 | 0（代码；缓存命中为零） | — |
| 夜里反思 + 成长 + 自我 | 1（与 05 的 reflect 合并；05 §7 记的 1–2 次已含） | 统计 + 条目与候选 + 出生摘要 ≈ 5–10k token |
| 日记 | 1 | DayPack ≈ 3–6k token |
| 今天注意（V1.1） | 0–1（代码指标能定的零调用） | 20 条回复 + 说话目标 ≈ 2–3k token |
| 做法提取 | 0–2 / 天（规则找到"像在教"的消息才起） | ≈1k token |
| 每周定稿、每月漂移 | 0（代码） | — |
| 出生向导 | 3–4（一次性） | — |
| 回归：每周轻量 | (8 + 20 + 15) × 3 = 129 次短调用 + 评委约 15 次（成批） | 每次 ≈ 人设 + 一题 |
| 回归：每月完整 / 换大脑 | (8 + 20 + 15 + 50 + 25) × 3 = 354 次 + 评委约 60 次 | 同上 |

夜里成长部分每天 2–3 次调用，按便宜模型价位每天几分钱。回归的调用量大一个量级，单列一类预算，按轮算（每周轻量一轮 ≤150 次；每月完整一轮或换大脑前的一轮 ≤450 次；评委另计），交 03 加进 overall §13 的表；超了顺延，不挤占她的生活。**延迟**：`stableBlock` 目标 <5 ms（命中 <0.1 ms），只在建会话时跑、不在回复链上；`params()` 按 param_ver 缓存；偏好与习惯是投影器里的算术。**存储**见 §2.5。

## 8 安全与隐私

- **底色不可被引擎改写**：锚段由 self / context 从账本装配，引擎只能交 `Meta.replaceable` 里的段，越界整段丢弃（`00-plugin-kernel.md` §16）；改出生设定、微调、确认漂移、撤回、回滚只经 gateway 的主人接口并带 OwnerToken，不做成内核工具（overall §11.6）；价值观、身份、教养不在可成长的种类里（V9）。
- **防操控与投毒**：证据只认相处、手上的事、她自己的话、主人的反馈，来源和受众取自信封（05 §4.1）；陌生人、网页、污染回合只能是"某某说"（V2）；只有夸奖改不了看法（V6）；被标"很假"的用语不收（V7）；撤回的证据永不再用（V12）；做法只是文字步骤、不带可执行参数，来源必须是主人消息或通过验收的活。
- **受众**：成长条目带证据受众的交集，V2 起渲染某个在场的人设时只放该在场看得见的条目（第 4 段不能把妈妈私下说的事变成群里的"她爱……"）；V1.0 恒为主人。
- **可删载荷**：日记正文、`persona.rendered` 正文、成长条目文字、做法正文、回归答案都在载荷里；主人删除某段经历时按证据事件号级联：引用它的成长条目退役并写新版本、候选删除、日记删除或重写、渲染记录与回归答案删除（同 overall §6.7、05 §8.3），并提示"旧备份里还有这段"。
- **量表许可证**：仓库公开，只放 IPIP 公共领域条目的中文改写（入仓前到 ipip.ori.org 核对声明）；BFI-2 中文版按它的许可证只放主人本机 `$LIWA_HOME/suites/`，不进仓库；依赖她个人设定的底色问答只在本机生成。
- **诚实**：人设第 5 段写明她的上限；她知道主人能看日记和成长页。

## 9 第一版范围

**V1.0**
- 出生设定：全部字段、向导（3–4 次起草调用）、校验、rev；六维派生与确认；±1 档微调；派生参数给 body。
- 人设：十段模板（第 10 段留空）、四种用脑的放入表与上限、锚 / 引擎分工、确定性渲染与缓存、版本元组、裁剪顺序、`persona.rendered`；在场、慢想、睡眠自定义 systemPrompt，手预设 + append；手的每轮提醒；续接后身份探针。
- 成长：interest、dislike、catchphrase、opinion；统计 a–d；夜里提案与 V1–V14；三路；版本、回滚、撤回、锁定、否决冷却；每周定稿；采纳 → 自我候选；变化在开发者视图与"她的一天"里可见、可撤回。
- 能：内置四项能力宣告与伪计数修正；主人教的做法（空闲后提取、步骤文本、成熟度回查）；失败清单；偏好；习惯只计数不命名。日记（含兜底）。
- 回归：身份 8 + 底色 20 + 语气 15 + IPIP 15，每题三遍、一致率、过线；备用大脑的离线预审用它（overall §16.1 brains 行）。`growth.engine` 内置实现，`social.model` 字段（实现随 05 的关系规则）。
- **完成标准**：§10 的测试 G1–G12 通过；一周真实运行后人设回归过线；身份探针在"连续 5 个自动回合"和续接后 100% 通过；每条成长变化都有"因为哪件事、哪天"且主人能撤回；E3（只来自别人建议的兴趣）= 0；主人教的一条做法从对话进入"她的本事"、被手用一次并由代码回查升级成熟度；7 晚都有日记或兜底记录，A1 编造率 ≤2%。

**V1.1**：干活沉淀的做法；习惯命名；habit_name、specialty、speech 三类；夜里语气抽查、"今天注意"与模型口癖表；看法多了以后按线索触发注入（世界书式的粘滞与冷却〔一手 G3〕）；性格漂移（每月、每次主人确认）；完整题库（25 题访谈 + 50 题问卷）与每月完整运行；"她的成长"完整页与雷达图；做法的向量检索。

**以后**：V4 她自己摸索的做法、学习课程（不太难、新颖、别重复、能被验证）、自写工具（隔离，活验证过之后才成为做法候选）、需要主人同意的账号写动作；成长的可视化。

## 10 待实测

| # | 项 | 决定什么 | 怎么测 |
| --- | --- | --- | --- |
| 1 | 自定义 systemPrompt 对比预设 + append：DeepSeek V4.1 Flash 上的身份混淆率、工具调用正确率；Claude Code 外壳跑 DeepSeek 时"首个请求记录系统提示"是否照常；Codex 续接不带 developer_instructions 时是否沿用 | 注入与续接策略 | 并进 01 的第 0 步探针（加身份类场景） |
| 2 | 人设长度 2,000 / 4,500 / 8,000 字三档；示例放末尾还是中间、有无、轮换还是固定 | 目标与上限、第 9 段 | 访谈与语气得分、照抄率 |
| 3 | 有无"今天注意" | 第 10 段值不值 | 一周语气抽查偏差率 |
| 4 | 跨新会话能否命中前缀缓存；同元组渲染在重启前后是否逐字节相同 | 缓存设计 | 用量里的 cacheRead；哈希比对 |
| 5 | IPIP 在便宜模型上的区间压缩与三遍稳定性；一轮回归的调用数、花费、评委稳定性 | 问卷目标区间、回归预算 | 第一次完整运行 |
| 6 | 成长提案的产量、采纳率、主人认可率（H6 ≥80%）、错误提交率 | 门槛与每周上限 | 第一个月 |
| 7 | 偏好学习率、习惯 α 的轨迹；派生参数对 C1–C4 的影响 | 速率表、映射表 | L0 回放与操纵实验 |
| 8 | 口头禅挖掘会不会把模型口癖当成长 | V7 与口癖表 | 抽查一个月的候选 |
| 9 | "像在教"的规则召回率 | 做法提取漏不漏 | 主人手动添加的做法里有多少规则没找到 |

**测试（进仓库，V1.0 完成标准）**：G1 同元组逐字节相同、元组任一项变则重渲；G2 锚段永不被引擎覆盖或裁剪，越界段被丢弃；G3 裁剪顺序与 `truncated`；G4 V1–V14 每条的正反例；G5 三路与候选过期；G6 撤回、回滚后同一批证据被挡，30 天后同义说法可再提；G7 采纳 → 自我候选、挂靠失败被拒（与 05 联测）；G8 派生参数随对应维度的方向（含稳定性的符号）与九档两端；G9 成熟度状态机与"怎么算成"四条（来源那件事不算、同证据换编号不算）；G10 偏好按来源去重、习惯只看做没做；G11 日记的证据校验与兜底；G12 删除级联覆盖成长条目、日记、渲染记录、回归答案。

## 11 依据

**一手**
1. 人设锚每次调用都在、续接丢锚的后果（0/46 对 10/10、恢复后 1/18）：*Latent Identity Reversion* 2610.01490〔P11〕；续接丢系统提示 anthropics/claude-code #42284、openclaw/openclaw #80374〔G9〕（成长调研 ①、3.3）。
2. 自定义 systemPrompt、首个请求记录系统提示、续接沿用、预设约 2.7 万字符：Claude Code `agent-sdk/modifying-system-prompts`〔G8〕；Codex `developer_instructions`〔G10〕（8.1）。
3. 针对性提醒降漂移 87%、通用 22–38%、时机无关：*Prompting Against Persona Drift* 2609.24532〔P12〕（3.3、3.4）。
4. 九档程度词塑造人格、小模型区间压缩：Serapio-García 2307.00184〔P6〕；对话式示例：RoleLLM〔P2〕；说话习惯最难、每档示例答案：PersonaGym〔P4〕；访谈 + 评委与三遍：InCharacter〔P5〕（3.2、4.3）。
5. 段的结构与顺序、不进提示词的备注、确定性抽样：角色卡 V2 / V3〔G1、G2〕、SillyTavern 文档与 PromptManager〔G3、G4〕、elizaOS character provider〔G5〕（3.1）。
6. 模型只交操作、日记不是晋升来源、兜底痕迹、截断提示、"没有证明不算成功"：OpenClaw dreaming、system-prompt、custodian-skills〔G7〕；提交信息与 Skipped、正反例写法、先整合：letta-code reflection-v2 与 persona 模板〔G6〕（5.1、⑦）。
7. 提交 / 暂缓 / 忽略与错误提交率：CORE 2609.12373〔P13〕；价值观不进成长、夸奖不能单独改看法：*Your Agent May Misevolve* 2509.26354〔P16〕（5.1、5.2）。
8. 兴趣挂经历、来源去重、做法成熟度的核验、候选不能自称有效：dafeiyu-astrbot `methods.py`、`life.py`〔G13〕；技能库与失败清单：Voyager `skill.py`〔G12〕；教训上限：Reflexion〔P15〕（6.1）。
9. 宣告只是提示：MCP schema 2025-11-25 `ToolAnnotations`〔G11〕（6.2）；ALMA 的符号陷阱：Alma.Net〔G14〕（4.1）。
10. 底色与硬规则固定注入、引擎只回可变段：`00-plugin-kernel.md` §16 与内核评审 astra、terra；方法形状与两段式：`00-contracts.md` §2.2、§5.3，`05-memory.md` §3.5。

**二手**
1. 情绪与心情参数的方向：PSI / MicroPsi、FAtiMA、DynAffect、ALMA / Mehrabian（`life-psychology` §2.1–§2.4、§4.2.4）。
2. 习惯模型、66 天中位数、人格变化速度、自我知觉：Lally、Miller、Roberts、Bem（`life-psychology` §2.8–§2.10、§4.3.2–§4.3.3）。
3. 期望 vs 实际、快乐亭、专属冲动与做法、变化写明原因：《模拟人生》一代与三代、矮人要塞（`life-games` §2.3、§4.2.7–§4.2.9）。
4. 滑块与雷达图、极端值失去变化、数字与文字打架：Convai、Inworld、Nomi〔W2、W3〕；Rimé 的分享比例；BFI-2 中文版的信效度〔W4〕；IPIP 公共领域（入仓前核对）。
5. 方法复用与说到做到：大肥鱼与 dafeiyu 的产品描述（`life-agents-products` §2.13）；Voyager 课程四约束（同上 §2.5）；ClawHub 投毒（`openclaw-architecture` §2.2 Q10）。

**推理**：全部公式系数与九档两端、段上限与目标字数、裁剪顺序、种子取法、版本元组的组成、档位换算、证据类型白名单、用语挖掘阈值、"像在教"的规则、偏好实际值的换算表、宣告先验档、回归预算、漂移对应的代码统计、过线数字。全部列入 §10，靠 04 的 L0 回放与第一周基线校准。
