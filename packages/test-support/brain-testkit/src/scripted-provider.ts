/**
 * 回放脚本驱动的假提供方：一份脚本描述一个回合里 CLI 做了什么（流式文本、思考、工具调用、权限请求、问答、
 * 子 agent（含跨回合的后台子 agent）、用量、失败、在两回合之间退出），假提供方按 `brain.provider` 契约把它翻成
 * 事件；它也有模式（`default` / `plan`）与可换的模型。每个会话经启动上下文拉起一个空转的 node 子进程，代替真实
 * CLI 进程，使进程归属、退出与 `session.exited` 都走真实路径。它只用于测试与显式的测试 profile，不进产品默认组合。
 * @module @liwa/brain-testkit/scripted-provider
 */

import { setTimeout as sleep } from 'node:timers/promises'
import {
  BrainError, CallId, ChildId, ItemId, PermissionRequestId, TurnId, checkPermissionAnswers,
  type BrainEvent, type BrainLaunchContext, type BrainMode, type BrainProbeContext, type BrainProbeResult, type BrainProvider,
  type BrainProviderSession, type BrainSessionHome, type CancelOptions, type CancelReason, type ChildStopReason,
  type DeliverOptions, type DeliverResult, type MemberConfigWriter, type ModeChange, type PermissionAnswer,
  type FailureCategory, type ImplId, type Meta, type PermissionEffect, type PermissionOption, type PermissionQuestion,
  type PermissionResponse, type ResumeHandle, type SessionConfig, type ToolCallDetail, type TurnInput, type Usage,
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
  /**
   * 一个后台子 agent：开始后父回合接着往下走；它在后台停 `ms` 毫秒再跑自己的几步、结束（父回合结束了也照常），然后
   * CLI 自己开一个回合报它的结果。按 `pause` / `drain` / `owner` 取消父回合时它一起被停；抢占、看门狗只停父回合。
   */
  | { kind: 'background'; label: string; ms: number; steps: ScriptStep[]; usage?: Usage }
  /** 向主人提问：答了就说出答案，谢绝就说谢绝了。 */
  | { kind: 'question'; questions: PermissionQuestion[] }
  /** 说出本回合输入里的图片（MIME 与字节数）。 */
  | { kind: 'images' }
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
  /** 显式给出时所有终止结果都带的用量；省略时仅 completed 按字数估计，失败与取消不编造消费。 */
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
  /** 会话 home 的布局，默认 `per-member`。 */
  sessionHome?: BrainSessionHome
  /** 成员配置目录里这家的写法（可选，测公共层的配置目录用）。 */
  memberConfig?: MemberConfigWriter
  /** 可换的模型，默认 {@link SCRIPTED_MODELS}。 */
  models?: readonly string[]
}

/** 假提供方默认可换的模型。 */
export const SCRIPTED_MODELS: readonly string[] = ['scripted-small', 'scripted-large']

/** 假提供方的模式。 */
export const SCRIPTED_MODES: readonly BrainMode[] = [
  { id: 'default', label: 'Default' },
  { id: 'plan', label: 'Plan', description: 'Plan before acting.' },
]

