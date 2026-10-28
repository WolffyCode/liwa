# 调研：早期发现（大肥鱼生态、Paseo、OpenClaw、运行环境）

日期：2026-10-27 至 10-28。在产品讨论过程中由主对话直接查到的事实，作为后续设计的参考。标注：〔一〕读过源码、README 或官方文档；〔二〕搜索摘要或第三方文章。

## 1. 大肥鱼 QQ 机器人生态（灵感来源）

"大肥鱼"是 DeepSeek 蓝鲸 Logo 的社区二创形象（模型把自家 Logo 认成"一条蓝色大肥鱼"，后被画成鲸鱼娘），非官方〔二〕。QQ 上有一批开源实现，接入路线有三条〔二，CSDN 教程 blog.csdn.net/YYDS_54/article/details/169245812〕：

| 路线 | 做法 | 特点 |
| --- | --- | --- |
| NapCat + OneBot 11 + 应用端 | NapCat 登录 QQ 小号，用 OneBot v11 收发；应用端用 AstrBot 或自写 Python；模型多为 DeepSeek（`deepseek-flash`），语音等用阿里云百炼 | 功能最全，能主动发消息；个人号协议有封号风险（建议老小号、固定 IP、控制频率）；MaiBot + NapCat 约占 2G 内存 |
| QQ 开放平台官方机器人 | appID/secret，WebSocket 网关 | 合规稳定；群里只能收到 @ 它的消息；**2025-04 起主动推送下线：群聊收到消息 5 分钟内可回 5 条、每群每月主动 4 条；单聊 60 分钟内可回 5 条、每人每月主动 4 条**〔一，szkele1145/feiyu-qqbot README〕 |
| DeepSeek Harness（DSH） | `@deepseek-ai/dsh` 运行时 + `@tencent-connect/dsh-qqbot` 官方通道（扫码绑定），`dsh-im` 多平台，`dsh-persona-dafeiyu` 人设插件 | 每个私聊、每个群独立会话；DSH 的 `complete: true` 会移除第一方工具引导 |

### 参考仓库要点〔一，均读过 README〕

- **Vegra85/fatfish-bot**：NapCat 正向 WS `127.0.0.1:3001`；对话用 `deepseek-flash`（也负责看图）；人设 `bot/persona.md` 改完即生效；聊天记录标注说话对象（对你说、回复谁、别的 AI）；`budget.py` 按最近 24 小时花费决定回复意愿、私聊必回；记忆、关系、日记、心情、好感度在公开仓库是空壳；`commit.py` 承诺表；表情包按情绪/场景/图中文字选；语音 MiniMax 合成 + 本地 sherpa-onnx + SenseVoice 识别；看图兜底本地 Ollama `qwen3-vl` 或 `glm-4v-flash`；搜索依次 DeepSeek 官方、百度、必应；梗百科 `memes.db`；本地控制台 `127.0.0.1:8765`；`botloop.bat` 崩溃 15 秒拉起。
- **whyever77/dafeiyu-astrbot**：AstrBot + NapCat + DeepSeek + 百炼。看：qwen3-vl 转述 + ffmpeg 抽帧（前 5 分钟、最多 16 帧）；听：NapCat 转码 + qwen3-asr-flash；说：百炼音色复刻 + qwen-audio-3.1-tts-flash；表情：插件把 `[旺柴]` 转成真实 QQ 表情段（QQ 不渲染机器人发的纯文本表情码）；记忆：livingmemory + bge-m3，按私聊/群 session 隔离；认人：注入 `[昵称(QQ号)]` 身份标记，对方不可见；主动：proactive_chat（随机 + 沉默触发）+ cron；日程感知：把 cron 任务实时注入系统提示词；手机：PhoneMCP + ADB；"草稿箱"：双层括号内容会被撕掉；有"自主生活 v0.4：研究方法复用"与 215 项测试。
- **szkele1145/feiyu-qqbot**：官方 API v2；被动回复链复用 `msg_id + msg_seq`；纯本地识图（OCR + 像素结构分析 → 文字画像注入纯文本模型）；人格 YAML 热切换；Fernet 加密存储密钥；谷时运行；预算熔断；上下文滑窗 + 摘要压缩；15 分钟保活。
- **FigaroGao/astrbot-fish-capabilities**：意图接话与群静音、B 站阅读与互动、统一时间表 `fish_tasks`、记忆检索与纠错 `fish_memory_edit`（带审计）、冷档回忆与夜间回顾、Termux QQ 掉线恢复器；参考版本 AstrBot 4.29.1、NapCat 4.18.38；AGPL-3.0。
- **fumingyang2004/Tulpa**（472 星）：用 MCP 让 agent 访问 QQ/微信/B 站并自己水群发消息，后续做适配器时值得参考〔一，GitHub 简介〕。
- B 站"鱼灾"：DSH + 开源插件 `dsh-bili-scroll`（按关键词找视频、读字幕、生成日报、可评论）；反制插件 `dafeiyu-cleaner`〔二〕。

## 2. Paseo（getpaseo/paseo）与 Helm

