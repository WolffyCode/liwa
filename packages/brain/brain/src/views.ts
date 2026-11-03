/**
 * `ctx.brains` 的内存登记形状：01 §2 五张表（提供方、进程、会话、子 agent、用量）在这一阶段的落法。
 * 每条登记同时作为同名 cordis 事件的载荷发出，以后由经历流订阅落库。
 * @module @liwa/brain/views
 */

import type { BrainProcessId, BrainSessionId, ChildId, ImplId, MemberId, TurnId } from './brand.ts'
import type { ChildStopReason, Meta, MindKind, ResumeHandle, SessionOwner, Usage } from './contract.ts'
import type { BrainProbeResult } from './provider.ts'

/** `brain_provider`：一个已登记的提供方。 */
export interface BrainProviderView {
  /** 实现名。 */
  impl: ImplId
  /** 登记它的插件名。 */
  plugin: string
  /** 能力声明。 */
  meta: Meta
  /** 最近一次探测的结论；还没探测过时为 `undefined`。 */
  available: boolean | undefined
  /** 最近一次探测的时间。 */
  lastProbeAt?: string
  /** 最近一次探测的结果。 */
  probeResult?: BrainProbeResult
}

/** `brain_process` 的状态：活着，或已退出。 */
export type BrainProcessState = 'live' | 'exited'

/** `brain_process`：经某个会话的启动上下文拉起的一个进程。 */
export interface BrainProcessView {
  /** brains 分配的进程号。 */
  processId: BrainProcessId
  /** 所属会话。 */
  sessionId: BrainSessionId
  /** 所属提供方。 */
  impl: ImplId
  /** 可执行文件（argv[0]）。 */
  command: string
  /** 完整 argv 的 SHA-256（对账用，不存参数原文）。 */
  argvHash: string
  /** 拉起时间。 */
  startedAt: string
  /** 状态。 */
  state: BrainProcessState
  /** 退出码；被信号杀死时为 `null`；还活着时缺省。 */
  exitCode?: number | null
  /** 终止信号；正常退出时为 `null`；还活着时缺省。 */
  signal?: string | null
  /** 退出时间。 */
  exitedAt?: string
}

/** 会话句柄的状态：可用；取消失败、停止中（拒绝新回合）；正在关；已关。 */
export type BrainSessionState = 'open' | 'stopping' | 'closing' | 'closed'

/** 会话关闭的原因。 */
export type BrainCloseReason = 'closed' | 'owner' | 'process_exit' | 'service'

/** `brain_session`：一代会话。 */
export interface BrainSessionView {
  /** brains 分配的会话号。 */
  sessionId: BrainSessionId
  /** 提供方。 */
  impl: ImplId
  /** 成员。 */
  member: MemberId
  /** 会话种类。 */
  mindKind: MindKind
  /** 实例或活，加代次。 */
  owner: SessionOwner
  /** 开会话时的模型。 */
  model: string
  /** 成员配置目录。 */
  configDir: string
  /** 提供方 home。 */
  homeDir: string
  /** 状态。 */
  state: BrainSessionState
  /** 开的时间。 */
  openedAt: string
  /** 续接来源（续接开的会话才有）。 */
  resumedFrom?: ResumeHandle
  /** brains 在开会话前改过的配置项（例如非干活的活被关掉原生子 agent）。 */
  adjustments: string[]
  /** 关的时间。 */
  closedAt?: string
  /** 关的原因。 */
  closeReason?: BrainCloseReason
}

/** `brain_child` 的种类：提供方自己的子 agent，或跨 CLI 子活。 */
export type BrainChildKind = 'native-child' | 'cross-cli-task'

/** `brain_child`：一个会话的子 agent（两条路都在这里）。 */
export interface BrainChildView {
  /** 子 agent 号（跨 CLI 子活时是子活号）。 */
  childId: ChildId
  /** 所属会话。 */
  sessionId: BrainSessionId
  /** 种类。 */
  kind: BrainChildKind
  /** 跑它的提供方。 */
  provider: ImplId
  /** 显示名。 */
  label: string
  /** 直接上级子 agent；直接挂在会话下时缺省。 */
  parentChildId?: ChildId
  /** 状态。 */
  state: 'running' | 'ended'
  /** 结束原因。 */
  stopReason?: ChildStopReason
  /** 结束时报的用量。 */
  usage?: Usage
  /** 开始时间。 */
  openedAt: string
  /** 结束时间。 */
  endedAt?: string
}

/** `brain_usage` 的来源：回合结束、提供方级更新、子 agent 结束。 */
export type BrainUsageSource = 'turn' | 'update' | 'child'

/** `brain_usage`：一条用量记录，经 `onUsage` 与 `brain.usage.v1` 推出去。 */
export interface BrainUsageRecord {
  /** 所属会话。 */
  sessionId: BrainSessionId
  /** 提供方。 */
  impl: ImplId
  /** 成员。 */
  member: MemberId
  /** 实例或活，加代次；子 agent 的用量按它归到父活。 */
  owner: SessionOwner
  /** 回合号（有的话）。 */
  turnId?: TurnId
  /** 子 agent 号（子 agent 的用量才有）。 */
  childId?: ChildId
  /** 来源。 */
  source: BrainUsageSource
  /** 用量；`update` 来源只带提供方报的那几项。 */
  usage: Partial<Usage>
  /** 记录时间。 */
  at: string
}

/** `brain.session.closed.v1` 的载荷：关掉的会话与它的用量汇总。 */
export interface BrainSessionClosedRecord {
  /** 关闭时的会话登记。 */
  session: BrainSessionView
  /** 整个会话的用量汇总。 */
  usage: Usage
}

/** `brain.provider.unavailable.v1` 的载荷。 */
export interface BrainProviderUnavailableRecord {
  /** 提供方。 */
  impl: ImplId
  /** 探测结果。 */
  result: BrainProbeResult
  /** 探测时间。 */
  at: string
}
