# 评审：插件机制底座、协议核心与仓库结构（Fable 5.1）

日期：2026-10-29。评审对象：`docs/architecture/modules/00-plugin-kernel.md`（下称 kernel）、`docs/architecture/modules/00-contracts.md`（下称 contracts）、`docs/engineering.md` §4（下称 eng）。背景读了 overall.md §2.3、§3、§5.2、§6.2、§9、§11、§12、§16.2，`plugin-architecture` §2.1 与 D1–D7，`paseo-architecture` Q4、Q10，05-memory §3.5，handoff 决策 17、29、30。cordis 核对的是 `cordiverse/cordis` HEAD 的 `packages/core/src/{context,registry,fiber,reflect,events,service,logger,utils}.ts`（`package.json` 版本 4.0.0-rc.12，curl 于 2026-10-29）；下文〔源码〕指这些文件。没有核对 zod 的 Standard Schema 实现细节与 cordis 的构建产物（见 ③8）。

## ① 总评

**能否开工**：可以作为实现 spec 开工，但要先改三处再写代码；其余可以边做边补。三份文档的骨架（cordis 只管装配、契约可序列化、required 名单明说、loader 八步、profile 叠 patch、effect 释放、测试走真实装配）是对的。对 cordis 4.0 API 的主要假设经源码核对成立：插件形状 `{ name?, Config?, inject?, apply(ctx, config) }`、`Config` 认 Standard Schema（同步校验）、`ctx.provide/get/set`、`inject` 声明依赖且未 inject 即抛错、effect 的四种返回形式、fiber 六态、五种分发、`isolate`/`intercept`、同名服务重复注册抛 `service "x" has been registered at <fiber>`。错的是几处"cordis 会替我们做"的默认想法，和两处会被绕开的信任边界。

最重要的三条：
1. **信任边界靠的是插件自报的 `kind`，守不住**（问题 1、2）。`kind: builtin` / `process: in` 由插件自己的 `package.json` 声明，loader 据此决定进程内外；本机 patch 又能 `insert` 任意包；required 名单按"包名是不是 `@liwa/core`"判定，也是自报。改法：required 插件由进程入口以代码对象传给 `startKernel`，不经 profile 解析；非 required 的 `kind` 由 loader 按**来源**推导（仓库 workspace 内 = builtin，`$LIWA_HOME/plugins` = external），manifest 的 `kind` 只用来比对。
2. **内核服务全部对插件开放，隐私与"先记后做"两道门都能绕**（问题 3）。`consumes ⊆ SERVICE_KEYS` 允许任何插件拿到 `journal`、`actions`、`people`、`gateway`、`toolport`；kernel §3.1 的示例还让大脑适配器 `consumes: ["journal"]`，直接违反 overall §2.3"插件不能直接写经历流"。改法：契约里按槽位给出可消费服务的白名单（第一版只开 `procs`、`abilities`、新增的插件私有派生存储），其余数据一律作为方法入参由消费方（账本）递进来；这正是 D3"引擎只拿到可见集合"的落地。
3. **"进程内外同一份契约"目前只成立一半**（问题 4–7）。IPC 只定义了宿主→插件的槽位方法；插件→内核的服务调用、会话这类对象句柄、契约里大量同步方法（`describe()`、`rank()`、`next()`、`deriveParams()`）和 `ZodType`/`Date` 入参都过不了 JSON-RPC。contracts 说机制层"现在一次定死"，这几处不改，第一个真正的进程外插件（Python 嵌入服务或微信适配器）就会逼着破坏性改契约。IPC 的**运行时**可以推迟到第一个真用户（⑤1），但**信封与方法形状**现在就要改对。

另外两条对 cordis 的误判要在 kernel §7、§13 改掉：(a) cordis 把 `apply`、effect 释放、监听器里的异常都交给 `ctx.logger.error`，而 `LoggerService` 默认只往 1000 条的内存缓冲里写、不输出〔源码 logger.ts〕，不接 exporter 就是"静默失败"，和 §0"宁可不起"相反；(b) 同一 fiber 的 effect 释放是 `Promise.all` 并发、只有起始顺序逆序〔源码 fiber.ts `_unload`〕，"严格逆序"只在单个 `effect()` 内部成立。

