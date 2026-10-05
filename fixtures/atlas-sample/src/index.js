/**
 * 入口：图谱样例的装配点。
 * 说清职责：把若干模块拼起来并暴露 main。
 */
import { slugify } from './lib/util.js'
import missing from './lib/missing.js'
import fs from 'node:fs'

const lazy = () => import('./lib/util.js')

// 必须：main 只做装配，不做 IO 副作用
export async function main() {
  const name = slugify('Hello World')
  return { name, hasFs: Boolean(fs), lazy, missing }
}
