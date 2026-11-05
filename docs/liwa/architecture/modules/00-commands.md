# 00 标准终端命令 `liwa` 的插件化机制与协议布局

状态：**已确认**（2026-10-29，决策 35 ④）。主人原话："我们的 liwa 命令集也需要从插件机制和插件协议就得开始布局了，要不然后边就没法加入了。"本稿只定**机制**：命令是什么、怎么声明、谁能加、`liwa` 进程怎么发现、怎么走协议、怎么随插件生命周期出现与消失、哪些口子进 `contracts` 与 `kernel`。命令的具体清单在 `../../engineering.md` §12（唯一归属），每条命令的参数在各模块文档里定（谁的功能谁声明）；命令的约定（退出码、`--json`、幂等、流）只写在本稿。依据：`00-plugin-kernel.md`、`00-contracts.md`、`engineering.md` §4、§12、`../overall.md` §3.1、§10、§11.1；Helm（与 Paseo 上游 0.14.0 同步后的 main `1fa999a`）`packages/cli/src/`、`packages/plugin/src/` 源码与 `docs/plugins.md`；Codex `codex-rs/cli/src/main.rs`；Koishi `packages/core/src/command/index.ts`；oclif `src/config/plugin.ts`；kubectl 插件文档；VS Code 贡献点文档。标注：〔一手〕读过源码或原文；〔二手〕转述；〔推理〕设计判断。

## 0 一页结论

- **命令 = 一个有名字、有 schema、有鉴权标记的本体操作；终端、主控台命令面板、聊天里的斜杠命令是它的三种呈现。** 命令 id 就是前后端信封的 `op`（`liwa memory search` ↔ `Request{ op: 'memory.search' }`），不另设映射表。〔推理，照 VS Code"一个命令、多个菜单"的形状〔一手〕〕
- **命令是一个槽位 `gateway.command`**（基数 list、作用域 global、transport any、没有 `requiredBy`、`consumedBy: ['gateway']`）：静态描述（`CommandSpec[]`）按 §2.2 规则进 manifest 的 `provides['gateway.command'].meta`，执行体是提供方实例的 `run` / `stream` 两个方法，只传 JSON。required 模块（memory、tasks、guard……）用同一个槽位登记自己的命令，静态描述放在 `defineService` 的 `commands` 字段；gateway 是唯一消费方。插件禁用或卸载，命令随槽位登记的释放函数一起消失，不需要额外机制。〔推理；槽位释放函数照 Koishi `ctx.collect('command <x>', dispose)` 把指令挂在插件作用域上〔一手〕〕
- **命令分两种执行位置**：`body`（经 gateway，在本体里执行；核心与插件都能加）与 `local`（本体没跑也能执行：start、stop、status、doctor、dump-config、profile、logs、backup、restore、migrate；只有组合根 `apps/liwa` 能声明，插件不能加本机命令，因为插件只在 kernel 装配下运行）。〔推理；kubectl 插件只能加新顶层命令、不能改内置〔一手〕〕
- **插件命令必须以自己的实现 id 开头**：`brain-claude-code.login` → `liwa brain-claude-code login`。核心组名保留（`RESERVED_COMMAND_GROUPS`），冲突与越界在装配第 1 阶段点名、禁用该插件。〔推理；kubectl 的"不许覆盖内置、不许往内置加子命令"〔一手〕〕
- **`liwa` 进程的命令清单是数据，不是代码**：本体在跑时经 `commands.list` 拿当前清单（按本体构建号缓存在 `$LIWA_HOME/run/`），本体没跑时跑装配第 1 阶段从 `AssemblyPlan` 取声明。解析器与帮助都从 `CommandSpec` 生成，所以远程 `--host` 连到更新的本体也能用新命令。〔推理；oclif 用预生成的 `oclif.manifest.json` 做到"列命令不加载命令代码"〔一手〕〕
- **退出码由错误类别映射**：0 成功；1 用户错误（`invalid_input`、`not_found`、`conflict`、本机解析错误）；2 本体不可达（连不上、协议版本不符）；3 被拒（`auth`、`not_permitted`、`quota`、`refused`、`cancelled`）；4 本体内部失败（`internal`、`invalid_output`、`process_exit`、`retryable`、`timeout`、`unavailable`），脚本因此能分清"我错了"和"她坏了"。〔推理〕
- **进 contracts 与 kernel 的口子**：`CommandSpec` 与 id 规则、`RESERVED_COMMAND_GROUPS`、`gateway.command` 槽位定义（`SLOT_DEFS`）、`buildCommandCatalog`、`EXIT_CODE_BY_CATEGORY`、`PluginDef.commands`、loader 第 1 阶段收集与查重、`AssemblyPlan.entries[].commands`、`Request.idem`、`PROTOCOL_OPS`。m0 做 start / status / doctor / dump-config / chat / tail 加 `commands list|show`（命令面快照的锚点）。插件第一版不能加本机命令与交互命令。