**和 DSH / Paseo 的关系**：借对了（profile + patch 叠层、`replace` 整体替换、`dump-config`、manifest 先于代码、required 明说、effect 从第一天写、测试走真实 loader、PENDING 不静默）；避开对了（同进程全信任、模型可装插件、可被 `prepend` 插队的瀑布策略、HMR、schemastery）。没借到位的一点：DSH 插件的 `name` 进 fiber 名，`definePlugin` 要把 `name: id` 交给 cordis，否则重复注册的报错里 `<fiber>` 是 `root`，查不出是谁（这也回答了 kernel §13 的待实测）。Paseo 三个适配器落 `plugins/brain-*`、`brain-shared` 作为库而非插件，合理；但 Q10 建议照搬的三样没有落位（④11）。

## ② 问题清单

| # | 严重度 | 位置 | 问题 | 证据或理由 | 建议改法 |
|---|---|---|---|---|---|
| 1 | 阻塞 | kernel §2、§3.1、§5 步 2–3、§10 | `kind`、`process` 由插件 manifest 自报；loader 用它决定是否进程内、是否算 required | 任何能写进 profile / patch 的包都可写 `kind: builtin, process: in` 进主进程；"required 只允许 `@liwa/core` 声明"按自报的包名判断 | required 插件由 `@liwa/core` 的入口以 `PluginDef[]` 传给 `startKernel({ required })`，profile 里对应 id 只允许带 `config`，带 `package` 即拒绝；非 required 的 `kind` 由 loader 按解析后的 `realpath` 推导（仓库内 → builtin，`$LIWA_HOME/plugins/` → external），与 manifest 不一致则拒绝；`process: in` 只对推导为 builtin 的生效；`REQUIRED_PLUGIN_IDS` 放进 contracts |
| 2 | 阻塞 | kernel §4.2 叠层顺序、§10 | 本机层 `$LIWA_HOME/profiles/*.patch.yml` 与 `--patch` 可 `insert` / `replace.package` 任意路径，而 CLI 子进程与本体同一系统用户（overall §11.1） | 一只带 shell 的手改一行 YAML，下次重启就装进任意代码；"装插件 = 执行任意代码"（plugin-architecture §4 第 11 条） | 第一版：本机层与命令行层只允许 `replace.config`、`disable`、`bind`，`insert` / `remove` / `replace.package` 只接受仓库层；`$LIWA_HOME/profiles` 列入 CLI 沙箱拒绝读写的目录（overall §11.9）；V2 主人安装改为"主人接口写入的配置事件 + 包哈希白名单" |
| 3 | 阻塞 | kernel §3.1 示例、§9 `Services`；contracts §4 `SERVICE_KEYS` | 24 个内核服务键全部可被任何插件 `consumes`；示例大脑插件消费 `journal`、`guard` | overall §2.3："用脑、客户端、插件都不能直接写"经历流；§3.3 plugins"不得让插件绕过行动管线"；拿到 `people` / `actions` / `toolport` 就能自己算受众、自己起副作用 | contracts `SLOT_DEFS[slot].mayConsume` 列白名单；`SERVICE_KEYS` 拆成"插件可消费"（第一版：`procs`、`abilities`、`derived`，见 ③1）与"仅 core 内部"；大脑插件不消费 `journal`、`guard`，用量与事件经 `BrainEvent` 返回、由 core/brains 记账；loader 步 2 按白名单校验 |
| 4 | 阻塞（形状）；运行时可推迟 | kernel §8.2；contracts §10 | IPC 只定义宿主→插件方向。进程外插件需要的反向调用（`procs.spawn`、嵌入、派生存储）没有方法名、没有作用域规则 | 插件→内核的调用正是受众与范围要被宿主强制的地方（D3；OpenClaw 宿主铸造受众） | 加 `kernel/service.<key>.<method>`，只开问题 3 的白名单；宿主按该插件的绑定（成员、槽位）注入作用域参数，插件传来的 `member` / 受众字段一律拒绝；双方各自维护自己发出的 `id` 空间；明确不支持 JSON-RPC batch 数组 |
| 5 | 阻塞（形状） | contracts §5.0、§5.1；kernel §8.3 | `createSession` 返回 `BrainSession` 对象、`events()` 返回 `AsyncIterable`；`"<slot>/<method>"` 命名覆盖不到对象句柄 | 代理无法从 `Methods` 生成；进程外大脑第一天就做不出 | §5.0 模板加 `Handles`：`{ session: { createdBy: 'createSession', methods, events: Events } }`，IPC 方法名 `brain.provider/session.startTurn`，参数带 `handle`；进程内代理仍是同一 TS 接口 |
| 6 | 重要 | contracts §5.1 `describe()`、§5.3、§5.4、§5.5 `next()`、§5.6 `describe()` / `estimate()`；05-memory §3.5 `rank` / `forget` | 大量同步方法与 `now: Date` 入参 | JSON-RPC 只能异步；contracts §2 自己规定 Date 不进契约；05-memory 已确认却与此冲突 | 规则：槽位契约方法一律返回 `Promise`，纯函数标 `pure: true`（进程内直调、worker 可用），时间用 `Iso`；`describe()` 的内容改进 manifest 的 `provides.<slot>.meta` 或 `welcome`；05-memory §3.5 同步改 |
| 7 | 重要 | contracts §5.5 `schema: ZodType`、§8 `ToolSpec.params: ZodType` | 契约接口里出现 zod 实例 | 违反 §2"函数、类实例不进契约"；`job.trigger` 是插件槽位，进程外无法传 zod | 槽位接口里用 JSON Schema（zod 4 `z.toJSONSchema`），宿主侧校验；`tools/` 是内核内部目录可保留 zod，但注明不属于插件契约 |
| 8 | 重要 | kernel §5 步 5–6、§7、§10、§13 | 假设 required 的异常会变成进程退出、`await` 能等到就绪 | 〔源码 fiber.ts `_reload`、`effect`、`_unload`〕错误被 catch 后 `ctx.logger.error`；〔源码 logger.ts〕默认 exporter 只进内存缓冲；`ctx.plugin()` 对 `apply` 的错误不同步抛；`fiber.await()` 在 PENDING 时**立即返回且不报错** | kernel 启动第一件事 `ctx.logger.exporter(...)` 接到自己的 Logger；订阅 `internal/status`，required fiber 进入 FAILED 或离开 ACTIVE 即致命；步 6 用 `fiber.state` 判就绪而不是 `await fiber`；缺的依赖用 `ctx.get(key)` 逐个探测列出 |
| 9 | 重要 | kernel §7、§12 T6、§13 | "按装载逆序 dispose""effect 逆序释放" | 〔源码 fiber.ts `_unload`〕同一 fiber 的 disposables `clear()` 后 `Promise.all` 并发；仅单个 `effect()` 内部串行逆序；跨插件顺序由 cordis 依赖关系保证（提供方等依赖方卸完才释放） | 写明：kernel 自己按逆序逐个 `await fiber.dispose()`；插件内需要顺序关闭的资源放同一个 `effect` 里；§13 这条从待实测删掉 |
| 10 | 重要 | contracts §4 `brain.provider` 角色；kernel §4.1、§6.1 | 角色表 `presence、slow、hand、sleep、backup`，备用只有一个且与用脑种类平级 | 决策 6 每种用脑各有主用与备用；overall §3.3 minds"慢想可按触发类别配不同大脑"；现在表达不了"在场备用 ≠ 慢想备用" | 绑定值改为 `{ <mindKind>[.<triggerClass>]: { primary: impl, backup?: impl[] } }`；profile、`bind` op、`Slots.bind` 同步；m0 profile 现在就按新形状写 |
| 11 | 重要 | contracts §6 `type` 正则；kernel §5 步 7、§8.3、§9 | 经历流事件名要求 `.v<n>`，kernel 写的是 `kernel.started`、`plugin.circuit_open`；进程内 `KernelEvents` 与经历流事件同名 | journal 追加会被 schema 拒绝；两套事件混淆 | 经历流用 `kernel.started.v1` 等并登记进 `EVENT_TYPES`；进程内 `KernelEvents` 改成 `kernel/started` 斜杠风格；journal 就绪前的 `plugin.disabled` / `failed` 先缓冲再写 |
| 12 | 重要 | kernel §9 `createTestKernel({ plugins })`、§12 T10 | 测试接缝直接收 `PluginDef[]`，绕过 manifest、`inject ⊆ consumes`、契约版本检查 | DSH 复盘 0001 正是"测试走了不触及真实加载的路径"（plugin-architecture §2.1） | 改为 `createTestKernel({ profile: ProfileDoc, resolve: (pkg) => { manifest, module } })`，走同一八步；`PluginDef[]` 直装只留给 kernel 自己的单元测试 |
| 13 | 重要 | kernel §5 步 6、§8.2 超时 / 心跳 / 退避、§9 `Clock` | kernel 自己的定时器没说用注入时钟；`Clock` 只有挂钟 | overall §3.1 要求挂钟与单调时钟分开、全部可注入；测试里 10 秒心跳、30 秒退避不能真等 | `Clock` 加 `monotonicMs()`；kernel 全部定时经 `clock.timer`；`rng` 按插件 id `fork`，种子写系统流（overall §6.2） |
| 14 | 重要 | kernel §10"密钥引用不进 manifest 与 dump-config"；eng §7 | 密钥引用没有类型、没有解析点 | 脱敏靠猜字段名不可靠；V2 设置页要知道哪个字段是密钥 | contracts `common.ts` 加 `SecretRef = { secret: string }`；kernel 在步 5 `apply` 前经 `secrets` 解析（钥匙串 → `secrets.env`）；`dump-config` / 插件页按类型脱敏；`startKernel` 加 `secrets` 注入点 |
| 15 | 重要 | kernel §3.1 `provides.<slot>.impl` 固定在 manifest | 同一包无法装两份（`brain-acp` 接 DSH 与接 OpenCode 要两个 impl） | 决策 2、eng §1 第 5 条明确 ACP 要接多个 CLI | profile 条目允许 `impl:` 覆盖（缺省取 manifest），manifest 加 `multiInstance: true` 才允许；同包同 id 仍只装一份 |
| 16 | 重要 | contracts §11 `LiwaError.code: string`；§10 错误 `code`"-32000 起" | JSON-RPC 的 `code` 必须是整数，且 `-32000…-32099` 是规范保留给实现的服务端错误段 | 两处 `code` 含义不同 | IPC：`code` = 由 `ErrorCategory` 映射的整数表（放 `errors.ts`，正数段），`data.code` 放 Liwa 字符串码；`-32xxx` 只给传输层 |
| 17 | 重要 | kernel §8.2 握手 | `hello` 由宿主带 `token`，又说"宿主再校验 token"；`welcome` 回传 manifest | 方向反了；stdio 管道别的进程写不进，token 防的是插件把 stdio 继承给孙进程；回传的 manifest 不可信 | `hello` 不带 token、为请求，`welcome` 为其响应并带 `token`（来自 env）；宿主只用磁盘上读到的 manifest，`welcome` 里的只做比对；规定插件不得把 stdio 继承给子进程 |
| 18 | 重要 | kernel §3.2、§9 `KernelHandle.ctx` | cordis 原生 `Context` 是否会流出 kernel 没有写成规矩 | 〔源码 reflect.ts〕`internal/get`、`internal/config` 是任何持有 ctx 的代码都能 `ctx.on` 的 waterfall，可替换别人看到的 `journal`、改别人的 config | 写成不变量：cordis `Context` 不出 `@liwa/kernel`；`KernelContext` 是独立对象不是 ctx 子类型；服务实例是普通对象（不带 cordis tracker）；`KernelHandle.ctx` 改为 `KernelContext`；插件只有 `on` 没有 `emit` |
| 19 | 重要 | contracts §5.0 模板 | 没有调用上下文、取消、健康的统一形状 | overall §9.4 要求每次调用带调用号、成员、取消信号且取消要真正停止计费；kernel §5 步 7"健康检查一轮"没有契约方法 | 模板加 `CallContext { callId, member?, correlationId?, deadline? }` 作首参；进程内 `AbortSignal` 经 `callId` 映射到 IPC `$/cancel`；可选 `health(): Promise<{ ok, reason? }>` 统一替代 `isAvailable` / `readiness` |
| 20 | 建议 | kernel §3.1 `configSchema`、§4.3；eng §4.2、§4.6 | 步 2 要校验 JSON Schema，但 kernel 依赖只有 contracts、cordis、yaml（§4.6 连 yaml 都没列） | 需要一个 JSON Schema 校验器 | 要么 kernel 加 ajv，要么 `dump-config` 只导入插件的 `./config` 子路径（无副作用模块）用 zod 校验；eng §4.2 与 §4.6 对齐 |
| 21 | 建议 | kernel §9 `definePlugin<C>`、`KernelContext extends Partial<Services>` | `Config: ZodType<C>` 混淆输入 / 输出类型（`.default()` 时不同）；`Partial<Services>` 暗示可选，运行时未 inject 的键会抛错 | 〔源码 fiber.ts `resolveConfig`〕`apply` 收到的是校验后的输出；〔源码 reflect.ts〕"cannot get property without inject" | `definePlugin<S extends ZodType, I extends keyof Services>`，`apply(ctx: KernelContext<I>, config: z.output<S>)`，`KernelContext<I>` 含 `Pick<Services, I>` |
| 22 | 建议 | kernel §9 `startKernel`、§11；eng §4.2 | kernel 不能依赖 pino，但 `Logger` 形状像 pino，没有注入点 | — | `startKernel({ logger })`，core/app 传 pino；kernel 内部用它接 cordis exporter（问题 8） |
| 23 | 建议 | kernel §8.2 大对象"由宿主经 journal 存取" | 把 IPC 临时数据放进经历流的 blob 库 | blobs 是"她的事实"，有保留分级（overall §6.9）；IPC 临时量会污染 | 用 kernel 自己的 `$LIWA_HOME/ipc/<id>/` 临时目录加 TTL，或插件目录内的文件路径 |
| 24 | 建议 | contracts §6 `source.audienceId` 必填 | 系统事件（`kernel.started`）要先向 people 要受众 | kernel 在 journal 可用后立即写事件，不应依赖账本层 | contracts 预留 `AUDIENCE_OWNER = 0` 常量；系统流事件用它 |
| 25 | 建议 | contracts §0、§5.1、§12；eng §8 | zod 版本未钉；`contracts:export` 依赖 JSON Schema 生成；§5.1 同时写 TS 接口与 `Methods` zod | Standard Schema 需 zod ≥3.24；JSON Schema 导出只有 zod 4 内置；两份定义会漂 | 钉 zod 4；类型从 zod 推导（`z.infer`），§5.1 只写 zod，接口由 `Methods` 派生 |
| 26 | 建议 | kernel §8.1；§5 步 5 | 进程外插件靠 `procs`（core 的服务）拉起，但装载顺序没说 | kernel 在层表里低于 core，只能在运行时经服务键拿 `procs` | 步 5 写明"进程外插件的拉起排在 `procs` ACTIVE 之后"，并由此推出"进程外插件永远不能是 required" |
| 27 | 建议 | kernel §4.2"不能 insert 一个 provides 含内核服务键的插件"、§6.3 | `provides` 的键是 `SlotName`（zod 枚举），服务键根本写不进去；`KernelContext` 也没有 `provide` | 规则不可达 | 删掉这条，改为"插件无法 provide 服务键，这由 `KernelContext` 不暴露 `provide` 保证" |
| 28 | 建议 | contracts §3 `SlotName`"从 `SLOT_DEFS` 派生的枚举" | `ability.<种类>`、`ui.area.<区域>` 是开放族 | 枚举列不全就会拒绝合法 manifest | `SLOT_DEFS` 显式列出每个具体槽位名（`ability.embed`、`ability.speech`……），新增一种能力 = 加一行；不接受模式匹配 |
| 29 | 建议 | contracts §4 `ui.*`"single / list / keyed"；kernel §6.1 | `keyed` 不在 kernel 六种基数里（kernel 叫 `registry`） | 两份文档用词不一 | 统一为 `registry` |
| 30 | 建议 | kernel §4.2 `bind`"只能绑到已装载…"；§5 步 6"builtin 超时只警告" | 步 4 时尚未装载；builtin 的 `inject` 只能是内核服务键、全由 required 提供，builtin 的 PENDING 实际不会出现 | 用词与情形 | 改"已在条目表、enabled 且 manifest `provides` 含该槽位"；步 6 只保留"`apply` 超时"的情形 |
| 31 | 建议 | kernel §8.3"主人在插件页手动恢复" | 熔断恢复是主人控制项 | overall §11.6：主人控制项只经 gateway 的主人接口，且要留痕 | 恢复经主人接口、写 `plugin.circuit_reset.v1` 配置事件；插件页只展示 |

