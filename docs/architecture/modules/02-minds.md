# 02 用脑调度（minds、context、toolport）：m0 轻量版

状态：**草稿，待主人确认**。本稿只定 m0 终端链路（路线图 1.7）里"一条主人的消息进来后，她的在场怎么用脑、上下文怎么装、工具怎么调"的最小版；V1 其余放 §9"以后"。边界不重复 `overall.md`（§2.4、§3.3、§4.11、§5.1、§5.2、§8），只引节号。brains 与 `brain.provider` 归 01；journal、actions、guard、procs 归 03；gateway、senses、attention、outbox 归 07；用到它们的地方按 `00-contracts.md` 与 `overall.md` 已有的名字写"我需要什么"，集中在 §12。依据标记：〔一手〕读了源码或规范原文；〔二手〕转述或别人的调研；〔推理〕自己推的。

## 0 一页结论

- **minds 是她的会话外壳**：m0 只有一种会话（主人的在场），一个在场一个会话，由 `(成员, 地方)` 唯一确定；每个会话一个邮箱，同一时刻只跑一个回合；主人连发合成一轮，主人在自己发起的回合里追加消息走 steer，主人的消息抢占系统发起的回合（m0 只有 R10 的提醒回合）；回合有看门狗；接近上下文上限或轮数到了就换新，闲置一小时回收 CLI 进程、保留续接句柄（依据：`overall.md` §4.11；Paseo 上游 `agent-run-state.ts`、`idle-runtime-cleanup/index.ts`〔一手〕）。
- **context 只装两层**：稳定前缀 = 主人手写的静态人设文件（Markdown，段名与 `06-growth.md` §4.3 的十段锚一致）+ context 生成的在场说明，作为自定义 systemPrompt 一次性注入、吃缓存；每轮前缀 = 一行状态块（时间、距上次聊天多久）+ 主人的话。换新时从经历流补最近 N 轮原文。人设文件改了，下一个回合前先换新会话（Claude Code 的系统提示在会话首个请求时定格〔二手〕）。
- **toolport 只开 `reply` 与 `inner`**：每会话一个 32 字节随机令牌，适配器调 `toolport.invoke(token, tool, args)` 回本体；toolport 校验令牌、工具集、schema，`reply` 交 outbox（outbox 经 actions 先记后做），`inner` 只落经历流；每回合各最多一次；工具在调用当中同步执行、结果同步返回（决策 15）。回复必须在第一批、批结束收尾由 `SessionConfig.endTurnAfter: ['reply']` 交适配器的批结束钩子实现；主人发起的回合没回复就补一轮提醒、再没有就发固定兜底（`overall.md` §8 R10）。
- **三样东西都不调模型、不懂内容**：它们只搬运、校验、记录。m0 没有 body、attention 的心事、will、memory，这些层全部留白，接口形状按 V1 定、实现只填 m0 的部分。

## 1 范围与边界

| 模块 | m0 管 | 不管（归谁） |
| --- | --- | --- |
| minds（运行层，`core/minds`） | 在场会话登记；邮箱（合并连发、steer、抢占、排队）；回合生命周期与看门狗；换新；闲置回收与续接；会话与回合事件；给 gateway 的进程内实时信号 | 决定起不起回合（attention，07）；对外说话（outbox，07）；CLI 进程与适配器（brains / procs，01 / 03）；准入与记账（guard，03） |
| context（运行层，`core/context`） | 读静态人设文件、校验、生成在场说明；拼稳定前缀；拼每轮前缀（状态块、提醒块、最近对话）；结构块的渲染与转义约定；`MindContext` | 人设的内容与成长（self / growth，06）；状态行的身体部分（body，04）；受众计算（people，V1） |
| toolport（接入层，`core/toolport`） | 会话令牌签发、校验、收回；工具目录（m0：`reply`、`inner`）与 JSON Schema；按用脑种类过滤；同步执行与错误返回；工具调用事件 | 投递与目标解析（outbox，07）；副作用协议（actions，03）；主人专属操作（gateway，07；`overall.md` §11.6） |

依赖方向按 `overall.md` §3.2：toolport → minds / context / outbox；minds → context、brains、guard、journal；context → journal。三者都不读编排层的表；向上只走经历流事件与进程内信号。

## 2 数据

### 2.1 会话与回合（minds 的内联投影，从事件重建；运行时另有内存表）

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `mind_session` | session_id、member、kind（m0 恒 `presence`）、binding{placeId}、brain{impl, model}、stable_version（人设文件哈希 + 在场说明版本）、status（`active` / `dormant` / `error` / `closed`）、resume（`ResumeHandle`，可空）、successor、turns、last_turn_at、opened_pos、updated_pos | 一个 `(member, placeId)` 同时只有一个非 `closed` 的会话；`resume` 是 CLI 的续接句柄，只是缓存（`overall.md` §6.4） |
| `mind_turn` | turn_id、session_id、initiator（`owner` / `system`）、kind（`message` / `reminder`）、inputs[]（事件 pos）、brain_turn_id、status（`running` / `completed` / `interrupted` / `failed`）、replied、tool_calls、side_effects、usage、started_pos、ended_pos | 投影给 gateway 的会话页与开发者视图；`side_effects` 是本回合已完成的有副作用工具调用数，抢占规则用它 |

邮箱、令牌、看门狗计时器只在内存，是运行时操作数据，不进日志（`overall.md` §6.2）。

