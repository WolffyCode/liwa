import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { dependency } = vi.hoisted(() => ({
  dependency: { rgPath: '/node_modules/@vscode/ripgrep/bin/rg' },
}))

vi.mock('@vscode/ripgrep', () => ({ get rgPath() { return dependency.rgPath } }))

beforeEach(() => {
  vi.resetModules()
  dependency.rgPath = '/node_modules/@vscode/ripgrep/bin/rg'
  Reflect.deleteProperty(process.versions, 'electron')
})

afterEach(() => {
  Reflect.deleteProperty(process.versions, 'electron')
})

describe('ripgrep resolution', () => {
  it('uses the dependency binary in an ordinary Node process', async () => {
    const { resolveRgPath } = await import('@liwa/tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(dependency.rgPath)
  })

  it('uses the unpacked executable path for an Electron ASAR dependency', async () => {
    Reflect.defineProperty(process.versions, 'electron', { configurable: true, value: '44.0.0' })
    dependency.rgPath = '/Applications/Liwa.app/Contents/Resources/app.asar/liwa/node_modules/@vscode/ripgrep/bin/rg'
    const { resolveRgPath } = await import('@liwa/tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(
      '/Applications/Liwa.app/Contents/Resources/app.asar.unpacked/liwa/node_modules/@vscode/ripgrep/bin/rg',
    )
  })
})
