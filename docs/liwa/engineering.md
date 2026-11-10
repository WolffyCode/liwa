# 工程约定与代码实现设计

更新：2026-10-29。状态：**已确认**（决策 29–35）。用途：路线图 1.5。定下代码层面的骨架：插件机制底座、协议规范怎么和它绑定、仓库怎么分包、每个模块落在哪、数据怎么访问、进程怎么组织、怎么测、怎么跑。它不重复模块文档的内容，只定"所有模块共同遵守的东西"。依据：`architecture/overall.md` §3、§6、§9；`architecture/modules/00-plugin-kernel.md`、`00-contracts.md`、`00-commands.md`；`research/2026-10-29-verify-layout.md`（目录树、依赖规则与 §9 的规则验证）；`research/2026-10-28-plugin-architecture.md`；`research/2026-10-28-paseo-architecture.md` Q4、Q10；决策 1、2、3、17。

## 1 总思路：万物插件化的形状，内核的裁判

1. **形状照 DSH 来。** 运行时用上游 `cordis`（精确钉 `4.0.0-rc.12`，MIT，DSH 的底）；loader 自己写，照 DSH 的形状：`package.json` 的 `liwa` 字段当 manifest、导入代码前校验、profile 叠 patch、`dump-config` 打印装配树。不引入 `@deepseek-ai/dsh` 本身。
2. **信任边界是模型与外界，不是插件与内核。** 所有插件都是一方代码（仓库内、开源、本机自用），对内核完全可信：能读任何账本、订阅经历流、用进程与能力（决策 32）。约束只有工程纪律：`@liwa/core` 里的插件 required 且不可替换（其中九样是三条硬规矩所在）；写只经各账本的写 API（单点写、校验集中、可回放）；主人专属操作要带 gateway 签发的主人令牌；cordis 的上下文不出 kernel。隐私只管两处：进她上下文的内容按受众裁，对外投递按受众查。
3. **协议规范就是 `contracts` 包，和插件机制绑定。** 每个槽位一份契约（方法描述 + 整数版本），manifest 声明实现哪些槽位、用哪个契约版本；版本对不上启动时大声报错。槽位契约全是可序列化的异步消息；required 之间的进程内 API 不受此限。
4. **"装上一个就好一个"靠 profile。** 里程碑就是 profile，每个 profile 属于一个阶段集合（m0 / m1 / v1）；每个插件一个包、各自的文档和测试，先有契约再有实现。第一版它的含义是"给已有槽位加实现"。
5. **agent CLI 走 Paseo 的契约，不是 ACP。** 大脑槽位契约从 Paseo 的 `AgentClient` / `AgentSession` 裁剪，ACP 只是其中一种适配器；可选对外开 ACP 服务端口。

## 2 插件机制底座（`packages/kernel`）

| 部件 | 做什么 | 来源 |
| --- | --- | --- |
| 运行时 | 上游 `cordis` 4.0.0-rc.12：上下文、服务按键挂载、`inject`、effect、fiber、`isolate`、五种分发；全部包在 kernel 里，类型与实例不外泄 | cordis 源码 |
| 门面 | 插件拿到的 `KernelContext` 是 kernel 自建的冻结对象：`instanceId`、`pluginId`、`impls`、`signal`、`clock`、`rng`、`ids`、`log`、`services`（按 `inject` 收窄；builtin 的 `journal` 是只读视图）、按种类裁剪的 `slots`、`effect`、`on`；没有 `emit`、没有 provide 服务键的途径 | `00-plugin-kernel.md` §7 |
| manifest | `liwa` 字段：`manifestVersion`、`kernelApi`、`id`、`kind`（只用来核对）、`runtime`（进程内 / 子进程）、`multiInstance`、`provides`（槽位 → 契约版本、impl、meta）、`consumes`（服务键或视图 → 版本）、`launch`、`resources`、`data` | DSH 形状；§3.1 |
| loader | 五阶段：计划校验（按 realpath 推导种类、meta 校验、实例身份、静态服务图加槽位边、层表检查、槽位计划、阶段集合、命令声明）→ 注册 → 恢复 → 槽位就绪 → 开放业务；每步有时限；宁可不起 | §5 |
| 槽位注册表 | 基数 bound / member-single / list / registry（single、chain 保留）、作用域、`transport`、`requiredBy` / `consumedBy`、`describe`；两份门面；带代际的句柄与 `AbortSignal` | §6 |
| 钩子 | `apply`（只登记）、`ready`（接活）、`drain`（先停）、`health`、required 的 `recover` 与同步 `finalize` | §5、§8 |
| 注入 | 挂钟与单调钟、可控定时器、按标签分流可恢复的随机源、带启动序号的编号源、密钥解析器、日志；`bootSeq` 与 `build` 由组合根传入 | §8、§9 |
| `dump-config` | 静态装配计划 `AssemblyPlan`（含 `build`、`assemblyHash`、`hashInput`）；插件页与 `liwa commands` 离线清单只读它 | §4.3 |
| IPC 宿主 | kernel-1，推迟到第一个进程外插件；fd 3 管道、JSON-RPC 2.0、受限反向视图 | §10 |

## 3 协议规范（`packages/contracts`，零运行时依赖，zod 4 除外；浏览器可用）

| 目录 | 内容 |
| --- | --- |
| `index.ts` | 版本常量、`SLOT_DEFS`、`SLOT_CONTRACTS`、`SERVICE_KEYS`、`SERVICE_VERSIONS`、`SERVICE_LAYERS`、`REGISTRAR_METHODS`、`PLUGIN_VIEWS`、`EVENT_TYPES`、`STAGE_SETS`、`PROTOCOL_OPS`、`RESERVED_COMMAND_GROUPS` |
| `z.ts`、`common.ts` | 统一导出的 zod 4；基础类型、`CallContext`、`SecretRef`、`Unit`、`JsonValue`、`ClientOf`、`LIWA_BLOCK_TAG` |
| `services.ts`、`service-layers.json` | 服务键与版本、层表（JSON 是唯一来源，kernel 与 dependency-cruiser 都读它）、登记类方法表、视图清单、阶段集合 |
| `manifest/` | manifest、profile、patch、`AssemblyPlan` 的 schema（`strictObject`、`partialRecord`） |
| `slots/`、`views/` | 每个槽位一个文件（`Meta`、`Methods`、`Handles`、版本、回退语义）与 `SLOT_DEFS` / `SLOT_CONTRACTS`；视图的方法描述（第一版只有 `procs.spawn`） |
| `events/` | 事件信封、`AppendRequest` / `CommittedEvent`、kernel 事件、各模块事件载荷 |
| `ledgers/`、`tools/` | `Journal` / `JournalReader`、`Services` / `PluginServices` 与各服务类型；内核工具目录 `ToolSpec` / `ToolDef` |
| `protocol/` | 前后端信封（`client.ts`）、命令（`command.ts`）、IPC 信封（`ipc.ts`）、HostBridge（`host.ts`，随 08） |
| `errors.ts` | 14 个错误类别、`LiwaError`、JSON-RPC 码表、退出码表、协议级错误码 |
| `schemas/` | 导出的 JSON Schema（生成物，入库，CI 核一致）【V1.0】 |

