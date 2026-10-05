/**
 * atlas —— 装配层：**WASM 优先 + 正则补位**，带磁盘缓存与检索。
 *
 * 符号合并口径（按名字取并集，冲突以 WASM 为准）：
 *   · WASM 给的：种类更准（method 与 function 分得清）、行号来自语法树
 *   · 正则补的：WASM 不产出的（如 Python 模块级赋值、未见语法文件的扩展名）
 *   · 每条符号都带 `source`（tree-sitter / regex），便于判断可信度
 *
 * 缓存：`<repo>/.dsh-code-atlas/index.json`，只存派生数据（可随时删）。
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { scanWorkspace } from './scan.js'
import { buildImportGraph } from './imports.js'
import { availableGrammars, extractSymbolsWasm, supportsLanguage } from './extract-wasm.js'
import { buildAtlasFromSymbols, extractSymbolsLite, renderFras, renderFrasLine } from './fras.js'

export const CACHE_DIR = '.dsh-code-atlas'
export const CACHE_FILE = 'index.json'
export const ATLAS_VERSION = 1

export function cachePathFor(repoRoot) {
  return path.join(repoRoot, CACHE_DIR, CACHE_FILE)
}

/** 合并两层符号：按名字去重，WASM 优先。 */
export function mergeSymbols(wasmSymbols, liteSymbols) {
  const merged = []
  const byName = new Map()
  for (const symbol of wasmSymbols ?? []) {
    if (byName.has(symbol.name)) continue
    byName.set(symbol.name, symbol)
    merged.push(symbol)
  }
  for (const symbol of liteSymbols ?? []) {
    if (byName.has(symbol.name)) continue
    byName.set(symbol.name, symbol)
    merged.push({ ...symbol, source: symbol.source ?? 'regex' })
  }
  merged.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name))
  return merged
}

export async function extractSymbolTable(files, options = {}) {
  const useWasm = options.useWasm === undefined ? true : Boolean(options.useWasm)
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4))
  const table = new Map()
  const stats = { files: files.length, wasmFiles: 0, regexFiles: 0, symbolTotal: 0 }
  let cursor = 0
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= files.length) return
      const file = files[index]
      const lite = extractSymbolsLite(file.text, file.language)
      let wasm = null
      if (useWasm) wasm = await extractSymbolsWasm(file.text, file.language, file.path)
      const symbols = wasm === null ? lite : mergeSymbols(wasm, lite)
      if (wasm === null) stats.regexFiles += 1
      else stats.wasmFiles += 1
      stats.symbolTotal += symbols.length
      table.set(file.path, symbols)
    }
  })
  await Promise.all(workers)
  return { table, stats }
}

export async function buildAtlas(repoRoot, options = {}) {
  const absolute = path.resolve(repoRoot)
  const scanned = await scanWorkspace(absolute, options.scan ?? {})
  const graph = buildImportGraph(scanned.files, options.graph ?? {})
  const { table, stats } = await extractSymbolTable(scanned.files, options)
  const atlas = buildAtlasFromSymbols(scanned.files, table, graph, options.row ?? {})
  atlas.root = absolute
  atlas.version = ATLAS_VERSION
  atlas.scanStats = scanned.stats
  atlas.symbolStats = stats
  atlas.wasmAvailable = (await availableGrammars()).length > 0
  return atlas
}

export async function saveCache(repoRoot, atlas) {
  const target = cachePathFor(path.resolve(repoRoot))
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(atlas), 'utf8')
  return target
}

