// 进程外插件的 IPC 信封：JSON-RPC 2.0，一行一条，走 fd 3（docs/architecture/modules/00-contracts.md §10）
import { LiwaErrorShape } from '../errors.js';
import { z } from '../z.js';

export const IPC_PROTOCOL_VERSION = 1 as const;
export const IPC_MAX_LINE_BYTES = 1024 * 1024;
export const IPC_MAX_INFLIGHT = 64;
export const IPC_STREAM_ACK_EVERY = 256;

const Id = z.string().min(1);
/** 方法名：<slot>/<method>、<slot>/<Iface>.<method>、kernel/<name>、kernel/view.<视图>、$/stream、$/ack、$/cancel */
const Method = z.string().regex(/^([a-z.]+\/[A-Za-z.]+|kernel\/[A-Za-z.]+|\$\/(stream|ack|cancel))$/);

export const RpcRequest = z.object({ jsonrpc: z.literal('2.0'), id: Id, method: Method, params: z.unknown().optional() });
export const RpcError = z.object({ code: z.number().int(), message: z.string(), data: LiwaErrorShape.optional() });
export const RpcResponse = z.union([
  z.object({ jsonrpc: z.literal('2.0'), id: Id, result: z.unknown() }),
  z.object({ jsonrpc: z.literal('2.0'), id: Id, error: RpcError }),
]);
export const RpcNotification = z.object({ jsonrpc: z.literal('2.0'), method: Method, params: z.unknown().optional() });
export const RpcMessage = z.union([RpcRequest, RpcResponse, RpcNotification]);
export type RpcRequest = z.infer<typeof RpcRequest>;
export type RpcResponse = z.infer<typeof RpcResponse>;
export type RpcNotification = z.infer<typeof RpcNotification>;

export const HelloParams = z.object({ kernelVersion: z.string(), ipcProtocolVersion: z.literal(IPC_PROTOCOL_VERSION), contracts: z.record(z.string(), z.number().int()) });
export const HelloResult = z.object({ manifest: z.unknown(), pid: z.number().int().positive(), ipcProtocolVersion: z.literal(IPC_PROTOCOL_VERSION) });
export const StreamParams = z.object({ id: Id, seq: z.number().int().nonnegative(), kind: z.enum(['item', 'end', 'error']), data: z.unknown().optional() });
export const AckParams = z.object({ id: Id, seq: z.number().int().nonnegative() });
export const CancelParams = z.object({ id: Id });
