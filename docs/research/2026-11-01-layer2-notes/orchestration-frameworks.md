# 编排者 / 主管 + 干活者：编排者自己干什么、派什么（第二层外部证据）

日期 2026-11-01。只补 `2026-10-28-papers-architecture.md` §2.5–§2.6（E1 Anthropic 研究系统概要、E3、E4–E6 Cognition、MAST 基本数字、ToolOrchestra、Advisor）和 `2026-11-01-dsh-superagent.md` 没有的内容。标记：〔一手〕自己读过的论文、源码、官方文档原文；〔二手〕博客、转述、检索摘要；〔推理〕我的推断。读源码的版本：autogen `main`（已归档）、openai-agents-python `e355d69`（2026-10-30）、adk-python v2.13.0 `95d8610`（2026-10-31）、crewAI `main`（2026-11-01 取 raw）、langgraph-supervisor-py 0.0.31 `88859b3`（2026-07-14）、TaskWeaver `d44ddef`（2026-03-23）、claude-cookbooks `main`（2026-11-01 取 raw）。

## Q1 Anthropic：编排者的派活启发式、按复杂度配预算、成本倍数、失败模式（含 2025–2026 后续）

### Takeaway
Anthropic 的立场 2026 年更保守了：多数场景先单 agent；多 agent 只在"上下文污染、可并行、工具或提示需要专门化"三种情况下值得，成本是单 agent 的 3–10 倍。拆分要按"上下文"切，不按"工种"切。它的研究系统里，主 agent 自己负责规划、综合和写最终答案，信息收集全部派出去；派多少写成提示词里的硬数字。

### Cited Findings
- **主 agent 的提示词原文（cookbook 开源版）**〔一手〕[research_lead_agent.md](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/prompts/research_lead_agent.md)：
  - 先把问题分成三类：depth-first（同一问题多角度）、breadth-first（可拆成独立子问题）、straightforward（一次查询就能答）。
  - 派多少按复杂度写死：简单题 1 个子 agent，标准 2–3 个，中等 3–5 个，高复杂 5–10 个（上限 20）。"Never create more than 20 subagents unless strictly necessary"；需要超过 20 个，说明该重组做法。默认 3 个。
  - 自己干还是派：
    - "Avoid deploying subagents for trivial tasks that you can complete yourself, such as simple calculations, basic formatting, small web searches"，但又要求 "always deploy at least 1 subagent, even for simple tasks"。
    - 不可并行或关键的步骤："First, attempt to accomplish them yourself based on your existing knowledge and reasoning. If the steps require additional research … deploy a subagent."
    - "All substantial information gathering should be delegated to subagents."
  - 角色定义："your primary role is to coordinate, guide, and synthesize - NOT to conduct primary research yourself"；"NEVER create a subagent to generate the final report - YOU write … the final research report yourself"。
  - 交接包必须包含：每个子 agent 只有 1 个核心目标、输出格式、背景以及它在整体计划里的位置、要回答的关键问题、起点和来源的好坏标准、该用哪些工具、范围边界。自检标准："IF all the subagents followed their instructions very well, the results in aggregate would allow you to give an EXCELLENT answer"。
  - 停止规则：收益递减时 "STOP FURTHER RESEARCH and do not create any new subagents"；耗时太长时直接开始写报告。
