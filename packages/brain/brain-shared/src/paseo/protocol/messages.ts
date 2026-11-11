// 来源：paseo-upstream@8018231a packages/protocol/src/messages.ts；Apache-2.0，灵鲸改见 NOTICE。

// 灵鲸改：仅抽取冻结的 agent 协议公开导出与私有 schema 闭包，FirstAgentContext 只留 prompt。

import { z } from "zod";

import { AGENT_LIFECYCLE_STATUSES } from "./agent-lifecycle.ts";


import { TOOL_CALL_ICON_NAMES } from "./agent-types.ts";

import type { AgentCapabilityFlags, AgentMode, AgentPermissionRequest, AgentPermissionResponse, AgentPersistenceHandle, AgentRuntimeInfo, ToolCallDetail, AgentUsage } from "./agent-types.ts";

const AgentProviderSchema = z.string();

export const AgentStatusSchema = z.enum(AGENT_LIFECYCLE_STATUSES);

const AgentModeSchema: z.ZodType<AgentMode> = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  colorTier: z.string().optional(),
});

const AgentSelectOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const AgentFeatureToggleSchema = z.object({
  type: z.literal("toggle"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  icon: z.string().optional(),
  value: z.boolean(),
});

export const AgentFeatureSelectSchema = z.object({
  type: z.literal("select"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  icon: z.string().optional(),
  desktopTrigger: z.enum(["icon", "label"]).optional(),
  value: z.string().nullable(),
  options: z.array(AgentSelectOptionSchema),
});

export const AgentFeatureSchema = z.discriminatedUnion("type", [
  AgentFeatureToggleSchema,
  AgentFeatureSelectSchema,
]);

const AgentCapabilityFlagsSchema: z.ZodType<AgentCapabilityFlags> = z
  .object({
    supportsStreaming: z.boolean(),
    supportsSessionPersistence: z.boolean(),
    supportsSessionListing: z.boolean().optional(),
    supportsDynamicModes: z.boolean(),
    supportsMcpServers: z.boolean(),
    supportsReasoningStream: z.boolean(),
    supportsToolInvocations: z.boolean(),
    // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
    supportsRewindConversation: z.boolean().optional().default(false),
    // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
    supportsRewindFiles: z.boolean().optional().default(false),
    // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
    supportsRewindBoth: z.boolean().optional().default(false),
  })
  .catchall(z.boolean());

const AgentUsageSchema: z.ZodType<AgentUsage> = z.object({
  inputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
  contextWindowMaxTokens: z.number().optional(),
  contextWindowUsedTokens: z.number().optional(),
});

const AgentPermissionUpdateSchema = z.record(z.string(), z.unknown());

const AgentPermissionActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  behavior: z.enum(["allow", "deny"]),
  variant: z.enum(["primary", "secondary", "danger"]).optional(),
  intent: z.enum(["implement", "implement_resume", "dismiss"]).optional(),
});

export const AgentPermissionResponseSchema: z.ZodType<AgentPermissionResponse> =
  z.discriminatedUnion("behavior", [
    z.object({
      behavior: z.literal("allow"),
      selectedActionId: z.string().optional(),
      updatedInput: z.record(z.string(), z.unknown()).optional(),
      updatedPermissions: z.array(AgentPermissionUpdateSchema).optional(),
    }),
    z.object({
      behavior: z.literal("deny"),
      selectedActionId: z.string().optional(),
      message: z.string().optional(),
      interrupt: z.boolean().optional(),
    }),
  ]);

export const AgentPermissionRequestPayloadSchema: z.ZodType<AgentPermissionRequest, unknown> =
  z.object({
    id: z.string(),
    provider: AgentProviderSchema,
    name: z.string(),
    kind: z.enum(["tool", "plan", "question", "mode", "other"]),
    title: z.string().optional(),
    description: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    detail: z.lazy(() => ToolCallDetailPayloadSchema).optional(),
    suggestions: z.array(AgentPermissionUpdateSchema).optional(),
    actions: z.array(AgentPermissionActionSchema).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  });

const UnknownValueSchema = z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.unknown()),
  z.object({}).passthrough(),
]);

const WorktreeSetupCommandSnapshotSchema = z.object({
  index: z.number().int().positive(),
  command: z.string(),
  cwd: z.string(),
  log: z.string().optional().default(""),
  status: z.enum(["running", "completed", "failed"]),
  exitCode: z.number().nullable(),
  durationMs: z.number().nonnegative().optional(),
});

const WorktreeSetupDetailPayloadSchema = z.object({
  type: z.literal("worktree_setup"),
  worktreePath: z.string(),
  branchName: z.string(),
  log: z.string(),
  commands: z.array(WorktreeSetupCommandSnapshotSchema),
  truncated: z.boolean().optional(),
});

