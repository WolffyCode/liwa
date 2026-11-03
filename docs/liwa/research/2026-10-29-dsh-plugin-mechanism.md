# 调研：DSH 插件机制能力清单（一手，读源码）

日期：2026-10-29。对象：DeepSeek Harness（DSH，MIT），浅克隆，提交 `f3803c96`（2026-10-28，`0.2.2-alpha.2`）。

目的：灵鲸的插件机制做完后，要向主人说明"我们和 DSH 的万物插件化对等到什么程度"。之前的对照（`../architecture/modules/00-plugin-kernel.md` §16、`2026-10-28-plugin-architecture.md` §2.1）主要靠 README 和文档；这一份以**代码**为准，按 17 个维度列出 DSH 有什么、怎么实现、证据在哪。

标注：

- 〔一手〕读到代码或文档原文，证据写成"相对 DSH 仓库根的路径:行号"；
- 〔二手〕转述别人的说法；
- 〔推理〕我的判断；
- 〔未核实〕读不到，不下结论；
- 〔初判〕粗看灵鲸当前设计在这一维的位置。设计文档正在被另一个 agent 更新，〔初判〕只是参考，以最新文档为准。

每个维度的表格末列"灵鲸对应（待填）"留空，等我们的实现做完再填。

---

## ① 一页结论

**DSH 插件化的本质。** DSH 的插件化有四层，没有一个统一的"槽位"概念。

1. **运行时是 cordis。** 插件按服务键向共享上下文提供服务，用 `inject` 声明依赖，注册都是可撤销的 effect。`vendor/cordis/src/registry.ts:98-110`、`vendor/cordis/src/reflect.ts:277-305`〔一手〕。
2. **装配是一张按 id 叠 patch 的扁平条目表。** 每行就是 `id / name / config / disabled / group / inject / intercept / isolate`，由 Loader 和 Include 装载。`vendor/loader/src/config/entry.ts:10-23`、`vendor/include/src/index.ts:43-141`〔一手〕。
3. **分发是"组合包 + profile"。** 组合包是一个 npm 包，带一份 patch 文件；profile 是有序的组合包列表，加上自己的 patch。`packages/boot/app-boot/src/profile.ts:1-21`〔一手〕。
4. **"可替换"靠约定，不靠机制。** seam 分三种角色（Definition、Provider、Consumer），见 `docs/architecture.zh.md:138-142`〔一手〕。两种做法：
   - 同一服务键在同一 realm 里只能有一个提供方，见 `vendor/cordis/src/reflect.ts:289-291`〔一手〕；要换实现，就禁用旧行、插入新行。
   - 多个实现并存，就做成"注册表服务"：每个 seam 自己写 `registerX()`，自己定选择规则，见 `packages/web/web/src/index.ts:64-75`、`packages/llm/llm/src/index.ts:395-450`〔一手〕。

这四层之外是一大批 CI 校验脚本，用来守住约定（`scripts/verify-*.ts`）〔一手〕。DSH 说"不存在需要打补丁的特权内核"（`docs/architecture.zh.md:11`）〔一手〕。它事实上的内核是：cordis 加 Loader、Include，`app-boot` 启动器，再加一张 10 个条目 id 的 required 名单（`packages/boot/app-boot/src/index.ts:942-960`）〔一手〕。

**最强的三点**

1. **真的万物都是插件。** 回合循环、工具注册表、会话日志、插件管理器、HMR、Web 服务器全是装载行。服务目录登记了 107 个宿主侧服务键：60 个核心服务、36 个 seam、10 个独立服务、1 个组合包。改组合只要写 patch，`--dump-config` 打出的每一行都能被替换。来源：`scripts/gen-doc-graphs.ts:109-969` 及其完整性守卫 `:1018-1029`、`packages/bundle/base/cordis.patch.yml`（97 个装载行）〔一手〕。
2. **组合工具链完整，导入代码前就把关。**
   - 叠层固定：组合包 → profile patch → home patch → `--patch` → 遥测开关。见 `packages/boot/app-boot/src/profile-context.ts:74-85`。
   - 导入前比对 `engines.dsh` 版本，可以给精确版本写豁免。见 `packages/boot/app-boot/src/compatibility-preflight.ts:63-118`、`plugin-compatibility.ts:76-117`、`index.ts:770-772`。
   - `--dump-config` 给每段注明来自哪个文件、被哪些层改过。见 `index.ts:601-727`。
   - 插件管理器走 pnpm 安装，安装脚本要人批准，模型也能调用它。
   - 插件市场。
   - HMR 能在运行中重新组合。
   - agent preset 让每个会话用不同的插件子树。

   以上均〔一手〕。
3. **扩展点类型化，可审计。**
   - 工具执行有瀑布，后面跟单调守卫：守卫只能拒绝，不能翻成允许（`packages/core/tools/src/pipeline.ts:184-235`、`index.ts:380-401`）。
   - 提示词是段落注册表（`packages/core/system-prompt/src/index.ts:52-75`）。
   - 会话投影是纯同步折叠（`packages/session/session-projection/src/index.ts:1-17`）。
   - 界面插件用四种基数的类型化 slot（`packages/client/ui-slots/src/index.ts:100-104`）。
   - 测试规则写死"必须走真实 Loader"（`docs/testing.zh.md:37-41`）。

   以上均〔一手〕。

**最弱的三点**

1. **没有任何隔离，也没有熔断。** 所有插件都在一个进程里。进程里任何时候出现未处理的异常，整个进程都会 `exit(1)`（`packages/boot/app-boot/src/index.ts:842-931`）。启动和 `apply` 都没有超时（这几个文件里只有 2 秒的终端释放时限，`index.ts:840`）。没有连续崩溃计数，也没有自动安全模式；桌面版只有一个手动的"禁用全部插件后重启"（`apps/desktop/src/main.ts:104-108`）。动态插件的 `node:vm` 明说"不是安全边界"（`packages/extensions/cordis-host-runner/README.zh.md:62`）。以上均〔一手〕。
2. **契约没有版本，也没有静态描述。**
   - manifest 只有 `dsh.bundle / profile / client` 和 `engines`（`packages/util/package-manifest/src/types.ts:7-100`）。`manifestVersion` 只在类型里出现，没有任何代码读它〔一手，全仓 grep〕。
   - 服务依赖图在导入代码之后才知道，因为 `inject` 是模块导出（`vendor/loader/src/index.ts:201-208`）。
   - 服务没有 API 版本号，"Public APIs are pre-stable; update every consumer"（`AGENTS.md:7`）；10 个预发布版本累计写了 81 份升级指南。
   - 每个 seam 自己定选择规则，没有统一的基数与回退。

   以上均〔一手〕。
3. **底座和实现都在漂移，可选依赖的坑多。**
   - DSH 自带的 cordis 是 `4.0.0-rc.7`，Loader 是 `1.0.0-rc.5`，带 24 处本地修改（`vendor/README.md:19-20,35-65`），升级计划还在 rc.11（`vendor/cordis-rc11-upgrade-plan.md`）。
   - patch 只有"整行替换 config / 禁用 / 插入"三种，没有 `remove`，没有 `extends`，也不深合并（`vendor/include/src/index.ts:76-122`）。
   - 可选服务必须用 `ctx.get()` 读，否则跨 fiber 读不到（复盘 0001）；`!!js` 写错位置会静默失效（复盘 0002）。
   - README 与代码不一致（见维度 10）。

   以上均〔一手〕。

**这次读码对旧对照的更正**（都在下文对应维度里给了证据）：

- `00-plugin-kernel.md` §16 写的"约 8 个 seam"应为 36 个，宿主侧服务一共 107 个（`plugin-architecture.md` §2.1 的计数本来是对的）。
- DSH 的底不是 rc.12，是打了 24 处补丁的 rc.7。DSH 的 volatile 配置、`disabled` 表达式、惰性配置求值、生命周期加固都是 DSH 本地补丁，我们钉的上游 rc.12 不一定有〔待实测〕。
- `single` slot 是 `priority` **最小**的那个渲染；同一 priority 第二次登记直接报错。
- `engines.dsh` 确实在导入前强制检查（旧调研标的〔未核实〕现在可以去掉）。说"不强制"的是 `package-manifest` 的 README，它过时了。
- patch 里的 `name` 是断言，不是替换：name 对不上就跳过并警告。
- DSH 没有通用的进程外插件宿主。
- 带浏览器端的包是 88 个，不是"72 个 ui-*"。

---

## ② 来源清单（实际读过的文件，路径相对 DSH 仓库根）

