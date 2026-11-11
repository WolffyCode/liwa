// 来源：paseo-upstream@8018231a packages/server/src/server/agent/create-agent/create.ts；Apache-2.0，灵鲸改见 NOTICE。
import type { FinishSubscriptions } from "../finish-subscriptions/index.ts";
import type { AgentPromptSource } from "../agent-messages/index.ts";
import type { PaseoLogger as Logger } from "@liwa/brain-shared";

import { expandUserPath, resolvePathFromBase } from "../../path-utils.ts";

import type { AgentManager, CreateAgentOptions, ManagedAgent } from "../agent-manager.ts";
import type { AgentPromptInput, AgentRunOptions, AgentSessionConfig } from "@liwa/brain-shared/paseo/agent/agent-sdk-types";
import type { AgentStorage } from "../agent-storage.ts";
import type { AgentOwner } from "../agent-owner.ts";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.ts";
import { startCreatedAgentInitialPrompt } from "../agent-prompt.ts";
import { resolveCreateAgentTitles } from "../create-agent-title.ts";
import { buildAgentPrompt } from "../prompt-attachments.ts";
import { normalizeClientMessageId, resolveClientMessageId } from "../../client-message-id.ts";
import { resolveRequiredProviderModel, type ResolvedProviderModel } from "../mcp-shared.ts";
import { resolveCreateAgentIntent } from "./intent.ts";

export interface CreateAgentCommandDependencies {
  finishSubscriptions?: FinishSubscriptions;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;



  providerSnapshotManager: Pick<ProviderSnapshotManager, "resolveCreateConfig">;


}

export interface CreateAgentFromSessionInput {
  kind: "session";
  onAgentReady?: (agent: ManagedAgent) => Promise<void>;
  agentId?: string;
  config: AgentSessionConfig;

  initialPrompt?: string;
  source?: AgentPromptSource;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: Array<{ data: string; mimeType: string }>;

  labels: Record<string, string>;
  env?: Record<string, string>;
  provisionalTitle: string | null;
}

export interface CreateAgentFromMcpInput {
  kind: "mcp";
  provider: string;
  title: string;
  initialPrompt?: string;
  config?: Partial<AgentSessionConfig>;
  cwd?: string;

  thinking?: string;
  features?: Record<string, unknown>;
  labels?: Record<string, string>;
  mode?: string;
  unattended?: boolean;
  promptFailure?: CreateAgentPromptFailureMode;
  notifyOnFinish: boolean;
  internal?: boolean;
  detached?: boolean;
  owner?: AgentOwner;
  env?: Record<string, string>;
  onCreated?: (created: {
    agentId: string;

  }) => void;

  callerAgentId?: string;
  callerContext?: {
    lockedCwd?: string;
    allowCustomCwd?: boolean;
    childAgentDefaultLabels?: Record<string, string>;
  } | null;

}

export type CreateAgentCommandInput = CreateAgentFromSessionInput | CreateAgentFromMcpInput;
export type CreateAgentPromptFailureMode = "throw" | "log" | "return-error";

export interface CreateAgentCommandResult {
  snapshot: ManagedAgent;
  liveSnapshot: ManagedAgent;
  initialPromptStarted: boolean;
  initialPromptError: unknown | null;

}

export type BoundCreateAgentCommand = (
  input: CreateAgentCommandInput,
) => Promise<CreateAgentCommandResult>;

export function formatProviderModel(provider: string, model: string | null | undefined): string {
  if (!model || provider.includes("/")) {
    return provider;
  }
  return `${provider}/${model}`;
}

function resolveProviderModel(providerValue: string): ResolvedProviderModel {
  const providerInput = providerValue.trim();
  if (providerInput.includes("/")) {
    return resolveRequiredProviderModel(providerInput);
  }
  if (!providerInput) {
    throw new Error("provider is required");
  }
  return { provider: providerInput, model: undefined };
}

interface ResolvedCreateAgent {
  config: AgentSessionConfig;
  createOptions: CreateAgentOptions;
  prompt?: AgentPromptInput;
  source?: AgentPromptSource;
  runOptions?: AgentRunOptions;
  promptFailure: CreateAgentPromptFailureMode;
  promptLogger?: Logger;

}