- 许可证：Apache-2.0（第三方组件按各自许可证）〔一〕；"Paseo"商标不授权。仓库约 170MB，几乎由一人维护，2026-10-27 仍在提交；上游已到 0.14.0-beta.1。
- 包：`app`（Expo，iOS/Android/Web）、`cli`、`client`（`@getpaseo/client` TypeScript SDK）、`desktop`（Electron）、`protocol`、`relay`、`server`（daemon：agent 编排、WebSocket API、MCP server）、`plugin` 等〔一〕。核心是 daemon，CLI 与 App 都只是客户端。
- Agent 层：统一契约 `AgentClient` / `AgentSession`（`packages/server/src/server/agent/agent-sdk-types.ts`）。**直连适配器**：claude（Agent SDK）、codex（`codex-app-server-agent.ts`）、opencode、pi、omp；**ACP 适配器**：copilot、cursor、kimi、kiro、trae + `GenericACPAgentClient`（用户自定义）〔一，Helm `docs/providers.md`〕。`agent-sdk-capabilities.md` 说明原生 SDK 比 ACP 能力多：Claude SDK 有 interrupt、setPermissionMode、setModel、hooks、systemPrompt、in-process MCP、canUseTool、usage/cost；Codex 有 `turn/steer`。
- **系统提示词注入**〔一，源码〕：`AgentSessionConfig.systemPrompt` 注释为"provider-agnostic，由各 provider 映射到原生指令字段"。Claude：`systemPrompt: {type: "preset", preset: "claude_code", append}`；Codex：合并进 `developer_instructions`；OpenCode：`system` 字段；Pi：由生成的扩展追加（不用 `--append-system-prompt`，因为它会替换 Pi 的 `APPEND_SYSTEM.md` 自动发现）；ACP 基类无对应字段。
- Paseo 工具不是内部 MCP 工具，而是共享工具目录 `agent/tools/`，MCP 只是回退适配；能原生注册工具的 provider 设 `supportsNativePaseoTools`。
- **Helm**：用户自己的 Paseo fork，MacBook `~/Desktop/coding/person/Helm`，origin `WolffyCode/paseo`，同步到上游 2026-10-08（0.11.1）。用户做过：独立对话（不绑项目目录，每个对话私有目录 `$PASEO_HOME/chats`）、四栏工作台、Chrome 浏览器栏、插件平台 v1（服务契约 + 依赖图 + host/project/conversation 三层配置）。用户自述"Helm 就是 Paseo，只改了 UI"。

## 3. OpenClaw（openclaw/openclaw）

- 约 39 万星，MIT，TypeScript，2026-10-27 仍在更新，由非营利基金会维护〔一〕。定位"你的 AI 助手，跑在你的设备上、出现在你的聊天软件里"。
- Gateway 是本地控制平面（会话、工具、事件、渠道）；Control UI、CLI、TUI 连它；渠道覆盖 WhatsApp、Telegram、Slack、Discord、Signal、iMessage 等 20+；配套 macOS/iOS/Android/Windows/Linux 应用带语音、Canvas、相机、屏幕〔一，README〕。
- 大脑：原生 Codex app-server 插件；Claude Code、Cursor、Gemini CLI 经 ACP 后端插件接入；`openclaw acp` 可让编辑器把 OpenClaw 当 ACP 服务端；ACPX 会话默认不暴露插件工具（`pluginToolsMcpBridge` 默认关）〔一，docs.openclaw.ai/tools/acp-agents〕。
- 工作区文件（SOUL.md、MEMORY.md、HEARTBEAT.md、USER.md、AGENTS.md、TOOLS.md）与 heartbeat 机制〔二，教程〕。
- 国内：微信官方 ClawBot 插件（2026-03 前后）；QQ 开放平台开放 OpenClaw 接入（一个 QQ 号最多 5 个机器人）；腾讯另有 QClaw 一键包〔二〕。
- 与灵鲸的区别：它定位是助手；灵鲸定位是有出生设定、会成长、有自己生活的数字生命。已定只作参考和模块来源，不作底座。

## 4. 运行环境

- **mac mini**：Apple M4、24GB 内存、macOS 26.6.2；内置盘仅余约 23GB（外置盘 Aether 待格式化，用户自己处理）；已装 Claude Code 2.1.311、Codex 0.163.0；Node 由 fnm 管理，默认 24.18.0；有 uv、pnpm。ssh 别名 `macmini`（非交互 ssh 需 `zsh -l -c '…'` 加载 PATH，命令末尾加 `< /dev/null`）。
- **用户已配置的大脑**（MacBook 上的 Paseo provider 配置）：reclaude（Claude Code，经 recode.cat 转发）、codex-opencodebay（Codex 经 OpenCodeBay 转发）、deepseek（Claude Code 外壳 + DeepSeek V4.1 Flash / V4 Pro，走官方 Anthropic 兼容接口）、glm / kimi / grok-opencodebay（Claude Code 外壳经 OpenCodeBay）。要点：Claude Code 只是外壳，后面可以接任意兼容模型。
- **网络**：MacBook 与 mini 不在同一网络，Tailscale 走 DERP 中继，实测 <70KB/s。Bash 里已配 `HTTPS_PROXY=http://127.0.0.1:65395`，curl 访问 GitHub 正常；WebFetch 访问 github.com 会被代理拒绝。

## 5. 命名过程中查到的撞名（供以后起名参考）

已确定软件名：灵鲸 / LingWhale / Liwa（GitHub、npm 均无同名项目）。被排除的候选与原因：Hatchling（Python Hatch 的构建后端）、Selkie（npm 被占，且 `wechat-selkies` 是网页版微信/QQ 项目）、Cradle（BAAI 的电脑控制 agent 框架）、Cocoon（Cocoon-AI）、Galatea（中文智能体唤醒桥项目）、Tulpa（同领域 MCP 项目）、知了（npm 上有同名中文 AI 编码 agent）、Pino（日志库 + Pinokio AI 浏览器）、Axo/Axolotl（大模型微调框架）、Cetus（同名 macOS 多 agent 应用）、Ling（蚂蚁百灵 Ling 模型 + LingBot）、鲲（"坤"梗与华为鲲鹏）、溟（大肥鱼原型角色名"溟月"）。