### 2.2 事件类型（写进 contracts 的 `events/minds.ts`，只有 contracts 能定义，`00-contracts.md` §6）

流：会话与回合事件进 `mind:<sessionId>`，人设装载进 `member:<memberId>`，令牌拒绝进 `system`。m0 的 `source.audienceId` 一律 `AUDIENCE_OWNER`（只有主人一个受众；people 落地后用在场的受众）；`sourceKind`：回合与工具事件 `member`，会话与系统事件 `system`；`correlationId` = turnId；`causeId` = 触发该回合的消息事件（回合事件）或 `turn.started` 的 pos（回合内事件）。命名首段是对象，与 `overall.md` 的 `turn.completed`、`effect.intended` 一致。

| 类型 | 执行者 | 载荷（信封外） | 载荷号（可删） |
| --- | --- | --- | --- |
| `session.opened.v1` | `system` | member、kind、binding、brain、stableVersion、resumedFrom? | — |
| `session.dormant.v1` | `system` | reason（`idle` / `drain`）、resume: ResumeHandle \| null | — |
| `session.resumed.v1` | `system` | — | — |
| `session.renewed.v1` | `system` | successor、reason（`context` / `turns` / `persona_changed` / `resume_failed` / `session_exited` / `owner`） | — |
| `session.exited.v1` | `system` | category、message（CLI 在两个回合之间退出） | — |
| `session.closed.v1` | `system` | reason | — |
| `turn.started.v1` | `mind:<id>` | turnId、initiator、kind、inputs[]、brainTurnId、stableVersion | — |
| `turn.steered.v1` | `mind:<id>` | turnId、inputs[] | — |
| `turn.output.v1` | `mind:<id>` | turnId、itemId（模型的最终文字，R1：只进日志） | text |
| `turn.completed.v1` | `mind:<id>` | turnId、usage、replied、toolCalls、quiet | — |
| `turn.interrupted.v1` | `mind:<id>` | turnId、reason（`preempted` / `watchdog` / `pause` / `drain` / `restart` / `owner`） | — |
| `turn.failed.v1` | `mind:<id>` | turnId、category、message、retryable、retried | — |
| `turn.quality.v1` | `system` | turnId、kind（`no_reply` / `reply_not_first` / `reminder_sent` / `fallback_sent` / `loop`） | — |
| `tool.called.v1` | `mind:<id>` | turnId、callId、tool、seqInTurn、ok、error?{category, code}、durationMs、effectId? | args、result |
| `context.built.v1` | `system` | turnId、stableVersion、chars{stable, runtime}、blocks[] 名字 | 每轮前缀原文 |
| `persona.loaded.v1`（`member:<id>` 流） | `system` | hash、chars、sections[]、file | 稳定前缀全文 |
| `toolport.rejected.v1`（`system` 流） | `system` | reason（`bad_token` / `revoked` / `no_turn`）、tool | — |

`turn.output.v1`、`tool.called.v1`、`context.built.v1`、`persona.loaded.v1` 的载荷按 `overall.md` §5.8 纳入可删级联。

## 3 接口

### 3.1 minds（`Services['minds']`，required 之间的进程内 API）

```ts
interface Minds {
  open(req: { member: MemberId; kind: 'presence'; binding: { placeId: PlaceId } }): Promise<{ sessionId: string; created: boolean }>;   // 幂等：同 (member, placeId) 返回现有会话
  send(req: { sessionId: string; initiator: 'owner' | 'system'; kind: 'message' | 'reminder'; inputs: EventId[] }): Promise<{ disposition: 'queued' | 'merged' | 'steered' | 'rejected'; turnId?: string; reason?: string }>;
  interrupt(req: { sessionId: string; reason: 'owner' | 'pause' | 'drain' }): Promise<void>;   // 幂等
  renew(req: { sessionId: string; reason: 'owner' | 'persona_changed' }): Promise<{ sessionId: string }>;
  close(req: { sessionId: string; reason: string }): Promise<void>;
  get(req: { sessionId: string }): Promise<SessionView | null>;  list(): Promise<SessionView[]>;
  current(req: { sessionId: string }): { turnId: string; initiator: 'owner' | 'system' } | null;   // 同步；toolport 校验用
  subscribe(cb: (signal: MindSignal) => void): Unsubscribe;   // 进程内信号：turn 状态变化、模型逐字增量、工具调用开始与结束；不进日志
}
```

`SessionView` = `mind_session` 一行加当前回合；`MindSignal` = `{ sessionId, turnId, kind: 'turn' | 'delta' | 'tool', ... }`，给 gateway 的实时流（`overall.md` §10.3）。

### 3.2 context（`Services['context']`）

```ts
interface ContextAssembler {
  forCreation(req: { member: MemberId; kind: 'presence'; binding: { placeId: PlaceId }; recent?: { sinceTurns: number } }): Promise<{ persona: { stable: string }; stableVersion: string; leading: InputBlock[] }>;   // leading = 换新时的"最近对话"块，放进新会话第一轮的开头
  forTurn(req: { session: SessionRef; kind: 'message' | 'reminder' | 'steer'; inputs: EventId[]; leading?: InputBlock[] }): Promise<{ input: TurnInput; mind: MindContext; chars: number }>;
  stableVersion(member: MemberId): Promise<string>;   // 人设文件哈希 + 在场说明模板版本；minds 每回合前比对
  checkPersona(member: MemberId): Promise<{ ok: boolean; problems: { section: string; message: string }[] }>;   // 给 liwa doctor
}
```

