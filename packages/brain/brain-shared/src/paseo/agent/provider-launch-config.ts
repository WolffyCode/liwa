// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/provider-launch-config.ts；原地改动见包内 NOTICE。
import { scrubbedParentEnv } from "@liwa/subprocess";
import { findProviderExecutable, type ProviderProcessHost } from "@liwa/brain";

// 灵鲸改：上游这两个类型来自 paseo-env.ts（Paseo 守护进程自己的环境处理，不迁），这里就地写出。
type ProcessEnvRecord = Record<string, string | undefined>;
type ExternalProcessEnv = Record<string, string>;
export {
  AgentProviderRuntimeSettingsMapSchema,
  ProviderCommandSchema,
  ProviderOverrideSchema,
  ProviderOverridesSchema,
  ProviderProfileModelSchema,
  ProviderRuntimeSettingsSchema,
  type AgentProviderRuntimeSettingsMap,
  type ProviderCommand,
  type ProviderOverride,
  type ProviderOverrides,
  type ProviderProfileModel,
  type ProviderRuntimeSettings,
} from "../protocol/provider-config.ts";
import {
  ProviderOverrideSchema,
  ProviderOverridesSchema,
  ProviderRuntimeSettingsSchema,
  type ProviderCommand,
  type ProviderOverride,
  type ProviderOverrides,
  type ProviderRuntimeSettings,
} from "../protocol/provider-config.ts";

export interface ProviderCommandPrefix {
  command: string;
  args: string[];
}

export type ProviderLaunchSource = "default" | "append" | "override";

export interface ResolvedProviderLaunch {
  command: string;
  args: string[];
  source: ProviderLaunchSource;
  env?: ProcessEnvRecord;
}

export interface ProviderLaunchAvailability {
  available: boolean;
  resolvedPath: string | null;
}

export interface ProviderLaunchDefault {
  command: string;
  resolvePath?: () => Promise<string | null>;
}

function normalizeLaunchDefault(
  defaultBinary: string | ProviderLaunchDefault,
): ProviderLaunchDefault {
  if (typeof defaultBinary === "string") {
    return { command: defaultBinary };
  }
  return defaultBinary;
}

// 灵鲸改：可执行解析改走 subprocess（ctx.subprocess.resolveExecutable），不再自己探测 `--version`。
async function resolveLaunchPath(
  host: ProviderProcessHost,
  command: string,
  env?: ProcessEnvRecord,
): Promise<string | null> {
  return findProviderExecutable(host, command, env);
}

async function resolveDefaultLaunchPath(
  host: ProviderProcessHost,
  defaultBinary: ProviderLaunchDefault,
): Promise<string | null> {
  return defaultBinary.resolvePath
    ? await defaultBinary.resolvePath()
    : await resolveLaunchPath(host, defaultBinary.command);
}

export interface ResolveProviderLaunchOptions {
  commandConfig?: ProviderCommand;
  defaultBinary?: string | ProviderLaunchDefault;
}

export async function resolveProviderLaunch({
  commandConfig,
  defaultBinary,
}: ResolveProviderLaunchOptions): Promise<ResolvedProviderLaunch> {
  if (commandConfig?.mode === "replace") {
    const command = commandConfig.argv[0];
    return {
      command,
      args: commandConfig.argv.slice(1),
      source: "override",
    };
  }

  if (defaultBinary === undefined) {
    throw new Error("defaultBinary is required when provider command is not replaced");
  }
  const normalizedDefault = normalizeLaunchDefault(defaultBinary);
  const args = commandConfig?.mode === "append" ? [...(commandConfig.args ?? [])] : [];
  return {
    command: normalizedDefault.command,
    args,
    source: commandConfig?.mode === "append" ? "append" : "default",
  };
}

// 灵鲸改：多一个 host 参数（进程经 subprocess）。
export async function checkProviderLaunchAvailable(
  launch: ResolvedProviderLaunch,
  host: ProviderProcessHost,
  defaultBinary?: ProviderLaunchDefault,
): Promise<ProviderLaunchAvailability> {
  const resolvedPath =
    defaultBinary && launch.source !== "override"
      ? await resolveDefaultLaunchPath(host, defaultBinary)
      : await resolveLaunchPath(host, launch.command, launch.env);
  return {
    available: resolvedPath !== null,
    resolvedPath,
  };
}

export async function resolveProviderCommandPrefix(
  commandConfig: ProviderCommand | undefined,
  resolveDefaultCommand: () => string | Promise<string>,
): Promise<ProviderCommandPrefix> {
  if (commandConfig?.mode === "replace") {
    const launch = await resolveProviderLaunch({
      commandConfig,
    });
    return {
      command: launch.command,
      args: launch.args,
    };
  }

  const defaultCommand = await resolveDefaultCommand();
  const launch = await resolveProviderLaunch({
    commandConfig,
    defaultBinary: {
      command: defaultCommand,
      resolvePath: async () => defaultCommand,
    },
  });
  return {
    command: launch.command,
    args: launch.args,
  };
}

