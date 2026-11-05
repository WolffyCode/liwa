# 02 — Codex 适配评估

本文是静态适配评估，建议与待定项不等于已定方案；执行范围与已定选择以 `docs/liwa/handoff.md` 决策 55–61 和 `architecture/modules/01-agent-cli.md` 为准。路径使用仓库相对路径或安装／产物占位符，源码证据、逐文件清单、测试计划与风险均完整保留。〔一手〕任务书 03 的公开仓库与内容保留要求。

状态：已完成。交回时间：2026-11-05 11:20 CST。范围：只读评估；以本机源码及Codex CLI 0.163.0生成协议为主，官方资料明确标〔二手〕，未经真实会话验证的行为保留验收条件。

## 1. 一页结论

**能接，继续采用PATH上的 `codex app-server`、JSON-RPC/stdio、每会话一个受管进程；V1只给干活与查资料。不能把这次接入概括成“拷Paseo文件、公共层完全不改”。** 迁移路线成立，配置隔离、预算保证和几处公共生命周期缺口需要先确定范围。〔一手〕本机 `codex-cli 0.163.0` 生成协议；`P主:4457、4503、7469`；`B:session.ts:473–494、529–536、610–654`；结论〔推理〕。路径缩写见§2。

| 主人最需要知道的事 | 结论 |
| --- | --- |
| 怎么接/最低版本 | 新 `@liwa/brain-codex` 包＋正常Cordis装配；0.163.0作为最低版本候选，真CLI A3通过后定正式下限。不用Codex daemon/proxy。〔一手〕本机help/生成协议；推荐〔推理〕§2 |
| 迁多少 | **8个非测试文件，原始10,131行**；已有35个shared文件共6,761行原文直接复用，**不需新增迁入共享文件**。预计裁后vendor 7,000–8,500行，另有严格适配与测试；详见逐文件表。〔一手〕§3统计；净量〔推理〕 |
| 公共层要改吗 | **建议补G1失败/取消用量结算、G4整轮watchdog；完整保留异步问题/计划审批及子实时用量，还须G2会话级pending、G3 childId/结算口径。** 配置分发、进程接口、普通答案/权限、切模型/模式已有扩展点，无需按厂商加分支。〔一手〕§6源码对照；建议〔推理〕 |
| 最大风险：隔离 | CODEX_HOME能换配置/auth身份，不能独自隔开HOME/.agents、项目/系统配置。新根不会自动继承默认登录；必须独立登录或显式API身份。project_doc_max_bytes=0关闭自动加载项目AGENTS，不是禁止工具读取文件。〔二手〕官方0.163源码/认证文档；§5 |
| 最大风险：能力承诺 | on-request不保证每个原生工具都经本体审批；reasoning/message条目数不等于推理次数；concludeOn只能候选“成功后中断确认”，不能承诺零额外推理。压缩off、子用量同连接仍待实测。〔一手〕生成协议；〔推理〕§4 |
| 需要纠正的设计/上游细节 | “不detached”应指提供方不自行脱管，底座仍靠POSIX detached建受管进程组；persistSession=false实际已发送ephemeral，旧日志是错的，持久句柄保护仍需补；Paseo还漏会话允许、idle退出、子用量和额度翻译。〔一手〕§2、§4所列代码 |
| 问答 | 改掉逗号拆分和缺答案默认选第一项；按question id保留数组，补Other选项/独立user_note。0.163无原生multiSelect字段，不能用假CLI冒充支持。〔一手〕`P主:1364、4774`与本机schema；〔二手〕官方TUI；§4.2 |
| 工时 | **12–20工程人日＋2–3评审人日**，不含第3步/第二层、登录等待和另批的高成本探针。机械迁移、NOTICE、确定的codec/字段映射/夹具可交GLM；生命周期、隔离、计量和取消不建议交。〔推理〕§9 |
| 与Claude评估对齐 | 共用G1、进程归属、凭据/配置分别隔离、日志/原生转录分工、停止失败不接新工作；本次新增Codex异步问题G2、子计量G3及共用watchdog G4。没有改01文件。〔一手〕01稿§6–7与本次代码对照 |

**要主人定的五组事**：① 订阅独立登录还是API/中转计费；② 严格配置隔离的验收定义及是否改成受控注入项目指令；③ 接受Codex原生审批/软预算边界，还是严格要求达不到就不接；④ G1–G4纳入哪些步骤，异步问答/子计量是否完整保留；⑤ ephemeral逐会话选择、正式版本下限和后续A3额度。推荐与理由在§10，均未替主人拍板。〔推理〕。

本次只做静态评估和协议生成，**未启动任何真实Codex会话、未消耗模型验收额度、未读取个人配置/凭据目录、未改仓库**；A3和十一项探针仍须另行授权。〔一手〕执行范围见§8.1。

## 2. 接入方式与版本

本节引用约定（全文沿用）：`L:` = `liwa-dev/`，HEAD `034f825409f40c6b1fa2b58dbf5a3b763c184473`；`P:` = `paseo-upstream/`，HEAD `8018231a00a6b45ed6cda1856f954ba14b4824c0`；`D:` = `liwa-dsh/docs/liwa/`；`G:` = `<本机 codex 生成的协议>/`（本机 0.163.0 生成的实验接口全集）；`T:` = `<本机 Codex 评估产物>/`。为缩短表格，`P主:` 专指 `P:packages/server/src/server/agent/providers/codex-app-server-agent.ts`，`B:` 指 `L:packages/brain/brain/src/`，`W:` 指 `L:packages/brain/brain-shared/src/session.ts`。行号均为本次读取值。

**路线成立；建议最低支持版本先定候选 `0.163.0`，A3 实测通过后才作为正式下限。** 不建议仅因 options 注释写“0.143+”就承诺 0.143 全能力可用：旧版缺分页、后台终端等行为，Paseo 自己还按 0.115／0.128／0.156 分别判断能力。当前只证明本机版本的静态协议；本任务没做真实兼容验收。〔一手〕`P主:184、198、203`、`P:packages/server/src/server/agent/providers/codex/options.ts:37`；下限建议〔推理〕。

| 项目 | 核实结果与落法 | 依据 |
| --- | --- | --- |
| 传输 | `codex app-server` 默认 `stdio://`；一行一个 JSON 请求／回复／通知，initialize 后发 initialized；保持 stdin/stdout 双向，不经 shell | 〔一手〕`T:app-server-help.txt`；`P:packages/server/src/server/agent/providers/codex/app-server-transport.ts:18、206、288`；`L:packages/subagent/subagent-codex/src/wire.ts:264` |
| 进程粒度 | 每个 BrainSession 一个 app-server；原生 child 是其线程，不另开 BrainSession；CLI 入口按 PATH 解析，实际绝对路径、版本随诊断记录 | 〔一手〕`B:provider.ts:38、158`、`P主:7469、7496`；落法〔推理〕 |
| “不 detached”需要改准措辞 | 提供方应删除 Paseo 自己的 detached/spawn/tree-kill，全部走 launch.spawn；**现有 subprocess-local 在 POSIX 内部仍用 detached:true 建受管进程组**。所以“不自行脱管／unref”成立，“OS spawn 的 detached 必为 false”不成立。建议保留底座进程组机制，不为 Codex 改它 | 〔一手〕`P主:7487`；`L:packages/subprocess/subprocess-local/src/spawn.ts:448、467–483`；`B:process.ts:181–199`；推荐〔推理〕 |
| daemon／proxy | daemon 托管共享 app-server；proxy 把 stdio 转发到已运行的控制 socket。两者都不符合本次每会话一个受管进程的归属模型，不用它们代替灵鲸第 3 步宿主 | 〔一手〕`T:daemon-help.txt:1–16`、`T:proxy-help.txt:1–17`；处置〔推理〕 |
| 版本漂移 | app-server 本身标 experimental。probe 验同一二进制的 --version；0.163.0 是候选支持底线，不代表未来所有更高版本已兼容；升级要重生成协议并跑适配器回归 | 〔一手〕`T:app-server-help.txt:1`；建议〔推理〕 |

Paseo 没有一套固定“协议版本号”：它用手写 Zod／unknown 解析，同时兼容多代 CLI。下表是“该提交实际使用的协议”与本机生成协议的差异，不是臆测 Paseo 必定运行哪一版 Codex。〔一手〕`P主:198–205、2660`；`P:packages/server/src/server/agent/providers/codex/app-server-transport.ts:71`。

