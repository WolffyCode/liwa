# 调研：能力插件（听、说、看、画）与实时语音

日期：2026-10-28。由调研子任务产出（该子任务又分出 4 个研究员并行），结果完整，但调研任务在收尾阶段被叫停，可能有少量补充没有回来。所有结论都没有经过实测。

标注：〔一〕读过官方文档、源码或论文原文；〔二〕搜索摘要或第三方文章；〔推〕调研者推断。价格查询日期均为 2026-10-28。

## 结论摘要

- **说**：第一版同时接百炼 Qwen-Audio-3.x 和豆包语音合成 2.0，主人试听后再定主次；MiniMax 2.8 第三。
- **听**：qwen3-asr-flash（文字 + 7 类情绪）为主，加本地 SenseVoice（sherpa-onnx-node，可在 Node 里直接跑）补笑、哭等声音事件。这是对"第一版全部线上"的一个例外，**需要主人点头**。
- **看**：qwen3.5-flash，难图换 qwen3-vl-plus；备选 GLM-4.6V-Flash（免费，无服务保障）。
- **画**（第二版）：Seedream 5.0 flash/pro，备选 wan2.7-image-pro。
- **接口**：语音合成从第一天起就按"会话 + 分块输出 + 每块对应文字区间"设计，以后升级到实时通话不用推翻。

## 1. 来源

| 领域 | 来源 | 读了什么 |
| --- | --- | --- |
| 本地参考 | Helm `packages/server/src/server/` 下 `speech/speech-provider.ts`、`turn-detection-provider.ts`、`speech-runtime.ts`、`agent/tts-manager.ts`、`stt-manager.ts`、`session/voice/voice-turn-controller.ts`、`voice-session.ts`、`speech/providers/local/sherpa/*`、`dictation/` | 〔一〕接口全文；断句、打断、静音检测参数、置信度过滤 |
| sherpa-onnx | `k2-fsa/sherpa-onnx` 的 `c-api.h` 与 README；Helm 依赖中的 `sherpa-onnx-node` 1.12.28 `types.js` | 〔一〕识别结果含 `lang/emotion/event`；有声音事件模块和带参考音频的合成 |
| MiniMax | platform.minimax.cn 语音合成 HTTP/WebSocket 文档、复刻指南、定价页（页内最新日期 2026-08-20）；2.6、2.8 发布稿 | 〔一〕 |
| 阿里云百炼 | help.aliyun.com/zh/model-studio 下 tts-model、non-realtime-tts-user-guide、realtime-tts-user-guide、voice-replica-1、qwen-omni-voice-cloning、asr-model、qwen3-asr-flash、vision、model-pricing | 〔一〕 |
| 火山引擎 | 语音合成计费 6561/1359370（2026-09-29）、双向流式 V3 6561/1329505、语音指令与标签 6561/1871062、复刻 6561/1167802、录音识别 6561/1354868、端到端实时语音 6561/1594356（2026-09-28） | 〔一〕 |
| ElevenLabs | models、pricing/api、快速复刻、audio tags 文档 | 〔一〕；国内访问〔二〕 |
| Fish Audio | docs.fish.audio（只拿到摘要）；fishaudio/fish-speech README 与 LICENSE | 服务〔二〕；许可证〔一〕 |
| 开源 TTS | index-tts/index-tts（README、LICENSE、`infer_v2.py`）、arXiv 2506.21619 / 2601.03888；FunAudioLLM/CosyVoice、arXiv 2505.17589；RVC-Boss/GPT-SoVITS；Blaizzy/mlx-audio | 〔一〕 |
| ASR | FunAudioLLM/SenseVoice README、arXiv 2407.04051 | 〔一〕 |
| 看图与表情包 | 智谱定价页；szkele1145/feiyu-qqbot（`vision/pipeline.py`、`vision/sticker.py`、`media/library.py`）；MaiBot（`emoji_manager.py`、`send_emoji.py`）；astrbot_plugin_meme_manager | 〔一〕 |
| 画图 | 火山方舟价格页（2026-05-27）；百炼 wan2-7-image-pro、qwen-image-edit-api；BFL 角色一致性指南；filipstrand/mflux；InstantID / PhotoMaker / PuLID | 〔一〕；OpenAI、Gemini、可灵价格〔二〕 |
| 实时通话 | LiveKit turns 与 turn-detector；pipecat 服务列表、interruptions、metrics；Open-LLM-VTuber `live2d_model.py`、`conversation_handler.py`；Smart Turn v3、TEN Turn Detection | 〔一〕为主，后两者〔二〕 |