let cachedShellEnv: Record<string, string> | null = null;

// 灵鲸改：基底从 process.env 换成 subprocess 剥掉凭据与 LIWA_* 之后的环境（灵鲸的子进程环境只有这一个来源）。
export function resolveShellEnv(): Record<string, string> {
  if (cachedShellEnv) {
    return cachedShellEnv;
  }
  cachedShellEnv = scrubbedParentEnv();
  return cachedShellEnv;
}

export function migrateProviderSettings(
  raw: Record<string, unknown>,
  builtinProviderIds: string[],
): ProviderOverrides {
  const migrated: Record<string, ProviderOverride> = {};
  const builtinProviderIdSet = new Set(builtinProviderIds);

  for (const [providerId, value] of Object.entries(raw)) {
    const parsedNew = ProviderOverrideSchema.safeParse(value);
    if (parsedNew.success) {
      migrated[providerId] = parsedNew.data;
      continue;
    }

    const parsedOld = ProviderRuntimeSettingsSchema.safeParse(value);
    if (!parsedOld.success) {
      continue;
    }

    const nextEntry: ProviderOverride = {};
    const command = parsedOld.data.command;
    if (command?.mode === "append") {
      continue;
    }
    if (command?.mode === "replace") {
      nextEntry.command = command.argv;
    }
    if (parsedOld.data.env) {
      nextEntry.env = parsedOld.data.env;
    }
    if (!builtinProviderIdSet.has(providerId) && nextEntry.extends === undefined) {
      delete nextEntry.extends;
    }
    migrated[providerId] = nextEntry;
  }

  return ProviderOverridesSchema.parse(migrated);
}

// Env vars that indicate a running Claude Code session. If the daemon itself is
// launched from inside Claude Code (e.g. by a Paseo agent), these leak into
// child processes and cause "cannot be launched inside another session" errors.
const PARENT_SESSION_ENV_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_AGENT_SDK_VERSION",
];

export interface ProviderEnvOptions {
  baseEnv?: ProcessEnvRecord;
  runtimeSettings?: ProviderRuntimeSettings;
  overlays?: Array<ProcessEnvRecord | undefined>;
}

export interface ProviderEnvSpec {
  baseEnv?: ProcessEnvRecord;
  envOverlay: ProcessEnvRecord;
}

function collectProviderEnvOverlays(
  runtimeSettings: ProviderRuntimeSettings | undefined,
  overlays: Array<ProcessEnvRecord | undefined>,
): ProcessEnvRecord[] {
  return [runtimeSettings?.env, ...overlays].filter(
    (overlay): overlay is ProcessEnvRecord => !!overlay,
  );
}

export function createProviderEnvSpec(options: ProviderEnvOptions = {}): ProviderEnvSpec {
  const overlays = collectProviderEnvOverlays(options.runtimeSettings, options.overlays ?? []);
  const envOverlay: ProcessEnvRecord = Object.assign({}, ...overlays);
  for (const key of PARENT_SESSION_ENV_VARS) {
    envOverlay[key] = undefined;
  }
  return {
    ...(options.baseEnv ? { baseEnv: options.baseEnv } : {}),
    envOverlay,
  };
}

// 灵鲸改：完整环境从 subprocess 的 scrubbedParentEnv() 起步（上游从 process.env 起步再剥 Paseo 自己的运行时变量）；
// 走 ctx.subprocess.spawn 的调用方应只传 createProviderEnvSpec().envOverlay，由 subprocess 合并。
export function createProviderEnv(options: ProviderEnvOptions = {}): ExternalProcessEnv {
  const spec = createProviderEnvSpec(options);
  const merged: ProcessEnvRecord = { ...(spec.baseEnv ?? scrubbedParentEnv()), ...spec.envOverlay };
  const env: ExternalProcessEnv = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

// 灵鲸改：多一个 host 参数（进程经 subprocess）。
export async function isProviderCommandAvailable(
  commandConfig: ProviderCommand | undefined,
  resolveDefaultCommand: () => string | Promise<string>,
  host: ProviderProcessHost,
): Promise<boolean> {
  try {
    if (commandConfig?.mode === "replace") {
      const launch = await resolveProviderLaunch({
        commandConfig,
      });
      const availability = await checkProviderLaunchAvailable(launch, host);
      return availability.available;
    }

    const defaultCommand = await resolveDefaultCommand();
    const defaultBinary = {
      command: defaultCommand,
      resolvePath: async () => defaultCommand,
    };
    const launch = await resolveProviderLaunch({ commandConfig, defaultBinary });
    const availability = await checkProviderLaunchAvailable(launch, host, defaultBinary);
    return availability.available;
  } catch {
    return false;
  }
}
