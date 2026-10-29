// dump-config 的输出：装配计划（docs/architecture/modules/00-plugin-kernel.md §4.3）
import { ImplId, PluginId } from '../common.js';
import { PluginKind } from './liwa.js';
import { PATCH_LAYERS } from './profile.js';
import { SLOT_NAMES } from '../slots/defs.js';
import { SERVICE_KEYS, Stage } from '../services.js';
import { z } from '../z.js';

const SlotNameSchema = z.enum(SLOT_NAMES);
const ServiceKeySchema = z.enum(SERVICE_KEYS);

export const EntryPlan = z.object({
  id: PluginId,
  package: z.string().optional(),
  version: z.string().optional(),
  digest: z.string().optional(),
  kind: PluginKind,
  status: z.enum(['enabled', 'disabled']),
  layer: z.enum(PATCH_LAYERS).or(z.literal('required')),
  reason: z.string().optional(),
  service: ServiceKeySchema.optional(),
  provides: z.array(z.object({ slot: SlotNameSchema, impl: ImplId, contract: z.number().int() })),
  consumes: z.array(ServiceKeySchema),
});
export type EntryPlan = z.infer<typeof EntryPlan>;

export const ServiceGraph = z.object({
  providers: z.partialRecord(ServiceKeySchema, PluginId),
  order: z.array(PluginId),
  missing: z.array(z.object({ service: ServiceKeySchema, wantedBy: PluginId })),
  cycles: z.array(z.array(PluginId)),
});
export type ServiceGraph = z.infer<typeof ServiceGraph>;

export const SlotPlan = z.object({
  slot: SlotNameSchema,
  cardinality: z.string(),
  providers: z.array(z.object({ impl: ImplId, plugin: PluginId })),
  bindings: z.array(z.object({ member: z.string(), binding: z.unknown(), layer: z.string() })),
  requiredBy: ServiceKeySchema.optional(),
  satisfied: z.boolean(),
});
export type SlotPlan = z.infer<typeof SlotPlan>;

export const AssemblyPlan = z.object({
  profile: z.string(),
  stage: Stage,
  entries: z.array(EntryPlan),
  services: ServiceGraph,
  slots: z.array(SlotPlan),
  problems: z.array(z.object({ severity: z.enum(['fatal', 'warn']), entry: PluginId.optional(), message: z.string() })),
  assemblyHash: z.string(),
});
export type AssemblyPlan = z.infer<typeof AssemblyPlan>;
