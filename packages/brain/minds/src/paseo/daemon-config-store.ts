// 来源：paseo-upstream@8018231a packages/server/src/server/daemon-config-store.ts:321-348 摘录；Apache-2.0，灵鲸改见 NOTICE。
import { ProviderOverrideSchema } from "@liwa/brain-shared/paseo/protocol/provider-config";
import type { ProviderOverride } from "@liwa/brain-shared/paseo/agent/provider-launch-config";
import type { MutableDaemonConfig } from "../seams/config.ts";

export function applyMutableProviderConfigToOverrides(
  baseOverrides: Record<string, ProviderOverride> | undefined,
  mutableProviders: MutableDaemonConfig["providers"] | undefined,
): Record<string, ProviderOverride> | undefined {
  if (!baseOverrides && (!mutableProviders || Object.keys(mutableProviders).length === 0)) {
    return undefined;
  }

  const nextOverrides: Record<string, ProviderOverride> = { ...baseOverrides };
  for (const [providerId, providerConfig] of Object.entries(mutableProviders ?? {})) {
    const previousOverride = nextOverrides[providerId];
    const parsedOverride = ProviderOverrideSchema.strip().parse(providerConfig);
    nextOverrides[providerId] = {
      ...previousOverride,
      ...parsedOverride,
      ...(parsedOverride.paseoTools
        ? {
            paseoTools: {
              ...previousOverride?.paseoTools,
              ...parsedOverride.paseoTools,
            },
          }
        : {}),
    };
  }

  return nextOverrides;
}
