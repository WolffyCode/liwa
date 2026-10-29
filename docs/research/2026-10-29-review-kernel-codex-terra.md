# 评审：插件机制底座与协议规范（Codex，gpt-6.1-terra，推理 max）

日期：2026-10-29。评审对象：`architecture/modules/00-plugin-kernel.md`、`00-contracts.md`、`engineering.md` §4（评审时的稿本）。任务书同三位评审。以下为模型原文。

---

# 灵鲸插件底座独立评审

## ① 总评

**目前不能作为完整实现 spec 直接开工。** 可以先做限定为仓库内可信代码的 Cordis 和 m0 原型，但应先修正阻塞 m0 的启动、接口和生命周期问题；进程外插件的隔离与 IPC 问题是**开放外部插件前**的阻塞项，不必全部阻塞 m0。

最重要的三条意见：

1. **先把信任边界写实。** 同用户子进程、环境清洗、握手令牌和 import 检查都不能保证插件读不到数据或绕过行动管线。主人审核过的插件与真正不可信的插件必须分开承诺。
2. **先打通真实启动闭环。** “全部 core 插件必装”、启动前读取主人配置事件、槽位计划及失败后只起主控台，目前互相依赖；照稿实现，m0 无法按计划逐步长出来。
3. **重新收紧“统一契约”。** `BrainSession`、同步方法、`Date`、函数、Zod 对象与“所有方法都是 JSON、进程内外同一接口”相矛盾。先定清进程内 API 与线协议的映射，再谈自动生成代理。

方向上，借 DSH 的装配形状而不照搬信任模型、以 Paseo 契约为起点而不以 ACP 作为内部协议，判断是对的。

## ② 问题清单

1. **阻塞，开放外部插件前｜进程外并非安全隔离**  
   位置：[kernel §8.1、§10](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:216)。文档称插件“拿不到数据库路径”，但工作目录本身位于 `LIWA_HOME/plugins/<id>`；同一系统用户还可以访问同用户可读写的文件和网络。环境清洗及子进程只提供故障隔离，不阻止读库、改配置或直接联网。  
   建议：明确 V1 只运行仓库内或主人明确审过、等同可信代码；对未审阅代码，开放前必须实测 OS 级文件、进程及网络限制。隔离不可用时拒绝加载，不能降级为“仍受隐私保护”。

2. **阻塞｜插件能申请完整内核服务，权限没有落到接口上**  
   位置：[kernel §3.1、§9](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:70)，[memory §3.1](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/05-memory.md:242)。`consumes` 由插件声明，`KernelContext` 暴露完整 `Services`；例如拿到 `memory` 后，其接口包含主人搜索、删除和 `by: 'owner'` 更正，字符串不能证明调用者是主人。`Slots.define/bind/provide` 也没有按调用方收权。  
   建议：把内部服务与插件专用 facade 分开；仅宿主能定义、绑定槽位，插件只能登记 manifest 授权的实现。主人操作由网关凭已认证的宿主身份调用，不能接受插件自报 `owner`、受众或可见集合。同进程 facade 是防误用的结构约束，不应宣称能防恶意代码。

3. **阻塞｜required 名单只核对声明，不足以证明实现不可替换**  
   位置：[kernel §3.1、§4.2、§5](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:70)。`kind` 和包名来自 manifest，而 `provides` 的 schema 是槽位名，不能表达内核服务键；“检查 provides 不含内核服务键”因此不足以约束实际注册。没有规定 required 的可信包路径、入口和身份如何固定。  
   建议：由宿主内置不可配置的 `required id → 可信包/导出入口/服务键` 映射，校验规范化路径及构建产物身份；拒绝同 id、同服务键的其他声明，并在实际注册时按宿主授予的身份检查。加入伪造 manifest、包名、入口和重复注册测试。

4. **阻塞｜“所有 core 插件必装”与 m0 增量实现冲突**  
   位置：[kernel §5](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:157)，[engineering §4.7](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/engineering.md:135)。所有 `@liwa/core` 插件都 required 且自动补齐，但 m0 计划尚未实现 scheduler、完整账本及其他模块；示例还要求四类用脑和三个引擎全绑定。  
   建议：按 profile 列明**当前阶段必有的真实安全能力**和启用的模块；未实现的模块及其槽位不装、不接受对应请求。九样不可替换是目标边界，不应靠空实现冒充已经具备完整保护。

