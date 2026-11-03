# 调研：万物插件化怎么做（插件架构）

日期：2026-10-28。用户新要求："只留一个标准的调度内核；形态适配器、各家 CLI 提供方、能力、记忆系统、成长系统、朋友关系与角色的定义、所有界面，都做成插件，可扩展、可被别人替换；要有 DSH 那样万物插件化的感觉。"本报告回答"该怎么做、做到哪一步"。

标注：〔一手〕读到源码、仓库文档或官方文档原文；〔二手〕搜索摘要或第三方文章；〔推理〕调研者判断；〔未核实〕没读到原文。

覆盖说明：

- 这次 `git clone` 和 raw.githubusercontent.com 都可用。所有下载放在 `mktemp -d` 新建的空目录，只读，没有执行任何安装脚本或项目代码。
- 已有报告查过的结论不重复调研，只引用：Paseo 的 provider 插件、生命周期钩子、客户端贡献和 Helm 插件平台 v1（`paseo-architecture` §2.2 Q7）；麦麦插件 Runner 子进程、AIRI 扩展 manifest v2 与 Kit、elizaOS Plugin 对象、Letta 渠道插件（`companion-architectures` §2.2 Q7、§3.2 Q7、§4.2 Q7、§5.2 Q7）；OpenClaw 渠道插件 SDK（`openclaw-architecture` §2.2 Q7）。
- 用户说 DSH 是 BSD-3-Clause。实际核对：npm 包和仓库 `LICENSE` 都是 **MIT**〔一手，D1、D16〕。
- 术语：**插件**指不改本体代码、按约定挂进来的一段功能；**扩展点**（本报告也叫**槽位**）指本体预留、允许插件挂实现的位置；**互斥槽位**指同一时刻只能有一个实现生效的槽位；**内核**指不能被插件替换的那部分本体。

---

## 1. 来源清单

### 1.1 DSH（DeepSeek Harness）

| # | 来源 | 实际读了什么 | 类别 |
| --- | --- | --- | --- |
| D1 | `deepseek-ai/deepseek-harness` 浅克隆（提交 `f3803c9`，2026-10-28） | `README.zh.md`、`SAFETY.zh.md`、`LICENSE`、根 `AGENTS.md` 里与兼容和公开 API 有关的条款、`packages/AGENTS.md` | 一手 |
| D2 | `docs/architecture.zh.md` | 全文：Cordis、profile 与组合包、核心包、三种事件域、轮次流程、会话日志、能力 seam、"新行为的归属位置"表 | 一手 |
| D3 | `docs/cordis-primer.zh.md`、`glossary.zh.md`、`rescope.zh.md` | 全文 | 一手 |
| D4 | `docs/capability-seams.zh.md` | 服务表：统计四种角色数量；逐条读了 `llm`、`tools`、`sessions`、`sessionTitle`、`systemPrompt`、`agentLoop`、`subagents`、`shell`、`sandbox`、`approval`、`credentials`、`storage`、`remoteAccess`、`pluginManager`、`pluginMarket` 等条目 | 一手 |
| D5 | `docs/cordis-tutorial/` 第 2、3、6 章 | 全文：生命周期与 effect、服务与 `inject`、组合与 HMR | 一手 |
| D6 | `packages/README.zh.md`；`packages/preset/persona/`（README、package.json） | 全文 | 一手 |
| D7 | `packages/boot/app-boot` README（profile、版本兼容、required 名单、重新组合）；`plugin-manager` README（前 90 行与"版本兼容性与豁免"）；`plugin-market` README 前段；`util/package-manifest` README 与 `src/types.ts` | 相关段落全文 | 一手 |
| D8 | `packages/extensions/` README；`cordis-host-runner` README | 全文 | 一手 |
| D9 | `packages/client/README.zh.md`；`docs/subsystems/client-modules.zh.md`；`slots.zh.md` 前半 | 全文或前半 | 一手 |
| D10 | `docs/postmortem/0001-acp-default-export-drops-inject.zh.md` | 前 80 行 | 一手 |
| D11 | `docs/tool-execution-pipeline.zh.md`；`packages/core/tools` README 守卫段 | 相关段 | 一手 |
| D12 | `docs/subsystems/session-projection.zh.md` | 前段 | 一手 |
| D13 | `docs/user/guide/mcp-memory.zh.md`、`public-deployments.zh.md` | 全文 | 一手 |
| D14 | `docs/upgrade-guide/` 目录 | 只统计了条目数，没逐条读 | 一手（计数） |
| D15 | `vendor/cordis/src/reflect.ts` 的 `provide()` | 源码片段 | 一手 |
| D16 | npm registry `@deepseek-ai/dsh` 元数据 | 版本、依赖列表、许可证、创建时间 | 一手 |
| D17 | 生态插件 tarball：`@tencent-connect/dsh-qqbot@0.5.3`（README、package.json、cordis.patch.yml）、`dsh-persona-dafeiyu@0.6.0`（README、cordis.patch.yml、`lib/index.js` 相关段）、`dsh-bili-scroll@2.3.0` 与 `dsh-im@1.0.5`（package.json、cordis.patch.yml） | 相关文件 | 一手 |
| D18 | arXiv 2608.25512《A Programming Paradigm for Spatiotemporal Composability》 | 摘要 | 一手（摘要） |
| D19 | WebSearch "DSH 插件 安全 风险"：SSD Nodes 指南、stork.ai、CSDN 推荐文 | 搜索摘要 | 二手 |

### 1.2 其他项目

| # | 来源 | 实际读了什么 | 类别 |
| --- | --- | --- | --- |
| K1 | `koishijs/docs` 中文文档 | `guide/plugin/` 的 index、lifecycle、service 全文，schema 前半；`guide/console/` 的 index、client 全文，data 前半；`guide/database/model.md` 扩展与迁移段；`manual/usage/market.md` 安全与预装段；`plugins/console/market.md` | 一手 |
| K2 | `koishijs/webui` | `packages/client/client/plugins/loader.ts` 全文；`packages/console/src/index.ts` 相关段；`packages/registry/src/types.ts`、`utils.ts` | 一手（源码） |
| K3 | WebSearch "Koishi 插件市场 恶意插件" | 没有找到确证事件 | 二手 |
| N1 | `nonebot/nonebot2` 的 `website/docs` | `tutorial/fundamentals`、`advanced/requiring`、`plugin-info`、`driver` 与 `adapter` 前半、`best-practice/data-storing`、数据库 README 与 developer 的迁移段 | 一手 |
| A1 | `AstrBotDevs/AstrBot` 的 `docs/zh/dev` | `star/plugin-new` 前 120 行、`guides/plugin-pages`（结构、示例、安全约束）、`guides/storage`、`plugin-market/2026-06-27` 前段、`plugin-platform-adapter` 前段；`dashboard/src/views/PluginViewPage.vue` 的 iframe `sandbox` 属性 | 一手 |
| A2 | `astrbot_plugin_livingmemory` README | 全文 | 一手 |
| A3 | WebSearch "AstrBot plugin CVE" | CVE-2025-55449、CVE-2025-57698、CVE-2026-6117、CVE-2026-15500、CVE-2026-16074 的漏洞库摘要 | 二手 |
| V1 | `microsoft/vscode-docs` | `extension-host.md` 全文；`activation-events.md` 列表与 `onStartupFinished`、`*` 段；`extension-manifest.md` 的 `engines`；`publishing-extension.md` 兼容性段；`webview.md` 安全段；`using-proposed-api.md` 前段；`contribution-points.md` 目录 | 一手 |
| V2 | `microsoft/vscode` | `extensions/` 目录列表；`extensions/git/package.json` | 一手 |
| V3 | WebSearch "VS Code 恶意扩展 2025" | BleepingComputer、ReversingLabs 等转述 | 二手 |
| O1 | docs.openclaw.ai `plugins/sdk-overview/memory-and-context` | 全文 | 一手 |
| O2 | `tools/plugin`（`plugins.slots` 段）、`plugins/architecture` 前 140 行、`architecture-internals/load-pipeline` 前段 | 相关段 | 一手 |
| O3 | `cli/plugins/install` 信任与能力同意段；`plugins/manage-plugins` 能力同意段 | 相关段 | 一手 |
| O4 | `plugins/feature-plugins` | 前 250 行 | 一手 |
| B1 | `backstage/backstage` 新前端系统文档 | `docs/frontend-system/architecture/20-extensions.md` 前 70 行与 inputs 段、`25-extension-overrides.md` 前段 | 一手 |
| G1 | `grafana/grafana` 的 `docs/sources/administration/plugin-management/` 下 `_index.md`、`plugin-frontend-sandbox.md`、`plugin-sign.md` | 全文 | 一手 |
| G2 | WebSearch "Grafana backend plugin 进程" | plugin-tools 文档摘要 | 二手 |
| C1 | `malfoyslastname/character-card-spec-v2` 的 `spec_v2.md` | `TavernCardV2` 类型与 `extensions` 规则；V3 规范只下载未细读 | 一手 |

### 1.3 文献

| # | 来源 | 实际读了什么 | 类别 |
| --- | --- | --- | --- |
| L1 | Cordis 论文（即 D18） | 摘要 | 一手（摘要） |
| L2 | Birsan《On Plug-ins and Extensible Architectures》，ACM Queue 2005 | 原文页面 403，没读到；只有 Slashdot 和 Ethereal 邮件列表的转述 | 二手 |
| L3 | Richards《Software Architecture Patterns》微内核一章 | O'Reilly 预览 403；只有搜索摘要 | 二手 |
| L4 | POSA 第 1 卷 Microkernel 模式、OSGi、Eclipse 扩展点 | 没读原文，按通行描述引用 | 未核实 |
| L5 | Syeed 等《Pluggable Systems as Architectural Pattern》，ECSA Workshops 2015 | 摘要 | 一手（摘要） |

---

## 2. 各项目机制拆解

### 2.1 DSH：真正的"一切皆插件"

**一句话。** DSH 建在 Cordis 上。官方原话："产品的每一部分都是插件，包括模型适配器、工具注册表、会话日志，以及 agent loop 本身，因此每个都可以从配置替换。""不存在需要打补丁的特权内核"〔一手，D2〕。

**体量。** `packages/` 下 52 个组、369 个包（全仓 409 个 `package.json`），`docs/` 下 908 个文件〔一手，D1〕。服务表里有 60 个核心服务、36 个可替换的 seam、10 个独立服务、1 个组合包服务〔一手，D4〕。npm 包 2026-08-10 才创建，到 10-27 已发 39 个版本〔一手，D16〕。

#### Cordis 的五个概念〔一手，D3、D5〕

