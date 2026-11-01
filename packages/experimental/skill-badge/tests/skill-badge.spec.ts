import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@liwa/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@liwa/skill'
import * as SkillBadge from '@liwa/skill-badge'

describe('liwa-skill-badge', () => {
  it('registers and disposes the bundled badge skill', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillBadge)
    const resourcePath = fileURLToPath(new URL('../assets/', import.meta.url))

    expect(await ctx.skills.list()).toEqual([{
      name: 'liwa-badge',
      description: 'Add the official “powered by liwa” badge to documents, pull requests, merge requests, and other content produced with Liwa. Use whenever creating a pull request or merge request. Also use when the user asks for a liwa badge, powered-by-liwa attribution, or a reusable liwa badge asset or snippet.',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'liwa-badge',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: resourcePath },
    }])
    const loaded = await ctx.skills.get('liwa-badge')
    expect(loaded?.content).toContain('Preserve the badge\'s 121×20 dimensions')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: resourcePath })

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('presents the component as Liwa with the bundle tag artwork in both locales', async () => {
    expect(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))).toMatchObject({
      icon: './icon.svg',
      exports: { './locale/*.json': './locale/*.json' },
    })
    for (const [language, title] of [['en', 'Liwa'], ['zh', '灵鲸']] as const) {
      expect(JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8')))
        .toMatchObject({ meta: { title } })
    }
    expect(await readFile(new URL('../icon.svg', import.meta.url), 'utf8'))
      .toBe(await readFile(new URL('../../badge-skill-bundle/icon.svg', import.meta.url), 'utf8'))
  })

  it('ships the 726×120 badge PNG unchanged', async () => {
    const image = await readFile(new URL('../assets/liwa-badge.png', import.meta.url))
    expect(image.readUInt32BE(16)).toBe(726)
    expect(image.readUInt32BE(20)).toBe(120)
    expect(createHash('sha256').update(image).digest('hex')).toBe(
      '07508668b920a1395f027243b1cef5b40c1490e90437f5a2bd159bb8a1ef28f7',
    )
  })
})
