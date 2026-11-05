import { describe, expect, it } from 'vitest'
import {
  BrainError, ChildId, ImplId, PermissionRequestId, TurnId,
  type BlobRef, type BrainBlobReader, type BrainEvent, type Meta, type PermissionAnswer, type PermissionQuestion,
} from '@liwa/brain'
import { SCRIPTED_META, recordEvents, textInput } from '@liwa/brain-testkit'
import {
  PaseoBrainSession, classifyFailure, mapPaseoToolDetail, mapPaseoUsage, paseoLogger, paseoQuestions,
  renderLiwaBlock, structuredAnswers, toJsonValue, toPaseoPrompt, turnInputText,
} from '../src/index.ts'
import type {
  AgentMetadata, AgentMode, AgentPermissionRequest, AgentPermissionResponse, AgentPersistenceHandle, AgentPromptInput,
  AgentProviderNotice, AgentRuntimeInfo, AgentSession, AgentStreamEvent, SteerActiveTurnOptions, SteerResult,
} from '../src/paseo/agent/agent-sdk-types.ts'
import { MODE_APPLIES_NEXT_TURN_NOTICE } from '../src/paseo/agent/provider-notices.ts'

/** A Paseo session driven by the test: it records calls and lets the test push stream events. */
class FakePaseoSession implements AgentSession {
  readonly provider = 'fake'
  readonly capabilities = {
    supportsStreaming: true, supportsSessionPersistence: true, supportsDynamicModes: false, supportsMcpServers: true,
    supportsReasoningStream: true, supportsToolInvocations: true,
  }
  id: string | null = 'native-1'
  readonly prompts: AgentPromptInput[] = []
  readonly responses: { requestId: string; response: AgentPermissionResponse }[] = []
  readonly steers: SteerActiveTurnOptions[] = []
  interrupts = 0
  closed = 0
  steerResult: SteerResult = { status: 'accepted' }
  /** 中断确认时是否同时报 turn_canceled（Paseo 允许确认而不报，例如 Codex 已空闲的分支）。 */
  interruptReportsTerminal = false
  model = 'small'
  readonly models = ['small', 'large']
  mode: string | null = 'default'
  readonly modes: AgentMode[] = [{ id: 'default', label: 'Default' }, { id: 'plan', label: 'Plan', description: 'Plan first.' }]
  modeNotice: AgentProviderNotice | undefined
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>()
  private turns = 0
  private active: string | undefined

  push(event: AgentStreamEvent): void {
    for (const subscriber of [...this.subscribers]) subscriber(event)
  }
  run(): never { throw new Error('unused') }
  startTurn(prompt: AgentPromptInput): Promise<{ turnId: string }> {
    this.prompts.push(prompt)
    this.turns += 1
    const turnId = `turn-${String(this.turns)}`
    this.active = turnId
    this.push({ type: 'turn_started', provider: 'fake', turnId })
    return Promise.resolve({ turnId })
  }
  steerActiveTurn(_prompt: AgentPromptInput, options: SteerActiveTurnOptions): Promise<SteerResult> {
    this.steers.push(options)
    return Promise.resolve(this.steerResult)
  }
  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback)
    return () => { this.subscribers.delete(callback) }
  }
  async *streamHistory(): AsyncGenerator<AgentStreamEvent> { /* no history */ }
  getRuntimeInfo(): Promise<AgentRuntimeInfo> { return Promise.resolve({ provider: 'fake', sessionId: this.id, model: this.model, modeId: this.mode }) }
  getAvailableModes(): Promise<AgentMode[]> { return Promise.resolve([...this.modes]) }
  getCurrentMode(): Promise<string | null> { return Promise.resolve(this.mode) }
  setMode(modeId: string): Promise<AgentProviderNotice | undefined> {
    this.mode = modeId
    this.push({ type: 'mode_changed', provider: 'fake', currentModeId: modeId, availableModes: [...this.modes] })
    return Promise.resolve(this.modeNotice)
  }
  setModel(modelId: string | null): Promise<void> {
    // 像 Paseo 的 ACP 客户端：不认识的模型只记日志、不换。
    if (modelId !== null && this.models.includes(modelId)) {
      this.model = modelId
      this.push({ type: 'model_changed', provider: 'fake', runtimeInfo: { provider: 'fake', sessionId: this.id, model: modelId } })
    }
    return Promise.resolve()
  }
  getPendingPermissions(): never[] { return [] }
  respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void> {
    this.responses.push({ requestId, response })
    return Promise.resolve()
  }
  describePersistence(): AgentPersistenceHandle | null {
    return this.id === null ? null : { provider: 'fake', sessionId: this.id, nativeHandle: 'native-handle', metadata: { secret: 'token' } }
  }
  interrupt(): Promise<void> {
    this.interrupts += 1
    const active = this.active
    this.active = undefined
    if (this.interruptReportsTerminal && active !== undefined) this.push({ type: 'turn_canceled', provider: 'fake', reason: 'Interrupted', turnId: active })
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.closed += 1
    return Promise.resolve()
  }
}

