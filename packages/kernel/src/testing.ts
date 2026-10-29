// 测试内核：走同一段五阶段代码，只多"内存里的包"和"假服务"两个注入点（docs/architecture/modules/00-plugin-kernel.md §11、§12）
import { pathToFileURL } from 'node:url';
import type { PackageManifest, Profile, ServiceKey, Services } from '@liwa/contracts';
import { fakeClock, type FakeClock } from './clock.js';
import { createIds } from './ids.js';
import { createMemoryLogger, type MemoryLogger } from './logger.js';
import { dumpConfig, prepareAssembly, startKernel, type StartOptions } from './loader.js';
import type { LocatedPackage, PackageResolver } from './manifest.js';
import { defineService } from './plugin.js';
import type { ProfileSource } from './profile.js';
import { createRng } from './rng.js';
import type { KernelHandle, PluginDef } from './types.js';

export interface FakePackage {
  /** 相对仓库根的目录，种类按它推导（packages/plugins/x → builtin） */
  dir: string;
  pkg: PackageManifest;
  module: { plugin?: unknown; default?: unknown };
}

export interface TestKernelOptions {
  /** 假的仓库根；组合根按惯例在 <root>/apps/liwa */
  root?: string;
  home?: string;
  profile: Profile;
  patches?: ProfileSource['patches'];
  required?: PluginDef[];
  /** 假服务：每个键包成一个 required 插件 */
  fakeServices?: Partial<Services>;
  packages?: Record<string, FakePackage>;
  clock?: FakeClock;
  logger?: MemoryLogger;
  startupTimeoutMs?: number;
  shutdownDeadlineMs?: number;
  secrets?: StartOptions['secrets'];
}

export function memoryResolver(root: string, packages: Record<string, FakePackage>): PackageResolver {
  return {
    locate(packageName) {
      const fake = packages[packageName];
      if (!fake) throw new Error(`测试包不存在：${packageName}`);
      const dir = `${root}/${fake.dir}`;
      const located: LocatedPackage = { name: packageName, dir, realDir: dir, pkg: fake.pkg, raw: JSON.stringify(fake.pkg) };
      return located;
    },
    async load(located) {
      const fake = packages[located.name];
      if (!fake) throw new Error(`测试包不存在：${located.name}`);
      return fake.module;
    },
  };
}

function fakeServiceDefs(fakeServices: Partial<Services>): PluginDef[] {
  return (Object.keys(fakeServices) as ServiceKey[]).map((key) =>
    defineService(key, {
      create: () => fakeServices[key] as Services[typeof key],
    }),
  );
}

export function testKernelOptions(options: TestKernelOptions): StartOptions & { clock: FakeClock; logger: MemoryLogger } {
  const root = options.root ?? '/liwa';
  const clock = options.clock ?? fakeClock();
  const logger = options.logger ?? createMemoryLogger();
  const required = [...(options.required ?? []), ...fakeServiceDefs(options.fakeServices ?? {})];
  return {
    root: pathToFileURL(`${root}/apps/liwa/`),
    repoRoot: root,
    home: options.home ?? '/liwa-home',
    profile: options.profile.id,
    required,
    logger,
    clock,
    rng: createRng('test'),
    ids: createIds(),
    startupTimeoutMs: options.startupTimeoutMs ?? 5_000,
    ...(options.shutdownDeadlineMs !== undefined ? { shutdownDeadlineMs: options.shutdownDeadlineMs } : {}),
    ...(options.secrets ? { secrets: options.secrets } : {}),
    resolver: memoryResolver(root, options.packages ?? {}),
    profileSource: { profile: options.profile, patches: options.patches ?? {} },
  };
}

export async function createTestKernel(options: TestKernelOptions): Promise<KernelHandle & { clock: FakeClock; logger: MemoryLogger }> {
  const opts = testKernelOptions(options);
  const handle = await startKernel(opts);
  return Object.assign(handle, { clock: opts.clock, logger: opts.logger });
}

export function dumpTestConfig(options: TestKernelOptions) {
  return dumpConfig(testKernelOptions(options));
}

export function prepareTestAssembly(options: TestKernelOptions) {
  return prepareAssembly(testKernelOptions(options));
}
