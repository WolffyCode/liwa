# 00 插件机制底座（kernel）

状态：**已确认**（2026-10-29，决策 33）。四份评审（Codex gpt-6-astra、Codex gpt-6.1-terra、Fable 5.1、Opus 5.5）的意见已逐条处理，处理记录在 `../../handoff.md`"评审意见的处理"。这是"万物插件化"的底座：所有模块都按插件的形状写、经同一套装配流程装进本体；内核模块 required 且不可替换。协议规范在 `00-contracts.md`，仓库结构在 `../../engineering.md` §4。依据：`../../research/2026-10-28-plugin-architecture.md`（DSH、Cordis、OpenClaw 的机制与 D1–D7）；cordis `4.0.0-rc.12` 源码（`packages/core/src/{registry,fiber,events,reflect,service,context,logger}.ts`）；`../overall.md` §3、§9、§11、§12；决策 17、29、30。

标注：〔源〕cordis 源码核对过；〔推理〕设计判断。

## 0 一页结论

- **运行时用上游 `cordis`，精确钉 `4.0.0-rc.12`**，升级要过本稿 §12 的全部测试。它提供插件（`name`、`Config`、`inject`、`apply(ctx, config)`）、按键挂载的服务、声明式依赖、可撤销的 effect、fiber 状态机、`isolate`、五种事件分发；`Config` 认 Standard Schema，zod 4 直接能用。〔源〕
- **cordis 不出 kernel。** 插件拿到的 `KernelContext` 是 kernel 自建的冻结对象，cordis 的 ctx 只活在闭包里；服务实例在 provide 之前冻结；`emit` 只给 kernel。原因〔源〕：cordis 的 ctx 能经 `internal/get` 拦截全进程的服务访问、经 `registry.replace` 换掉任意插件、经全局 `Symbol.for('cordis.root')` 拿到根上下文，拿到 ctx 就等于拿到一切。
- **信任边界是模型与外界，不是插件与内核。** 所有插件都是一方代码（仓库内、开源、本机自用），对内核完全可信（决策 32）。底座做的检查是防错不是防恶：required 由组合根 `apps/liwa` 以代码传给 `startKernel`（简单、不靠 manifest 自报），profile 只能给它们配 `config`；种类按解析后的真实路径推导（`packages/plugins/*` = builtin 进程内，`$LIWA_HOME/plugins/` = external 进程外），只为知道代码在哪、要不要进程外做故障隔离；本机层的 patch 第一版只许改 config、禁用、改绑定，为的是装配可复现。
- **插件对内核开放，写经所有者。** 插件可以 inject 任何服务：读所有账本的查询 API、订阅经历流、用 procs 与 abilities，逻辑信息不残缺；写只能经各账本的写 API，不直接追加经历流、不替别的模块写它的表。这是"每样数据只有一个写入方"的工程纪律，为的是校验集中和可回放，不是隐私：隐私只在两处管，给某个在场装上下文时按受众裁（context），对外投递时按受众查（outbox）。槽位门面分两份：提供方用 `provide`，宿主与 required 用 define、bind、plan、resolve。
- **装配 = profile 叠 patch，启动分五个阶段：** 计划校验 → 注册 → 恢复 → 槽位就绪 → 开放业务。宁可不起，不带病起；required 任一环失败即退出；builtin 失败只禁用，除非它填的槽位被某个在装的服务声明为必需。
- **每个 profile 属于一个阶段集合**（`m0`、`m1`、`v1`）：集合规定该阶段必须在装的 required 模块和必需槽位，patch 不能削减。m0 只装最小链路，不用先写完整套账本。
- **方法形状在机制层定死**（见 `00-contracts.md` §2）：槽位方法一律异步、首参是调用上下文、只传 JSON、对象句柄有专门的写法、静态描述进 manifest。第一版用"回环编解码测试"证明契约出得了进程；IPC 宿主的运行时推迟到第一个真正的进程外插件。
- **回放要求落到 kernel**：挂钟、单调钟、定时器分开注入；随机源按（种子, 标签）分流、可从状态恢复；编号由 kernel 发；业务代码不得直接用系统时钟与随机。

## 1 范围与边界

**管什么**：cordis 的封装与钉版；manifest 的解析与校验；profile 与 patch 的叠层；静态服务图与装载顺序；五阶段启动与逆序关闭；槽位注册表、基数、按成员绑定与"必需槽位"检查；受限门面与视图；effect 的登记与释放；`ready` / `drain` / `health` 钩子；时钟、随机、编号的注入；密钥引用的解析；`dump-config` 与装配树哈希；kernel 事件与日志；测试内核；进程外插件的 IPC 宿主（kernel-1，推迟）。