const META: Meta = { ...SCRIPTED_META, transport: 'acp' }

/** 图片字节来源：只认测试放进去的那一个。 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const PNG_REF: BlobRef = { blob: 'b'.repeat(64), bytes: PNG.byteLength, mime: 'image/png' }
const BLOBS: BrainBlobReader = {
  readBlob: ref => (ref.blob === PNG_REF.blob ? Promise.resolve(PNG) : Promise.reject(new BrainError('not_found', 'brain.blob_missing', 'missing'))),
}

/** 子 agent 的权限请求按原生元数据里的 `childId` 认的会话（deepseek 一类提供方的写法）。 */
class ChildAwareSession extends PaseoBrainSession {
  protected override permissionChildId(request: AgentPermissionRequest): ChildId | undefined {
    const childId = request.metadata?.['childId']
    return typeof childId === 'string' ? ChildId(childId) : undefined
  }
}

function open(meta: Meta = META): { fake: FakePaseoSession; session: PaseoBrainSession; events: readonly BrainEvent[] } {
  const fake = new FakePaseoSession()
  const session = new ChildAwareSession({ impl: ImplId('fake'), meta, session: fake, blobs: BLOBS })
  const recorder = recordEvents(session)
  return { fake, session, events: recorder.events }
}

describe('PaseoBrainSession', () => {
  it('maps a streamed turn: message items finalize, tool calls pair, usage maps', async () => {
    const { fake, session, events } = open()
    const { turnId } = await session.startTurn(textInput('hi'))
    fake.push({ type: 'timeline', provider: 'fake', turnId, item: { type: 'reasoning', text: 'thinking' } })
    fake.push({ type: 'timeline', provider: 'fake', turnId, item: { type: 'assistant_message', text: 'Hel', messageId: 'm1' } })
    fake.push({ type: 'timeline', provider: 'fake', turnId, item: { type: 'assistant_message', text: 'lo', messageId: 'm1' } })
    fake.push({ type: 'timeline', provider: 'fake', turnId, item: { type: 'tool_call', callId: 'c1', name: 'read', status: 'running', error: null, detail: { type: 'read', filePath: '/a' }, metadata: { rawInput: { path: '/a' } } } })
    fake.push({ type: 'timeline', provider: 'fake', turnId, item: { type: 'tool_call', callId: 'c1', name: 'read', status: 'completed', error: null, detail: { type: 'read', filePath: '/a', content: 'x' } } })
    fake.push({ type: 'timeline', provider: 'fake', turnId, item: { type: 'tool_call', callId: 'c2', name: 'shell', status: 'running', error: null, detail: { type: 'shell', command: 'ls' } } })
    fake.push({ type: 'timeline', provider: 'fake', turnId, item: { type: 'user_message', text: 'echo' } })
    fake.push({ type: 'usage_updated', provider: 'fake', usage: { contextWindowMaxTokens: 100, contextWindowUsedTokens: 40 }, turnId })
    fake.push({ type: 'turn_completed', provider: 'fake', turnId, usage: { inputTokens: 10, outputTokens: 3, cachedInputTokens: 2, totalCostUsd: 0.5 } })
    expect(events.map(event => event.kind)).toEqual([
      'turn.started', 'item.reasoning', 'item.message', 'item.message', 'item.message', 'item.tool_call.started',
      'item.tool_call.completed', 'item.tool_call.started', 'usage.update', 'item.tool_call.completed', 'turn.completed',
    ])
    expect(events[4]).toMatchObject({ kind: 'item.message', itemId: 'm1', delta: '', final: true })
    expect(events[5]).toMatchObject({ tool: 'read', args: { path: '/a' }, detail: { type: 'read', path: '/a' } })
    expect(events[6]).toMatchObject({ callId: 'c1', ok: true, result: 'x' })
    expect(events[9]).toMatchObject({ callId: 'c2', ok: false, result: null })
    expect(events[10]).toEqual({
      kind: 'turn.completed', turnId,
      usage: { tokens: { input: 10, output: 3, cacheRead: 2 }, providerReportedCostUsd: 0.5 },
    })
    expect(fake.prompts).toEqual([[{ type: 'text', text: 'hi' }]])
  })

  it('translates permission actions, answers unknown options as deny, and reports the resolution', async () => {
    const { fake, session, events } = open()
    const { turnId } = await session.startTurn(textInput('go'))
    fake.push({
      type: 'permission_requested', provider: 'fake', turnId,
      request: { id: 'p1', provider: 'fake', name: 'shell', kind: 'tool', detail: { type: 'shell', command: 'ls' }, actions: [{ id: 'yes', label: 'Yes', behavior: 'allow' }] },
    })
    const request = events.find(event => event.kind === 'permission.request')
    expect(request).toMatchObject({ tool: 'shell', category: 'tool', args: { command: 'ls' } })
    expect(request?.kind === 'permission.request' ? request.options.map(option => option.effect) : []).toEqual(['allow_once', 'deny_once', 'cancel'])
    await session.respondToPermission(PermissionRequestId('p1'), { optionId: 'nope', reason: 'not now' })
    expect(fake.responses).toEqual([{ requestId: 'p1', response: { behavior: 'deny', message: 'not now' } }])
    fake.push({ type: 'permission_resolved', provider: 'fake', requestId: 'p1', resolution: { behavior: 'deny' }, turnId })
    expect(events.at(-1)).toEqual({ kind: 'permission.resolved', turnId, requestId: 'p1', optionId: 'deny', effect: 'deny_once' })
    await expect(session.respondToPermission(PermissionRequestId('p1'), { optionId: 'yes' })).rejects.toBeInstanceOf(BrainError)
    fake.push({
      type: 'permission_requested', provider: 'fake', turnId,
      request: { id: 'p2', provider: 'fake', name: 'plan', kind: 'mode', actions: [{ id: 'ok', label: 'OK', behavior: 'allow' }, { id: 'no', label: 'No', behavior: 'deny' }] },
    })
    await session.respondToPermission(PermissionRequestId('p2'), { optionId: 'cancel' })
    expect(fake.responses.at(-1)).toEqual({ requestId: 'p2', response: { behavior: 'deny', interrupt: true } })
    fake.push({ type: 'permission_resolved', provider: 'fake', requestId: 'p2', resolution: { behavior: 'deny' } })
    expect(events.at(-1)).toMatchObject({ kind: 'permission.resolved', requestId: 'p2', effect: 'cancel' })
    // Paseo 自己撤回的请求（没有经过答复）记成取消。
    fake.push({ type: 'permission_requested', provider: 'fake', turnId, request: { id: 'p3', provider: 'fake', name: 'x', kind: 'other' } })
    fake.push({ type: 'permission_resolved', provider: 'fake', requestId: 'p3', resolution: { behavior: 'deny', message: 'Permission request canceled' } })
    expect(events.at(-1)).toMatchObject({ kind: 'permission.resolved', requestId: 'p3', optionId: 'cancel', effect: 'cancel' })
  })

  it('maps provider subagents to child events and a runtime exit between turns to session.exited', async () => {
    const { fake, session, events } = open()
    const { turnId } = await session.startTurn(textInput('go'))
    fake.push({ type: 'provider_subagent', provider: 'fake', event: { type: 'upsert', id: 'k1', title: 'explore', parentSubagentId: 'k0' } })
    fake.push({ type: 'provider_subagent', provider: 'fake', event: { type: 'timeline', id: 'k1', item: { type: 'assistant_message', text: 'child says' } } })
    fake.push({ type: 'provider_subagent', provider: 'fake', event: { type: 'upsert', id: 'k1', status: 'canceled' } })
    fake.push({ type: 'provider_subagent', provider: 'fake', event: { type: 'remove', id: 'k1' } })
    fake.push({ type: 'turn_failed', provider: 'fake', turnId, error: 'HTTP 401 unauthorized', code: '401' })
    fake.push({ type: 'turn_failed', provider: 'fake', error: 'ACP agent exited unexpectedly (1)' })
    expect(events.filter(event => event.kind !== 'turn.started')).toEqual([
      { kind: 'child.started', childId: 'k1', childKind: 'native-child', label: 'explore', provider: 'fake', parentChildId: 'k0', turnId },
      expect.objectContaining({ kind: 'item.message', turnId, delta: 'child says', childId: 'k1', final: false }),
      expect.objectContaining({ kind: 'item.message', turnId, delta: '', childId: 'k1', final: true }),
      { kind: 'child.ended', childId: 'k1', stopReason: 'cancelled', usage: {} },
      { kind: 'turn.failed', turnId, category: 'auth', message: 'HTTP 401 unauthorized', retryable: false, code: '401' },
      { kind: 'session.exited', category: 'process_exit', message: 'ACP agent exited unexpectedly (1)' },
    ])
    await expect(session.startTurn(textInput('again'))).rejects.toMatchObject({ code: 'brain.session_closed' })
  })

  it('answers deliver by Meta and by the running turn, cancels until the turn ends, and describes persistence', async () => {
    const { fake, session, events } = open()
    expect(await session.deliver(textInput('x'), { semantics: 'next_step', wake: false })).toBe('unavailable')
    const { turnId } = await session.startTurn(textInput('go'))
    expect(await session.deliver(textInput('x'), { semantics: 'next_step', wake: false, expectedTurnId: turnId })).toBe('accepted')
    expect(fake.steers).toEqual([{ expectedTurnId: turnId }])
    fake.steerResult = { status: 'unavailable' }
    expect(await session.deliver(textInput('x'), { semantics: 'next_step', wake: false })).toBe('unavailable')
    expect(await session.deliver(textInput('x'), { semantics: 'next_turn', wake: true })).toBe('unavailable')
    const cancelled = session.cancel({ reason: 'pause', keepQueue: false })
    await Promise.resolve()
    expect(fake.interrupts).toBe(1)
    fake.push({ type: 'turn_canceled', provider: 'fake', reason: 'Interrupted', turnId })
    await cancelled
    expect(events.at(-1)).toEqual({ kind: 'turn.interrupted', turnId, reason: 'Interrupted' })
    await session.cancel({ reason: 'pause', keepQueue: false })
    expect(fake.interrupts).toBe(2)
    expect(await session.deliver(textInput('x'), { semantics: 'next_turn', wake: true })).toBe('accepted')
    expect(session.persistence()).toMatchObject({ provider: 'fake', sessionRef: 'native-1', nativeHandle: 'native-handle' })
    expect(session.persistence()).not.toHaveProperty('metadata')
    expect(await session.canStopRuntime()).toBe(true)
    await expect(session.setModel('m')).rejects.toMatchObject({ code: 'brain.model_unknown' })
    await session.close()
    await session.close()
    expect(fake.closed).toBe(1)
    fake.id = null
    expect(session.persistence()).toBeNull()
  })

  it('reports unsupported deliveries from Meta', async () => {
    const { session } = open({ ...META, delivery: { nextStep: false, nextTurn: false, cancelKeepsQueue: false }, modelSwitch: false })
    expect(await session.deliver(textInput('x'), { semantics: 'next_step', wake: false })).toBe('unsupported')
    expect(await session.deliver(textInput('x'), { semantics: 'next_turn', wake: true })).toBe('unsupported')
  })
})

