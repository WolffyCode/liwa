# 00 插件机制底座（kernel）

状态：**已确认**（2026-10-29，决策 33、35）。这是"万物插件化"的底座：所有模块都按插件的形状写、经同一套装配流程装进本体；内核模块 required 且不可替换。协议规范在 `00-contracts.md`，命令机制在 `00-commands.md`，仓库结构在 `../../engineering.md` §4。依据：`../../research/2026-10-28-plugin-architecture.md`（DSH、Cordis、OpenClaw 的机制与 D1–D7）；cordis `4.0.0-rc.12`（仓库 `node_modules/.pnpm/cordis@4.0.0-rc.12/node_modules/cordis/lib/index.js`，下文行号指它）；四份核实报告 `../../research/2026-10-29-verify-{kernel,contracts,layout,codex}.md`；`../overall.md` §3、§9、§11、§12；决策 17、29–35。

标注：〔源〕cordis 打包产物核对过，带行号；〔一手〕读过本仓库代码或调研原文；〔推理〕设计判断。

## 0 一页结论

- **运行时用上游 `cordis`，精确钉 `4.0.0-rc.12`**，升级要过本稿 §12 的全部测试。它提供插件（`name`、`inject`、`apply(ctx, config)`）、按键挂载的服务、声明式依赖、可撤销的 effect、fiber 状态机、`isolate`、五种事件分发。〔源〕
- **cordis 不出 kernel。** 插件拿到的 `KernelContext` 是 kernel 自建的冻结对象，cordis 的 ctx 只活在闭包里；服务实例在 provide 之前冻结；`emit` 只给 kernel。原因〔源〕：cordis 的 ctx 能经 `internal/get` 拦截全进程的服务访问（`lib/index.js:895`）、经 `registry.delete` 卸掉任意插件（`1468`）、经全局 `Symbol.for('cordis.root')` 拿到根上下文（`55`、`1530`），拿到 ctx 就等于拿到一切。
- **信任边界是模型与外界，不是插件与内核。** 所有插件都是一方代码（决策 32）。底座做的检查是防错不是防恶：required 由组合根 `apps/liwa` 以代码传给 `startKernel`；种类按真实路径推导，只表示代码从哪来；进不进程由 manifest 的 `runtime` 字段声明；本机层的 patch 第一版只许改 config、禁用、改绑定。
- **一个插件可以装多份**（`multiInstance` + `as:`）：每个条目是一个**实例**，实例 id 是全局键；插件在运行时知道自己是哪一份（§3.3）。一个实例在一个槽位只挂一个实现，变体写进 meta（§3.1）。
- **装配 = profile 叠 patch，启动分五个阶段：** 计划校验 → 注册 → 恢复 → 槽位就绪 → 开放业务。每一步有时限（§5.4）；宁可不起，不带病起；required 任一环失败即退出；builtin 失败只禁用，除非它填的槽位被某个在装的服务声明为必需。
- **ready / drain 的顺序含槽位边**：提供方在消费方之前 ready、之后 drain；gateway 最后开门、最先关门（§5.5）。关闭有一个不经 cordis、必定执行的收尾步骤 `finalize`（§5.3）。
- **写经所有者**：插件 inject 任何服务读任何账本，但 `journal` 给插件的是没有 `append` 的只读视图（§7）。
- **回放要求落到 kernel**：挂钟、单调钟、定时器分开注入；随机源按（种子, 标签）分流；编号带启动序号；装配哈希只算有效装配加代码版本（§8、§9）。

## 1 范围与边界

**管什么**：cordis 的封装与钉版；manifest 的解析与校验（含 meta、runtime、命令声明）；profile 与 patch 的叠层与实例身份；静态服务图与槽位边；五阶段启动、逆序关闭与收尾；槽位注册表、基数、按成员绑定、`describe`、"必需槽位"检查；门面与 journal 视图；effect、`on`、timer 随实例释放；代际与 `AbortSignal`；`ready` / `drain` / `health` / `finalize` 钩子与时限；时钟、随机、编号的注入；密钥引用的解析；`dump-config` 与装配哈希；kernel 事件与日志；`AsyncLocalStorage` 标实例；测试内核与回环编解码；进程外插件的 IPC 宿主（kernel-1，推迟）。

**不管什么**：各槽位的业务契约（`00-contracts.md`）；子进程的拉起与杀进程树（procs 提供，kernel 在 `finalize` 里调它）；安全模式页、`boot.json`、连续崩溃计数（组合根 `apps/liwa`，§5.6）；插件的安装与更新界面；操作系统级沙箱；界面槽位（console 内部）；业务事件。

**和谁打交道**：`apps/liwa`（传 required、阶段集合、`bootSeq`、`build`、logger、secrets、clock、rng；调 `finalize`）、procs（`finalize` 杀进程组）、journal（kernel 事件写经历流）、gateway（插件页与 `commands.list` 读 `AssemblyPlan` 与 `describe`）、contracts（schema、版本表、层表、视图表、IPC 信封）。

## 2 概念

| 概念 | 定义 |
| --- | --- |
| 插件 | 一个带 `liwa` 字段的 npm 包，一包一插件；入口模块**具名导出** `export const plugin = definePlugin({...})`（loader 只读 `mod.plugin`，模块自有 `default` 属性即拒绝，哪怕值是 `undefined`） |
| 实例 | 条目表里的一行：实例 id = `as ?? 插件 id`，全局唯一（和任何插件 id、实例 id 都不重）。日志、随机分流、崩溃计数、禁用、绑定核对都以实例 id 为键 |
| 种类 | 代码从哪来，按真实路径推导：`required`（`@liwa/core`，组合根以代码传入）、`builtin`（`packages/plugins/*`）、`external`（`$LIWA_HOME/plugins/`，第一版拒绝）、`data`（纯数据包，只校验 schema，不 `import()`） |
| runtime | 进程内还是子进程：manifest `runtime: 'in-process' \| 'subprocess'`；与种类正交（§3.2） |
| 服务 | 挂在上下文上的键（`journal`、`memory`……），只有 required 提供（`defineService`）；required 之间按 `inject` 互用，方向受层表约束（§5.1） |
| 视图 | 进程外插件能经 IPC 反向调用的内核方法清单（`PLUGIN_VIEWS`）；进程内插件直接拿服务接口 |
| 槽位 | 一项可替换能力：基数、作用域、契约版本、`requiredBy`、`consumedBy`、`Meta` schema（`SLOT_DEFS`）；提供方登记，消费方解析 |
| 阶段集合 | `m0` / `m1` / `v1`：各阶段必须在装的 required 与必需槽位；profile 声明自己属于哪个阶段 |
| 装配树与哈希 | loader 的最终结果（`AssemblyPlan`）和它的哈希（§9.2）；哈希写进 `kernel.started.v1`，L1 回放靠它判断"同一套装配" |
| 代际 | 每次挂载一个实例就是一代：一个 `AbortController`、一组槽位登记、一个 effect 栈；禁用或释放即整代失效（§6.3） |
| fiber | cordis 给每次挂载的句柄；状态 PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED，出错 FAILED；依赖消失回到 PENDING，依赖回来会**重新执行 apply**〔源〕 |

## 3 manifest

### 3.1 字段

