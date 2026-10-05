# 参与贡献 / Contributing

谢谢你来。这个项目只做一件事：**给 agent 一张可核的仓库地图**。所以"可核"是唯一标准——每条结论都要能指回出处（行号/文件路径），拿不到就说拿不到。

## 准备与跑测试

```bash
pnpm install         # 只装两个 WASM 依赖（web-tree-sitter / tree-sitter-wasms），无原生编译
node --test          # 本地全绿（当前 19 项）
```

## 加一种语言（tree-sitter 语法）

1. `lib/extract-wasm.js`：`GRAMMAR_BY_LANGUAGE` 加一行（先确认 `tree-sitter-wasms/out/` 里有对应 `.wasm`）、`NODE_KINDS` 里给该语言的"算符号的节点类型"；
2. `lib/scan.js`：`LANGUAGE_BY_EXT` 加扩展名；
3. `lib/imports.js`（可选）：加该语言的 import 抽取与解析；
4. **`isExported()` 要写清该语言的"导出"判据**（例如 Go 靠首字母大写、Python 靠 `_` 前缀、Rust 靠 `visible_modifier`）——这是本项目最容易含糊的一处，别省注释；
5. 写测试：至少覆盖一个真实片段 + **拿不到语法时必须返回 `null`**（退化路径）。

## 加一个工具或改排序口径

- 工具：`lib/tools.js` 加一个 spec，`index.js` 自动注册；
- 改 `buildRepoMap` 的分数公式：**必须同步** `renderRepoMap` 的图例文字与 README 的说明（口径与展示不许漂移）。

## 硬规矩（PR 会被按这个看）

- **不臆造**：S（约束）只给带行号出处的候选；解析器不可用时退回正则层并标 `source: regex`，**不许假装是语法树结果**；
- **只读**：除 `<repo>/.dsh-code-atlas/index.json` 这个派生缓存外，不写任何文件；不跟随符号链接；
- **参数 schema 只用 rc.2 允许的词汇**（`required` 只允许 `true`）；
- **有界**：任何遍历/扫描都要有上限（文件数、单文件字节、符号数、遍历节点数），超限报错而不是把宿主拖死。

## 提交信息

`feat:` / `fix:` / `docs:` / `test:` / `chore:` + 一句话说清"改了什么口径"。改排序/判据的提交请在正文写清**为什么**（附带能复现的仓库形状更好）。

## 报问题

给**最小复现**：仓库形状（语言/文件数）、期望的 F/R/A/S 或地图、实际输出、`node --version`。若涉及误报（例如把界面文案当成约束），请附那行的原文与行号。

## 许可

MIT。提交即表示你同意以 MIT 许可发布你的贡献。
