# 03 agent 配置：全局集合与四级作用域

状态：四级文件解析与 Claude 映射已随④在 `13a66153` 实现；宿主 opening 接线按决策 67 的 G′，roster 配置事件／主控台页面在第二层推进。本文是配置文件的唯一规范，不是 CLI 原生设置的自动导入器。依据：〔一手〕主人工作记录待写回 18、19；`packages/brain/brain/src/agents-config/index.ts:1`。

## 1 两套规范的边界

| 规范 | 拥有什么 | 入口／生效 |
| --- | --- | --- |
| 软件配置 | 装哪些 Cordis 插件、二进制／binaryArgs、实例 env/Key、模型目录、监听／存储／超时 | bundle → profile patch → home patch → --patch，部署／装配时；安全 reload 只影响后续会话 |
| agent 配置 | 指令、本事、MCP、本地 CLI 插件、command 钩子及其选择 | `$LIWA_HOME/agents/agents.yml`、`dirs/` 与会话字段；每次打开会话解析，运行中不改不可变快照 |
| 提供方实例 | 同一个 brain-* 插件在 Cordis 挂多行，各 impl 唯一、认证独立；实例可带自有 skills/MCP/plugins/hooks | 部署参数在 Cordis；对全局集合的 use/disable 在 agents.yml.instances，不能写进提供方 Config |

依据：〔一手〕`apps/cli/src/profile-boot.ts:68`、`:82`、`:215`；`packages/brain/brain-claude-code/src/config.ts:18`、`packages/brain/brain/src/agents-config/index.ts:46`。后续 roster 接管配置实体与事件时复用本解析器，不新建第二套文件合并规则。〔推理〕唯一归属。

Claude／Codex 首版 Key 在所选实例的 `env` 中明文配置；不提供 credential-ref／默认 OAuth 接线。全局 agent 集里的 MCP env／URL／headers 可用 `${VAR}` 展开，未定义变量装载即失败；这不是凭据库，也不把已展开秘密存进 agent JSON／resume／日志。其他 agent 集字段不承诺环境插值，`!!js` 不属于本 YAML 规范。〔一手〕主人工作记录 15、18；`packages/brain/brain-claude-code/src/config.ts:144`、`packages/brain/brain/src/agents-config/index.ts:228`。

## 2 四级作用域

| 级 | 文件／调用 | 能做什么 |
| --- | --- | --- |
| 全局默认 | `<agentsRoot>/agents.yml`，agentsRoot 默认由 bundle 设为 `$LIWA_HOME/agents` | 定义命名的 skills/mcpServers/plugins/hooks/instructions；applyTo 省略即默认用于所有实例，给定则默认只用于所列 impl |
| 实例 | 同文件 `instances.<impl>.use/disable`；实例部署自带材料仍在 Cordis | 从全局集按名选择，不另造配置格式 |
| 目录 | `<agentsRoot>/dirs/<hash>.yml`，hash 是规范化绝对 cwd 的 SHA-256 前 32 个十六进制字符 | 只有 version、path、instances；各实例只 use/disable，不能新增条目／指令正文／permissions |
| 对话 | SessionConfig 的 skillsDir、mcpServers、plugins、hooks、instructions，以及 model/modeId/thinkingOptionId 等 | 追加本场材料，独立快照；能力不支持则创建前拒绝；当前代码档位字段仍为 thinking，D′ 原处统一为 thinkingOptionId |

路径规范化为 `resolve(cwd).normalize('NFC')`，不是 realpath；目录文件里的 path 必须与请求 cwd 规范化后相同，不扫描父目录继承，不读取仓库 `.liwa/agents.yml`。目录级只由主人管理的 agentsRoot 读取，不因 clone 工作区自动获得执行钩子能力。〔一手〕`packages/brain/brain/src/agents-config/index.ts:57`、`:132`、`:125`、`:224`；主人工作记录 19。

## 3 文件形状