## 1 范围与边界

**管什么**：命令的身份与命名；`CommandSpec` 的 schema；`gateway.command` 槽位契约；manifest 与 `PluginDef` 里怎么声明；`liwa` 进程发现命令的两条路；命令与前后端信封、主人令牌、幂等键、退出码、版本的绑定；一处声明三端复用的规则；命令随插件生命周期的出现与消失；分阶段与测试。

**不管什么**：每条命令的参数与输出（各模块文档）；gateway 的鉴权流程、订阅、合帧、`commands.list` 之外的主人接口清单（07）；主控台命令面板与斜杠命令的界面（08）；`liwa start` 怎么拉起本体、`doctor` 查什么、`backup` 怎么做（03、07）；包与目录（`engineering.md` §4：可执行入口在 `packages/cli`，本机命令实现在 `apps/liwa`，数据操作在 core）。

**和谁打交道**：gateway（唯一消费方，派发与鉴权）、kernel（第 1 阶段收集与查重、第 4 阶段核对登记）、contracts（schema、槽位定义、保留组、协议字段）、senses（斜杠命令入口）、console（命令面板）、`apps/liwa`（本机命令的归属与 `liwa` 可执行入口）。

## 2 概念

| 概念 | 定义 |
| --- | --- |
| 命令 id | 点分小写段，`^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$`；`liwa a b c` ↔ `a.b.c`；第一段是**组**；单段 id（`start`、`chat`、`pause`）全部保留给 app 与 core |
| 组 | id 的第一段。核心组在 `RESERVED_COMMAND_GROUPS` 里显式列出（engineering §12 九组展开）；插件的组只能是它在 `gateway.command` 上的实现 id（= `as ?? manifest 的 impl`，`00-plugin-kernel.md` §3.3），所以禁用一个实例，它的整组命令一起消失 |
| 核心命令 / 插件命令 | 都是 `gateway.command` 的提供方登记的命令，机制上无区别；区别只在归属（required 用 `defineService.commands` 声明；builtin 用 manifest `meta` 声明）与组名规则 |
| 本机命令 | `exec: 'local'`，在 `liwa` 进程里执行、不经 gateway；只有组合根声明，不走槽位 |
| 呈现面 | `surfaces`：`cli`（终端）、`palette`（主控台命令面板，含 Mac 客户端与手机页）、`slash`（聊天里主人账号发的 `/xxx`，不进模型） |
| 命令种类 | `request`（一问一答）、`stream`（订阅帧，`--json` 时 NDJSON）、`interactive`（终端程序：`chat`、`task open`；只有 cli 包内置，插件不能加） |
| 命令清单 | 本体当前能执行的全部命令描述：由 gateway 在 `ready` 时 `resolveAll('gateway.command')` 合成，经 `commands.list` 对外 |

## 3 数据结构与 schema（进 `packages/contracts`）

### 3.1 `protocol/command.ts`：`CommandSpec`

