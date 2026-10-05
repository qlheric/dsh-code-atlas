/**
 * extract-wasm —— tree-sitter WASM 符号抽取（**增强层**，不是硬依赖）。
 *
 * 契约：拿不到语法文件 / 初始化失败 / 解析异常 ⇒ **返回 null**（调用方退回 `fras.js` 的正则抽取），
 *       绝不因为解析器问题让整个索引失败。
 *
 * 已验证可用组合（本机实测）：`web-tree-sitter@0.25.10` + `tree-sitter-wasms@0.1.13`（静态语法包）。
 *   · 运行时 wasm：`web-tree-sitter/tree-sitter.wasm`（Parser.init 的 locateFile）
 *   · 语法 wasm：`tree-sitter-wasms/out/tree-sitter-<grammar>.wasm`
 */

import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)

const MAX_TEXT_BYTES = 2_000_000
const MAX_SYMBOLS = 20_000

/** 语言 → 语法包名（tree-sitter-wasms 的 out/ 目录）。 */
export const GRAMMAR_BY_LANGUAGE = Object.freeze({
  javascript: 'tree-sitter-javascript',
  typescript: 'tree-sitter-typescript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  c: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
  csharp: 'tree-sitter-c_sharp',
  ruby: 'tree-sitter-ruby',
  php: 'tree-sitter-php',
  bash: 'tree-sitter-bash',
})

/** 每种语言里"算一个符号"的节点类型 → 我们自己的 kind。 */
export const NODE_KINDS = Object.freeze({
  javascript: {
    function_declaration: 'function',
    generator_function_declaration: 'function',
    class_declaration: 'class',
    method_definition: 'method',
    lexical_declaration: 'variable',
    variable_declaration: 'variable',
  },
  typescript: {
    function_declaration: 'function',
    class_declaration: 'class',
    method_definition: 'method',
    method_signature: 'method',
    interface_declaration: 'interface',
    type_alias_declaration: 'type',
    enum_declaration: 'enum',
    lexical_declaration: 'variable',
    variable_declaration: 'variable',
    abstract_class_declaration: 'class',
  },
  python: {
    function_definition: 'function',
    class_definition: 'class',
  },
  go: {
    function_declaration: 'function',
    method_declaration: 'method',
    type_declaration: 'type',
  },
  rust: {
    function_item: 'function',
    struct_item: 'struct',
    enum_item: 'enum',
    trait_item: 'trait',
    type_item: 'type',
    const_item: 'const',
    static_item: 'static',
    mod_item: 'module',
  },
  java: {
    class_declaration: 'class',
    interface_declaration: 'interface',
    enum_declaration: 'enum',
    method_declaration: 'method',
    constructor_declaration: 'constructor',
  },
  c: { function_definition: 'function', struct_specifier: 'struct', enum_specifier: 'enum' },
  cpp: {
    function_definition: 'function',
    struct_specifier: 'struct',
    class_specifier: 'class',
    enum_specifier: 'enum',
    namespace_definition: 'namespace',
  },
  csharp: {
    class_declaration: 'class',
    interface_declaration: 'interface',
    method_declaration: 'method',
    struct_declaration: 'struct',
    enum_declaration: 'enum',
  },
  ruby: { method: 'method', singleton_method: 'method', class: 'class', module: 'module' },
  php: { function_definition: 'function', class_declaration: 'class', method_declaration: 'method' },
  bash: { function_definition: 'function' },
})

function grammarFileFor(language, filePath) {
  if (language === 'typescript' && typeof filePath === 'string' && filePath.endsWith('.tsx')) return 'tree-sitter-tsx'
  return GRAMMAR_BY_LANGUAGE[language] ?? null
}

let parserPromise = null
let parserUnavailable = false

async function getParser() {
  if (parserUnavailable) return null
  if (parserPromise === null) {
    parserPromise = (async () => {
      try {
        const mod = await import('web-tree-sitter')
        const runtimeDir = path.dirname(require.resolve('web-tree-sitter'))
        const wasm = path.join(runtimeDir, 'tree-sitter.wasm')
        await mod.Parser.init({ locateFile: () => wasm })
        return new mod.Parser()
      } catch {
        parserUnavailable = true
        return null
      }
    })()
  }
  return parserPromise
}

const languageCache = new Map()

async function getLanguage(language, filePath) {
  const grammar = grammarFileFor(language, filePath)
  if (grammar === null) return null
  let entry = languageCache.get(grammar)
  if (entry === undefined) {
    entry = (async () => {
      try {
        const mod = await import('web-tree-sitter')
        const grammarPath = require.resolve(`tree-sitter-wasms/out/${grammar}.wasm`)
        const bytes = await readFile(grammarPath)
        return await mod.Language.load(bytes)
      } catch {
        return null
      }
    })()
    languageCache.set(grammar, entry)
  }
  return entry
}

/** 该语言是否有可用的 WASM 语法（不抛异常，只回答能不能）。 */
export async function supportsLanguage(language, filePath) {
  if (grammarFileFor(language, filePath) === null) return false
  const parser = await getParser()
  if (parser === null) return false
  return (await getLanguage(language, filePath)) !== null
}

