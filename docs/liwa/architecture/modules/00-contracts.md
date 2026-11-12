# 00 协议规范（contracts）

状态：**已确认**（2026-10-29，决策 33、35）。`packages/contracts` 是灵鲸的标准协议规范，和插件机制绑定。本稿定**协议核心**：公共类型与方法形状规则、manifest 与 profile 的 schema、槽位表与层表、槽位契约的文件模板与第一批契约、经历流事件与 journal 的追加协议、内核工具目录、前后端与 IPC 信封、错误类别与退出码、版本体系与导出。各槽位的业务内容在对应模块文档里出。底座见 `00-plugin-kernel.md`，命令机制见 `00-commands.md`。依据：`../../research/2026-10-29-verify-contracts.md`（C1–C19）、`verify-codex.md`（X18–X22）、`verify-layout.md` ⑧；Helm 参考快照（main `1fa999a`）与 Codex（`codex-rust-v0.162.0-alpha.17.2`）源码，行号见各节。

标注：〔一手〕读过源码或规范原文；〔二手〕转述；〔推理〕设计判断。

## 0 一页结论

- **契约分两层。** 机制层（§1–§4、§6–§12）一次定死；槽位层随模块逐个落，每个槽位文件用同一个模板（§5.0），加槽位是机械活。
- **方法形状规则是机制层的核心**（§2.2）：通用槽位方法异步、首参是调用上下文、只传 JSON、静态描述进 manifest、对象句柄写在 `Handles`、流写在 `streams`、TypeScript 接口由描述**推导**（`ClientOf`）；`brain.provider` 按 §5.1 的 DSH / Paseo 进程内接口落地。`transport: 'any'` 的槽位过回环编解码测试。
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

`brain.provider` 的进程内接口以 §5.1 为准：手写 TypeScript 接口、同步 `persistence()`、多订阅者事件；本节的 `CallContext`、`ClientOf` 与单消费者流规则不套到它上面。线协议回环测试在对应提供方包内做。依据：〔一手〕dev 分支 `packages/brain/brain/src/provider.ts`、`packages/brain/brain/src/session.ts`；主人同意写回第 1 步接口形状。

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
| `brain.provider` | bound | member | 进程内提供方接口；CLI 协议由提供方封装 | brains | brains | §5.1 | 契约与服务已在 dev 实现〔一手：`packages/brain/brain/src/provider.ts`〕 |
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

下列为遵守 §2.2 通用规则的槽位描述符模板；`brain.provider` 的 DSH / Paseo 进程内接口以 §5.1 为准。依据：〔一手〕dev 分支 `packages/brain/brain/src/provider.ts`。

```ts
/** 槽位：brain.provider ｜ 版本 1（1 = 首版）｜ 定义在 SLOT_DEFS ｜ 回退：解析不到或 unavailable 时，brains 按 roster 的备用名单依次试 */
export const CONTRACT_VERSION = 1;
export const Meta = z.strictObject({ ... });                             // manifest provides.<slot>.meta；没有就 export const Meta = z.undefined()
export const Methods = { createSession: { params, result: Handle, timeoutMs: 30_000 }, ... } as const;
export const Handles = { session: { createdBy: ['createSession', 'resumeSession'], methods: { ... }, streams: { events: { item: BrainEvent } } } } as const;
export type BrainClient = ClientOf<typeof Methods, typeof Handles>;      // 由描述推导；不手写接口
```

### 5.1 `brain.provider`

本节冻结决策 67 的 A′ 契约，供 B′–I′ 实现；不是当前代码的类型声明。当前 `13a66153` 仍返回 `BrainProviderSession`，CLI 仍用一次性 `brain run`；H′ 改走 minds。契约数据归 `@liwa/brain/src/contract.ts` 的 zod schema，提供方接口归 `provider.ts`；Paseo 共享类型只在 brain-shared 一份。〔一手〕`packages/brain/brain/src/provider.ts:158`、`packages/brain/brain-shared/src/paseo/agent/agent-sdk-types.ts:677`；主人工作记录 20 §4 C1–C2。

#### 提供方、会话与调用方

`BrainProvider` 兼作 AgentManager 的 `AgentClient`：`impl: ImplId` 是唯一登记身份，`provider` 只读返回 `String(impl)`，不再另配一个 provider 名。保留灵鲸启动上下文（受管进程、blob、home、logger），AgentManager 的打开调用点原地传入完整配置和上下文；不通过 `Paseo → BrainProviderSession → AgentSession` 往返包装。Claude、ACP 直接返回其 `AgentSession`，但 Claude 已有的问答、预算、计量与空壳策略必须移入提供方实现，不能随包装删除而丢失。deepseek、testkit 在 B′ 可用一个临时 `BrainProviderSession → AgentSession` 适配器，D′ 结束删掉；`BrainProviderSession`、`PaseoBrainSession` 与 `ManagedBrainSession` 退役。〔一手〕`packages/brain/brain-claude-code/src/provider.ts:64`、`src/session.ts:20`；`packages/brain/brain-shared/src/session.ts:610`；〔推理〕接缝实施。

