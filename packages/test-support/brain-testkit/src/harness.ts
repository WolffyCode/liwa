/**
 * 直接测试提供方用的宿主：一个挂好 `@liwa/subprocess-local` 的 cordis 上下文、一个临时目录、
 * 记下所有拉起的启动上下文，以及事件记录器。不依赖 vitest，契约测试与各提供方自己的测试都能用。
 * @module @liwa/brain-testkit/harness
 */

import { mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@liwa/cordis'
import LocalSubprocessRuntime from '@liwa/subprocess-local'
import type { SubprocessHandle } from '@liwa/subprocess'
import {
  BrainBlobStore, BrainSessionId, SessionConfigSchema,
  type BrainEvent, type BrainLaunchContext, type BrainProbeContext, type SessionConfig, type SessionConfigInput,
} from '@liwa/brain'

/** 记下拉起句柄的启动上下文。 */
export interface RecordingLaunchContext extends BrainLaunchContext {
  /** 经它拉起的全部进程句柄。 */
  readonly processes: readonly SubprocessHandle[]
}

/** 直接测试提供方的宿主。 */
export interface BrainTestHost {
  /** 挂好 subprocess 的上下文。 */
  readonly ctx: Context
  /** 本宿主的临时目录（释放时删除）。 */
  readonly root: string
  /** 回合输入 blob 的存储（测试放图片用；启动上下文从它读）。 */
  readonly blobs: BrainBlobStore
  /**
   * 一个新会话的启动上下文，带一个独占的 home 目录。
   * @param homeDir - 沿用的 home（续接时传原会话的 home）；省略时新建一个。
   * @returns 记下拉起句柄的启动上下文。
   */
  launch(homeDir?: string): RecordingLaunchContext
  /**
   * 探测用的上下文。
   * @param signal - 取消探测。
   * @returns 探测上下文。
   */
  probeContext(signal?: AbortSignal): BrainProbeContext
  /**
   * 一份能直接用的会话配置（干活的活、临时目录里的 cwd 与配置目录）。
   * @param overrides - 覆盖的字段。
   * @returns 校验过的会话配置。
   */
  sessionConfig(overrides?: Partial<SessionConfigInput>): SessionConfig
  /** 关掉上下文（终止残留进程）并删临时目录。 */
  dispose(): Promise<void>
}

/**
 * 一份能直接用的会话配置（未校验的输入形状）。
 * @param root - 放 cwd、数据目录与配置目录的目录。
 * @param overrides - 覆盖的字段。
 * @returns 会话配置输入。
 */
export function sampleSessionConfig(root: string, overrides: Partial<SessionConfigInput> = {}): SessionConfigInput {
  return {
    member: 'tester',
    mindKind: 'work',
    owner: { taskId: 'contract-task', gen: 1 },
    persona: { stable: '', notes: '', version: 'test' },
    cwd: root,
    dataDir: join(root, 'data'),
    nativeToolPolicy: 'worktree',
    limits: { maxInferencesPerTurn: 8, maxToolCallsPerTurn: 16, watchdogMs: 60_000 },
    concludeOn: ['report'],
    permission: { mode: 'provider', autoAllow: [] },
    compaction: 'provider',
    configDir: join(root, 'brains'),
    rules: '',
    skillsDir: '',
    projectDocs: false,
    childPolicy: { native: true, maxDepth: 1, maxConcurrent: 2, crossCli: [] },
    ...overrides,
  }
}

/**
 * 建一个测试宿主。
 * @returns 挂好 subprocess 的宿主；用完调 `dispose`。
 */
export async function createBrainTestHost(): Promise<BrainTestHost> {
  const root = await mkdtemp(join(tmpdir(), 'liwa-brain-test-'))
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  const subprocess = ctx.subprocess
  const logger = ctx.logger('brain-test')
  const blobs = new BrainBlobStore(join(root, 'blobs'))
  return {
    ctx,
    root,
    blobs,
    launch(reuseHome) {
      const processes: SubprocessHandle[] = []
      const sessionId = BrainSessionId(`brain-session-${randomUUID()}`)
      // 每个会话一个 home，与 ctx.brains 给 per-session 提供方的布局相同；续接时沿用原会话的 home。
      const homeDir = reuseHome ?? join(root, 'homes', sessionId)
      mkdirSync(homeDir, { recursive: true })
      return {
        sessionId,
        homeDir,
        logger,
        processes,
        readBlob: ref => blobs.readBlob(ref),
        resolveExecutable: (command, env, signal) => subprocess.resolveExecutable(command, env, signal),
        spawn(spec) {
          const handle = subprocess.spawn(spec)
          processes.push(handle)
          return handle
        },
      }
    },
    probeContext(signal) {
      return {
        logger,
        signal,
        resolveExecutable: (command, env, probeSignal) => subprocess.resolveExecutable(command, env, probeSignal),
        spawn: spec => subprocess.spawn(spec),
      }
    },
    sessionConfig(overrides) {
      return SessionConfigSchema.parse(sampleSessionConfig(root, overrides))
    },
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** 一个会话的事件记录。 */
export interface EventRecorder {
  /** 到目前为止收到的全部事件。 */
  readonly events: readonly BrainEvent[]
  /**
   * 等到某个事件出现（含已经收到的）。
   * @param predicate - 判定条件。
   * @param timeoutMs - 时限，默认 10 秒。
   * @returns 第一个满足条件的事件。
   */
  waitFor<E extends BrainEvent>(predicate: (event: BrainEvent) => event is E, timeoutMs?: number): Promise<E>
  /**
   * 等到某种事件出现（含已经收到的）。
   * @param kind - 事件种类。
   * @param where - 额外条件。
   * @param timeoutMs - 时限，默认 10 秒。
   * @returns 第一个满足条件的该种事件。
   */
  waitForKind<K extends BrainEvent['kind']>(kind: K, where?: (event: Extract<BrainEvent, { kind: K }>) => boolean, timeoutMs?: number): Promise<Extract<BrainEvent, { kind: K }>>
  /** 停止记录。 */
  stop(): void
}

/**
 * 订阅一个会话（提供方会话或 brains 的句柄都行）并记录事件。
 * @param session - 有 `subscribe` 的会话。
 * @param session.subscribe - 订阅函数。
 * @returns 事件记录器。
 */
export function recordEvents(session: { subscribe(listener: (event: BrainEvent) => void): () => void }): EventRecorder {
  const events: BrainEvent[] = []
  const waiters = new Set<{ test: (event: BrainEvent) => boolean; resolve: (event: BrainEvent) => void }>()
  const unsubscribe = session.subscribe((event) => {
    events.push(event)
    for (const waiter of [...waiters]) {
      if (waiter.test(event)) {
        waiters.delete(waiter)
        waiter.resolve(event)
      }
    }
  })
  const waitFor = <E extends BrainEvent>(predicate: (event: BrainEvent) => event is E, timeoutMs = 10_000): Promise<E> => {
    const seen = events.find(predicate)
    if (seen !== undefined) return Promise.resolve(seen)
    return new Promise<E>((resolve, reject) => {
      const waiter = {
        test: predicate,
        resolve: (event: BrainEvent) => {
          clearTimeout(timer)
          resolve(event as E)
        },
      }
      const timer = setTimeout(() => {
        waiters.delete(waiter)
        reject(new Error(`no matching brain event within ${String(timeoutMs)}ms; received: ${events.map(event => event.kind).join(', ') || '(none)'}`))
      }, timeoutMs)
      waiters.add(waiter)
    })
  }
  return {
    events,
    waitFor,
    waitForKind(kind, where, timeoutMs) {
      type Matched = Extract<BrainEvent, { kind: typeof kind }>
      return waitFor((event): event is Matched => event.kind === kind && (where === undefined || where(event as Matched)), timeoutMs)
    },
    stop: unsubscribe,
  }
}

/**
 * 回合的终止事件。
 * @param event - 事件。
 * @returns 是否是 `turn.completed` / `turn.interrupted` / `turn.failed`。
 */
export function isTurnTerminal(event: BrainEvent): event is Extract<BrainEvent, { kind: 'turn.completed' | 'turn.interrupted' | 'turn.failed' }> {
  return event.kind === 'turn.completed' || event.kind === 'turn.interrupted' || event.kind === 'turn.failed'
}

/**
 * 文本输入。
 * @param text - 文本。
 * @returns 只含一块文本的回合输入。
 */
export function textInput(text: string): { blocks: [{ kind: 'text'; text: string }] } {
  return { blocks: [{ kind: 'text', text }] }
}

/**
 * 一张纯色的 PNG（测图片输入用：真的图片解码器能读，模型看得出颜色）。
 * @param width - 宽（像素）。
 * @param height - 高（像素）。
 * @param rgb - 颜色。
 * @returns PNG 字节。
 */
export function solidPng(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array {
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * PNG 块用的 CRC-32。
 * @param bytes - 块类型与数据。
 * @returns 校验值。
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
