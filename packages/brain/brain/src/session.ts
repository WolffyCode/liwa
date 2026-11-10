/**
 * `ctx.brains` 交给调用方的会话句柄。它包住提供方会话，负责：事件扇出（多个订阅者 + 异步迭代）、
 * 回合与待答权限的跟踪、用量汇总、经启动上下文拉起的进程的归属登记与退出补发、子 agent 的观察登记、
 * 取消失败后的"停止中"、关闭时的进程收尾与未结束子 agent 的补记。
 * @module @liwa/brain/session
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Logger } from '@liwa/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessRuntime, SubprocessSpawnSpec } from '@liwa/subprocess'
import { assertNever } from '@liwa/util-values'
import { BrainProcessId, type BrainSessionId, type ChildId, type ImplId, type PermissionRequestId, type TurnId } from './brand.ts'
import type { BrainBlobReader } from './blobs.ts'
import {
  checkPermissionAnswers,
  type BrainEvent, type BrainEventOf, type BrainMode, type CancelOptions, type DeliverOptions, type DeliverResult, type Meta,
  type ModeChange, type PermissionResponse, type ResumeHandle, type SessionConfig, type TurnInput, type Usage,
} from './contract.ts'
import { BrainError } from './errors.ts'
import type { BrainLaunchContext, BrainProviderSession, BrainSessionHome } from './provider.ts'
import type {
  BrainChildView, BrainCloseReason, BrainProcessView, BrainSessionState, BrainSessionView, BrainUsageRecord,
} from './views.ts'

/** 调用方拿到的会话句柄。 */
export interface BrainSession {
  /** brains 分配的会话号。 */
  readonly id: BrainSessionId
  /** 提供方。 */
  readonly impl: ImplId
  /** 开会话用的配置（brains 调整之后）。 */
  readonly config: SessionConfig
  /** 当前状态。 */
  readonly state: BrainSessionState
  /** 正在跑的回合；空闲时为 `undefined`。 */
  readonly activeTurnId: TurnId | undefined
  /**
   * 开始一个回合。
   * @param input - 回合输入。
   * @returns 回合号。
   */
  startTurn(input: TurnInput): Promise<{ turnId: TurnId }>
  /**
   * 按语义送达输入；`Meta.delivery` 声明为 false 的语义恒回 `unsupported`。
   * @param input - 送达的输入。
   * @param options - 语义、是否叫醒、期望的回合。
   * @returns 送达结果。
   */
  deliver(input: TurnInput, options: DeliverOptions): Promise<DeliverResult>
  /**
   * 停掉正在跑的回合；幂等。提供方拒绝或超时时会话进入"停止中"，拒绝新回合，直到某次取消成功。
   * @param options - 原因与是否保留队列。
   */
  cancel(options: CancelOptions): Promise<void>
  /**
   * 答复一次待答的权限请求。
   * @param requestId - 请求号。
   * @param response - 所选选项。
   */
  respondToPermission(requestId: PermissionRequestId, response: PermissionResponse): Promise<void>
  /**
   * 换后续回合的模型。提供方声明 `Meta.modelSwitch` 才行；生效后 `view().model` 变成新模型，订阅者收到
   * `session.model_changed`。
   * @param model - 提供方的模型名。
   * @throws {BrainError} `unavailable`（不支持换模型或会话已关）、`conflict`（取消失败后的停止中）、`invalid_input`（提供方不认识这个模型）、`timeout`。
   */
  setModel(model: string): Promise<void>
  /**
   * 换后续回合的 thinking 档位。提供方声明 `Meta.thinkingSwitch` 才行；生效后 `view().thinking` 变成新档位，订阅者收到
   * `session.thinking_changed`。
   * @param thinking - 档位号。
   * @throws {BrainError} `unavailable`（不支持或会话已关）、`conflict`（回合进行中或停止中）、`invalid_input`（当前模型没有这一档）、`timeout`。
   */
  setThinking(thinking: string): Promise<void>
  /**
   * 这个会话能切的模式。
   * @returns 模式；提供方不支持模式或这个会话没有可切的模式时为空数组。
   */
  availableModes(): Promise<BrainMode[]>
  /**
   * 当前所选的模式。
   * @returns 模式号；没有模式时为 `null`。
   */
  currentMode(): Promise<string | null>
  /**
   * 切换模式。提供方声明 `Meta.modeSwitch` 才行；`view().modeId` 变成所选模式，订阅者收到 `session.mode_changed`。
   * @param modeId - `availableModes()` 里的一个号。
   * @returns 所选模式与生效时机。
   * @throws {BrainError} `unavailable`（不支持模式或会话已关）、`conflict`（停止中）、`invalid_input`（不认识的模式）、`timeout`。
   */
  setMode(modeId: string): Promise<ModeChange>
  /**
   * 续接句柄；关闭后仍可读。
   * @returns 句柄，或还续不上时的 `null`。
   */
  persistence(): ResumeHandle | null
  /**
   * 能不能回收运行时：本体的底线（无在途回合、无待答权限、无在跑的子 agent）加提供方的否决。
   * @returns 可以回收时为 true。
   */
  canStopRuntime(): Promise<boolean>
  /**
   * 关闭会话：关提供方会话、收尾进程、补记未结束的子 agent。幂等。
   * @param reason - 关闭原因，默认 `closed`。
   */
  close(reason?: BrainCloseReason): Promise<void>
  /**
   * 订阅事件，直到调用返回的函数。
   * @param listener - 按顺序收到每个事件。
   * @returns 取消订阅。
   */
  subscribe(listener: (event: BrainEvent) => void): () => void
  /**
   * 从调用这一刻起的事件流；会话关闭时结束。
   * @param signal - 中止时结束这条流。
   * @returns 可多次打开的异步事件流。
   */
  events(signal?: AbortSignal): AsyncIterable<BrainEvent>
  /**
   * 整个会话到目前为止的用量汇总。
   * @returns 用量（token 与推理次数累加，上下文、额度、余额取最新）。
   */
  usage(): Usage
  /**
   * 本会话的子 agent。
   * @returns 子 agent 登记的副本。
   */
  children(): BrainChildView[]
  /**
   * 待答的权限请求。
   * @returns 请求事件的副本，按到达顺序。
   */
  pendingPermissions(): BrainEventOf<'permission.request'>[]
  /**
   * 会话登记。
   * @returns 登记的副本。
   */
  view(): BrainSessionView
}

