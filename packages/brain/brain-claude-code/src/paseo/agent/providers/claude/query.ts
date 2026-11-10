// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/claude/query.ts；改动见包内 NOTICE。
// 灵鲸改：SDK 只负责协议；进程创建与释放由严格适配器经 launch.spawn 持有。
import { type Options, type Query, type SpawnOptions, type SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
type ClaudeSdk = typeof import("@anthropic-ai/claude-agent-sdk");
export type ClaudeOptions = Options;
export type ClaudeQueryInput = Parameters<ClaudeSdk["query"]>[0] & { options: ClaudeOptions };
export type ClaudeQueryFactory = (input: ClaudeQueryInput) => Query;
export interface ClaudeQueryContext {
  spawn: (options: SpawnOptions, stderr: Options["stderr"]) => SpawnedProcess;
  queryFactory?: ClaudeQueryFactory;
  onChildProcess?: (child: SpawnedProcess) => void;
}
export async function claudeQuery(input: ClaudeQueryInput, context: ClaudeQueryContext): Promise<Query> {
  // 灵鲸改：只在真正打开本机 Query 时加载原生 SDK；默认关闭的浏览器部署不执行原生入口。
  const launchQuery = context.queryFactory ?? (await import(import.meta.resolve("@anthropic-ai/claude-agent-sdk")) as ClaudeSdk).query;
  return launchQuery({
    ...input,
    options: {
      ...input.options,
      spawnClaudeCodeProcess: options => {
        const child = context.spawn(options, input.options.stderr);
        context.onChildProcess?.(child);
        return child;
      },
    },
  });
}
