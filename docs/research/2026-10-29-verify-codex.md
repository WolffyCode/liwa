# 插件机制底座与协议规范的代码复核（方向 X，Codex）

更新：2026-10-29。复核者：Codex CLI 0.163.0，模型 gpt-6-astra，推理强度 max，只读沙箱。范围：`packages/kernel`、`packages/contracts`、`apps/liwa`、`tools/dump-config.ts`，对照 `00-plugin-kernel.md`、`00-contracts.md`、`engineering.md` §1–§5、§9。下文为复核原文（文件链接已改为仓库内相对路径）。

**① 一页结论**

本次复核的结论是：**代码骨架清楚，常规装配路径已有测试，但生命周期失效、槽位可用性、写入纪律和可回放性仍存在实质缺陷，不宜仅凭当前 CI 全绿判定 kernel-0 已完成验收。**

我通读了指定范围的 **47 个 TypeScript 文件**，包括 **8 个测试文件中的 47 条测试**，并核对了已确认设计及本地安装的 `cordis 4.0.0-rc.12` 源码。报告列出 **27 项问题：高 8 项、中 17 项、低 2 项**。其中多数通过不落盘的 Node 最小脚本复现，其余由明确的代码路径与设计要求确认；尚未建立实物用例的风险单独标为“待实测”。

最要紧的三个问题：

1. **插件“被禁用”不等于其能力已失效。** 卡住的 `apply` 可以留下仍可解析的槽位；恢复执行后，迟到登记甚至会在报错之后永久残留。唯一必需提供方在 `ready` 失败时，内核也可能返回启动成功。见 **X1、X2**。
2. **关闭截止耗尽后，代码跳过后续 `dispose()`。** 实测中 `shutdown()` 已返回，effect 清理没有运行，定时器仍然触发。见 **X3**。
3. **对 cordis fiber 对象身份的假设错误，状态监管实际失效。** `root.plugin()` 返回包装对象，`internal/status` 发出原始 fiber；二者作为 Map 键不相等。实测移除 required 服务后，内核仍报告相关插件健康。见 **X4**。

此外，**builtin 可直接追加 journal、密钥明文可进入日志及装配计划、装配哈希不能识别实现代码变化**，也应在接入真实业务前处理，见 **X5–X7**。

已经做对的部分包括：基础 `KernelContext` 确实冻结；effect 返回值没有直接泄露 cordis 的符号元数据；常规服务实例在发布前冻结；源码中的 fiber 状态数值与锁定版本一致；实际 pnpm workspace 包路径能够解析到仓库中的真实包目录。这些正向结论不消除下面列出的具体缺陷。

验证限制：尝试关闭缓存后重跑 Vitest，仍因只读沙箱禁止创建临时目录而在测试执行前失败，因此本次**没有重新验证整套 CI**。下述实测来自 Node 24.18.0 下禁用 tsx 缓存的内存脚本，以及一次不落盘的 TypeScript 编译检查。本人未修改任何文件，也未引用其他方向 agent 的复核报告。

**② 缺陷表**

表中链接指向主要位置；详述补充其他关联位置及设计节号。

