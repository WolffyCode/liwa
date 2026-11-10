import { fakeClaudeBinary } from './fixtures/binary.ts'
import { fakeAuthEnv } from './fixtures/auth.ts'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrainTestHost, recordEvents, textInput, type BrainTestHost } from '@liwa/brain-testkit'
import type { BrainProviderSession, SessionConfigInput } from '@liwa/brain'
import { ClaudeAgentSession } from '../src/paseo/agent/providers/claude/agent.ts'
import { Config, ClaudeBrainProvider, type Config as ClaudeConfig } from '../src/index.ts'


const settings = (binary: string, impl = 'claude-code'): ClaudeConfig => Config({ impl, binary, env: fakeAuthEnv, models: [{ id: 'mock', label: 'Mock', isDefault: true }] } as ClaudeConfig)
let host: BrainTestHost | undefined
const sessions: BrainProviderSession[] = []
afterEach(async () => { for (const session of sessions.splice(0)) await session.close(); await host?.dispose() })

async function setup(env?: Record<string, string>, patch: Partial<ClaudeConfig> = {}, overrides: Partial<SessionConfigInput> = {}) {
  host = await createBrainTestHost()
  const instance = Object.assign(settings(await fakeClaudeBinary(host.root)), patch)
  const provider = new ClaudeBrainProvider(instance)
  const launch = host.launch()
  const config = host.sessionConfig({ ...overrides, ...(env === undefined ? {} : { env }), kernelTools: { endpoint: 'http://127.0.0.1:1/mcp', token: 'fake', tools: [{ id: 'report', description: 'Report', schema: {} }] } })
  const session = await provider.createSession(config, launch)
  sessions.push(session)
  return { provider, session, launch, events: recordEvents(session) }
}

