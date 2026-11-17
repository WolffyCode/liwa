# liwa 仓库开发规范

日期 2026-11-16 · 状态：现行（主人 2026-11-16 定）。

在本仓库里动手之前先读完这份。它管 git 分支、工作目录、代码放哪、提交、检查、开发环境和文档；每一期怎么从设计走到发版，见 [`roadmap.md`](roadmap.md) 第 1 节；产品和架构见 [`product.md`](product.md)、[`architecture.md`](architecture.md)。Paseo 原有的规范（根目录 `CLAUDE.md` 后半部分、`docs/coding-standards.md` 等）继续适用。

## 0. 一页看完

- `release` 是**发版分支**，`develop` 是**开发分支**。**所有需求都从最新的 `develop` 拉分支开发**，审完快进合回 `develop`；验收通过后 `develop` 快进到 `release` 发版。
- 不在 `release` 上开发，不强推 `develop` 和 `release`，不用 `--no-verify` 跳过提交钩子。
- liwa 新代码只放四个地方（第 3 节）；改 Paseo 原有代码只通过公共契约改，每处配契约测试。
- 跑开发脚本和测试前，先去掉继承的 `PASEO_HOME` 等变量（第 6 节），否则开发版会读写正式安装的 Paseo 的数据。
- 提交、推送、合并、发版都要有那一次任务的明确授权。

## 1. 分支

| 分支            | 用途                             | 规则                                                      |
| --------------- | -------------------------------- | --------------------------------------------------------- |
| `release`       | 发版分支：验收通过的版本         | 只从 `develop` 快进过来；不直接在上面提交；每次发版打标签 |
| `develop`       | 开发分支：所有需求的起点和集成处 | 只接受审过的功能分支快进合入，以及上游 Paseo 的合并       |
| 功能分支        | 一个需求一个分支                 | 从最新的 `develop` 拉；合回后删除                         |
| `upstream/main` | 上游 Paseo（远端 `upstream`）    | 只读，只用来合上游                                        |

**功能分支的命名**：`<类型>/<编号或简述>`。

| 类型       | 用在                     | 例子                        |
| ---------- | ------------------------ | --------------------------- |
| `feature/` | 路线图里的里程碑或新功能 | `feature/m1.1-memory-store` |
| `fix/`     | 修问题                   | `fix/memory-page-delete`    |
| `docs/`    | 只改文档                 | `docs/memory-design`        |
| `chore/`   | 依赖、脚本、构建         | `chore/electron-download`   |

一个里程碑一个功能分支；里程碑大的可以拆成几个分支，各自能单独通过检查。

**从拉分支到合回：**

```bash
# 1. 从最新的 develop 拉分支，旁边另开一个工作目录
git -C ../liwa-dev switch develop
git -C ../liwa-dev pull --ff-only
git -C ../liwa-dev worktree add -b feature/m1.1-memory-store ../liwa-m1.1 develop
cd ../liwa-m1.1 && npm ci

# 2. 开发、提交（提交钩子会跑格式、lint、类型检查）

# 3. 合回前：把功能分支挪到最新的 develop 上，跑第 5 节的检查
git rebase develop

# 4. 审完后快进合回，推送，收掉工作目录
git -C ../liwa-dev merge --ff-only feature/m1.1-memory-store
git -C ../liwa-dev push origin develop
git -C ../liwa-dev worktree remove ../liwa-m1.1
git -C ../liwa-dev branch -d feature/m1.1-memory-store
```

- 功能分支只有自己在用，合回前可以 rebase；`develop` 和 `release` 永远不 rebase、不强推。
- 只改文档的小分支可以直接在 `../liwa-dev` 里切换，不必另开工作目录。

**发版**：一期（或一个子期）验收通过、主人同意后：

```bash
git -C ../liwa-dev push origin develop:release          # 快进，release 跟到 develop
git -C ../liwa-dev tag -a liwa-v0.<期>.<序号> -m "<这一版做了什么>" develop
git -C ../liwa-dev push origin liwa-v0.<期>.<序号>
git -C ../liwa pull --ff-only                            # 本机 release 目录跟上
```

