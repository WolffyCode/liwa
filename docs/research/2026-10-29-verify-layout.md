# 代码目录分层定稿（方向 L）

更新：2026-10-29。状态：**草稿，待主人确认**。用途：主人原话"代码目录分层，现在就得确定"。本稿给出一份覆盖 m0 到 V5 的锁定版目录树与依赖规则，每样东西唯一归属；主人确认后，实现 agent 按它一次把目录、包、依赖规则落好，之后不再挪。只定"放在哪、谁能依赖谁、规则怎么查"，不定各模块的内部设计。

依据：`engineering.md` §1–§12；`architecture/overall.md` §3、§9、§10、§16；`product.md` §8、§11；`roadmap.md` 总清单；`modules/00-plugin-kernel.md` §2、§3、§5、§10–§12；`modules/00-contracts.md` §1、§2；`modules/02-minds.md`（草稿）、`05-memory.md`、`06-growth.md`（草稿）中与落位有关的段；仓库实际代码（`packages/kernel/src/{manifest,loader,graph,index,testing}.ts`、`packages/contracts/src/{services,slots/defs,manifest/liwa}.ts`、`apps/liwa/src/index.ts`、全部 `package.json` 与 `tsconfig.json`、`pnpm-workspace.yaml`、`vitest.config.ts`、`eslint.config.js`、`.dependency-cruiser.cjs`、`tools/ci.sh`）；本机 Helm 仓库 main `1fa999a`（Paseo 0.14.0，`packages/server` 版本 0.14.0）的 `packages/*/package.json`、`packages/cli/src`、`plugin-examples/`；Koishi `koishijs/webui` 的 `plugins/insight`（GitHub API 读取）；`research/2026-10-28-plugin-architecture.md` D5、D6；`research/2026-10-28-client-backend.md` §2、§3；本稿 §9 的规则验证。

标注：〔一手〕读过代码、源码、规范原文或本稿亲自跑过；〔二手〕调研报告转述；〔推理〕设计判断。

## ① 一页结论

- **顶层四类，按"它是什么"分**：`apps/` 放有自己进程入口、要被系统或用户启动的东西（本体 `apps/liwa`、Electron 壳 `apps/desktop`【V1.1】、原生手机端 `apps/mobile`【V5】）；`packages/` 放被引用的库（contracts、kernel、core、client、cli、console、ui-sdk、plugin-sdk、testkit、replay、`lib/*`、`plugins/*`）；`tools/` 只放仓库工程工具，不放产品命令；`profiles/` 只放装配清单。〔推理；Helm 把全部放 `packages/`〔一手〕，灵鲸多一个 `apps/` 是因为组合根已经在那里，且 `apps/*` 的依赖规则各不相同〕
- **core 一个包、每个模块一个目录、每个目录一个 required 插件**；`core/src/index.ts` 导出 `REQUIRED` 全集，core 不带 `liwa` 字段。不拆成每模块一个包：required 本来就不可替换，拆包换不来可替换性，却要多 20 多次 `tsc` 与 vitest 项目。〔一手：loader 从组合根代码收 required，`liwa.plugins[]` 没有被 loader 使用；〔推理〕成本〕
- **`liwa` 命令行的可执行入口在 `packages/cli`**：静态只依赖 contracts 与新增的 `@liwa/client`；本机命令与开发命令只许**动态 import** `@liwa/app`、`@liwa/replay`（dependency-cruiser 按 `dynamic-import` 依赖类型查）。这样 `liwa status` 不拖起 cordis，`liwa replay` 也不会让 app 与 replay 成环。〔一手：Helm `packages/cli` 依赖 `@getpaseo/server/daemon-control` 等子路径拉起守护进程；〔推理〕成环分析〕
- **种类与运行位置分开**：种类（required / builtin / external / data）仍按真实路径推导，只表示代码从哪来；**进程内还是子进程**由 manifest 新字段声明（`runtime`）。微信适配器留在 `packages/plugins/form-wechat`，种类 builtin、`runtime: subprocess`。不为运行位置单开目录，换运行位置不挪目录。要改 kernel，交给 K。〔一手：`deriveKind` 只认路径，`checkManifest` 把 external 一律拒绝；`plugin-architecture` D6 的"内置档：依赖第三方协议栈或原生代码的放进程外"〔二手〕〕
- **前后端同属一个插件包时**：`src/` 是后端、`client/` 是界面贡献（浏览器）、`shared/` 是本插件前后端共用的纯 schema；`exports["./client"]` 就是"有界面"的唯一声明。主控台 `packages/console` 是唯一界面宿主，界面插件开发包 `@liwa/ui-sdk`【V1.1】。〔一手：Koishi 插件 `src/` + `client/`；Helm 插件 `index.server.ts` + `index.client.tsx` + `shared/`〕
- **本地模型的 Python 服务就是一个插件包**，放 `packages/plugins/<槽位简名>-<实现名>/`（`package.json` 带 manifest + `pyproject.toml`），不设顶层 `services/`；进程外插件开发包 `@liwa/plugin-sdk` 同时带 TS 与 Python 两份 IPC 客户端。CI 加一步 `uv run pytest`。〔推理；kernel §10 定的 IPC 宿主已经管重启、熔断、资源上限，Python 服务走它就不必在插件里再写一遍监管〕
- **几处"两边都能放"改成唯一归属**：录放大脑是 `plugins/brain-replay`（testkit 的路径推不出种类，真实 loader 装不进）；迁移 SQL 跟着表的所有者模块走；launchd、`LIWA_HOME` 初始化归 `apps/liwa`；backup / restore / migrate 的实现归 core 的离线操作、入口只有 `liwa`；20 场景与探针只在 `replay`；人设样板不进 `profiles/`。
- **规则验证结果**：现有规则在包之间、core 层向下、插件不碰 core 与 `child_process`、客户端只依赖 contracts、定时器白名单、禁深引用上**全部生效**（§9 共 30 条违规全被拦）。缺口 7 处：同层**模块级**成环不拦（只拦文件级）；core 根目录文件可深引用模块内部；`createRequire` 绕过 `child_process` 禁令；`randomBytes`、`process.hrtime`、`process.on`、`fs.watch` 不拦；**服务注入（`inject`）完全不受层表约束**（core 模块之间主要靠注入互调，这是最大的漏洞，交给 K 与 C）；客户端侧被误禁定时器；单文件行数上限没有机器检查。

## ② 锁定版目录树

### 2.1 全树（到每个包的 `src/` 一级）

版本标记：【m0】路线图 1.7 终端能跑；【V1.0】【V1.1】【V2】…【V5】见 `product.md` §11；【kernel-1】第一个进程外插件出现时。

