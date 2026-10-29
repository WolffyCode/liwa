// 五阶段 loader：计划校验 → 注册 → 恢复 → 槽位就绪 → 开放业务（docs/architecture/modules/00-plugin-kernel.md §5）
import { Context } from 'cordis';
import type { Fiber, Plugin as CordisPlugin } from 'cordis';
import { fileURLToPath } from 'node:url';
import {
  AUDIENCE_OWNER,
  CONTRACT_VERSIONS,
  LiwaError,
  SLOT_DEFS,
  STAGE_SETS,
  kernelStarted,
  type AssemblyPlan,
  type EntryPlan,
  type Journal,
  type ServiceKey,
  type Services,
  type SlotName,
  type Stage,
} from '@liwa/contracts';
import { canonicalJson, sha256 } from './assembly.js';
import { systemClock } from './clock.js';
import { createFacade } from './context.js';
import { KernelEmitter } from './events.js';
import { buildServiceGraph, type GraphNode } from './graph.js';
import { createIds } from './ids.js';
import { attachCordisLogger, createConsoleLogger } from './logger.js';
import { checkManifest, deriveKind, fileSystemResolver, findRepoRoot, pickPluginExport, type LocatedPackage, type PackageResolver } from './manifest.js';
import { readProfileSource, resolveProfile, type ProfileSource, type ResolvedEntry } from './profile.js';
import { createRng } from './rng.js';
import { noSecrets, redactSecrets, resolveSecrets } from './secrets.js';
import { SlotRegistry } from './slots.js';
import type { Clock, Health, Ids, KernelContext, KernelHandle, Logger, PluginDef, Rng, SecretResolver, StageSets } from './types.js';

/** cordis 的 FiberState 是 const enum，isolatedModules 下跨包拿不到运行时值，这里按源码对照写死 */
const FIBER = { PENDING: 0, LOADING: 1, ACTIVE: 2, FAILED: 3, DISPOSED: 4, UNLOADING: 5 } as const;

/** 启动期禁用一个 builtin 时最多等它释放这么久：cordis 不能打断在途的 apply，卡住的插件不能拖住启动 */
const DISABLE_DISPOSE_MS = 5_000;

export interface StartOptions {
  /** 组合根（apps/liwa）的 URL：插件包按 Node 的包解析规则从这里找 */
  root: URL;
  /** 仓库根：profiles/ 与 packages/ 所在目录；缺省从 root 向上找含 pnpm-workspace.yaml 的目录 */
  repoRoot?: string;
  home: string;
  profile: string;
  patches?: string[];
  required: PluginDef[];
  stageSets?: StageSets;
  logger?: Logger;
  secrets?: SecretResolver;
  clock?: Clock;
  rng?: Rng;
  ids?: Ids;
  startupTimeoutMs?: number;
  shutdownDeadlineMs?: number;
  /** 测试内核注入 */
  resolver?: PackageResolver;
  profileSource?: ProfileSource;
}

interface PreparedEntry {
  entry: ResolvedEntry;
  kind: EntryPlan['kind'];
  def?: PluginDef;
  located?: LocatedPackage;
  /** 槽位 → 实现 id（含 as 覆盖） */
  provides: Map<SlotName, string>;
  consumes: ServiceKey[];
  service?: ServiceKey;
  subEntry?: string;
  problems: string[];
}

interface Prepared {
  plan: AssemblyPlan;
  stage: Stage;
  entries: PreparedEntry[];
  order: string[];
  resolved: ReturnType<typeof resolveProfile>;
}

interface Mounted {
  prepared: PreparedEntry;
  def: PluginDef;
  fiber: Fiber;
  facade: KernelContext<ServiceKey>;
}

class Kernel {
  private readonly log: Logger;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly ids: Ids;
  private readonly secrets: SecretResolver;
  private readonly resolver: PackageResolver;
  private readonly stageSets: StageSets;
  private readonly repoRoot: string;
  private readonly registry = new SlotRegistry();
  private readonly emitter: KernelEmitter;
  private readonly services = new Map<ServiceKey, object>();
  private readonly mounted = new Map<string, Mounted>();
  private readonly fiberIds = new Map<Fiber, string>();
  /** apply 里抛出的错误，按插件 id 记下来，禁用原因与启动失败原因都从这里取 */
  private readonly failures = new Map<string, unknown>();
  private root: Context | undefined;
  private detachLogger: (() => Promise<void>) | undefined;
  private shuttingDown: Promise<void> | undefined;