```json
{
  "name": "@liwa/plugin-brain-acp",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": { "liwa-source": "./src/index.ts", "default": "./dist/index.js" }, "./package.json": "./package.json" },
  "liwa": {
    "manifestVersion": 1,
    "kernelApi": 1,
    "id": "brain-acp",
    "kind": "builtin",
    "runtime": "in-process",
    "multiInstance": true,
    "provides": { "brain.provider": { "contract": 1, "impl": "acp", "meta": { "streaming": true, "resume": false, "steer": false, "interrupt": true, "nativeTools": true, "permissionHook": true, "rollback": false, "batchEndHook": false, "usage": "tokens", "personaInjection": { "presence": "file" } } } },
    "consumes": { "procs": 1 }
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `manifestVersion` | 等于 `MANIFEST_VERSION`（1），否则拒绝 |
| `kernelApi` | 等于 `KERNEL_API_VERSION`（1），否则拒绝；`data` 包不写 |
| `id` | `^[a-z][a-z0-9-]{1,40}$`；目录名 = `id` = 包名去掉 `@liwa/plugin-` |
| `kind` | 只用来和 loader 推导出的种类核对，不符即拒绝 |
| `runtime` | `in-process`（缺省）或 `subprocess`；`external` 必须 `subprocess`；`data` 不写。§3.2 |
| `multiInstance` | 缺省 false。true：条目表里可以出现多份，每份必须有不同的 `as`；每份各自的 config。false：至多一份，出现 `as` 即拒绝 |
| `provides` | 槽位名 ∈ `SLOT_DEFS`；`contract` = `CONTRACT_VERSIONS[槽位]`；**一个槽位只写一个 `impl`**，变体写进 `meta`（`job.trigger` 用 `meta.kinds` 列 cron / once / interval）；`meta` 在第 1 阶段用 `SLOT_DEFS[槽位].meta` 校验，不合即拒绝（builtin 禁用、required 致命）；`gateway.command` 的 meta 就是命令声明（`00-commands.md` §3.3） |
| `consumes` | 进程内：键 ∈ `SERVICE_KEYS`，值 = `SERVICE_VERSIONS[键]`；子进程：键 ∈ `PLUGIN_VIEWS`，值 = `VIEW_VERSIONS[键]`；混用即拒绝。入口的 `inject` 必须 ⊆ `consumes` |
| `launch` | 只有 `runtime: subprocess` 写：`{ cmd: string; args?: string[]; env?: Record<string, string> }`，工作目录固定为包目录；Python 包写 `{ cmd: 'uv', args: ['run', '--frozen', 'python', '-m', 'liwa_<id>'] }`。形状现在定、第 1 阶段校验，拉起等 kernel-1 |
| `resources` | 子进程必填：`{ maxRssMb, cpu: 'background' \| 'utility', logMbPerDay }` |
| `data` | `kind: data` 必填：`{ slot, file }`，第 1 阶段按槽位的数据 schema 校验文件 |
| `exports` | 必须含 `"./package.json"`；有界面再加 `"./client"`（`engineering.md` §4.3） |

不再有：`plugins[]`（一包一插件；required 的服务图来自组合根传入的 `PluginDef`）、`process`（改为 `runtime`）、`platforms`、`configSchema`、`client`、`notices`。

### 3.2 种类与 runtime 正交

| 种类 \ runtime | `in-process` | `subprocess` |
| --- | --- | --- |
| required | 全部 | 不允许（进程外插件永远不能是 required） |
| builtin | 缺省 | 允许：微信适配器、本地 Python 模型服务都在 `packages/plugins/` |
| external | 不允许 | 必须（第一版拒绝 external） |
| data | 不适用 | 不适用 |

子进程插件的附加检查（第 1 阶段，现在就做）：`provides` 的每个槽位 `transport: 'any'`；`consumes` ⊆ `PLUGIN_VIEWS`；`launch` 与 `resources` 齐全；不 `import()` 入口。**kernel-1 之前**遇到启用的子进程条目：禁用它，原因 `runtime.unsupported`（"进程外插件的宿主尚未实现"），`problems` 记一条 `warn`；它填的槽位若是必需的，第 4 阶段照常判失败。〔推理：和"builtin 失败只禁用自己"同一条规矩，不让一条多余的 profile 行拖死整个本体〕

### 3.3 实例身份

- profile 条目：`{ id: <插件 id>, as?: <实例 id>, package?, config?, disabled? }`。没有 `as` 时实例 id = 插件 id。例：

  ```yaml
  plugins:
    - { id: brain-acp, as: gemini,   package: "@liwa/plugin-brain-acp", config: { cli: gemini } }
    - { id: brain-acp, as: opencode, package: "@liwa/plugin-brain-acp", config: { cli: opencode } }
  ```

- **impl 名 = `as ?? manifest.provides[槽位].impl`**。上例两份实例在 `brain.provider` 上的 impl 分别是 `gemini`、`opencode`；`brain-claude` 没有 `as`，impl 仍是 manifest 里的 `claude`。impl 在槽位内唯一（第 1 阶段按实例核对）。roster 的大脑配置绑 `{ impl: 'gemini' }`，`liwa brain set` 列出的候选就是这些 impl。
- patch 的 `replace` / `disable` / `enable` 的 `id` 指**实例 id**；`insert` 的 `as` 规则同 profile。
- `KernelContext` 暴露 `instanceId`、`pluginId`、`impls: Readonly<Partial<Record<SlotName, ImplId>>>`；`ctx.slots.provide(slot, instance)` **不再传 impl**，kernel 按上面的规则填（插件不可能登记错名字）。
- 以实例 id 为键的：日志 child 绑定 `{ plugin, instance }`、`ctx.rng = root.fork('plugin:' + instanceId)`、`AsyncLocalStorage` 的 store、崩溃计数、禁用、`EntryPlan.id`、`kernel.started.v1.plugins[]`。
- cordis 侧：每个实例一个独立的 cordis 插件对象 `{ name: instanceId, inject, apply }`。〔源〕rc.12 的 `RegistryService.plugin()`（`1489–1507`）按 `apply` 函数复用 runtime、每次都 `new Fiber`（`331–345`），同一对象挂多份是允许的；但 fiber 的 `name` 取自 runtime（`426–432`），同一对象的多份实例在 cordis 的报错里分不开，所以 kernel 给每个实例造各自的对象。

### 3.4 入口模块

```ts
import { definePlugin, z } from '@liwa/kernel';

export const Config = z.strictObject({ cli: z.enum(['gemini', 'opencode']), maxTurns: z.number().int().min(1).default(200) });   // 同步校验；不许 async refine

export const plugin = definePlugin({
  id: 'brain-acp',
  Config,
  inject: ['procs'] as const,
  async apply(ctx, config) {                                 // 只做登记，不做 I/O，不 resolve 槽位
    const client = createAcpBrain({ spawn: ctx.services.procs.spawn, log: ctx.log, clock: ctx.clock, signal: ctx.signal, config });
    ctx.slots.provide('brain.provider', client);             // impl 由 kernel 按 ctx.impls['brain.provider'] 填
  },
  async ready(ctx) { /* 对外接活、定时器、订阅都在这里开 */ },
  async drain(ctx, deadlineMs) { /* 停接新活、等在途 */ },
  async health() { return { ok: true }; },
});
```

`definePlugin` 把 `apply` 包成 kernel 的门面调用；Config 由 kernel 用 zod `safeParse` 同步校验、填默认值，错误成为禁用原因或启动失败原因，不交给 cordis 的 `Config`〔源：`resolveConfig` 只接受同步 validate〕；返回的对象带 kernel 的标记，loader 核对 id 与 manifest 一致。required 用 `defineService(key, { inject, Config, commands?, async create(ctx, config), recover?, ready?, drain?, health?, finalize? })`：工厂先 `await` 再 `provide`，实例冻结后发布（服务对象必须是闭包对象或只有私有字段 `#x` 的类实例，冻结只冻一层）；非 required 包里出现 `defineService` 的产物即拒绝。

