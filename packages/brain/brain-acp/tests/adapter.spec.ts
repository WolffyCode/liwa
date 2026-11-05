import { afterEach, describe, expect, it } from 'vitest'
import { ImplId } from '@liwa/brain'
import { paseoLogger } from '@liwa/brain-shared'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { AcpBrainProvider, GenericACPAgentClient, genericAcpMeta, toPaseoLaunchContext, toPaseoMcpServers, toPaseoSessionConfig } from '../src/index.ts'

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
