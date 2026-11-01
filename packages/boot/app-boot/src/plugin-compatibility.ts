/** Evaluate plugin liwa requirements (`engines.liwa`, else liwa peers) without importing plugin code. */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

/** Unmet liwa requirements and the exact plugin/runtime exemption decision. */
export interface PluginCompatibility {
  name: string
  version: string
  runtimeVersion: string
  /** Only requirements the running liwa version does not satisfy: `engines.liwa`, or liwa peer package names. */
  requirements: Record<string, string>
  exempted: boolean
}

/**
 * `@liwa` packages that version independently of the runtime: the vendored framework (`vendor/`), the native
 * addon family (`native/`), and the documentation website. They share the scope since the rename, so the scope
 * alone no longer identifies the runtime family.
 */
const INDEPENDENTLY_VERSIONED_PACKAGE =
  /^@liwa\/(?:cordis|cordis-plugin-[a-z0-9-]+|cosmokit|schemastery|node-addon-system(?:-[a-z0-9-]+)?|website)$/u

/**
 * Whether a package belongs to the Liwa runtime family, whose versions move with the runtime version.
 * @param name - npm package name.
 * @returns true for `@liwa/*` packages other than the vendored framework, the native addons, and the website.
 */
export function isLiwaRuntimePackage(name: string): boolean {
  return name.startsWith('@liwa/') && !INDEPENDENTLY_VERSIONED_PACKAGE.test(name)
}

function objectOf(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function runtimeVersionOf(value: unknown): string {
  if (typeof value !== 'string' || semver.valid(value) === null) {
    throw new Error(`Invalid liwa runtime version: ${JSON.stringify(value)}; expected a semantic version`)
  }
  return value
}

function identityField(manifest: Record<string, unknown>, field: 'name' | 'version'): string {
  const value = Object.hasOwn(manifest, field) ? manifest[field] : undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Plugin manifest ${field} must be a non-empty string when liwa requirements are unmet`)
  }
  return value
}

/**
 * Read this app-boot package's version in both source and bundled installations.
 * @returns the validated runtime semantic version, preserving its exact spelling.
 * @throws if package.json cannot be read or its version is missing or invalid.
 */
export function getLiwaRuntimeVersion(): string {
  // The executable's virtual filesystem intercepts string paths, not URL arguments.
  const filename = fileURLToPath(new URL('../package.json', import.meta.url))
  const manifest = objectOf(JSON.parse(fs.readFileSync(filename, 'utf8')), 'app-boot package.json')
  return runtimeVersionOf(Object.hasOwn(manifest, 'version') ? manifest.version : undefined)
}

function satisfies(runtimeVersion: string, range: string): boolean {
  return range.trim() !== '' && semver.satisfies(runtimeVersion, range, { includePrerelease: true })
}

function unmetRequirements(fields: Record<string, unknown>, runtimeVersion: string): Record<string, string> {
  const engines = Object.hasOwn(fields, 'engines') ? objectOf(fields.engines, 'Plugin manifest engines') : {}
  if (Object.hasOwn(engines, 'liwa')) {
    const range = engines.liwa
    if (typeof range !== 'string') throw new Error('Plugin manifest engines.liwa must be a string')
    return satisfies(runtimeVersion, range) ? {} : { 'engines.liwa': range }
  }
  if (!Object.hasOwn(fields, 'peerDependencies')) return {}
  const dependencies = objectOf(fields.peerDependencies, 'Plugin manifest peerDependencies')
  const unmet: Record<string, string> = {}
  for (const [name, range] of Object.entries(dependencies)) {
    if (typeof range !== 'string') {
      throw new Error(`Plugin manifest peerDependencies[${JSON.stringify(name)}] must be a string`)
    }
    if (!isLiwaRuntimePackage(name)) continue
    const requirement = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? runtimeVersion : range
    if (!satisfies(runtimeVersion, requirement)) unmet[name] = range
  }
  return unmet
}

/**
 * Check the plugin's liwa requirements against the runtime. An own `engines.liwa` range decides alone and
 * peerDependencies are ignored; otherwise every Liwa runtime-family peer ({@link isLiwaRuntimePackage}) must match.
 * Prereleases participate in ranges. For peers only, workspace:^, workspace:~, and workspace:* refer to
 * the current runtime; other empty or invalid ranges, including any workspace: `engines.liwa`, are unmet.
 * @param manifest - parsed plugin package.json; inherited fields are ignored.
 * @param exemptions - exact plugin name@version keys mapped to exact runtime versions.
 * @param runtimeVersion - running liwa version, defaulting to this app-boot package.
 * @returns unmet requirements and exemption status, or undefined when every requirement is met.
 * @throws for malformed manifest engines or peer fields, invalid runtime versions, or missing identity on a mismatch.
 */
export function evaluatePluginCompatibility(
  manifest: object,
  exemptions: Readonly<Record<string, readonly string[]>> = {},
  runtimeVersion = getLiwaRuntimeVersion(),
): PluginCompatibility | undefined {
  runtimeVersionOf(runtimeVersion)
  const fields = objectOf(manifest, 'Plugin manifest')
  const requirements = unmetRequirements(fields, runtimeVersion)
  if (Object.keys(requirements).length === 0) return undefined
  const name = identityField(fields, 'name')
  const version = identityField(fields, 'version')
  const key = `${name}@${version}`
  const exemptedVersions = Object.hasOwn(exemptions, key) ? exemptions[key] : undefined
  const exempted = exemptedVersions?.includes(runtimeVersion) === true
  return { name, version, runtimeVersion, requirements, exempted }
}

/**
 * Describe unmet requirements, their risk, and the exact-version remedy.
 * Surfaces with their own grant mechanism or locale render the structured result themselves.
 * @param issue - incompatible plugin/runtime result, including exempted mismatches.
 * @returns an English diagnostic for logs and stderr.
 */
export function pluginCompatibilityWarning(issue: PluginCompatibility): string {
  const key = `${issue.name}@${issue.version}`
  return `Plugin ${key} is incompatible with liwa ${issue.runtimeVersion}: requirements ${JSON.stringify(issue.requirements)}. `
    + 'Running it may cause crashes or data loss. '
    + 'Update the plugin or install a plugin version compatible with this liwa runtime. '
    + `To accept this risk explicitly, grant the exact-version exemption for ${key} on liwa ${issue.runtimeVersion} with \`liwa plugin allow-version\` or the plugin manager, then retry the installation or restart liwa. `
    + `Exact-version exemption: ${issue.exempted ? 'active' : 'not active'}.`
}