const ToolCallDetailPayloadSchema: z.ZodType<ToolCallDetail, unknown> = z.discriminatedUnion(
  "type",
  [
    WorktreeSetupDetailPayloadSchema,
    z.object({
      type: z.literal("shell"),
      command: z.string(),
      cwd: z.string().optional(),
      output: z.string().optional(),
      exitCode: z.number().nullable().optional(),
    }),
    z.object({
      type: z.literal("read"),
      filePath: z.string(),
      content: z.string().optional(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    }),
    z.object({
      type: z.literal("edit"),
      filePath: z.string(),
      oldString: z.string().optional(),
      newString: z.string().optional(),
      unifiedDiff: z.string().optional(),
    }),
    z.object({
      type: z.literal("write"),
      filePath: z.string(),
      content: z.string().optional(),
    }),
    z.object({
      type: z.literal("search"),
      query: z.string(),
      toolName: z.enum(["search", "grep", "glob", "web_search"]).optional(),
      content: z.string().optional(),
      filePaths: z.array(z.string()).optional(),
      webResults: z
        .array(
          z.object({
            title: z.string(),
            url: z.string(),
          }),
        )
        .optional(),
      annotations: z.array(z.string()).optional(),
      numFiles: z.number().optional(),
      numMatches: z.number().optional(),
      durationMs: z.number().optional(),
      durationSeconds: z.number().optional(),
      truncated: z.boolean().optional(),
      mode: z.enum(["content", "files_with_matches", "count"]).optional(),
    }),
    z.object({
      type: z.literal("fetch"),
      url: z.string(),
      prompt: z.string().optional(),
      result: z.string().optional(),
      code: z.number().optional(),
      codeText: z.string().optional(),
      bytes: z.number().optional(),
      durationMs: z.number().optional(),
    }),
    z.object({
      type: z.literal("sub_agent"),
      subAgentType: z.string().optional(),
      description: z.string().optional(),
      childSessionId: z.string().optional(),
      // COMPAT(subagent-log): added in v0.14.1, remove after 2027-04-30. A sub-agent card is a
      // launch marker; apps before v0.14.1 required `log`, so daemons still send it empty.
      log: z.string().optional(),
      // Compat cruft for clients <= 0.1.65-beta.3 that required this field. Producers still
      // emit `[]`; nothing reads it. Drop the field (and the `[]` emissions) once those
      // clients are no longer in the field.
      actions: z
        .array(
          z.object({
            index: z.number().int().positive(),
            toolName: z.string(),
            summary: z.string().optional(),
          }),
        )
        .optional(),
    }),
    z.object({
      type: z.literal("plain_text"),
      label: z.string().optional(),
      text: z.string().optional(),
      icon: z.enum(TOOL_CALL_ICON_NAMES).optional(),
    }),
    z.object({
      type: z.literal("plan"),
      text: z.string(),
    }),
    z.object({
      type: z.literal("unknown"),
      input: UnknownValueSchema,
      output: UnknownValueSchema,
    }),
  ],
);

const AgentPersistenceHandleSchema: z.ZodType<AgentPersistenceHandle | null> = z
  .object({
    provider: AgentProviderSchema,
    sessionId: z.string(),
    nativeHandle: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .nullable();

const AgentRuntimeInfoSchema: z.ZodType<AgentRuntimeInfo> = z.object({
  provider: AgentProviderSchema,
  sessionId: z.string().nullable(),
  model: z.string().nullable().optional(),
  thinkingOptionId: z.string().nullable().optional(),
  modeId: z.string().nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

const AgentActiveTurnPayloadSchema = z.object({
  turnId: z.string(),
  startedAt: z.string().nullable(),
});

export const AgentSnapshotPayloadSchema = z.object({
  id: z.string(),
  provider: AgentProviderSchema,
  cwd: z.string(),
  workspaceId: z.string().optional(),
  model: z.string().nullable(),
  features: z.array(AgentFeatureSchema).optional(),
  thinkingOptionId: z.string().nullable().optional(),
  effectiveThinkingOptionId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUserMessageAt: z.string().nullable(),
  status: AgentStatusSchema,
  activeTurn: AgentActiveTurnPayloadSchema.nullable().optional(),
  capabilities: AgentCapabilityFlagsSchema,
  currentModeId: z.string().nullable(),
  availableModes: z.array(AgentModeSchema),
  pendingPermissions: z.array(AgentPermissionRequestPayloadSchema),
  persistence: AgentPersistenceHandleSchema.nullable(),
  runtimeInfo: AgentRuntimeInfoSchema.optional(),
  lastUsage: AgentUsageSchema.optional(),
  lastError: z.string().optional(),
  title: z.string().nullable(),
  labels: z.record(z.string(), z.string()).default({}),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  providerUnavailable: z.boolean().optional(),
  // Private helper marker, retained for exact-ID snapshots and older wire messages.
  internal: z.boolean().optional(),
});

export type AgentSnapshotPayload = z.infer<typeof AgentSnapshotPayloadSchema>;

export const AgentListItemPayloadSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  title: z.string().nullable(),
  provider: AgentProviderSchema,
  model: z.string().nullable(),
  thinkingOptionId: z.string().nullable().optional(),
  effectiveThinkingOptionId: z.string().nullable().optional(),
  status: AgentStatusSchema,
  cwd: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUserMessageAt: z.string().nullable(),
  archivedAt: z.string().nullable().optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  providerUnavailable: z.boolean().optional(),
});

export type AgentListItemPayload = z.infer<typeof AgentListItemPayloadSchema>;

export const ActiveTurnBehaviorSchema = z.enum(["interrupt", "steer"]);

export type ActiveTurnBehavior = z.infer<typeof ActiveTurnBehaviorSchema>;

export const FirstAgentContextSchema = z.object({
  prompt: z.string().optional(),
});

export const HubExecutionAgentValidationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

export type HubExecutionAgentValidationIssue = z.infer<
  typeof HubExecutionAgentValidationIssueSchema
>;

export type FirstAgentContext = z.infer<typeof FirstAgentContextSchema>;
