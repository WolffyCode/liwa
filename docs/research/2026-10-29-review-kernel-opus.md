# 评审：插件机制底座、协议规范与仓库结构（Opus 5.5）

日期：2026-10-29。评审对象：`architecture/modules/00-plugin-kernel.md`（下称 kernel）、`architecture/modules/00-contracts.md`（下称 contracts）、`engineering.md` §4。对照：`overall.md` §2.3、§3、§5.2、§6.2、§9、§11、§12；`plugin-architecture` §2.1 与 D1–D7；`paseo-architecture` Q4、Q10；决策 17、29、30；`05-memory.md` §3。
核对方式：〔源〕= 2026-10-29 用 curl 读的 cordis `packages/core/src/*.ts`（npm `latest` 标签就是 `4.0.0-rc.12`，2026-10-21 发布）与 zod v4 `packages/zod/src/v4`（npm `latest` 为 4.6.7）；其余为文档对照或〔推理〕。

## ① 总评

**能不能作为实现 spec 开工：方向对、骨架可用，但不能原样开工。** "形状照 DSH、信任不照"落得准：manifest 先于代码、required 明说、不静默 PENDING、effect 从第一天写、进程内外同一份契约；"消费方只 inject 内核服务键、槽位实现经 `slots.resolve` 取"避开了 cordis 的级联卸载，这一手很好。contracts 的信封字段和 overall §6.2 对得上，工具目录和 §5.2 一致。问题集中在三处：插件到底拿到什么（门面与权限）、契约能不能真出进程（方法形状）、范围与所有权（和 overall、roadmap 对不上）。修完阻塞两条和重要里的 #3 #4 #5 #8 #9 #10 #12（基本都是改文档，约半天）就能按 m0 开工，其余边做边补。

**最重要的三条：**
1. **KernelContext 必须是 kernel 自建的封闭门面，插件只拿受限视图**（#1、#7）。按现稿，拿到 cordis ctx 的插件能经 `internal/get` 拦截、`registry.replace` 替换、`Symbol.for('cordis.root')` 拿到根上下文，拿到完整 `journal` 的插件能伪造经历。"required 不可替换""经历流唯一来源""主人专属"三条都守不住。
2. **契约的方法形状要在机制层定死**（#2、#18）。现有契约里的同步方法、返回会话对象、`ZodType` 字段、`Date`、在 worker 里跑的 rank 都出不了进程。不先定规则，以后转进程外要改所有插件。
3. **先砍到 m0 用得到的规模，并解决与 overall 的所有权和范围冲突**（#3、#4、#14、④-1/2）：大脑绑定归 roster，不归 kernel 的配置层；槽位"必须有"由所属服务决定；IPC 宿主推迟到第一个真正的进程外插件。

## ② 问题清单

**1｜阻塞｜kernel §2、§3.2、§9、§10；engineering §1.2 —— KernelContext 没说是不是 cordis ctx，required 守不住**
- 证据〔源〕：`ctx.get(name)` 直接查服务表，不看 inject（reflect.ts `get/_getImpl`）；`ctx.on('internal/get', …)` 是不带过滤的 waterfall，能拦截全进程的服务访问、返回假的 `guard`（reflect.ts 第 114 行、events.ts `_resolve`）；`ctx.registry.replace(old, new)` 能在运行时替换任意插件的实现（registry.ts 第 185 行）；`internal/config` waterfall 能改写别的插件的配置；`isolate` 加 `provide` 能给子树造同名的假服务；cordis 的符号用全局 `Symbol.for`，所以 `ctx[Symbol.for('cordis.root')]` 不用 import cordis 也能拿到根上下文，ESLint 的"禁 import cordis"挡不住。服务实例是工厂造的普通可变对象，`ctx.journal.append = …` 会改到所有消费方。
- 改法：§9 写明"KernelContext 是 kernel 自建的冻结对象，cordis ctx 只存在闭包里"。只暴露 `pluginId、clock、rng、ids、log、effect、on`（`on` 在运行时只认 KernelEvents 名单），加上本插件 inject 的服务，以及按种类裁剪过的 slots（见 #7）。`emit` 只给 kernel。`defineService` 的产物带标记，loader 拒绝非 required 包里带标记的产物。服务实例在 provide 之前冻结。类型上让 `ctx` 按 inject 收窄（`Pick<Services, I[number]>`），不用 `Partial<Services>`。§10 补一句：进程内 builtin 的约束防的是误用，不防恶意（D6）。

**2｜阻塞｜contracts §0、§5.0–§5.6；kernel §8.3 —— "一切可序列化、代理与进程内无感"在现有契约上做不到**
- 证据：同步方法有 `describe()`、`canStopRuntime()`、`describePersistence()`、`renderPersona`、`deriveParams`、`relationDelta`、`defaultPermissions`、`JobTrigger.next`、`EmbedAbility.describe/estimate`，IPC 天生是异步的。`createSession` 返回带方法的 `BrainSession`，`events()` 返回 `AsyncIterable`，可 IPC 只有 `"<slot>/<method>"`，没有句柄。`JobTrigger.schema: ZodType` 是运行时对象。§5.0 的模板 `{params, result, timeoutMs}` 表达不了这些。
- 改法：机制层加"方法形状规则"。①槽位方法一律返回 Promise；静态描述（describe、capabilities、jobs、触发器 schema）进 manifest，或在握手时一次取回、由代理缓存。②模板加 `handles`：返回子接口的方法返回 `{ handle }`，子方法名为 `"<slot>/<Iface>.<method>"`，句柄在 close 或插件重启时失效、报 `unavailable`。③流式在 Methods 里声明 `stream: <事件 schema>`，请求里不另加 `stream: true`（kernel §8.2 与 contracts §5.0 的写法不一致）。④契约里只许 JSON 值。⑤TS 接口由 Methods 推导（`ClientOf<typeof Methods>`），不手写两份。⑥测试里给所有进程内槽位调用套一层"JSON 往返加 schema 校验"的回环编解码，这样 V1 不建 IPC 宿主也能证明契约出得了进程。如果暂时不想做②，就给 SlotDef 加 `transport: 'any' | 'in-process'`，明确把 brain.provider 标成只能进程内（overall §3.5 本来就是进程内），见 ⑥-6。

