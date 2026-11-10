import { describe, expect, it } from 'vitest'
import { TurnId } from '@liwa/brain'
import type { ModelUsage, SDKAssistantMessage, SDKPartialAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeUsage, type UsageBaseline } from '../src/usage.ts'

const FRESH: UsageBaseline = { costUsd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }

type StreamEvent = SDKPartialAssistantMessage['event']
type FailedSubtype = 'error_during_execution' | 'error_max_turns'
interface Counts { input: number; output: number; cacheRead?: number; cacheWrite?: number }

const resultUsage: SDKResultMessage['usage'] = {
  input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }, service_tier: 'standard',
  cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }, inference_geo: 'not_available',
  iterations: [], speed: 'standard', fallback_credit: { status: { type: 'not_applied', reason: 'not_enabled' } },
  output_tokens_details: { thinking_tokens: 0 },
}

const modelTotals = (input: number, output: number, cacheRead: number, cacheWrite: number, costUsd: number): ModelUsage => ({
  inputTokens: input, outputTokens: output, cacheReadInputTokens: cacheRead, cacheCreationInputTokens: cacheWrite, costUSD: costUsd,
  contextWindow: 200000, maxOutputTokens: 10000, webSearchRequests: 0,
})

const result = (
  id: string, costUsd: number, numTurns = 2, modelUsage: Record<string, ModelUsage> = { mock: modelTotals(1, 1, 0, 0, costUsd) },
): SDKResultMessage => ({
  type: 'result', subtype: 'success', session_id: 'session', uuid: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
  duration_ms: 1, duration_api_ms: 1, is_error: false, num_turns: numTurns, total_cost_usd: costUsd,
  stop_reason: 'end_turn', result: 'ok', permission_denials: [], usage: resultUsage, modelUsage,
})

const failed = (id: string, costUsd: number, numTurns: number, subtype: FailedSubtype, errors: string[]): SDKResultMessage => ({
  ...result(id, costUsd, numTurns), subtype, is_error: true, errors,
})

const assistantMessage = (id: string, counts: Counts): SDKAssistantMessage['message'] => ({
  id: `msg_${id}`, type: 'message', role: 'assistant', model: 'mock', content: [{ type: 'text', text: 'hi' }],
  stop_reason: 'end_turn', stop_sequence: null,
  usage: {
    input_tokens: counts.input, output_tokens: counts.output,
    cache_read_input_tokens: counts.cacheRead ?? null, cache_creation_input_tokens: counts.cacheWrite ?? null,
  },
} as SDKAssistantMessage['message'])

const frame = (id: string, counts: Counts, parent: string | null = null, model = 'mock'): SDKAssistantMessage => ({
  type: 'assistant', uuid: `10000000-0000-4000-8000-${id.padStart(12, '0')}`, session_id: 'session', parent_tool_use_id: parent,
  message: { ...assistantMessage(id, counts), model },
})

const partial = (event: StreamEvent, parent: string | null = null): SDKPartialAssistantMessage => ({
  type: 'stream_event', uuid: '20000000-0000-4000-8000-000000000001', session_id: 'session', parent_tool_use_id: parent, event,
})
const messageStart = (id: string, counts: Counts): StreamEvent => ({ type: 'message_start', message: assistantMessage(id, counts) })
const messageDelta = (outputTokens: number): StreamEvent => ({ type: 'message_delta', usage: { output_tokens: outputTokens } } as StreamEvent)
const messageStop: StreamEvent = { type: 'message_stop' }
const textDelta: StreamEvent = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }

