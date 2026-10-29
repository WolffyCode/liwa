# 交接文档

更新：2026-10-29。给接手的主对话（新会话）用：读完这份就能接着安排活，不必翻原对话。接手顺序：先读"怎么协作"与"现状"，再读"下一步的活"，其余按需。

## 整体结论速览

- **产品**：灵鲸（LingWhale / Liwa）是一个"家"，住着主人创造的数字生命。主角是主人的闺女：有性格、有身体状态、有记忆、有自己想做的事，会陪主人聊天、替主人干活，没人找她时也在过自己的日子；会学新本事，会慢慢变，主人看得见她为什么变。完整定义见 `docs/product.md`（已确认），人物画像见 `docs/portrait.md`（已确认）。
- **她的抽象**：一个生命的九个部分：身、感、念、思、意、忆、行、长、能；两个运行时概念：在场（她在某个地方的出现）、手上的事。原则：判断归她，边界归你，身体归代码；规则打底，模型定调；行为来自意愿，每件事带理由。
- **方案**：新仓库自研；TypeScript + Node 24 本体，React 前端，Electron 薄壳，SQLite；所有用脑都走各家 CLI（Claude Code、Codex、ACP），统一用灵鲸自己的 agent 契约；Paseo 和 OpenClaw 只作参考和模块来源。
- **整体架构**：`docs/architecture/overall.md`（18 节）加图页 `docs/architecture/overall.html`。本体是她的身体和神经系统，不是脑子：账本（self、body、memory、people、skills、roster）+ 感 senses、念 attention、意 will、时钟 scheduler、手上的事 tasks、嘴 outbox + 四种用脑 minds（在场、慢想、手、睡眠）+ 行动管线 actions + 守护 guard + 经历流 journal。慢想按需醒、每次新开、靠心事交接；身每分钟一跳、不调模型、确定性可回放。
- **进度**：产品定义、人物画像、整体架构、05 记忆系统、00 插件机制底座、00 协议规范、工程约定、路线图都已确认；06 成长系统草稿已写、待主人确认；代码上 `contracts` 与 `kernel`（插件机制底座）已写完并通过测试，内核服务与插件还都是空壳。
- **接着做什么**：路线图 1.7 的 m0 终端能跑（见"下一步的活"），按"设计 agent 出方案 → 主人确认 → 实现 agent 写代码"推进；其余模块文档按 `docs/architecture/README.md` 的顺序出轻量版（01 → 02 → 03 → 04 → 07 → 08 → 10 → 09）。
- **对话记录**：`docs/conversations/` 是文字版；原始 jsonl（含子任务日志）在 mac mini 的 `/Volumes/Aether/Users/wolffycode/Desktop/liwa-conversation-logs/`，不进仓库（仓库公开）。
- **开发工作区**：mac mini 的 `/Volumes/Aether/Users/wolffycode/Developer/person/liwa`。所有确定的需求、架构都必须写进仓库文档。

## 阅读顺序

1. `docs/product.md`：产品定义（已确认），产品层面以它为准。§12 是默认值与待定项。
2. `docs/portrait.md`：她的人物画像（已确认，示例性格），是产品定义合成一个人的读法。
3. `docs/architecture/overall.md`：整体架构（已确认）；`overall.html` 是配套的 10 张图（源文件 `overall.src.html`，用 `python3 -I docs/scenarios/build.py docs/architecture/overall.src.html` 重新生成）；`docs/architecture/README.md`：架构文档索引与十份模块设计的计划（范围、要定的东西、关键问题、依据、顺序、写法）；模块文档写在 `docs/architecture/modules/`。
4. 本文：决策、待定、调研清单、环境、协作约定。
5. `docs/scenarios/index.html`：27 个真实场景的时序图和 6 张调度规则图（源文件 `index.src.html`，`build.py` 生成；名词与 overall.md 一致）。
6. `docs/research/`：调研与评审报告，是依据不是方案。
   - 整体架构四步调研：`2026-10-28-openclaw-architecture.md`、`-paseo-architecture.md`、`-companion-architectures.md`（麦麦、AIRI、Letta、elizaOS）、`-papers-architecture.md`（CoALA、Generative Agents、全局工作空间、AIOS、sleep-time compute、Anthropic 多 agent 实践、主动性研究、人设漂移）。
   - `2026-10-28-structure-validation.md`：在场 + 中枢慢想结构的验证（Talker-Reasoner、SOFAI、SwiftSage、Chat-Supervisor、黑板、Erlang/Orleans、Anthropic 长任务、ConfAIde/MuPPET/Audience-Bound、CaMeL、来源监控、会话保证）；修正建议 M1–M16。
   - `2026-10-28-plugin-architecture.md`：万物插件化（DSH、Koishi/Cordis、NoneBot2、AstrBot、VS Code、OpenClaw、Backstage、Grafana）；内核清单与槽位 D1–D7。
   - 三份"像生命"调研：`2026-10-28-life-games.md`（模拟人生、Creatures、矮人要塞、环世界、Oz Project、Petz 等；规则打底模型定调、分层 + 温度抽签、腻、近况层、主导情绪、验收标准、坑）；`2026-10-28-life-psychology.md`（PSI/MicroPsi、OCC/EMA/FAtiMA/ALMA/WASABI、DynAffect、情绪时长、SDT、学习进展式好奇、想要/喜欢、MAC 无聊、走神与自发回忆、ACT-R、McAdams 自我、习惯、人格变化、依恋、节律；五个时间尺度 + 调节器的内在状态模型，含伪代码）；`2026-10-28-life-agents-products.md`（Humanoid Agents、D2A、Project Sid/PIANO、Lyfe、Voyager、GA 评测、AI Town/AGA、小冰、Replika、Nomi、Tolan、Pulse、大肥鱼、依恋与操纵研究；主动联系参考值、验收标准、坑）。
   - `2026-10-28-review-overall-fable.md`、`-opus.md`：两位独立评审对整体架构的意见；采纳情况见本文"评审意见的处理"。
   - `2026-10-28-client-backend.md`：客户端界面与前后端；`2026-10-28-ability-plugins.md`：听、说、看、画与实时语音；`2026-10-28-event-log-supplement.md`：可删除载荷、投影、幂等、至少一次；`2026-10-28-early-findings.md`：大肥鱼生态、Paseo、OpenClaw、运行环境、命名撞名；`2026-10-28-xiaoling.md`：抖音"小凌"的做法，只作参照。
   - `2026-10-28-subagent-notes/`：8 个子调研的原文存档（记忆论文、记忆开源项目源码、记忆评测与投毒、Claude SDK 与 Codex app-server、ACP/A2A/MCP、多 agent 实践、Paseo 上游与 OpenClaw 编排、OpenClaw 早期版）。模块阶段当起点用。
7. 对话记录只在需要核对原话时翻。

## 怎么协作（2026-10-29 起，决策 34）

主人定的分工：**主对话只跟主人对话、安排活、汇报**，不自己写方案和代码；**设计 agent** 出方案（Fable 5.1 或 Opus 5.5）；**实现 agent** 写代码（Opus 5.5）；重要稿子另请独立评审。

| 角色 | 谁 | 做什么 | 不做什么 |
| --- | --- | --- | --- |
| 主对话 | 新会话（Opus 5.5） | 读本文接手；把活拆成任务书派给 agent；收活后自己复核一遍，再用通俗的话（配例子）给主人讲；把主人定下的事写进本文与对应文档；征得同意后提交推送 | 不自己长篇写方案或代码（状态行、错字这类小改除外）；不替主人做决定；主人没同意不提交 |
| 设计 agent | Agent 工具，`model: "fable"` 或 `"opus"` | 读指定文档与调研，写模块文档（轻量版 150–300 行，写法按 `architecture/README.md`）或改设计；末尾给"一页结论 + 关键取舍 + 要主人定的点" | 不写代码；不改已确认文档的结论（只能写"建议改哪、为什么"）；不开子 agent |
| 实现 agent | Agent 工具，`model: "opus"` | 按已确认的文档写代码与测试，跑 `pnpm run ci`，交回"改了哪些文件、测试原文、没做的事、风险" | 不改设计（发现设计有问题就停下写明，让主对话去问）；不提交 git；不开子 agent；不装 catalog 之外的依赖 |
| 评审 | Codex CLI、Fable、Opus 各一 | 对重要稿子独立评审，报告进 `docs/research/`，处理结果记在本文"评审意见的处理" | — |

**派活的规矩**

- 用 Agent 工具，`subagent_type: general-purpose`，按上表给 `model`；互不依赖的任务并行派（主人 2026-10-29 同意并行），有依赖的串行；`run_in_background` 之后等通知，不要轮询。
- 任务书是 agent 唯一的上下文，必须写全：目标与验收；要读的文件（路径 + 节号）；硬规则；产出格式；改动范围（只许动哪些目录）。
- 每个 agent 的硬规则：全程中文；文档只存最新方案、不留历史措辞；每个设计点带依据并标〔一手〕〔二手〕〔推理〕；遵守 `docs/engineering.md` §9 与 `~/.claude/CLAUDE.md`（改在根上、不叠兼容层、每样东西唯一归属、模块间只走 API）；代码要过 `pnpm run ci`（命令见"环境与工具注意事项"）；不碰 `node_modules`、不提交 git、不开子 agent；原始对话日志与凭据不进仓库（公开仓库）。
- 收活时主对话要做的：核对产出是否在范围内、测试原文是否真的跑了、设计点有没有裸奔的〔推理〕；把"要主人定的点"整理成一页给主人；主人定了的写进"已定的决策"。
- 顺序：设计 agent 出文档 → 主对话给主人一页结论 → 主人确认、文档标"已确认" → 实现 agent 写代码 → 主对话复核 CI 与范围 → 征得同意后提交。

**任务书模板**（复制后填空）

