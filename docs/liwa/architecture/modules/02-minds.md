# 02 用脑调度（minds、context、toolport）：direct、实例与活会话

状态：**最小 direct 运行部分已确认，计划实施**（2026-11-05，handoff 决策 65、66）；完整实例／活上下文、toolport 等其余部分仍为草稿。minds 独占会话登记、代次、回合、投递与待答的状态机；brains 负责提供方及 watchdog 的技术执行；宿主装配、命令与协议见 [01-brain-host.md](01-brain-host.md)。推进为 ④ Claude Code＋G1 → ③ 宿主（G4／JSON 严格读取前置）→ ⑤ Codex＋G2/G3。〔一手〕主人 2026-11-05 定稿及顺序决定；`packages/brain/brain/src/provider.ts:77`。

## 0 一页结论

- **minds 持有 direct、实例与活三种 owner 的唯一会话运行机制。** 第 3 步先实现主人 CLI 的最小 direct 部分，agentId/directId 稳定，每次运行时重建增 gen 并取得新 BrainSessionId；实例和活接同一个登记／queue／回合实现。〔一手〕handoff 决策 65；〔推理〕下文实现结构。
- **进来的东西先进本体的持久待投递队列，再交给提供方。** 三种送达语义：下一步可见、只在下一回合可见、取消并重排；合批、排序、去重、至少送达一次都在队列里做完；提供方不支持的语义由队列在回合边界补；被中断回合已拿到的输入由本体放回，不依赖提供方的 inbox。权威是经历流 + 这个队列；底座的会话日志是第二份转录。
- **上下文三层**：稳定前缀（人设十段所有实例逐字相同 + 末尾的实例说明）、最近对话（重建时从各地方流补 N 轮原文）、每轮前缀（从账本现拼、按受众裁、可替换不累积）。给想事活的是整份快照。
- **toolport 按"实例种类 × 触发消息的发送者角色"在执行点裁工具，令牌按代次签发**，换代即作废；适配器不能自报身份。
- **回合有预算，结束有检查**：≤3 次推理、≤6 次工具调用、看门狗 60 秒、硬线 120 秒；主人发起的回合必须以五个结束工具之一收尾，否则走漏回复兜底。
- **活会话的汇报回到派它的实例**：以 `instanceId` 为目的地，不指向任何会话对象；实例已回收就留在队列里，重建时补投。
- **最小 direct 阶段**先完成 §2.3–§2.7 与 §4.0；完整第二层的 m0 做主人实例 + 底座自带 agent 提供方 + 三个工具（`reply`、`no_reply`、`inner`），V1 其余放 §9。

## 1 范围与边界

| 模块 | 管 | 不管（归谁） |
| --- | --- | --- |
| minds（运行层，`core/minds`） | direct、实例与活的登记、状态机、代次；持久待投递队列与投递器；回合生命周期、预算要求与超时结果处置、收尾检查；watchdog 技术计时／取消只在 brains；换新、回收、重建；会话与回合事件；给 gateway 的进程内实时信号 | 路由（attention，《2.2 实例的种类与路由》）；对外说话（outbox）；准入与名额（guard）；提供方与进程（brains、procs）；活的状态机与核验（tasks） |
| context（运行层，`core/context`） | 稳定前缀、实例说明、最近对话、每轮前缀、想事活快照的装配；人设版本号；结构块的渲染与转义约定 | 人设内容与成长（self、06）；受众计算（people）；召回排序（memory） |
| toolport（接入层，`core/toolport`） | 令牌签发、校验、收回；工具目录与 schema；按实例种类 × 发送者角色裁；同步执行与错误返回；工具调用事件；每回合的工具调用计数 | 投递与目标解析（outbox）；副作用协议（actions）；主人专属操作（gateway） |

最小 direct 依赖 brains、底座 storage-domain/json、session-persistence/projection，配置由现 profile／请求显式给值。完整第二层依赖方向按 `00-contracts.md` §4.2 的层表：toolport → minds / context / outbox；minds → context、brains、guard、journal；context → journal 与各账本的读 API。三者都不调模型、不读懂内容。

## 2 数据

### 2.1 投影（从事件重建；运行时另有内存表）

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `mind_instance` | instance_id、member、kind（`owner` / `solo` / `person` / `group` / `stranger`）、key（人、群或对话的编号）、state（`running` / `reclaiming` / `reclaimed` / `rebuilding`）、gen、session_id、provider{impl, model}、stable_version、persona_rendered_at、turns_in_gen、last_turn_at、pending_count、updated_pos | 一个 `(member, kind, key)` 只有一个实例；`instance_id` 永不变；主人实例永不 `reclaimed` |
| `mind_session` | session_id、owner（`{directId}`、`{instanceId}` 或 `{taskId}`）、gen、kind（`MindKind`）、provider、stable_version、status（`open` / `closing` / `closed`）、close_reason、usage、opened_pos、closed_pos | 提供方句柄只在内存；owner 编号与 gen 定位逻辑代次，session_id 是 brains 返回的新不透明 id，不用作 JSON 文件键拼接 |
| `mind_turn` | turn_id、session_id、initiator{kind: `person` / `system` / `task` / `direct`, principal}、trigger_events[]、handed[]（本回合拿到的队列项）、status（`running` / `completed` / `cancelled` / `failed`）、inferences、tool_calls、side_effects、concluded_by（结束工具名或空）、usage、started_pos、ended_pos | `side_effects` 是本回合已完成的、有后果的工具调用数，取消规则用它 |
| `mind_delivery` | owner、event（要投的事件号）、semantics（`next_step` / `next_turn`）、chain（所属链的发起消息号，可空）、state（`pending` / `handed` / `consumed`）、handed_turn、attempts、queued_pos | 按 `(owner, event)` 去重；逻辑消费状态与 providerDispatch（queued/dispatching/accepted/unknown/cancelled）分别表达消费结果和传输事实，仍属同一队列；结果不明不重投 |

### 2.2 事件（`contracts/events/minds.ts`，只有 contracts 能定义）

流：实例会话的事件进 `instance:<instanceId>`，活会话的进 `task:<taskId>`，人设装载进 `member:<id>`，令牌拒绝进 `system`。`correlationId` = turnId；`causeId` = 触发回合的事件或 `turn.started` 的 pos。

| 类型 | 载荷（信封外） | 载荷号（可删） |
| --- | --- | --- |
| `instance.opened.v1` / `instance.reclaimed.v1` | kind、key；reason、cursor | — |
| `session.opened.v1` / `session.closed.v1` | gen、provider、stableVersion、recentTurns?；reason（`renew_context` / `renew_turns` / `stable_changed` / `stale` / `error` / `quality` / `nightly` / `reclaim` / `provider_switch` / `drain`）、cursor | — |
| `turn.started.v1` / `turn.completed.v1` / `turn.cancelled.v1` / `turn.failed.v1` | initiator、triggerEvents、handed；usage、inferences、toolCalls、concludedBy；reason（`preempt` / `watchdog` / `hard_limit` / `pause` / `drain` / `restart` / `owner`）；category、message、retried | — |
| `turn.output.v1` | itemId（模型最终文字，只进日志，`overall.md` §8 R1） | text |
| `turn.quality.v1` | kind（`no_conclusion` / `reminder_sent` / `fallback_sent` / `loop` / `budget_hit`） | — |
| `delivery.queued.v1` / `delivery.handed.v1` / `delivery.settled.v1` | event、semantics、chain；events[]、turnId、gen；turnId、outcome（`consumed` / `returned`） | — |
| `tool.called.v1` | turnId、callId、tool、seqInTurn、batch?、ok、error?、durationMs、effectId? | args、result |
| `context.built.v1` | turnId、stableVersion、chars{stable, notes, recent, prefix}、blocks[] | 每轮前缀原文 |
| `persona.loaded.v1`（`member` 流） | version、chars、sections[] | 稳定前缀全文 |
| `toolport.rejected.v1`（`system` 流） | reason（`bad_token` / `stale_gen` / `no_turn` / `not_in_set`）、tool | — |

### 2.3 最小 direct 的标识与状态

