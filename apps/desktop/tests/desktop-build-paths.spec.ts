import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopTargetBuildPaths,
  desktopTargetPlatform,
  developmentRuntimeDirectory,
  resolveDesktopBuildTarget,
  resolveDesktopTargetBuildPaths,
} from '../scripts/desktop-build-paths.mjs'

describe('desktop build paths', () => {
  it('keeps every mutable build directory under the Apple Silicon target', () => {
    const paths = desktopTargetBuildPaths('mac-arm64')
    for (const key of ['root', 'artifacts', 'runtime', 'packageSet', 'liwa', 'liwaPnpm', 'electron',
      'packedLiwa', 'packedVendor', 'packedNative'] as const) {
      expect(paths[key]).toContain(join('targets', 'mac-arm64'))
    }
    expect(paths.application).toBe(join(paths.artifacts, 'mac-arm64', 'Liwa.app'))
  })

  it('shares download and package caches outside target output directories', () => {
    const paths = desktopTargetBuildPaths('mac-arm64')
    expect(paths.downloads).not.toContain(`${sep}targets${sep}`)
    expect(paths.pnpmStore).not.toContain(`${sep}targets${sep}`)
    expect(paths.pnpmStore).toBe(resolve(paths.root, '../..', 'pnpm-store'))
  })

  it('retains target outputs while relocating caches through the supplied environment', () => {
    const cache = resolve('external-package-cache')
    const environment = { LIWA_DESKTOP_PACKAGE_CACHE_DIR: cache }
    const defaults = desktopTargetBuildPaths('mac-arm64', {})
    const paths = resolveDesktopTargetBuildPaths(environment, 'darwin', 'arm64')
    expect(paths).toEqual({ ...defaults, downloads: join(cache, 'downloads'), pnpmStore: join(cache, 'pnpm-store') })
    expect(paths.root).not.toContain(cache)
  })

  it.each(['', ' ', 'relative/cache', './cache', 'cache\0invalid'])('rejects invalid cache directory %j', (directory) => {
    expect(() => desktopTargetBuildPaths('mac-arm64', { LIWA_DESKTOP_PACKAGE_CACHE_DIR: directory }))
      .toThrow('LIWA_DESKTOP_PACKAGE_CACHE_DIR')
  })

  it('resolves the development primary runtime of the Apple Silicon target', () => {
    expect(developmentRuntimeDirectory({}, 'darwin', 'arm64'))
      .toContain(join('targets', 'mac-arm64', 'runtime', 'primary-runtime'))
  })

  it('prepares an Apple Silicon macOS payload', () => {
    expect(desktopTargetPlatform('mac-arm64')).toEqual({ platform: 'darwin', arch: 'arm64' })
    expect(() => desktopTargetPlatform('win-x64' as 'mac-arm64')).toThrow(/unsupported target/u)
  })

  it.each([['darwin', 'x64'], ['win32', 'x64'], ['linux', 'arm64']] as const)('refuses a %s %s host, including through npm overrides', (platform, arch) => {
    expect(resolveDesktopBuildTarget({}, 'darwin', 'arm64')).toBe('mac-arm64')
    expect(() => resolveDesktopBuildTarget({}, platform, arch)).toThrow(/only on an Apple Silicon Mac/u)
    expect(() => resolveDesktopBuildTarget({ npm_config_platform: platform, npm_config_arch: arch }, 'darwin', 'arm64'))
      .toThrow(/only on an Apple Silicon Mac/u)
    expect(() => desktopTargetBuildPaths('mac-x64' as 'mac-arm64')).toThrow(/unsupported target/u)
  })
})
