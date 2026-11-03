# 00 协议规范（contracts）

状态：**已确认**（2026-10-29，决策 33、35）。`packages/contracts` 是灵鲸的标准协议规范，和插件机制绑定。本稿定**协议核心**：公共类型与方法形状规则、manifest 与 profile 的 schema、槽位表与层表、槽位契约的文件模板与第一批契约、经历流事件与 journal 的追加协议、内核工具目录、前后端与 IPC 信封、错误类别与退出码、版本体系与导出。各槽位的业务内容在对应模块文档里出。底座见 `00-plugin-kernel.md`，命令机制见 `00-commands.md`。依据：`../../research/2026-10-29-verify-contracts.md`（C1–C19）、`verify-codex.md`（X18–X22）、`verify-layout.md` ⑧；Helm `~/Desktop/coding/person/Helm`（main `1fa999a`，Paseo 0.14.0）与 Codex `~/Desktop/coding/person/codex`（`codex-rust-v0.162.0-alpha.17.2`）源码，行号见各节。

标注：〔一手〕读过源码或规范原文；〔二手〕转述；〔推理〕设计判断。

## 0 一页结论

- **契约分两层。** 机制层（§1–§4、§6–§12）一次定死；槽位层随模块逐个落，每个槽位文件用同一个模板（§5.0），加槽位是机械活。
- **方法形状规则是机制层的核心**（§2.2）：槽位方法一律异步、首参是调用上下文、只传 JSON、静态描述进 manifest、对象句柄写在 `Handles`、流写在 `streams`、TypeScript 接口由描述**推导**（`ClientOf`），不手写两份。`transport: 'any'` 的槽位过回环编解码测试。
- **zod 4 钉版、由 contracts 统一导出**；manifest、profile、patch、插件 Config 用 `strictObject`，契约消息丢弃未知键；契约里的任意 JSON 一律 `JsonValue`，不用 `z.unknown()`。
- **六种版本号各管各的**：`MANIFEST_VERSION`、`CONTRACT_VERSIONS`（槽位）、`VIEW_VERSIONS`（视图）、`SERVICE_VERSIONS`（服务 API）、`KERNEL_API_VERSION`、`CLIENT_PROTOCOL_VERSION`、`IPC_PROTOCOL_VERSION`；事件载荷的破坏性变化按 `overall.md` §12.8 一次性迁移。
- **"可序列化"只管槽位契约、视图与两种信封**；required 之间的进程内类型可以带函数与对象，但时间一律 ISO 字符串。
- contracts **浏览器可用**：继承 `tsconfig.web.json`，不带 Node 类型，只依赖 zod。

## 1 包结构

```
packages/contracts/
  src/
    index.ts            # 版本常量、SLOT_DEFS、SLOT_CONTRACTS、SERVICE_KEYS、SERVICE_VERSIONS、SERVICE_LAYERS、REGISTRAR_METHODS、PLUGIN_VIEWS、EVENT_TYPES、STAGE_SETS、PROTOCOL_OPS、RESERVED_COMMAND_GROUPS、LOCAL_COMMAND_GROUPS、EXIT_CODE_BY_CATEGORY
    z.ts                # 统一 re-export zod 4
    common.ts           # §2.1（含 ClientOf、JsonValue、CallContext、LIWA_BLOCK_TAG）
    services.ts         # 服务键、SERVICE_VERSIONS、SERVICE_LAYERS（读 service-layers.json）、REGISTRAR_METHODS、PLUGIN_VIEWS、STAGE_SETS
    service-layers.json # 层表的唯一来源（kernel 第 1 阶段与 .dependency-cruiser.cjs 都读它）
    manifest/           # liwa.ts、profile.ts、assembly.ts
    slots/              # defs.ts（SLOT_DEFS）、index.ts（SLOT_CONTRACTS）、每个槽位一个文件
    views/              # procs.spawn.ts（视图的 Methods 描述）
    events/             # envelope.ts（信封与追加协议）、kernel.ts、各模块事件载荷
    ledgers/            # journal.ts（Journal / JournalReader）、index.ts（Services / PluginServices 与各服务类型）
    tools/              # spec.ts（ToolSpec / ToolDef / toToolDef）
    protocol/           # client.ts（前后端）、command.ts（CommandSpec，见 00-commands）、ipc.ts（进程外插件）、host.ts（HostBridge，随 08）
    errors.ts           # 类别、LiwaError、JSON-RPC 码表、退出码表、协议级错误码
    __tests__/
  schemas/              # 导出的 JSON Schema（生成物，入库，CI 核一致；Python 插件用它校验）【V1.0】
```

## 2 通用约定

### 2.1 公共类型（`common.ts`）

```ts
export const EventId = z.string().regex(/^\d+$/);
export const MemberId = z.string().regex(/^(?!\*$)[a-z0-9][a-z0-9-]{0,40}$/);   // '*' 留给 MEMBER_DEFAULT_SCOPE
export const MEMBER_DEFAULT_SCOPE = '*' as const;
export const PersonId = z.string().min(1);  export const PlaceId = z.string().min(1);
export const PluginId = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);  export const ImplId = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);
export const Principal = z.union([z.literal('owner'), z.string().regex(/^member:/), z.string().regex(/^person:/), z.string().regex(/^account:[^:]+:.+$/)]);
export const Subject = z.union([z.literal('self'), z.literal('owner'), z.literal('world'), z.string().regex(/^(person|place|account):/)]);
export const SourceKind = z.enum(['owner', 'member', 'bound_human', 'stranger', 'system', 'web', 'self_experience']);
export const MindKind = z.enum(['instance', 'work', 'think', 'own', 'tidy']);   // 会话种类：实例会话；四种活：干活、想事、自己的事、整理（four-layers §1、§3.1）
export const Iso = z.iso.datetime({ offset: true });
export const TimeWithPrecision = z.object({ at: Iso, precision: z.enum(['minute', 'day', 'approx']) });
export const BlobRef = z.object({ blob: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().nonnegative(), mime: z.string() });
export type AudienceRef = number & { readonly __brand: 'AudienceRef' };   // 只有 people 能造；AUDIENCE_OWNER = 0 留给系统流
export const SecretRef = z.strictObject({ $secret: z.string().regex(/^(keychain|env):.+$/) });
export const CallContextSchema = z.object({ callId: z.string(), member: MemberId.optional(), correlationId: z.string().optional(), deadline: Iso.optional() });
export type CallContext = z.infer<typeof CallContextSchema> & { signal?: AbortSignal };   // 进程内带 signal；IPC 只编码 schema 字段，取消经 callId 映射 $/cancel
export const Unit = z.object({ unit: z.enum(['tokens', 'chars', 'seconds', 'images', 'calls']), amount: z.number().nonnegative() });
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };   // 递归 schema 同名导出
export const LIWA_BLOCK_TAG = 'liwa-block' as const;               // 三家适配器共同遵守的注入块标签；渲染实现在 lib/brain-shared
```

