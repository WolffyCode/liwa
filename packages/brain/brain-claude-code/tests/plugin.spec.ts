import { fakeClaudeBinary } from './fixtures/binary.ts'
import { fakeAuthEnv } from './fixtures/auth.ts'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import BrainRegistry, { ImplId } from '@liwa/brain'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import * as plugin from '../src/index.ts'

let host: BrainTestHost | undefined
afterEach(async () => { await host?.dispose() })

it('registers an instance configured by plaintext env, probes its binary and releases the registration', async () => {
  host = await createBrainTestHost()
  const binary = await fakeClaudeBinary(host.root)
  await host.ctx.plugin(BrainRegistry, { membersRoot: join(host.root, 'members') })
  const fiber = host.ctx.plugin(plugin, { impl: 'test-claude', binary, env: fakeAuthEnv, models: [{ id: 'mock', label: 'Mock', isDefault: true }] } as plugin.Config)
  await fiber
  expect((await host.ctx.brains.probe(ImplId('test-claude'))).available).toBe(true)
  await fiber.dispose()
  expect(host.ctx.brains.list()).toEqual([])
})
