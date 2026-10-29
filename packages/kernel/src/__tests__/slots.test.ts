import { describe, expect, it } from 'vitest';
import { SlotRegistry } from '../slots.js';

describe('槽位注册表', () => {
  it('同一实现登记两次报冲突；释放后旧句柄失效', () => {
    const reg = new SlotRegistry();
    const dispose = reg.provide('p1', 'job.trigger', 'cron', { type: 'cron' });
    expect(() => reg.provide('p2', 'job.trigger', 'cron', { type: 'cron' })).toThrow(/已由 p1 登记/);
    const handle = reg.resolve<{ type: string }>('job.trigger');
    expect(handle.type).toBe('cron');
    dispose();
    expect(() => handle.type).toThrow(/已失效/);
    expect(() => reg.resolve('job.trigger')).toThrow(/没有可用实现/);
  });
  it('member-single：有绑定按绑定，只有一个提供方时隐式默认，多个无绑定报错', () => {
    const reg = new SlotRegistry();
    reg.provide('m1', 'memory.engine', 'a', { name: 'a' });
    expect(reg.resolve<{ name: string }>('memory.engine', { member: 'liwa' }).name).toBe('a');
    reg.provide('m2', 'memory.engine', 'b', { name: 'b' });
    expect(() => reg.resolve('memory.engine', { member: 'liwa' })).toThrow(/没有绑定/);
    reg.bind('default', 'memory.engine', 'b', 'profile');
    expect(reg.resolve<{ name: string }>('memory.engine', { member: 'liwa' }).name).toBe('b');
    reg.bind('liwa', 'memory.engine', 'a', 'owner');
    expect(reg.resolve<{ name: string }>('memory.engine', { member: 'liwa' }).name).toBe('a');
    expect(reg.resolve<{ name: string }>('memory.engine', { member: 'other' }).name).toBe('b');
  });
  it('registry：有序绑定决定回退链；bound 必须指明 impl', () => {
    const reg = new SlotRegistry();
    reg.provide('e1', 'ability.embed', 'local', { id: 'local' });
    reg.provide('e2', 'ability.embed', 'cloud', { id: 'cloud' });
    reg.bind('default', 'ability.embed', ['cloud', 'local'], 'profile');
    expect(reg.resolveAll<{ id: string }>('ability.embed').map((x) => x.id)).toEqual(['cloud', 'local']);
    reg.provide('b1', 'brain.provider', 'claude', { id: 'claude' });
    expect(() => reg.resolve('brain.provider')).toThrow(/指明 impl/);
    expect(reg.resolve<{ id: string }>('brain.provider', { impl: 'claude' }).id).toBe('claude');
  });
  it('builtin 的门面只能提供 manifest 声明过的槽位与实现 id', () => {
    const reg = new SlotRegistry();
    const effects: (() => void)[] = [];
    const facade = reg.providerFacade('p', new Map([['job.trigger', 'cron']]), (d) => effects.push(d));
    expect(() => facade.provide('memory.engine', 'x', {})).toThrow(/没有声明槽位/);
    expect(() => facade.provide('job.trigger', 'other', {})).toThrow(/实现 id 是 cron/);
    facade.provide('job.trigger', 'cron', { type: 'cron' });
    expect(effects).toHaveLength(1);
  });
  it('未实现的基数在登记时就报错', () => {
    const reg = new SlotRegistry();
    expect(() => reg.provide('g', 'gate.policy', 'x', {})).toThrow(/未实现/);
  });
});