| 编号 | 严重度 | 主要位置 | 问题 | 分类 |
|---|---|---|---|---|
| X1 | 高 | [slots.ts:196](packages/kernel/src/slots.ts:196)、[loader.ts:425](packages/kernel/src/loader.ts:425) | 禁用未立即撤销槽位，迟到登记失败后留下活动实现 | 设计内修复 |
| X2 | 高 | [loader.ts:465](packages/kernel/src/loader.ts:465) | 必需槽位提供方在 ready 失败后仍启动成功 | 设计内修复 |
| X3 | 高 | [loader.ts:560](packages/kernel/src/loader.ts:560) | 关闭截止耗尽后跳过 dispose，资源仍存活 | 设计内修复 |
| X4 | 高 | [loader.ts:249](packages/kernel/src/loader.ts:249)、[loader.ts:345](packages/kernel/src/loader.ts:345) | fiber 包装对象与状态事件对象不一致；required 致命状态规则也未执行 | 设计内修复 |
| X5 | 高 | [context.ts:24](packages/kernel/src/context.ts:24)、[ledgers/index.ts:10](packages/contracts/src/ledgers/index.ts:10) | builtin 得到完整 Journal，可直接 append | 设计内修复 |
| X6 | 高 | [logger.ts:43](packages/kernel/src/logger.ts:43)、[loader.ts:469](packages/kernel/src/loader.ts:469) | 已解析密钥可进入日志和 plan.reason | 设计内修复 |
| X7 | 高 | [loader.ts:225](packages/kernel/src/loader.ts:225) | 装配哈希漏掉实现内容、required 内容和最终禁用状态 | 设计内修复 |
| X8 | 中 | [loader.ts:267](packages/kernel/src/loader.ts:267)、[loader.ts:281](packages/kernel/src/loader.ts:281) | 启动超时不能终止密钥解析和模块装载等待 | 设计内修复 |
| X9 | 中 | [slots.ts:24](packages/kernel/src/slots.ts:24) | 代际检查只发生在取属性时，已取得的方法仍可调用 | 设计内修复 |
| X10 | 中 | [slots.ts:26](packages/kernel/src/slots.ts:26) | 槽位代理可改写共享实现；冻结实现的方法反而无法调用 | 设计内修复 |
| X11 | 中 | [slots.ts:72](packages/kernel/src/slots.ts:72) | 旧释放函数重复调用会删除新提供方 | 设计内修复 |
| X12 | 高 | [slots.ts:177](packages/kernel/src/slots.ts:177) | 必需槽位只检查提供方数量，不检查有效绑定能否解析 | 设计内修复 |
| X13 | 中 | [loader.ts:198](packages/kernel/src/loader.ts:198) | 被高层覆盖的旧绑定仍参与致命校验 | 设计内修复 |
| X14 | 中 | [profile.ts:79](packages/kernel/src/profile.ts:79)、[profile.ts:113](packages/kernel/src/profile.ts:113) | required 重复条目、跨文件同层重复操作和重复绑定未拒绝 | 设计内修复 |
| X15 | 中 | [graph.ts:26](packages/kernel/src/graph.ts:26) | 自依赖被删除，静态服务图漏报自环 | 设计内修复 |
| X16 | 中 | [loader.ts:159](packages/kernel/src/loader.ts:159)、[profile.ts:88](packages/kernel/src/profile.ts:88) | as 与插件身份、登记接口不自洽，多实例无法表达 | 要改设计 |
| X17 | 中 | [loader.ts:156](packages/kernel/src/loader.ts:156) | manifest.plugins[] 被接受但未参与装配 | 设计内修复 |
| X18 | 中 | [manifest/liwa.ts:16](packages/contracts/src/manifest/liwa.ts:16)、[types.ts:57](packages/kernel/src/types.ts:57) | 槽位 Meta 和实现接口没有接入装配校验 | 设计内修复 |
| X19 | 中 | [brain.provider.ts:80](packages/contracts/src/slots/brain.provider.ts:80)、[protocol/ipc.ts:14](packages/contracts/src/protocol/ipc.ts:14) | 已有 JsonValue，但多处线协议仍接受非 JSON 值 | 设计内修复 |
| X20 | 中 | [brain.provider.ts:89](packages/contracts/src/slots/brain.provider.ts:89)、[common.ts:63](packages/contracts/src/common.ts:63) | 方法描述与手写接口分离，缺句柄流描述和进程内取消上下文 | 设计内修复 |
| X21 | 中 | [protocol/ipc.ts:16](packages/contracts/src/protocol/ipc.ts:16) | IPC 联合接受互斥字段混合，并把非法请求降成通知 | 设计内修复 |
| X22 | 中 | [events/envelope.ts:31](packages/contracts/src/events/envelope.ts:31) | EventEnvelope 增加未确认的必填 version，且允许与 type 冲突 | 设计内修复 |
| X23 | 中 | [loader.ts:472](packages/kernel/src/loader.ts:472)、[slots.ts:225](packages/kernel/src/slots.ts:225) | 生命周期事件未完整落 journal，启动记录失败仍报成功 | 设计内修复 |
| X24 | 中 | [loader.ts:305](packages/kernel/src/loader.ts:305)、[loader.ts:381](packages/kernel/src/loader.ts:381) | 重抛丢失 cause，日志丢失栈，recover 可漏出非 LiwaError | 设计内修复 |
| X25 | 中 | [events.ts:20](packages/kernel/src/events.ts:20) | async 监听器拒绝未捕获，成为 unhandledRejection | 设计内修复 |
| X26 | 低 | [manifest.ts:97](packages/kernel/src/manifest.ts:97) | export default undefined 绕过默认导出禁令 | 设计内修复 |
| X27 | 低 | [loader.ts:259](packages/kernel/src/loader.ts:259)、[brain.provider.ts:91](packages/contracts/src/slots/brain.provider.ts:91) | 运行参数散落在实现中，未遵守 params.ts 硬规则 | 设计内修复 |

**③ 每个缺陷的详述**

以下“kernel 设计”指 `docs/architecture/modules/00-plugin-kernel.md`，“contracts 设计”指 `docs/architecture/modules/00-contracts.md`。

**X1｜禁用没有形成即时、不可逆的能力失效边界——已实测**

现象有两种：

- 插件先登记槽位，再卡住 `apply`。启动超时后 `disable()` 删除 `mounted` 条目，最多等 dispose 五秒，但已有槽位仍活动；它甚至可以继续满足必需槽位检查。
- 插件先卡住，禁用后才恢复并调用 `provide()`。`providerFacade` 先修改注册表，再调用 `registerEffect(dispose)`；此时 cordis 拒绝在失效上下文创建 effect，**但刚插入的槽位没有回滚**。

实测第一种情况下，被禁用插件仍出现在 `brain.provider.providers`，`satisfied: true`；第二种情况下出现 `cannot create effect on inactive context`，随后仍能解析迟到实现并调用其方法。

依据：kernel 设计 §5.1、§6.2、§12 要求失效句柄不可用、超时后迟到登记被拒。cordis `lib/index.js:434–436` 只在创建 effect 时检查活动状态，`371–383` 的 dispose 不能打断在途 apply；不能指望它替 kernel 撤销已经完成的外部注册表修改。

最小复现：让 `apply` 等待一个可手动释放的 Promise，用假时钟推进启动超时及五秒禁用等待，再释放 Promise 调用 `ctx.slots.provide()`。

修法：在原生命周期模型中加入实例代际及失效状态；**禁用入口先同步撤销该实例全部槽位，再等待清理**。槽位登记必须在任何修改前检查生命周期，并保证 effect 登记与注册表修改原子化，失败立即撤销本次登记。

**X2｜ready 失败后丢失必需槽位，仍返回启动成功——已实测**

