// 经历流事件信封与追加协议（docs/architecture/modules/00-contracts.md §6）
import { AudienceRefSchema, EventId, Iso, PlaceId, Principal, SourceKind } from '../common.js';
import { z } from '../z.js';

export const StreamKind = z.enum(['member', 'mind', 'place', 'task', 'system']);
export type StreamKind = z.infer<typeof StreamKind>;

/** 事件类型名：模块.动作.v<n> */
export const EventTypeName = z.string().regex(/^[a-z]+(\.[a-z_]+)+\.v\d+$/);

export const EventSource = z.object({
  placeId: PlaceId.optional(),
  presenceSnapshotId: z.string().optional(),
  audienceId: AudienceRefSchema,
  principal: Principal.optional(),
  sourceKind: SourceKind,
  trust: z.number().min(0).max(1),
  taint: z.boolean(),
});
export type EventSource = z.infer<typeof EventSource>;

export const Actor = z.union([Principal, z.literal('system'), z.string().regex(/^mind:.+$/)]);
export type Actor = z.infer<typeof Actor>;

/** 已提交事件的信封：不可变 */
export const EventEnvelope = z.object({
  pos: EventId,
  stream: z.object({ kind: StreamKind, id: z.string().min(1) }),
  seq: z.number().int().nonnegative(),
  type: EventTypeName,
  version: z.number().int().positive(),
  actor: Actor,
  at: Iso,
  causeId: EventId.optional(),
  correlationId: z.string().optional(),
  source: EventSource,
  payloadRef: z.object({ id: z.string().min(1) }).optional(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
export type CommittedEvent = EventEnvelope;

/** 追加请求：pos、seq、at 由 journal 生成；source 由可信的所有者模块给 */
export const AppendRequest = z.object({
  stream: z.object({ kind: StreamKind, id: z.string().min(1) }),
  type: EventTypeName,
  actor: Actor,
  payload: z.unknown().optional(),
  expectedSeq: z.number().int().nonnegative().optional(),
  causeId: EventId.optional(),
  correlationId: z.string().optional(),
  source: EventSource,
});
export type AppendRequest = z.infer<typeof AppendRequest>;

/** 事件类型注册表：类型名 → 载荷 schema；第一版只有 contracts 能定义 */
export interface EventTypeDef<T = unknown> {
  readonly type: string;
  readonly payload: z.ZodType<T>;
}
export function defineEventType<T>(type: string, payload: z.ZodType<T>): EventTypeDef<T> {
  EventTypeName.parse(type);
  return Object.freeze({ type, payload });
}
