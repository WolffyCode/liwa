# 调研补充：操作日志与协作契约的工程依据

日期：2026-10-28。整体架构稿第 3 部分（§5 主意识与分身的协作契约、§6 事实来源与持久化）讲给用户之前，由主对话补查。§5 的依据主要来自已有调研和 `2026-10-28-subagent-notes/`；§6 里"日志只追加，但主人要能真正删除"和"先记将要做再执行"两处，补查了做事件溯源的系统和文章。

标注：〔一手〕读到原文；〔二手〕搜索摘要或第三方转述。

## 1. 来源

| # | 来源 | 读了什么 | 类别 |
| --- | --- | --- | --- |
| S1 | Mathias Verraes，*Eventsourcing Patterns: Forgettable Payloads*（2019-05），verraes.net/2019/05/eventsourcing-patterns-forgettable-payloads/ | 全文（经 WebFetch 转写） | 一手 |
| S2 | Mathias Verraes，*Eventsourcing Patterns: Crypto-Shredding*（2019-05），verraes.net/2019/05/eventsourcing-patterns-throw-away-the-key/ | 全文及读者评论（经 WebFetch 转写） | 一手 |
| S3 | Marten 文档 *Projections*，martendb.io/events/projections/ | 投影生命周期一节 | 一手 |
| S4 | Marten 讨论 #4953（异步投影守护进程在并发追加时把进度推过了未提交的事件） | 搜索摘要 | 二手 |
| S5 | Emmett（Oskar Dudycz 的 Node.js/TypeScript 事件溯源框架）SQLite 事件存储文档，event-driven-io.github.io/emmett/event-stores/sqlite.html | 搜索摘要；该页自己注明由 AI 辅助编写、仍在核对 | 二手 |
| S6 | Stripe API 文档 *Idempotent requests*，docs.stripe.com/api/idempotent_requests | 全文 | 一手 |
| S7 | Temporal 文档（Activity 定义、重试策略、错误处理最佳实践） | 搜索摘要 | 二手 |
| S8 | 本仓库 `2026-10-28-subagent-notes/cli-multi-agent-practice.md`、`cli-protocols-acp-a2a-mcp.md` | 已存档的子调研 | 见原文标注 |

## 2. 要点

### 2.1 日志只追加，怎么做到真正删除（关系到 overall.md §6.7 的 N7）

业界有两种做法：

| 做法 | 怎么做 | 代价 | 出处 |
| --- | --- | --- | --- |
| 可删除载荷（Forgettable Payloads） | 敏感内容不放进事件本身，放进单独的载荷存储，事件里只留一个引用。要删时只删载荷，事件不动；之后再读，这个位置就是空的 | 原文："breaks the concept of an Event Store as the Single Source of Truth"；读事件时要多查一次载荷存储。另一条警告：消费方不要把载荷复制到自己那里存，否则删不干净 | S1 |
| 密钥粉碎（Crypto-Shredding） | 敏感内容加密存进事件，每个"资源"一把密钥；要删时删掉那把密钥。原文："This effectively makes all copies and backups of the sensitive data unusable" | 原文："only as good as your encryption and your key management practices"；读者评论认为在法律上"加密后的个人数据仍是个人数据"。灵鲸是主人自己的数据，不涉及这个法律问题，但"密钥怎么保管、备份里有没有密钥"是实打实的工程问题 | S2 |

对灵鲸的含义〔推理〕：

- 稿子里 N7 原来的写法是"把那些事件的内容替换成墓碑"，这等于改写日志。用可删除载荷可以不改写日志：事件信封（谁、什么时候、什么类型、因果、来源、受众）永远不改；消息正文、工具输出这类内容放进载荷存储，事件只存引用。主人要求彻底删除时删载荷，事件还在，内容没了。灵鲸的大对象本来就按哈希存在 `blobs/`、事件只放引用（overall.md §6.2），这个做法是把同一套机制推广到所有正文。
- "删之前做的备份里还有原文"这个问题，可删除载荷解决不了，只有密钥粉碎能解决，前提是密钥不和备份放在一起。可以作为以后的选项，第一版不做。
- S1 的警告正好对上灵鲸已有的两条规则：记忆这类投影要能在删除后重建（overall.md §6.3）；CLI 自己存的转录是副本，删除时要连带处理（§6.4）。

