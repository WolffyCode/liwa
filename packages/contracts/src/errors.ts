// 错误类别与 LiwaError（docs/architecture/modules/00-contracts.md §11）
import { z } from './z.js';

export const ErrorCategory = z.enum([
  'retryable',
  'timeout',
  'unavailable',
  'auth',
  'quota',
  'refused',
  'process_exit',
  'invalid_input',
  'invalid_output',
  'not_permitted',
  'conflict',
  'cancelled',
  'internal',
]);
export type ErrorCategory = z.infer<typeof ErrorCategory>;

/** 每个类别默认的 retryable：说的是故障性质，不是"此动作可以安全重做" */
export const DEFAULT_RETRYABLE: Readonly<Record<ErrorCategory, boolean>> = Object.freeze({
  retryable: true,
  timeout: true,
  unavailable: true,
  auth: false,
  quota: false,
  refused: false,
  process_exit: true,
  invalid_input: false,
  invalid_output: false,
  not_permitted: false,
  conflict: false,
  cancelled: false,
  internal: false,
});

/** JSON-RPC 的整数错误码：按类别映射到 -32000…-32019 的服务端段 */
export const JSON_RPC_CODES: Readonly<Record<ErrorCategory, number>> = Object.freeze({
  retryable: -32000,
  timeout: -32001,
  unavailable: -32002,
  auth: -32003,
  quota: -32004,
  refused: -32005,
  process_exit: -32006,
  invalid_input: -32007,
  invalid_output: -32008,
  not_permitted: -32009,
  conflict: -32010,
  cancelled: -32011,
  internal: -32012,
});

/** 协议里传输的错误形状 */
export const LiwaErrorShape = z.object({
  category: ErrorCategory,
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
  data: z.unknown().optional(),
});
export type LiwaErrorShape = z.infer<typeof LiwaErrorShape>;

export interface LiwaErrorOptions {
  retryable?: boolean;
  cause?: unknown;
  data?: unknown;
}

/** 跨模块边界只抛这一种错误 */
export class LiwaError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly retryable: boolean;
  readonly data: unknown;

  constructor(category: ErrorCategory, code: string, message: string, opts: LiwaErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'LiwaError';
    this.category = category;
    this.code = code;
    this.retryable = opts.retryable ?? DEFAULT_RETRYABLE[category];
    this.data = opts.data;
  }

  static is(value: unknown): value is LiwaError {
    return value instanceof LiwaError;
  }

  toShape(): LiwaErrorShape {
    const shape: LiwaErrorShape = { category: this.category, code: this.code, message: this.message, retryable: this.retryable };
    if (this.data !== undefined) shape.data = this.data;
    return shape;
  }

  static fromShape(shape: LiwaErrorShape): LiwaError {
    const opts: LiwaErrorOptions = { retryable: shape.retryable };
    if (shape.data !== undefined) opts.data = shape.data;
    return new LiwaError(shape.category, shape.code, shape.message, opts);
  }
}