### 2.2 方法形状规则（槽位契约与视图必须满足）

1. 方法一律返回 `Promise`；首参是 `CallContext`；入参出参只用 JSON 值（无 `Date`、`ZodType`、函数、类实例、`bigint`、`undefined`）；二进制走 `BlobRef`；时间用 `Iso`。
2. 静态描述（能力、维度、模型名、触发种类与参数 schema、命令）写在 manifest 的 `provides.<slot>.meta`，由该槽位文件的 `Meta` 校验，kernel 第 1 阶段校验、运行时经 `HostSlots.describe` 可读；不做运行时 `describe()`；健康统一用插件级 `health()`。
3. 返回子接口的方法（如创建会话）在描述里 `result: Handle`（`{ handle: string }`），子接口写在 `Handles.<iface>`：`{ createdBy: 方法名[], methods: { ... }, streams: { 名: { item: schema } } }`；句柄方法的 `params` **不含** `handle`，IPC 层加上：方法名 `"<slot>/<iface>.<method>"`，参数 `{ handle, ...params }`；句柄在关闭或提供方失效后报 `unavailable`。
4. 流只出现在 `Handles.<iface>.streams`：进程内是 `() => AsyncIterable<item>`，IPC 是以请求 id 为流 id 的 `$/stream` 序列；从创建起缓冲、单消费者、只能开一次。
5. 纯函数（`rank`、`deriveParams`、`next`）标 `pure: true`，在调用方线程执行，不远程化；它们所在的槽位标 `transport: 'in-process'`。
6. TypeScript 接口由描述推导：`ClientOf<typeof Methods, typeof Handles>`（§2.4），不手写接口；每个方法声明 `timeoutMs`（`0` = 无限，只许流的打开方法用）。
7. 每个 `transport: 'any'` 的槽位都要过回环编解码测试（`00-plugin-kernel.md` §12）。

### 2.3 schema 约定

zod 4（pnpm catalog 钉版），由 `z.ts` 统一导出；manifest、profile、patch、插件 Config 用 `z.strictObject`；契约消息与事件载荷用 `z.object`（丢弃未知键）；稀疏映射用 `z.partialRecord`；禁止 `async refine` 与会抛异常的 `transform`。契约里的"任意 JSON"一律 `JsonValue`，不用 `z.unknown()`（`BrainEvent` 的 `args` / `result`、`AppendRequest.payload`、`LiwaErrorShape.data`、IPC 的 `params` / `result` / `data`、`Request.body` / `Response.body` / `Frame.items` 都是）。可导出到 JSON Schema（draft 2020-12）的子集：对象、数组、枚举、字面量、联合、可选、默认值、字符串与数值约束；`transform`、自定义 `refine`、`Date`、`void` 不进契约。同一组正反例分别对 zod、导出的 JSON Schema、JSON 往返三者测试。

### 2.4 `ClientOf`（`common.ts`）

```ts
type MethodDesc = { params: ZodType; result: ZodType; timeoutMs: number; pure?: true };
type Fn<D extends MethodDesc> = (ctx: CallContext, params: z.input<D['params']>) => Promise<z.output<D['result']> extends null ? void : z.output<D['result']>>;   // result 为 null 的方法返回 void
type HandleOf<H> = { readonly handle: string } & { [M in keyof H['methods']]: Fn<H['methods'][M]> } & { [S in keyof H['streams']]: () => AsyncIterable<z.output<H['streams'][S]['item']>> };
export type ClientOf<M, H = {}> = { [K in keyof M]: K extends CreatedBy<H> ? (ctx, params) => Promise<HandleOf<IfaceCreatedBy<H, K>>> : Fn<M[K]> };
```

每个槽位文件一条 `expectTypeOf` 测试守住推导结果有预期的方法名；描述是唯一真源。

## 3 manifest、profile、patch 与装配树（`manifest/`）

```ts
export const Runtime = z.enum(['in-process', 'subprocess']);
export const Launch = z.strictObject({ cmd: z.string().min(1), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional() });   // 工作目录 = 包目录
export const Manifest = z.strictObject({
  manifestVersion: z.literal(MANIFEST_VERSION), kernelApi: z.literal(KERNEL_API_VERSION).optional(),   // data 包不写，其余必写（kernel 核）
  id: PluginId, kind: z.enum(['required', 'builtin', 'external', 'data']), runtime: Runtime.optional(), multiInstance: z.boolean().optional(),
  provides: z.partialRecord(SlotName, z.strictObject({ contract: z.number().int().positive(), impl: ImplId, meta: JsonValue.optional() })).optional(),   // meta 按 SLOT_DEFS[slot].meta 二次校验
  consumes: z.partialRecord(z.union([ViewKey, ServiceKey]), z.number().int().positive()).optional(),
  launch: Launch.optional(), resources: z.strictObject({ maxRssMb: z.number().int().positive(), cpu: z.enum(['background', 'utility']), logMbPerDay: z.number().int().positive() }).optional(),
  data: z.strictObject({ slot: SlotName, file: z.string().min(1) }).optional(),
});
export const ProfileEntry = z.strictObject({ id: PluginId, as: ImplId.optional(), package: z.string().min(1).optional(), config: JsonValue.optional(), disabled: z.boolean().optional() });
export const Profile = z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/), stage: Stage, plugins: z.array(ProfileEntry),
  memberDefaults: SlotBindings.optional(), members: z.partialRecord(MemberId, SlotBindings).optional() });
export const Binding = z.union([ImplId, z.null(), z.array(ImplId)]);           // 有序槽位用数组；形状按基数核对
export const PatchOp = z.union([
  z.strictObject({ replace: z.strictObject({ id: PluginId, config: JsonValue }) }),            // id 是实例 id
  z.strictObject({ disable: z.strictObject({ id: PluginId, reason: z.string().optional() }) }),
  z.strictObject({ enable: z.strictObject({ id: PluginId }) }),
  z.strictObject({ bind: z.strictObject({ member: MemberId.optional(), slot: SlotName, binding: Binding }) }),
  z.strictObject({ insert: ProfileEntry.extend({ package: z.string().min(1), after: PluginId.optional() }) }),   // 只在仓库内的 profile 文件里允许
  z.strictObject({ remove: z.strictObject({ id: PluginId }) }),
]);
export const PATCH_LAYERS = ['profile', 'local', 'owner', 'cli'] as const;
export const EntryPlan = z.object({ id: PluginId /* 实例 id */, plugin: PluginId, package: z.string().optional(), version: z.string().optional(), kind: PluginKind, runtime: Runtime,
  status: z.enum(['enabled', 'disabled']), layer: z.enum(PATCH_LAYERS).or(z.literal('required')), reason: z.string().optional(), service: ServiceKey.optional(),
  provides: z.array(z.object({ slot: SlotName, impl: ImplId, contract: z.number().int(), meta: JsonValue.optional() })), consumes: z.array(z.string()), commands: z.array(CommandId) });
export const ServiceGraph = z.object({ providers: z.partialRecord(ServiceKey, PluginId), order: z.array(PluginId), missing: z.array(z.object({ service: ServiceKey, wantedBy: PluginId })),
  duplicates: z.array(z.object({ service: ServiceKey, plugins: z.array(PluginId) })), cycles: z.array(z.array(PluginId)), layerViolations: z.array(z.object({ plugin: PluginId, injects: ServiceKey })) });
export const SlotPlan = z.object({ slot: SlotName, cardinality: Cardinality, providers: z.array(z.object({ impl: ImplId, instance: PluginId, plugin: PluginId })),
  bindings: z.array(z.object({ scope: z.string(), binding: Binding, layer: z.string() })) /* 有效绑定 */, requiredBy: ServiceKey.optional(), satisfied: z.boolean() });
export const AssemblyPlan = z.object({ profile: z.string(), stage: Stage, build: z.string(), entries: z.array(EntryPlan), services: ServiceGraph, slots: z.array(SlotPlan),
  problems: z.array(z.object({ severity: z.enum(['fatal', 'warn']), entry: PluginId.optional(), message: z.string() })), assemblyHash: z.string(), hashInput: JsonValue });
```