`MindContext` 按 `05-memory.md` §3.5 的形状：m0 填 `presence: ['owner']`、`visibleAudienceIds: [AUDIENCE_OWNER]`、`strictAudience: false`、`canSeeEvent` = 本回合 `inputs` 与本会话 `mind` 流里的事件。

### 3.3 toolport（`Services['toolport']`）

```ts
interface Toolport {
  issue(req: { sessionId: string; member: MemberId; kind: MindKind }): { token: string; tools: ToolDef[] };   // 会话创建或续接时由 minds 调；旧令牌同时作废
  revoke(req: { sessionId: string }): void;
  invoke(req: { token: string; tool: string; args: unknown; callId: string }): Promise<ToolResult>;   // 适配器的回调入口（SessionConfig.kernelTools.native 分支）
  toolsFor(kind: MindKind): ToolDef[];   // m0：presence → [reply, inner]；其余种类返回空表
}
type ToolResult = { ok: true; result: JsonValue } | { ok: false; error: { category: LiwaError['category']; code: string; message: string } };
```

### 3.4 m0 的两个工具（zod 写在 `contracts/tools/`，`ToolDef.schema` 由 `z.toJSONSchema` 导出；id ASCII、描述中文，`overall.md` §5.2）

| 工具 | 参数 schema | 返回 | 校验与错误 |
| --- | --- | --- | --- |
| `reply`（`firstBatch: true`，`sideEffect: 'propose'`） | `{ text: string(1–4000); event?: EventId; feeling?: { valence: -1\|0\|1; importance: 0–1; kind: string(≤12); because: string(≤80) }; reason?: string(≤120) }` | `{ ok: true, result: { effectId, delivered: boolean } }` | `event` 省略时取本回合最新的触发消息；给了就必须 `canSeeEvent`，否则 `invalid_input`；同一回合第二次 → `conflict`（"这回合已经回复过了"）；令牌对不上 → `auth`；暂停或回合已结束 → `cancelled`；outbox 投递失败 → 原错误类别透传 |
| `inner`（`sideEffect: 'none'`） | `{ feelings?: Feeling[≤5]; thoughts?: { goal: string; strength: 0–1; reason: string }[≤5]; facts?: { about: Subject; text: string(≤120); evidence: EventId[≥1] }[≤10]; concerns?: { text; waitingFor?; nextCheck?: Iso; status?: 'open'\|'done' }[≤5]; cares?: { person: string; what: string; kind: 'event'\|'long'; keyDate?: Iso }[≤5] }`，合计 ≤2000 字 | `{ ok: true, result: { recorded: { feelings, thoughts, facts, concerns, cares } } }` | `facts[].evidence` 必须 `canSeeEvent`；同一回合第二次 → `conflict`；m0 只落 `tool.called.v1`，不交任何账本（body / attention / memory / will 落地后由各账本接，形状按 `05-memory.md` §3.5 的 `FactInput`） |

`reply` 的描述写明"回复主人；必须在你的第一批工具调用里；只调一次；正文直接写话，不写旁白"；`inner` 的描述写明"一回合最多一次，和 reply 同批"。`Feeling.kind` 在 m0 是自由词（≤12 字），情绪词表归 body（04）。

## 4 核心机制

### 4.1 邮箱与回合状态机（minds）

每个会话一个邮箱，同一时刻只跑一个回合（`overall.md` §4.11；Paseo 上游 `AgentRunState` 每个 agent 只跟踪一个前台 run，`settleTerminalRun` 按 turnId 核对后才清掉〔一手〕）。m0 的规则表（行 = 邮箱收到 `send` 时的状态）：

| 当前状态 | 来的是 | 做法 | 依据 |
| --- | --- | --- | --- |
| 空闲 | 主人的消息 | 开合并窗口 `collectWindowMs`，窗口内再来的主人消息并入同一轮；窗口到期起回合 | OpenClaw 500 ms 防抖〔二手，`openclaw-architecture` §2.2 Q2〕；Paseo 对 agent 消息用 2 s 安静窗口、人发的消息不进该队列〔一手，`agent-messages/delivery.ts`〕 |
| 正跑主人发起的回合 | 主人的消息 | `session.steer(input, { expectedTurnId })`；返回 `accepted` 记 `turn.steered.v1`；返回 `unavailable` 就排成下一轮（不中断：正在跑的回合可能已经在回复） | 只有发起者能 steer（`overall.md` §4.11）；Paseo `steerOrReplaceActiveTurn` 在 unavailable 时退回"打断再重开"〔一手，`agent-prompt.ts`〕，灵鲸不照搬，理由〔推理〕：打断会吞掉已经在生成的回复 |
| 正跑系统发起的回合（m0 只有 R10 提醒回合） | 主人的消息 | `side_effects === 0` 就 `interrupt()`、记 `turn.interrupted{preempted}`，再起主人的回合；已有副作用就等它结束再起 | 决策 13、15；AIRI"有副作用就不重来"〔二手，`companion-architectures` §4.2 Q3〕 |
| 正跑任何回合 | 系统的提醒请求 | 排到当前回合结束后 | 内部内容不 steer 进主人发起的回合（`overall.md` §8） |
| 任何 | 邮箱已有 `mailboxMax` 条待处理 | 不丢：把溢出的输入合并进最后一轮，记 `turn.quality{loop}` 提醒主人 | 邮箱有上限、溢出写摘要不静默丢弃（`overall.md` §4.11） |
| 暂停中或 drain 中 | 任何 | 返回 `rejected{cancelled}`；消息仍在经历流里 | `overall.md` §11.7 第 5 条 |

