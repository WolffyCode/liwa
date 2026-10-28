# 调研：Paseo 整体架构

日期：2026-10-28。为灵鲸"整体架构"一节打底，是阶段一的第 2 步。标注：〔一手〕读到源码或仓库文档原文；〔二手〕搜索摘要或第三方文章；〔推测〕调研者判断；〔未核实〕没读到原文。

覆盖说明：

- 以 Helm 本地源码为主，只读。版本 0.11.1（`packages/server/package.json`），HEAD `d8b3e8709`，分支 `dev/four-column`。
- 上游 getpaseo/paseo 只对照架构文档、CHANGELOG 和三个新增模块，经 GitHub API 读 HEAD（2026-10-28，最新 0.14.0-beta.1）。raw.githubusercontent.com 这次经代理超时或返回 502，所以改走 API。
- `client-backend.md`（下文简称 CB）里已有的结论不再重复，只按节引用：WS 协议、同步、流式性能、背压、Electron、前端组件、JSON 存储、managed-processes 对账。
- 本次没有用搜索引擎，也没有二手资料。
- 路径约定：`server/…` 指 Helm 的 `packages/server/src/server/…`；`scripts/…` 指 `packages/server/scripts/…`；`protocol` 指 `packages/protocol/src/`。

## 1. 来源清单

全部〔一手〕。"全文"指整篇读完；"节选"指先用 grep 定位、再读相关段落。

| # | 来源 | 读了什么 |
| --- | --- | --- |
| H1 | Helm `docs/architecture.md` | 全文 |
| H2 | Helm `docs/agent-lifecycle.md` | 全文 |
| H3 | Helm `docs/chats.md`、`docs/plugin-platform.md`、`docs/permissions.md` | 全文 |
| H4 | Helm `docs/plugins.md` | 节选：开头、内置插件、贡献边界、生命周期钩子、provider 贡献、timeline 条目贡献 |
| H5 | Helm `docs/providers.md` | 节选：插件 provider、ACP 与直连两种适配模式、steer 与中断、helper 进程、catalog 刷新、直连清单、Gotchas |
| H6 | Helm `docs/data-model.md` | 节选：项目身份、Store Surface Rules、目录布局、Agent 记录、Schedule、meta 文件 |
| H7 | Helm `SECURITY.md` | 全文 |
| H8 | Helm `docs/hub.md`、`docs/workbench.md`、`public-docs/schedules.md`、`public-docs/orchestration.md`、`public-docs/plugins/reference.md`（生命周期钩子一节） | 开头或相关节 |
| H9 | `server/agent/agent-sdk-types.ts`（818 行） | 全部接口与类型 |
| H10 | `server/agent/agent-manager.ts`（5425 行） | 类型定义、事件队列、事件分派、timeline 记录、attention、注册与历史回灌、广播 |
| H11 | `server/agent/agent-prompt.ts`（600 行） | 全文：发 prompt 的统一入口、steer、系统信封、完成通知 |
| H12 | `server/agent/agent-response-loop.ts`、`structured-generation-providers.ts` | 主要部分：结构化生成 + 换 provider 兜底 |
| H13 | `server/agent/agent-loading.ts`、`agent-timeline-store(-types).ts`、`provider-subagents/store.ts`、`activity-curator.ts`、`agent-timeline-content.ts` | 全文或开头 |
| H14 | `server/agent/mcp-server.ts`、`runtime-mcp-config.ts`、`paseo-tool-policy.ts`、`tools/types.ts`、`tools/paseo-tools.ts` | 前四个全文；最后一个读工具清单、`create_agent`、heartbeat、子 agent 配置继承 |
| H15 | `server/schedule/service.ts`、`store.ts`、`cron.ts` | service 读了 tick、恢复、执行全过程；另两个读列表与 cron 实现 |
| H16 | `scripts/supervisor.ts`（全文）、`scripts/supervisor-entrypoint.ts`、`server/daemon-worker.ts` | 进程监管 |
| H17 | `server/bootstrap.ts` | import 清单、子系统构造顺序、AgentManager 与 ScheduleService 的装配、MCP token |
| H18 | `server/session.ts`、`websocket-server.ts`、`agent-attention-policy.ts` | 客户端发消息、事件转发、注意力推送 |
| H19 | `providers/claude/query.ts`、`claude/agent.ts`（人设注入片段）、`codex-app-server-agent.ts`（spawn 与 developer_instructions）、`acp-agent.ts`（imports）、`provider-runtime.ts`、`provider-registry.ts`（大纲）、`provider-snapshot-manager.ts`（unattended） | 片段 |
| H20 | `managed-processes/managed-processes.ts`、`creation/index.ts`、`agent-storage.ts`、`create-agent/create.ts` | 开头与大纲 |
| H21 | `LICENSE`；`git log`、`git branch`（只读） | Apache-2.0；分支与合并历史 |
| U1 | 上游 `CHANGELOG.md` | 0.11.2 到 0.14.0-beta.1 |
| U2 | 上游 `docs/architecture.md`、`agent-lifecycle.md`、`data-model.md`、`providers.md`、`plugins.md`、`permissions.md`、`agent-sdk-types.ts` | 和 Helm 逐行 diff |
| U3 | 上游 `docs/connected-hosts.md` | 全文 |
| U4 | 上游 `agent/agent-messages/envelope.ts`（全文）、`delivery.ts`（开头）、`finish-subscriptions/index.ts`（大纲）；`server/`、`agent/` 目录清单 | 新增模块 |
| U5 | 上游 `docs/chats.md`、`docs/plugin-platform.md` | 404：确认这两项只在 Helm 里有 |

## 2. 机制总览

### 2.1 架构图

```
 客户端：Expo app（手机/网页）   Electron 桌面   CLI   Hub（云端触发：GitHub/Slack…）   其他 daemon（上游 0.13+ connected hosts）
        │  WS /ws：hello → server_info；密码 / local-credential / relay 端到端加密；按 socket 订阅（协议见 CB §2）
┌───────┴────── supervisor 进程：fork worker，1s IPC 心跳，worker 崩溃就重启，写 daemon.log，发布 paseo.pid 端点 ──────┐
│ worker 进程（所有子系统都在这一个 Node 进程里）                                                                      │
│                                                                                                                     │
│  express HTTP + WebSocketServer ──▶ Session（每个客户端一个，8808 行）─┐                                             │
│  /mcp/agents（MCP 薄适配）──▶ Paseo 工具目录（40 个工具，与传输无关）──┤                                             │
│  ScheduleService（每秒扫一次 schedules/）────────────────────────────────┤                                          │
│  CreationService（幂等创建日志）、Hub、Relay、Speech、WorkspaceGit、Terminal…  │                                     │
│                                                                         ▼                                           │
│                 AgentManager：每 agent 一台状态机 + 内存 timeline + 权限 + attention（5425 行）                       │
│                   │ 订阅者：Session（转发 WS）、persistence-hooks（落 agents/*.json）、插件钩子、完成通知、schedule 等待 │
│                   ▼                                                                                                 │
│                 ProviderSnapshotManager → provider 注册表 → AgentClient × N（内置 + 插件 provider）                   │
│  PluginService：插件 server 端跑在子进程；内置插件在进程内                                                            │
│  ManagedProcesses 登记表：只登记 helper 进程（如 OpenCode server）                                                     │
└────────┬───────────────────────────────┬──────────────────────────────────┬─────────────────────────────────────────┘
  Claude Agent SDK（库在进程内）     codex app-server                   ACP CLI / pi --mode rpc /
  └▶ spawn `claude` CLI（stdio）    （每会话一个子进程，detached，       OpenCode 共享 server
                                     stdio JSON-RPC）
        │                                  │                                  │
 ~/.claude/projects/*.jsonl        ~/.codex/sessions/*.jsonl           各 CLI 自己的会话存储      ← 对话的持久真相在这里
 ~/.paseo/：agents/{cwd}/{id}.json  schedules/{id}.json  projects/*.json  creations/  runtime/managed-processes/  config.json …
```

