# 同行先例撑起第二层，但要改三处

灵鲸第二层的骨架是：每个人设一个常驻前台会话，只聊天、做小判断、派活、统一回复；重活和深想派出去，结果作为消息回来，再由她用自己的口吻说。这个骨架在论文和开源产品里都有成熟先例。Claude Code 隐藏的 coordinator 模式、DeepSeek Super-agent 的 router、Hermes Agent 的后台委派，以及论文里的 Springdrift 和 Talker-Reasoner，几乎逐条对得上。**R1（代码先判）、R2（没工具就只能派）、R4（不挡对话）、R6（执行者由代码给候选）都有多家一手证据**，可以放心保留。

证据明确反对的只有一处：**V2 把妈妈的私聊和群也放进同一个总会话**。全网只有 OpenClaw 的 `dmScope: main` 这么做，它自己声明只适合一个使用者，而且已经把新装默认改成按人隔离。主流做法是"身份和记忆按人设共享，聊天记录按地方分开，主会话旁观各处的合并通知"，也就是四层稿 §2.6 现在写的"回退方案"，它应该升为 V2 的默认。

证据不支持、但也推不倒的是 **R5**。所有编排框架都把"综合和拍板"留在编排者手里，灵鲸却把权衡派给了想事活。不过快慢双系统的论文说明，"让慢的一方去想"可以成立，前提是它看得到整段对话。所以 R5 该改的是想事活拿到什么：给它整段原文，而不是一份交接摘要；同时把"替主人出主意"和"她自己定立场"分开。

最薄弱的一环是总会话"当场答还是想一想"的临场判断：**前沿模型要自己判断何时该求助时，通过率只剩 4–24%**，便宜模型只会更差，需要补代码信号和事后测量。另有一处事实要更正：Super-agent 的 router 并非没有 shell，它装了 5 秒超时的沙箱 bash 和后台任务，只关了写文件和改文件。

所有证据都来自编码、研究、游戏、客服这些场景。没有一篇测过"一个人设、多渠道、长期常驻、便宜前台加强后台"的整体体验，路线图 M4 的评测仍是唯一能下定论的地方。

读法：〔一手〕是调研者自己读过的论文正文、源码或官方文档原文；〔二手〕是博客、新闻、他人转述或搜索摘要；〔推理〕是推出来的结论。"四层稿"指 `docs/liwa/architecture/four-layers.md` 草稿，"R1–R6"指它 §2.3 的六条派活规则。

## 四类同行里，最像灵鲸的是"只说话、不动手"的常驻前台

调研覆盖四类东西：快慢双系统和"前台 / 后台"架构的论文；多 agent 编排框架；编码和通用 agent 产品里写死的派活规则；常驻人格、陪伴类的开源项目与产品。

按"主角色手里有没有改世界的工具"一刀切开，产品分成两派。**A 派是"全工具主 agent + 可选派活"**，包括 Claude Code 默认模式、Codex、Gemini CLI、Cline、OpenCode、OpenHands、Goose、Cursor、Amp、Hermes。主角色自己什么都能干，派活只是为了保持上下文干净和并行，所以规则都写成"什么时候别派"。**B 派是"拿掉改世界工具的协调者"**，包括 Roo 的 Orchestrator、Kilo 的 orchestrator、Claude Code 的 coordinator 模式、Super-agent 的 router、Devin 的 manager，靠收走工具逼它派。