## ③ 缺失项（机制层现在不补会返工）

1. **插件私有派生数据的存储接缝。** D3 规定引擎派生数据只进 `derived.db` 的引擎分区，但 `Services` 没有任何数据库服务，插件又不能依赖 `node:sqlite`（eng §4.6）。需要 `Services.derived: L.DerivedStore`：`open(pluginId) → { exec, migrate(steps), reader() }`，表名前缀 `p_<pluginId>_`，每插件一条迁移链（NoneBot 的做法，plugin-architecture §2.3），kernel 在插件 dispose 时关闭句柄；重建 `derived.db` 时按插件回调。不补的话 memory-engine-default 会自己碰 SQLite。
2. **worker 线程里的插件代码。** 05-memory 要 `rank` 在 worker 跑，但装配只在主线程。要么规定第一版纯函数在主线程跑并写进 kernel §7，要么定 `exports["./worker"]` 入口 + `ctx.workers.run(task)` 的约定。
3. **静态配置与运行时配置的分界。** profile 的 `config`（YAML、重启生效）与 eng §7"业务配置是带版本的配置实体，走配置事件"之间没有规则说哪类字段归哪边、主人在设置页改插件配置写到哪。建议：profile `config` 只放部署项（模型名、路径、开关），成员相关设置一律是配置事件；预留 cordis `fiber.update(config)` 路径给以后热更新。
4. **kernel API 自身的版本。** `manifestVersion` 管格式，`CONTRACT_VERSION` 管槽位，进程内插件依赖的 `KernelContext` / `definePlugin` 面没有版本。第一版同仓库同版本可以不编号，但 contracts §12 版本表要写明"进程内插件的 kernel API 随仓库版本"。
5. **`dump-config` / `plan()` 输出的 schema。** 插件页与 CI 快照都消费它，应作为 `AssemblyPlan` 进 contracts（`protocol/` 主人接口载荷），否则 07 / 08 写到一半要回头定。
6. **IPC 的边界条件。** 超过 1 MiB 的行怎么报错、非法 UTF-8、`ping` / `ack` 是通知还是请求、进程外插件的内存上限（Node 插件可用 `--max-old-space-size`，Python 只能靠看门狗）。写一段"没有的就是没有"，比空着好；并明说"进程外 ≠ 安全边界，同一用户的子进程照样能读数据目录"（D6 第 4 条）。
7. **`createTestKernel` 与假时钟的接缝。** 假时钟驱动心跳、超时、退避的方式（问题 13）要写进 kernel §12 测试段，否则 T7 的"超时、熔断"会用真等待。
8. **cordis 的两个待实测项补进 kernel §13**：`FiberState` 是 `export const enum`〔源码 fiber.ts〕，在 `isolatedModules` / `tsx` 下跨包引用可能拿不到运行时值；`resolveConfig` 不支持异步校验〔源码 fiber.ts〕，zod 的 `.refine(async)` 会直接抛 `TypeError`。