| 方向 | 文件（读法） |
| --- | --- |
| 启动与组合 | `packages/boot/app-boot/src/index.ts`（全文）、`profile.ts`（头部、`loadProfileDirectory`、`loadProfile`、`composeEntries`）、`profile-context.ts`（全文）、`plugin-compatibility.ts`（全文）、`compatibility-preflight.ts`（全文）、`startup-diagnostics.ts`（全文）、`package-meta.ts`（前 60 行）、`profile-sanitize.ts`（全文）、`config-schema/index.ts`、`config-schema/collect.ts`（前 60 行）、`config-schema/native.ts`；`packages/boot/app-boot/README.zh.md`（前段） |
| manifest | `packages/util/package-manifest/src/types.ts`（全文）、`README.zh.md`（字段表与限制） |
| 官方组合 | `packages/util/official-bundles/src/bundles.ts`、`plugin-manager.ts`；`packages/bundle/*/package.json` 的 `dsh` 字段；`packages/bundle/base/cordis.patch.yml`（前 140 行、`agent-loop` 行）；`packages/bundle/web-app/presets/ptc.patch.yml`（前 60 行） |
| 插件管理与市场 | `packages/boot/plugin-manager/src/index.ts`（头部、方法清单、安装段）、`types.ts`（前 120 行）、`patch.ts`（全文）、`build-approval.ts`（前 40 行）、`install-spec.ts`（前 40 行）、`tools.ts`（前 130 行）、`README.zh.md`（第 31 行）；`packages/boot/plugin-market/src/index-url.ts`、`README.zh.md`（限制段）；`packages/util/plugin-market-index/src/types.ts`（字段） |
| HMR | `packages/boot/hmr/src/index.ts`（前 80 行）、`README.zh.md`（全文）；`packages/client/hmr/README.zh.md`（概述） |
| 命令行 | `apps/cli/src/args.ts`（前 150 行）、`profile-boot.ts`（第 205-353 行）、`process-shutdown.ts`（全文）；`packages/boot/cmdline/src/index.ts`（前 120 行） |
| vendor/cordis | `vendor/README.md`（全文）、`vendor/cordis-rc11-upgrade-plan.md`（前 60 行）；`vendor/cordis/src/fiber.ts`（状态、`_refresh`、`_reload`、`_unload`）、`registry.ts`（`Inject`、`Plugin`）、`reflect.ts`（`get`、`provide`）、`events.ts`（分发方式、`emit`）、`logger.ts`（全文）、`service.ts`（头部）；`vendor/loader/src/config/entry.ts`（`EntryOptions`、volatile）、`config/isolate.ts`（前 60 行）、`index.ts`（`unwrapExports`）；`vendor/include/src/index.ts`（`applyEntryPatches`、`PatchOptions`）；`vendor/timer/src/index.ts`（方法名） |
| 服务与 seam | `scripts/gen-doc-graphs.ts`（`SERVICE_ROLES` 全部 107 项，用脚本抽出；完整性守卫）；`docs/capability-seams.zh.md`（中文说明列）；`packages/shell/shell/src/index.ts`、`bash-local/src/index.ts`、`bash-sandbox/src/index.ts`（类声明）；`packages/web/web/src/index.ts`（前 130 行）；`packages/llm/llm/src/index.ts`（`registerAdapter`）；`packages/subagent/subagent/src/index.ts`（`registerProvider`）；`packages/skill/skill/src/index.ts`（`registerProvider`）；`packages/credentials/credentials/src/index.ts`（头部）；`packages/sandbox/sandbox-local/src/index.ts`（头部）；36 个 seam Definition 的 `abstract class` 与 `register*` 写法（grep） |
| 按会话组合 | `packages/core/scope/src/index.ts`（前 80 行）；`packages/preset/agent-preset-registry/src/index.ts`（前 60 行）、`mount.ts`（前 80 行）、`README.zh.md`（第 1-60 行） |
| 工具守卫 | `packages/core/tools/src/index.ts`（守卫段）、`pipeline.ts`（前 300 行、post-execute 段）、`contracts.ts`（决策类型）、`events.ts`（事件签名） |
| 提示词 | `packages/core/system-prompt/src/index.ts`（前 300 行） |
| 会话投影 | `packages/session/session-projection/src/index.ts`（前 120 行） |
| 界面 | `packages/client/ui-slots/src/index.ts`（类型段、`register` 段）；`packages/client/modules/src/index.ts`（头部）、`src/client/index.ts`（全文）；`packages/client/ui-sidebar-right/src/client/index.ts`（第 200-235 行）；`packages/client/ui-commands/src/client/contract.ts`（前 60 行）、`README.zh.md`（第 12、32 行）；`packages/client/shortcuts/src/index.ts`、`README.zh.md`（第 32 行）；`docs/subsystems/client-modules.zh.md`（前 60 行） |
| 命令 | `packages/interaction/commands/src/index.ts`（前 140 行、`register`、`list`） |
| 进程外与扩展 | `packages/extensions/README.zh.md`；`packages/extensions/cordis-host-runner/README.zh.md`（全文）；`packages/extensions/tool-cordis/src/index.ts`（工具名）；`packages/ptc-runtime/ptc-runtime-node/src/worker.ts`（spawn）；`packages/experimental/{hook-protocol,hooks-claude-code,webworker-runtime,claude-code-mods}/README.zh.md`（description）；`packages/{typert,api,sdk}/*/README.zh.md`（description） |
| 配置与密钥 | `packages/settings/settings/src/index.ts`、`redact.ts`（头部）；`packages/boot/config-editor/src/index.ts`（头部） |
| 测试 | `packages/test-support/*/README.zh.md`（description）、`loader-smoke/src/index.ts`（头部）；`docs/testing.zh.md`（第 37-41 行） |
| 可观测 | `packages/host/plugin-inventory/src/types.ts`（第 17-60 行） |
| 安全与信任 | `SAFETY.zh.md`（全文） |
| 桌面恢复 | `apps/desktop/src/fatal-recovery.ts`（前 120 行）、`main.ts`（第 95-130 行）、`project-manager.ts`（`disableAllPlugins`） |
| 规则与架构 | `AGENTS.md`（兼容条款）、`packages/AGENTS.md`（第 6 行）、`docs/architecture.zh.md`（Cordis、Profile、核心包、事件、轮次、会话日志、seam、归属表）、`scripts/verify-cordis-config.ts`（头部）、`scripts/verify-default-product-isolation.ts`（头部）、`scripts/cordis-walk.ts`（头部） |
| 复盘 | `docs/postmortem/README.zh.md`、`0001`、`0002` 全文；`0003`、`0004` 摘要与教训 |
| 计数 | 用脚本统计：`packages/*/*/package.json` 369 个、其中 `dsh.client` 88 个、`dsh.bundle` 24 个；各组合包的行数；`docs/upgrade-guide` 下 81 份 `guide.md` |

没读的：`apps/desktop` 主体、`packages/client/web` 外壳、`typert` 生成器的实现、`agent-loop` 实现正文、`session` 迁移链实现、`docs/cordis-tutorial`。

---

## ③ 17 个维度的能力清单

### 1 插件单元与 manifest

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 两层单元 | **代码单元**是 npm 包。**装配单元**是 Loader 的一行：`id`、`name`（模块说明符）、`config`、`group`、`disabled`、`inject`，另加 `intercept`、`isolate`。同一个包可以装成多行〔一手〕 | `vendor/loader/src/config/entry.ts:10-23`、`vendor/loader/src/config/isolate.ts:5-9` | |
| 插件模块的形状 | 命名空间插件导出 `name`、`inject`、`Config`（Standard Schema，DSH 用 schemastery）、`apply(ctx, config)`；也可以是类插件（`Service` 子类，带静态 `inject` / `Config`）。`provide` 和 `intercept` 字段供 loader 读〔一手〕 | `vendor/cordis/src/registry.ts:98-130`、`packages/shell/bash-local/src/index.ts:97-110` | |
| 默认导出的陷阱 | Loader 先取 `exports.default`；一旦有默认导出，整个命名空间（含 `inject`）都被丢掉〔一手〕 | `vendor/loader/src/index.ts:201-208`；复盘 0001 | |
| `package.json` 的 `dsh` 字段 | 只有 `manifestVersion?: 1`、`bundle`（`patch`、`platforms`、`listedByDefault`）、`profile`（`bundles`）、`client`（`platform`、`inject`、`immediately`、`external`）。**没有插件身份、提供或消费的服务、契约版本、权限**〔一手〕 | `packages/util/package-manifest/src/types.ts:31-100` | |
| 其他声明 | `engines.dsh`，或对 `@deepseek-ai/dsh-*` 的 peer 范围；显示用的 `icon`（不超过 256 KiB，必须在包内），以及导出的 `./locale/*.json`〔一手〕 | `packages/boot/app-boot/src/plugin-compatibility.ts:55-74`、`package-meta.ts:1-60` | |
| 校验时机：导入前 | 兼容检查只读 `package.json`，不导入代码；不兼容的行改成 `disabled: true`，组合包被跳过；元数据读不出也算拒绝〔一手〕 | `plugin-compatibility.ts:1`、`compatibility-preflight.ts:63-118`、`index.ts:770-772`、`profile.ts:697-700` | |
| 校验时机：导入前（续） | 显示元数据（标题、说明、图标）同样不执行代码就读〔一手〕 | `package-meta.ts:1` | |
| 校验时机：导入后 | `inject`、`Config`、`provide` 是模块导出，导入后才知道。`Config` 在 fiber 激活时用 `resolveConfig` 校验；失败就记日志、fiber 置 FAILED〔一手〕 | `vendor/cordis/src/fiber.ts:668-695` | |
| `manifestVersion` | 只在类型里声明，全仓没有代码读它〔一手，grep〕 | `packages/util/package-manifest/src/types.ts:34`；README 自认未强制，见 `README.zh.md:96` | |

〔初判〕灵鲸的 manifest 比 DSH 厚：`liwa` 字段里有 `id`、`kind`、`provides`（槽位、契约版本、impl、meta）、`consumes`、`multiInstance`，导入前就能建静态服务图。这一维我们多出"静态契约声明"，DSH 没有。

### 2 发现与装载

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 插件从哪来 | ① 安装目录自带（启动器自己的依赖）；② profile 目录 `$DSH_HOME/profiles/<name>` 的 `node_modules`（pnpm 管理，`nodeLinker: hoisted`，所有插件共用一份 cordis）；③ patch 里写相对或绝对路径，按 patch 文件所在目录锚定〔一手〕 | `profile.ts:5-20`、`profile.ts:180-189`、`index.ts:548-559` | |
| 解析 | 包名有两个锚点：先找安装目录，再找 profile 目录；runtime resolution 拦截 Node 的 ESM 和 CJS 解析器〔一手〕 | `profile.ts:16-20` | |
| 插件种类 | 宿主插件（Node）；浏览器插件（声明 `dsh.client` 的包，共 88 个）；同一个包两面都有；组合包（只有配置，24 个）；profile；agent preset（声明式子树）；内置 `cordis:include` / `cordis:group`；进程内动态 Cordis 定义（vm，按会话、不持久）；把外部生态包成插件的桥：`claude-code-mods`、`hooks-claude-code` / `hooks-codex`、`mcp-client`〔一手〕 | `index.ts:748-766`、`packages/extensions/README.zh.md`、`packages/experimental/claude-code-mods/README.zh.md:2`；计数脚本 | |
| 外部插件的分发单位 | 必须是**组合包**（声明了 `dsh.bundle`）；装没有 bundle 的包会报 `not-bundle`〔一手〕 | `packages/boot/plugin-manager/src/index.ts:634`、`tools.ts:20` | |
| 安装 | `dsh plugin --profile x add <pkg>` 原样转给 pnpm；Web 与模型走 `PluginManager`。安装源可以是 registry、本地目录、tarball、git〔一手〕 | `apps/cli/src/args.ts:13-14,52-58`、`plugin-manager/src/install-spec.ts:13-17`、`index.ts:856-890` | |
| 安装的把关 | 先查 GitHub 连通；安装脚本（`allowBuilds`）要人批准，记进 profile；安装失败把 `package.json` 和 `pnpm-lock.yaml` 恢复原样；装完 HMR 立即生效，否则提示重启〔一手〕 | `plugin-manager/src/build-approval.ts:1-15`、`index.ts:858-866`、`types.ts:46-52` | |
| 市场 | 用户自己配索引 URL（只许 http(s)，不许带凭据和片段）；条目来源是 npm 或 git，带版本和 engines；**索引没有签名**〔一手〕 | `packages/boot/plugin-market/src/index-url.ts:3-25`、`README.zh.md:127`、`packages/util/plugin-market-index/src/index.ts:204` | |
| 官方按需目录 | `ON_DEMAND_BUNDLES`（如 Claude Code、Codex 子智能体）、`OPTIONAL_BUNDLES`（16 个随装默认关闭的组合包）、`RETIRED_BUNDLES`（自动从 profile 移除）〔一手〕 | `packages/util/official-bundles/src/bundles.ts:36-78` | |

〔初判〕灵鲸第一版只有仓库内插件（`packages/plugins/*`），种类按 realpath 推导，没有安装、市场、外部插件（决策 31、32）。这一维 DSH 远比我们全，我们是故意不做。

