/**
 * Loader-entry classification shared by repository checks. They parse Cordis YAML with Include's own dialect,
 * `parseEntryYaml`, so a check reads a file exactly as the booted Include does.
 * @module scripts/cordis-yaml
 */

/**
 * Test whether a Loader entry owns nested entries in its `config` array.
 * @param value - parsed Loader entry.
 * @returns whether the entry is an explicit or package-named Cordis group.
 */
export function isCordisGroupEntry(value: unknown): value is Record<string, unknown> & { config: unknown[] } {
  return typeof value === 'object'
    && value !== null
    && Array.isArray((value as Record<string, unknown>).config)
    && ((value as Record<string, unknown>).group === true
      || (value as Record<string, unknown>).name === '@deepseek-ai/cordis-plugin-group')
}

/** Test whether an entry declares an Agent preset with a child plugin list.
 * @param value Parsed Loader entry.
 * @returns Whether config.plugins contains nested entries owned by a preset.
 */
export function isAgentPresetEntry(value: unknown): value is Record<string, unknown> & { config: { id: string; plugins: unknown[] } } {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  if (row.name !== '@deepseek-ai/dsh-agent-preset' || typeof row.config !== 'object' || row.config === null) return false
  const config = row.config as Record<string, unknown>
  return typeof config.id === 'string' && Array.isArray(config.plugins)
}

/** Read preset definitions nested in ordinary groups and patch insertions.
 * @param value Parsed Cordis YAML.
 * @returns Declared identities and child configurations in document order.
 */
export function presetDefinitions(value: unknown): { id: string; plugins: unknown[] }[] {
  if (Array.isArray(value)) return value.flatMap(presetDefinitions)
  if (isAgentPresetEntry(value)) return [value.config]
  if (typeof value !== 'object' || value === null) return []
  const row = value as Record<string, unknown>
  return [...presetDefinitions(row.insert), ...(isCordisGroupEntry(row) ? presetDefinitions(row.config) : [])]
}