以下 TS 片段引用已搬 `agent-sdk-types.ts` 的类型名；`SessionConfig = AgentSessionConfig`，`ResumeHandle` 由灵鲸安全定位字段与 `AgentPersistenceHandle` 对齐，native sessionId 不等于稳定 agentId。可选方法未实现时按能力返回 unsupported/unavailable，不能假造成功。〔一手〕`packages/brain/brain-shared/src/paseo/agent/agent-sdk-types.ts:764`；〔推理〕冻结签名。

```ts
interface BrainProvider {
  readonly impl: ImplId;
  readonly provider: string; // String(impl)，由 impl 派生
  readonly meta: Meta;
  readonly capabilities: AgentCapabilityFlags; // 从同一能力声明派生的 Paseo 视图
  readonly sessionHome: 'per-session' | 'per-member';
  writeMemberConfig?(dir: string, spec: MemberConfigSpec): Promise<void>;
  probe(context: BrainProbeContext): Promise<BrainProbeResult>;
  managePlugins?(context: BrainProbeContext, root: string, request: PluginManagementRequest): Promise<PluginLibraryRecord[]>;
  createSession(config: AgentSessionConfig, launch: BrainLaunchContext,
    options?: AgentCreateSessionOptions): Promise<AgentSession>;
  resumeSession(handle: AgentPersistenceHandle, config: AgentSessionConfig,
    launch: BrainLaunchContext, options?: AgentResumeSessionOptions): Promise<AgentSession>;
  fetchCatalog(options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<ProviderCatalog>;
  getCatalogCacheKey?(options: FetchCatalogOptions): Promise<string | undefined>;
  resolveConfiguredModel?(model: AgentModelDefinition): AgentModelDefinition;
  resolveDefaultModeId?(input: ResolveAgentDefaultModeInput): Promise<string | undefined>;
  resolveCreateConfig?(input: ResolveAgentCreateConfigInput): ResolveAgentCreateConfigResult;
  isCreateConfigUnattended?(input: AgentCreateConfigUnattendedInput): boolean;
  listCommands?(config: AgentSessionConfig): Promise<AgentSlashCommand[]>;
  listFeatures?(config: AgentSessionConfig): Promise<AgentFeature[]>;
  isAvailable(signal?: AbortSignal, options?: FetchCatalogOptions): Promise<boolean>;
  getDiagnostic?(): Promise<{ diagnostic: string }>;
  archiveNativeSession?(handle: AgentPersistenceHandle): Promise<void>;
  unarchiveNativeSession?(handle: AgentPersistenceHandle): Promise<void>;
  shutdown?(): Promise<void>;
}
```

`AgentClient` 的 create/resume 原签名允许部分 overrides／可选 launch；灵鲸在 Manager 的唯一打开点完成 resolve，再传完整 `AgentSessionConfig` 和 `BrainLaunchContext`。因此上面是兼具能力的提供方接口，不声称它可未经修改就赋给上游 `Record<string, AgentClient>`；D′ 同时改 Manager 的 clients 参数类型和调用点，不加永久桥接层。不含 `listImportableSessions`、`importSession`。〔一手〕`packages/brain/brain-shared/src/paseo/agent/agent-sdk-types.ts:767`；〔推理〕避免签名不实。

| 能力／探测 | 唯一事实与对应 | 依据 |
| --- | --- | --- |
| streaming、resume、modeSwitch、rollback | Meta 供应声明，分别派生 capabilities.supportsStreaming／supportsSessionPersistence／supportsDynamicModes／supportsRewindConversation、supportsRewindFiles、supportsRewindBoth；rollback 真值必须由实际三项能力解析，不能一个 true 推出全部 true | 〔一手〕`packages/brain/brain/src/contract.ts:49`；`packages/brain/brain-shared/src/paseo/protocol/agent-types.ts:185`；〔推理〕 |
| supportsMcpServers／supportsReasoningStream／supportsToolInvocations | 能力记录保留原生三项，Meta.kernelTools 是灵鲸工具传输要求，nativeTools 表示原生工具关不掉，不能把两者误并为 supportsToolInvocations | 〔一手〕同上；〔推理〕 |
| probe／isAvailable／getDiagnostic | 一次 provider probe 生成 available/version/problems 与可选 auth；Claude 默认只解析可执行文件位置并报认证变量名／baseUrl，不启动进程，显式 checkAuth 才在临时空壳运行 auth status、先脱敏再解析 JSON；开会话仍验证版本，isAvailable 取同一探测结果的 available，getDiagnostic 格式化同一安全报告；按执行环境／目录缓存键共享，不各跑一套检查。目录发现仍走 fetchCatalog | 〔一手〕`packages/brain/brain/src/provider.ts:60`；Paseo `agent/provider-snapshot-manager.ts:573`；〔推理〕 |
| 灵鲸独有 Meta | 保留 agentConfig{plugins,hooks,instructions}、nativeTools、permissionHook、modelSwitch、thinkingSwitch、delivery、compaction、budget、usage、personaInjection、runtime、transport、kernelTools、binary、children、extensions?；不从 Paseo 标志猜这些保证 | 〔一手〕`packages/brain/brain/src/contract.ts:49` |