灵鲸属于 B 派，而且是其中"常驻、异步、随时能插话"的一支。这一支在产品里只有 **Claude Code coordinator 和 Super-agent router 两家**。同属 B 派的 Roo 不一样：子任务运行时父任务被关掉，用户只能和子任务说话〔一手〕（[Roo-Code](https://github.com/RooCodeInc/Roo-Code) `NewTaskTool.ts`）。

下表挑出和灵鲸第二层最像的十几个系统，写清像在哪、差在哪。

| 系统 | 是什么 | 像灵鲸第二层的地方 | 关键差别 | 来源 |
| --- | --- | --- | --- | --- |
| Claude Code coordinator 模式 | 编码 CLI 里一个用环境变量开启的隐藏模式 | 主 agent 只派活、综合、和用户说话；Bash 只能跑只读命令；派完一句话告诉用户就结束回合；worker 结果作为"内部信号"回来 | 主控是强模型，综合和判断都自己做 | 〔一手〕[npm 包 2.1.303 二进制内的提示词](https://www.npmjs.com/package/@anthropic-ai/claude-code) |
| DeepSeek Super-agent router | 研究原型，给一个 GitHub 仓库当主动编码 agent | 常驻主会话，负责评估、派工、统一回复；结果自己作为消息到达，"绝不等待" | 装了 5 秒沙箱 bash 和后台任务；被明令不许替 worker 想 | 〔一手〕[原型仓库](https://github.com/deepseek-ai/dsh-superagent-prototype) |
| Hermes Agent | 开源个人 agent，接多个消息平台 | 顶层委派总在后台，结果"只在回合之间"回来；子 agent 不能问人、写记忆、发消息、排期 | 主 agent 有全部工具；子 agent 刻意不带人设 | 〔一手〕[delegation.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/delegation.md) |
| OpenClaw 主会话 | 开源个人 agent | 所有私聊进一个滚动会话（"只有一个大脑"）；群各自一个会话，主会话旁观合并通知 | 官方声明只适合单一使用者；新装默认已改成按人隔离 | 〔一手〕[main-session](https://docs.openclaw.ai/concepts/main-session.md) |
| 麦麦 MaiBot | 开源 QQ 机器人 | 子代理看不到聊天、不能发言，结论作为新消息叫醒 Planner；Focus 模式让一个 Planner 看多个聊天 | Focus 是实验功能、默认关；隐私靠提示词 | 〔一手〕[subagent.py](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/src/maisaka/builtin_tool/subagent.py) |
| Springdrift | 2026 年论文，单人常驻助手 | 常驻"认知循环"跨终端、网页、邮件；子 agent 不能找人，只能经返回值汇报；每轮注入一份结构化自我状态 | 遇到复杂输入时前台自己换强模型；只有单人 23 天的部署观察 | 〔一手〕[arXiv 2604.04660](https://arxiv.org/abs/2604.04660) |
| Talker-Reasoner | DeepMind 2024 年论文 | 快的一方只负责说话，慢的一方负责推理、规划、调工具，两者经共享记忆相连 | 慢的一方读得到整段对话；没有任何定量结果 | 〔一手〕[arXiv 2410.08328](https://arxiv.org/abs/2410.08328) |
| PARE | 2026 年论文，主动助手 | 观察方只有只读工具和"继续等 / 向用户提议"两个动作；执行方不对用户说话 | 观察和执行用同一个模型，没测"小模型观察 + 大模型执行" | 〔一手〕[arXiv 2604.00842](https://arxiv.org/abs/2604.00842) |
| PIANO（Project Sid） | Altera 2024 年技术报告 | 唯一的"认知控制器"拍板，决定广播出去约束说话 | 控制器用 GPT-4o，作者说只有最新的强模型跑得起来 | 〔一手〕[arXiv 2411.00114](https://arxiv.org/abs/2411.00114) |
| Magentic-One | 微软 2024 年论文与框架 | 编排者不碰环境，只记账本、选下一个干活的、卡住时重规划、写最终答案 | 编排者是强模型，做任务不做对话 | 〔一手〕[arXiv 2411.04468](https://arxiv.org/html/2411.04468) |
| Anthropic 研究系统 | 产品，提示词开源 | 主 agent 不做一手调研，信息收集全派出去 | 最终报告必须自己写，拍板留在手里 | 〔一手〕[lead 提示词](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/prompts/research_lead_agent.md) |
| Amp Oracle | 编码产品 | 日常用快模型；难题当工具交给只读、"从不改文件"的强顾问 | 作为工具调用，调用方要等它返回〔推理〕 | 〔一手〕[Amp 文档](https://ampcode.com/docs/models-and-subagents) |
| Roo / Kilo orchestrator | 开源编码插件 | 编排模式没有读写工具，只能派 | Roo 派出去后父任务被关；Kilo 已弃用 | 〔一手〕[Roo-Code](https://github.com/RooCodeInc/Roo-Code)、[kilocode](https://github.com/Kilo-Org/kilocode) |
| Letta、AstrBot、AIRI、Kindroid | 开源框架与陪伴产品 | 一个人设、多段对话，身份和记忆共享 | 聊天记录按对话或地方分开 | 〔一手〕[Letta](https://docs.letta.com/concepts/conversations/index.md)、[Kindroid](https://kindroid.ai/v2/docs/groupchats/) |

表里有两条差别要先记住。

第一，**框架和产品里的编排者几乎都是最强的那个模型**，比如 Magentic-One、Anthropic 研究系统、Claude Code coordinator。灵鲸的总会话却是最便宜的那个。最像灵鲸这种"弱前台"的，反而是论文里的 Talker-Reasoner、PARE、Springdrift。这决定了后面讨论 R5 时该拿谁来比。

第二，编码工具里"无工具的编排模式"正在退场。Kilo 把 orchestrator 标为弃用，理由是"全工具的 agent 现在能自动派子 agent"〔一手〕（[kilocode](https://github.com/Kilo-Org/kilocode) `orchestrator-mode.md`）；Roo 仓库 2026-05-15 之后没有新提交〔一手〕。灵鲸要无工具总会话，理由是人设、单一口径、成本和随时接话，不是编码效率，所以这不构成反证。但要注意：连 Kilo 的 orchestrator 也保留了读文件、搜索和网页搜索，Claude Code coordinator 也保留了只读的 Bash。**B 派里完全不给"看一眼"能力的只有 Roo，而 Roo 已经停更。**

## 派不派活：管用的是收工具和外部信号，没有一家靠模型自觉

### 写在提示词里的派活倾向，两头都失灵

同样写在提示词里，各家的派活倾向方向完全相反。

| 产品 | 提示词里怎么写 | 来源 |
| --- | --- | --- |
| Codex CLI | 用户或 AGENTS.md 没明说就不派；要求"深入、彻底、调研"都不算许可 | 〔一手〕[openai/codex](https://github.com/openai/codex) `multi_agents_spec.rs` |
| Gemini CLI | 必须把任务派给专长最对口的子 agent | 〔一手〕[gemini-cli](https://github.com/google-gemini/gemini-cli) `snippets.ts` |
| Claude Code（Pro 档） | 用户不要求就不派 | 〔一手〕 |

结果两头都出问题。不肯派的一头：Super-agent 的实验里，带子 agent 工具、提示词中性的单会话 **5 次都没派活**〔二手〕（[智东西经新浪转载](https://finance.sina.com.cn/tech/csj/2026-11-01/doc-inixepty4335109.shtml)）；Kimi 用强化学习训练编排者，头号毛病叫"串行坍缩"，即编排者退回自己一个人干〔一手〕（[Kimi K2.5](https://www.kimi.com/blog/kimi-k2-5)）。该派却自己动手的一头：Claude Code agent teams 的官方排障承认"lead 有时自己动手实现，不等队员"，解法只能是用户手动提醒〔一手〕（[agent-teams 文档镜像](https://github.com/ericbuess/claude-code-docs/blob/main/docs/agent-teams.md)）。

靠得住的只有两条路：把工具收走（B 派），或者专门训练（Kimi）。灵鲸 R2 走的是第一条，**是全部规则里外部证据最硬的一条**。

收工具也不是万能的。CrewAI 是唯一在代码里硬性禁止 manager 带工具的主流框架，带了就抛异常〔一手〕（[crew.py](https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/crew.py)）。但它的层级模式恰好是社区抱怨最多的：派不出去、不管分类全派、找不到同事〔二手〕（[issue #4783](https://github.com/crewAIInc/crewAI/issues/4783)）。可见收工具只保证"不自己动手"，不保证"派得对"。派给谁、交接包写得清不清，还得代码兜着，这正是 R6 和交接包规则的位置。

### 管用的升级信号都来自模型之外

让便宜模型自己判断"这事重不重"，是证据最差的一环，四条证据指向同一个方向。

| 研究 | 发现 | 来源 |
| --- | --- | --- |
| HiL-Bench | 给前沿模型一个"问人"工具（GPT 5.4、Claude Opus 4.6、Gemini 3.1 Pro 等）。信息给全时它们能做对 75–89%，**要自己判断什么时候该问时只剩 4–24%**，没有一个模型落在"判断良好"的区间 | 〔一手〕[arXiv 2604.09408](https://arxiv.org/abs/2604.09408) |
| 2026 年快决策模型评测 | 两个现成模型做零样本路由，**都不比瞎猜好**：一个 99.5% 的时候都答"用便宜的"，另一个选项顺序一换就改掉 30.3% 的答案 | 〔一手〕[arXiv 2610.02267](https://arxiv.org/abs/2610.02267) |
| 推理中途主动升级的形式化研究 | **校准比更聪明的路由器更重要**；"自信地错"是主要失败 | 〔一手〕[arXiv 2608.24087](https://arxiv.org/abs/2608.24087) |
| Cognition 实战 | 自家 SWE 1.5 当不好"聪明朋友"架构的主模型，输在不知道何时该升级 | 〔一手〕[Cognition 2026-04](https://cognition.com/blog/multi-agents-working) |

跑出好结果的快慢双系统，切换判据几乎都是外部看得见的信号。SwiftSage 只在四种情况下叫醒慢系统：连续 5 步没进展、快系统给的动作不合法、碰到关键决定、观察到异常〔一手〕（[arXiv 2305.17390](https://arxiv.org/abs/2305.17390)）。Talker-Reasoner 决定"等不等"时，读的是慢系统写进记忆的一个阶段字段（进入"出计划"阶段才等），不是让快系统自己判难度〔一手〕。DPT-Agent 的代码按定时器和"收到人类消息"触发〔一手〕（[DPT-Agent 仓库](https://github.com/sjtu-marl/DPT-Agent)）。

对灵鲸来说，好消息是 R2、R5 已经把大部分升级做成了结构：没有工具就只能派。坏消息是四层稿 §2.3 末段剩下的那条"当场答还是想一想"，恰好是 Talker-Reasoner 作者自己承认没解决的部分〔一手〕。他们还记下了判错时的样子：快的一方"有时会回答一个比所问更简单的问题"〔一手〕。放到灵鲸身上，就是主人问"帮我想想下周怎么安排"，总会话随口给一份泛泛的安排，而不是去想。

各家写死在提示词里的分界，有几条可以直接借：

| 来源 | 自己做 | 派出去 | 灵鲸能借的说法 |
| --- | --- | --- | --- |
| Gemini CLI〔一手〕（[gemini-cli](https://github.com/google-gemini/gemini-cli)） | 简单读取、单文件改动、1–2 轮能答的"外科式"问题 | 超过 3 个文件或重复步骤、大量输出、要反复试错的调研 | "一句话能答"写成"1–2 轮能答完" |
| Codex CLI〔一手〕（[openai/codex](https://github.com/openai/codex)） | 关键路径上会挡住下一步的、耦合紧的、难交代清楚的 | 能和手头的活并行的旁支 | 先问"主人此刻在等什么" |
| Anthropic 研究系统〔一手〕（[lead 提示词](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/prompts/research_lead_agent.md)） | 简单计算、格式整理、小搜索 | 所有实质的信息收集；按复杂度派 1 / 2–3 / 3–5 / 5–10 个子 agent | 带数字、带例子的分档 |
| Hermes〔一手〕（[hermes-agent](https://github.com/NousResearch/hermes-agent) `tools/delegate_tool.py`） | 单个工具调用、不需要推理的机械多步 | 推理重的、会淹没上下文的、独立并行的 | "该用 / 别用"两张清单 |
| Claude Code coordinator〔一手〕 | 不用工具就能答的直接答 | 调研、实现、验证；但别拿 worker 读文件、跑命令 | "别为一句话能答的事派活" |
| Manus〔一手〕（[官方博客](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)）〔二手〕（[泄露提示词](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools)） | 新消息先回复，首条只确认收到 | 其余动作 | 就是灵鲸的垫话"我想想，等我一下" |

落到灵鲸，Codex 的"关键路径"最好迁移〔推理〕。主人问了个问题，他在关键路径上等的是"有回应"，不一定是"有答案"。一句话能答、不用翻账本、不涉及她立场的，当场答；否则关键路径上只需要一句垫话，"想"作为旁支派出去。

再学 Talker-Reasoner 的阶段字段〔推理〕：由代码在起回合前给主人的消息打意图标签，比如含"想想 / 安排 / 该不该 / 怎么看"、涉及她的立场或关系、引用了账本里没结的议题、要跨三处以上账本。命中就在每轮前缀写一句"这件事建议 ponder"。模型仍可以不听，但判断从"自己意识到"变成了"被提醒后决定"。

判错是免不了的，所以要测而不是假设〔推理〕。记两个数：当场答后两轮内被主人追问或纠正的比例（代表"抢答了简单版"），和 ponder 的结论与当场答案差不多的比例（代表"派多了"）。

R6 也有直接的实测支持。DecisionBench 测了编排者"派给谁"〔一手〕（[arXiv 2605.19099](https://arxiv.org/html/2605.19099)）：盲选时派对人的准确率是 14.2%；把同事介绍预先写进系统提示，反而只有 7.5–20.8%；**改成按需调工具查同事档案，升到 29.5%**，委派次数还减半，质量不变。同一份数据显示编排者偏爱同厂商的执行者，**DeepSeek-V4-Flash 的偏好是 1.53 倍**。

总会话正好用 DeepSeek，R6 让代码给执行者候选，绕开了这个偏好。"按需查档案"更准，则说明候选应带可查询的档案，而不是把所有执行者介绍都塞进稳定前缀〔推理〕。另外，AutoGen 的 `candidate_func`、Google ADK 用枚举限定可转交对象"防止模型编造不存在的 agent 名"、OpenAI 推荐的"结构化分类后由代码选 agent"〔一手〕（[AutoGen](https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_selector_group_chat.py)、[adk-python](https://github.com/google/adk-python)、[OpenAI Agents SDK](https://openai.github.io/openai-agents-python/multi_agent/)），都是"代码给候选、模型挑"。业界把它当标准做法，R1、R6 不是灵鲸独有的保守设计。

### 编排者都自己拍板，灵鲸把拍板派了出去

这是证据和四层稿冲突最大的地方。**没有一个编排框架把"综合和拍板"从编排者手里拿走。**

| 系统 | 原话或做法 | 来源 |
| --- | --- | --- |
| Anthropic 研究系统 | 主 agent 提示词："绝不要开子 agent 来写最终报告，最终报告你自己写"；"你的主要职责是协调、指导、综合" | 〔一手〕[lead 提示词](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/prompts/research_lead_agent.md) |
| Claude Code | Agent 工具说明："Never delegate understanding"（不要把理解推给子 agent，不要写"根据你的发现去修"）；coordinator 模式："综合是你最重要的职责" | 〔一手〕 |
| Magentic-One | 编排者自己重规划，自己读完整对话写最终答案 | 〔一手〕 |
| TaskWeaver | Planner"先用自己的本事，再考虑派给 Worker" | 〔一手〕[planner_prompt.yaml](https://github.com/microsoft/TaskWeaver/blob/main/taskweaver/planner/planner_prompt.yaml) |
| Cognition | "写入保持单线程，其他 agent 只贡献智力、不贡献动作" | 〔一手〕[Cognition 2026-04](https://cognition.com/blog/multi-agents-working) |

灵鲸的 R5 正好相反：影响她长期自我、方针、心愿、关系、受众、钱的决定，只能在想事活里做，总会话手里只有 `ponder(议题)`。

冲突的根子在于：那些框架的编排者**同时握着完整上下文和最强的脑子**；灵鲸的总会话握着完整上下文，脑子却最弱。把思考拆出去是有代价的，而且有实测：

| 证据 | 发现 | 来源 |
| --- | --- | --- |
| Anthropic 2026 年指南 | 把"同一件事的前后几个阶段"列为坏的拆分边界 | 〔一手〕[claude.com 博客](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them) |
| Google 等对 260 种配置的研究 | 在顺序依赖强的 PlanCraft 上，中心化多 agent **掉 50.3%**，独立式掉 70.0%，所有变体都退化 | 〔一手〕[arXiv 2512.08296](https://arxiv.org/html/2512.08296) |
| Stanford 的 Tran 与 Kiela | 思考 token 对齐后，单 agent 在多跳推理上不输多 agent | 〔一手〕[arXiv 2604.02460](https://arxiv.org/abs/2604.02460) |
| LangChain | 主管模式主要输在"转述"，允许原样转发等三项改进后提升近 50% | 〔一手〕[LangChain 基准](https://www.langchain.com/blog/benchmarking-multi-agent-architectures) |
| Cognition | "agent 以为自己和子 agent 共享状态，其实没有" | 〔一手〕 |

"帮我想想"恰好是同一段对话的下一步思考，按这些证据属于不该拆的那一类。

但另一组证据站在 R5 这边。快慢双系统的论文都让慢的一方去想：Talker-Reasoner 里由 Reasoner 负责规划和形成"信念"，到了出计划阶段，Talker 直接照念 Reasoner 的方案〔一手〕；SwiftSage 遇到"关键决定"就交给慢系统〔一手〕；DPT-Agent 的慢系统产出行为准则，直接改写快系统的规则〔一手〕（[arXiv 2502.11882](https://arxiv.org/abs/2502.11882)）。

"弱编排者不该替别人想"也有产品印证。Super-agent 的 router 被明令"绝不加实现计划""不要把 worker 的问题转成你自己的技术决定"〔一手〕（[原型仓库](https://github.com/deepseek-ai/dsh-superagent-prototype) `prompts/orchestrator.md`、`dispatch.md`）。Cognition 发现，缺上下文的 manager"默认指示过细，适得其反"〔一手〕。Aider 把"想"和"做"拆给两个模型：o1-preview 想、便宜模型改，得分 85%；o1-preview 单干是 79.7%〔一手〕（[aider.chat](https://aider.chat/2024/09/26/architect.html)）。

两组证据其实不矛盾。仔细看双系统论文里"慢的一方去想"的例子，**慢的一方都看得到整段对话**：Talker-Reasoner 的 Reasoner 处理的就是 Talker 的对话〔一手〕；MIRROR 每轮回复后把对话历史整份复制给后台思考线程〔一手〕（[arXiv 2506.00430](https://arxiv.org/abs/2506.00430)）；DUMA 的慢脑直接接管对话〔一手〕（[arXiv 2310.18075](https://arxiv.org/abs/2310.18075)）。

Salesforce 的异步 agent 论文把派生分成两种〔一手〕（[arXiv 2410.21620](https://arxiv.org/abs/2410.21620)）：一种是"抄一份"，把父进程的整本账复制给子进程；另一种是"给一页说明"。论文说，"抄一份"只在子进程需要父进程完整视图时才用。"帮主人想事"正是需要完整视图的情形。**所以 R5 真正的问题不在"拍板不在前台"，而在"拍板的一方只拿到一份交接包"**〔推理〕。

可选的几种做法对比如下：

| 方案 | 做法 | 主人要等多久 | 信息损失 | 和 R5 的关系 | 外部先例 |
| --- | --- | --- | --- | --- | --- |
| 甲：现状 | `ponder` + 交接包（原话编号、相关聊天、相关记忆） | 先垫话，几十秒到几分钟后回来 | 交接包写漏的就丢了 | 就是 R5 | Super-agent 派工；Hermes"子 agent 对本对话一无所知"〔一手〕 |
| 乙：想事活"抄一份" | 想事活开起来时，由代码给它她的稳定前缀 + 最近 N 轮原文 + 召回；总会话只报议题，不写摘要 | 同甲 | 小 | 完全兼容，决定类工具仍只在想事活里 | "抄一份"式派生〔一手〕；Talker-Reasoner、MIRROR〔一手〕 |
| 丙：同步"顾问"调用 | 总会话把完整上下文交给强模型，只要建议，顾问不持工具 | 要等强模型想完，超出 2 秒回复线 | 小 | 建议不是决定，"她的立场"类仍要走想事活 | Amp Oracle"只给意见、从不改文件"〔一手〕；Cognition"两边都强时聪明朋友才管用"〔一手〕 |
| 丁：本回合换强模型 | 前台遇到复杂输入，这一回合临时换成强模型 | 这一回合变慢 | 无 | 等于把拍板搬回前台 | Springdrift 按"简单 / 复杂"分流到快慢两档模型〔一手〕 |

建议〔推理〕：默认采用乙，并把 R5 拆成两类。

**第一类是"她自己的长期立场"**，包括自我、方针、心愿、关系、放宽受众、花钱。这一类继续只在想事活里定，并留决策点记录。理由是审计和风险，不是"多 agent 更好"，四层稿应如实标为"没有外部先例的结构选择，待 M4 验证"。Cognition 担心的"多处同时写入互相打架"，靠"同一议题只开一个想事活、账本写入由代码排队"来挡。

**第二类是"替主人出主意"**，比如"帮我想想下周怎么安排""这工作该不该接"。这是建议，不是她的决定。走乙式 `ponder`，但不给决定类工具，只产出建议加事实栏。

丙不适合当默认：同步调用会挡住 2 秒回复线、违反 R4；如果改成先垫话再异步调用，那就等于乙。丁留作备选：若 M4 显示 `ponder` 往返太慢，再评估。底座会话能不能一回合一换模型，还没查。

DPT-Agent 的做法也值得写进去：想事活的决定以账本为准，由代码在每轮前缀的 [新决定] 里呈现；followup 只是让她把结论"说出来"〔推理〕。

另外，四层稿里有一处自相矛盾要先统一：§0 和 §2.11 第 3 行把"帮我想想下周怎么安排"交给 `ponder`，§2.2 的表却把它放在"③ 派只读干活"。

## 派出去以后：交代一句就收工，结果当"内部消息"回来

各家的异步设计收敛到同一个形状：子任务默认在后台跑；派完给用户一句话，就结束本回合；结果在回合之间，以一条带来源标记的消息回来；主角色被明确告知"这不是用户在说话，不要等、不要轮询、不要编造"。

| 系统 | 原话或做法 | 来源 |
| --- | --- | --- |
| Hermes | "后台结果只在你的回合之间送达：先做完不依赖它们的事，给一句状态，结束回合；绝不等待或轮询" | 〔一手〕[delegation.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/delegation.md) |
| Super-agent router | "worker 报告、后台任务结束都会自己作为消息到达；绝不用 sleep、轮询或等待任务的方式去等；没事可做就结束回合" | 〔一手〕[原型仓库](https://github.com/deepseek-ai/dsh-superagent-prototype) `prompts/orchestrator.md` |
| Claude Code coordinator | "派完简短告诉用户派了什么，就结束本回合"；worker 结果是"内部信号，不是对话对象，不要道谢、不要回应" | 〔一手〕 |
| Devin | coordinator 睡着也会被子任务完成自动叫醒，"所以不轮询" | 〔一手〕[Devin 文档](https://docs.devin.ai/work-with-devin/advanced-capabilities) |
| Codex | 等待工具一遇到用户插话就提前返回 | 〔一手〕 |

反面也有记录。Anthropic 承认，它的研究系统里主 agent 同步等子 agent，"整个系统可能被一个子 agent 卡住"〔一手〕（[Anthropic 2025](https://www.anthropic.com/engineering/multi-agent-research-system)）。Cursor 把"任务完成时叫醒 planner"列为还没做好的事〔一手〕（[cursor.com](https://cursor.com/blog/scaling-agents)）。

前台跑的命令也不许挡路：

| 系统 | 做法 | 来源 |
| --- | --- | --- |
| Claude Code | 把跑着的 Bash 命令挪到后台，提示文案就是"为了让运行期间到达的消息能送到你" | 〔一手〕 |
| Super-agent 执行器 | 前台命令超过 5 秒转后台 | 〔一手〕 |
| Hermes | 忙时来消息默认"打断"，正在跑的终端命令转后台而不是被杀 | 〔一手〕[messaging 文档](https://hermes-agent.nousresearch.com/docs/user-guide/messaging) |
| Manus | "用户有新输入时必须立刻回复，而不是去执行动作" | 〔一手〕[Manus 博客](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) |

这样做的延迟代价不大。MIRROR 把思考放到回复之后的后台线程，400 个回合平均 **2.52 秒、75% 在 3 秒内**，只有 0.8% 的回合碰上后台线程还在跑〔一手〕（[arXiv 2506.00430](https://arxiv.org/abs/2506.00430)）。

四层稿的 R4 与这一形状完全一致：总会话没有 wait 工具，结果以事件 followup 回来，低显著事件用 inject、不叫醒。**这是证据最充分的一条。**

异步也有一组反复出现的失败。下表列出论文和产品记录下的典型错误，以及灵鲸对应的挡法；标"已有"的是四层稿已经覆盖的。

| 失败 | 例子 | 来源 | 灵鲸怎么挡 |
| --- | --- | --- | --- |
| 结果没回来就先假设结果 | 模型没等查询返回，就认定某公司股票代码是"ATGL" | 〔一手〕[AsyncTool](https://arxiv.org/abs/2605.27995)；Claude Code："派出去就什么都不知道，用户问起只报状态，不猜"〔一手〕 | "做完了 / 改好了 / 我想好了"只在对应事件到了才能说；outbox 按活号查状态，不在待验收或完成态就要求改写 |
| 新来的事挤掉早先的事 | 小模型手上同时有几件事时，倾向先做最近给的那件 | 〔一手〕[AsyncTool](https://arxiv.org/abs/2605.27995) | 合批排序"主人在等的 > 冲突与应对 > 其余"（已有） |
| 忘了手上还有事 | 进行中的任务被遗忘；去掉每轮自我状态后，恢复会话时不提之前的工作 | 〔一手〕AsyncTool、[Springdrift](https://arxiv.org/abs/2604.04660) | 每轮前缀的 [正在做] 一轮都不能少 |
| 主人改口后按旧想法继续 | 中途追加要求，最好的 Opus 也只做对 50–55%，DeepSeek 30% | 〔一手〕[InterruptBench](https://arxiv.org/abs/2604.00892)；"只有当前版本有权发布输出"〔一手〕[Retire](https://arxiv.org/abs/2610.01160) | 主人对同一议题的新话送进想事活；结论带"读到的最后消息号"，之后又有新话就不照念（四层稿 §6 第 5 条，应升为规则） |
| 结论没到就先开口给内容 | 前台抢在后台结论之前开口，MT-Bench 得 6.43 分；等结论的级联系统 7.70 分；还会中途改口 | 〔一手〕[KAME](https://arxiv.org/abs/2510.02327) | `ponder` 的"建议答复"只许"我在想"类垫话，不许给初步看法 |
| 嘴上答应、手上没做 | 聊天模块答"好的"，动作模块却去干别的 | 〔一手〕[PIANO](https://arxiv.org/abs/2411.00114) | 同一回合的"好，我开始改"和 `dispatch` 绑在一起：派活被代码拒绝时，outbox 拦下或改写那句话 |
| 转述走样 | 快脑吸收慢脑结果时编造事实 | 〔一手〕[DUMA](https://arxiv.org/abs/2310.18075)；原样转发提升近 50%〔一手〕[LangChain](https://www.langchain.com/blog/benchmarking-multi-agent-architectures) | 事实栏里的数字、日期、人名、链接原样出现，outbox 校验一致 |
| 把自述当事实 | 子 agent 的总结写的是"打算做什么"，不一定是"做了什么" | Hermes"总结是自述，不是核实过的事实"、Claude Code"信任但要核验"〔一手〕；eliza 把未核验的转述标为"待验证"〔一手〕 | tasks 核验放在待验收之前（已有）；核验没过的转述必须带"还没确认" |

还有两处可以补。

其一，**沉默要变成一个显式动作。** Claude Code coordinator 的一个变体要求"每回合必须以 reply、react 或显式 no-reply 结束"〔一手〕；OpenClaw 允许子任务完成后的回合以 `NO_REPLY` 安静收场、不重试〔一手〕（[announce.md](https://docs.openclaw.ai/tools/subagents/announce.md)）；Hermes 有 `allow_silence`〔一手〕。给总会话加一个 `no_reply(理由)`，规定主人发起的回合必须以 reply、say、dispatch、ponder、no_reply 之一结束，沉默就成了可记录、可审计的决定〔推理〕。

其二，**"收到了"由真正干活的一方来说。** Super-agent 让 worker 动手前先调 `orchestrator_ack`，router 只负责送结果〔一手〕（`prompts/replies.md`）。灵鲸可以让手开工时回一句"我理解要做的是 X"，主人能马上发现误解〔推理〕。

Salesforce 论文的打断规则也和四层稿 §2.5 一致：正在生成的可以打断，已经说出口的不打断〔一手〕。

## 一个会话管多个地方：唯一的先例只服务一个人，而且已经退回去了

真正做到"一个角色一个会话吃下所有私聊"的，只有 OpenClaw 的 `dmScope: main`。它的文档写得很坦白："OpenClaw 首先是个人 agent。开箱即用时，每条私聊都进同一个滚动会话……只有一个大脑"〔一手〕（[main-session](https://docs.openclaw.ai/concepts/main-session.md)）。

这个开关的时间线说明它是出了问题才补的：

| 时间 | 变化 | 来源 |
| --- | --- | --- |
| 2026.1.15 | 才加入 `dmScope`，用途是"多用户私聊隔离与审计警告" | 〔一手〕[CHANGELOG 2026.1.15](https://raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG/2026.1.15.md) |
| 2026.2.22 | 命令行引导**把新装默认改成按"渠道 + 发送者"隔离**，标为破坏性变更 | 〔一手〕[CHANGELOG 2026.2.22](https://raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG/2026.2.22.md) |

它的安全审计在多个私聊发送者共享主会话时会报警，并说明这只是"合作式共享收件箱的加固，不是互不信任者之间的隔离"；把群并进主会话会触发另一条审计，提示"留给可信的房间"〔一手〕（[security.md](https://docs.openclaw.ai/cli/security.md)）。

其余系统都是"身份和记忆按人设共享，聊天记录按地方分开"：

| 系统 | 私聊 | 群 | 长期记忆 | 值得注意 |
| --- | --- | --- | --- | --- |
| OpenClaw | 个人安装默认一个主会话；新装引导默认按人隔离 | 每群一个会话；主会话以合并通知旁观，"不会每条消息叫醒一次" | 跨对话召回只在私聊之间，群既不作来源也不作去处 | 混合形态和四层稿 §2.6 的回退方案几乎一样〔一手〕 |
| Hermes | 每个聊天一个 | **默认群里每个人各一个** | 每个人设一份，会话开始时冻结成快照 | 分开的理由是上下文污染和成本，不只是隐私〔一手〕（[sessions.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/sessions.md)） |
| Letta | 每个私聊一个对话 | 每次被 @ 开一个新对话 | 归 agent，跨对话共享 | 对话默认只对创建者可见〔一手〕（[权限文档](https://docs.letta.com/teams/permissions/index.md)） |
| AstrBot | 每个会话一个 | 默认整群一个，可开"隔离对话"每人一个 | 未查到 | 定时任务的权限限定在当前会话〔一手〕（[event_bus.py](https://github.com/AstrBotDevs/AstrBot/blob/4f60422f9ca15b7e1ebb9d22b2ac289eae782f8e/astrbot/core/event_bus.py)） |
| 麦麦 | 按聊天 | 按聊天；实验性的 Focus 模式让一个 Planner 看多个聊天 | 全局共享默认关 | Focus 的隐私靠"回复器只看目标聊天"加一句提示词〔一手〕（[focus 提示词](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/prompts/zh-CN/maisaka_chat_focus.prompt)） |
| AIRI | 每个外部场景一个持久会话 | 同左 | 未查到 | "场景隐私"列为未解决问题〔一手〕（[ADR](https://github.com/moeru-ai/airi/blob/7ab1ecae4bde4e6973e324198374580aa796a794/docs/ai/adr/2026-10-10-skills-automations-and-memory.md)） |
| Kindroid | 未查到 | 群与单聊的短期记忆默认隔离 | 群聊历史默认整理进每个角色的长期记忆 | 短期隔离，长期合流〔一手〕（[Kindroid](https://kindroid.ai/v2/docs/groupchats/)） |

Hermes 的理由值得多看一眼："Alice 和 Bob 可以在同一个频道里和 Hermes 说话而不共享记录；一个人工具很重的长任务不会污染另一个人的上下文"。改成共享一个"房间大脑"的代价是"共享 token 成本、打断状态和上下文增长"〔一手〕（[sessions.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/sessions.md)）。

也就是说，分会话**不只是为了隐私**。放到灵鲸的单会话里：主人和妈妈同时说话就要排队，这一点四层稿 §2.8 已经承认；妈妈那边一段长聊，也会把主人的会话撑大、提前触发换新。

各家的隐私做法分三档：

| 档 | 做法 | 例子 |
| --- | --- | --- |
| 结构上分会话 | 不同地方各用各的会话 | OpenClaw 隔离档、Hermes、Letta、AstrBot 隔离档 |
| 共享上下文，代码裁剪 | 共用一个决策上下文，由代码裁剪召回和出口 | OpenClaw 跨对话召回、麦麦回复器、eliza 的受众准入 |
| 只靠提示词 | 写一句规则让模型自觉 | 麦麦 Focus 的"不要把个人隐私透露到其他聊天"〔一手〕 |

其中两个教训对灵鲸最要紧。

**一是"拼上下文"比"管出口"难。** elizaOS 花大力气做了"受众准入"，但源码注释自己写着：往提示词里拼上下文的组件即使声明了受众准入，也"会在完全没有检查的情况下拼进提示词"〔一手〕（[components.ts](https://github.com/elizaOS/eliza/blob/b2dbeff3ab689a69f7e518deb7d608d1c4607790/packages/core/src/types/components.ts)）。四层稿 §2.6 的出口校验"用到的记忆号"，只抓得住模型老实上报的那部分。真正的防线是每轮前缀怎么拼。

**二是记忆是被低估的泄露通道。** Letta 的记忆归 agent、跨对话共享〔一手〕（[Letta](https://docs.letta.com/concepts/conversations/index.md)）；Hermes 的记忆在会话开始时冻结成快照，注入系统提示〔一手〕（[memory.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/memory.md)）。结果是：在 A 处学到的事，换新以后就出现在所有地方。唯一找到的公开泄露正是这一类：OpenClaw 生态里一个第三方记忆插件认不出群名时，回退去加载私聊记忆并注入群会话，审计标为高危〔二手〕（[ClawHub 审计](https://clawhub.ai/biociao/skills/apm-agent-progressive-memory/security-audit)）。OpenClaw 自己的跨对话召回规则恰好相反："认不出会话种类就不召回"，召回超时也不挡回复〔一手〕（[memory-config.md](https://docs.openclaw.ai/reference/memory-config.md)）。

OpenClaw 围绕 `dmScope` 修了十来个版本，坏的多是"回复往哪送"〔一手〕：切出主会话后旧路由残留，导致 Telegram 私聊重复回报（2026.2.27）；私聊的投递信息污染主会话（2026.5.19 修复，[CHANGELOG 2026.5.19](https://raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG/2026.5.19.md)）；异步完成的结果滞留在孤立队列里（2026.5.22 修复）。四层稿让 `reply` 的目标只来自事件、模型指定不了，正好避开这一类问题。如果同时保留两种模式的代码，还要测"切换后旧路由不残留"〔推理〕。

对灵鲸意味着什么〔推理〕：

**V1 不受影响。** V1 只有主人，总会话就是 OpenClaw 官方推荐的单人形态，有现成先例。

**V2 要改。** 举个例子：妈妈私聊她说"我体检有个指标不太好，先别跟他说"；第二天主人问"我妈最近怎么样"。在单会话里，便宜模型手里同时有这句原话和主人的问题，出口校验拦不住自由文字里冒出一句"阿姨最近在操心体检"。分会话时，这句原话只留在妈妈那个会话里；进到总会话的最多是一条带受众标记的记忆，由代码按受众过滤掉。

所以建议把 §2.6 的回退方案直接升为 V2 默认，群从第一天就分开（这也回答了 §10 第 9 条）。具体是：

| 部分 | 怎么做 |
| --- | --- |
| 主人的地方 | 主人的所有地方进总会话 |
| 别人的地方 | 每个非主人的地方开一个轻量"在场"会话，只有 reply、inner、recall，受众只含那个地方 |
| 消息流向 | 在场会话的动静以合并通知 inject 进总会话，只往上流 |
| 对别人主动开口 | 正文在那个地方的在场会话里生成，只带"可以公开的指导"（麦麦回复器的做法〔一手〕） |
| 需要派活的请求 | 以事件交回总会话 |

这样"她"仍是一个：身体、账本、记忆、人设都只有一份，总会话仍是唯一派活和拍板的地方，分开的只是聊天记录。

还有一个细节：共享会话里要标说话人时，学 Hermes 把名字放在每条消息前面，而不写进系统提示，以免每轮都让前缀缓存失效〔一手〕（[session.py](https://github.com/NousResearch/hermes-agent/blob/HEAD/gateway/session.py)）。

## 主动开口：代码管醒不醒，模型只管说不说，换强模型也换不来分寸

各家都把"要不要醒"交给代码（定时、合批、门控），把"醒了说不说"交给模型，并明确允许安静收场。

OpenClaw 把新会话、群动态、子任务回报都汇到主会话，"下一次运行时一起看"；新建会话"不额外叫醒"〔一手〕（[main-session](https://docs.openclaw.ai/concepts/main-session.md)）。AstrBot 在后台任务结果唤醒主 agent 时，固定加一段提示："用已有对话决定下一步。不要寒暄、不要问不必要的问题，没有有意义的事就不要发消息；要联系用户就说明原因，自然地提到那件任务"〔一手〕（[astr_main_agent_resources.py](https://github.com/AstrBotDevs/AstrBot/blob/4f60422f9ca15b7e1ebb9d22b2ac289eae782f8e/astrbot/core/astr_main_agent_resources.py)）。麦麦的后台子代理把结论作为一条新消息叫醒 Planner〔一手〕（[subagent_tasks.py](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/src/maisaka/subagent_tasks.py)）。这些和四层稿 §2.5 里 inject 与 followup 的分工一致。

论文把"该不该开口"测得很细，结论对模型档次并不乐观。

| 研究 | 发现 | 来源 |
| --- | --- | --- |
| ProactiveBench | "该不该主动"的误报率：GPT-4o-mini 64.73%、GPT-4o 51.85%；给 3 个候选后，GPT-4o 降到 36.44% | 〔一手〕[arXiv 2410.12361](https://arxiv.org/abs/2410.12361) |
| Proactivity-Gym：模型评测 | 把"主动"拆成做得对、时机、介入深度三件事。GPT 5.6-Sol 的推理强度从无开到最高，任务分从 50.0 涨到 58.9，**两项信任指标纹丝不动**；除 Claude Opus 5 外，其他模型"时机"得分都低于 20%；模型评委几乎看不出介入不当 | 〔一手〕[arXiv 2609.37267](https://arxiv.org/abs/2609.37267) |
| Proactivity-Gym：30 人研究 | 一次介入不当，信任掉 1.86 分；再做对，只回升 1.27 分；"合适—不当—合适"走完，只回到 3.43（起点 4.43）。**同样正确的帮助，和手头任务抢时间时接受率 26.7%；安排在睡觉时做、第二天再看，则是 97.8%** | 〔一手〕[arXiv 2609.37267](https://arxiv.org/abs/2609.37267) |
| PARE | "观察—执行"架构，和灵鲸二、三层同构：观察方只有只读工具和"继续等 / 向用户提议"两个动作，执行方拿全部工具、只在做完或做不到时说话。接受率按模型档拉开明显：Claude 4.5 Sonnet 78.2%、Qwen 3 4B 63.7%、Gemma 3 4B 17.6%。但论文**没测"小模型观察 + 大模型执行"**，而这正是灵鲸要用的组合 | 〔一手〕[arXiv 2604.00842](https://arxiv.org/abs/2604.00842) |

这组证据支持四层稿 §2.4 选方案 A，即总会话自己三选一，靠代码四道闸和反馈兜底。多花钱换强模型，换来的是"做得对"，换不来"该不该说、该说多深"。

可以再补三件事〔推理〕：

| 补什么 | 怎么做 | 依据 |
| --- | --- | --- |
| 紧急度 | 事实包加"紧急度"：不紧急且主人在忙，就留心事，等空闲或早上再说 | 推迟的帮助接受率高得多 |
| 介入深度 | 默认宁浅（先说、先问），由主人的反馈在夜里逐步放宽 | 信任丢得快、回得慢 |
| 评测口径 | M4 按模型档测主人接受率，只认主人的真实反馈，不用模型评委打分 | 模型评委看不出介入不当 |

系统发起的回合（活的结果回来、冲动过线）可以直接借用 AstrBot 那段措辞。

## 多人设：各有各的会话和记忆，派出去的活几乎都不带人设

多人设有两种组织法。

一种是多个独立的 agent，各有一套记忆和会话命名空间。Hermes 的 profile"按设计各自一份记忆"，并警告"不要让两个 agent 进程指向同一个目录，两个写手会把对方的条目搅成谁都没写过的状态"；两个 profile 服务同一个聊天时，会话键按 profile 分开，"永不相撞"〔一手〕（[memory.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/memory.md)、[session.py](https://github.com/NousResearch/hermes-agent/blob/HEAD/gateway/session.py)）。

另一种是一个群里多个角色轮流说话。Kindroid 里"每个角色能看到自己的背景和记忆，但看不到彼此的"，共同背景写进群设定；自动模式下，每个角色每轮最多说一次，全组每轮最多 5 条，角色可以提前把话轮交还用户〔一手〕（[Kindroid](https://kindroid.ai/v2/docs/groupchats/)）。SillyTavern 默认只把当前发言者的角色卡放进上下文；把所有卡合成一份的选项，文档警告会造成"混淆、人格融合"〔一手〕（[SillyTavern](https://docs.sillytavern.app/usage/core-concepts/groupchats/)）。

麦麦的"多套人设"只是同一个机器人手动切换，同一时刻只有一套生效〔一手〕（[changelog](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/changelogs/changelog.md)）。没有任何产品公开过"多个常驻角色各有常驻会话、彼此发消息"的运行数据。

四层稿 §2.9 的做法是：每个成员一个总会话，关系定义归 people，感受归各自的记忆。这比"关系写进群设定"更结构化，方向上有 Hermes、Kindroid、SillyTavern 三方支持〔推理〕。V3 的内部群可以直接借 Kindroid 的代码闸：每个成员每轮最多说一次，全组每轮有上限，可以交还话轮，成员不读彼此的设定〔推理〕。

"叫伙伴帮忙"该走伙伴的总会话（§2.9 方案 A），还是直接开带伙伴人设的会话（方案 B）？外部只有 Hermes 的 `profile_routes` 一个 B 式先例：它让子 agent 以某个 profile 的身份运行，带上那个 profile 的模型、技能和人设文件〔一手〕（[delegation.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/delegation.md)）。没有数据能分出高下。

派出去的活带不带人设，灵鲸是少数派：

| 系统 | 派出去的活带人设吗 | 来源 |
| --- | --- | --- |
| Hermes | 委派时刻意**排除** `SOUL.md`（人设文件），子 agent"对本对话一无所知" | 〔一手〕[delegation.md](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/delegation.md) |
| 麦麦 | 子代理的系统提示里没有人格，只说"你是一个被派发任务的子代理……任务说明就是你知道的全部背景" | 〔一手〕[subagent.py](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/src/maisaka/builtin_tool/subagent.py) |
| OpenClaw | 派生的会话不加载人设文件 | 〔一手〕[subagents.md](https://docs.openclaw.ai/tools/subagents.md) |
| 灵鲸（决策 5） | 第三层每种活都带她的人设 | 四层稿 §3.1 |

灵鲸这样做，代价是人设和任务指令抢上下文、要额外做身份探针；好处是活的经历能作为"她做的事"回流。这个取舍可以保留，但四层稿 §3.1 应写明这是**有意偏离业内做法**，理由是"活也是她"〔推理〕。

同一批产品给派出去的东西定的禁令，倒和灵鲸一致。Hermes 的子 agent 不能问用户、不能写共享记忆、不能跨平台发消息、不能以父 agent 的名义排期〔一手〕（[hermes-agent](https://github.com/NousResearch/hermes-agent) `tools/delegate_tool_toolsets.py`）。Springdrift 的子 agent 不能调用"请求人类输入"，目的是"防止被委派的 agent 劫持与运维者的交互通道"〔一手〕（[arXiv 2604.04660](https://arxiv.org/abs/2604.04660)）。

## 结论

这轮证据带来的最大变化是**换了比较对象**。总会话不是框架意义上的"编排者"：那些编排者是最强的模型，自己拍板理所当然。它更像双过程论文里的"Talker"：便宜、快、只管说话，深的东西交给慢的一方。用 Talker-Reasoner、MIRROR 这一组来衡量，R5 的方向站得住，缺的是"慢的一方看得到整段对话"。

同理，"每个人设一个总会话"应该理解成"每个人设一个拍板中心"，而不是"一份聊天记录"。OpenClaw 已经替我们试过把所有私聊并成一份，结论是只适合一个人。而分开聊天记录不只是为了隐私，也是为了不排队、不互相撑爆上下文。

剩下的风险集中在一点：便宜模型在"当场答还是想一想"上会判错，而且没有任何外部数据能告诉我们错多少。全部文献给的答案都一样：别指望模型自知，把判断挪到代码看得见的信号上，然后测量。因此 M4 评测要多测三样东西：`ponder` 三种做法的对比（当场答、交接包、整段原文）；主动开口的接受率，按模型档分开；当场答之后被主人追问或纠正的比例。打分只认主人的真实反馈。

## 对第二层设计的影响

下面两张表：第一张逐条判定四层稿第二层相关的设计点；第二张列出具体改动。改动建议本身都是〔推理〕，证据列标注来源等级。

证据强度的含义：**强**是多个独立的一手来源一致，或有实测数据；**中**是一手但只有单一来源，或从别的场景迁移，或只有设计没有测量；**弱**是主要靠二手资料或推理。

**逐条判定**

| 设计点 | 判定 | 一句话理由 | 强度 |
| --- | --- | --- | --- |
| R1 代码先判 | 支持 | AutoGen、Google ADK、OpenAI 都是"代码给候选、模型挑"；有效的双系统都靠外部信号切换 | 强 |
| R2 没工具就只能派 | 支持，依据要改 | B 派五家都收工具；提示词定倾向两头失灵；但 Super-agent router 装了 5 秒沙箱 bash | 强 |
| R3 回合预算 | 支持 | Kimi 主 agent 最多 15 步、子 agent 100 步；Lyfe：每步都让模型重选不提升表现，只加成本 | 中 |
| R4 不能挡住对话 | 支持 | Hermes、Super-agent、Claude Code、Devin 同一形状；Anthropic 的同步等待成了瓶颈 | 强 |
| R5 决定只在想事活 | 部分支持，要改 | 编排框架全部反向；双过程论文同向，但慢的一方看得到整段对话 | 中 |
| R6 执行者由代码给 | 支持 | DecisionBench：DeepSeek-V4-Flash 偏爱同厂商 1.53 倍；按需查档案更准 | 强 |
| §2.3 末段"当场答还是想一想" | 最弱的一环 | 前沿模型自判求助 4–24%；零样本路由不如瞎猜 | 强（指"靠不住"） |
| §2.4 默认方案 A | 支持 | 推理强度不提高信任指标；强模型误报也过半 | 中 |
| §2.6 V2 一个会话管多个地方 | 反对 | 唯一先例只适合单人，且已改默认；其余系统都按地方分 | 强 |
| §2.9 多成员 | 支持 | Hermes profile、Kindroid、SillyTavern | 中 |
| §2.1"Super-agent router 不装 shell" | 事实错误 | 原型装了 5 秒沙箱 bash 和后台任务，只关写文件、改文件 | 强 |
| §2.1"剩下的事小模型做得了" | 被削弱 | PIANO 只有 GPT-4o 跑得起来；DPT-Agent 20B 以下的前台得分近乎为零；PARE 4B 观察者接受率 17.6% | 中 |
| §10 第 1 条 直连 DeepSeek | 无直接证据 | Manus 称缓存命中率是生产 agent 最重要的指标，略支持去掉会和人设竞争的编码预设 | 弱 |
| §10 第 3 条 代码直接开想事活 | 支持 | OpenClaw 新会话"不额外叫醒"；有效系统都靠外部信号触发 | 中 |
| §10 第 4 条 叫伙伴经伙伴总会话 | 无数据分高下 | 只有 Hermes `profile_routes` 一个反向先例；保留 A | 弱 |
| §10 第 5 条 订阅直通 | 支持 | Super-agent 去掉直通后主会话决定数多约 30%〔二手〕；Amp 运行中的子 agent 立即收新指令；Hermes 可实时纠偏 | 中 |
| §10 第 6 条 V1 不做模型巡查 | 支持 | Hermes 用停滞阈值（450 秒 / 1200 秒）关掉卡死；POrchestra：子任务主动报告胜过轮询 | 中 |
| §10 第 9 条 群进不进总会话 | 应定为"群从一开始分会话" | 见 §2.6 一行 | 强 |

**改动建议**

| # | 改哪里（四层稿） | 改成什么 | 为什么 | 证据 | 强度 |
| --- | --- | --- | --- | --- | --- |
| 1 | §2.6 全节、§2.8"跨群隐私"行、§7"V2 多地方"行、§10 第 9 条 | 回退方案升为 V2 默认：主人的地方进总会话；每个非主人的地方开一个在场会话（reply / inner / recall，受众只含该地方）；动静以合并通知 inject 总会话；对别人开口时在该地方的会话里生成，只带可公开的指导；要派活的以事件交回总会话；群从第一天分开 | 唯一先例只适合单人且已退回；顺带解决排队和上下文互相撑大 | 〔一手〕[OpenClaw 安全审计](https://docs.openclaw.ai/cli/security.md)、[CHANGELOG 2026.2.22](https://raw.githubusercontent.com/openclaw/openclaw/HEAD/CHANGELOG/2026.2.22.md)、[Hermes sessions](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/sessions.md)、[麦麦 Focus](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/prompts/zh-CN/maisaka_chat_focus.prompt) | 强 |
| 2 | §2.6"每轮前缀按受众裁" | 换成四条代码可查的召回规则：只从主人认可的私密地方召回，当前地方除外；群永远不作来源也不作去处；认不出地方种类就不召回；召回超时不挡回复 | 把模糊表述变成能测的规则；"认不出就不给"正是已知泄露的反面 | 〔一手〕[OpenClaw 召回规则](https://docs.openclaw.ai/reference/memory-config.md)；〔二手〕[ClawHub 审计](https://clawhub.ai/biociao/skills/apm-agent-progressive-memory/security-audit) | 强 |
| 3 | §2.10 第二层"写"列、§2.7 换新 | `inner` 写入的事实、印象带上"在哪听到、谁能知道"；`context.forCreation` 重建前缀时按受众过滤；加"换新后不串地方"的测试 | 记忆快照会在换新时把 A 处的事带到所有地方；拼上下文比管出口难 | 〔一手〕[Hermes 记忆](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/memory.md)、[Letta](https://docs.letta.com/concepts/conversations/index.md)、[eliza](https://github.com/elizaOS/eliza/blob/b2dbeff3ab689a69f7e518deb7d608d1c4607790/packages/core/src/types/components.ts)、[Kindroid](https://kindroid.ai/v2/docs/groupchats/) | 中 |
| 4 | §2.3 R5、`ponder` 工具、§3.1"想事"行 | R5 分两类：她的长期立场类仍只在想事活里定，标注"无外部先例、靠审计与风险理由、待 M4 验证"，同一议题只许一个想事活写入；"替主人出主意"类走 `ponder`，但不给决定类工具，只出建议加事实栏。`ponder` 默认"抄一份"：由代码给想事活稳定前缀 + 最近 N 轮原文 + 召回，总会话只报议题 | 编排者都自己拍板；拆开的代价是信息损失；双过程论文里慢的一方看得到整段对话 | 〔一手〕[Anthropic lead 提示词](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/prompts/research_lead_agent.md)、[Google 260 配置](https://arxiv.org/html/2512.08296)、[Tran & Kiela](https://arxiv.org/abs/2604.02460)、[Talker-Reasoner](https://arxiv.org/abs/2410.08328)、["抄一份"式派生](https://arxiv.org/abs/2410.21620) | 中 |
| 5 | §0 例子、§2.2 表、§2.11 第 3 行 | "帮我想想下周怎么安排"统一归 `ponder`（只读、无决定类工具）；§2.2 第③类只留"查资料" | 文档三处自相矛盾 | 四层稿本身 | 不适用 |
| 6 | §2.3 末段 | 判据改成两步：先问"主人此刻在等什么"；一句话能答、不翻账本、不涉及她立场的当场答，否则垫话 + `ponder`。配上带例子的分档（当场答、ponder、dispatch 各 3–5 例）和反向约束"别为一句话能答的事派活"。代码起回合前打意图标签（想想、安排、该不该、涉及她立场、引用没结的议题、跨三处以上账本），命中就在前缀写"建议 ponder"。记两个指标：当场答后两轮内被追问或纠正的比例；ponder 结论与当场答案差不多的比例 | 模型自判升级是全部文献里最弱的一环；有效系统都靠外部信号 | 〔一手〕[HiL-Bench](https://arxiv.org/abs/2604.09408)、[快决策模型评测](https://arxiv.org/abs/2610.02267)、[Codex](https://github.com/openai/codex)、[Gemini CLI](https://github.com/google-gemini/gemini-cli)、[Talker-Reasoner](https://arxiv.org/abs/2410.08328) | 强（弱点本身）；中（具体做法） |
| 7 | §2.3 R4 与工具表；`overall.md` §8 R10 | 加 `no_reply(理由)`；主人发起的回合必须以 reply / say / dispatch / ponder / no_reply 之一结束；系统发起的回合允许安静收场 | 沉默成为可记录、可审计的决定；兜底只需查"什么都没调" | 〔一手〕Claude Code coordinator 变体、[OpenClaw NO_REPLY](https://docs.openclaw.ai/tools/subagents/announce.md)、[Hermes allow_silence](https://hermes-agent.nousresearch.com/docs/user-guide/messaging) | 中 |
| 8 | §2.7 稳定前缀的"总会话说明" | 写明三句：汇报和结论会自己作为事件到达，绝不等待；这些事件是内部信号，不是主人在说话，不回应事件本身；派完一句话告诉主人就结束回合 | 各家异步设计共同的提示 | 〔一手〕[Hermes](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/delegation.md)、[Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype)、Claude Code coordinator；〔二手〕[Manus 泄露提示词](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) | 强 |
| 9 | §2.3 R4、§2.5、outbox | 异步三防：[正在做] 每轮必在；"做完了 / 改好了 / 我想好了"只在对应事件到达后才许说，outbox 按活号查状态；`dispatch` 被拒时，拦下或改写同批的"我开始改" | 防止先假设结果、忘记任务、嘴上答应手上没做 | 〔一手〕[AsyncTool](https://arxiv.org/abs/2605.27995)、[Springdrift](https://arxiv.org/abs/2604.04660)、[PIANO](https://arxiv.org/abs/2411.00114) | 中 |
| 10 | §3.2 `task.conclusion` 与 `task.report`；§6 第 5 条 | 把"读到的最后消息号"写进协议字段，升为规则：之后有同议题新消息就不照念，改说"我刚想完，不过你后来说了 X，我再看看" | 主人改口后按旧想法继续是普遍失败 | 〔一手〕[InterruptBench](https://arxiv.org/abs/2604.00892)、[Retire](https://arxiv.org/abs/2610.01160) | 中 |
| 11 | §2.3 `ponder` 的"建议答复?"参数 | 只许"我在想"类垫话，不许给初步结论 | 结论没到就开口会降分，还要改口 | 〔一手〕[KAME](https://arxiv.org/abs/2510.02327)、[Manus 博客](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) | 中 |
| 12 | §2.2"收到汇报后告诉主人"行 | 事实栏里的数字、日期、人名、链接、文件名原样出现，由 outbox 校验一致；核验没过的转述必须带"还没确认" | 转述会走样；子 agent 的总结只是自述 | 〔一手〕[DUMA](https://arxiv.org/abs/2310.18075)、[LangChain](https://www.langchain.com/blog/benchmarking-multi-agent-architectures)、[Hermes](https://github.com/NousResearch/hermes-agent)、eliza | 中 |
| 13 | §2.1、R2 依据栏 | 改为"Super-agent router 关了写文件和改文件，shell 是 5 秒超时的沙箱，另装后台任务；灵鲸更进一步，不装 shell" | 原文与原型配置不符 | 〔一手〕[Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype) `cordis.patch.yml` | 强 |
| 14 | §2.3 工具表的 `look`（"后期"改为 V1）、R6 | 总会话尽早有只读的 `look`，能看活的状态和执行者档案；`dispatch` 的执行者候选带可查询的档案，不塞进稳定前缀 | 能查的编排者派得更准、更少；B 派同行都保留了只读能力 | 〔一手〕[DecisionBench](https://arxiv.org/html/2605.19099)、[Kilo](https://github.com/Kilo-Org/kilocode)、Claude Code coordinator | 中 |
| 15 | §2.1"大脑"一条 | "剩下的事是小模型做得了的"改为"便宜可以，不要最小"；M4 按模型档测 | 前台太小会崩 | 〔一手〕[PIANO](https://arxiv.org/abs/2411.00114)、[DPT-Agent](https://arxiv.org/abs/2502.11882)、[PARE](https://arxiv.org/abs/2604.00842)、[Cognition](https://cognition.com/blog/multi-agents-working) | 中 |
| 16 | §2.4 事实包与回合提示 | 加"紧急度"：不紧急且主人在忙，就留心事，空闲或早上再说；介入深度默认先说、先问，由主人反馈在夜里放宽；系统发起回合的提示借 AstrBot 的话："没有必要就别发；要发就说明为什么，自然提到那件事；别寒暄"；M4 只认主人的真实反馈 | 推迟的帮助更受欢迎；信任丢得快、回得慢；模型评委看不出介入不当 | 〔一手〕[Proactivity-Gym](https://arxiv.org/abs/2609.37267)、[AstrBot](https://github.com/AstrBotDevs/AstrBot/blob/4f60422f9ca15b7e1ebb9d22b2ac289eae782f8e/astrbot/core/astr_main_agent_resources.py) | 中 |
| 17 | §3.2 交接包、`dispatch` 参数 | 路由备注不超过 30 字，只写路由背景与主人的明确约束；原话由代码按编号附上；交接包注明"本交接优先于该活种类的通用指令" | 缺上下文的派活者指示过细会适得其反 | 〔一手〕[Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype) `prompts/dispatch.md`、[Cognition](https://cognition.com/blog/multi-agents-working)、[Roo-Code](https://github.com/RooCodeInc/Roo-Code) `mode.ts` | 中 |
| 18 | §3.1 | 写明"每种活都带她的人设"是有意偏离业内做法，并写出理由；把第三层的禁令集中成一条：不能问主人、不能写账本、不能投递、不能排期、默认不能再派想事活 | 让读者知道这不是默认做法；禁令现在散在多处 | 〔一手〕[Hermes 委派](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/delegation.md)、[麦麦 subagent.py](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/src/maisaka/builtin_tool/subagent.py) | 中 |
| 19 | §3.2 | 手开工时回一句结构化的"我理解要做的是 X"，在主控台显示或由总会话转述 | 让真正干活的一方说"收到了"，误解能马上暴露 | 〔一手〕[Super-agent](https://github.com/deepseek-ai/dsh-superagent-prototype) `prompts/replies.md` | 弱 |
| 20 | §2.9 内部群 | 加代码闸：每个成员每轮最多说一次，全组每轮有上限，可交还话轮；成员不读彼此的设定 | 多角色群聊里已经跑通的规则 | 〔一手〕[Kindroid](https://kindroid.ai/v2/docs/groupchats/)、[SillyTavern](https://docs.sillytavern.app/usage/core-concepts/groupchats/) | 中 |
| 21 | §5 看门狗 | 维持 V1 用代码看门狗；以后真要模型巡查，就用 Magentic-One 五问（完成了吗、在绕圈吗、有进展吗、下一步给谁、给什么指令），卡住 2–3 次就转想事活重规划，并先写根因 | 结构化账本是编排者价值的来源：去掉账本后成绩掉 31% | 〔一手〕[Magentic-One](https://arxiv.org/html/2411.04468)、[Hermes 委派](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/delegation.md) | 中 |
| 22 | §2.7 换新 | 维持每夜换新；别人的地方用更短的闲置重置；把 Springdrift 记录的三个症状做成回归测试：不同时间的问候不同、换新后提到之前的事、派活时知道手上活的状态 | 几周不换的会话又贵，又让"忘了再查记忆"的机制永远触发不了 | 〔一手〕[Hermes 记忆](https://github.com/NousResearch/hermes-agent/blob/HEAD/website/docs/user-guide/features/memory.md)、[Springdrift](https://arxiv.org/abs/2604.04660) | 中 |
| 23 | 路线图 M4（四层稿 §2.4 末段、§10 第 2 条） | 加 R5 对照组：同一批"帮我想想"问题，比较当场答、ponder（交接包）、ponder（整段原文）三种做法；主动开口接受率按模型档分开测；把预筛成本算进去，阈值在留出数据上定 | 只有这里能下定论；评测口径不严会高估省下的钱 | 〔一手〕[快决策模型评测的自查](https://arxiv.org/abs/2610.02267)、[Proactivity-Gym](https://arxiv.org/abs/2609.37267) | 不适用 |
