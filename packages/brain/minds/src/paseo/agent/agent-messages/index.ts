// 来源：paseo-upstream@8018231a packages/server/src/server/agent/agent-messages/index.ts；Apache-2.0，灵鲸改见 NOTICE。
export {
  formatAgentMessage,
  parseAgentMessage,
  parseAgentMessages,
  prepareAgentMessage,
  projectAgentMessages,
  formatSystemNotificationPrompt,
  isSystemInjectedEnvelope,
  type AgentPromptSource,
} from "./envelope.ts";
export { createAgentMessageDelivery, type AgentMessageDelivery } from "./delivery.ts";
