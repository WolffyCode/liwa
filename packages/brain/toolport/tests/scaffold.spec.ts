import { Context } from '@liwa/cordis'
import { expect, it } from 'vitest'
import Plugin, { Config } from '../src/index.ts'

it('loads and releases the B scaffold without starting a business runtime', async () => {
  const ctx = new Context()
  try {
    const config = Config({ listen: 'loopback', tokenTtlMs: 1000 })
    const fiber = ctx.plugin(Plugin, config)
    await fiber
    expect(ctx.get('toolport')).toBeInstanceOf(Plugin)
    expect(ctx.get('toolport')?.config).toEqual(config)
    await fiber.dispose()
    expect(ctx.get('toolport')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
  }
})

it('rejects an invalid deployment limit', () => {
  expect(() => Config({ ...{ listen: 'loopback', tokenTtlMs: 1000 }, tokenTtlMs: -1 })).toThrow()
})