`slotReadiness()` 在 `ready()` 之前执行。builtin 的 ready 抛错后，`ready()` 禁用它，却不重新检查必需槽位，随后照常发出 `kernel/started`、写启动事件并返回 handle。

实测：只安装 `brains` 和唯一的 `brain.provider`；提供方 apply 登记成功、ready 抛错。结果 `startKernel()` 成功返回，但最终计划中 `brain.provider.providers: []`、`satisfied: false`。

依据：kernel 设计 §0、§5.1、§6.1 的“宁可不起”和必需槽位要求。builtin 失败可降级的前提不能覆盖必需能力。

最小复现：唯一大脑插件的 `ready()` 抛出错误。

修法：把必需槽位可用性作为开放业务前的最终不变量；任何禁用导致该不变量破坏都走启动失败及关闭路径。成功事件只能在最终校验通过之后产生。

**X3｜关闭截止耗尽后直接跳过释放——已实测**

`bounded()` 在 `remaining <= 0` 时直接返回，连 `run()` 都不调用。一个 drain 用完全局预算后，后续所有 dispose 因此被跳过；之后 `mounted`、`services` 被清空，使表面状态像是已经关闭。

实测：required 服务通过 effect 登记一个定时器，drain 永不完成，关闭期限设为十毫秒。推进时钟后 `shutdown()` 返回；结果是：

```text
cleanup: 0
runAfter: 1
health: {}
```

依据：kernel 设计 §5.2、§12 T6 要求截止控制等待，并清理已登记资源。当前行为把“不再等待”实现成了“不发起释放”。

最小复现：一个永不完成的 drain，加一个应由 effect 清除的定时器。

修法：区分“发起失效/释放”和“等待释放”。截止后仍应同步关闭登记入口、撤销槽位并发起尚未开始的 dispose；异步部分不再等待，同时向组合根报告超时关闭结果，由组合根执行最终退出。不要清空账面状态后把残留资源视作已释放。

**X4｜cordis 状态监听用了错误对象身份，且缺少 required 致命处理——已实测**

本地 cordis `lib/index.js:1500–1505`：

```js
const fiber = new Fiber(...);
const wrapped = Object.create(fiber);
wrapped.then = ...;
return wrapped;
```

而 `547–551` 的 `internal/status` 发出的是原始 `this`。kernel 在 `fiberIds` 中存包装对象，却用事件中的原始对象查找，因此 `if (!id) return` 恒定挡掉这些状态变化。

实测结果：

```text
事件 fiber === root.plugin 返回值：false
事件 fiber === 返回值的原型：true
fiber 状态变化日志条数：0
```

通过测试侧捕获 fiber 并移除 required `guard` 后，`guard` 已 DISPOSED，依赖它的 `minds` 已失去服务，但 `health()` 仍返回两者 `{ ok: true }`。

此外，即使修正身份，当前监听器也只是对 FAILED 发事件，**没有实现 required 进入 FAILED 或离开 ACTIVE 即致命**的规则。

依据：kernel 设计 §5.1 末段及 §8。此问题也意味着不能把现有代码当成已正确处理 PENDING 后重跑 apply；重新 apply 后，recover、ready 等生命周期并没有同步重走。

最小复现：记录返回 fiber 和 `internal/status` 参数的对象身份，再使 required fiber 失活。

修法：统一保存 cordis 的原始 fiber 身份；在同一状态处理入口区分启动、正常运行和主动关闭，运行中 required 失活立即进入致命关闭流程。health 也应结合实际 fiber 状态，不能只看插件自报钩子。

**X5｜builtin 能直接追加经历流，类型和运行时均未拒绝——已实测、已类型检查**

`Services.journal` 就是包含 `append()` 的完整 `Journal`。`createFacade()` 对 builtin 和 required 都直接返回原始服务对象，没有按插件种类裁剪。

不使用 `any` 或类型断言，下面行为能够通过当前 TypeScript 配置：

```ts
definePlugin({
  id: 'audit-x',
  inject: ['journal'],
  apply(ctx) {
    void ctx.services.journal.append(/* 合法 AppendRequest */);
  },
});
```

运行测试中，该调用确实进入了注入的 journal。

依据：kernel 设计 §7 第 1 条明确要求“给插件的 Journal 接口只有 read、subscribe、putPayload”，§12 还要求类型和运行时都拒绝插件直接追加。冻结对象只禁止属性改写，不会禁止调用已有方法。

修法：在服务类型及门面构造源头区分内部 Journal 与插件 Journal；builtin 获得只含允许方法的冻结接口，required 和 kernel 才持有追加接口。不能仅靠注释或 lint 禁止调用一个实际公开的方法。

**X6｜密钥脱敏只覆盖配置树，未覆盖真实输出路径——已实测**

解析密钥后的 config 直接进入插件；插件 logger 是原始 child logger。异常消息经 `String(error)` 或 `.message` 写入日志和 `entry.reason`，cordis exporter 同样把参数直接字符串化。

用合成密钥测试，插件抛出包含该值的错误后：

```text
JSON.stringify(kernel.plan) 包含密钥：true
JSON.stringify(logger.entries) 包含密钥：true
```

即使插件不主动记录配置，SDK 报错、Config 自定义错误消息也可能带回密钥。

依据：kernel 设计 §9、engineering §7 要求日志、装配计划只出现密钥引用。`redactSecrets()` 处理的还是解析前配置，无法保护上述路径。

最小复现：SecretResolver 返回合成字符串，插件 apply 或 ready 抛 `new Error(config.token)`。