1. **插件**是带可选 `inject` 和 `apply(ctx)` 的函数，或者一个 `Service` 子类。
2. **上下文**（`ctx`）是服务的容器。一个服务占一个固定的键，如 `ctx.tools`、`ctx.llm`。别的插件按键找服务，不 import 具体实现。
3. **`inject`** 声明依赖。插件要等依赖的服务都在了才启动；服务消失，依赖它的插件自动卸载，服务回来再重新加载。
4. **类型化事件**：五种分发方式（`emit`、`waterfall`、`parallel`、`serial`、`bail`）。`waterfall` 是"环绕中间件"，监听器不调 `next()` 就能短路。
5. **注册是可逆的副作用**（effect）。提示词片段、工具、适配器、监听器都经 `ctx.effect()` 或 `ctx.on()` 装上，插件卸载或热重载时自动撤销。

插件实例的运行时句柄叫 **fiber**，状态是 `PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED`，出错是 `FAILED`。PENDING 表示"依赖的服务还没来"，这是合法状态，**不报错**，教程专门教怎么排查"为什么我的插件没有输出"〔一手，D5 第 6 章〕。

Cordis 论文把这两件事叫"时间可组合"（卸载时能完全撤销副作用）和"空间可组合"（声明并响应式管理组件间依赖），并给出了形式化〔一手，L1〕。

#### seam：可替换能力的三种角色〔一手，D2、D3〕

一个 **seam** 是"一项可替换能力"，有三个角色：

- **Service Definition**：声明接口，占一个 `ctx.<key>`；
- **Service Provider**：实现它，可以有多个；
- **Consumer**：使用它，通常是面向模型的工具。

范例：`dsh-shell`（定义）、`dsh-bash-local` / `dsh-bash-sandbox`（提供方）、`dsh-tool-bash`（消费方）。换掉提供方，整个产品跟着变：把文件系统和进程提供方指向远程沙箱，Bash、PTY、LSP 一起搬过去。规则写死在包约定里："扩展插件依赖 Service Definition，绝不依赖具体提供方"〔一手，D6〕。

#### profile、组合包与 patch〔一手，D2、D7〕

- **profile** 是存在 `$DSH_HOME/profiles/<name>` 下的一套具名组装：列出有序的组合包，加上自己的 `cordis.patch.yml`。随发行版带 `web`、`headless`、`sdk`、`sdk-minimal`、`acp` 五个模板。`dsh --profile acp` 就是"只装 ACP 服务器那一层"。
- **组合包**（bundle）是"一层配置 + 它挂载的代码"的分发格式。
- 启动时在空列表上依次叠：profile 里有序的组合包 → profile 自己的 patch → home 级 patch → `--patch` 单次覆盖。一条 patch 按 `id` 替换某行的整个 `config`，或插入新行。
- `dsh --profile web --dump-config` 能打印最终的插件树，"它打印出的任何条目，都可以由你自己的 patch 替换"。

#### manifest 长什么样〔一手，D7、D17〕

插件就是一个 npm 包。`package.json` 里的 `dsh` 字段：

```json
{
  "engines": { "node": ">=24", "dsh": "0.1.5-alpha.1" },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml", "platforms": ["darwin"], "listedByDefault": true },
    "client": { "platform": "web", "inject": ["..."], "immediately": false, "external": ["..."] }
  }
}
```

组合包自带的 `cordis.patch.yml` 只写"往插件树插哪一行"：

```yaml
- insert:
    - id: persona-dafeiyu
      name: dsh-persona-dafeiyu
      config:
        enabled: true
```

插件模块导出 `name`、`inject`、`Config`（schemastery 写的配置 schema）、`apply`。配置 schema 同时用于校验、默认值和设置页表单〔一手，D7〕。

#### 内核到底保留了什么〔一手，D7〕

DSH 说没有特权内核，但启动器有一张"全局 required 名单"：`agent-loop`、`tool-executor-native`、`tool-executor-ptc`、`webserver`、`web-runtime`、`modules`、`connection`、`headless-runner`、`acp`、`sdk-jsonrpc-server`。名单里的行启动失败，整个应用拆掉并以非零码退出；其他插件失败只出警告。另外 Cordis 运行时、Loader、app-boot 启动器本身不可替换。〔推理〕所以 DSH 的"无内核"是指"没有不能被配置换掉的业务代码"，不是指"什么都没有"：框架、启动器和 required 名单就是它的事实内核。

#### 互斥是怎么做的

DSH 没有"槽位"这个统一概念，但有三种代码级的互斥：

1. **同名服务互斥**：同一隔离作用域里，第二个插件注册同名服务直接抛错 `service "x" has been registered at <...>`〔一手，D15〕。要并存多个实现，就做成"注册表服务"（如 `ctx.llm` 是适配器注册表，`ctx.tools` 是工具注册表），实现往里登记。
2. **按名字独占**：`computer-use`、`browser-use` 组"按名称独占注册提供方"；`sessionTitle` 只允许"唯一的可选异步提供方"〔一手，D4、`packages/README`〕。
3. **人设段落独占**：`dsh-system-prompt` 无条件注册 `deployment:persona-prefix`，一个进程只有一份。`dsh-persona` 只能挂在某个 agent preset 的作用域里，用同名段落"遮蔽"全局人设；全局挂载"会与提示词注册表自身的注册相撞并明确报错"〔一手，D6〕。

**按 agent 定制**靠作用域：每个活跃 agent 有自己的 `agent.ctx`，作用域内注册的工具、提示词段落"只在该 scope 内替换同名的全局对应项"，这就是"按 agent 定制 persona 和工具变体的机制"；服务行用 `isolate` 让一个组拿到同名服务的独立实例〔一手，D3、D5〕。

#### 人设、渠道、工具、技能、大脑各怎么做成插件

| 东西 | 做法 | 依据 |
| --- | --- | --- |
| 人设 | 官方 `dsh-persona`：往系统提示词注册表注册"人设前缀/后缀段落"，在 preset 作用域里遮蔽全局人设；`complete: true` 时前缀就是全部系统提示词 | 一手，D6 |
| 第三方人设 | `dsh-persona-dafeiyu`：**没用官方人设段落**，注册了自己的 `dafeiyu:persona` 段落（注释写"避免与 deployment:persona-* 冲突"），排在官方人设前缀的位置。人设库存在 `<DSH_HOME>/storages/dsh-persona-dafeiyu/personas.json`（自定义 `version: 1`）；全局、工作区、会话三档；段落文本是函数，每次组装重新求值，切换后下一个请求生效 | 一手，D17 |
| 渠道 | **核心没有渠道 seam**。`dsh-qqbot` 自己做了全部：QQ 长连接、访问控制（`c2cMode` 默认 `open`）、会话映射、选哪个模型、群聊是否要 @、队列、媒体下载、看图工具；通过 `ctx.agents` 驱动 agent loop，监听 `session/event` 把回复发回 QQ。`dsh-im` 想做"统一 IM 桥核心"，是第三方补的 | 一手，D17 |
| 工具 | `ctx.tools.register()`，schema 自动进提示词 | 一手，D2 |
| 技能 | `ctx.skills` 是 seam，提供方合并技能目录 | 一手，D4 |
| 模型 | `ctx.llm` 注册适配器（`llm-deepseek`、`llm-pi-ai`） | 一手，D4 |
| 外部 CLI | `ctx.subagents` 是 seam，提供方有 `subagent-codex`、`subagent-claude-code`、`subagent-acp`、`subagent-dsh-sdk`；Claude Code 子智能体是一个组合包，"绝不会回退到宿主 `claude` 可执行文件" | 一手，D4、`subagent-claude-code` README |
| 记忆 | **不是插件槽位**。官方给三份默认关闭的参考配置，经通用 MCP 客户端把 Memorix 等记忆服务器的工具接进来；"DSH 不负责……迁移提供方数据" | 一手，D13 |
| 投影 | `ctx.sessionProjections`：领域插件注册"纯同步折叠单元"，框架只订阅一次日志事件、驱动每个单元，领域"不持有任何订阅" | 一手，D12 |

规则"**模型可见即已记录**"：每个模型请求都必须能从会话日志重建；新增模型可见输入需要新的会话事件〔一手，D2〕。

#### 权限与信任〔一手，D1、D7、D8、D11〕

- 所有插件都在宿主进程里，**没有沙箱**。`plugin-manager` 原话："已安装的 Host 代码在宿主进程内运行，不受工作区沙箱限制。"
- 安全说明："不可信插件可能损坏宿主计算机……泄露数据或凭据"；"沙箱、审批提示与权限控制……不保证隔离"。
- 模型能用 `plugin_manager` 工具装插件，但每次操作要求 `danger-full-access` 或单次批准；依赖的构建脚本要单独批准。
- 模型能"自修改"的另一条路是动态 Cordis 定义：在 `node:vm` 里求值，"沙箱隔离全局变量，但不是安全边界……对待动态包要像对待 bash 访问一样"；而且"没有模型工具创建动态定义"。
- 工具调用的策略：`tools/pre-execute` 是可重排的允许/拒绝/询问瀑布，后面有**单调守卫**（`ctx.tools.guard()`）："返回的理由会拒绝调用，后续监听器无法把该拒绝重新变为允许"。
- 插件市场：用户自己配置索引地址，默认一个都不配；安装钉精确版本；没有签名。第三方网站在做插件"风险评分"（README 徽章 `dsh.so risk`）〔一手，D7、D17〕。

#### 版本与兼容〔一手，D1、D7、D14、D17〕

- 根 `AGENTS.md`："Public APIs are pre-stable; update every consumer."每个对外可感知的破坏性变更立刻写进升级指南。10 个预发布版本累计 81 条升级指南条目（单个版本最多 26 条）。
- 插件声明 `engines.dsh`（或对 `@deepseek-ai/dsh-*` 的 peer 范围）。启动器在导入插件**之前**比对运行时版本，不兼容的行被改成 `disabled: true`，组合包被跳过；安装时也先查。主人可以给"精确包版本 × 精确 DSH 版本"写豁免，存在 profile 的 `compatibility.json`，必须 `acceptRisk: true`，升级任何一边都不继承。
- 文档有漂移：`package-manifest` README 写"当前安装器和加载器不强制检查"，`app-boot` 和 `plugin-manager` README 写的是强制检查。〔未核实〕以后两者为准，没读源码确认。
- 第三方作者自己发明了 `dsh.compatibility.dshReleases` 字段记录"实测兼容的版本"；`dsh-qqbot` 的说明写"客户端依赖 settings.section / sidebarRightTabs / sidebar.right.pane.tab 席位契约……宿主大版本升级后请重新验收席位行为"〔一手，D17〕。
- 会话日志格式升级：只能写出"以版本命名的后继文件"，已提交的旧代永不改写、移动或删除〔一手，D1、D2〕。

#### 界面也是插件〔一手，D9〕