### 2.2 十个问题的结论

#### Q1 进程与分层

**进程**〔一手，H16、H17、H19〕

- **两级进程。** supervisor（`scripts/supervisor.ts`，502 行）fork 出 worker（`daemon-worker.ts`），所有子系统都在 worker 里。
- **supervisor 的职责：**
  - 每秒经 IPC 给 worker 发心跳。
  - 转发 worker 的 stdout/stderr，并写滚动日志 `daemon.log`；写日志失败不影响监管。
  - 收到 worker 发来的 `paseo:restart` 或 `paseo:shutdown`，就请求优雅退出；10 秒后还没退，按进程树 SIGKILL。
  - worker 崩溃时：如果它已经 ready 过就重启（入口设了 `restartOnCrash: true`）；还没 ready 就退出，supervisor 也跟着退出。
  - 只有 supervisor 能把 worker 的监听端点写进 `paseo.pid`。
- **worker 反向自检：** 超过 3.5 秒没收到心跳且 supervisor 的 pid 已死，或者 `ppid` 变了，worker 就自己退出。注释给的理由是：stdout/stderr 管道归 supervisor 所有，supervisor 没了就是一条硬边界。
- **CLI 都是子进程：**
  - **Claude：** 在进程内用 `@anthropic-ai/claude-agent-sdk`，但 SDK 通过 `spawnClaudeCodeProcess` 钩子拉起 `claude` CLI 子进程（stdio）。Paseo 拿到 child 句柄，关会话时按进程树杀。
  - **Codex：** 每个会话 spawn 一个 `codex app-server`（detached，stdio JSON-RPC）。
  - **ACP 类：** spawn 对应 CLI（stdio）。
  - **Pi：** `pi --mode rpc`。
  - **OpenCode：** 起一个共享 server。
  - 插件的 server 端也在独立子进程里。
- **回收：**
  - Helm 里，空闲的 agent 永远驻留。只有归档、替换、reload、工作区拆除、daemon 关闭这几种显式动作才会关掉运行时（H2）。上游 0.14 改成空闲 1 小时回收，见 Q9。
  - helper 进程登记在 `runtime/managed-processes/`，启动时对账（规则见 CB §3"进程模型与模块边界"）。
  - grep 结果显示，只有 OpenCode server 这类 helper 进登记表；Codex app-server 和 Claude CLI 不进。
  - daemon 异常死掉后，这两类进程靠什么退出〔未核实；推测是 stdin 关闭后自行退出〕。

**分层与依赖方向**〔一手，H17 的构造顺序〕

1. 基础：DaemonConfigStore（`config.json`，可热改）、ManagedProcesses、PluginService、TerminalManager、ServiceProxy。
2. 存储：AgentStorage、项目和工作区注册表、WorkspaceGitService、WorkspaceProvisioning。
3. 大脑：ProviderSnapshotManager → AgentManager。AgentStorage 不被 AgentManager 直接调用来落盘，而是由 `persistence-hooks` 订阅 AgentManager 事件后写入。
4. 应用服务：ScheduleService（依赖 AgentManager、AgentStorage 和几个工作区回调）、CreationService、Hub、CheckoutDiff、Speech。
5. 接入：HTTP、WS（Session）、`/mcp/agents`、Relay。

依赖是单向的：接入层 → 应用服务 → AgentManager → AgentClient → CLI。AgentManager 不认识 Session 和 MCP，它们都通过 `subscribe()` 拿事件。

问题出在**粒度**：

- Session 一个类 8808 行，MCP 工具目录 3258 行。
- AgentManager 把状态机、内存 timeline、权限、attention、持久化触发、provider 子 agent 存储、插件事件发布全装在一个类里。

（CB §2 已列出这几个巨型文件。）

#### Q2 核心对象与数据模型

〔一手，H1、H2、H6、H9、H10〕

```
host（一个 daemon：serverId=srv_…，独占一个 $PASEO_HOME）
 └ project（prj_<16hex>；root 路径；projectKey 用于跨主机归组）
    └ workspace（不透明 id；cwd；local | worktree | directory；purpose:"chat" 表示独立对话的后备目录）
       └ agent（UUID；provider；cwd；workspaceId；labels["paseo.parent-agent-id"]；
               config{systemPrompt, model, modeId, mcpServers, toolPolicy, providerOptions…}；
               persistence{provider, sessionId, nativeHandle}；lastStatus；attention；archivedAt；internal）
          ├ provider 会话：CLI 原生的 thread/session，转录存在 CLI 自己的目录
          ├ turn：turnId；同一时刻最多一个前台 turn；CLI 自己发起的 turn 记为 autonomous run
          ├ timeline row：seq + epoch，只在内存，从 provider 历史重建
          ├ pending permissions：内存 Map
          └ provider subagents：CLI 自己派生的子执行，只有描述符和只读 timeline，在内存
schedule（8 位 hex id；cadence 为 cron 或旧的 every；target 是 agent（即 heartbeat）或 new-agent；
          runs[] 内联在同一个文件里；status：active | paused | completed）
```

- **chat（Helm 加的独立对话）** 不是新实体，就是 `purpose:"chat"` 的 workspace，后备目录在 `$PASEO_HOME/chats/` 下。它从项目列表里隐藏，归档会停掉其中的 agent（H3）。上游没有这份文档（U5）。chats.md 的原话是："Coding-agent providers require a working directory"。也就是说，哪怕是纯聊天，也得给 CLI 一个目录。
- **heartbeat** 也不是独立实体，是 `target.type:"agent"` 的 schedule（H15）。
- **持久化**全部是 JSON 文件加原子 rename，用 zod 校验，没有迁移框架。主要文件：
  - `agents/{cwd}/{id}.json`；
  - `schedules/{id}.json`：运行历史内联在里面，越跑越大；
  - `projects/*.json`、`creations/`、`runtime/managed-processes/`、`config.json`；
  - `server-id`、`daemon-keypair.json`、`local-credential`、`paseo.pid`、`push-tokens.json`；
  - 上游新增了 `finish-subscriptions.json`、`hosts.json`。
- **不持久化的：** timeline、待处理的权限请求、provider 子 agent、终端、插件追加的 timeline 行（H4 原话："survive scroll, refetch, and reconnect, but not a daemon restart"）、daemon 注入的系统消息。

#### Q3 一次 agent 回合的完整链路

〔一手，H10、H11、H18、H19〕

1. **客户端** 发 `send_agent_message_request{agentId, text, images, attachments, messageId, activeTurnBehavior}`。
2. **Session.handleSendAgentMessageRequest：**
   - `buildAgentPrompt` 生成 `AgentPromptInput`（字符串或内容块数组）；
   - 有 `messageId` 时走 `messageReceipts`，按消息 id 去重。
3. **`sendPromptToAgent`**（唯一入口：WS、MCP、CLI、完成通知、schedule 都走它）：
   1. 必要时取消归档；
   2. `ensureAgentLoaded`：agent 没在内存就按 persistence handle 懒恢复，并从 provider 历史回灌 timeline；
   3. 可选地切换模式；
   4. `startAgentRun`。
4. **`startAgentRun`：**
   - 先试 `tryRunOutOfBand`：旁路命令（如 `/goal pause`）不占 turn、不打断。
   - 再按 `activeTurnBehavior` 处理：
     - `steer`：调 `steerOrReplaceActiveTurn`。provider 返回 `unavailable` 时退回"打断再重开"；返回错误时视为结果不明，不重试。
     - 否则（人发消息时默认 `interrupt`，同时 `clearPendingPermissions:true`）：`replaceAgentRun` 或 `streamAgent`。
5. **AgentManager：**
   - 为 `clientMessageId` 写一条规范的 `user_message` 行；
   - 调 `AgentSession.startTurn(prompt)` 拿到 `turnId`。
