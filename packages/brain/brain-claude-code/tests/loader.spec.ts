import { fakeClaudeBinary } from './fixtures/binary.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { scrubbedParentEnv } from '@liwa/subprocess'

it('runs liwa brain through the real profile and Loader with the official SDK and a fake CLI', async () => {
  const home = await mkdtemp(join(tmpdir(), 'liwa-claude-loader-'))
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const cli = join(root, 'apps/cli/src/bin.ts')

  const binary = await fakeClaudeBinary(home)
  const patch = join(home, 'claude.yml')
  await writeFile(patch, JSON.stringify([{ id: 'brain-claude-code', disabled: false, config: { impl: 'claude-test', binary, env: { ANTHROPIC_API_KEY: 'fake-only' }, models: [{ id: 'mock', label: 'Mock', isDefault: true }] } }]))
  try {
    const run = await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx/esm'), cli, '--profile', 'brain', '--patch', patch, 'run', '--provider', 'claude-test', '--json', 'scenario:reply'], {
      cwd: home,
      env: { ...scrubbedParentEnv(), LIWA_HOME: home, TSX_TSCONFIG_PATH: join(root, 'apps/cli/tsconfig.json') },
      timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
    })
    expect(run.stdout).toContain('turn.completed')
    expect(run.stdout).toContain('scenario:reply')
    expect(run.stdout + run.stderr).not.toContain('fake-only')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}, 90_000)