标签按期编号：第 1 期验收发版是 `liwa-v0.1.0`，期内修问题再发是 `liwa-v0.1.1`；第 3 期分两段，角色是 `liwa-v0.3.0`，群是 `liwa-v0.3.1`。

**合上游 Paseo**：每期发版之后合一次；中途上游有要紧修复时也可以合。

```bash
git -C ../liwa-dev fetch upstream
git -C ../liwa-dev merge --no-ff -m "merge: 合入上游 Paseo <版本>（<提交号前 8 位>）" upstream/main
```

- 用普通合并，不 rebase，保留上游的提交历史。
- 合完跑第 5 节的全套检查再推送。
- 冲突时，按 liwa 那处改动的原意在原处改对，不叠一层兼容。冲突多半出在 [`architecture.md`](architecture.md) 第 6 节那些契约上。

## 2. 工作目录

| 目录                   | 分支      | 用途                                           |
| ---------------------- | --------- | ---------------------------------------------- |
| `../liwa`              | `release` | 只用来验证发版版本，不在里面开发               |
| `../liwa-dev`          | `develop` | 开发分支的工作目录；只改文档的小分支在这里切换 |
| `../liwa-<编号或简述>` | 功能分支  | 每个功能分支另开一个，合回后收掉               |

- 三个目录是同一个仓库（git worktree），共享提交和分支。
- 每个新开的工作目录第一次用要 `npm ci`；目录移动后依赖照常可用（依赖之间是相对链接）。

## 3. 代码放哪

| 位置                               | 放什么                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `plugins/liwa-*/`                  | liwa 的内置插件：记忆库 `liwa-memory`，以后的外部适配器 `liwa-adapter-<平台>` |
| `packages/server/src/server/liwa/` | liwa 核心模块：内核 `kernel/`、成员数据 `member-data/`                        |
| `packages/protocol/src/liwa/`      | 客户端和 daemon 之间 liwa 部分的协议                                          |
| `packages/app/src/liwa/`           | liwa 的内置界面                                                               |

- 对 Paseo 原有代码只改 [`architecture.md`](architecture.md) 第 6 节列出的公共契约；在原处改语义，不另加平行状态；每条契约配一个契约测试，保证普通 agent 的行为不变。
- 代码里的 `paseo` 名字（包名、命令、数据目录）不改。
- 编程规则：
  - 先照 Paseo 的 `docs/coding-standards.md`；
  - 改在根上，不叠兼容层；
  - 一个函数一件事；每样数据、每个常量只有一个归属；
  - 部件之间只走公开接口；
  - 数字和上限放配置，代码里不写死；
  - 异常不吞，捕获了就要往上抛或记日志并写明为什么能忽略。

## 4. 提交

- **格式**：`<类型>(<范围>): <中文说明>`。
  - 类型：`feat`、`fix`、`docs`、`test`、`refactor`、`chore`、`merge`。
  - 范围：`liwa`、`memory`、`kernel`、`app`、`protocol` 等。
  - 正文写为什么这样改。
  - agent 写的提交，末尾加一行 `Co-Authored-By`。
- **一个提交一件事**，每个提交都能单独通过检查。
- **提交钩子**（lefthook）会自动跑改动文件的格式检查、lint 和全仓库类型检查，不许用 `--no-verify` 跳过。
- 不提交个人路径、用户名、凭据、原始对话记录（本仓库是公开的）。

## 5. 检查

