// 插件拿到的门面：kernel 自建的冻结对象，cordis 的 ctx 只活在闭包里（docs/architecture/modules/00-plugin-kernel.md §7）
import type { Context as CordisContext } from 'cordis';
import type { ServiceKey, Services } from '@liwa/contracts';
import type { KernelEmitter } from './events.js';
import type { Clock, EffectCleanup, HostSlots, Ids, KernelContext, Logger, ProviderSlots, Rng } from './types.js';

export interface FacadeParts {
  pluginId: string;
  raw: CordisContext;
  inject: readonly ServiceKey[];
  clock: Clock;
  rng: Rng;
  ids: Ids;
  log: Logger;
  slots: ProviderSlots | HostSlots;
  events: KernelEmitter;
}

export function createFacade(parts: FacadeParts): KernelContext<ServiceKey> {
  const services: Record<string, unknown> = {};
  for (const key of parts.inject) {
    Object.defineProperty(services, key, {
      enumerable: true,
      get: () => parts.raw.get(key, true) as unknown,
    });
  }
  Object.freeze(services);
  const facade: KernelContext<ServiceKey> = {
    pluginId: parts.pluginId,
    clock: parts.clock,
    rng: parts.rng,
    ids: parts.ids,
    log: parts.log,
    services: services as Pick<Services, ServiceKey>,
    slots: parts.slots,
    effect(run: () => EffectCleanup | void, label = 'anonymous') {
      const dispose = parts.raw.effect(() => {
        const cleanup = run();
        return () => {
          if (cleanup) return cleanup();
          return undefined;
        };
      }, `${parts.pluginId}:${label}`);
      return async () => {
        await dispose();
      };
    },
    on: (name, listener) => parts.events.on(name, listener),
  };
  return Object.freeze(facade);
}
