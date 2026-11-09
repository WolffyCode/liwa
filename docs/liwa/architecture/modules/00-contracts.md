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

契约与运行时接口归 `@liwa/brain`：`contract.ts` 用 zod 4 定义数据 schema 并推导数据类型；`brand.ts` 定义各类品牌 id；`provider.ts` 手写提供方 TypeScript 接口，`session.ts` 包装成调用方会话句柄。schema 用在登记、会话配置、续接句柄与契约测试等边界；品牌 transform 只改类型、不改值、不抛异常。本节不使用 §2.2 的描述符与 `ClientOf`；Cordis 插件配置用 schemastery，会话配置用 zod schema。依据：〔一手〕develop 源码 `packages/brain/brain/src/{contract,brand,provider,session,index}.ts`。

下列为契约字段摘要（`?` 表示可选；完整 schema 以 当前 develop 的 `contract.ts` 为准，模型省略语义已实现）。代次与回合预算为正整数，子 agent 深度与并发上限为非负整数；输入块、收尾工具及权限选项非空。`SessionConfig` 后续扩展只加可选字段：

```ts
type Meta = {
  streaming: boolean; resume: boolean;
  nativeTools: boolean; // true = 带着关不掉的原生工具
  permissionHook: boolean; rollback: boolean; modelSwitch: boolean; modeSwitch: boolean;
  delivery: { nextStep: boolean; nextTurn: boolean; cancelKeepsQueue: boolean };
  compaction: 'none' | 'switchable' | 'always_on';
  budget: { inferences: boolean; toolCalls: boolean; concludeOn: boolean };
  usage: 'full' | 'tokens' | 'quota' | 'none';
  personaInjection: { instance: PersonaInjection; work?: PersonaInjection; think?: PersonaInjection; own?: PersonaInjection; tidy?: PersonaInjection };
  runtime: 'subprocess';
  transport: 'acp' | 'claude-sdk' | 'codex-app-server' | 'scripted';
  kernelTools: ('mcp-http' | 'mcp-stdio' | 'dynamic')[]; // 至少一种
  binary: { command: string; minVersion?: string };
  children: { native: 'none' | 'observe'; crossCli: true };
  extensions?: string[];
};
type PersonaInjection = 'system_prompt' | 'preset_append' | 'developer_instructions' | 'file';
type SessionOwner = { instanceId: string; gen: number } | { taskId: string; gen: number }; // gen 正整数；换新、重建、换提供方都换代
type SessionConfig = {
  member: MemberId; mindKind: 'instance' | 'work' | 'think' | 'own' | 'tidy'; owner: SessionOwner;
  persona: { stable: string; notes: string; version: string }; // stable 为各实例逐字相同的人设十段，在最前；notes 在末尾；version 决定陈旧上限
  cwd: string; dataDir: string; // 本代会话日志由灵鲸管理，随删除级联、不进备份
  kernelTools?: { endpoint: string; token: string; tools: ToolDef[] } | { native: ToolDef[]; token: string };
  mcpServers?: Record<string, McpServer>; // toolport 接入前，调用方可直接给 Paseo 形状的 stdio / http / sse 服务器表
  nativeToolPolicy: 'none' | 'readonly' | 'worktree'; model?: string; // 省略即提供方 CLI 默认模型
  modeId?: string; // 省略即提供方默认会话模式
  env?: Record<string, string>;
  limits: { maxInferencesPerTurn: number; maxToolCallsPerTurn: number; watchdogMs: number };
  concludeOn: string[]; // 至少一个；成功调用其中之一即结束回合
  permission: { mode: 'kernel' | 'provider'; autoAllow: string[] };
  compaction: 'off' | 'provider'; configDir: string; rules: string; skillsDir: string; projectDocs: boolean; // 外部 CLI 由灵鲸受控注入项目文档，见 01 §4.6
  childPolicy: { native: boolean; maxDepth: number; maxConcurrent: number; crossCli: ImplId[] };
  resume?: { identityProbe: boolean };
};
type ResumeHandle = { provider: ImplId; sessionRef: string; createdAt: Iso; nativeHandle?: string; metadata?: Record<string, JsonValue>; home?: string };
type BlobRef = { blob: string; bytes: number; mime: string }; // blob 是 64 位小写十六进制 SHA-256，bytes 非负整数
type TurnInput = { blocks: ({ kind: 'text'; text: string } | { kind: 'block'; name: string; text: string } | { kind: 'image'; blob: BlobRef })[] };
type Usage = { // 报不出的字段留空，不许填 0
  tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  context?: { used: number; max: number };
  quotaWindows?: { id: string; usedPercent: number; resetsAt?: Iso; windowMinutes?: number }[];
  balances?: { id: string; used?: number; remaining?: number; limit?: number; unit: 'usd' | 'credits' | 'requests' | 'tokens'; resetsAt?: Iso }[];
  inferences?: number; providerReportedCostUsd?: number;
};
type PermissionEffect = 'allow_once' | 'allow_session' | 'allow_always' | 'deny_once' | 'deny_always' | 'cancel';
type PermissionOption = { id: string; label: string; effect: PermissionEffect };
type PermissionQuestion = {
  id: string; question: string; header?: string; detail?: string;
  options: { label: string; description?: string }[]; multiSelect: boolean;
}; // options 为空只收自由文本；尚无通用“可填补充文字”标志
// 至少一个 selected 或非空 custom；公共 checkPermissionAnswers 校验问题号、选项和单选约束
type PermissionAnswer = { selected: string[]; custom?: string };
type PermissionResponse = { optionId: string; reason?: string; answers?: Record<string, PermissionAnswer> };
type BrainMode = { id: string; label: string; description?: string };
type ModeChange = { modeId: string; appliesAt: 'now' | 'next_step' | 'next_turn' };
type BrainEvent =
  | { kind: 'turn.started'; turnId: TurnId }
  | { kind: 'turn.completed'; turnId: TurnId; usage: Usage; concludedBy?: string }
  | { kind: 'turn.interrupted'; turnId: TurnId; reason?: string }
  | { kind: 'turn.failed'; turnId: TurnId; category: FailureCategory; message: string; retryable: boolean; code?: string; diagnostic?: string }
  | { kind: 'session.exited'; category: FailureCategory; message: string }
  | { kind: 'session.compacted'; turnId?: TurnId; preTokens?: number; postTokens?: number }
  | { kind: 'process.exited'; pid?: number; code: number | null; signal: string | null }
  | { kind: 'item.message'; turnId?: TurnId; itemId: ItemId; delta: string; final: boolean; childId?: ChildId }
  | { kind: 'item.reasoning'; turnId?: TurnId; itemId: ItemId; summary: string; childId?: ChildId }
  | { kind: 'item.tool_call.started'; turnId?: TurnId; callId: CallId; tool: string; args: JsonValue; native: boolean; batch?: number; detail?: ToolCallDetail; childId?: ChildId }
  | { kind: 'item.tool_call.completed'; turnId?: TurnId; callId: CallId; result: JsonValue; ok: boolean; childId?: ChildId }
  | { kind: 'permission.request'; turnId?: TurnId; requestId: PermissionRequestId; category: 'tool' | 'plan' | 'question' | 'mode' | 'other'; tool: string; args: JsonValue; title?: string; description?: string; detail?: ToolCallDetail; questions?: PermissionQuestion[]; options: PermissionOption[]; childId?: ChildId }
  | { kind: 'permission.resolved'; turnId?: TurnId; requestId: PermissionRequestId; optionId: string; effect: PermissionEffect }
  | { kind: 'usage.update'; turnId?: TurnId; usage: Partial<Usage> }
  | { kind: 'session.mode_changed'; modeId: string | null; availableModes?: BrainMode[] }
  | { kind: 'session.model_changed'; model: string }
  | { kind: 'child.started'; childId: ChildId; childKind: 'native-child'; label: string; provider: ImplId; parentChildId?: ChildId; turnId?: TurnId }
  | { kind: 'child.ended'; childId: ChildId; stopReason: 'completed' | 'failed' | 'cancelled' | 'aborted'; usage: Usage };
type MemberConfigSpec = Pick<SessionConfig, 'rules' | 'skillsDir' | 'projectDocs' | 'model' | 'mcpServers' | 'kernelTools'>;
interface BrainProvider {
  readonly impl: ImplId; readonly meta: Meta;
  readonly sessionHome: 'per-session' | 'per-member';
  writeMemberConfig?(dir: string, spec: MemberConfigSpec): Promise<void>;
  probe(ctx: BrainProbeContext): Promise<BrainProbeResult>;
  createSession(cfg: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession>;
  resumeSession(handle: ResumeHandle, cfg: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession>;
}
interface BrainProviderSession {
  readonly id: string | null;
  subscribe(listener: (event: BrainEvent) => void): () => void;
  startTurn(input: TurnInput): Promise<{ turnId: TurnId }>;
  deliver(input: TurnInput, options: { semantics: 'next_step' | 'next_turn'; wake: boolean; expectedTurnId?: TurnId }): Promise<'accepted' | 'unsupported' | 'unavailable'>;
  cancel(options: { reason: 'preempt' | 'watchdog' | 'hard_limit' | 'pause' | 'drain' | 'owner'; keepQueue: boolean }): Promise<void>;
  respondToPermission(requestId: PermissionRequestId, response: PermissionResponse): Promise<void>;
  persistence(): ResumeHandle | null;
  canStopRuntime?(): Promise<boolean>; setModel?(model: string): Promise<void>;
  availableModes?(): Promise<BrainMode[]>; currentMode?(): Promise<string | null>;
  setMode?(modeId: string): Promise<ModeChange>;
  close(): Promise<void>;
}
```

