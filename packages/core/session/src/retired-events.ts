/**
 * Session events whose writers Liwa removed with its reporting and feedback plugins. Nothing appends
 * them any more, but logs written before that removal still carry them; the read path refuses an
 * unknown event that lacks the `ignorable` marker, so their vocabulary and payload shapes stay here
 * to keep those logs readable. Log-only: no projection, model history, or surface consumes them.
 * @module @liwa/session/retired-events
 */

import type { Branded } from '@liwa/brand'
import type { MessageId } from '@liwa/llm/brand'
import type { SessionId } from './types.ts'

/** One of the fixed feedback categories; the ids are durable log vocabulary. */
export type FeedbackCategory =
  | 'task-result'
  | 'instruction-following'
  | 'product-interaction'
  | 'service-stability'
  | 'resource-cost'
  | 'security-privacy-permission'
  | 'other'

/** One recorded human remark about a Session; both members may be absent. */
export interface FeedbackRecord {
  /** Free-text remark with surrounding whitespace removed; never empty when present. */
  readonly text?: string
  /** Category the human filed the remark under. */
  readonly category?: FeedbackCategory
}

/** Opaque compare-and-set token for one exact feedback item revision. */
export type MessageFeedbackVersion = Branded<'MessageFeedbackVersion'>

/** The human's overall judgment of one assistant message. */
export type MessageFeedbackRating = 'positive' | 'negative'

/** One feedback value and its opaque mutation token. */
export interface MessageFeedbackItem {
  /** Stable identity of the assistant message inside the owning Session. */
  readonly messageId: MessageId
  /** Overall positive or negative judgment. */
  readonly rating: MessageFeedbackRating
  /** Optional explanation, preserved verbatim after validation. */
  readonly note?: string
  /** Category the human filed the judgment under. */
  readonly category?: FeedbackCategory
  /** Equality-only token replaced by every material create or update. */
  readonly version: MessageFeedbackVersion
  /** Host-assigned creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the most recent material update. */
  readonly updatedAt: number
}

/** A material creation or edit, retaining its complete value. */
export interface MessageFeedbackPut {
  /** Owning Session; inherited feedback in a fork belongs to its parent. */
  readonly sessionId: SessionId
  /** Value after this mutation, including the original creation time. */
  readonly item: MessageFeedbackItem
}

/** A material deletion of one feedback item. */
export interface MessageFeedbackDelete {
  /** Session that owns the deleted feedback. */
  readonly sessionId: SessionId
  /** Message whose feedback was removed. */
  readonly messageId: MessageId
}

declare module '@liwa/session/types' {
  interface SessionEventMap {
    /**
     * One recorded human remark about this session. Log-only and independent
     * of its trigger; it never enters model context or derived history.
     */
    'feedback/record': FeedbackRecord
    /** Log-only human feedback; never enters model history. */
    'feedback/message-put': MessageFeedbackPut
    /** Log-only deletion; earlier ratings and notes remain in the log. */
    'feedback/message-delete': MessageFeedbackDelete
    /** Records that the configured endpoint accepted one Session log delivery through `throughSeq`. */
    'session-log-deepseek/delivery-accepted': {
      /** Session identity the accepted delivery carried; inherited fork markers retain the parent's id. */
      sessionId: SessionId
      /** Accepted Session format generation; absence identifies version 0. */
      sessionFormatVersion?: number
      /** Last canonical event included in the accepted request. */
      throughSeq: SessionSeq
    }
  }
}
