// 只跑装配第 1 阶段并打印 AssemblyPlan（docs/architecture/modules/00-plugin-kernel.md §4.3；docs/engineering.md §4.4）
// 用法：pnpm dump-config [--profile m0-terminal] [--patch 文件]... [--home 目录] [--json]
// 退出码：0 计划无致命问题；1 有致命问题或读不到 profile（docs/engineering.md §12）
import { parseArgs } from 'node:util';
import { dumpAssembly } from '@liwa/app';
import { LiwaError, type AssemblyPlan } from '@liwa/contracts';

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'm0-terminal' },
    patch: { type: 'string', multiple: true },
    home: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

function summary(plan: AssemblyPlan): string {
  const lines: string[] = [];
  lines.push(`profile ${plan.profile}  阶段 ${plan.stage}  装配哈希 ${plan.assemblyHash.slice(0, 12)}`, '', '条目');
  for (const e of plan.entries) {
    const where = e.package ? `${e.package}${e.version ? `@${e.version}` : ''}` : '（代码传入）';
    lines.push(`  ${e.status === 'enabled' ? '✓' : '✗'} ${e.id}  ${e.kind}  ${where}  层 ${e.layer}${e.reason ? `  原因：${e.reason}` : ''}`);
  }
  lines.push('', '槽位');
  for (const s of plan.slots) {
    const providers = s.providers.map((p) => `${p.impl}←${p.plugin}`).join('、') || '—';
    lines.push(`  ${s.satisfied ? '✓' : '✗'} ${s.slot}  ${s.cardinality}  提供方 ${providers}${s.requiredBy ? `  必需于 ${s.requiredBy}` : ''}`);
  }
  if (plan.problems.length > 0) {
    lines.push('', '问题');
    for (const p of plan.problems) lines.push(`  [${p.severity}] ${p.entry ? `${p.entry}：` : ''}${p.message}`);
  }
  return `${lines.join('\n')}\n`;
}

try {
  const plan = dumpAssembly({ profile: values.profile, ...(values.patch ? { patches: values.patch } : {}), ...(values.home ? { home: values.home } : {}) });
  process.stdout.write(values.json ? `${JSON.stringify(plan, null, 2)}\n` : summary(plan));
  process.exitCode = plan.problems.some((p) => p.severity === 'fatal') ? 1 : 0;
} catch (error) {
  const prefix = LiwaError.is(error) ? `${error.code}：` : '';
  process.stderr.write(`dump-config 失败：${prefix}${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