| 方法／字段／通知 | 0.163.0 与 Paseo 的关系 | 迁入要求 |
| --- | --- | --- |
| thread/start、thread/resume、turn/start、turn/steer、turn/interrupt | 核心名字仍在；steer.expectedTurnId 必填。start/resume 都接 developerInstructions、config、modelProvider 等 | 保留，续接显式施加新代 cwd／审批／沙箱／MCP／人设，不能照 Paseo 只补部分字段。〔一手〕`G:v2/ThreadStartParams.ts:18`、`ThreadResumeParams.ts:29–73`、`TurnSteerParams.ts:7–26`；`P主:4094–4139` |
| getUserSavedConfig | 生成 ClientRequest 中不存在；Paseo 先调用后退 config/read | 删除此旧分支，直接 config/read。〔一手〕`P主:3178–3223`、`G:ClientRequest.ts` 全集 |
| thread/rollback | 生成全集不存在，Paseo 已知 ≥0.156 改用 fork；设计本来不迁 rewind | 连同 rewind、回滚 helper 一起裁掉；Meta.rollback=false。〔一手〕`P主:203–205、4992`、`G:ClientRequest.ts`；`D:architecture/modules/01-agent-cli.md:370` |
| tool/requestUserInput | 旧名字不存在；item/tool/requestUserInput 仍在 | 0.163 下限不保留旧别名。〔一手〕`P主:3970–3990`、`G:ServerRequest.ts:20` |
| Thread标识 | 当前Thread.id是线程号，sessionId是同一线程树共用号，parentThreadId另表亲缘 | ResumeHandle.sessionRef必须取thread.id；不能把新字段sessionId拿来代替threadId；子图可用parentThreadId核验。〔一手〕`G:v2/Thread.ts:17–42`；`P主:4967–4974` |
| 请求 id | 生成 RequestId 为 string 或 number；Paseo transport 和 serverRequest/resolved 只认 number | 统一保留原始 RPC id，响应不能把字符串 id 丢掉或换型。〔一手〕`G:RequestId.ts`；`P:packages/server/src/server/agent/providers/codex/app-server-transport.ts:157–164`、`P主:5649` |
| 审批请求 | 四种命令／文件决定仍存在，另有 execpolicy/network amendment；还有 item/permissions/requestApproval 等 Paseo 未处理入口 | 按 availableDecisions 生成实际选项；补权限扩展请求或显式不支持，不能将未知请求默认为允许；永久策略 amendment 不自动开放。〔一手〕`G:ServerRequest.ts:20`、`v2/CommandExecutionApprovalDecision.ts:7`、`v2/PermissionsRequestApprovalResponse.ts:7`；`P主:3970、7203` |
| 同步问题 | 问题有 isOther、isSecret，**没有 multiSelect 字段**；答案为 string[] | Paseo 的 multiSelect 是宽容兼容字段，不是当前 CLI 支持原生多选的证据；编码按 §4。〔一手〕`G:v2/ToolRequestUserInputQuestion.ts:9`、`ToolRequestUserInputAnswer.ts:8`；`P主:1230–1398` |
| 异步问题／子活动 | agentMessage.delivery/questions、collabAgentToolCall、subAgentActivity 在本机协议中仍有 | 不把前台回合结束当成会话异步问题结束；见 §6 新发现。〔一手〕`G:v2/ThreadItem.ts:34、88–133`；`P:packages/server/src/server/agent/providers/codex/async-questions.ts:75` |
| tokenUsage | 通知明确有 threadId、turnId；total 与 last 并存。Paseo 转换只拿 last，并在分发时丢 child telemetry | 以 total 的单线程基线差量计算回合消费，last 留作上下文观测；保留原生 turnId，不直接用 latestUsage 当整轮成本。〔一手〕`G:v2/ThreadTokenUsage.ts:6`、`ThreadTokenUsageUpdatedNotification.ts:6`；`P主:1080、2743、5718、6393`；计量落法〔推理〕 |
| rateLimits | account/rateLimits/updated、account/rateLimits/read 存在；该 Paseo 主适配器没有额度翻译 | 在新包直接翻译；不迁读取全局 auth.json 的 usage-source 插件。〔一手〕`G:ServerNotification.ts`、`ClientRequest.ts`；`P:plugins/codex-usage-source/server/usage.ts:81–100、133–150` |
| ephemeral | start 参数存在；Paseo persistSession=false 已传到构造器并发出 ephemeral:true，旧日志/TODO说无效 | 修日志，并补ephemeral不发布持久句柄的保护：当前markCurrentThreadSaved没有ephemeral判断（:6350–6356），不能照搬后向宿主谎报可续接；别复制设计中“空操作”的判断。〔一手〕`G:v2/ThreadStartParams.ts:44`；`P主:5563、7501–7523` |
| 本机额外能力 | requestUserInput.isBlocking、thread/queue/*、rawResponse/completed等未在Paseo主适配器实现；raw completion标internal-only，queue在实验全集 | 保留非阻塞请求语义；V1不以内部raw事件承诺硬预算，也不顺手引入第二队列。〔一手〕`G:v2/ToolRequestUserInputParams.ts:9`、`ThreadQueueAddParams.ts:6`、`RawResponseCompletedNotification.ts:7–11`；§4 |
| 历史 | 0.163 有分页 thread/items/list、thread/turns/list；resume.excludeTurns 仍支持，整段历史加载已被标 deprecated（paginated threads） | 只为原生续接/子身份恢复保留 thread-history，不用它当灵鲸 logs。〔一手〕`G:v2/ThreadResumeParams.ts:66–78`；`P:packages/server/src/server/agent/providers/codex/thread-history.ts:90–151` |

本次还生成了不含实验接口的 JSON Schema（`T:schema/`）与含实验接口的版本（`T:schema-experimental/`）。不能把 experimental 输出里“有类型”理解成无需握手 capability 即可用；Paseo 原握手明确给 experimentalApi:true。真实启用集应按使用到的 plan/问答等接口收窄并验证。〔一手〕`P主:3336–3346`；本机生成命令输出；落法〔推理〕。

## 3. Paseo 迁移清单

### 3.1 Codex 专属源码

下表路径相对 `P:packages/server/src/server/agent/providers/`，行数为原始文件的换行符数（与 wc -l 相同，包含注释）。除“不迁”外，落位统一在 `L:packages/brain/brain-codex/src/paseo/agent/providers/` 下保留相同相对路径。所谓“原样迁”也包含来源行与导入后缀/包名调整；这是设计认可的机械改动。每行原始内容/行数为〔一手〕对应文件 `:1`，处置为〔推理〕，重大改动的具体行号见 §2、§4–6。不是本任务已复制源码。

| 文件 | 原始行数 | 处置 | 目标（相对 brain-codex/src/paseo/） |
| --- | ---: | --- | --- |
| `codex-app-server-agent.ts` | 7,881 | 迁后原地改：受管进程与环境；删外部会话扫描、导入/回滚/全局 prompts/skills fallback；不启 goals 自动续跑；补会话允许、结构化问答、plan 映射、子归属/取消、差量计费/额度；删除旧版本兼容和身份伪装；收紧超时、日志脱敏 | `agent/providers/codex-app-server-agent.ts` |
| `codex-feature-definitions.ts` | 59 | 迁后原地改：保留能力常量；plan 从 feature 接到 modeId；service tier 只留明确配置，删旧 fast_mode 兼容 | `agent/providers/codex-feature-definitions.ts` |
| `codex/app-server-transport.ts` | 458 | 迁后原地改：ChildProcess 改 SubprocessHandle；tree-kill 改 terminate+done；支持 string/number RPC id；取消/关闭清待处理表；有界超时/输出、保留 JSONL Unicode；裁回滚 helper，日志不含完整原始帧 | `agent/providers/codex/app-server-transport.ts` |
| `codex/options.ts` | 91 | 迁后原地改：导入共享协议；按0.163校验字段；加入隔离/认证/生命周期等经校验 Config；保留 tool policy，但不把 enabled_tools 或 approve 当成安全边界 | `agent/providers/codex/options.ts` |
| `codex/thread-history.ts` | 168 | 迁后原地改：保留分页、上限和重复 cursor 防护，只访问本会话/已证实子线程；不用它导入用户历史或作为灵鲸 logs | `agent/providers/codex/thread-history.ts` |
| `codex/tool-call-mapper.ts` | 1,101 | 迁后原地改：保留工具/协作条目解析；核对子 threadId 与生命周期，保留原始工具输入/输出供审批与收尾；导入共享包 | `agent/providers/codex/tool-call-mapper.ts` |
| `codex/tool-call-detail-parser.ts` | 218 | 原样迁：只做来源行、.ts 后缀和跨包导入替换；壳层映射到 BrainEvent.detail | `agent/providers/codex/tool-call-detail-parser.ts` |
| `codex/async-questions.ts` | 155 | 迁后原地改：按 id 保留结构化答案；不依赖 header 拼串；会话级挂起/恢复及答复启动下一轮不能照搬旧 manager；见§6，若主人延期此能力则相应裁掉并明确拒绝 | `agent/providers/codex/async-questions.ts` |
| `codex/rewind.ts` | 112 | 不迁：设计已排除回滚；同时删主文件调用及 transport 的 rollback/fork-for-rewind 支路 | `—` |

### 3.2 已迁共享文件：不再复制

已迁的 35 个文件可以沿现有 exports 复用；**本次没有发现需要补迁新的通用文件**。导入链核对到已有共享文件，碰到已裁的产品边界即停止，不为满足一个旧 import 把 Paseo manager、workspace、plugin 或附件协议整串迁入。主适配器直接/间接依赖的 shared 在下表标“用”；“已有”表示库存可复用，但不应为 Codex 强行接上。依据：〔一手〕`P主:1–124`、`L:packages/brain/brain-shared/NOTICE:14–58` 与各文件 import；判断〔推理〕。

| brain-shared/src/paseo/ 内文件 | 上游行数 | 处置／用途 | 目标 |
| --- | ---: | --- | --- |
| `agent/agent-sdk-types.ts` | 830 | 已迁、直接引用；用：契约类型（已去掉 Paseo 附件，已带 processHost） | `brain-shared/src/paseo/agent/agent-sdk-types.ts` |
| `agent/agent-timeline-content.ts` | 145 | 已迁、直接引用；用：条目长度约束 | `brain-shared/src/paseo/agent/agent-timeline-content.ts` |
| `agent/agent-timeline-store-types.ts` | 68 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/agent/agent-timeline-store-types.ts` |
| `agent/agent-timeline-store.ts` | 185 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/agent/agent-timeline-store.ts` |
| `agent/create-agent-mode.ts` | 112 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/agent/create-agent-mode.ts` |
| `agent/provider-history-timestamps.ts` | 17 | 已迁、直接引用；用：子观察历史时间 | `brain-shared/src/paseo/agent/provider-history-timestamps.ts` |
| `agent/provider-launch-config.ts` | 279 | 已迁、直接引用；用：已接受管进程解析和剥凭据环境；提供方仍须清除隔离变量回退 | `brain-shared/src/paseo/agent/provider-launch-config.ts` |
| `agent/provider-notices.ts` | 11 | 已迁、直接引用；用：模式/思考档下一轮生效 | `brain-shared/src/paseo/agent/provider-notices.ts` |
| `agent/provider-options.ts` | 105 | 已迁、直接引用；用：provider options 校验 | `brain-shared/src/paseo/agent/provider-options.ts` |
| `agent/provider-refresh-deadline.ts` | 80 | 已迁、直接引用；已有：删外部catalog后按剩余调用复用 | `brain-shared/src/paseo/agent/provider-refresh-deadline.ts` |
| `agent/provider-session-import.ts` | 84 | 已迁、直接引用；已有：本次不接外部导入 | `brain-shared/src/paseo/agent/provider-session-import.ts` |
| `agent/provider-subagents/store.ts` | 166 | 已迁、直接引用；已有：子描述符/时间线容器；BrainEvent观察通过共享session，不另造第二存储 | `brain-shared/src/paseo/agent/provider-subagents/store.ts` |
| `agent/providers/custom-message.ts` | 26 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/agent/providers/custom-message.ts` |
| `agent/providers/diagnostic-utils.ts` | 449 | 已迁、直接引用；用：已接 processHost 的版本诊断 | `brain-shared/src/paseo/agent/providers/diagnostic-utils.ts` |
| `agent/providers/jsonl-frame-decoder.ts` | 277 | 已迁、直接引用；用：JSONL 有界分帧 | `brain-shared/src/paseo/agent/providers/jsonl-frame-decoder.ts` |
| `agent/providers/provider-image-output.ts` | 272 | 已迁、直接引用；用：图片输出能力；只将受控路径交给它 | `brain-shared/src/paseo/agent/providers/provider-image-output.ts` |
| `agent/providers/provider-runner.ts` | 129 | 已迁、直接引用；用：单回合事件收集 | `brain-shared/src/paseo/agent/providers/provider-runner.ts` |
| `agent/providers/question-card-answer.ts` | 23 | 已迁、直接引用；已有：不要把其展示字符串用作原生答案编码 | `brain-shared/src/paseo/agent/providers/question-card-answer.ts` |
| `agent/providers/resume-process-cwd.ts` | 26 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/agent/providers/resume-process-cwd.ts` |
| `agent/providers/tool-call-detail-primitives.ts` | 1,052 | 已迁、直接引用；用：shell/read/edit 详情 | `brain-shared/src/paseo/agent/providers/tool-call-detail-primitives.ts` |
| `agent/providers/tool-call-mapper-utils.ts` | 269 | 已迁、直接引用；用：工具解析小函数 | `brain-shared/src/paseo/agent/providers/tool-call-mapper-utils.ts` |
| `agent/runtime-mcp-config.ts` | 70 | 已迁、直接引用；已有：MCP组合；Codex wire编码仍归新包 | `brain-shared/src/paseo/agent/runtime-mcp-config.ts` |
| `agent/system-prompt.ts` | 10 | 已迁、直接引用；用：拼 developerInstructions | `brain-shared/src/paseo/agent/system-prompt.ts` |
| `agent/timeline-projection.ts` | 742 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/agent/timeline-projection.ts` |
| `protocol/agent-message.ts` | 14 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/protocol/agent-message.ts` |
| `protocol/agent-types.ts` | 545 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/protocol/agent-types.ts` |
| `protocol/path-utils.ts` | 17 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/protocol/path-utils.ts` |
| `protocol/provider-config.ts` | 139 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/protocol/provider-config.ts` |
| `protocol/timeline-identity.ts` | 7 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/protocol/timeline-identity.ts` |
| `protocol/timeline-turn.ts` | 24 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/protocol/timeline-turn.ts` |
| `protocol/tool-call-display.ts` | 181 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/protocol/tool-call-display.ts` |
| `protocol/tool-name-normalization.ts` | 94 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/protocol/tool-name-normalization.ts` |
| `utils/path.ts` | 214 | 已迁、直接引用；用：路径等价比较（限定隔离目录） | `brain-shared/src/paseo/utils/path.ts` |
| `utils/promise-timeout.ts` | 45 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/utils/promise-timeout.ts` |
| `utils/string-command-shell.ts` | 54 | 已迁、直接引用；已有：共享类型/时间线或帮助函数，沿现有依赖使用 | `brain-shared/src/paseo/utils/string-command-shell.ts` |

灵鲸自写但本次可直接复用的不是迁移输入：`@liwa/brain` 的 `findProviderExecutable / execProviderCommand / spawnProviderProcess / mergeLaunchEnv`、`rulesDocument / replaceSkills / memberMcpServers`；`brain-shared` 的 `PaseoBrainSession`、`toPaseoPrompt`（blob→图片）、`renderLiwaBlock`、`paseoLogger`。不依赖 brain-acp 来复用其协议无关薄转换；Codex 自己完成少量配置/启动映射，避免让两家提供方互相依赖。〔一手〕`B:process.ts:29、113、181、223`、`B:config-dir/shared.ts:25、36、56`、`L:packages/brain/brain-shared/src/index.ts:1`；落法〔推理〕。

### 3.3 直接边界依赖与附录里“共享文件”的遗漏项

路径以 P: 根为准。每行行数/代码为〔一手〕对应文件 `:1`，处置〔推理〕。被排除文件的传递依赖一并不引入；这是边界裁剪，不是清单漏项。

| 文件 | 行数 | 处置与理由 | 落位 |
| --- | ---: | --- | --- |
| `packages/server/src/server/agent/prompt-attachments.ts` | 223 | 不迁：forge/上传/PR附件是Paseo产品；共享AgentPromptContentBlock已删这些分支 | — |
| `packages/server/src/executable-resolution/executable-resolution.ts` | 181 | 不迁：用brain进程API和已改共享launch配置，不能另起探测进程 | — |
| `packages/server/src/utils/spawn.ts` | 78 | 不迁：替换为launch.spawn，保留单一进程归属 | — |
| `packages/server/src/utils/tree-kill.ts` | 122 | 不迁：SubprocessHandle.terminate负责进程组 | — |
| `packages/server/src/server/workspace-git-service.ts` | 4,150 | 不迁：主文件只为fallback skills查Git根等借用；删该外部扫描，工作区归workspace | — |
| `packages/server/src/server/agent/permission-response.ts` | 40 | 不迁代码：依赖AgentManager/startAgentRun；其followUpPrompt语义必须在新提供方/第3步接住，见§6 | — |
| `packages/server/src/server/agent/provider-runtime.ts` | 62 | 不迁：是ProviderSnapshotManager+OpenCodeBridge装配，Codex并不直接依赖，附录A把它算共享迁移过宽 | — |
| `packages/server/src/test-utils/test-logger.ts` | 5 | 不迁：5行pino mock，用brain-testkit/cordis日志器 | — |
| `plugins/codex-usage-source/index.server.ts` | 15 | 不迁：插件平台入口与V1额度通知无关 | — |
| `plugins/codex-usage-source/server/usage.ts` | 302 | 不迁：扫描全局凭据并直接请求账号HTTP；V1用本会话app-server额度通知 | — |
| `plugins/codex-usage-source/server/stores.ts` | 131 | 不迁：跨Codex/Pi/OMP/OpenCode读取凭据，与隔离约定冲突 | — |
| `plugins/codex-usage-source/shared/input.ts` | 14 | 不迁：上述凭据路由的类型 | — |
| `packages/server/src/server/paseo-env.ts` | 82 | 不迁：其环境类型/剥离已由shared与subprocess替代 | — |
| `packages/protocol/src/messages.ts` | 7,849 | 不迁：Paseo全前后端协议；shared已裁AgentAttachment依赖 | — |
| `packages/protocol/src/provider-manifest.ts` | 324 | 不迁：产品提供方目录；shared已就地定义开放provider id | — |
| `packages/protocol/src/paseo-tool-presentation/index.ts` | 98 | 不迁：Paseo工具展示注册；shared已裁该分支 | — |
| `packages/server/src/server/agent/tools/types.ts` | 59 | 不迁：Paseo工具catalog；shared launch已换processHost | — |
| `packages/server/src/server/agent/agent-manager.ts` | 5,794 | 不迁：原测试中的manager耦合改由brain-testkit宿主承接 | — |
| `packages/server/src/server/agent/provider-registry.ts` | 1,021 | 不迁：注册/装配由ctx.brains和Cordis负责 | — |
| `packages/server/src/server/agent/agent-storage.ts` | 445 | 不迁：JSON产品存储，原测试改用新宿主状态 | — |
| `packages/server/src/server/test-utils/class-mocks.ts` | 57 | 不迁：耦合旧manager的测试mock，换brain-testkit | — |

Node 内置模块不迁文件；`zod` 用仓库已有版本；`pino` 替为 `paseoLogger`，不新增 pino/which/tree-kill 依赖。不迁 `@getpaseo/protocol/messages`、`provider-manifest`、`paseo-tool-presentation`、`agent/tools/types`：现有 shared 已在正确归属处裁掉其产品分支。〔一手〕`L:packages/brain/brain-shared/NOTICE:27–48`；〔推理〕。

### 3.4 测试文件（单列，不能混进非测试行数）

下表路径相对 P: 的 providers/。原始行数为〔一手〕各文件 `:1`；处置均为〔推理〕。迁测试是保留断言意图、改注入与夹具，不意味着拷完就能运行；真实CLI测试仅移植案例，默认关闭。

| 文件 | 行数 | 处置 | 目标 |
| --- | ---: | --- | --- |
| `codex/app-server-transport.test.ts` | 238 | 迁后改：选留行为断言，删旧manager/catalog/rewind支路，换共享imports和受管进程 | `brain-codex/tests/paseo/codex/app-server-transport.test.ts` |
| `codex/rewind.test.ts` | 253 | 不迁：回滚/外部导入/Paseo agent自管agent不在范围 | `—` |
| `codex/test-utils/fake-app-server.ts` | 800 | 迁后改：现有是内存假ChildProcess；补可执行stdio假CLI，帧按0.163校验 | `brain-codex/tests/fixtures/fake-app-server.ts` |
| `codex/thread-history.test.ts` | 220 | 迁后改：选留行为断言，删旧manager/catalog/rewind支路，换共享imports和受管进程 | `brain-codex/tests/paseo/codex/thread-history.test.ts` |
| `codex/tool-call-mapper.test.ts` | 1,104 | 迁后改：选留行为断言，删旧manager/catalog/rewind支路，换共享imports和受管进程 | `brain-codex/tests/paseo/codex/tool-call-mapper.test.ts` |
| `codex-app-server-agent.features.test.ts` | 606 | 迁后改：选留行为断言，删旧manager/catalog/rewind支路，换共享imports和受管进程 | `brain-codex/tests/paseo/codex-app-server-agent.features.test.ts` |
| `codex-app-server-agent.local.e2e.test.ts` | 522 | 迁案例后改：受管进程、隔离home、测试MCP与独立开关；剔除旧manager/外部历史场景 | `brain-codex/tests/paseo/codex-app-server-agent.local.e2e.test.ts` |
| `codex-app-server-agent.process-exit.test.ts` | 685 | 迁后改：选留行为断言，删旧manager/catalog/rewind支路，换共享imports和受管进程 | `brain-codex/tests/paseo/codex-app-server-agent.process-exit.test.ts` |
| `codex-app-server-agent.real.e2e.test.ts` | 128 | 迁案例后改：受管进程、隔离home、测试MCP与独立开关；剔除旧manager/外部历史场景 | `brain-codex/tests/paseo/codex-app-server-agent.real.e2e.test.ts` |
| `codex-app-server-agent.spawn-error.test.ts` | 84 | 迁后改：选留行为断言，删旧manager/catalog/rewind支路，换共享imports和受管进程 | `brain-codex/tests/paseo/codex-app-server-agent.spawn-error.test.ts` |
| `codex-app-server-agent.test.ts` | 7,830 | 迁后改：选留行为断言，删旧manager/catalog/rewind支路，换共享imports和受管进程 | `brain-codex/tests/paseo/codex-app-server-agent.test.ts` |
| `codex-async-questions.test.ts` | 436 | 迁后改：选留行为断言，删旧manager/catalog/rewind支路，换共享imports和受管进程 | `brain-codex/tests/paseo/codex-async-questions.test.ts` |
| `codex-custom-provider-import.local.e2e.test.ts` | 194 | 不迁：回滚/外部导入/Paseo agent自管agent不在范围 | `—` |
| `codex-history-lifecycle.real.e2e.test.ts` | 151 | 迁案例后改：受管进程、隔离home、测试MCP与独立开关；剔除旧manager/外部历史场景 | `brain-codex/tests/paseo/codex-history-lifecycle.real.e2e.test.ts` |
| `codex-history-string-limit.real.e2e.test.ts` | 53 | 迁案例后改：受管进程、隔离home、测试MCP与独立开关；剔除旧manager/外部历史场景 | `brain-codex/tests/paseo/codex-history-string-limit.real.e2e.test.ts` |
| `codex-interrupted-turn-terminals.test.ts` | 374 | 迁后改：选留行为断言，删旧manager/catalog/rewind支路，换共享imports和受管进程 | `brain-codex/tests/paseo/codex-interrupted-turn-terminals.test.ts` |
| `codex-mcp-agent-commands.e2e.test.ts` | 186 | 不迁：回滚/外部导入/Paseo agent自管agent不在范围 | `—` |
| `codex-plan-mode.real.e2e.test.ts` | 74 | 迁案例后改：受管进程、隔离home、测试MCP与独立开关；剔除旧manager/外部历史场景 | `brain-codex/tests/paseo/codex-plan-mode.real.e2e.test.ts` |

### 3.5 总量与设计差异

| 口径 | 数字／判断 | 依据 |
| --- | ---: | --- |
| 新迁非测试原始输入（8 文件） | **10,131 行** | 〔一手〕§3.1逐文件求和，含 async-questions 和 thread-history，排除112行rewind |
| codex/ 全部非测试（含rewind） | **2,303 行** | 〔一手〕该目录7文件换行计数 |
| 已迁 shared（35 文件） | **6,761 行上游原文**，新增迁移量为0 | 〔一手〕§3.2求和；不能再算一次 |
| 上表候选测试/夹具原始池 | **13,938 行** | 〔一手〕§3.4求和，含不迁项目；最终不是全量照搬 |
| 裁完后的Codex vendor预计 | 约7,000–8,500行 | 〔推理〕主文件去catalog/导入/回滚/全局fallback/旧协议，同时补协议修正；实施前不能给精确净行数 |
| 新写严格源码预计 | 约1,500–2,500行（不含公共补口） | 〔推理〕provider/adapter、配置、认证入口、策略、用量、答案、测试可注入进程等 |
| 选留/改造测试预计 | 约4,500–7,000行 | 〔推理〕从原始池裁manager耦合并补契约/竞态/安全验证 |

设计 §4.3 的“7,881 + 约2,300”按 codex/ 全目录算，包含本来不迁的112行rewind，漏了目录外59行codex-feature-definitions；净迁输入为10,131，而非简单10,181。附录A的“约10,000”作为粗估基本准确（多131），但**不是最终工作量**：还需测试和自写适配；其“共享文件缺permission-response/provider-runtime”不代表必须补迁，两者实际属于被替换的manager/runtime边界。〔一手〕`D:architecture/modules/01-agent-cli.md:172、370、374`；上述统计；判断〔推理〕。

## 4. 契约映射与 Meta 草案

### 4.1 能力逐项

“能做到”指协议与适配路径存在，**不是已完成A3真会话验收**；“部分”列出不能许诺的边界。当前源码优先于尚未随第2步更新的设计摘要：真实接口已有sessionHome/writeMemberConfig、modeSwitch、modeId和answers。〔一手〕`B:provider.ts:127–192`、`B:contract.ts:49–84、149–192、539–550`。

| 契约/要求 | 判断 | Codex落点、必要修改与依据 |
| --- | --- | --- |
| BrainProvider.impl/meta/probe | 能 | 新brain-codex插件effect登记；probe用同一PATH解析结果跑--version，认证失败另报auth，不能用有binary证明已登录。〔一手〕`B:provider.ts:158–177`、`B:process.ts:29、113`；落法〔推理〕 |
| createSession/resumeSession | 能 | sessionHome:'per-member'，launch.homeDir就是CODEX_HOME；新代配置、受管spawn和stdio。续接只用已持久threadId；不把加载旧metadata里的systemPrompt/MCP当新配置。〔一手〕`P主:4094–4139、4957–4989、7496–7567`；`B:provider.ts:149–192` |
| subscribe/startTurn、流式BrainEvent | 能 | item/agentMessage/delta、reasoning、item/started/completed、turn/started/completed → 共享条目/回合转换；保留原生thread+turn到灵鲸turn的关系，旧回合迟到输出不能借当前回合。〔一手〕`P主:6235、6326、6359、6944`；`W:616–651、705–737`；`G:ServerNotification.ts:93` |
| session.exited/process.exited/close | 能 | **Paseo在idle退出时只断连、不发失败**，必须在新包补无回合的退出通知，再由共享映射为session.exited；process.exited由brains报告。close先结算/取消pending，再关管道和受管组。〔一手〕`P主:3733–3749、5251`、`W:683–690`、`B:session.ts:457–464、803–809` |
| persistence/thread/resume | 能，有条件 | thread/start的id不一定马上可恢复，Paseo等用户回合宣布保存后才给句柄；ephemeral必须恒null。保存provider/sessionRef/nativeHandle/createdAt及稳定home关联，不保存credentials/MCP header。〔一手〕`P主:4957–4989、6349–6358`、`W:1046–1055`；`P:docs/providers.md:510` |
| 原生工具 nativeToolPolicy | 部分 | read-only限制写入不清空原生工具；workspace-write仍有命令/读写工具。没有已证明覆盖全工具的tools:[]等价物；V1维持仅work（干活/查资料），none拒绝。工具可关闭某个feature不等于全面关闭。〔一手〕`P主:325–345`、`G:v2/ThreadItem.ts:34`、`ThreadStartParams.ts:32–36`；推断/推荐〔推理〕 |
| 沙箱 | 能，有边界 | 线程sandbox与turn.sandboxPolicy；明确cwd、writable roots、网络及临时目录。workspace-write默认不能直接解释为“仅worktree可写”，要处理/tmp、TMPDIR、额外roots和升级授权；read-only仍可请求提权。〔一手〕`P主:2178–2198`、`P:packages/server/src/server/agent/providers/codex/options.ts:40–49`、`G:v2/TurnStartParams.ts:73–96`；〔推理〕 |
| permissionHook | 能处理原生请求，不能拦所有原生调用 | requestApproval只在CLI判断要审批时出现；on-request不保证每次工具经本体。设计§8“kernel模式原生工具每次经本体”不能由此推出。V1可用provider审批＋toolport内核工具授权；若坚持全原生拦截则不支持，不能假报支持。〔一手〕`T:codex-help.txt` on-request说明；`G:v2/AskForApproval.ts:5`；`D:architecture/modules/01-agent-cli.md:282`；〔推理〕 |
| accept/acceptForSession/decline/cancel | 能，Paseo须补 | 分别映射allow_once/allow_session/deny_once/cancel；按availableDecisions实际提供；共享permissionOptions可覆写。Paseo resolvePermissionDecision目前只有accept/cancel/decline，漏会话允许；不能用allow_always冒充。文件审批要合并已知item变更事实，命令审批保留approvalId/network/additionalPermissions。〔一手〕`P主:657–662、7203–7289`；`G:v2/CommandExecutionApprovalDecision.ts:7`、`FileChangeApprovalDecision.ts:5`、`CommandExecutionRequestApprovalParams.ts:17–72`；`W:490–500` |
| 新权限扩展入口 | 部分 | item/permissions/requestApproval有permissions和turn/session scope，不能照命令审批返回decision字符串；新包专用codec把允许/空授权拒绝正确映射，不支持的字段明确拒绝。〔一手〕`G:ServerRequest.ts:20`、`v2/PermissionsRequestApprovalResponse.ts:7`；`P主:3970`未注册该入口；〔推理〕 |
| 同步问答/多选/isOther | 部分，详见4.2 | 公共selected/custom能保留；当前CLI问题schema没有multiSelect，不能伪造原生多选验收；isOther控制附加Other选项、补充说明另按user_note编码，isSecret另需安全输入策略。〔一手〕`G:v2/ToolRequestUserInputQuestion.ts:9`、`ToolRequestUserInputAnswer.ts:8`；`B:contract.ts:302–321` |
| 异步问答/非阻塞请求 | 部分，公共G2 | agentMessage.delivery:'async'的问题在前台结束后仍待答；新requestUserInput还带isBlocking，Paseo没保留。原生RPC回调和通过后续prompt回答不是同一路，必须区分；默认不能因turn结束删会话问题。〔一手〕`G:v2/ToolRequestUserInputParams.ts:9–13`、`ThreadItem.ts:34`；`P:packages/server/src/server/agent/providers/codex/async-questions.ts:75`；§6 |
| deliver(next_step) | 能 | turn/steer + native expectedTurnId；等待turn/start异步标识后再送；拒绝是unavailable，未知结果是错误，不自动重复/换轮。〔一手〕`P主:4473–4524`、`G:v2/TurnSteerParams.ts:26`；共享已能接 |
| deliver(next_turn) | V1建议false | Paseo用turn/start/steer，不提供公共“busy时只在下一轮消费”保证；让第3步宿主排队。0.163新有thread/queue/add/list/update/delete/reorder/start，可后续独立验证后声明true，不能和宿主双队列重复投递。〔一手〕`G:ClientRequest.ts`、`v2/ThreadQueueAddParams.ts:6`、`P主:4457、4503`；推荐〔推理〕 |
| cancel/排队撤回 | 能，需实测保证 | 捕获旧nativeTurnId后turn/interrupt；Codex取消会清未读steer（Paseo契约依据），cancelKeepsQueue:false。**后台终端不一定随interrupt停止**，保留并强化按该turn的processId终止；不能像Paseo仅记warn就假成功。新thread/queue与旧steer不是同队列，若启用须显式delete已收未消费提交。〔一手〕`P:docs/providers.md:108`、`P主:151–159、5025–5089、5120–5248`、`G:v2/ThreadQueueDeleteParams.ts:5`；〔推理〕 |
| setModel | 能，下一轮生效 | turn/start.model支持；Paseo setModel只是改config。新包必须核验模型可用性/新请求选择、发session.model_changed；对中转自定义模型不能只依赖默认OpenAI catalogue。活动回合不宣称已换模型。〔一手〕`P主:4666–4670`、`G:v2/TurnStartParams.ts:97–100`；`B:provider.ts:123–127`；〔推理〕 |
| modes含plan | 能，包内改映射 | Paseo mode是read-only/auto/auto-review/full-access，plan另挂feature；公共已有modeId/setMode，新增Codex的plan模式映射到collaborationMode.mode='plan'，退出用'default'，保留独立sandbox/approval约束。不要按UI名含read猜plan，也不要把plan当沙箱。〔一手〕`P主:325、3817–3867、4655–4708`；`G:ModeKind.ts:8`、`v2/TurnStartParams.ts:129–136`；〔推理〕 |
| 自动压缩off | 未证实，V1按不支持off处理 | 本机配置只有model_auto_compact_token_limit数值与thread/compact/start；没有本次已证实的关闭布尔。数值设很大/0/负数不等于安全禁用，不能宣称switchable。保守Meta.always_on，收到contextCompaction报session.compacted。〔一手〕`G:v2/Config.ts:22`、`ThreadItem.ts:133`、`P主:5964–5992`；〔推理〕 |
| limits.inferences | 严格硬上限做不到已证实 | 一个模型响应可有reasoning+多个agentMessage，item开始次数不是推理请求数；事件到客户端时请求已花钱。0.163有rawResponse/completed（按responseId一次completion的usage），但标internal-only、开启raw events也标内部用途，不能当V1稳定前置闸。建议budget.inferences:false；如做观测计数明确其估计口径，不能声称第N+1请求不发生。〔一手〕`G:v2/ThreadItem.ts:34`、`RawResponseCompletedNotification.ts:7–11`、`ThreadStartParams.ts:82–86`；设计`:181`是〔推理〕，现需修正 |
| limits.toolCalls | 原生工具严格限次做不到已证实 | item/started是事实通知，不是执行前拦截；on-request也不覆盖全部调用。内核MCP工具可在toolport额度闸拒绝，但不能覆盖native shell。建议budget.toolCalls:false，watchdog按设计归公共层，但当前未消费watchdogMs，须补G4。〔一手〕`G:ServerNotification.ts:93`、`B:contract.ts:63–64`；〔推理〕 |
| concludeOn | 可做中断式收尾，须#40实测 | 新包记录本轮目标工具成功item/completed后请求interrupt；仅“自己发起的conclude中断+已证实成功”转completed{concludedBy,usage}，人为cancel/失败不能冒充成功；等待/确认停止再收尾，工具批并行和追加推理仍可能越过。探针未过前budget.concludeOn:false。〔一手〕`P主:6359–6397、6781`、`B:contract.ts:391–405`、`W:393、605`；实现与限制〔推理〕 |
| 原生child观察 | 能，需修状态归属 | collabAgentToolCall.receiverThreadIds/agentsStates及subAgentActivity.agentThreadId/kind → 以threadId为稳定childId，started/ended、parentChildId；completed是活动类型，不能把每次sendInput/wait调用结束都当孩子永久退出。共享支持重开与跨回合条目；先建立身份再冲刷暂存事件。〔一手〕`G:v2/ThreadItem.ts:88–133`、`SubAgentActivityKind.ts:5`、`P主:5872–6115`、`W:911–943` |
| 子权限childId | 能 | 从原审批metadata.threadId与根/已声明子图核对，覆写permissionChildId；保持真正的child发起父轮，不借当前轮；未知线程先核实归属，不能随便当根。〔一手〕`P主:7243–7247、7280–7284`、`W:451、852–855`；落法〔推理〕 |
| childPolicy/清理 | 部分 | 非work拒绝/关闭原生孩子；配置可控上限需按0.163已支持字段验证，不用提示词代替约束。pause/drain/owner按§4.5先停孩子再停父；preempt/watchdog只停父，hard_limit应明确处理规则；close终止整组。Paseo原interrupt只操作根线程，子turnId/终端要补收集。〔一手〕`D:architecture/modules/01-agent-cli.md:196–204`、`P主:5061–5067、5120–5122`；〔推理〕 |
| 子用量同连接⑪ | 未实测，不能承诺 | 通知有threadId说明能区分，不说明订阅一定收到所有子线程。Paseo还主动丢child token通知。先移除过滤、记录每线程total基线；A3核验同连接是否收到、父total是否已含子、跨父轮后台孩子如何计费。未观测就报缺项，不能“没收到=0”。〔一手〕`G:v2/ThreadTokenUsageUpdatedNotification.ts:6`、`P主:5671–5722`；〔推理〕 |
| tokens/context/quota/balances | 能映射，金额与统计口径须谨慎 | total差量用于消费，last可作上下文线索；cacheRead/cacheWrite分别取字段，reasoningOutput不另加到output；rateLimits按limitId+primary/secondary映射百分比、分钟、秒时间戳→ISO，credits有限数字才映射。不把账号额度窗口相加成会话token或美元。〔一手〕`G:v2/TokenUsageBreakdown.ts:5`、`ThreadTokenUsage.ts:6`、`RateLimitSnapshot.ts:10–18`、`RateLimitWindow.ts:5`；`B:contract.ts:245–271`；落法〔推理〕 |
| 图片输入 | 能 | TurnInput.image.blob经launch.readBlob→toPaseoPrompt；Codex支持image URL/fileId/localImage。若沿Paseo落临时图片，应改到会话dataDir并随删除清理，失败大声返回，不变成一句“图写入失败”的文本继续执行。〔一手〕`G:v2/UserInput.ts:7–11`、`P主:3271–3306`、`B:provider.ts:40–49`；〔推理〕 |
| 内核MCP | 能 | config.mcp_servers支持stdio和HTTP；Paseo把headers→http_headers；内核HTTP端点含当代token，始终回toolport，不搬Paseo自管agent工具。SSE不能默认装作HTTP支持；alwaysLoad需本版确证或拒绝。〔一手〕`P主:912–935、5577–5585`；`B:contract.ts:119–142`；〔推理〕 |
| ephemeral一次性 | 能，策略入口待定 | thread/start.ephemeral:true；不是“整进程不写任何文件”，配置/认证/缓存仍会写；不可恢复，persistence=null。V1只work，设计“整理”由Codex执行与only-work范围冲突，应去掉此例或另定能力范围。查资料与干活当前同mindKind，不能猜。〔一手〕`G:v2/ThreadStartParams.ts:44`、`P主:5563、7523`；`B:contract.ts:35、149`；〔推理〕 |

### 4.2 答案不能先拼字符串再拆

建议在新包严格源码中写Codex问答codec，Paseo迁入文件只接线；沿用当前permissionAnswerInput扩展点。输入按稳定question.id取 `{selected:string[],custom?:string}`；转换为原生 `answers[id] = {answers:[...]}` 时选项逐个保留，绝不按header找、split(',')或trim改用户答案。**不对无答案请求默认选第一项**；编码失败保持pending，让主人重答。〔一手〕`W:309–318、475–480、1031–1041`；原缺陷`P主:1364–1398、4734–4786`；方案〔推理〕。

**isOther是问题侧的“其他选项”开关，不是答案侧字段，也不等于是否允许notes。** 官方0.163 TUI在isOther=true且有选项时追加 `None of the above`，选它就发送该标签；补充文字另外以 `user_note: <文字>` 作为一个数组元素追加。因此推荐新包的permissionQuestions在isOther=true时补这个原生语义选项（中文展示可放说明），codec把selected按顺序发送、custom编码成独立user_note元素；isOther=false只不追加该选项，**不能因此拒绝正常选项的补充说明**。纯Other回答可发None of the above＋user_note，不选任何选项的纯notes也应明确按原生客户端行为验证。公共questions已有options和custom，不必为Other另加公共API。〔二手〕[官方TUI request_user_input](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tui/src/bottom_pane/request_user_input/mod.rs#L733) `:65、733–763、867–899`；方案〔推理〕。

例：选项 `A, B` 加补充 `保留, 两项`，应是 `answers[id].answers = ["A, B", "user_note: 保留, 两项"]`，不能变成三四个选项。若沿遗留multiSelect路径收多项，则同样一项一个元素再附notes，不用逗号反解析。原生schema没有multiSelect；官方工具spec要求2–3个互斥选项，并在normalize时强制is_other=true、拒绝空options。因此当前真CLI验收应覆盖“单选＋Other/notes”及独立异步自由文本，**不能让假CLI凭空发multiSelect来证明真CLI支持多选**。testkit通用answers场景包含多选，可标明该场景原生不支持，另补可表达的wire矩阵；这不等于放弃逗号和selected/custom的无损编码。〔一手〕`G:v2/ToolRequestUserInputQuestion.ts:9`、`ToolRequestUserInputAnswer.ts:8`、`L:packages/test-support/brain-testkit/src/contract.ts:25–34、120–129`；〔二手〕[request_user_input_spec.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/tools/handlers/request_user_input_spec.rs#L105) `:35、105–120`；方案〔推理〕。

isSecret不能仅丢字段后照普通问题展示/存日志；V1若不做通用秘密输入通道就明确拒绝此类请求。异步questions是另一种协议（agentMessage.questions，通常自由文本），Paseo会组后续prompt并返回followUpPrompt；应结构化编码到完整文本/块，保留答案边界，补§6的会话生命周期。〔一手〕`P:packages/server/src/server/agent/providers/codex/async-questions.ts:105–134`、`P主:4817–4841`；〔推理〕。

### 4.3 用量和收尾需要约定的边界

不要复用Paseo的latestUsage作为整轮消耗：它来自tokenUsage.last。一个Codex turn可含多次模型请求；正确实现应保存每线程已观测total的基线/游标，续接时不把历史累计再算一遍，对重复通知不重复累加。父total是否包括子线程，必须拿A3的父+子受控场景核实；确定总量后子分项仅作归因，不能再把child.ended加一遍。后台孩子跨轮的消费与取消/失败消费不能无主，当前公共层的缺口见G1/G3。〔一手〕`P主:1080–1096、6393–6397、6455–6464`、`B:session.ts:473–500、554–567`；口径方案〔推理〕。

`concludeOn`成功账本必须关联本代、原生thread、turn、callId；只认成功结果（MCP的isError、外层工具status都应核对），重放的历史工具、失败工具或子线程同名工具不能结束父轮。就算成功后中断再映射为completed，也只能承诺“中断确认后停稳”，不能凭通知证明下一次模型请求从未开始。这点与设计#40相同，仍是探针结果决定Meta。〔一手〕`B:contract.ts:173–174、391–405`；`G:v2/ThreadItem.ts`；〔推理〕。

### 4.4 Meta草案（能力保守版，待A3兑现）

```ts
{
  streaming: true,
  resume: true,
  nativeTools: true,
  permissionHook: true,
  rollback: false,
  modelSwitch: true,
  modeSwitch: true,
  delivery: { nextStep: true, nextTurn: false, cancelKeepsQueue: false },
  compaction: 'always_on',
  budget: { inferences: false, toolCalls: false, concludeOn: false },
  usage: 'full',
  personaInjection: { instance: 'developer_instructions', work: 'developer_instructions' },
  runtime: 'subprocess',
  transport: 'codex-app-server',
  kernelTools: ['mcp-http', 'mcp-stdio'],
  binary: { command: 'codex', minVersion: '0.163.0' },
  children: { native: 'observe', crossCli: true }
}
```

该草案是**实现并验收后的目标声明**，不是给当前不存在的包背书：usage:'full'指能上报token和账号额度两类信息，不代表每种认证都有quota、或未知支出已补齐；若实现阶段只接token，先写tokens。concludeOn探针成功且主人接受中断式语义后才置true；无可靠禁压缩开关就保持always_on。children.observe包括生命周期与归属，缺失的分项usage必须留空。crossCli:true只表示可挂内核spawn MCP，当前公共openChildTask尚未实现，不能因此说跨CLI子活已跑通。V1在create/resume显式拒绝非work、nativeToolPolicy:none、compaction:off以及无法兑现的严格kernel原生审批请求。〔一手〕Meta schema `B:contract.ts:49–84`、`B:index.ts:382` 的openChildTask拒绝；各字段事实见4.1；取值与拒绝策略〔推理〕。

## 5. 配置隔离与登录

**CODEX_HOME 能隔开 Codex 的用户配置和凭据身份，但不能单独证明“只读灵鲸配置”。隔离以后不会自动继承主人原来已登录的账号；必须另外建立受管理的登录身份或显式提供 API 认证。** 本次没有读取任何真实配置、auth.json、钥匙串或会话目录。〔一手〕`P主:647–648、3586`、`G:v2/LoginAccountParams.ts:6–22`；凭据位置以下标〔二手〕官方依据。

本节补充官方资料：页面抓取于2026-11-05，保存在T:；另读取官方 `openai/codex` 的 `rust-v0.163.0` 标签源码，落在T:内的 `official-<路径以__连接>`。这些是**官方外部资料〔二手〕，不是本机CLI实测**；本机CLI生成协议证明参数形状，不证明内部文件搜索实现。外部版本源码仍需A3文件访问验收。

### 5.1 凭据从哪来

| 事实 | 结论 | 依据 |
| --- | --- | --- |
| ChatGPT登录 | 官方支持浏览器登录、device code；返回OAuth访问/刷新凭据，由Codex管理刷新，不由Paseo适配器实现登录 | 〔一手〕`T:login-help.txt`、`G:v2/LoginAccountParams.ts:6`；〔二手〕[官方认证文档](https://developers.openai.com/codex/auth)，`T:auth.txt:917–927` |
| file存储 | auth.json 位于 **CODEX_HOME/auth.json**；换成新成员目录就是另一份空身份；不要从默认目录复制/软链真实auth | 〔二手〕官方认证文档；[0.163 storage.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/login/src/auth/storage.rs#L162) `:162–163、191–218`；推荐〔推理〕 |
| keyring存储 | 同一系统钥匙串服务不等于同一个登录槽。0.163直接后端按规范化CODEX_HOME路径哈希生成key，secrets后端同样按home创建命名空间；换根后不能假定旧登录还在 | 〔二手〕同上 storage.rs `:243–256、364–377`。只读源码，没查实际钥匙串 |
| auto与ephemeral认证存储 | auto有keyring→file回退，位置不够直观；ephemeral只保留本进程内存。它与thread/start.ephemeral是两个不同开关 | 〔二手〕`T:auth.txt:921–927`；storage.rs `:478–524`；〔一手〕`G:v2/ThreadStartParams.ts:44` |
| API Key | CLI提供 login --with-api-key 从stdin读；app-server协议有 account/login/start {type:apiKey,apiKey}；自定义provider可用env_key指定进程变量 | 〔一手〕`T:login-help.txt`、`G:v2/LoginAccountParams.ts:6`；`P主:3381–3388` |
| OPENAI_API_KEY单独放环境 | **不要假定所有官方ChatGPT/默认openai流程都会因此切成API模式**。采用明确认证路径：隔离home内API登录，或显式自定义provider env_key；失败报告auth，不悄悄回退另一账号 | 〔一手〕CLI help只承诺stdin登录，协议显式apiKey；〔二手〕`T:auth.txt:999–1002`；结论〔推理〕 |
| 客户端托管ChatGPT tokens | account/login/start支持chatgptAuthTokens，另有account/chatgptAuthTokens/refresh请求；这意味着主机要承担续期与账号生命周期 | 〔一手〕`G:v2/LoginAccountParams.ts:6–22`、`G:ServerRequest.ts:20`；V1不推荐自己做凭据代理〔推理〕 |

**推荐按用户选择的计费方式分支，不替主人选订阅或API。** 若用ChatGPT订阅，主人在固定的灵鲸Codex home完成一次独立登录，显式选keyring（独立命名空间；要验服务环境可用）或file（目录0700/文件0600、只在成员数据根）。若用API/中转，提供方配置只存env变量名和provider定义，值由后续受管凭据入口注入子进程；不要写入日志、ResumeHandle、仓库或命令参数原文。〔一手〕`B:process.ts:214–232`、`W:1046–1055`；推荐〔推理〕。

| 方案 | 代价/限制 | 推荐 |
| --- | --- | --- |
| 独立CODEX_HOME＋独立ChatGPT登录 | 每个认证根要登录；刷新由CLI负责；仍消耗同一账户额度 | 订阅路线首选；稳定根不可随会话随机改。〔二手〕认证存储与刷新；〔推理〕 |
| 独立CODEX_HOME＋专用API Key/中转 | API另外计费；需明确responses兼容、模型catalog、错误与额度可见性 | API路线首选，也适合可控验收。〔一手〕`P主:3381–3388`；〔推理〕 |
| 复制/软链主人默认auth或整个home | 破坏已定隔离；刷新竞争；删除成员/会话时可能误碰主人凭据 | 不采用。〔一手〕`D:architecture/modules/01-agent-cli.md:211、220、330`；风险〔推理〕 |
| 灵鲸OAuth代理，每进程注入短期token | 需新做登录、刷新、并发协调、退出登录、安全存储 | V1不推荐，协议具备不等于工程免费。〔一手〕`G:ServerRequest.ts:20`；〔推理〕 |

配置“CLI只读”必须理解为**不让CLI修改灵鲸生成的配置/规则**，不能把整个CODEX_HOME chmod只读：CLI还要写认证刷新、会话/索引/运行缓存。禁止读取主人目录与禁止写自己的状态是两件事。应保护配置文件归属，同时允许独立状态目录写入；不能用每次生成配置把auth、sessions、数据库一起删掉。〔二手〕官方认证文档刷新说明；〔一手〕`B:provider.ts:149–171`；判断〔推理〕。

### 5.2 自定义model_provider

Paseo会把OPENAI_BASE_URL规范化到/v1并生成 `model_provider="paseo:<id>"`、`model_providers.<id>{name,base_url,wire_api:"responses",env_key:"OPENAI_API_KEY",requires_openai_auth:false}`。灵鲸应在新包里改成自己的命名/经校验Config，**base_url显式给完整端点，不盲目拼/v1**；模型由config.model或CLI默认解析，不把provider名当模型名。只有真responses兼容中转才能直接用；chat/completions-only不满足。〔一手〕`P主:3349–3399`；`G:v2/ThreadStartParams.ts:18、36`；推荐〔推理〕。

`requires_openai_auth=true`与env_key不是任选一个同时生效：官方说明true时使用OpenAI身份，忽略env_key。因此推荐API中转显式false，订阅代理另明确认证路线；不要复制Paseo“没检测到key就不写认证规则”的隐式行为。模型服务地址/凭据名是提供方插件配置，SessionConfig.env只补允许的显式项；保留mergeLaunchEnv的同名冲突失败。〔二手〕`T:auth.txt:999–1002`、[配置参考](https://developers.openai.com/codex/config-reference)；〔一手〕`P主:3386–3389`、`B:process.ts:223`；推荐〔推理〕。

MCP token不能写进同成员共用的config.toml后让多个会话竞争：基础文件放稳定成员配置，每个进程/线程用自己的启动覆盖或thread/start/resume.config.mcp_servers传当代端点与令牌。动态model、projectDocs、permission等同样按会话覆盖；rules/skills更新要串行/原子化，不能用replaceSkills的先删后拷与活会话读取竞速。〔一手〕`B:config-dir/shared.ts:36–48、56–63`、`P主:5571–5585`、`B:provider.ts:149–151`；风险与落法〔推理〕。

### 5.3 project_doc_max_bytes=0到底管什么

| 问题 | 判断 | 依据 |
| --- | --- | --- |
| 自动注入仓库AGENTS.md | **0.163官方实现里确实关闭**：remaining==0在遍历前break；read_agents_md(max_total=0)在发现路径/读文件前返回 | 〔二手〕[agents_md.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/agents_md.rs#L58) `:63–85、125–150`；本机未实测 |
| 会不会连灵鲸home的AGENTS.md也关掉 | 该版官方实现先加载home用户指令，再加载项目指令；0限制针对后者，home指令不依赖这个计数 | 〔二手〕同文件`:63`；[codex-home instructions](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/codex-home/src/instructions/mod.rs#L40) `:40–66`；需A3哨兵验证 |
| 能否阻止模型后来主动cat仓库AGENTS.md | **不能**。这是自动加载开关，原生读文件/命令仍在；严格不读取需要文件访问策略，不能靠提示词/字节上限 | 〔一手〕`G:v2/ThreadItem.ts:34`、`P主:325–345`；结论〔推理〕 |
| true时必读吗 | 不是。0.163官方实现对untrusted项目提前返回；所以新隔离home没有信任记录时，不能直接宣称读取成功 | 〔二手〕agents_md.rs`:64–65`；判断〔推理〕 |
| 能否顺便隔离项目config/skills/hooks | **不能**。project_doc_max_bytes只控制文档；配置层与skills扫描有独立路径 | 〔二手〕[config loader local.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/loader/local.rs#L118) `:118–201`；[skills host_roots.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/ext/skills/src/host_roots.rs#L80) `:80–118、138–172` |

### 5.4 CODEX_HOME之外仍可能读到什么

0.163官方源码还发现用户HOME/.agents/skills、项目祖先的.agents/skills、受信项目.codex配置层、系统配置/管理层及其skills；CODEX_HOME/skills仍支持，但被注释为deprecated旧位置。故“HOME不变，只设CODEX_HOME”仍可能把主人全局本事带进来；把项目标trusted来读AGENTS.md，也会打开项目配置层。此次只读这些搜索算法，没访问任何实际目录。〔二手〕host_roots.rs`:95–118、138–172`；local.rs`:118–201`；[官方配置参考](https://developers.openai.com/codex/config-reference)，`T:config-reference.txt:854、1426–1431`。

| 隔离方案 | 能证明什么／缺什么 | 推荐 |
| --- | --- | --- |
| 只设CODEX_HOME | 隔开用户config/auth/sessions；隔不掉HOME/.agents、项目与系统层 | 不足以验收设计“只读灵鲸配置”。〔二手〕上列源码；〔推理〕 |
| 受管CODEX_HOME＋隔离HOME＋显式配置/功能来源 | 可隔开个人home技能，保留独立登录；仍须验证macOS home解析、项目skills、插件/系统配置不会混入；不能只看写入路径 | 建议作为首个隔离探针；不承诺设置变量就全部解决。〔二手〕host_roots.rs`:35–41、103`；〔推理〕 |
| 项目保持untrusted，灵鲸受控读项目AGENTS并注入developerInstructions | 把“项目文档事实”和“项目可执行配置”分开；要定义子目录继承和禁止覆盖人设；项目skills独立扫描仍需关闭/限制 | 推荐评审方向，**改变现设计的原生自动读法，须主人确认**。〔二手〕agents_md.rs`:64`、host_roots.rs`:138`；〔一手〕`G:v2/ThreadStartParams.ts:36`；〔推理〕 |
| 要求严格文件级零读取全部外部配置 | 需要本版可验证的来源禁用能力或进程文件系统隔离，单靠现有字段没有证明 | 若主人坚持此强定义，隔离探针失败就阻塞验收；不能悄悄改成“读了但没生效”。〔推理〕 |

与01报告一致：配置根隔离、凭据隔离、项目文档与可执行配置隔离、计费隔离要分别验证；同一账号不会因为换目录得到独立额度。本报告补充Codex独有的HOME/.agents/skills搜索和项目untrusted不自动读AGENTS的行为。规矩应作为developerInstructions中的明确优先约束，不能仅靠home AGENTS第一行口号保证项目文档不覆盖。〔二手〕[AGENTS指南](https://developers.openai.com/codex/guides/agents-md)，`T:agents-md.txt:782–785`；〔推理〕。

## 6. 公共层改动

**不是“无”：新增提供方的装配、配置分发、进程托管、普通权限和结构化答案都不用重做；但兑现设计预算兜底并完整保留当前 Codex/Paseo 行为时，有四个具体缺口。** 上次07的结论限于当轮N1–N3和已列能力，本次发现不否定已修复问题。〔一手〕`参考-第1-2步记录/07-Codex复核-第二轮修复.md:101–115`；以下代码对照；结论〔推理〕。

| 项目 | 当前事实 | 最小建议／影响 |
| --- | --- | --- |
| **G1：失败／取消回合用量** | completed 才累加 tokens；failed/interrupted 没 usage；usage.update 经 latestOnly 不计 tokens/inferences。Codex 中途已经花了的钱，取消后 usage() 看不到 | 给两种失败终止事件加可选 usage，ManagedBrainSession 按 turnId 只结算一次；共享映射存在此值时透传，新包提供已观测消费。不能伪装 completed，也不能累加所有累计快照。影响 brain契约/session、shared可选透传、testkit；ACP/DeepSeek原调用兼容但须回归。〔一手〕`B:contract.ts:397–405、487`、`B:session.ts:473–494`；〔推理〕。**与01报告§6一致** |
| **G2：跨回合的原生问题／计划审批** | Codex async question 是会话级，父回合可以先结束；Paseo plan也在 turn_completed 前发合成审批。公共Managed层在endTurn删除所有父请求；共享层对无活动回合的父请求直接拒绝，respondToPermission还丢掉Paseo返回的followUpPrompt | 若完整迁移，给permission.request增加可选生命周期标记（例如 lifetime:'session'，默认仍turn），允许会话级请求在idle存在，终止时只清turn类；答复仍用同一接口。Codex包消费followUpPrompt，明确排队/启动后续回合，不能把响应成功当后续已执行；状态随第3步会话记录持久化。影响brain schema/session、shared及testkit。若主人明确延期异步问答与Paseo计划审批，则不补此口，但必须关闭/拒绝相应能力，不能写“已迁完整问答”。〔一手〕`P:packages/server/src/server/agent/providers/codex/async-questions.ts:75–154`、`P主:4817–4841、6390–6397`、`W:852–859、1035–1042`、`B:session.ts:529–536、658–679`；〔推理〕 |
| **G3：子线程实时用量的childId** | usage.update没有childId；只有child.ended能把childId写到brain_usage。故可在孩子结束时补分项，但不能原样做到设计⑪“每条子线程tokenUsage通知带childId写brain_usage” | 给usage.update加可选childId，ManagedBrainSession写usageRecord时透传；标明update是观测快照，不能再与turn/child终值相加。分项结算和父活总量唯一归属另按§4确定。影响brain schema/session、子项测试；现有提供方不带字段行为不变。若只验“结束时分项”可暂不改，须由主人接受收窄。〔一手〕`B:contract.ts:487、502`、`B:session.ts:491–500、554–579`；`D:architecture/modules/01-agent-cli.md:178、202`；〔推理〕 |
| **G4：公共回合看门狗尚未落实** | `watchdogMs`目前只在brain契约和brain-cli组装配置出现；ManagedBrainSession的setTimeout用于单次API等待，startTurn确认后没有按limits.watchdogMs监听整轮。不能用“公共看门狗兜底”代替缺失实现 | 不改API，按已定职责在ManagedBrainSession对每轮启动有归属的定时器，terminal/close清除，只取消捕获的那一轮；超时走cancel(watchdog)，取消失败仍stopping，不能碰后起的新轮。影响所有提供方行为，须单独回归；若第3步已有落实则复用同一处，不再写Codex私有定时器。〔一手〕`B:contract.ts:168–171`、`B:session.ts:205–218、467–481、610–654`；全目录rg仅命中声明，`L:packages/bundle/brain-cli/src/index.ts:38、46、83`；最小改法〔推理〕 |
| isOther / isSecret展示 | 公共questions没有这两个字段，但args仍能保留原始事实，提供方permissionAnswerInput可按原请求验证 | **不构成接普通问答的强制API改动**。Other可由提供方permissionQuestions补进options，notes仍用custom；isSecret先明确不接。只有要通用密码输入时才另加可选secret语义，不让第3步硬编码Codex协议。〔一手〕`B:contract.ts:302–321`、`W:475`、`G:v2/ToolRequestUserInputQuestion.ts:9`；〔推理〕 |
| ephemeral逐会话选择 | SessionConfig没有持久性字段；现有provider工厂能自行给persistSession:false，但mindKind只有work，无法区分“干活”与“查资料” | 固定提供方配置可实现一种默认值；若调用方要每会话选择，建议未来加可选通用持久性项，或显式配置不同提供方实例。不能按concludeOn/提示词猜查资料。此项需要主人定产品范围，非阻塞所有V1工作会话。〔一手〕`B:contract.ts:149–192`；`P主:7496–7523`；〔推理〕 |
| 其余公共扩展点 | sessionHome/writeMemberConfig、env冲突、图片blob reader、mode/model、permissionOptions/AnswerInput/ChildId、decorate/turnUsage/childUsage、interruptTurn均已具备 | 在Codex包实现，不加codex名字switch；不迁重复进程服务/第二套会话接口；quota/balances无需新schema。〔一手〕`B:provider.ts:43–49、127–144、158–192`、`B:process.ts:223`、`W:393–568` |

**G3还需由⑪决定一项结算细节**：当前views明确约定child只是已包含在turn总量里的分项；若Codex后台孩子在父terminal后继续花费，而父total又不含它，仅加childId仍不足以让usage()累计完整。最小后续补法是在usage.update增加可选且明确的“新增消费delta”标记并按线程/结算游标去重，只有未被turn计入的增量可进入总计；旧snapshot默认不累加。先测总量口径再定字段，不伪造第二个completed、不借下一轮归账。〔一手〕`B:views.ts:124–125`、`B:session.ts:491–494、554–567`；条件判断与补法〔推理〕。

G1建议先作为两家共用的小修单独评审；G4落实已有看门狗职责，不新增Codex专属机制；G2、G3由本次明确的Codex行为驱动，范围与01报告不同，**这里明确列为新增差异，不声称01已经同意**。特别是G2不能用“把异步问题伪装成子agent”或“不报原生turn.completed”绕过；那会破坏事实与生命周期契约。〔一手〕`B:contract.ts:378–386`；〔推理〕。

这里只评估最小修改面，未修改任何代码/设计。若采用上述补口，旧提供方需跑已有三类契约，覆盖终止去重、pending清理、子更新与最终用量不重算；新字段不得成为旧提供方的必填项。〔推理〕。

## 7. 对第 3 步的约束

仅列能力加入后必须满足的边界，不给常驻服务架构/迁移方案。与01报告2026-11-05读取版本的§6–7（403行时的稿件）对齐；它仍可能更新，本文不修改其文件。〔一手〕`01-交回-Claude适配评估.md:287–325`；以下约束〔推理〕。

| 操作/主题 | 对第3步的约束 | 依据 |
| --- | --- | --- |
| start / run：运行时归属 | 常驻宿主持有BrainSession及Cordis owner context、app-server管道、RPC关联表、pending审批；一次性终端命令退出/attach断开不能释放会话。每个会话一个受管app-server，不连Codex共享daemon | 〔一手〕`B:provider.ts:38–49`、`B:session.ts:420–454`；`T:daemon-help.txt` |
| provider / probe | 可执行文件解析、版本、是否安装与是否已认证分开；默认probe只做无模型请求检查，不启动真实任务/扫个人home。带有model/provider认证的诊断只在选定隔离身份中做 | 〔一手〕`B:provider.ts:60–68`、`P主:647、7761`；〔推理〕 |
| ls / status / inspect | 必须区别主回合idle、仍有原生孩子/后台终端、待权限/异步问题、stopping、进程退出；“已回复”不等于“所有后台工作已结束” | 〔一手〕`P主:5092–5117`、`W:1059–1062`；`B:views.ts` |
| 续接句柄 | 只有persistence非null才可承诺续接；保存原生threadId及impl、home、cwd、代次关联，不能以灵鲸session id替代。首次turn之前可能没有可续接句柄；ephemeral永远没有 | 〔一手〕`P主:4957–4989、6349`、`P:docs/providers.md:510`；`B:contract.ts:202` |
| 恢复配置 | resume必须给完整新代cfg；旧句柄不能保存/复用MCP token、API Key、systemPrompt整份metadata。模型/模式的选择、规则版本和异步问题状态需在正确的宿主记录中有归属 | 〔一手〕`B:provider.ts:186–192`、`W:1046–1055`、`P主:4970–4981`；〔推理〕 |
| logs / attach | 从灵鲸自己的事件记录回放并带游标/代次；订阅仅自建立时开始，不能把先拉快照再订阅之间的事件丢掉；同一条消息/child事件不重放两次。原生历史只服务resume/子观察，不是灵鲸日志真相 | 〔一手〕`B:session.ts:813–833`、`D:architecture/modules/01-agent-cli.md:12、233、383` |
| 转录位置 | 稳定成员CODEX_HOME包含该成员多会话的原生运行状态；不要仅假设sessions/**/*.jsonl就是全部数据。0.163有legacy/paginated历史与thread元数据，应保存返回的原生路径/历史模式等非秘密定位事实，尊重其索引归属 | 〔一手〕`G:v2/ThreadResumeParams.ts:66–78`、`G:v2/Thread.ts:16`；`P:packages/server/src/server/agent/providers/codex/thread-history.ts:74–98`；〔推理〕 |
| send / 排队 | nextStep带expectedTurnId，只有明确unavailable才允许上层另择策略；超时/传输失败是结果不明，不自动重送。Meta.nextTurn=false时宿主只在空闲边界startTurn；不用turn/start忙时隐式steer替代next_turn | 〔一手〕`G:v2/TurnSteerParams.ts:23–26`、`P主:4473–4524`、`B:session.ts:611–635` |
| wait | 权限请求/异步问题是等待人，不是任务终止；默认等待前台回合还是包含原生孩子必须明示；wait命令超时不隐式stop，也不默认替用户答问题 | 〔一手〕`P:docs/agent-lifecycle.md:106–117、179`；`P:packages/server/src/server/agent/providers/codex/async-questions.ts:75`；〔推理〕 |
| permit | session+generation+requestId唯一定位；RPC id要保留string/number原型；pending在宿主，答复成功才删。子审批带childId和调用事实，父agent不能代批；会话允许的范围是CLI该请求原生语义，不是所有工具永久允许 | 〔一手〕`G:RequestId.ts`、`B:session.ts:658–679`、`P主:7203–7289`；〔推理〕 |
| 异步问题/计划审批 | 第3步pending不能只依附activeTurn；G2补口后在idle仍可答，答复需要后续轮时必须经过正常投递/准入；重启后已失效RPC不能伪装可响应。要恢复语义问题用宿主状态/原生历史重建，不能持久化Promise | 〔一手〕`P主:4817–4841、6390`、`P:packages/server/src/server/agent/providers/codex/async-questions.ts:152`；〔推理〕 |
| stop / restart | 捕获当前turn，撤未读输入、按原因处置孩子与后台终端，失败保持stopping，不假报停稳；一次后续新回合不能被旧取消/旧定时器收尾。正常restart先停止/关组；kill-9后清孤儿需要持久进程出生身份，当前内存process view不够 | 〔一手〕`B:session.ts:639–654`、`P主:5025–5248`、`B:views.ts`、`B:session.ts:424–434`；〔推理〕 |
| 预算/看门狗 | 必须读Meta里的false并展示/拒绝无法满足的硬预算；G4补公共watchdog后再承诺兜底，不能把handshakeMs/callMs当整轮时限。原生后台孩子是否受独立时限约束按设计§4.5与后续guard明确，不能悄悄放无限运行 | 〔一手〕`B:contract.ts:63–64、168–171`、`B:session.ts:205–218、621`；〔推理〕 |
| usage | 记录turn/update/child来源；账号额度窗口是快照，token是消费；G1取消/失败结算与G3 childId不可丢；不得把父总量、子分项和累计通知一起相加。计费方式不同也不伪造余额 | 〔一手〕`B:session.ts:473–500、554–579`；`G:v2/ThreadTokenUsage.ts:6` |
| archive / delete | archive是逻辑归档，保留恢复材料；delete先停稳，再删确切线程/孩子资料和灵鲸日志。不能rm整个成员CODEX_HOME，否则同成员会话、登录、配置一并被删。Codex原生archive/delete若要调用，归提供方受管操作，不复制Paseo额外无归属app-server | 〔一手〕`P主:7721–7755`、`G:ClientRequest.ts` thread/archive/delete；`B:provider.ts:149–151`；〔推理〕 |
| 闲置回收 | 必须征求canStopRuntime；错误/超时/未知就是不可回收；不仅看父回合idle，还看孩子、后台终端与pending。关闭运行时只保留可续接状态，不保证异步RPC能跨进程继续 | 〔一手〕`P主:5092–5117`、`P:docs/agent-lifecycle.md:60–80` |
| 同成员并发配置 | 稳定配置/认证根与每会话参数分开；MCP token/projectDocs/model/沙箱不能靠改共享config.toml最后写入者覆盖；读规则/skills时不能撞上先删后拷 | 〔一手〕`B:provider.ts:149–171`、`B:config-dir/shared.ts:36–48`；〔推理〕 |

