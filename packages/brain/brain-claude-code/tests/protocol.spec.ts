import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBrainTestHost, recordEvents, textInput, type BrainTestHost } from '@liwa/brain-testkit'
import type { BrainProviderSession, SessionConfig } from '@liwa/brain'
import { Config, ClaudeBrainProvider, type Config as ClaudeConfig } from '../src/index.ts'
import { fakeClaudeBinary } from './fixtures/binary.ts'
import { fakeAuthEnv } from './fixtures/auth.ts'

let host: BrainTestHost
const sessions: BrainProviderSession[] = []
afterEach(async () => { for (const session of sessions.splice(0)) await session.close(); await host?.dispose() })
async function setup() {
  host = await createBrainTestHost()
  return new ClaudeBrainProvider(Config({ binary: await fakeClaudeBinary(host.root), controlTimeoutMs: 150, env: fakeAuthEnv, models: [
    { id: 'mock', label: 'Mock', isDefault: true }, { id: 'mock-other', label: 'Other', isDefault: false },
  ] } as ClaudeConfig))
}
async function open(provider: ClaudeBrainProvider, patch: Partial<SessionConfig> = {}, home?: string) {
  const launch = host.launch(home)
  const session = await provider.createSession(host.sessionConfig(patch), launch)
  sessions.push(session)
  return { session, launch, events: recordEvents(session) }
}

describe('stream-json protocol boundaries', () => {
  it('does not terminalize a cancellation without its result and refuses new work', async () => {
    const entry = await open(await setup(), { env: { LIWA_TEST_CANCEL_ORDER: 'no-result' } })
    await entry.session.startTurn(textInput('scenario:long'))
    await expect(entry.session.cancel({ reason: 'preempt', keepQueue: false })).rejects.toThrow('result was not received')
    expect(entry.events.events.some(event => event.kind === 'turn.interrupted')).toBe(false)
    await expect(entry.session.startTurn(textInput('scenario:reply'))).rejects.toThrow('active')
  })

  it.each(['child-early', 'child-late', 'child-missing'])('handles %s announcements through real SDK callbacks', async (scenario) => {
    const entry = await open(await setup())
    await entry.session.startTurn(textInput(`scenario:${scenario}`))
    if (scenario === 'child-early') {
      const request = await entry.events.waitForKind('permission.request')
      const child = await entry.events.waitForKind('child.started')
      expect(request.childId).toBe(child.childId)
      await entry.session.respondToPermission(request.requestId, { optionId: request.options.find(option => option.effect === 'allow_once')!.id })
    }
    await entry.events.waitForKind('turn.completed')
    if (scenario !== 'child-early') {
      expect(entry.events.events.some(event => event.kind === 'permission.request')).toBe(false)
      expect(entry.events.events.filter(event => event.kind === 'item.message').map(event => event.delta).join('')).toContain('denied')
      if (scenario === 'child-late') expect((await entry.events.waitForKind('child.started')).childId).toBe('child-tool')
    }
  })

  it.each(['multi', 'custom'])('round-trips unambiguous %s answers through SDK', async (answer) => {
    const entry = await open(await setup())
    await entry.session.startTurn(textInput('scenario:question-multi'))
    const request = await entry.events.waitForKind('permission.request')
    if (request.category !== 'question' || request.questions === undefined) throw new Error('expected question')
    const q = request.questions[0]!
    await entry.session.respondToPermission(request.requestId, { optionId: request.options.find(option => option.effect === 'allow_once')!.id, answers: { [q.id]: answer === 'multi' ? { selected: q.options.map(option => option.label) } : { selected: [], custom: 'Green' } } })
    await entry.events.waitForKind('turn.completed')
    expect(entry.events.events.filter(event => event.kind === 'item.message').map(event => event.delta).join('')).toBe(answer === 'multi' ? 'Red, Blue' : 'Green')
  })

  it('differences model totals when switching away and back within one Query', async () => {
    const entry = await open(await setup())
    for (const model of ['mock', 'mock-other', 'mock']) {
      await entry.session.setModel?.(model)
      const turn = await entry.session.startTurn(textInput('scenario:reply'))
      const result = await entry.events.waitForKind('turn.completed', event => event.turnId === turn.turnId)
      expect(result.usage.tokens).toEqual({ input: 10, output: 5, cacheRead: 3, cacheWrite: 2 })
      expect(result.usage.providerReportedCostUsd).toBeCloseTo(0.01)
    }
    expect(entry.launch.processes).toHaveLength(2)
  })

  it('runs two SDK processes in one member root with independent model, mode, approvals, MCP and skills', async () => {
    const provider = await setup()
    const root = join(host.root, 'shared-member')
    await mkdir(root)
    const entries = await Promise.all(['one', 'two'].map(async (id, i) => {
      const skills = join(host.root, `source-${id}`)
      await mkdir(join(skills, 'review'), { recursive: true })
      await writeFile(join(skills, 'review', 'SKILL.md'), `# ${id}`)
      return open(provider, {
        model: i === 0 ? 'mock' : 'mock-other', modeId: i === 0 ? 'default' : 'plan', skillsDir: skills,
        permission: { mode: 'kernel', autoAllow: i === 0 ? ['report'] : [] },
        mcpServers: { explicit: { type: 'http', url: `https://${id}.invalid/mcp`, headers: { Authorization: `fake-${id}` } } },
      }, root)
    }))
    await Promise.all(entries.map(entry => entry.session.startTurn(textInput('scenario:permission'))))
    await entries[0]!.events.waitForKind('turn.completed')
    const ask = await entries[1]!.events.waitForKind('permission.request')
    expect(entries[0]!.events.events.some(event => event.kind === 'permission.request')).toBe(false)
    await entries[1]!.session.respondToPermission(ask.requestId, { optionId: ask.options.find(option => option.effect === 'allow_once')!.id })
    await entries[1]!.events.waitForKind('turn.completed')
    const snapshots: string[] = []
    for (const [i, id] of ['one', 'two'].entries()) {
      const entry = entries[i]!
      const capture = JSON.parse(await readFile(join(root, `${entry.session.persistence()!.sessionRef}.capture.json`), 'utf8')) as { args: string[]; model: string; mode: string }
      expect(capture.model).toBe(i === 0 ? 'mock' : 'mock-other')
      expect(capture.mode).toBe(i === 0 ? 'default' : 'plan')
      expect(capture.args.join(' ')).toContain(`${id}.invalid`)
      expect(capture.args.join(' ')).not.toContain(`${id === 'one' ? 'two' : 'one'}.invalid`)
      const index = capture.args.indexOf('--plugin-dir')
      const snapshot = capture.args[index + 1]!
      expect(index).toBeGreaterThan(-1)
      snapshots.push(snapshot)
      expect(await readFile(join(snapshot, 'skills/review/SKILL.md'), 'utf8')).toBe(`# ${id}`)
    }
    expect(snapshots[0]).not.toBe(snapshots[1])
    await entries[0]!.session.close()
    await expect(stat(snapshots[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(snapshots[1]!)).isDirectory()).toBe(true)
    const next = await entries[1]!.session.startTurn(textInput('scenario:reply'))
    await entries[1]!.events.waitForKind('turn.completed', event => event.turnId === next.turnId)
  })
})
