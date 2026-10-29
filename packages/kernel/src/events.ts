// kernel 自己的进程内事件：只有 kernel 能 emit；监听器异常逐个捕获
import type { KernelEvents, Logger } from './types.js';

type Listener = (...args: unknown[]) => void;

export class KernelEmitter {
  private readonly listeners = new Map<keyof KernelEvents, Set<Listener>>();

  constructor(private readonly log: Logger) {}

  on<K extends keyof KernelEvents>(name: K, listener: KernelEvents[K]): () => void {
    const set = this.listeners.get(name) ?? new Set<Listener>();
    set.add(listener as Listener);
    this.listeners.set(name, set);
    return () => {
      set.delete(listener as Listener);
    };
  }

  emit<K extends keyof KernelEvents>(name: K, ...args: Parameters<KernelEvents[K]>): void {
    for (const listener of this.listeners.get(name) ?? []) {
      try {
        listener(...args);
      } catch (error) {
        this.log.error({ event: name, error: String(error) }, 'kernel 事件监听器抛错');
      }
    }
  }
}