/** 假提供方的默认能力声明：送达语义、续接、子 agent 观察都支持。 */
export const SCRIPTED_META: Meta = {
  streaming: true,
  resume: true,
  nativeTools: false,
  permissionHook: true,
  rollback: false,
  modelSwitch: true,
  thinkingSwitch: false,
  modeSwitch: true,
  delivery: { nextStep: true, nextTurn: true, cancelKeepsQueue: true },
  compaction: 'none',
  budget: { inferences: false, toolCalls: false, concludeOn: false },
  usage: 'tokens',
  personaInjection: { instance: 'system_prompt' },
  agentConfig: { plugins: true, hooks: true, instructions: true },
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

/** 问答请求给出的三个选项：作答、谢绝、谢绝并停下。 */
export const SCRIPTED_QUESTION_OPTIONS: readonly PermissionOption[] = [
  { id: 'answer', label: 'Answer', effect: 'allow_once' },
  { id: 'decline', label: 'Decline', effect: 'deny_once' },
  { id: 'cancel', label: 'Decline and stop', effect: 'cancel' },
]

/** 演示脚本按提示词里的关键词挑的场景。 */
export type DemoScenario =
  | 'reply' | 'tool' | 'permission' | 'child' | 'child-permission' | 'background' | 'question' | 'answers' | 'image' | 'long' | 'exit' | 'fail'

/** 子 agent 请求权限的那次调用的入参里带的标记（契约测试据它核对请求带上了所问调用的事实）。 */
export const CHILD_PERMISSION_MARK = 'child-permission-mark'

/** 假 CLI 说出它收到的答案时用的前缀，后面是一个 JSON 对象：问题号 → `{ selected, custom? }`。 */
export const ANSWERS_ECHO = 'ANSWERS '

/**
 * 假 CLI 说出它收到的答案：{@link ANSWERS_ECHO} 加上以问题号为键的结构化答案（选项与补充文字分开）。
 * @param answers - 收到的答案，以问题号为键。
 * @returns 一行文字。
 */
export function echoAnswers(answers: Readonly<Record<string, PermissionAnswer>>): string {
  const canonical = Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, {
    selected: [...answer.selected],
    ...(answer.custom === undefined ? {} : { custom: answer.custom }),
  }]))
  return `${ANSWERS_ECHO}${JSON.stringify(canonical)}`
}

/**
 * 从回复里读回 {@link echoAnswers} 说出的答案。
 * @param reply - 回复全文。
 * @returns 以问题号为键的答案；回复里没有时为 `undefined`。
 */
export function readEchoedAnswers(reply: string): Record<string, PermissionAnswer> | undefined {
  const at = reply.indexOf(ANSWERS_ECHO)
  if (at < 0) return undefined
  try {
    return JSON.parse(reply.slice(at + ANSWERS_ECHO.length).trim()) as Record<string, PermissionAnswer>
  } catch (_notJson) {
    // 说得不完整就当没说；调用方按缺失处理。
    return undefined
  }
}

/** 演示脚本 `question` 场景问的问题。 */
export const SCRIPTED_QUESTION: PermissionQuestion = {
  id: 'color',
  header: 'Color',
  question: 'Which color should the button be?',
  options: [{ label: 'red' }, { label: 'blue', description: 'the calm one' }],
  multiSelect: false,
}

/**
 * 演示脚本 `answers` 场景问的问题：一个有选项、也收补充文字的单选（选项里有带逗号的），一个选项里有逗号的多选，
 * 一个只收自由文本的问题。
 */
export const SCRIPTED_ANSWER_QUESTIONS: readonly PermissionQuestion[] = [
  { id: 'pick', header: 'Pick', question: 'Which color should the button be?', options: [{ label: 'red' }, { label: 'blue, green' }], multiSelect: false },
  { id: 'tags', header: 'Tags', question: 'Which tags apply?', options: [{ label: 'a, b' }, { label: 'c' }, { label: 'd' }], multiSelect: true },
  { id: 'note', header: 'Note', question: 'Anything else?', options: [], multiSelect: false },
]

/**
 * 演示与契约测试共用的脚本：提示词里出现场景名（`permission`、`child` 等）就跑那个场景，否则回显。
 * @param prompt - 本回合输入的全部文本。
 * @param turn - 第几回合。
 * @returns 本回合的脚本。
 */