`SlotName`、`ServiceKey`、`ViewKey`、`Cardinality` 各只在一处定义（`slots/defs.ts`、`services.ts`）并被各 schema 引用，不重复定义。

## 4 槽位、服务键、视图、层表

### 4.1 槽位清单（`slots/defs.ts` 的 `SLOT_DEFS`）

| 槽位 | 基数 | 作用域 | transport | requiredBy | consumedBy | Meta | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `brain.provider` | bound | member | any（带 Handles） | brains | brains | §5.1 | 定稿于 §5.1 |
| `memory.engine` | member-single | member | in-process | memory | memory | `z.undefined()` | 定稿于 `05-memory.md` §3.5 |
| `growth.engine` | member-single | member | in-process | self | self、skills | `{ jobs: JobDecl[] }` | 随 `06-growth.md` 定稿 |
| `social.model` | member-single | member | in-process | people | people | `z.undefined()` | V3 前细化 |
| `social.pack`、`persona.template` | list（data 包） | global | in-process | — | people；self | `z.undefined()` | 纯数据，V2 / m0 |
| `job.trigger` | list | global | in-process | scheduler | scheduler | §5.5 `{ kinds[] }` | 定稿于 §5.5 |
| `ability.embed` | registry | global | any | —（缺了降级） | abilities | §5.6 | 定稿于 §5.6 |
| `ability.speech`、`ability.vision`、`ability.world` | registry | global | any | — | abilities | 随 09 | 随 09 |
| `gate.policy` | chain | global | in-process | — | senses | `z.undefined()` | V2，只定形状 |
| `toolport.tool` | list | global | in-process | — | toolport | `{ tools: ToolDef[] }` | V3，只定形状 |
| `form.adapter` | list | global | any | formhost（V2） | formhost | 随 V2 | V2，只定形状 |
| `gateway.command` | list | global | any | — | gateway | `{ commands: CommandSpec[] }` | 定稿于 `00-commands.md` §3.2 |

`consumedBy` 是会 `resolve` 该槽位的服务，kernel 用它推槽位边（`00-plugin-kernel.md` §5.5）；`requiredBy ∈ consumedBy` 由 contracts 的测试守住。`SLOT_DEFS[slot].meta` 引用各槽位文件导出的 `Meta`；还没写文件的槽位用 `z.undefined()`（manifest 不得带 meta）。`slots/index.ts` 导出 `SLOT_CONTRACTS: Record<SlotName, { Meta; Methods; Handles? }>`，回环编解码与 IPC 代理由它枚举。界面槽位（`ui.*`）归 console，不在 kernel 的注册表里，随 08 定。

### 4.2 服务键、版本、视图、层表、登记类方法（`services.ts`）

- `SERVICE_KEYS`：`journal guard procs brains abilities formhost workspace notify roster self body memory people skills senses attention will scheduler tasks outbox minds context actions toolport gateway`。`SERVICE_VERSIONS[key]`：进程内插件 `consumes` 的服务 API 版本，第一版全部为 1。
- `STAGE_SETS`：`m0` = journal、guard、procs、brains、minds、context、actions、senses、attention、outbox、toolport、gateway；`m1` 加 roster、self、body、people、will、scheduler、tasks、workspace、notify；`v1` = 全部减 formhost（formhost 随 V2 的新阶段 `v2` 加入，到时 `Stage` 枚举加一项）。
- `PLUGIN_VIEWS = ['procs.spawn']`，`VIEW_VERSIONS = { 'procs.spawn': 1 }`；`views/procs.spawn.ts` 给方法描述：`Methods = { spawn: { params: { cmd, args, cwd, env, group? }, result: { pid, handle }, timeoutMs: 10_000 } }`，`Procs.spawn` 的进程内签名由它推导加 `id`。以后：`storage.derived`、`abilities.embed`。
- **`SERVICE_LAYERS`**（`service-layers.json`，自上而下）：

  ```json
  { "layers": [ { "key": "access", "label": "接入", "services": ["gateway", "toolport"] },
                { "key": "orchestration", "label": "编排", "services": ["senses", "attention", "will", "scheduler", "tasks", "outbox"] },
                { "key": "runtime", "label": "运行", "services": ["minds", "context", "actions"] },
                { "key": "ledgers", "label": "账本", "services": ["roster", "self", "body", "memory", "people", "skills"] },
                { "key": "resources", "label": "资源", "services": ["brains", "procs", "formhost", "abilities", "workspace", "notify"] },
                { "key": "guard", "label": "守护", "services": ["guard"] },
                { "key": "foundation", "label": "基础", "services": ["journal"] } ] }
  ```

  `services.ts` 导入它并导出 `SERVICE_LAYERS` 与 `layerIndexOf(key)`；测试守住"每个服务键恰好出现一次"。kernel 第 1 阶段：required 的 `inject` 只许指向同层或更低层；`.dependency-cruiser.cjs` 用 `require` 读同一文件生成 core 的层规则（`db/` 目录由 cruiser 配置并入基础层，它不是服务）。
- **`REGISTRAR_METHODS`**：`{ journal: ['subscribe', 'registerProjection'] }`，各服务落地时增补；kernel 据此把返回的释放函数自动挂到实例、把回调包进实例的 `AsyncLocalStorage`（`00-plugin-kernel.md` §8.2）。

## 5 槽位契约

### 5.0 文件模板