与01一致的共性：进程归常驻宿主、日志与原生转录分工、有效resume句柄、审批挂起、未知停止不接受新工作、凭据与配置分别隔离、失败用量小补口。明确不同/新增：Codex有原生threadId和后台终端，支持ephemeral但无现成逐会话选择字段；异步问答/计划审批触发G2；子实时用量触发G3；本次还核出共用G4未实现。第3步不能用Codex daemon代替灵鲸宿主。〔一手〕01报告`:289–325`及以上证据；〔推理〕。

## 8. 测试与验收

### 8.1 本次做了什么、没有做什么

已执行仅限只读命令：git status/rev-parse、读源码/文档、行数/导入统计、本机codex --version与允许的--help、generate-json-schema（稳定/实验各一份）和generate-ts（实验全集）。临时证据全部在 `T:`，唯一交回产物就是本文件。没有启动app-server本体/daemon/exec，没有跑测试或build，没有生成实际会话；未读~/.codex、~/.claude、~/.paseo、钥匙串、~/.liwa、~/.dsh或指定旧App。按本任务较新硬规则，跳过需要读取禁用个人目录的全局规则/技能文件，遵守任务书与仓库已明示原则。〔一手〕本次执行范围。

### 8.2 实施后的无额度测试

**主线用“真实brain-codex适配器＋可执行的假app-server CLI”；录制回放作协议回归补充。** 不能只跑ScriptedBrainProvider，也不能把Paseo内存FakeChildProcess当成已验证进程归属。契约入口实际叫 `describeBrainProviderContract`，来自brain-testkit。〔一手〕`L:packages/test-support/brain-testkit/src/contract.ts:159` 导出；`P:packages/server/src/server/agent/providers/codex/test-utils/fake-app-server.ts:1`；选择〔推理〕。

