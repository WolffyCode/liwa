# 核查 K：插件机制底座（kernel）

日期：2026-10-29。核查对象：`packages/kernel/src/`（提交 ccf2f47，未改动）、它用到的 `packages/contracts/src/{manifest,services.ts,slots,ledgers,errors.ts}`、`apps/liwa/src/`、`tools/dump-config.ts`、`profiles/m0-terminal.yml` 与根配置。核查基准：`docs/architecture/modules/00-plugin-kernel.md`（已确认）。cordis 运行时以 `node_modules/.pnpm/cordis@4.0.0-rc.12/node_modules/cordis/lib/index.js` 为准，源码对照 cordis 仓库的发布提交 01b3962。

标注：〔一手〕读了本仓库代码或规范原文；〔源〕读了 cordis 源码或打包产物；〔实测〕用临时测试跑出来（原文见 ⑧）；〔推理〕设计判断；〔二手〕转述评审报告。

## ① 一页结论

**底座完整吗？** 骨架齐了，可以在上面继续盖，但有两处"禁用不等于失效"类的硬伤，m0 接第一个真插件之前要修。〔一手〕五阶段、manifest 校验、四层 patch、静态服务图、四种基数、冻结门面、effect、时钟随机编号、密钥引用、`dump-config`、走同一段代码的测试内核都已实现，29 项测试覆盖了大部分配置类反例。kernel-0 范围里除已知推迟的四项外，还缺：给插件的 `Journal` 视图（插件现在能直接 `append`）、kernel 事件写进经历流、ESLint 的"登记回调必须包进 effect"规则、评审里采纳的"代际失效与 `AbortSignal`"。

**能不能在上面继续盖？** 能。问题几乎都落在 `slots.ts`、`context.ts`、`loader.ts` 三个文件里，属于局部修改，不用推倒。前提是：下面"最要紧的三件事"里第 1 件在 I1–I3（journal、procs、brain-claude）开工前修掉，第 2、3 件请主人在 1.7 设计波（D1–D4）里一并定下。

**最要紧的三件事**

1. **注册表有两个会真出事的缺陷（设计内修复，m0 前必须修）。** ① 一个 builtin 被禁用后，它已经登记或迟到登记的槽位实现仍留在注册表里，能被解析到，还会把必需槽位算成"已满足"，于是启动成功了，跑的却是被禁用插件的代码（K1，〔实测〕）。`ctx.on` 与 `ctx.clock.timer` 也不随插件释放（K4）。根因相同：kernel 没有"这个插件这一次挂载还活着"的代际，评审时采纳的"代际失效与 AbortSignal"没落进代码。② 提供方把冻结对象交给 `provide`（本仓库鼓励冻结）时，带代际的句柄一取方法就抛 `TypeError`，原因是 Proxy 的不变量（K2，〔实测〕）。
2. **机制层有四处形状要趁还没有真插件时定下（要改设计）。** 多实例 `as:` 现在根本装不上，插件也不知道自己的实例名（K10，〔实测〕），决策 33 的"ACP 用 `as:` 接更多 CLI"落不了地。一个插件对一个槽位只能声明一个 impl，可 `job-triggers` 要提供 cron、一次性、间隔三种触发，插件贡献的 `liwa` 命令和工具也都是"一包多个"。`manifest.provides.<slot>.meta` 在运行时读不到，也不按槽位的 `Meta` schema 校验。"进不进程"跟着目录走，而微信适配器、Python 嵌入服务这两个计划中的进程外插件都在仓库里。这几处都牵动 manifest schema，现在改几乎零成本，等插件写出来再改就是全体返工。
3. **启动与关闭的时序要补规则（要改设计，加设计内修复）。** 第 3、5 阶段和 `health` 没有时限，一个 builtin 的 `ready` 卡住，`startKernel` 就永远不返回（K7，〔实测〕）。`ready` 和 `drain` 的顺序没把槽位提供方算进去：启动时 gateway 先开门、大脑后就绪；关闭时大脑先排空、gateway 后停止接活（K9）。编号源每次启动都从 1 数起，跨重启会撞号（K11，〔实测〕）。关闭时"procs 在自己的 dispose 里杀进程组"这条做不到：只要有一个依赖它的插件卡在释放里，cordis 就永远不释放 procs，而 kernel 过了截止时间会直接跳过余下的插件（K6，〔实测〕）。

**"要改设计"的点**：K6、K7、K9、K10、K11、K12、K26，加上 ⑤ 里的"现在就得留口子"四条（多实现、meta、进程边界、实例身份）。理由逐条写在 ③ 和 ⑤。

## ② 设计对照表

状态：✅ 已实现　◐ 部分　✗ 缺失　≠ 与设计不符　⏸ 已知推迟

