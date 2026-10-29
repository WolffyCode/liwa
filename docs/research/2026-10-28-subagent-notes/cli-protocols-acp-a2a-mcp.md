# 子调研原文：ACP、A2A、MCP 三个协议的现状

> 来源：第 1 段对话（2026-10-27）里的调研子任务「Research ACP, A2A, MCP specs」的最终回复，原样存档。
> 状态：未整理、未逐条核对；语言为英文，保持原文。只删掉了一句指向已不存在的临时目录的说明。
> 用途：主意识与分身的 CLI 编排模块阶段的调研起点。索引和要点见同目录 `README.md`。

---

## Protocol research: ACP, A2A and MCP (as of 2026-10-28)

All three protocols changed a lot in 2026, and some of the names in the brief are out of date:
- **ACP:** stable is v1. v2 has been a Draft since 2026-07-20.
- **A2A:** current is 1.0.0. Method names are now PascalCase (`SendMessage`, not `message/send`).
- **MCP:** current is **2026-07-28**, not 2025-11-25. It is stateless, and Tasks moved out of the core into an extension.

Unless I say otherwise, everything below comes from spec text I read myself. My one GitHub API call returned "rate limit exceeded", so all spec text came from the websites. Codex's MCP support could only be confirmed from third-party sources.

### Sources
- **agentclientprotocol.com** `.md` pages:
  - llms.txt and `protocol/v1/{overview, initialization, session-setup, prompt-turn, extensibility, session-config-options, schema}`.
  - Searched only: `protocol/v1/{session-modes, authentication, elicitation, tool-calls, session-list}`.
  - v2: `protocol/v2/prompt-lifecycle` and `migration`.
  - Announcements: `acp-v2-draft`.
  - RFDs: `rfds/updates`, `about`, `session-fork`, `subagents`, `client-system-prompt`, `end-turn-token-usage`, `v2/prompt`. RFD stages come from the site's sidebar groups.
