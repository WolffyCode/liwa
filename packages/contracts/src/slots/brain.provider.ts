/**
 * 槽位：brain.provider ｜ 版本 1（1 = 首版）｜ 基数 bound ｜ 作用域 member ｜ transport any ｜ requiredBy brains
 * 回退：解析不到或 unavailable 时，brains 按 roster 大脑配置的备用名单依次试，都不行报 unavailable 给调用方。
 * 从 Paseo 的 AgentClient / AgentSession 裁剪（docs/architecture/modules/00-contracts.md §5.1）。
 */
import { BlobRef, CallContext, Iso, MemberId, MindKind } from '../common.js';
import { z } from '../z.js';

export const CONTRACT_VERSION = 1;

/** manifest 的 provides['brain.provider'].meta */
export const Meta = z.strictObject({
  streaming: z.boolean(),
  resume: z.boolean(),
  steer: z.boolean(),
  interrupt: z.boolean(),
  nativeTools: z.boolean(),
  permissionHook: z.boolean(),
  rollback: z.boolean(),
  batchEndHook: z.boolean(),
  usage: z.enum(['full', 'tokens', 'quota', 'none']),
  personaInjection: z.enum(['system_prompt', 'preset_append', 'developer_instructions', 'file']),
});
export type Meta = z.infer<typeof Meta>;

/** 给适配器的工具定义：JSON Schema 形式 */
export const ToolDef = z.object({ id: z.string().min(1), description: z.string(), schema: z.record(z.string(), z.unknown()) });
export type ToolDef = z.infer<typeof ToolDef>;

export const SessionConfig = z.object({
  member: MemberId,
  mindKind: MindKind,
  persona: z.object({ stable: z.string(), runtime: z.string().optional() }),
  cwd: z.string().min(1),
  dataDir: z.string().min(1),
  kernelTools: z.union([
    z.object({ endpoint: z.string().min(1), token: z.string().min(1), tools: z.array(ToolDef) }),
    z.object({ native: z.array(ToolDef), token: z.string().min(1) }),
  ]),
  nativeToolPolicy: z.enum(['none', 'readonly', 'worktree']),
  model: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  limits: z.object({ maxTurns: z.number().int().positive(), maxToolCallsPerTurn: z.number().int().positive() }),
  endTurnAfter: z.array(z.string()).optional(),
});
export type SessionConfig = z.infer<typeof SessionConfig>;

export const ResumeHandle = z.object({ provider: z.string(), sessionRef: z.string(), createdAt: Iso });
export type ResumeHandle = z.infer<typeof ResumeHandle>;

export const InputBlock = z.union([
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('block'), name: z.string(), text: z.string() }),
  z.object({ kind: z.literal('image'), blob: BlobRef }),
]);
export const TurnInput = z.object({ blocks: z.array(InputBlock) });
export type TurnInput = z.infer<typeof TurnInput>;

export const FailureCategory = z.enum(['retryable', 'auth', 'refused', 'quota', 'process_exit']);
export type FailureCategory = z.infer<typeof FailureCategory>;

/** 报不出的字段留空，不许填 0 */
export const Usage = z.object({
  tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative(), cacheRead: z.number().int().nonnegative().optional(), cacheWrite: z.number().int().nonnegative().optional() }).optional(),
  context: z.object({ used: z.number().int().nonnegative(), max: z.number().int().positive() }).optional(),
  quotaWindow: z.object({ used: z.number().nonnegative(), limit: z.number().positive(), resetsAt: Iso }).optional(),
  inferences: z.number().int().nonnegative().optional(),
  providerReportedCostUsd: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof Usage>;

export const BrainEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('turn.started'), turnId: z.string() }),
  z.object({ kind: z.literal('turn.completed'), turnId: z.string(), usage: Usage }),
  z.object({ kind: z.literal('turn.interrupted'), turnId: z.string() }),
  z.object({ kind: z.literal('turn.failed'), turnId: z.string(), category: FailureCategory, message: z.string(), retryable: z.boolean() }),
  z.object({ kind: z.literal('session.exited'), category: FailureCategory, message: z.string() }),
  z.object({ kind: z.literal('item.message'), turnId: z.string(), itemId: z.string(), text: z.string(), final: z.boolean() }),
  z.object({ kind: z.literal('item.reasoning'), turnId: z.string(), itemId: z.string(), summary: z.string() }),
  z.object({ kind: z.literal('item.tool_call.started'), turnId: z.string(), callId: z.string(), tool: z.string(), args: z.unknown(), native: z.boolean() }),
  z.object({ kind: z.literal('item.tool_call.completed'), turnId: z.string(), callId: z.string(), result: z.unknown(), ok: z.boolean() }),
  z.object({ kind: z.literal('permission.request'), turnId: z.string(), requestId: z.string(), tool: z.string(), args: z.unknown() }),
  z.object({ kind: z.literal('usage.update'), usage: Usage.partial() }),
]);
export type BrainEvent = z.infer<typeof BrainEvent>;

const Handle = z.object({ handle: z.string().min(1) });

/** 方法描述：params、result、超时；IPC 与代理由它生成 */
export const Methods = {
  createSession: { params: z.object({ cfg: SessionConfig }), result: Handle, timeoutMs: 30_000 },
  resumeSession: { params: z.object({ handle: ResumeHandle, cfg: SessionConfig }), result: Handle, timeoutMs: 30_000 },
} as const;

/** 句柄 session 上的方法 */
export const SessionMethods = {
  startTurn: { params: Handle.extend({ input: TurnInput }), result: z.object({ turnId: z.string() }), timeoutMs: 30_000 },
  steer: { params: Handle.extend({ input: TurnInput, expectedTurnId: z.string() }), result: z.enum(['accepted', 'unavailable']), timeoutMs: 10_000 },
  interrupt: { params: Handle, result: z.null(), timeoutMs: 10_000 },
  respondToPermission: { params: Handle.extend({ requestId: z.string(), decision: z.enum(['allow', 'deny']), reason: z.string().optional() }), result: z.null(), timeoutMs: 10_000 },
  persistence: { params: Handle, result: ResumeHandle.nullable(), timeoutMs: 5_000 },
  canStopRuntime: { params: Handle, result: z.boolean(), timeoutMs: 5_000 },
  close: { params: Handle, result: z.null(), timeoutMs: 30_000 },
} as const;

/** 进程内的 TypeScript 接口（与 Methods / SessionMethods 一一对应） */
export interface BrainSession {
  readonly handle: string;
  startTurn(ctx: CallContext, input: TurnInput): Promise<{ turnId: string }>;
  steer(ctx: CallContext, input: TurnInput, opts: { expectedTurnId: string }): Promise<'accepted' | 'unavailable'>;
  interrupt(ctx: CallContext): Promise<void>;
  respondToPermission(ctx: CallContext, requestId: string, decision: 'allow' | 'deny', reason?: string): Promise<void>;
  persistence(ctx: CallContext): Promise<ResumeHandle | null>;
  canStopRuntime(ctx: CallContext): Promise<boolean>;
  close(ctx: CallContext): Promise<void>;
  /** 从创建起缓冲，单消费者，只能调一次 */
  events(): AsyncIterable<BrainEvent>;
}
export interface BrainClient {
  createSession(ctx: CallContext, cfg: SessionConfig): Promise<BrainSession>;
  resumeSession(ctx: CallContext, handle: ResumeHandle, cfg: SessionConfig): Promise<BrainSession>;
}