| 节 | 设计要求 | 代码位置 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| §3.1 | `manifestVersion`、`id` 正则、`kind` 只核对 | contracts `manifest/liwa.ts:46-56`；`manifest.ts:73-93` | ✅ | strictObject 校验，kind 与路径核对〔一手〕 |
| §3.1 | `provides` 槽位在 SLOT_DEFS、契约版本相等、impl 槽位内唯一 | `manifest.ts:82-85`；`loader.ts:161-170` | ✅ | 重复 impl 时点名先声明方 |
| §3.1 | `meta` 是槽位契约声明的静态描述 | `liwa.ts:21`（`z.unknown()`） | ◐ | 不按槽位 `Meta` 校验，运行时读不到（见 ⑤） |
| §3.1 | `consumes` 键 ∈ SERVICE_KEYS、版本相等；`inject ⊆ consumes` | `manifest.ts:86-89`；`loader.ts:285-286` | ✅ | 视图键不在 schema（交给 C） |
| §3.1 | `plugins[]` 一包多插件，`service` 只许 required，导入前建服务图 | `loader.ts:71,281`（`subEntry` 从未赋值） | ≠ | builtin 的 `plugins[]` 不支持；required 的服务图取自代码传入的 PluginDef（K26） |
| §3.1 | `multiInstance` + `as:` 装多份 | `loader.ts:159-160`；`profile.ts:80-88` | ≠ | 装不上（K10） |
| §3.1 | `exports` 必含 `./package.json` | `manifest.ts:81` | ✅ | |
| §3.2 | 具名导出 `plugin`，出现默认导出即拒绝 | `manifest.ts:96-104` | ✅ | |
| §3.2 | `definePlugin` 给 cordis `name: id`、带标记、核对 id | `plugin.ts:27-45`；`loader.ts:320,283` | ✅ | |
| §3.2 | Config 由 kernel `safeParse` 同步校验，错误进原因 | `loader.ts:298-313` | ✅ | 重新抛出时丢了 `cause`（K17） |
| §3.2 | 非 required 包出现 `defineService` 的产物即拒绝 | `loader.ts:284` | ✅ | |
| §4.1 | profile：required 条目只许 config、带 package 拒绝 | `profile.ts:79-90` | ✅ | |
| §4.1 | 大脑有效绑定不在 profile；`owner.yml` 文件层 | `profile.ts:54-55` | ◐ | `bind brain.provider` 不拒绝（K20） |
| §4.2 | 四层叠加，后层覆盖前层 | `profile.ts:109-123` | ✅ | |
| §4.2 | 本机及以上层只许 replace.config / disable / enable / bind | `profile.ts:136-139` | ✅ | |
| §4.2 | 指向不存在的 id 报错；同层重复 id 报错 | `profile.ts:113-118,147` | ◐ | "同层"按单个文件算，多个 `--patch` 之间不查 |
| §4.2 | bind 的 impl 在条目表、enabled、provides 含该槽位 | `loader.ts:198-205` | ◐ | 连已被覆盖的低层绑定也校验（K20） |
| §4.2 | 有序槽位绑定写成数组 | — | ✗ | 绑定形状与基数不在第 1 阶段核对（K20） |
| §4.3 | `dump-config` 只跑第 1 阶段，输出 AssemblyPlan | `loader.ts:595-597`；`tools/dump-config.ts` | ✅ | 对 required 来说仍要 import core（K26） |
| §4.3 | 装配树哈希：条目、版本与内容摘要、config 引用、绑定、契约版本 | `loader.ts:227,233-240` | ≠ | 摘要只算 package.json；还掺了层、状态、原因（K12） |
| §5.1 ① | 以组合根为解析根；按 realpath 推导种类 | `manifest.ts:107-121,49-59`；`loader.ts:118` | ◐ | 仓库根与 HOME 不做 realpath（K15）；按 CJS 条件解析 ESM 入口（K13） |
| §5.1 ① | 静态服务图：缺提供方、重复、成环当场点名，拓扑序 | `graph.ts:10-60`；`loader.ts:182-195` | ✅ | "重复提供"的字符串塞进了 `cycles`，不合 schema（不可达） |
| §5.1 ① | 阶段集合：必须在装的 required 与必需槽位 | `loader.ts:136-139,212-213` | ✅ | |
| §5.1 ② | 先启动 logger exporter，订阅 `internal/status` | `loader.ts:248-255` | ◐ | 订阅了；required 运行期离开 ACTIVE 不致命（K19） |
| §5.1 ② | required 按拓扑序挂载、全部 ACTIVE、20 秒超时列出缺项 | `loader.ts:263-274,358-363` | ✅ | 卡在 create 的插件显示"缺：未知"，措辞误导 |
| §5.1 ② | 就绪看 `fiber.state` 不用 await | `loader.ts:369-411` | ✅ | 〔源〕`await()` 只等 inertia，判断正确 |
| §5.1 ② | builtin 逐个挂、剩余时限内落定、失败只禁用自己 | `loader.ts:276-294` | ◐ | 禁用后它的登记还在（K1） |
| §5.1 ② | 禁用时最多等释放 5 秒，不宣称能杀 | `loader.ts:38,430` | ✅ | |
| §5.1 ③ | required 的 `recover` 按拓扑序 | `loader.ts:436-442` | ◐ | 没有时限（K7） |
| §5.1 ④ | 核对实际登记与 manifest；`requiredBy` 必需槽位 | `loader.ts:445-457` | ◐ | 第 5 阶段禁用后不复查（K8） |
| §5.1 ⑤ | 按拓扑序 `ready`；写 `kernel.started.v1` | `loader.ts:460-487` | ◐ | 无时限（K7）；顺序不含槽位边（K9） |
| §5.2 | 全局截止 45 秒；按逆序 drain；逐个 await dispose | `loader.ts:541-557` | ◐ | 过了截止就跳过余下插件，不再调用（K6） |
| §5.2 | 不依赖 cordis 的并发释放 | `context.ts:36-47` | ◐ | 插件之间串行了；同一插件内的 effect 仍并发（K5） |
| §5.3 | ALS 标插件 id、连续崩溃自动禁用、`boot.json`、安全页 | — | ⏸ | 已知推迟，评价见本表后的"四项已知推迟合不合理" |
| §6.1 | SlotDef：基数、作用域、transport、requiredBy | contracts `slots/defs.ts:24-51` | ✅ | `scope` 没有任何地方用到 |
| §6.1 | 第一版实现 bound / member-single / list / registry | `slots.ts:112-164` | ✅ | |
| §6.2 | resolve 解析不到抛 `unavailable` | `slots.ts:21,112-145` | ✅ | |
| §6.2 | 带代际的句柄，提供方失效后旧句柄失败 | `slots.ts:24-35` | ≠ | 冻结实例直接崩（K2）；禁用路径不失效（K1） |
| §6.2 | 同 impl 重复登记报错并点名两方 | `slots.ts:55-56` | ✅ | |
| §6.2 | HostSlots `define`；"三份门面" | `types.ts:57-68` | ≠ | 只有两份，没有 `define`（K26） |
| §6.2 | `provideFactory` 接口保留、不隔离 | `slots.ts:94-106,202-207` | ✅ | 卸载时不释放成员实例（K21） |
| §7 | 门面冻结、cordis 不出 kernel、无 emit | `context.ts:19-51` | ✅ | 冻结只到一层（K24） |
| §7 | `services` 按 inject 收窄 | `context.ts:20-27` | ✅ | 〔源〕`get(key,true)` 在提供方不 ACTIVE 时返回 undefined，类型没体现 |
| §7 | 槽位门面按种类：builtin 拿 Provider，required 拿 Host | `loader.ts:327` | ◐ | 运行时对了，类型是联合（K14） |
| §7.1 | 给插件的 Journal 只有 read / subscribe / putPayload | contracts `ledgers/index.ts:10-15` | ✗ | 插件能 `append`（K3，〔实测〕） |
| §8 | apply 只登记、ready 接活、drain 先停 | `plugin.ts`；`loader.ts` | ✅ | |
| §8 | 登记回调必须包进 effect（ESLint 覆盖 subscribe、registerProjection、on）；禁 process.on、fs.watch | `eslint.config.js` | ✗ | 规则都没有（G3）；`ctx.on` 本身也不随生命周期（K4） |
| §8 | Clock 挂钟 / 单调钟 / 定时器分开 | `clock.ts:4-21` | ✅ | |
| §8 | Rng fork 只由（种子, 标签）决定、可恢复；`ctx.rng = fork('plugin:'+id)` | `rng.ts:44-76`；`loader.ts:328` | ✅ | |
| §8 | `ctx.ids.next(prefix)` | `ids.ts:4-13` | ◐ | 跨重启撞号（K11） |
| §8 | ESLint 禁系统时钟与随机，定时器只许 kernel / procs | `eslint.config.js:12-54` | ✅ | 漏 `process.hrtime`、`randomBytes`、`setImmediate`（⑥） |
| §9 | `$secret` 在第 2 阶段才解析；dump、日志、哈希只见引用 | `secrets.ts:6-33`；`loader.ts:236,267,287` | ✅ | 未知方案原样放行（K23） |
| §9 | 引用解析不到：required 退出、builtin 禁用 | `loader.ts:267,287,291` | ✅ | |
| §11 | `definePlugin` / `defineService` / `startKernel` / `dumpConfig` / `createTestKernel` / StartOptions / KernelHandle | `index.ts`；`loader.ts:40-60,511-520` | ✅ | 另外多导出了不少第 1 阶段内部函数（⑥） |
| §11 | kernel 事件 `plugin/*`、`slot/bound`；对应事件写经历流，journal 就绪前缓冲 | `events.ts`；`loader.ts:348,422,432,473-486` | ◐ | 只写了 `kernel.started.v1`；`slot/bound`、`circuit-open` 从不发（K16） |
| §12 | 测试内核与 startKernel 走同一段代码 | `testing.ts:63-90` | ✅ | 但文件系统那条路（解析器、读 profile）没有任何测试经过（见 ④ 的测试质量） |
| §12 | 回环编解码 | — | ⏸ | 已知推迟 |
| §13 | testkit 独立包 | `testing.ts` | ⏸ | 已知推迟 |
| §14 | FiberState 写死数值并用测试守住 | `loader.ts:35` | ◐ | 没有这条测试；运行时其实导出了 FiberState（K25，〔实测〕） |

**四项已知推迟合不合理**〔推理〕

- 回环编解码测试：推迟**部分合理**，有返工风险。contracts 已经有 `brain.provider`、`memory.engine`、`job.trigger`、`ability.embed` 的 `Methods` 描述，编解码层是通用的，现在就能用假实现测。如果等 I3 写完再加，brain-claude 很可能按进程内对象语义写（返回类实例、AsyncIterable、Date），回头要改。建议在 I3 之前给 `createTestKernel` 加一个开关，让 `resolve` 出来的句柄经过"JSON 往返加 schema 校验"。
- 安全模式页与 `boot.json`：推迟合理，kernel 不用返工。只需要 kernel 把启动失败的结构化信息带出来：现在 `startKernel` 在第 2 阶段以后失败时只抛一个把原因拼接起来的 `LiwaError`，不附带计划和出错的插件 id（`loader.ts:498-501`）。I7 做安全页时，在错误的 `data` 里补 `{ plan, plugin }` 即可。
- ALS 标插件 id、连续崩溃禁用：kernel 这一侧推迟合理，`context.ts` 一处就能把 apply、ready、effect、timer、on 包起来。但"服务回调插件代码"这一侧（`journal.subscribe` 的 cb、投影的 apply）发生在服务自己的异步上下文里，ALS 传不过去，得靠每个 core 服务用 `AsyncResource.bind` 包好回调。这是 core 全体都要守的规矩，等 core 写完再补就要逐个服务返工。建议现在就写进 `engineering.md` §9：凡登记回调的服务方法，登记时都用 `AsyncResource.bind` 包住回调。
- `@liwa/testkit` 独立包：推迟合理，搬家是机械活。

