import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBrainTestHost, recordEvents, textInput, type BrainTestHost } from '@liwa/brain-testkit'
import type { BrainProviderSession } from '@liwa/brain'
import { Config, ClaudeBrainProvider, type Config as ClaudeConfig } from '../src/index.ts'
import { CLAUDE_SESSION_UUID, validateResume } from '../src/resume.ts'
import { claudeProjectDir } from '../src/paseo/agent/providers/claude/project-dir.ts'
import { fakeClaudeBinary } from './fixtures/binary.ts'
import { fakeAuthEnv } from './fixtures/auth.ts'

let host: BrainTestHost
const sessions: BrainProviderSession[] = []
afterEach(async () => { for (const session of sessions.splice(0)) await session.close(); await host?.dispose() })
const uuid = '00000000-0000-4000-8000-000000000001'
async function setup() {
  host = await createBrainTestHost()
  const provider = new ClaudeBrainProvider(Config({ binary: await fakeClaudeBinary(host.root), env: fakeAuthEnv, models: [{ id: 'mock', label: 'Mock', isDefault: true }] } as ClaudeConfig))
  const launch = host.launch()
  const handle = { provider: provider.impl, sessionRef: uuid, createdAt: new Date().toISOString(), home: launch.homeDir }
  const project = await claudeProjectDir(host.root, { configDir: launch.homeDir })
  await mkdir(project, { recursive: true })
  return { provider, launch, handle, file: join(project, `${uuid}.jsonl`) }
}
const valid = JSON.stringify({ type: 'user', uuid, sessionId: uuid, message: { role: 'user', content: 'previous turn' } })

describe('native resume admission', () => {
  it('rejects missing, unreadable, malformed and empty transcripts before launching', async () => {
    const { provider, launch, handle, file } = await setup()
    await expect(provider.resumeSession(handle, host.sessionConfig(), launch)).rejects.toMatchObject({ category: 'not_found' })
    await mkdir(file)
    await expect(provider.resumeSession(handle, host.sessionConfig(), launch)).rejects.toMatchObject({ category: 'unavailable', code: 'brain.claude_resume_unreadable' })
    await rm(file, { recursive: true })
    for (const text of ['bad-json', '', 'null', '{}', '{"type":3}', '{"type":"queue-operation"}', '{"type":"user"}', valid.replace(uuid, 'wrong').replace(uuid, 'wrong'), valid.replace('"role":"user"', '"role":"assistant"'), valid.replace('"previous turn"', '3'), valid.replace('{"role":"user","content":"previous turn"}', 'null')]) {
      await writeFile(file, text)
      await expect(provider.resumeSession(handle, host.sessionConfig(), launch)).rejects.toMatchObject({ category: 'unavailable', code: 'brain.claude_resume_corrupt' })
    }
    expect(launch.processes).toHaveLength(0)
  })

  it('checks full UUID, provider and original root; rejects symlinks outside that root', async () => {
    const { provider, launch, handle, file } = await setup()
    await writeFile(file, valid)
    for (const id of ['------------------------------------', '000000000000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', '../session']) {
      expect(CLAUDE_SESSION_UUID.test(id)).toBe(false)
      expect(() => provider.resumeSession({ ...handle, sessionRef: id }, host.sessionConfig(), launch)).toThrow('Resume handle')
    }
    expect(() => provider.resumeSession({ ...handle, provider: 'another' as typeof handle.provider }, host.sessionConfig(), launch)).toThrow('Resume handle')
    const { home: _home, ...unbound } = handle
    await expect(validateResume(unbound, launch.homeDir, host.root)).rejects.toMatchObject({ category: 'invalid_input' })
    await expect(provider.resumeSession(handle, host.sessionConfig(), host.launch())).rejects.toMatchObject({ category: 'invalid_input' })
    await rm(file)
    const outside = join(host.root, 'outside.jsonl')
    await writeFile(outside, valid)
    await symlink(outside, file)
    await expect(validateResume(handle, launch.homeDir, host.root)).rejects.toMatchObject({ category: 'invalid_input' })
  })

  it('accepts native records, supports moved project directory and array message content', async () => {
    const { provider, launch, handle, file } = await setup()
    await writeFile(file, `${JSON.stringify({ type: 'file-history-snapshot' })}\n${valid}\n${valid.replace('"previous turn"', '[]')}\n`)
    await validateResume(handle, launch.homeDir, join(host.root, 'moved'))
    const session = await provider.resumeSession(handle, host.sessionConfig(), launch)
    sessions.push(session)
    expect(session.persistence()).toMatchObject({ home: launch.homeDir, sessionRef: uuid })
  })

  it('retires a resumed session only when the CLI reports the conversation missing', async () => {
    const { provider, launch, handle, file } = await setup()
    await writeFile(file, valid)
    const session = await provider.resumeSession(handle, host.sessionConfig(), launch)
    sessions.push(session)
    await rm(file)
    const events = recordEvents(session)
    await session.startTurn(textInput('scenario:reply'))
    expect((await events.waitForKind('turn.failed')).message).toContain('No conversation found')
    await events.waitForKind('session.exited')
    expect(session.persistence()).toBeNull()
    await expect(session.startTurn(textInput('scenario:reply'))).rejects.toThrow()
  })

  it('keeps the handle when the first resumed turn fails before any model step for another reason', async () => {
    const { provider, launch, handle, file } = await setup()
    await writeFile(file, valid)
    const session = await provider.resumeSession(handle, host.sessionConfig(), launch)
    sessions.push(session)
    const events = recordEvents(session)
    const first = await session.startTurn(textInput('scenario:zero-startup'))
    const failed = await events.waitForKind('turn.failed', event => event.turnId === first.turnId)
    expect(failed.message).toBe('zero-startup original failure')
    expect(failed).not.toHaveProperty('usage')
    expect(session.persistence()).toMatchObject({ home: launch.homeDir, sessionRef: uuid })
    const second = await session.startTurn(textInput('scenario:reply'))
    await events.waitForKind('turn.completed', event => event.turnId === second.turnId)
    expect(events.events.some(event => event.kind === 'session.exited')).toBe(false)
    expect(await readFile(file, 'utf8')).toContain('previous turn')
  })
})

