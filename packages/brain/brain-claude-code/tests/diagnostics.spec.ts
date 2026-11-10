import { describe, expect, it, vi } from 'vitest'
import { ClaudeDiagnostics } from '../src/diagnostics.ts'

describe('known secret diagnostic boundary', () => {
  it('holds every possible split, shared prefixes, repeated secrets and incomplete EOF', () => {
    const secret = 'fake-secret-标记'
    const diagnostics = new ClaudeDiagnostics([secret, secret, '', 'fake-second'])
    for (let split = 1; split < secret.length; split++) {
      const chunks: string[] = []
      const stream = diagnostics.stream(text => chunks.push(text))
      stream.write(`error ${secret.slice(0, split)}`)
      expect(chunks.join('')).toBe('error ')
      stream.write(`${secret.slice(split)} twice ${secret} end`)
      stream.end()
      stream.end()
      expect(chunks.join('')).toBe('error [redacted] twice [redacted] end')
    }
    const chunks: string[] = []
    const stream = diagnostics.stream(text => chunks.push(text))
    stream.write('fake-s')
    stream.end()
    expect(chunks.join('')).toBe('[redacted]')
    const passthrough = new ClaudeDiagnostics([]).stream(text => chunks.push(text))
    passthrough.write('normal')
    passthrough.end()
    expect(chunks.at(-1)).toBe('normal')
  })

  it('does not emit a shorter secret before a longer secret with the same prefix is complete', () => {
    const chunks: string[] = []
    const stream = new ClaudeDiagnostics(['fake', 'fake-secret', 'fake-secret-more']).stream(text => chunks.push(text))
    stream.write('fake')
    stream.write('-secret')
    expect(chunks).toEqual([])
    stream.write('-more!')
    stream.end()
    expect(chunks.join('')).toBe('[redacted]!')
  })

  it('redacts formatted logs and thrown native errors without losing classification', async () => {
    const quoted = 'fake-"quoted"\nsecret'
    const diagnostics = new ClaudeDiagnostics(['fake-secret', quoted])
    const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = diagnostics.logger(sink).child({ secret: 'fake-secret' })
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      logger[level]({ err: new Error('fake-secret'), extra: quoted }, 'failed fake-secret')
      expect(JSON.stringify(sink[level].mock.calls)).not.toContain('fake-secret')
      expect(JSON.stringify(sink[level].mock.calls)).toContain('[redacted]')
      expect(JSON.stringify(sink[level].mock.calls)).not.toContain('quoted')
    }
    const failure = Object.assign(new Error('bad fake-secret'), { category: 'auth' })
    await expect(diagnostics.protect(() => Promise.reject(failure))).rejects.toMatchObject({ category: 'auth', message: 'bad [redacted]' })
    expect(failure.stack).not.toContain('fake-secret')
    const noStack = new Error('fake-secret')
    delete noStack.stack
    await expect(diagnostics.protect(() => Promise.reject(noStack))).rejects.toThrow('[redacted]')
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- 外部 SDK 拒绝值是 unknown，验证边界脱敏。
    await expect(diagnostics.protect(() => Promise.reject('fake-secret'))).rejects.toThrow('[redacted]')
    expect(await diagnostics.protect(() => Promise.resolve('ok'))).toBe('ok')
  })
})