**3｜重要｜kernel §4.1 `members`、§4.2 叠层最后一层、§6.3；overall §2.3、§3.4、§6.9 —— 大脑绑定三处写，"主人配置事件层"在步 1–4 读不到**
- 证据：overall 里大脑配置归 roster（"只有主人"，§6.9 是带版本的配置实体，走配置事件），会话的大脑绑定归 minds，自动切备用在 brains；kernel 又加了一层"主人在主控台改过的绑定"，同一事实写在三处。这一层要读经历流，而步 4 和 `dump-config` 规定不导入业务代码，读不到，`dump-config` 会和实际装配不一致，装配树哈希也不包含它。profile 的 `members` 按成员 id 写死，可成员是 roster 在运行时创建的（§11.6）。绑定只到 impl：每种用脑用哪个模型（在场便宜、慢想强）在 profile 里没有地方写，示例把 `model` 放在插件级 config，看起来像全体共用一个模型；备用是单值，而 §3.4 说的是"已过审名单"。
- 改法：kernel 的绑定只管"哪些 impl 可用"和"部署默认"。profile 改成 `memberDefaults`（对所有成员生效）加可选的按成员覆盖。删掉"主人配置事件层"。brain.provider 的有效绑定由 roster 的大脑配置给出：每个 成员×用脑种类 一份 `{impl, model, fallback:[…]}`，慢想可以按触发类别分，brains 在运行时解析，kernel 只校验引用到的 impl 存在。`brain-claude` 的 config 只放适配器级参数，模型走 `SessionConfig.model`。memory.engine 这类要重启才能换的，主人的改动写成 `$LIWA_HOME/profiles/<id>.owner.yml` 文件层（同时记一条配置事件备查），保证步 1–4 读得到。

**4｜重要｜kernel §5 步 5–6、§6.1、§4.1 示例；contracts §5.2；roadmap 1.7 —— 没有"槽位必须有"的表达，m0 示例自相矛盾**
- 证据：builtin 失败一律"禁用、警告、槽位按不可用"，而 contracts §5.2 要求 memory.engine 解析不到就启动失败，谁来执行没写。示例 `m0-terminal.yml` 装了记忆、成长、关系、作业四个插件，还要求成员绑定；而 m0 的定义只有 journal 最小版、procs、brain-claude、minds 与 context 最小版、两个工具、gateway、cli 和静态人设（engineering §10②）。
- 改法：SlotDef 加 `requiredBy?: ServiceKey`，含义是"该服务在装配里时，槽位必须有可用实现，否则步 6 失败"：memory.engine←memory、growth.engine←self、brain.provider←brains；ability.embed 不设，缺了就降级。这样 m0 不装记忆账本，就不需要记忆引擎。m0 示例只留 brain-claude 一行。

**5｜重要｜kernel §3.1、§4.3、§5 步 1/3/6 —— manifest 不写"提供哪个服务键"，静态检查做不了**
- 证据：`provides` 只列槽位，服务键只出现在代码里的 `defineService(key)`。于是步 3 的"没有别的插件提供内核服务键"、`dump-config` 的"缺失的服务键"在不导入代码时算不出来；成环或缺提供方要等 20 秒超时才知道；required 的装载顺序还要靠另一份"core 层表"。
- 改法：`plugins[]` 每项加 `service?`（只许 required 用）和 `consumes`。步 3 据此静态建服务图，缺提供方、重复提供、成环当场失败并点名。required 的装载顺序取拓扑序，层表只给 dependency-cruiser，或者两者从同一个文件生成。导入后核对 `defineService` 的 key 和 manifest 一致。required 集合等于当前 `@liwa/core` 导出的全部插件；CI 静态检查"每个 inject 都有 required 提供方"；m0 期间 core 只导出 m0 的模块。

**6｜重要｜kernel §2、§3.1 `kind/process`、§10；D6、D7 —— kind 是插件自报的，"只装仓库里的插件"没落到 loader**
- 证据：loader 只校验"required 只能由 core 或 kernel 声明"。一个仓库外的包写上 `kind: builtin, process: in` 就进了主进程；包名叫 `@liwa/core` 的包也没核来源路径。
- 改法：kind 由 loader 按来源推导，manifest 里的只用来核对。解析出的真实路径在 `packages/core|kernel` 下的是 required，在 `packages/plugins/*` 下的是 builtin，其余是 external、强制 `process: out`。V1 遇到 external 直接拒绝，IPC 测试插件只在测试内核里放行。

