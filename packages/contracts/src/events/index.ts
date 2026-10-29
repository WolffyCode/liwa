export * from './envelope.js';
export * from './kernel.js';
import { KERNEL_EVENT_TYPES } from './kernel.js';
import type { EventTypeDef } from './envelope.js';

/** 全部已登记的事件类型（随各模块实现增补） */
export const EVENT_TYPES: ReadonlyMap<string, EventTypeDef> = new Map(
  [...KERNEL_EVENT_TYPES].map((def) => [def.type, def] as const),
);
