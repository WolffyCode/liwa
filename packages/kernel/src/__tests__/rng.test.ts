import { describe, expect, it } from 'vitest';
import { createRng, rngFromState } from '../rng.js';
import { fakeClock } from '../clock.js';
import { createIds } from '../ids.js';

describe('随机源、时钟、编号', () => {
  it('同种子同序列；fork 只由标签决定，与调用顺序无关', () => {
    const a = createRng('s');
    const b = createRng('s');
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    const r1 = createRng('s');
    const x = r1.fork('plugin:x').next();
    r1.fork('plugin:y').next();
    const r2 = createRng('s');
    r2.fork('plugin:y').next();
    expect(r2.fork('plugin:x').next()).toBe(x);
  });
  it('能从状态恢复并续上同一序列', () => {
    const a = createRng('s');
    a.next();
    const state = a.state();
    const expected = a.next();
    expect(rngFromState(state).next()).toBe(expected);
    expect(() => rngFromState('{}')).toThrow(/缺字段/);
  });
  it('假时钟按到期顺序触发定时器', async () => {
    const clock = fakeClock('2026-01-01T00:00:00.000Z');
    const fired: string[] = [];
    clock.timer(50, () => fired.push('b'));
    const cancel = clock.timer(10, () => fired.push('a'));
    clock.timer(30, () => fired.push('c'));
    cancel();
    await clock.advance(40);
    expect(fired).toEqual(['c']);
    expect(clock.mono()).toBe(40);
    await clock.advance(20);
    expect(fired).toEqual(['c', 'b']);
    expect(clock.wall().iso).toBe('2026-01-01T00:00:00.060Z');
  });
  it('编号按前缀计数', () => {
    const ids = createIds({ turn: 3 });
    expect(ids.next('turn')).toBe('turn_000004');
    expect(ids.next('call')).toBe('call_000001');
  });
});
