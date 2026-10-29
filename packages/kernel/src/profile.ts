// profile 与 patch 的读取与叠层（docs/architecture/modules/00-plugin-kernel.md §4）
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Binding, LiwaError, Patch, PATCH_LAYERS, Profile, type PatchLayer, type PatchOp, type SlotName } from '@liwa/contracts';

export interface ResolvedEntry {
  id: string;
  package?: string;
  as?: string;
  config?: unknown;
  disabled: boolean;
  /** 来自哪一层 */
  layer: PatchLayer;
  /** 被禁用的原因 */
  reason?: string;
}

export interface ResolvedBinding {
  /** 'default' 或成员 id */
  scope: string;
  slot: SlotName;
  binding: Binding;
  layer: PatchLayer;
}

export interface ResolvedProfile {
  profile: Profile;
  entries: ResolvedEntry[];
  bindings: ResolvedBinding[];
}

export interface ProfileSource {
  profile: unknown;
  /** 按层给的 patch 原始内容；缺省为空 */
  patches: Partial<Record<Exclude<PatchLayer, 'profile'>, unknown[]>>;
}

function readYaml(file: string): unknown {
  try {
    return parseYaml(readFileSync(file, 'utf8'));
  } catch (cause) {
    throw new LiwaError('invalid_input', 'profile.read', `读不到或解析不了 ${file}`, { cause });
  }
}

/** 从文件系统读 profile 与四层 patch */
export function readProfileSource(opts: { root: string; home: string; profile: string; cliPatches?: string[] }): ProfileSource {
  const profileFile = resolvePath(opts.root, 'profiles', `${opts.profile}.yml`);
  if (!existsSync(profileFile)) throw new LiwaError('invalid_input', 'profile.missing', `profile 文件不存在：${profileFile}`);
  const patches: ProfileSource['patches'] = {};
  const localFile = resolvePath(opts.home, 'profiles', `${opts.profile}.patch.yml`);
  if (existsSync(localFile)) patches.local = [readYaml(localFile)];
  const ownerFile = resolvePath(opts.home, 'profiles', `${opts.profile}.owner.yml`);
  if (existsSync(ownerFile)) patches.owner = [readYaml(ownerFile)];
  if (opts.cliPatches && opts.cliPatches.length > 0) patches.cli = opts.cliPatches.map(readYaml);
  return { profile: readYaml(profileFile), patches };
}

function layerError(layer: PatchLayer, index: number, message: string): LiwaError {
  return new LiwaError('invalid_input', 'patch.invalid', `patch 第 ${layer} 层第 ${index + 1} 条：${message}`);
}

/** 叠层：profile → local → owner → cli；返回有序条目与绑定 */
export function resolveProfile(source: ProfileSource, requiredIds: readonly string[]): ResolvedProfile {
  const parsed = Profile.safeParse(source.profile);
  if (!parsed.success) {
    throw new LiwaError('invalid_input', 'profile.schema', `profile 不合规范：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`);
  }
  const profile = parsed.data;
  const required = new Set(requiredIds);
  const entries: ResolvedEntry[] = [];
  const seen = new Set<string>();

  for (const required_ of requiredIds) {
    entries.push({ id: required_, disabled: false, layer: 'profile' });
    seen.add(required_);
  }
  for (const entry of profile.plugins) {
    if (seen.has(entry.id)) {
      if (required.has(entry.id)) {
        if (entry.package !== undefined) throw new LiwaError('invalid_input', 'profile.required_package', `required 插件 ${entry.id} 的条目不能带 package`);
        if (entry.disabled) throw new LiwaError('invalid_input', 'profile.required_disabled', `required 插件 ${entry.id} 不能禁用`);
        const target = entries.find((e) => e.id === entry.id);
        if (target && entry.config !== undefined) target.config = entry.config;
        continue;
      }
      throw new LiwaError('invalid_input', 'profile.duplicate', `profile 里插件 ${entry.id} 出现了两次`);
    }
    if (entry.package === undefined) throw new LiwaError('invalid_input', 'profile.no_package', `非 required 插件 ${entry.id} 必须写 package`);
    const resolved: ResolvedEntry = { id: entry.id, package: entry.package, disabled: entry.disabled ?? false, layer: 'profile' };
    if (entry.as !== undefined) resolved.as = entry.as;
    if (entry.config !== undefined) resolved.config = entry.config;
    if (resolved.disabled) resolved.reason = 'profile 里 disabled';
    entries.push(resolved);
    seen.add(entry.id);
  }

  const bindings: ResolvedBinding[] = [];
  for (const [slot, binding] of Object.entries(profile.memberDefaults?.slots ?? {})) {
    if (binding !== undefined) bindings.push({ scope: 'default', slot: slot as SlotName, binding, layer: 'profile' });
  }
  for (const [member, spec] of Object.entries(profile.members ?? {})) {
    for (const [slot, binding] of Object.entries(spec?.slots ?? {})) {
      if (binding !== undefined) bindings.push({ scope: member, slot: slot as SlotName, binding, layer: 'profile' });
    }
  }

  for (const layer of PATCH_LAYERS.slice(1) as Exclude<PatchLayer, 'profile'>[]) {
    for (const raw of source.patches[layer] ?? []) {
      const patch = Patch.safeParse(raw);
      if (!patch.success) throw new LiwaError('invalid_input', 'patch.schema', `patch 第 ${layer} 层不合规范：${patch.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`);
      const touched = new Set<string>();
      patch.data.forEach((op: PatchOp, index) => {
        const id = opTargetId(op);
        if (id !== undefined) {
          if (touched.has(id)) throw layerError(layer, index, `同一层里插件 ${id} 出现了两次`);
          touched.add(id);
        }
        applyOp(op, layer, index, entries, bindings, required);
      });
    }
  }
  return { profile, entries, bindings };
}

function opTargetId(op: PatchOp): string | undefined {
  if ('replace' in op) return op.replace.id;
  if ('disable' in op) return op.disable.id;
  if ('enable' in op) return op.enable.id;
  if ('insert' in op) return op.insert.id;
  if ('remove' in op) return op.remove.id;
  return undefined;
}

function applyOp(op: PatchOp, layer: PatchLayer, index: number, entries: ResolvedEntry[], bindings: ResolvedBinding[], required: Set<string>): void {
  if ('insert' in op || 'remove' in op) {
    throw layerError(layer, index, 'insert / remove 只在仓库内的 profile 文件里允许，第一版 patch 不能装卸插件');
  }
  if ('bind' in op) {
    const scope = op.bind.member ?? 'default';
    bindings.push({ scope, slot: op.bind.slot, binding: op.bind.binding, layer });
    return;
  }
  const id = 'replace' in op ? op.replace.id : 'disable' in op ? op.disable.id : op.enable.id;
  const target = entries.find((e) => e.id === id);
  if (!target) throw layerError(layer, index, `插件 ${id} 不在条目表里`);
  if ('replace' in op) {
    target.config = op.replace.config;
    target.layer = layer;
    return;
  }
  if ('disable' in op) {
    if (required.has(id)) throw layerError(layer, index, `required 插件 ${id} 不能禁用`);
    target.disabled = true;
    target.reason = `${layer} 层 disable`;
    target.layer = layer;
    return;
  }
  target.disabled = false;
  delete target.reason;
  target.layer = layer;
}
