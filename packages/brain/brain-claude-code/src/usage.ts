/**
 * 回合用量：两本账对账。
 *
 * 1. **帧账**：assistant 帧按 message id 记一次（各计数取最大值），流式 message_start／message_delta 记在途消费；它给出归属
 *    （主线程推理次数、前台子 agent）并在进程崩掉、没有 result 时仍能结算已观测的消费。
 * 2. **累计账**：result 的 `modelUsage` 是原生会话的累计值，含后台子 agent 与所有 sidechain；与基线的差是这一回合的完整消费。
 *    基线随续接句柄走（CLI 续接时从转录恢复累计），没有基线的首个 result 只定基线不报差。
 *
 * 结算时回合 token 取"累计差"（只要它已知且每项都不小于帧账），否则取帧账；成本只来自累计差。`num_turns` 不可信（被
 * maxTurns 拦下的请求也计数），推理次数只数主线程的真实响应帧，合成帧（`<synthetic>`）与带 error 的占位帧不算。
 * @module @liwa/brain-claude-code/usage
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { BrainError, type ResumeHandle, type TurnId, type Usage } from '@liwa/brain'

/** 四项 token 计数。 */
export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** 计量基线：上一次 result 时原生会话的累计成本与累计 token；缺项表示未知。 */
export interface UsageBaseline {
  costUsd?: number
  tokens?: TokenTotals
}

interface FrameUsage {
  input: number
  output: number
  cacheRead: number | undefined
  cacheWrite: number | undefined
  isInference: boolean
}

interface RawUsage {
  input_tokens?: number | null
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

const MAIN_LANE = 'main'
const SYNTHETIC_MODEL = '<synthetic>'
const COST_KEY = 'cumulativeCostUsd'
const TOKENS_KEY = 'cumulativeTokens'
const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

/** 一个会话的计量账本。 */
export class ClaudeUsage {
  private readonly results = new Set<string>()
  private readonly turns = new Map<TurnId, Usage>()
  private readonly frames = new Map<TurnId, Map<string, FrameUsage>>()
  private readonly openStreams = new Map<string, string>()
  private costBaseline: number | undefined
  private tokenBaseline: TokenTotals | undefined
  private isCostAnchored = true

  /**
   * @param restored - 已结算的累计基线：新会话给零基线；续接时来自句柄；没有记录时 undefined（首个 result 只定基线）。
   */
  constructor(restored: UsageBaseline | undefined) {
    this.costBaseline = restored?.costUsd
    this.tokenBaseline = restored?.tokens === undefined ? undefined : { ...restored.tokens }
  }

  /** 新 Query（切模型、中断后重启）：CLI 从转录恢复累计值，基线保留；若累计反而变小，下一个 result 只重定基线。 */
  reset(): void {
    this.openStreams.clear()
    this.isCostAnchored = false
  }

  /**
   * 当前基线，续接句柄带上它作下一代的基线。
   * @returns 累计成本与累计 token；未知的项缺省。
   */
  baseline(): UsageBaseline {
    return {
      ...(this.costBaseline === undefined ? {} : { costUsd: this.costBaseline }),
      ...(this.tokenBaseline === undefined ? {} : { tokens: { ...this.tokenBaseline } }),
    }
  }

  /**
   * 收集 SDK 帧。
   * @param message - 原生 SDK 帧。
   * @param turnId - 已知父回合；未知时的帧没有归属，不记（它的消费经累计差进入下一个结算的回合）。
   */
  observe(message: SDKMessage, turnId: TurnId | undefined): void {
    if (message.type === 'conversation_reset') {
      this.costBaseline = 0
      this.tokenBaseline = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      this.isCostAnchored = true
      this.openStreams.clear()
      return
    }
    if (turnId === undefined) return
    if (message.type === 'assistant') {
      const isRealResponse = message.message.model !== SYNTHETIC_MODEL && message.error === undefined
      if (isRealResponse) this.recordFrame(turnId, message.parent_tool_use_id, message.message.id, message.message.usage)
      return
    }
    if (message.type === 'stream_event') {
      this.recordStreamEvent(turnId, message.parent_tool_use_id, message.event)
      return
    }
    if (message.type !== 'result' || this.results.has(message.uuid)) return
    this.results.add(message.uuid)
    // SDK 的崩溃/启动失败可给零快照；这不是消费为零，也不能改写基线。已观测的帧留给 take 结算。
    if (isZeroCrashSnapshot(message)) return
    const frames = this.frames.get(turnId)
    this.frames.delete(turnId)
    const cost = this.settleCost(message.total_cost_usd)
    const delta = this.settleTokens(cumulativeTotals(message.modelUsage))
    const observed = frames === undefined ? undefined : sumFrames(frames)
    const tokens = chooseTokens(delta, observed)
    this.turns.set(turnId, {
      ...(tokens === undefined ? {} : { tokens }),
      inferences: countInferences(frames),
      ...(cost === undefined ? {} : { providerReportedCostUsd: cost }),
    })
  }

