/**
 * `brain.provider` 能力的提供方侧接口：每个 agent CLI 客户端都实现它。形状照 Paseo 的
 * `AgentClient` / `AgentSession`，让基于 Paseo 代码的适配器几乎一一对应：`createSession` /
 * `resumeSession` / `startTurn` / `respondToPermission` / `canStopRuntime` / `close` 沿用 Paseo 的
 * 名字与生命周期，`subscribe` 沿用 Paseo 的回调式事件流，`deliver` 是 `steerActiveTurn` 的推广，
 * `cancel` 是带原因的 `interrupt`，`persistence` 就是 `describePersistence`。
 * @module @liwa/brain/provider
 */

import type { Logger } from '@liwa/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@liwa/subprocess'
import type { BrainSessionId, ImplId, PermissionRequestId, TurnId } from './brand.ts'
import type {
  BrainEvent, CancelOptions, DeliverOptions, DeliverResult, Meta, PermissionResponse, ResumeHandle, SessionConfig, TurnInput,
} from './contract.ts'

/** 提供方能用的子进程操作；签名与 subprocess seam 相同。 */
export interface BrainProcessHost {
  /**
   * 在提供方的执行环境里解析可执行文件。
   * @param command - 绝对路径或 PATH 上的名字。
   * @param env - 解析时考虑的显式环境项。
   * @param signal - 取消解析。
   * @returns 规范化的可执行路径；找不到时以 `SubprocessExecutableNotFoundError` 拒绝。
   */
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  /**
   * 拉起一个受管子进程。
   * @param spec - 完全显式的拉起请求。
   * @returns 活着的进程句柄。
   */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

/**
 * `ctx.brains` 为一个会话交给提供方的东西（Paseo `AgentLaunchContext`）。会话的每个进程都必须经
 * {@link BrainLaunchContext.spawn} 拉起：brains 先登记归属，进程退出时补发 `process.exited`。
 */
export interface BrainLaunchContext extends BrainProcessHost {
  /** brains 分配的会话号（相当于 Paseo 的 agent id）。 */
  readonly sessionId: BrainSessionId
  /** 提供方在成员配置目录里的 home；调用前已建好。 */
  readonly homeDir: string
  /** 本会话的日志器。 */
  readonly logger: Logger
}

/** `ctx.brains` 做可用性探测时交给提供方的东西。 */
export interface BrainProbeContext extends BrainProcessHost {
  /** 提供方的日志器。 */
  readonly logger: Logger
  /** 取消探测。 */
  readonly signal?: AbortSignal | undefined
}

/** 一次可用性探测的结果（Paseo 的 `isAvailable` 加 `getDiagnostic`）。 */
export interface BrainProbeResult {
  /** 现在能不能开会话。 */
  available: boolean
  /** 读得到时的 CLI 版本。 */
  version?: string
  /** 不能（完全）用的全部原因，按显示顺序；没有就是空数组。 */
  problems: string[]
}

/**
 * 一个活着的提供方会话（Paseo `AgentSession`）。实现必须：两回合之间 CLI 退出报 `session.exited`；
 * `cancel` 幂等；每个 `turn.completed` 都带 usage；`Meta.delivery` 声明为 false 的送达语义，
 * `deliver` 恒回 `unsupported`；把原生权限请求翻成 `options[]`，对不上的选项号按 `deny_once` 应用；
 * 把自己的子 agent 翻成 `child.*` 事件，并在 `cancel` / `close` 时一并停掉；进程只经启动上下文拉起。
 */
export interface BrainProviderSession {
  /** 提供方自己的会话号；还不知道时为 `null`。 */
  readonly id: string | null
  /**
   * 把事件推给 `listener`，直到调用返回的函数为止。
   * @param listener - 按发出顺序收到每个事件。
   * @returns 取消订阅。
   */
  subscribe(listener: (event: BrainEvent) => void): () => void
  /**
   * 用 `input` 开始一个回合；事件随后在流上到达。
   * @param input - 这一回合的输入块。
   * @returns 本回合所有事件都带的回合号。
   */
  startTurn(input: TurnInput): Promise<{ turnId: TurnId }>
  /**
   * 按指定可见性送达输入。
   * @param input - 送达的输入块。
   * @param options - 语义、是否叫醒、调用方以为正在跑的回合。
   * @returns `accepted`，`unsupported`（`Meta.delivery` 声明为 false），或 `unavailable`（眼下做不到）。
   */
  deliver(input: TurnInput, options: DeliverOptions): Promise<DeliverResult>
  /**
   * 停掉正在跑的回合。幂等：此前的回合都不可能再跑时完成，空闲时也直接完成；只有提供方可能仍握着回合时才拒绝。
   * @param options - 原因，以及提供方那边未开始的输入要不要保留。
   */
  cancel(options: CancelOptions): Promise<void>
  /**
   * 答复一次权限请求。
   * @param requestId - `permission.request` 事件里的号。
   * @param response - 所选选项；对不上的号按 `deny_once` 应用。
   */
  respondToPermission(requestId: PermissionRequestId, response: PermissionResponse): Promise<void>
  /**
   * 说明新进程怎么续接这个会话。
   * @returns 续接句柄；新进程还续不上时为 `null`。
   */
  persistence(): ResumeHandle | null
  /**
   * 提供方对闲置回收的否决（可选）。
   * @returns 只有释放运行时不会丢后台工作或待回的答复时才为 true。
   */
  canStopRuntime?(): Promise<boolean>
  /**
   * 换后续回合的模型（`Meta.modelSwitch` 为 true 时）。
   * @param model - 提供方的模型名。
   */
  setModel?(model: string): Promise<void>
  /** 释放活的运行时，不删提供方那边持久的会话。幂等。 */
  close(): Promise<void>
}

/**
 * 一个 agent CLI 客户端（Paseo `AgentClient`），经 `ctx.brains.register` 登记；登记它的插件管它的生命期。
 */
export interface BrainProvider {
  /** 实现名，在 `ctx.brains` 里唯一。 */
  readonly impl: ImplId
  /** 能力声明，登记时校验。 */
  readonly meta: Meta
  /**
   * 检查能不能开会话。
   * @param context - 子进程操作、日志器、取消信号。
   * @returns 可用性、版本与问题清单。
   */
  probe(context: BrainProbeContext): Promise<BrainProbeResult>
  /**
   * 开一个新会话。
   * @param config - 校验过的会话配置。
   * @param launch - 会话号、home 目录、日志器、登记归属的进程入口。
   * @returns 活着的会话。
   */
  createSession(config: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession>
  /**
   * 在新进程里续接一个持久化的会话（`Meta.resume` 为 true 时）。
   * @param handle - 之前某个会话的 `persistence()` 返回的句柄。
   * @param config - 这一代的会话配置（校验过）。
   * @param launch - 会话号、home 目录、日志器、登记归属的进程入口。
   * @returns 活着的会话。
   */
  resumeSession(handle: ResumeHandle, config: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession>
}
