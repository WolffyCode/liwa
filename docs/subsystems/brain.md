# Brain providers

English | [中文](brain.zh.md)

Brain providers connect agent CLIs to Liwa: the deepseek agent process, Claude Code, Codex, and generic ACP agents each run as one CLI process per session, and the Liwa process holds only their clients. [`liwa-brain`](../../packages/brain/brain/README.md) defines the contract every client implements and the `ctx.brains` service that opens sessions on them.

## Contract

A provider declares a `Meta`: the delivery matrix (next step, next turn, whether cancel keeps the queue), whether it resumes, whether its compaction or native tools can be switched off, how it injects the persona, its transport, and whether it observes its own child agents. A session is opened with one `SessionConfig` and streams `BrainEvent`s: turn start and end with usage, message and reasoning increments, tool calls, permission requests and their resolutions, provider-level usage, child agents, and CLI exits. Semantics a provider declares false always answer `unsupported`, so the layer above can supply them at turn boundaries.

Permission requests say what they are (tool, plan, mode, question); a question carries typed questions and is answered with typed answers, and the owner — never a parent agent — answers a child agent's request. Child agents are session-scoped: their events carry the child id and the turn that started them and keep arriving after that turn ends, and a provider may start a turn of its own when a background child's result wakes its CLI. Sessions switch models and modes through the handle when the provider declares it, and image input travels as content-addressed blobs the provider reads back. Everything else in the session configuration — native tools, compaction, repository documents, rules, skills, environment — is the provider's to carry out, and a combination it cannot honour fails when the session opens.

## Sessions

`ctx.brains.createSession` checks the configuration against the provider's `Meta`, creates the provider's home inside the member configuration directory, and wraps the provider session in one handle. The handle fans events out to every subscriber, tracks the running turn and pending permissions, sums usage, records every process the session spawns and reports its exit, records child agents and closes the unfinished ones as `aborted`, and closes with the context that opened it. A cancel the provider does not confirm leaves the session refusing new turns until a later cancel succeeds.

## Providers

Three providers ship. [`deepseek`](../../packages/brain/brain-deepseek/README.md) runs Liwa's own agent as one `liwa --profile deepseek` process per session, speaking ACP plus the `_liwa` extension. [`acp`](../../packages/brain/brain-acp/README.md) connects other ACP CLIs through Paseo's client. [`claude-code`](../../packages/brain/brain-claude-code/README.md) uses the official SDK and an explicitly resolved local Claude binary, with independent credential references and generated member configuration. Claude accepts work sessions; real CLI verification remains A2. All three are plugin rows in `web`, `headless` and `brain`; ACP and Claude examples are disabled until configured. The `deepseek` process extends the base ACP server through `ctx.acpExtensions`, listed below.

Completed turns carry usage; interrupted and failed turns may carry observed spending. The first terminal result settles a turn once. Provider snapshots and child breakdowns do not add the same consumption again; absent terminal usage remains unknown.

## Records

Providers, processes, sessions, child agents, and usage are in-memory records in this release, emitted as the versioned events below so the future experience stream can persist them. The [`liwa brain`](../../packages/bundle/brain-cli/README.md) command lists, probes, and tries providers, and the [test kit](../../packages/test-support/brain-testkit/README.md) holds the contract suite every provider passes.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxacpextensions--acpextensionregistry"></a>

### `ctx.acpExtensions` — `AcpExtensionRegistry`

`ctx.acpExtensions`：ACP 扩展的登记表（扩展插件看到的那一面）。

```ts cordis-catalog
/**
 * 登记一个扩展，直到返回的函数被调用。
 * @param extension - 扩展。
 * @returns 释放函数。
 * @throws 传输已连上（扩展方法只能在连上之前加），或方法名不以 `_` 开头、与已登记的重名。
 */
register(extension: AcpExtension): () => void

/**
 * 按会话号找会话（给扩展方法用）。
 * @param sessionId - 会话号。
 * @returns 会话；没有时为 `undefined`。
 */
session(sessionId: string): AcpSessionView | undefined

/**
 * 一个 Agent 归哪个会话上报。
 * @param agent - Agent（可以是后代）。
 * @returns 会话；不属于任何开着的会话时为 `undefined`。
 */
sessionOf(agent: Agent): AcpSessionView | undefined
```

Types: [Agent](core.md)

Source: [`packages/acp/acp/src/extensions.ts`](../../packages/acp/acp/src/extensions.ts)

<a id="ctxbrains--brainregistry"></a>

### `ctx.brains` — `BrainRegistry`

`ctx.brains`：提供方登记、可用性探测、成员配置目录、会话的开启与续接、会话 / 子 agent / 进程 / 用量的登记。 提供方的登记与调用方的会话都是调用方上下文里的 effect：提供方插件卸载时它的会话一起关，调用方卸载时它开的会话一起关。

