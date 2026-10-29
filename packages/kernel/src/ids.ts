// 编号源：按前缀计数，录放按它匹配（docs/architecture/modules/00-plugin-kernel.md §8）
import type { Ids } from './types.js';

export function createIds(start: Readonly<Record<string, number>> = {}): Ids {
  const counters = new Map<string, number>(Object.entries(start));
  return Object.freeze({
    next(prefix: string): string {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}_${String(n).padStart(6, '0')}`;
    },
  });
}
