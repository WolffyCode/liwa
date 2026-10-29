// @liwa/contracts：协议规范（docs/architecture/modules/00-contracts.md）
export { z } from './z.js';
export * from './common.js';
export * from './errors.js';
export * from './services.js';
export * from './manifest/liwa.js';
export * from './manifest/profile.js';
export * from './manifest/assembly.js';
export * from './slots/index.js';
export * from './events/index.js';
export * from './protocol/client.js';
export * from './protocol/ipc.js';
export * from './ledgers/index.js';

/** 进程内插件 API（definePlugin、KernelContext）的版本；仓库内随版本走 */
export const KERNEL_API_VERSION = 1 as const;
