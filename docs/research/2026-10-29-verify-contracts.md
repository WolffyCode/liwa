# 协议规范核实（方向 C）：`packages/contracts` 对照 `00-contracts.md` 与最终目标

日期：2026-10-29。评审对象：`docs/architecture/modules/00-contracts.md`（已确认）与 `packages/contracts/src`（887 行、17 项测试，本次实跑 `pnpm vitest run --project @liwa/contracts`：1 个文件、17 项全部通过，179 ms）。外部参照：本机 Helm（Paseo 变体，`main` 提交 `1fa999a`，2026-10-29 与 Paseo 官方上游同步，`packages/server` 0.14.0）、本机 Codex 源码（`codex-rust-v0.162.0-alpha.17.2`）、ACP v2 文档原文、JSON-RPC 2.0 规范原文、MCP 与 LSP 的二手资料。标注：〔一手〕读了代码、源码或规范原文；〔二手〕转述或别人的调研；〔推理〕自己推的。只许新建本文件，没有改任何源码与文档。

## ① 一页结论

- **协议规范的骨架是合理的，可以在上面继续盖。** 机制层的七样东西（公共类型、manifest/profile/patch、槽位表与服务键、事件信封与追加协议、前后端信封、IPC 信封、错误类别与版本体系）在代码里都有对应物，17 项测试覆盖了 strictObject、partialRecord、事件命名、IPC 形状、LiwaError 往返〔一手，`packages/contracts/src/__tests__/schemas.test.ts`〕。"按决策 30 随模块再落"的部分（`growth.engine`、`social.model`、`ability.speech/vision/world`、`gate.policy`、`toolport.tool`、`form.adapter`、各模块事件载荷、账本 API 的 23 个 stub）缺得名正言顺。
- **但"机制层一次定死"这句话目前没完全兑现**：§2.2 方法形状规则里的 `Handles`、`Events`、`ClientOf`、`stream:` 声明一个都没落（C1）；§3 的 `consumes` 不认视图键（C8）；§8 的 `tools/` 目录与 `ToolSpec` 没有（C11）；§9 的前后端信封比它自己引用的调研草案（`client-backend.md` §3.3）少了 `welcome`、幂等键、重连游标（C3）；§12 的版本表与代码对不上（C13）；§13 的 JSON Schema 导出、三合一测试、类型级一致性、IPC 编解码都没做（C17）。这些不是"随模块落"的槽位内容，是机制层本该有却没有的缺口。
- **大脑契约装得下三家适配器的主干**（会话、回合、steer、中断、续接、用量、批结束钩子、原生工具经 `toolport.invoke` 回本体），但有四处宽度不够，Mac 客户端"像 Codex 一样对话编程"会卡在上面：权限请求只有 allow/deny，三家都有"本次 / 本会话 / 永久"与多选项（C2）；额度窗口只有一个，Claude 有 5 小时与 7 天两窗、Codex 有 primary/secondary（C4）；回合失败类别缺"上下文超限"，minds 换新判断没有依据（C5）；工具调用事件没有归一化的 detail，客户端画不出"改了哪个文件、diff 是什么"（C7）。
- **最要紧的三件事**（按"马上要有人在上面写代码"的顺序）：
  1. **补齐 `brain.provider` 的宽度并把句柄与流写进描述**（C1、C2、C4、C5、C7）：I3（Claude 适配器）与 I4（minds）是第二波最先派的活，契约改在它们之前比改在之后便宜十倍。
  2. **把前后端信封的三样机制定下来**（C3）：`welcome`（服务端能力、限制、构建号）、`Request.idem`、`Frame` 的 `mode: snapshot | delta` 与游标失效原因。07 还没写，但 `cli`（I6）与手机场景（d）都踩在这上面；现在不定，`liwa chat` 和主控台会各自发明一套。
  3. **机制层小缺口一次补完并把 §13 的测试做实**（C8–C13、C17）：`consumes` 认视图键、`SLOT_META_SCHEMAS`、`Journal` 补 `getPayload / erasePayload / registerProjection` 与按流读、`version` 字段与 `.v<n>` 二选一、`SERVICE_VERSIONS` 进版本表、JSON Schema 导出与回环编解码。这些加起来不到一天，但每一项都是以后"改在根上"要付的利息。
- **要主人定的只有 5 个点**（见 ③ 里标"要改设计"的：C2、C3、C4、C5、C6），其余都是"代码没做到已确认设计"的修复，按文档改即可。

## ② 一致性表（设计 / 代码 / 判定 / 说明）

判定：一致 ｜ 缺失·随模块落（正常）｜ 缺失·机制层缺口 ｜ 不一致。

