// 来源：paseo-upstream@8018231a packages/server/src/server/agent/host-operations/index.ts；Apache-2.0，灵鲸改见 NOTICE。
// 灵鲸改：删除远端主机、工作区与连接壳，只保留本机观察分派。
import type { AgentStreamEvent } from "@liwa/brain-shared/paseo/agent/agent-sdk-types";
import type { AgentSnapshotPayload } from "@liwa/brain-shared/paseo/protocol/messages";
export interface WaitForFinishResult {
  status: "idle" | "error" | "permission" | "timeout";
  final: AgentSnapshotPayload | null;
  lastMessage: string | null;
  error: string | null;
}
export interface HostObservation {
  wait(agentId: string, signal: AbortSignal): Promise<WaitForFinishResult>;
  observe(
    agentId: string,
    handler: (
      snapshot: AgentSnapshotPayload | null,
      event?: AgentStreamEvent,
      lastMessage?: string | null,
    ) => void,
    signal: AbortSignal,
    onError: (error: unknown) => void,
  ): Promise<() => Promise<void>>;
}
export function createHostObservationResolver(input: { local: HostObservation }) {
  return {
    use<T>(action: (host: HostObservation) => Promise<T>): Promise<T> {
      return action(input.local);
    },
  };
}