## ③ 缺陷清单

分类：**设计内修复** = 代码没做到已确认的设计，可以直接修；**要改设计** = 设计本身没规定或规定有问题，需主人定。

| 编号 | 严重度 | 分类 | 一句话 |
| --- | --- | --- | --- |
| K1 | 高 | 设计内修复 | 被禁用的 builtin 已登记或迟到登记的槽位实现仍留在注册表、能被解析，还能满足必需槽位 |
| K2 | 高 | 设计内修复 | 槽位实例是冻结对象时，句柄一取方法就抛 TypeError |
| K3 | 中 | 设计内修复 | 插件 inject journal 后能直接 `append` 任意事件 |
| K4 | 中 | 设计内修复 | `ctx.on`、`ctx.clock.timer` 不随插件生命周期释放 |
| K5 | 中 | 设计内修复 | 同一插件内多个 effect 的异步释放并发进行 |
| K6 | 中 | 要改设计 | 关闭时 procs 杀进程组会被卡住的依赖方挡住，过截止后余下插件被直接跳过 |
| K7 | 中 | 要改设计 | recover、ready、health 没有时限，一个 builtin 的 ready 卡住，启动就永不返回 |
| K8 | 中 | 设计内修复 | ready 阶段禁用 builtin 后不复查必需槽位 |
| K9 | 中 | 要改设计 | ready / drain 顺序不含槽位边：gateway 先于大脑开门，大脑先于 gateway 排空 |
| K10 | 中 | 要改设计 | 多实例 `as:` 装不上，插件也不知道自己的实例名与 impl 名 |
| K11 | 中 | 要改设计 | 编号源跨重启从 1 重数，会话号会撞 |
| K12 | 中 | 要改设计 | 装配哈希对不相干的差异敏感，对代码变化却看不见 |
| K13 | 中 | 设计内修复 | 生产解析器用 `require.resolve`（CJS 条件）找 ESM 入口 |
| K14 | 中 | 设计内修复 | `KernelContext.slots` 是联合类型，required 要用 resolve 必须强转 |
| K15 | 低 | 设计内修复 | 仓库根与 LIWA_HOME 不做 realpath，经符号链接给路径时 builtin 被拒 |
| K16 | 低 | 设计内修复 | 插件禁用、失败不写经历流；`plugin/loaded` 在 apply 之前就发 |
| K17 | 低 | 设计内修复 | 异常栈在日志里全部丢失，重新抛出时不带 cause |
| K18 | 低 | 设计内修复 | 启动失败后的关闭会对没 apply 过的插件调 drain，传进去的 ctx 是 undefined |
| K19 | 低 | 设计内修复 | required 运行期 FAILED 或离开 ACTIVE 不致命；PENDING 重跑 apply 时随机序列从头开始 |
| K20 | 低 | 设计内修复 | 绑定校验连被覆盖的低层也查；绑定形状与基数不核对 |
| K21 | 低 | 设计内修复 | 注册表的释放函数不幂等，会误删同 impl 的新实现；工厂实例卸载时不释放 |
| K22 | 低 | 设计内修复 | 成员 id 叫 `default` 时与全体默认作用域相撞 |
| K23 | 低 | 设计内修复 | 空的 patch 文件让整体失败；未知方案的 `$secret` 原样放行；profile 名直接拼进路径 |
| K24 | 低 | 设计内修复 | 冻结只冻一层：类实例服务的公有字段一改就抛错 |
| K25 | 低 | 设计内修复 | §14 说"FiberState 用测试守住"，实际没有这条测试 |
| K26 | 低 | 要改设计（文档） | 设计文字与代码、与上游 rc.12 有几处对不上 |

### K1 高 · 设计内修复 · 禁用不等于失效

- 位置：`loader.ts:413-433`（disable）、`slots.ts:196-201`（先 `this.provide` 再 `registerEffect`）、`loader.ts:324-326`。
- 现象〔实测 K-late-a〕：builtin 的 apply 卡住超过启动时限，被禁用。之后 apply 继续执行并调用 `ctx.slots.provide`，注册表先登记成功，然后 `raw.effect` 因为 fiber 已失活抛出 `cannot create effect on inactive context`。登记留在注册表里，却没有任何释放函数。required 用 `resolve('brain.provider', { impl: 'late' })` 能拿到被禁用插件的实例。
- 现象〔实测 K-late-b〕：唯一的大脑在 apply 里先 provide 再卡住，被禁用。可是它的释放要等 cordis 的 `_unload`，而 `_unload` 要等卡住的 apply 结束〔源 `Fiber.dispose` 里的 `while (this.inertia) await this.inertia`〕，所以登记一直有效，第 4 阶段把 `brain.provider` 判为满足，启动成功。计划里写着这个插件 disabled，槽位的提供方却还是它。
- 依据：设计 §6.2"提供方失效后旧句柄一律失败"、§12 反例"超时后迟到的登记被拒"；handoff 处理表的"代际失效与 AbortSignal"标的是采纳〔一手〕。
- 修法：kernel 给每次挂载一个存活代际。`disable()` 第一步同步调用 `registry.revoke(pluginId)`，把该插件的全部实现标为失效并移除，不等 cordis。`providerFacade.provide` 改成在 `raw.effect(() => registry.provide(...))` 里登记，让 cordis 的 `assertActive` 和登记成为一个原子动作。给 `apply` 与 `ready` 传 `AbortSignal`，禁用时 abort。

### K2 高 · 设计内修复 · 冻结实例的句柄崩溃

- 位置：`slots.ts:24-35`。
- 现象〔实测 K-frozen〕：`provide('job.trigger', 'cron', Object.freeze({ next }))` 之后，`resolve(...).next` 抛 `TypeError`。Proxy 的 get 返回了 `value.bind(target)`，而目标属性是不可写、不可配置的数据属性，违反 Proxy 不变量。
- 影响：本仓库处处冻结对象（服务、门面），插件作者照着写 `ctx.slots.provide(..., Object.freeze(client))` 的可能性很高，第一次调用就会崩。
- 修法：Proxy 的目标不要用实例本身，改用一个空壳，比如 `Object.create(null)`，get 时从实例取值并绑定；或者生成一个显式转发方法的包装对象。

### K3 中 · 设计内修复 · 插件能直接追加经历流

- 位置：contracts `ledgers/index.ts:10-15`（`Journal` 含 `append`）、`context.ts:20-27`（原样给出服务实例）。
- 现象〔实测 K-append〕：builtin 声明 `consumes: { journal: 1 }`、`inject: ['journal']`，在 ready 里成功 `append` 了一条 `memory.accepted.v1`。
- 依据：设计 §7.1"给插件的 Journal 接口只有 read、subscribe、putPayload"，§12 纪律类反例"类型与运行时都拒绝"〔一手〕；决策 32 保留了"写只经所有者"。
- 修法：contracts 分出 `PluginServices`（journal 是去掉 append 的视图）和 `RequiredServices`。kernel 的 `createFacade` 给 builtin 时套上视图。`definePlugin` 的 `services` 类型用 `PluginServices`。这条与 C 方向共同改。

### K4 中 · 设计内修复 · 回调与定时器不随生命周期

