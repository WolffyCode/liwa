/** Public liwa launch resolution for the TypeScript SDK. */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_INITIALIZE_TIMEOUT_MS,
  installedLiwaBin,
  resolveLiwaNodeLaunchFromManifests,
  resolveLiwaBinFromManifests,
  resolveLiwaLaunch,
} from '../src/launch.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true })
})

function manifestPair(liwa: object, client: object): { liwaUrl: string; clientUrl: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'liwa-sdk-manifests-'))
  cleanups.push(root)
  const liwaPath = join(root, 'liwa-package.json')
  const clientPath = join(root, 'client-package.json')
  writeFileSync(liwaPath, JSON.stringify(liwa))
  writeFileSync(clientPath, JSON.stringify(client))
  return {
    liwaUrl: pathToFileURL(liwaPath).href,
    clientUrl: pathToFileURL(clientPath).href,
    root,
  }
}

describe('SDK liwa launch resolution', () => {
  it('resolves the same-version installed liwa entry by default', () => {
    const bin = installedLiwaBin()
    expect(bin.endsWith(join('apps', 'cli', 'lib', 'bin.js'))).toBe(true)
    const launch = resolveLiwaLaunch()
    expect(launch.command).toBe(process.execPath)
    expect(launch.args).toEqual(existsSync(bin)
      ? [bin, '--profile', 'sdk']
      : [
        '--import', import.meta.resolve('tsx/esm'), resolve(bin, '..', '..', 'src/bin.ts'),
        '--profile', 'sdk',
        '--patch', resolve(bin, '..', '..', 'src/sdk-source.cordis.patch.yml'),
      ])
    expect(launch.initializeTimeoutMs).toBe(DEFAULT_INITIALIZE_TIMEOUT_MS)
    expect(launch.description).toBe('liwa profile "sdk"')
  })

  it('makes every filesystem input absolute before spawn and preserves patch order', () => {
    const caller = resolve('/tmp', 'sdk-launch-caller')
    const launch = resolveLiwaLaunch({
      liwaBin: './bin/liwa',
      profile: 'custom-sdk',
      patches: ['./first.yml', '../second.yml'],
      liwaHome: './home',
      processCwd: './worker',
      env: { PATH: '/bin', LIWA_HOME: '/stale' },
      initializeTimeoutMs: 123,
      requestTimeoutMs: 456,
      shutdownTimeoutMs: 789,
      disposeEofGraceMs: 12,
      disposeGraceMs: 34,
    }, caller)
    expect(launch).toMatchObject({
      command: process.execPath,
      args: [
        join(caller, 'bin/liwa'),
        '--profile', 'custom-sdk',
        '--patch', join(caller, 'first.yml'),
        '--patch', resolve(caller, '../second.yml'),
      ],
      cwd: join(caller, 'worker'),
      description: 'liwa profile "custom-sdk"',
      initializeTimeoutMs: 123,
      requestTimeoutMs: 456,
      shutdownTimeoutMs: 789,
      disposeEofGraceMs: 12,
      disposeGraceMs: 34,
    })
    expect(launch.environment()).toEqual({ PATH: '/bin', LIWA_HOME: join(caller, 'home') })
  })

  it('falls back to the same package source entry through an absolute tsx loader', () => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    const sourceBin = join(pair.root, 'src/bin.ts')
    const sourcePatch = join(pair.root, 'src/sdk-source.cordis.patch.yml')
    const sourceTsconfig = join(pair.root, 'tsconfig.json')
    mkdirSync(join(pair.root, 'src'))
    writeFileSync(sourceBin, '')
    writeFileSync(sourcePatch, '[]\n')
    writeFileSync(sourceTsconfig, '{}\n')

    expect(resolveLiwaNodeLaunchFromManifests(pair.liwaUrl, pair.clientUrl, 'file:///tsx-loader.mjs'))
      .toEqual({
        nodeArgs: ['--import', 'file:///tsx-loader.mjs', sourceBin],
        patches: [sourcePatch],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
    expect(resolveLiwaNodeLaunchFromManifests(pair.liwaUrl, pair.clientUrl))
      .toEqual({
        nodeArgs: ['--import', import.meta.resolve('tsx/esm'), sourceBin],
        patches: [sourcePatch],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
  })

  it('uses the built entry when the manifest bin exists', () => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    const bin = join(pair.root, 'lib/bin.js')
    mkdirSync(join(pair.root, 'lib'))
    writeFileSync(bin, '')

    expect(resolveLiwaNodeLaunchFromManifests(pair.liwaUrl, pair.clientUrl)).toEqual({
      nodeArgs: [bin],
      patches: [],
      environment: {},
    })
  })

  it.each([0, 1, 2])('fails loud when a source launch is missing required file set %s', (presentCount) => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    mkdirSync(join(pair.root, 'src'))
    const sourceFiles = ['src/bin.ts', 'src/sdk-source.cordis.patch.yml', 'tsconfig.json']
    for (const source of sourceFiles.slice(0, presentCount)) writeFileSync(join(pair.root, source), '')
    expect(() => resolveLiwaNodeLaunchFromManifests(pair.liwaUrl, pair.clientUrl, 'file:///tsx-loader.mjs'))
      .toThrow('is missing its built executable')
  })

  it('reads explicit and inherited environments when the child starts', () => {
    const explicit: NodeJS.ProcessEnv = { MARKER: 'before' }
    const explicitLaunch = resolveLiwaLaunch({ liwaBin: '/bin/liwa', env: explicit })
    explicit.MARKER = 'after'
    expect(explicitLaunch.environment().MARKER).toBe('after')

    const inheritedLaunch = resolveLiwaLaunch({ liwaBin: '/bin/liwa' })
    process.env.LIWA_SDK_LATE_ENV_TEST = 'late'
    try {
      expect(inheritedLaunch.environment().LIWA_SDK_LATE_ENV_TEST).toBe('late')
    } finally {
      delete process.env.LIWA_SDK_LATE_ENV_TEST
    }
  })

  it.each([2, '2.0.0'])(
    'rejects a liwa version that differs from the client (%j)',
    (version) => {
      const pair = manifestPair({ version, bin: 'bin.js' }, { version: '1.0.0' })
      expect(() => resolveLiwaBinFromManifests(pair.liwaUrl, pair.clientUrl))
        .toThrow(`requires the same liwa version, got ${String(version)}`)
    },
  )

  it('accepts the string npm bin form', () => {
    const pair = manifestPair({ version: '1.0.0', bin: './bin.js' }, { version: '1.0.0' })
    expect(resolveLiwaBinFromManifests(pair.liwaUrl, pair.clientUrl)).toBe(join(pair.root, 'bin.js'))
  })

  it.each([null, {}, ''])(
    'rejects a manifest without a usable liwa executable (%j)',
    (bin) => {
      const pair = manifestPair({ version: '1.0.0', bin }, { version: '1.0.0' })
      expect(() => resolveLiwaBinFromManifests(pair.liwaUrl, pair.clientUrl))
        .toThrow('declares no liwa executable')
    },
  )
})
