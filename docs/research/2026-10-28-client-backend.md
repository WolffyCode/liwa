# 调研：客户端界面与前后端架构

日期：2026-10-28。由调研子任务产出，标注：〔一手〕读到原文或源码；〔二手〕搜索摘要或第三方文章；〔推测〕调研者判断。

覆盖说明：Helm（Paseo fork，0.11.1）的核心协议、同步与性能文档读了全文，桌面端和协议包关键代码读了片段；OpenClaw 读了文档未读源码；上游 Paseo 读了 commit、CHANGELOG 与部分文档 diff；Cursor、Devin、GitHub Agent HQ 以二手资料为主。

## 1. 来源

| 来源 | 是什么 | 读了什么 |
| --- | --- | --- |
| Helm `docs/architecture.md`、`timeline-sync.md`、`protocol-compatibility.md`、`protocol-validation.md`、`agent-stream-performance.md`、`terminal-performance.md`、`rpc-namespacing.md` | Paseo fork 的核心设计文档 | 全文 |
| Helm `docs/data-model.md`、`docs/workbench.md`、`.dev/product-planning/` | 数据模型；四栏工作台设计 | 部分 |
| Helm 代码：`packages/desktop/src/{main.ts,preload.ts,daemon/daemon-manager.ts}`、`electron-builder.yml`、`packages/protocol/src/messages.ts`、`packages/client/src/daemon-client.ts` | 实现验证 | 关键片段 |
| OpenClaw `docs/concepts/architecture.md`、`docs/gateway/protocol/*`、`docs/web/control-ui*.md`、`docs/plugins/sdk-channel-plugins.md`、`docs/channels/{qqbot,wechat}.md` | Gateway 协议与控制台 | 文档原文 |
| getpaseo/paseo 上游：近 30 条 commit、CHANGELOG（0.11.2→0.14.0-beta.1）、`relay-endpoint-security.md`、`connected-hosts.md` | 上游最新方向 | 原文 |
| nodejs.org `sqlite.html`（v24.22.1）；docs.openclaw.ai/install/node-compatibility | node:sqlite 稳定性与踩坑 | 全文〔一手〕 |
| Codex app 审阅面板文档；Vibe Kanban README 与停运公告；OpenHands agent server 文档 | 多任务控制台 | 摘要〔二手〕/全文〔一手〕 |
| Electron autoUpdater、electron-builder auto-update 文档；Cursor、Claude Desktop、LocalWP 签名校验失败报告；Tailscale 连接与性能排障文档 | 分发与远程 | 摘要〔二手〕 |
| npm registry（2026-10-28） | 包版本：monaco-editor 0.57.0（解包约 102MB）、@codingame/monaco-vscode-api 38.0.4、@xterm/xterm 6.0.0、better-sqlite3 13.0.3（node≥22）、node-pty 1.1.0、Electron 45.0.0、electron-builder 26.18.0、@pierre/diffs 1.6.2、streamdown 2.7.1 | 〔一手〕 |

## 2. 关键机制

### 后端分层、协议与同步

