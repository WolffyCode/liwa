# 产品里写死的派活规则：主 agent 何时自己做、何时派出去

调研日期 2026-11-01。标记：〔一手〕自己读过源码、二进制里的提示词或官方页面；〔二手〕博客、新闻、泄露或收集的提示词、他人转述、搜索摘要；〔推理〕自己推的。英文原文照录，后附中文意思。克隆在 `scratchpad/layer2-clones/<repo>`（只读，blobless 浅克隆，用 `git show HEAD:<path>` 读），下文写"仓库@提交"。OpenClaw、Paseo 已有专文，本篇不重复。

版本一览（都是 2026-11-01 拿到的 HEAD）：

| 产品 | 版本 / 提交 | 读法 |
| --- | --- | --- |
| Claude Code | npm `@anthropic-ai/claude-code` 2.1.303（本机已装） | 二进制 `bin/claude.exe` 里的字符串；本会话实际注入的 Agent 工具描述 |
| Roo Code | `RooCodeInc/Roo-Code@b867ec9`（2026-05-15，扩展 v3.53.0） | 源码 |
| Kilo Code | `Kilo-Org/kilocode@dd35e09`（2026-10-31） | 源码 |
| Cline | `cline/cline@a6507a6`（2026-10-30） | 源码 + 仓库内文档 |
| OpenHands | `OpenHands/software-agent-sdk@9884945`（2026-11-01）；主仓库 `@172d7f1` | 源码 |
| Aider | `Aider-AI/aider` HEAD（raw） | 源码 + 官方博客 |
| Goose | `block/goose@b23d21c`（2026-10-31） | 源码 + 仓库内文档 |
| Gemini CLI | `google-gemini/gemini-cli@6814e00`（2026-10-30，0.67.0-nightly） | 源码 + 仓库内文档 |
| Codex CLI | `openai/codex@a098129`（2026-11-01） | 源码 |
| Hermes Agent | `NousResearch/hermes-agent@557254f`（2026-11-01） | 源码 |
| OpenCode | `sst/opencode@271f5ef`（2026-11-01） | 源码 |
| DeepSeek Super-agent | `6337fc8`（2026-10-31，本地已克隆） | 源码 |
| Manus、Devin、Kimi、Cursor、Grok、Amp、Anthropic 研究系统 | 官方页面 / 博客 | 由一个子 agent 读网页（标记沿用它的判断，我核对过引文的出处链接） |

---

## Q1 Claude Code：Agent（原 Task）工具、内置子 agent、后台任务、coordinator 模式

### Takeaway
默认形态是"主 agent 全工具 + 可选派活"：派活规则只为保持上下文干净和并行，不靠收工具来划界。子 agent 默认后台跑，结果在后续回合作为 user 角色的通知回来；为了让用户能插话，Bash 前台命令也会被挪到后台。二进制里另有一个 **coordinator 模式**（环境变量 `CLAUDE_CODE_COORDINATOR_MODE`）：主 agent 只派活、综合、和用户说话，Bash 只能跑只读命令，形态和灵鲸的总会话最接近。

### Cited Findings
**主 agent 的派活规则**（Agent 工具描述）
- 什么时候自己来〔一手，2.1.303 二进制〕："If the target is already known, use the direct tool: Read for a known path, … for a specific symbol or string. Reserve this tool for open-ended questions that span the codebase, or tasks that match an available agent type."（目标已知就直接用工具；派活只留给跨代码库的开放问题，或正好对上某个 agent 类型的任务。）
- 本会话注入的描述里还有一句〔一手〕："For a single-fact lookup where you already know the file, symbol, or value, search directly. And once you've delegated a search, wait for the result to return rather than also running it yourself."（已知位置的单点查询自己查；派出去的搜索不要自己再跑一遍。）
- 同一段列了派活的利弊〔一手〕：好处是并行，和"stay focused on the primary task"（保持专注主任务）；坏处是子 agent "only have the context that you give them"（只有你给的上下文），且"you have less observability"（你看不到它在做什么）。
- 前台还是后台〔一手，二进制〕："Pass `run_in_background: false` only when your very next action depends on the agent's result and nothing else could usefully happen while it runs … Otherwise let it run in the background (the default) — this includes … anything where the user might hand you something else in the meantime. Wanting the result "next" is not enough on its own."（只有下一步就要用结果、等的时候也没别的可做，才前台跑；否则一律后台，包括"用户可能这时又交给你别的事"的情况；"想马上拿到结果"本身不构成理由。）
- 精简版提示里写得更直白〔一手〕："otherwise background it so the user can interject"（否则放后台，好让用户插话）。
- 不许编造结果〔一手〕："**Don't race**: after launching a background agent, you know nothing about its results. Never fabricate or predict them … If the user asks before it lands, say the agent is still running — give status, not a guess."（派出去就什么都不知道；用户问起只报状态，不猜。）
- 不许把理解推给子 agent〔一手〕："**Never delegate understanding.** Don't write "based on your findings, fix the bug"…"（不要写"根据你的发现去修"，综合必须自己做。）
- 子 agent 的汇报只是自述〔一手〕："Trust but verify: an agent's summary describes what it intended to do, not necessarily what it did."（总结写的是它打算做什么，不一定是真做了什么。）
- 写文件的 agent 撞车时的提示〔一手〕："another write-capable agent is already running in this same working directory … dispatch each with isolation: "worktree"."（同目录已有能写文件的 agent 在跑时，并行写代码的各开一个 worktree。）
- 按订阅档位改默认〔一手，`gr()==="pro"` 分支〕："**Do not spawn agents unless the user asks.** Each spawn starts cold and re-derives context you already have — it's the expensive path on this plan. A task with "multiple angles," "thorough," or several parts is not a request to spawn"（Pro 档：用户不要求就不派；"多角度""彻底""分几部分"都不算要求派。）
- fork 的判据〔一手〕："The criterion is qualitative — "will I need this output again" — not task size."（看"这些中间输出我以后还要不要"，不看任务大小。）

**内置子 agent 与禁用的工具**〔一手，二进制里的 agent 定义〕
- `Explore`：`disallowedTools` 去掉 Agent、Edit、Write、NotebookEdit 等，`omitClaudeMd: true`。提示词写"=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ==="，列出禁止的 Bash 命令（mkdir、rm、git commit、npm install…）。whenToUse 写"Do NOT use it for code review, design-doc auditing, cross-file consistency checks, or open-ended analysis — it reads excerpts rather than whole files"（不要拿它做评审、审设计文档、跨文件一致性检查或开放式分析，它只读片段）。
- `Plan`：同一套禁用工具，只读；结尾必须列"Critical Files for Implementation"（实现最关键的文件）。
- `general-purpose`：全工具。提示词里有"You are already the dedicated agent for this task. Do the work directly — do not re-delegate your entire assignment to another single subagent."（你就是被派来干这件事的，直接做，别把整件事再转派给另一个子 agent。）
- 嵌套限制〔一手〕："In-process teammates cannot spawn background agents."（进程内的队友不能再开后台 agent。）

**后台任务，以及主循环怎么保持能接话**〔一手，二进制〕
- Bash 自动转后台，提示文案三种："Command was moved to the background (ID: …) so that a message that arrived while it was running can reach you; it was not interrupted."（为了让运行期间到达的消息能送到你，命令被挪到后台，没有中断）；"Command did not complete within its Ns timeout and was moved to the background"（超时转后台）；以及用户手动转后台。环境变量 `CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS`。
- 完成通知："You will be notified when it completes — do not poll that file or sleep while waiting."（完成会通知你，不要轮询、不要 sleep。）
- Bash 工具规则："If waiting for a background task you started with `run_in_background`, you will be notified when it completes — do not poll."

**coordinator 模式**〔一手，二进制；是否写进对外文档未查到〕
- 角色定义："You are a **coordinator**. Your job is to: Help the user achieve their goal; Direct workers to research, implement and verify code changes; Synthesize results and communicate with the user; Answer questions directly when possible — don't delegate work that you can handle without tools"（帮用户达成目标；指挥 worker 调研、实现、验证；综合结果并和用户沟通；不用工具就能答的直接答，别派。）
- 工具：Agent（开 worker）、SendMessage（续接 worker）、TaskStop（停 worker）、subscribe_pr_activity；Bash 只读（字符串"coordinator Bash read-only check""is not on the read-only list"）；"in the coordinator does not read a worker's transcript or a task's output file"（coordinator 不读 worker 的记录和输出文件）。
- 派活规则："Do not use one worker to check on another. Workers will notify you when they are done."（别用一个 worker 去查另一个）；"Do not use workers to trivially report file contents or run commands. Give them higher-level tasks."（别拿 worker 读文件、跑命令，要给更高层的任务）；"After launching agents, briefly tell the user what you launched and end your response."（派完简短告诉用户派了什么，就结束本回合。）
- 结果怎么回来："Worker results arrive as **user-role messages** containing `<task-notification>` XML … They are not the user speaking … Worker results and system notifications are internal signals, not conversation partners — never thank or acknowledge them."（worker 结果是带 `<task-notification>` 的 user 角色消息，不是用户在说话；是内部信号，不要道谢、不要回应。）格式：`<task-id>`、`<status>completed|failed|killed|blocked</status>`、`<summary>`、`<result>`、`<usage>`（token、工具次数、耗时）。
- 阶段表："Research | Workers (parallel) … Synthesis | **You** (coordinator) … Implementation | Workers … Verification | Workers"（调研、实现、验证给 worker，综合由 coordinator 自己做。）
- 并行原则："don't parallelize simple tasks: a question or small task that takes a handful of tool calls is faster done in a single loop (one worker) than fanned out."（简单任务别铺开）；"Read-only tasks (research) — run in parallel freely; Write-heavy tasks (implementation) — one at a time per set of files"（只读随便并行，写的按文件集一次一个。）
- "Always synthesize — your most important job"（综合是最重要的职责）；续接还是新开按上下文重叠程度定："Verifying code a different worker just wrote | Spawn fresh | Verifier should see the code with fresh eyes"（验证别人刚写的代码要新开，让验证者不带实现时的假设。）
- 用户批准要原样转交："When the user has approved a specific action, quote their exact words in the worker's prompt. The worker's auto-mode check sees only the worker's own transcript"（用户批准过的动作，把原话写进 worker 的提示词；worker 的权限检查只看它自己的记录。）
- 不许偷降模型："never downshift work to a weaker model on your own initiative"（不许自己给 worker 换弱模型。）
- 一个"仅经通讯工具说话"的变体："Your bare assistant text does NOT reach the user. Your comms tools are the only channel to them: every turn must end in a comms-tool call (reply, react, or an explicit no-reply)"（裸文字到不了用户；通讯工具是唯一渠道；每回合必须以 reply、react 或显式 no-reply 结束。）

