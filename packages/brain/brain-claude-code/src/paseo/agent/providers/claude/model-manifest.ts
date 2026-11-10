// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/claude/model-manifest.ts；改动见包内 NOTICE。
// 灵鲸改：只留运行时版本解析，模型列表归实例 Config。
export function parseClaudeCodeVersion(value: string): [number, number, number] | null {
  const match =
    value.match(/\b(\d+)\.(\d+)\.(\d+)\s+\(Claude Code\)/i) ??
    value.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
