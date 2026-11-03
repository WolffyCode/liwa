# 界面参考：AI agent 工作台、多任务派活、高质感桌面应用

> 调研日期 2026-11-02，限时 15 分钟完成，所以这里只写**能直接照做的做法**，不写总论。 > 标记说明：〔一手〕＝官方文档、官方博客或官方更新日志；〔二手〕＝评测、教程或第三方拆解。凡是"建议"开头的，都是对灵鲸的推论，不算事实。 > 有几个页面在本次环境里打不开（developers.openai.com/codex/app 返回 403，code.claude.com 连接中断，docs.x.ai 走代理 502），相关条目改用搜索摘要或二手转述，已在条目里注明。

---

## 一、可直接照做的清单（按"对灵鲸最有用"排序）

1. **"活"列表里每件事只显示一个状态点：运行中、等你、已完成、出错。"等你"用唯一的强调色，并排在最前**。借自 Cursor 2.0 Agents 侧栏（分运行中、已完成、等待三种状态）和 Codex app 的 review queue。
2. **需要主人做的事统一做成一张"审批卡"，三个按钮固定为：允许一次、总是允许、拒绝。"总是允许"必须写清范围，比如"以后 `npm test` 都不再问"**。借自 Grok Bot 的 Auto Review（Allow once、always-allow rule、deny）和 Claude Code 的"Yes, and don't ask again for …"。
3. **拒绝按钮旁边直接带一个输入框："不行，你改成……"。拒绝不是终点，而是一次纠偏**。借自 Claude Code 的"No, and tell Claude what to do differently (esc)"。
4. **审批卡上写清这一步会造成的具体后果：命令原文、要改哪些文件、要发给谁、花多少钱。不能只写"需要权限"**。借自 Grok Bot 付款审批（卡上列出商户、商品、总价）。
5. **全局 ⌘K 命令面板：可以搜"她、活、脑、端"，也可以直接执行"派一件活给小满""切到妈妈实例"。每条结果右侧显示快捷键，帮主人逐步脱离面板**。借自 Raycast 的 Action Panel 和 Linear 的 command menu。
6. **选中任意一张卡（一件活、一个实例），按 ⌘K 弹出"对这张卡能做的所有动作"，回车执行第一个动作**。借自 Raycast 的 Action Panel（↵ 执行主动作，⌘K 打开全部动作）。
7. **两键跳转：G 再按 H 跳到"她"，G 再按 W 跳到"活"，G 再按 B 跳到"脑"，G 再按 D 跳到"端"；按 ? 弹出快捷键表**。借自 Linear 的 G+I、G+M。
8. **每件活都能展开一个"她的电脑"实时预览窗（终端、浏览器或产出物），可以拖时间轴回看每一步**。借自 Manus 的 Manus's Computer 回放、Devin 的 Progress 标签（点一条命令就跳回当时状态），以及 Grok Bot 的 Agent Computer。
9. **"接管"按钮：活卡在需要登录或验证码的步骤时，主人点"我来"，做完再点"交还"**。借自 Grok Bot 的 take over 和 hand back。
10. **写代码类的活完成后，直接显示汇总 diff。可以逐行评论，评论自动变成下一轮指令**。借自 Codex app 的 review pane（可在 diff 上评论）和 Devin 的 Global Work Diff。
11. **乐观更新：主人点"允许"或"派活"后，卡片立即变成下一个状态，后台失败再回滚并提示。整个 demo 不出现转圈**。借自 Linear 的 sync engine（先改本地，再在后台同步）。
12. **"活"按来源分组，同时保留一个跨分组的"等你处理"收件箱。主人每天只需清空这一个入口**。借自 Codex app automations 的 review queue。
13. **"她自己的事"做成 Pulse 式的每日几张卡（5 到 10 张，不无限滚动）：可以点赞、点踩，也可以说"多聊这个"**。借自 ChatGPT Pulse。
14. **侧栏可以折叠成 48px 的头像轨道，悬停时展开到 240px，文字延迟 0.1 秒再淡入**。借自 Arc 侧栏（二手示意值：宽度变化 0.2 秒 ease-out，文字淡入 0.15 秒，延迟 0.1 秒）。
15. **切换实例（和你、妈妈、独处）像切换 Arc Space：每个实例有自己的主题色渐变，⌘1、⌘2、⌘3 直达，切换时用弹簧动画（response 0.3，damping 0.7）**。借自 Arc Spaces。
16. **材质分层：侧栏和浮层用毛玻璃，内容区保持实色。毛玻璃只给"功能层"用，不要整屏都是玻璃**。借自 Apple HIG Materials 和 Linear 的 Liquid Glass 做法（不做折射，以免影响可读性）。
17. **毛玻璃上的文字和图标使用"vibrant"高对比色，并跟随"增强对比度"设置描实线边框**。借自 Apple HIG 和 Linear Liquid Glass（Increase Contrast 时画实线轮廓）。
18. **滚动区上下边缘加渐变模糊，越靠近边缘越糊**。借自 Linear Liquid Glass 的 scroll edge effect。
19. **高频操作不加动画，或者只用 100 到 150ms；低频的"大事"（派出一件活、活完成）才给显眼的过渡。所有动画都可以被下一次操作打断**。借自 Apple HIG Motion（"高频交互避免加动效""允许打断动效"）。
20. **"活"从"她"身上派出时，用共享元素过渡：她头像旁边飞出一张小卡，落进"活"的列表**。这是建议，形式借自 Things 3 的 Magic Plus（拖出新建项的动画被评测反复夸）。
21. **四层总览的连线只在"有事在流动"时显示流动动画，并且只显示一次：活完成后，连线变成静止的绿色或打勾**。借自 n8n 执行视图（成功节点打绿勾，已执行的连线变绿）。
22. **"脑"层的节点可以点开就地改配置（模型、额度），不跳转页面**。借自 Railway 画布（"可以直接在画布上改设置"）。
23. **每个"她的实例"是一张"有名字、有职责"的身份卡，再加一个主实例星标**。借自 Grok Bot 侧栏（每个 Bot 都有名字和 job，Primary Bot 带小星标）。
24. **只读和高风险分开：读消息、读文件默认放行，发送、删除、付款永远单独审批，不给"总是允许"**。借自 Grok Bot 的指南（发送、发布、购买、删除属于"需要盯"的动作）。
25. **偶发事件（比如断线需要重连）一天最多提示一次**。借自 Grok Bot 的 Reconnect 卡（最多一天一次）。

