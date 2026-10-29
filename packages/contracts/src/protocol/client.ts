// 前后端信封（docs/architecture/modules/00-contracts.md §9）；订阅种类与主人接口清单在 07 定
import { LiwaErrorShape } from '../errors.js';
import { z } from '../z.js';

export const CLIENT_PROTOCOL_VERSION = 1 as const;

export const Request = z.object({ t: z.literal('req'), id: z.string().min(1), op: z.string().min(1), body: z.unknown(), v: z.literal(CLIENT_PROTOCOL_VERSION) });
export const Response = z.discriminatedUnion('ok', [
  z.object({ t: z.literal('res'), id: z.string().min(1), ok: z.literal(true), body: z.unknown() }),
  z.object({ t: z.literal('res'), id: z.string().min(1), ok: z.literal(false), error: LiwaErrorShape }),
]);
export const Frame = z.object({ t: z.literal('sub'), sub: z.string().min(1), cursor: z.string(), items: z.array(z.unknown()) });
export const Hello = z.object({ t: z.literal('hello'), v: z.literal(CLIENT_PROTOCOL_VERSION), build: z.string(), token: z.string() });
export type Request = z.infer<typeof Request>;
export type Response = z.infer<typeof Response>;
export type Frame = z.infer<typeof Frame>;
export type Hello = z.infer<typeof Hello>;
