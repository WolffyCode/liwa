import { mkdtemp, readFile, rm, mkdir, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@liwa/cordis'
import LocalSubprocessRuntime from '@liwa/subprocess-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SCRIPTED_META, ScriptedBrainProvider, recordEvents, sampleSessionConfig, textInput,
} from '@liwa/brain-testkit'
import BrainRegistry, {
  BrainError, BrainSessionId, ImplId, MemberId, PermissionRequestId, RULES_PRECEDENCE, homeDirFor,
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

  it('prepares the member configuration directory for each CLI', async () => {
    const { ctx, root } = fixture
    const skills = join(root, 'skills')
    await mkdir(join(skills, 'review'), { recursive: true })
    await writeFile(join(skills, 'review', 'SKILL.md'), '# review\n')
    const spec = {
      rules: 'Report back in Chinese.',
      skillsDir: skills,
      projectDocs: false,
      model: 'sonnet',
      mcpServers: { files: { type: 'stdio' as const, command: 'mcp-files', args: ['--root', '/'], env: { A: 'b' } } },
      kernelTools: { endpoint: 'http://127.0.0.1:9/mcp', token: 'token-1', tools: [] },
    }
    const member = MemberId('mina')
    const dir = await ctx.brains.prepareConfigDir(member, ImplId('claude'), spec)
    expect(dir).toBe(join(root, 'members', 'mina', 'brains'))
    expect(await readFile(join(dir, 'claude', 'CLAUDE.md'), 'utf8')).toBe(`${RULES_PRECEDENCE}\n\nReport back in Chinese.\n`)
    expect(JSON.parse(await readFile(join(dir, 'claude', 'settings.json'), 'utf8'))).toEqual({ model: 'sonnet' })
    expect(await readFile(join(dir, 'claude', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('# review\n')
    expect((await stat(join(dir, 'claude', 'projects'))).isDirectory()).toBe(true)
    await ctx.brains.prepareConfigDir(member, ImplId('codex'), { ...spec, skillsDir: '' })
    const toml = await readFile(join(dir, 'codex', 'config.toml'), 'utf8')
    expect(toml).toContain('model = "sonnet"')
    expect(toml).toContain('project_doc_max_bytes = 0')
    expect(toml).toContain('[mcp_servers."liwa"]\nurl = "http://127.0.0.1:9/mcp"\nhttp_headers = { "Authorization" = "Bearer token-1" }')
    expect(toml).toContain('[mcp_servers."files"]\ncommand = "mcp-files"\nargs = ["--root", "/"]\nenv = { "A" = "b" }')
    expect(await readFile(join(dir, 'codex', 'AGENTS.md'), 'utf8')).toContain(RULES_PRECEDENCE)
    await ctx.brains.prepareConfigDir(member, ImplId('deepseek'), { ...spec, rules: '' })
    expect((await stat(join(dir, 'deepseek'))).isDirectory()).toBe(true)
    await expect(ctx.brains.prepareConfigDir(member, ImplId('claude'), { ...spec, skillsDir: join(root, 'missing') }))
      .rejects.toMatchObject({ code: 'brain.skills_dir_missing' })
    expect(homeDirFor(dir, ImplId('deepseek'), BrainSessionId('brain-session-1'))).toBe(join(dir, 'deepseek', 'brain-session-1'))
    expect(homeDirFor(dir, ImplId('claude'), BrainSessionId('brain-session-1'))).toBe(join(dir, 'claude'))
  })
})