---

## 二、"四层主界面"的三个布局思路

1. **左轨加泳道（推荐 demo 首选）**：最左侧是一条窄轨，竖排"端"的图标；左侧是"她"的实例卡（每个实例像 Arc Space 一样有自己的色彩）；中间是"活"的泳道，每件活一行，卡片带状态点；每行右端挂一个小药丸，标明这件活用的"脑"。从左到右的阅读顺序就是"端 → 她 → 活 → 脑"的流向，点任意一行，右侧滑出详情（审批卡、diff、实时画面）。借鉴 Arc 侧栏、Cursor Agents 侧栏和 Codex 的三栏布局（项目侧栏、线程、review pane）。
2. **四列流向画布**：四层各占一列，节点之间用贝塞尔连线；有活在跑时，连线上会流动光点，完成后定格为打勾；节点可以点开就地编辑。适合用作"炫酷"的总览首页，按 ⌘K 或回车即可钻进列表视图干活。借鉴 Railway 项目画布、n8n 执行视图和 Rive 状态机图（带方向箭头的连线）。
3. **以她为圆心的轨道**：小满的头像居中，显示呼吸和状态；内圈是"端"，外圈是正在跑的"活"，按"脑"着色；"等你"的活会脱离轨道，浮到屏幕下方的审批托盘里。这个方案最有"数字生命"的气质，但信息密度低，适合做开场或空闲态，干活时一键切回思路 1。借鉴 Grok Bot "以 Bot 为中心而不是以任务为中心"的组织方式，以及 ChatGPT Pulse 卡片托盘。

---

## 三、最值得学的三个产品

- **Grok Bot**：它和灵鲸的形态几乎一样，都是"有名字、有职责、自己有电脑、会在后台干活"的角色。审批卡（允许一次、总是允许、拒绝，并写清后果）、接管与交还、一天最多提醒一次，都可以直接搬用。
- **Raycast 与 Linear**：键盘优先的标杆。⌘K 动作面板、回车执行主动作、快捷键随行显示、G 字两键跳转、乐观更新，是"便捷"和"丝滑"最省力的来源。
- **Arc**：侧栏折叠与悬停展开、Space 主题色加 ⌘数字切换、弹簧过渡，正好对应"她按相处对象分实例"的切换体验，是"炫酷又不吵"的范本。

