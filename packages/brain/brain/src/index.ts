/**
 * `brain.provider` 能力 seam 的服务定义与 `ctx.brains` 服务。提供方插件经 `register` 登记一个 agent CLI
 * 客户端；调用方经 `createSession` / `resumeSession` 拿到包装过的会话句柄。brains 只报事实与用量：
 * 提供方、进程、会话、子 agent、用量五张表在这一阶段是内存登记，同时以 `brain.*.v1` cordis 事件发出，
 * 以后由经历流订阅落库。
 * @module @liwa/brain
 */

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Context, Service } from '@liwa/cordis'
import z from '@liwa/schemastery'
import type { SubprocessRuntime } from '@liwa/subprocess'
import { BrainBlobStore } from './blobs.ts'
import { BrainSessionId, type ImplId, type MemberId } from './brand.ts'
import { homeDirFor, prepareMemberConfigDir, type MemberConfigSpec } from './config-dir/index.ts'
import {
  ImplIdSchema, MetaSchema, ResumeHandleSchema, SessionConfigSchema,
  type Meta, type ResumeHandle, type SessionConfig, type SessionConfigInput,
} from './contract.ts'
import { BrainError } from './errors.ts'
import type { BrainProbeResult, BrainProvider, BrainProviderSession } from './provider.ts'
import { ManagedBrainSession, within, type BrainSession, type BrainSessionHost } from './session.ts'
import type {
  BrainChildView, BrainProcessView, BrainProviderUnavailableRecord, BrainProviderView, BrainSessionClosedRecord,
  BrainSessionView, BrainUsageRecord,
} from './views.ts'

export { BrainBlobStore, type BrainBlobReader } from './blobs.ts'
export * from './brand.ts'
export * from './contract.ts'
export * from './errors.ts'
export type * from './provider.ts'
export type * from './views.ts'
export { accumulateUsage, type BrainSession, type BrainTimeouts } from './session.ts'
export {
  KERNEL_MCP_SERVER_NAME, RULES_PRECEDENCE, homeDirFor, memberBrainsDir, memberMcpServers, replaceSkills, rulesDocument,
  type MemberConfigSpec, type MemberConfigWriter,
} from './config-dir/index.ts'
export {
  ProviderCommandError, execProviderCommand, findProviderExecutable, mergeLaunchEnv, spawnProviderProcess,
  type ProviderCommandOptions, type ProviderCommandResult, type ProviderProcessHost,
} from './process.ts'

declare module '@liwa/cordis' {
  interface Context {
    brains: BrainRegistry
  }

  interface Events {
    /**
     * 一代会话开了（`brain_session` 新行）。
     * @param view - 会话登记。
     * @mode emit
     */
    'brain.session.opened.v1'(view: BrainSessionView): void
    /**
     * 一代会话关了（`brain_session` 收尾），带用量汇总。
     * @param record - 关闭时的会话登记与用量汇总。
     * @mode emit
     */
    'brain.session.closed.v1'(record: BrainSessionClosedRecord): void
    /**
     * 会话经启动上下文拉起了一个进程（`brain_process` 新行）。
     * @param view - 进程登记。
     * @mode emit
     */
    'brain.process.spawned.v1'(view: BrainProcessView): void
    /**
     * 一个登记过的进程退出了。
     * @param view - 带退出码与信号的进程登记。
     * @mode emit
     */
    'brain.process.exited.v1'(view: BrainProcessView): void
    /**
     * 提供方报了一个子 agent（`brain_child` 新行）。
     * @param view - 子 agent 登记。
     * @mode emit
     */
    'brain.child.opened.v1'(view: BrainChildView): void
    /**
     * 子 agent 结束了；会话先关时由 brains 补记 `aborted`。
     * @param view - 带结束原因与用量的子 agent 登记。
     * @mode emit
     */
    'brain.child.ended.v1'(view: BrainChildView): void
    /**
     * 一条用量（`brain_usage` 新行）：回合结束、提供方级更新、子 agent 结束。
     * @param record - 用量记录。
     * @mode emit
     */
    'brain.usage.v1'(record: BrainUsageRecord): void
    /**
     * 一次探测发现提供方不可用。
     * @param record - 提供方与探测结果。
     * @mode emit
     */
    'brain.provider.unavailable.v1'(record: BrainProviderUnavailableRecord): void
  }
}

