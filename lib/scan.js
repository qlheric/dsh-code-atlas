/**
 * scan —— 工作区扫描（零依赖，只读）。
 *
 * 口径：
 *   · 目录级忽略：VCS / 依赖 / 构建产物 / 虚拟环境 / 缓存（可配置追加）
 *   · 文件级忽略：超过 maxFileBytes、含 NUL 字节（判定为二进制）、不在语言表内
 *   · 路径一律用 **POSIX 相对路径**（跨平台一致，便于 index 与 diff 比较）
 *   · 只读：不跟随符号链接（避免 junction/软链把扫描带出工作区）
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn',
  'node_modules', 'bower_components', 'jspm_packages',
  'dist', 'build', 'out', 'output', 'coverage', '.nyc_output',
  '.next', '.nuxt', '.svelte-kit', '.output', '.turbo', '.parcel-cache',
  '.venv', 'venv', 'env', '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox',
  'target', 'vendor', '.gradle', '.idea', '.vscode', '.cache', 'tmp', 'temp',
  '.dsh-code-index', '.dsh-code-atlas', '.atlas', '.DS_Store',
])

export const LANGUAGE_BY_EXT = Object.freeze({
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescript',
  '.py': 'python', '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c', '.h': 'c',
  '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.md': 'markdown',
})

export function languageFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return LANGUAGE_BY_EXT[ext] ?? null
}

const CODE_LANGUAGES = new Set(['javascript', 'typescript', 'python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp', 'ruby', 'php', 'bash'])

export function isCodeLanguage(language) {
  return CODE_LANGUAGES.has(language)
}

export function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/')
}

/** 默认会跳过的点目录白名单：这些是"正经源码目录"，不是工具缓存。 */
export const DOT_DIR_ALLOWLIST = new Set(['.github', '.gitlab', '.dsh-code-atlas'])

export function shouldSkipDirectory(name, extraIgnored = new Set()) {
  if (IGNORED_DIRS.has(name) || extraIgnored.has(name)) return true
  // 点目录一般是工具/缓存/临时目录（实测：把 .dsh_probe 里的三个参考仓一起扫进来会污染仓库地图）
  if (name.startsWith('.') && !DOT_DIR_ALLOWLIST.has(name)) return true
  return false
}

export async function scanWorkspace(root, options = {}) {
  const maxFiles = options.maxFiles ?? 20_000
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024
  const extraIgnored = new Set(options.ignore ?? [])
  const onlyCode = options.onlyCode === undefined ? true : Boolean(options.onlyCode)
  const files = []
  const stats = { visited: 0, ignoredDirs: 0, skippedLarge: 0, skippedBinary: 0, skippedLanguage: 0, skippedSymlink: 0, truncated: false }
  const queue = ['']

  while (queue.length > 0) {
    const relativeDir = queue.shift()
    const absoluteDir = relativeDir === '' ? root : path.join(root, relativeDir)
    let entries
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`
      if (entry.isSymbolicLink()) {
        stats.skippedSymlink += 1
        continue
      }
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name, extraIgnored)) {
          stats.ignoredDirs += 1
          continue
        }
        queue.push(relative)
        continue
      }
      if (!entry.isFile()) continue
      stats.visited += 1
      const language = languageFor(entry.name)
      if (language === null || (onlyCode && !isCodeLanguage(language))) {
        stats.skippedLanguage += 1
        continue
      }
      if (files.length >= maxFiles) {
        stats.truncated = true
        continue
      }
      const absolute = path.join(root, relative)
      let info
      try {
        info = await stat(absolute)
      } catch {
        continue
      }
      if (info.size > maxFileBytes) {
        stats.skippedLarge += 1
        continue
      }
      let text
      try {
        text = await readFile(absolute, 'utf8')
      } catch {
        continue
      }
      if (text.includes('\u0000')) {
        stats.skippedBinary += 1
        continue
      }
      files.push({
        path: toPosix(relative),
        absolute,
        bytes: info.size,
        lines: text === '' ? 0 : text.split('\n').length,
        language,
        text,
      })
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { root, files, stats }
}