**7｜重要｜kernel §6.2、§9；contracts §2 `AudienceRef`、§7 —— 插件拿到的是完整账本接口**
- 证据：`consumes: [journal]` 就拿到完整的 `L.Journal`，可以 `append` 任意类型，伪造 `memory.accepted` 或配置事件，直接击穿"经历流唯一来源"；`erasePayload`、`editBirth`、people 的 `bind`、roster 的 `setBrains` 如果挂在服务对象上，就是"主人专属"被插件调到（D1⑧要求任何插件都调不到）。`AudienceRef` 是普通数字，"只有 people 能造"没法执行。插件拿到的 `Slots` 带 `define/bind`，brain-codex 可以把在场改绑到自己。示例 brain-claude 声明了 `journal、guard`，适配器其实不该直接写日志或碰总闸。
- 改法：contracts 分两张表：`SERVICE_KEYS`（required 之间用）和 `PLUGIN_VIEWS`（非 required 插件能声明的受限视图）。按 05 §3.5，事件是作为入参推给引擎的，引擎不需要 journal；V1 的视图大概只要 `procs.spawn` 一项。主人专属操作不挂在服务对象上，做成只交给 gateway 主人接口的能力对象。插件提交的受众、来源、可信度字段一律忽略、由内核重算（D3），类型用 branded。builtin 的 slots 门面只有 `provide/provideFactory`，`resolve` 只给 required。这样插件只依赖内核服务、不依赖别的插件，"插件间依赖"的问题也随之消失。

**8｜重要｜kernel §5 步 5–8、§7 —— 缺 ready、drain 两个生命周期钩子**
- 证据：required 先装、builtin 后装。gateway、scheduler 一进入 ACTIVE 就可能接活（主人发消息、作业到点），这时大脑和引擎还没登记，`resolve` 只会得到 `unavailable`。scheduler 要在启动时收齐 `job.trigger` 和各引擎的 `jobs()`，也得等全部装完。关闭时"停接新回合"由谁、在哪个钩子里做，没写。服务是普通对象，cordis 的 tracker 不会把 `journal.subscribe(cb)` 记到调用方的 fiber 上，插件卸载后回调会残留。
- 改法：`definePlugin` 加 `ready?(ctx)`，在 `kernel.started` 之后调用，对外接入、定时器、订阅都在这里开；加 `drain?(ctx, deadline)`，作为关闭的第一步按逆序调用。规定 apply 里不得 resolve 槽位。凡是登记回调的服务方法都返回释放函数，调用方必须包进 `ctx.effect`（ESLint 覆盖 subscribe、registerProjection、on）。消费方不得跨调用缓存解析出来的实例（给热重载和熔断留门）。

**9｜重要｜contracts §2、§3；engineering §4.2 —— zod 大版本没钉，按 zod 4 写出来的 schema 会拒掉所有 manifest**
- 证据〔源〕：zod 4 的 `$ZodRecord` 在键 schema 有 values（枚举）且不是 partial 时会逐键校验，所以 `provides: z.record(SlotName, …)` 和 profile 的 `slots: z.record(SlotName, …)` 要求每个槽位名都出现。`z.object` 默认丢弃未知键，profile 里把 `disabled` 拼错会被静默忽略，违背"宁可不起"。`z.string().datetime()` 在 v4 已标弃用。插件各装一份 zod 会出现多个实例。
- 改法：钉 zod 4.x（pnpm catalog），由 contracts 统一 re-export `z`。改用 `z.partialRecord`。manifest、profile、patch、插件 Config 一律 `z.strictObject`；IPC 和契约消息保持丢弃未知键，"只加可选字段"才能向前兼容。两种策略都写进 §2 的约定。`Iso` 改成 `z.iso.datetime({ offset: true })`，`BlobRef.blob` 改用 `/^[0-9a-f]{64}$/`。

**10｜重要｜kernel §2、§3.2 与 engineering §4.1、§9 —— 默认导出和"禁默认导出"直接冲突**
- 证据：DSH 复盘 0001 正是一行多余的 `export default apply` 让 loader 丢了 inject。
- 改法：入口改成命名导出 `export const plugin = definePlugin(...)`，loader 只读 `mod.plugin`，模块里出现默认导出就拒绝。

**11｜重要｜kernel §9 `createTestKernel`、§12 T10；engineering §4.3 `testing/`、§4.6 —— 测试内核绕开真实加载，测试接缝也没地方放**
- 证据：`createTestKernel({ plugins: PluginDef[] })` 直接收插件对象，跳过包解析、manifest、`import()`、导出名处理和 inject⊆consumes，正是 0001 漏测的那条路。插件包不能依赖 core，而假时钟、计数器随机、录放大脑放在 `@liwa/core/testing`，插件测试拿不到；生产 loader 又不许替换 required，插件测试没有合法的假服务来源。
- 改法：测试内核吃"包路径加内存 profile"，和 `startKernel` 走同一段步 1–8 代码，只多一个 `fakeServices` 参数（只有测试内核能替换 required）。新建 `@liwa/testkit`（依赖 contracts、kernel），放假时钟、计数器随机、编号源、服务假实现和录放大脑。录放大脑做成一个 `brain.provider` 实现，顺带让"换实现"在 M1 就真走一遍。

**12｜重要｜kernel §9 `Clock`、`CounterRng`；engineering §4.1、§5；overall §3.1、§12.1、§14 —— 时钟、随机源、编号不满足回放要求**
- 证据：`Clock` 只有 `now(): string` 和 `timer`，没有 overall §3.1 要求的单调时钟和时区。`CounterRng` 只能 `state()`，不能从状态恢复，而 §12.1 第 5 步要从 `body.sampled` 记下的随机源状态续跑。每个插件的 `ctx.rng` 怎么来没写：如果共用一条流，加一个插件就会改变别人的随机序列，L0 回放就对不上。会话号、回合号若用 `crypto.randomUUID()`，§14"按（会话、轮次、输入哈希）录放"也匹配不上。
- 改法：`Clock { wall(): { iso, ms, tz }; mono(): number; timer(ms, fn) }`。`fork(label)` 只由（种子, label）决定，`ctx.rng = root.fork('plugin:' + id)`，并提供 `fromState()`。kernel 给 `ctx.ids.next(prefix)`。ESLint 再禁无参的 `new Date()`、`performance.now`、`crypto.randomUUID/getRandomValues`，`setTimeout/setInterval` 只许 kernel 和 procs 用。`clock.timer` 只给基础设施（超时、看门狗、探活），业务上的周期性工作走 scheduler 作业（决策 18）。

