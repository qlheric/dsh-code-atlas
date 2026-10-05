/**
 * tools —— 代码图谱的 5 个模型面工具（code_atlas_*）。
 *
 * 统一口径：
 *   · `repoRoot` 省略时按 `DSH_WORKSPACE` → `process.cwd()` 兜底；**建议调用方显式传**（会话工作区）。
 *   · 读取优先走缓存 `<repo>/.dsh-code-atlas/index.json`；`action: build` / `fresh: true` 才重建。
 *   · 所有输出都带 `source`（tree-sitter / regex），并且**不臆造**：拿不到就报 null/空，不编。
 */

import {
  buildAtlas,
  buildRepoMap,
  cacheInfo,
  listSymbols,
  loadOrBuild,
  renderFras,
  renderRepoMap,
  searchSymbols,
  supportsLanguage,
} from './atlas.js'

function resolveRepoRoot(args) {
  const explicit = args?.repoRoot
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  const fromEnv = process.env.DSH_WORKSPACE ?? process.env.DSH_PROJECT_DIR
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return process.cwd()
}

function jsonOutput(description) {
  return {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  }
}

export const indexTool = {
  name: 'code_atlas_index',
  description:
    '代码图谱索引：action=status 报告索引状态（缓存、文件数、符号数、tree-sitter 可用性，不重建）；' +
    'action=build 强制重建（扫描 + 依赖图 + 符号抽取）并写入 <repo>/.dsh-code-atlas/index.json。' +
    '符号抽取是 WASM 优先、正则补位，每条符号都标 source。索引只是派生数据，可随时删。',
  parameters: {
    action: { type: 'string', enum: ['status', 'build'], default: 'status', description: 'status 只看不建；build 强制重建' },
    repoRoot: { type: 'string', description: '仓库绝对路径（省略则用 DSH_WORKSPACE / 当前目录）' },
  },
  output: jsonOutput(),
  execute: async (args) => {
    const repoRoot = resolveRepoRoot(args)
    const action = String(args?.action ?? 'status')
    const cache = await cacheInfo(repoRoot)
    if (action === 'status') {
      const { atlas, cached } = await loadOrBuild(repoRoot, { fresh: false })
      return {
        ok: true,
        action,
        repoRoot,
        cached,
        cache,
        fileCount: atlas.fileCount,
        symbolTotal: atlas.symbolTotal ?? null,
        wasmAvailable: atlas.wasmAvailable ?? null,
        symbolStats: atlas.symbolStats ?? null,
        generatedAt: atlas.generatedAt,
        grammarsProbe: await supportsLanguage('javascript'),
      }
    }
    const atlas = await buildAtlas(repoRoot, { fresh: true })
    const { saveCache } = await import('./atlas.js')
    const saved = await saveCache(repoRoot, atlas)
    return {
      ok: true,
      action,
      repoRoot,
      savedTo: saved,
      fileCount: atlas.fileCount,
      symbolTotal: atlas.symbolTotal,
      scanStats: atlas.scanStats,
      symbolStats: atlas.symbolStats,
      wasmAvailable: atlas.wasmAvailable,
      externalTop: atlas.externalTop.slice(0, 10),
    }
  },
  timeoutMs: 120_000,
}

export const mapTool = {
  name: 'code_atlas_map',
  description:
    '仓库地图：按"被依赖度×4 + 导出数×1.5 + 行数 + 符号密度"排序的有界清单（测试与被压缩产物降权），' +
    '每行给出该文件职责、被依赖数、导出数与关键符号。适合会话开头一次拿下"先读哪几个文件"，避免到处翻。',
  parameters: {
    repoRoot: { type: 'string', description: '仓库绝对路径（省略则用 DSH_WORKSPACE / 当前目录）' },
    limit: { type: 'integer', default: 40, description: '返回条目上限（1-200）' },
    focus: { type: 'string', description: '只看路径或职责里含该关键词的文件' },
    format: { type: 'string', enum: ['text', 'json'], default: 'text', description: 'text 给人/模型读；json 给程序读' },
  },
  output: jsonOutput(),
  execute: async (args) => {
    const repoRoot = resolveRepoRoot(args)
    const { atlas, cached } = await loadOrBuild(repoRoot)
    const map = buildRepoMap(atlas, { limit: args?.limit, focus: args?.focus })
    if (String(args?.format ?? 'text') === 'json') return { ok: true, repoRoot, cached, ...map }
    return { ok: true, repoRoot, cached, total: map.total, shown: map.shown, text: renderRepoMap(map) }
  },
  timeoutMs: 120_000,
}

