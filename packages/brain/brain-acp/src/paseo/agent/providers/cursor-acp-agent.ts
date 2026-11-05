// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/cursor-acp-agent.ts；原地改动见包内 NOTICE。
// 灵鲸改：SDK 1.4 的 exports 不再放出生成的 zod 模块（dist/schema/zod.gen.js），这里按类型做最小校验。
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
// 灵鲸改：上游的 pino 日志器换成接在 cordis logger 上的同形接口。
import type { PaseoLogger as Logger } from "@liwa/brain-shared";
import { z } from "zod";

import type { AgentModelDefinition } from "@liwa/brain-shared/paseo/agent/agent-sdk-types";
import type { ProviderProcessHost } from "@liwa/brain";
import {
  deriveSelectorOptions,
  type ACPCatalogModelResolverContext,
  type ACPConfigFeatureOption,
} from "./acp-agent.ts";
import { GenericACPAgentClient } from "./generic-acp-agent.ts";

interface CursorACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  /** 灵鲸改：探测与诊断拉进程用的入口。 */
  processHost: ProviderProcessHost;
}

const CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS = 10_000;
const CURSOR_CLIENT_CAPABILITY_META = {
  parameterizedModelPicker: true,
};

export const CURSOR_FAST_FEATURE_OPTION: ACPConfigFeatureOption = {
  id: "fast",
  configId: "fast",
  label: "Fast",
  description: "Cursor fast mode",
  tooltip: "Select Cursor fast mode",
  icon: "zap",
};

const zSessionConfigOption = z.custom<SessionConfigOption>(
  (value) => typeof value === "object" && value !== null && "id" in value && "type" in value,
);

const CursorModelCatalogSchema = z.object({
  models: z.array(
    z.object({
      value: z.string().min(1),
      name: z.string(),
      configOptions: z.array(zSessionConfigOption),
    }),
  ),
});

// Cursor model switches persist CLI preferences, even in a throwaway probe session.
// Its extension returns each model's parameter definitions without selecting it.
export async function resolveCursorCatalogModels({
  connection,
  models,
  provider,
  runRequest,
}: ACPCatalogModelResolverContext): Promise<AgentModelDefinition[]> {
  const catalog = await runRequest(() => fetchCursorModelCatalog(connection));
  const currentModelId = models.find((model) => model.isDefault)?.id;

  return catalog.models.map((model) => {
    const thinkingOptions = deriveSelectorOptions(model.configOptions, "thought_level");
    const defaultThinkingOptionId = thinkingOptions.find((option) => option.isDefault)?.id;
    return {
      provider,
      id: model.value,
      label: model.name,
      isDefault: model.value === currentModelId,
      thinkingOptions: thinkingOptions.length > 0 ? thinkingOptions : undefined,
      defaultThinkingOptionId,
    };
  });
}

async function fetchCursorModelCatalog(connection: ACPCatalogModelResolverContext["connection"]) {
  try {
    // 灵鲸改：SDK 1.4 的扩展方法也走 ClientContext.request。
    const response = await connection.request("cursor/list_available_models", {});
    return CursorModelCatalogSchema.parse(response);
  } catch (error) {
    const extensionUnavailable =
      typeof error === "object" && error !== null && "code" in error && error.code === -32601;
    if (extensionUnavailable) {
      throw new Error(
        "Update Cursor CLI: this version does not support cursor/list_available_models.",
        { cause: error },
      );
    }
    throw error;
  }
}

export class CursorACPAgentClient extends GenericACPAgentClient {
  constructor(options: CursorACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      usageProvider: "cursor",
      // cursor-agent publishes slash commands asynchronously via available_commands_update.
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS,
      clientCapabilityMeta: CURSOR_CLIENT_CAPABILITY_META,
      configFeatureOptions: [CURSOR_FAST_FEATURE_OPTION],
      catalogModelResolver: resolveCursorCatalogModels,
      processHost: options.processHost,
    });
  }
}