**不管什么**：各槽位的业务契约（`00-contracts.md`）；子进程的拉起与杀进程树（procs 提供，kernel 调用）；插件的安装与更新界面（V2 以后，经 gateway 的主人接口）；操作系统级沙箱；前端的界面槽位（console 内部）；业务事件（走经历流）；安全模式页（组合根 `apps/liwa` 自己实现，不经 kernel）。

**和谁打交道**：`apps/liwa`（组合根：传 required、阶段集合、logger、secrets、clock、rng）、procs（进程外插件）、journal（启动完成后写 `kernel.*.v1` 事件）、gateway（插件页只读 `AssemblyPlan`）、contracts（manifest schema、版本表、视图表、IPC 信封）。

## 2 概念

| 概念 | 定义 |
| --- | --- |
| 插件 | 一个带 `liwa` 字段的 npm 包，入口模块**具名导出** `export const plugin = definePlugin({...})`（loader 只读 `mod.plugin`，出现默认导出即拒绝，这是 DSH 复盘 0001 的坑）。一包多插件时 `liwa.plugins[]` 列出各自的 id、入口、服务键 |
| 种类 | `required`：`@liwa/core`（以及 kernel 自带的 `ipc-host`）里的全部插件，永远装、永远进程内、不可替换；其中九样是三条硬规矩所在（宿主、journal、账本、行动管线与准入、回合调度、令牌与工具端点、接入与鉴权、主人身份与控制项、受众与地方键计算），身的动力学也在 core、不做槽位。`builtin`：`packages/plugins/*`，进程内。`external`：`$LIWA_HOME/plugins/`（以后主人自己装的仓库外插件），进程外只为故障隔离，不是信任分级；第一版没有。`data`：纯数据的内容包（`social.pack`、`persona.template`），只校验 schema，不 `import()` |
| 服务 | 挂在上下文上的键（`journal`、`memory`……），只有 required 插件提供（`defineService`）；required 之间按 `consumes` 互用 |
| 视图 | 进程外插件能经 IPC 反向调用的内核方法清单（`PLUGIN_VIEWS`，带版本；IPC 需要可枚举的方法）；进程内插件直接拿服务接口，不受此限 |
| 槽位 | 一项可替换能力的名字，有基数、作用域、契约版本、必需性（`requiredBy`）；提供方登记，消费方解析 |
| 阶段集合 | 发行版定义的 `m0` / `m1` / `v1`：各阶段必须在装的 required 插件 id 与必需槽位；profile 声明自己属于哪个阶段 |
| profile / patch | YAML 装配清单与其增删改；四层叠加（§4） |
| 装配树与哈希 | loader 的最终结果：有序条目、各包版本与内容摘要、config（密钥只取引用）、绑定、契约版本；哈希写进 `kernel.started.v1`，L1 回放靠它判断"同一套装配" |
| fiber | cordis 给每个插件实例的句柄；状态 PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED，出错 FAILED；依赖消失时回到 PENDING，依赖回来会**重新执行 apply**〔源〕 |

## 3 manifest

### 3.1 第一版的最小字段

```json
{
  "name": "@liwa/plugin-brain-claude",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./dist/index.js", "./package.json": "./package.json" },
  "liwa": {
    "manifestVersion": 1,
    "id": "brain-claude",
    "kind": "builtin",
    "provides": { "brain.provider": { "contract": 1, "impl": "claude", "meta": { "personaInjection": "system_prompt" } } },
    "consumes": { "procs": 1 },
    "multiInstance": false
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `manifestVersion` | 等于 `MANIFEST_VERSION`（1），否则拒绝 |
| `id` | `^[a-z][a-z0-9-]{1,40}$`，全局唯一 |
| `kind` | 只用来和 loader 推导出的种类核对，不符即拒绝；`required` 的资格由组合根传入决定，不由 manifest 决定 |
| `provides` | 槽位名必须在 `SLOT_DEFS`；`contract` 等于 `CONTRACT_VERSIONS[槽位]`；`impl` 在该槽位内唯一；`meta` 是该槽位契约声明的静态描述（替代运行时 `describe()`） |
| `consumes` | 键 ∈ `SERVICE_KEYS`（进程内插件可消费任何内核服务），值 = 服务 API 版本；进程外插件只能列 `PLUGIN_VIEWS` 里的方法。入口的 `inject` 必须 ⊆ `consumes`（导入后再核） |
| `plugins[]` | 一包多插件：`[{ id, entry, service?, provides?, consumes? }]`；`service` 只许 required 用，loader 据此在导入前建静态服务图 |
| `multiInstance` | 为 true 时 profile 条目可用 `as:` 改 impl 名装多份（ACP 接多个 CLI） |
| `exports` | 必须含 `"./package.json"`，否则按包名读不到 manifest |
| `resources` | 进程外插件的资源预算（kernel-1 再定：`maxRssMb`、`cpu`、`logMbPerDay`） |

推迟或删去：`process`（由种类推导）、`platforms`（只有 darwin）、`configSchema`（装载时用 zod 校验即可，设置页需要时再 `z.toJSONSchema`）、`client`（随 08）、`notices`（许可证元数据，CI 规则"有 `src/paseo/` 就必须有 NOTICE"）。

### 3.2 入口模块

```ts
import { definePlugin, z } from '@liwa/kernel';          // z 由 contracts 统一 re-export，避免多份 zod