- 浏览器侧同样跑 Cordis。包在 `package.json` 声明 `dsh.client`、导出 `./client` 产物，宿主扫描后组合成启动图注入页面，`/plugins/??a/client.js,b/client.js&rev=…` 提供合并脚本。
- 插件 UI 和宿主 UI **在同一个文档里**，没有 iframe。插件可控的字符串在注入时转义 `<`，防止逃出 script 元素。
- **Slot** 是类型化的 React 组合系统。每个 slot 声明两个维度：
  - 基数：`single`（只渲染优先级最高的那个）、`list`（按 `id` 和 `order` 排列）、`keyed`（按键匹配）、`chain`（依次询问，第一个非空的胜出，都拒绝就用拥有者的默认）；
  - 作用域：`root`、`session-maybe`、`session`。
- 规则："功能插件通过 `ctx.slots.register()` 贡献 UI，绝不导入其他功能插件的组件"；向未声明的 slot 注册、重复声明别人拥有的 slot，都在插件激活时失败；组件拿不到 `ctx`，只拿到拥有者给的 props 和注入的 hooks。
- 主控台的对话、侧栏、设置、审批、插件管理页、插件市场页全是 `ui-*` 插件，72 个包〔一手，D9〕。

#### 教训〔一手，D10〕

事故复盘 0001：ACP 服务器有 178 个绿色单元测试、100% 行覆盖率，接上真实编辑器的瞬间就崩。原因一：一行多余的 `export default apply` 让 Loader 丢掉了插件的 `inject`；原因二：可选服务经代理查找时只沿祖先方向找，找不到兄弟分支提供的服务。两者都因为"所有测试都通过一条不会触及插件真实加载方式的路径来挂载插件"而漏掉。修复是加上真实 Loader 的测试。

### 2.2 Koishi + Cordis

Koishi 是国内机器人框架，也用 Cordis（DSH 把它 vendor 进来改了包名）。

- **插件形式**：函数、类、带 `apply` 的对象三选一。`ctx.plugin()` 返回 `Fork`，`fork.dispose()` "停用这个插件，取消上述全部副作用"。默认同一个插件只启用一份；声明 `reusable = true` 才能多份；`fork` 事件把插件分成"只执行一次"和"每次调用执行"两段〔一手，K1 lifecycle〕。
- **服务与依赖**：`inject` 可以是数组，或 `{required, optional}`。依赖的服务值变化时，插件"立即回滚……如果变化后的值依旧为 truthy，该插件会在回滚完成后被重新加载"。只有部分功能依赖某服务时，用 `ctx.inject(['console'], ctx => …)` 包成子插件〔一手，K1 service〕。
- **服务默认单实例**：文档原话"你的每种服务只能同时存在一个实例"。要多实例得隔离（配置里插件组加 `$isolate`）。这一节在当前文档里被注释掉了〔一手，K1 service〕。〔推理〕说明隔离功能不常用或在调整。
- **服务分三类**：Koishi 自带（`ctx.model`）、Koishi 定义但不实现（`ctx.database`，由 `database-mysql` 等插件实现）、插件自己定义并实现（`ctx.console`）〔一手，K1〕。第二类就是"抽象槽位 + 可替换实现"。
- **manifest**：`package.json` 的 `koishi` 字段：`service.required/optional/implements`、`insecure`、`browser`、`hidden`、`preview`、`category`、`locales`〔一手，K2 registry/types.ts〕。`implements` 让市场知道"这个包能填哪个服务"。
- **控制台本身是插件，页面也由插件贡献**〔一手，K1 console、K2〕：
  - 后端：`ctx.inject(['console'], ctx => ctx.console.addEntry({dev, prod}))` 登记前端入口；`DataService` 子类向前端推数据。
  - 前端：`export default (ctx) => { ctx.page({...}); ctx.slot({type: 'status-left', component, order, disabled}) }`。一个插槽可以被注入多次，按 `order` 排序。
  - 加载：`loader.ts` 用 `import(url)` 动态导入每个入口，挂进 `ctx.isolate('extension').plugin(...)` 的作用域；CSS 用 `<link>` 元素并登记为 effect；后端换了（`_id` 变化）就 `window.location.reload()`。〔一手，K2〕**没有任何隔离**：扩展和控制台同一个 Vue 应用、同一个源。
  - 文档原话："「插件市场」和「插件配置」页面本身就分别由预装的 market 插件和 config 插件提供……随意改动插件配置、删除预装插件都可能导致 Koishi 无法正常运行。"〔一手，K1 market〕这就是"内置也是插件"的代价：主人能把系统拆坏。
- **信任**："Koishi 不对非官方插件的安全性做任何保证……部分插件带有「不安全」标识"〔一手，K1〕。`insecure` 是 manifest 字段〔一手，K2〕。没搜到确证的恶意插件事件〔二手，K3〕。
- **数据**：任何插件都能用 `ctx.model.extend()` 建表，也能往内置 `user` 表注入字段。字段改名要把旧名一起声明在代码里，启动时自动迁移〔一手，K1 model〕。〔推理〕这是"一张表多个写入者"和"兼容层留在代码里"的反面例子。

### 2.3 NoneBot2：驱动器、适配器、插件三层

- 构成：框架主体 + **驱动器**（收发数据，HTTP/WebSocket）+ **适配器**（平台消息与 NoneBot 事件互转）+ **插件**（功能）。"除框架主体外，其他部分均可按需选择、互相搭配"〔一手，N1 fundamentals〕。
- **互斥**：服务端型驱动器"仅能选择一个"，客户端型可以混入：`DRIVER=~fastapi+~httpx+~websockets`〔一手，N1 driver〕。适配器可以注册多个（`driver.register_adapter()`）〔一手，N1 adapter〕。
- 适配器是 NoneBot 自己的一个分层，安装方式和插件一样走商店，但**不是插件对象**。〔一手 + 推理〕"适配器是插件"在 NoneBot 里只在分发层面成立。
- 依赖：插件靠 import hook 被追踪，`require("b")` 声明依赖并先加载〔一手，N1 requiring〕。元数据 `PluginMetadata`：`type`（`library` 给别的插件用、`application` 给用户用）、`supported_adapters`、`config`〔一手，N1 plugin-info〕。
- 生命周期：文档没有运行时卸载；热重载靠 `nb run --reload` 重启进程〔一手，N1 driver〕。
- 数据：`nonebot-plugin-localstore` 给每个插件独立的数据、缓存、配置目录；ORM 插件用 Alembic，迁移脚本按插件分支（`--branch-label <插件名>`）〔一手，N1〕。〔推理〕"每个插件一条迁移分支"是插件自带数据库表时比较干净的做法。

### 2.4 AstrBot：插件（star）+ 平台适配器插件

- 插件是 Python 包，进程内运行。元数据在 `metadata.yaml`：`name`、`author`、`version`、`display_name`、`short_desc`、`support_platforms`、`astrbot_version`（PEP 440 范围，不满足就"阻止加载并提示版本不兼容"，但 WebUI 安装时可以"无视警告，继续安装"）〔一手，A1〕。
- 插件可以随包提供技能（`skills/`），在技能页只读展示；插件卸载或更新，技能跟着变〔一手，A1〕。
- 平台适配器可以做成插件（接飞书、钉钉、B 站私信）〔一手，A1 platform-adapter〕。
- 热重载：WebUI 插件卡片上有"重载插件"按钮〔一手，A1〕。
- 数据：持久化数据要放 `data/plugin_data/{插件名}/`，"而非插件自身目录，防止更新/重装插件时数据被覆盖"；另有按插件隔离的 KV 存储〔一手，A1 storage〕。
- **界面插件用受限 iframe**〔一手，A1 plugin-pages、dashboard 源码〕：插件在 `views/<名>/index.html` 放页面，Dashboard 用 `sandbox="allow-scripts allow-forms allow-downloads"` 的 iframe 加载；页面经 `window.AstrBotPluginView` bridge 调后端，后端用 `context.register_web_api()` 注册路由；"视图不能直接访问 Dashboard cookies、LocalStorage 或父页面 DOM，也不能绕过 bridge 复用 Dashboard auth"；资源响应带 CSP `frame-ancestors 'self'` 等安全头。
- 市场：JSON 规范 `schema_version: 1`，`plugin_id = author/name`，"`$meta` 不得用于……插件安全校验"〔一手，A1 market〕。
- **安全事故**〔二手，A3〕：CVE-2025-55449（JWT 签名密钥硬编码 → 伪造登录 → 装恶意插件执行命令）；CVE-2025-57698（插件上传接口路径穿越）；CVE-2026-6117（插件安装上传接口沙箱绕过）；CVE-2026-15500、16074（插件市场与更新接口 SSRF）。〔推理〕共同点：**"装插件"等于"执行任意代码"，安装接口就是最危险的接口**。
- 记忆插件 livingmemory〔一手，A2〕：插件自带存储、整理、召回（关键词 + 向量 + 图谱）、自己的 `recall_long_term_memory` / `memorize_long_term_memory` 工具、自己的插件视图；"结合会话、人格和生命周期筛选"在插件内部做；跨版本升级要"先查看备份与迁移说明"。〔推理〕宿主对它返回的记忆没有任何受众检查。

### 2.5 VS Code：贡献点 + 激活事件 + 扩展宿主

- **manifest**：`package.json`。`engines.vscode` 必填且不能是 `*`，用来"确保扩展只安装到含有你所依赖 API 的客户端上"〔一手，V1〕。
- **贡献点**（`contributes.*`）：命令、菜单、配置、视图、语言、调试器、主题……全是声明式 JSON，宿主不用运行扩展代码就能把它们画出来〔一手，V1 contribution-points 目录〕。
- **激活事件**（`activationEvents`）：`onLanguage`、`onCommand`、`onView`……扩展按需懒加载；`*` 会拖慢启动，推荐 `onStartupFinished`〔一手，V1〕。
- **扩展宿主**：扩展跑在和界面分开的进程（Node 或浏览器 WebWorker），有 local、web、remote 三种位置。扩展宿主阻止扩展"影响启动性能、拖慢 UI 操作、修改 UI"〔一手，V1 extension-host〕。〔未核实〕同一个宿主进程里的多个扩展之间是否隔离，文档没说；通行说法是不隔离。
- **webview**：运行在隔离上下文，不能直接访问本地资源；靠 `localResourceRoots`、内容安全策略（CSP）和 `postMessage` 通信；"`acquireVsCodeApi` 返回的对象……绝不能泄漏到全局"〔一手，V1 webview〕。
- **API 版本**：新 API 先做"proposed API"，只在 Insiders 可用、不能用于发布的扩展；稳定后才进正式 API。原话："once we introduce an API, we cannot easily change it anymore"〔一手，V1 proposed-api〕。
- **内置功能也是扩展**：`microsoft/vscode` 的 `extensions/` 目录有 107 项，包括 git、markdown、TypeScript 语言功能、GitHub 登录〔一手，V2〕。但内置的 git 扩展启用了 35 个 proposed API、激活事件含 `*`〔一手，V2〕。〔推理〕"吃自己的狗粮"不等于"内置和第三方平等"：内置扩展拿着第三方拿不到的接口。
- **安全事故**〔二手，V3〕：2025 年 Material Theme 扩展被下架；带勒索功能的扩展上架；ReversingLabs 统计恶意扩展从 2024 年的 27 个涨到 2025 年前十个月的 105 个；Open VSX 上的 GlassWorm 攻击。

