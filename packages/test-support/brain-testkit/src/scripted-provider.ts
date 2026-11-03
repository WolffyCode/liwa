/**
 * 回放脚本驱动的假提供方：一份脚本描述一个回合里 CLI 做了什么（流式文本、思考、工具调用、权限请求、
 * 子 agent、用量、失败、在两回合之间退出），假提供方按 `brain.provider` 契约把它翻成事件。每个会话
 * 经启动上下文拉起一个空转的 node 子进程，代替真实 CLI 进程，使进程归属、退出与 `session.exited`
 * 都走真实路径。它只用于测试与显式的测试 profile，不进产品默认组合。
 * @module @liwa/brain-testkit/scripted-provider
 */

import { setTimeout as sleep } from 'node:timers/promises'
import {
  BrainError, CallId, ChildId, ItemId, PermissionRequestId, TurnId,
  type BrainEvent, type BrainLaunchContext, type BrainProbeContext, type BrainProbeResult, type BrainProvider,
  type BrainProviderSession, type CancelOptions, type ChildStopReason, type DeliverOptions, type DeliverResult,
  type FailureCategory, type ImplId, type Meta, type PermissionEffect, type PermissionOption, type PermissionResponse,
  type ResumeHandle, type SessionConfig, type ToolCallDetail, type TurnInput, type Usage,
} from '@liwa/brain'
import type { SubprocessHandle } from '@liwa/subprocess'
import { assertNever, type JsonValue } from '@liwa/util-values'

/** 脚本里的一步。 */
export type ScriptStep =
  /** 一条流式回复，切成 `chunks` 段增量发出。 */
  | { kind: 'text'; text: string; chunks?: number }
  /** 一段思考摘要。 */
  | { kind: 'reasoning'; text: string }
  /** 一次工具调用及其结果。 */
  | { kind: 'tool'; tool: string; args: JsonValue; result: JsonValue; ok?: boolean; native?: boolean; detail?: ToolCallDetail }
  /** 调工具前请求权限：允许后跑这次调用，拒绝时调用以失败收场，`cancel` 中断回合。 */
  | { kind: 'permission'; tool: string; args: JsonValue; result: JsonValue; detail?: ToolCallDetail }
  /** 一个原生子 agent：开始、跑自己的几步、结束。 */
  | { kind: 'child'; label: string; steps: ScriptStep[]; stopReason?: ChildStopReason; usage?: Usage }
  /** 提供方级用量更新（额度窗口、余额、上下文）。 */
  | { kind: 'usage'; usage: Partial<Usage> }
  /** 停顿 `ms` 毫秒（取消可打断）。 */
  | { kind: 'wait'; ms: number }
  /** 一直停在这里，直到被取消；期间到达的插话（`next_step`）在下一步可见。 */
  | { kind: 'hold' }
  /** 回合失败。 */
  | { kind: 'fail'; category: FailureCategory; message: string }
  /** 回合正常结束后，CLI 进程退出（两回合之间）。 */
  | { kind: 'exit' }

/** 一个回合的脚本。 */
export interface ScriptedTurn {
  /** 依次执行的步骤。 */
  steps: ScriptStep[]
  /** `turn.completed` 带的用量；省略时按输入与输出的字数估一个 token 数。 */
  usage?: Usage
}

/**
 * 按提示词选脚本。
 * @param prompt - 本回合输入的全部文本。
 * @param turn - 这个会话里的第几回合（从 1 起，续接后接着数）。
 * @returns 本回合的脚本。
 */
export type ScriptSelector = (prompt: string, turn: number) => ScriptedTurn

/** 假提供方的选项。 */
export interface ScriptedProviderOptions {
  /** 实现名，默认 `fake`。 */
  impl?: ImplId
  /** 覆盖默认能力声明的部分项（整项替换）。 */
  meta?: Partial<Meta>
  /** 选脚本；默认 {@link demoScript}。 */
  script?: ScriptSelector
  /** 每个会话是否拉起一个空转 node 子进程代替 CLI；默认 true。 */
  process?: boolean
  /** 流式步骤之间的停顿（毫秒），默认 0（只让出事件循环）。 */
  stepDelayMs?: number
}