6. **provider 适配器 → CLI：**
   - Claude：SDK `query()` 的输入流；
   - Codex：`turn/start`，steer 走 `turn/steer`；
   - ACP：`session/prompt`。
7. **原生事件 → `AgentStreamEvent`：**
   - 适配器把工具调用归一成 `ToolCallDetail`（shell、read、edit、write、search…）；
   - 权限请求变成 `permission_requested`；
   - 用量变成 `usage_updated` 或 `turn_completed.usage`。
8. **`session.subscribe` 回调 → `enqueueSessionEvent`：**
   - 每个 agent 一条 promise 链，严格串行；
   - steer 期间有屏障，turn 还没确认时事件先暂存。
9. **`handleStreamEvent`：**
   1. 内容截断：工具输出 64 KiB；
   2. 补上 turn 身份；
   3. 合帧器（`agent-stream-coalescer`，见 CB §2）；
   4. 按事件类型分派；
   5. `recordTimeline` 写入 `InMemoryAgentTimelineStore`，分配 seq；
   6. `dispatch` 给所有订阅者。

   另外两条规则：用 `<paseo-system>` 包起来的注入消息不进 timeline，也不唤醒等待者；shell 命令可能改了外部状态时，顺带通知工作区刷新 git。
10. **订阅者：**
    - Session：WS `agent_stream`，带 seq 和 epoch；遇到权限请求另发 `agent_permission_request`；
    - persistence-hooks：写 agent 的 JSON；
    - 插件钩子：只收非 timeline 事件；
    - 完成通知的 watcher、schedule 的等待者。
11. **`emitState`** 计算 attention（running→idle 记"完成"，进入 error 记"出错"）、排队落盘、广播 `agent_state`。

#### Q4 统一 agent 契约

〔一手，H9、H5、H19〕下面只讲对整体架构有影响的部分。

```ts
interface AgentClient {            // 一个 provider 一个；负责发现能力和创建会话
  provider; capabilities: AgentCapabilityFlags;
  createSession(config, launchContext?, options?) / resumeSession(handle, overrides?, …)
  fetchCatalog(options, ctx?)      // 模型和模式一次发现
  isAvailable(); shutdown?(); archiveNativeSession?(); listImportableSessions?(); importSession?()
}
interface AgentSession {           // 一个活着的对话
  startTurn(prompt, opts?) → {turnId};  run(prompt) → AgentRunResult
  steerActiveTurn?(prompt, {expectedTurnId, clearPendingPermissions?}) → accepted | unavailable
  interrupt()                      // 幂等：只有在 provider 可能仍持有该 turn 时才 reject
  subscribe(cb: AgentStreamEvent → void); streamHistory(): AsyncGenerator<AgentStreamEvent>
  getPendingPermissions(); respondToPermission(id, allow{updatedInput?} | deny{message?, interrupt?})
  describePersistence() → {provider, sessionId, nativeHandle}; close()
  usageSession?() → {provider, model, env, sessionKey}   // 给"账户额度"插件用
  tryHandleOutOfBand?(prompt); revertConversation?/revertFiles?; setMode/setModel/setThinkingOption/setFeature
}
```

- **能力声明。** `AgentCapabilityFlags` 列出 streaming、会话持久化、动态模式、MCP、原生工具、推理流、工具调用、回滚。另有 `features`（toggle 或 select），由 provider 上报，界面照着渲染。
- **事件。** `AgentStreamEvent` 包括：`thread_started`、`turn_started/completed/failed/canceled`、`usage_updated`、`timeline`、`permission_requested/resolved`、`mode_changed`、`model_changed`、`attention_required`、`provider_subagent`。
  - timeline 条目分为：`user_message`、`assistant_message`、`reasoning`、`tool_call`、`todo`、`error`、`notification`、`compaction`、`plugin`。
- **权限。** 请求带 `kind`（tool、plan、question、mode、other）、`detail`（`ToolCallDetail`）和有序的 `actions`。回复是 allow 或 deny，可以带 `selectedActionId`、`updatedInput`、`interrupt`。
  - 另有 daemon 级的 `toolPolicy.preapproved`，用来预先放行某些 MCP 工具。
  - 还有 `unattended`（无人值守）判定：provider 根据模式判断这次创建是否需要人审批；父 agent 处于 unattended 时，子 agent 跟着用（H19）。
- **中断与 steer 的规则（H5）：**
  - 中断必须幂等；中断被拒或超时，就拒绝接新活（fail closed），避免脑裂。
  - steer 的准入由 manager 负责，它核对目标就是当前前台 turn。
  - 适配器中断时必须丢弃 provider 还没读到的 steer，否则用户刚停掉的 turn 会被它重新拉起。
- **用量。** `AgentUsage{inputTokens, cachedInputTokens, outputTokens, totalCostUsd, contextWindowMaxTokens, contextWindowUsedTokens}`，所有字段都可选，由 provider 尽力上报。整个代码库里没有任何预算或花费上限（grep `budget`、`spend` 只命中超时预算）。
- **人设注入：**
  - `AgentSessionConfig.systemPrompt` 按 agent 持久化；`daemonAppendSystemPrompt` 是 daemon 级的追加，**刻意不持久化**，每次打开会话重新取，"这样 daemon 设置改了能干净生效"。
  - 两段用 `composeSystemPromptParts` 拼起来，映射到各家原生字段：
    - Claude：`systemPrompt:{type:"preset", preset:"claude_code", append}`，同时加载 CLAUDE.md；
    - Codex：`developer_instructions`，和 profile 自带的指令拼接；
    - OpenCode：`system`；
    - Pi：通过生成的扩展追加。Paseo 故意不用 `--append-system-prompt`，因为它会顶掉 Pi 自己的 `APPEND_SYSTEM.md`。
    - **ACP 类适配器完全不用 systemPrompt**：`acp-agent.ts` 和 `generic-acp-agent.ts` 里 grep 不到。这和决策 4 的判断一致。
- **子 agent 有两种模型：**
  1. **Paseo 子 agent：** 完整的托管 agent，靠 `paseo.parent-agent-id` 标签挂在父 agent 下，父 agent 归档时级联归档。
     - 用 MCP `create_agent` 创建，总是异步，`notifyOnFinish` 默认 true。
     - 子 agent 只继承同 provider 的 `providerOptions`，**不继承 systemPrompt**（H14 的 `resolveInheritedProviderConfig`）。
     - 反过来，agent 自己建 schedule 时会带上自己的 systemPrompt 和 mcpServers。
  2. **provider 子 agent：** Claude Task、Codex 原生子 agent 这类，由 CLI 自己持有。Paseo 只存描述符和只读 timeline（在内存，界面只能看不能对话）。
  - 另外，OMP 的 `child_session` 会被导入成 Paseo 托管子 agent。

#### Q5 事实来源与恢复

**事实来源**〔一手，H1、H10、H13〕

- timeline **不是**事实来源。H1 原话："Timeline rows are runtime memory; provider history is the durable transcript authority and resumed agents rebuild from it."
- AgentManager 预留了一个 `durableTimelineStore` 接口：`appendCommitted`、`fetchCommitted`、`bulkInsert`、`updateCommittedRow`、`getLatestCommittedSeq`。但 bootstrap 没注入任何实现，代码里只有 `InMemoryAgentTimelineStore`。
- 恢复时整段从 `streamHistory()` 重建，并丢弃以前提交过的行。所以 Paseo 自己产生、而 CLI 转录里没有的行，重启后都会丢：插件行、系统注入消息，以及 manager 自己追加的错误行〔推测，后者要看各适配器回放时是否重现〕。

**daemon 重启**

- 启动时只加载 agent 记录，"agents will initialize on demand"。
- 第一次被打开、被发消息或被 schedule 触发时，`ensureAgentLoaded` 才按 persistence handle 调 `resumeSession`，再回灌历史。并发加载会合并成一次。
- 没有 handle 的记录（从没跑起来过的）按保存的配置重新创建。
- Helm 0.11.1 有两个已知缺陷，上游 0.13.0 修了：
  - 重启后 agent 仍显示 running：上游启动时把残留的 running 修成 closed；
  - 重启后父 agent 再也收不到 `notifyOnFinish`：上游把完成订阅持久化了。

