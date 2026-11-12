import { afterEach, expect, it, vi } from 'vitest'
import { createBrainTestHost, recordEvents, SCRIPTED_META, textInput, type BrainTestHost } from '@liwa/brain-testkit'
import { BrainSessionId, ChildId, ImplId, ItemId, PermissionRequestId, TurnId } from '../src/brand.ts'
import type { BrainEvent, Meta } from '../src/contract.ts'
import type { BrainProviderSession } from '../src/provider.ts'
import { ManagedBrainSession, type BrainSessionHost } from '../src/session.ts'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@liwa/subprocess'

let host: BrainTestHost | undefined
const sessions: ManagedBrainSession[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close()
  await host?.dispose()
})

async function fixture(meta: Meta = { ...SCRIPTED_META, modelSwitch: true, thinkingSwitch: true, modeSwitch: true }, attach = true) {
  host = await createBrainTestHost()
  let observer: (event: BrainEvent) => void = () => { throw new Error('not attached') }
  const native: BrainProviderSession = {
    id: 'native',
    subscribe: (listener) => { observer = listener; return () => {} },
    startTurn: () => Promise.resolve({ turnId: TurnId('t') }),
    deliver: () => Promise.resolve('accepted'),
    cancel: () => Promise.resolve(),
    respondToPermission: () => Promise.resolve(),
    persistence: () => null,
    close: () => Promise.resolve(),
  }
  const callbacks: BrainSessionHost = {
    logger: host.ctx.logger('session-lifecycle'), blobs: host.blobs,
    timeouts: { handshakeMs: 1000, callMs: 1000, closeMs: 1000 },
    processSpawned: vi.fn(), processExited: vi.fn(), childOpened: vi.fn(), childEnded: vi.fn(), usage: vi.fn(), closed: vi.fn(),
  }
  const session = new ManagedBrainSession(callbacks, {
    id: BrainSessionId('managed'), impl: ImplId('fake'), meta, sessionHome: 'per-member', config: host.sessionConfig(),
    homeDir: host.root, adjustments: [],
  })
  sessions.push(session)
  if (attach) session.attach(native)
  return { session, native, emit: (event: BrainEvent) => { observer(event) }, callbacks, host }
}

it('switches through optional provider methods, records successful changes once, and refuses unsupported or empty choices', async () => {
  const { session, native, emit } = await fixture()
  await expect(session.setModel('m')).rejects.toMatchObject({ code: 'brain.model_switch_unsupported' })
  await expect(session.setThinking('high')).rejects.toMatchObject({ code: 'brain.thinking_switch_unsupported' })
  await expect(session.setMode('plan')).rejects.toMatchObject({ code: 'brain.mode_switch_unsupported' })
  expect(await session.availableModes()).toEqual([])
  expect(await session.currentMode()).toBeNull()
  native.setModel = () => Promise.resolve()
  native.setThinking = () => Promise.resolve()
  native.setMode = modeId => Promise.resolve({ modeId, appliesAt: 'now' })
  native.availableModes = () => Promise.resolve([{ id: 'plan', label: 'Plan' }])
  native.currentMode = () => Promise.resolve('plan')
  await expect(session.setModel('')).rejects.toMatchObject({ code: 'brain.model_empty' })
  await expect(session.setThinking('')).rejects.toMatchObject({ code: 'brain.thinking_empty' })
  const events = recordEvents(session).events
  await session.setModel('m')
  await session.setThinking('high')
  await session.setMode('plan')
  expect(await session.availableModes()).toHaveLength(1)
  expect(await session.currentMode()).toBe('plan')
  await session.setModel('m')
  await session.setThinking('high')
  await session.setMode('plan')
  emit({ kind: 'session.model_changed', model: 'm' })
  emit({ kind: 'session.thinking_changed', thinking: 'high' })
  emit({ kind: 'session.mode_changed', modeId: 'plan' })
  expect(events).toHaveLength(3)
  emit({ kind: 'session.mode_changed', modeId: null, availableModes: [] })
  expect(session.view()).not.toHaveProperty('modeId')
  emit({ kind: 'process.exited', code: 0, signal: null })
  expect(events).toHaveLength(4)
})

it('keeps switch results from reopening a closed session, including a provider that closes during the switch', async () => {
  const { session, native, emit } = await fixture()
  native.setModel = async () => { await session.close() }
  const events = recordEvents(session).events
  await session.setModel('m')
  emit({ kind: 'session.model_changed', model: 'late' })
  expect(session.view()).not.toHaveProperty('model')
  expect(events).toEqual([])
  session.subscribe(() => { throw new Error('closed subscription must not be retained') })()
  expect(await session.canStopRuntime()).toBe(false)
  await session.cancel({ reason: 'owner', keepQueue: false })
  expect(await session.deliver(textInput('late'), { semantics: 'next_step', wake: false })).toBe('unavailable')
  await expect(session.startTurn(textInput('late'))).rejects.toMatchObject({ code: 'brain.session_closed' })
})