规则：插件包只能 `import` `@liwa/contracts` 和 `@liwa/kernel` 的公开入口，由 dependency-cruiser 强制；契约改版本号时同一提交改完所有内置实现，不留兼容层。

## 4 仓库结构与模块落位

锁定版：覆盖 m0 到 V5，每样东西唯一归属；标【m0】【V1.0】【V1.1】【V2】【V4】【V5】【kernel-1】是建它的时间，之后不再挪。

### 4.1 顶层

```
liwa/
  .node-version                 24.18.0；engines 同步钉死【m0】
  package.json                  工作区根：工程脚本（ci、lint、typecheck、test、test:contract、contracts:export）与 `pnpm liwa` 别名；开发依赖；pnpm catalog 钉 cordis、zod【m0】
  pnpm-workspace.yaml           工作区包位置的唯一来源（apps/*、packages/*、packages/plugins/*、packages/lib/*、tools）与 catalog；vitest、dependency-cruiser 经 tools/workspace.cjs 读它【m0】
  tsconfig.base.json            本体侧（Node）编译选项：strict、ESM、NodeNext、types: ["node"]、customConditions: ["liwa-source"]【m0】
  tsconfig.web.json             浏览器与同构包的编译选项：lib 加 DOM、jsx、types 为空【m0：contracts、client 起用】
  tsconfig.json                 根目录自身的 TS 文件【m0】
  vitest.config.ts              按工作区生成测试项目（有 tsconfig.json 的包各一个；浏览器代码另建 <包名>:web；contract 项目手动触发）【m0】
  eslint.config.js              §9 的规则【m0】
  .dependency-cruiser.cjs       §4.6 的包间规则与 §5 的层表（层表从 contracts/src/service-layers.json 读）【m0】
  THIRD_PARTY_NOTICES.md  LICENSE  README.md  .gitignore
  profiles/                     仓库层装配清单（只放 profile）：m0-terminal.yml、m1-skeleton.yml、v1.yml、dev.yml【m0 起】
  apps/                         有自己进程入口的东西：liwa【m0】、desktop【V1.1】、mobile【V5】（§4.2）
  packages/                     被引用的库与插件（§4.2）
  tools/                        仓库工程工具，不放产品命令（§4.4）
  docs/                         底座自带文档；灵鲸文档在 docs/liwa/（§4.5）
```

### 4.2 包

| 包 | 目录 | 职责 | 允许依赖 | 建于 |
| --- | --- | --- | --- | --- |
| `@liwa/app` | `apps/liwa` | 本体组合根与进程入口：自检、信号、`boot.json` 与启动失败计数、安全模式页、launchd、`LIWA_HOME` 初始化、日志与密钥注入、`build` 计算；本机命令的编排与 `LOCAL_COMMANDS`；依赖全部插件包与 console（把主控台构建产物交给 gateway 托管） | 全部 | m0 |
| `@liwa/desktop` | `apps/desktop` | Electron 薄壳：加载本体 URL、托盘、通知、自启、快捷键；preload 实现 HostBridge；V5 桌宠窗口 | contracts、client、electron | V1.1 |
| `@liwa/mobile` | `apps/mobile` | 原生手机端（含实时通话入口） | contracts、client、RN 依赖 | V5 |
| `@liwa/contracts` | `packages/contracts` | 协议规范；浏览器可用（继承 `tsconfig.web.json`） | zod | m0 |
| `@liwa/kernel` | `packages/kernel` | 插件机制底座；`./testing` 子入口放测试内核与假原语 | contracts、cordis、yaml、Node 内置 | m0 |
| `@liwa/core` | `packages/core` | 全部 required 插件，每模块一个目录一个 `defineService`；入口导出 `REQUIRED`（全集，kernel 按阶段集合挑）与离线操作（backup、restore、migrate、selfCheck）；不带 `liwa` 字段 | contracts、kernel、`node:sqlite`、`node:worker_threads`、@node-rs/jieba | m0 起 |
| `@liwa/client` | `packages/client` | 客户端连接与服务端副本 store：握手、请求响应、订阅与游标、重连退避、幂等键；同构（浏览器、Node、RN） | contracts；不许 Node 内置 | m0 |
| `@liwa/cli` | `packages/cli` | `liwa` 命令行的唯一可执行入口（`bin/liwa.js`）：解析、渲染、退出码；本体命令经 client；`acp/`（`liwa acp serve`，以后） | 静态：contracts、client；本机与开发命令只许动态 import `@liwa/app`、`@liwa/replay` | m0 |
| `@liwa/console` | `packages/console` | 网页主控台 SPA（React + Vite；V2 起响应式即手机远程），由 gateway 托管；内置区域（`areas/`）、`host/`（HostBridge 网页实现）、`plugins/`（插件界面注册表，构建时按组合根的依赖表生成）、`entries/`（main；pet【V5】） | contracts、client、ui-sdk、react、react-dom；插件 `./client` 入口只许 `src/plugins/` 引用 | V1.0 |
| `@liwa/ui-sdk` | `packages/ui-sdk` | 界面插件开发包：`ui.*` 槽位类型、`defineUiPlugin`、建在 client 上的 React hooks | contracts、client、react | V1.1 |
| `@liwa/plugin-sdk` | `packages/plugin-sdk` | 进程外插件的 IPC 客户端：`src/` TS 版、`python/` 的 `liwa_plugin_sdk` | contracts | kernel-1（Python 版随第一个 Python 插件） |
| `@liwa/testkit` | `packages/testkit` | 服务假实现、假出口、脚本化假大脑、装配夹具、断言助手（不含任何插件；假原语在 kernel `./testing`） | contracts、kernel（含 `./testing`） | m0 |
| `@liwa/replay` | `packages/replay` | `l0/`、`l1/`【V1.1】、`l2/`、`scenarios/`（20 场景的唯一定义）、`probe/`（探针）、`metrics/`（A–G） | contracts、kernel（含 `./testing`）、core、app、testkit | m0（探针）；V1.0（L0 与指标） |
| `@liwa/brain-shared` | `packages/lib/brain-shared` | 三个大脑适配器共用的 Paseo 基础代码（含原样保留的 `agent-sdk-types.ts`、`<liwa-block>` 渲染）；库，不带 `liwa` 字段 | contracts、kernel | m0 |
| `@liwa/plugin-<槽位简名>-<实现名>` | `packages/plugins/<槽位简名>-<实现名>` | 槽位实现，一包一插件；运行位置由 manifest `runtime` 声明；有界面加 `client/` | 进程内：contracts、kernel、自己声明的第三方（大脑加 brain-shared）、自己的 `shared/`；子进程：contracts、plugin-sdk、自己的第三方；`client/`：contracts、client、ui-sdk、react、自己的 `shared/` | 见下表 |
| `@liwa/tools` | `tools` | 仓库工程工具 | contracts 与根开发依赖；不依赖 app | m0 |