`Meta.thinkingSwitch`、`BrainEvent{kind:'session.thinking_changed', thinking:string|null}` 与视图的 `thinkingOptionId?: string|null` 表达真实档位；当前代码的 `view().thinking`／事件非空 thinking 已随④实现，D′ 在源处统一视图字段名并允许原生 null 表示恢复默认，不并存两个配置字段。CLI 参数仍为 `--thinking`，AgentManager 方法为 `setAgentThinkingOption`。〔一手〕`packages/brain/brain/src/views.ts:70`、`packages/brain/brain/src/contract.ts:499`、`packages/brain/brain-claude-code/src/session.ts:46`；〔推理〕冻结后落实。

| 调用方原职责 | 冻结后的唯一入口 | 依据 |
| --- | --- | --- |
| BrainSession／ManagedBrainSession | minds 持有 ManagedAgent，开关、回合互斥、待答、子观察、用量都由 AgentManager 方法承担；不保留第二个会话控制器 | 〔一手〕Paseo `agent/agent-manager.ts:415`；〔推理〕 |
| brains.createSession／resumeSession／openChildTask | minds.createAgent／resumeAgentFromPersistence；子活经 create-agent/create + finish-subscriptions，完整 tasks 负责业务归属 | 〔一手〕同文件 `:1348`、`:1426`；〔推理〕 |
| brains.get／listSessions／children | getAgent／listAgents + AgentDirectory 冷记录；原生孩子 listProviderSubagents／fetchProviderSubagentTimeline | 〔一手〕同文件 `:1088`、`:1283`、`:1315` |
| brains.processes／onUsage | subprocess 的监管查询（minds 保存 processRefs）／minds 的 committed 流与 brain.usage.v1；usageSession 给账号报告上下文，不把 env 发给客户端 | 〔一手〕同文件 `:1278`；`packages/brain/brain/src/views.ts:123`；〔推理〕 |
| brains 保留 | register、describe、list、probe、prepareConfigDir、blobs，以及提供方目录快照／配置解析；register 返回释放函数，撤提供方时经 minds 停其会话 | 〔一手〕`packages/brain/brain/src/index.ts:235`；〔推理〕 |

#### 合并配置：逐字段处置

在 brain-shared 的 `agent-types.ts` 扩展配置的公开出口；`@liwa/brain/src/contract.ts` 的 `SessionConfigSchema` 是唯一校验和类型真相，`SessionConfig = z.infer<typeof SessionConfigSchema>`，`AgentSessionConfig` 是该类型的 type-only re-export，不再手写第二份接口。`agent-sdk-types.ts` 当前还有一份配置接口，D′ 同时删掉并引用这个出口。类型依赖不能引入运行时环；brain 的 zod 不运行时 import brain-shared。可选字段的有效默认只在开会话的 resolve 步骤补齐；灵鲸受管会话的 member/owner/persona/预算等即便边界可选，缺少业务必需值也必须在创建前拒绝。〔一手〕`packages/brain/brain/src/contract.ts:174`、`packages/brain/brain-shared/src/paseo/protocol/agent-types.ts:514`、`packages/brain/brain-shared/src/paseo/agent/agent-sdk-types.ts:598`；〔推理〕F4 落实。

