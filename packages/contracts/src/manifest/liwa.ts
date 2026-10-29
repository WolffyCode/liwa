// 插件 manifest（package.json 的 liwa 字段）的 schema（docs/architecture/modules/00-plugin-kernel.md §3；00-contracts.md §3）
import { ImplId, PluginId } from '../common.js';
import { SLOT_NAMES } from '../slots/defs.js';
import { SERVICE_KEYS } from '../services.js';
import { z } from '../z.js';

export const MANIFEST_VERSION = 1 as const;

export const PluginKind = z.enum(['required', 'builtin', 'external', 'data']);
export type PluginKind = z.infer<typeof PluginKind>;

const SlotNameSchema = z.enum(SLOT_NAMES);
const ServiceKeySchema = z.enum(SERVICE_KEYS);

/** provides：实现哪些槽位（契约版本、实现 id、静态描述） */
export const Provides = z.partialRecord(
  SlotNameSchema,
  z.strictObject({
    contract: z.number().int().positive(),
    impl: ImplId,
    meta: z.unknown().optional(),
  }),
);
export type Provides = z.infer<typeof Provides>;

/** consumes：服务键 → 服务 API 版本（进程内插件可消费任何内核服务） */
export const Consumes = z.partialRecord(ServiceKeySchema, z.number().int().positive());
export type Consumes = z.infer<typeof Consumes>;

/** 一包多插件时每个插件的描述 */
export const SubPlugin = z.strictObject({
  id: PluginId,
  entry: z.string().min(1),
  service: ServiceKeySchema.optional(),
  provides: Provides.optional(),
  consumes: Consumes.optional(),
});
export type SubPlugin = z.infer<typeof SubPlugin>;

export const Resources = z.strictObject({
  maxRssMb: z.number().int().positive(),
  cpu: z.enum(['background', 'utility']),
  logMbPerDay: z.number().int().positive(),
});

export const Manifest = z.strictObject({
  manifestVersion: z.literal(MANIFEST_VERSION),
  id: PluginId,
  kind: PluginKind,
  provides: Provides.optional(),
  consumes: Consumes.optional(),
  plugins: z.array(SubPlugin).min(1).optional(),
  multiInstance: z.boolean().optional(),
  data: z.strictObject({ slot: SlotNameSchema, file: z.string().min(1) }).optional(),
  resources: Resources.optional(),
});
export type Manifest = z.infer<typeof Manifest>;

/** 带 liwa 字段的 package.json（只校验我们关心的部分） */
export const PackageManifest = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  exports: z.record(z.string(), z.unknown()).optional(),
  liwa: Manifest,
});
export type PackageManifest = z.infer<typeof PackageManifest>;
