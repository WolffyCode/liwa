# 调研：新整体结构的验证（主意识当中枢、四种会话、三条规则）

日期：2026-10-28。目的：用论文、权威文章、开源项目和官方文档，检验 handoff.md 决策 6、11、12、13 改写后的新结构（"她"在本体里；对话分身每个对话一个、主人的和别人的同一种；主意识不聊天、只当中枢；工作分身、总结分身；三条互不干扰的规则；共享状态单点写；两张清单；决定广播）。找支持的证据，也找反例和要修正的地方。

已有调研里讲过的（CoALA、全局工作空间理论、MemGPT、AIOS、sleep-time compute、Anthropic 与 Cognition 的多 agent 文章、MAST、主动性、人设漂移、麦麦、Letta、AIRI、elizaOS、OpenClaw、Paseo、插件架构、记忆评测与投毒）这里只引用，不重复。引用格式同 overall.md：报告名省略日期前缀，例如 `papers-architecture §2.5`；`subagent-notes/` 指 `docs/research/2026-10-28-subagent-notes/`。

标注约定：〔一手〕读了原文、源码或官方文档；〔一手·摘要〕只读了论文摘要；〔一手·转写〕官方原文经 WebFetch 工具摘录，不是逐字通读；〔二手〕来自检索摘要或第三方转述；〔推理〕是本文推出来的，没有直接依据；〔未核实〕没读到原文。

---

## 0. 一页结论

**总体判断：新结构站得住，大方向有充分依据，不需要推翻。** 要改的地方集中在"清单怎么落地""权限沿请示链怎么传""主意识睡着时谁来发现问题"三处。

1. **"快的对话者 + 慢的中枢"有理论和实证支持。** DeepMind 的 Talker-Reasoner、IBM 的 SOFAI、SwiftSage、OpenAI 的 Chat-Supervisor 示例都是这个分工：快的一直在线、对外说话；慢的不对外、只在需要时工作。**几家都不让快系统自己判断"要不要叫慢系统"**：Talker-Reasoner 按状态规则决定等不等；SOFAI 用独立的元认知模块；SwiftSage 用四条代码规则（卡住、动作不合法、关键且不可挽回、出现异常）。这正好支持灵鲸"由代码按清单判断"。
2. **但"代码按清单判断"只能在动作上做到，在话语上做不到。** 代码能可靠判断的是"它要调哪个工具、参数是什么"（记承诺、花钱、联系别人、放宽受众）；代码判断不了"它这句话算不算口头答应了别人"。所以两张清单要翻译成**工具能力和执行处拦截**；话语层面的漏网之鱼，用出站轻量检查加总结分身事后审计兜底（修正 M1、M10）。
3. **隐私必须由代码保证，证据非常强。** ConfAIde、PrivacyLens、MuPPET、MAGPIE、Muses-Bench 一致发现：明确告诉模型要保护隐私，它照样泄露（GPT-4 在多人会议场景 39%；GPT-4 在 agent 动作里 25.68%）；模型"知道规则"和"照规则做"是两回事；多人场景比一对一更糟（GPT 5.5 从 14.22% 升到 26.71%，小开源模型 57%–70%）；加提示词、加思维链的防御只有部分效果，思维链甚至更糟。Audience-Bound 用"组装上下文时就排除"做到 1 万段多方历史 0 泄漏。灵鲸对话分身用的是便宜模型，更不能靠模型自觉。
4. **权限按说话的人、不按话的内容，有工程共识。** OpenAI 的 Instruction Hierarchy 按消息来源分级；CaMeL、FIDES、"六种设计模式"都把授权放在模型之外。但这些只区分"系统、用户、工具输出"，**灵鲸的主人和妈妈在 CLI 里都是"用户"**，所以必须由代码按发送者身份授权。新发现两个要补的洞：一是**权限要沿请示链传下去**（主意识替某人办事时，只能用那个人的权限，否则请示就成了提权通道）；二是**同一轮里混着多人的消息时，每个有后果的动作都要指明是响应哪条消息**（修正 M4）。
5. **"每个对话一个会话、中枢每次醒来新开会话"在工程上有成熟先例。** Erlang 的原则"每个真正并发的活动一个进程""每个进程只担一个角色"；爱立信 AXD301 交换机"不活动时销毁进程、只留 1 KB 通话记录、要用时重建"；Orleans 的虚拟 actor"永远存在、按需激活、闲置回收、提醒持久化"；Anthropic 的长任务做法"每次新开会话、读进度文件接着干"。代价也清楚：**交接件必须够用**；Anthropic 发现压缩不够、要重置加结构化交接，而模型变强后又把重置去掉了，所以"每批新开"应是可配置的默认值，不是信条（修正 M8）。
6. **主意识和人的"监督注意系统"对得上大半，对不上的一处最要紧。** 认知心理学里，日常动作由"竞争调度"自动处理；计划决策、排障、新情况、危险、克服习惯时监督系统介入，而且它只"偏置"下层，不直接动手。灵鲸清单覆盖了其中四类。**对不上的是：人的监督系统一直在线，能自己发现"该介入了"；灵鲸的主意识睡着，没人上报就不知道。** 要补一条"事后审查"通道（修正 M10）。
7. **共享状态单点写、广播、记来源，都有依据。** 黑板架构的经验是"各模块只经黑板交流"可行，难点在控制；Cognition 2026 的"写入保持单线程"；分布式系统的会话保证（Read Your Writes 等）给出了"广播"之外还要补的一致性条件：**发起请示的会话要能立刻读到自己请示的结果**（修正 M3、M11）。来源监控研究说明人靠事后推断来源、容易出错；系统显式存来源标签更可靠，但**整理压缩时一丢标签就会"洗白"**（修正 M12）。
8. **要用户拍板的修正**：M2（主人亲口让她做的花钱、联系别人，是否还要经主意识）、M6（"把一个场合听到的事带到另一个场合"改成"按条目放宽受众"，谁有权放宽）、M7（工作分身的受众跟发起它的对话走）、M16（主人在 QQ、微信上的身份是否分级）。

---

## 1. 来源清单

### 1.1 快慢双系统与认知心理学

| # | 来源 | 实际读了什么 | 一手/二手 |
| --- | --- | --- | --- |
| C1 | Christakopoulou, Mourad, Matarić（Google DeepMind），*Agents Thinking Fast and Slow: A Talker-Reasoner Architecture*，arXiv 2410.08328 | HTML 全文（§1–§5） | 一手 |
| C2 | Bergamaschi Ganapini, Rossi 等（IBM 等），*Thinking Fast and Slow in AI: the Role of Metacognition*，arXiv 2110.01834（SOFAI 架构） | HTML 全文 | 一手 |
| C3 | Khandelwal 等，*Language Models Coupled with Metacognition Can Outperform Reasoning Models*（SOFAI-LM），arXiv 2508.17959 | HTML：摘要、方法（元认知模块）、实验结论、附录里的提示策略 | 一手 |
| C4 | Lin 等，*SwiftSage: A Generative Agent with Fast and Slow Thinking*，arXiv 2305.17390 | HTML：§3.4 切换条件、§4 结果、附录 B（切换实现细节）、C.3（成本） | 一手 |
| C5 | Zhang 等，*DPT-Agent*，arXiv 2502.11882 | 摘要 | 一手·摘要 |
| C6 | OpenAI，`openai/openai-realtime-agents` 仓库（Chat-Supervisor 模式） | README 全文、`src/app/agentConfigs/chatSupervisor/index.ts` 全文 | 一手（源码） |
| C7 | Xiong 等，*Can LLMs Express Their Uncertainty?*，arXiv 2306.13063 | 摘要 | 一手·摘要 |
| C8 | Ren 等，*Robots That Ask For Help*（KnowNo），arXiv 2307.01928 | 摘要 | 一手·摘要 |
| C9 | Norman & Shallice，*Attention to action: Willed and automatic control of behavior*（1980 技术报告 / 1986 书章），监督注意系统（SAS） | **原文没读到**：DTIC 的 PDF 返回 403，Scribd 需登录。读了 Manly 等 1999（PDF 全文，转述 SAS 机制）、维基百科条目、检索摘要 | 二手 |
| C10 | Baddeley 的中央执行（1986 专著、1996 *Exploring the central executive*） | 原文没读到（SAGE 403）；检索摘要（Lancaster 大学术语表、Baddeley 自述的转述） | 二手 |

### 1.2 共享状态、多个专门过程与控制

| # | 来源 | 实际读了什么 | 一手/二手 |
| --- | --- | --- | --- |
| B1 | Salemi 等（UMass、Google），*LLM-based Multi-Agent Blackboard System for Information Discovery in Data Science*，arXiv 2510.01285 | HTML：摘要、§1、§3、成本分析、相关工作（其中对经典黑板架构的描述是它的转述） | 一手 |
| B2 | Han & Zhang，*Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture*，arXiv 2507.01701 | 摘要 | 一手·摘要 |
| B3 | Push Singh（MIT），*Examining the Society of Mind*（2003） | WebFetch 分两次摘录：§3.4–§3.6、§4.3、§4.5 | 一手·转写 |
| B4 | Zhuge、Schmidhuber 等，*Mindstorms in Natural Language-Based Societies of Mind*（NLSOM），arXiv 2305.17066 | HTML 中关于"君主制与民主制"的段落和结论 | 一手 |
| B5 | Nii 1986（AI Magazine 黑板系统两篇）、Corkill 1991、Erman 等 1980（Hearsay-II） | **原文都没取到**：AAAI OJS 返回空、Stanford 和 bbtech.com 连接被断。只有维基百科条目和 B1 的转述 | 二手 |

### 1.3 会话、进程与状态

| # | 来源 | 实际读了什么 | 一手/二手 |
| --- | --- | --- | --- |
| S1 | Joe Armstrong，*Making reliable distributed systems in the presence of software errors*（博士论文，2003） | PDF 全文检索阅读：§2.4（进程隔离、"一一对应"）、§4.4（let it crash）、§5.4–5.5、§8.3（AXD301 案例） | 一手 |
| S2 | Erlang/OTP 官方文档 *Supervisor Behaviour* | WebFetch 摘录 | 一手·转写 |
| S3 | Microsoft，*Orleans overview*（官方文档） | WebFetch 全文 | 一手 |
| S4 | Cloudflare，*Agents: Agent class*（官方文档） | WebFetch 摘录 | 一手·转写 |
| S5 | Anthropic，*Effective harnesses for long-running agents*（2025-11） | WebFetch 摘录；另有 `subagent-notes/cli-multi-agent-practice.md` [4] 的原文摘要 | 一手·转写 |
| S6 | Anthropic，*Harness design for long-running application development*（2026-03-24） | WebFetch 摘录 | 一手·转写 |
| S7 | HumanLayer，`12-factor-agents` 仓库 | README、factor 5、10、12 原文 | 一手 |
| S8 | Starmer 等，I-PASS 交接班研究（NEJM 2014） | 医院新闻稿、检索摘要 | 二手 |