| 字段 | 来源 | 处置 | 理由／约束 |
| --- | --- | --- | --- |
| provider: string | Paseo | 留 Paseo 名；解析为 ImplId | 唯一提供方身份，与 impl 同值 |
| cwd: string | 两边 | 合并，必填 | 唯一工作目录；存在性在最早可判定点检查 |
| model?: string | 两边 | 合并，留 Paseo 名 | 省略采用提供方默认，不写占位模型 |
| modeId?: string | 两边 | 合并，留 Paseo 名 | 不是权限自动回答开关 |
| thinkingOptionId?: string | Paseo；灵鲸 thinking | 合并只留 thinkingOptionId，删除 thinking | --thinking 在 CLI 边界写入它 |
| mcpServers?: Record<string,McpServerConfig> | 两边 | 合并，留 Paseo 类型 | McpServerSchema 对齐 stdio{command,args?,env?,alwaysLoad?}／http、sse{url,headers?,alwaysLoad?}；liwa 保留 |
| systemPrompt?: string | Paseo | 留，作为提供方生成的一份最终注入文本 | 灵鲸 persona/rules/instructions 按 01 §4.7 拼成一份；有 persona 时拒绝再给一个独立 systemPrompt，AgentManager.appendSystemPrompt／daemonAppendSystemPrompt 删除，避免双注入 |
| toolPolicy?: {preapproved: McpToolRef[]} | Paseo | 留 | 只管 MCP 预授权引用，不代表工具全集或原生沙箱 |
| nativeToolPolicy?: 'none'或'readonly'或'worktree' | 灵鲸 | 留为可选 | 管提供方原生工具范围，与 toolPolicy 不同；执行点同时兑现两者 |
| title?: string或null | Paseo | 留 | 展示元数据，非身份 |
| labels?: Record<string,string> | Manager CreateAgentOptions | 纳入合并配置并在唯一创建入口取出 | 当前两份 AgentSessionConfig 都无此字段；父标签改 liwa. 前缀，不搬 tab 标签 |
| providerOptions?: ProviderOptions | Paseo | 留 | 仍经提供方配置 schema，不允许任意 JSON 绕开空壳策略 |
| featureValues?: Record<string,JsonValue> | Paseo | 留 | 生命周期接口保留，Claude fast mode/feature 接线不做 |
| internal?: boolean | Paseo | 留 | 仅内部调用允许，不给公共创建参数；helper 隐藏、不落公开登记 |
| member?: MemberId | 灵鲸 | 留为可选 | 受管会话 resolve 后必须有成员归属 |
| mindKind?: MindKind | 灵鲸 | 留为可选 | instance/work/think/own/tidy |
| owner?: SessionOwner | 灵鲸 | 留为可选 | directId 或 instanceId 或 taskId 加 gen；gen 正整数 |
| persona?: {stable:string;notes:string;version:string} | 灵鲸 | 留为可选 | stable 十段在前、notes 最后；每次新建／续接重新注入 |
| dataDir?: string | 灵鲸 | 留为可选 | 提供方本代材料定位，不等于逻辑 JSONL 日志目录 |
| kernelTools?: KernelTools | 灵鲸 | 留为可选 | endpoint+token+tools 或 native+token，令牌不持久 |
| env?: Record<string,string> | 灵鲸 | 留为可选 | 会话非秘密覆盖，不能覆盖提供方拥有的认证／隔离变量 |
| limits?: {maxInferencesPerTurn:number;maxToolCallsPerTurn:number;watchdogMs:number;hardLimitMs?:number} | 灵鲸 | 留为可选，硬线增量 | 正整数；G4 计时归 minds，能力不支持硬次数就拒绝明确硬要求 |
| concludeOn?: string[] | 灵鲸 | 留为可选 | 非空；只以成功工具调用收尾 |
| permission?: {mode:'kernel'或'provider';autoAllow:string[]} | 灵鲸 | 留为可选 | 不开放父 agent 代批 |
| compaction?: 'off'或'provider' | 灵鲸 | 留为可选 | always_on 提供方不能兑现 off |
| configDir?: string | 灵鲸 | 留为可选 | prepareConfigDir 产物，不接受借用个人 home |
| rules?: string | 灵鲸 | 留为可选 | 规矩内容，拼接顺序见 01 §4.7 |
| skillsDir?: string | 灵鲸 | 留为可选 | 已物化的本事根 |
| projectDocs?: boolean | 灵鲸 | 留为可选 | 只受控读正文，不开 CLI 项目配置源 |
| childPolicy?: {native:boolean;maxDepth:number;maxConcurrent:number;crossCli:ImplId[]} | 灵鲸 | 留为可选 | 原生孩子只 work；深度／并发非负 |
| resume?: {identityProbe:boolean} | 灵鲸 | 留为可选 | 身份校验策略，不冒充原生续接句柄 |
| plugins?: string[] | 灵鲸 | 留为可选 | 本地插件目录，或由 agents 配置把插件库引用解析为目录，Meta 不支持则拒绝 |
| agents?: string[]、commands?: string[] | 灵鲸 | 文件式描述目录 | 与实例和项目材料合成快照插件；不传 SDK 程序化 agents |
| hooks?: Hooks | 灵鲸 | 留为可选 | settings 的 command 钩子形状，未知事件拒绝 |
| instructions?: string | 灵鲸 | 留为可选 | agents.yml 选出的指令与对话片段，不与 systemPrompt 双注入 |
| skills?: string[] | 灵鲸增量 | 加为可选 | 显式本事目录列表，经同一个 materialize 路径合成 skillsDir；当前 schema 没有该字段，不写成已实现 |

表的来源：〔一手〕`packages/brain/brain/src/contract.ts:174`、`packages/brain/brain-shared/src/paseo/protocol/agent-types.ts:514`、Paseo `agent/agent-manager.ts:317`；处置为主人工作记录 20 C2 与〔推理〕字段归并。工具 schema 归 §8，配置文件与四级作用域只在 [03-agent-config.md](03-agent-config.md) 定义。

