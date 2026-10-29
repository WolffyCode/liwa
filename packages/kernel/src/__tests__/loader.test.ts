// 走真实装配路径的测试（docs/architecture/modules/00-plugin-kernel.md §12）
import { describe, expect, it } from 'vitest';
import { z, type Journal, type PackageManifest, type Profile, type Services } from '@liwa/contracts';
import { fakeClock } from '../clock.js';
import { definePlugin, defineService } from '../plugin.js';
import { createTestKernel, dumpTestConfig, type FakePackage } from '../testing.js';

const M0: Profile['stage'] = 'm0';

const stub = <K extends keyof Services>(key: K): Services[K] => ({ __service: key }) as unknown as Services[K];

function fakeJournal(): Journal & { appended: unknown[] } {
  const appended: unknown[] = [];
  return {
    appended,
    append: async (req) => {
      appended.push(req);
      return { pos: String(appended.length), stream: req.stream, seq: appended.length, type: req.type, version: 1, actor: req.actor, at: '2026-01-01T00:00:00.000Z', source: req.source };
    },
    read: async () => [],
    subscribe: () => () => {},
    putPayload: async () => ({ id: 'p1' }),
  };
}

/** m0 阶段集合里的全部服务，用假实现填满 */
function m0Services(journal = fakeJournal()): Partial<Services> {
  return {
    journal,
    guard: stub('guard'),
    procs: { spawn: async () => ({ pid: 1, handle: 'h' }), kill: async () => {} },
    brains: stub('brains'),
    minds: stub('minds'),
    context: stub('context'),
    actions: stub('actions'),
    senses: stub('senses'),
    attention: stub('attention'),
    outbox: stub('outbox'),
    toolport: stub('toolport'),
    gateway: stub('gateway'),
  };
}

function pkg(id: string, liwa: Record<string, unknown>): PackageManifest {
  return { name: `@t/${id}`, version: '0.1.0', exports: { '.': './src/index.ts', './package.json': './package.json' }, liwa: { manifestVersion: 1, id, kind: 'builtin', ...liwa } } as PackageManifest;
}

/** 一个大脑适配器包：默认声明 brain.provider 的实现 x，consumes procs；extra 可覆盖 */
const brainPkg = (module: FakePackage['module'], extra: Record<string, unknown> = {}, name = 'brain-x', impl = 'x'): FakePackage => ({
  dir: `packages/plugins/${name}`,
  pkg: pkg(name, { provides: { 'brain.provider': { contract: 1, impl } }, consumes: { procs: 1 }, ...extra }),
  module,
});

/** 一个规规矩矩的大脑适配器：m0 的 brains 在装，profile 里至少要有一个 brain.provider */
const goodBrain = (): FakePackage => brainPkg({ plugin: definePlugin({ id: 'brain-x', apply(ctx) { ctx.slots.provide('brain.provider', 'x', {}); } }) });

const triggersPkg = (module: FakePackage['module']): FakePackage => ({
  dir: 'packages/plugins/job-triggers',
  pkg: pkg('job-triggers', { provides: { 'job.trigger': { contract: 1, impl: 'cron' } } }),
  module,
});

