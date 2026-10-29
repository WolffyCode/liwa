/**
 * 槽位：memory.engine ｜ 版本 1 ｜ 基数 member-single ｜ 作用域 member ｜ transport in-process ｜ requiredBy memory
 * 字段定稿在 docs/architecture/modules/05-memory.md §3.5（prepare / interpret 两段式 + 纯函数 rank、forget）。
 * 本文件先落版本与方法名；各结构体在 05 的实现阶段补成 zod schema。
 */
import { CallContext, JsonValue } from '../common.js';
import { z } from '../z.js';

export const CONTRACT_VERSION = 1;

export const SleepAsk = z.object({ purpose: z.string(), prompt: z.string(), answerSchema: z.record(z.string(), z.unknown()), budget: z.object({ maxTokens: z.number().int().positive() }).optional() });
export type SleepAsk = z.infer<typeof SleepAsk>;

export const Methods = {
  prepareIngest: { params: z.object({ input: JsonValue }), result: SleepAsk, timeoutMs: 5_000, pure: false },
  interpretIngest: { params: z.object({ ask: SleepAsk, answer: JsonValue }), result: JsonValue, timeoutMs: 5_000, pure: false },
  prepareConsolidate: { params: z.object({ group: JsonValue }), result: SleepAsk, timeoutMs: 5_000, pure: false },
  interpretConsolidate: { params: z.object({ ask: SleepAsk, answer: JsonValue }), result: JsonValue, timeoutMs: 5_000, pure: false },
  rank: { params: z.object({ candidates: z.array(JsonValue), situation: JsonValue }), result: z.array(z.object({ id: z.string(), score: z.number() })), timeoutMs: 1_000, pure: true },
  forget: { params: z.object({ activation: JsonValue, now: z.string() }), result: z.object({ clarity: z.number(), tier: z.enum(['clear', 'vague', 'dim']) }), timeoutMs: 1_000, pure: true },
} as const;

export interface MemoryEngine {
  prepareIngest(ctx: CallContext, input: JsonValue): Promise<SleepAsk>;
  interpretIngest(ctx: CallContext, input: { ask: SleepAsk; answer: JsonValue }): Promise<JsonValue>;
  prepareConsolidate(ctx: CallContext, group: JsonValue): Promise<SleepAsk>;
  interpretConsolidate(ctx: CallContext, input: { ask: SleepAsk; answer: JsonValue }): Promise<JsonValue>;
  rank(ctx: CallContext, input: { candidates: JsonValue[]; situation: JsonValue }): Promise<{ id: string; score: number }[]>;
  forget(ctx: CallContext, input: { activation: JsonValue; now: string }): Promise<{ clarity: number; tier: 'clear' | 'vague' | 'dim' }>;
}