| 维度 | Paseo（Helm）〔一手〕 | OpenClaw〔一手，文档〕 | 对灵鲸的含义 |
| --- | --- | --- | --- |
| 进程模型 | supervisor + worker；node-pty 与 headless xterm 在 fork 出的 worker；Claude 走 Agent SDK，Codex 走 `codex app-server` | 每台主机一个 gateway 常驻进程，同端口托管控制台，launchd 守护 | 单进程模块化单体 + CLI 子进程即可 |
| 分层 | websocket-server 管连接握手，session 管订阅，AgentManager 是状态唯一来源，providers 做适配；但 session.ts 8808 行、agent-manager.ts 5425 行、daemon-client.ts 7142 行、messages.ts 7689 行 | Gateway 持有所有渠道连接；渠道插件只做适配 | 模块边界一开始定死，避免巨型 session 对象 |
| 信封 | 顶层 hello/ping/pong/session；请求带 requestId，订阅带 subscriptionId；RPC 用 `a.b.verb.request/.response`，有限流式加 `.update` | `{type:"req",id,method,params}`、`{type:"res",id,ok,payload\|error{code,message,retryable,retryAfterMs}}`、`{type:"event",event,payload,seq,stateVersion}` | req/res/ev 三种信封 + 点分命名 |
| 版本 | 整数协议版本；schema 只增不删；`features` 能力位；兼容垫片打 `COMPAT(name)` 标签并写删除日期；根因是 app 与 daemon 分开发版 | 整数版本 4；字符串能力位 | 本体托管前端可省兼容矩阵 |
| 校验 | zod，纯结构 schema（禁 transform/catch/preprocess），discriminatedUnion；客户端 zod-aot（353KB 消息 10.9ms→2.5ms） | TypeBox → JSON Schema → Swift | zod + 纯 schema 规则；zod-aot 等有性能问题再上 |
| 同步 | 实时流管及时，`fetch_timeline` 分页管正确；打开对话只取最新尾页；目录数据每实体单调序号，只留最新投影和 tombstone，游标过期给快照；只给打开的对话推实时流 | 连接内 seq 单调；事件不重放，缺口断开重连拿快照；副作用方法带幂等 key | 实时流不持久，按游标补齐，过期给快照 |
| 流式性能 | 按 agent 合并 delta，60ms 一帧，首个立即发；客户端每帧提交一次；按积压匀速吐字；Markdown 只重解析最后增长块；吐字中位间隔 317ms→17ms | 远程连接对 >1KiB 帧做 permessage-deflate | 前三条照抄 |
| 背压 | 每 socket 8MiB 上限超出断开；终端 bufferedAmount>4MB 退回快照；工具输出截 64KiB；未开 permessage-deflate | 默认 maxPayload 25MiB；hello 带快照 | 低带宽下限帧 + 压缩 |
| 存储 | JSON 文件 + 原子 rename，无迁移框架；时间线只在内存，持久真相是 CLI 会话记录（如 `~/.claude/projects/*.jsonl`） | node:sqlite | 灵鲸不能以 CLI 会话记录为真相 |
| 子进程 | `runtime/managed-processes/{id}.json` 登记，启动对账 | — | 照抄 |

上游 Paseo 近况〔一手〕：已到 0.14.0-beta.1；近期集中在"不阻塞事件循环"（禁止同步 IO 守卫、分页从内存投影返回）；relay 加密改 Noise_NK；时间线按完整一轮分页；新增 Connected hosts（daemon 间委派）；Electron 壳只有修复。

### 前端组件

| 组件 | Helm 实际选择〔一手〕 | 对比 | 建议 |
| --- | --- | --- | --- |
| 状态 | zustand（63 个文件）+ TanStack Query + TanStack Virtual；客户端缓存 expo-sqlite | 外部 store + selector 最适合高频流 | zustand vanilla store（由 client 包写入）+ TanStack Query + 虚拟列表 |
| 编辑器 | CodeMirror 6（+vim） | monaco-editor 解包约 102MB；monaco-vscode-api 百余子包、需虚拟文件系统〔二手〕；openvscode-server 只能 iframe | 第一版 CodeMirror 6 + `@codemirror/merge` |
| Diff | 本体算 diff，前端自绘 | @pierre/diffs：Shiki、虚拟化、行内批注钩子〔二手〕 | 审阅用 @pierre/diffs（行评论回灌分身），编辑用 CodeMirror merge |
| 终端 | xterm 6.1 beta；node-pty + headless xterm；二进制帧 | — | 第一版不做交互终端，执行记录由工具调用事件渲染 |
| 布局 | 原型用 dockview；正式四栏改为固定职责、只调宽度 | — | 主控台固定区域，工作区内部才有 tab/分屏 |

### Electron 安全与分发（Helm）〔一手〕

- webPreferences 达标：nodeIntegration false、contextIsolation true、sandbox true、webSecurity true。
- 前端从包内 `app-dist` 经自定义协议 `paseo://app` 加载，导致前后端版本错开。
- preload 只 require "electron"，曾因加载本地模块中断（#2103），有 `preload-sandbox.test.ts` 防回归，值得抄。
- 通用 `paseo:invoke` 不校验 sender，是反例，应校验 `senderFrame` 来源。
- electron-builder + hardenedRuntime + notarize（需 Developer ID）；electron-updater 走 GitHub Releases。
- macOS 自动更新要求已签名（Squirrel.Mac）〔二手，官方摘要〕；Cursor、Claude Desktop、LocalWP 出过 SQRLCodeSignatureErrorDomain〔二手〕；ad-hoc 签名大概率过不了校验〔推测，需实测〕。

### 多任务控制台的信息架构