export async function createAgentCommand(
  dependencies: CreateAgentCommandDependencies,
  input: CreateAgentCommandInput,
): Promise<CreateAgentCommandResult> {
  const resolved =
    input.kind === "session"
      ? await resolveSessionCreateAgent(dependencies, input)
      : await resolveMcpCreateAgent(dependencies, input);

  const snapshot = await dependencies.agentManager.createAgent(
    resolved.config,
    input.kind === "session" ? input.agentId : undefined,
    resolved.createOptions,
  );

  if (input.kind === "session") await input.onAgentReady?.(snapshot);

  let liveSnapshot = snapshot;
  let initialPromptStarted = false;
  let initialPromptError: unknown | null = null;
  if (input.kind === "mcp") {
    input.onCreated?.({ agentId: snapshot.id });
  }
  const notification =
    input.kind === "mcp" &&
    input.notifyOnFinish &&
    input.callerAgentId &&
    resolved.prompt !== undefined
      ? await requireFinishSubscriptions(dependencies).register(
          {
            childAgentId: snapshot.id,
            callerAgentId: input.callerAgentId,
            requireParentOwnership: !(input.detached ?? false),
          },
          true,
        )
      : undefined;

  if (resolved.prompt !== undefined) {
    const sendResult = await sendInitialPrompt(dependencies, resolved, snapshot).catch(
      async (error) => {
        await notification?.reject();
        throw error;
      },
    );
    notification?.accept();
    initialPromptStarted = sendResult.started;
    liveSnapshot = sendResult.liveSnapshot;
    initialPromptError = sendResult.error ?? null;
  }

  return {
    snapshot,
    liveSnapshot,
    initialPromptStarted,
    initialPromptError,
  };
}

async function resolveSessionCreateAgent(
  dependencies: CreateAgentCommandDependencies,
  input: CreateAgentFromSessionInput,
): Promise<ResolvedCreateAgent> {
  const trimmedPrompt = input.initialPrompt?.trim();
  const builtSessionConfig = input.config;
  const resolvedCreateConfig = await dependencies.providerSnapshotManager.resolveCreateConfig({
    cwd: builtSessionConfig.cwd,
    provider: builtSessionConfig.provider,
    requestedMode: builtSessionConfig.modeId,
    featureValues: builtSessionConfig.featureValues,
    parent: null,
    unattended: false,
  });
  const sessionConfig: AgentSessionConfig = {
    ...builtSessionConfig,
    modeId: resolvedCreateConfig.modeId,
    featureValues: resolvedCreateConfig.featureValues,
  };
  const prompt = buildAgentPrompt(trimmedPrompt ?? "", input.images);
  const hasPromptContent = Array.isArray(prompt) ? prompt.length > 0 : prompt.length > 0;
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  const runOptions: AgentRunOptions | undefined =
    input.outputSchema || clientMessageId
      ? {
          ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
          ...(clientMessageId ? { clientMessageId } : {}),
        }
      : undefined;

  return {
    config: sessionConfig,
    createOptions: {
      labels: input.labels,
      initialPrompt: trimmedPrompt,
      env: input.env,
      initialTitle: input.provisionalTitle,
      // Paseo never persists an internal agent, so nothing could resume its
      // provider session either. Same as the daemon's own ephemeral helpers.
      ...(sessionConfig.internal ? { persistSession: false } : {}),
      workspaceId: undefined,
    },
    prompt: hasPromptContent ? prompt : undefined,
    source: input.source,
    runOptions,
    // Registration commits creation. First-turn failures belong to the created agent.
    promptFailure: "return-error",
    promptLogger: dependencies.logger.child({
      clientMessageId: resolveClientMessageId(input.clientMessageId),
    }),
  };
}

async function resolveMcpCreateAgent(
  dependencies: CreateAgentCommandDependencies,
  input: CreateAgentFromMcpInput,
): Promise<ResolvedCreateAgent> {
  const resolvedProviderModel = resolveProviderModel(input.provider);
  const provider = resolvedProviderModel.provider;
  const parentAgent = input.callerAgentId
    ? requireParentAgent(dependencies.agentManager, input.callerAgentId)
    : null;
  const cwd = resolveMcpInitialCwd(input, parentAgent);
  const resolvedCwd = cwd;
  const intent = await resolveCreateAgentIntent({
    cwd: resolvedCwd,
    caller: parentAgent
      ? { id: parentAgent.id }
      : null,
    labels: input.labels,
    childAgentDefaultLabels: input.callerContext?.childAgentDefaultLabels,
    legacyDetached: input.detached ?? false,

  });
  const resolvedCreateConfig = await resolveMcpProviderCreateConfig({
    dependencies,
    input,
    provider,
    resolvedCwd,
    parentAgent,
  });

  const trimmedPrompt = input.initialPrompt?.trim() ?? "";
  return {
    config: buildMcpSessionConfig({
      input,
      resolvedProviderModel,
      provider,
      resolvedCwd: intent.cwd,
      trimmedPrompt,
      resolvedMode: resolvedCreateConfig.modeId,
      resolvedFeatures: resolvedCreateConfig.featureValues,
    }),
    createOptions: {
      ...(Object.keys(intent.labels).length > 0 ? { labels: intent.labels } : {}),
      workspaceId: undefined,
      owner: input.owner,
      env: input.env,
    },
    prompt: trimmedPrompt ? trimmedPrompt : undefined,
    source: input.callerAgentId
      ? { kind: "agent-message", agentId: input.callerAgentId }
      : undefined,
    promptFailure: input.promptFailure ?? "log",
  };
}

