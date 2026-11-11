import { Context } from '@liwa/cordis'
import { expect, it } from 'vitest'
import Plugin, { Config } from '../src/index.ts'

it('loads and releases the B scaffold without starting a business runtime', async () => {
  const ctx = new Context()
  try {
    const config = Config({})
    const fiber = ctx.plugin(Plugin, config)
    await fiber
    expect(ctx.get('structuredGeneration')).toBeInstanceOf(Plugin)
    expect(ctx.get('structuredGeneration')?.config).toEqual(config)
    await fiber.dispose()
    expect(ctx.get('structuredGeneration')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
  }
})

it('rejects an invalid deployment limit', () => {
  expect(() => Config({ ...{}, maxCorrections: -1 })).toThrow()
})