```ts
/** 槽位：brain.provider ｜ 版本 1（1 = 首版）｜ 定义在 SLOT_DEFS ｜ 回退：解析不到或 unavailable 时，brains 按 roster 的备用名单依次试 */
export const CONTRACT_VERSION = 1;
export const Meta = z.strictObject({ ... });                             // manifest provides.<slot>.meta；没有就 export const Meta = z.undefined()
export const Methods = { createSession: { params, result: Handle, timeoutMs: 30_000 }, ... } as const;
export const Handles = { session: { createdBy: ['createSession', 'resumeSession'], methods: { ... }, streams: { events: { item: BrainEvent } } } } as const;
export type BrainClient = ClientOf<typeof Methods, typeof Handles>;      // 由描述推导；不手写接口
```

### 5.1 `brain.provider`

```ts
export const PersonaInjection = z.enum(['system_prompt', 'preset_append', 'developer_instructions', 'file']);
export const Meta = z.strictObject({                                       // 能力声明（four-layers §4）：本体据此决定哪些语义要由投递器在回合边界补
  streaming: z.boolean(), resume: z.boolean(), nativeTools: z.boolean(), permissionHook: z.boolean(), rollback: z.boolean(), modelSwitch: z.boolean(),
  delivery: z.strictObject({ nextStep: z.boolean(), nextTurn: z.boolean(), cancelKeepsQueue: z.boolean() }),   // 送达语义矩阵；false 的由 minds 的投递器补（02 §4.2）
  compaction: z.enum(['none', 'switchable', 'always_on']),                   // 自带压缩能不能关；always_on 的提供方不能跑实例会话（02 §4.1）
  budget: z.strictObject({ inferences: z.boolean(), toolCalls: z.boolean(), concludeOn: z.boolean() }),   // 回合预算三项能否在提供方内落实；false 的由本体看门狗与 toolport 兜（02 §4.5）
  usage: z.enum(['full', 'tokens', 'quota', 'none']),
  personaInjection: z.strictObject({ instance: PersonaInjection, work: PersonaInjection.optional(), think: PersonaInjection.optional(), own: PersonaInjection.optional(), tidy: PersonaInjection.optional() }),   // 缺的键按 instance
});
export const SessionOwner = z.union([z.object({ instanceId: z.string().min(1), gen: z.number().int().positive() }), z.object({ taskId: z.string().min(1), gen: z.number().int().positive() })]);   // 实例或活的编号 + 会话代次；换新、回收重建、换提供方都换代
export const SessionConfig = z.object({
  member: MemberId, mindKind: MindKind, owner: SessionOwner,
  persona: z.object({ stable: z.string(), notes: z.string(), version: z.string() }),   // stable = 人设十段（所有实例逐字相同，放最前）；notes = 实例说明或活的说明（放末尾）；version = 人设版本，陈旧上限按它算（02 §4.1、§4.3）
  cwd: z.string(), dataDir: z.string(),                                     // dataDir 下是本代会话的日志目录，由灵鲸管理、随删除级联、备份不含
  kernelTools: z.union([z.object({ endpoint: z.string(), token: z.string(), tools: z.array(ToolDef) }), z.object({ native: z.array(ToolDef), token: z.string() })]),   // native 分支也带令牌：原生工具被调用时适配器经 toolport.invoke(token, tool, args) 交回本体；令牌绑 owner 的编号与代次，换代即作废（02 §4.4）
  nativeToolPolicy: z.enum(['none', 'readonly', 'worktree']), model: z.string(), env: z.record(z.string(), z.string()).optional(),
  limits: z.object({ maxInferencesPerTurn: z.number().int().positive(), maxToolCallsPerTurn: z.number().int().positive(), watchdogMs: z.number().int().positive() }),   // 回合预算（02 §4.5）
  concludeOn: z.array(z.string()).min(1),                                   // 调用其一且成功后结束回合（底座：工具结果 concludesTurn；Claude Code：PostToolBatch）
});
export const ResumeHandle = z.object({ provider: z.string(), sessionRef: z.string(), createdAt: Iso });
export const TurnInput = z.object({ blocks: z.array(z.union([{ kind: 'text', text }, { kind: 'block', name, text }, { kind: 'image', blob: BlobRef }])) });
export const FailureCategory = z.enum(['retryable', 'timeout', 'auth', 'refused', 'quota', 'process_exit', 'context_exceeded', 'cancelled']);   // 回合级；context_exceeded 不进 ErrorCategory，它是 minds 的换新信号
export const Usage = z.object({                                             // 报不出的字段留空，不许填 0
  tokens: z.object({ input, output, cacheRead?, cacheWrite? }).optional(),
  context: z.object({ used: z.number().int(), max: z.number().int() }).optional(),           // minds 据此"接近上限先写回再换新"
  quotaWindows: z.array(z.object({ id: z.string(), usedPercent: z.number().min(0).max(100), resetsAt: Iso.optional(), windowMinutes: z.number().int().optional() })).optional(),   // id 由适配器给：'5h'、'7d'、'primary'、'secondary'
  balances: z.array(z.object({ id: z.string(), used: z.number().optional(), remaining: z.number().optional(), limit: z.number().optional(), unit: z.enum(['usd', 'credits', 'requests', 'tokens']), resetsAt: Iso.optional() })).optional(),
  inferences: z.number().int().optional(), providerReportedCostUsd: z.number().optional(),  // SDK 估价，guard 不用
});
export const ToolCallDetail = z.discriminatedUnion('type', [                // 闭合、只增不删；客户端据此画"改了哪个文件"
  { type: 'shell', command: z.string(), cwd: z.string().optional() }, { type: 'read', path }, { type: 'edit', path, unifiedDiff: z.string().optional() }, { type: 'write', path }, { type: 'search', query }, { type: 'fetch', url }, { type: 'other' },
]);
export const PermissionEffect = z.enum(['allow_once', 'allow_session', 'allow_always', 'deny_once', 'deny_always', 'cancel']);
export const PermissionOption = z.object({ id: z.string(), label: z.string(), effect: PermissionEffect });
export const BrainEvent = z.discriminatedUnion('kind', [
  { kind: 'turn.started', turnId }, { kind: 'turn.completed', turnId, usage: Usage }, { kind: 'turn.interrupted', turnId },
  { kind: 'turn.failed', turnId, category: FailureCategory, message, retryable: z.boolean() },
  { kind: 'session.exited', category: FailureCategory, message },                                  // 两个回合之间 CLI 退出
  { kind: 'item.message', turnId, itemId, delta: z.string(), final: z.boolean() },               // delta 是同一 itemId 自上一条起的增量；final 时 delta 可为空；消费方累计
  { kind: 'item.reasoning', turnId, itemId, summary },
  { kind: 'item.tool_call.started', turnId, callId, tool, args: JsonValue, native: z.boolean(), batch: z.number().int().min(1).optional(), detail: ToolCallDetail.optional() },   // batch：同一次模型输出里并行发出的调用共享一个批号，回合内从 1 递增；判不出批的留空，不许填 1
  { kind: 'item.tool_call.completed', turnId, callId, result: JsonValue, ok: z.boolean() },
  { kind: 'permission.request', turnId, requestId, category: z.enum(['tool', 'plan', 'question', 'other']), tool, args: JsonValue, detail: ToolCallDetail.optional(), options: z.array(PermissionOption).min(1) },
  { kind: 'usage.update', usage: Usage.partial() },                                                // 额度窗口与余额是提供方级的，经这里上报，不要求每个 turn.completed 都带
]);
const Handle = z.object({ handle: z.string() });
export const Methods = { createSession: { params: SessionConfig, result: Handle, timeoutMs: 30_000 }, resumeSession: { params: z.object({ resume: ResumeHandle, cfg: SessionConfig }), result: Handle, timeoutMs: 30_000 } } as const;
export const Handles = { session: { createdBy: ['createSession', 'resumeSession'], methods: {
  startTurn: { params: z.object({ input: TurnInput }), result: z.object({ turnId }), timeoutMs: 30_000 },
  deliver: { params: z.object({ input: TurnInput, semantics: z.enum(['next_step', 'next_turn']), wake: z.boolean(), expectedTurnId: z.string().optional() }), result: z.enum(['accepted', 'unsupported', 'unavailable']), timeoutMs: 10_000 },   // next_step = 正在跑的回合下一步可见（底座 steer）；next_turn = 只在下一回合可见（底座 followup，一次一批）；合批在本体完成
  cancel: { params: z.object({ reason: z.enum(['preempt', 'watchdog', 'hard_limit', 'pause', 'drain', 'owner']), keepQueue: z.boolean() }), result: z.null(), timeoutMs: 10_000 },   // 幂等；keepQueue 只保留提供方那边未开始的输入，已被回合拿到的由本体放回
  respondToPermission: { params: z.object({ requestId, optionId: z.string(), reason: z.string().optional() }), result: z.null(), timeoutMs: 10_000 },
  persistence: { params: z.object({}), result: ResumeHandle.nullable(), timeoutMs: 5_000 }, canStopRuntime: { params: z.object({}), result: z.boolean(), timeoutMs: 5_000 }, close: { params: z.object({}), result: z.null(), timeoutMs: 30_000 },
}, streams: { events: { item: BrainEvent } } } } as const;
export type BrainClient = ClientOf<typeof Methods, typeof Handles>;
```