  /**
   * 取走回合结算：有 result 的回合按对账结果，没有 result 的回合按已观测的帧（没有成本）；什么都没观测到就留空。
   * @param turnId - 回合。
   * @returns 可结算用量。
   */
  take(turnId: TurnId): Usage | undefined {
    const settled = this.turns.get(turnId)
    this.turns.delete(turnId)
    const frames = this.frames.get(turnId)
    this.frames.delete(turnId)
    if (settled !== undefined) return settled
    if (frames === undefined) return undefined
    return { tokens: sumFrames(frames), inferences: countInferences(frames) }
  }

  private recordFrame(turnId: TurnId, parentToolUseId: string | null, messageId: string, usage: RawUsage): void {
    let turnFrames = this.frames.get(turnId)
    if (turnFrames === undefined) {
      turnFrames = new Map()
      this.frames.set(turnId, turnFrames)
    }
    const previous = turnFrames.get(messageId)
    turnFrames.set(messageId, {
      input: Math.max(previous?.input ?? 0, usage.input_tokens ?? 0),
      output: Math.max(previous?.output ?? 0, usage.output_tokens),
      cacheRead: maxKnown(previous?.cacheRead, usage.cache_read_input_tokens),
      cacheWrite: maxKnown(previous?.cacheWrite, usage.cache_creation_input_tokens),
      isInference: parentToolUseId === null,
    })
  }

  private recordStreamEvent(turnId: TurnId, parentToolUseId: string | null, event: Extract<SDKMessage, { type: 'stream_event' }>['event']): void {
    const lane = parentToolUseId ?? MAIN_LANE
    if (event.type === 'message_start') {
      this.openStreams.set(lane, event.message.id)
      this.recordFrame(turnId, parentToolUseId, event.message.id, event.message.usage)
      return
    }
    if (event.type === 'message_delta') {
      const messageId = this.openStreams.get(lane)
      if (messageId === undefined) return
      this.recordFrame(turnId, parentToolUseId, messageId, event.usage)
      return
    }
    if (event.type === 'message_stop') this.openStreams.delete(lane)
  }

  private settleCost(cumulative: number): number | undefined {
    if (!Number.isFinite(cumulative)) throw regressed()
    const previous = this.costBaseline
    const isRegression = previous !== undefined && cumulative < previous
    if (isRegression && this.isCostAnchored) throw regressed()
    this.costBaseline = cumulative
    this.isCostAnchored = true
    if (previous === undefined || isRegression) return undefined
    return cumulative - previous
  }