## 4 profile 与 patch

### 4.1 profile

```yaml
# profiles/m0-terminal.yml
id: m0-terminal                             # 必须等于文件名；^[a-z][a-z0-9-]{0,40}$
stage: m0
plugins:                                    # 有序；required 条目只允许 config，带 package 即拒绝；同一实例 id 出现两次即拒绝
  - id: brain-claude
    package: "@liwa/plugin-brain-claude"
    config: { maxTurns: 100 }
memberDefaults:                             # 全体成员的部署默认；作用域键是 '*'（MEMBER_DEFAULT_SCOPE），不和任何成员 id 相撞
  slots:
    memory.engine: default
```

- 大脑的**有效绑定不在 profile**：每个成员 × 用脑种类用哪个 impl、哪个模型、备用名单，是 roster 的大脑配置（`overall.md` §2.3、§6.9），走配置事件、运行时生效。按层表，roster 在账本层、brains 在资源层，所以由 minds 读 roster 后把 `{ impl, model, fallback }` 传给 brains，brains 不读 roster（01、02 落）；kernel 只校验引用到的 impl 已装。profile 里 `brain.provider` 只需要列出哪些实例可用。
- 需要重启才能换的槽位（`memory.engine`、`growth.engine`、`social.model`）：主人在设置面改了，由主人接口写 `$LIWA_HOME/profiles/<id>.owner.yml`（同时记一条配置事件备查），作为一层文件 patch。

### 4.2 patch

```yaml
- replace: { id: brain-claude, config: { maxTurns: 50 } }       # 整个 config 替换，不深合并
- disable: { id: ability-embed-local, reason: "crash: 连续崩溃 3 次自动禁用" }   # reason 可选，只用于展示
- enable:  { id: ability-embed-local }
- bind:    { slot: memory.engine, binding: default }              # 写入 '*' 作用域；带 member: 则按成员覆盖
```

四层叠加（后者覆盖前者）：profile 文件 → 本机 `$LIWA_HOME/profiles/<id>.patch.yml` → 主人文件层 `<id>.owner.yml` → 命令行 `--patch`（可多个文件，同属 cli 层）。规则：

| 规则 | 说明 |
| --- | --- |
| 操作范围 | `insert` / `remove` / `replace.package` 只在仓库内的 profile 文件里允许；`extends` 不做 |
| 重复 | 同一层内对同一实例 id 重复操作报错（按层算，不按文件算）；同一层同一 `(scope, slot)` 两次 `bind` 报错；跨层覆盖允许 |
| 目标存在 | `replace` / `disable` / `enable` 指向不存在的实例 id 报错；required 不能 `disable` |
| 有效绑定 | 叠层后按 `(scope, slot)` 只留最后一层的值并记来源层；校验只看有效值：impl 在条目表里、enabled、该实例 `provides` 含该槽位；形状按基数核对（`member-single` / `bound` 给单个 impl 或 `null`，`registry` / `list` 给数组），不对即第 1 阶段报错 |
| `bind brain.provider` | 拒绝（有效绑定归 roster） |
| 空文件 | 解析为 `[]`，不是错误 |
| 密钥 | `$secret` 只认 `keychain:` 与 `env:` 两种方案，其余报错 |
| 沙箱 | `$LIWA_HOME/profiles/` 列入 CLI 沙箱拒绝读写的目录（overall §11.9） |

### 4.3 `dump-config`

`liwa dump-config [--profile m0-terminal] [--patch f] [--json]`：只跑第 1 阶段，不导入 builtin 代码（required 的定义随 `@liwa/core` 被组合根 import，它们本来就是本体的一部分）。输出 `AssemblyPlan`：每个条目（实例 id、插件 id、包、版本、种类、runtime、状态、来自哪一层、禁用原因、各槽位 impl 与 meta、声明的命令）、静态服务图（提供方、消费方、拓扑序、缺失与成环）、每个槽位（基数、提供方、有效绑定与来源层、必需性是否满足）、`build`、`assemblyHash`、`problems`。密钥只出现引用；原因里不出现绝对路径（相对仓库根或 `$LIWA_HOME`）。它是**静态计划**：大脑的有效绑定在 roster 里，主控台"插件"页把这份 JSON 和 roster 的有效绑定并排展示。

## 5 启动与关闭

### 5.1 五个阶段

| 阶段 | 做什么 | 失败时 |
| --- | --- | --- |
| 1 计划校验 | 读 profile 与四层 patch；对每条解析包（以组合根 `apps/liwa` 为 Node 的包解析根，入口经组合根注入的 `(specifier) => import(specifier)` 装载；仓库根缺省从组合根向上找含 `pnpm-workspace.yaml` 的目录；仓库根、`LIWA_HOME`、包目录都先 `realpath`）、读 `package.json`、推导种类并与 manifest 核对、zod 校验 manifest、按 `SLOT_DEFS[槽位].meta` 校验 meta、比对契约 / 服务 / 视图 / kernelApi 版本；实例化条目表（§3.3）；用 required 的 `service` + `inject` 建**静态服务图**：缺提供方、重复提供、成环（含自环）当场点名；**层表检查**：required 的 `inject` 只许指向同层或更低层的服务（`SERVICE_LAYERS`），指向上层即致命；加**槽位边**（§5.5）后再查一次环；槽位计划按基数与有效绑定检查；阶段集合检查：本阶段必须在装的 required 都在、必需槽位都有启用的提供方；命令声明收集与查重（`00-commands.md` §3.3）；连续崩溃自动禁用的候选由组合根在本阶段之前写进本机 patch（§5.6） | 任一项失败即退出，指出文件、层、条目 |
| 2 注册 | 先挂 required：按拓扑序校验 Config、解析密钥引用、挂载；全部 ACTIVE 才往下走；`STARTUP_TIMEOUT_MS` 从本阶段开始计时，覆盖密钥解析、`import()`、等待 ACTIVE 全部等待；超时列出每个未就绪插件在等的服务后退出；就绪用 `fiber.state` 判断〔源：`fiber.await()` 在 PENDING 时立即返回且不报错〕。再按 profile 顺序逐个挂 builtin（在剩余时限内）：`import()` 入口、核对 `mod.plugin.id`、`inject ⊆ consumes`、校验 Config、解析密钥、挂载并等它落定。builtin 的默认导出、Config 不合规范、密钥解析不到、`apply` 抛错、剩余时限内没落定，一律只禁用它自己（§6.3），原因写进计划；禁用时最多等它释放 `DISABLE_DISPOSE_MS`：cordis 不能打断在途的 `apply`，不宣称能"杀掉"一个进程内插件 | required 失败即退出 |
| 3 恢复 | 由 required 的 `recover` 钩子按拓扑序执行：journal 的日志恢复、procs 清孤儿、各模块跑自己 `migrations/` 的迁移、异步投影追上（`overall.md` §12.1）；每个 `RECOVER_TIMEOUT_MS` | 失败或超时即退出 |
| 4 槽位就绪 | 核对**实际登记**与 manifest 声明一致（槽位 + impl + 命令 id 集合）；`requiredBy` 的槽位在其服务在装时必须有启用且绑定可解析的实现；可降级槽位缺了只记日志；此后 `HostSlots.resolve` 才可用（之前调用抛 `unavailable` / `slot.not_ready`） | 必需槽位缺失即退出 |
| 5 开放业务 | 按 §5.5 的顺序逐个调用 `ready`，每个 `READY_TIMEOUT_MS`；builtin 失败或超时 → 禁用 → **重跑第 4 阶段的必需槽位检查**，不满足即启动失败；全部 ready 后 `await journal.append(kernel.started.v1)`（失败即启动失败），再发进程内 `kernel/started`；打印 `dump-config` 摘要 | required 失败退出；builtin 禁用 |

