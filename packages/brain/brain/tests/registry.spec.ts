import { mkdtemp, readFile, rm, mkdir, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@liwa/cordis'
import LocalSubprocessRuntime from '@liwa/subprocess-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SCRIPTED_META, ScriptedBrainProvider, echoAnswers, recordEvents, sampleSessionConfig, solidPng, textInput,
} from '@liwa/brain-testkit'
import BrainRegistry, {
  BrainBlobStore, BrainError, BrainEventSchema, BrainSessionId, ChildId, ImplId, MemberId, PermissionRequestId, RULES_PRECEDENCE,
  checkPermissionAnswers, homeDirFor, memberMcpServers, mergeLaunchEnv, replaceSkills, resolveBlobsDir, rulesDocument,
  type BrainEvent, type BrainProcessView, type BrainProvider, type BrainProviderSession, type BrainSessionClosedRecord,
  type BrainUsageRecord, type BrainSessionView, type BrainChildView,
} from '../src/index.ts'

const FAKE = ImplId('fake')

interface Fixture {
  ctx: Context
  root: string
  emitted: { name: string; payload: unknown }[]
}

async function setup(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'liwa-brains-'))
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BrainRegistry, { membersRoot: join(root, 'members'), callTimeoutMs: 2_000, closeTimeoutMs: 5_000 })
  const emitted: Fixture['emitted'] = []
  for (const name of [
    'brain.session.opened.v1', 'brain.session.closed.v1', 'brain.process.spawned.v1', 'brain.process.exited.v1',
    'brain.child.opened.v1', 'brain.child.ended.v1', 'brain.usage.v1', 'brain.provider.unavailable.v1',
  ] as const) {
    ctx.on(name, (payload: unknown) => { emitted.push({ name, payload }) })
  }
  return { ctx, root, emitted }
}

function payloads<T>(fixture: Fixture, name: string): T[] {
  return fixture.emitted.filter(entry => entry.name === name).map(entry => entry.payload as T)
}

