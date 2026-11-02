/**
 * Reject the upstream product's names outside the registered exceptions. The code base was forked from
 * DeepSeek Harness and renamed to Liwa (灵鲸) in Liwa decision 40; merges and new code must not bring the old
 * names back. DeepSeek stays the name of the model and API provider, so the bare word `DeepSeek` is not checked.
 *
 * Blocked: the product name in any spelling (`DeepSeek Harness`, `deepseek-harness`, `deepseek_harness`,
 * `DeepSeekHarness`), the upstream npm scope `@deepseek-ai/`, and the abbreviation `dsh` / `Dsh` / `DSH` as a
 * word or identifier part (`DSH_HOME`, `dshHome`, `.dsh`), in tracked paths and text.
 *
 * Register a new exception in {@link ALLOWED_SPANS} (a span that may stay, optionally limited to some files) or
 * {@link EXCLUDED_PATHS} (a whole file), always with the reason the old name has to stay.
 * @module scripts/verify-brand-terms
 */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readTrackedSource } from './verify-concrete-terms.ts'

const root = resolve(import.meta.dirname, '..')

const BLOCKED: readonly RegExp[] = [
  /deep[\s_-]?seek[\s_-]?harness/giu,
  /@deepseek-ai\//gu,
  /(?<![A-Za-z0-9])dsh(?![a-z])|(?<![A-Z])Dsh(?![a-z])|(?<![A-Z])DSH(?![A-Z])/gu,
  // The same word right after an escape sequence or a percent-encoded separator (`\ndsh:`, `\0dsh-css`, `%2Fdsh-v1`).
  /(?:\\(?:[nrtbfv0e]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})|%2[fF]|%3[aA])(?:dsh(?![a-z])|Dsh(?![a-z])|DSH(?![A-Z]))/gu,
]

/** One old-name span that has to stay, and why. */
export interface BrandException {
  /** Why the old name cannot change. */
  readonly reason: string
  /** The span that may stay. */
  readonly pattern: RegExp
  /** Limits the exception to matching repository-relative paths; omitted means every file. */
  readonly files?: RegExp
}

const FORK_ORIGIN_FILES = /^(?:AGENTS\.md|README(?:\.zh)?\.md)$/u

/** One global span pattern matching any alternative, so long exception lists stay one alternative per line. */
function anySpan(...alternatives: readonly RegExp[]): RegExp {
  return new RegExp(alternatives.map(alternative => alternative.source).join('|'), 'gu')
}

