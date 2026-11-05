/**
 * 每个 `deepseek` 会话的会话 patch 与规矩文件（01 §4.1、§4.6）：写在该会话的 `LIWA_HOME` 下，patch 作为家目录层的
 * 用户 patch（`$LIWA_HOME/cordis.patch.yml`，压过 profile 自己的层），所以拉起命令永远是 `liwa --profile deepseek`。
 * 每次拉起（开会话与续接）都按这一代的配置重写，会话策略因此一定与这一代的 `SessionConfig` 一致：
 *
 * - 模型路由读哪个密钥名；给了模型时的默认模型；
 * - 人设十段作进程级 `personaPrefix`（并去掉第一方开场白）；
 * - 这一代会话种类对应的默认预设；
 * - 仓库指令（`projectDocs`）：`agent-instructions` 读不读被干活仓库的 `AGENTS.md` / `CLAUDE.md`；灵鲸规矩（`rules`）
 *   写成 `$LIWA_HOME/AGENTS.md`，由同一个插件作为用户级指令读进来，两样都没有就不挂它；
 * - 本事（`skillsDir`）：`skill-filesystem` 把它作为自定义根读，`projectDocs` 时再加仓库自带的本事；都没有就不挂
 *   本事插件与 `skill` 工具；
 * - 压缩（`compaction`）：`off` 时不挂压缩器与工具结果修剪。
 *
 * 原生工具策略（`nativeToolPolicy`）与子会话策略是每个会话的协议参数，经 `_meta.liwa` 交给 `_liwa` 扩展落实。
 * @module @liwa/brain-deepseek/session-patch
 */

import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rulesDocument, type SessionConfig } from '@liwa/brain'

/** 会话 patch 在会话 home 里的文件名（启动器的家目录层）。 */
export const SESSION_PATCH_FILE = 'cordis.patch.yml'
/** 灵鲸规矩在会话 home 里的文件名（`agent-instructions` 的用户级指令）。 */
export const RULES_FILE = 'AGENTS.md'

/** 生成会话 patch 需要的部署项。 */
export interface SessionPatchSettings {
  /** 模型路由（`agent-default-model` 的 provider）。 */
  provider: string
  /** 模型路由读密钥的环境变量名（值由本体经环境注入）。 */
  apiKeyEnv: string
  /** 预设 id 前缀。 */
  presetPrefix: string
  /** 仓库指令与规矩每条链的字节上限（`agent-instructions.maxBytes`）。 */
  instructionsMaxBytes: number
}

/** 一条 cordis patch 行。 */
interface PatchRow {
  id: string
  disabled?: boolean
  config?: Record<string, unknown>
}

/**
 * 一个会话的 patch 行。
 * @param config - 这一代的会话配置。
 * @param settings - 部署项。
 * @returns patch 行（按应用顺序）。
 */
export function sessionPatchRows(config: SessionConfig, settings: SessionPatchSettings): PatchRow[] {
  const rows: PatchRow[] = [
    { id: 'llm-deepseek', config: { apiKeyEnv: settings.apiKeyEnv } },
    { id: 'agent-preset-registry', config: { default: `${settings.presetPrefix}${config.mindKind}` } },
  ]
  // 人设十段为空（例如命令行试用）时保留 deepseek-app 自己的人设行。
  if (config.persona.stable.trim() !== '') {
    rows.push({ id: 'system-prompt', config: { personaPrefix: config.persona.stable, includeLiwaIdentity: false } })
  }
  // 不给模型就不写占位值，进程用自己的默认模型。
  if (config.model !== undefined) {
    rows.push({ id: 'agent-default-model', config: { provider: settings.provider, model: config.model } })
  }
  const instructions = config.projectDocs || config.rules.trim() !== ''
  rows.push({
    id: 'agent-instructions',
    disabled: !instructions,
    config: {
      maxBytes: settings.instructionsMaxBytes,
      // 不读仓库指令：仓库里的候选文件一个都不认，只剩用户级（灵鲸规矩）那一条链。
      ...(config.projectDocs ? {} : { instructionFileCandidates: [], localInstructionFileCandidates: [] }),
    },
  })
  const skills = config.skillsDir !== '' || config.projectDocs
  rows.push(
    {
      id: 'skill-filesystem',
      disabled: !skills,
      config: {
        // 默认根是仓库的 `.liwa/skills`、`.agents/skills` 与 home 下的；home 在会话目录里（灵鲸管），仓库的只在读仓库指令时要。
        includeDefaultRoots: config.projectDocs,
        customSkillDirs: config.skillsDir === '' ? [] : [config.skillsDir],
      },
    },
    { id: 'tool-skill', disabled: !skills },
  )
  const compaction = config.compaction === 'provider'
  rows.push({ id: 'compaction-basic', disabled: !compaction }, { id: 'tool-result-pruner', disabled: !compaction })
  return rows
}

/**
 * 写会话 patch。YAML 是 JSON 的超集，按 JSON 写可以原样保留任何人设文本，不必处理 YAML 转义。
 * @param homeDir - 会话 home（它的 `LIWA_HOME`）。
 * @param config - 这一代的会话配置。
 * @param settings - 部署项。
 * @returns patch 文件的路径。
 */
export async function writeSessionPatch(homeDir: string, config: SessionConfig, settings: SessionPatchSettings): Promise<string> {
  const path = join(homeDir, SESSION_PATCH_FILE)
  const header = '# Written by @liwa/brain-deepseek for this session; rewritten at every launch.\n'
  await writeFile(path, `${header}${JSON.stringify(sessionPatchRows(config, settings), null, 2)}\n`)
  return path
}

/**
 * 写（或撤掉）这一代的灵鲸规矩：`$LIWA_HOME/AGENTS.md`，开头是"本交接优先于通用指令"。
 * @param homeDir - 会话 home。
 * @param rules - 规矩文本；为空时删掉旧文件。
 * @returns 规矩文件的路径；没有规矩时为 `undefined`。
 */
export async function writeRules(homeDir: string, rules: string): Promise<string | undefined> {
  const path = join(homeDir, RULES_FILE)
  if (rules.trim() === '') {
    await rm(path, { force: true })
    return undefined
  }
  await writeFile(path, rulesDocument(rules))
  return path
}
