/**
 * 灵鲸各大脑提供方共用的库。包根导出灵鲸自己写的部分（严格类型检查）：Paseo 会话到契约会话的通用映射、
 * 回合输入的翻译、pino 形状的日志器；迁来的 Paseo 模块按上游形状的子路径取用，
 * `@liwa/brain-shared/paseo/<路径>`（例如 `@liwa/brain-shared/paseo/agent/agent-sdk-types`），它们按上游的
 * 编译选项单独成一个项目。来源与每处原地改动记在本包的 `NOTICE`。进程帮助归 `@liwa/brain`。
 * @module @liwa/brain-shared
 */

export { paseoLogger, type PaseoLogger, type PaseoLogMethod } from './logger.ts'
export {
  ALLOW_OPTION_ID, CANCEL_OPTION_ID, DENY_OPTION_ID, PaseoBrainSession, classifyFailure, mapPaseoToolDetail, mapPaseoUsage,
  paseoQuestions, structuredAnswers, toJsonValue,
  type PaseoBrainSessionInit, type TurnTerminal,
} from './session.ts'
export { LIWA_BLOCK_TAG, renderLiwaBlock, toPaseoPrompt, turnInputText } from './turn-input.ts'