启动的第一件事是把 cordis 的 logger exporter 接到注入的 `Logger`（保留 Error 对象的栈与 cause，不 `String()`），并订阅 `internal/status`：required 的 fiber 进入 FAILED 或离开 ACTIVE 即致命，走关闭流程〔源：默认 exporter 只写 1000 条的内存缓冲，不接就是静默失败〕。`internal/status` 发出的是原始 fiber，而 `root.plugin()` 返回的是 `Object.create(fiber)` 的包装（`1500–1505`、`551`），kernel 以 `Object.getPrototypeOf(wrapped)` 为键记 fiber 身份。

required 的 `create` 在第 2 阶段执行，那时 builtin 还没挂，所以 required 不得在 `create` 里 `resolve` 槽位；要在 `ready` 之后、或每次调用时解析。

### 5.2 关闭

SIGTERM 或主人"排空后重启"→ `shutdown(reason)`：

1. 记 `deadline = mono() + SHUTDOWN_DEADLINE_MS`（45 秒；launchd `ExitTimeOut` ≥ 50 秒，到点直接 `process.exit`）。
2. **drain**：按 §5.5 的逆序逐个 `await drain(ctx, deadlineMs)`，只对已 ready 的实例；每个最多 `min(DRAIN_PER_PLUGIN_MS, DRAIN_DEADLINE_MS − 已用)`，超时只记日志、继续下一个。gateway 第一个 drain（停止接受连接、关闭 WebSocket），minds 等在跑的回合到安全点。
3. **dispose**：按挂载的逆序逐个 `fiber.dispose()`（builtin 先于 required、required 逆拓扑；cordis 释放提供方时要等依赖它的 fiber 先释放〔源：`_unload` 等 `dependents` 清空〕）；每个最多 `min(DISPOSE_PER_PLUGIN_MS, deadline − now)`；**过了 deadline 仍然调用 dispose，只是不再等它**（先同步撤销它的代际，再发起释放）。
4. **finalize**（§5.3）。
5. 返回 `{ outcome: 'clean' | 'timeout', pending: instanceId[] }`；组合根据此选退出码（§5.6）。

### 5.3 必定执行的收尾：`finalize`

- `defineService` 可给同步钩子 `finalize?(): void`。kernel 在 `shutdown()` 的最后、在启动失败的退出路径上、在组合根的未捕获异常处理里（经 `KernelHandle.finalize()`）都按逆拓扑序同步调用它，不经 cordis、不 await、每个包在 try / catch 里（异常只记日志）。
- 第一版只有 procs 实现它：`killAll()`，对登记表里仍活着的进程组发 SIGKILL。这解决的是：卡住的依赖方会让 cordis 永远不释放 procs（`_unload` 先等 `dependents`），进程组就杀不掉（verify-kernel K6〔一手〕）。
- `finalize` 只能做同步、幂等、不依赖别的服务的事；多次调用只执行一次。

### 5.4 时限表（kernel `params.ts`）

| 常量 | 值 | 管什么 | 超时后 |
| --- | --- | --- | --- |
| `STARTUP_TIMEOUT_MS` | 20 000 | 第 2 阶段整体：密钥解析、`import()`、required 全部 ACTIVE、builtin 在剩余额度内落定 | required 未齐：退出并列出缺项；builtin：禁用 |
| `DISABLE_DISPOSE_MS` | 5 000 | 禁用一个 builtin 时等它释放 | 不再等，记日志；代际已先撤销 |
| `RECOVER_TIMEOUT_MS` | 120 000 | 每个 required 的 `recover`（迁移与投影追上可能很长） | 致命 |
| `READY_TIMEOUT_MS` | 10 000 | 每个实例的 `ready` | required 致命；builtin 禁用并复查必需槽位 |
| `HEALTH_TIMEOUT_MS` | 2 000 | 每个实例的 `health` | 记为 `{ ok: false, reason: 'timeout' }` |
| `SHUTDOWN_DEADLINE_MS` | 45 000 | 关闭全局截止 | 过点仍发起 dispose 但不等；finalize；`outcome: 'timeout'` |
| `DRAIN_DEADLINE_MS` | 30 000 | drain 阶段从关闭开始算的截止，给 dispose 留余量 | 跳到 dispose |
| `DRAIN_PER_PLUGIN_MS` | 10 000 | 单个实例的 drain | 记日志、下一个 |
| `DISPOSE_PER_PLUGIN_MS` | 5 000 | 单个实例的 dispose 等待 | 记日志、下一个 |

启动没有总时限：第 2 阶段一个额度，第 3、5 阶段按实例各自计时；`liwa start --wait` 的等待上限由 cli 定（07）。所有值进 kernel 的 `params.ts`（带单位与来源），`StartOptions` 可覆盖 `startupTimeoutMs`、`shutdownDeadlineMs`，测试内核用假时钟驱动。

### 5.5 ready / drain 的顺序：服务边加槽位边

- 图的节点是实例；边有两种：**服务边**（required 的 `inject`：消费方 → 提供方）和**槽位边**（提供某槽位的实例 → `SLOT_DEFS[槽位].consumedBy` 列出的每个在装服务：提供方 → 消费方）。两种边都是静态信息：前者来自 `PluginDef.inject`，后者来自 manifest `provides` 与 contracts 的 `consumedBy` 表，第 1 阶段就能建完并查环。
- **ready 顺序**：被依赖者先。按"提供方在消费方之前"做拓扑排序；同级平局按层表从低到高（基础 → 守护 → 资源 → 账本 → 运行 → 编排 → 接入），builtin 视为它所填槽位消费方的下一层，再按 profile 顺序。所以 procs → brain-claude → brains → minds → … → toolport → gateway；gateway 没有依赖它的节点，固定排在最后（开门）。
- **drain 顺序**：ready 的严格逆序：gateway 先关门，…，brain-claude 最后排空。dispose 仍按挂载逆序（§5.2 第 3 步），两者不同是因为 dispose 受 cordis 的释放约束而 drain 不受。
- 建图时把槽位边当普通边查环：一个 builtin 若 `inject` 了它所填槽位的消费方或更上层的服务，就会成环，第 1 阶段致命并点名。

### 5.6 崩溃、启动失败计数与安全模式（组合根 `apps/liwa`）

**标记插件**：kernel 用一个 `AsyncLocalStorage<{ instanceId, pluginId }>` 包住进入插件代码的每个入口：`apply` / `create`、`recover`、`ready`、`drain`、`health`、`finalize`、effect 的释放函数、`ctx.clock.timer` 的回调、`ctx.on` 的监听器、登记类服务方法的回调（§8.2）、槽位方法调用（消费方调提供方时，kernel 的句柄包装在提供方的 store 里执行）、IPC 回调（kernel-1）。`KernelHandle.blame(): { instanceId; pluginId } | undefined` 读当前 store。

