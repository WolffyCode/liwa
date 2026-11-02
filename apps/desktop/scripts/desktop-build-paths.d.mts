/** The only Desktop target name. */
export type DesktopTarget = 'mac-arm64'

/** Mutable target directories plus shared download and package caches. */
export interface DesktopTargetBuildPaths {
  readonly root: string
  readonly artifacts: string
  /** Unpacked application bundle electron-builder writes before the disk image. */
  readonly application: string
  readonly runtime: string
  readonly packageSet: string
  readonly liwa: string
  readonly liwaPnpm: string
  readonly electron: string
  readonly packedLiwa: string
  readonly packedVendor: string
  readonly packedNative: string
  readonly downloads: string
  readonly pnpmStore: string
}

/**
 * Resolve the Desktop target, refusing every host except an Apple Silicon Mac.
 * @param env - Packaging environment; npm platform overrides cannot select another target.
 * @param hostPlatform - Build-host platform used when no npm override exists.
 * @param hostArch - Build-host architecture used when no npm override exists.
 * @returns The Desktop target name.
 */
export function resolveDesktopBuildTarget(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopTarget

/**
 * Return the mutable preparation and artifact directories owned by the Desktop target.
 * @param target - Desktop target name.
 * @param environment - Packaging environment with an optional absolute cache directory.
 * @returns Target paths plus shared download and package caches.
 */
export function desktopTargetBuildPaths(target: DesktopTarget, environment?: NodeJS.ProcessEnv): DesktopTargetBuildPaths

/**
 * Return the platform and architecture of the payload the Desktop target prepares.
 * @param target - Desktop target name.
 * @returns Platform and architecture of the prepared payload.
 */
export function desktopTargetPlatform(target: DesktopTarget): {
  readonly platform: 'darwin'
  readonly arch: 'arm64'
}

/**
 * Resolve the paths owned by the Desktop target on the current host.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no npm override exists.
 * @param hostArch - Build-host architecture used when no npm override exists.
 * @returns Target paths.
 */
export function resolveDesktopTargetBuildPaths(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopTargetBuildPaths

/**
 * Resolve the primary-runtime directory an unpackaged development launch uses.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no npm override exists.
 * @param hostArch - Build-host architecture used when no npm override exists.
 * @returns Primary-runtime directory prepared for the Desktop target.
 */
export function developmentRuntimeDirectory(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): string