**官方文档与博客**
- 官方子 agent 页 code.claude.com 被代理拒绝。子 agent 读了镜像 `ericbuess/claude-code-docs` 的 `docs/sub-agents.md`（2026-10-30 更新）〔二手〕：
  - 留在主对话："The task needs frequent back-and-forth or iterative refinement / Multiple phases share significant context / a quick, targeted change / Latency matters"（要反复来回、几个阶段共享大量上下文、改动小而准、在意延迟。）
  - 用子 agent："verbose output you don't need in your main context / enforce specific tool restrictions or permissions / self-contained and can return a summary"（输出冗长且主上下文用不上、要强制工具限制、任务自成一体能交回摘要。）
  - "a subagent that Claude spawns from your main conversation starts in the background"（主对话开的子 agent 默认后台）；后台子 agent 的权限请求出现在主会话。
- 官方博客 "How and when to use subagents in Claude Code"（2026-04-07）〔一手，https://claude.com/blog/how-and-when-to-use-subagents-in-claude-code〕："For a quick fix or a focused question, the overhead of delegation outweighs the benefit."（小修小问，派活开销大于收益）；"Two subagents editing the same file in parallel is a recipe for conflict."（两个子 agent 并行改同一文件必冲突）；"Subagents report back to the main conversation but can't talk to one another."（子 agent 只向主对话汇报，彼此不通。）

### Inferences
- 〔推理〕Claude Code 有两套派活哲学：默认模式"能自己做就自己做，派活为了上下文和并行"；coordinator 模式"主 agent 不干活，只综合和沟通"。灵鲸的总会话属于后者，coordinator 的几条规则可以直接借：别拿 worker 读文件；派完一句话告诉用户就结束回合；通知是内部信号不是对话对象；用户批准原话转交；只有通讯工具能对外。
- 〔推理〕"每回合必须以 reply / react / 显式 no-reply 结束"把"不说话"也变成一次工具调用，正好能补灵鲸 R10 兜底的盲区：现在只能检测"既没回复也没派活"，有了显式 no-reply，沉默就成了可记录、可审计的决定。

### Gaps
- code.claude.com 的官方文档读不到，Explore 的模型档位、后台子 agent 的工具缩减清单只有镜像的二手说法。
- coordinator 模式的启用条件、是否面向公众，没有公开文档可查。

---

## Q2 Roo Code 的 Orchestrator（Boomerang）与 Kilo Code 的对应物

### Takeaway
已确认：Roo 的 Orchestrator 模式 `groups: []`，没有读、写、命令、浏览器、MCP 中任何一组工具，只剩"永远可用"的几个控制工具（new_task、attempt_completion、ask_followup_question 等）。子任务运行期间父任务被**关掉**，用户直接和子任务对话；子任务 attempt_completion 后（用户批准）父任务重开，拿到一条 tool_result "Subtask … completed. Result: …"。Kilo 把它重写为 opencode 风格的 orchestrator agent，权限 `"*": "deny"`，强制禁 bash，但能读、能搜网页；现在已**标为弃用**，理由是全工具 agent 自己就能开子 agent。Roo 仓库 2026-05-15 之后没有新提交。

### Cited Findings
**Roo Code**（`Roo-Code@b867ec9`）
- 角色定义〔一手，`packages/types/src/mode.ts`〕："You are Roo, a strategic workflow orchestrator who coordinates complex tasks by delegating them to appropriate specialized modes."
- whenToUse："Use this mode for complex, multi-step projects that require coordination across different specialties."
- 工具组 `groups: []`。对照：`architect` 是 read、edit（仅 `\.md$`）、mcp；`code` 是 read、edit、command、mcp；`ask` 是 read、mcp。
- 永远可用的工具〔一手，`src/shared/tools.ts`〕：`ALWAYS_AVAILABLE_TOOLS = ["ask_followup_question","attempt_completion","switch_mode","new_task","update_todo_list","run_slash_command","skill"]`。所以 Orchestrator 连读文件都不行。
- customInstructions 的派活要求〔一手，同文件〕：
  - "For each subtask, use the `new_task` tool to delegate. … These instructions must include: All necessary context from the parent task or previous subtasks … A clearly defined scope … An explicit statement that the subtask should *only* perform the work outlined … An instruction for the subtask to signal completion by using the `attempt_completion` tool, providing a concise yet thorough summary of the outcome in the `result` parameter, keeping in mind that this summary will be the source of truth used to keep track of what was completed on this project. … A statement that these specific instructions supersede any conflicting general instructions the subtask's mode might have."（每个子任务用 new_task 派；指令必须带全部上下文、明确范围、"只做这些"的声明、要求用 attempt_completion 交摘要，摘要是项目进度的唯一依据；并声明本指令优先于子模式的通用指令。）
  - "Ask clarifying questions when necessary"；"If a request significantly shifts focus or requires a different expertise (mode), consider creating a subtask rather than overloading the current one."（话题明显转向或需要别的专长时，开子任务，别压在当前任务上。）
- new_task 工具描述〔一手，`src/core/prompts/tools/native-tools/new_task.ts`〕："Create a new task instance in the chosen mode … CRITICAL: This tool MUST be called alone. Do NOT call this tool alongside other tools in the same message turn."（必须单独调用，不能和别的工具同批。）
- 父任务的去留〔一手，`src/core/tools/NewTaskTool.ts`〕：注释"Delegate parent and open child as sole active task"，工具结果是"Delegated to child task ${child.taskId}"，"(no pause/unpause, no wait)"。
- 结果怎么回来〔一手，`AttemptCompletionTool.ts`、`src/core/webview/ClineProvider.ts`〕：子任务 attempt_completion 先问用户 "askFinishSubTaskApproval"，批准后 `reopenParentFromDelegation`，往父任务历史里写 tool_result："Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}"。

**Kilo Code**（`kilocode@dd35e09`，已改为基于 opencode 的 CLI 与扩展）
- orchestrator 的提示词〔一手，`packages/opencode/src/agent/prompt/orchestrator.txt`〕：
  - "Understand the task first. Use explore agents to research the codebase"（先让 explore agent 调研）
  - "Classify dependencies before executing anything … If two subtasks are likely to edit the same files, they MUST be in different waves … When uncertain about dependencies or file overlap, run subtasks sequentially."（先分依赖；可能改同一文件的必须分在不同批次；拿不准就串行。）
  - "Execute wave by wave. Launch all subtasks in a wave as parallel tool calls in a single message. Wait for the wave to complete"（按批执行，一批并行，等这批完再下一批。）
  - "Do not edit files directly. Delegate all implementation to agents."（不直接改文件，实现全部派出去。）
- 权限〔一手，`packages/opencode/src/kilocode/agent/index.ts`〕：`"*": "deny"`，放行 read、grep、glob、list、question、skill、suggest、task、todoread、todowrite、webfetch、websearch；随后"// Enforce bash deny after user so user config cannot re-enable shell"，`bash: "deny"`（在用户配置之后再禁一次 bash，用户配置开不回来）；`deprecated: true`。
- 弃用说明〔一手，`packages/kilo-docs/pages/code-with-ai/agents/orchestrator-mode.md`〕："Orchestrator mode is deprecated … agents with full tool access (Code, Plan, Debug) can now delegate to subagents automatically. … (Read-only agents like Ask do not support delegation.)"（全工具 agent 能自动派子 agent 了；只读的 Ask 不能派。）同页："A foreground task returns its result before the parent continues. A background task lets the parent continue immediately and delivers its result later."（前台任务先交结果父任务才继续；后台任务父任务立即继续，结果稍后送达。）另有 "Kilo Swarm"：主会话与后代任务在共享看板上交换发现，默认开启。
- Kilo 的 task 工具描述〔一手，`packages/opencode/src/tool/task.txt`〕："When NOT to use the Task tool: If you want to read a specific file path, use the Read or Glob tool … If you are searching for a specific class definition like "class Foo", use the Grep tool … If you are searching for code within a specific file or set of 2-3 files, use the Read tool"（读指定文件、找具体类定义、在两三个文件里找代码，都不要派）；"Once you have delegated work to an agent, do not duplicate that work yourself."（派出去的不要自己重做）；"The agent's outputs should generally be trusted"（子 agent 的输出一般应信任。）

### Inferences
- 〔推理〕Roo 的 Orchestrator 是"纯派活者"最彻底的写法：连读都不给。但它在 VS Code 单任务栈里实现，派出去以后父任务被关，用户只能和子任务说话，**主 agent 不常驻、不可插话**，和灵鲸"总会话常驻、随时接主人的话"正相反，只能借它的交接包要求（全上下文、范围、只做这些、完成摘要是唯一事实来源、本指令优先）。
- 〔推理〕Kilo 弃用 orchestrator、Roo 停更，说明在编码工具里，"用户手选的、无工具编排模式"输给了"全工具 agent + 子 agent"。原因是编码场景里主 agent 自己动手最快（见 Q7 Gemini 的"surgical tasks"）。灵鲸要无工具总会话的理由是人设、单一口径、成本和随时接话，不是编码效率，这条趋势不构成反证，但提醒：总会话一旦需要"看一眼"，就得有只读的 `look` 一类工具，Kilo 的 orchestrator 也保留了 read、grep 和网页搜索。

### Gaps
- Roo 停更的原因没有查到官方说明。
- Kilo Swarm 共享看板的提示词没有细读。

---

## Q3 Cline

### Takeaway
Cline 现在的子 agent 工具叫 `spawn_agent`，只在 CLI 和 Desktop 里有，VS Code、JetBrains 扩展不用。主 agent **同步等**子 agent 完成。子 agent 按当前模式拿内置工具，可以再开子 agent，没有 MCP。批准一次 spawn 就等于批准它之后的全部动作。

### Cited Findings
- 工具描述〔一手，`cline@a6507a6` `sdk/packages/core/src/extensions/tools/team/spawn-agent-tool.ts`〕："Spawn a sub-agent with custom instructions for a specialized task. Waits for the sub-agent to finish and returns its result before your next step."；参数只有 `systemPrompt`（"System prompt defining the sub-agent's behavior"）和 `task`。
- 文档〔一手，`docs/features/subagents.mdx`〕：
  - "Subagents are available in the Cline CLI and Cline Desktop. The VS Code and JetBrains extensions don't use them."
  - "In Plan mode it has no tools for editing files, and Cline refuses shell commands that usually change files, such as `rm` and `git commit`. Other commands still run, and some of them, such as `python -c`, can write files. A subagent can start subagents of its own. It doesn't get MCP tools."（Plan 模式下没有改文件的工具，常见的改文件命令被拒，但有些命令仍能写文件；子 agent 能再开子 agent；没有 MCP。）
  - "The main agent waits for its subagents, then continues."（主 agent 等子 agent 完再继续。）
  - "Approving the `spawn_agent` call approves everything the subagent then does"（批准 spawn 即批准它的一切后续动作。）
  - "Cline decides when a task is worth splitting."；"For small, focused tasks where you already know which files to look at, subagents add unnecessary overhead."（Cline 自己判断何时拆；已知看哪些文件的小任务，用子 agent 是多余开销。）