export function demoScript(prompt: string, turn: number): ScriptedTurn {
  // `child-permission` 里含有 `child` 与 `permission`，先认它。
  const scenario = (['child-permission', 'permission', 'background', 'child', 'answers', 'question', 'image', 'long', 'exit', 'fail', 'tool'] as const).find(name => prompt.includes(name)) ?? 'reply'
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
    case 'child-permission':
      return {
        steps: [
          {
            kind: 'child',
            label: 'writer',
            steps: [
              {
                kind: 'permission',
                tool: 'write',
                args: { path: 'notes.md', content: 'from the child', justification: `the child writes outside its sandbox (${CHILD_PERMISSION_MARK})` },
                result: 'written',
                detail: { type: 'write', path: 'notes.md' },
              },
              { kind: 'text', text: 'Child wrote the notes.' },
            ],
            usage: { tokens: { input: 5, output: 3 } },
          },
          reply,
        ],
      }
    case 'background':
      return {
        steps: [
          { kind: 'background', label: 'researcher', ms: 300, steps: [{ kind: 'tool', tool: 'read_file', args: { path: 'NOTES.md' }, result: 'notes' }, { kind: 'text', text: 'Background child found the notes.' }], usage: { tokens: { input: 7, output: 4 } } },
          { kind: 'text', text: 'Started a background helper.' },
          { kind: 'hold' },
        ],
      }
    case 'question':
      return { steps: [{ kind: 'question', questions: [SCRIPTED_QUESTION] }] }
    case 'answers':
      return { steps: [{ kind: 'question', questions: SCRIPTED_ANSWER_QUESTIONS.map(question => ({ ...question, options: question.options.map(option => ({ ...option })) })) }] }
    case 'image':
      return { steps: [{ kind: 'images' }] }
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
  /** 会话 home 的布局。 */
  readonly sessionHome: BrainSessionHome
  /** 成员配置目录里这家的写法（给了 `memberConfig` 才有）。 */
  readonly writeMemberConfig?: MemberConfigWriter
  private readonly script: ScriptSelector
  private readonly spawnProcess: boolean
  private readonly stepDelayMs: number
  private readonly models: readonly string[]
  private readonly transcripts = new Map<string, ScriptedTranscript>()
  private sessions = 0

  /**
   * @param options - 实现名、能力覆盖、脚本、是否拉起子进程、步骤间停顿。
   */
  constructor(options: ScriptedProviderOptions = {}) {
    this.impl = options.impl ?? ('fake' as ImplId)
    this.meta = { ...SCRIPTED_META, ...options.meta }
    this.sessionHome = options.sessionHome ?? 'per-member'
    if (options.memberConfig !== undefined) this.writeMemberConfig = options.memberConfig
    this.script = options.script ?? demoScript
    this.spawnProcess = options.process ?? true
    this.stepDelayMs = options.stepDelayMs ?? 0
    this.models = options.models ?? SCRIPTED_MODELS
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
    if (config.modeId !== undefined && !SCRIPTED_MODES.some(mode => mode.id === config.modeId)) {
      throw new BrainError('invalid_input', 'brain.mode_unknown', `scripted provider ${this.impl} has no mode ${config.modeId}`)
    }
    if (config.model !== undefined && !this.models.includes(config.model)) {
      throw new BrainError('invalid_input', 'brain.model_unknown', `scripted provider ${this.impl} has no model ${config.model}`)
    }
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
      models: this.models,
      modeId: config.modeId ?? 'default',
    })
  }
}

/** 正在跑的回合。 */
interface RunningTurn {
  usage?: Usage
  turnId: TurnId
  abort: AbortController
  /** 已收下、还没在某一步边界露面的插话。 */
  steers: string[]
  /** 本回合开着的子 agent。 */
  children: Set<ChildId>
  /** 本回合输入里的图片（MIME 与字节数）。 */
  images: { mime: string; bytes: number }[]
  /** 唤醒 `hold` 的回调（插话到达或取消）。 */
  wake?: (() => void) | undefined
}

/** 一次待答的权限请求；问答请求带问题。 */
interface PendingPermission {
  turnId: TurnId
  questions?: PermissionQuestion[]
  resolve: (effect: PermissionEffect, optionId: string, answers?: Record<string, PermissionAnswer>) => void
}