  constructor(private readonly opts: StartOptions) {
    this.log = opts.logger ?? createConsoleLogger();
    this.clock = opts.clock ?? systemClock();
    this.rng = opts.rng ?? createRng(`liwa:${opts.profile}`);
    this.ids = opts.ids ?? createIds();
    this.secrets = opts.secrets ?? noSecrets;
    this.resolver = opts.resolver ?? fileSystemResolver(opts.root);
    this.stageSets = opts.stageSets ?? STAGE_SETS;
    this.repoRoot = opts.repoRoot ?? findRepoRoot(fileURLToPath(opts.root));
    this.emitter = new KernelEmitter(this.log);
  }

  // ---------- 第 1 阶段：计划校验 ----------
  prepare(): Prepared {
    const requiredIds = this.opts.required.map((d) => d.id);
    for (const def of this.opts.required) {
      if (def.kind !== 'required' || !def.service) throw new LiwaError('invalid_input', 'required.kind', `传给 startKernel 的 ${def.id} 不是 defineService 的产物`);
      if (def.id !== def.service) throw new LiwaError('invalid_input', 'required.id', `required 插件 ${def.id} 的 id 必须等于它提供的服务键 ${def.service}`);
    }
    if (new Set(requiredIds).size !== requiredIds.length) throw new LiwaError('invalid_input', 'required.duplicate', 'required 插件 id 重复');

    const source = this.opts.profileSource ?? readProfileSource({ root: this.repoRoot, home: this.opts.home, profile: this.opts.profile, ...(this.opts.patches ? { cliPatches: this.opts.patches } : {}) });
    const resolved = resolveProfile(source, requiredIds);
    const stage = resolved.profile.stage;
    const problems: AssemblyPlan['problems'] = [];

    const presentServices = new Set<ServiceKey>(this.opts.required.map((d) => d.service as ServiceKey));
    for (const key of this.stageSets[stage]) {
      if (!presentServices.has(key)) problems.push({ severity: 'fatal', message: `阶段 ${stage} 要求在装的服务 ${key} 没有传入` });
    }

    const entries: PreparedEntry[] = [];
    const implSeen = new Map<SlotName, Map<string, string>>();
    for (const entry of resolved.entries) {
      const def = this.opts.required.find((d) => d.id === entry.id);
      if (def) {
        const p: PreparedEntry = { entry, kind: 'required', def, provides: new Map(), consumes: [...def.inject], problems: [] };
        if (def.service) p.service = def.service;
        entries.push(p);
        continue;
      }
      const p: PreparedEntry = { entry, kind: 'builtin', provides: new Map(), consumes: [], problems: [] };
      try {
        const located = this.resolver.locate(entry.package as string);
        p.located = located;
        const kind = deriveKind(located.realDir, this.repoRoot, this.opts.home);
        const manifest = located.pkg.liwa;
        p.kind = manifest.kind === 'data' ? 'data' : kind === 'required' ? 'builtin' : kind;
        p.problems.push(...checkManifest(located, kind));
        if (manifest.id !== entry.id) p.problems.push(`profile 里的 id ${entry.id} 和 manifest 的 ${manifest.id} 不一致`);
        if (entry.as !== undefined && manifest.multiInstance !== true) p.problems.push('用了 as: 改实现 id，但 manifest 没有声明 multiInstance');
        for (const [slot, spec] of Object.entries(manifest.provides ?? {})) {
          if (!spec) continue;
          const impl = entry.as ?? spec.impl;
          p.provides.set(slot as SlotName, impl);
          const seen = implSeen.get(slot as SlotName) ?? new Map<string, string>();
          const other = seen.get(impl);
          if (other && !entry.disabled) p.problems.push(`槽位 ${slot} 的实现 ${impl} 已由 ${other} 声明`);
          if (!entry.disabled) seen.set(impl, entry.id);
          implSeen.set(slot as SlotName, seen);
        }
        p.consumes = Object.keys(manifest.consumes ?? {}) as ServiceKey[];
      } catch (error) {
        p.problems.push(error instanceof Error ? error.message : String(error));
      }
      if (p.problems.length > 0 && !entry.disabled) {
        entry.disabled = true;
        entry.reason = p.problems.join('；');
      }
      entries.push(p);
    }

    // 静态服务图：required 全部参与，builtin 只作为消费方
    const nodes: GraphNode[] = entries
      .filter((p) => !p.entry.disabled)
      .map((p) => (p.service ? { id: p.entry.id, service: p.service, consumes: p.consumes } : { id: p.entry.id, consumes: p.consumes }));
    const graph = buildServiceGraph(nodes);
    for (const m of graph.missing) {
      const wanted = entries.find((p) => p.entry.id === m.wantedBy);
      if (wanted?.kind === 'required') problems.push({ severity: 'fatal', entry: m.wantedBy, message: `required 插件 ${m.wantedBy} 依赖的服务 ${m.service} 没有提供方` });
      else if (wanted && !wanted.entry.disabled) {
        wanted.entry.disabled = true;
        wanted.entry.reason = `依赖的服务 ${m.service} 没有提供方`;
      }
    }
    if (graph.cycles.length > 0) problems.push({ severity: 'fatal', message: `服务图成环或重复提供：${graph.cycles.map((c) => c.join(' → ')).join('；')}` });

    // 绑定：impl 必须在条目表里、enabled 且声明了该槽位
    for (const b of resolved.bindings) {
      this.registry.bind(b.scope, b.slot, b.binding, b.layer);
      const impls = b.binding === null ? [] : Array.isArray(b.binding) ? b.binding : [b.binding];
      for (const impl of impls) {
        const ok = entries.some((p) => !p.entry.disabled && p.provides.get(b.slot) === impl);
        if (!ok) problems.push({ severity: 'fatal', message: `绑定 ${b.scope}.${b.slot} → ${impl}：没有已启用的插件声明这个实现` });
      }
    }

    const declared = new Map<SlotName, { impl: string; plugin: string }[]>();
    for (const p of entries) {
      if (p.entry.disabled) continue;
      for (const [slot, impl] of p.provides) declared.set(slot, [...(declared.get(slot) ?? []), { impl, plugin: p.entry.id }]);
    }
    const slots = this.registry.plan(presentServices, declared);
    for (const s of slots) if (!s.satisfied) problems.push({ severity: 'fatal', message: `服务 ${s.requiredBy} 在装，但槽位 ${s.slot} 没有可用实现或缺默认绑定` });

    const entryPlans: EntryPlan[] = entries.map((p) => {
      const plan: EntryPlan = {
        id: p.entry.id,
        kind: p.kind,
        status: p.entry.disabled ? 'disabled' : 'enabled',
        layer: p.kind === 'required' ? 'required' : p.entry.layer,
        provides: [...p.provides].map(([slot, impl]) => ({ slot, impl, contract: CONTRACT_VERSIONS[slot] })),
        consumes: p.consumes,
      };
      if (p.entry.package) plan.package = p.entry.package;
      if (p.located) {
        plan.version = p.located.pkg.version;
        plan.digest = sha256(p.located.raw);
      }
      if (p.entry.reason) plan.reason = p.entry.reason;
      if (p.service) plan.service = p.service;
      return plan;
    });
    const hashInput = {
      profile: resolved.profile.id,
      stage,
      entries: entryPlans.map((e) => ({ ...e, config: redactSecrets(entries.find((p) => p.entry.id === e.id)?.entry.config) })),
      bindings: resolved.bindings,
      contracts: CONTRACT_VERSIONS,
    };
    const plan: AssemblyPlan = { profile: resolved.profile.id, stage, entries: entryPlans, services: graph, slots, problems, assemblyHash: sha256(canonicalJson(hashInput)) };
    return { plan, stage, entries, order: graph.order, resolved };
  }

