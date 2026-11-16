import { describe, expect, it } from "vitest";
import { resolveIndependentChatBlocker } from "./submission";

const independentChat = {
  hasDirectory: false,
  connected: true,
  supportsIndependentChats: true,
  isEmptySubmission: false,
};

describe("resolveIndependentChatBlocker", () => {
  it("sends a message without a workspace directory on a capable host", () => {
    expect(resolveIndependentChatBlocker(independentChat)).toBeNull();
  });

  it("reports a disconnected host rather than asking for an update", () => {
    expect(
      resolveIndependentChatBlocker({
        ...independentChat,
        connected: false,
        supportsIndependentChats: false,
      }),
    ).toBe("host-disconnected");
  });

  it("asks to update a host that cannot create independent chats", () => {
    expect(
      resolveIndependentChatBlocker({ ...independentChat, supportsIndependentChats: false }),
    ).toBe("update-host");
  });

  it("needs a message, because an independent chat has no empty workspace to open", () => {
    expect(resolveIndependentChatBlocker({ ...independentChat, isEmptySubmission: true })).toBe(
      "enter-message",
    );
  });

  it("keeps the workspace rules once a directory is chosen", () => {
    expect(
      resolveIndependentChatBlocker({
        hasDirectory: true,
        connected: true,
        supportsIndependentChats: false,
        isEmptySubmission: true,
      }),
    ).toBeNull();
  });
});
