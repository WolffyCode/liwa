import { describe, expect, it } from "vitest";
import { resolveCloseAgentTabPolicy } from "./close-tab-policy";

const projectWorkspace = { purpose: undefined };

describe("resolveCloseAgentTabPolicy", () => {
  it("archives root agents when their tab closes", () => {
    expect(
      resolveCloseAgentTabPolicy({ agent: { parentAgentId: null }, workspace: projectWorkspace }),
    ).toEqual({ kind: "archive-on-close" });
  });

  it("keeps subagent tab close layout-only", () => {
    expect(
      resolveCloseAgentTabPolicy({
        agent: { parentAgentId: "parent-agent" },
        workspace: projectWorkspace,
      }),
    ).toEqual({ kind: "layout-only" });
  });

  it("keeps an independent chat when its agent tab closes; only archive ends it", () => {
    expect(
      resolveCloseAgentTabPolicy({
        agent: { parentAgentId: null },
        workspace: { purpose: "chat" },
      }),
    ).toEqual({ kind: "layout-only" });
    expect(resolveCloseAgentTabPolicy({ agent: null, workspace: { purpose: "chat" } })).toEqual({
      kind: "layout-only",
    });
  });

  it("preserves the existing archive fallback when the agent is missing", () => {
    expect(resolveCloseAgentTabPolicy({ agent: null, workspace: projectWorkspace })).toEqual({
      kind: "archive-on-close",
    });
    expect(resolveCloseAgentTabPolicy({ agent: undefined, workspace: null })).toEqual({
      kind: "archive-on-close",
    });
  });
});
