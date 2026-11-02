/**
 * The shipped profiles call DeepSeek for model work only (Liwa decision 41): no default composition mounts a
 * plugin that uploads Session logs or usage, records feedback for upload, or adds non-model fields to model requests.
 */

import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '../packages/boot/app-boot/src/index.ts'
import { bundlePatchPaths, composeEntries } from '../packages/boot/app-boot/src/profile.ts'
import { PROFILE_TEMPLATES } from '../packages/util/official-bundles/src/bundles.ts'
import type { LiwaBundleManifest } from '../packages/util/package-manifest/src/types.ts'

const root = resolve(import.meta.dirname, '..')

/** The model route every shipped profile keeps; finding it proves the walk below reaches the composed rows. */
const MODEL_PLUGIN = '@liwa/llm-deepseek-api-key'

/** Plugins that send DeepSeek something beyond the model call itself, each with what it would send. */
const REPORTING_PLUGINS = [
  // `dsh_session_log`: the Session log suffix on every model request.
  '@liwa/session-log-deepseek',
  // `dsh_plugin_packages`: the active plugin package inventory on every model request.
  '@liwa/plugin-package-inventory-deepseek',
  // The registry that merges the two fields above into model requests; it has no other contributor.
  '@liwa/deepseek-llm-api-extensions',
  // Session-log upload to the OTLP collector after feedback, and the OTLP channel factory behind it.
  '@liwa/session-telemetry-otel',
  '@liwa/otel',
  // Desktop product analytics and its OTLP exporter.
  '@liwa/client-product-analytics',
  '@liwa/host-product-telemetry-otel',
  // Feedback capture, whose recorded events exist to authorize the uploads above.
  '@liwa/message-feedback',
  '@liwa/command-feedback',
  '@liwa/client-ui-message-feedback',
  // The Settings switch for the `dsh_session_log` upload.
  '@liwa/client-ui-settings-session-log',
]

interface Manifest {
  name: string
  liwa?: { bundle?: LiwaBundleManifest }
}

const bundleDirectories = new Map(globSync('packages/*/*/package.json', { cwd: root }).map((path) => {
  const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Manifest
  return [manifest.name, { dir: dirname(resolve(root, path)), bundle: manifest.liwa?.bundle }]
}))

function bundlePatches(name: string): ReturnType<typeof loadOverlayPatches> {
  const entry = bundleDirectories.get(name)
  if (entry?.bundle === undefined) throw new Error(`${name} is not a workspace bundle`)
  return bundlePatchPaths(entry.dir, entry.bundle).flatMap(path => loadOverlayPatches('test', path))
}

/** Every `name` in the composed tree, including rows nested in groups and agent-preset declarations. */
function pluginNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(pluginNames)
  if (typeof value !== 'object' || value === null) return []
  const nested = Object.values(value).flatMap(pluginNames)
  const name = (value as { name?: unknown }).name
  if (typeof name !== 'string') return nested
  return [name, ...nested]
}

describe.each(Object.keys(PROFILE_TEMPLATES))('shipped %s profile', (profile) => {
  it('keeps the model route and mounts no reporting plugin', () => {
    const template = PROFILE_TEMPLATES[profile]
    if (template === undefined) throw new Error(`missing profile template ${profile}`)
    const entries = composeEntries(template.bundles.map(bundlePatches))
    const mounted = new Set(pluginNames(entries))
    expect(mounted.has(MODEL_PLUGIN)).toBe(true)
    expect(REPORTING_PLUGINS.filter(name => mounted.has(name))).toEqual([])
  })
})
