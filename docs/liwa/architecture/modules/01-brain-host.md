# 01 常驻宿主与终端命令（brain-host）：本机托管与 Paseo 功能对齐

状态：**已确认，计划实施**（2026-11-05，handoff 决策 62–66）。推进为 **④ Claude Code → ③ 本模块 → ⑤ Codex**。配套[流程图页](01-brain-host.html)，[图页源](01-brain-host.src.html)。本文只定义宿主与终端面；数据和生命周期由 [02-minds.md](02-minds.md) 唯一拥有，提供方由 [01-agent-cli.md](01-agent-cli.md) 唯一拥有。〔一手〕主人定稿与顺序决定。

## 0 一页结论

**第 3 步采用 brain-host 常驻 profile 与轻 liwa brain 客户端，复用底座服务、鉴权、RPC、配置、插件、storage-json 与 JSONL；不搬整块 Paseo daemon。** minds 持有唯一 direct 登记／代次／回合／投递／待答状态机，brains 持有提供方句柄与技术约束。〔一手〕handoff 决策 62、65；`docs/architecture.md:41`。

| 方案 | 已定结果 | 依据 |
| --- | --- | --- |
| 推进顺序 | **④ Claude Code＋G1 → ③ 本宿主 → ⑤ Codex＋G2/G3**；G4 与 JSON 严格读取在③前完成 | 〔一手〕handoff 决策 66 |
| 功能 | run/ls/logs/attach/send/wait/stop/inspect/permit/archive/delete/provider/usage 与 start/status/restart；完整对齐见 §9.1 | 〔一手〕`paseo-upstream@8018231a:packages/cli/src/cli.ts:64`；〔推理〕装配 |
| 数据 | 一个逻辑 agent 一个 JSON，操作／受管进程台账逐条 JSON，事件 JSONL；登记与生命周期定义只在 02-minds／01-agent-cli | 〔一手〕handoff 决策 62；`packages/storage/storage-json/README.zh.md:90` |
| 本机连接 | 回环 HTTP＋底座 Cookie/Gateway；当前无远端目标／配对／独立客户端；多端阶段走主人 SSH VPS | 〔一手〕handoff 决策 63、65 |
| 协议 | 新字段可选、不删字段、不收窄、双向可解析，新能力边界检查一次 | 〔一手〕`paseo-upstream@8018231a:docs/protocol-compatibility.md:11` |
| 默认行为 | 自动续跑合格 running；人工 send 默认 interrupt；wait 遇权限返回；stop 默认仅中断当前轮，scope all 全停 | 〔一手〕handoff 决策 65；`paseo-upstream@8018231a:docs/agent-lifecycle.md:17` |
| 资源 | 按登记身份显示进程与 RSS；direct 闲置一小时回收，未知后台／待答不收 | 〔一手〕`packages/brain/brain/src/session.ts:751`；〔推理〕采样 |
| 实施与验收 | 按 A–K；DeepSeek、先接通的 Claude 两个真提供方加假 CLI；Apple Silicon Mac | 〔一手〕handoff 决策 65、66 |

第 1、2 步和当前一次性 brain CLI 已有实现；本文件是**已确认的实施设计**，不宣称宿主与计划接口已交付。〔一手〕`packages/bundle/brain-cli/src/index.ts:308`。

## 1 范围与边界

本模块定义本机宿主装配、终端命令与协议、跨模块交互和验收；minds 的数据／生命周期只引用 [02-minds.md](02-minds.md) §2.3–§2.7、§4.0，提供方和进程义务只引用 [01-agent-cli.md](01-agent-cli.md) §2/§4.12，计划公共接口见 [00-contracts.md](00-contracts.md) §5.1。宿主不是第二个会话 manager。〔一手〕handoff 决策 65；〔推理〕模块分工。

**先④再③再⑤。** Claude provider 可直接插入已有 ctx.brains，用当前一次性 liwa brain run 与真实 CLI 验收；G1 随它完成。宿主实现时已有 DeepSeek、Claude 两个真提供方，G4 与关键 JSON 严格读取为前置；Codex、G2/G3 后接同一宿主。〔一手〕handoff 决策 66。

| 边界 | 本步责任 | 所有者／依据 |
| --- | --- | --- |
| 进程外壳／连接 | brain-host/brain 的正常 profile、ready/drain、本机 RPC；连接退出不释放任务 | 底座 app-boot/Connection/Gateway；`docs/architecture.md:41`〔一手〕 |
| 会话运行 | 调 minds 的唯一业务 API，不在 gateway/CLI 推断一份状态 | [02-minds](02-minds.md) §4.0；决策 65〔一手〕 |
| 提供方／进程 | 通过 brains/subprocess 的公开能力开、停、查资源和清理 | [01-agent-cli](01-agent-cli.md) §4.12；〔推理〕接缝 |
| 网页 | liwa web 默认行为不变，仍走现 session-controller | `packages/api/session-controller/README.md:11`〔一手〕 |
| 产品扩展 | 工作区／独立终端／调度下一批；全局 home/本事/MCP/插件产品配置另阶段 | 决策 56、65〔一手〕 |
| 多端 | 手机／独立客户端完成后走主人 VPS；本步只保兼容 API，不建设备同步和远端后端 | 决策 63〔一手〕 |

同机多个 CLI 调用的并发、断线与幂等是当前正确性要求，不是多端系统。原生孩子只观察／记录并直推主人审批；跨 CLI 子活归 tasks，不开放 agent 通过管理 CLI 绕权限链。〔一手〕`[01-agent-cli.md](01-agent-cli.md) §0`；〔推理〕。

## 2 数据归属

本模块不另定义持久表或生命周期。读写通过数据所有者的公开 API；ls 读其逐条 JSON 记录的 domain 视图，logs/attach 读其 JSONL 提交前缀。〔一手〕`packages/storage/storage-domain/README.md:83`；handoff 决策 62、65。

| 事实 | 唯一定义 | 宿主使用方式 |
| --- | --- | --- |
| agentId/directId、gen、turn/operation/delivery、cursor 与正交状态 | [02-minds.md](02-minds.md) §2.3 | 传精确目标与预期代次，不解析 native id |
| 一 agent 一 JSON、操作记录与字段、版本／配置／resume／pending／摘要 | [02-minds.md](02-minds.md) §2.4–§2.5 | 业务查询只经 minds；不私读 JSON 或建 SQL 索引 |
| JSON 与 JSONL 的 intent/flush/checkpoint/回执、发布切点与严格读 | [02-minds.md](02-minds.md) §2.6–§2.7 | 等领域提交结果后返回；unknown 不能变成功 |
| 进程出生身份、owner、scope、逐条台账 | [01-agent-cli.md](01-agent-cli.md) §2.1 | 经 subprocess 核对／清理／采样 |
| 创建／回合／投递／待答／回收／归档删除／自动续跑 | [02-minds.md](02-minds.md) §4.0 | 宿主只组织 drain 与 API 调用，不持第二队列 |

表中分工为〔一手〕主人定稿（handoff 决策 62、65）；具体实现切面为〔推理〕。JSON 后端现有“损坏读作 absent”必须通过原 storage seam 的严格读取补口处理，当前代码不能当已具备该保证。〔一手〕`packages/storage/storage-json/src/per-record-unit.ts:178`。

## 3 接口

### 3.1 终端命令（已定，计划实现）

入口为 `liwa brain …`，经 profile 启动。目标命令是 provider ls/diagnostic、常驻 run；当前代码中的 list/probe/一次性 run 只用于宿主实现前的提供方验收，第三步的实现与例子同步对齐下表，不维持两套生命周期。〔一手〕`packages/bundle/brain-cli/src/startup.ts:81`；handoff 决策 65、66。

| 命令（省略 liwa brain） | 主要参数与语义（均为〔推理〕） | Paseo 依据／差异 |
| --- | --- | --- |
| start/status/restart；host serve/stop | 目标是本机 LIWA_HOME；start 幂等且等 ready，status 不拉起；serve 前台起同 profile；restart 排空、停稳、换宿主，stop 停宿主；timeout/force 不绕过身份核对 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/daemon/start.ts:7、37；paseo-upstream@8018231a:packages/cli/src/commands/daemon/restart.ts:18；Paseo supervisor 不整块搬 |
| host reload | 完整校验，返回 applied/restartRequired/rejected；安全值下次 session 生效，结构变动不自动重启 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/daemon/reload.ts:63；paseo-upstream@8018231a:public-docs/configuration.md:67 |
| run prompt | provider/model/mode/cwd/member/title/label/image/no-wait/wait-timeout/request-id；默认等完成或权限检查点，no-wait 在持久 admission 后返回 agentId/operationId | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/run.ts:25；会话不随 CLI 退出关闭 |
| ls | all/global/cwd/provider/state/label；默认当前 cwd 未归档，可列冷记录且不启动 CLI | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/ls.ts:13；从 JSON domain 记录查，非 SQL |
| inspect id | generation/operation/json；状态、配置来源、能力、resume、pending、进程／内存、错误；不输出秘密 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/inspect.ts:8 |
| logs id / attach id | tail/since/filter/after cursor/follow/json；logs 查 JSONL，attach 持续跟随；Ctrl-C 只断开；冷读不唤醒 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/logs.ts:14；paseo-upstream@8018231a:packages/cli/src/commands/agent/attach.ts:3、129 |
| send id prompt | prompt-file/stdin/image/behavior interrupt或steer/no-wait/wait-timeout/request-id/expected-gen/expected-turn；**人类默认 interrupt**；额外支持显式 next_turn 排队，不和 behavior 同时指定 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/send.ts:39、228；Paseo agent 来源默认 steer，但本步没有 agent 自管 CLI 入口 |
| wait id | operation 或 turn、generation、timeout；默认无期限，前台 idle/失败或待答检查点返回；`--until terminal` 可继续等人，`--scope quiescent` 加后台／队列／待答清空条件 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/wait.ts:63、108、134；paseo-upstream@8018231a:packages/server/src/server/agent/agent-manager.ts:3620 |
| stop id | all/cwd 指批量目标；默认中断正在运行的前台、idle no-op，明确报告后台状态；`--scope all` 是额外的完整停稳，必要时关闭 runtime；不删记录 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/stop.ts:24、84；不可把 stopped 解释为所有后台已退出 |
| reload id | expected-gen/force；旧运行时关完后用有效句柄、新 cfg、新代续接；没有句柄报错，不默默改成新上下文 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/reload.ts:25；paseo-upstream@8018231a:packages/server/src/server/agent/agent-manager.ts:1700；此处比其 create fallback 更严格 |
| mode id / update id | mode --list；title/label/model，thinking 随提供方；能力声明、参数校验、生效时点来自 provider | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/index.ts:73、97；packages/brain/brain/src/provider.ts:127、144 |
| permit ls/respond/allow/deny | 精确 sessionId+gen+requestId；respond 选 optionId，answers-file 按 questionId；allow/deny 只做无歧义映射；批量先固定 pending 快照 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/permit/index.ts:10；〔二手〕docs/liwa/research/2026-11-05-codex-adaptation.md:368；无客户端时挂起，不默认答首项 |
| archive id | force/restore；活动默认拒绝，force 先完整停稳再逻辑归档；restore 仅取消归档 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/archive.ts:29；paseo-upstream@8018231a:docs/agent-lifecycle.md:211 |
| delete id | yes/all/cwd；durable 清理 intent、完整停稳、精确删本 agent 材料，逐项失败可重试 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/delete.ts:7；〔二手〕docs/liwa/research/2026-11-05-codex-adaptation.md:373 |
| provider ls/models/diagnostic | impl、models --refresh/--thinking，diagnostic --check-auth 可选；默认无模型调用，区分安装、配置、认证、模型目录来源 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/provider/index.ts:10；packages/brain/brain/src/provider.ts:60 |
| usage / usage ls/inspect | **采用默认照 Paseo 查账号额度报告**；agent/refresh、精确 report-id；另以 `usage session <id>` 查灵鲸 token／成本 | 〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/usage/index.ts:66；paseo-upstream@8018231a:public-docs/cli.md:27；第 3 步账号缺数据返回 unavailable，第 4/5 步填提供方 |

输出沿 Paseo table/json/yaml、quiet、no-headers、no-color 的形状；普通 JSON 为单对象／数组，logs/attach 为带 cursor 的 NDJSON，诊断到 stderr。短 id 只在唯一匹配时使用，真正 mutation 发送完整 id+gen。错误结构携带稳定 code、可操作说明与 operationId；命令接受／应用／待答／超时／结果不明分开，不把权限检查点当任务完成。退出码具体对照在实现前冻结，避免为了不同的默认码破坏“同等”脚本行为；已有退出码的兼容规则在实现评审中核对。〔一手〕paseo-upstream@8018231a:packages/cli/src/cli.ts:53；paseo-upstream@8018231a:packages/cli/src/commands/agent/wait.ts:13；〔推理〕。

结构化 `run --output-schema` 保留：通用提示约束、结果校验与有界纠正，每次纠正走同一 agent 回合并计费；Paseo CLI 固定最多纠正 2 次，灵鲸该值进 Config。遇权限返回检查点，取消／预算停止纠正，不另开隐形 agent。thinking 等选项由能力 schema 解析，不接受任意厂商 JSON 绕过空壳配置。〔一手〕paseo-upstream@8018231a:packages/cli/src/commands/agent/run.ts:239、632；packages/brain/brain/src/contract.ts:149；〔推理〕。

### 3.2 本机连接、鉴权与协议兼容

