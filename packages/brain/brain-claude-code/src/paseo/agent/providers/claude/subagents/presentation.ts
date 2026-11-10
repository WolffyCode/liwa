// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/claude/subagents/presentation.ts；改动见包内 NOTICE。
// 灵鲸改：模型展示用原生事实，不依赖产品模型目录。

export interface ClaudeSubagentUsage {
  totalTokens?: number;
}

export interface ClaudeSubagentPresentationFacts {
  title?: string;
  model?: string;
  effort?: string;
  usage?: ClaudeSubagentUsage;
}

/** Build the complete compact subtitle Claude exposes to provider-neutral clients. */
export function buildClaudeSubagentSubtitle(
  facts: ClaudeSubagentPresentationFacts,
): string | undefined {
  const parts = [
    readPart(facts.title),
    formatModel(facts.model),
    formatEffort(facts.effort),
    formatTokens(facts.usage?.totalTokens),
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function readPart(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatModel(modelId: string | undefined): string | undefined {
  const normalized = readPart(modelId);
  if (!normalized) return undefined;
  return normalized;
}

function formatEffort(effort: string | undefined): string | undefined {
  const normalized = readPart(effort);
  if (!normalized) return undefined;
  if (normalized === "xhigh") return "Extra High";
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTokens(totalTokens: number | undefined): string | undefined {
  if (typeof totalTokens !== "number" || totalTokens <= 0) return undefined;
  if (totalTokens < 1000) return `${Math.round(totalTokens)} tokens`;
  return `${Math.round(totalTokens / 100) / 10}k tokens`;
}
