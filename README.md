# dsh-code-atlas

给 agent 一张能核对的仓库地图。

tree-sitter 符号索引（走 WASM，不用装编译器）+ 按重要度排的仓库地图 + 每文件一行 F/R/A/S。

起因：agent 每开个新会话，都得先到处翻文件才知道这仓长什么样。翻的代价不在"读"，在"不知道读哪个"。

## 装

```
dsh plugin --profile <你的 profile> add github:qlheric/dsh-code-atlas
```

两个 WASM 依赖（`web-tree-sitter`、`tree-sitter-wasms`）会跟着装上。装完重启 dsh。

桌面端的 `desktop` profile 同样不认这条命令，那边改 `package.json` 的 `dsh.profile.bundles` + pnpm。

## 跑出来什么样

拿本机一个真实工作区跑的：

```
252 个文件 · 2723 个符号 · 0.82 秒     （tree-sitter 252 个文件，正则兜底 0 个）

_research/dsh-cron-upstream/lib/logger.js :: F:Unified logging wrapper for dsh-cron (#204) | 被依赖 15 | 导出 2 | 关键符号 setLogger@7 logger@17
_research/dsh-cron-upstream/lib/channels.js :: F:Delivery channels and router (#26, #20, …) | 被依赖 9 | 导出 16 | 关键符号 CHANNEL_IDS@14 resolveChannels@31 …
```

五个工具：`code_atlas_index`（status / build）、`code_atlas_map`、`code_atlas_search`、`code_atlas_symbols`、`code_atlas_fras`。

索引写在 `<repo>/.dsh-code-atlas/index.json`，纯派生数据，删了会重建。

## F/R/A/S 是什么

| | 含义 | 从哪来的（都能核） |
|---|---|---|
| **F** | 这文件负责啥 | 文件开头的注释（去掉标记），带行号；没注释就用主要导出兜底 |
| **R** | 谁依赖我 / 我依赖谁 | 仓内解析出的 import；解析不了的相对导入单独列出来，不抛异常 |
| **A** | 对外有哪些入口 | 导出符号 `名字@行号`，"导出"的定义按语言定（下表） |
| **S** | 不能弄错的地方 | 注释里的纪律词（必须/禁止/注意/IMPORTANT/NEVER）和危险模式（`eval`、`child_process`、`rm -rf`、`shell:true`、硬编码密钥、关 TLS 校验、777），每条带行号 |

`S` 只给**候选**，不是结论。它只负责指出"这里有人写过规矩"或"这里出现了危险写法"，判断交给你。这样它不会编，也不会装懂。

## 几处刻意的地方

**解析器是增强，不是单点。** 拿不到语法文件（版本变了、扩展名不在表里）就退回正则层，索引照常出，每条符号标了 `source: tree-sitter|regex`。解析器出问题不该毁掉整次索引。

**"导出"按语言各按各的规矩**，写死在 `isExported()` 里：

| 语言 | 怎么看 |
|---|---|
| JS/TS | 祖先里有 `export_statement` |
| Go | 首字母大写 |
| Rust | `pub` / `visibility_modifier` |
| Python / Ruby / Bash | 不以 `_` 开头就算公开 |
| C / C++ | 不是 `static` 就算 |

**点目录默认不扫。** 这条是踩出来的：第一版把 `.dsh_probe/` 下克隆来参考的几个仓库也扫进去了，1094 个文件、9.46 秒；加了这条线之后 252 个文件、0.82 秒。不设这道线，别人的仓库就会污染你的地图。

**只读。** 除了那个派生缓存，不写任何东西；不跟符号链接（junction 带不出工作区）。

## 开发

```
pnpm install     # 就两个 WASM 依赖
node --test      # 19 个用例
```

干净 profile 里启动应该看到 `[dsh-code-atlas] 已注册 5 个工具：…`，stderr 干净。

## 边界

调用图还没做（`R` 列只到文件级依赖）。索引现在是全量重建，单文件上限 512KB，不认识的扩展名不索引（不瞎猜语法）。`S` 是启发式的，要精确判定就按它给的行号去读原文。

## 许可

MIT