```
你是灵鲸（Liwa）项目的 <设计|实现> agent。仓库 /Volumes/Aether/Users/wolffycode/Developer/person/liwa，公开仓库，分支 main。
目标：<一句话>。验收：<可检查的条件>。
先读：docs/handoff.md 的"怎么协作""现状""环境与工具注意事项"；<具体文件与节号>。
只许改：<目录或文件清单>。不许：改已确认文档的结论、提交 git、开子 agent、装 catalog 之外的依赖、碰 node_modules。
硬规则：全程中文；只存最新方案；每个设计点标〔一手〕〔二手〕〔推理〕；遵守 docs/engineering.md §9 与 ~/.claude/CLAUDE.md；代码跑 pnpm run ci（先 export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"）。
交回：<设计：文档路径 + 一页结论 + 关键取舍表 + 要主人定的点 ｜ 实现：改动文件清单 + 测试与 CI 原文 + 没做的事 + 风险>。
```

## 现状（2026-10-29）

- **已确认的文档**：`product.md`、`portrait.md`、`architecture/overall.md`、`architecture/modules/05-memory.md`、`00-plugin-kernel.md`、`00-contracts.md`、`engineering.md`、`roadmap.md`；状态表在 `architecture/README.md`。怎么走到这里的（调研、评审、决策）都在"已定的决策"与"评审意见的处理"，不必翻对话。
- **待主人确认**：`architecture/modules/06-growth.md` 草稿（787 行，依据齐全，与 05 的接口名全部对得上）。要点头的四点：① `growth.engine` 在 `00-contracts.md` §5.3 之外多三对方法（日记、做法提取、"今天注意"）；② `renderPersona` 标 `pure`；③ self 账本把自我第一层条目以结构化形式交给引擎；④ `persona.rendered.v1` 草稿写进 `mind:<id>` 流，按单写者原则建议改写进 `member:<id>` 流并带会话号。确认后要同步 `00-contracts.md` §5.3、`overall.md` §4.9 与 §13（§9.2、§18.2 U5 已按决策 33 改）。
- **代码（全部未提交）**：脚手架（pnpm workspace 与 catalog 钉版、tsconfig、eslint 与 dependency-cruiser 规则、vitest projects、`tools/ci.sh`）；`packages/contracts` 机制层 887 行、17 项测试；`packages/kernel` 五阶段 loader 1876 行、29 项测试（覆盖 `00-plugin-kernel.md` §12 的反例）；`apps/liwa` 只有装配入口（required 清单、启动参数、`dumpAssembly`），`pnpm dump-config --profile m0-terminal` 走真实 loader，目前准确报出 m0 阶段集合缺的 12 个服务；`packages/core`、8 个插件包、`cli`、`console`、`replay`、`testkit`、`lib/brain-shared` 都是 2 行空壳。本机 CI 全绿：lint、依赖规则、逐包类型检查、22 个测试文件 61 项。
- **kernel-0 里留到 1.7 一起做的**：回环编解码测试（等第一个真槽位实现）、安全模式页与启动失败计数 `boot.json`（组合根进程入口）、连续崩溃自动禁用与 `AsyncLocalStorage` 标插件 id、`@liwa/testkit` 独立包（测试内核现在在 kernel 的 `testing.ts`）。
- **实现中在已确认设计之内定下的细节**（已写进 `00-plugin-kernel.md` §3.2、§5、§11、§14，主人过目即可）：组合根只做 Node 的包解析根、仓库根另算；插件 Config 由 kernel 用 zod `safeParse` 同步校验、错误成为禁用原因；注册阶段先挂 required 等全部就绪，再逐个挂 builtin 并等落定，失败只禁用自己并写明原因；关闭每一步受全局截止约束，因为 cordis 不能打断在途的 `apply`；同一层 patch 对同一插件只能有一条；`data` 插件可放 builtin 或 external 的位置。
- 用户要求的架构文档结构：一、整体架构（整体逻辑怎么设计）；二、模块架构（按 overall.md §0.4 的七份：生命内核；记忆系统；成长系统；用脑与大脑，即她怎么调用 agent CLI；能力插件；客户端界面，以及第一版要不要客户端；前后端）。之后再讲兜底与出错、测试、第一版里程碑。
- 推进方式：先把整体架构定明白，再挨个模块做细节架构。设计必须有调研依据，每个设计点带依据。经用户逐段确认后，`docs/architecture/` 里的文件就是设计 spec；实现按"怎么协作"派给实现 agent。

## 下一步的活（路线图 1.7：m0 终端能跑）

目标：`liwa start` 起本体，`liwa chat` 在终端里和她说上话（Claude Code 外壳 + DeepSeek V4.1 Flash），`liwa status / doctor / dump-config / tail` 可用；探针（路线图 1.3）跑在它上面。m0 阶段集合要在装的 12 个服务：journal、guard、procs、brains、minds、context、actions、senses、attention、outbox、toolport、gateway（`contracts` 的 `STAGE_SETS.m0`）。模块落在哪个包见 `engineering.md` §4.7。

**第一波：设计**（四个设计 agent 可并行；每份轻量版 150–300 行，写法按 `architecture/README.md`；只写 m0 需要的最小版，V1 其余放"以后"一节）

| # | 文档 | 要定的 | 先读 |
| --- | --- | --- | --- |
| D1 | `modules/01-agent-cli.md` agent CLI 接入 | brains 服务（提供方登记、开会话、用量上报）；`brain.provider` 的 Claude 实现从 Paseo 最新上游剥离（固定提交号、`src/paseo/` 原样 + NOTICE、`adapter.ts` 映射层、进程经 `procs.spawn`、`settingSources` 为空、每成员独立数据目录）；人设注入两种方式（自定义 systemPrompt 与预设 + append）；Codex、ACP 的落位只列不做 | `overall.md` §3.4、§9.2、§12.3、§16.1、§17；`00-contracts.md` §5.1；`engineering.md` §4.8；`research/2026-10-28-paseo-architecture.md`、`research/2026-10-28-subagent-notes/cli-claude-sdk-codex-app-server.md`；决策 1、2、4、6、28、33 |
| D2 | `modules/02-minds.md` 用脑调度 | minds（在场会话登记、回合生命周期、steer、换新与闲置回收的最小版）；context（稳定前缀 = 静态人设文件 + 在场说明，每轮前缀 = 状态行最小版）；toolport（会话令牌、m0 只开 `reply` 与 `inner`、批结束钩子）；主人消息抢占 | `overall.md` §2.4、§3.3、§5.1–§5.4、§8、§11.6；`00-contracts.md` §2、§4、§6；`06-growth.md` §4.3（草稿，人设块十段）；决策 5、12、13 |
| D3 | `modules/03-foundation.md` 基础与守护 | journal（`node:sqlite`、追加协议 `AppendRequest` / `CommittedEvent`、投影注册、载荷与删除、WAL 检查点）与 `core/db`；procs（进程组、看门狗、清孤儿、`spawn` / `kill`）；actions（先记后做、副作用协议、幂等键）；guard 最小版（`admit` 放行 / 拒绝、`pause`、日预算骨架） | `overall.md` §6、§11.7–§11.9、§12.1、§13；`00-contracts.md` §6、§7；`engineering.md` §6、§7；`research/2026-10-28-event-log-supplement.md` |
| D4 | `modules/07-protocol-gateway.md` 前后端协议与网关 | gateway（HTTP + WebSocket、`hello`、主人令牌 `OwnerToken` 签发、`liwa` 六个命令的端点）；senses / attention / outbox 的 m0 最小路由（终端是一个"地方"：消息进 → 主人的在场 → 回复投递回终端）；`packages/cli` 的 `liwa` 命令（`--json`、退出码 0 / 1 / 2 / 3） | `overall.md` §3.1、§7、§10、§11.6；`00-contracts.md` §8（客户端协议）；`engineering.md` §12；决策 19、33；`research/2026-10-28-client-backend.md` |

每份交回后：主对话复核依据与范围，给主人一页结论和要定的点；主人确认后在 `architecture/README.md` 标"已确认"，再进第二波。

**第二波：实现**（Opus 5.5；"依赖"列是前置条件，同一组可并行）

| # | 包 | 内容 | 验收 | 依赖 |
| --- | --- | --- | --- | --- |
| I1 | `packages/core/src/db`、`journal`、`ledgers` 骨架 | `defineService('journal')`；`append` / `read` / `subscribe` / `putPayload`；投影注册；`kernel.started.v1` 落库 | 单元测试 + 经真实 loader 的装配测试；重启后读得回 | D3 |
| I2 | `packages/core/src/procs` | 进程组 spawn / kill、看门狗、启动时清孤儿（允许真定时器的两处之一） | 杀进程树与孤儿清理的测试 | D3 |
| I3 | `packages/lib/brain-shared`、`packages/plugins/brain-claude` | 从 Paseo 剥 Claude 适配器 + 映射层；`provide('brain.provider', 'claude')`；经 `procs.spawn` | 契约测试 + 回环编解码；用假 procs 可测 | D1 |
| I4 | `core/src/brains`、`minds`、`context`、`toolport` | 大脑登记与开会话；在场会话与回合；静态人设 + 稳定前缀；`reply` / `inner` 与令牌 | 用假大脑跑完一回合，事件齐全 | D1、D2、I1 |
| I5 | `core/src/guard`、`actions`、`senses`、`attention`、`outbox` | 最小版：放行 / 暂停；先记后做；终端消息进出 | 一条消息从进到出的集成测试 | D3、D4、I1 |
| I6 | `core/src/gateway`、`packages/cli` | HTTP + WS、`hello`、OwnerToken；`liwa start / status / doctor / dump-config / chat / tail` | `liwa status --json` 与退出码正确；`chat` 收到回复 | D4、I4、I5 |
| I7 | `apps/liwa`、`profiles/m0-terminal.yml` | 进程入口（自检、`startKernel`、信号、`boot.json`、安全模式页）；profile 填入 `brain-claude`；端到端 | `liwa start` 后 `liwa chat` 与真 Claude Code 外壳说上话；CI 全绿 | I1–I6 |
| I8 | 探针（路线图 1.3） | 20 个场景、指标、对比臂，跑在 m0 上 | 报告进 `docs/research/` | I7 |

I1、I2、I3 可同时派；I4 与 I5 可同时派；之后 I6、I7 串行。每个实现 agent 的交回必须附 `pnpm run ci` 原文；主对话抽查范围与测试是否真跑。

