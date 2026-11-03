/**
 * Shared wire protocol for the Liwa SDK runtime: the
 * newline-delimited JSON-RPC stdio transport plus the named request, result,
 * and notification types both wire ends speak. The runtime server plugin
 * (`@liwa/sdk-jsonrpc-server`) serves this protocol; the SDK client
 * (`@liwa/sdk-client`) drives it.
 *
 * @module @liwa/sdk-protocol
 */

export { JsonRpcLineTransport, JsonRpcResponseError } from './transport.ts'
export type { JsonRpcTransportPeer } from './transport.ts'
export type {
  ApprovalRequestParams,
  ApprovalRequestResult,
  LiwaSdkClientRequestMap,
  LiwaSdkNotificationMap,
  LiwaSdkRequestMap,
  LiwaSdkHostRequestMap,
  InitializeParams,
  InitializeResult,
  SdkEncodedImageBlock,
  SdkPromptContentBlock,
  SdkRunStatus,
  SdkUserQuestionRequest,
  SdkUserQuestionAnswer,
  SdkUserQuestionCancelled,
  SessionEventNotification,
  SessionStatusNotification,
  SessionPromptParams,
  SessionPromptResult,
  SessionResumeParams,
  SessionWaitParams,
  SessionWorkingDirectoryParams,
  SessionWorkingDirectorySetParams,
  SessionWorkingDirectoryResult,
  SubagentFinishedNotification,
  SubagentStartedNotification,
} from './types.ts'