### 2.2 内联投影和异步投影（关系到 §6.3）

Marten（.NET 的事件存储）把投影分三种〔一手，S3〕：

- **Inline**：在追加事件的同一个工作单元里更新，读到的永远和事件一致。
- **Async**：由后台守护进程按进度追上，原文"executed by a background process (eventual consistency)"。
- **Live**：每次查询时从事件现算，不存。

灵鲸稿子里的"内联投影 / 异步投影"和 Marten 的前两种是同一个划分。Marten 的讨论 #4953 报告过一个坑：并发追加时，异步守护进程把进度推到了还没提交的事件之后〔二手，S4〕。灵鲸是单写者（§3.1），这个坑碰不到，但异步投影的检查点必须只记已经提交的全局位置。

### 2.3 Node/TypeScript 上的现成事件存储（关系到 §6，模块阶段评估）

Emmett 是 Node.js/TypeScript 的事件溯源框架，有 SQLite 事件存储适配包 `@event-driven-io/emmett-sqlite`，依赖 better-sqlite3，首次使用自动建表〔二手，S5〕。灵鲸已定用 node:sqlite（决策 3）。自己写日志还是借用 Emmett，留到前后端模块评估，整体架构不受影响。

### 2.4 先记"将要做"、幂等键、结果不明不重放（关系到 §6.5）

- **Stripe 的幂等键**〔一手，S6〕：客户端给每个创建或修改请求生成一个唯一键；同一个键重试时，Stripe 直接返回第一次保存的结果，包括 500 错误；参数和第一次不一致就报错；键至少保留 24 小时。→ "重试用同一个幂等键"只对支持去重的服务有效，键要在第一次调用前生成并记下。
- **Temporal 的活动语义**〔二手，S7〕：活动（Activity，指有外部副作用的一步）默认"至少执行一次"，执行成功但没来得及上报就会被重试，所以官方建议把活动写成幂等；把最大尝试次数设成 1 就变成"最多一次"，代价是可能一次都没执行。→ 灵鲸 §6.5 的规则正好是这两种的分工：对方支持去重的动作带幂等键重试（至少一次）；对方不支持去重、结果又不明的（例如发出去的 QQ 消息）标"结果不明"、不自动重放（最多一次），交给主意识或主人决定。

### 2.5 派活交接与汇报（关系到 §5.5）

以下都已在子调研存档里，这里只汇总和 §5.5 的对应：

| 发现 | 出处 | 对应 §5.5 |
| --- | --- | --- |
| Anthropic：每个子 agent 要有目标、输出格式、工具和信息源的指导、清晰的任务边界；说得含糊就会重复干活 | `cli-multi-agent-practice.md` [1] | 交接包的"汇报格式""边界"两项 |
| LangChain 基准：主管转述子 agent 的回复会引入错误；加一个原样转发的工具，约提升 50% | 同上 [10/11] | "传原话"；汇报方向也可以原样转发 |
| OpenAI Agents SDK：把子 agent 当工具调用时，子 agent 只拿到工具参数，父 agent 的状态不会自动继承，要手工挑选传什么历史 | 同上 [9] | "相关聊天由主意识选范围、本体取原文" |
| Magentic-One：任务账本（已知事实、待查事实、推断、计划）加每轮进度账本；停滞计数超过 2 就重新规划；去掉账本效果降 31% | 同上 [12] | 干活分身的进度摘要格式和停滞检测（模块阶段细化） |
| MAST：加一步对照总目标的核验，成功率 +15.6%；该问不问占 6.8% | 同上 [13] | "回问通道"和完成核验（§12.5） |
| A2A 1.0：任务有 `INPUT_REQUIRED`、`AUTH_REQUIRED` 两种"中断态"，规范举例"破坏性操作前的人工批准"属于后者 | `cli-protocols-acp-a2a-mcp.md` §2 | 任务状态机里"等主人审设计""等主人验收"这类关口状态 |

## 3. 待核实

- Temporal 的说法来自搜索摘要，摘取前要读官方文档原文。
- Emmett 的 SQLite 文档自称由 AI 辅助编写、还在核对，用之前读源码。
- 密钥粉碎的密钥保管方案（放在哪、备份怎么处理）留到存储模块设计。