describe('turn usage from assistant frames', () => {
  it('sums the frames of a turn once per message id, counting only main-thread frames as inferences', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(frame('a', { input: 100, output: 20, cacheRead: 10, cacheWrite: 20 }), TurnId('one'))
    usage.observe(frame('a', { input: 100, output: 50, cacheRead: 10, cacheWrite: 20 }), TurnId('one'))
    usage.observe(frame('c', { input: 30, output: 5 }, 'tool-1'), TurnId('one'))
    usage.observe(result('1', 1, 5), TurnId('one'))
    expect(usage.take(TurnId('one'))).toEqual({
      tokens: { input: 130, output: 55, cacheRead: 10, cacheWrite: 20 }, inferences: 1, providerReportedCostUsd: 1,
    })
    expect(usage.take(TurnId('one'))).toBeUndefined()
  })

  it('does not trust num_turns: a request blocked by the turn limit is not an inference', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(frame('a', { input: 10, output: 1 }), TurnId('one'))
    usage.observe(frame('b', { input: 10, output: 1 }), TurnId('one'))
    usage.observe(failed('1', 0.5, 3, 'error_max_turns', ['Reached maximum number of turns (2)']), TurnId('one'))
    expect(usage.take(TurnId('one'))?.inferences).toBe(2)
  })

  it('reports the cost as the cumulative delta and keeps the baseline across query restarts of one session', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(frame('a', { input: 10, output: 1 }), TurnId('one'))
    usage.observe(result('1', 1), TurnId('one'))
    expect(usage.take(TurnId('one'))?.providerReportedCostUsd).toBe(1)
    usage.reset()
    usage.observe(frame('b', { input: 20, output: 2 }), TurnId('two'))
    usage.observe(result('2', 1.5), TurnId('two'))
    expect(usage.take(TurnId('two'))).toEqual({ tokens: { input: 20, output: 2 }, inferences: 1, providerReportedCostUsd: 0.5 })
    expect(usage.baseline()).toEqual({ costUsd: 1.5, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } })
  })

  it('starts from the restored baseline on resume and omits the cost while the baseline is unknown', () => {
    const restored = new ClaudeUsage({ ...FRESH, costUsd: 0.8 })
    restored.observe(frame('a', { input: 10, output: 1 }), TurnId('one'))
    restored.observe(result('1', 1), TurnId('one'))
    expect(restored.take(TurnId('one'))?.providerReportedCostUsd).toBeCloseTo(0.2)
    const unknown = new ClaudeUsage(undefined)
    expect(unknown.baseline()).toEqual({})
    unknown.observe(frame('a', { input: 10, output: 1 }), TurnId('one'))
    unknown.observe(result('1', 1), TurnId('one'))
    expect(unknown.take(TurnId('one'))).toEqual({ tokens: { input: 10, output: 1 }, inferences: 1 })
    unknown.observe(frame('b', { input: 10, output: 1 }), TurnId('two'))
    unknown.observe(result('2', 1.3), TurnId('two'))
    expect(unknown.take(TurnId('two'))?.providerReportedCostUsd).toBeCloseTo(0.3)
  })

  it('takes in-flight consumption from stream events so an interrupted turn still reports what it spent', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(partial(messageStart('s', { input: 40, output: 0, cacheRead: 4, cacheWrite: 2 })), TurnId('one'))
    usage.observe(partial(messageDelta(7)), TurnId('one'))
    usage.observe(failed('1', 0.2, 1, 'error_during_execution', ['Request aborted']), TurnId('one'))
    expect(usage.take(TurnId('one'))).toEqual({
      tokens: { input: 40, output: 7, cacheRead: 4, cacheWrite: 2 }, inferences: 1, providerReportedCostUsd: 0.2,
    })
  })

  it('settles a frameless turn from the cumulative delta, ignores frames outside a turn and repeated results', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(frame('x', { input: 10, output: 1 }), undefined)
    const settled = result('1', 0.1)
    usage.observe(settled, TurnId('one'))
    usage.observe(settled, TurnId('one'))
    expect(usage.take(TurnId('one'))).toEqual({ tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, inferences: 0, providerReportedCostUsd: 0.1 })
    usage.observe(settled, TurnId('two'))
    expect(usage.take(TurnId('two'))).toBeUndefined()
  })

  it('re-anchors without a cost when the cumulative regresses after a restart, but rejects a regression inside one query', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(result('1', 1), TurnId('one'))
    usage.reset()
    usage.observe(result('2', 0.4), TurnId('two'))
    expect(usage.take(TurnId('two'))).toEqual({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, inferences: 0 })
    expect(() => { usage.observe(result('3', 0.1), TurnId('three')) }).toThrow('regressed')
  })

  it('adds cache counts across frames and follows stream lanes through message_stop', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(frame('a', { input: 10, output: 1, cacheRead: 3, cacheWrite: 2 }), TurnId('one'))
    usage.observe(frame('b', { input: 10, output: 1, cacheRead: 4, cacheWrite: 1 }), TurnId('one'))
    usage.observe(partial(messageDelta(99)), TurnId('one'))
    usage.observe(partial(messageStart('s', { input: 5, output: 0 })), TurnId('one'))
    usage.observe(partial(messageStop), TurnId('one'))
    usage.observe(partial(messageDelta(99)), TurnId('one'))
    usage.observe(result('1', 0.3), TurnId('one'))
    expect(usage.take(TurnId('one'))).toEqual({
      tokens: { input: 25, output: 2, cacheRead: 7, cacheWrite: 3 }, inferences: 3, providerReportedCostUsd: 0.3,
    })
  })

  it('settles a startup failure that did spend as a normal failed result', () => {
    const usage = new ClaudeUsage(FRESH)
    const spent = failed('1', 0, 0, 'error_during_execution', ['late failure'])
    const zeroUsage = { ...spent.usage, input_tokens: 0, output_tokens: 0 }
    const zeroModel: ModelUsage = {
      inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0,
      contextWindow: 200000, maxOutputTokens: 10000, webSearchRequests: 0,
    }
    usage.observe({ ...spent, usage: zeroUsage, modelUsage: { mock: zeroModel } }, TurnId('zero'))
    expect(usage.take(TurnId('zero'))).toBeUndefined()
    usage.observe({ ...spent, uuid: '00000000-0000-4000-8000-000000000099', usage: zeroUsage, modelUsage: { mock: { ...zeroModel, inputTokens: 7 } } }, TurnId('spent'))
    expect(usage.take(TurnId('spent'))).toEqual({ tokens: { input: 7, output: 0, cacheRead: 0, cacheWrite: 0 }, inferences: 0, providerReportedCostUsd: 0 })
    usage.observe({ ...spent, uuid: '00000000-0000-4000-8000-000000000098', usage: { ...zeroUsage, input_tokens: 3 }, modelUsage: {} }, TurnId('counted'))
    expect(usage.take(TurnId('counted'))).toEqual({ inferences: 0, providerReportedCostUsd: 0 })
  })

  it('ignores content stream events and rejects a non-finite cumulative', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(partial(textDelta), TurnId('one'))
    usage.observe(result('1', 0.1), TurnId('one'))
    expect(usage.take(TurnId('one'))).toEqual({ tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, inferences: 0, providerReportedCostUsd: 0.1 })
    expect(() => { usage.observe(result('2', Number.NaN), TurnId('two')) }).toThrow('regressed')
  })

  it('zeroes the baseline on a native clear and treats zero crash snapshots as unknown', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(result('1', 1), TurnId('one'))
    usage.observe({
      type: 'conversation_reset', uuid: '00000000-0000-4000-8000-000000000001',
      new_conversation_id: '00000000-0000-4000-8000-000000000002', session_id: 'session',
    }, undefined)
    usage.observe(result('2', 0.2), TurnId('two'))
    expect(usage.take(TurnId('two'))?.providerReportedCostUsd).toBeCloseTo(0.2)
    const zero = failed('3', 0, 0, 'error_during_execution', ['startup failure'])
    usage.observe({ ...zero, usage: { ...zero.usage, input_tokens: 0, output_tokens: 0 }, modelUsage: {} }, TurnId('zero'))
    expect(usage.take(TurnId('zero'))).toBeUndefined()
    expect(usage.baseline().costUsd).toBeCloseTo(0.2)
  })
})