- 位置：`context.ts:48`（`on` 直接挂到 emitter）、`context.ts:29`（各插件共用同一个 `clock`，`timer` 不登记）。
- 现象〔实测 K-on〕：插件在 apply 里 `ctx.on('kernel/started', …)`，第 4 阶段被禁用，第 5 阶段的 `kernel/started` 仍然送到它。同理，`ctx.clock.timer` 设的真定时器在插件禁用或关闭之后照样触发，还会让进程迟迟不退出〔推理，与 on 同构〕。§12 T6 要求"关闭后无残留定时器"，现在保证不了。
- 修法：改在根上，不靠 lint。`on` 实现成 `raw.effect(() => emitter.on(...))`；给每个插件造一个包装过的 clock，`timer` 登记成 effect。

### K5 中 · 设计内修复 · 插件内的 effect 并发释放

- 位置：`context.ts:36-47`。依据〔源〕：rc.12 的 `Fiber._unload` 用 `Promise.all(this._disposables.clear().map(...))`，源码注释也这么写；按逆序启动，并发执行。
- 现象〔实测 K-order〕：同一插件先登记"关库"、后登记"冲刷订阅"（异步），关闭时顺序是 `B:flush-start → A:close-db → B:flush-end`：订阅还没冲刷完，库已经关了。
- 依据：§5.2"不能依赖 cordis 的并发释放"、§12 反例"异步清理顺序"、terra 评审第 8 条建议"kernel 自己维护一个顺序等待的释放栈，作为一个 Cordis effect 注册"，处理表标为采纳〔二手〕。代码只把插件之间做成了串行。
- 修法：门面自己维护后进先出的释放栈，只向 cordis 登记一个 effect，在里面逐个 await。

### K6 中 · 要改设计 · 关闭时进程组清理不可靠

- 位置：`loader.ts:560-565`（`remaining <= 0` 时既不调用也不等待），`loader.ts:549-551`。依据〔源〕：`_unload` 先 `while (provisions.some(impl => impl.dependents.size)) await ...`，提供方要等全部依赖方卸载完才释放自己的 effect。
- 现象〔实测 K-shutdown〕：一个 inject procs 的 builtin 的某个释放函数永不返回。截止时间到了以后，procs 被记一笔"已超过全局截止，跳过"，它的 effect（杀进程组）根本没执行。就算 kernel 去调用 procs 的 dispose，cordis 也会让它一直等那个卡住的依赖方。
- 为什么要改设计：§5.2 的"procs 在自己的 dispose 里杀进程组"建立在 cordis 释放顺序之上，而 cordis 的语义正好让卡住的消费方挡住提供方。opus 评审第 129 行提的就是这个问题，处理表采纳的改法（"放进 procs 自己的 dispose"）没有解决它〔二手〕。后果：用 `detached` 起的 CLI 进程组在父进程退出后还活着，只能等下次启动时第 3 阶段去清孤儿。
- 建议：① 给 required 加一个同步的 `finalize`，在截止之后、`process.exit` 之前一定执行，不经 cordis，procs 在里面 `killAll`；② drain 只用截止时间的一部分（例如 70%），给 dispose 留出余量；③ 过了截止时间仍然调用 dispose，只是不等它。

### K7 中 · 要改设计 · 第 3、5 阶段与 health 没有时限

- 位置：`loader.ts:436-442`（recover）、`loader.ts:460-471`（ready）、`loader.ts:523-533`（health）。
- 现象〔实测 K-ready-hang〕：builtin 的 ready 返回一个永不 resolve 的 Promise，假时钟推进 120 秒，`createTestKernel` 仍未结束。health 卡住同理会让 `liwa status` 卡住〔推理〕。
- 为什么要改设计：§5.1 只给第 2 阶段定了 `startupTimeout`，第 3、5 阶段只写了"抛错时怎么办"。这和"builtin 失败只禁用自己"的精神相矛盾。
- 建议：ready 与 recover 共用启动时限的剩余额度（或各自单独定时限），builtin 超时按禁用处理，required 超时则启动失败；health 每个插件限时（例如 2 秒），超时记为 `{ ok: false, reason: 'timeout' }`。

### K8 中 · 设计内修复 · ready 阶段的禁用不复查必需槽位

- 位置：`loader.ts:469`，之后没有复查。
- 现象〔实测 K-ready-slot〕：唯一的大脑在 ready 里抛错，被禁用，启动照样成功，最终计划里 `brain.provider` 的 `satisfied: false`。
- 依据：§0"builtin 失败只禁用，除非它填的槽位被某个在装的服务声明为必需"〔一手〕。
- 修法：第 5 阶段每禁用一个插件，就重新跑一遍 `registry.plan(present)`；有不满足的必需槽位就启动失败。

### K9 中 · 要改设计 · ready / drain 顺序不含槽位边

- 位置：`loader.ts:461`（先 ready 全部 required，再 ready builtin）、`loader.ts:544`（按挂载逆序：先排空 builtin，再排空 required）。
- 现象〔一手 + 推理〕：槽位提供方（builtin）不在静态服务图里，所以 gateway 的 ready（开始接客户端）先于 brain-claude 的 ready 执行，`liwa chat` 有可能在大脑就绪之前打进来。关闭时，brain-claude 先排空，gateway 后停止接活，中间这段时间进来的新回合会落到正在排空的大脑上。
- 为什么要改设计：§5.1 写的是"按拓扑序调用 ready"，但设计里的拓扑只有服务边。要定一条规则。
- 建议：服务图加上"槽位提供方 → `requiredBy` 服务"这种边，ready 按图的顺序；或者把"开门"（gateway 接客、scheduler 装作业）挪到 `kernel/started` 之后单独的一步，关闭时第一步就把门关上。

### K10 中 · 要改设计 · 多实例装不上

- 位置：`profile.ts:80-88`（同 id 重复即拒绝）、`loader.ts:159,283`（profile 里的 id 必须等于 manifest id）、`slots.ts:190-194`（只能以 `as` 名登记），`types.ts:73-83`（KernelContext 没有实例信息）。
- 现象〔实测 K-multi〕：① 两条 `{ id: 'brain-acp', as: … }` 被判"出现了两次"；② 换成 `brain-gemini`、`brain-opencode` 两个 id，又被判"与 manifest 的 brain-acp 不一致"；③ 只装一份、`as: gemini` 时，插件照常 `provide('brain.provider', 'acp')`，结果被拒绝："声明的实现 id 是 gemini，登记的却是 acp"。插件没有途径知道自己的实例名。
- 为什么要改设计：设计没有定"实例 id 与包 id 的关系"，也没有说插件怎么拿到自己的 impl 名。决策 33 依赖这一条。
- 建议：profile 条目加 `plugin:`（包里的插件 id）与 `id`（实例 id，全局唯一）两个字段，没写 `plugin:` 时两者相同。KernelContext 加 `instanceId` 与 `impls: Record<slot, impl>`。`provide(slot, instance)` 不再让插件传 impl，由 kernel 按 manifest 和 `as` 填。日志、rng、ids 一律按实例 id 区分。

### K11 中 · 要改设计 · 编号跨重启不唯一

- 位置：`ids.ts:4-12`、`loader.ts:114`（缺省 `createIds()`，计数从 0 开始）。
- 现象〔实测 K-ids〕：两次启动都发出 `session_000001`。另外，`ctx.ids` 是所有插件共用的一个源（不像 rng 那样按插件 fork），加装一个插件就会改变别的插件拿到的号〔一手〕。
- 为什么要改设计：§8 只写了"编号由 kernel 发，录放按它匹配"。可计数要靠 journal 才能恢复，journal 要到第 2 阶段才打开，这是个先有鸡还是先有蛋的问题，得在设计层面定。
- 建议：编号带启动序号，形如 `<prefix>_<boot>_<n>`，`boot` 由组合根从 `run/boot.json` 递增后传入（I7 本来就要写这个文件），录放时把 boot 固定下来。另外按插件分命名空间，或者明确"ids 只给 required 用"。

### K12 中 · 要改设计 · 装配哈希的定义