### 2.6 OpenClaw：补充插件槽位、记忆插件和界面插件

已有报告查过渠道插件（`openclaw-architecture` §2.2 Q7），这里只补新的。

**互斥槽位确实存在**〔一手，O2〕：

```json5
plugins: {
  allow: [...], deny: ["untrusted-plugin"],
  slots: { memory: "memory-core" },   // 或 contextEngine
  entries: { "voice-call": { enabled: true, config: {...} } }
}
```

- `plugins.slots.<slot>` 目前只有 `memory` 和 `contextEngine` 两个，"picks one plugin for an exclusive category"。选中记忆插件就算显式启用；`plugins.slots.memory: "none"` 关掉记忆插件〔一手，O2〕。
- 加载流水线：发现 → 读 manifest → 拒绝不安全的候选（入口逃出插件根目录、目录全局可写、属主不对）→ 规范化配置（含 `slots`）→ 决定启用 → 进程内加载 → `register(api)`〔一手，O2 load-pipeline〕。"manifest/config validation should work from manifest/schema metadata without executing plugin code"〔一手，O2 architecture〕。
- 能力模型：一个插件可注册多种能力（文本推理、CLI 后端、嵌入、语音、渠道、网页搜索……），按实际注册行为分成 plain-capability、hybrid-capability、hook-only、non-capability 四类〔一手，O2〕。

**记忆槽位的契约**〔一手，O1〕——和灵鲸的问题最接近：

- `api.registerMemoryCapability()` 是"exclusive memory-plugin API"。只有选中的槽位拥有者能提供压缩前的写回计划、`/learn` 工具、深度召回工具；没选中的"sidecar"不能贡献这些字段。
- **受众由宿主铸造**：`MemoryAudience` 只有两种，`owner-private` 和 `conversation`。宿主从可信的回合事实和会话谱系算出来，插件"must not reconstruct audience from session lookups, session-key patterns, record IDs"；宿主拒绝不是自己铸造的受众对象，谱系变化时让旧受众失效，每次调用前后都检查是否仍有效。
- **但过滤由插件做**：能返回会话转录命中的插件应实现 `authorizeSearchHits(...)`，"Return only hits the requester may observe"；没实现的话，宿主扣下所有会话来源的命中，只放普通记忆命中（失败即关闭）。"Keep transcript identity and visibility policy in the owning memory plugin."
- 能力在插件代码运行前强制：请求了插件没声明的来源、分页、候选类型，直接拒绝。
- 引用带 `providerId`，别的提供方的引用被拒绝。
- 兼容层：旧的文件形态 `MemoryPluginRuntime` 和新的 `providerRuntime` 并存，Gateway 的 `memory.search` 有 v1、v2 两个版本〔一手，O1〕。〔推理〕这是有了外部插件之后兼容层越叠越厚的样子。
- "做梦"（离线整理）不是提供方能力：换了记忆插件，Memory Core 仍可能作为"做梦 sidecar"被激活〔一手，O1〕。

**信任与安装**〔一手，O3〕：插件都在进程内。ClawHub 和官方目录是可信来源；任意 npm、git、本地路径要警告并确认，非交互要 `--force`。npm 依赖安装一律 `--ignore-scripts`；记录完整性哈希。**能力同意**：安装或启用第三方插件前，列出它声明的渠道、提供方、工具、钩子、MCP 服务、CLI 命令、技能和危险配置项，让操作者确认；内置和官方目录里验证过的插件免审。〔推理〕这是"声明了什么就只能注册什么"的审查，不是操作系统级沙箱。

**界面插件分两档**〔一手，O4〕：

- **原生界面**："runs trusted JavaScript in the Control UI origin"，和登录的操作者共享 Gateway 权限，`host.request` 能调该连接权限允许的任何方法，包括管理员方法。
- **沙箱小部件 / MCP App**："when the content should be isolated from the host application"。
- 贡献方式：`registerPage`、`registerNavigation`、`registerAction`、`registerPanel`、`registerAccessory`、`registerInlineView`、`registerWidget`，以及 `registerReplacement`（替换 `workspace`、`session-list`、`composer`、`transcript`、`tool-result`）。替换视图可以调 `mountDefault()` 嵌入内置视图。
- 逃生口："plugin settings always use the built-in workspace"；替换选择属于当前浏览器运行时，不是持久配置。
- "All plugin APIs are experimental."

### 2.7 界面插件的几种做法（Backstage、Grafana 与以上各家对照）

**Backstage 新前端系统**〔一手，B1〕：

- 应用是一棵"扩展树"。扩展 ID 形如 `[kind:][namespace][/name]`，"For each frontend app instance there can only be a single extension for any given ID"。
- 扩展有输出（给父节点的数据，每份数据用一个"扩展数据引用"标类型）、输入（从子节点收的数据）、挂载点（父扩展 ID + 输入名）。挂载点**可以由集成者改**。
- 输入可以设 `singleton: true`（只能挂一个）和 `optional: true`。这就是界面里的互斥槽位。
- 每个扩展可禁用；可以按 `featureFlags`、`permissions` 条件启用（应用准备时求值一次）；有配置 schema。
- 覆盖：`.override()` 生成一个新扩展，和原扩展同时安装时优先；能转发原工厂的输出再加自己的。官方建议优先用配置和输入扩展，覆盖是最后手段。
- 〔推理〕Backstage 前端插件在构建时打进同一个 React 应用，没有运行时隔离。

**Grafana**〔一手，G1；二手，G2〕：

- 三种插件：面板（panel）、数据源（data source）、应用（app，可以打包数据源、面板、页面）。
- 启动时校验每个插件的签名；**未签名的插件不加载**，除非显式允许。签名分 private、community、commercial 三级。
- 前端插件沙箱：11.5 起公开预览，"has been deprecated and will be removed in Grafana 13.4"；Grafana Labs 自己签名的插件不能被沙箱化。〔推理〕在同一页面里给第三方前端代码做沙箱，连 Grafana 也放弃了。
- 后端插件每个是一个子进程，经 gRPC 通信，"a panic in a plugin doesn't panic the server"〔二手，G2〕。

**横向对照**：

| 做法 | 谁在用 | 隔离 | 代价 |
| --- | --- | --- | --- |
| 同页原生，插件代码直接进宿主应用 | DSH、Koishi、Backstage、OpenClaw 原生界面 | 无；插件拿到操作者全部权限 | 一个坏插件能读令牌、改界面、调任何接口 |
| 同页 + JS 沙箱 | Grafana（已废弃） | 部分 | 兼容性差、性能差，最终放弃 |
| 受限 iframe + 消息桥 | AstrBot 插件视图、VS Code webview、OpenClaw 沙箱小部件 | 浏览器级：拿不到宿主 cookie、存储、DOM | 只能经桥调接口；样式和交互不如原生顺 |
| 声明式贡献，宿主负责画 | VS Code 贡献点、Koishi/AstrBot 的配置 schema 表单、OpenClaw 小部件描述符 | 不运行插件前端代码 | 表达力有限 |

### 2.8 文献与 agent 框架里的可插拔记忆、人设

**微内核与插件架构**：

- Richards 的微内核模式：两种组件，核心系统和插件模块；核心系统"传统上只包含让系统运行所需的最小功能"；插件模块之间相互独立〔二手，L3〕。〔未核实〕书里关于插件注册表、插件契约和契约版本的具体论述没读到原文。
- POSA 第 1 卷的 Microkernel 模式把系统分成微内核、内部服务器、外部服务器、适配器和客户端〔未核实，L4〕。
- Eclipse 的扩展点与扩展、OSGi 的 bundle 生命周期和服务注册表：插件声明扩展点，别的插件声明扩展，运行时按需激活；Eclipse 3.0 起建在 OSGi 上〔未核实，L4〕。
- Birsan（Eclipse 团队）在 ACM Queue 2005 分析"纯插件架构"，警告要避免"plug-in hell"；转述里提到"内核至少要提供查找、加载、运行插件的运行时支持"〔二手，L2〕。〔未核实〕原文的具体坑点清单没读到。
- Syeed 等 2015：主张把"可插拔系统"当作更高层的架构模式，并以 Eclipse 生态为例〔一手（摘要），L5〕。
- Cordis 论文：把"撤销副作用"和"管理依赖"形式化，作为动态组合的基础〔一手（摘要），L1〕。

**agent 框架里的记忆、人设插件**：

| 项目 | 做法 | 宿主守不守不变量 | 依据 |
| --- | --- | --- | --- |
| OpenClaw | 记忆是互斥槽位；宿主铸造受众、插件负责过滤；没实现授权钩子就扣下会话命中 | 受众由宿主定义，过滤交给插件 | 一手，O1 |
| DSH | 记忆不是槽位，经 MCP 接外部记忆服务器；人设是提示词段落 | 不守；第三方人设可以绕开官方人设段落 | 一手，D13、D17 |
| AstrBot livingmemory | 插件自带存储、工具、界面、按会话筛选 | 不守 | 一手，A2 |
| elizaOS | `Plugin` 对象注册 providers（每回合拼上下文）、evaluators（回复后抽事实与关系）；v2 记忆作用域默认 `owner-private`，准入取所有在场成员的最小权限；`plugin-relationships` 是插件 | v2 由核心类型定义作用域 | `companion-architectures` §5.2 |
| 麦麦 | 插件进独立 Runner 子进程，内置组和第三方组分开；能力在 manifest 声明 | 进程隔离，但不涉及记忆 | `companion-architectures` §2.2 Q7 |
| AIRI | 扩展 manifest v2 严格校验；Kit = 契约 + 提供方，提供方版本精确匹配；插件"是受信任的进程内代码" | 不守 | `companion-architectures` §4.2 Q7 |
| Paseo Helm 插件平台 v1 | 服务契约用 JSON Schema 描述；调用前后各查一次权限、校验出入参；有 `OUTCOME_UNKNOWN`；"所有插件都被信任" | 宿主做调用检查 | `paseo-architecture` §2.2 Q7 |

### 2.9 Q1–Q10 横向对比