修法：在密钥解析与输出边界建立统一脱敏机制，覆盖结构化字段、错误消息、cause 链的输出及计划原因；保留内部诊断对象，但日志和计划使用脱敏后的表示。不要只按 `token` 等字段名猜测，也不要只清洗 dump-config。

**X7｜装配哈希不能证明“同一套装配”——已实测及代码确认**

存在三处确定缺口：

- `digest = sha256(p.located.raw)` 只摘要 `package.json`，不包含插件入口及其实现内容。
- required 是代码传入，没有版本和内容摘要；替换 required 实现不影响哈希。
- 哈希在 prepare 阶段生成；启动期禁用插件后只更新 entries 和 slots，不重算哈希。

实测保持 manifest 不变、替换 builtin 实现，哈希相同；替换 required 的 create 实现，哈希相同；一个实例正常启动、另一个 apply 失败被禁用，最终哈希仍相同。Config 默认值或转换逻辑的代码变化也未被当前输入覆盖。

依据：kernel 设计 §2“装配树与哈希”、§4.3、§12 T7；contracts 设计 §12 要求包版本及内容摘要用于装配记录和回放判断。

修法：从实际构建产物及其依赖输入生成确定性内容摘要，覆盖 required、kernel、插件及相关共用实现；明确区分静态计划与实际装配记录，并对最终启用集合生成对应哈希。各组件摘要应由源头提供，不能把 package.json 摘要继续称作实现内容摘要。

**X8｜startupTimeout 无法约束挂起的密钥解析和 import——已实测**

计时从 register 开始，但定时器只在 `awaitState()` 内安装。前面的 `await resolveSecrets()` 和 `await resolver.load()` 没有超时竞争，因此永不完成时根本到不了 fiber 等待阶段。

实测 `startupTimeoutMs: 10`，把假时钟推进十万毫秒，密钥解析或 load 挂起时启动 Promise 仍未落定。

依据：kernel 设计 §5.1 的注册阶段启动时限及 builtin 剩余时限规则。

最小复现：注入永不完成的 SecretResolver 或 PackageResolver.load。

修法：注册阶段从入口就建立统一截止，将每一步异步等待纳入；超时之后禁止迟到结果继续挂载。同步执行无法抢占这一事实也应与异步超时分开处理。

另实测 recover、ready 也可以无限等待，但确认文档没有明确给这两个阶段分配同一个二十秒期限；**这部分属于需要补清的设计策略，不冒充已经写明的超时要求。**

**X9｜代际句柄只在取方法时检查，调用时不检查——已实测**

`handleFor()` 的 get trap 检查代际后返回 `value.bind(target)`。拿到这个函数以后，就与代际检查脱离了：

```ts
const run = handle.run;
disposeProvider();
run(); // 实测仍执行旧实现
```

这甚至可以发生在同一次异步业务操作中，而不必跨业务调用长期缓存实例。方法返回的子对象也没有自动获得代际保护；对 BrainSession 等对象句柄尤其需要单独落实。

依据：kernel 设计 §6.2，以及 contracts 设计 §2.2 第 3 条要求提供方失效后旧句柄报 unavailable。

修法：把代际检查放到每次实际方法调用入口；契约定义的子句柄也必须登记所属提供方代际并统一失效。只在属性读取时检查不足以兑现句柄保证。

**X10｜槽位代理既可修改共享实现，又不兼容冻结的方法——已实测**

代理直接以实现实例为 target，只有 get trap：

- `handle.next = replacement` 会直接改写原实例，其他消费者随即调用替换后的方法。
- 对 `Object.freeze({ next() {} })`，get trap 返回一个新的 bound 函数，违反冻结属性的 Proxy 不变量，读取方法即抛原生 TypeError。

实测两个消费者共享的实现被第一个句柄改写后，第二个返回值从 1 变成 99；冻结实现的普通方法则无法调用。

依据：kernel 设计 §7 的门面防误改目的，以及 §6 的槽位实现解析能力。合法的冻结实现不应因此不可用。

修法：直接重做槽位公开门面：冻结独立的方法接口，目标实现只留在闭包中；禁止通过句柄修改或反射取得可写实现。不要对冻结目标做代理后再替换其不可配置属性值。

**X11｜旧释放函数可以误删新登记——已实测**

释放闭包无条件执行 `map.delete(impl)`，没有幂等标记，也没有验证 map 当前仍指向自己。

最小复现：

```ts
const releaseA = registry.provide('a', slot, 'same', instanceA);
releaseA();
registry.provide('b', slot, 'same', instanceB);
releaseA(); // 删除 B
```

实测活动提供方数量变成 0。实际触发路径包括手动释放后重新登记，随后原插件 effect 清理再次调用旧释放函数。

依据：kernel 设计 §6.2 的代际及失效规则；释放应只影响对应登记。

修法：释放函数幂等化，只在 `map.get(impl) === provider` 时删除当前条目；始终仅撤销自己的 provider 对象。

**X12｜必需槽位“satisfied”不代表有效绑定能使用——已实测**

`plan()` 只检查有没有提供方，以及 member-single 多实现时是否存在一条 default 绑定；它不验证绑定值的形状或目标是否活动。

完整启动实测以下三种情况均返回成功、`satisfied: true`，但立即 resolve 失败：

1. 必需 `memory.engine` 的默认绑定是 `null`。
2. member-single 的绑定是数组 `['a']`。
3. 绑定 `'a'`，A 在 apply 失败被禁用，B 仍活动。