规则与依据：

| 项 | 规则 | 依据 |
| --- | --- | --- |
| 权限请求 | 适配器把原生请求翻成 `options[]`；`optionId` 对不上 → 按 `deny_once` 处理并记日志；`cancel` = 拒绝并中断回合；`allow_always` / `deny_always` 要不要放进选项由 toolport / guard 在主人批准的上限内决定，适配器只翻译；第一版主人可见的选项：`allow_once`、`allow_session`、`deny_once`、`cancel`（决策 35 ③："本会话允许"进第一版） | Codex `CommandExecutionApprovalDecision { Accept, AcceptForSession, AcceptWithExecpolicyAmendment, ApplyNetworkPolicyAmendment, Decline, Cancel }`，`Decline` 回合继续、`Cancel` 立即中断〔一手，`codex-rs/app-server-protocol/src/protocol/v2/item.rs:66–87`〕；Helm `AgentPermissionRequest { kind: 'tool'\|'plan'\|'question'\|'mode'\|'other', actions[]{ id, label, behavior, intent } }` 与 `AgentPermissionResponse.deny.interrupt`〔一手，`packages/server/src/server/agent/agent-sdk-types.ts:470–508`〕；ACP `session/request_permission` 的 `options[]{ optionId, kind ∈ allow_once \| allow_always \| reject_once \| reject_always }`〔一手，verify-contracts C2 引用的 v2 tool-calls.md〕 |
| 额度 | `quotaWindows[]` 按百分比、带重置时间，`balances[]` 给余额；都在 `usage.update` 上报；guard 的总闸同时看钱和窗口 | Codex `RateLimitSnapshot { primary, secondary, credits }`、`RateLimitWindow { used_percent, window_duration_mins, resets_at }`〔一手，`v2/account.rs:664–672、752–758`〕；Helm `ProviderUsageSchema { windows[]{ id, usedPct, resetsAt }, balances[]{ id, used, remaining, limit, unit } }`〔一手，`packages/protocol/src/messages.ts:6374–6445`〕 |
| 失败类别 | `context_exceeded`（Codex `contextWindowExceeded`）、`timeout`（CLI 自报的流断开或超时）、`cancelled`（被暂停、总闸或调用方取消，不得当作可重试去换下一家） | verify-contracts C5〔一手〕 |
| 人设注入 | 按会话种类配：同一个 Claude 适配器对实例会话 / 想事 / 整理用 `system_prompt`、对干活用 `preset_append`；底座自带 agent 对实例会话用预设里的人设行（`complete`） | 决策 33；`06-growth.md` §4.3；four-layers §2.16 |
| 批号与增量 | 见代码注释；探针据 `batch` 测"reply 是否在第一批" | Claude SDK 的 `PostToolBatch` 钩子以批为单位〔二手，`subagent-notes/cli-claude-sdk-codex-app-server.md`〕；Codex 的 item 没有批概念，留空 |
| 适配器必须 | CLI 退出即报 `session.exited` 或 `turn.failed`；中断幂等；`turn.completed` 必带 usage；人设在每次拉起与续接时都带上；经 `procs.spawn` 拉进程，不 import `node:child_process`；不支持的送达语义恒回 `unsupported` 且 `Meta.delivery` 里对应项为 false（ACP 的 `nextStep: false`），由本体的投递器在回合边界补；`compaction: 'always_on'` 的提供方不接实例会话 | Paseo 适配器规则〔一手，`paseo-architecture` Q4〕；底座 `followup` 每条自成一轮、`inject` 在下一步被认领〔一手，`liwa-dsh/packages/core/agent/src/runtime-types.ts`〕 |

有效绑定由 roster 的大脑配置给出：每个成员 × 会话种类（想事可按立场 / 出主意分）一份 `{ impl, model, fallback: impl[] }`，实例会话与活一样可任选提供方、默认底座自带 agent（决策 43），由 minds 读出后传给 brains；适配器 config 只放适配器级参数，模型走 `SessionConfig.model`。`SessionConfig` 以后只加可选字段（会话 id、推理强度等随 01）。

### 5.2 `memory.engine`

见 `05-memory.md` §3.5，按 §2.2 改为：`prepareIngest(ctx, input) → SleepAsk` 与 `interpretIngest(ctx, { ask, answer }) → SleepProposal`、`prepareConsolidate` / `interpretConsolidate` 两对方法，模型调用由睡眠作业的编排（minds）代问；`rank(ctx, { candidates, situation })` 标 `pure`；`forget(ctx, { activation, now: Iso })` 标 `pure`。`Meta = z.undefined()`。`MindContext` 是 required 之间的进程内类型，不是槽位契约。

### 5.3 `growth.engine`

