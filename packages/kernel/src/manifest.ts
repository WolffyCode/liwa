// manifest 的读取、种类推导、与契约版本比对（docs/architecture/modules/00-plugin-kernel.md §3、§5 第 1 阶段）
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONTRACT_VERSIONS, LiwaError, PackageManifest, SERVICE_VERSIONS, type PluginKind } from '@liwa/contracts';
import { isPluginDef } from './plugin.js';
import type { PluginDef } from './types.js';

/** 一个已定位的包 */
export interface LocatedPackage {
  readonly name: string;
  readonly dir: string;
  /** 解析符号链接后的真实目录，种类按它推导 */
  readonly realDir: string;
  readonly pkg: PackageManifest;
  /** package.json 原文，算内容摘要用 */
  readonly raw: string;
}

/** 包的定位与装载：生产用文件系统，测试用内存 */
export interface PackageResolver {
  locate(packageName: string): LocatedPackage;
  load(located: LocatedPackage, entry?: string): Promise<{ plugin?: unknown; default?: unknown }>;
}

export function readPackageManifest(dir: string): { pkg: PackageManifest; raw: string } {
  const file = resolvePath(dir, 'package.json');
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (cause) {
    throw new LiwaError('invalid_input', 'manifest.read', `读不到 ${file}`, { cause });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new LiwaError('invalid_input', 'manifest.json', `${file} 不是合法 JSON`, { cause });
  }
  const parsed = PackageManifest.safeParse(json);
  if (!parsed.success) {
    throw new LiwaError('invalid_input', 'manifest.schema', `${file} 的 liwa 字段不合规范：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`);
  }
  return { pkg: parsed.data, raw };
}

/** 按真实路径推导种类：仓库内的 plugins 是 builtin，$LIWA_HOME/plugins 是 external，其余不认 */
export function deriveKind(realDir: string, root: string, home: string): PluginKind {
  const rel = relative(root, realDir);
  if (!rel.startsWith('..') && !rel.startsWith(sep) && rel !== '') {
    const parts = rel.split(sep);
    if (parts[0] === 'packages' && (parts[1] === 'core' || parts[1] === 'kernel')) return 'required';
    if (parts[0] === 'packages' && parts[1] === 'plugins') return 'builtin';
  }
  const relHome = relative(resolvePath(home, 'plugins'), realDir);
  if (!relHome.startsWith('..') && relHome !== '') return 'external';
  throw new LiwaError('invalid_input', 'manifest.location', `包不在已知位置，无法推导种类：${realDir}`);
}

/** 从某个目录向上找仓库根：含 pnpm-workspace.yaml 的最近祖先 */
export function findRepoRoot(start: string): string {
  let dir = resolvePath(start);
  for (;;) {
    if (existsSync(resolvePath(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new LiwaError('invalid_input', 'repo.root', `从 ${start} 向上找不到仓库根（含 pnpm-workspace.yaml 的目录）`);
    dir = parent;
  }
}

/** 第 1 阶段对单个 manifest 的全部静态检查 */
export function checkManifest(located: LocatedPackage, derivedKind: PluginKind): string[] {
  const problems: string[] = [];
  const m = located.pkg.liwa;
  // data 插件没有代码，放在 builtin 或 external 的位置都行；其余种类必须和路径一致
  const locationOk = m.kind === 'data' ? derivedKind === 'builtin' || derivedKind === 'external' : m.kind === derivedKind;
  if (!locationOk) problems.push(`manifest 写的种类是 ${m.kind}，按路径推导是 ${derivedKind}`);
  if (m.kind === 'required') problems.push('required 插件不由 manifest 声明，必须由组合根以代码传入');
  if (m.kind === 'external' || derivedKind === 'external') problems.push('第一版不装仓库外的插件（external）');
  if (!located.pkg.exports || !('./package.json' in located.pkg.exports)) problems.push('exports 必须含 "./package.json"');
  for (const [slot, spec] of Object.entries(m.provides ?? {})) {
    const expected = CONTRACT_VERSIONS[slot as keyof typeof CONTRACT_VERSIONS];
    if (spec && spec.contract !== expected) problems.push(`槽位 ${slot} 的契约版本 ${spec.contract} 与本体的 ${expected} 不符`);
  }
  for (const [key, version] of Object.entries(m.consumes ?? {})) {
    const expected = SERVICE_VERSIONS[key as keyof typeof SERVICE_VERSIONS];
    if (version !== expected) problems.push(`服务 ${key} 的 API 版本 ${version} 与本体的 ${expected} 不符`);
  }
  if (m.kind === 'data' && !m.data) problems.push('data 插件必须声明 data 字段');
  if (m.kind !== 'data' && m.data) problems.push('只有 data 插件能声明 data 字段');
  return problems;
}

/** 从入口模块里取 plugin：只认具名导出 plugin，出现默认导出即拒绝 */
export function pickPluginExport(mod: { plugin?: unknown; default?: unknown }, where: string): PluginDef {
  if (mod.default !== undefined) {
    throw new LiwaError('invalid_input', 'entry.default_export', `${where} 用了默认导出；插件入口必须是具名导出 plugin`);
  }
  if (!isPluginDef(mod.plugin)) {
    throw new LiwaError('invalid_input', 'entry.no_plugin', `${where} 没有导出经 definePlugin 产生的 plugin`);
  }
  return mod.plugin;
}

/** 生产用的解析器：以组合根为解析根，用 Node 的包解析规则 */
export function fileSystemResolver(root: URL): PackageResolver {
  const require = createRequire(root);
  return {
    locate(packageName) {
      let manifestPath: string;
      try {
        manifestPath = require.resolve(`${packageName}/package.json`);
      } catch (cause) {
        throw new LiwaError('invalid_input', 'package.unresolved', `解析不到包 ${packageName}（从 ${fileURLToPath(root)} 起）`, { cause });
      }
      const dir = dirname(manifestPath);
      const realDir = realpathSync(dir);
      const { pkg, raw } = readPackageManifest(dir);
      return { name: packageName, dir, realDir, pkg, raw };
    },
    async load(located, entry) {
      const target = entry ? resolvePath(located.dir, entry) : require.resolve(located.name);
      return (await import(pathToFileURL(target).href)) as { plugin?: unknown; default?: unknown };
    },
  };
}
