import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import BrainRegistry, { ImplId } from '@liwa/brain'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { CredentialProvider } from '@liwa/credentials'
import { apply, DeepseekACPAgentClient, resolveLiwaLauncher, type Config } from '../src/index.ts'

vi.mock('../src/launcher.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/launcher.ts')>()
  return { ...original, resolveLiwaLauncher: vi.fn(original.resolveLiwaLauncher) }
})

class FixtureCredentials extends CredentialProvider {
  value: string | undefined = 'fake-plugin-key'
  resolve() { return Promise.resolve(this.value === undefined ? undefined : { value: this.value, source: 'fixture' }) }
  describe(): never { throw new Error('unused fixture operation') }
  set(): never { throw new Error('unused fixture operation') }
  unset(): never { throw new Error('unused fixture operation') }
  readRecord(): never { throw new Error('unused fixture operation') }
  describeRecord(): never { throw new Error('unused fixture operation') }
  listRecords(): never { throw new Error('unused fixture operation') }
  modifyRecord(): never { throw new Error('unused fixture operation') }
  deleteRecord(): never { throw new Error('unused fixture operation') }
}

let host: BrainTestHost | undefined
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await host?.dispose() })
const settings = (): Config => ({ impl: 'deepseek', launcher: [], launcherEnv: {}, apiKeyEnv: 'LIWA_BRAIN_TEST_FAKE_KEY',
  forwardEnv: [], env: {}, provider: 'deepseek-official', presetPrefix: 'deepseek-', instructionsMaxBytes: 65_536 })

it('registers explicit, PATH, source and built installations and resolves only fixture authentication', async () => {
  host = await createBrainTestHost()
  await host.ctx.plugin(BrainRegistry, { membersRoot: host.root })
  vi.spyOn(DeepseekACPAgentClient.prototype, 'isAvailable').mockResolvedValue(true)
  const config = Object.assign(settings(), { forwardEnv: ['LIWA_TEST_FORWARD', 'LIWA_TEST_EMPTY', 'LIWA_TEST_ABSENT'] })
  vi.stubEnv('LIWA_BRAIN_TEST_FAKE_KEY', 'fake-key')
  vi.stubEnv('LIWA_TEST_FORWARD', 'fixture-value')
  vi.stubEnv('LIWA_TEST_EMPTY', '')
  apply(host.ctx, Object.assign({}, config, { impl: 'explicit', launcher: [process.execPath, 'fixture'] }))
  apply(host.ctx, Object.assign({}, config, { impl: 'path' }))
  expect((await host.ctx.brains.probe(ImplId('explicit'))).available).toBe(true)
  const profile = { name: 'fixture', dir: host.root, patchPath: join(host.root, 'patch.yml'), installAnchor: join(host.root, 'package.json'),
    cwd: host.root, home: host.root, startedBundles: [], overlays: [] }
  host.ctx.provide('profileContext', profile)
  await mkdir(join(host.root, 'src'))
  await writeFile(join(host.root, 'src', 'bin.ts'), '')
  await writeFile(join(host.root, 'src', 'sdk-source.cordis.patch.yml'), '[]')
  await writeFile(profile.installAnchor, 'null')
  apply(host.ctx, Object.assign({}, config, { impl: 'source' }))
  await mkdir(join(host.root, 'lib'))
  await writeFile(join(host.root, 'lib', 'bin.js'), '')
  await writeFile(profile.installAnchor, '{"version":"fixture"}')
  apply(host.ctx, Object.assign({}, config, { impl: 'built' }))
  vi.stubEnv('LIWA_BRAIN_TEST_FAKE_KEY', '')
  expect((await host.ctx.brains.probe(ImplId('built'))).available).toBe(false)
  const credentials = new FixtureCredentials(host.ctx)
  expect((await host.ctx.brains.probe(ImplId('built'))).available).toBe(true)
  credentials.value = undefined
  expect((await host.ctx.brains.probe(ImplId('built'))).available).toBe(false)
})

it('keeps a missing installation unavailable and propagates unexpected launcher failures', async () => {
  host = await createBrainTestHost()
  await host.ctx.plugin(BrainRegistry, { membersRoot: host.root })
  host.ctx.provide('profileContext', { name: 'fixture', dir: host.root, patchPath: join(host.root, 'patch.yml'),
    installAnchor: join(host.root, 'package.json'), cwd: host.root, home: host.root, startedBundles: [], overlays: [] })
  const config = settings()
  apply(host.ctx, config)
  expect(host.ctx.brains.list()).toHaveLength(1)
  vi.mocked(resolveLiwaLauncher).mockImplementationOnce(() => { throw new Error('disk unavailable') })
  expect(() =>{  apply(host!.ctx, Object.assign({}, config, { impl: 'broken' })) }).toThrow('disk unavailable')
})