```ts
type SessionOwner = { directId: DirectId; gen: number }
  | { instanceId: InstanceId; gen: number } | { taskId: TaskId; gen: number };
type Usage = {
  tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  context?: { used: number; max: number };
  quotaWindows?: { id: string; usedPercent: number; resetsAt?: string; windowMinutes?: number }[];
  balances?: { id: string; used?: number; remaining?: number; limit?: number;
    unit: 'usd' | 'credits' | 'requests' | 'tokens'; resetsAt?: string }[];
  inferences?: number; providerReportedCostUsd?: number;
};
type SafePersistenceHandle = { provider: ImplId; sessionId: string; nativeHandle?: string;
  metadata?: Record<string, JsonValue>; home?: string; createdAt?: string };
```

不透明跨边界 id 使用品牌类型，不用裸 string 拼接身份；gen 与预算正整数，深度／并发非负。PermissionQuestion 按问题号保留 options/multiSelect，PermissionAnswer 为 `{selected:string[],custom?:string}`；不能编码的答案以 invalid_input 拒绝并保留 pending。模型条目／权限的 childId 与开子时父 turn 归属保持，不能借后来的父回合；G3 尚缺 usage.update.childId 的实际接线。〔一手〕`packages/brain/brain/src/contract.ts:94`、`:302`、`:378`；〔推理〕冻结字段。

#### 事件翻译与用量

事件翻译拆成 brain-shared 的纯 reducer `translateAgentEvent(state, event, context): { state, events: BrainEvent[], attention? }`；state 显式包含条目、权限、父子归属和已终止回合，context 给已分配 id／provider，不在纯函数内取时钟、随机或改 Session。minds 分发器保留原 AgentStreamEvent 到日志，再消费 reducer 结果；持久层按原事件重放，经历流按 BrainEvent 投影，只有一个 writer。〔一手〕`packages/brain/brain-shared/src/session.ts:610`；〔推理〕拆纯函数保持现有有状态语义。

| Paseo AgentStreamEvent.type | 灵鲸输出／处理 | 约束 |
| --- | --- | --- |
| turn_started | turn.started | 缺 turnId 时先在分发层分配，不能重放再造新号 |
| turn_completed | turn.completed | usage 必填，未知为缺项；按 turn 幂等结算 |
| turn_canceled | turn.interrupted | 保留 reason 与已知 usage |
| turn_failed | turn.failed；无 active turn 的进程退出为 session.exited | 保留 code/diagnostic，失败不吞已知消费 |
| timeline.user_message | 不另发 BrainEvent；保留 timeline-row | 用户输入回声不能再次投递 |
| timeline.assistant_message | item.message | delta/final，晚到父旧回合条目不串新轮 |
| timeline.reasoning | item.reasoning | 条目归属与 childId 保持 |
| timeline.tool_call | item.tool_call.started／completed | 完成／失败／取消均收尾，保留 detail 与 batch |
| timeline.compaction | session.compacted | 保留 trigger（manual/auto）与已知 preTokens/postTokens；未知不编造 |
| timeline.todo／error／notification／plugin | 保留 timeline-row；无同义 BrainEvent 时不伪造 | 原生细节可从日志读回 |
| permission_requested | permission.request | actions → options，问题／答案保持结构，子请求直推主人 |
| permission_resolved | permission.resolved | 只在应用确认后收 pending |
| usage_updated | usage.update | 是快照，不能盲目累加消费 |
| provider_subagent | child.started／child.ended 和带 childId 的条目／权限 | 子 agent 会话级，父 terminal 不截断子输出 |
| mode_changed | session.mode_changed | 状态去重 |
| model_changed | session.model_changed | 保留实际模型，不猜默认 |
| thread_started | 不发 BrainEvent；刷新 persistence 与 agent-state | 当前翻译丢弃，冻结契约要求无秘密句柄及时持久 |
| thinking_option_changed | session.thinking_changed | 当前翻译丢弃，冻结契约要求保留 string/null 档位 |
| attention_required | minds.agent.attention.v1 + minds/agent-state 的 attention | 当前翻译丢弃，冻结契约要求保留 finished/error/permission |

依据：〔一手〕`packages/brain/brain-shared/src/session.ts:610`、`:688`、`packages/brain/brain-shared/src/paseo/agent/agent-sdk-types.ts:351`、`:469`。`process.exited` 是 subprocess 事实，由 minds 的受管上下文发出，不由提供方冒报。