5. **阻塞｜主人配置事件与槽位计划存在启动循环**  
   位置：[kernel §4.2、§4.3、§5](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:138)。第 1 步要读取系统流中的主人绑定，第 4 步要据此计算成员槽位；journal 和 roster 却在第 5 步才装载。`dump-config` 又声称只跑前四步且不导入业务代码。  
   建议：明确两阶段启动：可信最小存储自检和读取已提交配置快照，再合并 profile、生成计划并加载业务模块。`dump-config` 区分“静态计划”和“读取本机已提交配置后的有效计划”，说明缺数据库或配置损坏时的行为。

6. **阻塞｜进程内接口不能直接当 JSON-RPC 契约**  
   位置：[contracts §0、§5.1、§5.5](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-contracts.md:5)。`createSession()` 返回带方法和流的 `BrainSession`，`describe()` 等是同步方法，`job.trigger` 含 `ZodType`；这些不能原样序列化，跨进程调用也不能同步返回。已确认的记忆接口还有 `Date` 和函数。  
   建议：单独定义 JSON 消息层：`createSession → sessionId`，其他方法携带该 ID，流按 ID 订阅，远程方法统一异步；本地对象可作为 facade 包装消息层。将 `Date` 改为时间字符串，把 schema 作为可导出的数据而非运行时对象。未完成映射前，不称“同一接口进程内外透明”。

