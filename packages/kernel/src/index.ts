// @liwa/kernel 插件机制底座（docs/architecture/modules/00-plugin-kernel.md）
export { definePlugin, defineService, isPluginDef, PLUGIN_MARK } from './plugin.js';
export { startKernel, dumpConfig, prepareAssembly, type StartOptions } from './loader.js';
export { createTestKernel, dumpTestConfig, prepareTestAssembly, memoryResolver, testKernelOptions, type FakePackage, type TestKernelOptions } from './testing.js';
export { systemClock, fakeClock, type FakeClock } from './clock.js';
export { createRng, rngFromState } from './rng.js';
export { createIds } from './ids.js';
export { createConsoleLogger, createMemoryLogger, type MemoryLogger } from './logger.js';
export { resolveSecrets, redactSecrets, envSecrets, noSecrets } from './secrets.js';
export { fileSystemResolver, findRepoRoot, readPackageManifest, deriveKind, checkManifest, pickPluginExport, type PackageResolver, type LocatedPackage } from './manifest.js';
export { readProfileSource, resolveProfile, type ProfileSource, type ResolvedProfile } from './profile.js';
export { buildServiceGraph } from './graph.js';
export { SlotRegistry } from './slots.js';
export type * from './types.js';
