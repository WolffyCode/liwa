import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { fakeAuthEnv } from './fixtures/auth.ts'
import { resolveClaudeExecutable } from '../src/probe.ts'
import { Config } from '../src/config.ts'
import { ClaudeBrainProvider } from '../src/provider.ts'

let host: BrainTestHost | undefined
afterEach(async () => { await host?.dispose() })
it('probes the selected binary, rejects old/malformed versions, and respects cancellation', async () => {
  host = await createBrainTestHost()
  const binary = join(host.root, 'version-cli')
  const config = Config({ binary, env: fakeAuthEnv, models: [{ id: 'mock', label: 'Mock', isDefault: true, thinkingOptions: [] }] })
  for (const [version, valid] of [['2.1.317 (Claude Code)', false], ['2.1.318 (wrapper)', false], ['3.0.0 (Claude Code)', true]] as const) {
    await writeFile(binary, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o700 })
    const probe = resolveClaudeExecutable(host.probeContext(), config, new AbortController().signal)
    if (valid) expect((await probe).version).toBe('3.0.0')
    else await expect(probe).rejects.toMatchObject({ category: 'unavailable' })
  }
  const signal = AbortSignal.abort()
  await expect(resolveClaudeExecutable(host.probeContext(), config, signal)).rejects.toThrow()
  config.binary = join(host.root, 'missing')
  const invalid = new ClaudeBrainProvider(config)
  expect(await invalid.probe(host.probeContext())).toMatchObject({ available: false, problems: [expect.stringContaining('missing')] })
})

it('reports static auth without spawning, and checks only auth status in a temporary home with redacted JSON', async () => {
  host = await createBrainTestHost()
  const binary = join(host.root, 'auth-cli')
  await writeFile(binary, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({loggedIn:true,detail:process.env.ANTHROPIC_API_KEY,args:process.argv.slice(2),home:process.env.HOME}));\n', { mode: 0o700 })
  const config = Config({ binary, env: { ANTHROPIC_API_KEY: 'fake-probe-secret', ANTHROPIC_BASE_URL: 'https://auth.invalid' }, models: [{ id: 'mock', label: 'Mock', isDefault: true, thinkingOptions: [] }] })
  const provider = new ClaudeBrainProvider(config)
  const context = host.probeContext()
  let spawned = 0
  const spawn = context.spawn.bind(context)
  const tracked = { ...context, spawn: (spec: Parameters<typeof spawn>[0]) => { spawned++; return spawn(spec) } }
  const basic = await provider.probe(tracked)
  expect(spawned).toBe(0)
  expect(basic).toMatchObject({ auth: { variable: 'ANTHROPIC_API_KEY', baseUrl: 'https://auth.invalid' } })
  const checked = await provider.probe({ ...tracked, checkAuth: true })
  expect(spawned).toBe(1)
  expect(checked.auth?.check).toMatchObject({ ok: true, status: { detail: '[redacted]', args: ['auth', 'status'] } })
  expect(JSON.stringify(checked)).not.toContain('fake-probe-secret')
})

it('reports malformed, unauthenticated, nonzero and timed out auth checks explicitly', async () => {
  host = await createBrainTestHost()
  const binary = join(host.root, 'bad-auth-cli')
  const variants = [
    ['process.stdout.write("not json")', 10000, 'valid JSON'],
    ['process.stdout.write(JSON.stringify({loggedIn:false}))', 10000, 'not authenticated'],
    ['process.exit(9)', 10000, 'exited with code'],
    ['setTimeout(()=>{},10000)', 50, 'terminated after'],
  ] as const
  for (const [body, timeout, expected] of variants) {
    await writeFile(binary, `#!/usr/bin/env node\n${body}\n`, { mode: 0o700 })
    const provider = new ClaudeBrainProvider(Config({ binary, env: { ANTHROPIC_AUTH_TOKEN: 'fake-probe-token' }, models: [{ id: 'mock', label: 'Mock', isDefault: true, thinkingOptions: [] }], probeTimeoutMs: timeout, graceMs: 10 }))
    const result = await provider.probe({ ...host.probeContext(), checkAuth: true, signal: new AbortController().signal })
    expect(result.available).toBe(false)
    expect(result.auth).toMatchObject({ variable: 'ANTHROPIC_AUTH_TOKEN', check: { ok: false } })
    expect(result.problems.join(' ')).toContain(expected)
  }
}, 20_000)

it('reports a non-Error spawn rejection without exposing instance credentials', async () => {
  host = await createBrainTestHost()
  const binary = join(host.root, 'spawn-fails')
  await writeFile(binary, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const provider = new ClaudeBrainProvider(Config({ binary, env: fakeAuthEnv, models: [{ id: 'mock', label: 'Mock', isDefault: true, thinkingOptions: [] }] }))
  const context = { ...host.probeContext(), checkAuth: true, spawn: () => { throw 'spawn refused' } }
  expect((await provider.probe(context)).problems.join(' ')).toContain('spawn refused')
})
