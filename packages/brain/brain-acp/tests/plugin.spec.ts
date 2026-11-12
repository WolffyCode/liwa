import { afterEach, expect, it } from 'vitest'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import BrainRegistry from '@liwa/brain'
import { ACP_VENDORS, Config, apply } from '../src/index.ts'

let host: BrainTestHost | undefined
afterEach(async () => { await host?.dispose() })

it('registers every vendor shim without starting its executable, including default and explicit Copilot commands', async () => {
  host = await createBrainTestHost()
  await host.ctx.plugin(BrainRegistry, { membersRoot: host.root })
  for (const vendor of ACP_VENDORS) {
    apply(host.ctx, Config({ impl: `vendor-${vendor}`, vendor, command: [process.execPath, 'fixture'], env: {}, label: 'Fixture' }))
  }
  apply(host.ctx, Config({ impl: 'copilot-default', vendor: 'copilot', command: [], env: {} }))
  apply(host.ctx, Config({ impl: 'generic-unlabelled', vendor: 'generic', command: [process.execPath], env: {} }))
  expect(host.ctx.brains.list()).toHaveLength(8)
  expect(host.ctx.brains.listSessions()).toEqual([])
  expect(() =>{  apply(host!.ctx, Config({ impl: 'missing', vendor: 'generic', command: [], env: {} })) }).toThrow('command is required')
})
