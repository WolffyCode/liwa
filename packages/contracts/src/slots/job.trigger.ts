/**
 * 槽位：job.trigger ｜ 版本 1 ｜ 基数 list ｜ 作用域 global ｜ transport in-process ｜ requiredBy scheduler
 * meta 里声明 type 与触发参数的 JSON Schema；next 是纯函数，只管时间触发。
 */
import { CallContext, Iso, JsonValue } from '../common.js';
import { z } from '../z.js';

export const CONTRACT_VERSION = 1;

export const Meta = z.strictObject({ type: z.string().min(1), specSchema: z.record(z.string(), z.unknown()) });
export type Meta = z.infer<typeof Meta>;

export const Methods = {
  next: { params: z.object({ spec: JsonValue, now: Iso, lastRunAt: Iso.optional() }), result: Iso.nullable(), timeoutMs: 1_000, pure: true },
} as const;

export interface JobTrigger {
  next(ctx: CallContext, input: { spec: JsonValue; now: Iso; lastRunAt?: Iso }): Promise<Iso | null>;
}
