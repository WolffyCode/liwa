/** The brand font remains self-contained in the desktop welcome page. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('offline brand font', () => {
  it('ships a local WOFF2 with its redistribution license', () => {
    const css = readFileSync(new URL('../renderer/brand-font.css', import.meta.url), 'utf8')
    const fontPath = /url\(\.\/([^)]*\.woff2)\)/.exec(css)?.[1]
    expect(fontPath).toBeDefined()
    const font = readFileSync(new URL(`../renderer/${fontPath!}`, import.meta.url))
    expect(font.readUInt32BE(0)).toBe(0x774f4632)
    expect(css).toContain('font-weight: 400')
    expect(css).toContain('font-weight: 300')
    const light = readFileSync(new URL('../renderer/montserrat-light.woff2', import.meta.url))
    expect(light.readUInt32BE(0)).toBe(0x774f4632)
    expect(css).toContain('font-weight: 500')
    const medium = readFileSync(new URL('../renderer/montserrat-medium.woff2', import.meta.url))
    expect(medium.readUInt32BE(0)).toBe(0x774f4632)
    expect(css).toContain('font-style: normal')
    expect(css).not.toMatch(/url\(https?:/)
    const license = readFileSync(new URL('../renderer/Montserrat-OFL.txt', import.meta.url), 'utf8')
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    const welcome = readFileSync(new URL('../renderer/welcome.html', import.meta.url), 'utf8')
    expect(welcome).toContain('href="brand-font.css"')
  })
})