Claude 用量采用“帧账 + 累计账对账”：assistant message id 去重、逐计数取最大；有 result 且累计差各项不小于帧账时用累计差，否则用帧账；没有 result 也结算已观测帧。`num_turns` 截断时可能多 1，推理次数只数主线程真实 assistant 响应，不数 synthetic/error 帧。续接同一原生 UUID，metadata 带 token／成本基线；没有基线的首个 result 只定基线，累计倒退不能算负消费；后台子消费进入下一结算回合，child 分项不再加到已含它的父总量。`providerReportedCostUsd` 仅供诊断，第三方端点不按 CLI 的 Anthropic 估价记真实花费；context／quota／余额均不是消费。G1 的 interrupted/failed 已知 usage 进入 AgentManager.lastUsage，同时保留逐 turn 的终止幂等结算，不能把 lastUsage 当累计账。〔一手〕`packages/brain/brain-claude-code/src/usage.ts:1`、`:91`、`:131`、`:202`、`src/session.ts:87`；主人工作记录 16、19；Paseo `agent/agent-manager.ts:4675`、`:4827`。

D′ 直通 AgentSession 时，`AgentUsage` 在原定义增加可选 `cacheWriteTokens`、`inferences`、`quotaWindows`、`balances`，分别对应 Usage 的 cacheWrite、主线程推理次数、额度与余额；沿已有 inputTokens/cachedInputTokens/outputTokens/totalCostUsd/contextWindow* 字段一次映射，不能把已修的 Claude/G1 信息丢在旧包装里。只知道单边 token 时原生日志保留该边，翻成要求完整 input/output 的 tokens 对象前必须两项均已知，不以 0 补未知。提供方返回的 session.provider／事件 provider 与配置 provider 必须同为 String(impl)，不把原生 CLI 类别名当实例身份。〔一手〕`packages/brain/brain-shared/src/paseo/agent/agent-sdk-types.ts:220`、`packages/brain/brain-shared/src/session.ts:113`、`packages/brain/brain-claude-code/src/usage.ts:131`；〔推理〕接缝的无损字段补齐。

提供方补充契约：`PermissionOption.sessionRules?: string[]` 展示 CLI 给出的规则原文（如 `Bash(npm test:*)`），选择后仅回传 destination=session 的 `addRules/allow`；精确 MCP 许可采用同一种表达。kernel 模式未选择规则的工具强制 ask；主人选定的原生规则成功交回 CLI 后，仅该规则所含工具名交 CLI 判定，不能按原生工具名整体 allow。〔一手〕`packages/brain/brain-claude-code/src/permissions.ts:48`、`src/budget.ts:43`；2026-11-11 真机核实（claude 2.1.322）。

`BrainEvent` 的 `session.project_document{path,reason:{tool,path},text}` 记录按需注入的来源相对路径、触发工具／路径、带来源标题的注入全文；先发布事件再返回 additionalContext，每份每代会话一次。`session.project_document_failed{path,reason,message}` 表示读取或单份 instructionsMaxBytes 失败、未注入。静态内容仍在最终系统注入中。`session.compacted` 增 `trigger?: 'manual'|'auto'`；有原生 post_tokens 时才带 postTokens。〔一手〕`packages/brain/brain/src/contract.ts:440`、`packages/brain/brain-claude-code/src/project-context.ts:1`。

`BrainProbeContext.checkAuth?: boolean` 控制显式认证检查；`BrainProbeResult.auth?: {variable:'ANTHROPIC_API_KEY'|'ANTHROPIC_AUTH_TOKEN';baseUrl?:string;check?:{ok:boolean;status?:JsonValue;problem?:string}}` 不含认证值。默认没有 check；超时、非零退出、非法 JSON 均明确失败。`managePlugins` 是可选提供方配置操作，不是会话方法；`PluginManagementRequest` 为 list／install{plugin,source}／update{plugin}／remove{plugin}，返回该实例 `PluginLibraryRecord[]{key,impl,name,marketplace,version,dir}`。〔一手〕`packages/brain/brain/src/provider.ts:53`、`src/plugin-library.ts:1`；`packages/brain/brain-claude-code/src/probe.ts:52`。

#### 第 3 步公共接口增量（全部是计划，未实现）

| 契约面 | 冻结责任与实施位置 | 依据 |
| --- | --- | --- |
| direct owner／持久观察 | SessionOwner 增 directId+gen，初始化前安装 minds 持久 sink，有界缓冲与 durable 回执；连接只拥有读者 | 〔一手〕`packages/brain/brain/src/index.ts:491`；〔推理〕 |
| 续接通知／进程范围 | describePersistence 非 null 才可续；thread_started/状态变化及时持久；subprocess 单写出生屏障与 processRefs，waitForExit 才能宣称停稳 | 〔一手〕`packages/brain/brain/src/provider.ts:113`、`packages/subprocess/subprocess/src/types.ts:188`；〔推理〕 |
| 原生清理／资源 | provider 提供精确材料定位与清理；subprocess 采样，不删共享身份根、cwd，不把 unknown 当零 | 〔二手〕Codex 评估 §7；〔推理〕 |
| 配置／目录 | provider-snapshot-manager 等三件归 minds（与 AgentManager 同处，brains 只出提供方表快照）；Key 只在提供方实例 env，agent JSON／resume／日志去秘密；不默认接 credential-ref 或个人登录 | 〔一手〕`packages/brain/brain-claude-code/src/config.ts:18`；主人工作记录 15 |
| G2／G3／G4 | minds 接会话级 pending、followUpPrompt 和子事件；G2/G3 的实际提供方补齐随⑤，G4 回合包装与 JSON 严格读在宿主开放前完成，详见 01 §4.11 | 〔一手〕handoff 决策 66、67；〔推理〕 |

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