/** 会话通往 `ctx.brains` 的回调：发 cordis 事件、推用量、登记与注销。 */
export interface BrainSessionHost {
  /** 本会话的日志器。 */
  readonly logger: Logger
  /** 回合输入 blob 的读取（交给提供方的启动上下文）。 */
  readonly blobs: BrainBlobReader
  /** 时限。 */
  readonly timeouts: BrainTimeouts
  /**
   * 进程已拉起。
   * @param view - 进程登记。
   */
  processSpawned(view: BrainProcessView): void
  /**
   * 进程已退出。
   * @param view - 进程登记。
   */
  processExited(view: BrainProcessView): void
  /**
   * 子 agent 已开始。
   * @param view - 子 agent 登记。
   */
  childOpened(view: BrainChildView): void
  /**
   * 子 agent 已结束。
   * @param view - 子 agent 登记。
   */
  childEnded(view: BrainChildView): void
  /**
   * 一条用量记录。
   * @param record - 用量记录。
   */
  usage(record: BrainUsageRecord): void
  /**
   * 会话已关闭。
   * @param session - 关闭的会话。
   */
  closed(session: ManagedBrainSession): void
}

/** 句柄各操作的时限（毫秒）。 */
export interface BrainTimeouts {
  /** `createSession` / `resumeSession` / `startTurn`。 */
  handshakeMs: number
  /** `deliver` / `cancel` / `respondToPermission` / `canStopRuntime`。 */
  callMs: number
  /** `close` 与关闭后等进程退出。 */
  closeMs: number
}

/** 构造会话句柄需要的事实。 */
export interface ManagedBrainSessionInit {
  id: BrainSessionId
  impl: ImplId
  meta: Meta
  sessionHome: BrainSessionHome
  config: SessionConfig
  homeDir: string
  adjustments: string[]
  resumedFrom?: ResumeHandle
}

/** 记住的已结束回合数，用来挡住晚到的 `startTurn` 结果把已结束的回合重新标成在跑。 */
const ENDED_TURN_MEMORY = 32

/**
 * 在 `ms` 内等 `promise`，超时以 `BrainError(timeout)` 拒绝。
 * @param promise - 要等的操作。
 * @param ms - 时限。
 * @param what - 写进错误里的操作名。
 * @returns 操作的结果。
 */
export async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new BrainError('timeout', 'brain.timeout', `${what} did not settle within ${String(ms)}ms`))
    }, ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把一次用量加进汇总：token、缓存、推理次数、自估费用累加；上下文、额度窗口、余额取最新。
 * @param total - 汇总（原地修改）。
 * @param usage - 新的一条。
 */
