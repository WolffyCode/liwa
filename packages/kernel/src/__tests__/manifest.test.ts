import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { checkManifest, deriveKind, findRepoRoot, pickPluginExport, type LocatedPackage } from '../manifest.js';
import { definePlugin } from '../plugin.js';

const root = '/liwa';
const located = (dir: string, liwa: Record<string, unknown>, exportsField: Record<string, unknown> | undefined = { '.': './src/index.ts', './package.json': './package.json' }): LocatedPackage => {
  const pkg = { name: '@t/x', version: '0.1.0', ...(exportsField ? { exports: exportsField } : {}), liwa } as unknown as LocatedPackage['pkg'];
  return { name: '@t/x', dir: `${root}/${dir}`, realDir: `${root}/${dir}`, pkg, raw: '{}' };
};

describe('种类按路径推导', () => {
  it('packages/plugins 是 builtin，packages/core 是 required，LIWA_HOME/plugins 是 external，别处不认', () => {
    expect(deriveKind(`${root}/packages/plugins/brain-x`, root, '/home')).toBe('builtin');
    expect(deriveKind(`${root}/packages/core`, root, '/home')).toBe('required');
    expect(deriveKind('/home/plugins/thing', root, '/home')).toBe('external');
    expect(() => deriveKind('/elsewhere/pkg', root, '/home')).toThrow(/无法推导种类/);
  });
});

describe('manifest 的静态检查', () => {
  const good = { manifestVersion: 1, id: 'brain-x', kind: 'builtin', provides: { 'brain.provider': { contract: 1, impl: 'x' } }, consumes: { procs: 1 } };
  it('合规的 builtin 没有问题', () => {
    expect(checkManifest(located('packages/plugins/brain-x', good), 'builtin')).toEqual([]);
  });
  it('种类不符、契约版本不符、缺 package.json 导出、冒充 required 都点名', () => {
    const problems = checkManifest(located('packages/plugins/brain-x', { ...good, kind: 'required', provides: { 'brain.provider': { contract: 2, impl: 'x' } }, consumes: { procs: 9 } }, { '.': './src/index.ts' }), 'builtin');
    expect(problems.join('\n')).toMatch(/种类是 required/);
    expect(problems.join('\n')).toMatch(/契约版本 2/);
    expect(problems.join('\n')).toMatch(/API 版本 9/);
    expect(problems.join('\n')).toMatch(/package\.json/);
    expect(problems.join('\n')).toMatch(/组合根以代码传入/);
  });
});

describe('入口导出', () => {
  const plugin = definePlugin({ id: 'brain-x', apply() {} });
  it('只认具名导出 plugin', () => {
    expect(pickPluginExport({ plugin }, 'x')).toBe(plugin);
    expect(() => pickPluginExport({ plugin, default: plugin }, 'x')).toThrow(/默认导出/);
    expect(() => pickPluginExport({ plugin: { id: 'fake' } }, 'x')).toThrow(/definePlugin/);
  });
});

describe('仓库根', () => {
  it('从任一目录向上找到含 pnpm-workspace.yaml 的目录；找不到就报错', () => {
    const root = findRepoRoot(import.meta.dirname);
    expect(existsSync(`${root}/pnpm-workspace.yaml`)).toBe(true);
    expect(() => findRepoRoot('/')).toThrow(/仓库根/);
  });
});
