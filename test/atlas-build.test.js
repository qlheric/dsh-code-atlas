import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  buildAtlas,
  buildRepoMap,
  cacheInfo,
  listSymbols,
  loadOrBuild,
  mergeSymbols,
  searchSymbols,
} from '../lib/atlas.js'
import { extractConstraints, extractSymbolsLite } from '../lib/fras.js'
import { TOOLS, frasTool, indexTool, mapTool, searchTool, symbolsTool } from '../lib/tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, '..', 'fixtures', 'atlas-sample')

test('符号合并：WASM 优先，正则补 WASM 不产出的', () => {
  const wasm = [{ name: 'a', kind: 'function', line: 3, exported: true, source: 'tree-sitter' }]
  const lite = [
    { name: 'a', kind: 'variable', line: 9, exported: false },
    { name: 'MAX', kind: 'variable', line: 12, exported: true },
  ]
  const merged = mergeSymbols(wasm, lite)
  assert.deepEqual(merged.map((s) => [s.name, s.kind, s.source]), [['a', 'function', 'tree-sitter'], ['MAX', 'variable', 'regex']])
})

test('buildAtlas：扫描 + 依赖图 + 双层符号 + 缓存', async () => {
  const cache = path.join(FIXTURE, '.dsh-code-atlas')
  await rm(cache, { recursive: true, force: true })

  const atlas = await buildAtlas(FIXTURE)
  assert.equal(atlas.fileCount, 3)
  assert.equal(atlas.version, 1)
  assert.equal(atlas.wasmAvailable, true)
  assert.equal(atlas.symbolStats.wasmFiles, 3) // 三个文件都拿到了语法
  assert.equal(atlas.symbolStats.regexFiles, 0)
  assert.ok(atlas.symbolTotal >= 6)

  const util = atlas.files.find((f) => f.path === 'src/lib/util.js')
  const utilNames = util.entryPoints.map((e) => e.name)
  assert.ok(utilNames.includes('slugify'))
  assert.ok(utilNames.includes('VERSION'))
  // VERSION 是 const，正则层与 WASM 层都会给；slugify 至少来自 tree-sitter
  assert.equal(util.entryPoints.find((e) => e.name === 'slugify').source, 'tree-sitter')

  const app = atlas.files.find((f) => f.path === 'src/app.py')
  const appNames = app.entryPoints.map((e) => e.name)
  assert.ok(appNames.includes('main'))
  assert.ok(appNames.includes('Scheduler'))

  const before = await cacheInfo(FIXTURE)
  assert.equal(before.exists, false)
  const { atlas: cachedAtlas, cached } = await loadOrBuild(FIXTURE)
  assert.equal(cached, false)
  assert.equal((await cacheInfo(FIXTURE)).exists, true)
  const second = await loadOrBuild(FIXTURE)
  assert.equal(second.cached, true)
  assert.equal(second.atlas.fileCount, cachedAtlas.fileCount)
})

test('检索与地图：排序口径可核', () => {
  const atlas = {
    files: [
      {
        path: 'src/lib/util.js', duty: '工具集合', importerCount: 1, exportCount: 2, lines: 12, symbolCount: 3,
        entryPoints: [{ name: 'slugify', kind: 'function', line: 3, exported: true, source: 'tree-sitter' }],
      },
      {
        path: 'src/index.js', duty: '装配点', importerCount: 0, exportCount: 1, lines: 12, symbolCount: 1,
        entryPoints: [{ name: 'slugifyHelper', kind: 'function', line: 9, exported: false, source: 'regex' }],
      },
      {
        path: 'src/other.js', duty: '无关', importerCount: 0, exportCount: 0, lines: 50, symbolCount: 0, entryPoints: [],
      },
    ],
    fileCount: 3,
  }
  const hits = searchSymbols(atlas, 'slugify')
  assert.deepEqual(hits.map((h) => [h.name, h.score]), [['slugify', 105], ['slugifyHelper', 70]])
  const map = buildRepoMap(atlas, { limit: 2 })
  assert.equal(map.shown, 2)
  assert.equal(map.entries[0].path, 'src/lib/util.js')
  const filtered = buildRepoMap(atlas, { focus: '无关' })
  assert.deepEqual(filtered.entries.map((e) => e.path), ['src/other.js'])
  const listed = listSymbols(atlas, { query: 'slug', exportedOnly: true })
  assert.deepEqual(listed.symbols.map((s) => s.name), ['slugify'])
})

