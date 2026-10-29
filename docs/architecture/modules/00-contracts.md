# 00 协议规范（contracts）

状态：**已确认**（2026-10-29，决策 33；四份评审的意见已处理）。`packages/contracts` 是灵鲸的标准协议规范，和插件机制绑定。本稿定**协议核心**：公共类型与方法形状规则、manifest 与 profile 的 schema、视图表、槽位契约的文件模板、第一批槽位契约、经历流事件与 journal 的追加协议、内核工具目录的形状、前后端与 IPC 信封、错误类别、版本体系与导出。各槽位的业务内容在对应模块文档里出，后边缺什么再补。底座见 `00-plugin-kernel.md`。评审处理见 `../../handoff.md`。

## 0 一页结论

- **契约分两层。** 机制层（本稿 §1–§4、§6–§12）一次定死；槽位层随模块逐个落，但每个槽位文件都用同一个模板（§5.0），加槽位是机械活。
- **方法形状规则是机制层的核心**（§2.2）：槽位方法一律异步、首参是调用上下文、只传 JSON、静态描述进 manifest、对象句柄用 `Handles` 段、流在方法描述里声明、TypeScript 接口由描述推导。第一版用回环编解码测试守住"出得了进程"。
- **zod 4 钉版、由 contracts 统一导出**；manifest、profile、patch、插件 Config 用 `strictObject`（拼错字段就失败），契约消息丢弃未知键（只加可选字段才能向前兼容）。
- **五种版本号各管各的**：`MANIFEST_VERSION`、`CONTRACT_VERSIONS`（槽位）与 `VIEW_VERSIONS`（视图）、`KERNEL_API_VERSION`（进程内插件 API）、`CLIENT_PROTOCOL_VERSION`、`IPC_PROTOCOL_VERSION`。事件载荷的破坏性变化按 `overall.md` §12.8 一次性迁移，contracts 只保留当前 schema。
- **"可序列化"只管槽位契约与插件视图**；required 之间的进程内类型（`MindContext`、账本 API）可以带函数与对象，但时间一律 ISO 字符串。

## 1 包结构

```
packages/contracts/src/
  index.ts        # MANIFEST_VERSION、KERNEL_API_VERSION、CLIENT_PROTOCOL_VERSION、IPC_PROTOCOL_VERSION、CONTRACT_VERSIONS、VIEW_VERSIONS、SLOT_DEFS、SERVICE_KEYS、PLUGIN_VIEWS、EVENT_TYPES、REQUIRED_PLUGIN_IDS、STAGE_SETS
  z.ts            # 统一 re-export zod 4
  common.ts       # §2.1
  manifest/       # liwa.ts、profile.ts、assembly.ts（AssemblyPlan）
  slots/          # 每个槽位一个文件（§5）
  views/          # 插件视图（procs.spawn …）
  events/         # envelope.ts、journal.ts（追加协议）、各模块事件载荷
  ledgers/        # required 之间的 API 类型
  tools/          # 内核工具目录
  protocol/       # client.ts（前后端）、ipc.ts（进程外插件）
  errors.ts
```

## 2 通用约定

### 2.1 公共类型（`common.ts`）

```ts
export const EventId = z.string().regex(/^\d+$/);
export const MemberId = z.string().min(1);  export const PersonId = z.string().min(1);  export const PlaceId = z.string().min(1);
export const Principal = z.union([z.literal('owner'), z.string().regex(/^member:/), z.string().regex(/^person:/), z.string().regex(/^account:[^:]+:.+$/)]);
export const Subject = z.union([z.literal('self'), z.literal('owner'), z.literal('world'), z.string().regex(/^(person|place|account):/)]);
export const SourceKind = z.enum(['owner', 'member', 'bound_human', 'stranger', 'system', 'web', 'self_experience']);
export const MindKind = z.enum(['presence', 'slow', 'hand', 'sleep']);
export const Iso = z.iso.datetime({ offset: true });
export const TimeWithPrecision = z.object({ at: Iso, precision: z.enum(['minute', 'day', 'approx']) });
export const BlobRef = z.object({ blob: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().nonnegative(), mime: z.string() });
export type AudienceRef = number & { readonly __brand: 'AudienceRef' };   // 只有 people 能造；AUDIENCE_OWNER = 0 留给系统流
export const SecretRef = z.object({ $secret: z.string().regex(/^(keychain|env):/) });
export const CallContext = z.object({ callId: z.string(), member: MemberId.optional(), correlationId: z.string().optional(), deadline: Iso.optional() });  // 进程内另带 AbortSignal，经 callId 映射到 IPC 的 $/cancel
export const Unit = z.object({ unit: z.enum(['tokens', 'chars', 'seconds', 'images', 'calls']), amount: z.number().nonnegative() });   // 能力用量：原始单位，换成钱只在 guard
```