只选本机 home，不提供远端 `--host`、SSH URI、配对 URL、设备注册或多个 host 路由。采用复用 `host-webserver` 回环 IP+随机端口，以及 Node 可用的 Connection/Gateway：本机 CLI 从 0700 目录的 0600 连接文件取当前 endpoint/token，调用 `/connect?token=…&interactions=none` 得 API Cookie，再用同 Cookie 的 HTTP RPC+Mux。token 不打印、不进 argv、不注入 agent；没有 host 时明确提示 start。**不再造 socket RPC、Bearer 鉴权或本地密码库。** 本机也不能删掉既有 Host/Origin 与 Cookie 检查；本步不新增非 owner 角色矩阵／远程权限产品。〔一手〕packages/client/connection/README.md:28、34、41、47、51；packages/host/webserver/README.md:39；〔推理〕。

连接只拥有查询、waiter 与订阅，已持久接受的 operation 由宿主拥有；断开不等于 stop。客户端重连用 operationId 查原回执、cursor 补日志，不设计跨设备缓存、同步令牌或远端 finish subscription。业务方法直接标在其所有者的 `@Remote` 方法上，Typert 生成客户端类型；不在 gateway 加状态机，也不复制一份独立 SDK DTO。〔一手〕docs/defensive-patterns/remote-and-api.md:45；packages/client/connection/README.md:51、53；〔推理〕。

**协议按 Paseo 的兼容合同，不能用“升级 major 就全部断开”代替。** 本机 CLI 更新后，常驻宿主可能仍为旧版本，这已足够需要兼容。基础握手可给 bootId、产品版本、可选的 protocolVersion/features；未给可选字段时由连接边界显式解析为已发布基础能力。产品版本用于诊断，不用于一刀切拒绝。可参考 Paseo 的客户端版本下限与双方最高共同协议版本协商；不能只因客户端比宿主新而拒绝，新能力缺失只拒该功能。〔一手〕paseo-upstream@8018231a:docs/protocol-compatibility.md:3、5、11、13、31；〔推理〕灵鲸映射。

| 兼容规则 | 在灵鲸的具体要求 | 依据 |
| --- | --- | --- |
| 新字段可选，有合理缺省 | V1 发布后的新增 wire 字段都 optional；缺省由边界 resolve 明确处理，不在业务里到处补 fallback | 〔一手〕paseo-upstream@8018231a:docs/protocol-compatibility.md:15、38；〔推理〕 |
| 永不删字段、不把 optional 变必填、不收窄 | 停写字段仍接受；string→enum、nullable→非 null 都禁止。内部类型可严格，边界先规范化后交内部 | 〔一手〕paseo-upstream@8018231a:docs/protocol-compatibility.md:16、17 |
| 新旧两个方向都可解析 | 必测旧 CLI→新宿主、新 CLI→旧宿主；新增字段不得使旧解码器报错。底座 exact named arguments 外层保持固定请求对象，新选项放其可扩展内部 | 〔一手〕paseo-upstream@8018231a:docs/protocol-compatibility.md:11、22；packages/api/gateway/README.md:27、35；〔推理〕需验证实际生成 codec |
| 新消息／枚举值不是自动兼容 | 新事件 variant、错误形状或 enum 值可能被旧 union 拒绝；只向声明能力的连接发送，或沿旧类型的可选增强字段表达，不强发未知顶层类型 | 〔一手〕paseo-upstream@8018231a:docs/protocol-compatibility.md:13；〔推理〕 |
| 结构校验与规范化分开 | wire schema 是纯结构；tagged union 用 discriminatedUnion；transform/catch/preprocess 不放传输 schema；大容器不藏 default | 〔一手〕paseo-upstream@8018231a:docs/protocol-compatibility.md:18–20 |
| 功能只在边界 gate 一次 | 新功能缺 capability 就说明需要升级宿主；不跨旧 RPC 拼替代功能。已有 history/send 等不能因为新增游标增强能力就整体被禁 | 〔一手〕paseo-upstream@8018231a:docs/protocol-compatibility.md:31–41 |
| 持久格式是另一合同 | JSON record 版本／JSONL 必需事件校验不等于 wire 的 optional 兼容；未来存储版本拒绝时必须报错，不当 absent | 〔一手〕packages/storage/storage-domain/src/spec.ts:48；〔推理〕 |

这些规则复用底座的线协议与代码生成；不照搬 Paseo 的整份 messages.ts、WebSocket transport 或兼容 shim 目录。本步只写真实新旧夹具对测所需的边界解析；没有尚不存在的远端客户端兼容分支。〔一手〕主人已定方案（handoff 决策 62–66）；〔推理〕。

### 3.3 计划公共能力的调用

终端方法直接发布在所属业务服务，通过 Typert 生成客户端类型。brains 的 direct owner、创建前持久观察、续接变化通知、范围停稳、catalog/diagnostic/accountUsage、资源／原生材料清理均是**计划补口**，完整义务见 [01-agent-cli.md](01-agent-cli.md) §4.12，接口增量见 [00-contracts.md](00-contracts.md) §5.1。当前类型仍以 packages/brain/brain/src 为准。〔一手〕`packages/brain/brain/src/provider.ts:21`、`:77`、`:158`；〔推理〕公开能力。

G1 在④随 Claude 完成，G4 为③前置，G2/G3 在⑤随 Codex 接通；宿主只消费统一的结算／watchdog／pending 能力，不写第二份计量器／timer，不按 provider 名分支。〔一手〕handoff 决策 66。

## 4 核心机制

### 4.1 宿主与底座复用

采用新 brain-host，原 brain 变轻客户端；不复用 web 的默认进程，因为当前网页 controller 管底座 Agent，本步改它会越界。两边都经原 apps/cli/profile 启动。只抽本步共用的装配行，宿主挂现 RPC/存储/凭据/subprocess/brains/minds，CLI 不加载 agent-loop/工具/UI/提供方；不复制大 base 后长期分叉。〔一手〕docs/architecture.md:13、23、41；packages/api/session-controller/README.md:11；〔推理〕，已定。

| 设施 | 复用内容 | 不另做的东西 |
| --- | --- | --- |
| app-boot/profile/bundle | 解析配置、安装定位、appReady 与退出 | 不新建直接 node server.js 旁路 |
| Connection/Gateway/remote-access | 本机 HTTP、鉴权、RPC、流与已有 owner Peer | 不写第二套 server/auth/messages |
| storage-json/domain | agent、operation、进程的逐记录 JSON 与排写／校验 | 不迁 AgentStorage、FileBackedManagedProcessRegistry 的 fs 实现，不引入 SQLite |
| session-persistence-jsonl/projection | JSONL append/read/flush/锁／格式；统一状态投影 | 不将原生转录作为 logs 真相，不另写日志引擎 |
| subprocess/local/native flock | 受管启动、环境、信号、范围退出、单实例锁 | 不迁 tree-kill 或 daemon 内私有 ps/kill 服务 |
| credentials | 引用解析、describe 与安全存储后端 | 不在提供方行／agent JSON 放明文 Key |

本表为〔推理〕；一手依据依次 docs/architecture.md:41；packages/client/connection/README.md:34；packages/storage/storage-json/README.zh.md:75；packages/session/session-persistence/src/handle.ts:85；packages/subprocess/subprocess/src/types.ts:169；packages/credentials/credentials/README.md:54。

### 4.2 单实例、start/status/restart

同一 canonical home 的 brain-host 只准一个 writer；别名 profile 指向同一数据根仍互斥。用现 native flock 持有稳定 inode，不以 PID 文件存在／时间过期判锁，不 unlink 活锁；锁 fd 不传给模型 CLI。顺序：拿锁 → 校验配置／严格开 JSON domains → 完成 pendingMutation/日志对账 → 先捕获恢复候选再修旧运行状态 → 对账进程 → 服务 ready → 发布本机连接描述。未知台账阻止受影响的恢复；若连范围都不可信，store_unhealthy 阻止工作 admission。〔一手〕native/system/README.md:25；packages/session/session-persistence-jsonl/src/lease.ts:1；paseo-upstream@8018231a:docs/agent-lifecycle.md:26；〔推理〕。

start 幂等且等 ready；宿主不在时一般命令报错并给 start 指令，不自动拉起。status 区分 stopped/starting/ready/draining/unresponsive/store_unhealthy，核对本次 boot 与锁／进程身份，不靠陈旧描述说活着。start 超时报告仍可能在启动，不误杀其他 PID。〔一手〕paseo-upstream@8018231a:packages/server/src/server/daemon-instance.ts:64、93；〔推理〕。

restart 先关闭新 admission、冻结派送，持久保存原 running 恢复 intent，然后 drain→cancel→完整停后台／进程范围→flush→关闭 API/存储→释放锁并退出；失败保留 stopping，不起第二 owner。采用由短命替换载体持有 restart operation，CLI 断开仍可等旧宿主退出、启动新的同 profile；不是常驻自动重启 supervisor，也不安装 launchd。新宿主拿锁才恢复，replace 失败有 JSON 控制结果可查。〔一手〕paseo-upstream@8018231a:packages/server/src/server/bootstrap.ts:1967；paseo-upstream@8018231a:packages/cli/src/commands/daemon/restart.ts:20；docs/defensive-patterns/general.md:194；〔推理〕，已定。



ready 后调用 minds 的恢复入口；运行候选、gen、继续输入、阻塞条件与关闭开关语义只定义在 [02-minds.md](02-minds.md) §4.0。宿主 ready 不表示所有会话已恢复，单条恢复失败由其 JSON 记录和状态 API 报告。〔一手〕`paseo-upstream@8018231a:docs/agent-lifecycle.md:26`；〔推理〕承载。

### 4.3 逐条进程台账与启动对账

借鉴 Paseo 的 `record/list/reapStale` 分工：每条记录有 owner、PID 与出生身份；启动区分已死、仍匹配、已复用、无法检查。灵鲸的介质换为现 storage-json/domain，检查／终止放 subprocess；Paseo 原代码有命令行回退与坏记录跳过，灵鲸不能据此降低“配置／状态错误大声失败”的要求。〔一手〕paseo-upstream@8018231a:packages/server/src/server/managed-processes/managed-processes.ts:105、266、351、386；AGENTS.md:81、86；〔推理〕。

| 观测 | 对账动作 | 是否可启动替身 |
| --- | --- | --- |
| 可靠证明旧进程／scope 已不存在 | 更新 exited/reconciled 记录，按保留期后删 | 可以继续验证 resume |
| 仍活着且出生身份、owner/scope 匹配 | 只清理该受管范围并等 waitForExit，再更新记录 | 停稳以前不行 |
| PID 已复用／身份不匹配 | 不杀新进程，标 mismatch；另核对旧范围，不从 pid 不同推断所有后代都没了 | 旧范围无证据就 blocked |
| 身份读取失败／台账损坏／范围未知 | 保留记录／报告；底座严格读取失败不当空目录 | 不行，明确 recovery_blocked |

本表为〔推理〕；依据 packages/subprocess/subprocess/src/types.ts:188；packages/subprocess/subprocess-local/src/process-inspector.ts:8、490；paseo-upstream@8018231a:packages/server/src/server/managed-processes/managed-processes.ts:279。

**必须堵住 spawn 与落盘之间的窗口。** 现 BrainLaunchContext.spawn 只在内存先登记。采用在 subprocess 的受管启动入口加 durable intent→惰性载体报告出生身份→身份 JSON durable→放行 exec 屏障；放行前父控制管道断开，载体退出，不执行 CLI。同步 Handle 可先返回 starting，stdin／控制错误的语义在该 seam 定；control 通道不污染 stdout。不是所有平台都有现成强身份，macOS ps lstart 不能被当成已经证明的精确出生标识；必要的 native 支持在原基础设施补并单独验。〔一手〕packages/brain/brain/src/session.ts:420；packages/subprocess/subprocess/src/types.ts:176；packages/subprocess/subprocess-local/src/process-inspector.ts:490；〔推理〕。

进程结束通知 `done` 不等于子孙全部退出；stop-all/reload/restart/delete 必须 terminate 后等 `waitForExit`。当前 brains settleProcesses 超时只警告然后仍会 closed，这个根部缺口须修，不能在宿主层补一个“看起来已停”的布尔量。不可观察的自行脱管进程明确为限制，不按名字 kill 全机 claude/codex/liwa。〔一手〕packages/brain/brain/src/session.ts:771、803；packages/subprocess/subprocess/src/types.ts:180、188；〔推理〕。

### 4.4 日志、attach、wait、send

日志复用 sessionPersistence，必需事件纳入 SessionEventMap 与生成的 persistence catalog；不加 ignorable 绕版本拒绝。输入、注入内容、输出、权限与结算事实都能从灵鲸日志找回；原生转录只用于 resume／子身份恢复，历史回声不重算新输出／新费用。命令 display 只读同一投影，JSON 当前摘要由这一个 fold 更新。〔一手〕packages/core/session/src/known-event-types.ts:1；AGENTS.md:77；paseo-upstream@8018231a:docs/providers.md:104；〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:331；docs/liwa/research/2026-11-05-codex-adaptation.md:364；〔推理〕。

follow 原子登记 committed 订阅并取 H 与 stateAtH，回放 `(after,H]`，再发缓冲 `>H`；不先读历史再订阅，也不在读完后取当前状态冒充 H。本机断线重连按 cursor 补，按 seq 去重；慢读缓冲有上限，满则明确 resync_required；已删／过期 cursor 报 cursor_expired，不静默从尾开始。“不重放”是相同 cursor 的输出去重，不承诺客户端崩溃时屏幕写入也有事务。〔一手〕packages/api/session-controller/README.md:38；paseo-upstream@8018231a:packages/cli/src/commands/agent/attach.ts:131、145；〔推理〕。

wait/send 的状态与投递语义通过 minds 实现，见 [02-minds.md](02-minds.md) §4.0；本机断线只撤 waiter/订阅，operation 继续归宿主。宿主不据输出文字猜 idle 或重送输入。〔一手〕`packages/client/connection/README.md:51`；〔推理〕。

