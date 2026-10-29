# 工程约定与代码实现设计

更新：2026-10-29。状态：**已确认**（决策 29、30、31、32、33）。用途：路线图 1.5。定下代码层面的骨架：插件机制底座、协议规范怎么和它绑定、仓库怎么分包、每个模块落在哪、数据怎么访问、进程怎么组织、怎么测、怎么跑。它不重复模块文档的内容，只定"所有模块共同遵守的东西"。依据：`architecture/overall.md` §3、§6、§9；`architecture/modules/00-plugin-kernel.md`、`00-contracts.md`；`research/2026-10-28-plugin-architecture.md`；`research/2026-10-28-paseo-architecture.md` Q4、Q10；决策 1、2、3、17。

## 1 总思路：万物插件化的形状，内核的裁判

1. **形状照 DSH 来。** 运行时用上游 `cordis`（精确钉 `4.0.0-rc.12`，MIT，DSH 的底）；loader 自己写，照 DSH 的形状：`package.json` 的 `liwa` 字段当 manifest、导入代码前校验、profile 叠 patch、`dump-config` 打印装配树。不引入 `@deepseek-ai/dsh` 本身。
2. **信任边界是模型与外界，不是插件与内核。** 所有插件都是一方代码（仓库内、开源、本机自用），对内核完全可信：能读任何账本、订阅经历流、用进程与能力（决策 32）。约束只有工程纪律：`@liwa/core` 里的插件 required 且不可替换（其中九样是三条硬规矩所在）；写只经各账本的写 API（单点写、校验集中、可回放）；主人专属操作要带 gateway 签发的主人令牌（防的是模型与会话，不是插件）；cordis 的上下文不出 kernel（防 API 漂移与误用）。隐私只管两处：进她上下文的内容按受众裁，对外投递按受众查。
3. **协议规范就是 `contracts` 包，和插件机制绑定。** 每个槽位一份契约（方法描述 + 整数版本），manifest 声明实现哪些槽位、用哪个契约版本；版本对不上启动时大声报错。槽位契约全是可序列化的异步消息；required 之间的进程内 API 不受此限。
4. **"装上一个就好一个"靠 profile。** 里程碑就是 profile，每个 profile 属于一个阶段集合（m0 / m1 / v1）；每个插件一个包、各自的文档和测试，先有契约再有实现。第一版它的含义是"给已有槽位加实现"。
5. **agent CLI 走 Paseo 的契约，不是 ACP。** 大脑槽位契约从 Paseo 的 `AgentClient` / `AgentSession` 裁剪，ACP 只是其中一种适配器；可选对外开 ACP 服务端口。

## 2 插件机制底座（`packages/kernel`）

| 部件 | 做什么 | 来源 |
| --- | --- | --- |
| 运行时 | 上游 `cordis` 4.0.0-rc.12：上下文、服务按键挂载、`inject`、effect、fiber、`isolate`、五种分发；全部包在 kernel 里，类型与实例不外泄 | cordis 源码 |
| 门面 | 插件拿到的 `KernelContext` 是 kernel 自建的冻结对象：`pluginId`、`clock`、`rng`、`ids`、`log`、`services`（按 `inject` 收窄，可读任何账本）、按种类裁剪的 `slots`、`effect`、`on`；没有 `emit`、没有 provide 服务键的途径 | 评审、决策 32 |
| manifest | `liwa` 字段：`manifestVersion`、`id`、`kind`（只用来核对）、`provides`（槽位 → 契约版本、impl、meta）、`consumes`（视图或服务键 → 版本）、`plugins[]`（一包多插件，含 `service`）、`multiInstance`、`data`、`resources` | DSH 形状 |
| loader | 五阶段：计划校验（含按 realpath 推导种类、静态服务图、槽位计划、阶段集合）→ 注册 → 恢复 → 槽位就绪 → 开放业务；宁可不起 | `00-plugin-kernel.md` §5 |
| 槽位注册表 | 基数 bound / member-single / list / registry（single、chain 保留）、作用域、`transport`、`requiredBy`；三份门面 | §6 |
| 钩子 | `apply`（只登记）、`ready`（接活）、`drain`（先停）、`health`、required 的 `recover` | §8 |
| 注入 | 挂钟与单调钟、可控定时器、按标签分流可恢复的随机源、编号源、密钥解析器、日志 | §8、§9 |
| `dump-config` | 静态装配计划 `AssemblyPlan`；插件页只读 | §4.3 |
| IPC 宿主 | kernel-1，推迟到第一个进程外插件；fd 3 管道、JSON-RPC 2.0、受限反向视图 | §10 |