- 搜索摘要说 Cline 子 agent "read-only … cannot edit files"〔二手，docs.cline.bot 摘要〕；与仓库内现行文档（Act 模式可写）冲突，以仓库为准〔一手〕。

### Inferences
- 〔推理〕Cline 的设计不触及主 agent 的响应性：主 agent 同步阻塞。对灵鲸只有一条参考价值：模式（Plan / Act）决定子 agent 的工具档，相当于灵鲸"活的种类 × 工具档"的雏形。

### Gaps
- 子 agent 的并发上限、超时没有在文档里找到。

---

## Q4 OpenHands（AgentDelegateAction、微 agent、新 SDK 的 Task 工具）

### Takeaway
OpenHands 主仓库已经变成前端（Electron / React），老的 Python `AgentDelegateAction`（CodeActAgent 委派给 BrowsingAgent 等）不在主仓库里了。现在的 agent 逻辑在 `software-agent-sdk`，子 agent 走 `TaskToolSet`，**默认关闭**（`enable_sub_agents=False`），执行是**阻塞**的。

### Cited Findings
- 主仓库 `OpenHands@172d7f1` 的顶层是 `electron/`、`src/`、`vite.config.ts` 等，`grep AgentDelegateAction` 无结果〔一手〕。
- Task 工具描述〔一手，`software-agent-sdk@9884945` `openhands-tools/openhands/tools/task/definition.py`〕：
  - "Subagents … are your primary tool for understanding codebases and running tests, but each delegation has overhead — use them when the task genuinely benefits from a separate agent, not for simple lookups."（子 agent 是理解代码库和跑测试的主要手段，但每次委派都有开销，只在真有好处时用，简单查询别用。）
  - "When NOT to use the task tool: A single grep, find, or cat command would answer your question — just run it yourself; You are making a file edit (use file_editor directly); You already have the context needed"（一条 grep / find / cat 能答的自己跑；改文件自己改；上下文已够就不派。）
  - "The agent's results are authoritative — verify subagent results only when the task involves judgment or interpretation."（子 agent 结果视为权威，只有涉及判断或解读时才核验。）
- 执行方式〔一手，`task/manager.py`〕：`start_task` 的文档字符串是 "Start a blocking sub-agent task."
- 默认开关〔一手，`preset/default.py`〕：`get_default_tools(enable_browser=True, enable_sub_agents=False)`，默认工具是 Terminal、FileEditor、TaskTracker（+ Browser）。
- 内置子 agent〔一手，`preset/subagents/*.md`〕：`code-explorer`（"USE THIS when you need to understand unfamiliar code before making changes"，只用 terminal 且"never create, modify, or delete files"）；`bash-runner`（"Returns only what matters: pass/fail counts, specific failures with reasons … never raw output"，只交要点，不交原始输出）；`web_researcher`；`default`。
- 另有 `DelegateAction`（`spawn` / `delegate` 两个命令，`tasks: dict[str,str]` 把多个子 agent id 映射到任务）〔一手，`delegate/definition.py`〕；工具描述没有使用时机的规则。

### Inferences
- 〔推理〕OpenHands 属于"全工具主 agent、子 agent 可选"的一派，和 Claude Code 默认模式同构；它的"bash-runner 只交要点不交原始输出"可借给灵鲸第三层的汇报格式。

### Gaps
- 老 OpenHands（V0）里 `AgentDelegateAction` 与微 agent 委派的原文已不在当前仓库，没有去翻历史提交，未核实。

---

## Q5 Aider 的 architect / editor 模式

### Takeaway
一次请求两次推理：architect 模型（强）只描述怎么改，不输出完整文件；editor 模型（可以便宜）把描述变成格式化编辑。交接方式是把 architect 的整段回复当成 editor 的用户消息，中间可要求用户确认"Edit the files?"。这不是"派活"，而是同一回合的串行流水线；主 agent 不常驻。

### Cited Findings
- architect 提示词〔一手，`aider/coders/architect_prompts.py`〕："Act as an expert architect engineer and provide direction to your editor engineer. … The editor engineer will rely solely on your instructions, so make them unambiguous and complete. … DO NOT show the entire updated function/file/etc!"（你是架构师，给编辑工程师指示；他只依赖你的指示，所以要无歧义、完整；不要贴整个函数或文件。）
- 交接〔一手，`aider/coders/architect_coder.py`〕：architect 回复完 → `if not self.auto_accept_architect and not self.io.confirm_ask("Edit the files?"): return` → 用 `editor_model`（没配就用主模型）新建 coder，`editor_coder.cur_messages = []`、`done_messages = []`（editor 不继承历史），`map_tokens = 0`（不带仓库地图）→ `editor_coder.run(with_message=content)` → 回到 architect，追加"I made those changes to the files."
- 数据〔一手，https://aider.chat/2024/09/26/architect.html，2024-09-26〕："Using o1-preview as the Architect with either DeepSeek or o1-mini as the Editor produced the SOTA score of 85%."；o1-preview 单独 79.7%；o1-preview + Claude 3.5 Sonnet（diff 格式）82.7%。理由："They are strong at reasoning, but often fail to output properly formatted code editing instructions"（推理强的模型常输出不了格式正确的编辑指令。）

### Inferences
- 〔推理〕Aider 的分工方向和灵鲸相反：强模型想、弱模型动手。灵鲸是弱模型接话、强模型在第三层想。共同点是**交接只传结论文本，执行方不继承对话历史**；Aider 的数据说明"想"和"做"拆开后，执行方用便宜模型也不掉分。

### Gaps
- 2024 年之后 Aider 有没有更新 architect 模式的评测数据，没查到。

---

## Q6 Goose（subagents / summon 扩展的 delegate 工具）

### Takeaway
Goose 的 `delegate` 工具由默认开启的 `summon` 平台扩展提供。在自主权限模式（默认）下，主 agent 自己决定何时开子 agent；手动批准、智能批准、仅聊天三种模式下子 agent 被禁用。默认串行，提示词里出现"并行"一类字眼才并行。最多 5 个并发，默认超时 5 分钟。

### Cited Findings
- delegate 工具描述〔一手，`goose@b23d21c` `crates/goose/src/agents/platform_extensions/summon.rs`〕："Delegate a task to a subagent that runs independently with its own context. … Effective Delegation: Delegates know only instructions + source content; Delegates cannot coordinate. Same-file work = conflicts.; You get a delegate's result back once it finishes. Research (read-only): delegates explore and report back. Work (writes): partition files strictly - no two delegates touch the same file."（子 agent 只知道指令和来源内容；子 agent 之间不能协调，改同一文件必冲突；完成才拿到结果；调研只读，写的严格按文件分区。）
- 何时调用具名子 agent〔一手，同文件〕："`@<name>` in the user's message — always call that subagent. The user mentions a subagent by name without `@` — infer from context … The user's request strongly matches a subagent's description — call it."（用户 @ 了就调；提到名字就按上下文推断；请求和描述强匹配就调。）
- 文档〔一手，`documentation/docs/guides/context-engineering/subagents.mdx`〕："goose can autonomously decide to use subagents … This happens automatically in autonomous permission mode (the default). Subagents are disabled in manual approval, smart approval, and chat-only modes."；串行 / 并行表：Sequential (Default)，Parallel 由"parallel", "simultaneously", "at the same time", "concurrently" 触发；"If a subagent fails or times out (5-minute default), you will receive no output from that subagent."（失败或超时什么都拿不到）；默认值：最大并发 5（`GOOSE_MAX_CONCURRENT_SUBAGENTS`），最大轮数 1000，超时 5 分钟；"By default, subagents inherit all extensions from your main session"（默认继承主会话全部扩展。）

### Inferences
- 〔推理〕"权限模式决定能不能派"是一条结构规则：Goose 把"子 agent 自己的动作不会再问用户"和"只在自主模式开放派活"绑在一起。灵鲸的手要权限时直推主人、总会话不代批，比 Goose 更细。

### Gaps
- 子 agent 能否再派子 agent，文档没写明。

---

## Q7 Gemini CLI（子 agent、背景完成注入、用户 steering）

### Takeaway
Gemini CLI 的系统提示把主 agent 定位为"strategic orchestrator"，**强制**按专长派活，还给了具体阈值："涉及 3 个以上文件或重复步骤""大量输出""试错型调研"派出去，"1–2 轮能解决的外科式任务"自己做。子 agent 不能再调子 agent。另有注入服务，把用户中途的 steering 和后台执行的完成结果注入到正在跑的会话里。

### Cited Findings
- 系统提示片段〔一手，`gemini-cli@6814e00` `packages/core/src/prompts/snippets.ts`〕：
  - "You MUST delegate tasks to the sub-agent with the most relevant expertise."（必须把任务派给专长最对口的子 agent。）
  - "Operate as a **strategic orchestrator**. Your own context window is your most precious resource. … use sub-agents to "compress" complex or repetitive work. When you delegate, the sub-agent's entire execution is consolidated into a single summary in your history"（把自己当战略编排者；自己的上下文窗口最宝贵；用子 agent"压缩"复杂或重复的工作；子 agent 的整个执行在你的历史里只剩一条摘要。）
  - "**Concurrency Safety and Mandate:** You should NEVER run multiple subagents in a single turn if their abilities mutate the same files or resources."（会改同一文件或资源的子 agent 绝不能同一轮并跑。）
  - "**High-Impact Delegation Candidates:** Repetitive Batch Tasks: Tasks involving more than 3 files or repeated steps … High-Volume Output … Speculative Research: Investigations that require many "trial and error" steps"（最值得派的：超过 3 个文件或重复步骤的批量任务、大量输出、要反复试错的调研。）
  - "**Assertive Action:** Continue to handle "surgical" tasks directly—simple reads, single-file edits, or direct questions that can be resolved in 1-2 turns. Delegation is an efficiency tool, not a way to avoid direct action when it is the fastest path."（外科式任务自己做：简单读取、单文件改动、1–2 轮能答的问题；派活是效率工具，不是逃避动手的借口。）
  - "Remember that the closest relevant sub-agent should still be used even if its expertise is broader than the given task."
