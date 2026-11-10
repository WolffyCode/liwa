import { afterEach, describe, expect, it } from 'vitest'
import { createBrainTestHost, recordEvents, textInput, type BrainTestHost } from '@liwa/brain-testkit'
import type { BrainProviderSession } from '@liwa/brain'
import { Config, ClaudeBrainProvider, type Config as ClaudeConfig } from '../src/index.ts'
import { fakeClaudeBinary } from './fixtures/binary.ts'
import { fakeAuthEnv } from './fixtures/auth.ts'

let host: BrainTestHost
const sessions: BrainProviderSession[] = []
afterEach(async () => { for (const session of sessions.splice(0)) await session.close(); await host?.dispose() })

async function open(env?: Record<string, string>, controlTimeoutMs = 30_000) {
  host = await createBrainTestHost()
  const provider = new ClaudeBrainProvider(Config({ binary: await fakeClaudeBinary(host.root), env: fakeAuthEnv, controlTimeoutMs, models: [{ id: 'mock', label: 'Mock', isDefault: true }] } as ClaudeConfig))
  const session = await provider.createSession(host.sessionConfig(env === undefined ? {} : { env }), host.launch())
  sessions.push(session)
  return { session, events: recordEvents(session) }
}

async function startWhenStopped(session: BrainProviderSession, text: string): Promise<{ turnId: string }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      return await session.startTurn(textInput(text))
    } catch (error) {
      if (!/active or stopping/.test(String(error))) throw error
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  throw new Error('the interrupted session never became idle')
}

describe('API retry handling', () => {
  it('fails the turn at once when the CLI keeps retrying an authentication failure, and stays usable', async () => {
    const { session, events } = await open()
    const turn = await session.startTurn(textInput('scenario:api-retry-401'))
    const failed = await events.waitForKind('turn.failed', event => event.turnId === turn.turnId, 10_000)
    expect(failed.message).toMatch(/authentication failed.*401/i)
    expect(events.events.some(event => event.kind === 'turn.interrupted')).toBe(false)
    const next = await startWhenStopped(session, 'scenario:reply')
    await events.waitForKind('turn.completed', event => event.turnId === next.turnId)
  })

  it('keeps the session stopping until the CLI confirms the interrupt, so a new turn cannot race the old query', async () => {
    const { session, events } = await open({ LIWA_TEST_CANCEL_ORDER: 'no-result' }, 400)
    const turn = await session.startTurn(textInput('scenario:api-retry-401'))
    await events.waitForKind('turn.failed', event => event.turnId === turn.turnId, 10_000)
    await expect(session.startTurn(textInput('scenario:reply'))).rejects.toThrow(/active or stopping/)
  })

  it('lets the CLI retry transient API errors and completes the turn', async () => {
    const { session, events } = await open()
    const turn = await session.startTurn(textInput('scenario:api-retry-529'))
    await events.waitForKind('turn.completed', event => event.turnId === turn.turnId)
    expect(events.events.filter(event => event.kind === 'item.message').map(event => event.delta).join('')).toBe('recovered')
  })
})