### 2.2 方法形状规则（槽位契约与视图必须满足）

1. 方法一律返回 `Promise`；首参是 `CallContext`；入参出参只用 JSON 值（无 `Date`、`ZodType`、函数、类实例）；二进制走 `BlobRef`；时间用 `Iso`。
2. 静态描述（能力、维度、模型名、触发器参数 schema）写在 manifest 的 `provides.<slot>.meta`，不做运行时 `describe()`；健康统一用插件级 `health()`。
3. 返回子接口的方法（如创建会话）返回 `{ handle: string }`，子接口方法写在 `Handles` 段，IPC 方法名 `"<slot>/<Iface>.<method>"`，参数带 `handle`；句柄在关闭或提供方重启后失效并报 `unavailable`。
4. 流式结果在方法描述里声明 `stream: <事件 schema>`；进程内是 `AsyncIterable`，IPC 是以请求 id 为流 id 的通知序列；从创建起缓冲、单消费者。
5. 纯函数（`rank`、`deriveParams`、`next`）标 `pure: true`，在调用方线程执行，不远程化；它们所在的槽位标 `transport: 'in-process'`。
6. TypeScript 接口由 `Methods` 推导（`ClientOf<typeof Methods>`），不手写两份；每个方法声明 `timeoutMs`。
7. 每个 `transport: 'any'` 的槽位都要过回环编解码测试（JSON 往返加 schema 校验）。

### 2.3 schema 约定

zod 4（pnpm catalog 钉版），由 `z.ts` 统一导出；manifest、profile、patch、插件 Config 用 `z.strictObject`；契约消息与事件载荷用 `z.object`（丢弃未知键）；稀疏映射用 `z.partialRecord`；禁止 `async refine` 与会抛异常的 `transform`〔cordis 只接受同步校验〕。契约里的"任意 JSON"一律用递归的 `JsonValue` schema（`null | boolean | number | string | JsonValue[] | Record<string, JsonValue>`），不用 `z.unknown()`；可导出到 JSON Schema（draft 2020-12）的 zod 子集：对象、数组、枚举、字面量、联合、可选、默认值、字符串与数值约束；`transform`、自定义 `refine`、`Date`、`void` 不进契约。同一组正反例分别对 zod、导出的 JSON Schema、JSON 往返三者测试。

## 3 manifest、profile、patch 与装配树（`manifest/`）

```ts
export const Manifest = z.strictObject({
  manifestVersion: z.literal(1),
  id: PluginId,
  kind: z.enum(['required', 'builtin', 'external', 'data']),
  provides: z.partialRecord(SlotName, z.strictObject({ contract: z.number().int().positive(), impl: ImplId, meta: z.unknown().optional() })).optional(),
  consumes: z.partialRecord(z.union([ViewKey, ServiceKey]), z.number().int().positive()).optional(),
  plugins: z.array(z.strictObject({ id: PluginId, entry: z.string(), service: ServiceKey.optional(), provides: ..., consumes: ... })).optional(),
  multiInstance: z.boolean().optional(),
  data: z.strictObject({ slot: SlotName, file: z.string() }).optional(),       // kind=data 用
  resources: z.strictObject({ maxRssMb: z.number().int(), cpu: z.enum(['background', 'utility']), logMbPerDay: z.number().int() }).optional(),
});
export const Profile = z.strictObject({
  id: z.string(), stage: z.enum(['m0', 'm1', 'v1']),
  plugins: z.array(z.strictObject({ id: PluginId, package: z.string().optional(), as: ImplId.optional(), config: z.unknown().optional(), disabled: z.boolean().optional() })),
  memberDefaults: z.strictObject({ slots: z.partialRecord(SlotName, Binding) }).optional(),
  members: z.partialRecord(MemberId, z.strictObject({ slots: z.partialRecord(SlotName, Binding) })).optional(),
});
export const Binding = z.union([ImplId, z.null(), z.array(ImplId)]);           // 有序槽位用数组
export const PatchOp = z.union([
  z.strictObject({ replace: z.strictObject({ id: PluginId, config: z.unknown() }) }),
  z.strictObject({ disable: z.strictObject({ id: PluginId }) }),
  z.strictObject({ bind: z.strictObject({ member: MemberId.optional(), slot: SlotName, binding: Binding }) }),
  z.strictObject({ insert: ... }), z.strictObject({ remove: ... }),            // 只在仓库内的 profile 文件里允许
]);
export const AssemblyPlan = z.object({ profile: z.string(), stage: ..., entries: z.array(EntryPlan), services: ServiceGraph, slots: z.array(SlotPlan), assemblyHash: z.string() });
```

