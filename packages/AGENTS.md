# AGENTS.md — packages

本文件补充[根目录 AGENTS.md](../AGENTS.md) 的"技术约定"，内容继承自 DSH，改造之前仍然成立。

- **插件导出**：服务包默认导出它的服务类；函数插件具名导出 `name` / `inject` / `Config` / `apply`，不要默认导出。两种写法混用时，Loader 会丢掉函数插件的命名空间（[复盘](../docs/postmortem/0001-acp-default-export-drops-inject.md)）。
- **可选服务用 `ctx.get(name)`**。`ctx.<name>` 只留给声明过的注入：属性代理受拓扑影响，严格的 `ctx.get` 读的是全局服务表（[复盘](../docs/postmortem/0001-acp-default-export-drops-inject.md)）。
- **产品可见的插件要有一个非单元的真实装配测试**。手搭 `ctx.plugin(...)` 的测试不够：经 Loader 和应用进程启动测试专用的 `cordis.yml`，只模拟外部服务或不确定的输入，断言模型可见、持久化或用户可见的输出；可选项不进默认装配（[规则](../docs/testing.md)）。
- **发起方私有的调用链先推导再捕获**。在 `ctx.agents.withInitiator()` 下，每个编排入口重新取回 Agent、推导出 `agent.session`，让操作内部的辅助函数闭包捕获它。生命周期、会话日志、服务、权限、worker 与进程、持久化、线协议这些接口上，`Agent` 和 `Session` 保持显式；不要只为藏一个参数，就把叶子辅助函数的参数从 `Session` 放宽成 `Context`（[理由](../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md)）。
- **一个异步操作只用一个生命周期控制器或事务表示**。就绪、取消、释放、预留或哨兵状态要分开，就得各有独立的所有者或结算点；否则合并起来，同时保住回滚、回调隔离和静止状态。
- **服务定义为当前所有消费方设计**。工具 schema、Loader、界面、传输、提供方特有的行为留在消费方或提供方，不让某一个消费方左右服务契约（[理由](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）。反过来的坏味道：一个只有一个内部调用方的公开服务方法，应改成传一个私有的能力闭包（例如 `RunCodeBridgeOptions`）。
- **每个抽象都要有当前的所有者和需要**：抽象、状态机、选项、防御性拷贝、兼容路径，都要对应一个当前的契约或生产消费方，行为留在所属的插件或服务里。
- **公开的选择要有证据**。"可配置"不能成为不受支持的缺省值、公开操作集、格式或外来概念的理由；拿当前消费方的证据或相关先例，否则要求显式给值，或者推迟决定。
- **共享状态要有所有者**：挂在服务或实例上。模块级缓存、单例、全局 `WeakMap`、`Symbol.for` / `globalThis` / `window.__X__` 都会藏起所有者；不新增全局的 `current`、`active`、`selection` 单例，从当前作用域推导上下文。
- **业务规则放在自己的包里**。运行时、控制器、管理器、网关、API 分发层只做通用编排；业务分支放进独立的包，经登记接口或投影数据接入（[新行为放哪](../docs/architecture.md#where-new-behavior-goes)）。
- **面向模型的契约从模型的角度写**：提示词、工具 schema、结果、诊断只含与任务相关的概念，不含界面、传输或实现的词汇。稳定的模型可见文本逐字钉住，动态行为用快照或端到端测试钉住。
- **在做决定的那个操作里执行决定**。省略 schema、过滤提示词、门面、包装、监听器顺序都不算执行，因为直接或替代的调用方能绕过；拒绝要经执行者来测。
- **只在提交点发布状态**：操作成功之后才发通知、更新派生状态；缓存、提示词、界面回显、回放、查询视图都从同一个权威来源派生。
- **限额作用在完整结果上**：字节、token、条数、时间的限制，放在完整的输出或保留值（含包装与元数据）已知的地方；要测极小和恰好的限额、单块超限、多字节字符的字节限额。
- **注册表的贡献要证明能释放**：按测试规则做 HMR 安全测试，释放 fiber 后观察到贡献被移除（[规则](../docs/testing.md)）。
- **测试并发运行**：在派生的 worker 里，和其他检查进程并行。每个占用的端口、路径、子进程都由测试自己在收尾时释放；只有单独跑才能过的测试，是测试本身的缺陷（[执行模型](../docs/testing.md#how-specs-execute)）。

包的结构（[命名规则](../docs/cookbook/adding-a-package.md#name-the-role-that-exists)）：

- **tsconfig**：继承 `tsconfig.base.json`（浏览器端用 `tsconfig.base.client.json`），设 `rootDir: src`、`outDir: lib/types`，引用工作区依赖，并登记到一个汇总配置里。同时有宿主端和浏览器端编译面的包，用 `tsconfig.host.json` 和 `tsconfig.client.json` 两个叶子加一个只做汇总的根；普通的双入口浏览器插件不拆（[布局](../docs/development.md#typescript-project-layout)）。
- `src/types.ts` 只放类型，不放运行时代码。
- 测试放在包级的 `tests/` 下，不放 `src/__tests__/`。
- 行为变了，在同一次提交里更新包的 README 和 JSDoc 约定。分组 README 要声明子系统归属（`verify-subsystem-pages` 检查）；包 README 的"Model Experience"格式和 `## Known Limitations and Deferred Work` 一节由 `verify-package-readme-limitations` 等脚本检查。这几条 README 规范是 DSH 的文档体系，处理文档时再定去留。