export function accumulateUsage(total: Usage, usage: Partial<Usage>): void {
  if (usage.tokens !== undefined) {
    const previous = total.tokens
    total.tokens = {
      input: (previous?.input ?? 0) + usage.tokens.input,
      output: (previous?.output ?? 0) + usage.tokens.output,
      ...sumOptional('cacheRead', previous?.cacheRead, usage.tokens.cacheRead),
      ...sumOptional('cacheWrite', previous?.cacheWrite, usage.tokens.cacheWrite),
    }
  }
  if (usage.inferences !== undefined) total.inferences = (total.inferences ?? 0) + usage.inferences
  if (usage.providerReportedCostUsd !== undefined) {
    total.providerReportedCostUsd = (total.providerReportedCostUsd ?? 0) + usage.providerReportedCostUsd
  }
  if (usage.context !== undefined) total.context = { ...usage.context }
  if (usage.quotaWindows !== undefined) total.quotaWindows = usage.quotaWindows.map(window => ({ ...window }))
  if (usage.balances !== undefined) total.balances = usage.balances.map(balance => ({ ...balance }))
}

/**
 * 取出用量里"取最新"的那几项。
 * @param usage - 提供方级的用量更新。
 * @returns 只含上下文、额度窗口与余额的用量。
 */
function latestOnly(usage: Partial<Usage>): Partial<Usage> {
  return {
    ...(usage.context === undefined ? {} : { context: usage.context }),
    ...(usage.quotaWindows === undefined ? {} : { quotaWindows: usage.quotaWindows }),
    ...(usage.balances === undefined ? {} : { balances: usage.balances }),
  }
}

function sumOptional<K extends string>(key: K, previous: number | undefined, next: number | undefined): Partial<Record<K, number>> {
  if (previous === undefined && next === undefined) return {}
  return { [key]: (previous ?? 0) + (next ?? 0) } as Partial<Record<K, number>>
}

/** 一条异步事件流的缓冲：会话推入，迭代器拉取。 */
class EventQueue implements AsyncIterator<BrainEvent> {
  private readonly buffer: BrainEvent[] = []
  private waiting: ((result: IteratorResult<BrainEvent>) => void) | undefined
  private ended = false

  constructor(private readonly detach: (queue: EventQueue) => void) {}

  push(event: BrainEvent): void {
    if (this.ended) return
    const waiting = this.waiting
    if (waiting !== undefined) {
      this.waiting = undefined
      waiting({ done: false, value: event })
    } else {
      this.buffer.push(event)
    }
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    this.detach(this)
    const waiting = this.waiting
    this.waiting = undefined
    waiting?.({ done: true, value: undefined })
  }

  next(): Promise<IteratorResult<BrainEvent>> {
    const event = this.buffer.shift()
    if (event !== undefined) return Promise.resolve({ done: false, value: event })
    if (this.ended) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => { this.waiting = resolve })
  }

  return(): Promise<IteratorResult<BrainEvent>> {
    this.buffer.length = 0
    this.end()
    return Promise.resolve({ done: true, value: undefined })
  }
}

/** 一个经启动上下文拉起、由本会话登记的进程。 */
interface OwnedProcess {
  view: BrainProcessView
  /** 拉起返回前为 `undefined`。 */
  handle: SubprocessHandle | undefined
  /** `handle.done` 结算后完成（含退出补发）。 */
  settled: Promise<void>
}

/** 会话句柄的实现。 */
export class ManagedBrainSession implements BrainSession {
  /** brains 分配的会话号。 */
  readonly id: BrainSessionId
  /** 提供方。 */
  readonly impl: ImplId
  /** 开会话用的配置。 */
  readonly config: SessionConfig
  private readonly meta: Meta
  private readonly sessionHome: BrainSessionHome
  private readonly host: BrainSessionHost
  private provider: BrainProviderSession | undefined
  private unsubscribeProvider: (() => void) | undefined
  private currentState: BrainSessionState = 'open'
  private activeTurn: TurnId | undefined
  private starting = false
  private readonly endedTurns: TurnId[] = []
  private readonly listeners = new Set<(event: BrainEvent) => void>()
  private readonly queues = new Set<EventQueue>()
  private readonly pending = new Map<PermissionRequestId, BrainEventOf<'permission.request'>>()
  private readonly childViews = new Map<ChildId, BrainChildView>()
  private readonly processes = new Map<BrainProcessId, OwnedProcess>()
  private readonly settledUsageTurns = new Set<TurnId>()
  private readonly totals: Usage = {}
  private readonly record: BrainSessionView
  private closing: Promise<void> | undefined
  private releaseOwner: (() => unknown) | undefined

