// 装配树哈希：有序条目、包版本与摘要、config（密钥只取引用）、绑定、契约版本
import { createHash } from 'node:crypto';

/** 键排序后的稳定 JSON */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