槽位简名：`brain.provider` → `brain`，其余取槽位名去点（memory-engine、growth-engine、social-model、social-pack、persona-template、job-trigger、ability-embed、ability-speech、ability-vision、ability-world、gate-policy、tool、form）；目录名 = manifest `id` = 包名去掉 `@liwa/plugin-`，`tools/check-layout.ts` 查三者一致。

| 插件包 | 槽位 · impl | runtime | 建于 |
| --- | --- | --- | --- |
| `brain-claude-code` | `brain.provider` · claude（Paseo 摘） | in-process | m0 |
| `brain-codex` | `brain.provider` · codex（Paseo 摘） | in-process | V1.0 冒烟；V1.1 全验证 |
| `brain-acp` | `brain.provider` · acp，`multiInstance`（Paseo 摘，不验收） | in-process | V1.0 |
| `brain-replay` | `brain.provider` · replay：录放大脑，测试与 L1 回放用 | in-process | m0 |
| `memory-engine-default` | `memory.engine` · default | in-process | V1.0 |
| `memory-engine-minimal` | `memory.engine` · minimal：替换演练用的极简引擎 | in-process | V1.1 |
| `growth-engine-default` | `growth.engine` · default | in-process | V1.0 |
| `social-model-default` | `social.model` · default | in-process | V1.0 |
| `persona-template-default` | `persona.template` · default（data）：人设与出生设定样板 | — | m0 |
| `social-pack-default` | `social.pack` · default（data）：关系与角色内容包 | — | V2 |
| `job-trigger-time` | `job.trigger` · time：`meta.kinds` = cron、once、interval（解析从 Paseo 摘） | in-process | V1.0 |
| `ability-embed-local` | `ability.embed` · local：Qwen3-Embedding-0.6B（进程内 node-llama-cpp；退路换 Python 子进程，同包同 id，只改 `runtime`） | in-process | V1.0 |
| `ability-speech-local` | `ability.speech` · local：Paseo speech + dictation，SenseVoice / Whisper | in-process | V1.1 |
| `ability-speech-<厂商>`、`ability-vision-<厂商>`、`ability-world-<来源>` | 线上实现；日历【V4】 | in-process | V1.1 |
| `gate-policy-default` | `gate.policy` · default：群聊第二道门 | in-process | V2 |
| `form-wechat`、`form-<平台>` | `form.adapter` · 平台名 | subprocess | V2 起；V4 |
| `tool-<名字>` | `toolport.tool` 的贡献 | in-process | V3 |
| `sandbox-<后端>` | `sandbox.provider`（以后可加的槽位） | — | V4 |
| `<槽位简名>-local`（Python 模型服务，如需） | 本地模型服务就是一个插件包：`package.json`（manifest，`runtime: subprocess`，`launch` 用 uv）+ `pyproject.toml` + `uv.lock` + `.python-version` + `src/liwa_<id>/` + `tests/`；不设顶层 `services/` | subprocess | 需要时 |

所有包同一版本号随仓库升，`private: true`、`type: module`，engines 只在根。各包 `exports["."]` 带条件：`liwa-source` → `./src/index.ts`（开发、测试、类型检查；tsconfig 的 `customConditions` 与 vitest 的 `resolve.conditions` 都设了它）、`types` → `./dist/index.d.ts`、`default` → `./dist/index.js`；外加 `"./package.json"`；有界面的插件加 `"./client"`；kernel 加 `"./testing"`；Python 插件只导出 `"./package.json"`。跨包允许的入口只由各包 `exports` 决定。生产构建另设 `tsconfig.build.json`（去掉 `customConditions`）。

### 4.3 包内布局

**组合根 `apps/liwa/src/`**：`index.ts`（公开入口：`assemblyOptions`、`dumpAssembly`、`LOCAL_COMMANDS` 与本机命令实现，只给 cli 动态加载）、`main.ts`（进程入口：自检 → 自动禁用候选 → `startKernel` → 信号 → 关闭截止）、`commands/`（start、stop、restart、status、doctor、dump-config、profile、logs、backup、restore、migrate 的编排）、`home/`（`LIWA_HOME` 目录表与首次初始化、`liwa.config.json` 模板）、`boot/`（`boot.json`、崩溃处理、`params.ts`）、`build-info.ts`（`build` 字符串）、`safe-mode/`（不经 kernel 的极简页）、`logging/`（pino、按天轮转、脱敏）、`secrets/`（钥匙串与 `secrets.env` 解析器）、`launchd/`【V1.0】、`__tests__/`。

**core 的模块目录**（`packages/core/src/<模块>/`，账本是 `core/src/ledgers/<账本>/`）：

```
index.ts        公开 API + defineService(...)；跨模块只许引用它
types.ts        模块内类型；对外类型在 contracts
params.ts       数值参数（初值、单位、来源）
migrations/     本模块拥有的表的 DDL：NNN_<名字>.sql（有表才有），由本模块的 recover 调 db 的执行器
worker.ts       本模块的 worker 线程入口（有重查询才有，如 ledgers/memory）
ledger.ts、projection.ts   账本专有：校验与写事件、事件到表
<实现>.ts
__tests__/
```