- **a2a-protocol.org/latest/specification/**: full HTML converted to text.
- **modelcontextprotocol.io**:
  - `specification/2026-07-28/{changelog, server/tools, client/elicitation, basic/patterns/progress, cancellation, mrtr, subscriptions, server/discover}`.
  - `docs/2026-07-28/learn/versioning`, `extensions/tasks/overview`, `extensions/client-matrix`.
  - `specification/2025-11-25/basic/utilities/tasks`.
- **code.claude.com/docs/en/mcp**: full page.
- **Codex (third-party only):** codex.danielvaughan.com (2026-04-11) and glama.ai/mcp/clients/codex. developers.openai.com returned 403.
- A2A release date: [chatforest](https://chatforest.com/guides/a2a-protocol-v1-production-ready/) and [quarkus blog](https://quarkus.io/blog/a2a-java-sdk-1-0-0-cr1-released/).

---

### 1. ACP (repo `agentclientprotocol/agent-client-protocol`; SDKs `@agentclientprotocol/sdk` 1.0.0, Rust 1.0.0)

**Versioning:** `protocolVersion` is a major-version integer, currently `1`. v2 is a Draft schema (`v2.0.0-alphaX`); the announcement says to put it behind version negotiation and feature flags and not ship it by default.

**Methods and capabilities (all STABLE in v1)**
- `initialize`
  - Request: `protocolVersion`, `clientCapabilities`, `clientInfo`.
  - `clientCapabilities` fields: `fs.readTextFile`, `fs.writeTextFile`, `terminal`, `auth.terminal`, `elicitation{form,url}`, `session.configOptions.boolean`, `session.compaction`, `session.notices`.
  - Response: `agentCapabilities`, `agentInfo`, `authMethods`.
  - `agentCapabilities`:
    - `loadSession` (bool)
    - `promptCapabilities{image,audio,embeddedContext}`
    - `mcpCapabilities{http,sse}`
    - `auth.logout`
    - `sessionCapabilities{list,resume,close,delete,additionalDirectories}`, where `{}` means supported and omitted or `null` means unsupported.
  - Any capability that is omitted MUST be treated as unsupported.
- **Baseline methods:** `session/new`, `session/prompt`, `session/cancel`, `session/update`.
- `session/new {cwd, mcpServers, additionalDirectories?}` returns `{sessionId, modes?, configOptions?}`. Agents must support stdio MCP servers; http and sse are optional.
- `session/load` replays the full history as `session/update` notifications, then responds.
- `session/resume` (stabilized 2026-04-22) restores the session with no replay.
- `session/close` (2026-04-23) cancels like `session/cancel`, then frees resources.
- `session/list` uses `cursor` paging and returns `title` and `updatedAt`.
- `session/delete`.
- `authenticate`, `logout`.
  - Auth method types: agent-driven or `type:"terminal"`.
  - The `env_var` type was removed.
- **Client-side methods:**
  - `fs/read_text_file`, `fs/write_text_file`
  - `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release`
  - `elicitation/create` (form or url; stabilized 2026-07-24) and the `elicitation/complete` notification
  - `session/request_permission`
- **`$/cancel_request {requestId}`:** generic request cancellation. The receiver must answer with a result or error `-32800`.

**Prompt turns (v1)**
- `session/prompt {sessionId, prompt: ContentBlock[]}` returns `{stopReason}`. **There is no usage field on the response.**
- `stopReason` values: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`.
- `session/cancel` semantics:
  - The client marks unfinished tool calls cancelled and must answer pending permission requests with `{outcome:"cancelled"}`.
  - The agent stops, flushes its updates, then must return `cancelled`, even if the cancellation caused internal exceptions.

**`session/update` variants (complete v1 set)**
- `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk` (optional `messageId`)
- `tool_call`, `tool_call_update`
  - Status: `pending`, `in_progress`, `completed`, `failed`.
  - `kind`: `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode`, `other`.
  - Other fields: `rawInput`, `rawOutput`, `locations`, and an optional `name` (stabilized 2026-09-17).
- `plan`, `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`
- `usage_update {used, size, cost?{amount, currency}}`: STABLE since 2026-06-05.
- `notice`: needs the client's `session.notices` capability.
- `compaction_update` and `compaction_summary_chunk`: need the client's `session.compaction` capability. Both were stabilized in October 2026.

**Permissions:** `session/request_permission {sessionId, toolCall, options[]}`.
- Each option has `optionId`, `name` and `kind`, where `kind` is one of `allow_once`, `allow_always`, `reject_once`, `reject_always`.
- The outcome is `{outcome:"selected", optionId}` or `{outcome:"cancelled"}`.

**Modes, config options and model selection**
- `session/set_mode` and `current_mode_update` are stable but on the way out: "Modes will be removed in a future version."
- `session/set_config_option` is the preferred replacement.
  - Option types: `select`, and `boolean` if the client opts in.
  - `category`: `mode`, `model`, `model_config`, `thought_level`, `other`, or anything starting with `_`.
  - The response always returns the complete config state.
- `session/set_model` was **REMOVED** on 2026-06-01; model selection now goes through a config option with category `model`.

**Extensibility rules**
- `_meta: {[k]: unknown}` exists on most types. Implementations "MUST NOT make assumptions about values".
- Root `_meta` keys `traceparent`, `tracestate` and `baggage` are reserved for W3C trace context.
- You "MUST NOT add any custom fields at the root of a type"; all those names are reserved for the spec.
- Custom methods and notifications must start with `_` (e.g. `_zed.dev/...`).
  - An unknown request gets `-32601`.
  - An unknown notification SHOULD be ignored.
  - Custom capabilities are advertised under `_meta` in the capability objects.

**v2 Draft prompt lifecycle (key change)**
- `session/prompt` returns `{messageId}` once the message is *inserted* into the conversation, not when the turn ends.
- Turn progress is reported through `state_update` with `running`, `idle` or `requires_action`, plus a `stopReason` that adds `error`.
- Updates can arrive at any time, including from agent-initiated or background work.

**RFD stages (from the site sidebar)**

| Stage | RFDs |
|---|---|
| Draft | `session/fork`; proxy chains; custom LLM endpoint; plan operations; **End-Turn Token Usage** (strawman: `usage{totalTokens, inputTokens, outputTokens, thoughtTokens, cachedReadTokens, cachedWriteTokens}`); auth state query; `session/status` and `session/set_title` (both 2026-10-26) |
| Active | Streamable HTTP & WebSocket transport; **Subagent Sessions**; **Client-Provided System Prompt**; MCP-over-ACP; the v2 RFD set |
| Preview | none |

---

### 2. A2A 1.0.0
Release date is March 2026 according to secondary sources. The project is now under the Linux Foundation / Agentic AI Foundation.

**Methods** (JSON-RPC and gRPC names, with REST endpoints)
- `SendMessage` (`POST /message:send`)
- `SendStreamingMessage` (`/message:stream`, SSE)
- `GetTask`, `ListTasks`
- `CancelTask` (`/tasks/{id}:cancel`)
- **`SubscribeToTask`** (`/tasks/{id}:subscribe`). This replaces `tasks/resubscribe`; the first event is always the current `Task`.
- `Create/Get/List/DeleteTaskPushNotificationConfig`
- `GetExtendedAgentCard`
- Clients MUST send an `A2A-Version: 1.0` header; an empty header means 0.3.

**`TaskState`** (JSON uses the full SCREAMING_SNAKE names)
- `TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING`
- Terminal: `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED`, `TASK_STATE_REJECTED`
- "Interrupted": `TASK_STATE_INPUT_REQUIRED`, `TASK_STATE_AUTH_REQUIRED`
- `TASK_STATE_UNSPECIFIED`

**IDs**
- `taskId` is always server-generated; a client cannot create its own.
- `contextId` groups tasks and messages into one conversation.
- If only `taskId` is sent, the agent infers `contextId`; a mismatched pair MUST be rejected.
- `referenceTaskIds` links related tasks.

**Sending and streaming**
- `SendMessageConfiguration` fields: `acceptedOutputModes`, `historyLength`, `taskPushNotificationConfig`, `returnImmediately`.
- By default the call blocks until the task reaches a terminal **or interrupted** state.
- A stream carries exactly one of `task`, `message`, `statusUpdate` or `artifactUpdate` per event.
- `TaskStatusUpdateEvent {taskId, contextId, status, metadata}`. There is **no `final` field in 1.0**.
- `TaskArtifactUpdateEvent {artifact, append, lastChunk}`.
- `Artifact {artifactId, name, description, parts[], metadata, extensions}`.
- `Part` holds exactly one of `text`, `raw`, `url` or `data`.
- The spec says results belong in Artifacts, and Messages are not reliable delivery.

**Agent Card and extensions**
- Agent Card: `supportedInterfaces[{url, protocolBinding, protocolVersion, tenant}]`, `capabilities{streaming, pushNotifications, extensions[], extendedAgentCard}`, `skills[{id, name, description, tags, examples, inputModes, outputModes}]`, `signatures` (JWS).
- Extensions are declared in the card as `AgentExtension{uri, required, params}`.
  - Clients opt in with the `A2A-Extensions` header.
  - Extension data travels in `message.extensions` / `metadata[uri]`.
  - Breaking changes require a new URI.

---

### 3. MCP: current revision 2026-07-28

**Breaking changes from 2025-11-25**
- `initialize` is gone. Every request carries `_meta["io.modelcontextprotocol/protocolVersion"]` and `["…/clientCapabilities"]`.
- `server/discover` is new; servers return `instructions` there.
- There are no sessions and no `Mcp-Session-Id` header.
- **Multi Round-Trip Requests:** instead of sending its own requests, the server returns `resultType:"input_required"` with `inputRequests`. The client retries the original call with `inputResponses` and `requestState`. This is how elicitation now arrives inside `tools/call`.
- `resources/subscribe` and the GET stream are replaced by `subscriptions/listen` (filters `toolsListChanged`, `resourceSubscriptions`, and so on).
- Roots, Sampling and Logging are deprecated.
- `notifications/elicitation/complete` was removed.

**Tools**
- `inputSchema` / `outputSchema` accept any JSON Schema 2020-12; `structuredContent` can be any JSON value; errors use `isError`.
- `annotations` are untrusted unless the server is trusted.
- `notifications/tools/list_changed` is delivered via `subscriptions/listen`.
- Cross-call state is guided as explicit handles passed in tool arguments.

**Progress and cancellation**
- Progress: `_meta.progressToken`, then `notifications/progress {progress, total?, message?}`. `progress` must increase.
- Cancellation on Streamable HTTP: closing the stream *is* the cancel.
- Cancellation on stdio: send `notifications/cancelled {requestId, reason}`.

**Elicitation:** capability `{form:{}, url:{}}`; a bare `{}` means form only. Responses are `accept`, `decline` or `cancel`.

**Tasks** (2025-11-25 core EXPERIMENTAL; now the `io.modelcontextprotocol/tasks` extension)
- The server decides on its own to return `resultType:"task"` with `taskId`, `status`, `ttlMs`, `pollIntervalMs` and `statusMessage`.
- The client polls `tasks/get`.
- When the task is `input_required`, its `inputRequests` are answered with `tasks/update`.
- `tasks/cancel` is cooperative.
- `tasks/result` and `tasks/list` were removed.
- `notifications/tasks` is optional, via `subscriptions/listen`.
- Statuses: `working`, `input_required`, `completed`, `failed`, `cancelled`.

**Client support**
- **Claude Code (first-hand docs):**
  - There are two client runtimes. "v2" uses TS SDK 2.0 and negotiates 2026-07-28 with http, stdio and claude.ai connector servers.
  - Elicitation: declares `{form:{}, url:{}}`, but serves it only in interactive terminal sessions; there is an `Elicitation` hook.
  - `list_changed`: full refetch when interactive; in `-p` mode it refreshes only the tool list.
  - Progress resets the idle timeout (5 min for http, 30 min for stdio) but not the wall-clock limit. Calls running past 2 minutes are auto-backgrounded.
  - **MCP Tasks are in public beta from v2.1.304.** Requirements: protocol 2026-07-28, main conversation only, not available on Bedrock.
    - It polls `tasks/get` and uses `tasks/update` / `tasks/cancel`.
    - It does *not* use `tasks/result`, `tasks/list` or `notifications/tasks`.
    - Non-interactive sessions cancel any task that asks for input.
  - `readOnlyHint` lets read-only calls run in parallel; `idempotentHint` allows one retry on reconnect.
  - Anthropic-specific `_meta` keys: `anthropic/requiresUserInteraction` (forces a prompt on every call) and `anthropic/maxResultSizeChars`.
  - Answers `roots/list`.
  - Channels (`claude/channel`) do **not** work on 2026-07-28 connections.
- **Codex (secondary sources only, unconfirmed):**
  - Elicitation since about v0.119; it needs the approval policy setting `mcp_elicitations`.
  - It passes `outputSchema` to the model but does not validate `structuredContent`.
  - Config keys `startup_timeout_sec` and `tool_timeout_sec`.
  - glama lists Tasks, Sampling and Roots as supported without evidence. I have no primary source for progress or Tasks support.

---

### Direct answers
- **(a) System prompt:** ACP has none. The RFD itself says there is "no `systemPrompt`, `instructions`, or equivalent field on any ACP method." The Client-Provided System Prompt RFD (Active) proposes `sessionCapabilities.systemPrompt` and `session/new.systemPrompt{mode:"append"|"override", content: ContentBlock[]}`.
  - Today's workarounds: `claude-agent-acp` reads `_meta.systemPrompt` (a string replaces the prompt, `{append}` adds to it); `codex-acp` exposes nothing.
- **(b) Usage and cost:** ACP has `usage_update {used, size, cost?}` for context window size and cumulative cost. It is STABLE. Per-turn token breakdown is only a Draft RFD.
- **(c) Mid-turn input:** ACP v1 doesn't specify this anywhere. Your options are `session/cancel` then a new `session/prompt`. The v2 Draft lifts the structural block, because prompts return on insertion and work can happen outside a turn. But the v2 prompt RFD says explicitly: "This RFD does not specify queueing, steering, or whether agents insert new prompts while busy."
- **(d) Subagents and fork:** both are proposals only.
  - `session/fork` is a Draft RFD: same params as `session/load`, returns a new `sessionId`, capability `fork:{}`.
  - Subagent Sessions is an Active RFD:
    - The client opts in with `clientCapabilities.subagents`.
    - The parent reports each child via `subagent_update {sessionId, title, description, capabilities{cancel}, state}`.
    - Messages between sessions use `session_message` / `session_message_chunk`.
    - Child sessions are restricted: the client cannot prompt or steer them, only cancel (if allowed).
  - Neither is in the stable v1 schema. I'm assuming, without checking, that the SDKs ship them only behind unstable flags.
- **(e) A2A approval gate:** yes.
  - `TASK_STATE_INPUT_REQUIRED` and `TASK_STATE_AUTH_REQUIRED` are "interrupted" states: a blocking `SendMessage` returns there, and the task can continue.
  - The spec's §7.6 lists "human approval before a destructive action" as an example of `AUTH_REQUIRED`. It also defines chaining, where a middle agent passes the request up by setting its own task to `AUTH_REQUIRED`.
  - You resume by sending a message with the same `taskId`/`contextId`, and watch through `SubscribeToTask` or push notifications.
  - Its weaknesses for an internal contract: no standard approval-option schema (unlike ACP's four permission kinds), no usage field, no system prompt.
- **(f) MCP for a kernel tools server:**
  - Progress tokens: Claude Code uses them as liveness only.
  - Elicitation: form and url, interactive only in Claude Code.
  - Tasks extension: long jobs plus `input_required` as an approval point. This is beta in Claude Code and unverified in Codex.
  - `readOnlyHint` and `idempotentHint`, plus `anthropic/requiresUserInteraction` for a forced approval in Claude Code.
  - Explicit handles in tool arguments instead of sessions.
  - Avoid Sampling and Roots (deprecated). Plan for both 2025-11-25 and 2026-07-28 clients.
