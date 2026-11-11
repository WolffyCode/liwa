/** 提供方表注入契约；D′ 由 brains 的登记快照供应，B′ 没有实现。 */
import type { PaseoLogger } from '@liwa/brain-shared'
import type {
  AgentClient, AgentCreateConfigUnattendedInput, AgentMode, AgentSessionConfig,
  FetchCatalogOptions, ProviderCatalog, ProviderRefreshContext,
  ResolveAgentCreateConfigInput, ResolveAgentCreateConfigResult,
} from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import type { ToolPolicy } from '@liwa/brain-shared/paseo/protocol/agent-types'
import type { AgentProviderRuntimeSettingsMap, ProviderOverride } from '@liwa/brain-shared/paseo/agent/provider-launch-config'

/** 目录缓存实际消费的提供方定义；不持有具体提供方工厂。 */
export interface ProviderDefinition {
  /** 提供方标识。 */
  id: string
  /** 展示名。 */
  label: string
  /** 提供方说明。 */
  description: string
  /** 模式目录。 */
  modes?: AgentMode[]
  /** 默认模式。 */
  defaultModeId?: string | null
  /** 可选图标。 */
  iconSvg?: string
  /** 登记是否启用。 */
  enabled: boolean
  /** 配置快照只用于比较是否变化。 */
  configuration: unknown
  /** 派生提供方的来源。 */
  derivedFromProviderId: string | null
  /** 是否支持精确 MCP 预批准。 */
  supportsExactMcpPreapproval: boolean
  /**
   * 应用所属提供方的工具策略。
   * @param config - 会话配置。
   * @param toolPolicy - 受准入约束的策略。
   * @returns 加工后的配置。
   */
  applyToolPolicy(config: AgentSessionConfig, toolPolicy: ToolPolicy | undefined): AgentSessionConfig
  /**
   * 创建本定义的客户端。
   * @param logger - 目录日志器。
   * @returns 客户端。
   */
  createClient(logger: PaseoLogger): AgentClient
  /**
   * 解析创建配置。
   * @param input - 创建请求。
   * @returns 解析结果。
   */
  resolveCreateConfig(input: ResolveAgentCreateConfigInput): ResolveAgentCreateConfigResult
  /**
   * 判断创建配置的自主运行模式。
   * @param input - 创建配置。
   * @returns 是否自主运行。
   */
  isCreateConfigUnattended(input: AgentCreateConfigUnattendedInput): boolean
  /**
   * 读取提供方目录。
   * @param options - 目录读取范围。
   * @param client - 已有客户端。
   * @param context - 刷新期限与取消上下文。
   * @returns 模型与模式目录。
   */
  fetchCatalog(options: FetchCatalogOptions, client?: AgentClient, context?: ProviderRefreshContext): Promise<ProviderCatalog>
}

/** B′ 仅声明提供方表来源，D′ 装配时必须传入真实实现。 */
export interface ProviderTableSource {
  /**
   * 根据当前登记与覆盖表产生目录定义。
   * @param request - 日志与配置快照。
   * @returns 提供方定义表。
   */
  build(request: {
    logger: PaseoLogger
    runtimeSettings: AgentProviderRuntimeSettingsMap | undefined
    providerOverrides: Record<string, ProviderOverride> | undefined
  }): Record<string, ProviderDefinition>
  /**
   * 释放本来源创建的客户端。
   * @param clients - 已拥有的客户端。
   * @param logger - 关停日志器。
   * @returns 资源释放完成。
   */
  shutdown(clients: ReadonlySet<AgentClient>, logger: PaseoLogger): Promise<void>
}
