# 灵鲸默认组合之外的工作区包只读盘点

盘点日期：2026-11-02。底座：`liwa-dsh`（worktree），分支 `dsh-base`，HEAD `ad4e3c50b145ce8fa5a8a5ecdb722c9428742eeb`。灵鲸设计文档直接读取 `liwa:docs/` 工作区，包括未提交的 `architecture/four-layers.md`。本报告是供主人选择的盘点建议，不是已批准的裁剪或迁移方案。

**结论：共核对 387 个工作区包，默认组合及其依赖闭包内 273 个，闭包外 114 个。闭包外逐项评估 105 个：建议删 40 个、留 16 个、留待设计迁移方案时再定 49 个；另有 8 个决策 41 上报包和 1 个 Python SDK 运行时包按要求免评估。**

这里“闲置”严格指不被默认插件组合选择、也不被这些插件依赖，并不等于无调用者或可立刻删除。三个应用入口 `@liwa/cli`、`@liwa/desktop`、`@liwa/desktop-host` 也会落在这个插件图之外，故按要求列入逐项核对并明确建议留；它们仍有真实产品用途。构建与测试支持同理。Windows/Linux 专用的 4 个包另列专节，当前都被跨平台依赖拉入默认闭包，不计入上述闲置数。

## 1. 口径、边界和可复核依据

### 1.1 默认组合与依赖展开

| 随附 profile | 组合层 |
| --- | --- |
| `acp` | `@liwa/base` → `@liwa/acp-app` |
| `web` | `@liwa/base` → `@liwa/web-app` |
| `headless` | `@liwa/base` → `@liwa/headless` |
| `sdk` | `@liwa/base` → `@liwa/sdk-app` |
| `sdk-minimal` | `@liwa/sdk-minimal` |

〔一手〕模板来自 [packages/util/official-bundles/src/bundles.ts:10](dsh-base:packages/util/official-bundles/src/bundles.ts:10)。解析与合并调用仓库原有的 `loadOverlayPatches`、`bundlePatchPaths`、`composeEntries`，与 [scripts/default-composition-reporting.spec.ts:51](dsh-base:scripts/default-composition-reporting.spec.ts:51)、[scripts/optional-bundles.spec.ts:28](dsh-base:scripts/optional-bundles.spec.ts:28) 的做法一致；读取 bundle 声明中的全部 patch（含 preset patch），遍历 group 与 preset 内部条目。字面量 `disabled: true` 不作为启用根；`!!js` 只解析成表达式节点，不求值、不激活任何插件。

依赖闭包按工作区包名追踪 `dependencies`、`optionalDependencies`、`peerDependencies`，包括可选 peer；`devDependencies` 只列为调用关系，不因测试依赖把整个开发工具链算进默认产品。为避免网页把运行时代码放在开发依赖中而漏报，另调用仓库 [scripts/verify-product-use.ts:59](dsh-base:scripts/verify-product-use.ts:59) 的纯静态源码分析函数，读取其默认入口实际追踪到的包，再对这些包补依赖闭包；未运行它的命令行检查入口或任何测试。该函数额外检查 CLI、桌面主进程和网页入口，本报告把 CLI/Electron 入口单独列在应用项，不把其为分发而携带的所有依赖都提升成默认插件根。

〔一手〕YAML 得到 189 个已声明且未字面禁用、完全匹配工作区名的包名，连同 6 个默认 bundle 根，清单依赖闭包为 263 个；补入实际入口的源码引用后为 273 个。这是偏保守的包级口径：静态类型/peer 依赖、跨平台可选依赖也会保留；“在闭包内”不表示该插件运行或发送了数据。比如决策 41 的 `deepseek-llm-api-extensions` 仍有被导入的注册表接口，不能据此说默认上传。

不把 CLI 的依赖清单直接当默认组合，是因为 [apps/cli/package.json:41](dsh-base:apps/cli/package.json:41) 明确携带可选包，[packages/util/official-bundles/src/bundles.ts:55](dsh-base:packages/util/official-bundles/src/bundles.ts:55) 又明确把它们放在默认关闭的可选列表。否则大部分可选能力都会被错误归入“默认已用”。相反，`client-store`、`client-ui-primitives`、`client-ui-slots`、`client-ui-dockkit`、`client-web` 与 `util-file-drag` 有网页实际源码用途，不列为闲置。

### 1.2 规模与调用关系

文件数＝`git ls-files` 中该包拥有的版本控制文件数，包含测试、文档、配置、图片与源码，排除 `lib/dist/build/target/node_modules` 产物；嵌套工作区包的文件归子包，不在 `native/system` 重复计数。非测试代码行数＝TS/JS、Python、C/C++、Swift、Shell、CSS/HTML 等代码中去掉测试/fixture/快照、生成产物、`.d.ts`、空行和注释后的物理行数；TS/JS 用 TypeScript scanner 去掉注释，其他语言用逐行过滤，故混合语言是近似数。YAML/JSON 配置、Markdown 技能提示词和图片不计代码行，所以纯组合包常只有 1–3 行代码，不表示没有配置。包内示例程序计入；基准程序本身不是产品运行时，另列用途。

每个包的“谁依赖”区分直接依赖、可选依赖、peer 与开发/测试依赖；包名链接到调用方清单中对应的行。没有进入任一默认根的反向依赖，只说明删包时要一起改调用方，不会让它自动成为默认能力。另核对可选 bundle、按需 bundle、源码 overlay 和示例组合；普通 README 手工挂载不当作已启用。

### 1.3 设计判断的依据

〔一手〕本报告依据主人工作区里的产品与设计原文，链接带节号与文件行号；〔推理〕把这些需求与某个底座包对接、决定删留，是本次盘点的判断，不表示设计文档已经点名批准复用该包。继承底座 README 只证明包的现有行为，不作为灵鲸产品决策。

〔一手〕决策 2 规定统一大脑契约，决策 36 规定 fork 后独立、能用的插件留、不能用的原位替换，继承 agent 仍是大脑提供方之一；决策 41 只留模型调用、上报另裁；决策 44 规定 Apple 芯片 Mac 本机打包、无 DeepSeek 账号登录。分别见 [handoff.md 决策 2](liwa:docs/liwa/handoff.md:118)、[决策 36](liwa:docs/liwa/handoff.md:152)、[决策 41](liwa:docs/liwa/handoff.md:157)、[决策 44](liwa:docs/liwa/handoff.md:160)。

〔一手〕产品 §8.2 要求以她为中心的主控台与开发者视图；画像《她在不同地方的样子》要求换平台、换大脑还是同一个她；四层稿 §4 明确现有外部 subagent 是一次性委派；05 记忆 §0/§4.4 要求带来源和受众的混合召回；06 成长 §4.3/§4.6 要求稳定人设与做法账本。00 插件底座 §16 明确 CLI 自己拉 MCP、无市场、无模型自改插件。这些是下文“同名但不是同一概念”的判断依据。02 用脑和 06 成长仍标草稿，报告没有把草稿的具体实现细节当作已确认裁剪命令。

## 2. 按建议与类别汇总

| 类别 | 包数 | 删 | 留 | 待定 | 非测试代码行 |
| --- | --- | --- | --- | --- | --- |
| 应用入口与文档站 | 4 | 0 | 3 | 1 | 11,946 |
| 开发工具和检查器 | 17 | 2 | 13 | 2 | 44,979 |
| 接入协议与外部大脑 | 15 | 7 | 0 | 8 | 11,344 |
| 浏览器、桌面操作与感知 | 11 | 3 | 0 | 8 | 8,114 |
| 语音输入与能力插件 | 5 | 0 | 0 | 5 | 2,818 |
| 可选编排、任务与工作区 | 17 | 2 | 0 | 15 | 15,860 |
| 查询、记忆与存储候选 | 3 | 0 | 0 | 3 | 1,655 |
| 插件市场、推广与自动创建页面 | 12 | 12 | 0 | 0 | 5,926 |
| SSH 远端执行 | 5 | 0 | 0 | 5 | 1,704 |
| 其他实验与替代实现 | 16 | 14 | 0 | 2 | 34,915 |
| 合计 | 105 | 40 | 16 | 49 | 139,261 |

“删”表示建议主人在后续裁剪任务中选掉，包含清理清单依赖、组合选择、示例和检查引用；本报告没有执行任何裁剪。“留”多为当前仍用的入口、开发工具和只读展示；“待定”不是要求现在写迁移方案。

## 3. 应用入口与文档站

总体建议：保留三个现用应用入口；文档站等文档迁移范围确定后再定。入口天然不作为插件被自己挂载，不能从“闭包外”直接推导删除。

### `@liwa/cli`

- **路径与规模**：[apps/cli](dsh-base:apps/cli)；192 个文件，9 个非测试代码文件，**819 行非测试代码**。
- **做什么**：用户敲 liwa 时进入的总开关，解析命令并启动指定组合。〔一手〕[apps/cli/README.zh.md:20](dsh-base:apps/cli/README.zh.md:20)。
- **谁依赖**：直接依赖：[@liwa/desktop-host](dsh-base:apps/desktop-host/package.json:17)、[@liwa/sdk-client](dsh-base:packages/sdk/client/package.json:29)、[liwa-python-runtime-closure](dsh-base:python/sdk-runtime/package.json:14)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-commands.md §0–§1 命令机制与边界（行 5）](liwa:docs/liwa/architecture/modules/00-commands.md:5)。〔推理〕设计明确保留 liwa 命令入口；本包负责启动 profile，是入口而非被组合挂载的插件。
- **建议：留**。〔推理〕当前启动链仍需要它，闭包外不等于没有用途。

### `@liwa/desktop`

- **路径与规模**：[apps/desktop](dsh-base:apps/desktop)；246 个文件，99 个非测试代码文件，**8,555 行非测试代码**。
- **做什么**：把网页工作台装进 Mac 窗口，处理托盘、菜单、窗口和本机集成。〔一手〕[apps/desktop/README.zh.md:11](dsh-base:apps/desktop/README.zh.md:11)。
- **谁依赖**：脚本/路径调用：仓库根桌面启动与打包命令（[package.json:32](dsh-base:package.json:32)）。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §3.1 进程模型、§10 主控台与多端（行 326）](liwa:docs/liwa/architecture/overall.md:326)。〔推理〕设计明确使用 Electron 薄壳和本机主控台；这两包分别承担桌面壳与其 Node 后台。
- **建议：留**。〔推理〕决策 44 刚确定继续本机打包，当前桌面链路需要它。

### `@liwa/desktop-host`

- **路径与规模**：[apps/desktop-host](dsh-base:apps/desktop-host)；18 个文件，10 个非测试代码文件，**395 行非测试代码**。
- **做什么**：在 Electron 的 Node 子进程里启动网页后台，把就绪地址和关闭结果交给桌面壳。〔一手〕[apps/desktop-host/package.json:2](dsh-base:apps/desktop-host/package.json:2)。
- **谁依赖**：脚本/路径调用：桌面壳按路径拉起 Host 子进程（[apps/desktop/src/host-process.ts:171](dsh-base:apps/desktop/src/host-process.ts:171)）；脚本/路径调用：本地桌面打包收集 Host 包（[apps/desktop/scripts/package-target.ts:139](dsh-base:apps/desktop/scripts/package-target.ts:139)）。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §3.1 进程模型、§10 主控台与多端（行 326）](liwa:docs/liwa/architecture/overall.md:326)。〔推理〕设计明确使用 Electron 薄壳和本机主控台；这两包分别承担桌面壳与其 Node 后台。
- **建议：留**。〔推理〕决策 44 刚确定继续本机打包，当前桌面链路需要它。

### `@liwa/website`

- **路径与规模**：[website](dsh-base:website)；37 个文件，15 个非测试代码文件，**2,177 行非测试代码**。
- **做什么**：把仓库文档生成为可浏览、搜索并显示图表的文档网站。〔一手〕[website/package.json:2](dsh-base:website/package.json:2)。
- **谁依赖**：脚本/路径调用：仓库根文档构建与预览命令（[package.json:120](dsh-base:package.json:120)）。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §1.1 硬约束（行 129）](liwa:docs/liwa/architecture/overall.md:129)。〔推理〕设计需要项目文档；现有站点服务的是继承底座的文档，尚未确定是否沿用这套站点。
- **建议：留待设计迁移方案时再定**。〔推理〕源码说明仍有参考价值，等灵鲸文档入口和替换范围确定后再裁站点。

## 4. 开发工具和检查器

总体建议：保留现有构建、测试与回放工具；只读统计与会话检查可留，完整 CDP 调试中心待定；两份无人选择的 vendor 辅助插件可删。

### `@liwa/benchmarks`

- **路径与规模**：[benchmarks](dsh-base:benchmarks)；48 个文件，27 个非测试代码文件，**3,739 行非测试代码**。
- **做什么**：集中放 agent、会话与网页性能基准程序及所需依赖。〔一手〕[benchmarks/package.json:2](dsh-base:benchmarks/package.json:2)。
- **谁依赖**：脚本/路径调用：仓库根基准构建命令（[package.json:24](dsh-base:package.json:24)）。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §14 可观察、可回放、可验收（行 1412）](liwa:docs/liwa/architecture/overall.md:1412)。〔推理〕设计明确要求回放、模型调用录制重放与回归；这些是开发工具，不应出现在产品默认组合里。
- **建议：留**。〔推理〕现有测试和改造期验证仍依赖它，不能按未挂载就删除。

### `@liwa/node-addon-system-workspace`

- **路径与规模**：[native/system](dsh-base:native/system)；42 个文件，12 个非测试代码文件，**790 行非测试代码**。
- **做什么**：管理本仓库自带原生组件的编译、打包和验证脚本。〔一手〕[native/system/README.zh.md:11](dsh-base:native/system/README.zh.md:11)。
- **谁依赖**：脚本/路径调用：仓库根原生组件构建命令（[package.json:24](dsh-base:package.json:24)）。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 handoff.md 已定的决策 44：仅 Apple 芯片 Mac、本机打包，SSH helper 留删待裁剪（行 160）](liwa:docs/liwa/handoff.md:160)。〔推理〕只跑 Apple 芯片 Mac 仍需要 POSIX 会话写锁；这个工作区包拥有共享原生组件的构建与核对脚本。
- **建议：留**。〔推理〕它不只是 Linux 沙箱工程，Mac 的 flock 组件也在这里维护。

### `@liwa/experimental-client-ui-stats`

- **路径与规模**：[packages/experimental/client-ui-stats](dsh-base:packages/experimental/client-ui-stats)；36 个文件，17 个非测试代码文件，**6,498 行非测试代码**。
- **做什么**：按轮次和步骤显示 token、缓存命中、延迟及工具耗时。〔一手〕[packages/experimental/client-ui-stats/README.zh.md:12](dsh-base:packages/experimental/client-ui-stats/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-inspector-profile](dsh-base:packages/experimental/inspector-profile/package.json:44)。
- **组合或预设**：可选挂载：`@liwa/experimental-inspector-profile`。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.2 主控台与开发者视图（行 433）](liwa:docs/liwa/product.md:433)。〔推理〕产品明确要开发者视图、日志搜索、用量与花费；这些只读展示与目标直接相关。
- **建议：留**。〔推理〕保留已有可读数据的界面，迁移时改接灵鲸的事件来源。

### `@liwa/experimental-inspector`

- **路径与规模**：[packages/experimental/inspector](dsh-base:packages/experimental/inspector)；218 个文件，162 个非测试代码文件，**13,721 行非测试代码**。
- **做什么**：把后台和浏览器接到 Chrome 调试协议，查看源码、控制台、请求和插件树。〔一手〕[packages/experimental/inspector/README.zh.md:12](dsh-base:packages/experimental/inspector/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-inspector-profile](dsh-base:packages/experimental/inspector-profile/package.json:42)。
- **组合或预设**：可选挂载：`@liwa/experimental-inspector-profile`；也可用自己的 cordis.source.patch.yml 源码调试 overlay。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.2 主控台与开发者视图（行 433）](liwa:docs/liwa/product.md:433)。〔推理〕开发者视图有明确需求，但完整 CDP 调试中心和它的组合包不等于设计要求的日志视图。
- **建议：留待设计迁移方案时再定**。〔推理〕先确定是否需要跨 Host 与浏览器的完整调试能力，再决定是否保留这套大实现。

### `@liwa/experimental-inspector-profile`

- **路径与规模**：[packages/experimental/inspector-profile](dsh-base:packages/experimental/inspector-profile)；21 个文件，1 个非测试代码文件，**1 行非测试代码**。
- **做什么**：一次启用会话检查器、CDP 调试中心和统计页的可选组合包。〔一手〕[packages/experimental/inspector-profile/README.zh.md:12](dsh-base:packages/experimental/inspector-profile/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:42)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.2 主控台与开发者视图（行 433）](liwa:docs/liwa/product.md:433)。〔推理〕开发者视图有明确需求，但完整 CDP 调试中心和它的组合包不等于设计要求的日志视图。
- **建议：留待设计迁移方案时再定**。〔推理〕先确定是否需要跨 Host 与浏览器的完整调试能力，再决定是否保留这套大实现。

### `@liwa/experimental-session-inspector`

- **路径与规模**：[packages/experimental/session-inspector](dsh-base:packages/experimental/session-inspector)；72 个文件，30 个非测试代码文件，**2,818 行非测试代码**。
- **做什么**：在侧栏查看原始会话事件、聊天节点和它们之间的关系。〔一手〕[packages/experimental/session-inspector/README.zh.md:12](dsh-base:packages/experimental/session-inspector/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-inspector-profile](dsh-base:packages/experimental/inspector-profile/package.json:43)。
- **组合或预设**：可选挂载：`@liwa/experimental-inspector-profile`。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.2 主控台与开发者视图（行 433）](liwa:docs/liwa/product.md:433)。〔推理〕产品明确要开发者视图、日志搜索、用量与花费；这些只读展示与目标直接相关。
- **建议：留**。〔推理〕保留已有可读数据的界面，迁移时改接灵鲸的事件来源。

### `@liwa/agent-loop-testkit`