## ④ 与整体架构或调研的冲突

1. kernel §3.1 示例 `consumes: ["journal","guard"]` vs overall §2.3"插件不能直接写经历流"、§3.3 brains 的用量归一归 core（问题 3）。
2. contracts §5.2 / 05-memory §3.5：`forget(a, now: Date)`、同步 `rank` vs contracts §2 的可序列化约定（问题 6）；05 已确认，改动要主人知道。
3. eng §2 manifest 字段写的是 `slots`、`contracts`、`config`，kernel §3 / contracts §3 是 `provides`、`consumes`、`configSchema`，D7 是 `liwa.slots` / `liwa.contract` / `liwa.config`：三种写法，以 kernel 为准改 eng §2。
4. eng §3 错误类别 7 种，contracts §11 为 10 种（多 `unavailable`、`conflict`、`timeout`）：改 eng。
5. kernel §0 说 cordis 4.0 线已于 10-29 定，eng §8、§11 第 6 项与 handoff 决策 29 / 30 仍写"3.18 与 4.0 实测后择一"：三处对齐，写明钉 `4.0.0-rc.12` 精确版、升级要过 T1–T10。
6. eng §4.7 本地嵌入"进程内或进程外"、§11 第 3 项"先试 node-llama-cpp 进程内" vs overall §3.5"依赖原生代码的放进程外"：是有意偏离，需在 overall §3.5 表里加一行注明例外与退路（⑥5）。
7. contracts §4 `brain.provider` 的角色模型 vs overall §9.2"成员 × 用脑种类"与 §3.3 minds 按触发类别配大脑（问题 10）。
8. kernel §2 把"九样"列为 required 的范围，overall §9.1 还把**身的动力学**留在内核：kernel §2 补一句"body 的 tick 也在 `@liwa/core`，不做槽位"。
9. eng §4.3 `core/app`"读 profile、启动顺序"与 kernel §9 `startKernel` 读 profile 重叠：定为 core/app 只做进程入口（自检、信号、launchd、把 required 插件与 logger / secrets 传给 `startKernel`），profile 的解析只在 kernel。
10. plugin-architecture D5 要求内容包（`social.pack`、`persona.template`）"纯数据、不运行代码"，kernel §2 却把插件定义为"带 `definePlugin` 默认导出的 npm 包"：加 `kind: data`（或 manifest `data:` 字段），loader 只校验 schema 不 `import()`。
11. eng §4.8 Paseo 落位表缺 Q10 里建议照搬的三样：`agent-response-loop` + `structured-generation-providers`（落 `core/brains`，是睡眠用脑"JSON Schema 校验 + 重试 + 换大脑兜底"的现成件）、`managed-processes` / `tree-kill` / `spawn`（`core/procs`）、`agent-stream-coalescer` / `timeline-projection`（`core/gateway`）。
12. eng §9"不用默认导出"与 kernel §2"入口模块默认导出 `definePlugin`"冲突：入口改为具名导出 `export const plugin = definePlugin(...)`，顺带避开 DSH 复盘 0001 的 `export default apply` 坑。

