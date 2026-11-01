/** Built package smoke: headless consumers must not import the browser implementation. */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const guard = registerHooks({
  resolve(specifier, context, next) {
    assert(!/^(?:react(?:-dom)?(?:\/|$)|@liwa\/client-)/.test(specifier), `Headless import reached ${specifier}`)
    const result = next(specifier, context)
    assert(!/\/cua\/lib\/(?:client(?:\/|\.)|types\/client\/)/.test(result.url), `Headless import reached ${result.url}`)
    return result
  },
})
const { Context } = await import('@liwa/cordis')
const host = await import('@liwa/cua')
const { createCuaApi } = await import('@liwa/cua/api')
const { connectCua } = await import('@liwa/cua/bridge')
const { NativeClient } = await import('@liwa/cua/native-client')
const { Request } = await import('@liwa/cua/protocol')
for (const callable of [host.apply, host.installCua, host.CuaAccess, createCuaApi, connectCua, NativeClient]) assert.equal(typeof callable, 'function')
assert.equal(Request.parse({ method: 'getCapabilities', params: {} }).method, 'getCapabilities')
const ctx = new Context()
try { await ctx.plugin(host); assert.equal(ctx.get('cuaAccess'), undefined) }
finally { await ctx.fiber.dispose() }
guard.deregister()
const remote = await import('@liwa/cua/remote')
assert.equal(remote.default.package, '@liwa/cua')
assert.equal(remote.default.descriptors.length, 9)
process.stdout.write('headless exports and generated Remote passed\n')