  /**
   * @param host - 通往 `ctx.brains` 的回调。
   * @param init - 会话号、提供方、能力、配置、home 与调整记录。
   */
  constructor(host: BrainSessionHost, init: ManagedBrainSessionInit) {
    this.host = host
    this.id = init.id
    this.impl = init.impl
    this.meta = init.meta
    this.sessionHome = init.sessionHome
    this.config = init.config
    this.record = {
      sessionId: init.id,
      impl: init.impl,
      member: init.config.member,
      mindKind: init.config.mindKind,
      owner: init.config.owner,
      ...(init.config.model === undefined ? {} : { model: init.config.model }),
      configDir: init.config.configDir,
      homeDir: init.homeDir,
      state: 'open',
      openedAt: new Date().toISOString(),
      ...(init.config.modeId === undefined ? {} : { modeId: init.config.modeId }),
      ...(init.config.thinking === undefined ? {} : { thinking: init.config.thinking }),
      ...(init.resumedFrom === undefined ? {} : { resumedFrom: init.resumedFrom }),
      adjustments: [...init.adjustments],
    }
  }

  /** 当前状态。 */
  get state(): BrainSessionState {
    return this.currentState
  }

  /** 正在跑的回合。 */
  get activeTurnId(): TurnId | undefined {
    return this.activeTurn
  }

  /**
   * 给提供方的启动上下文：拉起前登记归属，退出时补发 `process.exited`。
   * @param subprocess - 本体的 subprocess 服务。
   * @returns 启动上下文。
   */
  launchContext(subprocess: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>): BrainLaunchContext {
    return {
      sessionId: this.id,
      homeDir: this.record.homeDir,
      logger: this.host.logger,
      readBlob: ref => this.host.blobs.readBlob(ref),
      resolveExecutable: (command, env, signal) => subprocess.resolveExecutable(command, env, signal),
      spawn: spec => this.spawnOwned(subprocess, spec),
    }
  }

  /**
   * 接上提供方会话并开始转发它的事件。
   * @param provider - 提供方会话。
   */
  attach(provider: BrainProviderSession): void {
    this.provider = provider
    this.unsubscribeProvider = provider.subscribe((event) => { this.onProviderEvent(event) })
  }

  /**
   * 记下归属方的释放函数；会话自己关闭时调用它，撤掉归属方上的 effect。
   * @param release - 归属方 effect 的释放函数。
   */
  bindOwner(release: () => unknown): void {
    this.releaseOwner = release
  }

  /**
   * 提供方会话没开成时收尾：终止已拉起的进程。
   * @returns 进程都结算后完成。
   */
  async abandon(): Promise<void> {
    this.currentState = 'closed'
    await this.settleProcesses()
  }

  private spawnOwned(subprocess: Pick<SubprocessRuntime, 'spawn'>, spec: SubprocessSpawnSpec): SubprocessHandle {
    if (this.currentState === 'closing' || this.currentState === 'closed') {
      throw new BrainError('unavailable', 'brain.session_closed', `brain session ${this.id} is closed; it cannot start processes`)
    }
    const processId = BrainProcessId(`brain-process-${randomUUID()}`)
    const command = spec.argv[0] ?? ''
    const view: BrainProcessView = {
      processId,
      sessionId: this.id,
      impl: this.impl,
      command,
      argvHash: createHash('sha256').update(spec.argv.join('\0')).digest('hex'),
      startedAt: new Date().toISOString(),
      state: 'live',
    }
    // 先登记再拉起：拉起同步失败时撤销登记。
    const owned: OwnedProcess = { view, handle: undefined, settled: Promise.resolve() }
    this.processes.set(processId, owned)
    let handle: SubprocessHandle
    try {
      handle = subprocess.spawn(spec)
    } catch (error) {
      this.processes.delete(processId)
      throw error
    }
    owned.handle = handle
    this.host.processSpawned({ ...view })
    owned.settled = handle.done.then(
      (outcome) => { this.onProcessExit(owned, outcome) },
      (error: unknown) => {
        this.host.logger.warn(`brain session ${this.id}: process ${command} failed: ${String(error)}`)
        this.onProcessExit(owned, { exitCode: null, signal: null })
      },
    )
    return handle
  }

