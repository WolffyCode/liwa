/**
 * 任何大脑提供方都要过的契约测试（01 §9 A6）。被测方给出提供方本身，以及让它的（假）CLI 跑某个场景
 * 的输入；这套测试直接调用提供方，校验 `brain.provider` 的义务：事件形状、回合开与收、送达语义与
 * `Meta.delivery` 一致、取消幂等并撤回插话、权限选项翻译与对不上时按 `deny_once`、`turn.completed`
 * 必带用量、子 agent 翻成 `child.*`、两回合之间退出报 `session.exited`、续接、`close` 后释放。
 * @module @liwa/brain-testkit/contract
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BrainEventSchema, MetaSchema, ResumeHandleSchema, UsageSchema,
  type BrainEvent, type BrainProvider, type BrainProviderSession, type SessionConfigInput, type TurnInput,
} from '@liwa/brain'
import {
  createBrainTestHost, isTurnTerminal, recordEvents,
  type BrainTestHost, type EventRecorder, type RecordingLaunchContext,
} from './harness.ts'

/**
 * 契约测试里用到的场景。被测方为每个场景给一个输入，使它的 CLI：
 * `reply` 回一段流式文本后正常结束；`tool` 调一次工具后结束；`permission` 为一次工具调用请求权限、
 * 答复后继续并结束；`child` 开一个自己的子 agent 并等它结束；`long` 一直跑到被取消；
 * `exit` 正常结束这一回合后 CLI 进程退出。
 */
export type BrainContractScenario = 'reply' | 'tool' | 'permission' | 'child' | 'long' | 'exit'

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
  /** 等一个事件的时限（毫秒），默认 10 秒。 */
  eventTimeoutMs?: number
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
}

/**
 * 定义一组契约测试。
 * @param subject - 被测的提供方与场景输入。
 */
export function describeBrainProviderContract(subject: BrainContractSubject): void {
  const timeout = subject.eventTimeoutMs ?? 10_000

  describe(`brain.provider contract: ${subject.name}`, () => {
    let host: BrainTestHost
    let provider: BrainProvider
    const opened: Opened[] = []

    beforeEach(async () => {
      host = await createBrainTestHost()
      provider = await subject.createProvider(host)
    })

    afterEach(async () => {
      for (const entry of opened.splice(0)) {
        entry.recorder.stop()
        await entry.session.close()
      }
      await host.dispose()
    })

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
    })

    it('reports availability from probe', async () => {
      const result = await provider.probe(host.probeContext())
      expect(typeof result.available).toBe('boolean')
      expect(Array.isArray(result.problems)).toBe(true)
      expect(result.available).toBe(true)
    })

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
    })

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
    })

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
      expectValidEvents(entry.recorder.events)
    })

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
    })

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
    })

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
    })

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
    })

    it('reports a CLI exit between turns as session.exited', async () => {
      const entry = await open('exit')
      const terminal = await runTurn(entry, 'exit')
      expect(terminal.kind).toBe('turn.completed')
      const exited = await entry.recorder.waitForKind('session.exited', undefined, timeout)
      expect(exited.category).toBe('process_exit')
      await expect(entry.session.startTurn(subject.scenarioInput('reply'))).rejects.toThrow()
    })

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
      const launch = host.launch()
      const resumed = await provider.resumeSession(handle, config('reply'), launch)
      const recorder = recordEvents(resumed)
      opened.push({ session: resumed, launch, recorder })
      expect(resumed.persistence()?.sessionRef).toBe(handle.sessionRef)
      const { turnId } = await resumed.startTurn(subject.scenarioInput('reply'))
      await recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => event.kind === 'turn.completed' && event.turnId === turnId, timeout)
    })

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
    })
  })
}
