// 尚未实现的根脚本（dev、probe、replay、backup、contracts:export，docs/engineering.md §4.1、§10）统一指到这里：
// 报出命令名后以非 0 退出，免得被当成已经跑通。
const command = process.argv[2] ?? '（未指明）';
process.stderr.write(`pnpm ${command} 尚未实现：骨架阶段的占位脚本\n`);
process.exitCode = 1;