**CLI 崩溃**（H2）

- 回合中途死掉：负责读事件流的一方会报 `turn_failed`。
- 两个回合之间死掉：没人盯着，agent 会一直显示 idle。所以规定适配器把这种退出也报成 turn 失败，让 agent 进入 error 并写一条 timeline。目前 Claude 和 OMP 实现了。
- CLI 进程里挂着的后台 shell、Monitor、workflow 会随进程一起丢。
- 没有自动重启。下一次发 prompt 时从持久化句柄恢复。
- 插件运行时被换代导致会话失效时，`reloadAgentSession` 后重试一次（H11）。

**模型接口失败**

- 重试由 CLI 自己做。Paseo 只看到 `turn_failed`：agent 进入 error，attention 标为"出错"（出错不推送到手机）。
- 交互式 agent **没有**备用大脑切换。只有后台"结构化生成"有按 provider 列表逐个兜底的链（H12）。
- daemon 不会自动续跑被打断的回合：schedule 的运行直接记为失败；创建操作在结果不明时返回 `outcome unknown`，不重复执行（CB §3 已列）。

#### Q6 调度与主动

〔一手，H15、H14、H8〕

**ScheduleService 怎么跑**

- 用 `setInterval` 每秒 tick 一次，**每次都 `readdir` 并解析 `schedules/` 下的全部 JSON**。
- cadence 用 protocol 包里自写的 cron 解析器（129 行），支持时区；`every` 是旧格式，仍可读。
- 结束条件：`maxRuns`、`expiresAt`。

**两种 target**

| target | 叫法 | 每次触发做什么 |
| --- | --- | --- |
| `new-agent` | schedule | 先建工作区（local 或 worktree）；再用 `unattended:true, background:true, notifyOnFinish:false` 建 agent，打上 `paseo.schedule-id/run` 标签；跑完提示词，等它回到 idle；把最后一条消息（或 `curateAgentActivity` 压缩出的活动摘要）写进 `runs[].output`；默认归档这个工作区 |
| `agent` | heartbeat | 把提示词包成 `<paseo-system>Schedule "x" fired …</paseo-system>`，投给一个已有的 agent。**如果这个 agent 正在跑，这次运行直接记为失败**（"already has an active run"）；否则以 `replaceRunning + steer` 启动，等回到 idle |

- 不管哪种，等到权限请求一律算失败（无人值守）。等待 idle 的调用没有传超时信号〔一手，读代码所见；实际会不会无限等，待实测〕。
- heartbeat 只能由 agent 自己经 MCP `create_heartbeat` 给自己建，要求 agent 作用域。按 name + target 幂等地创建或替换，删除时校验归属。

**重启时**

- 还在跑的 run 记为失败（"Daemon restarted before the scheduled run completed"）。
- 错过的时间点**不补跑**，直接排到下一个未来时间点。
- target 已删除或已归档的 schedule 直接完成。

**没有的东西**（在 Helm 代码里没找到）：活跃时段、只在空闲时跑、"没话说就不发"的安静返回协议、投递目标、连续出错自动停用。外部事件触发靠 Hub（云端，GitHub、Slack 等），不在本地。

**和 OpenClaw automation 的差异**

- 相同点：两边都没有给"心跳"单独做一套机制，都复用同一个定时引擎。
- OpenClaw 的 automation 带 activeHours、idleOnly、`NO_REPLY`、`record_result`、60 分钟看门狗、连续出错自动停用并通知；Paseo 都没有。
- 主动消息的去向：
  - OpenClaw：结果投给主人；
  - Paseo：heartbeat 的结果留在 agent 自己的对话里，new-agent 的结果写进 schedule 的 `runs`；两种都只给客户端发普通的完成提醒。
- Paseo 多出一个有用的区分："每次开新对话"和"唤醒同一个对话"是同一引擎下的两种 target。

#### Q7 扩展边界

〔一手，H4、H3、H5、H14、H8〕

| 扩展点 | 边界 | 运行位置 |
| --- | --- | --- |
| 内置 provider | 直接实现 `AgentClient`/`AgentSession`；ACP 类继承 `ACPAgentClient`，只提供命令、模式和能力 | worker 进程内 |
| provider 插件 | `server.registerProvider`，基于回调：`connect({launch})`、`session.open/prompt`、`onEvent()` 发布全部状态；`status()` 自检；`runAcpProvider` 快速包一个 ACP CLI。**daemon 负责可执行文件解析和环境变量清洗**，插件负责传输和会话状态 | 插件子进程 |
| Paseo 工具 | 一份与传输无关的工具目录（`paseo-tools.ts` 注册了 40 个：工作区、agent、终端、schedule、heartbeat、provider、权限、speak；浏览器工具由 BrowserToolsBroker 另行提供）。支持原生工具的 provider 直接注入；否则经 `/mcp/agents`（HTTP + bearer）注入。按 provider 用 `paseoTools` 策略开关或禁用单个工具。子 agent 用自己 provider 的策略，不继承父 agent 的 | worker 进程内 |
| 用户 MCP | 写在 agent config 的 `mcpServers` 里，由 CLI 自己连接 | CLI |
| 生命周期钩子 | `server.on` 观察 9 类事件（agent created/closed/turn_started/turn_ended/permission_requested/permission_resolved/archived，workspace created/archived）；`server.before` 可改写 `agent.create`（整份 config 除 cwd）、`agent.session_open`（只能改 env）、`workspace.create`。观察回调不能在 agent 变更流程里被 await，否则会死锁 | 插件子进程 |
| 客户端贡献 | timeline 条目变换和渲染、面板、斜杠命令、附件来源、设置、主题。插件追加的规范行在内存里，重启丢失 | 每个客户端 |
| 用量来源 | 插件读账户额度和余额（`paseo usage`） | 插件子进程 |
| **插件平台 v1（Helm 独有）** | `manifestVersion:1` 声明服务契约（方法的入参和出参都是 JSON Schema）、provider、由消费方持有的依赖、权限、设置。PlatformBroker 负责绑定和调用：调用前后各查一次权限，校验入参和出参；有 `OUTCOME_UNKNOWN` 等错误码。依赖图上每个节点有代际，依赖变化时下游先排空再重建。设置分 host → project → conversation 三层叠加，带修订号和 `CONFIG_CONFLICT`。**目前只实现了 host 作用域的 daemon provider**；客户端入口、事件订阅、Agent 或 MCP 作为调用方都还没做，原因是 MCP 的 `callerAgentId` 不是经过认证的身份 | 插件子进程 |

- **信任模型：** 所有插件都被信任，不做沙箱。H4 原话："`paseo plugin add` … mean 'I trust this codebase'"。

**哪些适合灵鲸的三类插件**〔推测〕

| 灵鲸插件类别 | 可借鉴的 Paseo 机制 | 说明 |
| --- | --- | --- |
| 大脑插件 | provider 插件的形状 | 插件管传输，本体管可执行文件和环境变量 |
| 能力插件 | 插件平台 v1 的"服务契约 + 多个 provider + 显式选择 + 分层设置" | 正好对应"每个能力插件可挂本地或线上实现"。但 v1 的依赖图和代际机制对第一版太重 |
| 形态插件（渠道） | 无 | Paseo 没有对应物，参考 OpenClaw 的渠道插件 |

#### Q8 多端与安全（CB 没讲到的部分）

〔一手，H7、H3、H17、H18〕

**鉴权分层**