| 项 | 规则 | 依据 |
| --- | --- | --- |
| 原生工具 | `Meta.nativeTools` 表示“带着关不掉的原生工具”，不是“能否使用原生工具”；为 true 时拒绝 `nativeToolPolicy: 'none'`。Claude 能以 `tools: []` 清空，声明 false；Codex 声明 true，最终由真 CLI 验收 | 〔一手〕develop 源码 `packages/brain/brain/src/contract.ts`、`packages/brain/brain/src/index.ts`；〔一手〕`01-agent-cli.md` §4.2、§4.3 的源码依据 |
| 模型 | `SessionConfig.model` 可选，`liwa brain run` 省略 `--model` 就不传占位值，由所用 CLI 使用自己的默认模型；配置目录生成也不写占位模型 | 〔一手〕主人对第 1 步验收后的决定（handoff 决策 53）；〔一手〕`paseo-upstream@8018231a:packages/cli/src/commands/agent/run.ts`；`packages/brain/brain/src/contract.ts:162`、`packages/bundle/brain-cli/src/startup.ts:100` |
| 事件订阅 | 提供方用 Paseo 的 `subscribe`；调用方句柄提供多订阅者扇出与 `events(signal?)`，每次迭代自建立订阅起收事件，不追放会话创建后的历史，不做创建即无界缓冲；没有首参 `CallContext`，`persistence()` 同步 | 〔一手〕develop 源码 `packages/brain/brain/src/provider.ts`、`packages/brain/brain/src/session.ts` |
| 权限请求 | 原生请求翻成至少一个允许选项与一个 `deny_once` 的 `options[]`；未知 `optionId` 按 `deny_once` 应用并发 `permission.resolved`；`cancel` 拒绝并中断回合。默认补一次性允许／拒绝／取消；`allow_session` 只在原生能力可兑现时展示，ACP／deepseek 不提供，第一版是否要求 Claude Code／Codex 提供仍待主人定；永久策略留给 toolport／guard，通用 ACP 只给 allow_always 时才照实展示 | 〔一手〕develop 源码 `packages/brain/brain/src/contract.ts`、`packages/test-support/brain-testkit/src/contract.ts` |
| 字段与判别 | `BrainEvent.kind` 是判别标签，子 agent 种类用 `childKind`；父条目与父权限请求必带 turnId；子条目／请求可省 turnId，但必须带 childId，知道时保留开子时的原父回合号，不能借用后来的回合。`permission.resolved`、中断原因、失败 code / diagnostic 与可选 `usage.update.turnId` 保留 Paseo 提供的事实 | 〔一手〕develop 源码 `packages/brain/brain/src/contract.ts` |
| 进程 | 会话进程一律经 `BrainLaunchContext.spawn`，brains 先登记归属再交 `ctx.subprocess`；`process.exited` 由 brains 发，提供方不发；`pid` 可选，本阶段 subprocess 不公开进程身份，登记只存命令名与 argv 哈希等归属信息，不存参数原文 | 〔一手〕develop 源码 `packages/brain/brain/src/provider.ts`、`packages/brain/brain/src/session.ts`、`packages/brain/brain/src/views.ts` |
| 内核工具令牌 | endpoint 与 native 两种分支都带令牌，原生工具也经 `toolport.invoke(token, tool, args)` 回本体；令牌绑定 owner 编号与代次，换代作废 | 〔一手〕`02-minds.md` §4.4；develop 源码 `packages/brain/brain/src/contract.ts` |
| 额度 | quotaWindows 的 usedPercent 为 0–100、可带重置时间与窗口长度，balances 记录余额；经 usage.update 上报，guard 接入后同时看钱和额度窗口 | 〔一手〕develop 源码 `packages/brain/brain/src/contract.ts`；`overall.md` §9.2 |
| 用量与失败 | `turn.completed.usage` 必填；SDK 估价只记不算；`context_exceeded` 是换新信号；`cancelled` 不当成可重试去换下一家；`FailureCategory` 为 `retryable / timeout / auth / refused / quota / process_exit / context_exceeded / cancelled` | 〔一手〕develop 源码 `packages/brain/brain/src/contract.ts`；〔一手〕`four-layers.md` §4 |
| 增量、批号与工具详情 | `delta` / `summary` 按条目累计；`final` 时 delta 可为空。同次模型输出的并行调用共享从 1 递增的批号，判不出留空；`ToolCallDetail` 按 `type` 判别为 `shell{command,cwd?}`、`read{path}`、`edit{path,unifiedDiff?}`、`write{path}`、`search{query}`、`fetch{url}`、`other` | 〔一手〕develop 源码 `packages/brain/brain/src/contract.ts` |
| 生命周期 | 退出即报 `session.exited` 或 `turn.failed`；中断与关闭幂等；原生中断确认即可，只收尾调用时捕获的回合，ACP 通知则须等对应回合终止；取消失败进入 `stopping` 并拒绝新回合，直到取消成功；关闭时收尾进程、给未结束子 agent 补 `aborted`；不支持的送达语义恒回 `unsupported` | 〔一手〕develop 源码 `packages/brain/brain/src/provider.ts`、`packages/brain/brain/src/session.ts` |
| 人设注入 | Claude 对实例会话、想事、整理用 system_prompt，对干活用 preset_append；deepseek 各种会话用进程级 personaPrefix，notes 走 agent 作用域，预设没有人格行／complete 段；具体提供方步骤用真 CLI 验证 | 〔一手〕`01-agent-cli.md` §4.2、§4.7；决策 33；`06-growth.md` §4.3；`four-layers.md` §2.16 |
| 能力与人设 | `scripted` 只给假提供方，产品提供方不用；人设每次拉起与续接都带上，缺省的会话种类注入方式按 instance；自带压缩 `always_on` 的提供方不接 `compaction: 'off'` 会话 | 〔一手〕develop 源码 `packages/brain/brain/src/contract.ts`、`packages/brain/brain/src/index.ts`；〔一手〕`four-layers.md` §2.16、`06-growth.md` §4.3 |

