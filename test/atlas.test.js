import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isCodeLanguage, languageFor, scanWorkspace, toPosix } from '../lib/scan.js'
import { buildImportGraph, extractImports, resolveSpecifier } from '../lib/imports.js'
import { buildAtlas, extractConstraints, extractDuty, extractSymbolsLite, renderFras, renderFrasLine } from '../lib/fras.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, '..', 'fixtures', 'atlas-sample')

test('scan：忽略目录/非代码/二进制，路径一律 POSIX', async () => {
  const { files, stats, root } = await scanWorkspace(FIXTURE)
  const paths = files.map((f) => f.path)
  assert.deepEqual(paths, ['src/app.py', 'src/index.js', 'src/lib/util.js'])
  assert.equal(paths.some((p) => p.includes('node_modules')), false)
  assert.equal(paths.some((p) => p.startsWith('dist/')), false)
  assert.equal(paths.some((p) => p.endsWith('.md')), false)
  assert.ok(stats.ignoredDirs >= 2)
  assert.ok(stats.skippedBinary >= 1)
  assert.equal(root, FIXTURE)
  assert.equal(paths.every((p) => !p.includes('\\')), true)
})

test('语言表与判定', () => {
  assert.equal(languageFor('a/b.ts'), 'typescript')
  assert.equal(languageFor('x.PY'), 'python')
  assert.equal(languageFor('README.md'), 'markdown')
  assert.equal(languageFor('a.unknown'), null)
  assert.equal(isCodeLanguage('python'), true)
  assert.equal(isCodeLanguage('markdown'), false)
  assert.equal(toPosix('a\\b\\c.js'), 'a/b/c.js')
})

test('imports：JS/TS 与 Python 抽取', () => {
  const js = extractImports("import a from './a.js'\nimport './side.js'\nexport * from './r.js'\nconst b = require('./b.js')\nconst c = await import('./c.js')\n", 'javascript')
  assert.deepEqual(js.map((i) => [i.specifier, i.kind]), [
    ['./a.js', 'esm'], ['./side.js', 'esm-side-effect'], ['./r.js', 'esm-reexport'], ['./b.js', 'cjs'], ['./c.js', 'dynamic'],
  ])
  const py = extractImports('import os\nfrom .helpers import run\nfrom pkg.sub import x\n', 'python')
  assert.deepEqual(py.map((i) => [i.specifier, i.kind, i.line]), [['os', 'py-import', 1], ['.helpers', 'py-from', 2], ['pkg.sub', 'py-from', 3]])
  const go = extractImports('package main\n\nimport (\n\t"fmt"\n\t"example.com/x/y"\n)\n', 'go')
  assert.deepEqual(go.map((i) => i.specifier), ['fmt', 'example.com/x/y'])
  const rust = extractImports('use crate::lib::thing;\npub mod other;\n', 'rust')
  assert.deepEqual(rust.map((i) => i.specifier), ['crate::lib::thing', 'mod::other'])
})

test('说明符解析：扩展名/index/__init__ 候选', () => {
  const fileSet = new Set(['src/index.js', 'src/lib/util.js', 'src/lib/index.js', 'src/app.py', 'src/pkg/__init__.py'])
  assert.equal(resolveSpecifier('./lib/util', 'src/index.js', fileSet), 'src/lib/util.js')
  assert.equal(resolveSpecifier('./util.js', 'src/lib/index.js', fileSet), 'src/lib/util.js')
  assert.equal(resolveSpecifier('./lib', 'src/index.js', fileSet), 'src/lib/index.js')
  assert.equal(resolveSpecifier('.helpers', 'src/app.py', fileSet), 'src/app.py' === 'src/app.py' ? resolveSpecifier('.helpers', 'src/pkg/mod.py'.replace('pkg/mod.py', 'app.py'), fileSet) : null)
  assert.equal(resolveSpecifier('./nope', 'src/index.js', fileSet), null)
  assert.equal(resolveSpecifier('node:fs', 'src/index.js', fileSet), null)
})

