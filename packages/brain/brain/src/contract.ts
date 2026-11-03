/**
 * `brain.provider` 能力的数据契约：提供方声明什么（`Meta`）、开会话给什么（`SessionConfig`）、
 * 从什么续接（`ResumeHandle`）、一个回合带什么（`TurnInput`）、报什么用量（`Usage`），
 * 以及会话流出的每一种事件（`BrainEvent`）。每个 schema 是对应 TypeScript 类型（`z.output`）
 * 的唯一来源；品牌 transform 只改类型、不改值。schema 只用在 TypeScript 担保不了的边界上：
 * 提供方登记、调用方给的会话配置、持久化的续接句柄、提供方契约测试。灵鲸设计没规定的形状照
 * Paseo 的 `agent-sdk-types.ts`。
 * @module @liwa/brain/contract
 */

import { z } from 'zod'
import {
  CallId, ChildId, ImplId, ItemId, MemberId, PermissionRequestId, TurnId,
} from './brand.ts'

/** 提供方实现名：小写、字母开头、最长 41 个字符。 */
export const ImplIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/).transform(ImplId)
/** 成员名；`*` 留给成员默认作用域。 */
export const MemberIdSchema = z.string().regex(/^(?!\*$)[a-z0-9][a-z0-9-]{0,40}$/).transform(MemberId)
/** 回合号。 */
export const TurnIdSchema = z.string().min(1).transform(TurnId)
/** 流式条目号。 */
export const ItemIdSchema = z.string().min(1).transform(ItemId)
/** 工具调用号。 */
export const CallIdSchema = z.string().min(1).transform(CallId)
/** 权限请求号。 */
export const PermissionRequestIdSchema = z.string().min(1).transform(PermissionRequestId)
/** 提供方自己的子 agent 号。 */
export const ChildIdSchema = z.string().min(1).transform(ChildId)
/** 带时区偏移的 ISO-8601 时间。 */
export const IsoSchema = z.iso.datetime({ offset: true })
/** 任意 JSON 值；契约里的载荷一律用它，不用 `unknown`。 */
export const JsonValueSchema = z.json()

/** 会话种类：实例会话，或干活、想事、自己的事、整理四种活之一。 */
export const MindKindSchema = z.enum(['instance', 'work', 'think', 'own', 'tidy'])
/** 会话种类。 */
export type MindKind = z.output<typeof MindKindSchema>

/** 提供方对某种会话注入人设的方式。 */
export const PersonaInjectionSchema = z.enum(['system_prompt', 'preset_append', 'developer_instructions', 'file'])
/** 提供方对某种会话注入人设的方式。 */
export type PersonaInjection = z.output<typeof PersonaInjectionSchema>

/**
 * 一个提供方的能力声明。`ctx.brains` 在登记时校验它，上层据它决定哪些语义要由投递器在回合边界补。
 * `nativeTools: true` 表示提供方带着关不掉的原生工具，因此不能开 `nativeToolPolicy: 'none'` 的会话。
 */
export const MetaSchema = z.strictObject({
  streaming: z.boolean(),
  resume: z.boolean(),
  nativeTools: z.boolean(),
  permissionHook: z.boolean(),
  rollback: z.boolean(),
  modelSwitch: z.boolean(),
  /** 送达语义矩阵；为 false 的一项让对应的 `deliver` 恒回 `unsupported`。 */
  delivery: z.strictObject({ nextStep: z.boolean(), nextTurn: z.boolean(), cancelKeepsQueue: z.boolean() }),
  /** 提供方自带压缩能不能关；`always_on` 的提供方不跑实例会话。 */
  compaction: z.enum(['none', 'switchable', 'always_on']),
  /** 回合预算三项里哪些由提供方自己落实；其余由看门狗兜底。 */
  budget: z.strictObject({ inferences: z.boolean(), toolCalls: z.boolean(), concludeOn: z.boolean() }),
  usage: z.enum(['full', 'tokens', 'quota', 'none']),
  /** 各种会话的人设注入方式；缺的种类按 `instance`。 */
  personaInjection: z.strictObject({
    instance: PersonaInjectionSchema,
    work: PersonaInjectionSchema.optional(),
    think: PersonaInjectionSchema.optional(),
    own: PersonaInjectionSchema.optional(),
    tidy: PersonaInjectionSchema.optional(),
  }),
  /** 每个提供方都是每会话一个 CLI 子进程；本体里只有客户端。 */
  runtime: z.literal('subprocess'),
  /** 客户端说的协议；`scripted` 只给契约测试的回放提供方用。 */
  transport: z.enum(['acp', 'claude-sdk', 'codex-app-server', 'scripted']),
  /** 内核工具经什么到模型；至少一种。 */
  kernelTools: z.array(z.enum(['mcp-http', 'mcp-stdio', 'dynamic'])).min(1),
  binary: z.strictObject({ command: z.string().min(1), minVersion: z.string().optional() }),
  /** `observe`：提供方把自己的子 agent 翻成 `child.*` 事件。 */
  children: z.strictObject({ native: z.enum(['none', 'observe']), crossCli: z.literal(true) }),
  /** 声明支持的 `_liwa/*` 扩展方法（deepseek：steer、usage、children）。 */
  extensions: z.array(z.string()).optional(),
})
/** 一个提供方的能力声明。 */
export type Meta = z.output<typeof MetaSchema>