/** `ctx.brains` 的配置。 */
export interface Config {
  /** 成员数据目录的根；`prepareConfigDir` 写 `<membersRoot>/<member>/brains/`。 */
  membersRoot: string
  /** 回合输入 blob（图片等）的本地存储目录；省略时为 `<membersRoot>/.blobs`（成员名不以点开头，不会撞上）。 */
  blobsDir?: string
  /** 开会话、续接、开回合的时限（毫秒）。 */
  handshakeTimeoutMs?: number
  /** 送达、取消、答复权限、回收否决的时限（毫秒）。 */
  callTimeoutMs?: number
  /** 关会话与等其进程退出的时限（毫秒）。 */
  closeTimeoutMs?: number
  /** 一次可用性探测的时限（毫秒）。 */
  probeTimeoutMs?: number
}

/** 一个登记中的提供方。 */
interface ProviderRecord {
  provider: BrainProvider
  impl: ImplId
  plugin: string
  meta: Meta
  available: boolean | undefined
  lastProbeAt?: string
  probeResult?: BrainProbeResult
}

/** 开会话的请求。 */
export interface CreateSessionRequest {
  /** 提供方。 */
  impl: ImplId
  /** 会话配置（会被校验）。 */
  cfg: SessionConfigInput
}

/** 续接会话的请求。 */
export interface ResumeSessionRequest extends CreateSessionRequest {
  /** 之前某个会话的续接句柄（会被校验）。 */
  resume: ResumeHandle
}

/** 跨 CLI 子活的请求（01 §4.5 路②）。 */
export interface OpenChildTaskRequest extends CreateSessionRequest {
  /** 父活号。 */
  parentTask: string
}

/**
 * 把 zod 的失败换成 `invalid_input`。
 * @param what - 出错的对象。
 * @param issues - zod 的问题列表。
 * @returns 可操作的 `BrainError`。
 */
