import { test } from 'node:test'
import assert from 'node:assert/strict'

import { availableGrammars, extractSymbolsWasm, supportsLanguage } from '../lib/extract-wasm.js'
import { extractSymbolsLite } from '../lib/fras.js'

const JS = `/** 样例 */
export function alpha(a) { return a }
export class Beta { method() {} }
const gamma = () => 1
function delta() {}
export const epsilon = 2
`

const PY = `"""样例"""
import os


def alpha(a):
    return a


class Beta:
    def method(self):
        return 1


GAMMA = 3
`

const GO = `package main

func Alpha(a int) int { return a }

func (s *Svc) Method() int { return 1 }

type Svc struct{}
`

const RUST = `pub fn alpha(a: i32) -> i32 { a }

fn delta() -> i32 { 1 }

pub struct Svc { v: i32 }

enum Private { A }
`

test('WASM 语法可加载（本机已验证组合）', async () => {
  assert.equal(await supportsLanguage('javascript'), true)
  assert.equal(await supportsLanguage('python'), true)
  const grammars = await availableGrammars()
  for (const language of ['javascript', 'typescript', 'python', 'go', 'rust', 'java']) {
    assert.ok(grammars.includes(language), `缺少 ${language} 语法`)
  }
  assert.equal(await supportsLanguage('brainfuck'), false) // 语言表外的问 null，不抛
})

test('JS/TS 抽取：函数/类/箭头函数/方法 + 导出判定', async () => {
  const symbols = await extractSymbolsWasm(JS, 'javascript', 'a.js')
  const byName = Object.fromEntries(symbols.map((s) => [s.name, s]))
  assert.equal(byName.alpha.kind, 'function')
  assert.equal(byName.alpha.exported, true)
  assert.equal(byName.Beta.kind, 'class')
  assert.equal(byName.Beta.exported, true)
  assert.equal(byName.method.kind, 'method') // 类体内的方法
  assert.equal(byName.gamma.kind, 'function') // 箭头函数按函数记
  assert.equal(byName.gamma.exported, false)
  assert.equal(byName.delta.kind, 'function')
  assert.equal(byName.delta.exported, false)
  assert.equal(byName.epsilon.kind, 'variable')
  assert.equal(byName.epsilon.exported, true)
  assert.equal(byName.alpha.line, 2)
  assert.equal(symbols.every((s) => s.source === 'tree-sitter'), true)
})

test('Python/Go/Rust 抽取与可见性', async () => {
  const py = Object.fromEntries((await extractSymbolsWasm(PY, 'python', 'a.py')).map((s) => [s.name, s]))
  assert.equal(py.alpha.kind, 'function')
  assert.equal(py.Beta.kind, 'class')
  assert.equal(py.method.kind, 'method')
  assert.equal(py.GAMMA, undefined) // 模块级赋值的可见性我们不猜（正则层会兜）

  const go = Object.fromEntries((await extractSymbolsWasm(GO, 'go', 'a.go')).map((s) => [s.name, s]))
  assert.equal(go.Alpha.kind, 'function')
  assert.equal(go.Method.kind, 'method')
  assert.equal(go.Svc.kind, 'type')

  const rust = Object.fromEntries((await extractSymbolsWasm(RUST, 'rust', 'a.rs')).map((s) => [s.name, s]))
  assert.equal(rust.alpha.kind, 'function')
  assert.equal(rust.alpha.exported, true) // pub
  assert.equal(rust.delta.exported, false)
  assert.equal(rust.Svc.kind, 'struct')
})

test('WASM 与正则层对同一文件的口径差（记录，不是要求相等）', async () => {
  const wasm = await extractSymbolsWasm(JS, 'javascript', 'a.js')
  const lite = extractSymbolsLite(JS, 'javascript')
  const wasmNames = wasm.map((s) => s.name).sort()
  const liteNames = lite.map((s) => s.name).sort()
  // 正则层把箭头函数也当函数；WASM 层区分方法与函数 —— 名单应一致
  assert.deepEqual(wasmNames, ['Beta', 'alpha', 'delta', 'epsilon', 'gamma', 'method'])
  assert.ok(liteNames.includes('alpha') && liteNames.includes('Beta'))
})

test('拿不到语法时返回 null（调用方退回正则层）', async () => {
  assert.equal(await extractSymbolsWasm('x = 1', 'brainfuck'), null)
  assert.equal(await extractSymbolsWasm('x'.repeat(2_000_001), 'javascript'), null)
  assert.equal(await extractSymbolsWasm(null, 'javascript'), null)
})
