// kernel 的公开类型（docs/architecture/modules/00-plugin-kernel.md §7、§9、§11）
import type { AssemblyPlan, Binding, PatchLayer, ServiceKey, Services, SlotName, SlotPlan, Stage } from '@liwa/contracts';
import type { z } from '@liwa/contracts';

/** 挂钟、单调钟、可控定时器分开注入；L0 回放时是假时钟 */
export interface Clock {
  wall(): { iso: string; ms: number; tz: string };
  mono(): number;
  timer(ms: number, fn: () => void): () => void;
}

/** 计数器式随机源：fork 只由（种子, 标签）决定，可从状态恢复 */
export interface Rng {
  next(): number;
  fork(label: string): Rng;
  state(): string;
}

/** 编号源：会话号、回合号、调用号都从这里来 */
export interface Ids {
  next(prefix: string): string;
}

export type LogFields = Record<string, unknown>;
export interface Logger {
  debug(fields: LogFields, msg?: string): void;
  info(fields: LogFields, msg?: string): void;
  warn(fields: LogFields, msg?: string): void;
  error(fields: LogFields, msg?: string): void;
  child(bindings: LogFields): Logger;
}

/** 密钥引用的解析器：kernel 在把 config 交给插件前解析 */
export interface SecretResolver {
  resolve(ref: string): Promise<string | undefined>;
}

export interface KernelEvents {
  'kernel/started': (info: { profile: string; stage: Stage; assemblyHash: string }) => void;
  'plugin/loaded': (id: string) => void;
  'plugin/disabled': (id: string, reason: string) => void;
  'plugin/failed': (id: string, error: unknown) => void;
  'plugin/circuit-open': (id: string) => void;
  'slot/bound': (binding: { member: string; slot: SlotName; binding: Binding; layer: string }) => void;
}

export type Health = { ok: true } | { ok: false; reason: string };

/** 解析槽位实现时的条件 */
export interface SlotQuery {
  member?: string;
  impl?: string;
  key?: string;
}

/** builtin 插件拿到的槽位门面：只能提供 manifest 声明过的槽位 */
export interface ProviderSlots {
  provide(slot: SlotName, impl: string, instance: object): () => void;
  provideFactory(slot: SlotName, impl: string, make: (member: string) => object): () => void;
}

/** required 插件与 kernel 拿到的槽位门面 */
export interface HostSlots extends ProviderSlots {
  bind(scope: string, slot: SlotName, binding: Binding, layer: PatchLayer | 'runtime'): void;
  resolve<T extends object>(slot: SlotName, query?: SlotQuery): T;
  resolveAll<T extends object>(slot: SlotName, query?: SlotQuery): T[];
  plan(): SlotPlan[];
}

export type EffectCleanup = () => void | Promise<void>;

/** 插件拿到的上下文：kernel 自建的冻结对象，cordis 的 ctx 只活在闭包里 */
export interface KernelContext<I extends ServiceKey = never> {
  readonly pluginId: string;
  readonly clock: Clock;
  readonly rng: Rng;
  readonly ids: Ids;
  readonly log: Logger;
  readonly services: Pick<Services, I>;
  readonly slots: ProviderSlots | HostSlots;
  effect(run: () => EffectCleanup | void, label?: string): () => Promise<void>;
  on<K extends keyof KernelEvents>(name: K, listener: KernelEvents[K]): () => void;
}

export interface PluginHooks<I extends ServiceKey = never> {
  /** 开放业务：对外接活、定时器、订阅都在这里开 */
  ready?(ctx: KernelContext<I>): void | Promise<void>;
  /** 关闭的第一步：停接新活、等在途，deadlineMs 是单调钟上的截止 */
  drain?(ctx: KernelContext<I>, deadlineMs: number): void | Promise<void>;
  health?(): Health | Promise<Health>;
}

export interface ServiceHooks<I extends ServiceKey = never> extends PluginHooks<I> {
  /** 第 3 阶段的恢复（日志恢复、清孤儿、投影追上），只有 required 有 */
  recover?(ctx: KernelContext<I>): void | Promise<void>;
}

/** definePlugin / defineService 的产物；loader 据此造 cordis 插件对象 */
export interface PluginDef {
  readonly id: string;
  readonly kind: 'required' | 'builtin';
  readonly service?: ServiceKey;
  readonly inject: readonly ServiceKey[];
  readonly Config?: z.ZodType;
  readonly hooks: ServiceHooks<ServiceKey>;
  /** 内部：loader 用；插件代码不调 */
  readonly mount: PluginMount;
}

export type PluginMount = (facade: KernelContext<ServiceKey>, config: unknown, publish: (instance: object) => void) => void | Promise<void>;

export interface StageSets {
  readonly m0: readonly ServiceKey[];
  readonly m1: readonly ServiceKey[];
  readonly v1: readonly ServiceKey[];
}

export interface KernelHandle {
  readonly plan: AssemblyPlan;
  /** 按插件 id 取健康状态 */
  health(): Promise<Record<string, Health>>;
  /** 排空、逆序释放、退出；多次调用只执行一次 */
  shutdown(reason: string): Promise<void>;
  /** 测试与组合根用：取已装配的内核服务 */
  service<K extends ServiceKey>(key: K): Services[K];
}
