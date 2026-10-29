# 子调研原文：Claude Agent SDK 与 Codex app-server 的编程接口

> 来源：第 1 段对话（2026-10-27）里的调研子任务「Research Claude SDK and Codex app-server」的最终回复，原样存档。
> 状态：未整理、未逐条核对；语言为英文，保持原文。只删掉了一句指向已不存在的临时目录的说明。
> 用途：主意识与分身的 CLI 编排模块阶段的调研起点。索引和要点见同目录 `README.md`。

---

I covered both interfaces using primary sources: the SDK's own type definitions and changelog, and the Codex protocol source. The official doc websites (platform.claude.com, developers.openai.com) refused or blocked fetches, so I couldn't read them directly.

## Sources
1. **anthropics/claude-agent-sdk-typescript `CHANGELOG.md`**, fetched via the GitHub API. Newest entry is 0.3.311 ("parity with Claude Code v2.1.311"). I grepped the whole file.
2. **`@anthropic-ai/claude-agent-sdk@0.3.311` `sdk.d.ts`** (562 KB), from `cdn.jsdelivr.net/npm/...@0.3.311/sdk.d.ts`. npm says it was published 2026-10-26T19:49Z and is `latest`. Its doc comments are the most authoritative SDK source I could reach.
3. **openai/codex `codex-rs/app-server/README.md`** (main branch, 43 KB). It is now only a set of feature notes (read state, rollback removal, personality deprecation, item anchors), not a full protocol guide.
4. **openai/codex `codex-rs/app-server-protocol/src/protocol/common.rs`** plus `v2/{thread,turn,item,shared,notification,collaboration_mode,thread_usage,account}.rs` (main). These give the exact wire method names and fields.
5. **developers.openai.com/codex/app-server** returned 403 and platform.claude.com refused or returned 400. Codex transport facts below come only from search-result snippets of those docs, so I mark them as such.

The shared GitHub API quota ran out after my 6th call (other researchers share it). I switched to `raw.githubusercontent.com`, which does not use the API quota.

---

## 1. Claude Agent SDK (TypeScript, 0.3.311). All first-hand from `sdk.d.ts` or the changelog unless marked.

**Session model**
- `query({ prompt: string | AsyncIterable<SDKUserMessage>, options }) → Query`.
  - `Query` is an async generator of `SDKMessage` plus control methods.
  - The control methods are "only supported when streaming input/output is used."
  - The old v2 session API (`unstable_v2_*`, `SDKSession`) was **removed**. The changelog says to pass an AsyncIterable for multi-turn.