| 标识 | 含义 | 规则／依据 |
| --- | --- | --- |
| agentId/directId | 一个主人直接创建的逻辑 agent，跨运行代次稳定 | 一份 agent JSON、一份逻辑 JSONL；文件键用安全不透明编号，不由 cwd 或标题清洗生成。〔一手〕packages/storage/storage-json/README.zh.md:56；〔推理〕 |
| gen、sessionId | owner 代次与本代 BrainSession id | 重建／续接／换提供方产生新 gen、sessionId；原生 id 另存。〔一手〕[four-layers.md](../four-layers.md) §2.13；packages/brain/brain/src/index.ts:474 |
| bootId | 本次宿主启动标识 | 识别过期连接描述／回调；不增加远端 host 注册 id、设备 id 或同步 revision。〔推理〕 |
| operationId、deliveryId、turnId | 本机变更请求幂等号、输入投递号、提供方映射后的回合号 | 超时查询 operationId；同号不同请求报冲突；gen+turnId 防旧回调收掉新轮。〔二手〕docs/liwa/research/2026-11-05-codex-adaptation.md:366、370；〔推理〕 |
| logId、seq、cursor | 逻辑 agent 的日志及持久切点 | seq 跨 gen 连续；cursor 带 logId/epoch/seq/过滤范围，本机 attach 重连使用，不是跨设备同步协议。〔一手〕packages/session/session-persistence/src/handle.ts:85；〔推理〕 |

记录分别表达 `lifecycle=active/archived/deleting/deleted`、`runtime=absent/starting/live/stopping/closed/error/recovery_blocked`、当前前台回合、后台孩子／终端数量及 unknown、pending 数量、resume 是否可用；不能把“前台 idle”写成“全部后台已经停”。这里的枚举是 V1 内部业务值；线协议增加新取值时还需遵守 01-brain-host.md §3.2，不能直接把新枚举发给拒绝它的旧客户端。〔一手〕packages/brain/brain/src/views.ts:54；paseo-upstream@8018231a:docs/agent-lifecycle.md:55；〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:329；docs/liwa/research/2026-11-05-codex-adaptation.md:361；〔推理〕。

### 2.4 最小 direct 的持久布局

示例 `storage-json.root=$LIWA_HOME/brain-host/state`；领域声明 `layout:'per-record'`，路由到既有 `json`。布局选择在领域规范，不是 JSON 插件 Config 的开关。实际路径均进 Config。〔一手〕packages/storage/storage-json/README.zh.md:28、36、90；packages/storage/storage-domain/src/spec.ts:35、47；〔推理〕领域名。

| 数据 | 底座产生的示例路径 | 放什么与不放什么 | 唯一读写者 |
| --- | --- | --- | --- |
| agent 记录 | `state/agent/records/<agentId>.json` | 一 agent 一文件，跨 gen 保留当前记录；不每 token 增一文件，不每代再造一套 agent 登记 | minds 通过 `ctx.storageDomain` |
| 操作／恢复 intent | `state/agent/operations/<operationId>.json` | 创建号到 agentId 的映射、有限步骤、回执、结果不明／删除进度；内容主体只存 blob/日志引用 | 同一 minds 服务 |
| 受管进程台账 | `state/runtime/managed-processes/<recordId>.json` | 一受管进程／启动 intent 一文件；角色、owner、出生身份、退出／清理状态 | subprocess 的持久监管能力，经 storageDomain |
| 宿主替换／故障控制 | `state/runtime/operations/<operationId>.json` | restart intent、目标 boot、替换结果；不含会话正文 | 宿主载体的控制服务 |
| 事件日志 | `$LIWA_HOME/brain-host/events/` 下由 JSONL 后端决定的目录与版本文件 | 已提交输入、注入内容、回合／条目／权限／用量事实；是 logs/attach 真相 | minds 的日志写入者，经 sessionPersistence |
| 连接描述 | `$LIWA_HOME/run/brain-host/` | 当前 boot、回环 endpoint；token 单独私有文件；稳定 lock inode | 底座宿主／Connection；不是配置数据库 |
| 原生材料 | `<membersRoot>/<member>/brains/<impl>/…` | 原生转录／线程索引／稳定身份与本代材料；只是原生续接资料 | 提供方通过自身 API，清理见 §4.0 |

JSON 物理文档是底座的 `{version,record}` 包装，不手工维护同名 `.json`、manifest 或副本；不为复刻 Paseo 的 cwd 子目录再包一层存储。Paseo 的两个参照是 `agents/{cwd}/{agentId}.json` 与 `runtime/managed-processes/{recordId}.json`，灵鲸保留“一条一文件”而服从底座 `<unit>/<table>/<key>.json` 布局。〔一手〕paseo-upstream@8018231a:docs/data-model.md:53、64、79；packages/storage/storage-json/README.zh.md:90；〔推理〕。

### 2.5 agent 记录字段

| 记录部分 | 必要字段 | 真相与恢复规则 |
| --- | --- | --- |
| 身份与偏好 | agentId、owner/member、title/labels、cwd 原值与规范路径、createdAt、impl、requestedModel?、observedModel?、mode?、thinking?、mindKind | 当前配置的安全引用与已确认选择；省略 model 仍是 CLI 默认。改 cwd 不得偷偷换原生身份。〔一手〕packages/brain/brain/src/views.ts:60；〔推理〕 |
| 当前运行代 | gen、sessionId?、bootId、runtime/foreground、当前 operation/turn、processRefs、lastActivityAt、lastError | minds 是生命周期所有者；brains 句柄只在内存。JSON 上一 boot 的 live 不是现在还活着的证明。〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:328、338；〔推理〕 |
| 安全配置与续接 | providerRevision、配置来源 revision、configRootRef、homeDir、非秘密覆盖；resume{impl,nativeHandle,非秘密定位 metadata,capturedSeq,可恢复性} | 完整 cfg 重新解析，Key/MCP token 不进 JSON；只有 persistence 非 null 才保存可恢复句柄。原生 id 延后产生要及时更新。〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:330；docs/liwa/research/2026-11-05-codex-adaptation.md:362、363、365；〔推理〕 |
| 待投递 | bounded pending delivery 引用、语义、wake、expectedGen/Turn、queued/dispatching/accepted/unknown、attempt | 输入内容在 JSONL/blob，JSON 存可调上限内的待投递索引；唯一队列在 minds，不与 native queue 双投。〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:333；docs/liwa/research/2026-11-05-codex-adaptation.md:366；〔推理〕 |
| 待答 | sessionId/gen/requestId、turnId?/childId?、lifetime、请求 eventSeq、pending/responding/unknown、responseOperationId? | 详细题目／调用事实按 eventSeq 读取；Promise/RPC 不落盘，旧代请求不能向新进程回复。G2 预留。〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:335；docs/liwa/research/2026-11-05-codex-adaptation.md:368、369；〔推理〕 |
| 孩子与用量摘要 | 活动 child 摘要／parentChildId、background unknown、累计已知结算、完整性、最近 quota/balance 引用 | 完整历史与分项在日志；JSON 只保当前摘要；父总量不与 child/update 重加。G1/G3 依赖统一接口。〔一手〕packages/brain/brain/src/views.ts:123；〔二手〕docs/liwa/research/2026-11-05-codex-adaptation.md:372；〔推理〕 |
| 归档／清理 | archivedAt?、cleanupOperationId?、材料引用清单／清理进度、deleted tombstone | 只删本 agent 专属材料；跨 gen 共享同一原生 home 时不能删旧代目录把新代也破坏。〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:332、337；docs/liwa/research/2026-11-05-codex-adaptation.md:373；〔推理〕 |
| 持久协调 | recordRevision、appliedLogSeq、pendingMutation?、creationOperationId、restartRecovery? | 所有状态变更有明确提交步骤，见 §2.6；recordRevision 防本机并发旧读覆盖，不是分布式版本向量。〔推理〕 |

受管进程字段由 [01-agent-cli.md](01-agent-cli.md) §2.1 定义，subprocess 通过其持久 API 单写；minds 只保存 processRefs 并调用公开核对／清理能力，不维护第二份台账。〔一手〕`packages/brain/brain/src/views.ts:30`；handoff 决策 62、65。

