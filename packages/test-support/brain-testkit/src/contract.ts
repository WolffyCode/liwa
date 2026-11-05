/**
 * 任何大脑提供方都要过的契约测试（01 §9 A6）。被测方给出提供方本身，以及让它的（假）CLI 跑某个场景
 * 的输入；这套测试直接调用提供方，校验 `brain.provider` 义务的边界结果（不只是映射自洽）：事件形状、回合开与收、
 * 条目归属（同一条目只属于一个回合、父会话的条目不出现在它的回合结束之后）、送达语义与 `Meta.delivery` 一致、
 * 取消幂等并撤回插话、确认式取消只收尾调用时的回合（紧接着开的新回合的条目不受影响）、权限选项翻译与答复的实际
 * 效果（允许则工具成功、拒绝则失败、取消则回合中断、对不上时按 `deny_once`）、问答往返（答案以结构原样到达 CLI：
 * 选项与补充文字分开，带逗号的选项与文字不混）、子 agent 的权限请求带上所问调用的事实、`turn.completed` 必带
 * 用量、子 agent 翻成 `child.*`、后台子 agent 跨回合送达、图片输入到达 CLI、换模型与切模式生效且可观察（一次切换
 * 只报一次）、两回合之间退出报 `session.exited`、续接、`close` 后释放。
 * @module @liwa/brain-testkit/contract
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BrainError, BrainEventSchema, MetaSchema, ResumeHandleSchema, UsageSchema,
  type BrainEvent, type BrainEventOf, type BrainProvider, type BrainProviderSession, type PermissionAnswer,
  type PermissionQuestion, type SessionConfigInput, type TurnInput,
} from '@liwa/brain'
import {
  createBrainTestHost, isTurnTerminal, recordEvents, solidPng,
  type BrainTestHost, type EventRecorder, type RecordingLaunchContext,
} from './harness.ts'
import { CHILD_PERMISSION_MARK, readEchoedAnswers } from './scripted-provider.ts'

/**
 * 契约测试里用到的场景。被测方为每个场景给一个输入，使它的 CLI：
 * `reply` 回一段流式文本后正常结束；`tool` 调一次工具后结束；`permission` 为一次工具调用请求权限、
 * 答复后照答复跑或不跑这次调用并结束（取消则停下）；`question` 向主人问一个有选项的问题，答了就在回复里说出
 * 所选选项的文字；`answers` 一次问几个问题——至少一个有选项且收补充文字的单选、一个有带逗号选项且收补充文字的
 * 多选、一个只收自由文本的问题——答了就在回复里以 `ANSWERS ` 加 JSON（问题号 → `{ selected, custom? }`）原样说出
 * 它收到的答案；`child` 开一个自己的子 agent 并等它结束；`child-permission` 开一个子 agent，子 agent 为一次工具调用
 * 请求权限（调用的入参里带 {@link CHILD_PERMISSION_MARK}），答复后照答复跑或不跑、子 agent 结束、回合结束；
 * `background` 开一个后台子 agent 后一直跑到被取消，那个子 agent 过一会儿结束，CLI 再自己开一个回合说出它的结果；
 * `image` 在回复里说出输入里图片的 MIME；`long` 一直跑到被取消；`exit` 正常结束这一回合后 CLI 进程退出。
 */
export type BrainContractScenario =
  | 'reply' | 'tool' | 'permission' | 'question' | 'answers' | 'child' | 'child-permission' | 'background' | 'image' | 'long' | 'exit'