### 3 组合

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| profile | 一个目录，里面有 `package.json`（`dsh.profile.bundles` 有序）和 `cordis.patch.yml`。随发行版带 5 个模板：web、headless、acp、sdk、sdk-minimal，第一次用时自动初始化〔一手〕 | `profile.ts:1-14`、`official-bundles/src/bundles.ts:9-26`、`profile.ts:728-746` | |
| 组合包 | `dsh.bundle.patch` 是一个文件或有序文件列表（web-app 有 4 个），可限平台；组合包自己也查 `engines.dsh`；读不出、平台不符、不兼容就跳过，记进 `skippedBundles`，每次启动打印一次〔一手〕 | `profile.ts:678-713`、`packages/bundle/web-app/package.json` | |
| 叠层顺序 | 空表 → 各组合包 patch（按 bundles 顺序）→ profile 的 `cordis.patch.yml` → home 的 `$DSH_HOME/cordis.patch.yml`（机器级偏好，压过 profile 层）→ `--patch` → 遥测关闭开关（自动加）〔一手〕 | `profile-context.ts:74-85`、`apps/cli/src/profile-boot.ts:211-224` | |
| patch 语法 | 三种：`insert`（可插到某个 group 里）；按 `id` 覆盖字段（`config` **整体替换**，不深合并）；`disabled`。同一个列表里后面的 patch 能改前面刚插入的行。指向不存在的 id 只警告并跳过〔一手〕 | `vendor/include/src/index.ts:43-125`、`packages/bundle/base/cordis.patch.yml:6-10` | |
| 没有的 | **没有 `remove`**（只能 `disabled`）；**没有 `extends`**；`name` 是断言不是替换：对不上就跳过并警告〔一手〕 | `vendor/include/src/index.ts:115-117` | |
| 条件组合 | `disabled: !!js "..."` 和 `config` 里的 `!!js` 会求值（DSH 本地补丁）；其他元数据里写表达式，CI 会拒〔一手〕 | `vendor/README.md:54`（补丁 18）、`scripts/verify-cordis-config.ts:1-11,39` | |
| required 名单 | 全局写死 10 个**条目 id**：`agent-loop`、`tool-executor-native`、`tool-executor-ptc`、`webserver`、`web-runtime`、`modules`、`connection`、`headless-runner`、`acp`、`sdk-jsonrpc-server`。在装又没激活，启动失败；不在表里或被禁用的 required 行不影响启动。根 Include 必须激活〔一手〕 | `index.ts:942-960,1140-1170` | |
| 换掉 required 实现 | 名单按 id 认，不按模块认。禁用 `agent-loop` 行、再插一行别的 id，就能绕过 required 检查〔推理，据上一行代码〕 | 同上 | |
| 装配打印 | `--dump-config`：不启动，打印叠好的 YAML，每段前面一行 `# == <来源文件>, patched by <层>`，`!!js` 原样打印；`--dump-default-config` 只打组合包层；`--dump-config-schema` 打所有插件 Config 的 JSON Schema，**要导入模块**〔一手〕 | `index.ts:601-727`、`apps/cli/src/args.ts:32-50,111-136`、`app-boot/src/config-schema/index.ts:9-21` | |
| 准入不在打印里 | dump 里仍会出现被兼容策略禁用的行；被拒的组合包则整层不出现〔一手〕 | `index.ts:609-611` | |
| 运行中重新组合 | `recomposeProfile`：先停掉新一代不再列出的行，发布新的 resolution，做兼容预检，更新根 Include，再判定激活；失败时回滚已停的行〔一手〕 | `index.ts:287-434` | |
| 插件管理器改 patch | 保留注释，原子写入；只写 `{id, disabled}`，下层已经是同一状态时删掉多余的覆盖〔一手〕 | `plugin-manager/src/patch.ts:16-78` | |
| 受保护插件 | 17 个包（插件管理器、Loader、Include、网关、webserver、HMR、tools……），插件管理器拒绝禁用或移除〔一手〕 | `official-bundles/src/plugin-manager.ts:3-18` | |

〔初判〕灵鲸的 profile 和 patch 形状照 DSH，并有几处改动：
- 动作多了 `bind` 和 `enable`；
- `insert` / `remove` 只许在仓库 profile 里写；
- 指向不存在的 id 报错（DSH 只警告）；
- required 由组合根以代码传入（DSH 是全局 id 名单）；
- 有阶段集合，DSH 没有；
- `dump-config` 输出结构化的 `AssemblyPlan` 加哈希（DSH 输出带来源注释的 YAML）；
- 没有 `extends`，与 DSH 相同。

### 4 服务与 seam

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 四种角色 | 服务目录给每个服务键分一类：`core`（主干）、`seam`（可替换能力）、`service`（独立服务）、`bundle`（组合点）。分类是手工维护的目录，配一个完整性守卫：代码里声明的服务键与目录不一致，就生成失败〔一手〕 | `scripts/gen-doc-graphs.ts:38-47,109,1018-1029,1033` | |
| 数量 | 107 个：core 60、seam 36、service 10、bundle 1（`agentLoop`）。全表见 ④〔一手，脚本统计〕 | 同上 | |
| 目录范围 | 只收宿主侧服务。浏览器侧（`ctx.slots`、`ctx.modules`、`ctx.commandUi`……）、启动器给的（`pluginPackages`、`cmdlineArgs`、`appExit`、`appReady`、`dshHomePath`）、cordis 自带的（`loader`、`timer`、`logger`）都不在表里〔一手：表里没有这些键〕；为什么不收〔未核实〕 | `packages/boot/app-boot/src/profile-resolution/service.ts:18-20`、`packages/boot/cmdline/src/index.ts:55-63` | |
| seam 的定义 | 三种角色：Definition 声明接口、占一个键；Provider 实现它；Consumer 使用它。"单一角色本身不是 seam"〔一手〕 | `docs/architecture.zh.md:138-142` | |
| 写法一：单实现 | Definition 是抽象 `Service` 子类，提供方继承后占住这个键；同一 realm 里第二个提供方会抛 `service "x" has been registered at <fiber>`。36 个 seam 里约 17 个是这种（shell、fs、sandbox、subprocess、sessionPersistence……）〔一手；数量是启发式 grep 的〔推理〕〕 | `packages/shell/shell/src/index.ts:36-40,64-67`、`vendor/cordis/src/reflect.ts:289-291` | |
| 写法二：注册表 | Definition 是宿主服务，提供方调用 `registerX()`，按名或按路由登记，重名报错。约 15 个（llm、web、subagents、skills、browserUse、lsp、terminals……）〔一手 / 〔推理〕同上〕 | `llm/src/index.ts:395-450`、`subagent/src/index.ts:541-569`、`skill/src/index.ts:380-390` | |
| 选择规则 | 每个 seam 自己定，没有统一机制：<br>• `web`：显式配置的 id 必须存在且可用；没配就要求恰好一个可用，多个报歧义，并写明不做隐藏的优先链；<br>• `llm`：按 provider 路由；<br>• `sessionTitle`：唯一可选提供方；<br>• `browserUse`：按名独占〔一手〕 | `packages/web/web/src/index.ts:1-6,49-56,64-75`；`docs/capability-seams.zh.md` 的说明列 | |
| 回退链 | seam 层面**没有**回退链；`web` 明确拒绝优先链。回退只出现在单个实现内部，例如 `sandbox-local` 在 Linux 上先试 bwrap 再试 Landlock〔一手〕 | `web/src/index.ts:52-55`、`packages/sandbox/sandbox-local/src/index.ts:1-3` | |
| 按会话用不同实现 | 有，靠 **agent preset**：<br>• 每个 preset 是一棵内存 Loader 树加一个 scope；<br>• Agent 绑定某个版本，旧版本等最后一个引用释放才销毁；<br>• preset 里的服务提供方和消费方必须放在同一个 `cordis:group` 的 `isolate` realm 里，否则查找仍落到宿主 realm；<br>• 挂载审计会拒绝"泄漏到全局"的服务〔一手〕 | `packages/preset/agent-preset-registry/README.zh.md:56-60`、`src/mount.ts:51-79`、`packages/bundle/web-app/presets/ptc.patch.yml:44-50` | |
| 按会话的登记 | 工具、命令、提示词段落、技能、守卫可以登记在某个 agent 的 scope 里，遮蔽同名的全局项〔一手〕 | `packages/core/scope/src/index.ts:1-12`、`commands/src/index.ts:93-106`、`tools/src/index.ts:380-401` | |
| 按租户 | 没有租户概念。非 owner 对端（例如 liveshare）只能按角色策略调部分 Remote 方法〔一手〕 | `docs/capability-seams.zh.md`（`remoteAccess` 行） | |
| 默认实现 | 由组合包决定：base 插入 `credentials-local`、`session-persistence-jsonl`、`jobs-local` 等；cordis 本身没有"默认实现"〔一手〕 | `packages/bundle/base/cordis.patch.yml:94-140` | |
| 多实例 | 同一模块可以装多行，各自一个插件实例（例如多个 `@deepseek-ai/dsh-agent-preset` 行）。单实现 seam 要多份，只能分 `isolate` realm（按条目或命名标签）〔一手〕 | `packages/boot/hmr/README.zh.md:77`、`vendor/loader/src/config/isolate.ts:25-60` | |

〔初判〕灵鲸把这一维做成了统一机制：`SlotDef` 声明基数、作用域、契约版本、`requiredBy`；`registry` 基数自带有序回退链；`member-single` 按成员绑定；`as:` 多实例。DSH 的做法是"每个 seam 自己写"，我们是"内核统一裁判"，这是两家形状上最大的不同。按服务键数量算，DSH 107 个远多于我们；按"可替换能力"算，DSH 36 个 seam，我们 12 种槽位，但我们一个槽位下面挂一族能力（如 `ability.*`）。之前写的"约 8 个 seam"要改。