## 2. 对比

### 线上语音合成（元/万字符）

| 服务 | 情绪控制 | 句内切换 | 复刻 | 流式/延迟 | 价格 | 国内 |
| --- | --- | --- | --- | --- | --- | --- |
| 百炼 Qwen-Audio-3.0/3.1（2026-07-20 上线） | `instruction` 自然语言指令 + 23 个控制标签（如 `[excited]`、`[tired]`）+ 7 个非语言标签（如 `[giggles]`）；复刻音色也能用指令〔一〕 | 能，标签持续到下一个标签〔一〕 | 推荐 10–20 秒，最长 60 秒；中文页写免费、英文页写 $0.01/次，矛盾；复刻绑定 `target_model`〔一〕 | SSE；实时版 WebSocket；首包未公布 | 3.0-plus 约 $0.193（约 1.4 元）；3.1 计费口径各页矛盾〔一，待核实〕 | 直连 |
| 百炼 CosyVoice-v3.5 | 指令 ≤100 字符 + SSML | 不能 | 同上 | WebSocket | plus 1.5，flash 0.8〔一〕 | 直连 |
| 豆包语音合成 2.0 / 复刻 ICL 2.0 | `context_texts` 传语音指令或对话上文，不计费；`section_id` 让服务端记住多轮上下文；表现力版有 `<cot text=…>` 句内标签〔一〕 | 能（单句内） | 文件 ≤10MB；后付费 138 元/音色；连续 7 天无正式调用会被删；标准版过滤指令；表现力版官方承认"效果抽卡"〔一〕 | 双向 WebSocket | 3 元（资源包 2.1–2.8）〔一〕 | 直连 |
| MiniMax speech-2.8 | 默认按文本自动判断，或 9 个情绪值选一；19 个语气词如 `(laughs)`、`(sighs)`；停顿 `<#0.5#>`〔一〕 | 不能，一次请求一种情绪；不能传角色当下状态 | 10 秒–5 分钟，9.9 元/个；7 天未用会删〔一/二〕 | SSE、WebSocket；2.6 宣称端到端 <250ms | hd 3.5，turbo 2〔一〕 | 直连 |
| ElevenLabs v4/v3 | `[whispers]`、`[laughs]` 标签〔一〕 | 能 | ≥10 秒，推荐 1–2 分钟，需声明有权克隆〔一〕 | v4 Turbo 中位约 100ms，v3 约 280ms〔一〕 | v3/v4 约 $0.8，v4 Turbo 约 $0.4〔一〕 | 需代理与海外支付〔二〕 |
| Fish Audio S2.1 | 自由描述标签如 `[whispers sweetly]`〔二〕 | 能 | 10–30 秒〔二〕 | 约 70ms〔二〕 | $15/百万 UTF-8 字节，约 $0.45〔二〕 | 未确认 |

中文效果第三方评价〔二〕：SuperCLUE 2026-04（转载未核实）Doubao-Seed-TTS 2.0 第一，MiniMax、阿里进前五；Artificial Analysis 复刻音色榜（多语言综合）Qwen-Audio-3.1-Plus 1182 分高于 ElevenLabs v4 的 1161 分。

### 开源语音合成与 M4 可行性