```
liwa/
├─ .node-version                    Node 24.18.0；engines 同步钉死【m0】
├─ package.json                     工作区根：工程脚本（ci、lint、typecheck、test、test:contract、contracts:export）与 `liwa` 别名；开发依赖【m0】
├─ pnpm-workspace.yaml              工作区包位置的唯一来源（apps/*、packages/*、packages/plugins/*、packages/lib/*、tools）与 catalog【m0】
├─ tsconfig.base.json               本体侧（Node）编译选项【m0】
├─ tsconfig.web.json                浏览器与同构包的编译选项：lib 加 DOM、jsx、types 为空【m0：contracts、client 起用】
├─ tsconfig.json                    根目录自身的 TS 文件【m0】
├─ vitest.config.ts                 按工作区生成测试项目（经 tools/workspace.cjs 读 pnpm-workspace.yaml）【m0】
├─ eslint.config.js                 时钟、随机、定时器、默认导出、any、行数（§3.4）【m0】
├─ .dependency-cruiser.cjs          包之间与 core 层表（§3.1、§3.2）【m0】
├─ THIRD_PARTY_NOTICES.md  LICENSE  README.md  .gitignore
├─ profiles/                        仓库层装配清单：m0-terminal.yml、m1-skeleton.yml、v1.yml、dev.yml（只放 profile）【m0 起】
├─ apps/
│  ├─ liwa/        @liwa/app        本体的组合根与进程入口；依赖全部插件包（本发行版的插件清单就是它的 dependencies）【m0】
│  │  └─ src/
│  │     ├─ index.ts                公开入口：assemblyOptions、dumpAssembly、LOCAL_COMMANDS 与本机命令实现（只给 cli 动态加载）
│  │     ├─ main.ts                 本体进程入口：自检 → startKernel → 信号 → 45 秒关闭截止【m0】
│  │     ├─ commands/               本机命令的编排：start、stop、restart、status、doctor、dump-config、profile、logs、backup、restore、migrate【m0 起逐条】
│  │     ├─ home/                   LIWA_HOME 目录表与首次初始化、liwa.config.json 模板【m0】
│  │     ├─ boot/                   启动失败计数 run/boot.json【m0】
│  │     ├─ safe-mode/              不经 kernel 的极简安全页【m0】
│  │     ├─ logging/                pino、按天轮转、正文脱敏，注入 kernel【m0】
│  │     ├─ secrets/                钥匙串与 secrets.env 解析器，注入 kernel【m0】
│  │     ├─ launchd/                LaunchAgent plist 生成、装载、卸载（ExitTimeOut ≥ 45 秒）【V1.0】
│  │     └─ __tests__/
│  ├─ desktop/     @liwa/desktop    Mac 客户端 Electron 薄壳：加载本体 URL，不打包主控台【V1.1】
│  │  └─ src/
│  │     ├─ main/                   主进程：窗口、托盘、系统通知、自启、全局快捷键；V5 桌宠窗口
│  │     ├─ preload/                contextBridge 暴露 HostBridge 白名单（只 require electron，校验 sender）
│  │     └─ __tests__/              含 preload 沙箱测试
│  └─ mobile/      @liwa/mobile     原生手机端（含实时通话入口）【V5】
│     └─ src/
├─ packages/
│  ├─ contracts/   @liwa/contracts  协议规范；零运行时依赖（zod 除外），浏览器可用【m0】
│  │  ├─ src/                       index.ts、z.ts、common.ts、errors.ts、services.ts + manifest/、slots/、views/、events/、ledgers/、tools/、protocol/（client、ipc、command、host）、__tests__/
│  │  └─ schemas/                   导出的 JSON Schema（生成物，提交入库，CI 核一致；Python 插件用它校验 IPC 消息）【V1.0】
│  ├─ kernel/      @liwa/kernel     插件机制底座【m0】
│  │  └─ src/                       loader、manifest、profile、slots、plugin、context、clock、rng、ids、logger、secrets、graph、assembly、events、types、testing + ipc/【kernel-1】、__tests__/
│  ├─ core/        @liwa/core       全部 required 插件：每个模块一个目录、一个 defineService【m0 起】
│  │  ├─ src/
│  │  │  ├─ index.ts                导出 REQUIRED（全集）与离线操作（backup、restore、migrate、selfCheck）
│  │  │  ├─ db/                     基础层：openWriter / openReader、迁移执行器与 schema_version、worker 启动助手、备份与恢复【m0】
│  │  │  ├─ journal/                基础层：经历流、投影运行器、载荷与大对象【m0】
│  │  │  ├─ guard/                  守护【m0】
│  │  │  ├─ procs/                  资源：子进程登记、进程组、看门狗、清孤儿【m0】
│  │  │  ├─ brains/                 资源：大脑契约层、预审与切换、用量归一、结构化生成循环【m0】
│  │  │  ├─ abilities/              资源：能力注册表与回退链【V1.0】
│  │  │  ├─ workspace/              资源：worktree、快照、回收站、写租约【V1.0】
│  │  │  ├─ notify/                 资源：主人注意力事件路由【V1.0】
│  │  │  ├─ formhost/               资源：形态适配器托管【V2】
│  │  │  ├─ ledgers/
│  │  │  │  ├─ roster/              账本：成员、自主开关、大脑配置【V1.0】
│  │  │  │  ├─ self/                账本：出生设定、性格参数、成长版本、日记【V1.0】
│  │  │  │  ├─ body/                账本：身的一行、冲动、tick 动力学【V1.0（M1 最小版）】
│  │  │  │  ├─ memory/              账本：记忆条目、召回 worker、删除级联【V1.0】
│  │  │  │  ├─ people/              账本：人物档案、地方、受众【V1.0】
│  │  │  │  └─ skills/              账本：能做 / 会做 / 爱做、习惯【V1.0】
│  │  │  ├─ minds/                  运行：四种用脑的会话、邮箱、回合【m0】
│  │  │  ├─ context/                运行：稳定前缀与每轮前缀【m0】
│  │  │  ├─ actions/                运行：副作用管线【m0】
│  │  │  ├─ senses/                 编排：入站归一【m0】
│  │  │  ├─ attention/              编排：显著性、焦点、去向【m0】
│  │  │  ├─ outbox/                 编排：对外发言【m0】
│  │  │  ├─ will/                   编排：承诺、打算、决策点【V1.0】
│  │  │  ├─ scheduler/              编排：作业表【V1.0】
│  │  │  ├─ tasks/                  编排：手上的事【V1.0】
│  │  │  ├─ toolport/               接入：内核工具端点【m0】
│  │  │  ├─ gateway/                接入：HTTP + WebSocket、主人接口、托管主控台静态文件【m0】
│  │  │  └─ __tests__/
│  │  └─ test/                      core 内跨模块集成、真实 loader 装配、删表重建等价【m0】
│  ├─ client/      @liwa/client     客户端连接：握手、请求响应、订阅与游标、重连退避、幂等键、服务端副本 store；同构（浏览器、Node、RN）【m0】
│  │  └─ src/                       connection/、subscriptions/、stores/、__tests__/
│  ├─ cli/         @liwa/cli        `liwa` 命令行：可执行入口、参数解析、渲染、退出码；本体命令经 client，本机与开发命令动态加载 app / replay【m0】
│  │  ├─ bin/liwa.js
│  │  └─ src/                       commands/、output/、acp/（`liwa acp serve`，以后）、__tests__/
│  ├─ console/     @liwa/console    网页主控台 SPA（React + Vite），由 gateway 托管；V2 起响应式即手机远程【V1.0】
│  │  ├─ index.html  vite.config.ts
│  │  └─ src/                       shell/、areas/（她现在、她的一天、手上的事、她在意的、她的人、她的成长、开发者视图、设置与插件）、workspace/【V1.1】、host/（HostBridge 的网页实现）、plugins/（插件界面注册表，构建时生成）、entries/（main；pet【V5】）、__tests__/
│  ├─ ui-sdk/      @liwa/ui-sdk     界面插件开发包：ui.* 槽位类型、defineUiPlugin、建在 client 上的 React hooks【V1.1】
│  │  └─ src/
│  ├─ plugin-sdk/  @liwa/plugin-sdk 进程外插件开发包：IPC 客户端（fd 3、JSON-RPC、握手、取消、ack）【kernel-1】
│  │  ├─ src/                       TS 版
│  │  └─ python/                    Python 版 liwa_plugin_sdk（第一个 Python 插件出现时）
│  ├─ testkit/     @liwa/testkit    假时钟、计数器随机、编号源、服务假实现、假出口、测试内核便利封装（不含任何插件）【m0】
│  │  └─ src/
│  ├─ replay/      @liwa/replay     回放、指标、场景库、探针【m0：探针；V1.0：L0 与指标】
│  │  ├─ src/                       l0/、l1/【V1.1】、l2/、scenarios/（20 场景的唯一定义）、probe/、metrics/（A–G）、__tests__/
│  │  └─ test/                      场景录制测试、L0 同种子一致性
│  ├─ lib/                          插件之间共用的库：不是插件，不带 liwa 字段
│  │  └─ brain-shared/ @liwa/brain-shared  三个大脑适配器共用的 Paseo 基础代码【m0】
│  │     └─ src/                    paseo/、__tests__/
│  └─ plugins/                      每个插件一个包；目录名 = manifest id = 包名去掉 `@liwa/plugin-`
│     ├─ brain-claude/              brain.provider·claude（Paseo 摘）【m0】
│     ├─ brain-codex/               brain.provider·codex（Paseo 摘）【V1.0 冒烟；V1.1 全验证】
│     ├─ brain-acp/                 brain.provider·acp，multiInstance（Paseo 摘，不验收）【V1.0】
│     ├─ brain-replay/              brain.provider·replay：录放大脑，测试与 L1 回放用【m0】
│     ├─ memory-engine-default/     memory.engine·default【V1.0】
│     ├─ memory-engine-minimal/     memory.engine·minimal：替换演练用的极简引擎【V1.1】
│     ├─ growth-engine-default/     growth.engine·default【V1.0】
│     ├─ social-model-default/      social.model·default【V1.0】
│     ├─ persona-template-default/  persona.template·default（data）：人设与出生设定样板【m0】
│     ├─ social-pack-default/       social.pack·default（data）：关系与角色内容包【V2】
│     ├─ job-trigger-time/          job.trigger·time：cron、一次性、间隔（解析从 Paseo 摘）【V1.0】
│     ├─ ability-embed-local/       ability.embed·local：Qwen3-Embedding-0.6B（进程内 node-llama-cpp；退路换 Python 子进程，同包同 id）【V1.0】
│     ├─ ability-speech-local/      ability.speech·local：Paseo speech + dictation，SenseVoice / Whisper【V1.1】
│     ├─ ability-speech-<厂商>/     ability.speech 的线上实现【V1.1】
│     ├─ ability-vision-<厂商>/     ability.vision 的线上实现【V1.1】
│     ├─ ability-world-<来源>/      ability.world：天气、节日【V1.1】；日历【V4】
│     ├─ gate-policy-default/       gate.policy·default：群聊第二道门【V2】
│     ├─ form-wechat/               form.adapter·wechat，runtime: subprocess【V2】
│     ├─ form-<平台>/               以后的 QQ、B 站、抖音（她去的地方若另立槽位，同样放这里）【V2 后；V4】
│     ├─ tool-<名字>/               toolport.tool 的贡献【V3】
│     └─ sandbox-<后端>/            sandbox.provider（以后可加的槽位）【V4】
├─ tools/          @liwa/tools      仓库工程工具，不是产品命令【m0】
│  ├─ ci.sh                         lint → typecheck → test → python → 检查项
│  ├─ workspace.cjs                 工作区布局的唯一读取口：解析 pnpm-workspace.yaml，给 vitest、dependency-cruiser、检查脚本用
│  ├─ check-layout.ts               目录名 = manifest id = 包名后缀；core 目录 = 层表 = SERVICE_KEYS【m0】
│  ├─ check-notices.ts              有 src/paseo/ 或"来源"文件头的包必须有 NOTICE 且在 THIRD_PARTY_NOTICES 登记【m0】
│  └─ contracts-schemas.ts          写出或核对 packages/contracts/schemas/【V1.0】
└─ docs/                            product、portrait、roadmap、engineering、handoff、architecture/（overall、modules/00–10）、plans/（实现计划）、scenarios/、research/、conversations/
```

### 2.2 包内模板

**core 的模块目录**（`core/src/<模块>/`，账本是 `core/src/ledgers/<账本>/`）：

```
index.ts        公开 API + defineService(...)；跨模块只许引用它
types.ts        模块内类型；对外类型在 contracts
params.ts       数值参数（初值、单位、来源）
migrations/     本模块拥有的表的 DDL：NNN_<名字>.sql（有表才有）
worker.ts       本模块的 worker 线程入口（有重查询才有，如 ledgers/memory）
ledger.ts、projection.ts   账本专有：校验与写事件、事件到表
<实现>.ts
__tests__/
```

**插件包**（`packages/plugins/<id>/`）：

```
package.json    liwa 字段（manifest）；exports 含 "."、"./package.json"，有界面再加 "./client"
README.md       实现哪个槽位、契约版本、配置项、来源
NOTICE          第三方来源（摘了代码才有）
src/            后端（进程内或子进程）：index.ts（export const plugin）、config.ts、adapter.ts、paseo/、__tests__/
client/         界面贡献（浏览器）：index.ts、tsconfig.json（继承 tsconfig.web.json）、__tests__/【按需，V1.1 起】
shared/         本插件 src 与 client 共用的纯 schema，只依赖 contracts【按需】
test/           本插件的跨文件集成测试【按需】
```

**Python 插件**（同在 `packages/plugins/<id>/`）：`package.json`（manifest，`runtime: subprocess`，只导出 `./package.json`）、`pyproject.toml`、`uv.lock`、`.python-version`、`src/liwa_<id>/`、`tests/`。

## ③ 依赖规则表

状态：✓ 现有规则已生效（§9 验证编号）；△ 部分生效；✗ 缺；新 = 锁定版新增。

### 3.1 包之间（静态 import，dependency-cruiser）