### 4.5 permit 与跨回合预留

请求由 minds 的待答 API 暴露，调用方传 sessionId/gen/requestId 和精确选项；子请求包含 childId 与调用事实，主人直接回答。公共 RPC/Promise 留 provider 的宿主 context，连接只拥有读者；问答状态、响应幂等和重启失效规则只在 [02-minds.md](02-minds.md) §4.0 定义。〔一手〕`packages/brain/brain/src/session.ts:658`；〔推理〕承载。

G2 的 session-lifetime 与 follow-up 接缝由宿主消费面预留，第⑤步才接通实际公共层；不能以 fake child 规避父 terminal，也不能把新原生请求发给不理解它的旧客户端。〔二手〕`docs/liwa/research/2026-11-05-codex-adaptation.md:340`；〔一手〕handoff 决策 66。

### 4.6 provider、多实例与空壳

同插件多行／impl、Key 引用、稳定身份根与不可变会话材料、空壳和安全 reload 由 [01-agent-cli.md](01-agent-cli.md) §4.6/§4.10/§4.12 定义；宿主不再保存另一份 provider 配置。provider ls/models/diagnostic 读取实际注册的安全描述与公共能力，来源／时间／认证未知分开显示，不发模型请求或扫描个人 home。〔一手〕`packages/brain/brain/src/provider.ts:60`；`paseo-upstream@8018231a:docs/providers.md:118`；〔推理〕命令呈现。

### 4.7 usage、stop、archive、delete

usage 默认是账号报告，usage session 是灵鲸会话消费；无报告来源明确 unavailable。G1 的成功／失败／取消结算只记一次，G3 的父子累计口径在第五步真测；统计事实由 brains，agent 当前摘要由 minds，命令不再重算钱数。〔一手〕`paseo-upstream@8018231a:public-docs/cli.md:27`；`packages/brain/brain/src/views.ts:123`。

stop/archive/delete/reload 的命令含义在 §3.1，状态转换与精确清理流程只在 [02-minds.md](02-minds.md) §4.0 定义；原生删除义务见 [01-agent-cli.md](01-agent-cli.md) §4.12。宿主据全范围停稳结果继续 drain，不能以“前台已经停”代替“可以关／删／换代”。〔一手〕`packages/subprocess/subprocess/src/types.ts:188`；〔推理〕。

### 4.8 资源与闲置回收

status 分驻留会话、前台回合、后台任务、活进程四种数；RSS 按出生身份去重，host、CLI、受管后代分别显示时间与采样完整性。RSS 会重复计算共享页，不称独占物理内存；采样由 subprocess 一次快照聚合，默认按需，watch 才按 Config 周期采样。它不是未来 attention 焦点数或 guard 4+1 名额。〔一手〕[four-layers.md](../four-layers.md) §2.8；packages/subprocess/subprocess-local/src/process-inspector.ts:19；〔推理〕。

回收判定与默认一小时策略只在 [02-minds.md](02-minds.md) §4.0；status 展示阻塞原因与未知项，不自己再跑一套 sweep。〔一手〕handoff 决策 65；〔推理〕。

## 5 交互时序

以下四条为〔推理〕设计时序；现有能力依据见 §2.4、§3.2、§4.2–§4.5。会话 mutation 只在准入／状态提交时串行，不能持锁等待整个模型回合，否则 permit/stop 会被堵住。

### 5.1 run

```text
CLI -> 本机 Connection 换 Cookie、握手；传 operationId + run 请求
minds -> operations JSON 固化 operationId→agentId；agent JSON 写 creating/输入引用
minds -> JSONL 写 opened/input admission 并 flush；agent JSON 对齐 appliedLogSeq
minds -> 返回 accepted(agentId, operationId)；no-wait 可退出
minds -> provider 配置 resolve；持久 sink 先安装；调用 brains 创建本代
subprocess -> 进程 intent JSON -> 出生身份 JSON -> 放行真实 CLI
provider -> 开场事件、有效 resume、turn；minds 持久日志并更新 agent 当前摘要
CLI -> 默认等待完成／权限检查点；连接退出不释放宿主会话
```

创建失败仍有 agent/error 与 operation 可查，已启动范围必须停稳；accepted 不是 running 或模型已读。直到 dispatching intent 之前都没有模型工作；之后响应不明不新建第二条输入。〔一手〕packages/brain/brain/src/index.ts:494；〔推理〕。

### 5.2 attach

```text
CLI -> follow(agentId, afterCursor)
宿主 -> 在一个观察步骤内安装 committed 订阅，取 H 与 stateAtH
宿主 -> 读 JSONL (after,H]；缓冲新 >H；发送历史、H 对应状态、再发增量
CLI -> 按 logId/epoch/seq 去重，处理成功才推进 cursor
断线 -> 仅撤订阅；下一次本机命令用最后 cursor 补追
换代 -> 原逻辑日志内追加 gen 变化，不重灌原生转录
```

这一订阅机制是本机连续查看所需；不维护设备目录、远端离线消息箱或跨设备 cursor 合并。〔推理〕；〔一手〕packages/api/session-controller/README.md:38。

### 5.3 permit

```text
CLI 原生请求 -> provider 保留原生 RPC id -> 公共 permission.request
minds -> JSONL 请求事实 flush -> agent JSON pending(eventSeq,sessionId,gen,requestId)
主人 CLI -> respond(精确键, optionId, answers, operationId)
minds -> 校验仍可答 -> JSON responding intent durable -> provider 应用答案
确认 -> JSONL resolved flush -> agent JSON 移除可答项、操作回执成功
失败 -> 明确未应用留 pending；回执不明留 unknown；不能盲目再批
若有 follow-up -> 独立 delivery 入同一队列（第 5 步 G2 接通）
```

请求期间原 CLI 命令退出不丢 Promise；重启则旧 RPC 不存在，旧键必须 invalidated。〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:335；docs/liwa/research/2026-11-05-codex-adaptation.md:369；〔推理〕。

### 5.4 restart

```text
本机 CLI -> restart(operationId)
旧宿主 -> runtime operation JSON；agent JSON 记原 running 的 recovery intent
旧宿主 -> 停 admission、冻结派送、drain/cancel、后台全停、waitForExit
旧宿主 -> 所有 JSON/JSONL 写入收尾；关闭 API/存储；释放锁并退出
替换载体 -> 同 profile 启新宿主；客户端退出不丢替换操作
新宿主 -> 拿锁、严格读 JSON、补 JSONL 切点、对账出生身份、修旧代 pending/turn
新宿主 -> ready；按已定的默认开启策略与配置开关处理 recovery intent
若采用采用默认 -> 每条符合条件的原 running：新代 resume + durable 继续输入
CLI -> 验证新 boot ready；会话恢复可另为 running/failed/blocked，不把它们合成一个成功
```

完整停稳失败则不启动替身；自动恢复失败的 agent 保留恢复材料和错误，不影响健康记录查询，不把已 ready 说成所有任务已续上。〔一手〕paseo-upstream@8018231a:docs/agent-lifecycle.md:26；docs/defensive-patterns/general.md:194；〔推理〕。

## 6 出错与恢复

领域恢复的步骤、状态和单写保证只在 [02-minds.md](02-minds.md) §2.6–§2.7、§4.0，进程对账义务在 [01-agent-cli.md](01-agent-cli.md) §2.1/§4.12。宿主和命令只报告这些 API 的结果，不额外修文件或假定事务。〔一手〕`packages/storage/storage-domain/README.md:83`；〔推理〕。

| 失败 | 宿主／CLI 的行为 | 依据 |
| --- | --- | --- |
| 宿主不在／启动未 ready | status 明示 stopped/starting；业务命令提示 start；不自动起模型 | 〔一手〕`paseo-upstream@8018231a:packages/server/src/server/daemon-instance.ts:64` |
| 本机连接中断 | 释放查询／订阅，按 cursor/operationId 重连查询；已收下的任务继续 | 〔一手〕`packages/client/connection/README.md:51`；〔推理〕 |
| JSON/日志失败 | 转发领域 store_unhealthy/unknown/repairing，阻止依赖操作；不当空目录、不退内存运行 | 〔一手〕`packages/storage/storage-json/README.zh.md:56`；〔推理〕 |
| cancel/close/孤儿核对不明 | 返回 stopping/recovery_blocked，禁止成功 restart/delete/reload；force 也不绕身份检查 | 〔一手〕`packages/brain/brain/src/session.ts:639`；〔推理〕 |
| provider 不可用／配置缺失 | 当前记录与日志仍可查；完整配置解析失败，不借个人登录或空会话 | 〔二手〕`docs/liwa/research/2026-11-05-codex-adaptation.md:363`；〔推理〕 |
| 单条自动恢复失败 | ready 与恢复结果分开；单条失败可查，无无限重试 | 〔一手〕`paseo-upstream@8018231a:docs/agent-lifecycle.md:26` |
| 新能力未支持 | 边界 gate 一次，提示升级；已有基础命令继续，不按产品版本整体拒绝 | 〔一手〕`paseo-upstream@8018231a:docs/protocol-compatibility.md:31` |

外部 CLI 文件／网络副作用不与 JSONL 同事务；结果不明由领域停止依赖工作，不自动重发。恢复不是 exactly-once 工具执行保证。〔一手〕`AGENTS.md:86`；〔推理〕。

## 7 成本与性能

**逐条 JSON 对本机个人使用预计足够；需要实测的是启动扫描和状态写入频率，不是 SQL 查询能力。** JSON 不意味着零成本，关键记录严格读取、跨文件恢复和启动对账仍需实现与故障测试。〔一手〕主人已定方案（handoff 决策 62–66）；packages/storage/storage-json/README.zh.md:75、143；〔推理〕。

| 项目 | 本文成本／界限 | 证据与测法 |
| --- | --- | --- |
| 常规查询 | startup loadAll O(N)，常驻 ls 过滤排序 O(N)，按 id 是 domain 的内存查找；不为每次 ls 重开全目录 | 〔一手〕packages/storage/storage-json/src/per-record-unit.ts:1、70；〔推理〕 |
| 单条更新 | 只写目标 agent／process JSON；高频文本只进 JSONL，活动时间可节流；关键 pending、resume、状态即时写 | 〔一手〕packages/storage/storage-json/README.zh.md:75、76；〔推理〕 |
| 个人规模 | 先验 1,000/10,000 条记录，粗估原始 JSON 8–32/80–320 MiB，实际按字段上限测；长期 operation/退出进程不能无限积累 | 〔推理〕§2.5，不是已测 RSS |
| 并发读取 | 底座 loadAll 当前 Promise.all 扫文件，需量大目录 fd／内存；有问题在原后端加可配置并发控制，不写旁路 loader | 〔一手〕packages/storage/storage-json/src/per-record-unit.ts:85、164；〔推理〕 |
| 日志 | 控制事件 durable barrier，文字按 Config 的字节／时间窗口合批；JSONL 分页不一定 O(page) 内存，后端可能整份准备 | 〔一手〕packages/session/session-persistence-jsonl/README.md:87、107；〔推理〕 |
| 进程／内存 | 一个宿主＋每驻留会话一个 CLI；237 MB/个是已有并发观测，不是保证。4 个粗估 948 MB、8 个约 1.9 GB，还要宿主／后代 | 〔一手〕[01-agent-cli.md](01-agent-cli.md) §7 的记录；数值作为〔二手〕，线性外推〔推理〕 |
| 资源采样 | 按需或 watch 周期一次 OS 快照，按身份去重；不知道就标 unknown，不为省时间报零 | 〔一手〕packages/subprocess/subprocess-local/src/process-inspector.ts:19；〔推理〕 |
| 模型成本 | 治理／默认诊断不调模型；正常工作、结构化纠正、选择自动续跑后的继续输入会消耗并入日志／usage | 〔一手〕paseo-upstream@8018231a:docs/agent-lifecycle.md:18；paseo-upstream@8018231a:packages/cli/src/commands/agent/run.ts:245；〔推理〕 |

核心重新估为 **16–24 工程人日 + 3–4 评审／故障注入人日**：宿主／本机连接 2–3；JSON/JSONL 协调与严格读取 3–4；通用进程屏障／身份／恢复 3–5；会话运行／命令／权限／日志 4–6；提供方目录／配置／资源／兼容验收 4–6。G1 随④交付、G4 在③前交付，G2/G3 完整贯通留第 5 步。〔推理〕。

模型列表／诊断计入核心；ACP 三命令约 2–4 日、非图片文件块约 2–4 日，作为 D9/D10 已定的本步附加任务。deepseek 瘦身另开可选 2–4 日任务：先量 cold/warm、源码／产物、idle/active/带孩子 RSS，再从 profile 装配根减无用服务；不共享模型进程、不裁约束／日志刷数字，不承诺减半。宿主／轻 CLI 最小装配是本步所需，deepseek 大幅裁剪按 D11 另开任务。〔一手〕docs/architecture.md:23；〔推理〕。

最低性能记录：1/4/8 会话下资源；1,000/10,000 JSON 的加载、ls p50/p95 与峰值；10 万日志事件 attach/分页；同 agent 连续状态写与并发不同 agent 的 fsync 延迟。先用真实目标机基线，再由实现任务给阈值；本文不编毫秒保证。〔一手〕docs/defensive-patterns/general.md:151；〔推理〕。

## 8 安全与隐私