全局集使用 version:1 的严格 YAML 对象，未知键／非法条目名／未知钩子事件报错。条目名匹配 `^[a-z0-9][a-z0-9_-]*$`；相对 dir/file 相对 agentsRoot 解析。本事目录必须有 SKILL.md；插件目录必须有 `.claude-plugin/plugin.json`；MCP 服务器名 liwa 保留给内核工具。〔一手〕`packages/brain/brain/src/agents-config/index.ts:24`、`:46`、`:108`、`:199`；`packages/brain/brain-claude-code/src/config.ts:499`。

```yaml
version: 1
skills:
  review: { dir: skills/review }
  release: { dir: skills/release, applyTo: [claude-main] }
mcpServers:
  docs:
    type: http
    url: https://mcp.example.test/docs
    headers: { Authorization: 'Bearer ${DOCS_TOKEN}' }
plugins:
  reviewer: { dir: plugins/reviewer, applyTo: [claude-main] }
hooks:
  audit:
    event: PreToolUse
    matcher: Bash
    hooks: [{ type: command, command: 'liwa-audit-tool' }]
    applyTo: [claude-main]
instructions:
  house: { file: instructions/house.md }
instances:
  claude-main: { use: [release], disable: [docs] }
  codex-main: { disable: [reviewer, audit] }
```

hooks 是“条目名 → {event,matcher?,hooks,applyTo?}”，不是直接把 settings.hooks 事件表粘进全局集。每个 command 钩子有非空 command、可选正整数 timeout（秒）；物化后才转成事件 → matcher[] 的 Hooks。instructions 是文件引用，不是可执行脚本；插件与钩子仅使用主人明确配置的受管来源。〔一手〕`packages/brain/brain/src/agents-config/index.ts:31`、`:180`；`packages/brain/brain/src/contract.ts:137`。

目录级文件形状如下；path 在实际配置中填目标工作目录的规范化值，本文不记录本机路径。不能把 instructions 或新的 skills/MCP 定义加在这里；要用新内容先在全局集声明，再按名 use。〔一手〕`packages/brain/brain/src/agents-config/index.ts:57`；主人工作记录 19。

```yaml
version: 1
path: '<规范化的工作目录>'
instances:
  claude-main: { use: [review], disable: [release] }
  codex-main: { disable: [audit] }
```

提供方的 Cordis 行只放部署项和该实例自带材料；Key 示例使用占位值，实际可写明文 Key，不表示自动支持 `${VAR}` 在任意 Cordis 字符串中展开。两套 YAML 的插值规则不能混用。〔一手〕`packages/brain/brain-claude-code/src/config.ts:18`、`packages/bundle/brain-cli/cordis.patch.yml:36`；〔推理〕边界说明。

## 4 选择、合并与物化

解析顺序：loadAgentsConfig → loadDirectoryConfig → resolveAgentConfig(config,{impl,directory}) → materializeSkills → 合并会话输入 → 提供方 resolve。`agents.yml` 不存在是空集，目录文件不存在无该级选择；文件存在但不可读／格式坏／引用不明必须失败。A′ 的 minds.agent.opening 把这一解析安装为第一个瀑布监听器，实际执行点最后仍校验完整配置与提供方能力。〔一手〕`packages/brain/brain/src/agents-config/index.ts:88`、`:142`、`:163`；〔推理〕G′ 接线。

| 项 | 唯一规则 |
| --- | --- |
| 默认／use／disable | 先按 applyTo 选默认，再加实例与目录 use；任一级 disable 压过任何级 use；不存在的名字直接报错 |
| 本事 | 按选中的条目名复制到独立 skillsDir；与实例自带／会话同名本事冲突报错，不覆盖 |
| MCP | 按服务器名并集；实例与会话同名报错，不允许覆盖内核 liwa；alwaysLoad 按能力兑现 |
| 插件 | 全局选择结果与显式会话／实例本地目录组合，不自动加载 marketplace 或个人插件；当前提供方按目录列表交 CLI，尚不承诺路径别名去重 |
| 钩子 | 按事件追加；当前代码把 session（含全局、目录与对话）组排前、实例自带组排后，不声称已实现跨四级重新排序 |
| 指令 | 选中全局／实例／目录指令按声明顺序读取、空行拼接；对话指令随后；最终注入为人设 stable → 规矩 → instructions → 受控项目正文 → persona.notes，notes 在末尾；总 UTF-8 字节超上限拒绝，不截断 |
| 模型／档位／模式 | 对话选择经实例目录与能力校验；实例默认在 provider resolve 中落实；目录文件不接受这些字段，不开放绕过实例禁用工具／模式的路径 |
| 权限 | V1 不接 permissions.allow/deny/ask 文件规则；现 permission/mode 由会话契约与提供方处理，不能凭本 YAML 扩权 |