`SlotName`、`ServiceKey`、`ViewKey`、`ImplId` 是从 `SLOT_DEFS`、`SERVICE_KEYS`、`PLUGIN_VIEWS` 派生的枚举，不接受未知名字。

## 4 槽位、服务键、视图

### 4.1 槽位清单（`SLOT_DEFS`）

| 槽位 | 基数 | 作用域 | transport | requiredBy | 契约 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `brain.provider` | bound | member | any（带 Handles） | brains | 1 | 定稿于 §5.1 |
| `memory.engine` | member-single | member | in-process | memory | 1 | 定稿于 `05-memory.md` §3.5（按 §2.2 改为异步、Iso） |
| `growth.engine` | member-single | member | in-process | self | 1 | 签名在 §5.3，随 `06-growth.md` 定稿 |
| `social.model` | member-single | member | in-process | people | 1 | 骨架在 §5.4，V3 前细化 |
| `social.pack`、`persona.template` | list（data 包） | global | — | — | 1 | 纯数据，V2 / 可选 |
| `job.trigger` | list | global | in-process | scheduler | 1 | 定稿于 §5.5 |
| `ability.embed` | registry | global | any | —（缺了降级） | 1 | 定稿于 §5.6 |
| `ability.speech`、`ability.vision`、`ability.world` | registry | global | any | — | 1 | 随 09 |
| `gate.policy` | chain | global | in-process | — | 1 | V2，只定形状 |
| `toolport.tool` | list | global | in-process | — | 1 | V3，只定形状 |
| `form.adapter` | list | global | any | formhost（V2） | 1 | V2，只定形状 |

界面槽位（`ui.*`）归 console，不在 kernel 的注册表里，随 08 定。

### 4.2 服务键与视图

- `SERVICE_KEYS`（required 之间）：`journal guard procs brains abilities formhost workspace notify roster self body memory people skills senses attention will scheduler tasks outbox minds context actions toolport gateway`。
- 进程内插件可 `consumes` 任何服务键：插件是一方代码，读账本不受限，写经各账本的写 API（决策 32）。`PLUGIN_VIEWS` 是**进程外插件**能经 IPC 反向调用的方法清单（IPC 需要可枚举的方法），带版本；第一版只有 `procs.spawn: 1`（`spawn(ctx, { cmd, args, cwd, env, group }) → { pid, handle }`，由 procs 登记与监管）。以后：`storage.derived`、`abilities.embed`。

## 5 槽位契约

### 5.0 文件模板

```ts
/** 槽位：brain.provider ｜ 版本 1（变更说明：1 = 首版）｜ 基数 bound ｜ 作用域 member ｜ transport any ｜ requiredBy brains
 *  回退：解析不到或 unavailable 时，brains 按 roster 大脑配置的备用名单依次试，都不行报 `unavailable` 给调用方 */
export const CONTRACT_VERSION = 1;
export const SLOT = { name: 'brain.provider', cardinality: 'bound', scope: 'member', transport: 'any', requiredBy: 'brains', contract: CONTRACT_VERSION } as const;
export const Meta = z.object({ ... });                                   // manifest provides.<slot>.meta 的 schema
export const Methods = { createSession: { params, result, timeoutMs: 30_000 }, ... } as const;
export const Handles = { session: { createdBy: 'createSession', methods: { startTurn: {...}, ... }, events: Events } } as const;
export const Events = { 'turn.started': ..., ... } as const;
export type BrainClient = ClientOf<typeof Methods, typeof Handles>;     // 由描述推导
```

### 5.1 `brain.provider`