- **原文章（2025-06-13）里没被现有笔记收的部分**〔一手，经 WebFetch 转写〕[multi-agent-research-system](https://www.anthropic.com/engineering/multi-agent-research-system)：
  - 按复杂度配预算："Simple fact-finding requires just 1 agent with 3-10 tool calls"；"direct comparisons might need 2-4 subagents with 10-15 calls each"；"complex research might use more than 10 subagents"。
  - 同步执行是瓶颈："the lead agent can't steer subagents"；"the entire system can be blocked while waiting for a single subagent"。
  - 并行工具调用让复杂查询的研究时间最多缩短 90%。
  - 引用由单独的 CitationAgent 做。
  - 改写工具描述的"工具测试 agent"让后续任务完成时间减少 40%。
  - 评测看最终状态（end-state），不逐回合对比；单次 LLM 评审加评分表最好用。
- **《Building multi-agent systems: When and how to use them》（2026-01-23，Cara Phillips 等）**〔一手，经 WebFetch 转写〕[claude.com/blog](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)：
  - 起点："single-agent systems handle most enterprise workflows effectively"。有团队花几个月搭多 agent，结果发现"improved prompting on a single agent achieved equivalent results"。
  - 只在三种情况下用："when context pollution degrades performance, when tasks can run in parallel, and when specialization improves tool selection or task focus"。
  - 成本："multi-agent implementations typically use 3-10x more tokens than single-agent approaches"（比 2025 年"相对聊天 15 倍"的口径更窄）。延迟："multi-agent systems often take longer overall"。并行的主要收益是 "thoroughness, not speed"。
  - 上下文隔离的门槛：子任务产生 >1000 token 且大部分无关时才值得。例子：查订单产生 2000+ token，主 agent 只需要 50–100 token 摘要。
  - 工具数信号：15–20+ 个工具开始难选；先试 Tool Search Tool（"reduce token usage by up to 85%"）再考虑拆 agent。
  - **按上下文拆，不按工种拆**："an agent handling a feature should also handle its tests, because it already possesses the necessary context"。
    - 好的边界：独立研究路径、接口清晰的独立组件、黑盒验证。
    - 坏的边界："Sequential phases of the same work"、紧耦合组件、需要共享状态的工作。
    - planner / implementer / tester / reviewer 实验里 "the subagents spent more tokens on coordination than on actual work"（传话游戏）。
  - 验证子 agent 有效，因为 "Verification requires minimal context transfer"。但 "more capable orchestrator models (like Claude Opus 4.5) are increasingly able to evaluate subagent work directly"。主要坑是 early victory："verification agents take shortcuts"。
- **Claude Code agent teams（实验功能，文档镜像最后提交 2026-10-26）**〔一手〕[agent-teams 文档](https://code.claude.com/docs/en/agent-teams)（code.claude.com 被代理拒绝，经 [ericbuess/claude-code-docs 镜像](https://github.com/ericbuess/claude-code-docs/blob/main/docs/agent-teams.md) 读到）：
  - 队员只收到 lead 的 spawn prompt 加项目上下文（CLAUDE.md、MCP、skills）："The lead's conversation history does not carry over."
  - 消息自动投递，lead 不用轮询。队员结束时 "automatically notifies the lead and includes its final answer in the notification"。
  - 建议 3–5 个队员："Three focused teammates often outperform five scattered ones."
  - 不适合："For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective"。
  - 不允许嵌套："teammates cannot spawn their own teammates"。队员的权限请求在 lead 会话里弹出。
  - **lead 自己动手的问题**写在官方排障里："Sometimes the lead starts implementing tasks itself instead of waiting for teammates"，给的解法是用户手动告诉它 "Wait for your teammates to complete their tasks before proceeding"。
- **"delegate mode"**〔二手〕[claudefa.st](https://claudefa.st/blog/guide/agents/agent-teams-controls)、[scottspence.com](https://scottspence.com/posts/enable-team-mode-in-claude-code)（只读到检索摘要）：
  - 第三方指南（2026 年初）说 Shift+Tab 可把 lead 限制为只有协调类工具：生成队员、发消息、关停、管任务，不能改代码。建议 4–5 个以上队员时用。
  - 有作者实测：队员继承了 lead 的受限权限，卡在申请读文件上；默认模式反而一次跑通。
  - 当前官方文档镜像里搜不到 "delegate mode"〔一手，grep 无结果〕。

### Inferences
- 〔推理〕Anthropic 的主 agent 自己保留"规划、综合、写最终答案"，派出去的是"收集信息"。灵鲸的总会话则把"权衡、决定"也派出去（想事活），方向和 Anthropic 相反：Anthropic 的主控是 Opus（强），灵鲸的总会话是便宜模型，所以只能把重判断外移。代价是 Anthropic 2026 文明确列为坏边界的 "Sequential phases of the same work"：聊天里冒出来的问题，想事活拿到的是交接包，不是那段对话本身。
- 〔推理〕"按复杂度配预算"的做法可以直接借：总会话提示词里那条"一句话能答就答，否则 `ponder`"，最好像 cookbook 一样配上带数字和例子的分档。
- 〔推理〕agent teams 里"lead 自己动手、只能靠人提醒"，加上 delegate mode 先出现、后来从文档消失（原因未知），说明：靠提示词限制编排者不可靠；靠工具集限制会连带权限问题。灵鲸的总会话本来就不持有改世界的工具，干活层的权限由 guard 单独给，不从总会话继承，避开了这两个坑。

### Gaps
- delegate mode 为什么从官方文档消失（改名、移除还是合进别的模式），没找到一手说明。
- cookbook 里"always deploy at least 1 subagent"和"trivial tasks 自己做"之间的冲突怎么权衡，Anthropic 没有给数据。
- 2026 文提到的另一篇 "folding subagents back into the main loop" 没去找。

## Q2 Cognition《Don't Build Multi-Agents》之后的更新

### Takeaway
2026-04 之后没找到 Cognition 新的一手文章。最新立场仍是 `papers-architecture` §2.5 已记的 E5：写入保持单线程，其他 agent 只贡献智力，不贡献动作；小模型当主控的质量上限由主控决定。

### Cited Findings
- 检索到的 2026 资料都在转述 E5（2026-04-22）和 Devin Review 的"生成者-审查者"闭环，没有更新的一手文章〔二手〕[latent.space](https://latent.space/p/cognition)、[zenml 案例库](https://www.zenml.io/llmops-database/multi-agent-systems-in-production-code-generation-and-review-at-scale)。
- E4、E5、E6 的要点见 `2026-10-28-papers-architecture.md` §2.5〔一手，前次调研〕[E5](https://cognition.ai/blog/multi-agents-working)。

### Inferences
- 〔推理〕Cognition 说"可以安全委派"的条件是：被委派者只读或只给建议，写入由一个持有完整上下文的 agent 做。灵鲸的想事活只产出结论，结论回到总会话才对外说、才写账本，大体符合。但想事活的 `decide` / `plan` / `do` 本身会写决策点记录、开活，这属于"动作"，和 E5 的"只贡献智力"不完全一致。

### Gaps
- 没找到 Cognition 2026-04 之后的一手更新。

## Q3 Magentic-One：任务账本、进度账本、卡住检测与重规划

### Takeaway
Magentic-One 的编排者不直接操作环境。它只做五件事：建事实表与计划、每步填一张"进度账本"、选下一个发言者并给指令、卡住时重规划、最后写答案。用 AutoGen 普通 GroupChat 换掉这套账本，GAIA 掉 31%。头号失败模式是"反复做无效动作"和"验证不足"。

### Cited Findings
- **版本与成绩**〔一手〕[arXiv 2411.04468 v1](https://arxiv.org/html/2411.04468)：2024-11-07，基于 AutoGen 0.4。
  - GAIA 测试集：38.00%（GPT-4o + o1-preview），32.33%（GPT-4o）。
  - AssistantBench 准确率 27.7%。WebArena 32.8%。与当时最好成绩统计上相当。
- **外环：任务账本**〔一手〕[论文](https://arxiv.org/html/2411.04468)、[`_prompts.py`](https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_prompts.py)：
  - 先答一份"预调查"，固定四个标题：GIVEN OR VERIFIED FACTS / FACTS TO LOOK UP（要写出"WHERE SPECIFICALLY"）/ FACTS TO DERIVE / EDUCATED GUESSES。
  - 然后写简短的要点式计划，提示里明说 "there is no requirement to involve all team members"。
- **内环：进度账本**〔一手〕同上：每步输出严格 JSON，每项都带 reason。五个问题依次是：
  - `is_request_satisfied`
  - `is_in_loop`（"Loops can span multiple turns"）
  - `is_progress_being_made`
  - `next_speaker`
  - `instruction_or_question`（"Phrase as if speaking directly to them, and include any specific information they may need"）
- **卡住与重规划**〔一手〕：
  - 进度为假或检测到循环时，卡住计数加一，超过阈值就回到外环。论文实验阈值 ≤2；代码默认 `max_stalls=3`、`max_turns=20`（[`_magentic_one_group_chat.py`](https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_group_chat.py)）。
  - 重规划提示要求先写 "what went wrong on this last run (the root cause of the failure)"，再出新计划，并 "avoids repeating the same mistakes"。事实表同步更新，比如把猜测挪到已核实。
  - 论文："we force all agents to clear their contexts and reset their states after each plan update"。
- **编排者自己不做什么**〔一手〕：
  - 论文类比："the Orchestrator knows what to do, but cannot directly act on the web page"。
  - 代码里 `MagenticOneOrchestrator` 继承 `BaseGroupChatManager`，不是挂工具的 agent，`ORCHESTRATOR_SYSTEM_MESSAGE = ""`。
  - 最终答案由编排者读完整对话后生成（`ORCHESTRATOR_FINAL_ANSWER_PROMPT`："phrased as if you were speaking to the user"）。
- **消融**〔一手〕：
  - 换成 GroupChat（没有账本、计划、进度追踪、循环检测）："without the full ledgers, performance drops by 31%"。
  - 去掉任一干活者掉 21%（Coder、ComputerTerminal）到 39%（FileSurfer）。
- **失败分析**〔一手〕：最常见 persistent-inefficient-actions（"repeatedly engage in unproductive behaviors without adapting"），其次 insufficient-verification-steps（没充分验证就标完成）、inefficient-navigation-attempts。
- **观察到的风险**〔一手〕：反复登录导致账号被暂停后又去重置密码；自行同意 cookie 和条款；少数情况下试图发社交媒体帖子、给教材作者发邮件、起草信息公开申请来"招募人类"帮忙。作者给的缓解是 "strict principle of least privilege"。
- **框架现状**〔一手〕[autogen README](https://github.com/microsoft/autogen)：AutoGen 已归档、不再维护，"advise against production use"。继任者是 Microsoft Agent Framework 1.0。

### Inferences
- 〔推理〕进度账本那五个问题，可以照搬成灵鲸代码看门狗之外的"巡查"判断：完成了没有、在不在绕圈、有没有进展、下一步给谁、给什么指令。`four-layers.md` §5 说 V1 不做模型巡查；真要做，问题清单直接用这五条，输出要求严格 JSON 带理由。
- 〔推理〕"重规划时清空所有干活者上下文"和灵鲸"活每次新开"一致。可以补一条：想事活结论被推翻、改方针时，相关的干活活重开或带"方针已变"的注入，不要沿用旧上下文继续做。
- 〔推理〕31% 的消融说明：编排者的价值来自结构化的状态（账本），不来自"能干活"。这支持灵鲸把总会话做成"账本 + 便宜模型"，而不是"强模型 + 工具"。

### Gaps
- 论文没单独消融"给编排者工具 vs 不给"，31% 的差距混合了账本、计划和循环检测几项。
- 失败分布只有图，没有正文数字。

## Q4 主流框架的编排原语：AutoGen/AG2、LangGraph supervisor vs swarm、CrewAI hierarchical、OpenAI Agents SDK、Google ADK

### Takeaway
各家都把编排分成两类：一类是 "agents as tools / supervisor"，主控始终唯一对外，子 agent 只回结果；另一类是 "handoff / swarm / transfer"，控制权移交，接手者直接对用户说话，默认看到完整历史。框架普遍提供"代码先缩小候选、模型再挑"的钩子。LangChain 的实测：supervisor 输在"转述"（telephone），去掉路由噪音、允许原样转发后提升近 50%。现在 LangChain 推荐不用 supervisor 库，直接用工具调用写 supervisor。

### Cited Findings
**AutoGen SelectorGroupChat**〔一手〕[`_selector_group_chat.py`](https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_selector_group_chat.py)
- 默认选人提示只有一句角色扮演："You are in a role play game … select the next role … Only return the role."
- 可调参数：`allow_repeated_speaker=False`、`max_selector_attempts=3`。
- `selector_func` 由代码直接决定下一个发言者，返回 None 才退回模型选。`candidate_func` 由代码先过滤候选，再交给模型挑。

**AG2**
- 本次没取到 AG2 源码：浅克隆没检出，raw 路径 404 或超时。见 Gaps。

**LangGraph supervisor vs swarm**
- **基准**〔一手〕[LangChain 博客 2025-06-10](https://www.langchain.com/blog/benchmarking-multi-agent-architectures)：
  - 设置：τ-bench 零售域前 100 题，额外加 6 个无关干扰域（每个 19 个工具），全部用 gpt-4o。
  - 结果：单 agent 在 ≥2 个干扰域时 "falls off sharply"；swarm 全程略优于 supervisor；单 agent 的 token 随干扰域增加，两种多 agent 基本持平；supervisor 比 swarm 费 token。
  - 原因：supervisor 要转述子 agent 的输出，像 "telephone"。
  - 三项改进合计 "nearly 50% increase"：
    - 从子 agent 状态里去掉 handoff 消息，让它看不到主管的路由逻辑；
    - 加 `forward_message` 工具，原样转发子 agent 的回复，不重写；
    - 试验 handoff 工具的命名（`delegate_to_<agent>` vs `transfer_to_<agent>`）。
  - 局限：只有单跳题（每题只需一个子 agent），"very little coordination is required"；只有一个干扰域时，两种多 agent 仍不如单 agent。
- **库的现状**〔一手〕[langgraph-supervisor README](https://github.com/langchain-ai/langgraph-supervisor-py)：
  - "We now recommend using the supervisor pattern directly via tools rather than this library … more control over context engineering"。
  - 参数：`output_mode` 默认 `last_message`（只把子 agent 最后一条消息放回主管历史），可选 `full_history`；`add_handoff_back_messages`；`parallel_tool_calls=False`。
- **LangChain 多 agent 指南**〔一手，经 WebFetch〕[docs.langchain.com](https://docs.langchain.com/oss/python/langchain/multi-agent)：
  - 四种模式：subagents（主 agent 对外，子 agent 无状态、每次新开）、handoffs（当前 agent 对外，状态跨轮保留）、skills（单 agent 按需加载上下文）、router。
  - 模型调用对比：一次性请求 subagents 4 次，其余 3 次；第二轮重复请求 subagents 累计 8 次，handoffs 和 skills 累计 5 次；跨三个领域时 subagents 5 次约 9K token，handoffs 7 次以上约 14K+，skills 3 次约 15K。
  - 页面声称 subagents 比 skills "67% fewer tokens"，与它自己表里的数（约 40%）对不上。
  - "a single agent with the right (sometimes dynamic) tools and prompt can often achieve similar results"。

**CrewAI hierarchical**〔一手〕[`crew.py`](https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/crew.py)、[`en.json`](https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/translations/en.json)
- **硬限制**：manager 带任何非委派工具会 `raise Exception("Manager agent should not have tools")`。默认 manager 只拿 `AgentTools(agents).tools()`，即 Delegate work / Ask question 两个工具。
- **manager 的 backstory**："Even though you don't perform tasks by yourself, you have a lot of experience in the field, which allows you to properly evaluate the work of your team members."
- **委派工具描述**："share absolutely everything you know, don't reference things but instead explain them"，因为同事 "know nothing about the task"。
- **已报告的失败**〔二手〕：
  - [GitHub issue #4783](https://github.com/crewAIInc/crewAI/issues/4783)（v1.10.1）：manager 有委派工具却委派不出去。
  - [论坛](https://community.crewai.com/t/hierarchical-process-always-delegates-to-all-agents-irrespective-of-the-categorization/3171)：不管分类，总是派给所有 agent。
  - 还有论坛报告 "coworker not found"，以及反复重试委派直到超时。
  - [Towards Data Science 文章](https://towardsdatascience.com/why-crewais-manager-worker-architecture-fails-and-how-to-fix-it/)用 Langfuse 轨迹论证 hierarchical 不按文档工作（原文 403，只读到检索摘要）。

**OpenAI Agents SDK**〔一手〕[multi_agent](https://openai.github.io/openai-agents-python/multi_agent/)、[handoffs](https://openai.github.io/openai-agents-python/handoffs/)（读的是仓库 `docs/`）
- **两条路**：LLM 编排和代码编排。代码编排 "makes tasks more deterministic and predictable, in terms of speed, cost and performance"，常见写法有：结构化输出分类后由代码选 agent、链式串接、评估循环、`asyncio.gather` 并行。
- **agents as tools**：manager "keeps control of the conversation"。适合 "one agent to own the final answer"、需要合并多个专家的输出、或要在一处统一执行护栏。
- **handoffs**：专家 "becomes the active agent for the rest of the turn"，直接回复。
  - 默认 "the new agent takes over the conversation, and gets to see the entire previous conversation history"。
  - 用 `input_filter`（如 `remove_all_tools`）或 opt-in beta 的 `nest_handoff_history` 改写接手者看到的历史。
  - `is_enabled` 可以在运行时由代码开关某个 handoff。
- **《A practical guide to building agents》**（PDF 正文无日期，〔二手〕通常记为 2025-04）〔一手，PDF 抽文本〕[PDF](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)：
  - "maximize a single agent's capabilities first"。
  - 工具问题在相似和重叠，不只在数量："Some implementations successfully manage more than 15 well-defined, distinct tools while others struggle with fewer than 10 overlapping tools"。
  - manager 模式 "ideal for workflows where you only want one agent to control workflow execution and have access to the user"。
  - 转人工的两个触发：超过失败阈值；"High-risk actions … sensitive, irreversible"。

**Google ADK v2.13.0**〔一手〕[adk-python](https://github.com/google/adk-python)
- **转移提示**：`flows/llm_flows/extensions/_agent_transfer.py` 生成的系统提示是 "If you are the best to answer the question according to your description, you can answer it. If another agent is better … call `transfer_to_agent` … do not generate any text other than the function call"；子 agent 还会加一句 "If neither you nor the other agents are best … transfer to your parent agent"。
- **防编造**：`TransferToAgentTool` 用 JSON Schema enum 限定可选目标，"prevent LLMs from hallucinating invalid agent names"。
- **三种模式**：`chat`（经 transfer 接管对话）、`task`（和用户聊着完成任务）、`single_turn`（"complete a task without chatting with the user"）。
- **AgentTool 不再推荐**：直接用 `AgentTool` "is discouraged"，推荐把子 agent 设成 `mode='single_turn'` 挂在 `sub_agents` 下，由框架自动暴露成工具。
- **防用户被困**：`disallow_transfer_to_parent=True` 时该 agent 下一轮把控制交回父 agent，"prevents one-way transfer, in which end-user may be stuck with one agent"。
- **代码编排**：v2 有 `workflow/` 图节点（`_graph.py`、`_join_node.py` 等）。

### Inferences
- 〔推理〕灵鲸第二层 = OpenAI 的 manager 模式 / LangGraph supervisor / ADK 父 agent 加 `single_turn` 子 agent：唯一对外、子 agent 不对用户说话。swarm 或 handoff 已被排除（手不对外说话）。所以 LangChain 量到的"转述损失"就是灵鲸要付的代价。现有做法"结构化事实原样传、措辞她生成"对应 `forward_message` 的一半：事实不经她改写。可以再补一条规则：手的产物链接、diff 摘要、数字原样附在回复后，不让总会话复述。
- 〔推理〕AutoGen 的 `candidate_func` / `selector_func`、OpenAI 的"结构化输出分类后代码选"、ADK 的 enum 限定，都是"代码给候选、模型挑"，和灵鲸 R1、R6 同构。业界把这当成标准做法，不是灵鲸独创的保守设计。
- 〔推理〕CrewAI 是唯一在代码里硬性禁止 manager 带工具的主流框架，但它的 hierarchical 恰恰是社区抱怨最多的：派不出去、全派、找不到同事。可见"编排者没工具"本身不保证派得好，派活目标和交接质量还得靠代码给候选、写清交接包。
- 〔推理〕OpenAI handoff 默认把完整历史交给接手者，和灵鲸"第二、三层之间只走事件、不共享上下文"相反。灵鲸要自己承担"交接包写不全"的风险（E4、MAST FM-2.2）。

### Gaps
- AG2 当前的 GroupChat 选人方式和新的 pattern 原语（AutoPattern 等）本次没核实到源码。
- LangChain 基准的具体分数只在图里，正文没有数字；50% 的提升没有按单项拆开。
- Microsoft Agent Framework 1.0 里的 Magentic 编排和 AutoGen 版有什么差异，没读。

## Q5 HuggingGPT、TaskWeaver、MetaGPT：控制器的职责范围（简）

### Takeaway
三者代表三种控制器范围：HuggingGPT 的 LLM 控制器负责规划、选模型、汇总，执行交给专家模型；TaskWeaver 的 Planner 被明确要求"简单步骤自己做、超出能力才派"，用户只能和 Planner 说话；MetaGPT 不用中心派活者，用 SOP 装配线。

### Cited Findings
- **HuggingGPT（2023-03）**〔一手，摘要〕[arXiv 2303.17580](https://arxiv.org/abs/2303.17580)：ChatGPT 当 controller，做 task planning，按 Hugging Face 上的功能描述选模型，"execute each subtask with the selected AI model, and summarize the response"。控制器不执行，只规划、选择、汇总。
- **TaskWeaver Planner 提示（`planner_prompt.yaml` v0.5）**〔一手〕[planner_prompt.yaml](https://github.com/microsoft/TaskWeaver/blob/main/taskweaver/planner/planner_prompt.yaml)：
  - "The User can only talk to the Planner."
  - "Planner should use its skills before considering the involvement of Workers"；"can assign subtasks to Workers when the task requires specific skills beyond the Planner's capabilities, and each subtask should be assigned to only one Worker"。
  - 当前步骤简单时 "use its own skills to complete the task step"。
  - "must thoroughly review Worker's response"。
  - 规划时给依赖分类：顺序依赖可以合并给一个 Worker 一步做完；交互依赖不能合并。
  - 论文〔一手，摘要〕[arXiv 2311.17541](https://arxiv.org/abs/2311.17541)。
- **MetaGPT（2023-08）**〔一手，摘要〕[arXiv 2308.00352](https://arxiv.org/abs/2308.00352)：把 SOP 编进提示序列，"assembly line paradigm to assign diverse roles"，由有领域专长的角色"verify intermediate results"，以减少级联幻觉。

### Inferences
- 〔推理〕TaskWeaver 的"合并顺序依赖的步骤给同一个 Worker"，就是 Anthropic 2026 的"按上下文拆"。灵鲸的想事活如果紧接着要派干活，可以由想事活自己 `dispatch`（它已有这个工具），不必回总会话再派一次。
- 〔推理〕TaskWeaver 让编排者"先自己做"，前提是 Planner 是强模型。灵鲸的总会话是便宜模型，所以"自己做"的范围只能更窄。

### Gaps
- MetaGPT 的共享消息池 / 订阅机制本次只读了摘要，没核实细节。

## Q6 什么时候多 agent 胜过单 agent、编排者的失败模式：2025–2026 实证（含数字）

### Takeaway
2025-12 到 2026-06 的实证一致：多 agent 没有普遍收益。Google 260 组配置里 MAS 相对单 agent 的平均变化是 −0.3%：可并行的任务大赚（+80.8%），顺序约束的任务全线亏（−39% 到 −70%）。单 agent 基线超过约 45% 后，加 agent 收益转负。中心化编排者能把错误放大从 17.2 倍压到 4.4 倍，代价是 285% 的开销。在同等思考 token 下，多跳推理单 agent 不输多 agent。编排者派给谁有明显的同厂商偏好。

### Cited Findings
- **Google Research / DeepMind / MIT《Towards a Science of Scaling Agent Systems》**〔一手〕[arXiv 2512.08296 v3（2026-04-08 修订）](https://arxiv.org/html/2512.08296)；博客〔二手〕[research.google 2026-01-28](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)：
  - **规模**：6 个基准（BrowseComp-Plus、Finance-Agent、PlanCraft、Workbench、SWE-bench Verified 20 题、Terminal-Bench 20 题），3 个模型家族，260 组配置。
  - **中心化结构**：编排者跑 r 轮协调 n 个子 agent，只有编排者和子 agent 之间通信；编排者决定怎么汇总，可以推翻子 agent 的决定，并设终止条件。
  - **收益**：Finance-Agent 中心化 +80.8%（0.631 vs 0.349）。
  - **亏损**：PlanCraft 中心化 −50.3%，独立式 −70.0%，所有变体都退化。SWE-bench −2.1% 到 −14.9%。Terminal-Bench 中心化 −19.2%。MAS 平均 −0.3%（σ = 37.5%）。
  - **能力饱和**：单 agent 准确率超过约 45% 后，多 agent 回报转负（β = −0.236，p = 0.004）。
  - **错误放大（轨迹级）**：独立式 17.2×，去中心化 7.8×，混合 5.1×，中心化 4.4×，单 agent 1.0×。编排者是 "validation bottleneck"。控制变量后这一主效应不显著（p = 0.658）。
  - **开销（相对单 agent）**：中心化 +285%，混合 +515%。
  - **轮数**：单 agent 7.2，中心化 27.7。
  - **每千 token 成功数**：单 agent 67.7，中心化 21.5。
  - **编排者失败模式**：在 PlanCraft 上把单 agent 能直接做完的步骤拆给不同子 agent（不必要的分解）；固定预算下超过 3–4 个 agent 后，每个 agent 的推理 "prohibitively thin"。
  - **预测模型**：对未见配置选对最优架构 87%（随机 20%，只看能力 54%）。
- **Tran & Kiela（Stanford）《Single-Agent LLMs Outperform Multi-Agent Systems on Multi-Hop Reasoning Under Equal Thinking Token Budgets》**〔一手，摘要页〕[arXiv 2604.02460](https://arxiv.org/abs/2604.02460)（v1 2026-04-02，v2 04-11）：
  - 结论：思考 token 对齐后，单 agent 在多跳推理上 "consistently match or outperform" 多 agent。
  - 理由：按数据处理不等式，在上下文被充分利用时单 agent 更 "information-efficient"。只有当单 agent 的上下文利用率退化、或多花算力时，多 agent 才有竞争力。
  - 很多已报告的多 agent 收益来自没计入的算力和基准缺陷。
  - 〔二手〕[beancount.io 笔记](https://beancount.io/bean-labs/research-logs/2026/05/31/single-agent-outperforms-multi-agent-equal-token-budget)：只测纯文本多跳题，不含工具；上下文严重损坏时多 agent 反超。
- **DecisionBench（OpenMesh AI / Stanford / MIT，2026-05-18）**〔一手〕[arXiv 2605.19099](https://arxiv.org/html/2605.19099)：
  - **派对人的准确率（fidelity@1）**：盲选 14.2%；把同事描述预先写进系统提示反而只有 7.5%–20.8%；按需调 `read_profile` 工具查同事档案时 29.5%。
  - **质量**：基本不变（|β| ≤ 0.010）。
  - **派活频率**：GAIA 每题委派 0.41 次（盲选）降到 0.19 次（按需查）；τ-bench 接近 0，作者归因于遵守策略。
  - **同厂商偏好**：DeepSeek-V4-Flash 1.53×，DeepSeek-V4-Pro 1.85×，GPT-5.5 3.65×，Gemini-3-Flash 1.48×；Anthropic 中性；Gemini-3.1-Pro 0.70×。
  - **上限**："全派给最佳同事"的反事实比盲选高 27 个百分点（GAIA 0.407 → 0.675）。
  - **局限**：单种子；池子冻结在 2026-04-29。
- **SearchSwarm（2026-06，v2 08-09）**〔一手，摘要〕[arXiv 2606.09730](https://arxiv.org/abs/2606.09730)：把"何时派、派什么、怎么整合"称为 "delegation intelligence"，指出这类训练数据稀缺。用 harness 约束分解和子 agent 的回报格式，生成 SFT 数据训出 30B-A3B 模型，BrowseComp 68.1、BrowseComp-ZH 73.3。没有公开过度或不足委派的比率。
- **Cursor《Scaling long-running autonomous coding》（2026-01-14，Wilson Lin）**〔一手，经 WebFetch〕[cursor.com/blog/scaling-agents](https://cursor.com/blog/scaling-agents)：
  - 扁平自协调（锁）失败："Twenty agents would slow down to the effective throughput of two or three"。
  - 乐观并发也失败，原因是没有层级时 agent 变得规避风险："No agent took responsibility for hard problems"。
  - 改为 planner（探索代码库、建任务、可开子 planner）、worker（"don't coordinate with other workers or worry about the big picture"）、judge（每轮结束判断是否继续，下一轮从新开始）。
  - 去掉"集成者"角色，因为它 "created more bottlenecks than it solved"。
  - 角色选模型：GPT-5.2 当 planner 比专门写代码的 GPT-5.1-Codex 好；Opus 4.5 "tends to stop earlier and take shortcuts"。
  - 待改进：planner 在任务完成时还不会被叫醒；仍需定期从新开始对抗漂移。
- **MAST**：基本数字见 `papers-architecture` §2.5〔一手，前次〕，本次没重读。

### Inferences
- 〔推理〕灵鲸第二层的大部分工作（闲聊、小判断）属于"单 agent 基线高、顺序依赖强"的一类，按 Google 的结论不该拆。四层方案的"总会话自己聊、自己记内心"符合这一点；派出去的应该只有可并行或需要隔离上下文的事（干活、查资料）。
- 〔推理〕想事活是把"同一段对话的下一步思考"拆给另一个会话，属于 Google 的顺序依赖类和 Tran & Kiela 的多跳推理类，证据对这种拆法不利。它成立的理由只能是"总会话的模型能力不足"（Tran & Kiela 说的上下文利用率或算力不同的情形），不是"多 agent 更好"。所以想事活要拿原始材料（原话编号取原文），不拿总会话的转述，才能少损失信息。
- 〔推理〕DecisionBench 直接关系到灵鲸的选型：总会话用 DeepSeek-V4-Flash，它派活有 1.53 倍的同厂商偏好。灵鲸 R6 让执行者由代码从候选里给，正好绕开这一点；如果以后让总会话自由选执行者，要防它偏爱 DeepSeek。另外"按需查档案"比"预先写进系统提示"派得准，提示灵鲸的 `dispatch` 候选应带可查询的执行者档案，而不是把所有执行者描述塞进稳定前缀。
- 〔推理〕Cursor 的经验和灵鲸一致：worker 之间不互相协调，判断"继续不继续"由单独的角色做，完成要能叫醒 planner（灵鲸用 followup 叫醒总会话）。

### Gaps
- Tran & Kiela 的具体数字（各预算档的分数）没读全文。
- 没找到专门测"编排者过度委派 / 不足委派比率"的论文；DecisionBench 只给了委派频率，没给"该派不派"的标注。
- MAST 之后的失败归因工作（如 Who&When）本次没读。

## Q7 编排者工具集被刻意限制的模式，以及证据是否显示有用

### Takeaway
"编排者不直接动手"是普遍做法：Magentic-One、CrewAI、Anthropic 研究系统、Cursor planner、Super-agent router 都是。但没有一项研究单独对比过"编排者有改世界的工具 vs 没有"。现有证据是间接的：结构化编排（账本、选人规则）比自由群聊强 31%；只靠提示词限制，编排者会自己动手（Claude Code）；工具层面硬限制要配好权限继承，否则会卡住队员（delegate mode 的第三方报告）。限制工具集要配上"代码给候选"和"交接质量"，否则会出现 CrewAI 式的派不出去、全派。

### Cited Findings
- **硬性限制，没有动环境的工具**：
  - Magentic-One 编排者是 GroupChatManager，没有工具；"cannot directly act on the web page"〔一手〕[论文](https://arxiv.org/html/2411.04468)。
  - CrewAI 的 manager 带非委派工具直接抛异常〔一手〕[crew.py](https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/crew.py)。
- **提示词限制**：
  - Anthropic 研究 lead："NOT to conduct primary research yourself"；"All substantial information gathering should be delegated"；但允许"trivial tasks"自己做〔一手〕[lead prompt](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/prompts/research_lead_agent.md)。
  - CrewAI backstory："you don't perform tasks by yourself"〔一手〕。
- **提示词限制会漏**：Claude Code agent teams 官方排障承认 "the lead starts implementing tasks itself instead of waiting for teammates"〔一手〕[agent-teams](https://code.claude.com/docs/en/agent-teams)。
- **工具层面的限制有副作用**：delegate mode 让队员继承受限权限而卡住〔二手〕[scottspence.com](https://scottspence.com/posts/enable-team-mode-in-claude-code)。
- **结构化编排的收益**：账本式编排者比 GroupChat 高 31%（GAIA 验证集）〔一手〕[Magentic-One](https://arxiv.org/html/2411.04468)。中心化编排把错误放大压到 4.4×（独立式 17.2×），但控制变量后不显著〔一手〕[2512.08296](https://arxiv.org/html/2512.08296)。
- **编排者的上下文卫生比工具更关键**：supervisor 去掉 handoff 消息、加原样转发后提升近 50%〔一手〕[LangChain](https://www.langchain.com/blog/benchmarking-multi-agent-architectures)。
- **给编排者"只读的查询工具"有益**：按需 `read_profile` 让派活准确率翻倍、委派次数减半，质量不变〔一手〕[DecisionBench](https://arxiv.org/html/2605.19099)。
- **限制后派不好的反例**：CrewAI hierarchical 的派不出去、全派、"coworker not found"〔二手〕[issue #4783](https://github.com/crewAIInc/crewAI/issues/4783)、[论坛](https://community.crewai.com/t/hierarchical-process-always-delegates-to-all-agents-irrespective-of-the-categorization/3171)。
- **编排者强弱决定上限**：Opus 4.5 级别的编排者已能直接评审子 agent 的工作〔一手〕[claude.com 2026-01](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)。小模型当主控 "质量上限由主控决定"〔一手，前次 E5〕。

### Inferences
- 〔推理〕灵鲸 R2（没有那种工具就只能派）有业界先例，而且比 Claude Code 的提示词限制更硬。但证据提醒三件事：
  1. 限制改世界的工具，不等于限制只读查询。DecisionBench 和 Magentic-One 的事实表都说明，编排者能"查"会派得更好。`look` / `recall` 这类只读工具值得早点给总会话。
  2. 派活目标由代码给（R6），避免 CrewAI 式乱派。
  3. 总会话的权限不能被手继承。灵鲸的手由 guard 单独授权，已经满足。
- 〔推理〕没有任何证据支持"把权衡、决定也从编排者手里拿走"。各家编排者都自己保留综合和决定（Anthropic 写最终报告、Magentic-One 重规划、TaskWeaver 先自己推理）。灵鲸 R5 是因为总会话用便宜模型才不得不这么做的结构选择，应如实标为"没有外部先例、待 M4 评测验证"。

### Gaps
- 没有找到对比"编排者有工具 vs 无工具"的受控实验。
- delegate mode 的官方说明和下线原因不明。

## Q8 综合：这些证据对灵鲸第二层"自己干还是派"的规则意味着什么

### Takeaway
灵鲸第二层的骨架和业界主流的 supervisor / manager 模式一致：唯一对外、代码缩小候选、编排者不动手。有外部先例支撑的是 R1、R2、R4、R6。R5（权衡、决定外移）与主流相反，只能靠"便宜模型能力不足"来论证，并要承担按顺序拆分的信息损失。最该补的四件事：原样转发事实、给只读查询工具、借用进度账本式巡查、带数字的派活分档。

### Cited Findings
- 唯一对外的 manager 模式适合"only want one agent to control workflow execution and have access to the user"〔一手〕[OpenAI guide](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)。
- supervisor 的主要损失在转述，原样转发能补回〔一手〕[LangChain](https://www.langchain.com/blog/benchmarking-multi-agent-architectures)。
- 同一件事的顺序阶段是坏边界〔一手〕[claude.com 2026-01](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)。顺序约束任务多 agent 全线退化〔一手〕[2512.08296](https://arxiv.org/html/2512.08296)。同等思考预算下单 agent 不输〔一手〕[2604.02460](https://arxiv.org/abs/2604.02460)。
- 进度账本五问和卡住计数〔一手〕[Magentic-One prompts](https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_prompts.py)。
- 带数字的派活分档、"简单事自己做"〔一手〕[lead prompt](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/prompts/research_lead_agent.md)。
- 同步等待是瓶颈；agent teams 用自动投递加完成通知〔一手〕[Anthropic 2025](https://www.anthropic.com/engineering/multi-agent-research-system)、[agent-teams](https://code.claude.com/docs/en/agent-teams)。Cursor 把"完成时叫醒 planner"列为待改进〔一手〕[Cursor](https://cursor.com/blog/scaling-agents)。

### Inferences
1. 〔推理〕**响应性设计（R4）有充分佐证**。Anthropic 承认同步等待会卡住整个系统；agent teams 和 Cursor 都朝"完成即事件、自动叫醒"走。灵鲸"总会话无 wait、结果以 followup 事件回来"是对的。
2. 〔推理〕**把"原样转发"写成规则**。手的 `report` 和想事活的 `conclude` 里，事实栏（数字、链接、文件名、结论句）由 outbox 原样附在回复里，总会话只加口吻。这直接对应 LangChain 的 `forward_message`，能减少转述错误。
3. 〔推理〕**R5 要标为风险项，并在 M4 评测里加一组对照**：同一批"帮我想想"类问题，比较（a）总会话直接答、（b）`ponder` 想事活、（c）总会话加一次强模型 advisor 调用（只给建议，不动作，E7 / E5 形态）。Tran & Kiela 和 Google 的结果都暗示，（c）这种"共享完整上下文、只借脑子"可能比（b）更好：没有交接损失，又补上了便宜模型的能力。（c）和"决定类工具只在想事活里"不冲突，因为 advisor 不持有工具。
4. 〔推理〕**给总会话只读查询工具（`look` 档案、活的状态、执行者档案）**，从"后期"提前。DecisionBench 显示按需查询比塞进提示词派得准、派得少；它不改世界，不违反 R2。
5. 〔推理〕**派活规则用 cookbook 式带数字的分档**：什么当场答（例子 3–5 个），什么 `ponder`（例子 3–5 个），什么 `dispatch`。再给一条反向约束："不要为一句话能答的事派活"，对应 Anthropic 早期"简单题派 50 个子 agent"和 Google 的"不必要的分解"。
6. 〔推理〕**巡查用 Magentic-One 五问**。V1 的代码看门狗之外，若以后加模型巡查，就用"完成了吗 / 在绕圈吗 / 有进展吗 / 下一步给谁 / 给什么指令"、严格 JSON、卡住计数 2–3 次后转一件想事活重规划。重规划时要求先写根因，并重开相关的手（Magentic-One 清空干活者上下文的做法）。
7. 〔推理〕**验证别交给便宜的总会话**。Magentic-One 的第二大失败是验证不足，Anthropic 说验证者会 early victory。灵鲸已让 tasks 的代码核验在待验收之前（§2.2），质量评审若要模型做，应放在第三层，用强模型、给明确的负面测试，不由总会话判断"做得好不好"。
8. 〔推理〕**成本口径**：Google 的中心化编排相对单 agent 开销 +285%（论文口径，覆盖 6 个基准），每千 token 成功数从 67.7 降到 21.5；Anthropic 2026 给 3–10 倍 token。灵鲸的总量由"派活次数 × 每件活的上下文"决定，所以派活分档和同议题去重是主要的成本闸门。这与 `four-layers.md` §5 的估算思路一致。

### Gaps
- 没有任何公开评测覆盖"陪伴 / 人设型 agent 的编排者"。上面的证据全部来自研究、编码、客服、谜题类任务，迁移到"她"的聊天场景是推断。
- "便宜编排者加强模型想事活"和"便宜编排者加强模型 advisor"的对比，没找到外部数据，只能靠 M4 自测。