**崩溃**：`process.on('uncaughtException' | 'unhandledRejection')` 只在 `apps/liwa/src/boot/` 登记。处理：`handle.blame()` 定位实例 → 日志带实例 id 与栈 → 更新 `boot.json`（`lastOutcome: 'crashed'`，`crashes[instanceId].consecutive += 1`）→ `handle.finalize()` → `process.exit(EXIT_CRASHED)`。

**`$LIWA_HOME/run/boot.json`**（只有组合根写，原子替换；不进库，库坏了也能数）：

```ts
{ version: 1,
  bootSeq: number,                                   // 每次启动递增，传给 startKernel（§8.3）
  consecutiveFailures: number,                       // 连续 failed / crashed 的次数；started 后稳定 CRASH_STABLE_MS 或干净停止即清零
  lastStartAt: Iso, lastOutcome: 'starting' | 'started' | 'stopped' | 'failed' | 'crashed',
  lastFailure?: { at: Iso; stage?: 1 | 2 | 3 | 4 | 5; plugin?: string; message: string },
  crashes: Record<string, { consecutive: number; lastAt: Iso }>,   // 键是实例 id
  safeMode: { active: boolean; since?: Iso } }
```

组合根 `params.ts`：`CRASH_AUTO_DISABLE_COUNT = 3`、`CRASH_STABLE_MS = 600 000`（启动后稳定 10 分钟清零计数，用注入的 `clock.timer`）、`BOOT_FAILURE_BUDGET = 3`、本体进程退出码 `EXIT_OK = 0`、`EXIT_STARTUP_FAILED = 1`、`EXIT_CRASHED = 2`、`EXIT_SHUTDOWN_TIMEOUT = 3`。

**自动禁用**：启动时组合根先 `dumpConfig`（第 1 阶段）拿计划，对每个 `crashes[x].consecutive ≥ CRASH_AUTO_DISABLE_COUNT` 的 builtin 实例调 `canDegrade(plan, x)`（kernel 导出的纯函数：去掉它之后所有 `requiredBy` 槽位仍有启用的提供方），能降级的就往本机层 `<profile>.patch.yml` 追加 `disable: { id: x, reason: 'crash: …' }`，再 `startKernel`；不能降级的不动（它再崩就进启动失败预算）。禁用落在本机 patch 而不是 `boot.json`，为的是 `dump-config` 看得见、主人在设置页用 `enable`（主人层）就能撤销。通知主人：kernel 写 `plugin.disabled.v1{ id, reason }` 进系统流，`kernel.started.v1.autoDisabled[]` 也列出；V1.0 起 notify 订阅系统流推给主人；m0 只在 `liwa status` / `doctor` 与插件页显示。

**安全模式页**（`apps/liwa/src/safe-mode/`，不经 kernel）：`consecutiveFailures ≥ BOOT_FAILURE_BUDGET` 时不再 `startKernel`，起一个只听回环地址的极简 HTTP 页（纯 HTML，不用 React），m0 做到：显示 `boot.json`、最近一个日志文件的末 200 行、`dumpConfig` 的条目表（状态与原因）；按钮：禁用某个 builtin（写本机 patch）、清零计数并重试（改 `boot.json` 后退出，launchd 拉起）、退出安全模式。"从备份恢复"随 03 的 backup / restore 落。

## 6 槽位注册表

### 6.1 定义（contracts `slots/defs.ts`）

```ts
interface SlotDef {
  name: SlotName;                                               // 显式列出每个槽位名，不做模式匹配
  cardinality: 'bound' | 'member-single' | 'list' | 'registry' | 'single' | 'chain';   // 第一版实现前四种
  scope: 'global' | 'member';
  contract: number;
  transport: 'any' | 'in-process';                              // 'any' 必须满足 contracts §2.2 全部方法形状规则
  requiredBy?: ServiceKey;                                      // 该服务在装时，槽位必须有可用实现
  consumedBy: readonly ServiceKey[];                            // 会 resolve 它的服务（槽位边由此推出）；requiredBy ∈ consumedBy
  meta: ZodType;                                                // manifest provides.<slot>.meta 的 schema；没有 meta 的槽位是 z.undefined()
  implemented: boolean;
}
```

| 基数 | 含义 | 第一版 |
| --- | --- | --- |
| `bound` | 多个并存；有效绑定由所属服务在运行时解析（`brain.provider` 由 roster 的大脑配置给出） | 做 |
| `member-single` | 每个成员恰好一个（`memory.engine`、`growth.engine`、`social.model`） | 做 |
| `list` | 无序多个（`job.trigger`、`toolport.tool`、`gateway.command`） | 做 |
| `registry` | 按 key 登记、消费方按有序绑定做回退链（`ability.*`） | 做 |
| `single`、`chain` | 全局恰好一个；有序依次询问 | 定义保留，实现等第一个消费方 |

### 6.2 两份门面

```ts
interface ProviderSlots {                                        // builtin 拿到的；只能提供 manifest 声明过的槽位
  provide(slot: SlotName, instance: object): () => void;         // impl 由 kernel 填（§3.3）
  provideFactory(slot: SlotName, make: (member: MemberId) => object): () => void;
}
interface HostSlots extends ProviderSlots {                      // required 与 kernel 拿到的
  bind(scope: MemberId | '*', slot: SlotName, binding: Binding, layer: 'runtime'): void;
  resolve<T extends object>(slot: SlotName, query?: { member?: MemberId; impl?: ImplId; key?: string }): T;
  resolveAll<T extends object>(slot: SlotName, query?): T[];
  describe(slot: SlotName, query?: { impl?: ImplId }): { impl: ImplId; instanceId: string; pluginId: string; meta: JsonValue }[];   // 运行时可读的 meta
  plan(): SlotPlan[];
}
```

规则：`resolve` 解析不到抛 `LiwaError('unavailable')`，不返回 undefined；第 4 阶段前调用抛 `unavailable` / `slot.not_ready`；返回的是**带代际的句柄**（§6.3），消费方不得跨调用缓存实例；同一槽位同一 impl 登记两次、`member-single` 一成员两绑定、required 服务键被第二次 provide（cordis 会抛 `service "x" has been registered at <fiber>`〔源〕）都是装载期错误并点名两方；`provideFactory` 第一版只有一个成员，成员删除时的释放协议随 V5。

### 6.3 代际、句柄与取消

- 每次挂载一个实例 = 一代：`{ generation: number; controller: AbortController; effects: 释放栈 }`。`ctx.signal` 就是 `controller.signal`。
- `provide` 在 cordis 的 effect 里完成登记（登记与 effect 成为一个原子动作：fiber 失活时 cordis 拒绝建 effect，登记也就不会发生〔源：`effect()` 的 `assertActive` 只看 `uid !== null`，`dispose` 一开始就同步置 `uid = null`〕）。
- `disable(instance)` 第一步**同步**撤销代际：`controller.abort()`、注册表移除它的全部登记并标失效，然后才等 cordis 释放（最多 `DISABLE_DISPOSE_MS`）。迟到的 `provide` 看到代际已失效直接抛错。
- 句柄：`resolve` 返回的对象不是实例本身，是一个**只含契约方法的冻结包装**（目标实例留在闭包里，不用 Proxy，冻结实例也能用）。每次方法调用入口检查代际，失效即抛 `unavailable` / `slot.stale_handle`；调用时把 `ctx.signal = AbortSignal.any([调用方 ctx.signal, 提供方代际 signal])` 交给提供方；提供方代际被撤销时，kernel 对在途调用 `Promise.race`，以 `unavailable` / `slot.revoked` 拒绝（调用方自己取消的以 `cancelled` 拒绝）。契约里返回句柄的子对象（如 `BrainSession`）由同一包装器登记在同一代际下，一起失效。
- 运行时 `bind` 改绑定不撤销旧提供方（它仍登记着，只是新的 `resolve` 不再选它）；第一版没有热重载，"替换实现"只发生在禁用或关闭时，走上面的撤销。
- 释放函数幂等：只删除自己那条登记，不删同 impl 的新登记。