依据：〔一手〕`packages/brain/brain/src/agents-config/index.ts:145`、`:210`；`packages/brain/brain-claude-code/src/config.ts:284`、`:460`、`:490`、`:507`。这里说明实际代码，不把主人工作记录 15 草稿的未实现排序或目录新增能力写成现状。

## 5 各家映射与空壳

| 配置 | Claude Code（已实现） | deepseek／通用 ACP（按能力） | Codex（⑤计划） |
| --- | --- | --- | --- |
| 指令 | work 使用 claude_code preset + 一份 append，按 §4 顺序 | deepseek personaPrefix／规矩；ACP 指令文件／前缀并逐家验证 | developer_instructions，start/resume 都带新配置 |
| 本事 | 指定目录快照成本地插件，CLI 不读原生来源 | deepseek customSkillDirs；ACP 按真实能力翻译 | 隔离 CODEX_HOME 的受管 skills，须 A3 验 |
| MCP | 显式 mcpServers 与 strictMcpConfig；内核 liwa 带本代令牌 | ACP 标准 mcpServers，deepseek 支持；不能写“不适用” | mcp_servers／线程覆盖，按真实协议验证 |
| 本地插件 | --plugin-dir，对应 SDK plugins | Meta.agentConfig.plugins=false 时拒绝，不自动拆成可用子集 | 没有等价入口的内容拒绝，逐项设计后才翻译 |
| command 钩子 | settings.hooks + 灵鲸预算钩子，拒绝未知事件 | Meta.agentConfig.hooks=false 时拒绝 | 无等价物时拒绝 |
| 模式／档位 | default/plan/acceptEdits/auto；thinkingOptions；回合间切档 | 目录与模式来自提供方，未知项拒绝 | 模型 reasoning effort；不能把审批档位等同 Claude 模式 |
| Key／环境 | 实例 env，认证变量二选一；禁止覆盖隔离项 | 自己的配置规则，不从个人全局目录补秘密 | 首版实例 env/Key；不复用主人登录 |

依据：〔一手〕`packages/brain/brain-claude-code/src/config.ts:273`、`packages/brain/brain-deepseek/src/provider.ts:58`、`packages/brain/brain-acp/src/index.ts:1`；〔二手〕[Codex 评估](../../research/2026-11-05-codex-adaptation.md) §5。共同能力由 Meta.agentConfig 声明，做不到就拒绝，不静默丢配置；真正接入／隔离保证必须看 01 §4.6/§10 的真机矩阵。

## 6 归属与余下工作

文件解析与物化唯一属于 `@liwa/brain/src/agents-config`；提供方只负责翻译成 CLI 形状；宿主／minds 消费解析结果，不能自写第二份 loader。roster 以后拥有运行期配置实体／事件与主控台编辑入口，沿同一解析器接管。已有 brain run 通过 agentsRoot 使用它；G′ 接 opening，H′ 接宿主命令。〔一手〕`packages/bundle/brain-cli/cordis.patch.yml:83`；〔推理〕分期。

marketplace、个人全局指令自动导入、仓库内 .liwa/agents.yml、权限规则和配置主控台不在首版；Claude fast mode/feature 接线、SDK 自定义 agents 入口不做；Codex 真实映射、并发隔离与原生配置零读取仍需⑤验收。研究报告保持评估时内容，当前设计以本文、00 §5.1、01 §4.2/§4.6 为准。〔一手〕主人工作记录 18、19；〔推理〕范围与证据边界。