/** 会话服务的实例或活，加会话代次；换新、重建、换提供方都换代。 */
export const SessionOwnerSchema = z.union([
  z.object({ instanceId: z.string().min(1), gen: z.number().int().positive() }),
  z.object({ taskId: z.string().min(1), gen: z.number().int().positive() }),
])
/** 会话服务的实例或活，加会话代次。 */
export type SessionOwner = z.output<typeof SessionOwnerSchema>

/** stdio 型 MCP 服务器（Paseo `McpStdioServerConfig`）。 */
export const McpStdioServerSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  alwaysLoad: z.boolean().optional(),
})
/** Streamable HTTP 型 MCP 服务器（Paseo `McpHttpServerConfig`）。 */
export const McpHttpServerSchema = z.object({
  type: z.literal('http'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  alwaysLoad: z.boolean().optional(),
})
/** SSE 型 MCP 服务器（Paseo `McpSseServerConfig`）。 */
export const McpSseServerSchema = z.object({
  type: z.literal('sse'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  alwaysLoad: z.boolean().optional(),
})
/** 一台 MCP 服务器，形状同 Paseo 的 `McpServerConfig`。 */
export const McpServerSchema = z.discriminatedUnion('type', [McpStdioServerSchema, McpHttpServerSchema, McpSseServerSchema])
/** 一台 MCP 服务器。 */
export type McpServer = z.output<typeof McpServerSchema>

/** 交给适配器的内核工具，参数是 JSON Schema。 */
export const ToolDefSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  description: z.string(),
  schema: z.record(z.string(), JsonValueSchema),
})
/** 交给适配器的内核工具。 */
export type ToolDef = z.output<typeof ToolDefSchema>

/** 内核工具到模型的路：带令牌的 MCP 端点，或原生注册（调用经同一令牌回到本体）。由 toolport 签发。 */
export const KernelToolsSchema = z.union([
  z.object({ endpoint: z.string().min(1), token: z.string().min(1), tools: z.array(ToolDefSchema) }),
  z.object({ native: z.array(ToolDefSchema), token: z.string().min(1) }),
])
/** 内核工具到模型的路。 */
export type KernelTools = z.output<typeof KernelToolsSchema>

/**
 * 提供方开一个会话需要的全部配置。依赖上层的字段（归属、人设、回合预算、收尾工具、子 agent 策略、
 * 成员配置目录）在这里定全；上层还没有时由调用方直接给值。toolport 接入前，`kernelTools` 可省，
 * 调用方经 `mcpServers` 直接给 Paseo 形状的 MCP 服务器。
 */