| 产品 | 导航主轴 | 阶段与审核 | Diff 审阅 | 并行隔离 |
| --- | --- | --- | --- | --- |
| Codex app〔二手〕 | 项目 → thread | automations 结果进审阅队列 | 整体/逐文件/逐 hunk stage/revert；行评论后需再发消息 | Local 或 Worktree |
| Cursor 2.0/3〔二手〕 | Agents 侧栏 / Agents Window | Plan mode 可一个模型规划一个执行 | 多尝试对比 | worktree 或远程 VM |
| Devin〔二手〕 | session | Interactive Planning，"Waiting for Approval" | 未确认 | 云端 |
| Vibe Kanban〔一手〕 | 看板 issue | 拖进 In Progress 即建 worktree 启动 agent | 行评论直达 agent | 每 workspace 一分支 + 终端 + dev server |
| OpenHands〔一手〕 | conversation | — | — | REST 管生命周期，WS 推事件 |
| OpenClaw 控制台〔一手〕 | Chat/Channels/Cron/Config/Usage/Logs | 执行审批 | — | Vite + Solid |

共性：审核落在计划和 diff 两点；行评论最终变成发给 agent 的消息；并行靠 worktree；没有一家以人格主体为主轴。

## 3. 对灵鲸的建议

### 进程模型与模块边界

launchd 托管 Node 24 主进程（KeepAlive）+ 大脑 CLI 子进程（每对话一个）；重查询（日志全文检索、每晚整理）放 worker_threads 用独立只读连接；写操作主线程单写者。依据：上游 Paseo 主线是不阻塞事件循环〔一手〕；node:sqlite API 全同步〔一手〕。

| 模块 | 职责 | 对外 | 不得做 |
| --- | --- | --- | --- |
| gateway | 静态资源、WS 握手鉴权、连接会话、订阅登记、背压、序列化 | 调 commands/queries，订阅投影变更流 | 不懂业务 |
| journal | 只追加日志、单写者；分配 pos 与流内 seq；同事务内联投影；提交后发进程内总线 | `append(stream, expectedSeq, events)`、`read(from)` | 不被直接查表 |
| projections | 看板、对话列表、时间线、花费、成员状态读模型 | 查询 + 变更流 | — |
| tasks | 任务状态机与关口（设计中/等审设计/执行中/等验收/完成 + 暂停/叫停/失败） | submitDesign/approveDesign/requestChanges/accept/reject | 不跑大脑 |
| conversations | 对话、分身、子对话归属树，轮次，大脑绑定 | send/pause/stop/switchBrain | — |
| mind | 主意识：判断是不是活、交给谁，原话 + 记忆派下去，汇报 | 只订阅里程碑事件 | 不收分身 token 流 |
| brains | CLI 适配器归一成 BrainEvent（text.delta、tool.start/update/end、permission、usage、turn.end、error）；备用大脑切换 | — | — |
| procs | 进程组 spawn、杀进程树、超时、看门狗、登记表持久化与启动对账 | — | — |
| workspace | 文件树、读写、git status/diff、改动前快照、回收站 | — | — |
| scheduler | 持久化定时器表（作息、提醒、承诺、每晚整理），croner；重启按策略补跑 | — | — |
| memory / persona | 日志的异步投影；成长与人格变化带版本可回滚 | — | — |
| guard | 花钱总闸、一键暂停、按类别收回能力 | 大脑每轮启动前必须询问 | — |
| notify | 注意力事件按在线状态路由，第二版接 QQ/微信 | — | — |

依赖单向：gateway → 应用服务 → 领域模块 → journal；领域模块之间只走公开 API 或日志事件，各自拥有自己的表。

### 操作日志与投影

- Paseo 以 CLI 会话记录为真相，与"灵魂归本体、换 CLI 她还是她"冲突。灵鲸持有规范时间线：日志是真相，CLI 会话记录只是 resume 缓存。
- 表：`events(pos PK, stream_type, stream_id, stream_seq, type, v, actor, occurred_at, causation_id, correlation_id, provenance JSON, payload JSON, UNIQUE(stream_id, stream_seq))`。provenance（场合、参与者、可见性）第一版就写入。
- 持久事件：消息完成、工具调用完成（输出有上限）、阶段流转、用量、快照、记忆增删改。临时流事件（token delta、工具进度）不入日志，在条目边界提交。崩溃后对有 `turn.started` 无结束的轮次补 `turn.interrupted`。
- 大对象（工具输出、diff、图片、语音）按哈希存文件，事件只放引用。
- 内联投影只给看板、对话列表、时间线、花费汇总；记忆抽取、全文检索、成长日记走带检查点的异步投影；投影可删表重放重建，兼作迁移手段；单用户规模不需要快照。
- 备份：node:sqlite `backup()` + blob 目录。