- **路径与规模**：[packages/test-support/agent-loop-testkit](dsh-base:packages/test-support/agent-loop-testkit)；10 个文件，4 个非测试代码文件，**132 行非测试代码**。
- **做什么**：帮测试搭好真实 agent 循环和收件箱，省去每个测试重复搭环境。〔一手〕[packages/test-support/agent-loop-testkit/README.zh.md:12](dsh-base:packages/test-support/agent-loop-testkit/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:126)、[@liwa/benchmarks](dsh-base:benchmarks/package.json:16)、[@liwa/acp](dsh-base:packages/acp/acp/package.json:56)、[@liwa/api-session-controller](dsh-base:packages/api/session-controller/package.json:126)、[@liwa/headless](dsh-base:packages/bundle/headless/package.json:71)、[@liwa/compaction-basic](dsh-base:packages/compaction/compaction-basic/package.json:56)、[@liwa/compaction-image-offload](dsh-base:packages/compaction/compaction-image-offload/package.json:46)、[@liwa/agent-instructions](dsh-base:packages/context/agent-instructions/package.json:50)、[@liwa/liwa-dev-context](dsh-base:packages/context/liwa-dev-context/package.json:44)、[@liwa/time-context](dsh-base:packages/context/time-context/package.json:48)、[@liwa/tmux-context](dsh-base:packages/context/tmux-context/package.json:44)、[@liwa/tool-executor-ptc](dsh-base:packages/core/tool-executor-ptc/package.json:61)、[@liwa/tools](dsh-base:packages/core/tools/package.json:67)、[@liwa/tool-present](dsh-base:packages/deliverables/tool-present/package.json:59)、[@liwa/workspace-changes](dsh-base:packages/deliverables/workspace-changes/package.json:60)、[@liwa/action-cards](dsh-base:packages/experimental/action-cards/package.json:52)、[@liwa/experimental-agent-team](dsh-base:packages/experimental/agent-team/package.json:58)、[@liwa/experimental-auto-review](dsh-base:packages/experimental/auto-review/package.json:50)、[@liwa/experimental-browser-use-runtime](dsh-base:packages/experimental/browser-use-runtime/package.json:57)、[@liwa/experimental-browser-use-stagehand-native](dsh-base:packages/experimental/browser-use-stagehand-native/package.json:59)、[@liwa/experimental-claude-code-mods](dsh-base:packages/experimental/claude-code-mods/package.json:81)、[@liwa/experimental-client-ui-cot-translation](dsh-base:packages/experimental/client-ui-cot-translation/package.json:86)、[@liwa/experimental-client-ui-forge](dsh-base:packages/experimental/client-ui-forge/package.json:77)、[@liwa/experimental-computer-use-cua-driver-native](dsh-base:packages/experimental/computer-use-cua-driver-native/package.json:49)、[@liwa/experimental-cua-macos](dsh-base:packages/experimental/cua-macos/package.json:62)、[@liwa/cua](dsh-base:packages/experimental/cua/package.json:95)、[@liwa/hooks-claude-code](dsh-base:packages/experimental/hooks-claude-code/package.json:47)、[@liwa/hooks-codex](dsh-base:packages/experimental/hooks-codex/package.json:46)、[@liwa/experimental-liveshare](dsh-base:packages/experimental/liveshare/package.json:82)、[@liwa/experimental-subagent-oar](dsh-base:packages/experimental/subagent-oar/package.json:69)、[@liwa/experimental-tool-agent-team](dsh-base:packages/experimental/tool-agent-team/package.json:45)、[@liwa/tool-ralph](dsh-base:packages/experimental/tool-ralph/package.json:47)、[@liwa/experimental-tool-subagent-oar](dsh-base:packages/experimental/tool-subagent-oar/package.json:42)、[@liwa/tool-terminal](dsh-base:packages/experimental/tool-terminal/package.json:49)、[@liwa/experimental-tool-worktree](dsh-base:packages/experimental/tool-worktree/package.json:45)、[@liwa/experimental-worktree](dsh-base:packages/experimental/worktree/package.json:47)、[@liwa/command-feedback](dsh-base:packages/feedback/command-feedback/package.json:62)、[@liwa/tool-fs-search](dsh-base:packages/fs/tool-fs-search/package.json:63)、[@liwa/tool-fs](dsh-base:packages/fs/tool-fs/package.json:52)、[@liwa/tool-str-replace-editor](dsh-base:packages/fs/tool-str-replace-editor/package.json:43)、[@liwa/command-goal](dsh-base:packages/goal/command-goal/package.json:41)、[@liwa/goal-round-driver](dsh-base:packages/goal/goal-round-driver/package.json:42)、[@liwa/goal](dsh-base:packages/goal/goal/package.json:69)、[@liwa/tool-goal](dsh-base:packages/goal/tool-goal/package.json:46)、[@liwa/repeat-tool-reminder](dsh-base:packages/guard/repeat-tool-reminder/package.json:42)、[@liwa/permission-presets](dsh-base:packages/interaction/permission-presets/package.json:80)、[@liwa/jobs-local](dsh-base:packages/jobs/jobs-local/package.json:45)、[@liwa/llm-pi-ai](dsh-base:packages/llm/llm-pi-ai/package.json:51)、[@liwa/llm-retry](dsh-base:packages/llm/llm-retry/package.json:54)、[@liwa/tool-lsp](dsh-base:packages/lsp/tool-lsp/package.json:60)、[@liwa/plan-mode](dsh-base:packages/plan/plan-mode/package.json:75)、[@liwa/schedule](dsh-base:packages/schedule/schedule/package.json:73)、[@liwa/sdk-jsonrpc-server](dsh-base:packages/sdk/server/package.json:55)、[@liwa/session-checkpoint-policy](dsh-base:packages/session/session-checkpoint-policy/package.json:44)、[@liwa/tool-working-directory](dsh-base:packages/session/tool-working-directory/package.json:40)、[@liwa/working-directory](dsh-base:packages/session/working-directory/package.json:50)、[@liwa/tool-bash-persistent](dsh-base:packages/shell/tool-bash-persistent/package.json:46)、[@liwa/tool-bash](dsh-base:packages/shell/tool-bash/package.json:52)、[@liwa/tool-pwsh-persistent](dsh-base:packages/shell/tool-pwsh-persistent/package.json:46)、[@liwa/tool-pwsh](dsh-base:packages/shell/tool-pwsh/package.json:52)、[@liwa/tool-skill](dsh-base:packages/skill/tool-skill/package.json:44)、[@liwa/spill-policy](dsh-base:packages/spill/spill-policy/package.json:77)、[@liwa/subagent-claude-code](dsh-base:packages/subagent/subagent-claude-code/package.json:73)、[@liwa/subagent-fork-in-process](dsh-base:packages/subagent/subagent-fork-in-process/package.json:44)、[@liwa/subagent-spawn-in-process](dsh-base:packages/subagent/subagent-spawn-in-process/package.json:42)、[@liwa/subagent](dsh-base:packages/subagent/subagent/package.json:131)、[@liwa/tool-subagent-control](dsh-base:packages/subagent/tool-subagent-control/package.json:43)、[@liwa/terminal-bash](dsh-base:packages/terminal/terminal-bash/package.json:49)、[@liwa/terminal](dsh-base:packages/terminal/terminal/package.json:38)、[@liwa/tool-todo](dsh-base:packages/todo/tool-todo/package.json:52)、[@liwa/tool-workflow](dsh-base:packages/workflow/tool-workflow/package.json:52)、[@liwa/workflow-ptc](dsh-base:packages/workflow/workflow-ptc/package.json:54)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §14 可观察、可回放、可验收（行 1412）](liwa:docs/liwa/architecture/overall.md:1412)。〔推理〕设计明确要求回放、模型调用录制重放与回归；这些是开发工具，不应出现在产品默认组合里。
- **建议：留**。〔推理〕现有测试和改造期验证仍依赖它，不能按未挂载就删除。

### `@liwa/client-test-runtime`

- **路径与规模**：[packages/test-support/client-runtime](dsh-base:packages/test-support/client-runtime)；38 个文件，19 个非测试代码文件，**2,183 行非测试代码**。
- **做什么**：在模拟浏览器里启动网页插件，检查界面、重连、卸载和清理。〔一手〕[packages/test-support/client-runtime/README.zh.md:12](dsh-base:packages/test-support/client-runtime/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:38)、[@liwa/api-session-controller](dsh-base:packages/api/session-controller/package.json:134)、[@liwa/api-workspace-controller](dsh-base:packages/api/workspace-controller/package.json:95)、[@liwa/client-locale](dsh-base:packages/client/locale/package.json:49)、[@liwa/client-resources](dsh-base:packages/client/resources/package.json:48)、[@liwa/client-shortcuts](dsh-base:packages/client/shortcuts/package.json:55)、[@liwa/client-ui-agent-preset](dsh-base:packages/client/ui-agent-preset/package.json:61)、[@liwa/client-ui-commands](dsh-base:packages/client/ui-commands/package.json:52)、[@liwa/client-ui-conversation](dsh-base:packages/client/ui-conversation/package.json:65)、[@liwa/client-ui-deliverables](dsh-base:packages/client/ui-deliverables/package.json:58)、[@liwa/client-ui-directory-picker-browse](dsh-base:packages/client/ui-directory-picker-browse/package.json:51)、[@liwa/client-ui-directory-picker-native](dsh-base:packages/client/ui-directory-picker-native/package.json:48)、[@liwa/client-ui-entry-customization](dsh-base:packages/client/ui-entry-customization/package.json:37)、[@liwa/client-ui-file-drag](dsh-base:packages/client/ui-file-drag/package.json:53)、[@liwa/client-ui-goal](dsh-base:packages/client/ui-goal/package.json:55)、[@liwa/client-ui-input-trigger](dsh-base:packages/client/ui-input-trigger/package.json:52)、[@liwa/client-ui-jobs](dsh-base:packages/client/ui-jobs/package.json:41)、[@liwa/client-ui-message-feedback](dsh-base:packages/client/ui-message-feedback/package.json:53)、[@liwa/client-ui-model-selection](dsh-base:packages/client/ui-model-selection/package.json:53)、[@liwa/client-ui-open-in-app](dsh-base:packages/client/ui-open-in-app/package.json:67)、[@liwa/client-ui-permission-presets](dsh-base:packages/client/ui-permission-presets/package.json:59)、[@liwa/client-ui-plan](dsh-base:packages/client/ui-plan/package.json:56)、[@liwa/client-ui-plugin-manager](dsh-base:packages/client/ui-plugin-manager/package.json:62)、[@liwa/client-ui-plugin-market](dsh-base:packages/client/ui-plugin-market/package.json:52)、[@liwa/client-ui-reference](dsh-base:packages/client/ui-reference/package.json:57)、[@liwa/client-ui-renderer](dsh-base:packages/client/ui-renderer/package.json:45)、[@liwa/client-ui-schedule](dsh-base:packages/client/ui-schedule/package.json:63)、[@liwa/client-ui-secret-mask](dsh-base:packages/client/ui-secret-mask/package.json:50)、[@liwa/client-ui-session](dsh-base:packages/client/ui-session/package.json:54)、[@liwa/client-ui-settings-agent-loop](dsh-base:packages/client/ui-settings-agent-loop/package.json:52)、[@liwa/client-ui-settings-general](dsh-base:packages/client/ui-settings-general/package.json:64)、[@liwa/client-ui-settings-models](dsh-base:packages/client/ui-settings-models/package.json:52)、[@liwa/client-ui-settings-plugin-inventory](dsh-base:packages/client/ui-settings-plugin-inventory/package.json:52)、[@liwa/client-ui-settings-plugins](dsh-base:packages/client/ui-settings-plugins/package.json:49)、[@liwa/client-ui-settings-session-log](dsh-base:packages/client/ui-settings-session-log/package.json:52)、[@liwa/client-ui-settings-shell](dsh-base:packages/client/ui-settings-shell/package.json:52)、[@liwa/client-ui-settings-subagent](dsh-base:packages/client/ui-settings-subagent/package.json:53)、[@liwa/client-ui-settings-web-search](dsh-base:packages/client/ui-settings-web-search/package.json:53)、[@liwa/client-ui-settings](dsh-base:packages/client/ui-settings/package.json:49)、[@liwa/client-ui-shortcuts](dsh-base:packages/client/ui-shortcuts/package.json:61)、[@liwa/client-ui-sidebar-documentpreview](dsh-base:packages/client/ui-sidebar-documentpreview/package.json:62)、[@liwa/client-ui-sidebar-files](dsh-base:packages/client/ui-sidebar-files/package.json:55)、[@liwa/client-ui-sidebar-right](dsh-base:packages/client/ui-sidebar-right/package.json:56)、[@liwa/client-ui-sidebar-terminal](dsh-base:packages/client/ui-sidebar-terminal/package.json:54)、[@liwa/client-ui-sidebar](dsh-base:packages/client/ui-sidebar/package.json:55)、[@liwa/client-ui-skill](dsh-base:packages/client/ui-skill/package.json:57)、[@liwa/client-ui-subagent](dsh-base:packages/client/ui-subagent/package.json:56)、[@liwa/client-ui-theme](dsh-base:packages/client/ui-theme/package.json:54)、[@liwa/client-ui-tool](dsh-base:packages/client/ui-tool/package.json:66)、[@liwa/client-ui-trajectory](dsh-base:packages/client/ui-trajectory/package.json:63)、[@liwa/client-ui-workflow-run](dsh-base:packages/client/ui-workflow-run/package.json:61)、[@liwa/client-ui-workspace](dsh-base:packages/client/ui-workspace/package.json:67)、[@liwa/client-ui-action-cards](dsh-base:packages/experimental/client-ui-action-cards/package.json:63)、[@liwa/experimental-client-ui-agent-team](dsh-base:packages/experimental/client-ui-agent-team/package.json:53)、[@liwa/experimental-client-ui-claude-code-mods](dsh-base:packages/experimental/client-ui-claude-code-mods/package.json:60)、[@liwa/experimental-client-ui-cot-translation](dsh-base:packages/experimental/client-ui-cot-translation/package.json:73)、[@liwa/client-ui-creation-recommendations](dsh-base:packages/experimental/client-ui-creation-recommendations/package.json:54)、[@liwa/experimental-client-ui-forge](dsh-base:packages/experimental/client-ui-forge/package.json:82)、[@liwa/client-ui-plugin-recommendations](dsh-base:packages/experimental/client-ui-plugin-recommendations/package.json:61)、[@liwa/experimental-client-ui-stats](dsh-base:packages/experimental/client-ui-stats/package.json:54)、[@liwa/experimental-client-ui-voice-input](dsh-base:packages/experimental/client-ui-voice-input/package.json:54)、[@liwa/cua](dsh-base:packages/experimental/cua/package.json:129)、[@liwa/experimental-inspector](dsh-base:packages/experimental/inspector/package.json:62)、[@liwa/experimental-liveshare](dsh-base:packages/experimental/liveshare/package.json:97)、[@liwa/experimental-session-inspector](dsh-base:packages/experimental/session-inspector/package.json:56)、[@liwa/message-quotes](dsh-base:packages/session/message-quotes/package.json:49)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §14 可观察、可回放、可验收（行 1412）](liwa:docs/liwa/architecture/overall.md:1412)。〔推理〕设计明确要求回放、模型调用录制重放与回归；这些是开发工具，不应出现在产品默认组合里。
- **建议：留**。〔推理〕现有测试和改造期验证仍依赖它，不能按未挂载就删除。

### `@liwa/llm-mock-server`

- **路径与规模**：[packages/test-support/llm-mock-server](dsh-base:packages/test-support/llm-mock-server)；11 个文件，4 个非测试代码文件，**932 行非测试代码**。
- **做什么**：伪装成模型服务器，在本地制造成功、限流、断流等情况给测试使用。〔一手〕[packages/test-support/llm-mock-server/README.zh.md:12](dsh-base:packages/test-support/llm-mock-server/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:141)、[@liwa/web-frontend](dsh-base:apps/web/package.json:37)、[@liwa/llm-retry](dsh-base:packages/llm/llm-retry/package.json:58)、[@liwa/session-log-deepseek](dsh-base:packages/session/session-log-deepseek/package.json:55)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §14 可观察、可回放、可验收（行 1412）](liwa:docs/liwa/architecture/overall.md:1412)。〔推理〕设计明确要求回放、模型调用录制重放与回归；这些是开发工具，不应出现在产品默认组合里。
- **建议：留**。〔推理〕现有测试和改造期验证仍依赖它，不能按未挂载就删除。

### `@liwa/llm-replay`

- **路径与规模**：[packages/test-support/llm-replay](dsh-base:packages/test-support/llm-replay)；9 个文件，1 个非测试代码文件，**1,209 行非测试代码**。
- **做什么**：把录下来的模型回答重新播放给真实 agent 循环，测试时无需调用模型。〔一手〕[packages/test-support/llm-replay/README.zh.md:12](dsh-base:packages/test-support/llm-replay/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/session-snapshot](dsh-base:packages/test-support/session-snapshot/package.json:32)；开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:143)、[@liwa/benchmarks](dsh-base:benchmarks/package.json:12)；仓库根 开发/测试依赖（[package.json:222](dsh-base:package.json:222)）。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §14 可观察、可回放、可验收（行 1412）](liwa:docs/liwa/architecture/overall.md:1412)。〔推理〕设计明确要求回放、模型调用录制重放与回归；这些是开发工具，不应出现在产品默认组合里。
- **建议：留**。〔推理〕现有测试和改造期验证仍依赖它，不能按未挂载就删除。

### `@liwa/loader-smoke`

- **路径与规模**：[packages/test-support/loader-smoke](dsh-base:packages/test-support/loader-smoke)；16 个文件，2 个非测试代码文件，**331 行非测试代码**。
- **做什么**：用真实插件加载器启动测试组合，检查能否完成一轮并正确退出。〔一手〕[packages/test-support/loader-smoke/README.zh.md:12](dsh-base:packages/test-support/loader-smoke/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/session-snapshot](dsh-base:packages/test-support/session-snapshot/package.json:33)；开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:144)、[@liwa/client-product-analytics](dsh-base:packages/client/product-analytics/package.json:68)、[@liwa/time-context](dsh-base:packages/context/time-context/package.json:52)、[@liwa/cua](dsh-base:packages/experimental/cua/package.json:133)、[@liwa/experimental-subagent-oar](dsh-base:packages/experimental/subagent-oar/package.json:60)、[@liwa/goal](dsh-base:packages/goal/goal/package.json:74)、[@liwa/host-product-telemetry-otel](dsh-base:packages/host/product-telemetry-otel/package.json:45)、[@liwa/session-projection](dsh-base:packages/session/session-projection/package.json:45)、[@liwa/session-telemetry-otel](dsh-base:packages/session/session-telemetry-otel/package.json:53)、[@liwa/tool-pwsh](dsh-base:packages/shell/tool-pwsh/package.json:57)、[@liwa/subagent-acp](dsh-base:packages/subagent/subagent-acp/package.json:51)、[@liwa/subagent-claude-code](dsh-base:packages/subagent/subagent-claude-code/package.json:61)、[@liwa/subagent-codex](dsh-base:packages/subagent/subagent-codex/package.json:60)、[@liwa/subagent-liwa-sdk](dsh-base:packages/subagent/subagent-liwa-sdk/package.json:53)、[@liwa/subprocess-local](dsh-base:packages/subprocess/subprocess-local/package.json:58)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §14 可观察、可回放、可验收（行 1412）](liwa:docs/liwa/architecture/overall.md:1412)。〔推理〕设计明确要求回放、模型调用录制重放与回归；这些是开发工具，不应出现在产品默认组合里。
- **建议：留**。〔推理〕现有测试和改造期验证仍依赖它，不能按未挂载就删除。

### `@liwa/remote-mock`

- **路径与规模**：[packages/test-support/remote-mock](dsh-base:packages/test-support/remote-mock)；16 个文件，6 个非测试代码文件，**713 行非测试代码**。
- **做什么**：给前端测试提供可控制的后台接口和事件流替身。〔一手〕[packages/test-support/remote-mock/README.zh.md:12](dsh-base:packages/test-support/remote-mock/README.zh.md:12)。
- **谁依赖**：同宿主依赖：[@liwa/client-test-runtime](dsh-base:packages/test-support/client-runtime/package.json:49)；开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:49)、[@liwa/api-gateway](dsh-base:packages/api/gateway/package.json:78)、[@liwa/api-session-controller](dsh-base:packages/api/session-controller/package.json:142)、[@liwa/api-terminal-controller](dsh-base:packages/api/terminal-controller/package.json:79)、[@liwa/api-workspace-controller](dsh-base:packages/api/workspace-controller/package.json:97)、[@liwa/api-workspace-files](dsh-base:packages/api/workspace-files/package.json:72)、[@liwa/client-ui-message-feedback](dsh-base:packages/client/ui-message-feedback/package.json:59)、[@liwa/client-ui-permission-presets](dsh-base:packages/client/ui-permission-presets/package.json:52)、[@liwa/client-ui-session](dsh-base:packages/client/ui-session/package.json:57)、[@liwa/client-ui-settings-general](dsh-base:packages/client/ui-settings-general/package.json:72)、[@liwa/client-ui-settings-models](dsh-base:packages/client/ui-settings-models/package.json:60)、[@liwa/client-test-runtime](dsh-base:packages/test-support/client-runtime/package.json:49)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §14 可观察、可回放、可验收（行 1412）](liwa:docs/liwa/architecture/overall.md:1412)。〔推理〕设计明确要求回放、模型调用录制重放与回归；这些是开发工具，不应出现在产品默认组合里。
- **建议：留**。〔推理〕现有测试和改造期验证仍依赖它，不能按未挂载就删除。