| 节 | 设计（`00-contracts.md`） | 代码（`packages/contracts/src`） | 判定 | 说明 |
| --- | --- | --- | --- | --- |
| §1 包结构 | `views/`、`tools/`、`events/journal.ts`、`index.ts` 导出 `REQUIRED_PLUGIN_IDS` | 无 `views/`（视图清单在 `services.ts:41-44`）、无 `tools/`、追加协议在 `events/envelope.ts`、无 `REQUIRED_PLUGIN_IDS` | 不一致 | 前三项是目录归属（交 L）；`REQUIRED_PLUGIN_IDS` 自决策 31（required 由组合根以代码传入）起就没意义，文档应删〔一手，`00-plugin-kernel.md` §0、`kernel/loader.ts:136`〕 |
| §2.1 公共类型 | 12 个类型 | 全部存在，另多 `JsonValue`、`PluginId`、`ImplId`、`AudienceRefSchema`、`AUDIENCE_OWNER` | 一致 | `AudienceRef` 的 branded 类型只在 `AUDIENCE_OWNER` 上用了一次，`EventSource.audienceId` 是裸 `number`（`envelope.ts:14`）→ C9 |
| §2.1 `CallContext` | "进程内另带 AbortSignal" | schema 无此字段，TS 类型由 `z.infer` 推出，没有 `signal` 的落点 | 缺失·机制层缺口 | C15 |
| §2.2 方法形状规则 1、2、5 | 异步、首参 ctx、只传 JSON；静态描述进 meta；`pure`、`transport` | `Methods` 带 `timeoutMs`、`pure`；`SLOT_DEFS.transport` 有 | 一致 | `brain.provider` 的 `args` / `result`、`AppendRequest.payload`、`LiwaErrorShape.data` 仍是 `z.unknown()`（`brain.provider.ts:80-82`、`envelope.ts:47`、`errors.ts:61`），与"任意 JSON 一律 `JsonValue`"（§2.3）相悖 → C16 |
| §2.2 规则 3、4、6 | 返回子接口的方法返回 `{ handle }`，子接口写在 `Handles` 段；流在方法描述里声明 `stream:`；接口由 `ClientOf` 推导、不手写两份 | 无 `Handles`、无 `Events` 导出、无 `ClientOf`；`SessionMethods` 里没有 `events`；`Methods.createSession.params = { cfg }` 而 `BrainClient.createSession(ctx, cfg)`（`brain.provider.ts:90-122`） | 不一致 | C1。IPC 从描述推导不出句柄与流；两份手写已经形状不同 |
| §2.2 规则 7 | `transport: 'any'` 的槽位过回环编解码 | 无（handoff 记为留到 1.7） | 缺失·机制层缺口 | 已登记，不重提；但 `z.unknown()` 不先换成 `JsonValue`，回环测试到时也守不住（C16） |
| §2.3 schema 约定 | strictObject / partialRecord / JsonValue / 可导出子集 / 三合一测试 | strictObject、partialRecord、JsonValue 都有；无 JSON Schema 导出（`contracts:export` 指向 `tools/placeholder.ts`，退出码 1）；无三合一测试 | 不一致 | C17 |
| §3 Manifest | `consumes: partialRecord(union(ViewKey, ServiceKey), int)` | `Consumes = partialRecord(ServiceKeySchema, …)`（`manifest/liwa.ts:27`） | 不一致 | C8。进程外插件无法声明 `procs.spawn: 1` |
| §3 Profile / Binding / PatchOp | 五种操作（代码块里没有 `enable`） | 六种（含 `enable`，`profile.ts:35-43`） | 不一致（文档漏） | `00-plugin-kernel.md` §4.2 有 `enable`，`00-contracts.md` §3 代码块漏了；改文档 |
| §3 AssemblyPlan | 无 `problems` | 有 `problems`（`assembly.ts:51`） | 不一致（文档漏） | 改文档 |
| §4.1 槽位清单 | 14 个槽位、基数、作用域、transport、requiredBy、契约 1 | `SLOT_DEFS` 14 个全部一致，另多 `implemented` 标志（`defs.ts:33`） | 一致 | `social.pack` / `persona.template` 文档 transport 写"—"，代码写 `in-process`；数据包无所谓，统一写法即可 |
| §4.2 服务键与视图 | 25 个服务键；`PLUGIN_VIEWS = ['procs.spawn']`，`spawn(ctx, {cmd,args,cwd,env,group}) → {pid, handle}` | 25 个一致；视图有；但视图没有 `Methods` 描述，`ledgers/index.ts:17-20` 的 `Procs.spawn` 是进程内签名（无 ctx、多 `id`） | 缺失·机制层缺口 | 视图是 IPC 的反向方法清单，按 §2.2 必须有描述；现在只有名字与版本号 → C13 |
| §5.0 文件模板 | `CONTRACT_VERSION`、`SLOT`、`Meta`、`Methods`、`Handles`、`Events`、`ClientOf` | 四个槽位文件都有 `CONTRACT_VERSION`、`Methods`；无 `SLOT` 常量（定义集中在 `defs.ts`，更好）；无 `Handles` / `Events` / `ClientOf` | 不一致 | 模板本身应改成"`SLOT_DEFS` 集中定义 + 文件顶部注释"，和代码一致；`Handles` / `Events` 见 C1 |
| §5.1 `brain.provider` | Meta 10 字段；`SessionConfig`；Methods 2 个；Handles.session 8 个方法 + events 流；`BrainEvent` 11 种；`Usage` 5 段 | 全部存在且字段一一对应（含 handoff 已采纳的 `session.exited`、`turn.interrupted`、`itemId`、tool_call started/completed、native 令牌、`endTurnAfter`、`context`、`providerReportedCostUsd`） | 一致 | 宽度问题见 C2、C4、C5、C6、C7，是"设计本身够不够"，不是代码没照抄 |
| §5.2 `memory.engine` | 四对 prepare/interpret + `rank` + `forget`（pure），结构体按 05 §3.5 | 方法名、`pure`、`timeoutMs` 一致；结构体用 `JsonValue` 占位（文件头注明"05 实现阶段补 zod"） | 缺失·随模块落 | 正常；注意 `forget.now: z.string()` 应为 `Iso`（`memory.engine.ts:20`），05 §3.5 写的是 `now: string`，两边都该是 `Iso` |
| §5.3 `growth.engine` | 签名在 §5.3，随 06 定稿 | 无文件 | 缺失·随模块落 | 06 草稿 §3.5 多出 `proposeDiary / proposeMethods / proposeNotes` 三对，待主人点头后同步 §5.3 |
| §5.4 `social.model`、§5.5 `job.trigger`、§5.6 `ability.embed`、§5.7 三个只定形状 | — | `job.trigger`、`ability.embed` 有且一致；`social.model`、`gate.policy`、`toolport.tool`、`form.adapter` 无文件 | 缺失·随模块落 | 正常 |
| §6 事件信封 | 11 个字段；`type` 带 `.v<n>`；`source` 7 字段 | 多一个 `version: int`（`envelope.ts:31`）；其余一致 | 不一致 | C9：`kernel.started.v1` 的 `v1` 与 `version: 1` 双写，没有校验二者相等 |
| §6 `AppendRequest` | `stream, type, payload?, expectedSeq?, causeId?, correlationId?, source` | 多 `actor`（`envelope.ts:46`，信封必需，代码对）；`payload: z.unknown()` | 不一致（文档漏 `actor`） | 改文档加 `actor`；`payload` → `JsonValue`（C16） |
| §6 `Journal` | `append / read(cursor) / subscribe(filter, cb) / registerProjection / checkpoint` | `append / read({from?, limit?}) / subscribe({types?}, cb) / putPayload`；无 `registerProjection`、无 `getPayload`、无 `erasePayload`、读与订阅都不能按流 | 缺失·机制层缺口 | C10（含 02 §13 第 1 条） |
| §6 `EVENT_TYPES` | 第一版只有 contracts 能定义；journal 追加时校验 | `EVENT_TYPES: ReadonlyMap`（`events/index.ts:7-9`），只有 5 个 kernel 事件；`defineEventType` 校验命名 | 一致 | 02 草稿的 15 个 `events/minds.ts` 类型随 02 落，正常 |
| §7 账本 API | 25 个接口类型 | `Journal`、`Procs` 有骨架，其余 23 个是 `ServiceStub` | 缺失·随模块落 | 正常；但 `Services.journal` 与 `KernelContext.services` 共用一个 `Journal` 类型，含 `append` → 与 `00-plugin-kernel.md` §7 规则 1"给插件的 Journal 只有 read、subscribe、putPayload"冲突，交 K |
| §8 工具目录 | `tools/`：`ToolSpec`（zod）→ `ToolDef`（JSON Schema）；第一批 20 个工具 | 无 `tools/`；`ToolDef` 定义在 `slots/brain.provider.ts:27`；无 `ToolSpec` | 缺失·机制层缺口 | C11。§8 在 §0 列的机制层范围内（§1–§4、§6–§12） |
| §9 前后端信封 | `Request / Response / Frame / Hello`；订阅种类等随 07 | 四种一致 | 一致（但不够） | C3：缺 `welcome`、`idem`、`Frame.mode`；`Hello.v` 是 literal |
| §10 IPC | 常量、三种消息、方法名规则、`kernel/hello` 等、`$/stream|ack|cancel`、错误码、限制 | 常量 4 个、消息 3 种、`Method` 正则、`HelloParams / HelloResult / StreamParams / AckParams / CancelParams` 都有 | 一致 | C14：`RpcError.data` 可选 vs 文档必填；握手没传 `views` 版本；缺 `kernel/health`；`HelloResult.ipcProtocolVersion` 是 literal |
| §11 错误 | 13 类、默认 retryable、码表 `-32000…-32019` | 13 类一致；`JSON_RPC_CODES` 用了 `-32000…-32012`；`LiwaError` 类与 `toShape/fromShape` | 一致 | 码在 JSON-RPC 2.0 保留给"实现自定义服务端错误"的 `-32000…-32099` 段内〔一手，jsonrpc.org 规范原文〕 |
| §12 版本 | 七行表 | `MANIFEST_VERSION`、`CONTRACT_VERSIONS`、`VIEW_VERSIONS`、`KERNEL_API_VERSION`、`CLIENT_PROTOCOL_VERSION`、`IPC_PROTOCOL_VERSION` 都有；另有 `SERVICE_VERSIONS`（文档无） | 不一致 | C13：`SERVICE_VERSIONS` 被 kernel 检查（`kernel/manifest.ts:86-88`）却不在表里；`KERNEL_API_VERSION` 无人检查（交 K） |
| §13 测试 | 正反例、JSON 往返、版本表一致、导出物一致、IPC 编解码、`Methods` 与接口一致（类型级）、回环 | 有：正反例、版本表与槽位一致、阶段集合、事件命名、IPC 形状、LiwaError 往返、JsonValue 反例；无：导出物、类型级一致性、IPC 编码（只测了解析）、回环 | 不一致 | C17 |

## ③ 问题清单

严重度：高 = 不改就会让第二波实现返工或让最终目标做不到；中 = 机制层缺口，现在补便宜；低 = 文档与代码的小出入。分类："设计内修复" = 代码没做到已确认设计；"要改设计" = 需要主人定。