| 层次 | 验收内容 | 能/不能证明 |
| --- | --- | --- |
| 纯codec/配置单测 | question id、带逗号选项/自由文本、isOther开关与独立user_note、单选＋custom、无答案不默认第一项、isSecret拒绝；acceptForSession、availableDecisions、未知optionId拒绝；MCP配置、env冲突、只写所需配置、不泄漏resume metadata | 证明自己的编码与边界；不能证明CLI真的按配置加载。〔一手〕`W:475、1031`、`P主:1364、4774`；〔推理〕 |
| 生成schema夹具校验 | 假CLI收到initialize/start/resume/steer/approval回复时，用0.163生成schema验证；发出的通知也校验。稳定/实验区分，string RPC id、isBlocking、cacheWrite、subAgentActivity全部覆盖 | 防止假协议自洽；不把旧multiSelect造进当前官方schema。〔一手〕`G:ClientRequest.ts`、`ServerRequest.ts`、`ServerNotification.ts`；〔推理〕 |
| 公共契约 | 新包通过describeBrainProviderContract；sessionConfig用work、compaction:provider；验证流式、普通审批/取消/未知选项、续接、图片、模型/模式、child审批事实、跨回合孩子、idle退出、close | 对原生无法表达的answers组合写明unsupported，并增加可表达矩阵；不靠放宽断言宣称兼容。〔一手〕testkit`:25–76、86–129`；〔推理〕 |
| 进程/传输 | 真的Node假CLI经launch.spawn运行，partial JSONL/Unicode/大行/坏帧/EOF/EPIPE、初始化失败、stderr限额、挂住、超时、close后无进程残留、握手与子请求并发 | 验证真实管道和归属；无模型、无费用。〔一手〕`P:packages/server/src/server/agent/providers/codex/app-server-transport.test.ts:1`；`B:process.ts:181`；〔推理〕 |
| 竞态 | steer在native turn id宣布前；cancel后立刻开新轮；旧终止/重复通知；权限等待时新输入；后台孩子先发事件后宣布身份；失败重答；stop期间新增终端；G4旧timer不取消新轮 | 必须验证外部可见效果及pending集合，不仅检查函数调用次数。〔一手〕`P主:4473、5025、5120`、`W:710`；〔推理〕 |
| 用量 | 多次model响应的total/last、重复更新、续接基线、cacheWrite、父子是否重算、失败/取消、孩子跨父轮结束、额度秒→ISO、null字段不补0 | 证明选定口径，不代替⑪同连接真实通知验证；G1/G3要跑旧三提供方契约回归。〔一手〕`G:v2/ThreadTokenUsage.ts:6`、`TokenUsageBreakdown.ts:5`、`B:session.ts:473`；〔推理〕 |
| 配置污染夹具 | 在临时假HOME/CODEX_HOME和测试仓库放互异sentinel，覆盖用户/.agents、项目.codex、项目AGENTS、skills、MCP；检查spawn/config、无需真实个人路径 | 假CLI只能验入参；真实加载与信任层必须留到A3。〔二手〕§5官方搜索算法；〔推理〕 |
| 脱敏回放 | 后续授权A3采集必要原生帧，去key/token/内容敏感信息后进入测试夹具，补不同通知顺序/版本 | 只回放公开可审的合成/脱敏帧；原始对话日志不进公开仓库。〔一手〕L:AGENTS.md公开仓库规则；〔推理〕 |

