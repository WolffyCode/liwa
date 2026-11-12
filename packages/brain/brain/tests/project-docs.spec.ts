import { mkdir, mkdtemp, rm, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { collectProjectDocs, readProjectDocs, type ProjectDocumentSource } from '../src/project-docs.ts'

const sources = (files: Record<string, string>): ProjectDocumentSource[] =>
  Object.entries(files).map(([path, text]) => ({ path, realPath: path, text }))
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('collects root-to-cwd descriptions, follows imports, prefers CLAUDE and deduplicates realpaths', () => {
  const files = sources({ '/repo/CLAUDE.md': '@guide.md\nroot', '/repo/AGENTS.md': 'ignored', '/repo/guide.md': 'guide', '/repo/sub/AGENTS.md': 'sub', '/repo/sub/.claude/CLAUDE.md': 'hidden', '/repo/sub/CLAUDE.local.md': 'local' })
  files.push({ path: '/repo/sub/.claude/rules/same.md', realPath: '/repo/guide.md', text: 'guide' })
  expect(collectProjectDocs(files, '/repo', '/repo/sub').map(doc => doc.path)).toEqual(['CLAUDE.md', 'guide.md', 'sub/AGENTS.md', 'sub/.claude/CLAUDE.md', 'sub/CLAUDE.local.md'])
})

it('skips code imports, exposes missing/cyclic/outside/deep imports and conditional rules', () => {
  const code = '```\n@missing.md\n```\n`@inline.md`\n'
  expect(collectProjectDocs(sources({ '/repo/CLAUDE.md': code }), '/repo', '/repo')).toHaveLength(1)
  for (const content of ['@missing.md', '@../outside.md', '@CLAUDE.md']) {
    expect(() => collectProjectDocs(sources({ '/repo/CLAUDE.md': content }), '/repo', '/repo')).toThrow()
  }
  const chain = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`/repo/${index === 0 ? 'CLAUDE' : index}.md`, `@${index + 1}.md`]))
  expect(() => collectProjectDocs(sources(chain), '/repo', '/repo')).toThrow('depth')
  const files = sources({ '/repo/.claude/rules/all.md': 'always', '/repo/.claude/rules/ts.md': '---\npaths: ["src/**/*.ts"]\n---\nconditional' })
  expect(collectProjectDocs(files, '/repo', '/repo').map(doc => doc.text)).toEqual(['always'])
  expect(collectProjectDocs(files, '/repo', '/repo', '/repo/src/a.ts').map(doc => doc.text)).toEqual(['always', 'conditional'])
})

it('bounds filesystem discovery at the git root and rejects symlink imports leaving it', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'liwa-docs-')); roots.push(parent)
  const root = join(parent, 'repo')
  await mkdir(join(root, '.git'), { recursive: true })
  await mkdir(join(root, 'sub'))
  await writeFile(join(parent, 'CLAUDE.md'), 'outside sentinel')
  await writeFile(join(root, 'CLAUDE.md'), '@guide.md')
  await writeFile(join(root, 'guide.md'), 'inside')
  const found = await readProjectDocs(join(root, 'sub'))
  expect(found.root).toBe(await realpath(root))
  expect(found.documents.map(doc => doc.text)).toEqual(['@guide.md', 'inside'])
  await symlink(join(parent, 'CLAUDE.md'), join(root, 'escape.md'))
  await writeFile(join(root, 'CLAUDE.md'), '@escape.md')
  await expect(readProjectDocs(root)).rejects.toThrow('outside')
})

it('supports quoted imports, scalar paths and fences without interpreting inline code as imports', () => {
  const files = sources({
    '/repo/CLAUDE.md': '@"with spaces.md"\n@\'single.md\'\n~~~text\n@ignored.md\n```not-a-close\n~~~\n    @indented.md\n',
    '/repo/with spaces.md': 'spaces', '/repo/single.md': 'single',
    '/repo/.claude/rules/scalar.md': '---\npaths: "src/*.ts, docs/**, "\n---\nscoped',
    '/repo/.claude/rules/front.md': '---\nname: unconditional\n---\nalways',
  })
  expect(collectProjectDocs(files, '/repo', '/repo', '/repo/src/a.ts').map(doc => doc.text)).toContain('scoped')
  expect(collectProjectDocs(files, '/repo', '/repo').map(doc => doc.text)).toContain('always')
  expect(() => collectProjectDocs([], '/repo', '/outside')).toThrow('outside')
  expect(() => collectProjectDocs([{ path: '/repo/CLAUDE.md', realPath: '/outside', text: '' }], '/repo', '/repo')).toThrow('outside')
})

it('reports deep/missing imports and filesystem errors, and ignores touched paths outside the root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liwa-doc-errors-')); roots.push(root)
  await mkdir(join(root, '.git'))
  expect((await readProjectDocs(root, join(root, '..', 'outside.ts'))).documents).toEqual([])
  await writeFile(join(root, 'CLAUDE.md'), '@missing.md')
  await expect(readProjectDocs(root)).rejects.toThrow()
  for (let index = 0; index < 6; index++) await writeFile(join(root, `${index === 0 ? 'CLAUDE' : index}.md`), `@${index + 1}.md`)
  await expect(readProjectDocs(root)).rejects.toThrow('depth')
  await writeFile(join(root, 'CLAUDE.md'), '@../outside.md')
  await expect(readProjectDocs(root)).rejects.toThrow('outside')
  await writeFile(join(root, 'CLAUDE.md'), '@CLAUDE.md')
  await expect(readProjectDocs(root)).rejects.toThrow('cycle')
  await rm(join(root, 'CLAUDE.md'))
  await writeFile(join(root, '.claude'), 'not a directory')
  await expect(readProjectDocs(root)).rejects.toThrow()
  await expect(readProjectDocs(root, join(root, '.claude', 'a.ts'))).rejects.toThrow()
})

it('does not expand imports inside a multiline inline code span', () => {
  const files = sources({ '/repo/CLAUDE.md': 'text ``code\n@missing.md\ncode`` tail\n@guide.md', '/repo/guide.md': 'guide' })
  expect(collectProjectDocs(files, '/repo', '/repo').map(doc => doc.path)).toEqual(['CLAUDE.md', 'guide.md'])
})

it('handles empty frontmatter and rejects a rules directory that points outside the project', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'liwa-rules-boundary-')); roots.push(parent)
  const root = join(parent, 'repo')
  await mkdir(join(root, '.git'), { recursive: true })
  await mkdir(join(root, '.claude'))
  await mkdir(join(parent, 'rules'))
  await writeFile(join(root, 'CLAUDE.md'), '---\n# empty metadata\n---\nroot')
  await symlink(join(parent, 'rules'), join(root, '.claude', 'rules'))
  await expect(readProjectDocs(root)).rejects.toMatchObject({ code: 'brain.project_docs_outside' })
  await rm(join(root, '.claude', 'rules'))
  await mkdir(join(root, '.claude', 'rules'))
  await writeFile(join(root, '.claude', 'rules', 'ignored.txt'), '@missing.md')
  expect((await readProjectDocs(root)).documents.map(document => document.text)).toEqual(['root'])
})