```ts
export const CommandId = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$/);
export const LOCAL_COMMAND_GROUPS = ['start','stop','restart','status','doctor','dump-config','profile','logs','backup','restore','migrate'] as const;   // exec: 'local' 的组；cli 据此决定何时动态加载 @liwa/app
export const DEV_COMMAND_GROUPS = ['probe','replay','eval'] as const;                                                                                // 动态加载 @liwa/replay
export const RESERVED_COMMAND_GROUPS = [...LOCAL_COMMAND_GROUPS, ...DEV_COMMAND_GROUPS, 'chat','say','tail','now','day',
  'memory','growth','self','people','skills','tasks','task','pause','resume','budget','rules','brain','autonomy','config','plugins',
  'export','contracts','acp','commands'] as const;   // engineering §12 的九组展开；加组要改这里
export const CommandSurface = z.enum(['cli', 'palette', 'slash']);
export const CommandSpec = z.strictObject({
  id: CommandId,
  kind: z.enum(['request', 'stream', 'interactive']).default('request'),
  summary: z.string().min(1).max(60),                      // 一行中文
  help: z.string().optional(),                             // 段落中文；没有就用 summary
  params: JsonSchemaObject,                                 // 入参：一个 JSON Schema 对象（draft 2020-12，可导出子集）；request 的 body、stream 的订阅参数
  result: JsonSchema.optional(),                            // request 的返回、stream 的每条 item；--json 原样打印
  cli: z.strictObject({
    positional: z.array(z.string()).default([]),            // 按顺序从 params.properties 里挑作位置参数，其余成 --kebab-case 标志
    examples: z.array(z.strictObject({ cmd: z.string(), note: z.string() })).default([]),
    render: z.union([                                       // 人读格式只能声明式（插件不能给函数）
      z.strictObject({ kind: z.literal('table'), columns: z.array(z.strictObject({ key: z.string(), title: z.string(), width: z.number().int().optional() })) }),
      z.strictObject({ kind: z.literal('kv') }),
      z.strictObject({ kind: z.literal('text'), key: z.string() }),
    ]).optional(),                                          // 缺省：数组用 table（取 result 的首层字段）、对象用 kv
  }).optional(),
  surfaces: z.array(CommandSurface).min(1).default(['cli']),
  owner: z.boolean().default(false),                       // 主人专属：gateway 校验主人身份后签 OwnerToken 再派发
  mutation: z.boolean().default(false),                    // 有副作用：客户端必须带幂等键（§3.4）
  hidden: z.boolean().default(false),                      // 帮助里不列（内部、调试）
  since: z.enum(['m0', 'm1', 'v1']),                       // 哪个阶段集合起可用；命令面快照按阶段分
});
export const CommandCatalog = z.object({ build: z.string(), stage: Stage, commands: z.array(CommandSpec.extend({ provider: z.string(), exec: z.enum(['local', 'body']) })) });
export function buildCommandCatalog(input: { build: string; stage: Stage; providers: { impl: string; meta: { commands: CommandSpec[] } }[]; local?: CommandSpec[] }): CommandCatalog;   // 纯函数，归 contracts：gateway 用 HostSlots.describe('gateway.command') 的结果喂它，cli 离线时用 AssemblyPlan.entries[].provides 喂它
```

规则：`JsonSchema` / `JsonSchemaObject` 是 `protocol/command.ts` 里新加的、只认 `00-contracts.md` §2.3 可导出子集的 JSON Schema 校验器（contracts 现在没有，`contracts:export` 的导出物和它用同一个子集）；`params` 只用这个子集；`interactive` 的 `params` 只是启动参数，程序名等于 id（`chat`、`task.open`），cli 包按 id 找内置程序，找不到就报 `invalid_input`；`help`、`summary`、`examples[].note` 中文，id 与参数名英文（engineering §9）；不做多语言（Paseo 0.14.0 把插件贡献的文本改成按应用语言翻译的 `PluginText`〔一手〕，灵鲸单主人、只有中文，不需要）。〔推理；Helm 的 `OutputSchema { idField, columns, renderHuman }` 用函数渲染〔一手〕，我们因为插件要进 manifest 只保留声明式部分〕

### 3.2 `slots/gateway.command.ts`：槽位契约（版本 1）

```ts
// 定义在 contracts 的 SLOT_DEFS：{ cardinality: 'list', scope: 'global', transport: 'any', contract: 1, consumedBy: ['gateway'], meta: Meta }；无 requiredBy：没有命令本体照常起
export const CONTRACT_VERSION = 1;
export const Meta = z.strictObject({ commands: z.array(CommandSpec).min(1) });         // manifest provides['gateway.command'].meta
export const Methods = {
  run:    { params: z.object({ command: CommandId, args: JsonValue, idem: z.string().optional() }), result: JsonValue, timeoutMs: 30_000 },
  stream: { params: z.object({ command: CommandId, args: JsonValue }), stream: JsonValue, timeoutMs: 0 },   // 只有 kind='stream' 的命令
} as const;
export type CommandProvider = ClientOf<typeof Methods>;
```