## 7 门面与写入纪律

```ts
export interface KernelContext<I extends ServiceKey = never, S extends ProviderSlots | HostSlots = ProviderSlots> {
  readonly instanceId: string; readonly pluginId: string;
  readonly impls: Readonly<Partial<Record<SlotName, ImplId>>>;
  readonly signal: AbortSignal;                                   // 本代的信号；禁用或释放即 abort
  readonly clock: Clock; readonly rng: Rng; readonly ids: Ids; readonly log: Logger;
  readonly services: Pick<PluginServices, I>;                     // builtin；required 是 Pick<Services, I>
  readonly slots: S;                                              // definePlugin 给 ProviderSlots，defineService 给 HostSlots
  effect(run: () => EffectCleanup | void, label?: string): () => Promise<void>;
  on<K extends keyof KernelEvents>(name: K, listener: KernelEvents[K]): () => void;   // 没有 emit
}
```

- **信任边界是模型与外界，不是插件与内核**（`overall.md` §11.1；决策 32）。插件对内核是**开放的**：可以 inject 任何账本的服务读它的查询 API、订阅经历流、用 procs 与 abilities；逻辑信息不残缺。
- 约束只有工程纪律，为的是校验集中和可回放：
  1. **写只经所有者**：每样数据只有一个写入方（`overall.md` §2.3）。给插件的 `journal` 是 `JournalReader`（`read`、`subscribe`、`getPayload`、`putPayload`），没有 `append`、`registerProjection`、`erasePayload`；类型上 `PluginServices.journal: JournalReader`，运行时 kernel 给 builtin 的是只含这几个方法的冻结视图。要写就调所属账本的写 API，由账本校验、落事件类型。能 `append` 的只有 required（经 `Services.journal`）和 kernel 自己。
  2. **主人令牌**：删载荷、改出生设定、绑定账号、换大脑、恢复熔断这些主人专属操作要带 gateway 鉴权后签发的 `OwnerToken`；防的是模型与会话冒充主人，不是防插件。
  3. **受众只由 people 造**（`AudienceRef` 是 branded 类型），受众裁剪只在 context 与 outbox 两处发生。
  4. **cordis 不出 kernel**：门面是冻结对象、服务实例 provide 前冻结、没有 `emit`。
- 向上传信息（`overall.md` §3.2 规则 2）在代码里就是**上层向下调用下层的登记或汇报 API**（如 gateway 调 `notify.reportPresence`、senses 经 `formhost.onInbound(cb)` 订阅）；kernel 不提供跨模块的事件总线，`ctx.on` 只有 kernel 事件。

## 8 生命周期、effect、时钟、随机与编号

### 8.1 钩子

`apply` / `create` 只登记；`ready` 才接活；`drain` 先停新活；`health` 限时；`recover` 与 `finalize` 只有 required 有。第一版不做热重载：改 profile、换插件、改契约版本都走"排空 → 重启"。释放函数从第一天写。消费方只 `inject` 服务键，槽位实现经 `resolve` 取，所以槽位实现消失不会触发 cordis 的级联卸载。

### 8.2 一切登记都随实例释放

- 每个实例一个**后进先出的释放栈**，只向 cordis 登记一个 effect；释放时逆序、串行、逐个 `await`（不用 cordis 的 `Promise.all`〔源：`_unload` 并发释放同一 fiber 的 effect〕），每个受 §5.4 的 dispose 额度约束。
- `ctx.effect(run)` 入栈；`ctx.on(...)` 的取消函数入栈；`ctx.clock` 是按实例包装的时钟，`timer()` 的取消函数入栈（禁用或关闭后不会再触发）。
- **登记类服务方法自动入栈**：contracts 导出 `REGISTRAR_METHODS: Partial<Record<ServiceKey, readonly string[]>>`（第一版 `{ journal: ['subscribe', 'registerProjection'] }`，各服务落地时增补）。kernel 给每个实例的 `services` 门面在这些方法上做两件事：返回的释放函数自动入栈（方法仍把它返回，调用方可提前释放，释放幂等）；函数型参数包进该实例的 `AsyncLocalStorage` store。这样"登记回调必须包进 effect"由 API 形状保证，不靠 ESLint；ESLint 只剩禁止裸的 `process.on`、`fs.watch`、`setInterval`。

### 8.3 时钟、随机、编号

- **时钟**：`Clock { wall(): { iso; ms; tz }; mono(): number; timer(ms, fn): () => void }`。`timer` 只给基础设施（超时、看门狗、探活），业务上的周期性工作走 scheduler 作业（决策 18）。L0 回放时是假时钟。
- **随机**：`Rng { next(); fork(label); state() }` 与 `rngFromState(s)`，`fork` 只由（种子, 标签）决定；`ctx.rng = root.fork('plugin:' + instanceId)`，加减实例不改变别人的序列；每天的种子进系统流（overall §6.2）。
- **编号**：`Ids.next(prefix)` 返回 `<prefix>_<bootSeq>_<n>`（十进制，不补零；`prefix` 匹配 `^[a-z][a-z_]*$`），`n` 按前缀从 1 计数、全进程一个源。`bootSeq` 由组合根从 `boot.json` 递增后经 `StartOptions.bootSeq` 传入，记进 `kernel.started.v1`；跨重启不撞号，不依赖 journal。测试里 `createTestKernel` 缺省 `bootSeq: 1`，所以第一个会话号恒为 `session_1_1`；`StartOptions.ids` 仍是注入点（给了就用它、`bootSeq` 只记账）。
- ESLint 禁止：`Date.now`、无参 `new Date()`、`Date()`、`performance.now`、`process.hrtime`、`process.uptime`、`Math.random`、`crypto.randomUUID` / `getRandomValues` / `randomBytes` / `randomInt` / `randomFillSync`；`setTimeout` / `setInterval` / `setImmediate` 只许 kernel 与 procs（gateway 的安全令牌用独立的密码学随机源，是 `randomBytes` 的唯一豁免点）。范围见 `engineering.md` §9。

## 9 配置、密钥与装配哈希

### 9.1 配置与密钥

- profile 的 `config` 只放部署参数；凡是主人能在主控台改的，都是所属模块的配置实体，走配置事件。
- 密钥引用 `{ "$secret": "keychain:liwa/deepseek" }`，kernel 在第 2 阶段把 config 交给插件前才解析；`dump-config`、日志、装配哈希里只出现引用；解析不到：required 退出、builtin 禁用。**脱敏在输出边界做**：kernel 持有本次解析出的全部密钥明文集合，日志 exporter、`problems`、`EntryPlan.reason`、错误消息与 cause 链在写出前把命中的明文替换成 `<secret:引用>`（不按字段名猜）。安全令牌用密码学随机源，不用可回放的 `Rng`。

