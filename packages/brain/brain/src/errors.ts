/**
 * 大脑能力的结构化失败。类别是灵鲸的错误类（什么性质、重试有没有用）；代码点名具体情形，
 * 归本包所有（`brain.<snake_case>`）。
 * @module @liwa/brain/errors
 */

/** `ctx.brains` 与提供方报的失败类别。 */
export type BrainErrorCategory =
  | 'unavailable'
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'timeout'
  | 'auth'
  | 'process_exit'
  | 'cancelled'
  | 'internal'

/** 原样重试可能成功的类别。 */
const RETRYABLE: ReadonlySet<BrainErrorCategory> = new Set(['unavailable', 'timeout', 'process_exit'])

/** 大脑能力的一次失败：类别、具体代码、能不能重试。 */
export class BrainError extends Error {
  /** 失败类别。 */
  readonly category: BrainErrorCategory
  /** 具体情形，`brain.<snake_case>`。 */
  readonly code: string
  /** 原样重试是否可能成功。 */
  readonly retryable: boolean

  /**
   * @param category - 失败类别。
   * @param code - 具体情形，`brain.<snake_case>`。
   * @param message - 给人看的、可操作的说明。
   * @param options - 原始原因（有的话）。
   */
  constructor(category: BrainErrorCategory, code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BrainError'
    this.category = category
    this.code = code
    this.retryable = RETRYABLE.has(category)
  }
}