```ts
// Meta（manifest 里）：streaming、resume、steer、interrupt、nativeTools、permissionHook、rollback、batchEndHook、usage: 'full'|'tokens'|'quota'|'none'、personaInjection
export interface SessionConfig {
  member: MemberId; mindKind: MindKind;
  persona: { stable: string; runtime?: string };
  cwd: string; dataDir: string;
  kernelTools: { endpoint: string; token: string; tools: ToolDef[] } | { native: ToolDef[]; token: string };   // native 分支也带令牌：原生工具被调用时适配器经 toolport.invoke(token, tool, args) 交回本体
  nativeToolPolicy: 'none' | 'readonly' | 'worktree';
  model: string; env?: Record<string, string>;
  limits: { maxTurns: number; maxToolCallsPerTurn: number };
  endTurnAfter?: string[];                                   // 这些工具同批调用结束后由钩子收尾（省掉第二次推理）
}
// Methods：health 由插件级提供；createSession(ctx, cfg) → { handle }；resumeSession(ctx, { handle: ResumeHandle, cfg }) → { handle }
// Handles.session：startTurn(ctx, { handle, input }) → { turnId }；steer(ctx, { handle, input, expectedTurnId }) → 'accepted' | 'unavailable'；
//   interrupt(ctx, { handle })（幂等，丢弃未读 steer）；respondToPermission(ctx, { handle, requestId, decision, reason? })；
//   persistence(ctx, { handle }) → ResumeHandle | null；canStopRuntime(ctx, { handle }) → boolean；close(ctx, { handle })；
//   events(ctx, { handle }) → stream<BrainEvent>（从创建起缓冲，单消费者，只能调一次）
export type BrainEvent =
  | { kind: 'turn.started'; turnId: string }
  | { kind: 'turn.completed'; turnId: string; usage: Usage }
  | { kind: 'turn.interrupted'; turnId: string }
  | { kind: 'turn.failed'; turnId: string; category: FailureCategory; message: string; retryable: boolean }
  | { kind: 'session.exited'; category: FailureCategory; message: string }          // 两个回合之间 CLI 退出
  | { kind: 'item.message'; turnId: string; itemId: string; text: string; final: boolean }
  | { kind: 'item.reasoning'; turnId: string; itemId: string; summary: string }
  | { kind: 'item.tool_call.started'; turnId: string; callId: string; tool: string; args: unknown; native: boolean }
  | { kind: 'item.tool_call.completed'; turnId: string; callId: string; result: unknown; ok: boolean }
  | { kind: 'permission.request'; turnId: string; requestId: string; tool: string; args: unknown }
  | { kind: 'usage.update'; usage: Partial<Usage> };
export type FailureCategory = 'retryable' | 'auth' | 'refused' | 'quota' | 'process_exit';
export interface Usage {                                      // 报不出的字段留空，不许填 0
  tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  context?: { used: number; max: number };                    // minds 据此"接近上限先写回再换新"
  quotaWindow?: { used: number; limit: number; resetsAt: Iso };
  inferences?: number;
  providerReportedCostUsd?: number;                           // SDK 估价，guard 不用（overall §11.8）
}
```

有效绑定由 roster 的大脑配置给出：每个成员 × 用脑种类（慢想可按触发类别）一份 `{ impl, model, fallback: impl[] }`；适配器 config 只放适配器级参数，模型走 `SessionConfig.model`。适配器必须：CLI 退出即报 `session.exited` 或 `turn.failed`；中断幂等；`turn.completed` 必带 usage；人设在每次拉起与续接时都带上（brains 续接后做身份探针）；经 `procs.spawn` 拉进程（登记、进程组、清孤儿都在 procs），不 import `node:child_process`。

### 5.2 `memory.engine`

见 `05-memory.md` §3.5，按 §2.2 改为：`prepareIngest(ctx, input) → SleepAsk` 与 `interpretIngest(ctx, { ask, answer }) → SleepProposal`（抽取）、`prepareConsolidate` / `interpretConsolidate`（判关系）两对方法，模型调用由睡眠作业的编排（minds）代问，引擎不依赖 minds；`rank(ctx, { candidates, situation })` 标 `pure`，只接收账本按受众裁过的候选、只返回编号与分数，账本对返回的编号再核一次；`forget(ctx, { activation, now: Iso })` 标 `pure`。重查询由账本在 worker 里做，纯函数在拿到候选的线程里跑。`MindContext` 是 required 之间的进程内类型，不是槽位契约。

