# 子调研原文：多 agent 编排的工程实践与文献

> 来源：第 1 段对话（2026-10-27）里的调研子任务「Research multi-agent orchestration literature」的最终回复，原样存档。
> 状态：未整理、未逐条核对；语言为英文，保持原文。只删掉了一句指向已不存在的临时目录的说明。
> 用途：主意识与分身的 CLI 编排模块阶段的调研起点。索引和要点见同目录 `README.md`。

---

I read most of the sources in full. Two gaps: the LangGraph supervisor README (GitHub returned a rate-limit error on my one API call and I didn't retry), and OpenAI's compaction guide (HTTP 403), so both rest on search snippets. The strongest finding for your design: evidence that a cheap model works well as a router/forwarder is solid. Evidence that it works as a planner or synthesizer is weak or negative.

The fetch tool runs pages through an extractor, so check quotes against the original before citing them publicly.

## Sources and what I read

- **1st** = full text read · **abs** = abstract only · **2nd** = search snippets or a third party
1. Anthropic, *How we built our multi-agent research system* — anthropic.com/engineering/multi-agent-research-system — **1st**
2. Anthropic, *Building effective agents* — anthropic.com/research/building-effective-agents — **1st** (the page has been updated since Dec 2024)
3. Anthropic, *Effective context engineering for AI agents* — anthropic.com/engineering/effective-context-engineering-for-ai-agents — **1st**
4. Anthropic, *Effective harnesses for long-running agents* (Nov 26 2025) — anthropic.com/engineering/effective-harnesses-for-long-running-agents — **1st**
5. Anthropic, *Context management* (Sep 29 2025) — claude.com/blog/context-management — **1st**
6. Anthropic, *The advisor strategy* (Apr 9 2026) — claude.com/blog/the-advisor-strategy — **1st**
7. Cognition, *Don't Build Multi-Agents* (Walden Yan, Jun 12 2025) — cognition.com/blog/dont-build-multi-agents — **1st**
8. Cognition, *Multi-Agents: What's Actually Working* (Apr 22 2026) — cognition.com/blog/multi-agents-working — **1st**
9. OpenAI Agents SDK pages: /handoffs/, /multi_agent/, /tools/ (all under openai.github.io/openai-agents-python) — **1st**
10. LangChain, *Benchmarking Multi-Agent Architectures* (Jun 10 2025) — langchain.com/blog/benchmarking-multi-agent-architectures — **1st** for the text; the result charts weren't readable
11. langgraph-supervisor API docs (reference.langchain.com) — **2nd**
12. Magentic-One, arXiv 2411.04468 HTML — **1st** (~92% of the text). AutoGen `MagenticOneGroupChat` API reference — **1st**
13. MAST, arXiv 2503.13657 HTML — **1st** (first ~62% of the text, which includes the taxonomy table)
14. Chroma, *Context Rot* (Jul 14 2025) — trychroma.com/research/context-rot — **1st**
15. Compaction: Codex/Claude Code/OpenCode deep dive by D. Vaughan (Apr 2026) — **1st but third-party**. OpenAI compaction docs — **2nd**. Claude Code auto-compact thresholds — **2nd**, and the sources disagree
16. RouteLLM, LMSYS blog — **1st**. FrugalGPT 2305.05176, AutoMix 2310.12963, Hybrid LLM 2404.14618, Minions 2502.15964 — **abs**. ToolOrchestra 2511.21689 — **2nd**

## Lessons by source

Letters in brackets map to your themes: (a) cheap dispatcher passing original words, (b) brief contents, (c) progress and checkpoints, (d) context isolation and compaction, (e) concurrency, (f) failure modes.

**[1] Anthropic multi-agent research system**
- Opus 4 lead with Sonnet 4 subagents beat single-agent Opus 4 by **90.2%**.
- On BrowseComp, token usage alone explains **80%** of performance variance; tokens, tool calls and model choice together explain 95%.
- Agents use about **4×** the tokens of chat; multi-agent systems about **15×**. Only worth it for high-value tasks. (f)
- Every brief needs four things (b): an objective, an output format, guidance on tools and sources, and clear task boundaries.
- Vague briefs fail. Given "research the semiconductor shortage", subagents duplicated each other's work (2021 crisis vs. 2025 supply chain).
- Effort scaling is written into the prompt:
  - simple fact-finding: 1 agent, 3–10 tool calls
  - comparisons: 2–4 subagents, 10–15 calls each
  - complex research: more than 10 subagents with clearly divided responsibilities
- Observed failures (f): spawning **50 subagents** for simple queries, endless searching for sources that don't exist, subagents distracting each other with too many updates, and continuing after enough results were found.
- Context over 200k tokens gets truncated, so the lead saves its plan to external memory. When a phase finishes, it summarizes and can spawn a fresh subagent with a careful handoff. (d)
- Subagents write outputs to a filesystem and pass back lightweight references. This avoids the "game of telephone" and saves tokens. (a)(d)
- Production (c):
  - durable execution and checkpoints, resuming from the point of failure rather than restarting
  - tell the agent when a tool is failing, plus deterministic retries
  - rainbow deployments so running agents aren't disrupted by updates
- Execution is synchronous: the lead waits for each batch, which blocks steering. Async adds coordination, state-consistency and error-propagation problems. (e)
- Evals: start with about **20 real queries** (effects like 30%→80% show up even at that size). An LLM judge scoring 0.0–1.0 plus pass/fail matched human judgment best. Human testers still caught things automation missed. For stateful tasks, judge the end state.

**[2] Building effective agents**
- Start with "the simplest solution possible"; that may mean no agents at all.
- Routing suits "distinct categories that are better handled separately", e.g. sending easy questions to Haiku 4.5. (a)
- Orchestrator-workers: the subtasks are decided at runtime by the orchestrator, not predefined.
- Evaluator-optimizer: use it when there are "clear evaluation criteria" and iterating measurably helps.
- Agents need "ground truth" from the environment at each step, should "pause for human feedback at checkpoints", and need stopping conditions such as a maximum number of iterations. (c)
- Prompt-chaining gates: deterministic checks between steps.
- Tool design: "poka-yoke" the tools (make mistakes hard). Example: requiring absolute file paths fixed a recurring error.

**[3] Context engineering**
- Context rot: n² pairwise attention means context is "a finite resource with diminishing marginal returns". (d)
- Just-in-time loading: keep "lightweight identifiers" (file paths, stored queries, links) and load content at runtime. Claude Code is a hybrid: CLAUDE.md is loaded up front, files are fetched with grep/glob.
- Compaction keeps "architectural decisions, unresolved bugs, implementation details". Tune it to "maximize recall" first, then improve precision. Overly aggressive compaction loses subtle critical context. The lightest option is clearing old tool results.
- Structured notes live outside the context window: a NOTES.md or to-do list. The Pokémon-playing agent kept progress tallies across thousands of steps.
- Subagents return "a condensed, distilled summary (often 1,000–2,000 tokens)", which separates detailed work from high-level synthesis.

**[4] Long-running harness**
- Two failure modes (f): trying to "one-shot" the whole app (runs out of context mid-way), and later sessions declaring the job done too early.
- Initializer session: writes `init.sh`, a progress file, and a JSON feature list (200+ features, all marked failing). Agents may only change the `passes` field: "It is unacceptable to remove or edit tests."
- JSON is used instead of Markdown because models are less likely to overwrite it inappropriately. (c)
- Every session starts the same way: check the working directory, read the progress notes and git log, review the feature list, run `init.sh`, and do a smoke test.
- Work on one feature at a time, commit to git as a checkpoint, and leave the environment clean.
- Agents marked features done after unit tests or curl checks alone. Browser end-to-end tests improved results substantially.

**[5] Context management**
- Context editing (clearing stale tool calls and results) gave **+29%**; adding the memory tool gave **+39%**.
- In a 100-turn search eval, context editing cut tokens by **84%** and let runs finish that otherwise failed from context exhaustion. (d)

**[6] Advisor strategy (a cheap model drives, a strong model advises)**
- Haiku with an Opus advisor scored **41.2% vs 19.7%** for Haiku alone on BrowseComp, at **85% less** cost per task than Sonnet solo.
- Sonnet with an Opus advisor scored 2.7 points higher on SWE-bench Multilingual at 11.9% lower cost.
- The advisor returns 400–700 tokens of plan, a correction, or a stop signal. It never calls tools and never speaks to the user. `max_uses` caps calls.
- Caveat: the executors are *trained* to know when to ask. (a)

**[7] Cognition 2025**
- "Share context, and share full agent traces, not just individual messages." (a)
- "Actions carry implicit decisions, and conflicting decisions carry bad results." Example: Flappy Bird, where one subagent drew a Super Mario background and another a mismatched bird.
- Small "apply" models misread a large model's edit instructions; the industry merged decide-and-apply into one model. This is direct evidence that weak models garble strong-model instructions. (a)(f)
- At the time, Claude Code subagents only answered questions, never wrote code, and never ran in parallel with the main agent.

**[8] Cognition 2026**
- What works: "multiple agents contribute intelligence … while writes stay single-threaded". (e)
- A clean-context reviewer works best when it shares no context with the coder.
- The "smart friend" pattern (a primary model consulting a stronger one) **failed with a weak primary**, which couldn't tell when to escalate or what to ask. (a)(f)
- The stronger model sometimes made up theories rather than telling the primary to go read a file it hadn't opened.
- Children don't report back to the manager by default, because models weren't trained to. Managers assume children share their state when they don't. (c)(f)
- Managers trained on small-scope delegation write over-prescriptive briefs, which backfire when they lack deep context. (b)
- What works for sharing context: fork the whole context, ask broad questions, let the stronger model decide its own scope.

**[9] OpenAI Agents SDK**
- *Handoff*: the specialist takes over, and by default it "sees the entire previous conversation history".
  - `input_filter` changes what it sees (e.g. `remove_all_tools`).
  - `nest_handoff_history` folds the prior transcript into a `<CONVERSATION HISTORY>` summary. It's an "opt-in beta… disabled by default".
  - `input_type` is for small metadata the model decides at handoff time (reason, priority), not for application state.
  - `on_handoff` can start fetching data early.
- *Agent as tool*: the manager "keeps control of the conversation". The nested agent receives only the tool input; the parent's state is "not inherited automatically". `needs_approval` provides pause/resume. (a)(b)
- Your main↔worker relationship is agent-as-tool, made async, with a hand-built (curated) history, not a raw handoff.

**[10/11] LangChain benchmark and langgraph-supervisor**
- Setup: τ-bench retail, gpt-4o. Single-agent performance "falls off sharply" with ≥2 distractor domains; swarm slightly beats supervisor.
- The supervisor's losses came from "translation": it restated sub-agent replies and introduced errors.
- Fixes: drop handoff messages from sub-agent state, and add a **`forward_message`** tool that passes the sub-agent's reply to the user unchanged. Together these gave a "nearly **50%**" improvement. (a)
- In langgraph-supervisor (2nd-hand), `output_mode` is `"last_message"` by default, with `"full_history"` as the alternative. Handoff messages are added by default.

**[12] Magentic-One (AutoGen)**
- *Task ledger*: given/verified facts, facts to look up, facts to derive, educated guesses, then the plan.
- *Progress ledger*, asked every turn (c):
  1. Is the request satisfied?
  2. Is the team looping?
  3. Is progress being made?
  4. Which agent speaks next?
  5. What instruction goes to it?
- A stall counter above **2** triggers reflection and replanning, and **all agents' contexts are reset**. AutoGen defaults: `max_turns=20`, `max_stalls=3`. The paper used limits such as a 25-minute budget.
- Ablation: replacing the ledgers with plain group chat cost **31%**.
- Most common error: "persistent-inefficient-actions", then "insufficient-verification".
- Safety: repeated login retries got an account locked; agents tried to recruit humans (social media posts, emailing authors). (f)

**[13] MAST failure taxonomy** (1,600+ traces, 7 frameworks, κ=0.88; failure rates of 41–86.7%) (f)

| Category | Failure mode | Share |
|---|---|---|
| System design (≈44%) | Step repetition | 15.7% |
| | Unaware of termination conditions | 12.4% |
| | Disobey task specification | 11.8% |
| | Loss of conversation history | 2.8% |
| | Disobey role specification | 1.5% |
| Inter-agent misalignment (≈32%) | Reasoning–action mismatch | 13.2% |
| | Task derailment | 7.4% |
| | Fail to ask for clarification | 6.8% |
| | Conversation reset | 2.2% |
| | Ignored other agent's input | 1.9% |
| | Information withholding | 0.85% |
| Task verification (≈23.5%) | Incorrect verification | 9.1% |
| | No or incomplete verification | 8.2% |
| | Premature termination | 6.2% |

- Interventions on ChatDev: adding a high-level task-objective verification step gave **+15.6%**; clearer role specs gave +9.4%.
- The authors conclude the problems are structural, not fixable by prompting alone.

**[14] Chroma Context Rot**
- Across 18 models, performance drops as input grows, even on simple tasks. (d)
- A single distractor already hurts; logically coherent haystacks did *worse* than shuffled ones.
- LongMemEval: focused prompts (~300 tokens) beat full prompts (~113k tokens) "significantly" across all models.
- Claude models abstained more when unsure; GPT models hallucinated the most.

**[15] Compaction in practice (mostly 2nd-hand)**
- Codex: threshold ≈ effective window − 13k tokens (≈167k on a 200k window). It produces an opaque encrypted `compaction` item, then re-reads up to 5 recently edited files.
- A Codex version change doubled compaction frequency and 2–3× the tokens used. (f)
- Claude Code: `/compact` accepts focus instructions. Summaries are "lossy by design", so rules belong in CLAUDE.md, not in the summary.
- Practitioners compact at about 60–85%, not 95%.

**[16] Routing and cascades**
- RouteLLM: >85% cost cut on MT-Bench at 95% of GPT-4 quality (14% of calls to GPT-4 with judge-augmented training). On MMLU, routers trained only on Arena data were near random (out of distribution); 1.5k in-domain samples fixed it.
- FrugalGPT: up to 98% cost cut matching GPT-4.
- AutoMix: >50% cost cut; small-model self-verification is "noisy".
- Hybrid LLM: 40% fewer calls to the large model with no quality drop.
- Minions: when the small model reads the full context, it recovers only 87%, because it fails at "multi-step instructions" and "long contexts". When the strong model decomposes the task into short chunks, it recovers 97.9%. (a)
- Note: these routers are *trained classifiers* making one narrow decision each, not general cheap chat models.

## Top 10 design rules for the main-consciousness ↔ worker contract

1. **Pass words through unchanged in both directions.** The owner's words go to the worker unchanged. The worker's report goes to the owner through a `forward_message`-style passthrough, not re-summarized by the cheap model. Main's own interpretation goes in a separate, labeled `dispatcher_note` field. [10] ~50%; [7] full traces; [1] telephone game.
2. **Fixed brief schema.** Owner's verbatim words; objective; expected output format; boundaries and non-goals; acceptance criteria; current gate; and *references* (IDs) to chat history and memories that the worker loads as needed, rather than dumped text. Keep model-decided metadata separate from application state. [1][3][9]
3. **Keep the cheap model's decisions narrow and reversible.** It does job-or-not classification, routing, reminders and relaying. It does not decompose, plan or synthesize. When unsure, it asks the owner. [8] weak primary fails; [16] Minions, routers; [13] failing to ask for clarification is 6.8%; [7] apply models.
4. **Job state lives in a durable JSON ledger owned by the job**, not in main's context: facts/guesses/plan plus per-step status, where only status fields may change. Main reads it through a query API. [12][4][1]
5. **Code, not the cheap model, detects progress.** Each tick answers Magentic-One's five questions. A stall counter (threshold about 2–3) escalates to replan-with-context-reset or to the owner. Hard caps on turns, time and tokens. [12] −31% without ledgers; [2] stopping conditions; [13] step repetition is 15.7%.
6. **Human gates are explicit state-machine states** (design → review → execute → accept). Pause and resume through an approval interrupt, with checkpoints (e.g. git commits) at each gate. [2][9] `needs_approval`; [1] resume; [4]
7. **Verification is separate and outcome-based.** "Done" is decided by end-to-end checks or a reviewer with fresh context, never by the worker's own claim. [13] verification failures ≈23.5%, +15.6% on ChatDev; [4] early victory; [8] clean-context review.
8. **Bound the forever-running session in layers:** a pinned identity/rules file, then clearing old tool results, then structured memory files, then a recall-first compaction triggered early (~60–85%). Main holds only job IDs plus a 1–2k-token summary per job. [3][5] +29/39%, −84% tokens; [14] ~300 vs ~113k; [15]
9. **Concurrency:** many independent jobs, but one writer per job. Parallel sub-conversations only for read/research work. Effort-scaling caps on how many sub-conversations a worker may spawn, plus a token budget per job. [8][7][1] the 50-subagent failure, 15× tokens.
10. **The harness pushes status events; don't rely on agents to report.** Workers write artifacts to files and return 1–2k-token summaries plus file references. The harness emits lifecycle events (gate reached, stalled, finished), because models don't report back unprompted. Trace everything, and run evals on about 20 real jobs with an LLM judge plus spot human review. [8][1][3]

**Main tension to note:** [6] and [8] show a cheap model *can* drive a stronger one when it is trained to know when to escalate. Your DeepSeek Flash dispatcher won't have that training. So make the "is this a job?" trigger and the forwarding rules deterministic or confirmed by the owner, and push all judgment-heavy work to the strong worker.