| 模型 | 情绪控制 | 复刻 | 流式 | 许可证 | M4 |
| --- | --- | --- | --- | --- | --- |
| IndexTTS-2.5（2026-08）/ 2 | 音色与情绪解耦：参考音频 + `emo_alpha`，或 8 维向量 `[happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]`，或 `emo_text`〔一〕 | 一段即可 | 按句段；4090 实时率 0.21–0.33〔一〕 | 可商用；月活超 1 亿或年营收超 10 亿元需另授权〔一〕 | 仅 PyTorch MPS 且强制 fp32；速度说法矛盾 |
| Fun-CosyVoice3-0.5B | `<\|endofprompt\|>` 前写指令；`[breath]`、`[laughter]`、`<strong>`；训练情绪指令只有开心、伤心、生气〔一〕 | ≤10 秒 | 双向流式，宣称最低 150ms | Apache-2.0〔二〕 | 仅 MPS，无实测 |
| GPT-SoVITS V5 | 只能换参考音频 | 5 秒 | 有 | MIT | M4 CPU 实时率 0.526〔一〕 |
| Qwen3-TTS / VoxCPM2 / Ming-3.0-tts | 指令或自然语言 | 短样本 | 有 | 多为 Apache | mlx-audio 原生支持〔一〕；Qwen3-TTS 复刻与情绪指令分属两个模型〔二〕 |
| Fish S2-Pro / Drama 3 | 内联标签 | 10–30 秒 | 有 | S2-Pro 不可商用；Drama 3 年营收 <50 万美元可商用〔一〕 | 4bit 约 18–20GB，24GB 放不下其他模型〔推〕 |

### 带情绪的语音识别

| 方案 | 情绪 / 事件 | 形态 | 价格 | 国内 | 本地 |
| --- | --- | --- | --- | --- | --- |
| 百炼 qwen3-asr-flash | 每条结果带 `emotion`（7 类）；无事件〔一〕 | 同步，单条 ≤5 分钟 | 0.00022 元/秒，约 0.79 元/小时〔一〕 | 能用 | — |
| SenseVoice-Small | 情绪 7 类（HAPPY/SAD/ANGRY/NEUTRAL/FEARFUL/DISGUSTED/SURPRISED）；事件 8 类（BGM/Speech/Applause/Laughter/Cry/Sneeze/Breath/Cough）；每段一个标签〔一〕 | "比 Whisper-Small 快 5 倍以上" | 免费，权重可商用需署名〔一〕 | ModelScope | sherpa-onnx-node 可在 Node 直接跑，结果含 `emotion/event`〔一〕 |
| 豆包录音文件识别 | `enable_emotion_detection` 5 类情绪 + 性别、语速、音量；无事件〔一〕 | 异步 | 约 2.3 元/小时〔二〕 | 能用 | — |
| Qwen3.8-Omni-Flash | 让音频大模型用 JSON 描述情绪，标签自定义需校验〔一〕 | — | 约 $0.15/$0.47 每百万 token〔二〕 | 能用 | — |
| 百炼 sensevoice-v1 | — | — | 即将下线〔二〕 | 不要用 | — |
| Whisper / gpt-4o-transcribe | 无情绪〔二〕 | — | — | 不能直连 | mlx-whisper、whisper.cpp 可跑 |

### 看图（元/百万 token，输入/输出）

| 模型 | 价格 | 备注 |
| --- | --- | --- |
| 智谱 GLM-4.6V-Flash、GLM-4.1V-Thinking-Flash | 免费〔一〕 | 未写限速，无服务保障 |
| 百炼 qwen3.5-flash | 0.2 / 2〔一〕 | 示例图约 1247 token，约 0.0007 元/张 |
| 百炼 qwen3-vl-plus | 1 / 10〔一〕 | 难图、密集文字截图 |
| 豆包 seed-1.6-flash（视觉） | 0.15 / 1.5〔二〕 | — |
| 本地 Ollama qwen3-vl:8b（6.1GB）、qwen3.5:9b（6.6GB） | 免费 | 24GB 内存可跑，约 13 token/秒（估算）〔二〕 |

开源 QQ 机器人的做法〔一〕：feiyu-qqbot 把 OCR 文字、像素统计、人脸数拼成"文字画像"交给大脑；表情包用 dHash 与 aHash 两种 64 位指纹比对，相似度 ≥0.88 算认出。MaiBot 以图片 sha256 缓存描述；视觉模型一次给最多 5 个情绪或场景标签；挑图用标签编辑距离，或把候选拼成网格图让视觉模型选序号。