  private settleTokens(cumulative: TokenTotals | undefined): TokenTotals | undefined {
    if (cumulative === undefined) return undefined
    const previous = this.tokenBaseline
    this.tokenBaseline = { ...cumulative }
    // 累计倒退说明原生会话被重置或换了来源，这一回合的差不可知，只重定基线。
    if (previous === undefined || TOKEN_KEYS.some(key => cumulative[key] < previous[key])) return undefined
    return {
      input: cumulative.input - previous.input, output: cumulative.output - previous.output,
      cacheRead: cumulative.cacheRead - previous.cacheRead, cacheWrite: cumulative.cacheWrite - previous.cacheWrite,
    }
  }
}

/**
 * 续接句柄里上一代记下的基线。
 * @param metadata - 句柄的 metadata。
 * @returns 基线；缺的项不填。
 */
export function restoredBaseline(metadata: ResumeHandle['metadata']): UsageBaseline {
  const cost = metadata?.[COST_KEY]
  const tokens = metadata?.[TOKENS_KEY]
  const hasCost = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
  const restoredTokens = tokenTotalsOf(tokens)
  return { ...(hasCost ? { costUsd: cost } : {}), ...(restoredTokens === undefined ? {} : { tokens: restoredTokens }) }
}

/**
 * 把基线写进续接句柄的 metadata。
 * @param baseline - 当前基线。
 * @returns metadata 片段；基线全未知时为空对象。
 */
export function baselineMetadata(baseline: UsageBaseline): NonNullable<ResumeHandle['metadata']> {
  return {
    ...(baseline.costUsd === undefined ? {} : { [COST_KEY]: baseline.costUsd }),
    ...(baseline.tokens === undefined ? {} : { [TOKENS_KEY]: { ...baseline.tokens } }),
  }
}

function tokenTotalsOf(value: unknown): TokenTotals | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const isCount = (count: unknown): count is number => typeof count === 'number' && Number.isInteger(count) && count >= 0
  if (!TOKEN_KEYS.every(key => isCount(record[key]))) return undefined
  return { input: record['input'] as number, output: record['output'] as number, cacheRead: record['cacheRead'] as number, cacheWrite: record['cacheWrite'] as number }
}

/** 没有任何模型分项的 result（中止在首个请求前、CLI 自己处理的命令）不说明累计，不动基线。 */
function cumulativeTotals(modelUsage: Extract<SDKMessage, { type: 'result' }>['modelUsage']): TokenTotals | undefined {
  const models = Object.values(modelUsage)
  if (models.length === 0) return undefined
  const totals: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const model of models) {
    totals.input += model.inputTokens
    totals.output += model.outputTokens
    totals.cacheRead += model.cacheReadInputTokens
    totals.cacheWrite += model.cacheCreationInputTokens
  }
  return totals
}

function chooseTokens(delta: TokenTotals | undefined, observed: NonNullable<Usage['tokens']> | undefined): Usage['tokens'] {
  if (delta === undefined) return observed
  if (observed === undefined) return delta
  const coversObserved = delta.input >= observed.input && delta.output >= observed.output
    && delta.cacheRead >= (observed.cacheRead ?? 0) && delta.cacheWrite >= (observed.cacheWrite ?? 0)
  return coversObserved ? delta : observed
}

function regressed(): BrainError {
  return new BrainError('unavailable', 'brain.claude_usage_regressed', 'Claude cumulative cost is invalid or regressed inside one query; usage is incomplete')
}

function maxKnown(previous: number | undefined, current: number | null | undefined): number | undefined {
  if (typeof current !== 'number') return previous
  if (previous === undefined) return current
  return Math.max(previous, current)
}

function sumFrames(frames: Map<string, FrameUsage>): NonNullable<Usage['tokens']> {
  const tokens: NonNullable<Usage['tokens']> = { input: 0, output: 0 }
  for (const frame of frames.values()) {
    tokens.input += frame.input
    tokens.output += frame.output
    if (frame.cacheRead !== undefined) tokens.cacheRead = (tokens.cacheRead ?? 0) + frame.cacheRead
    if (frame.cacheWrite !== undefined) tokens.cacheWrite = (tokens.cacheWrite ?? 0) + frame.cacheWrite
  }
  return tokens
}

function countInferences(frames: Map<string, FrameUsage> | undefined): number {
  if (frames === undefined) return 0
  let count = 0
  for (const frame of frames.values()) {
    if (frame.isInference) count += 1
  }
  return count
}

function isZeroCrashSnapshot(message: Extract<SDKMessage, { type: 'result' }>): boolean {
  const isStartupShapedFailure = message.subtype === 'error_during_execution'
    && message.total_cost_usd === 0 && message.num_turns === 0
  if (!isStartupShapedFailure) return false
  const counters = [
    message.usage.input_tokens, message.usage.output_tokens,
    message.usage.cache_read_input_tokens, message.usage.cache_creation_input_tokens,
  ]
  if (!counters.every(value => value === 0)) return false
  return Object.values(message.modelUsage).every(value => [
    value.inputTokens, value.outputTokens, value.cacheReadInputTokens,
    value.cacheCreationInputTokens, value.costUSD, value.webSearchRequests,
  ].every(count => count === 0))
}