1. 默认只绑 127.0.0.1；每个 HTTP 请求和 WS 升级都校验 Host 头白名单，防 DNS rebinding；CORS 只是纵深防御。
2. 可选共享密码（bcrypt 存储），在 WS `hello` 里发送，通过前不发任何会话数据。
3. 每次启动重写 `local-credential`（权限 0600），给同一用户的 CLI 和桌面端用。H7 明说，密码挡的是网络客户端和其他系统用户，**挡不住以 daemon 用户身份运行的进程**。
4. 语义化权限：principal、credential、grant 三层分开；权限有 `daemon.read/manage`、`workspace.read/write/manage`、`automation.manage`、`access.manage`、`tunnel.manage`、`hub.execute`。只有累加的 allow，没有 deny。目前作用于整个 daemon。
   - H3 原话："Agents and terminals use workspace authority … separate write permissions would claim an isolation boundary the daemon cannot enforce"。也就是说，不承诺做不到的隔离。
5. 文件下载和 `/mcp/agents` 各用自己的 capability token。

**relay 的信任模型**

- relay 被设计成不可信、零知识：配对二维码或链接里的 daemon 公钥是信任锚；手机每次连接生成临时密钥。
- Helm 用 NaCl box，**同一会话内没有防重放**（随机 nonce，不记计数器）。上游已换成 Noise NK 加逐条计数器。
- Helm 里，没带密码的 relay 客户端仍放行；上游 0.13 起要求带密码。

**agent 的身份**

- `/mcp/agents` 用一个每次启动随机生成、**所有 agent 共用**的 token。调用方身份就是 URL 里的 `?callerAgentId=`，没有经过认证（H3 明说）。
- 〔推测〕任何拿到注入配置的 agent，都能冒充别的 agent 调工具，例如删别人的 heartbeat、以别人的名义建子 agent。

**权限请求怎么路由给人**

- **主人直接创建的 agent：** 待处理权限放在内存，发给所有订阅该 agent 的客户端（`agent_permission_request`），同时触发 attention 回调。`computeNotificationPlan` 决定推不推：
  - 有客户端正盯着这个 agent，就什么都不发；
  - 否则交给最近 180 秒内活跃的那个客户端，在应用内提醒；
  - 都不在线才发 Expo push。出错不推送。
  - CLI 可以用 `paseo permit allow/deny`；插件可以在 `agent.permission_requested` 钩子里自动回答；语音模式自动放行 `speak` 工具。
- **子 agent（带父标签的）：** 不向人推送 attention。权限请求被包成 `<paseo-system>`，经 steer 送给**父 agent**，并附上 `respond_to_permission` 的用法（H11）。父 agent 可以直接代批。
- **schedule 的无人值守运行：** 一遇到权限请求就失败。

#### Q9 0.11.1 之后上游的架构变化

〔一手，U1–U4〕结论：**整体架构没有大改**。supervisor + worker、单个 AgentManager、JSON 文件、以 CLI 转录为真相，这些都没变。变化集中在下面几点：

| 版本 | 变化 | 对灵鲸的意义 |
| --- | --- | --- |
| 0.12.0 | agent 之间（CLI 或 MCP）发消息改为 **steer 正在跑的 turn**，不再打断；消息带发送者名字；新增 `paseo usage` 查账户额度 | 派活和汇报不打断对方 |
| 0.13.0 | **connected hosts**：daemon 之间建路由会话（多路复用、身份钉死）；agent 工具加 `serverId`，可以跨机器建和管子 agent | 灵鲸单机，不要 |
| 0.13.0 | **完成通知持久化**：新增 `agent/finish-subscriptions/`，存到 `finish-subscriptions.json`；先写意图再承诺通知；至少一次投递；重启后恢复观察，但不恢复子 agent 的工作；子 agent 的汇报和完成通知合成一条消息给父 agent | 主意识盯进度的现成语义 |
| 0.13.0 | 修复：重启后 agent 仍显示 running（启动时把残留 running 修成 closed） | 恢复规则 |
| 0.14.0-beta.1 | **空闲运行时回收**：新增 `agent/idle-runtime-cleanup/`；空闲 1 小时、每分钟检查一次；保留记录和 provider 会话，下次 prompt 再 resume。daemon 有基线判断，provider 可以另外用 `AgentSession.canStopRuntime()` 否决：Claude 看后台任务名单，Codex 看后台终端，ACP 看 turn、权限和终端 | 常驻多对话时省内存 |
| 0.14.0-beta.1 | **agent 消息模块**：新增 `agent/agent-messages/`。信封带来源属性：`<paseo-system version="1" kind="agent-message\|agent-notification" source-agent-id=… message-id=…>`，正文做 XML 转义。人发的消息如果长得像信封，会被转义成普通文本，防止伪造。投递按接收方排队，2 秒安静窗口内的多条合并一次投递；人发的消息不进这个队列 | 来源标签、防操控、主意识收件箱 |
| 0.14.0-beta.1 | 插件可以在 `agent.session_open` 时给**单个 agent** 挂工具和 MCP server（只在启动时生效，不持久化）；`AgentLaunchContext` 加了 `mcpServers` 和 `mcpServerOwners` | 能力按对话下发 |
| 0.14.0-beta.1 | 本地语音模型一键下载，包括 SenseVoice 和 Whisper（中文听写）；语音模式默认关闭 | 决策 1 从上游摘语音模块时直接拿到 |
| 0.12–0.14 | 大量"不阻塞事件循环"的修复，relay 换成 Noise NK（CB 已述）；新增 `workspace-runtime-store`（git 和 forge 快照的内存存储）、后台工作区、"私有 daemon helper"（生成分支名和提交信息的内部临时 agent） | — |

另外两点：

- `agent-sdk-types.ts` 的 diff：上游给 tool_call 行加了 `agentMessage`（agent 消息成为一等条目），加了 `canStopRuntime?()`，去掉了 `resolveNativeSessionPath?()`（Helm 里还有，可能是 Helm 自己加的〔未核实〕）。
- `chats.md`、`plugin-platform.md`、`workbench.md` 上游都没有：独立对话、插件平台 v1、四栏工作台都是 Helm 独有的。

#### Q10 可摘模块清单

行数取自 Helm 0.11.1，用 `wc -l` 统计，不含测试。决策 1 要求从**上游最新**摘，摘的时候要重新数。许可证是 Apache-2.0（`LICENSE` 开头说明第三方组件各按原许可证）；需要保留版权和许可证声明、标注改动、记录来源提交号。

