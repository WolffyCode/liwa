import { describe, expect, it } from 'vitest'
import {
  LIWA_METHODS, LiwaCancelMetaSchema, LiwaChildEventSchema, LiwaPromptMetaSchema, LiwaSessionMetaSchema, LiwaSteerParamsSchema,
  LiwaUpdateMetaSchema, addLiwaUsage, liwaMeta, liwaMetaOf, type LiwaUsage,
} from '../src/protocol.ts'

describe('_liwa wire protocol', () => {
  it('round-trips session meta through `_meta.liwa`', () => {
    const meta = {
      mindKind: 'work' as const,
      owner: { taskId: 't1', gen: 2 },
      notes: 'notes',
      version: 'v1',
      limits: { maxInferencesPerTurn: 4, maxToolCallsPerTurn: 8, watchdogMs: 1_000 },
      concludeOn: ['report'],
      model: 'deepseek-flash',
      keepQueue: true,
      childPolicy: { native: true, maxDepth: 1, maxConcurrent: 2 },
      nativeToolPolicy: 'readonly' as const,
    }
    const wire: unknown = JSON.parse(JSON.stringify({ cwd: '/w', _meta: liwaMeta(meta) }))
    expect(LiwaSessionMetaSchema.parse(liwaMetaOf(wire))).toEqual(meta)
    expect(liwaMetaOf(null)).toBeUndefined()
    expect(liwaMetaOf({ _meta: 'x' })).toBeUndefined()
    expect(LiwaSessionMetaSchema.safeParse({ mindKind: 'nap' }).success).toBe(false)
    expect(LiwaSessionMetaSchema.safeParse({ nativeToolPolicy: 'all' }).success).toBe(false)
  })

  it('validates the method payloads and child events', () => {
    expect(Object.values(LIWA_METHODS)).toEqual(['_liwa/steer', '_liwa/usage', '_liwa/children'])
    expect(LiwaSteerParamsSchema.safeParse({ sessionId: 's', prompt: [] }).success).toBe(false)
    expect(LiwaSteerParamsSchema.parse({ sessionId: 's', prompt: [{ type: 'text', text: 'look' }, { type: 'image', data: 'AA==', mimeType: 'image/png' }] }).prompt).toHaveLength(2)
    expect(LiwaSteerParamsSchema.safeParse({ sessionId: 's', prompt: [{ type: 'audio', data: 'AA==' }] }).success).toBe(false)
    expect(LiwaUpdateMetaSchema.parse({ turn: { event: 'started', turnId: 'a' } })).toEqual({ turn: { event: 'started', turnId: 'a' } })
    expect(LiwaUpdateMetaSchema.parse({ turn: { event: 'ended', turnId: 'a', stopReason: 'cancelled', usage: {} } }).turn).toMatchObject({ stopReason: 'cancelled' })
    expect(LiwaUpdateMetaSchema.safeParse({ turn: { event: 'ended', turnId: 'a', usage: {} } }).success).toBe(false)
    expect(LiwaCancelMetaSchema.parse({ keepQueue: false, stopChildren: true })).toEqual({ keepQueue: false, stopChildren: true })
    expect(LiwaChildEventSchema.parse({ event: 'ended', childId: 'c', stopReason: 'aborted', usage: {} })).toMatchObject({ event: 'ended' })
    expect(LiwaPromptMetaSchema.parse({ usage: { inferences: 2 }, concludedBy: 'reply' })).toEqual({ usage: { inferences: 2 }, concludedBy: 'reply' })
  })

  it('adds usage without inventing absent fields', () => {
    const total: LiwaUsage = {}
    addLiwaUsage(total, { inferences: 1 })
    expect(total).toEqual({ inferences: 1 })
    addLiwaUsage(total, { tokens: { input: 3, output: 1 } })
    addLiwaUsage(total, { tokens: { input: 2, output: 2, cacheRead: 5 }, inferences: 1 })
    expect(total).toEqual({ tokens: { input: 5, output: 3, cacheRead: 5 }, inferences: 2 })
  })
})
