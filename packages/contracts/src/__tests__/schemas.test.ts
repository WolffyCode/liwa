// 机制层 schema 的正反例（docs/architecture/modules/00-contracts.md §13）
import { describe, expect, it } from 'vitest';
import {
  AppendRequest,
  CONTRACT_VERSIONS,
  EVENT_TYPES,
  EventEnvelope,
  JsonValue,
  LiwaError,
  Manifest,
  PackageManifest,
  Patch,
  Profile,
  RpcMessage,
  SLOT_DEFS,
  SLOT_NAMES,
  SERVICE_KEYS,
  SERVICE_VERSIONS,
  SecretRef,
  STAGE_SETS,
} from '../index.js';

const manifest = {
  manifestVersion: 1,
  id: 'brain-claude',
  kind: 'builtin',
  provides: { 'brain.provider': { contract: 1, impl: 'claude', meta: { personaInjection: 'system_prompt' } } },
  consumes: { procs: 1 },
};

describe('manifest', () => {
  it('文档示例通过（只实现一个槽位的稀疏映射）', () => {
    expect(Manifest.parse(manifest)).toEqual(manifest);
  });
  it('拼错字段被拒（strictObject）', () => {
    expect(Manifest.safeParse({ ...manifest, provide: {} }).success).toBe(false);
  });
  it('未知槽位名、未知服务键被拒', () => {
    expect(Manifest.safeParse({ ...manifest, provides: { 'brain.providers': { contract: 1, impl: 'x' } } }).success).toBe(false);
    expect(Manifest.safeParse({ ...manifest, consumes: { nope: 1 } }).success).toBe(false);
  });
  it('id 必须 kebab-case', () => {
    expect(Manifest.safeParse({ ...manifest, id: 'Brain_Claude' }).success).toBe(false);
  });
  it('package.json 带 liwa 字段', () => {
    expect(PackageManifest.safeParse({ name: '@liwa/plugin-brain-claude', version: '0.1.0', liwa: manifest }).success).toBe(true);
  });
});

describe('profile 与 patch', () => {
  it('m0 示例通过', () => {
    const profile = {
      id: 'm0-terminal',
      stage: 'm0',
      plugins: [{ id: 'brain-claude', package: '@liwa/plugin-brain-claude', config: { maxTurns: 100 } }],
      memberDefaults: { slots: { 'memory.engine': 'default', 'ability.embed': ['local', 'siliconflow'] } },
    };
    expect(Profile.parse(profile)).toEqual(profile);
  });
  it('未知阶段、拼错字段被拒', () => {
    expect(Profile.safeParse({ id: 'x', stage: 'm9', plugins: [] }).success).toBe(false);
    expect(Profile.safeParse({ id: 'x', stage: 'm0', plugins: [], member: {} }).success).toBe(false);
  });
  it('五种操作各一条', () => {
    const patch = [
      { replace: { id: 'brain-claude', config: { maxTurns: 50 } } },
      { disable: { id: 'ability-embed-local' } },
      { enable: { id: 'ability-embed-local' } },
      { bind: { slot: 'memory.engine', binding: 'default' } },
      { insert: { id: 'job-triggers', package: '@liwa/plugin-job-triggers', after: 'brain-claude' } },
      { remove: { id: 'job-triggers' } },
    ];
    expect(Patch.parse(patch)).toEqual(patch);
  });
  it('一条操作里混两个动作被拒', () => {
    expect(Patch.safeParse([{ disable: { id: 'a' }, enable: { id: 'a' } }]).success).toBe(false);
  });
});

describe('版本表与槽位清单一致', () => {
  it('每个槽位都有契约版本与定义', () => {
    for (const name of SLOT_NAMES) {
      expect(SLOT_DEFS[name].name).toBe(name);
      expect(CONTRACT_VERSIONS[name]).toBe(SLOT_DEFS[name].contract);
    }
  });
  it('阶段集合只引用已知服务键，且 v1 包含全部', () => {
    for (const stage of ['m0', 'm1', 'v1'] as const) {
      for (const key of STAGE_SETS[stage]) expect(SERVICE_KEYS).toContain(key);
    }
    expect([...STAGE_SETS.v1].sort()).toEqual([...SERVICE_KEYS].sort());
    expect(Object.keys(SERVICE_VERSIONS).sort()).toEqual([...SERVICE_KEYS].sort());
  });
});

describe('事件', () => {
  const source = { audienceId: 0, sourceKind: 'system', trust: 1, taint: false };
  it('信封与追加请求', () => {
    const envelope = { pos: '12', stream: { kind: 'system', id: 'system' }, seq: 3, type: 'kernel.started.v1', version: 1, actor: 'system', at: '2026-10-29T10:00:00+08:00', source };
    expect(EventEnvelope.parse(envelope)).toEqual(envelope);
    expect(AppendRequest.safeParse({ stream: { kind: 'system', id: 'system' }, type: 'kernel.started.v1', actor: 'system', source }).success).toBe(true);
  });
  it('类型名必须带 .v<n>', () => {
    expect(AppendRequest.safeParse({ stream: { kind: 'system', id: 's' }, type: 'kernel.started', actor: 'system', source }).success).toBe(false);
  });
  it('kernel 的事件已登记且载荷可校验', () => {
    const def = EVENT_TYPES.get('kernel.started.v1');
    expect(def).toBeDefined();
    expect(def?.payload.safeParse({ profile: 'm0', stage: 'm0', assemblyHash: 'abc', plugins: [] }).success).toBe(true);
  });
});

describe('IPC 与错误', () => {
  it('请求、响应、通知', () => {
    expect(RpcMessage.safeParse({ jsonrpc: '2.0', id: '1', method: 'brain.provider/createSession', params: {} }).success).toBe(true);
    expect(RpcMessage.safeParse({ jsonrpc: '2.0', id: '1', result: null }).success).toBe(true);
    expect(RpcMessage.safeParse({ jsonrpc: '2.0', method: '$/stream', params: { id: '1', seq: 0, kind: 'item' } }).success).toBe(true);
    expect(RpcMessage.safeParse({ jsonrpc: '2.0', id: '1', method: 'Brain Provider/x' }).success).toBe(false);
  });
  it('LiwaError 往返', () => {
    const err = new LiwaError('unavailable', 'slot.unresolved', '没有可用实现', { data: { slot: 'memory.engine' } });
    expect(err.retryable).toBe(true);
    const back = LiwaError.fromShape(JSON.parse(JSON.stringify(err.toShape())));
    expect(back.category).toBe('unavailable');
    expect(back.code).toBe('slot.unresolved');
    expect(back.data).toEqual({ slot: 'memory.engine' });
  });
  it('JsonValue 拒绝函数与 undefined，SecretRef 只认两种前缀', () => {
    expect(JsonValue.safeParse({ a: [1, 'x', null, { b: true }] }).success).toBe(true);
    expect(JsonValue.safeParse({ a: () => 1 }).success).toBe(false);
    expect(SecretRef.safeParse({ $secret: 'keychain:liwa/deepseek' }).success).toBe(true);
    expect(SecretRef.safeParse({ $secret: 'file:/tmp/x' }).success).toBe(false);
  });
});