export const Config = z.strictObject({ maxTurns: z.number().int().min(1).default(200) });   // 同步校验；不许 async refine / 会抛异常的 transform〔源：cordis 只接受同步 validate〕

export const plugin = definePlugin({
  id: 'brain-claude',
  Config,
  inject: ['procs'] as const,
  async apply(ctx, config) {                                 // 只做登记，不做 I/O，不 resolve 槽位
    const client = createClaudeBrain({ spawn: ctx.services.procs.spawn, log: ctx.log, clock: ctx.clock, config });
    ctx.slots.provide('brain.provider', 'claude', client);   // 只能提供 manifest 里声明过的槽位
  },
  async ready(ctx) { /* 对外接活、定时器、订阅都在这里开 */ },
  async drain(ctx, deadline) { /* 关闭的第一步：停接新活、等在途 */ },
  async health() { return { ok: true }; },
});
```

`definePlugin` 把 `name: id` 交给 cordis（否则重复注册的报错里只写 `root`）；把 `apply` 包成 kernel 的门面调用；返回的对象带 kernel 的标记，loader 核对 id 与 manifest 一致。required 插件用 `defineService(key, { inject, Config, async create(ctx, config) })`：工厂先 `await` 再 `provide`，实例冻结后发布；非 required 包里出现 `defineService` 的产物即拒绝。

## 4 profile 与 patch

### 4.1 profile

```yaml
# profiles/m0-terminal.yml
id: m0-terminal
stage: m0                                   # 阶段集合，决定必须在装的 required 与必需槽位
plugins:                                    # 有序；required 条目只允许 config，带 package 即拒绝
  - id: brain-claude
    package: "@liwa/plugin-brain-claude"
    config: { maxTurns: 100 }
memberDefaults:                             # 对所有成员生效的部署默认；成员由 roster 在运行时创建
  slots:
    memory.engine: default                  # m0 不装 memory 账本，这行可省