### 协议草案

```
C→S {t:"hello", protocol:1, build, client:{kind:"console"|"web"}, auth, resume:[{topic,cursor}]}
S→C {t:"welcome", protocol:1, build, features:[], limits:{maxFrame:262144}}
C→S {t:"req", id, m:"task.approve_design.request", p:{taskId}, idem}
S→C {t:"res", id, ok:true, p} | {t:"res", id, ok:false, e:{code,msg,retryable,retryAfterMs}}
C→S {t:"req", m:"sub.open.request", p:{topic:"conversation:abc", cursor}}  → res 带快照或增量与 subId
S→C {t:"ev", sub, seq, k:"timeline.item_committed", p}
```

事件分类：实体（upsert/remove，带实体版本）、时间线（已提交条目，`(conv, seq)`，可分页）、实时流（`stream.delta {item, offset, text}`，不重放，按偏移去重）、注意力（审设计、验收、出错、关心）、系统（健康、暂停、花费、心跳）、终端（以后，二进制帧）。

版本策略：前后端由本体托管同版本发布；protocol 或 build 不一致时客户端提示刷新，不做兼容；仍守 schema 只增不删、纯结构、discriminatedUnion 三条规则，为第五版手机端留余地；副作用请求一律带幂等 key。

### 低带宽（<70KB/s）同步

1. 先查 Tailscale 是否直连（`tailscale status`、`tailscale netcheck`），DERP 本身限流，可考虑 peer relay〔二手〕。
2. 静态资源内容哈希命名 + `Cache-Control: immutable` + 预压缩 brotli；编辑器、diff、终端懒加载。
3. 非本机连接开 permessage-deflate，阈值 1KiB。
4. 只给正在看的对话推 token；其他活只推看板实体变更。
5. 每对话 60–100ms 合帧；bufferedAmount 超阈值降级为只推条目完成。
6. 单帧 ≤256KB；工具输出截断，全文按需取；diff 先发文件清单与统计，hunk 按需取。
7. 重连 hello 带各 topic 游标；时间线只补尾页；游标过期给快照。
8. 客户端 IndexedDB 缓存已提交条目，先画缓存再对账。
9. 图片、语音、文件走 HTTP GET + Range + 缓存，不走 WS base64。

### 前端工程与状态

包：`packages/protocol`（zod schema 与类型）、`packages/client`（连接、req/res、订阅管理器：游标、重订阅、1s→30s 指数退避）、`packages/core`（本体）、`packages/ui`（Vite + React）、`packages/desktop`（以后）。

状态四类：服务端副本（zustand vanilla，由 client 订阅回调写入）；请求型数据（TanStack Query，fs/git 事件失效）；流式文本（每对话实时头缓冲，每帧提交，匀速吐字，Markdown 只重解析最后块）；界面本地状态（按对话 id 归属并持久化，区分目录共享与对话自有 key）。界面定义 `HostBridge` 接口，提供 web 与 Electron 两种实现。

### 主控台信息架构

- 顶栏：她的头像与当下状态、花费仪表、一键暂停、注意力铃铛。
- 左侧导航：她（首页）、任务、工作区、成员、日志与花费、设置。
- 首页：中间是和主意识的对话；右侧"她手上的事"按阶段分组小卡片，"等你审设计""等你验收"带徽标；主意识派活/汇报时在消息里插入任务引用卡。
- 任务页：五列看板 + 顶部"需要你"泳道；卡片显示标题、执行者、大脑、耗时、花费、最新进度摘要，不显示 token 流；阶段流转只用明确按钮，不支持拖拽；完成时不抢焦点。
- 任务详情：左栏阶段时间线与设计文档（可批注）；中栏分身对话（可直接说话、暂停、叫停、换大脑，子对话树状展开）；右栏"改动"（文件清单 + diff + 行评论发给分身 + 按快照回滚）与"执行记录"。
- 工作区：文件树、编辑器标签、diff 标签；从任务打开的文件落在该活的 worktree。
- 成员：出生设定、当下状态、日记、成长变化（diff 式历史可回滚）、记忆浏览（增删改、显示来源）、大脑配置。
- 日志与花费：全文检索与筛选；按天/任务/大脑统计；总闸设置。
- 注意力隔离：主意识只订阅里程碑（设计已提交、阻塞提问、完成、失败）；主人直连分身不经主意识，但经历仍汇入她的记忆。

