# 02 用脑调度（minds、context、toolport）：实例会话与活会话的机制

状态：**草稿（2026-11-02），待主人确认**。上位设计是 `four-layers.md`（已确认，决策 42、43）：它写她能做什么、实例怎么切、规则与边界；本稿只写**这些机制怎么运转**——实例会话的生命周期、本体的投递器、上下文装配、工具与令牌、回合预算与收尾、活会话的开启与汇报。规则不重复，引用按 `four-layers.md` 的小节标题。brains 与 `brain.provider` 的各家实现归 01；journal、actions、guard、procs 归 03；senses、attention、outbox、gateway 归 07；tasks 的状态机、交接包、核验归 07 之后的活模块（本稿只写它和 minds 的接缝）。依据标记：〔一手〕读过源码或规范原文；〔二手〕转述；〔推理〕自己推的。底座指 `liwa-dsh`（`dsh-base` 分支，`15ae8e46`）。

## 0 一页结论

- **minds 持有两种会话的登记与回合：实例会话与活会话。** 实例有稳定编号 `instanceId`，会话是"编号 + 代次 `gen`"，换新、回收重建、换提供方都换代；活同理（`taskId` + 代次）。两种会话都经第四层的 `brain.provider` 开，任选提供方，默认底座自带 agent（《1 四层各是什么》的三条层间规则）。
- **进来的东西先进本体的持久待投递队列，再交给提供方。** 三种送达语义：下一步可见、只在下一回合可见、取消并重排；合批、排序、去重、至少送达一次都在队列里做完；提供方不支持的语义由队列在回合边界补；被中断回合已拿到的输入由本体放回，不依赖提供方的 inbox。权威是经历流 + 这个队列；底座的会话日志是第二份转录。
- **上下文三层**：稳定前缀（人设十段所有实例逐字相同 + 末尾的实例说明）、最近对话（重建时从各地方流补 N 轮原文）、每轮前缀（从账本现拼、按受众裁、可替换不累积）。给想事活的是整份快照。
- **toolport 按"实例种类 × 触发消息的发送者角色"在执行点裁工具，令牌按代次签发**，换代即作废；适配器不能自报身份。
- **回合有预算，结束有检查**：≤3 次推理、≤6 次工具调用、看门狗 60 秒、硬线 120 秒；主人发起的回合必须以五个结束工具之一收尾，否则走漏回复兜底。
- **活会话的汇报回到派它的实例**：以 `instanceId` 为目的地，不指向任何会话对象；实例已回收就留在队列里，重建时补投。
- m0 只做主人实例 + 底座自带 agent 提供方 + 三个工具（`reply`、`no_reply`、`inner`），V1 其余放 §9。

## 1 范围与边界

| 模块 | 管 | 不管（归谁） |
| --- | --- | --- |
| minds（运行层，`core/minds`） | 实例与活的登记、状态机、代次；持久待投递队列与投递器；回合生命周期、预算、看门狗、收尾检查；换新、回收、重建；会话与回合事件；给 gateway 的进程内实时信号 | 路由（attention，《2.2 实例的种类与路由》）；对外说话（outbox）；准入与名额（guard）；提供方与进程（brains、procs）；活的状态机与核验（tasks） |
| context（运行层，`core/context`） | 稳定前缀、实例说明、最近对话、每轮前缀、想事活快照的装配；人设版本号；结构块的渲染与转义约定 | 人设内容与成长（self、06）；受众计算（people）；召回排序（memory） |
| toolport（接入层，`core/toolport`） | 令牌签发、校验、收回；工具目录与 schema；按实例种类 × 发送者角色裁；同步执行与错误返回；工具调用事件；每回合的工具调用计数 | 投递与目标解析（outbox）；副作用协议（actions）；主人专属操作（gateway） |

依赖方向按 `00-contracts.md` §4.2 的层表：toolport → minds / context / outbox；minds → context、brains、guard、journal；context → journal 与各账本的读 API。三者都不调模型、不读懂内容。

## 2 数据

### 2.1 投影（从事件重建；运行时另有内存表）

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `mind_instance` | instance_id、member、kind（`owner` / `solo` / `person` / `group` / `stranger`）、key（人、群或对话的编号）、state（`running` / `reclaiming` / `reclaimed` / `rebuilding`）、gen、session_id、provider{impl, model}、stable_version、persona_rendered_at、turns_in_gen、last_turn_at、pending_count、updated_pos | 一个 `(member, kind, key)` 只有一个实例；`instance_id` 永不变；主人实例永不 `reclaimed` |
| `mind_session` | session_id、owner（`{instanceId}` 或 `{taskId}`）、gen、kind（`MindKind`）、provider、stable_version、status（`open` / `closing` / `closed`）、close_reason、usage、opened_pos、closed_pos | 提供方句柄只在内存；`session_id = <ownerId>@<gen>`，每代一个新 id |
| `mind_turn` | turn_id、session_id、initiator{kind: `person` / `system` / `task` / `direct`, principal}、trigger_events[]、handed[]（本回合拿到的队列项）、status（`running` / `completed` / `cancelled` / `failed`）、inferences、tool_calls、side_effects、concluded_by（结束工具名或空）、usage、started_pos、ended_pos | `side_effects` 是本回合已完成的、有后果的工具调用数，取消规则用它 |
| `mind_delivery` | owner、event（要投的事件号）、semantics（`next_step` / `next_turn`）、chain（所属链的发起消息号，可空）、state（`pending` / `handed` / `consumed`）、handed_turn、attempts、queued_pos | 按 `(owner, event)` 去重；这就是"持久待投递队列"；`cancel` 不是队列项，是对正在跑回合的动作 |

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