| 问题 | DSH | Koishi / Cordis | NoneBot2 | AstrBot | VS Code | OpenClaw |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 内核最小职责 | 自称无内核；实为 Cordis 运行时 + Loader + 启动器 + 10 项 required 名单 | Cordis 运行时 + Loader；`ctx.model`、`ctx.i18n` 自带 | 框架主体；驱动器、适配器、插件三层 | 本体（消息管线、WebUI、提供商管理） | 编辑器核心 + 扩展宿主；很多功能是内置扩展 | Gateway：会话、路由、共享 message 工具、调度 |
| Q2 扩展点与互斥 | 服务键（同名即互斥）+ 注册表服务（多实现）；按名独占；UI slot 有 single/list/keyed/chain | 服务默认单实例；`implements` 声明填哪个服务；控制台 slot 可多次注入 | 服务端驱动器只能一个；适配器多个 | 平台适配器、插件多个 | 贡献点声明式，多数可多个 | `plugins.slots` 只有 memory、contextEngine 互斥；其余多个 |
| Q3 契约与生命周期 | `package.json.dsh` + patch 行；`inject` 等依赖；effect 自动回收；Web profile 热重载 | 同 Cordis；`reusable`、`fork`；热重载 | `PluginMetadata`；import hook；`require`；无运行时卸载 | `metadata.yaml`；按钮重载 | `package.json`；激活事件懒加载；`deactivate` | `openclaw.plugin.json`；manifest 先于代码校验；`register(api)` |
| Q4 隔离与信任 | 全进程内、无沙箱；装插件要批准；无签名 | 全进程内；`insecure` 标识；无签名 | 全进程内 | 全进程内；界面用受限 iframe；多个安装接口 CVE | 扩展宿主独立于界面；webview 隔离；市场多次投毒 | 全进程内；安全闸 + 来源信任 + 能力同意 + 完整性哈希 |
| Q5 数据归属 | 插件自建 `storages/<插件>/`；会话事件是共享日志 | 插件可扩展任何表，含内置表 | localstore 每插件目录；ORM 每插件迁移分支 | `plugin_data/<插件>/` + 按插件 KV | `globalState`/`workspaceState` 按扩展〔未核实〕 | 记忆插件自有存储；引用带 providerId |
| Q6 版本与兼容 | 公开 API 未稳定、每次更新所有消费方；`engines.dsh` 导入前检查；精确豁免 | peer 依赖范围〔推理〕；字段改名留旧名 | 插件自管 | `astrbot_version` 不满足即阻止加载，可强行安装 | `engines.vscode`；proposed API 隔离不稳定接口 | 安装前查插件 API 版本；旧新两套记忆运行时并存 |
| Q7 界面插件 | 同页 Cordis 插件 + 类型化 slot | 同页 Vue 扩展，`ctx.page`、`ctx.slot` | 无官方界面 | 受限 iframe + bridge | 贡献点 + webview | 原生（同源、可信）与沙箱小部件两档；可替换核心视图 |
| Q8 内置也做成插件 | 全部；有 required 名单兜底 | 市场、配置页都是预装插件；删了会坏 | 适配器、驱动器可选 | 部分 | `extensions/` 107 项；内置用 proposed API | 大量 bundled 插件；bundled 免能力审查 |
| Q9 记忆、人设可替换且守不变量 | 不守 | 无此概念 | 无此概念 | 不守 | 不适用 | 记忆槽位：宿主铸造受众、插件过滤、失败即关闭 |
| Q10 典型坑 | API 频繁破坏（81 条升级条目）；静默 PENDING；测试绕过真实加载；第三方绕开人设段落；渠道插件各自重做访问控制 | 删预装插件会坏；共享表多写者 | 无运行时卸载 | 安装接口 = 执行任意代码 | 恶意扩展；内置与第三方不平等 | 兼容层越叠越厚；插件生态投毒（见已有报告） |

---

## 3. 对灵鲸的设计建议

先说总判断，再逐条回答 D1–D7。

**总判断。** DSH 的"万物插件化"值得学的是**形状**：一个小的组装核心、按键查找的服务、可撤销的注册、可叠加的配置层、类型化的界面 slot。不能照搬的是它的**信任模型**：DSH 是"开发者自己的工具"，所有插件同进程、全信任，任何插件都能绕开任何策略（第三方人设插件就绕开了官方人设段落，〔一手，D17〕）。灵鲸住着的是一个有隐私、有出生设定、会对外说话的人，这些规矩靠代码保证（`overall.md` P2、P3、§11）。所以灵鲸要的是：**插件可以替换"怎么算"，不能替换"谁能写、写什么才算数"**。〔推理〕

用户说"只存在一个标准的调度"。建议把它落成：**内核 = 调度 + 守门 + 记账**。调度是回合与作业的调度，守门是准入和不变量校验，记账是操作日志和账本。其他都是插件。〔推理〕

### D1 内核必须保留什么

**推荐**：下表左边 9 项留在内核，不做插件；右边全部做插件。

| 留在内核 | 理由 |
| --- | --- |
| ① 插件宿主与注册表：发现、校验 manifest、槽位解析（按成员）、加载、effect 回收、健康与熔断 | 宿主本身被替换，谁来校验替换者？DSH 的启动器和 Cordis 运行时也不可替换〔一手，D7〕 |
| ② 操作日志与投影运行器（journal） | P2 日志是唯一事实来源。投影的"运行器"在内核，投影"单元"可以是插件（DSH 的投影单元就是纯折叠，框架负责驱动〔一手，D12〕） |
| ③ 账本：已接受的记忆条目、出生设定与生效的成长版本、身份绑定与主人设定的关系、承诺与方针 | 这些是不变量所在的数据。谁能写、写什么才算数，必须由一处代码决定（P7、§2.3）。见 D3 |
| ④ 行动管线与准入：暂停、花钱总闸、能力收回、受众检查、先记后做 | §0.1"所有动作都从同一条管线出去"，隐私和花钱各只有一个拦截点；放进插件就会出现 DSH 那种"任何插件都能短路瀑布"的情况〔一手，D3、D11〕 |
| ⑤ 回合调度：会话邮箱、并发上限、换新、闲置回收 | 用户说的"标准调度"本体 |
| ⑥ 会话令牌与内核工具端点（toolport） | 令牌决定"调用者是谁"，不能交给插件自报（§11.3；Paseo 反例） |
| ⑦ 客户端接入与鉴权（gateway） | 网络暴露面和主人鉴权 |
| ⑧ 主人身份与主人专属控制项 | §11.6：这些只经 gateway 的主人接口，任何会话、任何插件都调不到 |
| ⑨ 受众与场合键的计算 | §2.3"场合键只由 social 计算"；受众一旦能被插件算，隐私就交给了插件 |

| 做成插件 | 说明 |
| --- | --- |
| 大脑提供方（Claude、Codex、ACP，以后自研） | 已是 §9.2 的契约，只是正式登记为槽位 |
| 形态适配器（QQ、微信、B 站……） | §9.3，进程外 |
| 能力提供方（听、说、看、画、嵌入） | §9.4 |
| 记忆引擎 | 抽取、整理、召回排序、遗忘策略。见 D3 |
| 成长引擎 | 人设怎么组装进提示词、当下状态怎么更新与衰减、成长提案怎么产生。见 D3 |
| 关系模型与角色内容包 | 关系类型、默认权限、印象怎么变。见 D4 |
| 界面区域与界面贡献 | 见 D5 |
| 作业触发类型、门控策略、内核工具贡献 | 见 D2 |

**理由**：

1. 被插件替换的东西，必须有不被替换的东西来检查它。OpenClaw 的记忆槽位把"受众是什么"留给宿主铸造，插件不能自己构造〔一手，O1〕；DSH 把"拒绝不能被翻成允许"做成单调守卫〔一手，D11〕。两家都在插件之外留了一个裁判。
2. 灵鲸的三条硬规矩（日志唯一来源、隐私按受众由代码保证、出生设定只有主人能改）都是"写入和读出时的检查"。检查放在哪，哪就是内核。〔推理〕
3. DSH 自称无内核，事实上有 required 名单；不如明说。明说的好处是：内核清单就是"不能被替换"的承诺，插件作者和主人都知道边界。〔推理〕

**取舍**：内核比 DSH 大。换来的是不变量只有一处实现。代价是这 9 项的接口要设计得稳，改它们就要改所有插件（但第一版插件全在仓库里，改得动，见 D7）。

**依据**：DSH required 名单与单调守卫〔一手，D7、D11〕；OpenClaw 宿主铸造受众〔一手，O1〕；`overall.md` §0.1、§2.3、§11.3、§11.6；微内核"核心只保留最小功能"〔二手，L3〕——灵鲸的"最小"按"守住不变量所需的最小"算。〔推理〕

### D2 灵鲸的槽位清单

**推荐**：

| 槽位 | 基数 | 作用域 | 第一版内置实现 | 版本 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `brain.provider` 大脑提供方 | 多个并存；**绑定单选**：每个"成员 × 角色"（主意识主用、主意识备用、干活分身、内省）选一个 | 全局登记，按成员绑定 | Claude、Codex | V1 | 契约即 §9.2 |
| `form.adapter` 形态适配器 | 多个；每个场合地址只归一个适配器 | 全局 | 无（主控台和网页走 gateway） | V2 | 进程外子进程（N3） |
| `ability.<种类>` 能力提供方 | 每种能力多个实现，**有序回退链** | 全局，可按成员覆盖 | 线上服务各一家 | V1 后期 | 一条语音中途不换家（§9.4） |
| `memory.engine` 记忆引擎 | **每成员恰好一个**（互斥） | 按成员 | 内置默认引擎 | V1 | 见 D3 |
| `growth.engine` 成长引擎 | **每成员恰好一个**（互斥） | 按成员 | 内置默认引擎 | V1 | 见 D3 |
| `social.model` 关系模型 | **每成员恰好一个**（互斥） | 按成员 | 内置默认模型 | V1（只有主人）；V3 起有意义 | 见 D4 |
| `social.pack` 关系与角色内容包 | 多份可装；成员和关系引用其中的条目 | 全局 | 内置一份默认包 | V2 | 纯数据，见 D4 |
| `persona.template` 出生设定模板 | 多份可装；只在"创建成员"时用 | 全局 | 内置几份 | V1 可选 | 纯数据 |
| `job.trigger` 作业触发类型 | 多个；每个触发类型名唯一 | 全局 | cron、一次性、间隔、空闲、事件 | V1 | 只定义"何时触发"，不改作业表归属 |
| `gate.policy` 门控策略 | 每种场合一条 **chain**：依次询问，第一个给出结论的胜出，都不表态用内核默认 | 按场合种类 | 只有"主人路由" | V2 | 第二道门（向量比对兴趣）就是一个策略插件 |
| `toolport.tool` 内核工具贡献 | 多个；工具名唯一；只能声明"提出动作"的工具，执行仍经行动管线 | 按会话种类过滤 | 第一版全在内核 | V3 起 | 插件不能绕过管线直接产生副作用 |
| `ui.area.<区域>` 界面区域 | 每个区域 **single** | 全局 | 六个区域各一个 | V1 | 见 D5 |
| `ui.<贡献点>` 界面贡献 | **list** 或 **keyed** | 全局或按会话 | 内置若干 | V1 | 见 D5 |

不是槽位的（内核）：D1 左表 9 项，以及存储后端（SQLite）和进程管理（procs）。

**理由**：