/** 被测的提供方。 */
export interface BrainContractSubject {
  /** 测试组名。 */
  name: string
  /**
   * 造被测的提供方；每个测试调一次。
   * @param host - 测试宿主（上下文、临时目录）。
   * @returns 提供方。
   */
  createProvider(host: BrainTestHost): BrainProvider | Promise<BrainProvider>
  /**
   * 让 CLI 跑某个场景的回合输入。
   * @param scenario - 场景。
   * @returns 回合输入。
   */
  scenarioInput(scenario: BrainContractScenario): TurnInput
  /**
   * 覆盖默认会话配置的字段（可选）。
   * @param scenario - 场景。
   * @returns 覆盖项。
   */
  sessionConfig?(scenario: BrainContractScenario): Partial<SessionConfigInput>
  /**
   * 让 CLI 在两回合之间退出的办法（可选）。真 CLI 不会照提示词退出，被测方可以在这里终止它的进程；省略时
   * 用 `exit` 场景的输入。
   * @param launch - 这个会话的启动上下文（含它拉起的进程句柄）。
   */
  exitCli?(launch: RecordingLaunchContext): Promise<void>
  /** 换模型的测试用：这家 CLI 有的一个模型、没有的一个模型（`Meta.modelSwitch` 为 true 时必给）。 */
  models?: { known: string; unknown: string }
  /** 切模式的测试用：要切到的模式（`Meta.modeSwitch` 为 true 时必给；用 `sessionConfig('reply')` 开的会话里要有它）。 */
  modes?: { switchTo: string }
  /** 这家 CLI 演不了的场景，对应的测试跳过（被测方要写明原因）。 */
  unsupported?: BrainContractScenario[]
  /** 等一个事件的时限（毫秒），默认 10 秒。 */
  eventTimeoutMs?: number
  /** 每条测试与每个钩子的时限（毫秒），默认 30 秒；真进程的提供方按它的启动时间放宽。 */
  testTimeoutMs?: number
}

/** 一个被测会话。 */
interface Opened {
  session: BrainProviderSession
  launch: RecordingLaunchContext
  recorder: EventRecorder
}

/**
 * 断言事件都合乎 `BrainEvent` schema，且回合事件带的是本回合的号。
 * @param events - 收到的事件。
 */