**同时要主人定的**：提交 2026-10-29 这批代码与文档（见"仓库状态"）；06 草稿的四点（见"现状"）；备份密钥位置；账号共用与额度（见"待定事项"）。

## 文档约定

- **只存最新方案**：仓库里不保留历史稿、归档稿和"第 N 版""旧名词""某日纠正"这类历史措辞；被取代的文档直接删除（git 历史里有），引用改到最新文档。调研报告和评审报告放 `docs/research/`，算依据不算方案。
- 产品层面以 `product.md` 为准；架构层面以 `architecture/overall.md` 为准；场景页和图页从它们派生。
- 每个设计点注明依据（来源项目、论文或 issue，一手还是二手），推理出来的单独标〔推理〕。

## 已定的决策

| # | 决策 | 要点 |
| --- | --- | --- |
| 1 | 方案 | 新仓库自研。Paseo（Apache-2.0）和 OpenClaw（MIT）只当参考和模块来源。从 Paseo **最新上游**（不是 Helm 的 0.11.1）摘 Claude、Codex、通用 ACP 适配器和语音模块，保留许可证与版权声明、标注改动、记录来源提交号 |
| 2 | 统一 agent 协议 | 灵鲸自己的 agent 契约，以 Paseo 的 `AgentClient`/`AgentSession` 为起点按需裁剪。下挂三类大脑适配器：Claude 直连、Codex 直连、通用 ACP。以后的自研 agent 也实现同一契约。上层不用 ACP：它没有人设注入、steer、用量、回滚的标准字段。可选：对外再开 ACP 服务端口 |
| 3 | 技术栈 | 本体 TypeScript + Node.js 24；前端 React（主控台与网页端共用）；桌面壳 Electron；数据 SQLite（向量扩展待核实）；本地模型如需，用 Python 独立服务；单仓库多包。用户对后端不熟，后端选型由 agent 给建议 |
| 4 | 大脑全部走 CLI | 所有用脑（在场、慢想、手、睡眠）都调用各家 CLI，不直接调模型 API。理由：模型差异太大，长期适配成本高。人设经各 CLI 原生指令字段**追加**注入（Claude preset + append、Codex `developer_instructions`）；走 ACP 的 CLI 退到工作目录里的指令文件或提示词前缀 |
| 5 | 执行者模型 | 每次用脑的执行者只能是**她**（带她的人设）或**和她有关系的朋友**。**不存在无人设的普通专业 agent**（用户明确纠正过，不要再提）。派活传原话不传转述；需求理解和方案设计由手完成；主人可直接打开任何一次用脑；可再开子会话 |
| 6 | 默认大脑 | 在场：Claude Code 外壳 + DeepSeek V4.1 Flash，配备用大脑；上线前用约 20 个真实场景验证（含静默空回复和工具调用循环），不行就换 GLM 或其他。慢想：强模型。手：Claude 或 Codex。睡眠：DeepSeek Flash，夜里是否换强由实测定。所有大脑可配 |
| 7 | 插件三类起步 | 大脑插件（CLI 适配器）、形态插件（渠道适配器）、能力插件（看、听、说、画……）。每个能力插件可挂本地或线上实现；大脑只认文字时，看图插件先把图转成文字 |
| 8 | 第一版能力插件 | 全部用线上服务；先把整个流程搭起来，语音、图片排在第一版后期里程碑 |
| 9 | 预算 | 预算不是叫醒伙伴的条件；只有一个系统级花钱总闸，由本体执行，数字生命不需要知道 |
| 10 | 作息 | "睡觉"只是不主动做事，不掉线；主人找她一定回 |
| 11 | 她是本体里的状态 | 出生设定、成长、身、念、意、忆、能、人物档案都在本体，不住在任何会话里；每个对话一个在场；慢想只当中枢，不直接跟任何人聊天，要做决定时醒、每次新开、处理完保留几分钟 |
| 12 | 四种用脑与三条规则 | 在场（每个对话一个，主人的和别人的是同一种）、慢想、手（每件事一个，可开子会话）、睡眠（后台整理）。三条互不干扰的规则：**隐私跟着受众走**（代码保证；"主人可见"指主控台里主人能看到全部，"主人在场的受众"指她和主人说话时只能用受众含主人的条目，别人私下告诉她的事她不主动转述）；**权限跟着说话的人走**（主人设的关系与角色）；**怎么说话跟着人设走**。共享状态单点写，由本体查冲突，有冲突交慢想。会话之间的差别只通过能力配置体现。主人在主控台、QQ、微信的日常聊天合成一个在场 |
| 13 | 上下文控制 | 稳定前缀（人设、角色说明）吃缓存；每轮前缀小而有上限（状态行、心事、承诺、按受众召回的记忆、别处简讯、新决定）；慢想读小表和摘要，不读日志，细节由本体按编号注入；在场接近上限先写回再换新；闲置回收；群聊唤醒走两道门（代码看 @ 和点名，再向量比对兴趣）；主人的消息抢占非主人发起的回合；整理按空闲，白天增量、夜里跨会话巩固和成长提案 |
| 14 | 派活交接包 | 原话按编号取原文，附相关聊天、到目前为止的决定和理由、"手不知道什么"、汇报格式、边界、审核点、回问通道。只补流程，不改写需求（依据：MAST 多 agent 失败研究） |
| 15 | 已确认的工程提议 | 睡眠用脑作为独立的一种用脑；自主开关关闭的成员被主人直接找时按需开会话；外部平台适配器、本地模型放进程外；内核工具在调用当中同步执行；主人的消息抢占非主人发起的回合；会话之间默认全部并行，一个可配置的并发上限，达到就排队，主人的在场有预留名额 |
| 16 | 小凌只作参照；成长速率进出生设定 | 小凌（`xiaoling.md`）只作参照，模块阶段多参考开源代码和论文。"先天气质"就是出生设定里的性格底色，不单列；"成长速率"是出生设定的一项 |
| 17 | 万物插件化 | 只留一个标准的调度内核；形态适配器、各家 CLI 提供方、能力、记忆系统、成长系统、关系与角色定义、所有界面都是插件，可扩展、可替换（用户原话："我们要做到 dsh 那样万物插件化的感觉"）。**具体怎么划分内核和插件属于代码实现方案，等到具体实现时再详细讨论**；调研见 `plugin-architecture.md`，整体架构只定边界（overall.md §9）。注：DSH 现在的许可证是 MIT |
| 18 | 心跳必须存在，形态是身的脉搏 | 用户："心跳必须存在呀……如果没有心跳，或者主意识那就不完整了。"落实为：身每分钟一跳（不调模型），需求过线按概率冒出冲动，冲动到决策点才叫醒用脑；没有独立的心跳调度器；承诺到期、作息边界、整理由作业管 |
| 19 | 本体不认平台 | 每种形态一个适配层（主控台、网页也是），负责收发、私聊还是群、有没有 @ 或点名她、成员是谁、平台格式和限制；交给本体的是标准消息（哪个地方、谁发的账号、在场有谁、是不是说给她的、内容）。适配层只报事实，不判断回不回、不调模型、不存记忆、不管权限。"你的日常聊天"跨端合并是本体里的配置 |
| 20 | 人物档案与她对人的记忆分开 | 人物档案（像通讯录：人、关系、角色、账号）在本体，只有主人能写，每条消息都确定地查；她对一个人的了解、印象、相处经过在记忆系统，挂在档案编号下。一个人在多个平台的账号归到一个人名下只有主人确认才算，她可以提建议，确认前按陌生人，合并可撤销。依据：elizaOS 身份声明分级、麦麦不做跨平台自动合并、记忆投毒研究"只有结构性手段有效" |
| 21 | 判断归她、边界归你、身体归代码；游戏只借身体层 | 用户原话："你把他要干的事情固定了，比如什么时候找我，每天分享自己的事，这些都应该是随他心情呀，现在的游戏养成都是算法，我们现在使用的 ai，这两个是有区别的呀，游戏的能借鉴，但是不能当标准呀。"落实为：想不想找人、现在合不合适、说什么、分享什么，由她看着事实（多久没回、回得热不热情、几点、你忙不忙、手里有没有值得说的）自己判断；代码只让身体涨落、把事实摆到她面前、执行家规，不替她发任何消息；主人可设的家规（勿扰时段、别烦我、每天最多几条）是可选边界，默认不设（用户确认"家规没问题"）；教养底线（不施压、不指责、不积怨、不挽留）不随心情，写进规矩（用户确认"教养类这个也行"）；分寸从相处里学；别家产品的数字只作参考与验收观察；自主生活只设钱和算力的上限；闲暇里选做什么，代码只摆桌子和替她掷不值得动脑的小硬币，要紧的选择她自己做并写理由；游戏机制只借"身体"层（需求涨落、腻、情绪消退、惯性），验收指标是观察窗口不是考核 |
| 22 | 产品定义与人物画像确认 | 用户看完人物画像说"我认为这个没问题"并直接要求讨论总体架构；产品定义 §12 里没单独表态的条目按默认值执行，架构阶段碰到时再复核 |
| 23 | 文档只存最新方案 | 用户原话："我们的文档不存历史文档，只存最新方案文档，所以存在历史措辞的都删除。"见"文档约定" |
| 24 | 整体架构要经两位独立评审 | 用户要求请一个 Fable 5.1 和一个 Opus 5.5 评审整体架构，找出不合理需要改进的地方。报告在 `docs/research/2026-10-28-review-overall-fable.md`、`-opus.md`；处理见下节 |
| 25 | 整体架构确认（2026-10-28） | 用户看完评审处理后说"我认为现在这个没问题"。`overall.md` §18 的全部选择按建议定下（含：第一版主动开口交慢想三选一、在场措辞，接受"等回音"不应期；第一版拆 V1.0 / V1.1，先做第 0 步大脑探针；慢想按触发类别配大脑；早安是作息线索上的决策点；不可逆动作默认关闭加单次限额；主人知情范围拆成"主人可见"与"主人在场的受众"；日历第四版；备份加密）。仍需用户提供：备份密钥位置；她用的账号是否与主人共用、预留多少额度。后续版本前再定：第二版前是否告诉家人主人能看私聊；第四版前公开发言规则 |
| 26 | 记忆系统方案确认（2026-10-28） | 用户："那确定方案然后写入文档吧"。`architecture/modules/05-memory.md` 全部按推荐值定下：不做神经元图谱，做激活数值 + 线索一跳联想；记忆是带来源、受众、证据事件号的条目，是经历流的投影；五路混合召回（线索、trigram 全文、向量、关切、新近）加原文补位，RRF 融合；向量在 V1.0，嵌入默认本地 Qwen3-Embedding-0.6B（决策 8 的例外）；遗忘读时算，情景 3 / 14 / 60 / 365 天四档，"好像"与墓碑在 V1.0；"被用到"才加强（说出口、被提起且接话、自发后说出、工具采用）；钉住永不淡忘；不加重排与图检索，V1.1 做 A/B；记忆图可视化留给界面。背景：用户先质疑"算法查库难保证准确、神经元图谱更靠谱"，经记忆调研与 GitHub 全景调研（`research/2026-10-28-memory-landscape.md`）后接受 |
| 27 | 最终目标四条（2026-10-28） | 用户原话："最终我们要接入微信，同时要有 mac 客户端，mac 客户端要能像 codex 等让我对话编程，最后要支持手机远程。"落实：第二版的外部平台定为微信（QQ 等以后按需加，接入方式与合规风险由用户拍板）；Mac 客户端 = Electron 薄壳承载主控台与工作区，V1.1 交付"像 Codex 一样对话编程"（打开项目、派手、看过程、审设计、看 diff、验收、直连那只手、选 Claude 或 Codex）；手机远程从第五版提前到第二版（响应式主控台经 Tailscale，通知经微信），第五版只剩原生手机端与实时通话。`product.md` §11、`overall.md` §3.1、§10、§16.1、§18.2 P3、`docs/roadmap.md` 已同步 |
| 28 | 大脑适配器一次从 Paseo 摘三个（2026-10-28） | 用户："我理解可以直接用 paseo 的核心原理。"评审结论：对，决策 1、2 已定从 Paseo 最新上游摘 Claude、Codex、ACP 适配器并套灵鲸契约；能照搬的是适配器层和会话 / 回合 / steer / 中断 / 权限 / 用量的契约，不能照搬的是 Paseo 的服务端与界面、以 CLI 转录为真相的持久化、不登记 CLI 会话进程、子 agent 不继承人设、Claude 的 preset + append 注入。调整：三个适配器在 M1 一次摘下；Claude V1.0 全验证，Codex V1.0 冒烟后给手用、V1.1 补差，ACP 不验收。`overall.md` §16.1、§18 C3、N21，`architecture/README.md` 01，`roadmap.md` 2.4、3.1 已同步 |
| 29 | 插件机制底座与代码分层（2026-10-28） | 用户："我想把 deepseek 的源码的插件化的机制带过来，当做我们的插件化的底座……一个核心插件机制模块，然后剩下的插件开始单独开发，组装上一个就好一个……应该有一套标准的协议规范，跟插件机制绑定……最后是走 paseo 的 agent cli 能力，也就是 acp 规范。"评审结论：形状照 DSH 来，信任模型不照。落实：插件运行时用上游 `cordis`（MIT，DSH 的底），loader 照 DSH 的形状（`package.json` 的 `liwa` 字段当 manifest、导入前查契约版本、profile 与 patch 叠层、`dump-config`），不引入 `@deepseek-ai/dsh` 本身（86 个依赖、产品层不是我们的、10 个预发布 81 条破坏性变更）；所有模块都按插件形状写、经同一套装配，但九样内核 required 且不可替换；协议规范 = `packages/contracts`（manifest、每槽位契约 + 整数版本、事件、账本 API、工具 schema、前后端与 IPC 信封），插件只能 import contracts 与 kernel；里程碑 = profile；大脑槽位契约从 Paseo 的 `AgentClient` / `AgentSession` 裁剪，ACP 只是其中一种适配器（可选对外再开 ACP 服务端口），不把 ACP 当内部契约（决策 2 的理由不变）。每个模块的落位表在 `docs/engineering.md` §4，Paseo 剥离可以从 `brain.provider` 契约落下后开始。待用户定：cordis 用 3.18 稳定线还是 4.0 候选线 |
| 30 | 先定插件机制与协议规范，第一版先终端能跑再 demo 网页（2026-10-28） | 用户对决策 29 的设计说"我认为可以"，并问"先设计模块还是先把插件机制和协议规范定下来……第一版本只做终端能跑，或者 demo 网页能跑"。结论：先定插件机制和协议规范（`contracts` + `kernel` + profile），因为所有模块都依赖它、定了就能并行；槽位契约分两层：机制层（manifest、loader、槽位注册、事件信封、IPC、错误）现在全定，各槽位的业务契约随模块设计逐个落下。第一个能跑的东西是 m0 终端：最小链路加 `cli` 终端客户端（连 gateway 的 WebSocket），第 0 步探针直接跑在 m0 上；demo 网页 = M1 的最小主控台。`engineering.md` 的 5 项选择按推荐定（上游 cordis 钉版本、`LIWA_HOME` 放 Aether、嵌入先进程内、密钥进钥匙串、CI 只跑本机），cordis 3.18 与 4.0 两条线实测后钉死 |
| 31 | 插件机制底座与协议规范定稿（2026-10-29） | 用户定 cordis 用 4.0 线。四份评审处理后定下：cordis 精确钉 `4.0.0-rc.12`、类型与实例不出 kernel；required 由组合根以代码传入、种类按 realpath 推导、本机层 patch 不能装包、V1 拒绝外部插件；非 required 插件只拿 `PLUGIN_VIEWS`（V1 只 `procs.spawn`），槽位门面分宿主 / 提供方 / 消费方三份；五阶段启动与阶段集合（m0 / m1 / v1）、`requiredBy` 必需槽位、静态服务图、ready / drain / health；方法形状规则（异步、CallContext、只传 JSON、句柄、流、pure）与回环编解码测试；zod 4 钉版、strictObject、partialRecord；五种版本号分开；journal 追加协议；大脑有效绑定归 roster；profile 只放部署项、主人文件层 `owner.yml`、`$secret` 引用；时钟随机编号注入；具名导出入口；测试内核走真实 loader、`testkit` 包；组合根 `apps/liwa` 与安全模式页；IPC 宿主运行时推迟到第一个进程外插件（契约形状现在定）；context 归运行层、`overall.md` §3.2 规则 4 改写；05 §3.5 接缝改为 prepare / interpret + 纯函数；本地嵌入先进程内记为 §3.5 的例外。仍要用户确认的 9 项见"待定事项" |
| 32 | 信任模型：插件全部可信，隐私只管出口（2026-10-29） | 用户原话："所有插件都信任，因为这个插件后期都是上传 github 的……软件在本地，所有插件都是给自己用的……隐私是针对适配层对外说话的，不是对内逻辑的……一旦内部代码这么控制，会导致逻辑信息不全，造成误差。"落实：信任边界是模型与外界（`overall.md` §11.1 本来如此），插件在边界之内；插件可以 inject 任何服务、读任何账本、订阅经历流，逻辑信息不残缺；保留的只有工程纪律——写经各账本的写 API（单点写、校验集中、可回放）、主人专属操作要带 gateway 签发的主人令牌（防模型与会话）、受众只由 people 造且只在 context 装上下文和 outbox 投递两处裁、cordis 不出 kernel（防 API 漂移）。取消"插件视图白名单""伪造 required 测试""未审阅插件不装"这类按防插件写的设计；进程外只为故障隔离。`00-plugin-kernel.md` §0、§2、§3、§7、§10、§12，`00-contracts.md` §4.2，`engineering.md` §1–§4，`overall.md` §2.3、§3.2、§11.1 已同步 |
| 33 | 插件底座、协议规范、工程约定、成长拍板点全部确认；一个 CLI 一个插件；标准终端命令（2026-10-29） | 用户对"要定的 22 项"说"你这些我认为没问题"：决策 31 / 32 的 8 项、成长调研的 8 项全按推荐值定下；agent 可以并行跑；本次全部文档改动可提交推送。另两点：**一个 agent CLI 算一个插件**（`brain.provider` 的 claude、codex、acp 各一个包，ACP 用 `as:` 多实例接更多 CLI）；**对外要有一套标准终端命令，跟 Paseo 一样**，`packages/cli` 升格为 `liwa` 命令行，是 gateway 的客户端（`engineering.md` §12），m0 先有 start / status / doctor / dump-config / chat / tail。用户还问 DSH 插件化到什么程度、我们够不够丰富，对照表写在 `00-plugin-kernel.md` §16：槽位种类不少于 DSH，多出生命相关的，缺界面插件与热重载，故意不开 agent loop、工具执行、提示词整段替换；以后可加投影单元、沙箱提供方两个槽位 |
| 34 | 分工：主对话只对话与派活，设计与实现走 agent（2026-10-29） | 用户原话："我要新开一个 opus5.5 的，然后方案设计采用 agent 让 fable5.1 或者 opus5.5 设计器，代码实现让 opus5.5 实现，主对话只负责跟我对话，安排活。"落实见"怎么协作"：主对话（Opus 5.5）读本文接手、拆任务书、派 agent、复核、给主人讲、写回文档、征得同意后提交；设计 agent 用 Fable 5.1 或 Opus 5.5 出轻量版模块文档与一页结论；实现 agent 用 Opus 5.5 按已确认文档写代码并跑 CI；评审照旧请 Codex、Fable、Opus。1.7 先不急着继续，等新会话接手 |
| 35 | 插件机制核实后收尾：kernel-0 全部做完（2026-10-29） | 四个方向加 Codex 复核（`research/2026-10-29-verify-kernel.md`、`verify-contracts.md`、`verify-layout.md`、`verify-codex.md`）与命令机制草稿（`modules/00-commands.md`）交回后，用户对"直接修的约 40 条 + 要定的 28 条"说"我认为你的没问题，但是现在应该是把插件机制做完"，做完后要讲插件机制的原理、说明与 DSH 万物插件化的对等程度。定下：① 报告里标"设计内修复"的条目全部直接修；② 底座：`as:` 多实例与实例身份（插件知道自己是哪一份）；一个插件实例在一个槽位只挂一个实现，变体写进 meta（`job.trigger` 用 `meta.kinds` 列 cron、一次性、间隔）；meta 按槽位 `Meta` 校验并在运行时可读；manifest 加 `runtime`（进程内 / 子进程），种类只表示代码来源；启动关闭每一步有时限，ready 与 drain 顺序带上槽位边（gateway 最后开门、最先关门），加一个必定执行的收尾步骤杀子进程；编号带启动序号；装配哈希只算有效装配加代码版本；required 之间的 inject 在第 1 阶段按层表检查方向；删 manifest 的 `plugins[]`，改正文档与代码、与 cordis rc.12 对不上的地方；③ 协议：权限请求多选项（本次、本会话、永久、拒绝、取消，本会话允许进第一版）；握手有回应、版本号用整数、带客户端类型，写操作带幂等键，推送分快照与增量、断线后从断点续收，版本不一致仍提示刷新；额度多窗口加余额；回合失败加上下文超限、超时、取消；人设注入方式按用脑种类配；错误类别加"找不到"；02 草稿的三条（经历流按流读、从断点订阅；大脑事件标批号；事件按"对象.动作.v版本"命名）；④ 命令：按 `00-commands.md` 走（一条命令写一次，终端、命令面板、斜杠命令共用；插件在 manifest 声明、命令挂在自己名下；退出码加 4 = 本体内部出错；`liwa status` 本体没跑也打印、退出码 2；m0 加 `liwa commands list|show`；第一版插件不能加本机命令与交互命令）；⑤ 目录按 `verify-layout.md` ② 锁定：`liwa` 入口在 `packages/cli`（静态只依赖 contracts 与新的 `client`，本机命令动态加载本体），Mac 壳与手机端在 `apps/`，新增 `client`（m0）、`ui-sdk`（V1.1）、`plugin-sdk`（第一个进程外插件时，含 Python 版），录放大脑独立成 `plugins/brain-replay`，迁移脚本跟着各自模块，本地 Python 模型服务作为插件包，`job-triggers` 改名 `job-trigger-time`，人设样板进 `plugins/persona-template-default`；⑥ kernel-0 里原先留到 1.7 的一并做完：回环编解码测试、testkit、`AsyncLocalStorage` 标插件 id 与连续崩溃自动禁用、`boot.json` 与安全模式页。IPC 宿主运行时（kernel-1）仍按决策 31 等第一个进程外插件 |
| 36 | 改以 DSH 源码为底座，fork 后独立、破坏性重写（2026-10-29） | 用户原话："我不认为我们做的很领先，我认为我们肯定不如他做的，所以我想有他的源码，然后破坏性重写，实现我们的能力，他的插件是多，如果我们能用我们就用，不能用就直接把插件删除，在原来的位置换成我们插件，这样我感觉比我们从零写更快"；此前说"先fork过来，然后基于现在的代码我们独立"，并希望"把他的原始的agent，抽象成一个agent cli提供方，然后在接入paseo cli，在接入成长记忆系统"。主对话列过的代价（约 57 万行非测试 TS 与 88 万行测试、410 个包、alpha 版、它的 cordis 是 rc.7 加 24 处补丁、没有隔离与时限、接 Claude Code 只是一次性子任务、两套代码规范、商标不能用"DeepSeek Harness"命名）用户已知。落实：以 `deepseek-ai/deepseek-harness` 提交 `f3803c96`（0.2.2-alpha.2，MIT）为底，不再跟上游；它的插件能用就留，不能用就删，在原位置换成灵鲸的插件；DSH 自己的 agent 抽象成大脑提供方之一，Paseo 的 Claude Code、Codex 长会话是另外的实现（决策 2 的"用脑都走 agent CLI"不变）；改名为灵鲸，保留 MIT 版权声明。本条取代决策 29 的"不引入 `@deepseek-ai/dsh` 本身"与决策 31、35 里自研 kernel 和 contracts 的部分；决策 32 的信任模型、整体架构与 05、06、02 的模块设计不变，落位改到 DSH 底座上。顺序按用户原话："不要做迁移方案，我们先把dsh的代码拿到，看下现状，做一次基础的改造，然后设计迁移方案，我们版本来就实现的不太多"：先拿到代码、看现状、做一次基础改造，再设计迁移方案。原 `packages/kernel`、`packages/contracts` 的代码等新底座跑起来再删 |
| 37 | `liwa-dsh` 给 AI 看的规则换成灵鲸的（2026-10-29） | 主人："先把第一项处理掉，这个很重要"，对三处冲突说"那就都按照你的建议的"。落实（`liwa-dsh` 的 `dsh-base` 分支）：根 `AGENTS.md` 重写为灵鲸版（先读主人全局原则与本文、协作规则、代码现状、命令与检查、继承自 DSH 仍成立的技术约定），`CLAUDE.md` 仍软链到它；`packages/AGENTS.md`、`vendor/AGENTS.md` 译成中文、去掉 DSH 团队流程，vendor 改为归我们维护、不再同步上游；`.agents/skills` 里 20 个 DSH 工作流技能设为只许手动调用（SKILL.md 的 `disable-model-invocation: true` 管 Claude Code，`agents/openai.yaml` 的 `policy.allow_implicit_invocation: false` 管 Codex〔一手，`codex-rs/skills/src/model.rs:22-28`〕），删掉忽略这些 yaml 的 `.agents/skills/.gitignore` 使设置随仓库走；产品自带的 `agent-experience`、`snapshots/` 下的测试夹具、`.agents/notes/` 历史笔记、其余 13 个子目录 `AGENTS.md` 原样保留。三处冲突：① DSH 的 `verify-export-jsdoc` 要求每个导出写 JSDoc，与"注释只写为什么"冲突，先保留，处理工程配置时再定；② 在 `liwa-dsh` 里按 DSH 的"按改动选检查、默认不跑全量"，取代本文"交回附全量 CI 原文"对该仓库的要求；③ 服务包默认导出服务类（DSH 的 Loader 靠它识别），自研底座的"禁止默认导出"不再适用。DSH 文档与技能里有 9 处链接指向根 `AGENTS.md` 的小节，已改到新的"命令""检查""技术约定"三节（`docs/development`、`docs/rescope` 两对中英文档的配对哈希已重算），`pnpm run doc-sync` 43 项全过 |
| 38 | 技术栈与工程配置以 DSH 为准（2026-10-29） | 主人看完两边技术栈对比后说："现在都以他的为准，不用根据main的"。落实：`dsh-base` 沿用 DSH 的 TypeScript 6、pnpm 11.28、vendored cordis rc.7 加补丁、插件配置用 schemastery 与数据用 zod 4 并存、cordis logger、oxlint 加 `scripts/verify-*` 检查脚本、tsdown 与 Vite 构建、vitest 与快照回放测试、锁文件定版本；`main` 上 `engineering.md` 的工程配置（eslint、dependency-cruiser、catalog 精确钉版、pino、`tools/ci.sh`）不再适用。CI 放不放 GitHub、只做 Mac 剪不剪其他平台，等剪枝时主人再定 |
| 39 | vendored cordis 现在就升到 rc.12 这一批正式发布（2026-10-29） | 主人："我想现在升级，然后跑全量测试，因为我们后边改造更难处理这个问题了，现在改要是出了问题，我们本来就要重写，只要不出现严重没问题，都能接受"。主对话先说明过：不能直接替换（rc.7→rc.12 上游 70 个提交，配置模型与 Loader 生命周期都变，DSH vendor 外 659 个文件引用 cordis），24 处补丁约 7 处可删、5 处部分删、其余要留（易变配置上游没有，DSH 有 40 个文件依赖它），DSH 自己的 rc.11 升级计划拆成 8 个 PR 还停在提议。目标：上游 `01b3962`（2026-10-21 同批发布：core 4.0.0-rc.12、loader 1.0.0-rc.9、include 1.2.0、hmr 1.1.2、timer 1.1.4、group 1.0.0；npm 上的最新正式版），不跟之后未发布的提交。结果（主人对三个拍板点说"这三个按照建议"）：7 个 cordis 包换成 `01b3962` 源码，本地修改留 V1–V7、V10、V11、V15–V17、V20、V22–V24 中仍需要的部分，退役 V8、V9、V12–V14、V18、V19、V21，新增 V25（Include 经 `HmrWatch` 用热重载）、V26（条目重新初始化前等旧 fiber 结算）、V27（保留 `events.dispatch`，去掉上游没给替代的弃用标记），清单与理由在 `vendor/README.md`；bash-startup-timeout 快照按新行为刷新（关停时如实多记一条 `job/settled`）；Loader rc.9 不许条目 id 带冒号，生成插件改用连字符，不做迁移。对比 rc.7 基线：单元测试一致（50 688 过、6 项环境相关失败），lint、快照、hygiene 全过且 hygiene 比基线好。升级在临时分支做完后并入 `dsh-base`（`187cfd4e`），临时分支、DSH 参考克隆与 rc.7 中间产物已清理 |