- invoke 工具的 prompt 参数〔一手，`agents/agent-tool.ts`〕："The COMPLETE query to send the subagent. MUST be comprehensive and detailed. … Do NOT send brief or incomplete instructions."
- 内置子 agent〔一手〕：`codebase_investigator` 只有 ls、read_file、glob、grep 四个工具（注释"Grant access only to read-only tools."），返回 JSON 报告（`codebase-investigator.ts`）；`generalist` 有全部工具，"Use this to keep the main session history lean and efficient"（`generalist-agent.ts`）。
- 递归保护〔一手，`docs/core/subagents.md`〕："subagents **cannot** call other subagents. If a subagent is granted the `*` tool wildcard, it will still be unable to see or invoke other agents."
- 开关〔一手，`packages/cli/src/config/settingsSchema.ts`〕：`experimental.enableAgents` 默认 `true`（"Enable local and remote subagents."）；用户可以用 `@名字` 强制派。
- 注入〔一手，`packages/core/src/config/injectionService.ts`〕：`InjectionSource = 'user_steering' | 'background_completion'`，"`user_steering`: Interactive guidance from the user (gated on model steering). `background_completion`: Output from a backgrounded execution that has finished."；子 agent 执行器监听两种注入并排队（`local-executor.ts` 的 `pendingHintsQueue`、`pendingBgCompletionsQueue`）。

### Inferences
- 〔推理〕Gemini CLI 是唯一给出数字化派活阈值（>3 个文件、1–2 轮）的开源编码 agent。它的阈值针对"全工具主 agent"；灵鲸的总会话没有工具，对应的阈值应该落在"当场答还是 ponder"上（一句话能答、不翻账本 ≈ "1–2 turns surgical"）。
- 〔推理〕`user_steering` / `background_completion` 两类注入，与灵鲸底座的 `steer` / `inject` 一一对应，说明"用户插话"和"后台结果"走同一条注入通道、按来源区分是常见做法。

### Gaps
- `codebase_investigator` 用哪档模型，没有细查。

---

## Q8 OpenAI Codex CLI（multi-agent）与 Codex 云任务

### Takeaway
Codex 的 `multi_agent` 特性已经是 Stable、默认开启（2026-11-01 的提交）。但 spawn_agent 的描述**禁止主动派**："用户或 AGENTS.md / skill 没明说就不派；要求深入、彻底、调研都不算许可"。规则以关键路径为核心：阻塞下一步的事自己做，能并行的旁支才派。派完少等、做不重叠的活；新版 wait_agent 在用户插话时会提前返回。默认最多 6 个线程，深度 1。

### Cited Findings
- 特性开关〔一手，`codex@a098129` `codex-rs/features/src/lib.rs`〕：`key: "multi_agent", stage: Stage::Stable, default_enabled: true`；`multi_agent_v2` Stable 但默认关；`multi_agent_mode` Removed。（子 agent 引用的二手博客说"默认关、要开 flag"，已过时〔一手对照〕。）
- 上限〔一手，`codex-rs/core/src/config/mod.rs`〕：`DEFAULT_AGENT_MAX_THREADS: Option<usize> = Some(6)`，`DEFAULT_AGENT_MAX_DEPTH: i32 = 1`。
- spawn_agent 描述（v1）〔一手，`codex-rs/core/src/tools/handlers/multi_agents_spec.rs`〕：
  - "Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work. Requests for depth, thoroughness, research, investigation, or detailed codebase analysis do not count as permission to spawn."（除非用户或 AGENTS.md / skill 明确要求，否则不派；要求深入、彻底、调研、详细分析代码库都不算许可。）
  - "Agent-role guidance below only helps choose which agent to use after spawning is already authorized; it never authorizes spawning by itself."（下面的角色说明只用于已获许可后挑哪个 agent，本身不构成许可。）
  - "### When to delegate vs. do the subtask yourself — First, quickly analyze the overall user task and form a succinct high-level plan. Identify which tasks are immediate blockers on the critical path, and which tasks are sidecar tasks … explicitly decide what immediate task you should do locally right now. Do this planning step before delegating to agents so you do not hand off the immediate blocking task to a submodel and then waste time waiting on it."（先快速成计划，分清关键路径上的阻塞任务和可并行的旁支任务，明确现在自己做哪件；派之前先做这步，免得把阻塞任务交给子模型再干等。）
  - "Use a subagent when a subtask is easy enough for it to handle and can run in parallel with your local work."（子任务够简单、能和你手头的活并行时才派。）
  - "Do not delegate urgent blocking work when your immediate next step depends on that result."（下一步依赖其结果的紧急阻塞任务不要派。）
  - "Keep work local when the subtask is too difficult to delegate well and when it is tightly coupled, urgent, or likely to block your immediate next step."（太难交代清楚、耦合紧、紧急或会挡住下一步的，留在本地做。）
  - "For code-edit subtasks, decompose work so each delegated task has a disjoint write set."（改代码的子任务按互不重叠的写入集拆。）
  - "### After you delegate — Call wait_agent very sparingly. … While the subagent is running in the background, do meaningful non-overlapping work immediately. Do not repeatedly wait by reflex."（极少调 wait_agent；子 agent 后台跑时立刻做不重叠的有用工作；别条件反射地等。）
- v2 的工具〔一手，同文件〕：
  - wait_agent："Wait for a mailbox update from any live agent … The wait also ends early when new user input is steered into the active turn."（等待会因用户插话而提前结束。）
  - send_message："The message will be delivered promptly. Does not trigger a new turn."（及时送达，不触发新回合。）
  - followup_task："trigger a turn if it is idle. If the target is already running, deliver the task promptly at message boundaries"（空闲就起回合；正跑就在消息边界送达。）
  - 共享目录："All agents share the same directory … edits made by one agent are immediately visible to all other agents."（`codex-rs/prompts/src/multi_agent_instructions.rs`）
- 内置角色〔一手，`codex-rs/core/src/agent/role.rs`〕：
  - `explorer`："Use `explorer` for specific codebase questions. … Typically, you should trust the explorer results without additional verification. … While waiting for the explorer results, you can continue working on other local tasks"（问具体代码库问题；一般信任结果不再核验；等的时候做别的本地活。）
  - `worker`："Explicitly assign **ownership** of the task (files / responsibility). … Always tell workers they are **not alone in the codebase**, and they should not revert the edits made by others"（明确分配文件归属；告诉 worker 代码库里不止它一个，不要回滚别人的改动。）
  - `awaiter`（专门等长命令）在源码里被注释掉。
- orchestrator 模板〔一手，`codex-rs/core/templates/agents/orchestrator.md`〕：
  - "Prefer multiple sub-agents to parallelize your work."
  - "If sub-agents are running, **wait for them before yielding**, unless the user asks an explicit question. If the user asks a question, answer it first, then continue coordinating sub-agents."（子 agent 在跑就先等它们再交还控制，除非用户明确提问；用户提问先答，再继续协调。）
  - "When you ask sub-agent to do the work for you, your only role becomes to coordinate them. Do not perform the actual work while they are working."（派出去以后你只协调，别在它们干活时自己动手。）
- 云任务〔二手，官方页 403，取自搜索摘要〕："Codex can work on tasks in the background (including in parallel) using its own cloud environment."，由 IDE 或 GitHub `@codex` 发起。完成没有内置通知，社区请求加通知，CLI 的 `notify` 钩子是变通办法〔二手〕。

### Inferences
- 〔推理〕Codex 是"默认不派"最坚决的一家，理由在描述里没写；结合 Claude Code Pro 档同样的规则（"each spawn starts cold … the expensive path"），推测是成本和"冷启动重推上下文"的代价。这跟灵鲸正相反：灵鲸的总会话**必须**派，因为它没有工具。说明"派不派"的默认值取决于主 agent 有没有能力自己干，不是普遍真理。
- 〔推理〕"关键路径 vs 旁支"是最好的一条可迁移判据：灵鲸"主人问了个问题，当场答还是想想再答"，本质就是"答复是不是主人等待中的关键路径"。主人在等的、一句话能答的，当场答；需要权衡的，先垫话（关键路径上的"回应"已完成），再把"想"作为旁支派出去。
- 〔推理〕Codex 的 orchestrator 模板"子 agent 在跑就先等它们再交还控制"是编码 CLI 的单用户、单任务假设；对常驻、多渠道的总会话不适用，灵鲸 R4（没有 wait）更接近 Claude Code coordinator 和 Super-agent。

### Gaps
- Codex 官方文档（developers.openai.com/codex/subagents）返回 403，没读到官方的角色表与云任务通知机制。

---

## Q9 Cursor（子 agent、Cloud Agents，原 Background Agents）

### Takeaway
Cursor 的本地 agent 按子 agent 的 description 自动派（可以写"use proactively"）；`is_background: true` 的子 agent 不阻塞父 agent。Cloud Agents 由用户从各种入口发起，在云端 VM 的独立分支上干活、交 PR；文档里没有本地 agent 自动转交云端的描述。

### Cited Findings（均为子 agent 读官方页，〔一手〕，读取于 2026-11）
- https://cursor.com/docs/subagents：
  - "specialized AI assistants that Cursor's agent can delegate tasks to"；内置 Explore（更快的模型）和 Browser，"Agent uses them automatically when appropriate"。
  - description "determines when Agent delegates to your subagent"；"Include phrases like "use proactively" or "always use for" in your description field."
  - `is_background`："If `true`, the subagent runs in the background without blocking the parent."
  - 子 agent "inherit all tools from the parent"；`readonly: true` 表示 "no file edits, no state-changing shell commands"。
  - 2.5 起支持嵌套，但 "a subagent launched by another subagent can't launch further ones"。
  - "If you find yourself creating a subagent for a simple, single-purpose task" → 改用 skill。
- https://cursor.com/docs/cloud-agent：Cloud Agents "run in isolated VMs in the cloud"，"work on a separate branch, then push changes to your repo for handoff"；入口有 iOS、Web、Desktop（下拉选 Cloud）、Slack、GitHub / Bitbucket 评论、Linear、API；"You can run as many agents as you want in parallel."；通知只记录了 Slack。
- 子 agent 功能始于 Cursor 2.4（论坛公告）〔二手〕。

### Inferences
- 〔推理〕页面没写本地 agent 会自动转交云端，所以"开一件长活"在 Cursor 是用户的决定，不是模型的判断。

### Gaps
- Cursor 主 agent 的系统提示里关于何时派子 agent 的原文没有拿到（闭源）。

---

## Q10 Manus（planner / executor、agent-as-tool、Wide Research）

