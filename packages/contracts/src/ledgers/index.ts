// required 之间的账本 / 服务 API 类型（docs/architecture/modules/00-contracts.md §7）。
// 现阶段只放形状：每个接口随对应模块文档定稿时补全；kernel 只按服务键装配，不依赖这些方法。
import type { EventId } from '../common.js';
import type { AppendRequest, CommittedEvent } from '../events/envelope.js';
import type { ServiceKey } from '../services.js';

/** 登记回调的方法一律返回释放函数 */
export type Unsubscribe = () => void;

export interface Journal {
  append(req: AppendRequest): Promise<CommittedEvent>;
  read(opts: { from?: EventId; limit?: number }): Promise<CommittedEvent[]>;
  subscribe(filter: { types?: string[] }, cb: (event: CommittedEvent) => void): Unsubscribe;
  putPayload(payload: unknown): Promise<{ id: string }>;
}

export interface Procs {
  spawn(opts: { id: string; cmd: string; args: string[]; cwd: string; env: Record<string, string>; group?: string }): Promise<{ pid: number; handle: string }>;
  kill(handle: string): Promise<void>;
}

/** 其余服务：接口随模块文档补全；先用品牌类型占位，保证服务键与类型一一对应 */
export interface ServiceStub<K extends ServiceKey> {
  readonly __service: K;
}

export interface Services {
  journal: Journal;
  guard: ServiceStub<'guard'>;
  procs: Procs;
  brains: ServiceStub<'brains'>;
  abilities: ServiceStub<'abilities'>;
  formhost: ServiceStub<'formhost'>;
  workspace: ServiceStub<'workspace'>;
  notify: ServiceStub<'notify'>;
  roster: ServiceStub<'roster'>;
  self: ServiceStub<'self'>;
  body: ServiceStub<'body'>;
  memory: ServiceStub<'memory'>;
  people: ServiceStub<'people'>;
  skills: ServiceStub<'skills'>;
  senses: ServiceStub<'senses'>;
  attention: ServiceStub<'attention'>;
  will: ServiceStub<'will'>;
  scheduler: ServiceStub<'scheduler'>;
  tasks: ServiceStub<'tasks'>;
  outbox: ServiceStub<'outbox'>;
  minds: ServiceStub<'minds'>;
  context: ServiceStub<'context'>;
  actions: ServiceStub<'actions'>;
  toolport: ServiceStub<'toolport'>;
  gateway: ServiceStub<'gateway'>;
}