- 位置：`loader.ts:227`（`digest` 只是 package.json 的 sha256）、`loader.ts:233-240`（哈希输入含每个条目的 `layer`、`status`、`reason`，以及含被覆盖层在内的全部 `bindings`）。
- 现象〔实测 K-hash〕：有效 config 相同、只是来自不同层，哈希不同。入口代码完全换掉，哈希不变。required 由代码传入，没有版本和摘要，core 改了也不影响哈希。禁用原因里可能带绝对路径（例如 K15 的"包不在已知位置：/private/…"），于是同一份装配换台机器哈希就变〔一手〕。
- 为什么要改设计：§2 只写了"各包版本与内容摘要"，没有定义算的是有效装配还是叠层过程，"内容"又指什么。L1 回放靠这个哈希判断"是不是同一套装配"，两个方向的误判都会出问题。
- 建议：哈希只算有效装配（每个启用条目的包名、版本、构建标识、有效 config 引用，生效的绑定，契约与服务版本）。构建标识由组合根传入（git 提交号或 dist 摘要）。层、原因、状态只进计划，不进哈希。

### K13 中 · 设计内修复 · 按 CJS 条件解析 ESM 入口

- 位置：`manifest.ts:122-125`（`load` 用 `createRequire(root).resolve(name)`）。
- 现象〔实测 K-esm〕：一个包的 exports 写 `{ ".": { "import": "./index.js" } }`，`locate` 能找到它，`load` 却抛 `No "exports" main defined`；同一个文件直接 `import()` 是可以的。这也是 §14 待实测项"pnpm 下以组合根为解析根的动态 import()"的实测结果：本仓库插件模板写的是 `default` 条件，碰巧能用。
- 修法：由组合根注入一个装载函数 `(specifier) => import(specifier)`。它写在 `apps/liwa` 的模块里，ESM 解析天然以组合根为起点、用 import 条件。kernel 只保留 `locate` 读 manifest。

### K14 中 · 设计内修复 · 槽位门面的类型

- 位置：`types.ts:80`（`slots: ProviderSlots | HostSlots`）。
- 现象〔实测 K-type：在 `defineService` 的 create 里写 `ctx.slots.resolve(...)` 并加 `// @ts-expect-error`，`tsc --noEmit` 通过，说明那里确实是类型错误〕：brains、memory、self、scheduler 这些 required 消费槽位时，每一处都得写 `as HostSlots`，与"不用 any、类型收窄"相悖。
- 修法：KernelContext 增加一个槽位门面的类型参数；`definePlugin` 给出 `ProviderSlots`，`defineService` 给出 `HostSlots`。

### K15–K26（低）

- **K15** `loader.ts:118`、`manifest.ts:49-58`：`repoRoot`、`home` 不做 realpath，`realDir` 却是 realpath。〔实测 K-symlink〕组合根经 `/tmp/…`（macOS 上 /tmp 链到 /private/tmp）给路径时，真实位于 `packages/plugins/` 的包被判"不在已知位置"；传真实路径则正常。`import.meta.url` 一般已经是真实路径，所以生产环境多半碰不到；但 `repoRoot` 与 `LIWA_HOME` 都可以从外部传入（LIWA_HOME 放在 Aether 上，很可能经符号链接访问）。修法：两者都先 `realpathSync`。
- **K16** `loader.ts:473-486` 只写了 `kernel.started.v1`；`plugin.disabled.v1`、`plugin.failed.v1`、`slot.bound.v1` 都没写，也没有"journal 就绪前先缓冲"（§11）。`plugin/loaded` 在 `root.plugin()` 之后立刻发出（`loader.ts:348`），这时 apply 还没执行，〔实测 K-loaded〕apply 抛错的插件也收到了 loaded。`slot/bound`、`plugin/circuit-open` 只有类型（`types.ts:43-44`），从来没发过。
- **K17** `logger.ts:46-47` 用 `args.map(String)` 把 cordis 传来的 Error 转成字符串，栈就没了。`loader.ts:290、304-306` 重新抛出时不带 `cause`（违反 `engineering.md` §9"重新抛出带 cause 的错误"）。`disable` 的日志只记 reason 字符串。结果是 T12"异常能定位到插件"只能定位到 id，看不到栈。
- **K18** `loader.ts:318` 的 facade 初值是 `undefined`，只有 apply 执行了才会赋值。`loader.ts:545-548` 关闭时对所有挂载过的插件都调 drain。〔实测 K-drain-ctx〕启动失败后，一直在等 guard 的 minds 收到的 drain ctx 是 undefined。从没 ready 过的插件也会被 drain。修法：只 drain 已 ready 的插件。
- **K19** `loader.ts:249-255` 的状态监听只在 FAILED 时发 `plugin/failed`，required 在运行期离开 ACTIVE 不致命，与 §5.1 末段不符。现在不可达，因为 required 运行期不会消失，但热重载、IPC 宿主出来以后就可达了。PENDING 重跑 apply 时，`loader.ts:328` 重新 fork 出的 rng 从头开始，回放会跟着偏〔源 `_unload` 末尾 epoch 变了就 `_reload`〕。
- **K20** `loader.ts:198-205` 对全部层的绑定都做 enabled 校验。〔实测 K-bind〕profile 绑 `ability.embed: [local]`，owner 层禁用 local、改绑 `[cloud]`，计划仍然报致命错误，可这正是 §4.1 说的"主人在设置面换引擎"。绑定形状不按基数核对（member-single 给了数组、registry 给了字符串），要到运行期 resolve 时才报 unavailable。`bind brain.provider` 也不拒绝，而 §4.1 规定大脑的有效绑定不在 profile。
- **K21** `slots.ts:72-76` 的释放函数按 impl 执行 `map.delete`，没有判断身份。〔实测 K-dispose〕旧的释放函数再调一次，就把同 impl 新登记的实现删了。`perMember.clear()` 只是清掉 Map，不释放工厂造出来的成员实例。
- **K22** `slots.ts:86-92`、`profile.ts:100-107,141` 用字面量 `'default'` 当全体默认的作用域，而 `MemberId` 允许取 `default`。〔实测 K-default-scope〕`members.default` 会静默覆盖 `memberDefaults`。
- **K23** 〔实测 K-empty-patch〕空的 `owner.yml`（YAML 解析成 null）会让整个装配失败，主人接口写出一个空文件就起不来了。〔实测 K-secret-scheme〕`{ $secret: 'vault:…' }` 这种未知方案不报错，原样当作 config 交给插件。`profile.ts:49` 把 `--profile` 直接拼进路径，`../` 可以越界；也不核对 `profile.id` 与文件名是否一致。
- **K24** `loader.ts:331` 只冻结一层。〔实测 K-freeze-class〕如果 required 服务是带公有可变字段的类实例，方法一改字段就抛 TypeError；原型也没冻结，可以被改。修法：把"服务对外暴露的是闭包对象或私有字段（#x）的类"写进 `engineering.md` §9 与 `defineService` 的注释。
- **K25** §14 写着"FiberState 是 const enum、跨包拿不到运行时值，kernel 按源码写死数值并用测试守住"。〔实测 K-fiberstate〕`await import('cordis')` 拿得到运行时的 `FiberState`，数值与 `loader.ts:35` 一致，但测试目录里没有守住它的测试（`grep FIBER\|FiberState __tests__` 无结果）。修法：补一条比对测试，升级 cordis 时它会第一个报警。
- **K26（要改设计，文档）**
  - §0 和 §15 以〔源〕的身份引用 rc.12 的 `registry.replace`，可 rc.12 只有 `registry.delete`；`replace` 是 main 上 2026-10-28 的 74b7905 才加的（见 ③ 末尾的"对 cordis 行为的核对"）。
  - §3.1 和 §5.1 说"用 `plugins[].service` 在导入前建静态服务图"，代码用的是组合根传入的 PluginDef（`loader.ts:136,146-147`），`plugins[]` 与 `subEntry`（`loader.ts:71,281`）在 loader 里是死字段。
  - §6.2 标题写"三份门面"，实际只列了两份，HostSlots 里写的 `define` 代码里没有。
  - "dump-config 不导入业务代码"对 required 不成立：`apps/liwa` 的 `REQUIRED` 要 import core 的模块。
  - 这几处要么改文字以代码为准，要么由主人决定 `plugins[]` 还要不要。