### 画图与角色一致性（第二版）

| 服务 | 参考图 | 价格（元/张） | 国内 |
| --- | --- | --- | --- |
| Seedream 5.0 flash / pro（火山方舟） | 最多 10 张，提示词用"图1、图2"指代〔二〕 | flash 0.12；pro 0.30–0.60，第 2 张参考图起每张 +0.02〔一〕 | 直连 |
| 百炼 wan2.7-image-pro | 最多 9 张，强调主体一致性〔一〕 | 0.5〔一〕 | 直连 |
| 百炼 qwen-image-2.0 | 1–3 张〔一〕 | 0.2–0.5〔一〕 | 直连 |
| FLUX.2、gpt-image-2、Nano Banana Pro | 10–14 张〔二〕 | 约 $0.03–0.24〔二〕 | 不能直连或需海外支付 |
| 本地 FLUX.2 klein 4B（mflux） | 多参考图，可训角色 LoRA〔一〕 | 免费；M4 Pro 4 步 20–27 秒，基础款 M4 估计慢 1.5–2 倍 | — |

InstantID、PuLID 依赖真人人脸识别模型 InsightFace〔一〕，对二次元角色基本无效〔推〕。

### 实时语音框架（后期）

| 框架 | 判停 | 打断 | 打断后历史 |
| --- | --- | --- | --- |
| Helm / Paseo | 只用 Silero 静音检测：说话 800ms 确认开口，静音 1000ms 算说完〔一〕 | 一检测到开口立刻中止播放与生成〔一〕 | 客户端回报"播放完成"〔一〕 |
| LiveKit Agents | 音频判停模型支持中文，有本地 CPU 小模型；文本判停模型（Qwen2.5-0.5B）已弃用；`min_delay` 0.5 秒、`max_delay` 3 秒〔一〕 | 自适应模式区分"嗯嗯"附和与真打断；`false_interruption_timeout`〔一〕 | 只保留用户实际听到的部分〔一〕 |
| pipecat | Smart Turn v3：8MB，支持中文，CPU 12–60ms〔二〕 | `InterruptionFrame`，各环节丢弃手头工作〔一〕 | 文字随播放进度，未播出的不进历史〔一〕；已集成 MiniMax、Fish，未集成阿里、豆包〔一〕 |
| Open-LLM-VTuber | — | 客户端回传 `heard_response`〔一〕 | 存已听部分 + "[Interrupted by user]"；`[joy]` 这类标签只驱动 Live2D 表情，合成前剥掉〔一〕 |
| 豆包端到端实时语音 | 服务端判停 | `ASRInfo` 通知停播；`ConversationTruncate` 截断历史〔一〕 | O2.0、SC2.0 支持复刻音色（`saturn_` 开头）；`ChatTTSText` 念外部文字，`ChatRAGText` 注入外部内容〔一〕 |
| 百炼 qwen3.5-omni-realtime | — | — | `qwen-voice-enrollment` 复刻，10–20 秒样本，0.01 元/个〔一〕 |

## 3. 设计建议

### 能力插件接口草案