describe('usage across a resume', () => {
  it('settles the first resumed turn from its own frames and carries the cost baseline in the handle', async () => {
    const { provider, launch } = await setup()
    const first = await provider.createSession(host.sessionConfig(), launch)
    sessions.push(first)
    const firstEvents = recordEvents(first)
    const opening = await first.startTurn(textInput('scenario:reply'))
    expect((await firstEvents.waitForKind('turn.completed', event => event.turnId === opening.turnId)).usage).toMatchObject({ tokens: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 }, inferences: 1 })
    const handle = first.persistence()
    expect(handle?.metadata).toEqual({ cumulativeCostUsd: 0.01, cumulativeTokens: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 } })
    await first.close()
    sessions.splice(sessions.indexOf(first), 1)
    const resumed = await provider.resumeSession(handle!, host.sessionConfig(), host.launch(launch.homeDir))
    sessions.push(resumed)
    const events = recordEvents(resumed)
    const turn = await resumed.startTurn(textInput('scenario:reply'))
    const done = await events.waitForKind('turn.completed', event => event.turnId === turn.turnId)
    expect(done.usage).toMatchObject({ tokens: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 }, inferences: 1 })
    expect(done.usage.providerReportedCostUsd).toBeCloseTo(0.01)
    expect(resumed.persistence()?.metadata).toEqual({
      cumulativeCostUsd: 0.02, cumulativeTokens: { input: 20, output: 10, cacheRead: 6, cacheWrite: 4 },
    })
  })

  it('omits the cost of the first resumed turn when the handle carries no baseline', async () => {
    const { provider, launch, handle, file } = await setup()
    await writeFile(file, valid)
    const session = await provider.resumeSession(handle, host.sessionConfig(), launch)
    sessions.push(session)
    const events = recordEvents(session)
    const turn = await session.startTurn(textInput('scenario:reply'))
    const done = await events.waitForKind('turn.completed', event => event.turnId === turn.turnId)
    expect(done.usage).toMatchObject({ tokens: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 }, inferences: 1 })
    expect(done.usage).not.toHaveProperty('providerReportedCostUsd')
  })
})
