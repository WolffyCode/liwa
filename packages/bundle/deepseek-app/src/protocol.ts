/**
 * 灵鲸对 ACP v1 的扩展（01 §4.1）：三个 `_liwa/*` 扩展方法与 `_meta.liwa` 字段的线格式。服务端
 * （`liwa --profile deepseek` 里的 `_liwa` 扩展插件）与客户端（本体里的 `@liwa/brain-deepseek`）
 * 都只经这里的 schema 读写，别的 ACP 客户端看不到这些扩展，照常能用。
 * @module @liwa/deepseek-app/protocol
 */

import { z } from 'zod'

/** `_meta` 里灵鲸字段的键。 */
export const LIWA_META_KEY = 'liwa'

/** 三个扩展方法。 */
export const LIWA_METHODS = {
  /** 插话：在途回合的下一步可见。 */
  steer: '_liwa/steer',
  /** 该会话的累计用量（续接后对账）。 */
  usage: '_liwa/usage',
  /** 该会话的子会话。 */
  children: '_liwa/children',
} as const

/** 会话种类（与 `brain.provider` 的 `MindKind` 同值）。 */
export const LiwaMindKindSchema = z.enum(['instance', 'work', 'think', 'own', 'tidy'])
/** 会话种类。 */
export type LiwaMindKind = z.output<typeof LiwaMindKindSchema>

/** 用量：token 拆成未命中缓存的输入、输出、缓存读写；`inferences` 是根会话自己的模型调用次数。 */
export const LiwaUsageSchema = z.object({
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative().optional(),
    cacheWrite: z.number().int().nonnegative().optional(),
  }).optional(),
  inferences: z.number().int().nonnegative().optional(),
})
/** 用量。 */
export type LiwaUsage = z.output<typeof LiwaUsageSchema>

/** `session/new`、`session/resume` 的 `_meta.liwa`：这个会话是谁的、什么种类、预算与收尾规则。 */
export const LiwaSessionMetaSchema = z.object({
  mindKind: LiwaMindKindSchema.optional(),
  owner: z.union([
    z.object({ instanceId: z.string().min(1), gen: z.number().int().positive() }),
    z.object({ taskId: z.string().min(1), gen: z.number().int().positive() }),
  ]).optional(),
  /** 会话说明，放在系统提示词末尾（Agent 作用域段）。 */
  notes: z.string().optional(),
  /** 人设版本。 */
  version: z.string().optional(),
  limits: z.object({
    maxInferencesPerTurn: z.number().int().positive().optional(),
    maxToolCallsPerTurn: z.number().int().positive().optional(),
    watchdogMs: z.number().int().positive().optional(),
  }).optional(),
  /** 成功调用其中之一即结束回合。 */
  concludeOn: z.array(z.string().min(1)).optional(),
  /** 模型名；省略即进程的默认模型。 */
  model: z.string().min(1).optional(),
  /** 取消时默认保留没读走的输入。 */
  keepQueue: z.boolean().optional(),
  /**
   * 原生工具（预设与宿主层的工具，不含经 MCP 来的内核工具）：`none` 一个都不给，`readonly` 只给只读的，
   * `worktree` 全给（写只在工作区里，越界经批准）。省略同 `worktree`。
   */
  nativeToolPolicy: z.enum(['none', 'readonly', 'worktree']).optional(),
  childPolicy: z.object({
    native: z.boolean(),
    maxDepth: z.number().int().nonnegative(),
    maxConcurrent: z.number().int().nonnegative(),
  }).optional(),
})
/** `session/new`、`session/resume` 的 `_meta.liwa`。 */
export type LiwaSessionMeta = z.output<typeof LiwaSessionMetaSchema>

/** 子会话的结束原因。 */
export const LiwaChildStopReasonSchema = z.enum(['completed', 'failed', 'cancelled', 'aborted'])

/** `session/update` 的 `_meta.liwa.child`：子会话开始或结束。 */
export const LiwaChildEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('started'), childId: z.string().min(1), label: z.string(), parentChildId: z.string().min(1).optional() }),
  z.object({ event: z.literal('ended'), childId: z.string().min(1), stopReason: LiwaChildStopReasonSchema, usage: LiwaUsageSchema }),
])
/** 子会话开始或结束。 */
export type LiwaChildEvent = z.output<typeof LiwaChildEventSchema>

/**
 * `session/update` 的 `_meta.liwa.turn`：根会话在没有 `session/prompt` 的时候自己跑起来的一个回合（后台子会话
 * 完成后它的结果叫醒根会话等）开始与结束；结束带这一回合（含子会话）的用量与收尾工具。期间的标准
 * `session/update` 都属于这个回合。
 */
