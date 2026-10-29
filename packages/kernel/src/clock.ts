// 时钟：真实时钟的唯一实现（docs/architecture/modules/00-plugin-kernel.md §8）
import type { Clock } from './types.js';

export function systemClock(): Clock {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const clock: Clock = {
    wall() {
      // eslint-disable-next-line no-restricted-properties -- 这里是注入给全系统的真实时钟
      const ms = Date.now();
      return { iso: new Date(ms).toISOString(), ms, tz };
    },
    mono() {
      return Number(process.hrtime.bigint() / 1000n) / 1000;
    },
    timer(ms, fn) {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    },
  };
  return Object.freeze(clock);
}

/** 假时钟：测试与 L0 回放用；时间只在 advance 时前进 */
export interface FakeClock extends Clock {
  /** 先让已排队的异步工作跑完，再把时间推进 ms，期间到期的定时器按到期顺序触发，每个触发后再等异步工作跑完 */
  advance(ms: number): Promise<void>;
  /** 只让已排队的微任务与 I/O 回调跑完，不推进时间 */
  flush(): Promise<void>;
  set(iso: string): void;
}

export function fakeClock(startIso = '2026-01-01T00:00:00.000Z', tz = 'Asia/Shanghai'): FakeClock {
  let nowMs = Date.parse(startIso);
  let monoMs = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  // setImmediate 排在所有微任务与已就绪的 I/O 回调之后，比 await Promise.resolve() 多清一整轮
  const flush = (): Promise<void> =>
    new Promise((resolve) => {
      setImmediate(resolve);
    });
  return {
    wall: () => ({ iso: new Date(nowMs).toISOString(), ms: nowMs, tz }),
    mono: () => monoMs,
    timer(ms, fn) {
      const id = ++seq;
      timers.set(id, { at: monoMs + ms, fn });
      return () => timers.delete(id);
    },
    flush,
    async advance(ms) {
      await flush();
      const target = monoMs + ms;
      for (;;) {
        let nextId: number | undefined;
        let nextAt = Number.POSITIVE_INFINITY;
        for (const [id, t] of timers) {
          if (t.at <= target && t.at < nextAt) {
            nextAt = t.at;
            nextId = id;
          }
        }
        if (nextId === undefined) break;
        const t = timers.get(nextId);
        timers.delete(nextId);
        if (!t) continue;
        nowMs += t.at - monoMs;
        monoMs = t.at;
        t.fn();
        await flush();
      }
      nowMs += target - monoMs;
      monoMs = target;
      await flush();
    },
    set(iso) {
      nowMs = Date.parse(iso);
    },
  };
}