```ts cordis-catalog
/**
 * 登记一个提供方，直到返回的函数被调用或登记它的插件卸载；释放时它开着的会话一起关。
 * @param provider - 提供方；`impl` 与 `meta` 在这里校验。
 * @returns 释放函数。
 * @throws {BrainError} `invalid_input`（实现名或能力声明不合规）、`conflict`（实现名已被登记）。
 */
register(provider: BrainProvider): () => void

/**
 * 一个提供方的能力声明。
 * @param impl - 提供方。
 * @returns 能力声明的副本。
 * @throws {BrainError} `not_found`。
 */
describe(impl: ImplId): Meta

/**
 * 全部已登记的提供方（`brain_provider`）。
 * @returns 按实现名排序的登记副本。
 */
list(): BrainProviderView[]

/**
 * 探测一个提供方能不能开会话；结果记进登记，不可用时发 `brain.provider.unavailable.v1`。探测本身出错或超时按不可用处理。
 * @param impl - 提供方。
 * @param signal - 取消探测。
 * @returns 探测结果。
 * @throws {BrainError} `not_found`。
 */
async probe(impl: ImplId, signal?: AbortSignal): Promise<BrainProbeResult>

/**
 * 生成或刷新成员给某家提供方的配置目录（01 §4.6），每次覆盖：建好 `<brains>/<impl>/`，内容由提供方的
 * `writeMemberConfig` 写。
 * @param member - 成员。
 * @param impl - 提供方。
 * @param spec - 规矩、本事目录、模型（可省）、MCP、是否读仓库指令。
 * @returns 成员配置目录，作为 `SessionConfig.configDir`。
 * @throws {BrainError} `not_found`（没有这个提供方），或提供方写法自己的失败。
 */
async prepareConfigDir(member: MemberId, impl: ImplId, spec: MemberConfigSpec): Promise<string>

/**
 * 开一个新会话。先做四项核对：压缩关不掉的提供方不接 `compaction: 'off'`；原生工具去不掉的提供方不接
 * `nativeToolPolicy: 'none'`；没有会话模式的提供方不接 `modeId`；原生子 agent 只对干活的活放开，其余种类改成关并记在
 * `adjustments` 里。其余策略（工具、压缩、仓库指令、规矩、本事的实际落实）由提供方在开会话时负责，做不到的组合由它拒绝。
 * @param owner - 归属方上下文；它卸载时会话一起关。
 * @param request - 提供方与会话配置。
 * @returns 会话句柄。
 * @throws {BrainError} `not_found`、`invalid_input`、`timeout`，或提供方自己的失败。
 */
async createSession(owner: Context, request: CreateSessionRequest): Promise<BrainSession>

/**
 * 在新进程里续接一个会话（提供方 `Meta.resume` 为 true 时）。核对同 {@link createSession}。
 * @param owner - 归属方上下文；它卸载时会话一起关。
 * @param request - 提供方、续接句柄与这一代的会话配置。
 * @returns 会话句柄。
 * @throws {BrainError} `not_found`、`unavailable`（提供方不支持续接）、`invalid_input`、`timeout`，或提供方自己的失败。
 */
async resumeSession(owner: Context, request: ResumeSessionRequest): Promise<BrainSession>

/**
 * 跨 CLI 子活的会话（01 §4.5 路②）。要等第三层的 tasks；这一阶段只留接口位置，调用即报"未实现"。
 * @param _owner - 归属方上下文。
 * @param _request - 父活、提供方与会话配置。
 * @returns 永远以 `BrainError(unavailable, brain.not_implemented)` 拒绝。
 */
openChildTask(_owner: Context, _request: OpenChildTaskRequest): Promise<BrainSession>

/**
 * 某个会话的子 agent。
 * @param sessionId - 会话号。
 * @returns 子 agent 登记的副本。
 * @throws {BrainError} `not_found`（没有开着的这个会话）。
 */
children(sessionId: BrainSessionId): BrainChildView[]

/**
 * 一个开着的会话。
 * @param sessionId - 会话号。
 * @returns 会话句柄；没有时为 `undefined`。
 */
get(sessionId: BrainSessionId): BrainSession | undefined

/**
 * 全部开着的会话（`brain_session` 里未关的行）。
 * @returns 会话登记的副本。
 */
listSessions(): BrainSessionView[]

/**
 * 开着的会话拉起过的进程（`brain_process`）。
 * @returns 进程登记的副本。
 */
processes(): BrainProcessView[]

/**
 * 订阅用量（guard 以后经它记账）。随调用方上下文释放。
 * @param listener - 收到每条用量记录。
 * @returns 取消订阅。
 */
onUsage(listener: (record: BrainUsageRecord) => void): () => void
```

Source: [`packages/brain/brain/src/index.ts`](../../packages/brain/brain/src/index.ts)

<a id="ctxbrainstartup--brainstartupvalues"></a>

### `ctx.brainStartup` — `BrainStartupValues`

命令执行方从 BRAIN_STARTUP_SERVICE 读到的东西。

