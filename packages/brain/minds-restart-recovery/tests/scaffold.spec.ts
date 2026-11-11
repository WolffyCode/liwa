import { Context } from '@liwa/cordis'
import { expect, it } from 'vitest'
import * as Plugin from '../src/index.ts'
const { Config } = Plugin

it('loads and releases the B scaffold without starting a business runtime', async () => {
  const ctx = new Context()
  try {
    const config = Config({})
    const fiber = ctx.plugin(Plugin, config)
    await fiber
    expect(fiber.ctx).toBeDefined()
    await fiber.dispose()
  } finally {
    await ctx.fiber.dispose()
  }
})

it('rejects an empty resume prompt', () => {
  expect(() => Config({ prompt: '' })).toThrow()
})
