// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/question-card-answer.ts；原地改动见包内 NOTICE。
/**
 * The shared question card sends a multi-select answer as one string: the checked option
 * labels in click order, then any typed answer, joined with ", ". Consume exact option
 * labels from the front, longest first so a label containing ", " wins over its prefix;
 * any remaining text is the typed answer.
 */
export function splitMultiSelectAnswer(
  answer: string,
  labels: string[],
): { selected: string[]; custom: string | null } {
  let remaining = answer;
  const selected: string[] = [];
  while (remaining.length > 0) {
    const label = labels
      .filter((candidate) => !selected.includes(candidate))
      .sort((left, right) => right.length - left.length)
      .find((candidate) => remaining === candidate || remaining.startsWith(`${candidate}, `));
    if (!label) break;
    selected.push(label);
    remaining = remaining === label ? "" : remaining.slice(label.length + 2);
  }
  return { selected, custom: remaining || null };
}