function invalid(what: string, issues: readonly { path: readonly PropertyKey[]; message: string }[]): BrainError {
  const detail = issues.map(issue => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('; ')
  return new BrainError('invalid_input', 'brain.invalid_input', `${what} is invalid: ${detail}`)
}

/**
 * 续接句柄里的 home：只认这一代成员配置目录下这家提供方的子目录，挡住指到别处的句柄。
 * @param configDir - 这一代的成员配置目录。
 * @param impl - 提供方。
 * @param home - 续接句柄里的 home。
 * @returns 规范化的 home。
 * @throws {BrainError} `invalid_input`（home 不在 `<configDir>/<impl>/` 下）。
 */
function resumedHome(configDir: string, impl: ImplId, home: string): string {
  const base = resolve(configDir, impl)
  const target = resolve(home)
  if (relative(base, target).startsWith('..') || isAbsolute(relative(base, target)) || target === base) {
    throw new BrainError('invalid_input', 'brain.resume_home_outside', `resume handle home ${home} is not a session home under ${base}`)
  }
  return target
}

/**
 * blob 存储目录：配置给了就用它，否则放在成员数据目录的根下。
 * @param config - 服务配置。
 * @returns 目录。
 */
export function resolveBlobsDir(config: Pick<Config, 'membersRoot' | 'blobsDir'>): string {
  return config.blobsDir ?? join(config.membersRoot, '.blobs')
}

/**
 * `ctx.brains`：提供方登记、可用性探测、成员配置目录、会话的开启与续接、会话 / 子 agent / 进程 / 用量的登记。
 * 提供方的登记与调用方的会话都是调用方上下文里的 effect：提供方插件卸载时它的会话一起关，调用方卸载时它开的会话一起关。
 */
export class BrainRegistry extends Service {
  static inject = ['subprocess']

  static Config: z<Config> = z.object({
    membersRoot: z.string().required(),
    blobsDir: z.string(),
    handshakeTimeoutMs: z.natural().min(1).default(30_000),
    callTimeoutMs: z.natural().min(1).default(10_000),
    closeTimeoutMs: z.natural().min(1).default(30_000),
    probeTimeoutMs: z.natural().min(1).default(30_000),
  })

  private readonly providers = new Map<ImplId, ProviderRecord>()
  private readonly sessions = new Map<BrainSessionId, ManagedBrainSession>()
  private readonly usageListeners = new Set<(record: BrainUsageRecord) => void>()
  private readonly selfCtx: Context
  private readonly settings: Required<Omit<Config, 'blobsDir'>>
  /** 回合输入 blob 的存储（图片等）：调用方 `put` 拿引用，提供方经启动上下文读回。 */
  readonly blobs: BrainBlobStore

  /**
   * @param ctx - 服务上下文。
   * @param config - 校验并补好缺省值的配置。
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'brains')
    this.selfCtx = ctx
    // schemastery 在构造服务之前已经校验并补齐缺省值。
    this.settings = config as Required<Omit<Config, 'blobsDir'>>
    this.blobs = new BrainBlobStore(resolveBlobsDir(config))
    ctx.effect(() => () => this.closeAll(), 'brains teardown')
  }

  private get subprocess(): SubprocessRuntime {
    return this.selfCtx.subprocess
  }

  /**
   * 登记一个提供方，直到返回的函数被调用或登记它的插件卸载；释放时它开着的会话一起关。
   * @param provider - 提供方；`impl` 与 `meta` 在这里校验。
   * @returns 释放函数。
   * @throws {BrainError} `invalid_input`（实现名或能力声明不合规）、`conflict`（实现名已被登记）。
   */
  register(provider: BrainProvider): () => void {
    const impl = ImplIdSchema.safeParse(provider.impl)
    if (!impl.success) throw invalid(`provider impl ${JSON.stringify(provider.impl)}`, impl.error.issues)
    const meta = MetaSchema.safeParse(provider.meta)
    if (!meta.success) throw invalid(`meta of provider ${impl.data}`, meta.error.issues)
    if (this.providers.has(impl.data)) {
      throw new BrainError('conflict', 'brain.provider_duplicate', `a brain provider named ${impl.data} is already registered`)
    }
    const record: ProviderRecord = {
      provider,
      impl: impl.data,
      plugin: this.ctx.fiber.name,
      meta: meta.data,
      available: undefined,
    }
    const dispose = this.ctx.effect(() => {
      this.providers.set(record.impl, record)
      return async () => {
        if (this.providers.get(record.impl) === record) this.providers.delete(record.impl)
        const owned = [...this.sessions.values()].filter(session => session.impl === record.impl)
        await Promise.all(owned.map(session => session.close('service')))
      }
    }, 'brains.register()')
    return () => { void dispose() }
  }

  private requireProvider(impl: ImplId): ProviderRecord {
    const record = this.providers.get(impl)
    if (record === undefined) {
      const known = [...this.providers.keys()].join(', ') || '(none)'
      throw new BrainError('not_found', 'brain.provider_unknown', `no brain provider named ${impl} is registered; registered: ${known}`)
    }
    return record
  }

  /**
   * 一个提供方的能力声明。
   * @param impl - 提供方。
   * @returns 能力声明的副本。
   * @throws {BrainError} `not_found`。
   */
  describe(impl: ImplId): Meta {
    return structuredClone(this.requireProvider(impl).meta)
  }

  /**
   * 全部已登记的提供方（`brain_provider`）。
   * @returns 按实现名排序的登记副本。
   */
  list(): BrainProviderView[] {
    return [...this.providers.values()]
      .map(record => ({
        impl: record.impl,
        plugin: record.plugin,
        meta: structuredClone(record.meta),
        available: record.available,
        ...(record.lastProbeAt === undefined ? {} : { lastProbeAt: record.lastProbeAt }),
        ...(record.probeResult === undefined ? {} : { probeResult: structuredClone(record.probeResult) }),
      }))
      .sort((left, right) => left.impl.localeCompare(right.impl))
  }

  /**
   * 探测一个提供方能不能开会话；结果记进登记，不可用时发 `brain.provider.unavailable.v1`。探测本身出错或超时按不可用处理。
   * @param impl - 提供方。
   * @param signal - 取消探测。
   * @returns 探测结果。
   * @throws {BrainError} `not_found`。
   */
  async probe(impl: ImplId, signal?: AbortSignal): Promise<BrainProbeResult> {
    const record = this.requireProvider(impl)
    const subprocess = this.subprocess
    let result: BrainProbeResult
    try {
      result = await within(record.provider.probe({
        logger: this.selfCtx.logger(`brain:${impl}`),
        signal,
        resolveExecutable: (command, env, probeSignal) => subprocess.resolveExecutable(command, env, probeSignal),
        spawn: spec => subprocess.spawn(spec),
      }), this.settings.probeTimeoutMs, `${impl} probe`)
    } catch (error) {
      result = { available: false, problems: [error instanceof Error ? error.message : String(error)] }
    }
    const at = new Date().toISOString()
    record.available = result.available
    record.lastProbeAt = at
    record.probeResult = result
    if (!result.available) this.selfCtx.emit('brain.provider.unavailable.v1', { impl, result: structuredClone(result), at })
    return result
  }

  /**
   * 生成或刷新成员给某家提供方的配置目录（01 §4.6），每次覆盖：建好 `<brains>/<impl>/`，内容由提供方的
   * `writeMemberConfig` 写。
   * @param member - 成员。
   * @param impl - 提供方。
   * @param spec - 规矩、本事目录、模型（可省）、MCP、是否读仓库指令。
   * @returns 成员配置目录，作为 `SessionConfig.configDir`。
   * @throws {BrainError} `not_found`（没有这个提供方），或提供方写法自己的失败。
   */
  async prepareConfigDir(member: MemberId, impl: ImplId, spec: MemberConfigSpec): Promise<string> {
    const { provider } = this.requireProvider(impl)
    const write = provider.writeMemberConfig?.bind(provider)
    return prepareMemberConfigDir(this.settings.membersRoot, member, impl, spec, write)
  }

  /**
   * 开一个新会话。先做四项核对：压缩关不掉的提供方不接 `compaction: 'off'`；原生工具去不掉的提供方不接
   * `nativeToolPolicy: 'none'`；没有会话模式的提供方不接 `modeId`；原生子 agent 只对干活的活放开，其余种类改成关并记在
   * `adjustments` 里。其余策略（工具、压缩、仓库指令、规矩、本事的实际落实）由提供方在开会话时负责，做不到的组合由它拒绝。
   * @param owner - 归属方上下文；它卸载时会话一起关。
   * @param request - 提供方与会话配置。
   * @returns 会话句柄。
   * @throws {BrainError} `not_found`、`invalid_input`、`timeout`，或提供方自己的失败。
   */
  async createSession(owner: Context, request: CreateSessionRequest): Promise<BrainSession> {
    const record = this.requireProvider(request.impl)
    const { config, adjustments } = this.admit(record, request.cfg)
    return this.open(owner, record, config, adjustments, undefined)
  }

  /**
   * 在新进程里续接一个会话（提供方 `Meta.resume` 为 true 时）。核对同 {@link createSession}。
   * @param owner - 归属方上下文；它卸载时会话一起关。
   * @param request - 提供方、续接句柄与这一代的会话配置。
   * @returns 会话句柄。
   * @throws {BrainError} `not_found`、`unavailable`（提供方不支持续接）、`invalid_input`、`timeout`，或提供方自己的失败。
   */
  async resumeSession(owner: Context, request: ResumeSessionRequest): Promise<BrainSession> {
    const record = this.requireProvider(request.impl)
    if (!record.meta.resume) {
      throw new BrainError('unavailable', 'brain.resume_unsupported', `brain provider ${record.impl} does not resume sessions; open a new session instead`)
    }
    const resume = ResumeHandleSchema.safeParse(request.resume)
    if (!resume.success) throw invalid('resume handle', resume.error.issues)
    if (resume.data.provider !== record.impl) {
      throw new BrainError('invalid_input', 'brain.resume_provider_mismatch', `resume handle belongs to ${resume.data.provider}, not ${record.impl}`)
    }
    const { config, adjustments } = this.admit(record, request.cfg)
    return this.open(owner, record, config, adjustments, resume.data)
  }

  /**
   * 跨 CLI 子活的会话（01 §4.5 路②）。要等第三层的 tasks；这一阶段只留接口位置，调用即报"未实现"。
   * @param _owner - 归属方上下文。
   * @param _request - 父活、提供方与会话配置。
   * @returns 永远以 `BrainError(unavailable, brain.not_implemented)` 拒绝。
   */
  openChildTask(_owner: Context, _request: OpenChildTaskRequest): Promise<BrainSession> {
    return Promise.reject(new BrainError(
      'unavailable',
      'brain.not_implemented',
      'cross-CLI child tasks need the tasks layer (01 §4.5 route 2), which is not built yet',
    ))
  }

  /**
   * 某个会话的子 agent。
   * @param sessionId - 会话号。
   * @returns 子 agent 登记的副本。
   * @throws {BrainError} `not_found`（没有开着的这个会话）。
   */
  children(sessionId: BrainSessionId): BrainChildView[] {
    return this.requireSession(sessionId).children()
  }

  /**
   * 一个开着的会话。
   * @param sessionId - 会话号。
   * @returns 会话句柄；没有时为 `undefined`。
   */
  get(sessionId: BrainSessionId): BrainSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * 全部开着的会话（`brain_session` 里未关的行）。
   * @returns 会话登记的副本。
   */
  listSessions(): BrainSessionView[] {
    return [...this.sessions.values()].map(session => session.view())
  }

  /**
   * 开着的会话拉起过的进程（`brain_process`）。
   * @returns 进程登记的副本。
   */
  processes(): BrainProcessView[] {
    return [...this.sessions.values()].flatMap(session => session.processViews())
  }

  /**
   * 订阅用量（guard 以后经它记账）。随调用方上下文释放。
   * @param listener - 收到每条用量记录。
   * @returns 取消订阅。
   */
  onUsage(listener: (record: BrainUsageRecord) => void): () => void {
    const dispose = this.ctx.effect(() => {
      this.usageListeners.add(listener)
      return () => { this.usageListeners.delete(listener) }
    }, 'brains.onUsage()')
    return () => { void dispose() }
  }

  private requireSession(sessionId: BrainSessionId): ManagedBrainSession {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      throw new BrainError('not_found', 'brain.session_unknown', `no open brain session ${sessionId}`)
    }
    return session
  }

  private admit(record: ProviderRecord, input: SessionConfigInput): { config: SessionConfig; adjustments: string[] } {
    const parsed = SessionConfigSchema.safeParse(input)
    if (!parsed.success) throw invalid('session config', parsed.error.issues)
    let config = parsed.data
    const adjustments: string[] = []
    if (config.compaction === 'off' && record.meta.compaction === 'always_on') {
      throw new BrainError('invalid_input', 'brain.compaction_always_on', `brain provider ${record.impl} cannot switch its compaction off; it cannot run this session`)
    }
    if (config.nativeToolPolicy === 'none' && record.meta.nativeTools) {
      throw new BrainError('invalid_input', 'brain.native_tools_not_removable', `brain provider ${record.impl} cannot remove its native tools; it cannot run a session with nativeToolPolicy "none"`)
    }
    if (config.modeId !== undefined && !record.meta.modeSwitch) {
      throw new BrainError('invalid_input', 'brain.mode_switch_unsupported', `brain provider ${record.impl} has no session modes; open the session without modeId`)
    }
    if (config.childPolicy.native && config.mindKind !== 'work') {
      config = { ...config, childPolicy: { ...config.childPolicy, native: false } }
      adjustments.push(`childPolicy.native=false: native child agents are only allowed for work sessions, not ${config.mindKind}`)
    }
    return { config, adjustments }
  }

  private async open(
    owner: Context,
    record: ProviderRecord,
    config: SessionConfig,
    adjustments: string[],
    resume: ResumeHandle | undefined,
  ): Promise<BrainSession> {
    const id = BrainSessionId(`brain-session-${randomUUID()}`)
    // per-session 的提供方续接时回到上一代的 home（它的转录在那里）；其余情况按布局给目录。
    const homeDir = resume?.home !== undefined && record.provider.sessionHome === 'per-session'
      ? resumedHome(config.configDir, record.impl, resume.home)
      : homeDirFor(config.configDir, record.impl, id, record.provider.sessionHome)
    await mkdir(homeDir, { recursive: true })
    const session = new ManagedBrainSession(this.sessionHost(record.impl, id), {
      id,
      impl: record.impl,
      meta: record.meta,
      sessionHome: record.provider.sessionHome,
      config,
      homeDir,
      adjustments,
      ...(resume === undefined ? {} : { resumedFrom: resume }),
    })
    const launch = session.launchContext(this.subprocess)
    const opening: Promise<BrainProviderSession> = resume === undefined
      ? record.provider.createSession(config, launch)
      : record.provider.resumeSession(resume, config, launch)
    let providerSession: BrainProviderSession
    try {
      providerSession = await within(opening, this.settings.handshakeTimeoutMs, `${record.impl} ${resume === undefined ? 'createSession' : 'resumeSession'}`)
    } catch (error) {
      // 超时之后才开成的提供方会话没有句柄接手，开成即关。
      opening.then(late => late.close(), () => {}).catch((lateError: unknown) => {
        this.selfCtx.logger('brains').warn(`late ${record.impl} session failed to close: ${String(lateError)}`)
      })
      await session.abandon()
      throw error
    }
    session.attach(providerSession)
    this.sessions.set(id, session)
    session.bindOwner(owner.effect(() => () => session.close('owner'), `brains session ${id}`))
    this.selfCtx.emit('brain.session.opened.v1', session.view())
    return session
  }

  private sessionHost(impl: ImplId, id: BrainSessionId): BrainSessionHost {
    return {
      logger: this.selfCtx.logger(`brain:${impl}`),
      blobs: this.blobs,
      timeouts: {
        handshakeMs: this.settings.handshakeTimeoutMs,
        callMs: this.settings.callTimeoutMs,
        closeMs: this.settings.closeTimeoutMs,
      },
      processSpawned: (view) => { this.selfCtx.emit('brain.process.spawned.v1', view) },
      processExited: (view) => { this.selfCtx.emit('brain.process.exited.v1', view) },
      childOpened: (view) => { this.selfCtx.emit('brain.child.opened.v1', view) },
      childEnded: (view) => { this.selfCtx.emit('brain.child.ended.v1', view) },
      usage: (usageRecord) => {
        this.selfCtx.emit('brain.usage.v1', usageRecord)
        for (const listener of [...this.usageListeners]) {
          try {
            listener(usageRecord)
          } catch (error) {
            // 一个用量订阅者出错不影响其余订阅者与会话本身。
            this.selfCtx.logger('brains').warn(`a usage listener failed: ${String(error)}`)
          }
        }
      },
      closed: (session) => {
        if (this.sessions.get(id) === session) this.sessions.delete(id)
        this.selfCtx.emit('brain.session.closed.v1', { session: session.view(), usage: session.usage() })
      },
    }
  }

  private async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(session => session.close('service')))
  }
}

export default BrainRegistry