`renderPersona(ctx, { member, mind, birth, traits, growth, selfBrief, presence?, todayNotes? }) → { segments, versions, sectionChars, truncated[] }`（只返回可替换段落）；`deriveParams(ctx, { traits, rate }) → BodyParams`（pure）；`proposeGrowth` / `interpretGrowth`、`proposeSelf` / `interpretSelf` 两对；`Meta = { jobs: JobDecl[] }`。随 `06-growth.md` 定稿（含它多出的三对方法）。

### 5.4 `social.model`

`relationDelta(ctx, { event, state, params }) → { trust, closeness, rule }`（pure）；`defaultPermissions(ctx, { role }) → PermissionSet`，只在主人已批准的上限内生效。

### 5.5 `job.trigger`

```ts
export const TriggerKind = z.string().regex(/^[a-z][a-z_]*$/);
export const Meta = z.strictObject({ kinds: z.array(z.strictObject({ kind: TriggerKind, specSchema: JsonSchemaObject })).min(1) });   // 一个实现、多种触发；kind 在全部 job.trigger 提供方间唯一（第 1 阶段查）
export const Methods = { next: { params: z.object({ kind: TriggerKind, spec: JsonValue, now: Iso, lastRunAt: Iso.optional() }), result: Iso.nullable(), timeoutMs: 1_000, pure: true } } as const;
```

内置 `plugins/job-trigger-time` 的 impl 是 `time`，`kinds` 为 `cron`、`once`、`interval`；事件型、空闲型触发由 scheduler 持有，第一版不开放给插件。

### 5.6 `ability.embed`

`Meta = { model, dims, maxChars, local }`；`embed(ctx, { texts, dims? }) → { vectors: base64 Float32 小端 | number[][], dims, model, usage?: Unit }`；`estimate(ctx, { texts }) → Unit`。回退：abilities 按 registry 的有序绑定试下一家。

### 5.7 只定形状的三个

`form.adapter`（V2）：`deliver(ctx, { place, content, idemKey }) → receipt`、`Handles.inbound.streams.events`（入站标准消息，含平台消息号作去重键）、在场者快照、平台限制声明；`gate.policy`（V2）：`decide(ctx, input) → 'reply' | 'ignore' | undefined`；`toolport.tool`（V3）：`Meta = { tools: ToolDef[] }`，`propose(ctx, { tool, args }) → Action`。

### 5.8 `gateway.command`

定稿于 `00-commands.md` §3.2：`Meta = { commands: CommandSpec[] }`，`Methods = { run, stream }`，`transport: 'any'`，过回环编解码。

## 6 经历流事件与追加协议（`events/`）

```ts
export const StreamRef = z.object({ kind: z.enum(['member', 'instance', 'place', 'task', 'system']), id: z.string().min(1) });
export const EventTypeName = z.string().regex(/^[a-z]+(\.[a-z_]+)+\.v\d+$/);   // 对象.动作.v<n>：首段是事件所属的对象（turn、session、message、effect、task、body、kernel、plugin、slot…），不是模块名
export const EventEnvelope = z.object({
  pos: EventId, stream: StreamRef, seq: z.number().int().nonnegative(), type: EventTypeName, actor: Actor, at: Iso,
  causeId: EventId.optional(), correlationId: z.string().optional(),
  source: z.object({ placeId: PlaceId.optional(), presenceSnapshotId: z.string().optional(), audienceId: AudienceRefSchema, principal: Principal.optional(), sourceKind: SourceKind, trust: z.number().min(0).max(1), taint: z.boolean() }),
  payloadRef: z.object({ id: z.string() }).optional(),
});                                                                            // 没有独立的 version 字段：类型名里的 .v<n> 是版本的唯一真源
export type EventEnvelope = Omit<z.infer<...>, 'source'> & { source: Omit<Source, 'audienceId'> & { audienceId: AudienceRef } };   // TS 类型用 branded AudienceRef；journal 解析后转成 branded
export const AppendRequest = z.object({ stream: StreamRef, type: EventTypeName, actor: Actor, payload: JsonValue.optional(), expectedSeq: z.number().int().optional(), causeId: EventId.optional(), correlationId: z.string().optional(), source: EventEnvelope.shape.source });   // pos、seq、at 由 journal 生成；source 由可信的所有者模块给，TS 类型要求 AudienceRef
export const CommittedEvent = EventEnvelope;
```

`ledgers/journal.ts`：

```ts
export interface JournalReader {                                              // 插件（builtin）拿到的视图
  read(q: { stream?: StreamRef; after?: EventId; to?: EventId; limit?: number; order?: 'asc' | 'desc' }): Promise<CommittedEvent[]>;   // after 排他、to 包含；limit 缺省 JOURNAL_READ_DEFAULT_LIMIT = 100，上限 1 000
  subscribe(filter: { stream?: StreamRef; types?: string[]; after?: EventId }, cb: (event: CommittedEvent) => void): Unsubscribe;      // after 给了就先补发 after 之后的再实时，顺序保证
  getPayload(id: string): Promise<JsonValue | null>;                        // null = 已删
  putPayload(payload: JsonValue): Promise<{ id: string }>;
}
export interface Journal extends JournalReader {                              // required 与 kernel
  append(req: AppendRequest): Promise<CommittedEvent>;                        // expectedSeq 不符抛 LiwaError('conflict')
  registerProjection(def: { name: string; kind: 'inline' | 'async'; handles: string[]; apply(event): void | Promise<void>; rebuild(): Promise<void> }): Unsubscribe;
  erasePayload(ownerToken: OwnerToken, id: string, reason: string): Promise<void>;
  checkpoint(name: string): Promise<EventId>;                                 // 只记已提交的 pos
}
```

规则：`EVENT_TYPES` 第一版只有 contracts 能定义；journal 追加时校验，未知类型拒绝；载荷里不得复制信封字段；消费方按 `pos` 引用不复制载荷；系统流事件用 `AUDIENCE_OWNER = 0`；大脑事件的批号语义在 §5.1；事件载荷的破坏性变化走一次性迁移。**写入纪律**：能 `append` 的只有 required（经 `Services.journal`）和 kernel；builtin 只拿 `JournalReader`（类型与运行时都拒绝 `append`）；`source` 只由所有者模块构造，插件不能提交。

## 7 账本 API（`ledgers/`）

`Services`（required 之间）与 `PluginServices`（`Omit<Services, 'journal'> & { journal: JournalReader }`，给 builtin）两个类型，键与 `SERVICE_KEYS` 一一对应：`Journal`、`Guard`、`Procs`、`Brains`、`Abilities`、`Formhost`、`Workspace`、`Notify`、`Roster`、`SelfLedger`、`Body`、`Memory`、`People`、`Skills`、`Senses`、`Attention`、`Will`、`Scheduler`、`Tasks`、`Outbox`、`Minds`、`ContextAssembler`、`Actions`、`Toolport`、`Gateway`；未定稿的先用 `ServiceStub<K>` 占位。参数对象、返回 Promise、错误只抛 `LiwaError`；凡登记回调的方法返回释放函数并登记进 `REGISTRAR_METHODS`。`MindContext`（`now: Iso`，可带 `canSeeEvent` 函数）是进程内类型。主人专属操作要带 gateway 签发的 `OwnerToken`（能力对象，只在进程内流转，不进 contracts 的 schema）。