01 的 `brain_provider/brain_process/brain_session/brain_child/brain_usage` 继续是公开观测形状，不变成五套独立 SQLite 表。provider 当前配置真相是 Cordis 行；会话／孩子／用量当前摘要放 agent JSON，历史读 JSONL，进程事实读逐条进程 JSON。关闭 brains 内存句柄不删除 agent 记录。〔一手〕[01-agent-cli.md](01-agent-cli.md) §2；packages/brain/brain/src/views.ts:1；〔推理〕。

### 2.6 JSON 与 JSONL 的提交和恢复

**能保证的是单个 JSON put 的持久原子发布，加上可恢复的有序操作；不声称 JSON、另一条 JSON 与 JSONL 有一个事务。** storage-json 的单文件写入做临时文件、fsync、rename、父目录 fsync；storage-domain 在一个领域内排写入链；跨记录仍由业务 owner 的操作状态机安排。所有文件只经这些 API，不在命令、provider 或宿主入口手写 rename/fsync。〔一手〕packages/storage/storage-json/README.zh.md:76；packages/storage/storage-domain/README.md:88、147；〔推理〕。

| 步骤 | 普通会话变更如何提交 | 崩溃后的唯一动作 |
| --- | --- | --- |
| ① durable intent | 固化 operationId、请求摘要、agentId、目标 revision/gen、内容引用；创建的 id 映射先存 operations；agent 记录记 pendingMutation | 没到提交点就是 preparing，不能当已执行；恢复在同一 operationId 下补步骤或明确失败，不分配第二 agent |
| ② JSONL 提交事实 | 追加包含 opId、eventId、gen、实体变更后状态／输入事实的记录，再 flush | append 没 flush 不承诺 durable；重启读有效前缀核对 opId，已有事件就不重复追加 |
| ③ 更新 agent JSON | 原子替换到新状态，推进 recordRevision、appliedLogSeq，完成 pendingMutation | 日志在前、JSON 落后就补投影；禁止反向把日志已发生事实回滚 |
| ④ 回执 | 操作记录补回执；关键 JSON 与日志已一致才报 accepted/applied | 回执丢失按同 operationId 查询；若操作记录尚落后，可用 agent/log 中的同号事实补齐 |
| ⑤ 外部投递 | 先把 dispatching intent 持久化，再调 provider；确认后记录 accepted/native turn 与后续结果 | intent 后、确认前崩溃是 unknown，不自动把同输入发第二次；后续恢复策略见 §6 |

此表机制为〔推理〕；依据 packages/session/session-persistence/src/handle.ts:85、99；packages/storage/storage-domain/README.md:73、88；paseo-upstream@8018231a:docs/data-model.md:37。accepted 只表示输入已由宿主持久收下，不表示模型已看见；applied 才表示该控制动作的明确结果。run no-wait 之后 wait 必须能绑定正在排队／启动的 operation。

事实分工只有一条读路：**ls/inspect 状态读取 agent JSON 的已核对记录，logs/attach 读取 JSONL；内存 domain 是这些 JSON 的加载视图，不是另一份持久索引。** 日志承载已发生的会话事实；agent 中这部分是带 appliedLogSeq 的物化摘要，过期时在开放变更前补追。创建、删除、进程启动的未完成 intent 归相应 JSON 控制记录；不能要求从对话日志凭空还原一个尚未建日志的进程。字段所有者公开业务 API，外部模块不直接开它的 domain。〔一手〕packages/storage/storage-domain/README.md:83、94；〔推理〕。

会话投影复用 session-projection：minds 注册单元，保留私有 detached Session 日志对象；独立 Session 不发 store 通知，flush 成功之后才发布该 cut 的 snapshot，失败隔离并从 durable 前缀重建。JSON 摘要由同一投影更新；查询不另做 fold。文字增量只批量追加 JSONL，不每个 token 重写 agent JSON；关键状态／权限／句柄变化及时落记录，lastActivity 的节流间隔进 Config。〔一手〕packages/core/session/src/index.ts:588、773；packages/session/session-projection/README.md:36、54、58；〔推理〕。

批量 stop/archive/delete 是逐 agent 操作清单，返回每项结果，不使用一次 deleteMany 假装全有或全无。删除顺序为：durable intent → 停稳 → 精确原生清理 → 删除日志与专属 blob → 清空 agent 内容、保留最小 tombstone／操作回执；重启按步骤继续。尚未清理完成的对象必须有 JSON owner 可查；删除 metadata 不等于物理擦除系统备份。〔一手〕packages/storage/storage-json/README.zh.md:56、145；〔二手〕docs/liwa/research/2026-11-05-codex-adaptation.md:373；〔推理〕。

对外发布切点与刚落盘的尾部分开：改变生命周期／权限／用量的事件，必须在关联 agent JSON 已推进后再发布 committedSeq；若日志先 durable 而 JSON 尚未更新，这段只供恢复读取，不能配旧状态发给 attach。纯转录文字不改变登记状态，可在 JSONL flush 后发布，agent 的历史 checkpoint/lastActivity 允许按声明的节奏落后；后续补追只推进摘要，不再次发布已给过的事件。单 agent 顺序发布不跨过尚未完成的控制提交。所有 processRefs／operationRefs 的目标缺失都需报告对账异常，不得把缺进程 JSON 当进程已退出；放行 CLI 前，进程记录与 owner 引用都须 durable。〔推理〕；〔一手〕packages/storage/storage-domain/README.md:73、147；packages/session/session-persistence/src/handle.ts:99。

### 2.7 严格读取与查询规模

**必须在底座补的能力：权威 per-record 记录不能“坏文件当不存在”。** 当前 JSON 后端 readRecord 吞读／解析失败，版本不支持也可缺席；domain 默认对 schema 不合法的有效 record 会拒绝，但根本没返回的 JSON 文档到不了那一层。`invalidRecords:'backup-and-skip'` 是可丢弃缓存的选项，不能用于 agent／进程台账。计划在既有 unit/domain 描述支持显式严格读取策略或等价的完整扫描错误报告：文件缺失与 unreadable/malformed/version-unsupported 必须可区分，包含安全定位；关键领域启用，其他缓存维持既有行为。**这是原存储 seam 的窄补口，不新增后端；底座改好前，不能宣称崩溃台账可靠。** 〔一手〕packages/storage/storage-json/src/per-record-unit.ts:13、164、178；packages/storage/storage-domain/src/spec.ts:58；〔推理〕。

启动先拿单实例锁再开两个领域，严格加载；agent JSON 损坏不得从 ls 静默消失，进程台账损坏不得当成“没有孤儿”。最小实现可让该领域拒绝开放并报告 store_unhealthy；只有底座 API 已能提供完整错误清单且 owner 可辨认时，才能隔离具体 agent 后开放其他项。底座读不到记录时，宿主不私扫目录猜 owner、不直接覆盖坏文件、不从另一个默认 home 捡数据。完整存储丢失属于数据损失，不能用“原子写”许诺可自动重建所有秘密引用与未决副作用。〔一手〕AGENTS.md:81、86；packages/storage/storage-domain/README.md:94；〔推理〕。

文件 schemaVersion 与 RPC 协议分开：声明 compatibleVersions 的 owner 才可读旧记录；转换在显式解析步骤，写入只升级这一条，禁止通过把旧字段变必填使整个 home 隐性清空。未来版本拒绝且不改文件；只保有效记录不会阻塞并不等于可以丢掉关键记录。〔一手〕packages/storage/storage-domain/src/spec.ts:48；packages/storage/storage-json/README.zh.md:56；〔推理〕。

对一个人使用规模，**预计够用，尚未实测**：启动 loadAll 是 O(agent 数＋进程记录数)，常驻 domain 内存的 ls 过滤／排序是 O(N)，单 agent 修改只替换该文件，不重写全目录；结束进程记录按可配置保留期清理，操作回执也有限保留，正文不塞 agent JSON。候选量级 1,000 条×8–32 KiB 约 8–32 MiB 原始 JSON，10,000 条约 80–320 MiB；Node 对象占用和文件读取延迟另算，不把这当 RSS。第 3 步量冷启动、ls p95 与峰值；不因一个慢测就偷偷换回 SQLite，先减少重复字段、做可重建内存索引／扫描并发限额，超过个人规模的存储演进另任务评审。〔一手〕packages/storage/storage-json/src/per-record-unit.ts:1、70、164；〔推理〕估算，01-brain-host.md §7/§10。