`core/src/index.ts` 导出 `REQUIRED` 全集与离线操作；`core/src/db/` 只放 `openWriter` / `openReader`、迁移执行器与 `schema_version(owner, version)`、worker 启动助手、备份与恢复；`packages/core/test/` 放 core 内跨模块集成、真实 loader 装配、删表重建等价。

**插件包**（`packages/plugins/<id>/`）：

```
package.json    liwa 字段（manifest）；exports 含 "."、"./package.json"，有界面再加 "./client"
README.md       实现哪个槽位、契约版本、配置项、来源
NOTICE          第三方来源（摘了代码才有；CI 规则：有 src/paseo/ 就必须有 NOTICE）
src/            后端（进程内或子进程）：index.ts（export const plugin）、config.ts、adapter.ts、paseo/（摘来的代码保持原目录结构，文件头注明来源仓库、提交号、原路径、许可证、本地改动）、__tests__/
client/         界面贡献（浏览器）：index.ts、tsconfig.json（继承 tsconfig.web.json）、__tests__/【按需，V1.1 起】
shared/         本插件 src 与 client 共用的纯 schema，只依赖 contracts【按需】
test/           本插件的跨文件集成测试【按需】
```

### 4.4 tools

`tools/` 只放仓库工程工具，不放产品命令：`ci.sh`（lint、typecheck、test、python、检查项）、`workspace.cjs`（工作区布局的唯一读取口：解析 `pnpm-workspace.yaml`，给 vitest、dependency-cruiser、检查脚本用）、`check-layout.ts`（目录名 = manifest id = 包名后缀；core 目录 = 层表 = `SERVICE_KEYS`，另加 `db`、`__tests__`）、`check-notices.ts`（有 `src/paseo/` 或"来源"文件头的包必须有 NOTICE 且在 `THIRD_PARTY_NOTICES.md` 登记）、`contracts-schemas.ts`（写出或核对 `packages/contracts/schemas/`）【V1.0】。本机运维（启停、自检、装配树、备份、恢复、迁移）只经 `liwa` 命令。

### 4.5 docs/liwa

灵鲸文档统一放在主分支 `dsh-base` 的 `docs/liwa/`，底座自带文档在 `docs/` 其余位置。本目录包含：`product.md`、`portrait.md`、`roadmap.md`、`engineering.md`、`architecture/overall.md`、`architecture/README.md`、`architecture/modules/00–10`、`plans/`（实现计划）、`scenarios/`（场景图页）、`research/`（调研与评审）、`handoff.md`。只存最新方案。

### 4.6 依赖规则（dependency-cruiser 强制）

| 从 | 可以依赖 | 规则名 |
| --- | --- | --- |
| contracts | zod；不许 Node 内置与 Node 全局（`tsconfig.web.json` 保证） | `contracts-only-zod`、`contracts-no-node-builtins` |
| kernel | contracts、cordis、yaml、Node 内置 | `kernel-allowed-deps`；`plugins-no-cordis` 另外禁止插件直接依赖 cordis |
| core | contracts、kernel、@node-rs/jieba、Node 内置；core 内按 §5 层表 | `core-allowed-deps` + §5 |
| testkit | contracts、kernel（含 `./testing`） | `testkit-allowed-deps` |
| lib/<x> | contracts、kernel | `lib-allowed-deps` |
| lib/brain-shared 的使用方 | 只有 `plugins/brain-*` | `brain-shared-only-for-brains` |
| plugins/<x>/src（进程内） | contracts、kernel、自己声明的第三方；brain-* 加 brain-shared；自己的 `shared/`；不碰 core（含测试与纯类型）、不 import `child_process`、不依赖别的插件 | `plugins-workspace-deps`、`plugins-not-to-core`、`plugins-no-child-process` |
| plugins/<x>/src（`runtime: subprocess`，TS） | contracts、plugin-sdk、自己声明的第三方；不许 kernel | `plugins-subprocess-deps`（配置读各插件 manifest 的 `runtime` 生成） |
| plugins/<x>/client | contracts、client、ui-sdk、react；自己的 `shared/`；不许自己的 `src/`、kernel、Node 内置 | `plugin-client-deps`、`plugin-src-not-client` |
| plugins/<x>/shared | contracts | `plugin-shared-pure` |
| client | contracts；不许 Node 内置 | `client-allowed-deps` |
| ui-sdk | contracts、client、react | `ui-sdk-allowed-deps` |
| plugin-sdk | contracts | `plugin-sdk-allowed-deps` |
| cli | 静态：contracts、client；动态 import：app、replay | `cli-allowed-deps` + `cli-heavy-only-dynamic`（`to.dependencyTypesNot: ['dynamic-import']`） |
| console | contracts、client、ui-sdk、react、react-dom；插件 `./client` 入口只许 `src/plugins/` 引用 | `console-allowed-deps` |
| apps/desktop | contracts、client、electron | `desktop-allowed-deps` |
| apps/mobile | contracts、client、RN 依赖 | `mobile-allowed-deps`【V5】 |
| replay | contracts、kernel（含 `./testing`）、core、app、testkit | `replay-allowed-deps` |
| testkit 与 kernel `./testing` 的使用方 | 测试文件、testkit、replay | `testkit-only-in-tests` |
| apps/liwa | 全部（含 console） | — |
| tools | contracts 与根开发依赖；不依赖 app | `tools-allowed-deps` |
| 跨包深引用 | 只许对方 `exports` 声明的入口（规则从各包 `exports` 读允许的入口；包名子路径由 Node `exports` + `not-to-unresolvable` 兜住） | `only-public-entry-across-packages` |
| 产品代码不碰测试文件、第三方开发依赖 | — | `not-to-test`、`not-to-dev-dep` |
| 任意成环 | — | `no-circular`（文件级）+ `core-module-no-cycle`（模块级，`scope: 'folder'`） |

core 内的层表同时约束 import（dependency-cruiser）与 required 之间的 `inject`（kernel 第 1 阶段）；层表只有 contracts 的 `service-layers.json` 一份。

### 4.7 每个模块落在哪

层按 §5；种类：required = 内核不可替换，builtin = 内置的槽位实现（进程内或子进程由 manifest `runtime` 声明），客户端 = 不经 kernel 装配。