### 5 依赖注入与顺序

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| inject | 数组或映射，全部算必需；所有被注入服务的提供方 uid 拼成一个"代际"串，有一个缺就不激活；提供方换了，代际变，消费方先卸载再重跑 `apply`〔一手〕 | `vendor/cordis/src/registry.ts:63-88`、`fiber.ts:611-639` | |
| 可选依赖 | 不写进 inject，改用 `ctx.get(name)`（拓扑无关）或 `ctx.inject([...], cb)`（建一个子插件）。直接读 `ctx.<name>` 只沿祖先 fiber 找，跨兄弟分支会抛错（复盘 0001）〔一手〕 | `packages/AGENTS.md:6`、`vendor/cordis/src/reflect.ts:150-166`；仓库里 `ctx.inject([` 有 84 处 | |
| 环检测 | **没有**。服务依赖成环，两边都停在 PENDING，启动审计把它们列进"在等服务的插件"表。include 文件成环在配置 schema 收集时会报错〔一手〕 | `index.ts:1075-1080,1130-1136`、`app-boot/src/config-schema/collect.ts:140` | |
| 启动顺序 | 行的顺序**没有**装载语义，激活只看服务是否齐备；Loader 并发挂载各行〔一手〕 | `packages/bundle/base/cordis.patch.yml:12-13`、`index.ts:860` | |
| 静态服务图 | 没有（inject 在模块导出里）。`--dump-config` 打的是条目，不是服务图〔一手〕 | 同维度 1 | |
| ready | 没有每个插件的 ready 或 health 钩子：`apply` 返回的 promise 落定，fiber 就算 ACTIVE。启动器有一个全局的 `appReady`：启动审计通过后才调用 `commit()`，监听者此后才开始干活〔一手〕 | `vendor/cordis/src/registry.ts:98-110`、`packages/boot/cmdline/src/index.ts:45-53`、`apps/cli/src/profile-boot.ts:340-345` | |
| 等待落定 | `boot()` 在 `loader.await()` 之后审计；**没有超时**，某个 `apply` 卡住，启动就卡住〔一手〕 | `index.ts:1241-1243`；只找到 `:840` 一处时限 | |
| 优雅关闭 | SIGTERM 退出码 0，SIGINT 退出码 130。整棵树 `fiber.dispose()`，5 秒后强制退出，第二次信号立即退出〔一手〕 | `apps/cli/src/process-shutdown.ts:1-80`、`profile-boot.ts:302-312` | |
| 释放顺序 | 同一个 fiber 的 disposables 用 `Promise.all` 并发释放；但提供方的释放函数会先等依赖它的 fiber 落定，再删自己的 store，所以"依赖方先卸"是 cordis 隐式保证的〔一手〕 | `vendor/cordis/src/fiber.ts:698-712`、`reflect.ts:296-301` | |
| 释放顺序（续） | 没有显式的 drain 阶段〔一手：未见〕 | | |

〔初判〕灵鲸在这一维有意比 DSH 严：
- 第 1 阶段建静态服务图，查环、查缺提供方；
- 启动有时限（20 秒）；
- 每个插件有 `ready` / `drain` / `health`；
- 关闭按逆拓扑序、45 秒截止。

DSH 靠 cordis 的响应式 PENDING 和隐式卸载顺序。

### 6 生命周期与 effect

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| apply 与 dispose | fiber 六态：PENDING、LOADING、ACTIVE、FAILED、UNLOADING、DISPOSED。依赖消失回到 PENDING，回来就重跑 `apply`〔一手〕 | `vendor/cordis/src/fiber.ts:140-153,611-724` | |
| effect | `ctx.effect()`、`ctx.on()`、`ctx.provide()` 都登记成可撤销的 effect。DSH 本地补丁收紧了重入释放：`UNLOADING` 时拒绝新 effect，释放时的观察者异常逐个隔离〔一手〕 | `vendor/README.md:42`（补丁 6）、`fiber.ts:110-138,408-421` | |
| 定时器 | `@deepseek-ai/cordis-plugin-timer` 给 `ctx.setTimeout`、`setInterval`、`timeout`、`interval`、`throttle`、`debounce`，都随 fiber 释放〔一手〕 | `vendor/timer/src/index.ts:4-15,127-128` | |
| 激活失败 | fiber 置 FAILED，`ctx.logger.error` 记一条，兄弟行照常运行。非 required 的失败只打一条警告，required 的失败让启动失败并拆掉整棵树〔一手〕 | `fiber.ts:677-685`、`index.ts:1140-1170,1245-1270` | |
| 运行时崩溃 | `installFailLoud`：任何 `unhandledRejection` 或 `uncaughtException` 都写一行诊断，等终端释放（最多 2 秒），然后 `exit(1)`。理由是"只有抛出点知道哪些状态完好"。**没有按插件隔离**〔一手〕 | `index.ts:842-931` | |
| 监听器异常 | `emit` 同步调用监听器、不隔离异常，抛出会打断发出方；`parallel` 汇成 `AggregateError`〔一手〕 | `vendor/cordis/src/events.ts:183-196` | |
| 释放异常 | 每个 disposer 单独 catch 后记日志，不中断其他 disposer〔一手〕 | `fiber.ts:698-710` | |
| 重启异常 | 启动器挂了一个全局的 `internal/update` 监听，把重启 promise 的拒绝记进日志〔一手〕 | `index.ts:1227-1231` | |
| 熔断 | **没有**连续崩溃计数，也没有自动禁用〔一手：未见〕 | | |
| 安全模式 | 没有自动安全模式。桌面版致命错误后弹原生对话框，可选"退出 / 重启 / 禁用全部插件后重启"：备份 profile patch，只留 web 模板的组合包。CLI 的对应做法是 `dsh <名> --from-default-profile web` 从模板重建〔一手〕 | `apps/desktop/src/fatal-recovery.ts:1-15,108-118`、`main.ts:104-108`、`app-boot/src/profile-sanitize.ts:8-18`、`apps/cli/src/args.ts:93-94` | |

〔初判〕灵鲸设计里有 DSH 没有的东西：`AsyncLocalStorage` 标插件 id、同一个 builtin 连续崩溃 3 次自动禁用、`boot.json` 启动失败计数、组合根的极简安全页（`00-plugin-kernel.md` §5.3）。"未处理异常就退出"这一点和 DSH 相同。

### 7 热重载与 HMR

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 怎么做 | `dsh-hmr` 只用一个队列：模块替换、Include 刷新、profile 配置变更、插件管理器的操作都排进去，不嵌套〔一手〕 | `packages/boot/hmr/README.zh.md:12,59-63`、`src/index.ts:1-23` | |
| 范围：配置 | web 模板默认只监听 profile patch、home patch 与 manifest；headless、sdk、acp 模板默认关〔一手〕 | `hmr/README.zh.md:27`、`packages/bundle/base/cordis.patch.yml`（`hmr` 行 `root: []`） | |
| 范围：源码 | 监听源码模块要在 patch 里打开 `root`。profile 目录下（含 `node_modules`、链接包）文件变了，下次重新组合时替换对应插件〔一手〕 | `hmr/README.zh.md:27-36,49` | |
| 替换机制 | 沿 ESM 链接和 CJS `children` 传播失效；受影响的行停掉，由 `recomposeProfile` 一次性重新启动；HMR 自己不导入新代码，由 Loader 导入当前文件〔一手〕 | `hmr/README.zh.md:67-69` | |
| 范围：浏览器 | 插件启停不刷新页面；代码重建后替换受影响的插件，依赖它的插件跟着重载〔一手〕 | `packages/client/hmr/README.zh.md:12` | |
| 状态保留：配置 | 只改 `volatile` 字段时，原地提交，不重新挂载，并发出 `loader/volatile-update`；设置页改的模型、开关之类走这条路。这是 DSH 本地补丁〔一手〕 | `vendor/README.md:61`（补丁 22）、`vendor/loader/src/config/entry.ts:150,164-191` | |
| 状态保留：代码 | 宿主侧插件重新挂载后内存状态没了〔推理，据 fiber 重跑 `apply`〕；持久状态靠会话日志和投影重建。浏览器侧明说"重置其组件状态"〔一手〕 | `packages/client/hmr/README.zh.md:12` | |
| 失败行为 | README 前后不一致：<br>• 第 77 行（共享运行时的模块替换）：替换失败就清理、恢复原实现；<br>• 第 113 行（重新组合）："旧版本不会被恢复"。<br>〔待实测〕 | `hmr/README.zh.md:77,113` | |
| 限制 | 宿主自己导入的模块（cordis、Loader、app-boot）变了只能重启；兼容检查只在组合行时跑，用 `ctx.loader.create()` 加的行绕过检查〔一手〕 | `hmr/README.zh.md:108,114` | |

〔初判〕灵鲸第一版不做热重载，一律"排空后重启"（`00-plugin-kernel.md` §8）。这是 DSH 明显领先、我们故意后放的一维。

### 8 进程外与隔离

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 通用的进程外插件宿主 | **没有**。所有 cordis 插件都在宿主进程里〔一手〕 | `packages/boot/plugin-manager/README.zh.md:31`（"已安装的 Host 代码在宿主进程内运行，不受工作区沙箱限制"） | |
| `cordis-host-runner` | 不是进程外：宿主那一半在 `node:vm` 里求值，Node 全局被拿掉或改指到 cordis 服务；`vmTimeoutMs` 只限同步部分；定义按会话、只在内存、重启清空；带浏览器端的包要人批准。"沙箱隔离全局变量，但不是安全边界"〔一手〕 | `packages/extensions/cordis-host-runner/README.zh.md:12,56-62,139` | |
| 真正在进程外的 | 都不是插件宿主：<br>• MCP 服务器（`mcp-client` 把它的工具注册进 `ctx.tools`）；<br>• LSP（`lsp-stdio`）；<br>• 子智能体 CLI（ACP、Codex、Claude Code，经 `ctx.subprocess` 拉起）；<br>• PTC 程序（`ProgramWorker` 经 `ctx.subprocess.spawn`，可进沙箱）；<br>• SSH 远端辅助程序；<br>• DSH 自己作为进程外服务端（`sdk-jsonrpc-server`、`acp`）〔一手〕 | `packages/ptc-runtime/ptc-runtime-node/src/worker.ts:258`、`docs/capability-seams.zh.md`（`subprocess` 行）、`packages/sdk/server/README.zh.md:2` | |
| IPC 协议 | 宿主与浏览器之间走 **typert Remote**：构建期分析类型，生成 zod schema 和调用描述符；服务方法加 `@Remote` 后就能从浏览器调用；网关负责分派、校验、取消、重连。SDK 走按行分帧的 JSON-RPC〔一手〕 | `packages/typert/protocol/README.zh.md:2`、`packages/api/gateway/README.zh.md:2`、`packages/sdk/protocol/README.zh.md:2`、`commands/src/index.ts:314-315` | |
| 沙箱 | `ctx.sandbox` 只管**模型要跑的进程**：Linux 先 bwrap 后 Landlock，macOS 用 Seatbelt，Windows 用 ACL；文件系统写入有 `fs-sandbox`。插件本身没有沙箱〔一手〕 | `packages/sandbox/sandbox-local/src/index.ts:1-3`、`SAFETY.zh.md:11-13` | |

〔初判〕灵鲸已经把进程外插件的契约形状定了：fd 3 管道、JSON-RPC 2.0、`hello` 握手、受限反向视图 `PLUGIN_VIEWS`、取消、资源预算、熔断（kernel-1，推迟实现）。这一维我们的**设计**比 DSH 多一整块，DSH 没有。但两家现在都没有能跑的进程外插件。