### `@liwa/session-snapshot`

- **路径与规模**：[packages/test-support/session-snapshot](dsh-base:packages/test-support/session-snapshot)；113 个文件，9 个非测试代码文件，**4,272 行非测试代码**。
- **做什么**：比较录制会话的输出与工作区结果，是现有无密钥快照测试的共用底座。〔一手〕[packages/test-support/session-snapshot/README.zh.md:12](dsh-base:packages/test-support/session-snapshot/README.zh.md:12)。
- **谁依赖**：脚本/路径调用：仓库录制会话语料的共享入口（[scripts/session-snapshot-corpus.corpus.ts:19](dsh-base:scripts/session-snapshot-corpus.corpus.ts:19)）。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §14 可观察、可回放、可验收（行 1412）](liwa:docs/liwa/architecture/overall.md:1412)。〔推理〕设计明确要求回放、模型调用录制重放与回归；这些是开发工具，不应出现在产品默认组合里。
- **建议：留**。〔推理〕现有测试和改造期验证仍依赖它，不能按未挂载就删除。

### `@liwa/tool-testkit`

- **路径与规模**：[packages/test-support/tool-testkit](dsh-base:packages/test-support/tool-testkit)；7 个文件，1 个非测试代码文件，**57 行非测试代码**。
- **做什么**：为工具测试与性能测量提供简短的定义、执行辅助函数。〔一手〕[packages/test-support/tool-testkit/README.zh.md:12](dsh-base:packages/test-support/tool-testkit/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:159)、[@liwa/web-frontend](dsh-base:apps/web/package.json:51)、[@liwa/benchmarks](dsh-base:benchmarks/package.json:45)、[@liwa/acp](dsh-base:packages/acp/acp/package.json:66)、[@liwa/plugin-manager](dsh-base:packages/boot/plugin-manager/package.json:110)、[@liwa/plugin-market](dsh-base:packages/boot/plugin-market/package.json:96)、[@liwa/client-ui-tool](dsh-base:packages/client/ui-tool/package.json:54)、[@liwa/compaction-basic](dsh-base:packages/compaction/compaction-basic/package.json:65)、[@liwa/agent-instructions](dsh-base:packages/context/agent-instructions/package.json:62)、[@liwa/file-reference-local](dsh-base:packages/context/file-reference-local/package.json:52)、[@liwa/session-reference](dsh-base:packages/context/session-reference/package.json:99)、[@liwa/time-context](dsh-base:packages/context/time-context/package.json:59)、[@liwa/agent-loop](dsh-base:packages/core/agent-loop/package.json:61)、[@liwa/tool-executor-ptc](dsh-base:packages/core/tool-executor-ptc/package.json:70)、[@liwa/tools](dsh-base:packages/core/tools/package.json:65)、[@liwa/tool-present](dsh-base:packages/deliverables/tool-present/package.json:56)、[@liwa/action-cards](dsh-base:packages/experimental/action-cards/package.json:59)、[@liwa/experimental-auto-review](dsh-base:packages/experimental/auto-review/package.json:75)、[@liwa/experimental-browser-use-runtime](dsh-base:packages/experimental/browser-use-runtime/package.json:55)、[@liwa/experimental-browser-use-stagehand-native](dsh-base:packages/experimental/browser-use-stagehand-native/package.json:68)、[@liwa/experimental-claude-code-mods](dsh-base:packages/experimental/claude-code-mods/package.json:98)、[@liwa/experimental-computer-use-cua-driver-mcp](dsh-base:packages/experimental/computer-use-cua-driver-mcp/package.json:46)、[@liwa/experimental-computer-use-cua-driver-native](dsh-base:packages/experimental/computer-use-cua-driver-native/package.json:58)、[@liwa/creation-recommendations](dsh-base:packages/experimental/creation-recommendations/package.json:52)、[@liwa/experimental-cua-macos](dsh-base:packages/experimental/cua-macos/package.json:72)、[@liwa/hooks-claude-code](dsh-base:packages/experimental/hooks-claude-code/package.json:56)、[@liwa/hooks-codex](dsh-base:packages/experimental/hooks-codex/package.json:54)、[@liwa/experimental-tool-agent-team](dsh-base:packages/experimental/tool-agent-team/package.json:57)、[@liwa/tool-ralph](dsh-base:packages/experimental/tool-ralph/package.json:55)、[@liwa/tool-session-query](dsh-base:packages/experimental/tool-session-query/package.json:61)、[@liwa/experimental-tool-subagent-oar](dsh-base:packages/experimental/tool-subagent-oar/package.json:47)、[@liwa/tool-terminal](dsh-base:packages/experimental/tool-terminal/package.json:64)、[@liwa/experimental-tool-worktree](dsh-base:packages/experimental/tool-worktree/package.json:56)、[@liwa/cordis-host-runner](dsh-base:packages/extensions/cordis-host-runner/package.json:74)、[@liwa/tool-fs-search](dsh-base:packages/fs/tool-fs-search/package.json:58)、[@liwa/tool-fs](dsh-base:packages/fs/tool-fs/package.json:66)、[@liwa/tool-str-replace-editor](dsh-base:packages/fs/tool-str-replace-editor/package.json:55)、[@liwa/tool-goal](dsh-base:packages/goal/tool-goal/package.json:53)、[@liwa/repeat-tool-reminder](dsh-base:packages/guard/repeat-tool-reminder/package.json:45)、[@liwa/tool-call-timeout-policy](dsh-base:packages/guard/timeout-policy/package.json:41)、[@liwa/tool-ask-user](dsh-base:packages/interaction/tool-ask-user/package.json:42)、[@liwa/tool-jobs](dsh-base:packages/jobs/tool-jobs/package.json:52)、[@liwa/llm-deepseek](dsh-base:packages/llm/llm-deepseek/package.json:73)、[@liwa/llm-pi-ai](dsh-base:packages/llm/llm-pi-ai/package.json:64)、[@liwa/llm-retry](dsh-base:packages/llm/llm-retry/package.json:65)、[@liwa/tool-lsp](dsh-base:packages/lsp/tool-lsp/package.json:57)、[@liwa/mcp-client](dsh-base:packages/mcp/mcp-client/package.json:55)、[@liwa/mcp-resources](dsh-base:packages/mcp/mcp-resources/package.json:45)、[@liwa/plan-mode](dsh-base:packages/plan/plan-mode/package.json:71)、[@liwa/agent-preset-registry](dsh-base:packages/preset/agent-preset-registry/package.json:85)、[@liwa/tool-schedule](dsh-base:packages/schedule/tool-schedule/package.json:46)、[@liwa/session-checkpoint-policy](dsh-base:packages/session/session-checkpoint-policy/package.json:52)、[@liwa/working-directory](dsh-base:packages/session/working-directory/package.json:52)、[@liwa/tool-bash-persistent](dsh-base:packages/shell/tool-bash-persistent/package.json:58)、[@liwa/tool-bash](dsh-base:packages/shell/tool-bash/package.json:68)、[@liwa/tool-pwsh-persistent](dsh-base:packages/shell/tool-pwsh-persistent/package.json:60)、[@liwa/tool-pwsh](dsh-base:packages/shell/tool-pwsh/package.json:68)、[@liwa/tool-skill](dsh-base:packages/skill/tool-skill/package.json:51)、[@liwa/tool-workspace-dependencies](dsh-base:packages/skill/tool-workspace-dependencies/package.json:36)、[@liwa/spill-policy](dsh-base:packages/spill/spill-policy/package.json:57)、[@liwa/subagent](dsh-base:packages/subagent/subagent/package.json:121)、[@liwa/tool-subagent-control](dsh-base:packages/subagent/tool-subagent-control/package.json:53)、[@liwa/tool-subagent](dsh-base:packages/subagent/tool-subagent/package.json:70)、[@liwa/session-snapshot](dsh-base:packages/test-support/session-snapshot/package.json:55)、[@liwa/tool-todo](dsh-base:packages/todo/tool-todo/package.json:58)、[@liwa/tool-web](dsh-base:packages/web/tool-web/package.json:55)、[@liwa/tool-workflow](dsh-base:packages/workflow/tool-workflow/package.json:62)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §14 可观察、可回放、可验收（行 1412）](liwa:docs/liwa/architecture/overall.md:1412)。〔推理〕设计明确要求回放、模型调用录制重放与回归；这些是开发工具，不应出现在产品默认组合里。
- **建议：留**。〔推理〕现有测试和改造期验证仍依赖它，不能按未挂载就删除。

### `@liwa/typert-generator`

- **路径与规模**：[packages/typert/generator](dsh-base:packages/typert/generator)；61 个文件，12 个非测试代码文件，**7,041 行非测试代码**。
- **做什么**：读 TypeScript 类型，生成接口描述、校验 schema 和前后端远程调用所需文件。〔一手〕[packages/typert/generator/README.zh.md:12](dsh-base:packages/typert/generator/README.zh.md:12)。
- **谁依赖**：脚本/路径调用：仓库生成 schema 与 Remote 的入口（[scripts/generate-typert.ts:16](dsh-base:scripts/generate-typert.ts:16)）；脚本/路径调用：运行时打包配置消费生成器插件（[tsdown.config.ts:3](dsh-base:tsdown.config.ts:3)）。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §12 测试、§16 与继承底座的插件化对照（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕设计要求类型化契约和可替换插件；现有底座仍靠本工具生成 schema、Remote 等构建产物。
- **建议：留**。〔推理〕它虽然不在运行时加载，当前构建脚本仍使用它；等替换生成链再评估。

### `@liwa/cordis-plugin-hmr`

- **路径与规模**：[vendor/hmr](dsh-base:vendor/hmr)；6 个文件，2 个非测试代码文件，**410 行非测试代码**。
- **做什么**：Cordis 原生的插件热重载实现；与灵鲸正在用的 @liwa/hmr 不是同一个包。〔一手〕[vendor/hmr/README.md:10](dsh-base:vendor/hmr/README.md:10)。
- **谁依赖**：没有工作区包在清单或非测试静态导入中依赖它。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §12 测试、§16 与继承底座的插件化对照（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕设计允许改造现有工程机制，但没有要求保留两套热重载或额外的控制台日志导出插件。
- **建议：删**。〔推理〕没有默认根或可选组合使用；现有 @liwa/hmr 和默认日志链另有归属。

### `@liwa/cordis-plugin-logger-console`

- **路径与规模**：[vendor/logger-console](dsh-base:vendor/logger-console)；8 个文件，4 个非测试代码文件，**132 行非测试代码**。
- **做什么**：把 Cordis 日志输出到控制台的可选导出器。〔一手〕[vendor/logger-console/README.md:9](dsh-base:vendor/logger-console/README.md:9)。
- **谁依赖**：开发/测试依赖：[@liwa/session-telemetry-otel](dsh-base:packages/session/session-telemetry-otel/package.json:46)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §12 测试、§16 与继承底座的插件化对照（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕设计允许改造现有工程机制，但没有要求保留两套热重载或额外的控制台日志导出插件。
- **建议：删**。〔推理〕没有默认根或可选组合使用；现有 @liwa/hmr 和默认日志链另有归属。

## 5. 接入协议与外部大脑

总体建议：Claude Code、Codex、ACP、SDK 和 LSP 等迁移边界确定后再定；OAR、hooks 和 mods 兼容桥可删。

### `@liwa/experimental-claude-code-mods`

- **路径与规模**：[packages/experimental/claude-code-mods](dsh-base:packages/experimental/claude-code-mods)；70 个文件，23 个非测试代码文件，**3,509 行非测试代码**。
- **做什么**：让 Claude Code mods 插件在灵鲸继承 agent 的钩子上运行。〔一手〕[packages/experimental/claude-code-mods/README.zh.md:12](dsh-base:packages/experimental/claude-code-mods/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/experimental-client-ui-claude-code-mods](dsh-base:packages/experimental/client-ui-claude-code-mods/package.json:66)、[@liwa/experimental-liveshare](dsh-base:packages/experimental/liveshare/package.json:128)；仓库根 开发/测试依赖（[package.json:221](dsh-base:package.json:221)）。
- **组合或预设**：仅源码演示 overlay：[packages/experimental/claude-code-mods/cordis.source.patch.yml:11](dsh-base:packages/experimental/claude-code-mods/cordis.source.patch.yml:11)。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §12 测试、§16 与继承底座的插件化对照（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计使用灵鲸自己的契约和工具边界；接入 CLI 本身不要求把它们的用户 hooks 或 mods 搬到继承 agent 上。
- **建议：删**。〔推理〕它们是底座执行外部钩子的兼容桥，不是长会话适配器；没有设计用途。

### `@liwa/experimental-client-ui-claude-code-mods`

- **路径与规模**：[packages/experimental/client-ui-claude-code-mods](dsh-base:packages/experimental/client-ui-claude-code-mods)；23 个文件，7 个非测试代码文件，**387 行非测试代码**。
- **做什么**：在输入框上方显示 Claude Code mods 的文字、按钮和横幅。〔一手〕[packages/experimental/client-ui-claude-code-mods/README.zh.md:12](dsh-base:packages/experimental/client-ui-claude-code-mods/README.zh.md:12)。
- **谁依赖**：没有工作区包在清单或非测试静态导入中依赖它。
- **组合或预设**：仅源码演示 overlay：[packages/experimental/claude-code-mods/cordis.source.patch.yml:11](dsh-base:packages/experimental/claude-code-mods/cordis.source.patch.yml:11)。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §12 测试、§16 与继承底座的插件化对照（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计使用灵鲸自己的契约和工具边界；接入 CLI 本身不要求把它们的用户 hooks 或 mods 搬到继承 agent 上。
- **建议：删**。〔推理〕它们是底座执行外部钩子的兼容桥，不是长会话适配器；没有设计用途。

### `@liwa/hook-protocol`

- **路径与规模**：[packages/experimental/hook-protocol](dsh-base:packages/experimental/hook-protocol)；19 个文件，8 个非测试代码文件，**365 行非测试代码**。
- **做什么**：统一解析 Claude Code、Codex hook 输入输出、匹配规则及合并结果。〔一手〕[packages/experimental/hook-protocol/README.zh.md:12](dsh-base:packages/experimental/hook-protocol/README.zh.md:12)。
- **谁依赖**：同宿主依赖：[@liwa/hooks-claude-code](dsh-base:packages/experimental/hooks-claude-code/package.json:36)、[@liwa/hooks-codex](dsh-base:packages/experimental/hooks-codex/package.json:36)；开发/测试依赖：[@liwa/hooks-claude-code](dsh-base:packages/experimental/hooks-claude-code/package.json:36)、[@liwa/hooks-codex](dsh-base:packages/experimental/hooks-codex/package.json:36)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §12 测试、§16 与继承底座的插件化对照（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计使用灵鲸自己的契约和工具边界；接入 CLI 本身不要求把它们的用户 hooks 或 mods 搬到继承 agent 上。
- **建议：删**。〔推理〕它们是底座执行外部钩子的兼容桥，不是长会话适配器；没有设计用途。

### `@liwa/hooks-claude-code`

- **路径与规模**：[packages/experimental/hooks-claude-code](dsh-base:packages/experimental/hooks-claude-code)；22 个文件，2 个非测试代码文件，**403 行非测试代码**。
- **做什么**：在灵鲸工具执行等环节运行 Claude Code 格式的用户 hook 配置。〔一手〕[packages/experimental/hooks-claude-code/README.zh.md:12](dsh-base:packages/experimental/hooks-claude-code/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:121)；仓库根 开发/测试依赖（[package.json:205](dsh-base:package.json:205)）。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §12 测试、§16 与继承底座的插件化对照（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计使用灵鲸自己的契约和工具边界；接入 CLI 本身不要求把它们的用户 hooks 或 mods 搬到继承 agent 上。
- **建议：删**。〔推理〕它们是底座执行外部钩子的兼容桥，不是长会话适配器；没有设计用途。

### `@liwa/hooks-codex`

- **路径与规模**：[packages/experimental/hooks-codex](dsh-base:packages/experimental/hooks-codex)；21 个文件，2 个非测试代码文件，**353 行非测试代码**。
- **做什么**：在灵鲸执行环节运行 Codex 格式的用户 hook 配置。〔一手〕[packages/experimental/hooks-codex/README.zh.md:12](dsh-base:packages/experimental/hooks-codex/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:120)；仓库根 开发/测试依赖（[package.json:206](dsh-base:package.json:206)）。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §12 测试、§16 与继承底座的插件化对照（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计使用灵鲸自己的契约和工具边界；接入 CLI 本身不要求把它们的用户 hooks 或 mods 搬到继承 agent 上。
- **建议：删**。〔推理〕它们是底座执行外部钩子的兼容桥，不是长会话适配器；没有设计用途。

### `@liwa/experimental-subagent-oar`

- **路径与规模**：[packages/experimental/subagent-oar](dsh-base:packages/experimental/subagent-oar)；33 个文件，4 个非测试代码文件，**367 行非测试代码**。
- **做什么**：经 OAR 库调用已安装的 Claude Code 或 Codex，运行单次文本任务。〔一手〕[packages/experimental/subagent-oar/README.zh.md:12](dsh-base:packages/experimental/subagent-oar/README.zh.md:12)。
- **谁依赖**：仓库根 开发/测试依赖（[package.json:281](dsh-base:package.json:281)）。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §4 第四层：agent CLI 集成层（行 310）](liwa:docs/liwa/architecture/four-layers.md:310)。〔推理〕设计已选 Claude Code 直连、Codex app-server 和 ACP；OAR 在这里提供的是另一套一次性任务中转。
- **建议：删**。〔推理〕重复一次性委派入口，不能补上设计要求的长会话。

### `@liwa/experimental-tool-subagent-oar`

- **路径与规模**：[packages/experimental/tool-subagent-oar](dsh-base:packages/experimental/tool-subagent-oar)；15 个文件，1 个非测试代码文件，**87 行非测试代码**。
- **做什么**：给模型一个 subagent_oar 工具，按预设别名选择 OAR 执行者。〔一手〕[packages/experimental/tool-subagent-oar/README.zh.md:12](dsh-base:packages/experimental/tool-subagent-oar/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/experimental-subagent-oar](dsh-base:packages/experimental/subagent-oar/package.json:70)；仓库根 开发/测试依赖（[package.json:282](dsh-base:package.json:282)）。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §4 第四层：agent CLI 集成层（行 310）](liwa:docs/liwa/architecture/four-layers.md:310)。〔推理〕设计已选 Claude Code 直连、Codex app-server 和 ACP；OAR 在这里提供的是另一套一次性任务中转。
- **建议：删**。〔推理〕重复一次性委派入口，不能补上设计要求的长会话。

### `@liwa/lsp`