| 模块 | 约行数 | 依赖 | 摘过来要改什么 | 建议 |
| --- | --- | --- | --- | --- |
| `agent/agent-sdk-types.ts` | 818 | `@getpaseo/protocol` 的 ToolCallDetail、ToolPolicy、provider-config 等类型 | 裁掉界面专用字段（icon、colorTier、features 的界面元数据）；人设拆成"稳定人设"和"运行时追加"两段；`turn_completed.usage` 改为必填；加上游的 `canStopRuntime` | 契约起点（决策 2） |
| Claude 适配器 `providers/claude/` | 约 11,100（`agent.ts` 6634） | `@anthropic-ai/claude-agent-sdk`、pino、zod；共享的 provider-launch-config、notices、options、refresh-deadline、session-import、history-timestamps、prompt-attachments、diagnostic-utils、provider-image-output、provider-runner、system-prompt，以及 utils/spawn、tree-kill、promise-timeout | 去掉对 Paseo 工具目录和 MCP 注入的耦合；model-manifest 要自己维护；subagents 只留观测部分，去掉界面呈现 | 照搬为主 |
| Codex 适配器 `codex-app-server-agent.ts` + `codex/` | 约 9,800 | executable-resolution、**workspace-git-service**、activity-curator | 断开 workspace-git 依赖；每个成员一个 `CODEX_HOME`（OpenClaw 做法）；把进程写进登记表 | 照搬为主 |
| ACP 适配器 `acp-agent.ts` + `generic-acp-agent.ts` + `acp-options.ts` | 约 4,350 | `@agentclientprotocol/sdk`、create-agent-mode | 补人设注入的退路：工作目录指令文件或提示词前缀 | 照搬 |
| 工具调用归一 `tool-call-detail-primitives.ts`、`tool-call-mapper-utils.ts`，加 protocol 的 tool-call-display、tool-name-normalization | 约 1,320 + protocol 部分 | 无业务依赖 | 无 | 照搬 |
| `agent-response-loop.ts` + `structured-generation-providers.ts` | 约 520 | AgentManager（`createAgent`、`runAgent`、`closeAgent`）、ajv、zod | 把 AgentManager 换成灵鲸的大脑服务；provider 列表来自配置 | **照搬**：后台任务（记忆抽取、写日记）走 CLI 时，"一次性内部对话 + JSON Schema 校验 + 重试 + 换大脑兜底"的现成实现 |
| `agent-prompt.ts` 里的系统信封和完成通知部分，加上游 `agent-messages/`（约 16 KB）、`finish-subscriptions/`（约 14 KB） | 约 600 + 上游约 900（按字节估） | AgentManager、AgentStorage | 投递队列和订阅意图改存 SQLite；通知内容换成灵鲸的进度摘要格式 | 改造 |
| `agent-stream-coalescer.ts`、`timeline-projection.ts` | 291 + 686 | 无 | 见 CB §3 | 照搬 |
| schedule：`cron.ts` + protocol `cron-expression.ts` | 117 + 129 | 无 | 只摘 cron 解析和 `computeNextRunAt`；`service.ts`（1036）和 `store.ts`（285）只作参考，在 SQLite 上重写 | 改造 |
| `managed-processes.ts` + `utils/tree-kill.ts` + `utils/spawn.ts` | 455 + 122 + 78 | zod | 改成登记**所有** CLI 进程 | 照搬 |
| `scripts/supervisor.ts` 加 `daemon-worker.ts` 里的自检部分 | 502 + 约 100 | rotating-file-stream | 用 launchd 守护时可以不要 supervisor，只留 worker 自检和优雅退出 | 参考 |
| `creation/index.ts` | 378 | zod、文件 | 改存 SQLite；保留"指纹冲突、先记身份再占资源、`inFlight` 中断就标 outcome unknown" | 改造 |
| `agent-attention-policy.ts` | 80 | 无 | 推送渠道换成灵鲸的 notify 模块 | 照搬 |
| 上游 `idle-runtime-cleanup/` | 约 150（按 5.9 KB 估） | AgentManager 能力接口 | 无 | 照搬思路 |
| `speech/` + `dictation/` | 约 6,000 | sherpa-onnx-node、openai | 从上游 0.14 摘（带 SenseVoice 和 Whisper） | 决策 1 已定 |
| AgentManager、Session、websocket-server、MCP 工具目录、插件平台、relay、Hub、connected hosts | 合计 2 万行以上 | — | — | **不要整块摘**，只读其中的规则 |

## 3. 对照灵鲸

| Paseo 机制 | 灵鲸对应的需求 | 建议 | 理由 |
| --- | --- | --- | --- |
| 本体不带大脑：每个 agent 都是外部 CLI 会话，藏在 `AgentClient`/`AgentSession` 后面 | 决策 2、4：大脑全部走 CLI，统一契约 | **照搬**结构 | 比 OpenClaw 更贴合：OpenClaw 有进程内 runner，Paseo 没有。契约里已有 steer、中断幂等、权限种类、用量、人设映射 |
| `systemPrompt`（持久化）+ `daemonAppendSystemPrompt`（不持久化，每次打开会话重新取），映射到各家原生字段；ACP 不注入 | 人设三层：出生设定、成长、当下状态 | **改造** | 两段式正好对应"稳定人设"和"运行时追加"。出生设定和当前成长版本作为持久段；当下状态和本轮相关记忆作为运行时段。〔推测〕运行时段只在打开会话时生效，会话中途心情变了，要么 reload 会话，要么用 steer 注入一段 `<系统>` 上下文，需要设计。ACP 走决策 4 的退路 |
| 子 agent 用 `create_agent` 创建，不继承 systemPrompt | 分身必须带她的完整人设；朋友带朋友自己的人设 | **改造** | 由本体在创建分身或朋友对话时显式注入对应人设，不靠继承，也不让模型自己决定带什么 |
| 父标签 + 级联归档 + 子 agent 列表；一个 workspace 里一棵 agent 树；没有中心大脑 | 唯一主意识 + 多个对话 + 子对话 | **改造** | 树结构、级联、"关标签页不等于归档"可以照搬。但 Paseo 里任何 agent 都可以当编排者，灵鲸要把"主意识"做成本体里的唯一根节点：分身和朋友的对话挂在它下面，主人仍可直接打开任何节点 |
| `notifyOnFinish`：子 agent 完成、出错或要权限时，用 `<paseo-system>` steer 给父 agent，附最后一条回复（截到 4000 字）；上游把订阅意图持久化，至少一次投递 | 主意识盯进度、分身汇报 | **照搬**机制，**改造**内容 | 正好是"主意识只收里程碑、不收 token 流"。内容换成固定格式的进度摘要；订阅意图存 SQLite（上游已验证"先写意图再承诺通知"） |
| 子 agent 的权限请求不推给人，交给父 agent，用 `respond_to_permission` 代批 | 主人审核；主意识只负责提醒 | **不要**默认代批 | 主意识的草案大脑是 DeepSeek Flash，让弱模型批危险操作不合适。分身的权限请求应作为注意力事件直接给主人（主意识只负责提醒）；能自动放行的只限白名单规则（参考 Paseo 插件钩子自动回答） |
| 上游 agent 消息信封：来源属性 + 正文转义 + 把人发的伪信封转义掉 | 派活传原话；记来源；防操控 | **照搬** | 来源写进 CLI 转录，回放后还在；转义防止有人在群里伪造"系统消息"。灵鲸的信封要多带场合和受众 |
| 上游按接收方排队，2 秒安静窗口合并 agent 消息；人发的消息直发 | 主意识收件箱（聊天常连发几条） | **改造** | 和 OpenClaw 的 collect 思路一致。灵鲸对主意识可以把主人的连发也合并（OpenClaw collect），分身默认 steer |
| 人发消息默认 interrupt；agent 间默认 steer；旁路命令不占 turn | 主人补充要求、叫停 | **照搬** | 规则清楚。分身对话里主人追加要求默认 steer，"叫停"是 interrupt |
| 中断幂等，结果不明就拒绝接新活 | 一键暂停、叫停 | **照搬** | 防止脑裂；一键暂停要等所有对话确认停下才算完成 |
| timeline 只在内存，CLI 转录是持久真相；`durableTimelineStore` 只有接口没有实现 | 操作日志是唯一事实来源 | **不要**以 CLI 转录为真相；**照搬**插入点 | 同 CB §3"操作日志与投影"的结论。具体落点：大脑事件进 journal 的位置，就是 Paseo 的 `recordTimeline` 加 `durableTimelineStore.appendCommitted`；`streamHistory()` 只用在导入外部会话和校验，不用来重建真相 |
| 懒恢复（按需 resume）+ 上游空闲 1 小时回收 + `canStopRuntime` 否决 | mac mini 上常驻很多对话 | **照搬** | 主意识常驻；分身空闲就释放进程，下次 resume。否决条件防止误杀后台任务 |
| 交互式 agent 不切换备用大脑；只有结构化生成有 provider 兜底链 | 决策 6：配备用大脑 | **改造** | 后台任务直接用兜底链。交互对话的切换要由本体做：resume 失败或连续 `turn_failed` 时，换大脑开新会话，再从**日志**重建上下文（不能靠旧 CLI 的转录） |
| `agent-response-loop`：一次性 internal agent + JSON Schema + 重试 + 换 provider | 后台任务（记忆抽取、每晚整理、日记）走 CLI | **照搬** | 和决策 4 完全对得上；`internal` 标记让这些对话不出现在列表里，也不触发通知 |
| schedule（每次新对话）和 heartbeat（唤醒已有对话）共用一个 cron 引擎 | 生活循环、兑现承诺、每晚整理、主动关心 | **改造** | 两种 target 都有用：每晚整理和日记用新对话，主动关心唤醒主意识。但要补上 OpenClaw 的活跃时段、只在空闲时跑、安静返回、出错停用并通知；heartbeat 遇到对话正忙不能直接算失败，应该排进收件箱；错过的时间点按作业类型决定补不补（承诺类要补，巡检类不补）；不要每秒扫目录，用 SQLite 加下一次触发的定时器 |
| `AgentUsage` 全是可选字段；没有预算上限；用量来源插件只报账户额度 | 花钱总闸（本体执行，她不知道） | **改造**为必选 + 新建总闸 | 契约里每个 turn 结束必须带用量；按次计费的大脑记 token 和费用，订阅制 CLI（如 Claude 订阅）报不出费用，就用账户额度窗口。总闸放在 `startTurn` 之前：本体做准入检查，不放在提示词里 |
| unattended：无人值守的运行一遇到权限请求就失败 | 夜间整理、日记等后台对话 | **照搬** | 后台任务不该卡在等审批上；工具权限用白名单预先放行 |
| 两级进程（supervisor + worker，IPC 心跳） | 本体常驻 | **改造** | 灵鲸用 launchd KeepAlive 代替 supervisor（CB §3 已定单进程），只保留 worker 的优雅退出和"父进程没了就退出"思路 |
| managed-processes 只登记 helper 进程，不登记 Codex 和 Claude 的会话进程 | 本体崩溃后不留孤儿 CLI | **改造** | 所有 CLI 进程都要登记，查不清就拒绝再 spawn（OpenClaw 更严，见其报告第 3 节） |
| 创建日志（幂等 key、指纹冲突、outcome unknown 不重复执行）+ 消息回执 | 派活、主人消息不重复 | **照搬**语义 | 改存 SQLite；派活本身也是一个带幂等 key 的操作 |
| 独立对话 = `purpose:"chat"` 的工作区，私有目录在 `$PASEO_HOME/chats` | 主意识和非编码对话也需要 cwd | **照搬** | CLI 一定要工作目录；每个对话一个私有目录，也正好放 ACP 用的人设指令文件 |
| 一套与传输无关的工具目录，MCP 只是适配器；按 provider 开关工具 | 内核工具清单；按类别收回能力 | **照搬**结构 | 一键暂停或收回能力时，在工具目录这一层按对话过滤 |
| MCP 调用方身份 = URL 参数，所有 agent 共用一个 token | 分身、朋友身份分明；朋友不能冒充她 | **不要** | 每个对话一个 token，调用方身份从 token 推出来 |
| 插件不沙箱、完全信任；生命周期钩子（before/on） | 三类插件；技能和自写工具要隔离 | **改造** | 钩子形状可用。第一版插件只认本体内置和主人亲手装的；她自写的工具不能走同一个"完全信任"通道 |
| 插件平台 v1：服务契约、多 provider、显式选择、三层设置 | 能力插件挂本地或线上实现；系统、成员、对话三级配置 | **借鉴**，第一版不做 | 概念合适，实现太重（依赖图、代际、排空）。第一版用"能力接口 + 实现注册表 + 一层配置"就够 |
| attention 推送规则（有人在看就不推；在线就应用内提醒；离线才推送） | notify 模块，电脑通知 | **照搬** | 直接对应 CB §3 的 notify |
| relay、Hub、connected hosts、多主机、语义权限的 principal 体系 | 单主人、单机、Tailscale | **不要** | 同 CB §3 |
| JSON 文件 + 原子 rename | 存储 | **不要** | 决策 3 已定 SQLite |

