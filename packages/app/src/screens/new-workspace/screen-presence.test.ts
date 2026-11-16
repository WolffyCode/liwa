import { describe, expect, it } from "vitest";
import { isNewWorkspaceScreenActive } from "./screen-presence";

const foreground = { isMounted: true, pathname: "/new", draftId: null, activeDraftId: null };

describe("isNewWorkspaceScreenActive", () => {
  it("is active while the screen is mounted and the route is /new", () => {
    expect(isNewWorkspaceScreenActive(foreground)).toBe(true);
  });

  it("is inactive once the screen has been popped off the stack", () => {
    expect(isNewWorkspaceScreenActive({ ...foreground, isMounted: false })).toBe(false);
  });

  it("is inactive while another route sits on top of the screen", () => {
    expect(isNewWorkspaceScreenActive({ ...foreground, pathname: "/settings" })).toBe(false);
  });

  it("is inactive on a workspace route", () => {
    expect(isNewWorkspaceScreenActive({ ...foreground, pathname: "/host/workspace/wks_1" })).toBe(
      false,
    );
  });

  it("does not let an older draft's creation navigate over a newer New conversation", () => {
    expect(
      isNewWorkspaceScreenActive({ ...foreground, draftId: "older", activeDraftId: "newer" }),
    ).toBe(false);
    expect(
      isNewWorkspaceScreenActive({ ...foreground, draftId: "newer", activeDraftId: "newer" }),
    ).toBe(true);
  });
});
