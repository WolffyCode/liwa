import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  desktopCorePackageOverrides,
  desktopLiwaPackageSpec,
  parseDesktopCorePackageSet,
  verifyDesktopCoreLockfile,
  verifyDesktopCorePackageSet,
  type DesktopCorePackageRecord,
} from '../src/core-package-set.ts'

const roots: string[] = []

function record(name: string, file: string, body: Buffer, version = '1.2.3'): DesktopCorePackageRecord {
  return {
    name,
    version,
    file,
    bytes: body.byteLength,
    integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
  }
}

function packageSetProject(): {
  root: string
  liwa: DesktopCorePackageRecord
  base: DesktopCorePackageRecord
  host: DesktopCorePackageRecord
} {
  const root = mkdtempSync(join(tmpdir(), 'liwa-desktop-package-set-'))
  roots.push(root)
  const packageDir = join(root, DESKTOP_PACKAGES_DIR)
  mkdirSync(packageDir)
  const liwaBody = Buffer.from('liwa')
  const baseBody = Buffer.from('base')
  const hostBody = Buffer.from('host')
  const liwa = record('@liwa/cli', 'liwa.tgz', liwaBody)
  const base = record('@liwa/base', 'liwa-base.tgz', baseBody)
  const host = record('@liwa/desktop-host', 'liwa-desktop-host.tgz', hostBody)
  writeFileSync(join(packageDir, liwa.file), liwaBody)
  writeFileSync(join(packageDir, base.file), baseBody)
  writeFileSync(join(packageDir, host.file), hostBody)
  writeFileSync(join(root, DESKTOP_PACKAGE_SET_FILE), `${JSON.stringify({
    schemaVersion: 1,
    packages: [base, liwa, host],
  })}\n`)
  return { root, liwa, base, host }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop core package set', () => {
  it('pins the direct liwa dependency and every internal package to local tarballs', () => {
    const { root } = packageSetProject()
    const packageSet = verifyDesktopCorePackageSet(root, '1.2.3')
    expect(desktopLiwaPackageSpec(packageSet)).toBe('file:./desktop-packages/liwa.tgz')
    expect(desktopCorePackageOverrides(packageSet)).toEqual({
      '@liwa/cli': 'file:./desktop-packages/liwa.tgz',
      '@liwa/base': 'file:./desktop-packages/liwa-base.tgz',
      '@liwa/desktop-host': 'file:./desktop-packages/liwa-desktop-host.tgz',
    })
  })

  it('rejects version drift, descriptor disorder, corruption, and extra files', () => {
    const { root, liwa, base, host } = packageSetProject()
    expect(() => verifyDesktopCorePackageSet(root, '2.0.0')).toThrow(/does not match Desktop/u)
    expect(() => parseDesktopCorePackageSet({
      schemaVersion: 1,
      packages: [base, liwa, { ...host, version: '2.0.0' }],
    }, '1.2.3')).toThrow(/@liwa\/desktop-host@2\.0\.0 does not match Desktop 1\.2\.3/u)
    expect(() => parseDesktopCorePackageSet({ schemaVersion: 1, packages: [liwa, base, host] }))
      .toThrow(/sorted by name/u)
    writeFileSync(join(root, DESKTOP_PACKAGES_DIR, liwa.file), 'changed')
    expect(() => verifyDesktopCorePackageSet(root, '1.2.3')).toThrow(/integrity check failed/u)
    writeFileSync(join(root, DESKTOP_PACKAGES_DIR, 'extra.tgz'), '')
    expect(() => verifyDesktopCorePackageSet(root, '1.2.3')).toThrow(/does not match its descriptor/u)
  })

  it('rejects registry resolutions for every workspace-scoped package', () => {
    expect(() => {
      verifyDesktopCoreLockfile("packages:\n  '@liwa/cli@file:desktop-packages/liwa.tgz':\n    resolution: {}\n")
    }).not.toThrow()
    expect(() => {
      verifyDesktopCoreLockfile("packages:\n  '@liwa/cli@1.2.3':\n    resolution: {integrity: sha512-registry}\n")
    }).toThrow(/from a registry instead of the local package set/u)
    // A workspace package outside the packed set, such as a platform binding, is refused as well.
    expect(() => {
      verifyDesktopCoreLockfile("packages:\n  '@liwa/node-addon-system-darwin-arm64@0.1.2':\n    resolution: {integrity: sha512-registry}\n")
    }).toThrow(/@liwa\/node-addon-system-darwin-arm64@0\.1\.2 from a registry/u)
    expect(() => {
      verifyDesktopCoreLockfile("overrides:\n  '@liwa/cli': file:./desktop-packages/liwa.tgz\nsnapshots:\n  zod@4.4.3: {}\n")
    }).not.toThrow()
  })
})
