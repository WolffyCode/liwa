/**
 * 会话已解析秘密的唯一脱敏边界；stderr 跨块匹配，错误保持原类型。
 * @module @liwa/brain-claude-code/diagnostics
 */
import type { Logger } from '@liwa/cordis'
import { paseoLogger, type PaseoLogger } from '@liwa/brain-shared'

/** 每会话持有秘密，日志与原生失败复用同一匹配规则。 */
export class ClaudeDiagnostics {
  private readonly secrets: string[]
  /**
   * @param values - 本代已解析的认证与敏感 env 值。
   */
  constructor(values: readonly string[]) {
    // 日志字段经 JSON 序列化后，换行和引号会转义；两种表示都属于同一个已知秘密。
    const forms = values.filter(value => value !== '').flatMap(value => [value, JSON.stringify(value).slice(1, -1)])
    this.secrets = [...new Set(forms)].sort((a, b) => b.length - a.length)
  }

  /**
   * 完整诊断只匹配本代已知秘密，不改变错误分类。
   * @param text - 一条完整错误或日志。
   * @returns 去除已知秘密后的文本。
   */
  redact(text: string): string {
    for (const secret of this.secrets) text = text.split(secret).join('[redacted]')
    return text
  }

  /**
   * 在序列化完成后脱敏，不把秘密传到宿主 logger。
   * @param logger - 宿主日志器。
   * @returns Paseo 形状日志器。
   */
  logger(logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>): PaseoLogger {
    return paseoLogger({
      debug: (message) =>{  logger.debug(this.redact(String(message))) },
      info: (message) =>{  logger.info(this.redact(String(message))) },
      warn: (message) =>{  logger.warn(this.redact(String(message))) },
      error: (message) =>{  logger.error(this.redact(String(message))) },
    })
  }

  /**
   * 原生控制面错误仍按原类型抛出，但消息和堆栈不带秘密。
   * @param operation - 一次 SDK 调用。
   * @returns SDK 结果。
   */
  async protect<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof Error)) throw new Error(this.redact(String(error)))
      error.message = this.redact(error.message)
      if (error.stack !== undefined) error.stack = this.redact(error.stack)
      throw error
    }
  }

  /**
   * 保留可能组成秘密的末尾前缀，直到下一块到达；EOF 残片也不外泄。
   * @param emit - 已脱敏文本的唯一消费者。
   * @returns 独立 stderr 流的写入和结束操作。
   */
  stream(emit: (text: string) => void): { write(text: string): void; end(): void } {
    let pending = ''
    return {
      write: (text) => {
        const input = pending + text
        let output = ''
        let offset = 0
        while (offset < input.length) {
          const rest = input.slice(offset)
          if (this.secrets.some(secret => secret.length > rest.length && secret.startsWith(rest))) break
          const match = this.secrets.find(secret => rest.startsWith(secret))
          if (match !== undefined) { output += '[redacted]'; offset += match.length; continue }
          output += input.charAt(offset)
          offset++
        }
        pending = input.slice(offset)
        if (output !== '') emit(output)
      },
      end: () => {
        if (pending !== '') emit('[redacted]')
        pending = ''
      },
    }
  }
}