7. **阻塞｜Zod schema 示例在 Zod 4 下不接受自己的示例**  
   位置：[contracts §3](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-contracts.md:48)。`SlotName` 若为枚举，Zod 4 的 `z.record(SlotName, ...)` 要求所有枚举键都出现；单一 `brain.provider` 的 manifest 和部分成员槽位会失败。普通 `z.object` 默认还会剥掉未知键，含多个操作的 patch 可能被静默解释为其中一个。  
   建议：钉 Zod 版本；部分枚举映射使用 `z.partialRecord`，manifest、profile 和 patch 使用严格对象及互斥操作校验。将文档中的完整 YAML/JSON 示例直接作为正例测试。([zod.dev](https://zod.dev/api))

8. **阻塞｜effect 清理承诺与 Cordis 实际行为不一致**  
   位置：[kernel §2、§7、§12](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:27)。`cordis@4.0.0-rc.12` 的 `DisposableList.clear()` 反序取出释放函数，但 fiber 用 `Promise.all` 等待它们，异步释放**不是严格逐个完成后再开始下一个**；释放异常也由 Cordis 记录。  
   建议：若需要严格逆序，kernel 自己维护一个顺序等待的释放栈，作为一个 Cordis effect 注册；规定错误收集、幂等和超时。测试中让后注册的异步释放等待一个屏障，证明前一个不会提前执行。([raw.githubusercontent.com](https://raw.githubusercontent.com/cordiverse/cordis/v4.0.0-rc.12/packages/core/src/utils.ts))

9. **阻塞｜启动超时不能可靠地“禁用”进程内插件**  
   位置：[kernel §5、§10](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:157)。进程内同步死循环会阻塞超时器；异步 `apply` 超时后也可能继续执行、稍后注册副作用。Cordis fiber 在加载进行中会等待相应工作结束，超时并不等于已撤销。  
   建议：定义可协作取消的 `AbortSignal` 和代际失效检查；超时后拒绝该代插件继续注册。无法确认进程内插件停止时按失败退出处理，不宣称可以强杀单个插件；真正需要硬隔离的工作放子进程。

10. **阻塞｜计划通过不等于必需能力可用**  
    位置：[kernel §5、§6.3](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:157)。第 4 步只看 manifest 中的提供方，第 6 步却只强制 required fiber 就绪；被绑定的 builtin 引擎或主大脑失败后仍可进入“启动成功”。已经解析并缓存的实例也可能在提供方熔断后继续被持有。  
    建议：每个 profile 明确哪些绑定是启动必需、哪些可降级；装载后复核真实注册和健康状态。运行时使用可失效代理或调用时复查代际，关闭未完成调用和流；主能力缺失时失败，备用或可选能力按明确回退规则处理。

11. **重要｜Cordis 的配置校验、服务和状态需要更精确的封装**  
    位置：[kernel §3.2、§7、§9](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:84)。`rc.12` 接受 Standard Schema，但其实现明确拒绝异步校验；`defineService` 示例直接把可能为 Promise 的工厂结果交给 `provide`。此外 `Partial<Services>` 下示例直接访问 `ctx.procs` 与 `strict` 类型检查不符，fiber 也可因依赖变化回到等待状态，并非只走一次线性状态机。  
    建议：限制配置 schema 为同步校验；先 `await create()` 再提供实例；依据 `inject` 给上下文收窄类型或显式检查。测试缺依赖、失败、依赖消失与恢复，而不只测一条状态路径。([raw.githubusercontent.com](https://raw.githubusercontent.com/cordiverse/cordis/v4.0.0-rc.12/packages/core/src/fiber.ts))

12. **重要｜JSON 值和 JSON Schema 的约束尚未可执行**  
    位置：[contracts §2、§5.0、§12](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-contracts.md:28)。`z.unknown()`、工具参数和事件的 `unknown` 在进程内可包含函数、`undefined`、循环引用等；`void`、`Date`、transform 和自定义校验也不能无损导出为 JSON Schema。  
    建议：定义递归 `JsonValue` 和可导出的 Zod 子集，明确输入/输出 schema、JSON Schema draft、默认值和未知字段策略；禁止无损性未知的转换静默导出。对同一组正反例分别测试 Zod、导出 schema 及 JSON 往返。([zod.dev](https://zod.dev/json-schema))

13. **重要｜账本与引擎接缝没有真正写入协议**  
    位置：[contracts §5.2–§5.4](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-contracts.md:170)，[memory §3.5](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/05-memory.md:326)。目前多处仍是类型名或未定稿签名；记忆 `rank` 没明确只接收已过滤候选、只返回编号和分数。`ingest` 返回模型提案，同时要求经上层 `minds` 调 CLI，依赖方向和调用过程不明确。  
    建议：由账本先按宿主计算的受众裁候选，内核对返回编号再次校验；写提案的证据、来源、受众及成员由账本复核。由编排层负责模型调用，引擎分别生成请求和解析结果，避免账本或引擎反向依赖 `minds`。

14. **重要｜成长渲染可绕过主人确认的人设文本**  
    位置：[contracts §5.3](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-contracts.md:174)。`renderPersona` 可返回任意文本；即使不能改出生设定账本，也可能在实际提示词里遗漏或改写主人确认的底色与不可变规则，这正是 DSH 人设扩展的风险。  
    建议：宿主负责插入主人确认的基础身份和硬规则，插件只返回有边界的可变段；写明这保护的是**注入结构与账本写入**，不能保证模型必然遵守文本。主人变更出生设定仍只能走已鉴权接口。

15. **重要｜JSON-RPC 信封与握手尚不完整**  
    位置：[contracts §10](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-contracts.md:267)，[kernel §8.2](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:220)。contracts 的响应示例漏了必需的 `jsonrpc: "2.0"`；空结果、双向请求 ID、错误互斥、非法消息及批请求策略没有定义。握手说要校验 token，但 `welcome` 没有 token 字段；把 token 发给插件也不能证明插件代码可信。  
    建议：定义带完整正反例的请求/响应/通知 schema，成功无值统一返回 `null`；约定双向 ID、错误码和是否支持 batch。将继承的 stdio 管道作为连接边界，令牌仅用于有明确用途的能力授权，不把它当 OS 隔离。([jsonrpc.org](https://www.jsonrpc.org/historical/json-rpc-2-0.html))

16. **重要｜流控、取消与超时可能造成内存增长或重复动作**  
    位置：[kernel §8.2–§8.3](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:220)。每 256 条发一次 ack 没规定未确认窗口和字节上限；64 个在途请求之外的队列也无上限。超时统一标为可重试，不能证明对方没执行成功。  
    建议：规定流 ID 生成、先响应后发流、序号、发送窗口、条数和字节上限、队列满时的拒绝及断连清理；取消是请求而非完成证明。涉及外部动作的超时标“结果不明”，只对明确幂等的操作重试。

17. **重要｜事件规范与经历流写入语义不闭合**  
    位置：[contracts §6–§7](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-contracts.md:224)。`kernel.started`、`plugin.circuit_open` 不符合要求 `.v<n>` 的事件类型正则；`payloadRef.erased` 若在删除时修改又违反信封不可变。接口清单没有规定 `expectedSeq`、追加与内联投影的事务关系及删除载荷的授权。  
    建议：区分进程内通知与持久事件，后者使用注册过的版本化类型；删除状态由独立删除事件或载荷查询结果表达，不改旧信封。为 journal 补可编译 API、期望序号、事务、提交位置和冲突测试。

18. **重要｜回放注入缺少单调时钟和随机状态恢复**  
    位置：[kernel §9](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:249)，[overall §3.1、§14](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/overall.md:345)。当前 `Clock` 只有 ISO 当前时间和 timer，`CounterRng` 有 `state()` 却没有恢复入口；整体架构要求挂钟、单调时间及从采样状态恢复。  
    建议：定义可注入的挂钟、单调时钟和虚拟定时器，以及随机源种子、状态恢复和稳定的分流规则；安全令牌使用独立的密码学随机源。测试同种子、同事件及中途重启恢复得到相同 L0 轨迹。

19. **重要｜槽位清单无法完整表达自己的例子**  
    位置：[kernel §6](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:172)，[contracts §4](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-contracts.md:78)。`single` 一处说恰好一个，loader 又说最多一个；UI 写了 `keyed`、按会话作用域，而 `SlotDef` 不支持；能力槽位说可按成员覆盖，绑定 API 没有对应规则。一个插件提供多个 `job.trigger` key 的登记方式也不明确。  
    建议：把“槽位基数”和“此 profile 是否必需”分开；统一 `keyed/registry`、作用域、排序及成员覆盖语义，给每种基数各写一个完整 manifest、绑定和解析例子。

20. **重要｜profile 和 patch 示例本身无法可靠执行**  
    位置：[kernel §4](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:106)。示例 profile 已有禁用的 `ability-embed-local`，patch 又插入同 id；`bind` 指向未安装的 `codex`。五种操作没有 `enable`，也没定义 `extends` 循环、重复 id、缺失锚点及 `replace.package` 的完整语义。  
    建议：补 `enable` 或规定明确的删除再插入；修正示例，使其可作为端到端 fixture；对循环、重复、未知目标和非法绑定 fail closed，并报告来源层与位置。

21. **重要｜密钥、装配哈希和诊断输出没有完整规则**  
    位置：[kernel §4.3、§10–§11](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:153)，[engineering §7](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/engineering.md:196)。已选钥匙串及 `secrets.env` 退路，但插件配置只说“密钥引用脱敏”；没说明引用格式、解析时机、缺失处理、日志泄漏和哈希输入。  
    建议：定义 `secretRef`，仅在授权插件启动时解析，缺密钥明确失败或禁用；日志、错误、stderr 和 `dump-config` 不输出明文。装配哈希使用规范化的非秘密配置、引用标识及制品身份，不对低熵明文秘密直接哈希。

22. **重要｜Paseo 会话契约缺少可恢复的事件与未知用量表达**  
    位置：[contracts §5.1](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-contracts.md:116)。`usage: 'none'` 与完成事件必填输入/输出 token、推理次数冲突；两个回合之间退出时又没有可填的当前 `turnId`。`events()` 未规定订阅何时建立，可能漏掉快速开始的事件。  
    建议：用显式 `unknown`/可选数值区分未知和零；增加会话级退出事件或规定下次调用失败；定义先订阅后启动、序号、缓冲、终止与重复事件语义。预算对未知用量采用明确的保守策略。

23. **重要｜失败恢复路径依赖可能已经失败的服务**  
    位置：[kernel §5、§10](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:157)，[overall §12.1](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/overall.md:1251)。required 失败后“只起主控台”，但 gateway 本身也是 required，且可能依赖失败模块；关闭流程先逆序 dispose，再调用可能已被释放的 procs。  
    建议：定义独立、最小的本机恢复入口及允许的修复操作，不启动用脑或外部动作；规定最后可用的进程监管器何时杀子进程、何时释放。测试配置错误、journal 不可用、启动中断及重复关闭。

24. **重要｜版本与独立插件升级策略不完整**  
    位置：[contracts §12](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-contracts.md:286)。同一提交改完内置实现适用于单仓库，却不能更新以后主人安装的独立包；前后端和 IPC 共用版本也会造成无关耦合。“只加可选字段”不是无条件兼容保证。旧事件 schema 重放与整体架构的一次性迁移策略也须对齐。  
    建议：分别定义宿主 API、槽位、IPC、客户端和持久事件的检查对象；外部包不匹配就拒绝并提示所需版本。事件破坏性变更明确选离线迁移及迁移所需旧 decoder，不把历史数据简单当作同提交可更新的消费者。

25. **重要｜Paseo 落位合理，但“照搬”缺少依赖闭包和验收边界**  
    位置：[engineering §4.8](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/engineering.md:164)，[Paseo 调研 Q4、Q10](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/research/2026-10-28-paseo-architecture.md:198)。三个适配器放 `plugins/brain-*`、共享无业务代码放 `brain-shared` 合理；但上游还依赖进程、工具归一、提示词及 workspace 等共享件，直接整目录照搬并不能保证符合依赖表。  
    建议：摘取前固定一个已审阅的上游提交，列每个适配器的实际 import 闭包、裁剪项和依赖；保留许可证、NOTICE 和修改说明。m0 先验证 Claude 的人设、工具、进程登记、续接、中断及用量；Codex、ACP 按已定 M1 节奏摘取和验证。

26. **建议｜Cordis 事件与作用域不能直接当业务安全机制**  
    位置：[kernel §0、§9](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:7)。插件对象、数组 `inject`、服务和 effect 的形状基本可行；但 `isolate` 是服务解析作用域，不是进程安全隔离。已查到的上游主线 `emit` 同步调用监听器，`serial` 遇到非空结果会提前结束，不能假设所有监听器都会执行。  
    建议：kernel 只暴露确实需要的通知 API，规定监听器异常处理；业务事实仍只经 journal。对钉死版本验证同作用域重复 `provide`、依赖消失、事件异常和作用域行为。([github.com](https://github.com/cordiverse/cordis/blob/v4.0.0-rc.12/packages/core/src/context.ts))

27. **建议｜仓库规则与插件入口、扩展承诺不一致**  
    位置：[engineering §4.1、§4.6](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/engineering.md:46)，[kernel §3.2](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/modules/00-plugin-kernel.md:84)。工程规则禁止默认导出，插件却要求默认导出；`@liwa/core#id` 是装配选择器，不能直接当作已定义的 Node 包导入路径。封闭的 `SlotName` 枚举也意味着新槽位必须先升级宿主协议。  
    建议：规定入口例外或统一命名导出；把包名、插件 id、真实 `exports` 子路径分开解析并测试 pnpm/ESM。明确“装上一个就好一个”目前指**已有槽位增加实现**，不是未经宿主升级就能增加任意新槽位。

## ③ 缺失项

- **安装与供应链门槛：** 主人本机确认、精确版本及内容哈希、依赖锁定、禁止安装脚本、路径与符号链接校验、回滚。`--ignore-scripts` 不能使之后执行的插件代码变安全。
- **资源和观测边界：** 子进程 CPU、内存、子进程数、磁盘及日志上限；stderr 脱敏和轮转；启动失败时独立诊断。指标与 `kernel.*` 通知要区分运行日志和持久事实。
- **热重载预留：** 现在不实现，但接口应有实例身份、代际失效、关闭幂等和资源所有者；将来要在线替换仍需另做排空、状态迁移和失败回滚设计。
- **测试接缝：** 除现有 T1–T10，增加真实 loader 装配示例、伪造身份、owner API 越权、受众交叉成员、异步释放顺序、超时后迟到注册、损坏配置恢复、流窗口与结果不明、重放恢复测试。

## ④ 与整体架构或调研的冲突

- **进程模型：** [overall §3.5](/Volumes/Aether/Users/wolffycode/Developer/person/liwa/docs/architecture/overall.md:418) 要求原生代码按风险进程外；kernel 写 V1 builtin 全进程内，而 engineering 又允许本地嵌入进程外。决策 30 已允许先试进程内，应将其明确写为经主人确认的例外，而不是互相覆盖。
- **层与所有权：** overall 要求账本不依赖插件宿主、插件不直接写经历流；engineering 表述账本“消费引擎槽位”，kernel 又把 `journal` 提供给插件。应改成编排层组合账本与引擎，账本只认识契约和经过校验的提案。
- **D3 的隐私接缝：** 调研要求先过滤、引擎返回编号、账本再核受众；当前 contracts 尚未把这一规则落实为可测试的调用协议。
- **D5 的界面逃生口：** 设置和插件管理页应永远由可信内置界面提供；`client.entry` 仅校验在 `exports` 中，不足以安全加载第三方页面。
- **D7 与节奏：** V1.1 做真实第二记忆引擎替换演练与 roadmap 一致；m0 应先做两个假实现的真实装配测试，不必把完整引擎提前。文档中“第一版完成标准”应注明 V1.1。
- **工具与副作用：** “副作用一律经 `actions.run`”过宽，连日志、定时器、进程监管和 journal 写入都包含在字面内；应限定为受管的业务动作，并明确原生 CLI 工具、能力调用和最终投递各自的守门点。

## ⑤ 可以删掉或推迟的

- **m0 必须有：** 可信 required 注册表、最小真实安全能力、manifest/profile 校验、槽位绑定及就绪检查、可撤销注册、journal 最小事务、主人鉴权、最小大脑契约与真实 loader 测试。
- **推迟到第一个真实进程外用户之前：** 通用 IPC 代理生成、跨语言 SDK、完整流窗口、熔断管理页。现在先写清消息形状和边界，避免把假插件吞吐测试当成安全验收。
- **推迟到对应模块实现时：** 未用到的槽位、完整 UI 贡献点、社会内容包、全部工具参数和非 m0 模型适配器的深度测试；不要把占位签名标成“定稿”。
- **继续推迟：** 热重载、插件市场、第三方原生界面和任意插件依赖图。第三方插件开放之前，OS 隔离不能继续作为无条件推迟项。

## ⑥ 需要主人拍板的

1. **外部插件的承诺：** 在 OS 隔离完成前，是否只允许主人明确审核、按完全可信代码运行的插件？建议是；未审阅插件一律不开。
2. **人设渲染边界：** 是否接受主人确认的基础身份和硬规则由宿主固定注入，而成长插件只能贡献可变段？这会收窄插件自由度，但能避免替换引擎时静默遗漏底色。
3. **m0 的最低完整性：** 是否接受九样内核随模块逐步实现，但每个阶段只开放已有真实守门的功能，不用空插件宣称规则已齐？建议是。
4. **IPC 的交付时间：** 通用宿主是否等第一个真实进程外插件再实现？若主人要求 V1.0 必须具备，则须把第 1、15、16 项及资源限制纳入验收，而不只测假插件。
5. **扩展范围：** “装上一个就好一个”是否限定为给已有标准槽位增加实现？若要求第三方无需升级宿主就能发明新槽位，需要另定协议注册和信任模型。

**核对范围：** 已只读核对指定文档，并查看 Cordis `v4.0.0-rc.12` 的 `fiber.ts`、`utils.ts`、`context.ts`，以及上游主线的服务和事件源码。当前环境 `curl` 无法连通代理；未能对固定版本的全部源码或 npm 制品做运行时实验。未修改文件、使用 Git 或启动子 agent。