### 5.3 `growth.engine`

```ts
renderPersona(ctx, { member, mind, birth, traits, growth, selfBrief, presence?, todayNotes? }) → { segments: PersonaSegment[]; versions; sectionChars; truncated[] }   // 只返回可替换的段落；不可变的人设锚（出生设定）由 required 的 self / context 直接从账本装配
deriveParams(ctx, { traits, rate }) → BodyParams                       // pure
proposeGrowth(ctx, { member, stats, items, candidates, birthSummary }) → { ask?: SleepAsk; proposals?: GrowthProposal[] }   // 需要模型时返回"要问什么"，minds 代问后再调一次 interpret
interpretGrowth(ctx, { ask, answer }) → GrowthProposal[]
proposeSelf / interpretSelf 同形
jobs() → JobDecl[]（写在 meta 里）
```

### 5.4 `social.model`

`relationDelta(ctx, { event, state, params }) → { trust, closeness, rule }`（pure）；`defaultPermissions(ctx, { role }) → PermissionSet`，只在主人已批准的上限内生效，插件升级不能静默扩权。

### 5.5 `job.trigger`

meta 里声明 `type` 与触发参数的 JSON Schema；`next(ctx, { spec, now, lastRunAt? }) → Iso | null`（pure，只管时间触发）；事件型、空闲型触发由 scheduler 持有订阅与状态，第一版不开放给插件。

### 5.6 `ability.embed`

meta：`{ model, dims, maxChars, local }`；`embed(ctx, { texts, dims? }) → { vectors: string /* base64 Float32 小端 */ | number[][], dims, model, usage?: Unit }`；`estimate(ctx, { texts }) → Unit`。回退：abilities 按 registry 的有序绑定试下一家；都不可用时召回跳过向量路。

### 5.7 只定形状的三个

`form.adapter`（V2）：`deliver(ctx, { place, content, idemKey }) → receipt`、入站标准消息、在场者快照、平台限制声明；`gate.policy`（V2）：`decide(ctx, input) → 'reply' | 'ignore' | undefined`；`toolport.tool`（V3）：`{ id, schema, mindKinds, propose(ctx, args) → Action }`。

## 6 经历流事件与追加协议（`events/`）

```ts
export const EventEnvelope = z.object({
  pos: EventId, stream: z.object({ kind: z.enum(['member', 'mind', 'place', 'task', 'system']), id: z.string() }), seq: z.number().int().nonnegative(),
  type: z.string().regex(/^[a-z]+(\.[a-z_]+)+\.v\d+$/), actor: z.union([Principal, z.literal('system'), z.string().regex(/^mind:/)]), at: Iso,
  causeId: EventId.optional(), correlationId: z.string().optional(),
  source: z.object({ placeId: PlaceId.optional(), presenceSnapshotId: z.string().optional(), audienceId: z.number().int().nonnegative(), principal: Principal.optional(), sourceKind: SourceKind, trust: z.number().min(0).max(1), taint: z.boolean() }),
  payloadRef: z.object({ id: z.string() }).optional(),           // 信封不可变；载荷是否已删由载荷读取结果与"载荷已删除"事件表达
});
export const AppendRequest = z.object({ stream, type, payload: z.unknown().optional(), expectedSeq: z.number().int().optional(), causeId: EventId.optional(), correlationId: z.string().optional(), source: EventEnvelope.shape.source });   // pos、seq、at 由 journal 生成；source 由可信的所有者模块给，插件不能提交
export const CommittedEvent = EventEnvelope;
// Journal（required 之间）：append(req) → CommittedEvent | LiwaError('conflict')；read(cursor)；subscribe(filter, cb) → 释放函数；registerProjection({ name, kind, handles, apply, rebuild })；checkpoint 只记已提交的 pos
```

规则：`EVENT_TYPES` 第一版只有 contracts 能定义；journal 追加时校验，未知类型拒绝；载荷里不得复制信封字段；消费方按 `pos` 引用不复制载荷；系统流事件用 `AUDIENCE_OWNER = 0`；事件载荷的破坏性变化走一次性迁移（备份 → 写新库 → 校验 → 切换），旧 schema 只留在迁移脚本里。

## 7 账本 API（`ledgers/`）