| 边界 | 本步保证 | 依据 |
| --- | --- | --- |
| 本机控制 | 仅回环 listener，私有连接文件与现 Cookie/Host/Origin；同 OS 用户持有文件即本地主人权限；不向 agent 注入管理 token | 〔一手〕packages/client/connection/README.md:41、47、51；〔推理〕 |
| JSON/JSONL 权限 | 底座私有目录与文件；关键记录读失败大声报错；不启用可丢弃缓存式 backup-and-skip | 〔一手〕packages/storage/storage-json/README.zh.md:36、56；packages/storage/storage-domain/src/spec.ts:58；〔推理〕 |
| 凭据 | 配置、agent 记录、进程 ledger、resume、诊断和日志不含 Key/MCP token；credential-ref 只记引用。引用不是加密承诺 | 〔一手〕packages/credentials/credentials/README.md:12、54；〔二手〕docs/liwa/research/2026-11-05-codex-adaptation.md:462；〔推理〕 |
| 环境 | subprocess 先剥秘密，provider 显式注入；身份根／隔离项冲突失败，不保存 Paseo launchEnv 原值 | 〔一手〕packages/brain/brain/src/process.ts:223；paseo-upstream@8018231a:packages/server/src/server/agent/agent-storage.ts:60；〔推理〕 |
| 空壳 | 不让外部 CLI 读自带配置、hooks、skills/plugins；项目规则由灵鲸受控注入，Codex 隔离 HOME；真 CLI 来源隔离失败就阻塞该提供方 | 〔一手〕[handoff.md](../../handoff.md) 决策 62–66；〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:299；docs/liwa/research/2026-11-05-codex-adaptation.md:320 |
| 权限与孩子 | 主人 permit，父模型不得代批；会话允许按原生请求范围，问答不猜第一项；未来工具授权仍走 toolport | 〔一手〕[01-agent-cli.md](01-agent-cli.md) §0；〔二手〕docs/liwa/research/2026-11-05-codex-adaptation.md:368；〔推理〕 |
| 文件与删除 | blob 引用有 agent 所有权；只删本 agent，symlink 只 unlink；不删成员身份根、登录、cwd；tombstone 无正文 | 〔一手〕docs/defensive-patterns/general.md:220；〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:337；〔推理〕 |
| 公开仓库 | 原始对话、凭据、本机数据不进仓库；本文正式落位要去本机绝对路径 | 〔一手〕AGENTS.md:15 |

这些是当前本机边界；本步不安装 relay 密钥、远程 ACL、设备 token 或移动推送服务。多端时的身份、撤销与 E2EE 另按 §13 设计，不能把本地 API token 直接当远程配对口令。〔一手〕主人已定方案（handoff 决策 62–66）；〔推理〕。

## 9 第一版范围与验收

### 9.1 Paseo 全命令盘点与对齐

命令基线为 `paseo-upstream@8018231a` 的实际注册源码。表中“第 3 步”均为已定计划；“第 4/5 步”按④→③→⑤由提供方先行或接通；“以后”为后续产品域；多端命令统一是“多端阶段（走 VPS）”。处置依据为主人定稿（handoff 决策 65、66），实现映射标〔推理〕，末列为〔一手〕命令来源。

**公共参数与别名。** Paseo 全局有 `-v/--version`、`-h/--help`、`help [command]`、`-o/--format table|json|yaml`、`--json`、`-q/--quiet`、`--no-headers`、`--no-color`；连接参数 `--host` 可指 TCP/socket/SSH/pair URL，`--home` 指本地 home。本地管理命令不接受远端目标。灵鲸第 3 步做 help/version/table/json/quiet/no-color，yaml 纯输出可一并做；目标只选本机 LIWA_HOME 与已解析 profile；Paseo 的远端 host/socket/SSH/pair URL 选择全部归“多端阶段（走 VPS）”，本步不加远端参数。〔一手〕paseo-upstream@8018231a:packages/cli/src/cli.ts:48；paseo-upstream@8018231a:packages/cli/src/utils/command-options.ts:10、25；〔推理〕。

#### 9.1.1 会话、权限、提供方与用量

下面 root 与 `agent` 同名入口是 Paseo 的同一功能别名，均计入盘点；灵鲸只留 `liwa brain` 这一组会话命令。

| Paseo 命令 | 主要参数（含重要隐藏项） | 处置 | 灵鲸对应／差异与理由 | 〔一手〕 |
| --- | --- | --- | --- | --- |
| `run` / `agent run` | prompt；provider 或 provider/model、model、thinking、mode、cwd、title、label、env、image、no-wait、wait-timeout | 第 3 步；thinking 的提供方实现第 4/5 步 | `brain run` 常驻 owner；provider 与 model 采用分字段；env 限非秘密且不覆盖隔离项，秘密走引用；新增可靠 request-id | paseo-upstream@8018231a:packages/cli/src/commands/agent/run.ts:25 |
| run 的工作区参数 | new-workspace、workspace、worktree-mode、worktree-slug、new-branch、base、branch、pr-number、forge；隐藏 worktree | 以后；隐藏别名不需要 | 工作区是独立业务，先用明确 cwd；不能因 `run` 顺便新建／删除 worktree；未来复用 workspace API | paseo-upstream@8018231a:packages/cli/src/commands/agent/run.ts:49 |
| run 的 `--output-schema` | 内联 JSON schema 或文件；与 no-wait 冲突 | 第 3 步，独立小块 | 通用“提示约束 + 最终结果校验 + 有限纠正回合”；过程、纠正和用量全部入同一宿主记录，客户端断线也不丢操作；不要求 native schema 的提供方专有分支。纠正上限进 Config，不复制 Paseo 硬编码 2 | paseo-upstream@8018231a:packages/cli/src/commands/agent/run.ts:84、239、632；paseo-upstream@8018231a:packages/server/src/server/agent/agent-response-loop.ts:175 |
| run 隐藏 `-d/--background`、`--detach`、`--name` | 前两者旧 no-wait，name 是 title | 不需要 | 只给 no-wait/title，不制造新的兼容别名，也不混淆“脱离终端”与“解除父子关系” | paseo-upstream@8018231a:packages/cli/src/commands/agent/run.ts:31 |
| `ls` / `agent ls` | all、global、background、label、thinking | 第 3 步；workspace background 以后 | brain ls 默认当前 cwd 未归档，从逐条 agent JSON 的 domain 视图查询；后台孩子状态单列，不当 background workspace | paseo-upstream@8018231a:packages/cli/src/commands/agent/ls.ts:13 |
| `logs` / `agent logs` | id、follow、tail、filter tools/text/errors/permissions、since | 第 3 步 | `brain logs` 加 durable cursor，灵鲸事件为真相；冷读不唤醒 | paseo-upstream@8018231a:packages/cli/src/commands/agent/logs.ts:14 |
| `attach` / `agent attach` | id | 第 3 步 | `brain attach` 加 after/tail；同一快照+订阅协议，跨回合保持连接；Ctrl-C 只断开 | paseo-upstream@8018231a:packages/cli/src/commands/agent/attach.ts:3、131、145 |
| `send` / `agent send` | id、prompt / prompt-file、image、behavior interrupt/steer、no-wait | 第 3 步 | 默认人工 interrupt，明确 steer；unsupported/unavailable 可报告中断回落，timeout 不重送；额外 next_turn 是明确队列选项 | paseo-upstream@8018231a:packages/cli/src/commands/agent/send.ts:39 |
| `wait` / `agent wait` | id、timeout | 第 3 步 | 默认前台 idle/失败或 permission 检查点返回，默认无期限；--until terminal 才跨权限等待；quiescent 另等后台；超时不 stop | paseo-upstream@8018231a:packages/cli/src/commands/agent/wait.ts:89、134 |
| `stop` / `agent stop` | id 或 all/cwd | 第 3 步 | 默认中断当前运行、idle no-op；不保证后台全停，--scope all 另提供完整停稳；失败维持 stopping，批量逐项报告 | paseo-upstream@8018231a:packages/cli/src/commands/agent/stop.ts:25 |
| `inspect` / `agent inspect` | id | 第 3 步 | 状态、有效配置来源、代次、句柄可用性、pending、资源、错误；不输出秘密 | paseo-upstream@8018231a:packages/cli/src/commands/agent/inspect.ts:8 |
| `archive` / `agent archive` | id、force | 第 3 步 | 停稳后逻辑归档；另给 restore 显式取消归档，不启动任务；没有 Paseo tab 开着就自动 detach 孩子的规则 | paseo-upstream@8018231a:packages/cli/src/commands/agent/archive.ts:29；paseo-upstream@8018231a:docs/agent-lifecycle.md:126、211 |
| `delete` / `agent delete` | id 或 all/cwd | 第 3 步 | 精确删除本会话，批量先固化清单与确认；Paseo 原生清理按提供方做，灵鲸不删共享身份根 | paseo-upstream@8018231a:packages/cli/src/commands/agent/delete.ts:7 |
| `agent mode` | id、mode 或 list | 第 3 步；原生模式第 4/5 步 | `brain mode` 直接依赖现 availableModes/setMode，返回 appliesAt；模式不能突破安全策略 | paseo-upstream@8018231a:packages/cli/src/commands/agent/index.ts:73 |
| `agent update` | id、name、thinking、label | 第 3 步；thinking 第 4/5 步 | `brain update` 统一 title、label、model；thinking 由提供方目录声明／校验，宿主只传通用选择 | paseo-upstream@8018231a:packages/cli/src/commands/agent/index.ts:97 |
| `agent reload` | id | 第 3 步 | `brain reload <id>` 旧进程关完才新代续接；没有有效句柄明确报错，区别于 Paseo 可能 create 新原生会话 | paseo-upstream@8018231a:packages/cli/src/commands/agent/reload.ts:25；paseo-upstream@8018231a:packages/server/src/server/agent/agent-manager.ts:1700 |
| `agent open` | agent-id、server | 多端阶段（走 VPS） | 独立客户端／手机完成后做 agent 深链与目标选择；网页改公共层另任务，旧 Session 页不能冒充第四层会话页 | paseo-upstream@8018231a:packages/cli/src/commands/agent/open.ts:28 |
| `agent detach` | id | 不需要（当前边界） | 原生孩子是观察对象，不可转成独立 minds 任务；未来跨 CLI 子活归 tasks，若需解除父归属应由 tasks 设计 | paseo-upstream@8018231a:packages/cli/src/commands/agent/index.ts:90；[01-agent-cli.md](01-agent-cli.md) §0 |
| `import` / `agent import` | native id、provider、cwd、label | 不需要（当前边界） | 不扫描／接管个人原生会话，避免带入非空壳配置与外部转录真相；只恢复灵鲸自己创建的有效句柄 | paseo-upstream@8018231a:packages/cli/src/commands/agent/import.ts:8；[01-agent-cli.md](01-agent-cli.md) §0 |
| `permit ls` | 无专用参数，带通用输出／目标 | 第 3 步 | 所有未决事实，含 child 与 session-lifetime；失效记录可 inspect，但不混进可答清单 | paseo-upstream@8018231a:packages/cli/src/commands/permit/index.ts:10 |
| `permit allow` | agent、req_id 或 all、input JSON | 第 3 步 | `brain permit respond --option --answers-file` 为规范入口；allow 只在可唯一解释时便捷选择；批量只针对固定快照和精确代次，不自动答选择题 | paseo-upstream@8018231a:packages/cli/src/commands/permit/index.ts:15 |
| `permit deny` | agent、req_id 或 all、message、interrupt | 第 3 步 | deny 与 stop 两个结果分开；拒绝成功不代表 interrupt 已停稳，失败逐项报告 | paseo-upstream@8018231a:packages/cli/src/commands/permit/index.ts:25 |
| `provider ls` | 通用参数 | 第 3 步 | 列宿主实例，安装／配置／认证不混一个“可用” | paseo-upstream@8018231a:packages/cli/src/commands/provider/index.ts:10 |
| `provider models` | provider、thinking | 第 3 步入口；第 4/5 步各自目录 | 静态目录／插件目录唯一来源，不能硬编码 Claude/Codex 模型表在 CLI | paseo-upstream@8018231a:packages/cli/src/commands/provider/index.ts:15 |
| `provider diagnostic` | provider | 第 3 步入口；第 4/5 步各自探测 | 无模型默认检查，认证检查显式选；只检查配置的二进制与身份根 | paseo-upstream@8018231a:packages/cli/src/commands/provider/index.ts:23 |
| `usage` / `usage ls` | agent（选账号非 token）、refresh | 第 3 步报告入口与会话消费；账号来源第 4/5 步 | 默认与 Paseo 同义查账号报告；usage session <id> 查 token/费用。没有账号来源就 unavailable，不能拿消费替代 quota | paseo-upstream@8018231a:packages/cli/src/commands/usage/index.ts:66；paseo-upstream@8018231a:public-docs/cli.md:27 |
| `usage inspect` | 精确 report-id、refresh | 第 4/5 步随提供方 | 精确报告号查窗口／单位／重置／来源；首版入口可报告无来源，真实来源随提供方；不扫描全局 CLI home | paseo-upstream@8018231a:packages/cli/src/commands/usage/index.ts:83；docs/liwa/research/2026-11-05-codex-adaptation.md:372 |

**补充公共接口范围。** 为 thinking／结构化结果保留明确的 capability 与经过提供方校验的选择字段；不要把任意 providerOptions 字典当绕过安全的通道。`--output-schema` 编排属于 minds 的同一操作，校验器复用现有受支持依赖／公共 API；Paseo helper 含 `as unknown` 不能原样抄进严格源码。停止、权限或预算耗尽立即暂停纠正，不能为凑合法 JSON 自动批准工具。相关字段、来源与默认纠正上限需随任务 A 冻结。〔一手〕packages/brain/brain/src/contract.ts:149（当前无 thinking/outputSchema）；packages/boot/app-boot/package.json:39（已有 Ajv 使用）；paseo-upstream@8018231a:packages/server/src/server/agent/agent-response-loop.ts:137；〔推理〕。

#### 9.1.2 宿主与配置

