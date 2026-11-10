/**
 * 本机 Claude Code 大脑提供方；一行配置一个实例，认证与地址像 Paseo 一样写在 env 里。
 * @module @liwa/brain-claude-code
 */
import type { Context } from '@liwa/cordis'
import { Config } from './config.ts'
import { ClaudeBrainProvider } from './provider.ts'

export { Config } from './config.ts'
export { CLAUDE_META, ClaudeBrainProvider } from './provider.ts'
export { ClaudeBrainSession } from './session.ts'

/** Cordis 插件名。 */
export const name = 'brain-claude-code'
/** 提供方登记归 brains；会话进程经它发的 launch。 */
export const inject = ['brains']

/**
 * 登记一个实例；配置错误（含认证变量缺失）在装载时抛出。
 * @param ctx - 插件上下文。
 * @param config - 已校验配置。
 */
export function apply(ctx: Context, config: Config): void {
  ctx.brains.register(new ClaudeBrainProvider(config))
}
