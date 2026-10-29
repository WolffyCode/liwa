// 密钥引用的解析：config 里只出现 { $secret: "keychain:…" }，交给插件前才换成明文
import { LiwaError, SecretRef } from '@liwa/contracts';
import type { SecretResolver } from './types.js';

/** 把 config 树里的密钥引用解析成明文；返回新对象，不改原值 */
export async function resolveSecrets(config: unknown, resolver: SecretResolver, path: string[] = []): Promise<unknown> {
  if (Array.isArray(config)) {
    return Promise.all(config.map((item, i) => resolveSecrets(item, resolver, [...path, String(i)])));
  }
  if (typeof config !== 'object' || config === null) return config;
  const ref = SecretRef.safeParse(config);
  if (ref.success) {
    const value = await resolver.resolve(ref.data.$secret);
    if (value === undefined) {
      throw new LiwaError('unavailable', 'secret.missing', `密钥引用解析不到：${ref.data.$secret}（config.${path.join('.')}）`);
    }
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) out[key] = await resolveSecrets(value, resolver, [...path, key]);
  return out;
}

/** 把密钥引用脱敏成固定占位，给 dump-config 与装配哈希用 */
export function redactSecrets(config: unknown): unknown {
  if (Array.isArray(config)) return config.map(redactSecrets);
  if (typeof config !== 'object' || config === null) return config;
  const ref = SecretRef.safeParse(config);
  if (ref.success) return { $secret: ref.data.$secret };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) out[key] = redactSecrets(value);
  return out;
}

export const noSecrets: SecretResolver = { resolve: async () => undefined };

/** 环境变量解析器：env:NAME */
export function envSecrets(env: NodeJS.ProcessEnv = process.env): SecretResolver {
  return {
    async resolve(ref) {
      if (!ref.startsWith('env:')) return undefined;
      return env[ref.slice(4)];
    },
  };
}