### Takeaway
Manus 不按角色拆多 agent，子 agent 只为隔离上下文。planner 本身也是"agent as tool"，主 agent 定义输出 schema，子 agent 用 submit 工具按约束解码填写。短而清楚、只看最终输出的任务只传指令；需要完整历史的才共享上下文。Wide Research 是"agentic map-reduce"，官方说单 agent 做到第 8–9 项开始编造，少于 10 项不建议用。早期泄露的提示词里，"新消息先回、首条只确认收到、notify 不阻塞、ask 才阻塞"写得最直白。

### Cited Findings
- 官方博客 "Context Engineering for AI Agents: Lessons from Building Manus"（Yichao 'Peak' Ji，2025-07-18）〔一手，https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus〕：
  - 不谈多 agent。唯一一句和用户沟通有关："when the user provides a new input, Manus must reply immediately instead of taking an action."（用户有新输入时必须立刻回复，而不是去执行动作。）
  - 实现方式是 logits 屏蔽："Rather than removing tools, it masks the token logits during decoding"；"unless absolutely necessary, avoid dynamically adding or removing tools mid-iteration"（不中途增删工具，靠屏蔽）；工具名用前缀分组，"browser_"、"shell_"。
  - "the KV-cache hit rate is the single most important metric for a production-stage AI agent"（KV 缓存命中率是生产 agent 最重要的指标。）
- LangChain × Manus 网络研讨会（2025-10）：第三方逐字稿 https://yuntaozhang999.github.io/context-engineering-for-ai-agents-with-langchain-and-manus（2025-11-22）〔二手〕；Lance Martin 的笔记 https://rlancemartin.github.io/2025/10/15/manus/（2025-10-15）〔二手〕：
  - "Manus is not the typical multi-agent system… we do not divide by role"；"we are very very cautious about adding more sub agents"（不按角色分，对加子 agent 非常谨慎。）
  - "do not communicate by sharing memory, instead share memory by communicating."（不要靠共享内存来通信，要靠通信来共享内存。）
  - 只传指令："if a task has a short clear instruction, and only the final output matters"；共享完整历史："for those scenario that requires a full history"；代价："sharing context is expensive, because each subagent has a larger input to prefill."
  - "internally we call it 'agent as tool' … from the models' perspective, it's still a function."
  - "you have to let the main agent to define the output schema … we use constraint decoding … So just do not use free form summarizations."（输出 schema 由主 agent 定；约束解码；不要自由格式的总结。）"Sub-agents have a `submit results` tool to populate this schema"（Lance Martin 笔记）。
  - planner："maybe one third of the action is about updating the to-do list" → 改成 agent-as-tool；"it's very important to have a separate agent that has a different perspective."（用另一个视角的独立 agent 很重要。）
  - 工具数："try not to include more than 30 tools"；"we only have like 10 or 20 atomic functions, and everything else is in the sandbox."
  - 沙箱 CLI "is not that good for low latency back and forth interactions with the front end"，承认"pretty tricky"，没给完整方案。
- Wide Research〔一手〕：
  - https://manus.im/blog/introducing-wide-research（2025-07-31）："every subagent in Wide Research is a fully capable, general-purpose Manus instance"，明确不走"traditional multi-agent systems based on predefined roles"。
  - https://manus.im/blog/manus-wide-research-solve-context-problem（10-29，页面无年份，2025 为推理）：子 agent 拿 "A fresh, empty context window"、"A complete virtual machine environment"；"the sub-agents do not communicate with each other"；单 agent 质量在 "by the eighth or ninth item… the AI starts fabricating"（第 8–9 项开始编造）；少于 10 项不建议用。
- 早期泄露提示词〔二手，`x1xhlol/system-prompts-and-models-of-ai-tools` 的 `Manus Agent Tools & Prompt/`，约 2025 年春〕：
  - planner 是注入事件的系统模块："Task planning will be provided as events in the event stream"；"Each planning update includes the current step number, status, and reflection"。
  - message_rules：
    - "Reply immediately to new user messages before other operations"（先回新消息再做别的）
    - "First reply must be brief, only confirming receipt without specific solutions"（首条回复只确认收到，不给方案）
    - "Events from Planner, Knowledge, and Datasource modules are system-generated, no reply needed"（这些模块的事件是系统生成的，不必回复）
    - "Message tools are divided into notify (non-blocking, no reply needed from users) and ask (blocking, reply required)"
    - "reserve ask for only essential needs to minimize user disruption"（ask 只用于必要时，少打扰用户）
    - "Must message users with results and deliverables before entering idle state"（进入空闲前必须把结果交给用户）
  - tools.json 共 29 个工具，没有开子 agent 的工具；有 `idle`。

### Inferences
- 〔推理〕Manus 的三条和灵鲸直接对应：①"新消息先回、首条只确认收到" = 灵鲸的垫话（"我想想，等我一下"）；②"模块事件不必回复" = Claude Code coordinator 的"通知是内部信号"，以及灵鲸 inject 的"不叫醒"；③主 agent 定 schema、约束解码 = 灵鲸 `conclude{事实栏, 意图}` 的结构化回传，Manus 给的理由是"不要自由格式的总结"。
- 〔推理〕"planner 用另一个视角的独立 agent"支持灵鲸把"想事"放到独立会话，而不是让总会话自己想。

### Gaps
- Manus 没有官方成文的 agent-as-tool 文章，只有研讨会；Wide Research 由用户开启还是自动触发，官方页没写。

---

## Q11 Devin / Cognition

### Takeaway
2025 年 Cognition 主张"别做多 agent"：共享完整轨迹，动作里藏着隐性决定。2026-04 修正为："写入保持单线程，额外的 agent 贡献智力而不是动作"，只读子 agent、检索子 agent、生成—验证循环可行。manager Devin 可以拆活、派 child Devin，child 完成时 coordinator 被自动唤醒，不轮询。弱模型当主模型不行：SWE 1.5 当不好"smart-friend"架构的主模型。

### Cited Findings
- "Don't Build Multi-Agents"（Walden Yan，2025-06-12）〔一手，https://cognition.com/blog/dont-build-multi-agents〕："Share context, and share full agent traces, not just individual messages"；"Actions carry implicit decisions, and conflicting decisions carry bad results"；"in 2025, running multiple agents in collaboration only results in fragile systems."
- SWE-grep（2025-10-16）〔一手，https://cognition.com/blog/swe-grep〕：轨迹"often spending >60% of their first turn just retrieving context"（第一轮常有六成以上时间花在找上下文）；子 agent "conserves context budget (and intelligence) for the main agent"；"Retrieval is a verifiable task."；工具"a restricted set of tool calls (grep, read, glob, ...)"，"up to 8 parallel tool calls per turn in a maximum of 4 turns"；返回"a list of files with line ranges"（文件加行号范围，不是自由总结）。
- "Multi-Agents: What's Actually Working"（Walden Yan，2026-04-22）〔一手，https://cognition.com/blog/multi-agents-working〕：
  - "writes stay single-threaded and the additional agents contribute intelligence rather than actions"
  - "most multi-agent setups in the world are limited to 'readonly' subagents"
  - "clean context leads to a notable improvement in capabilities when using a generator-verifier loop"（生成—验证循环里干净上下文明显提升能力）
  - "smart-friend works today when both models are strong"；"SWE 1.5 was not good enough at being the primary model for this setup"（两个模型都强时 smart-friend 才行；SWE 1.5 当主模型不够格。）
  - 沟通问题：managers "default to being overly prescriptive, which backfires when the manager lacks deep codebase context"（manager 默认指示过细，而它又缺代码库的深入上下文，适得其反）；"Agents assume they share state with their children when they don't"（agent 以为和子 agent 共享状态，其实没有）；向上汇报 "doesn't happen by default"（默认不会主动汇报。）
- "Devin can now Manage Devins"（2026-03-19）〔一手，https://cognition.com/blog/devin-can-now-manage-devins〕："Each managed Devin is a full Devin, running in its own isolated virtual machine"；coordinator 能"Schedule messages to itself"。
- Devin 文档〔一手，https://docs.devin.ai/work-with-devin/advanced-capabilities〕："Devin automatically breaks down large tasks and delegates to managed Devins when it makes sense."；"By default it starts child sessions without asking first"；"the coordinator is woken automatically, even if it is asleep, so it doesn't poll"（coordinator 睡着也会被自动叫醒，所以不轮询。）

### Inferences
- 〔推理〕"manager 缺代码库上下文却指示过细"恰好是 Super-agent 路由提示词反复强调"不许加实现计划"的原因（见 Q15），也是灵鲸交接包"只补流程不改写需求"（决策 14）的外部印证。
- 〔推理〕"SWE 1.5 当不好主模型"是对灵鲸"便宜总会话"的直接警告：弱主模型的问题在"不知道何时该求助"。灵鲸已用工具集划界来缓解（R2、R5），但"当场答还是 ponder"仍由便宜模型判断，应在 M4 评测里单测这一项。
- 〔推理〕Cognition 的"写入单线程"与灵鲸的分工一致：总会话不写，第三层每件活独占一个工作目录。

### Gaps
- Devin manager 的提示词原文未公开。

---

## Q12 Hermes Agent（Nous Research）的 delegate_task

### Takeaway
在 2025–2026 的开源 agent 里，Hermes 的委派规则写得最完整：USE FOR / DO NOT USE FOR 清单；顶层委派**总在后台**，结果"只在你的回合之间"作为新消息回来；"给一句状态就结束回合，不要等、不要轮询"；子 agent 的总结是**自述**，外部副作用必须拿到可核验的句柄、自己核实后才能告诉用户。子 agent 被禁用的工具（delegate_task、clarify、memory、send_message、cronjob）和灵鲸第三层的边界几乎一样。Hermes 也是"一个 agent 接多个消息平台"的形态，忙时输入有 interrupt / queue / steer 三种模式。