| Paseo 命令 | 主要参数 | 处置 | 灵鲸语义／差异与理由 | 〔一手〕 |
| --- | --- | --- | --- | --- |
| `start` / `daemon start` | home、timeout | 第 3 步 | `brain start`，只经 brain-host profile；与 Paseo 一样已有则幂等，不自动发送任务 | paseo-upstream@8018231a:packages/cli/src/commands/daemon/start.ts:7 |
| `status` / `daemon status` | home/host、输出参数 | 第 3 步 | `brain status` 加可解释资源；不把 pid 存在当 ready | paseo-upstream@8018231a:packages/cli/src/commands/daemon/status.ts:1 |
| `restart` / `daemon restart` | timeout、kill-terminals | 第 3 步 | brain restart；完整停稳与 JSON 恢复 intent；D4 采用恢复原 running，autoResume 可配置；独立终端保留留后续领域 | paseo-upstream@8018231a:packages/cli/src/commands/daemon/restart.ts:18 |
| `reload` / `daemon reload` | host/home | 第 3 步 | `brain host reload` 与 `brain reload <id>` 分开；安全配置新 revision；结构性插件改动报告 restartRequired | paseo-upstream@8018231a:packages/cli/src/commands/daemon/reload.ts:63 |
| `daemon run` | home；部署 env | 第 3 步 | `brain host serve` 映射前台 `liwa --profile brain-host`；不另加 server bin | paseo-upstream@8018231a:packages/cli/src/commands/daemon/start.ts:37 |
| `daemon stop` | timeout、force、keep-terminals、kill-timeout | 第 3 步 | `brain host stop`；精确归属强停；keep-terminals 留到独立终端领域，不能等同保留模型后台任务 | paseo-upstream@8018231a:packages/cli/src/commands/daemon/stop.ts:13 |
| `daemon config get [path]` | home | 以后 | 全局 home 配置产品机制尚不做；现在用 Cordis profile/patch 为唯一配置源，不新造 config.json | paseo-upstream@8018231a:packages/cli/src/commands/daemon/config.ts:78 |
| `daemon config set <path> <value>` | string、home | 以后 | 将来写唯一配置服务并区分 saved/applied/restartRequired；本步不实现 | paseo-upstream@8018231a:packages/cli/src/commands/daemon/config.ts:93 |
| `daemon config unset <path>` | home | 以后 | 同上；不得把凭据 unset 与会话 delete 混一起 | paseo-upstream@8018231a:packages/cli/src/commands/daemon/config.ts:109 |
| `daemon set-password` | home，交互输入 | 多端阶段（走 VPS） | 以后定远程入口认证与撤销，仍复用底座身份／凭据能力，不在本步新增 Paseo 密码库 | paseo-upstream@8018231a:packages/cli/src/commands/daemon/index.ts:26 |
| `pair` / `daemon pair` | relay、host/home | 多端阶段（走 VPS） | 以后做灵鲸客户端配对，借鉴 connection offer/QR/固定公钥；中继地址指主人 VPS，本步不生成配对身份 | paseo-upstream@8018231a:packages/cli/src/commands/daemon/pair.ts:60 |
| `onboard` | listen/port、relay/no-relay、no-mcp、hostnames、timeout、voice；隐藏 allowed-hosts | 本机引导以后；多端部分：多端阶段（走 VPS） | 本机 home/Key 引导独立做；relay、配对、远程 hostnames 随 VPS 接入，本步 start/diagnostic 足够 | paseo-upstream@8018231a:packages/cli/src/commands/onboard.ts:151 |
| start/run/restart 隐藏旧启动 flags | port/listen、relay、relay-use-tls、no-mcp、no-inject-mcp、web-ui、hostnames、foreground 等 | 不需要 | 这些源码注册后**主动报 REMOVED_LAUNCH_OPTION**，并非该版本仍支持的能力；灵鲸无需复制历史拒绝选项 | paseo-upstream@8018231a:packages/cli/src/commands/daemon/local-daemon.ts:82 |

#### 9.1.3 项目、工作区、独立终端与调度

这些都是单独产品域，安排“以后做”，每项须有自己的实现／验收，不能算在本步完成率内。复用底座 workspace、terminals、jobs、schedule 等 API，是否可直接覆盖 Paseo 语义在对应任务核实；不把它们塞进 brains。

| Paseo 命令 | 主要参数 | 处置 | 灵鲸对应／差异与理由 | 〔一手〕 |
| --- | --- | --- | --- | --- |
| `clone` | repo、dir、protocol https/ssh | 以后 | 交工作区创建流程；本步不会 clone 或自动写仓库 | paseo-upstream@8018231a:packages/cli/src/cli.ts:75 |
| `project create` | path | 以后 | 项目归 workspace 域，不能凭 cwd 充当会话 owner | paseo-upstream@8018231a:packages/cli/src/commands/project/index.ts:12 |
| `project ls` | 通用参数 | 以后 | 查询项目登记，与会话 ls 分开 | paseo-upstream@8018231a:packages/cli/src/commands/project/index.ts:19 |
| `project rename` | project-id、name、reset | 以后 | 只改展示名，不改路径／身份 | paseo-upstream@8018231a:packages/cli/src/commands/project/index.ts:23 |
| `project delete` | project-id | 以后 | Paseo 归档活动工作区但不删项目目录；灵鲸由 workspace 独立定义级联 | paseo-upstream@8018231a:packages/cli/src/commands/project/index.ts:33；paseo-upstream@8018231a:public-docs/cli.md:152 |
| `workspace create` | isolation local/worktree、path/project/title、mode branch-off/checkout-branch/checkout-pr、slug、new-branch/base/branch/pr-number/forge、background/no-background | 以后 | 独立创建流程与引用；背景可见性不改变进程归属 | paseo-upstream@8018231a:packages/cli/src/commands/workspace/index.ts:20 |
| `workspace setup` | workspace-id | 以后 | 安装／脚本执行不混进会话创建；有独立授权与日志 | paseo-upstream@8018231a:packages/cli/src/commands/workspace/index.ts:13 |
| `workspace ls` | background | 以后 | 不直接扫描所有目录推断登记 | paseo-upstream@8018231a:packages/cli/src/commands/workspace/index.ts:42 |
| `workspace rename` | id、title、reset | 以后 | 保留稳定 id | paseo-upstream@8018231a:packages/cli/src/commands/workspace/index.ts:49 |
| `workspace archive` | id | 以后 | 先清理其受管工作，再按引用释放 worktree；不由 brain archive 删除 cwd | paseo-upstream@8018231a:packages/cli/src/commands/workspace/index.ts:61；paseo-upstream@8018231a:docs/data-model.md:29 |
| 隐藏 `worktree ls` | cwd | 不需要此别名；能力以后 | 用统一 workspace 命令，不复制旧产品术语兼容入口 | paseo-upstream@8018231a:packages/cli/src/commands/worktree/index.ts:11；paseo-upstream@8018231a:packages/cli/src/cli.ts:164 |
| 隐藏 `worktree create` | mode、new-branch/base/branch/pr-number、cwd | 不需要此别名；能力以后 | 同上，能力交 workspace | paseo-upstream@8018231a:packages/cli/src/commands/worktree/index.ts:18 |
| 隐藏 `worktree archive` | name、cwd | 不需要此别名；能力以后 | 同上 | paseo-upstream@8018231a:packages/cli/src/commands/worktree/index.ts:33 |
| `terminal ls` | workspace、cwd | 以后 | 主人独立终端归 terminals；不等于 Codex 内部后台终端清单（后者在第 5 步） | paseo-upstream@8018231a:packages/cli/src/commands/terminal/index.ts:17 |
| `terminal create` | workspace、cwd、name | 以后 | 复用底座受管 PTY，不迁 Paseo terminal worker 体系 | paseo-upstream@8018231a:packages/cli/src/commands/terminal/index.ts:28 |
| `terminal kill` | terminal-id/prefix/name | 以后 | 停稳语义仍依赖 subprocess，不走脑会话 cancel | paseo-upstream@8018231a:packages/cli/src/commands/terminal/index.ts:37 |
| `terminal capture` | terminal-id、start/end、scrollback、ansi、json | 以后 | 读取终端输出与日志读取是两种 API | paseo-upstream@8018231a:packages/cli/src/commands/terminal/index.ts:44 |
| `terminal send-keys` | terminal-id、keys…、literal、json | 以后 | 复用 terminals 输入能力；不是 brain send | paseo-upstream@8018231a:packages/cli/src/commands/terminal/index.ts:56 |
| `script ls` | cwd、workspace | 以后 | 配置脚本属于工作区域 | paseo-upstream@8018231a:packages/cli/src/commands/script/index.ts:20 |
| `script start` | name、cwd、workspace | 以后 | 复用 jobs/terminals，有脚本运行记录与配置来源 | paseo-upstream@8018231a:packages/cli/src/commands/script/index.ts:26 |
| `script stop` | name、cwd、workspace | 以后 | 不以脚本名字扫描杀进程 | paseo-upstream@8018231a:packages/cli/src/commands/script/index.ts:32 |
| `schedule create` | prompt、every/cron、timezone、name、provider(/model)、mode/thinking、cwd、run-now、max-runs、expires-in；隐藏 target | 以后 | scheduler 唤醒同一 minds 投递入口，不另造 agent owner；隐藏旧 target 不迁 | paseo-upstream@8018231a:packages/cli/src/commands/schedule/index.ts:17 |
| `schedule ls` | 通用参数 | 以后 | 唯一 schedule 登记 | paseo-upstream@8018231a:packages/cli/src/commands/schedule/index.ts:42 |
| `schedule inspect` | id | 以后 | 查计划与下一次触发事实 | paseo-upstream@8018231a:packages/cli/src/commands/schedule/index.ts:46 |
| `schedule logs` | id | 以后 | 查触发／投递回执，引用会话事件 | paseo-upstream@8018231a:packages/cli/src/commands/schedule/index.ts:50 |
| `schedule pause` | id | 以后 | 停未来触发，不隐式 stop 已派回合 | paseo-upstream@8018231a:packages/cli/src/commands/schedule/index.ts:57 |
| `schedule resume` | id | 以后 | 恢复计划；漏跑补偿策略由 scheduler 定 | paseo-upstream@8018231a:packages/cli/src/commands/schedule/index.ts:61 |
| `schedule delete` | id | 以后 | 删计划不等于删除已发生的会话 | paseo-upstream@8018231a:packages/cli/src/commands/schedule/index.ts:68 |
| `schedule run-once` | id | 以后 | 单次触发与 cadence 分开 | paseo-upstream@8018231a:packages/cli/src/commands/schedule/index.ts:72 |
| `schedule update` | id、every/cron/timezone/name/prompt/provider/model/mode/cwd/max-runs/no-max-runs/expires-in/no-expires-in | 以后 | 通过唯一配置/调度服务校验，不写宿主第二份 timer | paseo-upstream@8018231a:packages/cli/src/commands/schedule/index.ts:79 |
| `heartbeat create` | prompt、cron、timezone、name、max-runs、expires-in | 以后 | 它是当前 agent 定时提示，不是进程健康心跳；灵鲸以后由 scheduler/实例策略持有 | paseo-upstream@8018231a:packages/cli/src/commands/heartbeat/index.ts:155 |
| `heartbeat update` | id、cron、timezone | 以后 | 同一 schedule 所有者更新 | paseo-upstream@8018231a:packages/cli/src/commands/heartbeat/index.ts:168 |
| `heartbeat delete` | id | 以后 | 删除计划，不能解除进程监管 | paseo-upstream@8018231a:packages/cli/src/commands/heartbeat/index.ts:176 |

#### 9.1.4 插件、主机、Hub 与其他入口