export const searchTool = {
  name: 'code_atlas_search',
  description:
    '符号检索：精确 > 前缀 > 子串，导出符号加权；返回 文件:行、种类、来源（tree-sitter / regex）与所在文件职责。' +
    '适合"这个函数定义在哪"。**调用/引用图尚未实现**（F/R/A/S 的 R 列只到文件级依赖）；要更细的调用关系请用 grep 类工具。',
  parameters: {
    query: { type: 'string', required: true, description: '要查的符号名（或片段）' },
    repoRoot: { type: 'string', description: '仓库绝对路径（省略则用 DSH_WORKSPACE / 当前目录）' },
    limit: { type: 'integer', default: 20, description: '返回条数上限（1-500）' },
  },
  output: jsonOutput(),
  execute: async (args) => {
    const repoRoot = resolveRepoRoot(args)
    const query = String(args?.query ?? '').trim()
    if (query === '') throw new Error('query 必填')
    const { atlas, cached } = await loadOrBuild(repoRoot)
    const hits = searchSymbols(atlas, query, { limit: args?.limit })
    return { ok: true, repoRoot, cached, query, hitCount: hits.length, hits }
  },
  timeoutMs: 120_000,
}

export const symbolsTool = {
  name: 'code_atlas_symbols',
  description:
    '列符号：按名字片段 / 文件路径片段 / 种类过滤，可选只要导出符号。返回 文件:行 + 种类 + 来源。' +
    '种类取值：function / method / class / interface / type / enum / struct / trait / variable / const / module …',
  parameters: {
    repoRoot: { type: 'string', description: '仓库绝对路径（省略则用 DSH_WORKSPACE / 当前目录）' },
    query: { type: 'string', description: '符号名片段（不区分大小写）' },
    file: { type: 'string', description: '文件路径片段，如 "src/lib"' },
    kind: { type: 'string', description: '只要该种类' },
    exportedOnly: { type: 'boolean', description: '只要导出符号' },
    limit: { type: 'integer', default: 50, description: '返回条数上限（1-2000）' },
  },
  output: jsonOutput(),
  execute: async (args) => {
    const repoRoot = resolveRepoRoot(args)
    const { atlas, cached } = await loadOrBuild(repoRoot)
    const result = listSymbols(atlas, {
      query: args?.query,
      file: args?.file,
      kind: args?.kind,
      exportedOnly: args?.exportedOnly,
      limit: args?.limit,
    })
    return { ok: true, repoRoot, cached, ...result }
  },
  timeoutMs: 120_000,
}

export const frasTool = {
  name: 'code_atlas_fras',
  description:
    'F/R/A/S 认知层：每文件一行 —— F 职责（首段注释，带出处行号）、R 关系（仓库内谁 import 我 / 我 import 谁）、' +
    'A 入口（导出符号@行号）、S 不能弄错的约束（注释纪律标记与危险模式候选，**每条带行号**）。' +
    '按被依赖度排序，可只看某段路径；includeConstraints=true 时附前 5 条约束原文。',
  parameters: {
    repoRoot: { type: 'string', description: '仓库绝对路径（省略则用 DSH_WORKSPACE / 当前目录）' },
    path: { type: 'string', description: '只显示路径含该片段的文件' },
    minImporters: { type: 'integer', default: 0, description: '只显示被依赖数 ≥ 该值的文件' },
    limit: { type: 'integer', default: 200, description: '最多显示多少行（1-1000）' },
    includeConstraints: { type: 'boolean', description: '是否附上约束原文（每条带行号）' },
    format: { type: 'string', enum: ['text', 'json'], default: 'text', description: 'text 直接给一行行结果；json 给结构化行' },
  },
  output: jsonOutput(),
  execute: async (args) => {
    const repoRoot = resolveRepoRoot(args)
    const { atlas, cached } = await loadOrBuild(repoRoot)
    const options = {
      limit: args?.limit,
      minImporters: args?.minImporters,
      pathFilter: args?.path ?? null,
      includeConstraints: args?.includeConstraints === true,
    }
    if (String(args?.format ?? 'text') === 'json') {
      const rows = atlas.files
        .filter((row) => row.importerCount >= (options.minImporters ?? 0))
        .filter((row) => (options.pathFilter === null ? true : row.path.includes(options.pathFilter)))
        .sort((a, b) => b.importerCount - a.importerCount || a.path.localeCompare(b.path))
        .slice(0, Math.max(1, Math.min(1000, options.limit ?? 200)))
      return { ok: true, repoRoot, cached, fileCount: atlas.fileCount, returned: rows.length, rows }
    }
    return { ok: true, repoRoot, cached, text: renderFras(atlas, options) }
  },
  timeoutMs: 120_000,
}

export const TOOLS = [indexTool, mapTool, searchTool, symbolsTool, frasTool]