1. **互斥槽位按成员，不按全局。** OpenClaw 的槽位是全局的〔一手，O2〕，因为它一个 Gateway 一套记忆。灵鲸以后有多个成员（V3），批图专家可能要一个"领域记忆长期不忘"的引擎，闺女用默认引擎。DSH 的 agent 作用域遮蔽〔一手，D3〕和 Koishi 的 `$isolate`〔一手，K1〕都是"同名服务按范围给不同实例"的先例。〔推理〕
2. **"多个并存、绑定单选"和"互斥"是两回事。** 大脑提供方要同时登记 Claude 和 Codex，否则没法给不同角色配不同大脑，也没法切备用（决策 6）；但同一个角色同一时刻只用一个。DSH 的 `ctx.llm` 适配器注册表 + 会话的模型选择就是这个形状〔一手，D2、D4〕。
3. **记忆、成长、关系模型必须互斥。** 两个记忆引擎同时往一个成员身上写记忆，等于两份真相。OpenClaw 把记忆做成互斥槽位，而且只有选中者能拿到写回和召回工具的特权〔一手，O1〕。DSH 没做互斥，结果第三方人设和官方人设可以同时出现在提示词里〔一手，D17〕。
4. **门控用 chain。** DSH 界面 slot 的 `chain` 基数（依次询问，第一个非空胜出，都拒绝用拥有者默认）〔一手，D9〕正好适合"多个策略都可能想表态"的门控。〔推理〕

**取舍**：按成员解析槽位比全局多一层查找；换来以后多成员各配各的不用改结构。第一版只有一个成员，按成员的配置项可以先只填一行。

**依据**：OpenClaw `plugins.slots`〔一手，O2、O1〕；DSH 同名服务互斥、作用域遮蔽、slot 基数〔一手，D15、D3、D9〕；Koishi 服务单实例与 `implements`〔一手，K1、K2〕；Backstage `singleton` 输入〔一手，B1〕；NoneBot 服务端驱动器只能一个〔一手，N1〕。

### D3 记忆、成长做成可替换插件，怎么守住不变量

用户关心的三个不变量：操作日志是唯一事实来源；隐私按受众由代码保证；出生设定只有主人能改。

**先评估三个思路。**

| 思路 | 评估 | 先例 |
| --- | --- | --- |
| A. 插件只做日志的投影，换插件就从日志重建 | **对，但要改一个前提。** 记忆抽取是大模型做的，不是确定性的折叠；同一段日志重跑两次，抽出的记忆不一样。所以"重建"不能指"重跑大模型"，而要指"重放已接受的记忆事件"。引擎的产出（提案和被接受的记忆）本身必须写成日志事件 | DSH 投影单元是纯同步折叠、框架驱动〔一手，D12〕；"模型可见即已记录"〔一手，D2〕；`overall.md` §6.3 投影可删可重建 |
| B. 内核核对插件返回的每条记忆的来源事件和受众 | **对，而且应该做得比 OpenClaw 更硬。** OpenClaw 由宿主铸造受众，但过滤交给插件〔一手，O1〕。灵鲸可以让引擎只返回"记忆编号 + 排序分"，内容和受众由内核从自己的账本查。引擎编不出账本里没有的记忆，也拿不到受众不允许的条目 | OpenClaw 宿主铸造受众、拒绝非宿主铸造的受众对象、缺授权钩子就扣下会话命中〔一手，O1〕；eliza v2 受众取最小、默认 `owner-private`〔`companion-architectures` §5.2〕 |
| C. 插件只交提案，内核按不变量校验后写入 | **对，已经是 `overall.md` 的做法，需要把"校验什么"写成内核清单。** 内核只校验结构性的不变量，语义质量是引擎的事 | `overall.md` §2.3（`memory.propose`、`persona.applyGrowth`）；OpenClaw 做梦的规则关"结构上直接排除来源为 untrusted 或 system 的候选"〔`openclaw-architecture` §2.2 Q6〕；DSH 单调守卫〔一手，D11〕；Letta 反思子 agent 带理由提交〔`companion-architectures` §7.4〕 |

**推荐：三个思路合成"三条线"，并把现在的灵魂层模块拆成"账本 + 引擎"。**

```
                 内核（账本）                                  插件（引擎）
写入线   日志片段 ──▶ 引擎读 ──▶ 提案 ──▶ 内核校验 ──▶ memory.accepted 事件 ──▶ 账本投影
读出线   会话要召回 ──▶ 内核给引擎：查询 + 本会话受众的"可见集合" ──▶ 引擎返回 [记忆编号, 分数]
                   ──▶ 内核按编号查账本、再核受众 ──▶ 注入
存储线   引擎私有的派生数据（向量、图谱、摘要缓存）只放 derived.db 的引擎分区，可删可重建
```

1. **账本归内核，引擎归插件。**
   - 记忆：`memory` 拆成"记忆账本"（已接受条目、来源事件、受众、更正与删除、主人操作）和"记忆引擎"（抽什么、怎么合并压缩、怎么排序召回、怎么淡忘）。
   - 成长：`persona` 拆成"人格账本"（出生设定、成长版本与生效、回滚）和"成长引擎"（人设怎么组装成提示词、当下状态怎么更新衰减、成长提案怎么产生）。
   - 关系：`social` 拆成"关系账本"（身份绑定、主人设定的关系、场合与受众计算）和"关系模型"（印象怎么随相处变）。
   - 〔推理〕这对应 `overall.md` §2.3 所有权表的"所有者"一列：所有者留在内核，所有者的"大脑"变成插件。
2. **写入线的内核校验清单**（结构性，不判断好坏）：
   - 每条提案带证据事件编号，事件必须存在、属于这个成员；
   - 条目受众 = 证据事件受众里最严的那个，内核算，提案里写的不算；
   - 来源可信度：来源是系统、网络内容、被污染回合的，不能被提升（§6.6、§11.5）；
   - 成长提案只能指向"成长"字段，出生设定字段在 schema 上就不存在于提案里；非主人来源不能单独促成成长；每次变化幅度不超过出生设定里成长速率给出的上限；
   - 关系提案不能改主人设定的关系；
   - 主人删除过的内容不能被重新抽回（按证据事件号拦）。
3. **读出线**：内核先按本会话受众算出"可见的记忆编号集合"，只把这个集合（或它的过滤条件）给引擎；引擎只返回编号和分数；内核再查一次账本，丢掉不在集合里的。〔推理〕这样即使引擎有 bug 或被换成第三方实现，也说不出不该说的话。代价是引擎不能召回"账本外"的东西，比如它自己临时生成的摘要；需要的话，摘要也要先作为提案进账本。
4. **换引擎时旧数据怎么办**：
   - 账本里已接受的记忆不动。新引擎接手后，从账本和原始日志建自己的派生数据（向量、图谱），在后台追上；追上之前召回仍用旧引擎的派生数据或只用关键词。
   - 新引擎可以选择"从原始日志重新抽取"，产出的仍是提案，仍过内核校验；这一步花钱，要主人确认，放进作业，按空闲跑。
   - 旧引擎的派生数据在新引擎追上并经主人确认后删除。OpenClaw 的教训是"接收方确认写入之前不删旧数据"（`overall.md` §12.8 第 4 条）。
5. **引擎的运行形式**：决策 4 规定后台任务也走 CLI。所以记忆引擎、成长引擎的"大脑部分"是内省会话里的提示词和输出 schema，插件代码主要是：选哪段日志、给什么提示词、怎么解析产出、怎么排序召回。〔推理〕插件契约因此可以很窄：`ingest(日志片段) → 提案批次`、`consolidate(范围) → 提案批次`、`rank(查询, 可见集合, 上限) → [编号, 分数]`、`forget(时间) → 淡忘提案`、`renderPersona(账本快照) → 人设文本`、`updateMood(事件) → 当下状态提案`。

**理由**：三个不变量都是"谁能写进账本、谁能读出账本"的规则。把账本留在内核，引擎无论怎么换都碰不到这两道门。OpenClaw 只做到了一半（宿主定义受众，插件执行过滤）〔一手，O1〕，DSH 和 livingmemory 完全没做〔一手，D13、A2〕。

**取舍**：
- 引擎作者的自由度变小：不能自己存"真相"，只能存可重建的派生数据。
- 召回多一次账本查询（SQLite 主键查，便宜）。
- 换引擎不是零成本：派生数据要重建；要重新抽取就要花钱。

**依据**：OpenClaw 记忆槽位契约〔一手，O1〕；DSH 投影单元与"模型可见即已记录"〔一手，D12、D2〕；DSH 单调守卫〔一手，D11〕；OpenClaw 记忆来源存独立列、提升有规则关〔`openclaw-architecture` §2.2 Q6〕；`overall.md` §2.3、§6.6、§6.7、§11.4、§12.8。拆"账本 + 引擎"、读出线只回编号是〔推理〕。

### D4 "朋友关系、角色的定义"做成插件，数据长什么样

**推荐：做成"内容包"（纯数据、不含代码），由内核按 schema 校验；会变的部分（印象怎么变）才是代码插件 `social.model`。**

一个关系与角色内容包的形状（草案）：

```yaml
spec: liwa-social-pack
spec_version: 1
id: default-family            # 包身份：作者/名字
version: 1.0.0
roles:                        # 身份角色：说明"这个人是谁"
  - id: family.parent
    label: { zh: 父母, en: Parent }
    audience_tier: family     # 默认可知范围档位，只能从内核定义的档位里选
    capabilities:             # 只能从内核定义的权限词表里选
      can_wake_member: true
      can_assign_work: false
relation_types:               # 成员和某人之间的关系类型
  - id: friend
    directed: false
    label: { zh: 朋友 }
    impression_dims: [信任, 亲近]      # 印象维度，给 social.model 用
    defaults: { 信任: 0.5, 亲近: 0.3 }
    growth_modifier: 1.0               # 叠加在出生设定的成长速率上
    prompt_fragment: "对朋友说话随意一些，但不替主人做决定。"
  - id: teacher
    directed: true
    label: { zh: 老师 }
    ...
extensions: {}                # 厂商扩展字段，按命名空间，未知字段必须原样保留
```

规则：

1. **权限只能映射到内核词表。** 包里的 `capabilities` 和 `audience_tier` 只能取内核定义的值，包不能发明新权限。内核词表由主人专属控制项和行动管线决定（§11.6、§11.9）。
2. **带权限的字段导入要主人确认。** 一个包把"能派活"给了某个角色，导入时要明确展示并确认，像 OpenClaw 的能力同意〔一手，O3〕。
3. **包是模板，绑定是主人的事。** "爸爸是 family.parent"这件事写在关系账本里，只有主人能写（§2.3）；包只提供可选的角色和关系类型。
4. **未知字段原样保留。** 照角色卡 V2 规范："`extensions`……must never destroy unknown key-value pairs"〔一手，C1〕。
5. **出生设定模板**用同样的包格式（`spec: liwa-persona-template`），只在创建成员时用；建好之后出生设定就是账本里的数据，和模板脱钩。DSH 人设插件的"导入/导出人设文件"〔一手，D17〕和角色卡〔一手，C1〕都是这个思路。
6. **印象怎么变**才是代码：`social.model` 插件按相处事件提"印象变化提案"，过内核校验（主人设定的关系不可改）。麦麦的关系系统从"一个数值六档"改到"攒够消息总结成印象"再到"人物画像"〔`companion-architectures` §2.2 Q2〕，说明这部分会反复换，适合做成可替换的。