**13｜重要｜kernel §5、§10 末行；overall §12.1 —— 没有安全模式**
- 证据："连续启动失败达到预算，只起主控台"照抄进了 kernel，但 required 是全有或全无，"只起主控台"装配不出来。失败计数存在哪也没写，存进 liwa.db 的话库坏了就数不了。
- 改法：组合根（#22）里放一个不经 kernel 的极简安全页：最近一次失败的插件和原因、日志、写本机 patch 禁用某个 builtin、从备份恢复。失败计数写 `$LIWA_HOME/run/boot.json`，不进库。

**14｜重要｜kernel §0 末条、§12；roadmap 2.1；engineering §11 第 3 项；D7 —— V1.0 范围和预算对不上**
- 证据：V1.0 要做 manifest 全部字段、五种 patch 操作、六层叠加、六种基数、完整的 IPC 宿主（T7 有八类测试）、插件页数据。roadmap 给 2.1 的是 3 天，而且还含 contracts 第一批契约（总清单里甚至写的是 1 天）。IPC 宿主在 V1.0 没有真用户：嵌入已定先在进程内，D7 也没把 IPC 列进第一版。
- 改法：拆两段。kernel-0（m0 之前，约 3 天）：门面、manifest 最小集、不带 extends 的 profile、patch 的 replace/insert/disable/bind、步 1–8（不含 IPC）、静态服务图、bound/member-single/list/registry 四种基数、effect、dump-config、测试内核、回环编解码测试。kernel-1（第一个真进程外插件出现时）：IPC 宿主、心跳、背压、熔断。其余见 ⑤。

**15｜重要｜kernel §8；contracts §10 —— 进程外插件：做 IPC 时这些必须一起定**
- 协议走 stdout：Python 模型库、llama.cpp 一类原生库会往 stdout 打日志和进度条，直接冲坏 NDJSON。→ 协议改走 fd 3 管道（`stdio: ['ignore','pipe','pipe','pipe']`），stdout 和 stderr 都当日志；收到非 JSON 行就计数告警，不崩。
- 令牌：stdio 管道只有父子两端，令牌防不了冒充，放在环境变量里同用户还能读到；宿主把 token 发给插件、插件不回传，宿主"校验 token"无从谈起。→ stdio 下删掉，留给以后的套接字传输（插件回显 nonce 的 HMAC）。"插件拿不到 liwa.db 路径"也不成立，从 cwd 就能推出来，改成"不告知；隔离等 Seatbelt"。
- 反向调用：说了插件读账本要经宿主代查，但没定义插件能反向调哪些方法。→ 只能调 manifest `consumes` 里的受限视图（#7），按成员和范围裁剪，默认一个都没有。
- 取消：`$/cancel{streamId}` 只能取消流，而一键暂停和总闸要中止所有在途调用（overall §9.4、§11.7）。→ `$/cancel{ id }` 对任意请求都有效；契约方法统一带调用上下文 `{ callId, member, deadline }`，进程内对应 AbortSignal。
- 流：宿主先回 `{streamId}`，插件再发 `$/stream`，流条目可能比响应先到。→ 直接用请求 id 当 streamId。
- 资源：没有内存、CPU、日志量的上限。→ manifest 加 `resources: { maxRssMb, cpu: 'background'|'utility', logMbPerDay }`；procs 定时采样 RSS、超限就杀（计入熔断）；后台插件用 `taskpolicy -b` 启动；stderr 日志按插件限额轮转。
- 1 MiB 单行上限：Qwen3-Embedding 的 1024 维向量写成 JSON 每条约 14–22 KB，一批几十条就超。→ 向量用 base64 编码的 Float32 小端，或者契约里声明单批上限。
- 握手：`kernel/welcome` 应该是 `kernel/hello` 的返回结果，不是另一个方法；kernel §8.2 的 hello 缺 `protocolVersion`，和 contracts §10 不一致；不支持 batch 要写明。

**16｜重要｜contracts §5.1 brain.provider（标了"定稿"）—— 还缺六处**
- `kernelTools` 的 `{ native: ToolDef[] }` 分支既没有令牌也没有回调，原生注入的工具被调用时，适配器无法带着会话身份把调用交回 toolport（overall §11.3）。→ native 分支也带 `token`，执行经 `toolport.invoke(token, tool, args)`。
- overall §5.2、§13 依赖"工具批结束钩子省掉第二次推理"，契约里既没有这项能力也没有开关。→ 加 `BrainCapabilities.batchEndHook` 和 `SessionConfig.endTurnAfter?: string[]`。
- minds 要在"接近上限时先写回再换新"，`Usage` 却没有上下文窗口的占用。→ 加 `contextUsedTokens/contextMaxTokens`（Paseo 的 `AgentUsage` 本来就有）。
- 规定"两个回合之间 CLI 退出也要报 turn.failed"，可这时没有 turnId。→ 加 `{ kind: 'session.exited'; category }`。
- `events()` 的订阅时机和消费者个数没写，先 `startTurn` 后订阅会丢掉 `turn.started`。→ 规定从会话创建起缓冲、单消费者、只能调一次。`item.tool_call.result?` 什么时候到也不清楚，拆成 started 和 completed 两种事件。
- `Usage.costUsd` 是 SDK 的估价，而 overall §11.8 明说不用 SDK 估价。→ 改名为 `providerReportedCostUsd`，注明 guard 不用。