- **路径与规模**：[packages/lsp/lsp](dsh-base:packages/lsp/lsp)；17 个文件，3 个非测试代码文件，**145 行非测试代码**。
- **做什么**：统一向语言服务器查询定义、引用、实现和悬停信息的服务接口。〔一手〕[packages/lsp/lsp/README.zh.md:12](dsh-base:packages/lsp/lsp/README.zh.md:12)。
- **谁依赖**：同宿主依赖：[@liwa/lsp-stdio](dsh-base:packages/lsp/lsp-stdio/package.json:36)、[@liwa/tool-lsp](dsh-base:packages/lsp/tool-lsp/package.json:34)；开发/测试依赖：[@liwa/lsp-stdio](dsh-base:packages/lsp/lsp-stdio/package.json:36)、[@liwa/tool-lsp](dsh-base:packages/lsp/tool-lsp/package.json:34)、[@liwa/ssh](dsh-base:packages/ssh/ssh/package.json:82)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计明确保留编程工作区和 CLI 原生工具，但没有规定由本体另起 LSP；这套是给继承 agent 的只读代码导航。
- **建议：留待设计迁移方案时再定**。〔推理〕先决定底座大脑是否仍需自带代码导航，再决定保留整套 seam，避免只留服务没有提供方或工具。

### `@liwa/lsp-stdio`

- **路径与规模**：[packages/lsp/lsp-stdio](dsh-base:packages/lsp/lsp-stdio)；31 个文件，8 个非测试代码文件，**1,197 行非测试代码**。
- **做什么**：为每个工作区按需启动已配置的语言服务器，用标准输入输出通信。〔一手〕[packages/lsp/lsp-stdio/README.zh.md:12](dsh-base:packages/lsp/lsp-stdio/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/tool-lsp](dsh-base:packages/lsp/tool-lsp/package.json:50)、[@liwa/ssh](dsh-base:packages/ssh/ssh/package.json:83)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计明确保留编程工作区和 CLI 原生工具，但没有规定由本体另起 LSP；这套是给继承 agent 的只读代码导航。
- **建议：留待设计迁移方案时再定**。〔推理〕先决定底座大脑是否仍需自带代码导航，再决定保留整套 seam，避免只留服务没有提供方或工具。

### `@liwa/tool-lsp`

- **路径与规模**：[packages/lsp/tool-lsp](dsh-base:packages/lsp/tool-lsp)；19 个文件，2 个非测试代码文件，**367 行非测试代码**。
- **做什么**：给模型一个只读的代码导航工具，调用已配置的 LSP 服务。〔一手〕[packages/lsp/tool-lsp/README.zh.md:12](dsh-base:packages/lsp/tool-lsp/README.zh.md:12)。
- **谁依赖**：没有工作区包在清单或非测试静态导入中依赖它。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计明确保留编程工作区和 CLI 原生工具，但没有规定由本体另起 LSP；这套是给继承 agent 的只读代码导航。
- **建议：留待设计迁移方案时再定**。〔推理〕先决定底座大脑是否仍需自带代码导航，再决定保留整套 seam，避免只留服务没有提供方或工具。

### `@liwa/sdk-client`

- **路径与规模**：[packages/sdk/client](dsh-base:packages/sdk/client)；19 个文件，6 个非测试代码文件，**1,059 行非测试代码**。
- **做什么**：让 TypeScript 程序通过标准输入输出启动并操纵灵鲸后台的客户端。〔一手〕[packages/sdk/client/README.zh.md:12](dsh-base:packages/sdk/client/README.zh.md:12)。
- **谁依赖**：同宿主依赖：[@liwa/subagent-liwa-sdk](dsh-base:packages/subagent/subagent-liwa-sdk/package.json:35)；开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:147)、[@liwa/benchmarks](dsh-base:benchmarks/package.json:27)、[@liwa/subagent-liwa-sdk](dsh-base:packages/subagent/subagent-liwa-sdk/package.json:35)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §4 第四层：agent CLI 集成层（行 310）](liwa:docs/liwa/architecture/four-layers.md:310)。〔推理〕设计保留继承 agent 作为大脑提供方；这套 SDK 能驱动独立灵鲸子进程，但不是 brain.provider 契约。
- **建议：留待设计迁移方案时再定**。〔推理〕先决定底座大脑在进程内运行还是经子进程接入，再裁客户端和 SDK 委派。

### `@liwa/subagent-acp`

- **路径与规模**：[packages/subagent/subagent-acp](dsh-base:packages/subagent/subagent-acp)；23 个文件，2 个非测试代码文件，**650 行非测试代码**。
- **做什么**：每次新开一个 ACP 子进程，把独立任务交给它，收回最终文字结果。〔一手〕[packages/subagent/subagent-acp/README.zh.md:12](dsh-base:packages/subagent/subagent-acp/README.zh.md:12)。
- **谁依赖**：直接依赖：[liwa-python-runtime-closure](dsh-base:python/sdk-runtime/package.json:105)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §4 第四层：agent CLI 集成层（行 310）](liwa:docs/liwa/architecture/four-layers.md:310)。〔推理〕设计原文点名 Claude Code、Codex、通用 ACP，也明确指出底座这三个包是一次性委派；需要的是持久会话、注入、送达、取消和用量契约。
- **建议：留待设计迁移方案时再定**。〔推理〕不能因名字相同就当成已满足大脑接入，也不宜在提取可复用协议实现前直接删掉。

### `@liwa/subagent-claude-code`

- **路径与规模**：[packages/subagent/subagent-claude-code](dsh-base:packages/subagent/subagent-claude-code)；26 个文件，3 个非测试代码文件，**776 行非测试代码**。
- **做什么**：带随附 Claude Code 运行时，通过官方 Agent SDK 做一次性委派。〔一手〕[packages/subagent/subagent-claude-code/README.zh.md:12](dsh-base:packages/subagent/subagent-claude-code/README.zh.md:12)。
- **谁依赖**：没有工作区包在清单或非测试静态导入中依赖它。
- **组合或预设**：本身是按需选择的 bundle，未进入五个默认 profile。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §4 第四层：agent CLI 集成层（行 310）](liwa:docs/liwa/architecture/four-layers.md:310)。〔推理〕设计原文点名 Claude Code、Codex、通用 ACP，也明确指出底座这三个包是一次性委派；需要的是持久会话、注入、送达、取消和用量契约。
- **建议：留待设计迁移方案时再定**。〔推理〕不能因名字相同就当成已满足大脑接入，也不宜在提取可复用协议实现前直接删掉。

### `@liwa/subagent-codex`

- **路径与规模**：[packages/subagent/subagent-codex](dsh-base:packages/subagent/subagent-codex)；29 个文件，3 个非测试代码文件，**1,210 行非测试代码**。
- **做什么**：带随附 Codex 运行时，通过 app-server 新开线程做一次性委派。〔一手〕[packages/subagent/subagent-codex/README.zh.md:12](dsh-base:packages/subagent/subagent-codex/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/subagent-claude-code](dsh-base:packages/subagent/subagent-claude-code/package.json:67)。
- **组合或预设**：本身是按需选择的 bundle，未进入五个默认 profile。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §4 第四层：agent CLI 集成层（行 310）](liwa:docs/liwa/architecture/four-layers.md:310)。〔推理〕设计原文点名 Claude Code、Codex、通用 ACP，也明确指出底座这三个包是一次性委派；需要的是持久会话、注入、送达、取消和用量契约。
- **建议：留待设计迁移方案时再定**。〔推理〕不能因名字相同就当成已满足大脑接入，也不宜在提取可复用协议实现前直接删掉。

### `@liwa/subagent-liwa-sdk`

- **路径与规模**：[packages/subagent/subagent-liwa-sdk](dsh-base:packages/subagent/subagent-liwa-sdk)；25 个文件，2 个非测试代码文件，**469 行非测试代码**。
- **做什么**：每次启动另一套灵鲸后台去做一个独立任务，结束后只取最终结果。〔一手〕[packages/subagent/subagent-liwa-sdk/README.zh.md:12](dsh-base:packages/subagent/subagent-liwa-sdk/README.zh.md:12)。
- **谁依赖**：仓库根 开发/测试依赖（[package.json:223](dsh-base:package.json:223)）。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §4 第四层：agent CLI 集成层（行 310）](liwa:docs/liwa/architecture/four-layers.md:310)。〔推理〕设计保留继承 agent 作为大脑提供方；这套 SDK 能驱动独立灵鲸子进程，但不是 brain.provider 契约。
- **建议：留待设计迁移方案时再定**。〔推理〕先决定底座大脑在进程内运行还是经子进程接入，再裁客户端和 SDK 委派。

## 6. 浏览器、桌面操作与感知

总体建议：Mac 原生 CUA 和 MCP 浏览器实现先留作迁移候选；另外的 Cua Driver 替代接法与独立调模型的 Stagehand 建议删。

### `@liwa/browser-use`

- **路径与规模**：[packages/browser-use/browser-use](dsh-base:packages/browser-use/browser-use)；16 个文件，2 个非测试代码文件，**33 行非测试代码**。
- **做什么**：记录当前启用哪个浏览器操作提供方，防止同时装两个。〔一手〕[packages/browser-use/browser-use/README.zh.md:12](dsh-base:packages/browser-use/browser-use/README.zh.md:12)。
- **谁依赖**：同宿主依赖：[@liwa/experimental-browser-use-chrome-devtools-mcp](dsh-base:packages/experimental/browser-use-chrome-devtools-mcp/package.json:37)、[@liwa/experimental-browser-use-playwright-mcp](dsh-base:packages/experimental/browser-use-playwright-mcp/package.json:37)、[@liwa/experimental-browser-use-runtime](dsh-base:packages/experimental/browser-use-runtime/package.json:37)、[@liwa/experimental-browser-use-stagehand-native](dsh-base:packages/experimental/browser-use-stagehand-native/package.json:39)；开发/测试依赖：[@liwa/experimental-browser-use-chrome-devtools-mcp](dsh-base:packages/experimental/browser-use-chrome-devtools-mcp/package.json:37)、[@liwa/experimental-browser-use-playwright-mcp](dsh-base:packages/experimental/browser-use-playwright-mcp/package.json:37)、[@liwa/experimental-browser-use-runtime](dsh-base:packages/experimental/browser-use-runtime/package.json:37)、[@liwa/experimental-browser-use-stagehand-native](dsh-base:packages/experimental/browser-use-stagehand-native/package.json:39)；仓库根 开发/测试依赖（[package.json:212](dsh-base:package.json:212)）。
- **组合或预设**：浏览器提供方需手工挂载服务和提供方，没有随附默认 preset 选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕产品 V4 有浏览器自主活动，V5 有感知能力；CLI 自带 MCP、本体 abilities 与底座 CUA 的职责还要统一。
- **建议：留待设计迁移方案时再定**。〔推理〕能力方向用得上，但必须先定由 CLI 自带工具还是灵鲸能力层持有，避免两套权限和生命周期。

### `@liwa/computer-use`

- **路径与规模**：[packages/computer-use/computer-use](dsh-base:packages/computer-use/computer-use)；16 个文件，2 个非测试代码文件，**33 行非测试代码**。
- **做什么**：记录当前启用哪个桌面操作提供方，防止同时装两个。〔一手〕[packages/computer-use/computer-use/README.zh.md:12](dsh-base:packages/computer-use/computer-use/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cua-bundle](dsh-base:packages/experimental/cua-bundle/package.json:46)、[@liwa/cua](dsh-base:packages/experimental/cua/package.json:85)；同宿主依赖：[@liwa/experimental-computer-use-cua-driver-mcp](dsh-base:packages/experimental/computer-use-cua-driver-mcp/package.json:37)、[@liwa/experimental-computer-use-cua-driver-native](dsh-base:packages/experimental/computer-use-cua-driver-native/package.json:33)、[@liwa/experimental-cua-macos](dsh-base:packages/experimental/cua-macos/package.json:43)；开发/测试依赖：[@liwa/experimental-computer-use-cua-driver-mcp](dsh-base:packages/experimental/computer-use-cua-driver-mcp/package.json:37)、[@liwa/experimental-computer-use-cua-driver-native](dsh-base:packages/experimental/computer-use-cua-driver-native/package.json:33)、[@liwa/experimental-cua-macos](dsh-base:packages/experimental/cua-macos/package.json:43)；仓库根 开发/测试依赖（[package.json:217](dsh-base:package.json:217)）。
- **组合或预设**：可选挂载：`@liwa/cua-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕产品 V4 有浏览器自主活动，V5 有感知能力；CLI 自带 MCP、本体 abilities 与底座 CUA 的职责还要统一。
- **建议：留待设计迁移方案时再定**。〔推理〕能力方向用得上，但必须先定由 CLI 自带工具还是灵鲸能力层持有，避免两套权限和生命周期。

### `@liwa/experimental-browser-use-chrome-devtools-mcp`

- **路径与规模**：[packages/experimental/browser-use-chrome-devtools-mcp](dsh-base:packages/experimental/browser-use-chrome-devtools-mcp)；16 个文件，1 个非测试代码文件，**26 行非测试代码**。
- **做什么**：把 Chrome DevTools MCP 的浏览器工具接到继承 agent 上。〔一手〕[packages/experimental/browser-use-chrome-devtools-mcp/README.zh.md:12](dsh-base:packages/experimental/browser-use-chrome-devtools-mcp/README.zh.md:12)。
- **谁依赖**：仓库根 开发/测试依赖（[package.json:215](dsh-base:package.json:215)）。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕产品 V4 有浏览器自主活动，V5 有感知能力；CLI 自带 MCP、本体 abilities 与底座 CUA 的职责还要统一。
- **建议：留待设计迁移方案时再定**。〔推理〕能力方向用得上，但必须先定由 CLI 自带工具还是灵鲸能力层持有，避免两套权限和生命周期。

### `@liwa/experimental-browser-use-playwright-mcp`

- **路径与规模**：[packages/experimental/browser-use-playwright-mcp](dsh-base:packages/experimental/browser-use-playwright-mcp)；16 个文件，1 个非测试代码文件，**32 行非测试代码**。
- **做什么**：把 Playwright MCP 的浏览器工具接到继承 agent 上。〔一手〕[packages/experimental/browser-use-playwright-mcp/README.zh.md:12](dsh-base:packages/experimental/browser-use-playwright-mcp/README.zh.md:12)。
- **谁依赖**：仓库根 开发/测试依赖（[package.json:214](dsh-base:package.json:214)）。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕产品 V4 有浏览器自主活动，V5 有感知能力；CLI 自带 MCP、本体 abilities 与底座 CUA 的职责还要统一。
- **建议：留待设计迁移方案时再定**。〔推理〕能力方向用得上，但必须先定由 CLI 自带工具还是灵鲸能力层持有，避免两套权限和生命周期。

### `@liwa/experimental-browser-use-runtime`

- **路径与规模**：[packages/experimental/browser-use-runtime](dsh-base:packages/experimental/browser-use-runtime)；14 个文件，2 个非测试代码文件，**319 行非测试代码**。
- **做什么**：管理每个会话自己的浏览器资源和 MCP 连接，关闭会话时清理。〔一手〕[packages/experimental/browser-use-runtime/README.zh.md:12](dsh-base:packages/experimental/browser-use-runtime/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-browser-use-chrome-devtools-mcp](dsh-base:packages/experimental/browser-use-chrome-devtools-mcp/package.json:32)、[@liwa/experimental-browser-use-playwright-mcp](dsh-base:packages/experimental/browser-use-playwright-mcp/package.json:32)、[@liwa/experimental-browser-use-stagehand-native](dsh-base:packages/experimental/browser-use-stagehand-native/package.json:45)；仓库根 开发/测试依赖（[package.json:213](dsh-base:package.json:213)）。
- **组合或预设**：浏览器提供方需手工挂载服务和提供方，没有随附默认 preset 选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕产品 V4 有浏览器自主活动，V5 有感知能力；CLI 自带 MCP、本体 abilities 与底座 CUA 的职责还要统一。
- **建议：留待设计迁移方案时再定**。〔推理〕能力方向用得上，但必须先定由 CLI 自带工具还是灵鲸能力层持有，避免两套权限和生命周期。

### `@liwa/experimental-browser-use-stagehand-native`

- **路径与规模**：[packages/experimental/browser-use-stagehand-native](dsh-base:packages/experimental/browser-use-stagehand-native)；34 个文件，7 个非测试代码文件，**532 行非测试代码**。
- **做什么**：让 Stagehand 单独调用模型，帮浏览器找控件、执行操作和提取数据。〔一手〕[packages/experimental/browser-use-stagehand-native/README.zh.md:12](dsh-base:packages/experimental/browser-use-stagehand-native/README.zh.md:12)。
- **谁依赖**：仓库根 开发/测试依赖（[package.json:216](dsh-base:package.json:216)）。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕设计规定本体不直接调模型，所有用脑经第四层；本包的 Stagehand AI 操作用另外配置的原生模型。
- **建议：删**。〔推理〕它额外开出一条用脑路径；已有 MCP 浏览器候选可供迁移时选择。

### `@liwa/experimental-computer-use-cua-driver-mcp`

- **路径与规模**：[packages/experimental/computer-use-cua-driver-mcp](dsh-base:packages/experimental/computer-use-cua-driver-mcp)；18 个文件，1 个非测试代码文件，**42 行非测试代码**。
- **做什么**：连接外部安装的 Cua Driver MCP 程序，把它的桌面工具交给模型。〔一手〕[packages/experimental/computer-use-cua-driver-mcp/README.zh.md:12](dsh-base:packages/experimental/computer-use-cua-driver-mcp/README.zh.md:12)。
- **谁依赖**：仓库根 开发/测试依赖（[package.json:218](dsh-base:package.json:218)）。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 handoff.md 已定的决策 44：仅 Apple 芯片 Mac、本机打包，SSH helper 留删待裁剪（行 160）](liwa:docs/liwa/handoff.md:160)。〔推理〕只跑 Apple 芯片 Mac 已定，底座已有原生 macOS CUA；设计没有指定另装 Cua Driver。
- **建议：删**。〔推理〕在保留原生 Mac 候选的前提下，这两包是替代桌面驱动接法，建议减少重复实现。

### `@liwa/experimental-computer-use-cua-driver-native`

- **路径与规模**：[packages/experimental/computer-use-cua-driver-native](dsh-base:packages/experimental/computer-use-cua-driver-native)；19 个文件，1 个非测试代码文件，**109 行非测试代码**。
- **做什么**：把 Cua Driver 的原生 npm SDK 嵌入后台来操作桌面。〔一手〕[packages/experimental/computer-use-cua-driver-native/README.zh.md:12](dsh-base:packages/experimental/computer-use-cua-driver-native/README.zh.md:12)。
- **谁依赖**：仓库根 开发/测试依赖（[package.json:219](dsh-base:package.json:219)）。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 handoff.md 已定的决策 44：仅 Apple 芯片 Mac、本机打包，SSH helper 留删待裁剪（行 160）](liwa:docs/liwa/handoff.md:160)。〔推理〕只跑 Apple 芯片 Mac 已定，底座已有原生 macOS CUA；设计没有指定另装 Cua Driver。
- **建议：删**。〔推理〕在保留原生 Mac 候选的前提下，这两包是替代桌面驱动接法，建议减少重复实现。

### `@liwa/cua`

- **路径与规模**：[packages/experimental/cua](dsh-base:packages/experimental/cua)；56 个文件，22 个非测试代码文件，**2,438 行非测试代码**。
- **做什么**：把应用、窗口、截图和输入操作封装成可保留的对象，并检查应用授权。〔一手〕[packages/experimental/cua/README.zh.md:12](dsh-base:packages/experimental/cua/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cua-bundle](dsh-base:packages/experimental/cua-bundle/package.json:47)、[@liwa/experimental-cua-macos](dsh-base:packages/experimental/cua-macos/package.json:53)；开发/测试依赖：[@liwa/experimental-liveshare](dsh-base:packages/experimental/liveshare/package.json:126)；仓库根 开发/测试依赖（[package.json:220](dsh-base:package.json:220)）。
- **组合或预设**：可选挂载：`@liwa/cua-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕产品 V4 有浏览器自主活动，V5 有感知能力；CLI 自带 MCP、本体 abilities 与底座 CUA 的职责还要统一。
- **建议：留待设计迁移方案时再定**。〔推理〕能力方向用得上，但必须先定由 CLI 自带工具还是灵鲸能力层持有，避免两套权限和生命周期。