describe('PaseoBrainSession boundary behaviour (review M2–M4, M6, M7)', () => {
  it('offers allow / deny / cancel for a native request without actions and forwards the matching Paseo answers', async () => {
    const { fake, session, events } = open()
    const { turnId } = await session.startTurn(textInput('go'))
    fake.push({ type: 'permission_requested', provider: 'fake', turnId, request: { id: 'p1', provider: 'fake', name: 'Bash', kind: 'tool', input: { command: 'ls' } } })
    const request = events.find(event => event.kind === 'permission.request')
    expect(request?.kind === 'permission.request' ? request.options : []).toEqual([
      { id: 'allow', label: 'Allow once', effect: 'allow_once' },
      { id: 'deny', label: 'Deny', effect: 'deny_once' },
      { id: 'cancel', label: 'Cancel', effect: 'cancel' },
    ])
    await session.respondToPermission(PermissionRequestId('p1'), { optionId: 'allow' })
    expect(fake.responses.at(-1)).toEqual({ requestId: 'p1', response: { behavior: 'allow' } })
    fake.push({ type: 'permission_resolved', provider: 'fake', requestId: 'p1', resolution: { behavior: 'allow' }, turnId })
    expect(events.at(-1)).toMatchObject({ kind: 'permission.resolved', optionId: 'allow', effect: 'allow_once' })
  })

  it('turns a question into typed questions and forwards the answers as structure, never as joined display text', async () => {
    const { fake, session, events } = open()
    const { turnId } = await session.startTurn(textInput('go'))
    const input = { questions: [
      { question: 'Which color?', header: 'Color', options: [{ label: 'red' }, { label: 'blue', description: 'calm' }], multiSelect: false },
      { id: 'toppings', question: 'Which toppings?', header: 'Toppings', options: [{ label: 'a' }, { label: 'b' }], multiSelect: true },
    ] }
    fake.push({ type: 'permission_requested', provider: 'fake', turnId, request: { id: 'q1', provider: 'fake', name: 'AskUserQuestion', kind: 'question', input } })
    const request = events.find(event => event.kind === 'permission.request')
    expect(request).toMatchObject({
      category: 'question',
      questions: [
        { id: 'Color', question: 'Which color?', header: 'Color', options: [{ label: 'red' }, { label: 'blue', description: 'calm' }], multiSelect: false },
        { id: 'toppings', question: 'Which toppings?', header: 'Toppings', options: [{ label: 'a' }, { label: 'b' }], multiSelect: true },
      ],
      options: [{ id: 'allow', label: 'Answer', effect: 'allow_once' }, { id: 'deny', label: 'Decline', effect: 'deny_once' }, { id: 'cancel', label: 'Cancel', effect: 'cancel' }],
    })
    // 允许一个问答却不给答案：拒绝，原生请求不动。
    await expect(session.respondToPermission(PermissionRequestId('q1'), { optionId: 'allow' })).rejects.toMatchObject({ code: 'brain.permission_answers_invalid' })
    expect(fake.responses).toEqual([])
    // 选项与补充文字分开交给适配器，带逗号的补充文字也原样。
    await session.respondToPermission(PermissionRequestId('q1'), {
      optionId: 'allow',
      answers: { Color: { selected: ['blue'], custom: 'keep, both' }, toppings: { selected: ['a', 'b'], custom: 'extra, cheese' } },
    })
    expect(fake.responses).toEqual([{ requestId: 'q1', response: {
      behavior: 'allow',
      updatedInput: { ...input, answers: { Color: { selected: ['blue'], custom: 'keep, both' }, toppings: { selected: ['a', 'b'], custom: 'extra, cheese' } } },
    } }])
  })

  it('lets a provider encode answers natively and keeps the request pending when they do not fit', async () => {
    class Native extends PaseoBrainSession {
      protected override permissionAnswerInput(
        _request: AgentPermissionRequest,
        _questions: readonly PermissionQuestion[],
        answers: Readonly<Record<string, PermissionAnswer>>,
      ): AgentMetadata {
        if (answers['q']?.custom !== undefined) throw new BrainError('invalid_input', 'brain.permission_answers_invalid', 'no free text here')
        return { native: answers['q']?.selected ?? [] }
      }
    }
    const fake = new FakePaseoSession()
    const session = new Native({ impl: ImplId('fake'), meta: META, session: fake, blobs: BLOBS })
    const { turnId } = await session.startTurn(textInput('go'))
    fake.push({ type: 'permission_requested', provider: 'fake', turnId, request: { id: 'q', provider: 'fake', name: 'ask', kind: 'question', input: { questions: [{ id: 'q', question: 'Q?', options: [{ label: 'x' }] }] } } })
    await expect(session.respondToPermission(PermissionRequestId('q'), { optionId: 'allow', answers: { q: { selected: [], custom: 'typed' } } }))
      .rejects.toMatchObject({ code: 'brain.permission_answers_invalid' })
    expect(fake.responses).toEqual([])
    await session.respondToPermission(PermissionRequestId('q'), { optionId: 'allow', answers: { q: { selected: ['x'] } } })
    expect(fake.responses).toEqual([{ requestId: 'q', response: { behavior: 'allow', updatedInput: { native: ['x'] } } }])
  })

  it('keeps background child agents on their own: parent turn end does not settle them, their output arrives later', async () => {
    const { fake, session, events } = open()
    const { turnId } = await session.startTurn(textInput('go'))
    fake.push({ type: 'timeline', provider: 'fake', turnId, item: { type: 'tool_call', callId: 'parent-call', name: 'Agent', status: 'running', error: null, detail: { type: 'sub_agent' } } })
    fake.push({ type: 'provider_subagent', provider: 'fake', event: { type: 'upsert', id: 'bg', title: 'background child', status: 'running' } })
    fake.push({ type: 'provider_subagent', provider: 'fake', event: { type: 'timeline', id: 'bg', item: { type: 'tool_call', callId: 'child-call', name: 'read', status: 'running', error: null, detail: { type: 'read', filePath: '/a' } } } })
    fake.push({ type: 'turn_completed', provider: 'fake', turnId, usage: { inputTokens: 1, outputTokens: 1 } })
    // 父回合结束只收尾父会话自己的调用。
    const settled = events.filter(event => event.kind === 'item.tool_call.completed')
    expect(settled).toEqual([expect.objectContaining({ callId: 'parent-call', ok: false, turnId })])
    // 后台子 agent 的完成、输出、结束在父回合之后照常到达，归开它的那个回合。
    fake.push({ type: 'provider_subagent', provider: 'fake', event: { type: 'timeline', id: 'bg', item: { type: 'tool_call', callId: 'child-call', name: 'read', status: 'completed', error: null, detail: { type: 'read', filePath: '/a', content: 'done' } } } })
    fake.push({ type: 'provider_subagent', provider: 'fake', event: { type: 'timeline', id: 'bg', item: { type: 'assistant_message', text: 'background result', messageId: 'bm' } } })
    fake.push({ type: 'provider_subagent', provider: 'fake', event: { type: 'upsert', id: 'bg', status: 'completed' } })
    const after = events.slice(events.findIndex(event => event.kind === 'turn.completed') + 1)
    expect(after).toEqual([
      { kind: 'item.tool_call.completed', turnId, callId: 'child-call', result: 'done', ok: true, childId: 'bg' },
      { kind: 'item.message', turnId, itemId: 'bm', delta: 'background result', final: false, childId: 'bg' },
      { kind: 'item.message', turnId, itemId: 'bm', delta: '', final: true, childId: 'bg' },
      { kind: 'child.ended', childId: 'bg', stopReason: 'completed', usage: {} },
    ])
    expect(await session.canStopRuntime()).toBe(true)
    // 状态修正：结束过的子 agent 又在跑（续接后再宣布），重开它；跑着时运行时不能回收。
    fake.push({ type: 'provider_subagent', provider: 'fake', event: { type: 'upsert', id: 'bg', status: 'running' } })
    expect(events.at(-1)).toEqual({ kind: 'child.started', childId: 'bg', childKind: 'native-child', label: 'bg', provider: 'fake', turnId })
    expect(await session.canStopRuntime()).toBe(false)
    // 子 agent 的权限请求在没有父回合时也上报，带 childId 与开它的回合。
    fake.push({ type: 'permission_requested', provider: 'fake', request: { id: 'cp', provider: 'fake', name: 'Bash', kind: 'tool', metadata: { childId: 'bg' } } })
    expect(events.at(-1)).toMatchObject({ kind: 'permission.request', requestId: 'cp', childId: 'bg', turnId })
    // 父会话自己在回合之外的请求没有回合可归，原生请求被拒掉，不挂着。
    fake.push({ type: 'permission_requested', provider: 'fake', request: { id: 'orphan', provider: 'fake', name: 'Bash', kind: 'tool' } })
    await Promise.resolve()
    expect(fake.responses.at(-1)).toMatchObject({ requestId: 'orphan', response: { behavior: 'deny' } })
    for (const event of events) expect(event.kind === 'process.exited').toBe(false)
  })

  it('settles the captured turn on an acknowledged interrupt without a terminal event, and only that turn', async () => {
    const { fake, session, events } = open()
    const first = await session.startTurn(textInput('one'))
    await session.cancel({ reason: 'preempt', keepQueue: false })
    expect(events.filter(event => event.kind === 'turn.interrupted')).toEqual([{ kind: 'turn.interrupted', turnId: first.turnId, reason: 'cancelled (preempt)' }])
    // 晚到的终止事件不重复收尾。
    fake.push({ type: 'turn_canceled', provider: 'fake', reason: 'late', turnId: first.turnId })
    expect(events.filter(event => event.kind === 'turn.interrupted')).toHaveLength(1)
    const second = await session.startTurn(textInput('two'))
    // 旧回合的晚到事件不会收尾新回合。
    fake.push({ type: 'turn_completed', provider: 'fake', turnId: first.turnId })
    fake.push({ type: 'timeline', provider: 'fake', turnId: second.turnId, item: { type: 'assistant_message', text: 'still running', messageId: 'm2' } })
    fake.push({ type: 'turn_completed', provider: 'fake', turnId: second.turnId, usage: { inputTokens: 1, outputTokens: 1 } })
    expect(events.filter(event => event.kind === 'turn.completed').map(event => event.turnId)).toEqual([second.turnId])
    // 提供方确认时自己报了终止事件：不再补报。
    fake.interruptReportsTerminal = true
    const third = await session.startTurn(textInput('three'))
    await session.cancel({ reason: 'owner', keepQueue: false })
    expect(events.filter(event => event.kind === 'turn.interrupted' && event.turnId === third.turnId)).toEqual([{ kind: 'turn.interrupted', turnId: third.turnId, reason: 'Interrupted' }])
  })

  it('keeps a new turn\'s items in that turn when an older cancel is acknowledged late (review N2)', async () => {
    // 旧回合 t1 的中断确认晚到；确认之前 t2 已经开始并在流消息。
    let acknowledge: () => void = () => undefined
    const fake = new FakePaseoSession()
    fake.interrupt = () => new Promise<void>((resolve) => { acknowledge = resolve })
    const session = new ChildAwareSession({ impl: ImplId('fake'), meta: META, session: fake, blobs: BLOBS })
    const events = recordEvents(session).events
    fake.push({ type: 'turn_started', provider: 'fake', turnId: 't1' })
    fake.push({ type: 'timeline', provider: 'fake', turnId: 't1', item: { type: 'assistant_message', text: 'old', messageId: 'm1' } })
    fake.push({ type: 'timeline', provider: 'fake', turnId: 't1', item: { type: 'reasoning', text: 'old thought' } })
    const cancelled = session.cancel({ reason: 'owner', keepQueue: false })
    fake.push({ type: 'turn_started', provider: 'fake', turnId: 't2' })
    fake.push({ type: 'timeline', provider: 'fake', turnId: 't2', item: { type: 'reasoning', text: 'new thought' } })
    fake.push({ type: 'timeline', provider: 'fake', turnId: 't2', item: { type: 'assistant_message', text: 'new turn text', messageId: 'm2' } })
    acknowledge()
    await cancelled
    // t1 晚到的条目不再进契约。
    fake.push({ type: 'timeline', provider: 'fake', turnId: 't1', item: { type: 'assistant_message', text: 'late', messageId: 'm1' } })
    fake.push({ type: 'timeline', provider: 'fake', turnId: 't2', item: { type: 'assistant_message', text: ' continued', messageId: 'm2' } })
    fake.push({ type: 'turn_completed', provider: 'fake', turnId: 't2', usage: {} })
    const items = events.filter(event => event.kind === 'item.message' || event.kind === 'item.reasoning')
    const thoughts = items.filter(event => event.kind === 'item.reasoning').map(event => [event.turnId, event.itemId])
    expect(new Set(thoughts.map(([, itemId]) => itemId)).size).toBe(2)
    expect(events.filter(event => event.kind !== 'item.reasoning')).toEqual([
      { kind: 'turn.started', turnId: 't1' },
      { kind: 'item.message', turnId: 't1', itemId: 'm1', delta: 'old', final: false },
      { kind: 'turn.started', turnId: 't2' },
      { kind: 'item.message', turnId: 't2', itemId: 'm2', delta: 'new turn text', final: false },
      { kind: 'item.message', turnId: 't1', itemId: 'm1', delta: '', final: true },
      { kind: 'turn.interrupted', turnId: 't1', reason: 'cancelled (owner)' },
      { kind: 'item.message', turnId: 't2', itemId: 'm2', delta: ' continued', final: false },
      { kind: 'item.message', turnId: 't2', itemId: 'm2', delta: '', final: true },
      { kind: 'turn.completed', turnId: 't2', usage: {} },
    ])
  })

  it('switches models only to one the session offers and reports the change', async () => {
    const { session, events } = open()
    await session.setModel('large')
    expect(events.at(-1)).toEqual({ kind: 'session.model_changed', model: 'large' })
    await expect(session.setModel('nope')).rejects.toMatchObject({ code: 'brain.model_unknown' })
    await expect(open({ ...META, modelSwitch: false }).session.setModel('large')).rejects.toMatchObject({ code: 'brain.model_switch_unsupported' })
  })

  it('lists, reads, and switches modes with their timing, and maps mode changes', async () => {
    const { fake, session, events } = open()
    expect(await session.availableModes()).toEqual([{ id: 'default', label: 'Default' }, { id: 'plan', label: 'Plan', description: 'Plan first.' }])
    expect(await session.currentMode()).toBe('default')
    expect(await session.setMode('plan')).toEqual({ modeId: 'plan', appliesAt: 'now' })
    expect(events.at(-1)).toMatchObject({ kind: 'session.mode_changed', modeId: 'plan' })
    expect(await session.currentMode()).toBe('plan')
    // CLI 对同一次切换的确认（同一状态再报一遍）不再报；模式表变了照报。
    fake.push({ type: 'mode_changed', provider: 'fake', currentModeId: 'plan', availableModes: [...fake.modes] })
    expect(events.filter(event => event.kind === 'session.mode_changed')).toHaveLength(1)
    fake.push({ type: 'mode_changed', provider: 'fake', currentModeId: 'plan', availableModes: [fake.modes[1] ?? { id: 'plan', label: 'Plan' }] })
    expect(events.filter(event => event.kind === 'session.mode_changed')).toHaveLength(2)
    fake.modeNotice = MODE_APPLIES_NEXT_TURN_NOTICE
    expect(await session.setMode('default')).toEqual({ modeId: 'default', appliesAt: 'next_turn' })
    await expect(session.setMode('bypass')).rejects.toMatchObject({ code: 'brain.mode_unknown' })
    const plain = open({ ...META, modeSwitch: false }).session
    expect(await plain.availableModes()).toEqual([])
    expect(await plain.currentMode()).toBeNull()
    await expect(plain.setMode('plan')).rejects.toMatchObject({ code: 'brain.mode_switch_unsupported' })
  })

  it('reports provider-started turns and maps every usage update', async () => {
    class Reporting extends ChildAwareSession {
      begin(turnId: string): void { this.beginProviderTurn(TurnId(turnId)) }
      finish(turnId: string): void { this.finishTurn({ kind: 'turn.completed', turnId: TurnId(turnId), usage: { inferences: 1 } }) }
    }
    const fake = new FakePaseoSession()
    const session = new Reporting({ impl: ImplId('fake'), meta: META, session: fake, blobs: BLOBS })
    const events = recordEvents(session).events
    session.begin('auto-1')
    fake.push({ type: 'timeline', provider: 'fake', item: { type: 'assistant_message', text: 'woke up', messageId: 'w' } })
    fake.push({ type: 'usage_updated', provider: 'fake', usage: { inputTokens: 4, outputTokens: 2, contextWindowMaxTokens: 10, contextWindowUsedTokens: 6 } })
    session.finish('auto-1')
    expect(events).toEqual([
      { kind: 'turn.started', turnId: 'auto-1' },
      { kind: 'item.message', turnId: 'auto-1', itemId: 'w', delta: 'woke up', final: false },
      { kind: 'usage.update', turnId: 'auto-1', usage: { tokens: { input: 4, output: 2 }, context: { used: 6, max: 10 } } },
      { kind: 'item.message', turnId: 'auto-1', itemId: 'w', delta: '', final: true },
      { kind: 'turn.completed', turnId: 'auto-1', usage: { inferences: 1 } },
    ])
  })

  it('reads Paseo question cards and copies answers by question id as structure', () => {
    expect(paseoQuestions({ id: 'x', provider: 'fake', name: 'ask', kind: 'question', title: 'Free text?' }))
      .toEqual([{ id: 'answer', question: 'Free text?', options: [], multiSelect: false }])
    const questions = [{ id: 'q', question: 'Q?', options: [], multiSelect: false }]
    expect(structuredAnswers(questions, { q: { selected: [], custom: 'typed, with a comma' }, stray: { selected: ['x'] } }))
      .toEqual({ q: { selected: [], custom: 'typed, with a comma' } })
  })
})