- 一个插件实例 = 一个提供方 = 一包命令（impl = `as ?? manifest 的 impl`；required 的 impl = 服务键）；`run` 按 `command` 分派到自己的处理函数。gateway 调 `run` 前已用 `params` 校验过 `args`，提供方再用自己的 zod 校验一次（模型输出一律不信的同款纪律，这里是防契约漂移）。〔推理〕
- `transport: 'any'` 并过回环编解码测试（§2.2 第 7 条）：以后进程外插件（kernel-1）经 IPC 调 `gateway.command/run`，形状不变。〔推理〕
- `owner: true` 的命令：gateway 把签好的 `OwnerToken` 放进 `CallContext`（进程内另带，不进 JSON；IPC 时作用域由宿主注入，照 `00-plugin-kernel.md` §10）；提供方把它交给账本的写 API。〔推理〕

### 3.3 怎么声明

| 谁 | 静态描述放哪 | 执行体怎么登记 | 装配期检查 |
| --- | --- | --- | --- |
| required（core 模块） | `defineService(key, { commands: [spec…] })` → `PluginDef.commands`；zod 在代码里，`params` 用 `z.toJSONSchema` 在定义时导出 | `create` 里 `ctx.slots.provide('gateway.command', pack)`（impl 由 kernel 填为服务键） | 第 1 阶段从 `PluginDef.commands` 收集 |
| builtin（插件包） | `package.json` 的 `liwa.provides['gateway.command'] = { contract: 1, impl: '<id>', meta: { commands: [...] } }`，JSON Schema 直接写在 manifest 里 | `apply` 里 `ctx.slots.provide('gateway.command', pack)`（impl 由 kernel 按 `as ?? impl` 填） | 第 1 阶段用槽位的 `Meta` 校验 `meta`；第 4 阶段核对登记；CI 比对插件代码里的 zod 导出与 manifest 一致（同 `contracts:export` 的做法） |
| 组合根（本机命令） | `apps/liwa` 的代码常量 `LOCAL_COMMANDS: CommandSpec[]`（`exec: 'local'`） | cli 包按 id 调组合根的本机实现 | 命令面快照 |

builtin 的 manifest 是第 1 阶段的真相（不导入代码就能列命令、查重、给 `dump-config`），代码里的 zod 是执行时的校验器，CI 保证两者一致；这是"派生物由 CI 守"，不是兼容层。〔推理；oclif 的 `oclif.manifest.json` 由命令类生成、版本不符即报错〔一手〕〕

第 1 阶段新增检查（kernel）：id 合规；插件命令的组 = 自己的 impl id，且 impl id ∉ `RESERVED_COMMAND_GROUPS`；全局 id 不重复（跨 required 与 builtin）；`interactive` 只许 required 或组合根；违规 builtin 禁用并写原因，required 违规致命。`EntryPlan` 加 `commands: string[]`，装配树哈希含它。〔推理〕

### 3.4 和协议的绑定（`protocol/client.ts`）

| 事项 | 规则 |
| --- | --- |
| 请求 | `Request{ op: <命令 id>, body: <args> }`；命令 id 与 `op` 同一个字符串。协议内部操作（`hello`、`sub.*`、`commands.list`）不是命令，占保留组 |
| 幂等 | `Request.idem?: string`（`00-contracts.md` §9）；`mutation: true` 的命令客户端必须带（cli 自动生成，`--idempotency-key` 可指定）；gateway 原样传给 `actions.run`；同一 `idem` 第二次返回第一次的 `Response`。请求 id 不替代幂等键（`00-contracts.md` §11） |
| 主人身份 | 本机：`Hello.token` = 每次启动重写、0600 的本机凭据文件（`overall.md` §11.1）；远程 `--host`：`LIWA_TOKEN` 环境变量或 `$LIWA_HOME/config/hosts.yml` 里的令牌（V2 随手机远程定）。gateway 确认主人后，对 `owner: true` 的命令签发 `OwnerToken` 再派发；非主人经斜杠命令调 `owner` 命令 → `not_permitted` |
| 版本 | `Hello{ v: int, build, client: 'cli' }`；`v` ≠ `CLIENT_PROTOCOL_VERSION` → 错误 `invalid_input` / `protocol.version_mismatch`，`data: { server: { v, build }, client: { v, build } }`，连接关闭；cli 退出码 2，提示"命令行 0.2.0 与本体 0.3.1 不一致，请升级"。命令清单按 `welcome.build` 缓存，构建号变了就重取 |
| 流 | `kind: 'stream'` 的命令 = 一次 `sub` 订阅：gateway 把 `stream()` 的 `AsyncIterable` 装成 `Frame{ t:'sub', sub, cursor, items }`；cli 人读逐条渲染，`--json` 每条一行 NDJSON（Helm `renderJsonLine`〔一手〕）；Ctrl-C 发 `sub.close` |
| 远程 | `--host <host>` 走 Tailscale Serve 的 HTTPS（`overall.md` §3.7）；本机命令遇到 `--host` 报 `invalid_input`："这是本机操作"（Helm `localOnly` 的 `LOCAL_OPERATION`〔一手〕） |