可另做“真0.163 CLI＋本地假Responses服务”的受控无额度测试，以验证原生tool loop/配置/中断，**但本任务没启动它**，未来必须确保服务端点及模型catalog固定本地、没有外部认证/网络回退；它仍不代替真实认证和真实模型的A3。〔一手〕`P:packages/server/src/server/agent/providers/codex-app-server-agent.local.e2e.test.ts:1` 有本地HTTP路径；〔推理〕。

新自写源码按原门槛100%覆盖，迁入src/paseo豁免只限原迁入内容；不把新codec/用量账本塞进去逃检查。实施收尾跑相关test/test:coverage、typecheck/lint、最新build:artifacts后build:check（或build），文档变更跑doc-sync；用户/模型可见输出变更核对对应快照。无需本次只读评估运行这些有写入的检查。〔一手〕L:AGENTS.md检查/技术约定；`L:packages/brain/brain-shared/NOTICE:20–23`。

### 8.3 真CLI A3：需要下一份明确授权

**会消耗额度。** 用ChatGPT登录消耗该账号订阅额度，用API Key/中转按对应规则付费；隔离目录只能隔离数据，不能隔离同一账号的账单。三次模型请求上限也不能由当前Codex原生硬保证；因此先定总测试额度/时间上限与停止负责人，不默认为免费。〔二手〕`T:auth.txt:824、870、879`；协议限制见§4；〔推理〕。