### 1.4 隐私

| # | 来源 | 实际读了什么 | 一手/二手 |
| --- | --- | --- | --- |
| P1 | Mireshghallah 等，*Can LLMs Keep a Secret?*（ConfAIde），arXiv 2310.17884（ICLR 2024） | HTML：摘要、§1、§3.3–3.4、§4.4–4.5、表 4、表 5 | 一手 |
| P2 | Shao 等，*PrivacyLens*，arXiv 2409.00138 | HTML：摘要、§1、§3、§4 结果与分析 | 一手 |
| P3 | *MuPPET: A Benchmark for Contextual Privacy of LLM Assistants in Multi-Party Conversations*，arXiv 2606.23217 | HTML：摘要、§1、§5.1–5.3 | 一手 |
| P4 | Bagdasarian 等（Google），*AirGapAgent*，arXiv 2405.05175 | 摘要 | 一手·摘要 |
| P5 | Ghalebikesabi 等，*Operationalizing Contextual Integrity in Privacy-Conscious Assistants*，arXiv 2408.02373 | 摘要 | 一手·摘要 |
| P6 | *MAGPIE*，arXiv 2506.20737 | 摘要 | 一手·摘要 |
| P7 | *Audience-Bound Persistent Memory*，arXiv 2609.36373 | 摘要（本次核对）；正文要点见 `subagent-notes/memory-benchmarks-poisoning.md` §D | 一手·摘要 |
| P8 | *Collaborative Memory*，arXiv 2505.18279 | 摘要 | 一手·摘要 |
| P9 | Nissenbaum，*Privacy as Contextual Integrity*（2004） | 没读原文；经 P1、P2 对理论的转述 | 二手 |
| P10 | Anthropic Claude 记忆（公告与帮助中心）；OpenAI ChatGPT Memory FAQ | 检索摘要 | 二手 |

### 1.5 权限与授权

| # | 来源 | 实际读了什么 | 一手/二手 |
| --- | --- | --- | --- |
| A1 | Wallace 等（OpenAI），*The Instruction Hierarchy*，arXiv 2404.13208 | HTML：摘要、§1、§3、§5、§6 | 一手 |
| A2 | Greshake 等，*Not what you've signed up for*（间接提示注入），arXiv 2302.12173 | 摘要 | 一手·摘要 |
| A3 | Debenedetti 等，*Defeating Prompt Injections by Design*（CaMeL），arXiv 2503.18813 | 摘要 | 一手·摘要 |
| A4 | Beurer-Kellner 等，*Design Patterns for Securing LLM Agents against Prompt Injections*，arXiv 2506.08837 | HTML：§2、§3 六种模式 | 一手 |
| A5 | *Securing AI Agents with Information-Flow Control*（FIDES），arXiv 2505.23643 | 摘要 | 一手·摘要 |
| A6 | South 等，*Authenticated Delegation and Authorized AI Agents*，arXiv 2501.09674 | 摘要 | 一手·摘要 |
| A7 | *Multi-User Large Language Model Agents*（Muses-Bench），arXiv 2604.08567 | HTML：摘要、访问控制任务、结果、附录案例 | 一手 |
| A8 | Shapira 等，*Agents of Chaos*，arXiv 2602.20021 | 摘要；HTML 正文到第 6 个案例（HTML 版本被截断） | 一手（部分） |

### 1.6 来源与信任

| # | 来源 | 实际读了什么 | 一手/二手 |
| --- | --- | --- | --- |
| T1 | Johnson, Hashtroudi, Lindsay，*Source Monitoring*，Psychological Bulletin 114(1), 1993 | Yale 记忆实验室的扫描版 PDF，用 macOS 自带的文字识别读了第 1–26 页，重点读引言、框架、"睡眠者效应"段落 | 一手（OCR） |
| T2 | *When Does Belief-Based Agent Memory Help?*（Nous），arXiv 2606.22030 | 摘要 | 一手·摘要 |
| T3 | *MMA: Multimodal Memory Agent*，arXiv 2602.16493 | 摘要 | 一手·摘要 |
| T4 | *Ground Truth First*，arXiv 2607.21962 | 摘要 | 一手·摘要 |
| T5 | Slovic 1993（信任不对称原则） | 没读原文；经 T6 摘要 | 二手 |
| T6 | Poortinga & Pidgeon，*Trust, the Asymmetry Principle, and the Role of Prior Beliefs*（Risk Analysis 2004） | IDEAS 摘要页（WebFetch） | 一手·摘要 |
| T7 | White & Eiser 2005（Risk Analysis 25(5)） | IDEAS 摘要页 | 一手·摘要 |
| T8 | Schweitzer, Hershey & Bradlow，*Promises and lies*（2006） | 检索摘要（沃顿商学院的文章转述） | 二手 |

### 1.7 一致性与产业做法

| # | 来源 | 实际读了什么 | 一手/二手 |
| --- | --- | --- | --- |
| K1 | Terry 等（Xerox PARC），*Session Guarantees for Weakly Consistent Replicated Data*（1994） | Cornell 课程存档的 HTML 全文 | 一手 |
| K2 | *Persistent Personas? Role-Playing, Instruction Following, and Safety in Extended Interactions*，arXiv 2512.12775 | HTML：摘要、§1、§5 | 一手 |
| K3 | Moffatt v. Air Canada，2024 BCCRT 149 | 新闻和律所文章的检索摘要；判决书原文没读 | 二手 |
| I1 | Zhou 等（微软），*The Design and Implementation of XiaoIce*，arXiv 1812.08989 | PDF §2–§4.1 | 一手 |
| I2 | Intercom 帮助中心，*Manage Fin AI Agent's escalation guidance and rules* | WebFetch 摘录 | 一手·转写 |
| I3 | Sierra 官方博客（supervisors、monitors） | 检索摘要 | 二手（厂商自述） |
| I4 | Character.AI 的记忆功能 | 只有第三方博客 | 二手，未核实 |

### 1.8 引用的已有调研

`papers-architecture`（§2.2 全局工作空间、§2.5 Anthropic/Cognition/MAST、§2.6 弱模型派活、§2.7 主动性、§2.8 人设漂移、§3.4 便宜模型当主控）；`companion-architectures`（§2.2 Q1 麦麦 Focus 与 Replyer、§3.2 Q1 Letta、§5.2 Q2 eliza 受众与身份、§7.1–7.2）；`openclaw-architecture`（§2.2 Q8 信任边界、§8.1 事故统计）；`subagent-notes/cli-multi-agent-practice.md`、`memory-benchmarks-poisoning.md`；`plugin-architecture` D4（权限只能映射到内核词表）；`overall.md` §5.7、§8.3、§11.4、§17.2 C5/C6。

### 1.9 没取到的

DTIC、SAGE、AAAI OJS、Stanford 技术报告库、bbtech.com、core.ac.uk、Royal Society 都拒绝了下载或断开连接，所以监督注意系统、中央执行、经典黑板架构三处的原文都没读到，相关结论标二手。arXiv 的检索接口中途限流过一次，改用 abs 页面读摘要。

---

## 2. 按问题的文献要点

### 2.1 问题 1："快的对话者 + 慢的中枢"有没有理论和实证支持

#### Talker-Reasoner（DeepMind）〔一手，C1〕

- **分工。** Talker 是"系统 1"：快、一直在线、负责和用户说话，会读记忆来"预热"回答。Reasoner 是"系统 2"：慢，负责多步推理、调工具，并维护一份"信念状态"（关于用户的结构化 JSON，例如目标、障碍、所处阶段）。
- **两者主要通过记忆交互。** 原文："the main way the Talker (System 1) and Reasoner (System 2) interact is through memory." Reasoner 写信念，Talker 读最新信念。
- **Talker 默认不等。** 它可能用旧信念说话："The Talker therefore might operate with a delayed view of the world."
- **等不等由状态里的规则决定，不由 Talker 判断。** 原文："Whether the Talker waits for the Reasoner to finish is determined by the belief—in the planning coaching phase the Talker waits, otherwise it does not."
- **失败模式"草率判断的 Talker"**（snap judgement Talker）：复杂请求上不等 Reasoner 就答，答得浅。
- **作者承认没解决的问题**（§5）："Ideally, given a user query, the Talker should automatically determine whether it requires System 2 reasoning…"，留作未来工作。另一条未来工作是"多个 Reasoner，各自写记忆的不同部分"。
- **证据强度弱。** 只有一个睡眠教练的定性案例，没有定量实验；两边都用 Gemini 1.5 Flash。例子里 Talker 有时原样复述 Reasoner 的回答（"TALKER: copying Reasoner's response"）。

#### SOFAI 与 SOFAI-LM（IBM 等）〔一手，C2、C3〕

- **默认用快系统（S1）。** 慢系统（S2）"never work on a problem unless they are explicitly invoked by the MC module"。
- **叫不叫慢系统，由独立的元认知模块（MC）决定，不由 S1 自己决定。** MC 看四样东西：S1 给出的答案和置信度、"自我模型"（各求解器过去在这类任务上的表现、耗时、回报）、当前资源、做对的预期回报。MC 分两段：MC1 快而粗，大多数时候直接采纳 S1；MC2 慢而细，算"叫 S2 的额外收益是否大于成本"。
- **经验会把问题从慢系统移到快系统**（§2：新问题先由系统 2 处理，积累经验后一部分转给系统 1）。
- **SOFAI-LM 的实测**：MC 用领域专用的校验器检查小模型的答案、给反馈，迭代不收敛或停滞才叫推理模型。调试题上，Granite 8B 加反馈循环 70%（Python）、73%（C++），单独用推理模型只有 37%、40%；图着色上 42% 对 2%。**交给慢系统的上下文要看任务**：图着色只给原题最好，失败历史是噪音；调试题给历史更好。
- **局限。** SOFAI 的 MC 有可计算的置信度和正确性校验；开放闲聊没有这种校验器。

#### SwiftSage〔一手，C4〕

- 小模型 Swift（770M 的 T5）默认干活；遇到以下任一情况切到大模型 Sage（GPT-4），**四条全由代码判断**：
  1. **卡住**：连续 5 步没有得分；
  2. **不合法**：Swift 预测的下一步动作在环境里不合法；
  3. **关键**：要做关键决定，例如给出最终答案。实现上**禁止 Swift 在 Sage 激活前做"focus on"这类一步错就整局结束的动作**；
  4. **意外**：观察到异常，例如"No known action can match"。
- 结果：ScienceWorld 30 类任务平均 84.7 分，Reflexion 45.3、ReAct 36.4；每个动作 757 个 token，ReAct 1971 个。换成 GPT-3.5 后 SwiftSage 还有 62.2，ReAct 跌到 19.8。
- 作者认为以后应该**训练一个模块**来决定何时切换（结论段）。

