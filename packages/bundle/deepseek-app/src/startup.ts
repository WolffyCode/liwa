/**
 * `liwa --profile deepseek` 的命令行与 stdin 生命期：解析成功才发布 {@link DEEPSEEK_APP_STARTUP_SERVICE}，
 * ACP 服务器那一行等它出现，`--help` 不起传输；stdin 结束时请求启动器有界退出。
 * @module @liwa/deepseek-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@liwa/cordis'
import { exitOnStdinEnd, parseCmdline } from '@liwa/cmdline'

/** 稳定的 cordis 插件名。 */
export const name = 'deepseek-app-startup'

/** 解析命令行之前要有的服务。 */
export const inject = ['cmdlineArgs']

/** ACP 服务器那一行等的服务名。 */
export const DEEPSEEK_APP_STARTUP_SERVICE = 'deepseekAppStartup'

/**
 * 本应用的命令与帮助（没有选项）。
 * @returns 新的 commander 程序（测试里一个进程会解析多次）。
 */
function deepseekCommand(): Command {
  return new Command()
    .name('liwa --profile deepseek')
    .description('Serve one Liwa agent session over Agent Client Protocol stdio, with the _liwa extensions.')
    .helpOption('-h, --help', 'show this help')
    .addHelpText('after', `
Example:
  liwa --profile deepseek     serve ACP on stdio until the client disconnects
`)
}

/**
 * 接受一次调用、发布就绪，并把 stdin 结束接到启动器的有界退出上。
 * @param ctx - 带命令行与退出请求的插件上下文。
 */
export function apply(ctx: Context): void {
  const program = deepseekCommand()
  program.action(() => {
    exitOnStdinEnd(ctx, 'deepseek-app.stdin')
    ctx.provide(DEEPSEEK_APP_STARTUP_SERVICE, { accepted: true })
  })
  parseCmdline(ctx, program)
}