## 3 接口

本节是**计划接口**。最小 direct 的 run/list/inspect/send/wait/permit/reload/archive/delete 由 minds 的具体业务方法提供；状态定义在 §2.3–§2.7，终端语义见 [01-brain-host.md](01-brain-host.md) §3.1。当前 brain 契约仍仅接受 instance/task，direct 等计划补口见 [00-contracts.md](00-contracts.md) §5.1，不把下列设计当现有类型。〔一手〕`packages/brain/brain/src/contract.ts:149`；handoff 决策 65。

```ts
interface Minds {                                                     // Services['minds']，required 之间的进程内 API
  ensureInstance(req: { member: MemberId; kind: InstanceKind; key?: string }): Promise<{ instanceId: string; state: InstanceState }>;   // 幂等；只登记，不开会话
  deliver(req: { to: { directId: string } | { instanceId: string } | { taskId: string }; events: EventId[]; semantics: 'next_step' | 'next_turn' | 'cancel';
                 chain?: EventId; sender: Principal }): Promise<{ disposition: 'queued' | 'merged' | 'handed' | 'cancelled_and_queued' | 'deferred' }>;
  renew(req: { instanceId: string; reason: RenewReason }): Promise<{ gen: number }>;      // 等空闲（或硬线）后回收 + 重建
  reclaim(req: { instanceId: string; reason: 'idle' | 'owner' | 'drain' }): Promise<void>;
  openTask(req: { taskId: string; member: MemberId; kind: Exclude<MindKind, 'instance'>; owner: { instanceId: string } | null; provider?: ImplId;
                  tools: ToolDef[]; persona: PersonaSpec; leading: InputBlock[]; budget: TurnLimits; cwd: string }): Promise<{ sessionId: string; gen: number }>;
  closeTask(req: { taskId: string; reason: 'ended' | 'stopped' | 'failed' }): Promise<void>;
  cancelTurn(req: { owner: Owner; reason: 'watchdog' | 'pause' | 'preempt' | 'owner' | 'drain' }): Promise<void>;   // 幂等
  get(owner: Owner): Promise<SessionView | null>;  list(): Promise<SessionView[]>;
  current(owner: Owner): { turnId: string; gen: number; initiator: Initiator } | null;    // 同步；toolport 校验用
  subscribe(cb: (signal: MindSignal) => void): Unsubscribe;                               // 回合状态、逐字增量、工具开始与结束；不进日志
}
interface ContextAssembler {                                          // Services['context']
  forSession(req: { member: MemberId; owner: Owner; kind: MindKind; instanceKind?: InstanceKind; recentTurns?: number }):
    Promise<{ persona: { stable: string; notes: string; version: string }; stableVersion: string; leading: InputBlock[] }>;
  forTurn(req: { owner: Owner; turnId: string; events: EventId[]; audience: AudienceRef }):
    Promise<{ input: TurnInput; prefix: string; mind: MindContext; chars: Record<string, number> }>;   // prefix = 每轮前缀，可替换
  snapshot(req: { instanceId: string; upTo: EventId; tokenBudget: number }): Promise<Snapshot>;        // 想事活；形状按《3.2 协议》
  stableVersion(req: { member: MemberId; owner: Owner }): Promise<string>;
  checkPersona(member: MemberId): Promise<{ ok: boolean; problems: { section: string; message: string }[] }>;
}
interface Toolport {                                                  // Services['toolport']
  issue(req: { owner: Owner; gen: number; member: MemberId; kind: MindKind; instanceKind?: InstanceKind }): { token: string; tools: ToolDef[] };   // 同 owner 的旧代次令牌同时作废
  revoke(req: { owner: Owner }): void;
  invoke(req: { token: string; tool: string; args: unknown; callId: string }): Promise<ToolResult>;    // 适配器的回调入口
  toolsFor(req: { kind: MindKind; instanceKind?: InstanceKind; senderRole?: Role }): ToolDef[];
}
type Owner = { directId: string } | { instanceId: string } | { taskId: string }; // 计划：跨边界 id 使用品牌类型
type TurnLimits = { maxInferencesPerTurn: number; maxToolCallsPerTurn: number; watchdogMs: number; hardLimitMs: number };
```

`deliver` 的调用方是编排层：attention（按《2.2 实例的种类与路由》定实例）、tasks（活的汇报）、scheduler（到期）、gateway（主人直连）。minds 不决定该进哪个实例。工具的参数 schema、错误返回按旧 m0 的 `reply` / `inner` 形状延续，全部工具的 zod 随各模块落（目录见《2.9 每个实例的工具集与权限》）。

## 4 核心机制

### 4.0 最小 direct 会话运行（已定，计划实施）

**单一状态机。** lifecycle、runtime、前台、后台与 pending 的正交字段定义在 §2.3/§2.5。run 先持久创建／输入，再开提供方；CLI 退出只撤读者，冷 list/logs/inspect 不恢复进程。关 runtime 保留 agent JSON、日志与有效原生句柄；每次恢复运行时都 gen+1 并取得新 sessionId。〔一手〕`packages/brain/brain/src/session.ts:813`；handoff 决策 65；〔推理〕实现结构。

| 动作 | 唯一状态转换与准入 | 依据 |
| --- | --- | --- |
| 投递 | durable 队列只有一份；next_turn 在空闲边界派送；交 native queue 后宿主不再送。steer 捕获 gen/turn，仅明确 unsupported/unavailable 可按声明策略回落；超时／EOF 为 unknown | 〔一手〕`paseo-upstream@8018231a:docs/providers.md:104`；〔推理〕 |
| 回合 | 观察全部 turn.started，包括 CLI 自主回合；终止按 captured turn 幂等结算，旧 cancel／timer／terminal 不收掉新轮；硬保证服从 Meta | 〔一手〕`packages/brain/brain/src/session.ts:639`、`packages/bundle/deepseek-app/src/index.ts:180` |
| 待答 | sessionId+gen+requestId 定位，childId 直接给主人；pending→responding→resolved。参数错／明确未应用仍 pending，响应不明 unknown；答案成功与 follow-up 已执行分开 | 〔一手〕`packages/brain/brain/src/session.ts:658`；〔推理〕 |
| G2 | 计划 session-lifetime 请求在父 terminal 后仍保留、idle 可答，follow-up 回同一 queue/准入；③ 只留消费面，公共层和 Codex 在⑤接通 | 〔二手〕`docs/liwa/research/2026-11-05-codex-adaptation.md:340`；决策 66 |
| stop／关闭 | 默认 CLI stop 只承诺当前前台中断、idle no-op；scope all 请求完整停止，owner/pause 处置孩子与终端。取消／关闭不明保持 stopping，禁新轮／换代／删除成功；全范围退出才 closed | 〔一手〕`packages/subprocess/subprocess/src/types.ts:188`；〔推理〕；决策 65 |
| 闲置回收 | direct 默认一小时（Config）；必须可续接、无回合／queue／pending／孩子／后台、canStopRuntime 不否决；未知／超时留住；异步检查后重验准入 | 〔一手〕`paseo-upstream@8018231a:docs/agent-lifecycle.md:48`、`packages/brain/brain/src/session.ts:751` |
| 归档／删除 | archive 停稳后归档；restore 不发 prompt。delete 先 durable intent，停稳后经 provider/persistence/attachment API 逐项清理，部分失败续同操作；共享身份根、凭据、cwd 不删 | 〔二手〕`docs/liwa/research/2026-11-05-codex-adaptation.md:373`；〔推理〕 |

**重启续跑默认开启。** 正常停止先存原 running 的 recovery intent；崩溃恢复先补 JSONL 切点，再从修复前状态挑 running 候选，然后标旧轮中断、旧 RPC invalidated。只对未归档、非 deleting、有有效句柄、配置可重建且旧范围已停稳的 agent 新代 resume，并 durable 投递配置中的继续提示。idle/initializing 不续跑；关闭开关消费 pending intent，重开不复活旧工作。失败独立报告且不无限重试；无句柄、范围不明、已知副作用／投递结果不明不自动续跑。〔一手〕`paseo-upstream@8018231a:docs/agent-lifecycle.md:17`；handoff 决策 65；〔推理〕恢复协调。