describe('reconciliation, unsettled turns and synthetic frames', () => {
  it('counts background consumption the frames never showed by reconciling with the cumulative model totals', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(frame('a', { input: 10, output: 2, cacheRead: 1, cacheWrite: 1 }), TurnId('one'))
    usage.observe(result('1', 0.5, 1, { mock: modelTotals(1000, 20, 30, 40, 0.5) }), TurnId('one'))
    expect(usage.take(TurnId('one'))).toEqual({ tokens: { input: 1000, output: 20, cacheRead: 30, cacheWrite: 40 }, inferences: 1, providerReportedCostUsd: 0.5 })
    expect(usage.baseline()).toEqual({ costUsd: 0.5, tokens: { input: 1000, output: 20, cacheRead: 30, cacheWrite: 40 } })
    usage.observe(frame('b', { input: 10, output: 2 }), TurnId('two'))
    usage.observe(result('2', 0.6, 1, { mock: modelTotals(1005, 21, 30, 40, 0.55), helper: modelTotals(100, 10, 0, 0, 0.05) }), TurnId('two'))
    const second = usage.take(TurnId('two'))
    expect(second).toMatchObject({ tokens: { input: 105, output: 11, cacheRead: 0, cacheWrite: 0 }, inferences: 1 })
    expect(second?.providerReportedCostUsd).toBeCloseTo(0.1)
  })

  it('starts the token delta from the baseline carried by the resume handle and falls back to frames without one', () => {
    const restored = new ClaudeUsage({ costUsd: 0.5, tokens: { input: 1000, output: 20, cacheRead: 30, cacheWrite: 40 } })
    restored.observe(frame('a', { input: 10, output: 2 }), TurnId('one'))
    restored.observe(result('1', 0.6, 1, { mock: modelTotals(1050, 25, 30, 40, 0.6) }), TurnId('one'))
    const first = restored.take(TurnId('one'))
    expect(first).toMatchObject({ tokens: { input: 50, output: 5, cacheRead: 0, cacheWrite: 0 }, inferences: 1 })
    expect(first?.providerReportedCostUsd).toBeCloseTo(0.1)
    const unknown = new ClaudeUsage(undefined)
    unknown.observe(frame('a', { input: 10, output: 2 }), TurnId('one'))
    unknown.observe(result('1', 0.6, 1, { mock: modelTotals(1050, 25, 30, 40, 0.6) }), TurnId('one'))
    expect(unknown.take(TurnId('one'))).toEqual({ tokens: { input: 10, output: 2 }, inferences: 1 })
    expect(unknown.baseline()).toEqual({ costUsd: 0.6, tokens: { input: 1050, output: 25, cacheRead: 30, cacheWrite: 40 } })
  })

  it('re-anchors the token baseline when the cumulative regresses and trusts the frames for that turn', () => {
    const usage = new ClaudeUsage({ ...FRESH, tokens: { input: 500, output: 50, cacheRead: 0, cacheWrite: 0 } })
    usage.observe(frame('a', { input: 10, output: 2 }), TurnId('one'))
    usage.observe(result('1', 0.1, 1, { mock: modelTotals(100, 10, 0, 0, 0.1) }), TurnId('one'))
    expect(usage.take(TurnId('one'))).toEqual({ tokens: { input: 10, output: 2 }, inferences: 1, providerReportedCostUsd: 0.1 })
    expect(usage.baseline().tokens).toEqual({ input: 100, output: 10, cacheRead: 0, cacheWrite: 0 })
  })

  it('settles a turn that never got a result from the frames it did observe, with no cost', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(frame('a', { input: 10, output: 2, cacheRead: 3, cacheWrite: 4 }), TurnId('one'))
    usage.observe(partial(messageStart('s', { input: 5, output: 0 })), TurnId('one'))
    expect(usage.take(TurnId('one'))).toEqual({ tokens: { input: 15, output: 2, cacheRead: 3, cacheWrite: 4 }, inferences: 2 })
    expect(usage.take(TurnId('one'))).toBeUndefined()
    usage.observe(frame('b', { input: 10, output: 2 }), TurnId('two'))
    const zero = failed('3', 0, 0, 'error_during_execution', ['startup failure'])
    usage.observe({ ...zero, usage: { ...zero.usage, input_tokens: 0, output_tokens: 0 }, modelUsage: {} }, TurnId('two'))
    expect(usage.take(TurnId('two'))).toEqual({ tokens: { input: 10, output: 2 }, inferences: 1 })
  })

  it('ignores synthetic and errored assistant frames when counting inferences and tokens', () => {
    const usage = new ClaudeUsage(FRESH)
    usage.observe(frame('a', { input: 10, output: 2 }), TurnId('one'))
    usage.observe(frame('s', { input: 0, output: 0 }, null, '<synthetic>'), TurnId('one'))
    const errored = frame('e', { input: 3, output: 0 })
    usage.observe({ ...errored, error: 'authentication_failed' as const }, TurnId('one'))
    usage.observe(result('1', 0.1), TurnId('one'))
    expect(usage.take(TurnId('one'))).toEqual({ tokens: { input: 10, output: 2 }, inferences: 1, providerReportedCostUsd: 0.1 })
  })
})