| 新契约项 | 当前规则 | 依据 |
| --- | --- | --- |
| home 与配置写法 | sessionHome 必填；per-session 的 home 为 `<brains>/<impl>/<sessionId>/`，续接句柄记 home 并校验在 impl 下；per-member 共用 `<brains>/<impl>/`。writeMemberConfig 可选，缺省只建空目录，公共层不写厂商分支 | 〔一手〕`packages/brain/brain/src/provider.ts:149`、`:158`；`packages/brain/brain/src/contract.ts:204` |
| 图片 blob | TurnInput 的 image 引内容寻址 blob，BrainLaunchContext 继承 BrainBlobReader，以 readBlob 读字节，不把本机文件路径当公开协议 | 〔一手〕`packages/brain/brain/src/contract.ts:216`、`packages/brain/brain/src/provider.ts:43` |
| 模式／模型 | Meta.modeSwitch 与 modeId?；availableModes/currentMode/setMode 按能力调用，未知模式拒绝；ModeChange 明示 now／next_step／next_turn，事件按实际状态变化去重；setModel 成功更新视图与 model_changed | 〔一手〕`packages/brain/brain/src/contract.ts:352`、`:489`、`packages/brain/brain/src/provider.ts:127`；`packages/brain/brain-shared/src/session.ts:657` |
| 结构化问答 | questions 恰好在 category:question 存在且非空，answers 只随问答允许类答复；每题恰好作答、单选至多一个；按问题号原样保留 selected/custom，厂商 codec 无法编码就 invalid_input 且保留 pending | 〔一手〕`packages/brain/brain/src/contract.ts:302`、`:331`、`:462`、`:554`；`packages/brain/brain-shared/src/session.ts:309`、`:475` |
| 子 agent 跨回合 | 父回合 terminal 只清父条目／父权限；子请求保留到答复或 child.ended；相同 childId 可 ended 后再 started；已收尾父回合的迟到条目不发布，取消不能提前结束新回合条目 | 〔一手〕`packages/brain/brain/src/contract.ts:378`；`packages/brain/brain-shared/src/session.ts:638`、`:732`|
| 子审批事实 | childId、工具 args、title／description 随请求上送主人，父 agent 不能代批；deepseek 选 delegatedApproval:forward，底座默认 reject | 〔一手〕`packages/acp/acp/src/updates.ts:74`、`packages/bundle/deepseek-app/cordis.patch.yml:48`|
| CLI 自开回合的现象 | deepseek 后台子结果可触发提供方自开的 turn.started／terminal；公共句柄已有 activeTurn 互斥，期间 startTurn 返回 brain.turn_active。是否确立为对外规范待主人定，不把代码现象视为新增产品决定 | 〔一手〕`packages/brain/brain-deepseek/src/session.ts:80`、`packages/brain/brain/src/session.ts:605`；handoff 待定 11 |
| G1／G4 计划补 | 当前 interrupted／failed 没 usage，update 不累加消费；watchdogMs 只有声明，API 等待超时不是整轮看门狗。G1 随④ Claude 做已知取消／失败用量幂等结算；G4 是③宿主前置，当前均未实现 | 〔一手〕`packages/brain/brain/src/contract.ts:397`、`:487`、`packages/brain/brain/src/session.ts:473`、`:610`；handoff 决策 61 |
| G2／G3 计划补 | 当前无会话级父 pending 生命周期，usage.update 无 childId；跨回合待答与实时子计量随⑤ Codex 补，字段与结算口径待独立设计 | 〔一手〕`packages/brain/brain/src/contract.ts:462`、`:487`、`packages/brain/brain/src/session.ts:529`；Codex 适配评估 §6 |

