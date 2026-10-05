# 更新记录

只记对外能看到的变化：工具面、判据、兼容声明。

## 0.1.0 — 2026-10-06

第一次发出来。五个工具：`code_atlas_index`、`code_atlas_map`、`code_atlas_search`、`code_atlas_symbols`、`code_atlas_fras`。

底座四层：扫描（`lib/scan.js`）、依赖图（`lib/imports.js`）、符号（`lib/extract-wasm.js` + 正则兜底）、装配（`lib/atlas.js` 做 WASM 优先 + 正则补位，每条符号标 `source`）。

符号抽取走 `web-tree-sitter@0.25.10` + `tree-sitter-wasms@0.1.13`（WASM，不用编译器）。拿不到语法文件就返回 `null`，调用方退回正则层 —— 解析器出问题不该毁掉整次索引。

不同语言的"导出"判据（写死在 `isExported()` 里）：JS/TS 看 `export_statement`、Go 看首字母大写、Rust 看 `pub`/`visibility_modifier`、Python/Ruby/Bash 不以 `_` 开头就算公开、C/C++ 非 `static`。

测试过程中真踩到并修掉的坑，留这儿备查：

- 单行块注释的结尾 `*/` 没剥掉，职责里带进去了；
- fixtures 放在 `test/` 下会被 Node 的测试运行器当测试执行（挪到仓库根的 `fixtures/`）；
- Go 的 `type X struct{}` 名字挂在 `type_spec` 上，直接取 `name` 取不到；
- Rust 文件里第一个 `pub fn` 取不到可见性前缀（改成查 `visibility_modifier` 子节点）；
- 类体里的函数被算成 `function` 而不是 `method`；
- **Python 全被判成"未导出"**，导致 A 列（入口）是空的 —— 这条最要紧；
- 把中文界面文案里的"不可"当成纪律约束报出来（加了"只认注释上下文"的门禁；见下条）；
- 仓库地图第一版把 `.dsh_probe/` 下克隆的参考仓一起扫了，1094 个文件、9.46 秒 —— 加"点目录默认不扫"后 252 个文件、0.82 秒；
- 排序第一版按导出总数加权，一堆模块级常量的 Python 脚本会压过真正的枢纽模块 —— 改成可调用/类型导出算 1.5、常量算 0.3。

## 未发布

- 调用/引用图（`R` 列目前只到文件级依赖）；
- 增量索引（现在每次全量重建）。
