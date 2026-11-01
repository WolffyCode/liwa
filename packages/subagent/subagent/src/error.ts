/**
 * Typed failures shared by subagent service and provider operations.
 *
 * @module @liwa/subagent
 */

import { LiwaError } from '@liwa/llm'

/** Typed failure for the subagent seam. */
export class SubagentError extends LiwaError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'SubagentError'
  }
}