  // ---------- 第 2 阶段：注册 ----------
  private async register(prepared: Prepared): Promise<void> {
    const root = new Context();
    this.root = root;
    this.detachLogger = attachCordisLogger(root, this.log.child({ source: 'cordis' }));
    root.on('internal/status', (fiber, oldValue) => {
      const id = this.fiberIds.get(fiber);
      if (!id) return;
      const state = fiber.state as number;
      this.log.debug({ plugin: id, from: oldValue as number, to: state }, 'fiber 状态变化');
      if (state === FIBER.FAILED) this.emitter.emit('plugin/failed', id, this.failures.get(id) ?? 'fiber FAILED');
    });

    const byId = new Map(prepared.entries.map((p) => [p.entry.id, p] as const));
    const presentServices = new Set<string>(prepared.entries.filter((p) => p.service).map((p) => p.service as string));
    const timeoutMs = this.opts.startupTimeoutMs ?? 20_000;
    const startedAt = this.clock.mono();
    const remaining = (): number => Math.max(1, timeoutMs - (this.clock.mono() - startedAt));

    // required：按拓扑序挂载，全部就绪才往下走；任一失败即启动失败
    for (const id of prepared.order) {
      const p = byId.get(id);
      if (!p || p.kind !== 'required' || !p.def) continue;
      const config = this.validateConfig(p.def, await resolveSecrets(p.entry.config ?? {}, this.secrets));
      this.mountPlugin(root, p, p.def, config, presentServices);
    }
    const requiredFibers = [...this.mounted.values()].filter((m) => m.def.kind === 'required').map((m) => m.fiber);
    await this.awaitState(requiredFibers, remaining(), 'required', (pending) => {
      const detail = pending.map((f) => `${this.fiberIds.get(f)}（缺：${this.missingDeps(f).join('、') || '未知'}）`).join('；');
      return new LiwaError('internal', 'startup.timeout', `required 插件在启动时限内未就绪：${detail}`);
    });

    // builtin：按 profile 顺序逐个挂载并等它落定（apply 只做登记，不该耗时）；任何失败只禁用它自己
    for (const p of prepared.entries) {
      if (p.kind !== 'builtin' || p.entry.disabled) continue;
      try {
        const located = p.located as LocatedPackage;
        const mod = await this.resolver.load(located, p.subEntry);
        const def = pickPluginExport(mod, located.name);
        if (def.id !== p.entry.id) throw new LiwaError('invalid_input', 'entry.id', `${located.name} 导出的插件 id 是 ${def.id}，profile 里是 ${p.entry.id}`);
        if (def.kind !== 'builtin') throw new LiwaError('invalid_input', 'entry.kind', `${located.name} 是 builtin 包，却导出了 defineService 的产物`);
        const undeclared = def.inject.filter((key) => !p.consumes.includes(key));
        if (undeclared.length > 0) throw new LiwaError('invalid_input', 'entry.inject', `${located.name} 的 inject ${undeclared.join('、')} 不在 manifest 的 consumes 里`);
        const config = this.validateConfig(def, await resolveSecrets(p.entry.config ?? {}, this.secrets));
        const m = this.mountPlugin(root, p, def, config, presentServices);
        await this.awaitState([m.fiber], remaining(), 'settled', () => new LiwaError('internal', 'startup.timeout', `插件 ${p.entry.id} 的 apply 在启动时限内没有结束`));
        if ((m.fiber.state as number) !== FIBER.ACTIVE) throw new LiwaError('internal', 'apply.failed', `apply 抛错：${this.failureMessage(p.entry.id)}`);
      } catch (error) {
        await this.disableEntry(p, error instanceof Error ? error.message : String(error));
      }
    }
  }

