// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/claude/runtime-safety.ts；改动见包内 NOTICE。
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { parseClaudeCodeVersion } from "./model-manifest.ts";

/** Process-local background ownership. Completion delivery can follow an empty roster. */
export class ClaudeRuntimeSafety {
  // 灵鲸改：task_started 与 roster 一起提供取消时的原生任务名单。
  private readonly announcedTasks = new Set<string>();
  private supported = false;
  private liveTasks = new Set<string>();
  private readonly awaitingNotifications = new Set<string>();

  reset(): void {
    this.announcedTasks.clear();
    this.supported = false;
    this.liveTasks.clear();
    this.awaitingNotifications.clear();
  }

  observe(message: SDKMessage): void {
    if (message.type !== "system") return;
    if (message.subtype === "task_started") this.announcedTasks.add(message.task_id);
    if (message.subtype === "init") {
      // 2.1.292 is a known roster-capable release. Older binaries can demonstrate
      // support by sending a roster; a fresh process starts with an empty roster.
      const version = parseClaudeCodeVersion(message.claude_code_version ?? "");
      if (
        version &&
        (version[0] > 2 ||
          (version[0] === 2 && (version[1] > 1 || (version[1] === 1 && version[2] >= 292))))
      )
        this.supported = true;
    }
    if (message.subtype === "background_tasks_changed") {
      this.supported = true;
      this.liveTasks = new Set(message.tasks.map((task) => task.task_id));
      for (const id of this.liveTasks) this.awaitingNotifications.add(id);
    }
    if (message.subtype === "task_notification") {
      this.awaitingNotifications.delete(message.task_id);
      this.announcedTasks.delete(message.task_id);
    }
  }

  tasksToStop(): string[] {
    return [...new Set([...this.liveTasks, ...this.announcedTasks])];
  }

  canStopRuntime(): boolean {
    return this.supported && this.announcedTasks.size === 0 && this.liveTasks.size === 0 && this.awaitingNotifications.size === 0;
  }
}