**17｜重要｜contracts §5.6 ability.embed；overall §9.4、§11.8 —— 能力契约缺调用上下文，用量带了钱**
- 证据：缺调用号、成员和取消信号（§9.4 说这三样所有能力共用）；`usage?: Usage` 借用了大脑的 token 和费用结构，`estimate` 直接返回 `costUsd`，和"保留原始计量单位，换算成钱只在 guard 里做"冲突。
- 改法：`embed(ctx: CallContext, texts, opts)`；用量写成 `{ unit: 'tokens'|'chars'|'seconds'|'images', amount }`；`estimate` 只返回原始单位。其余能力种类照这个模板。

**18｜重要｜05 §3.1、§3.5；contracts §2、§5.2；roadmap 2.17 —— 记忆引擎契约和"可序列化"冲突，worker 也接不上**
- 证据：`rank` 是同步纯函数、"在 worker 里跑"，`forget(a, now: Date)` 用了 Date，`MindContext` 里有 `now: Date` 和 `canSeeEvent()` 函数，都和 contracts §2"Date、函数不进契约"冲突。更大的问题是槽位登记的是主线程上的实例，worker 里拿不到，kernel 没有"在 worker 里按模块路径和配置重新实例化插件"的机制，而 roadmap 2.17 在 V1.0 就要"召回 worker 五路"。
- 改法：二选一写死。(a) rank 放主线程（只给几百个候选排序，够快），重查询由账本在 worker 里做；(b) manifest 加 `workerEntry`，kernel 在 worker 里按（包、配置）实例化，只许纯函数方法。时间统一用 ISO 字符串或毫秒数。写明 `MindContext` 是 required 之间的进程内类型，contracts §0 的"可序列化"只管槽位契约和插件视图。

**19｜重要｜contracts §10、§11；kernel §8.2 —— 错误类别不全，IPC 错误会丢信息**
- 证据：缺 `cancelled`（被暂停或总闸中止。调用方不能当成可重试去换下一家，§9.4 规定只有可重试的失败才换家）；缺 `invalid_input`（调用方传错，区别于模型输出坏的 `invalid_output`）；缺 `internal`（代码缺陷）。IPC 的 `error.data` 只带 category 和 retryable，丢了 `LiwaError.code` 和 `data`。kernel 写"超时按 retryable 返回"，contracts 却有 `timeout` 类别。
- 改法：补这三类，每类写明默认的 retryable；JSON-RPC 的 `error.data` 放完整的 `LiwaErrorShape`；数字 code 按类别映射到 -32000 至 -32019，映射表放 contracts。

**20｜重要｜contracts §0、§12 —— 版本体系漏两样，一个版本号管了两种对端**
- 证据：插件消费的服务接口（`ledgers/` 里的类型）没有版本；`@liwa/kernel` 的插件 API 也没有版本，握手里的 `kernelVersion` 没人检查。`PROTOCOL_VERSION` 同时管前后端和 IPC，改一边就让另一边全部对不上。插件 Config 没有版本，`$LIWA_HOME` 里的本机 patch 升级后可能失效。
- 改法：加 `SERVICE_VERSIONS`（或把插件视图并入 `CONTRACT_VERSIONS`），manifest 写成 `consumes: { 'procs.spawn': 1 }`。external 插件用 peerDependencies 声明 `@liwa/kernel` 的精确版本。拆成 `CLIENT_PROTOCOL_VERSION` 和 `IPC_PROTOCOL_VERSION`。overall §12.8 的升级流程加一步：用新构建对本机 profile 跑一遍 dump-config，失败就不切换。

**21｜重要｜kernel §4、§10 末句；engineering §7 —— 密钥和配置分层没定义**
- 证据：只说了"密钥引用不进 manifest 和 dump-config"，引用怎么写、什么时候解析、进程外插件怎么拿，都没写。插件配置（profile 和 patch，属于部署级）和业务配置实体（overall §6.9，走配置事件）的边界也没写，比如主人想改嵌入批大小，该改哪一层。
- 改法：引用写成 `{ $secret: 'keychain:liwa/deepseek' }`，kernel 在把 config 交给插件前才解析，dump-config、日志和装配树哈希里只出现引用；进程外插件经环境变量只拿到它声明过的密钥。规则：插件 config 只放部署参数（改文件、重启生效）；凡是主人能在主控台改的，都是所属模块的配置实体，插件经服务读取。

**22｜重要｜engineering §4.2、§4.3 `core/src/app`；kernel §13 —— 没有组合根，按包名动态 import 在 pnpm 下靠运气**
- 证据：谁依赖全部插件包、谁是进程入口，没写。`core/app` 写着"读 profile、启动顺序"，和 kernel 的 loader 重复。pnpm 严格隔离下，kernel 包里的 `import('@liwa/plugin-x')` 只能靠上溯到根目录的 node_modules 碰巧解析成功。示例的 `exports` 没有 `"./package.json"`，按包名找 package.json 会报 ERR_PACKAGE_PATH_NOT_EXPORTED。`import.meta.resolve` 的第二个参数在 Node 24 仍要实验开关。
- 改法：新增 `apps/liwa`，依赖 kernel、core 和全部插件，持有 main、自检、信号处理和 launchd 入口，并把自己的 URL 作为解析根传给 `startKernel`；`core/src/app` 并进去。manifest 规则加一条"exports 必须含 `./package.json`"（或者用 `module.findPackageJSON`，它在 Node 24 仍是实验级）。