依据：kernel 设计 §5.1、§6.1、§6.2；必需槽位要求“可用实现”，member-single 要求恰好一个有效绑定。

修法：计划与运行时共用同一套绑定语义校验，按基数、作用域、最终启用集合检查默认绑定和成员覆盖；不能用“槽位还有别的实现”替代“该成员的绑定可解析”。

**X13｜高层修正绑定后，低层旧绑定仍可能使计划失败——已实测**

`resolveProfile()` 把所有层的绑定都追加到数组。loader 虽然依次 bind 达到覆盖效果，却又逐条校验数组中的历史绑定。

复现：profile 默认绑定 A；owner 层禁用 A，并把默认绑定改为 B。最终有效绑定是 B，但 dump-config 仍报“绑定 → A：没有已启用的插件声明这个实现”。

依据：kernel 设计 §4.2 明确后层覆盖前层。

修法：叠层阶段直接按 `(scope, slot)` 生成最终绑定及其来源层；最终装配校验只检查生效值。若保留修改历史供诊断，应把历史与生效计划明确分开，不能让被覆盖值参与可用性判断。

**X14｜同层重复检测的边界错误——已实测及代码确认**

三条路径漏检：

- profile 中同一 required id 出现两次，会重复覆盖 config，而不是报重复。
- `touched` 每个 patch 文件重建；两个 `--patch` 文件都属于 cli 层，却可以重复操作同一个 id。
- bind 不进入 `touched`；同层同成员同槽位的两次绑定静默覆盖。

实测两个 cli 文件先 disable、再 enable 同一插件被接受；两个 guard 配置条目最终静默取第二个。

依据：kernel 设计 §4.2“同一层内重复出现同一 id 报错”、§6.2“一成员两绑定是装载期错误”。

修法：按层而不是按文件维护操作集合；单独记录 profile 已出现条目；绑定以 `(scope, slot)` 去重，跨层覆盖仍然允许。

**X15｜静态图忽略自依赖——已实测**

`else if (provider !== node.id) deps.add(provider)` 把自依赖边删掉。`guard` inject `guard` 的图因此显示：

```text
order: ['guard']
missing: []
cycles: []
```

但 cordis 必须先有 guard 才能执行创建 guard 的 apply，最终只能等待超时。

依据：kernel 设计 §5.1 要求计划阶段识别成环；engineering §5 禁止服务依赖环。

修法：保留自环并在图校验中直接点名，不能把它当成不需要排序的依赖忽略。

**X16｜as、多实例与全局插件 id 的定义不自洽——已实测；需要先改清设计**

当前单份 alias 就有问题：计划把 manifest 的 `impl: acp` 改为 `gemini`，但插件仍按其声明调用 `provide(..., 'acp', ...)`，随后被 providerFacade 判为 impl 不符而禁用。现有门面没有给插件提供统一的最终实例身份。

两份实例也无处表达：两条都用 manifest id 会被 profile 去重拒绝；换成两个条目 id 又不符合 loader 的 manifest id 相等检查。

依据：kernel 设计 §3.1、§16 说 ACP 可以用 as 装多份；但 §13 又把部分 as 多实例能力列为以后。插件 id、装配实例 id、槽位 impl id 需要明确区分。

最小复现：`multiInstance: true`，一条 `as: gemini`；再尝试同包两条不同 as。

修法：先明确多实例当前范围和三种身份的定义，再让 profile、patch 定位、生命周期、provide 接口共同使用同一实例模型。若当前阶段不支持，应在计划阶段明确拒绝 as。这里不是要求提前实现多成员隔离，而是避免已经接受的字段产生自相矛盾的装配。

**X17｜plugins[] 没有任何实际装配路径——已实测及代码确认**

schema 接受 `plugins[]`，但 loader 只读顶层 `manifest.id/provides/consumes`。`PreparedEntry.subEntry` 被声明并传给 resolver，却从未赋值。

复现：一个包声明子插件 `part-a` 及其 entry。profile 引用 `part-a` 时，被判为与顶层包 id 不一致；引用顶层 id 则子插件声明被忽略。

依据：kernel 设计 §2、§3.1、§5.1，engineering §2 的一包多插件支持。

修法：在 prepare 源头展开并选择子插件描述，以对应子插件的 entry、provides、consumes 建图和装载；未支持的字段不能先被 schema 接受，再静默忽略。

**X18｜声明了契约版本，不代表实现符合该契约——已实测、已类型检查**

静态方面，`Provides.meta` 是 `z.unknown()`，`checkManifest()` 只核对版本，不调用已有的 `brainProvider.Meta`、`abilityEmbed.Meta` 等 schema。`personaInjection: 123` 可以通过 manifest 校验。

运行时和类型方面，`provide(slot, impl, instance: object)` 允许：

```ts
ctx.slots.provide('brain.provider', 'x', {});
```

这段不需要任何断言就能编译通过；loader 测试中的 `goodBrain()` 实际就这样登记。槽位就绪只看名字登记，随后必需 brains 可以获得没有 `createSession()` 的实现。

依据：kernel 设计 §3.1 对 Meta 的定义，contracts 设计 §2.2、§5.0 的槽位契约机制。

修法：建立槽位名到契约描述和接口的统一映射，直接约束 provide/resolve 类型；manifest 按槽位验证 Meta，启动时至少核验必需方法形状。不要把“任意 object + 相同版本数字”作为契约已满足的证据。

