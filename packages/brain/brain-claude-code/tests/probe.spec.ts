import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { fakeAuthEnv } from './fixtures/auth.ts'
import { resolveClaudeExecutable } from '../src/probe.ts'
import { Config, type Config as ClaudeConfig } from '../src/config.ts'
import { ClaudeBrainProvider } from '../src/provider.ts'

let host: BrainTestHost | undefined
afterEach(async () => { await host?.dispose() })
it('probes the selected binary, rejects old/malformed versions, and respects cancellation', async () => {
  host = await createBrainTestHost()
  const binary = join(host.root, 'version-cli')
  const config = Config({ binary, env: fakeAuthEnv, models: [{ id: 'mock', label: 'Mock', isDefault: true }] } as ClaudeConfig)
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