**理由**：关系和角色的"定义"本质上是数据：有哪些角色、默认能做什么、默认能知道什么、她对这类人用什么口吻。数据做成内容包，不执行代码，信任问题小得多，可以放心让别人分享。真正敏感的是"谁被绑定成什么角色"，那是账本的事。〔推理〕

**取舍**：内容包表达力有限，做不了"根据对方语气动态调整亲近度"这种逻辑，那部分归 `social.model`。内核要维护一份权限词表和档位表，加新权限要改内核。

**依据**：角色卡 V2 的 `spec`/`spec_version`/`extensions` 规则〔一手，C1〕；eliza 的 Role 枚举和有向 Relationship + tags〔`companion-architectures` §5.2 Q2〕；DSH 人设库的导入导出〔一手，D17〕；Koishi 用 schema 同时做校验和表单〔一手，K1〕；`overall.md` §2.3、§11.2、§11.6。包格式本身是〔推理〕。

### D5 界面插件怎么做

**推荐**：

1. **一方界面**：主控台的六个区域都写成"内置界面插件"，挂进类型化的 slot，和本体同仓库、同版本构建。第一版不做运行时加载，不做热替换。slot 的类型契约在编译期检查（照 DSH 用 TypeScript 声明合并登记 slot〔一手，D9〕）。
2. **第三方界面分两档**，都不让第三方代码进主控台的文档：
   - **声明式贡献（默认）**：插件只交数据和 schema，由主控台画：设置表单（schema 生成）、成员页上的卡片和数值、日志页的事件渲染模板、任务卡片上的标记。Koishi、AstrBot 的配置 schema 表单〔一手，K1、A1〕、VS Code 的贡献点〔一手，V1〕都是这类。
   - **沙箱视图（需要自定义交互时）**：受限 iframe，照 AstrBot：`sandbox="allow-scripts allow-forms allow-downloads"`，不给 `allow-same-origin`；页面经 `postMessage` 桥调用，桥只开放"这个插件自己的后端接口"和"按本插件权限过滤过的只读数据"；资源响应带 CSP〔一手，A1〕。视图拿不到主控台的会话令牌和 WebSocket。
   - **不做同页原生第三方界面**：OpenClaw 明说原生界面和操作者共享 Gateway 全部权限〔一手，O4〕；Grafana 的同页沙箱已经放弃〔一手，G1〕。
3. **逃生口**：设置页和插件管理页永远用内置版本，不允许替换（照 OpenClaw "plugin settings always use the built-in workspace"〔一手，O4〕）。这样一个坏的界面插件不会让主人连"关掉它"的入口都没有。Koishi 的反例是"删除预装插件可能导致 Koishi 无法正常运行"〔一手，K1〕。
4. **引擎插件自带自己的界面**：记忆引擎、成长引擎、关系模型各自给成员页贡献一个标签页（例如记忆图谱）。但"查看、更正、删除记忆""回滚成长""改出生设定"这些主人操作属于账本，界面也必须是内置的，不能由引擎插件提供。livingmemory 自带插件视图〔一手，A2〕、OpenClaw 记录型记忆提供方"keeps its own tools, skills, and UI"〔一手，O1〕是先例。

主控台各区域的 slot 草案：

| 区域 | 区域 slot（single，内置） | 可贡献的子 slot | 基数 | 谁会贡献 |
| --- | --- | --- | --- | --- |
| 对话 | `ui.area.chat` | `chat.segment.renderer`（按内容段类型：文字、语音、表情、图片……） | keyed | 能力插件（例如画图结果的展示） |
| | | `chat.composer.action` | list | 能力插件、形态插件 |
| 任务看板 | `ui.area.board` | `board.card.badge` | list | 大脑插件（用量、模型名） |
| 现场【V4】 | `ui.area.live` | `live.view`（按形态或能力种类） | keyed | 形态适配器、电脑操作能力 |
| 工作区 | `ui.area.workspace` | `workspace.panel` | list | 大脑插件（CLI 专属信息） |
| 成员 | `ui.area.members` | `member.tab`（出生设定、状态、日记、成长、记忆、技能、关系网、大脑） | list | 账本相关标签内置；引擎、关系模型、大脑插件各贡献自己的标签 |
| 日志与花费 | `ui.area.ledger` | `ledger.event.renderer`（按事件类型） | keyed | 任何登记了新事件类型的插件 |
| | | `ledger.view` | list | 能力插件（用量换算视图） |
| 设置与插件 | `ui.area.settings` | `settings.section`（schema 生成） | list | 所有插件；**区域本身不可替换** |

**理由**：前后端同版本发布（§3.7、§10.1），一方界面放在同一构建里最简单，类型也能对上。第三方界面一旦进同一文档，就拿到主人的全部权限，而主控台能暂停、改出生设定、看全部记忆；这和"隐私按受众由代码保证"冲突。〔推理〕

**取舍**：第三方界面的体验不如原生（iframe 里的样式和交互要自己做）。如果以后主人自己写的界面插件需要原生体验，可以给"主人自己仓库里、构建时编进来"的插件开原生通道，但那等于把它当一方代码。

**依据**：DSH slot 模型〔一手，D9〕；Koishi 控制台扩展〔一手，K1、K2〕；AstrBot 受限 iframe〔一手，A1〕；OpenClaw 原生与沙箱两档、替换视图、设置页逃生口〔一手，O4〕；Backstage `singleton` 输入与覆盖〔一手，B1〕；Grafana 前端沙箱废弃〔一手，G1〕；VS Code webview 与贡献点〔一手，V1〕。区域划分来自 product.md「主控台」。

### D6 信任分级

**推荐**：

| 档 | 例子 | 运行位置 | 能挂哪些槽位 | 怎么进来 | 拿到什么 |
| --- | --- | --- | --- | --- | --- |
| ① 内置 | 仓库里的 Claude/Codex 大脑、默认记忆引擎、默认成长引擎、六个界面区域 | 进程内；依赖第三方协议栈或原生代码的按 N3 放进程外 | 全部 | 随本体版本 | 全部内核 API，但仍只能经账本和行动管线写。这是结构约束，不是安全边界 |
| ② 主人安装 | 主人自己写的或审过的形态适配器、能力提供方、引擎、沙箱视图 | **默认进程外子进程** | 形态、能力、大脑、引擎、界面（声明式 + 沙箱视图） | 只经主人接口安装；钉精确版本和内容哈希；安装时列出它声明的槽位和权限，主人确认 | 只拿声明的槽位；子进程环境变量清洗、独立数据目录；所有调用走消息协议 |
| ③ 内容包 | 关系与角色包、出生设定模板 | 不运行代码 | `social.pack`、`persona.template` | 任何来源；带权限的字段要主人确认 | 只是数据 |
| ④ 第三方未审阅 | 社区包 | — | **第一版不开放** | — | — |
| ⑤ 她自己写的工具【V4】 | 自写脚本 | 技能隔离通道（§9.6） | **不挂任何槽位** | 活经过验证才成候选 | 不能安装插件，不能注册内核工具，不能改界面 |

关键规则：

1. **插件只能由主人装。** 没有给任何会话的"装插件"工具。DSH 给模型开了 `plugin_manager` 工具（每次要批准）〔一手，D7〕；灵鲸的主意识大脑是便宜模型，不适合做这类安全决定（§5.9 同理）。〔推理〕
2. **安装接口按"执行任意代码"来防。** AstrBot 的多个 CVE 都出在安装、上传、更新接口〔二手，A3〕。灵鲸的安装只走本机主人接口，不开远程上传；不接受任意 URL；依赖安装禁用脚本（照 OpenClaw `--ignore-scripts`〔一手，O3〕）。
3. **和 N3 衔接：进程边界按"信任 + 技术风险"两条划。** N3 已经定了"依赖第三方协议栈或原生代码的放进程外"（§3.5）。加一条："不是仓库里的代码，默认进程外"。两条取并集。为此，**所有插件契约都定义成可序列化的消息**（入参、出参都是 JSON），内置插件在进程内直接调用，进程外插件由插件宿主用同一份契约走 IPC。这和 §3.5 末段"适配器开发包定义成一套消息协议"一致，只是推广到所有槽位。麦麦插件 Runner〔`companion-architectures` §2.2 Q7〕、Paseo Helm 平台 v1 的 JSON Schema 服务契约〔`paseo-architecture` §2.2 Q7〕、Grafana 后端插件子进程 + gRPC〔二手，G2〕都是先例。
4. **进程外不等于安全。** 同一系统用户下的子进程照样能读本体的数据目录（§11.1，Paseo 的原话）。真要隔离第三方代码，还得加操作系统级限制（macOS 上是 Seatbelt）。DSH 的沙箱 seam 有 bwrap、Landlock、Seatbelt 三个后端，用于包装它启动的进程〔一手，D4、`packages/README`〕。〔推理〕所以第三方插件（档④）要等这一层实测可行再开放。

**理由**：灵鲸只服务一个主人、跑在主人自己的机器上、不做公开市场（§1.3）。信任边界就是"主人"。插件的危险不在功能，在于它和她共享一个进程、一份数据目录、一条对外说话的管线。分档的目的是让"不是仓库里的代码"碰不到这三样。〔推理〕

**取舍**：进程外插件多一层 IPC 和生命周期管理（健康检查、重启上限、熔断，formhost 已有）。内置插件在进程内，性能好，但写错了照样能拖垮本体，只能靠测试和代码审查。

**依据**：`overall.md` §1.3、§3.5、§5.9、§9.6、§11.1；DSH 插件全信任、模型装插件要批准〔一手，D1、D7〕；OpenClaw 来源信任、能力同意、`--ignore-scripts`〔一手，O3〕；AstrBot 安装接口 CVE〔二手，A3〕；VS Code 市场投毒〔二手，V3〕；Grafana 未签名不加载〔一手，G1〕。

### D7 第一版做到哪一步

**推荐：第一版"按插件的形状写，但只装仓库里的插件"。**

第一版做：

