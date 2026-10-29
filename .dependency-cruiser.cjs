// dependency-cruiser 配置：把 docs/engineering.md §4.6 的依赖表与 §5 的层表变成机器检查。
// 路径一律相对仓库根。工作区包经 pnpm 软链解析到真实路径（packages/…），第三方包落在 node_modules/… 下；
// 包的 exports 用 liwa-source 条件指向 src/*.ts，所以跨包依赖解析到对方的 src/index.ts。

/** 测试文件：可以多用 vitest、testkit，不受"只许依赖"清单约束（但插件的测试照样不许碰 core） */
const TEST_FILES = ['(^|/)__tests__/', '(^|/)test/', '\\.test\\.ts$'];

/** 工作区内的包（含 tools） */
const WORKSPACE = '^(apps|packages|tools)/';

/** 某个第三方包（含 pnpm 的 .pnpm/<名@版本>/node_modules/<名>/ 布局） */
const npm = (name) => `(^|/)node_modules/${name.replaceAll('.', '\\.')}/`;

/** 各工作区包的路径 */
const PKG = {
  app: '^apps/liwa/',
  contracts: '^packages/contracts/',
  kernel: '^packages/kernel/',
  core: '^packages/core/',
  testkit: '^packages/testkit/',
  brainShared: '^packages/lib/brain-shared/',
  plugins: '^packages/plugins/',
  console: '^packages/console/',
  cli: '^packages/cli/',
  replay: '^packages/replay/',
};

/** 包根：apps/<名>、packages/plugins/<名>、packages/lib/<名>、packages/<名>、tools（整体是第 1 个捕获组） */
const PACKAGE_ROOT = '(apps/[^/]+|packages/(?:plugins|lib)/[^/]+|packages/(?!plugins/|lib/)[^/]+|tools)';

/**
 * "只许依赖这些"：该包的非测试文件只能落到自己、列出的工作区包与第三方包。
 * Node 内置模块不在此列（各包可用，例外另立规则）。
 */
function onlyAllow(name, from, allow, comment) {
  return {
    name,
    comment,
    severity: 'error',
    from: { path: from, pathNot: TEST_FILES },
    to: { path: [WORKSPACE, '(^|/)node_modules/'], pathNot: [from, ...allow] },
  };
}

/** core 内的层表（§5，从上到下，只能向下调用）；宿主层是 kernel 包，不在 core 里 */
const CORE_LAYERS = [
  { key: 'access', label: '接入', modules: ['gateway', 'toolport'] },
  { key: 'orchestration', label: '编排', modules: ['senses', 'attention', 'will', 'scheduler', 'tasks', 'outbox'] },
  { key: 'runtime', label: '运行', modules: ['minds', 'context', 'actions'] },
  { key: 'ledgers', label: '账本', modules: ['ledgers'] },
  { key: 'resources', label: '资源', modules: ['brains', 'procs', 'formhost', 'abilities', 'workspace', 'notify'] },
  { key: 'guard', label: '守护', modules: ['guard'] },
  // db/ 是 journal 与投影共用的库连接与迁移（§4.3、§6），和 journal 同在最底层
  { key: 'foundation', label: '基础', modules: ['journal', 'db'] },
];
const coreModulesPath = (modules) => `^packages/core/src/(?:${modules.join('|')})/`;
const ALL_CORE_MODULES = CORE_LAYERS.flatMap((layer) => layer.modules);