**退出码**（类别到退出码的映射表 `EXIT_CODE_BY_CATEGORY: Record<ErrorCategory, 1 | 3 | 4>` 建议归 contracts `errors.ts`〔待确认〕，网页与 Electron 按同一张表分流错误提示；`packages/cli` 只加本机解析错误与传输层的 2；测试覆盖 14 个类别 + 连接拒绝 + 版本不符）：

| 退出码 | 含义 | 错误类别 / 情形 |
| --- | --- | --- |
| 0 | 成功 | — |
| 1 | 用户错误 | `invalid_input`、`not_found`、`conflict`；本机解析错误（未知命令、缺参数）；命令由已禁用的插件提供 |
| 2 | 本体不可达 | 连接失败；`protocol.version_mismatch`；本机命令里"本体没在跑"（`status` 仍打印报告、`stop`） |
| 3 | 被拒 | `auth`、`not_permitted`、`quota`、`refused`、`cancelled`（暂停、总闸） |
| 4 | 本体内部失败 | `internal`、`invalid_output`、`process_exit`、`retryable`、`timeout`、`unavailable` |

### 3.5 `AssemblyPlan` 与 `commands.list`

`EntryPlan.commands: string[]`（声明的 id；禁用条目也列，状态由条目的 `status` 表达）。`commands.list`（协议内部操作，不要令牌，返回 `CommandCatalog`）：`build`、`stage`、每条 `CommandSpec` 加 `provider`（插件 id）与 `exec`；`local` 命令由 cli 包自己合并进去，不在 gateway 的清单里。`liwa commands list [--json]`、`liwa commands show <id>` 就是这两份合起来。〔推理〕

## 4 流程

### 4.1 `liwa` 进程怎么知道有哪些命令

```
liwa <argv>
  ├─ argv[0] ∈ LOCAL_COMMAND_GROUPS（contracts 的静态名单）→ 动态 import('@liwa/app') 取 LOCAL_COMMANDS（声明）与实现；只有这时才加载本体代码。argv[0] ∈ DEV_COMMAND_GROUPS → 动态 import('@liwa/replay')
  ├─ 本体命令表：
  │    1. 读 $LIWA_HOME/run/liwa.pid 与 listen 地址（本机）或 --host
  │    2. 能连上 → GET commands.list → 写缓存 run/commands.<build>.json → 用它建解析器
  │    3. 连不上 → 有缓存用缓存；没缓存 → dumpConfig(profile) 取 AssemblyPlan.entries[].commands（只有 id 与 provider，没有 params）→ 只能回答"这条命令存在、需要本体"，退出码 2
  └─ 解析 argv → 本机命令直接执行 / 本体命令 Request{ op, body, idem } → 渲染 → 退出码
```

