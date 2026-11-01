/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveLiwaHome } from '@liwa/home-paths'

/** Stable desktop installation paths under the shared Liwa home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param liwaHome - Liwa home shared with npm-installed liwa.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(liwaHome: string = resolveLiwaHome()): DesktopPaths {
  return {
    profile: join(liwaHome, 'profiles', 'desktop'),
    lock: join(liwaHome, 'profiles', 'desktop', 'lock'),
  }
}