function resolveMcpInitialCwd(
  input: CreateAgentFromMcpInput,
  parentAgent: ManagedAgent | null,
): string {
  if (!parentAgent) {
    return expandUserPath(input.cwd ?? process.cwd());
  }
  return resolveChildAgentCwd({
    parentCwd: parentAgent.cwd,
    requestedCwd: input.cwd,
    lockedCwd: input.callerContext?.lockedCwd,
    allowCustomCwd: input.callerContext?.allowCustomCwd ?? true,
  });
}

async function resolveMcpProviderCreateConfig(params: {
  dependencies: CreateAgentCommandDependencies;
  input: CreateAgentFromMcpInput;
  provider: string;
  resolvedCwd: string;
  parentAgent: ManagedAgent | null;
}): Promise<{ modeId?: string; featureValues?: Record<string, unknown> }> {
  const passthroughConfig = params.input.config;
  return params.dependencies.providerSnapshotManager.resolveCreateConfig({
    cwd: params.resolvedCwd,
    provider: params.provider,
    requestedMode: params.input.mode ?? passthroughConfig?.modeId,
    featureValues: params.input.features ?? passthroughConfig?.featureValues,
    parent: params.parentAgent,
    unattended: params.input.unattended ?? false,
  });
}

function buildMcpSessionConfig(params: {
  input: CreateAgentFromMcpInput;
  resolvedProviderModel: ResolvedProviderModel;
  provider: string;
  resolvedCwd: string;
  trimmedPrompt: string;
  resolvedMode?: string;
  resolvedFeatures?: Record<string, unknown>;
}): AgentSessionConfig {
  const passthroughConfig = params.input.config;
  const { provisionalTitle } = resolveCreateAgentTitles({
    configTitle: passthroughConfig?.title ?? params.input.title,
    initialPrompt: params.trimmedPrompt,
  });
  const featureValues = params.resolvedFeatures ?? passthroughConfig?.featureValues;
  const config: AgentSessionConfig = {
    ...passthroughConfig,
    provider: params.provider,
    cwd: params.resolvedCwd,
    modeId: params.resolvedMode ?? passthroughConfig?.modeId,
    model: params.resolvedProviderModel.model ?? passthroughConfig?.model,
    thinkingOptionId: params.input.thinking ?? passthroughConfig?.thinkingOptionId,
    internal: params.input.internal ?? passthroughConfig?.internal,
  };
  if (provisionalTitle) {
    config.title = provisionalTitle;
  }
  if (featureValues) {
    config.featureValues = featureValues;
  }
  return config;
}

async function sendInitialPrompt(
  dependencies: CreateAgentCommandDependencies,
  resolved: ResolvedCreateAgent,
  snapshot: ManagedAgent,
): Promise<{ started: boolean; liveSnapshot: ManagedAgent; error?: unknown }> {
  try {
    const prompt = resolved.prompt;
    if (prompt === undefined) {
      return { started: false, liveSnapshot: snapshot };
    }
    const liveSnapshot = await startCreatedAgentInitialPrompt({
      agentStorage: dependencies.agentStorage,
      agentManager: dependencies.agentManager,
      agentId: snapshot.id,
      snapshot,
      prompt,
      source: resolved.source,
      runOptions: resolved.runOptions,
      logger: resolved.promptLogger ?? dependencies.logger,
    });
    return { started: true, liveSnapshot };
  } catch (error) {
    if (resolved.promptFailure === "throw") {
      throw error;
    }
    if (resolved.promptFailure === "return-error") {
      return {
        started: false,
        liveSnapshot: dependencies.agentManager.getAgent(snapshot.id) ?? snapshot,
        error,
      };
    }
    dependencies.logger.error({ err: error, agentId: snapshot.id }, "Failed to run initial prompt");
    return { started: false, liveSnapshot: snapshot };
  }
}

function requireParentAgent(agentManager: AgentManager, parentAgentId: string): ManagedAgent {
  const parentAgent = agentManager.getAgent(parentAgentId);
  if (!parentAgent) {
    throw new Error(`Parent agent ${parentAgentId} not found`);
  }
  return parentAgent;
}

function resolveChildAgentCwd(params: {
  parentCwd: string;
  requestedCwd?: string;
  lockedCwd?: string;
  allowCustomCwd: boolean;
}): string {
  const lockedCwd = params.lockedCwd?.trim();
  if (lockedCwd) {
    return expandUserPath(lockedCwd);
  }

  const requestedCwd = params.requestedCwd?.trim();
  if (!requestedCwd || !params.allowCustomCwd) {
    return params.parentCwd;
  }

  return resolvePathFromBase(params.parentCwd, requestedCwd);
}

function requireFinishSubscriptions(
  dependencies: CreateAgentCommandDependencies,
): FinishSubscriptions {
  if (!dependencies.finishSubscriptions) throw new Error("Finish subscriptions are not configured");
  return dependencies.finishSubscriptions;
}
