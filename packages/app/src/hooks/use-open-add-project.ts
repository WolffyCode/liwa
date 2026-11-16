import {
  useAddProjectFlowStore,
  type AddProjectFlowOptions,
} from "@/stores/add-project-flow-store";

export function useOpenAddProject(): (options?: AddProjectFlowOptions) => void {
  return useAddProjectFlowStore((state) => state.open);
}