**C1 ｜ 高 ｜ 设计内修复 ｜ `slots/brain.provider.ts:90-122`，`00-contracts.md` §2.2 规则 3、4、6、§5.0**
问题：没有 `Handles`、`Events`、`ClientOf`；`SessionMethods` 里没有 `events` 流；`Methods.createSession.params` 是 `{ cfg: SessionConfig }`，`BrainClient.createSession(ctx, cfg)` 却直接收 `cfg`；`SessionMethods.startTurn.params` 是 `{ handle, input }`，`BrainSession.startTurn(ctx, input)` 没有 handle。两份手写已经分叉，IPC 代理与回环测试都无从生成。
依据：〔一手〕代码行号如上；〔一手〕`00-contracts.md:54-57`。
建议改成：
```ts
export const Methods = { createSession: { params: SessionConfig, result: Handle, timeoutMs: 30_000 }, resumeSession: { params: z.object({ handle: ResumeHandle, cfg: SessionConfig }), result: Handle, timeoutMs: 30_000 } } as const;
export const Handles = { session: { createdBy: ['createSession', 'resumeSession'], methods: SessionMethods, streams: { events: { item: BrainEvent } } } } as const;
export type BrainClient = ClientOf<typeof Methods, typeof Handles>;   // 由描述推导；`ClientOf` 放 common.ts：Methods 的每项映射为 (ctx, params) => Promise<result>，Handles 的每项映射为 { handle } 加方法与 AsyncIterable 流
```
若 `ClientOf` 的类型体操不值得做，就把 §2.2 规则 6 改成"手写接口，用 `expectTypeOf` 类型测试守一致"，但 `Handles` / `streams` 的描述必须落，否则 IPC 层（kernel-1）无法枚举句柄方法与流。

**C2 ｜ 高 ｜ 要改设计 ｜ `brain.provider.ts:82、100`，`00-contracts.md` §5.1 `permission.request` / `respondToPermission`**
问题：权限请求只有 `{ requestId, tool, args }`，回答只有 `allow | deny`。三家原生协议都比这宽：Codex 的审批决定有 `Accept / AcceptForSession / AcceptWithExecpolicyAmendment / Decline / Cancel`，其中 `Decline` 让回合继续、`Cancel` 同时中断回合〔一手，`codex-rs/app-server-protocol/src/protocol/v2/item.rs:66-123`〕；ACP 的 `session/request_permission` 带 `options[]`，每个有 `optionId` 与 `kind ∈ allow_once | allow_always | reject_once | reject_always`，回答是 `{ outcome: 'selected', optionId } | { outcome: 'cancelled' }`，`optionId` 对不上视为未批准〔一手，agentclientprotocol.com v2 tool-calls.md 第 213–376 行〕；Claude SDK 的 `canUseTool` 回答带 `updatedPermissions`（记住规则）与 `deny.interrupt`〔二手，`subagent-notes/cli-claude-sdk-codex-app-server.md:104-111`〕；Paseo 的契约为此把 `AgentPermissionRequest` 做成 `{ kind: 'tool'|'plan'|'question'|'mode'|'other', actions[]{id, label, behavior, intent}, detail, suggestions }`〔一手，Helm `agent-sdk-types.ts:470-508`〕，0.14.0 的两个适配器都在用它：Codex 把计划审批翻成 `dismiss / implement / implement_resume` 三个动作、把 `item/tool/requestUserInput` 翻成 `kind: 'question'`〔一手，`providers/codex-app-server-agent.ts:1151-1182、3911-3925、7148-7178`〕，Claude 把计划模式翻成 `reject / implement / implement with <mode>`〔一手，`providers/claude/agent.ts:1190-1215、5177`〕。主人在 Mac 客户端审批一只手（场景 c）时，"这次允许 / 这个会话都允许 / 拒绝并停下"是最基本的三个按钮，现在的契约表达不了后两个；Codex 的"计划审批 → 继续实现"与 `item/tool/requestUserInput`（问用户一个问题）也装不下。
建议改成：
```ts
| { kind: 'permission.request'; turnId; requestId; category: 'tool' | 'plan' | 'question' | 'other'; tool: string; args: JsonValue; detail?: ToolCallDetail;
    options: { id: string; label: string; effect: 'allow_once' | 'allow_session' | 'allow_always' | 'deny_once' | 'deny_always' | 'cancel' }[] }
respondToPermission(ctx, { handle, requestId, optionId, reason? })   // optionId 对不上 → 适配器按 'deny_once' 处理并记日志；'cancel' = deny + interrupt
```
`allow_always` 由 toolport / guard 决定是否放进选项（主人批准的上限内，§11.9），适配器只负责翻译。要主人定的是：是否接受"本会话允许"这种有记忆的授权进第一版（它和"兜底靠可撤销，不靠审批"一致，但扩大了一次授权的范围）。

**C3 ｜ 高 ｜ 要改设计（§9 是机制层） ｜ `protocol/client.ts:7-13`，`00-contracts.md` §9**
问题：（1）只有客户端的 `Hello`，没有服务端的 `welcome`：`overall.md` §10.2 要求"服务端回能力和限制"，`client-backend.md` §3.3 的草案有 `{t:'welcome', protocol, build, features, limits:{maxFrame}}`，§3.4 第 7 条要求"重连 hello 带各 topic 游标"；现在 `Hello` 没有游标数组、没有客户端种类。（2）`Request` 没有幂等键：`overall.md` §10.2"有副作用的请求一律带幂等键"，`engineering.md` §12"写操作幂等（`--idempotency-key`）"。（3）`Frame{ sub, cursor, items }` 没有"这是快照还是增量"和"游标为什么失效"：Helm 的目录同步在元数据里带 `mode: 'snapshot' | 'changes'` 与 `reason: 'no_cursor' | 'generation_changed' | 'cursor_expired' | 'changes_too_large'`，时间线响应带 `epoch`、`reset`、`staleCursor`、`gap`〔一手，Helm `packages/protocol/src/messages.ts:1276-1283、1922-1925、4748-4758`〕；Helm 0.14.0 的 WebSocket `hello` 是 `{ clientId, clientType: 'mobile'|'browser'|'cli'|'mcp'|'hub', protocolVersion: z.number().int(), auth: password | localCredential }`，版本号是整数不是 literal〔一手，`messages.ts:7697-7712`〕；`overall.md` §10.3 自己也写了"游标过期就给快照""超了就降级为只推条目完成"，可 `Frame` 里没有字段能说这两件事。（4）`Hello.v: z.literal(1)`：旧客户端的 hello 直接解析失败，gateway 拿不到对方版本号，只能当非法消息处理，做不出"提示刷新（你是 v1，我是 v2）"。
依据：〔一手〕以上文件与行号；〔二手〕`client-backend.md:107-131`。
建议改成（都在 §9，不等 07）：
```ts
Hello    { t:'hello', v: int, build, client: 'console'|'web'|'cli'|'desktop'|'mobile', token, resume?: { sub: string; cursor: string }[] }   // v 用 int，gateway 比对后回错误再关
Welcome  { t:'welcome', v: int, build, limits: { maxFrameBytes, maxInflight }, features: string[] }
Request  { t:'req', id, op, body, v, idem?: string }          // 有副作用的 op 由 07 标 requiresIdem，gateway 校验
Frame    { t:'sub', sub, cursor, mode: 'snapshot' | 'delta', reason?: 'no_cursor' | 'cursor_expired' | 'epoch_changed' | 'too_large' | 'degraded', items }
```
要主人定的点：`v` 不一致时是"提示刷新"（现行，不兼容）还是允许服务端回 `welcome{ v: 服务端版本 }` 让客户端决定——前者和"不叠兼容层"一致，建议保持，只是要让版本号能被读到。

**C4 ｜ 中 ｜ 要改设计 ｜ `brain.provider.ts:66`，`00-contracts.md` §5.1 `Usage.quotaWindow`**
问题：只有一个 `quotaWindow { used, limit, resetsAt }`。Codex 的 `RateLimitSnapshot` 有 `primary` 与 `secondary` 两个窗口，每个是 `{ used_percent, window_duration_mins, resets_at }`，没有绝对 `limit`〔一手，`v2/account.rs:664-672、752-758`〕；Claude 订阅制是 5 小时窗加 7 天窗〔二手，`overall.md` §11.8"订阅制 CLI 报不出费用的，用账户额度窗口"与 §17 第 6 项〕；Paseo 的每回合 `AgentUsage` 至今没有额度窗口字段〔一手，Helm `agent-sdk-types.ts:217-224`〕，0.14.0 把额度做成提供方级的用量报告：`ProviderUsage{ windows: { id, label, shortLabel?, usedPct, remainingPct, resetsAt, runsOutAt }[], balances?: { id, label, used, remaining, limit, unit: 'usd'|'credits'|'requests'|'tokens', resetsAt }[] }`，取不到时报 `UsageProblem: expired | rejected | no_quota`〔一手，`packages/protocol/src/messages.ts:6374-6445`〕——窗口是数组、按百分比、带 `resetsAt`，和 Codex 的原生形状一致。guard 的总闸要"同时计钱和额度窗口、给主人预留额度"（§11.8），一个窗口既对不上 Codex 的两个，也表达不了"按百分比报"。
建议改成：`quotaWindows?: { id: string; usedPercent: number; resetsAt?: Iso; windowMinutes?: number }[]`（`id` 由适配器给，如 `'5h'`、`'7d'`、`'primary'`），可选再加 `balances?: { id: string; used?: number; limit?: number; unit: 'usd' | 'credits' | 'requests' | 'tokens'; resetsAt?: Iso }[]`（Codex 的 credits、按量付费的余额），删掉 `quotaWindow`；这两项是提供方级的，适配器经 `usage.update` 上报即可，不要求每个 `turn.completed` 都带。

