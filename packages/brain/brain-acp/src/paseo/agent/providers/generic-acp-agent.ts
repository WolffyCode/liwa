// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/generic-acp-agent.ts；原地改动见包内 NOTICE。
// 灵鲸改：上游的 pino 日志器换成接在 cordis logger 上的同形接口。
import type { PaseoLogger as Logger } from "@liwa/brain-shared";

import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
} from "@liwa/brain-shared/paseo/agent/provider-launch-config";
import type { ProviderProcessHost } from "@liwa/brain";
import {
  ACPAgentClient,
  type ACPCatalogModelResolver,
  type ACPClientCapabilityMeta,
  type ACPConfigFeatureOption,
  DEFAULT_ACP_CAPABILITIES,
  type ACPExtensionCommandsParser,
} from "./acp-agent.ts";
import {
  buildBinaryDiagnosticRows,
  formatProviderDiagnostic,
  type DiagnosticEntry,
  toDiagnosticErrorMessage,
} from "@liwa/brain-shared/paseo/agent/providers/diagnostic-utils";

interface GenericACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  usageProvider?: string;
  waitForInitialCommands?: boolean;
  initialCommandsWaitTimeoutMs?: number;
  diagnosticPhaseTimeoutMs?: number;
  clientCapabilityMeta?: ACPClientCapabilityMeta;
  configFeatureOptions?: ACPConfigFeatureOption[];
  extensionCommandsParser?: ACPExtensionCommandsParser;
  /** 灵鲸改：extensionCommandsParser 要收的扩展通知方法名。 */
  extensionNotificationMethods?: readonly string[];
  catalogModelResolver?: ACPCatalogModelResolver;
  now?: () => number;
  /** 灵鲸改：探测与诊断拉进程用的入口（ctx.subprocess）。 */
  processHost: ProviderProcessHost;
}

export class GenericACPAgentClient extends ACPAgentClient {
  private readonly command: [string, ...string[]];
  private readonly providerId?: string;
  private readonly label?: string;
  private readonly diagnosticPhaseTimeoutMs?: number;

  constructor(options: GenericACPAgentClientOptions) {
    super({
      provider: "acp",
      usageProvider: options.usageProvider,
      logger: options.logger,
      runtimeSettings: {
        env: options.env,
      },
      defaultCommand: options.command,
      capabilities: DEFAULT_ACP_CAPABILITIES,
      // ACP agents advertise slash commands with available_commands_update after
      // session/new, so the first listCommands() waits for that batch.
      waitForInitialCommands: options.waitForInitialCommands ?? true,
      initialCommandsWaitTimeoutMs: options.initialCommandsWaitTimeoutMs,
      clientCapabilityMeta: options.clientCapabilityMeta,
      configFeatureOptions: options.configFeatureOptions,
      extensionCommandsParser: options.extensionCommandsParser,
      extensionNotificationMethods: options.extensionNotificationMethods,
      catalogModelResolver: options.catalogModelResolver,
      now: options.now,
      processHost: options.processHost,
    });

    this.command = options.command;
    this.providerId = options.providerId;
    this.label = options.label;
    this.diagnosticPhaseTimeoutMs = options.diagnosticPhaseTimeoutMs;
  }

  protected override async resolveLaunchCommand(): Promise<{ command: string; args: string[] }> {
    return {
      command: this.command[0],
      args: this.command.slice(1),
    };
  }

  override async isAvailable(): Promise<boolean> {
    const launch = await this.resolveConfiguredLaunch();
    const availability = await checkProviderLaunchAvailable(launch, this.processHost);
    return availability.available;
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    const providerName = formatProviderName(this.label, this.providerId);
    const entries: DiagnosticEntry[] = [
      { label: "Provider ID", value: this.providerId ?? "unknown" },
      { label: "Configured command", value: this.command.join(" ") },
    ];
    const versionProbe = buildVersionProbeCommand(this.command);

    try {
      const launch = await this.resolveConfiguredLaunch();
      const availability = await checkProviderLaunchAvailable(launch, this.processHost);
      entries.push(
        ...(await buildBinaryDiagnosticRows(this.processHost, launch, availability, {
          binaryLabel: "Launcher binary",
          versionCommand: {
            command: versionProbe.command,
            args: versionProbe.args,
            env: this.runtimeSettings?.env,
          },
        })),
      );
    } catch (error) {
      entries.push({
        label: "Launcher binary",
        value: `error: ${toDiagnosticErrorMessage(error)}`,
      });
    }

    entries.push(
      {
        label: "Version command",
        value: formatCommand(versionProbe.command, versionProbe.args),
      },
      ...(await this.getACPProbeRowsForDiagnostic()),
    );

    return {
      diagnostic: formatProviderDiagnostic(providerName, entries),
    };
  }

  private async resolveConfiguredLaunch() {
    return resolveProviderLaunch({
      commandConfig: { mode: "replace", argv: this.command },
      defaultBinary: this.command[0],
    });
  }

  private async getACPProbeRowsForDiagnostic() {
    try {
      return await this.buildACPProbeDiagnosticRows({
        phaseTimeoutMs: this.diagnosticPhaseTimeoutMs,
      });
    } catch (error) {
      return [
        {
          label: "ACP probe",
          value: `error: ${toDiagnosticErrorMessage(error)}`,
        },
      ];
    }
  }
}

export interface CommandInvocation {
  command: string;
  args: string[];
}

function formatProviderName(label: string | undefined, providerId: string | undefined): string {
  if (label) {
    return `${label} (ACP)`;
  }
  if (providerId) {
    return `${providerId} (ACP)`;
  }
  return "Custom ACP";
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

export function buildVersionProbeCommand(command: [string, ...string[]]): CommandInvocation {
  const [launcher, ...args] = command;
  if (isPackageRunner(launcher)) {
    return {
      command: launcher,
      args: [...takePackageRunnerPrefix(args), "--version"],
    };
  }

  return {
    command: launcher,
    args: ["--version"],
  };
}

function isPackageRunner(command: string): boolean {
  return ["npx", "bunx", "pnpm", "uvx"].includes(command);
}

function takePackageRunnerPrefix(args: string[]): string[] {
  if (args.length === 0) {
    return [];
  }
  if (args[0] === "dlx") {
    return ["dlx", ...takePackageSpecPrefix(args.slice(1))];
  }
  return takePackageSpecPrefix(args);
}

function takePackageSpecPrefix(args: string[]): string[] {
  const prefix: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    prefix.push(arg);
    if (arg === "--package" || arg === "-p") {
      if (args[index + 1]) {
        prefix.push(args[index + 1]);
        index += 1;
      }
      continue;
    }
    if (!arg.startsWith("-")) {
      break;
    }
  }
  return prefix;
}
