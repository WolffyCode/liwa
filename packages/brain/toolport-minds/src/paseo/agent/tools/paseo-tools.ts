// 来源：paseo-upstream@8018231a packages/server/src/server/agent/tools/paseo-tools.ts；Apache-2.0，灵鲸改见 NOTICE。

import type { FinishSubscriptions } from "@liwa/minds/paseo/agent/finish-subscriptions/index";
import type { AgentMessageDelivery } from "@liwa/minds/paseo/agent/agent-messages/index";

import { AgentDirectory } from "@liwa/minds/paseo/agent/directory";

import { z } from "zod";
import { ensureValidJson } from "@liwa/minds/paseo/json-utils";
import type { PaseoLogger as Logger } from "@liwa/brain-shared";

import type { AgentMode, AgentProvider, AgentSessionConfig } from "@liwa/brain-shared/paseo/agent/agent-sdk-types";
import type { AgentManager } from "@liwa/minds/paseo/agent/agent-manager";
import { ActiveTurnBehaviorSchema } from "@liwa/brain-shared/paseo/protocol/messages";
import { AgentFeatureSchema, AgentPermissionRequestPayloadSchema, AgentListItemPayloadSchema, AgentPermissionResponseSchema, AgentSnapshotPayloadSchema } from "@liwa/brain-shared/paseo/protocol/messages";
import { buildStoredAgentPayload, selectAgentListItems, toAgentPayload } from "@liwa/minds/paseo/agent/agent-projections";
import { summarizeAgentActivity } from "@liwa/minds/paseo/agent/activity-curator";
import type { AgentStorage } from "@liwa/minds/paseo/agent/agent-storage";
import { AgentNotFoundError, ensureAgentLoaded } from "@liwa/minds/paseo/agent/agent-loading";
import { isStoredAgentProviderAvailable } from "@liwa/minds/paseo/persistence-hooks";

import { createAgentCommand } from "@liwa/minds/paseo/agent/create-agent/create";

import { expandUserPath, resolvePathFromBase } from "@liwa/minds/paseo/path-utils";

import type { ProviderSnapshotManager } from "@liwa/minds/paseo/agent/provider-snapshot-manager";
import { AgentModelSchema, AgentProviderEnum, AgentStatusEnum, ProviderModeSchema, ProviderSummarySchema, resolveRequiredProviderModel, sanitizePermissionRequest, serializeSnapshotWithMetadata } from "@liwa/minds/paseo/agent/mcp-shared";
import { type PromptDispatchDisposition, sendPromptToAgent, waitForAgentRunStartWithTimeout } from "@liwa/minds/paseo/agent/agent-prompt";
import { respondToAgentPermission } from "@liwa/minds/paseo/agent/permission-response";
import { archiveAgentCommand, cancelAgentRunCommand, closeAgentCommand, setAgentModeCommand, updateAgentCommand } from "@liwa/minds/paseo/agent/lifecycle-command";

import { PaseoToolInputError, type PaseoToolCatalog, type PaseoToolConfig, type PaseoToolDefinition, type PaseoToolExecutionContext, type PaseoToolResult } from "@liwa/brain-shared/paseo/agent/tools/types";
import type { ProviderPaseoToolsPolicy } from "@liwa/brain-shared/paseo/protocol/provider-config";
import { isPaseoToolEnabled } from "@liwa/brain-shared/paseo/agent/paseo-tool-policy";

export interface PaseoToolHostDependencies {
  agentMessages?: () => AgentMessageDelivery;
  finishSubscriptions?: () => FinishSubscriptions;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  providerSnapshotManager: ProviderSnapshotManager;
  paseoToolPolicy?: ProviderPaseoToolsPolicy;
  callerAgentId?: string;
  resolveCallerContext?: (callerAgentId: string) => {
    lockedCwd?: string; allowCustomCwd?: boolean; childAgentDefaultLabels?: Record<string, string>;
  } | null;
  logger: Logger;
}

interface ProviderSummary {
  id: AgentProvider;
  label: string;
  description: string;
  enabled: boolean;
  modes: AgentMode[];
  status: string;
  error?: string;
}