export const SessionConfigSchema = z.object({
  member: MemberIdSchema,
  mindKind: MindKindSchema,
  owner: SessionOwnerSchema,
  /** `stable` = 人设十段（放最前）；`notes` = 实例或活的说明（放末尾）；`version` 决定陈旧上限。 */
  persona: z.object({ stable: z.string(), notes: z.string(), version: z.string() }),
  cwd: z.string().min(1),
  /** 本代会话的日志目录，由灵鲸管理、随删除级联。 */
  dataDir: z.string().min(1),
  kernelTools: KernelToolsSchema.optional(),
  mcpServers: z.record(z.string(), McpServerSchema).optional(),
  nativeToolPolicy: z.enum(['none', 'readonly', 'worktree']),
  model: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  /** 回合预算：推理次数、工具调用次数、看门狗。 */
  limits: z.object({
    maxInferencesPerTurn: z.number().int().positive(),
    maxToolCallsPerTurn: z.number().int().positive(),
    watchdogMs: z.number().int().positive(),
  }),
  /** 成功调用其中之一即结束回合。 */
  concludeOn: z.array(z.string()).min(1),
  permission: z.object({ mode: z.enum(['kernel', 'provider']), autoAllow: z.array(z.string()) }),
  /** `off` 遇到压缩 `always_on` 的提供方会被拒。 */
  compaction: z.enum(['off', 'provider']),
  /** `prepareConfigDir` 生成的成员配置目录；CLI 只读它。 */
  configDir: z.string().min(1),
  /** 渲染进配置目录的规矩文本与本事目录。 */
  rules: z.string(),
  skillsDir: z.string(),
  /** CLI 读不读被干活仓库自带的 `CLAUDE.md` / `AGENTS.md`。 */
  projectDocs: z.boolean(),
  /** 原生子 agent 只对 `work` 放开；其余种类 `ctx.brains` 一律改成 `native: false`。 */
  childPolicy: z.object({
    native: z.boolean(),
    maxDepth: z.number().int().nonnegative(),
    maxConcurrent: z.number().int().nonnegative(),
    crossCli: z.array(ImplIdSchema),
  }),
  resume: z.object({ identityProbe: z.boolean() }).optional(),
})
/** 开一个会话的配置（解析后）。 */
export type SessionConfig = z.output<typeof SessionConfigSchema>
/** 解析前的会话配置（品牌字段是普通字符串）。 */
export type SessionConfigInput = z.input<typeof SessionConfigSchema>

/**
 * 新的提供方进程续接一个会话需要的东西（Paseo `AgentPersistenceHandle`）：`sessionRef` 是提供方自己的会话号；
 * `nativeHandle` 与 `metadata` 装提供方要原样带回的其余信息。
 */
export const ResumeHandleSchema = z.object({
  provider: ImplIdSchema,
  sessionRef: z.string().min(1),
  createdAt: IsoSchema,
  nativeHandle: z.string().optional(),
  metadata: z.record(z.string(), JsonValueSchema).optional(),
})
/** 续接句柄。 */
export type ResumeHandle = z.output<typeof ResumeHandleSchema>

/** 按内容寻址的二进制引用。 */
export const BlobRefSchema = z.object({
  blob: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  mime: z.string().min(1),
})
/** 按内容寻址的二进制引用。 */
export type BlobRef = z.output<typeof BlobRefSchema>

/** 回合输入的一块：纯文本、具名的灵鲸块、图片。 */
export const TurnInputBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('block'), name: z.string().min(1), text: z.string() }),
  z.object({ kind: z.literal('image'), blob: BlobRefSchema }),
])
/** 回合输入的一块。 */
export type TurnInputBlock = z.output<typeof TurnInputBlockSchema>

/** 一个回合或一次送达的输入。 */
export const TurnInputSchema = z.object({ blocks: z.array(TurnInputBlockSchema).min(1) })
/** 一个回合或一次送达的输入。 */
export type TurnInput = z.output<typeof TurnInputSchema>

/** 回合级失败类别；`context_exceeded` 是换新会话的信号。 */
export const FailureCategorySchema = z.enum([
  'retryable', 'timeout', 'auth', 'refused', 'quota', 'process_exit', 'context_exceeded', 'cancelled',
])
/** 回合级失败类别。 */
export type FailureCategory = z.output<typeof FailureCategorySchema>