#### DPT-Agent〔一手·摘要，C5〕

系统 1 用有限状态机加代码策略，系统 2 做异步反思。作者认为用小模型当系统 1"没有根本解决延迟和表现的矛盾"。对灵鲸的含义：快系统里能确定的部分交给代码。

#### OpenAI Chat-Supervisor 示例〔一手源码，C6〕

- 实时小模型（`gpt-4o-realtime-mini`）和用户说话，文本大模型（`gpt-4.1`）当主管，"used extensively for tool calls and more complex responses"。
- **边界写在快模型的提示词里，方向是"默认请示"**："By default, you must always use the getNextResponseFromSupervisor tool to get your next response, except for very specific exceptions." 例外是一张"允许清单"：问候、闲聊、为工具收集参数。
- **请示前先说一句垫话**，而且"Filler phrases must NOT indicate whether you can or cannot fulfill an action"。
- 主管看完整转录，同步返回，快模型"read verbatim"。README："There ~2s between …"；也承认"more assistant responses will start with 'Let me think'"。
- 退货这类高风险决定再升级到 `o4-mini`。

#### 认知心理学：监督注意系统与中央执行〔二手，C9、C10〕

- **竞争调度**（contention scheduling）：熟练的动作程序叫"图式"（schema），日常情况下由外界线索触发，各图式互相抑制，激活最高的胜出，不需要注意力。
- **监督注意系统（SAS）不直接控制行为，只偏置下层。** Manly 等 1999 的转述："Supervisory Attentional modulation of this process is required to construct novel responses and to modify or suppress schema expression when the most activated schema is inappropriate to an overall goal"；"an internal supervisor is able to intercede to bias the competition in its favor"。Baddeley 的转述也说 SAS"not by directly controlling behaviour, but by modulating the activity of lower level systems"。
- **需要 SAS 的五类情况**（Norman & Shallice 1986，经多个二手来源一致转述）：① 计划或决策；② 纠错、排障；③ 没学熟或全新的动作序列；④ 危险或技术上困难；⑤ 要克服强习惯或抵制诱惑。
- **SAS 失效**时出现"捕获错误"：不该出现的熟练动作跑了出来（维基百科）。
- **中央执行。** Baddeley 1986 写专著时借用了 SAS 当中央执行的模型；中央执行被批评为"小人"（homunculus，一个什么都管、但说不清怎么管的假想控制者）。Baddeley 的路线是把它拆成几项具体能力，直到"小人"变得多余；他也提醒不要把中央执行等同于 SAS。

#### 已有调研里的相关证据（引用）

- Cognition 2026 的"聪明朋友"实验：弱模型当主控，恰恰输在"知道何时升级、问什么"；缓解是"对特定情况硬性规定必须调用"（`papers-architecture` §2.5 E5）。
- Advisor 策略里的执行者是**训练过**知道何时求助的（`subagent-notes/cli-multi-agent-practice.md` [6]）。
- 模型自报的置信度普遍偏高（C7）；KnowNo 用统计校准（conformal prediction）在模型外决定何时求助（C8）。

#### 对照灵鲸：对得上多少

| 灵鲸的设计 | 对得上的证据 | 对不上的地方 |
| --- | --- | --- |
| 对话分身默认自己处理，主意识只在被叫时工作 | SOFAI"S1 默认、S2 只在被调用时工作"；SwiftSage；Talker 一直在线 | Chat-Supervisor 方向相反：默认请示、清单放行。它的场景是客服，每句话都可能涉及账户事实 |
| 由代码按清单判断要不要请示 | Talker-Reasoner 按状态规则；SOFAI 用独立的元认知模块；SwiftSage 四条代码规则；Cognition"硬性规定" | 这些系统里能被代码判断的都是**动作或环境信号**（动作不合法、连续没得分、要给最终答案），没有一个是在判断"一句话的含义"。见修正 M1 |
| 请示时先稳住（"我问问"） | Chat-Supervisor 的垫话，且垫话不能暗示结果 | — |
| 快慢通过共享状态交流 | Talker-Reasoner"主要通过记忆交互" | — |
| 主意识不直接跟人说话，托对话分身说 | SAS 只偏置、不直接执行；Talker 复述 Reasoner | Talker-Reasoner 和 Chat-Supervisor 里慢系统的原话常常被原样转给用户；灵鲸让对话分身重新措辞，会有转述失真（见 M15） |
| 主意识醒得少，唤醒源是请示、时钟、冲突、卡住 | SwiftSage 的"卡住、关键、意外"；SAS 的"排障、危险、计划" | ① SwiftSage 的"意外"和 SAS 的"全新情况"在灵鲸清单里没有对应。② **SAS 和 Talker-Reasoner 的 Reasoner 都持续在线**（Reasoner 每轮都处理对话、更新信念）；灵鲸的主意识默认看不到对话，没人上报就不知道（见 M10） |
| 总结分身在后台抽记忆、形成"对她和别人的看法" | Talker-Reasoner 的 Reasoner 一直在做"形成信念"；作者的未来工作提到多个 Reasoner 各写一部分记忆 | 灵鲸把 Reasoner 拆成两半：总结分身负责形成信念，主意识负责做决定。这是合理的拆法，但两者之间要有接口：总结分身发现的异常要能叫醒主意识（M10） |
| 清单可配置 | SOFAI 的"自我模型"会根据结果调整何时叫慢系统 | 灵鲸的清单目前是静态的；可以记录每类请示的结果，供主人调整（M9） |

### 2.2 问题 2：共享状态 + 多个专门过程 + 控制

#### 黑板架构〔B1 一手；B3 一手·转写；B5 二手〕

- **三部分**（Nii 1986，经 B1 转述）："(1) a global, hierarchical data structure (the blackboard) that maintains the current state of the solution; (2) independent specialist modules, known as knowledge sources, which monitor the blackboard and contribute partial solutions; and (3) a control mechanism that opportunistically determines which knowledge source to activate next." 知识源之间不直接通信，只经黑板。
- **最难的是控制。** Singh（B3 §4.5）："There have been serious challenges in finding good ways to control the inferencing that happens on the blackboard." 他还指出：各模块往往看不懂彼此的表示；模块之间有冲突时，黑板模型"offers no special solutions"；到几百个模块时黑板的比喻就不成立了。结论是需要"more 'managerial' expertise within the system about problem-solving itself"，也就是"什么时候用哪种知识"的管理知识。
- **LLM 黑板的实测**（B1）：主 agent 把请求贴到黑板，子 agent 自己决定要不要响应。对比"主从式"（中心按每个子 agent 的能力派活）：端到端成功率相对提高 13%–57%；时延差不多（132–145 秒）；单题花费更高。作者给的理由是主从式要求中心"maintain an accurate model of each agents capabilities"，这在子 agent 知识不断变化时不现实。
- B2：按黑板当前内容选择下一个行动的 agent，在常识、推理、数学题上平均表现最好，token 更少（摘要）。

#### 心智社会（Society of Mind）〔B3 一手·转写；B4 一手〕

- **B 脑看 A 脑。** "B-brain"的工作是看着"A-brain"的思考过程，发现"looping"（打转）、"meandering"（东游西荡）这类与具体方法无关的毛病并纠正（B3 §3.4）。
- **审查者与抑制者。** "Censors suppress the mental activity that precedes unproductive or dangerous actions"；"suppressors suppress those unproductive or dangerous actions themselves"。Singh 称这是"负面专长"：知道什么不该做。
- **不妥协原则。** 冲突是"需要重新表述问题"的信号，由更高一层的管理者换个角度让冲突消失，而不是两边折中（§3.6）。
- **工程结论很弱。** Singh 说理论是零散的，"it has been hard to find good 'higher level' abstractions for agencies"。NLSOM 的实验：视觉问答上"君主制"（一个领导者）胜过"民主制"（投票），另一些任务相反；作者说"only sometimes did we observe democracies beating monarchies"，并指出民主制容易被策略性投票操纵。

#### 对照灵鲸

- 本体状态就是黑板，各会话就是知识源，会话之间只经本体（overall P4）。这一条有 40 多年的工程先例。
- 黑板最难的是控制。灵鲸的控制分两层：确定性的部分（路由、门控、清单拦截、冲突检测）由代码做；需要判断的部分（拍板、定方针）由主意识做。这正是 Singh 说的"管理知识"要显式存在，而不是指望各模块自觉。
- 灵鲸的会话数量不大（几个到几十个），不会碰到"几百个模块"的规模问题。
- 主意识派活的对象都是她自己的分身，能力是已知的，所以 B1 批评的"主从式要知道每个子 agent 的能力"在灵鲸里不成立，派活用主从式没问题。
- 心智社会能借的是三个思路，都只是启发，不是实证：用代码"看着"会话有没有打转（B 脑）；清单是"抑制者"，放在动作上；冲突往上交，由更高一层换角度处理。

### 2.3 问题 3：每个对话一个会话、中枢每次醒来新开会话，工程上站不站得住

#### Erlang/OTP 与 actor 模型〔S1、S2 一手〕

- **actor 模型**：每个"actor"是一个独立的小进程，自己持有状态，只通过消息和别人交流。Erlang 是它最成熟的工程实现。
- **一一对应。** Armstrong §5.4："Use one parallel process to model each truly concurrent activity in the real world." §2.4："It is extremely important that the mapping is exactly 1:1… If this mapping is not 1:1 the program will quickly degenerate"。他举的例子正是即时通讯："we might choose to use one process per user"。
- **一个进程只担一个角色**（§5.5）："As far as possible a process should only have one role"。角色举例：监督者、工作者、可信工作者。
- **隔离、不共享状态、出错就崩**（§2.4、§4.4）："Processes share no resources"；"let it crash"：出错时让进程崩掉，由别的进程（监督者）修复。
- **稳定存储**（§2.4 引 Schneider）：状态分"崩溃后还在的稳定存储"和"崩溃就丢的易失存储"。
- **AXD301 交换机的做法**（§8.3）：通话建立完成后，"all information is reduced to a 'call record' (this is about 1 KB/call) and the six processes used in call setup are destroyed"；要修改通话时，"the call record is retrieved and the process structure necessary to manipulate the call is created and initialized with data from the call record"。他的总结："For very long-lived processes, storing the process state in a data base when the process is not active, is an attractive alternative."
- **监督树**（S2）：监督者负责启动、停止、监控子进程。重启策略：`one_for_one` 只重启崩掉的那个；`one_for_all` 全部重启；`rest_for_one` 重启它和它之后启动的。重启次数有上限（默认 5 秒内最多 1 次），超了监督者自己退出，交给上一层。

#### 虚拟 actor 与按需激活〔S3、S4〕

