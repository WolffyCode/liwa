import { afterEach, describe, expect, it } from 'vitest'
import { createBrainTestHost, recordEvents } from '../src/harness.ts'
import { ScriptedBrainProvider } from '../src/scripted-provider.ts'
import { textInput } from '../src/index.ts'

const hosts: Awaited<ReturnType<typeof createBrainTestHost>>[] = []
afterEach(async () => { for (const host of hosts.splice(0)) await host.dispose() })
describe('scripted abnormal terminal spending', () => {
  it.each(['fail', 'cancel'] as const)('carries explicitly observed %s usage', async (outcome) => {
    const host = await createBrainTestHost()
    hosts.push(host)
    const usage = { tokens: { input: 17, output: 3 }, inferences: 1 }
    const provider = new ScriptedBrainProvider({ process: false, script: () => ({ usage, steps: outcome === 'fail' ? [{ kind: 'fail', category: 'retryable', message: 'failed' }] : [{ kind: 'hold' }] }) })
    const session = await provider.createSession(host.sessionConfig(), host.launch())
    const events = recordEvents(session)
    await session.startTurn(textInput('go'))
    if (outcome === 'cancel') await session.cancel({ reason: 'owner', keepQueue: false })
    const event = outcome === 'fail' ? await events.waitForKind('turn.failed') : await events.waitForKind('turn.interrupted')
    expect(event).toHaveProperty('usage', usage)
    await session.close()
  })
})