test('工具面：5 个工具都能对真实仓库出结果', async () => {
  assert.deepEqual(TOOLS.map((t) => t.name), [
    'code_atlas_index', 'code_atlas_map', 'code_atlas_search', 'code_atlas_symbols', 'code_atlas_fras',
  ])
  const cache = path.join(FIXTURE, '.dsh-code-atlas')
  await rm(cache, { recursive: true, force: true })

  const index = await indexTool.execute({ repoRoot: FIXTURE, action: 'build' })
  assert.equal(index.ok, true)
  assert.equal(index.fileCount, 3)
  assert.ok(index.savedTo.endsWith('index.json'))
  assert.equal((await cacheInfo(FIXTURE)).exists, true)

  const status = await indexTool.execute({ repoRoot: FIXTURE, action: 'status' })
  assert.equal(status.cached, true)
  assert.equal(status.wasmAvailable, true)

  const map = await mapTool.execute({ repoRoot: FIXTURE, limit: 2 })
  assert.match(map.text, /# 仓库地图/)
  assert.equal(map.shown, 2)

  const search = await searchTool.execute({ repoRoot: FIXTURE, query: 'slugify' })
  assert.ok(search.hitCount >= 1)
  assert.equal(search.hits[0].name, 'slugify')
  await assert.rejects(() => searchTool.execute({ repoRoot: FIXTURE, query: '  ' }), /query 必填/)

  const symbols = await symbolsTool.execute({ repoRoot: FIXTURE, kind: 'function', exportedOnly: true })
  assert.ok(symbols.symbols.every((s) => s.kind === 'function'))

  const fras = await frasTool.execute({ repoRoot: FIXTURE, includeConstraints: true })
  assert.match(fras.text, /F\/R\/A\/S 认知层/)
  assert.match(fras.text, /src\/lib\/util\.js :: F:字符串与路径小工具集合。/)
  const frasJson = await frasTool.execute({ repoRoot: FIXTURE, format: 'json', path: 'lib/' })
  assert.equal(frasJson.rows.every((r) => r.path.includes('lib/')), true)

  await rm(cache, { recursive: true, force: true })
})

test('参数 schema 只用 rc.2 允许的词汇', () => {
  const allowed = new Set(['type', 'required', 'description', 'default', 'enum', 'items', 'properties', 'additionalProperties'])
  for (const tool of TOOLS) {
    for (const [key, schema] of Object.entries(tool.parameters)) {
      for (const field of Object.keys(schema)) {
        assert.ok(allowed.has(field), `${tool.name}.${key} 用了不支持的字段 ${field}`)
      }
      if ('required' in schema) assert.equal(schema.required, true)
    }
  }
})

test('S 层注释上下文门禁：界面文案里的「必须/不可」不算规则，代码里的 eval 仍算风险', () => {
  const lines = [
    "// 必须：这里只做装配",
    "const msg = '数据源暂时不可用（网络连接失败），请稍后重试'",
    "# 禁止：不要在 import 期产生副作用",
    "const label = `注意：${name} 已过期`",
    "const x = eval('1+1')",
    'spawn(cmd, { shell: true })',
  ]
  const constraints = extractConstraints(lines.join('\n'))
  assert.deepEqual(constraints.map((c) => [c.kind, c.line]), [['rule', 1], ['rule', 3], ['risk', 5], ['risk', 6]])
  assert.equal(constraints.some((c) => c.text.includes('数据源')), false)
  assert.equal(constraints.some((c) => c.text.includes('已过期')), false)
})

test('正则层仍可作为 WASM 的兜底', () => {
  const symbols = extractSymbolsLite('def f():\n    pass\n', 'python')
  assert.deepEqual(symbols.map((s) => s.name), ['f'])
})