| Paseo 命令 | 主要参数 | 处置 | 灵鲸对应／差异与理由 | 〔一手〕 |
| --- | --- | --- | --- | --- |
| `plugin init` | directory、id | 以后 | 灵鲸已有 Cordis 规则，未来自身插件脚手架，不生成 paseo-plugin.json | paseo-upstream@8018231a:packages/cli/src/commands/plugin/index.ts:212 |
| `plugin ls`；隐藏 `plugin status` | 可选 id | 以后；隐藏别名不需要 | 复用自己的 plugin-manager，宿主不建第二插件注册表 | paseo-upstream@8018231a:packages/cli/src/commands/plugin/index.ts:219 |
| `plugin logs` | id | 以后 | 走插件唯一日志接口，不从 agent logs 猜 | paseo-upstream@8018231a:packages/cli/src/commands/plugin/index.ts:225 |
| `plugin install` / `add` | source、id、ref、path | 以后 | 现 `liwa plugin --profile …` 保持原行为；未来用户插件机制另定，本步不引入 Paseo registry | paseo-upstream@8018231a:packages/cli/src/commands/plugin/index.ts:228；apps/cli/src/args.ts:188 |
| `plugin update` | id/all、check、yes、ref、version | 以后 | 安装事务与宿主排空复用底座，不能热卸载有活会话的 provider | paseo-upstream@8018231a:packages/cli/src/commands/plugin/index.ts:243 |
| `plugin reload` | id | 以后 | 由 Cordis/插件服务掌管，含生命周期评审 | paseo-upstream@8018231a:packages/cli/src/commands/plugin/index.ts:254 |
| `plugin enable` | id | 以后 | 配置决定；本步 provider 装配经 profile | paseo-upstream@8018231a:packages/cli/src/commands/plugin/index.ts:254 |
| `plugin disable` | id | 以后 | 活句柄未释放前不能声称卸载成功 | paseo-upstream@8018231a:packages/cli/src/commands/plugin/index.ts:254 |
| `plugin remove` | id | 以后 | 不能同时删会话身份根与登录 | paseo-upstream@8018231a:packages/cli/src/commands/plugin/index.ts:263 |
| `host ls` | 通用目标 | 多端阶段（走 VPS） | 以后通过主人 VPS 维护已配对宿主连接的对应查询／变更；本步无远端登记，不能映射成删除本机 agent | paseo-upstream@8018231a:packages/cli/src/commands/host/index.ts:83 |
| `host add` | connection、label、meta | 多端阶段（走 VPS） | 以后通过主人 VPS 维护已配对宿主连接的对应查询／变更；本步无远端登记，不能映射成删除本机 agent | paseo-upstream@8018231a:packages/cli/src/commands/host/index.ts:88 |
| `host update` | registration-id、label/connection/replace-identity/meta/remove-meta | 多端阶段（走 VPS） | 以后通过主人 VPS 维护已配对宿主连接的对应查询／变更；本步无远端登记，不能映射成删除本机 agent | paseo-upstream@8018231a:packages/cli/src/commands/host/index.ts:99 |
| `host inspect` | registration-id | 多端阶段（走 VPS） | 以后通过主人 VPS 维护已配对宿主连接的对应查询／变更；本步无远端登记，不能映射成删除本机 agent | paseo-upstream@8018231a:packages/cli/src/commands/host/index.ts:111 |
| `host enable` | registration-id | 多端阶段（走 VPS） | 以后通过主人 VPS 维护已配对宿主连接的对应查询／变更；本步无远端登记，不能映射成删除本机 agent | paseo-upstream@8018231a:packages/cli/src/commands/host/index.ts:111 |
| `host disable` | registration-id | 多端阶段（走 VPS） | 以后通过主人 VPS 维护已配对宿主连接的对应查询／变更；本步无远端登记，不能映射成删除本机 agent | paseo-upstream@8018231a:packages/cli/src/commands/host/index.ts:111 |
| `host rm` | registration-id | 多端阶段（走 VPS） | 以后通过主人 VPS 维护已配对宿主连接的对应查询／变更；本步无远端登记，不能映射成删除本机 agent | paseo-upstream@8018231a:packages/cli/src/commands/host/index.ts:111 |
| `hub login` | origin | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/login.ts:62 |
| `hub logout` | disconnect-daemon、force | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/logout.ts:95 |
| `hub init` | 交互式生成／部署 trigger | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/init.ts:87 |
| `hub connect` | origin、api-key、permission… | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/connect.ts:64 |
| `hub disconnect` | force | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/disconnect.ts:45 |
| `hub status` | 通用目标 | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/index.ts:73 |
| `hub permissions list` | 通用目标 | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/permissions.ts:82 |
| `hub permissions grant` | permission | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/permissions.ts:89 |
| `hub permissions revoke` | permission | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/permissions.ts:89 |
| `hub projects` | hub、api-key | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/projects.ts:80 |
| `hub export` | directory、hub、api-key、force | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/export.ts:104 |
| `hub deploy` | project、hub、api-key、dry-run | 多端阶段（走 VPS） | 本步不实现；多端时评估对应 Hub 身份／授权／项目或触发入口，部署在主人 VPS 的接入面，业务仍调唯一底座 API；不整搬 Hub 后端 | paseo-upstream@8018231a:packages/cli/src/commands/hub/deploy.ts:252 |
| `hooks <agent> <event>` | hook 源与事件，stdin 载荷 | 不需要 | 与外部 CLI 空壳、钩子不自行加载的规则冲突；灵鲸事实直接由 provider 协议上报 | paseo-upstream@8018231a:packages/cli/src/commands/hooks.ts:22；[handoff.md](../../handoff.md) 决策 62–66 |
| `speech` | 没有已注册子命令／action | 不需要该空入口；语音以后 | 固定提交只有组名，不能盘成有下载/语音执行功能；未来语音归 senses/abilities | paseo-upstream@8018231a:packages/cli/src/commands/speech/index.ts:3 |

补充：源码有 `commands/open.ts` 辅助实现，但固定提交根程序**没有注册 top-level `open`**；实际入口是 `agent open`。主命令树依据 paseo-upstream@8018231a:packages/cli/src/cli.ts:64、121、131、138、150、161；空的分组帮助不是缺失的叶子命令。当前不做任何上述命令的执行，只读取源码。〔一手〕paseo-upstream@8018231a:packages/cli/src/cli.ts:48；〔推理〕盘点口径。



### 9.2 本步核心与附加任务

| 安排 | 本文采用 | 怎么做与边界 | 依据 |
| --- | --- | --- | --- |
| 列出可用模型、诊断入口 | **做，纳入第 3 步核心** | provider catalog/diagnostic 通用能力 + DeepSeek/Claude 与假提供方；Claude 能力在④先接、③接目录入口，Codex 能力在⑤接通。写“已配置／已发现”而非 Key 已验证可用；不为列模型发提示词 | 〔一手〕handoff 决策 65；packages/brain/brain/src/provider.ts:60；paseo-upstream@8018231a:docs/providers.md:118；〔推理〕 |
| `/goal`、`/plan`、`/compact` 经 ACP | **安排做为第 3 步独立附加任务，不阻塞核心托管评审** | deepseek CLI 从自身 commands 注册表发布 ACP available_commands 更新，执行仍归 CLI；宿主只转发明确命令、记录输入与结果，不把字符串当普通提示词猜。plan 复用 setMode；compact 按该预设 compaction 能力／空闲条件，instance 禁 off→compact；goal 只作用当前 CLI，会自开回合的事件必须正常记录／计费／受 watchdog。共同 command discovery seam 用假提供方验，不能在公共层列死三个名字 | 〔二手〕[handoff.md](../../handoff.md) 决策 62–66；〔一手〕packages/brain/brain-deepseek/src/session.ts:80；〔推理〕 |
| 非图片附件 | **安排做最小通用文件附件，作为独立附加任务** | 扩 TurnInput `file`（blobRef/name/mime），使用现有 attachment/upload 存储 API；落只读材料区的确切文件，经提供方能力映射 ACP resource 或受控路径+说明。没有能力则 unsupported，不能偷偷把 PDF 当文本；本步不做 OCR/语音转写/网页抓取。send 的路径是客户端选择的文件，宿主不会任意读客户端传来的绝对路径；单文件／总量上限进 Config，delete 按引用释放 | 〔一手〕packages/brain/brain/src/contract.ts:224（现仅三种块）；packages/api/session-controller/README.md:34（已有上传回执与附件路径）；〔二手〕[handoff.md](../../handoff.md) 决策 62–66；〔推理〕 |

模型目录／诊断与有界结构化输出属于核心；ACP 三命令、最小文件块是本步独立附加任务，均已确认；瘦身另任务。〔一手〕handoff 决策 65。

### 9.3 实现拆分与独立评审

下表定义实现任务的独立交付与评审范围。接口先冻结，依赖满足后可独立交回，不要求一次大 PR。

| 任务 | 交付与依赖 | 可交 GLM 的部分 | 必须重点评审 |
| --- | --- | --- | --- |
| A 契约与范围冻结 | 核对 §12 已定方案与计划接口；direct owner、JSON 与日志事实分工、状态、事件、游标、错误码、双向兼容、G1–G4 交接接口、模型／thinking／文件／命令能力边界 | 格式／类型表同步与逐条引用核对 | minds 唯一归属、默认语义、无秘密数据 schema |
| B 宿主与客户端装配 | A 后；brain-host profile、轻 brain、现基础服务共享装配、flock、ready/status、鉴权发现、兼容握手与单次能力判定 | 已确认行的 bundle/package/帮助文本与元数据 | 锁／权限／认证／启动所有权，不交 GLM 主改 |
| C 通用进程监管 | A 后；subprocess 的出生身份、启动屏障、waitForExit、对账与资源 API；独立假进程套件 | 固定解析夹具、资源表格渲染 | native 边界、kill-9 空窗、PID/pgid 复用、残留后代 |
| D 持久事件与投影 | A 后；复用 JSONL + session-projection + storage-domain/json per-record；逐条 agent/operation JSON、严格扫描错误、flush/read/delete、cursor、跨文件 intent 与 JSON 摘要补追 | 固定 schema/已注册投影单元测试／文档生成接线 | 唯一事实、提交点、损坏／磁盘失败与失效状态 |
| E minds 最小会话运行 | B/C/D 与 G1/G4 后；开会话、投递、代次、resume、串行准入、冷读、闲置回收 | 固定状态展示／纯格式映射 | 运行时 owner、晚事件、结果不明、不中断的后台工作 |
| F 待答与 CLI 主命令 | E 后；permit、logs/attach/wait/run/send、同机并发命令；G2/G3 做 schema 与宿主消费测试，端到端接线随第 5 步 | 解析器、选择题 codec、已冻结输出样式与错误文案 | 会话级 pending 预留、并发答复、snapshot/follow 边界 |
| G 提供方与配置 | B/E 后；多 impl、静态/动态 catalog、诊断、credential-ref、不可变 LaunchSpec 与 safe reload | 固定字段映射／配置 schema 负例 | 共享根污染、真实二进制、严格空壳边界 |
| H 停止、重启、删除 | C/D/E/F 后；全范围停稳、Paseo 式可配置自动恢复、archive/restore、精确删除 | 清理清单纯运算、命令输出 | 删除部分失败、恢复重放、未知结果不重启、不误杀 |
| I 结构化输出与资源展示 | E/F/G 后；schema 校验/有限纠正、usage、status watch | 纯 schema 校验、表格／JSON 输出 | 纠正回合归属／预算、已知与未知计量 |
| J 附加功能 | 主人单独确认后；ACP 命令、文件块、可选瘦身分别一任务 | 明确映射／帮助与测试夹具 | goal 自开回合、compact 约束、附件越权、瘦身行为等价 |
| K 集成验收 | 各块通过后，DeepSeek/Claude 真提供方 + 可执行假 CLI；完成 §9.4 | 机械检查与文档校验；不得擅自改门槛 | 独立复核故障注入、新旧协议夹具和最新构建产物；真实模型另授权 |

表中拆分与分工均为〔推理〕；遵循 handoff 的协作规则与已定排期。G1 随④交付、G4 在③前交付，不在 C/E/I 重复做；G2/G3 公共补口按已写回排期随 Codex，F 只做宿主侧扩展位置和消费测试，第 5 步再验整条链。不得派出去的人再开子 agent。〔一手〕[01-agent-cli.md](01-agent-cli.md) §4.11。

### 9.4 可逐项打勾的验收

用 **DeepSeek、先完成第④步的 Claude 两个真提供方**验宿主链路；无额度层用真的 `liwa --profile deepseek`＋scripted-model、Claude SDK＋可执行假 CLI；用可执行假 CLI 注入需要控制的 provider的时序与失败。假 CLI 必须经真实 subprocess 管道，不能全用内存 ScriptedBrainProvider 代替进程监管。下列是实现后的验收合同，D4/D5 默认值按 §12 已定方案。〔一手〕packages/brain/brain-deepseek/tests/fixtures/scripted-model.ts:1；packages/test-support/brain-testkit/src/contract.ts:159；〔推理〕。

