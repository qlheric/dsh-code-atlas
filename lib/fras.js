/**
 * fras —— 每文件一行 **F/R/A/S 认知层**（确定性，零依赖；tree-sitter 是可选增强）。
 *
 *   F（职责）：文件首段注释 + 主导导出符号 + 路径线索，合成一句话
 *   R（关系）：仓库内谁 import 它（in）、它 import 谁（out），以及未解析的相对导入
 *   A（入口）：对外入口点（导出符号 + 行号）
 *   S（不能弄错的约束）：从注释纪律标记（必须/禁止/注意/IMPORTANT/NEVER…）与
 *        危险模式（eval / child_process / rm -rf / 硬编码密钥 / shell:true …）抽出的候选，**每条带行号出处**
 *
 * 纪律：F/R/A/S 都是**可核的抽取**（带出处行号），不是模型总结；S 是"候选"而非"结论"。
 */

const DUTY_MAX = 120
const MAX_CONSTRAINTS_PER_FILE = 40

const RULE_MARKERS = /(必须|禁止|不可|不能|务必|注意|铁律|红线|不得|IMPORTANT|WARNING|NEVER|MUST|DO NOT|DON'?T|invariant|CAUTION)/
const TODO_MARKERS = /\b(TODO|FIXME|XXX|HACK)\b/

const RISK_PATTERNS = [
  { re: /\beval\s*\(/, risk: 'eval 执行字符串' },
  { re: /new\s+Function\s*\(/, risk: 'new Function 动态执行' },
  { re: /child_process|\bexecSync\s*\(|\bexec\s*\(|\bspawnSync\s*\(/, risk: '起子进程' },
  { re: /\brm\s+-rf\b|\brmSync\s*\(|\brmdirSync\s*\(/, risk: '递归删除' },
  { re: /--no-verify\b/, risk: '跳过校验（--no-verify）' },
  { re: /shell\s*:\s*true/, risk: 'shell: true 起进程' },
  { re: /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/, risk: '关闭 TLS 校验' },
  { re: /(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i, risk: '疑似硬编码密钥' },
  { re: /chmod\s+777|0o?777/, risk: '777 权限' },
]

export const SYMBOL_PATTERNS = {
  javascript: [
    { re: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function', exported: true },
    { re: /^\s*export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', exported: true },
    { re: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: 'variable', exported: true },
    { re: /^\s*export\s*\{([^}]*)\}/, kind: 're-export', exported: true, list: true },
    { re: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function', exported: false },
    { re: /^\s*class\s+([A-Za-z_$][\w$]*)/, kind: 'class', exported: false },
    { re: /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/, kind: 'function', exported: false },
  ],
  python: [
    { re: /^\s*(?:async\s+)?def\s+(\w+)/, kind: 'function', exported: true },
    { re: /^\s*class\s+(\w+)/, kind: 'class', exported: true },
    { re: /^([A-Za-z_]\w*)\s*(?::[^=]+)?=/, kind: 'variable', exported: true },
  ],
  go: [
    { re: /^func\s+\((?:\w+\s+)?\*?(\w+)\)\s+(\w+)\s*\(/, kind: 'method', exported: true, nameGroup: 2 },
    { re: /^func\s+(\w+)\s*\(/, kind: 'function', exported: true },
    { re: /^type\s+(\w+)\s/, kind: 'type', exported: true },
  ],
  rust: [
    { re: /^\s*pub\s+(?:async\s+)?fn\s+(\w+)/, kind: 'function', exported: true },
    { re: /^\s*pub\s+(?:struct|enum|trait|union)\s+(\w+)/, kind: 'type', exported: true },
    { re: /^\s*(?:async\s+)?fn\s+(\w+)/, kind: 'function', exported: false },
    { re: /^\s*(?:struct|enum|trait)\s+(\w+)/, kind: 'type', exported: false },
  ],
  java: [
    { re: /^\s*(?:public|protected)?\s*(?:static\s+|final\s+|abstract\s+)*class\s+(\w+)/, kind: 'class', exported: true },
    { re: /^\s*(?:public|protected)\s+(?:static\s+|final\s+|synchronized\s+)*[\w<>\[\],.\s]+\s+(\w+)\s*\(/, kind: 'method', exported: true },
  ],
  csharp: [
    { re: /^\s*(?:public|internal)\s+(?:static\s+|sealed\s+|abstract\s+|partial\s+)*class\s+(\w+)/, kind: 'class', exported: true },
    { re: /^\s*(?:public|internal)\s+(?:static\s+|async\s+|virtual\s+|override\s+)*[\w<>\[\],.\s]+\s+(\w+)\s*\(/, kind: 'method', exported: true },
  ],
  c: [
    { re: /^\s*(?:static\s+)?[\w*]+\s+(\w+)\s*\([^;]*\)\s*\{/, kind: 'function', exported: true },
  ],
  cpp: [
    { re: /^\s*(?:static\s+|inline\s+)?[\w:*&<>]+\s+(\w+)\s*\([^;]*\)\s*\{/, kind: 'function', exported: true },
    { re: /^\s*(?:class|struct)\s+(\w+)/, kind: 'class', exported: true },
  ],
  ruby: [
    { re: /^\s*def\s+([\w?!]+)/, kind: 'method', exported: true },
    { re: /^\s*(?:class|module)\s+(\w+)/, kind: 'type', exported: true },
  ],
  php: [
    { re: /^\s*(?:public\s+|private\s+|protected\s+)?function\s+(\w+)/, kind: 'function', exported: true },
    { re: /^\s*(?:final\s+|abstract\s+)*class\s+(\w+)/, kind: 'class', exported: true },
  ],
  bash: [
    { re: /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/, kind: 'function', exported: true },
  ],
}

export function extractSymbolsLite(text, language) {
  const patterns = SYMBOL_PATTERNS[language] ?? []
  if (patterns.length === 0) return []
  const lines = text.split('\n')
  const symbols = []
  const seen = new Set()
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    for (const pattern of patterns) {
      const match = pattern.re.exec(line)
      if (match === null) continue
      if (pattern.list === true) {
        for (const raw of match[1].split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0].trim()
          if (name === '' || seen.has(name)) continue
          seen.add(name)
          symbols.push({ name, kind: pattern.kind, line: i + 1, exported: true })
        }
        continue
      }
      const name = pattern.nameGroup !== undefined ? match[pattern.nameGroup] : match[1]
      if (name === undefined || name === '' || seen.has(name)) continue
      seen.add(name)
      symbols.push({ name, kind: pattern.kind, line: i + 1, exported: pattern.exported === true })
    }
  }
  return symbols
}

export function extractDuty(text, relativePath) {
  const lines = text.split('\n')
  let i = 0
  if (lines[0]?.startsWith('#!')) i = 1
  while (i < lines.length && lines[i].trim() === '') i += 1
  const candidate = lines[i] ?? ''
  let block = null
  if (/^\s*\/\*\*?/.test(candidate)) block = collectBlock(lines, i, /\*\//)
  else if (/^\s*"""/.test(candidate)) block = collectBlock(lines, i, /"""/)
  else if (/^\s*'''/.test(candidate)) block = collectBlock(lines, i, /'''/)
  else if (/^\s*(\/\/|#)/.test(candidate)) block = collectLineComments(lines, i)
  if (block !== null) {
    const line = block
      .map((raw) => raw
        .replace(/^\s*(\/\/+|#+|\*+|"""|'''|\/\*\*?|\*\/)\s?/g, '')
        .replace(/\s*(\*\/|"""|''')\s*$/, '')
        .trim())
      .find((raw) => raw !== '' && !raw.startsWith('@') && !/^[=-]{3,}$/.test(raw))
    if (line !== undefined) return { duty: line.slice(0, DUTY_MAX), source: 'leading-comment', line: i + 1 }
  }
  return { duty: null, source: null, line: null }
}

function collectBlock(lines, start, terminator) {
  const collected = []
  for (let i = start; i < Math.min(lines.length, start + 40); i += 1) {
    collected.push(lines[i])
    if (i > start && terminator.test(lines[i])) break
    if (i === start && terminator.test(lines[i].replace(/^\s*(\/\*\*?|"""|''')/, ''))) break
  }
  return collected
}

function collectLineComments(lines, start) {
  const collected = []
  for (let i = start; i < Math.min(lines.length, start + 20); i += 1) {
    if (!/^\s*(\/\/|#)/.test(lines[i])) break
    collected.push(lines[i])
  }
  return collected
}

/**
 * 判断某个命中是否落在**注释/文档串上下文**里。
 *
 * 这条是实战逼出来的：中文界面文案里天然带「必须/不可/注意」（例如
 * `return '数据源暂时不可用（网络连接失败）'`），若不加这层，S 会把**用户可见文案**当成纪律约束报出来。
 * 口径：行首是注释符，或命中位置之前出现过注释起始符（含 Python docstring 的 """ / '''）。
 */
const COMMENT_TOKENS_BEFORE = /(\/\/|#|\/\*|<!--|--|"""|''')/
const COMMENT_LINE_START = /^\s*(\/\/|#|\*|<!--|--|"""|''')/

function isCommentContext(line, markerIndex) {
  if (COMMENT_LINE_START.test(line)) return true
  return COMMENT_TOKENS_BEFORE.test(line.slice(0, markerIndex))
}

export function extractConstraints(text) {
  const lines = text.split('\n')
  const out = []
  for (let i = 0; i < lines.length && out.length < MAX_CONSTRAINTS_PER_FILE; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '') continue
    const ruleMatch = RULE_MARKERS.exec(line)
    if (ruleMatch !== null && isCommentContext(line, ruleMatch.index)) {
      out.push({ line: i + 1, kind: 'rule', marker: ruleMatch[0], text: trimmed.slice(0, 160) })
      continue
    }
    const todoMatch = TODO_MARKERS.exec(line)
    if (todoMatch !== null && isCommentContext(line, todoMatch.index)) {
      out.push({ line: i + 1, kind: 'todo', marker: todoMatch[0], text: trimmed.slice(0, 160) })
      continue
    }
    for (const { re, risk } of RISK_PATTERNS) {
      if (re.test(line)) {
        out.push({ line: i + 1, kind: 'risk', marker: risk, text: trimmed.slice(0, 160) })
        break
      }
    }
  }
  return out
}

/** 单行装配：把"已抽好的符号"变成一行 F/R/A/S（供正则层与 WASM 层共用一份口径）。 */
export function buildRow(file, symbols, graph, options = {}) {
  const maxExports = options.maxExports ?? 8
  const exported = symbols.filter((s) => s.exported)
  const dutyInfo = extractDuty(file.text, file.path)
  const fallbackDuty = exported.length > 0
    ? `${file.language} 模块，导出 ${exported.slice(0, 3).map((s) => s.name).join('/')}${exported.length > 3 ? ' 等' : ''}`
    : `${file.language} 模块（无显式导出）`
  const importers = [...(graph.importers.get(file.path) ?? [])].sort()
  const outEdges = [...(graph.imports.get(file.path) ?? [])].sort()
  const constraints = extractConstraints(file.text)
  return {
    path: file.path,
    language: file.language,
    lines: file.lines,
    bytes: file.bytes,
    duty: dutyInfo.duty ?? fallbackDuty,
    dutySource: dutyInfo.source,
    dutyLine: dutyInfo.line,
    entryPoints: exported.slice(0, maxExports).map((s) => ({ name: s.name, kind: s.kind, line: s.line, source: s.source ?? 'regex' })),
    exportCount: exported.length,
    /** 导出符号按种类计数：排序时"可调用/类型导出"比"一堆模块级常量"更能代表文件重要性。 */
    exportedByKind: exported.reduce((acc, s) => {
      acc[s.kind] = (acc[s.kind] ?? 0) + 1
      return acc
    }, {}),
    symbolCount: symbols.length,
    symbolsByKind: symbols.reduce((acc, s) => {
      acc[s.kind] = (acc[s.kind] ?? 0) + 1
      return acc
    }, {}),
    importers,
    importerCount: importers.length,
    importsOut: outEdges,
    importsOutCount: outEdges.length,
    unresolvedRelative: (graph.unresolved.get(file.path) ?? []).map((u) => ({ specifier: u.specifier, line: u.line })),
    constraints,
    constraintCounts: {
      rule: constraints.filter((c) => c.kind === 'rule').length,
      todo: constraints.filter((c) => c.kind === 'todo').length,
      risk: constraints.filter((c) => c.kind === 'risk').length,
    },
  }
}

/** 用"每文件符号表"装配 atlas（供 WASM 优先 + 正则补位的路径使用）。 */
export function buildAtlasFromSymbols(files, symbolsByPath, graph, options = {}) {
  const rows = files.map((file) => buildRow(file, symbolsByPath.get(file.path) ?? [], graph, options))
  return {
    generatedAt: new Date().toISOString(),
    fileCount: rows.length,
    symbolTotal: rows.reduce((sum, row) => sum + row.symbolCount, 0),
    files: rows,
    externalTop: [...graph.externalCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20),
  }
}

export function buildAtlas(files, graph, options = {}) {
  return buildAtlasFromSymbols(files, new Map(files.map((file) => [file.path, extractSymbolsLite(file.text, file.language)])), graph, options)
}

export function renderFrasLine(row) {
  const entry = row.entryPoints.length > 0
    ? row.entryPoints.map((e) => `${e.name}@${e.line}`).join(' ')
    : '—'
  const s = row.constraintCounts
  const sText = s.rule + s.todo + s.risk === 0
    ? '0'
    : `${s.rule + s.todo + s.risk} 条（rule ${s.rule} / risk ${s.risk} / todo ${s.todo}）`
  return `${row.path} :: F:${row.duty} | R:in=${row.importerCount} out=${row.importsOutCount} | A:${entry} | S:${sText}`
}

export function renderFras(atlas, options = {}) {
  const limit = options.limit ?? 200
  const minImporters = options.minImporters ?? 0
  const includeConstraints = options.includeConstraints === true
  const filterPath = options.pathFilter ?? null
  const rows = atlas.files
    .filter((row) => row.importerCount >= minImporters)
    .filter((row) => (filterPath === null ? true : row.path.includes(filterPath)))
    .sort((a, b) => b.importerCount - a.importerCount || a.path.localeCompare(b.path))
  const lines = [`# F/R/A/S 认知层 · ${atlas.fileCount} 文件（按被依赖度排序，显示 ${Math.min(limit, rows.length)} 行）`]
  for (const row of rows.slice(0, limit)) {
    lines.push(renderFrasLine(row))
    if (includeConstraints && row.constraints.length > 0) {
      for (const c of row.constraints.slice(0, 5)) lines.push(`    - [${c.kind}] L${c.line} ${c.marker}: ${c.text}`)
    }
  }
  return lines.join('\n')
}