### 9 配置与密钥

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 配置 schema | 插件导出 `Config`（schemastery，Standard Schema），激活时校验；`!!js` 在注入就绪后才惰性求值，可以引用别的服务（如 `port: !!js ctx.webStartup.port ?? 3080`）〔一手〕 | `vendor/cordis/src/registry.ts:103`、`vendor/README.md:51`（补丁 15）、`packages/boot/cmdline/src/index.ts:10-15` | |
| 导出 schema | `--dump-config-schema` 不挂载插件就生成 JSON Schema，但要导入模块、执行 Config getter；另有生成的全量配置目录 `docs/config-catalog`〔一手〕 | `app-boot/src/config-schema/index.ts:9-21` | |
| 运行时改配置 | `ctx.settings` 把 volatile 字段做成表单，`ctx.configEditor` 在文件锁和 HMR 队列下写回 profile patch〔一手〕 | `packages/settings/settings/src/index.ts:1`、`packages/boot/config-editor/src/index.ts:1-9` | |
| 密钥引用 | 配置里只写引用（环境变量名，规则 `^[A-Za-z_][A-Za-z0-9_]*$`），值由 `ctx.credentials` 提供方持有，每次操作现解析，换凭据不用重启。来源依次是 `$DSH_HOME/.credentials.yaml`、继承的环境、项目 `.env`、用户 `.env`〔一手〕 | `packages/credentials/credentials/src/index.ts:1-9,18-35`、`packages/bundle/base/cordis.patch.yml:113-126` | |
| 脱敏 | schema 里标了 `role('secret')` 的字段，过线前按结构删掉，只留"有没有值"的旁注；设置面的读取一律脱敏〔一手〕 | `packages/settings/settings/src/redact.ts:1-8`、`docs/capability-seams.zh.md`（`settingsController` 行） | |
| dump 里的密钥 | `--dump-config` 原样打印 patch；密钥平时只以引用出现在 patch 里，所以打印出来也是引用〔推理〕；有没有专门脱敏〔未核实〕 | | |
| 环境层 | `.env` 分层：继承 > 项目 `.env` > home `.env`。启动类变量（`PATH`、`NODE_OPTIONS`、`DSH_*`、代理、CA……）任何 `.env` 都不能设，只有 home 层能设代理〔一手〕 | `index.ts:133-257` | |

〔初判〕灵鲸的做法相近：`$secret` 引用（钥匙串 → `secrets.env`）在第 2 阶段才解析，`dump-config`、日志、哈希里只出现引用；配置用 zod 校验。我们没有 volatile 原地提交，也没有设置页自动表单；DSH 的 `role('secret')` 结构化脱敏值得借鉴〔推理〕。

### 10 版本与兼容

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| manifest 版本 | `manifestVersion: 1` 只是声明，没有代码检查〔一手〕 | 见维度 1 | |
| 运行时版本 | 插件或组合包声明 `engines.dsh`（有它就只看它），否则看对 `@deepseek-ai/dsh-*` 的 peer 范围；`workspace:*` 视为当前版本；预发布版也参与比较〔一手〕 | `plugin-compatibility.ts:55-102` | |
| 导入前检查 | 启动、重新组合、preset 挂载时都在导入前查；不兼容的行禁用、组合包跳过；读不出要求一律拒绝〔一手〕 | `compatibility-preflight.ts:63-118`、`index.ts:770-772`、`hmr/README.zh.md:114` | |
| 豁免 | 按"精确插件 `name@version` × 精确 DSH 版本"豁免，存在 profile 里；模型给豁免必须带 `acceptRisk`，并先向人说明风险〔一手〕 | `plugin-compatibility.ts:76-117`、`plugin-manager/src/tools.ts:25,94` | |
| API 与契约版本 | 服务和事件都**没有**版本号；规则是"Public APIs are pre-stable; update every consumer"，每个对外可感知的破坏性变更都写升级指南（10 个版本目录、81 份 `guide.md`）〔一手〕 | `AGENTS.md:7,11`、`docs/upgrade-guide/` | |
| 持久格式版本 | 会话格式有 `SESSION_FORMAT_VERSION`，迁移是独立的包（`session-format-v0-to-v1` 一直到 `v3-to-v4`），旧代永不改写；SQLite 用单调递增的 `SCHEMA_VERSION`〔一手〕 | `AGENTS.md:7,134`、`packages/session/session-format-*` | |
| 文档漂移 | `package-manifest` 的 README 说"当前安装器和加载器不强制检查 `dsh.manifestVersion` 或 `engines.dsh`"；代码其实强制检查 `engines.dsh`。README 有一半过时〔一手〕 | `packages/util/package-manifest/README.zh.md:96` 对比 `app-boot/src/plugin-compatibility.ts` | |

〔初判〕灵鲸的版本管得更细：`manifestVersion` 强制检查；每个槽位一个整数契约版本，导入前比对；五种版本号分开。DSH 只管"对运行时的 semver 范围"。我们没有豁免机制，也不需要（全是仓库内插件）。

### 11 事件、钩子、瀑布

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 分发方式 | `emit`、`parallel`、`serial`、`bail`、`waterfall`；事件用声明合并定类型，要求标 `@mode` 和 `@param`〔一手〕 | `vendor/cordis/src/events.ts:27-32`、`AGENTS.md:134` | |
| 三种事件域 | 会话事件（持久，写日志，经 `session/event` 广播）；Agent 事件（`agent/*`，观察或拦截进行中的工作）；能力事件（`fs/*`、`tools/*`、`telemetry/*`，给某个 seam 加策略）〔一手〕 | `docs/architecture.zh.md:69-77` | |
| 回合钩子 | `agent/pre-step`（接纳、改写或拒绝领到的消息）、`agent/request`、`llm/stream`、三个 `tools/*` 都是瀑布；`agent/turn-stopping` 是 serial〔一手〕 | `docs/architecture.zh.md:83-112` | |
| 工具执行瀑布 | 依次：<br>1. `tools/pre-execute` 瀑布，决定 allow / deny / ask / cancel；<br>2. ask 交给 approval seam；<br>3. allow 之后跑**单调守卫** `checkGuards`：守卫只能给出拒绝理由，排在策略和审批之后，任何瀑布监听都翻不回来；<br>4. `tools/execute` 瀑布，包住调用；<br>5. 工具体；<br>6. `tools/post-execute` 瀑布，决定 accept / 替换 / block；<br>7. `tools/result` 通知观察者。<br>〔一手〕 | `packages/core/tools/src/pipeline.ts:184-235,299-300,476-510`、`index.ts:380-401`、`contracts.ts:357-370,391`、`events.ts:18-49` | |
| 守卫的作用域 | 守卫分层：全局，加上该 agent 的 scope 链〔一手〕 | `tools/src/index.ts:93-109,393-400` | |
| 提示词段落注册表 | 段落有唯一名，重名报错；按 `order` 升序，同序按名；文本可以是每次组装求值的函数；`{{变量}}` 严格插值。`complete: true` 的段落就是全部系统提示词，两个同时生效即失败。组装后还有一个瀑布 `system-prompt/assemble`，但登记过的 complete 段落会被恢复。人设前缀段落 `deployment:persona-prefix` 可以被 preset scope 里同名的段落遮蔽〔一手〕 | `packages/core/system-prompt/src/index.ts:13-36,52-75,186-197` | |
| 会话投影 | 投影单元是纯同步折叠：`key`、`stateSchema`、`init`、`apply`，可选 `wire.view`。不关心的事件必须返回同一个引用；状态必须是纯 JSON（才能落检查点）；框架统一订阅、按会话维护水位、发变更。"状态事件必须带完整的变更后状态，不许只带增量"〔一手〕 | `packages/session/session-projection/src/index.ts:1-17,51-120` | |
| 模型可见即已记录 | 每个模型请求都必须能从日志重建；新增模型可见输入要有新的会话事件〔一手〕 | `docs/architecture.zh.md:130` | |
| 外部钩子 | `hooks-claude-code` / `hooks-codex` 直接用用户现有的 hooks.json（阻塞提示与工具、加上下文、强制继续）〔一手〕 | `packages/experimental/hooks-claude-code/README.zh.md:2` | |

〔初判〕灵鲸刻意不开工具执行、不开提示词整段替换（硬规矩所在），事件只由 kernel 发（门面里没有 `emit`）。可以照搬的是：
- 投影单元的写法（`journal.projection` 槽位，§16 已列为"可加"）；
- "单调守卫排在瀑布之后"的顺序思想（guard / 准入）。

### 12 界面插件

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| slot 种类 | `single`、`list`、`keyed`、`chain`〔一手〕 | `packages/client/ui-slots/src/index.ts:100-101` | |
| slot 作用域 | `root`、`session-maybe`、`session`〔一手〕 | `ui-slots/src/index.ts:103-104` | |
| 遮蔽规则 | 适用于 single、keyed、list：同一个格子（single 是 slot 本身，keyed 是同一个 key，list 是同一个 id）可以按不同 `priority` 共存，**最小的那个渲染**；同一 priority 第二次登记直接报错并点出占用者〔一手〕 | `ui-slots/src/index.ts:766-797,1137-1143` | |
| chain | 每个条目必须带 `select`，按 `priority` 升序依次询问，第一个非 null 胜出；都拒绝就用拥有者的 fallback〔一手〕 | `ui-slots/src/index.ts:275-300,785-790` | |
| 声明与校验 | 拥有者用声明合并把 slot 加进 `SlotMap`；一次 `register` 贡献一个组件，可以顺带声明子 slot、store、注入的 hooks。往未声明的 slot 登记、重复声明子 slot、跨作用域共用 store 都在激活时报错〔一手〕 | `ui-slots/src/index.ts:24-25,1125-1137`、`packages/client/ui-sidebar-right/src/client/index.ts:206-232` | |
| 前后端同一个包 | 同一个 npm 包可以有宿主面（Node）和浏览器面（`./client` 导出）。宿主的 `clientModules` 扫描 Loader 里在装的行，找出声明了 `dsh.client` 的包，组合 `window.__DSH_BOOT__` 启动图，提供合并脚本〔一手〕 | `packages/client/modules/src/index.ts:1-24`、`package-manifest/src/types.ts:86-100` | |
| 浏览器里的 cordis | 浏览器里有**另一棵** cordis 和 Loader（`ctx.modules` 挂在浏览器 Loader 上），和宿主不是同一棵树，靠 typert Remote 通信〔一手〕。界面插件的脚本由宿主合并成 combo 脚本、经页面注入表注入同一个页面〔一手〕；有没有 iframe 一类的隔离，没有逐一核对〔未核实〕 | `packages/client/modules/src/client/index.ts:1-11,50-69`、`packages/client/modules/src/index.ts:1-11` | |
| 规模 | 带 `dsh.client` 的包 88 个，其中名字带 `ui-` 的 64 个（`packages/client/ui-*` 57 个目录，`experimental/client-ui-*` 9 个）〔一手，脚本统计〕 | | |

〔初判〕灵鲸界面插件归 console，V1.1 起做，形状借 DSH（`ui.area.*`）。这一维我们晚一步；DSH 的四种基数加"同 priority 报错"可以直接照抄〔推理〕。

