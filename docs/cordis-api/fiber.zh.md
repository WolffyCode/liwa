<!-- 英文源文件由 scripts/gen-cordis-catalog.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-cordis-catalog` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/cordis-api/fiber.md` 重新记录配对。 -->

# Fiber

[English](fiber.md) | 中文

fiber 是一个已加载的插件实例，包含其生命周期状态、经过校验的配置以及已注册的作用。`ctx.fiber` 是当前 fiber，`ctx.effect()` 会将调用委托给它。

### ctx.effect(execute, label?)

```ts cordis-catalog
/**
 * Register a cleanup-aware effect on this fiber.
 *
 * `execute` runs immediately; the disposers it produces are collected and
 * run (in reverse order) either when the returned disposer is called or
 * when the fiber unloads, whichever comes first. Calling the disposer twice
 * is a no-op. Throws `CordisError('INACTIVE_EFFECT')` if the fiber is
 * already disposed or unloading, and `TypeError` if `execute` returns an
 * invalid shape.
 *
 * @param execute — the effect body; see {@link Effect} for accepted shapes.
 * @param label — effect label shown in `getEffects()` diagnostics.
 * @returns a disposer that tears the effect down and settles once done.
 */
effect(execute: () => SyncEffect, label?: string): Disposable<Promise<void>>
effect(execute: () => Effect, label?: string): AsyncDisposable<Promise<void>>
```

在此 fiber 上注册一个支持清理的作用。

`execute` 会立即运行；它产生的清理函数将被收集，并在调用返回的清理函数或卸载 fiber 时按相反顺序运行，以先发生者为准。重复调用清理函数不会产生任何效果。如果 fiber 已经 dispose（资源释放）或正在卸载，则抛出 `CordisError('INACTIVE_EFFECT')`；如果 `execute` 返回了不受支持的结构，则抛出 `TypeError`。

- `execute`：作用主体；可接受的结构见 `Effect`。
- `label`：在 `getEffects()` 诊断信息中显示的作用标签。

**返回**一个清理函数，它拆除该作用，并在完成后结算。