/** 一个后台子 agent。 */
interface BackgroundChild {
  abort: AbortController
}

/** 连同后台子 agent 一起停的取消原因（01 §4.5）。 */
const STOP_CHILDREN: ReadonlySet<CancelReason> = new Set(['pause', 'drain', 'owner'])

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
  models: readonly string[]
  modeId: string
}

/** 假提供方的一个会话。 */
class ScriptedSession implements BrainProviderSession {
  readonly id: string
  private readonly init: ScriptedSessionInit
  private readonly listeners = new Set<(event: BrainEvent) => void>()
  private turn: RunningTurn | undefined
  private queued: string[] = []
  private readonly permissions = new Map<PermissionRequestId, PendingPermission>()
  private readonly background = new Map<ChildId, BackgroundChild>()
  private closed = false
  private exited = false
  private persisted = false
  private counter = 0
  private mode: string

  constructor(init: ScriptedSessionInit) {
    this.init = init
    this.id = init.nativeId
    this.mode = init.modeId
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

  async startTurn(input: TurnInput): Promise<{ turnId: TurnId }> {
    this.requireLive('startTurn')
    // 图片从 blob 存储取回（引用对不上就在这里失败），假 CLI 只记 MIME 与字节数。
    const images = await Promise.all(input.blocks.flatMap(block => (block.kind === 'image'
      ? [this.init.launch.readBlob(block.blob).then(bytes => ({ mime: block.blob.mime, bytes: bytes.byteLength }))]
      : [])))
    this.requireLive('startTurn')
    if (this.turn !== undefined) {
      throw new BrainError('conflict', 'brain.turn_active', `scripted session ${this.id} already runs a turn`)
    }
    const prompt = [...this.queued.splice(0), inputText(input)].join('\n')
    return { turnId: this.begin(prompt, images) }
  }

  private begin(prompt: string, images: RunningTurn['images'] = []): TurnId {
    this.init.transcript.turns += 1
    const turnNumber = this.init.transcript.turns
    const turn: RunningTurn = {
      turnId: TurnId(`${this.id}-turn-${String(turnNumber)}`),
      abort: new AbortController(),
      steers: [],
      children: new Set(),
      images,
    }
    this.turn = turn
    this.emit({ kind: 'turn.started', turnId: turn.turnId })
    const script = this.init.script(prompt, turnNumber)
    if (script.usage !== undefined) turn.usage = script.usage
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
      this.emit({ kind: 'turn.failed', turnId: turn.turnId, category: outcome.category, message: outcome.message, retryable: outcome.category === 'retryable', ...(script.usage === undefined ? {} : { usage: script.usage }) })
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
        case 'background':
          this.startBackground(turn.turnId, step, childId)
          break
        case 'question': {
          const answer = await this.askQuestion(turn, step.questions)
          if (answer === undefined) return { kind: 'interrupted' }
          if (answer.effect === 'cancel') {
            this.interrupt(turn, 'question cancelled')
            return { kind: 'interrupted' }
          }
          const text = answer.answers === undefined ? 'The question was declined.' : `Answered: ${echoAnswers(answer.answers)}`
          this.emit({ kind: 'item.message', turnId: turn.turnId, itemId: ItemId(this.nextId('msg')), delta: text, final: true, ...(childId === undefined ? {} : { childId }) })
          output += text.length
          break
        }
        case 'images': {
          const text = turn.images.length === 0 ? 'No images.' : `Images: ${turn.images.map(image => `${image.mime} ${String(image.bytes)}B`).join(', ')}`
          this.emit({ kind: 'item.message', turnId: turn.turnId, itemId: ItemId(this.nextId('msg')), delta: text, final: true, ...(childId === undefined ? {} : { childId }) })
          output += text.length
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

  /**
   * 开一个后台子 agent：它的条目带开它的回合号，父回合结束后照常到达；结束后 CLI 自己开一个回合报它的结果。
   * @param origin - 开它的父回合。
   * @param step - 脚本步骤。
   * @param parentChildId - 开它的子 agent（有的话）。
   */
  private startBackground(origin: TurnId, step: Extract<ScriptStep, { kind: 'background' }>, parentChildId: ChildId | undefined): void {
    const childId = ChildId(this.nextId('child'))
    const abort = new AbortController()
    this.background.set(childId, { abort })
    this.emit({ kind: 'child.started', childId, childKind: 'native-child', label: step.label, provider: this.init.impl, turnId: origin, ...(parentChildId === undefined ? {} : { parentChildId }) })
    void (async () => {
      try {
        await sleep(step.ms, undefined, { signal: abort.signal })
      } catch (_stopped) {
        // 被取消原因或关会话停下；结束由停它的一方报。
        return
      }
      let report = ''
      for (const inner of step.steps) {
        if (abort.signal.aborted || this.closed) return
        if (inner.kind === 'text') {
          report = inner.text
          this.emit({ kind: 'item.message', turnId: origin, itemId: ItemId(this.nextId('msg')), delta: inner.text, final: true, childId })
        } else if (inner.kind === 'tool') {
          const callId = CallId(this.nextId('call'))
          this.emit({ kind: 'item.tool_call.started', turnId: origin, callId, tool: inner.tool, args: inner.args, native: inner.native ?? true, childId })
          await new Promise<void>(resolve => setImmediate(resolve))
          this.emit({ kind: 'item.tool_call.completed', turnId: origin, callId, result: inner.result, ok: inner.ok ?? true, childId })
        }
      }
      if (abort.signal.aborted || this.closed) return
      this.background.delete(childId)
      this.emit({ kind: 'child.ended', childId, stopReason: 'completed', usage: step.usage ?? {} })
      await this.reportBackground(step.label, report)
    })()
  }

  /**
   * 后台子 agent 的结果叫醒 CLI：等到没有回合在跑，开一个提供方自己的回合说出结果。
   * @param label - 子 agent 的名字。
   * @param report - 它的结果。
   */
  private async reportBackground(label: string, report: string): Promise<void> {
    while (this.turn !== undefined && !this.closed && !this.exited) await sleep(20)
    if (this.closed || this.exited) return
    this.init.transcript.turns += 1
    const turnId = TurnId(`${this.id}-turn-${String(this.init.transcript.turns)}`)
    this.emit({ kind: 'turn.started', turnId })
    const text = `Child ${label} reported: ${report}`
    this.emit({ kind: 'item.message', turnId, itemId: ItemId(this.nextId('msg')), delta: text, final: true })
    this.persisted = true
    this.init.persist()
    this.emit({ kind: 'turn.completed', turnId, usage: { tokens: { input: report.length, output: text.length }, inferences: 1 } })
  }

  private askQuestion(
    turn: RunningTurn,
    questions: PermissionQuestion[],
  ): Promise<{ effect: PermissionEffect; answers?: Record<string, PermissionAnswer> } | undefined> {
    const requestId = PermissionRequestId(this.nextId('question'))
    return new Promise((resolve) => {
      const onAbort = (): void => {
        this.permissions.delete(requestId)
        resolve(undefined)
      }
      turn.abort.signal.addEventListener('abort', onAbort, { once: true })
      this.permissions.set(requestId, {
        turnId: turn.turnId,
        questions,
        resolve: (effect, optionId, answers) => {
          turn.abort.signal.removeEventListener('abort', onAbort)
          this.permissions.delete(requestId)
          this.emit({ kind: 'permission.resolved', turnId: turn.turnId, requestId, optionId, effect })
          resolve({ effect, ...(answers === undefined || !effect.startsWith('allow') ? {} : { answers }) })
        },
      })
      this.emit({
        kind: 'permission.request',
        turnId: turn.turnId,
        requestId,
        category: 'question',
        tool: 'ask_user_question',
        args: { questions: questions.map(question => question.question) },
        questions: questions.map(question => ({ ...question, options: question.options.map(option => ({ ...option })) })),
        options: SCRIPTED_QUESTION_OPTIONS.map(option => ({ ...option })),
      })
    })
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
      if (STOP_CHILDREN.has(options.reason)) {
        // 暂停、排空、归属方结束：后台子 agent 一起停；抢占与看门狗让它们跑完。
        for (const [childId, child] of this.background) {
          child.abort.abort()
          this.emit({ kind: 'child.ended', childId, stopReason: 'cancelled', usage: {} })
        }
        this.background.clear()
      }
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
    this.emit({ kind: 'turn.interrupted', turnId: turn.turnId, reason, ...(turn.usage === undefined ? {} : { usage: turn.usage }) })
  }

  respondToPermission(requestId: PermissionRequestId, response: PermissionResponse): Promise<void> {
    return settled(() => {
      this.requireLive('respondToPermission')
      const pending = this.permissions.get(requestId)
      if (pending === undefined) {
        throw new BrainError('not_found', 'brain.permission_unknown', `scripted session ${this.id} has no pending permission ${requestId}`)
      }
      const options = pending.questions === undefined ? SCRIPTED_PERMISSION_OPTIONS : SCRIPTED_QUESTION_OPTIONS
      const option = options.find(candidate => candidate.id === response.optionId)
      if (option === undefined) {
        this.init.launch.logger.warn(`scripted session ${this.id}: unknown permission option ${response.optionId}; applying deny_once`)
      }
      if (pending.questions !== undefined && option?.effect.startsWith('allow') === true) {
        const problem = response.answers === undefined ? 'an answer needs answers' : checkPermissionAnswers(pending.questions, response.answers)
        if (problem !== undefined) throw new BrainError('invalid_input', 'brain.permission_answers_invalid', `scripted question ${requestId}: ${problem}`)
      }
      pending.resolve(option?.effect ?? 'deny_once', response.optionId, response.answers)
    })
  }

  persistence(): ResumeHandle | null {
    if (!this.init.meta.resume || !this.persisted) return null
    return { provider: this.init.impl, sessionRef: this.id, createdAt: this.init.transcript.createdAt, nativeHandle: this.id }
  }

  canStopRuntime(): Promise<boolean> {
    return settled(() => {
      return this.turn === undefined && this.permissions.size === 0 && this.background.size === 0
    })
  }

  setModel(model: string): Promise<void> {
    return settled(() => {
      this.requireLive('setModel')
      if (!this.init.models.includes(model)) {
        throw new BrainError('invalid_input', 'brain.model_unknown', `scripted session ${this.id} has no model ${model}; available: ${this.init.models.join(', ')}`)
      }
      this.emit({ kind: 'session.model_changed', model })
    })
  }

  availableModes(): Promise<BrainMode[]> {
    return Promise.resolve(SCRIPTED_MODES.map(mode => ({ ...mode })))
  }

  currentMode(): Promise<string | null> {
    return Promise.resolve(this.mode)
  }

  setMode(modeId: string): Promise<ModeChange> {
    return settled(() => {
      this.requireLive('setMode')
      if (!SCRIPTED_MODES.some(mode => mode.id === modeId)) {
        throw new BrainError('invalid_input', 'brain.mode_unknown', `scripted session ${this.id} has no mode ${modeId}`)
      }
      const changed = this.mode !== modeId
      this.mode = modeId
      if (changed) this.emit({ kind: 'session.mode_changed', modeId })
      return { modeId, appliesAt: this.turn === undefined ? 'now' as const : 'next_step' as const }
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    const turn = this.turn
    this.turn = undefined
    turn?.abort.abort()
    turn?.wake?.()
    this.closed = true
    for (const child of this.background.values()) child.abort.abort()
    this.background.clear()
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