### Cited Findings
- 模块头注释〔一手，`hermes-agent@557254f` `tools/delegate_tool.py`〕："top-level model calls run in the background while orchestrator children wait for their own workers. The parent only ever sees the delegation call and the summary result, never the child's intermediate tool calls or reasoning."（顶层委派在后台跑；父 agent 只看到委派调用和总结，看不到子 agent 的中间过程。）
- 工具描述（`_DESCRIPTION_HEAD` / `_DESCRIPTION_DELIVERY`）〔一手，同文件〕：
  - "Spawn isolated subagents for parallel or context-heavy work. Each gets its own conversation, terminal session, and toolset, and only its final summary returns to you."
  - "Otherwise runs in the background: dispatch returns live transcript paths and results re-enter as a new message when subagents finish … Background results are delivered only BETWEEN your turns: finish whatever does not depend on them, then give a one-line status and END YOUR TURN. Never wait or poll on transcripts, artifact files, or CI for a child. While children run, `action` (list/steer/stop) controls them live."（后台跑，结果作为新消息回来，只在你的回合之间送达：先做完不依赖它们的事，给一句状态，结束回合；绝不等待或轮询；子 agent 运行中可用 list / steer / stop 实时控制。）
  - "USE FOR: reasoning-heavy subtasks, work that would flood your context, or independent parallel workstreams."（推理重的子任务、会淹没上下文的工作、独立的并行工作流。）
  - "DO NOT USE FOR (use these instead): Mechanical multi-step work with no reasoning needed -> execute_code; A single tool call -> call the tool directly; Tasks needing user interaction -> subagents cannot ask questions; Durable work that must survive this session -> cronjob or terminal(background=True, notify=True)"（不需要推理的机械多步工作用 execute_code；单个工具调用直接调；要和用户交互的不行，子 agent 不能提问；要活过本会话的持久工作用 cronjob 或后台终端。）
  - "Children know nothing of this conversation: pass everything needed via 'context', including any required output language, tone, or style"（子 agent 对本对话一无所知；需要的都经 context 传，包括输出语言、语气、风格。）
  - "Child summaries are SELF-REPORTS, not verified facts … For external side effects (uploads, remote writes, publishing), require a verifiable handle (URL, ID, absolute path) and verify it yourself before telling the user the operation succeeded."（子 agent 的总结是自述，不是核实过的事实；外部副作用要可核验的句柄，自己核实后再告诉用户成功。）
  - "Children cannot close tracked work: a child asked to close it returns findings instead; the parent applies the transition."（子 agent 不能关闭被跟踪的工作，只交发现，由父 agent 做状态转换。）
- 参数〔一手，同文件〕：`output_schema`（"parent validates with one bounded correction retry … the child's raw text is still returned as summary, never discarded"，父 agent 校验、最多重试一次修正、原文照样返回）；`action: steer`（"queue course-correction text into one child … appended to the child's next tool result mid-run"，纠偏文字附在子 agent 的下一个工具结果后面）。
- 默认值〔一手，`tools/delegate_tool_config.py`〕：`_DEFAULT_MAX_CONCURRENT_CHILDREN = 10`；`MAX_DEPTH = 1  # flat by default`；`tools/delegate_tool.py` 的 `DEFAULT_MAX_ITERATIONS = 250`。
- 子 agent 禁用的工具〔一手，`tools/delegate_tool_toolsets.py`〕：`"delegate_task"  # no recursive delegation`，`"clarify"  # no user interaction`，`"memory"  # no writes to shared MEMORY.md`，`"send_message"  # no cross-platform side effects`，`"cronjob_manage"  # no scheduling more work in the parent's name`。
- 与看板的分工〔一手，`agent/prompt_builder.py`〕："`delegate_task` is for short reasoning subtasks inside your own run; board tasks are for cross-agent handoffs that outlive one API loop."（delegate_task 用于本次运行内的短推理子任务；看板任务用于活得比一次 API 循环更久的跨 agent 交接。）
- 忙时输入〔一手，`apps/desktop/src/store/busy-input-mode.ts`〕：`type BusyInputMode = 'interrupt' | 'queue' | 'steer'`，未配置时默认 `'interrupt'`；网关侧有 `gateway/run_busy.py`（"Busy-session queueing, slot claims, slash dispatch tables"）。

### Inferences
- 〔推理〕Hermes 子 agent 的禁用清单是灵鲸第三层边界的外部同构：不能问用户（`clarify`）≈ 手不对外说话、回问经总会话；不能写共享记忆（`memory`）≈ 第三层不直接写账本；不能跨平台发消息（`send_message`）≈ 第三层不投递；不能以父 agent 名义排期（`cronjob`）≈ 只有时钟能开定时作业。这是"派出去的东西不得以主体名义对外"的四条硬规则，已有成熟产品实践。
- 〔推理〕"结果只在回合之间送达、给一句状态就结束回合"与灵鲸 R4 完全一致；Hermes 的忙时输入默认 interrupt，灵鲸则按"谁发起的回合、有无副作用"分 steer / cancel / 排队，更细。
- 〔推理〕"短推理子任务用 delegate、跨循环的长活用看板"的分法，对应灵鲸的 `ponder`（想事活，期限内出结论）与 `dispatch`（活，可能跨天）；可以考虑把"活过本会话"作为区分标准写进总会话的提示词。

### Gaps
- Hermes 主系统提示里关于"何时委派"的其他句子没有逐条通读，只读了工具描述和看板段落。

---

## Q13 Kimi Agent Swarm（K2.5）

### Takeaway
Kimi 用强化学习训练编排者（PARL），而不是写提示词：最多 100 个子 agent、1500 次工具调用（同页又写"1500 coordinated steps"，单位不一致），最多快 4.5 倍。已知问题有"串行坍缩"（编排者退回单 agent 执行）和"虚假并行"（为拿奖励乱开子任务）。

### Cited Findings（官方博客，〔一手〕，https://www.kimi.com/blog/kimi-k2-5，页面无日期，图片文件名 2026-01-26/27）
- "can self-direct an agent swarm with up to 100 sub-agents"；"executing parallel workflows across up to 1,500 tool calls"；"reduces execution time by up to 4.5x"；"automatically created and orchestrated by Kimi K2.5 without any predefined subagents or workflow"；"research preview"。
- PARL："a trainable orchestrator agent to decompose tasks into parallelizable subtasks… executed by dynamically instantiated, frozen subagents."（可训练的编排者拆任务，子 agent 冻结、动态实例化。）
- "A common failure mode is serial collapse, where the orchestrator defaults to single-agent execution"；修法 "staged reward shaping that encourages parallelism early in training"；还要防 "spurious parallelism, a reward-hacking behavior"。
- 指标 Critical Steps："reflects the slowest subagent at each stage"；"spawning more subtasks only helps if it shortens the critical path."（多开子任务只有缩短关键路径才有用。）
- 步数上限："BrowseComp (Swarm Mode): main agent max 15 steps; sub-agents max 100 steps"（主 agent 最多 15 步，子 agent 最多 100 步。）
- K2.6 / K3 时"up to 300 sub-agents… up to 4,000 parallel workflow steps"〔二手，kimi.ai 帮助页的搜索摘要，未核实〕。

### Inferences
- 〔推理〕"串行坍缩"是"靠模型自己决定派活"的通病，Super-agent 实验里带子 agent 工具的单会话 5 次都没派（见 Q15）是同一现象的提示词版本。Kimi 靠训练解决，灵鲸用工具集划界（总会话没得选）解决，两条路都在绕开"让模型临场决定"。
- 〔推理〕BrowseComp 主 agent 15 步、子 agent 100 步的比例，是"主 agent 只编排、步数很少"的量化参照；灵鲸 R3（总会话一回合 ≤3 次推理、≤6 次工具调用）在同一量级。

### Gaps
- arXiv 技术报告没读到；swarm 与单 agent 的分数只在图片里，没有提取出来。

---

## Q14 其他 2025–2026 有显式委派工具的 agent：OpenCode、Amp、Anthropic 研究系统、Grok

### Takeaway
OpenCode 的 subagent 工具默认前台、可选后台，结果以 `<subagent>` 消息回来。Amp 把"强模型顾问"做成主 agent 的一个工具（Oracle，只读，从不改文件），和灵鲸"便宜总会话 + 派去深想"的方向相同。Anthropic 研究系统给出了按复杂度定派活规模的数字。Grok 的多 agent 由调用方设 agent 数量，不是主 agent 决定；"chief of staff" bot 没有可靠来源。

### Cited Findings
- OpenCode〔一手，`opencode@271f5ef` `packages/core/src/tool/plugin/subagent.ts`〕：
  - "Foreground (default) runs the subagent to completion and returns its final response. Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes. Use background only for independent work that can run while you continue elsewhere."（默认前台跑完交结果；后台立即返回、完成时通知；只有能独立进行的工作才用后台。）
  - background 参数："DO NOT sleep, poll, or proactively check on its progress."
  - model 参数："NEVER set this unless the user explicitly asks for a particular model"。
  - 深度上限报错："Subagent depth limit reached … Increase "experimental.subagent_depth""。
  - 结果格式（`packages/core/src/session/subagent-completion.ts`）：`<subagent sessionID="…" state="…" description="…">…</subagent>`。
- Amp〔一手，https://ampcode.com/docs/models-and-subagents，读取于 2026-11-01，页面无日期〕：
  - "`@amp/oracle` adds the `oracle` tool. It reviews code and advises on hard decisions, and it never edits files."；"the main agent calls it as a tool"；Oracle 把搜索交给 `finder` 和 `librarian`。
  - Task 子 agent："Amp chooses subagents automatically for suitable tasks, mostly in `medium` mode"；"They work in isolation, so they can't communicate with each other, you can't guide them directly."；"The main agent receives their final summary rather than monitoring their step-by-step work."；运行中的 Task 子 agent "receives the new task right away as extra instructions"（运行中收到新任务就作为附加指令立刻接收。）
  - "Supporting models handle jobs that do not need the main agent."
- Anthropic "How we built our multi-agent research system"（2025-06-13）〔一手，https://www.anthropic.com/engineering/multi-agent-research-system〕：
  - "Simple fact-finding requires just 1 agent with 3-10 tool calls, direct comparisons might need 2-4 subagents with 10-15 calls each, and complex research might use more than 10 subagents"（简单查事实 1 个 agent、3–10 次工具调用；直接比较 2–4 个子 agent、各 10–15 次；复杂调研 10 个以上。）
  - "Each subagent needs an objective, an output format, guidance on the tools and sources to use, and clear task boundaries."（每个子 agent 要有目标、输出格式、工具与来源指引、清晰边界。）
  - 多 agent（Opus 4 主 + Sonnet 4 子）"outperformed single-agent Claude Opus 4 by 90.2%"；"multi-agent systems use about 15× more tokens than chats"。
  - 已知问题："our lead agents execute subagents synchronously"（主 agent 同步等子 agent，形成瓶颈）。
  - 子 agent 写外部存储，"pass lightweight references back to the coordinator"（只向协调者回传轻量引用。）
- Grok〔二手〕：Grok 4 Heavy 多个 agent 并行"compare notes"（发布会口述，媒体转述）；API `grok-4.20-multi-agent` 的 `reasoning.effort` 决定协作的 agent 数（low / medium 4 个，high / xhigh 16 个，docs.x.ai 的搜索摘要）。"Grok chief-of-staff bot" 没有可靠来源；Grok Bot 已在 `2026-11-01-dsh-superagent.md`"和 Grok Bot 的区别"一节覆盖。