### 对 cordis 行为的核对〔源〕

| kernel 的假设 | rc.12 实际 | 结论 |
| --- | --- | --- |
| FiberState 六态数值 | `lib/index.js` FiberState：0 PENDING … 5 UNLOADING，且在 export 列表里 | 数值对；"跨包拿不到"不准确（K25） |
| `await()` 只等 inertia，PENDING 立即返回 | `Fiber.await`：`while (this.inertia) await`，然后看 `_error` | 对，kernel 改看 `fiber.state` 是正确的 |
| apply 抛错走 FAILED | `_reload` catch 设 `_error`，epoch 置 INACTIVE，接着走 `_unload`（UNLOADING），最后 `_getState` 得到 FAILED；先登记的 effect 会被释放 | 对 |
| 依赖消失回 PENDING，回来重跑 apply | `_unload` 末尾 epoch 不是 INACTIVE 就 `_reload` | 对；kernel 的 apply 可重入，但 rng 从头开始（K19） |
| 提供方等依赖方先释放；同一 fiber 的释放并发 | `_unload` 先等 `dependents` 清空，再 `Promise.all`（源码注释原文："effects of this fiber are only disposed after every dependent has unloaded"） | 对；kernel 只处理了插件之间（K5），也没想到它会挡住 procs（K6） |
| effect 在失活后不能再建 | `effect()` 的 `assertActive` 只看 `uid !== null`；`dispose` 一开始就同步执行 `uid = null` | 这正是 K1 迟到登记的成因 |
| `ctx.get(name, true)` | `_getImpl` 在 strict 模式下，提供方不 ACTIVE 时返回 undefined | `ctx.services.x` 可能是 undefined，类型没表达出来（低） |
| 重复 provide 报错带 fiber 名 | `reflect.provide`：`service "x" has been registered at <name>` | 对 |
| Config 只认同步 validate | `resolveConfig` 遇到 then 就抛 | 对；kernel 绕过了 cordis 的 Config |
| 默认 exporter 只缓冲 1000 条 | `LoggerService` 构造函数里登记了 buffer exporter；级别缺省为 INFO，cordis 的 debug 不会导出 | 对；kernel 已接上 exporter，但丢了栈（K17） |
| `emit` 同步、不隔离异常 | `EventsService.emit` 直接 `Reflect.apply` | 对；kernel 的 `internal/status` 监听里没有会抛错的代码 |
| `registry.replace` 能换掉任意插件 | **rc.12 没有 `replace`**（01b3962 的 `registry.ts` 只有 `delete`，安装的 lib 也一样）；main 的 74b7905 才加上，同一提交还删掉了 `delete`，改成内部的 `_unregister` | 设计依据写错（K26）。对 kernel 的影响：现在为零，kernel 两个都不调，cordis ctx 也不出 kernel。将来升到带 replace 的版本，`_replace` 会清掉 `_error`、`_revision++`、对已有 fiber 重跑 apply，并发 `internal/replace`；kernel 的 apply 可重入，槽位句柄也会随 effect 释放而失效，所以只需要把 `internal/replace` 当作"代际 +1"记日志，并重跑 T1–T12 |
| bd427d0：异步生成器 effect 在 epoch 变化时不关闭迭代器（rc.12 的 bug） | rc.12 的 `_execute` 在 asyncIterator 分支 epoch 一变就直接 return，不调 `iter.return()`，生成器的 finally 不执行 | kernel 踩不到：kernel 自己的 effect 都是同步函数返回释放函数（`context.ts:37-43`、`loader.ts:325,334`、logger exporter、`root.on`）；包装后的插件 apply 是 async 函数，走的是 Promise 分支；`KernelContext.effect` 的类型只接受 `() => cleanup \| void`，插件传不进生成器。以后如果对外开放生成器式 effect，至少要升到含 bd427d0 的版本 |

## ④ 缺口（设计有、代码无，且不是已知推迟）

与 ③ 重复的只列编号：K3（插件的 Journal 视图）、K16（kernel 事件写进经历流）、K19（required 运行期致命）。另外几项：

- **G1 `AbortSignal` 与代际失效**：handoff 的处理表标为采纳（"代际失效与 AbortSignal"），kernel 里 `grep AbortSignal` 没有结果〔一手〕。contracts §2.1 的 `CallContext` 也写着"进程内另带 AbortSignal"，kernel 没有提供任何取消管道。这是 K1 的根。
- **G2 ESLint 的生命周期规则**：§8 的"登记回调必须包进 ctx.effect（ESLint 覆盖 subscribe、registerProjection、on）""禁止裸的 process.on、fs.watch"在 `eslint.config.js` 里一条也没有〔一手〕。建议 `on`、`timer` 按 K4 改在根上；`subscribe`、`registerProjection`、`process.on`、`fs.watch` 用 `no-restricted-syntax` 加上。
- **G3 manifest `meta` 的校验与读取**：§2.2 规则 2 规定静态描述放进 meta，不做运行时 `describe()`。可 kernel 既不按槽位的 `Meta` schema 校验（contracts 已经有 `brainProvider.Meta`、`abilityEmbed.Meta`、`jobTrigger.Meta`），注册表也不保存 meta（`slots.ts:5-14`），`EntryPlan.provides` 里也没有。结果是 brains 拿不到 `personaInjection`，abilities 拿不到 `local`、`dims`〔一手〕。这一条和 C 一起做。
- **G4 data 插件"只校验 schema"**（§2）：kind 为 data 的包只被标了种类，`data.file` 从没读过、校验过（`loader.ts:157`、`checkManifest`）。V2 才会用到，标为低。
- **G5 `dump-config` 快照**：§12 T7"快照稳定"，`tools/ci.sh:3` 写着"对应功能落地后再接进来"。现有测试只验证同一输入哈希相同；所谓"脱敏"测试从头到尾没解析过密钥，所以必然通过（`loader.test.ts:215-216`），检验不了任何东西。
- **G6 `KERNEL_API_VERSION`**：contracts §12 规定 kernel 在第 1 阶段检查它，kernel 没有引用（manifest 也没有对应字段）。external 第一版不装，标为低。

**测试质量（§12 T1–T12）**〔一手〕

| T | 覆盖 | 评价 |
| --- | --- | --- |
| T1 manifest 坏值 | 种类不符、契约版本、consumes 版本、exports、冒充 required | 缺 schema 拼错字段、id 正则、`multiInstance` |
| T2 契约 / 视图版本 | 契约有 | 视图不适用 |
| T3 patch 动 required、本机层 insert | 有，纯函数层面 | 够用 |
| T4 四种基数 | 冲突、隐式默认、回退链、bound 要 impl | 缺 list 多个、registry 带 key、工厂、绑定形状 |
| T5 服务图 / 超时 | 缺项、成环（纯函数）、required 超时（走 loader） | 成环没走 loader |
| T6 drain 顺序、释放、无残留、45 秒 | 只有 drain 逆序与一个 cleanup | 插件内的顺序、定时器残留、子进程、截止都没测，而且实际都有缺陷（K4、K5、K6） |
| T7 快照、脱敏、哈希输入 | 同输入同哈希 | 弱（G5、K12） |
| T8 两个假插件进 m0 并 ready | 用内存 profile 与内存解析器 | 真实的 `profiles/m0-terminal.yml`、`fileSystemResolver`、`readProfileSource` 从没被 `startKernel` 走到过，K13、K15 正好出在这条没测的路上 |
| T9 回环编解码 | — | 已知推迟 |
| T10 测试内核与真实 loader 一致 | 靠"同一段代码"保证 | 解析器与 profile 来源这两处不同，没有对照测试 |
| T11 假时钟驱动超时 | 启动超时有 | 退避属于 kernel-1 |
| T12 定位到插件 id、连续崩溃 | 只断言日志里有 boom | 没断言插件 id、没有栈；崩溃计数推迟 |

