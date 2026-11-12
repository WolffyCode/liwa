import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentMetadata, AgentPermissionRequest } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { ImplId, type PermissionAnswer, type PermissionQuestion } from '@liwa/brain'
import { paseoLogger } from '@liwa/brain-shared'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { AcpBrainProvider, AcpBrainSession, GenericACPAgentClient, genericAcpMeta, toPaseoLaunchContext, toPaseoMcpServers, toPaseoSessionConfig } from '../src/index.ts'

describe('ACP adapter: session configuration it carries or refuses', () => {
  let host: BrainTestHost | undefined
  afterEach(async () => { await host?.dispose() })

  it('keeps alwaysLoad, passes the mode, and refuses alwaysLoad when the CLI may defer tools', async () => {
    host = await createBrainTestHost()
    expect(toPaseoMcpServers({ kernel: { type: 'http', url: 'http://x', alwaysLoad: true }, local: { type: 'stdio', command: 'x', alwaysLoad: false } }))
      .toEqual({ kernel: { type: 'http', url: 'http://x', alwaysLoad: true }, local: { type: 'stdio', command: 'x', alwaysLoad: false } })
    const config = host.sessionConfig({ modeId: 'plan', mcpServers: { kernel: { type: 'http', url: 'http://x', alwaysLoad: true } } })
    expect(toPaseoSessionConfig('acp', config, false)).toMatchObject({ provider: 'acp', modeId: 'plan' })
    const launch = host.launch()
    const provider = new AcpBrainProvider({
      impl: ImplId('acp'),
      meta: genericAcpMeta(process.execPath),
      client: new GenericACPAgentClient({ logger: paseoLogger(host.ctx.logger('t')), command: [process.execPath], providerId: 'acp', processHost: host.ctx.subprocess }),
    })
    await expect(provider.createSession(config, launch)).rejects.toMatchObject({ code: 'brain.mcp_always_load_unsupported' })
    expect(launch.processes).toEqual([])
    expect(toPaseoLaunchContext(launch, {})).not.toHaveProperty('env')
    expect(toPaseoLaunchContext(launch, { A: '1' })).toMatchObject({ env: { A: '1' }, agentId: launch.sessionId })
  })
})

it('preserves optional MCP fields and explicitly suppresses model selection', async () => {
  const host = await createBrainTestHost()
  try {
    const config = host.sessionConfig({ model: 'mock', mcpServers: { local: { type: 'stdio', command: 'local', args: ['x'], env: { A: '1' } }, remote: { type: 'http', url: 'https://x.invalid', headers: { X: 'y' }, alwaysLoad: false } } })
    expect(toPaseoSessionConfig('acp', config, false)).not.toHaveProperty('model')
    expect(toPaseoSessionConfig('acp', config, true)).toHaveProperty('model', 'mock')
    expect(toPaseoMcpServers({ h: { type: 'http', url: 'https://x.invalid' } })).toEqual({ h: { type: 'http', url: 'https://x.invalid' } })
    expect(toPaseoMcpServers(config.mcpServers!)).toMatchObject({ local: { args: ['x'], env: { A: '1' } }, remote: { headers: { X: 'y' }, alwaysLoad: false } })
  } finally { await host.dispose() }
})

class ExposedAcpSession extends AcpBrainSession {
  options(request: AgentPermissionRequest) { return this.permissionOptions(request) }
  questions(request: AgentPermissionRequest) { return this.permissionQuestions(request) }
  answer(request: AgentPermissionRequest, questions: PermissionQuestion[], answers: Record<string, PermissionAnswer>): AgentMetadata {
    return this.permissionAnswerInput(request, questions, answers)
  }
}

it('handles availability, best-effort version failures, unsupported modes/resume and permanent-only permissions', async () => {
  const host = await createBrainTestHost()
  const client = new GenericACPAgentClient({
    logger: paseoLogger(host.ctx.logger('adapter-boundaries')),
    command: [process.execPath, '--import', import.meta.resolve('tsx/esm'), fileURLToPath(new URL('./fixtures/mock-acp-agent.ts', import.meta.url))],
    providerId: 'acp', processHost: host.ctx.subprocess,
  })
  const init = { impl: ImplId('acp'), meta: genericAcpMeta(process.execPath), client }
  try {
    const unavailable = vi.spyOn(client, 'isAvailable').mockResolvedValueOnce(false)
    expect(await new AcpBrainProvider(init).probe(host.probeContext())).toMatchObject({ available: false })
    unavailable.mockRestore()
    expect(await new AcpBrainProvider(init).probe(host.probeContext())).not.toHaveProperty('version')
    const failVersion = new AcpBrainProvider({ ...init, versionCommand: [process.execPath, '-e', 'process.exit(1)'] })
    expect(await failVersion.probe(host.probeContext())).toMatchObject({ available: true })
    const stderrVersion = new AcpBrainProvider({ ...init, versionCommand: [process.execPath, '-e', 'process.stderr.write("stderr-version")'] })
    expect(await stderrVersion.probe({ ...host.probeContext(), signal: new AbortController().signal })).toHaveProperty('version', 'stderr-version')
    const unsupported = new AcpBrainProvider({ ...init, meta: { ...init.meta, resume: false } })
    await expect(unsupported.resumeSession({ provider: init.impl, sessionRef: 'native', createdAt: new Date().toISOString() }, host.sessionConfig(), host.launch())).rejects.toMatchObject({ code: 'brain.resume_unsupported' })
    await expect(new AcpBrainProvider(init).createSession(host.sessionConfig({ modeId: 'not-offered' }), host.launch())).rejects.toMatchObject({ code: 'brain.mode_unknown' })
    const launch = host.launch()
    const native = await client.createSession({ provider: 'acp', cwd: host.root }, toPaseoLaunchContext(launch))
    const session = new ExposedAcpSession({ impl: init.impl, meta: init.meta, session: native, blobs: launch })
    const request: AgentPermissionRequest = { id: 'r', provider: 'acp', name: 'Tool', kind: 'tool', metadata: { options: [null, 1, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }, { optionId: 'forever', name: 'Always', kind: 'allow_always' }, { optionId: 'no', name: 'Never', kind: 'reject_always' }] } }
    expect(session.options(request).map(choice => choice.option.effect)).toEqual(['deny_once', 'allow_always'])
    expect(session.options({ ...request, metadata: { options: [{ optionId: 'no', kind: 'reject_always' }] } })).toEqual([])
    expect(session.options({ ...request, metadata: {} }).length).toBeGreaterThan(0)
    const question: AgentPermissionRequest = { id: 'q', provider: 'acp', name: 'Ask', kind: 'question', input: { questions: [{ header: 'h', question: 'Which?', options: [{ label: 'A' }] }] } }
    const questions = session.questions(question)
    expect(session.answer(question, questions, { h: { selected: ['A'] } })).toBeDefined()
    await session.cancel({ reason: 'preempt', keepQueue: false })
    await session.close()
    const nativeHandle = native.describePersistence()
    if (nativeHandle !== null) {
      const handle = { provider: init.impl, sessionRef: nativeHandle.sessionId, createdAt: new Date().toISOString() }
      const resumed = await new AcpBrainProvider(init).resumeSession(handle, host.sessionConfig(), host.launch())
      await resumed.close()
    }
  } finally { await host.dispose() }
})