### 第一版客户端：网页优先，Electron 以后作为薄壳

1. 本体托管网页天然同版本，省掉 Paseo 的兼容负担〔一手〕。
2. 没有 Developer ID，macOS 自动更新卡在签名〔二手〕。
3. 网页覆盖第一版需求；短板是电脑通知：Notification 与 Service Worker 需要安全上下文，tailnet `http://100.x` 不算，要用 Tailscale Serve 提供 HTTPS 或本机 localhost；标签页关闭收不到通知。
4. Electron 的独有价值在后续版本：托盘、常驻通知、自启、全局快捷键；看屏幕的 desktopCapturer（第四版）；桌宠透明置顶窗口（第五版）。

若第一版后期需要可靠通知，加约 300 行薄壳：直接加载本体 URL，只暴露托盘、通知、自启、快捷键四个白名单 IPC 并校验 sender；开 Electron Fuses；不做自动更新。

### Paseo 值得摘与不要抄

值得摘：纯 schema、discriminatedUnion、点分 RPC 与 `.update`；连接不产生需求、订阅显式 id、重连重订阅；每 socket 高水位 + 10 秒 ping 租约；`agent-stream-coalescer.ts`；`computeRevealStep`；时间线尾页优先与 `seqStart/seqEnd`；directory-sync 的最新投影 + tombstone + generation；creation journal 幂等与"结果未知返回 unknown 不重复执行"；managed-processes 对账；Store Surface Rules（一个 store 方法一个 SQL 事务）；终端链路设计；Claude/Codex 适配器把工具调用归一成 `ToolCallDetail`；preload 沙箱测试。

不要抄：巨型文件；JSON 文件存储且无迁移；CLI 会话记录当真相；整套 COMPAT 与 relay 端到端加密；Expo/RN 跨端；多主机；提前上 zod-aot。

## 4. 坑与反例

1. 兼容性让复杂度失控：`timeline-sync.md` 20KB 几乎全是边界情况〔一手〕。
2. node:sqlite 版本坑：24.15.0 前 TEXT 内嵌 NUL 静默截断（24.16.0 修复）；WAL 重置损坏要求 SQLite ≥3.51.3；OpenClaw 要求 Node ≥24.22.1 并启动自检〔一手〕。灵鲸启动时检查 `sqlite_version()` 与 NUL 往返。
3. 同步 API 堵主线程；单个 250KB 消息让终端回显掉帧约 100ms〔一手〕。
4. 不要用心跳决定是否投递（Paseo 明确禁止）〔一手〕。
5. OpenClaw 默认值不适合慢链路：hello 带快照、maxPayload 25MiB、超过 2 倍 tick 静默断开〔一手〕。
6. Electron：通用 invoke 不校验 sender；preload require 本地模块在沙箱下中断〔一手〕。
7. 孤儿进程：大脑 CLI 在本体崩溃后成孤儿；detached 启动、按负 pid 杀进程组、启动对账。
8. Vibe Kanban 2026-04-10 宣布停运，原因是商业模式〔一手〕；提醒看板不该成为唯一主轴。
9. Codex app-server 的 WebSocket 传输仍是实验性，生产用 stdio〔二手〕。

## 5. 待实测

- node:sqlite 在 24.22 是否仍有 ExperimentalWarning；内置 SQLite 是否带 FTS5；中文检索能否用 trigram 分词；与 better-sqlite3 吞吐对比。
- Tailscale 当前是直连还是 DERP、实际吞吐；permessage-deflate 对 JSON 流的压缩比。
- Squirrel.Mac 在 ad-hoc 或自签名下能否自动更新；本地构建 .app 是否带 quarantine。
- PWA + Web Push 在 Tailscale Serve HTTPS 下能否可靠收到通知。
- @pierre/diffs 与 CodeMirror merge 在大 diff 下的体积与性能。
- Claude Agent SDK 与直接调 CLI 在 resume、并行限流上的差异；Codex app-server 审批流细节。
- Devin、Cursor、GitHub Agent HQ 只有二手资料；Codex app 审阅细节来自官方文档摘要（页面 403）。
- OpenClaw 只读文档未读协议源码（seq 起点、stateVersion 覆盖范围未确认）。