## 3 协议规范（`packages/contracts`，零运行时依赖，zod 4 除外）

| 目录 | 内容 |
| --- | --- |
| `index.ts` | `MANIFEST_VERSION`、`KERNEL_API_VERSION`、`CLIENT_PROTOCOL_VERSION`、`IPC_PROTOCOL_VERSION`、`CONTRACT_VERSIONS`、`VIEW_VERSIONS`、`SLOT_DEFS`、`SERVICE_KEYS`、`PLUGIN_VIEWS`、`EVENT_TYPES`、`REQUIRED_PLUGIN_IDS`、`STAGE_SETS` |
| `z.ts`、`common.ts` | 统一导出的 zod 4；基础类型、`CallContext`、`SecretRef`、`Unit`、`JsonValue` |
| `manifest/` | manifest、profile、patch、`AssemblyPlan` 的 schema（`strictObject`、`partialRecord`） |
| `slots/`、`views/` | 每个槽位一个文件（方法描述、句柄、事件、版本、回退语义）；进程外插件可经 IPC 反向调用的方法清单（第一版只有 `procs.spawn`） |
| `events/` | 事件信封、`AppendRequest` / `CommittedEvent`、各模块事件载荷 |
| `ledgers/`、`tools/` | required 之间的 API 类型；内核工具目录 |
| `protocol/` | 前后端信封、IPC 信封 |
| `errors.ts` | 13 个错误类别与 JSON-RPC 错误码表 |

规则：插件包只能 `import` `@liwa/contracts` 和 `@liwa/kernel` 的公开入口，由 dependency-cruiser 强制；契约改版本号时同一提交改完所有内置实现，不留兼容层。

## 4 仓库结构与模块落位

### 4.1 顶层

```
liwa/
  .node-version                 24.18.0；engines 同步钉死
  package.json                  workspace 根：脚本（dev、ci、dump-config、probe、replay、backup、contracts:export）与开发依赖；pnpm catalog 钉 cordis、zod
  pnpm-workspace.yaml           apps/*、packages/*、packages/plugins/*、packages/lib/*、tools
  tsconfig.base.json            strict、ESM、NodeNext；包之间只用包名引用，不设路径别名
  vitest.config.ts              根配置 `test.projects`：每个包一个；跑真 CLI 的契约测试单独一个，手动触发
  eslint.config.js              禁 Date.now、无参 new Date、performance.now、Math.random、crypto.randomUUID、默认导出、跨模块深引用、any；setTimeout / setInterval 只许 kernel 与 procs
  .dependency-cruiser.cjs       层表（§5）与"插件只认 contracts 与 kernel"
  THIRD_PARTY_NOTICES.md        摘来的代码汇总：来源仓库、提交号、路径、许可证
  LICENSE  README.md
  profiles/                     m0-terminal.yml、m1-skeleton.yml … v1.yml、dev.yml
  apps/                         §4.2 组合根
  packages/                     §4.2
  tools/                        §4.4
  docs/                         §4.5
```

### 4.2 包