```

- 大脑的**有效绑定不在 profile**：每个成员 × 用脑种类（慢想可按触发类别）用哪个 impl、哪个模型、备用名单，是 roster 的大脑配置（`overall.md` §2.3、§6.9），走配置事件、运行时生效；brains 在运行时解析，kernel 只校验引用到的 impl 已装。profile 里 `brain.provider` 只需要列出哪些 impl 可用。
- 需要重启才能换的槽位（`memory.engine`、`growth.engine`、`social.model`）：主人在设置面改了，由主人接口写 `$LIWA_HOME/profiles/<id>.owner.yml`（同时记一条配置事件备查），作为一层文件 patch，保证第 1 阶段读得到。

### 4.2 patch

```yaml
- replace: { id: brain-claude, config: { maxTurns: 50 } }       # 整个 config 替换，不深合并
- disable: { id: ability-embed-local }
- bind:    { slot: memory.engine, impl: default }                 # 写入 memberDefaults；带 member: 则是按成员覆盖
```

四层叠加（后者覆盖前者）：profile 文件 → 本机 `$LIWA_HOME/profiles/<id>.patch.yml` → 主人文件层 `<id>.owner.yml` → 命令行 `--patch`。规则：`insert` / `remove` / `replace.package` 只在仓库内的 profile 文件里允许（第一版不开放 patch 装新包；`extends` 不做）；`enable` 用来撤销低层的 `disable`；`replace` / `disable` / `enable` 指向不存在的 id 报错；同一层内重复出现同一 id 报错；`bind` 的 impl 必须在条目表里、enabled 且 manifest `provides` 含该槽位；required 不能被 `disable`；有序槽位（registry、list）的绑定写成数组 `ability.embed: [local, siliconflow]`。`$LIWA_HOME/profiles/` 列入 CLI 沙箱拒绝读写的目录（overall §11.9），防止一只带 shell 的手改装配。

### 4.3 `dump-config`

`pnpm dump-config --profile m0-terminal [--patch f] [--json]`：只跑第 1 阶段，不导入业务代码。输出 `AssemblyPlan`（schema 在 contracts）：每个条目（id、包、版本、内容摘要、种类、状态、来自哪一层、禁用原因）、静态服务图（提供方、消费方、拓扑序、缺失与成环）、每个槽位（基数、提供方、各成员绑定、必需性是否满足）、装配树哈希。密钥只出现引用。它是**静态计划**：大脑的有效绑定在 roster 里，主控台"插件"页把这份 JSON 和 roster 的有效绑定并排展示。

## 5 启动与关闭

### 5.1 五个阶段

| 阶段 | 做什么 | 失败时 |
| --- | --- | --- |
| 1 计划校验 | 读 profile 与四层 patch；对每条解析包（以组合根的 URL 为解析根）、读 `package.json`、按 `realpath` 推导种类并与 manifest 核对、zod 校验 manifest、比对契约与视图版本；用 `plugins[].service` 与 `consumes` 建**静态服务图**：缺提供方、重复提供、成环当场点名；required 的装载顺序取拓扑序；槽位计划按基数检查；阶段集合检查：本阶段必须在装的 required 都在、必需槽位都有提供方 | 任一项失败即退出，指出文件、层、条目 |
| 2 注册 | 按拓扑序 `import()` 入口、核对 `mod.plugin.id`、`inject ⊆ consumes`、解析密钥引用、`ctx.plugin(plugin, config)`；`apply` 只许登记，并收到一个 `AbortSignal`。required 的 fiber 必须在 `startupTimeout`（默认 20 秒）内 ACTIVE，否则列出每个未就绪插件缺的键后退出；就绪用 `fiber.state` 判断，不用 `await ctx.plugin()`〔源：`fiber.await()` 在 PENDING 时立即返回且不报错〕。builtin 的 `apply` 抛错：FAILED、禁用、警告；builtin 超时：触发 signal、该代的后续登记一律拒绝（代际失效），不能确认它已停下来（同步死循环）就按整体失败退出，不宣称能"杀掉"一个进程内插件 | required 失败即退出 |
| 3 恢复 | journal 的日志恢复（被打断的回合、结果不明的副作用）、procs 清孤儿、迁移、异步投影追上（`overall.md` §12.1 的 1–4 步），由对应 required 插件的 `recover` 钩子按拓扑序执行 | 失败即退出 |
| 4 槽位就绪 | 核对**实际登记**与 manifest 声明一致；`requiredBy` 的槽位（`memory.engine` ← memory、`growth.engine` ← self、`brain.provider` ← brains）在其服务在装时必须有可用实现；可降级槽位（`ability.*`）缺了只记日志 | 必需槽位缺失即退出 |
| 5 开放业务 | 按拓扑序调用 `ready`：gateway 开始接客户端、scheduler 装作业、订阅开始；写 `kernel.started.v1{profile, stage, assemblyHash}`；打印 `dump-config` 摘要 | `ready` 抛错：required 退出，builtin 禁用 |

启动的第一件事是把 cordis 的 logger exporter 接到注入的 `Logger`，并订阅 `internal/status`：required 的 fiber 进入 FAILED 或离开 ACTIVE 即致命〔源：cordis 默认把 `apply`、effect 释放、监听器里的异常交给 `ctx.logger.error`，而默认 exporter 只写 1000 条的内存缓冲，不接就是静默失败〕。

### 5.2 关闭

SIGTERM 或主人"排空后重启"→ 全局截止 45 秒（launchd `ExitTimeOut` 不小于它，到点直接 `process.exit`）→ 按逆拓扑序调用 `drain(ctx, deadline)`：停接新回合，minds 等在跑的回合到安全点 → kernel 逐个 `await fiber.dispose()`（逆序；不能依赖 cordis 的并发释放〔源：同一 fiber 的释放用 `Promise.all`〕）→ procs 在自己的 dispose 里杀进程组 → 退出码 0。非 0 退出计入启动失败预算。

### 5.3 运行时崩溃与安全模式

- 进入插件代码的每个入口（apply、ready、effect、timer、监听、IPC 回调）用 `AsyncLocalStorage` 标上插件 id；未处理异常先记 id 再退出。同一个 builtin 连续导致崩溃 3 次，下次启动按 §6 的必需性自动禁用（只限可降级的槽位）并通知主人。
- 启动失败计数写 `$LIWA_HOME/run/boot.json`（不进库，库坏了也能数）；连续失败达到预算后，组合根起一个不经 kernel 的极简安全页：最近失败的插件与原因、日志、写本机 patch 禁用某个 builtin、从备份恢复。

## 6 槽位注册表

### 6.1 定义

```ts
interface SlotDef {
  name: string;                                                 // SLOT_DEFS 里显式列出每个具体槽位名（ability.embed、ability.speech……），不做模式匹配
  cardinality: 'bound' | 'member-single' | 'list' | 'registry' | 'single' | 'chain';   // 第一版只实现前四种
  scope: 'global' | 'member';
  contract: number;
  transport: 'any' | 'in-process';                              // 'any' 的契约必须满足 contracts §2 的全部方法形状规则
  requiredBy?: ServiceKey;                                      // 该服务在装时，槽位必须有可用实现
}
```

| 基数 | 含义 | 第一版 |
| --- | --- | --- |
| `bound` | 多个并存；有效绑定由所属服务在运行时解析（`brain.provider` 由 roster 的大脑配置给出） | 做 |
| `member-single` | 每个成员恰好一个（`memory.engine`、`growth.engine`、`social.model`） | 做 |
| `list` | 无序多个（`job.trigger`、`toolport.tool`） | 做 |
| `registry` | 按 key 登记、消费方按有序绑定做回退链（`ability.*`） | 做 |
| `single`、`chain` | 全局恰好一个；有序依次询问 | 定义保留，实现等第一个消费方 |

### 6.2 三份门面

```ts
interface HostSlots   { define(def: SlotDef): void; bind(scope, slot, binding, layer): void; plan(): SlotPlan; resolve<T>(slot, q): T; resolveAll<T>(slot, q?): T[] }  // 只有 kernel 与 required
interface ProviderSlots { provide(slot, impl, instance): () => void; provideFactory(slot, impl, make: (member) => unknown): () => void }                                   // builtin 拿到的；只能提供 manifest 声明过的槽位
```

规则：`resolve` 解析不到抛 `LiwaError('unavailable')`，不返回 undefined；返回的是**带代际的句柄**（提供方重启或失效后旧句柄一律失败），消费方不得跨调用缓存实例；同一槽位同一 impl 登记两次、`member-single` 一成员两绑定、required 服务键被第二次 provide（cordis 会抛 `service "x" has been registered at <fiber>`〔源〕）都是装载期错误并点名两方；`provideFactory` 第一版只有一个成员，接口保留、不实现隔离。

## 7 门面与写入纪律

```ts
export interface KernelContext<I extends ServiceKey> {
  readonly pluginId: string;
  readonly clock: Clock; readonly rng: Rng; readonly ids: Ids; readonly log: Logger;
  readonly services: Pick<Services, I>;      // 按 inject 收窄；任何插件都可以 inject 任何服务键
  readonly slots: ProviderSlots | HostSlots;  // builtin 拿 ProviderSlots，required 拿 HostSlots
  effect(run: () => (() => void | Promise<void>) | void, label?: string): () => Promise<void>;
  on<K extends keyof KernelEvents>(name: K, listener: KernelEvents[K]): () => void;   // 没有 emit
}
```

- **信任边界是模型与外界，不是插件与内核**（`overall.md` §11.1；决策 32）。所有插件都是一方代码：仓库内、开源、本机自用。所以插件对内核是**开放的**：可以 inject 任何账本的服务读它的查询 API、订阅经历流、用 procs 与 abilities；引擎需要什么上下文就自己读，不必等账本推，逻辑信息不会残缺。
- 约束只有工程纪律，为的是校验集中和可回放，不是隐私或安全：
  1. **写只经所有者**：每样数据只有一个写入方（`overall.md` §2.3）。插件不直接 `append` 经历流（给插件的 `Journal` 接口只有 read、subscribe、putPayload），要写就调所属账本的写 API（`memory.propose`、`skills.learn`……），由账本校验、落事件类型。
  2. **主人令牌**：删载荷、改出生设定、绑定账号、换大脑、恢复熔断这些主人专属操作要带 gateway 鉴权后签发的 `OwnerToken`；防的是模型与会话冒充主人（`overall.md` §11.6），不是防插件。
  3. **受众只由 people 造**（`AudienceRef` 是 branded 类型），受众裁剪只在两处发生：给某个在场装上下文时（context）和对外投递时（outbox）。这是"对外说话的隐私"，和内部读取无关：夜里整理、引擎打分看到的是全部。
  4. **cordis 不出 kernel**：门面是冻结对象、服务实例 provide 前冻结、没有 `emit`；防的是 API 漂移和误改别人的服务。
- 槽位门面分两份：builtin 拿 `ProviderSlots`（只能提供 manifest 声明过的槽位），required 拿 `HostSlots`（define、bind、plan、resolve）。消费槽位实现的永远是账本或编排这些 required 模块。

## 8 生命周期、effect、时钟与随机

- `apply` 只登记；`ready` 才接活；`drain` 先停新活。凡登记回调的服务方法都返回释放函数，调用方必须包进 `ctx.effect`（ESLint 覆盖 `subscribe`、`registerProjection`、`on`）；禁止裸的 `setInterval`、`process.on`、`fs.watch`。
- 第一版不做热重载：改 profile、换插件、改契约版本都走"排空 → 重启"。释放函数从第一天写。
- 消费方只 `inject` 服务键，槽位实现经 `resolve` 取，所以槽位实现消失不会触发 cordis 的级联卸载；required 服务永不消失。
- **时钟**：`Clock { wall(): { iso: string; ms: number; tz: string }; mono(): number; timer(ms, fn): () => void }`。`timer` 只给基础设施（超时、看门狗、探活），业务上的周期性工作走 scheduler 作业（决策 18）。L0 回放时是假时钟。
- **随机**：`Rng { next(): number; fork(label): Rng; state(): string; static fromState(s): Rng }`，`fork` 只由（种子, 标签）决定；`ctx.rng = root.fork('plugin:' + id)`，加减插件不改变别人的序列；每天的种子进系统流（overall §6.2）。
- **编号**：`ctx.ids.next(prefix)`，会话号、回合号、调用号都从这里来，录放按它匹配。
- ESLint 禁止：`Date.now`、无参 `new Date()`、`performance.now`、`Math.random`、`crypto.randomUUID` / `getRandomValues`；`setTimeout` / `setInterval` 只许 kernel 与 procs 用。

## 9 配置与密钥

- profile 的 `config` 只放部署参数（路径、开关、适配器级限额），改文件、重启生效；凡是主人能在主控台改的（模型、家规、预算、作息、绑定），都是所属模块的配置实体，走配置事件，插件经服务读取。
- 密钥引用写成 `{ "$secret": "keychain:liwa/deepseek" }`，kernel 在第 2 阶段把 config 交给插件前才解析（钥匙串 → `secrets.env`），`dump-config`、日志、装配树哈希里只出现引用；引用解析不到：required 失败退出、builtin 禁用；进程外插件只经环境变量拿到它声明过的密钥。`startKernel` 的 `secrets` 是注入点。安全令牌（会话令牌、IPC nonce）用独立的密码学随机源，不用可回放的 `Rng`。

## 10 进程外插件（kernel-1，推迟到第一个真正的进程外插件）

第一版只落 contracts 的 IPC 信封（`00-contracts.md` §10），宿主运行时等第一个真用户（本地嵌入退回 Python 服务时，或 V2 的微信适配器）。到时按下面做，不再重新设计：

- IPC 宿主做成 `@liwa/kernel#ipc-host` 这个 required 插件（inject `procs`、`journal`），装在 procs 之后；进程外插件永远不能是 required。
- 传输走 **fd 3 管道**（`stdio: ['ignore','pipe','pipe','pipe']`），stdout、stderr 都当日志（Python 模型库和 llama.cpp 会往 stdout 打进度条）；收到非 JSON 行计数告警不崩。
- 握手：宿主发请求 `kernel/hello{ kernelVersion, ipcProtocolVersion, contracts }`，插件的**响应**带 manifest 回显与 pid，宿主只信磁盘上读到的 manifest、回显只做比对；stdio 下不做令牌（父子管道别的进程写不进），令牌与 nonce 的 HMAC 留给以后的套接字传输。
- 反向调用的方法清单就是 `PLUGIN_VIEWS`（IPC 需要可枚举的方法），方法名 `kernel/view.<视图>`；作用域（成员、绑定）由宿主注入。
- 取消：`$/cancel{ id }` 对任意请求有效（一键暂停和总闸要中止所有在途调用）；流用请求 id 作流 id；`$/ack` 是通知，`kernel/ping` 是请求。
- 资源：manifest `resources` 给 RSS、CPU 档位、日志限额；procs 采样 RSS 超限即杀并计入熔断；后台插件用 `taskpolicy -b`；在途请求上限 64、流每 256 条要 ack、单行 1 MiB（向量用 base64 的 Float32 或声明单批上限）。
- 大对象走 `$LIWA_HOME/ipc/<id>/` 的临时目录加 TTL，不进经历流的 blob 库。
- 崩溃或判死：重启退避 1、5、30 秒；10 分钟 3 次熔断；恢复经主人接口、写 `plugin.circuit_reset.v1`。
- 进程外只为故障隔离（原生代码的段错误、第三方协议栈的内存泄漏与崩溃），不是信任分级：所有插件都是一方代码（决策 32）。
- 取消是请求不是完成证明：涉及外部动作的调用超时按"结果不明"处理，只对 actions 里有幂等键的动作重做；流要有未确认窗口（条数与字节）、队列满即拒绝、断连即清理。

