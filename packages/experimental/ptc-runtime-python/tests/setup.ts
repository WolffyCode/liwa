import { Context } from '@liwa/cordis'
import Sandbox from '@liwa/sandbox-local'
import SandboxPolicy from '@liwa/sandbox-policy'
import SessionProjections from '@liwa/session-projection'
import { onTestFinished } from 'vitest'
import type { SandboxMode } from '@liwa/sandbox'

/** Mount the Python runtime's policy and confinement providers with owned teardown. */
export async function createRuntimeContext(policy: { mode?: SandboxMode; workspaceRoot?: string } = {}): Promise<Context> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Sandbox, {})
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', ...policy })
  return ctx
}