| 包 | 目录 | 职责 | 允许依赖 |
| --- | --- | --- | --- |
| `@liwa/app` | `apps/liwa` | 组合根：进程入口、自检、信号处理、launchd 入口、安全模式页；依赖全部插件包；把自己的 URL 作为解析根、把 required 插件与阶段集合、logger、secrets、clock、rng 传给 `startKernel` | kernel、core、全部插件包、pino |
| `@liwa/contracts` | `packages/contracts` | 协议规范 | 只有 zod |
| `@liwa/kernel` | `packages/kernel` | 插件机制底座 | contracts、cordis、yaml |
| `@liwa/core` | `packages/core` | required 插件与编排层；一个包多个插件，入口由 `liwa.plugins[].entry` 指定 | contracts、kernel、`node:sqlite`、`node:worker_threads`、@node-rs/jieba（只提词） |
| `@liwa/testkit` | `packages/testkit` | 假时钟、计数器随机、编号源、服务假实现、录放大脑（一个 `brain.provider` 实现）、测试内核的便利封装 | contracts、kernel |
| `@liwa/brain-shared` | `packages/lib/brain-shared` | 三个大脑适配器共用的 Paseo 基础代码（含原样保留的 `agent-sdk-types.ts`）；是库不是插件，不带 `liwa` 字段 | contracts、kernel |
| `@liwa/plugin-brain-claude` | `packages/plugins/brain-claude` | Claude 适配器（Paseo 摘）+ 到灵鲸契约的映射层 | contracts、kernel、brain-shared、`@anthropic-ai/claude-agent-sdk` |
| `@liwa/plugin-brain-codex` | `packages/plugins/brain-codex` | Codex app-server 适配器（Paseo 摘） | contracts、kernel、brain-shared |
| `@liwa/plugin-brain-acp` | `packages/plugins/brain-acp` | ACP 通用适配器（Paseo 摘，不验收） | contracts、kernel、brain-shared、`@agentclientprotocol/sdk` |
| `@liwa/plugin-memory-engine-default` | `packages/plugins/memory-engine-default` | 内置记忆引擎（05 §3.5） | contracts、kernel |
| `@liwa/plugin-growth-engine-default` | `packages/plugins/growth-engine-default` | 内置成长引擎（06） | contracts、kernel |
| `@liwa/plugin-social-model-default` | `packages/plugins/social-model-default` | 内置关系模型 | contracts、kernel |
| `@liwa/plugin-job-triggers` | `packages/plugins/job-triggers` | cron、一次性、间隔触发（cron 解析从 Paseo 摘）；事件型、空闲型由 scheduler 自己做 | contracts、kernel |
| `@liwa/plugin-ability-embed-local` | `packages/plugins/ability-embed-local` | 本地嵌入（Qwen3-Embedding-0.6B；第一版进程内，决策 30 的例外） | contracts、kernel、node-llama-cpp |
| `@liwa/plugin-ability-*`（V1.1） | `packages/plugins/ability-speech` 等 | 语音（Paseo 的 speech 与 dictation）、看图、世界源 | contracts、kernel、各自第三方 |
| `@liwa/plugin-sdk`（V2） | `packages/plugin-sdk` | 给进程外插件用的 IPC 客户端，只依赖 contracts，不把 cordis 和 loader 拖进子进程 | contracts |
| `@liwa/plugin-form-wechat`（V2） | `packages/plugins/form-wechat` | 微信形态适配器，进程外 | contracts、plugin-sdk |
| `@liwa/console` | `packages/console` | React + Vite 网页主控台；内部按 `ui.area.*` 组织；插件的 `client` 入口怎么编进来随 08 定 | contracts、react |
| `@liwa/cli` | `packages/cli` | 终端客户端（开发用）：连 gateway 的 WebSocket | contracts |
| `@liwa/desktop`（V1.1） | `packages/desktop` | Electron 薄壳 | contracts |
| `@liwa/replay` | `packages/replay` | L0 模拟器、L1 / L2 回放、A–G 指标、回放题库、探针场景 | contracts、kernel、core 与 app 的公开入口、testkit |

插件包命名：`@liwa/plugin-<槽位简名>-<实现名>`。所有包同一版本号，随仓库统一升；core 与 console 同版本发布；`exports` 必须含 `./package.json`。

### 4.3 包内布局

```
apps/liwa/src/            main.ts（自检、读启动配置、startKernel）、signals.ts、safe-mode/（不经 kernel 的极简页）、launchd/
packages/core/src/
  db/             openWriter / openReader、migrations/NNN_<名字>.sql、schema_version、worker 入口
  <模块>/         每个模块一个目录：
    index.ts        公开 API + defineService(...)
    types.ts        模块内类型；对外的类型在 contracts
    params.ts       数值参数表（初值、单位、来源）
    <实现>.ts
    __tests__/      单元测试：testkit 的假时钟、假随机、假大脑、假出口
  ledgers/<账本>/  ledger.ts（校验与写事件）、projection.ts（事件到表）、读接口；引擎在 plugins
packages/core/test/       跨模块集成测试、20 场景录制测试、重建等价测试、真实 loader 的装配测试

packages/plugins/<名字>/
  package.json    含 liwa 字段（manifest），exports 含 ./package.json
  NOTICE          第三方来源（摘来的代码才有；CI 规则：有 src/paseo/ 就必须有 NOTICE）
  README.md       实现了哪个槽位、契约版本、配置项、来源
  src/index.ts    export const plugin = definePlugin(...)（具名导出；出现默认导出 loader 即拒绝）
  src/config.ts   zod Config（strictObject、同步校验）
  src/adapter.ts  摘来的代码到灵鲸契约的映射层
  src/paseo/      摘来的代码保持原目录结构，文件头注明来源仓库、提交号、原路径、许可证、本地改动
  src/__tests__/
```

