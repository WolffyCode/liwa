// 来源：paseo-upstream@8018231a packages/server/src/server/agent/prompt-attachments.ts；Apache-2.0，灵鲸改见 NOTICE。

import type { AgentPromptContentBlock, AgentPromptInput } from "@liwa/brain-shared/paseo/agent/agent-sdk-types";

// 灵鲸改：Paseo 附件域不搬；只组装已支持的文本与内联图片。
export function buildAgentPrompt(text: string, images?: Array<{ data: string; mimeType: string }>): AgentPromptInput {
  const normalized = text.trim();
  if (!images?.length) return normalized;
  const blocks: AgentPromptContentBlock[] = [];
  if (normalized.length > 0) blocks.push({ type: "text", text: normalized });
  for (const image of images) blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  return blocks;
}
