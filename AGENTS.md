# AGENTS.md — 灵鲸（Liwa）

本仓库是灵鲸（LingWhale / Liwa）的代码：以 DeepSeek Harness（DSH，MIT）提交 `f3803c96`（0.2.2-alpha.2）为底座 fork 而来，已经独立，不再跟上游（灵鲸决策 36）。本文件是在本仓库干活的所有 AI agent 的总规则：Claude Code 经 `CLAUDE.md` 软链接读它，Codex 直接读它。子目录里的 `AGENTS.md` 是继承自 DSH 的局部技术说明，和本文件或主人的规则冲突时，以本文件和主人为准。

## 先读

1. 主人的全局原则 `~/.claude/CLAUDE.md`：改在根上、编程风格、模块之间只走 API、每样东西唯一归属。Claude Code 会自动加载它；Codex 和其他 agent 开工前必须先读。
2. 灵鲸的交接文档 `~/Desktop/coding/person/liwa/docs/handoff.md`：进度、已定决策、协作分工（"怎么协作"）、文档约定、主人偏好。灵鲸的产品与架构文档还在 `main` 分支的 `docs/` 里，没有合进 `dsh-base`；本分支的 `docs/` 是 DSH 原有文档，只描述继承来的代码。路径以 MacBook 为准，mac mini 上的路径见 handoff 的"仓库状态"。
3. 改 `packages/` 之前读 [docs/architecture.md](docs/architecture.md)，弄清继承来的代码怎么组织。

## 协作规则

- 全程中文。对主人先说结论，讲人话、配例子，表格优先。
- 提交、推送前逐次征得主人同意。本目录是灵鲸仓库（`WolffyCode/liwa`，公开）的一个工作目录，停在 `dsh-base` 分支；`~/Desktop/coding/person/liwa` 是同一个仓库的另一个工作目录，停在 `main`。只推自己所在的分支，不碰另一个工作目录。
- 公开仓库：原始对话日志、本机配置、凭据都不进仓库。
- 不替主人拍板：要定的事给推荐和理由，等主人定。主人提的方案也要先评审合不合理，不盲从。
- 按主人指定的顺序一步一步来：不抢先写迁移方案，不自作主张批量合并、删除或改名；动手前先读懂要改的东西。
- 每个设计点注明依据：〔一手〕写文件:行，〔二手〕，〔推理〕。文档只存最新方案，不写历史措辞。
- 派出去的 agent 不再开子 agent、不提交 git、不加主人没同意的依赖、不手改 `node_modules`。

## 这份代码现在的状态

- 品牌和名字还是 DSH 的：包名 `@deepseek-ai/dsh-*`、命令 `dsh`、`DSH_HOME` 等都没改。改名时不能用"DeepSeek Harness"作项目名（[BRAND_GUIDELINES.zh.md](BRAND_GUIDELINES.zh.md)），要保留 [LICENSE](LICENSE) 的 MIT 版权声明。
- 改造原则（决策 36）：DSH 的插件能用就留；不能用就删，在原位置换成灵鲸的插件。DSH 自己的 agent 要抽象成"大脑提供方"之一，Paseo 的 Claude Code、Codex 长会话是另外的实现。改 agent 循环、会话主干这类破坏性改动，按主人确认过的方案做，不顺手改。
- 依赖还没装、没在本机跑过；下面的命令照搬 DSH，用之前先验证。
- `.agents/notes/` 是 DSH 的历史设计记录，只用来理解继承来的代码，不是灵鲸的决策依据；灵鲸的决策在 handoff。不新写 DSH 风格的 Agent Note。
- `.agents/skills/` 里是 DSH 团队的工作流技能（PR 描述、推送前检查、升级指南、官方图标、双语翻译等），都设成了只能手动调用，不会自动触发；它们描述的是 DSH 的流程，对灵鲸不适用，只在主人明确要求时用。`agent-experience` 是 `packages/preset/agent-preset` 随产品发布的技能，保持原样。
- 不要动 `snapshots/**/workspace/` 下的 `AGENTS.md`：它们是 DSH 的 agent 读取工作区规则的测试夹具，不是给你的规则。
- 继承来的代码有自己的写法。修改时遵守主人的全局原则，但不要为了风格单独大面积重写；要重写先问主人。

## 命令

```sh
pnpm install                    # pnpm 工作区，node >=24.9
pnpm run clean                  # 删构建产物
pnpm run test                   # 单元测试
pnpm run test:coverage          # 覆盖率门槛：packages/*/*/src 每个文件 100%
pnpm run test:e2e               # 真实 API 测试，没有 DEEPSEEK_API_KEY 自动跳过
pnpm run test:snapshot          # 无 key 的录制会话回放；过滤：-t <名字>
pnpm run test:snapshot:record   # 重录期望输出（要 key）
pnpm run typecheck
pnpm run lint
pnpm run build                  # build:artifacts 加 build:check
pnpm run build:artifacts        # tsc 出类型，tsdown 打运行时包与网页
pnpm run build:check            # 用最新产物做类型检查
pnpm run hygiene                # publint 与工作区、包、依赖检查
pnpm run doc-sync               # 文档检查
pnpm dsh --profile headless "任务"   # 从源码跑一个任务（要 DEEPSEEK_API_KEY）
pnpm run dev:web | dev:desktop  # 先 build:artifacts 再启动；start:web | start:desktop 跳过构建
```

## 检查

