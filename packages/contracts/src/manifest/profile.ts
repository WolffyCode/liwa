// profile 与 patch 的 schema（docs/architecture/modules/00-plugin-kernel.md §4；00-contracts.md §3）
import { ImplId, MemberId, PluginId } from '../common.js';
import { SLOT_NAMES } from '../slots/defs.js';
import { Stage } from '../services.js';
import { z } from '../z.js';

const SlotNameSchema = z.enum(SLOT_NAMES);

/** 槽位绑定：一个实现、明确不配、或有序多个（registry / list） */
export const Binding = z.union([ImplId, z.null(), z.array(ImplId)]);
export type Binding = z.infer<typeof Binding>;

export const SlotBindings = z.strictObject({ slots: z.partialRecord(SlotNameSchema, Binding) });
export type SlotBindings = z.infer<typeof SlotBindings>;

export const ProfileEntry = z.strictObject({
  id: PluginId,
  package: z.string().min(1).optional(),
  as: ImplId.optional(),
  config: z.unknown().optional(),
  disabled: z.boolean().optional(),
});
export type ProfileEntry = z.infer<typeof ProfileEntry>;

export const Profile = z.strictObject({
  id: z.string().min(1),
  stage: Stage,
  plugins: z.array(ProfileEntry),
  memberDefaults: SlotBindings.optional(),
  members: z.partialRecord(MemberId, SlotBindings).optional(),
});
export type Profile = z.infer<typeof Profile>;

/** patch 的五种操作；insert / remove 只在仓库内的 profile 文件里允许（kernel 按层限制） */
export const PatchOp = z.union([
  z.strictObject({ replace: z.strictObject({ id: PluginId, config: z.unknown() }) }),
  z.strictObject({ disable: z.strictObject({ id: PluginId }) }),
  z.strictObject({ enable: z.strictObject({ id: PluginId }) }),
  z.strictObject({ bind: z.strictObject({ member: MemberId.optional(), slot: SlotNameSchema, binding: Binding }) }),
  z.strictObject({ insert: ProfileEntry.extend({ package: z.string().min(1), after: PluginId.optional() }) }),
  z.strictObject({ remove: z.strictObject({ id: PluginId }) }),
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const Patch = z.array(PatchOp);
export type Patch = z.infer<typeof Patch>;

/** 叠层：后者覆盖前者 */
export const PATCH_LAYERS = ['profile', 'local', 'owner', 'cli'] as const;
export type PatchLayer = (typeof PATCH_LAYERS)[number];