**X19｜JsonValue 没有落实到多处线协议字段——已实测**

确定受影响的例子：

- `BrainEvent` 的工具参数、结果、权限参数；
- `ToolDef.schema`；
- IPC params/result/stream data；
- `LiwaErrorShape.data`；
- 客户端 body/items。

这些位置仍使用 `z.unknown()` 或以 unknown 为值的 record。实测 `BrainEvent` 中 `args: 1n` 校验成功，类型检查也通过；下一步 JSON 序列化会失败。函数和 undefined 还可能在往返中静默丢失。

依据：contracts 设计 §2.2、§2.3 明确规定契约中的任意 JSON 使用递归 JsonValue。required 内部 API 可用 unknown 的例外，不适用于这些线协议字段。

修法：直接把线协议字段改为 JsonValue 或更具体的 JSON schema，删除对应 unknown 定义；为非 JSON 值建立反例测试。这不是要求提前完成 IPC 宿主，而是修复现有 schema 的错误接受范围。

**X20｜方法描述与 TypeScript 接口没有形成单一真源——代码确认，取消字段行为已实测**

当前 `Methods`、`SessionMethods` 与 `BrainClient/BrainSession` 分别手写，已经存在明确分离：

- 没有设计要求的 `Handles` 创建关系描述。
- `events()` 没有对应方法描述、流声明、CallContext 或方法超时。
- `interrupt/close` 描述结果为 null，手写接口为 void。
- create/resume 的 wire 参数与进程内参数采用不同形状，却没有公共推导机制描述转换关系。
- `CallContext` 只有 wire 字段；设计声明进程内另带的 AbortSignal 没有相应类型。实测传入 signal 后经 schema parse 会被丢弃。

依据：contracts 设计 §2.2 第 3、4、6 条，§5.0、§5.1。

修法：先实现描述层的句柄、流和接口推导，删除重复手写的接口定义；明确区分 wire CallContext 与包含 AbortSignal 的进程内调用上下文。否则首个 IPC 适配层必然重新发明一套接口对应关系。

**X21｜IPC 消息联合会把非法形状“清洗”为另一种合法消息——已实测**

由于各分支都是会丢弃未知字段的 `z.object`：

```text
{ jsonrpc:'2.0', id:'1', result:null, error:{...} }
```

被接受为成功响应，error 被删除。

```text
{ jsonrpc:'2.0', id:42, method:'kernel/ping' }
```

请求分支因 id 非字符串失败后，通知分支成功，id 被删除。

依据：contracts 设计 §10 要求字符串 id、响应 result/error 互斥，以及非法消息计数告警。丢弃未知扩展字段不等于可以丢弃另一类消息的判别字段。

修法：在原信封 schema 中先确定消息类别，再验证其核心字段的互斥和缺省规则；对错误类型的 id、请求/通知混合、result/error 同时存在明确拒绝。无需禁止所有未来可选扩展字段。

**X22｜事件信封多出必填 version，且存在两个互相矛盾的版本真源——已实测**

确认文档 §6 的 EventEnvelope 依赖 `type: xxx.vN` 表达事件版本，没有独立必填 version；实现却要求它。

实测：

- 文档形状、没有 version 的事件被拒绝。
- `type: 'kernel.started.v1', version: 999` 被接受。

依据：contracts 设计 §6、§12，尤其“向前兼容只加可选字段”的规则。

修法：依已确认规范删除这个重复必填字段，让事件类型成为版本真源；若确实需要独立 version，应先变更设计并明确一致性规则，不能继续允许两种版本互相矛盾。

**X23｜生命周期事件链路未完成，启动事件写失败也仍宣布成功——已实测**

`plugin.disabled.v1`、`plugin.failed.v1`、`slot.bound.v1` 虽已定义，但 kernel 没有相应 journal 写入或启动前缓冲。`HostSlots.bind()` 甚至不发出进程内 `slot/bound`。

实测一次插件 apply 失败加一次 runtime bind，journal 只收到 `kernel.started.v1`，slot/bound 监听计数为 0。

此外，`kernel/started` 在 journal append 之前发出；append 失败仅记日志。实测 journal.append 抛出“磁盘失败”，`startKernel()` 仍成功、journal health 仍为 true。

依据：kernel 设计 §5.1、§11 明确要求对应生命周期事件写经历流，journal 就绪前缓冲。

修法：在 kernel 的事件发生源头统一产生结构化事件，按 journal 就绪状态缓冲或追加；启动记录提交成功后再宣布启动成功。启动记录写入失败应进入失败路径，或者先明确修改已确认设计中的失败政策。连续崩溃熔断事件本身仍按已知推迟项处理，不计为本条缺陷。

**X24｜错误转换丢失诊断信息，错误边界不统一——已实测及代码确认**

明确路径包括：

- Config safeParse 抛异常后，重新创建 LiwaError 却不保留 cause。
- required apply 失败后，`startup.failed` 只拼接 message，不保留原错误。
- recover 直接向外抛任意 Error，未统一成 LiwaError。
- cordis exporter 把 Error 转成 String，原始 stack 及结构化字段没有保留。

实测 required create 抛出的原始 Error，调用方拿到的 `startup.failed.cause` 为 undefined；recover 抛错时 `LiwaError.is(error)` 为 false。

依据：engineering §9“不吞错误、重抛带 cause”，contracts 设计 §7、§11 的跨模块错误约定。

