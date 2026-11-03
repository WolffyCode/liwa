// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/system-prompt.ts；原地改动见包内 NOTICE。
export function composeSystemPromptParts(
  ...parts: Array<string | null | undefined>
): string | undefined {
  const prompt = parts
    .map((part) => part?.trim())
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n");

  return prompt.length > 0 ? prompt : undefined;
}
