#!/usr/bin/env bash
# 本机 CI（docs/engineering.md §4.4、§8）：lint → typecheck → test，任一步失败即以非 0 退出。
# schema 导出一致性、dump-config 快照等，对应功能落地后再接进来。
# 用 `pnpm run ci` 调用：pnpm 11 的 `pnpm ci` 是内置的干净安装命令，不会走到这个脚本。
set -euo pipefail

cd "$(dirname "$0")/.."

# 运行时必须和 .node-version 同一个大版本（engines 钉 >=24 <25）。pnpm 对 engines 不符只给警告，
# 而本机非交互 shell 里的 node 常是 Homebrew 的新版，不拦一下 CI 会在错的运行时上通过。
expected_major="$(cut -d. -f1 .node-version)"
actual_version="$(node -p 'process.versions.node')"
if [[ "${actual_version%%.*}" != "${expected_major}" ]]; then
  echo "本机 CI 需要 Node ${expected_major}（见 .node-version），当前是 v${actual_version}；可用 fnm exec --using=.node-version -- pnpm run ci" >&2
  exit 1
fi

run_step() {
  local name="$1"
  shift
  echo "==> ${name}"
  "$@"
}

run_step lint pnpm run lint
run_step typecheck pnpm run typecheck
run_step test pnpm run test

echo "==> 本机 CI 全部通过"