1. **内核清单写进文档**（D1 左表），代码里用依赖检查工具强制"插件包只能 import 开发包公开入口"（§9.1 第一条，已有）。
2. **插件宿主的最小版**：启动时读配置 → 按成员解析槽位 → 校验每个插件声明的槽位和契约版本 → 加载 → 登记 effect 的释放函数。槽位空着、契约版本对不上，**启动时大声报错**，不静默挂起（DSH 的 PENDING 静默是反例〔一手，D5〕）。
3. **只实现第一版用得到的槽位，每个只有内置实现**：`brain.provider`（Claude、Codex）、`memory.engine`、`growth.engine`、`social.model`（只有主人一个关系）、`job.trigger`、`ui.area.*` 和少量 `ui.*` 贡献点；`ability.*` 在第一版后期。
4. **manifest v1 最小字段**：`id`、`version`、`liwa.contract`（每个槽位一个整数版本）、`liwa.slots`（声明填哪些槽位）、`liwa.config`（配置 schema）。
5. **账本与引擎分开写**（D3）：即使只有一个内置引擎，账本 API 和引擎契约也分开。
6. **一次替换演练**：写一个极简的第二个记忆引擎（例如"只按时间倒序召回最近 N 条"），用它跑通"换引擎 → 派生数据重建 → 召回仍守受众"。这条是验收项。
7. **测试走真实加载路径**：DSH 复盘 0001 的教训〔一手，D10〕。
8. **effect 释放函数从第一天就写**：哪怕第一版不做热重载，每个注册都返回释放函数，成本很低，以后加热重载或换插件不用返工（Cordis 的做法〔一手，D3〕）。

第一版不做：

- 不加载仓库外的插件；没有插件市场，没有安装界面。
- 不做热重载：换插件、改配置走"排空 → 重启"（N12）。
- 不做插件之间的依赖图：插件只依赖内核，不依赖别的插件（Paseo Helm 的依赖图"对第一版太重"〔`paseo-architecture` §2.2 Q7〕）。
- 不做第三方界面（声明式和沙箱视图都不做）。
- 不做内容包导入。
- 不做兼容层：契约改了，同一个提交里改所有内置实现（DSH "update every consumer"〔一手，D1〕；用户全局原则）。

以后再做：

| 版本 | 加什么 |
| --- | --- |
| V2 | 第一个真正的外部插件：QQ 或微信形态适配器，进程外，经 formhost；适配器开发包；关系与角色内容包；`gate.policy` |
| V3 | 多成员按成员选引擎；领域记忆可能是另一个记忆引擎；朋友会话 |
| V4 | 技能隔离通道（她自己写的工具，不是插件）；`ui.area.live` |
| 以后 | 主人安装的插件（档②）、声明式第三方界面、沙箱视图；操作系统级隔离实测通过后才考虑档④ |

**理由**：一个人维护。DSH 靠约 370 个包、900 多个文档文件、文档生成器和 CI 门禁来维持"万物插件"不散架〔一手，D1〕，它 10 个预发布版本里有 81 条破坏性变更〔一手，D14〕。灵鲸第一版的目标是验证"CLI 当主意识大脑""回复是工具调用""日志与恢复"这几个最大风险（§15.2），插件化的形状要有，插件生态不要有。"形状"保证以后换得动，"不开放"保证现在不用为兼容和安全买单。〔推理〕

**取舍**：第一版没人能真正"替换"任何东西，用户感受不到"万物插件化"。可以用主控台的"插件"页把当前各槽位装的是哪个实现展示出来（只读），让结构看得见。

**依据**：DSH 体量和破坏性变更计数〔一手，D1、D14〕；DSH 复盘 0001〔一手，D10〕；Paseo Helm 依赖图评估〔`paseo-architecture` §2.2 Q7〕；`overall.md` §9.1、§12.8、§15.2。

### 3.8 对整体架构稿的影响

| 位置 | 现在 | 建议改成 |
| --- | --- | --- |
| 决策 7 | 三类插件：大脑、形态、能力 | 槽位清单（D2）；三类插件是其中三个槽位 |
| §0.3 原则 | 八条 | 加一条〔推理〕"插件替换'怎么算'，内核持有'谁能写、写什么才算数'"，或并进 P3、P7 |
| §2.3 所有权表 | memory、persona、social 是所有者 | 所有者改成"记忆账本、人格账本、关系账本"（内核）；"内省会话交提案"改成"记忆引擎、成长引擎、关系模型（插件）经内省会话交提案" |
| §3.2 分层 | 灵魂层 = roster、persona、memory、social、agenda、skills | 灵魂层只放账本；引擎移到新的"插件层"，由插件宿主托管 |
| §3.3 模块清单 | 无插件宿主 | 加 `plugins`（插件宿主与注册表）；`brains`、`abilities`、`formhost` 变成"槽位宿主"，实现在插件里 |
| §3.5 进程内外 | 按技术风险划 | 加"不是仓库里的代码默认进程外"；所有契约可序列化 |
| §9 扩展边界 | 三类插件 | 整节改写为：内核清单、槽位清单、manifest、契约版本、信任分级 |
| §10.5 前端结构 | 只引用 client-backend | 加界面 slot 与区域清单（D5） |
| §11 安全 | 无插件信任 | 加信任分级（D6）；装插件只经主人接口 |
| §15 第一版范围 | 无插件宿主 | 加插件宿主最小版、替换演练（D7） |

---

## 4. 坑与反例

1. **"无内核"其实有内核**〔一手，D7〕。DSH 的 required 名单失败就整体退出。不明说内核，插件作者不知道哪些不能换。
2. **策略能被任何插件短路**〔一手，D3、D11〕。Cordis 的瀑布事件允许监听器不调 `next()` 直接返回，`prepend: true` 还能抢先注册。DSH 后来补了"单调守卫"。灵鲸的不变量不能放在可被插件插队的位置。
3. **互斥没做实，插件就绕开**〔一手，D6、D17〕。官方人设段落会因为同名注册而报错，第三方人设插件就换个名字注册自己的段落，两份人设同时进提示词。互斥要按"槽位"做，不能按"名字"做。
4. **核心没有渠道抽象，每个渠道插件各写一遍访问控制**〔一手，D17〕。`dsh-qqbot` 自己做访问控制、会话映射、模型选择，默认私聊和群聊都是 `open`。灵鲸 §9.3"准入策略在本体、插件不得判断回不回"是对的，要守住。
5. **静默 PENDING**〔一手，D5〕。依赖的服务不在，插件就一直等，不报错，进程甚至以状态码 0 退出。
6. **测试绕过真实加载**〔一手，D10〕。178 个单元测试、100% 覆盖，真实加载一次就崩。
7. **API 频繁破坏**〔一手，D14、D17〕。DSH 10 个预发布版本 81 条升级条目；第三方作者自己发明字段记录"实测兼容的版本"，提醒"宿主大版本升级后请重新验收席位行为"。外部插件一多，每次改契约都是生态成本。
8. **兼容层越叠越厚**〔一手，O1；一手，K1〕。OpenClaw 记忆有旧新两套运行时、搜索接口 v1/v2 并存；Koishi 字段改名要把旧名永远留在代码里。灵鲸第一版不开放外部插件，就能一直"改在根上"。
9. **删了预装插件系统就坏**〔一手，K1〕。内置也做成插件，主人就能把它卸了。要有不可替换的逃生口（设置页、插件管理页）和 required 名单。
10. **内置和第三方不平等**〔一手，V2〕。VS Code 的内置 git 扩展用了 35 个第三方不能用的 proposed API。灵鲸的内置插件也会想要"多一点权限"；要么把权限加进公开契约，要么承认它是内核。
11. **装插件 = 执行任意代码**〔二手，A3、V3；一手，D1〕。AstrBot 安装接口的多个 CVE、VS Code 市场投毒、DSH 安全说明都在说同一件事。
12. **同页沙箱做不成**〔一手，G1〕。Grafana 的前端沙箱公开预览被废弃。第三方界面要隔离，就用 iframe 或声明式。
13. **共享表多写者**〔一手，K1〕。Koishi 允许任何插件往内置 `user` 表注入字段。违背 P7"每张表一个主人"。
14. **插件私有数据各自为政**〔一手，D17、A2〕。DSH 人设插件自定义 `personas.json` 的 `version: 1`，曾经"工作区档重启后被静默降级"；livingmemory 跨版本升级要先看迁移说明。插件私有数据必须是可重建的派生数据，真相留在账本。
15. **生态质量参差**〔二手，D19〕。有第三方站点称 DSH 插件三天涨到 4300 多个、约 2% 质量较高、45 小时内发现 4 个高危漏洞。单一来源，未核实，但方向和 OpenClaw 技能市场投毒（`openclaw-architecture` §2.2 Q10）一致。
16. **记忆插件拿到全部数据就能泄露**〔推理〕。DSH 经 MCP 接的外部记忆服务器、AstrBot 的记忆插件，都能读到全部对话。灵鲸的读出线只回编号（D3）就是为了堵这个口；写入线上，引擎仍然要读日志片段，所以第三方记忆引擎必须进程外，且只拿到它负责的那个成员、那段范围的日志。

---

## 5. 待实测、待核实

| # | 项目 | 影响哪条建议 | 类别 |
| --- | --- | --- | --- |
| 1 | "读出线只回编号"对召回质量的影响：引擎不能召回账本外的临时摘要，是否明显变差 | D3 | 待实测 |
| 2 | 换记忆引擎时派生数据重建的耗时和花费（向量重算、图谱重建）；从原始日志重新抽取的花费 | D3 | 待实测 |
| 3 | 插件子进程能否在 macOS 上用 Seatbelt 限制只读写自己的数据目录；DSH 沙箱 seam 的 Seatbelt 后端能否借鉴 | D6 | 待实测 |
| 4 | 进程外插件的 IPC 开销对能力调用（语音合成流式输出）和召回延迟的影响 | D6 | 待实测 |
| 5 | 受限 iframe（不带 `allow-same-origin`）里的视图能否满足成员页图谱这类重交互；Tailscale 远程访问下的表现 | D5 | 待实测 |
| 6 | DSH 是否真的在启动时强制 `engines.dsh`：`package-manifest` README 和 `app-boot` README 说法相反，没读源码 | §2.1 | 待核实 |
| 7 | Birsan 2005 原文的坑点清单、Richards 微内核一章的注册表与契约论述、POSA Microkernel 原文 | §2.8 | 待核实（原文 403 或没读） |
| 8 | VS Code 同一扩展宿主进程里的多个扩展之间是否隔离 | §2.5 | 待核实 |
| 9 | Grafana 后端插件进程模型（只有二手） | §2.7 | 待核实 |
| 10 | AstrBot 2026 年几个 CVE 的修复版本；stork.ai 关于 DSH 插件数量和漏洞的数据 | §2.4、§4 | 待核实 |
| 11 | Koishi 是否出过恶意插件事件（没搜到不等于没有） | §2.2 | 待核实 |
| 12 | 成长引擎作为插件时，"当下状态"的更新是否会因为每次都过内核校验而太慢（当下状态更新频繁） | D3 | 待实测 |
| 13 | 按成员解析槽位后，内省会话（每个成员的记忆引擎各跑各的）对并发上限和花费的影响 | D2 | 待实测（V3） |