- **Orleans**："Actors are purely logical entities that *always* exist, virtually. An actor cannot be explicitly created nor destroyed, and its virtual existence is unaffected by the failure of a server that executes it."；"Grains not used for a while are automatically removed from memory to free up resources."；提醒（reminder）是"a durable scheduling mechanism for grains… even if the grain isn't currently activated"。
- **Cloudflare Agents**：每个 agent 就是一个 Durable Object，状态存在它自己的 SQL 表里；闲置后被回收，来请求时重新构造；用 `alarm()` 定时唤醒；单线程执行。

#### Anthropic 的长时间运行 agent〔S5、S6 一手·转写〕

- 2025-11：核心难题是"each new session begins with no memory of what came before"，类比"engineers working in shifts"。做法：初始化会话写进度文件 `claude-progress.txt`、JSON 格式的功能清单、初始 git 提交；之后每个会话先读进度文件和 git 日志再开工。用 JSON 的理由："the model is less likely to inappropriately change or overwrite JSON files compared to Markdown files"。"compaction isn't sufficient"，因为压缩"doesn't always pass perfectly clear instructions to the next agent"。
- 2026-03：区分"压缩"（同一个 agent 接着用缩短的历史）和"上下文重置"（清空，开新 agent，配"a structured handoff that carries the previous agent's state and the next steps"）。重置的代价是交接件要有"enough state for the next agent to pick up the work cleanly"。Sonnet 4.5 有"上下文焦虑"（快到上限时草草收尾），所以重置必不可少；**Opus 4.5"largely removed that behavior on its own, so I was able to drop context resets from this harness entirely"**。原则："every component in a harness encodes an assumption about what the model can't do on its own."

#### 有状态与无状态的取舍〔S7 一手；已有调研〕

- 12-factor agents：factor 5"把执行状态和业务状态统一"，好处是"One source of truth for all state"、可序列化、可从任意点恢复、可分叉；factor 12"把 agent 做成无状态的归约函数"（输入事件序列，输出新状态）；factor 10"小而专注的 agent"，"3-10, maybe 20 steps max"。
- Letta 的做法是身份和记忆按 agent 共享、历史按对话隔离，记忆改动只在下一个对话生效（`companion-architectures` §3.2 Q1）。
- 医院交接班：I-PASS 结构化交接在 9 家儿科住院医师项目里，医疗差错从每百次入院 24.5 降到 18.8（-23%），可预防的不良事件从 4.7 降到 3.3（-30%）〔二手，S8〕。这是人类"轮班接力"场景里结构化交接有效的证据。

#### 对照灵鲸

- **每个对话一个对话分身** = Erlang 的"每个真正并发的活动一个进程"。主人的日常聊天（主控台默认、QQ、微信私聊）合成一个对话分身，也符合"一一对应"：对主人来说这是同一段关系里的同一个活动。
- **主意识不聊天** = "一个进程只担一个角色"。OpenClaw 主会话把聊天和后台事件混在一起出的事故（#30197 用户回复被 heartbeat 回合吞掉、#151962 内部字符串被当成用户消息）是反面证据（`openclaw-architecture` §8.1）。
- **主意识每次醒来新开会话** = AXD301 的"销毁进程、留下记录、要用时重建"，Orleans 的虚拟 actor。它的身份（她的状态、承诺、决定记录）一直在，只有"活着的会话"是临时的。
- **风险**：交接件不够就会丢推理连续性；Anthropic 的经验是这取决于模型，强模型可能不需要重置。灵鲸的主意识计划配强模型，所以"每批新开"适合作为可配置的默认值（决策 11 已经允许"保留一段时间"）。

### 2.4 问题 4：隐私为什么必须由代码保证

#### 情境完整性理论〔二手，P9；经 P1、P2 转述〕

隐私不是"信息是否保密"，而是"信息流动是否符合它所在情境的规范"。一条信息流由五个参数刻画：谁发出、谁接收、关于谁、什么类型、按什么原则传递（PrivacyLens §1："who the information is about, the social relationship between the sender and the recipient, and the method of information transmission"）。同一件事，妈妈私下告诉她，可以；她在群里说出来，就违反了规范。这正是灵鲸"隐私跟着受众走"的理论基础。

#### 评测：明确要求保护隐私，模型照样泄露

| 研究 | 场景 | 关键数字 | 关键原话 |
| --- | --- | --- | --- |
| ConfAIde〔P1〕 | 第 4 层：会议上三人先谈论 X 的秘密，之后 X 加入；模型写会议纪要发给所有与会者 | GPT-4 平均 39%、ChatGPT 57% 泄露秘密；最坏情况（10 次中有 1 次泄露就算）GPT-4 80%。第 3 层：GPT-4 22%、ChatGPT 93% | "even though they are directly instructed to preserve privacy"；"ad hoc safeguards (e.g., privacy-inducing prompts, chain-of-thought reasoning and output filters) are insufficient"；加思维链后"it makes the leakage more severe" |
| PrivacyLens〔P2〕 | agent 读日历、邮件后替用户发消息 | 加了隐私增强提示词：GPT-4 25.68%、Llama-3-70B 38.69% 泄露 | GPT-4 和 Claude-3-Sonnet"answer almost all trajectory-level probing questions correctly yet leak the sensitive information on 27.23% and 38.83% of cases"；"larger models can perform better on probing evaluation but not on the action-based evaluation"；隐私提示词让模型在"思考"里提到隐私，但"may still leak information, despite considering privacy in their thought process" |
| MuPPET〔P3〕 | 群聊里的助手 | 一对一 → 多人：Gemini 2.5 Pro 9.88% → 23.46%；GPT 5.5 14.22% → 26.71%；Qwen3 14B 40.99% → 63.35%；小开源模型多人场景 57%–70% | "every piece of private information must be appropriate for every recipient in the group"；现有防御"offer only partial protection, degrade utility, and do not resolve the underlying party-tracking problem"；小模型"often preferred for local deployment… even more so" |
| MAGPIE〔P6〕 | 多 agent 协作的多轮对话 | 即使有明确隐私指令，GPT-4o 59.9%、Claude 50.5% 泄露 | — |
| Muses-Bench〔A7〕 | 多用户访问控制，告诉模型授权名单 | 隐私分数随轮数持续下降，Claude-3.5-Haiku 四轮内明显下滑 | "refusal-leak paradox"：嘴上拒绝"直接访问"，却把具体秘密说了出来 |

#### 结构性做法：在模型看到之前排除

- **AirGapAgent**〔P4〕：只给 agent 完成任务必需的数据。一次上下文劫持攻击让 Gemini Ultra 的保护率从 94% 降到 45%；AirGapAgent 保持 97%。
- **Audience-Bound**〔P7〕：每条记忆带"记录时的在场者"；派生记忆取来源受众的交集或被抑制；受众只能通过针对具体条目的显式授权放宽；只有当前所有在场者都在授权受众里，这条才能进上下文；在场者不明时只用公开记忆。**"enforced by exclusion rather than by model behavior"**。1 万段多方历史里 0 条越权进入上下文；不加作用域的检索有 82% 的上下文含越权条目；加作用域后 Recall@5 反而高 0.30。
- **Collaborative Memory**〔P8〕：每个记忆片段带不可变的来源属性，读策略按"用户 × agent × 资源"的当前权限投影出过滤后的视图，权限撤销能回溯生效。
- **产业**〔二手，P10〕：Claude 给每个项目单独一份记忆、过去对话的搜索限定在项目内；ChatGPT 有"仅项目内记忆"，但有用户报告隔离不彻底。

#### 对照灵鲸

- 强支持"代码保证：对话分身只拿得到在场的人都能知道的记忆"。五个评测从不同角度证明：靠人设和提示词不行；多人场景更难；便宜模型更差。灵鲸对话分身默认用 DeepSeek V4.1 Flash，属于更危险的一档〔推理〕。
- 剩下的缝都在"谁能看全部"的地方：① 主意识看全部记忆，托人转话时可能夹带（overall §8.3、C5）；② 主人的对话分身"只有主人在场时就是全部"，家人私下说的事会进主人对话的上下文（overall §17.2 C6）；③ 工作分身如果默认拿"主人能知道的"记忆，而发起它的是别人的对话，就越权了（见 M6、M7）。

### 2.5 问题 5：权限跟着说话的人走、不看话的内容

- **Instruction Hierarchy**〔A1〕：攻击得逞的根源是模型把系统提示和第三方文本"the same priority"；提出系统消息 > 用户消息 > 工具输出，训练模型忽略与上级冲突的下级指令。系统提示泄露的防御提高 63%，越狱鲁棒性提高 30% 以上；代价是一些"过度拒绝"。作者承认"our current models are likely still vulnerable to powerful adversarial attacks"。**它按消息类型分级，分不出两个都发"用户消息"的人谁的权限高。**
- **间接提示注入**〔A2〕：LLM 应用"blur the line between data and instructions"；被检索进来的提示"can act as arbitrary code execution"，能控制"how and if other APIs are called"。
- **六种设计模式**〔A4〕的共同原则："once an LLM agent has ingested untrusted input, it must be constrained so that it is impossible for that input to trigger any consequential actions"。其中：
  - **动作选择器**：agent 只把请求翻译成预定义的工具调用；
  - **先计划后执行**：碰到不可信数据前先定好工具调用清单；
  - **双 LLM**："A privileged LLM has access to tools but never processes untrusted data. This LLM can call a quarantined LLM to process untrusted data, but without any tool access"；
  - **上下文最小化**：用完就把用户提示从上下文里去掉。
- **CaMeL**〔A3〕：从可信查询里提取控制流和数据流，不可信数据"can never impact the program flow"；用"能力"标签在调工具时执行安全策略；AgentDojo 上 77% 的任务有可证明的安全性（不设防 84%）。**FIDES**〔A5〕：给数据打保密性和完整性标签，确定性地执行策略。
- **按委托授权**〔A6〕：在 OAuth 2.0 上扩展 agent 专用凭据，把自然语言写的权限翻译成可审计的访问控制配置。
- **多用户实测**〔A7、A8〕：Muses-Bench 里伪造授权、角色扮演攻击有效。Agents of Chaos：6 个 OpenClaw agent、20 位研究者、两周，观察到"unauthorized compliance with non-owners, disclosure of sensitive information… identity spoofing vulnerabilities"；agent 执行了非主人要求的大部分文件操作和数据传输；原文强调"Displayed identity should not be conflated with verified authority"。
- **OpenClaw 自己的信任模型**："所有能给 agent 发消息的人，共享这个 agent 被授予的工具权限"；顺序是"先管身份，再管范围，最后才指望模型"（`openclaw-architecture` §2.2 Q8）。

**对照灵鲸。** 支持"权限跟着说话的人走、由代码执行"。要补两件事〔推理，有上面的依据支撑〕：

