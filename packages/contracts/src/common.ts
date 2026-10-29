// 公共类型（docs/architecture/modules/00-contracts.md §2.1）
import { z } from './z.js';

/** 经历流全局位置（字符串化的整数） */
export const EventId = z.string().regex(/^\d+$/);
export type EventId = z.infer<typeof EventId>;

export const MemberId = z.string().min(1);
export type MemberId = z.infer<typeof MemberId>;
export const PersonId = z.string().min(1);
export type PersonId = z.infer<typeof PersonId>;
export const PlaceId = z.string().min(1);
export type PlaceId = z.infer<typeof PlaceId>;

/** 主体：主人、成员、已绑定的真人、未绑定的账号 */
export const Principal = z.union([
  z.literal('owner'),
  z.string().regex(/^member:.+$/),
  z.string().regex(/^person:.+$/),
  z.string().regex(/^account:[^:]+:.+$/),
]);
export type Principal = z.infer<typeof Principal>;

/** 记忆条目"关于谁"的封闭集合 */
export const Subject = z.union([
  z.literal('self'),
  z.literal('owner'),
  z.literal('world'),
  z.string().regex(/^(person|place|account):.+$/),
]);
export type Subject = z.infer<typeof Subject>;

export const SourceKind = z.enum(['owner', 'member', 'bound_human', 'stranger', 'system', 'web', 'self_experience']);
export type SourceKind = z.infer<typeof SourceKind>;

export const MindKind = z.enum(['presence', 'slow', 'hand', 'sleep']);
export type MindKind = z.infer<typeof MindKind>;

/** 带时区的 ISO 8601 时间 */
export const Iso = z.iso.datetime({ offset: true });
export type Iso = z.infer<typeof Iso>;

export const TimeWithPrecision = z.object({ at: Iso, precision: z.enum(['minute', 'day', 'approx']) });
export type TimeWithPrecision = z.infer<typeof TimeWithPrecision>;

/** 大对象引用：内容哈希（sha256 十六进制）、字节数、媒体类型 */
export const BlobRef = z.object({
  blob: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  mime: z.string().min(1),
});
export type BlobRef = z.infer<typeof BlobRef>;

/** 受众集合编号。只有 people 能造；系统流用 AUDIENCE_OWNER */
export type AudienceRef = number & { readonly __brand: 'AudienceRef' };
export const AUDIENCE_OWNER = 0 as AudienceRef;
export const AudienceRefSchema = z.number().int().nonnegative();

/** 密钥引用：配置里只出现引用，kernel 在交给插件前解析 */
export const SecretRef = z.strictObject({ $secret: z.string().regex(/^(keychain|env):.+$/) });
export type SecretRef = z.infer<typeof SecretRef>;

/** 调用上下文：每个槽位方法的首参；进程内另带 AbortSignal，经 callId 映射到 IPC 的 $/cancel */
export const CallContext = z.object({
  callId: z.string().min(1),
  member: MemberId.optional(),
  correlationId: z.string().optional(),
  deadline: Iso.optional(),
});
export type CallContext = z.infer<typeof CallContext>;

/** 能力用量：原始单位，换成钱只在 guard */
export const Unit = z.object({
  unit: z.enum(['tokens', 'chars', 'seconds', 'images', 'calls']),
  amount: z.number().nonnegative(),
});
export type Unit = z.infer<typeof Unit>;

/** 契约里的"任意 JSON"：不用 z.unknown()，函数、Date、undefined 都进不来 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const JsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(JsonValue), z.record(z.string(), JsonValue)]),
);

/** 插件 id、实现 id 的字面规则 */
export const PluginId = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);
export type PluginId = z.infer<typeof PluginId>;
export const ImplId = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);
export type ImplId = z.infer<typeof ImplId>;