回合状态机：`queued → admitted → running → (completed | interrupted | failed)`。起回合的步骤：① `guard.admit({ kind: 'turn', member, mindKind, initiator })`，`wait` 就按 `retryAfterMs` 重试到 `admitDeadlineMs`，超时记 `turn.failed{cancelled}`；② `context.stableVersion` 与会话的不一致 → 先 `renew`；③ `context.forTurn` 拼输入；④ `session.startTurn`，拿到 `brainTurnId` 后记 `turn.started.v1`，启动看门狗；⑤ 消费 `session.events()`：`item.message{final}` 记 `turn.output.v1` 并发信号；`item.tool_call.*` 只发信号（工具事实由 toolport 记）；`usage.update` 更新内存；`turn.completed` → `guard.record(usage)`、记 `turn.completed.v1`、R10 检查（§4.5）、换新检查（§4.2）；`turn.failed` → §6；`session.exited` → 会话标 `error`。每个 BrainEvent 都重置看门狗；`turnWatchdogMs` 内没有任何事件就 `interrupt()` 并记 `turn.interrupted{watchdog}`（`overall.md` §3.4）。中断时被 steer 进去的输入重新入队：宁可模型看到两遍，不可丢（适配器中断会丢掉未读 steer，`00-contracts.md` §5.1）〔推理〕。

### 4.2 换新与闲置回收（minds）

- **换新条件**（`turn.completed` 后检查）：`usage.context.used / max ≥ renewContextRatio`，或会话回合数 ≥ `maxTurnsPerSession`，或 `stableVersion` 变了。换新 = 等当前回合结束 → `context.forCreation({ recent })` 拿新的稳定前缀和"最近对话"块 → `brains` 开新会话（新令牌）→ 记 `session.renewed.v1` 与新会话的 `session.opened.v1{resumedFrom}` → 旧会话 `close`。m0 的"先写回"就是等本回合的事件全部提交（journal 同步追加，天然满足）；让她在换新前补记心事的那一轮留到 V1（§9）。CLI 的自动压缩由 brains 关掉或阈值设得更高，换新只由本体触发（`overall.md` §3.4）。
- **闲置回收**：`idleSweepMs` 一次扫描，会话空闲 ≥ `idleReclaimMs` 且 `canStopRuntime()` 为真 → `persistence()` 拿续接句柄 → `close()` → 记 `session.dormant.v1{idle, resume}`，令牌作废。下次 `send` 时 `brains.resumeSession(handle, cfg)`（人设原样带上，brains 续接后做身份探针，01）→ 记 `session.resumed.v1` 并签新令牌；续接失败 → 当作换新（reason `resume_failed`）。依据：Paseo 上游空闲 60 分钟、每 60 秒扫一次、provider 可用 `canStopRuntime` 否决、关闭前再核对一次〔一手，`idle-runtime-cleanup/index.ts`〕；`overall.md` §3.4。扫描用 `ctx.clock.timer`：这是进程资源的看门狗，不是她的生活节律，scheduler 落地后也不改走作业〔推理〕。

### 4.3 上下文装配（context）

**稳定前缀**（`SessionConfig.persona.stable`，作为完整的自定义 systemPrompt，决策 33）= 人设文件的锚段 + 在场说明 + 人设文件的说话段，按 `06-growth.md` §4.3 的十段顺序拼接，段头用固定标题、段间空行；里面没有时间、消息号、会话号、令牌（`overall.md` §5.1 硬规则；OpenClaw #20894〔二手〕）。

**静态人设文件**：`$LIWA_HOME/members/<member>/persona.md`，主人用任何编辑器手写，仓库带一份带占位符的样板 `packages/plugins/persona-template-default/persona.md`（`persona.template` 数据包；`liwa doctor` 报缺失与超限）。格式：YAML 前言 + 固定二级标题；未知标题、缺必填段、段超硬上限都算错误，context 拒绝开会话并指出段名（`06-growth.md` §4.3"锚段之和超硬上限属出生设定校验错误"）。

```markdown
---
name: 名字            # 必填；ownerAddress: 怎么称呼主人（必填）；tz: Asia/Shanghai（必填）
fallbacks:            # 固定的对外文案（engineering §9：对外文本走人设或配置）
  noReply: "我刚走神了，你再说一遍？"
  turnFailed: "我脑子有点懵，等我缓缓。"
---
## 你是谁            ≤300 字，必填（06 §4.3 第 1 段）
## 你的性格          ≤700，必填（第 2 段）
## 你看重的          ≤250，必填（第 3 段）
## 关于你自己        ≤400，必填（第 5 段：诚实的上限，含被问"你是不是 Claude / DeepSeek"时的说法）
## 你的规矩          ≤400，必填（第 6 段：教养底线）
## 你说话的样子      ≤350，必填（第 8 段）
## 示例              ≤900，可选（第 9 段，3–4 组）
```