describe('五阶段 loader', () => {
  it('两个假插件经真实路径装进 m0：ready 接活、服务可取、写 kernel.started.v1、关闭时 drain 与释放逆序', async () => {
    const journal = fakeJournal();
    const trace: string[] = [];
    const brain = definePlugin({
      id: 'brain-x',
      Config: z.strictObject({ model: z.string().default('flash') }),
      inject: ['procs'] as const,
      apply(ctx, config) {
        trace.push(`apply:brain:${config.model}`);
        ctx.slots.provide('brain.provider', 'x', { async createSession() { return { handle: 'h' }; } });
        ctx.effect(() => () => { trace.push('cleanup:brain'); });
      },
      ready: () => { trace.push('ready:brain'); },
      drain: () => { trace.push('drain:brain'); },
    });
    const triggers = definePlugin({
      id: 'job-triggers',
      apply(ctx) {
        trace.push('apply:triggers');
        ctx.slots.provide('job.trigger', 'cron', { async next() { return null; } });
      },
      ready: () => { trace.push('ready:triggers'); },
      drain: () => { trace.push('drain:triggers'); },
    });
    const kernel = await createTestKernel({
      profile: { id: 'm0-test', stage: M0, plugins: [{ id: 'brain-x', package: '@t/brain-x', config: { model: 'deepseek' } }, { id: 'job-triggers', package: '@t/job-triggers' }] },
      fakeServices: m0Services(journal),
      packages: { '@t/brain-x': brainPkg({ plugin: brain }), '@t/job-triggers': triggersPkg({ plugin: triggers }) },
    });
    expect(kernel.plan.entries.filter((e) => e.status === 'enabled').map((e) => e.id)).toContain('brain-x');
    expect(kernel.plan.entries.find((e) => e.id === 'brain-x')?.kind).toBe('builtin');
    expect(kernel.plan.slots.find((s) => s.slot === 'brain.provider')?.providers).toEqual([{ impl: 'x', plugin: 'brain-x' }]);
    expect(trace).toEqual(['apply:brain:deepseek', 'apply:triggers', 'ready:brain', 'ready:triggers']);
    expect(kernel.service('procs')).toBeDefined();
    const started = journal.appended.find((e) => (e as { type: string }).type === 'kernel.started.v1') as { payload: { plugins: string[] } } | undefined;
    expect(started?.payload.plugins).toContain('brain-x');
    expect((await kernel.health())['brain-x']).toEqual({ ok: true });
    await kernel.shutdown('test');
    expect(trace.slice(4)).toEqual(['drain:triggers', 'drain:brain', 'cleanup:brain']);
    expect(() => kernel.service('procs')).toThrow(/不在装/);
  });

  it('契约版本不符的 builtin 被禁用并写明原因，不牵连别的插件；dump-config 只给计划不导入代码', () => {
    const neverImported = definePlugin({ id: 'brain-x', apply() { throw new Error('不该被导入'); } });
    const bad = brainPkg({ plugin: neverImported }, { provides: { 'brain.provider': { contract: 7, impl: 'x' } } });
    const good = brainPkg({ plugin: definePlugin({ id: 'brain-y', apply(ctx) { ctx.slots.provide('brain.provider', 'y', {}); } }) }, {}, 'brain-y', 'y');
    const plan = dumpTestConfig({
      profile: { id: 'm0-test', stage: M0, plugins: [{ id: 'brain-x', package: '@t/brain-x' }, { id: 'brain-y', package: '@t/brain-y' }] },
      fakeServices: m0Services(),
      packages: { '@t/brain-x': bad, '@t/brain-y': good },
    });
    const x = plan.entries.find((e) => e.id === 'brain-x');
    expect(x?.status).toBe('disabled');
    expect(x?.reason).toMatch(/契约版本 7/);
    expect(plan.entries.find((e) => e.id === 'brain-y')?.status).toBe('enabled');
    expect(plan.problems).toEqual([]);
    // 唯一的大脑适配器被禁用后，brains 在装却没有 brain.provider，就是致命问题
    const alone = dumpTestConfig({ profile: { id: 'm0-test', stage: M0, plugins: [{ id: 'brain-x', package: '@t/brain-x' }] }, fakeServices: m0Services(), packages: { '@t/brain-x': bad } });
    expect(alone.problems.some((p) => p.severity === 'fatal' && /brain\.provider/.test(p.message))).toBe(true);
  });

  it('阶段集合缺服务、required 条目带 package、绑定指向未声明的实现，都是致命问题', () => {
    const missing = dumpTestConfig({ profile: { id: 'x', stage: M0, plugins: [] }, fakeServices: { journal: fakeJournal() } });
    expect(missing.problems.some((p) => p.severity === 'fatal' && /要求在装的服务 guard/.test(p.message))).toBe(true);
    expect(() => dumpTestConfig({ profile: { id: 'x', stage: M0, plugins: [{ id: 'journal', package: '@evil/j' }] }, fakeServices: m0Services() })).toThrow(/不能带 package/);
    const bad = dumpTestConfig({ profile: { id: 'x', stage: M0, plugins: [], memberDefaults: { slots: { 'memory.engine': 'ghost' } } }, fakeServices: m0Services() });
    expect(bad.problems.some((p) => /ghost/.test(p.message))).toBe(true);
  });

  it('默认导出、inject 不在 consumes 里、apply 抛错、异步 Config 校验：builtin 一律禁用并写明原因，kernel 照样起来', async () => {
    const good = definePlugin({ id: 'job-triggers', apply(ctx) { ctx.slots.provide('job.trigger', 'cron', { next: async () => null }); } });
    const withDefault = definePlugin({ id: 'brain-x', apply(ctx) { ctx.slots.provide('brain.provider', 'x', {}); } });
    const mk = (name: string, impl: string, plugin: unknown, consumes: Record<string, number> = {}): FakePackage => brainPkg({ plugin }, { consumes }, name, impl);
    const kernel = await createTestKernel({
      profile: { id: 'm0-test', stage: M0, plugins: [
        { id: 'brain-x', package: '@t/brain-x' },
        { id: 'brain-y', package: '@t/brain-y' },
        { id: 'brain-z', package: '@t/brain-z' },
        { id: 'brain-w', package: '@t/brain-w' },
        { id: 'brain-v', package: '@t/brain-v' },
        { id: 'job-triggers', package: '@t/job-triggers' },
      ] },
      fakeServices: m0Services(),
      packages: {
        '@t/brain-x': brainPkg({ plugin: withDefault, default: withDefault }),
        '@t/brain-y': mk('brain-y', 'y', definePlugin({ id: 'brain-y', inject: ['procs'] as const, apply() {} })),
        '@t/brain-z': mk('brain-z', 'z', definePlugin({ id: 'brain-z', apply() { throw new Error('boom'); } })),
        '@t/brain-w': mk('brain-w', 'w', definePlugin({ id: 'brain-w', Config: z.strictObject({}).refine(async () => true), apply(ctx) { ctx.slots.provide('brain.provider', 'w', {}); } })),
        '@t/brain-v': mk('brain-v', 'v', definePlugin({ id: 'brain-v', apply(ctx) { ctx.slots.provide('brain.provider', 'v', {}); } })),
        '@t/job-triggers': triggersPkg({ plugin: good }),
      },
    });
    const reason = Object.fromEntries(kernel.plan.entries.map((e) => [e.id, e.status === 'disabled' ? (e.reason ?? '') : null]));
    expect(reason['brain-x']).toMatch(/默认导出/);
    expect(reason['brain-y']).toMatch(/consumes/);
    expect(reason['brain-z']).toMatch(/boom/);
    expect(reason['brain-w']).toMatch(/同步校验/);
    expect(reason['brain-v']).toBeNull();
    expect(reason['job-triggers']).toBeNull();
    expect(kernel.logger.entries.some((e) => e.level === 'error' && /boom/.test(JSON.stringify(e)))).toBe(true);
    await kernel.shutdown('test');
  });

  it('声明了槽位却没登记：没人需要时只禁用；必需槽位缺实现时启动失败', async () => {
    const lazy = definePlugin({ id: 'job-triggers', apply() {} });
    const plugins = [{ id: 'brain-x', package: '@t/brain-x' }, { id: 'job-triggers', package: '@t/job-triggers' }];
    const kernel = await createTestKernel({
      profile: { id: 'm0-test', stage: M0, plugins },
      fakeServices: m0Services(),
      packages: { '@t/brain-x': goodBrain(), '@t/job-triggers': triggersPkg({ plugin: lazy }) },
    });
    expect(kernel.plan.entries.find((e) => e.id === 'job-triggers')?.reason).toMatch(/没有登记/);
    expect(kernel.plan.entries.find((e) => e.id === 'brain-x')?.status).toBe('enabled');
    await kernel.shutdown('test');
    await expect(createTestKernel({
      profile: { id: 'm0-test', stage: M0, plugins },
      fakeServices: { ...m0Services(), scheduler: stub('scheduler') },
      packages: { '@t/brain-x': goodBrain(), '@t/job-triggers': triggersPkg({ plugin: lazy }) },
    })).rejects.toThrow(/job\.trigger/);
  });

  it('required 在启动时限内未就绪：假时钟推进后失败，列出每个未就绪插件在等的服务，关闭也不被卡死', async () => {
    const clock = fakeClock();
    const stuckGuard = defineService('guard', { create: () => new Promise<Services['guard']>(() => {}) });
    const mindsNeedsGuard = defineService('minds', { inject: ['guard'] as const, create: () => stub('minds') });
    const services = m0Services();
    delete services.guard;
    delete services.minds;
    const starting = createTestKernel({
      profile: { id: 'm0-test', stage: M0, plugins: [{ id: 'brain-x', package: '@t/brain-x' }] },
      fakeServices: services,
      required: [stuckGuard, mindsNeedsGuard],
      packages: { '@t/brain-x': goodBrain() },
      clock,
      startupTimeoutMs: 1_000,
      shutdownDeadlineMs: 2_000,
    });
    const outcome = starting.then(() => 'started', (e: unknown) => (e instanceof Error ? e.message : String(e)));
    await clock.advance(1_500);
    await clock.advance(5_000);
    const message = await outcome;
    expect(message).toMatch(/启动时限内未就绪/);
    expect(message).toMatch(/guard（缺：未知）/);
    expect(message).toMatch(/minds（缺：guard）/);
  });

  it('密钥引用在交给插件前解析；dump-config 与装配哈希只见引用', async () => {
    let seen: unknown;
    const brain = definePlugin({ id: 'brain-x', Config: z.strictObject({ key: z.string() }), apply(ctx, config) { seen = config.key; ctx.slots.provide('brain.provider', 'x', {}); } });
    const profile: Profile = { id: 'm0-test', stage: M0, plugins: [{ id: 'brain-x', package: '@t/brain-x', config: { key: { $secret: 'env:DEEPSEEK_KEY' } } }] };
    const plan = dumpTestConfig({ profile, fakeServices: m0Services(), packages: { '@t/brain-x': brainPkg({ plugin: brain }) } });
    expect(JSON.stringify(plan)).not.toContain('sk-live');
    const planAgain = dumpTestConfig({ profile, fakeServices: m0Services(), packages: { '@t/brain-x': brainPkg({ plugin: brain }) } });
    expect(planAgain.assemblyHash).toBe(plan.assemblyHash);
    const kernel = await createTestKernel({ profile, fakeServices: m0Services(), packages: { '@t/brain-x': brainPkg({ plugin: brain }) }, secrets: { resolve: async (ref) => (ref === 'env:DEEPSEEK_KEY' ? 'sk-live-123' : undefined) } });
    expect(seen).toBe('sk-live-123');
    await kernel.shutdown('test');
    // 密钥解析不到：builtin 被禁用并说明是哪个引用
    const broken = await createTestKernel({ profile: { ...profile, plugins: [...profile.plugins, { id: 'brain-y', package: '@t/brain-y' }] }, fakeServices: m0Services(), packages: { '@t/brain-x': brainPkg({ plugin: brain }), '@t/brain-y': brainPkg({ plugin: definePlugin({ id: 'brain-y', apply(ctx) { ctx.slots.provide('brain.provider', 'y', {}); } }) }, {}, 'brain-y', 'y') } });
    expect(broken.plan.entries.find((e) => e.id === 'brain-x')?.reason).toMatch(/env:DEEPSEEK_KEY/);
    expect(broken.plan.entries.find((e) => e.id === 'brain-y')?.status).toBe('enabled');
    await broken.shutdown('test');
  });
});
