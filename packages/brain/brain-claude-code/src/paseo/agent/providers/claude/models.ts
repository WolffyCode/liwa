// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/claude/models.ts；改动见包内 NOTICE。
// 灵鲸改：不读 settings、不探测目录、不猜模型窗口；窗口只取 SDK 事实。
export function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "<synthetic>" ? trimmed : null;
}
export const resolveObservedClaudeModelId = normalizeClaudeRuntimeModelId;
export function getClaudeContextWindowMaxTokens(_modelId: string | null | undefined): undefined {
  return undefined;
}