/** 提供方报的用量；报不出的字段留空，不许填 0。 */
export const UsageSchema = z.object({
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative().optional(),
    cacheWrite: z.number().int().nonnegative().optional(),
  }).optional(),
  context: z.object({ used: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).optional(),
  quotaWindows: z.array(z.object({
    id: z.string().min(1),
    usedPercent: z.number().min(0).max(100),
    resetsAt: IsoSchema.optional(),
    windowMinutes: z.number().int().optional(),
  })).optional(),
  balances: z.array(z.object({
    id: z.string().min(1),
    used: z.number().optional(),
    remaining: z.number().optional(),
    limit: z.number().optional(),
    unit: z.enum(['usd', 'credits', 'requests', 'tokens']),
    resetsAt: IsoSchema.optional(),
  })).optional(),
  inferences: z.number().int().nonnegative().optional(),
  /** 提供方自估的费用；只记不算。 */
  providerReportedCostUsd: z.number().optional(),
})
/** 提供方报的用量。 */
export type Usage = z.output<typeof UsageSchema>

/** 工具调用碰了什么：闭合、只增不删。 */
export const ToolCallDetailSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shell'), command: z.string(), cwd: z.string().optional() }),
  z.object({ type: z.literal('read'), path: z.string() }),
  z.object({ type: z.literal('edit'), path: z.string(), unifiedDiff: z.string().optional() }),
  z.object({ type: z.literal('write'), path: z.string() }),
  z.object({ type: z.literal('search'), query: z.string() }),
  z.object({ type: z.literal('fetch'), url: z.string() }),
  z.object({ type: z.literal('other') }),
])
/** 工具调用碰了什么。 */
export type ToolCallDetail = z.output<typeof ToolCallDetailSchema>

/** 一个权限选项的效果，由适配器从原生请求翻译。 */
export const PermissionEffectSchema = z.enum(['allow_once', 'allow_session', 'allow_always', 'deny_once', 'deny_always', 'cancel'])
/** 一个权限选项的效果。 */
export type PermissionEffect = z.output<typeof PermissionEffectSchema>

/** 权限请求给出的一个选项。 */
export const PermissionOptionSchema = z.object({ id: z.string().min(1), label: z.string(), effect: PermissionEffectSchema })
/** 权限请求给出的一个选项。 */
export type PermissionOption = z.output<typeof PermissionOptionSchema>

/** 子 agent 结束的原因；会话先关时由 brains 补记 `aborted`。 */
export const ChildStopReasonSchema = z.enum(['completed', 'failed', 'cancelled', 'aborted'])
/** 子 agent 结束的原因。 */
export type ChildStopReason = z.output<typeof ChildStopReasonSchema>

/**
 * 一个会话流出的全部事件。回合与条目事件带所属回合号；`child.*` 翻译提供方自己的子 agent；
 * 子 agent 干的活带它的 `childId`。`process.exited` 由 `ctx.brains` 根据它登记的拉起补发，提供方不发。
 */