**C5 ｜ 中 ｜ 要改设计 ｜ `brain.provider.ts:59`，`00-contracts.md` §5.1 `FailureCategory`**
问题：`'retryable' | 'auth' | 'refused' | 'quota' | 'process_exit'` 缺三种常见失败：上下文超限（Codex `codexErrorInfo.contextWindowExceeded`〔二手，sub-note 第 199 行〕；minds 的换新规则按 `usage.context` 判断，但报不出 `context` 的大脑只能靠失败类别知道该换新，02 §10 第 3 项正是这个顾虑）；超时（回合看门狗中断不是失败，但 CLI 自己报的 `responseStreamDisconnected` / 超时是）；被取消（`cancelled` 在 §11 是"不得当作可重试去换下一家"的类别，回合失败却没法标它）。另外 `FailureCategory` 与 `ErrorCategory` 是两套各写的枚举。
建议改成：`export const FailureCategory = z.enum(['retryable', 'timeout', 'auth', 'refused', 'quota', 'process_exit', 'context_exceeded', 'cancelled'])`，并在 §11 注明 `context_exceeded` 是回合级的、不进 `ErrorCategory`（它不是跨模块错误，是 minds 的换新信号）。

**C6 ｜ 中 ｜ 要改设计 ｜ `brain.provider.ts:22`，`00-contracts.md` §5.1 Meta**
问题：`personaInjection` 是单值枚举，但决策 33 与 `06-growth.md` §4.3"注入方式"规定同一个 Claude 适配器对在场 / 慢想 / 睡眠用自定义 `systemPrompt`、对手用 `preset + append`：一个 meta 值表达不了"按用脑种类不同"。
建议改成：`personaInjection: z.partialRecord(MindKind, z.enum(['system_prompt', 'preset_append', 'developer_instructions', 'file']))`，缺省键按 `presence` 的值。

**C7 ｜ 中 ｜ 设计内修复（补字段，不改已定语义）｜ `brain.provider.ts:78、80`**
问题：（1）`item.message { text, final }` 没说 `text` 是增量还是累计；Mac 客户端"看过程"要逐字流，手机走 Tailscale 中继 <70 KB/s，累计全文每帧重发会把带宽吃光。（2）`item.tool_call.started { tool, args, native }` 没有归一化 detail：`overall.md` §9.2 写"条目：消息、推理、归一后的工具调用"，`engineering.md` §4.7 写"工具调用归一放 brain-shared"，但归一结果没有出口；Paseo 的 `ToolCallDetail` 是闭合联合（shell / read / edit / write / search / fetch / …），客户端据此画"改了哪个文件、diff 是什么"〔一手，Helm `agent-sdk-types.ts:240-337`〕。（3）02 §13 第 2 条要的 `batch` 序号。
建议改成：
```ts
| { kind: 'item.message'; turnId; itemId; delta: string; final: boolean }                       // delta 是自上一条起的增量；final 时 delta 可为空
| { kind: 'item.tool_call.started'; turnId; callId; tool; args: JsonValue; native: boolean; batch?: number; detail?: ToolCallDetail }
export const ToolCallDetail = z.discriminatedUnion('type', [ shell{command,cwd?}, read{path}, edit{path, unifiedDiff?}, write{path}, search{query}, fetch{url}, other{} ]);   // 闭合、只增不删
```

**C8 ｜ 中 ｜ 设计内修复 ｜ `manifest/liwa.ts:27`，`00-contracts.md` §3、§4.2**
问题：`Consumes` 只接受服务键；设计写 `z.union([ViewKey, ServiceKey])`，§4.2 说"进程外插件只能列 `PLUGIN_VIEWS` 里的方法"。V1 虽拒绝 external，但 manifest 是机制层。
建议改成：`z.partialRecord(z.union([ViewKey, ServiceKey]), z.number().int().positive())`，kernel 按种类检查（进程内不许列视图键、进程外只许列视图键）；`checkManifest` 对视图键比对 `VIEW_VERSIONS`。

**C9 ｜ 中 ｜ 设计内修复 ｜ `events/envelope.ts:14、31、46-47`，`00-contracts.md` §6**
问题：（1）`version` 字段与类型名的 `.v<n>` 双写，没有校验相等；（2）`EventSource.audienceId` 是裸 `number`，"只有 people 能造"在类型上没守住：任何模块都能 `append({ source: { audienceId: 3, … } })`；（3）`AppendRequest` 有 `actor` 而文档没有。
建议改成：删掉 `version` 字段（类型名已经带版本，`EVENT_TYPES` 按全名查 schema）；`EventSource` 的 TS 类型改为 `Omit<z.infer<…>, 'audienceId'> & { audienceId: AudienceRef }`（schema 不变，解析出来的值由 journal 转成 branded），`AppendRequest` 的参数类型同样要求 `AudienceRef`；文档 §6 加 `actor`。

**C10 ｜ 中 ｜ 设计内修复 ｜ `ledgers/index.ts:10-15`，`00-contracts.md` §6、§7；`engineering.md` §6**
问题：`Journal` 缺 `registerProjection`（§6 写了）、`getPayload`（消费方按 `payloadRef.id` 取载荷，没有它 `payloadRef` 没法用）、`erasePayload`（`engineering.md` §6"只有主人接口能调"）；`read` 不能按流、无方向、无 `to`；`subscribe` 不能按流、不能从游标追上（gateway 断线重连后要从 `cursor` 补，场景 d）。
建议改成：
```ts
read(q: { stream?: StreamRef; from?: EventId; to?: EventId; limit?: number; order?: 'asc' | 'desc' }): Promise<CommittedEvent[]>;
subscribe(filter: { stream?: StreamRef; types?: string[]; from?: EventId }, cb): Unsubscribe;   // from 给了就先补发再实时
putPayload(payload: JsonValue): Promise<{ id }>;  getPayload(id): Promise<JsonValue | null>;   // null = 已删
registerProjection(def: { name; kind: 'inline' | 'async'; handles: string[]; apply; rebuild }): Unsubscribe;
erasePayload(ownerToken: OwnerToken, id, reason): Promise<void>;
```
`StreamRef = { kind: StreamKind; id: string }` 从 `EventEnvelope.shape.stream` 抽出来导出。

**C11 ｜ 中 ｜ 设计内修复 ｜ 无 `tools/`，`00-contracts.md` §8**
问题：`ToolSpec`（zod，内核内部）→ `ToolDef`（JSON Schema，给适配器）这条导出链没有；`ToolDef` 定义在 `slots/brain.provider.ts:27`，但它同时是 toolport、探针、以后 `toolport.tool` 槽位的类型，归属应是 `tools/`。02 §3.4 已经按 `contracts/tools/` 写。
建议改成：建 `tools/spec.ts`：`ToolSpec<P, R> { id: /^[a-z_]+$/; description; params: ZodType<P>; result: ZodType<R>; mindKinds: MindKind[]; firstBatch?: boolean; sideEffect: 'none' | 'propose' }`，`toToolDef(spec): ToolDef`（`z.toJSONSchema`），`ToolDef` 从 brain.provider.ts 移到这里并由它 re-export；第一批工具的 zod 随 02 / 03 / 04 落。

