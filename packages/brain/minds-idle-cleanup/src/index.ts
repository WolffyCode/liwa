/** B′ minds-idle-cleanup 插件骨架；业务装配随 C′–G′ 接缝实现。
 * @module @liwa/minds-idle-cleanup
 */
import { type Context } from '@liwa/cordis'
import z from '@liwa/schemastery'

/** 部署参数；没有已定默认值的字段必须显式配置。 */
export const Config = z.object({
  idleAfterMs: z.number().step(1).min(1).default(3600000),
  sweepIntervalMs: z.number().step(1).min(1).default(60000),
  probeTimeoutMs: z.number().step(1).min(1).default(10000),
})

/** 通过校验的部署配置。 */
export type Config = ReturnType<typeof Config>

/** Cordis 插件名。 */
export const name = 'minds-idle-cleanup'
/** B′ 尚未装配业务依赖。 */
export const inject: string[] = []

/**
 * 保留插件装载入口，接缝未接通前不启动业务。
 * @param _ctx - 插件上下文。
 * @param _config - 已校验配置。
 */
export function apply(_ctx: Context, _config: Config): void {}
