/** B′ minds 插件骨架；业务装配随 C′–G′ 接缝实现。
 * @module @liwa/minds
 */
import { Context, Service } from '@liwa/cordis'
import z from '@liwa/schemastery'

/** 部署参数；没有已定默认值的字段必须显式配置。 */
export const Config = z.object({
  storageRoot: z.string().min(1).required(),
  eventsRoot: z.string().min(1).required(),
  collectWindowMs: z.number().step(1).min(1).default(1000),
  batchWindowMs: z.number().step(1).min(1).default(30000),
  batchMaxItems: z.number().step(1).min(1).default(20),
  batchMaxChars: z.number().step(1).min(1).default(8000),
  pendingMaxPerOwner: z.number().step(1).min(1).default(200),
  agentStreamCoalesceWindowMs: z.number().step(1).min(1).default(60),
  logBatchMs: z.number().step(1).min(1).required(),
  logBatchBytes: z.number().step(1).min(1).required(),
  lastActivityWriteMs: z.number().step(1).min(1).required(),
  rescueTimeouts: z.object({
    reloadSessionCloseMs: z.number().step(1).min(1).default(3000),
    interruptSessionMs: z.number().step(1).min(1).default(2000),
  }).default({ reloadSessionCloseMs: 3000, interruptSessionMs: 2000 }),
  watchdogMs: z.number().step(1).min(1).default(60000),
  hardLimitMs: z.number().step(1).min(1).default(120000),
  finishRetryDelayMs: z.number().step(1).min(1).default(1000),
  finishRetryMaxMs: z.number().step(1).min(1).default(5000),
  retiredInternalTtlMs: z.number().step(1).min(1).default(600000),
  timelineContentMaxChars: z.number().step(1).min(1).required(),
  operationRetentionMs: z.number().step(1).min(1).required(),
  catalogRefreshTimeoutMs: z.number().step(1).min(1).required(),
  diagnosticTimeoutMs: z.number().step(1).min(1).required(),
  catalogConcurrency: z.number().step(1).min(1).required(),
})

/** 通过校验的部署配置。 */
export type Config = ReturnType<typeof Config>

declare module '@liwa/cordis' {
  interface Context {
    /** B′ 服务骨架，接缝装配前不提供业务方法。 */
    minds: Minds
  }
}

/** 仅声明服务所有权；后续块在此装配已迁入的实现。 */
export default class Minds extends Service {
  /** 装载时校验部署参数。 */
  static Config = Config

  /**
   * 登记服务身份；B′ 不创建 Manager、MCP 端点或提供方会话。
   * @param ctx - 插件上下文。
   * @param config - 已校验配置。
   */
  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'minds')
  }
}

export type { DaemonConfigStore, MutableDaemonConfig } from './seams/config.ts'
