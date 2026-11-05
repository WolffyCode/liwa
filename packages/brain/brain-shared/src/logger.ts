/**
 * 迁来的 Paseo 提供方代码按 pino 的形状写日志（`logger.child({...})`、`logger.warn(obj, msg)`）；灵鲸的日志是
 * cordis logger（`logger.warn(format, ...args)`）。这里给出 Paseo 代码用到的那一小块 pino 接口，并把它接到
 * cordis logger 上，`src/paseo/` 里只需把 `import type { Logger } from "pino"` 原地换成 {@link PaseoLogger}。
 * @module @liwa/brain-shared/logger
 */

import type { Logger } from '@liwa/cordis'

/** pino 日志方法的两种调用形状：只给消息，或先给结构化字段再给消息。 */
export interface PaseoLogMethod {
  /**
   * 写一条日志。
   * @param objectOrMessage - 结构化字段，或消息本身。
   * @param message - 先给了字段时的消息。
   */
  (objectOrMessage: unknown, message?: string): void
}

/** Paseo 代码用到的 pino 子集。 */
export interface PaseoLogger {
  /**
   * 带上固定字段的子日志器。
   * @param bindings - 之后每条日志都带的字段。
   * @returns 子日志器。
   */
  child(bindings: Record<string, unknown>): PaseoLogger
  /** 逐条原始协议消息这一级；灵鲸不记（量大且含会话正文）。 */
  readonly trace: PaseoLogMethod
  /** 调试。 */
  readonly debug: PaseoLogMethod
  /** 一般信息。 */
  readonly info: PaseoLogMethod
  /** 可恢复的异常。 */
  readonly warn: PaseoLogMethod
  /** 错误。 */
  readonly error: PaseoLogMethod
}

/**
 * 把字段压成一行；错误只取名字与消息，其余值用 JSON，循环引用或 BigInt 写成占位。
 * @param fields - 结构化字段。
 * @returns 适合附在消息后面的一行文本；没有字段时为空串。
 */
function renderFields(fields: Record<string, unknown>): string {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return ''
  const parts = entries.map(([key, value]) => {
    if (value instanceof Error) return `${key}=${value.name}: ${value.message}`
    try {
      return `${key}=${JSON.stringify(value)}`
    } catch (_unserializable) {
      // 循环引用或 BigInt：字段只是诊断，写占位不影响调用方。
      return `${key}=[unserializable]`
    }
  })
  return ` (${parts.join(', ')})`
}

/**
 * 把 cordis logger 包成 Paseo 代码要的 pino 形状。
 * @param logger - cordis logger。
 * @param bindings - 每条日志都带的字段。
 * @returns pino 形状的日志器。
 */
export function paseoLogger(logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>, bindings: Record<string, unknown> = {}): PaseoLogger {
  const write = (level: 'debug' | 'info' | 'warn' | 'error'): PaseoLogMethod => (objectOrMessage, message) => {
    if (typeof objectOrMessage === 'string' && message === undefined) {
      logger[level](`${objectOrMessage}${renderFields(bindings)}`)
      return
    }
    const fields = objectOrMessage !== null && typeof objectOrMessage === 'object' && !(objectOrMessage instanceof Error)
      ? { ...bindings, ...objectOrMessage }
      : { ...bindings, value: objectOrMessage }
    logger[level](`${message ?? ''}${renderFields(fields)}`)
  }
  return {
    child: extra => paseoLogger(logger, { ...bindings, ...extra }),
    trace: () => {},
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  }
}