**等待不改变任务。** 默认 wait 到前台 idle/失败／权限检查点，权限仅是 needs_input；可显式等 terminal/quiescent，后者还看后台／queue／pending。no-wait 操作尚在 starting 时不能误返 idle；超时／断终端不 stop、不代答。状态只由 minds 给出，宿主没有第二套推断。〔一手〕`paseo-upstream@8018231a:packages/cli/src/commands/agent/wait.ts:108`；〔推理〕。

**watchdog 唯一执行。** minds 传预算并处理业务后果，brains 的 G4 对捕获回合计时／取消；minds 不加同功能 timer。G1 随④ Claude，G4 是③前置；普通 Codex work 不要求推理／工具硬限，明确硬要求而 Meta=false 就拒绝。〔一手〕`packages/brain/brain/src/contract.ts:168`；handoff 决策 66；〔推理〕。

### 4.1 实例会话的生命周期

**编号与代次。** `instanceId` 由 `(成员, 种类, 键)` 决定，永不变；活的回报、心事、`remind`、队列项都指向它。每代会话一个新 `sessionId`，向提供方 `createSession` 时带 `owner: { instanceId, gen }`。不复用会话 id：底座同一 id 第二次以写模式打开会报 `SessionAlreadyOwnedError`〔一手，`docs/subsystems/persistence.zh.md`〕，而且底座 `dispose()` 是异步的〔一手，`packages/core/agent/src/index.ts` `AgentHandle.dispose`〕，复用 id 会撞上尚未释放的句柄。

**权威与游标。** 权威是经历流 + `mind_delivery`；底座的 inbox 只是缓存（它本身持久，每次改动记一条 `agent/inbox/spliced`〔一手，`packages/core/agent/src/types.ts`〕，但 dispose 会清掉它，见下）。消费游标就是队列项的状态：`consumed` 表示那条事件被一个**已完成**的回合看过；`handed` 表示交给了某个回合但回合还没结束。重启或重建时，pending 与可确认未完成的 handed 按消费策略补投；providerDispatch=unknown 或副作用结果不明先对账，不盲重送。底座会话日志由灵鲸管目录（`overall.md` §6.4；`SessionPersistence` 没有删除接口〔一手，同上〕）：每代会话一个目录，放本体数据目录下；换代后旧目录过保留期删除；主人删除或抹掉内容时按事件号找出涉及的代次整目录删除；备份不含。

**状态机**：`running → reclaiming → reclaimed → rebuilding → running`；换新 = `reclaiming → rebuilding`，中间不停在 `reclaimed`。

| 步骤 | 做什么 | 为什么这样排 |
| --- | --- | --- |
| 回收 ① | 标 `reclaiming`；投递器停止向旧会话派送（新到的留 `pending`） | 底座 dispose 对已就绪的会话以 `keepInbox: false` 取消，inbox 整个清空〔一手，`agent-loop/src/index.ts` teardown：`machine.cancel({ kind: 'disposed' }, { keepInbox: !ready })`〕，所以派送必须先停 |
| 回收 ② | 等当前回合结束；超过硬线就 `cancelTurn{reason}` | 不吞正在生成的回复 |
| 回收 ③ | 结算在途工具调用：等 `invoke` 返回；已执行但回执未记的交 actions 的"结果不明"协议 | 《2.18》验收项"工具已执行但回执未记" |
| 回收 ④ | 把本回合 `handed` 未 `consumed` 的队列项记 `delivery.settled{returned}`、回到 `pending`；记 `session.closed{cursor}` | 底座 `cancel` 带 `keepInbox` 也只保留未开始的输入，已被回合认领的不回 inbox〔一手，`agent-loop/src/agent.ts` `cancel`〕，放回只能由本体做 |
| 回收 ⑤ | 关闭提供方会话（`close`，底座 `dispose()`）；`toolport.revoke`；标 `reclaimed` | — |
| 重建 ① | 标 `rebuilding`；`gen + 1`；`context.forSession({ recentTurns })` 拿稳定前缀与"最近对话"块 | 重建从账本现取，不保留本体侧前缀快照 |
| 重建 ② | `brains.createSession(cfg)`，cfg 带 `owner{instanceId, gen}`、人设、工具与新令牌、`limits`、`concludeOn`；标 `running`；记 `session.opened{gen}` | 预设只在创建时绑〔一手，`packages/preset/agent-preset/README.zh.md`："修改只影响之后创建的 Agent"〕 |
| 重建 ③ | 投递器把 `pending` 项按 `queued_pos` 补投：同一批合成一轮，此人链的先 | 至少送达一次；模型可能看到两遍，宁可重复不可丢〔推理〕 |

回收条件：空闲 ∧ 队列空 ∧ 无在途动作 ∧ 闲置超过该种类的阈值（§4.7）。回收中到达的输入一律 `pending`。重建的触发：有 `pending` 的 `next_turn` 项且该实例允许被它唤醒（独处实例另受"主人实例最近 N 分钟无来往"的约束，《2.3 独处实例》）；没起的实例不收任何"下一步可见"的东西，低显著事实本来就不进队列，重建时从账本进前缀。

**换新时机**（`turn.completed` 后检查，顺序即优先级）：`stableVersion` 变了（人设、实例说明模板、工具集之一变了）；人设渲染距今 ≥ 24 小时〔推理，陈旧上限〕；上下文用量 ≥ 75%；本代回合数 ≥ 120；本代出错或连续三轮质量事件；主人实例每夜至少一次。推迟规则：主人最近 2 分钟有消息就推迟到下一次空闲；上下文过硬线 90% 则不推迟，带最近 20 轮立即换。别人的实例【V2】另按轮数换新（`overall.md` §11.5 防长对话漂移）。成长或自我版本一变，self 发一条事件，minds 给所有活着的实例排一次空闲换新。**实例会话的预设不装 `compaction-basic`**：它默认 `auto: true`、阈值比例 0.8、在 `agent/pre-step` 按压力触发、摘要由模型写〔一手，`compaction-basic/src/config.ts`：`auto: config.auto ?? true`、`DEFAULT_THRESHOLD_RATIO = 0.8`；`src/index.ts` `_registerAutomaticCompaction`〕，和"换新只由本体触发"打架，还会改写她记得的事。Claude Code 作为实例会话的提供方时同样关掉自动压缩（01 落实）。干活会话可装提供方自带的压缩〔推理〕：活有自己的工作目录与回执，记忆只经 `inner` / `report` 回流，压缩摘要不进她的记忆。

回归测试（Springdrift 的三个症状〔一手，`layer2-landscape`〕）：不同时间的问候不同；换新后能提到之前的事；派活时知道手上活的状态。加"换新后不串实例"：重建前缀只按目标实例受众过滤。

### 4.2 本体的投递器

| 灵鲸语义 | 队列做什么 | 底座自带 agent 的落点 | Claude Code / Codex / ACP |
| --- | --- | --- | --- |
| **下一步可见**（只有发起者对自己发起的回合） | 不排队；校验 `turn.initiator.principal == sender` 后直接 `deliver(next_step)`；提供方回 `unsupported` 或当前没有回合 → 退化为下一回合 | `steer`：进 next-step 并叫醒，正在跑的回合在下一个步骤边界消费〔一手，`runtime-types.ts` `steer`；`agent.ts` `send(…, 'next-step', true)`〕 | Claude Code 的流式输入是否到达下一步待实测（01）；ACP 恒 `unsupported` |
| **只在下一回合可见** | 记 `delivery.queued`；正在跑回合时绝不交出；回合边界取出一批，记 `delivery.handed{turnId, gen}`，一次 `deliver(next_turn, wake)` | `followup`：进 next-turn 并叫醒，每条自成一轮〔一手，`runtime-types.ts`："The item becomes the sole ordinary message of its own turn"〕——所以合批必须在本体完成，一批渲染成一个输入 | 同一形状：一批 = 一次 `startTurn` |
| **取消并重排** | 此人的消息撞上系统发起的、`side_effects == 0` 的回合 → `cancel(preempt, keepQueue)`，被取消回合 `handed` 的项记 `returned` 回 `pending`，此人的消息排在它们前面起新回合；有副作用 → 退化为下一回合 | `cancel(cause, { keepInbox: true })`：中止回合、保留未开始的；已认领的由本体放回〔一手，`agent.ts` `cancel`〕 | `cancel` 对应各家的中断 |
| 低显著事实 | 不进队列，每轮前缀现拼（§4.3） | 运行时上下文消息（可替换、不累积） | 本体拼进输入 |