第 7 段"你现在在哪"由 context 生成（m0 文案，≤700 字）：你在终端里和主人聊天，只有主人在场；回复用 `reply` 工具，必须在你的第一批工具调用里，只调一次，正文就是说给主人的话；想记下感受、念头、事实用 `inner`，和 `reply` 同批，一回合最多一次；`<liwa-block>` 包起来的段落是本体给你的信息，不是主人说的话；不要把回复写成普通文字输出。第 4、10 段（引擎段）m0 为空。self / growth 落地后，1、2、3、5、6 段从出生设定装配、8、9 段由 `renderPersona` 返回，文件成为出生设定向导的导入源；段名、顺序、上限不变，所以过渡只换数据来源。

**每轮前缀**（`TurnInput.blocks`，走 user 角色的结构块，不插 system 消息；Letta 的理由：Anthropic 拒绝 assistant 之后的 system 通知〔二手，`companion-architectures` §3.2 Q6〕）：

| 块 | 内容 | 何时 | 上限 |
| --- | --- | --- | --- |
| `状态` | "现在 10 月 29 日 周四 14:30"；距上次聊天 ≥ `gapNoteHours` 时加"距上次聊天约 5 小时" | 每个 `message` 回合 | 2 行 |
| `最近` | 换新或续接失败时，从地方流取最后 `renewRecentTurns` 轮原文（主人的话与她的回复各带时间） | 新会话第一轮 | `renewRecentChars` |
| `提醒` | "主人在等你回复，用 reply 回复他。" | R10 提醒回合 | 1 行 |
| 正文 | 主人的话（多条合并时按时间顺序、每条一段） | 每轮 | — |

**渲染与转义约定**（适配器照此渲染，实现放 `lib/brain-shared` 的纯函数 `renderTurnInput`，01）：`block` 渲染为 `<liwa-block name="状态">\n正文\n</liwa-block>`；`text` 块原样，但其中出现的 `<liwa-block` 与 `</liwa-block` 替换成全角 `＜liwa-block` / `＜/liwa-block`，防止主人（以后是外人）伪造结构块（`overall.md` §8 R5；Paseo 的信封对人发的消息做 XML 转义、只接受完整信封〔一手，`agent-messages/envelope.ts`〕）。`context.built.v1` 记每轮前缀的原文，给开发者视图与 L1 回放。

**缓存边界**：稳定前缀在 systemPrompt 里；Claude Code 在会话首个请求时定格系统提示、续接沿用、中途改不了（`snapshot` 默认 true〔二手，`subagent-notes/cli-claude-sdk-codex-app-server.md`〕），所以人设变化只在换新时生效，minds 每回合前比对 `stableVersion` 就是为了这一点。每轮前缀每次都变，放 user 块不碰缓存。

### 4.4 会话令牌（toolport）

令牌 = 32 字节密码学随机（toolport 与 gateway 是 ESLint 禁随机规则的例外，评审处理"安全令牌用密码学随机源"），只在内存里存 `hash(token) → { sessionId, member, kind, issuedAt }`，不进日志、不进事件、不进 `SessionConfig` 以外的任何地方。校验：常量时间比对 → 会话存在且非 `closed` / `dormant` → `minds.current(sessionId)` 有正在跑的回合 → 工具在 `toolsFor(kind)` 里 → zod 校验参数。任一步失败按 §3.4 的类别返回，令牌层失败另记 `toolport.rejected.v1`。收回：会话关闭、换新、转 dormant、暂停时 `revoke`；续接重新 `issue`。依据：每次用脑一个令牌、Paseo 共用令牌的反例（`overall.md` §11.3〔二手〕）。

### 4.5 批结束与漏回复兜底（toolport + minds）

- **回复在第一批、批结束收尾**：minds 在 `SessionConfig` 里传 `endTurnAfter: ['reply']`、`limits: { maxTurns, maxToolCallsPerTurn }`；适配器用 CLI 的工具批结束钩子在含 `reply` 的批结束后收尾（Claude Agent SDK 有 `PostToolBatch`，钩子可返回 `continue: false`〔二手，同上〕），省掉第二次推理（`overall.md` §5.2）。toolport 不自己推断"批"：它只记 `seqInTurn`；"reply 是否在第一批"由探针（路线图 1.3）在适配器层测量，并建议 01 在 `item.tool_call.started` 上带可选的 `batch` 序号（§13）。
- **R10 兜底**：主人发起的 `message` 回合 `turn.completed` 时 `replied === false` → minds 起一个 `reminder` 回合（`initiator: 'system'`，每个主人回合最多一次）→ 还没有 `reply` → `outbox.fallback({ sessionId, event, kind: 'noReply' })`（文案取人设文件 `fallbacks.noReply`，带兜底标记，不回流进上下文，`overall.md` §8 R8）→ 记 `turn.quality{fallback_sent}`。模型的原始文字永远不直接转发（R1）。

### 4.6 参数表（`params.ts`，带单位；初值按实测调）

