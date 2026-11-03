/**
 * 命令行提供方读的进程事实，放在 `./startup` 入口之外，测试替换它们时不增加包的公开 API。
 * @module @liwa/brain-cli/startup-internals
 */

/** 命令行提供方读的进程事实；测试替换它们。 */
export const internals: {
  stdinIsTty: () => boolean
} = {
  stdinIsTty: () => process.stdin.isTTY,
}