| 阶段 | 前提/操作 | 必须看到的证据 |
| --- | --- | --- |
| 前提 | 主人选认证方案、完成独立测试身份、批准额度；PATH确认为0.163.0；专用临时工作区/隔离home/dataDir；基础装配、公共G1–G4按范围完成；有本地测试HTTP MCP（toolport未实现时只是替身） | 不复制个人凭据、不访问主人会话；保存选定版本/模型/认证类型，不记录值。〔一手〕A3设计`:302`；〔推理〕 |
| 基本回合 | work，workspace-write，developerInstructions+projectDocs哨兵；流式文本+一次受控MCP report | 模型读到规矩/项目事实、report到同一授权MCP、真实token进入brain_usage；替身MCP不宣称完整toolport集成。〔一手〕`D:architecture/modules/01-agent-cli.md:302`；〔推理〕 |
| 权限 | 在专用临时工作区外的另一空目录尝试受控写；分别deny_once、allow_once、allow_session、cancel；子线程再做一次 | 主人看到路径/内容/请求权限及childId；拒绝后文件不写且回合可继续；会话允许只在原生范围生效；cancel确实结束且未读steer不复活。〔一手〕`G:v2/CommandExecutionApprovalDecision.ts:7`；〔推理〕 |
| steer/模型/模式 | 工具受控阻塞时追加steer；错expectedTurnId；下一轮切模型、进入/退出plan | 次步可见、错轮不送、下一轮模型确实改变；plan模式不放宽nativeToolPolicy。〔一手〕`P主:4473`、`G:v2/TurnStartParams.ts:97–136`；〔推理〕 |
| #40收尾/取消清理 | 成功report后中断；对照失败report、人为cancel、并行工具、终端未退出、重复终止 | 成功关联与concludedBy正确；中断确认后无继续工作；额外请求是否发生有原生证据，不强称零越界；终端清理错误不假成功。〔一手〕`P主:151–159、5120–5248`；〔推理〕 |
| ⑪原生孩子 | 根开1个孩子，孩子至少两次响应；根结束后孩子继续；记录同一连接全部threadId/turnId用量和生命周期 | 子usage是否到达、父total是否含子、最终计费不重不漏；能看子权限、owner取消后都停、preempt只停父的真实行为。缺值/缺通知标未知，不能填0。〔一手〕`G:v2/ThreadTokenUsageUpdatedNotification.ts:6`；〔推理〕 |
| ⑤隔离 | true/false各一轮，以假全局、项目settings/hooks/skills/MCP不同哨兵和文件访问审计核实 | project_doc_max_bytes=0不自动读项目；true要兼顾trust；不读取真实禁止目录；不把“没产生新文件”当“没读取”。〔二手〕§5；〔推理〕 |
| 压缩 | 先查有效配置，再另批高成本长上下文探针；没有关闭方案就验off被拒绝和provider压缩事件 | 未验证不能改Meta为switchable；不为省事把阈值拉大当关闭。〔一手〕`G:v2/Config.ts:22`；〔推理〕 |
| 续接/一次性 | 普通线程关闭进程后同home新进程thread/resume；再次带新人设/新MCP；ephemeral单独对照 | 普通恢复成功且句柄不含秘密；ephemeral恢复失败/不提供句柄，明确其余缓存不在“无转录”保证内。〔一手〕`G:v2/ThreadResumeParams.ts:29`、`ThreadStartParams.ts:44`；〔推理〕 |
| 宿主重启 | 正常stop/restart归当前验收；崩溃孤儿/第二层经历流等按既定阶段单列 | 不用一次提供方resume成功冒称全系统崩溃恢复；不启动真实用户的Codex daemon。〔一手〕设计`:290`；〔推理〕 |

