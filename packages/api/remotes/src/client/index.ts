/** Platform-neutral assembly of generated Host Remote contributions. */

import type { Context } from '@liwa/cordis'
import productAnalyticsRemote from '@liwa/client-product-analytics/remote'
export type {} from '@liwa/client-product-analytics/remote'
import agentPresetsRemote from '@liwa/agent-preset-registry/remote'
import userQuestionsRemote from '@liwa/user-questions/remote'
import commandsRemote from '@liwa/commands/remote'
import accountRemote from '@liwa/api-account-controller/remote'
import settingsControllerRemote from '@liwa/api-settings-controller/remote'
import officeToPdfRemote from '@liwa/office-to-pdf/remote'
import goalsRemote from '@liwa/goal/remote'
import scheduleRemote from '@liwa/schedule/remote'
import llmRemote from '@liwa/llm/remote'
import dynamicRemote from '@liwa/cordis-host-runner/remote'
import pluginManagerRemote from '@liwa/plugin-manager/remote'
import toolResultsRemote from '@liwa/client-ui-trajectory/remote'
import pluginRegistryProbeRemote from '@liwa/client-ui-plugin-manager/remote'
import pluginMarketRemote from '@liwa/plugin-market/remote'
import pluginInventoryRemote from '@liwa/host-plugin-inventory/remote'
import messageFeedbackRemote from '@liwa/message-feedback/remote'
import permissionPresetsRemote from '@liwa/permission-presets/remote'
import sessionFeedbackRemote from '@liwa/command-feedback/remote'
import fileUploadsRemote from '@liwa/client-file-upload/remote'
import sessionReferencesRemote from '@liwa/session-reference/remote'
import subagentsRemote from '@liwa/subagent/remote'
import sessionRemote from '@liwa/api-session-controller/remote'
import jobRemote from '@liwa/api-job-controller/remote'
import workspaceRemote from '@liwa/api-workspace-controller/remote'
import terminalRemote from '@liwa/api-terminal-controller/remote'
import workspaceFilesRemote from '@liwa/api-workspace-files/remote'
import type { ClientRemote } from '@liwa/api-gateway/client'

export type { ClientRemote } from '@liwa/api-gateway/client'
export type {
  BundleDetail, BundleInfo, BundleRowInfo, ChangeResult, IncompatiblePlugin, InspectOptions, InstallBundleOptions, InstallSpecKind,
  ManagementError, PackageResult,
  PluginChange, PluginEntryId, PluginInfo, PluginInspectProblem, PluginInstallCancellation, PluginInstallFailureKind,
  PluginInstallLogChunk, PluginInstallProgress, PluginInstallRequestId, PluginRegistries, PluginSpecInspection,
  PluginUpdateProgress, PluginUpdateResult, PluginUpdateStep, PluginVersion, PluginVersionList, RegistryAttempt,
  ReadOnlyReason, Registry, RestartReason,
} from '@liwa/plugin-manager/types'
export type {} from '@liwa/plugin-manager/remote'
export type {} from '@liwa/client-ui-plugin-manager/remote'
export type {} from '@liwa/client-ui-trajectory/remote'
export type {} from '@liwa/plugin-market/remote'
export type {
  MarketCompatibility, MarketIndexSummary, MarketInstallation, MarketInstallationStatus, MarketListingEntry, MarketListingVersion,
  MarketQuery, MarketSearchResult, MarketSort, PluginDetail, PluginDetailDocumentId, PluginDetailOrigin,
} from '@liwa/plugin-market/types'
export type { PluginInventorySnapshot } from '@liwa/host-plugin-inventory/types'
export type {} from '@liwa/agent-preset-registry/remote'
export type {} from '@liwa/user-questions/remote'
export type {} from '@liwa/commands/remote'
export type {} from '@liwa/api-settings-controller/remote'
export type {} from '@liwa/api-account-controller/remote'
export type {} from '@liwa/goal/remote'
export type {} from '@liwa/schedule/remote'
export type {} from '@liwa/office-to-pdf/remote'
export type {} from '@liwa/llm/remote'
export type {} from '@liwa/host-plugin-inventory/remote'
export type {} from '@liwa/message-feedback/remote'
export type {} from '@liwa/permission-presets/remote'
export type {} from '@liwa/command-feedback/remote'
export type {} from '@liwa/client-file-upload/remote'
export type {} from '@liwa/session-reference/remote'
export type {} from '@liwa/subagent/remote'
export type * from '@liwa/subagent/client'
export type {} from '@liwa/api-session-controller/remote'
export type * from '@liwa/api-session-controller/types'
export type {} from '@liwa/api-job-controller/remote'
export type * from '@liwa/api-job-controller/types'
export type {} from '@liwa/api-workspace-controller/remote'
export type * from '@liwa/api-workspace-controller/types'
export type {} from '@liwa/api-workspace-files/remote'
export type * from '@liwa/api-workspace-files/types'
export type {} from '@liwa/api-terminal-controller/remote'
export type * from '@liwa/api-terminal-controller/types'
// The forwarded-event allowlist's selection seat: without it in the consumer's
// compilation face `TypertRemoteEvent` is `never` and every `$on` call fails.
export type { ApiRemoteForwardedEvent } from '../types.ts'
// The owner packages' client-safe `./types` exports supply the `Events`
// signatures `$on` hands to a listener, so a consumer reads the very
// declaration the Host emits rather than a flattened restatement of it.
export type {} from '@liwa/commands/types'
export type {} from '@liwa/cordis-host-runner/types'
export type {} from '@liwa/credentials/types'
export type {} from '@liwa/llm/types'
export type {} from '@liwa/agent-preset-registry/types'
export type {} from '@liwa/permission-presets/types'
export type {} from '@liwa/settings/types'
export type {} from '@liwa/user-approval/types'
export type {} from '@liwa/user-questions/types'
export type {} from '@liwa/api-session-controller/types'