本节是现有契约摘要；下列计划接口与 G1–G4 字段不混入上方已有类型。外部 CLI 空壳子配置、Key 与同 CLI 多提供方按 `01-agent-cli.md` §4.6／§4.10；credential-ref 已定为采用底座引用，具体 provider 配置接线仍计划；问题补充文字标志与 ephemeral 逐会话入口不冒充现有 schema。依据：〔一手〕handoff 决策 57–61、任务书 03；`packages/brain/brain/src/contract.ts:149`。

有效绑定由 roster 的大脑配置给出：每个成员 × 会话种类（想事可按立场 / 出主意分）一份 `{ impl, model?, fallback: impl[] }`，实例会话与活一样可任选提供方、默认 deepseek CLI（决策 43、46），由 minds 读出后传给 brains；适配器配置只放适配器级参数。搭第二层前，由调用方直接给归属、人设、预算、收尾工具等配置；最小 direct minds、逐条 JSON、跨重启恢复与孤儿对账在③实现；完整 context/toolport/tasks/guard/journal 在第二层阶段实现，当前服务在内存登记并发出 `brain.*.v1` Cordis 事件。依据：〔一手〕主人推进决定（handoff 决策 47）；〔一手〕develop 源码 `packages/brain/brain/src/index.ts`、`packages/bundle/brain-cli/src/index.ts`。