export const LiwaTurnEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('started'), turnId: z.string().min(1) }),
  z.object({
    event: z.literal('ended'),
    turnId: z.string().min(1),
    /** 正常跑完，或被 `session/cancel` 停下。 */
    stopReason: z.enum(['completed', 'cancelled']),
    usage: LiwaUsageSchema,
    concludedBy: z.string().min(1).optional(),
  }),
])
/** 根会话自己跑起来的回合的开始与结束。 */
export type LiwaTurnEvent = z.output<typeof LiwaTurnEventSchema>

/** `session/update` 的 `_meta.liwa`。 */
export const LiwaUpdateMetaSchema = z.object({ child: LiwaChildEventSchema.optional(), turn: LiwaTurnEventSchema.optional() })

/** `session/prompt` 返回的 `_meta.liwa`：这一回合（含子会话）的用量与结束它的收尾工具。 */
export const LiwaPromptMetaSchema = z.object({
  usage: LiwaUsageSchema,
  concludedBy: z.string().min(1).optional(),
})
/** `session/prompt` 返回的 `_meta.liwa`。 */
export type LiwaPromptMeta = z.output<typeof LiwaPromptMetaSchema>

/** `session/request_permission` 的 `_meta.liwa`：请求来自哪个子会话（根会话自己的请求不带）。 */
export const LiwaPermissionMetaSchema = z.object({ childId: z.string().min(1).optional() })

/**
 * `session/cancel` 的 `_meta.liwa`：保不保留没读走的输入；连不连同在跑的子会话一起停（01 §4.5：暂停、排空、
 * 归属方结束时连子会话一起停，抢占与看门狗只停根会话的回合，后台子会话照常跑完）。
 */
export const LiwaCancelMetaSchema = z.object({ keepQueue: z.boolean().optional(), stopChildren: z.boolean().optional() })

/** `_liwa/steer` 的参数：与 `session/prompt` 同形的文本与内联图片块（图片照 `session/prompt` 的规则收）。 */
export const LiwaSteerParamsSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('image'), data: z.string().min(1), mimeType: z.string().min(1) }),
  ])).min(1),
})
/** `_liwa/steer` 的结果：在途提示词收下了，或眼下没有在途提示词。 */
export const LiwaSteerResultSchema = z.object({ outcome: z.enum(['accepted', 'unavailable']) })

/** `_liwa/usage`、`_liwa/children` 的参数。 */
export const LiwaSessionParamsSchema = z.object({ sessionId: z.string().min(1) })

/** `_liwa/usage` 的结果：会话开着以来的累计用量与它的身份字段。 */
export const LiwaUsageResultSchema = z.object({
  usage: LiwaUsageSchema,
  mindKind: LiwaMindKindSchema.optional(),
  version: z.string().optional(),
})

/** 一个子会话。 */
export const LiwaChildViewSchema = z.object({
  childId: z.string().min(1),
  label: z.string(),
  parentChildId: z.string().min(1).optional(),
  state: z.enum(['running', 'ended']),
  stopReason: LiwaChildStopReasonSchema.optional(),
  usage: LiwaUsageSchema,
})
/** 一个子会话。 */
export type LiwaChildView = z.output<typeof LiwaChildViewSchema>

/** `_liwa/children` 的结果。 */
export const LiwaChildrenResultSchema = z.object({ children: z.array(LiwaChildViewSchema) })

/**
 * 取一条 ACP 消息里的 `_meta.liwa`。
 * @param value - 带 `_meta` 的参数或结果。
 * @returns `_meta.liwa` 的原值；没有时为 `undefined`。
 */
export function liwaMetaOf(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return undefined
  const meta: unknown = Reflect.get(value, '_meta')
  if (meta === null || typeof meta !== 'object') return undefined
  return Reflect.get(meta, LIWA_META_KEY)
}

/**
 * 把灵鲸字段包成 `_meta`。
 * @param value - 灵鲸字段。
 * @returns `{ liwa: value }`。
 */
export function liwaMeta(value: object): Record<string, unknown> {
  return { [LIWA_META_KEY]: value }
}

/**
 * 累加两份用量（token 与推理次数相加）。
 * @param total - 汇总（原地修改）。
 * @param add - 新的一份。
 */
export function addLiwaUsage(total: LiwaUsage, add: LiwaUsage): void {
  if (add.tokens !== undefined) {
    const previous = total.tokens
    const sum = (left: number | undefined, right: number | undefined): number | undefined =>
      left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0)
    const cacheRead = sum(previous?.cacheRead, add.tokens.cacheRead)
    const cacheWrite = sum(previous?.cacheWrite, add.tokens.cacheWrite)
    total.tokens = {
      input: (previous?.input ?? 0) + add.tokens.input,
      output: (previous?.output ?? 0) + add.tokens.output,
      ...(cacheRead === undefined ? {} : { cacheRead }),
      ...(cacheWrite === undefined ? {} : { cacheWrite }),
    }
  }
  if (add.inferences !== undefined) total.inferences = (total.inferences ?? 0) + add.inferences
}