/** 假提供方的默认能力声明：送达语义、续接、子 agent 观察都支持。 */
export const SCRIPTED_META: Meta = {
  streaming: true,
  resume: true,
  nativeTools: false,
  permissionHook: true,
  rollback: false,
  modelSwitch: true,
  delivery: { nextStep: true, nextTurn: true, cancelKeepsQueue: true },
  compaction: 'none',
  budget: { inferences: false, toolCalls: false, concludeOn: false },
  usage: 'tokens',
  personaInjection: { instance: 'system_prompt' },
  runtime: 'subprocess',
  transport: 'scripted',
  kernelTools: ['mcp-http'],
  binary: { command: 'node' },
  children: { native: 'observe', crossCli: true },
}

/** 权限请求给出的四个选项（与 00-contracts §5.1 第一版主人可见的选项一致）。 */
export const SCRIPTED_PERMISSION_OPTIONS: readonly PermissionOption[] = [
  { id: 'allow-once', label: 'Allow once', effect: 'allow_once' },
  { id: 'allow-session', label: 'Allow for this session', effect: 'allow_session' },
  { id: 'deny-once', label: 'Deny', effect: 'deny_once' },
  { id: 'cancel', label: 'Deny and stop', effect: 'cancel' },
]

/** 演示脚本按提示词里的关键词挑的场景。 */
export type DemoScenario = 'reply' | 'tool' | 'permission' | 'child' | 'long' | 'exit' | 'fail'

/**
 * 演示与契约测试共用的脚本：提示词里出现场景名（`permission`、`child` 等）就跑那个场景，否则回显。
 * @param prompt - 本回合输入的全部文本。
 * @param turn - 第几回合。
 * @returns 本回合的脚本。
 */
export function demoScript(prompt: string, turn: number): ScriptedTurn {
  const scenario = (['permission', 'child', 'long', 'exit', 'fail', 'tool'] as const).find(name => prompt.includes(name)) ?? 'reply'
  const reply: ScriptStep = { kind: 'text', text: `Turn ${String(turn)}: you said "${prompt.trim()}".`, chunks: 3 }
  switch (scenario) {
    case 'reply':
      return { steps: [{ kind: 'reasoning', text: 'Read the prompt and answer it.' }, reply] }
    case 'tool':
      return { steps: [{ kind: 'tool', tool: 'read_file', args: { path: 'README.md' }, result: '# hello', detail: { type: 'read', path: 'README.md' } }, reply] }
    case 'permission':
      return {
        steps: [
          { kind: 'text', text: 'I need to run a command first.' },
          { kind: 'permission', tool: 'shell', args: { command: 'ls' }, result: 'README.md', detail: { type: 'shell', command: 'ls' } },
          reply,
        ],
      }
    case 'child':
      return {
        steps: [
          { kind: 'child', label: 'explore', steps: [{ kind: 'text', text: 'Child looked around.' }], usage: { tokens: { input: 5, output: 3 } } },
          reply,
        ],
      }
    case 'long':
      return { steps: [{ kind: 'text', text: 'Working…' }, { kind: 'hold' }, reply] }
    case 'exit':
      return { steps: [reply, { kind: 'exit' }] }
    case 'fail':
      return { steps: [{ kind: 'fail', category: 'retryable', message: 'scripted failure' }] }
    default:
      return assertNever(scenario)
  }
}

/**
 * 回合输入的全部文本。
 * @param input - 回合输入。
 * @returns 文本块与具名块的文本，按顺序以换行连接。
 */
export function inputText(input: TurnInput): string {
  return input.blocks.map(block => (block.kind === 'image' ? '' : block.text)).filter(text => text !== '').join('\n')
}

/** 跨会话保存的转录，供续接。 */
interface ScriptedTranscript {
  turns: number
  createdAt: string
}

/** 回放脚本的假提供方。 */
export class ScriptedBrainProvider implements BrainProvider {
  /** 实现名。 */
  readonly impl: ImplId
  /** 能力声明。 */
  readonly meta: Meta
  private readonly script: ScriptSelector
  private readonly spawnProcess: boolean
  private readonly stepDelayMs: number
  private readonly transcripts = new Map<string, ScriptedTranscript>()
  private sessions = 0

  /**
   * @param options - 实现名、能力覆盖、脚本、是否拉起子进程、步骤间停顿。
   */
  constructor(options: ScriptedProviderOptions = {}) {
    this.impl = options.impl ?? ('fake' as ImplId)
    this.meta = { ...SCRIPTED_META, ...options.meta }
    this.script = options.script ?? demoScript
    this.spawnProcess = options.process ?? true
    this.stepDelayMs = options.stepDelayMs ?? 0
  }