### 13 插件贡献的命令

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| CLI 子命令 | 插件**不能**加 `dsh` 子命令。启动器只认 `--profile`、`--patch`、三种 dump、`plugin`；后面剩下的参数原样交给装好的树，由某个"应用插件"（web、headless……）注入 `cmdlineArgs` 后自己解析、打自己的 `--help`；它解析出的值可以发布成服务，供别的行的 `!!js` 配置读〔一手〕 | `apps/cli/src/args.ts:1-16`、`packages/boot/cmdline/src/index.ts:1-17,79-86` | |
| 斜杠命令 | `ctx.commands.register({ name, description, input?, recordInput?, handler })`，不经模型直接执行；名字规则 `^[a-z][a-z0-9_-]*$`；可以登记在某个 agent 的 scope 里遮蔽全局；全局重名报错；`list(agent)` 是 `@Remote`，浏览器能直接读〔一手〕 | `packages/interaction/commands/src/index.ts:31-77,93-106,285-290,314-315` | |
| 浏览器端命令 | `ctx.commandUi` 可以登记 popupSelect（如 `/model`、`/permission`）或 action，也可以给已有的宿主命令加弹窗；客户端命令与宿主命令重名会报错。三类派发：`leadingInput`、`popupSelect` 或 `action`、`execute`〔一手〕 | `packages/client/ui-commands/README.zh.md:12,32`、`src/client/contract.ts:1-5` | |
| 快捷键 | 功能插件用 `registerFixed()` 贡献只读的键位序列，参与冲突校验〔一手〕 | `packages/client/shortcuts/README.zh.md:32` | |
| 命令面板 | 没找到（grep `palette` 只命中配色）〔一手：未见〕 | | |

〔初判〕灵鲸 `00-commands.md` 的设计比 DSH 统一：一条命令声明一次，终端、命令面板、斜杠命令三端共用；插件命令必须以自己的实现 id 开头；`liwa` 进程从 `AssemblyPlan` 或 `commands.list` 拿清单。DSH 是三套各自的注册（CLI 交给应用插件、宿主的斜杠命令、浏览器的 commandUi），CLI 层插件不能加命令。这一维我们的设计领先。

### 14 测试支持

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 规则 | 产品可见的插件必须有一个**真实组合**测试：经 Loader 和应用启动一份测试用 `cordis.yml`，只 mock 外部服务；手搭的 `ctx.plugin(...)` 不算数。没有 inject 的插件要断言没有默认导出，并做 `unwrapExports` 往返；"真实入口"指构建后的 `lib/bin.js` 用普通 node 跑〔一手〕 | `docs/testing.zh.md:37-41` | |
| 测试内核 | 没有专门的"测试内核"API〔一手：未见〕。替代品：<br>• `loader-smoke`：子进程或直接启动真实 Loader 组合；<br>• `agent-loop-testkit`：先决依赖挂载与 Inbox 桩；<br>• `tool-testkit`：调工具流水线；<br>• `client-runtime`：jsdom 里的 slot 运行时；<br>• `remote-mock`：没有宿主的浏览器客户端。<br>〔一手〕 | `packages/test-support/*/README.zh.md:2`、`loader-smoke/src/index.ts:1-12` | |
| 假服务与回放 | `llm-mock-server`（可编排的故障服务器）、`llm-replay`（按已记录的 transcript 回放模型）；`DSH_SNAPSHOT=replay` 时启动同目录的 `cordis.snapshot.yml`；`session-snapshot` 做身份脱敏、规范化，并拒绝把 `UNKNOWN_TOOL` 提交成预期输出〔一手〕 | `index.ts:93-110`、`packages/test-support/{llm-replay,llm-mock-server,session-snapshot}/README.zh.md:2`、复盘 0002 | |
| 静态守卫 | 一批 CI 脚本：`verify-cordis-config`（元数据里不许写表达式、包能解析）、`verify-default-product-isolation`（实验包不进默认组合）、`verify-application-entrypoints`（不许绕过 `dsh` 启动）、服务目录完整性守卫等〔一手〕 | `scripts/verify-cordis-config.ts:1-11`、`scripts/verify-default-product-isolation.ts:1-5`、`docs/architecture.zh.md:45` | |

〔初判〕灵鲸设计了 `createTestKernel`（走同一段第 1–5 阶段代码，只多"内存包"和"假服务"两个注入点）、`@liwa/testkit`、回环编解码测试、录放大脑。在"测试内核"这一项上比 DSH 正式；DSH 的长处是"真实入口测试规则"和大量静态守卫脚本，我们应当照着补〔推理〕。

### 15 可观测

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 日志带插件 id | 有。`ctx.logger` 默认用 fiber 名（连字符化）当 logger 名，每条记录的 `meta` 带 `fiber` 的 WeakRef；导出器可以按 logger 名设级别。默认导出器只写 1000 条的内存缓冲〔一手〕 | `vendor/cordis/src/logger.ts:29-37,193-223,253-263` | |
| 错误栈 | `composeError` 把插件登记处的"外层栈"拼进错误栈〔一手〕 | `vendor/cordis/src/utils.ts:240-275` | |
| 指标 | 有遥测 seam `sessionTelemetry`（OTel 后端，可用 `DSH_TELEMETRY_DISABLED` 关）、`otel` 共享通道、`productTelemetry`、`tokenMeter`；没见到插件级别的指标〔一手〕 | `profile-context.ts:39-55`；④ | |
| 装配打印：启动前 | 维度 3 的 `--dump-config`〔一手〕 | | |
| 装配打印：启动失败 | 分组打印"失败的插件"（id、包、错误栈）和"在等服务的插件"（缺哪些服务）；`StartupError.composition` 最多带 256 行插件状态（id、模块、版本、状态、来源、缺的服务）和缺服务的提供方可见性（同 scope 或别的 scope），不含配置值〔一手〕 | `index.ts:1116-1138`、`startup-diagnostics.ts:1-104` | |
| 装配打印：运行中 | `pluginInventory/list` Remote 给出每行的模块、元数据、实际是否启用、fiber 阶段、诊断，外加每个 preset 的组合〔一手〕 | `packages/host/plugin-inventory/src/types.ts:17-60` | |
| 给模型的检查工具 | `cordis_inspect_list` / `cordis_inspect_query`，只读〔一手〕 | `packages/extensions/tool-cordis/src/index.ts:22-42` | |

〔初判〕灵鲸设计里有 `AssemblyPlan`（静态计划，带装配树哈希写进 `kernel.started.v1`）、kernel 事件进系统流、`liwa status`。DSH 没有装配哈希，没有把装配事件写进持久日志。日志带插件 id 两家相同（cordis 提供）。

### 16 权限与信任

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 插件能拿到什么 | 完整的 cordis `ctx`：任何服务都能 inject，能 `ctx.get` 读别人的服务，能直接碰 `ctx.reflect.store`、`ctx.loader`（preset 注册表就这样审计泄漏的服务）〔一手〕 | `packages/preset/agent-preset-registry/src/mount.ts:67-79` | |
| 限制 | 没有插件级权限模型。现有约束：<br>• 兼容检查；<br>• 受保护插件不能被管理器禁用；<br>• 安装脚本要批准；<br>• `.env` 不能设启动类变量；<br>• 元数据里不许写表达式（CI）；<br>• 实验包不进默认组合（CI）。<br>〔一手〕 | 维度 2、3、9、14 各处证据 | |
| 模型改插件 | `plugin_manager` 工具每次操作都要 `danger-full-access` 或本次批准；改动跨会话持久；给豁免要额外 `acceptRisk`；base 里默认禁用，标准和 Creator 预设里启用〔一手〕 | `packages/boot/plugin-manager/src/tools.ts:84-105`、`README.zh.md:31`、`packages/bundle/base/cordis.patch.yml:16-18` | |
| 信任立场 | "不可信插件可能损坏宿主计算机……泄露数据或凭据"；"在允许运行前检查插件"；沙箱和审批"不保证隔离"〔一手〕 | `SAFETY.zh.md:9-13,23` | |
| 对外的访问控制 | `remoteAccess` 只针对非 owner 的**对端**（分享场景），不针对插件〔一手〕 | `packages/api/remote-access/README.zh.md:2` | |

〔初判〕灵鲸同样全信任插件（决策 32），但多两道工程纪律：
- cordis 不出 kernel，插件只拿冻结门面，没有 `emit`；
- 写只经所有者。

DSH 插件直接拿 cordis `ctx`，什么都能碰。

### 17 内核里不可插拔的部分

| 能力点 | DSH 有什么、怎么实现 | 证据 | 灵鲸对应（待填） |
| --- | --- | --- | --- |
| 自述 | "产品的每一部分都是插件，包括……agent loop 本身"；"不存在需要打补丁的特权内核"〔一手〕 | `docs/architecture.zh.md:9-11` | |
| 实际内核：框架 | cordis（Context、fiber、reflect、events、registry、logger），加 Loader、Include、Group、Timer，全部 vendored 并打本地补丁〔一手〕 | `vendor/README.md` | |
| 实际内核：启动器 | `boot()` 直接 `new Context()`、`ctx.plugin(Loader)`、挂根 Include，不经配置〔一手〕 | `index.ts:1203-1235`、`apps/cli/src/profile-boot.ts:323-339` | |
| 实际内核：启动器提供的服务 | `profileContext`、启动环境快照、`pluginPackages`（运行时包解析）、`cmdlineArgs`、`appExit`、`appReady`、`dshHomePath`，都在任何行挂载前提供〔一手〕 | `index.ts:1226`、`profile-boot.ts:323-339` | |
| 实际内核：策略 | required id 名单、启动审计、`installFailLoud`、叠层顺序、兼容预检、`.env` 规则〔一手〕 | `index.ts`，见前文各维 | |
| 实际内核：浏览器 | 外壳先于 cordis 构建模块系统（"加载插件的机制不能经由它自己到达"）〔一手〕 | `packages/client/modules/src/client/index.ts:3-11` | |
| 业务代码 | 全是插件，包括 agent loop、tools、sessions、system-prompt、llm。但"能换"不等于"有第二个实现"：`agentLoop` 是唯一的具体循环（目录里 mode 是 `bundle`），扩展包只依赖 `dsh-agent` 的事件与服务〔一手〕 | `scripts/gen-doc-graphs.ts:692-699` | |

〔初判〕灵鲸的内核是 kernel 包加 `@liwa/core` 里的 required 插件（九样硬规矩：宿主、journal、账本、行动管线、回合调度……），不可替换。DSH 的业务主干在机制上都能换，我们故意把回合调度、工具执行、准入、受众计算锁在内核里。两家框架和启动器都不可插拔，这一点相同；不同在于业务主干能不能换。

---

## ④ DSH 的 seam 与服务全表

来源：`scripts/gen-doc-graphs.ts:109-969` 的 `SERVICE_ROLES`。服务键由生成器从代码里的 cordis 声明发现，角色是手工分类，带完整性守卫（`:1018-1029`）〔一手〕。"目录登记的实现"一列照抄目录。"用途"由我参考 `docs/capability-seams.zh.md` 的中文说明列缩写。"写法"一列是我按各 Definition 源码里 `abstract class … extends Service` 与 `register*()` 粗分的：

- 单实现：提供方占住服务键，同 realm 只许一个；
- 注册表：多个提供方按名或按路由登记；
- 其他：按事件、投影或枢纽组织。

这一列是启发式结果，标〔推理〕。

