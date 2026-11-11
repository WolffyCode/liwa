/** B′ toolport 插件骨架；业务装配随 C′–G′ 接缝实现。
 * @module @liwa/toolport
 */
import { Context, Service } from '@liwa/cordis'
import z from '@liwa/schemastery'

/** 部署参数；没有已定默认值的字段必须显式配置。 */
export const Config = z.object({
  listen: z.string().min(1).required(),
  route: z.string().min(1).default('/mcp/agents'),
  tokenTtlMs: z.number().step(1).min(1).required(),
  toolTimeoutMs: z.number().step(1).min(1).default(10000),
})

/** 通过校验的部署配置。 */
export type Config = ReturnType<typeof Config>

declare module '@liwa/cordis' {
  interface Context {
    /** B′ 服务骨架，接缝装配前不提供业务方法。 */
    toolport: Toolport
  }
}

/** 仅声明服务所有权；后续块在此装配已迁入的实现。 */
export default class Toolport extends Service {
  /** 装载时校验部署参数。 */
  static Config = Config

  /**
   * 登记服务身份；B′ 不创建 Manager、MCP 端点或提供方会话。
   * @param ctx - 插件上下文。
   * @param config - 已校验配置。
   */
  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'toolport')
  }
}
