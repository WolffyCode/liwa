# 大脑提供方

[English](brain.md) | 中文

大脑提供方把 agent CLI 接进灵鲸：deepseek agent 进程、Claude Code、Codex 与通用 ACP agent 都是每个会话一个 CLI 进程，灵鲸进程里只有它们的客户端。[`liwa-brain`](../../packages/brain/brain/README.zh.md) 定义每个客户端都要实现的契约，以及在它们上面开会话的 `ctx.brains` 服务。

## 契约

提供方声明一份 `Meta`：送达语义矩阵（下一步、下一回合、取消是否保留队列）、能不能续接、自带压缩与原生工具能不能关、怎么注入人设、传输方式，以及是否观察自己的子 agent。会话用一份 `SessionConfig` 打开，流出 `BrainEvent`：带用量的回合开始与结束、消息与思考的增量、工具调用、权限请求及其答复、提供方级用量、子 agent 与 CLI 退出。提供方声明为 false 的语义恒回 `unsupported`，上层据此在回合边界补上。

权限请求说明自己是什么（工具、计划、模式、提问）；提问带有类型的问题，用有类型的答案答复，子 agent 的请求由主人答复，从不由父 agent 代答。子 agent 是会话级的：它们的事件带子 agent 号与开它的回合，那个回合结束后照常到达；后台子 agent 的结果叫醒 CLI 时，提供方可以自己开一个回合。提供方声明支持时，句柄能换模型、切模式；图片输入以按内容寻址的 blob 传递，由提供方读回。会话配置里其余的——原生工具、压缩、仓库指令、规矩、本事、环境——由提供方落实，做不到的组合在开会话时失败。

## 会话

`ctx.brains.createSession` 按提供方的 `Meta` 核对配置，在成员配置目录里建好提供方的 home，再把提供方会话包进一个句柄。句柄把事件扇出给每个订阅者，跟踪在跑的回合与待答的权限，汇总用量，登记会话拉起的每个进程并报告其退出，登记子 agent 并把没结束的记为 `aborted`，随开会话的上下文一起关闭。提供方没确认的取消让会话拒绝新回合，直到之后某次取消成功。

## 提供方

现有三家提供方。[`deepseek`](../../packages/brain/brain-deepseek/README.zh.md) 每会话运行一个 `liwa --profile deepseek` 进程，说 ACP 加 `_liwa` 扩展。[`acp`](../../packages/brain/brain-acp/README.zh.md) 通过 Paseo 客户端接其他 ACP CLI。[`claude-code`](../../packages/brain/brain-claude-code/README.zh.md) 用官方 SDK 与显式解析的本机 Claude 二进制，各实例有独立凭据引用和生成的成员配置。Claude 只接干活会话，真实 CLI 验收留给 A2。三家都装配在 `web`、`headless`、`brain`，ACP 与 Claude 示例行默认关闭。`deepseek` 进程经下面的 `ctx.acpExtensions` 扩展底座 ACP 服务。

成功回合带用量；失败和中断回合可带已观测支出。第一个终止结果只结算一次。提供方快照和子分项不重复加同一笔消费，缺失的终止用量保持未知。

## 登记

这一版里提供方、进程、会话、子 agent 与用量是内存登记，以下面带版本的事件发出，供以后的经历流落库。[`liwa brain`](../../packages/bundle/brain-cli/README.zh.md) 命令列出、探测并试用提供方，[测试工具](../../packages/test-support/brain-testkit/README.zh.md) 里是每个提供方都要过的契约测试。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

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

<a id="ctxminds--minds"></a>

### `ctx.minds` — `Minds`

仅声明服务所有权；后续块在此装配已迁入的实现。

Source: [`packages/brain/minds/src/index.ts`](../../packages/brain/minds/src/index.ts)

<a id="ctxstructuredgeneration--structuredgeneration"></a>

### `ctx.structuredGeneration` — `StructuredGeneration`

仅声明服务所有权；后续块在此装配已迁入的实现。

Source: [`packages/brain/minds-structured-generation/src/index.ts`](../../packages/brain/minds-structured-generation/src/index.ts)

<a id="ctxtoolport--toolport"></a>

### `ctx.toolport` — `Toolport`

仅声明服务所有权；后续块在此装配已迁入的实现。

Source: [`packages/brain/toolport/src/index.ts`](../../packages/brain/toolport/src/index.ts)

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
