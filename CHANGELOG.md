# Changelog

本文件只记**对外可见的变化**（工具面、口径、兼容声明）。

## [0.1.0] — 2026-10-06

### 新增（5 个工具 + 四层底座）
| 层 | 模块 | 能力 |
|---|---|---|
| 扫描 | `lib/scan.js` | 忽略 VCS/依赖/构建/虚拟环境；二进制与大文件守卫；POSIX 路径；只读不跟符号链接 |
| 依赖图 | `lib/imports.js` | JS/TS · Python · Go · Rust 导入抽取与仓库内解析；未解析相对导入单独记账 |
| 符号 | `lib/extract-wasm.js` | tree-sitter WASM（`web-tree-sitter@0.25.10` + `tree-sitter-wasms@0.1.13`）；**拿不到语法返回 null**，调用方退回 `lib/fras.js` 的正则层 |
| 认知层 | `lib/fras.js` | **F 职责**（首段注释 + 出处行号）· **R 关系**（谁依赖我/我依赖谁）· **A 入口**（导出符号@行号）· **S 约束**（注释纪律标记 + 危险模式候选，每条带行号） |
| 装配 | `lib/atlas.js` | **WASM 优先 + 正则补位**（按名字并集，冲突以 WASM 为准，每条标 `source`）；磁盘缓存 `<repo>/.dsh-code-atlas/index.json`；仓库地图排序（被依赖×4 + 导出×1.5 + 行数 + 符号密度，测试与压缩产物降权） |

**工具面**：`code_atlas_index`（status/build）· `code_atlas_map` · `code_atlas_search` · `code_atlas_symbols` · `code_atlas_fras`。

### 「导出」口径按语言写死（避免含糊）
| 语言 | 判据 |
|---|---|
| JS/TS | 祖先里有 `export_statement` |
| Go | 首字母大写 |
| Rust | `pub` / `visibility_modifier` |
| Python / Ruby / Bash | 不以 `_` 开头即视为公开 |
| C / C++ | 非 `static` |

### 测试
- `node --test`：**18 项全绿**（扫描 / 语言判定 / 四语言导入 / 说明符解析 / 依赖图 / F·R·A·S 抽取 / atlas 装配 / 符号合并 / 检索排序 / 地图排序 / 5 个工具真跑 / schema 词汇合规 / 退化路径）。
- 抓出并修掉：单行块注释尾部 `*/` 未剥、Go `type X struct` 名字在 `type_spec`、Rust 首个 `pub fn` 可见性取不到、类体内函数种类、**Python 全部被当成"未导出"导致 A 列为空**（这条最要紧）。

### 验收（沙箱真跑）
干净 profile `profiles/zsandbox3`（base + web-app + 本包 + 两个 wasm 依赖）启动日志：
`[dsh-code-atlas] 已注册 5 个工具：code_atlas_index, code_atlas_map, code_atlas_search, code_atlas_symbols, code_atlas_fras`，**stderr 零告警**；`--dump-config` 有 `- id: code-atlas` 行。

### 待做
- 装进 desktop profile（与 `dsh-code-index` 是否并存需老大拍板——两者工具名不同，可并存）。
- README 重构与发布（repo 名待老大定）。

| 模块 | 能力 | 关键口径 |
|---|---|---|
| `lib/extract-wasm.js` | **tree-sitter WASM 符号抽取** | 已验证组合 `web-tree-sitter@0.25.10` + `tree-sitter-wasms@0.1.13`；JS/TS/Python/Go/Rust/Java/C/C++/C#/Ruby/PHP/Bash；**拿不到语法就返回 `null`**（调用方退回正则层，绝不让解析器问题毁掉整次索引）；导出判定按语言：JS/TS 看 `export_statement`、Go 看首字母大写、Rust 看 `pub`/`visibility_modifier`；方法（类体内函数）与箭头函数分别归 `method`/`function` |

| 模块 | 能力 | 关键口径 |
|---|---|---|
| `lib/scan.js` | 工作区扫描 | 目录级忽略（VCS/依赖/构建/虚拟环境/缓存）＋文件级守卫（超 `maxFileBytes`、含 NUL 判二进制、语言表外跳过）；**路径一律 POSIX 相对**；**只读、不跟随符号链接**（防止 junction 把扫描带出工作区） |
| `lib/imports.js` | 依赖图 | 抽取 JS/TS（esm/副作用/再导出/dynamic/require）、Python（import/from，含相对导入）、Go（单行与块）、Rust（use/mod）；解析支持扩展名、`index.*`、`__init__.py`、`mod.rs` 候选；**未解析的相对导入单独记账**，不外抛 |
| `lib/fras.js` | **F/R/A/S 认知层** | F=首段注释（去标记、保留出处行号）＋导出符号兜底；R=仓库内谁 import 我 / 我 import 谁；A=对外入口点（名字@行号）；S=**带出处的约束候选**（rule: 必须/禁止/注意/IMPORTANT/NEVER…；todo: TODO/FIXME；risk: eval/child_process/rm -rf/`shell:true`/硬编码密钥/关 TLS 校验/777） |

### 待做
- 工具面：`code_atlas_index` / `code_atlas_map` / `code_atlas_search` / `code_atlas_symbols` / `code_atlas_fras`；`lib/atlas.js` 做 **WASM 优先 + 正则补位**（按名字取并集，名字冲突以 WASM 的种类为准）。
- 沙箱 profile 真跑验收（`profiles/zsandbox3`），再谈装进 desktop。

### 测试
- `node --test`：**12 项全绿**（扫描忽略规则、语言判定、四语言导入抽取、说明符解析、依赖图、F/R/A/S 抽取、atlas 装配与渲染、WASM 语法可加载、JS/TS 与 Python/Go/Rust 符号抽取、退化路径）。
- 测试抓出的问题：单行块注释尾部 `*/` 未剥、fixtures 放进 `test/` 被 Node 测试运行器当测试执行（已移到仓库根 `fixtures/`）、Go `type X struct` 的名字挂在 `type_spec` 上、Rust 文件首个 `pub fn` 的可见性前缀取不到（改为查 `visibility_modifier` 子节点）。

### 设计取舍（写下来防走偏）
- **S 是"候选"不是"结论"**：全部来自可核的注释标记与危险模式，**每条带行号出处**；不做模型总结，避免"看起来对但没法核"。
- **tree-sitter 是增强不是依赖**：正则级抽取先跑通（多语言零依赖），WASM 版接入同一接口，缺语法文件时能优雅退化。