只放类型，required 之间用：`MindContext`（`now: Iso`，可带 `canSeeEvent` 函数，进程内）、`Journal`、`Guard`、`Procs`、`Brains`、`Abilities`、`Formhost`、`Workspace`、`Notify`、`Roster`、`SelfLedger`、`Body`、`Memory`、`People`、`Skills`、`Senses`、`Attention`、`Will`、`Scheduler`、`Tasks`、`Outbox`、`Minds`、`ContextAssembler`、`Actions`、`Toolport`、`Gateway`。参数对象、返回 Promise、错误只抛 `LiwaError`；凡登记回调的方法返回释放函数。主人专属操作要带 gateway 签发的主人令牌（`00-plugin-kernel.md` §7），防的是模型与会话，不是插件。

## 8 内核工具目录（`tools/`）

`ToolSpec { id, description, params: ZodType, result: ZodType, mindKinds, firstBatch?, sideEffect: 'none' | 'propose' }` 是内核内部目录（可用 zod）；给适配器的 `ToolDef { id, description, schema: JsonSchema }` 由它导出。第一批：在场 `reply`（含可选"用到的记忆号"）、`say`、`inner`、`commit`、`ask_mind`、`dispatch`、`recall`、`look`；慢想 `relay`、`decide`、`plan`、`pursue`、`do`、`stop`、`drop`、`get_report`；手 `report`、`ask`、`spawn`；睡眠 `submit`。工具只"提出动作"；原生注入的工具经 `toolport.invoke(token, tool, args)` 回到本体。

## 9 前后端信封（`protocol/client.ts`）

`CLIENT_PROTOCOL_VERSION = 1`；`Request{ t:'req', id, op, body, v }`；`Response = Ok{ t:'res', id, ok:true, body } | Err{ t:'res', id, ok:false, error: LiwaErrorShape }`（互斥联合）；订阅帧 `Frame{ t:'sub', sub, cursor, items }`；`Hello{ t:'hello', v, build, token }`。不一致客户端提示刷新。订阅种类、游标、快照、背压与主人接口清单在 07 定。

## 10 进程外插件的 IPC（`protocol/ipc.ts`）

- `IPC_PROTOCOL_VERSION = 1`；传输 fd 3 管道，UTF-8，一行一条 JSON，单行 ≤1 MiB；不支持 batch 数组；`id` 为字符串，双方各自维护自己发出的 id 空间；非法消息计数告警、不中断。
- `Request{ jsonrpc:'2.0', id, method, params }`、`Response{ jsonrpc, id, result } | { jsonrpc, id, error }`、`Notification{ jsonrpc, method, params }`。
- 方法：`"<slot>/<method>"`、`"<slot>/<Iface>.<method>"`（句柄）、`kernel/hello`（宿主 → 插件的请求，插件响应 `{ manifest, pid, ipcProtocolVersion }`）、`kernel/ping`（请求）、`kernel/shutdown{ graceMs }`、`kernel/view.<视图>`（插件 → 宿主，仅声明过的视图）、`$/stream{ id, seq, kind: 'item' | 'end' | 'error', data }`（通知，`id` = 请求 id，带序号）、`$/ack{ id, seq }`（通知）、`$/cancel{ id }`（通知，对任意请求有效；是请求不是完成证明）。成功无值统一返回 `null`；响应的 `result` 与 `error` 互斥。
- 错误：`error: { code: number, message, data: LiwaErrorShape }`；`code` 由类别映射到 `-32000…-32019`（表在 `errors.ts`），`-32700…-32600` 留给传输层错误。
- 限制：在途请求 ≤64；流每 256 条 ack；方法超时按契约；订阅类流的保活与活动请求的超时分开。

## 11 错误（`errors.ts`）

| 类别 | 默认 retryable | 含义 |
| --- | --- | --- |
| `retryable` | 是 | 暂时性故障（网络、限流） |
| `timeout` | 是 | 超时；副作用是否发生未知，是否重做由 actions 的幂等键决定 |
| `unavailable` | 是 | 槽位无实现、提供方熔断、句柄失效 |
| `auth` | 否 | 鉴权失败 |
| `quota` | 否 | 额度用尽 |
| `refused` | 否 | 内容被拒 |
| `process_exit` | 是 | 子进程退出 |
| `invalid_input` | 否 | 调用方传参不合 schema |
| `invalid_output` | 否 | 模型或插件输出没过 schema |
| `not_permitted` | 否 | 调用方无此权限 |
| `conflict` | 否 | 期望序号不符、并发冲突 |
| `cancelled` | 否 | 被暂停、总闸或调用方取消；**不得当作可重试去换下一家** |
| `internal` | 否 | 代码缺陷 |