### Inferences
- 〔推理〕Amp 的 Oracle 是灵鲸"想事活"的最近似产品形态：主 agent 用更快的模型干日常，难题当工具调用交给更强的顾问，顾问只读、只给意见。区别是 Oracle 同步返回，灵鲸的想事活异步、以事件回来，因为总会话不能挡住对话。
- 〔推理〕Anthropic 的"1 / 2–4 / 10+"规模表和 Manus 的"≥10 项"给出了"何时值得派"的量化边界；但两者都是全工具主 agent 下的效率问题，对灵鲸只作为第三层内部再拆子 agent（`spawn`）时的参考。

### Gaps
- Amp 的 Oracle 用什么模型、主 agent 何时调用，文档写的是"可在插件里改"，没有给规则原文。
- Grok 多 agent 的结果怎么合并，没有一手资料。

---

## Q15 DeepSeek Super-agent 的路由提示词（对照用）

### Takeaway
Super-agent 的 router（代码里叫 orchestrator）的规则，核心是"**不许替 worker 想**"：不加实现计划、不改写需求、不读代码和日志、不调查阻塞原因，只转原始触发引用和路由事实（备注 ≤30 词）。worker 负责确认收到（ack），router 负责对人的结果通知（≤100 词，不转发报告）。所有结果自己作为消息到达，router 绝不等待。注意：router 预设**其实装了 bash**（沙箱、5 秒超时）和 tool-jobs（等待 5 秒），只是关了写文件和改文件。

### Cited Findings（`superagent-src@6337fc8`，〔一手〕）
- `prompts/orchestrator.md`：
  - "Workers investigate and implement; never add implementation plans."（worker 调研和实现；router 绝不加实现计划。）
  - "Keep progress internal."
  - "Worker reports, follow_up notices, new candidates and a background job's end, with its output, arrive by themselves as messages: never wait for them with sleep, polling or job waits; end the turn when nothing is left to do."（worker 报告、跟进通知、新候选、后台任务结束都会自己作为消息到达：绝不用 sleep、轮询或等待任务的方式去等；没事可做就结束回合。）
- `prompts/dispatch.md`：
  - "Do not expand a request's scope, add implementation plans, acceptance criteria or policy checklists: workers derive requirements from the original source."（不扩大范围、不加实现计划、验收标准或规则清单；worker 从原始来源推导需求。）
  - "Do not paraphrase a short request into a work plan, pick examples or categories, invent requirements, or append implementation, tests, documentation, licensing, CI or review checklists."
  - "Outside proactive assessment, do not follow context references, read code or logs, assess technical scope, design a solution or investigate blockers yourself."（主动研判之外，不跟引用、不读代码日志、不评估技术范围、不设计方案、不调查阻塞。）
  - "Do not translate worker questions into your own technical decisions."（不要把 worker 的问题转成你自己的技术决定。）
  - "An accept or attach takes an optional routing note of at most 30 words … not implementation instructions. The host always includes the original trigger reference independently of the note."（路由备注 ≤30 词，不放实现指令；宿主总会独立附上原始触发引用。）
  - "Attach only when the message points at that ticket explicitly … A message on a similar subject is a new request: accept or ignore it, never attach it."（消息明确指向某工单才挂上去；话题相似的算新请求。）
  - "Ordinary progress remains internal."；"Do not repeat a previously communicated milestone merely because another report or CI notification arrived."（普通进展不外发；不因又来一份报告或 CI 通知就重复已通知过的里程碑。）
- `prompts/replies.md`：
  - "Ordinary progress reports only update internal ticket records and never wake the orchestrator; an explicit human_action request is different: it reaches the orchestrator at once"（普通进展只更新内部记录、不叫醒 router；明确要人操作的请求立即送到。）
  - "Before substantial investigation or changes for a human request … the worker calls orchestrator_ack … The orchestrator routes and delivers answers/results; the worker owns acknowledging requests it is about to handle."（worker 动手前先 ack；router 负责送答复和结果，worker 负责确认收到。）
  - "Answer quick questions directly without an extra acknowledgement."（快问题直接答，不另发确认。）
  - "100 words is a hard ceiling"；"Workers report internally; the orchestrator owns human-facing ticket updates. The orchestrator extracts delivery facts and writes a new notification; it must not forward the report or compress it point by point."（worker 只对内汇报；router 负责对人的更新，提取交付事实重写通知，不转发、不逐条压缩报告。）
  - "for missing technical facts, wait for the worker's report … rather than investigating yourself."
- `prompts/admission.md`：
  - "Assessment is read-only: do not bypass these tools through bash, execute work or send messages, and do not delegate it to another Session or evaluator"（研判只读；不许借 bash 绕过工具，不许执行工作或发消息，不许转给别的会话。）
  - 三个独立事实："the discussion targets this project, the participants express intent to have a specific change implemented, and the direction is sufficiently settled for a small local edit"（讨论针对本项目；参与者表达了要实现具体改动的意图；方向已定到能做小的本地改动。）
  - "When intent remains uncertain, ignore quietly … do not ask humans to confirm routine chatter."（意图不明就安静忽略，不拿日常闲聊去找人确认。）
- `prompts/worker.md`："Resolve routine problems yourself; report concrete blockers internally. Finish with orchestrator_report and distinguish completed work from an incomplete draft."（常规问题自己解决，具体阻塞对内报告；以 orchestrator_report 结束，区分已完成和未完成草稿。）
- router 预设〔一手，`cordis.patch.yml` 的 `dsh-superagent-router-preset`〕：description"前台命令和任务等待超 5 秒转入后台，只含路由所需的工具"；插件有 `bash-sandbox`（`timeoutMs: 5000, maxTimeoutMs: 5000`）+ `tool-bash`、`tool-fs`（`write: false, edit: false`）、`tool-jobs`（`waitTimeoutMs: 5000`）、skill、compaction；没有 subagent、web、todo。
- 端到端实验（已在 `2026-11-01-dsh-superagent.md` 记录）：带子 agent 工具、中性提示词的单会话 p95 29.5 分钟，"5 次都没调用子 agent"〔二手，S2〕。

### Inferences
- 〔推理〕和本仓库草稿核对：`four-layers.md` §2.1 写"像 Super-agent 的 Router 预设那样只装它需要的工具、不装 shell 和写文件"，R2 也写"预设 `member-main` 不装 shell"并引 S1 作依据。原型 router **装了** bash（沙箱、5 秒超时）和 tool-jobs，只关了 write / edit。灵鲸不装 shell 是更严的选择，本身没问题，但依据应改成"Super-agent 的 router 关了写文件、改文件，shell 限 5 秒沙箱；灵鲸更进一步不装 shell"，不要说原型也没装。
- 〔推理〕Super-agent 和 Claude Code coordinator 对"综合"的要求方向相反，但不矛盾：coordinator 要求把 worker 的调研发现综合成具体规格再派（"Always synthesize"），因为 coordinator 本身懂代码；Super-agent 的 router 不许把人的原话改写成计划，因为 router 不读代码（Cognition："overly prescriptive … lacks deep codebase context"）。灵鲸的总会话属于后者（便宜模型、没工具），应照 Super-agent："原话按编号取原文"、备注只写路由背景与人的明确约束。
- 〔推理〕"worker 负责 ack、router 负责结果"这一分工值得注意：确认收到由真正要干活的一方发，确认里写的就是它理解的具体改动，人能马上发现误解。灵鲸目前让总会话说"好，我开始改"，可以考虑由手在 `dispatch` 后回一句"我理解要改的是 X"作为结构化字段，由总会话转述，或者在主控台直接显示。

### Gaps
- 无。

---

## Q16 横向对比

### Takeaway
产品分两大类。**A 类"全工具主 agent + 可选派活"**（Claude Code 默认、Codex、Gemini CLI、Cline、OpenCode、OpenHands、Goose、Cursor、Amp、Hermes）：派活是上下文管理和并行手段，规则写成"何时不派"。**B 类"无改世界工具的协调者"**（Roo Orchestrator、Kilo orchestrator、Claude Code coordinator、Super-agent router、Devin manager）：靠收工具逼它派。B 类里只有 Claude Code coordinator 和 Super-agent router 是"常驻、异步、可插话"的，Roo 的父任务在子任务期间被关。灵鲸属于 B 类的常驻异步变体。

### Cited Findings（汇总上文，出处见各节）

| 产品 | 主 agent 被拿掉的工具 | 默认派不派 | 派活判据（原文要点） | 后台 / 异步 | 结果怎么回来 | 主 agent 怎么保持能接话 | 对子 agent 结果的信任 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code 默认 | 无 | 按需；Pro 档"用户不要求不派" | 目标已知就直接用工具；派只给开放问题或对口类型 | 子 agent 默认后台 | 后续回合的 user 角色通知 | 默认后台"so the user can interject"；Bash 为送达新消息自动转后台 | "Trust but verify" |
| Claude Code coordinator | 写、改文件（Bash 只读） | 必须派（自己不干活） | 别拿 worker 读文件、跑命令；简单任务别铺开 | worker 异步 | `<task-notification>` XML | 派完一句话告知用户即结束回合 | 先看 diff 再说成功 |
| Roo Orchestrator | 全部（`groups: []`） | 必须派 | 交接五要素；摘要是唯一事实来源 | 无，父任务被关 | 父任务重开后的 tool_result | 不能，用户和子任务对话 | 摘要即事实 |
| Kilo orchestrator（已弃用） | 改文件、bash（强制） | 必须派 | 按依赖分批；可能改同文件的分批；拿不准串行 | 前台 / 后台都有 | 子会话的最终回复 | 后台时可以 | "generally be trusted" |
| Codex CLI | 无 | **不派**，除非用户或 AGENTS.md 明说 | 关键路径自己做，旁支才派；写入集不重叠 | 子 agent 后台 | mailbox / wait_agent | wait 因用户插话提前结束；orchestrator 模板：用户提问先答 | explorer 一般信任；worker 结果要复查 |
| Gemini CLI | 无 | **必须**按专长派 | >3 个文件或重复步骤、大量输出、试错调研派；1–2 轮的外科式任务自己做 | 有后台执行 | 一条摘要 | user_steering 注入 | — |
| Cline | 无 | 模型自定 | 已知文件的小任务不派 | 无，同步等 | 工具返回 | 不能 | — |
| OpenHands SDK | 无 | 默认关 | 一条 grep 能答的、改文件、上下文已够的不派 | 无，阻塞 | 工具返回 | 不能 | "authoritative" |
| Goose | 无 | 自主模式下模型自定 | 子 agent 不能协调；写入严格分文件 | 串行默认，可并行 | 完成才返回；超时无输出 | — | — |
| OpenCode | 无 | 模型自定 | 后台只给独立工作 | 前台默认，可后台 | `<subagent>` 消息 | 后台时可以 | — |
| Hermes | 无 | 模型自定 | USE FOR / DO NOT USE FOR 清单 | 顶层**总是**后台 | 回合之间的新消息 | 给一句状态就结束回合；忙时 interrupt / queue / steer | "SELF-REPORTS"，副作用要句柄、自己核实 |
| Super-agent router | 写、改文件（bash 5 秒沙箱） | 必须派（不许自己调查） | 不加计划、不改写需求；只转原始引用 | worker 异步 | 报告作为消息到达 | 绝不等待；普通进展不叫醒 | 缺事实就等报告，不自己查 |
| Devin manager | — | "when it makes sense" | — | child Devin 在独立 VM | 唤醒 coordinator | 睡眠中也会被叫醒，不轮询 | child 自己先核验 |
| Manus | 无子 agent 工具（早期）；后来 agent-as-tool | 谨慎 | 只看最终输出的短任务传指令，要历史的才共享上下文；≥10 项用 Wide Research | Wide Research 并行 | schema + 约束解码 | 新消息先回；首条只确认收到；logits 屏蔽强制回复 | — |
| Kimi swarm | — | 训练出来 | 只有缩短关键路径才多开 | 并行 | 汇总 | — | — |