export const BrainEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('turn.started'), turnId: TurnIdSchema }),
  z.object({
    kind: z.literal('turn.completed'),
    turnId: TurnIdSchema,
    usage: UsageSchema,
    /** 结束这个回合的收尾工具（有的话）。 */
    concludedBy: z.string().optional(),
  }),
  z.object({ kind: z.literal('turn.interrupted'), turnId: TurnIdSchema, reason: z.string().optional() }),
  z.object({
    kind: z.literal('turn.failed'),
    turnId: TurnIdSchema,
    category: FailureCategorySchema,
    message: z.string(),
    retryable: z.boolean(),
    code: z.string().optional(),
    diagnostic: z.string().optional(),
  }),
  /** CLI 在两个回合之间退出；会话没了。 */
  z.object({ kind: z.literal('session.exited'), category: FailureCategorySchema, message: z.string() }),
  z.object({
    kind: z.literal('session.compacted'),
    turnId: TurnIdSchema.optional(),
    preTokens: z.number().int().nonnegative().optional(),
    postTokens: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('process.exited'),
    pid: z.number().int().optional(),
    code: z.number().int().nullable(),
    signal: z.string().nullable(),
  }),
  /** `delta` 是同一 `itemId` 自上一条起的增量；消费方累计。 */
  z.object({ kind: z.literal('item.message'), turnId: TurnIdSchema, itemId: ItemIdSchema, delta: z.string(), final: z.boolean(), childId: ChildIdSchema.optional() }),
  /** `summary` 与 `item.message.delta` 同样是增量。 */
  z.object({ kind: z.literal('item.reasoning'), turnId: TurnIdSchema, itemId: ItemIdSchema, summary: z.string(), childId: ChildIdSchema.optional() }),
  z.object({
    kind: z.literal('item.tool_call.started'),
    turnId: TurnIdSchema,
    callId: CallIdSchema,
    tool: z.string().min(1),
    args: JsonValueSchema,
    native: z.boolean(),
    /** 同一次模型输出里并行发出的调用共享批号，回合内从 1 递增；判不出的留空。 */
    batch: z.number().int().min(1).optional(),
    detail: ToolCallDetailSchema.optional(),
    childId: ChildIdSchema.optional(),
  }),
  z.object({
    kind: z.literal('item.tool_call.completed'),
    turnId: TurnIdSchema,
    callId: CallIdSchema,
    result: JsonValueSchema,
    ok: z.boolean(),
    childId: ChildIdSchema.optional(),
  }),
  z.object({
    kind: z.literal('permission.request'),
    turnId: TurnIdSchema,
    requestId: PermissionRequestIdSchema,
    category: z.enum(['tool', 'plan', 'question', 'other']),
    tool: z.string(),
    args: JsonValueSchema,
    detail: ToolCallDetailSchema.optional(),
    options: z.array(PermissionOptionSchema).min(1),
    childId: ChildIdSchema.optional(),
  }),
  /** 提供方已应用答复；对不上的选项号按 `deny_once` 应用。 */
  z.object({
    kind: z.literal('permission.resolved'),
    turnId: TurnIdSchema.optional(),
    requestId: PermissionRequestIdSchema,
    optionId: z.string(),
    effect: PermissionEffectSchema,
  }),
  /** 提供方级的用量（额度窗口、余额），不必等回合结束。 */
  z.object({ kind: z.literal('usage.update'), turnId: TurnIdSchema.optional(), usage: UsageSchema.partial() }),
  z.object({
    kind: z.literal('child.started'),
    childId: ChildIdSchema,
    childKind: z.literal('native-child'),
    label: z.string(),
    provider: ImplIdSchema,
    parentChildId: ChildIdSchema.optional(),
  }),
  z.object({ kind: z.literal('child.ended'), childId: ChildIdSchema, stopReason: ChildStopReasonSchema, usage: UsageSchema }),
])
/** 一个会话流出的全部事件。 */
export type BrainEvent = z.output<typeof BrainEventSchema>
/** 判别标签为 `K` 的那种事件。 */
export type BrainEventOf<K extends BrainEvent['kind']> = Extract<BrainEvent, { kind: K }>

/** 送达语义：正在跑的回合下一步可见，或只在下一回合可见。 */
export const DeliverySemanticsSchema = z.enum(['next_step', 'next_turn'])
/** 送达语义。 */
export type DeliverySemantics = z.output<typeof DeliverySemanticsSchema>

/** 一次 `deliver` 的选项。 */
export interface DeliverOptions {
  /** `next_step` 插进正在跑的回合；`next_turn` 等下一回合。 */
  semantics: DeliverySemantics
  /** 会话空闲时，`next_turn` 的送达是否立刻开始那个回合。 */
  wake: boolean
  /** 调用方认为正在跑的回合；对不上时 `next_step` 回 `unavailable`。 */
  expectedTurnId?: TurnId
}

/** `deliver` 的结果：收下、这家提供方不支持、或眼下做不到。 */
export type DeliverResult = 'accepted' | 'unsupported' | 'unavailable'

/** 取消回合的原因；原因决定子 agent 要不要一起停。 */
export const CancelReasonSchema = z.enum(['preempt', 'watchdog', 'hard_limit', 'pause', 'drain', 'owner'])
/** 取消回合的原因。 */
export type CancelReason = z.output<typeof CancelReasonSchema>

/** 一次 `cancel` 的选项。 */
export interface CancelOptions {
  reason: CancelReason
  /** 保留提供方那边还没被回合拿走的输入；为 false 时提供方撤回它们。 */
  keepQueue: boolean
}

/** 对一次权限请求的答复。 */
export interface PermissionResponse {
  /** 所选选项的号；对不上的按 `deny_once` 应用。 */
  optionId: string
  /** 拒绝时交给提供方的说明（可选）。 */
  reason?: string
}