登录、真实会话和上述测试都不在本次授权内；本报告只给可评审的验收条件，没有执行或申请扩权。〔一手〕任务书硬规则。

## 9. 工作量与拆分

估计 **12–20个工程人日＋2–3个独立评审人日**，不含第3步常驻宿主、toolport/minds/guard、不含等待主人登录/额度批准、不含压缩压力探针额外成本。输入规模10,131行迁入原文、预计新写严格源码1,500–2,500行、测试4,500–7,000行，公共补口另约200–500行源码及配套回归；不是最终diff行数或工期承诺。〔一手〕§3统计；估计〔推理〕。

| 块 | 可独立交回/评审的内容 | 规模/工时估计 | 可交GLM |
| --- | --- | --- | --- |
| A：来源与包骨架 | 8文件迁入、imports/来源行、NOTICE、exports/tsconfig、现有依赖接线、旧包删除引用清单 | 10,131行机械输入，0.5–1日；不把未接通代码装成默认提供方 | **可以**，给定逐文件清单后做机械迁移/NOTICE；不自主删业务分支。〔推理〕 |
| B：公共补口 | G1失败结算+G4回合watchdog；G2会话权限与G3子用量各自独立小变更；已有3提供方回归 | 约200–500源码行，1.5–3日；可先于Codex独立评审 | 不建议主改；既定测试夹具可。涉及多提供方时序。〔推理〕 |
| C：受管传输与配置/认证 | spawn/transport、版本probe、env隔离、writeMemberConfig、受管home和启动失败清理 | 约400–700新源码行＋vendor定点改，2–3日 | 包manifest/locale/固定schema机械接线可；认证/隔离/关闭逻辑不交。〔推理〕 |
| D：基础会话与契约 | create/resume/start/stream/close、persistence、错误分类、MCP/图片、模型与mode含plan | 约300–500新源码行＋裁迁入主文件，1.5–2.5日 | 工具详情/固定帧映射、已有判别字段确定的测试可；生命周期主逻辑不交。〔推理〕 |
| E：权限与问答 | 会话允许/新权限入口、question codec、isOther/secret范围、异步问题/计划followup与pending | 约250–450新源码行＋vendor接线，1.5–2.5日 | **codec可在输入输出/拒绝矩阵确定后交**；异步pending/续轮不交。〔推理〕 |
| F：孩子/用量/中断 | 子图与turn归属、同连接采集、差量消费/限额、后台终端、按原因取消、闲置否决 | 约400–650新源码行＋vendor修正，2–3.5日 | 数据表/纯限额字段映射可；计量归属和取消主逻辑不交。〔推理〕 |
| G：预算能力/收尾 | false能力拒绝策略、成功调用账本、#40中断式完成、压缩事件与off拒绝 | 约150–250新源码行，1–1.5日 | 不建议。真假完成关系到事实与成本。〔推理〕 |
| H：契约/真CLI/装配验收 | 假stdioCLI与schema夹具、回放、A3授权实测；挂brain profile；删除subagent-codex及@openai/codex0.153.4引用；构建检查/文档 | 1.5–2.5日（各块单测工时已含）；整体组装独立评审 | **引用清理、固定fixture、NOTICE/文档核对可**；真CLI执行必须受额度授权。〔推理〕 |