function toProviderSummary(entry: {
  provider: AgentProvider;
  label?: string;
  description?: string;
  enabled: boolean;
  modes?: AgentMode[];
  status: string;
  error?: string;
}): ProviderSummary {
  return {
    id: entry.provider,
    label: entry.label ?? entry.provider,
    description: entry.description ?? "",
    enabled: entry.enabled,
    modes: entry.modes ?? [],
    status: entry.status === "ready" ? "available" : entry.status,
    ...(entry.error ? { error: entry.error } : {}),
  };
}

function resolveProviderAndModel(params: {
  provider?: string;
  defaultProvider: AgentProvider;
}): { provider: AgentProvider; model?: string } {
  const providerInput = params.provider?.trim() || params.defaultProvider;
  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return { provider: providerInput };
  }

  const provider = providerInput.slice(0, slashIndex).trim();
  const model = providerInput.slice(slashIndex + 1).trim();
  if (!provider || !model) {
    throw new PaseoToolInputError("provider must be <provider> or <provider>/<model>");
  }

  return {
    provider: provider,
    model,
  };
}

function parseToolArguments<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new PaseoToolInputError(result.error.message, result.error.issues);
  }
  return result.data;
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

export function createPaseoToolCatalog(options: PaseoToolHostDependencies): PaseoToolCatalog {
  return createToolCatalog(options, options.callerAgentId ? "agent" : "top-level");
}

export function createPaseoAgentToolManifest(
  options: PaseoToolHostDependencies,
): Pick<PaseoToolCatalog, "tools"> {
  // Plugins register before a caller exists, but every execution uses an agent-bound catalog.
  return { tools: createToolCatalog(options, "agent").tools };
}

