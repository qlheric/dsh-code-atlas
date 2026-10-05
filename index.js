/**
 * dsh-code-atlas —— 代码图谱：tree-sitter WASM 符号索引 + 仓库地图 + 每文件一行 F/R/A/S 认知层。
 *
 * 设计约束（刻意的）：
 *   1. **零原生编译**：tree-sitter 走 WASM（`web-tree-sitter` + `tree-sitter-wasms`），不装编译器。
 *   2. **解析器是增强不是单点**：拿不到语法 ⇒ 自动退回正则层，索引照常产出（符号标 `source: regex`）。
 *   3. **不臆造**：S（约束）只给带行号出处的候选；拿不到就说 null/空，不编。
 *   4. **注册即 effect**：任一工具注册失败 → 逆序回滚，绝不留"注册了一半"。
 *   5. **参数 schema 只用 rc.2 允许的词汇**（type/required(仅 true)/description/default/enum/items）。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { TOOLS } from './lib/tools.js'

export const name = '@qlheric/dsh-code-atlas'
export const inject = ['tools']

export function apply(ctx) {
  const disposers = []
  const registered = []
  try {
    for (const spec of TOOLS) {
      disposers.push(ctx.tools.register(defineTool(spec)))
      registered.push(spec.name)
    }
  } catch (error) {
    for (const dispose of [...disposers].reverse()) {
      try {
        dispose()
      } catch {
        /* 回滚失败不掩盖原始错误 */
      }
    }
    throw new Error(
      `dsh-code-atlas: 注册失败（已回滚 ${registered.length} 个：${registered.join(', ') || '无'}）：${String(error?.message ?? error)}`,
    )
  }
  console.log(`[dsh-code-atlas] 已注册 ${registered.length} 个工具：${registered.join(', ')}`)
  return () => {
    for (const dispose of [...disposers].reverse()) {
      try {
        dispose()
      } catch {
        /* 卸载期异常不外抛 */
      }
    }
  }
}