## 评审意见的处理

### Fable 5.1 的评审（`2026-10-28-review-overall-fable.md`，30 条）

总体判断：骨架对，可以在上面做；问题集中在所有权与依赖方向的自相矛盾、没算账的"省钱"设计、第一版范围过大。处理如下（节号指 `overall.md`）：

| 条目 | 处理 | 改在哪 |
| --- | --- | --- |
| M1 身与意的所有权、body 向上依赖 | 采纳：冲动表工程上归 body（产品上仍属"意"）；编排层每分钟给 body 压"情境快照"；context 划进编排层；依赖规则加"账本层不向上读" | §2.1、§2.3、§3.2、§3.3、§4.1 |
| M2 回复链里的隐藏模型调用 | 采纳：`reply` / `say` 带可选的感受与理由；记录类工具允许并发；延迟预算改成"主人看到回复 ≤2 秒"；§13 按每回合 2–5 次推理记账；加实测项 32 | §2.4、§5.2、§13、§17 |
| M3 回放名实不符 | 采纳：拆成 L0（身与念纯代码、确定性）/ L1（代码回归）/ L2（真跑模型）；采样带随机源状态；联想打分不异步落地；恢复 = 从采样点重放其后事件 | §3.1、§4.1、§6.8、§12.1、§14、N17 |
| M4 慢想没算账、无优先级 | 采纳：优先级邮箱（请示 > 冲突与应对 > 闲暇，无副作用批次可抢占）；按触发类别配大脑（N22 请拍板）；稳定前缀瘦身；§13 给出估算和按触发类别的日预算表 | §3.3、§5.1、§5.4、§13 |
| M5 去向表矛盾、主动投递无规则 | 采纳：对主人的冲动直接进主人的在场，对别人的主动开口经慢想放行一次（N24）；主动 `say` 的目标 = 合并在场里主人最近活动的地方，不在线用首选地方；家规分预检（省钱）与 outbox 不变量；"动身"= minds 按需为某人开在场（V2） | §4.3、§4.6、§7.4、§3.3 |
| M6 第一版范围 | 部分采纳：§16.1 分前期 / 后期两段（N21 请拍板），评测提前到主动开口和请示之后并补四类题，日预算先于开自主；沉迷三态推到 V4 | §16、N21 |
| S1 账本与引擎边界未落模块 | 采纳：列出引擎接缝（ingest / consolidate / rank / forget / renderPersona / proposeGrowth / proposeSelf / relationModel）；夜间链由 scheduler 按引擎声明拼；plugins 行加替换演练 | §3.3、§9.2、§16.1 |
| S2 容量双重所有权 | 采纳：注意容量归 attention（产品语义），资源并发归 guard，两个数可不同 | §2.3、§3.6 |
| S3 四套"在等" | 采纳：关注项并入心事；新增待决事项、决策点记录两种账本，归 will | §2.1、§2.3、§7.2 |
| S4 家规归属 | 采纳：家规归 guard，outbox / attention 只读；"别烦我"的两个入口写明 | §2.3、§7.2、§10.4 |
| S5 身的机制、两种心情模型 | 采纳：去向表加"负面应对"行；body 补同人每日上限、习惯化、连续坏事保护、主导情绪 + 档位、默认评价表；心情只用一个模型（回弹力即速率） | §4.1、§4.3 |
| S6 早安无触发源 | 采纳：作息醒来写低显著线索事件；可选初始习惯；承诺的在场关闭时回退到主人日常聊天（N23 请拍板早安的性质） | §4.1、§4.3 |
| S7 成长只在换新生效 | 采纳：夜里有成长或自我变更就换新主人的在场 | §4.9 |
| S8 弱模型主动开口、桌子替她决定 | 采纳：说出后释放、无果退避作为身体机制；桌子只给分组和文字、不给数值（N25）；硬币只用于继续当前活动；加"顶位选中率"指标；主动开口可配更强一档的大脑 | §4.1、§7.3、§7.4、§14 |
| S9 主人路径的垫话 | 采纳：`ask_mind` 立即返回"已请示 + 期限"，人设规定垫话，决定后立即起一轮 | §5.2、§5.3 |
| S10 她自己的事的手与做法的安全边界 | 采纳：这类手无 shell、只读 + 草稿目录；第一版"做法"只能是步骤文本；录放载荷与前缀快照纳入可删并级联 | §5.2、§6.7、§11.9 |
| S11 平台限频、反馈可得性 | 采纳：平台限频计数归 guard、outbox 执行；反馈信号按地方能力降级 | §2.3、§8 R12、§7.4 |
| S12 慢想重试幂等 | 采纳：决策点记录作幂等键 | §5.4 |
| S13 联想归属与时效 | 采纳：memory 持激活字段并给带分候选，attention 只管时机；联想带 TTL | §3.3、§4.3 |
| S14 A1 / E1 / 消融的调度 | 采纳：夜间链加 A1 自问；E1 作周作业；context 带消融开关 | §4.9、§14、§16.1 |
| R1 按触发类别的日预算表 | 采纳 | §13 |
| R2 配置管理、运行日志、测试策略、schema 演进 | 采纳 | §6.9、§14 |
| R3 工具目录瘦身 | 采纳：在场 ≤ 10 个；`note` / `keep_in_mind` / `care_about` / `widen_audience` 并成 `remember(kind)`；id 用 ASCII | §5.2 |
| R4 诚实的上限进人设 | 采纳 | §5.1 |
| R5 名词 | 采纳：定义"分神"为策略不同的手；注明"在场"双义 | §2.1 |
| R6 账本快照 | 采纳 | §6.9 |
| R7 时区与时钟 | 采纳：挂钟（时区、夏令时、休眠）与单调时钟分开 | §3.1 |
| R8 备份加密与恢复演练 | 采纳（N26 请拍板密钥放哪） | §6.10 |
| R9 同人每日上限与习惯化 | 采纳（同 S5） | §4.1 |
| E 依据抽查 | 采纳全部：heartbeat 退役的引用改为"不设第二套调度器"并直说身的一跳就是心跳；AI Town 改为成本纪律；Tolan 2 秒标为语音场景类推；心理 §4.2.6 注明本稿按决策 21 有意偏离其"代码侧 softmax"的建议；想念消减改到回合写回按回应质量；Humanoid 数字标估算；P2 加"除被删正文外可重算" | §0.3、§1.2、§2.4、§2.5、§4.4、§7.1、§7.3 |
| ⑤ 需主人拍板的 10 项 | 并入 overall.md §18：N21–N27、U2 | §18 |

