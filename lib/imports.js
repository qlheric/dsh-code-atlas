/**
 * imports —— 依赖图（零依赖，正则级；tree-sitter 版后续接入同一接口）。
 *
 * 支持：
 *   · JS/TS：`import … from 'x'`、`import 'x'`、`export … from 'x'`、`import('x')`、`require('x')`
 *   · Python：`import a.b`、`from .pkg import x`（相对导入按层数回溯）
 *   · Go：`import "x"`（含块形式）
 *   · Rust：`use crate::…` / `mod x;`
 * 解析：
 *   · 相对说明符 → 按扩展名/`index.*`/`__init__.py`/`mod.rs` 候选匹配
 *   · 绝对说明符 → 命中"仓库内包名"（同目录一级目录 or package.json name）才算内部边
 */

import path from 'node:path'

const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']
const PY_EXTENSIONS = ['.py', '.pyi']

export function extractImports(text, language) {
  const found = []
  const lines = text.split('\n')
  const push = (specifier, line, kind) => {
    if (typeof specifier === 'string' && specifier.trim() !== '') found.push({ specifier: specifier.trim(), line, kind })
  }
  if (language === 'javascript' || language === 'typescript') {
    const patterns = [
      { re: /^\s*import\s+[^'"]*from\s*['"]([^'"]+)['"]/, kind: 'esm' },
      { re: /^\s*import\s*['"]([^'"]+)['"]/, kind: 'esm-side-effect' },
      { re: /^\s*export\s+[^'"]*from\s*['"]([^'"]+)['"]/, kind: 'esm-reexport' },
      { re: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/, kind: 'dynamic' },
      { re: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/, kind: 'cjs' },
    ]
    for (let i = 0; i < lines.length; i += 1) {
      for (const { re, kind } of patterns) {
        const match = re.exec(lines[i])
        if (match !== null) push(match[1], i + 1, kind)
      }
    }
    return found
  }
  if (language === 'python') {
    for (let i = 0; i < lines.length; i += 1) {
      const from = /^\s*from\s+([.\w]+)\s+import\s+/.exec(lines[i])
      if (from !== null) {
        push(from[1], i + 1, 'py-from')
        continue
      }
      const plain = /^\s*import\s+([\w.]+)/.exec(lines[i])
      if (plain !== null) push(plain[1], i + 1, 'py-import')
    }
    return found
  }
  if (language === 'go') {
    const block = /import\s*\(([\s\S]*?)\)/.exec(text)
    if (block !== null) {
      const startLine = text.slice(0, block.index).split('\n').length
      block[1].split('\n').forEach((raw, offset) => {
        const match = /['"]([^'"]+)['"]/.exec(raw)
        if (match !== null) push(match[1], startLine + offset, 'go-block')
      })
    }
    for (let i = 0; i < lines.length; i += 1) {
      const single = /^\s*import\s+['"]([^'"]+)['"]/.exec(lines[i])
      if (single !== null) push(single[1], i + 1, 'go')
    }
    return found
  }
  if (language === 'rust') {
    for (let i = 0; i < lines.length; i += 1) {
      const use = /^\s*use\s+(crate|super|self)::([\w:]+)/.exec(lines[i])
      if (use !== null) push(`${use[1]}::${use[2]}`, i + 1, 'rust-use')
      const mod = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/.exec(lines[i])
      if (mod !== null) push(`mod::${mod[1]}`, i + 1, 'rust-mod')
    }
    return found
  }
  return found
}

function candidatesFor(base) {
  const list = []
  for (const ext of JS_EXTENSIONS) list.push(base + ext)
  for (const ext of JS_EXTENSIONS) list.push(`${base}/index${ext}`)
  for (const ext of PY_EXTENSIONS) list.push(base + ext)
  list.push(`${base}/__init__.py`)
  list.push(`${base}/mod.rs`, `${base}.rs`)
  // TS 源码常 import 编译后的 .js 路径
  if (base.endsWith('.js')) list.push(...JS_EXTENSIONS.map((ext) => base.slice(0, -3) + ext))
  return list
}

function normalize(relativePath) {
  const parts = []
  for (const segment of relativePath.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

export function resolveSpecifier(specifier, fromRelativePath, fileSet, packageName = null) {
  const fromDir = path.posix.dirname(fromRelativePath)
  if (specifier.startsWith('.')) {
    const base = normalize(fromDir === '.' ? specifier : `${fromDir}/${specifier}`)
    for (const candidate of candidatesFor(base)) if (fileSet.has(candidate)) return candidate
    return null
  }
  if (specifier.startsWith('crate::') || specifier.startsWith('super::') || specifier.startsWith('self::')) {
    const tail = specifier.split('::').slice(1)
    const fromDirResolved = specifier.startsWith('super::') ? normalize(`${fromDir}/..`) : fromDir
    for (let take = tail.length; take > 0; take -= 1) {
      const base = normalize(`${fromDirResolved}/${tail.slice(0, take).join('/')}`)
      for (const ext of ['.rs']) {
        if (fileSet.has(base + ext)) return base + ext
        if (fileSet.has(`${base}/mod.rs`)) return `${base}/mod.rs`
      }
    }
    return null
  }
  if (specifier.startsWith('mod::')) {
    const name = specifier.slice(5)
    for (const candidate of [`${fromDir}/${name}.rs`, `${fromDir}/${name}/mod.rs`, `src/${name}.rs`, `src/${name}/mod.rs`]) {
      if (fileSet.has(candidate)) return candidate
    }
    return null
  }
  // Python 绝对导入：项目根目录下的同名模块
  const pyTail = specifier.split('.')
  const pyBase = normalize(pyTail.join('/'))
  for (const candidate of [`${pyBase}.py`, `${pyBase}/__init__.py`, `src/${pyBase}.py`, `src/${pyBase}/__init__.py`]) {
    if (fileSet.has(candidate)) return candidate
  }
  // JS 裸说明符：仅当命中包名自身的内部路径时才算内部边
  if (packageName !== null && (specifier === packageName || specifier.startsWith(`${packageName}/`))) {
    const sub = specifier === packageName ? '' : specifier.slice(packageName.length + 1)
    const base = normalize(sub === '' ? 'src/index' : `src/${sub}`)
    for (const candidate of candidatesFor(base)) if (fileSet.has(candidate)) return candidate
    for (const candidate of candidatesFor(sub)) if (fileSet.has(candidate)) return candidate
  }
  return null
}

export function buildImportGraph(files, options = {}) {
  const fileSet = new Set(files.map((f) => f.path))
  const packageName = options.packageName ?? null
  const imports = new Map()
  const importers = new Map()
  const unresolved = new Map()
  const externalCounts = new Map()
  for (const file of files) {
    const list = extractImports(file.text, file.language)
    const internal = new Set()
    const external = new Set()
    const missing = []
    for (const item of list) {
      const target = resolveSpecifier(item.specifier, file.path, fileSet, packageName)
      if (target === null) {
        const isRelative = item.specifier.startsWith('.') || item.specifier.startsWith('crate::') || item.specifier.startsWith('mod::')
        if (isRelative) missing.push(item)
        else external.add(item.specifier.split('/')[0])
        continue
      }
      if (target === file.path) continue
      internal.add(target)
      if (!importers.has(target)) importers.set(target, new Set())
      importers.get(target).add(file.path)
    }
    imports.set(file.path, internal)
    if (missing.length > 0) unresolved.set(file.path, missing)
    for (const name of external) externalCounts.set(name, (externalCounts.get(name) ?? 0) + 1)
  }
  return { imports, importers, unresolved, externalCounts, fileSet }
}