**23｜重要｜engineering §4.8；Paseo Q10；overall §3.4 —— Paseo 剥离的三个缺口**
- (a) Claude 适配器依赖的 `utils/spawn、tree-kill` 一旦照搬进 brain-shared，适配器会自己拉进程，绕开 procs 的"先登记再拉起、进程组、清孤儿"。→ 适配器经 `ctx.procs.spawn` 拉起（Claude Agent SDK 的自定义拉起选项要实测）；除 procs 外禁止 import `node:child_process`。
- (b) 照搬的 1.1 万行代码 import 的是 Paseo 的 `agent-sdk-types.ts`（818 行），这份文件却定为"裁剪进 contracts、不照搬"，照搬的代码会编不过。→ 它原样放进 `brain-shared/src/paseo/`，每个适配器加一层 `src/adapter.ts` 把 Paseo 的类型映射到灵鲸契约，`src/paseo/` 尽量不改，方便跟进上游。
- (c) Q10 标了"照搬"的几块没有落位。→ 工具调用归一（约 1,320 行）放 brain-shared；`agent-response-loop` 和 `structured-generation-providers` 放 core/brains（overall §12.3 点名睡眠和去查要照搬）；`agent-stream-coalescer`、`timeline-projection`、`creation/`、`idle-runtime-cleanup` 放 core/minds；`managed-processes` 放 core/procs；`agent-attention-policy` 放 core/notify。

**24｜重要｜kernel §0、§7、§13；engineering §2 —— cordis 的几条事实要更正，§13 的待实测项源码已经能回答〔源〕**
- 依赖没到齐（PENDING）时，`await ctx.plugin(p)` 立刻返回、不报错（fiber.ts 的 `await()` 只等 inertia）。步 6 不能靠 await，要监听 `internal/status` 或者轮询 `fiber.state`。
- 一个 fiber 卸载时，释放函数按逆序启动、但用 `Promise.all` 并发执行（`_unload`），异步释放并不严格逆序。跨插件时，只有 inject 声明过的依赖才会出现"提供方等消费方卸完"；槽位实现不走 inject，所以步 8 要由 kernel 逐个 `await fiber.dispose()`。
- 依赖消失时状态走 ACTIVE→UNLOADING→**PENDING**，依赖回来会**重新执行 apply**。FAILED 只能经 `update()` 清除，`restart()` 清不掉。
- Config 只走同步的 `~standard.validate`，返回 Promise 就抛 "Async config validation is not supported"。zod 4 在同步检查抛异常时会退到异步校验，真实错误就被这句掩盖了，所以插件 Config 不能用 async 或会抛异常的 refine、transform。
- 重复 provide 的报错是 `service "x" has been registered at <插件 name>`，`definePlugin` 要把 `name` 设成 id。`emit` 不隔离监听器的异常（events.ts 第 104–107 行），门面要逐个 try/catch。cordis 自己的错误日志默认只进 1000 条的内存缓冲，kernel 启动时就要注册 exporter 转进 pino，否则插件失败的原因会静默丢失。
- engineering §2 的"作用域与 fork"和"事件四种"要改：4.0 已经没有 Fork，分发方式是五种。

**25｜建议｜kernel §5 步 8 —— 关闭时限**
- 证据：每个插件 10 秒、约 30 个插件串行，最坏情况远超 launchd 的 ExitTimeOut（系统定义，常见是 20 秒，之后发 SIGKILL）。一个消费方超时卡在 UNLOADING，它的提供方就会一直等（`_unload` 里的 dependents 循环）。"procs 杀进程树"写在全部 dispose 之后，而 procs 自己也是按逆序被 dispose 的插件。
- 改法：设一个全局截止（比如 45 秒），plist 里的 `ExitTimeOut` 不小于它，到点直接 `process.exit`。进程组清理放进 procs 自己的 dispose。退出码约定：0 表示正常，非 0 计入启动失败预算。

**26｜建议｜kernel §10、§11 —— 运行时异常查不到是哪个插件**
- 证据：只有 apply 期间的异常会落到某个插件的 FAILED；builtin 在定时器或回调里的未处理异常会直接带崩整个进程，日志里看不出是谁。
- 改法：在进入插件代码的每个入口（apply、effect、timer、监听、IPC 回调）用 AsyncLocalStorage 标上插件 id，全局异常处理记下 id 后再退出；同一个 builtin 连续导致崩溃 N 次，下次启动时按 #4 的槽位策略自动禁用（只限可降级的槽位）并通知主人。IPC 参数带 `_meta: { traceId, member }`，把日志串起来。

**27｜建议｜kernel §4.1–§4.2；contracts §3 —— profile 和 patch 的语义细节**
- `extends` 的合并没定义（子 profile 里出现父已有的 id 时怎么办，members 怎么合并）。→ 第一版不做 extends，或者规定成"父 profile 加一组隐式 patch"。
- `insert` 一个已存在的 id、`replace/disable` 一个不存在的 id，都应该报错。
- registry 和 chain 槽位需要有序绑定，但 schema 里 slots 的值只有 string、null、record 三种，写不出来。→ 加一种数组：`ability.embed: [local, siliconflow]`。
- `KernelContext.member?` 对全局实例没有意义，删掉，或者只在 `provideFactory` 的工厂里给。