### Opus 5.5 的评审（`2026-10-28-review-overall-opus.md`，26 条）

总体判断：工程骨架对，问题集中在生命内核怎么落地：主动开口、受众定义、工具数量、交接件所有者、成本、第一版过重。处理如下：

| 条目 | 处理 | 改在哪 |
| --- | --- | --- |
| 必1 主动开口：弱模型判断、再触发无人管 | 采纳："等回音"不应期作为身体机制（说出去后对这个人的"找他"冲动不起回合，连续没回拉长，对方开口清零）；无果退避；第一版主动开口默认交慢想三选一、在场措辞（N16 请拍板）；主人正在聊不另起主动开口；主控台给主人只读的"她这周主动找你 N 次，你回了 M 次" | §4.1、§4.3、§4.6、§5.3、§7.4、§10.4、N16 |
| 必2 主人能知道什么四种说法；默认受众表漏原因 | 采纳：拆成"主人可见"与"主人在场的受众"；决策 12 的措辞按此修正；C6 改为"问起也只说这是妈妈私下说的"；默认受众改成"活动的事实公开，内容和原因继承来源"，状态行按受众裁原因；"要不要告诉家人主人能看私聊"列为 U3 | §2.1、§5.1、§5.8、§18 |
| 必3 在场 16 个重叠工具 | 采纳：在场 8 个（reply、say、inner、commit、ask_mind、dispatch、recall、look）；`inner` 一次结构化内心记录；回复必须在第一批、批结束用钩子收尾；学做法、建议账号、放宽受众第一版改由空闲增量从原文提取 | §2.4、§5.2、§13 |
| 必4 待决事项与决定记录无所有者 | 采纳：待决事项归 will，scheduler 建期限作业；决定记录由慢想的动作事件投影；慢想邮箱优先级（主人在等的请示 > 冲突与应对 > 主动开口 > 闲暇）；主人本人发起且只涉及他自己的冲突直接还给在场当场问主人 | §2.1、§2.3、§4.3、§5.4 |
| 必5 成本没有账；订阅额度不在总闸 | 采纳：§13 给估算和日预算表（单位写明为推理次数）；慢想稳定前缀只留短版人设和决策规矩，自我与账本按需取；一件自己的事做完由那只手选下一件，只有冲突或没有在跑的用脑才叫醒慢想；总闸同时计钱和额度窗口、按 token 自算不信 SDK 估价、给主人预留额度（U6） | §5.1、§7.3、§11.8、§13 |
| 必6 自动切换时回归做不到前置 | 采纳：备用大脑离线预审（每周 + 模型版本变化时），自动指标过线、主人确认后才进自动切换名单；同时发现服务商静默更新 | §3.4、§12.3 |
| 必7 冲动、家规、容量双写 | 采纳（和 Fable M1、S2、S4 同）：冲动表归 body、家规归 guard、注意容量归 attention 与资源并发归 guard 分开 | §2.3、§3.3、§3.6 |
| 应1 慢想冷启动 | 采纳：保留时长自适应（主人活跃时段保持温热）、非紧急事合批窗口；"每次新开"改为可配置默认值并修正 Anthropic 长任务的引用 | §5.4 |
| 应2 身的循环细节、回放三件 | 采纳：危险率按 Δt 缩放；计数器式随机数；身的一跳做成 scheduler 系统作业；恢复 = 快照 + 同一函数快进 + 重放其后事件；`body.sampled` 带参数与代码版本、不重算历史；L1 按回合序号重放；L2 沙箱加假出口；录放载荷可删 | §3.1、§4.1、§6.8、§12.1、§14 |
| 应3 硬币边界 | 采纳：硬币只在她自己开的事里、她写的终止条件内运行，理由继承 `do`；权重翻成话；开发者视图统计硬币占比 | §7.3、§14 |
| 应4 念第一版用枚举 | 采纳：第一版去向由事件类别优先级枚举决定；"抬头看看"只注入不起回合；注意容量按未了结的焦点计、第一版后期落地 | §3.6、§4.2、§4.3 |
| 应5 第一版范围与顺序 | 采纳：第 0 步大脑探针；分 V1.0 / V1.1（N21）；评测提前并含主动开口两种做法对比；早安是作息线索上的决策点（N23）；日记只在夜里写；日历定第四版（N27）；Codex 适配器到 V1.1 | §4.3、§4.9、§16 |
| 应6 CLI 隔离 | 采纳：非手的用脑 `settingSources` 为空、每成员独立配置目录；关 CLI 自动压缩或让本体阈值更低；探针加身份类问题；是否改用自定义系统提示列为 U5 | §3.4、§17 |
| 应7 安全缝 | 采纳：污染回合的记忆写入带标记、夜里不能提升；N11 与 M16 改为"默认关闭 + 按类别打开 + 单次限额"，去掉"每次确认"；出站轻查：回复走事后审计，主动消息发出前查 | §5.2、§5.3、§11.9、§18 |
| 应8 引用与名词 | 采纳：修正 §1.1 的节号；`attention.decide` 改名 `route`；§2.4 只写工具类别、以 §5.2 为准；睡眠只用 `submit`；本稿不再有版本号，"第四版"只指产品版本 | 全文 |
| 应9 日志保留分级、增量备份、删除范围 | 采纳：保留分级；增量备份与恢复演练；可删除载荷的范围加录放表和派生的作品、日记 | §6.7、§6.9、§6.10 |
| 应10 body 是账本层的例外 | 采纳：写明身的动力学留在内核不做槽位，参数派生由成长引擎交提案；替换演练保留 | §9.1、§9.2 |
| 议1 主人的在场混得最多 | 采纳：内部回合种类尽量少；内部内容不 steer 进主人发起的回合；主人正在聊不另起主动开口 | §8 |
| 议2–议8 验收采集点、参数配置实体、时区、服务指标、回复快慢的执行器、V2 在场者名单不进稳定前缀、预算单位 | 采纳 | §5.1、§6.9、§10.4、§13 |
| E 依据抽查 | 采纳：heartbeat 退役、AI Town、心理 §4.2.6、"每次新开"、每分钟抽签的引用都已改写或标明偏离；"代码摆桌子她选"改引 D2A；主动开口便宜大脑够用的说法删除 | §0.3、§1.2、§2.5、§4.1、§5.3、§7.1、§7.3 |
| ⑤ 需主人拍板 9 项 | 并入 overall.md §18：N16、N11、N21、N27、U3、U5、U6；产品定义里残留的"抽签""想念归零"措辞已按决策 21 统一 | §18；product.md |