it('checks recycle vetoes, pending requests and live children, and isolates listener failures', async () => {
  const { session, native, emit } = await fixture()
  expect(await session.canStopRuntime()).toBe(true)
  native.canStopRuntime = () => Promise.resolve(false)
  expect(await session.canStopRuntime()).toBe(false)
  native.canStopRuntime = () => Promise.reject(new Error('veto unavailable'))
  expect(await session.canStopRuntime()).toBe(false)
  native.canStopRuntime = () => Promise.resolve(true)
  session.subscribe(() => { throw new Error('broken observer') })
  const events = recordEvents(session).events
  emit({ kind: 'child.ended', childId: ChildId('missing'), stopReason: 'completed', usage: {} })
  emit({ kind: 'child.started', childId: ChildId('child'), childKind: 'native-child', label: 'worker', provider: ImplId('fake') })
  expect(await session.canStopRuntime()).toBe(false)
  emit({ kind: 'child.ended', childId: ChildId('child'), stopReason: 'completed', usage: {} })
  emit({ kind: 'child.ended', childId: ChildId('child'), stopReason: 'completed', usage: {} })
  expect(await session.canStopRuntime()).toBe(true)
  expect(events).toHaveLength(4)
  emit({ kind: 'permission.request', requestId: PermissionRequestId('p'), childId: ChildId('child'), category: 'tool', tool: 'Read', args: null,
    options: [{ id: 'yes', label: 'Yes', effect: 'allow_once' }] })
  expect(await session.canStopRuntime()).toBe(false)
  emit({ kind: 'permission.resolved', requestId: PermissionRequestId('p'), optionId: 'yes', effect: 'allow_once' })
  expect(await session.canStopRuntime()).toBe(true)
})

it('handles buffered, waiting, aborted and closed event iterators without losing model-visible documents', async () => {
  const { session, emit } = await fixture()
  const controller = new AbortController()
  const iterator = session.events(controller.signal)[Symbol.asyncIterator]()
  const document: BrainEvent = { kind: 'session.project_document', path: 'src/CLAUDE.md', reason: { tool: 'Read', path: 'src/a.ts' }, text: 'instructions' }
  emit(document)
  expect(await iterator.next()).toEqual({ done: false, value: document })
  const pending = iterator.next()
  emit({ kind: 'session.project_document_failed', path: 'src/rule.md', reason: { tool: 'Read', path: 'src/a.ts' }, message: 'unreadable' })
  expect((await pending).done).toBe(false)
  const ended = iterator.next()
  controller.abort()
  expect(await ended).toEqual({ done: true, value: undefined })
  expect(await iterator.next()).toEqual({ done: true, value: undefined })
  await iterator.return?.()
  const alreadyAborted = session.events(AbortSignal.abort())[Symbol.asyncIterator]()
  expect((await alreadyAborted.next()).done).toBe(true)
  const returned = session.events()[Symbol.asyncIterator]()
  emit({ kind: 'session.compacted' })
  await returned.return?.()
  expect((await returned.next()).done).toBe(true)
  const closing = session.events()[Symbol.asyncIterator]()
  const closeWait = closing.next()
  await session.close()
  expect((await closeWait).done).toBe(true)
  expect((await session.events()[Symbol.asyncIterator]().next()).done).toBe(true)
})

it.each(['thinking', 'mode'] as const)('keeps a closed session closed when %s finishes late', async (kind) => {
  const { session, native } = await fixture()
  if (kind === 'thinking') {
    native.setThinking = async () => { await session.close() }
    await session.setThinking('high')
    expect(session.view()).not.toHaveProperty('thinking')
  } else {
    native.setMode = async (modeId) => { await session.close(); return { modeId, appliesAt: 'now' } }
    await session.setMode('plan')
    expect(session.view()).not.toHaveProperty('modeId')
  }
})

it('copies quota and balance snapshots and keeps parent requests separate from cross-turn child requests', async () => {
  const { session, emit } = await fixture()
  emit({ kind: 'usage.update', usage: { quotaWindows: [{ id: 'daily', usedPercent: 10 }], balances: [{ id: 'money', unit: 'usd', remaining: 2 }] } })
  expect(session.usage().quotaWindows).toEqual([{ id: 'daily', usedPercent: 10 }])
  expect(session.usage().balances).toEqual([{ id: 'money', unit: 'usd', remaining: 2 }])
  const request: BrainEvent = { kind: 'permission.request', turnId: TurnId('t'), requestId: PermissionRequestId('p'), category: 'tool', tool: 'Read', args: null,
    options: [{ id: 'yes', label: 'Yes', effect: 'allow_once' }] }
  emit(request)
  emit({ ...request, requestId: PermissionRequestId('child'), childId: ChildId('c') })
  emit({ kind: 'turn.completed', turnId: TurnId('t'), usage: {} })
  expect(session.pendingPermissions().map(pending => pending.requestId)).toEqual(['child'])
})