| 编号 | 可观察验收结果 | 载体与边界 |
| --- | --- | --- |
| A01 | 同一机器的两个 CLI 并发 start 只出现一个 ready host；live-but-wedged 不能按超时偷锁；kill-9 后可重新拿锁；不同 home 能并行 | 真实宿主＋文件锁；验证有效 pid/bootId 与监听，不只断言调用次数 |
| A02 | CLI 退出、Ctrl-C attach、关闭 WS 后，会话与待答仍在；新终端 send 能继续同一逻辑会话 | DeepSeek/Claude 真提供方与假 CLI |
| A03 | 本机未授权、错 token、旧 boot Cookie 被现鉴权拒绝；正常 Node CLI 可 RPC/stream；产品版本不同不能一概断开 | Connection/Gateway 集成；不搭远程角色矩阵；协议双向兼容另见 A29 |
| A04 | 宿主不存在时 ls/send/provider 查询明确报错；status 显示 stopped；均不暗起进程；start 超时不误杀他人 | 真实客户端 |
| A05 | run no-wait 返回 durable id 与 receipt；响应丢失后同 operationId 不创建第二会话；不同内容复用 id 报冲突 | 在 commit 前后断连接／kill 点 |
| A06 | 同一 impl 同时 run 两会话、同 CLI 两 impl 同时运行，cwd/model/mode/env/规则/MCP 哨兵互不污染；冲突 impl 或秘密引用缺失大声失败 | DeepSeek/Claude 多实例＋假 CLI 配置审计；⑤再验 Codex |
| A07 | ls/logs/inspect 冷会话不 spawn；active/archived/runtime-closed/pending/background 状态正确，模型省略不出现占位模型 | 宿主日志／spawn 观测 |
| A08 | 在 snapshot 前、中、后注入事件与 gen 切换，attach 展示恰好一次；重连按 cursor 补齐；慢读溢出显式 resync，过期 cursor 显式失败 | 假 CLI + 同机并发命令；比较提交 eventId 集合与顺序 |
| A09 | default wait 对捕获回合／已接受 operation 等 idle/失败/权限检查点，starting 不误返 idle；默认 needs_input，--until terminal 才继续等；quiescent 含后台；超时不 stop | 假 CLI；deepseek 另记录 ACP terminal 边界，不假装父 idle 先可见 |
| A10 | 人工 send 默认 interrupt；steer 错 turn/gen 拒绝，仅明确 unavailable/unsupported 可报告中断回落；next_turn 只排一份；timeout 不 fallback 重送 | 可控 ACK 丢失／延迟假 CLI |
| A11 | 默认 stop 仅中断当前 running，idle no-op 并报告后台；scope all 完整停稳；旧 cancel/G4 timer 不收新轮；失败 stopping 拒新活 | G4 修复后的公共接口＋假 CLI |
| A12 | 父／子权限包含调用事实，父 agent 不代批；多终端竞争只有一份答复生效；非法 answer 仍 pending；已应用但应答丢失标 unknown | deepseek child hook + 假 CLI；若 deepseek 某预设不发子升级请求，必须修其接线或明确该用例未过 |
| A13 | 第 3 步：宿主消费面的 session-lifetime 记录不被父 terminal 清除，能表示后续 delivery 与失效；第 5 步：实际 permit 在 idle 仍可答、follow-up 贯通同队列 | 本步合成宿主事件／契约测试；**公共 BrainSession＋假 CLI／真 app-server 贯通是第 5 步门槛**，不得提前打勾 |
| A14 | 句柄延后出现会及时 durable；没有句柄／ephemeral 明确不可续接；正常 restart 新代拿新 token/完整 cfg，用原生 UUID/threadId 恢复，历史不重灌 | DeepSeek/Claude 真提供方与假 CLI |
| A15 | 启动屏障每个阶段 kill-9：不发生无持久 owner 的 CLI 执行；遗留范围经出生身份核对清理；PID 复用不误杀；观测未知阻止该会话恢复 | 真实进程故障注入，独立无关哨兵进程；macOS 必做 |
| A16 | 直系父退出而后代还活时不能显示“已停”；确认 waitForExit 全范围后才能 closed/reload/delete；强停也不跳身份校验 | 假 CLI 派出受控孙进程／故意 detach 反例；不可观察范围显式限制 |
| A17 | kill-9 后先保存修复前 running intent，再改旧代状态/失效 pending；按 已配置的恢复开关恢复合格 running 并记录继续输入；idle/initializing/archived 不运行；关开关消费旧 intent；失败无无限重试 | deepseek＋假 CLI；无句柄、未停稳、结果不明必须 blocked，不假恢复；同一继续 operation 不重复 admission |
| A18 | G1 成功／失败／取消的已知消费都保留且只结算一次；重复终止不重算；quota 不加入 token，unknown 不变 0；G3 childId 在本步宿主消费面不丢 | G1 公共契约＋假 CLI；G3 先合成消费测试，完整公共事件与 Codex 父子口径等第 5 步贯通实测 |
| A19 | archive busy 拒绝、force 停稳才归档；restore 不发 prompt；delete 任一步失败可重试；另会话、共享根、凭据、cwd 哨兵完整 | deepseek＋模拟 per-member 原生清理器；软链接路径反例 |
| A20 | 闲置回收受队列/pending/孩子/终端/通知否决；probe 超时未知保留；probe 期间新输入与 close 的竞争不丢；可续接时新代重开 | 可控时钟＋假 CLI，不靠真实 sleep 凑时序 |
| A21 | 资源页按 OS 采样匹配登记进程，后代不重复，短命进程／采样失败不显示 0；status watch 可取消且无泄漏 | 实际进程采样；记录采样开销、RSS 与稳定性 |
| A22 | provider diagnostic 不发模型请求／不读个人 home；models 标来源；配置 reload 失败不部分应用；活会话继续旧 spec，新会话取新 revision | 假二进制与假身份根哨兵；不以模拟证明两家原生隔离 |
| A23 | JSON 普通输出可解析、stream 是 NDJSON、stderr 独立；退出码/错误码稳定；模糊 id 冲突拒绝；所有主要帮助参数与实际 parser 一致 | CLI 进程级测试 |
| A24 | output-schema 的每次纠正都是持久回合并计费；断客户端不丢；预算／权限／stop 时暂停；超过配置上限给最终校验错误 | scripted-model 给错 JSON、合法 JSON 和挂起三组 |
| A25 | JSON appliedLogSeq 落后可从 JSONL 补相同摘要；坏 JSON/不可读/未来版本不能当 absent；JSON 写拒绝但已 rename 必须重开核对；flush 失败不先报成功 | 原 JSON/domain/JSONL 契约回归；agent 身份/未决 intent 的损失不能假称仅靠日志全还原 |
| A26 | `liwa web` 原默认启动、对话与存储路径行为不变；两者可同机启动不争同一 domain；CLI 的应用入口检查通过 | web 定向快照／装配比较＋构建后冒烟 |
| A27 | 附加项若主人纳入：ACP 命令清单与执行一致，compact 受能力约束，goal 自开回合不漏；文件上传有归属／限额／校验且能删除 | 独立任务，不勾选就写“未纳入”，不能顺手声称支持 |
| A28 | 实际布局为一 agent 一 JSON、一 process/operation 一 JSON；ls 无 SQL 路径；在 intent/JSONL flush/record rename/回执各点崩溃，恢复同 operation；批量删除部分成功如实返回；缺 processRefs 目标阻止恢复 | 真实 storage-json per-record＋故障注入；测 1,000/10,000 记录启动/ls/写入，记录字节与 RSS |
| A29 | 旧 CLI→新宿主、新 CLI→旧宿主均解析：新增字段可选，旧字段仍接受，nullable/枚举不收窄；新事件仅发给支持者；旧 history/send 仍工作，新能力缺失只 gate 该功能 | 使用历史 wire 夹具与真实 Typert/Connection codec；不只用 TS 编译通过代替解析；不因版本不同拒绝全部请求 |

上述验收项均为〔推理〕，其行为依据为 §3、§4 的源码／评估来源；故障注入是实现证据，不以本文推理代替。实现收尾按改动跑相关 test/test:coverage、typecheck/lint、doc-sync 与对应 snapshot；最后一次 build:artifacts 后必须 build:check（或直接 build），再以产物做启动／连接冒烟。真实 DeepSeek/Claude API 在对应实现任务明确授权后做端到端；无 Key 的 scripted-model 链通过不冒称真实 API 已验。〔一手〕AGENTS.md:55。

### 9.5 两份评估 §7 的逐条落实表

| 评估约束 | 本文落实／依赖 | 对应验收 |
| --- | --- | --- |
| Claude C1 run/start owner（docs/liwa/research/2026-11-05-claude-code-adaptation.md:328） | §1、§4.1，宿主持有 provider context 与 SDK 重开进程 | A02、A15 |
| C2 ls/status/inspect 状态（docs/liwa/research/2026-11-05-claude-code-adaptation.md:329） | 02-minds §2.3 正交状态与后台 unknown | A07、A09 |
| C3 延后 resume UUID（docs/liwa/research/2026-11-05-claude-code-adaptation.md:330） | 02-minds §2.5、§3.3 persistence-changed，新代完整 cfg | A14 |
| C4 logs/attach 不漏（docs/liwa/research/2026-11-05-claude-code-adaptation.md:331） | §4.4 单一 durable cursor 协议 | A08 |
| C5 稳定转录与共享根（docs/liwa/research/2026-11-05-claude-code-adaptation.md:332） | 02-minds §2.5 artifacts、§4.6 identity root | A06、A19 |
| C6 send/队列（docs/liwa/research/2026-11-05-claude-code-adaptation.md:333） | 02-minds §4.0 唯一投递 owner、明确 ACK | A10 |
| C7 wait 两种边界（docs/liwa/research/2026-11-05-claude-code-adaptation.md:334） | §3.1、§4.4 turn/quiescent | A09 |
| C8 permit 挂起与重答（docs/liwa/research/2026-11-05-claude-code-adaptation.md:335） | §4.5：明确未应用可重答，结果不明须先核对，重启旧 RPC 失效 | A12、A13、A17 |
| C9 stop 原因与 stopping（docs/liwa/research/2026-11-05-claude-code-adaptation.md:336） | §4.7 owner/all 与 preempt/watchdog 分开 | A11、A16 |
| C10 archive/delete（docs/liwa/research/2026-11-05-claude-code-adaptation.md:337） | §4.7 stop 后动作与精确清单 | A19 |
| C11 restart/孤儿（docs/liwa/research/2026-11-05-claude-code-adaptation.md:338） | §4.2、§4.3 逐条 JSON 台账、持久身份与屏障；不声称现内存表足够 | A14–A17 |
| C12 provider 探测（docs/liwa/research/2026-11-05-claude-code-adaptation.md:339） | §4.6 同可执行文件、认证分项、无模型默认 | A22 |
| C13 usage（docs/liwa/research/2026-11-05-claude-code-adaptation.md:340） | §4.7，依赖 G1；cacheRead/cacheWrite／累计差量归提供方 | A18 |
| C14 idle veto（docs/liwa/research/2026-11-05-claude-code-adaptation.md:341） | §4.8，未知 roster／通知未消费都保留 | A20 |
| Codex X1 runtime owner（docs/liwa/research/2026-11-05-codex-adaptation.md:359） | §1、§4.1，每会话受管 app-server，不连原生共享 daemon | A02、A15；第 5 步真验 |
| X2 provider/probe（docs/liwa/research/2026-11-05-codex-adaptation.md:360） | §4.6 安装与认证区分 | A22 |
| X3 正交状态（docs/liwa/research/2026-11-05-codex-adaptation.md:361） | 02-minds §2.3 含原生后台终端 | A07、A09 |
| X4 有效句柄／ephemeral（docs/liwa/research/2026-11-05-codex-adaptation.md:362） | 02-minds §2.5、§4.4；无句柄不假 resume | A14 |
| X5 完整新代配置（docs/liwa/research/2026-11-05-codex-adaptation.md:363） | 02-minds §2.5、§4.6 引用与版本，绝不恢复旧秘密 | A06、A14 |
| X6 日志真相与游标（docs/liwa/research/2026-11-05-codex-adaptation.md:364） | §4.4 不重放 native 历史 | A08、A14 |
| X7 原生路径／历史模式（docs/liwa/research/2026-11-05-codex-adaptation.md:365） | 02-minds §2.5 artifacts，保留非秘密定位事实，清理经 provider | A19；第 5 步真实索引 |
| X8 send expectedTurn（docs/liwa/research/2026-11-05-codex-adaptation.md:366） | §4.4 结果不明不重送 | A10 |
| X9 wait 人的检查点（docs/liwa/research/2026-11-05-codex-adaptation.md:367） | §3.1 默认返回权限检查点、timeout 不 stop | A09 |
| X10 permit 唯一路由／RPC id 类型（docs/liwa/research/2026-11-05-codex-adaptation.md:368） | §4.5，原生 id 映射在提供方 | A12 |
| X11 G2 异步问题（docs/liwa/research/2026-11-05-codex-adaptation.md:369） | §3.3、§4.5，本步预留不持久 Promise；公共补口与实际 follow-up 接线随第 5 步 | A13 分阶段、A17 |
| X12 stop/restart（docs/liwa/research/2026-11-05-codex-adaptation.md:370） | §4.2、§4.3、§4.7 先停稳后替换 | A11、A15、A16 |
| X13 能力 false 与 G4（docs/liwa/research/2026-11-05-codex-adaptation.md:371） | §3.3、§4.7，预算请求做不到就拒绝／明确观测型，G4 依赖另项 | A11、A18 |
| X14 usage G1/G3（docs/liwa/research/2026-11-05-codex-adaptation.md:372） | 02-minds §2.5、§4.7，计量口径未定不重算；第 5 步补真实通知关系 | A18 |
| X15 archive/delete（docs/liwa/research/2026-11-05-codex-adaptation.md:373） | §4.7 不删 CODEX_HOME，不起脱管清理 app-server | A19 |
| X16 idle veto（docs/liwa/research/2026-11-05-codex-adaptation.md:374） | §4.8 provider false/unknown 保留 | A20 |
| X17 同成员配置并发（docs/liwa/research/2026-11-05-codex-adaptation.md:375） | §4.6 稳定身份根＋不可变 revision＋每会话参数 | A06、A22 |

本表各行的评估约束为〔二手〕，落实方案为〔推理〕；它同时是④→③→⑤各阶段不能删减的回归清单。尚需真实 Claude/Codex 的项不以假 CLI 测试替代。

## 10 待实测

| 项目 | 必须看到的证据 | 阶段／依据 |
| --- | --- | --- |
| per-record 严格读取 | 坏 JSON、权限读失败、错误版本与 schema 错误均可区分；未知关键记录不变“零 agent/零进程”；不污染现有可丢弃缓存行为 | 第 3 步；〔一手〕packages/storage/storage-json/src/per-record-unit.ts:178；〔推理〕 |
| 单文件发布与多文件恢复 | 在写临时文件、rename、JSONL flush、agent checkpoint、操作回执之间分别杀进程；记录是旧或新完整值，跨文件按同 op 补齐，不重复模型投递 | 第 3 步；〔一手〕packages/storage/storage-json/README.zh.md:76；〔推理〕 |
| JSON 个人规模 | 1,000/10,000 条加载时间、ls p95、fd 峰值、raw 字节与 RSS；状态频繁变更下的写延迟；不把 NFS/Windows 的保证从本机 Mac 外推 | 第 3 步；〔一手〕packages/storage/storage-json/README.zh.md:143、144；〔推理〕 |
| 台账和出生屏障 | 从 intent 到 exec 每点 kill-9；PID 复用／孤儿孙进程／无法检查反例不误杀；旧范围不明不续接 | 第 3 步 P0；〔一手〕packages/brain/brain/src/session.ts:420；〔推理〕 |
| 本机 Node 连接与释放 | 实际 Cookie+Mux+RPC/stream 可用；CLI 退出不带走模型；旧 boot token 失效；无远端参数／设备存储 | 第 3 步；〔一手〕packages/client/connection/README.md:28、51；〔推理〕 |
| 协议双向解析 | 冻结初版 baseline 夹具，再用模拟增强版验证双方解析，实际经过生成 codec；optional 新字段、旧字段保留、nullable、新事件 gate；缺新功能不挡已有流程 | 第 3 步建立门槛，此后每改协议；〔一手〕paseo-upstream@8018231a:docs/protocol-compatibility.md:11、41、142；〔推理〕 |
| 自动续跑与默认命令 | 按 §12 已定默认值跑 running/idle/initializing/archived/unknown 的矩阵；新命令读到的是继续输入的真实回执，不误称原回合未中断 | 第 3 步；〔一手〕paseo-upstream@8018231a:docs/agent-lifecycle.md:17–33；〔推理〕 |
| deepseek 前台边界与子审批 | 对照 root turn/end、ACP prompt、child.ended；实际 bundle delegatedApproval=forward 与 childId 走新 host permit 全链。README 的旧 never 限制不当现状 | 第 3 步；〔一手〕packages/acp/acp/src/session.ts:533；packages/bundle/deepseek-app/cordis.patch.yml:43 |
| 同 impl/不同 impl 配置并发 | cwd/model/模式/MCP/规则/env 哨兵互不污染；live spec 不被 reload 改；身份根稳定、材料 revision 不变 | ④先验 Claude；③验 DeepSeek/Claude 加假 CLI；⑤验 Codex；〔二手〕docs/liwa/research/2026-11-05-codex-adaptation.md:375；〔推理〕 |
| G1/G4 与自主回合 | 消费另项最终接口，取消／失败费用不漏不重；G4 只取消捕获轮；审批等待如何计 watchdog 以该接口为准，宿主不另开计时器 | 第 3 步；〔一手〕[01-agent-cli.md](01-agent-cli.md) §4.11；〔推理〕 |
| G2/G3 实际贯通 | 本步消费 schema 可表示父 terminal 后问题、childId；第 5 步以真实公共层＋假 app-server 再加真 CLI 取代合成边界测试 | 第 5 步；〔二手〕docs/liwa/research/2026-11-05-codex-adaptation.md:340、341、347；〔推理〕 |
| 两家空壳、真实版本、原生材料／计量 | 依评估 A2/A3 查配置来源、UUID/threadId 可用时间、native archive/delete 索引、后台终端、父子用量包含关系；未知不假填 | 第 4/5 步；〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:322；docs/liwa/research/2026-11-05-codex-adaptation.md:353；〔推理〕 |
| `/goal`、`/compact`、文件块、瘦身 | 按已定附加范围独立验：自开回合受管、压缩符合预设、附件可读且清理精确、内存前后对照 | 独立附加任务；〔推理〕 |