两位评审都认为对、不要改的：她在账本不在会话；经历流唯一事实来源与可删载荷；用脑只提出动作、本体执行、先记后做；对外只有显式动作、收件人来自事件；受众由代码算、放宽按条目显式授权；权限沿请示链；人物档案与关系记忆分开；身在代码里每分钟一跳、评价归模型强度归代码；情绪与心情分开；承诺不抽签；每个在场一个会话；主人消息抢占；单进程加子进程；适配层只报事实；家规与教养分开；换大脑过回归；验收指标从经历流算、数值进开发者视图；睡眠按批；不做"模型一直在想"。

### 插件机制底座与协议规范的评审（2026-10-29，四份：Codex astra 24 条、Codex terra 27 条、Fable 31 条、Opus 30 条）

按主题归并；编号指各报告里的条目。

| 主题 | 谁提 | 处理 |
| --- | --- | --- |
| 信任边界靠插件自报 `kind` / 包名 | astra 03、fable 1–2、opus 6、terra 3 | 采纳：required 以代码传 `startKernel`；种类按 realpath 推导；本机与命令行层只许 replace.config / disable / enable / bind；V1 拒绝 external；伪造包名、同服务键重复声明进测试 |
| 插件拿到完整内核服务、`Slots`、甚至 cordis ctx | astra 04、fable 3、18、opus 1、7、terra 2 | 采纳：`KernelContext` 为冻结门面，cordis 不出 kernel；`PLUGIN_VIEWS` 白名单（V1 只 `procs.spawn`）；三份槽位门面；主人操作做成只给 gateway 的能力对象；`AudienceRef` branded |
| "一切可序列化"与第一批接口矛盾 | astra 01、fable 4–7、opus 2、18、terra 6、12、13 | 采纳：方法形状七条规则、`Handles`、`pure`、`transport`、`JsonValue`、可导出子集、回环编解码；05 §3.5 改为 prepare / interpret 两段 + 纯函数 + ISO 时间 |
| 启动就绪不足、"core 全 required"拖住 m0、主人配置层读不到 | astra 05、08、opus 3–5、8、13、terra 4、5、9、10、23 | 采纳：五阶段、阶段集合、`requiredBy`、静态服务图、ready / drain、代际失效与 AbortSignal、安全模式页在组合根、大脑绑定归 roster、`owner.yml` 文件层 |
| 对 cordis 行为的误判 | astra 06、fable 8–9、opus 24、terra 8、11 | 采纳：启动先接 logger exporter；订阅 `internal/status`；就绪看 `fiber.state`；kernel 逐个逆序 dispose；Config 只同步；`name: id`；PENDING 会重跑 apply 写进文档 |
| zod 4 的 record 与宽松对象 | astra 02、opus 9、terra 7 | 采纳：钉 zod 4、`partialRecord`、`strictObject`、`z.iso.datetime`、文档示例作为正例测试 |
| IPC：方向、令牌、流、取消、资源、stdout 冲突 | astra 12–14、fable 4–5、16–17、opus 15、19、terra 15–16 | 采纳形状：fd 3 管道、hello 请求 / welcome 响应、只信磁盘 manifest、反向调用只开声明的视图、`$/cancel` 对任意请求、流带序号与窗口、错误码表；运行时推迟为 kernel-1 |
| 大脑契约缺项 | astra 15、fable 10、opus 16、terra 22 | 采纳：句柄、`session.exited`、`turn.interrupted`、`itemId`、tool_call started / completed、native 分支带令牌经 `toolport.invoke`、`batchEndHook` 与 `endTurnAfter`、上下文用量、未知用量不填 0、`providerReportedCostUsd` |
| 时钟、随机、编号不满足回放 | astra 16、fable 13、opus 12、terra 18 | 采纳：挂钟 / 单调钟 / 定时器分开，`Rng.fork(label)` 与 `fromState`，`ids.next`，ESLint 禁系统时钟与随机，安全令牌用密码学随机源 |
| journal 追加协议、事件命名、`erased` | astra 17、fable 11、24、opus 28、terra 17 | 采纳：`AppendRequest` / `CommittedEvent`、`kernel.started.v1`、`AUDIENCE_OWNER = 0`、信封去掉 `erased` |
| 版本体系 | astra 18、fable ③4、opus 20、terra 24 | 采纳：五种版本号；事件破坏性变化按 overall §12.8 一次性迁移；external 用 peerDependencies 钉 kernel |
| 配置分层、密钥、绑定归属 | astra 10、fable 14、③3、opus 3、21、27、terra 20–21 | 采纳：profile 只放部署项；`$secret` 引用与解析时点；去掉 extends 与主人配置事件层；`enable` 操作；重复 id 与未知目标报错 |
| 测试内核绕过真实加载 | fable 12、opus 11、terra ③ | 采纳：`createTestKernel` 走同一段五阶段代码；`@liwa/testkit`；反例清单 |
| 默认导出冲突 | fable ④12、opus 10、terra 27 | 采纳：具名导出 `plugin`，出现默认导出即拒绝 |
| 分层与所有权冲突 | astra 22、opus ④2–4 | 采纳：context 归运行层；overall §3.2 规则 4 改写；engineering 层表以 overall 为准 |
| Paseo 剥离 | astra 24、fable ④11、opus 23、terra 25 | 采纳：进程经 `procs.spawn` 视图、禁 import `node:child_process`；`agent-sdk-types.ts` 原样留在 brain-shared；映射层；Q10 的几块落位；固定上游提交、列 import 闭包；m0 只验证 Claude |
| 人设锚与关系权限 | astra 21、terra 14 | 采纳：底色与硬规则由 required 的 self / context 固定注入，成长引擎只回可变段；`defaultPermissions` 只在主人批准的上限内 |
| 组合根、动态 import、`exports` | opus 22、terra 27 | 采纳：`apps/liwa`；`exports` 含 `./package.json`；以组合根为解析根 |
| 进程外 ≠ 安全边界 | astra 13、fable ③6、opus 15、terra 1 | 采纳：明写；OS 隔离前不装未审阅插件 |
| 可以推迟的 | 各家 ⑤ | 采纳：IPC 运行时、single / chain、provideFactory 隔离、configSchema / client / notices / platforms、extends、remove、指标管道、插件页接口 |
| 本地嵌入从第一天进程外 | fable ⑥5 | 部分：维持决策 30 先进程内，记为 overall §3.5 的例外并写明退路；待用户最终确认 |
| 把 cordis 源码搬进 kernel 自维护 | opus ⑥4 | 不采纳（暂）：先钉版 + 门面隔离；候选版 API 再大变再考虑 |
| `dump-config` 区分静态与有效计划 | terra 5 | 部分：`dump-config` 只给静态计划，大脑有效绑定由插件页从 roster 并排展示 |
| brain.provider 声明为只能进程内以免做句柄 | opus ⑥6 | 不采纳：句柄形状现在定（代价小），运行时推迟 |
| 信任模型的总调整 | 用户 2026-10-29 | 决策 32：插件全部可信（一方代码、开源、本机自用）；上面采纳的"视图白名单""伪造 required 测试""未审阅插件不装"收窄为工程纪律与配置错误检查；隐私只管上下文与出口 |