- **Session options:**
  - `resume` (session id).
  - `continue` (most recent session in cwd; can't be combined with `resume`).
  - `forkSession` (boolean; with `resume`, the resumed session gets a new id).
  - `sessionId` (custom UUID; with resume/continue only if `forkSession` is set).
  - `resumeSessionAt` (message UUID) and `resumeDropsTurn`.
  - `persistSession` (default true; false means nothing is written to `~/.claude/projects/` and the session can't be resumed).
  - `sessionStore` (alpha; mirrors the transcript to an external store).
  - `title`.
- The session id is `session_id` on the `system/init` message and on every message. Transcripts are JSONL under `~/.claude/projects/` (honours `CLAUDE_CONFIG_DIR`).
- **Exported session functions:** `listSessions({dir, limit, offset})`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents`, `forkSession(sessionId, {upToMessageId})`, `renameSession`, `tagSession`, `deleteSession`, `importSessionToStore`, `startup()`, `prewarm()`.
- **All `Query` methods:**
  - `interrupt()`, `setPermissionMode()`, `setMcpPermissionModeOverride()`
  - `setModel(model?)`, `setMaxThinkingTokens()` (deprecated in favour of the `thinking` option)
  - `applyFlagSettings()`, `updateSettings()`, `initializationResult()`, `reinitialize()`
  - `supportedCommands()`, `supportedModels()`, `supportedAgents()`
  - `mcpServerStatus()`, `getContextUsage()`, `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`
  - `readFile()`, `reloadPlugins()`, `reloadSkills()`, `reloadOutputStyles()`, `accountInfo()`
  - `rewindFiles()`, `seedReadState()`
  - `reconnectMcpServer()`, `toggleMcpServer()`, `readMcpResource()`, `setMcpServers()`
  - `streamInput(AsyncIterable<SDKUserMessage>)`, `stopTask(taskId)`, `backgroundTasks(toolUseId?)`, `close()`

**Turn lifecycle and pushing input mid-turn**
- Exactly one `result` message per turn; that is the turn-complete signal.
- `SDKUserMessage` fields: `message`, `parent_tool_use_id`, `priority?: 'now'|'next'|'later'`, `shouldQuery?` (false means append to the transcript without starting a turn; it merges into the next message that does), `uuid`, `origin`, `timestamp`, `client_composed`, `pasted_content`, `isSynthetic`.
- **To push mid-turn, just yield another message from the iterable (or call `streamInput`). It goes into the CLI's command queue; it does not interrupt.** Per the `user_message_uuids` doc:
  - Several messages sent close together run as one turn.
  - A queued message is "folded into the running turn between tool rounds."
- `priority:'now'` (changelog): moves running shell commands, agents and MCP calls to the background and joins the running turn instead of stopping it. The exact semantics of `'next'` and `'later'` are not documented; I infer they control queue ordering.
- Tracking queued sends:
  - `result.queued_turn_count` says how many sends are still pending.
  - `command_lifecycle` frames report each uuid's state: `queued`, `started`, `completed`, `cancelled` or `discarded`.
- **Interrupt:** `interrupt()` resolves to a receipt whose `still_queued` lists queued uuids that will still run (capability `interrupt_receipt_v1`).
  - An opt-in `cancel_queued` flag also cancels them.
  - With `perTaskStopAffordance`, interrupt aborts only the current turn and leaves background agents running.

**Persona and instruction injection**
- `systemPrompt` accepts:
  - `string`, or `string[]` with `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marking the split between the cacheable prefix and the dynamic suffix.
  - `{type:'custom', prompt, snapshot?}`.
  - `{type:'preset', preset:'claude_code', append?, excludeDynamicSections?, snapshot?}`.
- **Important for an evolving persona:** `snapshot` now defaults to true.
  - The prompt, including `append`, is rendered on the first request, recorded in the transcript, and reused as-is on every later request and on resume/continue.
  - A different `append` on a later launch, or a mid-session model switch, is ignored until compaction or a new session.
  - Use `snapshot:false` to re-render on every request.
  - Where recording isn't rolled out yet (including Bedrock/Vertex/Foundry today), `snapshot` has no effect.
- `excludeDynamicSections:true` moves cwd, auto-memory and git status out of the system prompt into the first user message.
- `settingSources: ('user'|'project'|'local')[]`:
  - **Omitted means all sources load, matching the CLI.** I believe older SDK versions loaded none by default.
  - `[]` gives isolation.
  - It must include `'project'` for CLAUDE.md to load.
- Also relevant: `settings`, `managedSettings`, `AgentDefinition.omitClaudeMd`, and hook outputs `additionalContext` / `SessionStart.initialUserMessage`.

**Hooks**
- All 33 events in `HOOK_EVENTS`: PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, UserPromptSubmit, UserPromptExpansion, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, PermissionRequest, PermissionDenied, Setup, TeammateIdle, TaskCreated, TaskCompleted, Elicitation, ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove, InstructionsLoaded, CwdChanged, FileChanged, DirectoryAdded, MessageDisplay.
- Registration: `hooks: Partial<Record<HookEvent, {matcher?, hooks: HookCallback[], timeout?}[]>>`, with callback `(input, toolUseID, {signal}) => Promise<HookJSONOutput>`.
- A callback returns either `{async:true, asyncTimeout?}` or `{continue?, suppressOutput?, stopReason?, decision?:'approve'|'block', systemMessage?, reason?, hookSpecificOutput?}`.
- Event-specific outputs:
  - PreToolUse: `permissionDecision: allow|deny|ask|defer`, `permissionDecisionReason`, `updatedInput`, `additionalContext`.
  - UserPromptSubmit: `additionalContext`, `sessionTitle`, `suppressOriginalPrompt`.
  - SessionStart: `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills`.
  - PostToolUse: `additionalContext`, `updatedToolOutput`, `updatedMCPToolOutput`.
  - PermissionRequest: `decision: {behavior:'allow', updatedInput?, updatedPermissions?} | {behavior:'deny', message?, interrupt?}`.
  - SubagentStart: `additionalContext`.
- Inputs worth knowing: PreCompact gets `{trigger:'manual'|'auto', custom_instructions}`; Stop gets `{stop_hook_active, last_assistant_message?, background_tasks?}`.
- `includeHookEvents` emits hook started/progress/response messages.

**Subagents**
- `agents: Record<string, AgentDefinition>`. Fields: `description`, `prompt`, `tools`, `disallowedTools`, `model` (alias, full id, or `'inherit'`), `mcpServers`, `skills`, `initialPrompt`, `maxTurns`, `autoCompactWindow`, `background`, `omitClaudeMd`, `memory`, `effort`, `permissionMode`, `observer`, `observerMessage`.
- The `agent` option picks the main-thread agent.
- The built-in tool name is now **`Agent`** (in `BUILTIN_TOOL_NAMES`; formerly `Task`).
- Messages from a subagent carry `parent_tool_use_id`, `agent_id`, `subagent_type`, `task_description`.
- Background work: `background:true` or `run_in_background`, reported via `task_started`, `task_updated`, `task_progress`, `task_notification` and `background_tasks_changed` messages. Control with `stopTask`, `backgroundTasks()`.
- Fork subagents (`subagent_type:"fork"`) are on by default since 0.3.302; `CLAUDE_CODE_FORK_SUBAGENT=0` turns them off.

**Permissions**
- `canUseTool(toolName, input, {signal, suggestions?, blockedPath?, decisionReason?, mcpServer?:{name,source}, title?, displayName?, description?, …})` returns:
  - `{behavior:'allow', updatedInput?, updatedPermissions?: PermissionUpdate[], toolUseID?, decisionClassification?}`, or
  - `{behavior:'deny', message, interrupt?, …}`.
- `PermissionUpdate` types: `addRules`, `replaceRules`, `removeRules`, `setMode`, `addDirectories`, and others.
- `PermissionMode`: `'default'|'acceptEdits'|'bypassPermissions'|'plan'|'dontAsk'|'auto'`.
- Related options: `allowedTools`, `disallowedTools`, `tools`, `allowDangerouslySkipPermissions`, `permissionPromptToolName`, `permissionPrompts:'host'|'none'`.
- **Since 0.3.302, an omitted `permissionMode` on third-party providers starts in `default` (with telemetry off or on a fresh install). Set it explicitly for DeepSeek.**

**Usage and cost**
- Cost is reported in **USD estimates**.
- Result fields: `total_cost_usd`, `usage`, `modelUsage`, `num_turns`, `duration_ms`, `duration_api_ms`, `ttft_ms`, `stop_reason`, `permission_denials`, `queued_turn_count`, `terminal_reason`, `user_message_uuid(s)`.
  - `total_cost_usd` is cumulative across turns in a streaming session: read the latest result, don't sum them. Resume/fork continue the earlier total. It is "an estimate, not a billing statement."
  - `usage` covers the main loop only and is per-turn.
  - `modelUsage[model]` has `{inputTokens, outputTokens, thinkingTokens?, cacheReadInputTokens, cacheCreationInputTokens, cacheCreationEphemeral5m/1hInputTokens, webSearchRequests, costUSD, contextWindow, maxOutputTokens, canonicalModel, provider, costBasis}`.
- Each assistant message carries a `BetaMessage` with `.usage`, plus `context_usage`.
- Limits:
  - `maxTurns`.
  - `maxBudgetUsd` ends with an `error_max_budget_usd` result; it counts spend since this `query()` started or the last `/clear`.
  - `taskBudget` (alpha; an API-side token budget).
- **Cost with DeepSeek via ANTHROPIC_BASE_URL (first-hand):** `costBasis:'unknown'` means "no pricing row and no built-in price matched the model ID, so costUSD is a guess at the default model's rate."
  - So `total_cost_usd` and `maxBudgetUsd` enforcement are wrong; I infer they overstate cost, priced at a Claude rate.
  - Fix (first-hand): pass `managedSettings.modelPricing.overrides` as `{ "<deepseek model id>": {input, output, cacheRead, cacheWrite} }` (USD per Mtok, case-insensitive exact match), and optionally `multiplier`. It is honoured only from managed settings or a host that sets `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`.
  - If you alias DeepSeek behind a Claude model id, I infer it will be priced at Claude list price.
  - Token counts are only as accurate as DeepSeek's usage fields (inference). The safest approach is to compute cost yourself from `modelUsage` tokens.

**Compaction**
- Auto-compaction emits a `system/compact_boundary` message with `compact_metadata: {trigger:'manual'|'auto', pre_tokens, post_tokens?, duration_ms?, preserved_segment?, preserved_messages?}`.
- The `system/status` message carries `compact_result: 'success'|'failed'` and `compact_error`.
- `getContextUsage()` returns `autoCompactThreshold` and `isAutoCompactEnabled`. Hooks: PreCompact and PostCompact.
- Manual compaction by sending the `/compact` text as a user message is an inference: slash commands are processed, but I didn't confirm this one.
- A snapshot system prompt is re-rendered at compaction.

**Errors, retry and model switching**
- `system/api_retry` messages: `{attempt, max_retries, retry_delay_ms, error_status, error}`. `error` is `'rate_limit'` for 429 and `'overloaded'` for 529 (others include `authentication_failed`, `billing_error`, `model_not_found`, `server_error`, …).
- Error result subtypes: `error_during_execution | error_max_turns | error_max_budget_usd | error_max_structured_output_retries`.
- `fallbackModel` takes a comma-separated list; the primary model is retried at the start of each user turn.
- `setModel()` switches mid-session (PreModelSwitch/PostModelSwitch hooks).
- `resume_reason` marks the automatic re-run of a turn interrupted by a host restart.

---

## 2. Codex `app-server`. Wire names first-hand from protocol source unless marked.

**Transport (from doc snippets only)**
- stdio is the default and uses JSONL.
- It is JSON-RPC 2.0 with the `"jsonrpc"` field left out.
- `--listen ws://IP:PORT` is experimental; `--listen off` also exists.
- Handshake: `initialize` request, then an `initialized` notification.
- `initialize` params (first-hand): `{clientInfo:{name,title,version}, capabilities:{experimentalApi, optOutNotificationMethods[], requestAttestation, explicitGatewayOauth, mcpServerOpenaiFormElicitation, extensions}}`. Many fields need `experimentalApi`.
- Error codes: `-32600` (e.g. `data.reason:"serverShuttingDown"`), `-32602`, `-32603`.

**Threads**
- `thread/start` params: `model`, `modelProvider`, `serviceTier`, `cwd`, `approvalPolicy`, `approvalsReviewer` (`user`|`auto_review`), `sandbox`, `permissions` (named profile), `config` (map of overrides), `serviceName`, **`baseInstructions`**, **`developerInstructions`**, `personality` (deprecated), `ephemeral`, `historyMode`, `sessionStartSource`, `threadSource`, `projectId`, `environments`.
  - Experimental: `dynamicTools: DynamicToolSpec[]`, `selectedCapabilityRoots`, `experimentalRawEvents`, `multiAgentMode` (deprecated/ignored).
  - The response includes `thread`, `model`, `modelProvider`, `cwd`, `disabledPluginIds`, and the paths of loaded instruction files.
- Enum values: `approvalPolicy` is `"untrusted"|"on-request"|{granular:{…}}|"never"`; `sandbox` is `"read-only"|"workspace-write"|"danger-full-access"`.
- `thread/resume`: `{threadId, path?, model…, baseInstructions, developerInstructions, config, excludeTurns, initialTurnsPage}`.
- `thread/fork`: `{threadId, lastTurnId?|beforeTurnId?, path?, overrides…, experimentalPredictionMode}`.
- Listing and reading:
  - `thread/list`: `{cursor, limit, sortKey, sortDirection, modelProviders, sourceKinds, archived, cwd, searchTerm, parentThreadId, ancestorThreadId, excludedThreadIds, useStateDbOnly…}`, returning `nextCursor`.
  - `thread/read`, `thread/turns/list`, `thread/items/list`, `thread/items/read`, `thread/loaded/list`, `thread/search`.
- Lifecycle: `thread/archive`, `thread/unarchive`, `thread/delete`, `thread/unsubscribe`, `thread/name/set`, `thread/settings/update`, `thread/metadata/update`, `thread/goal/*`, `thread/memory/read`.
- **`thread/rollback` has been removed.** Use `thread/revert {threadId, beforeTurnId}`.
- `thread/compact/start {threadId}` compacts manually.
- `thread/inject_items {threadId, items}` appends raw Responses items to history without starting a turn. This is a way to inject context.
- `ThreadStatus`: `notLoaded|idle|systemError|active{activeFlags:[waitingOnApproval|waitingOnUserInput]}`.

**Turns, steering and interrupt**
- `turn/start {threadId, input: UserInput[], …}`.
  - Input types: `text{text,text_elements}`, `image`, `localImage{path}`, `audio`, `localAudio`, `skill{name,path}`, `mention{name,path}`.
  - Per-turn overrides that also stick for later turns: `cwd`, `approvalPolicy`, `sandboxPolicy`, `permissions`, `model`, `effort`, `summary`, `serviceTier`, `environments`.
  - Other fields: `serviceTierForTurn`, `outputSchema`, **`additionalContext: {key: {value, kind:'untrusted'|'application', name?}}`**, `collaborationMode` (experimental; it takes precedence over model, effort and developer instructions), `parentTurnId`, `rootTurnId`, `clientUserMessageId`.
- **Mid-turn input:** `turn/steer {threadId, input, expectedTurnId (required), additionalContext?, clientUserMessageId?}` returns `{turnId}`.
  - It fails if `expectedTurnId` isn't the active turn, and errors if no turn is active.
  - It emits no `turn/started` and accepts no model/cwd/sandbox overrides (overrides: search snippet of PR #10821).
  - Per a doc comment, `turn/start` sent during an active turn also steers ("ignored when this request steers an already-active turn").
  - If the active turn can't be steered (e.g. review or manual compact), you get `codexErrorInfo.activeTurnNotSteerable{turnKind}`.
- Experimental queuing for later turns: `thread/queue/{add,list,update,delete,reorder,start}`.
- `turn/settings/update {threadId, turnId, model?, effort?, summary?, serviceTier?, approvalsReviewer?}` changes settings of the running turn.
- `turn/interrupt {threadId, turnId}`.
- `review/start` exists; I didn't read its params.

**Events (notifications)**
- Thread and turn: `thread/started`, `thread/status/changed`, `turn/started`, `turn/completed {threadId, turn}`.
  - Turn status values: `completed|interrupted|failed|inProgress`.
- Items: `item/started` and `item/completed`, each carrying a ThreadItem with `startedAtMs`/`completedAtMs`.
  - Item types: `userMessage`, `hookPrompt`, `agentMessage`, `functionCallOutput`, `plan`, `reasoning`, `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`, `subAgentActivity`, `imageView`, `enteredReviewMode`, `exitedReviewMode`, `contextCompaction`.
- Deltas: `item/agentMessage/delta`, `item/plan/delta`, `item/reasoning/{summaryTextDelta,summaryPartAdded,textDelta}`, `item/commandExecution/outputDelta`, `item/commandExecution/terminalInteraction`, `item/fileChange/{outputDelta,patchUpdated}`, `item/mcpToolCall/progress`.
- Turn-level: `turn/diff/updated {diff}`, `turn/plan/updated {explanation, plan[{step,status}]}`.
- `thread/tokenUsage/updated {threadId, turnId, tokenUsage:{total, last, modelContextWindow}}`. Each breakdown is `{totalTokens, inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens, reasoningOutputTokens}`.
- `account/rateLimits/updated {rateLimits:{primary/secondary:{usedPercent, windowDurationMins, resetsAt}, credits, planType…}}`.
- Others: `serverRequest/resolved`, `hook/started`, `hook/completed`, `model/rerouted`, `warning`.
- `thread/compacted` is deprecated; use the `contextCompaction` item instead.
- **`error {error: TurnError, willRetry, threadId, turnId}`.** When `willRetry` is true the error is transient and does not interrupt the turn.
  - `codexErrorInfo` values: `contextWindowExceeded`, `sessionBudgetExceeded`, `usageLimitExceeded`, `rateLimitExceeded`, `serverOverloaded`, `modelNotFound`, `httpConnectionFailed{httpStatusCode}`, `responseStreamConnectionFailed`, `responseStreamDisconnected`, `responseTooManyFailedAttempts`, `internalServerError`, `unauthorized`, `badRequest`, `sandboxError`, `tooManyDenials`, `activeTurnNotSteerable`, `other`.

**Approvals (requests from server to client)**
- `item/commandExecution/requestApproval`:
  - Params: `{kind, threadId, turnId, itemId, startedAtMs, approvalId?, reason?, command?, cwd?, commandActions?, additionalPermissions?, proposedExecpolicyAmendment?, proposedNetworkPolicyAmendments?, availableDecisions?}`.
  - Response: `{decision: "accept"|"acceptForSession"|{acceptWithExecpolicyAmendment}|{applyNetworkPolicyAmendment}|"decline"|"cancel"}`.
  - `decline` lets the turn continue; `cancel` also interrupts the turn.
- `item/fileChange/requestApproval {…, reason?, grantRoot?}` takes `accept|acceptForSession|decline|cancel`.
- `item/tool/requestUserInput {questions[{id, header, question, isOther, isSecret, options[{label, description}]}], isBlocking}` expects `{answers:{qid:{answers:[…]}}}`.
- Also: `mcpServer/elicitation/request`, `item/permissions/requestApproval`.
- `item/tool/call {threadId, turnId, callId, namespace?, tool, arguments}` is how dynamic tools run. The client replies `{contentItems:[inputText|inputImage|inputAudio], success}`.

**Multi-agent**
- The `collabAgentToolCall` item has `tool` (`spawnAgent|sendInput|resumeAgent|wait|closeAgent|sendMessage|followupTask|interruptAgent|listAgents`), `status`, `senderThreadId`, `receiverThreadIds`, `prompt`, `model`, `reasoningEffort`, `agentsStates{status: pendingInit|running|interrupted|completed|errored|shutdown|notFound}`.
- The `subAgentActivity` item has `kind` (`started|interacted|interrupted|completed`), `agentThreadId`, `agentPath`.
- `collaborationMode/list` is experimental.
- `multiAgentMode` is ignored; the code comment says to use `effort:"ultra"` instead.

**Cost**
- The live stream reports **tokens only**; there is no USD per turn.
- `account/usage/read {threadId?}` returns `threadUsage {estimatedUsageCreditsMicros, estimatedUsageUsdMicros?, nativeUsageUsdMicros?, groups[…]}`. I infer this is only meaningful on OpenAI/ChatGPT billing routes ("when its billing route is available").

**Persona injection**
- Use `developerInstructions` to add persona text on top of the built-in prompt.
- Use `baseInstructions` to replace the built-in prompt entirely; I infer it overrides the model-catalog prompt.
- Both can be passed again on `thread/resume`. Per-turn context goes in `turn/start` or `turn/steer` `additionalContext`.
- The README says changing `personality` doesn't rewrite a thread's existing instructions. I infer instructions are fixed per thread, much like the Claude snapshot behaviour.
