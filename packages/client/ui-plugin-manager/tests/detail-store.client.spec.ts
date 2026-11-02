import { Context } from '@liwa/cordis'
import { RemoteError, TestRemote } from '@liwa/client-test-runtime'
import type { BundleDetail } from '@liwa/api-remotes/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { BundleDetailController, bundleDetailKey } from '../src/client/detail-store.ts'

type Answer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RemoteError<never> }
const ok = <T>(value: T): Promise<Answer<T>> => Promise.resolve({ ok: true, value })
const FOUND: BundleDetail = { status: 'found', origin: 'readme', path: 'README.md', markdown: '# A' }
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0) })

function setup() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const manager = {
    readBundleDetail: vi.fn((_name: string, _language: string): Promise<Answer<BundleDetail>> => ok(FOUND)),
  }
  new TestRemote(ctx, { pluginManager: manager })
  const controller = new BundleDetailController(ctx, () => 'https://liwa.example/prefix/')
  const state = (name: string, version: string | undefined, language: string) =>
    controller.store.getSnapshot()[bundleDetailKey(name, version, language)]
  return { controller, manager, state }
}

it('reads each bundle version once per language and publishes the result', async () => {
  const { controller, manager, state } = setup()
  controller.load('a', '1.0.0', 'en')
  controller.load('a', '1.0.0', 'en')
  expect(state('a', '1.0.0', 'en')).toEqual({ status: 'loading' })
  await vi.waitFor(() => { expect(state('a', '1.0.0', 'en')).toEqual({ status: 'ready', detail: FOUND }) })
  controller.load('a', undefined, 'zh')
  await vi.waitFor(() => { expect(state('a', undefined, 'zh')?.status).toBe('ready') })
  expect(manager.readBundleDetail.mock.calls).toEqual([['a', 'en'], ['a', 'zh']])
})

it('reports failures by reason, reads again on retry, and settles a retried key with the latest answer', async () => {
  const { controller, manager, state } = setup()
  manager.readBundleDetail.mockImplementationOnce(() => Promise.resolve({ ok: false, error: new RemoteError('plugin-manager/detail-unavailable' as never, 'big', { reason: 'too-large' } as never) }))
  manager.readBundleDetail.mockImplementationOnce(() => Promise.resolve({ ok: false, error: new RemoteError('plugin-manager/unknown-bundle' as never, 'gone', { name: 'b' } as never) }))
  controller.load('a', '1.0.0', 'en')
  controller.load('b', '1.0.0', 'en')
  await vi.waitFor(() => {
    expect(state('a', '1.0.0', 'en')).toEqual({ status: 'error', failure: 'too-large' })
    expect(state('b', '1.0.0', 'en')).toEqual({ status: 'error', failure: 'other' })
  })
  let first: (value: Answer<BundleDetail>) => void = () => {}
  manager.readBundleDetail.mockImplementationOnce(() => new Promise((resolve) => { first = resolve }))
  controller.retry('a', '1.0.0', 'en')
  controller.retry('a', '1.0.0', 'en')
  await vi.waitFor(() => { expect(state('a', '1.0.0', 'en')).toEqual({ status: 'ready', detail: FOUND }) })
  first({ ok: true, value: { status: 'none' } })
  await flush()
  expect(state('a', '1.0.0', 'en')).toEqual({ status: 'ready', detail: FOUND })
})

it('invalidates reads on reset, drops superseded answers, and stops publishing after disposal', async () => {
  const { controller, manager, state } = setup()
  let answer: (value: Answer<BundleDetail>) => void = () => {}
  manager.readBundleDetail.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
  controller.load('a', '1.0.0', 'en')
  controller.reset()
  answer({ ok: true, value: FOUND })
  await flush()
  expect(controller.store.getSnapshot()).toEqual({})
  // A read from before a reset that settles after the read that replaced it does not overwrite it.
  let stale: (value: Answer<BundleDetail>) => void = () => {}
  manager.readBundleDetail.mockImplementationOnce(() => new Promise((resolve) => { stale = resolve }))
  controller.load('a', '1.0.0', 'en')
  controller.reset()
  manager.readBundleDetail.mockImplementationOnce(() => ok({ status: 'none' }))
  controller.load('a', '1.0.0', 'en')
  await vi.waitFor(() => { expect(state('a', '1.0.0', 'en')).toEqual({ status: 'ready', detail: { status: 'none' } }) })
  stale({ ok: true, value: FOUND })
  await flush()
  expect(state('a', '1.0.0', 'en')).toEqual({ status: 'ready', detail: { status: 'none' } })
  controller.reset()
  manager.readBundleDetail.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
  controller.load('a', '1.0.0', 'en')
  controller.dispose()
  answer({ ok: true, value: FOUND })
  await flush()
  expect(state('a', '1.0.0', 'en')).toEqual({ status: 'ready', detail: { status: 'none' } })
})

it('addresses relative images through the Host route and leaves other destinations alone', () => {
  const { controller } = setup()
  expect(controller.image('@acme/x', 'guide/D.md', 'img/a b.png'))
    .toBe('https://liwa.example/prefix/api/plugin-manager/detail-file?bundle=%40acme%2Fx&document=guide%2FD.md&path=img%2Fa+b.png')
  for (const destination of ['https://example.com/a.png', 'data:image/png;base64,AA', '//cdn.example/a.png', '#top']) {
    expect(controller.image('x', 'README.md', destination)).toBeUndefined()
  }
})


it('retains a displayed document during invalidation and replaces it after one fresh read', async () => {
  const { controller, manager, state } = setup()
  controller.load('a', '1.0.0', 'en')
  await vi.waitFor(() => { expect(state('a', '1.0.0', 'en')).toEqual({ status: 'ready', detail: FOUND }) })
  const response = Promise.withResolvers<Answer<BundleDetail>>()
  onTestFinished(() => { response.resolve({ ok: true, value: FOUND }) })
  manager.readBundleDetail.mockImplementationOnce(() => response.promise)
  controller.reset()
  expect(state('a', '1.0.0', 'en')).toEqual({ status: 'ready', detail: FOUND })
  controller.load('a', '1.0.0', 'en')
  controller.load('a', '1.0.0', 'en')
  expect(manager.readBundleDetail).toHaveBeenCalledTimes(2)
  expect(state('a', '1.0.0', 'en')).toEqual({ status: 'ready', detail: FOUND })
  const replacement = { ...FOUND, markdown: '# Updated' }
  response.resolve({ ok: true, value: replacement })
  await vi.waitFor(() => { expect(state('a', '1.0.0', 'en')).toEqual({ status: 'ready', detail: replacement }) })
})
