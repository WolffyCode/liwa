// @liwa/app 组合根：进程入口、自检、信号处理、launchd 入口、安全模式页（docs/engineering.md §4.2、§7）
// 现阶段只有装配入口：required 清单、启动参数、dump-config；进程入口随 m0（路线图 1.7）加入
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { AssemblyPlan } from '@liwa/contracts';
import { dumpConfig, type PluginDef, type StartOptions } from '@liwa/kernel';

/** required 插件：core 的每个模块一个 defineService 的产物，按 m0 → m1 → v1 的阶段集合逐个加入（00-plugin-kernel §3、§5） */
export const REQUIRED: readonly PluginDef[] = [];

/** 本体的数据目录：LIWA_HOME，缺省 ~/.liwa */
export function liwaHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.LIWA_HOME ?? resolve(homedir(), '.liwa');
}

export interface AssemblyInput {
  profile: string;
  patches?: string[];
  home?: string;
}

/** 组合根给 kernel 的启动参数：root 是本包目录（Node 的包解析根），仓库根由 kernel 向上找 */
export function assemblyOptions(input: AssemblyInput): StartOptions {
  const options: StartOptions = {
    root: new URL('../', import.meta.url),
    home: input.home ?? liwaHome(),
    profile: input.profile,
    required: [...REQUIRED],
  };
  if (input.patches && input.patches.length > 0) options.patches = input.patches;
  return options;
}

/** 只跑装配第 1 阶段，不导入业务代码（00-plugin-kernel §4.3） */
export function dumpAssembly(input: AssemblyInput): AssemblyPlan {
  return dumpConfig(assemblyOptions(input));
}