每块提交给主对话可审的具体结果，按主人顺序实施；这里没有派出agent。B可在第4步/第5步共享一次完成，避免两家重复修。C的隔离探针应在大量业务迁移前做，若严格配置来源无法证明，先回主人定范围，不在后面用“基本可用”掩盖。〔推理〕。

旧subagent-codex整体删包已获设计确认，但实现时必须检查其profiles/bundles/dependency/lock引用，不能只删目录；保留wire.ts中握手、失败分类、ephemeral校验的经验，**不保留第二套一次性提供方**。本任务不执行删除、不更新lockfile、不安装依赖。〔一手〕`D:architecture/modules/01-agent-cli.md:34、173、329`、`L:packages/subagent/subagent-codex/src/wire.ts:264–302`；〔推理〕。

## 10. 风险与待定点

下表为交给主人拍板的推荐，不是本任务替主人修改已确认设计。具体证据已展开于对应节，表内补关键行。〔推理〕。

| 优先级/待定点 | 推荐 | 理由/依据 |
| --- | --- | --- |
| **P0：V1权限语义** | Codex只接work；原生工具由CLI沙箱/原生审批负责，内核MCP由toolport负责；不能保证每个native调用经kernel时，严格kernel请求拒绝。若设计坚持逐调用拦截，先判该范围不可接 | on-request有不经审批的调用；改公共类型也造不出CLI拦截点。〔一手〕`P主:325–345`、`G:v2/AskForApproval.ts:5`；§4 |
| **P0：配置隔离强度** | 先做受控HOME/CODEX_HOME、独立身份、项目文档注入与来源审计探针；保持“不读主人配置”既定底线，若做不到就阻塞，不静默放宽 | CODEX_HOME外还有~/.agents、项目/系统层；trusted项目不只加载AGENTS。〔二手〕官方0.163 host_roots.rs`:95–118、138`、agents_md.rs`:64`；§5 |
| **P0：订阅还是API/中转** | 主人决定计费；两条路都用独立身份，订阅自行登录独立home，API用专用key/env_key；不共享默认auth | 目录隔离不会省额度；OAuth刷新和keyring命名空间有独立生命周期。〔二手〕官方auth；〔一手〕`G:v2/LoginAccountParams.ts:6`；§5 |
| **P0：公共层补口** | 接受G1/G4为共用必要修复；若保留完整异步问答/计划审批与实时子计费，再接受G2/G3；逐项小变更评审 | 取消支出漏总计、watchdog未落实是已有机制缺口；其余是当前Codex具体协议暴露的缺口。〔一手〕`B:session.ts:473–494、529–536、610–654`、`B:contract.ts:487`；§6 |
| **P0：硬预算和concludeOn定义** | V1inferences/toolCalls=false；concludeOn先false，#40通过后按“成功后中断确认”置true。若要求严格零额外推理，Codex当前方案不达标 | item不等于请求，通知不是前置拦截；raw completion内部接口也只是事后事实。〔一手〕`G:v2/ThreadItem.ts:34`、`RawResponseCompletedNotification.ts:7`；§4 |
| **P1：异步问答和计划审批是否V1全保留** | 推荐保留并补G2；若延期，要明确哪些request/feature禁用，不保留UI卡却无法permit | 原生问题可跨父回合，Paseo需要followUpPrompt。〔一手〕`P主:4817–4841、6390`；`P:packages/server/src/server/agent/providers/codex/async-questions.ts:75` |
| **P1：问答能表达的范围** | 当前CLI按单选＋Other/notes和异步自由文本验收；遗留多选codec修复，但不宣称0.163会发多选；isSecret首版不接 | native问题无multiSelect；官方TUI有Other标签和user_note编码习惯，按该语义保留数组边界，不能拆逗号或默认第一项。〔一手〕`G:v2/ToolRequestUserInputQuestion.ts:9`、`ToolRequestUserInputAnswer.ts:8`；§4.2 |
| **P1：子用量完整性/⑪** | 先实测同连接及父总量包含关系，确定唯一汇总口径；未知留空并标计量不完整；原生孩子不因未知而假报0 | Paseo过滤子telemetry；公共实时事件没有childId。〔一手〕`P主:5683–5722`、`B:contract.ts:487`；§4/§6 |
| **P1：minVersion** | 候选0.163.0；A3通过后定正式支持下限，不在此次静态评估承诺更低版本 | 老0.143注明不足以覆盖当前后台终端/分页/新问题行为。〔一手〕`P:packages/server/src/server/agent/providers/codex/options.ts:37`、本机version；§2 |
| **P1：“不detached”文字** | 改为提供方不自行脱管/unref，统一用受管subprocess；不要求底座OS detached=false | 底座POSIX detached建进程组是统一机制；若字面强制false就会逼无关公共进程改造。〔一手〕`L:packages/subprocess/subprocess-local/src/spawn.ts:448–483`；§2 |
| **P1：ephemeral选用** | 普通work默认可续接；查资料一次性需显式选择，推荐以后可选通用持久性字段；整理例子从Codex V1范围剔除 | SessionConfig无区分查资料字段；整理与only-work矛盾；ephemeral不等于整home无文件。〔一手〕`B:contract.ts:35、149–192`、`G:v2/ThreadStartParams.ts:44`；§4 |
| **P1：取消失败/后台终端** | 强化Paseo清理失败传播，不把warn当成功；hard_limit是否连孩子停单列确认，不能沿根interrupt放任后台花费 | 现Paseo终端终止错误被吞、wait cleanup超时只警告；子线程取消未实现。〔一手〕`P主:5185–5248`、`5062`；§4 |
| **P2：plan/模型与权限模式组合** | plan作为modeId对外，内部用plan/default；权限模式受会话策略约束，不把auto-review或full-access全部开放成默认可切模式 | 公共只有一套mode入口，Paseo把plan挂feature；collaborationMode可覆盖模型/开发指令，需要重新合成人设。〔一手〕`P主:3817–3867、4706`、`G:v2/TurnStartParams.ts:129–136`；§4 |
| **P2：压缩** | 首版按不能关处理，off拒绝；找到可靠开关且真CLI验过再改Meta | 数值阈值不是可证明的关闭；V1只有work，压缩不必阻塞基础接入。〔一手〕`G:v2/Config.ts:22`；§4 |
| **P2：日志/凭据泄漏** | 迁入transport删完整raw line日志；审批事实保必要内容，认证/HTTP header永不进ResumeHandle/公开录制；禁止usage-source全局扫描 | 原transport错误日志打印line，原metadata含MCP服务器；公开仓库风险明确。〔一手〕`P:packages/server/src/server/agent/providers/codex/app-server-transport.ts:206–212`、`P主:4978–4981`；§3/§5 |
| **P2：范围与估算** | 采用10,131原始行＋严格自写/测试分别统计；保留已有shared，不补迁manager/runtime；12–20日按验收不确定性预留 | 复制约1万行不等于1万行都可直接复用，主要成本是策略与真实行为核验。〔一手〕§3统计；〔推理〕§9 |

本次仍未证实的项目：本机真实登录/模型组合可用、完全文件读取隔离、自动压缩关闭、#40无额外请求边界、⑪同连接子用量和父子口径、非阻塞问答的真实完成时序、后台子/终端停稳保证。协议存在与源码路径已经核实；这些行为必须由后续授权的真CLI验收决定，不能把本报告当A3通过证明。〔一手〕本次未运行真实会话；〔推理〕验收边界。

交回自检：10节齐全；迁移行数按固定上游逐文件核算；已有文件引用路径与首个行号已检查；表格列数、代码围栏和末尾换行检查通过。liwa-dev仍为干净的dev@034f8254，paseo-upstream仍为干净的8018231a；本次没有提交、切分支或修改它们。未用测试/构建通过代替只读证据。〔一手〕本次最终只读自检。