## 待定事项

- **需要用户提供的信息**：备份加密的密钥放哪；她用的 Claude、Codex 账号是否和用户自己写代码共用、预留多少额度（overall.md §18.5）。
- **后续版本前再定**：第二版接家人前，要不要让家人知道主人能看她们的私聊；第四版前，公开发言（B 站、抖音评论）的规则（`product.md` §12 第 14 条）。
- **需要用户同意的操作**：提交推送 2026-10-29 的代码批次（见"仓库状态"）；06 成长系统草稿的四点（见"现状"）；转写小凌的讲解视频（要装 ffmpeg 和中文语音识别，不做也不影响架构）。提交推送逐次征得同意。

## 模块阶段的调研起点

记忆系统、用脑与大脑两个模块已有子调研原文（`docs/research/2026-10-28-subagent-notes/`），下表里已经读过的部分不必重做。调研约定：调研 agent 可以并行跑（2026-10-29 同意），但每个 agent 自己不再开子 agent；单个 agent 内部不设阅读量上限；产出写进 `docs/research/2026-10-28-<主题>.md`，格式：来源清单（注明实际读了什么）、机制对比表、对灵鲸的设计建议（理由、取舍、依据）、坑与反例、待实测；区分一手和二手。

| 模块 | 要回答的问题 | 调研起点 |
| --- | --- | --- |
| 生命内核 | 身的参数表与派生；显著性打分；心事与关注项的字段；决策点的桌子；家规；回放模式 | 三份"像生命"调研（心理 §4.2 的伪代码、游戏 §4.2、产品调研 §4.2）；`structure-validation` M1–M16 |
| 记忆系统（调研已完成：`2026-10-28-memory-mechanisms.md`） | 四类记忆的数据结构与存储；每轮召回与 token 预算；来源与受众怎么落地；领域记忆怎么做到"超长"；每晚整理与遗忘；更正、删除怎么和"经历流是唯一来源"兼容；防记忆投毒；自我模型四层；印象摘要 | 论文：MemGPT、Mem0、Zep/Graphiti、A-MEM、Generative Agents、MemoryBank、HippoRAG、LongMemEval、LoCoMo、MemOS。源码：letta、mem0、graphiti、cognee、langmem、OpenClaw 记忆、astrbot_plugin_livingmemory、MaiBot。另查 Node 下 sqlite-vec、混合检索、嵌入模型。子调研存档：memory-papers-core、memory-oss-source、memory-benchmarks-poisoning |
| 成长系统（调研已完成：`2026-10-28-growth-mechanisms.md`） | 人设三层的数据结构与注入；性格参数派生；成长提案怎么产生、谁审、怎么防漂移和防操控、怎么版本化回滚；能的三层与成熟度；习惯表；日记 | 论文：Generative Agents、Voyager、Reflexion、persona drift、Character-LLM、RoleLLM、CharacterEval、PersonaGym、self-evolving agents 综述。源码：OpenClaw 工作区文件、MaiBot、elizaOS character、SillyTavern 角色卡、moeru-ai/airi、Letta persona block、dafeiyu-astrbot |
| 用脑与大脑 | 统一 agent 契约的接口草案（会话、turn、事件、steer、interrupt、权限、usage、人设注入映射、能力声明）；上下文装配；内核工具目录的参数与校验；交接包；子会话派生；备用大脑切换与回归测试；用量怎么喂给花钱总闸；Paseo 哪些模块可摘 | Helm 源码 `packages/server/src/server/agent/` 与 `docs/providers.md`、`agent-lifecycle.md`、`timeline-sync.md`；ACP 最新规范；A2A；MCP 规范；Claude Agent SDK；Codex app-server 协议；上游 Paseo；OpenClaw 多 agent；Anthropic 多 agent 实践。子调研存档：cli-claude-sdk-codex-app-server、cli-protocols-acp-a2a-mcp、cli-multi-agent-practice、cli-paseo-upstream-openclaw-orchestration |
| 能力插件 | 见 `ability-plugins.md` | — |
| 客户端界面、前后端 | 见 `client-backend.md` | — |