| 模块 | 位置 | 层 | 种类 | 服务键 / 槽位 | Paseo 来源 |
| --- | --- | --- | --- | --- | --- |
| 插件宿主 | `kernel/` | 宿主 | required | 两份槽位门面 | — |
| 组合根、安全模式、`boot.json`、本机命令编排 | `apps/liwa` | — | — | `LOCAL_COMMANDS` | — |
| journal、db | `core/journal`、`core/db` | 基础 | required | `journal` | — |
| guard | `core/guard` | 守护 | required | `guard` | — |
| procs | `core/procs` | 资源 | required | `procs`；`finalize` 杀进程组 | `managed-processes`、tree-kill、spawn 的规则 |
| brains | `packages/brain/brain` | 资源 | 服务定义／提供方登记表 | `brains`；brain.provider、probe、prepareConfigDir、blobs | AgentClient 能力；provider-snapshot-manager／mutable-provider-config-owner／agent-configuration-validator；配置真相见 00 §5.1 |
| Claude、Codex、ACP、录放适配器 | `plugins/brain-*` | 资源 | builtin | 提供 `brain.provider` | `providers/claude/`、`codex-app-server-agent.ts` + `codex/`、`acp-agent.ts` + `generic-acp-agent.ts` + `acp-options.ts`；工具调用归一放 brain-shared |
| abilities | `core/abilities` | 资源 | required | `abilities`；消费 `ability.*` | — |
| 本地嵌入、语音、看图、世界源 | `plugins/ability-*` | 资源 | builtin | 提供 `ability.*` | `speech/` + `dictation/`（上游 0.14） |
| 本地模型服务（如需） | `plugins/<槽位简名>-local` | 资源 | builtin，`runtime: subprocess` | 提供对应 `ability.*` | — |
| formhost | `core/formhost`【V2】 | 资源 | required | `formhost`；消费 `form.adapter` | — |
| 微信等形态适配器 | `plugins/form-*` | 资源 | builtin，`runtime: subprocess` | 提供 `form.adapter` | — |
| workspace、notify | `core/workspace`、`core/notify` | 资源 | required | `workspace`、`notify` | 工作区概念；`agent-attention-policy` 放 notify |
| roster、self、body、memory、people、skills 的账本层 | `core/ledgers/*` | 账本 | required | 同名服务键；经 `HostSlots.resolve` 拿各自的引擎 | — |
| 记忆引擎、成长引擎、关系模型、人设样板、关系内容包 | `plugins/*-default` | 账本的引擎 | builtin / data | 提供 `memory.engine`、`growth.engine`、`social.model`、`persona.template`、`social.pack` | — |
| senses、attention、will、scheduler、tasks、outbox | `core/*` | 编排 | required | 同名服务键；scheduler 消费 `job.trigger`；senses 消费 `gate.policy`（V2） | `agent-prompt.ts` 的系统信封与完成通知 |
| 作业触发类型 | `plugins/job-trigger-time` | 编排 | builtin | 提供 `job.trigger` | `cron.ts`、`cron-expression.ts` |
| minds、context、actions | minds 为 `packages/brain/minds`；context/actions 随所属模块 | 运行 | minds 服务定义 + 实现；策略插件消费它 | ctx.minds；独立 minds-restart-recovery、minds-idle-cleanup、minds-structured-generation（ctx.structuredGeneration） | AgentManager 整块融合，数据／接口归 02，包与 Config 归 01 §4.9；可替换策略独立挂行 |
| toolport、gateway | toolport 为 `packages/brain/toolport`；gateway 随其模块 | 接入 | toolport 服务定义 + MCP 端点；tool-minds 是工具消费方／贡献方 | ctx.toolport 登记表；tool-minds 向它 register；gateway 消费主人命令 | mcp-server/mcp-shared/tools 类型与策略搬到 toolport，agent 处理器在 tool-minds；不固化工具目录 |
| 客户端连接 | `client/` | 客户端 | — | — | `@getpaseo/client` 的形状 |
| 命令行入口 | `cli/` | 客户端 | — | — | `@getpaseo/cli` 的形状 |
| 主控台六区域、开发者视图、插件页 | `console/` | 界面 | 内置 | `ui.area.*`、`ui.*` 归 console；插件界面在各插件的 `client/` | — |
| 界面插件开发包 | `ui-sdk/` | 界面 | — | — | — |
| Electron 薄壳、原生手机端 | `apps/desktop`、`apps/mobile` | 客户端 | — | HostBridge | — |
| L0 / L1 / L2、指标、20 场景、探针 | `replay/` | 工具 | — | — | — |
| 假实现与装配夹具 | `testkit/` | 工具 | — | — | — |

### 4.8 Paseo 剥离的落位

迁入固定 `paseo-upstream@8018231a`，原样拷到各包 src/paseo 后原地改接缝，逐文件来源／改动记 NOTICE，单独 tsconfig.paseo.json；自写源码严格编译。只用公开包入口，模型工作经受管提供方，不搬其 daemon 基础设施。以下是定位索引，完整文件、Config、inject、测试清单分别归 [01-agent-cli](architecture/modules/01-agent-cli.md) §4.9/附录 A 与 [01-brain-host](architecture/modules/01-brain-host.md) §9.3/§9.4。〔一手〕决策 67；`packages/brain/brain-shared/NOTICE:1`；〔推理〕落位。

| Paseo 路径 | 落到 | 处理 |
| --- | --- | --- |
| AgentClient／AgentSession、共享 timeline/protocol/utils | brain-shared | 共享一份；BrainProvider 返回 AgentSession，完整契约只在 00 §5.1 |
| providers/claude、codex-app-server-agent/codex、ACP | brain-claude-code／brain-codex／brain-acp | CLI 专属策略在提供方；经 launch/subprocess，空壳由灵鲸显式注入 |
| AgentManager 与运行／创建／归档／投递／完成订阅文件 | @liwa/minds | 整块搬运；AgentStorage 接口/schema 搬，实现换 storage-domain；durable timeline 落 JSONL |
| provider-snapshot-manager／mutable-provider-config-owner／agent-configuration-validator | @liwa/brain | 目录／校验归提供方表；provider-registry/runtime 不搬，改 Cordis register |
| restart-recovery／idle-runtime-cleanup／agent-response-loop + structured-generation-providers | 三个独立 minds-* 插件 | 有 Config，可在 Cordis 禁用／替换；结构化服务键 ctx.structuredGeneration |
| mcp-server/mcp-shared/tools 类型／序列化／策略 | @liwa/toolport | 登记表取目录、Bearer 按 agentId/gen；端点 liwa |
| paseo-tools 的 agent 组 | @liwa/tool-minds | 原处理器名保留，catalog 映射灵鲸 spawn/look/answer/manage，登记返回 disposer |
| AgentManager 层与 MCP 目录；Session、websocket-server、插件平台、relay、Hub | 前两项按决策 67 搬运并融合；其余五项不搬 | Paseo 插件平台扩展点换成 Cordis 登记／opening 瀑布／minds.*.v1；远程产品留多端阶段 |
| managed-processes、spawn/tree-kill | 底座 subprocess | 只借登记与对账要求，不搬 fs 后端／独立进程服务 |
| 语音／调度／工作区等其他产品域 | 各模块阶段 | 不因 AgentManager import 闭包带回本层；处置见 01 附录 A |