describe('ctx.brains', () => {
  let fixture: Fixture

  beforeEach(async () => { fixture = await setup() })
  afterEach(async () => {
    await fixture.ctx.fiber.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  })

  const cfg = (overrides: Parameters<typeof sampleSessionConfig>[1] = {}): ReturnType<typeof sampleSessionConfig> =>
    sampleSessionConfig(fixture.root, overrides)


  it.each(['turn.completed', 'turn.interrupted', 'turn.failed'] as const)('settles %s usage once without counting updates or child detail twice', async (kind) => {
    const backing = new ScriptedBrainProvider({ process: false, script: () => ({ steps: [{ kind: 'hold' }] }) })
    let emit: (event: BrainEvent) => void = () => { throw new Error('not subscribed') }
    const create = backing.createSession.bind(backing)
    backing.createSession = async (config, launch) => {
      const native = await create(config, launch)
      const subscribe = native.subscribe.bind(native)
      native.subscribe = (listener) => { emit = listener; return subscribe(listener) }
      return native
    }
    fixture.ctx.brains.register(backing)
    const session = await fixture.ctx.brains.createSession(fixture.ctx, { impl: FAKE, cfg: cfg() })
    const { turnId } = await session.startTurn(textInput('hold'))
    const usage = { tokens: { input: 100, output: 20, cacheRead: 3, cacheWrite: 4 }, inferences: 2, providerReportedCostUsd: 0.4 }
    emit({ kind: 'usage.update', turnId, usage })
    expect(session.usage()).toEqual({})
    const childId = ChildId('usage-detail-child')
    emit({ kind: 'child.started', childId, childKind: 'native-child', label: 'worker', provider: FAKE, turnId })
    emit({ kind: 'child.ended', childId, stopReason: 'completed', usage })
    expect(session.usage()).toEqual({})
    const terminal: BrainEvent = kind === 'turn.failed'
      ? { kind, turnId, category: 'retryable', message: 'failed', retryable: true, usage }
      : kind === 'turn.interrupted' ? { kind, turnId, reason: 'cancelled', usage } : { kind, turnId, usage }
    expect(BrainEventSchema.parse(terminal)).toMatchObject({ usage })
    emit(terminal)
    emit(terminal)
    emit({ kind: 'turn.completed', turnId, usage })
    expect(session.usage()).toMatchObject(usage)
    expect(payloads<BrainUsageRecord>(fixture, 'brain.usage.v1').filter(record => record.source === 'turn')).toHaveLength(1)
  })

  it('keeps terminals without usage backward compatible and does not invent spending from an update', async () => {
    fixture.ctx.brains.register(new ScriptedBrainProvider({ process: false, script: () => ({ steps: [{ kind: 'usage', usage: { tokens: { input: 100, output: 20 } } }, { kind: 'fail', category: 'retryable', message: 'failure' }] }) }))
    const session = await fixture.ctx.brains.createSession(fixture.ctx, { impl: FAKE, cfg: cfg() })
    const recorder = recordEvents(session)
    await session.startTurn(textInput('go'))
    const terminal = await recorder.waitForKind('turn.failed')
    expect(terminal).not.toHaveProperty('usage')
    expect(session.usage().tokens).toBeUndefined()
    expect(payloads<BrainUsageRecord>(fixture, 'brain.usage.v1').filter(record => record.source === 'turn')).toHaveLength(0)
  })

  it('registers, lists, describes, and releases providers', async () => {
    const { ctx } = fixture
    const dispose = ctx.brains.register(new ScriptedBrainProvider())
    expect(ctx.brains.list().map(view => view.impl)).toEqual(['fake'])
    expect(ctx.brains.list()[0]?.available).toBeUndefined()
    expect(ctx.brains.describe(FAKE).transport).toBe('scripted')
    expect(() => ctx.brains.register(new ScriptedBrainProvider())).toThrow(/already registered/)
    dispose()
    await new Promise(resolve => setImmediate(resolve))
    expect(ctx.brains.list()).toEqual([])
    expect(() => ctx.brains.describe(FAKE)).toThrow(BrainError)
  })

  it('rejects an invalid impl or Meta at registration', () => {
    const { ctx } = fixture
    expect(() => ctx.brains.register(new ScriptedBrainProvider({ impl: ImplId('Bad Name') }))).toThrow(/invalid/)
    const broken = new ScriptedBrainProvider({ meta: { kernelTools: [] } })
    expect(() => ctx.brains.register(broken)).toThrow(/meta of provider fake is invalid/)
  })

  it('probes availability and reports an unavailable provider', async () => {
    const { ctx } = fixture
    ctx.brains.register(new ScriptedBrainProvider())
    const result = await ctx.brains.probe(FAKE)
    expect(result.available).toBe(true)
    expect(ctx.brains.list()[0]?.available).toBe(true)
    const broken: BrainProvider = {
      impl: ImplId('broken'),
      meta: SCRIPTED_META,
      sessionHome: 'per-member',
      probe: () => Promise.reject(new Error('binary missing')),
      createSession: () => Promise.reject(new Error('unused')),
      resumeSession: () => Promise.reject(new Error('unused')),
    }
    ctx.brains.register(broken)
    const failed = await ctx.brains.probe(ImplId('broken'))
    expect(failed).toEqual({ available: false, problems: ['binary missing'] })
    expect(payloads(fixture, 'brain.provider.unavailable.v1')).toHaveLength(1)
    await expect(ctx.brains.probe(ImplId('missing'))).rejects.toMatchObject({ category: 'not_found' })
  })

  it('runs a session end to end: events, usage, process ownership, close', async () => {
    const { ctx } = fixture
    ctx.brains.register(new ScriptedBrainProvider())
    const usage: BrainUsageRecord[] = []
    ctx.brains.onUsage(record => usage.push(record))
    const session = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: cfg() })
    expect(ctx.brains.get(session.id)).toBe(session)
    expect(ctx.brains.listSessions().map(view => view.sessionId)).toEqual([session.id])
    expect(payloads<BrainSessionView>(fixture, 'brain.session.opened.v1')[0]?.sessionId).toBe(session.id)
    const spawned = payloads<BrainProcessView>(fixture, 'brain.process.spawned.v1')
    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.sessionId).toBe(session.id)
    expect(ctx.brains.processes()[0]?.state).toBe('live')

    const recorder = recordEvents(session)
    const streamed: BrainEvent[] = []
    const iteration = (async () => { for await (const event of session.events()) streamed.push(event) })()
    const { turnId } = await session.startTurn(textInput('hello'))
    expect(session.activeTurnId).toBe(turnId)
    await expect(session.startTurn(textInput('again'))).rejects.toMatchObject({ code: 'brain.turn_active' })
    const completed = await recorder.waitForKind('turn.completed', event => event.turnId === turnId)
    expect(session.activeTurnId).toBeUndefined()
    expect(session.usage().tokens?.input).toBe(completed.usage.tokens?.input)
    expect(usage.map(record => record.source)).toEqual(['turn'])
    expect(payloads(fixture, 'brain.usage.v1')).toHaveLength(1)
    expect(await session.canStopRuntime()).toBe(true)
    expect(session.persistence()?.provider).toBe('fake')

    await session.close()
    await iteration
    expect(streamed.map(event => event.kind)).toContain('turn.completed')
    expect(streamed.at(-1)?.kind).toBe('process.exited')
    expect(session.state).toBe('closed')
    expect(ctx.brains.get(session.id)).toBeUndefined()
    const exited = payloads<BrainProcessView>(fixture, 'brain.process.exited.v1')
    expect(exited).toHaveLength(1)
    expect(exited[0]?.state).toBe('exited')
    const closed = payloads<BrainSessionClosedRecord>(fixture, 'brain.session.closed.v1')
    expect(closed[0]?.session.closeReason).toBe('closed')
    expect(closed[0]?.usage.tokens).toBeDefined()
    await expect(session.startTurn(textInput('late'))).rejects.toMatchObject({ code: 'brain.session_closed' })
    expect(await session.deliver(textInput('late'), { semantics: 'next_turn', wake: true })).toBe('unavailable')
    await session.cancel({ reason: 'owner', keepQueue: false })
    expect(session.subscribe(() => {})).toBeTypeOf('function')
  })

  it('applies the three pre-session checks', async () => {
    const { ctx } = fixture
    ctx.brains.register(new ScriptedBrainProvider({ impl: ImplId('always-on'), meta: { compaction: 'always_on', nativeTools: true } }))
    await expect(ctx.brains.createSession(ctx, { impl: ImplId('always-on'), cfg: cfg({ compaction: 'off' }) }))
      .rejects.toMatchObject({ code: 'brain.compaction_always_on' })
    await expect(ctx.brains.createSession(ctx, { impl: ImplId('always-on'), cfg: cfg({ nativeToolPolicy: 'none' }) }))
      .rejects.toMatchObject({ code: 'brain.native_tools_not_removable' })
    await expect(ctx.brains.createSession(ctx, { impl: ImplId('always-on'), cfg: { ...cfg(), member: '*' } }))
      .rejects.toMatchObject({ category: 'invalid_input' })
    const think = await ctx.brains.createSession(ctx, { impl: ImplId('always-on'), cfg: cfg({ mindKind: 'think' }) })
    expect(think.config.childPolicy.native).toBe(false)
    expect(think.view().adjustments).toHaveLength(1)
    const work = await ctx.brains.createSession(ctx, { impl: ImplId('always-on'), cfg: cfg() })
    expect(work.config.childPolicy.native).toBe(true)
    expect(work.view().adjustments).toEqual([])
  })

  it('short-circuits unsupported delivery and relays supported delivery', async () => {
    const { ctx } = fixture
    ctx.brains.register(new ScriptedBrainProvider({ impl: ImplId('plain'), meta: { delivery: { nextStep: false, nextTurn: false, cancelKeepsQueue: false } } }))
    ctx.brains.register(new ScriptedBrainProvider())
    const plain = await ctx.brains.createSession(ctx, { impl: ImplId('plain'), cfg: cfg() })
    expect(await plain.deliver(textInput('x'), { semantics: 'next_step', wake: false })).toBe('unsupported')
    expect(await plain.deliver(textInput('x'), { semantics: 'next_turn', wake: true })).toBe('unsupported')
    const full = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: cfg() })
    const recorder = recordEvents(full)
    expect(await full.deliver(textInput('queued work'), { semantics: 'next_turn', wake: true })).toBe('accepted')
    const started = await recorder.waitForKind('turn.started')
    await recorder.waitForKind('turn.completed', event => event.turnId === started.turnId)
    const { turnId } = await full.startTurn(textInput('long'))
    expect(await full.deliver(textInput('steer me'), { semantics: 'next_step', wake: false, expectedTurnId: turnId })).toBe('accepted')
    await recorder.waitForKind('item.message', event => event.delta.includes('steer me'))
    await full.cancel({ reason: 'owner', keepQueue: false })
    await recorder.waitForKind('turn.interrupted', event => event.turnId === turnId)
    expect(full.activeTurnId).toBeUndefined()
  })

  it('tracks permissions and children, and aborts running children on close', async () => {
    const { ctx } = fixture
    ctx.brains.register(new ScriptedBrainProvider({
      script: () => ({
        steps: [
          { kind: 'permission', tool: 'shell', args: { command: 'ls' }, result: 'ok' },
          { kind: 'child', label: 'scout', steps: [{ kind: 'text', text: 'found it' }], usage: { tokens: { input: 1, output: 2 } } },
          { kind: 'child', label: 'stuck', steps: [{ kind: 'hold' }] },
        ],
      }),
    }))
    const session = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: cfg() })
    const recorder = recordEvents(session)
    await session.startTurn(textInput('go'))
    const request = await recorder.waitForKind('permission.request')
    expect(session.pendingPermissions().map(pending => pending.requestId)).toEqual([request.requestId])
    expect(await session.canStopRuntime()).toBe(false)
    await expect(session.respondToPermission(PermissionRequestId('nope'), { optionId: 'allow-once' }))
      .rejects.toMatchObject({ code: 'brain.permission_unknown' })
    await session.respondToPermission(request.requestId, { optionId: 'allow-once' })
    expect(session.pendingPermissions()).toEqual([])
    await recorder.waitForKind('child.ended')
    await recorder.waitForKind('child.started', event => event.label === 'stuck')
    expect(ctx.brains.children(session.id).map(child => [child.label, child.state])).toEqual([['scout', 'ended'], ['stuck', 'running']])
    expect(payloads<BrainUsageRecord>(fixture, 'brain.usage.v1').some(record => record.source === 'child' && record.childId !== undefined)).toBe(true)
    await session.close()
    const ended = payloads<BrainChildView>(fixture, 'brain.child.ended.v1')
    expect(ended.map(child => [child.label, child.stopReason])).toEqual([['scout', 'completed'], ['stuck', 'aborted']])
    expect(recorder.events.filter(event => event.kind === 'child.ended').at(-1)).toMatchObject({ stopReason: 'aborted' })
    expect(() => ctx.brains.children(session.id)).toThrow(/no open brain session/)
  })

  it('closes the session when its CLI exits between turns', async () => {
    const { ctx } = fixture
    ctx.brains.register(new ScriptedBrainProvider())
    const session = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: cfg() })
    const recorder = recordEvents(session)
    await session.startTurn(textInput('exit'))
    await recorder.waitForKind('session.exited')
    await recorder.waitForKind('process.exited')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(session.state).toBe('closed')
    expect(payloads<BrainSessionClosedRecord>(fixture, 'brain.session.closed.v1')[0]?.session.closeReason).toBe('process_exit')
  })

  it('marks a session stopping when cancel fails and recovers after a later cancel', async () => {
    const { ctx } = fixture
    let fail = true
    const inner = new ScriptedBrainProvider()
    const provider: BrainProvider = {
      impl: ImplId('flaky'),
      meta: inner.meta,
      sessionHome: 'per-member',
      probe: context => inner.probe(context),
      resumeSession: (handle, config, launch) => inner.resumeSession(handle, config, launch),
      async createSession(config, launch) {
        const session = await inner.createSession(config, launch)
        const wrapped: BrainProviderSession = Object.create(session) as BrainProviderSession
        const cancel = session.cancel.bind(wrapped)
        wrapped.cancel = async (options) => {
          if (fail) throw new Error('cancel refused')
          // The wrapper inherits the session's state through its prototype, so run the original against it.
          return cancel(options)
        }
        return wrapped
      },
    }
    ctx.brains.register(provider)
    const session = await ctx.brains.createSession(ctx, { impl: ImplId('flaky'), cfg: cfg() })
    const recorder = recordEvents(session)
    const { turnId } = await session.startTurn(textInput('long'))
    await expect(session.cancel({ reason: 'watchdog', keepQueue: false })).rejects.toMatchObject({ code: 'brain.cancel_failed' })
    expect(session.state).toBe('stopping')
    expect(await session.deliver(textInput('x'), { semantics: 'next_step', wake: false })).toBe('unavailable')
    await expect(session.startTurn(textInput('more'))).rejects.toMatchObject({ code: 'brain.session_stopping' })
    expect(await session.canStopRuntime()).toBe(false)
    fail = false
    await session.cancel({ reason: 'watchdog', keepQueue: false })
    expect(session.state).toBe('open')
    await recorder.waitForKind('turn.interrupted', event => event.turnId === turnId)
  })

  it('resumes a persisted session and refuses resume where unsupported', async () => {
    const { ctx } = fixture
    ctx.brains.register(new ScriptedBrainProvider())
    ctx.brains.register(new ScriptedBrainProvider({ impl: ImplId('no-resume'), meta: { resume: false } }))
    const first = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: cfg() })
    const recorder = recordEvents(first)
    await first.startTurn(textInput('hi'))
    await recorder.waitForKind('turn.completed')
    const handle = first.persistence()
    if (handle === null) throw new Error('expected a resume handle')
    await first.close()
    const second = await ctx.brains.resumeSession(ctx, { impl: FAKE, resume: handle, cfg: cfg() })
    expect(second.view().resumedFrom?.sessionRef).toBe(handle.sessionRef)
    expect(second.persistence()?.sessionRef).toBe(handle.sessionRef)
    await expect(ctx.brains.resumeSession(ctx, { impl: ImplId('no-resume'), resume: handle, cfg: cfg() }))
      .rejects.toMatchObject({ code: 'brain.resume_unsupported' })
    await expect(ctx.brains.resumeSession(ctx, { impl: FAKE, resume: { ...handle, provider: ImplId('other') }, cfg: cfg() }))
      .rejects.toMatchObject({ code: 'brain.resume_provider_mismatch' })
    await expect(ctx.brains.resumeSession(ctx, { impl: FAKE, resume: { ...handle, createdAt: 'yesterday' }, cfg: cfg() }))
      .rejects.toMatchObject({ category: 'invalid_input' })
  })

  it('closes sessions with their owner, their provider, and the service', async () => {
    const { ctx } = fixture
    const providerFiber = ctx.plugin({
      name: 'test-provider',
      inject: ['brains'],
      apply(pluginCtx: Context) { pluginCtx.brains.register(new ScriptedBrainProvider()) },
    })
    await providerFiber
    const ownerFiber = ctx.plugin({ name: 'test-owner', inject: ['brains'], apply() {} })
    await ownerFiber
    const owned = await ctx.brains.createSession(ownerFiber.ctx, { impl: FAKE, cfg: cfg() })
    await ownerFiber.dispose()
    expect(owned.state).toBe('closed')
    expect(payloads<BrainSessionClosedRecord>(fixture, 'brain.session.closed.v1').at(-1)?.session.closeReason).toBe('owner')
    const byProvider = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: cfg() })
    await providerFiber.dispose()
    expect(byProvider.state).toBe('closed')
    expect(payloads<BrainSessionClosedRecord>(fixture, 'brain.session.closed.v1').at(-1)?.session.closeReason).toBe('service')
  })

  it('leaves cross-CLI child tasks unimplemented', async () => {
    const { ctx } = fixture
    await expect(ctx.brains.openChildTask(ctx, { parentTask: 'task-1', impl: FAKE, cfg: cfg() }))
      .rejects.toMatchObject({ category: 'unavailable', code: 'brain.not_implemented' })
  })

  it('times out a provider that never opens and closes the late session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'liwa-brains-slow-'))
    const ctx = new Context()
    try {
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(BrainRegistry, { membersRoot: root, handshakeTimeoutMs: 50 })
      const inner = new ScriptedBrainProvider({ process: false })
      let lateClosed = false
      ctx.brains.register({
        impl: FAKE,
        meta: inner.meta,
        sessionHome: 'per-member',
        probe: context => inner.probe(context),
        resumeSession: (handle, config, launch) => inner.resumeSession(handle, config, launch),
        async createSession(config, launch) {
          await new Promise(resolve => setTimeout(resolve, 150))
          const session = await inner.createSession(config, launch)
          const close = session.close.bind(session)
          session.close = async () => {
            lateClosed = true
            await close()
          }
          return session
        },
      })
      await expect(ctx.brains.createSession(ctx, { impl: FAKE, cfg: sampleSessionConfig(root) })).rejects.toMatchObject({ category: 'timeout' })
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(lateClosed).toBe(true)
      expect(ctx.brains.listSessions()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lets each provider write its own part of the member configuration directory', async () => {
    const { ctx, root } = fixture
    const skills = join(root, 'skills')
    await mkdir(join(skills, 'review'), { recursive: true })
    await writeFile(join(skills, 'review', 'SKILL.md'), '# review\n')
    const writes: { dir: string; model: string | undefined }[] = []
    ctx.brains.register(new ScriptedBrainProvider({
      impl: ImplId('writer'),
      memberConfig: async (dir, spec) => {
        writes.push({ dir, model: spec.model })
        await writeFile(join(dir, 'RULES.md'), rulesDocument(spec.rules))
        await writeFile(join(dir, 'mcp.json'), JSON.stringify(memberMcpServers(spec)))
        await replaceSkills(spec.skillsDir, join(dir, 'skills'))
      },
    }))
    ctx.brains.register(new ScriptedBrainProvider({ impl: ImplId('bare'), sessionHome: 'per-session' }))
    const spec = {
      rules: 'Report back in Chinese.',
      skillsDir: skills,
      projectDocs: false,
      mcpServers: { files: { type: 'stdio' as const, command: 'mcp-files', args: ['--root', '/'] } },
      kernelTools: { endpoint: 'http://127.0.0.1:9/mcp', token: 'token-1', tools: [] },
    }
    const member = MemberId('mina')
    const dir = await ctx.brains.prepareConfigDir(member, ImplId('writer'), spec)
    expect(dir).toBe(join(root, 'members', 'mina', 'brains'))
    // 不给模型就不写占位值。
    expect(writes).toEqual([{ dir: join(dir, 'writer'), model: undefined }])
    expect(await readFile(join(dir, 'writer', 'RULES.md'), 'utf8')).toBe(`${RULES_PRECEDENCE}\n\nReport back in Chinese.\n`)
    expect(JSON.parse(await readFile(join(dir, 'writer', 'mcp.json'), 'utf8'))).toMatchObject({
      liwa: { type: 'http', url: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer token-1' } },
      files: { type: 'stdio', command: 'mcp-files' },
    })
    expect(await readFile(join(dir, 'writer', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('# review\n')
    await ctx.brains.prepareConfigDir(member, ImplId('bare'), { ...spec, rules: '' })
    expect((await stat(join(dir, 'bare'))).isDirectory()).toBe(true)
    await expect(ctx.brains.prepareConfigDir(member, ImplId('writer'), { ...spec, skillsDir: join(root, 'missing') }))
      .rejects.toMatchObject({ code: 'brain.skills_dir_missing' })
    await expect(ctx.brains.prepareConfigDir(member, ImplId('nobody'), spec)).rejects.toMatchObject({ code: 'brain.provider_unknown' })
    expect(homeDirFor(dir, ImplId('bare'), BrainSessionId('brain-session-1'), 'per-session')).toBe(join(dir, 'bare', 'brain-session-1'))
    expect(homeDirFor(dir, ImplId('writer'), BrainSessionId('brain-session-1'), 'per-member')).toBe(join(dir, 'writer'))
  })

  it('opens a session without a model and resumes a per-session provider in the same home', async () => {
    const { ctx } = fixture
    ctx.brains.register(new ScriptedBrainProvider({ impl: ImplId('homed'), sessionHome: 'per-session', process: false }))
    const config = cfg()
    expect(config.model).toBeUndefined()
    const first = await ctx.brains.createSession(ctx, { impl: ImplId('homed'), cfg: config })
    expect(first.view().model).toBeUndefined()
    const home = first.view().homeDir
    expect(home).toBe(join(config.configDir, 'homed', first.id))
    const recorder = recordEvents(first)
    const { turnId } = await first.startTurn(textInput('hello'))
    await recorder.waitForKind('turn.completed', event => event.turnId === turnId)
    const handle = first.persistence()
    expect(handle?.home).toBe(home)
    await first.close()
    if (handle === null) return
    const resumed = await ctx.brains.resumeSession(ctx, { impl: ImplId('homed'), resume: handle, cfg: config })
    expect(resumed.view().homeDir).toBe(home)
    await resumed.close()
    await expect(ctx.brains.resumeSession(ctx, { impl: ImplId('homed'), resume: { ...handle, home: '/elsewhere' }, cfg: config }))
      .rejects.toMatchObject({ code: 'brain.resume_home_outside' })
  })

  it('switches models and modes behind capability and lifecycle checks, and makes the change observable', async () => {
    const { ctx } = fixture
    ctx.brains.register(new ScriptedBrainProvider({ process: false }))
    ctx.brains.register(new ScriptedBrainProvider({ impl: ImplId('fixed'), process: false, meta: { modelSwitch: false, modeSwitch: false } }))
    const session = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: cfg({ modeId: 'plan' }) })
    const events = recordEvents(session).events
    expect(session.view().modeId).toBe('plan')
    await session.setModel('scripted-large')
    expect(session.view().model).toBe('scripted-large')
    expect(events.filter(event => event.kind === 'session.model_changed')).toEqual([{ kind: 'session.model_changed', model: 'scripted-large' }])
    await expect(session.setModel('scripted-missing')).rejects.toMatchObject({ code: 'brain.model_unknown' })
    expect(session.view().model).toBe('scripted-large')
    expect((await session.availableModes()).map(mode => mode.id)).toEqual(['default', 'plan'])
    expect(await session.currentMode()).toBe('plan')
    expect(await session.setMode('default')).toEqual({ modeId: 'default', appliesAt: 'now' })
    expect(session.view().modeId).toBe('default')
    expect(events.filter(event => event.kind === 'session.mode_changed')).toEqual([{ kind: 'session.mode_changed', modeId: 'default' }])
    await expect(session.setMode('bypass')).rejects.toMatchObject({ code: 'brain.mode_unknown' })
    const fixed = await ctx.brains.createSession(ctx, { impl: ImplId('fixed'), cfg: cfg() })
    await expect(fixed.setModel('scripted-large')).rejects.toMatchObject({ code: 'brain.model_switch_unsupported' })
    await expect(fixed.setMode('plan')).rejects.toMatchObject({ code: 'brain.mode_switch_unsupported' })
    expect(await fixed.availableModes()).toEqual([])
    expect(await fixed.currentMode()).toBeNull()
    await expect(ctx.brains.createSession(ctx, { impl: ImplId('fixed'), cfg: cfg({ modeId: 'plan' }) })).rejects.toMatchObject({ code: 'brain.mode_switch_unsupported' })
    await session.close()
    await expect(session.setModel('scripted-small')).rejects.toMatchObject({ code: 'brain.session_closed' })
    await expect(session.setMode('plan')).rejects.toMatchObject({ code: 'brain.session_closed' })
  })

  it('checks question answers before they reach the provider, and keeps child requests across parent turns', async () => {
    const { ctx } = fixture
    ctx.brains.register(new ScriptedBrainProvider({ process: false }))
    const session = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: cfg() })
    const recorder = recordEvents(session)
    const { turnId } = await session.startTurn(textInput('question please'))
    const request = await recorder.waitForKind('permission.request', event => event.category === 'question')
    expect(BrainEventSchema.safeParse(request).success).toBe(true)
    await expect(session.respondToPermission(request.requestId, { optionId: 'answer' })).rejects.toMatchObject({ code: 'brain.permission_answers_invalid' })
    await expect(session.respondToPermission(request.requestId, { optionId: 'answer', answers: { color: { selected: ['green'] } } })).rejects.toMatchObject({ code: 'brain.permission_answers_invalid' })
    await expect(session.respondToPermission(request.requestId, { optionId: 'decline', answers: { color: { selected: ['red'] } } })).rejects.toMatchObject({ code: 'brain.permission_answers_unexpected' })
    expect(session.pendingPermissions()).toHaveLength(1)
    await session.respondToPermission(request.requestId, { optionId: 'answer', answers: { color: { selected: [], custom: 'teal' } } })
    await recorder.waitForKind('turn.completed', event => event.turnId === turnId)
    expect(recorder.events.some(event => event.kind === 'item.message' && event.delta.includes(echoAnswers({ color: { selected: [], custom: 'teal' } })))).toBe(true)
    expect(checkPermissionAnswers([{ id: 'q', question: 'Q', options: [{ label: 'a' }, { label: 'b' }], multiSelect: false }], { q: { selected: ['a', 'b'] } }))
      .toMatch(/takes one option/)
    expect(checkPermissionAnswers([{ id: 'q', question: 'Q', options: [], multiSelect: false }], { q: { selected: [] } })).toMatch(/is invalid/)
    expect(checkPermissionAnswers([{ id: 'q', question: 'Q', options: [], multiSelect: false }], { other: { selected: ['x'] } })).toMatch(/unknown question/)
    // 普通工具请求不带答案。
    const tool = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: cfg() })
    const toolRecorder = recordEvents(tool)
    await tool.startTurn(textInput('permission please'))
    const toolRequest = await toolRecorder.waitForKind('permission.request')
    await expect(tool.respondToPermission(toolRequest.requestId, { optionId: 'allow-once', answers: {} })).rejects.toMatchObject({ code: 'brain.permission_answers_unexpected' })
    // 子 agent 的条目可以只带 childId；父会话自己的条目必带回合号。
    expect(BrainEventSchema.safeParse({ kind: 'item.message', itemId: 'i', delta: 'x', final: true, childId: 'c' }).success).toBe(true)
    expect(BrainEventSchema.safeParse({ kind: 'item.message', itemId: 'i', delta: 'x', final: true }).success).toBe(false)
    expect(BrainEventSchema.safeParse({ kind: 'permission.request', turnId: 't', requestId: 'r', category: 'question', tool: 't', args: null, options: [{ id: 'a', label: 'A', effect: 'allow_once' }] }).success).toBe(false)
  })

  it('stores turn-input blobs by content and refuses references that do not match', async () => {
    const { ctx, root } = fixture
    const png = solidPng(2, 2, [1, 2, 3])
    const ref = await ctx.brains.blobs.put(png, 'image/png')
    expect(ref).toMatchObject({ bytes: png.byteLength, mime: 'image/png' })
    expect(await ctx.brains.blobs.put(png, 'image/png')).toEqual(ref)
    expect(Buffer.from(await ctx.brains.blobs.readBlob(ref)).equals(Buffer.from(png))).toBe(true)
    expect(ctx.brains.blobs.dir).toBe(join(root, 'members', '.blobs'))
    await expect(ctx.brains.blobs.readBlob({ ...ref, bytes: ref.bytes + 1 })).rejects.toMatchObject({ code: 'brain.blob_mismatch' })
    await expect(ctx.brains.blobs.readBlob({ ...ref, blob: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'brain.blob_missing' })
    await expect(ctx.brains.blobs.readBlob({ ...ref, blob: 'nope' })).rejects.toMatchObject({ code: 'brain.blob_ref_invalid' })
    expect(resolveBlobsDir({ membersRoot: '/m', blobsDir: '/b' })).toBe('/b')
    const elsewhere = new BrainBlobStore(join(root, 'other'))
    await expect(elsewhere.readBlob(ref)).rejects.toMatchObject({ code: 'brain.blob_missing' })
    // 提供方经启动上下文读到同一份字节。
    ctx.brains.register(new ScriptedBrainProvider({ process: false }))
    const session = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: cfg() })
    const recorder = recordEvents(session)
    const { turnId } = await session.startTurn({ blocks: [{ kind: 'text', text: 'image please' }, { kind: 'image', blob: ref }] })
    await recorder.waitForKind('turn.completed', event => event.turnId === turnId)
    expect(recorder.events.some(event => event.kind === 'item.message' && event.delta.includes(`image/png ${String(png.byteLength)}B`))).toBe(true)
  })

  it('merges the session environment with what the provider injects, refusing clashes', () => {
    expect(mergeLaunchEnv('x', { KEY: 'k' }, { EXTRA: 'e' })).toEqual({ EXTRA: 'e', KEY: 'k' })
    expect(mergeLaunchEnv('x', { KEY: 'k' }, undefined)).toEqual({ KEY: 'k' })
    expect(() => mergeLaunchEnv('x', { KEY: 'k' }, { KEY: 'other' })).toThrow(/KEY/)
  })
})