## ⑤ 可以删掉或推迟的

1. **IPC 宿主的运行时**（拉起、握手、流、背压、`ack`、心跳、熔断、T7）推迟到第一个真正的进程外插件（Python 嵌入服务或 V2 微信）；现在只落 `protocol/ipc.ts` 的信封与问题 4、5、16、17 的形状。这是 V1.0 里最大的一块，也是 roadmap 2.1"3 天"里装不下的那块。
2. `provideFactory`、`chain`、`registry` 三种基数的运行时：`SlotDef` 枚举现在定全，实现等 `gate.policy`（V2）、`ability.*`（V1.1）的第一个消费方。
3. patch 的 `insert` / `remove`、`extends` 链：m0 / M1 的 profile 用不到；留 `replace.config`、`disable`、`bind`（与问题 2 一致）。
4. 插件页数据与 `plan()` 的界面形态：第一版用 `dump-config --json` 的输出直接展示。
5. manifest 的 `client` 段与 `ui.*` 校验：随 08 定；字段先保留为"存在即忽略"。
6. `notices` 字段：是许可证元数据，不该由 loader 校验，移到 eng §9 的 NOTICE 约定。
7. kernel §9 `KernelEvents` 里的 `plugin.circuit_open` 与插件侧 `emit`：随 IPC 一起推迟 / 删除（问题 18）。
8. `platforms: linux`：本体只跑 mac mini，枚举先留 `darwin`。

