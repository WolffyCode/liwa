// 内核服务键、进程外插件的视图清单、阶段集合（docs/architecture/modules/00-contracts.md §4.2；00-plugin-kernel.md §2、§5）
import { z } from './z.js';

/** 内核服务键：required 插件提供，任何插件都可以 inject（插件是一方代码，决策 32） */
export const SERVICE_KEYS = [
  'journal',
  'guard',
  'procs',
  'brains',
  'abilities',
  'formhost',
  'workspace',
  'notify',
  'roster',
  'self',
  'body',
  'memory',
  'people',
  'skills',
  'senses',
  'attention',
  'will',
  'scheduler',
  'tasks',
  'outbox',
  'minds',
  'context',
  'actions',
  'toolport',
  'gateway',
] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];
export const ServiceKey = z.enum(SERVICE_KEYS);

/** 服务 API 的版本（进程内插件按它声明 consumes 的版本；第一版全部为 1） */
export const SERVICE_VERSIONS: Readonly<Record<ServiceKey, number>> = Object.freeze(
  Object.fromEntries(SERVICE_KEYS.map((key) => [key, 1])) as Record<ServiceKey, number>,
);

/** 进程外插件能经 IPC 反向调用的方法清单（IPC 需要可枚举的方法）；第一版只有 procs.spawn */
export const PLUGIN_VIEWS = ['procs.spawn'] as const;
export type ViewKey = (typeof PLUGIN_VIEWS)[number];
export const ViewKey = z.enum(PLUGIN_VIEWS);
export const VIEW_VERSIONS: Readonly<Record<ViewKey, number>> = Object.freeze({ 'procs.spawn': 1 });

/** 阶段：每个 profile 属于一个阶段集合 */
export const Stage = z.enum(['m0', 'm1', 'v1']);
export type Stage = z.infer<typeof Stage>;

/**
 * 阶段集合：该阶段必须在装的 required 服务（按服务键列，required 插件的 id 与服务键一致）。
 * m0 = 最小链路（overall §16.2 骨架 1–5，不含 body）；m1 加上账本与编排的其余部分；v1 全部。
 * 具体名单随实现推进调整，调整要同步 roadmap。
 */
export const STAGE_SETS: Readonly<Record<Stage, readonly ServiceKey[]>> = Object.freeze({
  m0: ['journal', 'guard', 'procs', 'brains', 'minds', 'context', 'actions', 'senses', 'attention', 'outbox', 'toolport', 'gateway'],
  m1: [
    'journal', 'guard', 'procs', 'brains', 'minds', 'context', 'actions', 'senses', 'attention', 'outbox', 'toolport', 'gateway',
    'roster', 'self', 'body', 'people', 'will', 'scheduler', 'tasks', 'workspace', 'notify',
  ],
  v1: [...SERVICE_KEYS],
});