`LiwaError { category, code: string, message, retryable, data? , cause? }`；`LiwaErrorShape` 同形用于协议。`retryable` 说的是故障性质；某个动作能不能安全重做，由 actions 的幂等键决定，请求 id 不替代幂等键。"副作用一律经 `actions.run`"指的是受管的业务动作（对外说话、派活、建作业、调收费服务、改文件、不可逆动作）；日志、定时器、进程监管、journal 的追加不在此列，各有自己的守门点（guard 的准入、toolport 的令牌、outbox 的投递）。

## 12 版本、导出与兼容

| 版本号 | 管什么 | 谁检查 | 不符时 |
| --- | --- | --- | --- |
| `MANIFEST_VERSION` | manifest 格式 | kernel 第 1 阶段 | 拒绝插件 |
| `CONTRACT_VERSIONS[slot]` | 槽位接口 | kernel 第 1 阶段；IPC 握手 | 禁用插件 / 必需槽位则失败 |
| `VIEW_VERSIONS[view]` | 插件视图 | 同上 | 同上 |
| `KERNEL_API_VERSION` | 进程内插件 API（`definePlugin`、`KernelContext`）；仓库内随版本走，external 用 peerDependencies 钉精确版本 | kernel 第 1 阶段 | 拒绝 |
| `CLIENT_PROTOCOL_VERSION` | 前后端信封 | gateway 握手 | 客户端提示刷新 |
| `IPC_PROTOCOL_VERSION` | 进程外插件信封 | IPC 握手 | 禁用插件 |
| 事件类型 `v<n>` | 载荷结构 | journal 追加 | 拒绝追加；破坏性变化走一次性迁移 |

- 装配记录（`AssemblyPlan`）含包版本、内容摘要、config 版本、契约版本；升级流程（overall §12.8）加一步：新构建先对本机 profile 跑 `dump-config`，失败不切换。
- `pnpm contracts:export`：manifest、profile、各槽位 `Methods` / `Handles` / `Events`、事件载荷、IPC 信封 → `dist/schemas/*.json`（zod 4 `z.toJSONSchema`，只允许可导出的子集）；CI 比对。
- 变更流程：改 schema → 破坏性时版本 +1 → 同一提交改完内置实现与测试 → 变更说明写在文件顶部注释；向前兼容的唯一手段是只加可选字段。

## 13 第一版范围与测试

- V1.0：§2–§4、§5.0–§5.6、§6–§12；`form.adapter`、`gate.policy`、`toolport.tool` 只定形状；`PLUGIN_VIEWS` 只有 `procs.spawn`。
- 测试：每个 schema 的正反例（含 `strictObject` 拼错字段被拒、`partialRecord` 稀疏映射通过）；JSON 往返；`CONTRACT_VERSIONS` / `VIEW_VERSIONS` / `SLOT_DEFS` / `SERVICE_KEYS` / `EVENT_TYPES` 与各文件一致；导出物一致；IPC 信封编解码；`Methods` 与推导接口一致（类型级）；回环编解码对第一批契约全部通过。

## 14 依据

Paseo 的 `AgentClient` / `AgentSession`、`AgentUsage` 与适配器规则〔`paseo-architecture` Q4，一手〕；cordis 4.0.0-rc.12 与 zod 4 源码（同步校验、`partialRecord`、`strictObject`、`iso.datetime`）〔源〕；`overall.md` §2.3、§5.2、§6.2、§6.9、§9.2、§9.4、§10.2、§11.8、§12.8；`05-memory.md` §3；成长调研 ⑨；`plugin-architecture` D2、D3、D5、D6；JSON-RPC 2.0〔一手〕；四份评审报告；决策 2、17、29、30、31。

## 15 后边缺什么再补

`growth.engine`、`social.model` 字段定稿（随 06、V3）；`ability.*` 其余种类（随 09）；`ui.*`（随 08）；`form.adapter`、`gate.policy`（随 V2）；`toolport.tool`（随 V3）；前后端订阅与主人接口（随 07）；各模块事件载荷（随各模块文档）；`storage.derived`、`abilities.embed` 两个视图（第一个需要它们的插件出现时）；非 TypeScript 插件 SDK（按 §10 实现）。