## 4. 和 OpenClaw 的横向对比

| 问题 | Paseo（Helm 0.11.1，上游 0.14） | OpenClaw（2026.10.x，只读了文档） | 对灵鲸更合适的 |
| --- | --- | --- | --- |
| 进程 | supervisor + worker 两级，worker 崩溃由 supervisor 重启；所有 CLI 都是子进程 | 一个 Gateway 进程，由 launchd 守护；进程内 runner + Codex 和 ACP 子进程 | OpenClaw 的单进程 + launchd 更简单；Paseo 的"父进程没了就退出"值得留 |
| 大脑接入 | 只做外部 CLI 的包装：直连（Claude SDK、Codex app-server）+ ACP；契约里有 steer、权限、用量、人设映射 | 内置 runner 为主；Codex 走 harness 插件，其他 CLI 走 ACPX 插件 | **Paseo**（决策 2、4） |
| 人设 | 每个 agent 一段 systemPrompt + daemon 追加段，映射到原生字段；ACP 不支持 | 工作区引导文件（SOUL.md 等），由 runner 注入，有截断和缓存边界 | Paseo 的映射层 + OpenClaw 的分段（缓存边界上方放稳定内容） |
| 多 agent 的组织 | 每个工作区一棵 agent 树，没有中心；任何 agent 都可以经 MCP 编排；编排套路写成技能（提示词层） | 各 agent 平级，各自以 main 会话为根；spawn 树最多 5 层，每会话并发 8 | 两边都没有"唯一主意识"。灵鲸取 OpenClaw 的"main 会话当根"，加上 Paseo 的父子树和完成通知 |
| 子 agent 的人设 | 不继承 systemPrompt | 只注入 AGENTS.md | 都不合适，灵鲸由本体显式注入 |
| 子 agent 回报 | `<paseo-system>` steer 给父 agent；上游持久化，至少一次 | announce 回报 | 用 Paseo 的（更完整，有持久化语义） |
| 子 agent 的权限 | 推给父 agent 代批 | exec 审批、工具策略 | 都不照搬，给主人 |
| 收件与排队 | 每 agent 一个前台 turn；人发 interrupt，agent 间 steer；上游按接收方排队并开 2 秒窗口合并 | 会话邮箱：steer、followup、collect、interrupt 四种模式 + 全局 lane 并发上限 | **OpenClaw** 更完整；Paseo 没有全局并发上限〔未查到〕 |
| 主动性 | schedule（新对话）和 heartbeat（已有对话）共用 cron；没有活跃时段、只在空闲时跑、安静返回；忙就算失败；错过的不补 | heartbeat 已退役并入 automation；Proactive check 每 30 分钟，活跃时段、只在空闲时跑、`NO_REPLY`、`record_result`、出错停用 | 策略用 **OpenClaw** 的；"新对话 / 唤醒已有对话"这两种 target 的区分用 Paseo 的 |
| 事实来源 | CLI 转录是真相；timeline 在内存；agent 记录是 JSON | 每 agent 一个 SQLite 存转录；状态表 + Markdown 记忆 | 两边都不是事件日志，灵鲸自己做 journal；OpenClaw 至少把转录握在自己手里，比 Paseo 近一步 |
| 重启恢复 | 懒恢复；被打断的回合不续跑；schedule 记失败、不补跑；创建结果不明不重复 | 自动续跑被打断的回合（保留已记录的工具调用，3 次启动失败用尽预算，续跑前复核权限）；过期作业重新排期 | 续跑规则用 **OpenClaw** 的；"结果不明不重复"和懒恢复用 Paseo 的 |
| 大脑失败 | 交互式不切换；后台结构化生成有兜底链 | fallback 链（细节没读） | 两边都要补；灵鲸的切换要基于日志重建上下文 |
| 孤儿进程 | 只登记 helper 进程，对账时只杀指纹匹配的 | spawn 前写入 SQLite，按 pid、启动时间、命令行指纹清理；查不清就拒绝 spawn | **OpenClaw** |
| 扩展 | provider 插件、生命周期钩子、客户端贡献、工具目录；插件平台 v1（服务契约、依赖图、三层配置）；不沙箱 | plugin-sdk：渠道插件、harness 插件；核心负责 message 工具和路由 | 大脑插件取 Paseo；形态插件取 OpenClaw；能力插件借鉴 Paseo 平台 v1 的概念 |
| 渠道（形态） | 没有，只有客户端 | 渠道插件 + bindings + sessionKey 语法 | **OpenClaw** |
| 鉴权 | 默认绑回环 + Host 白名单 + 可选密码 + 本机凭据文件 + relay 端到端加密；语义权限；agent 的 MCP 身份没有认证 | 设备配对 + 签名；先身份、再范围、最后模型；跨 agent 可见性默认全开 | 单主人：本机免密 + 远程 token（同 OpenClaw 报告第 3 节）；agent 身份用每对话 token |
| 花钱 | 只报用量，没有上限 | 没读到系统级上限 | 两边都没有，灵鲸自建 |
| 复杂度 | Session 8808 行、AgentManager 5425 行、到处是兼容垫片 | 文档 1436 页、schema 30 多版 | 两边都是反例：灵鲸一开始就把模块边界定死 |