```ts
// 所有能力共用
interface CapabilityCall {
  callId: string;
  memberId: string;        // 用量和操作日志按数字生命归属
  signal: AbortSignal;     // 打断、一键暂停、花钱总闸熔断统一走这一个取消信号
}
type UsageUnit = "characters" | "utf8Bytes" | "audioSeconds" | "inputTokens" | "outputTokens" | "images" | "voiceEnrollments";
interface UsageReport {
  providerId: string; model: string;
  items: { unit: UsageUnit; quantity: number }[];  // 保留原始计量单位，换算成人民币只在花钱模块做
  latencyMs: number; firstChunkMs?: number;
}
interface CapabilityProvider {
  providerId: string;
  location: "online" | "local";
  readiness(): { isReady: boolean; reasonCode: string; isRetryable: boolean };  // 借鉴 Helm 的 SpeechReadinessState
  estimateUsage(request: unknown): UsageReport["items"];                         // 调用前给花钱总闸预审
}

// 说
// 这 7 个标签同时是 SenseVoice、qwen3-asr 的输出和 MiniMax、IndexTTS 的输入，听和说共用一份情绪词表
type EmotionLabel = "neutral" | "happy" | "sad" | "angry" | "fearful" | "disgusted" | "surprised";
interface ExpressionIntent {
  emotion: EmotionLabel;
  intensity: number;     // 0–1，默认上限 0.6，防止每句都演过头（IndexTTS README 建议 emo_alpha ≤0.6）
  styleNote?: string;    // 标签表达不了的细节，如"刚睡醒、小声、带点撒娇"
  nonverbal?: { atChar: number; kind: "laugh" | "sigh" | "breath" | "giggle" }[];
}
interface SpeechLine { text: string; expression: ExpressionIntent }
interface VoiceBinding { providerId: string; targetModel: string; voiceId: string; lastUsedAt: string }

interface SpeakProvider extends CapabilityProvider {
  // 复刻或续期：各家复刻绑定具体模型且会过期，原始录音必须由本体保存
  bindVoice(profile: VoiceProfile, call: CapabilityCall): Promise<VoiceBinding>;
  openSynthesis(params: { call: CapabilityCall; voice: VoiceBinding; format: AudioFormat; priorDialogue?: string[] }): SynthesisSession;
}
interface SynthesisSession {          // 第一版语音消息也走会话，第五版直接复用
  pushLine(line: SpeechLine): void;   // 实时通话时再加 pushTextDelta
  finishInput(): void;
  chunks(): AsyncIterable<{ audio: Uint8Array; lineIndex: number; charRange: [number, number]; durationMs: number }>;
  cancel(): void;                     // 可重复调用；要关掉 WebSocket，否则继续计费
  usage(): Promise<UsageReport>;
}

// 听
type SoundEventKind = "laughter" | "crying" | "cough" | "sneeze" | "breath" | "applause" | "music";
interface HeardSegment {
  text: string; startMs: number; endMs: number;
  emotion?: { label: EmotionLabel; confidence?: number; sourceProviderId: string };
  soundEvents: { kind: SoundEventKind; sourceProviderId: string }[];
}
interface HearProvider extends CapabilityProvider {
  transcribe(audio: AudioInput, call: CapabilityCall): Promise<{ segments: HeardSegment[]; language?: string; usage: UsageReport }>;
  openStream?(params: StreamParams): RecognitionStream;  // 沿用 Helm 的 StreamingTranscriptionSession 形状，每段加情绪与事件
}

// 看
interface ImageReading {
  imageSha256: string; perceptualHash: string;
  kind: "photo" | "sticker" | "screenshot" | "document" | "other";
  caption: string; ocrText: string; moodTags: string[];
}
interface SeeProvider extends CapabilityProvider {
  // 带 question 即"再看一眼"：大脑可针对同一张图追问，不必把所有细节塞进第一次描述
  read(image: ImageInput, call: CapabilityCall, question?: string): Promise<{ reading: ImageReading; usage: UsageReport }>;
}
```

回退规则：

- 每种能力配一条有序的 provider 链；只有可重试的失败（网络、限流、5xx、超时）才换下一家，内容被拒、鉴权失败、音色丢失不回退。
- 说话不在一条消息中途换家（换家等于换声音）。整条消息改走备选家的前提是备选家已用同一段录音预先复刻；不满足就用她的口吻退回文字，例如"嗓子有点哑，先打字给你"。"整条换家还是退文字"**需要主人决定**。

缓存：说以"文本 + 情绪 + 音色 + 模型"哈希为键，适合"早安"这类高频短句；看用 sha256 精确命中 + 图片指纹近似命中；听不缓存。

### 当下状态 → 情绪参数 → 语音合成