[源码](../../vendor/cordis/src/fiber.ts#L452)

### ctx.fiber

```ts cordis-catalog
/** The fiber (plugin runtime instance) that owns this context. */
fiber: Fiber
```

拥有此上下文的 fiber（插件运行时实例）。

[源码](../../vendor/cordis/src/fiber.ts#L12)

## Fiber 类

单次插件应用的运行时实例。

fiber 会跟踪 `ctx.plugin()` 返回的插件上下文所对应的依赖状态、经过校验的配置、生命周期作用和清理操作。

[源码](../../vendor/cordis/src/fiber.ts#L215)

### fiber.uid

```ts cordis-catalog
/** Unique id within the registry; 0 for the root fiber, `null` once disposed. */
public uid: number | null
```

在注册表中的唯一 id；根 fiber 的 id 为 0，dispose 后为 `null`。

[源码](../../vendor/cordis/src/fiber.ts#L217)

### fiber.ctx

```ts cordis-catalog
/** The context this fiber's plugin runs in (extends the parent context). */
public readonly ctx: Context
```

此 fiber 的插件运行所在的上下文（扩展自父上下文）。

[源码](../../vendor/cordis/src/fiber.ts#L219)

### fiber.config

```ts cordis-catalog
/**
 * The raw plugin config, retained without evaluating expressions or validating it.
 * Every activation resolves it through `internal/config`; `update()` replaces it. Read the value passed to the running instance through {@link effectiveConfig}.
 */
public config: any
```

原始插件配置，保留时不做表达式求值，也不做校验。每次激活都会经 `internal/config` 解析它；`update()` 会替换它。传给运行实例的值通过 effectiveConfig 读取。

[源码](../../vendor/cordis/src/fiber.ts#L224)

### fiber.state

```ts cordis-catalog
/** Current lifecycle state; transitions emit `internal/status`. */
public state
```

当前生命周期状态；状态转换会发出 `internal/status`。

[源码](../../vendor/cordis/src/fiber.ts#L226)

### fiber.dispose

```ts cordis-catalog
/** Dispose this fiber: unload the plugin, then settle once cleanup finished. */
public readonly dispose: () => Promise<void>
```

dispose 此 fiber：卸载插件，并在清理完成后结算。

[源码](../../vendor/cordis/src/fiber.ts#L228)

### fiber.committed

```ts cordis-catalog
/** Snapshot of the required service implementations taken for the current load; `undefined` while unloaded. */
public committed: Readonly<Dict<Impl>> | undefined
```

为本次加载取得的所需服务实现快照；未加载时为 `undefined`。

[源码](../../vendor/cordis/src/fiber.ts#L230)

### fiber.provisions

```ts cordis-catalog
/** Service implementations this fiber provides; its effects outlive them until every dependent has unloaded. */
public readonly provisions
```

此 fiber 提供的服务实现；在所有依赖方卸载之前，它的作用会一直保留。

[源码](../../vendor/cordis/src/fiber.ts#L232)

### fiber.inertia

```ts cordis-catalog
/** The in-flight load/unload transition, if one is currently running. */
public inertia: Promise<void> | undefined
```

当前正在进行的加载或卸载转换；如果没有此类转换，则为 undefined。

[源码](../../vendor/cordis/src/fiber.ts#L234)

### fiber.name

```ts cordis-catalog
/** The plugin's display name, inherited from the nearest named ancestor, else `'root'`. */
get name()
```

插件的显示名称，继承自最近的具名祖先；如果不存在，则为 `'root'`。

[源码](../../vendor/cordis/src/fiber.ts#L372)

### fiber.assertActive()

```ts cordis-catalog
/**
 * Throw if the fiber has already been disposed.
 *
 * @returns nothing when the fiber is still active.
 * @throws {CordisError} `INACTIVE_EFFECT` when the fiber's uid has been cleared.
 */
assertActive()
```

如果 fiber 已经 dispose，则抛出异常。

**返回**：fiber 仍处于活动状态时不返回任何内容。

[源码](../../vendor/cordis/src/fiber.ts#L387)

### fiber.effect(execute, label?)

```ts cordis-catalog
/**
 * Register a cleanup-aware effect on this fiber.
 *
 * `execute` runs immediately; the disposers it produces are collected and
 * run (in reverse order) either when the returned disposer is called or
 * when the fiber unloads, whichever comes first. Calling the disposer twice
 * is a no-op. Throws `CordisError('INACTIVE_EFFECT')` if the fiber is
 * already disposed or unloading, and `TypeError` if `execute` returns an
 * invalid shape.
 *
 * @param execute — the effect body; see {@link Effect} for accepted shapes.
 * @param label — effect label shown in `getEffects()` diagnostics.
 * @returns a disposer that tears the effect down and settles once done.
 */
effect(execute: () => SyncEffect, label?: string): Disposable<Promise<void>>
effect(execute: () => Effect, label?: string): AsyncDisposable<Promise<void>>
```

在此 fiber 上注册一个支持清理的作用。

`execute` 会立即运行；它产生的清理函数将被收集，并在调用返回的清理函数或卸载 fiber 时按相反顺序运行，以先发生者为准。重复调用清理函数不会产生任何效果。如果 fiber 已经 dispose（资源释放）或正在卸载，则抛出 `CordisError('INACTIVE_EFFECT')`；如果 `execute` 返回了不受支持的结构，则抛出 `TypeError`。

- `execute`：作用主体；可接受的结构见 `Effect`。
- `label`：在 `getEffects()` 诊断信息中显示的作用标签。

**返回**一个清理函数，它拆除该作用，并在完成后结算。

[源码](../../vendor/cordis/src/fiber.ts#L452)

### fiber.getEffects()

```ts cordis-catalog
/**
 * Return metadata for currently registered effects.
 *
 * @returns one {@link EffectMeta} tree per labeled live effect.
 */
getEffects()
```

返回当前已注册作用的元数据。

**返回**：每个带标签的活动作用对应一棵 `EffectMeta` 树。

[源码](../../vendor/cordis/src/fiber.ts#L605)

### fiber.effectiveConfig

```ts cordis-catalog
/**
 * The resolved config object passed to the plugin by its latest activation, without cloning or re-parsing.
 * It is undefined before the first activation and remains readable after unload; callers requiring a live instance check `state`.
 */
get effectiveConfig(): unknown
```

最近一次激活传给插件的已解析配置对象，不克隆也不重新解析。首次激活前为 undefined，卸载后仍可读取；需要运行实例的调用方应检查 `state`。

[源码](../../vendor/cordis/src/fiber.ts#L683)

### fiber.resolveConfig(config)

```ts cordis-catalog
/**
 * Resolve raw config through this fiber's `internal/config` waterfall, which ends in the runtime schema's validation.
 * Activation and `update()` resolve through it; a candidate resolved by other callers is not published and does not replace {@link config}.
 * Required injections must be available when a hook uses them.
 * @param config Raw config.
 * @returns The resolved config, retaining the schema's result identity.
 * @throws {ValidationError} when the runtime schema rejects the config; hook errors propagate.
 */
resolveConfig(config: unknown): unknown
```

通过此 fiber 的 `internal/config` waterfall（瀑布式事件）解析原始配置，waterfall 最终由运行时 schema 校验。激活和 `update()` 都经它解析；其他调用方解析的候选值不会被发布，也不会替换 config。钩子使用的注入服务必须已经可用。

- `config`：原始配置。

**返回**解析后的配置，保留 schema 返回对象的身份。

[源码](../../vendor/cordis/src/fiber.ts#L695)

### fiber.await()

```ts cordis-catalog
/**
 * Wait for current lifecycle work and rethrow startup errors.
 *
 * @returns this fiber, once it has settled into a stable state.
 * @throws the config-validation or plugin-startup error, if any.
 */
async await()
```

等待当前生命周期工作完成，并重新抛出启动错误。

**返回**：进入稳定状态后的此 fiber。

[源码](../../vendor/cordis/src/fiber.ts#L773)

### fiber.restart()

```ts cordis-catalog
/**
 * Unload and reload this plugin with its current raw config, which is resolved again.
 *
 * @returns a promise resolving once the reload settled.
 * @throws {CordisError} `INACTIVE_EFFECT` when the fiber is already disposed.
 */
async restart(): Promise<void>
```

卸载并重新加载此插件，使用其当前的原始配置，并重新解析。

**返回**一个在重新加载完成后兑现的 promise。

[源码](../../vendor/cordis/src/fiber.ts#L787)

### fiber.update(config, noSave?)

```ts cordis-catalog
/**
 * Replace the raw config, then restart the plugin with it.
 *
 * A loaded fiber resolves the candidate first, so an invalid config throws
 * before anything changes, and runs the `internal/update` waterfall, whose
 * listeners (e.g. Group, Include) can apply it in place instead of
 * restarting. Unless `noSave`, `internal/commit` reports the accepted raw
 * config to persistence hooks.
 *
 * @param config — the new raw config.
 * @param noSave — skip `internal/commit`, e.g. when the config came from the persisted source itself.
 * @returns the restart or the listener's replacement work, or nothing when a listener vetoed synchronously.
 * @throws {ValidationError} when a loaded fiber's candidate fails validation.
 */
update(config: any, noSave = false): Awaitable<void>
```

替换原始配置，然后用它重新启动插件。

已加载的 fiber 会先解析候选配置，因此无效配置会在任何改动发生前抛出；随后运行 `internal/update` waterfall，其监听器（例如 Group、Include）可以就地应用新配置而不重新启动。除非指定 `noSave`，`internal/commit` 会把被接受的原始配置报告给持久化钩子。

- `config`：新的原始配置。
- `noSave`：跳过 `internal/commit`，例如配置本身就来自持久化来源时。

**返回**重新启动的任务或监听器替代执行的工作；监听器同步否决时无返回值。

[源码](../../vendor/cordis/src/fiber.ts#L809)

## Effect

`ctx.effect()` 和插件启动所接受的作用主体结果。

可以是单个清理函数、兑现为清理函数的 promise，或生成多个清理函数的（可能为异步的）可迭代对象。生成器作用会在每个清理函数产生时将其注册。

```ts cordis-catalog
/**
 * Effect body result accepted by `ctx.effect()` and plugin startup.
 *
 * Either a single disposer, a promise of one, or a (possibly async) iterable
 * yielding several — generator effects register each yielded disposer as it
 * is produced.
 */
type Effect<T = any> =
  | SyncEffect<T>
  | AsyncEffect<T>
```

[源码](../../vendor/cordis/src/fiber.ts#L113)

## Disposable

作用返回的函数，用于在资源释放期间释放资源。

拥有该函数的 fiber 卸载时，清理函数会按注册的相反顺序运行；清理函数可以是异步的，此时卸载过程会等待其完成。

```ts cordis-catalog
/**
 * Function returned by an effect to release resources during disposal.
 *
 * Disposers run in reverse registration order when the owning fiber unloads;
 * they may be async, in which case unloading awaits them.
 */
type Disposable<T = any> = () => T
```

[源码](../../vendor/cordis/src/fiber.ts#L104)

## EffectMeta

用于在诊断信息中公开嵌套作用标签的树节点。

```ts cordis-catalog
/** Tree node used to expose nested effect labels for diagnostics. */
interface EffectMeta {
  /** Human-readable effect label, e.g. `ctx.on("event")` or `ctx.provide("name")`. */
  label: string
  /** Metadata of nested effects registered while this effect ran. */
  children: EffectMeta[]
}
```

[源码](../../vendor/cordis/src/fiber.ts#L126)

## CordisError

具有稳定机器可读错误码的框架错误。

```ts cordis-catalog
/** Framework error with a stable machine-readable code. */
class CordisError extends Error {
  /**
   * @param code — the stable error code; also the default message.
   * @param message — optional human-readable override.
   */
  constructor(public code: CordisError.Code, message?: string)
}

/** Cordis error code definitions. */
namespace CordisError {
  export type Code = keyof typeof Code

  export const Code = {
    INACTIVE_EFFECT: 'cannot create effect on inactive context',
  } as const
}
```

[源码](../../vendor/cordis/src/fiber.ts#L188)

## ValidationError

插件配置未通过 standard-schema 校验时抛出的错误。

```ts cordis-catalog
/** Error raised when plugin configuration fails standard-schema validation. */
class ValidationError extends TypeError {
  name = 'ValidationError'

  /**
   * Build the aggregated message from schema issues.
   *
   * @param issues — the standard-schema issues, one message line each; kept on the error.
   */
  constructor(public issues: readonly StandardSchemaV1.Issue[])

  /**
   * Recognize a validation error across realms and copies of cordis.
   *
   * @param error — the value to test.
   * @returns `true` if `error` carries the global validation-error brand.
   */
  static is(error: unknown): error is ValidationError

  /**
   * Reduce an issue path to its property keys.
   *
   * @param path — the standard-schema issue path, whose segments may be `{ key }` objects.
   * @returns the plain property keys, outermost first.
   */
  static normalizePath(path: StandardSchemaV1.Issue['path'] = []): PropertyKey[]

  /**
   * Format an issue path for messages.
   *
   * @param path — the standard-schema issue path.
   * @returns the keys joined with `.`, e.g. `nested.0.name`.
   */
  static formatPath(path: StandardSchemaV1.Issue['path']): string
}
```

[源码](../../vendor/cordis/src/fiber.ts#L19)