### `@liwa/cua-bundle`

- **路径与规模**：[packages/experimental/cua-bundle](dsh-base:packages/experimental/cua-bundle)；21 个文件，1 个非测试代码文件，**1 行非测试代码**。
- **做什么**：把 Mac 原生桌面操作、授权检查和对象工具一起启用。〔一手〕[packages/experimental/cua-bundle/README.zh.md:12](dsh-base:packages/experimental/cua-bundle/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:110)；仓库根 开发/测试依赖（[package.json:280](dsh-base:package.json:280)）。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕产品 V4 有浏览器自主活动，V5 有感知能力；CLI 自带 MCP、本体 abilities 与底座 CUA 的职责还要统一。
- **建议：留待设计迁移方案时再定**。〔推理〕能力方向用得上，但必须先定由 CLI 自带工具还是灵鲸能力层持有，避免两套权限和生命周期。

### `@liwa/experimental-cua-macos`

- **路径与规模**：[packages/experimental/cua-macos](dsh-base:packages/experimental/cua-macos)；105 个文件，33 个非测试代码文件，**4,549 行非测试代码**。
- **做什么**：用 Swift 辅助进程读取 Mac 应用与辅助功能树、截图并发送键鼠操作。〔一手〕[packages/experimental/cua-macos/README.zh.md:12](dsh-base:packages/experimental/cua-macos/README.zh.md:12)。
- **谁依赖**：可选依赖：[@liwa/cua-bundle](dsh-base:packages/experimental/cua-bundle/package.json:58)；仓库根 开发/测试依赖（[package.json:283](dsh-base:package.json:283)）。
- **组合或预设**：可选挂载：`@liwa/cua-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕产品 V4 有浏览器自主活动，V5 有感知能力；CLI 自带 MCP、本体 abilities 与底座 CUA 的职责还要统一。
- **建议：留待设计迁移方案时再定**。〔推理〕能力方向用得上，但必须先定由 CLI 自带工具还是灵鲸能力层持有，避免两套权限和生命周期。

## 7. 语音输入与能力插件

总体建议：五包一起待定，避免只留服务定义或界面而丢掉完整能力链；录音转文字和 V5 实时语音也应分别考虑。

### `@liwa/experimental-api-speech-to-text`

- **路径与规模**：[packages/experimental/api-speech-to-text](dsh-base:packages/experimental/api-speech-to-text)；18 个文件，3 个非测试代码文件，**83 行非测试代码**。
- **做什么**：把浏览器提交的录音通过已鉴权接口交给后台识别服务。〔一手〕[packages/experimental/api-speech-to-text/README.zh.md:12](dsh-base:packages/experimental/api-speech-to-text/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-voice-input-bundle](dsh-base:packages/experimental/voice-input-bundle/package.json:39)；开发/测试依赖：[@liwa/experimental-client-ui-voice-input](dsh-base:packages/experimental/client-ui-voice-input/package.json:52)、[@liwa/experimental-liveshare](dsh-base:packages/experimental/liveshare/package.json:127)。
- **组合或预设**：可选挂载：`@liwa/experimental-voice-input-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.4 桌宠、语音、视频；另见 overall.md §9.4（行 453）](liwa:docs/liwa/product.md:453)。〔推理〕设计保留听说看画的能力层，V5 有语音；设计当前倾向线上能力服务，现有实现是本地 SenseVoice 加网页录音转文字。
- **建议：留待设计迁移方案时再定**。〔推理〕语音确有用途，但需确认是否复用此输入链、改为线上提供方，或使用独立实时语音链。

### `@liwa/experimental-client-ui-voice-input`

- **路径与规模**：[packages/experimental/client-ui-voice-input](dsh-base:packages/experimental/client-ui-voice-input)；39 个文件，16 个非测试代码文件，**1,643 行非测试代码**。
- **做什么**：在网页输入框提供录音按钮、音量显示和转写草稿。〔一手〕[packages/experimental/client-ui-voice-input/README.zh.md:12](dsh-base:packages/experimental/client-ui-voice-input/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-voice-input-bundle](dsh-base:packages/experimental/voice-input-bundle/package.json:40)。
- **组合或预设**：可选挂载：`@liwa/experimental-voice-input-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.4 桌宠、语音、视频；另见 overall.md §9.4（行 453）](liwa:docs/liwa/product.md:453)。〔推理〕设计保留听说看画的能力层，V5 有语音；设计当前倾向线上能力服务，现有实现是本地 SenseVoice 加网页录音转文字。
- **建议：留待设计迁移方案时再定**。〔推理〕语音确有用途，但需确认是否复用此输入链、改为线上提供方，或使用独立实时语音链。

### `@liwa/experimental-speech-to-text`

- **路径与规模**：[packages/experimental/speech-to-text](dsh-base:packages/experimental/speech-to-text)；20 个文件，4 个非测试代码文件，**289 行非测试代码**。
- **做什么**：定义语音识别服务，统一选择具体识别器并执行转写。〔一手〕[packages/experimental/speech-to-text/README.zh.md:12](dsh-base:packages/experimental/speech-to-text/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-voice-input-bundle](dsh-base:packages/experimental/voice-input-bundle/package.json:37)；同宿主依赖：[@liwa/experimental-api-speech-to-text](dsh-base:packages/experimental/api-speech-to-text/package.json:54)、[@liwa/experimental-speech-to-text-sensevoice](dsh-base:packages/experimental/speech-to-text-sensevoice/package.json:45)；开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:71)、[@liwa/experimental-api-speech-to-text](dsh-base:packages/experimental/api-speech-to-text/package.json:54)、[@liwa/experimental-client-ui-voice-input](dsh-base:packages/experimental/client-ui-voice-input/package.json:53)、[@liwa/experimental-speech-to-text-sensevoice](dsh-base:packages/experimental/speech-to-text-sensevoice/package.json:45)。
- **组合或预设**：可选挂载：`@liwa/experimental-voice-input-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.4 桌宠、语音、视频；另见 overall.md §9.4（行 453）](liwa:docs/liwa/product.md:453)。〔推理〕设计保留听说看画的能力层，V5 有语音；设计当前倾向线上能力服务，现有实现是本地 SenseVoice 加网页录音转文字。
- **建议：留待设计迁移方案时再定**。〔推理〕语音确有用途，但需确认是否复用此输入链、改为线上提供方，或使用独立实时语音链。

### `@liwa/experimental-speech-to-text-sensevoice`

- **路径与规模**：[packages/experimental/speech-to-text-sensevoice](dsh-base:packages/experimental/speech-to-text-sensevoice)；39 个文件，11 个非测试代码文件，**800 行非测试代码**。
- **做什么**：在本机用 SenseVoice 与 sherpa-onnx 把录音转为文字。〔一手〕[packages/experimental/speech-to-text-sensevoice/README.zh.md:12](dsh-base:packages/experimental/speech-to-text-sensevoice/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-voice-input-bundle](dsh-base:packages/experimental/voice-input-bundle/package.json:38)。
- **组合或预设**：可选挂载：`@liwa/experimental-voice-input-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.4 桌宠、语音、视频；另见 overall.md §9.4（行 453）](liwa:docs/liwa/product.md:453)。〔推理〕设计保留听说看画的能力层，V5 有语音；设计当前倾向线上能力服务，现有实现是本地 SenseVoice 加网页录音转文字。
- **建议：留待设计迁移方案时再定**。〔推理〕语音确有用途，但需确认是否复用此输入链、改为线上提供方，或使用独立实时语音链。

### `@liwa/experimental-voice-input-bundle`

- **路径与规模**：[packages/experimental/voice-input-bundle](dsh-base:packages/experimental/voice-input-bundle)；21 个文件，2 个非测试代码文件，**3 行非测试代码**。
- **做什么**：把识别服务、本地识别器、录音接口与麦克风界面一起启用。〔一手〕[packages/experimental/voice-input-bundle/README.zh.md:12](dsh-base:packages/experimental/voice-input-bundle/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:100)；开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:72)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.4 桌宠、语音、视频；另见 overall.md §9.4（行 453）](liwa:docs/liwa/product.md:453)。〔推理〕设计保留听说看画的能力层，V5 有语音；设计当前倾向线上能力服务，现有实现是本地 SenseVoice 加网页录音转文字。
- **建议：留待设计迁移方案时再定**。〔推理〕语音确有用途，但需确认是否复用此输入链、改为线上提供方，或使用独立实时语音链。

## 8. 可选编排、任务与工作区

总体建议：工作树、PR 状态、外部事件和持久终端有潜在复用价值，等任务归属设计落地再裁；Ralph 新 agent 循环建议删。

### `@liwa/experimental-agent-team`

- **路径与规模**：[packages/experimental/agent-team](dsh-base:packages/experimental/agent-team)；34 个文件，16 个非测试代码文件，**1,789 行非测试代码**。
- **做什么**：为主 agent 建队友名单、共享任务板和 agent 间消息。〔一手〕[packages/experimental/agent-team/README.zh.md:12](dsh-base:packages/experimental/agent-team/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-agent-team-profile](dsh-base:packages/experimental/agent-team-profile/package.json:42)；同宿主依赖：[@liwa/experimental-tool-agent-team](dsh-base:packages/experimental/tool-agent-team/package.json:38)；开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:131)、[@liwa/web-frontend](dsh-base:apps/web/package.json:46)、[@liwa/experimental-client-ui-agent-team](dsh-base:packages/experimental/client-ui-agent-team/package.json:60)、[@liwa/experimental-tool-agent-team](dsh-base:packages/experimental/tool-agent-team/package.json:38)。
- **组合或预设**：可选挂载：`@liwa/experimental-agent-team-profile`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计明确有四种活、按归属实例汇报、独立工作目录；团队共享任务板与原有会话树不完全相同。
- **建议：留待设计迁移方案时再定**。〔推理〕可复用任务版本和协作机制，但不能直接把 Lead/teammate 当作成员与实例。

### `@liwa/experimental-agent-team-profile`

- **路径与规模**：[packages/experimental/agent-team-profile](dsh-base:packages/experimental/agent-team-profile)；21 个文件，1 个非测试代码文件，**1 行非测试代码**。
- **做什么**：把团队服务、模型工具和网页任务板打成一个可选组合。〔一手〕[packages/experimental/agent-team-profile/README.zh.md:12](dsh-base:packages/experimental/agent-team-profile/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:41)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计明确有四种活、按归属实例汇报、独立工作目录；团队共享任务板与原有会话树不完全相同。
- **建议：留待设计迁移方案时再定**。〔推理〕可复用任务版本和协作机制，但不能直接把 Lead/teammate 当作成员与实例。

### `@liwa/experimental-client-ui-agent-team`

- **路径与规模**：[packages/experimental/client-ui-agent-team](dsh-base:packages/experimental/client-ui-agent-team)；23 个文件，7 个非测试代码文件，**895 行非测试代码**。
- **做什么**：在网页里显示队友状态、共享任务板和队友会话入口。〔一手〕[packages/experimental/client-ui-agent-team/README.zh.md:12](dsh-base:packages/experimental/client-ui-agent-team/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-agent-team-profile](dsh-base:packages/experimental/agent-team-profile/package.json:43)。
- **组合或预设**：可选挂载：`@liwa/experimental-agent-team-profile`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计明确有四种活、按归属实例汇报、独立工作目录；团队共享任务板与原有会话树不完全相同。
- **建议：留待设计迁移方案时再定**。〔推理〕可复用任务版本和协作机制，但不能直接把 Lead/teammate 当作成员与实例。

### `@liwa/experimental-client-ui-forge`

- **路径与规模**：[packages/experimental/client-ui-forge](dsh-base:packages/experimental/client-ui-forge)；87 个文件，46 个非测试代码文件，**8,822 行非测试代码**。
- **做什么**：在侧栏展示会话相关 PR、diff 和工作树创建或恢复界面。〔一手〕[packages/experimental/client-ui-forge/README.zh.md:12](dsh-base:packages/experimental/client-ui-forge/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-forge-bundle](dsh-base:packages/experimental/forge-bundle/package.json:36)。
- **组合或预设**：可选挂载：`@liwa/experimental-forge-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.2 tasks.subscribe 外部 PR/issue 订阅（行 295）](liwa:docs/liwa/architecture/four-layers.md:295)。〔推理〕设计要展示手上活的改动、验收记录，且有 tasks.subscribe 订阅外部 PR/issue；现有 forge 有可复用的状态读取。
- **建议：留待设计迁移方案时再定**。〔推理〕等任务与 PR 的绑定、订阅入口确定后再裁，不把旧 Session 绑定直接当作新 task 绑定。

### `@liwa/experimental-forge`

- **路径与规模**：[packages/experimental/forge](dsh-base:packages/experimental/forge)；21 个文件，4 个非测试代码文件，**538 行非测试代码**。
- **做什么**：统一识别代码托管平台的变更请求，读取状态、diff，并调度共享轮询。〔一手〕[packages/experimental/forge/README.zh.md:12](dsh-base:packages/experimental/forge/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-forge-bundle](dsh-base:packages/experimental/forge-bundle/package.json:37)；同宿主依赖：[@liwa/experimental-client-ui-forge](dsh-base:packages/experimental/client-ui-forge/package.json:63)、[@liwa/experimental-forge-github](dsh-base:packages/experimental/forge-github/package.json:39)、[@liwa/experimental-forge-session](dsh-base:packages/experimental/forge-session/package.json:43)；开发/测试依赖：[@liwa/experimental-client-ui-forge](dsh-base:packages/experimental/client-ui-forge/package.json:63)、[@liwa/experimental-forge-github](dsh-base:packages/experimental/forge-github/package.json:39)、[@liwa/experimental-forge-session](dsh-base:packages/experimental/forge-session/package.json:43)；仓库根 开发/测试依赖（[package.json:284](dsh-base:package.json:284)）。
- **组合或预设**：可选挂载：`@liwa/experimental-forge-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.2 tasks.subscribe 外部 PR/issue 订阅（行 295）](liwa:docs/liwa/architecture/four-layers.md:295)。〔推理〕设计要展示手上活的改动、验收记录，且有 tasks.subscribe 订阅外部 PR/issue；现有 forge 有可复用的状态读取。
- **建议：留待设计迁移方案时再定**。〔推理〕等任务与 PR 的绑定、订阅入口确定后再裁，不把旧 Session 绑定直接当作新 task 绑定。

### `@liwa/experimental-forge-bundle`

- **路径与规模**：[packages/experimental/forge-bundle](dsh-base:packages/experimental/forge-bundle)；17 个文件，2 个非测试代码文件，**3 行非测试代码**。
- **做什么**：一次启用 forge 注册表、GitHub、会话绑定、网页面板和工作树服务。〔一手〕[packages/experimental/forge-bundle/README.zh.md:12](dsh-base:packages/experimental/forge-bundle/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:113)；开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:76)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.2 tasks.subscribe 外部 PR/issue 订阅（行 295）](liwa:docs/liwa/architecture/four-layers.md:295)。〔推理〕设计要展示手上活的改动、验收记录，且有 tasks.subscribe 订阅外部 PR/issue；现有 forge 有可复用的状态读取。
- **建议：留待设计迁移方案时再定**。〔推理〕等任务与 PR 的绑定、订阅入口确定后再裁，不把旧 Session 绑定直接当作新 task 绑定。

### `@liwa/experimental-forge-github`

- **路径与规模**：[packages/experimental/forge-github](dsh-base:packages/experimental/forge-github)；24 个文件，5 个非测试代码文件，**673 行非测试代码**。
- **做什么**：借助本机 gh 读取 GitHub PR、检查、评审和可合并状态。〔一手〕[packages/experimental/forge-github/README.zh.md:12](dsh-base:packages/experimental/forge-github/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-forge-bundle](dsh-base:packages/experimental/forge-bundle/package.json:38)；开发/测试依赖：[@liwa/experimental-forge-session](dsh-base:packages/experimental/forge-session/package.json:59)；仓库根 开发/测试依赖（[package.json:285](dsh-base:package.json:285)）。
- **组合或预设**：可选挂载：`@liwa/experimental-forge-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.2 tasks.subscribe 外部 PR/issue 订阅（行 295）](liwa:docs/liwa/architecture/four-layers.md:295)。〔推理〕设计要展示手上活的改动、验收记录，且有 tasks.subscribe 订阅外部 PR/issue；现有 forge 有可复用的状态读取。
- **建议：留待设计迁移方案时再定**。〔推理〕等任务与 PR 的绑定、订阅入口确定后再裁，不把旧 Session 绑定直接当作新 task 绑定。

### `@liwa/experimental-forge-session`