describe('brain-shared helpers', () => {
  it('maps usage, details, failures, and JSON values', () => {
    expect(mapPaseoUsage(undefined)).toEqual({})
    expect(mapPaseoUsage({ outputTokens: 2, contextWindowMaxTokens: 9, contextWindowUsedTokens: 3 }))
      .toEqual({ tokens: { input: 0, output: 2 }, context: { used: 3, max: 9 } })
    expect(mapPaseoToolDetail(undefined)).toBeUndefined()
    expect(mapPaseoToolDetail({ type: 'edit', filePath: '/f', unifiedDiff: 'd' })).toEqual({ type: 'edit', path: '/f', unifiedDiff: 'd' })
    expect(mapPaseoToolDetail({ type: 'write', filePath: '/f' })).toEqual({ type: 'write', path: '/f' })
    expect(mapPaseoToolDetail({ type: 'search', query: 'q' })).toEqual({ type: 'search', query: 'q' })
    expect(mapPaseoToolDetail({ type: 'fetch', url: 'u' })).toEqual({ type: 'fetch', url: 'u' })
    expect(mapPaseoToolDetail({ type: 'plan', text: 't' })).toEqual({ type: 'other' })
    expect(classifyFailure('ACP agent exited unexpectedly')).toEqual({ category: 'process_exit', retryable: true })
    expect(classifyFailure('maximum context length exceeded')).toEqual({ category: 'context_exceeded', retryable: false })
    expect(classifyFailure('insufficient balance')).toEqual({ category: 'quota', retryable: false })
    expect(classifyFailure('request timed out')).toEqual({ category: 'timeout', retryable: true })
    expect(classifyFailure('model refused')).toEqual({ category: 'refused', retryable: false })
    expect(classifyFailure('boom')).toEqual({ category: 'retryable', retryable: true })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(toJsonValue(undefined)).toBeNull()
    expect(toJsonValue(cyclic)).toBe('[unserializable]')
  })

  it('renders turn input, liwa blocks with the closing tag escaped, and images from the blob store', async () => {
    expect(renderLiwaBlock('前缀 "x"', 'a </liwa-block> b')).toBe('<liwa-block name="前缀 &quot;x&quot;">\na <\\/liwa-block> b\n</liwa-block>')
    const input = { blocks: [{ kind: 'text' as const, text: 'hi' }, { kind: 'block' as const, name: 'n', text: 't' }] }
    expect(await toPaseoPrompt(input, BLOBS)).toEqual([{ type: 'text', text: 'hi' }, { type: 'text', text: '<liwa-block name="n">\nt\n</liwa-block>' }])
    expect(turnInputText(input)).toBe('hi\n\n<liwa-block name="n">\nt\n</liwa-block>')
    expect(await toPaseoPrompt({ blocks: [{ kind: 'text', text: 'look' }, { kind: 'image', blob: PNG_REF }] }, BLOBS))
      .toEqual([{ type: 'text', text: 'look' }, { type: 'image', data: Buffer.from(PNG).toString('base64'), mimeType: 'image/png' }])
    await expect(toPaseoPrompt({ blocks: [{ kind: 'image', blob: { ...PNG_REF, blob: 'c'.repeat(64) } }] }, BLOBS)).rejects.toMatchObject({ code: 'brain.blob_missing' })
    await expect(toPaseoPrompt({ blocks: [{ kind: 'image', blob: { ...PNG_REF, mime: 'text/plain' } }] }, BLOBS)).rejects.toMatchObject({ code: 'brain.image_mime' })
    expect(() => turnInputText({ blocks: [{ kind: 'image', blob: PNG_REF }] })).toThrow(BrainError)
  })

  it('adapts a cordis logger to the pino shape Paseo code calls', () => {
    const lines: { level: string; text: string }[] = []
    const record = (level: string) => (text: string): void => { lines.push({ level, text }) }
    const logger = paseoLogger({ debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') }, { provider: 'x' })
    logger.warn('plain')
    logger.child({ agentId: 'a' }).info({ count: 2 }, 'with fields')
    logger.error(new Error('bad'), 'failed')
    logger.debug({ err: new Error('inner') }, 'nested')
    logger.trace({ raw: 'ignored' }, 'trace')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    logger.info({ cyclic }, 'cyclic')
    expect(lines).toEqual([
      { level: 'warn', text: 'plain (provider="x")' },
      { level: 'info', text: 'with fields (provider="x", agentId="a", count=2)' },
      { level: 'error', text: 'failed (provider="x", value=Error: bad)' },
      { level: 'debug', text: 'nested (provider="x", err=Error: inner)' },
      { level: 'info', text: 'cyclic (provider="x", cyclic=[unserializable])' },
    ])
  })
})