/**
 * The carrier's Client-facing types, re-exported so a business package names one
 * assembly package instead of both this facade and the Connection plugin. Type-only:
 * the carrier's runtime values stay behind their own module edge.
 */
export type {
  ConnectionHandle, ConnectionSinks, ContentBlock,
  MessageId,
  RpcId, RpcRequest, RpcResponse, RpcResult, SessionId,
  StreamChunk,
} from '@liwa/client-connection/client'
export type {} from '@liwa/api-gateway/client'
export type {} from '@liwa/cordis-host-runner/remote'

// The payload vocabulary of the selected namespaces, re-exported so a Client
// contribution can name what it sends and receives without importing a Host
// package: this assembly is the one place both planes legitimately meet.
export type {
  ApprovalRequestId,
  CordisHalfState,
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  CordisDynamicRunMode,
  CordisInspectMethodManifest,
  CordisInspectPlatform,
  CordisInspectProviderManifest,
  CordisInspectProviderView,
  CordisInspectQueryRequest,
  CordisInspectQueryResolution,
  CordisInspectQueryResolved,
  CordisInspectRequestId,
  CordisInspectResolveAck,
  CordisRunDiagnostic,
  CordisRunStatus,
  DynamicCordisClientSource,
  DynamicCordisHostHalfResult,
  DynamicCordisInventoryRow,
  DynamicCordisInvokeResult,
  DynamicCordisPackage,
  DynamicCordisRequestResolved,
  DynamicCordisResolveAck,
  DynamicCordisRetracted,
  DynamicCordisRunRequest,
  DynamicCordisRunResolution,
  DynamicCordisRunAttempt,
  DynamicCordisRunResponse,
  DynamicCordisStopResponse,
  DynamicCordisUndefineReceipt,
  RequestRunOutcome,
} from '@liwa/cordis-host-runner/types'
// Credential state vocabulary for the credentials namespace (values never ride it).
export type { CredentialInfo } from '@liwa/credentials/types'
// Redacted namespace vocabulary for the settings namespace (secrets never ride
// it). It travels with its seam, whose `./types` the Client face already reads.
export type {
  SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
} from '@liwa/settings/types'
// Provider registry and discovery vocabulary for the llm namespace.
export type {
  LlmConfigurableProvider, LlmDiscoveredModel,
  LlmModelDiscoveryRequest, LlmNativeAuth, LlmProviderInfo,
} from '@liwa/llm/types'
// Reference-discovery result vocabulary for the fileReferences and
// sessionReferenceResolver namespaces.
export type { FileReferenceCandidate } from '@liwa/file-reference/types'
export type { SessionReferenceMentionCandidate } from '@liwa/session-reference/types'

// The Remote failure vocabulary, re-exported so business packages keep naming
// this assembly alone. Types only: a value export would make spec imports load
// this module's owner /remote artifacts; specs take RemoteError from
// liwa-client-test-runtime instead.
export type {
  RemoteErrorCode, RemoteErrorDetailsMap, RemoteFailure, RemoteResult,
} from '@liwa/typert-protocol'
export type { RemoteHostFacts } from '@liwa/api-gateway/client'

declare module '@liwa/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by this Client assembly. */
    remote: ClientRemote
  }
}

/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote']

/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const contribution of [
      productAnalyticsRemote, agentPresetsRemote, commandsRemote, settingsControllerRemote, accountRemote,
      goalsRemote, llmRemote, dynamicRemote, scheduleRemote,
      pluginInventoryRemote, pluginManagerRemote, pluginMarketRemote, pluginRegistryProbeRemote, toolResultsRemote,
      messageFeedbackRemote, sessionFeedbackRemote,
      fileUploadsRemote, sessionReferencesRemote,
      permissionPresetsRemote, subagentsRemote, sessionRemote, jobRemote, workspaceRemote, workspaceFilesRemote, terminalRemote,
      officeToPdfRemote, userQuestionsRemote,
    ]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  // Unwound in reverse mount order, so a namespace never outlives one mounted
  // after it.
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
