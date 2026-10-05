# 参与贡献

这个项目只做一件事：给 agent 一张能核对的仓库地图。"能核对"是唯一标准 —— 每条结论都要能指回出处（文件、行号），拿不到就说拿不到。

## 先跑测试

```
pnpm install       # 两个 WASM 依赖，无原生编译
node --test        # 现在 19 个
```

## 加一种语言

1. `lib/extract-wasm.js`：`GRAMMAR_BY_LANGUAGE` 加一行（先确认 `tree-sitter-wasms/out/` 里有对应 `.wasm`），`NODE_KINDS` 里写清这门语言里"哪些节点算符号"；
2. `lib/scan.js`：`LANGUAGE_BY_EXT` 加扩展名；
3. `lib/imports.js`（可选）：加这门语言的 import 抽取和解析；
4. **`isExported()` 里写清这语言的"导出"怎么判**（Go 靠首字母、Python 靠 `_` 前缀、Rust 靠 `visibility_modifier`）—— 这里最容易含糊，注释别省；
5. 补测试：至少一个真实片段 + **拿不到语法时必须返回 `null`** 的退化路径。

## 改排序或工具

- 新工具：`lib/tools.js` 里加一个 spec，`index.js` 会自动注册；
- 改 `buildRepoMap` 的分数公式：**必须同步**改 `renderRepoMap` 的图例文字和 README 的说明 —— 口径和展示不许漂移。

## 合并前会看这几条

- **不臆造**：`S` 只给带行号出处的候选；解析器不可用时退回正则层并标 `source: regex`，不许假装那是语法树的结果；
- **只读**：除了 `<repo>/.dsh-code-atlas/index.json` 这个派生缓存，不写任何文件；不跟符号链接；
- 参数 schema 只用 rc.2 认的字段（`required` 只能 `true`）；
- **有界**：任何遍历都要有上限（文件数、单文件字节、符号数、节点数），超限报错，别把宿主拖死。

## 提交信息

说清"改了什么口径"。改排序或判据的提交，正文里写一下**为什么**（能附一个复现的仓库形状最好）。别写流程黑话。

## 报问题

给最小复现：仓库形状（语言、文件数）、你期望的 F/R/A/S 或地图、实际输出、`node --version`。如果是误报（比如把界面文案当成约束），请附那行原文和行号。

## 许可

MIT，提交即表示同意以 MIT 发布。