### 9.2 装配哈希（`assemblyHash`）

- **输入**（规范化 JSON：键排序、无空白；sha256 十六进制）：

  ```ts
  { hashVersion: 1, stage, build,                                              // build 见下
    entries: [ { instanceId, pluginId, package, version, runtime, impls: { slot: impl }, meta: { slot: meta }, config /* 密钥只取引用 */ } ],   // 只含启用的条目，按 profile 顺序
    bindings: [ { scope, slot, binding } ],                                     // 叠层后的有效绑定，不含来源层
    contracts: { slot: CONTRACT_VERSIONS[slot] }, services: { key: SERVICE_VERSIONS[key] }, kernelApi, manifestVersion }
  ```

  不进哈希：条目来自哪一层、禁用的条目与原因、`problems`、任何路径。有效装配相同则哈希相同，与配置来自哪层无关。启动期禁用了 builtin 后重算一次，`kernel.started.v1` 写的是最终值。
- **`build`（代码版本）**：一个字符串 `<仓库版本>+<源码树哈希前 12 位>`，由组合根 `apps/liwa/src/build-info.ts` 计算后经 `StartOptions.build` 传入：源码树哈希 = sha256 over 排序后的（相对路径 + 文件内容），范围 `apps/*/src`、`packages/**/src`、`packages/**/client`、`packages/**/python/src`、`pnpm-lock.yaml`，排除 `__tests__/`、`test/`；进程内缓存一次。git 提交号（有则 `git rev-parse HEAD`，失败为空）单独记进 `kernel.started.v1.git`，不进哈希。所有包同一版本号，所以包版本分不出代码变化，必须靠源码树哈希（verify-codex X7〔一手〕）。
- **用途**：L1 回放先比 `assemblyHash`，不同即拒绝回放并打印差异；`liwa status` 显示它的前 12 位；升级流程里新构建先对本机 profile 跑 `dump-config`，失败不切换。`dump-config` 打印 `build`、`assemblyHash` 与上面的哈希输入（`--json` 时在 `hashInput` 字段）。

## 10 进程外插件（kernel-1，推迟到第一个真正的进程外插件）

第一版只落 contracts 的 IPC 信封（`00-contracts.md` §10）与 manifest 的 `runtime` / `launch` / `resources`；宿主运行时等第一个真用户（本地嵌入退回 Python 服务时，或 V2 的微信适配器）。到时按下面做，不再重新设计：

- IPC 宿主做成 `@liwa/kernel#ipc-host` 这个 required 插件（inject `procs`、`journal`），装在 procs 之后；进程外插件永远不能是 required。
- 传输走 **fd 3 管道**（`stdio: ['ignore','pipe','pipe','pipe']`），stdout、stderr 都当日志；收到非 JSON 行计数告警不崩。
- 握手：宿主发请求 `kernel/hello{ kernelVersion, ipcProtocolVersion, contracts, views }`，插件的响应带 manifest 回显与 pid，宿主只信磁盘上读到的 manifest；stdio 下不做令牌。
- 插件 → 宿主只有两条路：视图调用 `kernel/view.<视图>`（仅声明过的）、宿主先开的流（`<slot>/events`）；作用域由宿主注入。
- 生命周期：`kernel/ready`、`kernel/drain{ deadlineMs }`、`kernel/health`、`kernel/shutdown{ graceMs }` 与进程内钩子一一对应。
- 取消：`$/cancel{ id }` 对任意请求有效；流用请求 id 作流 id；`$/ack` 是通知，`kernel/ping` 是请求。
- 资源：`resources` 给 RSS、CPU 档位、日志限额；procs 采样 RSS 超限即杀并计入熔断；后台插件用 `taskpolicy -b`；在途请求上限 64、流每 256 条要 ack、单行 1 MiB。
- 大对象走 `$LIWA_HOME/ipc/<id>/` 的临时目录加 TTL。
- 崩溃或判死：重启退避 1、5、30 秒；10 分钟 3 次熔断；恢复经主人接口、写 `plugin.circuit_reset.v1`。
- 进程外只为故障隔离，不是信任分级（决策 32）。取消是请求不是完成证明：涉及外部动作的调用超时按"结果不明"处理，只对 actions 里有幂等键的动作重做。

## 11 kernel 的公开 API

主入口 `@liwa/kernel` 只导出下面这些；`./testing` 子入口见 §12。第 1 阶段的内部函数（`checkManifest`、`deriveKind`、`resolveProfile`、`buildServiceGraph`、`SlotRegistry`）不出包。

```ts
export function definePlugin<S extends ZodType, I extends ServiceKey>(def: {
  id: string; Config?: S; inject?: readonly I[]; commands?: CommandSpec[];          // builtin 的 commands 只用于 CI 比对，真相在 manifest
  apply(ctx: KernelContext<I, ProviderSlots>, config: z.output<S>): void | Promise<void>;
  ready?(ctx): Promise<void>; drain?(ctx, deadlineMs: number): Promise<void>; health?(): Promise<Health>;
}): PluginDef;
export function defineService<K extends ServiceKey, I extends ServiceKey>(key: K, def: {
  inject?: readonly I[]; Config?: ZodType; commands?: CommandSpec[];
  create(ctx: KernelContext<I, HostSlots>, config): Promise<Services[K]>;
  recover?(ctx): Promise<void>; ready?; drain?; health?; finalize?(): void;
}): PluginDef;
export function startKernel(opts: StartOptions): Promise<KernelHandle>;
export function dumpConfig(opts: StartOptions): AssemblyPlan;            // 同步，只跑第 1 阶段
export function canDegrade(plan: AssemblyPlan, instanceId: string): boolean;   // 组合根做自动禁用时用
export function createSystemClock(): Clock;  export function createRng(seed: string): Rng;  export function rngFromState(s: string): Rng;
export { z } from '@liwa/contracts';
export type { KernelContext, PluginDef, StartOptions, KernelHandle, Clock, Rng, Ids, Logger, SecretResolver, ProviderSlots, HostSlots, Health, KernelEvents, EffectCleanup };
// StartOptions: { root: URL; load: (specifier: string) => Promise<unknown>; repoRoot?: string; home: string; profile: string; patches?: string[];
//   required: PluginDef[]; stageSets?: StageSets; bootSeq: number; build: string; logger?: Logger; secrets?: SecretResolver; clock?: Clock; rng?: Rng; ids?: Ids;
//   startupTimeoutMs?: number; shutdownDeadlineMs?: number }
// KernelHandle: { plan: AssemblyPlan; health(): Promise<Record<string, Health>>; shutdown(reason): Promise<{ outcome: 'clean' | 'timeout'; pending: string[] }>;
//   finalize(): void; blame(): { instanceId; pluginId } | undefined; service<K>(key: K): Services[K] }
```

kernel 事件（进程内，斜杠风格，只有 kernel 能 emit；监听器返回 Promise 时 kernel 等它并记录拒绝）：`kernel/started`、`plugin/loaded`（apply 成功后才发）、`plugin/disabled`、`plugin/failed`、`plugin/circuit-open`、`slot/bound`。写进经历流的对应事件：`kernel.started.v1{ profile, stage, assemblyHash, build, git?, bootSeq, plugins: instanceId[], autoDisabled: instanceId[] }`、`plugin.disabled.v1`、`plugin.failed.v1`、`plugin.circuit_open.v1`、`slot.bound.v1`（系统流，受众 `AUDIENCE_OWNER`）；journal 的 `recover` 完成前先缓冲，之后按序追加；`kernel.started.v1` 写入成功才算启动成功。