### 6.1 minds 的持久会话事件与进程内信号（A′）

第③步的 durable 事实直接由 `@liwa/minds` 声明合并进 `@liwa/session` 的 `SessionEventMap`，使用 `minds/` 前缀；进程内信号声明合并进 Cordis `Events`，使用 `minds.*.v1`。本节是计划，不是在当前构建里登记了这些词汇。实现时同时更新已知事件／运行时 codec／persistence catalog，必需事件不标 ignorable；JSONL 信封的 seq/time 仍由 Session 层管理。〔一手〕`packages/core/session/src/types.ts:287`、`packages/session/session-persistence/src/storage-contract.ts:74`、`packages/brain/brain/src/index.ts:48`；〔推理〕C4/C11。

```ts
type MindsEventScope = {
  agentId: AgentId; gen: number; bootId: BootId;
  operationId?: OperationId; turnId?: TurnId;
};
type DurableAgentStream = Exclude<AgentStreamEvent, { type: 'timeline' }>;
type DeliveryState = 'pending' | 'handed' | 'consumed' | 'returned';
declare module '@liwa/session' {
  interface SessionEventMap {
    /** 已提交的原生时间线行。
     * @mode persist
     * @param data - 归属、epoch 与完整 row。
     */
    'minds/timeline-row': MindsEventScope & { epoch: string; row: AgentTimelineRow };
    /** 非 timeline 的原生流事实，包含 thread_started 与 attention_required。
     * @mode persist
     * @param data - 归属与完整原生事件；失败／取消可带已知 usage。
     */
    'minds/agent-stream': MindsEventScope & { event: DurableAgentStream };
    /** 生命周期提交后的安全状态。
     * @mode persist
     * @param data - 归属、原因与不含秘密的完整 after 状态。
     */
    'minds/agent-state': MindsEventScope & { reason: string; after: SafeAgentState };
    /** 投递消费与传输分别记事实。
     * @mode persist
     * @param data - 队列项、输入引用、消费状态与传输结果。
     */
    'minds/delivery': MindsEventScope & {
      deliveryId: DeliveryId; owner: SessionOwner; eventIds: EventId[];
      semantics: 'next_step' | 'next_turn' | 'cancel'; chain?: EventId;
      sender: Principal; inputRef: ModelInputRef; wake: boolean;
      state: DeliveryState; attempt: number; expectedGen?: number; expectedTurnId?: TurnId;
      providerDispatch: 'queued' | 'dispatching' | 'accepted' | 'unknown' | 'cancelled';
      reason?: string;
    };
    /** 一个稳定 agent 的运行时代次变化。
     * @mode persist
     * @param data - 旧／新代、原因和不含秘密的原生续接定位。
     */
    'minds/gen': MindsEventScope & {
      previousGen: number | null; reason: 'create' | 'reload' | 'resume' | 'renew' | 'provider_switch';
      sessionId: BrainSessionId; persistence: SafePersistenceHandle | null;
    };
    /** 时间线的更新或替换是追加事实，不改 JSONL 旧行。
     * @mode persist
     * @param data - 被替换的原 row.seq 或整份快照及新 epoch。
     */
    'minds/timeline-replacement': MindsEventScope & {
      epoch: string; replacesSeq?: number; rows: AgentTimelineRow[];
    };
    /** 每次实际交给提供方的可重建输入。
     * @mode persist
     * @param data - 原文／blob、完整非秘密系统注入及工具 schema 的内容引用。
     */
    'minds/model-input': MindsEventScope & {
      inputRef: ModelInputRef; systemPromptRef: ModelInputRef;
      toolsRef: ModelInputRef; configRevision: string; deliveryIds: DeliveryId[];
    };
  }
}
```