## 11 kernel 的公开 API

```ts
export function definePlugin<S extends ZodType, I extends ViewKey | ServiceKey>(def: {
  id: string; Config?: S; inject?: readonly I[];
  apply(ctx: KernelContext<I>, config: z.output<S>): void | Promise<void>;
  ready?(ctx: KernelContext<I>): Promise<void>; drain?(ctx: KernelContext<I>, deadline: number): Promise<void>; health?(): Promise<{ ok: boolean; reason?: string }>;
}): PluginDef;
export function defineService<K extends ServiceKey>(key: K, def: { inject?: readonly ServiceKey[]; Config?: ZodType; create(ctx, config): Promise<Services[K]>; recover?(ctx): Promise<void>; ready?; drain?; health? }): PluginDef;
export function startKernel(opts: { root: URL; home: string; profile: string; patches?: string[]; required: PluginDef[]; stageSets: StageSets; logger: Logger; secrets: SecretResolver; clock?: Clock; rng?: Rng; startupTimeoutMs?: number }): Promise<KernelHandle>;   // KernelHandle: { plan: AssemblyPlan; shutdown(reason): Promise<void> }
export function dumpConfig(opts: { root: URL; home: string; profile: string; patches?: string[]; required: PluginDef[]; stageSets: StageSets }): Promise<AssemblyPlan>;
export function createTestKernel(opts: { root: URL; profile: ProfileDoc; required?: PluginDef[]; fakeServices?: Partial<Services>; clock?: Clock; rng?: Rng; resolve?: (pkg: string) => Promise<{ manifest, module }> }): Promise<KernelHandle>;   // 走同一段第 1–5 阶段代码；只有它能替换 required
```