## 5 模块在代码里怎么划界

- **一个模块一个目录或一个包**，`index.ts` 只导出公开 API 和它的插件定义；`types.ts` 放本模块类型；其余文件都是内部实现。跨模块只能引用对方的 `index.ts`，深层引用由 dependency-cruiser 禁止；core 根目录的文件也只许经模块 `index.ts`。
- **依赖方向按层表**（唯一来源是 `packages/contracts/src/service-layers.json`，下表是它的说明；`overall.md` §3.2 与此一致）：

  | 层 | 服务 | 说明 |
  | --- | --- | --- |
  | 接入 | gateway、toolport | 外界怎么跟本体说话 |
  | 编排 | senses、attention、will、scheduler、tasks、outbox | 认知循环里由代码做的判断 |
  | 运行 | minds、context、actions | 把用脑跑起来、把动作执行掉 |
  | 账本 | roster、self、body、memory、people、skills | 她的状态；经槽位注册表解析各自的引擎 |
  | 资源 | brains、procs、formhost、abilities、workspace、notify | 外部资源 |
  | 守护 | guard | 横切所有动作 |
  | 基础 | journal（`db/` 目录并入此层，它不是服务） | 经历流 |

  插件宿主是 kernel 包，不在 core 的 import 图里；builtin 不在层里，它在图上处于它所填槽位消费方的下一层（`00-plugin-kernel.md` §5.5）。
- **三条执行点**：① 调用只能向下，同层只调公开 API 且不成环——dependency-cruiser 查 import（文件级与模块级成环都查）；② required 之间的 `inject` 只许指向同层或更低层——kernel 第 1 阶段查，dependency-cruiser 看不见注入；③ **服务注入的方向检查**与 import 用同一张层表，违规都是启动失败。
- **上层工具能力登记到运行层**：toolport（接入）在 ready 调 minds.attachToolport({ issue, toolsFor }) 并把返回 disposer 挂 effect；minds 不 inject toolport。工具贡献插件消费两服务并向 toolport.register；提供方/消费方/服务定义三角色完整。〔一手〕决策 67 F9；`packages/core/tools/src/index.ts:128`；〔推理〕层表落位。
- **向上传信息**只有两条路（`overall.md` §3.2 规则 2）：持久的事走经历流事件订阅；不需要持久的走**进程内信号**，在代码里就是上层向下调用下层的登记或汇报 API（gateway 调 `notify.reportPresence`、senses 经 `formhost.onInbound(cb)` 订阅）；minds 的 Cordis 进程内事件按 00 §6.1 声明，持久事实仍走唯一 JSONL，不能把通知当第二权威日志。
- **每样数据只有一个写入方**（overall §2.3）：只有所有者模块持有写连接或写 API；迁移 SQL 跟着表的所有者模块放在它的 `migrations/`。
- **账本与引擎分开**：账本只经槽位注册表解析契约接口、把按受众裁过的输入推给引擎、复核引擎返回的编号；引擎在 `plugins/*`，只依赖 contracts 与 kernel，经 `inject` 读账本的查询 API。
- **时钟、随机、编号一律注入**（`Clock`、`Rng`、`Ids`），ESLint 禁止系统时钟与随机；这是 L0 可回放的前提。
- **模型输出一律当不可信数据**：先过 contracts 的 zod schema，再过模块的规则函数；失败整条拒绝并记日志，不修补。

## 6 数据访问

- 两个库文件：`liwa.db`（经历流、载荷、内联投影、各模块操作数据）和 `derived.db`（异步投影、全文、向量），`node:sqlite`，WAL；`derived.db` 可删重建。
- 写只在主线程：`db/` 的 `openWriter(file)` 只给 journal 和投影运行器（procs 登记表、`mind_session` 这类模块操作表由谁写，03 定）；`openReader(file)` 给 worker 线程只读连接。可能超过几十毫秒的读查询都放 worker，worker 入口归用它的模块。
- 迁移：各模块 `migrations/` 下按序号的 SQL，`schema_version(owner, version)` 按所有者记版本，由各模块的 `recover` 在第 3 阶段调用 `db` 的执行器；开发期允许销毁重建，主人"住"进来后只做前向迁移；事件载荷的破坏性变化走一次性迁移（overall §12.8）。
- 事件：`journal.append(AppendRequest) → CommittedEvent | conflict`；`pos`、`seq`、`at` 由 journal 生成，`source` 由可信的所有者模块给；投影：`registerProjection({ name, kind, handles, apply, rebuild })`，检查点只记已提交的 `pos`；载荷经 `putPayload`，`erasePayload` 只有主人接口能调；builtin 只拿 `JournalReader`。

## 7 进程与运行

- 一个常驻进程 `liwa`（`apps/liwa`），launchd 守护，监听本机回环，远程经 Tailscale Serve。worker_threads 跑记忆的重查询与重算；子进程只有 CLI、进程外插件和本地模型服务，全部经 procs 先登记再拉起，父进程退出整组退出，关闭时 procs 的 `finalize` 兜底杀进程组。
- 数据目录 `LIWA_HOME`（外置盘 Aether 上的目录，可配置）：`liwa.db`、`derived.db`、`blobs/`、`members/<id>/cli-home/`、`minds/<id>/`、`workspaces/`、`trash/`、`backups/`、`logs/`、`config/`、`profiles/`（本机 patch 与主人文件层）、`run/`（`boot.json`、pid、命令清单缓存）、`plugins/`（以后的 external）、`ipc/`（以后）。仓库目录不放数据。
- 配置：启动用的 `liwa.config.json` 在 `LIWA_HOME/config/`；profile 的 `config` 只放部署参数；主人能在主控台改的都是所属模块的配置实体，走系统流的配置事件；密钥写成 `{ "$secret": "keychain:…" }` 引用，kernel 在交给插件前解析，永不进仓库、日志与装配树哈希。
- 日志：pino 由组合根注入 kernel，kernel 把 cordis 的 logger exporter 接到它（保留栈与 cause）；JSON 行，按天轮转，正文默认脱敏，密钥明文在输出边界替换成引用；运行追踪单独落盘、可删。
- 错误：只抛 contracts 里 14 个类别的 `LiwaError`，重新抛出带 `cause`；受管的业务动作一律走 `actions.run`。本体进程退出码：0 正常、1 启动失败、2 崩溃、3 关闭超时（`apps/liwa/src/boot/params.ts`）。

