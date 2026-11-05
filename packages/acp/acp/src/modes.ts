/**
 * 标准 ACP 会话模式（`modes` / `session/set_mode` / `current_mode_update`）到底座计划模式（`@liwa/plan-mode`）的
 * 映射。会话的 Agent 能拿到计划模式服务（预设里挂了或宿主层挂了）时有两种模式：`default` 与 `plan`；拿不到就
 * 不报模式。切换按计划模式自己的时机生效：回合之间立刻落日志，回合进行中挂到下一步开始时；真正生效（`plan/mode`
 * 事件落日志）时会话发 `current_mode_update`。
 * @module @liwa/acp/modes
 */

import type { Context } from '@liwa/cordis'
import type { SessionModeState } from '@agentclientprotocol/sdk'
import type { Agent } from '@liwa/agent'
import type {} from '@liwa/agent-preset-registry'
import type {} from '@liwa/plan-mode'

/** 默认模式号。 */
export const ACP_DEFAULT_MODE = 'default'
/** 计划模式号。 */
export const ACP_PLAN_MODE = 'plan'

/** 计划模式服务里本模块用到的两项。 */
type PlanModeControl = Pick<NonNullable<Context['planMode']>, 'get' | 'set'>

/** 一次切换的结果：落了日志、挂到下一步、撤掉了相反的挂起项、或本来就是。 */
export type AcpModeSwitch = 'committed' | 'queued' | 'cancelled' | 'noop'

/** 模式号不认识（调用方可改的错）。 */
export class AcpModeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcpModeError'
  }
}

/**
 * 一个 Agent 能用的计划模式服务：先看它的预设里挂的，再看宿主层。
 * @param ctx - ACP 插件上下文。
 * @param agent - 会话的根 Agent。
 * @returns 计划模式服务；没有时为 `undefined`。
 */
export function planModeOf(ctx: Context, agent: Agent): PlanModeControl | undefined {
  return ctx.get('agentPresets')?.serviceFor(agent, 'planMode') ?? ctx.get('planMode')
}

/**
 * 会话的模式状态（`session/new` / `session/resume` 返回里的 `modes`）。
 * @param ctx - ACP 插件上下文。
 * @param agent - 会话的根 Agent。
 * @returns 模式状态；没有计划模式时为 `undefined`。
 */
export function sessionModeState(ctx: Context, agent: Agent): SessionModeState | undefined {
  const plan = planModeOf(ctx, agent)
  if (plan === undefined) return undefined
  const state = plan.get(agent)
  return {
    currentModeId: (state.pending ?? state.active) ? ACP_PLAN_MODE : ACP_DEFAULT_MODE,
    availableModes: [
      { id: ACP_DEFAULT_MODE, name: 'Default', description: 'Act on requests directly.' },
      { id: ACP_PLAN_MODE, name: 'Plan', description: 'Explore and present a plan for approval before acting (exit_plan_mode).' },
    ],
  }
}

/**
 * 切换会话模式。
 * @param ctx - ACP 插件上下文。
 * @param agent - 会话的根 Agent。
 * @param modeId - `default` 或 `plan`。
 * @returns 计划模式的切换结果（`queued` 表示回合进行中，下一步开始时生效）。
 * @throws {AcpModeError} 会话没有模式，或模式号不认识。
 */
export function setSessionMode(ctx: Context, agent: Agent, modeId: string): AcpModeSwitch {
  const plan = planModeOf(ctx, agent)
  if (plan === undefined) throw new AcpModeError('this session has no modes')
  if (modeId !== ACP_DEFAULT_MODE && modeId !== ACP_PLAN_MODE) {
    throw new AcpModeError(`unknown mode ${JSON.stringify(modeId)}; available: ${ACP_DEFAULT_MODE}, ${ACP_PLAN_MODE}`)
  }
  return plan.set(agent, modeId === ACP_PLAN_MODE)
}