  private onProcessExit(owned: OwnedProcess, outcome: SubprocessOutcome): void {
    owned.view.state = 'exited'
    owned.view.exitCode = outcome.exitCode
    owned.view.signal = outcome.signal
    owned.view.exitedAt = new Date().toISOString()
    this.host.processExited({ ...owned.view })
    if (this.currentState === 'closed') return
    this.fanOut({ kind: 'process.exited', code: outcome.exitCode, signal: outcome.signal })
  }

  private onProviderEvent(event: BrainEvent): void {
    if (this.currentState === 'closed') return
    switch (event.kind) {
      case 'turn.started':
        this.activeTurn = event.turnId
        break
      case 'turn.completed':
      case 'turn.interrupted':
      case 'turn.failed':
        this.endTurn(event.turnId)
        this.settleTurnUsage(event.turnId, event.usage)
        break
      case 'session.exited':
        this.activeTurn = undefined
        break
      case 'permission.request':
        this.pending.set(event.requestId, event)
        break
      case 'permission.resolved':
        this.pending.delete(event.requestId)
        break
      case 'usage.update':
        // 提供方级更新只带最新的上下文、额度与余额；token 与推理次数只在回合结束时累加。
        accumulateUsage(this.totals, latestOnly(event.usage))
        this.host.usage(this.usageRecord('update', event.usage, event.turnId))
        break
      case 'child.started':
        this.openChild(event)
        break
      case 'child.ended':
        this.endChild(event)
        break
      case 'session.model_changed':
        // setModel 成功时已经报过同一个模型的就不重复报。
        if (this.record.model === event.model) return
        this.record.model = event.model
        break
      case 'session.thinking_changed':
        if (this.record.thinking === event.thinking) return
        this.record.thinking = event.thinking
        break
      case 'session.mode_changed':
        if (event.modeId === (this.record.modeId ?? null) && event.availableModes === undefined) return
        if (event.modeId === null) delete this.record.modeId
        else this.record.modeId = event.modeId
        break
      case 'process.exited':
        // 进程退出只由 brains 依据它登记的拉起补发；提供方发的丢弃，保持唯一来源。
        this.host.logger.warn(`brain session ${this.id}: provider ${this.impl} emitted process.exited; brains reports process exits itself`)
        return
      case 'session.compacted':
      case 'item.message':
      case 'item.reasoning':
      case 'item.tool_call.started':
      case 'item.tool_call.completed':
        break
      default:
        assertNever(event)
    }
    this.fanOut(event)
    if (event.kind === 'session.exited') void this.close('process_exit')
  }

  /** G1：终止结果只结算一次；usage.update 是快照，子分项不再计入总额。 */
  private settleTurnUsage(turnId: TurnId, usage: Usage | undefined): void {
    if (this.settledUsageTurns.has(turnId)) return
    this.settledUsageTurns.add(turnId)
    if (usage === undefined) return
    accumulateUsage(this.totals, usage)
    this.host.usage(this.usageRecord('turn', usage, turnId))
  }

  private endTurn(turnId: TurnId): void {
    if (this.activeTurn === turnId) this.activeTurn = undefined
    this.endedTurns.push(turnId)
    if (this.endedTurns.length > ENDED_TURN_MEMORY) this.endedTurns.shift()
    // 回合结束只撤父会话自己在这一回合的请求；子 agent 的请求跨回合等主人答复。
    for (const [requestId, request] of this.pending) {
      if (request.turnId === turnId && request.childId === undefined) this.pending.delete(requestId)
    }
  }

  private openChild(event: BrainEventOf<'child.started'>): void {
    const view: BrainChildView = {
      childId: event.childId,
      sessionId: this.id,
      kind: event.childKind,
      provider: event.provider,
      label: event.label,
      ...(event.parentChildId === undefined ? {} : { parentChildId: event.parentChildId }),
      state: 'running',
      openedAt: new Date().toISOString(),
    }
    this.childViews.set(event.childId, view)
    this.host.childOpened({ ...view })
  }

  private endChild(event: BrainEventOf<'child.ended'>): void {
    const view = this.childViews.get(event.childId)
    if (view === undefined || view.state === 'ended') {
      this.host.logger.warn(`brain session ${this.id}: child.ended for undeclared or ended child ${event.childId}`)
      return
    }
    view.state = 'ended'
    view.stopReason = event.stopReason
    view.usage = event.usage
    view.endedAt = new Date().toISOString()
    this.host.childEnded({ ...view })
    if (Object.keys(event.usage).length > 0) {
      this.host.usage({ ...this.usageRecord('child', event.usage), childId: event.childId })
    }
  }