  /** Config 由 kernel 同步校验：错误进禁用原因或启动失败原因，而不是只进 cordis 的日志 */
  private validateConfig(def: PluginDef, config: unknown): unknown {
    const schema = def.Config;
    if (!schema) return config;
    const result = (() => {
      try {
        return schema.safeParse(config);
      } catch (error) {
        throw new LiwaError('invalid_input', 'config.invalid', `${def.id} 的 Config 校验抛错（只支持同步校验，不能用 async refine）：${String(error)}`);
      }
    })();
    if (!result.success) {
      const detail = result.error.issues.map((i) => `${i.path.map(String).join('.') || '(根)'}: ${i.message}`).join('；');
      throw new LiwaError('invalid_input', 'config.invalid', `${def.id} 的 config 不合规范：${detail}`);
    }
    return result.data;
  }

  private mountPlugin(root: Context, p: PreparedEntry, def: PluginDef, config: unknown, presentServices: ReadonlySet<string>): Mounted {
    const id = p.entry.id;
    const pluginLog = this.log.child({ plugin: id });
    const mounted: Mounted = { prepared: p, def, fiber: undefined as unknown as Fiber, facade: undefined as unknown as KernelContext<ServiceKey> };
    const plugin: CordisPlugin.Object<unknown> = {
      name: id,
      inject: [...def.inject],
      apply: async (raw) => {
        try {
          const registerEffect = (dispose: () => void): void => {
            raw.effect(() => dispose, `${id}:slot`);
          };
          const slots = def.kind === 'required' ? this.registry.hostFacade(id, registerEffect, presentServices) : this.registry.providerFacade(id, p.provides, registerEffect);
          mounted.facade = createFacade({ pluginId: id, raw, inject: def.inject, clock: this.clock, rng: this.rng.fork(`plugin:${id}`), ids: this.ids, log: pluginLog, slots, events: this.emitter });
          await def.mount(mounted.facade, config, (instance) => {
            if (!def.service) throw new LiwaError('internal', 'service.publish', `${id} 不是 required 却要发布服务`);
            Object.freeze(instance);
            this.services.set(def.service, instance);
            raw.provide(def.service, instance);
            raw.effect(() => () => {
              this.services.delete(def.service as ServiceKey);
            }, `${id}:service`);
          });
        } catch (error) {
          this.failures.set(id, error);
          throw error;
        }
      },
    };
    // config 已由 validateConfig 校验并填好默认值，这里不再给 cordis 挂 Config
    mounted.fiber = root.plugin(plugin, config);
    this.fiberIds.set(mounted.fiber, id);
    this.mounted.set(id, mounted);
    this.emitter.emit('plugin/loaded', id);
    return mounted;
  }