**合计 107 个：seam 36（单实现约 17、注册表约 15、其他 4）、core 60、service 10、bundle 1。** 不在表里的：浏览器侧服务、启动器给的服务、cordis 自带的服务（见维度 4）。


### 可替换 seam：36 个（其中所属包为实验性的 3 个）

| ctx 键 | 所属包（Definition） | 写法〔推理〕 | 目录登记的实现 | 用途 |
| --- | --- | --- | --- | --- |
| `approval` | `user-approval` | 注册表 | — | 一次性权限决策，经 `approval/request` 瀑布分派给回答方（UI、ACP 桥） |
| `attachments` | `attachment` | 单实现 | `attachment-local` | 图片与文件附件的持久存储，并解析成提供方原生内容 |
| `authorization` | `authorization` | 注册表 | — | 取得凭据的流程（如登录）注册表，按记录键每次只跑一个尝试 |
| `browserUse` | `browser-use` | 注册表 | `experimental-browser-use-playwright-mcp`、`experimental-browser-use-chrome-devtools-mcp`、`experimental-browser-use-stagehand-native` | 浏览器操控提供方，每个按名独占注册、自带工具 |
| `compaction` | `compaction` | 单实现 | `compaction-basic` | 上下文压缩后端，消费压力事件与请求错误恢复事件 |
| `computerUse` | `computer-use` | 注册表 | `experimental-computer-use-cua-driver-mcp`、`experimental-computer-use-cua-driver-native` | 电脑操控提供方，每个按名独占注册、自带工具 |
| `credentials` | `credentials` | 单实现 | `credentials-local` | 凭据引用解析：配置里只写环境变量名，值由提供方持有，每次操作解析 |
| `deepseekAccount` | `deepseek-account` | 单实现 | `deepseek-account-platform` | DeepSeek 账户的浏览器授权与本地凭证 |
| `deepseekLlmApiExtensions` | `deepseek-llm-api-extensions` | 其他 | `session-log-deepseek`、`plugin-package-inventory-deepseek` | 官方 DeepSeek 请求的扩展字段，由多个插件各自准备、适配器合并 |
| `directoryPicker` | `host-directory-picker` | 单实现 | `host-directory-picker-native`、`host-directory-picker-browse` | 选工作目录：原生对话框或应用内浏览 |
| `fileReferences` | `file-reference` | 单实现 | `file-reference-local` | 工作目录内的路径补全候选 |
| `forge` | `experimental-forge`（实验） | 注册表 | `experimental-forge-github` | 代码托管平台的变更请求（PR）查找与状态 |
| `fs` | `fs` | 单实现 | `fs-local`、`fs-sandbox`、`fs-ssh` | 文件系统读写编辑；沙箱版按沙箱模式限制写入，SSH 版指向远端 |
| `jobs` | `jobs` | 单实现 | `jobs-local` | 后台任务登记与输出流 |
| `llm` | `llm` | 注册表 | `llm-deepseek`、`llm-pi-ai`、`llm-replay` | 模型适配器注册表，按 provider 路由名登记，重名报错 |
| `lsp` | `lsp` | 注册表 | `lsp-stdio` | 语言服务器导航，只有四种标准化查询 |
| `mcpResources` | `mcp-resources` | 注册表 | `mcp-client` | 在调用方 agent 作用域内访问 MCP 资源 |
| `ptcRuntime` | `ptc-runtime` | 单实现 | `ptc-runtime-node`、`experimental-ptc-runtime-python` | 运行模型写的程序（程序化工具调用），绑定由宿主提供 |
| `sandbox` | `sandbox` | 单实现 | `sandbox-local`、`sandbox-ssh` | 进程沙箱：消费方交出将要 spawn 的 argv，后端按策略包装 |
| `sessionPersistence` | `session-persistence` | 单实现 | `session-persistence-jsonl` | 会话事件日志的持久化 |
| `sessionQuery` | `session-query` | 单实现 | `session-query-sqlite` | 会话的精确读取、过滤、追踪与全文检索 |
| `sessionTelemetry` | `session-telemetry` | 单实现 | `session-telemetry-otel` | 会话遥测：采集、脱敏后交给一个后端 |
| `sessionTitle` | `session-title` | 注册表 | `session-title-first-prompt-llm`、`session-title-all-prompts-llm` | 会话标题：确定性回退 + 唯一的可选异步提供方 |
| `shell` | `shell` | 单实现 | `bash-local`、`bash-sandbox`、`pwsh-local` | 执行 shell 命令；每个上下文只能有一个实现，第二个报重复服务 |
| `skills` | `skill` | 注册表 | `sandbox-windows-acl`、`skill-badge`、`skill-filesystem`、`skill-office` | 合并各提供方的技能目录，分作用域登记 |
| `speechToText` | `experimental-speech-to-text`（实验） | 注册表 | `experimental-speech-to-text-sensevoice` | 语音识别提供方，按显式选择路由 |
| `spillStore` | `spill` | 单实现 | `spill-local` | 过大工具输出的落盘存储与取回提示 |
| `storage` | `storage` | 其他 | `storage-json`、`storage-sqlite` | 非会话数据存储枢纽，多个后端以不同名称并列 |
| `subagents` | `subagent` | 注册表 | `subagent-spawn-in-process`、`subagent-fork-in-process`、`subagent-acp`、`subagent-codex`、`subagent-claude-code`、`subagent-dsh-sdk` | 子智能体提供方：进程内派生或分叉、ACP、Codex、Claude Code、DSH SDK |
| `subprocess` | `subprocess` | 单实现 | `subprocess-local`、`subprocess-ssh` | 进程 spawn；bash、PTY、LSP、进程外子智能体都经它 |
| `terminals` | `terminal` | 注册表 | `terminal-bash` | 持久 PTY 终端会话 |
| `userQuestions` | `user-questions` | 注册表 | — | 向人提问的回答提供方，工具在 ask() 上挂起 |
| `web` | `web` | 注册表 | `web-search-exa`、`web-search-perplexity`、`web-search-deepseek`、`web-deepseek-api`、`web-fetch-http` | 搜索与抓取提供方；选择规则是显式配置，或恰好一个可用，多个即报歧义 |
| `workflowEngine` | `workflow` | 单实现 | `workflow-ptc` | 工作流脚本引擎，每个上下文一个 |
| `workingDirectory` | `working-directory` | 其他 | `working-directory` | 会话的有效执行目录（由会话投影持有） |
| `worktrees` | `experimental-worktree`（实验） | 其他 | `experimental-worktree` | 从固定提交创建 git worktree |

### 核心服务（core）：60 个（其中所属包为实验性的 6 个）

| ctx 键 | 所属包 | 用途 |
| --- | --- | --- |
| `agentDefaultModel` | `agent-default-model` | 默认模型选择（volatile 配置） |
| `agentPresets` | `agent-preset-registry` | 按会话的组合：YAML 声明的插件子树，Agent 绑定某个版本 |
| `agents` | `agent` | 活跃 Agent 句柄、创建与恢复工厂 |
| `agentTeams` | `experimental-agent-team`（实验） | Agent Teams：名册、收件箱、任务 DAG |
| `claudeCodeMods` | `experimental-claude-code-mods`（实验） | 把 Claude Code 模组当成 DSH 插件运行的桥 |
| `clientModules` | `client-modules` | 浏览器插件图的宿主端：扫描 `dsh.client`、组合启动图、提供合并脚本 |
| `commands` | `commands` | 面向人的斜杠命令注册表，不经模型 |
| `configEditor` | `config-editor` | 在文件锁与 HMR 队列下持久化写 profile patch |
| `connection` | `client-connection` | 浏览器认证与共享 HTTP 分发 |
| `cordisInspect` | `cordis-host-runner` | 运行时 API 检查注册表（供只读检查工具） |
| `credentialsController` | `api-settings-controller` | 凭据面的 Remote 控制器 |
| `cuaAccess` | `cua`（实验） | Computer Use 的应用授权 |
| `directoryPickerController` | `api-workspace-controller` | 选目录的 Remote 控制器 |
| `dynamicCordisRunner` | `cordis-host-runner` | 进程内动态 Cordis 定义：`node:vm` 求值、按会话、不持久 |
| `fileUploads` | `client-file-upload` | 上传文件的流式接收与暂存 |
| `goals` | `goal` | 同会话目标 |
| `headlessStartup` | `headless` | 无界面运行的任务与运行选项 |
| `hmr` | `hmr` | 模块与配置重载，所有修改共用一个队列 |
| `inspector` | `inspector`（实验） | 跨 realm 的运行时检查（CDP） |
| `jobController` | `api-job-controller` | 后台任务观测的 Remote 控制器 |
| `messageFeedback` | `message-feedback` | 逐条 assistant 消息反馈 |
| `officeToPdf` | `office-to-pdf` | Office 转 PDF |
| `permissionPresets` | `permission-presets` | 权限预设：把沙箱模式与审批策略打包 |
| `planMode` | `plan-mode` | 计划模式的状态与 `/plan` |
| `pluginManager` | `plugin-manager` | 当前 profile 的插件与组合包管理（与 CLI 共用 pnpm 操作） |
| `pluginMarket` | `plugin-market` | 读取并校验用户配置的市场索引 |
| `pluginRegistryProbe` | `client-ui-plugin-manager` | 比较各安装源的响应 |
| `profileContext` | `app-boot` | 启动器给的 profile 位置与组合输入（纯数据） |
| `remoteAccess` | `api-remote-access` | 非 owner 对端可调哪些 Remote 方法的访问控制 |
| `sandboxPolicy` | `sandbox-policy` | 部署默认沙箱模式与工作区根 |
| `schedule` | `schedule` | 定时消息 |
| `sessionController` | `api-session-controller` | 会话 Remote 控制器（命令、冷读、事件跟随、激活） |
| `sessionFeedback` | `command-feedback` | 会话级评价 |
| `sessionFileReferences` | `api-session-controller` | 按会话寻址的文件引用 Remote 适配 |
| `sessionProjectionCache` | `session-projection-cache` | 投影状态的持久检查点 |
| `sessionProjections` | `session-projection` | 会话投影单元注册表：纯同步折叠，框架驱动 |
| `sessionReferenceResolver` | `session-reference` | 跨会话快照引用 |
| `sessions` | `session` | 仅追加的会话存储与持久事件流 |
| `sessionSkillCatalog` | `api-session-controller` | 会话里用户可调用的技能目录 |
| `settings` | `settings` | 插件配置表单：投影 volatile 字段，编辑交给 config-editor |
| `settingsController` | `api-settings-controller` | 设置面的 Remote 控制器，读取一律脱敏 |
| `shellEnv` | `shell-env` | 受管的 `DSH_*` 环境事实 |
| `speechController` | `experimental-api-speech-to-text`（实验） | 语音转写 Remote |
| `ssh` | `ssh` | 一条已认证的 OpenSSH 连接及远端辅助程序 |
| `storageDomain` | `storage-domain` | 等所有存储后端就绪后发布领域数据设施 |
| `subagentModelSelection` | `tool-subagent` | 子智能体模型选择偏好 |
| `systemPrompt` | `system-prompt` | 系统提示词段落、动态上下文、工具 schema 的组装注册表 |
| `terminalController` | `api-terminal-controller` | 用户终端的 Remote 控制器 |
| `tokenMeter` | `token-meter` | 回放用的 token 计量 |
| `toolResultPruner` | `compaction-tool-result-pruner` | 无模型的过大工具结果裁剪 |
| `tools` | `tools` | 作用域化工具注册表、执行器选择、带守卫的执行流水线 |
| `typert` | `typert-registry` | 运行时类型注册表（生成的反射与 zod schema） |
| `typertGateway` | `api-gateway` | 把生成的 Remote 描述符接到实时服务的调用网关 |
| `webApp` | `web-app` | Web GUI 的对外地址 |
| `webhookRuntime` | `webhook`（实验） | webhook 规则运行时 |
| `webServer` | `host-webserver` | HTTP 路由注册与页面注入 |
| `workspaceChanges` | `workspace-changes` | 每轮改动文件摘要 |
| `workspaceController` | `api-workspace-controller` | Workspace 的 Remote 控制器 |
| `workspaceFiles` | `api-workspace-files` | 工作区文件的 Remote 服务 |
| `workspaceRegistry` | `workspace` | Workspace 实体注册 |