**数字汇总**
- 并发与深度：Codex 6 线程 / 深度 1；Hermes 10 并发 / 深度 1、250 轮；Goose 5 并发 / 5 分钟 / 1000 轮；Gemini 子 agent 不能再派；Cursor 嵌套一层；Kimi 子 agent 100（K3 号称 300）。
- 规模：Anthropic 1 个 agent 3–10 次调用 / 2–4 个 / 10+；Manus ≥10 项、第 8–9 项开始编造；SWE-grep 每轮 8 个并行调用、最多 4 轮；Kimi BrowseComp 主 agent 15 步、子 agent 100 步；Gemini >3 个文件、1–2 轮。
- 成本与效果：Anthropic 多 agent 约 15 倍于聊天的 token、效果 +90.2%；Aider architect + editor 85% 对单模型 79.7%；Super-agent 去掉订阅直通主会话决定数 +30%；Kimi 最多快 4.5 倍。
- 已知问题：Kimi 串行坍缩、虚假并行；Super-agent 中性提示词 5 次都没派；Cognition 发现 manager 指示过细、以为和子 agent 共享状态、不主动向上汇报，弱主模型当不好 smart-friend 的主模型；Anthropic 主 agent 同步等是瓶颈；Manus 沙箱 CLI 不适合低延迟前端交互。

### Inferences
- 〔推理〕"默认派不派"的写法南辕北辙（Codex 不许、Gemini 必须、Claude Code 看档位、Super-agent 实验里模型不派），说明靠提示词定倾向两头都不可靠。可靠的只有两种：收工具（B 类）和训练（Kimi）。灵鲸 R2 选收工具，有充分的外部依据。
- 〔推理〕所有异步设计的结果回传都收敛到同一形态：**结果以一条带来源标记的 user / 系统消息在回合之间到达，主 agent 被明确告知"不是用户在说话、不要等、不要轮询、不要编造"**（Claude Code、Hermes、OpenCode、Super-agent、Devin、Gemini）。灵鲸的"活的汇报以经历流事件 followup 总会话"符合主流，提示词里应补上"这是内部信号，不是主人在说话"这一句。
- 〔推理〕信任度分两派：OpenHands、OpenCode、Kilo、Codex explorer 偏信任；Claude Code、Hermes、Codex worker 偏核验。分界是**有没有外部副作用**：只读结果可信，写入与外部动作要核验。灵鲸 tasks 的"核验在待验收之前"属于后者，对路。

### Gaps
- 闭源产品（Cursor、Devin、Grok）主 agent 的系统提示原文都拿不到，只能用官方文档描述的行为代替。

---

## Q17 对灵鲸的启示（对照 `four-layers.md` §1–§2 与 R1–R6）

### Takeaway
外部证据整体支持灵鲸的骨架：工具集划界（R2）、不许等待（R4）、结构化回传、派出去的不对外说话、不写共享记忆（Hermes 的禁用清单）。有四处可以补强：①把"当场答还是 ponder"写成 Codex 式的"关键路径 vs 旁支"判据，并写清"垫话就是关键路径上的回应"；②沉默做成显式的 no-reply 工具调用（Claude Code coordinator 变体）；③通知在提示词里标明"内部信号，不是主人在说话"；④更正草稿里"Super-agent router 不装 shell"的说法。另有一个风险要单列测：弱主模型不知道何时该求助（Cognition 的 SWE 1.5 案例）。

### Cited Findings
- 收工具逼派活有先例：Roo `groups: []`、Kilo `"*": "deny"` + 强制 `bash: deny`、Claude Code coordinator 只读 Bash、Super-agent router `write: false, edit: false`（出处见 Q1、Q2、Q15）〔一手〕。
- 派出去的不得以主体名义行事：Hermes `DELEGATE_BLOCKED_TOOLS` 禁 clarify、memory、send_message、cronjob_manage〔一手，Q12〕；Super-agent "Workers report internally; the orchestrator owns human-facing ticket updates"〔一手，Q15〕；Claude Code "The agent's final report is not shown to the user — relay what matters"〔一手，Q1〕。
- 不等待、回合之间送达：Super-agent "never wait for them with sleep, polling or job waits; end the turn"；Hermes "delivered only BETWEEN your turns … give a one-line status and END YOUR TURN"；Claude Code coordinator "After launching agents, briefly tell the user what you launched and end your response"〔一手〕。
- 先回应再干活：Manus（泄露）"Reply immediately to new user messages before other operations / First reply must be brief, only confirming receipt"〔二手〕；Manus 官方 "when the user provides a new input, Manus must reply immediately instead of taking an action"〔一手〕。
- 关键路径判据：Codex "Do not delegate urgent blocking work when your immediate next step depends on that result"〔一手〕；Kimi "spawning more subtasks only helps if it shortens the critical path"〔一手〕。
- 通知不是对话对象：Claude Code coordinator "Worker results and system notifications are internal signals, not conversation partners — never thank or acknowledge them"〔一手〕；Manus（泄露）"Events from Planner, Knowledge, and Datasource modules are system-generated, no reply needed"〔二手〕。
- 显式沉默：Claude Code coordinator 变体 "every turn must end in a comms-tool call (reply, react, or an explicit no-reply)"〔一手〕。
- 结构化回传：Manus 主 agent 定 schema + 约束解码，"do not use free form summarizations"〔二手〕；Hermes `output_schema` 校验加一次修正重试〔一手〕；SWE-grep 返回文件加行号〔一手〕；Gemini codebase_investigator 返回 JSON〔一手〕。
- 用户的批准要原样转交：Claude Code coordinator "quote their exact words in the worker's prompt"〔一手〕；Super-agent "Use the actual source trigger ID, not your own rewrite"〔一手〕。
- 弱主模型的风险：Cognition "SWE 1.5 was not good enough at being the primary model for this setup"〔一手〕；Kimi 串行坍缩〔一手〕；Super-agent 实验 5 次未派〔二手〕。
- 想与做分开、执行方不继承历史：Aider editor `cur_messages = []`，85% 对 79.7%〔一手〕；Manus "separate agent that has a different perspective"〔二手〕；Amp Oracle "never edits files"〔一手〕。

### Inferences
- 〔推理〕**R2（没有那种工具就只能派）**：外部证据最强的一条。B 类五个产品都这样做；A 类各家提示词的默认倾向互相矛盾（Q16），反证提示词不可靠。保持。
- 〔推理〕**R4（不能挡住对话）**：与 Claude Code coordinator、Hermes、Super-agent 一致。建议总会话的提示词照抄三句的意思：①汇报和结论会作为事件自己到达，绝不等待；②这些事件是内部信号，不是主人在说话，不用回应事件本身，只在有值得告诉主人的事实时说；③派完一句话告诉主人就结束回合。
- 〔推理〕**"当场答还是 ponder"的那条提示词**（§2.3 末段）建议改成 Codex 式的两步：先判断主人此刻等的是什么（关键路径）；一句话能答、不翻账本、不涉及她立场的，当场答；否则关键路径上只需要"回应"，即垫话 + `ponder`，结论作为旁支回来再说。这比"重不重"更好判，也和 Manus 的"首条只确认收到"一致。
- 〔推理〕**R10 兜底的补强**：加一个 `pass(理由)` 或 `no_reply(理由)` 工具，主人发起的回合必须以 reply、say、`dispatch` / `ponder` 或 no_reply 之一结束。沉默变成可审计的决定，R10 只需检测"什么都没调"。依据是 Claude Code coordinator 变体。
- 〔推理〕**交接包**：照 Super-agent 与 Cognition 的教训，总会话不改写需求、只附原话编号与 ≤30 词的路由备注（灵鲸决策 14 已有此意，可以把"≤30 词、只写路由背景与主人的明确约束"写成 `dispatch` 参数的硬限制）。照 Roo 的交接五要素，交接包里加一句"本交接优先于该活种类的通用指令"。
- 〔推理〕**回传格式**：`conclude{事实栏, 意图}` 与 Manus、Hermes 的 schema 回传同构；可借 Hermes 的做法——校验失败给一次修正机会，原文保留不丢。
- 〔推理〕**第三层的禁用清单**：建议照 Hermes 明写成工具档的否定清单：不能问主人（回问经 `ask` 到总会话）、不能写账本（只能 `inner` / `submit` 提案）、不能投递、不能排期、默认不能再派想事活。现在散在 §1 的"不做"列和 §3.1 的工具档里，集中成一条更好查。
- 〔推理〕**确认收到由谁发**：Super-agent 让 worker 发 ack（写它理解的具体改动），router 只发结果。灵鲸可以让手在开工时回一个结构化的"我理解要做的是 X"，由总会话转述或在主控台显示。这是低成本的误解探测，列给设计 agent 评估。
- 〔推理〕**风险单测**：弱主模型的"何时求助"判断（当场答错的比例、该 ponder 没 ponder 的比例）应作为 M4 评测的独立指标，与"想念过线说不说"并列。依据：Cognition 的 SWE 1.5 案例、Kimi 的串行坍缩。
- 〔推理〕**对草稿的更正**：`four-layers.md` §2.1 和 R2 的依据栏把 Super-agent router 预设写成"不装 shell"，与 `cordis.patch.yml` 不符（装了 5 秒沙箱 bash 与 tool-jobs）。按全局原则"改在根上"，应直接把依据改成实情，并说明灵鲸比原型更严。

### Gaps
- 没有找到任何公开产品把"主会话用便宜模型、深度思考异步派给强模型、结论以事件回来"做成默认架构并给出评测数据；Amp Oracle 最接近，但它是同步的，没有数据。灵鲸的这一组合仍是未验证的设计点。