§12 的反例里，**一条也没测到的**：插件直接追加经历流、依赖消失与恢复、异步清理顺序、超时后迟到登记被拒、超时但副作用已发生、损坏配置下的恢复入口。前三项与"迟到登记"恰恰都有缺陷（K3、K5、K1）。总体看，配置类反例测得扎实，运行类反例基本空白；正路之外，文件系统那条路一次都没跑过。

## ⑤ 扩展性推演

逐种插件走一遍〔一手读代码 + 推理〕：

| 插件种类 | 现有机制够不够 | 缺什么 |
| --- | --- | --- |
| `brain.provider`（claude、codex、acp，ACP 用 `as:`） | bound 槽位、`resolve({impl})`、procs 经 inject，这些都够 | 多实例装不上（K10）；brains 读不到 meta（G3）；冻结的 client 会崩（K2） |
| `memory.engine` / `growth.engine` / `social.model`（按成员单选） | member-single、成员绑定、`provideFactory` 按成员缓存，这些都够 | 成员删除时没有释放工厂实例的协议（K21）；required 的 create 在 builtin 挂载之前执行，那时去 resolve 会拿到 unavailable，但这条约束没写下来，kernel 也不拦。建议 HostSlots 在第 4 阶段完成前调 resolve 时抛出说清楚的错误 |
| `ability.*`（registry 回退链） | 有序绑定、`resolveAll` 都够 | 选实现要看 meta（local、dims），而 meta 读不到（G3） |
| `form.adapter`（微信，进程外，kernel-1 的 IPC） | 契约形状已定，IPC 宿主推迟 | **种类跟着目录走**：`packages/plugins/form-wechat` 会被推导成 builtin、进程内（`manifest.ts:54`），可它在 engineering §4.2 里是进程外的；Python 嵌入服务同理。manifest 的 `consumes` 也不收视图键（交给 C） |
| `job.trigger` | list 槽位、requiredBy scheduler 都够 | **一个插件对一个槽位只能有一个 impl**（`liwa.ts:16-23`，`provides.<slot>` 是单个对象），而 `job.trigger` 的 `Meta.type` 是单个值。`job-triggers` 包要提供 cron、一次性、间隔三种，现在表达不了 |
| 界面插件（`ui.*`，归 08） | 不在 kernel 的注册表里 | manifest 的 `client` 入口和计划里的界面贡献清单，以后作为可选字段补上即可 |
| 插件贡献的 `liwa` 命令（M 在设计） | — | 底座需要提供的东西见 ⑦ 的"交给 M" |
| 热重载（以后） | 带代际的句柄、effect 从第一天写、apply 可重入 | 需要 kernel 侧的存活代际（K1）、on 与 timer 随生命周期（K4）、`internal/replace` 的处理（cordis 核对表），这几项现在修了，热重载就不用返工 |

**机制层现在就得留口子，否则以后返工**（要改设计）：

1. **实例身份**（K10）：profile 条目区分实例 id 与插件 id，KernelContext 提供 `instanceId` 与 impl 名。理由：rng、日志、ids、绑定都以 id 为键，等插件写完再拆，所有插件的 `provide` 调用和测试都得跟着改。
2. **一个插件对一个槽位多个实现**：`provides.<slot>` 改成数组 `[{ impl, contract, meta }]`（或者加一个 `impls` 字段）。理由：job-triggers、插件命令、`toolport.tool` 都需要。现在一个真插件都还没有，改 schema 零成本；以后改就是全体 manifest 的破坏性变更。
3. **meta 运行时可读，并按槽位校验**（G3）：contracts 给出 `SLOT_META: Record<SlotName, ZodType>`，kernel 第 1 阶段校验，`HostSlots.describe(slot, impl)` 返回 meta，计划里也带上。理由：§2.2 规则 2 已经把"不做 describe()"定死了，读不到 meta 等于这条规则没法用。
4. **进程边界与目录解耦**：manifest 恢复一个 `runtime: 'in-process' | 'ipc'` 字段，种类（required / builtin / external）只表示代码在哪里，`runtime` 表示进不进程。理由：kernel-1 的第一个用户（Python 嵌入或微信）就在仓库里，按现在的推导规则根本落不了位。

**以后再加也不伤**：`single` / `chain` 的实现（定义已经保留）；`provideFactory` 的隔离；IPC 宿主运行时（契约形状已定）；data 包的 schema 校验；界面插件的 `client` 字段（可选字段，向前兼容）；熔断与 ALS（前提是 ② 那条"服务回调用 `AsyncResource.bind`"现在写进规范）；`ctx.storage.derived`；热重载本身（前提是修好 K1、K4）。

## ⑥ 规范违规

对照 `~/.claude/CLAUDE.md` 与 `engineering.md` §9〔一手〕：

| 条 | 位置 | 说明 |
| --- | --- | --- |
| §9 文件 ≤400 行 / 单一职责 | `loader.ts` 605 行；`Kernel.prepare` 在 `loader.ts:123-242`，一个函数做了 required 校验、条目解析、服务图、绑定、槽位计划、条目计划、哈希 | 建议拆出"条目解析""装配哈希"两个概念函数 |
| 函数只做一件事 | `loader.ts:460-487` 的 `ready()` 同时写 `kernel.started.v1` | 写事件应当拆成单独一步 |
| 禁止嵌套三元 | `loader.ts:157`、`loader.ts:200`、`profile.ts:145` | 都是全局原则里的反例形状 |
| 禁止魔法值 / §9 数值进 params | `loader.ts:259` `20_000`、`loader.ts:542` `45_000`、`testing.ts:78` `5_000`、`rng.ts:58` `12`、`loader.ts:113` `'liwa:'`；作用域 `'default'` 出现在 `slots.ts:91`、`profile.ts:101,141` | 只有 `DISABLE_DISPOSE_MS` 起了名 |
| 复制不超过两次 | "在装的服务"集合在 `loader.ts:136、258、453、502` 用四种不同写法各算一遍 | 应当提炼成一个概念 |
| 变量名自解释 | `loader.ts:146,151` `p`、`187` `m`、`198` `b`、`213` `s`；`manifest.ts:75` `m`；`profile.ts:75` `required_` | |
| 不吞异常 / 带 cause 重新抛出 | `loader.ts:290、304-306` 重新抛出时不带 cause；`logger.ts:46` 丢栈；`loader.ts:172-174` 把 Error 压成字符串 | 见 K17 |
| 只抛 LiwaError（engineering §7） | `testing.ts:42,49` 抛的是 `new Error` | 测试辅助代码放在生产入口里导出 |
| 可见性最小 | `index.ts:10-13` 把第 1 阶段的内部函数（`checkManifest`、`deriveKind`、`readPackageManifest`、`pickPluginExport`、`buildServiceGraph`、`resolveProfile`、`SlotRegistry`）都当公开 API 导出，§11 里没有这些；`types.ts:107` 的 `mount` 注释写着"插件代码不调"，却是公开字段 | |
| 唯一归属 | `loader.ts:605` 的 `export { SLOT_DEFS }` 是死导出（SLOT_DEFS 归 contracts）；contracts 里 `SlotNameSchema` / `ServiceKeySchema` 各重复定义了三次（交给 C） | |
| 公开 API 参数用对象 / 参数表 ≥4 | `types.ts:64` `bind(scope, slot, binding, layer)`；`slots.ts:51` `provide(plugin, slot, impl, instance?, factory?)` | |
| §8 lint 覆盖 | `eslint.config.js` 没禁 `process.hrtime`、`process.uptime`（可以绕开注入的单调钟）、`randomBytes` / `randomInt`（可以绕开注入的随机）、`setImmediate`、`process.on`、`fs.watch` | `randomBytes` 要给 gateway 的令牌留一个豁免 |

## ⑦ 交给别的方向