describe('Claude SDK integration', () => {
  it('uses SDK hooks to conclude a successful batch before another model step', async () => {
    const { session, events } = await setup()
    await session.startTurn(textInput('scenario:conclude'))
    expect(await events.waitForKind('turn.completed')).toMatchObject({ concludedBy: 'report', usage: { tokens: { input: 10, cacheRead: 3, cacheWrite: 2 } } })
    expect(events.events.filter(event => event.kind === 'item.message').map(event => event.delta).join('')).not.toContain('continued')
  })

  it('lets a failed conclude tool continue and does not claim conclusion', async () => {
    const { session, events } = await setup()
    await session.startTurn(textInput('scenario:conclude-fail'))
    expect(await events.waitForKind('turn.completed')).not.toHaveProperty('concludedBy')
    expect(events.events.filter(event => event.kind === 'item.message').map(event => event.delta).join('')).toContain('continued')
  })

  it('reports usage on failure and interruption, including the result arriving after interrupt', async () => {
    const { session, events } = await setup()
    const first = await session.startTurn(textInput('scenario:fail'))
    expect(await events.waitForKind('turn.failed', event => event.turnId === first.turnId)).toMatchObject({ usage: { tokens: { input: 10 } } })
    const second = await session.startTurn(textInput('scenario:long'))
    await session.cancel({ reason: 'owner', keepQueue: false })
    expect(await events.waitForKind('turn.interrupted', event => event.turnId === second.turnId)).toMatchObject({ usage: { tokens: { input: 10 } } })
  })

  it.each(['LIWA_TEST_INTERRUPT_FAIL', 'LIWA_TEST_WITHDRAW_FAIL'])('propagates %s and does not falsely terminalize', async (flag) => {
    const { session, events } = await setup({ [flag]: 'yes' })
    await session.startTurn(textInput('scenario:long'))
    await expect(session.cancel({ reason: 'preempt', keepQueue: false })).rejects.toThrow(/failed/)
    expect(events.events.some(event => event.kind === 'turn.interrupted')).toBe(false)
    await expect(session.startTurn(textInput('scenario:reply'))).rejects.toThrow(/active/)
  })

  it('runs independent instances concurrently with different homes, endpoints and key references', async () => {
    host = await createBrainTestHost()
    const launches = [host.launch(), host.launch()]
    const providers = await Promise.all(['one', 'two'].map(async impl => new ClaudeBrainProvider(Object.assign(settings(await fakeClaudeBinary(host!.root), impl), { env: { [impl === 'one' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN']: `key-${impl}`, ANTHROPIC_BASE_URL: `https://${impl}.invalid`, ANTHROPIC_DEFAULT_HAIKU_MODEL: `${impl}-haiku`, ANTHROPIC_DEFAULT_SONNET_MODEL: `${impl}-sonnet`, ANTHROPIC_DEFAULT_OPUS_MODEL: `${impl}-opus`, ANTHROPIC_MODEL: `${impl}-main`, CLAUDE_CODE_SUBAGENT_MODEL: `${impl}-child`, API_TIMEOUT_MS: '60000', ANTHROPIC_CUSTOM_HEADERS: `extra-${impl}` } }))))
    const opened = await Promise.all(providers.map((provider, i) => provider.createSession(host!.sessionConfig(), launches[i]!)))
    sessions.push(...opened)
    const events = opened.map(recordEvents)
    await Promise.all(opened.map(session => session.startTurn(textInput('scenario:reply'))))
    await Promise.all(events.map(event => event.waitForKind('turn.completed')))
    for (const [i, impl] of ['one', 'two'].entries()) {
      const capture = JSON.parse(await readFile(join(launches[i]!.homeDir, `${opened[i]!.persistence()!.sessionRef}.capture.json`), 'utf8')) as { args: string[]; secureStorage?: string }
      expect(capture).toMatchObject({ configDir: launches[i]!.homeDir, baseUrl: `https://${impl}.invalid`, authVariables: [impl === 'one' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'], authType: impl === 'one' ? 'api-key' : 'auth-token', authHash: createHash('sha256').update(`key-${impl}`).digest('hex'), extraHash: createHash('sha256').update(`extra-${impl}`).digest('hex'), env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: `${impl}-haiku`, ANTHROPIC_DEFAULT_SONNET_MODEL: `${impl}-sonnet`, ANTHROPIC_DEFAULT_OPUS_MODEL: `${impl}-opus`, ANTHROPIC_MODEL: `${impl}-main`, CLAUDE_CODE_SUBAGENT_MODEL: `${impl}-child`, API_TIMEOUT_MS: '60000' } })
      const publicData = JSON.stringify([capture, opened[i]!.persistence(), await readFile(join(launches[i]!.homeDir, 'settings.json'), 'utf8')])
      for (const secret of [`key-${impl}`, `extra-${impl}`]) expect(publicData).not.toContain(secret)
      expect(capture.secureStorage).toBeUndefined()
      expect(capture.args).toContain('--setting-sources=')
      expect(capture.args).toContain('--strict-mcp-config')
      expect(capture.args).toContain('--max-turns')
    }
  })
})

it('refuses cross-provider or malformed resume handles before launch', async () => {
  const { provider, launch } = await setup()
  const handle = { provider: provider.impl, sessionRef: 'not-a-uuid', createdAt: new Date().toISOString() }
  expect(() => provider.resumeSession(handle, host!.sessionConfig(), launch)).toThrow('Resume handle')
})

it('opens directly in plan mode and reports a process crash without fabricated usage', async () => {
  host = await createBrainTestHost()
  const provider = new ClaudeBrainProvider(settings(await fakeClaudeBinary(host.root)))
  const session = await provider.createSession(host.sessionConfig({ modeId: 'plan' }), host.launch())
  sessions.push(session)
  expect(await session.currentMode?.()).toBe('plan')
  const events = recordEvents(session)
  await session.startTurn(textInput('scenario:crash'))
  expect(await events.waitForKind('turn.failed')).not.toHaveProperty('usage')
})

it('leaves an unobserved model breakdown and context absent', async () => {
  const { session, events } = await setup()
  await session.startTurn(textInput('scenario:unknown'))
  const event = await events.waitForKind('turn.completed')
  expect(event.usage.tokens).toBeUndefined()
  expect(event.usage.context).toBeUndefined()
})

it('withdraws a turn cancelled while the SDK is still opening', async () => {
  const { session, events } = await setup()
  let cancellation: Promise<void> | undefined
  const off = session.subscribe((event) => {
    if (event.kind === 'turn.started') cancellation = session.cancel({ reason: 'owner', keepQueue: false })
  })
  await session.startTurn(textInput('scenario:reply'))
  await cancellation
  off()
  expect(events.events.some(event => event.kind === 'item.message')).toBe(false)
  expect(events.events.filter(event => event.kind === 'turn.interrupted')).toHaveLength(1)
  const next = await session.startTurn(textInput('scenario:reply'))
  await events.waitForKind('turn.completed', event => event.turnId === next.turnId)
})

it('shares one opening Query between concurrent model and mode controls', async () => {
  const { session, launch } = await setup()
  await Promise.all([session.setModel?.('mock'), session.setMode?.('plan')])
  expect(launch.processes).toHaveLength(2) // one version probe and one persistent SDK CLI
})

it('honors an owner session grant through the next kernel permission hook', async () => {
  host = await createBrainTestHost()
  const provider = new ClaudeBrainProvider(settings(await fakeClaudeBinary(host.root)))
  const session = await provider.createSession(host.sessionConfig({ permission: { mode: 'kernel', autoAllow: [] } }), host.launch())
  sessions.push(session)
  const events = recordEvents(session)
  const first = await session.startTurn(textInput('scenario:permission'))
  const request = await events.waitForKind('permission.request')
  const choice = request.options.find(option => option.effect === 'allow_session')
  expect(choice).toBeDefined()
  await session.respondToPermission(request.requestId, { optionId: choice!.id })
  await events.waitForKind('turn.completed', event => event.turnId === first.turnId)
  const second = await session.startTurn(textInput('scenario:permission'))
  await events.waitForKind('turn.completed', event => event.turnId === second.turnId)
  expect(events.events.filter(event => event.kind === 'permission.request')).toHaveLength(1)
})

it('rejects image types the SDK cannot encode instead of silently dropping them', async () => {
  const { session } = await setup()
  const blob = await host!.blobs.put(new Uint8Array([1, 2, 3]), 'image/bmp')
  const input = { blocks: [{ kind: 'image' as const, blob }] }
  await expect(session.startTurn(input)).rejects.toMatchObject({ category: 'invalid_input' })
  const { turnId } = await session.startTurn(textInput('scenario:long'))
  await expect(session.deliver(input, { semantics: 'next_step', wake: false, expectedTurnId: turnId })).rejects.toMatchObject({ category: 'invalid_input' })
  await session.cancel({ reason: 'owner', keepQueue: false })
})

it('preserves incremental text, thinking and tool JSON through the official SDK', async () => {
  const { session, events } = await setup()
  await session.startTurn(textInput('scenario:stream'))
  await events.waitForKind('turn.completed')
  expect(events.events.filter(event => event.kind === 'item.message').map(event => event.delta).join('')).toBe('text-stream')
  expect(events.events.filter(event => event.kind === 'item.reasoning').map(event => event.summary).join('')).toBe('reason-stream')
  expect(JSON.stringify(events.events.filter(event => event.kind === 'item.tool_call.started'))).toContain('/stream.txt')
})

it.each(['zero-crash', 'zero-startup'])('preserves %s failure and leaves its spending unknown after a successful turn', async (scenario) => {
  const { session, events } = await setup()
  await session.startTurn(textInput('scenario:reply'))
  await events.waitForKind('turn.completed')
  const failure = await session.startTurn(textInput(`scenario:${scenario}`))
  const event = await events.waitForKind('turn.failed', item => item.turnId === failure.turnId)
  expect(event.message).toBe(`${scenario} original failure`)
  expect(event).not.toHaveProperty('usage')
  const third = await session.startTurn(textInput('scenario:reply'))
  expect(await events.waitForKind('turn.completed', item => item.turnId === third.turnId)).toMatchObject({ usage: { tokens: { input: 10 }, providerReportedCostUsd: 0.01 } })
})

it.each(['result-first', 'response-first'])('settles interrupted usage with %s', async (order) => {
  const { session, events } = await setup({ LIWA_TEST_CANCEL_ORDER: order })
  await session.startTurn(textInput('scenario:long'))
  await session.cancel({ reason: 'preempt', keepQueue: false })
  expect(await events.waitForKind('turn.interrupted')).toMatchObject({ usage: { tokens: { input: 10 } } })
})

it('redacts split stderr, error results, logs and thrown SDK control errors', async () => {
  const { session, events, launch } = await setup({ LIWA_TEST_CONTROL_FAILURE: 'yes' }, { env: { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_CUSTOM_HEADERS: 'gateway-fake-token' } })
  const logs: string[] = []
  for (const level of ['debug', 'info', 'warn', 'error'] as const) launch.logger[level] = (...args) => { logs.push(JSON.stringify(args)) }
  await session.startTurn(textInput('scenario:secret-error'))
  const failure = await events.waitForKind('turn.failed')
  expect(failure.message).toContain('[redacted]')
  expect(failure.diagnostic).toContain('[redacted]')
  await expect(session.setModel?.('mock')).rejects.toThrow('control failed [redacted]')
  expect(JSON.stringify([events.events, logs])).not.toContain('test-key')
  expect(JSON.stringify([events.events, logs])).not.toContain('gateway-fake-token')
})


it('releases policy and a partially constructed native session when initialization fails', async () => {
  host = await createBrainTestHost()
  const provider = new ClaudeBrainProvider(settings(await fakeClaudeBinary(host.root)))
  await expect(provider.createSession(host.sessionConfig({ env: { HOME: '/forbidden' } }), host.launch())).rejects.toMatchObject({ category: 'invalid_input' })
  const ready = vi.spyOn(ClaudeAgentSession.prototype, 'ensureHistoryReady').mockRejectedValueOnce(new Error('injected history initialization failure'))
  const close = vi.spyOn(ClaudeAgentSession.prototype, 'close')
  await expect(provider.createSession(host.sessionConfig(), host.launch())).rejects.toThrow('injected history initialization failure')
  expect(close).toHaveBeenCalledOnce()
  ready.mockRestore()
  close.mockRestore()
})

it('lists default, plan, acceptEdits and auto modes and switches to acceptEdits', async () => {
  const { session } = await setup()
  expect((await session.availableModes?.())?.map(mode => mode.id)).toEqual(['default', 'plan', 'acceptEdits', 'auto'])
  await session.setMode?.('acceptEdits')
  expect(await session.currentMode?.()).toBe('acceptEdits')
})

it('redacts MCP header tokens and the kernel token from failures, not only the instance key', async () => {
  const secret = 'mcp-header-secret-9f3a'
  const { session, events } = await setup({ LIWA_TEST_ECHO: secret }, {}, {
    mcpServers: { docs: { type: 'http', url: 'https://x.invalid', headers: { Authorization: `Bearer ${secret}` } } },
  })
  await session.startTurn(textInput('scenario:secret-error'))
  const failed = await events.waitForKind('turn.failed')
  expect(JSON.stringify([failed, events.events])).not.toContain(secret)
})

it('passes instance binary arguments before the SDK arguments and uses them for the version probe', async () => {
  host = await createBrainTestHost()
  const provider = new ClaudeBrainProvider(Object.assign(settings(await fakeClaudeBinary(host.root)), { binaryArgs: ['--liwa-wrapper', 'tag-1'] }))
  expect((await provider.probe(host.probeContext())).available).toBe(true)
  const launch = host.launch()
  const session = await provider.createSession(host.sessionConfig(), launch)
  sessions.push(session)
  const events = recordEvents(session)
  await session.startTurn(textInput('scenario:reply'))
  await events.waitForKind('turn.completed')
  const capture = JSON.parse(await readFile(join(launch.homeDir, `${session.persistence()!.sessionRef}.capture.json`), 'utf8')) as { args: string[] }
  expect(capture.args.slice(0, 2)).toEqual(['--liwa-wrapper', 'tag-1'])
})

describe('runtime thinking switch', () => {
  const thinkingSettings = async (): Promise<ClaudeConfig> => Object.assign(settings(await fakeClaudeBinary(host!.root)), {
    models: [
      { id: 'mock', label: 'Mock', isDefault: true, thinkingOptions: [{ id: 'high', label: 'High', isDefault: true }, { id: 'off', label: 'Off', isDefault: false }] },
      { id: 'mock-other', label: 'Other', isDefault: false, thinkingOptions: [{ id: 'high', label: 'High', isDefault: true }] },
      { id: 'mock-quiet', label: 'Quiet', isDefault: false, thinkingOptions: [{ id: 'off', label: 'Off', isDefault: true }] },
    ],
  })

  it('switches thinking between turns by restarting the query with the new effort, and reports the change', async () => {
    host = await createBrainTestHost()
    const provider = new ClaudeBrainProvider(await thinkingSettings())
    const launch = host.launch()
    const session = await provider.createSession(host.sessionConfig(), launch)
    sessions.push(session)
    const events = recordEvents(session)
    const first = await session.startTurn(textInput('scenario:reply'))
    await events.waitForKind('turn.completed', event => event.turnId === first.turnId)
    const captureFile = join(launch.homeDir, `${session.persistence()!.sessionRef}.capture.json`)
    expect((JSON.parse(await readFile(captureFile, 'utf8')) as { args: string[] }).args).toEqual(expect.arrayContaining(['--effort', 'high']))
    await session.setThinking!('off')
    await events.waitForKind('session.thinking_changed', event => event.thinking === 'off')
    const second = await session.startTurn(textInput('scenario:reply'))
    await events.waitForKind('turn.completed', event => event.turnId === second.turnId)
    const args = (JSON.parse(await readFile(captureFile, 'utf8')) as { args: string[] }).args
    expect(args).toEqual(expect.arrayContaining(['--thinking', 'disabled']))
    expect(args).not.toContain('--effort')
    // 版本探测一个进程，切档前后各一个 Query。
    expect(launch.processes).toHaveLength(3)
  })

  it('re-applies the new model\'s default option on a model switch when the session follows defaults', async () => {
    host = await createBrainTestHost()
    const provider = new ClaudeBrainProvider(await thinkingSettings())
    const launch = host.launch()
    const session = await provider.createSession(host.sessionConfig(), launch)
    sessions.push(session)
    const events = recordEvents(session)
    await session.setModel!('mock-quiet')
    const turn = await session.startTurn(textInput('scenario:reply'))
    await events.waitForKind('turn.completed', event => event.turnId === turn.turnId)
    const captureFile = join(launch.homeDir, `${session.persistence()!.sessionRef}.capture.json`)
    const args = (JSON.parse(await readFile(captureFile, 'utf8')) as { args: string[] }).args
    expect(args).toEqual(expect.arrayContaining(['--thinking', 'disabled', '--model', 'mock-quiet']))
    expect(events.events.some(event => event.kind === 'session.thinking_changed')).toBe(false)
  })

  it('refuses an option the model does not offer, a switch during a turn, and a model switch that drops the current option', async () => {
    host = await createBrainTestHost()
    const provider = new ClaudeBrainProvider(await thinkingSettings())
    const session = await provider.createSession(host.sessionConfig({ thinking: 'off' }), host.launch())
    sessions.push(session)
    const events = recordEvents(session)
    await expect(session.setThinking!('max')).rejects.toMatchObject({ code: 'brain.claude_thinking' })
    await expect(session.setModel!('mock-other')).rejects.toMatchObject({ code: 'brain.claude_thinking' })
    const turn = await session.startTurn(textInput('scenario:long'))
    await expect(session.setThinking!('high')).rejects.toMatchObject({ category: 'conflict' })
    await session.cancel({ reason: 'owner', keepQueue: false })
    await events.waitForKind('turn.interrupted', event => event.turnId === turn.turnId)
    await session.setThinking!('high')
    await session.setModel!('mock-other')
  })
})
