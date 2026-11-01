/**
 * Shared filesystem path helpers for Liwa user data.
 *
 * @module @liwa/home-paths
 */

import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Directory name for the default Liwa home under the OS home. */
export const LIWA_HOME_DIR_NAME = '.liwa'

/** Stable user-facing display form for the default Liwa home. */
export const DEFAULT_LIWA_HOME_DISPLAY = `~/${LIWA_HOME_DIR_NAME}`

/** Environment variable that overrides the default Liwa home. */
export const LIWA_HOME_ENV = 'LIWA_HOME'

/** Directory name for the default shared agent configuration root under the OS home. */
export const AGENTS_HOME_DIR_NAME = '.agents'

/** Stable user-facing display form for the default shared agent configuration root. */
export const DEFAULT_AGENTS_HOME_DISPLAY = `~/${AGENTS_HOME_DIR_NAME}`

/** Environment variable that overrides the default shared agent configuration root. */
export const AGENTS_HOME_ENV = 'LIWA_AGENTS_HOME'

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet. The deepest existing ancestor
 * is resolved through {@link realpath}; when a suffix is missing, that
 * ancestor is also proved to be an enumerable directory before the suffix is
 * restored. This prevents Windows from treating a regular-file ancestor as
 * ordinary absence, and prevents short-name aliases from being mixed with
 * long paths emitted by the native watcher backend.
 * @param path - Watch target or root, resolved against the current directory.
 * @returns the target with its existing ancestor canonicalized.
 * @throws when ancestor traversal encounters an error other than absence, or
 * the existing ancestor of a missing suffix is not an enumerable directory.
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) {
        // A Windows file-as-parent probe reports ENOENT. Opening the resolved
        // ancestor preserves the cross-platform directory requirement.
        const directory = await opendir(canonical)
        await directory.close()
      }
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      /* v8 ignore next -- a filesystem root exists, so traversal resolves before this guard */
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Resolve the default Liwa home using Node's platform path rules.
 * @returns the absolute default Liwa home path.
 */
export function defaultLiwaHome(): string {
  return join(homedir(), LIWA_HOME_DIR_NAME)
}

/**
 * Resolve the default shared agent configuration root using Node's platform path rules.
 * @returns the absolute default shared agent configuration root.
 */
export function defaultAgentsHome(): string {
  return join(homedir(), AGENTS_HOME_DIR_NAME)
}

/**
 * Expand supported tilde prefixes against the operating-system home.
 * @param path - configured path that may begin with `~`, `~/`, or `~\`.
 * @returns the expanded path, or the original value when no supported prefix is present.
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve one user-data root from an explicit path, an environment override, and a default.
 * @param configured - explicit path, which has highest precedence.
 * @param env - environment mapping to read.
 * @param envName - environment variable that overrides the default.
 * @param fallback - default root, used when neither the explicit path nor the environment provides one.
 * @returns the normalized absolute root.
 */
function resolveRoot(
  configured: string | undefined,
  env: Record<string, string | undefined>,
  envName: string,
  fallback: () => string,
): string {
  const fromEnv = env[envName]
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : fallback())
  return resolve(expandHomePath(selected))
}

/**
 * Label one resolved user-data root symbolically for user-facing display.
 * @param resolvedRoot - absolute path returned by the matching resolver.
 * @param defaultRoot - absolute default root whose symbolic label applies to a match.
 * @param defaultLabel - symbolic label for the default root.
 * @param envName - environment variable name that labels any other root.
 * @returns the symbolic label.
 */
function rootDisplay(resolvedRoot: string, defaultRoot: string, defaultLabel: string, envName: string): string {
  return resolvedRoot === resolve(defaultRoot) ? defaultLabel : `$${envName}`
}

/**
 * Resolve the single-root Liwa home.
 *
 * Precedence, highest first: an explicit configured path, `$LIWA_HOME`, then
 * `~/.liwa`. Liwa keeps all user data under one root. An empty or
 * whitespace-only `$LIWA_HOME` is treated as unset, so a blank override never
 * resolves the home to the current working directory.
 * @param configured - explicit Liwa-home override, which has highest precedence.
 * @param env - environment mapping used to read `LIWA_HOME`.
 * @returns the normalized absolute Liwa home path.
 */
export function resolveLiwaHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  return resolveRoot(configured, env, LIWA_HOME_ENV, defaultLiwaHome)
}

/**
 * Resolve the shared agent configuration root.
 *
 * Precedence, highest first: an explicit configured path, `$LIWA_AGENTS_HOME`,
 * then `~/.agents`. The root holds configuration shared with other agent tools,
 * so it stays independent of the Liwa home. An empty or
 * whitespace-only `$LIWA_AGENTS_HOME` is treated as unset, so a blank override
 * never resolves the root to the current working directory.
 * @param configured - explicit shared-root override, which has highest precedence.
 * @param env - environment mapping used to read `LIWA_AGENTS_HOME`.
 * @returns the normalized absolute shared agent configuration root.
 */
export function resolveAgentsHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  return resolveRoot(configured, env, AGENTS_HOME_ENV, defaultAgentsHome)
}

/**
 * Join path segments onto the resolved Liwa home.
 * @param segments - path segments appended to the Liwa home; an empty list returns the home itself.
 * @returns the normalized absolute joined path.
 */
export function liwaHomePath(...segments: string[]): string {
  return join(resolveLiwaHome(), ...segments)
}

/**
 * Join path segments onto the resolved Liwa home's `cache` directory without creating it; no arguments returns the directory itself.
 * @param optionsOrSegment - explicit home override, or the first path segment; omission uses the default home resolution.
 * @param segments - additional path segments after the first child, if any.
 * @returns the normalized absolute cache path.
 */
export function liwaCachePath(optionsOrSegment: { liwaHome?: string } | string = {}, ...segments: string[]): string {
  if (typeof optionsOrSegment === 'string') return liwaHomePath('cache', optionsOrSegment, ...segments)
  return join(resolveLiwaHome(optionsOrSegment.liwaHome), 'cache', ...segments)
}

/**
 * Describe a resolved Liwa home symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default home is labelled
 * `~/.liwa`, and any configured home is labelled `$LIWA_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveLiwaHome}.
 * @returns `~/.liwa` for the default home, otherwise `$LIWA_HOME`.
 */
export function liwaHomeDisplay(resolvedHome: string): string {
  return rootDisplay(resolvedHome, defaultLiwaHome(), DEFAULT_LIWA_HOME_DISPLAY, LIWA_HOME_ENV)
}

/**
 * Describe a resolved shared agent configuration root symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default root is labelled
 * `~/.agents`, and any configured root is labelled `$LIWA_AGENTS_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveAgentsHome}.
 * @returns `~/.agents` for the default root, otherwise `$LIWA_AGENTS_HOME`.
 */
export function agentsHomeDisplay(resolvedHome: string): string {
  return rootDisplay(resolvedHome, defaultAgentsHome(), DEFAULT_AGENTS_HOME_DISPLAY, AGENTS_HOME_ENV)
}