function expectValidEvents(events: readonly BrainEvent[]): void {
  for (const event of events) {
    const parsed = BrainEventSchema.safeParse(event)
    expect(parsed.success, `${event.kind}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true)
  }
  expect(events.some(event => event.kind === 'process.exited'), 'providers never emit process.exited; brains reports process exits').toBe(false)
  expectItemOwnership(events)
}

/**
 * 断言条目归属：同一个消息或思考条目始终属于同一个回合与子 agent；父会话自己的条目不出现在它的回合结束之后
 * （一个回合的收尾不得拿走别的回合的条目）。
 * @param events - 收到的事件。
 */
function expectItemOwnership(events: readonly BrainEvent[]): void {
  const owners = new Map<string, string>()
  const ended = new Set<string>()
  for (const event of events) {
    if (isTurnTerminal(event)) ended.add(event.turnId)
    if (event.kind !== 'item.message' && event.kind !== 'item.reasoning') continue
    const owner = `${event.turnId ?? '-'} / ${event.childId ?? '-'}`
    const known = owners.get(event.itemId)
    expect(known ?? owner, `${event.kind} ${event.itemId} moved from ${known ?? ''} to ${owner}`).toBe(owner)
    owners.set(event.itemId, owner)
    if (event.childId === undefined && event.turnId !== undefined) {
      expect(ended.has(event.turnId), `${event.kind} ${event.itemId} arrived after its turn ${event.turnId} ended`).toBe(false)
    }
  }
}

/**
 * 契约测试作答 `answers` 场景时给每个问题的答案：自由文本问题给带逗号的文字；多选选上全部选项（含带逗号的）再加
 * 带逗号的补充文字；单选选最后一个选项再加带逗号的补充文字。
 * @param question - 问题。
 * @returns 答案。
 */
function structuredAnswer(question: PermissionQuestion): PermissionAnswer {
  if (question.options.length === 0) return { selected: [], custom: `free, text for ${question.id}` }
  if (question.multiSelect) return { selected: question.options.map(option => option.label), custom: 'also, this' }
  const last = question.options.at(-1)
  return { selected: last === undefined ? [] : [last.label], custom: 'keep, both' }
}

/**
 * 一个回合里父会话自己的回复文字。
 * @param events - 收到的事件。
 * @param turnId - 回合号。
 * @returns 文字连起来。
 */
function replyOf(events: readonly BrainEvent[], turnId: string): string {
  return events.filter((event): event is BrainEventOf<'item.message'> => event.kind === 'item.message' && event.turnId === turnId && event.childId === undefined)
    .map(event => event.delta).join('')
}

/**
 * 一个回合里父会话自己最后结束的工具调用是否成功。
 * @param events - 收到的事件。
 * @param turnId - 回合号。
 * @returns 是否成功；没有工具调用时为 `undefined`。
 */
function lastToolOk(events: readonly BrainEvent[], turnId: string): boolean | undefined {
  return events.filter((event): event is BrainEventOf<'item.tool_call.completed'> => event.kind === 'item.tool_call.completed' && event.turnId === turnId && event.childId === undefined)
    .at(-1)?.ok
}

/**
 * 定义一组契约测试。
 * @param subject - 被测的提供方与场景输入。
 */
export function describeBrainProviderContract(subject: BrainContractSubject): void {
  const timeout = subject.eventTimeoutMs ?? 10_000
  const testTimeout = subject.testTimeoutMs ?? 30_000

  describe(`brain.provider contract: ${subject.name}`, () => {
    let host: BrainTestHost
    let provider: BrainProvider
    const opened: Opened[] = []

    beforeEach(async () => {
      host = await createBrainTestHost()
      provider = await subject.createProvider(host)
    }, testTimeout)

    afterEach(async () => {
      for (const entry of opened.splice(0)) {
        entry.recorder.stop()
        await entry.session.close()
      }
      await host.dispose()
    }, testTimeout)

    const config = (scenario: BrainContractScenario): ReturnType<BrainTestHost['sessionConfig']> =>
      host.sessionConfig(subject.sessionConfig?.(scenario))

    const open = async (scenario: BrainContractScenario): Promise<Opened> => {
      const launch = host.launch()
      const session = await provider.createSession(config(scenario), launch)
      const entry = { session, launch, recorder: recordEvents(session) }
      opened.push(entry)
      return entry
    }

    const runTurn = async (entry: Opened, scenario: BrainContractScenario): Promise<Extract<BrainEvent, { kind: 'turn.completed' | 'turn.interrupted' | 'turn.failed' }>> => {
      const { turnId } = await entry.session.startTurn(subject.scenarioInput(scenario))
      return entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' | 'turn.interrupted' | 'turn.failed' }> =>
        isTurnTerminal(event) && event.turnId === turnId, timeout)
    }

    it('declares a Meta that passes the contract schema', () => {
      expect(MetaSchema.safeParse(provider.meta).success).toBe(true)
      expect(provider.meta.runtime).toBe('subprocess')
    }, testTimeout)

    it('reports availability from probe', async () => {
      const result = await provider.probe(host.probeContext())
      expect(typeof result.available).toBe('boolean')
      expect(Array.isArray(result.problems)).toBe(true)
      expect(result.available).toBe(true)
    }, testTimeout)

    it('streams one turn and completes it with usage', async () => {
      const entry = await open('reply')
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('reply'))
      const terminal = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> =>
        event.kind === 'turn.completed' && event.turnId === turnId, timeout)
      expect(UsageSchema.safeParse(terminal.usage).success).toBe(true)
      const events = entry.recorder.events
      expectValidEvents(events)
      expect(events.find(event => event.kind === 'turn.started')).toEqual({ kind: 'turn.started', turnId })
      const messages = events.filter(event => event.kind === 'item.message')
      expect(messages.length).toBeGreaterThan(0)
      expect(messages.every(event => event.turnId === turnId)).toBe(true)
      expect(messages.at(-1)?.final).toBe(true)
    }, testTimeout)

    it('pairs every tool call start with its completion and still reports usage', async () => {
      const entry = await open('tool')
      const terminal = await runTurn(entry, 'tool')
      expect(terminal.kind).toBe('turn.completed')
      if (terminal.kind === 'turn.completed') expect(UsageSchema.safeParse(terminal.usage).success).toBe(true)
      expectValidEvents(entry.recorder.events)
      const started = entry.recorder.events.filter(event => event.kind === 'item.tool_call.started').map(event => event.callId)
      const completed = entry.recorder.events.filter(event => event.kind === 'item.tool_call.completed').map(event => event.callId)
      expect(started.length).toBeGreaterThan(0)
      expect(completed).toEqual(started)
    }, testTimeout)

    it('translates permission options and applies an unknown option id as deny_once', async () => {
      const entry = await open('permission')
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('permission'))
      const request = await entry.recorder.waitForKind('permission.request', undefined, timeout)
      expect(request.turnId).toBe(turnId)
      const effects = request.options.map(option => option.effect)
      expect(effects.some(effect => effect.startsWith('allow'))).toBe(true)
      expect(effects).toContain('deny_once')
      await entry.session.respondToPermission(request.requestId, { optionId: 'no-such-option-id' })
      const resolved = await entry.recorder.waitForKind('permission.resolved', event => event.requestId === request.requestId, timeout)
      expect(resolved.effect).toBe('deny_once')
      const terminal = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => isTurnTerminal(event) && event.turnId === turnId, timeout)
      expect(terminal.kind).toBe('turn.completed')
      // 边界结果：被拒的那次调用没有跑成。
      expect(lastToolOk(entry.recorder.events, turnId)).toBe(false)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('offers the first-version options and turns cancel into an interrupted turn', async () => {
      const entry = await open('permission')
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('permission'))
      const request = await entry.recorder.waitForKind('permission.request', undefined, timeout)
      expect(request.category).toBe('tool')
      const effects = request.options.map(option => option.effect)
      expect(effects).toEqual(expect.arrayContaining(['allow_once', 'deny_once', 'cancel']))
      expect(effects).not.toContain('deny_always')
      expect(effects).not.toContain('allow_always')
      const cancel = request.options.find(option => option.effect === 'cancel')
      await entry.session.respondToPermission(request.requestId, { optionId: cancel?.id ?? '' })
      const terminal = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.interrupted' }> => isTurnTerminal(event) && event.turnId === turnId, timeout)
      expect(terminal.kind).toBe('turn.interrupted')
      expect(lastToolOk(entry.recorder.events, turnId)).not.toBe(true)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('applies an allow option as an allow', async () => {
      const entry = await open('permission')
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('permission'))
      const request = await entry.recorder.waitForKind('permission.request', undefined, timeout)
      const allow = request.options.find(option => option.effect === 'allow_once') ?? request.options.find(option => option.effect.startsWith('allow'))
      expect(allow).toBeDefined()
      await entry.session.respondToPermission(request.requestId, { optionId: allow?.id ?? '' })
      const resolved = await entry.recorder.waitForKind('permission.resolved', event => event.requestId === request.requestId, timeout)
      expect(resolved.effect).toBe(allow?.effect)
      await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => event.kind === 'turn.completed' && event.turnId === turnId, timeout)
      // 边界结果：允许的那次调用跑成了。
      expect(lastToolOk(entry.recorder.events, turnId)).toBe(true)
    }, testTimeout)

    it('round-trips a question: the answers reach the CLI', async ({ skip }) => {
      if (subject.unsupported?.includes('question') === true) skip()
      const entry = await open('question')
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('question'))
      const request = await entry.recorder.waitForKind('permission.request', event => event.category === 'question', timeout)
      const questions = request.questions ?? []
      expect(questions.length).toBeGreaterThan(0)
      const answer = request.options.find(option => option.effect === 'allow_once')
      expect(answer).toBeDefined()
      // 允许一个问答却不给答案：提供方拒绝，请求仍挂着。
      await expect(entry.session.respondToPermission(request.requestId, { optionId: answer?.id ?? '' })).rejects.toThrow(BrainError)
      const chosen = questions.map(question => question.options.at(-1)?.label ?? 'free text answer')
      const answers: Record<string, PermissionAnswer> = Object.fromEntries(questions.map((question, index) => [
        question.id,
        question.options.length === 0 ? { selected: [], custom: chosen[index] ?? '' } : { selected: [chosen[index] ?? ''] },
      ]))
      await entry.session.respondToPermission(request.requestId, { optionId: answer?.id ?? '', answers })
      const resolved = await entry.recorder.waitForKind('permission.resolved', event => event.requestId === request.requestId, timeout)
      expect(resolved.effect).toBe('allow_once')
      const terminal = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => isTurnTerminal(event) && event.turnId === turnId, timeout)
      expect(terminal.kind).toBe('turn.completed')
      for (const label of chosen) expect(replyOf(entry.recorder.events, turnId)).toContain(label)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('keeps answers structured end to end: selections apart from custom text, labels and text with commas intact', async ({ skip }) => {
      if (subject.unsupported?.includes('answers') === true) skip()
      const entry = await open('answers')
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('answers'))
      const request = await entry.recorder.waitForKind('permission.request', event => event.category === 'question', timeout)
      const questions = request.questions ?? []
      // 场景的问题覆盖三种情形：单选、选项带逗号的多选、只收自由文本。
      expect(questions.some(question => !question.multiSelect && question.options.length > 0)).toBe(true)
      expect(questions.some(question => question.multiSelect && question.options.some(option => option.label.includes(',')))).toBe(true)
      expect(questions.some(question => question.options.length === 0)).toBe(true)
      const answer = request.options.find(option => option.effect === 'allow_once')
      expect(answer).toBeDefined()
      const answers: Record<string, PermissionAnswer> = Object.fromEntries(
        questions.map(question => [question.id, structuredAnswer(question)]),
      )
      await entry.session.respondToPermission(request.requestId, { optionId: answer?.id ?? '', answers })
      const terminal = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => isTurnTerminal(event) && event.turnId === turnId, timeout)
      expect(terminal.kind).toBe('turn.completed')
      // 边界结果：CLI 收到的答案与作答的结构逐项相同。
      expect(readEchoedAnswers(replyOf(entry.recorder.events, turnId))).toEqual(answers)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('answers deliver according to Meta.delivery', async () => {
      const entry = await open('long')
      const { nextStep, nextTurn } = provider.meta.delivery
      const steer = subject.scenarioInput('reply')
      if (!nextStep) expect(await entry.session.deliver(steer, { semantics: 'next_step', wake: false })).toBe('unsupported')
      if (!nextTurn) expect(await entry.session.deliver(steer, { semantics: 'next_turn', wake: false })).toBe('unsupported')
      if (nextStep) expect(await entry.session.deliver(steer, { semantics: 'next_step', wake: false })).toBe('unavailable')
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('long'))
      await entry.recorder.waitForKind('turn.started', event => event.turnId === turnId, timeout)
      if (nextStep) {
        expect(await entry.session.deliver(steer, { semantics: 'next_step', wake: false, expectedTurnId: turnId })).toBe('accepted')
      } else {
        expect(await entry.session.deliver(steer, { semantics: 'next_step', wake: false, expectedTurnId: turnId })).toBe('unsupported')
      }
      if (!nextTurn) expect(await entry.session.deliver(steer, { semantics: 'next_turn', wake: true })).toBe('unsupported')
      await entry.session.cancel({ reason: 'owner', keepQueue: false })
    }, testTimeout)

    it('makes cancel idempotent and withdraws unread steers', async () => {
      const entry = await open('long')
      await entry.session.cancel({ reason: 'preempt', keepQueue: true })
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('long'))
      await entry.recorder.waitForKind('turn.started', event => event.turnId === turnId, timeout)
      if (provider.meta.delivery.nextStep) {
        await entry.session.deliver(subject.scenarioInput('reply'), { semantics: 'next_step', wake: false, expectedTurnId: turnId })
      }
      await entry.session.cancel({ reason: 'pause', keepQueue: false })
      await entry.recorder.waitForKind('turn.interrupted', event => event.turnId === turnId, timeout)
      await entry.session.cancel({ reason: 'pause', keepQueue: false })
      // 撤回的插话不得把刚停的回合重新拉起。
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(entry.recorder.events.filter(event => event.kind === 'turn.started')).toHaveLength(1)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('settles only the captured turn on an acknowledged cancel', async () => {
      const entry = await open('long')
      const first = await entry.session.startTurn(subject.scenarioInput('long'))
      await entry.recorder.waitForKind('turn.started', event => event.turnId === first.turnId, timeout)
      await entry.session.cancel({ reason: 'preempt', keepQueue: false })
      // 取消一经确认，调用时在跑的回合已经有了终止事件（提供方没报的由实现补报）。
      expect(entry.recorder.events.filter(event => isTurnTerminal(event) && event.turnId === first.turnId)).toHaveLength(1)
      const second = await entry.session.startTurn(subject.scenarioInput('reply'))
      const terminal = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => isTurnTerminal(event) && event.turnId === second.turnId, timeout)
      expect(terminal.kind).toBe('turn.completed')
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(entry.recorder.events.filter(event => isTurnTerminal(event) && event.turnId === first.turnId)).toHaveLength(1)
      expect(entry.recorder.events.filter(event => isTurnTerminal(event) && event.turnId === second.turnId)).toHaveLength(1)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('keeps the items of a turn started right after a cancel in that turn', async () => {
      const entry = await open('long')
      const first = await entry.session.startTurn(subject.scenarioInput('long'))
      await entry.recorder.waitForKind('turn.started', event => event.turnId === first.turnId, timeout)
      await entry.session.cancel({ reason: 'owner', keepQueue: false })
      const second = await entry.session.startTurn(subject.scenarioInput('reply'))
      const terminal = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => isTurnTerminal(event) && event.turnId === second.turnId, timeout)
      expect(terminal.kind).toBe('turn.completed')
      // 新回合的回复完整、收尾在它自己名下；旧回合的收尾没有拿走它的条目（归属检查在 expectValidEvents 里）。
      const messages = entry.recorder.events.filter((event): event is BrainEventOf<'item.message'> => event.kind === 'item.message' && event.childId === undefined)
      const secondItems = new Set(messages.filter(event => event.turnId === second.turnId).map(event => event.itemId))
      expect(secondItems.size).toBeGreaterThan(0)
      expect(messages.filter(event => secondItems.has(event.itemId)).every(event => event.turnId === second.turnId)).toBe(true)
      expect(messages.filter(event => event.turnId === second.turnId).at(-1)?.final).toBe(true)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('forwards a child agent\'s permission request with the facts of the call it asks about', async ({ skip }) => {
      if (provider.meta.children.native !== 'observe' || subject.unsupported?.includes('child-permission') === true) skip()
      const entry = await open('child-permission')
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('child-permission'))
      const started = await entry.recorder.waitForKind('child.started', undefined, timeout)
      const request = await entry.recorder.waitForKind('permission.request', event => event.childId !== undefined, timeout)
      expect(request.childId).toBe(started.childId)
      expect(request.category).toBe('tool')
      // 主人看得到要批的是什么：所问调用的入参原样带上，不是空的。
      expect(request.args).not.toBeNull()
      expect(JSON.stringify(request.args)).toContain(CHILD_PERMISSION_MARK)
      const allow = request.options.find(option => option.effect === 'allow_once')
      expect(allow).toBeDefined()
      await entry.session.respondToPermission(request.requestId, { optionId: allow?.id ?? '' })
      const resolved = await entry.recorder.waitForKind('permission.resolved', event => event.requestId === request.requestId, timeout)
      expect(resolved.effect).toBe('allow_once')
      await entry.recorder.waitForKind('child.ended', event => event.childId === started.childId, timeout)
      const terminal = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => isTurnTerminal(event) && event.turnId === turnId, timeout)
      expect(terminal.kind).toBe('turn.completed')
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('delivers a background child agent across turns and reports it in a turn of its own', async ({ skip }) => {
      if (provider.meta.children.native !== 'observe' || subject.unsupported?.includes('background') === true) skip()
      const entry = await open('background')
      const first = await entry.session.startTurn(subject.scenarioInput('background'))
      const started = await entry.recorder.waitForKind('child.started', undefined, timeout)
      expect(started.turnId).toBe(first.turnId)
      // 抢占只停父回合：后台子 agent 照常跑完（01 §4.5）。
      await entry.session.cancel({ reason: 'preempt', keepQueue: true })
      const interrupted = entry.recorder.events.findIndex(event => isTurnTerminal(event) && event.turnId === first.turnId)
      expect(interrupted).toBeGreaterThanOrEqual(0)
      const ended = await entry.recorder.waitForKind('child.ended', event => event.childId === started.childId, timeout)
      expect(ended.stopReason).toBe('completed')
      expect(entry.recorder.events.indexOf(ended)).toBeGreaterThan(interrupted)
      // 子 agent 的条目在父回合结束后照常送达，归开它的回合，不借后来的回合。
      for (const event of entry.recorder.events.slice(interrupted + 1)) {
        if ('childId' in event && event.childId === started.childId && event.kind !== 'child.ended') expect(event).toMatchObject({ turnId: first.turnId })
      }
      // CLI 被子 agent 的结果叫醒，自己开一个回合（没有 startTurn）并正常收尾。
      const reported = await entry.recorder.waitFor((event): event is BrainEventOf<'turn.started'> => event.kind === 'turn.started' && event.turnId !== first.turnId, timeout)
      const done = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => isTurnTerminal(event) && event.turnId === reported.turnId, timeout)
      expect(done.kind).toBe('turn.completed')
      expect(UsageSchema.safeParse(done.usage).success).toBe(true)
      expect(replyOf(entry.recorder.events, reported.turnId).length).toBeGreaterThan(0)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('stops background child agents when the owner cancels', async ({ skip }) => {
      if (provider.meta.children.native !== 'observe' || subject.unsupported?.includes('background') === true) skip()
      const entry = await open('background')
      await entry.session.startTurn(subject.scenarioInput('background'))
      const started = await entry.recorder.waitForKind('child.started', undefined, timeout)
      await entry.session.cancel({ reason: 'owner', keepQueue: false })
      const ended = await entry.recorder.waitForKind('child.ended', event => event.childId === started.childId, timeout)
      expect(ended.stopReason).not.toBe('completed')
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('switches models when Meta.modelSwitch, and refuses a model it does not have', async ({ skip }) => {
      if (!provider.meta.modelSwitch) skip()
      const models = subject.models
      expect(models, 'a provider that declares modelSwitch names a known and an unknown model').toBeDefined()
      if (models === undefined) return
      const entry = await open('reply')
      expect('setModel' in entry.session).toBe(true)
      await entry.session.setModel?.(models.known)
      await entry.recorder.waitForKind('session.model_changed', event => event.model === models.known, timeout)
      await expect(entry.session.setModel?.(models.unknown)).rejects.toThrow(BrainError)
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('reply'))
      await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => event.kind === 'turn.completed' && event.turnId === turnId, timeout)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('lists, reads, and switches session modes when Meta.modeSwitch', async ({ skip }) => {
      if (!provider.meta.modeSwitch) skip()
      const modes = subject.modes
      expect(modes, 'a provider that declares modeSwitch names a mode to switch to').toBeDefined()
      if (modes === undefined) return
      const entry = await open('reply')
      const available = await entry.session.availableModes?.() ?? []
      expect(available.map(mode => mode.id)).toContain(modes.switchTo)
      const change = await entry.session.setMode?.(modes.switchTo)
      expect(change).toEqual({ modeId: modes.switchTo, appliesAt: 'now' })
      expect(await entry.session.currentMode?.()).toBe(modes.switchTo)
      await entry.recorder.waitForKind('session.mode_changed', event => event.modeId === modes.switchTo, timeout)
      await expect(entry.session.setMode?.('no-such-mode')).rejects.toThrow(BrainError)
      expect(await entry.session.currentMode?.()).toBe(modes.switchTo)
      // 跑完一个回合，CLI 对这次切换的确认都已到达：一次切换只报一次。
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('reply'))
      await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => isTurnTerminal(event) && event.turnId === turnId, timeout)
      expect(entry.recorder.events.filter(event => event.kind === 'session.mode_changed' && event.modeId === modes.switchTo)).toHaveLength(1)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('delivers an image turn input to the CLI', async ({ skip }) => {
      if (subject.unsupported?.includes('image') === true) skip()
      const entry = await open('image')
      const blob = await host.blobs.put(solidPng(8, 8, [220, 30, 30]), 'image/png')
      const input = subject.scenarioInput('image')
      const { turnId } = await entry.session.startTurn({ blocks: [...input.blocks, { kind: 'image', blob }] })
      const terminal = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => isTurnTerminal(event) && event.turnId === turnId, timeout)
      expect(terminal.kind).toBe('turn.completed')
      expect(replyOf(entry.recorder.events, turnId)).toContain('image/png')
      // 引用对不上存储里的内容：开回合前就失败，不把坏图交给 CLI。
      await expect(entry.session.startTurn({ blocks: [...input.blocks, { kind: 'image', blob: { ...blob, bytes: blob.bytes + 1 } }] })).rejects.toThrow(BrainError)
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('surfaces its own child agents as child.started / child.ended', async ({ skip }) => {
      if (provider.meta.children.native !== 'observe') skip()
      const entry = await open('child')
      const terminal = await runTurn(entry, 'child')
      expect(terminal.kind).toBe('turn.completed')
      const started = entry.recorder.events.filter(event => event.kind === 'child.started')
      expect(started.length).toBeGreaterThan(0)
      for (const child of started) {
        const ended = entry.recorder.events.find(event => event.kind === 'child.ended' && event.childId === child.childId)
        expect(ended).toBeDefined()
        expect(child.provider).toBe(provider.impl)
      }
      expectValidEvents(entry.recorder.events)
    }, testTimeout)

    it('reports a CLI exit between turns as session.exited', async () => {
      const entry = await open('exit')
      const terminal = await runTurn(entry, 'exit')
      expect(terminal.kind).toBe('turn.completed')
      await subject.exitCli?.(entry.launch)
      const exited = await entry.recorder.waitForKind('session.exited', undefined, timeout)
      expect(exited.category).toBe('process_exit')
      await expect(entry.session.startTurn(subject.scenarioInput('reply'))).rejects.toThrow()
    }, testTimeout)

    it('describes persistence and resumes in a new session when Meta.resume', async ({ skip }) => {
      if (!provider.meta.resume) skip()
      const entry = await open('reply')
      await runTurn(entry, 'reply')
      const handle = entry.session.persistence()
      expect(handle).not.toBeNull()
      expect(ResumeHandleSchema.safeParse(handle).success).toBe(true)
      expect(handle?.provider).toBe(provider.impl)
      await entry.session.close()
      if (handle === null) return
      // per-session 提供方在同一目录重拉进程续接（ctx.brains 经续接句柄的 home 做同样的事）。
      const launch = host.launch(provider.sessionHome === 'per-session' ? entry.launch.homeDir : undefined)
      const resumed = await provider.resumeSession(handle, config('reply'), launch)
      const recorder = recordEvents(resumed)
      opened.push({ session: resumed, launch, recorder })
      expect(resumed.persistence()?.sessionRef).toBe(handle.sessionRef)
      const { turnId } = await resumed.startTurn(subject.scenarioInput('reply'))
      await recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => event.kind === 'turn.completed' && event.turnId === turnId, timeout)
    }, testTimeout)

    it('releases everything on close, idempotently', async () => {
      const entry = await open('long')
      const { turnId } = await entry.session.startTurn(subject.scenarioInput('long'))
      await entry.recorder.waitForKind('turn.started', event => event.turnId === turnId, timeout)
      await entry.session.close()
      await entry.session.close()
      const count = entry.recorder.events.length
      await expect(entry.session.startTurn(subject.scenarioInput('reply'))).rejects.toThrow()
      for (const handle of entry.launch.processes) await handle.done
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(entry.recorder.events.length).toBe(count)
    }, testTimeout)
  })
}
