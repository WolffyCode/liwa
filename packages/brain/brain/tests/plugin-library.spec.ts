import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { ImplId } from '../src/brand.ts'
import { readPluginLibrary, writePluginLibraryRecord } from '../src/plugin-library.ts'
let host: BrainTestHost | undefined
afterEach(async () => { await host?.dispose() })
it('rejects damaged library records and unreadable library directories', async () => {
  host = await createBrainTestHost()
  const root = join(host.root, 'agents')
  const records = join(root, 'plugin-library', 'records')
  await mkdir(records, { recursive: true })
  await writeFile(join(records, 'README'), 'ignored')
  expect(await readPluginLibrary(root)).toEqual([])
  await writeFile(join(records, 'bad.json'), '{')
  await expect(readPluginLibrary(root)).rejects.toThrow()
  await writeFile(join(host.root, 'not-directory'), '')
  await expect(readPluginLibrary(join(host.root, 'not-directory'))).rejects.toThrow()
})
it('keeps one atomic record per key and validates persisted metadata', async () => {
  host = await createBrainTestHost()
  const record = { key: 'fake/review@demo', impl: ImplId('fake'), name: 'review', marketplace: 'demo', version: '1', dir: join(host.root, 'plugin') }
  await writePluginLibraryRecord(host.root, record)
  await writePluginLibraryRecord(host.root, { ...record, version: '2' })
  expect(await readPluginLibrary(host.root)).toEqual([{ ...record, version: '2' }])
  const directory = join(host.root, 'plugin-library', 'records')
  expect(await readdir(directory)).toHaveLength(1)
  expect(await readFile(join(directory, (await readdir(directory))[0]!), 'utf8')).not.toContain('TOKEN')
})
