// kernel 写进经历流的事件（系统流，受众 AUDIENCE_OWNER）
import { defineEventType } from './envelope.js';
import { z } from '../z.js';

export const kernelStarted = defineEventType(
  'kernel.started.v1',
  z.object({ profile: z.string(), stage: z.string(), assemblyHash: z.string(), plugins: z.array(z.string()) }),
);
export const pluginDisabled = defineEventType('plugin.disabled.v1', z.object({ id: z.string(), reason: z.string() }));
export const pluginFailed = defineEventType('plugin.failed.v1', z.object({ id: z.string(), message: z.string() }));
export const pluginCircuitOpen = defineEventType('plugin.circuit_open.v1', z.object({ id: z.string() }));
export const slotBound = defineEventType(
  'slot.bound.v1',
  z.object({ member: z.string(), slot: z.string(), binding: z.unknown(), layer: z.string() }),
);

export const KERNEL_EVENT_TYPES = Object.freeze([kernelStarted, pluginDisabled, pluginFailed, pluginCircuitOpen, slotBound]);