1. **权限要沿请示链传递。** 对话分身替妈妈请示"帮我订个餐厅"，主意识醒来去办，如果用主意识自己的权限，妈妈就借主意识提了权。这在安全领域叫"糊涂代理"（confused deputy：一个权限大的中间人被权限小的一方利用去做越权的事；概念出自 Norm Hardy 1988，原文未读〔未核实〕）。CaMeL 的能力标签、FIDES 的信息流标签都是"标签跟着数据走"的做法。
2. **一轮里有多人的消息时，权限按消息算。** 群聊防抖会把几个人的消息合成一轮。每个有后果的工具调用必须引用它响应的消息号，权限取该消息发送者的；没引用或引用不明，按在场者里最低的算。这和 overall R2"收件人来自事件号"是同一个思路。

### 2.6 问题 6：记来源、信多少因人而异

#### 来源监控〔一手 OCR，T1〕

- **来源**指"the conditions under which a memory is acquired (e.g., the spatial, temporal, and social context of the event; the media and modalities through which it was perceived)"。
- **人不存来源标签，靠回忆时推断。** "A central claim of the source-monitoring approach is that people do not typically directly retrieve an abstract tag or label that specifies a memory's source, rather, activated memory records are evaluated and attributed to particular sources through decision processes performed during remembering." 所以人会出错，比如"不记得要讲笑话的这个人，是不是当初讲给你听的那个人"（原文例子）。
- 判断来源既有快速的启发式判断，也有费力的系统性检索和推理。
- **睡眠者效应**：隔得越久，人越容易忘掉"这是从不可靠来源听来的"，不可靠信息的影响反而变大；对故事不感兴趣、没有用心标记来源的人更容易受影响。
- **对灵鲸**：系统在写入时显式存来源，比人的来源判断可靠，这是数字生命可以"比人做得好"的地方。反过来说，如果每晚整理时把来源丢了，就会出现系统版的睡眠者效应：某个群友随口说的话，压缩几轮后变成"事实"。`subagent-notes/memory-benchmarks-poisoning.md` §D 的 Compaction Laundering（压平角色后伪造的用户回合被洗成真实指令，成功率 87%–100%）和 Memory Echo（同一来源的说法反复回写占据检索位）是同一类问题。

#### agent 记忆里按来源加权〔一手·摘要，T2–T4〕

- **Nous**：按观察的可靠性做贝叶斯更新，在证据可信度不同的场景里明显好于"后写覆盖"；但"content-derived reliability is itself vulnerable to manipulation"，所以提出**信任上限由来源决定**（provenance-capped），能扛住批量投毒。
- **MMA**：读取时给每条记忆算可靠性分（来源可信度、时间衰减、冲突感知的共识），证据不足就弃答。
- **Ground Truth First**："injection resistance tracked whether provenance boundaries survive representation"，也就是来源边界在存储表示里保不保得住，决定了抗注入能力；写入阶段质量差的事实下游失败 24%，写得好的 2%。
- 已有存档：MemOS 的来源签名、SENTINEL 的来源标签检查、MINJA 等投毒研究"所有基于内容的检测都被绕过，有强证据的只有结构性手段"（`memory-benchmarks-poisoning.md` §E）。

#### 人际信任更新：是否"失去比获得快"〔T5–T8〕

- **Slovic 1993 的不对称原则**："trust is much easier to destroy than to create"（经 T6 转述）。
- **但不对称是有条件的。** Poortinga & Pidgeon 2004（英国 396 人，转基因食品）：负面事件影响更大，但主要是"确认偏差"：已有明确看法的人按原有看法解读事件；只有没主见的人才表现出纯粹的"负面偏差"。White & Eiser 2005：对"政策类"信息不对称弱于"事件类"；低风险行业（制药）里正面政策的影响甚至大于负面。旅游领域有研究发现是对称的（检索摘要）。
- **欺骗的伤害更持久**〔二手，T8〕：承诺改正能加快信任恢复，但之前有过欺骗时承诺的效果打折扣。

**对照灵鲸。** "每条记忆记来源、信多少由关系和成长决定"有支持。补三点〔推理〕：① 出生设定里"信任涨多快、掉多快"分开配是对的，但不要把"失去比获得快"写死，它随看法是否已形成而变（product.md 的"成长速率"已经这样设计）；② 负面事件区分"没做到"和"骗了我"两类，后者恢复更慢；③ 信任只影响"信多少"，永远不影响"能让她做什么"，权限只由主人设定（product.md"身份角色只有主人能改"；Muses-Bench 的伪造授权攻击是反例）。

### 2.7 问题 7：一个身份、多个并行会话的一致性

- **人设在长对话里会褪色。** Persistent Personas〔K2〕：100 多轮的对话里，七个模型的人设忠实度（知识、风格、角色一致性）都下降，"goal-oriented dialogues accelerate degradation"，模型逐渐退回无人设的默认行为；规模变大能缓解，但"scaling alone is insufficient"。已有的人设漂移研究（`papers-architecture` §2.8）结论一致。对灵鲸：对话分身按轮数换新、人设放在稳定段是对的；**工作分身最容易丢人设**，因为它的对话是目标导向的。
- **多会话的记忆一致性。** Letta：A 对话学到的东西，B 对话要等下一次开会话才看到（`companion-architectures` §3.2 Q1）。MemoryAgentBench：读的时候让模型自己判断哪条更新，普遍失败，冲突要在写入时显式版本化（`memory-benchmarks-poisoning.md` §A3）。
- **多个会话各自对外说话的矛盾。** Cognition 2025："Actions carry implicit decisions, and conflicting decisions carry bad results"（`papers-architecture` §2.5）。法律案例〔二手，K3〕：加拿大航空的网站聊天机器人告诉乘客丧亲票价可以事后申请，与官网另一页的政策矛盾；仲裁庭判公司赔偿，理由是乘客"no reason"相信网站一部分准确、另一部分不准确。**对灵鲸：任何一个分身说出去的话，在别人眼里都是"她"说的。**
- **分布式系统的一致性条件**〔一手，K1〕：Bayou 项目提出四种"会话保证"，用来让单个会话在副本不同步时仍看到和自己行为一致的数据：
  - Read Your Writes："read operations reflect previous writes"；
  - Monotonic Reads："successive reads reflect a non-decreasing set of writes"；
  - Writes Follow Reads："writes are propagated after reads on which they depend"；
  - Monotonic Writes。
  作者的目标是"consistent with the model of a single centralized server"。对灵鲸〔推理〕：对话分身相当于读快照的副本，"下一轮开头收到广播"是有界的滞后。还缺一条 Read Your Writes：**发起请示的那个对话分身，必须能马上看到请示的结果**，否则它会重复请示，或在不知道结果时继续说话。
- **补救手段汇总**：单点写（Cognition 2026"writes stay single-threaded"）；广播（全局工作空间理论，`papers-architecture` §2.2）；写入时的冲突检查（灵鲸 agenda）；对已经说出去的矛盾，显式更正（见 M11）。
- **小冰的做法**〔一手，I1〕："A social chatbot needs to present a consistent personality to set the right expectations for users in the conversation and gain their long-term confidence and trust"；但小冰按平台和地区设计了**不同的**人设。灵鲸的选择是一个人设、按场合调整说话方式（规则三），比小冰更强调"同一个她"。

### 2.8 问题 8：反例与失败

| 失败类型 | 文献或项目里的表现 | 补救 |
| --- | --- | --- |
| 中枢成为瓶颈 | Erlang 社区的常见问题：一个 gen_server 顺序处理信箱，消息堆积、调用超时〔二手〕；黑板系统"控制"是最难的部分〔B3〕；全局工作空间是串行的、容量有限（`papers-architecture` §2.2） | 能由代码确定的冲突不进中枢；请示有期限；中枢一次处理一批；监控信箱长度（overall §4.7 已有"邮箱有上限、记最后消费时间"） |
| 中枢单点故障 | 主意识的 CLI 或模型出错时，所有请示都卡住〔推理〕 | 请示到期按安全默认处理（不答应、继续稳住、或转主人）；主意识配备用大脑（product.md 已有）；监督树式重启与重启上限〔S2〕 |
| 请示太频繁 | Intercom 建议升级指引要窄：指引越宽，升级越多，解决率越低（经工具转写，可能不是逐字原文）〔I2〕；Chat-Supervisor 很多回答都以"让我想想"开头〔C6〕；主动打扰误报 50%–65%（`papers-architecture` §2.7） | 清单收窄到动作；统计请示率和"主意识照准率"，照准率很高的类别考虑下放（SOFAI 的思路）〔推理〕 |
| 请示太少（快系统不知道何时该请示） | Talker 的"草率判断"〔C1〕；弱主控不知道何时升级（Cognition 2026）；模型自报置信度偏高〔C7〕；MAST"该问不问"6.8% | 不让快系统自己判断：动作层由代码拦截；话语层出站检查加事后审计（M1、M10）；Sierra 的做法是并行的"supervisor"逐条审查回复、高风险话题可以拦截〔二手，I3〕 |
| 对话之间不一致 | Flappy Bird 例子；加航案例；OpenClaw 串话（`openclaw-architecture` §8.1） | 单点写、广播、Read Your Writes、显式更正（M3、M11） |
| 新开会话丢失推理连续性 | Anthropic："compaction isn't sufficient"、交接件要有足够状态〔S5、S6〕；OpenClaw #60213、#98156：压缩超时后静默新开空会话，整段上下文丢失（`openclaw-architecture` §8.1.2） | 决定记录带理由和"在等什么"；结构化 JSON 交接；会话结束前代码检查交接是否写好（M8） |
| 非主人借 agent 做事 | Agents of Chaos 案例 2、3〔A8〕 | 权限按消息发送者、沿请示链传递（M4） |
| 中枢吞下不可信原文 | 间接提示注入〔A2〕；"读过不可信输入后不得触发有后果的动作"〔A4〕 | 主意识看结构化请示，原文按需取并打标；读过外人原文的回合只能做发起人权限内的事（M5） |
| 整理时来源被洗掉 | 睡眠者效应〔T1〕；Compaction Laundering；Memory Echo | 派生记忆保留来源链和受众交集，代码校验（M12） |
| 自己的消息被当成别人的 | Agents of Chaos 案例 4：Flux 把自己在 Discord 上的旧消息当成"另一个自己"，开始公开贴自己的源码〔A8〕 | overall R9"自己的消息回流时标记为她说的"已有 |

### 2.9 问题 9：产业做法