- 按改动选检查，不默认跑全量：行为改动跑相关测试；模型可见或用户可见的输出变了，更新对应的录制会话快照（`pnpm run test:snapshot`）；文档改动跑 `pnpm run doc-sync`；发布路径跑构建后的冒烟；模型提供方跑真实 API 的 e2e。
- 覆盖率门槛是 `test:coverage`，不是 `test`（[原因](docs/testing.md)）。
- 开发用 `build:artifacts`；声称完成之前，在最新一次 `build:artifacts` 之后跑 `build:check`，或者直接跑 `build`（[布局](docs/development.md#typescript-project-layout)）。
- agent 循环、会话生命周期、`SessionEventMap` 的改动会影响 TypeScript 和 Python 两个 SDK 的期望输出，`pnpm run test` 不覆盖它们（[说明](docs/testing.md#when-a-snapshot-test-is-required)）。

## 密钥

- 真实 API 的测试和演示读 `DEEPSEEK_API_KEY`、可选的 `DEEPSEEK_BASE_URL` 和根目录的 `.env`；没有 key 时 e2e 自动跳过（[key 规则](docs/testing.md)）。凭据绝不提交。
- `cordis.yml` 只在插件的 `config` 和条目的 `disabled` 下允许 `!!js`（不是 `!js`）；其余元数据保持字面量，条件组合用 overlay（[说明](docs/cordis-primer.md#loader-configuration)）。

## 技术约定

继承自 DSH，改造之前仍然成立。

- 全部是 ESM（`"type": "module"`）。跨包用包名导入，包内相对导入写 `.ts` 后缀。`dsh` 从源码启动走 tsx 的 ESM 钩子（`node --import tsx/esm`），它加载到的模块必须是 ESM。应用只经 profile 启动，不经包的 bin、演示脚本或 SDK 的命令行参数（[规则](docs/architecture.md#application-launch)）。
- 工作区依赖：DSH 自己的包用 `workspace:*`，vendor 与 native 用 `workspace:~`；插件包把 `@deepseek-ai/cordis` 声明在 `peerDependencies` 与 `devDependencies` 里。vendor 已改作用域（[说明](docs/rescope.md)），并且是 `private: true`。
- **登记都是 effect**：每项贡献都经 `ctx.effect()` / `ctx.on()`；注册表的 `register()` 直接或经登记句柄返回释放函数。
- **类型化事件用声明合并**和可合并扩展的映射表；事件的 JSDoc 要有 `@mode` 和载荷的 `@param`。
- **按判别标签 switch**：封闭联合以 `assertNever` 收尾，可合并扩展的联合落到有说明的默认分支。
- **瀑布监听器必须调用 `next()`** 才能往下传；不调用就截断整条链（[语义](docs/cordis-primer.md#cordis-waterfall-semantics)）。
- **模型可见 ⟺ 有日志**：进入模型请求的任何东西都必须能从会话日志重建；新增模型可见的输入，就要新增会话事件。
- **能力 seam 由服务定义、服务提供方、消费方三种角色组成**，完整出现，不只做其中一种（[术语](docs/glossary.md#capability-seam)）。
- **包边界上显式优于隐式**：缺省值是所属实现里一个显式的 `resolve(request): Spec` 步骤，不在 `run()` 里藏 `?? default`（`dsh-shell` 的请求与规格拆分是样板）。
- **插件里不写死可调参数**：随部署变化的选择做成经校验的 `Config` 字段，可以从 `cordis.yml` 改；`DEFAULT_*` 常量或测试钩子不算可配置。协议常量、外部规范、安全不变量保持固定。
- **配置错误大声失败**：能自己判定的在装载时报，否则在最早能判定的地方报；绝不静默跳过缺失的引用。
- **跨边界的不透明 id 用品牌类型** `Branded<B>`（来自 `dsh-brand`），不用裸 `string`。
- **同进程、有类型的边界信任 TypeScript**：不为静态接口已经保证的值加运行时校验、回退或恶意输入测试；校验放在解析器与配置、队列、模型或工具的 JSON、持久化与文件、worker、进程、线协议这些边界。
- **不新增断言到 `unknown`**（`as unknown`、`<unknown>`），现有的只减不增。
- **源码平面与产物平面不混**：静态检查和测试经 tsconfig `paths` 解析到 `src`，在干净的工作树上就能过；消费构建产物 `lib/` 的检查要声明这个依赖。同时有宿主端和浏览器端程序的包，各自给出叶子配置（[布局](docs/development.md#typescript-project-layout)）。
- **错误处理**：用有类型的结构化失败和本地化、可操作的报告；明确谁处理、怎么隔离、保证什么；状态不可信或结果不明时，停止依赖它的工作并明示（[技能](.agents/skills/dsh-error-handling/SKILL.md)）。空 `catch` 要给错误命名并写明为什么可以忽略，`try` 只包一条语句。
- **类型安全**：全部在 `strict: true` 和 `noImplicitAny` 下编译，剩下的每个 `any` 都写明为什么没法收窄。
- **导出的 JSDoc**：每个模块和导出都要有简洁的 JSDoc 写清非显然的约定，函数类导出要有 `@param` / `@returns`，由 `verify-export-jsdoc` 检查。这条和主人"注释只写为什么"的原则有冲突，主人定为先保留，处理工程配置时再定去留；在那之前照它写，否则检查不过。
- 改包的对外接口、远程服务、客户端组件或状态、会话行为、生命周期、并发、子进程与释放之前，先读 [docs/defensive-patterns/README.md](docs/defensive-patterns/README.md)。
- 文件末尾恰好一个换行（pre-commit 的 `git diff --cached --check` 检查）。Markdown 的一个段落写在一行里，不硬换行（`verify-md-wrap` 检查）。

## 改这些规则

根目录、`packages/`、`vendor/` 的 `CLAUDE.md` 都是指向同目录 `AGENTS.md` 的软链接，改真文件。仓库里有文档链接到本文件的"命令""检查""技术约定"三节，改这三个标题时要一起改那些链接（`pnpm run verify-md-links` 会查出来）。