**C12 ｜ 中 ｜ 设计内修复 ｜ `manifest/liwa.ts:21`、`kernel/manifest.ts:73-93`、`__tests__/schemas.test.ts:27`、`00-plugin-kernel.md` §3.1 示例**
问题：每个槽位文件都定义了 `Meta`（`brain.provider` 的是 10 个必填字段的 strictObject），但 `Provides.meta` 是 `z.unknown()`，kernel 第 1 阶段不校验 meta；文档示例与测试里的 manifest 只给了 `{ personaInjection: 'system_prompt' }`，真校验起来会被拒。能力声明（steer、interrupt、resume、usage 完整度）是 brains 做回退与回归的依据，不校验等于没声明。
建议改成：contracts 导出 `SLOT_META_SCHEMAS: Record<SlotName, ZodType>`（没有 Meta 的槽位给 `z.undefined()`），kernel 在 `checkManifest` 里用它校验（交 K）；`00-plugin-kernel.md` §3.1 与测试里的示例补全 10 个字段。

**C13 ｜ 中 ｜ 设计内修复 ｜ `services.ts:36-44`、`index.ts:16`、`protocol/ipc.ts:26`，`00-contracts.md` §1、§12**
问题：（1）`SERVICE_VERSIONS` 在代码里并被 kernel 检查，§12 表无此行；（2）`REQUIRED_PLUGIN_IDS` 在 §1 却已无意义；（3）`KERNEL_API_VERSION` 导出了但 kernel 从不检查（§12 写"kernel 第 1 阶段拒绝"）；（4）IPC 握手 `HelloParams` 只传 `contracts`，不传 `views` 版本，进程外插件无法核对它要反向调用的视图版本；（5）`PLUGIN_VIEWS` 没有方法描述（见 ② §4.2 行）。
建议改成：§12 表加 `SERVICE_VERSIONS[key]`（进程内插件 `consumes` 的服务 API 版本，kernel 第 1 阶段，不符禁用）一行、删 `REQUIRED_PLUGIN_IDS`；`HelloParams` 加 `views: Record<string, number>`；新建 `views/procs.spawn.ts` 写 `Methods = { spawn: { params: { cmd, args, cwd, env, group? }, result: { pid, handle }, timeoutMs } }`；`KERNEL_API_VERSION` 的检查交 K。

**C14 ｜ 低 ｜ 设计内修复 ｜ `protocol/ipc.ts:15、27`，`00-contracts.md` §10**
问题：`RpcError.data` 可选，文档写必填（`data: LiwaErrorShape`）；`HelloResult.ipcProtocolVersion: z.literal(1)` 与 C3 同病（不符时读不出对方版本）；方法清单里没有 `kernel/health`（插件级 `health()` 是 §2.2 规则 2 要求的）、没有和进程内 `ready` / `drain` 对应的 `kernel/ready` / `kernel/drain{deadlineMs}`；"插件发起的事件（形态适配器入站消息、在场者快照）统一走宿主先开的流方法（`<slot>/events`）"这条没写，读者会以为插件能主动发请求。
依据：〔一手〕文件行号；ACP 对版本不符的做法是回 `-32022` 并在 `data` 里给 `requested` 与 `supported`〔一手，agentclientprotocol.com v2 initialization.md 第 99–122 行〕，MCP 2025-11-25 是"服务端回一个它支持的版本，客户端不支持就断开"〔二手，WebSearch〕，Codex app-server 的 `initialize` 只有 `clientInfo{ name, title, version }` 与能力标志、没有协议版本〔一手，`protocol/v1.rs:29-41`〕，LSP 的 `initialize` 也不协商版本、只交换能力〔二手，WebSearch〕。灵鲸选"不符即禁用"与"不叠兼容层"一致，问题只在信封得让不符的版本号读得出来。
建议改成：`data: LiwaErrorShape`（必填，传输层错误用 `-32700…-32600` 且 `data` 为传输层自己的形状）；`ipcProtocolVersion: z.number().int()` 两边都改，比对放代码；方法清单加 `kernel/health`、`kernel/ready`、`kernel/drain`；§10 加一句"插件 → 宿主只有两种：视图调用与宿主先开的流"。

**C15 ｜ 低 ｜ 设计内修复 ｜ `common.ts:64-70`**
问题：`CallContext` 的注释说"进程内另带 AbortSignal"，但 TS 类型由 schema 推导，没有 `signal`；调用方要么 `as any`，要么各自定义。
建议改成：`export type CallContext = z.infer<typeof CallContextSchema> & { signal?: AbortSignal }`，schema 改名 `CallContextSchema`；IPC 编码时只取 schema 字段，`signal` 经 `callId` 映射 `$/cancel`（已写在注释里）。

**C16 ｜ 低 ｜ 设计内修复 ｜ `brain.provider.ts:80-82`、`envelope.ts:47`、`errors.ts:61`、`memory.engine.ts:20`**
问题：`args / result / payload / data` 用 `z.unknown()`，违反 §2.3"契约里的任意 JSON 一律 `JsonValue`"；回环编解码到时测不住 `Date` 与函数；`FailureCategory` 与 `ErrorCategory` 两套枚举（见 C5）；`forget.now` 是 `z.string()` 不是 `Iso`。
建议改成：四处换 `JsonValue`；`now: Iso`。

**C17 ｜ 低 ｜ 设计内修复 ｜ `00-contracts.md` §1、§3、§5.0、§13；`tools/placeholder.ts`**
问题：文档与代码的小出入汇总：§1 目录（`views/`、`tools/`、`events/journal.ts`）；§3 代码块漏 `enable`、`AssemblyPlan.problems`；§4.1 无 `implemented` 列；§5.0 模板的 `SLOT` 常量代码里集中在 `defs.ts`（代码更好）；§13 列的导出物一致、类型级一致性、IPC 编解码、回环四项没做，`contracts:export` 是占位脚本。
建议改成：文档按代码改前四项；§13 的四项测试与 `tools/export-schemas.ts` 列进 1.7 的 I1 之前（JSON Schema 导出要先验证 `z.lazy` 的 `JsonValue` 能否导出，待实测）。

**C18 ｜ 低 ｜ 要改设计 ｜ `errors.ts:4-18`，`00-contracts.md` §11**
问题：13 类里没有"找不到"（`liwa task open <id>` 的 id 不存在、`memory show` 的条目不存在、句柄已关闭但不是失效）。现在只能报 `invalid_input`（语义是"传参不合 schema"）或 `unavailable`（语义是"没实现 / 熔断 / 句柄失效"），客户端与 CLI 退出码分不出 404 与 400。
建议改成：加 `not_found`（retryable false，JSON-RPC `-32013`），`invalid_input` 收窄为"schema 不过"。要主人定，因为改的是已确认的 13 类清单。

**C19 ｜ 低 ｜ 随 01 落（不算缺口）｜ `brain.provider.ts:30-45`**
备注：`SessionConfig` 没有 `sessionId`（CLI 侧日志与 `clientMessageId` 去重用）、没有推理强度 / 思考档位（Paseo 的 `thinkingOptionId`，Codex 的 `effort`）、`nativeToolPolicy: 'worktree'` 怎么映射到 Claude `permissionMode` 与 Codex `approvalPolicy + sandbox` 没写。这些是 01 的适配器映射层要定的，机制层不缺；只提醒 01 在 `SessionConfig` 上加可选字段时走 §12 的"只加可选字段"。

## ④ 场景推演（协议层面）

**(a) 终端 `liwa chat` 说一句话到收到回复**