Source: [`packages/bundle/brain-cli/src/startup.ts`](../../packages/bundle/brain-cli/src/startup.ts)

<a id="brainchildendedv1-events"></a>

### `brain.child.ended.v1/*` events

<a id="brainchildendedv1--emit"></a>

#### `brain.child.ended.v1` — emit

子 agent 结束了；会话先关时由 brains 补记 `aborted`。

```ts cordis-catalog
/**
 * 子 agent 结束了；会话先关时由 brains 补记 `aborted`。
 * @param view - 带结束原因与用量的子 agent 登记。
 * @mode emit
 */
'brain.child.ended.v1'(view: BrainChildView): void
```

Source: [`packages/brain/brain/src/index.ts`](../../packages/brain/brain/src/index.ts)

<a id="brainchildopenedv1-events"></a>

### `brain.child.opened.v1/*` events

<a id="brainchildopenedv1--emit"></a>

#### `brain.child.opened.v1` — emit

提供方报了一个子 agent（`brain_child` 新行）。

```ts cordis-catalog
/**
 * 提供方报了一个子 agent（`brain_child` 新行）。
 * @param view - 子 agent 登记。
 * @mode emit
 */
'brain.child.opened.v1'(view: BrainChildView): void
```

Source: [`packages/brain/brain/src/index.ts`](../../packages/brain/brain/src/index.ts)

<a id="brainprocessexitedv1-events"></a>

### `brain.process.exited.v1/*` events

<a id="brainprocessexitedv1--emit"></a>

#### `brain.process.exited.v1` — emit

一个登记过的进程退出了。

```ts cordis-catalog
/**
 * 一个登记过的进程退出了。
 * @param view - 带退出码与信号的进程登记。
 * @mode emit
 */
'brain.process.exited.v1'(view: BrainProcessView): void
```

Source: [`packages/brain/brain/src/index.ts`](../../packages/brain/brain/src/index.ts)

<a id="brainprocessspawnedv1-events"></a>

### `brain.process.spawned.v1/*` events

<a id="brainprocessspawnedv1--emit"></a>

#### `brain.process.spawned.v1` — emit

会话经启动上下文拉起了一个进程（`brain_process` 新行）。

```ts cordis-catalog
/**
 * 会话经启动上下文拉起了一个进程（`brain_process` 新行）。
 * @param view - 进程登记。
 * @mode emit
 */
'brain.process.spawned.v1'(view: BrainProcessView): void
```

Source: [`packages/brain/brain/src/index.ts`](../../packages/brain/brain/src/index.ts)

<a id="brainproviderunavailablev1-events"></a>

### `brain.provider.unavailable.v1/*` events

<a id="brainproviderunavailablev1--emit"></a>

#### `brain.provider.unavailable.v1` — emit

一次探测发现提供方不可用。

```ts cordis-catalog
/**
 * 一次探测发现提供方不可用。
 * @param record - 提供方与探测结果。
 * @mode emit
 */
'brain.provider.unavailable.v1'(record: BrainProviderUnavailableRecord): void
```

Source: [`packages/brain/brain/src/index.ts`](../../packages/brain/brain/src/index.ts)

<a id="brainsessionclosedv1-events"></a>

### `brain.session.closed.v1/*` events

<a id="brainsessionclosedv1--emit"></a>

#### `brain.session.closed.v1` — emit

一代会话关了（`brain_session` 收尾），带用量汇总。

```ts cordis-catalog
/**
 * 一代会话关了（`brain_session` 收尾），带用量汇总。
 * @param record - 关闭时的会话登记与用量汇总。
 * @mode emit
 */
'brain.session.closed.v1'(record: BrainSessionClosedRecord): void
```

Source: [`packages/brain/brain/src/index.ts`](../../packages/brain/brain/src/index.ts)

<a id="brainsessionopenedv1-events"></a>

### `brain.session.opened.v1/*` events

<a id="brainsessionopenedv1--emit"></a>

#### `brain.session.opened.v1` — emit

一代会话开了（`brain_session` 新行）。

```ts cordis-catalog
/**
 * 一代会话开了（`brain_session` 新行）。
 * @param view - 会话登记。
 * @mode emit
 */
'brain.session.opened.v1'(view: BrainSessionView): void
```

Source: [`packages/brain/brain/src/index.ts`](../../packages/brain/brain/src/index.ts)

<a id="brainusagev1-events"></a>

### `brain.usage.v1/*` events

<a id="brainusagev1--emit"></a>

#### `brain.usage.v1` — emit

一条用量（`brain_usage` 新行）：回合结束、提供方级更新、子 agent 结束。

```ts cordis-catalog
/**
 * 一条用量（`brain_usage` 新行）：回合结束、提供方级更新、子 agent 结束。
 * @param record - 用量记录。
 * @mode emit
 */
'brain.usage.v1'(record: BrainUsageRecord): void
```

Source: [`packages/brain/brain/src/index.ts`](../../packages/brain/brain/src/index.ts)
<!-- END GENERATED cordis-surface -->
