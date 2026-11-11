import { Context } from '@liwa/cordis'
import { expect, it } from 'vitest'
import Plugin, { Config } from '../src/index.ts'

it('loads and releases the B scaffold without starting a business runtime', async () => {
  const ctx = new Context()
  try {
    const config = Config({ storageRoot: 'storage', eventsRoot: 'events', logBatchMs: 10, logBatchBytes: 1024, lastActivityWriteMs: 100, timelineContentMaxChars: 2000, operationRetentionMs: 60000, catalogRefreshTimeoutMs: 1000, diagnosticTimeoutMs: 1000, catalogConcurrency: 2 })
    const fiber = ctx.plugin(Plugin, config)
    await fiber
    expect(ctx.get('minds')).toBeInstanceOf(Plugin)
    expect(ctx.get('minds')?.config).toEqual(config)
    await fiber.dispose()
    expect(ctx.get('minds')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
  }
})

it('rejects an invalid deployment limit', () => {
  expect(() => Config({ ...{ storageRoot: 'storage', eventsRoot: 'events', logBatchMs: 10, logBatchBytes: 1024, lastActivityWriteMs: 100, timelineContentMaxChars: 2000, operationRetentionMs: 60000, catalogRefreshTimeoutMs: 1000, diagnosticTimeoutMs: 1000, catalogConcurrency: 2 }, catalogConcurrency: -1 })).toThrow()
})
