// ESLint 平面配置（docs/engineering.md §4.1、§5、§9）：
// 把"时钟、随机、编号一律注入""定时器只许 kernel 与 procs""不用默认导出""不用 any""跨包只走公开入口"变成机器检查。
// 规则只用内置的 no-restricted-syntax / no-restricted-properties / no-restricted-globals；
// TypeScript 文件只借 @typescript-eslint/parser 解析，不引入它的规则集。
import tsParser from '@typescript-eslint/parser';

const INJECT_HINT = '经 kernel 注入的 Clock / Rng / Ids 取用（docs/engineering.md §5，L0 可回放的前提）';
const TIMER_HINT = '经 kernel 注入的可控定时器；只有 packages/kernel 与 packages/core/src/procs 可以直接用';
const NO_DEFAULT_EXPORT = '不用默认导出，一律具名导出（插件入口也是 export const plugin，docs/engineering.md §9）';

/** 系统时钟与随机源：属性访问（含解构） */
const CLOCK_RANDOM_PROPERTIES = [
  { object: 'Date', property: 'now', message: `不许直接读系统时钟：${INJECT_HINT}` },
  { object: 'performance', property: 'now', message: `不许直接读单调钟：${INJECT_HINT}` },
  { object: 'Math', property: 'random', message: `不许直接用系统随机：${INJECT_HINT}` },
  // 不限定对象：crypto、globalThis.crypto、webcrypto 上的都算
  { property: 'randomUUID', message: `不许自己生成编号：${INJECT_HINT}` },
  { property: 'getRandomValues', message: `不许直接用系统随机：${INJECT_HINT}` },
];

/** 系统时钟与随机源：语法形式 */
const CLOCK_RANDOM_SYNTAX = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: `不许用无参 new Date() 读系统时钟：${INJECT_HINT}`,
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message: `不许用 Date() 读系统时钟：${INJECT_HINT}`,
  },
  {
    selector:
      "ImportDeclaration[source.value=/^(node:)?crypto$/] ImportSpecifier[imported.name=/^(randomUUID|getRandomValues)$/]",
    message: `不许从 crypto 取随机数或编号：${INJECT_HINT}`,
  },
];

/** 定时器：全局、globalThis 上的、从 timers 模块导入的 */
const TIMER_GLOBALS = [
  { name: 'setTimeout', message: `不许直接用 setTimeout：${TIMER_HINT}` },
  { name: 'setInterval', message: `不许直接用 setInterval：${TIMER_HINT}` },
];
const TIMER_PROPERTIES = [
  { object: 'globalThis', property: 'setTimeout', message: `不许直接用 setTimeout：${TIMER_HINT}` },
  { object: 'globalThis', property: 'setInterval', message: `不许直接用 setInterval：${TIMER_HINT}` },
];
const TIMER_SYNTAX = [
  {
    // esquery 的正则里不能直接写斜杠，用 \x2F 代替
    selector:
      "ImportDeclaration[source.value=/^(node:)?timers(\\x2Fpromises)?$/] ImportSpecifier[imported.name=/^(setTimeout|setInterval)$/]",
    message: `不许从 timers 模块导入定时器：${TIMER_HINT}`,
  },
];

const NO_DEFAULT_EXPORT_SYNTAX = [
  { selector: 'ExportDefaultDeclaration', message: NO_DEFAULT_EXPORT },
  { selector: "ExportSpecifier[exported.name='default']", message: NO_DEFAULT_EXPORT },
];

const NO_ANY_SYNTAX = [
  { selector: 'TSAnyKeyword', message: '不用 any：用 unknown 再收窄，或写出具体类型（docs/engineering.md §9）' },
];

/** 跨包只经包名的公开入口（各包 exports 只开放 "." 与 "./package.json"）；包内跨模块深引用由 dependency-cruiser 管 */
const PUBLIC_ENTRY_SYNTAX = [
  {
    // 匹配 import / export ... from / import() 里的 @liwa/<包>/<子路径>
    selector: '[source.value=/^@liwa\\x2F[^\\x2F]+\\x2F(?!package\\.json$)/]',
    message: '跨包只能引用 @liwa/* 的公开入口，不许深引用包内文件（docs/engineering.md §5）',
  },
];

/**
 * 规则设置：清单为空时关掉。只写 'error' 不带选项会沿用前面配置块的选项，起不到放开的作用。
 */
function restrict(entries) {
  return entries.length > 0 ? ['error', ...entries] : 'off';
}

/**
 * 组装三条 no-restricted-* 规则。后面的配置块会整条覆盖前面同名规则的选项，
 * 所以每个场合都整组重给，只按需去掉其中一类。
 */
function restrictions({ allowTimers = false, allowDefaultExport = false } = {}) {
  return {
    'no-restricted-properties': restrict([...CLOCK_RANDOM_PROPERTIES, ...(allowTimers ? [] : TIMER_PROPERTIES)]),
    'no-restricted-globals': restrict(allowTimers ? [] : TIMER_GLOBALS),
    'no-restricted-syntax': restrict([
      ...CLOCK_RANDOM_SYNTAX,
      ...(allowTimers ? [] : TIMER_SYNTAX),
      ...(allowDefaultExport ? [] : NO_DEFAULT_EXPORT_SYNTAX),
      ...NO_ANY_SYNTAX,
      ...PUBLIC_ENTRY_SYNTAX,
    ]),
  };
}

export default [
  { ignores: ['**/dist/**', '**/coverage/**', 'docs/**'] },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    languageOptions: { parser: tsParser },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    rules: restrictions(),
  },
  {
    // 可控定时器的真实现在 kernel；procs 的进程看门狗要用真定时器
    files: ['packages/kernel/**', 'packages/core/src/procs/**'],
    rules: restrictions({ allowTimers: true }),
  },
  {
    // 根目录的工具配置文件按各自工具的约定用默认导出
    files: ['eslint.config.js', 'vitest.config.ts'],
    rules: restrictions({ allowDefaultExport: true }),
  },
];
