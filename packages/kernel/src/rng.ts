// 计数器式随机源：sfc32，按（种子, 标签）分流，可从状态恢复（docs/architecture/modules/00-plugin-kernel.md §8）
import { createHash } from 'node:crypto';
import { LiwaError } from '@liwa/contracts';
import type { Rng } from './types.js';

interface RngState {
  seed: string;
  a: number;
  b: number;
  c: number;
  d: number;
  n: number;
}

function seedWords(seed: string): [number, number, number, number] {
  const digest = createHash('sha256').update(seed).digest();
  return [digest.readUInt32LE(0), digest.readUInt32LE(4), digest.readUInt32LE(8), digest.readUInt32LE(12)];
}

class Sfc32 implements Rng {
  private s: RngState;

  constructor(state: RngState) {
    this.s = { ...state };
  }

  next(): number {
    const s = this.s;
    s.a >>>= 0;
    s.b >>>= 0;
    s.c >>>= 0;
    s.d >>>= 0;
    let t = (s.a + s.b) | 0;
    s.a = s.b ^ (s.b >>> 9);
    s.b = (s.c + (s.c << 3)) | 0;
    s.c = (s.c << 21) | (s.c >>> 11);
    s.d = (s.d + 1) | 0;
    t = (t + s.d) | 0;
    s.c = (s.c + t) | 0;
    s.n += 1;
    return (t >>> 0) / 4294967296;
  }

  fork(label: string): Rng {
    return createRng(`${this.s.seed}/${label}`);
  }

  state(): string {
    return JSON.stringify(this.s);
  }
}

/** 由种子字符串建随机源；同一种子同一序列 */
export function createRng(seed: string): Rng {
  const [a, b, c, d] = seedWords(seed);
  const rng = new Sfc32({ seed, a, b, c, d, n: 0 });
  // sfc32 惯例：先空转几轮让状态混合
  for (let i = 0; i < 12; i += 1) rng.next();
  return rng;
}

/** 从 state() 的输出恢复 */
export function rngFromState(serialized: string): Rng {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new LiwaError('invalid_input', 'rng.state', '随机源状态不是合法 JSON', { cause });
  }
  if (typeof parsed !== 'object' || parsed === null) throw new LiwaError('invalid_input', 'rng.state', '随机源状态格式不对');
  const s = parsed as Partial<RngState>;
  if (typeof s.seed !== 'string' || [s.a, s.b, s.c, s.d, s.n].some((v) => typeof v !== 'number')) {
    throw new LiwaError('invalid_input', 'rng.state', '随机源状态缺字段');
  }
  return new Sfc32(s as RngState);
}
