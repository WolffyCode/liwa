// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/claude/interrupt-placeholder.ts；改动见包内 NOTICE。
const INTERRUPT_PLACEHOLDER_PATTERN = /^\[Request interrupted by user(?:[^\]]*)\]$/;

/** The text Claude Code records in place of a turn that an interrupt stopped. */
export function isClaudeInterruptPlaceholderText(value: unknown): boolean {
  return typeof value === "string" && INTERRUPT_PLACEHOLDER_PATTERN.test(value.trim());
}
