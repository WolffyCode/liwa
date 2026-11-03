/**
 * 把回放脚本的假提供方登记进 `ctx.brains` 的 cordis 插件。只在测试或显式的测试 profile 里挂
 * （例如给 `liwa brain` 加一个 `--patch`），不进产品默认组合。
 * @module @liwa/brain-testkit/plugin
 */

import type { Context } from '@liwa/cordis'
import z from '@liwa/schemastery'
import { ImplId } from '@liwa/brain'
import { ScriptedBrainProvider } from './scripted-provider.ts'

/** 插件名。 */
export const name = 'brain-scripted-provider'

/** 依赖 `ctx.brains`。 */
export const inject = ['brains']

/** 假提供方的配置。 */
export interface Config {
  /** 实现名。 */
  impl: string
  /** 每个会话是否拉起一个空转 node 子进程代替 CLI。 */
  process: boolean
  /** 流式步骤之间的停顿（毫秒），让终端里看得见流式输出。 */
  stepDelayMs: number
}

export const Config: z<Config> = z.object({
  impl: z.string().default('fake'),
  process: z.boolean().default(true),
  stepDelayMs: z.natural().default(40),
})

/**
 * 登记假提供方；插件卸载时登记随之释放。
 * @param ctx - 插件上下文。
 * @param config - 校验过的配置。
 */
export function apply(ctx: Context, config: Config): void {
  ctx.brains.register(new ScriptedBrainProvider({
    impl: ImplId(config.impl),
    process: config.process,
    stepDelayMs: config.stepDelayMs,
  }))
}