修法：在各边界直接规范化为带 cause 的 LiwaError；日志使用保留 stack/cause 的结构化错误表示，并在输出时统一脱敏。不能靠把原错误文本嵌进另一条字符串替代 cause 链。

**X25｜async 监听器异常绕过捕获——已实测、已类型检查**

`KernelEvents` 监听器返回 void，但 TypeScript 允许 async 函数传给 void 回调。`KernelEmitter.emit()` 的 try/catch 只能捕获同步抛错，忽略返回的 Promise。

实测 async 监听器抛错，产生 `unhandledRejection`，而 emitter 的日志条数为 0。

依据：`events.ts` 自身承诺逐个捕获监听器异常，以及 engineering §9 的错误处理要求。此项与推迟 ALS 标记插件 id 无关。

修法：在事件分发源头处理监听器返回的 thenable 并记录拒绝，或采用能明确约束并验证同步监听器的 API；同时保留监听所属插件信息以便定位。不能仅用 `=> void` 假定运行时不会返回 Promise。

**X26｜默认导出检查检测了值，没有检测导出的存在——已实测**

`mod.default !== undefined` 会放过 `export default undefined`。实测 `{ plugin, default: undefined }` 被 `pickPluginExport()` 接受。

依据：kernel 设计 §2、§3.2 及 engineering §9 的“出现默认导出即拒绝”。

修法：直接检查模块是否具有 `default` 导出，例如 own-property 检查；删除按值判断的旧逻辑。

**X27｜运行参数未遵守 params.ts 硬规则——代码确认**

启动默认二十秒、关闭四十五秒、多个契约方法的三十秒/十秒/五秒/一秒等运行参数，直接散落在 loader 和 Methods 定义中，未集中到带单位及来源的参数表。

依据：engineering §9 明确要求“数值参数全部进模块的 params.ts，带单位和来源注释”。本条不把 fiber 枚举值、sfc32 位运算常量等算法常量当成问题。

最小复核：检索 loader 的 `20_000/45_000` 与各契约的 `timeoutMs`，当前范围没有对应 params.ts。

修法：把运行政策参数在所属模块源头集中声明，原使用处直接引用；删除散落的重复数值，不另加一层事后解释。

**待实测及边界说明，不计入上述 27 项**

- **仓库或 LIWA_HOME 经符号链接访问。** `locate()` 对包目录 realpath，但 `deriveKind()` 的 root/home 未同样规范化。别名路径与物理路径混用可能把合法包判成未知位置。本次验证了普通 pnpm workspace 路径，未创建仓库目录符号链接实物用例，因此此项保留待实测。
- **生产条件与开发条件的真实 import。** resolver 使用 `createRequire().resolve()` 再 import 文件；本次没有在只读环境创建具备完整 manifest 的真实插件包，尚未验证所有 exports 条件组合。
- **health 挂起策略。** health 顺序 await 每个钩子，没有时限；一个钩子挂起会阻止整份健康状态返回。代码事实明确，但设计尚未给出 health 截止政策，应先明确。
- **服务对象的深层可变性。** 服务实例只做浅冻结，嵌套状态及原型没有普遍隔离。当前设计明确要求实例冻结，但未明确每种嵌套对象的公开语义；不据此夸大为插件安全隔离失守。已确认的实际问题是 X5 和 X10。

**④ 测试缺口**

现有测试有价值：覆盖了部分 manifest 错误、四层基本操作、服务图缺项、required apply 超时、普通槽位属性失效、随机源恢复，以及一条完整五阶段正路。主要不足是，许多重要保证没有用反例验证。

| 领域 | 当前测试的局限 | 应补的关键行为 |
|---|---|---|
| 真实 loader | `memoryResolver` 直接返回已构造的 pkg/module，绕过文件 schema 解析、Node 包解析、真实 import | 真实 workspace fixture、realpath/symlink、exports 条件、顶层模块执行、子插件入口 |
| cordis 状态 | 没断言事件 fiber 身份，也没模拟 required 运行中失活 | ACTIVE→UNLOADING/PENDING/FAILED、故障关闭、重跑 apply 后的生命周期一致性 |
| 启动超时 | 只测试 required create 挂起 | SecretResolver、import、builtin apply、超时后迟到登记 |
| 槽位就绪 | 看名字存在即可，goodBrain 使用 `{}` | 缺方法、非法 Meta、null/数组绑定、绑定目标失败、ready 后失去必需实现 |
| 关闭 | 正路只断言 drain 顺序和一个同步 cleanup；超时测试只看 Promise 最终失败 | drain 吃完预算后仍发起释放、定时器/订阅无残留、异步清理顺序、迟到 apply |
| 代际句柄 | 仅测试 `handle.type` 属性读取 | 已取得的方法、子句柄、冻结实例、句柄写入、旧释放函数二次调用 |
| patch | 单文件同层重复、简单覆盖 | 多个 cli patch 文件、required 重复条目、重复 bind、覆盖后禁用旧目标 |
| 写入纪律 | 没有类型负例和运行时裁剪测试 | builtin 调 journal.append 在类型和运行时都失败 |
| 密钥 | 正路只断言 plan 不含一个预设字符串 | Error.message、cause、Config 错误、插件日志、cordis 日志、plan.reason |
| 哈希 | 只对同一输入计算两遍 | 改实现代码、required、Config 默认值、依赖内容、最终启用集合时应变化 |
| 契约 | 主要测试少量机制 schema 正路 | 每个槽位 Methods/Meta 的正反例、非 JSON 值、接口推导一致性 |
| IPC | 只有请求/响应/通知正路及一个非法方法名 | result/error 并存、非法 id 降成通知、混合消息、错误数据序列化 |
| 错误与事件 | 检查日志是否含 boom | cause/stack 保留、async listener 拒绝、启动前事件缓冲、journal 写失败 |
| 组合根 | smoke 仅 `expect(entry).toBeDefined()` | 真正调用 assemblyOptions/dumpAssembly、解析参数、退出码、静态计划快照 |