| 参数 | 初值 | 来源 |
| --- | --- | --- |
| `collectWindowMs` | 500 | OpenClaw 防抖〔二手〕；Paseo agent 消息 2000〔一手〕 |
| `mailboxMax` | 20 | OpenClaw 队列上限〔二手〕 |
| `admitDeadlineMs` / `retryAfterMs` 缺省 | 30 000 / 1 000 | 〔推理〕 |
| `turnWatchdogMs` / `turnHardLimitMs` | 120 000 / 600 000 | `overall.md` §3.4；OpenClaw 手的 60 分钟看门狗〔二手〕；在场回合短〔推理〕 |
| `idleReclaimMs` / `idleSweepMs` / `canStopProbeMs` | 3 600 000 / 60 000 / 10 000 | Paseo 上游〔一手〕 |
| `renewContextRatio` / `maxTurnsPerSession` | 0.75 / 120 | 比 CLI 自动压缩低（`overall.md` §3.4）〔推理〕 |
| `renewRecentTurns` / `renewRecentChars` | 20 / 10 000 | 〔推理〕，待实测 |
| 稳定前缀目标 / 硬上限、在场说明、每轮前缀 | 4 500 / 8 000、700、1 000 字 | `06-growth.md` §4.3；`overall.md` §5.1 |
| `gapNoteHours` | 3 | 〔推理〕 |
| `maxTurns`（CLI 内步数）/ `maxToolCallsPerTurn` | 4 / 6 | 一回合 1–3 次推理（`overall.md` §13）〔推理〕 |
| 令牌字节数；`reply` 工具超时 | 32；10 000 ms | 〔推理〕 |

## 5 交互时序：m0 的完整一回合

```
liwa chat 发 "在干嘛"
 ▼ gateway → senses（07）：写 message.received.v1 进 place 流，来源人主人，受众主人
 ▼ attention（07）：主人消息 → minds.open({member, presence, {placeId}})（幂等）→ minds.send({sessionId, initiator:'owner', kind:'message', inputs:[pos]})
 ▼ minds：邮箱空闲 → 合并窗口 500 ms → guard.admit（03）→ stableVersion 核对（变了先换新）
 ▼ context.forTurn：blocks = [状态块, 正文]；MindContext{presence:['owner'], canSeeEvent}
 ▼ minds → brains（01）：session.startTurn(input) → turn.started.v1；看门狗开始；events() 流转成 MindSignal 给 gateway
 ▼ CLI（Claude Code + DeepSeek Flash）在第一批同时调 reply 与 inner → 适配器 → toolport.invoke(token, 'reply', args)
 ▼ toolport：令牌 → 会话与回合 → 工具在集合里 → schema → outbox.reply({mind, event, content, feeling?, reason?})（07）
 ▼ outbox → actions.run（03）：effect.intended → 投递回终端 → effect.completed → 返回 {effectId, delivered}
 ▼ toolport：tool.called.v1{reply, ok} → 结果同步回 CLI；inner 同理，只记 tool.called.v1
 ▼ 适配器：批结束钩子收尾（endTurnAfter）→ turn.completed{usage}
 ▼ minds：guard.record（03）→ turn.completed.v1{replied:true} → 换新检查 → 邮箱放下一轮
```

主人看到回复发生在 `reply` 执行当中，之后 CLI 的收尾不计入延迟（`overall.md` §2.4）。steer、抢占、R10、换新、续接的分支见 §4。

## 6 出错与恢复

| 情形 | 做法 | 依据 |
| --- | --- | --- |
| `turn.failed{retryable}` | 本回合 `side_effects === 0` 就原样重发一次（`retried: true`）；有副作用或第二次失败 → 记失败；主人发起的回合再发 `outbox.fallback{turnFailed}` 一次 | `overall.md` §12.3（AIRI 规则）、§8 R8 |
| 看门狗中断 | 记 `turn.interrupted{watchdog}`；主人发起且未回复 → 直接走兜底，不重试（卡住的 CLI 可能再卡） | `overall.md` §3.4〔推理〕 |
| `session.exited`（两个回合之间 CLI 退出） | 会话标 `error`；下次 `send` 用同一大脑开新会话，上下文从经历流重建，不读旧转录 | `overall.md` §12.2、§6.4 |
| 续接失败 | 换新（`resume_failed`），带"最近对话"块 | `overall.md` §3.4 |
| 本体重启（`recover` 钩子，第 3 阶段） | 投影里 `running` 的回合补记 `turn.interrupted{restart}`；`active` 会话有续接句柄的改 `dormant`、没有的改 `closed`；令牌表清空 | `overall.md` §12.1 第 2、8 步；Paseo 启动把残留 running 修成 closed〔二手，`paseo-architecture` Q9〕 |
| 暂停（guard 的暂停信号，03） | `interrupt` 所有正在跑的回合并逐个确认停下，新 `send` 返回 `cancelled`；恢复后不自动重放暂停期间的消息（汇总注入留 V1） | `overall.md` §11.7 |
| drain（关闭第一步） | 停接新回合；等在跑的回合到截止；到点 `interrupt`；对每个会话 `persistence()` → `close()` → `session.dormant{drain}` | `00-plugin-kernel.md` §5.2 |
| 同一工具同样参数反复调用 | `maxToolCallsPerTurn` 到上限 → 后续返回 `conflict` 并记 `turn.quality{loop}`；由 CLI 的 `maxTurns` 结束回合 | `overall.md` §12.6 |

## 7 成本与性能