**28｜建议｜kernel §5 步 7、§9；contracts §6 —— 写进经历流的 kernel 事件不合信封规则**
- 证据：`kernel.started` 不满足类型正则（缺 `.v1`），载荷在两处也不一样（一处有 `plugins[]`，一处没有）。信封要求每条事件都带 `source.audienceId`，而 journal 启动恢复、`kernel.*` 这类系统事件写入时 people 不一定在：journal 在自己的 apply 里做恢复，不能去调依赖它的 people。
- 改法：日志里的类型名用 `kernel.started.v1`、`plugin.circuit_open.v1`，并进 EVENT_TYPES；cordis 内部事件名和日志类型名分开取。保留受众 0 表示"仅主人或系统"，由迁移种下；系统流的事件可以用常量来源。

**29｜建议｜文档同步**
- engineering §2 的 manifest 行还是 `slots、contracts、config`，要改成 kernel 的 `provides、consumes、configSchema`；§3 的错误类别只有 7 个，contracts 有 10 个。§8、§11 第 6 项和决策 29 还写着"cordis 3.18 还是 4.0 待定"，kernel 已写"主人 2026-10-29 定 4.0 线"，三处要同步，并补一条决策。
- kernel 允许的依赖在 §4.2 里有 yaml、在 §4.6 里没有；zod（类型）和日志实现也要写进去。`SERVICE_KEYS` 缺 `formhost`；engineering §4.7 说宿主的服务键是 `slots`，可在 kernel 里 `slots` 是门面字段，不是服务键。
- contracts §4 把 ui 写成 single/list/keyed，kernel 的六种基数里没有 keyed；`single` 的例子用的是 `ui.area.now`，而 kernel §1 说界面槽位不归 kernel 管。→ 从 kernel 的基数表里去掉 ui，换个例子。Vitest 3.2 起 `vitest.workspace.ts` 已弃用，改用根配置的 `test.projects`（以实际锁定的版本为准）。

**30｜建议｜engineering §4.2、§4.6 —— 包和依赖规则**
- replay 只许依赖 `@liwa/core/testing`，可 L0、L1 要跑真实的身、念和装配，应改成可以依赖 app、kernel、core 的公开入口和 testkit。
- V2 的 form-wechat 写着依赖"IPC 客户端"，可没有这个包；让它 import `@liwa/kernel` 会把 cordis 和 loader 拖进子进程。→ 到时新建 `@liwa/plugin-sdk`，只依赖 contracts。
- `brain-shared` 是库不是插件，放在 `packages/plugins/` 下容易被 loader 扫到。→ 挪到 `packages/lib/`，或者要求它不带 `liwa` 字段。console 怎么把插件的 `client` 入口编进同一个包（比如构建期按 profile 生成一个虚拟模块），先在 §4 留一句，细节归 08。

## ③ 缺失项

上面已经展开的缺失项：门面与受限视图（#1 #7）、方法形状与回环测试（#2）、静态服务图（#5）、槽位必须有的策略（#4）、ready 与 drain（#8）、testkit 和走真实加载的测试内核（#11）、时钟、随机和编号（#12）、安全模式（#13）、密钥（#21）、组合根（#22）、调用上下文与取消（#15 #17）、worker 托管（#18）、资源上限（#15）。另外还缺：
- **插件私有派生数据**：D3 说引擎的私有派生数据放 derived.db 的引擎分区，kernel 没有对应的存储 API。第一版按 05 由 memory 的投影器写没有问题，但替换演练的第二引擎如果要存自己的东西就没地方放。→ 以后加 `ctx.storage.derived`（按插件分命名空间，经 journal 的异步投影写入，保持单写者）。
- **统一的健康接口**：各契约分别叫 `isAvailable`、`readiness`、`health`，步 7 的"健康检查一轮"不知道该调哪个。→ `definePlugin({ health? })`，进程外对应 `kernel/health`。
- **事件类型由谁定义**：EVENT_TYPES 是一张中央表。→ 写明第一版只有 contracts 能定义事件类型。
- **同一个引擎按成员用不同配置**（V3）：manifest 写死了 `impl`，同一个包没法以两个 impl 名各装一次。→ 允许 profile 条目用 `as:` 改 impl 名。
- **装配树哈希的输入**：要写明包括有序条目、包版本、config（密钥只取引用）、绑定和契约版本。L1 回放靠它判断是不是同一套装配。
- **主人对插件的操作**（熔断后恢复、禁用某个 builtin）：属于 gateway 的主人接口，kernel 要留内部 API（V2）。

## ④ 与整体架构或调研的冲突