  private failureMessage(id: string): string {
    const error = this.failures.get(id);
    if (error === undefined) return '见日志';
    return error instanceof Error ? error.message : String(error);
  }

  private missingDeps(fiber: Fiber): string[] {
    const id = this.fiberIds.get(fiber);
    const m = id ? this.mounted.get(id) : undefined;
    if (!m) return [];
    return m.def.inject.filter((key) => !this.services.has(key));
  }

  /**
   * mode = 'required'：全部 ACTIVE 才算成功，任一 FAILED 立即失败；
   * mode = 'settled'：全部进入 ACTIVE 或 FAILED 即返回（builtin 的失败由调用方按禁用处理）。
   */
  private awaitState(fibers: Fiber[], timeoutMs: number, mode: 'required' | 'settled', onTimeout: (pending: Fiber[]) => Error): Promise<void> {
    if (fibers.length === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const root = this.root as Context;
      const isActive = (f: Fiber): boolean => (f.state as number) === FIBER.ACTIVE;
      const isSettled = (f: Fiber): boolean => isActive(f) || (f.state as number) === FIBER.FAILED;
      const check = (): boolean => {
        if (mode === 'required') {
          const failed = fibers.find((f) => (f.state as number) === FIBER.FAILED);
          if (failed) {
            cleanup();
            const id = this.fiberIds.get(failed) ?? '?';
            reject(new LiwaError('internal', 'startup.failed', `required 插件 ${id} 启动失败：${this.failureMessage(id)}`));
            return true;
          }
        }
        if (fibers.every(mode === 'required' ? isActive : isSettled)) {
          cleanup();
          resolve();
          return true;
        }
        return false;
      };
      const off = root.on('internal/status', () => {
        queueMicrotask(() => {
          check();
        });
      });
      const cancelTimer = this.clock.timer(timeoutMs, () => {
        if (check()) return;
        cleanup();
        reject(onTimeout(fibers.filter((f) => !isActive(f))));
      });
      const cleanup = (): void => {
        off();
        cancelTimer();
      };
      if (!check()) {
        // 让 cordis 的异步装载先跑一轮再检查
        void Promise.resolve().then(() => check());
      }
    });
  }

  private async disableEntry(p: PreparedEntry, reason: string): Promise<void> {
    const m = this.mounted.get(p.entry.id);
    if (m) {
      await this.disable(m, reason);
      return;
    }
    p.entry.disabled = true;
    p.entry.reason = reason;
    this.log.warn({ plugin: p.entry.id, reason }, '插件被禁用');
    this.emitter.emit('plugin/disabled', p.entry.id, reason);
  }

  private async disable(m: Mounted, reason: string): Promise<void> {
    this.log.warn({ plugin: m.def.id, reason }, '插件被禁用');
    m.prepared.entry.disabled = true;
    m.prepared.entry.reason = reason;
    this.mounted.delete(m.def.id);
    await this.bounded(m.def.id, 'dispose', this.clock.mono() + DISABLE_DISPOSE_MS, () => m.fiber.dispose());
    this.failures.delete(m.def.id);
    this.emitter.emit('plugin/disabled', m.def.id, reason);
  }

  // ---------- 第 3 阶段：恢复 ----------
  private async recover(prepared: Prepared): Promise<void> {
    for (const id of prepared.order) {
      const m = this.mounted.get(id);
      if (!m || m.def.kind !== 'required') continue;
      await m.def.hooks.recover?.(m.facade);
    }
  }

  // ---------- 第 4 阶段：槽位就绪 ----------
  private async slotReadiness(prepared: Prepared): Promise<void> {
    for (const m of [...this.mounted.values()]) {
      if (m.def.kind === 'required') continue;
      for (const [slot, impl] of m.prepared.provides) {
        const actual = this.registry.activeProviders(slot).some((x) => x.impl === impl && x.plugin === m.def.id);
        if (!actual) await this.disable(m, `manifest 声明了槽位 ${slot} 的实现 ${impl}，apply 里没有登记`);
      }
    }
    const present = new Set<string>(prepared.entries.filter((p) => p.service && this.mounted.has(p.entry.id)).map((p) => p.service as string));
    for (const plan of this.registry.plan(present)) {
      if (!plan.satisfied) throw new LiwaError('unavailable', 'slot.required', `服务 ${plan.requiredBy} 在装，但槽位 ${plan.slot} 没有可用实现`);
    }
  }

  // ---------- 第 5 阶段：开放业务 ----------
  private async ready(prepared: Prepared): Promise<void> {
    const order = [...prepared.order.filter((id) => this.mounted.get(id)?.def.kind === 'required'), ...[...this.mounted.keys()].filter((id) => this.mounted.get(id)?.def.kind !== 'required')];
    for (const id of order) {
      const m = this.mounted.get(id);
      if (!m) continue;
      try {
        await m.def.hooks.ready?.(m.facade);
      } catch (error) {
        if (m.def.kind === 'required') throw new LiwaError('internal', 'ready.failed', `required 插件 ${id} 的 ready 抛错：${error instanceof Error ? error.message : String(error)}`, { cause: error });
        await this.disable(m, `ready 抛错：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.emitter.emit('kernel/started', { profile: prepared.plan.profile, stage: prepared.stage, assemblyHash: prepared.plan.assemblyHash });
    const journal = this.services.get('journal') as Journal | undefined;
    if (journal) {
      try {
        await journal.append({
          stream: { kind: 'system', id: 'system' },
          type: kernelStarted.type,
          actor: 'system',
          payload: { profile: prepared.plan.profile, stage: prepared.stage, assemblyHash: prepared.plan.assemblyHash, plugins: [...this.mounted.keys()] },
          source: { audienceId: AUDIENCE_OWNER, sourceKind: 'system', trust: 1, taint: false },
        });
      } catch (error) {
        this.log.error({ error: String(error) }, '写 kernel.started.v1 失败');
      }
    }
  }

  async start(): Promise<KernelHandle> {
    const prepared = this.prepare();
    const fatal = prepared.plan.problems.filter((p) => p.severity === 'fatal');
    if (fatal.length > 0) throw new LiwaError('invalid_input', 'plan.fatal', `装配计划有 ${fatal.length} 处致命问题：${fatal.map((p) => p.message).join('；')}`);
    try {
      await this.register(prepared);
      await this.recover(prepared);
      await this.slotReadiness(prepared);
      await this.ready(prepared);
    } catch (error) {
      await this.shutdown('启动失败');
      throw error;
    }
    const present = new Set<string>([...this.mounted.values()].map((m) => m.def.service).filter((s): s is ServiceKey => s !== undefined));
    const entries = prepared.entries.map((p) => {
      const base = prepared.plan.entries.find((e) => e.id === p.entry.id) as EntryPlan;
      const entry: EntryPlan = { ...base, status: p.entry.disabled ? 'disabled' : 'enabled' };
      if (p.entry.reason) entry.reason = p.entry.reason;
      return entry;
    });
    const plan: AssemblyPlan = { ...prepared.plan, entries, slots: this.registry.plan(present) };
    this.log.info({ profile: plan.profile, stage: plan.stage, hash: plan.assemblyHash, plugins: [...this.mounted.keys()] }, 'kernel 已启动');
    return {
      plan,
      health: () => this.health(),
      shutdown: (reason) => this.shutdown(reason),
      service: <K extends ServiceKey>(key: K) => {
        const instance = this.services.get(key);
        if (!instance) throw new LiwaError('unavailable', 'service.missing', `服务 ${key} 不在装`);
        return instance as Services[K];
      },
    };
  }

  private async health(): Promise<Record<string, Health>> {
    const out: Record<string, Health> = {};
    for (const [id, m] of this.mounted) {
      try {
        out[id] = (await m.def.hooks.health?.()) ?? { ok: true };
      } catch (error) {
        out[id] = { ok: false, reason: String(error) };
      }
    }
    return out;
  }

  shutdown(reason: string): Promise<void> {
    this.shuttingDown ??= this.doShutdown(reason);
    return this.shuttingDown;
  }

  /** 排空与释放都按挂载的逆序，每一步都受全局截止约束：卡住的插件只会被记一笔，不能拖住整个关闭 */
  private async doShutdown(reason: string): Promise<void> {
    const deadline = this.clock.mono() + (this.opts.shutdownDeadlineMs ?? 45_000);
    this.log.info({ reason }, 'kernel 开始关闭');
    const order = [...this.mounted.values()].reverse();
    for (const m of order) {
      if (!m.def.hooks.drain) continue;
      await this.bounded(m.def.id, 'drain', deadline, () => m.def.hooks.drain?.(m.facade, deadline));
    }
    for (const m of order) {
      await this.bounded(m.def.id, 'dispose', deadline, () => m.fiber.dispose());
    }
    this.mounted.clear();
    this.services.clear();
    this.failures.clear();
    await this.detachLogger?.();
    this.root = undefined;
  }

  /** 在截止之前等一步动作；超时或抛错只记日志，不影响后面的插件 */
  private bounded(plugin: string, step: string, deadline: number, run: () => unknown): Promise<void> {
    const remaining = deadline - this.clock.mono();
    if (remaining <= 0) {
      this.log.error({ plugin, step }, '已超过全局截止，跳过');
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let done = false;
      const cancel = this.clock.timer(remaining, () => {
        if (done) return;
        done = true;
        this.log.error({ plugin, step }, '超过全局截止，不再等它');
        resolve();
      });
      const finish = (): void => {
        if (done) return;
        done = true;
        cancel();
        resolve();
      };
      Promise.resolve()
        .then(run)
        .then(finish, (error: unknown) => {
          this.log.error({ plugin, step, error: String(error) }, `${step} 抛错`);
          finish();
        });
    });
  }
}

export async function startKernel(opts: StartOptions): Promise<KernelHandle> {
  return new Kernel(opts).start();
}

/** 只跑第 1 阶段，不导入业务代码 */
export function dumpConfig(opts: StartOptions): AssemblyPlan {
  return new Kernel(opts).prepare().plan;
}

/** 给测试与工具：第 1 阶段的全部中间结果 */
export function prepareAssembly(opts: StartOptions): { plan: AssemblyPlan; order: string[] } {
  const prepared = new Kernel(opts).prepare();
  return { plan: prepared.plan, order: prepared.order };
}

export { SLOT_DEFS };