/** Old-name spans that stay, grouped by owner; every entry names its reason. */
export const ALLOWED_SPANS: readonly BrandException[] = [
  {
    reason: 'DeepSeek publishes @deepseek-ai/libreoffice-kit and its platform packages on npm; the names are theirs.',
    pattern: /@deepseek-ai\/libreoffice-kit[\w.-]*|deepseek-ai\/dsh-libreoffice-kit|['"`]@deepseek-ai['"`],\s*['"`]libreoffice-kit/gu,
  },
  {
    reason: 'Addresses of DeepSeek servers (account sign-in, telemetry, model API) are registered by DeepSeek.',
    pattern: /(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)*deepseek(?:svc)?\.(?:com|cn|test|invalid)\b(?::\d+)?(?:\/[^\s"'`<>)\]\\|,]*)?/gu,
  },
  {
    reason: 'The DeepSeek account platform protocol: endpoint paths, the auth header, its mock token prefix, and its campaign ids.',
    pattern: /\/auth-api\/v0\/dsh\/|\/dsh\/authorized?(?![\w-])|x-dsh-auth-token|dsh_mock_|dsh_login_bonus/giu,
  },
  {
    reason: 'DeepSeek model API wire extensions are defined by the DeepSeek API: the request-body fields under its '
      + 'reserved dsh_ prefix (and their heading anchors).',
    pattern: anySpan(
      /\bdsh[_-](?:session[_-]log|plugin[_-]packages)\b/u,
      /reserved `dsh_` prefix|保留 `dsh_` 前缀/u,
    ),
  },
  {
    reason: 'The DeepSeek model listing keys client requirements and metadata by the client name deepseek-harness.',
    pattern: anySpan(
      /export const LISTING_CLIENT = 'deepseek-harness'/u,
      /client_(?:requirements|metadata)(?:\[\\?"|: \{ ')deepseek-harness/u,
      /client_(?:requirements|metadata)\\?\[\\?"deepseek-harness/u,
    ),
  },
  {
    reason: 'DeepSeek Platform pages embedded in the desktop app read the account bridge as window.dsh.',
    pattern: /exposeInMainWorld\('dsh'|bridges\.get\('dsh'\)|`window\.dsh`/gu,
    files: /^apps\/desktop\/(?:src\/preload-platform-account\.ts|tests\/platform-preload\.e2e\.ts)$/u,
  },
  {
    reason: 'The DeepSeek telemetry collector routes product telemetry by its x-channel value.',
    pattern: /dsh_otel_report/gu,
  },
  {
    reason: 'Upstream issues, pull requests, commits, forks and actions are cited at their upstream location.',
    pattern: anySpan(
      new RegExp(String.raw`(?:https?:\/\/)?(?:www\.)?github\.com\/(?:deepseek-ai|deepseek-harness)\/deepseek-harness\/`
        + String.raw`(?:pull|pulls|issues|commit|commits|compare)\/[^\s"'\x60<>)\]]*`, 'u'),
      /(?:deepseek-ai|deepseek-harness)\/deepseek-harness#\d+/u,
      /--repo deepseek-harness\/deepseek-harness/u,
      /github\.com\/deepseek-harness\/(?:cosmokit|schemastery)/u,
      /deepseek-harness\/deepseek-harness-check@\w*/u,
    ),
  },
  {
    reason: 'The current Session format persists the title source kind dsh-session-title-llm; renaming it is a format change.',
    pattern: /dsh-session-title-llm/gu,
  },
  {
    reason: 'Historical Session formats (V0–V3) recorded these upstream plugin names; migrations must still recognize them.',
    pattern: /@deepseek-ai\/dsh-system-prompt|dsh-compaction-basic/gu,
  },
  {
    reason: 'Digest domains baked into every recorded persistence digest.',
    pattern: /dsh-persistence-schema-v|dsh-persistence-finalization-record-v1/gu,
    files: /^scripts\/persistence-(?:schema-model|finalization)\.ts$/u,
  },
  {
    reason: 'Agent Notes keep their upstream file names; links into them use those names.',
    pattern: /\.agents\/notes\/[\w./-]*/gu,
  },
  {
    reason: 'The fork origin and the forbidden-name list name the upstream product; the dsh-base branch and liwa-dsh directory are renamed later by the owner.',
    pattern: anySpan(
      /（DeepSeek Harness、DSH、`dsh`、`@deepseek-ai\/dsh-\*`）/u,
      /DeepSeek Harness/u,
      /github\.com\/deepseek-ai\/deepseek-harness/u,
      /dsh-base/u,
    ),
    files: FORK_ORIGIN_FILES,
  },
  {
    reason: 'The working directory of the dsh-base branch is renamed later by the owner.',
    pattern: /liwa-dsh(?:-new)?/gu,
  },
]

/** Whole files that keep the upstream names, and why. */
export const EXCLUDED_PATHS: readonly { readonly reason: string; readonly pattern: RegExp }[] = [
  { reason: 'Upstream design history; only links broken by the rename are repaired.', pattern: /^\.agents\/notes\//u },
  { reason: 'MIT copyright and upstream attribution must be retained.', pattern: /^(?:LICENSE|THIRD_PARTY_NOTICES\.md)$/u },
  { reason: 'Recorded sessions keep the model output and user input they were recorded with until re-recorded.', pattern: /^snapshots\/.*(?:\.jsonl|\.expected\.[a-z]+)$/u },
  { reason: 'Python SDK recordings quote documentation verbatim and are re-recorded by the Python runtime lane.', pattern: /^scripts\/snapshots\//u },
  { reason: 'This policy and its tests spell the blocked names.', pattern: /^scripts\/verify-brand-terms(?:\.spec)?\.ts$/u },
]

/** One old-name occurrence in a tracked path or text line. */
export interface BrandTermViolation {
  /** Repository-relative tracked path. */
  readonly file: string
  /** One-based source line, or null when the path contains the name. */
  readonly line: number | null
  /** The matched old name. */
  readonly match: string
}

function isExcluded(file: string): boolean {
  return EXCLUDED_PATHS.some(entry => entry.pattern.test(file))
}

function maskAllowedSpans(file: string, line: string): string {
  let masked = line
  for (const exception of ALLOWED_SPANS) {
    if (exception.files !== undefined && !exception.files.test(file)) continue
    masked = masked.replace(exception.pattern, span => ' '.repeat(span.length))
  }
  return masked
}

function blockedMatches(text: string): string[] {
  return BLOCKED.flatMap(pattern => [...text.matchAll(pattern)].map(match => match[0]))
}

/**
 * Find upstream product names in one tracked file outside the registered exceptions.
 * @param file - repository-relative tracked path.
 * @param source - text contents or symlink target.
 * @returns every violation in the path and in each line.
 */
export function findBrandTermViolations(file: string, source: string): BrandTermViolation[] {
  if (isExcluded(file)) return []
  const violations: BrandTermViolation[] = []
  for (const match of blockedMatches(maskAllowedSpans(file, file))) violations.push({ file, line: null, match })
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    for (const match of blockedMatches(maskAllowedSpans(file, line))) violations.push({ file, line: index + 1, match })
  }
  return violations
}

function scanRepository(repoRoot: string): BrandTermViolation[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(file => file !== '')
  const violations: BrandTermViolation[] = []
  for (const file of files) {
    const source = readTrackedSource(repoRoot, file)
    if (source === undefined) continue
    violations.push(...findBrandTermViolations(file, source))
  }
  return violations
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  const violations = scanRepository(root)
  if (violations.length === 0) {
    console.log('verify-brand-terms: tracked files carry no upstream product name outside the registered exceptions.')
  } else {
    console.error('verify-brand-terms: upstream product names are forbidden; use Liwa / 灵鲸 / liwa / LIWA_ / @liwa/, or register an exception in scripts/verify-brand-terms.ts:')
    for (const violation of violations) {
      const where = violation.line === null ? `${violation.file} (path)` : `${violation.file}:${String(violation.line)}`
      console.error(`  ${where}  ${violation.match}`)
    }
    process.exitCode = 1
  }
}
