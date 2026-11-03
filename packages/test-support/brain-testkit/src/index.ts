/**
 * 大脑提供方的测试工具：回放脚本驱动的假提供方、直接测试提供方的宿主与事件记录器。契约测试在
 * `@liwa/brain-testkit/contract`（依赖 vitest），登记假提供方的 cordis 插件在 `@liwa/brain-testkit/plugin`。
 * @module @liwa/brain-testkit
 */

export {
  SCRIPTED_META, SCRIPTED_PERMISSION_OPTIONS, ScriptedBrainProvider, demoScript, inputText,
  type DemoScenario, type ScriptSelector, type ScriptStep, type ScriptedProviderOptions, type ScriptedTurn,
} from './scripted-provider.ts'
export {
  createBrainTestHost, isTurnTerminal, recordEvents, sampleSessionConfig, textInput,
  type BrainTestHost, type EventRecorder, type RecordingLaunchContext,
} from './harness.ts'