## 12 测试：`./testing` 子入口、testkit、回环编解码

**分工**：

| 放哪 | 放什么 | 为什么 |
| --- | --- | --- |
| `@liwa/kernel/testing`（子入口，只许测试文件、testkit、replay 引用） | `createTestKernel`、`dumpTestConfig`、`prepareTestAssembly`、`memoryResolver`（内存里的包）、`fakeClock`（`advance` / `flush`）、`counterRng`、`createIds`、`MemoryLogger`、`withRoundtrip`（回环编解码包装） | 这些要用 kernel 的内部接口（loader 同一段代码、注册表） |
| `@liwa/testkit`（独立包，依赖 contracts、kernel） | 服务假实现（`fakeJournal` 内存版、`fakeProcs`、`fakeGuard`……）、假出口（`captureOutbox`）、脚本化假大脑 `scriptedBrain`（单元测试用，不是插件）、装配夹具（`m0Fixture()` 组一份带假服务的内存 profile）、契约测试的断言助手 | 不碰 kernel 内部；各模块的单元测试都用它 |
| `plugins/brain-replay` | 录放大脑（真正的 `brain.provider` 实现，L1 回放用） | 它是插件，要经真实 loader 装 |

- 测试内核吃"包路径加内存 profile"，与 `startKernel` 走同一段五阶段代码，只多"内存里的包""假服务""假时钟"三个注入点；只有它能替换 required。`createTestKernel({ roundtrip: true })` 打开回环编解码。
- **回环编解码**（T9）：`withRoundtrip` 把 `transport: 'any'` 槽位的每个句柄包一层：方法调用前把参数 `JSON.parse(JSON.stringify(params))` 并用 `SLOT_CONTRACTS[slot].Methods[m].params` 校验，返回值同样往返并用 `result` 校验，流的每一项用 `stream` schema 校验，句柄只传 `{ handle }` 字符串；非 JSON 值（`Date`、函数、`bigint`、`undefined`）当场失败并指出槽位、方法、路径。放在 kernel `src/testing/roundtrip.ts`；每个 `transport: 'any'` 槽位在 contracts 里有一组正反例，每个提供方插件的契约测试在 `roundtrip: true` 下跑。
- 反例必须覆盖：配置错误类——路径与 manifest 种类不符、同实例 id 重复、required 条目带 package、`inject ⊄ consumes`、默认导出（含 `export default undefined`）、Config 用了 async refine、meta 不合槽位 schema、`as` 用在非 multiInstance、子进程插件 `consumes` 列了服务键、required 的 `inject` 指向上层；纪律类——插件直接追加经历流（类型与运行时都拒绝）、主人操作没有主人令牌；运行类——必需槽位的实现初始化失败、ready 失败后必需槽位复查、依赖消失与恢复（fiber 回到 PENDING 再 ACTIVE，rng 序列不重头）、异步清理顺序、超时后迟到的登记被拒、冻结实例的句柄、取到的方法在代际失效后调用、旧释放函数二次调用、超时但副作用已发生、随机源恢复、损坏配置下的恢复入口、关闭超截止仍发起 dispose 且 finalize 执行、密钥明文进入错误消息后被脱敏。
- T1 manifest 坏值；T2 契约、服务、视图、kernelApi 版本不符；T3 patch 动 required、本机层 insert、同层重复、跨 `--patch` 文件重复被拒并指出层与条目；T4 四种基数的冲突、缺绑定、绑定形状不合基数；T5 静态服务图缺提供方、成环、自环、层表方向、槽位边成环、required 超时并列出缺项；T6 drain / dispose 顺序、effect 逆序串行释放、关闭后无残留定时器与子进程、45 秒截止、finalize；T7 `dump-config` 快照稳定、脱敏、哈希输入完整、换层不变、换代码即变；T8 两个假插件装进 `m0-terminal` 并经 `ready` 接活，含真实文件系统解析（workspace 夹具、符号链接、`exports` 的 `import` 条件）；T9 回环编解码；T10 测试内核与真实 loader 行为一致；T11 假时钟驱动每一步时限；T12 异常能定位到实例 id 与栈、`blame()`、`FiberState` 六态数值与 cordis 运行时导出一致；T13 多实例：两份 `brain-acp` 各自的 impl、config、rng 序列、禁用其一不影响另一份。

## 13 第一版范围

- **kernel-0**（本稿全部，m0 之前）：门面与 journal 视图、manifest（含 meta 校验、runtime、launch 形状、kernelApi）、实例身份、profile 与四层 patch、五阶段与时限、服务边加槽位边、层表检查、四种基数、`requiredBy` / `consumedBy`、`describe`、代际与 `AbortSignal`、effect / on / timer 随实例释放、登记类方法自动入栈、`finalize`、编号带启动序号、装配哈希与 `build`、输出边界脱敏、`AsyncLocalStorage` 与 `blame`、`boot.json` 与安全模式页（组合根）、`canDegrade`、测试内核与 `./testing`、testkit、回环编解码、命令声明的收集与查重。
- **kernel-1**（第一个进程外插件出现时）：§10 全部，`plugin-sdk`。
- 以后：热重载、安装仓库外的插件、`single` / `chain`、`provideFactory` 的成员隔离与释放、`ctx.storage.derived`、新槽位的注册协议。
- "装上一个就好一个"在第一版的含义是**给已有的标准槽位增加实现**；要加一种新槽位，先改 contracts、升版本，再加实现。

## 14 待实测

cordis `4.0.0-rc.12`：`AsyncLocalStorage` 标实例的开销；pnpm 下经组合根注入的 `import()` 对 `exports` 条件的解析（m0 接第一个真实插件包时验）；关闭 45 秒截止与 launchd `ExitTimeOut` 的配合；源码树哈希在本仓库规模下的启动开销（目标 < 100 ms）。已验：`FiberState` 在 rc.12 的打包产物里有运行时导出（kernel 仍按源码写死数值，并用一条测试与运行时导出比对）；Config 不经 cordis 的 `resolveConfig`，由 kernel 用 zod `safeParse` 同步校验；同一插件对象可挂多份（§3.3）。

## 15 依据

cordis 4.0.0-rc.12 打包产物（`RegistryService.plugin` 1489–1507、`Fiber` 构造 331–345、`name` 426–432、`assertActive` 433–436、`internal/status` 551、`registry.delete` 1468、`internal/get` 895、根符号 55 与 1530、`_unload` 等 `dependents` 与 `Promise.all`、`await()` 只等 inertia、同步 `~standard.validate`、默认 logger exporter 只进内存缓冲、`emit` 同步且不隔离异常）〔源〕；DSH 的 manifest、profile、patch、required 名单、PENDING 静默、复盘 0001〔一手调研〕；OpenClaw 的 manifest 先于代码、宿主铸造受众〔一手调研〕；JSON-RPC 2.0〔一手〕；内核九样与信任分档〔`plugin-architecture` D1、D6、D7〕；四份评审报告 `research/2026-10-29-review-kernel-*.md` 与四份核实报告 `research/2026-10-29-verify-*.md`（K1–K26、G1–G6、X1–X27、L ⑤(c)、M ⑦）；决策 17、29–35。

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
