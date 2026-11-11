// 来源：paseo-upstream@8018231a packages/server/src/server/agent/activity-curator.ts；Apache-2.0，灵鲸改见 NOTICE。
import type { AgentTimelineItem } from "@liwa/brain-shared/paseo/agent/agent-sdk-types";
import type { AgentMessage } from "@liwa/brain-shared/paseo/protocol/agent-message";

import { isLikelyExternalToolName } from "@liwa/brain-shared/paseo/protocol/tool-name-normalization";

import { buildToolCallDisplayModel } from "@liwa/brain-shared/paseo/protocol/tool-call-display";
import { projectTimelineRows, selectItemsByProjectedLimit } from "@liwa/brain-shared/paseo/agent/timeline-projection";

const DEFAULT_MAX_ITEMS = 0;
const MAX_TOOL_INPUT_CHARS = 400;
const MAX_TOOL_SUMMARY_CHARS = 200;

interface ActivityCuratorOptions {
  maxItems?: number;
  labelAssistantMessages?: boolean;
  includeKinds?: readonly AgentTimelineItem["type"][];
  includeExternalToolInput?: boolean;
}

interface ActivityEntry {
  text: string;
}

function activityEntry(text: string): ActivityEntry {
  return { text };
}

function appendTextEntry(
  entries: ActivityEntry[],
  item: Extract<AgentTimelineItem, { type: "assistant_message" | "reasoning" }>,
  options?: ActivityCuratorOptions,
) {
  const text = item.text.trim();
  if (!text) return;
  let prefix = options?.labelAssistantMessages ? "[Assistant] " : "";
  if (item.type === "reasoning") prefix = "[Thought] ";
  entries.push(activityEntry(`${prefix}${text}`));
}

function formatToolInputJson(input: unknown): string | null {
  if (input === undefined) {
    return null;
  }
  try {
    const encoded = JSON.stringify(input);
    if (!encoded) {
      return null;
    }
    if (encoded.length <= MAX_TOOL_INPUT_CHARS) {
      return encoded;
    }
    return `${encoded.slice(0, MAX_TOOL_INPUT_CHARS)}...`;
  } catch {
    return null;
  }
}

function formatToolSummary(summary: string | undefined): string | null {
  if (typeof summary !== "string") {
    return null;
  }
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= MAX_TOOL_SUMMARY_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TOOL_SUMMARY_CHARS - 3)}...`;
}

function inputFromUnknownDetail(
  detail: Extract<AgentTimelineItem, { type: "tool_call" }>["detail"],
): unknown {
  return detail.type === "unknown" ? detail.input : null;
}

function projectForCuration(items: readonly AgentTimelineItem[]): AgentTimelineItem[] {
  const rows = items.map((item, index) => ({
    seq: index + 1,
    timestamp: "",
    item,
  }));
  return projectTimelineRows({ rows, mode: "projected" }).map((entry) => entry.item);
}

function shouldIncludeItem(item: AgentTimelineItem, options?: ActivityCuratorOptions): boolean {
  if (!options?.includeKinds) {
    return true;
  }
  return options.includeKinds.includes(item.type);
}

function formatToolCallEntry(
  item: Extract<AgentTimelineItem, { type: "tool_call" }>,
  options?: ActivityCuratorOptions,
): ActivityEntry {
  const inputJson = formatToolInputJson(inputFromUnknownDetail(item.detail));
  const display = buildToolCallDisplayModel({
    name: item.name,
    status: item.status,
    error: item.error,
    detail: item.detail,
    metadata: item.metadata,
  });
  const displayName = display.displayName;
  const summary = formatToolSummary(display.summary);
  if (
    (options?.includeExternalToolInput ?? true) &&
    isLikelyExternalToolName(item.name) &&
    inputJson
  ) {
    return activityEntry(`[${displayName}] ${inputJson}`);
  }
  return activityEntry(summary ? `[${displayName}] ${summary}` : `[${displayName}]`);
}

function appendAgentMessageEntries(entries: ActivityEntry[], message: AgentMessage) {
  // 灵鲸改：没有 Paseo 专属展示目录，直接使用消息自身的事件与发送者。
  entries.push(activityEntry(`[${message.sender.title ?? message.sender.id}] ${message.event}`));
  const body = message.text.trim();
  if (body) entries.push(activityEntry(body));
}

function curateProjectedActivityEntries(
  items: readonly AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): ActivityEntry[] {
  if (items.length === 0) {
    return [];
  }

  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
  const recentItems = maxItems > 0 && items.length > maxItems ? items.slice(-maxItems) : items;

  const entries: ActivityEntry[] = [];

  for (const item of recentItems) {
    if (!shouldIncludeItem(item, options)) {
      continue;
    }

    switch (item.type) {
      case "user_message":
        entries.push(activityEntry(`[User] ${item.text.trim()}`));
        break;
      case "assistant_message":
      case "reasoning":
        appendTextEntry(entries, item, options);
        break;
      case "tool_call": {
        if (item.agentMessage) {
          appendAgentMessageEntries(entries, item.agentMessage);
          break;
        }
        entries.push(formatToolCallEntry(item, options));
        break;
      }
      case "todo":
        entries.push(activityEntry("[Tasks]"));
        for (const entry of item.items) {
          const checkbox = entry.completed ? "[x]" : "[ ]";
          const text = `- ${checkbox} ${entry.text}`;
          entries.push(activityEntry(text));
        }
        break;
      case "error":
        entries.push(activityEntry(`[Error] ${item.message}`));
        break;
      case "compaction":
        entries.push(activityEntry("[Compacted]"));
        break;
    }
  }

  return entries;
}

function curateAgentActivityEntries(
  timeline: AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): ActivityEntry[] {
  const collapsed = projectForCuration(timeline);
  return curateProjectedActivityEntries(collapsed, options);
}

/**
 * Convert normalized agent timeline items into a concise text summary.
 */
export function curateAgentActivity(
  timeline: AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): string {
  const entries = curateAgentActivityEntries(timeline, options);
  return entries.length > 0
    ? entries.map((entry) => entry.text).join("\n")
    : "No activity to display.";
}

export function summarizeAgentActivity(timeline: AgentTimelineItem[], limit?: number) {
  const selection = selectItemsByProjectedLimit({
    items: timeline,
    direction: "tail",
    limit: limit ?? 0,
  });
  const { totalProjected, shownProjected } = selection;
  const noun = totalProjected === 1 ? "activity" : "activities";
  const countHeader =
    limit && shownProjected < totalProjected
      ? `Showing ${shownProjected} of ${totalProjected} ${noun} (limited to ${limit})`
      : `Showing all ${totalProjected} ${noun}`;
  return {
    updateCount: timeline.length,
    content: `${countHeader}\n\n${curateAgentActivity(selection.items)}`,
  };
}
