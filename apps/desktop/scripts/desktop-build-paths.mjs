/** Resolve target-owned Desktop outputs and shared package caches. */

import { isAbsolute, join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')

/** The only Desktop target: an Apple Silicon Mac builds and runs it locally. */
const DESKTOP_TARGET = 'mac-arm64'

/**
 * Resolve the Desktop target, refusing every host except an Apple Silicon Mac.
 * @param {NodeJS.ProcessEnv} env - Packaging environment; npm platform overrides cannot select another target.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no npm override exists.
 * @param {string} hostArch - Build-host architecture used when no npm override exists.
 * @returns {'mac-arm64'} The Desktop target name.
 */
export function resolveDesktopBuildTarget(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const platform = env.npm_config_platform ?? hostPlatform
  const arch = env.npm_config_arch ?? hostArch
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(`desktop build paths: Desktop builds only on an Apple Silicon Mac, not ${platform}-${arch}`)
  }
  return DESKTOP_TARGET
}

function assertSupportedTarget(target) {
  if (target !== DESKTOP_TARGET) {
    throw new Error(`desktop build paths: unsupported target ${String(target)}`)
  }
}

/**
 * Return the mutable preparation and artifact directories owned by the Desktop target.
 * @param {'mac-arm64'} target - Desktop target name.
 * @param {NodeJS.ProcessEnv} environment - Packaging environment with an optional absolute cache directory.
 * @returns {{ root: string, artifacts: string, application: string, runtime: string, packageSet: string, liwa: string, liwaPnpm: string, electron: string, packedLiwa: string, packedVendor: string, packedNative: string, downloads: string, pnpmStore: string }} Target paths plus shared download and package caches.
 */
export function desktopTargetBuildPaths(target, environment = process.env) {
  assertSupportedTarget(target)
  const cacheRoot = environment.LIWA_DESKTOP_PACKAGE_CACHE_DIR ?? BUILD_ROOT
  if (!cacheRoot.trim() || !isAbsolute(cacheRoot) || cacheRoot.includes('\0')) {
    throw new Error('desktop package: LIWA_DESKTOP_PACKAGE_CACHE_DIR must be a nonempty absolute directory')
  }
  const root = join(BUILD_ROOT, 'targets', target)
  const packed = join(root, 'packed')
  const artifacts = join(root, 'artifacts')
  return {
    root,
    artifacts,
    // electron-builder names the unpacked macOS directory after the architecture.
    application: join(artifacts, 'mac-arm64', 'Liwa.app'),
    runtime: join(root, 'runtime'),
    packageSet: join(root, 'package-set'),
    liwa: join(root, 'liwa'),
    liwaPnpm: join(root, 'liwa-pnpm'),
    electron: join(root, 'electron'),
    packedLiwa: join(packed, 'liwa'),
    packedVendor: join(packed, 'vendor'),
    packedNative: join(packed, 'native'),
    downloads: join(cacheRoot, 'downloads'),
    pnpmStore: join(cacheRoot, 'pnpm-store'),
  }
}

/**
 * Return the platform and architecture of the payload the Desktop target prepares.
 * @param {'mac-arm64'} target - Desktop target name.
 * @returns {{ platform: 'darwin', arch: 'arm64' }} Platform and architecture of the prepared payload.
 */
export function desktopTargetPlatform(target) {
  assertSupportedTarget(target)
  return { platform: 'darwin', arch: 'arm64' }
}

/**
 * Resolve the paths owned by the Desktop target on the current host.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no npm override exists.
 * @param {string} hostArch - Build-host architecture used when no npm override exists.
 * @returns {ReturnType<typeof desktopTargetBuildPaths>} Target paths.
 */
export function resolveDesktopTargetBuildPaths(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  return desktopTargetBuildPaths(resolveDesktopBuildTarget(env, hostPlatform, hostArch), env)
}

/**
 * Resolve the primary-runtime directory an unpackaged development launch uses.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no npm override exists.
 * @param {string} hostArch - Build-host architecture used when no npm override exists.
 * @returns {string} Primary-runtime directory prepared for the Desktop target.
 */
export function developmentRuntimeDirectory(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  return join(resolveDesktopTargetBuildPaths(env, hostPlatform, hostArch).runtime, 'primary-runtime')
}