1. 人格模块持有当下状态（心情、强度、精力，随时间衰减），向主意识上下文注入一句话，例如"有点困，刚被夸了很开心"。
2. 主意识要发语音时调用 `send_voice` 工具，按句传 `lines[{text, emotion, intensity, styleNote}]`。不让大脑在正文里写各家私有标签：走工具参数能校验格式，不用剥标签，不污染文字渠道〔推〕。
3. 说话模块的表情规划器：未写情绪的句子继承上一句或心情底色；把心情底色并入 `styleNote`（精力低就"语速稍慢、声音轻"）；强度封顶，相邻句平滑过渡。
4. 每家一个翻译器，私有语法只出现在这里：Qwen-Audio 用 `instruction` + 句内 `[laughing]`；豆包用 `context_texts`（当下状态 + 指令）+ `section_id` + `<cot>`；MiniMax 映射到最近情绪值 + `(laughs)`；IndexTTS 转 `emo_vector` 或 `emo_text`。
5. 原文、情绪意图、实际下发参数、用量写进操作日志，便于回放和调效果。
6. 识别到的对方情绪作为弱信号进入关系记忆和当下状态，标明来源和置信度，避免她每句都追问"你是不是不高兴"。

### 为实时通话预留

1. 语音合成从第一天起就是"会话 + 分块输出 + 每块对应文字区间"；客户端回报播放进度，对话历史只记用户实际听到的部分（pipecat、LiveKit、Open-LLM-VTuber、豆包 `ConversationTruncate`、Helm `confirmAudioPlayed` 都这么做〔一〕）。
2. 取消必须真正停止计费（关 WebSocket）。
3. "检测到有人说话"和"判断说完了"分成两个 provider；保留 Helm 的 `TurnDetectionSession` 并增加"说完的概率"；判停候选 Smart Turn v3 或 LiveKit 本地小模型（TEN Turn Detection 是 7B，太大）。
4. 打断策略单独成对象：最短说话时长、最少字数、附和词白名单（嗯、对、哈哈）。Helm 目前一开口就中止，"嗯嗯"也会打断。
5. 大脑快通道〔推，需实测〕：通话每一轮不太可能等 CLI 外壳启动并跑完工具循环；可能需要一条"直接流式调用模型接口，带人设、当下状态和记忆快照"的快通道，干活仍走 CLI。**这与"所有大脑都走 CLI"的已定决策冲突，到第五版再议。**
6. 端到端路线作为同一"通话"接口后的另一种实现：豆包实时语音 SC2.0/O2.0 或百炼 qwen3.5-omni-realtime（都支持复刻音色）。代价是回答的是厂商模型，与"灵魂归本体"冲突；豆包 `ChatTTSText`、`ChatRAGText` 可注入本体内容作折中。

### 第一版线上服务

| 能力 | 首选 | 备选 | 理由 |
| --- | --- | --- | --- |
| 说 | 百炼 Qwen-Audio-3.x（plus） | 豆包 TTS 2.0 / ICL 2.0 表现力版；第三 MiniMax 2.8 | Qwen-Audio：复刻音色也能用指令和句内标签，复刻便宜，一个账号覆盖听和看，实时模型也能用复刻音色。豆包：唯一能免费传入当下状态和对话上文，第三方中文榜第一，但"抽卡"、138 元/音色、7 天不用会删。MiniMax：稳定、pipecat 已集成，但不能传当下状态、不能句内切换情绪。两家都接，试听后定主次 |
| 听 | qwen3-asr-flash + 本地 SenseVoice（sherpa-onnx-node）补声音事件 | 豆包录音识别；全线上时用 Qwen-Omni-Flash 描述笑和哭 | 线上没有一家返回笑、哭等声音事件；SenseVoice 不需要 Python。**是"第一版全线上"的例外，需主人点头** |
| 看 | qwen3.5-flash，难图换 qwen3-vl-plus | GLM-4.6V-Flash（免费） | 免费模型无服务保障；同一账号方便统一计费 |
| 画（第二版） | Seedream 5.0 flash / pro | wan2.7-image-pro | 国内直连、参考图最多、单价最低 |
| 表情包 | 本地图库 + 标签 | — | 视觉模型给每张打描述和 ≤5 个标签；挑图由便宜到贵：按分类随机 → 语义检索 → 拼网格图让视觉模型选 |

### 本地方案后续路线