## ⑥ 需要主人拍板的

1. required 插件改为"入口以代码传入、不经 profile 解析"（问题 1）：代价是九样在 `dump-config` 里仍显示但不能被 YAML 换掉，这与"万物插件化的感觉"有一点距离，但这是 D1"被替换的东西必须有不被替换的东西来检查"的必然。
2. 插件可消费的内核服务白名单（问题 3）：推荐第一版只开 `procs`、`abilities`、`derived`，其余经参数递入；要不要给大脑插件开 `workspace`（只读、限自己目录）。
3. IPC 运行时是否按 ⑤1 推迟：推荐推迟，但 contracts 的信封按问题 4、5、16、17 现在改定。
4. `brain.provider` 绑定形状（问题 10）：推荐 `{ presence: { primary, backup }, slow: { primary, backup, byTrigger? }, hand: {...}, sleep: {...} }`；影响 m0 profile 与决策 6 的落地。
5. 本地嵌入模型进程内（node-llama-cpp 原生扩展）还是从第一天就走进程外 Python 服务（符合 overall §3.5）：推荐进程外，它正好是 IPC 宿主的第一个真用户，也避免原生扩展段错误带崩本体；若坚持进程内，请在 overall §3.5 记为例外。
6. 05-memory §3.5 接缝按问题 6 改为异步 + `Iso`（已确认文档的改动）。
7. 插件配置的归属（③3）：profile YAML 只放部署项，成员相关设置走配置事件。
8. zod 钉 4.x、cordis 钉 `4.0.0-rc.12` 且候选版升级需过 T1–T10：接受候选版的风险，换取 Standard Schema 与 effect 的新形状。