test('依赖图：内部边、被依赖者、未解析相对导入、外部计数', async () => {
  const { files } = await scanWorkspace(FIXTURE)
  const graph = buildImportGraph(files)
  assert.deepEqual([...graph.imports.get('src/index.js')].sort(), ['src/lib/util.js'])
  assert.deepEqual([...graph.importers.get('src/lib/util.js')], ['src/index.js'])
  const unresolved = graph.unresolved.get('src/index.js')
  assert.equal(unresolved.length, 1)
  assert.equal(unresolved[0].specifier, './lib/missing.js')
  assert.equal(graph.externalCounts.get('node:fs'), 1)
})

test('F/R/A/S：符号、职责、约束的分级与出处', () => {
  const js = "export function a() {}\nexport const b = () => {}\nfunction c() {}\nexport { d as e }\n"
  const symbols = extractSymbolsLite(js, 'javascript')
  assert.deepEqual(symbols.map((s) => [s.name, s.exported]), [['a', true], ['b', true], ['c', false], ['d', true]])
  const py = extractSymbolsLite('def f():\n    pass\n\nclass K:\n    def m(self):\n        pass\n', 'python')
  assert.deepEqual(py.map((s) => s.name), ['f', 'K', 'm'])

  const duty = extractDuty('/** 职责：把任务表跑起来。\n * 第二行\n */\nexport const x = 1\n', 'a.js')
  assert.equal(duty.duty, '职责：把任务表跑起来。')
  assert.equal(duty.line, 1)
  assert.equal(extractDuty('const x = 1\n', 'a.js').duty, null)
  assert.match(extractDuty('#!/usr/bin/env node\n// 命令行入口\n', 'a.js').duty, /命令行入口/)

  const constraints = extractConstraints([
    'const x = 1 // 必须：不许改成 2',
    '# TODO: 收敛这个分支',
    "const y = eval('1+1')",
    'spawn(cmd, { shell: true })',
    'const apiKey = "sk-abcdefghijklmnopqrst"',
    '普通注释不算',
  ].join('\n'))
  assert.deepEqual(constraints.map((c) => c.kind), ['rule', 'todo', 'risk', 'risk', 'risk'])
  assert.equal(constraints[0].line, 1)
  assert.match(constraints[0].text, /必须/)
  assert.equal(constraints.every((c) => Number.isInteger(c.line)), true)
})

test('atlas 装配与 F/R/A/S 渲染', async () => {
  const { files } = await scanWorkspace(FIXTURE)
  const atlas = buildAtlas(files, buildImportGraph(files))
  assert.equal(atlas.fileCount, 3)
  const util = atlas.files.find((f) => f.path === 'src/lib/util.js')
  assert.equal(util.importerCount, 1)
  assert.equal(util.importsOutCount, 0)
  assert.equal(util.duty, '字符串与路径小工具集合。')
  assert.equal(util.constraintCounts.rule, 1)
  assert.equal(util.constraintCounts.todo, 1)
  assert.ok(util.entryPoints.some((e) => e.name === 'slugify'))
  const index = atlas.files.find((f) => f.path === 'src/index.js')
  assert.equal(index.unresolvedRelative.length, 1)
  assert.equal(index.importsOutCount, 1) // 内部边只有 ./lib/util.js；node:fs 是外部、./lib/missing.js 未解析
  assert.ok(atlas.externalTop.some(([name]) => name === 'node:fs'))

  const line = renderFrasLine(util)
  assert.match(line, /^src\/lib\/util\.js :: F:字符串与路径小工具集合。 \| R:in=1 out=0 \| A:/)
  assert.match(line, /S:2 条（rule 1 \/ risk 0 \/ todo 1）/)
  const rendered = renderFras(atlas, { limit: 2, includeConstraints: true })
  assert.match(rendered, /# F\/R\/A\/S 认知层 · 3 文件/)
  assert.equal(rendered.split('\n').length > 3, true)
  const filtered = renderFras(atlas, { pathFilter: 'lib/' })
  assert.match(filtered, /src\/lib\/util\.js/)
  assert.equal(filtered.includes('src/index.js'), false)
})
