/**
 * Paseo `AgentSession` 到 `brain.provider` 会话契约（`BrainProviderSession`）的通用映射。三家 CLI 的 Paseo
 * 适配器都产出同一种 `AgentSession`，所以事件翻译（`AgentStreamEvent` → `BrainEvent`）、权限与问答的翻译、
 * 用量映射、提供方子 agent（`provider_subagent`）→ `child.*`、送达、取消、换模型、模式的契约义务都写在这里一次；
 * 各提供方包只在它自己的 `adapter.ts` 里覆写差异（工具名取法、`_meta` 扩展、插话通道、协议专属的取消等待）。
 *
 * 归属规则：条目、子 agent 与工具调用按真实归属记账——父会话还开着的消息与思考按回合各记一份，每个调用记下它的
 * 回合与 `childId`，父回合结束只收尾父会话自己在这一回合的条目（旧回合的取消确认晚到，也碰不到新回合的消息）；
 * 子 agent 是会话级的（Paseo `docs/agent-lifecycle.md`），它的条目、权限请求、完成与状态修正在父回合结束后照常
 * 送达，回合号用开它的那个父回合。
 *
 * 问答的答案在边界上一直是结构（选中的选项与补充文字分开），不拼成展示文字：契约答案经
 * {@link PaseoBrainSession.permissionAnswerInput} 交给提供方的 Paseo 适配器，由提供方翻成它的原生形状。
 * @module @liwa/brain-shared/session
 */

import { randomUUID } from 'node:crypto'
import {
  BrainError, CallId, ChildId, ItemId, PermissionRequestId, TurnId,
  type BrainBlobReader, type BrainEvent, type BrainEventOf, type BrainMode, type BrainProviderSession, type CancelOptions,
  type ChildStopReason, type DeliverOptions, type DeliverResult, type FailureCategory, type ImplId, type Meta, type ModeChange,
  type PermissionAnswer, type PermissionOption, type PermissionQuestion, type PermissionResponse, type ResumeHandle,
  type ToolCallDetail, type TurnInput, type Usage,
} from '@liwa/brain'
import type { JsonValue } from '@liwa/util-values'
import type {
  AgentMetadata, AgentMode, AgentPermissionRequest, AgentPermissionResponse, AgentPromptContentBlock, AgentSession,
  AgentStreamEvent, AgentTimelineItem, AgentUsage, ToolCallDetail as PaseoToolCallDetail, ToolCallTimelineItem,
} from './paseo/agent/agent-sdk-types.ts'
import { MODE_APPLIES_NEXT_TURN_NOTICE } from './paseo/agent/provider-notices.ts'
import type { ProviderSubagentInputEvent } from './paseo/agent/provider-subagents/store.ts'
import { toPaseoPrompt } from './turn-input.ts'

/** 构造 {@link PaseoBrainSession} 需要的事实。 */
export interface PaseoBrainSessionInit {
  /** 提供方实现名（填进 `child.started.provider`、续接句柄）。 */
  impl: ImplId
  /** 提供方的能力声明（送达矩阵、续接、换模型、模式）。 */
  meta: Meta
  /** 已初始化的 Paseo 会话。 */
  session: AgentSession
  /** 回合输入里图片引用的字节来源（会话的启动上下文）。 */
  blobs: BrainBlobReader
}

/** 回合的终止事件。 */
export type TurnTerminal = BrainEventOf<'turn.completed' | 'turn.interrupted' | 'turn.failed'>

/** 一个待答权限请求：契约选项、它们对应的 Paseo 答复与原生请求。 */
interface PendingPermission {
  turnId: TurnId | undefined
  childId: ChildId | undefined
  request: AgentPermissionRequest
  options: PermissionOption[]
  responses: Map<string, AgentPermissionResponse>
  questions: PermissionQuestion[] | undefined
  chosen?: PermissionOption
}

/** 一次工具调用的归属：所属回合（子 agent 的是开它的父回合）、子 agent、是否已报结束。 */
interface CallState {
  turnId: TurnId | undefined
  childId: ChildId | undefined
  completed: boolean
}

/** 一个提供方子 agent：状态与开它的父回合。 */
interface ChildState {
  running: boolean
  turnId: TurnId | undefined
}

/** 父会话在一个回合里还开着的条目：在流的消息（等收尾）、本段思考（同一段思考共用一个条目号）。 */
interface OpenItems {
  message?: ItemId
  reasoning?: ItemId
}

/** 契约里的取消选项号；对上它的答复拒绝并中断回合。 */
export const CANCEL_OPTION_ID = 'cancel'
/** 原生请求没有一次性拒绝时补上的拒绝选项号。 */
export const DENY_OPTION_ID = 'deny'
/** 原生请求没有给动作时补上的一次性允许选项号（问答请求是"作答"）。 */
export const ALLOW_OPTION_ID = 'allow'
/** 记住的已结束回合数：挡住晚到的终止事件重复收尾。 */
const ENDED_TURN_MEMORY = 64

/**
 * 任意值转成契约里的 JSON 值；转不了的写成字符串。
 * @param value - 提供方给的值。
 * @returns JSON 值。
 */
export function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue
  } catch (_unserializable) {
    // 循环引用或 BigInt：载荷只是展示，给占位而不是丢掉整个事件。
    return '[unserializable]'
  }
}

/**
 * Paseo 用量 → 契约用量；报不出的字段留空，不填 0。
 * @param usage - Paseo 回合用量。
 * @returns 契约用量。
 */
export function mapPaseoUsage(usage: AgentUsage | undefined): Usage {
  if (usage === undefined) return {}
  const result: Usage = {}
  if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
    result.tokens = {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
      ...(usage.cachedInputTokens === undefined ? {} : { cacheRead: usage.cachedInputTokens }),
    }
  }
  if (usage.contextWindowUsedTokens !== undefined && usage.contextWindowMaxTokens !== undefined) {
    result.context = { used: usage.contextWindowUsedTokens, max: usage.contextWindowMaxTokens }
  }
  if (usage.totalCostUsd !== undefined) result.providerReportedCostUsd = usage.totalCostUsd
  return result
}

