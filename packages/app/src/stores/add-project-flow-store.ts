import { create } from "zustand";
import type { WorkspaceProjectDescriptorPayload } from "@getpaseo/protocol/messages";

export interface AddedProjectSelection {
  serverId: string;
  project: WorkspaceProjectDescriptorPayload;
}

export interface AddProjectFlowOptions {
  preferredHostId?: string;
  /**
   * Receives the added project instead of opening a New conversation for it, so a caller that
   * is already composing one keeps its draft.
   */
  onProjectSelected?: (selection: AddedProjectSelection) => void;
}

export interface AddProjectFlowRequest extends AddProjectFlowOptions {
  id: number;
}

interface AddProjectFlowStoreState {
  request: AddProjectFlowRequest | null;
  open: (options?: AddProjectFlowOptions) => void;
  close: () => void;
}

let nextRequestId = 1;

export const useAddProjectFlowStore = create<AddProjectFlowStoreState>((set) => ({
  request: null,
  open: (options = {}) => {
    set({ request: { id: nextRequestId++, ...options } });
  },
  close: () => set({ request: null }),
}));