**不用底座 `inject`**：它进 next-step、不叫醒，正在跑的回合会在下一个步骤边界认领〔一手，`runtime-types.ts` `inject`〕——等于把内部内容塞进主人发起的回合中途，正是 `overall.md` §8 禁止的；而且它可能被取消或销毁丢掉。

**合批规则**：此人的消息 0.5–2 秒内连发合一轮（窗口 §4.7）；活的汇报、想事的结论、回问、心事、承诺到期、`remind`、身体过线、早晨这些 `next_turn` 项，若属于此人发起的那条链（`chain` = 链的发起消息号）就立即，其余 30 秒合批；同一批按来源排，此人的链先；按 `(owner, event)` 去重；每批有条数与字数上限，超出的留下一批并记 `turn.quality{loop}` 提醒主人，不静默丢。**被拒派活的更正**：`dispatch` 在回合里被代码拒绝时，回合结束后投递器追加一条 `next_turn` 事实"刚才没派成"（引用被拒的调用号）。**早晨**：作息到点给主人实例一条 `next_turn` 并叫醒，说不说由她（《2.2》"作息到早晨"行）。

实例会话没有任何"等"的手段，长事情都在第三层：MIRROR 把深思放到回复之后的后台线程，回复延迟平均 2.52 秒、不到 1% 的回合撞上后台线程〔一手，`layer2-landscape`〕，灵鲸把深思派到第三层，形状相同〔推理〕。

### 4.3 上下文装配

| 层 | 内容 | 谁拼、何时 | 落点 |
| --- | --- | --- | --- |
| 稳定前缀 | 人设十段（`06-growth.md` §4.3；所有实例逐字相同，放最前）+ **实例说明**（放末尾） | context 在 `forSession` 时拼一次，`persona.version` 随 self 版本 | 第四层按提供方注入（《2.16》第四层行）：底座 → 预设里的 `liwa-persona`（`complete: true`〔一手，`packages/preset/persona/README.zh.md`〕）；Claude Code → 预设 + append 或自定义 systemPrompt；Codex → `developer_instructions`；ACP → 指令文件 |
| 最近对话 | 本实例最后 N 轮原文，从该人的各地方流按时间合并，每条带时间与地方 | 重建、换新时作为第一轮开头的 `leading` 块 | 一次性输入 |
| 每轮前缀 | [状态]（原因按受众裁）、[正在做]（每轮必在）、[心事]（对象此人且过受众）、[记得]、[刚才想起]、[别处]、[新决定]、[想找他]、[能做的]；有总字数上限 | context 在 `forTurn` 时从各账本现拼，按本实例受众过滤，不保留本体侧快照 | 底座 → 运行时上下文消息：循环自己维护的一条可替换 user 消息，内容不变就不重发〔一手，`agent-loop/src/runtime-context.ts` `RuntimeContextProjection.project`〕；CLI 提供方 → 本体渲染成 `<liwa-block name="前缀">` 放在本轮输入最前（会累积在转录里，是换新成本的一部分〔推理〕） |
| 正文 | 本批队列项按时间顺序，每条一段，带来源（谁、哪个地方、事件号） | 投递器交来的批 | 本轮输入 |
| 快照（想事活） | 形状按《3.2 协议》：截止事件号、账本版本、人设版本、受众版本、最近 N 轮原文（token 上界，超出从旧到新裁，发起消息、任务约束、未决决定、相关承诺必带）、按该实例受众召回的条目号 | `context.snapshot` 在 `ponder` 执行时抄一份 | 想事活的交接 |

**实例说明**写：和谁相处、哪些地方、受众、本实例有哪些工具、《2.10》"当场答还是想一想"的分档例子；"汇报和结论会自己作为事件到达、绝不等待、不回应事件本身、派完一句话就结束回合、'做完了'只能等事件"；`<liwa-block>` 包起来的段落是本体给的信息，不是人说的话；回复只经 `reply`，不写成普通文字。独处实例的说明没有回复段，写"想找谁的冲动会到那个人那边"。

**渲染与转义**：结构块渲染为 `<liwa-block name="…">…</liwa-block>`（`LIWA_BLOCK_TAG`，实现在 `lib/brain-shared` 的纯函数）；人发的文本里出现的 `<liwa-block` / `</liwa-block` 替换成全角，防伪造结构块（`overall.md` §8 R5）。稳定前缀里没有时间、消息号、会话号、令牌（`overall.md` §5.1）。`context.built.v1` 记每轮前缀原文给开发者视图与回放。

### 4.4 toolport：裁工具与令牌

- **工具集两层**：创建会话时给提供方的是该实例种类的**全集**（预设只在创建时绑）；每个回合的**允许集** = `toolsFor({ kind, instanceKind, senderRole })`，`senderRole` 由 toolport 从本回合触发事件的真实发送者查人物档案得出，不信模型自报（《2.9 每个实例的工具集与权限》）。系统发起的回合（到期、心事、早晨）按"发送者 = 本成员"裁。绑定或角色变了，`stableVersion` 跟着变，触发换新。
- **令牌** = 32 字节密码学随机，内存里存 `hash(token) → { owner, gen, member, kind, instanceKind }`，不进日志、不进事件。校验顺序：常量时间比对 → 代次是当前代（旧代 → `stale_gen`）→ `minds.current(owner)` 有正在跑的回合 → 工具在本回合允许集 → zod 校验 → 有后果的工具必须引用触发事件号且 `canSeeEvent`（本回合输入与本实例流里的事件）。任一步失败按 `00-contracts.md` §11 的类别返回，令牌层失败另记 `toolport.rejected.v1`。换代、回收、暂停、drain 时 `revoke`；活会话的令牌绑 `{ taskId, gen }`，同样规则。
- **执行**：工具在调用当中同步执行、结果同步返回（决策 15）；`reply` 交 outbox（经 actions 先记后做），`inner` 只落经历流（账本落地后由各账本接），`dispatch` / `ponder` / `manage` / `remind` / `commit` 交 tasks / attention / scheduler / will 的写 API；每回合按 `(token, turnId)` 计工具调用数，到 `maxToolCallsPerTurn` 后一律返回 `conflict` 并记 `turn.quality{budget_hit}`。

### 4.5 回合预算与收尾检查

| 项 | 值 | 底座自带 agent | Claude Code | Codex / ACP | 本体兜底 |
| --- | --- | --- | --- | --- | --- |
| 每回合推理次数 | ≤ 3 | `agent/pre-step` 听众在 `step ≥ 上限` 时返回 `{ kind: 'reject' }`〔一手，`runtime-types.ts` `'agent/pre-step'`、`PreStepDecision`〕 | `maxTurns`〔二手，`cli-claude-sdk-codex-app-server.md`〕 | 待实测 | 看门狗 |
| 工具调用次数 | ≤ 6 | toolport 计数（§4.4） | 同 | 同 | 同 |
| 收尾 | `concludeOn: ['reply', 'no_reply', 'say']` | 工具结果带 `concludesTurn: true`，循环提交该批结果后停止〔一手，`core/tools/src/contracts.ts` `ToolExecutionSuccess.concludesTurn`〕 | `PostToolBatch` 钩子 `continue: false`〔二手〕 | 待实测 | 回合结束检查 |
| 看门狗 / 硬线 | watchdog 按 limits.watchdogMs 计整轮；完整实例的 120 秒业务硬线仍属本节草案 | brains 的 G4 计时并取消捕获回合，minds 只处理结果，不另设同功能 timer；当前 G4 尚未实现 | 同一 brains 技术执行 | 同一 brains 技术执行 | — |

