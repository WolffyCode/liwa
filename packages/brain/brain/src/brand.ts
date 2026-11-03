/**
 * 跨大脑提供方边界的不透明标识。每种品牌让提供方或 brains 给出的字符串在编译期互不混用；
 * 构造函数只打品牌、不校验，校验由 `contract.ts` 的 zod schema 在需要的边界上做。
 * @module @liwa/brain/brand
 */

import type { Branded } from '@liwa/brand'

/** 提供方实现名（`deepseek`、`claude`、`codex`、`acp` 等），在 `ctx.brains` 里唯一。 */
export type ImplId = Branded<'BrainImplId'>
/** `ctx.brains` 分配的会话号；一个句柄的生命期内不变。 */
export type BrainSessionId = Branded<'BrainSessionId'>
/** 提供方给的回合号，由 `startTurn` 返回。 */
export type TurnId = Branded<'BrainTurnId'>
/** 提供方给的流式条目号（消息或思考）。 */
export type ItemId = Branded<'BrainItemId'>
/** 提供方给的工具调用号。 */
export type CallId = Branded<'BrainCallId'>
/** 提供方给的权限请求号。 */
export type PermissionRequestId = Branded<'BrainPermissionRequestId'>
/** 提供方自己的子 agent 号（Claude 的 task id、Codex 的线程号、deepseek 的子会话号）。 */
export type ChildId = Branded<'BrainChildId'>
/** 会话所属成员。 */
export type MemberId = Branded<'BrainMemberId'>
/** `ctx.brains` 登记一次拉起时分配的进程号。 */
export type BrainProcessId = Branded<'BrainProcessId'>

/**
 * 给提供方实现名打品牌。
 * @param value - 提供方插件定的名字。
 * @returns 同一字符串，类型为 {@link ImplId}。
 */
export function ImplId(value: string): ImplId {
  return value as ImplId
}

/**
 * 给 brains 分配的会话号打品牌。
 * @param value - `ctx.brains` 生成的会话号。
 * @returns 同一字符串，类型为 {@link BrainSessionId}。
 */
export function BrainSessionId(value: string): BrainSessionId {
  return value as BrainSessionId
}

/**
 * 给提供方的回合号打品牌。
 * @param value - 提供方为一个回合生成的号。
 * @returns 同一字符串，类型为 {@link TurnId}。
 */
export function TurnId(value: string): TurnId {
  return value as TurnId
}

/**
 * 给提供方的流式条目号打品牌。
 * @param value - 一条消息或思考的号。
 * @returns 同一字符串，类型为 {@link ItemId}。
 */
export function ItemId(value: string): ItemId {
  return value as ItemId
}

/**
 * 给提供方的工具调用号打品牌。
 * @param value - 一次工具调用的号。
 * @returns 同一字符串，类型为 {@link CallId}。
 */
export function CallId(value: string): CallId {
  return value as CallId
}

/**
 * 给提供方的权限请求号打品牌。
 * @param value - 一次权限请求的号。
 * @returns 同一字符串，类型为 {@link PermissionRequestId}。
 */
export function PermissionRequestId(value: string): PermissionRequestId {
  return value as PermissionRequestId
}

/**
 * 给提供方自己的子 agent 号打品牌。
 * @param value - 提供方运行时里一个子 agent 的号。
 * @returns 同一字符串，类型为 {@link ChildId}。
 */
export function ChildId(value: string): ChildId {
  return value as ChildId
}

/**
 * 给成员名打品牌。
 * @param value - 成员层定的成员名。
 * @returns 同一字符串，类型为 {@link MemberId}。
 */
export function MemberId(value: string): MemberId {
  return value as MemberId
}

/**
 * 给 brains 分配的进程号打品牌。
 * @param value - `ctx.brains` 为一次登记的拉起生成的号。
 * @returns 同一字符串，类型为 {@link BrainProcessId}。
 */
export function BrainProcessId(value: string): BrainProcessId {
  return value as BrainProcessId
}