- **路径与规模**：[packages/experimental/forge-session](dsh-base:packages/experimental/forge-session)；26 个文件，6 个非测试代码文件，**655 行非测试代码**。
- **做什么**：从会话执行的 gh/git 结果中找出 PR，把它和会话绑定。〔一手〕[packages/experimental/forge-session/README.zh.md:12](dsh-base:packages/experimental/forge-session/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-forge-bundle](dsh-base:packages/experimental/forge-bundle/package.json:39)；开发/测试依赖：[@liwa/experimental-client-ui-forge](dsh-base:packages/experimental/client-ui-forge/package.json:92)；仓库根 开发/测试依赖（[package.json:286](dsh-base:package.json:286)）。
- **组合或预设**：可选挂载：`@liwa/experimental-forge-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.2 tasks.subscribe 外部 PR/issue 订阅（行 295）](liwa:docs/liwa/architecture/four-layers.md:295)。〔推理〕设计要展示手上活的改动、验收记录，且有 tasks.subscribe 订阅外部 PR/issue；现有 forge 有可复用的状态读取。
- **建议：留待设计迁移方案时再定**。〔推理〕等任务与 PR 的绑定、订阅入口确定后再裁，不把旧 Session 绑定直接当作新 task 绑定。

### `@liwa/experimental-ralph-bundle`

- **路径与规模**：[packages/experimental/ralph-bundle](dsh-base:packages/experimental/ralph-bundle)；20 个文件，1 个非测试代码文件，**1 行非测试代码**。
- **做什么**：把 Ralph 反复新开 agent 的工具加到所有 agent 上。〔一手〕[packages/experimental/ralph-bundle/README.zh.md:12](dsh-base:packages/experimental/ralph-bundle/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:104)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计的干活与想事使用持续会话及归属实例核验；Ralph 每轮新开 agent，只传一份有界报告，不独立核验完成。
- **建议：删**。〔推理〕目标循环与灵鲸任务状态机会重叠，长任务不应额外走一套轮询编排。

### `@liwa/experimental-terminal-bundle`

- **路径与规模**：[packages/experimental/terminal-bundle](dsh-base:packages/experimental/terminal-bundle)；20 个文件，1 个非测试代码文件，**1 行非测试代码**。
- **做什么**：给组合加入隔离的持久终端注册表和六个终端工具。〔一手〕[packages/experimental/terminal-bundle/README.zh.md:12](dsh-base:packages/experimental/terminal-bundle/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:106)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计需要长任务、后台作业与 CLI 子进程监管，但 CLI 原生终端与继承 agent 的 PTY 工具不是同一层。
- **建议：留待设计迁移方案时再定**。〔推理〕先定底座大脑的终端需求，再确定保留这套全局终端入口还是交给 CLI。

### `@liwa/experimental-tool-agent-team`

- **路径与规模**：[packages/experimental/tool-agent-team](dsh-base:packages/experimental/tool-agent-team)；15 个文件，1 个非测试代码文件，**418 行非测试代码**。
- **做什么**：让模型创建、联系、等待和中断队友，并读写团队任务板。〔一手〕[packages/experimental/tool-agent-team/README.zh.md:12](dsh-base:packages/experimental/tool-agent-team/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-agent-team-profile](dsh-base:packages/experimental/agent-team-profile/package.json:44)；开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:133)。
- **组合或预设**：可选挂载：`@liwa/experimental-agent-team-profile`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计明确有四种活、按归属实例汇报、独立工作目录；团队共享任务板与原有会话树不完全相同。
- **建议：留待设计迁移方案时再定**。〔推理〕可复用任务版本和协作机制，但不能直接把 Lead/teammate 当作成员与实例。

### `@liwa/tool-ralph`

- **路径与规模**：[packages/experimental/tool-ralph](dsh-base:packages/experimental/tool-ralph)；16 个文件，1 个非测试代码文件，**442 行非测试代码**。
- **做什么**：按固定目标反复创建全新 agent，直到自报完成、阻塞或达到轮数上限。〔一手〕[packages/experimental/tool-ralph/README.zh.md:12](dsh-base:packages/experimental/tool-ralph/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-ralph-bundle](dsh-base:packages/experimental/ralph-bundle/package.json:43)；开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:119)；仓库根 开发/测试依赖（[package.json:209](dsh-base:package.json:209)）。
- **组合或预设**：可选挂载：`@liwa/experimental-ralph-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计的干活与想事使用持续会话及归属实例核验；Ralph 每轮新开 agent，只传一份有界报告，不独立核验完成。
- **建议：删**。〔推理〕目标循环与灵鲸任务状态机会重叠，长任务不应额外走一套轮询编排。

### `@liwa/tool-terminal`

- **路径与规模**：[packages/experimental/tool-terminal](dsh-base:packages/experimental/tool-terminal)；19 个文件，3 个非测试代码文件，**545 行非测试代码**。
- **做什么**：让模型打开终端、发送输入、读输出、发信号和关闭终端，保留跨调用状态。〔一手〕[packages/experimental/tool-terminal/README.zh.md:12](dsh-base:packages/experimental/tool-terminal/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-terminal-bundle](dsh-base:packages/experimental/terminal-bundle/package.json:42)；开发/测试依赖：[@liwa/client-ui-tool](dsh-base:packages/client/ui-tool/package.json:60)；仓库根 开发/测试依赖（[package.json:210](dsh-base:package.json:210)）。
- **组合或预设**：可选挂载：`@liwa/experimental-terminal-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计需要长任务、后台作业与 CLI 子进程监管，但 CLI 原生终端与继承 agent 的 PTY 工具不是同一层。
- **建议：留待设计迁移方案时再定**。〔推理〕先定底座大脑的终端需求，再确定保留这套全局终端入口还是交给 CLI。

### `@liwa/experimental-tool-worktree`

- **路径与规模**：[packages/experimental/tool-worktree](dsh-base:packages/experimental/tool-worktree)；21 个文件，1 个非测试代码文件，**33 行非测试代码**。
- **做什么**：给模型一个创建并进入工作树的工具，同时作为可选 bundle 入口。〔一手〕[packages/experimental/tool-worktree/README.zh.md:12](dsh-base:packages/experimental/tool-worktree/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:109)；仓库根 开发/测试依赖（[package.json:279](dsh-base:package.json:279)）。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1 干活的工作区档：CLI 原生工具限本 worktree（行 283）](liwa:docs/liwa/architecture/four-layers.md:283)。〔推理〕第三层干活明确使用独立 worktree；现有实现把创建工作树与切换 Session 工作目录绑在一起。
- **建议：留待设计迁移方案时再定**。〔推理〕工作树机制值得复用，归属应接到灵鲸 task/workspace，而不是直接沿用会话目录语义。

### `@liwa/webhook`

- **路径与规模**：[packages/experimental/webhook](dsh-base:packages/experimental/webhook)；20 个文件，4 个非测试代码文件，**361 行非测试代码**。
- **做什么**：接受经认证的外部事件，按规则启动新的工作区根会话。〔一手〕[packages/experimental/webhook/README.zh.md:12](dsh-base:packages/experimental/webhook/README.zh.md:12)。
- **谁依赖**：同宿主依赖：[@liwa/webhook-github](dsh-base:packages/experimental/webhook-github/package.json:44)；开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:118)、[@liwa/webhook-github](dsh-base:packages/experimental/webhook-github/package.json:44)。
- **组合或预设**：另有 webhook-github/examples/github-review/cordis.yml 示例组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.2 tasks.subscribe 外部 PR/issue 订阅（行 295）](liwa:docs/liwa/architecture/four-layers.md:295)。〔推理〕设计已定 PR/issue 订阅直通，把外部线程事件送到已有活；当前 webhook 的内置动作却是创建新根会话。
- **建议：留待设计迁移方案时再定**。〔推理〕认证、验签和路由可复用，必须先设计送到已有 task 的接缝。

### `@liwa/webhook-github`

- **路径与规模**：[packages/experimental/webhook-github](dsh-base:packages/experimental/webhook-github)；23 个文件，5 个非测试代码文件，**290 行非测试代码**。
- **做什么**：为 GitHub webhook 提供请求大小检查、签名核验和事件转换。〔一手〕[packages/experimental/webhook-github/README.zh.md:12](dsh-base:packages/experimental/webhook-github/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:117)。
- **组合或预设**：另有 webhook-github/examples/github-review/cordis.yml 示例组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.2 tasks.subscribe 外部 PR/issue 订阅（行 295）](liwa:docs/liwa/architecture/four-layers.md:295)。〔推理〕设计已定 PR/issue 订阅直通，把外部线程事件送到已有活；当前 webhook 的内置动作却是创建新根会话。
- **建议：留待设计迁移方案时再定**。〔推理〕认证、验签和路由可复用，必须先设计送到已有 task 的接缝。

### `@liwa/experimental-worktree`

- **路径与规模**：[packages/experimental/worktree](dsh-base:packages/experimental/worktree)；22 个文件，5 个非测试代码文件，**393 行非测试代码**。
- **做什么**：从本地 Git 提交创建分支和工作树，并把当前会话切过去。〔一手〕[packages/experimental/worktree/README.zh.md:12](dsh-base:packages/experimental/worktree/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-forge-bundle](dsh-base:packages/experimental/forge-bundle/package.json:40)、[@liwa/experimental-tool-worktree](dsh-base:packages/experimental/tool-worktree/package.json:38)；同宿主依赖：[@liwa/experimental-client-ui-forge](dsh-base:packages/experimental/client-ui-forge/package.json:60)、[@liwa/experimental-tool-worktree](dsh-base:packages/experimental/tool-worktree/package.json:38)；开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:74)、[@liwa/experimental-client-ui-forge](dsh-base:packages/experimental/client-ui-forge/package.json:60)、[@liwa/experimental-tool-worktree](dsh-base:packages/experimental/tool-worktree/package.json:38)；仓库根 开发/测试依赖（[package.json:278](dsh-base:package.json:278)）。
- **组合或预设**：可选挂载：`@liwa/experimental-tool-worktree`、`@liwa/experimental-forge-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1 干活的工作区档：CLI 原生工具限本 worktree（行 283）](liwa:docs/liwa/architecture/four-layers.md:283)。〔推理〕第三层干活明确使用独立 worktree；现有实现把创建工作树与切换 Session 工作目录绑在一起。
- **建议：留待设计迁移方案时再定**。〔推理〕工作树机制值得复用，归属应接到灵鲸 task/workspace，而不是直接沿用会话目录语义。

## 9. 查询、记忆与存储候选

总体建议：三包都待定；现成“搜索”和“SQLite”不代表已经满足灵鲸记忆的受众、来源、全文与向量语义。

### `@liwa/experimental-session-search`

- **路径与规模**：[packages/experimental/session-search](dsh-base:packages/experimental/session-search)；20 个文件，1 个非测试代码文件，**1 行非测试代码**。
- **做什么**：启用历史会话全文搜索索引和五个全局查询工具。〔一手〕[packages/experimental/session-search/README.zh.md:12](dsh-base:packages/experimental/session-search/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:108)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/05-memory.md §0、§4.4 受众、来源、五路召回与原文补位（行 400）](liwa:docs/liwa/architecture/modules/05-memory.md:400)。〔推理〕记忆设计要求来源、受众、证据、遗忘与混合召回；这些包只搜索会话原文，按 cwd 隔离，不能替代记忆系统。
- **建议：留待设计迁移方案时再定**。〔推理〕可作原文补位或开发者日志查询候选，先把访问控制改造边界定下来再裁。

### `@liwa/tool-session-query`

- **路径与规模**：[packages/experimental/tool-session-query](dsh-base:packages/experimental/tool-session-query)；21 个文件，6 个非测试代码文件，**1,288 行非测试代码**。
- **做什么**：让模型搜索、追踪和读取同工作目录下的旧会话事件。〔一手〕[packages/experimental/tool-session-query/README.zh.md:12](dsh-base:packages/experimental/tool-session-query/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-session-search](dsh-base:packages/experimental/session-search/package.json:44)；开发/测试依赖：[@liwa/client-ui-tool](dsh-base:packages/client/ui-tool/package.json:59)；仓库根 开发/测试依赖（[package.json:226](dsh-base:package.json:226)）。
- **组合或预设**：可选挂载：`@liwa/experimental-session-search`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/05-memory.md §0、§4.4 受众、来源、五路召回与原文补位（行 400）](liwa:docs/liwa/architecture/modules/05-memory.md:400)。〔推理〕记忆设计要求来源、受众、证据、遗忘与混合召回；这些包只搜索会话原文，按 cwd 隔离，不能替代记忆系统。
- **建议：留待设计迁移方案时再定**。〔推理〕可作原文补位或开发者日志查询候选，先把访问控制改造边界定下来再裁。

### `@liwa/storage-sqlite`

- **路径与规模**：[packages/storage/storage-sqlite](dsh-base:packages/storage/storage-sqlite)；17 个文件，3 个非测试代码文件，**366 行非测试代码**。
- **做什么**：把通用键值存储里的每条 JSON 记录存成 SQLite 的一行。〔一手〕[packages/storage/storage-sqlite/README.zh.md:12](dsh-base:packages/storage/storage-sqlite/README.zh.md:12)。
- **谁依赖**：没有工作区包在清单或非测试静态导入中依赖它。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/05-memory.md §0、§4.4 受众、来源、五路召回与原文补位（行 400）](liwa:docs/liwa/architecture/modules/05-memory.md:400)。〔推理〕设计明确使用 SQLite，但记忆与经历流需要有结构的表、全文与向量；本包只把 KV 的 JSON 文档存进 SQLite。
- **建议：留待设计迁移方案时再定**。〔推理〕不能因同叫 SQLite 就认为可直接承接记忆；等账本与 storage 边界确定再判断是否复用。

## 10. 插件市场、推广与自动创建页面

总体建议：十二包建议删；灵鲸无插件市场、无推广徽章、无模型动态安装页面的已定产品需求。

### `@liwa/plugin-market-generator`

- **路径与规模**：[apps/plugin-market-generator](dsh-base:apps/plugin-market-generator)；18 个文件，8 个非测试代码文件，**1,206 行非测试代码**。
- **做什么**：读取 npm 包名和 Git 仓库列表，生成插件市场目录文件。〔一手〕[apps/plugin-market-generator/README.zh.md:9](dsh-base:apps/plugin-market-generator/README.zh.md:9)。
- **谁依赖**：没有工作区包在清单或非测试静态导入中依赖它。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/client-ui-plugin-market`

- **路径与规模**：[packages/client/ui-plugin-market](dsh-base:packages/client/ui-plugin-market)；29 个文件，9 个非测试代码文件，**2,149 行非测试代码**。
- **做什么**：给插件页加入发现标签、市场搜索和下载安装界面。〔一手〕[packages/client/ui-plugin-market/README.zh.md:12](dsh-base:packages/client/ui-plugin-market/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-plugin-market-bundle](dsh-base:packages/experimental/plugin-market-bundle/package.json:37)。
- **组合或预设**：可选挂载：`@liwa/experimental-plugin-market-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/action-cards`

- **路径与规模**：[packages/experimental/action-cards](dsh-base:packages/experimental/action-cards)；24 个文件，4 个非测试代码文件，**526 行非测试代码**。
- **做什么**：在回答后记录一个待主人点击的动作建议，保存执行和撤销状态。〔一手〕[packages/experimental/action-cards/README.zh.md:12](dsh-base:packages/experimental/action-cards/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/creation-recommendations](dsh-base:packages/experimental/creation-recommendations/package.json:59)、[@liwa/personalized-recommendations](dsh-base:packages/experimental/personalized-recommendations/package.json:37)、[@liwa/plugin-recommendations](dsh-base:packages/experimental/plugin-recommendations/package.json:59)；开发/测试依赖：[@liwa/client-ui-action-cards](dsh-base:packages/experimental/client-ui-action-cards/package.json:60)、[@liwa/client-ui-creation-recommendations](dsh-base:packages/experimental/client-ui-creation-recommendations/package.json:52)、[@liwa/client-ui-plugin-recommendations](dsh-base:packages/experimental/client-ui-plugin-recommendations/package.json:59)；仓库根 开发/测试依赖（[package.json:287](dsh-base:package.json:287)）。
- **组合或预设**：可选挂载：`@liwa/personalized-recommendations`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/experimental-badge-skill-bundle`

- **路径与规模**：[packages/experimental/badge-skill-bundle](dsh-base:packages/experimental/badge-skill-bundle)；20 个文件，1 个非测试代码文件，**1 行非测试代码**。
- **做什么**：把推广徽章技能作为可选组合一起启用。〔一手〕[packages/experimental/badge-skill-bundle/README.zh.md:12](dsh-base:packages/experimental/badge-skill-bundle/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:103)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/client-ui-action-cards`

- **路径与规模**：[packages/experimental/client-ui-action-cards](dsh-base:packages/experimental/client-ui-action-cards)；27 个文件，10 个非测试代码文件，**332 行非测试代码**。
- **做什么**：把动作建议显示成回答下面的卡片、按钮和状态。〔一手〕[packages/experimental/client-ui-action-cards/README.zh.md:12](dsh-base:packages/experimental/client-ui-action-cards/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/creation-recommendations](dsh-base:packages/experimental/creation-recommendations/package.json:60)、[@liwa/personalized-recommendations](dsh-base:packages/experimental/personalized-recommendations/package.json:38)、[@liwa/plugin-recommendations](dsh-base:packages/experimental/plugin-recommendations/package.json:60)；开发/测试依赖：[@liwa/client-ui-creation-recommendations](dsh-base:packages/experimental/client-ui-creation-recommendations/package.json:35)、[@liwa/client-ui-plugin-recommendations](dsh-base:packages/experimental/client-ui-plugin-recommendations/package.json:37)。
- **组合或预设**：可选挂载：`@liwa/personalized-recommendations`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/client-ui-creation-recommendations`

- **路径与规模**：[packages/experimental/client-ui-creation-recommendations](dsh-base:packages/experimental/client-ui-creation-recommendations)；25 个文件，8 个非测试代码文件，**610 行非测试代码**。
- **做什么**：显示自动创建页面的方案、进度、保留、撤销和恢复按钮。〔一手〕[packages/experimental/client-ui-creation-recommendations/README.zh.md:12](dsh-base:packages/experimental/client-ui-creation-recommendations/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/creation-recommendations](dsh-base:packages/experimental/creation-recommendations/package.json:58)、[@liwa/personalized-recommendations](dsh-base:packages/experimental/personalized-recommendations/package.json:40)。
- **组合或预设**：可选挂载：`@liwa/personalized-recommendations`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/client-ui-plugin-recommendations`

- **路径与规模**：[packages/experimental/client-ui-plugin-recommendations](dsh-base:packages/experimental/client-ui-plugin-recommendations)；23 个文件，7 个非测试代码文件，**399 行非测试代码**。
- **做什么**：显示官方插件推荐卡片、说明和启用按钮。〔一手〕[packages/experimental/client-ui-plugin-recommendations/README.zh.md:12](dsh-base:packages/experimental/client-ui-plugin-recommendations/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/personalized-recommendations](dsh-base:packages/experimental/personalized-recommendations/package.json:42)、[@liwa/plugin-recommendations](dsh-base:packages/experimental/plugin-recommendations/package.json:58)。
- **组合或预设**：可选挂载：`@liwa/personalized-recommendations`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/creation-recommendations`

- **路径与规模**：[packages/experimental/creation-recommendations](dsh-base:packages/experimental/creation-recommendations)；31 个文件，5 个非测试代码文件，**470 行非测试代码**。
- **做什么**：根据聊天需要提议生成一个新界面插件，并在确认后生成、安装。〔一手〕[packages/experimental/creation-recommendations/README.zh.md:12](dsh-base:packages/experimental/creation-recommendations/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/personalized-recommendations](dsh-base:packages/experimental/personalized-recommendations/package.json:39)；开发/测试依赖：[@liwa/client-ui-creation-recommendations](dsh-base:packages/experimental/client-ui-creation-recommendations/package.json:49)。
- **组合或预设**：可选挂载：`@liwa/personalized-recommendations`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/personalized-recommendations`

- **路径与规模**：[packages/experimental/personalized-recommendations](dsh-base:packages/experimental/personalized-recommendations)；22 个文件，2 个非测试代码文件，**3 行非测试代码**。
- **做什么**：把自动创建页面和推荐启用官方插件的卡片一起启用。〔一手〕[packages/experimental/personalized-recommendations/README.zh.md:12](dsh-base:packages/experimental/personalized-recommendations/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:112)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/experimental-plugin-market-bundle`

