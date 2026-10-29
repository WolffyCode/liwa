# 子调研原文：Paseo 上游与 OpenClaw 的编排机制（子 agent、队列、ACP、压缩、失败切换）

> 来源：第 1 段对话（2026-10-27）里的调研子任务「Research Paseo upstream and OpenClaw」的最终回复，原样存档。
> 状态：未整理、未逐条核对；语言为英文，保持原文。只删掉了一句指向已不存在的临时目录的说明。
> 用途：主意识与分身的 CLI 编排模块阶段的调研起点。索引和要点见同目录 `README.md`。

---

I covered both topics. Paseo upstream has moved from 0.11.1 to **0.14.0-beta.1**, but `agent-sdk-types.ts` barely changed. The real orchestration changes are in the daemon: how agent-to-agent messages are delivered, durable finish notifications, and releasing idle runtimes. OpenClaw (latest npm **2026.10.8**) is documented below with exact tool names, config keys and defaults.

Tags: **[C]** = I read it first-hand in the source or docs. **[I]** = my inference. I used 5 GitHub API calls (3 worked; 2 hit the shared rate limit, which another researcher had already used up). Everything else came through raw.githubusercontent.com, npm and docs.openclaw.ai. No local repo was modified.

## Sources
- **Paseo:**
  - GitHub releases API, `getpaseo/paseo/releases?per_page=15` (partial download; bodies for v0.12.0-beta.2 to v0.14.0-beta.1).
  - Upstream `main` files via raw.githubusercontent.com: `CHANGELOG.md` (first 90KB), `packages/server/src/server/agent/agent-sdk-types.ts`, `agent/tools/paseo-tools.ts`, `mcp-server.ts`, `system-prompt.ts`, `docs/providers.md`, `docs/agent-lifecycle.md`, `docs/timeline-sync.md`, `docs/connected-hosts.md`. Each was diffed against the local Helm copy.
  - npm `@getpaseo/server/latest`.
- **OpenClaw (docs.openclaw.ai):** `llms.txt`, `/concepts/session`, `/concepts/main-session`, `/concepts/multi-agent`, `/concepts/architecture`, `/concepts/queue`, `/concepts/queue-steering`, `/concepts/session-tool`, `/concepts/session-pruning`, `/concepts/model-failover`, `/concepts/usage-tracking`, `/concepts/system-prompt`, `/concepts/subagent-yield-handoff`, `/tools/subagents` (+ `/tool-reference`, `/announce`, `/nesting`, `/operations`), `/tools/acp-agents` (+ `-setup`, `/delivery`), `/plugins/reference/acpx`, `/reference/session-management-compaction/compaction` and `/housekeeping`, `/gateway/heartbeat`, `/gateway/config-tools/sessions-and-subagents`. Also npm `openclaw/latest`.
- **Issues:** one GitHub search call (`repo:openclaw/openclaw subagent announce`), plus WebSearch (third-party sites: getclawkit.com, betterclaw.io, claudeissues.com).

## Topic 1: Paseo upstream vs Helm

