// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/resume-process-cwd.ts；原地改动见包内 NOTICE。
import { stat } from "node:fs/promises";
import { homedir } from "node:os";

import type { AgentResumePurpose } from "../agent-sdk-types.ts";

export async function resolveResumeProcessCwd(
  cwd: string,
  purpose: AgentResumePurpose | undefined,
): Promise<string> {
  if (purpose !== "history" || (await isDirectory(cwd))) {
    return cwd;
  }
  return homedir();
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}
