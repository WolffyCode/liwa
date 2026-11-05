// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/kimi-acp-agent.ts；原地改动见包内 NOTICE。
// 灵鲸改：上游的 pino 日志器换成接在 cordis logger 上的同形接口。
import type { PaseoLogger as Logger } from "@liwa/brain-shared";

import type { AgentModelDefinition } from "@liwa/brain-shared/paseo/agent/agent-sdk-types";
import type { ProviderProcessHost } from "@liwa/brain";
import { methods } from "@agentclientprotocol/sdk";
import {
  type ACPCatalogModelResolverContext,
  deriveSelectorOptions,
  findSelectConfigOption,
} from "./acp-agent.ts";
import { toDiagnosticErrorMessage } from "@liwa/brain-shared/paseo/agent/providers/diagnostic-utils";
import { GenericACPAgentClient } from "./generic-acp-agent.ts";

interface KimiACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  /** 灵鲸改：探测与诊断拉进程用的入口。 */
  processHost: ProviderProcessHost;
}

// Kimi exposes thinking options only for the selected model. Keep its model-switching
// discovery here: other providers can supply a read-only catalog instead.
export async function resolveKimiCatalogModels({
  connection,
  sessionId,
  models,
  configOptions,
  runRequest,
  transformConfigOptions,
  logger,
  provider,
}: ACPCatalogModelResolverContext): Promise<AgentModelDefinition[]> {
  if (models.length <= 1) {
    return models;
  }
  const modelOption = findSelectConfigOption({ configOptions, category: "model" });
  if (!modelOption) {
    return models;
  }

  const resolved: AgentModelDefinition[] = [];
  for (const model of models) {
    try {
      const response = await runRequest(() =>
        // 灵鲸改：SDK 1.4 经 ClientContext.request 调方法。
        connection.request(methods.agent.session.setConfigOption, {
          sessionId,
          configId: modelOption.id,
          value: model.id,
        }),
      );
      const modelConfigOptions = transformConfigOptions(response.configOptions ?? []);
      const thinkingOptions = deriveSelectorOptions(modelConfigOptions, "thought_level");
      resolved.push({
        ...model,
        thinkingOptions: thinkingOptions.length > 0 ? thinkingOptions : undefined,
        defaultThinkingOptionId:
          thinkingOptions.find((option) => option.isDefault)?.id ?? undefined,
      });
    } catch (error) {
      const errorMessage = toDiagnosticErrorMessage(error);
      if (model.isDefault) {
        logger.warn(
          { modelId: model.id, error: errorMessage },
          `${provider} catalog probe could not refresh thinking options for current model "${model.id}"; keeping session options`,
        );
        resolved.push(model);
        continue;
      }
      logger.warn(
        { modelId: model.id, error: errorMessage },
        `${provider} catalog probe could not resolve thinking options for model "${model.id}"; omitting thinking options`,
      );
      resolved.push({
        ...model,
        thinkingOptions: undefined,
        defaultThinkingOptionId: undefined,
      });
    }
  }
  return resolved;
}

export class KimiACPAgentClient extends GenericACPAgentClient {
  constructor(options: KimiACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      catalogModelResolver: resolveKimiCatalogModels,
      processHost: options.processHost,
    });
  }
}
