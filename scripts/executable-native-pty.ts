/** Resolve the native node-pty input used by the SSH helper executable builder. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Prefer the manylinux build from `scripts/prepare-linux-node-pty.sh` and fall back to node-pty's target prebuild.
 * @param packageDirectory - installed node-pty package directory.
 * @param arch - Linux target architecture.
 * @returns the existing addon path.
 */
export function resolveLinuxNodePtyAddon(
  packageDirectory: string,
  arch: 'x64' | 'arm64',
): string {
  const built = join(packageDirectory, 'build', 'Release', 'pty.node')
  if (existsSync(built)) return built
  const prebuilt = join(packageDirectory, 'prebuilds', `linux-${arch}`, 'pty.node')
  if (existsSync(prebuilt)) return prebuilt
  throw new Error(
    `executable-native-pty: node-pty addon is absent from both ${built} and ${prebuilt}.`,
  )
}
