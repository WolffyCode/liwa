import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { BrainBlobStore, checkPermissionAnswers, replaceSkills } from '../src/index.ts'

let host: BrainTestHost | undefined
afterEach(async () => { await host?.dispose() })

it('cleans a failed atomic blob rename and reports non-directory skill sources', async () => {
  host = await createBrainTestHost()
  const bytes = new Uint8Array([3, 4])
  const hash = createHash('sha256').update(bytes).digest('hex')
  const store = new BrainBlobStore(join(host.root, 'atomic'))
  await mkdir(join(store.dir, hash), { recursive: true })
  await expect(store.put(bytes, 'application/octet-stream')).rejects.toThrow()
  expect(await readdir(store.dir)).toEqual([hash])
  const target = join(host.root, 'skills')
  await replaceSkills('', target)
  expect(await readdir(target)).toEqual([])
  const file = join(host.root, 'file')
  await writeFile(file, 'not a skill directory')
  await expect(replaceSkills(file, target)).rejects.toMatchObject({ code: 'brain.skills_dir_missing' })
})

it('reports schema failures in user answers without discarding their actionable details', () => {
  const questions = [{ id: 'q', question: 'Choose', multiSelect: false, options: [{ label: 'A' }] }]
  expect(checkPermissionAnswers(questions, { q: { selected: [], custom: '' } })).toContain('invalid')
  expect(checkPermissionAnswers(questions, { q: { selected: [] } })).toContain('selects an option')
  expect(checkPermissionAnswers(questions, {})).toContain('has no answer')
})
