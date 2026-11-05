/** Shipped profile templates, and the offline catalog that does not depend on installed provider packages or registry requests. */

import { describe, expect, it } from 'vitest'
import { OFFICIAL_ON_DEMAND_CATALOG, ON_DEMAND_BUNDLES, PROFILE_TEMPLATES } from '../src/index.ts'

describe('Official on-demand catalog', () => {
  it('offers exactly the two native subagent integrations with offline localized metadata', () => {
    expect(ON_DEMAND_BUNDLES).toEqual(['@liwa/subagent-claude-code', '@liwa/subagent-codex'])
    expect(OFFICIAL_ON_DEMAND_CATALOG.map(entry => entry.packageName)).toEqual(ON_DEMAND_BUNDLES)
    for (const entry of OFFICIAL_ON_DEMAND_CATALOG) {
      expect(entry.meta.icon).toMatch(/^data:image\/svg\+xml;base64,/)
      for (const text of [entry.meta.title, entry.meta.description]) {
        if (typeof text === 'string') throw new Error('Official metadata requires both shipped languages')
        expect(text.en).toMatch(/\S/)
        expect(text.zh).toMatch(/\S/)
      }
      expect(entry).not.toHaveProperty('version')
    }
  })
})

describe('Shipped profile templates', () => {
  it('stack each mode bundle on base except the standalone minimal SDK', () => {
    expect(PROFILE_TEMPLATES).toEqual({
      acp: { bundles: ['@liwa/base', '@liwa/acp-app'] },
      web: { bundles: ['@liwa/base', '@liwa/web-app'] },
      headless: { bundles: ['@liwa/base', '@liwa/headless'] },
      sdk: { bundles: ['@liwa/base', '@liwa/sdk-app'] },
      'sdk-minimal': { bundles: ['@liwa/sdk-minimal'] },
      brain: { bundles: ['@liwa/base', '@liwa/brain-cli'] },
      deepseek: { bundles: ['@liwa/base', '@liwa/deepseek-app'] },
    })
  })
})
