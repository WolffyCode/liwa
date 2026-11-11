/** 配置注入契约；不加载个人配置或创建配置存储，G′／H′ 接 Cordis Config。 */
import type { ProviderOverride } from '@liwa/brain-shared/paseo/agent/provider-launch-config'

/** 搬入代码消费的只读配置快照子集。 */
export interface MutableDaemonConfig {
  /** 提供方覆盖表。 */
  readonly providers: Record<string, ProviderOverride>
  /** 启动时是否恢复。 */
  readonly resumeOnStartup?: boolean
  /** 继续提示词。 */
  readonly resumePrompt?: string
}

/** 配置变更来源；实现由宿主提供，订阅返回精确释放函数。 */
export interface DaemonConfigStore {
  /**
   * 读取当前配置。
   * @returns 配置快照。
   */
  get(): MutableDaemonConfig
  /**
   * 在配置提交前准备可撤销变更。
   * @param listener - 返回回滚操作的准备监听器。
   * @returns 撤销监听。
   */
  onApply(listener: (
    config: MutableDaemonConfig,
    previous: MutableDaemonConfig,
    details: { removedProviders: readonly string[] },
  ) => () => void): () => void
  /**
   * 监听配置提交。
   * @param listener - 提交监听器。
   * @returns 撤销监听。
   */
  onChange(listener: () => void): () => void
}
