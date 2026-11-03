/**
 * 灵鲸各大脑提供方共用的库。包根导出灵鲸自己写的那部分：迁来的 Paseo 代码通往 subprocess seam 的桥；
 * 迁来的 Paseo 模块按上游形状的子路径取用，`@liwa/brain-shared/paseo/<路径>`（例如
 * `@liwa/brain-shared/paseo/agent/agent-sdk-types`）。来源与每处原地改动记在本包的 `NOTICE`。
 * @module @liwa/brain-shared
 */

export {
  execProviderCommand,
  findProviderExecutable,
  ProviderCommandError,
  spawnProviderProcess,
} from './process.ts'
export type { ProviderCommandOptions, ProviderCommandResult, ProviderProcessHost } from './process.ts'