### 4.4 tools

`ci.sh`（lint、typecheck、test、schema 导出一致性、`dump-config` 快照）、`init-home.ts`（建 `LIWA_HOME` 目录树与配置模板）、`backup.ts` 与 `restore.ts`、`migrate.ts`、`export-schemas.ts`、`dump-config.ts`（经 app 的 required 清单调 kernel）、`launchd/com.liwa.core.plist`（`ExitTimeOut` ≥ 45 秒）。

### 4.5 docs

`product.md`、`portrait.md`、`roadmap.md`、`engineering.md`、`architecture/overall.md`、`architecture/README.md`、`architecture/modules/00–10`、`plans/`（实现计划）、`scenarios/`（场景图页）、`research/`（调研与评审）、`handoff.md`。只存最新方案。

### 4.6 依赖规则（dependency-cruiser 强制）

| 从 | 可以依赖 |
| --- | --- |
| contracts | zod |
| kernel | contracts、cordis、yaml |
| core 的某模块 | contracts、kernel、core 内比它低一层的模块（层表见 §5） |
| testkit | contracts、kernel |
| lib/brain-shared | contracts、kernel |
| plugins/* | contracts、kernel、自己声明的第三方；大脑适配器加 brain-shared；测试时加 testkit；不直接依赖 core（经 kernel 的服务接口用 core 的能力，保持可替换），不 import `node:child_process`（进程经 `procs.spawn`） |
| console、cli、desktop | contracts（协议类型）；不依赖 core |
| replay | contracts、kernel、core 与 app 的公开入口、testkit |
| apps/liwa | 全部 |

### 4.7 每个模块落在哪

层按 `overall.md` §3.2（context 归运行层）；种类：required = 内核不可替换，builtin = 内置的槽位实现，external = 进程外。

| 模块 | 位置 | 层 | 种类 | 服务键 / 槽位 | Paseo 来源 |
| --- | --- | --- | --- | --- | --- |
| 插件宿主 | `kernel/` | 宿主 | required | 三份槽位门面 | — |
| 组合根与安全模式 | `apps/liwa` | — | — | — | — |
| journal | `core/journal` | 基础 | required | `journal` | — |
| guard | `core/guard` | 守护 | required | `guard` | — |
| procs | `core/procs` | 资源 | required | `procs` | `managed-processes`、tree-kill、spawn 的规则（登记、进程组、父进程没了就退出） |
| brains（契约层、预审与切换、用量归一、结构化生成循环） | `core/brains` | 资源 | required | `brains`；消费 `brain.provider` | `AgentClient` / `AgentSession` 契约；`agent-response-loop` + `structured-generation-providers`（睡眠用脑的 JSON Schema 校验 + 重试 + 换大脑兜底） |
| Claude、Codex、ACP 适配器 | `plugins/brain-*` | 资源 | builtin | 提供 `brain.provider` | `providers/claude/`、`codex-app-server-agent.ts` + `codex/`、`acp-agent.ts` + `generic-acp-agent.ts` + `acp-options.ts`；工具调用归一放 brain-shared |
| abilities（接口与回退链） | `core/abilities` | 资源 | required | `abilities`；消费 `ability.*` | — |
| 本地嵌入 | `plugins/ability-embed-local` | 资源 | builtin | 提供 `ability.embed` | — |
| 语音、看图、世界源 | `plugins/ability-*` | 资源 | builtin | 提供 `ability.*` | `speech/` + `dictation/`（上游 0.14） |
| formhost | `core/formhost`（V2） | 资源 | required | `formhost`；消费 `form.adapter` | — |
| 微信等形态适配器 | `plugins/form-*` | 资源 | external | 提供 `form.adapter` | — |
| workspace、notify | `core/workspace`、`core/notify` | 资源 | required | `workspace`、`notify` | 工作区概念（`purpose: chat` 的私有目录）；`agent-attention-policy` 放 notify |
| roster、self、body、memory、people、skills 的账本层 | `core/ledgers/*` | 账本 | required | 同名服务键；只经槽位注册表解析各自的引擎契约 | — |
| 记忆引擎、成长引擎、关系模型 | `plugins/*-default` | 账本的引擎 | builtin | 提供 `memory.engine`、`growth.engine`、`social.model` | — |
| senses、attention、will、scheduler、tasks、outbox | `core/*` | 编排 | required | 同名服务键；scheduler 消费 `job.trigger`；senses 消费 `gate.policy`（V2） | `agent-prompt.ts` 的系统信封与完成通知、`cron.ts` 的表达式解析 |
| minds、context、actions | `core/*` | 运行 | required | `minds`、`context`、`actions` | 中断与 steer 规则；`agent-stream-coalescer`、`timeline-projection`、`creation/`、`idle-runtime-cleanup` 放 minds |
| toolport、gateway | `core/*` | 接入 | required | `toolport`、`gateway`；消费 `toolport.tool`（V3） | — |
| 作业触发类型 | `plugins/job-triggers` | 编排 | builtin | 提供 `job.trigger` | `cron.ts` |
| 主控台六区域、开发者视图、插件页 | `console/` | 界面 | builtin | `ui.area.*`、`ui.*`（归 console） | — |
| 终端客户端 | `cli/` | 界面 | 开发工具 | — | — |
| Electron 薄壳 | `desktop/` | 界面 | builtin | — | — |
| L0 / L1 / L2、指标、探针 | `replay/` | 工具 | — | — | — |
| 假实现与录放大脑 | `testkit/` | 工具 | — | 录放大脑提供 `brain.provider` | — |

### 4.8 Paseo 剥离的落位

摘之前先固定一个已审阅的上游提交，为每个适配器列出实际的 import 闭包、裁剪项与依赖映射（进程 → `procs.spawn` 视图，时钟 → 注入，日志 → kernel logger，类型 → contracts），写进各包 `NOTICE`；m0 只验证 Claude（人设、工具、进程登记、续接、中断、用量），Codex 与 ACP 按 M1 节奏。

| Paseo 路径 | 落到 | 处理 |
| --- | --- | --- |
| `AgentClient` / `AgentSession` 类型 | `contracts/slots/brain.provider.ts` | 裁剪成契约（方法描述 + 句柄 + 事件），不照搬 |
| `agent-sdk-types.ts`（818 行） | `lib/brain-shared/src/paseo/` | 原样保留，照搬的代码靠它编译；每个适配器的 `src/adapter.ts` 把 Paseo 类型映射到灵鲸契约 |
| `providers/claude/`（约 1.1 万行） | `plugins/brain-claude/src/paseo/` | 照搬；改人设注入、内核工具注入与批结束钩子、`settingSources`、自动压缩、数据目录；进程经 `procs.spawn`（Agent SDK 的自定义拉起选项要实测） |
| `codex-app-server-agent.ts` + `codex/`（约 0.98 万行） | `plugins/brain-codex/src/paseo/` | 照搬；断开 workspace-git，每成员 `CODEX_HOME`，进程经 `procs.spawn` |
| `acp-agent.ts`、`generic-acp-agent.ts`、`acp-options.ts`（约 0.44 万行） | `plugins/brain-acp/src/paseo/` | 照搬；补人设注入退路（指令文件 / 前缀） |
| provider-launch-config、notices、options、refresh-deadline、session-import、工具调用归一（约 1,320 行） | `lib/brain-shared/src/paseo/` | 照搬；不摘 `utils/spawn`、tree-kill（进程归 procs） |
| `agent-response-loop`、`structured-generation-providers` | `core/brains` | 改造：睡眠用脑与"去查"的结构化生成循环 |
| `agent-prompt.ts` 的系统信封与完成通知、`agent-messages/`、`finish-subscriptions/` | `core/minds`、`core/outbox` | 改造：队列与订阅意图改存 SQLite，内容换成灵鲸格式 |
| `agent-stream-coalescer`、`timeline-projection`、`creation/`、`idle-runtime-cleanup` | `core/minds`（投影部分给 `core/gateway`） | 改造 |
| `managed-processes` | `core/procs` | 改造：所有 CLI 进程都登记 |
| `agent-attention-policy` | `core/notify` | 改造 |
| `cron.ts`、`cron-expression.ts` | `plugins/job-triggers/src/paseo/` | 只摘解析与 `computeNextRunAt` |
| `speech/` + `dictation/`（上游 0.14） | `plugins/ability-speech/src/paseo/`（V1.1） | 照搬，带 SenseVoice 与 Whisper |
| AgentManager、Session、websocket-server、MCP 目录、插件平台、relay、Hub | 不摘 | 只读规则 |

## 5 模块在代码里怎么划界

- **一个模块一个目录或一个包**，`index.ts` 只导出公开 API 和它的插件定义；`types.ts` 放本模块类型；其余文件都是内部实现。跨模块只能引用对方的 `index.ts`，深层引用由 dependency-cruiser 禁止。
- **依赖方向按 `overall.md` §3.2 的层表**：接入（gateway、toolport）→ 编排（senses、attention、will、scheduler、tasks、outbox）→ 运行（minds、context、actions）→ 账本（roster、self、body、memory、people、skills）→ 宿主（kernel）→ 资源（brains、procs、formhost、abilities、workspace、notify）→ 守护（guard）→ 基础（journal）。调用只能向下，同层只调公开 API 且不成环；向上传信息走经历流订阅或进程内信号。dependency-cruiser 只认这一张表。
- **每样数据只有一个写入方**（overall §2.3）：只有所有者模块持有写连接或写 API。
- **账本与引擎分开**：账本只经槽位注册表解析契约接口、把按受众裁过的输入推给引擎、复核引擎返回的编号；引擎在 `plugins/*`，只依赖 contracts 与 kernel。
- **时钟、随机、编号一律注入**（`Clock`、`Rng`、`Ids`），ESLint 禁止系统时钟与随机；这是 L0 可回放的前提。
- **模型输出一律当不可信数据**：先过 contracts 的 zod schema，再过模块的规则函数；失败整条拒绝并记日志，不修补。

## 6 数据访问

- 两个库文件：`liwa.db`（经历流、载荷、内联投影、各模块操作数据）和 `derived.db`（异步投影、全文、向量），`node:sqlite`，WAL；`derived.db` 可删重建。
- 写只在主线程：`db/` 的 `openWriter(file)` 只给 journal 和投影运行器；`openReader(file)` 给 worker 线程只读连接。可能超过几十毫秒的读查询都放 worker。
- 迁移：`db/migrations/` 按序号的 SQL + `schema_version` 表；开发期允许销毁重建，主人"住"进来后只做前向迁移；事件载荷的破坏性变化走一次性迁移（overall §12.8）。
- 事件：`journal.append(AppendRequest) → CommittedEvent | conflict`；`pos`、`seq`、`at` 由 journal 生成，`source` 由可信的所有者模块给；投影：`registerProjection({ name, kind, handles, apply, rebuild })`，检查点只记已提交的 `pos`；载荷经 `putPayload`，`erasePayload` 只有主人接口能调。

## 7 进程与运行

- 一个常驻进程 `liwa`（`apps/liwa`），launchd 守护，监听本机回环，远程经 Tailscale Serve。worker_threads 跑记忆的重查询与重算；子进程只有 CLI、进程外插件（V2 起）和本地 SenseVoice（V1.1），全部经 procs 先登记再拉起，父进程退出整组退出。
- 数据目录 `LIWA_HOME`（外置盘 Aether 上的目录，可配置）：`liwa.db`、`derived.db`、`blobs/`、`members/<id>/cli-home/`、`minds/<id>/`、`workspaces/`、`trash/`、`backups/`、`logs/`、`config/`、`profiles/`（本机 patch 与主人文件层）、`run/`（启动失败计数）、`ipc/`（以后）。仓库目录不放数据。
- 配置：启动用的 `liwa.config.json` 在 `LIWA_HOME/config/`；profile 的 `config` 只放部署参数；主人能在主控台改的都是所属模块的配置实体，走系统流的配置事件；密钥写成 `{ "$secret": "keychain:…" }` 引用，kernel 在交给插件前解析，永不进仓库、日志与装配树哈希。
- 日志：pino 由组合根注入 kernel，kernel 把 cordis 的 logger exporter 接到它；JSON 行，按天轮转，正文默认脱敏；运行追踪单独落盘、可删。
- 错误：只抛 contracts 里 13 个类别的 `LiwaError`；受管的业务动作一律走 `actions.run`。

## 8 语言与工具链

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 运行时 | Node 24，`.node-version` 与 `engines` 钉死；脚本经 fnm 或 `pnpm exec` | handoff 环境注意事项 |
| 语言 | TypeScript 5，`strict`，ESM only，`moduleResolution: NodeNext` | 现代默认 |
| 插件运行时 | 上游 `cordis` 精确钉 `4.0.0-rc.12`（pnpm catalog）；升级要过 kernel 的 T1–T12 | 决策 30、31 |
| 校验 | zod 4（pnpm catalog 钉版，contracts 统一导出） | Standard Schema、`partialRecord`、`toJSONSchema` |
| 运行方式 | 开发 `tsx` 直跑；生产 `tsc` 编到 `dist/`，launchd 启动 | 开发快、生产确定 |
| 包管理 | pnpm workspace + catalog | 已装 |
| 测试 | vitest（根配置 `test.projects`）；`pnpm test` 全部用 testkit 的假时钟、假随机、假大脑、假出口；`pnpm test:contract` 跑真 CLI；测试内核走真实装配路径；回环编解码测试 | 决策 6 的测试接缝；DSH 复盘 0001 |
| 静态检查 | eslint + dependency-cruiser + `tsc --noEmit` | 把架构规则变成机器检查 |
| 前端 | React + Vite；协议类型来自 contracts | 决策 3 |
| 本机 CI | `tools/ci.sh`：lint、typecheck、test、schema 导出一致性、`dump-config` 快照 | 仓库公开，CI 需要本机凭据，不上 GitHub Actions |

## 9 编码规范（在全局原则之上的具体条）

- 标识符英文，注释与文档中文；文件名 kebab-case；一个文件一个主要导出；文件尽量不超过 400 行。
- 不用默认导出（插件入口也是具名导出 `plugin`）；不用 `any`；不吞错误（`catch` 必须记日志或重新抛出带 `cause` 的错误）。
- 公开 API 的参数用对象；返回 `Promise` 的函数名不加 `Async` 后缀；凡登记回调的方法返回释放函数。
- 数值参数全部进模块的 `params.ts`，带单位和来源注释，不写魔法数。
- 所有对外文本（垫话、兜底句）走人设或配置，不写死在代码里。
- 摘来的第三方代码放在各自的包里，文件头注明来源仓库、提交号、原路径、许可证、本地改动摘要；根目录 `THIRD_PARTY_NOTICES.md` 汇总。

## 10 开发流程

- 分支：`main` 可运行；每个实现任务一个分支，合并前过本机 CI；提交与推送前征得主人同意。
- 实现顺序（决策 30）：**先定插件机制和协议规范，再长模块**。① `contracts` 的机制层与第一批槽位契约 + `kernel`（kernel-0）+ `testkit` + `profiles/m0-terminal.yml`；② m0 终端能跑：journal 最小版、procs、`brain-claude`（从 Paseo 剥）、minds 与 context 最小版、toolport 的 `reply` 与 `inner`、gateway 最小版、`cli` 终端客户端，静态人设文件；③ 第 0 步探针直接跑在 m0 上；④ demo 网页 = M1 的最小主控台；⑤ 之后每个模块按"契约进 contracts → 轻量文档 → 实现与测试 → 装进 profile"独立推进；IPC 宿主（kernel-1）等第一个真正的进程外插件。
- 实现任务来自 `docs/plans/v1.0.md`，每个任务不超过一天、带测试与完成标准；做完更新对应模块文档的"实现备注"段。
- 命令：`pnpm dev --profile dev`、`pnpm dump-config --profile m0-terminal`、`pnpm probe`、`pnpm replay`、`pnpm backup`、`pnpm ci`。

## 11 已定的选择与待实测

| # | 事项 | 已定 |
| --- | --- | --- |
| 1 | 插件运行时 | 上游 `cordis`，精确钉 `4.0.0-rc.12`；门面隔离，类型与实例不外泄；候选版 API 再大变就考虑把源码搬进 kernel 自维护 |
| 2 | 数据目录 | 外置盘 Aether 上的 `LIWA_HOME`，备份到另一块盘 |
| 3 | 本地嵌入模型 | 第一版进程内（node-llama-cpp），是 `overall.md` §3.5 规则的例外（决策 30）；不稳就退回 Python 子服务，成为进程外插件的第一个真用户 |
| 4 | 密钥 | macOS 钥匙串；取不到退回 `secrets.env`；统一用 `$secret` 引用 |
| 5 | CI | 只跑本机 `tools/ci.sh`，不上 GitHub Actions |
| 6 | zod | 4.x，pnpm catalog 钉版，contracts 统一导出 |

待实测：cordis `const enum` 在 `tsx` 下的跨包引用；zod 4 与 cordis `resolveConfig` 的配合；pnpm 下以组合根为解析根的动态 `import()`；Agent SDK 能否用自定义拉起函数让 CLI 经 `procs.spawn` 启动；node-llama-cpp 进程内加载嵌入模型的内存与延迟；关闭 45 秒截止与 launchd `ExitTimeOut`。

## 12 标准终端命令 `liwa`

主人要求"对外要有一套标准终端命令，跟 Paseo 一样"。`packages/cli` 从"开发用的终端客户端"升格为正式的命令行入口 `liwa`，和网页主控台、Mac 客户端、以后的手机端一样是 gateway 的一个客户端：走同一套协议（`contracts/protocol/client.ts`），主人身份用本机凭据文件（`overall.md` §11.1），远程加 `--host` 走 Tailscale。每条命令对应 07 里的一个 gateway 操作，命令只是壳。少数命令不需要本体在跑，直接在本机干活。

| 组 | 命令 | 说明 |
| --- | --- | --- |
| 运行（本机直接执行） | `liwa start [--profile m0-terminal]`、`liwa stop`、`liwa restart --drain`、`liwa status`、`liwa doctor`、`liwa dump-config`、`liwa profile list\|show`、`liwa logs [-f]` | 启停、自检、装配树、日志 |
| 和她 | `liwa chat`（REPL，等于一个"地方"）、`liwa say "<消息>"`、`liwa tail`（实时事件流）、`liwa now`（她现在）、`liwa day [日期]`（她的一天） | 对话与观察 |
| 她的账本 | `liwa memory search\|show\|correct\|pin\|delete`、`liwa growth list\|show\|rollback`、`liwa self show\|rollback`、`liwa people list\|bind\|merge\|split\|confirm`、`liwa skills list` | 主人专属操作经 gateway 鉴权 |
| 手上的事 | `liwa tasks list\|show\|approve\|request-changes\|accept\|reject\|steer\|stop`、`liwa task open <id>`（直连那只手） | 对话编程的命令行形态 |
| 控制 | `liwa pause\|resume`、`liwa budget show\|set`、`liwa rules show\|set`（家规）、`liwa brain show\|set`（成员 × 用脑的大脑配置）、`liwa autonomy on\|off`、`liwa config get\|set` | 主人控制项 |
| 插件 | `liwa plugins list\|show\|enable\|disable\|bind` | 读 `AssemblyPlan`；改动写主人文件层或配置事件 |
| 运维（本机直接执行） | `liwa backup`、`liwa restore <文件>`、`liwa migrate`、`liwa export <范围>` | 备份、恢复、迁移、导出 |
| 开发 | `liwa probe`、`liwa replay <模式>`、`liwa contracts export`、`liwa eval <指标>` | 探针、回放、导出 schema、指标 |
| 对外（以后，可选） | `liwa acp serve` | 把她作为 ACP agent 暴露给编辑器或别的 agent（决策 2） |

约定：所有命令支持 `--json`（脚本用）；退出码 0 成功、1 用户错误、2 本体不可达、3 被拒（权限、总闸、暂停）；写操作幂等（带 `--idempotency-key` 或由命令自动生成）；`chat` 与 `tail` 用 WebSocket，其余用 HTTP。m0 先有 `start`、`status`、`doctor`、`dump-config`、`chat`、`tail`，V1.0 收尾补齐全部。命令名与参数在 07 的主人接口清单定稿时一并冻结。
