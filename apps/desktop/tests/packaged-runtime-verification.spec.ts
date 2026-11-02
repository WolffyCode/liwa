import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'

const { verifyDesktopRuntime } = vi.hoisted(() => ({
  verifyDesktopRuntime: vi.fn<(root: string, expected: string, target: unknown) => Promise<void>>(async () => undefined),
}))
// The hook imports the built tree, which a clean checkout has not produced; this is the path it resolves.
vi.mock('/apps/desktop/lib/types/runtime-tree.js', () => ({ verifyDesktopRuntime }))

async function productVersion(): Promise<string> {
  return (JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
}

describe('local application packaging configuration', () => {
  it('requires the bundled runtime to declare the product version for the Apple Silicon target', async () => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const config = createElectronBuilderConfig({}, 'darwin', 'arm64')
    await config.afterPack()
    expect(verifyDesktopRuntime).toHaveBeenCalledExactlyOnceWith(expect.any(String), await productVersion(), { platform: 'darwin', arch: 'arm64' })
  })

  it('carries the Liwa identity and link scheme without publication, notarization, or a Developer ID', async () => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const config = createElectronBuilderConfig({}, 'darwin', 'arm64')
    expect(config.appId).toBe('com.wolffycode.liwa')
    expect(config.productName).toBe('Liwa')
    expect(config.protocols).toEqual([{ name: 'Liwa', schemes: ['liwa'] }])
    expect(config.publish).toBeNull()
    expect(config.mac).toMatchObject({ identity: '-', forceCodeSigning: false, notarize: false, target: ['dmg'] })
    expect(config.dmg).toEqual({ format: 'ULMO', sign: false, writeUpdateInfo: false })
    expect(config.files).not.toContain('lib/preload-mandatory.cjs')
    expect(config).not.toHaveProperty('win')
    expect(config).not.toHaveProperty('nsis')
  })

  it.each([['darwin', 'x64'], ['win32', 'x64'], ['linux', 'arm64']] as const)('refuses to configure a %s %s build', async (platform, arch) => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    expect(() => createElectronBuilderConfig({}, platform, arch)).toThrow(/only on an Apple Silicon Mac/u)
  })
})
