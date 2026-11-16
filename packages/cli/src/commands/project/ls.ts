import type { Command } from "commander";
import type { CommandOptions, ListResult } from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";
import { projectSchema, toProjectRow, type ProjectRow } from "./shared.js";

export async function runLsCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<ProjectRow>> {
  const client = await connectToDaemon({ target: options.daemonTarget }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ target: options.daemonTarget, error });
  });

  try {
    const payload = await client.listProjects();
    // The project that backs independent chats is daemon-private, not one the user added.
    const userProjects = payload.projects.filter((project) => project.purpose !== "chat");
    return {
      type: "list",
      data: userProjects.map(toProjectRow),
      schema: projectSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