minds、context、toolport 本身零模型调用。每回合：1 次 `startTurn`，CLI 内 1–3 次推理（回复在第一批 + 收尾钩子）；输入 = 稳定前缀（目标 4 500 字，吃缓存）+ 每轮前缀（≤1 000 字，m0 实际约 100 字）+ 正文。换新一次多付一份"最近对话"（≤10 000 字）与一次前缀缓存写入；闲置回收后续接不重发前缀（CLI 转录里有）。journal 每回合约 4–6 条事件，载荷几 KB。R10 提醒回合是全价回合，探针会给出触发率。

## 8 安全与隐私

- 令牌只在内存与 `SessionConfig` 里；适配器不能自报身份，toolport 从令牌推出成员、种类、会话（`overall.md` §11.3）。
- 工具集按种类过滤；m0 在场只有两个工具，没有任何主人专属操作（§11.6）。
- `reply.event`、`inner.facts[].evidence` 必须 `canSeeEvent`：本回合输入与本会话的事件，模型引用不到别处的事件号。
- 人设文件只有主人能写（文件权限 0600，`liwa doctor` 检查）；`persona.loaded.v1` 的全文载荷可删。
- 主人（以后是外人）文本里的伪结构块被转义（R5）；模型原始输出只进日志（R1）。
- m0 没有网络内容，`taint` 恒 false；污染标记的传播留 V1。

## 9 第一版范围

**m0 做**：§2–§6 全部；minds 只有在场一种会话；context 只有稳定前缀两段来源、三种每轮块；toolport 只有 `reply`、`inner` 与 `native` 分支的 `invoke`。完成标准（I4）：用假大脑（testkit 录放）跑完一回合，事件 `session.opened → turn.started → tool.called×2 → turn.completed` 齐全；steer、抢占提醒回合、换新后"最近对话"重建、闲置回收与续接、重启后 `turn.interrupted{restart}`、令牌失效拒绝、人设文件超限拒绝各有一条测试。

**以后**（一句一条）：慢想、手、睡眠三种会话与慢想的优先级邮箱、温热保留；换新前让她补记心事的写回回合；派活交接包与 tasks 状态机、子会话、主人直连；workspace 的写租约与快照；outbox 规则 R1–R12 的其余部分（`say`、`relay`、家规、平台限频、出站轻查、言行回查）；注意容量与"等我一下"；每轮前缀的其余层（正在做、心事、记得、刚才想起、别处简讯、新决定、想找他）与按受众裁剪；消融开关；状态行的身体部分；非主人的 steer 规则与群聊两道门；请示三路、垫话与待决事项期限；权限沿请示链、污染标记；重启后的续跑提示与暂停期间的汇总注入；换大脑与回归；`look`、`consult`、`flag`；`toolport.tool` 槽位（V3）与 `kernelTools.endpoint` 分支的 HTTP MCP 端点；动身（V2）。

## 10 待实测

1. `reply` 与 `inner` 同批、`endTurnAfter` 经批结束钩子收尾在 Claude Code + DeepSeek 上是否可靠；每回合真实推理次数（`overall.md` §17 第 32、35 项）。
2. 会话中途 steer（SDK 流式输入）是否被当前回合读到；`unavailable` 的出现频率（第 2 项）。
3. `usage.context` 的上报完整度，决定 `renewContextRatio` 能否生效；报不出就只按回合数换新（第 6 项）。
4. 换新后的新会话能否命中前缀缓存（第 23、38 项）；`renewRecentTurns` 取多少轮她才"记得刚才"。
5. 闲置回收后续接：身份探针通过率、首回合延迟。
6. 便宜模型把回复写成普通文字而不调 `reply` 的比例、R10 提醒回合的挽回率；`reply.event` 省略与填错的比例。
7. 结构块渲染为 `<liwa-block>` 时模型是否把它当成主人的话；转义是否被绕过。
8. `collectWindowMs` 在终端 REPL 里是否有感。

## 11 依据

- 〔一手〕Paseo 上游 HEAD `7d74ae5`（2026-10-29）`packages/server/src/server/agent/`：`agent-run-state.ts`（每 agent 一个前台 run、按 turnId 核对后结算、最近 50 个已结算 turn 去重）；`agent-prompt.ts`（`sendPromptToAgent` 唯一入口；旁路命令不打断；steer 不可用时打断重开）；`agent-messages/delivery.ts`（按接收方排队、2 s 安静窗口合并、人发消息不进队列）、`envelope.ts`（带版本与来源属性的信封、XML 转义、只接受完整信封、系统注入标 `<paseo-system>`）；`idle-runtime-cleanup/index.ts`（60 分钟空闲、60 秒扫描、家族整体判断、`canStopRuntime` 10 秒超时、关闭前再核对）；`agent-stream-coalescer.ts`（60 ms 合帧、首帧立刻发，归 gateway 的实时流）；`timeline-projection.ts`（工具调用生命周期行合并，归 gateway 的时间线）。本机 Helm 0.11.1 对照：无 `agent-messages/`、`idle-runtime-cleanup/`、`finish-subscriptions/`，`agent-prompt.ts` 只有无来源属性的 `<paseo-system>` 包装。
- 〔一手〕`packages/contracts/src`：`common.ts`、`events/envelope.ts`、`slots/brain.provider.ts`、`services.ts`、`ledgers/index.ts`；`packages/kernel/src/plugin.ts`、`types.ts`（`defineService`、`ready` / `drain` / `recover`、`Clock` / `Ids`）。
- 〔二手〕`subagent-notes/cli-claude-sdk-codex-app-server.md`（`snapshot` 默认 true、`settingSources`、`PostToolBatch`、钩子 `continue: false`、`maxTurns`）；`openclaw-architecture` §2.2 Q2（500 ms 防抖、队列 20、只有请求者能 steer、#30197）；`companion-architectures` §3.2 Q6（user 角色提醒）、§4.2 Q3（有副作用不重来）；`structure-validation` M3、M8、M11、M14；`paseo-architecture` Q3、Q4、Q9。
- 已确认文档：`overall.md` §2.4、§3.3、§3.4、§4.2、§4.11、§5.1、§5.2、§6.2、§6.5、§8、§11.3、§11.7、§12.1–§12.3、§13、§17；`00-contracts.md` §2、§4、§5.1、§6、§8；`00-plugin-kernel.md` §5、§7、§8；`engineering.md` §4.7、§4.8、§5、§7、§9；`06-growth.md` §4.3（草稿，只借段名、顺序、上限）；决策 5、11、12、13、15、31、32、33。
- 〔推理〕：steer 不可用时排队而非打断；中断时重投 steer 过的输入；换新与回合数阈值；闲置扫描用基础设施定时器；`reply.event` 可省略；看门狗中断不重试；参数表里标〔推理〕的数值。

