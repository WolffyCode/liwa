/**
 * 槽位：ability.embed ｜ 版本 1 ｜ 基数 registry ｜ 作用域 global ｜ transport any
 * 回退：abilities 按 registry 的有序绑定试下一家；都不可用时召回跳过向量路。
 */
import { CallContext, Unit } from '../common.js';
import { z } from '../z.js';

export const CONTRACT_VERSION = 1;

export const Meta = z.strictObject({ model: z.string().min(1), dims: z.number().int().positive(), maxChars: z.number().int().positive(), local: z.boolean() });
export type Meta = z.infer<typeof Meta>;

/** 向量用 base64 的 Float32 小端，或明文数组（小批量） */
export const Vectors = z.union([z.string(), z.array(z.array(z.number()))]);

export const Methods = {
  embed: { params: z.object({ texts: z.array(z.string()).min(1), dims: z.number().int().positive().optional() }), result: z.object({ vectors: Vectors, dims: z.number().int().positive(), model: z.string(), usage: Unit.optional() }), timeoutMs: 30_000, pure: false },
  estimate: { params: z.object({ texts: z.array(z.string()) }), result: Unit, timeoutMs: 1_000, pure: true },
} as const;

export interface EmbedAbility {
  embed(ctx: CallContext, input: { texts: string[]; dims?: number }): Promise<{ vectors: string | number[][]; dims: number; model: string; usage?: Unit }>;
  estimate(ctx: CallContext, input: { texts: string[] }): Promise<Unit>;
}
