import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DESKTOP_HOST_PACKAGE, DESKTOP_HOST_RUNTIME_FILES } from '../src/core-package-set.ts'
import { DESKTOP_RUNTIME_FILE, readDesktopRuntime, runtimePath, verifyDesktopRuntime, writeDesktopRuntime } from '../src/runtime-tree.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-runtime-'))
  roots.push(root)
  runtimeFixture(join(root, 'liwa'))
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('verifies sealed final file bytes with concurrent inventory', async () => {
  const liwa = join(fixture(), 'liwa')
  const original = readDesktopRuntime(liwa)
  const names = original.sharedPackages.map(entry => entry.name)
  writeFileSync(join(liwa, 'extra.bin'), Buffer.from([0, 1, 255]))
  writeFileSync(join(liwa, 'package.json'), '{"type":"module","private":true}\n')
  const expected = writeDesktopRuntime(liwa, original.release, names)
  expect(await verifyDesktopRuntime(liwa, original.release.version)).toEqual(expected)
})

it.each(['manifest', 'link'])('leaves the descriptor unchanged when sealing rejects a %s', (failure) => {
  const liwa = join(fixture(), 'liwa')
  const original = readDesktopRuntime(liwa)
  const before = readFileSync(join(liwa, DESKTOP_RUNTIME_FILE))
  if (failure === 'manifest') writeFileSync(join(liwa, 'node_modules', DESKTOP_HOST_PACKAGE, 'package.json'), '{}')
  else symlinkSync(join(liwa, 'node_modules'), join(liwa, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => writeDesktopRuntime(liwa, original.release, original.sharedPackages.map(entry => entry.name))).toThrow()
  expect(readFileSync(join(liwa, DESKTOP_RUNTIME_FILE))).toEqual(before)
})

it('verifies a runtime after relocation without depending on build paths', async () => {
  const root = fixture()
  const before = await verifyDesktopRuntime(join(root, 'liwa'), '1.0.0')
  cpSync(join(root, 'liwa'), join(root, 'moved'), { recursive: true })
  expect(await verifyDesktopRuntime(join(root, 'moved'), '1.0.0')).toEqual(before)
})
it.each(['changed', 'same-size', 'extra', 'missing'])('checks %s runtime bytes only during build verification', async (operation) => {
  const liwa = join(fixture(), 'liwa')
  const before = readDesktopRuntime(liwa)
  if (operation === 'changed') writeFileSync(join(liwa, 'package.json'), '{}')
  if (operation === 'same-size') writeFileSync(join(liwa, 'package.json'), '{"type":"Module"}\n')
  if (operation === 'extra') writeFileSync(join(liwa, 'extra'), '')
  if (operation === 'missing') rmSync(join(liwa, 'package.json'))
  expect(readDesktopRuntime(liwa)).toEqual(before)
  await expect(verifyDesktopRuntime(liwa, '1.0.0')).rejects.toThrow(/integrity/u)
})
it('rejects filesystem links and incompatible targets', async () => {
  const liwa = join(fixture(), 'liwa')
  await expect(verifyDesktopRuntime(liwa, '1.0.0', { platform: process.platform, arch: 'wrong' })).rejects.toThrow(/incompatible/u)
  symlinkSync(join(liwa, 'node_modules'), join(liwa, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(readDesktopRuntime(liwa).release.version).toBe('1.0.0')
  await expect(verifyDesktopRuntime(liwa, '1.0.0')).rejects.toThrow(/unsupported filesystem/u)
})
it('reads file inventory records unchanged during startup', () => {
  const liwa = join(fixture(), 'liwa')
  const path = join(liwa, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { files: unknown[] }
  descriptor.files.unshift({ path: '../outside', bytes: -1.5, sha256: 'unchecked', executable: 'unchecked' })
  writeFileSync(path, JSON.stringify(descriptor))
  expect(readDesktopRuntime(liwa).files).toEqual(descriptor.files)
})
it.each(['missing', 'directory'])('checks a %s Host entry only during build verification', async (operation) => {
  const liwa = join(fixture(), 'liwa')
  const path = join(liwa, 'node_modules', DESKTOP_HOST_PACKAGE, DESKTOP_HOST_RUNTIME_FILES[0])
  rmSync(path)
  if (operation === 'directory') mkdirSync(path)
  expect(readDesktopRuntime(liwa).release.version).toBe('1.0.0')
  await expect(verifyDesktopRuntime(liwa, '1.0.0')).rejects.toThrow(/integrity/u)
})
it('checks the bundled version only during build verification', async () => {
  const liwa = join(fixture(), 'liwa')
  expect(readDesktopRuntime(liwa).release.version).toBe('1.0.0')
  await expect(verifyDesktopRuntime(liwa, '2.0.0')).rejects.toThrow(/bundled 1\.0\.0 is not the expected 2\.0\.0/u)
})
it.each([
  { schemaVersion: 2 },
  { platform: 'other' },
  { arch: 'other' },
  { release: { schemaVersion: 2 } },
  { release: { hostProtocolVersion: 999 } },
  { release: { nodeVersion: 'invalid' } },
  { release: { pnpmVersion: 'invalid' } },
])('checks release compatibility only during build verification: %j', async (patch) => {
  const liwa = join(fixture(), 'liwa')
  const path = join(liwa, DESKTOP_RUNTIME_FILE)
  const original = readDesktopRuntime(liwa)
  const descriptor = { ...original, ...patch, release: { ...original.release, ...patch.release } }
  writeFileSync(path, JSON.stringify(descriptor))
  expect(readDesktopRuntime(liwa)).toEqual(descriptor)
  await expect(verifyDesktopRuntime(liwa, '1.0.0')).rejects.toThrow(/invalid|incompatible/u)
})
it.each(['missing', 'invalid-json', 'mismatched'])('checks %s shared manifests only during build verification', async (operation) => {
  const liwa = join(fixture(), 'liwa')
  const before = readDesktopRuntime(liwa)
  const path = join(liwa, 'node_modules', DESKTOP_HOST_PACKAGE, 'package.json')
  if (operation === 'missing') rmSync(path)
  else writeFileSync(path, operation === 'invalid-json' ? '{' : '{}')
  expect(readDesktopRuntime(liwa)).toEqual(before)
  await expect(verifyDesktopRuntime(liwa, '1.0.0')).rejects.toThrow()
})
it('rejects a descriptor that maps a shared package outside node_modules', async () => {
  const liwa = join(fixture(), 'liwa')
  const path = join(liwa, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { sharedPackages: { path: string }[] }
  descriptor.sharedPackages[0]!.path = '../outside'
  writeFileSync(path, JSON.stringify(descriptor))
  await expect(verifyDesktopRuntime(liwa, '1.0.0')).rejects.toThrow(/shared package record/u)
})
it('verifies recorded executable permissions only on Unix', async () => {
  const liwa = join(fixture(), 'liwa')
  const path = join(liwa, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { files: { executable: boolean }[] }
  descriptor.files[0]!.executable = !descriptor.files[0]!.executable
  writeFileSync(path, JSON.stringify(descriptor))
  if (process.platform === 'win32') await expect(verifyDesktopRuntime(liwa, '1.0.0')).resolves.toMatchObject(descriptor)
  else await expect(verifyDesktopRuntime(liwa, '1.0.0')).rejects.toThrow(/integrity/u)
})
it.each(['../outside', '/absolute', 'C:/absolute', 'a\\b', 'a//b', './a'])('rejects nonportable path %s', (path) => {
  expect(() => runtimePath('/runtime', path)).toThrow(/invalid relative path/u)
})