it('reports process failures and cleans stalled managed processes on a bounded close', async () => {
  const { session, callbacks, host: runtime } = await fixture()
  const completion = Promise.withResolvers<SubprocessOutcome>()
  const terminate = vi.fn()
  const processExited = vi.fn()
  callbacks.processExited = processExited
  const handle: SubprocessHandle = {
    stdin: undefined, stdout: undefined, stderr: undefined, control: undefined, collected: {},
    done: completion.promise, terminate, waitForExit: () => Promise.resolve(false),
  }
  const launch = session.launchContext({
    resolveExecutable: runtime.ctx.subprocess.resolveExecutable.bind(runtime.ctx.subprocess), spawn: () => handle,
  })
  const spec: SubprocessSpawnSpec = { argv: [process.execPath], cwd: runtime.root,
    stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' }, graceMs: 100 }
  expect(launch.spawn(spec)).toBe(handle)
  callbacks.timeouts.closeMs = 10
  await session.close()
  expect(terminate).toHaveBeenCalledOnce()
  completion.reject(new Error('late process failure'))
  await Promise.resolve()
  expect(processExited).toHaveBeenCalledOnce()
  expect(session.state).toBe('closed')
})

it('withdraws a process registration when spawn fails synchronously', async () => {
  const { session, host: runtime } = await fixture()
  const launch = session.launchContext({ resolveExecutable: runtime.ctx.subprocess.resolveExecutable.bind(runtime.ctx.subprocess),
    spawn: () => { throw new Error('spawn refused') } })
  const spec: SubprocessSpawnSpec = { argv: [process.execPath], cwd: runtime.root,
    stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' }, graceMs: 100 }
  expect(() => launch.spawn(spec)).toThrow('spawn refused')
  await session.close()
})

it('refuses new turns and switches after a failed cancel, then recovers only after confirmation', async () => {
  const { session, native } = await fixture()
  await session.startTurn(textInput('go'))
  native.cancel = () => Promise.reject(new Error('cancel unconfirmed'))
  native.setThinking = () => Promise.resolve()
  await expect(session.cancel({ reason: 'preempt', keepQueue: false })).rejects.toMatchObject({ code: 'brain.cancel_failed' })
  await expect(session.startTurn(textInput('blocked'))).rejects.toMatchObject({ code: 'brain.session_stopping' })
  await expect(session.setThinking('high')).rejects.toMatchObject({ code: 'brain.session_stopping' })
  native.cancel = () => Promise.resolve()
  await session.cancel({ reason: 'preempt', keepQueue: false })
  expect(session.activeTurnId).toBeUndefined()
  expect(session.state).toBe('open')
})

it('keeps a newer provider turn authoritative and bounds remembered terminal turns', async () => {
  const { session, native, emit } = await fixture()
  native.startTurn = async () => {
    emit({ kind: 'turn.started', turnId: TurnId('newer') })
    return { turnId: TurnId('older') }
  }
  await session.startTurn(textInput('go'))
  expect(session.activeTurnId).toBe('newer')
  for (let index = 0; index < 40; index++) emit({ kind: 'turn.completed', turnId: TurnId(`ended-${String(index)}`), usage: {} })
  emit({ kind: 'item.message', turnId: TurnId('newer'), itemId: ItemId('message'), delta: 'still active', final: true })
  expect(session.activeTurnId).toBe('newer')
})

it('disallows process launches before attachment is abandoned and forwards blob and executable operations', async () => {
  const { session, host: runtime } = await fixture(undefined, false)
  const launch = session.launchContext(runtime.ctx.subprocess)
  const ref = await runtime.blobs.put(new Uint8Array([1, 2]), 'application/octet-stream')
  expect([...await launch.readBlob(ref)]).toEqual([1, 2])
  expect(await launch.resolveExecutable(process.execPath)).toBe(process.execPath)
  await session.abandon()
  const spec = { argv: [process.execPath], cwd: runtime.root, stdio: { stdin: 'ignore' as const, stdout: 'inherit' as const, stderr: 'inherit' as const }, graceMs: 100 }
  expect(() => launch.spawn(spec)).toThrow('cannot start processes')
})