function createToolCatalog(
  options: PaseoToolHostDependencies,
  scope: "agent" | "top-level",
): PaseoToolCatalog {
  const {
    agentManager,
    agentStorage,
    providerSnapshotManager,
    callerAgentId,
    resolveCallerContext,
    logger,
  } = options;
  const childLogger = logger.child({ module: "agent", component: "paseo-tool-catalog" });
  const callerContext = callerAgentId ? (resolveCallerContext?.(callerAgentId) ?? null) : null;

  const parseToolInput = async (tool: PaseoToolDefinition, input: unknown): Promise<unknown> => {
    const inputSchema = tool.inputSchema;
    if (!inputSchema) {
      return input;
    }
    const schema =
      typeof inputSchema === "object" &&
      inputSchema !== null &&
      typeof (inputSchema as { safeParseAsync?: unknown }).safeParseAsync === "function"
        ? (inputSchema as z.ZodType)
        : z.object(inputSchema as z.ZodRawShape).passthrough();
    const result = await schema.safeParseAsync(input);
    if (!result.success) {
      throw new PaseoToolInputError(result.error.message, result.error.issues);
    }
    return result.data;
  };

  function agentMessages(): AgentMessageDelivery {
    if (!options.agentMessages) throw new Error("Agent message delivery is not configured");
    return options.agentMessages();
  }




  const tools = new Map<string, PaseoToolDefinition>();



  const registerTool = <S extends z.ZodRawShape | z.ZodType>(
    name: string, config: Omit<PaseoToolConfig, "inputSchema"> & { inputSchema: S },
    handler: (input: S extends z.ZodType ? z.infer<S> : S extends z.ZodRawShape ? z.infer<z.ZodObject<S>> : never,
      context: PaseoToolExecutionContext) => Promise<PaseoToolResult>,
  ) => {
    if (!isPaseoToolEnabled(options.paseoToolPolicy, name)) return;
    tools.set(name, {
      name, title: config.title, description: config.description ?? name,
      inputSchema: config.inputSchema, outputSchema: config.outputSchema,
      handler: handler as PaseoToolDefinition["handler"],
    });
  };
  const toCatalog = (): PaseoToolCatalog => ({
    tools,
    getTool(name: string): PaseoToolDefinition | undefined {
      return tools.get(name);
    },
    async executeTool(
      name: string,
      input: unknown,
      context: PaseoToolExecutionContext = {},
    ): Promise<PaseoToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        throw new PaseoToolInputError(`Paseo tool not found: ${name}`);
      }
      return tool.handler(await parseToolInput(tool, input), context);
    },
  });

  const resolveCallerAgent = () => {
    if (!callerAgentId) {
      return null;
    }
    const parentAgent = agentManager.getAgent(callerAgentId);
    if (!parentAgent) {
      throw new PaseoToolInputError(`Parent agent ${callerAgentId} not found`);
    }
    return parentAgent;
  };

  const resolveInheritedProviderConfig = (
    selectedProvider: string,
  ): Pick<AgentSessionConfig, "providerOptions"> | undefined => {
    const callerAgent = resolveCallerAgent();
    if (callerAgent?.provider !== selectedProvider || !callerAgent.config?.providerOptions) {
      return undefined;
    }
    return { providerOptions: callerAgent.config.providerOptions };
  };

  const resolveScopedCwd = (requestedCwd?: string, opts?: { required?: boolean }): string => {
    const callerAgent = resolveCallerAgent();
    if (callerAgent) {
      return resolveChildAgentCwd({
        parentCwd: callerAgent.cwd,
        requestedCwd,
        lockedCwd: callerContext?.lockedCwd,
        allowCustomCwd: callerContext?.allowCustomCwd ?? true,
      });
    }

    const trimmedCwd = requestedCwd?.trim();
    if (!trimmedCwd) {
      if (opts?.required) {
        throw new PaseoToolInputError("cwd is required");
      }
      throw new PaseoToolInputError("cwd is required outside an agent-scoped session");
    }

    return expandUserPath(trimmedCwd);
  };

  const ProviderModelInputSchema = AgentProviderEnum.trim()
    .refine((value) => value.includes("/"), {
      message: "provider must be provider/model, for example codex/gpt-5.4",
    })
    .refine(
      (value) => {
        if (!value.includes("/")) {
          return true;
        }
        try {
          resolveRequiredProviderModel(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: "provider must be provider/model, for example codex/gpt-5.4" },
    );
  const ProviderOrProviderModelInputSchema = AgentProviderEnum.trim()
    .min(1, "provider is required")
    .refine(
      (value) => {
        if (!value.includes("/")) {
          return true;
        }
        try {
          resolveRequiredProviderModel(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: "provider must be provider or provider/model, for example codex/gpt-5.4" },
    );
  const CreateAgentSettingsInputSchema = z
    .object({
      modeId: z.string().optional().describe("Session mode to configure before the first run."),
      thinkingOptionId: z.string().optional().describe("Thinking option ID."),
      features: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Provider-specific feature values, for example { fast_mode: true } for Codex."),
    })
    .strict();
  const UpdateAgentSettingsInputSchema = z
    .object({
      modeId: z.string().optional().describe("Session mode ID."),
      model: z.string().nullable().optional().describe("Model ID. Pass null to clear."),
      thinkingOptionId: z
        .string()
        .nullable()
        .optional()
        .describe("Thinking option ID. Pass null to clear."),
      features: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Provider-specific feature values, for example { fast_mode: true } for Codex."),
    })
    .strict();
  const InspectProviderSettingsInputSchema = z
    .object({
      modeId: z.string().optional().describe("Draft session mode ID."),
      model: z.string().optional().describe("Draft model ID."),
      thinkingOptionId: z.string().optional().describe("Draft thinking option ID."),
      features: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Draft provider feature values."),
    })
    .strict();


  const commonCreateAgentFields = {
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(60, "Title must be 60 characters or fewer")
      .describe("Short descriptive title (<= 60 chars) summarizing the agent's focus."),
    provider: ProviderModelInputSchema.describe(
      "Required provider/model pair, for example codex/gpt-5.4.",
    ),
    labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
    settings: CreateAgentSettingsInputSchema.optional().describe(
      "Initial runtime settings for the new agent.",
    ),
    initialPrompt: z
      .string()
      .trim()
      .min(1, "initialPrompt is required")
      .describe("Required first task to run immediately after creation."),
  };

  // 灵鲸改：创建不访问工作区登记表，cwd 由调用方直接给出或继承。
  const canonicalCreateAgentFields = {
    ...commonCreateAgentFields, cwd: z.string().optional().describe("Working directory; defaults to the caller cwd."),
  };
  const agentToAgentInputSchema = {
    ...canonicalCreateAgentFields,
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Get notified when the created agent finishes, errors, or needs permission. Set false for explicit reporting or no completion callback.",
      ),
  };
  const canonicalTopLevelInputSchema = {
    ...canonicalCreateAgentFields,
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Agent-scoped only: get notified when the created agent finishes, errors, or needs permission.",
      ),
  };


  const createAgentInputSchema = z
    .object(scope === "agent" ? agentToAgentInputSchema : canonicalTopLevelInputSchema)
    .passthrough();
  const agentToAgentCreateAgentArgsSchema = z.object(agentToAgentInputSchema).strict();

  const canonicalTopLevelCreateAgentArgsSchema = z.object(canonicalTopLevelInputSchema).strict();

  const commonSendAgentPromptInputSchema = {
    activeTurnBehavior: ActiveTurnBehaviorSchema.optional().describe(
      'How to send into a running turn: "steer" joins it, falling back to interrupt when unavailable; "interrupt" replaces it. Defaults to steer for agent callers and interrupt otherwise.',
    ),
    agentId: z.string(),
    prompt: z.string(),
    sessionMode: z.string().optional().describe("Optional mode to set before running the prompt."),
  };
  const agentToAgentSendAgentPromptInputSchema = {
    ...commonSendAgentPromptInputSchema,
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Get notified when the prompted agent finishes, errors, or needs permission. Set false for explicit reporting or no completion callback.",
      ),
  };
  const topLevelSendAgentPromptInputSchema = {
    ...commonSendAgentPromptInputSchema,
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Agent-scoped only: get notified when the prompted agent finishes, errors, or needs permission.",
      ),
  };
  const sendAgentPromptInputSchema =
    scope === "agent" ? agentToAgentSendAgentPromptInputSchema : topLevelSendAgentPromptInputSchema;
  const inspectProviderInputSchema = {
    provider: ProviderOrProviderModelInputSchema.describe(
      "Provider ID, optionally with a model ID (for example codex or codex/gpt-5.4).",
    ),
    cwd: z
      .string()
      .optional()
      .describe("Working directory used to resolve provider feature availability."),
    settings: InspectProviderSettingsInputSchema.optional().describe(
      "Draft provider settings used to compute available features.",
    ),
  };





  registerTool(
    "create_agent",
    {
      title: "Create agent",
      description:
        "Create an agent. Agent-scoped creation inherits your cwd and creates your subagent. Top-level creation uses the requested cwd. Requires provider/model (for example codex/gpt-5.4) and an initial prompt. For a different provider, set settings.modeId from inspect_provider; omission is accepted for targets with no modes and for unattended execution supported by the target. Do not guess; call list_providers and list_models first if uncertain.",
      inputSchema: createAgentInputSchema,
      outputSchema: {
        agentId: z.string(),
        type: AgentProviderEnum,
        status: AgentStatusEnum,
        cwd: z.string(),
        workspaceId: z.string().optional(),
        currentModeId: z.string().nullable(),
        availableModes: z.array(ProviderModeSchema),
        guidance: z.string().optional(),
      },
    },
    async (args: unknown) => {
      const resolvedArgs = await resolveCreateAgentToolArgs(args);
      const { parsedArgs } = resolvedArgs;
      let notifyOnFinish: boolean;
      if (resolvedArgs.kind === "agent-scoped") {
        notifyOnFinish = parsedArgs.notifyOnFinish;
      } else {
        notifyOnFinish = resolvedArgs.parsedArgs.notifyOnFinish ?? false;
      }
      const selectedProvider = resolveRequiredProviderModel(parsedArgs.provider).provider;
      const inheritedConfig = resolveInheritedProviderConfig(selectedProvider);
      const { snapshot, initialPromptStarted } = await createAgentCommand(
        {
          agentManager,
          agentStorage,
          finishSubscriptions: options.finishSubscriptions?.(),
          logger: childLogger,
          providerSnapshotManager,
        },
        {
          kind: "mcp",
          provider: parsedArgs.provider,
          title: parsedArgs.title,
          initialPrompt: parsedArgs.initialPrompt,
          config: inheritedConfig,
          cwd: resolvedArgs.cwd,
          thinking: parsedArgs.settings?.thinkingOptionId,
          features: parsedArgs.settings?.features,
          labels: parsedArgs.labels,
          mode: parsedArgs.settings?.modeId,
          promptFailure: "throw",
          notifyOnFinish,
          detached: resolvedArgs.detached,
          callerAgentId,
          callerContext,
        },
      );

      // Return immediately for async creation.
      const currentSnapshot = agentManager.getAgent(snapshot.id) ?? snapshot;
      const guidance =
        callerAgentId && notifyOnFinish && initialPromptStarted
          ? "You will get notified when the created agent finishes, errors, or needs permission. Do not poll for status; continue with other work until the notification arrives."
          : "Creation acknowledged. Observe completion using get_agent_status/get_agent_activity or SDK/RPC subscriptions and wait APIs.";
      const response = {
        content: [],
        structuredContent: ensureValidJson({
          agentId: currentSnapshot.id,
          type: snapshot.provider,
          status: currentSnapshot.lifecycle,
          cwd: currentSnapshot.cwd,
          ...(currentSnapshot.workspaceId ? { workspaceId: currentSnapshot.workspaceId } : {}),
          currentModeId: currentSnapshot.currentModeId,
          availableModes: currentSnapshot.availableModes,
          ...(guidance ? { guidance } : {}),
        }),
      };
      return response;
    },
  );

  async function resolveCreateAgentToolArgs(args: unknown) {
    const parsedArgs = parseToolArguments(
      callerAgentId ? agentToAgentCreateAgentArgsSchema : canonicalTopLevelCreateAgentArgsSchema, args,
    );
    return { kind: callerAgentId ? "agent-scoped" : "top-level", parsedArgs,
      detached: false, cwd: parsedArgs.cwd };
  }

  const PROMPTED_AGENT_NOTIFICATION_GUIDANCE =
    "You will get notified when the prompted agent finishes, errors, or needs permission. Do not poll for status; continue with other work until the notification arrives.";

  registerTool(
    "send_agent_prompt",
    {
      title: "Send agent prompt",
      description:
        "Send a task. Agent callers receive an immediate queued receipt; delivery follows after two quiet seconds per recipient. Completion reports include the target’s last response by default. Paseo supplies caller identity.",
      inputSchema: sendAgentPromptInputSchema,
      outputSchema: {
        success: z.boolean(),
        disposition: z.enum(["turn_started", "out_of_band", "steered"]).optional(),
        deliveryStatus: z.literal("queued").optional(),
        messageId: z.string().optional(),
        status: AgentStatusEnum,
        guidance: z.string().optional(),
      },
    },
    async ({
      agentId,
      prompt,
      sessionMode,
      notifyOnFinish = Boolean(callerAgentId),
      activeTurnBehavior = callerAgentId ? "steer" : "interrupt",
    }) => {
      if (callerAgentId && !agentManager.getAgent(agentId) && !(await agentStorage.get(agentId))) {
        throw new PaseoToolInputError(`Agent ${agentId} not found`);
      }
      const notifying = Boolean(callerAgentId && notifyOnFinish);
      const notification =
        notifying && callerAgentId
          ? await (() => {
              if (!options.finishSubscriptions)
                throw new Error("Finish subscriptions are not configured");
              return options
                .finishSubscriptions()
                .register({ childAgentId: agentId, callerAgentId }, true);
            })()
          : undefined;
      function confirmDispatch(_disposition: PromptDispatchDisposition): void {
        notification?.accept();
      }
      function rejectNotification(): void {
        void notification
          ?.reject()
          .catch((error) =>
            childLogger.error(
              { err: error, agentId },
              "Failed to remove rejected finish subscription",
            ),
          );
      }

      if (callerAgentId) {
        const receipt = (() => {
          try {
            return agentMessages().enqueue({
              recipientId: agentId,
              prompt,
              source: {
                kind: "agent-message",
                agentId: callerAgentId,
                title: resolveCallerAgent()?.config.title ?? undefined,
              },
              sessionMode,
              activeTurnBehavior,
              onDispatch: confirmDispatch,
            });
          } catch (error) {
            rejectNotification();
            throw error;
          }
        })();
        void receipt.dispatched.catch(() => {
          rejectNotification();
        });
        return {
          content: [],
          structuredContent: {
            success: true,
            deliveryStatus: receipt.status,
            messageId: receipt.messageId,
            status: agentManager.getAgent(agentId)?.lifecycle ?? "idle",
            guidance: notifying
              ? `Queued for delivery after two quiet seconds. ${PROMPTED_AGENT_NOTIFICATION_GUIDANCE}`
              : "Queued for delivery after two quiet seconds; provider dispatch has not occurred.",
          },
        };
      }

      const { disposition } = await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId,
        prompt,
        source: callerAgentId ? { kind: "agent-message", agentId: callerAgentId } : undefined,
        sessionMode,
        activeTurnBehavior,
        onDispatch: confirmDispatch,
        logger: childLogger,
      }).catch((error) => {
        rejectNotification();
        if (error instanceof AgentNotFoundError) {
          throw new PaseoToolInputError(error.message);
        }
        throw error;
      });

      // Return once the provider has accepted the turn, so the status reports it running.
      if (disposition === "turn_started") {
        await waitForAgentRunStartWithTimeout(agentManager, agentId).catch((error) => {
          rejectNotification();
          throw error;
        });
      }
      const currentSnapshot = agentManager.getAgent(agentId);

      const responseData = {
        success: true,
        disposition,
        status: currentSnapshot?.lifecycle ?? "idle",
        guidance: notifying
          ? PROMPTED_AGENT_NOTIFICATION_GUIDANCE
          : "Dispatch acknowledged. Observe completion using get_agent_status/get_agent_activity or SDK/RPC subscriptions and wait APIs.",
      };
      const validJson = ensureValidJson(responseData);

      const response = {
        content: [],
        structuredContent: validJson,
      };
      return response;
    },
  );

  registerTool(
    "get_agent_status",
    {
      title: "Get agent status",
      description:
        "Return the latest snapshot for an agent, including lifecycle state, capabilities, and pending permissions.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        status: AgentStatusEnum,
        snapshot: AgentSnapshotPayloadSchema,
      },
    },
    async ({ agentId }) => {
      const snapshot = agentManager.getAgent(agentId);
      if (snapshot) {
        const structuredSnapshot = await serializeSnapshotWithMetadata(
          agentStorage,
          snapshot,
          childLogger,
        );
        return {
          content: [],
          structuredContent: ensureValidJson({
            status: snapshot.lifecycle,
            snapshot: structuredSnapshot,
          }),
        };
      }

      const record = await agentStorage.get(agentId);
      if (!record || record.internal) {
        throw new PaseoToolInputError(`Agent ${agentId} not found`);
      }

      const structuredSnapshot = buildStoredAgentPayload(
        record,
        new Set(providerSnapshotManager.listRegisteredProviderIds()),
      );
      return {
        content: [],
        structuredContent: ensureValidJson({
          status: structuredSnapshot.status,
          snapshot: structuredSnapshot,
        }),
      };
    },
  );

  registerTool(
    "list_agents",
    {
      title: "List agents",
      description: "List recent agents as compact metadata.",
      inputSchema: {
        includeArchived: z.boolean().optional().default(false),
        cwd: z.string().optional(),
        sinceHours: z
          .number()
          .int()
          .positive()
          .max(24 * 30)
          .optional()
          .default(48),
        statuses: z.array(AgentStatusEnum).optional(),
        limit: z.number().int().positive().max(200).optional().default(50),
      },
      outputSchema: {
        agents: z.array(AgentListItemPayloadSchema),
      },
    },
    async ({
      includeArchived = false,
      cwd,
      sinceHours = 48,
      statuses,
      limit = 50,
    }) => {
      const callerCwd = callerAgentId ? resolveCallerAgent()?.cwd : undefined;
      const requestedCwd = cwd?.trim() ? expandUserPath(cwd) : callerCwd;
      const directory = new AgentDirectory({
        manager: agentManager,
        storage: agentStorage,
        projectLive: (snapshot) =>
          serializeSnapshotWithMetadata(agentStorage, snapshot, childLogger),
        projectStored: (record) =>
          buildStoredAgentPayload(
            record,
            new Set(providerSnapshotManager.listRegisteredProviderIds()),
          ),
        isProviderVisible: () => true,
        isStoredProviderAvailable: (record) =>
          isStoredAgentProviderAvailable(
            record,
            new Set(providerSnapshotManager.listRegisteredProviderIds()),
          ),
      });
      const agents = selectAgentListItems(
        await directory.list({ includeArchived }),
        { cwd: requestedCwd, statuses, sinceHours, limit },
      );

      return {
        content: [],
        structuredContent: ensureValidJson({ agents }),
      };
    },
  );

  registerTool(
    "cancel_agent",
    {
      title: "Cancel agent run",
      description: "Abort the agent's current run but keep the agent alive for future tasks.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      const { cancelled } = await cancelAgentRunCommand(
        { agentManager, logger: childLogger },
        agentId,
      );
      return {
        content: [],
        structuredContent: ensureValidJson({ success: cancelled }),
      };
    },
  );

  registerTool(
    "archive_agent",
    {
      title: "Archive agent",
      description:
        "Archive an agent (soft-delete). The agent is interrupted if running and removed from the active list.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      await archiveAgentCommand(
        {
          agentManager,
          agentStorage,
          logger: childLogger,
        },
        agentId,
      );
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "kill_agent",
    {
      title: "Kill agent",
      description: "Terminate an agent session permanently.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      await closeAgentCommand({ agentManager }, agentId);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "update_agent",
    {
      title: "Update agent",
      description: "Update an agent name, labels, and/or runtime settings.",
      inputSchema: {
        agentId: z.string(),
        name: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
        settings: UpdateAgentSettingsInputSchema.optional().describe(
          "Runtime settings to apply to the agent.",
        ),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId, name, labels, settings }) => {
      if (settings?.modeId !== undefined) {
        await agentManager.setAgentMode(agentId, settings.modeId);
      }
      if (settings?.model !== undefined) {
        await agentManager.setAgentModel(agentId, settings.model);
      }
      if (settings?.thinkingOptionId !== undefined) {
        await agentManager.setAgentThinkingOption(agentId, settings.thinkingOptionId);
      }
      if (settings?.features) {
        for (const [featureId, value] of Object.entries(settings.features)) {
          await agentManager.setAgentFeature(agentId, featureId, value);
        }
      }

      await updateAgentCommand({ agentManager }, { agentId, name, labels });

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "list_providers",
    {
      title: "List providers",
      description: "List configured agent providers, availability, and their modes.",
      inputSchema: {},
      outputSchema: {
        providers: z.array(ProviderSummarySchema),
      },
    },
    async () => {
      const providers = (await providerSnapshotManager.listProviders({ wait: true })).map(
        toProviderSummary,
      );
      return {
        content: [],
        structuredContent: ensureValidJson({ providers }),
      };
    },
  );

  registerTool(
    "list_models",
    {
      title: "List models",
      description: "List models for an agent provider.",
      inputSchema: {
        provider: AgentProviderEnum,
      },
      outputSchema: {
        provider: z.string(),
        models: z.array(AgentModelSchema),
      },
    },
    async ({ provider }) => {
      const models = await providerSnapshotManager.listModels({
        provider,
        wait: true,
      });
      return {
        content: [],
        structuredContent: ensureValidJson({
          provider,
          models,
        }),
      };
    },
  );

  registerTool(
    "inspect_provider",
    {
      title: "Inspect provider",
      description:
        "Inspect compact provider capabilities for orchestration, including modes and draft feature settings. Use list_models for the full model list.",
      inputSchema: inspectProviderInputSchema,
      outputSchema: {
        provider: AgentProviderEnum,
        label: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        enabled: z.boolean(),
        status: z.string(),
        modes: z.array(ProviderModeSchema).nullish(),
        selectedModel: z.string().nullable(),
        features: z.array(AgentFeatureSchema),
      },
    },
    async ({ provider, cwd, settings }) => {
      const resolvedProviderModel = resolveProviderAndModel({
        provider,
        defaultProvider: provider,
      });
      const providerId = resolvedProviderModel.provider;
      const resolvedCwd = resolveScopedCwd(cwd, { required: true });
      const entry = await providerSnapshotManager.getProvider({
        cwd: resolvedCwd,
        provider: providerId,
        wait: true,
      });
      const summary = toProviderSummary(entry);
      if (!entry.enabled) {
        throw new PaseoToolInputError(`Provider '${providerId}' is disabled`);
      }
      if (entry.status !== "ready") {
        throw new PaseoToolInputError(entry.error ?? `Provider '${providerId}' is unavailable`);
      }
      const selectedModel = settings?.model ?? resolvedProviderModel.model;
      const features = await agentManager.listDraftFeatures({
        provider: providerId,
        cwd: resolvedCwd,
        ...(settings?.modeId ? { modeId: settings.modeId } : {}),
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(settings?.thinkingOptionId ? { thinkingOptionId: settings.thinkingOptionId } : {}),
        ...(settings?.features ? { featureValues: settings.features } : {}),
      });
      return {
        content: [],
        structuredContent: ensureValidJson({
          provider: providerId,
          label: summary.label,
          description: summary.description,
          enabled: summary.enabled,
          status: summary.status,
          modes: summary.modes,
          selectedModel: selectedModel ?? null,
          features,
        }),
      };
    },
  );

  registerTool(
    "get_agent_activity",
    {
      title: "Get agent activity",
      description: "Return recent agent timeline entries as a curated summary.",
      inputSchema: {
        agentId: z.string(),
        limit: z
          .number()
          .optional()
          .describe("Optional limit for number of activities to include (most recent first)."),
      },
      outputSchema: {
        agentId: z.string(),
        updateCount: z.number(),
        currentModeId: z.string().nullable(),
        content: z.string(),
      },
    },
    async ({ agentId, limit }) => {
      await ensureAgentLoaded(agentId, {
        agentManager,
        agentStorage,
        logger: childLogger,
      });
      const timeline = agentManager.getTimeline(agentId);
      const snapshot = agentManager.getAgent(agentId);

      return {
        content: [],
        structuredContent: ensureValidJson({
          agentId,
          ...summarizeAgentActivity(timeline, limit),
          currentModeId: snapshot?.currentModeId ?? null,
        }),
      };
    },
  );

  registerTool(
    "set_agent_mode",
    {
      title: "Set agent session mode",
      description:
        "Switch the agent's session mode (plan, bypassPermissions, read-only, auto, etc.).",
      inputSchema: {
        agentId: z.string(),
        modeId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
        newMode: z.string(),
      },
    },
    async ({ agentId, modeId }) => {
      const result = await setAgentModeCommand({ agentManager }, { agentId, modeId });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true, newMode: result.modeId }),
      };
    },
  );

  registerTool(
    "list_pending_permissions",
    {
      title: "List pending permissions",
      description:
        "Return all pending permission requests across all agents with the normalized payloads.",
      inputSchema: {},
      outputSchema: {
        permissions: z.array(
          z.object({
            agentId: z.string(),
            status: AgentStatusEnum,
            request: AgentPermissionRequestPayloadSchema,
          }),
        ),
      },
    },
    async () => {
      const permissions = agentManager.listAgents().flatMap((agent) => {
        const payload = toAgentPayload(agent);
        return payload.pendingPermissions.map((request) => ({
          agentId: agent.id,
          status: payload.status,
          request: sanitizePermissionRequest(request),
        }));
      });

      return {
        content: [],
        structuredContent: ensureValidJson({ permissions }),
      };
    },
  );

  registerTool(
    "respond_to_permission",
    {
      title: "Respond to permission",
      description:
        "Approve or deny a pending permission request with an AgentManager-compatible response payload.",
      inputSchema: {
        agentId: z.string(),
        requestId: z.string(),
        response: AgentPermissionResponseSchema,
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId, requestId, response }) => {
      await respondToAgentPermission({
        agentManager,
        agentId,
        requestId,
        response,
        logger: childLogger,
      });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  return toCatalog();
}
