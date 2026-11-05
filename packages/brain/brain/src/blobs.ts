/**
 * 回合输入里图片等二进制的落点（`BlobRef`）。契约用内容寻址的引用（sha256、字节数、MIME），这一阶段还没有
 * 经历流的 blob 存储，所以 brains 自带一个最小的本地存储：每个 blob 一个文件 `<目录>/<sha256>`，写入先落临时
 * 文件再改名，读出时核对字节数与哈希。调用方经 `ctx.brains.blobs.put` 存、拿到引用放进 `TurnInput`；提供方经
 * 启动上下文的 `readBlob` 取回字节交给 CLI。以后换成经历流的存储时只换这里的实现，引用形状不变。
 * @module @liwa/brain/blobs
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BlobRefSchema, type BlobRef } from './contract.ts'
import { BrainError } from './errors.ts'

/** 一个回合输入 blob 的读写。 */
export interface BrainBlobReader {
  /**
   * 取回一个 blob 的字节。
   * @param ref - 回合输入里的引用。
   * @returns 字节；与引用的字节数、哈希都相符。
   * @throws {BrainError} `not_found`（没有这个 blob）、`invalid_input`（内容与引用不符）。
   */
  readBlob(ref: BlobRef): Promise<Uint8Array>
}

/** 内容寻址的本地 blob 存储。 */
export class BrainBlobStore implements BrainBlobReader {
  /**
   * @param dir - 存放 blob 的目录（第一次写入时建）。
   */
  constructor(readonly dir: string) {}

  /**
   * 存一个 blob；同样的字节存两次得到同一个引用。
   * @param bytes - 内容。
   * @param mime - 内容类型（例如 `image/png`）。
   * @returns 引用。
   */
  async put(bytes: Uint8Array, mime: string): Promise<BlobRef> {
    const ref = BlobRefSchema.parse({ blob: sha256(bytes), bytes: bytes.byteLength, mime })
    await mkdir(this.dir, { recursive: true })
    const target = join(this.dir, ref.blob)
    const temporary = join(this.dir, `.${ref.blob}.${randomUUID()}.tmp`)
    await writeFile(temporary, bytes, { mode: 0o600 })
    try {
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
    return ref
  }

  /** @inheritdoc */
  async readBlob(ref: BlobRef): Promise<Uint8Array> {
    const parsed = BlobRefSchema.safeParse(ref)
    if (!parsed.success) throw new BrainError('invalid_input', 'brain.blob_ref_invalid', `blob reference is invalid: ${parsed.error.message}`)
    let bytes: Uint8Array
    try {
      bytes = await readFile(join(this.dir, parsed.data.blob))
    } catch (error) {
      throw new BrainError('not_found', 'brain.blob_missing', `blob ${parsed.data.blob} is not in ${this.dir}; store it with ctx.brains.blobs.put first`, { cause: error })
    }
    if (bytes.byteLength !== parsed.data.bytes || sha256(bytes) !== parsed.data.blob) {
      throw new BrainError('invalid_input', 'brain.blob_mismatch', `blob ${parsed.data.blob} does not match its reference (size or hash differs)`)
    }
    return bytes
  }
}

/**
 * 内容的 sha256（小写十六进制）。
 * @param bytes - 内容。
 * @returns 64 位十六进制。
 */
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