kernel 事件（进程内，斜杠风格，只有 kernel 能 emit）：`kernel/started`、`plugin/loaded`、`plugin/disabled`、`plugin/failed`、`plugin/circuit-open`、`slot/bound`；写进经历流的对应 `kernel.started.v1`、`plugin.disabled.v1`、`plugin.failed.v1`、`plugin.circuit_open.v1`、`slot.bound.v1`（系统流，受众 `AUDIENCE_OWNER`），journal 就绪前先缓冲。

## 12 测试

- 测试内核吃"包路径加内存 profile"，与 `startKernel` 走同一段代码；`@liwa/testkit`（依赖 contracts、kernel）放假时钟、计数器随机、编号源、服务假实现、录放大脑（它本身是一个 `brain.provider` 实现，M1 就把"换实现"真走一遍）。
- **回环编解码**：测试里给所有进程内槽位调用套一层"JSON 往返加 schema 校验"，第一版不建 IPC 宿主也能证明契约出得了进程。
- 反例必须覆盖：配置错误类——路径与 manifest 种类不符、同 id 或同服务键重复声明、required 条目带 package、`inject ⊄ consumes`、默认导出、Config 用了 async refine；纪律类——插件试图直接追加经历流（类型与运行时都拒绝）、主人操作没有主人令牌；运行类——必需槽位的实现初始化失败、依赖消失与恢复（fiber 回到 PENDING 再 ACTIVE）、异步清理顺序、超时后迟到的登记被拒、进程重启后的旧句柄、超时但副作用已发生、随机源恢复、损坏配置下的恢复入口。
- T1 manifest 坏值；T2 契约与视图版本不符；T3 patch 动 required、本机层 insert 被拒并指出层与条目；T4 四种基数的冲突与缺绑定；T5 静态服务图缺提供方、成环、required 超时并列出缺项；T6 `drain` 顺序、effect 释放、关闭后无残留定时器与子进程、45 秒截止；T7 `dump-config` 快照稳定、脱敏、哈希输入完整；T8 两个假插件装进 `m0-terminal` 并经 `ready` 接活；T9 回环编解码对第一批契约全部通过；T10 测试内核与真实 loader 行为一致；T11 假时钟驱动超时与重启退避；T12 异常能定位到插件 id、连续崩溃自动禁用。