| 产品或项目 | 一个身份、多个渠道或对话怎么组织 | 一手/二手 |
| --- | --- | --- |
| 微软小冰〔I1〕 | 部署在 40 多个平台（微信、QQ、微博、Facebook 等）。三层：用户体验层（接平台，含"是不是在跟机器人说话"的分类器）、对话引擎层、数据层（存小冰和所有活跃用户的画像）。对话管理器的"全局状态跟踪器"在**每次会话开始时是空的**，用户画像在数据层。顶层策略选择"核心聊天"还是某个技能，触发器有的是模型，有的是关键词规则；尽量不频繁切换技能 | 一手 |
| OpenAI Chat-Supervisor〔C6〕 | 快模型对话，慢模型当主管；边界是提示词里的允许清单；同步等待；垫话 | 一手源码 |
| Intercom Fin〔I2〕 | 两种升级机制并存：**升级规则**（检测到结构化属性就转人工，不让模型生成回答）和**升级指引**（自然语言写给模型的指令）；有结构化数据时用规则，只有意图或行为时用指引；规则可以按渠道、受众限定；建议指引要窄 | 一手·转写 |
| Sierra〔I3〕 | 每个生产 agent 由几个"supervisor"并行审查每条回复和动作，高风险话题可以从"观察"切到"拦截"；"monitor"事后评估 | 二手（厂商自述） |
| ChatGPT〔P10〕 | 保存的记忆 + "参考聊天历史"（从过去对话里自动取有用信息，官方说"不会保留每个细节"）；项目可设"仅项目内记忆" | 二手 |
| Claude〔P10〕 | 每个项目单独一份记忆；搜索过去对话限定在项目内；无痕对话不进历史 | 二手 |
| Letta（已有调研） | 身份和记忆按 agent 共享，历史按对话隔离；渠道绑定到某个对话；记忆改动下个对话生效 | 一手（`companion-architectures` §3.2） |
| 麦麦（已有调研） | 每个聊天流一个运行时；Focus 共享组让多个聊天共用一个规划器，隐私靠"Replyer 只看目标聊天历史" | 一手（`companion-architectures` §2.2 Q1） |
| Cloudflare Agents〔S4〕 | 每个 agent 实例一个 Durable Object，自带 SQL 状态，闲置回收，定时唤醒 | 一手·转写 |
| Character.AI〔I4〕 | 第三方博客说每个对话有自己的置顶记忆，一个对话的经历不会自动带到同一角色的另一个对话 | 二手，未核实 |

**归纳**〔推理〕：产业里"一个身份、多个渠道"的主流做法是"身份和长期记忆共享、对话上下文按会话隔离、会话开始时从存储里装配"，和灵鲸一致。"何时升级到更强的处理者"普遍是**规则加指引的混合**：结构化信号走确定性规则，语义信号写成给模型的指引。没有找到一家产品把"不聊天的中枢"做成独立的常驻角色；最接近的是 Chat-Supervisor 和 Sierra 的 supervisor，但它们是"每轮同步帮忙"或"并行审查"，不是"被叫醒才工作的决策者"。这是灵鲸比较独特的地方，也意味着没有现成产品可以照抄它的唤醒和交接细节。

---

## 3. 逐条检验表

结论三档：**保持**（不改）、**补充**（结构不变，补规则）、**修改**（要改写设计点）。

| # | 设计点 | 支持的证据 | 冲突或风险 | 修正建议 | 结论 |
| --- | --- | --- | --- | --- | --- |
| D1 | "她"是本体里的状态，不住在任何会话里；所有会话读它、把经过写回操作日志，日志是唯一事实来源 | AXD301"进程销毁、记录留下"、Orleans 虚拟 actor〔S1、S3〕；12-factor"一个事实来源"〔S7〕；Talker-Reasoner 通过记忆交互〔C1〕；黑板〔B1〕；CoALA（`papers-architecture` §2.1） | 无 | — | 保持 |
| D2 | 对话分身：每个对话一个 | Erlang"每个真正并发的活动一个进程"、"一一对应"、即时通讯里一人一进程〔S1〕；小冰每次会话独立的状态跟踪器〔I1〕；Letta 历史按对话隔离；隐私评测（多人更难，分开更好控制）〔P3〕 | 会话多了，要靠闲置回收控制开销 | overall 已有"闲置回收、按轮数换新" | 保持 |
| D3 | 主人的和别人的对话分身是同一种、能力配置相同 | Erlang"一个进程一个角色"：对话分身的角色就是"面对一个对话"；权限按说话的人走后，会话种类不必区分主人〔A1、A4、`openclaw-architecture` §2.2 Q8〕 | 同一种会话里，主人的对话上下文是"全部记忆"，别人的是受众过滤后的，配置相同但输入差别很大；主人体验完全取决于对话分身的大脑 | 见 D6；"能力配置相同、有效权限按消息发送者"写清楚 | 保持 |
| D4 | 主人的日常聊天：主控台默认对话、QQ 私聊、微信私聊算同一个对话分身 | Erlang 一一对应（同一段关系、同一个活动）；麦麦网页和桌宠共用一个主人聊天流（`companion-architectures` §2.2 Q3）；Monotonic Reads：主人换渠道后看到的不会倒退〔K1〕 | 主人在外部渠道的身份只靠账号绑定，QQ 号被盗就等于主人 | M16（主人身份按渠道分级，待拍板） | 保持（M16 待拍板） |
| D5 | 主控台另开的话题对话各自一个；主人的每个对话分身开头注入"最近在别处聊了什么" | ChatGPT"参考聊天历史"、Claude 项目内搜索〔P10〕；Anthropic 的"即时加载"（`cli-multi-agent-practice.md` [3]） | 回顾是有损的（ChatGPT 自己说不保留每个细节）；如果某个话题对话里有别人在场，回顾要按受众过滤 | M14：代码生成、带时间和指针、限长；加按受众过滤的检索工具补细节；只注入受众相同的对话 | 补充 |
| D6 | 对话分身默认用快而便宜的模型（DeepSeek V4.1 Flash） | Talker 用 Flash 级模型〔C1〕；SOFAI、SwiftSage 都是快的默认〔C2、C4〕；Chat-Supervisor 快模型用 mini〔C6〕 | 小模型在多人场景泄露最多〔P3〕；PrivacyLens 规模不改善动作层泄露〔P2〕；弱主控不知道何时升级（Cognition 2026）；人设忠实度随规模下降更快〔K2〕 | 隐私和权限全部由代码保证（D15、D16），不依赖模型；决策 6 的 20 个场景评测里加多人隐私和"该请示没请示"两类题 | 保持（评测补题） |
| D7 | 主意识只有一个，不直接跟任何人聊天，只当中枢 | SAS 不直接执行、只偏置下层〔C9〕；"一个进程一个角色"〔S1〕；双 LLM 模式"有权限的 LLM 从不处理不可信数据"〔A4〕；OpenClaw 混用事故（`openclaw-architecture` §8.1） | SAS 和 Talker-Reasoner 的慢系统都持续在线；主意识睡着时谁来发现问题 | M10 事后审查通道；M5 主意识不直接吞外人原文 | 补充 |
| D8 | 主意识的唤醒源：对话分身按清单请示、时钟、冲突、活卡住了 | SwiftSage 的"卡住、关键"〔C4〕；SAS 的"排障、危险、计划"〔C9〕；Orleans 的持久提醒〔S3〕 | 缺"意外"和"全新情况"；缺"事后发现的问题" | 唤醒源加两类：总结分身审计发现的问题（M10）、代码可检测的异常信号（身份异常、工具反复失败、对方强烈负面情绪）〔推理〕 | 补充 |
| D9 | 主意识的职责：拍板、主动找人、定方针、派活、托对话分身把话说出去 | SAS 的计划决策、偏置下层〔C9〕；黑板的"管理知识"〔B3〕；Baddeley 把中央执行拆成具体职能〔C10〕 | 托人转话会失真（LangChain：主管转述引入错误，原样转发约提升 50%，`cli-multi-agent-practice.md` [10]）；转话通道是剩下的隐私缝（overall C5） | M15 转话分"结构化事实原样传、措辞交给对话分身"；M6 转话的"可公开事实"用记忆条目号、代码查受众 | 补充 |
| D10 | 主意识每次醒来开新会话，这一批处理完就收工；连续性靠状态表、承诺、决定记录 | AXD301、Orleans〔S1、S3〕；Anthropic"每次新开会话、读进度文件"〔S5〕；结构化交接（I-PASS，二手）〔S8〕 | 压缩不够、交接件要够〔S5、S6〕；模型变强后 Anthropic 去掉了重置〔S6〕；冷启动延迟（一次 CLI 启动加注入）在主人等回复的链路上 | M8：决定记录带理由和"在等什么"、JSON 结构、会话结束前代码检查交接；默认保留几分钟再收工 | 补充 |
| D11 | 主意识醒得少，可以配更强的模型 | Anthropic 多 agent 研究系统主控用更强的模型（`papers-architecture` §2.5）；SOFAI 慢系统只在必要时调用，成本可控〔C2、C3〕；sleep-time compute 的成本逻辑 | 醒得少的前提是请示率低，要实测 | M9 统计请示率 | 保持 |
| D12 | 工作分身：每件活一个，可开子会话，用 Claude 或 Codex；进度回到发起它的对话分身 | Devin 管 Devin、Anthropic 子 agent（`papers-architecture` §2.5）；12-factor 小而专注〔S7〕 | ① 发起者可能是别人的对话，工作分身如果拿"主人能知道的"记忆就越权；② 进度只回发起的对话，主意识的状态表和早安汇报会缺这件活；③ 发起的对话可能很久没人打开；④ 目标导向对话最容易丢人设〔K2〕；⑤ 子 agent 默认不回报（Cognition 2026） | M7：工作分身的受众 = 发起对话的受众；进度同时以低优先级通知进主意识状态表（不唤醒）；要主人审核的直推主人；本体推送生命周期事件，不靠分身自觉回报 | 修改 |
| D13 | 总结分身：后台抽记忆、写日记、提成长（白天空闲、夜里） | sleep-time compute、Auto-Dreamer（`papers-architecture` §2.4）；Talker-Reasoner 的 Reasoner 持续形成信念〔C1〕 | 整理压缩时丢来源会"洗白"〔T1、`memory-benchmarks-poisoning.md` §D〕 | M12；另外让它兼做 M10 的事后审查 | 补充 |
| D14 | 四种会话全部带她的人设 | 决策 5；长对话人设褪色、需要稳定段和换新〔K2〕 | 工作分身是目标导向对话，人设褪色最快 | 工作分身也按轮数或阶段换新、每轮带简短人设提醒〔推理〕 | 保持 |
| D15 | 隐私跟着受众走（代码保证：对话分身只拿得到在场的人都能知道的记忆） | ConfAIde、PrivacyLens、MuPPET、MAGPIE、Muses-Bench〔P1–P3、P6、A7〕证明提示词和人设不够；Audience-Bound"靠排除而不是模型行为"0 泄漏〔P7〕；AirGapAgent〔P4〕；情境完整性〔P9〕 | 三条缝：主意识转话、主人对话里的"全部"、工作分身的受众 | M6、M7；主人对话里第三方私下说的事打"私下"标记，说不说由人设决定（呼应用户"说话用不用'某某说'由人设决定"），但标记由代码加〔推理〕 | 补充 |
| D16 | 权限跟着说话的人走（主人设定的关系与角色决定谁能让她做什么） | Instruction Hierarchy 按来源分级〔A1〕；六种设计模式、CaMeL、FIDES〔A3–A5〕；OpenClaw"先身份再范围最后模型"；Agents of Chaos、Muses-Bench 的反例〔A7、A8〕 | 请示链上的提权（糊涂代理）；一轮里多人消息混在一起 | M4：权限沿请示链传递；有后果的工具调用必须引用消息号，权限按该消息发送者 | 补充 |
| D17 | 怎么说话跟着人设走（语气、转述别人的话怎么说） | 隐私和权限都不靠人设后，人设只管说话方式，职责清楚；小冰强调人格一致〔I1〕 | 无直接冲突 | — | 保持 |
| D18 | 系统层面每条记忆都记来源；信多少由关系和成长决定 | 来源监控：人靠推断、易错，显式标签更可靠〔T1〕；Nous"信任上限由来源决定"〔T2〕；投毒研究"只有结构性手段有效" | 整理时丢标签；"失去比获得快"不是普遍规律〔T6、T7〕 | M12、M13 | 补充 |
| D19 | 共享状态单点写：承诺与日程、关于她和主人的事实、关系变化、同一工作区的文件，都经本体 API 写入，本体查冲突，有冲突交主意识 | Cognition 2026"写入保持单线程"；黑板"各模块只经黑板"〔B1〕；会话保证〔K1〕 | 口头答应不经 API 就绕过了单点写；有权限且无冲突的写入是否还要主意识 | M1（话语层兜底）；M2（无冲突、有权限的写入由本体直接执行） | 补充 |
| D20 | 清单一：什么活交给工作分身，由代码按清单判断 | 动作选择器模式〔A4〕；12-factor 小 agent〔S7〕；SwiftSage"卡住"条件〔C4〕 | "预计耗时较长""需要强模型"在动手前代码判断不了 | M1：分成"代码能判的"（对话分身没有改文件、跑命令的工具，要做只能派活）和"运行中触发的"（一轮工具调用超过 N 次或超时，本体提示转成工作分身）；其余由对话分身用 `dispatch` 自己决定 | 修改 |
| D21 | 清单二：什么事请示主意识（冲突、跨场合带话、定方针或改关系、花钱或撤不回、主动找人），由代码按清单判断 | Talker-Reasoner 规则、SOFAI 独立元认知、SwiftSage 代码规则、Cognition 硬性规定〔C1、C2、C4〕；Intercom 规则与指引并存〔I2〕 | 代码只能判动作、判不了话语；"主人亲口让她做的"是否还要请示；"跨场合带话"在受众隔离下其实是"放宽受众" | M1、M2、M6 | 修改 |
| D22 | 主意识的决定写进她的状态，相关会话下一轮开头收到提醒（广播） | 全局工作空间的广播（`papers-architecture` §2.2）；Letta 下个对话生效；不打断正在跑的回合 | ① 发起请示的会话等"下一轮"可能永远等不到（对方不说话就没有下一轮）；② 已经说出去的话和新决定矛盾时，广播改不了 | M3（请示回执主动唤醒发起者）；M11（已说出去的矛盾由主意识显式托人更正） | 补充 |