## 8 语言与工具链

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 运行时 | Node 24，`.node-version` 与 `engines` 钉死；脚本经 fnm 或 `pnpm exec` | handoff 环境注意事项 |
| 语言 | TypeScript 5，`strict`，ESM only，`moduleResolution: NodeNext`；本体侧继承 `tsconfig.base.json`，浏览器与同构包（contracts、client、console、ui-sdk、插件 `client/`）继承 `tsconfig.web.json` | 浏览器可用要靠编译器保证 |
| 插件运行时 | 上游 `cordis` 精确钉 `4.0.0-rc.12`（pnpm catalog）；升级要过 kernel 的 T1–T13 | 决策 30、31 |
| 校验 | zod 4（pnpm catalog 钉版，contracts 统一导出） | Standard Schema、`partialRecord`、`toJSONSchema` |
| 运行方式 | 开发 `tsx` 直跑；生产 `tsc` 编到 `dist/`，launchd 启动 | 开发快、生产确定 |
| 包管理 | pnpm workspace + catalog | 已装 |
| 测试 | vitest，项目由工作区目录生成（经 `tools/workspace.cjs`），浏览器代码单独 `<包名>:web` 项目（happy-dom）；`pnpm test` 全部用假时钟、假随机、假大脑、假出口；`pnpm test:contract` 跑真 CLI；测试内核走真实装配路径；回环编解码测试；Python 插件 `uv run --frozen pytest` | 决策 6 的测试接缝；DSH 复盘 0001 |
| 静态检查 | eslint + dependency-cruiser + 逐包 `typecheck` 脚本（根 `pnpm -r --if-present run typecheck`；有 `client/` 的包多跑一个 tsconfig） | 把架构规则变成机器检查 |
| 前端 | React + Vite；协议类型来自 contracts，连接经 client | 决策 3 |
| 本机 CI | `tools/ci.sh`：lint、typecheck、test、python、`check-layout`、`check-notices`、schema 导出一致性【V1.0】、`dump-config` 快照 | 仓库公开，CI 需要本机凭据，不上 GitHub Actions |

## 9 编码规范（在全局原则之上的具体条）

- 标识符英文，注释与文档中文；文件名 kebab-case；一个文件一个主要导出；单文件 ≤ 400 行（ESLint `max-lines`，跳过空行与注释，`src/paseo/**` 例外）。
- 不用默认导出（插件入口也是具名导出 `plugin`）；不用 `any`；不吞错误（`catch` 必须记日志或重新抛出带 `cause` 的错误）；跨模块边界只抛 `LiwaError`。
- 公开 API 的参数用对象；返回 `Promise` 的函数名不加 `Async` 后缀；凡登记回调的方法返回释放函数并登记进 contracts 的 `REGISTRAR_METHODS`。
- 数值参数全部进模块的 `params.ts`，带单位和来源注释，不写魔法数（kernel 的时限表、组合根的崩溃预算、契约方法的 `timeoutMs` 都算）。
- 所有对外文本（垫话、兜底句）走人设或配置，不写死在代码里。
- 服务对象对外暴露的是闭包对象或只有私有字段（`#x`）的类实例；kernel 冻结只冻一层。
- 摘来的第三方代码放在各自的包里，文件头注明来源仓库、提交号、原路径、许可证、本地改动摘要；根目录 `THIRD_PARTY_NOTICES.md` 汇总。

**硬规则与 ESLint**（`eslint.config.js`；"本体侧" = `apps/liwa`、`packages/{kernel,core,plugins,lib,testkit,replay}`；"客户端侧" = `packages/{cli,client,console,ui-sdk}`、`apps/{desktop,mobile}`、`tools` 不受回放约束）：

| # | 规则 | 范围 |
| --- | --- | --- |
| E1 | 禁 `Date.now`、无参 `new Date()`、`Date()`、`performance.now`、`process.hrtime`、`process.uptime`、`Math.random`、`crypto.randomUUID` / `getRandomValues` / `randomBytes` / `randomInt` / `randomFillSync`（经注入的 `Clock` / `Rng` / `Ids`） | 本体侧；`core/gateway` 的安全令牌是 `randomBytes` 的唯一豁免 |
| E2 | `setTimeout` / `setInterval` / `setImmediate` 只许 kernel 与 `core/procs` 直接用，其余经 `ctx.clock.timer` | 本体侧 |
| E3 | 禁 `process.on` / `once`、`fs.watch` / `watchFile` | 本体侧，`apps/liwa/src/boot/`（信号与崩溃处理）、kernel、`core/procs` 放行 |
| E4 | 不用默认导出；不用 `any` | 全仓 |
| E5 | 插件禁 `createRequire`、`process.binding`、`process.dlopen`（防绕过 `child_process` 禁令） | `packages/plugins` |
| E6 | `max-lines` 400 | 全仓，`src/paseo/**` 例外 |

"登记回调必须包进 effect"不靠 lint：kernel 的 `on`、`clock.timer` 与 `REGISTRAR_METHODS` 列出的服务方法在 API 形状上自动挂到实例（`00-plugin-kernel.md` §8.2）。跨包深引用由 dependency-cruiser 按各包 `exports` 查，ESLint 不重复做。

## 10 开发流程