- **路径与规模**：[packages/experimental/plugin-market-bundle](dsh-base:packages/experimental/plugin-market-bundle)；21 个文件，2 个非测试代码文件，**3 行非测试代码**。
- **做什么**：把自定义市场索引服务和网页发现页一起挂上。〔一手〕[packages/experimental/plugin-market-bundle/README.zh.md:12](dsh-base:packages/experimental/plugin-market-bundle/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:111)；开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:75)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/plugin-recommendations`

- **路径与规模**：[packages/experimental/plugin-recommendations](dsh-base:packages/experimental/plugin-recommendations)；27 个文件，4 个非测试代码文件，**180 行非测试代码**。
- **做什么**：根据对话推荐启用随附插件，并把选择写回 profile。〔一手〕[packages/experimental/plugin-recommendations/README.zh.md:12](dsh-base:packages/experimental/plugin-recommendations/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/personalized-recommendations](dsh-base:packages/experimental/personalized-recommendations/package.json:41)；开发/测试依赖：[@liwa/client-ui-plugin-recommendations](dsh-base:packages/experimental/client-ui-plugin-recommendations/package.json:53)。
- **组合或预设**：可选挂载：`@liwa/personalized-recommendations`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

### `@liwa/skill-badge`

- **路径与规模**：[packages/experimental/skill-badge](dsh-base:packages/experimental/skill-badge)；18 个文件，1 个非测试代码文件，**47 行非测试代码**。
- **做什么**：给 agent 一份向文档或 PR 添加 powered by liwa 徽章的技能。〔一手〕[packages/experimental/skill-badge/README.zh.md:12](dsh-base:packages/experimental/skill-badge/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-badge-skill-bundle](dsh-base:packages/experimental/badge-skill-bundle/package.json:42)；开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:116)。
- **组合或预设**：可选挂载：`@liwa/experimental-badge-skill-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §16：无市场、插件都在仓库、CLI 自己拉 MCP（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕插件设计原文明确无市场、插件都在仓库；产品也没有给作品自动加推广徽章或按聊天动态安装界面的要求。
- **建议：删**。〔推理〕属于继承产品的分发、推广和动态安装能力，建议整组按依赖一起裁。

## 11. SSH 远端执行

总体建议：五包成组待定，关键只需主人先选是否保留跨 Mac 的远程工作区；它们支持 POSIX，不属于 Linux 专用包。

### `@liwa/fs-ssh`

- **路径与规模**：[packages/ssh/fs-ssh](dsh-base:packages/ssh/fs-ssh)；15 个文件，1 个非测试代码文件，**87 行非测试代码**。
- **做什么**：让文件工具通过 SSH 读写远端文件系统。〔一手〕[packages/ssh/fs-ssh/README.zh.md:12](dsh-base:packages/ssh/fs-ssh/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/ssh-helper-runtime](dsh-base:packages/ssh/ssh-helper-runtime/package.json:27)、[@liwa/ssh](dsh-base:packages/ssh/ssh/package.json:79)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 handoff.md 已定的决策 44：仅 Apple 芯片 Mac、本机打包，SSH helper 留删待裁剪（行 160）](liwa:docs/liwa/handoff.md:160)。〔推理〕常驻本机不等于任务永远不能连另一台 Mac；决策 44 专门把 SSH helper 的留删放到裁剪时决定。
- **建议：留待设计迁移方案时再定**。〔推理〕先由主人确认是否需要从本机到另一台 Mac 的远程工作区；若不要，这五包可以成组删。

### `@liwa/sandbox-ssh`

- **路径与规模**：[packages/ssh/sandbox-ssh](dsh-base:packages/ssh/sandbox-ssh)；15 个文件，1 个非测试代码文件，**27 行非测试代码**。
- **做什么**：让远端执行使用远端已有的沙箱能力。〔一手〕[packages/ssh/sandbox-ssh/README.zh.md:12](dsh-base:packages/ssh/sandbox-ssh/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/ssh-helper-runtime](dsh-base:packages/ssh/ssh-helper-runtime/package.json:29)、[@liwa/ssh](dsh-base:packages/ssh/ssh/package.json:81)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 handoff.md 已定的决策 44：仅 Apple 芯片 Mac、本机打包，SSH helper 留删待裁剪（行 160）](liwa:docs/liwa/handoff.md:160)。〔推理〕常驻本机不等于任务永远不能连另一台 Mac；决策 44 专门把 SSH helper 的留删放到裁剪时决定。
- **建议：留待设计迁移方案时再定**。〔推理〕先由主人确认是否需要从本机到另一台 Mac 的远程工作区；若不要，这五包可以成组删。

### `@liwa/ssh`

- **路径与规模**：[packages/ssh/ssh](dsh-base:packages/ssh/ssh)；43 个文件，8 个非测试代码文件，**1,239 行非测试代码**。
- **做什么**：用 OpenSSH 连接远端 POSIX 主机，并管理受校验的远端 helper 会话。〔一手〕[packages/ssh/ssh/README.zh.md:12](dsh-base:packages/ssh/ssh/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/ssh-helper-runtime](dsh-base:packages/ssh/ssh-helper-runtime/package.json:52)；同宿主依赖：[@liwa/fs-ssh](dsh-base:packages/ssh/fs-ssh/package.json:33)、[@liwa/sandbox-ssh](dsh-base:packages/ssh/sandbox-ssh/package.json:33)、[@liwa/subprocess-ssh](dsh-base:packages/ssh/subprocess-ssh/package.json:33)；开发/测试依赖：[@liwa/fs-ssh](dsh-base:packages/ssh/fs-ssh/package.json:33)、[@liwa/sandbox-ssh](dsh-base:packages/ssh/sandbox-ssh/package.json:33)、[@liwa/subprocess-ssh](dsh-base:packages/ssh/subprocess-ssh/package.json:33)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 handoff.md 已定的决策 44：仅 Apple 芯片 Mac、本机打包，SSH helper 留删待裁剪（行 160）](liwa:docs/liwa/handoff.md:160)。〔推理〕常驻本机不等于任务永远不能连另一台 Mac；决策 44 专门把 SSH helper 的留删放到裁剪时决定。
- **建议：留待设计迁移方案时再定**。〔推理〕先由主人确认是否需要从本机到另一台 Mac 的远程工作区；若不要，这五包可以成组删。

### `@liwa/ssh-helper-runtime`

- **路径与规模**：[packages/ssh/ssh-helper-runtime](dsh-base:packages/ssh/ssh-helper-runtime)；11 个文件，1 个非测试代码文件，**29 行非测试代码**。
- **做什么**：把远端 helper 和运行时打成单个本地可执行载体，远端不必预装 Node。〔一手〕[packages/ssh/ssh-helper-runtime/README.zh.md:12](dsh-base:packages/ssh/ssh-helper-runtime/README.zh.md:12)。
- **谁依赖**：没有工作区包在清单或非测试静态导入中依赖它。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 handoff.md 已定的决策 44：仅 Apple 芯片 Mac、本机打包，SSH helper 留删待裁剪（行 160）](liwa:docs/liwa/handoff.md:160)。〔推理〕常驻本机不等于任务永远不能连另一台 Mac；决策 44 专门把 SSH helper 的留删放到裁剪时决定。
- **建议：留待设计迁移方案时再定**。〔推理〕先由主人确认是否需要从本机到另一台 Mac 的远程工作区；若不要，这五包可以成组删。

### `@liwa/subprocess-ssh`

- **路径与规模**：[packages/ssh/subprocess-ssh](dsh-base:packages/ssh/subprocess-ssh)；19 个文件，1 个非测试代码文件，**322 行非测试代码**。
- **做什么**：让命令、作业和终端通过 SSH 在远端 helper 中运行。〔一手〕[packages/ssh/subprocess-ssh/README.zh.md:12](dsh-base:packages/ssh/subprocess-ssh/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/ssh-helper-runtime](dsh-base:packages/ssh/ssh-helper-runtime/package.json:28)、[@liwa/ssh](dsh-base:packages/ssh/ssh/package.json:80)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 handoff.md 已定的决策 44：仅 Apple 芯片 Mac、本机打包，SSH helper 留删待裁剪（行 160）](liwa:docs/liwa/handoff.md:160)。〔推理〕常驻本机不等于任务永远不能连另一台 Mac；决策 44 专门把 SSH helper 的留删放到裁剪时决定。
- **建议：留待设计迁移方案时再定**。〔推理〕先由主人确认是否需要从本机到另一台 Mac 的远程工作区；若不要，这五包可以成组删。

## 12. 其他实验与替代实现

总体建议：无设计用途的分享、翻译、刷新标题、浏览器后台预览和旧兼容选择器可删；搜索厂商选择等能力归属明确后再定。

### `@liwa/tmux-context`

- **路径与规模**：[packages/context/tmux-context](dsh-base:packages/context/tmux-context)；15 个文件，1 个非测试代码文件，**196 行非测试代码**。
- **做什么**：在会话历史里补充当前 tmux 会话、窗口、窗格和布局位置。〔一手〕[packages/context/tmux-context/README.zh.md:12](dsh-base:packages/context/tmux-context/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:68)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计的实例在本机长期运行，CLI 工作用自己原生工具；没有给模型注入 tmux 窗格位置或再开一套编辑器的要求。
- **建议：删**。〔推理〕分别是小众终端上下文和默认文件工具的替代写法，没有已定用途。

### `@liwa/agent-tool-presentation`

- **路径与规模**：[packages/core/agent-tool-presentation](dsh-base:packages/core/agent-tool-presentation)；15 个文件，1 个非测试代码文件，**15 行非测试代码**。
- **做什么**：旧版工具呈现模式选择器，按 mode 选择原生工具或 run_code。〔一手〕[packages/core/agent-tool-presentation/README.zh.md:10](dsh-base:packages/core/agent-tool-presentation/README.zh.md:10)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:30)、[liwa-python-runtime-closure](dsh-base:python/sdk-runtime/package.json:21)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/modules/00-plugin-kernel.md §12 测试、§16 与继承底座的插件化对照（行 449）](liwa:docs/liwa/architecture/modules/00-plugin-kernel.md:449)。〔推理〕默认预设已直接选择原生或 PTC 工具执行器；本包原文已标弃用，只为旧配置保留。
- **建议：删**。〔推理〕自用项目不保留旧选择器兼容层，若存在使用方应在其原配置改成实际执行器。

### `@liwa/experimental-auto-review`

- **路径与规模**：[packages/experimental/auto-review](dsh-base:packages/experimental/auto-review)；24 个文件，2 个非测试代码文件，**809 行非测试代码**。
- **做什么**：每次工具执行前再请当前模型审查是否放行，拒绝时转人工审批。〔一手〕[packages/experimental/auto-review/README.zh.md:12](dsh-base:packages/experimental/auto-review/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:101)；开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:70)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §11.1–§11.9 身份、受众、守护与能力边界（行 1237）](liwa:docs/liwa/architecture/overall.md:1237)。〔推理〕设计把守护边界留给本体代码，判断交给她；当前自动评审在每次工具前额外调用模型并改变审批模式。
- **建议：删**。〔推理〕没有已定需求要求这条工具前模型审批链，还会多花 token。

### `@liwa/experimental-client-ui-cot-translation`

- **路径与规模**：[packages/experimental/client-ui-cot-translation](dsh-base:packages/experimental/client-ui-cot-translation)；34 个文件，12 个非测试代码文件，**609 行非测试代码**。
- **做什么**：把展开的模型思考内容切换为译文，原始记录仍保留原文。〔一手〕[packages/experimental/client-ui-cot-translation/README.zh.md:12](dsh-base:packages/experimental/client-ui-cot-translation/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-cot-translation-bundle](dsh-base:packages/experimental/cot-translation-bundle/package.json:38)；开发/测试依赖：[@liwa/experimental-liveshare](dsh-base:packages/experimental/liveshare/package.json:129)。
- **组合或预设**：可选挂载：`@liwa/experimental-cot-translation-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.2 主控台与开发者视图（行 433）](liwa:docs/liwa/product.md:433)。〔推理〕产品有开发者视图，但没有把模型思考过程另送翻译服务的需求；这不属于记忆、成长或说话能力。
- **建议：删**。〔推理〕目前没有设计用途，且要维护额外翻译提供方和持久化结果。

### `@liwa/experimental-cot-translation-bundle`

- **路径与规模**：[packages/experimental/cot-translation-bundle](dsh-base:packages/experimental/cot-translation-bundle)；21 个文件，2 个非测试代码文件，**3 行非测试代码**。
- **做什么**：一起启用思考过程翻译服务和网页翻译显示。〔一手〕[packages/experimental/cot-translation-bundle/README.zh.md:12](dsh-base:packages/experimental/cot-translation-bundle/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:102)；开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:73)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.2 主控台与开发者视图（行 433）](liwa:docs/liwa/product.md:433)。〔推理〕产品有开发者视图，但没有把模型思考过程另送翻译服务的需求；这不属于记忆、成长或说话能力。
- **建议：删**。〔推理〕目前没有设计用途，且要维护额外翻译提供方和持久化结果。

### `@liwa/experimental-liveshare`

- **路径与规模**：[packages/experimental/liveshare](dsh-base:packages/experimental/liveshare)；255 个文件，86 个非测试代码文件，**14,730 行非测试代码**。
- **做什么**：通过外部 Relay 把一个会话分享给别人查看或有限操作。〔一手〕[packages/experimental/liveshare/README.zh.md:12](dsh-base:packages/experimental/liveshare/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:107)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §11.1–§11.9 身份、受众、守护与能力边界（行 1237）](liwa:docs/liwa/architecture/overall.md:1237)。〔推理〕设计确有多人、多端和受众隔离，但没有外部 Relay 的会话分享、分享者登录和协同写入产品。
- **建议：删**。〔推理〕多端连接应围绕本机本体的身份与受众设计；这套分享产品另有认证和授权模型。

### `@liwa/experimental-liveshare-protocol`

- **路径与规模**：[packages/experimental/liveshare-protocol](dsh-base:packages/experimental/liveshare-protocol)；42 个文件，9 个非测试代码文件，**739 行非测试代码**。
- **做什么**：定义会话分享端与 Relay 之间一致使用的身份和通信帧。〔一手〕[packages/experimental/liveshare-protocol/README.zh.md:12](dsh-base:packages/experimental/liveshare-protocol/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-liveshare](dsh-base:packages/experimental/liveshare/package.json:67)。
- **组合或预设**：虽不另挂行，但在这些可选 bundle 的依赖闭包中：`@liwa/experimental-liveshare`。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §11.1–§11.9 身份、受众、守护与能力边界（行 1237）](liwa:docs/liwa/architecture/overall.md:1237)。〔推理〕设计确有多人、多端和受众隔离，但没有外部 Relay 的会话分享、分享者登录和协同写入产品。
- **建议：删**。〔推理〕多端连接应围绕本机本体的身份与受众设计；这套分享产品另有认证和授权模型。

### `@liwa/experimental-ptc-runtime-python`

- **路径与规模**：[packages/experimental/ptc-runtime-python](dsh-base:packages/experimental/ptc-runtime-python)；27 个文件，6 个非测试代码文件，**3,867 行非测试代码**。
- **做什么**：启动 CPython 执行模型生成的 Python，把已配置工具绑定给程序调用。〔一手〕[packages/experimental/ptc-runtime-python/README.zh.md:12](dsh-base:packages/experimental/ptc-runtime-python/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/cli](dsh-base:apps/cli/package.json:132)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计让 agent CLI 自带编程工具，底座已有 Node PTC；没有再提供 Python PTC 执行器的需求。
- **建议：删**。〔推理〕是另一种模型代码执行后端，不是 Python SDK；建议本批评估删除以免被 SDK 豁免漏掉。

### `@liwa/session-title-all-prompts-llm`

- **路径与规模**：[packages/experimental/session-title-all-prompts-llm](dsh-base:packages/experimental/session-title-all-prompts-llm)；15 个文件，1 个非测试代码文件，**160 行非测试代码**。
- **做什么**：每来一条用户消息就重新总结整个会话标题。〔一手〕[packages/experimental/session-title-all-prompts-llm/README.zh.md:12](dsh-base:packages/experimental/session-title-all-prompts-llm/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-session-titles-bundle](dsh-base:packages/experimental/session-titles-bundle/package.json:42)。
- **组合或预设**：可选挂载：`@liwa/experimental-session-titles-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.2 主控台与开发者视图（行 433）](liwa:docs/liwa/product.md:433)。〔推理〕主控台以她和手上的事为中心，默认已有首条提示标题；设计没有每次提示后再生成标题的要求。
- **建议：删**。〔推理〕只增加标题刷新策略和额外模型工作，缺少目标用途。

### `@liwa/experimental-session-titles-bundle`

- **路径与规模**：[packages/experimental/session-titles-bundle](dsh-base:packages/experimental/session-titles-bundle)；20 个文件，1 个非测试代码文件，**1 行非测试代码**。
- **做什么**：用全消息标题提供方替换默认首消息标题提供方。〔一手〕[packages/experimental/session-titles-bundle/README.zh.md:12](dsh-base:packages/experimental/session-titles-bundle/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:105)。
- **组合或预设**：本身是随附可选 bundle，五个默认 profile 都不选择它。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.2 主控台与开发者视图（行 433）](liwa:docs/liwa/product.md:433)。〔推理〕主控台以她和手上的事为中心，默认已有首条提示标题；设计没有每次提示后再生成标题的要求。
- **建议：删**。〔推理〕只增加标题刷新策略和额外模型工作，缺少目标用途。

### `@liwa/experimental-translator`

- **路径与规模**：[packages/experimental/translator](dsh-base:packages/experimental/translator)；31 个文件，6 个非测试代码文件，**615 行非测试代码**。
- **做什么**：调用 Bing、Google 或显式选择的 DeepSeek 路由翻译文字，并缓存结果。〔一手〕[packages/experimental/translator/README.zh.md:12](dsh-base:packages/experimental/translator/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-cot-translation-bundle](dsh-base:packages/experimental/cot-translation-bundle/package.json:37)；同宿主依赖：[@liwa/experimental-client-ui-cot-translation](dsh-base:packages/experimental/client-ui-cot-translation/package.json:59)；开发/测试依赖：[@liwa/experimental-client-ui-cot-translation](dsh-base:packages/experimental/client-ui-cot-translation/package.json:59)、[@liwa/sdk-client](dsh-base:packages/sdk/client/package.json:42)。
- **组合或预设**：可选挂载：`@liwa/experimental-cot-translation-bundle`。
- **和灵鲸的关系**：〔一手〕[灵鲸 product.md §8.2 主控台与开发者视图（行 433）](liwa:docs/liwa/product.md:433)。〔推理〕产品有开发者视图，但没有把模型思考过程另送翻译服务的需求；这不属于记忆、成长或说话能力。
- **建议：删**。〔推理〕目前没有设计用途，且要维护额外翻译提供方和持久化结果。

### `@liwa/experimental-webworker-packer`

- **路径与规模**：[packages/experimental/webworker-packer](dsh-base:packages/experimental/webworker-packer)；21 个文件，9 个非测试代码文件，**1,140 行非测试代码**。
- **做什么**：把后台构建产物与数据打成浏览器预览 Worker 可以加载的虚拟文件系统归档。〔一手〕[packages/experimental/webworker-packer/README.zh.md:12](dsh-base:packages/experimental/webworker-packer/README.zh.md:12)。
- **谁依赖**：开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:47)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 handoff.md 已定的决策 44：仅 Apple 芯片 Mac、本机打包，SSH helper 留删待裁剪（行 160）](liwa:docs/liwa/handoff.md:160)。〔推理〕本体常驻本机 Node，网页是连接本体的窗口；没有把整套后台放进浏览器运行的产品目标。
- **建议：删**。〔推理〕浏览器预览平台与 Mac 本机产品方向不同，建议两包和预览入口一并裁。

### `@liwa/experimental-webworker-runtime`

