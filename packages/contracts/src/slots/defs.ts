// 槽位清单（docs/architecture/modules/00-contracts.md §4.1；00-plugin-kernel.md §6）
import type { ServiceKey } from '../services.js';

export const SLOT_NAMES = [
  'brain.provider',
  'memory.engine',
  'growth.engine',
  'social.model',
  'social.pack',
  'persona.template',
  'job.trigger',
  'ability.embed',
  'ability.speech',
  'ability.vision',
  'ability.world',
  'gate.policy',
  'toolport.tool',
  'form.adapter',
] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

export type Cardinality = 'bound' | 'member-single' | 'list' | 'registry' | 'single' | 'chain';

export interface SlotDef {
  readonly name: SlotName;
  readonly cardinality: Cardinality;
  readonly scope: 'global' | 'member';
  readonly transport: 'any' | 'in-process';
  readonly contract: number;
  /** 该服务在装时，槽位必须有可用实现 */
  readonly requiredBy?: ServiceKey;
  /** 第一版是否已实现该基数的运行时 */
  readonly implemented: boolean;
}

export const SLOT_DEFS: Readonly<Record<SlotName, SlotDef>> = Object.freeze({
  'brain.provider': { name: 'brain.provider', cardinality: 'bound', scope: 'member', transport: 'any', contract: 1, requiredBy: 'brains', implemented: true },
  'memory.engine': { name: 'memory.engine', cardinality: 'member-single', scope: 'member', transport: 'in-process', contract: 1, requiredBy: 'memory', implemented: true },
  'growth.engine': { name: 'growth.engine', cardinality: 'member-single', scope: 'member', transport: 'in-process', contract: 1, requiredBy: 'self', implemented: true },
  'social.model': { name: 'social.model', cardinality: 'member-single', scope: 'member', transport: 'in-process', contract: 1, requiredBy: 'people', implemented: true },
  'social.pack': { name: 'social.pack', cardinality: 'list', scope: 'global', transport: 'in-process', contract: 1, implemented: true },
  'persona.template': { name: 'persona.template', cardinality: 'list', scope: 'global', transport: 'in-process', contract: 1, implemented: true },
  'job.trigger': { name: 'job.trigger', cardinality: 'list', scope: 'global', transport: 'in-process', contract: 1, requiredBy: 'scheduler', implemented: true },
  'ability.embed': { name: 'ability.embed', cardinality: 'registry', scope: 'global', transport: 'any', contract: 1, implemented: true },
  'ability.speech': { name: 'ability.speech', cardinality: 'registry', scope: 'global', transport: 'any', contract: 1, implemented: true },
  'ability.vision': { name: 'ability.vision', cardinality: 'registry', scope: 'global', transport: 'any', contract: 1, implemented: true },
  'ability.world': { name: 'ability.world', cardinality: 'registry', scope: 'global', transport: 'any', contract: 1, implemented: true },
  'gate.policy': { name: 'gate.policy', cardinality: 'chain', scope: 'global', transport: 'in-process', contract: 1, implemented: false },
  'toolport.tool': { name: 'toolport.tool', cardinality: 'list', scope: 'global', transport: 'in-process', contract: 1, implemented: true },
  'form.adapter': { name: 'form.adapter', cardinality: 'list', scope: 'global', transport: 'any', contract: 1, requiredBy: 'formhost', implemented: true },
});

/** 每个槽位的契约版本（manifest 的 provides.<slot>.contract 必须等于它） */
export const CONTRACT_VERSIONS: Readonly<Record<SlotName, number>> = Object.freeze(
  Object.fromEntries(SLOT_NAMES.map((name) => [name, SLOT_DEFS[name].contract])) as Record<SlotName, number>,
);