**合回 `develop` 之前**，在功能分支的工作目录里跑：

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test --workspace=@getpaseo/<改到的包>      # server 用 test:unit
```

- 改到界面的，还要在桌面开发版上实际走一遍。
- 合上游之后，跑全部包的单测：protocol、client、server、app、relay、plugin、highlight。

**本机已知的失败**：下面这些在上游 Paseo 本身就失败，和 liwa 无关；合回时如果只有它们失败，不算回归。

| 测试                                                                                                          | 原因                                                                                               | 怎么确认                                           |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| server `diff/git.test.ts` 的 trailing folder spaces、`workspace-service-port-allocator.test.ts` 的 portScript | macOS 上 `/var` 其实是 `/private/var`，测试按 Linux 路径断言；上游 CI 的 server 单测跑在 Ubuntu 上 | —                                                  |
| app `usage/format.test.ts` 的 "adds the weekday within 7 days"                                                | 跨夏令时，在 PST 时区下失败                                                                        | `TZ=UTC` 重跑通过                                  |
| server `claude/agent.env.test.ts` 的 6 个                                                                     | 从 Claude 会话里跑时继承了 `CLAUDECODE` 等变量                                                     | 去掉 `CLAUDECODE`、`CLAUDE_CODE_ENTRYPOINT` 后通过 |
| server `scripts/supervisor.logging.test.ts`                                                                   | 全量并行跑时偶尔超时                                                                               | 单独跑通过                                         |

**快进合并后提交钩子报类型错误**：如果报的是 client 找不到 protocol 里的新类型，是因为编译产物还是旧的，先 `npm run build:server-deps` 再提交。

## 6. 开发环境

- **Node**：用 `.tool-versions` 钉的 22.20.0，放在 `PATH` 最前面；打包版 daemon 跑在 Electron 自带的 Node 上，不受影响。
- **去掉继承的变量**：从 Paseo 里启动的 agent 会继承 `PASEO_HOME=~/.paseo`，而开发脚本看到 `PASEO_HOME` 就直接用它（`scripts/dev-home.sh` 的 `configure_dev_paseo_home`）。所以跑开发脚本和测试前先执行：

  ```bash
  unset PASEO_HOME PASEO_AGENT_ID PASEO_AGENT_CWD PASEO_WORKSPACE_ID PASEO_CLI
  ```

  从 Claude 会话里跑测试时，再去掉 `CLAUDECODE`、`CLAUDE_CODE_ENTRYPOINT`。

- **开发版 daemon**：`npm run dev:server`，地址 `127.0.0.1:6768`，状态存在仓库内的 `.dev/paseo-home`，不碰正式安装的 Paseo（`127.0.0.1:6767`、`~/.paseo`）。
  - `dev:server` 在 `package.json` 里把端口写死成 6768，外面传的 `PASEO_LISTEN` 会被覆盖。几个工作目录要同时起 daemon 时，直接用 `PASEO_LISTEN=127.0.0.1:<端口> ./scripts/dev-daemon.sh`；`npm run cli` 带同一个 `PASEO_LISTEN` 就会连到它。
- **桌面开发版**：`npm run dev:desktop`，窗口叫"Paseo Debug"，窗口数据存在仓库内的 `.dev/user-data`，可以和正式的 Paseo.app 同时开。
  - 第一次启动要下载 Electron。在代理环境下 Node 22 的下载不走代理，可能中途断开。这时换 Node 24，在 `node_modules/electron/` 里跑 `NODE_USE_ENV_PROXY=1 node install.js`，让下载走代理。
- **测试留下的东西**：server 单测会在仓库根目录留下 `.artifacts/`，不入库，测完删掉。

## 7. 文档

- liwa 的文档都在 `docs/liwa/`，中文，只存最新方案；格式由 oxfmt 统一（提交钩子会查）。
- 索引是 [`README.md`](README.md)，新加文档时在索引里登记一行。
- 每期动工前的设计稿：`docs/liwa/<名>.md`，如 `memory.md`、`dual-layer.md`。
- 每期的详细计划（逐个任务、改哪些文件、先写什么测试）：`docs/liwa/plans/<期>-<名>.md`，如 `plans/phase-1-memory.md`。
- 里程碑的进度记在 [`roadmap.md`](roadmap.md) 里程碑表的"状态"列，做完一个改一个。
- 结论带出处，写成 `<路径>:<行号>`；能说清依据的标〔一手〕〔推理〕。