### 独立服务（service）：10 个（其中所属包为实验性的 7 个）

| ctx 键 | 所属包 | 用途 |
| --- | --- | --- |
| `actionCards` | `action-cards`（实验） | 可选的动作卡片 |
| `cotTranslation` | `experimental-client-ui-cot-translation`（实验） | 思考内容翻译 Remote |
| `forgePanel` | `experimental-client-ui-forge`（实验） | Forge 面板 Remote |
| `forgeSession` | `experimental-forge-session`（实验） | 会话与变更请求的绑定 |
| `liveshareShares` | `experimental-liveshare`（实验） | 分享管理 Remote |
| `otel` | `otel` | 共享的 OTel 上报通道 |
| `pluginRecommendations` | `plugin-recommendations`（实验） | 按需插件推荐，点了经插件管理器启用 |
| `productAnalytics` | `client-product-analytics` | 桌面交互采集 |
| `productTelemetry` | `host-product-telemetry-otel` | 产品使用事件发送 |
| `translator` | `experimental-translator`（实验） | 匿名文本翻译 |

### 组合包（bundle）：1 个（其中所属包为实验性的 0 个）

| ctx 键 | 所属包 | 用途 |
| --- | --- | --- |
| `agentLoop` | `agent-loop` | 唯一的具体回合循环驱动；扩展依赖 `dsh-agent` 的事件与服务，不依赖它 |

---

## ⑤ 复盘教训（`docs/postmortem/`）

DSH 一共 4 篇复盘。0001、0002 直接是插件机制的坑；0004 讲 seam 分层；0003 讲开发验收，与 HMR 有关。

### 0001：ACP 服务器一连接就崩——`export default` 丢掉了插件的 `inject`

文件：`docs/postmortem/0001-acp-default-export-drops-inject.zh.md`。

- **机制一**：插件同时有具名导出和 `export default apply`。Loader 的 `unwrapExports` 优先取 `.default`，拿到的是裸函数，`inject`、`name`、`Config` 全丢了，`apply` 在没有注入的 fiber 里运行，第一次读 `ctx.agents` 就抛错（第 27-54 行）〔一手〕。
- **机制二**：可选服务（不在 `inject` 里）用 `this.ctx.sessionPersistence` 读。经可追踪代理进来时，查找从提供方自己的 fiber 开始、只沿祖先方向走，兄弟分支提供的服务找不到。测试从插件 fiber 外部调用，走的是另一条直查全局 store 的路，所以没暴露（第 56-87 行）〔一手〕。
- **为什么漏掉**：178 个单元测试、100% 行覆盖，全是手搭 `ctx.plugin({...})`，从不经过 Loader 的导出处理，也不经过真实调用拓扑；唯一驱动 `session/new` 的测试要 API key，CI 跳过了，本地又读到陈旧的 `lib/`（第 89-98 行）〔一手〕。
- **防护**：删掉默认导出；可选服务一律 `ctx.get(name)`（写进 `packages/AGENTS.md:6`）；加不需要 key 的真实 stdio e2e；e2e 子进程设 `TSX_TSCONFIG_PATH`，保证跑的是源码；`docs/testing.md` 写进"测试真实入口路径"（第 100-106 行）〔一手〕。
- **教训原话要点**：命名空间插件和默认导出在 Loader 下互斥；手搭插件的测试验证不了插件怎么被加载；"相信跟踪结果，不要迷信理论"（第 108-113 行）〔一手〕。

对灵鲸〔推理〕：
- 我们 loader 只读 `mod.plugin`、出现默认导出就拒绝，已经吸收；
- 我们不给插件裸 cordis `ctx`，所以"可选服务读法"这个坑在门面层就不存在，但门面的 `services` 按 `inject` 收窄时，"读未声明的服务"要在类型和运行时都明确报错；
- 测试内核必须与 `startKernel` 走同一段 loader 代码，这一条已在设计里（§12 T10）。

### 0002：文件系统工具被一个字面量 `!!js` 永久禁用

文件：`docs/postmortem/0002-js-expression-disabled-filesystem-tools.zh.md`。

- **机制**：示例想用 `disabled: !!js ...` 按模式启用文件系统插件，但当时 Loader 只对 `config` 求值；`disabled` 拿到的是一个表达式**对象**，永远为真，文件系统栈在所有模式下都被禁用。YAML 标签语法合法，所以没有任何诊断（第 11-15、30-34 行）〔一手〕。
- **为什么漏掉**：快照刷新把 `UNKNOWN_TOOL` 结果当成新的预期输出接受了，"它证明的是回归的确定性回放，而非文件系统行为的正确性"（第 19、32-34 行）〔一手〕。
- **防护**：
  - 改用显式 overlay（`fs.cordis.yml`）；
  - 文档写明哪些字段求值；
  - `verify-cordis-config` 拒绝元数据里的表达式节点；
  - `session-snapshot` 拒绝把 `UNKNOWN_TOOL` 提交成预期（第 36-41 行）〔一手〕。
- **后续**：DSH 后来干脆让 `disabled` 也求值（`vendor/README.md:54`，本地补丁 18），现在是 `config` 和 `disabled` 两个字段求值，其余元数据保持字面量并由 CI 检查（`scripts/verify-cordis-config.ts:1-11,39`）〔一手〕。
- **教训**：语法上被接受的值不一定在那个位置被求值；快照刷新是产出 fixture，不是正确性审查；权限控制只能描述它实际管得到的能力（第 43-47 行）〔一手〕。

对灵鲸〔推理〕：
- profile 和 patch 的 schema 用 `strictObject`，未知字段直接拒绝，就不会有"写了但没生效"；
- 我们不打算在 profile 里放表达式，要条件组合就用显式的 profile 或 patch 层；
- 录放测试同样要有"语义不可能结果"的独立断言（例如引用了不存在的槽位实现）。

### 0004：Landlock 的部分强制通知把子进程失败误判成沙箱不可用

文件：`docs/postmortem/0004-landlock-partial-notice-misclassified-child-failures.zh.md`。

- 和插件机制相关的一条教训："适配器必须保留下层 seam 所拥有的结构化失败，而不能用自身最接近的通用类别将其替换"（第 54 行）〔一手〕。另外两条：共享前缀不是协议；平台相关行为要在原生边界放确定性的模拟实现（第 52-55 行）〔一手〕。
- 对灵鲸〔推理〕：槽位契约的错误类别要能原样穿过适配层（`LiwaError` 的类别不被上层改写），能力回退链里每一跳都要保留上一跳的失败原因。

### 0003：Web agent 验收了另一个服务器，不是承载它会话的 GUI

文件：`docs/postmortem/0003-web-agent-gui-feedback-loop.zh.md`。

- 和插件机制只是间接相关：改了 GUI 源码以后，"HTTP 就绪、构建成功和启动 manifest 是不同的事实"，验收必须指明确切的 origin，并从外部观察改动是否真在那里生效；替代服务证明不了已有页面变了（第 48-53 行）〔一手〕。
- 对灵鲸〔推理〕：以后做热重载或"装上一个就好一个"的验收时，要看真实在跑的本体（`liwa status` 报的装配哈希），不能只看构建产物。

---

## ⑥ 待实测

按对灵鲸的影响排序。

1. **我们钉的上游 cordis `4.0.0-rc.12` 有没有 DSH 的那些本地补丁的等价行为**。DSH 是 rc.7 加 24 处补丁，见 `vendor/README.md:35-65`。重点四项：
   - 补丁 6：重入释放与 `UNLOADING` 时拒绝新 effect；
   - 补丁 15：`config` 在注入就绪后惰性求值；
   - 补丁 18：`disabled` 求值；
   - 补丁 22：volatile 原地提交。

   DSH 自己的升级计划认为一部分已进 rc.11（`vendor/cordis-rc11-upgrade-plan.md`）。这决定"DSH 能做的我们照样能做"这句话成不成立。
2. **DSH 启动时某个 `apply` 卡住会怎样**。代码里没有超时（维度 5），预期整个启动挂住。用一个假插件验证，作为我们 20 秒启动时限的对照。
3. **DSH 运行中某个插件抛未处理异常会怎样**。预期整个进程 `exit(1)`（`index.ts:842-931`）。验证 web profile 下浏览器端的表现，以及桌面版的恢复对话框。
4. **服务依赖成环**。预期两边都停在 PENDING，启动审计列成"在等服务"。确认非 required 的环只出警告、不失败。
5. **HMR 替换失败后旧代码是否恢复**。`packages/boot/hmr/README.zh.md:77` 与 `:113` 说法相反，要分"共享运行时的模块替换"和"profile 重新组合"两条路径实测。
6. **agent preset 里的单实现 seam 换实现**。例如在某个 preset 的 `cordis:group` + `isolate` 里换一个 `shell` 提供方，看同一进程里两个会话是否真的用到不同实现，以及忘了放进 group 时的泄漏审计报错。
7. **`--dump-config` 会不会打印明文密钥**。在 patch 里写一个 `role('secret')` 字段的值试试。
8. **`--dump-config-schema` 导入模块的副作用**。确认它执行了哪些插件顶层代码，作为我们"`dump-config` 不导入业务代码"的对照。
9. **兼容预检绕过面**。确认用 `ctx.loader.create()` 加的行和 preset 行在 HMR 替换后不经检查（`hmr/README.zh.md:114`）。
10. **服务目录为什么不收 `pluginPackages`、`cmdlineArgs` 这类键**。看 `scripts/gen-cordis-catalog.ts` 的发现规则，确认 107 这个数的口径；顺带统计浏览器侧服务键的数量，补一张浏览器侧表。
11. **单实现与注册表的划分**。④里"约 17 / 约 15 / 4"是 grep 启发式，逐个读 36 个 Definition 确认。
