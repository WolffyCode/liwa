/** 工具目录来源注入契约；F′ 由实时登记表供应，B′ 没有默认目录。 */
import type { PaseoToolDefinition, PaseoToolExecutionContext, PaseoToolResult } from '@liwa/brain-shared/paseo/agent/tools/types'

/** MCP 端点只消费目录与执行能力，不依赖具体工具贡献包。 */
export interface ToolCatalogSource {
  /**
   * 获取此次端点可登记的工具。
   * @returns 工具定义。
   */
  toolsFor(): Iterable<PaseoToolDefinition>
  /**
   * 执行一次目录调用。
   * @param name - 工具名。
   * @param input - 待校验输入。
   * @param context - 调用取消上下文。
   * @returns 工具结果。
   */
  executeTool(name: string, input: unknown, context?: PaseoToolExecutionContext): Promise<PaseoToolResult>
}