---

## 4. 修正建议汇总

每条写推荐、理由、依据。推理出来、没有直接依据的标〔推理〕。标★的需要用户拍板。

### M1 清单的执行点放在"动作"上，话语层面另设兜底

- **推荐**：两张清单都翻译成"工具能力 + 执行处拦截"。
  - 对话分身**没有**这些工具：改文件、跑命令、定方针、改关系、主动联系别人、放宽受众。要做只能调 `dispatch` 或 `request_global_decision`。
  - 对话分身**有**但由本体路由的工具：记承诺、改日程、花钱。本体看参数：有冲突或越权就转主意识或拒绝，没问题就执行（见 M2）。
  - 话语层面（口头答应"好啊周六见"、替主人表态、说漏别处的事）代码判断不了，用三层兜底：① 人设和会话说明里写清"答应事情要用 `commit`"；② 出站轻量检查，只查高风险类别（时间、金钱、承诺用语），命中就把这条回复转成待确认或补一次 `commit`〔推理，Sierra 的 supervisor 是类似做法〕；③ 总结分身事后审计（M10）。
- **理由**：快慢双系统里，所有"由规则决定何时叫慢系统"的例子判断的都是动作或环境信号，没有一个在判断话的含义。Intercom 也把"结构化信号走规则、意图走指引"分开。
- **依据**：SwiftSage 四条切换条件、禁止快系统做不可挽回的动作〔C4〕；Talker-Reasoner 按状态规则等待〔C1〕；SOFAI 独立元认知〔C2〕；Intercom 规则与指引〔I2〕；动作选择器模式〔A4〕；模型自报置信度偏高〔C7〕。

### M2 请示的判定分三路，主人亲口让她做的事不必经主意识 ★

- **推荐**：
  1. 发起人**没有权限**（例如群友让她花钱）→ 本体直接拒绝，或转主人确认；不进主意识。
  2. 发起人**有权限**，本体查**无冲突** → 本体直接执行，记日志，主意识状态表记一笔（不唤醒）。例如主人说"明天 9 点提醒我"、主人说"帮我跟妈妈说周六回家吃饭"。
  3. 有冲突、需要放宽受众、她自己发起（没有人类发起人）、或非主人发起且涉及花钱或撤不回的事 → 请示主意识。
- **理由**：主意识的价值在"看全局、做判断"。主人亲口的指令已经有了最高权限，如果没有冲突，主意识醒来也只能照办，白白多一次冷启动延迟，主人感受最明显。清单里的"主动去找别人"本意是"她自己主动"，不是"主人让她找"。
- **依据**：决策 12 已写"由本体查冲突，有冲突交主意识"；SOFAI 的 MC1"大多数时候直接采纳快系统"〔C2〕；Intercom"指引越宽、升级越多、解决率越低"〔I2〕；〔推理〕主人指令的判定。
- **要拍板**：主人在外部渠道让她花钱或做撤不回的事，是否也直接执行（和 M16 相关）。

### M3 请示回执主动唤醒发起它的对话分身；请示有期限

- **推荐**：主意识对某个请示做出决定后，本体给发起请示的对话分身**立即起一轮**（不等对方下一句），让它在原场合给出答复。请示带期限，到期没决定，按安全默认处理（不答应、继续稳住，或转主人），并告知对话分身。
- **理由**：overall §5.7 写的是"下一轮开头收到提醒"。如果对方说完"周六一起玩吗"就不说话了，对话分身永远没有下一轮，答复就发不出去。Read Your Writes 要求会话能看到自己写入的结果。
- **依据**：会话保证〔K1〕；Chat-Supervisor 同步等主管、垫话后必须给答复〔C6〕；〔推理〕唤醒机制。

### M4 权限沿请示链传递；有后果的动作按消息号认发起人

- **推荐**：
  - 每个请示、每条通知都带"发起人"（哪个真人，或"她自己"，或"时钟/主人的长期授权"）。主意识替某人办事时，行动管线按**发起人**的权限检查，不按主意识的权限。
  - 会话里每个有后果的工具调用（记承诺、花钱、派活、转话）必须引用它响应的消息号；权限取该消息发送者的角色。没有引用、或引用的消息不是这一轮的，按在场者里最低的权限算。
- **理由**：不传递，请示就成了提权通道（糊涂代理）。群聊防抖会把多人消息合成一轮，模型可能把群友的要求当成主人的。
- **依据**：CaMeL 的能力标签、FIDES 的信息流标签〔A3、A5〕；Agents of Chaos 的非主人顺从〔A8〕；Muses-Bench 的伪造授权〔A7〕；OpenClaw"sessionKey 只是路由，不是鉴权"；overall R2"收件人来自事件号"；`plugin-architecture` D4"权限只能映射到内核词表"。

### M5 主意识不直接吞外人原文

- **推荐**：请示包是结构化字段（类别、发起人、要决定什么、对话分身的建议答复、期限、原消息号）。主意识需要原文时按编号取，原文包在"不可信"标记里；读过外人原文的那个回合，主意识只能做发起人权限内的动作（和 M4 一起实现）。主人的原文不受此限制。
- **理由**：主意识是权限最大的会话。新结构让它不聊天，正好符合"有权限的 LLM 从不处理不可信数据"；但请示里如果夹带外人原话，又把不可信输入送了进来。
- **依据**：双 LLM 模式、"读过不可信输入后不得触发有后果的动作"〔A4〕；间接提示注入〔A2〕；SOFAI-LM"交给慢系统的上下文要看任务，失败历史可能是噪音"〔C3〕；overall §5.10 N13 已有"网页内容不直接给主意识"。

### M6 "把一个场合听到的事带到另一个场合"改成"按条目放宽受众" ★

- **推荐**：
  - 在代码保证受众的前提下，对话分身根本拿不到别处的记忆，所以这条清单实际只会以两种形式出现：对话分身请求"把某条记忆的受众放宽到某个场合"；主意识转话时用到了别处的记忆。
  - 放宽受众是**针对具体条目的显式授权事件**，写进日志，可撤销。
  - 默认只在两种情况下放宽：来源人表示过可以说（例如妈妈说"可以告诉爸爸"），或主人在关系规则里设定过（例如"家人之间的日程可以互通"）。主意识拍板时也受这条约束，不能凭判断放宽。
  - 主意识 `relay` 的"可公开事实"一栏改为**记忆条目号列表**，由代码检查每条的受众是否包含目标场合；自由文字只写意图，并限制长度〔推理〕。
- **理由**：Audience-Bound 的规则是"受众只能通过针对具体条目的显式授权放宽"。按情境完整性，信息能不能流向别处，取决于来源和情境的规范，而不是持有信息的一方怎么想。主意识是看得到全部记忆的 AI，让它凭判断放宽，等于把隐私又交回给模型。
- **依据**：Audience-Bound〔P7〕；Collaborative Memory〔P8〕；情境完整性〔P9〕；ConfAIde 第 4 层〔P1〕；MuPPET〔P3〕；overall §8.3 C5。
- **要拍板**：放宽受众的权力给谁（只看来源人许可和主人规则，还是允许主意识在某些类别上自行判断）。

### M7 工作分身的受众跟发起它的对话走 ★

