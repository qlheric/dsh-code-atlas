# dsh-code-atlas

A repo map your agent can actually check.

tree-sitter symbol index over WASM (no compiler), a repo map ranked by importance, and a one-line-per-file F/R/A/S summary.

The problem: an agent opening a fresh session has to hunt through files to learn what the repo looks like. The cost isn't *reading* — it's *not knowing which file to read*.

## Install

```
dsh plugin --profile <your-profile> add github:qlheric/dsh-code-atlas
```

Both WASM dependencies (`web-tree-sitter`, `tree-sitter-wasms`) come along. Restart dsh afterwards.

The `desktop` profile on the Electron app refuses the command; there you edit `dsh.profile.bundles` and install with pnpm.

## What the output looks like

From a real workspace on this machine:

```
252 files · 2723 symbols · 0.82 s      (tree-sitter 252 files, regex fallback 0)

.../lib/logger.js :: F:Unified logging wrapper for dsh-cron (#204) | importers 15 | exports 2 | key symbols setLogger@7 logger@17
.../lib/channels.js :: F:Delivery channels and router (#26, #20, …) | importers 9 | exports 16 | key symbols CHANNEL_IDS@14 resolveChannels@31 …
```

Five tools: `code_atlas_index` (status / build), `code_atlas_map`, `code_atlas_search`, `code_atlas_symbols`, `code_atlas_fras`. The index is just `<repo>/.dsh-code-atlas/index.json` — derived data, delete it whenever.

## What F/R/A/S means

| | meaning | where it comes from (all checkable) |
|---|---|---|
| **F** | what the file is for | leading comment (markers stripped) with its line number; falls back to the main exports |
| **R** | who imports me / whom I import | import edges resolved in-repo; unresolvable relative imports are listed, never thrown |
| **A** | what it exposes | exported symbols as `name@line`; "exported" is defined per language (below) |
| **S** | what you must not break | discipline words in comments (MUST/NEVER/IMPORTANT/必须/禁止…) and risky patterns (`eval`, `child_process`, `rm -rf`, `shell:true`, hard-coded secrets, disabled TLS checks, `777`), each with a line number |

`S` gives **candidates, not conclusions**. It points at "someone wrote a rule here" or "a risky pattern shows up here"; the judgement stays with you. That's what keeps it from inventing anything.

## Choices worth explaining

**The parser is an enhancement, not a single point of failure.** No grammar available (version drift, unknown extension) and extraction falls back to regex — the index still builds, and every symbol is tagged `source: tree-sitter|regex`. A parser bug must not destroy the whole index.

**"Exported" is defined per language**, hard-coded in `isExported()`:

| language | rule |
|---|---|
| JS/TS | an `export_statement` ancestor |
| Go | leading capital |
| Rust | `pub` / `visibility_modifier` |
| Python / Ruby / Bash | public unless it starts with `_` |
| C / C++ | anything that isn't `static` |

**Dot-directories are skipped by default.** This one was learned the hard way: the first version also indexed the reference repos cloned under `.dsh_probe/` — 1094 files, 9.46 s. With the rule in place: 252 files, 0.82 s. Without that line, other people's repos pollute your map.

**Read-only.** Apart from that derived cache nothing is written, and symlinks are never followed (a junction can't drag the scan outside the workspace).

## Development

```
pnpm install     # two WASM deps
node --test      # 19 tests
```

A clean profile should log `[dsh-code-atlas] 已注册 5 个工具：…` with an empty stderr.

## Boundaries

No call graph yet (`R` stops at file-level imports). The index is fully rebuilt each time, 512KB per file, unknown extensions are skipped rather than guessed. `S` is heuristic — when precision matters, read the source at the line number it gives you.

## License

MIT
