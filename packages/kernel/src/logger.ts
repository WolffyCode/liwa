// 日志：组合根注入 pino；kernel 自带一个控制台实现给测试与开发用
import type { Context as CordisContext } from 'cordis';
import type { LogFields, Logger } from './types.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createConsoleLogger(level: Level = 'info', bindings: LogFields = {}): Logger {
  const emit = (lv: Level, fields: LogFields, msg?: string): void => {
    if (ORDER[lv] < ORDER[level]) return;
    const line = JSON.stringify({ level: lv, msg, ...bindings, ...fields });
    if (lv === 'error' || lv === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    debug: (f, m) => emit('debug', f, m),
    info: (f, m) => emit('info', f, m),
    warn: (f, m) => emit('warn', f, m),
    error: (f, m) => emit('error', f, m),
    child: (more) => createConsoleLogger(level, { ...bindings, ...more }),
  };
}

/** 收集型日志：测试断言用 */
export interface MemoryLogger extends Logger {
  readonly entries: { level: Level; fields: LogFields; msg: string | undefined }[];
}
export function createMemoryLogger(bindings: LogFields = {}, sink: MemoryLogger['entries'] = []): MemoryLogger {
  const push = (level: Level) => (fields: LogFields, msg?: string) => {
    sink.push({ level, fields: { ...bindings, ...fields }, msg });
  };
  return {
    entries: sink,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    child: (more) => createMemoryLogger({ ...bindings, ...more }, sink),
  };
}

/** 启动第一件事：把 cordis 的 logger exporter 接到注入的 Logger，否则插件失败的原因只进内存缓冲 */
export function attachCordisLogger(root: CordisContext, logger: Logger): () => Promise<void> {
  const dispose = root.logger.exporter({
    export(message) {
      const fields: LogFields = { cordis: message.name, args: message.args.map(String) };
      const text = message.args.map(String).join(' ');
      if (message.type === 'error') logger.error(fields, text);
      else if (message.type === 'warn') logger.warn(fields, text);
      else if (message.type === 'info') logger.info(fields, text);
      else logger.debug(fields, text);
    },
  });
  return async () => {
    await dispose();
  };
}
