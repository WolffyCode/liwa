// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/claude/subagents/workflow-output.ts；改动见包内 NOTICE。
import fs from "node:fs";
import path from "node:path";

const MAX_WORKFLOW_OUTPUT_BYTES = 1024 * 1024;
const MAX_WORKFLOW_RESULT_CHARS = 100_000;

export function readClaudeWorkflowResultFile(outputFile: string, ownedRoot: string): string | undefined {
  // 灵鲸改：只读本成员 CLI 的状态/临时输出，拒绝路径逃逸与指向外部的链接。
  if (!within(ownedRoot, outputFile)) return undefined;
  let descriptor: number | undefined;
  try {
    const resolved = fs.realpathSync(outputFile);
    if (!within(fs.realpathSync(ownedRoot), resolved)) return undefined;
    descriptor = fs.openSync(resolved, "r");
    const buffer = Buffer.alloc(MAX_WORKFLOW_OUTPUT_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = fs.readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > MAX_WORKFLOW_OUTPUT_BYTES) return undefined;
    return parseClaudeWorkflowResult(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function parseClaudeWorkflowResult(contents: string): string | undefined {
  if (Buffer.byteLength(contents, "utf8") > MAX_WORKFLOW_OUTPUT_BYTES) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return undefined;
  }
  const record = toRecord(parsed);
  return record && Object.hasOwn(record, "result")
    ? formatClaudeWorkflowResult(record.result)
    : undefined;
}

export function formatClaudeWorkflowResult(result: unknown): string | undefined {
  const unwrapped = unwrapSingleValue(result);
  let text: string | undefined;
  if (typeof unwrapped === "string") {
    text = unwrapped.trim();
  } else if (typeof unwrapped === "number" || typeof unwrapped === "boolean") {
    text = String(unwrapped);
  } else if (unwrapped !== null && unwrapped !== undefined) {
    try {
      const json = JSON.stringify(unwrapped, null, 2);
      if (json) text = `\`\`\`json\n${json}\n\`\`\``;
    } catch {
      return undefined;
    }
  }

  if (!text) return undefined;
  return text.length <= MAX_WORKFLOW_RESULT_CHARS
    ? text
    : `${text.slice(0, MAX_WORKFLOW_RESULT_CHARS)}\n\n…`;
}

function unwrapSingleValue(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 8; depth += 1) {
    const record = toRecord(current);
    if (!record) return current;
    const keys = Object.keys(record);
    if (keys.length !== 1) return current;
    current = record[keys[0]];
  }
  return current;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function within(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
