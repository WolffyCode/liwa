// 来源：paseo-upstream@8018231a packages/server/src/server/agent/agent-configuration-validator.ts；Apache-2.0，灵鲸改见 NOTICE。
import type { ProviderOptions } from "@liwa/brain-shared/paseo/protocol/agent-types";
import type { HubExecutionAgentValidationIssue } from "@liwa/brain-shared/paseo/protocol/messages";

import type { ProviderSnapshotEntry } from "@liwa/brain-shared/paseo/agent/agent-sdk-types";
import { filterSelectableAgentModels } from "@liwa/brain-shared/paseo/agent/agent-sdk-types";

export interface AgentConfigurationValidationInput {
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  providerOptions?: ProviderOptions;
}

interface AgentConfigurationValidationContext {
  input: AgentConfigurationValidationInput;
  provider: ProviderSnapshotEntry;
}

export function validateAgentConfigurationAgainstProvider({
  input,
  provider,
}: AgentConfigurationValidationContext): HubExecutionAgentValidationIssue[] {
  const issues: HubExecutionAgentValidationIssue[] = [];
  const models = filterSelectableAgentModels(provider.models);
  const requestedModel = input.model;
  const selectedModel = requestedModel
    ? models.find((model) => model.id === requestedModel || model.aliases?.includes(requestedModel))
    : (models.find((model) => model.isDefault) ?? models[0]);

  if (requestedModel && !selectedModel) {
    issues.push({
      path: ["model"],
      message: `Model '${requestedModel}' is not available for provider '${input.provider}'`,
    });
  }
  if (input.modeId && !provider.modes?.some((mode) => mode.id === input.modeId)) {
    issues.push({
      path: ["modeId"],
      message: `Mode '${input.modeId}' is not available for provider '${input.provider}'`,
    });
  }
  if (
    input.thinkingOptionId &&
    !selectedModel?.thinkingOptions?.some((option) => option.id === input.thinkingOptionId)
  ) {
    issues.push({
      path: ["thinkingOptionId"],
      message: `Thinking option '${input.thinkingOptionId}' is not available for provider '${input.provider}'`,
    });
  }

  return issues;
}