## 13 第一版范围

- **kernel-0（m0 之前，约 3 天）**：门面与视图、manifest 最小集、profile 与四层 patch（replace.config、disable、bind）、五阶段、静态服务图、四种基数、`requiredBy`、effect、ready / drain / health、时钟随机编号、密钥引用、`dump-config` 与 `AssemblyPlan`、测试内核与 testkit、回环编解码、安全模式页（组合根）。
- **kernel-1（第一个进程外插件出现时）**：§10 全部。
- 以后：热重载、安装仓库外的插件（精确版本与内容哈希、回滚）、`single` / `chain`、`provideFactory` 的隔离、第三方界面、`ctx.storage.derived`（插件私有派生数据的命名空间存储，经 journal 的异步投影写入保持单写者）、同一引擎按成员不同配置（`as:` 多实例）、新槽位的注册协议。
- "装上一个就好一个"在第一版的含义是**给已有的标准槽位增加实现**；要加一种新槽位，先改 contracts、升版本，再加实现。

## 14 待实测

cordis `4.0.0-rc.12`：`FiberState` 是 `const enum`，`tsx` / `isolatedModules` 下跨包引用是否拿得到运行时值；zod 4 的 Standard Schema 与 `resolveConfig` 的配合（同步校验、错误信息）；`AsyncLocalStorage` 标 id 的开销；pnpm 下以组合根为解析根的动态 `import()`；关闭 45 秒截止与 launchd `ExitTimeOut` 的配合。

## 15 依据

