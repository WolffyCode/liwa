/**
 * 契约的回合输入（`TurnInput`）到 Paseo 提示词内容块的翻译。具名的灵鲸块渲染成
 * `<liwa-block name="…">…</liwa-block>`，块里的结束标记被转义，模型不会把正文误读成块的结尾；图片块按
 * `BlobRef` 从 brains 的 blob 存储取回字节，成为 Paseo 的内联图片块（`{ type: 'image', data, mimeType }`），
 * 由各家 CLI 适配器翻成原生图片输入（ACP 的 image 内容块等）。
 * @module @liwa/brain-shared/turn-input
 */

import { Buffer } from 'node:buffer'
import { BrainError, type BrainBlobReader, type TurnInput, type TurnInputBlock } from '@liwa/brain'
import type { AgentPromptContentBlock } from './paseo/agent/agent-sdk-types.ts'

/** 灵鲸块的标签名。 */
export const LIWA_BLOCK_TAG = 'liwa-block'

/**
 * 转义块正文里会提前结束块的标记。
 * @param text - 块正文。
 * @returns 不含 `</liwa-block` 的正文。
 */
function escapeBlockText(text: string): string {
  return text.replaceAll(`</${LIWA_BLOCK_TAG}`, `<\\/${LIWA_BLOCK_TAG}`)
}

/**
 * 渲染一个具名灵鲸块。
 * @param name - 块名（如 `前缀`）。
 * @param text - 块正文。
 * @returns 带开闭标签的文本。
 */
export function renderLiwaBlock(name: string, text: string): string {
  const attribute = name.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  return `<${LIWA_BLOCK_TAG} name="${attribute}">\n${escapeBlockText(text)}\n</${LIWA_BLOCK_TAG}>`
}

/**
 * 一块文本类回合输入的文本形式。
 * @param block - 文本块或具名块。
 * @returns 文本。
 */
function blockText(block: Exclude<TurnInputBlock, { kind: 'image' }>): string {
  switch (block.kind) {
    case 'text':
      return block.text
    case 'block':
      return renderLiwaBlock(block.name, block.text)
  }
}

/**
 * 一块图片输入 → Paseo 内联图片块。
 * @param block - 图片块。
 * @param blobs - blob 字节来源。
 * @returns Paseo 图片块。
 * @throws {BrainError} `invalid_input`（引用的不是图片）、blob 存储的失败（缺失、内容不符）。
 */
async function imageBlock(block: Extract<TurnInputBlock, { kind: 'image' }>, blobs: BrainBlobReader): Promise<AgentPromptContentBlock> {
  if (!block.blob.mime.startsWith('image/')) {
    throw new BrainError('invalid_input', 'brain.image_mime', `image turn input must reference an image, not ${block.blob.mime}`)
  }
  const bytes = await blobs.readBlob(block.blob)
  return { type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: block.blob.mime }
}

/**
 * 把回合输入翻成 Paseo 的提示词内容块：按顺序，文本各成一块，图片取回字节成内联图片块。
 * @param input - 回合输入。
 * @param blobs - 图片引用的字节来源。
 * @returns Paseo 提示词内容块。
 */
export async function toPaseoPrompt(input: TurnInput, blobs: BrainBlobReader): Promise<AgentPromptContentBlock[]> {
  return Promise.all(input.blocks.map(block => (block.kind === 'image'
    ? imageBlock(block, blobs)
    : Promise.resolve<AgentPromptContentBlock>({ type: 'text', text: blockText(block) }))))
}

/**
 * 回合输入的纯文本（只收文本的通道用）。
 * @param input - 回合输入。
 * @returns 各块文本以空行连接。
 * @throws {BrainError} `invalid_input`：含图片块（只收文本的通道送不了图片）。
 */
export function turnInputText(input: TurnInput): string {
  return input.blocks.map((block) => {
    if (block.kind === 'image') throw new BrainError('invalid_input', 'brain.image_input_unsupported', 'this channel takes text only; send images as a turn input')
    return blockText(block)
  }).join('\n\n')
}
