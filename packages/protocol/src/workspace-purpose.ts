import { z } from "zod";

// Daemon-owned role of a workspace or project. `chat` marks an independent chat and the
// private project that backs it; clients never infer it from names, paths, or project keys.
export const WorkspacePurposeSchema = z.literal("chat");

export type WorkspacePurpose = z.infer<typeof WorkspacePurposeSchema>;