1. `cli` 建 WebSocket，发 `Hello{ v, build, token }`（`protocol/client.ts:13`）。缺：服务端 `welcome`（C3），`cli` 不知道 `maxFrame`、构建号是否一致、服务端是否要求刷新。
2. `cli` 发 `Request{ op: 'chat.send', body: { placeId: 'terminal', text }, v }`。缺：`idem`（C3）；`op` 的闭合清单与每个 op 的 body / result schema（07 定，见 ⑥）。
3. gateway 当"形态适配层"（`overall.md` §10.1）→ senses 组 `AppendRequest{ stream: place:terminal, type: 'message.received.v1', actor: 'owner', source: { audienceId: AUDIENCE_OWNER, sourceKind: 'owner', trust: 1, taint: false, placeId }, payload }`（`envelope.ts:43-53`）。有。`message.received.v1` 类型随 07 进 `EVENT_TYPES`，正常。
4. attention → `minds.open / send`（02 §3.1，ledgers 里还是 stub，正常）→ `guard.admit` → `context.forTurn` → `TurnInput{ blocks: [block(状态), text(正文)] }`（`brain.provider.ts:51-57`）。有。
5. `brains` 解析 `brain.provider`（`SLOT_DEFS` bound，`impl` 由 roster 给；m0 从 profile `members.<id>.slots` 取，02 §12）→ `createSession(ctx, SessionConfig{ kernelTools: { native: [reply, inner], token } })`。有。缺：`ToolSpec → ToolDef` 的导出链（C11）。
6. `session.startTurn` → `events()` 流：`turn.started` → `item.tool_call.started{ tool: 'reply', native: true }` → 适配器 `toolport.invoke(token, 'reply', args)` → outbox → actions `effect.intended / completed` → 回复经 gateway 的 `Frame{ sub: 'place:terminal', cursor, items: [message.sent.v1] }` 推给 `cli`。有。缺：`Frame.mode`（第一次订阅应是 snapshot）；`item.message.delta` 语义（C7，终端逐字显示要用）。
7. `turn.completed{ usage }` → `guard.record`。有。缺：订阅 `mind:<id>` 流给 `liwa tail` 用的 `Journal.subscribe({ stream })`（C10）。
结论：m0 链路协议元素齐全，缺的四样都是 C3、C7、C10、C11，没有阻塞 I4 / I5，但 I6（cli / gateway）开工前要定 C3。

**(b) 微信群里有人 @ 她，经进程外 `form.adapter` 进来，她回一句**

1. 适配器进程由 `ipc-host`（kernel-1）经 `procs.spawn` 拉起，fd 3 管道；宿主发 `kernel/hello{ kernelVersion, ipcProtocolVersion, contracts: { 'form.adapter': 1 } }`，插件响应 `{ manifest, pid, ipcProtocolVersion }`（`ipc.ts:26-27`）。有。缺：`views` 版本（C13）；manifest `kind: 'external'` 第一版被 `checkManifest` 拒绝（`kernel/manifest.ts:80`），V2 要放开——这是预期的。
2. 入站：微信消息是插件 → 宿主方向。IPC 只有"宿主 → 插件请求"和"插件 → 宿主的视图调用"两条路（§10），所以必须由宿主先调 `form.adapter/events`（流方法），插件用 `$/stream{ id, seq, kind: 'item', data: 标准消息 }` 推（`ipc.ts:28`），宿主每 256 条 `$/ack`。形状够用。缺：`form.adapter` 的 `events` 流方法与"标准消息"schema（§5.7 只列了名字，V2 落，正常）；§10 没写明"插件发起的事件走宿主先开的流"（C14）；标准消息里要有平台消息号作去重键（senses 至少一次投递后去重），这不在 `AppendRequest` 里（`expectedSeq` 是并发检查不是去重），交 03 / 07。
3. senses 认人、people 算地方键与受众（`AudienceRef` 只能 people 造，C9 要在类型上守住）→ `AppendRequest{ stream: place:<群>, source: { audienceId: 群的受众, sourceKind: 'stranger' | 'bound_human', trust, taint: false, presenceSnapshotId } }`。有。`source` 由 senses 填、插件碰不到，符合"插件不能提交 source"。
4. attention 两道门 → 群的在场 → 用脑 → `reply` → outbox 按受众查 → `form.adapter/deliver{ place, content, idemKey }`（宿主 → 插件请求，§5.7）→ 回执。有形状。缺：回执 schema（随 V2）；`deliver` 超时按"结果不明"处理只对有幂等键的动作重做（§10 最后一条）——`idemKey` 在参数里，够。
5. 插件崩溃：procs 杀进程组、熔断、`plugin.circuit_open.v1`（`events/kernel.ts:11`）。有。
结论：IPC 信封够微信适配器用；缺口是 `form.adapter` 自己的契约（V2，正常）加 C13、C14 两处小修。

**(c) Mac 客户端里主人让她改一个项目，派手（Claude Code），看过程、看 diff、直接跟那只手说话**

1. 主人在主控台对话 → 在场 → `dispatch(交接包)`（§8 工具目录；`ToolSpec` 缺，C11）→ tasks 建任务、workspace 开 worktree → `minds.open(kind: 'hand')` → `createSession(ctx, { mindKind: 'hand', cwd: worktree, nativeToolPolicy: 'worktree', kernelTools: { native: [report, ask, spawn, inner, recall], token }, persona: { stable: 短版人设 }, endTurnAfter: undefined })`。有。`personaInjection` 按 mindKind（C6）在这一步暴露：同一个 Claude 插件此时要用 `preset_append`。
2. 看过程：`events()` → `item.reasoning{ summary }`、`item.tool_call.started{ tool: 'Edit', args, native: true }`、`item.tool_call.completed{ result, ok }`、`item.message{ text }` → minds 投影成 `MindSignal` → gateway `Frame`。有。缺：`detail`（C7）——没有它，客户端只能把 `args: unknown` 原样打印，"看改动对比"要等 `workspace.diff` 的 HTTP 接口（07），实时过程里看不到"改了哪个文件"；`delta` 语义（C7）；`batch`（02 §13 第 2 条）。
3. 看 diff：`workspace.diff(taskId)` 是 gateway 的 op（07），走 HTTP 大对象（`overall.md` §10.3"diff 先发文件清单和统计"）。协议层只需 `Request/Response` 与 `BlobRef`。有。
4. 权限：手要跑一条越出沙箱的命令 → `permission.request{ requestId, tool, args }` → gateway → 客户端弹窗 → `respondToPermission(ctx, { handle, requestId, decision: 'allow' | 'deny' })`。**不够**（C2）：主人没法说"这个会话都允许"，拒绝时没法选"拒绝并停下"。Codex 的 `Cancel` 与 ACP 的 `cancelled` 都把"拒绝并中断"当一等公民。
5. 直连那只手：主人在主控台打开手 → `minds.send({ sessionId: 手, initiator: 'owner' })` → 手正忙则 `session.steer(ctx, { handle, input, expectedTurnId })` 返回 `accepted | unavailable`（`brain.provider.ts:98`；Paseo 的 `steerActiveTurn` 同形〔一手，Helm `agent-sdk-types.ts:211-215、681`〕；Codex `turn/steer{ threadId, input, expectedTurnId }`〔一手，`v2/turn.rs:308-312`〕；Claude SDK 经 `streamInput` 入队〔二手，sub-note 第 54 行〕；ACP v1 没有 steer、只能 cancel 再 prompt〔二手，sub-note 第 225–226 行〕，所以 ACP 适配器的 `steer` 恒回 `unavailable` 且 `Meta.steer: false`）。有。"叫停"= `interrupt`（幂等）。有。
6. 换大脑 / 选 Claude 还是 Codex：roster 绑定 `impl`，`SLOT_DEFS['brain.provider']` 是 bound，`resolve(slot, { impl })`（`kernel/slots.ts:115-119`）。有。
7. 用量：`turn.completed{ usage: { tokens, context, quotaWindows?, providerReportedCostUsd } }`；Claude 的 `total_cost_usd` 是累计值要做差〔二手，sub-note 第 116 行〕、Codex 的 `thread/tokenUsage/updated` 有 `total` 与 `last`〔一手，`v2/thread.rs:1943-1949`〕，适配器各自归一成每回合增量，契约够。缺：额度窗口（C4）。
8. 手完成：`report` 工具（C11）→ tasks 核验 → `task.stage_changed`（03 / 07 事件）→ notify。协议层有。
结论：场景 c 是四处宽度问题的集中地（C2、C4、C6、C7），其中 C2 会直接影响"像 Codex 一样对话编程"的体验，建议在 I3 之前改。

**(d) 手机远程看她现在在干什么，网络断了 30 秒又连上**