## 8 内核工具目录（`tools/spec.ts`）

```ts
export interface ToolSpec<P, R> { id: string /* ^[a-z_]+$ */; description: string; params: ZodType<P>; result: ZodType<R>; mindKinds: MindKind[]; firstBatch?: boolean; sideEffect: 'none' | 'propose' }
export const ToolDef = z.object({ id: z.string().regex(/^[a-z_]+$/), description: z.string(), schema: JsonSchemaObject });   // 给适配器的 JSON Schema 形式
export function toToolDef(spec: ToolSpec): ToolDef;                          // z.toJSONSchema，只许可导出子集
```

第一批：实例会话 `reply`（含可选"用到的记忆号"与回执号 / 承诺号引用）、`no_reply`、`say`、`inner`、`commit`、`ponder`、`dispatch`、`do`、`manage`、`remind`、`answer`、`recall`、`look`；想事活 `conclude`、`decide`、`pursue`、`get_report`；干活 `ack`、`report`、`ask`、`spawn`；她自己的事 `report`；整理 `submit`（以 `overall.md` §5.2 为准）。zod 随 02 / 03 / 04 落。工具只"提出动作"；原生注入的工具经 `toolport.invoke(token, tool, args)` 回到本体。`ToolDef` 只在这里定义，`brain.provider` 与 `toolport.tool` 引用它。

## 9 前后端信封（`protocol/client.ts`）

```ts
export const CLIENT_PROTOCOL_VERSION = 1;
export const ClientKind = z.enum(['cli', 'console', 'desktop', 'mobile']);
export const PROTOCOL_OPS = ['commands.list', 'sub.open', 'sub.close'] as const;   // 协议内部操作，占保留组；其余 op 都是命令 id（00-commands §3.4）
export const Hello   = z.object({ t: z.literal('hello'), v: z.number().int().positive(), build: z.string(), client: ClientKind, token: z.string(), resume: z.array(z.object({ sub: z.string(), cursor: z.string() })).optional() });
export const Welcome = z.object({ t: z.literal('welcome'), v: z.number().int().positive(), build: z.string(), limits: z.object({ maxFrameBytes: z.number().int(), maxInflight: z.number().int() }), features: z.array(z.string()) });
export const Request = z.object({ t: z.literal('req'), id: z.string(), op: z.union([CommandId, z.enum(PROTOCOL_OPS)]), body: JsonValue, idem: z.string().optional() });   // mutation 命令必带 idem；同一 idem 第二次返回第一次的 Response
export const Response = z.discriminatedUnion('ok', [ { t: 'res', id, ok: true, body: JsonValue }, { t: 'res', id, ok: false, error: LiwaErrorShape } ]);
export const Frame = z.object({ t: z.literal('sub'), sub: z.string(), cursor: z.string(), mode: z.enum(['snapshot', 'delta']), reason: z.enum(['no_cursor', 'cursor_expired', 'epoch_changed', 'too_large', 'degraded']).optional(), items: z.array(JsonValue) });
export const WS_CLOSE_VERSION_MISMATCH = 4001;
```

规则：gateway 先只解析 `{ t, v }`，`v ≠ CLIENT_PROTOCOL_VERSION` 时回 `Response.Err{ id: 'hello', error: { category: 'invalid_input', code: 'protocol.version_mismatch', data: { server: { v, build }, client: { v, build } } } }` 再以 `WS_CLOSE_VERSION_MISMATCH` 关闭；客户端提示刷新或升级（不做兼容层）。`resume[]` 让重连一次带回各订阅的游标；`Frame.mode = 'snapshot'` 是整页重发（首次、游标失效、太大或服务端降级），`'delta'` 是增量；`reason: 'degraded'` 表示中间丢了逐字增量、客户端按条目补。订阅种类、游标格式、合帧与主人接口清单在 07 定。依据：Helm `hello { clientId, clientType, protocolVersion: int, auth }`〔一手，`packages/protocol/src/messages.ts:7697–7712`〕、目录同步 `mode: 'snapshot' | 'changes'` 与 `reason`、时间线 `epoch / reset / staleCursor / gap`〔一手，`messages.ts:1276–1283、4748–4758`〕；`overall.md` §10.2–§10.3。

## 10 进程外插件的 IPC（`protocol/ipc.ts`）

- `IPC_PROTOCOL_VERSION = 1`；传输 fd 3 管道，UTF-8，一行一条 JSON，`IPC_MAX_LINE_BYTES` 1 MiB；不支持 batch 数组；`id` 为字符串；非法消息计数告警、不中断。
- 消息分类先于校验：有 `method` 且有 `id` → 请求；有 `method` 无 `id` → 通知；无 `method` 有 `id` → 响应；分类后用该类的 strict schema 校验，`id` 不是字符串、`result` 与 `error` 并存、请求与通知混合一律拒绝（不降级成另一类）。
- `Request{ jsonrpc:'2.0', id, method, params?: JsonValue }`、`Response{ jsonrpc, id, result: JsonValue } | { jsonrpc, id, error: { code: int, message, data: LiwaErrorShape } }`（`data` 必填；传输层错误用 `-32700…-32600` 且 `data` 为传输层自己的形状）、`Notification{ jsonrpc, method, params? }`。
- 方法：`"<slot>/<method>"`、`"<slot>/<iface>.<method>"`（句柄，参数带 `handle`）、`"<slot>/<iface>.<stream>"`（宿主打开流）、`kernel/hello`（宿主 → 插件：`{ kernelVersion, ipcProtocolVersion: int, contracts: Record<slot, int>, views: Record<view, int> }`，响应 `{ manifest, pid, ipcProtocolVersion: int }`，版本比对在代码里，不符即禁用）、`kernel/ready`、`kernel/drain{ deadlineMs }`、`kernel/health`、`kernel/ping`、`kernel/shutdown{ graceMs }`、`kernel/view.<视图>`（插件 → 宿主，仅声明过的视图）、`$/stream{ id, seq, kind: 'item' | 'end' | 'error', data?: JsonValue }`、`$/ack{ id, seq }`、`$/cancel{ id }`。插件 → 宿主只有两条路：视图调用、宿主先开的流。成功无值返回 `null`。
- 限制：`IPC_MAX_INFLIGHT` 64；`IPC_STREAM_ACK_EVERY` 256；方法超时按契约；订阅类流的保活与活动请求的超时分开。

## 11 错误、退出码（`errors.ts`）