机制要求：① 本体命令永远不加载本体代码，只要 contracts 与 `@liwa/client`；② 本机命令与离线清单需要 `dumpConfig` 与组合根的 `REQUIRED`，所以 cli 包只在执行本机命令时动态 `import('@liwa/app')`（dependency-cruiser 按 `dynamic-import` 依赖类型放行）；③ 不许为了 `liwa status` 这种轻命令拖起 cordis 与全部插件代码。落位（决策 35 ⑤，`engineering.md` §4）：`packages/cli` 是 `liwa` 的 bin（`bin/liwa.js`），静态只依赖 contracts 与 client；本机命令的编排与 `LOCAL_COMMANDS` 在 `apps/liwa/src/commands/`；backup / restore / migrate 的实现由 `@liwa/core` 公开入口导出；开发命令（`probe`、`replay`、`eval`）动态 import `@liwa/replay`。〔推理；Helm 0.14.0 的 cli 连接走 `@getpaseo/client/node`，`start` / `status` 与等待就绪依赖 `@getpaseo/server/daemon-control` 子路径〔一手〕〕

解析器：建议 `node:util.parseArgs`（`strict`、`allowPositionals`、`tokens`）加自己的组路由，不引新依赖；帮助从 `CommandSpec` 渲染（全中文、确定性、快照测试）。commander（Helm 用〔一手〕）可作备选，由实现 agent 实测后定。〔推理〕

### 4.2 一次本体命令：`liwa memory search "上周" --limit 5`

1. cli：清单里找 `memory.search` → `positional: ['query']` → `body = { query: '上周', limit: 5 }` → 本地用 `params` 预校验（错了退出码 1，不打扰本体）→ `Hello` 带本机凭据 → `Request{ op: 'memory.search', body }`。
2. gateway：`op` 在清单里 → `params` 校验 → `owner` 命令核主人、签 `OwnerToken` → `mutation` 要 `idem` → `slots.resolveAll('gateway.command')` 找到提供方 `memory` → `run(ctx, { command, args, idem })`。
3. memory：zod 再校验 → 查账本 → 返回 JSON；错误只抛 `LiwaError`。
4. gateway → `Response`；cli 按 `render` 人读或 `--json` 原样；退出码按 §3.4。

每次 `resolveAll` 不缓存实例（`00-plugin-kernel.md` §6.2 的代际句柄规则），所以插件被禁用后下一次调用自然解析不到，gateway 回 `unavailable` / `command.provider_gone`。〔推理〕

### 4.3 本机命令

`start`、`stop`、`restart`、`status`、`doctor`、`dump-config`、`profile`、`logs`、`backup`、`restore`、`migrate`：在 `liwa` 进程里执行，不经 gateway；`status` 是混合的：先读本机 `run/boot.json` 与 pid，能连上再问 `status` 操作合并输出（Helm `daemon status` 同形〔一手〕）；本体没跑时照样打印报告，退出码 2。本机命令的 `params`、`render` 同样用 `CommandSpec` 描述，只是 `exec: 'local'`、由组合根声明，进同一份命令面快照。〔推理〕

### 4.4 流式与交互

- `tail`：`kind: 'stream'`，订阅经历流（按主人受众过滤），`--json` NDJSON；`task open <id>`：`interactive`，内置程序 = 订阅那只手的时间线 + 把 stdin 作 steer。
- `chat`：`interactive`，内置程序 = 把终端当一个"地方"（`place: terminal:<pid>` 由 gateway 分配）：每行 → `message.send`（`mutation`，自动幂等键）；同时订阅该地方的时间线，逐字增量只画不重放（`overall.md` §10.3）。斜杠行 `/pause` 在 REPL 里就地转成 `pause` 命令，不送进模型（同 `overall.md` §4.3"斜杠命令本体直接处理"）。
- 插件在 V1 不能加 `interactive` 命令：那需要往 cli 包塞代码，和 08"第三方界面以后"同一条线。〔推理〕

### 4.5 一处声明、三端复用

| 呈现面 | 谁读清单 | 怎么用 `CommandSpec` |
| --- | --- | --- |
| 终端 `liwa` | cli 包（§4.1） | 解析器、帮助、补全（以后）、渲染 |
| 主控台命令面板（含 Mac 客户端、手机页） | console 经 `commands.list`，取 `surfaces ∋ 'palette'` | `summary` 做条目、`params` 生成表单（Koishi / AstrBot 用 schema 生成表单的做法〔`plugin-architecture` 一手调研〕）、`result` 渲染；点击 = 同一个 `Request{ op }` |
| 聊天斜杠命令 | senses 看到主人账号的 `/xxx`（`overall.md` §3.3 senses 职责表）→ 查清单 `surfaces ∋ 'slash'` → 直接走 gateway 派发，不进模型 | 只允许 `kind: 'request'` 且 `params` 全部可从一行文本解析的命令（V1 只有 `pause`、`resume`、家规的"别烦我"） |