/** 每一层都不许依赖比它高的任何一层 */
const coreLayerRules = CORE_LAYERS.slice(1).map((layer, index) => {
  const upper = CORE_LAYERS.slice(0, index + 1);
  return {
    name: `core-layer-${layer.key}-not-upward`,
    comment: `core 的${layer.label}层只能向下调用，不许依赖${upper.map((u) => u.label).join('、')}层（docs/engineering.md §5）；向上传信息走经历流订阅或进程内信号`,
    severity: 'error',
    from: { path: coreModulesPath(layer.modules) },
    to: { path: coreModulesPath(upper.flatMap((u) => u.modules)) },
  };
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // —— 通用 ——
    {
      name: 'no-circular',
      comment: '不许循环依赖（同层只调公开 API 且不成环，docs/engineering.md §5）',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: '依赖解析不到：第三方包要写进本包 package.json，工作区包要用 workspace:* 声明',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      comment: '用到的第三方包必须写进最近的 package.json，不靠上层目录碰巧装了',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-test',
      comment: '产品代码不许引用测试文件',
      severity: 'error',
      from: { pathNot: TEST_FILES },
      to: { path: TEST_FILES },
    },
    {
      name: 'not-to-dev-dep',
      comment: '产品代码不许依赖 devDependencies（vitest、testkit 只给测试用）',
      severity: 'error',
      from: { path: '^(apps|packages)/', pathNot: TEST_FILES },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'], pathNot: [npm('@types/[^/]+')] },
    },
    {
      name: 'only-public-entry-across-packages',
      comment: '跨包只能引用对方的公开入口 src/index.ts（及 package.json），不许深引用包内文件（docs/engineering.md §5）',
      severity: 'error',
      from: { path: `^${PACKAGE_ROOT}/` },
      to: {
        path: WORKSPACE,
        pathNot: ['^$1/', `^${PACKAGE_ROOT}/src/index\\.ts$`, `^${PACKAGE_ROOT}/package\\.json$`],
      },
    },

    // —— 包之间（docs/engineering.md §4.2、§4.6）——
    onlyAllow('contracts-only-zod', PKG.contracts, [npm('zod')], 'contracts 零运行时依赖，只许 zod'),
    {
      name: 'contracts-no-node-builtins',
      comment: 'contracts 要能进浏览器（console 用它的协议类型），不许用 Node 内置模块',
      severity: 'error',
      from: { path: PKG.contracts, pathNot: TEST_FILES },
      to: { dependencyTypes: ['core'] },
    },
    onlyAllow('kernel-allowed-deps', PKG.kernel, [PKG.contracts, npm('cordis'), npm('yaml')], 'kernel 只许依赖 contracts、cordis、yaml'),
    onlyAllow(
      'core-allowed-deps',
      PKG.core,
      [PKG.contracts, PKG.kernel, npm('@node-rs/jieba')],
      'core 只许依赖 contracts、kernel、@node-rs/jieba（Node 内置的 node:sqlite、node:worker_threads 等可用）',
    ),
    onlyAllow('testkit-allowed-deps', PKG.testkit, [PKG.contracts, PKG.kernel], 'testkit 只许依赖 contracts、kernel'),
    onlyAllow('brain-shared-allowed-deps', PKG.brainShared, [PKG.contracts, PKG.kernel], 'lib/brain-shared 只许依赖 contracts、kernel'),
    {
      name: 'plugins-not-to-core',
      comment: '插件不直接依赖 core，经 kernel 的服务接口用 core 的能力，保持可替换（测试也不行）',
      severity: 'error',
      from: { path: PKG.plugins },
      to: { path: [PKG.core, '^@liwa/core($|/)'] },
    },
    {
      name: 'plugins-no-child-process',
      comment: '插件不许 import node:child_process，子进程一律经 procs.spawn 先登记再拉起',
      severity: 'error',
      from: { path: PKG.plugins },
      to: { dependencyTypes: ['core'], path: '^(node:)?child_process$' },
    },
    {
      name: 'plugins-workspace-deps',
      comment: '插件在工作区里只许依赖 contracts、kernel（大脑适配器另加 brain-shared）；第三方包自己声明',
      severity: 'error',
      from: { path: '^packages/plugins/([^/]+)/', pathNot: TEST_FILES },
      to: { path: WORKSPACE, pathNot: ['^packages/plugins/$1/', PKG.contracts, PKG.kernel, PKG.brainShared] },
    },
    {
      name: 'brain-shared-only-for-brains',
      comment: 'lib/brain-shared 只给三个大脑适配器（plugins/brain-*）用',
      severity: 'error',
      from: { path: PKG.plugins, pathNot: '^packages/plugins/brain-' },
      to: { path: PKG.brainShared },
    },
    {
      name: 'testkit-only-in-tests',
      comment: 'testkit 只在测试里用（replay 例外，它的回放与指标建在 testkit 上）',
      severity: 'error',
      from: { path: '^(apps|packages)/', pathNot: [...TEST_FILES, PKG.testkit, PKG.replay] },
      to: { path: PKG.testkit },
    },
    {
      name: 'clients-only-contracts',
      comment: 'console、cli、desktop 在工作区里只依赖 contracts（协议类型），不依赖 core 与 kernel',
      severity: 'error',
      from: { path: '^packages/(console|cli|desktop)/', pathNot: TEST_FILES },
      to: { path: WORKSPACE, pathNot: ['^packages/$1/', PKG.contracts] },
    },
    onlyAllow('console-allowed-deps', PKG.console, [PKG.contracts, npm('react'), npm('react-dom')], 'console 只许依赖 contracts、react'),
    onlyAllow('cli-allowed-deps', PKG.cli, [PKG.contracts], 'cli 只许依赖 contracts'),
    onlyAllow(
      'replay-allowed-deps',
      PKG.replay,
      [PKG.contracts, PKG.kernel, PKG.core, PKG.app, PKG.testkit],
      'replay 只许依赖 contracts、kernel、core 与 app 的公开入口、testkit',
    ),

    // —— core 内（docs/engineering.md §4.3、§5）——
    {
      name: 'core-module-in-layer-table',
      comment: 'core/src 下的模块目录必须登记在层表里，否则依赖方向无从检查（层表在本文件 CORE_LAYERS，与 §5 同步）',
      severity: 'error',
      from: { path: '^packages/core/src/[^/]+/', pathNot: `^packages/core/src/(?:${[...ALL_CORE_MODULES, '__tests__'].join('|')})/` },
      to: {},
    },
    {
      name: 'core-module-only-via-index',
      comment: 'core 内跨模块只能引用对方的 index.ts，不许深引用（docs/engineering.md §5）',
      severity: 'error',
      from: { path: '^packages/core/src/(ledgers/[^/]+|[^/]+)/' },
      to: {
        path: '^packages/core/src/(?:ledgers/[^/]+|[^/]+)/',
        pathNot: ['^packages/core/src/$1/', '^packages/core/src/(?:ledgers/[^/]+|[^/]+)/index\\.ts$'],
      },
    },
    ...coreLayerRules,
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // 只排除工作区里的构建产物；第三方包的入口常在它自己的 dist/ 下，不能一并排除
    exclude: { path: '^(apps/[^/]+|packages/[^/]+|packages/(plugins|lib)/[^/]+)/(dist|coverage)/' },
    // 纯类型的 import 也算依赖：类型同样不许越层、越包
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      // liwa-source 放第一位：与 tsconfig.base.json 的 customConditions 一致
      conditionNames: ['liwa-source', 'import', 'require', 'node', 'default'],
      mainFields: ['main', 'types'],
    },
  },
};