export async function availableGrammars() {
  const out = []
  for (const language of Object.keys(GRAMMAR_BY_LANGUAGE)) {
    if (await supportsLanguage(language)) out.push(language)
  }
  return out
}

function isExported(node, source, language, name) {
  // 无 export 关键字语言的口径（写死并注释，别让"导出"含义含糊）：
  //   · Go：首字母大写即导出（语言约定）
  //   · Python/Ruby/Bash：不以 `_` 开头即视为公开（Python 的私有约定）
  //   · C/C++：非 `static` 即视为对外可见
  //   · Rust：`pub` / visibility_modifier
  if (language === 'go') return /^[A-Z]/.test(name ?? '')
  if (language === 'python' || language === 'ruby' || language === 'bash') return !String(name ?? '').startsWith('_')
  if (language === 'c' || language === 'cpp') return !/^\s*static\b/.test(node.text.split('\n')[0] ?? '')
  if (language === 'rust') {
    if ((node.children ?? []).some((child) => child.type === 'visibility_modifier')) return true
    const prefix = source.slice(Math.max(0, node.startIndex - 12), node.startIndex)
    return /\bpub\s*$/.test(prefix)
  }
  let current = node.parent
  let depth = 0
  while (current !== null && depth < 6) {
    if (current.type === 'export_statement' || current.type === 'export_declaration') return true
    if (current.type === 'decorated_definition') {
      current = current.parent
      depth += 1
      continue
    }
    if (current.type !== 'program' && current.type !== 'module' && current.type !== 'class_body' && current.type !== 'declaration_list') return false
    current = current.parent
    depth += 1
  }
  return false
}

function nameOf(node) {
  const named = node.childForFieldName('name')
  if (named !== null && named !== undefined) return named.text
  // Go: `type Svc struct{}` → type_declaration → type_spec(name)
  const spec = node.namedChildren?.find((child) => child.type === 'type_spec' || child.type === 'type_identifier')
  if (spec !== undefined) {
    const inner = spec.childForFieldName('name')
    return inner?.text ?? spec.text
  }
  // lexical_declaration → variable_declarator
  const declarator = node.namedChildren?.find((child) => child.type === 'variable_declarator' || child.type === 'init_declarator')
  const inner = declarator?.childForFieldName('name')
  return inner?.text ?? null
}

/** 函数定义若在类体内，语义上是方法（Python 的 class 体也是 function_definition）。 */
function refineKind(node, baseKind) {
  if (baseKind !== 'function' && baseKind !== 'variable') return baseKind
  let current = node.parent
  let depth = 0
  while (current !== null && depth < 8) {
    if (current.type === 'class_body' || current.type === 'class_definition' || current.type === 'class_declaration' || current.type === 'declaration_list') {
      return baseKind === 'function' ? 'method' : baseKind
    }
    current = current.parent
    depth += 1
  }
  return baseKind
}

/** 顶层 `const f = () => {}` / `const f = function () {}` 按函数记，而不是变量。 */
function declaratorKind(declaratorNode) {
  const value = declaratorNode?.childForFieldName('value')
  if (value === null || value === undefined) return 'variable'
  if (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function') return 'function'
  return 'variable'
}

export async function extractSymbolsWasm(text, language, filePath = '') {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_TEXT_BYTES) return null
  const kinds = NODE_KINDS[language]
  if (kinds === undefined) return null
  const parser = await getParser()
  if (parser === null) return null
  const languageObject = await getLanguage(language, filePath)
  if (languageObject === null) return null
  let tree
  try {
    parser.setLanguage(languageObject)
    tree = parser.parse(text)
  } catch {
    return null
  }
  try {
    const symbols = []
    const seen = new Set()
    const stack = [tree.rootNode]
    let visited = 0
    while (stack.length > 0 && symbols.length < MAX_SYMBOLS) {
      const node = stack.pop()
      visited += 1
      if (visited > 400_000) break
      const kind = kinds[node.type]
      if (kind !== undefined && node.type !== 'lexical_declaration' && node.type !== 'variable_declaration') {
        const name = nameOf(node)
        if (typeof name === 'string' && name !== '' && !seen.has(name)) {
          seen.add(name)
          symbols.push({
            name,
            kind: refineKind(node, kind),
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: isExported(node, text, language, nameOf(node)),
            source: 'tree-sitter',
          })
        }
      } else if (kind === 'variable' && (node.parent?.type === 'program' || node.parent?.type === 'module' || node.parent?.type === 'export_statement')) {
        for (const declarator of node.namedChildren ?? []) {
          if (declarator.type !== 'variable_declarator' && declarator.type !== 'init_declarator') continue
          const name = declarator.childForFieldName('name')?.text
          if (typeof name === 'string' && name !== '' && !seen.has(name)) {
            seen.add(name)
            symbols.push({
              name,
              kind: declaratorKind(declarator),
              line: declarator.startPosition.row + 1,
              endLine: declarator.endPosition.row + 1,
              exported: isExported(node, text, language, nameOf(node)),
              source: 'tree-sitter',
            })
          }
        }
      }
      for (const child of node.namedChildren ?? []) stack.push(child)
    }
    symbols.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name))
    return symbols
  } catch {
    return null
  } finally {
    try {
      tree.delete()
    } catch {
      /* 释放失败不影响结果 */
    }
  }
}