主人专属控制项（`overall.md` §11.6）只经 gateway 的主人接口，所以它们在命令清单里全部 `owner: true`，没有第二条路；任何用脑都拿不到清单的执行入口（命令不是内核工具）。〔推理〕

### 4.6 生命周期

- 登记在 `apply`（builtin）或 `create`（required），释放函数由 kernel 收进 effect；第 4 阶段核对"声明的 id 集合 = 登记的 id 集合"（现有槽位核对的同一处）。
- 插件 `disable`：释放 → gateway 下一次 `resolveAll` 看不到；`commands.list` 的结果随之变化；console 收到系统流 `plugin.disabled.v1` 后重取清单。V1 没有热重载，变化只发生在"排空 → 重启"之后。
- `dump-config` / `liwa plugins show <id>` 能看到每个插件声明的命令（`EntryPlan.commands`），禁用的条目带原因。

## 5 分阶段

| 阶段 | contracts / kernel（机制层，以后加不进去的口子） | 命令 |
| --- | --- | --- |
| 现在（kernel-0 收尾） | `protocol/command.ts`（`CommandId`、`RESERVED_COMMAND_GROUPS`、`CommandSpec`、`CommandCatalog`、`buildCommandCatalog`）；`slots/gateway.command.ts` 并进 `SLOT_DEFS`（list、global、any、consumedBy gateway、implemented）；`errors.ts` 的 `not_found` 与 `EXIT_CODE_BY_CATEGORY`；`PluginDef.commands`；loader 第 1 阶段收集与查重、`Meta` 校验；`EntryPlan.commands`；`Request.idem`；`PROTOCOL_OPS`；`protocol.version_mismatch` 错误码 | — |
| m0 | — | `start`、`status`、`doctor`、`dump-config`（本机）；`chat`、`tail`（交互 / 流）；`commands list\|show`（测试锚点）；`--json`、退出码表；本机凭据 |
| V1.0 收尾 | 回环编解码覆盖 `gateway.command` | engineering §12 全部九组，各随所属模块落下（memory 的命令在 05 实现时声明，tasks 的在 02……）；`owner` 与 `mutation` 标记齐；`--host`；主控台命令面板与斜杠命令读同一份清单 |
| 以后 | `single` / `chain` 不涉及；IPC 时 `gateway.command/run` 走 kernel-1 | shell 补全（从清单生成）、别名、`liwa acp serve`（决策 2）、远程令牌的登录流程与已保存主机表（V2 手机远程；Paseo 0.14.0 的 `paseo host ls\|add\|update\|rm` 把已保存主机存在守护进程里〔一手〕，可作参照）、插件的 `interactive` 命令（随第三方界面） |

"装上一个就好一个"在命令上的含义：一个插件的 manifest 多一个 `gateway.command` 条目，它的命令就出现在终端、面板、斜杠三处，不改 cli、console、gateway 任何代码。〔推理〕

## 6 测试

| # | 测什么 | 怎么测 |
| --- | --- | --- |
| C1 | `CommandSpec` 正反例 | contracts：id 规则、`params` 非对象被拒、`interactive` 带 `result` 被拒、JSON 往返、导出一致 |
| C2 | 装配期检查 | kernel 反例：插件命令组 ≠ impl id、impl id 撞保留组、跨插件重复 id、manifest `meta` 不合 `Meta`、声明了命令但 `apply` 没登记 → 被禁用并点名；required 违规致命 |
| C3 | 命令面快照 | cli：对 `profiles/m0-terminal.yml` 跑 `commands list --json`，快照按 `since` 分阶段；`liwa --help` 与每条 `--help` 的渲染快照（像 Helm `cli-surface.test.ts` 守住命令面〔一手〕）；改命令必须改快照 |
| C4 | 退出码表 | 假 gateway 依次回 14 个类别 + 连接拒绝 + 版本不符 → 断言退出码与 stderr 文案；`--json` 时错误以 `{ error: LiwaErrorShape }` 打到 stderr |
| C5 | 参数往返 | argv → body → gateway 用同一份 `params` 校验通过；位置参数与标志的映射对称 |
| C6 | 生命周期 | 测试内核装两个假插件各带命令 → 禁用一个 → `commands.list` 少一包、`liwa <它的命令>` 退出码 1 并说明"由插件 X 提供，当前已禁用" |
| C7 | 回环编解码 | `gateway.command` 的 `run` / `stream` 过 T9 |
| C8 | 清单缓存 | 构建号变 → 重取；离线无缓存 → 只认 id，退出码 2 |