调研者约定：搜索优先用 WebSearch；读 GitHub 不用 WebFetch，用 curl（见下节）；下载内容放 `mktemp -d` 新建的空目录，只读不执行，解析用 `python3 -I`；不安装任何东西，不改任何本地仓库；某个地址失败一次就换思路，不要反复换 URL 重试。

## 环境与工具注意事项

- **mac mini**：Apple M4、24 GB；内置盘约 158 GB 可用，外置盘 Aether 约 3.6 TB 可用。Claude Code 2.1.312、Codex 0.163.0、gh、uv、pnpm 已装；ffmpeg 没装。Node 由 fnm 管理，默认 24.18.0，但非交互 shell 里 `node` 解析到 Homebrew 的 v26.12.0，写代码时要用 `.node-version` 和 `engines` 钉住 Node 24。Tailscale 在线。
- **GitHub**：WebFetch 访问 github.com 会被代理拒绝。Bash 里已配 `HTTPS_PROXY`，curl 可用：优先用 raw 地址 `curl -sS -m 30 -o <file> https://raw.githubusercontent.com/OWNER/REPO/HEAD/<path>`；API 的 README 用 `-H 'Accept: application/vnd.github.raw' https://api.github.com/repos/OWNER/REPO/readme`，目录用 `.../contents/<path>`；未认证每小时约 60 次、搜索每分钟 10 次；完整目录树对大仓库会超时。
- 论文：`curl -sS 'https://export.arxiv.org/api/query?search_query=all:<terms>&max_results=5'`。
- macOS 没有 `timeout` 命令。zsh 里不要用小写 `path` 当变量名。
- 本机 CI 是 `pnpm run ci`（`pnpm ci` 是 pnpm 内置的干净安装）；非交互 shell 先 `export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"`，或 `fnm exec --using=.node-version -- pnpm run ci`。单跑一个包的测试：`pnpm vitest run --project @liwa/kernel`；类型检查：`pnpm exec tsc --noEmit -p packages/kernel/tsconfig.json`。**不要在包目录里 `npx tsc`**：找不到工作区的 TypeScript 时它会去装 npm 上同名的 `tsc` 包并等交互确认，表现为卡住不动。
- 图页：`docs/scenarios/build.py` 用 Google Chrome 无头模式把 Mermaid 预渲染成 SVG（需要能访问 cdn.jsdelivr.net）；改图只改 `.src.html`。
- 仓库提交身份：仓库级 `user.name=WolffyCode`，邮箱沿用全局 noreply。

## 用户偏好与协作方式

- 全程中文。
- 所有确定的需求、架构都必须落到仓库文档里；文档只存最新方案，不留历史措辞。
- 遵守 `~/.claude/CLAUDE.md` 的全局原则：改在根上、不叠兼容层；函数与模块的编码规范（单一职责、模块间只走 API、每个东西唯一归属等）。
- 查资料优先用后端搜索（WebSearch）。
- 提交、推送前先征得同意。
- 设计必须有调研依据，拒绝拍脑袋的方案；讲设计时每个设计点都带依据（来源项目、论文或 issue，一手还是二手），推理出来的单独列。
- 用户自己提的方案要先评审合不合理再采纳（用户原话："这个只是我说的，不代表就要这么设计，你应该评审我的是否合理"）。
- 讲得太技术时用户会说"没看懂"：用直白的话、配具体例子；用户偏好图和页面胜过大段文字。
- 外部灵感来源（如抖音小凌）只作参照，设计依据以开源代码和论文为主；游戏机制只借身体层，不当标准。
- 在意 token 开销；2026-10-29 起同意调研与实现 agent 并行跑（总 token 不变，只省等待）；重要稿子请独立评审（整体架构请了 Fable 5.1 和 Opus 5.5；插件底座请了 Codex astra、Codex terra、Fable 5.1、Opus 5.5）。 2026-10-29 起分工改为：主对话只对话与派活，设计走 Fable 5.1 或 Opus 5.5 的 agent，实现走 Opus 5.5 的 agent（决策 34，见"怎么协作"）。
- 名字、人设内容是用户自己的事：软件名已定（灵鲸 / LingWhale / Liwa）；人设名由用户在出生设定里起。

## 仓库状态

- 远端：`git@github.com:WolffyCode/liwa.git`，**公开仓库**，分支 `main`，最后一次提交 `ccf2f47`（02 用脑方式草稿；脚手架、contracts、kernel、06 草稿在 `4525f42`）。不要把原始对话日志、本机配置、凭据提交进来。
- 本地副本：mac mini `/Volumes/Aether/Users/wolffycode/Developer/person/liwa` 是开发工作区；MacBook 上的 `~/Desktop/coding/person/liwa` 可能落后，用之前先拉取。
- DSH 底座（决策 36）：同一个仓库的 `dsh-base` 分支，与 `main` 历史互不相干。第一个提交 `982347c` 是 DSH `f3803c96` 的原样快照（树哈希与上游一致，不含上游历史），之后是灵鲸的改造提交。MacBook 上用 git worktree 检出在 `~/Desktop/coding/person/liwa-dsh`（`git worktree list` 可见），`~/Desktop/coding/person/liwa` 仍停在 `main`。两个分支重叠的根文件（`docs/`、`README`、`package.json`、`pnpm-workspace.yaml`、tsconfig 与 vitest 配置、`THIRD_PARTY_NOTICES.md` 等）先不合并，灵鲸的内容从 `main` 读，按主人的顺序挨个替换；给 AI 看的规则已换（决策 37）；vendored cordis 已升到 rc.12（决策 39，提交 `187cfd4e`）。要看 DSH 原样代码用 `git show 982347c:<路径>`，不另留参考克隆。在 `liwa-dsh` 里装依赖（`pnpm install`，经代理约 2.5 分钟，`node_modules` 2.1 GB）时，DSH 的安装后脚本会给这个工作目录设独立的钩子目录（`.git/worktrees/<名>/dsh-hooks`，lefthook，提交前跑 DSH 的检查），同时也往共用的 `.git/hooks` 写三个 lefthook 钩子（`LEFTHOOK=0` 拦不住）；`main` 没有 lefthook 配置，装完要删掉共用目录里的 `pre-commit`、`pre-merge-commit`、`pre-push`。跑 DSH 时用 `DSH_HOME=~/.liwa-dsh-home`，不碰主人原有的 `~/.dsh`。
- 2026-10-29 已把下列改动提交并推送到 `main`（用户同意）：产品定义、人物画像、整体架构与图页、场景页、三份"像生命"调研、结构验证与插件化调研、事件日志补充、子调研存档、两份评审报告、模块设计计划（`architecture/README.md`）、记忆调研报告、记忆全景调研报告、成长调研报告、05 记忆模块文档、00 插件机制底座与协议规范两份设计、四份插件底座评审报告、路线图（`docs/roadmap.md`）、工程约定（`docs/engineering.md`）、本文。
- 2026-10-29 工作区里**未提交**的改动：四份核实报告（`research/2026-10-29-verify-*.md`）、命令机制 `modules/00-commands.md`、决策 35 的收尾工作（kernel、contracts、目录与文档）。提交前要主人同意。