1. 手机浏览器经 Tailscale Serve 连 gateway，`Hello{ token }`，订阅"她现在"（实体）、"她的一天"（时间线）。协议元素：`Hello`、`Request{ op: 'sub.open' }`、`Frame{ sub, cursor, items }`。有。
2. 断线 30 秒：服务端这边订阅挂着的发送缓冲涨 → `overall.md` §10.3"超了就降级为只推条目完成"。缺：`Frame.reason: 'degraded'` 让客户端知道中间丢了逐字增量、该按条目补（C3）。
3. 重连：客户端重新 `Hello`。缺：`resume: [{ sub, cursor }]`（C3），否则要逐个 `sub.open` 再对账；Helm 的做法是重连后由消费方自己做历史读取与补洞（`timeline-subscription/index.ts:18`"the consumer owns history reads and gap recovery"），响应里用 `epoch + seq` 游标、`staleCursor`、`gap`、`reset` 告诉客户端要不要整页重取〔一手，Helm `messages.ts:4748-4758`；`daemon-client.ts:1380-1383、1506-1580` 的重连，退避是 `min(baseDelay × 2^attempt, maxDelay)`（`daemon-client.ts:7118-7195`）〕。灵鲸的 `Frame.cursor` 是不透明字符串，够；缺的是 `mode` 与 `reason`。
4. 在途请求：断线时发出的 `Request{ op: 'task.approve' }` 没收到响应，重连后重发——没有 `idem` 就可能批两次（C3）。Helm 为此做了 `agentRequestReceipts` 特性门控〔一手，`messages.ts:3661-3662`〕；灵鲸用幂等键更简单，但字段得在。
5. 服务端游标过期（重启、投影重建）：`Frame{ mode: 'snapshot', reason: 'cursor_expired' }`（C3）。
6. 后端：gateway 重连后从客户端游标补发，需要 `Journal.subscribe({ stream, from })` 或 `read({ stream, from })`（C10）。
结论：场景 d 全部落在 C3 与 C10；这两项不定，07 和 cli 会各自发明游标语义。

## ⑤ 对 02 草稿三条修改建议的意见

| 02 §13 的建议 | 意见 | 改成什么 | 依据 |
| --- | --- | --- | --- |
| 1. `Journal.read` 加按流读取 `{ stream, from?, limit? }` | **同意，且不够**：context 换新要"最近 N 轮"，是从流尾倒着取，还要方向；gateway 重连补发要 `subscribe` 也能按流、从游标起 | 按 C10 的签名：`read({ stream?, from?, to?, limit?, order? })`、`subscribe({ stream?, types?, from? }, cb)`；`StreamRef` 从 `EventEnvelope.shape.stream` 导出 | 〔一手〕`ledgers/index.ts:12-13` 现状；〔一手〕02 §4.3"最近"块从地方流取最后 N 轮；〔一手〕Helm 时间线用 `direction: 'tail' | 'before' | 'after'` + 游标（`messages.ts:1927-1935`） |
| 2. `item.tool_call.started` 加可选 `batch: number` | **同意**，语义要写死：同一次模型输出里并行发出的调用共享一个批号，回合内从 1 递增；适配器判不出批的留空，不许填 1 | 并入 C7 的事件定义；探针据此测"reply 是否在第一批"（`overall.md` §5.2） | 〔二手〕Claude SDK 的 `PostToolBatch` 钩子以批为单位（sub-note 第 83 行）；Codex 的 item 没有批概念，留空是对的〔一手，sub-note 第 191 行的 item 类型清单〕 |
| 3. `envelope.ts` 注释"模块.动作.v<n>"改"对象.动作.v<n>" | **同意**：现有 5 个 kernel 事件（`kernel.started`、`plugin.disabled`、`slot.bound`…）与 `overall.md` 的 `turn.completed`、`effect.intended`、`body.sampled`、`message.received` 首段全是对象，没有一个是模块名 | `envelope.ts:8` 注释与 `00-contracts.md` §6 规则都改成"对象.动作.v<n>，首段是事件所属的对象（turn、session、message、effect、task、body、kernel、plugin、slot…），不是模块名"；正则不变 | 〔一手〕`events/kernel.ts:5-15`；〔一手〕`overall.md` §6.5、§6.8 |

## ⑥ 命令协议：协议层面对 `liwa` 命令必须满足的约束（供与 M 汇合）

M 在设计命令机制，这里只列协议层的硬约束，每条都能落成 contracts 里的一样东西。

1. **命令不是协议，op 才是。** `engineering.md` §12："每条命令对应 07 里的一个 gateway 操作，命令只是壳"。协议层要有的是 **op 的闭合清单**：`protocol/ops.ts` 导出 `OPS = { 'chat.send': { body, result, sideEffect: boolean, owner: boolean, transport: 'ws' | 'http' }, … }`，`Request.op` 从 `z.enum(keyof OPS)` 推；`--json` 的输出就是 `Response.body` 原样。命令名与参数到 op 的映射放 `packages/cli`，不进 contracts。
2. **插件贡献命令 = 插件贡献 op，不是贡献命令行解析。** 若以后允许插件加命令（V1 不做），它贡献的是 `{ op, body: JsonSchema, result: JsonSchema, sideEffect, owner }` 这样一份**可序列化描述**，经 manifest `provides['gateway.op']`（新槽位，走 §12 升版本流程）登记，`cli` 用 `ops.list` 请求发现并动态生成子命令。约束：描述必须是 JSON Schema（和 `ToolSpec → ToolDef` 同一条导出链，C11），不能是代码。
3. **幂等键与副作用。** 有副作用的 op 在 `OPS` 里标 `sideEffect: true`，gateway 要求 `Request.idem`（C3）；`cli` 的 `--idempotency-key` 缺省由命令生成一次并在重试时复用。协议层保证：同一 `idem` 第二次返回第一次的 `Response`。
4. **退出码从错误类别映射，映射表进 contracts。** `engineering.md` §12 定了 0 / 1 / 2 / 3；协议层加 `errors.ts` 的 `EXIT_CODES: Record<ErrorCategory, 1 | 3>`（`invalid_input | not_found | conflict → 1`；`not_permitted | cancelled | quota | auth → 3`；`internal | unavailable | timeout` 也归 1 还是单独一档，交 M 定），本体不可达是传输错误 → 2。这样 `cli` 不自己猜。
5. **主人身份。** 主人专属 op 在 `OPS` 里标 `owner: true`；`Hello.token` 与 HTTP `Authorization` 用本机凭据文件（`overall.md` §11.1），gateway 鉴权后签发的 `OwnerToken` 能力对象只在进程内流转，**不进 contracts**（`00-plugin-kernel.md` §7 第 2 条）。协议层只保证"`owner: true` 的 op 没有主人身份时返回 `not_permitted`"。
6. **版本。** `cli` 与网页同用 `CLIENT_PROTOCOL_VERSION`；`cli` 还要比对 `welcome.build`（C3），不一致退出码 2 并打印两边版本。本机直接执行的命令（`start`、`doctor`、`dump-config`、`backup`）不经协议，但读写的 `AssemblyPlan`、`Profile`、`Patch` schema 来自 contracts，所以它们跟着 `MANIFEST_VERSION` 走。
7. **流式命令用 `Frame`。** `chat` 与 `tail` 是订阅：`tail` 的过滤参数与 `Journal.subscribe` 的 filter 同形（`{ stream?, types?, from? }`，C10），不另造一套；`chat` 的逐字显示依赖 `item.message.delta`（C7）。
8. **斜杠命令不是 op。** `/暂停`、`/别烦我` 是主人账号发的消息文本，senses 拦截不进模型（`overall.md` §10.4、§11.7）；协议层上它就是 `chat.send` 的 body，命令机制不要把它做成 op。

## ⑦ 交给别的方向

**K（kernel）**
- `KERNEL_API_VERSION` 导出了但 loader 从不检查，§12 表写"kernel 第 1 阶段拒绝"〔一手，grep `packages/kernel/src` 无引用〕。
- `Provides.meta` 不校验（C12）：等 contracts 导出 `SLOT_META_SCHEMAS` 后在 `checkManifest` 里接上；现有测试与文档示例的 meta 会被拒。
- `Services.journal` 对 builtin 暴露了 `append`（`kernel/types.ts:79` 的 `Pick<Services, I>`），与 `00-plugin-kernel.md` §7 规则 1、§12"插件试图直接追加经历流（类型与运行时都拒绝）"不符。决策 32 下这是纪律不是安全，但文档写了"类型与运行时都拒绝"，二选一：contracts 分出 `JournalReader` 类型给 builtin，或改文档。
- `Consumes` 接受视图键后（C8），`checkManifest` 要按种类检查并比对 `VIEW_VERSIONS`。
- `SLOT_DEFS.transport` 在 kernel 里没有任何消费者；回环编解码（1.7）落地时它才有用，顺手确认。

