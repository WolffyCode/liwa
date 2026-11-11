// 来源：paseo-upstream@8018231a packages/server/src/server/agent/permission-response.ts；Apache-2.0，灵鲸改见 NOTICE。
import type { PaseoLogger as Logger } from "@liwa/brain-shared";

import type { AgentPermissionResponse, AgentPermissionResult } from "@liwa/brain-shared/paseo/agent/agent-sdk-types";
import { startAgentRun, type AgentRunController } from "./agent-prompt.ts";

export interface PermissionResponseAgentManager extends AgentRunController {
  respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void>;
}

export interface RespondToAgentPermissionParams {
  agentManager: PermissionResponseAgentManager;
  agentId: string;
  requestId: string;
  response: AgentPermissionResponse;
  logger: Logger;
}

export async function respondToAgentPermission(
  params: RespondToAgentPermissionParams,
): Promise<void> {
  const { agentManager, agentId, requestId, response, logger } = params;
  logger.debug(
    { agentId, requestId },
    `Handling permission response for agent ${agentId}, request ${requestId}`,
  );

  const result = await agentManager.respondToPermission(agentId, requestId, response);
  logger.debug({ agentId }, `Permission response forwarded to agent ${agentId}`);

  if (result?.followUpPrompt) {
    logger.debug({ agentId }, "Permission response requires follow-up turn, starting agent stream");
    await startAgentRun(agentManager, agentId, result.followUpPrompt, logger, {
      replaceRunning: true,
    });
  }
}