/**
 * Paseo 工具详情 → 契约工具详情（闭合联合）。
 * @param detail - Paseo 详情。
 * @returns 契约详情；Paseo 的子 agent、纯文本、计划、工作树、未知映射为 `other`。
 */
export function mapPaseoToolDetail(detail: PaseoToolCallDetail | undefined): ToolCallDetail | undefined {
  if (detail === undefined) return undefined
  switch (detail.type) {
    case 'shell':
      return { type: 'shell', command: detail.command, ...(detail.cwd === undefined ? {} : { cwd: detail.cwd }) }
    case 'read':
      return { type: 'read', path: detail.filePath }
    case 'edit':
      return { type: 'edit', path: detail.filePath, ...(detail.unifiedDiff === undefined ? {} : { unifiedDiff: detail.unifiedDiff }) }
    case 'write':
      return { type: 'write', path: detail.filePath }
    case 'search':
      return { type: 'search', query: detail.query }
    case 'fetch':
      return { type: 'fetch', url: detail.url }
    case 'worktree_setup':
    case 'sub_agent':
    case 'plain_text':
    case 'plan':
    case 'unknown':
      return { type: 'other' }
  }
}

/**
 * 从 Paseo 详情推出调用参数（提供方没给原始入参时）。
 * @param detail - Paseo 详情。
 * @returns JSON 参数。
 */
function argsFromDetail(detail: PaseoToolCallDetail): JsonValue {
  switch (detail.type) {
    case 'shell':
      return toJsonValue({ command: detail.command, cwd: detail.cwd })
    case 'read':
      return toJsonValue({ path: detail.filePath, offset: detail.offset, limit: detail.limit })
    case 'edit':
    case 'write':
      return toJsonValue({ path: detail.filePath })
    case 'search':
      return toJsonValue({ query: detail.query })
    case 'fetch':
      return toJsonValue({ url: detail.url, prompt: detail.prompt })
    case 'unknown':
      return toJsonValue(detail.input)
    case 'sub_agent':
      return toJsonValue({ description: detail.description, type: detail.subAgentType })
    case 'plain_text':
    case 'plan':
    case 'worktree_setup':
      return null
  }
}

/**
 * 从 Paseo 详情推出调用结果（提供方没给原始结果时）。
 * @param detail - Paseo 详情。
 * @returns JSON 结果。
 */
function resultFromDetail(detail: PaseoToolCallDetail): JsonValue {
  switch (detail.type) {
    case 'shell':
      return toJsonValue({ output: detail.output, exitCode: detail.exitCode })
    case 'read':
    case 'write':
      return toJsonValue(detail.content ?? null)
    case 'search':
      return toJsonValue(detail.content ?? null)
    case 'fetch':
      return toJsonValue(detail.result ?? null)
    case 'plain_text':
      return toJsonValue(detail.text ?? null)
    case 'plan':
      return detail.text
    case 'unknown':
      return toJsonValue(detail.output)
    case 'edit':
      return toJsonValue(detail.unifiedDiff ?? null)
    case 'sub_agent':
    case 'worktree_setup':
      return null
  }
}

/**
 * 一段失败文字的类别与是否值得重试（提供方报不出类别时的通用判断）。
 * @param message - 失败消息。
 * @param code - 提供方给的代码（有的话）。
 * @returns 类别与可重试性。
 */
export function classifyFailure(message: string, code?: string): { category: FailureCategory; retryable: boolean } {
  const text = `${code ?? ''} ${message}`
  if (/exited unexpectedly|process exited|connection closed/i.test(text)) return { category: 'process_exit', retryable: true }
  if (/\b401\b|unauthori[sz]ed|api key|credential|authenticat/i.test(text)) return { category: 'auth', retryable: false }
  if (/context.*(length|window|exceed|too long)|maximum context/i.test(text)) return { category: 'context_exceeded', retryable: false }
  if (/quota|insufficient balance|billing|\b402\b/i.test(text)) return { category: 'quota', retryable: false }
  if (/timed? ?out|timeout/i.test(text)) return { category: 'timeout', retryable: true }
  if (/refus/i.test(text)) return { category: 'refused', retryable: false }
  return { category: 'retryable', retryable: true }
}

/**
 * Paseo 子 agent 状态 → 契约结束原因。
 * @param status - Paseo 状态。
 * @returns 结束原因；还在跑或没说时为 `undefined`。
 */
function childStopReason(status: string | undefined): ChildStopReason | undefined {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'cancelled'
    default:
      return undefined
  }
}

/**
 * 读一个元数据里的字符串字段。
 * @param record - 元数据。
 * @param key - 字段名。
 * @returns 非空字符串，或 `undefined`。
 */