describe('agent configuration capabilities', () => {
  it('refuses plugins, hooks and instructions a provider does not load, before opening anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'liwa-brains-caps-'))
    const ctx = new Context()
    try {
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(BrainRegistry, { membersRoot: join(root, 'members'), callTimeoutMs: 2_000, closeTimeoutMs: 5_000 })
      const agentConfig = { plugins: false, hooks: false, instructions: false }
      ctx.brains.register(new ScriptedBrainProvider({ process: false, meta: { agentConfig } }))
      const base = sampleSessionConfig(root)
      for (const extra of [
        { plugins: ['/srv/plugin'] },
        { hooks: { PreToolUse: [{ hooks: [{ type: 'command' as const, command: 'echo' }] }] } },
        { instructions: 'be brief' },
      ]) {
        await expect(ctx.brains.createSession(ctx, { impl: FAKE, cfg: { ...base, ...extra } })).rejects.toMatchObject({ code: 'brain.agent_config_unsupported' })
      }
      const session = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: { ...base, plugins: [], hooks: {}, instructions: '   ' } })
      await session.close()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('thinking switch capability', () => {
  it('refuses setThinking on a provider that does not declare thinkingSwitch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'liwa-brains-thinking-'))
    const ctx = new Context()
    try {
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(BrainRegistry, { membersRoot: join(root, 'members'), callTimeoutMs: 2_000, closeTimeoutMs: 5_000 })
      ctx.brains.register(new ScriptedBrainProvider({ process: false }))
      const session = await ctx.brains.createSession(ctx, { impl: FAKE, cfg: sampleSessionConfig(root, { thinking: 'high' }) })
      expect(session.view().thinking).toBe('high')
      await expect(session.setThinking('off')).rejects.toMatchObject({ code: 'brain.thinking_switch_unsupported' })
      await session.close()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
