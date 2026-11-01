/**
 * The identity, timestamp, link, mutation, and durability-sink guarantees
 * MemoryVfs owes its consumers, asserted directly rather than through the
 * `node:fs` bridge.
 *
 * `liwa-fs-local` builds a version token from `dev:ino:size:mtimeNs:ctimeNs` and
 * refuses a write whose token moved since it read. Two properties carry that:
 * `ino` identifies the entry at a path, and `mtimeMs` moves on every write. The
 * timestamp cases freeze the clock, because these writes are in memory and two
 * revisions routinely land in the same millisecond — a real-clock test passes
 * whether or not the strict increment exists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryVfs } from '../../src/storage/memory.ts'
import type { VfsBigIntStats, VfsMutation, VfsMutationSink, VfsStats } from '../../src/storage/types.ts'

const identity = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).ino

const linkCount = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).nlink

const modified = (vfs: MemoryVfs, path: string): number => (vfs.statSync(path) as VfsStats).mtimeMs

afterEach(() => { vi.restoreAllMocks() })

describe('entry identity', () => {
  it('distinguishes paths and holds each identity across repeated stats', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/one.txt', 'one')
    vfs.seed('/liwa/two.txt', 'two')
    const first = identity(vfs, '/liwa/one.txt')
    expect(identity(vfs, '/liwa/two.txt')).not.toBe(first)
    expect(identity(vfs, '/liwa/one.txt')).toBe(first)
  })

  it('forgets the identities under a directory removed as a subtree', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/skills/git/SKILL.md', '# git\n')
    const before = identity(vfs, '/liwa/skills/git/SKILL.md')
    vfs.rmSync('/liwa/skills', { recursive: true })
    vfs.seed('/liwa/skills/git/SKILL.md', '# git rebuilt\n')
    expect(identity(vfs, '/liwa/skills/git/SKILL.md')).not.toBe(before)
  })

  it('moves the source identity when a file replaces another path', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/from.txt', 'moved')
    vfs.seed('/liwa/to.txt', 'replaced')
    const [source, destination] = [identity(vfs, '/liwa/from.txt'), identity(vfs, '/liwa/to.txt')]
    vfs.renameSync('/liwa/from.txt', '/liwa/to.txt')
    const renamed = identity(vfs, '/liwa/to.txt')
    expect(vfs.readFileSync('/liwa/to.txt', 'utf8')).toBe('moved')
    expect([renamed === source, renamed === destination]).toEqual([true, false])
  })
})

describe('modification time', () => {
  it('hydrates explicit metadata without confusing timestamps with permission bits', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/restored', 'value', { mode: 0o600, mtimeMs: 1_600_000_000_000 })
    vfs.seedDirectory('/liwa/restored-directory', { mode: 0o700, mtimeMs: 1_600_000_000_001 })
    const stats = vfs.statSync('/liwa/restored') as VfsStats
    const directory = vfs.statSync('/liwa/restored-directory') as VfsStats
    expect([stats.mode & 0o777, stats.mtimeMs]).toEqual([0o600, 1_600_000_000_000])
    expect([directory.mode & 0o777, directory.mtimeMs]).toEqual([0o700, 1_600_000_000_001])
  })

  it('advances on every write even while the clock stands still', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/log.jsonl', 'first\n')
    const seeded = modified(vfs, '/liwa/log.jsonl')
    vfs.writeFileSync('/liwa/log.jsonl', 'second\n')
    const written = modified(vfs, '/liwa/log.jsonl')
    vfs.appendFileSync('/liwa/log.jsonl', 'third\n')
    const appended = modified(vfs, '/liwa/log.jsonl')
    vfs.truncateSync('/liwa/log.jsonl', 6)
    const truncated = modified(vfs, '/liwa/log.jsonl')
    expect([written > seeded, appended > written, truncated > appended]).toEqual([true, true, true])
    // One millisecond per revision: the increment is the minimum that separates
    // two tokens, not a coarser bump that would skew a real timestamp.
    expect(truncated - seeded).toBe(3)
  })

  it('takes the clock once the clock has passed the entry', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/log.jsonl', 'first\n')
    clock.mockReturnValue(1_700_000_005_000)
    vfs.writeFileSync('/liwa/log.jsonl', 'second\n')
    expect(modified(vfs, '/liwa/log.jsonl')).toBe(1_700_000_005_000)
  })

  it('extends truncation with zero bytes', async () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/file', new Uint8Array([1, 2]))
    vfs.truncateSync('/liwa/file', 5)
    expect([...vfs.readFileSync('/liwa/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0])
    const handle = vfs.open('/liwa/file', 'r+')
    await handle.truncate(7)
    expect([...vfs.readFileSync('/liwa/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0, 0, 0])
  })

  it('advances a directory only when its immediate entry set changes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/liwa/workspace')
    const empty = modified(vfs, '/liwa/workspace')
    vfs.writeFileSync('/liwa/workspace/file.txt', 'one')
    const created = modified(vfs, '/liwa/workspace')
    vfs.writeFileSync('/liwa/workspace/file.txt', 'two')
    const rewritten = modified(vfs, '/liwa/workspace')
    vfs.rmSync('/liwa/workspace/file.txt')
    const removed = modified(vfs, '/liwa/workspace')
    expect([created > empty, rewritten === created, removed > rewritten]).toEqual([true, true, true])
  })
})

describe('mutation publication', () => {
  it('publishes only committed runtime changes and keeps image seeding silent', () => {
    const vfs = new MemoryVfs()
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.seed('/liwa/seeded.txt', 'seeded')
    expect(mutations).toEqual([])
    vfs.writeFileSync('/liwa/seeded.txt', 'changed')
    vfs.mkdirSync('/liwa/created')
    vfs.chmodSync('/liwa/created', 0o700)
    vfs.renameSync('/liwa/seeded.txt', '/liwa/renamed.txt')
    vfs.rmSync('/liwa/created', { recursive: true })
    expect(mutations.map(mutation => ({
      kind: mutation.kind,
      path: mutation.path,
      ...mutation.kind === 'write' ? { entryChanged: mutation.entryChanged } : {},
      ...mutation.kind === 'chmod' ? { mode: mutation.mode } : {},
    }))).toEqual([
      { kind: 'write', path: '/liwa/seeded.txt', entryChanged: false },
      { kind: 'mkdir', path: '/liwa/created' },
      { kind: 'chmod', path: '/liwa/created', mode: 0o700 },
      { kind: 'remove', path: '/liwa/seeded.txt' },
      { kind: 'write', path: '/liwa/renamed.txt', entryChanged: true },
      { kind: 'remove', path: '/liwa/created' },
    ])
    const renamed = mutations[4]
    expect(renamed?.kind === 'write' && new TextDecoder().decode(renamed.bytes)).toBe('changed')
    expect(() => { vfs.writeFileSync('/missing/file', 'no') }).toThrow(/ENOENT/)
    expect(mutations).toHaveLength(6)
  })

  it('contains a faulty observer and lets disposal stop later notifications', () => {
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/liwa')
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = vfs.subscribe(() => { throw new Error('observer failed') })
    const seen: string[] = []
    const second = vfs.subscribe((mutation) => { seen.push(mutation.path) })
    vfs.writeFileSync('/liwa/one', '1')
    first()
    second()
    vfs.writeFileSync('/liwa/two', '2')
    expect(seen).toEqual(['/liwa/one'])
    expect(reported).toHaveBeenCalledOnce()
  })

  it('feeds the same complete mutations to a durable sink and live subscribers', async () => {
    const recorded: VfsMutation[] = []
    let flushes = 0
    const sink: VfsMutationSink = {
      record: (mutation) => { recorded.push(mutation) },
      flush: async () => { flushes += 1 },
    }
    const vfs = new MemoryVfs({ sink })
    vfs.seedDirectory('/liwa')
    const observed: VfsMutation[] = []
    vfs.subscribe((mutation) => { observed.push(mutation) })
    vfs.writeFileSync('/liwa/log', 'a')
    vfs.appendFileSync('/liwa/log', 'bc')
    await vfs.flush()
    expect(observed).toEqual(recorded)
    expect(observed[0]).toBe(recorded[0])
    expect(recorded[0]).toMatchObject({ kind: 'write', path: '/liwa/log', mode: 0o644, entryChanged: true })
    expect(recorded[1]).toMatchObject({ kind: 'write', path: '/liwa/log', mode: 0o644, entryChanged: false, appendedFrom: 1 })
    expect(recorded[1]?.kind === 'write' && new TextDecoder().decode(recorded[1].bytes)).toBe('abc')
    expect(flushes).toBe(1)
  })

  it('publishes descriptor writes at the file identity current path', () => {
    const mutations: VfsMutation[] = []
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/source', 'old')
    const descriptor = vfs.openFileSync('/liwa/source', 'r+')
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.renameSync('/liwa/source', '/liwa/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('new'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/liwa/destination'])
    expect(vfs.readFileSync('/liwa/destination', 'utf8')).toBe('new')
    vfs.unlinkSync('/liwa/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('detached'))
    expect(mutations).toEqual([])
    expect(new TextDecoder().decode(descriptor.read(0, descriptor.stat().size))).toBe('detached')
  })

  it('reports the path identity through a BigInt file handle stat', async () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/session.lock', '')
    const handle = vfs.open('/liwa/session.lock', 'w')
    const held = await handle.stat({ bigint: true }) as VfsBigIntStats
    const current = vfs.statSync('/liwa/session.lock', { bigint: true }) as VfsBigIntStats

    expect([held.dev, held.ino]).toEqual([current.dev, current.ino])
    await handle.chmod(0o600)
    expect((vfs.statSync('/liwa/session.lock') as VfsStats).mode & 0o777).toBe(0o600)
    await handle.close()
  })

  it('decomposes a directory rename into replayable destination state', () => {
    const recorded: VfsMutation[] = []
    const vfs = new MemoryVfs({
      sink: { record: (mutation) => { recorded.push(mutation) }, flush: () => Promise.resolve() },
    })
    vfs.seedDirectory('/liwa/staging/nested', { mode: 0o700 })
    vfs.seed('/liwa/staging/nested/file', 'value', { mode: 0o600 })
    vfs.renameSync('/liwa/staging', '/liwa/published')

    expect(recorded.map(mutation => [mutation.kind, mutation.path])).toEqual([
      ['remove', '/liwa/staging'],
      ['mkdir', '/liwa/published'],
      ['mkdir', '/liwa/published/nested'],
      ['write', '/liwa/published/nested/file'],
    ])
    expect(recorded[3]).toMatchObject({ kind: 'write', mode: 0o600, entryChanged: true })
    expect(recorded[3]?.kind === 'write' && new TextDecoder().decode(recorded[3].bytes)).toBe('value')
  })
})

describe('directory rename', () => {
  it('rejects file, non-empty directory, and missing-parent destinations before mutation', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/source/nested/file', 'source')
    vfs.seed('/liwa/file', 'destination')
    vfs.seed('/liwa/non-empty/child', 'destination')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    expect(() => { vfs.renameSync('/liwa/source', '/liwa/file') })
      .toThrow(expect.objectContaining({ code: 'ENOTDIR' }))
    expect(() => { vfs.renameSync('/liwa/source', '/liwa/non-empty') })
      .toThrow(expect.objectContaining({ code: 'ENOTEMPTY' }))
    expect(() => { vfs.renameSync('/liwa/source', '/missing/destination') })
      .toThrow(expect.objectContaining({ code: 'ENOENT' }))

    expect(vfs.readFileSync('/liwa/source/nested/file', 'utf8')).toBe('source')
    expect(vfs.readFileSync('/liwa/file', 'utf8')).toBe('destination')
    expect(vfs.readFileSync('/liwa/non-empty/child', 'utf8')).toBe('destination')
    expect(mutations).toEqual([])
  })

  it('replaces an empty directory with the source subtree', () => {
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/liwa/source/nested', { mode: 0o700 })
    vfs.seed('/liwa/source/nested/file', 'source')
    vfs.seedDirectory('/liwa/destination', { mode: 0o711 })

    vfs.renameSync('/liwa/source', '/liwa/destination')

    expect(vfs.existsSync('/liwa/source')).toBe(false)
    expect(vfs.readFileSync('/liwa/destination/nested/file', 'utf8')).toBe('source')
    expect((vfs.statSync('/liwa/destination') as VfsStats).mode & 0o777).toBe(0o755)
    expect((vfs.statSync('/liwa/destination/nested') as VfsStats).mode & 0o777).toBe(0o700)
  })
})

describe('hard links', () => {
  it('shares identity, bytes, and mode until one name is removed', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/session.jsonl', 'committed\n')
    vfs.linkSync('/liwa/session.jsonl', '/liwa/session-latest.jsonl')
    vfs.linkSync('/liwa/session-latest.jsonl', '/liwa/session-archive.jsonl')
    expect(identity(vfs, '/liwa/session-latest.jsonl')).toBe(identity(vfs, '/liwa/session.jsonl'))
    expect(linkCount(vfs, '/liwa/session.jsonl')).toBe(3n)
    expect(vfs.readFileSync('/liwa/session-latest.jsonl', 'utf8')).toBe('committed\n')
    const changedPaths: string[] = []
    vfs.subscribe((mutation) => { changedPaths.push(mutation.path) })
    vfs.appendFileSync('/liwa/session.jsonl', 'appended\n')
    expect(changedPaths).toEqual([
      '/liwa/session.jsonl',
      '/liwa/session-latest.jsonl',
      '/liwa/session-archive.jsonl',
    ])
    expect(vfs.readFileSync('/liwa/session.jsonl', 'utf8')).toBe('committed\nappended\n')
    expect(vfs.readFileSync('/liwa/session-latest.jsonl', 'utf8')).toBe('committed\nappended\n')
    vfs.chmodSync('/liwa/session-latest.jsonl', 0o600)
    expect((vfs.statSync('/liwa/session.jsonl') as VfsStats).mode & 0o777).toBe(0o600)
    vfs.unlinkSync('/liwa/session-latest.jsonl')
    expect(linkCount(vfs, '/liwa/session.jsonl')).toBe(2n)
    vfs.unlinkSync('/liwa/session-archive.jsonl')
    expect(linkCount(vfs, '/liwa/session.jsonl')).toBe(1n)
    expect(vfs.readFileSync('/liwa/session.jsonl', 'utf8')).toBe('committed\nappended\n')
  })

  it('treats rename between names of the same node as a no-op', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/source', 'value')
    vfs.linkSync('/liwa/source', '/liwa/alias')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    vfs.renameSync('/liwa/source', '/liwa/alias')

    expect(vfs.readFileSync('/liwa/source', 'utf8')).toBe('value')
    expect(vfs.readFileSync('/liwa/alias', 'utf8')).toBe('value')
    expect(linkCount(vfs, '/liwa/source')).toBe(2n)
    expect(mutations).toEqual([])
  })

  it('retargets linked names through file replacement and directory moves', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/replacement', 'replacement')
    vfs.seed('/liwa/target', 'old')
    vfs.linkSync('/liwa/target', '/liwa/target-alias')
    const replaced = vfs.openFileSync('/liwa/target', 'r+')
    vfs.renameSync('/liwa/replacement', '/liwa/target')
    const mutations: VfsMutation[] = []
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    replaced.write(0, new TextEncoder().encode('changed'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/liwa/target-alias'])
    expect(vfs.readFileSync('/liwa/target', 'utf8')).toBe('replacement')
    expect(vfs.readFileSync('/liwa/target-alias', 'utf8')).toBe('changed')
    expect(linkCount(vfs, '/liwa/target-alias')).toBe(1n)

    vfs.seed('/liwa/tree/file', 'tree')
    vfs.linkSync('/liwa/tree/file', '/liwa/outside')
    const moved = vfs.openFileSync('/liwa/tree/file', 'r+')
    vfs.renameSync('/liwa/tree', '/liwa/moved')
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('moved'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/liwa/outside', '/liwa/moved/file'])
    expect(linkCount(vfs, '/liwa/moved/file')).toBe(2n)

    vfs.rmSync('/liwa/moved', { recursive: true })
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('kept!'))
    expect(mutations.map(mutation => mutation.path)).toEqual(['/liwa/outside'])
    expect(vfs.readFileSync('/liwa/outside', 'utf8')).toBe('kept!')
    expect(linkCount(vfs, '/liwa/outside')).toBe(1n)
  })

  it('rejects renaming a file over an existing directory', () => {
    const vfs = new MemoryVfs()
    vfs.seed('/liwa/file', 'value')
    vfs.seedDirectory('/liwa/directory')
    expect(() => { vfs.renameSync('/liwa/file', '/liwa/directory') }).toThrow(expect.objectContaining({ code: 'EISDIR' }))
    expect(vfs.readFileSync('/liwa/file', 'utf8')).toBe('value')
    expect(vfs.statSync('/liwa/directory').isDirectory()).toBe(true)
  })
})
