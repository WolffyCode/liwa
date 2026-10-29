import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../profile.js';

const base = { id: 'p', stage: 'm0', plugins: [{ id: 'brain-x', package: '@t/brain-x', config: { a: 1 } }] };
const required = ['journal', 'procs'];

describe('profile 叠层', () => {
  it('required 自动补在最前，profile 只能给它们配 config', () => {
    const r = resolveProfile({ profile: { ...base, plugins: [{ id: 'journal', config: { wal: true } }, ...base.plugins] }, patches: {} }, required);
    expect(r.entries.map((e) => e.id)).toEqual(['journal', 'procs', 'brain-x']);
    expect(r.entries[0]?.config).toEqual({ wal: true });
  });
  it('required 条目带 package 或被禁用都拒绝', () => {
    expect(() => resolveProfile({ profile: { ...base, plugins: [{ id: 'journal', package: '@evil/journal' }] }, patches: {} }, required)).toThrow(/不能带 package/);
    expect(() => resolveProfile({ profile: base, patches: { local: [[{ disable: { id: 'journal' } }]] } }, required)).toThrow(/不能禁用/);
  });
  it('非 required 必须写 package；同 id 出现两次拒绝', () => {
    expect(() => resolveProfile({ profile: { ...base, plugins: [{ id: 'brain-y' }] }, patches: {} }, required)).toThrow(/必须写 package/);
    expect(() => resolveProfile({ profile: { ...base, plugins: [...base.plugins, ...base.plugins] }, patches: {} }, required)).toThrow(/出现了两次/);
  });
  it('四层叠加：replace 整体替换、disable / enable、bind；后层覆盖前层', () => {
    const r = resolveProfile(
      {
        profile: { ...base, memberDefaults: { slots: { 'memory.engine': 'default' } } },
        patches: {
          local: [[{ replace: { id: 'brain-x', config: { b: 2 } } }]],
          owner: [[{ disable: { id: 'brain-x' } }, { bind: { slot: 'memory.engine', binding: 'other' } }]],
          cli: [[{ enable: { id: 'brain-x' } }, { bind: { member: 'liwa', slot: 'ability.embed', binding: ['local', 'cloud'] } }]],
        },
      },
      required,
    );
    const x = r.entries.find((e) => e.id === 'brain-x');
    expect(x?.config).toEqual({ b: 2 });
    expect(x?.disabled).toBe(false);
    expect(x?.layer).toBe('cli');
    expect(r.bindings).toEqual([
      { scope: 'default', slot: 'memory.engine', binding: 'default', layer: 'profile' },
      { scope: 'default', slot: 'memory.engine', binding: 'other', layer: 'owner' },
      { scope: 'liwa', slot: 'ability.embed', binding: ['local', 'cloud'], layer: 'cli' },
    ]);
  });
  it('patch 不能装卸插件；指向不存在的 id 报错并说明层与条目；同层重复报错', () => {
    expect(() => resolveProfile({ profile: base, patches: { local: [[{ insert: { id: 'brain-y', package: '@t/y' } }]] } }, required)).toThrow(/第 local 层第 1 条.*insert/);
    expect(() => resolveProfile({ profile: base, patches: { cli: [[{ disable: { id: 'nope' } }]] } }, required)).toThrow(/第 cli 层第 1 条.*不在条目表/);
    expect(() => resolveProfile({ profile: base, patches: { local: [[{ disable: { id: 'brain-x' } }, { enable: { id: 'brain-x' } }]] } }, required)).toThrow(/同一层里/);
  });
  it('profile 拼错字段被拒', () => {
    expect(() => resolveProfile({ profile: { ...base, plugin: [] }, patches: {} }, required)).toThrow(/不合规范/);
  });
});