几条测试尤其容易给出超出证据范围的信心：

- `loader.test.ts:107` 的“dump-config 不导入代码”把异常放在 **apply** 中，而不是模块顶层，也没有断言 resolver.load 未调用；它不能证明未导入模块。
- `loader.test.ts:211` 的脱敏测试在 dump 阶段没有解析密钥，且当前 plan 根本不输出 config；断言不含 `sk-live` 没覆盖真正的泄露路径。
- `loader.test.ts:186` 的超时测试证明了启动 Promise 最终失败，**没有证明失败后资源都已失效**。
- `slots.test.ts:5` 的普通属性测试不能代表方法、返回子对象和释放幂等性的正确性。
- `schemas.test.ts:128` 的测试名称提到 undefined，但实际只对函数做了拒绝断言；更重要的是，测试了 JsonValue 本身，没有证明使用 unknown 的真实契约字段也会拒绝。

另外，实际的 [tools/ci.sh:25](tools/ci.sh:25) 目前只接入 lint、typecheck、test。设计列出的 schema 导出一致性及 dump-config 快照仍未接入。因此“CI 全绿”的证明范围应限定在现有检查内。

**⑤ 对已知推迟项的意见**

- **回环编解码测试：不计为缺陷，但继续推迟会造成明显返工。** X19、X20、X21 已说明：当前接口形状还没有被真实编码边界约束。建议至少在接第一个大脑适配器前，先完成 Methods/Handles/流的统一描述与几个最小往返反例；完整测试矩阵可以分批补。
- **安全模式页与 boot.json：可以随组合根推进。** 但 X1–X4、X8 应先修，否则内核可能既不成功启动，也不进入明确失败退出，安全模式及连续失败计数都收不到可靠结果。
- **连续崩溃自动禁用与 ALS 插件 id：可以推迟。** 当前已经有插件 id 的 apply、ready、dispose、事件路径应先把错误与状态记录正确。X4 的 fiber 对象身份错误和 X25 的异步拒绝遗漏，不需要等待 ALS 才能修。
- **`@liwa/testkit` 独立包：风险较低。** 当前把测试便利函数放在 kernel，后续迁移主要是公开 API 和依赖调整；更紧要的是补真实文件系统 loader fixture，以及让内存 resolver 也执行与生产一致的 manifest 校验。
- **kernel-1 IPC 宿主：可以推迟。** 但现有 IPC 信封、JsonValue 约束、句柄/流描述和取消上下文应现在修正。这些是已经落地的机制契约，不应等宿主实现时再改变其基础形状。

**⑥ 实际读过的文件清单**

以下列出本次实际阅读范围；没有把其他 agent 新增的复核报告算进来。

**指定业务源码、测试及工具：47 个 TypeScript 文件。**

`packages/kernel/src/` 的全部 17 个实现文件：

```text
assembly.ts
clock.ts
context.ts
events.ts
graph.ts
ids.ts
index.ts
loader.ts
logger.ts
manifest.ts
plugin.ts
profile.ts
rng.ts
secrets.ts
slots.ts
testing.ts
types.ts
```

`packages/kernel/src/__tests__/` 的全部 6 个测试文件：

```text
graph.test.ts
loader.test.ts
manifest.test.ts
profile.test.ts
rng.test.ts
slots.test.ts
```

`packages/contracts/src/` 的全部 21 个文件，包括测试：

```text
common.ts
errors.ts
index.ts
services.ts
z.ts
__tests__/schemas.test.ts
events/envelope.ts
events/index.ts
events/kernel.ts
ledgers/index.ts
manifest/assembly.ts
manifest/liwa.ts
manifest/profile.ts
protocol/client.ts
protocol/ipc.ts
slots/ability.embed.ts
slots/brain.provider.ts
slots/defs.ts
slots/index.ts
slots/job.trigger.ts
slots/memory.engine.ts
```

组合根及指定工具：

```text
apps/liwa/src/index.ts
apps/liwa/src/__tests__/smoke.test.ts
tools/dump-config.ts
```

设计基准及相关仓库配置：

```text
docs/architecture/modules/00-plugin-kernel.md
docs/architecture/modules/00-contracts.md
docs/engineering.md
profiles/m0-terminal.yml
package.json
packages/kernel/package.json
packages/contracts/package.json
apps/liwa/package.json
tools/package.json
pnpm-workspace.yaml
tsconfig.json
tsconfig.base.json
vitest.config.ts
eslint.config.js
.node-version
tools/ci.sh
```

锁定版本 cordis 的本地文件，路径前缀为：

```text
node_modules/.pnpm/cordis@4.0.0-rc.12/node_modules/cordis/
```

实际阅读：

```text
package.json
lib/index.js          # 重点核对 Fiber、effect、依赖传播、服务访问、
                      # RegistryService.plugin、事件及 logger exporter 实现
lib/fiber.d.ts
lib/registry.d.ts
lib/reflect.d.ts
lib/logger.d.ts
lib/context.d.ts
```