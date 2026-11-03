/**
 * 命令执行方读写的进程流与终端提问，放在包入口之外，测试替换它们时不增加包的公开 API。
 * @module @liwa/brain-cli/runner-internals
 */

import { createInterface } from 'node:readline/promises'

/** 命令执行方读写的进程流；测试替换它们。 */
export const internals: {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  ask: (question: string) => Promise<string>
} = {
  stdout: process.stdout,
  stderr: process.stderr,
  ask: async (question) => {
    const terminal = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return await terminal.question(question)
    } finally {
      terminal.close()
    }
  },
}