## 3 接口

```ts
interface Minds {                                                     // Services['minds']，required 之间的进程内 API
  ensureInstance(req: { member: MemberId; kind: InstanceKind; key?: string }): Promise<{ instanceId: string; state: InstanceState }>;   // 幂等；只登记，不开会话
  deliver(req: { to: { instanceId: string } | { taskId: string }; events: EventId[]; semantics: 'next_step' | 'next_turn' | 'cancel';
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
type Owner = { instanceId: string } | { taskId: string };
type TurnLimits = { maxInferencesPerTurn: number; maxToolCallsPerTurn: number; watchdogMs: number; hardLimitMs: number };
```

`deliver` 的调用方是编排层：attention（按《2.2 实例的种类与路由》定实例）、tasks（活的汇报）、scheduler（到期）、gateway（主人直连）。minds 不决定该进哪个实例。工具的参数 schema、错误返回按旧 m0 的 `reply` / `inner` 形状延续，全部工具的 zod 随各模块落（目录见《2.9 每个实例的工具集与权限》）。

## 4 核心机制

### 4.1 实例会话的生命周期

**编号与代次。** `instanceId` 由 `(成员, 种类, 键)` 决定，永不变；活的回报、心事、`remind`、队列项都指向它。每代会话一个新 `sessionId`，向提供方 `createSession` 时带 `owner: { instanceId, gen }`。不复用会话 id：底座同一 id 第二次以写模式打开会报 `SessionAlreadyOwnedError`〔一手，`docs/subsystems/persistence.zh.md`〕，而且底座 `dispose()` 是异步的〔一手，`packages/core/agent/src/index.ts` `AgentHandle.dispose`〕，复用 id 会撞上尚未释放的句柄。

**权威与游标。** 权威是经历流 + `mind_delivery`；底座的 inbox 只是缓存（它本身持久，每次改动记一条 `agent/inbox/spliced`〔一手，`packages/core/agent/src/types.ts`〕，但 dispose 会清掉它，见下）。消费游标就是队列项的状态：`consumed` 表示那条事件被一个**已完成**的回合看过；`handed` 表示交给了某个回合但回合还没结束。重启或重建时，`pending` 与 `handed` 的都补投。底座会话日志由灵鲸管目录（`overall.md` §6.4；`SessionPersistence` 没有删除接口〔一手，同上〕）：每代会话一个目录，放本体数据目录下；换代后旧目录过保留期删除；主人删除或抹掉内容时按事件号找出涉及的代次整目录删除；备份不含。

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
| 看门狗 / 硬线 | 60 秒无事件 / 120 秒总时长 | 本体 `cancelTurn{watchdog}` / `{hard_limit}`；底座没有默认步数上限、工具调用上限或回合看门狗〔一手，Opus 评审全仓核实〕 | 同 | 同 | — |

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

**一条主人消息**：senses 写 `message.received` → attention `minds.deliver({ to: 主人实例, semantics: 'next_turn' })`（若主人实例正跑主人自己发起的回合则 `'next_step'`）→ 投递器：空闲 → 合并窗口 → `guard.admit` → `stableVersion` 核对（变了先换新）→ `context.forTurn` → `delivery.handed` → `brains` 的 `deliver(next_turn, wake)` → `turn.started`，看门狗开始 → 模型第一批调 `reply` + `inner` → `toolport.invoke` 校验 → `outbox.reply` 在调用当中投递回那条消息来的地方 → `reply` 结果带 `concludesTurn` → `turn.completed{concludedBy: 'reply'}` → `delivery.settled{consumed}` → 换新检查 → 取下一批。

**活的汇报回到已回收的实例【V2】**：手 `report{待验收}` → tasks 核验后写 `task.report` → `minds.deliver({ to: 妈妈实例, 'next_turn' })` → 妈妈实例 `reclaimed`，项留 `pending` → 重建条件满足（这类事件允许唤醒）→ `gen + 1`、新会话、最近 20 轮 → 补投这一批 → 她在妈妈实例里 `reply(引用回执号)`。

**回收瞬间消息到达**：实例 `reclaiming` 中 senses 写进一条消息 → `deliver` 返回 `deferred`，项 `pending` → 回收走完 → 重建条件满足（此人的消息允许唤醒）→ 重建并补投。验收覆盖《2.18》的三条：回收瞬间消息到达、回报到达、工具已执行但回执未记。

## 6 出错与恢复

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

- **m0**：主人实例一个、底座自带 agent 一个提供方；工具 `reply`、`no_reply`、`inner`；投递器三种语义与合批；换新（上下文、回合数、人设变了、每夜）；回收不做（主人实例常驻）；重启恢复；令牌按代次；回合预算与收尾检查；`context` 只有稳定前缀、最近对话、[状态] 一块。完成标准：用假大脑跑完一回合，事件 `session.opened → delivery.handed → turn.started → tool.called×2 → turn.completed → delivery.settled` 齐全；下一步可见、取消并重排、提醒回合与兜底、换新后"最近对话"重建、重启后放回补投、旧代令牌拒绝、人设文件超限拒绝各有一条测试。
- **V1.0**：独处实例、回收与重建、活会话（干活、想事、自己的事、整理）与汇报回归属实例、每轮前缀全部块、快照、全部工具。
- **以后**：别人的实例、群、陌生对话【V2】与 V2 上界；注意容量满时的短回合；提供方续接句柄（`resumeSession`）作为重建的省缓存路径（条件：代次不变且 `stableVersion` 未变，待实测）；主人直连别的实例；换提供方后的身份探针与回归；`toolport.tool` 槽位【V3】。

## 10 待实测

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