export async function loadCache(repoRoot) {
  try {
    const raw = await readFile(cachePathFor(path.resolve(repoRoot)), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed.version === ATLAS_VERSION ? parsed : null
  } catch {
    return null
  }
}

export async function cacheInfo(repoRoot) {
  try {
    const info = await stat(cachePathFor(path.resolve(repoRoot)))
    return { exists: true, bytes: info.size, mtime: info.mtime.toISOString(), path: cachePathFor(path.resolve(repoRoot)) }
  } catch {
    return { exists: false, path: cachePathFor(path.resolve(repoRoot)) }
  }
}

/** 取（或建）索引：默认优先用缓存，`fresh: true` 强制重建。 */
export async function loadOrBuild(repoRoot, options = {}) {
  if (options.fresh !== true) {
    const cached = await loadCache(repoRoot)
    if (cached !== null) return { atlas: cached, cached: true }
  }
  const atlas = await buildAtlas(repoRoot, options)
  if (options.save !== false) await saveCache(repoRoot, atlas)
  return { atlas, cached: false }
}

/** 符号检索：精确 > 前缀 > 子串；导出优先；同名按行号。 */
export function searchSymbols(atlas, query, options = {}) {
  const limit = Math.max(1, Math.min(500, options.limit ?? 20))
  const needle = String(query ?? '').trim()
  if (needle === '') return []
  const lowered = needle.toLowerCase()
  const hits = []
  for (const row of atlas.files) {
    for (const symbol of row.entryPoints ?? []) {
      const name = symbol.name
      const lower = name.toLowerCase()
      let score = -1
      if (name === needle) score = 100
      else if (lower === lowered) score = 95
      else if (lower.startsWith(lowered)) score = 70
      else if (lower.includes(lowered)) score = 40
      else continue
      if (symbol.exported !== false) score += 5
      hits.push({ path: row.path, name, kind: symbol.kind, line: symbol.line, source: symbol.source ?? 'regex', score, duty: row.duty })
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line).slice(0, limit)
}

/** 全量符号（带过滤）：供 code_atlas_symbols 用。 */
export function listSymbols(atlas, options = {}) {
  const limit = Math.max(1, Math.min(2000, options.limit ?? 50))
  const nameQuery = options.query === undefined ? null : String(options.query).toLowerCase()
  const fileQuery = options.file === undefined ? null : String(options.file).toLowerCase()
  const rows = []
  for (const row of atlas.files) {
    if (fileQuery !== null && !row.path.toLowerCase().includes(fileQuery)) continue
    for (const symbol of row.entryPoints ?? []) {
      if (nameQuery !== null && !symbol.name.toLowerCase().includes(nameQuery)) continue
      if (options.kind !== undefined && options.kind !== null && symbol.kind !== options.kind) continue
      if (options.exportedOnly === true && symbol.exported === false) continue
      rows.push({ path: row.path, name: symbol.name, kind: symbol.kind, line: symbol.line, source: symbol.source ?? 'regex' })
    }
  }
  rows.sort((a, b) => (b.exported === true) - (a.exported === true) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
  return { total: rows.length, returned: Math.min(limit, rows.length), symbols: rows.slice(0, limit) }
}

/** 可调用 / 类型导出：排序时算"实打实的入口"；模块级常量只算零头（否则一堆常量的脚本会压过真正的枢纽模块）。 */
const CALLABLE_EXPORT_KINDS = new Set(['function', 'method', 'class', 'interface', 'type', 'enum', 'struct', 'trait', 'constructor', 'namespace', 'union'])

export function weightedExportScore(row) {
  const byKind = row.exportedByKind
  if (byKind === undefined) return row.exportCount * 1.5 // 兼容没有该字段的旧行/合成行
  let score = 0
  for (const [kind, count] of Object.entries(byKind)) {
    score += CALLABLE_EXPORT_KINDS.has(kind) ? count * 1.5 : count * 0.3
  }
  return score
}

/** 仓库地图：按"被依赖度 + 符号密度"排序的有界清单（替代"turn 1 到处翻文件"）。 */
export function buildRepoMap(atlas, options = {}) {
  const limit = Math.max(1, Math.min(200, options.limit ?? 40))
  const focus = options.focus === undefined ? null : String(options.focus).toLowerCase()
  const scored = atlas.files
    .filter((row) => (focus === null ? true : row.path.toLowerCase().includes(focus) || row.duty.toLowerCase().includes(focus)))
    .map((row) => {
      const testPenalty = /(^|\/)(tests?|__tests__|spec)\//.test(row.path) || /\.(test|spec)\.[a-z]+$/.test(row.path) ? 0.4 : 1
      const generatedPenalty = /\.(min|bundle)\.[a-z]+$/.test(row.path) ? 0.2 : 1
      const score = (row.importerCount * 4 + weightedExportScore(row) + Math.min(row.lines / 40, 6) + row.symbolCount * 0.2) * testPenalty * generatedPenalty
      return { row, score: Number(score.toFixed(3)) }
    })
    .sort((a, b) => b.score - a.score || a.row.path.localeCompare(b.row.path))
  return {
    total: scored.length,
    shown: Math.min(limit, scored.length),
    entries: scored.slice(0, limit).map(({ row, score }) => ({
      path: row.path,
      score,
      language: row.language,
      lines: row.lines,
      duty: row.duty,
      importerCount: row.importerCount,
      exportCount: row.exportCount,
      keySymbols: row.entryPoints.slice(0, 5).map((s) => `${s.name}@${s.line}`),
    })),
  }
}

export function renderRepoMap(map) {
  const lines = [`# 仓库地图 · ${map.total} 个候选文件，显示前 ${map.shown}（分数 = 被依赖度×4 + 可调用/类型导出×1.5（常量×0.3）+ 行数 + 符号密度）`]
  for (const entry of map.entries) {
    lines.push(`${entry.path} :: ${entry.duty} | 被依赖 ${entry.importerCount} | 导出 ${entry.exportCount} | 关键符号 ${entry.keySymbols.join(' ') || '—'}`)
  }
  return lines.join('\n')
}

export { renderFras, renderFrasLine, supportsLanguage }