- **路径与规模**：[packages/experimental/webworker-runtime](dsh-base:packages/experimental/webworker-runtime)；163 个文件，98 个非测试代码文件，**11,170 行非测试代码**。
- **做什么**：在浏览器 Worker 内模拟 Node、文件系统和网络，运行整套灵鲸后台作无服务器预览。〔一手〕[packages/experimental/webworker-runtime/README.zh.md:12](dsh-base:packages/experimental/webworker-runtime/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/experimental-webworker-packer](dsh-base:packages/experimental/webworker-packer/package.json:38)；开发/测试依赖：[@liwa/web-frontend](dsh-base:apps/web/package.json:48)。
- **组合或预设**：没有随附可选 bundle 或默认 preset 挂载；若是工具或入口，调用见上列依赖及下文专项检查。
- **和灵鲸的关系**：〔一手〕[灵鲸 handoff.md 已定的决策 44：仅 Apple 芯片 Mac、本机打包，SSH helper 留删待裁剪（行 160）](liwa:docs/liwa/handoff.md:160)。〔推理〕本体常驻本机 Node，网页是连接本体的窗口；没有把整套后台放进浏览器运行的产品目标。
- **建议：删**。〔推理〕浏览器预览平台与 Mac 本机产品方向不同，建议两包和预览入口一并裁。

### `@liwa/tool-str-replace-editor`

- **路径与规模**：[packages/fs/tool-str-replace-editor](dsh-base:packages/fs/tool-str-replace-editor)；15 个文件，1 个非测试代码文件，**513 行非测试代码**。
- **做什么**：给模型一个 Claude 风格的单工具编辑器，能看、建、替换和插入文件。〔一手〕[packages/fs/tool-str-replace-editor/README.zh.md:12](dsh-base:packages/fs/tool-str-replace-editor/README.zh.md:12)。
- **谁依赖**：直接依赖：[@liwa/cli](dsh-base:apps/cli/package.json:83)、[liwa-python-runtime-closure](dsh-base:python/sdk-runtime/package.json:130)；开发/测试依赖：[@liwa/workspace-changes](dsh-base:packages/deliverables/workspace-changes/package.json:64)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/four-layers.md §3.1–§3.2 活的种类、工具档与协议（行 281）](liwa:docs/liwa/architecture/four-layers.md:281)。〔推理〕设计的实例在本机长期运行，CLI 工作用自己原生工具；没有给模型注入 tmux 窗格位置或再开一套编辑器的要求。
- **建议：删**。〔推理〕分别是小众终端上下文和默认文件工具的替代写法，没有已定用途。

### `@liwa/web-search-exa`

- **路径与规模**：[packages/web/web-search-exa](dsh-base:packages/web/web-search-exa)；19 个文件，3 个非测试代码文件，**176 行非测试代码**。
- **做什么**：用 Exa 搜索网页，返回摘录、来源和发布日期。〔一手〕[packages/web/web-search-exa/README.zh.md:12](dsh-base:packages/web/web-search-exa/README.zh.md:12)。
- **谁依赖**：直接依赖：[liwa-python-runtime-closure](dsh-base:python/sdk-runtime/package.json:147)；开发/测试依赖：[@liwa/tool-web](dsh-base:packages/web/tool-web/package.json:59)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕感知、查资料和自主生活需要联网能力，但设计没有确定使用 Exa、Perplexity 还是 CLI 自带搜索。
- **建议：留待设计迁移方案时再定**。〔推理〕两者的结果语义和成本不同，先选搜索能力归属及提供方，再裁替代后端。

### `@liwa/web-search-perplexity`

- **路径与规模**：[packages/web/web-search-perplexity](dsh-base:packages/web/web-search-perplexity)；19 个文件，3 个非测试代码文件，**172 行非测试代码**。
- **做什么**：用 Perplexity 搜索网页，返回生成答案和引用来源。〔一手〕[packages/web/web-search-perplexity/README.zh.md:12](dsh-base:packages/web/web-search-perplexity/README.zh.md:12)。
- **谁依赖**：直接依赖：[liwa-python-runtime-closure](dsh-base:python/sdk-runtime/package.json:148)。
- **组合或预设**：无随附可选 bundle 或默认 preset 挂载；需按 README 显式组合。
- **和灵鲸的关系**：〔一手〕[灵鲸 architecture/overall.md §9.4 能力插件；另见 product.md §7.1、§8.1（行 1188）](liwa:docs/liwa/architecture/overall.md:1188)。〔推理〕感知、查资料和自主生活需要联网能力，但设计没有确定使用 Exa、Perplexity 还是 CLI 自带搜索。
- **建议：留待设计迁移方案时再定**。〔推理〕两者的结果语义和成本不同，先选搜索能力归属及提供方，再裁替代后端。

## 13. Windows / Linux 专用包：另批处理，不作逐包删留评估

总体建议：把以下四个真正的平台专用包交给下一批，连同调用方的 Windows/Linux 分支一起处理。它们目前都在跨平台依赖闭包中，不是本报告的闲置候选；仅删包清单会让仍在的静态导入或原生解析失效。

| 包名与路径 | 平台与现有用途 | 谁依赖 | 依据 |
| --- | --- | --- | --- |
| `@liwa/sandbox-windows-acl`<br>`packages/sandbox/sandbox-windows-acl` | Windows；受限令牌与 ACL 写权限沙箱 | 直接依赖：`@liwa/sandbox-local`、`@liwa/ssh-helper-runtime`；另有非测试源码导入但未列作该包清单依赖：`liwa-python-runtime-closure` | 〔一手〕[packages/sandbox/sandbox-windows-acl/README.zh.md:12](dsh-base:packages/sandbox/sandbox-windows-acl/README.zh.md:12)；[packages/sandbox/sandbox-windows-acl/package.json:2](dsh-base:packages/sandbox/sandbox-windows-acl/package.json:2) |
| `@liwa/win32-process`<br>`packages/subprocess/win32-process` | Windows；Win32 进程、句柄、管道和 Job Object 原语 | 直接依赖：`@liwa/sandbox-windows-acl`、`@liwa/ssh-helper-runtime`、`@liwa/subprocess-local` | 〔一手〕[packages/subprocess/win32-process/README.zh.md:12](dsh-base:packages/subprocess/win32-process/README.zh.md:12)；[packages/subprocess/win32-process/package.json:2](dsh-base:packages/subprocess/win32-process/package.json:2) |
| `@liwa/node-addon-system-linux-arm64`<br>`native/system/packages/linux-arm64` | Linux arm64；Landlock 可执行文件及 flock 原生载荷 | 可选依赖：`@liwa/node-addon-system` | 〔一手〕[native/system/packages/linux-arm64/README.zh.md:9](dsh-base:native/system/packages/linux-arm64/README.zh.md:9)；[native/system/packages/linux-arm64/package.json:2](dsh-base:native/system/packages/linux-arm64/package.json:2) |
| `@liwa/node-addon-system-linux-x64`<br>`native/system/packages/linux-x64` | Linux x64；Landlock 可执行文件及 flock 原生载荷 | 可选依赖：`@liwa/node-addon-system` | 〔一手〕[native/system/packages/linux-x64/README.zh.md:9](dsh-base:native/system/packages/linux-x64/README.zh.md:9)；[native/system/packages/linux-x64/package.json:2](dsh-base:native/system/packages/linux-x64/package.json:2) |

PowerShell 四包不能笼统标为 Windows 专用：`pwsh-local` 在非 Windows 会解析 PATH 中的 `pwsh`，故保留为下一批的“Windows 默认分支相关候选”，没有擅自归为平台专用删除对象。〔一手〕[packages/shell/pwsh-local/src/resolve.ts:78](dsh-base:packages/shell/pwsh-local/src/resolve.ts:78)。

| 相关包 | 平台判断 | 被谁依赖 |
| --- | --- | --- |
| `@liwa/pwsh-local`<br>`packages/shell/pwsh-local` | 随附组合主要用于 Windows shell 分支；实现可用于安装 PowerShell 的其他平台 | 直接依赖：`@liwa/cli`、`@liwa/terminal-bash`、`liwa-python-runtime-closure`；同宿主依赖：`@liwa/pwsh-sandbox`；开发/测试依赖：`@liwa/web-frontend`、`@liwa/sandbox-windows-acl`、`@liwa/pwsh-sandbox`、`@liwa/tool-pwsh-persistent`、`@liwa/tool-pwsh` |
| `@liwa/pwsh-sandbox`<br>`packages/shell/pwsh-sandbox` | 随附组合主要用于 Windows shell 分支；实现可用于安装 PowerShell 的其他平台 | 直接依赖：`@liwa/cli`、`@liwa/base` |
| `@liwa/tool-pwsh`<br>`packages/shell/tool-pwsh` | 随附组合主要用于 Windows shell 分支；实现可用于安装 PowerShell 的其他平台 | 直接依赖：`@liwa/cli`、`@liwa/base`、`@liwa/web-app`、`liwa-python-runtime-closure` |
| `@liwa/tool-pwsh-persistent`<br>`packages/shell/tool-pwsh-persistent` | 随附组合主要用于 Windows shell 分支；实现可用于安装 PowerShell 的其他平台 | 直接依赖：`@liwa/cli`、`@liwa/sdk-minimal`、`@liwa/web-app`、`liwa-python-runtime-closure` |

混合包也要保留边界：`sandbox-local` 同时包含 macOS Seatbelt、Linux bwrap/Landlock、Windows ACL 选择；`subprocess-local` 同时管理本机进程和 Windows Job 路径；`session-persistence-jsonl` 在 POSIX 用 flock、Windows 另有持久发布/锁实现。它们不是 Windows/Linux 专用包，不能整包交给平台删除批次。〔一手〕[packages/sandbox/sandbox-local/src/index.ts:161](dsh-base:packages/sandbox/sandbox-local/src/index.ts:161)、[packages/subprocess/subprocess-local/src/index.ts:48](dsh-base:packages/subprocess/subprocess-local/src/index.ts:48)、[packages/session/session-persistence-jsonl/src/lease.ts:34](dsh-base:packages/session/session-persistence-jsonl/src/lease.ts:34)。

## 14. apps / native / vendor 全覆盖核对

总体建议：保留现用入口与框架主干；应用本身不按“有没有作为插件被别人挂载”判断用途。下表覆盖五个 apps、六个 native 工作区包和九个 vendor 包；主清单已评估的项只在此对账，不重复计数。

| 区域 / 包 | 默认闭包情况与用途 | 本次处理 |
| --- | --- | --- |
| `@liwa/cli`<br>`apps/cli` | 闭包外；用户敲 liwa 时进入的总开关，解析命令并启动指定组合。 | 已在主清单逐项评估：留 |
| `@liwa/desktop-host`<br>`apps/desktop-host` | 闭包外；在 Electron 的 Node 子进程里启动网页后台，把就绪地址和关闭结果交给桌面壳。 | 已在主清单逐项评估：留 |
| `@liwa/desktop`<br>`apps/desktop` | 闭包外；把网页工作台装进 Mac 窗口，处理托盘、菜单、窗口和本机集成。 | 已在主清单逐项评估：留 |
| `@liwa/plugin-market-generator`<br>`apps/plugin-market-generator` | 闭包外；读取 npm 包名和 Git 仓库列表，生成插件市场目录文件。 | 已在主清单逐项评估：删 |
| `@liwa/web-frontend`<br>`apps/web` | 闭包内；网页实际打包入口，被 host-frontend-static 等消费 | 保留；普通网页与浏览器内后台预览分开，后者在主清单建议删 |
| `@liwa/node-addon-system-workspace`<br>`native/system` | 闭包外；管理本仓库自带原生组件的编译、打包和验证脚本。 | 已在主清单逐项评估：留 |
| `@liwa/node-addon-system-darwin-arm64`<br>`native/system/packages/darwin-arm64` | 闭包内；Apple 芯片 Mac 的 flock 原生载荷，由 entry 的 optionalDependencies 拉入 | 当前会话文件写锁需要，保留 |
| `@liwa/node-addon-system-darwin-x64`<br>`native/system/packages/darwin-x64` | 闭包内；Intel Mac 的 flock 原生载荷，由 entry 的 optionalDependencies 拉入 | Apple 芯片目标不需要；非 Windows/Linux，列作平台收口时待核对项，不混入闲置数 |
| `@liwa/node-addon-system`<br>`native/system/packages/entry` | 闭包内；供 sandbox-local 的 Landlock 入口与 session-persistence-jsonl 的 POSIX flock 共用 | 保留 Mac flock；Linux 部分由下一批处理边界 |
| `@liwa/node-addon-system-linux-arm64`<br>`native/system/packages/linux-arm64` | 闭包内；仅 Linux arm64 | 平台专用，见第 13 节；另批 |
| `@liwa/node-addon-system-linux-x64`<br>`native/system/packages/linux-x64` | 闭包内；仅 Linux x64 | 平台专用，见第 13 节；另批 |
| `@liwa/cordis`<br>`vendor/cordis` | 闭包内；Cordis 插件上下文、服务与生命周期 | 默认框架依赖，非闲置，保留 |
| `@liwa/cosmokit`<br>`vendor/cosmokit` | 闭包内；框架工具函数 | 默认框架依赖，非闲置，保留 |
| `@liwa/cordis-plugin-group`<br>`vendor/group` | 闭包内；分组与隔离配置 | 默认框架依赖，非闲置，保留 |
| `@liwa/cordis-plugin-hmr`<br>`vendor/hmr` | 闭包外；Cordis 原生的插件热重载实现；与灵鲸正在用的 @liwa/hmr 不是同一个包。 | 已在主清单逐项评估：删 |
| `@liwa/cordis-plugin-include`<br>`vendor/include` | 闭包内；YAML 解析和 patch 合并 | 默认框架依赖，非闲置，保留 |
| `@liwa/cordis-plugin-loader`<br>`vendor/loader` | 闭包内；按配置加载和卸载插件 | 默认框架依赖，非闲置，保留 |
| `@liwa/cordis-plugin-logger-console`<br>`vendor/logger-console` | 闭包外；把 Cordis 日志输出到控制台的可选导出器。 | 已在主清单逐项评估：删 |
| `@liwa/schemastery`<br>`vendor/schemastery` | 闭包内；配置 schema | 默认框架依赖，非闲置，保留 |
| `@liwa/cordis-plugin-timer`<br>`vendor/timer` | 闭包内；随插件释放的定时器 | 默认框架依赖，非闲置，保留 |

native 的平台子包可能只有清单与预构建元数据，代码由 `native/system/packages/entry/src` 统一维护，不能把平台子包代码行数为 0 理解成没有功能。〔一手〕[native/system/README.zh.md:31](dsh-base:native/system/README.zh.md:31)。vendor 已在项目中改作用域并有本地修改；本报告不把它们当外部依赖重新安装，也没有改动 vendor。

## 15. 最需要主人选择的几件事

| 选择点 | 推荐 | 影响的包 |
| --- | --- | --- |
| 外部大脑的三个现有接入是否先留作迁移材料 | 推荐先留待迁移边界定下来；它们明确是一次性委派，不能直接冒充长会话 | `subagent-acp`、`subagent-claude-code`、`subagent-codex`；连带 SDK 两包与 OAR 是否删除 |
| 桌面与浏览器操作由谁负责 | 推荐保留 Mac 原生 CUA、MCP 浏览器候选，删重复驱动和另外直调模型的 Stagehand；后续只确定一处能力归属 | 浏览器服务/运行时/MCP、computer-use、cua、cua-macos、cua-bundle |
| 是否需要从本机到另一台 Mac 远程干活 | 需要则整组留待迁移，不需要则五包成组裁；“只跑 Mac”本身不能回答这个问题 | SSH 五包 |
| 语音、联网搜索用哪个提供方 | 推荐到能力层设计时再选；先不把本地 SenseVoice、Exa、Perplexity 当成既定方案 | 语音五包、搜索两包 |
| 工作树、PR、外部订阅和会话搜索复用到什么程度 | 推荐保留作候选，按 task 归属与受众重定边界；不要直接沿用 Session/cwd 语义 | 团队四包、工作树两包、forge 五包、webhook 两包、查询两包、storage-sqlite |
| 需要多完整的开发者调试中心 | 推荐保留统计和原始会话查看；完整 CDP 中心及组合包待定 | `experimental-inspector`、`experimental-inspector-profile` |

## 16. 完整性与只读核对

计数对账：387 = 273（默认闭包）+ 114（闭包外）；114 = 105（逐包评估）+ 8（决策 41 免评估）+ 1（Python SDK 运行时免评估）。105 = 40（删）+ 16（留）+ 49（待定）。平台专用 4 包均属于 273，没有重复加到闲置统计中。

没有独立的“示例包/模板包”落在本次工作区匹配范围；示例与模板位于各包的 `examples/`、技能模板和 `snapshots/**/workspace/` 测试夹具，不另算工作区包。`benchmarks`、`website` 也按 pnpm-workspace.yaml 的真实根纳入；`python/sdk` 是 Python 项目，不是 pnpm 工作区包，按要求仅末尾点名。`experimental-ptc-runtime-python` 是模型代码执行器，非 Python SDK，已正常逐项评估。

默认闭包内仍能看到 `@liwa/plugin-market`、`@liwa/plugin-market-index` 以及若干仅作服务定义/类型注册的上报支持包，这是清单/源码依赖事实，不是推荐保留市场或上报；本任务只评估闲置包，不能承诺按本表删完就把整项产品能力裁净。后续删除需要从调用源头清理，不加空实现或跳过错误的兼容层。

本次只读动作：读取规则、设计文档、package.json、YAML、源码和 Git 跟踪文件表；调用无副作用的组合解析与静态依赖分析函数；在指定 scratchpad 写脚本、静态数据和本报告。未构建、未测试、未安装依赖、未启动应用、未绑定端口、未读取 key 或 `.env`、未请求真实模型或 API、未访问 `~/.dsh` / `~/.liwa`，未读取另外两个正在裁剪的工作树。底座检查前后 `git status --short` 为空，分支与 HEAD 未变。

复跑入口：`idle-inventory-tools/collect.mts` 收集清单、组合、依赖和规模；`effective-use.mts` 调用既有纯静态源码分析；`finalize-data.py` 合并实际入口补充；`assessments.py` 保存本报告逐包判断；`report.py` 输出 Markdown。中间数据 `inventory-data.json`、`effective-use.json` 与 `workspace-status.tsv` 都只在 scratchpad。脚本的所有写入位置都由脚本自己的目录确定。

## 17. 按要求只点名、另批处理的清单

以下每类仅一行，不重复逐包评估，也不纳入 105 个删/留/待定计数。

- **决策 41 上报及支持包（product-package-policy.ts 精确十项）**：`@liwa/client-ui-message-feedback`、`@liwa/client-ui-settings-session-log`、`@liwa/host-product-telemetry-otel`、`@liwa/anonymous-user-id`、`@liwa/deepseek-llm-api-extensions`、`@liwa/plugin-package-inventory-deepseek`、`@liwa/session-log-deepseek`、`@liwa/session-telemetry-otel`、`@liwa/session-telemetry`、`@liwa/otel`。其中 8 项在闭包外，`@liwa/anonymous-user-id` 与 `@liwa/deepseek-llm-api-extensions` 仍有静态依赖；全数交给上报裁剪批。
- **Python SDK 相关**：`python/sdk`（Python 项目，非 pnpm 工作区包）、`python/sdk-runtime`（`liwa-python-runtime-closure`，唯一计入 114 的 Python 工作区包）；共享 TypeScript SDK 三个相关层不是 Python 专属，`sdk-client` 已评估，`sdk-protocol` / `sdk-server` 在默认组合依赖闭包内。
- **Windows / Linux 专用包**：`@liwa/sandbox-windows-acl`、`@liwa/win32-process`、`@liwa/node-addon-system-linux-arm64`、`@liwa/node-addon-system-linux-x64`；平台与依赖见第 13 节。