## 5. 坑与反例

1. **以 CLI 转录为真相，Paseo 自己的东西重启就丢**〔一手〕：插件行、系统注入消息、manager 追加的错误行，以及 Helm 里的完成订阅（上游 0.13 才持久化），重启后都没了。灵鲸的 journal 必须在 CLI 之外独立存在。
2. **子 agent 不继承人设**〔一手〕：照抄 `create_agent`，分身就不是"她"了。和 OpenClaw 报告坑 4 同类。
3. **让父 agent 代批子 agent 的权限**〔一手 + 推测〕：Paseo 默认把权限请求和 `respond_to_permission` 的用法一起交给父 agent。灵鲸的主意识是弱模型，等于让它替主人做安全决定。
4. **heartbeat 撞上正忙的对话就算失败**〔一手〕：主意识正和主人聊天时，生活循环事件会丢。灵鲸要排队或合并。
5. **错过的时间点不补跑**〔一手〕："提醒你下午三点开会"这类承诺，赶上本体重启就丢。按作业类型区分补跑策略。
6. **schedule 每秒扫目录并解析全部 JSON，`runs[]` 内联、越跑越大**〔一手〕：作业多了会堵事件循环（上游一直在修这类阻塞）。
7. **schedule 等 idle 没有超时**〔一手，读代码所见〕：子对话卡住时，这次运行一直挂着，同一作业不会再触发（`runningScheduleIds` 拦着）。OpenClaw 有 60 分钟看门狗。
8. **MCP 调用方身份没有认证**〔一手〕：所有 agent 共用一个 token，身份放在 URL 参数里。灵鲸里朋友和分身要权限分明，不能这样。
9. **CLI 两回合之间死掉，agent 看起来还健康**〔一手，H2〕：后台任务随进程一起没了，完成通知永远不来。适配器必须把这种退出报成失败；灵鲸还要有看门狗。
10. **中断不是天然幂等的**〔一手，H5〕：OpenCode 的取消是整个会话范围的，取消请求还在路上时，会把紧接着的新 run 也杀掉。适配器要自己维护"停止中"状态。灵鲸契约照抄这条规定。
11. **Codex app-server 不支持临时会话**〔一手，代码注释〕：`persistSession:false` 是空操作。后台任务每次都会在 `~/.codex/sessions` 留下转录，删除和隐私要覆盖到 CLI 那一侧（OpenClaw 报告坑 10 同类）。
12. **巨型对象**〔一手〕：AgentManager 把状态机、timeline、权限、attention、持久化触发、子 agent 存储、插件发布都放在一个类里；Session 8808 行。灵鲸按 CB §3 的模块表拆：brains、conversations、journal、guard。
13. **插件全信任、不沙箱**〔一手〕：适合开发者工具，不适合"她自己做工具"。第四版的自写工具要另走隔离通道。

## 6. 待实测或待核实

- daemon 被 `kill -9` 后，detached 的 `codex app-server` 和 SDK 拉起的 `claude` CLI 会不会成为孤儿（它们不在登记表里）。
- `daemonAppendSystemPrompt` 改动后，正在运行的会话要 reload 才生效吗？会话中途注入当下状态，最合适的通道是 steer、developer 消息还是重开会话？
- Claude 适配器设了 `allowDangerouslySkipPermissions: true`，再用 `canUseTool` 接管审批。各模式下是不是所有工具都会经过 Paseo 的权限流（关系到总闸和一键暂停能不能拦住工具调用）。
- 各 CLI 在 `turn_completed` 上报的 usage 完整度：Claude 订阅制有没有 `totalCostUsd`，Codex、ACP 有没有 token 数。这决定花钱总闸能不能按 token 计。
- Paseo 有没有全局并发上限，同时跑 N 个对话时怎么排队〔未查到〕。
- schedule 等待 idle 卡住的实际表现（第 5 节第 7 条）。
- Helm 的 `resolveNativeSessionPath` 是 Helm 自己加的，还是上游删掉的。
- 上游最新各模块的确切行数和提交号（摘取时重新统计）。
- 沿用 OpenClaw 报告的待测项：Codex 原生子 agent 会不会继承用 `developer_instructions` 注入的人设（Paseo 的 Codex 适配器正是用这个字段注入）。

## 7. 整体架构问题 A–J 速答

- **A 进程模型与分层**：supervisor 加 worker 两个 Node 进程。所有子系统在 worker 里，每个 CLI 会话一个子进程（Claude 经 SDK spawn CLI，Codex 每会话一个 app-server，ACP 和 Pi 走 stdio），插件 server 端是子进程。依赖单向：接入层 → 应用服务 → AgentManager → AgentClient → CLI，但几个类都太大。
- **B 核心对象与数据模型**：host → project → workspace → agent → provider 会话 → turn → timeline row；schedule 指向一个已有 agent（heartbeat）或每次新建 agent。独立对话就是 `purpose:"chat"` 的 workspace。全部 JSON 文件，没有"数字生命"或"主意识"这类对象。
- **C 事件流**：外部只有客户端请求、cron tick 和 Hub 触发三种入口，都汇到 `sendPromptToAgent`。每个 agent 的事件串行处理，分派给订阅者；agent 间消息和完成通知用 `<paseo-system>` steer 给对方。上游加了按接收方排队、2 秒合并。
- **D 中心调度还是平级**：没有中心。每个工作区一棵 agent 树，任何 agent 都能经 MCP 编排别人；编排套路是提示词层的技能。父子关系只用来回报、级联归档和展示。
- **E 主动性调度**：一个 cron 引擎，每秒扫一次。新建 agent 用于定时作业；heartbeat 唤醒已有 agent，正忙就失败。没有活跃时段、只在空闲时跑、安静返回；重启后错过的不补。
- **F 事实来源与持久化**：以 CLI 自己的转录为真相，daemon 的 timeline 只在内存、恢复时从转录重建。元数据是 JSON 状态文件，没有事件日志。`durableTimelineStore` 只有接口。
- **G 扩展边界**：provider（大脑）插件、生命周期钩子、客户端贡献、与传输无关的工具目录（MCP 只是适配器）、用量来源。Helm 另有插件平台 v1：服务契约、依赖图、三层配置，只实现了 host 作用域。插件都不沙箱。
- **H 多端连接与同步**：见 CB §2、§3。另外，上游 0.13 加了 daemon 之间的 connected hosts。
- **I 安全与权限边界**：默认绑回环 + Host 白名单 + 可选密码 + 本机凭据文件；relay 零知识、端到端加密；语义权限作用于整个 daemon。agent 之间没有隔离：MCP 共用一个 token，身份放在 URL 参数里。子 agent 的权限请求交给父 agent。
- **J 出错与恢复**：worker 崩溃由 supervisor 重启；agent 懒恢复；CLI 死掉报成 turn 失败、不自动重启；中断结果不明就拒绝新活；创建结果不明不重复；schedule 被打断记失败、错过的不补；交互式没有备用大脑，后台结构化生成有兜底链；helper 进程启动时对账。