`SafeAgentState` 取 02 §2.3/§2.5 的 lifecycle/runtime/foreground/pending/attention/usage/persistence/processRefs 与 recordRevision/appliedLogSeq，不能直接序列化带 session、Map、函数的 ManagedAgent；`ModelInputRef` 为 `{ eventSeq: SessionLogOffset } | { blob: BlobRef }`，必须可从同一日志／其归属 blob 精确取回内容。图片、系统人设／规矩／instructions／项目正文、每轮前缀、送达原文、MCP 工具 schema、工具参数与结果、审批答复／follow-up 都必须入这些事件或被引用的内容；env 密钥与 Bearer 不属于模型内容，不能写入。只记文件路径、hash 或 token 数不足以重建输入。原生 CLI 内部追加的隐藏提示不由宿主猜测；提供方若不能导出那部分，E′/I′ 必须报告“宿主输入可重建、完整原生请求尚不可重建”的验收缺口，不能宣称仅靠 timeline 已满足所有模型请求回放。〔一手〕`docs/architecture.md:108`、`packages/brain/brain/src/contract.ts:174`；〔推理〕“模型可见 ⟺ 有日志”核对与实现门槛。

minds 必须在 Manager 内对 mode/model/thinking 的原生状态抑制广播之前取得事件，不能只订阅其现有外层 agent_stream，否则这些状态变化丢失。provider_subagent 既可能经 `AgentStreamEvent`，也可能经 Manager 的独立 `provider_subagent` 事件，归一到一个提交入口，按原事件身份去重。〔一手〕Paseo `agent/agent-manager.ts:237`、`:4675`、`:4696`；〔推理〕。

```ts
declare module '@liwa/cordis' {
  interface Context { minds: Minds; toolport: Toolport; structuredGeneration: StructuredGeneration; }
  interface Events {
    /** 开会话前依次加工配置；第一个监听器解析 agents.yml。
     * @mode waterfall
     * @param draft - 不含秘密快照的完整配置草案。
     * @param opening - agentId/gen/bootId 与 create/resume 意图。
     * @param next - 必须调用以交给下一监听器，最终返回校验后的配置。
     */
    'minds.agent.opening'(draft: AgentSessionConfig, opening: AgentOpening,
      next: (draft: AgentSessionConfig) => Promise<AgentSessionConfig>): Promise<AgentSessionConfig>;
    /** 已提交的原生流事实。
     * @mode emit
     * @param signal - 归属、durable seq 与 event。
     */
    'minds.agent.stream.v1'(signal: MindsEventScope & { seq: SessionLogOffset; event: AgentStreamEvent }): void;
    /** 已提交的状态。
     * @mode emit
     * @param signal - 归属、durable seq 与安全 after 状态。
     */
    'minds.agent.state.v1'(signal: MindsEventScope & { seq: SessionLogOffset; after: SafeAgentState }): void;
    /** 请求主人关注。
     * @mode emit
     * @param signal - 归属、durable seq 与原因。
     */
    'minds.agent.attention.v1'(signal: MindsEventScope & { seq: SessionLogOffset; reason: 'finished' | 'error' | 'permission' }): void;
    /** 归档提交后通知。
     * @mode emit
     * @param signal - 归属、durable seq 与归档时间。
     */
    'minds.agent.archived.v1'(signal: MindsEventScope & { seq: SessionLogOffset; archivedAt: string }): void;
  }
}
```

`AgentOpening = { agentId: AgentId; gen:number; bootId:BootId; reason:'create'|'resume'|'reload'|'renew' }`。`resolveAgentConfig` 是 minds 安装的第一个 opening 监听器，先读全局／实例／目录／会话选择，后续插件顺序加工，最后在创建点用唯一 zod schema 与提供方策略校验；监听器必须 `return next(nextDraft)`，不得绕过后续链。实现采用本仓库 Cordis 的实际 waterfall 调用约定，不套描述符系统。〔一手〕`packages/brain/brain/src/agents-config/index.ts:145`、`docs/cordis-primer.md` waterfall 语义；〔推理〕冻结签名。

| 事实 | JSONL | Cordis 信号 | 发布时点 |
| --- | --- | --- | --- |
| timeline、非 timeline stream | minds/timeline-row、minds/agent-stream | minds.agent.stream.v1 | 02 §2.6 committed cut 之后 |
| state、attention、archived | minds/agent-state；attention 原生事实另在 agent-stream | minds.agent.state.v1、minds.agent.attention.v1、minds.agent.archived.v1 | 对应状态已 durable 后；一次提交派生多个信号，不重复追加同一状态 |
| delivery、gen、model-input、timeline replacement | 对应 minds/* | 经 minds.subscribe 的 committed 订阅提供同一事件，无另造同义业务信号 | durable 后 |
| opening／工具登记和释放／端点 ready | 不单独记录可重放配置加工过程；最终非秘密输入必须持久 | opening 瀑布；register/attachToolport 返回释放函数 | 打开前／effect 生命周期 |
| 逐字临时片段／连接进度 | 不把未提交片段当事实，最终完整条目仍持久 | 单独 transient 订阅，不带 committed seq | 只供 UI，不推进 cursor |

依据：〔一手〕`packages/brain/brain/src/index.ts:48`、`packages/core/session/src/types.ts:287`；〔推理〕C4/C11 的持久／信号分工。后续完整 journal 承接按 owner 单次转交 writer，不长期双写两本权威事件。

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