## 12 接缝清单

**我需要别的模块提供什么**

| 模块（归属） | 我需要的 | 备注 |
| --- | --- | --- |
| brains（01） | `createSession(ctx, member, 'presence', SessionConfig)` / `resumeSession`，返回 `BrainSession`；m0 的大脑绑定从 profile `members.<id>.slots['brain.provider']` 解析（没有 roster）；`SessionConfig.kernelTools` 走 `native` 分支并把 `toolport.invoke` 接到 SDK 进程内工具；`endTurnAfter` 经批结束钩子实现；`turn.completed.usage.context` 尽量上报；`canStopRuntime`；人设在拉起与续接时都带上并做身份探针 | 建议 `item.tool_call.started` 加可选 `batch` 序号 |
| brain-shared（01） | 纯函数 `renderTurnInput(TurnInput) → string` 按 §4.3 的渲染与转义约定 | 所有只吃文本的适配器共用 |
| journal（03） | `append`、`read` 按流读（`{ stream, from?, limit? }`）、`subscribe`、`putPayload`、`registerProjection`；`events/minds.ts` 的类型进 `EVENT_TYPES` | 现有 `Journal.read` 没有流过滤，§13 |
| guard（03） | `admit({ kind: 'turn', member, mindKind, initiator }) → { decision: 'allow' \| 'wait' \| 'deny'; retryAfterMs?; reason? }`；`record({ member, mindKind, usage })`；暂停 / 恢复的进程内信号或系统流事件 | 决策 15 的预留名额在 guard |
| actions（03） | 只间接用：outbox 的 `reply` 经 `actions.run`；`effect.*` 的 `correlationId` = turnId、`causeId` = `turn.started` 的 pos，便于回合页串起来 | — |
| senses / attention（07） | `message.received.v1` 载荷含 `text`、`placeId`、来源人；attention 对主人消息调 `minds.open` + `minds.send`；m0 的地方 id 字面（建议 `terminal`） | — |
| outbox（07） | `reply({ mind: { sessionId, turnId, member }, event, content: { text }, feeling?, reason? }) → { effectId, delivered }`（同步，在工具调用当中完成）；`fallback({ sessionId, event, kind: 'noReply' \| 'turnFailed' })`；她的回复写进地方流（`message.sent.v1` 或等价），context 换新时读它 | 目标只由 outbox 从事件解析（R2） |
| gateway / cli（07） | 订阅 `minds.subscribe` 做实时流与会话列表；`liwa doctor` 调 `context.checkPersona`；`liwa tail` 读 journal | — |
| body / attention / memory / will（04、05、V1） | `inner` 的五类记录各自的写 API；状态行的身体部分；情绪词表 | m0 只落日志 |

**我向别的模块提供什么**

| 接口 | 给谁 |
| --- | --- |
| `minds.open` / `send` / `interrupt` / `renew` / `close` / `get` / `list` / `current` / `subscribe`（§3.1） | attention、gateway、toolport、guard（暂停） |
| `context.forCreation` / `forTurn` / `stableVersion` / `checkPersona`、`MindContext`（§3.2） | minds、gateway（doctor）、以后的 memory（`recall` 的 ctx） |
| `toolport.issue` / `revoke` / `invoke` / `toolsFor`，`reply` 与 `inner` 的 `ToolSpec` / `ToolDef`（§3.3、§3.4） | minds、brains 适配器、探针 |
| 事件类型 §2.2 与投影 `mind_session`、`mind_turn` | gateway、replay、guard |

## 13 建议改的已确认文档

- `00-contracts.md` §7 / `ledgers/index.ts`：`Journal.read` 加按流读取（`{ stream, from?, limit? }`）；没有它 context 换新时只能全局扫。
- `00-contracts.md` §5.1：`item.tool_call.started` 加可选 `batch: number`，让"回复在第一批"可度量；不加也不影响 m0。
- `00-contracts.md` §6 与 `events/envelope.ts` 注释写"模块.动作.v<n>"，而 `overall.md` 与本稿的首段是对象（`turn`、`session`、`tool`、`effect`、`message`）；建议把注释改成"对象.动作.v<n>"，避免实现者按模块名起名。
