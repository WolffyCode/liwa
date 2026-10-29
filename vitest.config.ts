// 根测试配置（docs/engineering.md §4.1、§8）：每个工作区包一个测试项目，项目名取包名；
// 跑真 CLI 的契约测试（*.contract.test.ts）单独一个项目 contract，`pnpm test` 不带它，只经 `pnpm test:contract` 手动触发。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

/** 与 pnpm-workspace.yaml 的 packages 保持一致：带 /* 的下面每个子目录是一个包，其余本身是一个包 */
const WORKSPACE_PATTERNS = ['apps/*', 'packages/*', 'packages/plugins/*', 'packages/lib/*', 'tools'];

/** 契约测试的文件名约定 */
const CONTRACT_TESTS = '**/*.contract.test.ts';

/** 不扫描测试文件的目录 */
const IGNORED = ['**/node_modules/**', '**/dist/**'];

/** 开发期解析条件，与 tsconfig.base.json 的 customConditions 一致：各包 exports 用它指向 src/*.ts */
const SOURCE_CONDITION = 'liwa-source';

const ROOT = import.meta.dirname;

interface WorkspacePackage {
  /** 相对仓库根的目录 */
  readonly dir: string;
  /** package.json 里的包名，用作测试项目名 */
  readonly name: string;
}

function readPackageName(dir: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
  if (typeof manifest === 'object' && manifest !== null && 'name' in manifest && typeof manifest.name === 'string') {
    return manifest.name;
  }
  throw new Error(`${dir}/package.json 缺少 name 字段`);
}

function listWorkspacePackages(): WorkspacePackage[] {
  const dirs = WORKSPACE_PATTERNS.flatMap((pattern) => {
    if (!pattern.endsWith('/*')) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(join(ROOT, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
  return dirs
    .filter((dir) => existsSync(join(ROOT, dir, 'package.json')))
    .map((dir) => ({ dir, name: readPackageName(dir) }));
}

export default defineConfig({
  // vitest 会把它自己的默认条件（node 等）并到后面；ssr 的条件还会以 --conditions 传给测试进程
  resolve: { conditions: [SOURCE_CONDITION] },
  ssr: { resolve: { conditions: [SOURCE_CONDITION] } },
  test: {
    projects: [
      ...listWorkspacePackages().map(({ dir, name }) => ({
        extends: true,
        test: {
          name,
          include: [`${dir}/src/**/*.test.ts`, `${dir}/test/**/*.test.ts`],
          exclude: [CONTRACT_TESTS, ...IGNORED],
        },
      })),
      {
        extends: true,
        test: {
          name: 'contract',
          include: [CONTRACT_TESTS],
          exclude: IGNORED,
        },
      },
    ],
  },
});