---

## 四、逐个产品的笔记

### OpenAI Codex 桌面应用
- **并行一眼看清**：桌面应用专门用来并行跑多个 Codex 线程，左侧是项目侧栏，中间是线程，右侧是 review pane。〔一手·经搜索摘要，官方页对本环境返回 403〕[developers.openai.com/codex/app](https://developers.openai.com/codex/app)；按项目拆线程，切换时不丢上下文。〔二手〕[techinformed](https://techinformed.com/openai-ships-codex-macos-app-as-ai-coding-shifts-toward-parallel-agents/)
- **一步处理**：在线程里直接看 diff，可以在 diff 上评论，也能一键在编辑器里打开。〔二手〕[IT Brief](https://itbrief.co.nz/story/openai-unveils-codex-macos-app-for-multi-agent-coding)；7 月版本加入 diff 内联编辑和 PR 审查侧栏。〔二手〕[heyuan110](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/)
- **后台事务**：Automations 定时在后台跑，结果进入 review queue。〔二手〕[techinformed](https://techinformed.com/openai-ships-codex-macos-app-as-ai-coding-shifts-toward-parallel-agents/)、[danielvaughan](https://codex.danielvaughan.com/2026/04/08/codex-desktop-automations/)
- **隔离**：每个线程默认用一个 worktree；handoff 可以把线程在 worktree 和本地 checkout 之间来回挪。〔二手〕[zenn](https://zenn.dev/adverdest/articles/git_worktree_codex_claude_code)
- **审批（CLI）**：选项为"Yes, proceed (y)"，以及"don't ask again for commands that start with X (p)"；有用户抱怨后者范围太宽，会生成持久规则。〔一手·issue〕[openai/codex#22181](https://github.com/openai/codex/issues/22181)；还有 bug 报告称"不再询问"没有被持久化，导致反复弹窗。〔一手·issue〕[#14936 镜像](https://upd.dev/openai/codex/issues/14936)
- **被骂的地方**：CLI 审批太频繁，被吐槽"连呼吸都要申请权限"。〔二手〕[dev.to](https://dev.to/frr149/codex-cli-asks-for-permission-to-breathe-and-gets-fixed-with-two-flags-23o9)
- **对灵鲸的启示**："总是允许"的范围必须写清楚，而且要能撤销；"不再询问"一旦失效，最伤信任。

### Claude Code 桌面版（Code 标签）
- **并行**：每个会话独立拥有历史、项目目录和改动，侧栏里可以并行跑多个；在 Git 仓库里，每个会话自动隔离到自己的 worktree。〔一手·经搜索摘要〕[code.claude.com/docs/en/desktop](https://code.claude.com/docs/en/desktop)
- **权限**：有模式选择器，会话中途也能切换自主程度；Claude 第一次在外部站点上操作时，会弹出权限卡，选项是 Allow once、Always allow、Deny，"总是允许"可以在设置里撤销，每个站点（包括子域名）都要单独批准。〔一手·经搜索摘要〕同上
- **命令审批文案**：Yes；Yes, and don't ask again for [command]；No, and tell Claude what to do differently (esc)。选"不再询问"后，规则写入 `.claude/settings.local.json`。〔一手〕[permissions 文档](https://code.claude.com/docs/en/permissions)、[issue #819](https://github.com/anthropics/claude-code/issues/819)
- **被骂的地方**：规则已经保存，却仍然反复弹窗。〔一手·issue〕[#819](https://github.com/anthropics/claude-code/issues/819)、[#2560](https://github.com/anthropics/claude-code/issues/2560)

### Cursor（2.0 的 Agents 侧栏，3.x 的 Agents Window）
- **并行**：2.0 的侧栏显示每个 agent 是运行中、已完成还是在等待，每个条目带任务描述、状态和当前 diff，像切浏览器标签页一样在 agent 之间切换。〔二手〕[inkeep](https://inkeep.com/blog/from-developer-to-delegator-inside-cursor-2)、[medium 指南](https://medium.com/towards-data-engineering/parallel-ai-agents-in-cursor-2-0-a-practical-guide-e808f89cffb9)；可以对每个 agent 分别接受、拒绝或继续迭代。〔二手〕[techzine](https://www.techzine.eu/news/devops/135916/cursor-2-0-introduces-parallel-agents-and-new-model/)
- **3.0（2026-04-02）**：Agents Window 能同时跑本地、worktree、云端和 SSH 上的多个 agent，并且可以和 IDE 同时开着；Design Mode 的快捷键为 ⌘⇧D 开关、⇧ 加拖拽框选区域、⌘L 把元素加进对话、⌥ 加点击把元素加进输入框；内容溢出时出现"滚到底部"按钮。〔一手〕[cursor.com/changelog/3-0](https://cursor.com/changelog/3-0)
- **本地交给云端**：在本地起一个会话，交给云端 VM，合上电脑，回来时 PR 已经做完。〔二手〕[dev.to](https://dev.to/onepizzateam/cursor-3-shipped-parallel-agents-and-the-community-cant-agree-on-whether-thats-good-1p3n)
- **被骂的地方**：HN 评论原话："I wish they'd keep the old philosophy of letting the developer drive and the agent assist." 和 "I still want to code, not vibe my way through tickets." 〔二手转引〕同上
- **启示**：Design Mode 的"框选界面元素，再告诉 agent 改这里"，可以用在灵鲸"审设计"这件活上。

### Devin
- **时间线**：Progress 标签把 shell、IDE 和浏览器整合成一个视图，每条命令都关联到对应的进度更新。〔一手〕[docs.devin.ai session tools](https://docs.devin.ai/work-with-devin/devin-session-tools)；点击较早的命令即可回到当时的状态，时间线后面的命令显示为灰色。〔二手〕[fast.io](https://fast.io/resources/devin-session-tools-guide/)
- **Diff**：Global Work Diff 能查看到任一时间点为止的全部改动，也能看单个文件的编辑历史。〔一手〕[cognition June '24](https://www.cognition.ai/blog/june-24-product-update)；会话内的 PR 审查侧栏已重新设计，分区可以折叠。〔一手〕[release notes 2026](https://docs.devin.ai/release-notes/2026)
- **"Use Devin's Machine"**：用 VS Code 直接进入 agent 的机器。〔一手〕[session tools](https://docs.devin.ai/work-with-devin/devin-session-tools)

### Manus
- **Manus's Computer 面板**：实时展示每个访问的网站和每个动作，结束后可以逐步回放；评测把它称作"建立信任的透明工具"。〔二手〕[The Neuron](https://www.theneuron.ai/tools/manus/)、[aiuxplayground 拆解](https://aiuxplayground.com/teardowns/manus/composer)
- 本次没有找到可靠的侧栏和任务列表描述，没有写入清单。

### Genspark
- **Super Agent**：为每个子任务挑选模型和工具，产出完整的交付物（Sparkpage、幻灯片、表格），而不是一段聊天回复；2026 年新增语音模式，可以说完话让任务在后台跑；还有在云电脑上运行、能通过聊天软件派活的"Claw"。〔二手〕[fast.io](https://fast.io/resources/genspark-ai-review-2026/)、[eesel](https://www.eesel.ai/blog/genspark-ai-review)
- **被骂的地方**：视频生成消耗积分太快，高峰期响应慢。〔二手〕[eesel](https://www.eesel.ai/blog/genspark-ai-review)
- **启示**："活"的结果应该是一个可以打开的产出物页面，而不是一段文字。

### Grok Bot（xAI，2026-08-11 发布 beta）
- **以角色为中心**：侧栏列出所有 Bot，每个都有名字和 job，对话围绕 Bot 展开，而不是围绕一个个孤立的任务；主 Bot 带小星标。〔二手〕[flaviocopes 深度指南](https://flaviocopes.com/grok-bot/)（作者 2026-10-29 核对过官方文档）
- **电脑**：宣传说"每个 bot 一台云电脑"，但官方文档说同一账号下的所有 Bot 共用一台持久云电脑，每个 Bot 各有自己的屏幕，并且明确写着"Do not use separate Bots as a security boundary"。〔二手转引官方〕[openreplay](https://blog.openreplay.com/grok-bot-xai-agent-problem/)、[flaviocopes](https://flaviocopes.com/grok-bot/)
- **看与接管**：在对话里打开 Agent Computer，可以看到点击、输入、导航和当前状态；关掉 App 不影响云端继续干活；遇到密码、两步验证或验证码时，由主人接管，完成后交还。〔二手转引 docs.x.ai〕同上
- **审批**：Auto Review 检查 Bot 的每一步动作，大多数直接放行；需要确认时弹出审批卡，可以 Allow once、deny 或设为 always-allow；新流程建议先用 Allow once。付款审批卡会列出商户、商品和总价，并发一张一次性卡。〔二手〕[flaviocopes](https://flaviocopes.com/grok-bot/)
- **克制的打扰**：遇到已退出登录的 App 时弹 Reconnect 卡，最多一天一次；routine 发出的邮件会先存成草稿，等主人按 Send。〔二手〕同上
- **被骂的地方**：用量很快见底，套餐名称让人困惑。〔二手〕同上

### ChatGPT Pulse
- 每天早上推送一组卡片，通常 5 到 10 张，不做无限滚动；没保存的卡片当天消失；可以点赞、点踩、要求某个主题、划掉不相关的卡；能展开深挖、要求下一步，或者存起来。〔一手〕[openai.com 介绍](https://openai.com/blog/introducing-chatgpt-pulse)、〔二手〕[smartscope](https://smartscope.blog/en/generative-ai/chatgpt/chatgpt-pulse/)
- **启示**："她自己的事"和她"没人找时过的日子"可以按 Pulse 的方式，做成每天一小叠卡片。

### Linear
- **键盘**：⌘K 可以执行任何动作，也可以输入名字跳转到任何页面；G+I 进收件箱，G+M 进"我的事项"；按 ? 或 ⌘/ 看完整快捷键表。〔一手〕[Linear 指南](https://linear.app/enablement/guide/navigating-linear)；搜索没有结果时提供"新建一个叫 … 的条目"作为出口。〔二手〕[shadcn 示例](https://www.shadcn.io/command-examples)
- **乐观更新**：写操作先在本地生效，再在后台分发，接受少数写入可能失败。〔二手·联合创始人播客转述〕[podbean](https://podbean.com/site/EpisodeDownload/DIR16037D8B5IBW6?page=5)；读操作直接走本地副本，不等网络。〔二手〕[performance.dev](https://performance.dev/what-makes-linear-feel-instant)
- **视觉**：2024 年改版的目标是减少视觉噪音、保持对齐、加强导航层级和信息密度。〔一手〕[how we redesigned the Linear UI](https://linear.app/blog/how-we-redesigned-the-linear-ui)；2026-03 的刷新调暗了导航侧栏，让信息更好扫读。〔一手〕[changelog 2026-03-12](https://linear.app/changelog/2026-03-12-ui-refresh)
- **玻璃材质（移动端）**：底层是高斯模糊，上面叠一层细渐变，再用 SDF 法线做实时高光，混合模式为 Plus Lighter；被触碰的元素会轻微抬起；滚动区边缘做可变模糊；开启"增强对比度"时画实线轮廓；有意不做折射，理由是"refraction can make dense professional interfaces harder to read"。〔一手〕[linear-liquid-glass](https://linear.app/blog/linear-liquid-glass)

### Raycast
- ⌘K 打开当前选中项的全部动作，↵ 执行第一个主动作，表单里用 ⌘↵ 提交，Esc 返回；面板顶部是"Search for actions…"搜索框，模糊匹配后结果平铺显示；每个动作右侧标出快捷键，引导用户逐渐改用快捷键；可以在面板里直接录制热键。〔一手〕[manual.raycast.com/action-panel](https://manual.raycast.com/action-panel)
- 官方建议优先使用通用快捷键，保持一致。〔一手〕[developers.raycast.com keyboard](https://developers.raycast.com/api-reference/keyboard)

### Arc
- 侧栏按上下文组织，而不是按打开时间；每个 Space 有自己的侧栏、固定标签、主题色，可以有独立的登录态；在侧栏里双指横滑或按快捷键切换 Space。〔二手〕[podfeet](https://www.podfeet.com/blog/?p=27912)、[desirabilitylab](https://desirabilitylab.com/backfill/backfill-2024-159-arc-browser-tab-management)
- **动效示意值**（第三方复刻代码，不是 Arc 官方数值）：侧栏 240px 与 48px 之间切换，`width 0.2s ease-out`；折叠状态下悬停展开，文字 `opacity 0.15s ease-in 0.1s`；Space 切换用 `.spring(response: 0.3, dampingFraction: 0.7)`；命令栏位于 `top:20%`，宽度为 `min(600px,90vw)`，输入框字号 18px，快捷键标签用 12px 等宽字体。〔二手〕[blakecrosley Arc 设计拆解](https://blakecrosley.com/guides/design/arc)
- Verge 的评价是"浏览器的未来看起来很像 Arc"；Arc 现已进入维护期。〔二手〕[Verge 评测转存](https://natannikolic.notion.site/Arc-web-browser-review-a-new-way-of-using-the-internet-The-Verge-b5cbd872480d401491e14534ac714fc8)、[dev.to](https://dev.to/pickuma/arc-browser-review-18-months-with-a-browser-that-thinks-differently-26o1)

### Things 3
- 2017 年获 Apple 设计奖；Magic Plus 按钮可以点按，也可以拖到列表的任意位置插入待办；评测反复夸它的动画，作者说会"为了看动画而拖着玩"；也有人觉得"It's been done"。〔二手〕[MacRumors](https://www.macrumors.com/2017/05/18/things-3-task-manager-for-mac-ios-and-apple-watch/)、[AppAdvice](https://appadvice.com/post/things-3-from-cultured-code/747542)、[Medium](https://medium.com/@TGL/the-aphrodite-of-productivity-5bd9e030c275)

### Apple HIG（动效与材质）
- **Motion**：有目的地加动效，不要为了动而动；不能只靠动效传达信息，要给替代方式；反馈动画要简短精确；高频交互一般不加动效；允许打断动效，不让人等动画播完。〔一手〕[HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- **Materials**：Liquid Glass 构成浮在内容之上的"功能层"，用于控件和导航，例如侧栏；不要用在内容层，要克制使用；只在背景丰富时用 clear 变体；按语义而不是按颜色选材质；材质上的文字用 vibrant 颜色；厚材质对比更好，薄材质能让人保留对背景的感知。〔一手〕[HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- vibrancy 只开在视图层级的叶子节点上。〔一手〕[NSVisualEffectView](https://developer.apple.com/documentation/appkit/nsvisualeffectview)

### 结构总览与流程可视化（Railway、n8n、Rive）
- **Railway**：项目画布是默认视图，把所有服务及其依赖画成一张图，点击服务就地查看配置。〔一手〕[docs.railway.com/projects](https://docs.railway.com/projects.md)；官网的说法是让整个技术栈"一眼看懂"，并且能在画布上直接改设置。〔一手·官网镜像〕[railway.com](https://hn.jakechampion.name/reader/https://railway.com)；团队探索过服务的拖拽和分组。〔一手〕[changelog 2023-10-13](https://railway.com/changelog/2023-10-13-railway-hacks-2023)
- **n8n**：执行视图里，成功的节点打绿勾，已执行的节点之间连线变绿；2.3.6 版本这些连线消失后，有用户专门发帖反馈，可见这类"流向反馈"被用户在乎。〔一手·官方社区〕[community.n8n.io](https://community.n8n.io/t/green-arrows-between-executes-nodes-not-showing-v2-3-6/252550)
- **Rive**：状态机由"状态"和"转场连线"组成，连线上带方向箭头的椭圆标记，满足条件才触发；状态静止后状态机不再推进，不浪费帧。〔一手〕[rive.app transitions](https://rive.app/docs/editor/state-machine/transitions)
- **启示**：四层总览可以用"节点加有方向的连线"来表达；只有发生流动时才播动画，静止时停下，这既丝滑又不吵。

---

## 五、没查到或存疑的地方
- Codex app 侧栏的具体状态标识（未读点、角标）：官方页面打不开，本文没有写。
- Linear 和 Things 的具体动效毫秒数：没有官方数字，清单里的 100 到 150ms 是建议值。
- Manus 的任务列表和侧栏、Vercel 画布：没有找到可靠描述。