**C（contracts）**
- `ledgers/index.ts:10-15`：分出插件视图类型，`PluginServices.journal` 不含 append（K3）。
- `manifest/liwa.ts:16-23`：`provides.<slot>` 要支持多个 impl；`meta` 要按槽位关联 `Meta` schema（⑤ 第 2、3 条）。
- `manifest/liwa.ts:27`：`Consumes` 只收 ServiceKey，00-contracts §3 写的是 `ViewKey | ServiceKey`。
- 恢复 `runtime` 字段（⑤ 第 4 条）。
- `assembly.ts:31`：`cycles` 是 PluginId 数组，可 kernel 往里塞"重复提供 …"字符串（`graph.ts:58`）；`SlotPlan.cardinality` 用的是 `z.string()`；`kernelStarted` 的 `stage` 用的是 `z.string()`。
- `SlotNameSchema` / `ServiceKeySchema` 在 `assembly.ts:9-10`、`liwa.ts:12-13`、`profile.ts:7` 重复定义，而 `services.ts:33` 已经导出了 `ServiceKey`。
- `MemberId` 允许 `default`（K22）；`Profile.id` 没有正则（K23）；`SecretRef` 遇到未知方案应当报错，不该放行（K23）。

**L（分层）**
- dependency-cruiser 的 `plugins-workspace-deps` 只限制工作区内的依赖，插件可以在自己的 package.json 里声明 `cordis` 并直接 import，"cordis 不出 kernel"在这个方向上没有机器检查。建议加一条 `plugins-no-cordis`。
- kernel 的生产入口导出了测试内核（`index.ts:4`），testkit 拆出去时一并处理。
- ⑥ 里的 lint 缺项。

**M（命令）**：插件往 `liwa` 里加命令，底座需要提供：
- ① 一个命令槽位（例如 `cli.command`，registry 基数，key 是命令名），并且允许一个插件提供多个 key（⑤ 第 2 条）。
- ② 命令的静态描述（名字、参数的 JSON Schema、帮助、是否需要主人令牌）写在 manifest meta 里，经 `AssemblyPlan` 和 `HostSlots.describe` 可读（⑤ 第 3 条）。这样 `liwa` 作为 gateway 的客户端，不加载任何插件也能列出命令、补全参数。
- ③ gateway 经 `HostSlots.resolve` 拿到处理函数，用 `CallContext` 加 `OwnerToken` 调用，用 `AbortSignal` 取消（G1）。
- ④ `LiwaError` 的类别要映射到退出码 0 / 1 / 2 / 3。
- ⑤ 分清两类命令：一类只要静态计划（类似 `dump-config`，本体不运行也能执行），一类要本体在线。

## ⑧ 跑过的命令与输出原文

环境：`node --version` 输出 `v24.18.0`。

1. 建了三个临时测试：`packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts`（16 条）、`verify-tmp-k-units.test.ts`（7 条）、`verify-tmp-k-resolve.test.ts`（1 条）。每条断言的都是"缺陷存在"，所以通过就等于复现成功。符号链接与 ESM 的测试在本会话的 scratchpad 里建临时目录，用完即删。

2. `pnpm vitest run --project @liwa/kernel --reporter=verbose packages/kernel/src/__tests__/verify-tmp-k`（当时只有前两个文件）：

```
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-units.test.ts > K 核查：单元 > K-frozen：提供方给的是冻结对象时，带代际的句柄一取方法就抛 TypeError（Proxy 不变量） 1ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-units.test.ts > K 核查：单元 > K-dispose：旧的释放函数再调一次，会把同 impl 新登记的实现删掉 0ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-units.test.ts > K 核查：单元 > K-default-scope：成员 id 恰好叫 default 时，它的绑定静默覆盖全体默认 2ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-units.test.ts > K 核查：单元 > K-empty-patch：空的 owner.yml（解析为 null）让整个装配失败 1ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-units.test.ts > K 核查：单元 > K-secret-scheme：未知方案的密钥引用不报错，原样当普通 config 交给插件 1ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-units.test.ts > K 核查：单元 > K-symlink：组合根经符号链接路径给出时，仓库根不做 realpath，真实的 builtin 被判"不在已知位置" 24ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-units.test.ts > K 核查：单元 > K-fiberstate：cordis 的 FiberState 运行时其实导出了，可以用测试把 kernel 写死的数值守住（现在没有这条测试） 1ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-late-a：启动超时被禁用的 builtin，迟到的 provide 仍然进了注册表、能被解析到 17ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-late-b：先 provide 再卡住的唯一大脑被禁用，但它的实现仍算数，必需槽位被判为满足、启动成功 4ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-multi：multiInstance + as: 实际装不上（同 id 重复、换 id 与 manifest 不一致、插件不知道自己的 impl 名） 6ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-append：builtin inject journal 后可以直接 append 任意事件类型（类型与运行时都没拦） 5ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-on：ctx.on 不随插件生命周期释放：插件在第 4 阶段被禁用后，第 5 阶段的 kernel/started 照样送到它 4ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-order：同一插件的两个 effect 异步释放是并发的，后登记的没释放完，先登记的已经开始释放 5ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-shutdown：一个卡住释放的 builtin 让 procs 的释放（杀进程组）根本不执行 3ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-ready-hang：builtin 的 ready 永不返回，startKernel 永远不结束（启动时限不管第 5 阶段） 3ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-ready-slot：唯一大脑在 ready 抛错被禁用后不复查必需槽位，brains 在装却没有 brain.provider 也照样启动 3ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-drain-ctx：启动失败后的关闭会对从未 apply 的 required 调 drain，ctx 是 undefined 3ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-loaded：plugin/loaded 在 apply 之前就发了，apply 抛错的插件也收到 loaded 4ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-freeze-class：required 服务若是带公有可变字段的类实例，被冻结后方法一调就抛 TypeError 4ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-bind：低层绑定指向被高层禁用的实现，即使高层已改绑，计划仍报致命 2ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-hash：有效装配相同、只是 config 来自不同层，哈希就变；入口代码换了哈希不变 4ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-ids：编号源每次启动都从 1 开始，两次启动发出同一个会话号 6ms
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-loader.test.ts > K 核查：loader > K-type：defineService 的 ctx.slots 是联合类型，required 要 resolve 槽位必须强转（由 tsc 验证 @ts-expect-error） 0ms
 Test Files  2 passed (2)
      Tests  23 passed (23)
```

3. `pnpm exec tsc --noEmit -p packages/kernel/tsconfig.json`（包含临时测试）：无输出，`tsc exit=0`。K-type 里的 `@ts-expect-error` 没有被报"未使用"，证明那一行确实是类型错误。

4. `pnpm vitest run --project @liwa/kernel --reporter=verbose packages/kernel/src/__tests__/verify-tmp-k-resolve`：

```
 ✓ |@liwa/kernel| packages/kernel/src/__tests__/verify-tmp-k-resolve.test.ts > K 核查：解析 > K-esm：exports 只写 import 条件的插件包，locate 能找到、load 却按 require 条件解析失败 9ms
      Tests  1 passed (1)
```

5. 带全部临时测试跑一遍 `pnpm vitest run --project @liwa/kernel`：

```
 Test Files  9 passed (9)
      Tests  53 passed (53)
```

6. 删除我建的三个临时文件之后，再跑 `pnpm vitest run --project @liwa/kernel`：

```
 Test Files  6 passed (6)
      Tests  29 passed (29)
```

7. cordis 源码核对（只读，没有 checkout）：`git -C …/cordis log --oneline 01b3962..HEAD -- packages/core` 列出 74b7905、bd427d0；`git show bd427d0 -- packages/core/src`、`git show 74b7905 -- packages/core/src`；`git grep -n 'replace\|delete(plugin' 01b3962 -- packages/core/src/registry.ts` 只命中 `162: delete(plugin: Plugin)`；`git show 01b3962:packages/core/src/fiber.ts` 的 `_unload` 原文见 cordis 核对表。

临时文件清理确认：`packages/kernel/src/__tests__/` 下只剩原来的 6 个测试文件；scratchpad 里的 `k-symlink-*`、`k-esm-*` 目录已经在各自测试的 finally 里删掉。工作区里其余以 `verify-tmp-` 开头的文件（其中包括 `packages/kernel/src/verify-tmp-k.ts`）不是我建的，没有碰。