function stringField(record: AgentMetadata | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Paseo 问答请求里的问题（Paseo 问题卡读的 `input.questions`：Claude 的 `AskUserQuestion`、Codex 的
 * `request_user_input` 都是这个形状）。读不出问题时给一个只收自由文本的问题，免得请求答不了。
 * @param request - Paseo 问答请求。
 * @returns 契约问题；问题号取原生的 `id`，没有就用 `header` 或问题全文。
 */
export function paseoQuestions(request: AgentPermissionRequest): PermissionQuestion[] {
  const raw = request.input?.['questions']
  const questions: PermissionQuestion[] = []
  const used = new Set<string>()
  if (Array.isArray(raw)) {
    for (const [index, entry] of raw.entries()) {
      if (entry === null || typeof entry !== 'object') continue
      const item = entry as AgentMetadata
      const question = stringField(item, 'question') ?? stringField(item, 'header')
      if (question === undefined) continue
      const header = stringField(item, 'header')
      let id = stringField(item, 'id') ?? header ?? question
      if (used.has(id)) id = `${id}#${String(index + 1)}`
      used.add(id)
      const options = Array.isArray(item['options'])
        ? item['options'].flatMap((option): PermissionQuestion['options'] => {
          if (option === null || typeof option !== 'object') return []
          const label = stringField(option as AgentMetadata, 'label')
          const description = stringField(option as AgentMetadata, 'description')
          return label === undefined ? [] : [{ label, ...(description === undefined ? {} : { description }) }]
        })
        : []
      const detail = stringField(item, 'detail')
      questions.push({
        id,
        question,
        ...(header === undefined ? {} : { header }),
        ...(detail === undefined ? {} : { detail }),
        options,
        multiSelect: item['multiSelect'] === true,
      })
    }
  }
  if (questions.length > 0) return questions
  return [{ id: 'answer', question: request.description ?? request.title ?? request.name, options: [], multiSelect: false }]
}

/**
 * 契约答案 → 交给 Paseo 适配器的结构化答案：只留请求里问到的问题，每个答案原样拷出选中的选项（按选择顺序）与
 * 补充文字，两者不合并、不拼成展示文字（选项文字或补充文字里有逗号也不会混淆）。
 * @param questions - 请求里的问题。
 * @param answers - 以问题号为键的契约答案。
 * @returns 以问题号为键的结构化答案。
 */
export function structuredAnswers(
  questions: readonly PermissionQuestion[],
  answers: Readonly<Record<string, PermissionAnswer>>,
): Record<string, PermissionAnswer> {
  const result: Record<string, PermissionAnswer> = {}
  for (const question of questions) {
    const answer = answers[question.id]
    if (answer === undefined) continue
    result[question.id] = { selected: [...answer.selected], ...(answer.custom === undefined ? {} : { custom: answer.custom }) }
  }
  return result
}

/**
 * 一个 Paseo `AgentSession` 包成的契约会话。子类覆写受保护的方法改变映射：工具名与参数怎么取、
 * 权限选项怎么从原生选项翻、插话走什么通道、回合用量要不要补 `_meta` 里的字段、取消要等什么。
 */
export class PaseoBrainSession implements BrainProviderSession {
  /** 提供方。 */
  protected readonly impl: ImplId
  /** 能力声明。 */
  protected readonly meta: Meta
  /** 被包住的 Paseo 会话。 */
  protected readonly paseo: AgentSession
  private readonly blobs: BrainBlobReader
  private readonly createdAt = new Date().toISOString()
  private readonly listeners = new Set<(event: BrainEvent) => void>()
  private readonly unsubscribe: () => void
  private activeTurn: TurnId | undefined
  private readonly endedTurns: TurnId[] = []
  private readonly turnWaiters = new Map<TurnId, (() => void)[]>()
  /** 父会话每个回合还开着的条目（按回合归属，收尾一个回合只动它自己的）。 */
  private readonly openItems = new Map<TurnId, OpenItems>()
  /** 每个子 agent 还没收尾的那条消息。 */
  private readonly openChildMessages = new Map<ChildId, ItemId>()
  private readonly calls = new Map<string, CallState>()
  private readonly permissions = new Map<PermissionRequestId, PendingPermission>()
  private readonly children = new Map<string, ChildState>()
  /** 上一次报出的模式状态（模式号与模式表）；Paseo 同一状态报两遍（切换成功、CLI 的确认）只报一次。 */
  private reportedMode: string | undefined
  private exited = false
  private closing: Promise<void> | undefined

  /**
   * @param init - 提供方、能力声明、已初始化的 Paseo 会话与图片字节来源。
   */
  constructor(init: PaseoBrainSessionInit) {
    this.impl = init.impl
    this.meta = init.meta
    this.paseo = init.session
    this.blobs = init.blobs
    this.unsubscribe = init.session.subscribe((event) => { this.onPaseoEvent(event) })
  }

  /** @inheritdoc */
  get id(): string | null {
    return this.paseo.id
  }

  /** 正在跑的回合。 */
  protected get currentTurn(): TurnId | undefined {
    return this.activeTurn
  }

  /** @inheritdoc */
  subscribe(listener: (event: BrainEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 发出一个契约事件（子类注入 `_meta` 扩展翻出的事件也走这里）。
   * @param event - 事件。
   */
  protected emit(event: BrainEvent): void {
    const decorated = this.decorate(event)
    for (const listener of [...this.listeners]) listener(decorated)
  }

  /**
   * 发出前最后改一次事件（子类补 `_meta` 里的用量等）；默认原样。
   * @param event - 映射好的事件。
   * @returns 要发出的事件。
   */
  protected decorate(event: BrainEvent): BrainEvent {
    return event
  }

  /**
   * 工具调用的名字；默认取 Paseo 的 `name`。
   * @param item - Paseo 工具条目。
   * @returns 工具名。
   */
  protected toolName(item: ToolCallTimelineItem): string {
    return item.name
  }

  /**
   * 工具调用的参数；默认取提供方在 `metadata.rawInput` 给的原始入参，没有就从详情推。
   * @param item - Paseo 工具条目。
   * @returns JSON 参数。
   */
  protected toolArgs(item: ToolCallTimelineItem): JsonValue {
    const raw = item.metadata?.['rawInput']
    return raw === undefined ? argsFromDetail(item.detail) : toJsonValue(raw)
  }

  /**
   * 工具调用的结果；默认取 `metadata.rawOutput`，没有就从详情推，失败时给错误。
   * @param item - 结束的 Paseo 工具条目。
   * @returns JSON 结果。
   */
  protected toolResult(item: ToolCallTimelineItem): JsonValue {
    if (item.status === 'failed') return toJsonValue(item.error)
    const raw = item.metadata?.['rawOutput']
    return raw === undefined ? resultFromDetail(item.detail) : toJsonValue(raw)
  }

  /**
   * 权限请求的参数：提供方给的入参，没有就从详情推。
   * @param request - Paseo 权限请求。
   * @returns JSON 参数。
   */
  protected permissionArgs(request: AgentPermissionRequest): JsonValue {
    if (request.input !== undefined) return toJsonValue(request.input)
    return request.detail === undefined ? null : argsFromDetail(request.detail)
  }

  /**
   * 权限请求的工具名；默认取 Paseo 的 `name`。
   * @param request - Paseo 权限请求。
   * @returns 工具名。
   */
  protected permissionTool(request: AgentPermissionRequest): string {
    return request.name
  }

  /**
   * 权限请求来自哪个子 agent；默认看不出（父会话自己的）。子类从原生字段里读。
   * @param _request - Paseo 权限请求。
   * @returns 子 agent 号。
   */
  protected permissionChildId(_request: AgentPermissionRequest): ChildId | undefined {
    return undefined
  }

  /**
   * 问答请求里的问题；默认读 Paseo 问题卡的 `input.questions`（{@link paseoQuestions}）。原生请求是别的形状的
   * 提供方（例如 ACP 的表单）在子类里读。
   * @param request - Paseo 问答请求。
   * @returns 契约问题（至少一个）。
   */
  protected permissionQuestions(request: AgentPermissionRequest): PermissionQuestion[] {
    return paseoQuestions(request)
  }

  /**
   * 一次作答交给 Paseo 适配器的 `updatedInput`。默认是原始入参加上结构化的答案：`answers` 以问题号为键，每个答案
   * 是 `{ selected, custom? }`（{@link structuredAnswers}），选中的选项与补充文字分开，不拼成展示文字。提供方的
   * 适配器要原生形状时在子类里翻（例如 ACP 的表单内容；Claude 的原生答案按问题全文给一段文字）；装不进原生形状的
   * 答案以 `invalid_input` 拒绝，请求仍待答。
   * @param request - Paseo 问答请求。
   * @param questions - 请求里的契约问题。
   * @param answers - 已核对的契约答案，以问题号为键。
   * @returns 交给 Paseo `respondToPermission` 的 `updatedInput`。
   */
  protected permissionAnswerInput(
    request: AgentPermissionRequest,
    questions: readonly PermissionQuestion[],
    answers: Readonly<Record<string, PermissionAnswer>>,
  ): AgentMetadata {
    return { ...request.input, answers: structuredAnswers(questions, answers) }
  }

  /**
   * 把 Paseo 的答复动作翻成契约选项。有原生动作时：允许类 → `allow_once`，拒绝类 → `deny_once`；没有动作时
   * （Claude、Codex 的普通工具审批与提问都不给动作）给一个一次性允许（问答请求是"作答"），对应 Paseo 的
   * `{ behavior: 'allow' }`。永久类策略不进第一版可见选项。之后统一补上一次性拒绝与取消。
   * @param request - Paseo 权限请求。
   * @returns 选项号 → 契约效果与 Paseo 答复。
   */
  protected permissionOptions(request: AgentPermissionRequest): { option: PermissionOption; response: AgentPermissionResponse }[] {
    const actions = request.actions ?? []
    if (actions.length === 0) {
      const label = request.kind === 'question' ? 'Answer' : 'Allow once'
      return [{ option: { id: ALLOW_OPTION_ID, label, effect: 'allow_once' }, response: { behavior: 'allow' } }]
    }
    return actions.map(action => ({
      option: { id: action.id, label: action.label, effect: action.behavior === 'allow' ? 'allow_once' as const : 'deny_once' as const },
      response: action.behavior === 'allow'
        ? { behavior: 'allow' as const, selectedActionId: action.id }
        : { behavior: 'deny' as const, selectedActionId: action.id },
    }))
  }

  /**
   * 回合用量；默认映射 Paseo 的回合用量。
   * @param _turnId - 回合号。
   * @param usage - Paseo 回合用量。
   * @returns 契约用量。
   */
  protected turnUsage(_turnId: TurnId, usage: AgentUsage | undefined): Usage {
    return mapPaseoUsage(usage)
  }

  /**
   * 提供方子 agent 结束时报的用量；默认报不出。
   * @param _childId - 子 agent 号。
   * @returns 用量。
   */
  protected childUsage(_childId: ChildId): Usage {
    return {}
  }

  /**
   * 原生模型号 → 契约里的模型名（`session.model_changed`、`setModel` 的核对）；默认原样。
   * @param native - Paseo `AgentRuntimeInfo.model`。
   * @returns 模型名。
   */
  protected modelName(native: string): string {
    return native
  }

  /**
   * 契约里的模型名 → 交给 Paseo `setModel` 的原生模型号；默认原样。
   * @param model - 模型名。
   * @returns 原生模型号。
   */
  protected nativeModel(model: string): Promise<string> {
    return Promise.resolve(model)
  }

  /**
   * 一次 `setMode` 的生效时机（Paseo 没有回 "applies next turn" 提示时）；默认立刻。
   * @param _modeId - 所选模式。
   * @returns 生效时机。
   */
  protected modeAppliesAt(_modeId: string): ModeChange['appliesAt'] {
    return 'now'
  }

  /**
   * 送达 `next_step`：默认走 Paseo 的 `steerActiveTurn`，没有就做不到。
   * @param prompt - 插话内容。
   * @param turnId - 正在跑的回合。
   * @returns 送达结果。
   */
  protected async steer(prompt: AgentPromptContentBlock[], turnId: TurnId): Promise<DeliverResult> {
    if (this.paseo.steerActiveTurn === undefined) return 'unsupported'
    const result = await this.paseo.steerActiveTurn(prompt, { expectedTurnId: turnId })
    return result.status === 'accepted' ? 'accepted' : 'unavailable'
  }

  /**
   * 中断正在跑的回合；默认 Paseo 的 `interrupt()`：照 Paseo 的约定，它完成即表示调用之前的前台回合不会再跑
   * （提供方自己撤回没读走的插话）。协议上中断只是通知的提供方（ACP）在子类里再等回合真正收尾。
   * @param _options - 取消原因与是否保留队列。
   * @param _captured - 调用时在跑的回合。
   */
  protected async interruptTurn(_options: CancelOptions, _captured: TurnId | undefined): Promise<void> {
    await this.paseo.interrupt()
  }

  /**
   * 等一个回合结束（终止事件、CLI 退出或会话关闭）；已经结束的立刻完成。
   * @param turnId - 回合号。
   * @returns 结束后完成。
   */
  protected whenTurnEnds(turnId: TurnId): Promise<void> {
    if (this.turnEnded(turnId) || this.exited || this.closing !== undefined) return Promise.resolve()
    return new Promise((resolve) => {
      const waiters = this.turnWaiters.get(turnId) ?? []
      waiters.push(resolve)
      this.turnWaiters.set(turnId, waiters)
    })
  }

  private turnEnded(turnId: TurnId): boolean {
    return this.endedTurns.includes(turnId)
  }

  /**
   * 提供方自己开始的回合（没有 `startTurn`：例如后台子 agent 的结果叫醒了 CLI）：报 `turn.started`，之后没带回合号的
   * 条目都归它。已经有回合在跑或这个回合已结束时不报。
   * @param turnId - 回合号。
   */
  protected beginProviderTurn(turnId: TurnId): void {
    if (this.activeTurn !== undefined || this.turnEnded(turnId) || this.closing !== undefined) return
    this.activeTurn = turnId
    this.emit({ kind: 'turn.started', turnId })
  }

  /**
   * 收尾提供方报的一个回合（终止事件照常只收尾父会话自己的条目）。
   * @param event - 终止事件。
   */
  protected finishTurn(event: TurnTerminal): void {
    if (this.closing !== undefined) return
    this.endTurn(event)
  }

  private onPaseoEvent(event: AgentStreamEvent): void {
    if (this.closing !== undefined) return
    switch (event.type) {
      case 'turn_started': {
        const turnId = TurnId(event.turnId ?? `turn-${randomUUID()}`)
        if (this.turnEnded(turnId)) return
        this.activeTurn = turnId
        this.emit({ kind: 'turn.started', turnId })
        return
      }
      case 'turn_completed': {
        const turnId = this.turnOf(event.turnId)
        if (turnId === undefined) return
        this.endTurn({ kind: 'turn.completed', turnId, usage: this.turnUsage(turnId, event.usage) })
        return
      }
      case 'turn_canceled': {
        const turnId = this.turnOf(event.turnId)
        if (turnId === undefined) return
        this.endTurn({ kind: 'turn.interrupted', turnId, reason: event.reason, ...(event.usage === undefined ? {} : { usage: this.turnUsage(turnId, event.usage) }) })
        return
      }
      case 'turn_failed':
        this.onTurnFailed(event)
        return
      case 'timeline': {
        const turnId = this.turnOf(event.turnId)
        // 父会话的条目只属于一个回合，且只在那个回合里出现：没有回合的（回显、回合外的提示）与已收尾回合晚到的不进契约。
        if (turnId !== undefined && !this.turnEnded(turnId)) this.onTimeline(event.item, turnId, undefined)
        return
      }
      case 'permission_requested':
        this.onPermissionRequested(event.request, event.turnId)
        return
      case 'permission_resolved':
        this.onPermissionResolved(event.requestId, event.resolution, event.turnId)
        return
      case 'usage_updated': {
        const usage = mapPaseoUsage(event.usage)
        if (Object.keys(usage).length === 0) return
        const turnId = this.turnOf(event.turnId)
        this.emit({ kind: 'usage.update', ...(turnId === undefined ? {} : { turnId }), usage })
        return
      }
      case 'provider_subagent':
        this.onProviderSubagent(event.event)
        return
      case 'mode_changed': {
        // Paseo 报的是模式状态（切换成功时一次、CLI 确认时再一次）；契约报的是变化，状态没变就不再报。
        const availableModes = event.availableModes.map(toBrainMode)
        const state = JSON.stringify([event.currentModeId, availableModes])
        if (state === this.reportedMode) return
        this.reportedMode = state
        this.emit({ kind: 'session.mode_changed', modeId: event.currentModeId, availableModes })
        return
      }
      case 'model_changed': {
        const model = event.runtimeInfo.model
        if (typeof model === 'string' && model !== '') this.emit({ kind: 'session.model_changed', model: this.modelName(model) })
        return
      }
      case 'thread_started':
      case 'thinking_option_changed':
      case 'attention_required':
        // 会话号、思考档位、注意力提醒是 Paseo 界面的事；契约不收。
        return
    }
  }

  private turnOf(turnId: string | undefined): TurnId | undefined {
    return turnId === undefined ? this.activeTurn : TurnId(turnId)
  }

  private onTurnFailed(event: Extract<AgentStreamEvent, { type: 'turn_failed' }>): void {
    const { category, retryable } = classifyFailure(event.error, event.code)
    if (event.turnId === undefined && this.activeTurn === undefined) {
      // Paseo 约定：没有回合号的 turn_failed 报的是 CLI 在两回合之间退出（Claude 的写法，ACP 原地补齐）。
      if (this.exited) return
      this.exited = true
      this.emit({ kind: 'session.exited', category: 'process_exit', message: event.error })
      this.releaseTurnWaiters()
      return
    }
    const turnId = this.turnOf(event.turnId)
    if (turnId === undefined) return
    this.endTurn({
      kind: 'turn.failed',
      turnId,
      ...(event.usage === undefined ? {} : { usage: this.turnUsage(turnId, event.usage) }),
      category,
      message: event.error,
      retryable,
      ...(event.code === undefined ? {} : { code: event.code }),
      ...(event.diagnostic === undefined ? {} : { diagnostic: event.diagnostic }),
    })
  }

  /**
   * 收尾一个回合：只结束父会话自己在这一回合的条目（子 agent 的调用跨回合照常进行），发终止事件。同一回合只收尾一次。
   * @param event - 终止事件。
   */
  private endTurn(event: TurnTerminal): void {
    if (this.turnEnded(event.turnId)) return
    this.endedTurns.push(event.turnId)
    if (this.endedTurns.length > ENDED_TURN_MEMORY) this.endedTurns.shift()
    this.closeOpenItems(event.turnId)
    for (const [callId, call] of this.calls) {
      if (call.completed || call.childId !== undefined || call.turnId !== event.turnId) continue
      // 父回合结束而它自己的工具没报结束（取消、失败）：补一条未成功的结束，保持每个开始都有结束。
      call.completed = true
      this.emit({ kind: 'item.tool_call.completed', turnId: event.turnId, callId: CallId(callId), result: null, ok: false })
    }
    if (this.activeTurn === event.turnId) this.activeTurn = undefined
    this.emit(event)
    const waiters = this.turnWaiters.get(event.turnId) ?? []
    this.turnWaiters.delete(event.turnId)
    for (const resolve of waiters) resolve()
  }

  /**
   * 收尾父会话在一个回合里还开着的消息（它转去调工具或回合结束时）；别的回合的条目不动。
   * @param turnId - 回合号。
   */
  private closeOpenItems(turnId: TurnId): void {
    const open = this.openItems.get(turnId)
    if (open === undefined) return
    this.openItems.delete(turnId)
    if (open.message !== undefined) this.emit({ kind: 'item.message', turnId, itemId: open.message, delta: '', final: true })
  }

  /**
   * 一个时间线条目：父会话的带回合号，子 agent 的带 `childId` 与开它的父回合（知道时）。
   * @param item - Paseo 条目。
   * @param turnId - 所属回合。
   * @param childId - 子 agent。
   */
  private onTimeline(item: AgentTimelineItem, turnId: TurnId | undefined, childId: ChildId | undefined): void {
    const owner = { ...(turnId === undefined ? {} : { turnId }), ...(childId === undefined ? {} : { childId }) }
    switch (item.type) {
      case 'assistant_message': {
        // 父会话的消息记在它的回合名下，子 agent 的各记各的；换了消息号就先收尾同一归属的上一条。
        const parent = childId === undefined && turnId !== undefined ? this.turnItems(turnId) : undefined
        const open = childId === undefined ? parent?.message : this.openChildMessages.get(childId)
        const itemId = ItemId(item.messageId ?? open ?? `message-${randomUUID()}`)
        if (open !== undefined && open !== itemId) this.emit({ kind: 'item.message', ...owner, itemId: open, delta: '', final: true })
        if (childId !== undefined) {
          this.openChildMessages.set(childId, itemId)
        } else if (parent !== undefined) {
          parent.message = itemId
          delete parent.reasoning
        }
        this.emit({ kind: 'item.message', ...owner, itemId, delta: item.text, final: false })
        return
      }
      case 'reasoning': {
        if (childId !== undefined || turnId === undefined) {
          if (childId !== undefined) this.closeChildMessage(childId, turnId)
          this.emit({ kind: 'item.reasoning', ...owner, itemId: ItemId(`reasoning-${randomUUID()}`), summary: item.text })
          return
        }
        // 父会话同一段思考共用一个条目号（按回合记）。
        const parent = this.turnItems(turnId)
        parent.reasoning ??= ItemId(`reasoning-${randomUUID()}`)
        this.emit({ kind: 'item.reasoning', ...owner, itemId: parent.reasoning, summary: item.text })
        return
      }
      case 'tool_call':
        if (childId !== undefined) this.closeChildMessage(childId, turnId)
        else if (turnId !== undefined) this.closeOpenItems(turnId)
        this.onToolCall(item, turnId, childId)
        return
      case 'compaction':
        if (item.status === 'completed' && childId === undefined) {
          this.emit({ kind: 'session.compacted', ...(turnId === undefined ? {} : { turnId }), ...(item.preTokens === undefined ? {} : { preTokens: item.preTokens }) })
        }
        return
      case 'user_message':
      case 'todo':
      case 'error':
      case 'notification':
      case 'plugin':
        // 用户输入回显、待办、提示与插件条目是 Paseo 时间线的展示；失败另经 turn_failed 报。
        return
    }
  }

  /**
   * 父会话在一个回合里开着的条目（没有就记一份新的）。
   * @param turnId - 回合号。
   * @returns 这个回合的条目。
   */
  private turnItems(turnId: TurnId): OpenItems {
    let items = this.openItems.get(turnId)
    if (items === undefined) {
      items = {}
      this.openItems.set(turnId, items)
    }
    return items
  }

  /**
   * 收尾一个子 agent 还开着的消息（它转去调工具、思考或结束时）。
   * @param childId - 子 agent。
   * @param turnId - 开它的父回合。
   */
  private closeChildMessage(childId: ChildId, turnId: TurnId | undefined): void {
    const open = this.openChildMessages.get(childId)
    if (open === undefined) return
    this.openChildMessages.delete(childId)
    this.emit({ kind: 'item.message', ...(turnId === undefined ? {} : { turnId }), itemId: open, delta: '', final: true, childId })
  }

  private onToolCall(item: ToolCallTimelineItem, turnId: TurnId | undefined, childId: ChildId | undefined): void {
    const callId = CallId(item.callId)
    let call = this.calls.get(item.callId)
    if (call === undefined) {
      call = { turnId, childId, completed: false }
      this.calls.set(item.callId, call)
      const detail = mapPaseoToolDetail(item.detail)
      this.emit({
        kind: 'item.tool_call.started',
        ...(turnId === undefined ? {} : { turnId }),
        callId,
        tool: this.toolName(item),
        args: this.toolArgs(item),
        native: true,
        ...(detail === undefined ? {} : { detail }),
        ...(childId === undefined ? {} : { childId }),
      })
    }
    if (item.status === 'running' || call.completed) return
    call.completed = true
    // 结束按调用开始时的归属报：子 agent 的调用在父回合结束后完成也照实送达。
    this.emit({
      kind: 'item.tool_call.completed',
      ...(call.turnId === undefined ? {} : { turnId: call.turnId }),
      callId,
      result: this.toolResult(item),
      ok: item.status === 'completed',
      ...(call.childId === undefined ? {} : { childId: call.childId }),
    })
  }

  private onPermissionRequested(request: AgentPermissionRequest, rawTurnId: string | undefined): void {
    const childId = this.permissionChildId(request)
    const raw = rawTurnId === undefined ? undefined : TurnId(rawTurnId)
    const turnId = childId === undefined ? this.turnOf(rawTurnId) : this.children.get(childId)?.turnId ?? raw
    if (turnId === undefined && childId === undefined) {
      // 父会话在回合之外发来的请求没有主人能对应的回合：拒绝，免得原生请求一直挂着。
      void this.paseo.respondToPermission(request.id, { behavior: 'deny', message: 'no turn is running for this permission request' }).catch(() => undefined)
      return
    }
    const mapped = this.permissionOptions(request)
    const responses = new Map(mapped.map(entry => [entry.option.id, entry.response]))
    const options = mapped.map(entry => entry.option)
    if (!options.some(option => option.effect === 'deny_once')) {
      options.push({ id: DENY_OPTION_ID, label: request.kind === 'question' ? 'Decline' : 'Deny', effect: 'deny_once' })
      responses.set(DENY_OPTION_ID, { behavior: 'deny' })
    }
    if (!options.some(option => option.effect === 'cancel')) {
      options.push({ id: CANCEL_OPTION_ID, label: 'Cancel', effect: 'cancel' })
      responses.set(CANCEL_OPTION_ID, { behavior: 'deny', interrupt: true })
    }
    const questions = request.kind === 'question' ? this.permissionQuestions(request) : undefined
    const requestId = PermissionRequestId(request.id)
    this.permissions.set(requestId, { turnId, childId, request, options, responses, questions })
    const detail = mapPaseoToolDetail(request.detail)
    this.emit({
      kind: 'permission.request',
      ...(turnId === undefined ? {} : { turnId }),
      requestId,
      category: request.kind,
      tool: this.permissionTool(request),
      args: this.permissionArgs(request),
      ...(request.title === undefined ? {} : { title: request.title }),
      ...(request.description === undefined ? {} : { description: request.description }),
      ...(detail === undefined ? {} : { detail }),
      ...(questions === undefined ? {} : { questions }),
      options,
      ...(childId === undefined ? {} : { childId }),
    })
  }

  private onPermissionResolved(rawRequestId: string, resolution: AgentPermissionResponse, rawTurnId: string | undefined): void {
    const requestId = PermissionRequestId(rawRequestId)
    const pending = this.permissions.get(requestId)
    if (pending === undefined) return
    this.permissions.delete(requestId)
    // Paseo 自己撤回的请求（回合结束、中断）没有经过答复：记成取消。
    const chosen = pending.chosen ?? (resolution.behavior === 'allow'
      ? pending.options.find(option => option.effect.startsWith('allow'))
      : pending.options.find(option => option.effect === 'cancel'))
    const turnId = pending.turnId ?? (pending.childId === undefined ? this.turnOf(rawTurnId) : undefined)
    this.emit({
      kind: 'permission.resolved',
      ...(turnId === undefined ? {} : { turnId }),
      requestId,
      optionId: chosen?.id ?? CANCEL_OPTION_ID,
      effect: chosen?.effect ?? 'cancel',
    })
  }

  private onProviderSubagent(event: ProviderSubagentInputEvent): void {
    const childId = ChildId(event.id)
    switch (event.type) {
      case 'upsert': {
        const stopReason = childStopReason(event.status)
        const known = this.children.get(event.id)
        if (known === undefined || (!known.running && event.status === 'running')) {
          // 新的子 agent，或已报结束的又在跑（Paseo：任务是会话级的，续接后可以再次宣布）——开（或重开）它。
          const state: ChildState = { running: true, turnId: known?.turnId ?? this.activeTurn }
          this.children.set(event.id, state)
          this.emit({
            kind: 'child.started',
            childId,
            childKind: 'native-child',
            label: event.title ?? event.description ?? event.id,
            provider: this.impl,
            ...(typeof event.parentSubagentId === 'string' ? { parentChildId: ChildId(event.parentSubagentId) } : {}),
            ...(state.turnId === undefined ? {} : { turnId: state.turnId }),
          })
        }
        const child = this.children.get(event.id)
        if (stopReason !== undefined && child?.running === true) {
          child.running = false
          this.closeChildMessage(childId, child.turnId)
          this.emit({ kind: 'child.ended', childId, stopReason, usage: this.childUsage(childId) })
        }
        return
      }
      case 'timeline': {
        const child = this.children.get(event.id)
        // 没宣布过的子 agent 不造条目（Paseo："A task that was never declared gets no descriptor"）。
        if (child === undefined) return
        this.onTimeline(event.item, child.turnId, childId)
        return
      }
      case 'remove':
        return
    }
  }

  /**
   * 回合输入 → Paseo 提示词（图片从 blob 存储取回）。
   * @param input - 回合输入。
   * @returns Paseo 提示词内容块。
   */
  protected prompt(input: TurnInput): Promise<AgentPromptContentBlock[]> {
    return toPaseoPrompt(input, this.blobs)
  }

  /** @inheritdoc */
  async startTurn(input: TurnInput): Promise<{ turnId: TurnId }> {
    if (this.closing !== undefined || this.exited) {
      throw new BrainError('unavailable', 'brain.session_closed', `${this.impl} session has no live CLI; open or resume a session`)
    }
    const { turnId } = await this.paseo.startTurn(await this.prompt(input))
    return { turnId: TurnId(turnId) }
  }

  /** @inheritdoc */
  async deliver(input: TurnInput, options: DeliverOptions): Promise<DeliverResult> {
    if (options.semantics === 'next_step') {
      if (!this.meta.delivery.nextStep) return 'unsupported'
      const turnId = this.activeTurn
      if (turnId === undefined || (options.expectedTurnId !== undefined && options.expectedTurnId !== turnId)) return 'unavailable'
      return this.steer(await this.prompt(input), turnId)
    }
    if (!this.meta.delivery.nextTurn) return 'unsupported'
    // 没有原生的下一回合队列：空闲且要求叫醒时开一个回合；在跑或不叫醒时交回调用方在回合边界补。
    if (this.activeTurn !== undefined || !options.wake) return 'unavailable'
    await this.startTurn(input)
    return 'accepted'
  }

  /**
   * 停掉正在跑的回合。原生中断一经确认，调用时在跑的那个回合就不会再跑：它还没报终止的，这里补报
   * `turn.interrupted`（Paseo：管理器在确认的中断后收尾捕获的回合，即使没有终止事件）。只收尾调用时捕获的
   * 回合，之后新开的回合不受这次取消影响。
   * @param options - 原因与是否保留队列。
   */
  async cancel(options: CancelOptions): Promise<void> {
    if (this.closing !== undefined) return
    const captured = this.activeTurn
    await this.interruptTurn(options, captured)
    if (captured !== undefined && !this.turnEnded(captured) && this.live()) {
      this.endTurn({ kind: 'turn.interrupted', turnId: captured, reason: `cancelled (${options.reason})` })
    }
  }

  /**
   * 会话还活着：没在关、CLI 没退出。
   * @returns 是否。
   */
  private live(): boolean {
    return this.closing === undefined && !this.exited
  }

  private releaseTurnWaiters(): void {
    for (const [turnId, waiters] of this.turnWaiters) {
      this.turnWaiters.delete(turnId)
      for (const resolve of waiters) resolve()
    }
  }

  /** @inheritdoc */
  async respondToPermission(requestId: PermissionRequestId, response: PermissionResponse): Promise<void> {
    const pending = this.permissions.get(requestId)
    if (pending === undefined) {
      throw new BrainError('not_found', 'brain.permission_unknown', `${this.impl} session has no pending permission request ${requestId}`)
    }
    // 对不上的选项号按 deny_once 应用。
    const option = pending.options.find(candidate => candidate.id === response.optionId)
      ?? pending.options.find(candidate => candidate.effect === 'deny_once')
    if (option === undefined) throw new BrainError('internal', 'brain.permission_options', `${this.impl} permission request ${requestId} lost its deny option`)
    const base = pending.responses.get(option.id) ?? { behavior: 'deny' as const }
    let reply: AgentPermissionResponse = base
    if (base.behavior === 'allow' && pending.questions !== undefined) {
      if (response.answers === undefined) {
        throw new BrainError('invalid_input', 'brain.permission_answers_invalid', `${this.impl} question ${requestId} needs answers to allow it`)
      }
      // 问答答复以结构交给提供方的适配器（选项与补充文字分开）；装不进原生形状时在这里拒绝，请求仍待答。
      reply = { ...base, updatedInput: this.permissionAnswerInput(pending.request, pending.questions, response.answers) }
    } else if (base.behavior === 'deny' && response.reason !== undefined) {
      reply = { ...base, message: response.reason }
    }
    // Paseo 在答复里同步报 permission_resolved：先记下所选，失败（例如原生答案不合规）再撤回。
    pending.chosen = option
    try {
      await this.paseo.respondToPermission(requestId, reply)
    } catch (error) {
      if (this.permissions.get(requestId) === pending) delete pending.chosen
      throw error
    }
  }

  /** @inheritdoc */
  persistence(): ResumeHandle | null {
    const handle = this.paseo.describePersistence()
    if (handle === null) return null
    // Paseo 把整份会话配置放进 metadata（含 MCP 头里的令牌）；灵鲸续接时给完整的新代配置，句柄里不带它。
    return {
      provider: this.impl,
      sessionRef: handle.sessionId,
      createdAt: this.createdAt,
      ...(handle.nativeHandle === undefined ? {} : { nativeHandle: handle.nativeHandle }),
    }
  }

  /** @inheritdoc */
  async canStopRuntime(): Promise<boolean> {
    for (const child of this.children.values()) if (child.running) return false
    if (this.paseo.canStopRuntime === undefined) return true
    return this.paseo.canStopRuntime()
  }

  /**
   * 换模型：Paseo 有的提供方对不认识的模型只记日志不换，所以换完核对运行时信息，没换成就以 `invalid_input` 拒绝。
   * @param model - 模型名。
   */
  async setModel(model: string): Promise<void> {
    if (!this.meta.modelSwitch || this.paseo.setModel === undefined) {
      throw new BrainError('unavailable', 'brain.model_switch_unsupported', `${this.impl} sessions cannot switch models`)
    }
    const native = await this.nativeModel(model)
    await this.paseo.setModel(native)
    const current = (await this.paseo.getRuntimeInfo()).model
    if (current !== native) {
      throw new BrainError('invalid_input', 'brain.model_unknown', `${this.impl} did not switch to model ${model}; it is not one of the models this session offers`)
    }
  }

  /** @inheritdoc */
  async availableModes(): Promise<BrainMode[]> {
    if (!this.meta.modeSwitch) return []
    return (await this.paseo.getAvailableModes()).map(toBrainMode)
  }

  /** @inheritdoc */
  async currentMode(): Promise<string | null> {
    if (!this.meta.modeSwitch) return null
    return this.paseo.getCurrentMode()
  }

  /**
   * 切换模式：先核对模式号在这个会话的模式表里，再交给 Paseo；提供方回了 "applies next turn" 提示就报下一回合生效。
   * @param modeId - 模式号。
   * @returns 所选模式与生效时机。
   */
  async setMode(modeId: string): Promise<ModeChange> {
    if (!this.meta.modeSwitch) {
      throw new BrainError('unavailable', 'brain.mode_switch_unsupported', `${this.impl} sessions have no modes`)
    }
    const available = await this.paseo.getAvailableModes()
    if (!available.some(mode => mode.id === modeId)) {
      const known = available.map(mode => mode.id).join(', ') || '(none)'
      throw new BrainError('invalid_input', 'brain.mode_unknown', `${this.impl} session has no mode ${JSON.stringify(modeId)}; available: ${known}`)
    }
    const notice = await this.paseo.setMode(modeId)
    const nextTurn = notice !== undefined && notice.message === MODE_APPLIES_NEXT_TURN_NOTICE.message
    return { modeId, appliesAt: nextTurn ? 'next_turn' : this.modeAppliesAt(modeId) }
  }

  /** @inheritdoc */
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.unsubscribe()
      this.listeners.clear()
      this.releaseTurnWaiters()
      await this.paseo.close()
    })()
    return this.closing
  }
}

/**
 * Paseo 模式 → 契约模式。
 * @param mode - Paseo 模式。
 * @returns 契约模式。
 */
function toBrainMode(mode: AgentMode): BrainMode {
  return { id: mode.id, label: mode.label, ...(mode.description === undefined ? {} : { description: mode.description }) }
}
