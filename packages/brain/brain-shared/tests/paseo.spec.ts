import { Context } from '@liwa/cordis'
import LocalSubprocessRuntime from '@liwa/subprocess-local'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProviderProcessHost } from '@liwa/brain'
import {
  checkProviderLaunchAvailable, createProviderEnv, createProviderEnvSpec, isProviderCommandAvailable, resolveProviderLaunch,
  resolveShellEnv,
} from '../src/paseo/agent/provider-launch-config.ts'
import { buildBinaryDiagnosticRows, buildCommandResolutionDiagnosticRows, resolveBinaryVersion } from '../src/paseo/agent/providers/diagnostic-utils.ts'
import { ProviderSubagentStore } from '../src/paseo/agent/provider-subagents/store.ts'
import { buildToolCallDisplayModel } from '../src/paseo/protocol/tool-call-display.ts'
import { ProviderOverrideSchema } from '../src/paseo/protocol/provider-config.ts'

// Migrated Paseo modules are upstream code; these checks cover the lines Liwa changed in place.
describe('migrated Paseo modules', () => {
  const ctx = new Context()
  let host: ProviderProcessHost

  beforeAll(async () => {
    await ctx.plugin(LocalSubprocessRuntime)
    host = ctx.subprocess
  })
  afterAll(async () => { await ctx.fiber.dispose() })

  it('resolves provider launches through the subprocess seam', async () => {
    const launch = await resolveProviderLaunch({ defaultBinary: process.execPath })
    expect(await checkProviderLaunchAvailable(launch, host)).toEqual({ available: true, resolvedPath: process.execPath })
    const missing = await resolveProviderLaunch({ commandConfig: { mode: 'replace', argv: ['liwa-no-such-binary-for-tests'] } })
    expect((await checkProviderLaunchAvailable(missing, host)).available).toBe(false)
    expect(await isProviderCommandAvailable(undefined, () => process.execPath, host)).toBe(true)
    expect(await isProviderCommandAvailable({ mode: 'replace', argv: ['liwa-no-such-binary-for-tests'] }, () => 'x', host)).toBe(false)
  })

  it('builds provider environments from the scrubbed parent environment', () => {
    process.env.LIWA_BRAIN_SHARED_TEST = 'secret'
    try {
      const env = createProviderEnv({ overlays: [{ EXTRA: 'yes' }] })
      expect(env.EXTRA).toBe('yes')
      expect(env.LIWA_BRAIN_SHARED_TEST).toBeUndefined()
      expect(env.CLAUDECODE).toBeUndefined()
      expect(resolveShellEnv().LIWA_BRAIN_SHARED_TEST).toBeUndefined()
      expect(createProviderEnvSpec().envOverlay).toHaveProperty('CLAUDECODE', undefined)
    } finally {
      delete process.env.LIWA_BRAIN_SHARED_TEST
    }
  })

  it('runs diagnostics through the subprocess seam', async () => {
    expect(await resolveBinaryVersion(host, process.execPath)).toBe(process.version)
    const launch = await resolveProviderLaunch({ defaultBinary: process.execPath })
    const availability = await checkProviderLaunchAvailable(launch, host)
    const rows = await buildBinaryDiagnosticRows(host, launch, availability)
    expect(rows.find(row => row.label === 'Version')?.value).toBe(process.version)
    const resolution = await buildCommandResolutionDiagnosticRows(host, launch, { knownBinaryNames: ['node'], includeCommandProbes: false })
    expect(resolution.map(row => row.label)).toContain('PATH matches')
  })

  it('keeps provider subagent descriptors and timelines', () => {
    const store = new ProviderSubagentStore()
    store.apply('agent-1', 'claude', { type: 'upsert', id: 'task-1', title: 'explore', status: 'running' })
    store.apply('agent-1', 'claude', { type: 'timeline', id: 'task-1', item: { type: 'assistant_message', text: 'hi' } })
    store.apply('agent-1', 'claude', { type: 'upsert', id: 'task-1', status: 'completed' })
    expect(store.list('agent-1')).toMatchObject([{ id: 'task-1', title: 'explore', status: 'completed' }])
    expect(store.fetchTimeline('agent-1', 'task-1').rows).toHaveLength(1)
  })

  it('displays tool calls without the Paseo tool catalog', () => {
    expect(buildToolCallDisplayModel({
      name: 'paseo__create_agent',
      status: 'completed',
      error: null,
      detail: { type: 'unknown', input: {}, output: null },
    }).displayName).toBe('paseo__create_agent')
    expect(buildToolCallDisplayModel({
      name: 'shell',
      status: 'failed',
      error: 'boom',
      detail: { type: 'shell', command: 'ls' },
    })).toEqual({ displayName: 'Shell', summary: 'ls', errorText: 'boom' })
    expect(ProviderOverrideSchema.safeParse({ command: ['claude'] }).success).toBe(true)
  })
})