- **推荐**：工作分身能拿到的记忆 = 发起它的对话的受众能知道的、和这件活相关的记忆。发起者是主人的对话，就和现在一样；发起者是别人的对话，就按那个受众过滤。进度回到发起的对话分身，同时以低优先级通知写进主意识的状态表（不唤醒）；需要主人审核的直接推给主人；生命周期事件（开始、交设计、卡住、完成）由本体推送，不靠分身自觉回报。
- **理由**：新结构下派活的入口从主意识变成了任何对话分身，旧设计"和这件活相关、主人能知道的记忆"在别人发起的活里会越权。主意识的早安、状态表需要知道手上有哪些活。
- **依据**：Audience-Bound"只有当前所有在场者都在授权受众里才能进上下文"〔P7〕；Cognition 2026"子 agent 默认不回报"；Paseo 完成通知（overall §4.6）。
- **要拍板**：别人能不能发起工作分身（取决于主人设定的角色，属于决策 12"派活"权限），以及别人发起的活是否也要给主人看。

### M8 主意识新开会话的交接件要带理由和未决事项；默认保留几分钟

- **推荐**：
  - 决定记录 = 决定 + 理由 + 依据的事件号 + 什么时候复查。
  - 状态表里加"在等谁、在等什么""还没想完的事"两栏。
  - 交接件用 JSON 结构，主意识会话结束前由代码检查必填项都写了，没写就补一轮。
  - 默认在一批处理完后保留几分钟（具体时长实测定），期间再有事件就沿用，减少冷启动；空闲后收工。
- **理由**：新开会话只能靠交接件接上推理。Anthropic 发现压缩不够、交接件必须够用；强模型可以不重置。
- **依据**：Anthropic 两篇〔S5、S6〕；AXD301"记录约 1 KB、要用时重建"〔S1〕；Orleans 闲置回收〔S3〕；I-PASS 结构化交接〔S8，二手〕；12-factor 统一状态〔S7〕。

### M9 防止主意识成为瓶颈：能确定的不进中枢，统计请示

- **推荐**：
  - 本体能确定性解决的冲突（例如新承诺和已有承诺时间重叠、发起人是主人）先由规则处理或直接问主人，不进主意识〔推理〕。
  - 记录每类请示的数量、主意识"照准原建议"的比例、处理时长。照准率长期很高的类别，提示主人考虑下放；拒绝率高的类别，提示主人考虑收紧。调整只由主人确认。
- **依据**：SOFAI 的"自我模型"和"问题从慢系统移到快系统"〔C2〕；Intercom"指引要窄"〔I2〕；黑板"控制最难"〔B3〕；中枢瓶颈的工程经验〔二手〕。

### M10 补一条"事后审查"通道，替代人类监督系统的持续监控

- **推荐**：总结分身在白天空闲和夜间整理时，扫描各对话里"没请示但命中清单语义"的地方（口头答应、提到时间和金钱、提到别处的人和事、对方的身份声明），生成通知进主意识收件箱；主意识可以托对话分身更正。另外，代码可检测的异常（同一工具反复失败、对方强烈负面情绪、身份声明和绑定不符）直接作为唤醒源。
- **理由**：监督注意系统和 Talker-Reasoner 的慢系统都持续在线，能自己发现"该介入了"；灵鲸的主意识睡着。清单拦截只管动作，话语层的漏网之鱼要有人事后看。
- **依据**：SAS 的"纠错、新情况"〔C9〕；Talker 的草率判断〔C1〕；心智社会的 B 脑〔B3〕；Sierra 的 monitor〔I3，二手〕；MAST"验证不足"约占 23.5%（`papers-architecture` §2.5）。

### M11 广播之外的一致性补丁

- **推荐**：
  - 发起请示的会话"读到自己的写"（M3）。
  - 一个对话分身已经说出去的话和新决定矛盾时（例如答应了周六、主意识决定周六陪主人），主意识显式用 `relay` 托那个对话分身更正，不指望广播。
  - 广播内容按会话受众过滤（overall §5.4 已有）。
- **依据**：会话保证〔K1〕；加航案例〔K3，二手〕；Cognition"动作带着隐含决定"。

### M12 总结分身的派生记忆保留来源链和受众交集

- **推荐**：总结分身交出的每条派生记忆必须列出来源事件号；受众取来源受众的交集；代码校验来源存在、受众合法；合并时按"来源家族"去重，不按出现次数强化同一来源；保留说话人类型（不把对话压平成带"用户："的纯文本再摘要）。
- **依据**：来源监控与睡眠者效应〔T1〕；Audience-Bound 派生规则〔P7〕；Ground Truth First〔T4〕；Compaction Laundering、Memory Echo（`memory-benchmarks-poisoning.md` §D）。

### M13 信任更新的三条规则

- **推荐**：涨跌速率分开配（成长速率里已有）；负面事件区分"没做到"和"骗了我"，后者恢复更慢；信任只影响"信多少"，永不影响权限。
- **依据**：Slovic、Poortinga & Pidgeon、White & Eiser〔T5–T7〕；Schweitzer〔T8，二手〕；Nous 信任上限由来源决定〔T2〕；Muses-Bench 伪造授权〔A7〕。

### M14 "最近在别处聊了什么"的生成方式

- **推荐**：由代码在会话创建时从日志和已有摘要生成，每条带时间和对话指针，限长；另给一个按受众过滤的检索工具补细节；只给受众相同的对话注入（主人独处的对话之间可以互相回顾，有别人在场的对话不注入主人独处时的内容）。
- **依据**：ChatGPT"参考聊天历史不保留每个细节"、Claude 项目内搜索〔P10〕；Anthropic 即时加载；Audience-Bound〔P7〕。

### M15 主意识转话分两栏

- **推荐**：结构化事实（是否答应、时间、地点、金额）原样传，对话分身不得改；措辞交给对话分身按人设在目标场合生成；需要转达主人原话时用"原样转达"。
- **依据**：LangChain"主管转述引入错误，原样转发工具约提升 50%"（`cli-multi-agent-practice.md` [10]）；Talker 原样复述 Reasoner、Chat-Supervisor"read verbatim"〔C1、C6〕；overall R3"正文在目标场合生成"。

### M16 主人在外部渠道的身份分级 ★〔推理〕

- **推荐**：主人在 QQ、微信上的消息照常是主人权限（决策 12）；但"花钱且撤不回"这一小类动作，要求主控台确认或设单次限额。
- **理由**：外部渠道的身份只靠账号绑定，账号被盗就等于主人。Agents of Chaos 观察到身份冒充。
- **依据**：eliza v2 的 `owner_bound`（`companion-architectures` §5.2 Q2）；Agents of Chaos〔A8〕。
- **冲突**：和 product.md"兜底靠可撤销，不靠审批"、用户当初否掉的"删除和花钱事前问你"可能冲突（overall §17 已有同类讨论 N11），所以只作为选项，由用户拍板。

---

## 5. 坑与反例；待实测、待核实

### 5.1 坑与反例

1. **Talker-Reasoner 没有定量实验。** 它是最贴近灵鲸的架构论文，但只有一个睡眠教练的定性案例。引用它时只能说"架构上同构"，不能说"被证明有效"。快慢分工的定量证据来自 SOFAI-LM、SwiftSage，场景是解题和文字游戏，不是陪伴聊天。
2. **"代码按清单判断"容易被理解成"代码判断一句话该不该请示"。** 文献里没有这种做法能可靠工作的证据；能可靠工作的是在动作上拦截（M1）。
3. **主意识冷启动延迟落在主人等回复的链路上。** 主人的请求一旦需要主意识（冲突、跨受众），要等一次 CLI 冷启动加注入。Chat-Supervisor 同步等约 2 秒就已经要用垫话掩盖。M2、M8 是缓解办法，具体延迟要实测。
4. **广播只到"下一轮"。** 没有下一轮的会话收不到；已经说出去的话改不了（M3、M11）。
5. **主人对话里的"全部记忆"。** 家人私下告诉她的事会进主人对话的上下文，这是产品选择（主人能查看全部记忆），但按情境完整性是一次信息流动。overall C6 已列，本文建议至少由代码加"私下"标记（D15）。
6. **便宜模型在多人场景泄露最多。** MuPPET 的小开源模型多人场景泄露 57%–70%；DeepSeek V4.1 Flash 没被测过，但不能指望它更好〔推理〕。
7. **工作分身的目标导向对话最容易丢人设**（K2）。
8. **"失去信任比获得快"不是普遍规律**（T6、T7），别写死。
9. **XiaoIce 按平台设计不同人设**，和灵鲸"一个她"相反。灵鲸的取舍是对的（用户明确要求），但意味着"同一人设在 QQ 群和主控台里说话方式不同"要靠人设本身写清楚。
10. **没有产品把"不聊天的中枢"做成独立的被唤醒角色。** 唤醒、交接、期限这些细节没有现成可抄的实现。

### 5.2 待实测

1. **请示率与照准率。** 用真实聊天记录回放，统计按新清单（M1、M2 改写后）每天会请示多少次、主意识照准原建议的比例。决定主意识是否"醒得少"。
2. **主意识冷启动延迟。** Claude Code 和 Codex 各自开新会话、注入人设和状态表、跑完一次决定的耗时；和"保留几分钟"的对比。
3. **话语层漏网率。** 在决策 6 的约 20 个场景里加题：对方约时间、对方问主人的事、对方伪造授权；看 DeepSeek V4.1 Flash 的对话分身有多少次"没调 `commit` 就口头答应""没请示就表态"，以及出站检查和事后审计各能抓住多少。
4. **多人隐私。** 参照 MuPPET 和 ConfAIde 第 4 层的设计，构造灵鲸自己的群聊场景，验证"代码过滤后上下文里没有越权条目"，并测转话通道（M6 的条目号方案）。
5. **请示回执唤醒（M3）在 CLI 上的表现**：本体主动起一轮时，对话分身能否自然地接上"刚才我问问的事有结果了"。
6. **跨会话的提示缓存。** 主意识每次新开会话，人设前缀能否命中服务商的前缀缓存（DeepSeek 和 Claude 的缓存是否跨会话、经 CLI 是否可控）。
7. **交接件够不够（M8）。** 让主意识在多批之间处理一件跨天的事（例如"等妈妈回话、周五前定下来"），看新开会话后是否接得上。

### 5.3 待核实

1. Norman & Shallice 原文的五类情况措辞（本文依据多个二手来源一致转述）。
2. Baddeley 1996 的具体拆分（本文只引用了"把中央执行拆成具体能力、不等同于 SAS"）。
3. 经典黑板架构（Nii、Corkill、Hearsay-II、BB1）的原文细节，尤其 BB1"把控制本身做成黑板问题"的说法，本文没有采用。
4. "糊涂代理"的原始出处（Hardy 1988）。
5. 加航案判决书原文措辞。
6. Schweitzer 等"欺骗造成的信任损伤不能完全恢复"是否是论文原结论（目前来自沃顿商学院的转述）。
7. Sierra supervisor 的实际效果（只有厂商自述）。
8. Character.AI 每个对话记忆隔离的官方说明。
9. ChatGPT"仅项目内记忆"的隔离是否彻底（有用户报告不彻底）。
10. Agents of Chaos 后 5 个案例（HTML 版本被截断，身份冒充等细节没读到）。
