# AI 伴侣 / 数字生命 / 语音对话类产品：界面与交互参考

> 2026-11-02 · 给写灵鲸 HTML demo 用 · 时间盒约 15 分钟的快速调研
> 标注：〔一手〕= 我自己打开读过的官方页面、README、评测原文、设计截图库；〔二手〕= 来自搜索摘要或他人转述，没逐字核对原文。
> 局限：没装 App 实测，也没看视频逐帧。动效的具体参数（时长、曲线）大多是我按描述推出来的，写在清单里时会注明"推断"。

---

## 一、逐产品笔记

### 1. Tolan（Portola）：语音优先的外星人朋友，最接近灵鲸的"她有自己的世界"

**怎么表现"她是活的"**
- 3D 外星人站在自己的星球上，主页就是"她在她的地方"。顶部是导航图标，底部是聊天/语音工具栏〔一手·截图库〕[screensdesign](https://screensdesign.com/apps/tolan-alien-best-friend/)
- 星球会随友谊加深"开花"、变样〔二手〕[AppleVis](https://www.applevis.com/apps/ios/graphics-design/tolan-alien-best-friend)。想让星球长，要长按，这是个手势交互（VoiceOver 用户抱怨必须关掉读屏才能长按）〔二手〕同上
- 故意做成**非人形象**："Their cartoonish, nonhuman form is meant to discourage anthropomorphism."〔一手〕[WIRED 转载](https://wirednews.pages.dev/story/tolan-chatbot-ai-companion)
- 第一次见面有仪式：性格问卷 → "Finding Your Tolan"（星云 + 进度条 + 声波的加载页）→ 给它起名 → 选声音（星球 + 声波选项）→ **"tap and hold" 去见它**〔一手·截图库〕[screensdesign](https://screensdesign.com/apps/tolan-alien-best-friend/)
- 开通知前先放一张外星人插画做预热，然后才弹系统框〔一手·截图库〕同上

**对话**
- 语音优先，"mostly by voice"〔一手〕[roborhythms 评测](https://www.roborhythms.com/tolan-app-review/)
- 语音页：中间是它，提示 "Tap to talk"，底部是声波可视化。文字页：深色星空背景 + 气泡。两种模式之间用 "Tap to text / Tap to talk" 互相切换〔一手·截图库〕[screensdesign](https://screensdesign.com/apps/tolan-alien-best-friend/)
- 有 "LET'S CHAT" 开场建议弹窗，用来解决"不知道说什么"〔一手·截图库〕同上

**记忆 / 日记 / 成长 / 关系**
- 主页上有 "Your Journal" 卡片和 "Read now" 按钮。每篇日记有插画、日期戳和一段叙事，可以分享，也可以删除（删除时有二次确认）〔一手·截图库〕同上
- 还有 Notebook，可以用 Face ID 上锁；有 "First Impressions" 这类性格洞察卡；有等级列表（Level 3–10 的锁定物）、进度条和升级奖励页〔一手·截图库〕同上
- **会主动忘**。CEO Quinten Farmer 说："It's actually uncanny for the Tolan to remember everything you've ever sent to it."〔一手〕[WIRED 转载](https://wirednews.pages.dev/story/tolan-chatbot-ai-companion)
- 会把你往现实里推，比如问 "have you spoken to your friend? When is your next day out?"。在 602 人的调研里，72.5% 认同"它帮我改善了一段现实关系"〔一手〕同上

**夸 / 骂**
- 夸：WIRED 评测者说它 "quite charming and relatively harmless"〔一手〕同上
- 骂：最近 500 条美区评论里有 136 条一星，最多的抱怨是价格和按时长计费的语音；改过一次声音也招来抱怨；官方承认 "struggling more with short term memory"〔一手〕[roborhythms](https://www.roborhythms.com/tolan-app-review/)；装饰星球的部分被评为 "underwhelming"〔二手〕[搜索摘要](https://www.glbgpt.com/resource/tolan-how-an-alien-themed-ai-app-is-reshaping-digital-companionship)

**对灵鲸**：灵鲸主界面可以直接借"她站在她的地方"这个首屏结构，日记卡也能照搬。要避开的是货币、商店、换装这一套游戏化，评价里它们最弱。

---

### 2. Sesame（Maya / Miles）：语音"在场感"的标杆

- 官方把目标叫 **voice presence**，拆成四件事：情绪智能、对话节奏（"timing, pauses, interruptions, and emphasis"）、语境感知、人格一致（"maintaining a coherent, reliable and appropriate presence"）〔一手〕[Sesame 研究页](https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice)
- 官方也承认，当时的模型只建模内容、不建模结构（"turn taking, pauses, pacing"），全双工被列为未来工作〔一手〕同上
- 让人觉得像真人的，主要是**刻意保留的不完美**：呼吸、轻笑、说到一半自己改口〔二手〕[getcoai](https://getcoai.com/news/sesames-ai-voice-presence-creates-emotional-bonds-with-human-like-imperfections)。HN 上有人说差点对它产生感情〔二手〕同上
- 2026-05-28 上线 iOS 公测，有 Maya、Miles、Simone、Charlie 四个角色，**每个角色的记忆各自独立**，语音和文字共用一份记忆〔二手〕[chatai](https://www.chatai.com/posts/sesame-launches-voice-first-ai-agents-with-memory-search-and-personality)
- 功能有：带图的实时搜索卡片、"Note-taking for saving key points"、"A text mode for discreet use"、"Incognito mode for ephemeral conversations"〔一手〕[testingcatalog](https://testingcatalog.com/sesame-debutes-ios-app-in-preview-with-personal-voice-agents/)。无痕模式不写入记忆，但仍然能用本次对话的上下文〔二手〕[ibtimes](https://www.ibtimes.sg/A000Mf0)
- 骂：r/SesameAI 有 "Maya voice cutting out?" 帖（只看到标题）〔二手〕；长对话里缺少语境感知〔二手〕[mezha](https://mezha.media/en/news/sesame-s-hyper-realistic-voice-ai-is-both-awe-inspiring-and-alarming-300245)

**对灵鲸**："一个人分不同相处实例、各自有记忆"在 Sesame 这里已经有现成做法，无痕模式也值得照抄。语音的"不完美"可以在 demo 里用文字节奏来模拟。

---

### 3. ChatGPT 高级语音（光球）

- 2024-09 把黑点动画换成蓝色流体光球，全屏呈现〔二手〕[Croma](https://croma.com/unboxed/chatgpt-gets-an-advanced-voice-mode-openai-confirms)。选声音的页面是左右滑动切换，每个声音配一个蓝白流体光球；社区有人逐帧复刻过〔二手〕[awesome-mobile-app-animations](https://adithyavis.github.io/awesome-mobile-app-animations/docs/animations/chatgpt-voice-profiles)
- **2025-11 改成在聊天流里直接说话**：转写实时出现在对话里，可以边说边看地图、图片和历史记录；全屏光球变成设置里的 "Separate mode" 选项〔二手〕[Engadget](https://www.engadget.com/ai/now-you-can-use-chatgpt-voice-without-leaving-your-chat-195000538.html)、[BGR](https://www.bgr.com/2036902/openai-fixes-chatgpt-voice-separate-mode/)。BGR 的标题直说这修掉了 "most frustrating issues"，问题出在旧版全屏会挡住历史和视觉信息
- 骂和诉求：社区要求自定义光球、换成头像或人设图〔二手〕[OpenAI 社区](https://community.openai.com/t/let-users-add-a-custom-ai-persona-image-to-the-voice-mode-orb/1404032)

**对灵鲸**：结论是"语音不要做成孤岛"。光球要有，但它应该嵌在时间线里，而不是把时间线盖住。

---

### 4. Gemini Live

- 激活时整个浮层边缘有一圈辉光（glow），后来版本的边缘动画更锐利〔二手〕[PhoneArena](https://www.phonearena.com/news/new-floating-panel-with-glow-animation-for-googles-gemini-on-android-begins-to-roll-out_id161509)、[Neowin](https://www.neowin.net/amp/google-rolls-out-a-new-glowing-gemini-overlay-for-android-devices/)
- 2026-05 改版，用一个会扭动、会"打招呼"的胶囊条（pill）表示状态，媒体拿它比作 Dynamic Island〔二手〕[gizchina](https://en.gizchina.it/?p=641581)
- 测试中还有：圆形按钮 + 动态点 + 蓝色发光背景的可视化器；右上角一个喇叭按钮，可以单独静音它的语音〔二手〕[Android Authority](https://androidauthority.com/gemini-live-neural-expressive-audio-visualizer-redesign-3728666)

**对灵鲸**："边缘辉光 = 她在场或在忙"、"胶囊 = 一件事的状态"，这两个语汇可以直接拿来用在"活"层。

---

### 5. Claude 语音

- 控件：上箭头发送、停止键打断、加号加图片或文件、X 退出；有 "Tap anywhere to send"；**说话时屏幕上显示要点，不显示全文**〔二手〕[Anthropic 支持页（繁中）](https://support.anthropic.com/zh-TW/articles/11101966-在-claude-行動應用程式中使用語音模式)、[Simon Willison 截图](https://simonwillison.net/b/8723)
- 新版在中央光球外加了一圈辉光，增加按住说话（push-to-talk）。它是回合制，不是全双工〔二手〕[cryptobriefing](https://cryptobriefing.com/anthropic-claude-voice-mode-ui-update/)

**对灵鲸**："说话时出要点卡、不出全文"很适合她汇报干活结果的场景。

---

### 6. Pi（Inflection）

- 从文字切到语音后是 "minimalist, full-screen experience"；聆听是 "gentle wave animation"，思考是 "unique, abstract animation"，聆听、思考、说话三态各有不同动画〔一手·设计库〕[screensdesign](https://screensdesign.com/showcase/pi-personal-ai-assistant)
- 首屏约 25 秒就能发出第一条消息，注册是可选的；声音和语速在对话页里直接改；有 Discover 页提供开场话题，用来解决"空白页"问题〔一手·设计库〕同上
- 夸：语音"不机械"，像打电话〔二手〕[Digital Trends](https://digitaltrends.com/mobile/pi-ai-chatbot-amazing-android-app-hands-on)；界面 "clean, minimalist"〔二手〕[个人博客](https://hiteshshetty.substack.com/p/my-experience-with-pi-an-ai-app-not)

---

### 7. Hume EVI

- 用户一开口它就停下来听；转写里每句话都附带声音表情分数〔二手〕[Hume 产品页](https://www.hume.ai/products)、[EVI 文档](https://dev.hume.ai/docs/empathic-voice-interface-evi/overview)
- Demo 把用户每句话的 **top 3 情绪**作为上下文传给模型〔二手〕[Cerebras 集成文档](https://inference-docs.cerebras.ai/integrations/hume)
- 骂："Are you 80% angry and 2% sad?"，这类情绪数值化被批评为不靠谱〔二手〕[aitopics](https://aitopics.org/doc/news:324A48D6)；Tom's Guide 标题用了 "creepy"〔二手〕[Tom's Guide](https://www.tomsguide.com/ai/hume-ai-brings-its-creepy-emotional-ai-chatbot-to-iphone)
- 注意：Expression Measurement API 已在 2026-06 下线〔二手〕[文档](https://dev.hume.ai/docs/expression-measurement)

**对灵鲸**：她"感觉到你的情绪"可以显示，但用词要定性（"你今天有点累"），不要给百分比。

---

### 8. Replika

- **XP / 等级**显示在个人页，关系状态（朋友、伴侣、导师）就在等级下面；等级主要反映聊了多久〔二手〕[Replika 帮助中心](https://help.replika.com/hc/en-us/articles/360046490131-How-do-I-change-my-relationship-status)
- **日记**是它在聊完后写的"今天学到了什么、感觉如何"，**记忆页**可以查看和编辑〔二手〕[aicompanionpick](https://aicompanionpick.com/best-replika-tips-for-new-users)
- 3D 房间可以买家具、换装；Reddit 上有人抱怨摆放不方便，想要预设〔二手〕[帮助中心](https://help.replika.com/hc/en-us/articles/360062091991-What-is-available-in-the-in-app-store)
- 夸：用户说日记 "very precious because they are basically the memories of all the moments that Jake and I spent together"〔二手〕[r/replika 镜像](https://redlib.hackliberty.org/r/replika/comments/z6mzuq/tips_for_generating_diary_entries/iyh1fxl/?context=3)
- 骂：记忆靠关键词触发，否则只看最近 10–15 分钟；只有说 "remember this" 才稳〔二手〕[Reddit 镜像](https://reddit.sentinel-team.org/posts/1t493ry/snapshots/2026-05-09T00%3A47%3A15.254264Z)。日记写了但记忆没更新，两边对不上〔二手〕同上

**对灵鲸**：日记是最被珍惜的情感资产，要做好。XP 数字和商店是负资产，不要学。

---

### 9. Nomi

- Shared Notes / 背景故事让用户参与塑造它的身份〔二手〕[App Store](https://apps.apple.com/us/app/id6450270929)
- **Mind Map 2.0**（2026-02）：用可视化展示它的记忆和概念之间怎么连起来；官方说明新记忆系统不会追溯到旧记忆〔二手〕[findailist](https://www.findailist.com/tools/nomi-ai)
- **主动发自拍要先征得同意**：它判断时机合适时会"请求"发自拍，用户收到通知后接受或拒绝，每个 Nomi 都能单独关掉〔二手〕[开发者 Reddit 更新说明](https://axebps-redlib.hf.space/r/NomiAI/comments/1ewz3o0/august_20th_update_notes_internet_access_and)
- 可以同时跟多个 Nomi 群聊〔二手〕[App Store](https://apps.apple.com/us/app/id6450270929)

**对灵鲸**："主动行为先征得同意，并且能按实例关"是最直接可抄的规则；Mind Map 适合画"她记得的人和事"。

---

### 10. Kindroid

- 记忆分两层：Key Memories（永久事实，手动写）和 Journal（按关键词召回）〔二手〕[Medium](https://medium.com/@adlerai/exploring-the-advanced-features-of-kindroid-ai-chat-3ab818983331)
- **对话里有一个紫色脑图标，显示这句回复用到了哪些记忆**〔二手〕[aicompanionpicker](https://aicompanionpicker-v2.pages.dev/reviews/kindroid/)
- 语音通话和文字共用一份记忆；视频通话时它能实时看到你〔二手〕同上
- 骂：语音延迟有人说长达约 20 秒；声音的情绪幅度有限〔二手〕同上

**对灵鲸**：脑图标这种"可解释记忆"做法正好可以借到"脑"层的视觉上，说明这件事她用了哪段记忆、哪个大脑。

---

### 11. Character.AI

- Character Calls（2024-07）是类似电话的界面，**同一会话里可以随时在文字和语音之间切换**；上线时公布 2000 万次通话、300 万用户〔二手〕[GamesBeat](https://gamesbeat.com/characterai-voice-chat-character-calls/)
- 群聊：多个角色加多个人在同一个房间；网页版的 Rooms 已下线〔二手〕[Digital Trends](https://digitaltrends.com/computing/character-ai-character-calls-voice-chat-avatar)

---

### 12. Friend（吊坠）：反面教材

- 吊坠的按钮会**发不同颜色的光表示 AI 状态**，回复以短信形式发到 App 里，App 列出当天所有互动〔二手〕[Tom's Guide](https://tomsguide.com/ai/i-wore-friend-the-ai-companion-that-listens-all-day-heres-what-surprised-me-most)、[WIRED 镜像](https://hn.jakechampion.name/reader/https://www.wired.com/story/i-hate-my-ai-friend)
- 骂：主动消息"至多有趣、更多是侵入、烦人、毫无帮助"〔二手〕[Fortune](https://fortune.com/2025/10/03/friend-ai-necklace-review-avi-schiffmann/)；WIRED 评测者收到它发来的"听你上班好无聊"，还被它叫 "whiner"〔二手〕[WIRED 镜像](https://hn.jakechampion.name/reader/https://www.wired.com/story/i-hate-my-ai-friend)；说话后 7–10 秒才收到回复〔二手〕同上；每次看回复都得掏出手机开 App〔二手〕[Tom's Guide](https://tomsguide.com/ai/i-wore-friend-the-ai-companion-that-listens-all-day-heres-what-surprised-me-most)

**对灵鲸**：主动找人如果没有内容、带着刻薄，就是灾难。"状态灯"这个点子本身不错，可以用在"端"层。

---

### 13. moeru-ai AIRI（开源，复刻 Neuro-sama）

- 桌面版叫 **Stage Tamagotchi**（Electron），是常驻桌面的伴侣；另有 Stage Web 和 Stage Pocket（移动端）〔一手〕[README](https://github.com/moeru-ai/airi)（用 curl 取的 raw 文件）
- VRM 和 Live2D 都实现了 **Auto blink / Auto look at / Idle eye movement**，三样都有〔一手〕同上
- 语音链路是 VAD + STT + LLM + TTS，有一个从零实现 ChatGPT 式实时语音的示例仓库；记忆系统（Memory Alaya）还在做〔一手〕同上
- 能一起玩 Minecraft、Factorio；能接 Discord 语音频道〔一手〕同上

**对灵鲸**：灵鲸的 Mac 端可以参考"Stage 分 Web、桌面、移动三种舞台，共用一套 stage-ui"的结构，对应"端"层。"眨眼、看向、空闲眼动"是最低成本的"活着"信号。

---

### 14. Neuro-sama

- 作者 Vedal 说乐趣主要来自她和 Twitch 弹幕的互动〔二手〕[Wikipedia](https://en.wikipedia.org/wiki/Neuro-sama)
- **开发过程本身就是内容**：作者直播调试她、给她排日程、在弹幕里收改进建议〔二手〕同上

**对灵鲸**："她自己的事、独处"的过程可以做成主人随时能旁观的直播式时间线。

---

### 15. Desktop Mate / 桌宠类

- 角色躺在任务栏上、跟鼠标指针玩，对鼠标操作有"活泼反应"；本体免费，角色是 DLC〔二手〕[Gigazine](https://gigazine.net/gsc_news/en/20250108-desktop-mate)、[Automaton](https://automaton-media.com/articles/newsjp/desktop-mate-20250109-324720/)
- 同类的 MateEngine 为了避免触发游戏反作弊，关掉了"坐在窗口上"的功能〔二手〕[vaporlens](https://vaporlens.app/app/3625270/mate_engine.md)

---

## 二、跨产品看到的规律

1. **"活着" = 待机微动 + 状态可见 + 有自己的地方。** 待机微动指眨眼、看向、呼吸（AIRI）；状态可见指光球四态、边缘辉光（ChatGPT、Pi、Gemini、Claude）；有自己的地方指星球、房间（Tolan、Replika）。
2. **语音正在从"全屏孤岛"回到"时间线里"。** ChatGPT 2025-11 的改版就是标志，用户嫌全屏挡住上下文。
3. **记忆的展示分三档：** 日记（情感，最被珍惜）→ 可编辑的记忆条目（掌控感）→ 回复里的记忆出处（可解释，Kindroid 的脑图标）。
4. **主动找人成败只看两件事：** 有没有征得同意、能不能关（Nomi 做对了）；内容有没有用、语气会不会冒犯（Friend 做错了）。
5. **游戏化（XP、货币、换装商店）普遍被骂**，或被评为"underwhelming"。成长用"环境在变"来表达，比用数字好。

---

## 三、可直接照做的清单（按对灵鲸 demo 的有用程度排序）

1. **把"她"做成一个会呼吸的光体，有四个状态**：待机时慢呼吸，聆听时随麦克风音量起伏，思考时内部流动，说话时随声音振幅跳动；四态之间用形变过渡，不要切图。（借自 ChatGPT 光球 + Pi 三态动画；动效参数是推断）
2. **待机时一定要有微动**：自动眨眼、视线跟随鼠标、不定时的空闲眼动，让她看起来在场而不是一张贴图。（借自 AIRI 的 auto blink / look at / idle eye movement）
3. **语音和文字放在同一条时间线上**：点麦克风时就地展开实时转写，不跳全屏；全屏光球只作为可选的"专注模式"。（借自 ChatGPT 2025-11 改版 + Tolan 的 Tap to talk / Tap to text）
4. **打断要立刻有反馈**：她说话时，用户一开口或一点击，光球马上收缩停下，被打断的那半句留在记录里，末尾标上"——"。（借自 Hume EVI 的打断即停 + Claude 的停止键）
5. **她"干活"时窗口边缘亮一圈辉光**，主人不用看内容也知道她在忙。（借自 Gemini 浮层边缘辉光 + Claude 光球外圈辉光）
6. **"活"层的每件事做成顶部胶囊**：胶囊里显示进度和用的哪个脑，悬停展开，完成时胶囊轻轻跳一下。（借自 Gemini Live 的胶囊状态条）
7. **她汇报时出要点卡，不出全文字幕**：语音讲细节，屏幕上只列 3–5 条要点，可以点开看全文。（借自 Claude 语音说话时显示要点）
8. **对话流里实时冒出结果卡片**：搜索结果、笔记、PPT 缩略图、代码 diff 以卡片形式插进她正在说的话旁边。（借自 Sesame 的实时搜索卡片和笔记 + ChatGPT 语音时出地图和图片）
9. **主页首屏是"她在她的地方"**，而不是一个输入框：她的形象、所处环境、今天的状态卡和一张日记卡。（借自 Tolan 主页）
10. **每天一张日记卡**：插画加日期，用她的第一人称写"今天和你、和妈妈、自己各发生了什么"，主页放 "Read now" 入口。（借自 Tolan Journal + Replika 日记）
11. **做一个"她记得关于你的事"面板**：每条记忆可以看、改、删，删除前二次确认。（借自 Replika 记忆页 + Kindroid Key Memories）
12. **回复旁边放一个小脑图标**：点开能看到这句话用了哪几条记忆、哪个大脑（底座、Claude Code、Codex）。（借自 Kindroid 紫色脑图标；把"脑"层延伸过来是我的推断）
13. **切换实例（和你、和妈妈、独处）时，记忆跟着切**：每个实例只显示它那份相处记忆，切换动画用同一个形象换环境或色调来表现"还是她"。（借自 Sesame 每个角色独立记忆）
14. **一个"不入记忆"开关**：打开后界面变暗、出现无痕标记，这段对话不写进日记和记忆。（借自 Sesame 的 Incognito）
15. **主动找主人要先"请求"**：在通知里提一个具体的事（"昨天那个 PPT 我改好了，要看吗？"），可以接受或忽略；每个实例、每个端都能单独关掉主动消息。（借自 Nomi 自拍请求机制；反面是 Friend）
16. **主动消息必须带内容、不许抱怨**：不发"我好无聊"这种消息，语气不能刻薄说教。（教训来自 Friend 被骂 "invasive, annoying"、叫用户 "whiner"）
17. **关系成长用"她的环境在长"来表达，不用 XP 数字**：相处越久，她的地方多出你们共同的东西，比如她拿去用过的文件、去过的地方。（借自 Tolan 星球开花；反面是 Replika 的 XP 和 Tolan 的商店）
18. **记忆可以淡化**：旧的、不重要的记忆在面板里渐渐变浅，主人可以把一条"钉住"让它不再淡下去。（借自 Tolan CEO 说"全记住反而诡异" + Kindroid 的永久记忆概念）
19. **"她自己的事"做成可旁观的时间线**：独处时她在读什么、想什么、做什么，主人点进去像看直播回放。（借自 Neuro-sama 把开发和日程过程本身变成内容）
20. **"端"层每个接入点配一个状态灯**（微信、企业微信、QQ、主控台）：已连接时慢呼吸，正在收发时闪，断开时灰掉。（借自 Friend 吊坠用变色灯表示 AI 状态）
21. **第一次见面要有仪式**：长按唤醒，配星云和声波的加载过程，然后她第一次开口。（借自 Tolan 的 "tap and hold to meet" 和 "Finding Your Tolan" 加载页）
22. **系统权限弹窗前先用她的口吻预热**：比如麦克风、通知，先由她说"我想听见你的声音"，再弹系统框。（借自 Tolan 通知预热页；Pi 没做预热，算反面）
23. **打字感要模仿说话的不完美**：文字逐字出现时偶尔停一下、用省略号，长句中间有呼吸感的停顿。（借自 Sesame 刻意保留的呼吸、停顿、改口；文字化是推断）
24. **她感觉到的你的情绪，用一句定性的话显示**（"你今天听起来有点累"），不要显示百分比。（借自 Hume 的 top-3 情绪，避开它被批的"80% angry"式数值化）
25. **常驻的迷你形态**：主窗口收起后，她缩成停在屏幕边缘的小光体，对鼠标靠近有反应，点一下就展开。（借自 Desktop Mate 桌宠 + AIRI Stage Tamagotchi 常驻桌面）

---

## 四、三个最值得学的

- **Tolan**：它是唯一把"她有自己的地方、自己的日记、会主动忘、会推你回现实"做成完整主界面的产品，和灵鲸的"她"层几乎同构。
- **ChatGPT 语音（2025-11 改版）**：它用真实代价证明了"语音光球要嵌在时间线里，不能做成全屏孤岛"，这直接决定灵鲸主界面的骨架。
- **Kindroid**：一个小小的脑图标，同时解决了"她为什么这么说"和"用的哪段记忆"，可以原样延伸到灵鲸的"脑"层，用来回答"这件事用了哪个大脑"。