- 分支：`dsh-base` 是主分支，灵鲸文档在 `docs/liwa/`，底座自带文档在 `docs/` 其余位置；`main` 已不再使用，旧的自研内核代码留在 main 的历史里。每个实现任务一个分支，合并前过本机 CI；提交与推送前征得主人同意。依据：〔一手〕主人本轮文档归位决定。
- 实现顺序（决策 30、35）：**先定插件机制和协议规范，再长模块**。① kernel-0 全部（`00-plugin-kernel.md` §13）+ contracts 机制层 + `testkit` + `client` 骨架 + `profiles/m0-terminal.yml`；② m0 终端能跑：journal 最小版、procs、`brain-claude-code`（从 Paseo 剥）、`brain-replay`、minds 与 context 最小版、toolport 的 `reply` 与 `inner`、gateway 最小版、`cli` 的 `liwa` 命令、`persona-template-default`；③ 第 0 步探针直接跑在 m0 上（`replay/src/probe/`）；④ demo 网页 = M1 的最小主控台；⑤ 之后每个模块按"契约进 contracts → 轻量文档 → 实现与测试 → 装进 profile"独立推进；IPC 宿主（kernel-1）等第一个真正的进程外插件。
- 实现任务计划写入 `docs/liwa/plans/v1.0.md`（尚未创建），每个任务不超过一天、带测试与完成标准；做完更新对应模块文档的"实现备注"段。
- 命令：`pnpm liwa <命令>`（开发期直跑 `packages/cli`）、`pnpm run ci`、`pnpm test:contract`、`pnpm contracts:export`；启停、装配树、备份、探针、回放都经 `liwa`（`pnpm ci` 是 pnpm 内置的干净安装命令，跑不到我们的脚本）。非交互 shell 里 `node` 会解析到 Homebrew 的 26，用 `fnm exec --using=.node-version -- pnpm run ci`。

## 11 已定的选择与待实测

| # | 事项 | 已定 |
| --- | --- | --- |
| 1 | 插件运行时 | 上游 `cordis`，精确钉 `4.0.0-rc.12`；门面隔离，类型与实例不外泄；候选版 API 再大变就考虑把源码搬进 kernel 自维护 |
| 2 | 数据目录 | 外置盘 Aether 上的 `LIWA_HOME`，备份到另一块盘 |
| 3 | 本地嵌入模型 | 第一版进程内（node-llama-cpp），是 `overall.md` §3.5 规则的例外（决策 30）；不稳就退回 Python 子服务（同包同 id，只改 `runtime`），成为进程外插件的第一个真用户 |
| 4 | 密钥 | macOS 钥匙串；取不到退回 `secrets.env`；统一用 `$secret` 引用 |
| 5 | CI | 只跑本机 `tools/ci.sh`，不上 GitHub Actions |
| 6 | zod | 4.x，pnpm catalog 钉版，contracts 统一导出 |
| 7 | 目录与包 | §4 锁定版：`liwa` 入口在 `packages/cli`，壳与手机端在 `apps/`，新增 `client`、`ui-sdk`、`plugin-sdk`，录放大脑独立成插件，迁移跟模块，Python 服务作插件包（决策 35 ⑤） |

待实测：pnpm 下经组合根注入的 `import()` 对 `exports` 条件的解析；Agent SDK 能否用自定义拉起函数让 CLI 经 `procs.spawn` 启动；node-llama-cpp 进程内加载嵌入模型的内存与延迟；关闭 45 秒截止与 launchd `ExitTimeOut`；dependency-cruiser `scope: 'folder'` 的模块级成环规则；没有 tsconfig 的目录里逐包 `typecheck` 的行为；`z.toJSONSchema` 对 `z.lazy` 与 `discriminatedUnion` 的导出。

## 12 标准终端命令 `liwa`

主人要求"对外要有一套标准终端命令，跟 Paseo 一样"。`liwa` 是 gateway 的一个客户端（和网页主控台、Mac 客户端、以后的手机端一样），走同一套协议，主人身份用本机凭据文件，远程加 `--host` 走 Tailscale；少数本机命令不需要本体在跑。**机制与约定（命令是槽位 `gateway.command`、`CommandSpec`、发现、退出码、`--json`、幂等、流式与交互、生命周期）只写在 `architecture/modules/00-commands.md`**；本节只是命令清单的唯一归属，每条命令的参数在它所属的模块文档里定。可执行入口 `packages/cli/bin/liwa.js`；本机命令的实现在 `apps/liwa`、数据操作在 core，cli 只在执行它们时动态加载（§4.2）。

| 组 | 命令 | 说明 |
| --- | --- | --- |
| 运行（本机直接执行） | `liwa start [--profile m0-terminal]`、`liwa stop`、`liwa restart --drain`、`liwa status`、`liwa doctor`、`liwa dump-config`、`liwa profile list\|show`、`liwa logs [-f]` | 启停、自检、装配树、日志 |
| 和她 | `liwa chat`（REPL，等于一个"地方"）、`liwa say "<消息>"`、`liwa tail`（实时事件流）、`liwa now`（她现在）、`liwa day [日期]`（她的一天） | 对话与观察 |
| 她的账本 | `liwa memory search\|show\|correct\|pin\|delete`、`liwa growth list\|show\|rollback`、`liwa self show\|rollback`、`liwa people list\|bind\|merge\|split\|confirm`、`liwa skills list` | 主人专属操作经 gateway 鉴权 |
| 手上的事 | `liwa tasks list\|show\|approve\|request-changes\|accept\|reject\|steer\|stop`、`liwa task open <id>`（直连那只手） | 对话编程的命令行形态 |
| 控制 | `liwa pause\|resume`、`liwa budget show\|set`、`liwa rules show\|set`（家规）、`liwa brain show\|set`（成员 × 用脑的大脑配置）、`liwa autonomy on\|off`、`liwa config get\|set` | 主人控制项 |
| 插件 | `liwa plugins list\|show\|enable\|disable\|bind`、`liwa commands list\|show` | 读 `AssemblyPlan` 与命令清单；改动写主人文件层或配置事件 |
| 运维（本机直接执行） | `liwa backup`、`liwa restore <文件>`、`liwa migrate`、`liwa export <范围>` | 备份、恢复、迁移、导出 |
| 开发 | `liwa probe`、`liwa replay <模式>`、`liwa eval <指标>` | 探针、回放、指标（`contracts:export` 是仓库工程脚本，不是 `liwa` 命令） |
| 对外（以后，可选） | `liwa acp serve` | 把她作为 ACP agent 暴露给编辑器或别的 agent（决策 2） |

m0 先有 `start`、`status`、`doctor`、`dump-config`、`chat`、`tail`、`commands list|show`，V1.0 收尾补齐全部；命令名与参数在 07 的主人接口清单定稿时一并冻结。
