import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopTargetBuildPaths } from '../scripts/desktop-build-paths.mjs'
import {
  adHocSigningEnvironment,
  desktopElectronBuilderArguments,
  packageTarget,
  parseDesktopPackageInvocation,
} from '../scripts/package-target.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('desktop package target', () => {
  it('parses application, directory, preparation and check invocations on an Apple Silicon Mac', () => {
    expect(parseDesktopPackageInvocation([], 'darwin', 'arm64')).toEqual({ directory: false, prepareOnly: false, check: false })
    expect(parseDesktopPackageInvocation(['--dir'], 'darwin', 'arm64').directory).toBe(true)
    expect(parseDesktopPackageInvocation(['--', '--prepare-only'], 'darwin', 'arm64').prepareOnly).toBe(true)
    expect(parseDesktopPackageInvocation(['--check'], 'darwin', 'arm64').check).toBe(true)
  })

  it.each([['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64']] as const)('refuses a %s %s host and every other target name', (platform, arch) => {
    expect(() => parseDesktopPackageInvocation([], platform, arch)).toThrow(/only on an Apple Silicon Mac/u)
    expect(() => parseDesktopPackageInvocation(['win-x64'], 'darwin', 'arm64')).toThrow()
    expect(() => parseDesktopPackageInvocation(['--unsigned'], 'darwin', 'arm64')).toThrow()
  })

  it('keeps electron-builder on the Apple Silicon target and never publishing', () => {
    expect(desktopElectronBuilderArguments(false)).toEqual([
      'exec', 'electron-builder', '--config', 'electron-builder.config.mjs', '--mac', '--arm64', '--publish', 'never',
    ])
    expect(desktopElectronBuilderArguments(true).at(-1)).toBe('--dir')
  })

  it('removes inherited certificate and notarization inputs so only the ad-hoc signature applies', () => {
    expect(adHocSigningEnvironment({
      PATH: '/bin', CSC_LINK: '/certificate.p12', CSC_KEY_PASSWORD: 'secret', WIN_CSC_LINK: '/windows.pfx',
      APPLE_ID: 'person@example.com', APPLE_API_KEY: '/key.p8', CSC_IDENTITY_AUTO_DISCOVERY: 'true',
    })).toEqual({ PATH: '/bin', CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
  })

  it('builds the official profile, packs every workspace package locally, and prepares before assembling', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'liwa-package-target-'))
    directories.push(directory)
    const commands: string[] = []
    const run = { directory, run: vi.fn(async (stage: string) => { commands.push(stage) }), finish: vi.fn() }
    const paths = { ...desktopTargetBuildPaths('mac-arm64'), packedNative: join(directory, 'native') }
    vi.stubEnv('npm_execpath', '/pnpm.cjs')
    try {
      await packageTarget({ directory: false, prepareOnly: false, check: false }, {}, run, paths)
    } finally { vi.unstubAllEnvs() }
    expect(commands[0]).toBe('run build --profile official')
    expect(commands).toContain('run build:native-system')
    expect(commands.filter(command => command.includes(' pack --pack-destination ')).map(command => command.split(' ')[1]))
      .toEqual(['apps/desktop-host', 'native/system/packages/entry', 'native/system/packages/darwin-arm64'])
    expect(commands.slice(-5)).toEqual([
      'run prepare:runtime', 'run prepare:packages', 'run prepare:liwa',
      desktopElectronBuilderArguments(false).join(' '), 'exec tsx scripts/smoke-packaged-runtime.ts',
    ])
    expect(commands.join('\n')).not.toMatch(/release:publish|upload|notar|sign:/u)
    expect(readFileSync(join(directory, 'events.jsonl'), 'utf8')).toContain('"type":"artifacts"')
  })

  it('stops after preparation without assembling the application', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'liwa-package-target-'))
    directories.push(directory)
    const commands: string[] = []
    const run = { directory, run: vi.fn(async (stage: string) => { commands.push(stage) }), finish: vi.fn() }
    vi.stubEnv('npm_execpath', '/pnpm.cjs')
    try {
      await packageTarget({ directory: false, prepareOnly: true, check: false }, {}, run,
        { ...desktopTargetBuildPaths('mac-arm64'), packedNative: join(directory, 'native') })
    } finally { vi.unstubAllEnvs() }
    expect(commands.at(-1)).toBe('run prepare:liwa')
  })
})