cordis 4.0.0-rc.12 源码（插件形状、`provide` / `get`、`inject` 未声明即抛、effect 四种返回、fiber 六态与 PENDING 重跑 apply、`await()` 只等 inertia、`_unload` 的 `Promise.all`、`internal/get` 与 `registry.replace`、全局 `Symbol.for`、同步 `~standard.validate`、默认 logger exporter 只进内存缓冲、重复注册报错含 fiber 名、`emit` 同步且不隔离异常、`serial` 遇非空提前结束）〔源〕；DSH 的 manifest、profile、patch、required 名单、PENDING 静默、复盘 0001、81 条破坏性变更〔一手调研〕；OpenClaw 的 manifest 先于代码、宿主铸造受众〔一手调研〕；JSON-RPC 2.0〔一手〕；内核九样与信任分档〔`plugin-architecture` D1、D6、D7〕；四份评审报告 `research/2026-10-29-review-kernel-{codex-astra,codex-terra,fable,opus}.md`；决策 17、29、30、31、32。

## 16 和 DSH 的插件化对照

主人问"DSH 插件化到什么程度，我们够不够丰富"。按 `plugin-architecture` §2.1 的一手调研对照：

| 扩展点 | DSH | 灵鲸 | 评价 |
| --- | --- | --- | --- |
| 模型 / 大脑 | `ctx.llm` 适配器；`ctx.subagents`（codex、claude-code、acp、dsh-sdk） | `brain.provider`：**一个 CLI 一个插件**（claude、codex、acp；ACP 用 `as:` 多实例接 Gemini CLI、OpenCode、DSH 自己的 acp profile……） | 对等 |
| 工具 | `ctx.tools.register()`，schema 自动进提示词；执行前瀑布 + 单调守卫 | 内核工具目录与执行在 toolport（required）；`toolport.tool` 贡献槽位 V3 | 故意把执行留在内核：令牌、行动管线、可回放 |
| 技能 | `ctx.skills` 合并技能目录 | skills 账本（做法、偏好、习惯）；V4 她自己写的工具走隔离通道 | 概念不同，不缺 |
| 人设 / 提示词 | 系统提示词段落注册表，persona 可遮蔽甚至整段替换 | 底色与硬规则由 self / context 固定注入；成长引擎只回可变段 | 故意更严（防模型丢底色） |
| agent loop | 是插件，可从配置替换 | 回合调度在 minds（required） | 故意不开：邮箱、容量、换新、回放是硬规矩 |
| 会话日志 / 投影 | 日志是插件；`ctx.sessionProjections` 纯折叠单元 | journal 是 required；投影运行器在内核 | **可加**：投影单元做成 `journal.projection` 槽位（形状照 DSH），成本小 |
| 渠道 | 核心没有 seam，qqbot 自己做全部 | `form.adapter` 槽位 + formhost 托管（V2） | 我们更全 |
| 记忆 | 不是槽位，经 MCP 接外部记忆服务器 | `memory.engine` 槽位 + 账本守不变量 | 我们更全 |
| 成长、关系、人设模板 | 无 | `growth.engine`、`social.model`、`social.pack`、`persona.template` | 我们独有 |
| 能力（听说看画嵌入） | 无统一 seam（看图在渠道插件里） | `ability.*` registry + 有序回退链 | 我们更全 |
| 世界源、作业触发 | 无 | `ability.world`、`job.trigger` | 我们更全 |
| shell / fs / 沙箱提供方 | seam：bash-local / bash-sandbox，Seatbelt、bwrap、Landlock 后端 | 手的 CLI 自带沙箱；workspace、procs 在内核 | **可加**：`sandbox.provider`，等 V4 她自己的工具需要时 |
| 界面 | 72 个 `ui-*` 插件，类型化 slot（single / list / keyed / chain），同页 Cordis | `ui.area.*` / `ui.*` 归 console，V1.1 起；形状借 DSH | 我们晚一步 |
| MCP 客户端 | 通用 MCP 客户端插件 | CLI 自己拉 MCP，本体不经手 | 故意（失败只影响那一次用脑） |
| profile / bundle / patch | 有，含 extends、市场索引 | 有，简化（无 extends、无市场） | 对等 |
| 热重载 | Web profile HMR | 无，排空重启 | 以后 |
| 插件市场 / 安装 | 自配索引、钉版本、无签名 | 无，都在仓库里（决策 32） | 不需要 |
| 对外当 agent | `acp` profile 可被编辑器当 ACP agent 调用 | 可选 `liwa acp serve`（决策 2） | 以后 |
| 模型自改插件 | `node:vm` 里求值动态定义 | 不做 | 故意 |

结论：槽位的种类我们不比 DSH 少（12 种对它约 8 个 seam），多出来的是记忆、成长、关系、能力、渠道、作业这些"生命"相关的；缺的是界面插件和热重载这两样工程体验；故意不开的是 agent loop、工具执行、提示词整段替换，因为那是硬规矩所在。以后成本很小就能补的两个槽位：投影单元、沙箱提供方。
