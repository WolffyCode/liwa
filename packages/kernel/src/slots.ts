// 槽位注册表：基数、绑定、带代际的句柄（docs/architecture/modules/00-plugin-kernel.md §6）
import { Binding, LiwaError, SLOT_DEFS, SLOT_NAMES, type PatchLayer, type SlotDef, type SlotName, type SlotPlan } from '@liwa/contracts';
import type { HostSlots, ProviderSlots, SlotQuery } from './types.js';

interface Provider {
  impl: string;
  plugin: string;
  instance?: object;
  factory?: (member: string) => object;
  perMember: Map<string, object>;
  generation: number;
  active: boolean;
  order: number;
}

interface BindingRecord {
  binding: Binding;
  layer: string;
}

const unavailable = (slot: SlotName, detail: string) => new LiwaError('unavailable', 'slot.unresolved', `槽位 ${slot} 解析不到：${detail}`);

/** 返回带代际检查的代理：提供方失效或重启后旧句柄一律失败 */
function handleFor(slot: SlotName, provider: Provider, instance: object): object {
  const generation = provider.generation;
  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (!provider.active || provider.generation !== generation) {
        throw new LiwaError('unavailable', 'slot.stale_handle', `槽位 ${slot} 的实现 ${provider.impl} 已失效，句柄不能再用`);
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export class SlotRegistry {
  private readonly providers = new Map<SlotName, Map<string, Provider>>();
  private readonly bindings = new Map<string, Map<SlotName, BindingRecord>>();
  private order = 0;

  constructor(private readonly defs: Readonly<Record<SlotName, SlotDef>> = SLOT_DEFS) {}

  def(slot: SlotName): SlotDef {
    const def = this.defs[slot];
    if (!def) throw new LiwaError('invalid_input', 'slot.unknown', `未知槽位 ${slot}`);
    return def;
  }

  /** 登记一个实现；返回释放函数 */
  provide(plugin: string, slot: SlotName, impl: string, instance?: object, factory?: (member: string) => object): () => void {
    const def = this.def(slot);
    if (!def.implemented) throw new LiwaError('internal', 'slot.unimplemented', `槽位 ${slot}（${def.cardinality}）的运行时第一版未实现`);
    const map = this.providers.get(slot) ?? new Map<string, Provider>();
    const existing = map.get(impl);
    if (existing?.active) throw new LiwaError('conflict', 'slot.duplicate_impl', `槽位 ${slot} 的实现 ${impl} 已由 ${existing.plugin} 登记，${plugin} 又登记了一次`);
    if (def.cardinality === 'single' && [...map.values()].some((p) => p.active)) {
      throw new LiwaError('conflict', 'slot.single', `槽位 ${slot} 只允许一个实现`);
    }
    const provider: Provider = {
      impl,
      plugin,
      perMember: new Map(),
      generation: (existing?.generation ?? 0) + 1,
      active: true,
      order: this.order++,
    };
    if (instance) provider.instance = instance;
    if (factory) provider.factory = factory;
    map.set(impl, provider);
    this.providers.set(slot, map);
    return () => {
      provider.active = false;
      provider.perMember.clear();
      map.delete(impl);
    };
  }

  bind(scope: string, slot: SlotName, binding: Binding, layer: string): void {
    this.def(slot);
    const map = this.bindings.get(scope) ?? new Map<SlotName, BindingRecord>();
    map.set(slot, { binding, layer });
    this.bindings.set(scope, map);
  }

  bindingFor(scope: string | undefined, slot: SlotName): BindingRecord | undefined {
    if (scope !== undefined) {
      const own = this.bindings.get(scope)?.get(slot);
      if (own) return own;
    }
    return this.bindings.get('default')?.get(slot);
  }

  private instanceOf(slot: SlotName, provider: Provider, member: string | undefined): object {
    if (provider.instance) return handleFor(slot, provider, provider.instance);
    if (provider.factory) {
      const key = member ?? 'default';
      let inst = provider.perMember.get(key);
      if (!inst) {
        inst = provider.factory(key);
        provider.perMember.set(key, inst);
      }
      return handleFor(slot, provider, inst);
    }
    throw unavailable(slot, `实现 ${provider.impl} 没有实例`);
  }

  activeProviders(slot: SlotName): Provider[] {
    return [...(this.providers.get(slot)?.values() ?? [])].filter((p) => p.active).sort((a, b) => a.order - b.order);
  }

  resolve<T extends object>(slot: SlotName, query: SlotQuery = {}): T {
    const def = this.def(slot);
    const active = this.activeProviders(slot);
    if (def.cardinality === 'bound') {
      if (!query.impl) throw unavailable(slot, 'bound 槽位要指明 impl（有效绑定由所属服务给）');
      const p = active.find((x) => x.impl === query.impl);
      if (!p) throw unavailable(slot, `实现 ${query.impl} 未登记`);
      return this.instanceOf(slot, p, query.member) as T;
    }
    if (def.cardinality === 'member-single') {
      const record = this.bindingFor(query.member, slot);
      let impl: string | undefined;
      if (record) {
        if (record.binding === null) throw unavailable(slot, '绑定为 null（明确不配）');
        if (Array.isArray(record.binding)) throw unavailable(slot, 'member-single 槽位的绑定不能是数组');
        impl = record.binding;
      } else if (active.length === 1) {
        impl = active[0]?.impl;
      }
      if (!impl) throw unavailable(slot, '没有绑定，提供方也不止一个');
      const p = active.find((x) => x.impl === impl);
      if (!p) throw unavailable(slot, `绑定的实现 ${impl} 未登记`);
      return this.instanceOf(slot, p, query.member) as T;
    }
    if (def.cardinality === 'registry' && query.key) {
      const p = active.find((x) => x.impl === query.key);
      if (!p) throw unavailable(slot, `key ${query.key} 未登记`);
      return this.instanceOf(slot, p, query.member) as T;
    }
    const all = this.resolveAll<T>(slot, query);
    const first = all[0];
    if (!first) throw unavailable(slot, '没有可用实现');
    return first;
  }

  resolveAll<T extends object>(slot: SlotName, query: SlotQuery = {}): T[] {
    const def = this.def(slot);
    if (def.cardinality === 'single' || def.cardinality === 'chain') {
      throw new LiwaError('internal', 'slot.unimplemented', `槽位 ${slot}（${def.cardinality}）的运行时第一版未实现`);
    }
    const active = this.activeProviders(slot);
    const record = this.bindingFor(query.member, slot);
    let ordered = active;
    if (record && Array.isArray(record.binding)) {
      const wanted = record.binding;
      ordered = wanted.map((impl) => active.find((p) => p.impl === impl)).filter((p): p is Provider => p !== undefined);
    } else if (record && typeof record.binding === 'string') {
      ordered = active.filter((p) => p.impl === record.binding);
    } else if (record && record.binding === null) {
      ordered = [];
    }
    return ordered.map((p) => this.instanceOf(slot, p, query.member) as T);
  }

  /** 给 dump-config：每个槽位的提供方、绑定、必需性是否满足 */
  plan(presentServices: ReadonlySet<string>, declared: Map<SlotName, { impl: string; plugin: string }[]> = new Map()): SlotPlan[] {
    return SLOT_NAMES.map((slot) => {
      const def = this.def(slot);
      const actual = this.activeProviders(slot).map((p) => ({ impl: p.impl, plugin: p.plugin }));
      const providers = actual.length > 0 ? actual : (declared.get(slot) ?? []);
      const bindings: SlotPlan['bindings'] = [];
      for (const [scope, map] of this.bindings) {
        const record = map.get(slot);
        if (record) bindings.push({ member: scope, binding: record.binding, layer: record.layer });
      }
      let satisfied = true;
      if (def.requiredBy && presentServices.has(def.requiredBy)) {
        if (providers.length === 0) satisfied = false;
        else if (def.cardinality === 'member-single' && providers.length > 1 && !bindings.some((b) => b.member === 'default')) satisfied = false;
      }
      const plan: SlotPlan = { slot, cardinality: def.cardinality, providers, bindings, satisfied };
      if (def.requiredBy) plan.requiredBy = def.requiredBy;
      return plan;
    });
  }

  /** builtin 的门面：只能提供 manifest 声明过的槽位 */
  providerFacade(plugin: string, allowed: ReadonlyMap<SlotName, string>, registerEffect: (dispose: () => void) => void): ProviderSlots {
    const check = (slot: SlotName, impl: string): void => {
      const declaredImpl = allowed.get(slot);
      if (declaredImpl === undefined) throw new LiwaError('not_permitted', 'slot.undeclared', `插件 ${plugin} 的 manifest 没有声明槽位 ${slot}`);
      if (declaredImpl !== impl) throw new LiwaError('not_permitted', 'slot.impl_mismatch', `插件 ${plugin} 声明的实现 id 是 ${declaredImpl}，登记的却是 ${impl}`);
    };
    const facade: ProviderSlots = {
      provide: (slot, impl, instance) => {
        check(slot, impl);
        const dispose = this.provide(plugin, slot, impl, instance);
        registerEffect(dispose);
        return dispose;
      },
      provideFactory: (slot, impl, make) => {
        check(slot, impl);
        const dispose = this.provide(plugin, slot, impl, undefined, make);
        registerEffect(dispose);
        return dispose;
      },
    };
    return Object.freeze(facade);
  }

  /** required 与 kernel 的门面 */
  hostFacade(plugin: string, registerEffect: (dispose: () => void) => void, presentServices: ReadonlySet<string>): HostSlots {
    const facade: HostSlots = {
      provide: (slot, impl, instance) => {
        const dispose = this.provide(plugin, slot, impl, instance);
        registerEffect(dispose);
        return dispose;
      },
      provideFactory: (slot, impl, make) => {
        const dispose = this.provide(plugin, slot, impl, undefined, make);
        registerEffect(dispose);
        return dispose;
      },
      bind: (scope, slot, binding, layer: PatchLayer | 'runtime') => this.bind(scope, slot, binding, layer),
      resolve: <T extends object>(slot: SlotName, query?: SlotQuery) => this.resolve<T>(slot, query),
      resolveAll: <T extends object>(slot: SlotName, query?: SlotQuery) => this.resolveAll<T>(slot, query),
      plan: () => this.plan(presentServices),
    };
    return Object.freeze(facade);
  }
}