1. **required 的范围**：overall §9.1、engineering §1.2 与 §2、决策 29 写的都是"九样 required"；kernel §2 写的是 core 和 kernel 里的全部插件（约 25 个服务键），engineering §4.7 也把 core 全标成了 required。→ 统一成"required 等于 core 全部；其中九样是三条硬规矩所在，写明它们不可替换的理由；其余是槽位宿主和编排"，同步改上面三处的措辞（主人确认，见 ⑥-1）。
2. **分层顺序**：overall §3.2 是编排在运行之上，context 在编排层；engineering §5 写的是"编排 ← 运行 ← 接入"（运行在编排之上），§4.7 又把 context 放进了运行层。两种排法都有向上调用：按 overall，minds 调 context 是向上；按 engineering，attention 起回合要调 minds，也是向上。→ 建议"context 归运行层、编排在运行之上"，这样 minds→context 是同层，attention→minds、outbox→actions 都是向下。两份文档都改，dependency-cruiser 只认一张表。
3. **overall §3.2 规则 4"账本层不依赖插件宿主"**：engineering §4.7 写的是账本"消费各自的引擎槽位"，05 的召回也要调 rank。→ 把规则 4 改写成"账本只经槽位注册表解析契约接口，不认识具体引擎；引擎不得 import 账本的实现"。
4. **宿主在哪一层**：overall 放在资源层和账本层之间，engineering 放在最底层，而 kernel 的 IPC 宿主运行时又要调 procs 和 journal。→ 包依赖上 kernel 在最底层；运行时把 IPC 宿主做成 `@liwa/kernel#ipc-host` 这个 required 插件（inject procs、journal），装在 procs 之后。kernel §2 提到了"kernel 里的插件"，但没列出是哪些，这里一并写明。
5. **大脑配置的所有权**：overall §2.3、§6.9 归 roster，kernel 却把它放在配置层（#3）。
6. **事件怎么演进**：contracts §6 写"新类型名用 v<n+1>，旧类型保留 schema 以便重放"，overall §12.8 第 3 条写"日志格式变化走备份→写新库→校验→切换，代码里不留按版本分支的兼容逻辑"。→ 建议按 overall：破坏性的载荷变化写一次性迁移，contracts 只保留当前 schema，旧 schema 只留在迁移脚本里（⑥-5）。
7. **钱在哪里换算**：contracts §5.1 的 `costUsd`、§5.6 的 `estimate().costUsd`，与 overall §9.4、§11.8 规定的"原始单位，钱只在 guard 里算"冲突（#16 #17）。
8. **时钟**：只有挂钟，缺 overall §3.1 要求的单调时钟和时区（#12）。
9. **D7**：第一版的 manifest 最小集（id、version、contract、slots、config），以及"第一版不做 IPC、不做依赖图"，对照 kernel V1.0 的全字段 manifest 和完整 IPC 宿主，后者明显更重（#14）。
10. **D6**："不是仓库里的代码默认进程外"，按理应由 loader 推导，kernel 却用插件自报的 kind（#6）。
11. **05 与 contracts**：05 里的 Date、同步方法和 worker，与 contracts §2 的约定冲突（#18）。
12. **m0 范围**：kernel §4.1 的 m0 profile 和 roadmap 1.7、engineering §10 定义的 m0 不一致（#4）；roadmap 自己对 2.1 也有两种估时（总清单 1 天，M1 表 3 天）。

## ⑤ 可以删掉或推迟的

- **IPC 宿主整套**（握手、心跳、背压与 `$/ack`、熔断、重启退避、stderr 收集、blob 引用）连同 T7：推迟到第一个真正的进程外插件（V1.1 嵌入退回 Python 服务时，或 V2 的 formhost）。V1 用回环编解码测试守住"能出进程"。formhost 本来就要做熔断，到时只做一次。
- **`single`、`chain` 两种基数**：V1 没有后端用户，ui 也不归 kernel 管。V1 只做 bound、member-single、list、registry。
- **`configSchema` JSON 文件和"zod 与 JSON Schema 一致"的 CI**：V1 在装载时用 zod 校验就够了（cordis 本来就做）；设置页需要表单时再用 `z.toJSONSchema` 生成。
- **`platforms`、`client` 段校验、manifest 里的 `notices` 字段**：只留一条 CI 检查——有 `src/paseo/` 就必须有 NOTICE 文件。`client` 等 08 定了前端插件怎么加载再说。
- **patch 的 `remove`**（`disable` 够用）、**`extends` 链**、**仓库内的 `<id>.patch.yml` 层**、**主人配置事件层**（改归 roster）：叠层从六层减到四层：profile → 本机 patch → owner 文件层（#3）→ 命令行。
- **`provideFactory` 和与 `isolate` 相关的一切**：V1 只有一个成员。
- **指标**：先只打日志，不建指标管道。**插件页数据**：dump-config 的 JSON 主控台直接读，不另做接口。
- **必须现在就有、不能砍**：门面与受限视图、静态服务图、槽位必须有的策略、ready 与 drain、方法形状规则与回环测试、走真实加载的测试内核、时钟随机编号的注入、zod 的严格 schema、安全模式、密钥引用。

## ⑥ 需要主人拍板的

1. **required 的范围**：确认"core 里的模块全部 required，只有槽位实现可以替换"（比"九样"大，但和 D1、engineering §4.7 一致）。如果希望编排层的某些逻辑以后也能换（比如显著性打分、摆桌子），现在就要给它们留槽位。
2. **主人换大脑写在哪里**：建议归 roster 的大脑配置（走配置事件、运行时生效，自动切备用也在这里），profile 只给部署默认。这意味着插件页只读，换大脑在设置面里做。
3. **IPC 宿主要不要推迟**到第一个真正的进程外插件。建议推迟，V1.0 的嵌入已经定了先在进程内。
4. **cordis 4.0 RC 怎么引入**：现方案是精确钉版本；另一个选项是把 4.0.0-rc.12 的源码（MIT，约 2 千行加 cosmokit）连同许可证搬进 kernel 自己维护（DSH 就是这么做的），免得 RC 期间 API 再变。不管选哪种，门面都不能泄露 cordis 的类型。
5. **事件载荷的破坏性变化**：按 overall §12.8 一次性迁移重写（建议），还是按 contracts §6 保留旧类型名和旧 schema。
6. **能不能接受 brain.provider 和 05 的 rank 声明为"只能进程内"的槽位**，从而暂不定义句柄式的远程调用。代价是：以后主人自己装的大脑适配器只能当一方代码跑在主进程里。
