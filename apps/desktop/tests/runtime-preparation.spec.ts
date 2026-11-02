/** Desktop resource preparation publishes versions only for complete resources. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  root: '',
  target: 'mac-arm64' as const,
  pnpm: '11.7.0' as string | undefined,
  failure: undefined as 'electron' | 'primary' | 'cli' | undefined,
  preparePrimary: vi.fn(),
  extractElectron: vi.fn(),
  commandLink: vi.fn(),
}))
vi.mock('../scripts/desktop-build-paths.mjs', async importOriginal => ({
  ...await importOriginal<typeof import('../scripts/desktop-build-paths.mjs')>(),
  resolveDesktopBuildTarget: () => state.target,
  resolveDesktopTargetBuildPaths: () => ({
    runtime: join(state.root, 'runtime'), electron: join(state.root, 'electron'), downloads: join(state.root, 'downloads'),
  }),
}))
vi.mock('@electron/get', () => ({ downloadArtifact: async () => 'electron.zip' }))
vi.mock('extract-zip', () => ({ default: state.extractElectron }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFileSync: (file: string) => file === '/usr/libexec/PlistBuddy' ? '12.0\n' : '24.18.1\n',
}))
vi.mock('../scripts/prepare-command-link.ts', () => ({ prepareCommandLink: state.commandLink }))
// The compiled command manager is a build input; all source resource copies use real files.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, cpSync: (...args: Parameters<typeof actual.cpSync>) => {
    if (String(args[0]).endsWith(join('lib', 'command-manager-entry.js'))) {
      if (state.failure === 'cli') throw new Error('command manager copy failed')
      actual.writeFileSync(args[1], 'command manager fixture')
    } else actual.cpSync(...args)
  } }
})
vi.mock('../scripts/prepare-primary-runtime.ts', () => ({
  preparePrimaryRuntime: state.preparePrimary,
}))

const originalArgv = process.argv
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  state.root = mkdtempSync(join(tmpdir(), 'desktop-runtime-preparation-'))
  state.target = 'mac-arm64'
  state.pnpm = '11.7.0'
  state.failure = undefined
  process.argv = [process.execPath, 'prepare-runtime.ts']
  vi.stubEnv('LIWA_DESKTOP_PACKAGING_RUN_DIR', undefined)
  state.extractElectron.mockImplementation(async () => {
    if (state.failure === 'electron') throw new Error('Electron extraction failed')
  })
  state.preparePrimary.mockImplementation(async () => {
    if (state.failure === 'primary') throw new Error('primary preparation failed')
    const root = join(state.root, 'runtime', 'primary-runtime')
    const pnpm = join(root, 'dependencies', 'pnpm', 'bin')
    mkdirSync(pnpm, { recursive: true })
    writeFileSync(join(pnpm, 'pnpm.mjs'), '')
    writeFileSync(join(root, 'runtime.json'), JSON.stringify({
      desktopVersion: '1.0.0', platform: 'darwin', arch: 'arm64',
      python: '3.12.14', node: '24.17.0', pnpm: state.pnpm, pythonPackages: { numpy: '2.3.5' },
    }))
  })
})

afterEach(async () => {
  process.argv = originalArgv
  vi.unstubAllEnvs()
  await rm(state.root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
})

it('prepares mac-arm64 with one pnpm distribution and its CLI resources', async () => {
  const runtime = join(state.root, 'runtime')
  mkdirSync(join(runtime, 'pnpm'), { recursive: true })
  await import('../scripts/prepare-runtime.ts')
  expect(existsSync(join(runtime, 'pnpm'))).toBe(false)
  expect(existsSync(join(runtime, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'))).toBe(true)
  expect(existsSync(join(runtime, 'bin', 'node'))).toBe(true)
  expect(existsSync(join(runtime, 'cli', 'bin', 'liwa'))).toBe(true)
  expect(readFileSync(join(runtime, 'cli', 'command-manager.js'), 'utf8')).toBe('command manager fixture')
  expect(existsSync(join(runtime, 'cli', 'command-path.ps1'))).toBe(false)
  expect(JSON.parse(readFileSync(join(runtime, 'versions.json'), 'utf8'))).toEqual({
    schemaVersion: 1, node: '24.18.1', pnpm: '11.7.0',
  })
  expect(state.preparePrimary).toHaveBeenCalledExactlyOnceWith()
  expect(state.commandLink).toHaveBeenCalledWith(join(runtime, 'cli'), 'arm64', '12.0')
})

it.each([
  ['electron', 'Electron extraction failed'],
  ['primary', 'primary preparation failed'],
  ['cli', 'command manager copy failed'],
] as const)('does not publish versions when %s preparation fails', async (failure, error) => {
  state.failure = failure
  const runtime = join(state.root, 'runtime')
  mkdirSync(runtime)
  writeFileSync(join(runtime, 'versions.json'), 'stale versions')
  await expect(import('../scripts/prepare-runtime.ts')).rejects.toThrow(error)
  expect(existsSync(join(runtime, 'versions.json'))).toBe(false)
})

it.each([
  ['not-a-version', 'primary runtime: invalid metadata'],
  [undefined, 'primary-runtime manifest has no pnpm version'],
])('rejects pnpm metadata %s', async (pnpm, error) => {
  state.pnpm = pnpm
  await expect(import('../scripts/prepare-runtime.ts')).rejects.toThrow(error)
  expect(existsSync(join(state.root, 'runtime', 'versions.json'))).toBe(false)
})

it('keeps primary preparation after Electron extraction', async () => {
  const electron = Promise.withResolvers<undefined>()
  let extracting = false
  state.extractElectron.mockImplementation(async () => {
    extracting = true
    await electron.promise
  })
  const outcome = import('../scripts/prepare-runtime.ts').then(() => undefined, (error: unknown) => error)
  try {
    await vi.waitFor(() => { expect(extracting).toBe(true) }, { timeout: 5000 })
    expect(state.preparePrimary).not.toHaveBeenCalled()
    electron.resolve(undefined)
    expect(await outcome).toBeUndefined()
    expect(state.preparePrimary).toHaveBeenCalledOnce()
  } finally {
    electron.resolve(undefined)
    await outcome
  }
})