| 类别 | 默认 retryable | JSON-RPC | 含义 |
| --- | --- | --- | --- |
| `retryable` | 是 | -32000 | 暂时性故障（网络、限流） |
| `timeout` | 是 | -32001 | 超时；副作用是否发生未知 |
| `unavailable` | 是 | -32002 | 槽位无实现、提供方失效或熔断、句柄失效、本体未就绪 |
| `auth` | 否 | -32003 | 鉴权失败 |
| `quota` | 否 | -32004 | 额度用尽 |
| `refused` | 否 | -32005 | 内容被拒 |
| `process_exit` | 是 | -32006 | 子进程退出 |
| `invalid_input` | 否 | -32007 | 传参不合 schema |
| `invalid_output` | 否 | -32008 | 模型或插件输出没过 schema |
| `not_permitted` | 否 | -32009 | 无此权限 |
| `conflict` | 否 | -32010 | 期望序号不符、并发冲突、重复登记 |
| `cancelled` | 否 | -32011 | 被暂停、总闸或调用方取消；**不得当作可重试去换下一家** |
| `internal` | 否 | -32012 | 代码缺陷 |
| `not_found` | 否 | -32013 | 引用的对象不存在（任务、记忆条目、命令、句柄已关闭） |

`LiwaError { category, code, message, retryable, data?: JsonValue, cause? }`；`LiwaErrorShape` 同形用于协议。`code` 的规则：`<对象>.<snake_case>`，由抛出方的模块拥有；协议级的在 `errors.ts` 的 `PROTOCOL_ERROR_CODES` 里列出（`protocol.version_mismatch`、`command.unknown`、`command.provider_gone`、`slot.unresolved`、`slot.stale_handle`、`slot.revoked`、`slot.not_ready`、`runtime.unsupported`）。`retryable` 说的是故障性质；某个动作能不能安全重做由 actions 的幂等键决定。"副作用一律经 `actions.run`"指受管的业务动作；日志、定时器、进程监管、journal 的追加各有自己的守门点。

**退出码映射**〔待确认：归 contracts 还是 cli〕：建议放 `errors.ts` 的 `EXIT_CODE_BY_CATEGORY: Record<ErrorCategory, 1 | 3 | 4>`，因为网页与 Electron 也要按同一张表分流错误提示，唯一归属在 contracts；`packages/cli` 只加传输层的 2。表本身见 `00-commands.md` §3.4。

## 12 版本、导出与兼容

| 版本号 | 管什么 | 谁检查 | 不符时 |
| --- | --- | --- | --- |
| `MANIFEST_VERSION` | manifest 格式 | kernel 第 1 阶段 | 拒绝插件 |
| `KERNEL_API_VERSION` | 进程内插件 API（manifest `kernelApi`；external 另用 peerDependencies 钉 kernel 精确版本） | kernel 第 1 阶段 | 拒绝 |
| `CONTRACT_VERSIONS[slot]` | 槽位接口 | kernel 第 1 阶段；IPC 握手 | 禁用插件 / 必需槽位则失败 |
| `SERVICE_VERSIONS[key]` | 进程内插件 `consumes` 的服务 API | kernel 第 1 阶段 | 禁用插件 |
| `VIEW_VERSIONS[view]` | 进程外插件的视图 | kernel 第 1 阶段；IPC 握手 | 禁用插件 |
| `CLIENT_PROTOCOL_VERSION` | 前后端信封 | gateway 握手 | 回 `protocol.version_mismatch`、关连接，客户端提示刷新 |
| `IPC_PROTOCOL_VERSION` | 进程外插件信封 | IPC 握手 | 禁用插件 |
| 事件类型 `v<n>` | 载荷结构 | journal 追加 | 拒绝追加；破坏性变化走一次性迁移 |

- 装配记录（`AssemblyPlan`）含 `build`、各包版本、有效 config 引用、有效绑定、契约与服务版本，哈希规则在 `00-plugin-kernel.md` §9.2。
- `pnpm contracts:export`（`tools/contracts-schemas.ts`）：manifest、profile、patch、`AssemblyPlan`、各槽位 `Meta` / `Methods` / `Handles` / 流、事件载荷、两种信封、`CommandSpec` → `packages/contracts/schemas/*.json`；CI 比对（V1.0；先实测 `z.toJSONSchema` 对 `z.lazy` 的 `JsonValue` 与 `discriminatedUnion` 的导出）。
- 变更流程：改 schema → 破坏性时版本 +1 → 同一提交改完内置实现与测试 → 变更说明写在文件顶部注释；向前兼容的唯一手段是只加可选字段。

## 13 第一版范围与测试

- V1.0：§2–§4、§5.0–§5.6、§5.8、§6–§12；`form.adapter`、`gate.policy`、`toolport.tool` 只定形状；`PLUGIN_VIEWS` 只有 `procs.spawn`。
- 测试：每个 schema 的正反例（含 `strictObject` 拼错字段被拒、`partialRecord` 稀疏映射通过、非 JSON 值进 `JsonValue` 字段被拒）；JSON 往返；`CONTRACT_VERSIONS` / `VIEW_VERSIONS` / `SERVICE_VERSIONS` / `SLOT_DEFS` / `SLOT_CONTRACTS` / `SERVICE_KEYS` / `SERVICE_LAYERS` / `EVENT_TYPES` 与各文件一致（每个服务键在层表里恰好一次；`requiredBy ∈ consumedBy`）；导出物一致；IPC 信封编解码（含 `result` / `error` 并存、非字符串 `id`、请求通知混合三个反例）；`ClientOf` 推导的类型测试；事件类型名首段是对象名；回环编解码对第一批契约全部通过（kernel T9）。

## 14 依据

Paseo / Helm 的 `AgentClient` / `AgentSession`、`AgentPermissionRequest`、`ProviderUsage`、WebSocket `hello`、目录与时间线同步〔一手，行号见各节〕；Codex app-server 协议 v2 的审批决定、`RateLimitSnapshot`、`turn/steer`〔一手〕；ACP v2 的 `session/request_permission` 与版本协商〔一手，verify-contracts ⑧〕；cordis 4.0.0-rc.12 与 zod 4〔源〕；JSON-RPC 2.0（`-32000…-32099` 留给实现定义的服务端错误）〔一手〕；`overall.md` §2.3、§5.2、§6.2、§6.9、§9.2、§9.4、§10.2、§11.8、§12.8；`05-memory.md` §3；成长调研 ⑨；`plugin-architecture` D2、D3、D5、D6；四份评审报告与四份核实报告；决策 2、17、29–35。

## 15 后边缺什么再补

`growth.engine`、`social.model` 字段定稿（随 06、V3）；`ability.*` 其余种类（随 09）；`ui.*`（随 08）；`protocol/host.ts` HostBridge（随 08）；`form.adapter`、`gate.policy`（随 V2）；`toolport.tool`（随 V3）；前后端订阅与主人接口（随 07）；各模块事件载荷（随各模块文档）；`storage.derived`、`abilities.embed` 两个视图（第一个需要它们的插件出现时）；`plugin-sdk` 的 TS 与 Python 版（kernel-1）。
