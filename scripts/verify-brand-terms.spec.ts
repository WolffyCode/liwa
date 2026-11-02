import { describe, expect, it } from 'vitest'
import { findBrandTermViolations } from './verify-brand-terms.ts'

const upstreamName = ['DeepSeek', 'Harness'].join(' ')
const abbreviation = ['d', 's', 'h'].join('')
const scope = ['@deepseek', '-ai/'].join('')

describe('brand terminology policy', () => {
  it('rejects the upstream product name, scope and abbreviation in paths, prose and identifiers', () => {
    const file = `docs/${abbreviation}-guide.md`
    const lines = [
      `Welcome to ${upstreamName}.`,
      `import { Agent } from '${scope}${abbreviation}-agent'`,
      `export ${abbreviation.toUpperCase()}_HOME=~/.${abbreviation}`,
      `const ${abbreviation}Home = resolve${abbreviation[0]?.toUpperCase()}${abbreviation.slice(1)}Home()`,
      `write('\\n${abbreviation}: warning')`,
    ]
    expect(findBrandTermViolations(file, lines.join('\n')).map(violation => violation.line))
      .toEqual([null, 1, 2, 2, 3, 3, 4, 4, 5])
  })

  it('keeps DeepSeek as the model and API provider', () => {
    const lines = [
      'DEEPSEEK_API_KEY=sk-example DEEPSEEK_BASE_URL=https://api.deepseek.com',
      'import { createConverter } from \'@deepseek-ai/libreoffice-kit\'',
      `open https://platform.deepseek.com/${abbreviation}/authorize`,
      'The handshake and the spreadsheet stay ordinary words.',
    ]
    expect(findBrandTermViolations('packages/example/src/provider.ts', lines.join('\n'))).toEqual([])
  })

  it('limits file-scoped exceptions to their files', () => {
    const line = `contextBridge.exposeInMainWorld('${abbreviation}', bridge)`
    expect(findBrandTermViolations('apps/desktop/src/preload-platform-account.ts', line)).toEqual([])
    expect(findBrandTermViolations('packages/example/src/bridge.ts', line)).toHaveLength(1)
  })

  it('skips whole files registered as historical records', () => {
    expect(findBrandTermViolations('.agents/notes/implemented/process/example.md', upstreamName)).toEqual([])
    expect(findBrandTermViolations('snapshots/session/example/session.v4.jsonl', upstreamName)).toEqual([])
  })
})