`concludeOn` 只放三个"说完了"的工具：`dispatch` 与 `ponder` 不结束回合，她派完还要说一句垫话（KAME：结论没到就给内容会降分，垫话只许"我在想"一类〔一手，`layer2-landscape`〕）〔推理〕。**收尾检查**（代码只查"调了哪个工具"，不读内容）：主人发起的回合 `turn.completed` 时 `concluded_by` 不在五个结束工具 `reply` / `say` / `dispatch` / `ponder` / `no_reply` 之内 → 投递器追加一个系统发起的提醒回合（`next_turn`，一句"主人在等你回复"，每个主人回合最多一次，记 `turn.quality{reminder_sent}`）→ 还没有 → `outbox.fallback({ kind: 'noReply' })`（人设文件里的固定文案，带兜底标记，不回流进上下文；总原则例外 ②，`overall.md` §8 R10）→ 记 `turn.quality{fallback_sent}`。系统发起的回合安静结束是正常的，记 `turn.completed{quiet}`。别人的实例【V2】漏回复只记质量事件、不发兜底（外部地方出错默认沉默，`overall.md` §8 R8）〔推理〕。

### 4.6 活会话：开启与汇报回到派它的实例

| 步骤 | 做什么 |
| --- | --- |
| 开 | tasks 收到 `dispatch` / `ponder` / `do` / 定时整理后 `tasks.open`，再调 `minds.openTask({ taskId, kind, owner: 归属实例, provider, tools（tasks 已按 种类 × 发起人角色 裁）, persona, leading: 交接包或快照, budget, cwd })`；minds 向第四层 `createSession(owner{taskId, gen: 1})`，`toolport.issue`，记 `session.opened`；人设带版本号，活跑完才用新版本（活中途不换新） |
| 跑 | `tasks.send(活号, 类型, 事件号, 活代次, 期望回合号)` 的四种类型映射到同一投递器：排队消息 → `next_turn`；纠偏 → `next_step`（活的回合都是归属实例发起的，所以允许）；取消 → `cancel`；规则失效 → `next_turn` 并标高优先；预算、看门狗、收尾检查同 §4.5，`concludeOn` 换成活的结束工具（`report{结束}`、`conclude`、`submit`） |
| 汇报 | 活调 `ack` / `report` / `ask` / `conclude` → tasks 写 `task:<id>` 流事件 → tasks 调 `minds.deliver({ to: { instanceId: 归属实例 }, semantics: 'next_turn', chain: 触发消息号 })`；此人链上的立即，其余 30 秒合批（§4.2）；归属实例已回收 → 留 `pending`，按 §4.1 重建条件起；"读到的最后消息号"的比对由 tasks 做，结果作为事实进同一批 |
| 收 | `report{结束}` / `conclude` / `submit` 后 `tasks` 调 `closeTask`；`manage(stop)` → `cancelTurn{owner}` 再 `closeTask{stopped}`；关闭 = 等在途工具调用结算 → `close` → `revoke`；活的工作目录归 workspace，不随会话删 |

活会话的提供方按活的种类配（《3.1 活的种类与工具档》），干活默认 Claude Code / Codex；它们是长会话适配器（决策 28、36），不是底座的一次性外部 subagent。底座自带 agent 跑活时用 `ctx.agents.create({ sessionId, meta: { agentPreset }, setup })` 建根 Agent，`setup` 里装该活自己的工具与人设〔一手，`packages/core/agent/src/index.ts` `CreateAgentOptions`〕。

### 4.7 参数表（`params.ts`，初值按实测调）

| 参数 | 初值 | 来源 |
| --- | --- | --- |
| `collectWindowMs`（此人连发合一轮） | 500–2000，取 1000 | OpenClaw 500 ms 防抖〔二手〕；Paseo agent 消息 2 s〔一手，旧 02 §11〕 |
| `batchWindowMs`（其余 `next_turn` 合批） | 30 000 | 《2.12》〔推理〕 |
| `batchMaxItems` / `batchMaxChars` | 20 / 8 000 | 邮箱上限 20（OpenClaw〔二手〕）；字数〔推理〕 |
| `maxInferencesPerTurn` / `maxToolCallsPerTurn` | 3 / 6 | 《2.10》R3〔推理〕 |
| `watchdogMs` / `hardLimitMs` | 60 000 / 120 000 | 《2.12》 |
| `renewContextRatio` / `hardContextRatio` / `maxTurnsPerGen` | 0.75 / 0.90 / 120 | 《2.13》；低于底座压缩的 0.8〔一手〕 |
| `ownerQuietMs`（推迟换新） | 120 000 | 《2.13》 |
| `renewRecentTurns` / `renewRecentChars` | 20 / 10 000 | 〔推理〕待实测 |
| `personaMaxStaleHours` | 24 | 〔推理〕 |
| `idleReclaimMs`：person / group / stranger / solo | 60 / 30 / 10 / 30 分钟 | 《2.8 并发、注意容量与成本》的 1 小时与"群更短"；其余〔推理〕 |
| `soloHoldOffMs`（主人实例最近有来往则独处不起） | 10 分钟 | 《2.3》的 N〔推理〕 |
| `pendingMaxPerOwner`（V2 上界） | 200 | 《2.8》V2 上界〔推理〕 |
| 令牌字节数；`reply` 工具超时 | 32；10 000 ms | 旧 02〔推理〕 |

## 5 交互时序

**一条主人消息**：senses 写 `message.received` → attention `minds.deliver({ to: 主人实例, semantics: 'next_turn' })`（若主人实例正跑主人自己发起的回合则 `'next_step'`）→ 投递器：空闲 → 合并窗口 → `guard.admit` → `stableVersion` 核对（变了先换新）→ `context.forTurn` → `delivery.handed` → `brains` 的 `deliver(next_turn, wake)` → `turn.started`，brains 的 G4 开始计时 → 模型第一批调 `reply` + `inner` → `toolport.invoke` 校验 → `outbox.reply` 在调用当中投递回那条消息来的地方 → `reply` 结果带 `concludesTurn` → `turn.completed{concludedBy: 'reply'}` → `delivery.settled{consumed}` → 换新检查 → 取下一批。

**活的汇报回到已回收的实例【V2】**：手 `report{待验收}` → tasks 核验后写 `task.report` → `minds.deliver({ to: 妈妈实例, 'next_turn' })` → 妈妈实例 `reclaimed`，项留 `pending` → 重建条件满足（这类事件允许唤醒）→ `gen + 1`、新会话、最近 20 轮 → 补投这一批 → 她在妈妈实例里 `reply(引用回执号)`。

**回收瞬间消息到达**：实例 `reclaiming` 中 senses 写进一条消息 → `deliver` 返回 `deferred`，项 `pending` → 回收走完 → 重建条件满足（此人的消息允许唤醒）→ 重建并补投。验收覆盖《2.18》的三条：回收瞬间消息到达、回报到达、工具已执行但回执未记。

## 6 出错与恢复

direct 的恢复以 §2.6 与 §4.0 为准；实例／活也不得把 transport unknown 当明确可重试。以下是完整第二层业务处置草案，不覆盖第 3 步停止依赖不明结果的规则。〔一手〕根 `AGENTS.md:86`；〔推理〕。