**L（目录分层）**
- `00-contracts.md` §1 的 `views/`、`tools/`、`events/journal.ts` 与代码不一致（② 第一行）；建议代码为准：视图清单留 `services.ts`，新建 `views/procs.spawn.ts` 放方法描述（C13），新建 `tools/`（C11），追加协议留 `events/envelope.ts`，文档改目录图。
- `ToolDef` 从 `slots/brain.provider.ts` 搬到 `tools/`（C11）；`ToolCallDetail` 放 `slots/brain.provider.ts`（它是大脑事件的一部分）。
- `renderTurnInput`（02 §4.3）归 `lib/brain-shared`，不进 contracts（它是实现，不是契约）；但 `<liwa-block>` 的名字与转义规则是三家适配器共同遵守的约定，建议作为常量放 contracts `common.ts`（`LIWA_BLOCK_TAG`），实现放 brain-shared。

**M（命令机制）**
- ⑥ 全部；特别是第 1、2 条：op 清单进 contracts、插件贡献命令只能贡献可序列化的 op 描述。
- 第 4 条退出码映射表的归属（contracts `errors.ts` 还是 cli）请 M 与主对话定；本评审建议 contracts，理由是网页与 Electron 也要按类别分流错误提示，映射唯一归属。

**03 / 07（顺带）**
- `EventEnvelope` 没有"属于哪个成员"的字段：`place:` 与 `task:` 流的事件靠 `stream.id` 认不出成员；V5 多成员前要么在 `source` 加 `member?`，要么规定 `correlationId` 的格式。现在不加也行，但 07 的"按观看者受众过滤"要知道这一点。
- 入站消息的去重键（平台消息号）放在标准消息里，由 senses 去重；`AppendRequest` 不加幂等键。

## ⑧ 来源清单（实际读了什么）

**仓库（一手）**
- `docs/handoff.md` 全文（含"评审意见的处理"四份归并表，已处理的意见未重提）。
- `docs/architecture/modules/00-contracts.md` 全文；`00-plugin-kernel.md` 全文（§0–§16）；`docs/engineering.md` 全文；`docs/architecture/overall.md` §2.3、§2.4、§3.1–§3.7、§4.4、§4.8–§4.11、§5.1、§5.2、§5.6–§5.9、§6.1–§6.10、§9.1–§9.4、§10.1–§10.5、§11.1–§11.9、§12.1、§12.8；`05-memory.md` §3.5–§3.6；`06-growth.md` §3.5、§3.6、§4.3；`02-minds.md` 全文；`docs/architecture/README.md` 07、08 两节；`docs/research/2026-10-28-client-backend.md` §3"协议草案""低带宽同步"；`docs/research/2026-10-28-subagent-notes/cli-claude-sdk-codex-app-server.md`（grep 的 70 行：hooks、streamInput、interrupt、usage、permissions、thread/turn 方法）、`cli-protocols-acp-a2a-mcp.md`（grep 的 30 行：ACP 版本、session/update 种类、权限选项、usage_update、无 steer）。
- `packages/contracts/src` 全部 21 个文件与 `package.json`、`tsconfig.json`；`packages/kernel/src/{types,manifest,slots,plugin,events}.ts` 全文，`loader.ts` 第 455–530 行；根 `package.json`、`tools/ci.sh`、`tools/placeholder.ts`、`.dependency-cruiser.cjs`（grep）、`profiles/m0-terminal.yml`、`apps/liwa` 目录。
- 实跑：`pnpm vitest run --project @liwa/contracts` → 1 文件 17 项通过。

**Helm（Paseo 变体，`~/Desktop/coding/person/Helm`，`main` 提交 `1fa999a`，2026-10-29 与 Paseo 官方上游同步，`packages/server` 0.14.0，一手）**
- `packages/server/src/server/agent/agent-sdk-types.ts` 全文 822 行（`AgentClient` 756 起、`AgentSession` 670–724 含 `usageSession` 671 与 `canStopRuntime` 703、`AgentUsage` 217–224、`AgentStreamEvent` 408 起、`AgentPermissionRequest / Response` 470–508、`SteerResult` 211、`AgentPersistenceHandle` 184、`ToolCallDetail` 240–337）。
- `packages/protocol/src/messages.ts`：第 1276–1283、1922–1935、3644–3662、4748–4758、6374–6445、7697–7712 行（目录同步的 snapshot/changes 与 reason、时间线游标 `epoch + seq` 与 `direction`、`server_info` 的 `protocolVersion` 与 COMPAT 特性门控、时间线响应的 `reset / staleCursor / gap`、提供方用量的 `windows / balances / UsageProblem`、WebSocket `hello` 的 `clientType / protocolVersion / auth`）。
- `packages/client/src/daemon-client.ts` 第 1380–1383、1506–1580、2648–2651、7118–7195 行（重连、请求重放、指数退避）；`packages/client/src/timeline-subscription/index.ts` 全文；`packages/client/src/daemon-client-websocket-transport.ts`（grep）；`providers/` 目录清单，Claude 适配器 `providers/claude/agent.ts:1190-1215、5177、2226-2271` 与 Codex 适配器 `providers/codex-app-server-agent.ts:1151-1182、3911-3925、7148-7178、1063-1070`（权限动作、`contextWindowUsedTokens`）；`idle-runtime-cleanup/index.ts:13、63-65`（`canStopRuntime` 否决）。

**Codex（`~/Desktop/coding/person/codex/source/codex-rust-v0.162.0-alpha.17.2/codex-rs/app-server-protocol/src/protocol/`，一手）**
- `v1.rs` 第 29–47 行（`InitializeParams{ clientInfo, capabilities }`，无协议版本）；`v2/turn.rs` 第 306–320 行（`TurnSteerParams`）；`v2/item.rs` 第 66–74、115–123 行（审批决定枚举）；`v2/thread.rs` 第 1903–1970 行（`ThreadTokenUsage{ total, last, modelContextWindow }`、`TokenUsageBreakdown`）；`v2/account.rs` 第 664–672、752–758 行（`RateLimitSnapshot{ primary, secondary }`、`RateLimitWindow{ usedPercent, windowDurationMins, resetsAt }`）；`v2/notification.rs` 第 62–68 行（`ErrorNotification.willRetry`）；`app-server/README.md`（grep 版本与兼容）。

**外部规范**
- 〔一手〕JSON-RPC 2.0 规范原文（curl `https://www.jsonrpc.org/specification`）：`-32000 to -32099` "Reserved for implementation-defined server-errors"，其余空间给应用自定义。
- 〔一手〕ACP v2 文档原文（curl `agentclientprotocol.com/protocol/v2/initialization.md` 第 95–143 行：客户端发最高版本、Agent 选 ≤ 请求的最高版本、不支持回 `-32022` 带 `requested / supported`、未知能力视为不支持；`tool-calls.md` 第 213–376 行：`session/request_permission` 的 `options[]{ optionId, name, kind }` 与 `outcome: selected | cancelled`；`overview.md` 第 39–140 行：方法清单）。`raw.githubusercontent.com` 的 schema.json 超时一次，未再试。
- 〔二手〕MCP 规范 2025-11-25 lifecycle（WebSearch 摘要：服务端回它支持的版本，客户端不支持则断开；早期版本用 `-32602` + `supported / requested`）；LSP 3.17 / 3.18（WebSearch 摘要：`initialize` 只交换能力与 `clientInfo{ name, version }`，无协议版本协商）。
- 〔二手〕ACP 版本协商的 WebSearch 摘要（与一手文档一致，仅作旁证）。

**没读、待实测**
- zod 4 `z.toJSONSchema` 对 `z.lazy` 递归 `JsonValue` 与 `discriminatedUnion` 的导出效果（C17 前提）。
- Claude Agent SDK 能否把 `endTurnAfter` 经 `PostToolBatch` 的 `continue: false` 可靠落地（02 §10 第 1 项，不属本评审）。
- 已核对不再待实测：Helm 0.14.0 的 `AgentSession` 有 `usageSession?()` 与 `canStopRuntime?()`（`agent-sdk-types.ts:671、703`），`idle-runtime-cleanup/index.ts:63-65` 据后者否决回收；与 `brain.provider.ts:102、114` 的 `canStopRuntime` 一致，02 §4.2 的依据成立。
