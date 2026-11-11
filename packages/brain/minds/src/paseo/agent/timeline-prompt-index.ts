// 来源：paseo-upstream@8018231a packages/server/src/server/agent/timeline-prompt-index.ts；Apache-2.0，灵鲸改见 NOTICE。
import type { AgentTimelineRow } from "@liwa/brain-shared/paseo/agent/agent-timeline-store-types";

const PROMPT_PREVIEW_MAX_LENGTH = 120;

export interface TimelinePromptIndexEntry {
  seq: number;
  timestamp: string;
  preview: string;
}

export interface TimelinePromptIndex {
  epoch: string;
  prompts: TimelinePromptIndexEntry[];
}

function promptPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= PROMPT_PREVIEW_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, PROMPT_PREVIEW_MAX_LENGTH - 1)}…`;
}

export function buildTimelinePromptIndex(
  epoch: string,
  rows: readonly AgentTimelineRow[],
): TimelinePromptIndex {
  return {
    epoch,
    prompts: rows.flatMap((row) =>
      row.item.type === "user_message"
        ? [
            {
              seq: row.seq,
              timestamp: row.timestamp,
              preview: promptPreview(row.item.text),
            },
          ]
        : [],
    ),
  };
}
