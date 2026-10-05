# dsh-code-atlas · DSH 代码图谱

**给 agent 一张可核的仓库地图**：tree-sitter WASM 符号索引 + 排序仓库地图 + **每文件一行 F/R/A/S 认知层**。

给 DeepSeek Harness（dsh）用。解决同一个老问题：agent 每开一个新会话都要"到处翻文件"才能知道这个仓库长什么样。

- 内核：**dsh 0.2.0-rc.2**（桌面端 `DSH Desktop v2.0.17` 实测）
- 解析：**tree-sitter 走 WASM**（`web-tree-sitter` + `tree-sitter-wasms`）——**不需要编译器**
- 许可：MIT

---

## 为什么

翻文件的代价不在"读"，在"不知道读哪个"。dsh-code-atlas 一次建索引，之后：

- **仓库地图**：按"被依赖度 × 4 + 导出数 × 1.5 + 行数 + 符号密度"排序，测试与被压缩产物降权 ⇒ 告诉你**先读哪几个文件**；
- **符号检索**：精确 > 前缀 > 子串，导出加权，每个命中带 `文件:行` 与**所在文件的职责**；
- **F/R/A/S 认知层**：每文件一行，**F 职责 / R 关系 / A 入口 / S 不能弄错的约束**——S 是从注释纪律标记与危险模式里抽的**候选**，**每条带行号出处**。

实测（本机一个真实工作区）：

```
252 文件 · 2718 符号 · 0.82 秒          （tree-sitter 252 文件 / 正则兜底 0）

# 仓库地图（前 3）
_research/dsh-cron-upstream/lib/logger.js :: F:Unified logging wrapper for dsh-cron (#204) | 被依赖 15 | 导出 2 | 关键符号 setLogger@7 logger@17
_research/dsh-cron-upstream/lib/best-effort.js :: F:Run a non-critical side effect; never throw. | 被依赖 14 | 导出 1 | 关键符号 bestEffort@5
_research/dsh-cron-upstream/lib/channels.js :: F:Delivery channels and router (#26, #20, …) | 被依赖 9 | 导出 16 | 关键符号 CHANNEL_IDS@14 resolveChannels@31 …
```

## 安装

> **尚未发布到 npm / GitHub**（仓库命名与发布待定）。现在就有两种装法：

**A. 本地装（现在就能用，已验证）** —— 把本目录拷进 profile 的 `node_modules/@qlheric/dsh-code-atlas`，并在该 profile 的 `package.json` 里给 `dsh.profile.bundles` 加一行 `"@qlheric/dsh-code-atlas"`（`web-tree-sitter` 与 `tree-sitter-wasms` 两个 WASM 依赖要在同一 profile 里可解析），重启 dsh。

**B. 发布后（一条命令）**
```bash
dsh plugin --profile <你的 profile> add github:qlheric/dsh-code-atlas
```

工具为 `code_atlas_index` / `code_atlas_map` / `code_atlas_search` / `code_atlas_symbols` / `code_atlas_fras`。

## 工具

| 工具 | 用途 | 关键口径 |
|---|---|---|
| `code_atlas_index` | `status` 看索引状态 / `build` 强制重建 | 索引写到 `<repo>/.dsh-code-atlas/index.json`，**只是派生数据，可随时删** |
| `code_atlas_map` | 排序仓库地图 | 有界（默认 40 条）；`focus` 可只看某段路径/职责；`format=json` 给程序读 |
| `code_atlas_search` | 符号检索 | 精确 > 前缀 > 子串；导出加权；返回 `文件:行` + 种类 + 来源 |
| `code_atlas_symbols` | 列符号 | 按名字/文件/种类过滤，可只要导出符号 |
| `code_atlas_fras` | **F/R/A/S 认知层** | 按被依赖度排序；`includeConstraints=true` 附前 5 条约束原文（带行号） |

## F/R/A/S 是什么

| 字母 | 含义 | 怎么来的（**可核**） |
|---|---|---|
| **F** 职责 | 这个文件负责什么 | 文件首段注释（去标记）+ 出处行号；没有注释就用主导导出符号兜底 |
| **R** 关系 | 谁依赖我 / 我依赖谁 | 仓库内解析出的 import 边；**未解析的相对导入单独记账**，不外抛 |
| **A** 入口 | 对外入口点 | 导出符号 `名字@行号`；"导出"口径按语言写死（见下） |
| **S** 约束 | 不能弄错的约束 | 注释里的纪律标记（必须/禁止/注意/IMPORTANT/NEVER…）与危险模式（`eval` / `child_process` / `rm -rf` / `shell:true` / 硬编码密钥 / 关 TLS 校验 / 777），**每条带行号** |

**S 是"候选"不是"结论"**——它只把"有人在这里写过纪律"或"这里出现了危险模式"指出来，判断留给读的人。这样它不会编，也不会假装懂了。

## 设计取舍

1. **解析器是增强，不是单点**：拿不到语法文件（版本变动、扩展名不在表里）就**自动退回正则层**，索引照常产出，每条符号标 `source: tree-sitter|regex`。**一次解析器问题不该毁掉整次索引。**
2. **零原生编译**：tree-sitter 全部走 WASM，装包即可跑，不需要 node-gyp 那套。
3. **「导出」按语言各按各的规矩**（写死并注释，避免含糊）：

   | 语言 | 判据 |
   |---|---|
   | JS/TS | 祖先里有 `export_statement` |
   | Go | 首字母大写 |
   | Rust | `pub` / `visibility_modifier` |
   | Python / Ruby / Bash | 不以 `_` 开头即视为公开 |
   | C / C++ | 非 `static` |

4. **扫描面有默认纪律**：VCS、依赖、构建产物、虚拟环境、缓存，以及**点目录**（白名单 `.github`/`.gitlab`/`.dsh-code-atlas`）一律不扫。实测这条把一次真实工作区的扫描从 1094 文件 / 9.46 秒降到 **252 文件 / 0.82 秒**——**不设这条线，别人的仓库就会污染你的仓库地图**。
5. **只读**：不写源码目录、不改文件、不跟符号链接（junction 不会把扫描带出工作区）；唯一的写是派生缓存。

## 兼容

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "compatibility": { "dsh": ">=0.2.0-rc.2 <0.3.0", "dshReleases": { "0.2.0-rc.2": "compatible" }, "profiles": ["web", "desktop"] }
}
```

## 开发与测试

```bash
pnpm install          # 只装两个 WASM 依赖
node --test           # 18 项，全绿
```

**沙箱验收判据**（本机实测过）：干净 profile 启动后日志出现
`[dsh-code-atlas] 已注册 5 个工具：…` 且 **stderr 零告警**；`--dump-config` 合成树里有 `- id: code-atlas`。

## 已知边界

- 符号种类与行号来自语法树；**引用/调用图尚未做**（`code_atlas_refs` 在路线图上）。
- 单文件上限 512KB、单次扫描默认 20000 文件；索引是**全量重建**（增量留给下一版）。
- 语言表见 `lib/scan.js`；不认识的扩展名不索引（不会瞎猜语法）。
- F/R/A/S 的 S 是启发式候选；**需要精确判定时请读原文**（每行都给了行号）。

## 许可

MIT © 2026 qlheric