**Versions [C].** The fork is based on upstream around 2026-10-08 (0.11.1 plus a few commits that later shipped in 0.12.0, e.g. #6330, #6334). Since then upstream released 0.11.2–0.11.4 (Hoplite ACP provider, provider catalog search), 0.12.0 (10-19), 0.13.0 (10-24), 0.13.2 (10-26) and 0.14.0-beta.1 (10-27). npm `@getpaseo/server` latest is 0.13.2.

**`agent-sdk-types.ts` diff (local 818 lines vs upstream 822) [C]:**
- **Added** `AgentSession.canStopRuntime?(): Promise<boolean>`. It is an optional extra veto on releasing an idle runtime; a missing method falls back to the daemon's own eligibility rules.
- **Added** `AgentLaunchContext.mcpServers?: Record<string, McpServerConfig>` and `mcpServerOwners?: Record<string,string>`. These are plugin MCP servers for launch only, never persisted.
- **Added** `ToolCallBase.agentMessage?: AgentMessage` (imported from `@getpaseo/protocol/agent-message`). It marks a timeline row as a delivered agent message rather than a provider tool call.
- **Only in Helm:** `AgentClient.resolveNativeSessionPath?(handle)`. You added it in local commit eb560d44e, so keep it when rebasing.
- **Unchanged:** `run`, `startTurn`, `steerActiveTurn?`, `subscribe`, `streamHistory`, `describePersistence`, `interrupt`, `close`, `usageSession?`, `tryHandleOutOfBand?`, `createSession`/`resumeSession` (with the `"interactive"|"history"` resume purpose), `fetchCatalog`, `import*`, `archiveNativeSession?`, `shutdown?`.

**MCP tools [C].**
- Upstream adds `list_hosts`, and a `serverId` argument on `create_workspace`, `list_workspaces`, `create_agent`, `send_agent_prompt`, `get_agent_status`, `get_agent_activity` and `list_agents` (agents on other machines, 0.13.0).
- `send_agent_prompt` gains `activeTurnBehavior: "steer"|"interrupt"`. It defaults to steer when the caller is an agent and interrupt otherwise (#5164); steer falls back to interrupt if the provider can't steer.
- Agent callers now get a queued receipt; delivery happens after "two quiet seconds per recipient".
- The `notifyOnFinish` default is true for agent-scoped calls and false for top-level calls.
- Upstream `create_agent` no longer has the legacy `background` flag (local: "If false (default), waits for completion"). [I] Creation is now always asynchronous and relies on `notifyOnFinish`.

**Agent-layer changes, from the changelog and docs diffs [C]:**
- **Idle runtime release (#7782).** Idle resumable runtimes are released after one hour, checked every minute. The agent record and provider session are kept, and the next prompt resumes. Config is `agents.idleRuntimeCleanup: false`. Collection is blocked by foreground runs, pending permissions, queued deliveries, working children and outstanding finish subscriptions. The docs list per-provider checks (Claude background roster with CLI ≥2.1.292, Codex terminal-list RPC, OpenCode, Pi, OMP, ACP).
- **Agent-message delivery module.**
  - Human prompts go straight to the agent. Agent messages and automatic notifications go through a delivery queue: a receipt is acknowledged on admission, then dispatch happens after a 2-second quiet window.
  - That pending window is held in memory, so a crash can lose queued prompts.
  - A child's report and its finish notification now reach the parent as one message (#7561).
  - The sender's name is attached to agent messages (#6373).
- **Durable finish subscriptions.** They are stored in `$PASEO_HOME/finish-subscriptions.json` and restored at boot, giving at-least-once wakeups that can repeat. Related fixes: #7683 (lost after restart), #6008 (child finished very quickly), #6660 (stopped child reported as finished), #7528 (detached creator never notified).
- **Timeline sync.** Whole-turn paging with a soft target of 40 items (`features.wholeTurnTimeline`). Every run, including heartbeats and agent notifications, now owns a visible turn. A typed `agentMessage` payload replaces parsing XML out of tool calls.
- **Background workspaces.** `workspace.background` hides worker workspaces from default lists; `filter.includeBackground` includes them. A child inherits the caller's value.
- **Plugins.** Per-agent plugin tools (#7938) and plugin MCP servers added when a session opens (#7983).
- **Other fixes.** Claude Code was burning subscription limits faster under Paseo (#7976). Daemon ran out of memory on long OpenCode v2 streams (#6262). Opening or importing large Claude histories crashed the daemon (#7431, #7626). Two schedule fixes (#6334, #6532). Pi messages sent during compaction now wait (#7848). Plugin ACP agents now accept steer (#7270). New `paseo usage` CLI (#6474).
- **Providers.** No new built-in AgentClient types; Hoplite was added through the ACP catalog. ACP history replay spawns the CLI, replays via `session/load`, then exits.

**What matters for one main session plus many workers [I]:**
1. **Must-have:** the delivery queue with steer-by-default for agent senders plus durable finish subscriptions. This is the "report back to the main consciousness" path. Expect at-least-once delivery and design the main session to be idempotent.
2. **Must-have:** idle release plus `canStopRuntime`, so a pool of mostly idle workers doesn't keep a CLI process each.
3. `agentMessage` provenance and whole-turn timelines, for rendering worker reports in the main chat.
4. Per-agent tools via `mcpServers`/`mcpServerOwners`, so each worker gets its own capability set.
5. Background workspaces, to keep workers out of the owner's view.

`serverId` (other machines) can wait.

## Topic 2: OpenClaw (npm 2026.10.8)

**Gateway and session model [C]**
- **Gateway.** One long-lived Gateway per host owns every channel. Clients and nodes talk to it over WebSocket at `127.0.0.1:18789`. `send` and `agent` need idempotency keys. Events are not replayed, so clients must refresh after gaps.
- **Main session.** Key is `agent:<agentId>:main` (`agent:main:main`); a custom `session.mainKey` is ignored.
  - All DMs collapse into it by default: `session.dmScope` default `"main"`, alternatives `per-peer`, `per-channel-peer` (recommended) and `per-account-channel-peer`.
  - Groups stay separate (`session.groupScope: "per-group"`), but the main session watches them through coalesced notices.
  - Sub-agent results announce back to the session that started them.
  - The proactive check runs in the main session.
- **Other keys.** Sub-agent `agent:<id>:subagent:<uuid>`; ACP `agent:<id>:acp:<uuid>`; threads add `:thread:<id>`; `incognito-` is reserved; cron gets a fresh session per run.
- **Reset.** `session.reset.mode` default `"none"` (compaction manages context); options `daily` (`atHour: 4`) or `idle` (`idleMinutes`). There are also `resetByType` and `resetByChannel`.
- **Storage.** Sessions live in `~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite`; the old `sessions.json` is a legacy migration source only. `session.maintenance` defaults: `pruneAfter: "30d"`, `maxEntries: 5000`, `maxDiskBytes` default `10gb`.
- **Multi-agent.** Config is `agents.entries.<id>` with workspace, agentDir, model, sandbox, tools and subagents (legacy `agents.list` is migrated by `openclaw doctor --fix`).
  - Each agent has its own workspace, agentDir, auth and session store.
  - `bindings[{agentId, match:{channel, accountId, peer:{kind,id}, guildId}}]` match most-specific first. Unmatched traffic goes to `agents.defaults.systemAgent` and is otherwise not dispatched.
  - Never reuse an `agentDir` across agents.

**Sub-agents [C]**
- **`sessions_spawn`** is non-blocking and returns `{status:"accepted", runId, childSessionKey}`. Only `task` is required. Main parameters:
  - `runtime`: `subagent` (default) or `acp`.
  - `mode`: `run` (default) or `session` (needs `thread:true`).
  - `context`: `isolated` (default) or `fork`, which copies the parent transcript including tool results. Fork is the default for thread-bound spawns; oversized forks start isolated.
  - `cleanup`: `keep` (default) or `delete`.
  - `expectsCompletionMessage`: default true.
  - `completionTarget: "parent"`: result comes back in a private parent turn.
  - Others: `runTimeoutSeconds` (0 = no limit), `model`, `thinking`, `sandbox: "inherit"|"require"`, `visible`, `worktree`, `blind`, `taskName`, `label`, `agentId`.
- **Companion tools.** `sessions_yield` ends the parent's turn, and the settled children's batch starts a successor turn. `subagents` supports `list`, `wait` (`runIds` 1–32, `timeoutSeconds` ≤60, default 30) and `cancel`.
- **Limits** (`agents.defaults.subagents.*`):
  - `maxConcurrent` 8 per spawning session; extra accepted runs queue.
  - `maxChildrenPerAgent` 5 (range 1–20).
  - `maxSpawnDepth` 5 (range 1–5).
  - `announceTimeoutMs` 120000 per attempt.
  - `archiveAfterMinutes` 60.
  - `allowAgents` defaults to the same agent only.
  - `delegationMode` is `prefer` in an agent's main session and `suggest` elsewhere.
- **Swarm collectors** (`collect:true`): `tools.swarm.maxConcurrent` 32, `maxChildrenPerGroup` 50, `maxTotalPerGroup` 200.
- **What the child sees.** It gets `promptMode: minimal`, which drops memory recall, user identity, messaging and silent-reply sections. Only `AGENTS.md` is injected (not SOUL, USER, MEMORY, IDENTITY or BOOTSTRAP).
- **Child tools.** No session or message tools by default. An orchestrator below max depth gets `sessions_spawn`, `subagents`, `sessions_list` and `sessions_history`; a leaf at max depth gets no orchestration tools.
- **Auth.** Resolved by agent id; shared auth profiles are a fallback.
- **Announce (result return).**
  - The block contains: source, child key/id, type and label, a status derived from the runtime outcome (ok, error, timeout, unknown), and the child's latest visible text.
  - A stats line gives runtime, tokens, and cost (only if `models.providers.*.models[].cost` is set).
  - Results are capped at 160,000 characters, with a truncation pointer to `sessions_history`, which truncates each text field at 4,000 characters.
  - A top-level requester gets a follow-up `agent` call; a nested requester gets an internal injection. Only the child's own final answer goes up the chain.
  - A child that replies `NO_REPLY` or nothing counts as a missing answer and triggers recovery, not success.
  - Recovery: unfinished children resume after a restart; at most 8 recoveries run at once; suspended deliveries expire after 7 days.
- **Stopping.** `/stop` or `sessions.abort` cascade to the whole child tree. Parent completion, yield or timeout does **not** cancel accepted children.

**Session tools [C]**
- `sessions_list`, `sessions_history` (tool results off by default; 80KB per response), `sessions_search`, `sessions_create`, `session_status`, `sessions` (patch, reset, stop, delete, …).
- `sessions_send` takes `timeoutSeconds` (0 = fire-and-forget; it only limits the sender's wait), `mode` (`steer`, `followup`, `notify` = add context without starting a turn, `resume`) and `watch`.
- Visibility: `tools.sessions.visibility` is `self`, `tree`, `agent` or `all`, default `all`. `tools.agentToAgent.enabled` defaults to true.

**Queue modes for messages arriving mid-run [C]**
- **Modes** (`messages.queue.mode`, default `steer` on every channel):
  - `steer`: injects into the active run.
  - `followup`: one new turn per message.
  - `collect`: merges messages after a quiet window.
  - `interrupt`: aborts the run and runs the newest message.
- **Options.** `byChannel`, `debounceMsByChannel` (500ms built in), `cap` 20, `drop` `summarize|old|new`, `allowCollaborativeSteering: false`. Chat commands: `/queue`, `/steer`, `/followup`, `/stop`.
- **Steer timing.**
  - Steering never interrupts a running tool.
  - With sequential tool calls, the remaining unstarted calls are skipped and get the synthetic result "Skipped to process an incoming message."
  - Parallel tool batches are checked only after the whole batch settles.
- **Runtime support.** Codex app-server batches steers into one `turn/steer`. A CLI backend supports steering only if it registers `registerMessageInjection`; Claude's backend does text-only steering over stream-JSON. Otherwise the message falls back to followup.
- **Lanes.** One turn per physical session at a time. The global `main` lane is capped by `agents.defaults.maxConcurrent`, default max(8, CPU×4). Sub-agent lanes are `subagent:<session>`; heartbeat runs use `cron-nested`.

**ACP agents [C]**
- **Setup.** Plugin `@openclaw/acpx` (`plugins.entries.acpx.enabled`). Keys: `acp.backend: "acpx"`, `acp.defaultAgent`, `acp.allowedAgents`, `acp.dispatch.enabled`, `acp.stream.deliveryMode: "live"`.
- **Harness ids:** claude, codex, copilot, cursor, droid, gemini, opencode, pi, qwen, kimi, kiro and others. Adapters are fetched with `npx` on first use.
- **Permissions.** `config.permissionMode`: `approve-reads` (default), `approve-all` or `deny-all`. `config.nonInteractivePermissions`: `fail` (default; aborts with `PermissionPromptUnavailableError`) or `deny`. Also `config.timeoutSeconds` 120.
- **Bridges and env.** `openClawToolsMcpBridge` and `pluginToolsMcpBridge` are off by default. `agentProcessEnvAllow`/`agentProcessEnvBlock` control env inheritance; by default the child inherits all Gateway env, including credentials.
- **Resume.** `resumeSessionId` resumes via `session/load` (Codex and Claude Code support it); a missing id is a hard error.
- **What the child receives.** A plain prompt, not OpenClaw's internal context envelope.
- **Sandbox.** ACP runs on the host, outside the OpenClaw sandbox. A sandboxed requester cannot spawn ACP.
- **Codex.** The default Codex path is the native app-server harness, not ACP.

**Compaction and pruning [C]**
- **Compaction.**
  - It runs on overflow (compact, then retry) and before inference when usage reaches window minus reserve. The reserve is 20k tokens, capped at a quarter of the window.
  - Keys: `agents.defaults.compaction.enabled`, `keepRecentTokens` 20000, `provider` (setting it forces safeguard mode), `qualityGuard`, `postCompactionSections`, `maxActiveTranscriptBytes`.
  - The summary is a persisted `compaction` entry; history after `firstKeptEntryId` is kept, and tool call/result pairs stay together. A degraded summary always warns.
- **Memory flush before compaction.** A silent turn on a detached copy of the conversation writes `memory/YYYY-MM-DD.md`, once per compaction cycle. Keys: `memoryFlush.enabled` true, `softThresholdTokens` 4000, `forceFlushTranscriptBytes` "2mb". It is skipped for CLI backends and heartbeat turns.
- **Pruning** (`agents.defaults.contextPruning`): `mode: "cache-ttl"`, `ttl` 5m (1h seeded for Anthropic). It is view-only: tool results over 4k characters are soft-trimmed around 30% usage, hard-cleared around 50%, and the last 3 assistant turns are protected. The direct Anthropic API path uses Anthropic's server-side tool-result clearing instead.

**Failover, usage, heartbeat [C]**
- **Failover order.** First rotate auth profiles within the provider (order: `auth.order` then round-robin OAuth > token > API key, oldest `lastUsed` first). The chosen profile is pinned per session until `/new` or cooldown. Then fall back across models with `agents.defaults.model.{primary, fallbacks}`.
- **Cooldowns.** 30s, then 1m, then 5m for ordinary failures. Rate limits use only the provider's reported timing. Billing failures disable the credential for 10 minutes.
- **Strictness.** An explicit `/model` selection never silently falls back. `agents.defaults.timeoutSeconds` applies per fallback candidate.
- **Usage.** `/status`, `/usage off|tokens|full|cost`, `openclaw status --usage`, gateway methods `usage.cost` and `sessions.usage`. Cost is estimated for API-key models only. Provider quota is cached 60s (`models.usage.cacheTtlMs`).
- **Heartbeat is retired.** It became an ordinary automation job, a "Proactive check" in the main session every 30 minutes with `idleOnly`, `activeHours` and `delivery.target`. Quiet runs return `NO_REPLY`. `openclaw doctor` migrates `agents.defaults.heartbeat`.

## Pitfalls
- **OpenClaw GitHub issues [C, titles only]:**
  - #44925 (open): sub-agent completion silently lost, with no retry and no notification on timeout.
  - #148707 (open): reply lost when a second run displaces an in-flight turn on the same session.
  - #86538: session write-lock timeouts block sub-agent delivery lanes.
  - #137332: settle batches retried forever.
  - #143524: SQLite WAL grew to 1.4–2.8GB.
  - #159662 (open): memory leak of about 4–5GB/hour.
  - #87744: Codex-backed turns time out waiting for `turn/completed`.
- **Third-party claims, unverified [I]:** #65465 (configured compaction reserve ignored); #164220 (compaction timing out on a 905k-token session).
- **OpenClaw doc warnings [C]:**
  - Steering does not abort tools in flight.
  - Concurrency caps are per spawning session, not Gateway-wide.
  - Direct announce is best-effort.
  - Cross-agent session access is on by default, and `sessions_history` does not mask secrets.
  - Results sent with `completionTarget: "parent"` are dropped if the parent is reset.
  - A warning fires when the delivery backlog reaches 25.
- **Paseo [C, from its changelog]:** lost or incorrect finish notifications (#6008, #6660, #7528, #7683); daemon out-of-memory or crashes on long streams and histories (#6262, #7431); Claude subscription limits burned faster (#7976). The new pending-message window is in memory and can be lost on a crash.

**Takeaway [I].** The two systems have converged on the same design: async spawn that returns a receipt, an announce or notify back to the parent, a short quiet-window batch, steer by default, durable at-least-once completion, and an isolated child context by default. OpenClaw's limits (5 active children, 8 concurrent, depth 5, `NO_REPLY` treated as a missing result, private parent completions) and its `notify` send mode would be good to adopt on top of Paseo's contract.