#### 第 3 步公共接口增量（全部是计划，未实现）

下表描述已定能力与责任，不是可复制的当前 TypeScript 类型。实际签名由契约／提供方／消费方同时实现；当前摘要保持上文类型，不提前把 direct 等字段并进去。④ Claude 使用现有会话 API 并补 G1；③以 G4 和 JSON 严格读取为前置；⑤补 G2/G3。〔一手〕handoff 决策 65、66；`packages/brain/brain/src/provider.ts:77`。

| 计划接口面 | 计划输入／输出与保证 | 唯一归属／当前依据 |
| --- | --- | --- |
| direct owner | SessionOwner 计划增加品牌 directId＋gen；稳定 agentId 与本代 BrainSessionId／native id 分离 | minds 定登记，brains 接 owner；`packages/brain/brain/src/contract.ts:149`〔一手〕 |
| 持久观察口 | 创建前安装 owner 持久 sink／有界开场缓冲；控制回执经过 durable 屏障；连接退出不撤会话 context | brains 定义、provider 生产、minds 消费；`packages/brain/brain/src/index.ts:491`〔一手〕 |
| 句柄变化通知 | 可靠通知可恢复性与无秘密 ResumeHandle 的变化；初始化晚到 id、终止与关闭都能核对 | provider 上报、minds 持久；`packages/brain/brain/src/provider.ts:113`〔一手〕 |
| 目录／诊断 | catalog、installed/version/config/auth 分项及来源时刻；默认不发模型请求，探测与运行同 executable | provider 能力／brains 注册、CLI 消费；`packages/brain/brain/src/provider.ts:60`〔一手〕 |
| 出生／资源／范围 | 持久启动屏障、公开 birth/scope 标识、采样与 reconcile；terminate＋waitForExit 后才可称停稳 | subprocess 唯一实现；`packages/subprocess/subprocess/src/types.ts:169`〔一手〕 |
| 活动／回收 | 后台孩子／终端摘要、unknown／否决原因；canStopRuntime 不明不得视为安全 | provider 观察、minds 决定回收；`packages/brain/brain/src/session.ts:751`〔一手〕 |
| 原生清理 | 按本会话安全定位符删除原生材料并返回逐项结果；不删共享身份／凭据根 | provider 注册，minds 调度；`packages/brain/brain/src/provider.ts:145` 现仅 close〔一手〕 |
| 配置／账号报告 | credential-ref、不可变会话 spec、安全值 prepare/commit；可选 accountUsage 无来源明确 unavailable | provider 解析，底座凭据服务持密钥；`packages/credentials/credentials/README.md:54`〔一手〕 |
| G2/G3 扩展位置 | session-lifetime pending／follow-up、usage.update childId 与计量完整性；第三步存储消费预留，第五步公共层贯通 | 〔二手〕`docs/liwa/research/2026-11-05-codex-adaptation.md:340` |

表中接口形状为〔推理〕，产品范围已确认。数据／生命周期只在 [02-minds.md](02-minds.md) §2.3–§2.7/§4.0 定义，提供方义务见 [01-agent-cli.md](01-agent-cli.md) §4.12；本机 RPC 的双向兼容规则见 [01-brain-host.md](01-brain-host.md) §3.2。公共层无 provider 名分支；新公开能力要定义、实现、消费三面齐全。

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
