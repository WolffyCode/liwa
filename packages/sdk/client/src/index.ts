/**
 * TypeScript client SDK for the Liwa runtime: spawn the
 * same-version `liwa --profile sdk` runtime as a subprocess and drive agent
 * turns over stdio JSON-RPC. `Liwa` is the high-level run API;
 * `LiwaClient` is the lower-level protocol client. A pure library — it
 * registers nothing on a Cordis context; named profiles and ordered patch
 * files customize the runtime process it spawns.
 *
 * @module @liwa/sdk-client
 */

export { Liwa, LiwaSession, validatedSessionEvent } from './api.ts'
export type { RunOptions } from './api.ts'
export {
  LiwaClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
} from './client.ts'
export type { NotificationSubscription } from './client.ts'
export { JsonRpcResponseError } from '@liwa/sdk-protocol'
export type {
  ContentBlock,
  SdkPromptContentBlock,
  SdkUserQuestionAnswer,
  SdkUserQuestionRequest,
  LiwaOptions,
  LiwaClientOptions,
  LiwaNotification,
  NotificationFilter,
  RunResult,
} from './types.ts'