  private usageRecord(source: BrainUsageRecord['source'], usage: Partial<Usage>, turnId?: TurnId): BrainUsageRecord {
    return {
      sessionId: this.id,
      impl: this.impl,
      member: this.config.member,
      owner: this.config.owner,
      ...(turnId === undefined ? {} : { turnId }),
      source,
      usage,
      at: new Date().toISOString(),
    }
  }

  private fanOut(event: BrainEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        // 一个订阅者出错不能饿死其余订阅者；记下后继续。
        this.host.logger.warn(`brain session ${this.id}: an event listener failed: ${String(error)}`)
      }
    }
    for (const queue of this.queues) queue.push(event)
  }

  private requireProvider(operation: string): BrainProviderSession {
    if (this.provider === undefined || this.currentState === 'closing' || this.currentState === 'closed') {
      throw new BrainError('unavailable', 'brain.session_closed', `brain session ${this.id} is closed; ${operation} is unavailable`)
    }
    return this.provider
  }

  /**
   * 现在没有在跑的回合。
   * @returns 空闲时为 true。
   */
  private idle(): boolean {
    return this.activeTurn === undefined
  }

  /** @inheritdoc */
  async startTurn(input: TurnInput): Promise<{ turnId: TurnId }> {
    const provider = this.requireProvider('startTurn')
    if (this.currentState === 'stopping') {
      throw new BrainError('conflict', 'brain.session_stopping', `brain session ${this.id} is still stopping after a failed cancel; cancel again or close it`)
    }
    if (this.activeTurn !== undefined || this.starting) {
      throw new BrainError('conflict', 'brain.turn_active', `brain session ${this.id} already runs a turn; deliver the input or cancel first`)
    }
    this.starting = true
    try {
      const started = await within(provider.startTurn(input), this.host.timeouts.handshakeMs, `${this.impl} startTurn`)
      // 等待期间事件可能已经开始并结束了这个回合，所以重新读当前回合，不沿用 await 之前的判断。
      if (!this.endedTurns.includes(started.turnId) && this.idle()) this.activeTurn = started.turnId
      return started
    } finally {
      this.starting = false
    }
  }

  /** @inheritdoc */
  async deliver(input: TurnInput, options: DeliverOptions): Promise<DeliverResult> {
    const supported = options.semantics === 'next_step' ? this.meta.delivery.nextStep : this.meta.delivery.nextTurn
    if (!supported) return 'unsupported'
    if (this.provider === undefined || this.currentState !== 'open') return 'unavailable'
    return within(this.provider.deliver(input, options), this.host.timeouts.callMs, `${this.impl} deliver`)
  }

  /** @inheritdoc */
  async cancel(options: CancelOptions): Promise<void> {
    if (this.provider === undefined || this.currentState === 'closing' || this.currentState === 'closed') return
    const turn = this.activeTurn
    try {
      await within(this.provider.cancel(options), this.host.timeouts.callMs, `${this.impl} cancel`)
    } catch (error) {
      this.currentState = 'stopping'
      this.record.state = 'stopping'
      throw new BrainError('internal', 'brain.cancel_failed', `brain session ${this.id}: ${this.impl} did not confirm the cancel; the session refuses new turns until a cancel succeeds`, { cause: error })
    }
    if (this.currentState === 'stopping') {
      this.currentState = 'open'
      this.record.state = 'open'
    }
    // 提供方确认取消后，此前的回合不会再跑；没等到终止事件也按已结束对待，晚到的终止事件照常转发。
    if (turn !== undefined && this.activeTurn === turn) this.endTurn(turn)
  }

  /** @inheritdoc */
  async respondToPermission(requestId: PermissionRequestId, response: PermissionResponse): Promise<void> {
    const provider = this.requireProvider('respondToPermission')
    const request = this.pending.get(requestId)
    if (request === undefined) {
      throw new BrainError('not_found', 'brain.permission_unknown', `brain session ${this.id} has no pending permission request ${requestId}`)
    }
    const option = request.options.find(candidate => candidate.id === response.optionId)
    if (request.questions === undefined) {
      if (response.answers !== undefined) {
        throw new BrainError('invalid_input', 'brain.permission_answers_unexpected', `permission request ${requestId} is not a question; answer it without answers`)
      }
    } else if (option?.effect.startsWith('allow') === true) {
      // 允许一个问答请求就是交出答案（Paseo：问题卡的允许必带 updatedInput.answers，否则请求仍挂着）。
      const problem = response.answers === undefined ? 'an allowing answer to a question needs answers' : checkPermissionAnswers(request.questions, response.answers)
      if (problem !== undefined) {
        throw new BrainError('invalid_input', 'brain.permission_answers_invalid', `permission request ${requestId}: ${problem}; the request stays pending`)
      }
    } else if (response.answers !== undefined) {
      throw new BrainError('invalid_input', 'brain.permission_answers_unexpected', `permission request ${requestId}: answers go with an allowing option, not ${option?.effect ?? 'an unknown option'}`)
    }
    await within(provider.respondToPermission(requestId, response), this.host.timeouts.callMs, `${this.impl} respondToPermission`)
    this.pending.delete(requestId)
  }

  /**
   * 换模型、切模式之前的检查：提供方声明并实现了这项操作、会话开着且不在停止中。
   * @param operation - 操作名（写进错误）。
   * @param declared - 提供方是否在 `Meta` 里声明了这项能力。
   * @param pick - 从提供方会话取出这项操作（没实现时为 `undefined`）。
   * @param code - 不支持时的错误代码。
   * @returns 绑定到提供方会话的操作。
   */
  private requireSwitch<A extends unknown[], R>(
    operation: string,
    declared: boolean,
    pick: (provider: BrainProviderSession) => ((...args: A) => Promise<R>) | undefined,
    code: string,
  ): (...args: A) => Promise<R> {
    const provider = this.requireProvider(operation)
    const method = declared ? pick(provider) : undefined
    if (method === undefined) {
      throw new BrainError('unavailable', code, `brain provider ${this.impl} does not support ${operation}`)
    }
    if (this.currentState === 'stopping') {
      throw new BrainError('conflict', 'brain.session_stopping', `brain session ${this.id} is still stopping after a failed cancel; cancel again or close it before ${operation}`)
    }
    return method
  }

  /** @inheritdoc */
  async setModel(model: string): Promise<void> {
    const setModel = this.requireSwitch('setModel', this.meta.modelSwitch, provider => provider.setModel?.bind(provider), 'brain.model_switch_unsupported')
    if (model === '') throw new BrainError('invalid_input', 'brain.model_empty', 'setModel needs a model name')
    await within(setModel(model), this.host.timeouts.callMs, `${this.impl} setModel`)
    if (this.currentState === 'closed' || this.record.model === model) return
    // 提供方没有先报这次变化时由句柄补报，保证换成功之后状态可观察。
    this.record.model = model
    this.fanOut({ kind: 'session.model_changed', model })
  }

  /** @inheritdoc */
  async setThinking(thinking: string): Promise<void> {
    const setThinking = this.requireSwitch('setThinking', this.meta.thinkingSwitch, provider => provider.setThinking?.bind(provider), 'brain.thinking_switch_unsupported')
    if (thinking === '') throw new BrainError('invalid_input', 'brain.thinking_empty', 'setThinking needs a thinking option id')
    await within(setThinking(thinking), this.host.timeouts.callMs, `${this.impl} setThinking`)
    if (this.currentState === 'closed' || this.record.thinking === thinking) return
    this.record.thinking = thinking
    this.fanOut({ kind: 'session.thinking_changed', thinking })
  }

  /** @inheritdoc */
  async availableModes(): Promise<BrainMode[]> {
    const provider = this.requireProvider('availableModes')
    if (!this.meta.modeSwitch || provider.availableModes === undefined) return []
    return within(provider.availableModes(), this.host.timeouts.callMs, `${this.impl} availableModes`)
  }

  /** @inheritdoc */
  async currentMode(): Promise<string | null> {
    const provider = this.requireProvider('currentMode')
    if (!this.meta.modeSwitch || provider.currentMode === undefined) return null
    return within(provider.currentMode(), this.host.timeouts.callMs, `${this.impl} currentMode`)
  }

  /** @inheritdoc */
  async setMode(modeId: string): Promise<ModeChange> {
    const setMode = this.requireSwitch('setMode', this.meta.modeSwitch, provider => provider.setMode?.bind(provider), 'brain.mode_switch_unsupported')
    const change = await within(setMode(modeId), this.host.timeouts.callMs, `${this.impl} setMode`)
    if (this.currentState === 'closed' || this.record.modeId === change.modeId) return change
    this.record.modeId = change.modeId
    this.fanOut({ kind: 'session.mode_changed', modeId: change.modeId })
    return change
  }

  /** @inheritdoc */
  persistence(): ResumeHandle | null {
    const handle = this.provider?.persistence() ?? null
    if (handle === null || this.sessionHome !== 'per-session') return handle
    // per-session 的提供方在同一目录续接：句柄带上这一代的 home。
    return { ...handle, home: this.record.homeDir }
  }

  /** @inheritdoc */
  async canStopRuntime(): Promise<boolean> {
    if (this.provider === undefined || this.currentState !== 'open') return false
    if (this.activeTurn !== undefined || this.starting || this.pending.size > 0) return false
    for (const child of this.childViews.values()) if (child.state === 'running') return false
    if (this.provider.canStopRuntime === undefined) return true
    try {
      return await within(this.provider.canStopRuntime(), this.host.timeouts.callMs, `${this.impl} canStopRuntime`)
    } catch (error) {
      // 否决检查出错或超时按"不能回收"处理（Paseo 同样保留运行时）。
      this.host.logger.warn(`brain session ${this.id}: canStopRuntime failed: ${String(error)}`)
      return false
    }
  }

  /** @inheritdoc */
  close(reason: BrainCloseReason = 'closed'): Promise<void> {
    this.closing ??= this.shutdown(reason)
    return this.closing
  }

  private async shutdown(reason: BrainCloseReason): Promise<void> {
    this.currentState = 'closing'
    this.record.state = 'closing'
    if (this.provider !== undefined) {
      try {
        await within(this.provider.close(), this.host.timeouts.closeMs, `${this.impl} close`)
      } catch (error) {
        this.host.logger.warn(`brain session ${this.id}: provider close failed, terminating its processes: ${String(error)}`)
      }
    }
    this.unsubscribeProvider?.()
    await this.settleProcesses()
    for (const child of this.childViews.values()) {
      if (child.state !== 'running') continue
      const ended: BrainEventOf<'child.ended'> = { kind: 'child.ended', childId: child.childId, stopReason: 'aborted', usage: {} }
      this.endChild(ended)
      this.fanOut(ended)
    }
    this.pending.clear()
    this.activeTurn = undefined
    this.currentState = 'closed'
    this.record.state = 'closed'
    this.record.closedAt = new Date().toISOString()
    this.record.closeReason = reason
    this.host.closed(this)
    for (const queue of [...this.queues]) queue.end()
    this.listeners.clear()
    const release = this.releaseOwner
    this.releaseOwner = undefined
    void release?.()
  }

  private async settleProcesses(): Promise<void> {
    const live = [...this.processes.values()].filter(owned => owned.view.state === 'live')
    for (const owned of live) owned.handle?.terminate()
    try {
      await within(Promise.all(live.map(owned => owned.settled)), this.host.timeouts.closeMs, `${this.impl} process exit`)
    } catch (error) {
      this.host.logger.warn(`brain session ${this.id}: processes did not exit in time: ${String(error)}`)
    }
  }

  /** @inheritdoc */
  subscribe(listener: (event: BrainEvent) => void): () => void {
    if (this.currentState === 'closed') return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** @inheritdoc */
  events(signal?: AbortSignal): AsyncIterable<BrainEvent> {
    return {
      [Symbol.asyncIterator]: () => {
        const queue = new EventQueue((detached) => { this.queues.delete(detached) })
        if (this.currentState === 'closed' || signal?.aborted === true) {
          queue.end()
          return queue
        }
        this.queues.add(queue)
        signal?.addEventListener('abort', () => { queue.end() }, { once: true })
        return queue
      },
    }
  }

  /** @inheritdoc */
  usage(): Usage {
    const copy: Usage = {}
    accumulateUsage(copy, this.totals)
    return copy
  }

  /** @inheritdoc */
  children(): BrainChildView[] {
    return [...this.childViews.values()].map(child => ({ ...child }))
  }

  /** @inheritdoc */
  pendingPermissions(): BrainEventOf<'permission.request'>[] {
    return [...this.pending.values()].map(request => ({ ...request }))
  }

  /** @inheritdoc */
  view(): BrainSessionView {
    return { ...this.record, adjustments: [...this.record.adjustments] }
  }

  /**
   * 进程登记（只读副本）。
   * @returns 本会话拉起过的进程。
   */
  processViews(): BrainProcessView[] {
    return [...this.processes.values()].map(owned => ({ ...owned.view }))
  }
}