| 从 | 可以依赖 | 规则 | 状态 |
| --- | --- | --- | --- |
| contracts | zod；不许 Node 内置 | `contracts-only-zod`、`contracts-no-node-builtins` | ✓ V17。△ Node 全局（`process`、`Buffer`）不拦：contracts 改用 `tsconfig.web.json`（types 为空） |
| kernel | contracts、cordis、yaml、Node 内置 | `kernel-allowed-deps` | ✓ V18 |
| core | contracts、kernel、@node-rs/jieba、Node 内置 | `core-allowed-deps` | ✓ V10 |
| testkit | contracts、kernel（含 `./testing`） | `testkit-allowed-deps` | ✓（同形规则） |
| lib/<x> | contracts、kernel | `brain-shared-allowed-deps` → 泛化为 `lib-allowed-deps` | ✓；泛化是新 |
| lib/brain-shared 的使用方 | 只有 `plugins/brain-*` | `brain-shared-only-for-brains` | ✓ V14 |
| plugins/<x>/src（进程内） | contracts、kernel、自己声明的第三方；brain-* 加 brain-shared；自己的 shared/ | `plugins-workspace-deps` | ✓ V19（插件互引被拦） |
| plugins/* 不碰 core（含测试与纯类型） | — | `plugins-not-to-core` | ✓ V12、V15 |
| plugins/* 不 import child_process | — | `plugins-no-child-process` | ✓ 静态与动态 import（V11、pass3）；✗ `createRequire` 绕过（pass3），补 ESLint E10 |
| plugins/<x>/src（runtime: subprocess，TS） | contracts、plugin-sdk、自己声明的第三方；不许 kernel | `plugins-subprocess-deps`（配置文件读各插件 manifest 的 `runtime` 生成） | 新 |
| plugins/<x>/client | contracts、client、ui-sdk、react；自己的 shared/；不许自己的 src/、kernel、Node 内置 | `plugin-client-deps` | 新 |
| plugins/<x>/src → 自己的 client/ | 禁止 | `plugin-src-not-client` | 新 |
| plugins/<x>/shared | contracts | `plugin-shared-pure` | 新 |
| client | contracts；不许 Node 内置 | `client-allowed-deps` | 新 |
| ui-sdk | contracts、client、react | `ui-sdk-allowed-deps` | 新 |
| plugin-sdk | contracts | `plugin-sdk-allowed-deps` | 新 |
| cli | 静态：contracts、client；动态 import：app、replay | `cli-allowed-deps`（改）+ `cli-heavy-only-dynamic`（`to.dependencyTypesNot: ['dynamic-import']`） | ✓ V16（现为只许 contracts）；改动是新 |
| console | contracts、client、ui-sdk、react、react-dom；插件 `./client` 入口只许 `src/plugins/` 引用 | `console-allowed-deps`（改） | ✓ V16；改动是新 |
| apps/desktop | contracts、client、electron | `desktop-allowed-deps` | 新（现有 `clients-only-contracts` 写的是 `packages/desktop`） |
| apps/mobile | contracts、client、RN 依赖 | `mobile-allowed-deps` | 新【V5】 |
| replay | contracts、kernel（含 `./testing`）、core、app、testkit | `replay-allowed-deps` | ✓（同形规则） |
| testkit 与 kernel `./testing` 的使用方 | 测试文件、testkit、replay | `testkit-only-in-tests`（扩到 `./testing`） | ✓ V10；扩展是新 |
| apps/liwa | 全部（含 console，用来定位构建产物交给 gateway） | 无 | ✓ |
| tools | contracts 与根开发依赖；不依赖 app | `tools-allowed-deps` | 新（`tools/package.json` 现依赖 `@liwa/app`） |
| 跨包深引用 | 只许对方 `exports` 声明的入口 | `only-public-entry-across-packages`（相对路径）+ Node `exports`（包名子路径，表现为 `not-to-unresolvable`） | ✓ V13；规则改为从各包 `exports` 读允许的入口 |
| 产品代码不碰测试文件、第三方开发依赖 | — | `not-to-test`、`not-to-dev-dep` | ✓；`not-to-dev-dep` 只对第三方生效，工作区包靠 `testkit-only-in-tests` |
| 任意成环 | — | `no-circular` | ✓ V2（文件级） |

### 3.2 core 内（dependency-cruiser）

层表（自上而下，只许向下调用）：接入 gateway、toolport → 编排 senses、attention、will、scheduler、tasks、outbox → 运行 minds、context、actions → 账本 ledgers/* → 资源 brains、procs、formhost、abilities、workspace、notify → 守护 guard → 基础 journal、db。插件宿主是 kernel 包，不在 core 的 import 图里（core 全体都 import kernel；kernel 调 procs、journal 走服务注入）。〔一手：`.dependency-cruiser.cjs` 的 `CORE_LAYERS`、`overall.md` §3.2〕

| 规则 | 现有 | 状态 |
| --- | --- | --- |
| 每层不许依赖更高层 | `core-layer-<层>-not-upward` ×6 | ✓ V1（基础→接入）、V6（账本→运行）、V7（资源→账本） |
| 跨模块只许引用对方 index.ts | `core-module-only-via-index` | ✓ V1–V7 |
| core/src 根文件（index.ts）也只许引用模块 index.ts | 无 | ✗ V5 未拦 → 新 `core-root-only-via-index` |
| 同层不成环（模块级） | 只有文件级 `no-circular` | ✗ V3（will↔tasks 模块成环、文件不成环）未拦 → 新 `core-module-no-cycle`（`scope: 'folder'`，dependency-cruiser 18.7 的规则 schema 支持〔一手：`configuration.validate.mjs` 的 `scope` 枚举 module / folder〕，实现时要实测） |
| core/src 下的目录都在层表里 | `core-module-in-layer-table` | △ V4 拦住了，但规则 `to: {}` 要求该文件至少有一个依赖，空目录与无 import 的文件漏网 → `tools/check-layout.ts` 补：core 目录 = 层表 = `SERVICE_KEYS`（另加 db、`__tests__`） |

### 3.3 服务注入（运行时依赖，kernel 第 1 阶段）

| 规则 | 现有 | 状态 |
| --- | --- | --- |
| required 之间的 `inject` 只许下层，同层不成环 | `buildServiceGraph` 只查缺提供方、重复提供、成环 | ✗ **最大缺口**。core 模块以 `defineService` + `inject` 互用，跨模块调用主要走 `ctx.services.x`，类型来自 contracts，**不经任何 import**，dependency-cruiser 看不见。V7 的 brains→roster 用 import 写会被拦，改用 `inject: ['roster']` 就畅通无阻〔一手：`packages/kernel/src/graph.ts`〕。→ contracts 出层表 `SERVICE_LAYERS`（JSON，dependency-cruiser 配置也读同一份），kernel 第 1 阶段对 required 的 `inject` 做向下检查（交给 K、C） |

### 3.4 ESLint

| 规则 | 现有 | 状态 |
| --- | --- | --- |
| E1 禁 Date.now、无参 new Date、Date()、performance.now、Math.random、randomUUID、getRandomValues | 全仓 | ✓ V8。范围改为只罩本体侧（apps/liwa、packages/{kernel,core,plugins,lib,testkit,replay}）；客户端侧（cli、client、console、ui-sdk、apps/desktop、apps/mobile）与 tools 不受回放约束 |
| E2 setTimeout / setInterval 只许 kernel 与 core/procs | 全仓除 kernel、procs | ✓ V8、V9；✗ 误伤客户端（V16 cli 的重连退避被拦），范围同 E1 |
| E3 禁 randomBytes、randomInt、randomFillSync、process.hrtime | 无 | ✗ V8 第 13、14 行未拦 |
| E4 禁 process.on / once、fs.watch / watchFile（`00-plugin-kernel.md` §8） | 无 | ✗ V8 第 15、16 行未拦；apps/liwa（信号）、kernel、core/procs 放行 |
| E5 登记回调的方法必须包进 ctx.effect（§8） | 无 | ✗ 用 no-restricted-syntax 写不准，建议 K 改 API 形状（登记即自动挂到插件的 effect），不靠 lint |
| E6 不用默认导出；E7 不用 any | 有 | ✓ V8 |
| E8 禁 `@liwa/<包>/<子路径>` | 有 | ✓ V13，但与 Node `exports` + `not-to-unresolvable` 重复，且会拦住合法的 `./client`、`./testing` → 删除，只留 `exports` 这一处来源 |
| E9 单文件行数上限（`overall.md` §3.2 第 6 条"由检查工具强制"、`engineering.md` §9 的 400 行） | 无 | ✗ → `max-lines`（400，跳过空行与注释，`src/paseo/**` 例外）；`packages/kernel/src/loader.ts` 现 605 行，交给 K |
| E10 插件禁 createRequire、process.binding、process.dlopen | 无 | ✗ pass3 的 `createRequire` 未拦 |

### 3.5 CI 检查（`tools/ci.sh`）

| 检查 | 现有 | 状态 |
| --- | --- | --- |
| lint、typecheck、test | 有 | ✓ |
| `src/paseo/` ⇒ NOTICE（`engineering.md` §4.3） | 无 | ✗ → `check-notices.ts` |
| 目录名、manifest id、包名、层表、SERVICE_KEYS 一致 | 无 | ✗ → `check-layout.ts` |
| schema 导出一致性、dump-config 快照（§4.4） | 无（ci.sh 注释写"落地后接"） | ✗ 按计划接 |
| Python 插件 | 无 | 新：对每个含 `pyproject.toml` 的工作区包跑 `uv run --directory <包> --frozen pytest -q` |

## ④ 现状到锁定版的改动清单

### 4.1 现状与 `engineering.md` §4 的差异

| # | 差异 | 依据 |
| --- | --- | --- |
| 1 | §4.2 说 core"入口由 `liwa.plugins[].entry` 指定"；`packages/core/package.json` 没有 `liwa` 字段，loader 的 required 来自组合根代码（`startKernel({ required })`），`liwa.plugins[]` 与 `SubPlugin.service` 在 kernel 里没有任何使用方 | 〔一手〕`loader.ts` 第 123–150 行；`grep` 无引用 |
| 2 | `REQUIRED` 常量写在 `apps/liwa/src/index.ts`，而 required 插件全部是 core 的模块 | 〔一手〕 |
| 3 | §4.7 把 `plugins/form-*` 标成 external，`deriveKind` 把 `packages/plugins/*` 推成 builtin，`checkManifest` 拒绝一切 external | 〔一手〕`manifest.ts` 第 48–60、78–83 行 |
| 4 | §4.2 与 §4.7 把录放大脑（一个 brain.provider 实现）放进 testkit；`packages/testkit` 不在 `deriveKind` 认识的位置，按包装载会报"包不在已知位置" | 〔一手〕`manifest.ts` 第 58 行 |
| 5 | launchd 两处：§4.3 `apps/liwa/src/launchd/`，§4.4 `tools/launchd/com.liwa.core.plist` | 〔一手〕 |
| 6 | 20 场景两处：§4.3 `core/test` 的"20 场景录制测试"，§4.2 replay 的"回放题库、探针场景"；core 测试若引用 replay 会成环（replay 依赖 core）；`roadmap.md` 1.3 另写"在仓库建 `probe/`" | 〔一手〕 |
| 7 | 迁移：§4.3、§6 是集中的 `db/migrations/`；`overall.md` §3.2 第 3 条"每个模块只读写自己的表"、`00-plugin-kernel.md` §5.1 第 3 阶段"迁移由对应 required 插件的 recover 钩子执行" | 〔一手〕 |
| 8 | §4.4 的 `backup.ts`、`restore.ts`、`migrate.ts`、`dump-config.ts`、`export-schemas.ts` 与 §12 的 `liwa backup / restore / migrate / dump-config / contracts export` 是同一件事的两个入口 | 〔一手〕 |
| 9 | `@liwa/plugin-job-triggers` 不合 §4.2 的命名规则 `plugin-<槽位简名>-<实现名>`；manifest 的 `provides` 每个槽位只能写一个 impl，一个包写不下 cron、一次性、间隔三个实现 | 〔一手〕`manifest/liwa.ts` `Provides` |
| 10 | cli、console、desktop 都要连 gateway（握手、订阅游标、重连），§4.2 没有共用的连接包，各写一份会违反"复制粘贴不超过两次" | 〔二手〕`client-backend` §3"前端工程与状态"建议 `packages/client`；〔一手〕Helm 有 `@getpaseo/client` |
| 11 | ESLint 的时钟、定时器禁令罩住了 cli 与 console，而它们不在回放范围内、需要重连退避与界面节流 | 〔一手〕§9 V16 |
| 12 | 全部包（含 contracts、console）都继承带 `types: ["node"]` 的同一个 base | 〔一手〕`tsconfig.base.json` |
| 13 | 工作区布局写了三份：`pnpm-workspace.yaml`、`vitest.config.ts` 的 `WORKSPACE_PATTERNS`、`.dependency-cruiser.cjs` 的 `PACKAGE_ROOT` 与 `PKG` | 〔一手〕 |
| 14 | `tools/package.json` 依赖 `@liwa/app`，§4.6 的依赖表没有 tools 一行 | 〔一手〕 |
| 15 | `overall.md` §3.3 模块清单把 context 列在编排层，§3.2 与决策 31 是运行层（dependency-cruiser 按运行层） | 〔一手〕 |
| 16 | kernel 主入口导出 `SlotRegistry`、`buildServiceGraph`、`deriveKind`、`checkManifest`、`resolveProfile`、`createTestKernel`、`fakeClock` 等，超出 §11 列的公开 API | 〔一手〕`kernel/src/index.ts` |
| 17 | 其余（profiles 只有 m0、tools 与 apps 未建的文件、ci.sh 未接 schema 与快照）是按计划未到，不算冲突 | 〔一手〕 |

### 4.2 改动清单

| # | 改什么 | 为什么 | 依据 |
| --- | --- | --- | --- |
| 1 | 新建 `packages/client`（`@liwa/client`），m0 就建（cli 第一个用） | 连接逻辑唯一归属；cli、console、desktop、mobile 共用 | 4.1 #10 |
| 2 | `packages/cli` 加 `bin/liwa.js`，成为 `liwa` 的唯一可执行入口；静态只依赖 contracts、client，app 与 replay 只许动态 import | §⑤(a) | Helm cli〔一手〕；M 的 `00-commands.md` §4.1 机制要求〔一手〕 |
| 3 | `packages/desktop` 改为 `apps/desktop`【V1.1 建】；新增 `apps/mobile`【V5】 | 它们有自己的主进程与打包，不被任何包引用；`apps/*` 各自一条依赖规则 | 〔推理〕 |
| 4 | 录放大脑落 `packages/plugins/brain-replay`；testkit 只留假实现与测试便利 | 真实 loader 按路径推种类，testkit 路径装不进 | 4.1 #4 |
| 5 | `packages/plugins/job-triggers` 改名 `job-trigger-time`（impl `time`，三种触发写在 `meta.kinds`） | 命名规则与 `provides` 一槽一 impl | 4.1 #9 |
| 6 | `core/src/index.ts` 导出 `REQUIRED` 全集与离线操作；`apps/liwa` 改为 import 它；core 不加 `liwa` 字段 | required 是 core 的东西，清单归 core | 4.1 #1、#2 |
| 7 | 迁移 SQL 放各所有者模块的 `migrations/`；`db/` 只放执行器与 `schema_version(owner, version)`，由各模块 `recover` 调用 | 表归谁、DDL 归谁；与第 3 阶段对齐 | 4.1 #7 |
| 8 | worker 入口归用它的模块（`ledgers/memory/worker.ts`）；`db/` 只给只读连接与启动助手 | 放在 db 的 worker 入口要 import 账本实现，就是基础层向上依赖 | 〔推理〕；`05-memory.md` §7.2 召回在 worker〔一手〕 |
| 9 | launchd 只在 `apps/liwa/src/launchd/`；`LIWA_HOME` 初始化在 `apps/liwa/src/home/`；backup、restore、migrate 实现在 core 的离线操作，入口只有 `liwa`；`tools/` 不建 init-home、backup、restore、migrate、launchd；`tools/dump-config.ts`、`tools/placeholder.ts` 在 bin 落地时删 | 一件事一个入口 | 4.1 #5、#8 |
| 10 | 20 场景只定义在 `replay/src/scenarios/`，录制测试在 `replay/test/`；探针在 `replay/src/probe/`；core/test 只留 core 内集成 | 唯一归属、避免 core↔replay 成环 | 4.1 #6 |
| 11 | 人设样板进 `plugins/persona-template-default`（data），`profiles/` 只放 profile | `persona.template` 槽位已是这类样板的归属；`02-minds.md` 草稿写的 `profiles/persona.example.md` 会让 profiles 混进别的东西 | 〔一手〕`slots/defs.ts`；〔推理〕 |
| 12 | 插件包 `client/`、`shared/` 约定，`exports["./client"]` 即声明；新建 `packages/ui-sdk`【V1.1】 | 前后端分目录，tsconfig 与依赖规则各不相同 | Koishi、Helm〔一手〕 |
| 13 | 本地模型 Python 服务作为插件包放 `packages/plugins/`；`plugin-sdk` 带 `python/` | §⑤(f) | 〔推理〕 |
| 14 | 种类与运行位置分开，加 manifest `runtime` | §⑤(c) | 4.1 #3 |
| 15 | dependency-cruiser：新增 §3.1、§3.2 标"新"的 13 条，`cli`、`console`、`clients-only-contracts` 改写；PKG 表加 client、ui-sdk、plugin-sdk、apps/desktop、apps/mobile、tools | 规则跟着包走 | §9 |
| 16 | ESLint：E1、E2 改范围；补 E3、E4、E9、E10；删 E8 | §3.4 | §9 |
| 17 | 加 `tsconfig.web.json`；contracts、client、console、ui-sdk、插件 `client/` 用它；contracts 不带 Node 类型 | 浏览器可用要靠编译器保证，依赖规则只管 import | 4.1 #12 |
| 18 | `tools/workspace.cjs` 解析 `pnpm-workspace.yaml`，vitest 与 dependency-cruiser 都从它取布局 | 布局只有一份来源 | 4.1 #13 |
| 19 | 类型检查改为每个 TS 包一个 `typecheck` 脚本、根上 `pnpm -r --if-present run typecheck`；有 `client/` 的包脚本里多跑一个 tsconfig | Python 包没有 tsconfig；`client/` 用另一套编译选项 | 〔推理〕：没有 tsconfig 的目录里 `tsc --noEmit` 只打印用法并以非 0 退出，未在本仓库实测 |
| 20 | vitest 只为有 `tsconfig.json` 的包建项目；有 `client/` 或本身是浏览器包的再建一个 `<包名>:web` 项目（`happy-dom`，首次用到时进 catalog） | 环境不同 | 〔推理〕 |
| 21 | `apps/liwa` 依赖 `@liwa/console`，把它的构建产物目录交给 gateway 托管 | gateway 在 core，不能依赖 console | `overall.md` §3.7〔一手〕 |
| 22 | `tools/package.json` 去掉 `@liwa/app`，只依赖 contracts | tools 不是产品入口 | 4.1 #14 |

## ⑤ 4(a)–(g) 的结论与取舍

### (a) `liwa` 命令行落在哪

| 方案 | 做法 | 选了吗 | 为什么 |
| --- | --- | --- | --- |
| A | `packages/cli` 是 bin；静态依赖 contracts、client；本机命令动态 import `@liwa/app` 的公开入口，开发命令（replay、eval、probe）动态 import `@liwa/replay` | **选** | cli 在依赖图最上面，能到达 app 与 replay 而不成环；`liwa status` 只加载 contracts 与 client；依赖类型 `dynamic-import` 能被 dependency-cruiser 区分（§9 pass3 实测动态 import 被单独识别；规则 schema 有 `dynamic-import`〔一手〕）；Helm 的 cli 同样依赖 server 的 `daemon-control` 等子路径〔一手〕 |
| B | bin 放 `apps/liwa`，`packages/cli` 退成只依赖 contracts 的库 | 不选 | replay 依赖 app（L1、L2 要真实装配），bin 在 app 里就引用不了 replay，`liwa replay / eval / probe` 只能另起一个可执行文件 |
| C | cli 只依赖 contracts，本机命令 shell 出 `node apps/liwa/dist/main.js <子命令>` | 不选 | 同一套参数解析与输出要在两个进程各写一份；退出码与 `--json` 难统一 |

归属细分：本机命令的**编排**（start 怎么拉起本体或 launchctl、stop、status 读 pid 与探活、doctor 汇总、dump-config、profile、logs）在 `apps/liwa/src/commands/`，声明表 `LOCAL_COMMANDS` 也在那里（M 的 `00-commands.md` §3.3）；**数据操作**（backup、restore、migrate、selfCheck）的实现归 core 的 `db/` 与 `journal/`，经 `@liwa/core` 公开入口导出；cli 只做解析、渲染、退出码。〔推理；数据格式归 journal 与 db，入口归组合根〕

### (b) core 一个包还是每模块一个包

| 维度 | 一个包（选） | 每模块一个包（不选） | 依据 |
| --- | --- | --- | --- |
| 可替换性 | required 不可替换，与包粒度无关 | 同左，拆了也不能替换 | `00-plugin-kernel.md` §2〔一手〕 |
| 依赖规则 | dependency-cruiser 的层表与"只经 index"已生效（V1–V7） | 包边界由 `exports` 强制，但层表仍要另写一份 | §9〔一手〕 |
| 构建与测试 | 一次 `tsc`、一个 vitest 项目 | 20 多次 `tsc`：`liwa-source` 让每个包把依赖的源码再查一遍，没有项目引用时成本叠加 | 〔推理〕；`typecheck` 脚本是逐包 `tsc --noEmit`〔一手〕 |
| 种类推导 | `packages/core/**` → required | `packages/core/<模块>` 同样推成 required（只看第二段） | `deriveKind`〔一手〕；而且 required 不经 `deriveKind`，从代码传入〔一手〕 |
| 先例 | Paseo 的 server 是一个包装全部子系统〔一手 Helm〕；Koishi 的 `@koishijs/core` 一个包〔二手〕 | DSH 369 个包〔二手〕，但它的 required 也是名单而非包粒度 | `plugin-architecture` |

结论：一个包。将来某个模块要变成可替换的，那它就不再是 required，应作为槽位实现进 `plugins/`，而不是从 core 拆包。

### (c) 进程外的形态适配器与种类推导

| 方案 | 做法 | 选了吗 | 为什么 |
| --- | --- | --- | --- |
| 1 | 种类只表示来源（按路径）；运行位置由 manifest 字段 `runtime: 'in-process' \| 'subprocess'` 声明，builtin 缺省进程内、external 必须子进程；dependency-cruiser 配置读各插件 manifest 生成子进程插件的规则 | **选** | 一处声明、规则由它派生；`ability-embed-local` 退回 Python 时只改 manifest 与实现，不挪目录；`plugin-architecture` D6 本来就写"内置档里依赖第三方协议栈或原生代码的放进程外"〔二手〕；信任模型下插件全部可信（决策 32），manifest 自报运行位置不是安全问题 |
| 2 | 单开目录（如 `packages/plugins-isolated/*`）推出"builtin + 子进程" | 不选 | 运行位置一变就要挪目录，违背"之后不再挪" |
| 3 | 改 `deriveKind`：`packages/plugins/form-*` 推成 external | 不选 | 用名字前缀猜运行位置；external 还带着"仓库外、V1 拒绝"的含义，混在一起 |

这是矛盾，不是理解问题：`engineering.md` §4.7 的 external、`overall.md` §3.5 的"外部平台适配器每个一个子进程"与 `deriveKind` + `checkManifest`（external 一律拒绝）不能同时成立〔一手〕。`00-plugin-kernel.md` §3.1"`process` 由种类推导"那一条要改，交给 K。子进程插件的附加规则：提供的槽位必须 `transport: 'any'`，`consumes` ⊆ `PLUGIN_VIEWS`，必须有 `resources` 与启动命令，不被 `import()`。

### (d) 主控台界面插件、Electron 壳、手机端

| 东西 | 放哪 | 依据 |
| --- | --- | --- |
| 主控台六区域、开发者视图、设置与插件页、主人操作的界面 | `packages/console/src/areas/`（内置，不可替换） | `plugin-architecture` D5 第 1、3、4 条〔二手〕 |
| 插件贡献的界面（`ui.area.*` 的子槽位、成员页标签、插件页的 client 入口） | 插件自己的 `client/`，`exports["./client"]` | Koishi 插件 `src/` + `client/`、`koishi.public: ['dist']`〔一手〕；Helm `index.client.tsx` + `client/` + `shared/`〔一手〕 |
| 插件前后端共用的消息 schema | 插件自己的 `shared/`，只依赖 contracts | Helm `plugin-examples/settings/shared/`〔一手〕；跨模块协议仍归 contracts |
| 界面插件开发包（槽位类型、`defineUiPlugin`、hooks） | `packages/ui-sdk`【V1.1】 | 放 console 里会让插件依赖 console、console 又引用插件，成环〔推理〕 |
| 插件界面怎么编进主控台 | console 的 Vite 配置按 `apps/liwa/package.json` 的插件依赖里带 `./client` 的生成 `src/plugins/` 注册表；同版本构建、运行时按 `AssemblyPlan` 只激活在装的插件 | 发行版插件清单唯一来源是组合根的依赖表〔推理〕；具体机制随 08 定 |
| HostBridge 接口 | 方法与消息进 `contracts/protocol/host.ts`；网页实现在 `console/src/host/`，Electron 实现在 `apps/desktop/src/preload/` | 它是渲染进程与壳进程之间的协议〔推理〕；`client-backend` §3〔二手〕 |
| Electron 薄壳 | `apps/desktop`【V1.1】：加载本体 URL，不打包主控台；主进程可经 client 订阅注意力事件做常驻通知 | `overall.md` §3.7、§10.5〔一手〕；Helm 从包内加载导致前后端错版〔二手〕 |
| 手机远程 V2 | 就是 `packages/console` 的响应式布局，不另建包 | 决策 27〔一手〕 |
| 原生手机端 V5 | `apps/mobile`，依赖 contracts、client | 〔推理〕 |
| 桌宠 V5 | `apps/desktop` 的另一种窗口，界面是 console 的 `entries/pet` | 〔推理〕；`overall.md` §3.1 列为客户端〔一手〕 |

### (e) 账本与引擎插件

规则：账本目录名 = 服务键 = required 插件 id；引擎包名 `plugin-<槽位简名>-<实现名>`，一个包实现一个槽位的一个 impl；引擎只依赖 contracts、kernel，经 `inject` 读账本的查询 API（类型在 `contracts/ledgers/`）；账本不 import 引擎包（`core-allowed-deps` 已拦），经 `HostSlots.resolve` 拿实现。〔一手：`slots/defs.ts`、`00-plugin-kernel.md` §6–§7、`06-growth.md` §3.5〕

| 账本目录 | 服务键 | 消费的槽位 | 内置实现包 | 版本 |
| --- | --- | --- | --- | --- |
| `core/src/ledgers/roster` | roster | — | — | V1.0 |
| `core/src/ledgers/self` | self | `growth.engine`（requiredBy self）；`persona.template`（data） | `plugins/growth-engine-default`；`plugins/persona-template-default` | V1.0 |
| `core/src/ledgers/body` | body | 无槽位（动力学在 core，参数经 `self.params` ← `growth.engine.deriveParams`） | — | V1.0 |
| `core/src/ledgers/memory` | memory | `memory.engine`（requiredBy memory）；经 abilities 用 `ability.embed` | `plugins/memory-engine-default`；演练 `plugins/memory-engine-minimal`【V1.1】 | V1.0 |
| `core/src/ledgers/people` | people | `social.model`（requiredBy people）；`social.pack`（data）【V2】 | `plugins/social-model-default`；`plugins/social-pack-default`【V2】 | V1.0 / V2 |
| `core/src/ledgers/skills` | skills | `growth.engine` 的做法提取方法（与 self 共用同一个成员绑定） | 同 `growth-engine-default` | V1.0 |

引擎的派生数据（向量、FTS 等）由账本的投影写进 `derived.db`，表的 DDL 归账本（`05-memory.md` §2 表的写入方是"memory 的投影器"〔一手〕）；插件私有派生存储 `ctx.storage.derived` 是 kernel 的以后项。

### (f) 本地模型的 Python 服务

| 方案 | 做法 | 选了吗 | 为什么 |
| --- | --- | --- | --- |
| 1 | Python 服务本身就是进程外插件：`packages/plugins/<id>/` 含 `package.json`（manifest，`runtime: subprocess`，启动命令）+ `pyproject.toml`，讲 kernel-1 的 IPC | **选** | 重启退避、熔断、RSS 上限、`$/cancel` 都在 IPC 宿主（`00-plugin-kernel.md` §10〔一手〕），不必再写一遍；插件的定义是"带 liwa 字段的 npm 包"，语言是实现细节；`ability-embed-local` 退回 Python 时同包同 id，profile 不变 |
| 2 | 顶层 `services/<名字>/`，由一个进程内 TS 插件经 `procs.spawn` 拉起、用私有协议通信 | 不选 | 监管逻辑在每个包装插件里各写一份；"本地模型服务"有两个家 |

进 CI：`tools/ci.sh` 加 `python` 一步，对每个含 `pyproject.toml` 的工作区包跑 `uv run --directory <包> --frozen pytest -q`（本机已装 uv〔一手〕）；单元测试用假模型，不下载权重；拉起真模型的 IPC 一致性测试放 `pnpm test:contract`（手动）；Python 侧用 `packages/contracts/schemas/` 校验 IPC 消息，schema 只有 contracts 一份来源。Python 的 IPC 客户端放 `packages/plugin-sdk/python/`，和 TS 版同属"进程外插件开发包"这一个概念。

### (g) 包命名、exports、tsconfig、vitest

| 项 | 定 | 依据 |
| --- | --- | --- |
| 包名 | `@liwa/<目录名>`；组合根 `@liwa/app`；插件 `@liwa/plugin-<槽位简名>-<实现名>`，目录 `packages/plugins/<槽位简名>-<实现名>`，manifest `id` 同目录名；槽位简名：brain.provider→brain，其余取槽位名去点（memory-engine、growth-engine、social-model、social-pack、persona-template、job-trigger、ability-embed、ability-speech、ability-vision、ability-world、gate-policy、tool、form）；`check-layout.ts` 查三者一致 | `engineering.md` §4.2〔一手〕 |
| exports | 每个 TS 包 `"."`：`liwa-source` → `./src/index.ts`、`types` → `./dist/index.d.ts`、`default` → `./dist/index.js`，外加 `"./package.json"`；有界面的插件加 `"./client"`（`liwa-source` → `./client/index.ts`，默认 → `./dist/client/index.js`）；kernel 加 `"./testing"`（测试内核与假实现，只许测试、testkit、replay 用）；Python 插件只导出 `"./package.json"`；跨包允许的入口只由各包 `exports` 决定 | 现状〔一手〕；Koishi、Helm 的子路径导出〔一手〕 |
| tsconfig | `tsconfig.base.json`（本体侧，Node 类型）与 `tsconfig.web.json`（浏览器与同构，lib 加 DOM、jsx、types 为空）；各包 `tsconfig.json` 继承其一、`include: ["src", "test"]`；插件 `client/` 自带 tsconfig 继承 web；生产构建另设 `tsconfig.build.json`（去掉 `customConditions`） | 4.1 #12 |
| 类型检查 | 每个 TS 包 `scripts.typecheck`，根 `pnpm -r --if-present run typecheck` | 4.2 #19 |
| vitest | `vitest.config.ts` 经 `tools/workspace.cjs` 取工作区目录，有 `tsconfig.json` 才建项目，项目名 = 包名；浏览器代码另建 `<包名>:web`；`contract` 项目照旧手动 | 4.2 #18、#20 |
| 版本 | 所有包同一版本号随仓库升；`private: true`；`type: module`；engines 只在根 | `engineering.md` §4.2〔一手〕 |

## ⑥ `engineering.md` 要改的地方（建议文字，不直接改）

**§4.1 顶层**：`pnpm-workspace.yaml` 一行改为"工作区包位置的唯一来源；vitest、dependency-cruiser 经 `tools/workspace.cjs` 读它"；加一行 `tsconfig.web.json  浏览器与同构包的编译选项`；`profiles/` 一行改为"仓库层装配清单（只放 profile）"。

**§4.2 包**（整表替换）：

| 包 | 目录 | 职责 | 允许依赖 |
| --- | --- | --- | --- |
| `@liwa/app` | `apps/liwa` | 本体组合根与进程入口：自检、信号、启动失败计数、安全模式页、launchd、`LIWA_HOME` 初始化、日志与密钥注入；本机命令的编排与 `LOCAL_COMMANDS`；依赖全部插件包与 console | 全部 |
| `@liwa/desktop`（V1.1） | `apps/desktop` | Electron 薄壳：加载本体 URL、托盘、通知、自启、快捷键；preload 实现 HostBridge | contracts、client、electron |
| `@liwa/mobile`（V5） | `apps/mobile` | 原生手机端 | contracts、client |
| `@liwa/contracts` | `packages/contracts` | 协议规范；浏览器可用 | zod |
| `@liwa/kernel` | `packages/kernel` | 插件机制底座；`./testing` 子入口放测试内核 | contracts、cordis、yaml |
| `@liwa/core` | `packages/core` | 全部 required 插件，每模块一个目录一个 `defineService`；入口导出 `REQUIRED` 与离线操作；不带 `liwa` 字段 | contracts、kernel、`node:sqlite`、`node:worker_threads`、@node-rs/jieba |
| `@liwa/client` | `packages/client` | 客户端连接与服务端副本 store，同构 | contracts |
| `@liwa/cli` | `packages/cli` | `liwa` 命令行的唯一可执行入口：解析、渲染、退出码；本体命令经 client | 静态：contracts、client；本机与开发命令只许动态 import app、replay |
| `@liwa/console` | `packages/console` | 网页主控台 SPA（V2 起响应式），由 gateway 托管；内置区域与插件界面注册表 | contracts、client、ui-sdk、react |
| `@liwa/ui-sdk`（V1.1） | `packages/ui-sdk` | 界面插件开发包 | contracts、client、react |
| `@liwa/plugin-sdk`（kernel-1） | `packages/plugin-sdk` | 进程外插件的 IPC 客户端，TS 与 Python 各一份 | contracts |
| `@liwa/testkit` | `packages/testkit` | 假时钟、计数器随机、编号源、服务假实现、假出口、测试内核便利封装 | contracts、kernel |
| `@liwa/replay` | `packages/replay` | L0 / L1 / L2、A–G 指标、20 场景的唯一定义、探针 | contracts、kernel、core、app、testkit |
| `@liwa/brain-shared` | `packages/lib/brain-shared` | 三个大脑适配器共用的 Paseo 基础代码；库，不带 `liwa` 字段 | contracts、kernel |
| `@liwa/plugin-<槽位简名>-<实现名>` | `packages/plugins/<槽位简名>-<实现名>` | 槽位实现，一包一插件；运行位置由 manifest `runtime` 声明；有界面加 `client/` | 进程内：contracts、kernel、自己的第三方（大脑加 brain-shared）；子进程：contracts、plugin-sdk、自己的第三方；`client/`：contracts、client、ui-sdk、react |
| `@liwa/tools` | `tools` | 仓库工程工具 | contracts |

插件清单（截至 V2）：brain-claude、brain-codex、brain-acp、brain-replay、memory-engine-default、memory-engine-minimal（V1.1）、growth-engine-default、social-model-default、persona-template-default（data）、social-pack-default（data，V2）、job-trigger-time、ability-embed-local、ability-speech-local（V1.1）、ability-speech / vision / world 的线上实现（V1.1）、gate-policy-default（V2）、form-wechat（V2，子进程）。

**§4.3 包内布局**：core 一段改为 §2.2 的模块模板（含 `migrations/`、`worker.ts`），`db/` 写"openWriter / openReader、迁移执行器与 `schema_version(owner, version)`、worker 启动助手、备份与恢复"；`packages/core/test/` 写"core 内跨模块集成、真实 loader 装配、删表重建等价"；插件一段换成 §2.2 的插件模板与 Python 插件模板；`apps/liwa/src/` 一行换成 §2.1 的子目录。

**§4.4 tools**：整段替换为："`tools/` 只放仓库工程工具，不放产品命令：`ci.sh`（lint、typecheck、test、python、检查项）、`workspace.cjs`（工作区布局的唯一读取口）、`check-layout.ts`、`check-notices.ts`、`contracts-schemas.ts`（写出或核对 `packages/contracts/schemas/`）。本机运维（启停、自检、装配树、备份、恢复、迁移）只经 `liwa` 命令。"

**§4.5 docs**：不变。

**§4.6 依赖规则**：整表换成 §3.1 的"从 / 可以依赖"两列，加两句："core 内的层表同时约束 import（dependency-cruiser）与 required 之间的 `inject`（kernel 第 1 阶段），层表只有 contracts 的 `SERVICE_LAYERS` 一份"；"跨包只许引用对方 `exports` 声明的入口"。

**§4.7 模块落位**：context 行层写"运行"（与 §5 一致，`overall.md` §3.3 同步）；formhost 行位置写 `core/formhost`、版本 V2；"微信等形态适配器"行种类改为"builtin，`runtime: subprocess`"；"作业触发类型"行位置改 `plugins/job-trigger-time`；"主控台"行加"插件界面在各插件的 `client/`"；"终端客户端"行改为"命令行入口 ｜ `cli/` ｜ 客户端"；"Electron 薄壳"行位置改 `apps/desktop`、种类写"客户端"；"假实现与录放大脑"行拆成两行："假实现 ｜ `testkit/` ｜ 工具"与"录放大脑 ｜ `plugins/brain-replay` ｜ builtin ｜ 提供 `brain.provider`"；加一行"本地模型服务（如需）｜ `plugins/<槽位简名>-local` ｜ builtin，`runtime: subprocess`"。

**§4.8 Paseo 剥离**：`cron.ts` 一行落到 `plugins/job-trigger-time/src/paseo/`；`speech/` 一行落到 `plugins/ability-speech-local/src/paseo/`。

**§5 模块划界**：第二条末尾加"同层不成环按模块（目录）判断；层表同时约束 `inject`"；加一条"迁移 SQL 跟着表的所有者模块放在它的 `migrations/`"。

**§6 数据访问**：迁移一条改为"迁移：各模块 `migrations/` 下按序号的 SQL，`schema_version(owner, version)` 按所有者记版本，由各模块的 `recover` 在第 3 阶段调用 `db` 的执行器；开发期允许销毁重建……"（后半不变）。

**§8 工具链**：语言一行加"本体侧继承 `tsconfig.base.json`，浏览器与同构包继承 `tsconfig.web.json`"；测试一行加"测试项目由工作区目录生成，浏览器代码单独一个项目；Python 插件用 `uv run pytest`"；静态检查一行改为"eslint + dependency-cruiser + 逐包 `typecheck` 脚本"。

**§10 开发流程**：命令一条改为"`pnpm liwa <命令>`（开发期直跑 `packages/cli`）、`pnpm run ci`、`pnpm test:contract`、`pnpm contracts:export`；启停、装配树、备份、探针、回放都经 `liwa`"。

**§12 标准终端命令**：第一段"`packages/cli` 从……升格为正式的命令行入口 `liwa`"后加"可执行入口在 `packages/cli/bin/liwa.js`；本机命令的实现在 `apps/liwa`、数据操作在 core，cli 只在执行它们时动态加载"。

## ⑦ 要主人定的点

1. **`liwa` 的可执行入口放 `packages/cli`**，cli 静态只依赖 contracts 与 client，本机与开发命令动态加载 app 与 replay（方案 A）。另一种是放 `apps/liwa`，代价是 `liwa replay` 等开发命令要另起一个可执行文件。
2. **种类与运行位置分开**：微信适配器留在 `packages/plugins/form-wechat`，manifest 写 `runtime: subprocess`；要改 kernel 的种类推导与 manifest schema。另一种是给进程外插件单开目录，代价是换运行位置就要挪目录。
3. **Electron 壳与手机端放 `apps/`**（`apps/desktop`、`apps/mobile`），不放 `packages/desktop`。
4. **新增三个包**：`@liwa/client`（m0 就要，cli 用）、`@liwa/ui-sdk`（V1.1）、`@liwa/plugin-sdk` 带 Python 版（第一个进程外插件出现时）。
5. **录放大脑单独成插件** `plugins/brain-replay`，testkit 只留假实现。
6. **迁移 SQL 按模块放**，不集中在 `db/migrations/`。
7. **本地模型的 Python 服务作为插件包**放 `packages/plugins/`，不设顶层 `services/`；CI 加 `uv run pytest`。
8. **`job-triggers` 改名 `job-trigger-time`**；人设样板进 `plugins/persona-template-default`，不进 `profiles/`。

## ⑧ 交给别的方向

**K（kernel）**

- 种类与运行位置拆开：`deriveKind` 只管来源；manifest 加 `runtime`（`00-plugin-kernel.md` §3.1"`process` 由种类推导"要改）；子进程插件不 `import()`，交 IPC 宿主；校验其槽位 `transport: 'any'`、`consumes` ⊆ `PLUGIN_VIEWS`、`resources` 与启动命令齐全。
- 第 1 阶段对 required 的 `inject` 按层表做向下检查（层表从 contracts 的 `SERVICE_LAYERS` 读）。这是 core 层规则真正的执行点，dependency-cruiser 看不见注入。
- 组合根传 core 的 `REQUIRED` 全集，kernel 按 profile 的阶段集合决定挂哪些（否则 V1 时代的 m0 profile 会因为 memory 在装而要求 `memory.engine`）。
- 主入口只留 §11 的公开 API；测试内核、`fakeClock`、`memoryResolver` 移到 `./testing` 子入口；`SlotRegistry`、`buildServiceGraph`、`deriveKind`、`checkManifest`、`resolveProfile` 不出包。
- "向上传信息走进程内信号"在 kernel API 里没有落点（例如 notify 要 gateway 的客户端在线状态），要定一个机制。
- "登记回调必须包进 `ctx.effect`"建议做成 API 形状保证，不靠 lint。
- `loader.ts` 605 行，超过 §9 的 400 行上限。

**C（contracts）**

- `liwa.plugins[]` 与 `SubPlugin.service` 没有使用方，又和"一包一插件"冲突，建议删除。
- `REQUIRED_PLUGIN_IDS` 在 `00-contracts.md` §1 列着，代码里没有；required 清单归 core 的 `REQUIRED`，建议从文档删去。
- `STAGE_SETS.v1 = SERVICE_KEYS` 含 V2 才有的 formhost。
- `provides` 一个槽位只能写一个 impl：`job.trigger` 按"impl `time`、`meta.kinds` 列 cron / once / interval"写。
- manifest 不加 `client` 字段，"有界面"由 `exports["./client"]` 判断。
- 新增 `protocol/host.ts`（HostBridge）、`SERVICE_LAYERS`（层表，JSON 形式，供 kernel 与 dependency-cruiser 共用）、manifest 的 `runtime` 与子进程启动命令（含 Python）。
- contracts 改用 `tsconfig.web.json`（不带 Node 类型）；JSON Schema 导出放 `packages/contracts/schemas/`。

**M（命令）**

- (a) 选 A：`packages/cli` 是 bin；`cli → app / replay` 只许 `dynamic-import`，由 dependency-cruiser 按依赖类型检查。
- 本机命令的编排与 `LOCAL_COMMANDS` 在 `apps/liwa/src/commands/`；backup、restore、migrate、selfCheck 的实现由 `@liwa/core` 公开入口导出。
- `liwa contracts export` 与 `pnpm contracts:export` 是同一件事，留一个（建议只留 tools 的，属于仓库工程）。
- 根脚本只留工程命令与 `pnpm liwa` 别名；`tools/dump-config.ts`、`tools/placeholder.ts` 在 bin 落地时删除。
- 插件贡献的命令只能是声明式描述，cli 不加载插件代码（与 `00-commands.md` §4.1 ① 一致）；`liwa acp serve` 放 `packages/cli/src/acp/`。

**主对话（转给对应模块的设计）**

- `overall.md` §3.3 的 context 行写的是编排层，应为运行层（决策 31）。
- `overall.md` §3.3 写 senses"订阅 gateway"，gateway 在上层：应改为 gateway 向下调 senses（07）。
- `00-plugin-kernel.md` §4.1"brains 在运行时解析"roster 的大脑配置：brains 在资源层、roster 在账本层，按层表应由 minds 解析后传给 brains（01、02）。
- `engineering.md` §6"openWriter 只给 journal 和投影运行器"与 procs 登记表、`mind_session` 这类模块操作表谁来写，要在 03 定。
- `02-minds.md` 草稿的人设样板 `profiles/persona.example.md`，按本稿改到 `plugins/persona-template-default`。
- `roadmap.md` 1.3"在仓库建 `probe/`"改为 `packages/replay/src/probe/`。

## ⑨ 跑过的命令与输出原文

环境：MacBook，`node -v` → `v24.18.0`（`/usr/local/bin/node`），pnpm、uv 在 `/opt/homebrew/bin`；fnm 未装。

**1. 基线**

```
$ pnpm run lint
$ eslint . && depcruise apps packages tools --config .dependency-cruiser.cjs

✔ no dependency violations found (88 modules, 189 dependencies cruised)
```

**2. 建临时违规文件**（全部以 `verify-tmp-` 开头；core 下 11 个不存在的模块目录为此临时建立，清单记在会话草稿目录）。每个文件验证什么：

| 编号 | 文件 | 验证 |
| --- | --- | --- |
| V1 | `core/src/journal/verify-tmp-layer.ts` → `../gateway/verify-tmp-gw.js` | 基础层向上依赖接入层 |
| V2 | `core/src/senses/verify-tmp-cyc-a.ts` ↔ `core/src/attention/verify-tmp-cyc-b.ts` | 同层文件级成环 |
| V3 | `will/verify-tmp-w1 → tasks/verify-tmp-t1`，`tasks/verify-tmp-t2 → will/verify-tmp-w2` | 同层模块级成环、文件不成环 |
| V4 | `core/src/verify-tmp-mod/verify-tmp-x.ts`（import contracts） | 层表外的模块目录 |
| V5 | `core/src/verify-tmp-root.ts` → `./gateway/verify-tmp-gw.js` | core 根文件深引用 |
| V6 | `core/src/ledgers/memory/verify-tmp-l.ts` → `../../minds/verify-tmp-m.js` | 账本层向上依赖运行层 |
| V7 | `core/src/brains/verify-tmp-r.ts` → `../ledgers/roster/verify-tmp-ro.js` | 资源层向上读账本层 |
| V8 | `core/src/minds/verify-tmp-timer.ts`：第 5 行 setTimeout、6 globalThis.setInterval、3 从 node:timers/promises 导入、8 Date.now、9 new Date()、10 Math.random、11 performance.now、12 crypto.randomUUID、13 randomBytes、14 process.hrtime.bigint、15 process.on、16 fs.watch、17 any、20 export default | ESLint 时钟、随机、定时器、默认导出、any 及缺口 |
| V9 | `core/src/procs/verify-tmp-procs-timer.ts`：setTimeout | procs 允许真定时器 |
| V10 | `core/src/minds/verify-tmp-tk.ts` → `@liwa/testkit` | 产品代码用 testkit |
| V11 | `plugins/brain-claude/src/verify-tmp-cp.ts`：`node:child_process`、`child_process`、动态 import、createRequire | 插件禁 child_process |
| V12 | `plugins/brain-claude/src/verify-tmp-core.ts`：纯类型相对引用 core + `@liwa/core` | 插件依赖 core |
| V13 | `plugins/brain-claude/src/verify-tmp-deep.ts`：`@liwa/kernel/src/manifest.js` + `../../../kernel/src/loader.js` | 跨包深引用 |
| V14 | `plugins/memory-engine-default/src/verify-tmp-bs.ts` → brain-shared | 非大脑插件用 brain-shared |
| V15 | `plugins/memory-engine-default/src/__tests__/verify-tmp-core.test.ts` → core | 插件测试依赖 core |
| V16 | `cli/src/verify-tmp-kernel.ts` → kernel；`console/src/verify-tmp-core.ts` → core；`cli/src/verify-tmp-cli-timer.ts` setTimeout | 客户端依赖与定时器 |
| V17 | `contracts/src/verify-tmp-fs.ts` → `node:fs` | contracts 用 Node 内置 |
| V18 | `kernel/src/verify-tmp-k.ts` → core | kernel 依赖 core |
| V19 | `plugins/brain-codex/src/verify-tmp-peer.ts` → brain-claude | 插件互引 |

**3. 第一轮 `pnpm run lint`**（ESLint 先失败，dependency-cruiser 未执行）

```
$ eslint . && depcruise apps packages tools --config .dependency-cruiser.cjs

packages/cli/src/verify-tmp-cli-timer.ts
  2:3  error  Unexpected use of 'setTimeout'. 不许直接用 setTimeout：经 kernel 注入的可控定时器；只有 packages/kernel 与 packages/core/src/procs 可以直接用  no-restricted-globals

packages/core/src/minds/verify-tmp-timer.ts
   3:10  error  不许从 timers 模块导入定时器：经 kernel 注入的可控定时器；只有 packages/kernel 与 packages/core/src/procs 可以直接用                                                         no-restricted-syntax
   5:3   error  Unexpected use of 'setTimeout'. 不许直接用 setTimeout：经 kernel 注入的可控定时器；只有 packages/kernel 与 packages/core/src/procs 可以直接用                           no-restricted-globals
   6:3   error  'globalThis.setInterval' is restricted from being used. 不许直接用 setInterval：经 kernel 注入的可控定时器；只有 packages/kernel 与 packages/core/src/procs 可以直接用  no-restricted-properties
   8:16  error  'Date.now' is restricted from being used. 不许直接读系统时钟：经 kernel 注入的 Clock / Rng / Ids 取用（docs/engineering.md §5，L0 可回放的前提）                         no-restricted-properties
   9:15  error  不许用无参 new Date() 读系统时钟：经 kernel 注入的 Clock / Rng / Ids 取用（docs/engineering.md §5，L0 可回放的前提）                                                      no-restricted-syntax
  10:16  error  'Math.random' is restricted from being used. 不许直接用系统随机：经 kernel 注入的 Clock / Rng / Ids 取用（docs/engineering.md §5，L0 可回放的前提）                      no-restricted-properties
  11:16  error  'performance.now' is restricted from being used. 不许直接读单调钟：经 kernel 注入的 Clock / Rng / Ids 取用（docs/engineering.md §5，L0 可回放的前提）                   no-restricted-properties
  12:16  error  'randomUUID' is restricted from being used. 不许自己生成编号：经 kernel 注入的 Clock / Rng / Ids 取用（docs/engineering.md §5，L0 可回放的前提）                        no-restricted-properties
  17:16  error  不用 any：用 unknown 再收窄，或写出具体类型（docs/engineering.md §9）                                                                                            no-restricted-syntax
  20:1   error  不用默认导出，一律具名导出（插件入口也是 export const plugin，docs/engineering.md §9）                                                                                no-restricted-syntax

packages/plugins/brain-claude/src/verify-tmp-deep.ts
  1:1  error  跨包只能引用 @liwa/* 的公开入口，不许深引用包内文件（docs/engineering.md §5）  no-restricted-syntax

✖ 12 problems (12 errors, 0 warnings)

[ELIFECYCLE] Command failed with exit code 1.
```

读法：V8 第 13–16 行（randomBytes、process.hrtime、process.on、fs.watch）没有报错；V9（procs 的 setTimeout）没有报错，符合白名单；V16 cli 的 setTimeout 被拦。

**4. 第二轮 `pnpm run lint`**（删掉只验 ESLint 的 V8 与 V16 定时器文件；V13 第一行加 `eslint-disable-next-line` 以便让 dependency-cruiser 执行）

```
$ eslint . && depcruise apps packages tools --config .dependency-cruiser.cjs

  error testkit-only-in-tests: packages/core/src/minds/verify-tmp-tk.ts → packages/testkit/src/index.ts
  error plugins-workspace-deps: packages/plugins/brain-codex/src/verify-tmp-peer.ts → packages/plugins/brain-claude/src/index.ts
  error plugins-workspace-deps: packages/plugins/brain-claude/src/verify-tmp-core.ts → packages/core/src/index.ts
  error plugins-not-to-core: packages/plugins/memory-engine-default/src/__tests__/verify-tmp-core.test.ts → packages/core/src/index.ts
  error plugins-not-to-core: packages/plugins/brain-claude/src/verify-tmp-core.ts → packages/core/src/index.ts
  error plugins-not-to-core: packages/plugins/brain-claude/src/verify-tmp-core.ts → @liwa/core
  error plugins-no-child-process: packages/plugins/brain-claude/src/verify-tmp-cp.ts → child_process
  error only-public-entry-across-packages: packages/plugins/brain-claude/src/verify-tmp-deep.ts → packages/kernel/src/loader.ts
  error not-to-unresolvable: packages/plugins/brain-claude/src/verify-tmp-deep.ts → @liwa/kernel/src/manifest.js
  error not-to-unresolvable: packages/plugins/brain-claude/src/verify-tmp-core.ts → @liwa/core
  error no-circular: packages/core/src/attention/verify-tmp-cyc-b.ts → 
      packages/core/src/senses/verify-tmp-cyc-a.ts →
      packages/core/src/attention/verify-tmp-cyc-b.ts
  error kernel-allowed-deps: packages/kernel/src/verify-tmp-k.ts → packages/core/src/index.ts
  error core-module-only-via-index: packages/core/src/will/verify-tmp-w1.ts → packages/core/src/tasks/verify-tmp-t1.ts
  error core-module-only-via-index: packages/core/src/tasks/verify-tmp-t2.ts → packages/core/src/will/verify-tmp-w2.ts
  error core-module-only-via-index: packages/core/src/senses/verify-tmp-cyc-a.ts → packages/core/src/attention/verify-tmp-cyc-b.ts
  error core-module-only-via-index: packages/core/src/ledgers/memory/verify-tmp-l.ts → packages/core/src/minds/verify-tmp-m.ts
  error core-module-only-via-index: packages/core/src/journal/verify-tmp-layer.ts → packages/core/src/gateway/verify-tmp-gw.ts
  error core-module-only-via-index: packages/core/src/brains/verify-tmp-r.ts → packages/core/src/ledgers/roster/verify-tmp-ro.ts
  error core-module-only-via-index: packages/core/src/attention/verify-tmp-cyc-b.ts → packages/core/src/senses/verify-tmp-cyc-a.ts
  error core-module-in-layer-table: packages/core/src/verify-tmp-mod/verify-tmp-x.ts → packages/contracts/src/index.ts
  error core-layer-resources-not-upward: packages/core/src/brains/verify-tmp-r.ts → packages/core/src/ledgers/roster/verify-tmp-ro.ts
  error core-layer-ledgers-not-upward: packages/core/src/ledgers/memory/verify-tmp-l.ts → packages/core/src/minds/verify-tmp-m.ts
  error core-layer-foundation-not-upward: packages/core/src/journal/verify-tmp-layer.ts → packages/core/src/gateway/verify-tmp-gw.ts
  error core-allowed-deps: packages/core/src/minds/verify-tmp-tk.ts → packages/testkit/src/index.ts
  error contracts-no-node-builtins: packages/contracts/src/verify-tmp-fs.ts → fs
  error console-allowed-deps: packages/console/src/verify-tmp-core.ts → packages/core/src/index.ts
  error clients-only-contracts: packages/console/src/verify-tmp-core.ts → packages/core/src/index.ts
  error clients-only-contracts: packages/cli/src/verify-tmp-kernel.ts → packages/kernel/src/index.ts
  error cli-allowed-deps: packages/cli/src/verify-tmp-kernel.ts → packages/kernel/src/index.ts
  error brain-shared-only-for-brains: packages/plugins/memory-engine-default/src/verify-tmp-bs.ts → packages/lib/brain-shared/src/index.ts

x 30 dependency violations (30 errors, 0 warnings). 120 modules, 232 dependencies cruised.

[ELIFECYCLE] Command failed with exit code 30.
```

读法：V3 只有"只经 index"报错，**没有 `no-circular`**（模块级成环漏网）；V5（core 根文件深引用）**没有任何报错**；V11 的四种写法合并成一条 `→ child_process`，要分开看见第三轮；V12 纯类型引用也被拦（`tsPreCompilationDeps: true`）。

**5. 第三轮 `pnpm run lint`**（把 V11 拆成只有动态 import 的 `verify-tmp-cp-dyn.ts` 与只有 `createRequire` 的 `verify-tmp-cp-req.ts`）

```
$ pnpm run lint > …/verify-tmp-lint-pass3.txt 2>&1; echo "exit=$?"; grep -n "child_process\|violations" …/verify-tmp-lint-pass3.txt
exit=30
9:  error plugins-no-child-process: packages/plugins/brain-claude/src/verify-tmp-cp-dyn.ts → child_process
36:x 30 dependency violations (30 errors, 0 warnings). 118 modules, 212 dependencies cruised.
```

读法：动态 `import('node:child_process')` 被拦；`createRequire(import.meta.url)('node:child_process')` 没有被拦。

**6. 删除临时文件与目录，复核**

```
$ find apps packages tools -name 'verify-tmp-*' -not -path '*/node_modules/*' -print -exec rm -rf {} +
packages/core/src/verify-tmp-root.ts
packages/core/src/verify-tmp-mod
packages/contracts/src/verify-tmp-fs.ts
packages/cli/src/verify-tmp-kernel.ts
packages/kernel/src/verify-tmp-k.ts
packages/console/src/verify-tmp-core.ts
packages/core/src/journal/verify-tmp-layer.ts
packages/core/src/brains/verify-tmp-r.ts
packages/core/src/attention/verify-tmp-cyc-b.ts
packages/core/src/minds/verify-tmp-m.ts
packages/core/src/minds/verify-tmp-tk.ts
packages/core/src/tasks/verify-tmp-t1.ts
packages/core/src/tasks/verify-tmp-t2.ts
packages/core/src/procs/verify-tmp-procs-timer.ts
packages/core/src/will/verify-tmp-w1.ts
packages/core/src/will/verify-tmp-w2.ts
packages/core/src/verify-tmp-mod/verify-tmp-x.ts
packages/core/src/senses/verify-tmp-cyc-a.ts
packages/core/src/gateway/verify-tmp-gw.ts
packages/core/src/ledgers/memory/verify-tmp-l.ts
packages/core/src/ledgers/roster/verify-tmp-ro.ts
packages/plugins/brain-claude/src/verify-tmp-core.ts
packages/plugins/brain-claude/src/verify-tmp-cp-req.ts
packages/plugins/brain-claude/src/verify-tmp-deep.ts
packages/plugins/brain-claude/src/verify-tmp-cp-dyn.ts
packages/plugins/memory-engine-default/src/verify-tmp-bs.ts
packages/plugins/brain-codex/src/verify-tmp-peer.ts
packages/plugins/memory-engine-default/src/__tests__/verify-tmp-core.test.ts
rmdir packages/core/src/ledgers/memory
rmdir packages/core/src/ledgers/roster
rmdir packages/core/src/procs
rmdir packages/core/src/brains
rmdir packages/core/src/minds
rmdir packages/core/src/ledgers
rmdir packages/core/src/tasks
rmdir packages/core/src/will
rmdir packages/core/src/attention
rmdir packages/core/src/senses
rmdir packages/core/src/gateway
rmdir packages/core/src/journal
$ find apps packages tools -name 'verify-tmp-*' -not -path '*/node_modules/*'
（无输出）
$ ls packages/core/src
__tests__
index.ts
$ pnpm run lint
✔ no dependency violations found (88 modules, 189 dependencies cruised)
$ git status --short
?? docs/architecture/modules/00-commands.md
```

（`00-commands.md` 是方向 M 的产出，不是本稿建的。）

**7. 只读查阅**

- `grep` kernel 与 contracts 源码：`liwa.plugins[]`、`SubPlugin`、`REQUIRED_PLUGIN_IDS` 的使用方——前两者在 kernel 里无引用，后者代码里不存在；`graph.ts` 无层相关逻辑。
- dependency-cruiser 18.7.0 的 `src/schema/configuration.validate.mjs`：规则的 `scope` 枚举 `["module","folder"]`，依赖类型含 `"dynamic-import"`。
- Helm main `1fa999a`（2026-10-29，`packages/server` 0.14.0）：11 个包与旧分支相同；`@getpaseo/cli` 依赖 client、protocol、server，`bin: paseo`；cli 源码引用 `@getpaseo/server/daemon-control` 13 处、`/configuration` 5 处、`/process` 2 处、`/auth` 2 处等；`@getpaseo/plugin` 导出 `./server*` 与 `./client*` 子路径；`plugin-examples/settings` 含 `index.server.ts`、`index.client.tsx`、`client/`、`shared/`。
- Koishi `koishijs/webui` 的 `plugins/insight`（GitHub contents API）：目录 `client/`、`src/`、`package.json`、`tsconfig.json`；`package.json` 的 `files: ['lib', 'dist', 'src']`、`koishi.public: ['dist']`、`koishi.service.required: ['console']`。
