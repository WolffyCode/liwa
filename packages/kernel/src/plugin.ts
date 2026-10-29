// definePlugin / defineService（docs/architecture/modules/00-plugin-kernel.md §3.2、§11）
import type { ServiceKey, Services, z } from '@liwa/contracts';
import type { KernelContext, PluginDef, PluginHooks, ServiceHooks } from './types.js';

/** kernel 的标记：只有经 definePlugin / defineService 产出的对象能被装配 */
export const PLUGIN_MARK: unique symbol = Symbol.for('liwa.kernel.plugin');

interface Marked {
  readonly [PLUGIN_MARK]: true;
}

export function isPluginDef(value: unknown): value is PluginDef {
  return typeof value === 'object' && value !== null && (value as Partial<Marked>)[PLUGIN_MARK] === true;
}

type ConfigOf<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface DefinePluginOptions<S extends z.ZodType | undefined, I extends ServiceKey> extends PluginHooks<I> {
  id: string;
  Config?: S;
  inject?: readonly I[];
  /** 只做登记：不做 I/O、不 resolve 槽位 */
  apply(ctx: KernelContext<I>, config: ConfigOf<S>): void | Promise<void>;
}

/** builtin 插件入口：export const plugin = definePlugin({...}) */
export function definePlugin<S extends z.ZodType | undefined = undefined, I extends ServiceKey = never>(
  options: DefinePluginOptions<S, I>,
): PluginDef {
  const { id, Config, inject = [], apply, ready, drain, health } = options;
  const hooks: ServiceHooks<ServiceKey> = {};
  if (ready) hooks.ready = ready as NonNullable<ServiceHooks<ServiceKey>['ready']>;
  if (drain) hooks.drain = drain as NonNullable<ServiceHooks<ServiceKey>['drain']>;
  if (health) hooks.health = health;
  const def: PluginDef & Marked = {
    id,
    kind: 'builtin',
    inject,
    hooks,
    mount: (facade, config) => apply(facade as KernelContext<I>, config as ConfigOf<S>),
    [PLUGIN_MARK]: true,
  };
  if (Config) (def as { Config?: z.ZodType }).Config = Config;
  return Object.freeze(def);
}

export interface DefineServiceOptions<K extends ServiceKey, S extends z.ZodType | undefined, I extends ServiceKey> extends ServiceHooks<I> {
  Config?: S;
  inject?: readonly I[];
  /** 工厂先 await 再发布；实例在发布前冻结 */
  create(ctx: KernelContext<I>, config: ConfigOf<S>): Services[K] | Promise<Services[K]>;
}

/** required 插件（内核服务）：core 的每个模块一个 */
export function defineService<K extends ServiceKey, S extends z.ZodType | undefined = undefined, I extends ServiceKey = never>(
  key: K,
  options: DefineServiceOptions<K, S, I>,
): PluginDef {
  const { Config, inject = [], create, ready, drain, health, recover } = options;
  const hooks: ServiceHooks<ServiceKey> = {};
  if (ready) hooks.ready = ready as NonNullable<ServiceHooks<ServiceKey>['ready']>;
  if (drain) hooks.drain = drain as NonNullable<ServiceHooks<ServiceKey>['drain']>;
  if (health) hooks.health = health;
  if (recover) hooks.recover = recover as NonNullable<ServiceHooks<ServiceKey>['recover']>;
  const def: PluginDef & Marked = {
    id: key,
    kind: 'required',
    service: key,
    inject,
    hooks,
    mount: async (facade, config, publish) => {
      const instance = await create(facade as KernelContext<I>, config as ConfigOf<S>);
      publish(instance as object);
    },
    [PLUGIN_MARK]: true,
  };
  if (Config) (def as { Config?: z.ZodType }).Config = Config;
  return Object.freeze(def);
}