  /** @inheritdoc */
  async probe(context: BrainProbeContext): Promise<BrainProbeResult> {
    try {
      await context.resolveExecutable(process.execPath, undefined, context.signal)
      return { available: true, version: `scripted (node ${process.version})`, problems: [] }
    } catch (error) {
      return { available: false, problems: [`node is not executable: ${String(error)}`] }
    }
  }

  /** @inheritdoc */
  createSession(config: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession> {
    return settled(() => {
      this.sessions += 1
      const nativeId = `scripted-${String(this.sessions)}-${launch.sessionId}`
      const transcript: ScriptedTranscript = { turns: 0, createdAt: new Date().toISOString() }
      return this.start(nativeId, transcript, config, launch)
    })
  }

  /** @inheritdoc */
  resumeSession(handle: ResumeHandle, config: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession> {
    return settled(() => {
      if (!this.meta.resume) {
        throw new BrainError('unavailable', 'brain.resume_unsupported', `scripted provider ${this.impl} declares no resume`)
      }
      const transcript = this.transcripts.get(handle.sessionRef)
      if (transcript === undefined) {
        throw new BrainError('not_found', 'brain.resume_unknown', `scripted provider ${this.impl} has no session ${handle.sessionRef}`)
      }
      return this.start(handle.sessionRef, transcript, config, launch)
    })
  }

  private start(nativeId: string, transcript: ScriptedTranscript, config: SessionConfig, launch: BrainLaunchContext): ScriptedSession {
    const child = this.spawnProcess
      ? launch.spawn({
        argv: [process.execPath, '-e', 'setInterval(() => {}, 1 << 30)'],
        cwd: config.cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
        graceMs: 1_000,
      })
      : undefined
    return new ScriptedSession({
      impl: this.impl,
      meta: this.meta,
      nativeId,
      transcript,
      persist: () => { this.transcripts.set(nativeId, transcript) },
      script: this.script,
      child,
      stepDelayMs: this.stepDelayMs,
      launch,
    })
  }
}

/** 正在跑的回合。 */
interface RunningTurn {
  turnId: TurnId
  abort: AbortController
  /** 已收下、还没在某一步边界露面的插话。 */
  steers: string[]
  /** 本回合开着的子 agent。 */
  children: Set<ChildId>
  /** 唤醒 `hold` 的回调（插话到达或取消）。 */
  wake?: (() => void) | undefined
}

/** 一次待答的权限请求。 */
interface PendingPermission {
  turnId: TurnId
  resolve: (effect: PermissionEffect, optionId: string) => void
}

/** 构造 {@link ScriptedSession} 的事实。 */
interface ScriptedSessionInit {
  impl: ImplId
  meta: Meta
  nativeId: string
  transcript: ScriptedTranscript
  persist: () => void
  script: ScriptSelector
  child: SubprocessHandle | undefined
  stepDelayMs: number
  launch: BrainLaunchContext
}

/** 假提供方的一个会话。 */
class ScriptedSession implements BrainProviderSession {
  readonly id: string
  private readonly init: ScriptedSessionInit
  private readonly listeners = new Set<(event: BrainEvent) => void>()
  private turn: RunningTurn | undefined
  private queued: string[] = []
  private readonly permissions = new Map<PermissionRequestId, PendingPermission>()
  private closed = false
  private exited = false
  private persisted = false
  private counter = 0

  constructor(init: ScriptedSessionInit) {
    this.init = init
    this.id = init.nativeId
    if (init.transcript.turns > 0) {
      this.persisted = true
      init.persist()
    }
    void init.child?.done.then(() => { this.onProcessExit() }, () => { this.onProcessExit() })
  }

  private onProcessExit(): void {
    if (this.closed || this.exited) return
    this.exited = true
    this.turn?.abort.abort()
    this.emit({ kind: 'session.exited', category: 'process_exit', message: `${this.init.impl} CLI process exited` })
  }

  private emit(event: BrainEvent): void {
    if (this.closed) return
    for (const listener of [...this.listeners]) listener(event)
  }

  private nextId(prefix: string): string {
    this.counter += 1
    return `${prefix}-${String(this.counter)}`
  }

  subscribe(listener: (event: BrainEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private requireLive(operation: string): void {
    if (this.closed || this.exited) {
      throw new BrainError('unavailable', 'brain.session_closed', `scripted session ${this.id} is gone; ${operation} is unavailable`)
    }
  }

  startTurn(input: TurnInput): Promise<{ turnId: TurnId }> {
    return settled(() => {
      this.requireLive('startTurn')
      if (this.turn !== undefined) {
        throw new BrainError('conflict', 'brain.turn_active', `scripted session ${this.id} already runs a turn`)
      }
      const prompt = [...this.queued.splice(0), inputText(input)].join('\n')
      return { turnId: this.begin(prompt) }
    })
  }

  private begin(prompt: string): TurnId {
    this.init.transcript.turns += 1
    const turnNumber = this.init.transcript.turns
    const turn: RunningTurn = {
      turnId: TurnId(`${this.id}-turn-${String(turnNumber)}`),
      abort: new AbortController(),
      steers: [],
      children: new Set(),
    }
    this.turn = turn
    this.emit({ kind: 'turn.started', turnId: turn.turnId })
    const script = this.init.script(prompt, turnNumber)
    void this.run(turn, prompt, script).catch((error: unknown) => {
      this.init.launch.logger.warn(`scripted session ${this.id}: turn failed unexpectedly: ${String(error)}`)
    })
    return turn.turnId
  }

  private async run(turn: RunningTurn, prompt: string, script: ScriptedTurn): Promise<void> {
    const outcome = await this.runSteps(turn, script.steps, undefined)
    if (this.turn !== turn) return
    this.turn = undefined
    if (outcome.kind === 'failed') {
      this.emit({ kind: 'turn.failed', turnId: turn.turnId, category: outcome.category, message: outcome.message, retryable: outcome.category === 'retryable' })
    } else if (outcome.kind === 'interrupted' || turn.abort.signal.aborted) {
      // 已由 cancel 发过 turn.interrupted。
      return
    } else {
      this.persisted = true
      this.init.persist()
      this.emit({
        kind: 'turn.completed',
        turnId: turn.turnId,
        usage: script.usage ?? { tokens: { input: prompt.length, output: outcome.output }, inferences: 1 },
      })
    }
    if (outcome.kind === 'completed' && outcome.exit) {
      if (this.init.child === undefined) this.onProcessExit()
      else this.init.child.terminate()
      return
    }
    if (this.queued.length > 0 && !this.exited) {
      // 回合进行中收下的 next_turn 输入，在回合结束后作为下一回合送入（一次一批）。
      this.begin(this.queued.splice(0).join('\n'))
    }
  }

  private async runSteps(
    turn: RunningTurn,
    steps: readonly ScriptStep[],
    childId: ChildId | undefined,
  ): Promise<{ kind: 'completed'; output: number; exit: boolean } | { kind: 'failed'; category: FailureCategory; message: string } | { kind: 'interrupted' }> {
    let output = 0
    let exit = false
    for (const step of steps) {
      await this.boundary(turn)
      if (turn.abort.signal.aborted) return { kind: 'interrupted' }
      this.flushSteers(turn, childId)
      switch (step.kind) {
        case 'text': {
          const itemId = ItemId(this.nextId('msg'))
          const parts = splitText(step.text, step.chunks ?? 1)
          for (const [index, delta] of parts.entries()) {
            if (index > 0) await this.boundary(turn)
            if (aborted(turn)) return { kind: 'interrupted' }
            const final = index === parts.length - 1
            this.emit({ kind: 'item.message', turnId: turn.turnId, itemId, delta, final, ...(childId === undefined ? {} : { childId }) })
          }
          output += step.text.length
          break
        }
        case 'reasoning':
          this.emit({ kind: 'item.reasoning', turnId: turn.turnId, itemId: ItemId(this.nextId('reasoning')), summary: step.text, ...(childId === undefined ? {} : { childId }) })
          break
        case 'tool':
          this.toolCall(turn, step, step.ok ?? true, step.result, childId)
          break
        case 'permission': {
          const effect = await this.askPermission(turn, step, childId)
          if (effect === 'cancel') {
            this.interrupt(turn, 'permission cancelled')
            return { kind: 'interrupted' }
          }
          if (effect === undefined) return { kind: 'interrupted' }
          const allowed = effect.startsWith('allow')
          this.toolCall(turn, { ...step, native: true }, allowed, allowed ? step.result : 'denied by the permission answer', childId)
          break
        }
        case 'child': {
          const child = ChildId(this.nextId('child'))
          turn.children.add(child)
          this.emit({ kind: 'child.started', childId: child, childKind: 'native-child', label: step.label, provider: this.init.impl, ...(childId === undefined ? {} : { parentChildId: childId }) })
          const result = await this.runSteps(turn, step.steps, child)
          if (result.kind === 'interrupted') return result
          turn.children.delete(child)
          this.emit({ kind: 'child.ended', childId: child, stopReason: step.stopReason ?? 'completed', usage: step.usage ?? {} })
          break
        }
        case 'usage':
          this.emit({ kind: 'usage.update', turnId: turn.turnId, usage: step.usage })
          break
        case 'wait':
          try {
            await sleep(step.ms, undefined, { signal: turn.abort.signal })
          } catch (_cancelled) {
            // 取消打断等待；回合由 cancel 收尾。
            return { kind: 'interrupted' }
          }
          break
        case 'hold':
          while (!turn.abort.signal.aborted) {
            await new Promise<void>((resolve) => { turn.wake = resolve })
            turn.wake = undefined
            this.flushSteers(turn, childId)
          }
          return { kind: 'interrupted' }
        case 'fail':
          return { kind: 'failed', category: step.category, message: step.message }
        case 'exit':
          exit = true
          break
        default:
          assertNever(step)
      }
    }
    return { kind: 'completed', output, exit }
  }

  private async boundary(turn: RunningTurn): Promise<void> {
    if (this.init.stepDelayMs > 0) {
      try {
        await sleep(this.init.stepDelayMs, undefined, { signal: turn.abort.signal })
      } catch (_cancelled) {
        // 取消发生在步骤之间；调用方随后看到 aborted。
      }
    } else {
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  }

  private flushSteers(turn: RunningTurn, childId: ChildId | undefined): void {
    for (const steer of turn.steers.splice(0)) {
      this.emit({ kind: 'item.message', turnId: turn.turnId, itemId: ItemId(this.nextId('steer')), delta: `Noted mid-turn: ${steer}`, final: true, ...(childId === undefined ? {} : { childId }) })
    }
  }

  private toolCall(
    turn: RunningTurn,
    step: { tool: string; args: JsonValue; native?: boolean; detail?: ToolCallDetail },
    ok: boolean,
    result: JsonValue,
    childId: ChildId | undefined,
  ): void {
    const callId = CallId(this.nextId('call'))
    const child = childId === undefined ? {} : { childId }
    this.emit({
      kind: 'item.tool_call.started',
      turnId: turn.turnId,
      callId,
      tool: step.tool,
      args: step.args,
      native: step.native ?? true,
      ...(step.detail === undefined ? {} : { detail: step.detail }),
      ...child,
    })
    this.emit({ kind: 'item.tool_call.completed', turnId: turn.turnId, callId, result, ok, ...child })
  }

  private askPermission(
    turn: RunningTurn,
    step: { tool: string; args: JsonValue; detail?: ToolCallDetail },
    childId: ChildId | undefined,
  ): Promise<PermissionEffect | undefined> {
    const requestId = PermissionRequestId(this.nextId('permission'))
    return new Promise((resolve) => {
      const onAbort = (): void => {
        this.permissions.delete(requestId)
        resolve(undefined)
      }
      turn.abort.signal.addEventListener('abort', onAbort, { once: true })
      this.permissions.set(requestId, {
        turnId: turn.turnId,
        resolve: (effect, optionId) => {
          turn.abort.signal.removeEventListener('abort', onAbort)
          this.permissions.delete(requestId)
          this.emit({ kind: 'permission.resolved', turnId: turn.turnId, requestId, optionId, effect })
          resolve(effect)
        },
      })
      this.emit({
        kind: 'permission.request',
        turnId: turn.turnId,
        requestId,
        category: 'tool',
        tool: step.tool,
        args: step.args,
        ...(step.detail === undefined ? {} : { detail: step.detail }),
        options: SCRIPTED_PERMISSION_OPTIONS.map(option => ({ ...option })),
        ...(childId === undefined ? {} : { childId }),
      })
    })
  }

  deliver(input: TurnInput, options: DeliverOptions): Promise<DeliverResult> {
    return settled(() => {
      const supported = options.semantics === 'next_step' ? this.init.meta.delivery.nextStep : this.init.meta.delivery.nextTurn
      if (!supported) return 'unsupported'
      if (this.closed || this.exited) return 'unavailable'
      const text = inputText(input)
      if (options.semantics === 'next_step') {
        const turn = this.turn
        if (turn === undefined || (options.expectedTurnId !== undefined && options.expectedTurnId !== turn.turnId)) return 'unavailable'
        turn.steers.push(text)
        turn.wake?.()
        return 'accepted'
      }
      this.queued.push(text)
      if (this.turn === undefined && options.wake) this.begin(this.queued.splice(0).join('\n'))
      return 'accepted'
    })
  }

  cancel(options: CancelOptions): Promise<void> {
    return settled(() => {
      const turn = this.turn
      // 先撤回提供方还没读走的插话，否则刚停的回合会被它重新拉起；next_turn 队列按 keepQueue 去留。
      if (turn !== undefined) turn.steers.length = 0
      if (!options.keepQueue || !this.init.meta.delivery.cancelKeepsQueue) this.queued = []
      if (turn === undefined) return
      this.interrupt(turn, `cancelled: ${options.reason}`)
    })
  }

  private interrupt(turn: RunningTurn, reason: string): void {
    if (this.turn !== turn) return
    this.turn = undefined
    turn.abort.abort()
    turn.wake?.()
    for (const child of turn.children) this.emit({ kind: 'child.ended', childId: child, stopReason: 'cancelled', usage: {} })
    turn.children.clear()
    this.emit({ kind: 'turn.interrupted', turnId: turn.turnId, reason })
  }

  respondToPermission(requestId: PermissionRequestId, response: PermissionResponse): Promise<void> {
    return settled(() => {
      this.requireLive('respondToPermission')
      const pending = this.permissions.get(requestId)
      if (pending === undefined) {
        throw new BrainError('not_found', 'brain.permission_unknown', `scripted session ${this.id} has no pending permission ${requestId}`)
      }
      const option = SCRIPTED_PERMISSION_OPTIONS.find(candidate => candidate.id === response.optionId)
      if (option === undefined) {
        this.init.launch.logger.warn(`scripted session ${this.id}: unknown permission option ${response.optionId}; applying deny_once`)
      }
      pending.resolve(option?.effect ?? 'deny_once', response.optionId)
    })
  }

  persistence(): ResumeHandle | null {
    if (!this.init.meta.resume || !this.persisted) return null
    return { provider: this.init.impl, sessionRef: this.id, createdAt: this.init.transcript.createdAt, nativeHandle: this.id }
  }

  canStopRuntime(): Promise<boolean> {
    return settled(() => {
      return this.turn === undefined && this.permissions.size === 0
    })
  }

  setModel(_model: string): Promise<void> {
    return settled(() => {
      this.requireLive('setModel')
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    const turn = this.turn
    this.turn = undefined
    turn?.abort.abort()
    turn?.wake?.()
    this.closed = true
    this.permissions.clear()
    this.listeners.clear()
    const child = this.init.child
    if (child !== undefined) {
      child.terminate()
      await child.done.catch(() => undefined)
    }
  }
}

/**
 * 同步执行 `work`，把结果或抛出的错误变成 Promise（提供方接口的方法都返回 Promise）。
 * @param work - 同步的方法体。
 * @returns 以 `work` 的结果完成、或以它抛出的错误拒绝的 Promise。
 */
function settled<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => { resolve(work()) })
}

/**
 * 回合是否已被取消（读成方法调用，免得类型收窄把循环里的再检查当成多余）。
 * @param turn - 回合。
 * @returns 是否已取消。
 */
function aborted(turn: RunningTurn): boolean {
  return turn.abort.signal.aborted
}

/**
 * 把文本切成大致等长的若干段。
 * @param text - 原文。
 * @param chunks - 段数（至少 1）。
 * @returns 各段；拼起来等于原文。
 */
function splitText(text: string, chunks: number): string[] {
  const count = Math.max(1, Math.min(chunks, text.length))
  const size = Math.ceil(text.length / count)
  const parts: string[] = []
  for (let start = 0; start < text.length; start += size) parts.push(text.slice(start, start + size))
  return parts.length === 0 ? [''] : parts
}