前提：大脑在线上，24GB 只需容纳语音和视觉模型〔推〕；重型模型用 Helm 式独立工作进程隔离。顺序：① SenseVoice（第一版即可）；② Ollama qwen3-vl:8b 处理隐私图片；③ IndexTTS-2.5（Python 进程跑 MPS，先测速度）；④ 实时语音优先测 mlx-audio 的 Ming-3.0-tts-0.5B 与 VoxCPM2，CosyVoice3 在 MPS 上测首包作对照；⑤ FLUX.2 klein 4B + 角色 LoRA。

## 4. 坑与反例

1. 复刻音色不是永久的：绑定厂商和模型；MiniMax、豆包 7 天不用会删，百炼一年不用会删。本体保存原始录音，定期保活或用时重新复刻；换家需重新复刻，声音会有差别。
2. 各家情绪语法不兼容：MiniMax `(laughs)`，Qwen 与 ElevenLabs `[laughing]`，Fish 旧版 `(happy)`、新版方括号。大脑直接写私有标签，换家就失效。
3. MiniMax 一次请求一种情绪，句内切换只能拆请求，衔接处易断。
4. 豆包 `emotion`/`emotion_scale` 只对部分 1.0 多情感音色有效，复刻音色用不上；复刻标准版过滤指令。
5. 百炼产品线变动快：旧 Qwen3-TTS 不支持复刻；CosyVoice 指令限 100 字符；sensevoice-v1 即将下线；paraformer 建议迁移。
6. 识别出的情绪很粗（7 类、一段一个标签、多为中性），只能当弱信号。
7. Helm 代码直接搬的问题〔一〕：`tts-manager.ts` 只按英文标点断句，中文整段不切，超 260 字任意位置硬切；整段音频攒齐再发，不能逐块流式；`stt-manager.ts` 默认语言 `"en"`，并清空低置信度结果——只有笑声或哭声的语音消息会被丢掉；听写提示词要求"非语音返回空"；附和词表只有英文；本地模型（Parakeet、Kokoro-en）不支持中文。
8. Markdown、代码、链接不能直接念：发语音前转口语；回复含代码或链接时改发文字。
9. 二次元角色不要用人脸 ID 方法；连续在上一张图上改会越改越偏，每次从"定妆照"出发（BFL 官方也只演示了连续 3 次编辑）。
10. 许可与合规：Fish S2-Pro 不可商用；Fish 免费档数据可能被用于训练；gpt-image 大陆不可用；ElevenLabs 要声明有权克隆；国内深度合成规定对声音复刻的授权要求需与厂商确认〔推〕。
11. 计量单位五花八门（字符、UTF-8 字节、秒、token、张、复刻次数）：花钱总闸保留原始单位再统一换算。

## 5. 待实测

1. **试听对比（最重要）**：同一段 15–30 秒录音在 Qwen-Audio-3.1-plus、豆包 ICL 2.0 表现力版、MiniMax 2.8-hd 各复刻一次；约 20 句覆盖开心、撒娇、困、委屈、生气、安慰、小声，每句跑 10 遍；看像不像她、情绪是否自然或演过头、豆包是否"抽卡"。
2. 百炼复刻绑定模型后，非实时与实时模型能否共用音色 ID；Qwen-Audio 3.1 计费口径；复刻是否收费。
3. 各家 WebSocket 在国内的首包时长；MiniMax `task_continue` 中途能否换情绪。
4. qwen3-asr-flash 情绪准确率；SenseVoice 对中文笑声召回率；sherpa-onnx 版 SenseVoice 在 M4 的速度与内存。
5. GLM-4.6V-Flash 与 qwen3.5-flash 在中文截图 OCR、表情包梗理解上的对比；免费档限速。
6. M4 上：IndexTTS-2.5、CosyVoice3 走 MPS 的实时率；Ming-3.0-tts、VoxCPM2 走 MLX 的首包。
7. Seedream 用立绘生成 20 个场景能否保持同一张脸；二次元角色识别模型 CCIP 阈值（模型卡建议约 0.213，需用自己的图重新标定）。
8. Claude Code 外壳 + DeepSeek 的首 token 延迟，决定实时通话是否需要快通道。
9. 豆包端到端实时语音 3.0（2026-06 邀测）是否支持复刻音色；`ChatTTSText` 混合用法体验。