以上是实现验收计划；当前文档不能代替实现或真 CLI 测试证据。〔推理〕验收边界。

## 11 依据

本设计依据 [handoff.md](../../handoff.md) 决策 62–66；源码证据使用仓库相对路径，Paseo 固定 `paseo-upstream@8018231a:<路径>:行`。〔一手〕表示源码或决定原文，〔二手〕表示适配评估转述，〔推理〕表示已确认的实现结构；不把“已定设计”当“代码已完成”。

| 依据 | 用于核对 |
| --- | --- |
| [02-minds.md](02-minds.md) §2.3–§2.7/§4.0 | 唯一数据、提交、状态与恢复 |
| [01-agent-cli.md](01-agent-cli.md) §2/§4.11/§4.12；[00-contracts.md](00-contracts.md) §5.1 | 现有与计划 API、G1–G4、提供方／进程义务 |
| `packages/storage/storage-json/README.zh.md:56`、`src/per-record-unit.ts:178`；`packages/storage/storage-domain/README.md:147` | 单文件原子、坏文件 absent 缺口、无跨记录事务 |
| `packages/session/session-persistence/src/handle.ts:85`、`:99`；`packages/session/session-projection/README.md:58` | append/flush、可提交切点与投影 |
| `packages/client/connection/README.md:28`、`:51`；`packages/api/gateway/README.md:27` | Node、本机鉴权和生成 RPC |
| `packages/subprocess/subprocess/src/types.ts:169`、`:188`；`native/system/README.md:25` | 受管范围、等待退出与锁 |
| `paseo-upstream@8018231a:docs/data-model.md:64`；`docs/protocol-compatibility.md:11`；`docs/agent-lifecycle.md:17` | 逐进程台账、双向兼容与默认恢复 |
| [Claude 适配评估](../../research/2026-11-05-claude-code-adaptation.md) §6/§7 | Claude 公共缺口与 14 条宿主约束 |
| [Codex 适配评估](../../research/2026-11-05-codex-adaptation.md) §6/§7 | Codex 公共缺口与 17 条宿主约束 |

§9.5 是两份评估 §7 的完整映射；真实 CLI 未被证明的项见 §10。

## 12 已定的点

以下均为主人已确认方案；具体技术实现仍按 A–K 分块评审，不重新询问产品取舍。〔一手〕handoff 决策 65、66。

| 点 | 已定方案 |
| --- | --- |
| D1 | minds 最小 direct 运行部分持有唯一登记、代次、回合、投递与待答；完整第二层接同一实现 |
| D2 | 本步会话与提供方；工作区／独立终端／调度下一批；多端等客户端完成后走 VPS |
| D3 | brain-host＋轻 brain＋本机 HTTP；restart 由短命替换载体持有，默认 web 不改 |
| D4 | 重启默认自动续跑合格原 running，可关闭；无有效句柄、未停稳、已知副作用／投递不明不续；失败不无限重试 |
| D5 | 人工 send 默认 interrupt，候选等待 10 分钟由 Config 给；wait 默认无期限、遇权限交还；stop 默认当前轮，scope all 全停 |
| D6 | Key 用底座 credential-ref，值不进配置／agent JSON／日志 |
| D7 | reload 只热改安全值，新会话新 spec；结构性插件改动需 restart |
| D8/D15 | provider models/diagnostic 与有界 output-schema 纠正纳核心；Config 管上限 |
| D9/D10 | ACP `/goal`、`/plan`、`/compact` 与最小 file/blob 块是本步独立附加任务，不附带 OCR/转写 |
| D11 | deepseek 瘦身另开性能任务，本步量资源；不改变每会话一进程 |
| D12/D13 | direct 闲置一小时回收，未知／后台／待答否决；本步完整验 Apple Silicon Mac |
| D14 | provider ls/diagnostic 和常驻 run 是目标命令；应用继续经 profile 启动 |
| 排期 | ④ Claude＋G1 → ③ 宿主（G4／JSON 严格读前置）→ ⑤ Codex＋G2/G3 |

没有未确认的 D 项。仍需实测的是 §10 的存储故障、身份／范围、性能、生成 codec 兼容与真实提供方行为；接口精确字段在计划契约落码时核对，不把它们当另一次产品范围审批。〔推理〕实施边界。

## 13 以后

**推进顺序：④ Claude Code＋G1 → ③ 本模块 → ⑤ Codex＋G2/G3；宿主前完成 G4 与 JSON 严格读取。** Claude 先用现公共层和一次性 brain run 验，不依赖常驻宿主；宿主建好后复验两个真提供方的托管生命周期。〔一手〕handoff 决策 66。

### 13.1 手机／独立客户端完成后：多端阶段（走 VPS）

**方向已定为走主人的 SSH VPS；这些部件属于多端阶段。** VPS 是将来的接入／中继位置，agent、凭据、日志与调度仍归灵鲸的同一底座服务；手机与独立客户端通过那条访问路径调用同一 API，不产生第二份 AgentManager 或 JSON 数据库。〔一手〕主人已定方案（handoff 决策 62–66）；〔推理〕职责分工。

| Paseo 借鉴部件 | 有什么可借 | 将来在主人 VPS 上的方向 | 本步明确不展开 |
| --- | --- | --- | --- |
| `packages/relay` | 中继传输、加密通道、E2EE/安全握手、protected records、Noise 相关实现与测试；固定来源统计生产 TS 13 文件 **2,950 行**（不含测试），符合“约 3,000 行” | VPS 提供中继/访问入口；本机宿主主动连 VPS 或走 SSH 转发，独立客户端接同一入口；解密端仍在客户端和宿主，中继只转密文 | 端口、部署清单、密钥轮换、连接路由与实现迁入不在本文 |
| relay 的部署适配 | 当前包有 Cloudflare Durable Objects adapter；公开文档说官方运行的是另一个 Elixir relay 服务 | 普通 SSH VPS 不能直接运行 CF Durable Object；后续评估独立 relay 服务或为相同传输加 VPS 适配，不能把 wrangler 配置 scp 上去就称已部署 | 独立 Elixir 服务需在多端阶段单独核验，不承诺可原样部署 |
| 配对 | `connection-offer`、`pairing-offer`、二维码／链接、宿主公钥固定；地址可配置 | 配对 offer 指向主人 VPS 地址，客户端固定正确宿主公钥；VPS 不拿模型 Key 或宿主私钥 | 设备登记／撤销／丢手机处理等以后专门设计 |
| 推送 | push token store、批量发送、无效 token 撤销；当前 PushService 使用 Expo | VPS 可承担通知调度／中转与脱敏事件触发；真正手机系统推送仍要与客户端选用的 APNs/FCM/Expo 等通道衔接，VPS 自身不能替代系统推送网络 | 不在本机阶段建 token 表、选推送供应商或接凭据 |
| 远端 host 与 Hub 命令 | 连接登记、身份校验、权限管理、远端触发／项目入口的用户语义 | §9.1 一律“多端阶段（走 VPS）”；届时只选实际需要的功能，入口接唯一底座业务服务，不搬整块 Hub 后端 | 不把这些命令标永久不要，也不提前承诺复制全部 Paseo 云产品 |

以上方向为〔推理〕；一手来源：paseo-upstream@8018231a:packages/relay/src/e2ee.ts:1、src/cloudflare-adapter.ts:1、src/secure-channel.ts:1；paseo-upstream@8018231a:public-docs/security.md:26、30、53；paseo-upstream@8018231a:public-docs/connectivity.md:19；paseo-upstream@8018231a:packages/server/src/server/pairing-offer.ts:14、36、43；paseo-upstream@8018231a:packages/server/src/server/push/push-service.ts:24、40；paseo-upstream@8018231a:docs/data-model.md:70。2,950 行仅是固定来源的代码盘点，不是迁移工作量或已经验过密码学实现。

SSH 是访问 VPS／转发连接的工具；relay/E2EE 是将来手机不直接 SSH 时可借的应用传输，两者不等同。具体用 SSH 转发、VPS 中继或组合要等客户端落地再定；不因此在本机 V1 加远端身份／证书／路由配置。现在只留下可兼容的 API 与明确服务边界。〔一手〕paseo-upstream@8018231a:public-docs/connectivity.md:11、21；〔推理〕。

### 13.2 其他后续归属

| 阶段 | 承接内容 | 边界／依据 |
| --- | --- | --- |
| ④ Claude Code（在宿主之前） | 适配器按既定迁法接同一宿主；模型／thinking／模式／诊断、子审批、后台 roster、原生清理与多 impl Key | 不迁 manager/storage/默认凭据扫描；真 A2 证空壳。〔一手〕[handoff.md](../../handoff.md) 决策 62–66；〔二手〕docs/liwa/research/2026-11-05-claude-code-adaptation.md:322；〔推理〕 |
| ⑤ Codex（在宿主之后） | 每会话受管 app-server，G2/G3 接预留字段，异步问题／计划审批／后台终端／线程清理 | 不连共享 Codex daemon；父子总量待实测；硬限能力不夸大。〔一手〕[handoff.md](../../handoff.md) 决策 62–66；〔二手〕docs/liwa/research/2026-11-05-codex-adaptation.md:353；〔推理〕 |
| 完整 minds/context/guard/toolport/tasks/journal | 在同一 agent/回合/投递所有者上扩实例与活；JSON 记录仍通过该服务公开 API | 不出现两套生命周期；journal 接手时明确一次 writer 转交，不长期双写两本权威事件。〔一手〕[02-minds.md](02-minds.md) §1；〔推理〕 |
| 网页与客户端 | 改走同一公共服务；当前网页行为本步不动 | 不从界面直读 JSON 文件；原底座 Agent 运行在 deepseek 子进程。〔一手〕packages/api/session-controller/README.md:11；〔推理〕 |
| 全局 home、本事、MCP、插件配置 | 领域唯一服务 resolve revision/LaunchSpec；本步只准备材料引用位置 | 不新建 parallel daemon/provider 配置，不存旧 token。〔一手〕[handoff.md](../../handoff.md) 决策 62–66；〔推理〕 |
| workspace/terminal/script/schedule | 按各自底座 seam 与领域 owner 做 §9.1 的后续命令 | 不塞进 brains 中心表；通过 API 调 minds。〔一手〕docs/architecture.md:144；〔推理〕 |
| 保留／备份／更大规模 | JSON/JSONL/blob 统一归属下再定保留期、tombstone 和备份策略 | 不因为本文用了逐条 JSON 就承诺无限规模；遇瓶颈另评审，不偷偷换介质。〔一手〕主人已定方案（handoff 决策 62–66）；〔推理〕 |

## 14 文档归属

| 所有者文档 | 维护内容 |
| --- | --- |
| [02-minds.md](02-minds.md) | direct/instance/task 的登记、代次、回合、投递、待答、agent JSON、提交与恢复；不在本模块复制定义 |
| [01-agent-cli.md](01-agent-cli.md) | provider/进程台账、配置、模型目录／诊断、持久观察、续接、可靠停稳与原生清理 |
| [00-contracts.md](00-contracts.md) §5.1 | 当前类型摘要和分开的计划接口表 |
| [four-layers.md](../four-layers.md) §2.8/§2.13 | direct 的资源／回收边界与实例／活策略引用 |
| [handoff.md](../../handoff.md) | 已定决定、④→③→⑤、G1/G4/JSON/G2/G3 排期与 develop/release 工作流 |
| [图页](01-brain-host.html)／[源](01-brain-host.src.html) | 派生视图，由 scenarios/build.py 生成；与本文和 owning 文档一起核对 |

以上为〔一手〕主人定稿的唯一归属；包 README、事件／API 目录与对应测试在实现任务中随实际代码同步，不把未实现能力写成当前运行行为。〔推理〕同步责任。
