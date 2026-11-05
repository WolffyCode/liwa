import { describe, expect, it } from 'vitest'
import { isCopiedPaseoSource } from './verify-export-jsdoc.ts'

describe('export JSDoc gate scope', () => {
  it('exempts only Paseo source copied under a package\'s src/paseo/ directory', () => {
    expect(isCopiedPaseoSource('packages/brain/brain-shared/src/paseo/agent/agent-sdk-types.ts')).toBe(true)
    expect(isCopiedPaseoSource('packages/brain/brain-acp/src/paseo/agent/providers/acp-agent.ts')).toBe(true)
    expect(isCopiedPaseoSource('packages/brain/brain-shared/src/paseo-extra/session.ts')).toBe(false)
    expect(isCopiedPaseoSource('packages/brain/brain-shared/src/paseo.ts')).toBe(false)
    expect(isCopiedPaseoSource('packages/brain/brain-shared/src/session.ts')).toBe(false)
    expect(isCopiedPaseoSource('vendor/paseo/src/paseo/x.ts')).toBe(false)
  })
})
