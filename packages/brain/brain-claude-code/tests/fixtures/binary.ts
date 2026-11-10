import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Materialize a test-only executable in its owning host's temporary directory. */
export async function fakeClaudeBinary(root: string): Promise<string> {
  const source = await readFile(new URL('./fake-claude.mjs', import.meta.url), 'utf8')
  const binary = join(root, 'fake-claude')
  await writeFile(binary, `#!/usr/bin/env node\n${source}`, { mode: 0o700 })
  return binary
}