## 7 待实测

`node:util.parseArgs` 对"位置参数 + 子命令组 + 重复标志"的覆盖是否够，不够再上 commander；`z.toJSONSchema` 对 `.default()`、`.min()`、枚举的导出与手写 manifest JSON 的比对是否稳定（CI 比对的噪音）；`liwa status` 的冷启动时间（目标 < 200 ms，不加载本体代码）；`chat` 的逐字增量在 Tailscale 中继下的体验；斜杠命令一行文本解析的覆盖面。

## 8 依据

- 命令 = 操作、菜单是呈现：VS Code `contributes.commands`（id、title、category 进 manifest，处理函数在代码里 `registerCommand`，调用触发 `onCommand` 激活）〔一手，vscode-docs `contribution-points.md`〕；Helm 插件的 `addSlashCommand` / `addCommandCenterItem` 与服务端 `handle(rpcContract)` + 客户端 `rpc(contract)`（名字正则 `^[a-z][a-z0-9._-]*$`，zod 定入参出参）〔一手，`packages/plugin/src/{client,server}/contracts.ts`、`rpc.ts`〕。**Paseo 0.14.0 的插件仍不能给 `paseo` 加子命令**：`docs/plugins.md` 列的贡献面是守护进程 RPC、界面、面板、命令面板项、客户端斜杠命令、时间线、主题、附件源、设置页；服务端 manifest 里的 `build` 只是准备命令〔一手，`docs/plugins.md`、`packages/server/src/server/plugins/manifest.ts`〕。灵鲸把终端、面板、斜杠统一到一份清单，是在它之上多走一步。
- 插件不许覆盖内置、不许往内置加子命令：kubectl 插件文档〔一手〕。gh 把新功能先做成扩展、只有通用功能才合入主干〔一手，`docs/working-with-us.md`〕。
- 列命令不加载代码：oclif `oclif.manifest.json`（生成物，版本不符报错；`findCommand` 才加载命令文件）〔一手，`src/config/plugin.ts`〕。
- 命令随插件作用域释放：Koishi `Commander` 在创建根指令时 `ctx.collect('command <name>', () => root.dispose())`〔一手，`packages/core/src/command/index.ts`〕。
- 命令行形状：Helm `createCli` 的全局 `--json` / `--host` / `--home`、`withOutput` 统一渲染与错误、`selectDaemonTarget` 的本机 / 远程二选一与 `localOnly`、`daemon status` 本机 + 探测合并、`readLocalCredentialForTarget` 按 pid 文件的 `listen` 匹配后读本机凭据、`cli-surface.test.ts` 用 `helpInformation()` 守命令面（0.14.0 同时守标志的取舍，如 `--no-wait` 取代 `--background`）〔一手，`packages/cli/src/`、`packages/server/src/server/local-credential.ts`〕；Codex 单可执行多子命令、`hide = true` 的内部命令、`completion`、`doctor`〔一手，`codex-rs/cli/src/main.rs`〕。
- 项目内：方法形状规则与"静态描述进 manifest"（`00-contracts.md` §2.2）；槽位门面、第 4 阶段核对登记、代际句柄（`00-plugin-kernel.md` §5、§6）；斜杠命令不进模型（`overall.md` §4.3、§10.4）；主人专属控制项只经 gateway（`overall.md` §11.6）；本机凭据文件（`overall.md` §11.1）；命令表与退出码（`engineering.md` §12）。
- 退出码加 4、保留组清单、插件组 = impl id、本机命令只归组合根、`interactive` 不开放给插件、清单缓存按构建号：〔推理〕；决策 35 ④ 全部按本稿定下（插件命令以自己的 impl 为组、退出码 4、`status` 本体没跑退出码 2、m0 加 `commands list|show`、插件第一版不能加本机与交互命令）。
