// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/trae-acp-agent.ts；原地改动见包内 NOTICE。
// 灵鲸改：上游的 pino 日志器换成接在 cordis logger 上的同形接口。
import type { PaseoLogger as Logger } from "@liwa/brain-shared";

import { GenericACPAgentClient } from "./generic-acp-agent.ts";
import type { ProviderProcessHost } from "@liwa/brain";

interface TraeACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  /** 灵鲸改：探测与诊断拉进程用的入口。 */
  processHost: ProviderProcessHost;
}

const TRAE_INITIAL_COMMANDS_WAIT_TIMEOUT_MS = 10_000;

export class TraeACPAgentClient extends GenericACPAgentClient {
  constructor(options: TraeACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      // traecli publishes slash commands and skills asynchronously via available_commands_update.
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: TRAE_INITIAL_COMMANDS_WAIT_TIMEOUT_MS,
      processHost: options.processHost,
    });
  }
}