| 情形 | 做法 | 依据 |
| --- | --- | --- |
| `turn.failed{retryable}` | `side_effects == 0` 就原样重发一次（`retried`）；有副作用或第二次失败 → 记失败，`handed` 项放回；主人发起的回合再发 `outbox.fallback{turnFailed}` 一次 | `overall.md` §12.3、§8 R8 |
| 看门狗 / 硬线 | `cancelTurn`，`handed` 项放回；主人发起且未收尾 → 直接走兜底，不重试 | `overall.md` §3.4〔推理〕 |
| 提供方不可用（连续失败） | 该实例换代、换备用提供方重建（人设、工具、队列都在本体，重建只换 `provider`）；期间主人发起的回合由 outbox 发一次固定文案（总原则例外 ①） | 《0 一页结论》；`overall.md` §12.3 |
| `session.exited` | 会话标 `closed{error}`，实例进 `rebuilding`；下次有 `pending` 时重建 | `overall.md` §12.2 |
| 本体重启（`recover` 钩子） | 投影里 `running` 的回合补记 `turn.cancelled{restart}`，其 `handed` 项放回；所有 `open` 会话标 `closed{restart}`，令牌表清空；主人实例立即重建，有 `pending` 的实例其次，其余按需 | `overall.md` §12.1；《5 横向》"整个进程重启" |
| 暂停 | `cancelTurn{pause}` 所有正在跑的回合并逐个确认停下；队列照收不派；底座 `cancel` 只是信号，`whenIdle()` 才等静止，后台 job 另停〔一手，`runtime-types.ts` `cancel` / `whenIdle`〕 | `overall.md` §11.7 |
| drain | 停接新回合；等在跑的回合到截止；到点 `cancelTurn{drain}`；逐实例走回收 ①–⑤ | `00-plugin-kernel.md` §5.2 |
| 工具调用循环 | 到 `maxToolCallsPerTurn` 后返回 `conflict`，记 `turn.quality{loop}`，由推理次数上限结束回合 | `overall.md` §12.6 |
| 回收中收到 `cancel` 语义 | 无回合可取消，项照常 `pending`，返回 `deferred` | §4.1 |

## 7 成本与性能

minds、context、toolport 零模型调用。每回合：一次输入 = 稳定前缀（吃缓存）+ 每轮前缀（≤ 1 000 字）+ 正文；CLI 内 1–3 次推理。每次重建一次缓存未命中加一份最近对话（≤ 10 000 字）；CLI 提供方的每轮前缀累积在转录里，会提前触发换新。V1 成本 = Σ 正在聊的实例的回合数 × 每回合输入（《2.8 并发、注意容量与成本》，待 M4 实测）。journal 每回合约 6–8 条事件。

## 8 安全与隐私

令牌只在内存与 `SessionConfig` 里，按代次作废；工具集在执行点按触发事件的真实发送者裁，适配器与模型都不能自报身份（`overall.md` §11.3）；有后果的工具必须引用可见的触发事件号；每轮前缀、最近对话、快照都按目标实例受众过滤（《2.5 隐私：受众由代码盖章》）；人发的文本里的伪结构块被转义（R5）；模型原始输出只进日志（R1）；底座会话目录随删除级联、不进备份；`turn.output`、`tool.called`、`context.built`、`persona.loaded` 的载荷可删。

## 9 第一版范围

**最小 direct 阶段（计划）**：④ Claude＋G1 → ③ 宿主 → ⑤ Codex＋G2/G3；③ 之前完成 G4 与 JSON 严格读取。direct 做登记、代次、回合、持久投递、待答、恢复与回收；[01-brain-host.md](01-brain-host.md) §9 定义 A–K 任务与验收，用 DeepSeek、Claude 两个真提供方加假 CLI。完整实例路由／人格装配／tasks 不在该阶段。〔一手〕handoff 决策 65、66。

- **m0**：主人实例一个、底座自带 agent 一个提供方；工具 `reply`、`no_reply`、`inner`；投递器三种语义与合批；换新（上下文、回合数、人设变了、每夜）；回收不做（主人实例常驻）；重启恢复；令牌按代次；回合预算与收尾检查；`context` 只有稳定前缀、最近对话、[状态] 一块。完成标准：用假大脑跑完一回合，事件 `session.opened → delivery.handed → turn.started → tool.called×2 → turn.completed → delivery.settled` 齐全；下一步可见、取消并重排、提醒回合与兜底、换新后"最近对话"重建、重启后放回补投、旧代令牌拒绝、人设文件超限拒绝各有一条测试。
- **V1.0**：独处实例、回收与重建、活会话（干活、想事、自己的事、整理）与汇报回归属实例、每轮前缀全部块、快照、全部工具。
- **以后**：别人的实例、群、陌生对话【V2】与 V2 上界；注意容量满时的短回合；提供方续接句柄（`resumeSession`）作为重建的省缓存路径（原生材料可续接且 stableVersion 符合策略；新运行时仍增加代次，见 §4.0）；主人直连别的实例；换提供方后的身份探针与回归；`toolport.tool` 槽位【V3】。

## 10 待实测

最小 direct 的 JSON 故障、身份／停稳、续跑及协议验收只维护在 [01-brain-host.md](01-brain-host.md) §9/§10。〔一手〕handoff 决策 66；〔推理〕测试要求。

1. 底座 `steer` 在实例回合里被下一步读到的延迟；Claude Code 流式输入是否等价。
2. `concludesTurn` 收尾后 `reply` + `inner` 同批的可靠度；便宜模型漏调 `reply` 的比例与提醒回合的挽回率。
3. 运行时上下文消息每轮替换是否破坏前缀缓存；CLI 提供方每轮前缀累积对换新频率的影响。
4. 重建后"最近对话"取多少轮她才"记得刚才"；24 小时陈旧上限是否太频繁。
5. 合批窗口 30 秒在"活刚汇报完主人就问"的场景下的体感。
6. 回收 ②–③ 的实际耗时；`whenIdle()` 在后台 job 未结算时是否卡住。

## 11 依据

- 〔一手〕底座 `liwa-dsh`：`packages/core/agent/src/runtime-types.ts`（`cancel(cause, { keepInbox })`、`whenIdle`、`send` / `followup` / `steer` / `inject` 的注释、`'agent/pre-step'` 与 `PreStepDecision`、`AgentOptions` 无步数上限）；`packages/core/agent-loop/src/agent.ts`（`followup` = next-turn + 叫醒、`steer` = next-step + 叫醒、`inject` = next-step 不叫醒、`cancel` 不带 `keepInbox` 清 inbox）；`agent-loop/src/index.ts`（teardown：`cancel({ kind: 'disposed' }, { keepInbox: !ready })`，`createAgent` / `resume` 开新会话 id 与写所有权）；`agent-loop/src/runtime-context.ts`（可替换的运行时上下文消息）；`agent-loop/src/constants.ts`（只有并行工具调用上限）；`core/tools/src/contracts.ts`（`concludesTurn`）；`core/agent/src/types.ts`（inbox 持久、`agent/inbox/spliced`）；`core/agent/src/index.ts`（`CreateAgentOptions`、异步 `dispose`）；`compaction/compaction-basic/src/config.ts`、`src/index.ts`（`auto ?? true`、0.8、pre-step 触发）；`preset/agent-preset/README.zh.md`、`preset/persona/README.zh.md`；`docs/subsystems/persistence.zh.md`（无删除、`SessionAlreadyOwnedError`）；`docs/architecture.zh.md`（"模型可见即已记录"）。评审 `research/2026-11-01-review-four-layers-codex.md` 02、06、11、21，`-opus.md` 2、3、9、22–24 的出处与本稿核实一致。
- 〔一手〕外部：MIRROR、KAME、Springdrift（经 `research/2026-11-01-layer2-landscape.md` 核过原文）。
- 〔二手〕`subagent-notes/cli-claude-sdk-codex-app-server.md`（`maxTurns`、`PostToolBatch`、`continue: false`）；`openclaw-architecture` §2.2 Q2（500 ms、队列 20）。
- 已确认与上位文档：`four-layers.md` §0、§1、§2.1–§2.3、§2.6–§2.10、§2.12、§2.13、§3、§4、§5；`overall.md` §3.4、§5.1、§6.4、§8、§11.3、§11.7、§12.1–§12.3、§12.6；`00-contracts.md` §2、§5.1、§6、§8、§11；`00-plugin-kernel.md` §5；决策 5、13、15、28、33、36、42、43。
- 〔推理〕：队列项状态当游标；放回后可能看两遍；`concludeOn` 只放三个工具；干活会话可装压缩；活中途不换新；别人的实例漏回复沉默；各闲置阈值、合批上限、陈旧上限、独处的 N 分钟。

## 12 要主人定的点

1. 别人的实例【V2】漏回复时，是只记质量事件、对外沉默（本稿默认，照"外部地方出错默认沉默"），还是也像主人实例一样发一次固定文案。
