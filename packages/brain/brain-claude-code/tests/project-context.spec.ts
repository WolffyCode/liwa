import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as filesystem from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import type { BrainEvent } from '@liwa/brain'
import { ClaudeProjectContext } from '../src/project-context.ts'
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, stat: vi.fn(original.stat) }
})
let host: BrainTestHost | undefined
afterEach(async () => { vi.restoreAllMocks(); await host?.dispose() })
it('injects nested and path-scoped instructions once, logging the exact model context', async () => {
  host = await createBrainTestHost()
  await mkdir(join(host.root, '.git'))
  await mkdir(join(host.root, '.claude', 'rules'), { recursive: true })
  await mkdir(join(host.root, 'src'))
  await writeFile(join(host.root, 'src', 'CLAUDE.md'), 'nested sentinel')
  await writeFile(join(host.root, '.claude', 'rules', 'ts.md'), '---\npaths: ["src/**/*.ts"]\n---\ntypescript sentinel')
  const context = await ClaudeProjectContext.create(host.root, 1000)
  const events: BrainEvent[] = []
  context.publish = (event) => { events.push(event) }
  const input = { session_id: 's', transcript_path: '', cwd: host.root, hook_event_name: 'PreToolUse' as const, tool_use_id: 't', tool_name: 'Read', tool_input: { file_path: join(host.root, 'src', 'a.ts') } }
  const result = await context.hook(input)
  const serialized = JSON.stringify(result)
  expect(serialized).toContain('nested sentinel')
  expect(serialized).toContain('typescript sentinel')
  expect(events[0]).toMatchObject({ reason: { path: 'src/a.ts' } })
  expect(events.filter(event => event.kind === 'session.project_document').map(event => event.text).join('\n\n')).toBe(result.hookSpecificOutput?.additionalContext)
  expect(await context.hook(input)).toEqual({})
  expect(await context.hook({ ...input, tool_input: {} })).toEqual({})
  await writeFile(join(host.root, 'src', 'CLAUDE.md'), 'x'.repeat(1200))
  const limited = await ClaudeProjectContext.create(host.root, 100)
  limited.publish = (event) => { events.push(event) }
  expect(JSON.stringify(await limited.hook(input))).not.toContain('xxx')
  expect(events.some(event => event.kind === 'session.project_document_failed')).toBe(true)
})

it('reports path and document failures through visible events and requires an observer before injection', async () => {
  host = await createBrainTestHost()
  await mkdir(join(host.root, '.git'))
  await writeFile(join(host.root, 'blocking-file'), 'file')
  const context = await ClaudeProjectContext.create(host.root, 1000)
  const input = { session_id: 's', transcript_path: '', cwd: host.root, hook_event_name: 'PreToolUse' as const, tool_use_id: 't', tool_name: 'Read', tool_input: { path: join(host.root, 'blocking-file', 'child') } }
  await expect(context.hook(input)).rejects.toThrow('observer')
  const events: BrainEvent[] = []
  context.publish = (event) => { events.push(event) }
  expect(await context.hook(input)).toEqual({})
  expect(events.at(-1)).toMatchObject({ kind: 'session.project_document_failed' })
})

it('recognizes alternate tool paths and directories, and ignores hooks without a file target', async () => {
  host = await createBrainTestHost()
  await mkdir(join(host.root, '.git'))
  await mkdir(join(host.root, 'nested'))
  await writeFile(join(host.root, 'nested', 'CLAUDE.md'), 'directory instructions')
  const context = await ClaudeProjectContext.create(host.root, 1000)
  const events: BrainEvent[] = []
  context.publish = (event) => { events.push(event) }
  const input = { session_id: 's', transcript_path: '', cwd: host.root, hook_event_name: 'PreToolUse' as const, tool_use_id: 't', tool_name: 'Read', tool_input: {} }
  expect(await context.hook({ ...input, hook_event_name: 'PostToolUse', tool_response: {} })).toEqual({})
  for (const tool_input of [null, 'no target', {}, { path: 42 }]) expect(await context.hook({ ...input, tool_input })).toEqual({})
  expect(await context.hook({ ...input, tool_input: { cwd: '.' } })).toEqual({})
  const notebook = await context.hook({ ...input, tool_input: { notebook_path: 'nested' } })
  expect(notebook.hookSpecificOutput?.additionalContext).toContain('directory instructions')
  expect(events).toMatchObject([{ reason: { path: 'nested' } }])
  vi.spyOn(filesystem, 'stat').mockRejectedValueOnce('filesystem unavailable')
  expect(await context.hook({ ...input, tool_input: { path: 'nested/next.ts' } })).toEqual({})
  expect(events.at(-1)).toMatchObject({ kind: 'session.project_document_failed', message: 'filesystem unavailable' })
})
